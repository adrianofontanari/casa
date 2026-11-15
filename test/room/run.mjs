// Room canvas proof (Agent 3). Renders test/room-preview.html (mock bridge + order.txt)
// in headless Chromium, saves composite screenshots, clicks every hotspot, counts idle
// canvas draw calls and checks that a paused room does no work.
// Usage: node test/room/run.mjs [--quick]
// Output: test/out/room/*.png and test/out/room/report.json. Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright } from '../harness/launch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'test', 'out', 'room');
const QUICK = process.argv.includes('--quick');
fs.mkdirSync(OUT, { recursive: true });
execFileSync(process.execPath, [path.join(HERE, 'make-preview.js')], { stdio: 'inherit' });
const PAGE = pathToFileURL(path.join(REPO, 'test', 'room-preview.html')).href;

function headlessShell() {
  if (process.env.CASA_CHROME) return process.env.CASA_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  try {
    const dirs = fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const d of dirs) {
      const p = path.join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  return undefined;
}

const INIT = () => {
  const C = (window.__draw = { fillRect: 0, drawImage: 0, putImageData: 0, clearRect: 0, getImageData: 0, fillText: 0 });
  const P = CanvasRenderingContext2D.prototype;
  for (const m of Object.keys(C)) {
    const o = P[m];
    if (typeof o !== 'function') continue;
    P[m] = function (...a) { C[m]++; return o.apply(this, a); };
  }
  window.__resetDraw = () => { for (const k in C) C[k] = 0; };
  window.__opened = [];
  // the preview shows the room itself: mark the first-run card as done in the mock data
  let db;
  Object.defineProperty(window, '__mockDB', {
    configurable: true,
    get() { return db; },
    set(v) { db = v; if (v && v.onboarding) v.onboarding.done = true; },
  });
  document.addEventListener('casa:open', (e) => window.__opened.push(e.detail && e.detail.id));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { shots: [], errors: [], foreign: [], hotspots: null, idle: null, paused: null, ok: true };
const fail = (msg) => { report.ok = false; report.errors.push(msg); console.error('FAIL ' + msg); };

const { chromium, version } = loadPlaywright();
console.log('playwright ' + version);
let browser;
try {
  browser = await chromium.launch({ executablePath: headlessShell() });
} catch (e) {
  browser = await chromium.launch();
}

async function open(w, h, query, dsf = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, locale: 'en-GB' });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errs = [];
  // errors raised inside src/room/panels/ belong to the panel owners: reported, not failed here
  const foreign = (url, text) => /\/src\/room\/panels\//.test(url || '') || /^\[casa\] panel /.test(text || '');
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() || {}).url;
    if (foreign(url, m.text())) report.foreign.push(m.text()); else errs.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => {
    if (foreign(e.stack, e.message)) report.foreign.push(e.message); else errs.push('pageerror: ' + e.message);
  });
  await page.goto(PAGE + query, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => typeof Room !== "undefined" && Room.hots().length > 10, null, { timeout: 8000 });
  } catch (e) {
    throw new Error('room did not start: ' + (errs.join(' | ') || e.message));
  }
  await sleep(1200);
  return { ctx, page, errs };
}

async function shot(page, name) {
  // composite screenshot of the viewport, animations off so it is stable
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file });
  report.shots.push(path.relative(REPO, file));
  return file;
}

const cases = [
  [1440, 900, 14, ''], [1440, 900, 21, ''], [900, 600, 14, ''], [900, 600, 21, ''],
  ...(QUICK ? [] : [[700, 450, 14, ''], [2560, 1440, 21, ''], [1440, 900, 9, '&wx=rain'], [1440, 900, 1, '&wx=snow&date=2026-01-15']]),
];
try {
  for (const [w, h, hr, extra] of cases) {
    const { ctx, page, errs } = await open(w, h, `?hour=${hr}${extra}`);
    const info = await page.evaluate(() => {
      const { M, G } = Room.metrics();
      const se = document.scrollingElement;
      return { px: M.px, lw: M.lw, lh: M.lh, scroll: se.scrollHeight > innerHeight || se.scrollWidth > innerWidth, hots: Room.hots().length };
    });
    if (info.scroll) fail(`${w}x${h}: page scrolls`);
    const name = `room-${w}x${h}-${String(hr).padStart(2, '0')}h${extra ? '-' + extra.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') : ''}`;
    await shot(page, name);
    // a zoomed crop of the calendar, cut from the composite page (not from a canvas)
    const clip = await page.evaluate(() => {
      const { M, G } = Room.metrics(), c = G.calendar;
      return { x: Math.max(0, (c.x - 6) * M.css), y: Math.max(0, (c.y - 6) * M.css), width: (c.w + 12) * M.css, height: (c.h + 12) * M.css };
    });
    const crop = path.join(OUT, name + '-calendar.png');
    await page.screenshot({ path: crop, clip });
    report.shots.push(path.relative(REPO, crop));
    console.log(`${name}: grid ${info.lw}x${info.lh} at ${info.px}px, ${info.hots} hotspots, errors ${errs.length}`);
    errs.forEach((e) => fail(`${name}: ${e}`));
    await ctx.close();
  }

  // hotspots: click the centre of each one, check it is on top there, log casa:open ids
  {
    const { ctx, page, errs } = await open(1440, 900, '?hour=14');
    const hots = await page.evaluate(() => {
      const { M } = Room.metrics();
      return Room.hots().map((h) => ({ id: h.id, label: h.label, cx: (h.x + h.w / 2) * M.css, cy: (h.y + h.h / 2) * M.css }));
    });
    const rows = [];
    for (const h of hots) {
      const top = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.dataset ? e.dataset.id || e.className : null; }, [h.cx, h.cy]);
      await page.evaluate(() => { window.__opened.length = 0; });
      await page.mouse.move(h.cx, h.cy);
      await sleep(60);
      const label = await page.evaluate(() => { const l = document.querySelector('.casa-label'); return l && !l.hidden ? l.textContent : ''; });
      await page.mouse.click(h.cx, h.cy);
      await sleep(80);
      const opened = await page.evaluate(() => window.__opened.slice());
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.querySelectorAll('.cp-overlay').forEach((n) => n.remove()));
      rows.push({ id: h.id, onTop: top === h.id, label, opened });
      if (top !== h.id) fail(`hotspot ${h.id}: covered by ${top}`);
    }
    report.hotspots = rows;
    const want = 'goal agenda calendar window tv typewriter headphones cork strip buddy chair backpack'.split(' ');
    const got = new Set(rows.flatMap((r) => r.opened));
    want.forEach((id) => { if (!got.has(id)) fail(`casa:open never fired for ${id}`); });
    rows.forEach((r) => console.log(`  ${r.id.padEnd(11)} top=${r.onTop ? 'yes' : 'NO '} open=${JSON.stringify(r.opened)} label="${r.label}"`));
    // casa:data refreshes the goal sign; casa:hint makes the buddy speak
    const data = await page.evaluate(async () => {
      window.__mockDB.focus.focus = 'Water the garden';
      document.dispatchEvent(new CustomEvent('casa:data', { detail: { kind: 'focus' } }));
      await new Promise((r) => setTimeout(r, 400));
      const goal = document.querySelector('.casa-goal span').textContent;
      document.dispatchEvent(new CustomEvent('casa:hint', { detail: { text: 'Click anything to start.', pulse: true } }));
      await new Promise((r) => setTimeout(r, 100));
      const say = document.querySelector('.casa-say');
      return { goal, said: say && !say.hidden ? say.textContent : '', pulse: document.querySelector('.casa-hots').classList.contains('casa-pulse') };
    });
    report.events = data;
    console.log('casa:data focus -> "' + data.goal + '"; casa:hint -> "' + data.said + '", pulse ' + data.pulse);
    if (data.goal !== 'Water the garden') fail('casa:data focus did not refresh the goal');
    if (!data.said || !data.pulse) fail('casa:hint not shown');
    await shot(page, 'room-1440x900-14h-hint');
    errs.forEach((e) => fail('hotspots: ' + e));
    await ctx.close();
  }

  // idle cost, then pause: nothing may draw and no timer may stay armed
  for (const hr of [14, 21]) {
    const { ctx, page, errs } = await open(1440, 900, `?hour=${hr}`);
    await sleep(2500);
    await page.evaluate(() => window.__resetDraw());
    const secs = QUICK ? 10 : 30;
    await sleep(secs * 1000);
    const idle = await page.evaluate(() => Object.assign({}, window.__draw));
    const total = Object.values(idle).reduce((a, b) => a + b, 0);
    const perSec = +(total / secs).toFixed(2);
    report.idle = report.idle || {};
    report.idle[hr + 'h'] = { secs, calls: idle, perSec, loops: await page.evaluate(() => Pace.list()) };
    console.log(`idle ${hr}h over ${secs}s: ${JSON.stringify(idle)} = ${perSec} calls/s`);
    if (perSec > 20) fail(`idle draw calls ${perSec}/s at ${hr}h (budget 20/s)`);
    if (hr === 14) {
      await page.evaluate(() => { document.dispatchEvent(new CustomEvent('casa:pause')); window.__resetDraw(); });
      await sleep(QUICK ? 4000 : 10000);
      const p = await page.evaluate(() => ({ calls: Object.values(window.__draw).reduce((a, b) => a + b, 0), armed: Pace.list().filter((l) => l.armed).map((l) => l.id), paused: Pace.paused() }));
      await page.evaluate(() => { window.__resetDraw(); document.dispatchEvent(new CustomEvent('casa:resume')); });
      await sleep(800);
      const resumed = await page.evaluate(() => ({ calls: Object.values(window.__draw).reduce((a, b) => a + b, 0), armed: Pace.list().filter((l) => l.armed).length }));
      report.paused = Object.assign(p, { resumedCalls: resumed.calls, resumedArmed: resumed.armed });
      console.log(`paused: ${p.calls} draw calls, armed timers ${JSON.stringify(p.armed)}; after resume ${resumed.calls} calls, ${resumed.armed} armed`);
      if (p.calls !== 0 || p.armed.length) fail('work while paused');
      if (!resumed.calls || !resumed.armed) fail('room did not resume');
    }
    errs.forEach((e) => fail(`idle ${hr}h: ${e}`));
    await ctx.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
if (report.foreign.length) console.log('note: ' + report.foreign.length + ' error(s) from panels (not room code): ' + [...new Set(report.foreign)].join(' | '));
console.log(report.ok ? 'ROOM OK' : 'ROOM FAILED: ' + report.errors.length + ' problem(s)');
process.exit(report.ok ? 0 : 1);
