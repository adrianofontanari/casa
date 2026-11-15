/* Webcam still for the window.

   Default: NOAA National Data Buoy Center BuoyCAM on station 46026, 18 nautical miles west
   of San Francisco. NDBC is part of the U.S. National Weather Service; its pages link to
   https://www.weather.gov/disclaimer, which puts NWS web information in the public domain
   ("may be used without charge for any lawful purpose") as long as the use does not claim it,
   imply NOAA/NWS endorsement, or present modified content as official. Casa credits the
   source and shows the capture time. Details and the date checked: docs/dev/credits.md.

   The image is one 2880x300 JPEG: six 480x270 views around the buoy plus a 30 px caption
   strip at the bottom. Night captures are dark; the camera sometimes goes offline.

   User link: any direct http(s) image URL (JPEG, PNG, GIF or WebP), at most 2 MB, cached 5 minutes.
   The answer must say Content-Type image/* (when it sends one) and its first bytes must match one
   of those formats. Nothing is fetched until /api/webcam is called, and settings.webcamOn === false
   means no request at all. */
'use strict';

const U = require('./util.js');

const NDBC_LIST = 'https://www.ndbc.noaa.gov/buoycams.php';
const NDBC_IMG = 'https://www.ndbc.noaa.gov/images/buoycam/';
const STATION = '46026';
const DEFAULT_TTL = 15 * 60 * 1000;
const DEFAULT_STALE = 3 * 3600 * 1000;
const USER_TTL = 5 * 60 * 1000;
const USER_STALE = 30 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;

const DEFAULT_CREDIT = {
  credit: 'NOAA National Data Buoy Center, station 46026, 18 nm west of San Francisco',
  href: 'https://www.ndbc.noaa.gov/station_page.php?station=46026',
  licence: 'Public domain (U.S. Government work, NOAA/NWS)',
  terms: 'https://www.weather.gov/disclaimer',
};

function sniff(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

/* Width and height of a JPEG or PNG, or null. Reads headers only. */
function dimensions(bytes, type) {
  try {
    if (type === 'image/png' && bytes.length >= 24) {
      const w = (bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19]) >>> 0;
      const h = (bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23]) >>> 0;
      return { w: w, h: h };
    }
    if (type === 'image/jpeg') {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xFF) { i++; continue; }
        const m = bytes[i + 1];
        const len = bytes[i + 2] << 8 | bytes[i + 3];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
          return { h: bytes[i + 5] << 8 | bytes[i + 6], w: bytes[i + 7] << 8 | bytes[i + 8] };
        }
        i += 2 + len;
      }
    }
  } catch (e) { /* not fatal */ }
  return null;
}

async function fetchImage(c, url, label) {
  let res;
  try { res = await c.http(url, { method: 'GET', timeout: 15000 }); } catch (e) {
    throw U.httpError(502, 'Could not reach ' + label + ' (' + U.netReason(e) + ')');
  }
  if (res.status < 200 || res.status >= 300) throw U.httpError(502, label + ' answered HTTP ' + res.status);
  if (U.declaredTooLarge(res, MAX_BYTES)) throw U.httpError(413, 'The image from ' + label + ' is larger than 2 MB');
  const bytes = U.readBytes(res);
  if (!bytes || !bytes.length) throw U.httpError(502, label + ' sent an empty answer');
  if (bytes.length > MAX_BYTES) {
    throw U.httpError(413, 'The image from ' + label + ' is ' + (bytes.length / 1048576).toFixed(1) + ' MB; the limit is 2 MB');
  }
  const ctype = U.header(res, 'content-type').split(';')[0].trim().toLowerCase();
  if (ctype && ctype.indexOf('image/') !== 0) {
    throw U.httpError(422, ctype === 'text/html'
      ? 'That link is a web page, not an image. Paste a direct image link (for example one ending in .jpg).'
      : 'The link at ' + label + ' is not an image (Content-Type ' + ctype + ')');
  }
  const type = sniff(bytes);
  if (!type) {
    const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 200)).toLowerCase();
    if (head.indexOf('<html') !== -1 || head.indexOf('<!doctype') !== -1) {
      throw U.httpError(422, 'That link is a web page, not an image. Paste a direct image link (for example one ending in .jpg).');
    }
    throw U.httpError(422, 'The link at ' + label + ' is not a JPEG, PNG, GIF or WebP image');
  }
  const out = { src: 'data:' + type + ';base64,' + U.base64(bytes), type: type, bytes: bytes.length };
  const d = dimensions(bytes, type);
  if (d) { out.w = d.w; out.h = d.h; }
  return out;
}

/* "W49A_2026_11_09_1610.jpg" -> "2026-11-09T16:10:00.000Z" (NDBC stamps captions in UTC) */
function ndbcTime(name) {
  const m = /_(\d{4})_(\d{2})_(\d{2})_(\d{2})(\d{2})\.jpg$/i.exec(String(name || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])).toISOString();
}

async function defaultCam(c) {
  const list = await U.getJson(c, NDBC_LIST, 'NOAA BuoyCAM list');
  const st = Array.isArray(list) ? list.find((s) => String(s.id) === STATION) : null;
  if (!st) throw U.httpError(502, 'NOAA no longer lists BuoyCAM station ' + STATION);
  if (!st.img || !/^[A-Za-z0-9_]+\.jpg$/.test(st.img)) throw U.httpError(503, 'The San Francisco BuoyCAM is offline right now');
  const img = await fetchImage(c, NDBC_IMG + st.img, 'NOAA BuoyCAM');
  return Object.assign(img, DEFAULT_CREDIT, {
    at: ndbcTime(st.img), source: 'default', station: STATION, name: st.name,
    frames: 6, frameW: 480, frameH: 270, captionH: 30,
  });
}

function userUrl(raw) {
  return U.checkScheme(raw, 'The webcam link');
}

async function webcam(a, b) {
  const c = U.ctxOf(a, b);
  const s = c.settings;
  if (s.webcamOn === false) return U.reply(200, { off: true, reason: 'webcam is off' });
  const raw = typeof s.webcamUrl === 'string' ? s.webcamUrl.trim() : '';
  try {
    if (raw) {
      const u = userUrl(raw);
      const r = await U.cached(c, 'webcam:' + u.toString(), USER_TTL, USER_STALE, async () => {
        const img = await fetchImage(c, u.toString(), u.host);
        // the room gets the site, never the full link (it may carry a key)
        return Object.assign(img, { credit: u.host, href: u.origin + '/', source: 'user', at: new Date(c.now()).toISOString() });
      });
      return U.reply(200, r.stale ? Object.assign({}, r.value, { stale: true, age_min: r.ageMin }) : r.value);
    }
    const r = await U.cached(c, 'webcam:default', DEFAULT_TTL, DEFAULT_STALE, () => defaultCam(c));
    return U.reply(200, r.stale ? Object.assign({}, r.value, { stale: true, age_min: r.ageMin }) : r.value);
  } catch (e) {
    const out = { error: e.message, source: raw ? 'user' : 'default' };
    if (!raw) Object.assign(out, DEFAULT_CREDIT);
    return U.reply(e.status || 502, out);
  }
}

module.exports = { routes: { webcam: webcam }, sniff, dimensions, ndbcTime, DEFAULT_CREDIT, MAX_BYTES };
