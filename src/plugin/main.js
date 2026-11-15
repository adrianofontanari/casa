/* Casa plugin entry: the room view (an iframe), the bridge between the room and the vault,
   commands, settings and pause handling. See docs/dev/shell.md. */
const obsidian = require('obsidian');
const { Plugin, ItemView, TFile } = obsidian;
const { createRouter } = require('./router.js');
const { createStore } = require('./store.js');
const { createShellRoutes } = require('./shell-routes.js');
const { PauseState } = require('./pause.js');
const { makeHttp } = require('./http.js');
const { CasaSettingTab } = require('./settings.js');

const VIEW_TYPE = 'casa-room';
const NOT_BUILT = '<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;padding:24px">' +
  'Casa is not built. Run python3 -I build.py.</p>';

let roomDocCache;
function roomDoc() {
  if (roomDocCache === undefined) {
    try { roomDocCache = require('./room-doc.generated.js'); } catch (e) { roomDocCache = NOT_BUILT; }
  }
  return roomDocCache;
}

function hasBox(el) {
  return !!(el && el.isConnected && el.getClientRects().length > 0 && el.offsetWidth > 0 && el.offsetHeight > 0);
}

class CasaView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.frame = null;
    this.pause = null;
    this.cleanups = [];
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Casa'; }
  getIcon() { return 'home'; }

  async onOpen() {
    this.teardown();
    const el = this.contentEl;
    el.empty();
    el.addClass('casa-view');
    const doc = el.ownerDocument;
    const win = doc.defaultView || window;

    const frame = doc.createElement('iframe');
    frame.className = 'casa-frame';
    // allow-scripts only: the room gets an opaque origin, so it cannot reach Obsidian,
    // Node or the vault except through the postMessage bridge. No popups, no forms,
    // no top navigation. See docs/dev/shell.md.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', 'Casa room');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = roomDoc();
    this.frame = frame;
    this.pause = new PauseState((paused) => this.post({ casa: 1, pause: paused }));

    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn, opts));
    };
    // a reloaded room starts unpaused: tell it the current state
    on(frame, 'load', () => { if (this.pause) this.pause.force(); });
    on(doc, 'visibilitychange', () => this.pause && this.pause.set('docVisible', doc.visibilityState === 'visible'));
    on(win, 'focus', () => this.pause && this.pause.set('focused', true));
    // focus moving into the room iframe also blurs the window: hasFocus() still says true then
    on(win, 'blur', () => win.setTimeout(() => this.pause && this.pause.set('focused', doc.hasFocus()), 0));

    const IO = win.IntersectionObserver;
    if (typeof IO === 'function') {
      const io = new IO((entries) => {
        const e = entries[entries.length - 1];
        if (this.pause && e) this.pause.set('inView', e.isIntersecting && e.boundingClientRect.width > 0);
      });
      io.observe(frame);
      this.cleanups.push(() => io.disconnect());
    }

    el.appendChild(frame);
    this.pause.signals.docVisible = doc.visibilityState === 'visible';
    this.pause.signals.focused = doc.hasFocus();
    this.pause.signals.inView = hasBox(frame);
    this.plugin.attachView(this);
  }

  /* re-read the box after workspace changes (tab switch, sidebar collapse, resize) */
  recheck() {
    if (this.pause && this.frame) this.pause.set('inView', hasBox(this.frame));
  }

  onResize() {
    this.recheck();
  }

  post(msg) {
    const w = this.frame && this.frame.contentWindow;
    if (w) w.postMessage(msg, '*');
  }

  ownsSource(source) {
    return !!(this.frame && source && this.frame.contentWindow === source);
  }

  teardown() {
    while (this.cleanups.length) {
      try { this.cleanups.pop()(); } catch (e) { /* ignore */ }
    }
    if (this.frame) this.frame.remove();
    this.frame = null;
    this.pause = null;
  }

  async onClose() {
    this.plugin.detachView(this);
    this.teardown();
  }
}

class CasaPlugin extends Plugin {
  onload() {
    this.ready = this.setup();
    return this.ready;
  }

  async setup() {
    this.views = new Set();
    this.windows = new Set();
    this.store = createStore({ save: (data) => this.saveData(data), delay: 500 });
    this.store.load(await this.loadData());
    this.http = makeHttp(obsidian.requestUrl);
    this.ctx = this.makeContext();
    this.router = createRouter({
      ctx: this.ctx,
      shell: createShellRoutes({
        store: this.store,
        openNote: (path, opts) => this.openNote(path, opts),
        openUrl: (url) => this.openUrl(url),
        openSettings: () => this.openSettings(),
        notify: (kind) => this.notify(kind),
      }),
    });

    this.registerView(VIEW_TYPE, (leaf) => new CasaView(leaf, this));
    this.addRibbonIcon('home', 'Open Casa', () => { this.openRoom(false); });
    this.addCommand({ id: 'open-room', name: 'Open room', callback: () => { this.openRoom(false); } });
    this.addCommand({ id: 'open-room-new-tab', name: 'Open room in a new tab', callback: () => { this.openRoom(true); } });
    this.addSettingTab(new CasaSettingTab(this.app, this));

    this.onMessage = (ev) => { this.handleMessage(ev); };
    this.watchWindow(window);
    const ws = this.app.workspace;
    this.registerEvent(ws.on('window-open', (_w, win) => this.watchWindow(win)));
    this.registerEvent(ws.on('window-close', (_w, win) => this.unwatchWindow(win)));
    const recheck = () => this.views.forEach((v) => v.recheck());
    this.registerEvent(ws.on('layout-change', recheck));
    this.registerEvent(ws.on('active-leaf-change', recheck));
    this.registerEvent(ws.on('resize', recheck));

    ws.onLayoutReady(() => {
      this.router.preload();
      this.firstOpen();
    });
  }

  onUserEnable() {
    Promise.resolve(this.ready).then(() => this.firstOpen());
  }

  async onExternalSettingsChange() {
    await this.ready;
    this.store.load(await this.loadData());
    this.notify('settings');
  }

  onunload() {
    if (this.store) this.store.flush();
    if (this.router) this.router.dispose();
    if (this.windows) for (const w of Array.from(this.windows)) this.unwatchWindow(w);
    if (this.views) for (const v of Array.from(this.views)) v.teardown();
  }

  makeContext() {
    return {
      app: this.app,
      plugin: this,
      obsidian: obsidian,
      moment: obsidian.moment,
      http: this.http,
      requestUrl: obsidian.requestUrl,
      getSettings: () => this.store.getSettings(),
      saveSettings: (patch) => this.updateSettings(patch),
      getState: () => this.store.getState(),
      setState: (patch) => this.store.updateState(patch),
      getData: (ns) => this.store.getMod(ns),
      setData: (ns, value) => this.store.setMod(ns, value),
      notify: (kind, detail) => this.notify(kind, detail),
      registerEvent: (ref) => this.registerEvent(ref),
    };
  }

  // ---- first run
  firstOpen() {
    if (!this.store || this.store.getMeta('firstOpenDone')) return;
    this.store.setMeta('firstOpenDone', true);
    this.store.flush();
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length === 0) this.openRoom(true);
  }

  // ---- views and windows
  attachView(view) { this.views.add(view); }
  detachView(view) { this.views.delete(view); }

  watchWindow(win) {
    if (!win || this.windows.has(win)) return;
    win.addEventListener('message', this.onMessage);
    this.windows.add(win);
  }

  unwatchWindow(win) {
    if (!win || !this.windows.has(win)) return;
    win.removeEventListener('message', this.onMessage);
    this.windows.delete(win);
  }

  async openRoom(newTab) {
    const ws = this.app.workspace;
    let leaf = newTab ? null : ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = ws.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await ws.revealLeaf(leaf);
    return leaf;
  }

  // ---- bridge
  async handleMessage(ev) {
    const d = ev && ev.data;
    if (!d || d.casa !== 1 || d.id == null || typeof d.route !== 'string') return;
    let view = null;
    for (const v of this.views) if (v.ownsSource(ev.source)) { view = v; break; }
    if (!view) return;   // only our own room frames may use the bridge
    const reply = await this.router.handle(d);
    try {
      ev.source.postMessage({ casa: 1, id: d.id, status: reply.status, json: reply.json }, '*');
    } catch (e) { /* frame closed meanwhile */ }
  }

  callRoute(route, method, query, body) {
    return this.router.handle({ route: route, method: method || 'GET', query: query || {}, body: body == null ? null : body });
  }

  postAll(msg) {
    if (!this.views) return;
    this.views.forEach((v) => { try { v.post(msg); } catch (e) { /* ignore */ } });
  }

  notify(kind, detail) {
    this.postAll({ casa: 1, event: 'casa:data', detail: Object.assign({ kind: kind }, detail || {}) });
  }

  // ---- settings
  getSettings() { return this.store.getSettings(); }

  updateSettings(patch) {
    const next = this.store.updateSettings(patch);
    this.notify('settings');
    return next;
  }

  async runWelcomeAgain() {
    this.updateSettings({ onboarded: false });
    this.postAll({ casa: 1, event: 'casa:welcome', detail: {} });
    await this.openRoom(false);
  }

  // ---- shell route helpers
  async openNote(path, opts) {
    opts = opts || {};
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    const ws = this.app.workspace;
    let leaf = opts.newTab ? ws.getLeaf('tab') : ws.getLeaf(false);
    if (leaf && leaf.view && typeof leaf.view.getViewType === 'function' && leaf.view.getViewType() === VIEW_TYPE) {
      leaf = ws.getLeaf('tab');   // never replace the room itself
    }
    const state = { active: true };
    if (opts.line != null) state.eState = { line: opts.line };
    await leaf.openFile(file, state);
    return true;
  }

  /* Open Casa's tab in Obsidian's settings. app.setting is not in the public API typings,
     so every step is guarded; false means the room shows its own hint instead. */
  openSettings() {
    const setting = this.app && this.app.setting;
    if (!setting || typeof setting.open !== 'function') return false;
    setting.open();
    if (typeof setting.openTabById === 'function') setting.openTabById(this.manifest.id);
    return true;
  }

  openUrl(url) {
    // Obsidian desktop hands window.open of an https URL to the system browser
    window.open(url, '_blank');
  }
}

module.exports = CasaPlugin;
module.exports.default = CasaPlugin;
module.exports.CasaView = CasaView;
module.exports.VIEW_TYPE = VIEW_TYPE;
