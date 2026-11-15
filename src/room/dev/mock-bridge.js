/* Dev only, never bundled into main.js. Load it before the room scripts in a preview page
   (test/room-preview.html) to answer the room's fetch('/api/...') calls with sample data
   shaped like CONTRACT.md. Owners of a route may extend these fixtures in place. */
(function () {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const at = (h, m) => { const d = new Date(today); d.setHours(h, m || 0, 0, 0); return d.toISOString(); };
  const plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
  const db = {
    focus: { focus: 'Finish the launch page', exists: true, date: iso(today), path: 'Daily/' + iso(today) + '.md' },
    tasks: {
      date: iso(today), rev: 'r1',
      today: [
        { id: 't1', text: 'Reply to the studio about Thursday', done: false, due: iso(today), path: 'Daily/' + iso(today) + '.md', line: 6 },
        { id: 't2', text: 'Buy coffee beans', done: true, due: iso(today), path: 'Daily/' + iso(today) + '.md', line: 7 },
        { id: 't3', text: 'Plan the week', done: false, due: iso(today), path: 'Projects/Home.md', line: 12 },
      ],
      upcoming: [{ id: 't4', text: 'Book the flat for the trip', done: false, due: plus(2), path: 'Projects/Trips.md', line: 3 }],
    },
    notes: { notes: [{ id: 'n1', text: 'Call mum back', color: 'yellow', x: 0.2, y: 0.3 }, { id: 'n2', text: 'Water the plants', color: 'pink', x: 0.6, y: 0.5 }] },
    quotes: { quotes: ['Well begun is half done.', 'The best way out is always through.'], path: 'Casa/Quotes.md' },
    onboarding: { daily: { source: 'core', folder: 'Daily', format: 'YYYY-MM-DD', template: '' }, city: null, calendar: false, done: false },
    settings: { calm: false, buddy: true, units: 'metric', city: { name: 'Lisbon', lat: 38.72, lon: -9.14 }, calendarUrl: '', webcamUrl: '', airUrl: '', musicOn: true, onboarded: true },
    state: {},
    weather: { temp: 18, code: 2, day: true, feels: 17, hum: 60, wind: 9, press: 1016, uv: 3, cloud: 40, where: { name: 'Lisbon', lat: 38.72, lon: -9.14 } },
    forecast: { hourly: [8, 11, 14, 17, 20].map((h) => ({ t: at(h), temp: 14 + (h % 7), code: 2, pop: 10 })), daily: [0, 1, 2, 3, 4].map((n) => ({ date: plus(n), min: 12, max: 20 - n, code: n % 3, pop: 10 * n, sunrise: '07:20', sunset: '17:30' })) },
    geocode: { results: [{ name: 'Lisbon', country: 'Portugal', admin1: 'Lisbon', lat: 38.72, lon: -9.14 }] },
    air: { aqi: 28, scale: 'eu', band: 'good', pm25: 6, pm10: 11, o3: 60, no2: 9, source: 'open-meteo', credit: 'Copernicus CAMS via Open-Meteo', at: at(today.getHours()) },
    webcam: { off: true },
    calendar: { events: [{ title: 'Standup', start: at(9, 30), end: at(9, 45), allDay: false, cal: 'Work', color: '#4f7fd9' }, { title: 'Dentist', start: at(16), end: at(17), allDay: false, cal: 'Home', color: '#d97a4f' }], cals: [{ name: 'Work', color: '#4f7fd9' }, { name: 'Home', color: '#d97a4f' }], error: null },
    music: { tracks: [], ambient: ['sea', 'rain', 'fire', 'birds'] },
  };
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.__mockDB = db;
  window.fetch = async (url, opts) => {
    const u = new URL(url, 'http://casa.local');
    if (!u.pathname.startsWith('/api/')) return real ? real(url, opts) : new Response('', { status: 404 });
    const route = u.pathname.slice(5);
    const method = (opts && opts.method) || 'GET';
    if (!(route in db)) return new Response(JSON.stringify({ error: 'unknown route ' + route }), { status: 404 });
    if (method !== 'GET' && opts && opts.body) {
      try { const b = JSON.parse(opts.body); if (route === 'focus' && 'focus' in b) db.focus.focus = b.focus; else if (route === 'state' || route === 'settings') Object.assign(db[route], b); } catch (e) {}
      return new Response(JSON.stringify(route === 'tasks' ? { ok: true, rev: 'r2' } : db[route]), { status: 200 });
    }
    return new Response(JSON.stringify(db[route]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
})();
