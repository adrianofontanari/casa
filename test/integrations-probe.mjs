// Integration checks that only real Obsidian can answer, run in the harness's sandboxed instance
// (test/harness/launch.mjs: separate profile, the developer's Obsidian is untouched):
//   1. navigator.getBattery exists inside the room iframe (Electron/Chromium)
//   2. Obsidian's Chromium decodes the shipped AAC .m4a music files
//   3. the room's CSP lets an <audio> element stream an https audio file
//   4. CPU of the whole Obsidian process tree: room idle, ambient synth running, ambient stopped
//      (AudioContext suspended). All audio is muted or at gain 0: nothing is heard.
//
//   node test/integrations-probe.mjs [--vault empty] [--seconds 15]
// Writes test/evidence/obsidian-probe.json.
import fs from 'node:fs';
import path from 'node:path';
import { launch, parseArgs, log, sleep, guard, treeOf, cpuSeconds, processTable, REPO } from './harness/launch.mjs';
import { Room } from './harness/run.mjs';

const args = parseArgs(process.argv.slice(2), { vault: 'empty', seconds: 15 });
const SECONDS = +args.seconds;
// a CC0 track (HoliznaCC0, "Snow Drift") on the Free Music Archive's file server: any https audio works
const HTTPS_AUDIO = 'https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/K0WPofXI9S27E24ORSKxrYhlyFe2g7zldVkmR6KF.mp3';
const M4A = path.join(REPO, 'assets', 'music', 'holizna-april-showers.m4a');

const cpuOf = (pid) => treeOf(pid, processTable()).reduce((s, p) => s + cpuSeconds(p.time), 0);
async function measure(s, seconds) {
  const a = cpuOf(s.main), t = Date.now();
  await sleep(seconds * 1000);
  const b = cpuOf(s.main), wall = (Date.now() - t) / 1000;
  return { cpuSeconds: +(b - a).toFixed(2), wallSeconds: +wall.toFixed(1), percentOfOneCore: +((b - a) / wall * 100).toFixed(1) };
}

let s = null;
const limit = guard(() => s, 300);
const out = { checked: new Date().toISOString() };
try {
  s = await launch({ vault: args.vault });
  const csp = [];
  s.page.on('console', (m) => { if (/Content.Security.Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  const room = new Room(s, null);
  await room.open({ via: 'command' });
  const f = room.frame();
  await sleep(3000);
  out.obsidian = await s.page.evaluate(() => ({ ua: navigator.userAgent }));
  out.roomCsp = await f.evaluate(() => { const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]'); return m ? m.content : null; });

  // the integration routes through the real plugin and Obsidian's requestUrl (sandbox settings only)
  out.routes = await s.page.evaluate(async () => {
    const p = app.plugins.plugins.casa;
    p.updateSettings({ city: { name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
      calendarUrl: 'webcal://calendars.icloud.com/holidays/us_en.ics', webcamOn: true, airOn: true, musicOn: true });
    const r = {};
    const pick = (j, keys) => Object.fromEntries(keys.filter((k) => j && k in j).map((k) => [k, j[k]]));
    let x = await p.callRoute('geocode', 'GET', { q: 'Lisbon' }); r.geocode = { status: x.status, first: x.json.results && x.json.results[0] };
    x = await p.callRoute('weather', 'GET', {}); r.weather = { status: x.status, ...pick(x.json, ['temp', 'code', 'code_hour', 'sun', 'where', 'error']) };
    x = await p.callRoute('forecast', 'GET', {}); r.forecast = { status: x.status, daily: (x.json.daily || []).length, hourly: (x.json.hourly || []).length };
    x = await p.callRoute('air', 'GET', {}); r.air = { status: x.status, ...pick(x.json, ['aqi', 'scale', 'band', 'pm25', 'error']) };
    x = await p.callRoute('webcam', 'GET', {}); r.webcam = { status: x.status, srcStart: (x.json.src || '').slice(0, 30), srcLength: (x.json.src || '').length, ...pick(x.json, ['w', 'h', 'at', 'credit', 'error']) };
    x = await p.callRoute('calendar', 'GET', { from: '2026-11-01', to: '2026-12-31' }); r.calendar = { status: x.status, events: (x.json.events || []).length, cals: x.json.cals, error: x.json.error };
    x = await p.callRoute('music', 'GET', {}); r.music = { status: x.status, tracks: (x.json.tracks || []).length };
    p.updateSettings({ webcamOn: false }); x = await p.callRoute('webcam', 'GET', {}); r.webcamOff = x.json;
    return r;
  });
  log('routes', JSON.stringify(out.routes).slice(0, 600));

  out.battery = await f.evaluate(async () => {
    if (typeof navigator.getBattery !== 'function') return { exists: false };
    try { const b = await navigator.getBattery(); return { exists: true, level: b.level, charging: b.charging }; } catch (e) { return { exists: true, error: String(e) }; }
  });
  log('battery', JSON.stringify(out.battery));

  const b64 = fs.readFileSync(M4A).toString('base64');
  out.aacDecode = await f.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ac = new AudioContext();
    try { const buf = await ac.decodeAudioData(bin.buffer); return { ok: true, seconds: +buf.duration.toFixed(1), sampleRate: buf.sampleRate, channels: buf.numberOfChannels }; }
    catch (e) { return { ok: false, error: String(e) }; } finally { await ac.close(); }
  }, b64);
  out.aacCanPlayType = await f.evaluate(() => new Audio().canPlayType('audio/mp4; codecs="mp4a.40.2"'));
  log('aac', JSON.stringify(out.aacDecode), out.aacCanPlayType);

  out.httpsAudio = await f.evaluate(async (url) => {
    const a = new Audio();
    a.muted = true;
    a.src = url;
    try {
      await a.play();
      await new Promise((r) => setTimeout(r, 4000));
      const r = { ok: a.currentTime > 1, currentTime: +a.currentTime.toFixed(2), mediaError: a.error ? a.error.code : null };
      a.pause();
      return r;
    } catch (e) { return { ok: false, error: String(e), mediaError: a.error ? a.error.code : null }; }
  }, HTTPS_AUDIO);
  log('https audio', JSON.stringify(out.httpsAudio));

  // ambient: use the room's own CasaAmbient when the build includes it, else inject the source
  out.ambientFromBuild = await f.evaluate(() => !!window.CasaAmbient);
  if (!out.ambientFromBuild) await f.evaluate(fs.readFileSync(path.join(REPO, 'src', 'room', 'panels', 'ambient.js'), 'utf8'));
  out.cpu = {};
  out.cpu.roomIdle = await measure(s, SECONDS);
  const t0 = Date.now();
  out.ambientStart = await f.evaluate(() => { window.CasaAmbient.volume(0); const ok = window.CasaAmbient.play('sea'); return { ok, playing: window.CasaAmbient.playing() }; });
  out.ambientStart.renderAndStartMs = Date.now() - t0;
  await sleep(1500);
  out.ambientStart.state = await f.evaluate(() => window.CasaAmbient.state());
  out.cpu.ambientSea = await measure(s, SECONDS);
  await f.evaluate(() => { window.CasaAmbient.play('rain'); });
  await sleep(1500);
  out.cpu.ambientRain = await measure(s, SECONDS);
  await f.evaluate(() => window.CasaAmbient.stop());
  await sleep(3000);
  out.ambientAfterStop = await f.evaluate(() => ({ state: window.CasaAmbient.state(), playing: window.CasaAmbient.playing() }));
  out.cpu.ambientStopped = await measure(s, SECONDS);
  out.cspMessages = csp;
  log('cpu', JSON.stringify(out.cpu));
} catch (e) {
  out.error = String(e && e.stack || e);
  log('ERROR', out.error);
} finally {
  fs.mkdirSync(path.join(REPO, 'test', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'test', 'evidence', 'obsidian-probe.json'), JSON.stringify(out, null, 2) + '\n');
  if (s) await s.close().catch(() => {});
  clearTimeout(limit);
  log('wrote test/evidence/obsidian-probe.json');
}
