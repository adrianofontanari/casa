/* /api/music: the lofi playlist for the headphones, plus the names of the synthesised ambient
   sounds (src/room/panels/ambient.js, no files).

   All tracks are by HoliznaCC0, released under CC0 1.0 (public domain dedication) on the
   Free Music Archive; licence checked on each track page on 2026-11-09 (docs/dev/credits.md).
   They were re-encoded from the 320 kbps MP3 originals to AAC 128 kbps (.m4a) with macOS
   afconvert to keep the download small. They are attached to the GitHub release `music-v1`
   of adrianofontanari/casa and streamed only when the user presses play: this route itself
   makes no request. settings.musicBase (dev only) points `src` at a local server instead. */
'use strict';

const U = require('./util.js');

const RELEASE = 'https://github.com/adrianofontanari/casa/releases/download/music-v1/';
const CC0 = 'CC0 1.0';
const CC0_HREF = 'https://creativecommons.org/publicdomain/zero/1.0/';
const FMA = 'https://freemusicarchive.org/music/holiznacc0/';

const TRACKS = [
  { file: 'holizna-snow-drift.m4a', title: 'Snow Drift', album: 'Winter Lofi', page: 'winter-lofi/snow-drift/', seconds: 174 },
  { file: 'holizna-fire-place.m4a', title: 'Fire Place', album: 'Winter Lofi', page: 'winter-lofi/fire-place/', seconds: 170 },
  { file: 'holizna-winter-blues.m4a', title: 'Winter Blues', album: 'Winter Lofi', page: 'winter-lofi/winter-blues/', seconds: 224 },
  { file: 'holizna-spring-at-last.m4a', title: 'Spring At Last', album: 'Spring at last (LOFI TAPE)', page: 'spring-at-last-lofi-tape/spring-at-last/', seconds: 137 },
  { file: 'holizna-april-showers.m4a', title: 'April Showers', album: 'Spring at last (LOFI TAPE)', page: 'spring-at-last-lofi-tape/april-showers/', seconds: 128 },
  { file: 'holizna-calm-currents.m4a', title: 'Calm Currents', album: 'Public Domain Lofi', page: 'public-domain-lofi/calm-currents-lofi-relax-calm/', seconds: 148 },
  { file: 'holizna-peaceful-drift.m4a', title: 'Peaceful Drift', album: 'Public Domain Lofi', page: 'public-domain-lofi/peaceful-drift-lofi-nostalgic-calm/', seconds: 128 },
  { file: 'holizna-ease-into-night.m4a', title: 'Ease into Night', album: 'Public Domain Lofi', page: 'public-domain-lofi/ease-into-night-lofi-relax-chill/', seconds: 152 },
];

const AMBIENT = ['sea', 'rain', 'fire', 'birds'];

function base(settings) {
  const b = settings && typeof settings.musicBase === 'string' ? settings.musicBase.trim() : '';
  if (!b) return RELEASE;
  try { U.checkScheme(b, 'musicBase'); } catch (e) { return RELEASE; }
  return b.endsWith('/') ? b : b + '/';
}

function list(settings) {
  const root = base(settings);
  return TRACKS.map((t) => ({
    title: t.title, artist: 'HoliznaCC0', album: t.album, src: root + t.file, type: 'audio/mp4',
    seconds: t.seconds, license: CC0, licenseHref: CC0_HREF, href: FMA + t.page,
  }));
}

async function music(a, b) {
  const c = U.ctxOf(a, b);
  if (c.settings.musicOn === false) return U.reply(200, { off: true, tracks: [], ambient: AMBIENT });
  return U.reply(200, {
    tracks: list(c.settings), ambient: AMBIENT,
    credit: 'Music by HoliznaCC0 (CC0, public domain), from the Free Music Archive',
    creditHref: FMA,
  });
}

module.exports = { routes: { music: music }, TRACKS, AMBIENT, RELEASE, list };
