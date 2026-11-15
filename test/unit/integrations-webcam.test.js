'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./integrations-helpers.js');
const C = require('../../src/integrations/webcam.js');

// 1x1 PNG and a tiny JPEG header with a SOF0 marker (2880x300)
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const JPEG = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0x2C, 0x0B, 0x40, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9]);
const LIST = [{ id: '41004', img: 'Z20A_2026_11_09_1610.jpg' }, { id: '46026', name: 'SAN FRANCISCO - 18NM West of San Francisco, CA', img: 'W49A_2026_11_09_1610.jpg', width: 2880, height: 300 }];

test('webcam: image sniffing and sizes', () => {
  assert.equal(C.sniff(PNG), 'image/png');
  assert.equal(C.sniff(JPEG), 'image/jpeg');
  assert.equal(C.sniff(new TextEncoder().encode('<!doctype html><html>')), null);
  assert.deepEqual(C.dimensions(PNG, 'image/png'), { w: 1, h: 1 });
  assert.deepEqual(C.dimensions(JPEG, 'image/jpeg'), { w: 2880, h: 300 });
  assert.equal(C.ndbcTime('W49A_2026_11_09_1610.jpg'), '2026-11-09T16:10:00.000Z');
});

test('webcam: off makes zero requests, and nothing is fetched until the route is called', async () => {
  const http = H.fakeHttp({});
  const r = await C.routes.webcam({}, H.ctx({ webcamOn: false, webcamUrl: 'https://cam.example/x.jpg' }, http));
  assert.deepEqual(r.json, { off: true, reason: 'webcam is off' });
  assert.equal(http.calls.length, 0);
});

test('webcam: default NOAA BuoyCAM 46026 as a data URL with credit and time', async () => {
  const http = H.fakeHttp({
    'https://www.ndbc.noaa.gov/buoycams.php': { json: LIST },
    'https://www.ndbc.noaa.gov/images/buoycam/W49A_2026_11_09_1610.jpg': { bytes: JPEG, headers: { 'Content-Type': 'image/jpeg' } },
  });
  const c = H.ctx({}, http);
  const r = await C.routes.webcam({}, c);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.src, /^data:image\/jpeg;base64,\/9j\//);
  assert.equal(r.json.at, '2026-11-09T16:10:00.000Z');
  assert.match(r.json.credit, /NOAA National Data Buoy Center, station 46026/);
  assert.equal(r.json.terms, 'https://www.weather.gov/disclaimer');
  assert.equal(r.json.frames, 6);
  await C.routes.webcam({}, c);
  assert.equal(http.calls.length, 2, 'cached: the second call makes no request');
});

test('webcam: offline buoy camera gives a clear error', async () => {
  const http = H.fakeHttp({ 'https://www.ndbc.noaa.gov/buoycams.php': { json: [{ id: '46026', img: null }] } });
  const r = await C.routes.webcam({}, H.ctx({}, http));
  assert.equal(r.status, 503);
  assert.match(r.json.error, /offline/);
});

test('webcam: pasted link checks scheme, content type, format and the 2 MB cap', async () => {
  const big = new Uint8Array(2 * 1024 * 1024 + 1); big.set(JPEG.subarray(0, 4));
  const http = H.fakeHttp({
    'https://cam.example/ok.png': { bytes: PNG, headers: { 'content-type': 'image/png' } },
    'https://cam.example/noheader.jpg': { bytes: JPEG },
    'https://cam.example/page': { text: '<!DOCTYPE html><html><body>cam</body></html>', headers: { 'content-type': 'text/html; charset=utf-8' } },
    'https://cam.example/liar.jpg': { bytes: PNG, headers: { 'content-type': 'application/json' } },
    'https://cam.example/svg': { text: '<svg xmlns="http://www.w3.org/2000/svg"/>', headers: { 'content-type': 'image/svg+xml' } },
    'https://cam.example/big.jpg': { bytes: big, headers: { 'content-type': 'image/jpeg' } },
    'https://cam.example/404.jpg': { status: 404, text: 'missing' },
    'https://cam.example/declared.jpg': { bytes: JPEG, headers: { 'content-type': 'image/jpeg', 'content-length': String(3 * 1024 * 1024) } },
    'https://cam.example/token.jpg': new Error('net::ERR_CONNECTION_REFUSED https://cam.example/token.jpg?key=SECRETKEY'),
  });
  const ok = await C.routes.webcam({}, H.ctx({ webcamUrl: 'https://cam.example/ok.png' }, http));
  assert.equal(ok.status, 200);
  assert.match(ok.json.src, /^data:image\/png;base64,iVBOR/);
  assert.equal(ok.json.credit, 'cam.example');
  assert.equal(ok.json.href, 'https://cam.example/', 'only the site, not the full link');
  assert.equal(ok.json.source, 'user');
  assert.equal((await C.routes.webcam({}, H.ctx({ webcamUrl: 'https://cam.example/noheader.jpg' }, http))).status, 200, 'no Content-Type: the bytes decide');
  const cases = [
    ['https://cam.example/page', 422, /web page, not an image/],
    ['https://cam.example/liar.jpg', 422, /not an image \(Content-Type application\/json\)/],
    ['https://cam.example/svg', 422, /not a JPEG, PNG, GIF or WebP/],
    ['https://cam.example/big.jpg', 413, /limit is 2 MB/],
    ['https://cam.example/404.jpg', 502, /answered HTTP 404/],
    ['https://cam.example/declared.jpg', 413, /larger than 2 MB/],
    ['https://cam.example/token.jpg?key=SECRETKEY', 502, /^Could not reach cam\.example \(connection refused\)$/],
    ['https://cam.invalid/x.jpg', 502, /Could not reach cam\.invalid/],
    ['file:///Users/me/cam.jpg', 400, /must start with https:\/\/ or http:\/\//],
    ['data:image/png;base64,AAAA', 400, /must start with https:\/\/ or http:\/\//],
    ['javascript:alert(1)', 400, /must start with https:\/\/ or http:\/\//],
  ];
  for (const [url, status, re] of cases) {
    const r = await C.routes.webcam({}, H.ctx({ webcamUrl: url }, http));
    assert.equal(r.status, status, url + ' -> ' + JSON.stringify(r.json));
    assert.match(r.json.error, re);
    assert.equal(JSON.stringify(r.json).indexOf('SECRETKEY'), -1);
  }
  assert.ok(!http.calls.some((u) => /^(file|data|javascript):/.test(u)), 'rejected schemes are never fetched');
});

test('LIVE: NOAA BuoyCAM 46026 (default) and a pasted image link', { skip: !H.LIVE && 'set LIVE=1' }, async () => {
  const log = [];
  const http = H.nodeHttp(log);
  const r = await C.routes.webcam({}, H.ctx({}, http));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.src, /^data:image\/jpeg;base64,/);
  assert.equal(r.json.w, 2880);
  assert.equal(r.json.h, 300);
  const ageH = (Date.now() - Date.parse(r.json.at)) / 3600000;
  assert.ok(ageH >= 0 && ageH < 12, 'capture is recent: ' + r.json.at);
  const bytes = Buffer.from(r.json.src.split(',')[1], 'base64');
  H.saveEvidence('live-webcam-ndbc-46026.jpg', bytes);
  // the same public-domain image pasted as a user link
  const direct = log.find((u) => u.indexOf('/images/buoycam/') !== -1);
  const u = await C.routes.webcam({}, H.ctx({ webcamUrl: direct }, http));
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.equal(u.json.source, 'user');
  const page = await C.routes.webcam({}, H.ctx({ webcamUrl: 'https://www.ndbc.noaa.gov/station_page.php?station=46026' }, http));
  assert.equal(page.status, 422);
  H.saveEvidence('live-webcam.json', { checked: new Date().toISOString(), requests: log,
    default: Object.assign({}, r.json, { src: r.json.src.slice(0, 40) + '...' }), pasted: Object.assign({}, u.json, { src: u.json.src.slice(0, 40) + '...' }), webPage: page.json });
});
