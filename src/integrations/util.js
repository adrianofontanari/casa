/* Shared helpers for the integration routes.

   Every route handler is called by the plugin router as handler(req, ctx), where
   req = {route, method, query, body} and ctx carries {http, getSettings() | settings, cache?}.
   Unit tests may pass one merged object instead; ctxOf() accepts both forms. */
'use strict';

const memo = new Map();

function ctxOf(a, b) {
  const req = a || {};
  const ctx = b || {};
  const settings = typeof ctx.getSettings === 'function' ? ctx.getSettings()
    : (ctx.settings || req.settings || {});
  return {
    query: req.query || ctx.query || {},
    body: req.body !== undefined ? req.body : ctx.body,
    settings: settings || {},
    http: ctx.http || req.http,
    cache: pickCache(ctx.cache || req.cache),
    now: typeof (ctx.now || req.now) === 'function' ? (ctx.now || req.now) : () => Date.now(),
  };
}

function pickCache(c) {
  return c && typeof c.get === 'function' && typeof c.set === 'function' ? c : memo;
}

function reply(status, json) { return { status: status, json: json }; }

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* Run load() at most once per ttl for a key. When load() fails, an older value is
   served for up to `stale` ms and marked {stale:true, ageMin}; past that the error is thrown. */
async function cached(c, key, ttl, stale, load) {
  const now = c.now();
  const hit = c.cache.get(key);
  const force = !!(c.query && (c.query.refresh === '1' || c.query.refresh === true));
  if (hit && !force && now - hit.at < ttl) return { value: hit.value, at: hit.at };
  try {
    const value = await load();
    c.cache.set(key, { at: now, value: value });
    return { value: value, at: now };
  } catch (e) {
    if (hit && now - hit.at < stale) {
      return { value: hit.value, at: hit.at, stale: true, ageMin: Math.floor((now - hit.at) / 60000), error: e };
    }
    throw e;
  }
}

function readJson(res) {
  let v;
  try { v = typeof res.json === 'function' ? res.json() : res.json; } catch (e) { v = null; }
  if (v === undefined || v === null) {
    try { v = JSON.parse(readText(res)); } catch (e) { v = null; }
  }
  return v;
}

function readText(res) {
  try { const t = typeof res.text === 'function' ? res.text() : res.text; return typeof t === 'string' ? t : ''; } catch (e) { return ''; }
}

function readBytes(res) {
  let ab;
  try { ab = typeof res.arrayBuffer === 'function' ? res.arrayBuffer() : res.arrayBuffer; } catch (e) { ab = null; }
  if (!ab) return null;
  return ab instanceof Uint8Array ? ab : new Uint8Array(ab);
}

async function getJson(c, url, what) {
  if (typeof c.http !== 'function') throw httpError(500, 'No http client');
  let res;
  try { res = await c.http(url, { method: 'GET' }); } catch (e) {
    throw httpError(502, (what || 'Service') + ' is unreachable (' + netReason(e) + ')');
  }
  if (!res || res.status < 200 || res.status >= 300) {
    const j = res ? readJson(res) : null;
    const why = j && (j.reason || j.error) ? ': ' + String(j.reason || j.error).slice(0, 160) : '';
    throw httpError(502, (what || 'Service') + ' answered HTTP ' + (res ? res.status : '?') + why);
  }
  const j = readJson(res);
  if (j === null) throw httpError(502, (what || 'Service') + ' did not answer with JSON');
  return j;
}

function header(res, name) {
  const h = (res && res.headers) || {};
  if (typeof h.get === 'function') return h.get(name) || '';
  const want = name.toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === want) return String(h[k]);
  return '';
}

/* Only http: and https: leave the plugin (webcal: is rewritten to https: by the ICS code). */
function checkScheme(raw, what) {
  let u;
  try { u = new URL(String(raw).trim()); } catch (e) { throw httpError(400, what + ' is not a valid URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw httpError(400, what + ' must start with https:// or http://');
  return u;
}

/* Remove anything that looks like a link from a message that may reach the room: calendar
   and sensor links can carry secrets (private ICS addresses, API keys, tokens). */
function scrub(msg) {
  return String(msg).replace(/[a-z][a-z0-9+.-]*:\/\/[a-z0-9[]\S*/gi, '[link]');
}

function shortError(e) {
  const m = scrub(String((e && e.message) || e || 'error'));
  return m.length > 160 ? m.slice(0, 157) + '...' : m;
}

/* A fixed, link-free reason for a network failure. */
function netReason(e) {
  const m = String((e && (e.code || '') + ' ' + (e.message || '')) || e || '');
  if (/timed? ?out|timeout|ETIMEDOUT|ERR_TIMED_OUT|aborted/i.test(m)) return 'timed out';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|NAME_NOT_RESOLVED|resolve/i.test(m)) return 'server not found';
  if (/CERT|SSL|TLS/i.test(m)) return 'secure connection failed';
  if (/ECONNREFUSED|CONNECTION_REFUSED/i.test(m)) return 'connection refused';
  return 'unreachable';
}

/* Refuse an answer whose declared Content-Length is above `max` bytes. Obsidian's requestUrl
   buffers the whole body before it resolves, so this check saves the parsing, not the download;
   callers still check the real size after reading. */
function declaredTooLarge(res, max) {
  const n = parseInt(header(res, 'content-length'), 10);
  return Number.isFinite(n) && n > max;
}

function num(v, digits) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (!digits) return Math.round(n);
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) { const n = bytes[i] << 16; out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + '=='; }
  else if (rest === 2) { const n = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + '='; }
  return out;
}

/* Hide the secret part of a URL (calendar and sensor links work like passwords). */
function maskUrl(u) {
  try {
    const x = new URL(String(u).replace(/^webcal:/i, 'https:'));
    return x.protocol + '//' + x.host + '/...';
  } catch (e) { return '(invalid link)'; }
}

module.exports = { scrub, netReason, declaredTooLarge, header, checkScheme, ctxOf, reply, httpError, cached, getJson, readJson, readText, readBytes, num, base64, maskUrl, shortError, memo };
