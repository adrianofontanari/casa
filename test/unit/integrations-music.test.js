'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./integrations-helpers.js');
const M = require('../../src/integrations/music.js');

const DIR = path.join(__dirname, '..', '..', 'assets', 'music');

test('music: list shape, release URLs, musicOn off', async () => {
  const http = H.fakeHttp({});
  const r = await M.routes.music({}, H.ctx({}, http));
  assert.equal(r.json.tracks.length, 8);
  assert.deepEqual(r.json.ambient, ['sea', 'rain', 'fire', 'birds']);
  for (const t of r.json.tracks) {
    for (const k of ['title', 'artist', 'src', 'license', 'href']) assert.ok(t[k], k);
    assert.match(t.src, /^https:\/\/github\.com\/adrianofontanari\/casa\/releases\/download\/music-v1\/holizna-[a-z-]+\.m4a$/);
    assert.equal(t.license, 'CC0 1.0');
    assert.match(t.href, /^https:\/\/freemusicarchive\.org\/music\/holiznacc0\//);
  }
  const off = await M.routes.music({}, H.ctx({ musicOn: false }, http));
  assert.deepEqual(off.json.tracks, []);
  assert.equal(off.json.off, true);
  const dev = await M.routes.music({}, H.ctx({ musicBase: 'http://127.0.0.1:8765/music' }, http));
  assert.equal(dev.json.tracks[0].src, 'http://127.0.0.1:8765/music/holizna-snow-drift.m4a');
  const bad = await M.routes.music({}, H.ctx({ musicBase: 'file:///tmp' }, http));
  assert.match(bad.json.tracks[0].src, /^https:\/\/github\.com\//, 'non-http base falls back to the release');
  assert.equal(http.calls.length, 0, 'the list itself makes no request');
});

test('music: every listed file is on disk as AAC in an MP4 container, total under 25 MB', { skip: !fs.existsSync(DIR) && 'assets/music not present (release assets)' }, () => {
  let total = 0;
  for (const t of M.TRACKS) {
    const p = path.join(DIR, t.file);
    assert.ok(fs.existsSync(p), t.file);
    const b = fs.readFileSync(p);
    assert.equal(b.subarray(4, 8).toString('latin1'), 'ftyp', t.file + ' is an MP4/M4A file');
    total += b.length;
  }
  assert.ok(total < 25 * 1024 * 1024, 'total ' + (total / 1048576).toFixed(1) + ' MB');
});

test('LIVE: each track page on the Free Music Archive still states CC0 1.0', { skip: !H.LIVE && 'set LIVE=1' }, async () => {
  const http = H.nodeHttp();
  const seen = [];
  for (const t of M.list({})) {
    const res = await http(t.href, { timeout: 30000 });
    assert.equal(res.status, 200, t.href);
    const html = res.text;
    const ok = /licensed under a\s*<a[^>]*href="https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/"/.test(html) && html.indexOf('CC0 1.0 Universal') !== -1;
    assert.ok(ok, 'CC0 statement on ' + t.href);
    assert.ok(html.indexOf('HoliznaCC0') !== -1);
    seen.push({ title: t.title, page: t.href, statement: 'licensed under a CC0 1.0 Universal License' });
  }
  H.saveEvidence('live-music-licences.json', { checked: new Date().toISOString(), tracks: seen });
});
