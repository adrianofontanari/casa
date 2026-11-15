// Launches a SEPARATE, sandboxed Obsidian instance on a copy of a fixture vault,
// with the current Casa build installed and enabled, and connects to it over CDP.
//
// Isolation (the developer's own Obsidian keeps running untouched):
//   --user-data-dir  -> test/sandbox/profile   (own vault registry, localStorage, caches)
//   HOME             -> test/sandbox/home      (Obsidian binds its CLI socket at $HOME/.obsidian-cli.sock
//                                               and unlinks whatever is there first; without this the
//                                               test instance would steal the real instance's socket)
//   --use-mock-keychain                        (no access to the login keychain)
//   open -g -n, then hide/show/blur            (new process; once its window shows, focus goes back
//                                               to the app that was in front, window stays behind it)
//
// CLI smoke test:  node test/harness/launch.mjs --vault empty [--stub] [--hold 5]
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const VAULTS = path.join(REPO, 'test', 'vaults');
export const SANDBOX = path.join(REPO, 'test', 'sandbox');
export const PROFILE = path.join(SANDBOX, 'profile');
export const FAKE_HOME = path.join(SANDBOX, 'home');
export const OUT = path.join(REPO, 'test', 'out');
export const STUB = path.join(HERE, 'stub-plugin');
export const DEFAULT_PORT = 9333;
const PLUGIN_ID = 'casa';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export function log(...a) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}]`, ...a);
}

// ---------- argument parsing ----------
export function parseArgs(argv, defaults = {}) {
  const out = { ...defaults, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = Array.isArray(out[key]) ? [...out[key], next] : (key in defaults || !(key in out) ? next : [out[key], next]); i++; }
  }
  return out;
}

// ---------- Playwright discovery (no global install) ----------
export function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const cands = [];
  if (process.env.PLAYWRIGHT_PATH) cands.push(process.env.PLAYWRIGHT_PATH);
  cands.push(path.join(HERE, 'node_modules', 'playwright'));
  const npx = path.join(os.homedir(), '.npm', '_npx');
  try { for (const d of fs.readdirSync(npx)) cands.push(path.join(npx, d, 'node_modules', 'playwright')); } catch {}
  try { cands.push(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'playwright')); } catch {}
  const found = cands
    .filter((c) => fs.existsSync(path.join(c, 'package.json')))
    .map((c) => ({ dir: c, version: JSON.parse(fs.readFileSync(path.join(c, 'package.json'), 'utf8')).version }))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  if (!found.length) throw new Error('Playwright not found. Set PLAYWRIGHT_PATH to a playwright package folder.');
  const pw = req(found[0].dir);
  return { chromium: pw.chromium, dir: found[0].dir, version: found[0].version };
}

// ---------- Obsidian app discovery ----------
export function findObsidianApp() {
  const check = (app) => {
    if (!fs.existsSync(path.join(app, 'Contents', 'Info.plist'))) return false;
    try {
      const id = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', path.join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
      return id === 'md.obsidian';
    } catch { return false; }
  };
  if (process.env.OBSIDIAN_APP) return process.env.OBSIDIAN_APP;
  if (check('/Applications/Obsidian.app')) return '/Applications/Obsidian.app';
  for (const name of fs.readdirSync('/Applications')) {
    if (name.endsWith('.app') && check(path.join('/Applications', name))) return path.join('/Applications', name);
  }
  throw new Error('Obsidian.app not found. Set OBSIDIAN_APP.');
}

// ---------- processes ----------
export function processTable() {
  const r = spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,time=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return m && { pid: +m[1], ppid: +m[2], time: m[3], command: m[4] };
  }).filter(Boolean);
}

// Cumulative CPU time from ps TIME ([[dd-]hh:]mm:ss.cc) in seconds.
export function cpuSeconds(t) {
  let days = 0;
  if (t.includes('-')) { const [d, rest] = t.split('-'); days = +d; t = rest; }
  const parts = t.split(':').map(Number);
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return days * 86400 + s;
}

export function treeOf(rootPid, table = processTable()) {
  const kids = new Map();
  for (const p of table) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const out = [];
  const root = table.find((p) => p.pid === rootPid);
  if (!root) return out;
  const stack = [root];
  while (stack.length) { const p = stack.pop(); out.push(p); for (const k of kids.get(p.pid) || []) stack.push(k); }
  return out;
}

const isMainObsidian = (p, appPath) => p.command.startsWith(path.join(appPath, 'Contents', 'MacOS') + '/') && !p.command.includes('--type=');
export const sandboxMains = (appPath, table = processTable()) => table.filter((p) => isMainObsidian(p, appPath) && p.command.includes(`--user-data-dir=${PROFILE}`));
export const foreignMains = (appPath, table = processTable()) => table.filter((p) => isMainObsidian(p, appPath) && !p.command.includes(`--user-data-dir=${PROFILE}`));

function frontmostPid() {
  try {
    const asn = execFileSync('lsappinfo', ['front'], { encoding: 'utf8' }).trim();
    const info = execFileSync('lsappinfo', ['info', '-only', 'pid', asn], { encoding: 'utf8' });
    const m = info.match(/pid\s*=\s*(\d+)/);
    return m ? +m[1] : null;
  } catch { return null; }
}

function socketId(p) {
  try { const s = fs.statSync(p); return `${s.ino}:${s.mtimeMs}`; } catch { return null; }
}

async function portOpen(port) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) }); return r.ok; } catch { return false; }
}

// ---------- fixture vault -> sandbox copy ----------
function fmtDate(d, fmt) {
  const pad = (n) => String(n).padStart(2, '0');
  return fmt.replace(/YYYY|MM|DD|M|D/g, (t) => ({ YYYY: d.getFullYear(), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), M: d.getMonth() + 1, D: d.getDate() }[t]));
}
// <<date:N>> -> local date N days from today as YYYY-MM-DD; <<date:N:FORMAT>> with YYYY MM DD M D.
export function expandDates(text, today = new Date()) {
  return text.replace(/<<date:([+-]?\d+)(?::([^>]+))?>>/g, (_, n, fmt) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(n), 12);
    return fmtDate(d, fmt || 'YYYY-MM-DD');
  });
}

const TEXT_EXT = new Set(['.md', '.json', '.css', '.txt', '.canvas', '.ics']);

export function prepareVault(name, { build = 'auto', theme } = {}) {
  const src = path.join(VAULTS, name);
  if (!fs.existsSync(path.join(src, 'fixture.json'))) throw new Error(`Unknown fixture vault "${name}" (no ${path.relative(REPO, src)}/fixture.json)`);
  const fixture = JSON.parse(fs.readFileSync(path.join(src, 'fixture.json'), 'utf8'));
  const dest = path.join(SANDBOX, 'vaults', `${name}-${stamp()}`);
  const copy = (from, to) => {
    for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
      if (from === src && (ent.name === 'fixture.json' || ent.name === '_gen')) continue;
      if (ent.name === '.DS_Store') continue;
      const a = path.join(from, ent.name), b = path.join(to, ent.name);
      if (ent.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); }
      else if (TEXT_EXT.has(path.extname(ent.name))) fs.writeFileSync(b, expandDates(fs.readFileSync(a, 'utf8')));
      else fs.copyFileSync(a, b);
    }
  };
  fs.mkdirSync(dest, { recursive: true });
  copy(src, dest);
  for (const g of fixture.generate || []) {
    const to = path.join(dest, expandDates(g.path));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, expandDates(fs.readFileSync(path.join(src, g.from), 'utf8')));
  }
  // Control note for hide/show and CPU measurements.
  if (!fs.existsSync(path.join(dest, 'Blank.md'))) fs.writeFileSync(path.join(dest, 'Blank.md'), '');

  // Install the build: main.js, manifest.json, styles.css. data.json from the fixture is kept.
  let from = build;
  if (build === 'auto') from = fs.existsSync(path.join(REPO, 'main.js')) ? REPO : null;
  else if (build === 'repo') from = REPO;
  else if (build === 'stub') from = STUB;
  if (!from) throw new Error('No build at the repo root (main.js). Run the build first, or pass --stub.');
  const pdir = path.join(dest, '.obsidian', 'plugins', PLUGIN_ID);
  fs.mkdirSync(pdir, { recursive: true });
  const installed = [];
  for (const f of ['main.js', 'manifest.json', 'styles.css']) {
    const p = path.join(from, f);
    if (fs.existsSync(p)) { fs.copyFileSync(p, path.join(pdir, f)); installed.push(f); }
    else if (f !== 'styles.css') throw new Error(`Build is missing ${f} in ${path.relative(REPO, from) || '.'}`);
  }
  const cpPath = path.join(dest, '.obsidian', 'community-plugins.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(cpPath, 'utf8')); } catch {}
  if (!list.includes(PLUGIN_ID)) list.push(PLUGIN_ID);
  fs.writeFileSync(cpPath, JSON.stringify(list, null, 2));
  if (theme) {
    const map = { light: 'moonstone', dark: 'obsidian', system: 'system' };
    fs.writeFileSync(path.join(dest, '.obsidian', 'appearance.json'), JSON.stringify({ theme: map[theme] || theme }, null, 2));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(pdir, 'manifest.json'), 'utf8'));
  return { name, path: dest, fixture, build: from === STUB ? 'stub' : path.relative(REPO, from) || 'repo root', installed, manifest };
}

// ---------- profile seeding ----------
export function seedProfile(vaultPath, { width = 1440, height = 900 } = {}) {
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(FAKE_HOME, { recursive: true });
  const id = crypto.randomBytes(8).toString('hex');
  const cfgPath = path.join(PROFILE, 'obsidian.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
  // Only the vault under test is registered and open. Updates off: no download into the sandbox.
  cfg.vaults = { [id]: { path: vaultPath, ts: Date.now(), open: true } };
  cfg.updateDisabled = true;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  // Per-vault window state: Obsidian reads <vaultId>.json for the window bounds.
  fs.writeFileSync(path.join(PROFILE, `${id}.json`), JSON.stringify({ width, height, isMaximized: false, devTools: false }));
  return id;
}

// ---------- one instance at a time: a lock file shared by every script using launch() ----------
export const LOCK = path.join(SANDBOX, 'instance.lock');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function lockOwner() {
  try { const o = JSON.parse(fs.readFileSync(LOCK, 'utf8')); return o && alive(o.pid) ? o : null; } catch { return null; }
}
function tryLock(what) {
  fs.mkdirSync(SANDBOX, { recursive: true });
  try {
    fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, what, since: new Date().toISOString() }), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (lockOwner()) return false;
    // Stale lock from a process that is gone: replace it.
    try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, what, since: new Date().toISOString() })); return true; } catch { return false; }
  }
}
function releaseLock() {
  try { const o = JSON.parse(fs.readFileSync(LOCK, 'utf8')); if (o.pid === process.pid) fs.rmSync(LOCK); } catch {}
}
// Waits (default up to 10 min) while another script holds the lock or another sandbox instance runs.
async function acquire(appPath, port, what, waitSeconds) {
  const t0 = Date.now();
  let said = false;
  for (;;) {
    const busy = sandboxMains(appPath).length > 0 || (await portOpen(port));
    if (!busy && tryLock(what)) {
      if (!sandboxMains(appPath).length && !(await portOpen(port))) return;
      releaseLock();
    }
    if ((Date.now() - t0) / 1000 > waitSeconds) {
      const o = lockOwner();
      throw new Error(`Sandbox Obsidian busy for ${waitSeconds}s (lock: ${o ? `pid ${o.pid}, ${o.what}` : 'none'}; sandbox pids: ${sandboxMains(appPath).map((p) => p.pid).join(', ') || 'none'}; port ${port})`);
    }
    if (!said) { const o = lockOwner(); log(`sandbox busy (${o ? `pid ${o.pid}: ${o.what}` : 'instance or port in use'}), waiting...`); said = true; }
    await sleep(3000);
  }
}

// The session this process started, so the guard can close it (and only it) at any point.
let CURRENT = null;

// ---------- launch ----------
export async function launch(opts = {}) {
  const { vault = 'empty', build = 'auto', width = 1440, height = 900, port = DEFAULT_PORT, theme, trustTimeout = 8000, waitSeconds = 600 } = opts;
  const appPath = findObsidianApp();
  const pw = loadPlaywright();

  // One sandbox instance at a time, and the debug port must be free: wait for our turn.
  await acquire(appPath, port, `${path.basename(process.argv[1] || 'node')} --vault ${vault}`, waitSeconds);

  const before = {
    foreign: foreignMains(appPath).map((p) => p.pid),
    socket: socketId(path.join(os.homedir(), '.obsidian-cli.sock')),
    front: frontmostPid(),
  };

  const v = prepareVault(vault, { build, theme });
  const vaultId = seedProfile(v.path, { width: +width, height: +height });
  fs.mkdirSync(path.join(SANDBOX, 'logs'), { recursive: true });
  const logBase = path.join(SANDBOX, 'logs', `${vault}-${stamp()}`);
  const args = ['-g', '-n', '-a', appPath,
    '--env', `HOME=${FAKE_HOME}`,
    '--stdout', `${logBase}.out.log`, '--stderr', `${logBase}.err.log`,
    '--args', `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${port}`,
    '--use-mock-keychain', '--disable-backgrounding-occluded-windows'];
  log(`launch ${path.basename(appPath)} on vault ${path.relative(REPO, v.path)} (build: ${v.build}, plugin ${v.manifest.id} ${v.manifest.version})`);
  const r = spawnSync('open', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`open failed: ${r.stderr}`);

  let main = null;
  for (let i = 0; i < 100 && !main; i++) { await sleep(200); main = sandboxMains(appPath)[0]; }
  if (!main) { releaseLock(); throw new Error('Sandbox Obsidian process did not appear'); }

  const session = { appPath, vault: v, vaultId, port, main: main.pid, logBase, before, playwright: pw.version, width: +width, height: +height };
  session.close = () => closeInstance(session);
  CURRENT = session;
  try {
    for (let i = 0; i < 150 && !(await portOpen(port)); i++) await sleep(200);
    if (!(await portOpen(port))) throw new Error(`CDP port ${port} did not open`);
    const browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    session.browser = browser;
    let page = null;
    for (let i = 0; i < 100 && !page; i++) {
      page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('app://obsidian.md/index.html'));
      if (!page) await sleep(200);
    }
    if (!page) throw new Error('Obsidian vault window not found over CDP: ' + browser.contexts().flatMap((c) => c.pages()).map((p) => p.url()).join(', '));
    session.page = page;
    await waitForLayout(page);
    // Showing the window activates the app: hand focus back to whatever was in front.
    session.foreground = !!opts.foreground;
    if (!opts.foreground) await giveFocusBack(session);
    session.trust = await ensurePluginsTrusted(page, trustTimeout);
    // Opening Settings after the trust click can bring the window forward again.
    if (!opts.foreground) session.focusReturned = await giveFocusBack(session);
    session.separation = verifySeparation(session);
    return session;
  } catch (e) {
    await closeInstance(session).catch(() => {});
    throw e;
  }
}

// If the test instance is the frontmost app, hand focus back to the app that was in front:
// app.hide() makes macOS activate the previous app; app.show() brings the window back WITHOUT
// activating it, and blur() orders it behind the other windows. The window must stay on screen:
// a hidden app keeps running rAF but presents no frames, so screenshots time out (checked).
export async function giveFocusBack(s) {
  if (s.foreground) return { front: frontmostPid(), tries: 0, skipped: 'foreground' };
  const previous = s.before.front;
  let i = 0;
  for (; i < 20; i++) {
    const front = frontmostPid();
    if (front !== s.main && (previous == null || front === previous || i > 5)) break;
    await s.page.evaluate(() => window.electron && electron.remote.app.hide()).catch(() => {});
    await sleep(250);
  }
  if (i > 0) {
    await s.page.evaluate(() => { electron.remote.app.show(); electron.remote.getCurrentWindow().blur(); }).catch(() => {});
    await sleep(300);
  }
  const front = frontmostPid();
  return front === s.main ? { front, tries: i, warning: 'test instance is still frontmost' } : { front, tries: i };
}

export async function waitForLayout(page, timeout = 30000) {
  await page.waitForFunction(() => window.app && app.workspace && app.workspace.layoutReady, null, { timeout });
}

// Fresh vault with community plugins: Obsidian shows "Trust author and enable plugins?".
// Click it like a user would. If it never shows, fall back to the plugin manager API and say so.
export async function ensurePluginsTrusted(page, timeout = 8000) {
  const t0 = Date.now();
  let how = null;
  while (Date.now() - t0 < timeout) {
    const state = await page.evaluate(() => ({ enabled: app.plugins.isEnabled(), modal: !!document.querySelector('.modal.mod-trust-folder') }));
    if (state.enabled) { how = how || 'already'; break; }
    if (state.modal) {
      const btn = page.locator('.modal.mod-trust-folder .modal-button-container button:not(.mod-cancel)').last();
      const label = (await btn.textContent()).trim();
      await btn.click();
      how = `clicked "${label}"`;
      await page.waitForFunction(() => app.plugins.isEnabled(), null, { timeout: 10000 });
      break;
    }
    await sleep(250);
  }
  if (!how) { await page.evaluate(() => app.plugins.setEnable(true)); how = 'api setEnable(true) (no trust dialog seen)'; }
  // The trust button opens Settings > Community plugins; close it.
  await page.evaluate(() => app.setting && app.setting.close && app.setting.close());
  const loaded = await page.waitForFunction((id) => !!app.plugins.plugins[id], PLUGIN_ID, { timeout: 15000 }).then(() => true, () => false);
  if (!loaded) {
    const err = await page.evaluate((id) => ({ manifests: Object.keys(app.plugins.manifests), enabled: [...app.plugins.enabledPlugins] }), PLUGIN_ID);
    throw new Error(`Plugin "${PLUGIN_ID}" did not load: ${JSON.stringify(err)}`);
  }
  return how;
}

export function verifySeparation(s) {
  const table = processTable();
  const mine = treeOf(s.main, table);
  const foreignAlive = s.before.foreign.filter((pid) => table.some((p) => p.pid === pid));
  const out = {
    mainPid: s.main,
    treePids: mine.map((p) => p.pid),
    allTreeUseSandboxProfile: mine.every((p) => p.command.includes(PROFILE)),
    foreignBefore: s.before.foreign,
    foreignAlive,
    foreignInMyTree: mine.filter((p) => s.before.foreign.includes(p.pid)).map((p) => p.pid),
    realCliSocketUnchanged: socketId(path.join(os.homedir(), '.obsidian-cli.sock')) === s.before.socket,
    sandboxCliSocket: fs.existsSync(path.join(FAKE_HOME, '.obsidian-cli.sock')),
    sandboxLogWritten: fs.existsSync(path.join(PROFILE, 'obsidian.log')),
    frontmostBefore: s.before.front,
    frontmostNow: frontmostPid(),
  };
  out.ok = out.allTreeUseSandboxProfile && out.foreignAlive.length === out.foreignBefore.length && !out.foreignInMyTree.length && out.realCliSocketUnchanged && out.sandboxCliSocket;
  return out;
}

export async function closeInstance(s) {
  try { if (s.browser) await s.browser.close(); } catch {}
  const pids = treeOf(s.main).filter((p) => p.command.includes(PROFILE)).map((p) => p.pid);
  try { process.kill(s.main, 'SIGTERM'); } catch {}
  for (let i = 0; i < 75; i++) {
    const alive = new Set(processTable().map((p) => p.pid));
    if (!pids.some((p) => alive.has(p))) break;
    await sleep(200);
  }
  const alive = new Set(processTable().map((p) => p.pid));
  const left = pids.filter((p) => alive.has(p));
  for (const p of left) { try { process.kill(p, 'SIGKILL'); } catch {} }
  const table = processTable();
  const after = {
    sandboxGone: !sandboxMains(s.appPath, table).length,
    forcedKill: left,
    foreignStillAlive: s.before.foreign.every((pid) => table.some((p) => p.pid === pid)),
    realCliSocketUnchanged: socketId(path.join(os.homedir(), '.obsidian-cli.sock')) === s.before.socket,
  };
  s.closed = after;
  if (CURRENT === s) CURRENT = null;
  releaseLock();
  return after;
}

// Always close the sandbox instance: on Ctrl-C, on SIGTERM, and after a hard time limit.
export function guard(getSession, seconds = 600) {
  let closing = false;
  const bail = async (why, code) => {
    if (closing) return;
    closing = true;
    console.error(`\n${why}: closing the sandbox instance`);
    // Only the instance THIS process started (another agent may be using the sandbox too).
    const s = (getSession && getSession()) || CURRENT;
    if (s && s.main && !s.closed) await closeInstance(s).catch(() => {});
    else releaseLock();
    process.exit(code);
  };
  process.on('SIGINT', () => bail('interrupted', 130));
  process.on('SIGTERM', () => bail('terminated', 143));
  const t = setTimeout(() => bail(`time limit ${seconds}s reached`, 3), seconds * 1000);
  t.unref();
  return t;
}

// ---------- CLI ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2), { vault: 'empty', width: 1440, height: 900, port: DEFAULT_PORT, hold: 0 });
  if (a.kill) {
    const app = findObsidianApp();
    const owner = lockOwner();
    if (owner && !a.force) { console.error(`Not killing: pid ${owner.pid} (${owner.what}) is using the sandbox since ${owner.since}. Add --force to close it anyway.`); process.exit(1); }
    const ms = sandboxMains(app);
    for (const m of ms) { log('closing sandbox pid', m.pid); await closeInstance({ main: m.pid, appPath: app, before: { foreign: [], socket: null } }); }
    if (!ms.length) log('no sandbox instance running');
    process.exit(0);
  }
  let s;
  guard(() => s, 120 + (+a.hold || 0));
  try {
    s = await launch({ vault: a.vault, build: a.stub ? 'stub' : (a.build || 'auto'), width: a.width, height: a.height, port: +a.port, theme: a.theme, foreground: !!a.foreground });
    log('playwright', s.playwright, '| plugins:', s.trust);
    const info = await s.page.evaluate(() => ({ basePath: app.vault.adapter.basePath, ua: navigator.userAgent.match(/obsidian\/[\d.]+/i)?.[0], plugins: Object.keys(app.plugins.plugins), size: [innerWidth, innerHeight] }));
    log('window:', JSON.stringify(info));
    log('separation:', JSON.stringify(s.separation));
    if (+a.hold) await sleep(+a.hold * 1000);
  } catch (e) {
    console.error('LAUNCH FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    if (s) log('closed:', JSON.stringify(await s.close()));
  }
}
