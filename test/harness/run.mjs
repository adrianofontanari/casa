// Drives the Casa view in a sandboxed Obsidian (see launch.mjs) and records what happens.
//
//   node test/harness/run.mjs --vault empty [--stub] [--steps open,wait:3000,screenshot:room]
//                             [--width 1440 --height 900] [--theme light|dark] [--offline]
//                             [--allow <regex>]... [--scale css|device] [--no-reload]
//
// Output in test/out/<vault>/: NN-<name>.png (composite screenshots of the whole window),
// console.json, network.json, summary.json. Exit code 1 on console errors, failed steps,
// or (with --offline, default for the "offline" vault) any external request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, parseArgs, log, sleep, waitForLayout, giveFocusBack, guard, expandDates, OUT, REPO } from './launch.mjs';

const PLUGIN_ID = 'casa';

// Hook for requests made with Obsidian's requestUrl(): they run in the main process
// (electron.net), so the renderer's Network domain never sees them. requestUrl sends
// ipcRenderer "request-url"; we log each call. Installed on every new document.
const IPC_HOOK = `(() => { try {
  if (typeof window.require !== 'function' || window.__casaHarnessIpc) return;
  const ipc = window.require('electron').ipcRenderer;
  const log = window.__casaHarnessIpc = [];
  const send = ipc.send.bind(ipc);
  ipc.send = function (ch, ...a) {
    if (ch === 'request-url') {
      const o = a[1] || {};
      const lim = Error.stackTraceLimit; Error.stackTraceLimit = 40;
      const stack = (new Error().stack || '').split('\\n').slice(2).map((s) => s.trim()).join(' | ');
      Error.stackTraceLimit = lim;
      log.push({ t: Date.now(), url: o.url, method: o.method || 'GET', stack });
    }
    return send(ch, ...a);
  };
} catch (e) {} })();`;

// ---------- console + network recorder (raw CDP on the window target) ----------
export class Recorder {
  constructor(page) {
    this.page = page;
    this.console = [];
    this.requests = new Map();
    this.contexts = new Map(); // executionContextId -> frameId
    this.frames = new Map(); // frameId -> url
    this.mainFrameId = null;
    this.roomFrameId = null;
  }
  async start() {
    const cdp = this.cdp = await this.page.context().newCDPSession(this.page);
    cdp.on('Runtime.executionContextCreated', ({ context }) => { if (context.auxData) this.contexts.set(context.id, context.auxData.frameId); });
    cdp.on('Page.frameNavigated', ({ frame }) => { this.frames.set(frame.id, frame.url + (frame.urlFragment || '')); if (!frame.parentId) this.mainFrameId = frame.id; });
    cdp.on('Runtime.consoleAPICalled', (e) => {
      if (!['error', 'warning', 'assert'].includes(e.type)) return;
      const text = e.args.map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ');
      const top = (e.stackTrace && e.stackTrace.callFrames[0]) || {};
      this.push({ kind: 'console.' + e.type, text, url: top.url, line: top.lineNumber, frameId: this.contexts.get(e.executionContextId) });
    });
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => {
      const text = (d.exception && (d.exception.description || d.exception.value)) || d.text;
      this.push({ kind: 'exception', text, url: d.url, line: d.lineNumber, frameId: this.contexts.get(d.executionContextId) });
    });
    cdp.on('Log.entryAdded', ({ entry: e }) => {
      if (e.level !== 'error' && e.level !== 'warning') return;
      this.push({ kind: `log.${e.source}.${e.level}`, text: e.text, url: e.url, frameId: null });
    });
    cdp.on('Network.requestWillBeSent', (e) => {
      const prev = this.requests.get(e.requestId);
      this.requests.set(e.requestId, {
        t: Math.round(e.wallTime * 1000), via: 'renderer', method: e.request.method, url: e.request.url,
        type: e.type, frameId: e.frameId, documentURL: e.documentURL, initiator: initiatorOf(e.initiator),
        redirectedFrom: prev ? prev.url : undefined,
      });
    });
    cdp.on('Network.responseReceived', (e) => { const r = this.requests.get(e.requestId); if (r) { r.status = e.response.status; r.mime = e.response.mimeType; r.remote = e.response.remoteIPAddress; } });
    cdp.on('Network.loadingFailed', (e) => { const r = this.requests.get(e.requestId); if (r) r.failed = e.errorText + (e.blockedReason ? ` (${e.blockedReason})` : ''); });
    cdp.on('Network.webSocketCreated', (e) => this.requests.set('ws-' + e.requestId, { t: Date.now(), via: 'websocket', url: e.url, initiator: initiatorOf(e.initiator) }));
    await cdp.send('Page.enable');
    const tree = await cdp.send('Page.getFrameTree');
    const walk = (n) => { this.frames.set(n.frame.id, n.frame.url); (n.childFrames || []).forEach(walk); };
    walk(tree.frameTree);
    this.mainFrameId = tree.frameTree.frame.id;
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    // The room is a sandboxed srcdoc iframe: Chromium runs it OUT OF PROCESS, so the raw CDP session
    // of the window never sees its console, exceptions or requests (checked). Playwright attaches to
    // out-of-process frames, so its page events fill that gap; collect() drops what CDP already has.
    this.pw = { console: [], errors: [], requests: [] };
    this.page.on('console', (m) => {
      if (!['error', 'warning', 'assert'].includes(m.type())) return;
      const loc = m.location() || {};
      this.pw.console.push({ t: Date.now(), kind: 'console.' + m.type(), text: m.text(), url: loc.url, line: loc.lineNumber });
    });
    this.page.on('pageerror', (e) => this.pw.errors.push({ t: Date.now(), kind: 'exception', text: e.message, stack: String(e.stack || '').slice(0, 600) }));
    this.page.on('request', (r) => {
      let frame = null;
      try { frame = r.frame(); } catch {}
      if (!frame || frame === this.page.mainFrame()) return;
      const e = { t: Date.now(), via: 'renderer-oopif', method: r.method(), url: r.url(), type: r.resourceType(), frame, frameUrl: frame.url() };
      this.pw.requests.push(e);
      r.response().then((res) => { if (res) e.status = res.status(); }, () => {});
    });
    this.page.on('requestfailed', (r) => { const e = this.pw.requests.find((x) => x.url === r.url() && !x.failed); if (e) e.failed = (r.failure() || {}).errorText; });
    await this.page.addInitScript(IPC_HOOK);
    await this.page.evaluate(IPC_HOOK);
  }
  push(entry) {
    entry.t = Date.now();
    this.console.push(entry);
  }
  origin(frameId, url) {
    if (frameId && frameId === this.roomFrameId) return 'room';
    if (frameId && frameId !== this.mainFrameId) return 'frame';
    if (url && url.startsWith(`plugin:${PLUGIN_ID}`)) return 'plugin';
    return 'window';
  }
  async markRoomFrame() {
    const { result } = await this.cdp.send('Runtime.evaluate', { expression: 'document.querySelector("iframe[data-harness-room]")' });
    if (!result.objectId) return null;
    const { node } = await this.cdp.send('DOM.describeNode', { objectId: result.objectId });
    this.roomFrameId = node.frameId || null;
    return this.roomFrameId;
  }
  async ipcRequests() {
    try { return await this.page.evaluate(() => window.__casaHarnessIpc || []); } catch { return []; }
  }
  // Proves the requestUrl hook sees main-process requests: a local request to our own CDP port.
  async selfTestIpcHook(port) {
    return this.page.evaluate((port) => new Promise((resolve) => {
      const ipc = require('electron').ipcRenderer, id = 'harness-selftest-' + Date.now();
      const before = (window.__casaHarnessIpc || []).length;
      ipc.once(id, (_e, res) => resolve({ hooked: (window.__casaHarnessIpc || []).length === before + 1, status: res && res.status }));
      ipc.send('request-url', id, { url: `http://127.0.0.1:${port}/json/version`, method: 'GET' });
      setTimeout(() => resolve({ hooked: (window.__casaHarnessIpc || []).length === before + 1, status: 'timeout' }), 5000);
    }), port);
  }
  async collect() {
    const ipc = (await this.ipcRequests()).map((r) => ({ ...r, via: 'requestUrl' }));
    const net = [...this.requests.values()].map((r) => ({ ...r, frameUrl: this.frames.get(r.frameId) }));
    for (const r of [...net, ...ipc]) r.origin = classify(r, this);
    const consoleOut = this.console.map((c) => ({ ...c, origin: this.origin(c.frameId, c.url) }));
    // Out-of-process frames (the room): add what the window's CDP session did not see.
    const seenNet = new Set(net.map((r) => r.method + ' ' + r.url));
    const oopifNet = this.pw.requests.filter((r) => !seenNet.has(r.method + ' ' + r.url)).map(({ frame, ...r }) => ({ ...r, origin: frame === this.roomPwFrame ? 'room' : 'frame' }));
    const seenText = consoleOut.map((c) => String(c.text));
    const inCdp = (text) => seenText.some((x) => x === text || x.includes(text));
    for (const c of this.pw.console) if (!inCdp(c.text)) consoleOut.push({ ...c, origin: c.url === 'about:srcdoc' || !c.url || c.url === (this.roomPwFrame && this.roomPwFrame.url()) ? 'room' : 'frame', via: 'oopif' });
    for (const e of this.pw.errors) if (!inCdp(e.text)) consoleOut.push({ ...e, origin: /about:srcdoc/.test(e.stack) || !/app:\/\/obsidian\.md|plugin:/.test(e.stack) ? 'room' : 'frame', via: 'oopif' });
    return { network: [...net, ...oopifNet, ...ipc].sort((a, b) => a.t - b.t), console: consoleOut.sort((a, b) => a.t - b.t) };
  }
}

function initiatorOf(i) {
  if (!i) return undefined;
  const urls = new Set();
  for (let st = i.stack; st; st = st.parent) for (const f of st.callFrames || []) if (f.url) urls.add(f.url);
  const f = i.stack && i.stack.callFrames && i.stack.callFrames[0];
  return { type: i.type, url: (f && f.url) || i.url, line: f ? f.lineNumber : i.lineNumber, stackUrls: [...urls] };
}

// Who caused a request: the room iframe, the Casa plugin code, Obsidian itself, or the harness.
function classify(r, rec) {
  if (r.frameId && r.frameId === rec.roomFrameId) return 'room';
  const urls = r.via === 'requestUrl' ? [r.stack || ''] : [...((r.initiator && r.initiator.stackUrls) || []), (r.initiator && r.initiator.url) || ''];
  if (urls.some((u) => u.includes(`plugin:${PLUGIN_ID}`))) return 'plugin';
  if (r.url && r.url.startsWith('http://127.0.0.1:') && r.url.includes('/json/version')) return 'harness-selftest';
  if (r.frameId && r.frameId !== rec.mainFrameId) return 'frame';
  return 'obsidian';
}

export const isExternal = (url) => /^(https?|wss?):/i.test(url || '') && !/^(https?|wss?):\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(url);

// ---------- room helpers ----------
export class Room {
  constructor(session, recorder) {
    this.s = session;
    this.page = session.page;
    this.rec = recorder;
  }
  // Opens the Casa view the way a user does: command palette, type "Casa: Open room", Enter.
  // via:'command' runs the same command by id (no UI).
  async open({ via = 'palette', timeout = 15000 } = {}) {
    const page = this.page;
    const cmd = await page.evaluate((pid) => {
      const all = Object.values(app.commands.commands).filter((c) => c.id.startsWith(pid + ':'));
      const c = all.find((c) => /open room/i.test(c.name)) || all.find((c) => /open/i.test(c.name));
      return c ? { id: c.id, name: c.name } : { error: 'no Casa open command', ids: all.map((c) => c.id) };
    }, PLUGIN_ID);
    if (cmd.error) throw new Error(`${cmd.error}: ${JSON.stringify(cmd.ids)}`);
    if (via === 'palette') {
      await page.evaluate(() => app.commands.executeCommandById('command-palette:open'));
      const input = page.locator('.prompt .prompt-input');
      await input.waitFor({ timeout: 5000 });
      await input.fill(cmd.name);
      const first = page.locator('.prompt .suggestion-item.is-selected');
      await first.waitFor({ timeout: 5000 });
      const label = (await first.innerText()).replace(/\s+/g, ' ').trim();
      if (!label.toLowerCase().includes(cmd.name.toLowerCase().replace(/^.*?:\s*/, ''))) throw new Error(`Palette picked "${label}" for "${cmd.name}"`);
      await page.keyboard.press('Enter');
    } else {
      await page.evaluate((id) => app.commands.executeCommandById(id), cmd.id);
    }
    const found = await page.waitForFunction((pid) => {
      const types = Object.keys(app.viewRegistry.viewByType).filter((t) => t.startsWith(pid));
      for (const t of types) for (const leaf of app.workspace.getLeavesOfType(t)) {
        const f = leaf.view.containerEl.querySelector('iframe');
        if (f) { document.querySelectorAll('iframe[data-harness-room]').forEach((x) => x.removeAttribute('data-harness-room')); f.setAttribute('data-harness-room', '1'); return { type: t }; }
      }
      return false;
    }, PLUGIN_ID, { timeout }).then((h) => h.jsonValue());
    this.viewType = found.type;
    const handle = await page.$('iframe[data-harness-room]');
    this.frameRef = await handle.contentFrame();
    await this.frameRef.waitForLoadState('load', { timeout });
    if (this.rec) { await this.rec.markRoomFrame(); this.rec.roomPwFrame = this.frameRef; }
    return { command: cmd, via, viewType: found.type };
  }
  frame() { return this.frameRef; }
  async box() {
    const b = await this.page.locator('iframe[data-harness-room]').boundingBox();
    if (!b) throw new Error('Room iframe has no box (hidden?)');
    return b;
  }
  // Click inside the room at fractional coordinates (0..1) of the iframe, with a real mouse event.
  async click(fx, fy) {
    const b = await this.box();
    const x = b.x + fx * b.width, y = b.y + fy * b.height;
    await this.page.mouse.click(x, y);
    return { x: Math.round(x), y: Math.round(y) };
  }
  // Click an object by id. Looks up its hotspot (CSS px inside the iframe) from
  // window.CasaDebug.hotspot(id), an element with data-casa-id, or the room's hotspot button
// .casa-hot[data-id]; else dispatches casa:open.
  async clickObject(id) {
    const r = await this.frameRef.evaluate((id) => {
      if (window.CasaDebug && typeof CasaDebug.hotspot === 'function') { const h = CasaDebug.hotspot(id); if (h) return { ...h, how: 'CasaDebug.hotspot' }; }
      const el = document.querySelector(`[data-casa-id="${id}"]`) || document.querySelector(`.casa-hot[data-id="${id}"]`);
      if (el) { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, how: el.matches('.casa-hot') ? 'hotspot button .casa-hot' : 'data-casa-id' }; }
      return null;
    }, id);
    if (!r) {
      await this.frameRef.evaluate((id) => document.dispatchEvent(new CustomEvent('casa:open', { detail: { id } })), id);
      return { id, how: 'event casa:open (no hotspot found)' };
    }
    // Refuse to "click" an object that something else covers (an open panel, the onboarding card).
    const top = await this.frameRef.evaluate(({ id, cx, cy }) => {
      const hit = document.elementFromPoint(cx, cy);
      const el = document.querySelector(`[data-casa-id="${id}"]`) || document.querySelector(`.casa-hot[data-id="${id}"]`);
      if (!hit || !el || el === hit || el.contains(hit)) return null;
      return hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + (typeof hit.className === 'string' && hit.className ? '.' + hit.className.trim().split(/\s+/).join('.') : '');
    }, { id, cx: r.x + r.w / 2, cy: r.y + r.h / 2 });
    if (top && r.how !== 'CasaDebug.hotspot') throw new Error(`object "${id}" is covered by ${top}`);
    const b = await this.box();
    const x = b.x + r.x + r.w / 2, y = b.y + r.y + r.h / 2;
    await this.page.mouse.click(x, y);
    return { id, how: r.how, x: Math.round(x), y: Math.round(y) };
  }
  readVaultFile(rel) {
    return fs.readFileSync(path.join(this.s.vault.path, rel), 'utf8');
  }
  async watchPause() {
    await this.frameRef.evaluate(() => {
      if (window.__harnessPause) return;
      window.__harnessPause = [];
      document.addEventListener('casa:pause', () => window.__harnessPause.push('pause'));
      document.addEventListener('casa:resume', () => window.__harnessPause.push('resume'));
    }).catch(() => {});
  }
  async pauseEvents() { return this.frameRef.evaluate(() => window.__harnessPause || []).catch(() => null); }
  // Hidden = another tab active in the same tab group (the room leaf stays open in the background).
  async hide() {
    await this.watchPause();
    const res = await this.page.evaluate(async (type) => {
      const leaf = app.workspace.getLeavesOfType(type)[0];
      app.workspace.setActiveLeaf(leaf, { focus: false });
      const other = app.workspace.getLeaf('tab');
      await other.openFile(app.vault.getAbstractFileByPath('Blank.md'));
      return { roomShown: !!leaf.view.containerEl.offsetParent };
    }, this.viewType);
    await sleep(300);
    return { ...res, pauseEvents: await this.pauseEvents() };
  }
  async show() {
    const res = await this.page.evaluate(async (type) => {
      const leaf = app.workspace.getLeavesOfType(type)[0];
      app.workspace.setActiveLeaf(leaf, { focus: true });
      await app.workspace.revealLeaf(leaf);
      return { roomShown: !!leaf.view.containerEl.offsetParent };
    }, this.viewType);
    await sleep(300);
    return { ...res, pauseEvents: await this.pauseEvents() };
  }
  // Control state: no room at all, only an empty note open.
  async blankOnly() {
    return this.page.evaluate(async (type) => {
      for (const l of app.workspace.getLeavesOfType(type)) l.detach();
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(app.vault.getAbstractFileByPath('Blank.md'));
      return { roomLeaves: app.workspace.getLeavesOfType(type).length };
    }, this.viewType);
  }
  async visibility() {
    const win = await this.page.evaluate(() => ({ state: document.visibilityState, focus: document.hasFocus() }));
    let room = null;
    if (this.frameRef && !this.frameRef.isDetached()) room = await this.frameRef.evaluate(() => document.visibilityState).catch(() => null);
    return { window: win.state, room };
  }
}

// Composite screenshot of the whole Obsidian window (DOM, iframe and canvases together).
export async function screenshot(page, file, scale = 'css') {
  try {
    await page.screenshot({ path: file, scale, timeout: 15000 });
    return { file, retried: false };
  } catch (e) {
    // Stop animations, then retry the same composite screenshot (never fall back to a single layer).
    const css = '*{animation:none!important;transition:none!important}';
    await page.addStyleTag({ content: css }).catch(() => {});
    for (const f of page.frames()) await f.addStyleTag({ content: css }).catch(() => {});
    await page.screenshot({ path: file, scale, timeout: 30000 });
    return { file, retried: true, firstError: e.message.split('\n')[0] };
  }
}

// ---------- reload with hooks in place (captures the plugin's own startup) ----------
export async function reloadWindow(session) {
  await session.page.evaluate(() => setTimeout(() => location.reload(), 50));
  await sleep(1500);
  await waitForLayout(session.page);
  await session.page.waitForFunction((id) => !!app.plugins.plugins[id], PLUGIN_ID, { timeout: 15000 });
  await giveFocusBack(session);
}

// Named step lists for --steps @name. Separator ';' so step arguments may contain commas.
export const PRESETS = {
  // End to end: onboarding card, both native prompts, finish, then add + tick a task and read it back from disk.
  e2e: [
    'open', 'wait:3000', 'screenshot:room', 'expect:.cob',
    'button:^(Choose|Change) folder$', 'expectwin:.prompt', 'screenshot:folder-prompt', 'key:Escape', 'wait:800', 'screenshot:after-folder',
    'button:^(Looks right|OK)$', 'wait:400', 'button:^Skip, no weather$|^Skip$', 'wait:400',
    'button:^Add my calendar$', 'expectwin:.modal-container .modal', 'screenshot:calendar-modal', 'key:Escape', 'wait:800',
    'button:^Skip$', 'wait:400', 'screenshot:all-set', 'button:^Enter the room$', 'wait:1500', 'screenshot:room-after-setup',
    'object:agenda', 'expect:.ag-add', 'wait:500', 'screenshot:agenda',
    'fill:.ag-add=Water the herbs', 'key:Enter', 'expect:.ag-task:has-text("Water the herbs")',
    'clickin:.ag-task:has-text("Water the herbs") .cp-check', 'wait:1200', 'findfile:^\\s*- \\[x\\] Water the herbs', 'screenshot:task-ticked',
  ],
};

function splitSteps(text) {
  if (text.startsWith('@')) {
    const p = PRESETS[text.slice(1)];
    if (!p) throw new Error(`Unknown preset ${text} (have: ${Object.keys(PRESETS).join(', ')})`);
    return p;
  }
  return text.split(text.includes(';') ? ';' : ',').map((x) => x.trim()).filter(Boolean);
}

function walkMd(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, out); else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

async function runSteps(session, rec, room, steps, outDir, opts) {
  const results = [];
  let shot = 0;
  const nextShot = (name) => path.join(outDir, `${String(++shot).padStart(2, '0')}-${name.replace(/[^\w.-]+/g, '-').slice(0, 40)}.png`);
  const page = session.page;
  for (const raw of steps) {
    const step = expandDates(raw);
    const [name, ...rest] = step.split(':');
    const arg = rest.join(':');
    const t0 = Date.now();
    const r = { step, ok: true };
    try {
      if (name === 'open') r.result = await room.open({ via: arg || 'palette' });
      // Click a button in the room whose visible text matches the regex (real mouse click).
      else if (name === 'button') {
        const loc = room.frame().locator('button:visible', { hasText: new RegExp(arg, 'i') });
        const n = await loc.count();
        let target = null;
        for (let i = 0; i < n && !target; i++) if (new RegExp(arg, 'i').test((await loc.nth(i).innerText()).trim())) target = loc.nth(i);
        if (!target) throw new Error(`no visible room button matches /${arg}/i; buttons: ${JSON.stringify(await room.frame().locator('button:visible').allInnerTexts().then((t) => t.map((x) => x.trim()).filter(Boolean).slice(0, 15)))}`);
        // Read the label first: the card re-renders on click and the button goes away.
        const label = (await target.innerText({ timeout: 2000 }).catch(() => '?')).trim();
        await target.click({ timeout: 5000 });
        r.result = { clicked: label };
      }
      else if (name === 'clickin') { const loc = room.frame().locator(arg).first(); await loc.click({ timeout: 5000 }); r.result = { clicked: arg }; }
      else if (name === 'fill') {
        const i = arg.lastIndexOf('=');
        const loc = room.frame().locator(arg.slice(0, i)).first();
        await loc.click({ timeout: 5000 });
        await loc.fill(arg.slice(i + 1));
        r.result = { filled: arg.slice(0, i) };
      }
      else if (name === 'key') await page.keyboard.press(arg);
      else if (name === 'type') await page.keyboard.type(arg);
      // Wait for a visible element in the room (expect) or in the Obsidian window (expectwin).
      else if (name === 'expect' || name === 'expectwin') {
        const loc = (name === 'expect' ? room.frame() : page).locator(arg).first();
        await loc.waitFor({ state: 'visible', timeout: 6000 });
        r.result = { visible: arg, text: (await loc.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160) };
      }
      // Search every note of the sandbox vault for a line matching the regex (waits up to 3 s).
      else if (name === 'findfile') {
        const re = new RegExp(arg, 'm');
        let hits = [];
        for (let i = 0; i < 30 && !hits.length; i++) {
          hits = walkMd(session.vault.path).flatMap((f) => {
            const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => re.test(l));
            return lines.map((l) => ({ path: path.relative(session.vault.path, f), line: l }));
          });
          if (!hits.length) await sleep(100);
        }
        if (!hits.length) throw new Error(`no note line matches /${arg}/`);
        r.result = { hits };
      }
      else if (name === 'wait') await sleep(+arg || 1000);
      // Every hotspot button in the room: rect (CSS px in the iframe) and whether its centre hits it.
      else if (name === 'hotspots') {
        r.result = await room.frame().evaluate(() => [...document.querySelectorAll('.casa-hot')].map((b) => {
          const q = b.getBoundingClientRect(), cx = q.left + q.width / 2, cy = q.top + q.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          return { id: b.dataset.id, x: Math.round(q.left), y: Math.round(q.top), w: Math.round(q.width), h: Math.round(q.height),
            hits: hit === b || b.contains(hit), top: hit && hit !== b ? hit.tagName.toLowerCase() + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.split(' ')[0] : '') : undefined,
            visibleInView: cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight };
        }));
      }
      else if (name === 'screenshot' || name === 'shot') {
        const file = nextShot(arg || 'shot');
        r.result = await screenshot(session.page, file, opts.scale);
        r.result.file = path.relative(REPO, file);
      } else if (name === 'click') { const [fx, fy] = arg.split('/').map(Number); r.result = await room.click(fx, fy); }
      else if (name === 'object') r.result = await room.clickObject(arg);
      else if (name === 'hide') r.result = await room.hide();
      else if (name === 'show') r.result = await room.show();
      else if (name === 'blank') r.result = await room.blankOnly();
      else if (name === 'read') {
        // Writes from the room are async: wait up to 3 s for the file to appear.
        for (let i = 0; i < 30 && !fs.existsSync(path.join(session.vault.path, arg)); i++) await sleep(100);
        const text = room.readVaultFile(arg);
        r.result = { path: arg, bytes: text.length, text: text.slice(0, 2000) };
      }
      else if (name === 'reload') { await reloadWindow(session); }
      else if (name === 'visibility') r.result = await room.visibility();
      else if (name === 'sidebars') {
        r.result = await session.page.evaluate((off) => {
          const ws = app.workspace;
          if (off) { ws.leftSplit.collapse(); ws.rightSplit.collapse(); } else { ws.leftSplit.expand(); ws.rightSplit.expand(); }
          return { left: ws.leftSplit.collapsed, right: ws.rightSplit.collapsed };
        }, arg !== 'on');
      } else throw new Error(`Unknown step "${name}"`);
    } catch (e) {
      r.ok = false;
      r.error = e.message.split('\n')[0];
      // A failed step leaves a screenshot of what was on screen.
      const file = nextShot('FAIL-' + name);
      await screenshot(page, file, opts.scale).then(() => { r.failShot = path.relative(REPO, file); }, () => {});
    }
    r.ms = Date.now() - t0;
    const fb = await giveFocusBack(session);
    if (fb.tries) r.refocused = fb;
    log(`${r.ok ? 'ok  ' : 'FAIL'} ${step}${r.result ? ' ' + JSON.stringify(r.result).slice(0, 200) : ''}${r.error ? ' -> ' + r.error : ''}`);
    results.push(r);
    if (!r.ok && opts.stopOnFail) break;
  }
  return results;
}

// ---------- CLI ----------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2), { vault: 'empty', width: 1440, height: 900, steps: 'open,wait:3000,screenshot:room', scale: 'css', settle: 1500 });
  const allow = [].concat(a.allow || []).map((x) => new RegExp(x));
  const offline = a.offline === true || a.vault === 'offline';
  const outDir = path.join(OUT, a.vault);
  fs.mkdirSync(path.join(outDir, 'previous'), { recursive: true });
  // Screenshots of the last run move to previous/, so the folder only shows this run.
  for (const f of fs.readdirSync(outDir)) if (/\.(png|json)$/.test(f)) fs.renameSync(path.join(outDir, f), path.join(outDir, 'previous', f));
  let s, code = 0;
  guard(() => s, +(a.timeout || 600));
  const summary = { vault: a.vault, startedAt: new Date().toISOString(), steps: [] };
  try {
    s = await launch({ vault: a.vault, build: a.stub ? 'stub' : (a.build || 'auto'), width: a.width, height: a.height, theme: a.theme, foreground: !!a.foreground });
    Object.assign(summary, { build: s.vault.build, plugin: `${s.vault.manifest.id} ${s.vault.manifest.version}`, vaultPath: path.relative(REPO, s.vault.path), trust: s.trust, separation: s.separation, focusReturned: s.focusReturned, playwright: s.playwright });
    log('plugins:', s.trust, '| separation ok:', s.separation.ok, '| focus back to pid', s.focusReturned && s.focusReturned.front);
    const rec = new Recorder(s.page);
    await rec.start();
    if (!a.noReload) { await reloadWindow(s); log('reloaded with hooks: plugin startup is recorded'); }
    summary.ipcHookSelfTest = await rec.selfTestIpcHook(s.port);
    await sleep(+a.settle);
    const room = new Room(s, rec);
    summary.steps = await runSteps(s, rec, room, splitSteps(String(a.steps)), outDir, { scale: a.scale, stopOnFail: !a.keepGoing });
    await sleep(500);
    const { network, console: cons } = await rec.collect();
    fs.writeFileSync(path.join(outDir, 'network.json'), JSON.stringify(network, null, 2));
    fs.writeFileSync(path.join(outDir, 'console.json'), JSON.stringify(cons, null, 2));
    const errors = cons.filter((c) => (c.kind === 'exception' || c.kind === 'console.error' || c.kind === 'console.assert' || c.kind.endsWith('.error')) && !allow.some((re) => re.test(c.text)));
    const externalAll = network.filter((r) => isExternal(r.url));
    // Obsidian's own requests (e.g. the community plugin deprecation list) are reported, not failed.
    const external = externalAll.filter((r) => r.origin !== 'obsidian');
    summary.counts = { requests: network.length, external: external.length, externalByObsidian: externalAll.length - external.length, consoleErrors: errors.length, warnings: cons.filter((c) => c.kind.includes('warning')).length };
    summary.externalHosts = [...new Set(external.map((r) => `${r.origin} ${new URL(r.url).host}`))];
    summary.obsidianHosts = [...new Set(externalAll.filter((r) => r.origin === 'obsidian').map((r) => new URL(r.url).host))];
    summary.errors = errors.slice(0, 30).map((e) => `[${e.origin}] ${e.kind}: ${String(e.text).split('\n')[0].slice(0, 300)}`);
    const failed = summary.steps.filter((x) => !x.ok);
    if (errors.length) { code = 1; log(`console errors: ${errors.length}`); errors.slice(0, 10).forEach((e) => log(`  [${e.origin}] ${e.kind}: ${String(e.text).split('\n')[0].slice(0, 200)}`)); }
    if (failed.length) { code = 1; log(`failed steps: ${failed.map((x) => x.step).join(', ')}`); }
    if (offline && external.length) { code = 1; log(`offline run made ${external.length} external request(s): ${summary.externalHosts.join(', ')}`); }
    log(`network: ${network.length} requests, ${external.length} external from Casa [${summary.externalHosts.join(', ')}], ${summary.counts.externalByObsidian} from Obsidian itself [${summary.obsidianHosts.join(', ')}] -> ${path.relative(REPO, path.join(outDir, 'network.json'))}`);
  } catch (e) {
    code = 1;
    summary.fatal = e.message;
    console.error('RUN FAILED:', e.message);
  } finally {
    if (s) { summary.closed = await s.close(); log('closed:', JSON.stringify(summary.closed)); }
    summary.exitCode = code;
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    process.exit(code);
  }
}
