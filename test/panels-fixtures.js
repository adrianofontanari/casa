/* Dev only (test/panels-preview.html). Loaded right after src/room/dev/mock-bridge.js:
   richer sample data for the panels, write operations that behave like the real routes
   (tasks rev and 412, post-it ops, quotes add, settings allowlist), the shell routes the
   mock lacks (open, link, open-settings), a call log (window.__calls) and failure
   injection: window.__casaFail = {route: status | 'offline'}. */
(function () {
  'use strict';
  const db = window.__mockDB;
  const base = window.fetch;
  const now = new Date();
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const day = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
  const at = (n, h, m) => { const d = day(n); d.setHours(h, m || 0, 0, 0); return d.toISOString(); };
  const monday = day(-((now.getDay() + 6) % 7));
  const wk = (i, h, m) => { const d = new Date(monday); d.setDate(d.getDate() + i); d.setHours(h, m || 0, 0, 0); return d.toISOString(); };
  const todayPath = 'Daily/' + iso(now) + '.md';

  // a short quiet tone as a WAV data URI, so the player works with no network
  function wav(freq) {
    const sr = 8000, n = sr * 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / sr * 2 * Math.PI * freq) * 600), true);
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
    return 'data:audio/wav;base64,' + btoa(bin);
  }


  // six sea views side by side over a caption band, like the default BuoyCAM picture
  const strip = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="2880" height="300" viewBox="0 0 288 30" shape-rendering="crispEdges">' +
    [0, 1, 2, 3, 4, 5].map((i) => '<g transform="translate(' + i * 48 + ',0)"><rect width="48" height="14" fill="' + ['#9cc3d6', '#a9c9d8', '#b6cfda', '#8fb6cc', '#9fc0d2', '#aac8d6'][i] + '"/>' +
      '<rect y="14" width="48" height="13" fill="#3f6d86"/><rect y="15" width="48" height="1" fill="#6d9bb2"/><rect x="' + (6 + i * 5) + '" y="18" width="' + (8 - i) + '" height="1" fill="#e4eef2"/>' +
      '<rect x="47" width="1" height="27" fill="#20262c"/></g>').join('') +
    '<rect y="27" width="288" height="3" fill="#20262c"/></svg>');
  Object.assign(db.focus, { focus: 'Finish the launch page', exists: true, date: iso(now), path: todayPath });
  db.tasks = {
    date: iso(now), rev: 'r1',
    today: [
      { id: 't1', text: 'Send the proposal to the studio', done: false, due: iso(now), path: todayPath, line: 6 },
      { id: 't2', text: 'Call the plumber', done: false, due: iso(now), path: todayPath, line: 7 },
      { id: 't3', text: 'Pay the electricity bill', done: true, due: iso(now), path: todayPath, line: 8 },
    ],
    upcoming: [
      { id: 't4', text: 'Book the flat for the trip', done: false, due: iso(day(1)), path: 'Projects/Trips.md', line: 3 },
      { id: 't5', text: 'Back up the photos', done: false, due: iso(day(1)), path: 'Projects/Home.md', line: 9 },
      { id: 't6', text: 'Return the library book', done: false, due: iso(day(3)), path: 'Projects/Home.md', line: 10 },
      { id: 't7', text: 'Read twice a week', done: false, path: 'Projects/Habits.md', line: 2 },
    ],
  };
  db.notes = { notes: [
    { id: 'n1', text: 'Call mum back', color: 'yellow', x: 0.04, y: 0.06 },
    { id: 'n2', text: 'Buy coffee beans', color: 'yellow', x: 0.34, y: 0.12 },
    { id: 'n3', text: 'Idea: a lamp that dims at 10 pm', color: 'blue', x: 0.78, y: 0.04 },
    { id: 'n4', text: 'Gym: Tue and Thu', color: 'green', x: 0.08, y: 0.62 },
    { id: 'n5', text: 'Book the flat by Friday', color: 'pink', x: 0.5, y: 0.55 },
    { id: 'n6', text: 'Water the plants', color: 'yellow', x: 0.9, y: 0.82 },
  ] };
  db.quotes = { quotes: ['Small steps still count.', 'Well begun is half done. - Aristotle', 'Adopt the pace of nature: her secret is patience. - Ralph Waldo Emerson'], path: 'Casa/Quotes.md', exists: true };
  db.weather = {
    temp: 18, code: 2, day: true, feels: 17, hum: 62, press: 1016, uv: 2.8, uv_band: 'low', cloud: 40,
    wind: { kmh: 14, gust: 24, dir: 'NW', speed: 14, gustSpeed: 24, unit: 'km/h' },
    sun: { rise: '07:21', set: '17:24', rise_h: 7.35, set_h: 17.4 }, moon: { phase: 0.47, illum: 0.97 },
    where: { name: 'Lisbon', lat: 38.72, lon: -9.14 }, units: { temp: '°C', wind: 'km/h', press: 'hPa' },
    observed: at(0, now.getHours()), credit: 'Weather data by Open-Meteo.com', creditHref: 'https://open-meteo.com/',
  };
  const curve = [13, 13, 14, 15, 16, 17, 18, 19, 19, 19, 18, 17, 16, 15, 14, 14, 13, 13, 12, 12, 12, 12, 12, 13];
  const pops = [0, 0, 0, 5, 5, 10, 10, 5, 0, 0, 0, 20, 35, 40, 20, 10, 0, 0, 0, 0, 0, 0, 0, 0];
  db.forecast = {
    hourly: curve.map((t, i) => { const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + i); return { t: d.toISOString(), temp: t, code: pops[i] > 30 ? 61 : 2, pop: pops[i] }; }),
    daily: [[12, 19, 2, 10], [13, 20, 2, 0], [12, 17, 61, 70], [11, 18, 3, 20], [12, 21, 0, 0]].map((v, i) => ({ date: iso(day(i)), min: v[0], max: v[1], code: v[2], pop: v[3], sunrise: '07:21', sunset: '17:24' })),
    units: { temp: '°C', wind: 'km/h' },
  };
  db.air = {
    aqi: 28, scale: 'eu', band: 'fair', st: 'ok', pm25: 7.2, pm10: 16, o3: 58, no2: 14.5, unit: 'µg/m³', source: 'open-meteo', at: at(0, now.getHours()),
    credit: 'Air quality: Copernicus Atmosphere Monitoring Service (CAMS) via Open-Meteo.com', creditHref: 'https://open-meteo.com/en/docs/air-quality-api',
    licence: 'CC BY 4.0', licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
    notice: 'Contains modified Copernicus Atmosphere Monitoring Service information ' + now.getFullYear() + '. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.',
    sensor: { aqi: 8, scale: 'eu', band: 'good', st: 'ok', approx: true, pm25: 4.1, pm10: 6.2, temp: 21.4, hum: 48, co2: 620, source: 'sensor', credit: 'Your sensor (airgradient)', at: at(0, now.getHours()) },
  };
  db.webcam = { src: strip, type: 'image/svg+xml', w: 2880, h: 300, frames: 6, frameW: 480, frameH: 270, captionH: 30, name: 'Sample buoy',
    credit: 'Sample webcam strip (drawn for the preview)', href: 'https://example.com/', at: at(0, now.getHours()), source: 'default' };
  db.calendar = {
    events: [
      [0, 9, 30, 9, 45, 'Team stand-up', 'Work'], [1, 9, 30, 9, 45, 'Team stand-up', 'Work'], [2, 9, 30, 9, 45, 'Team stand-up', 'Work'], [3, 9, 30, 9, 45, 'Team stand-up', 'Work'],
      [0, 14, 0, 15, 30, 'Design review', 'Work'], [1, 12, 0, 12, 45, 'Dentist', 'Personal'], [1, 15, 0, 17, 0, 'Write the proposal', 'Work'],
      [2, 18, 0, 19, 0, 'Laundry', 'Family'], [3, 19, 0, 20, 0, 'Gym', 'Personal'], [0, 19, 0, 20, 0, 'Gym', 'Personal'],
      [4, 10, 0, 12, 0, 'Demo day', 'Work'], [4, 20, 0, 22, 30, 'Dinner with friends', 'Personal'], [5, 10, 0, 11, 30, 'Farmers market', 'Personal'],
      [5, 18, 30, 19, 15, 'Weekly review', 'Personal'], [6, 12, 30, 14, 30, 'Family lunch', 'Family'], [6, 16, 0, 17, 30, 'Long walk', 'Personal'],
      [2, 10, 0, 11, 0, '1:1 with Sam', 'Work'], [2, 10, 30, 11, 30, 'Budget check', 'Work'],
    ].map((e) => ({ title: e[5], start: wk(e[0], e[1], e[2]), end: wk(e[0], e[3], e[4]), allDay: false, cal: e[6], color: { Work: '#c4553b', Personal: '#3f6cb0', Family: '#3b7a4c' }[e[6]] }))
      .concat([{ title: 'Public holiday', start: iso(new Date(wk(5, 0))), end: iso(new Date(wk(6, 0))), allDay: true, cal: 'Family', color: '#3b7a4c' }]),
    cals: [{ name: 'Personal', color: '#3f6cb0' }, { name: 'Work', color: '#c4553b' }, { name: 'Family', color: '#3b7a4c' }],
    error: null,
  };
  db.settings.calendarUrl = 'https://calendar.example.com/private.ics';
  db.music = {
    tracks: [
      { title: 'Morning Desk', artist: 'Sample Artist', album: 'Preview Tape', src: wav(220), type: 'audio/wav', seconds: 2, license: 'CC0 1.0', licenseHref: 'https://creativecommons.org/publicdomain/zero/1.0/', href: 'https://example.com/' },
      { title: 'Slow Window', artist: 'Sample Artist', album: 'Preview Tape', src: wav(262), type: 'audio/wav', seconds: 2, license: 'CC0 1.0', licenseHref: 'https://creativecommons.org/publicdomain/zero/1.0/', href: 'https://example.com/' },
      { title: 'Rain Check', artist: 'Sample Artist', album: 'Preview Tape', src: wav(196), type: 'audio/wav', seconds: 2, license: 'CC0 1.0', licenseHref: 'https://creativecommons.org/publicdomain/zero/1.0/', href: 'https://example.com/' },
    ],
    ambient: ['sea', 'rain', 'fire', 'birds'],
    credit: 'Sample tracks made for the preview', creditHref: 'https://example.com/',
  };
  db.onboarding.done = true;

  const ROOM_SETTINGS = ['calm', 'buddy', 'units', 'musicOn', 'webcamOn', 'airOn', 'onboarded', 'city'];
  let seq = 100;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  window.__calls = [];
  window.__casaFail = {};

  function tasksOp(b) {
    if (b.rev !== db.tasks.rev) return json(412, { error: 'stale' });
    const all = db.tasks.today.concat(db.tasks.upcoming);
    const t = all.find((x) => x.id === b.id);
    if (b.op === 'toggle') { if (!t) return json(404, { error: 'task not found' }); t.done = !t.done; }
    else if (b.op === 'edit') { if (!t) return json(404, { error: 'task not found' }); t.text = String(b.text); }
    else if (b.op === 'add') { db.tasks.today.push({ id: 't' + (++seq), text: String(b.text), done: false, due: db.tasks.date, path: todayPath, line: 20 + seq }); }
    else return json(400, { error: 'unknown op' });
    db.tasks.rev = 'r' + (++seq);
    return json(200, { ok: true, rev: db.tasks.rev });
  }
  function notesOp(b) {
    const list = db.notes.notes;
    const i = list.findIndex((n) => n.id === b.id);
    if (b.op === 'add') {
      if (!String(b.text || '').trim()) return json(400, { error: 'text is empty' });
      list.push({ id: 'n' + (++seq), text: String(b.text), color: b.color || 'yellow', x: typeof b.x === 'number' ? b.x : 0.4, y: typeof b.y === 'number' ? b.y : 0.4 });
    } else if (i === -1) return json(404, { error: 'post-it not found' });
    else if (b.op === 'delete') list.splice(i, 1);
    else if (b.op === 'edit') { if (!String(b.text || '').trim()) return json(400, { error: 'text is empty' }); list[i].text = String(b.text); }
    else if (b.op === 'move') { list[i].x = b.x; list[i].y = b.y; }
    else return json(400, { error: 'unknown op' });
    return json(200, db.notes);
  }

  window.fetch = async (url, opts) => {
    const u = new URL(url, 'http://casa.local');
    if (!u.pathname.startsWith('/api/')) return base(url, opts);
    const route = u.pathname.slice(5);
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    let body = null;
    try { body = opts && opts.body ? JSON.parse(opts.body) : null; } catch (e) { body = null; }
    window.__calls.push({ route, method, body, query: Object.fromEntries(u.searchParams) });
    const f = window.__casaFail[route];
    if (f === 'offline') throw new TypeError('Failed to fetch');
    if (typeof f === 'number') return json(f, { error: 'Simulated status ' + f });
    if (route === 'open' || route === 'link' || route === 'open-settings') return json(200, { ok: true });
    if (method === 'POST') {
      if (route === 'tasks') return tasksOp(body || {});
      if (route === 'notes') return notesOp(body || {});
      if (route === 'quotes') {
        if (!body || body.op !== 'add' || !String(body.text || '').trim()) return json(400, { error: 'bad request' });
        db.quotes.quotes.push(String(body.text)); db.quotes.exists = true;
        return json(200, db.quotes);
      }
      if (route === 'settings') {
        const ignored = [];
        Object.keys(body || {}).forEach((k) => { if (ROOM_SETTINGS.indexOf(k) !== -1) db.settings[k] = body[k]; else ignored.push(k); });
        return json(200, Object.assign({}, db.settings, ignored.length ? { ignored } : {}));
      }
      if (route === 'state') { Object.assign(db.state, body || {}); return json(200, { ok: true, state: db.state }); }
    }
    return base(url, opts);
  };
})();
