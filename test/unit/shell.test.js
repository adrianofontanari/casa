/* Plugin shell tests: router, settings/state store, shell routes, plugin wiring, room shim,
   build.py output. Run: node --test test/unit/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const vm = require('node:vm');
const Module = require('node:module');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'plugin');

// ---------------------------------------------------------------- obsidian stub

const settingNames = [];
function chain(label) {
  // a callable proxy: any property is another chain; calling it records setName, runs add* callbacks,
  // and returns the chain it was read from, so builder calls and DOM-ish calls both work
  const make = (name, parent) => {
    const self = new Proxy(function () {}, {
      get(_t, key) {
        if (key === 'then') return undefined;
        if (key === Symbol.toPrimitive) return () => name;
        return make(String(key), self);
      },
      apply(_t, _this, args) {
        if (name === 'setName') settingNames.push(args[0]);
        if (name.startsWith('add')) args.forEach((a) => { if (typeof a === 'function') a(make(label + '.' + name, null)); });
        return parent || self;
      },
    });
    return self;
  };
  return make(label, null);
}

class Component {
  constructor() { this._events = []; this._cleanups = []; }
  registerEvent(ref) { this._events.push(ref); }
  register(fn) { this._cleanups.push(fn); }
}
class Plugin extends Component {
  constructor(app, manifest) {
    super();
    this.app = app; this.manifest = manifest;
    this.views = {}; this.ribbons = []; this.commands = []; this.tabs = [];
    this.disk = null; this.saves = 0;
  }
  registerView(type, factory) { this.views[type] = factory; }
  addRibbonIcon(icon, title, cb) { this.ribbons.push({ icon, title, cb }); return {}; }
  addCommand(cmd) { this.commands.push(cmd); return cmd; }
  addSettingTab(tab) { this.tabs.push(tab); }
  async loadData() { return this.disk ? JSON.parse(JSON.stringify(this.disk)) : null; }
  async saveData(d) { this.disk = JSON.parse(JSON.stringify(d)); this.saves++; }
}
class ItemView extends Component { constructor(leaf) { super(); this.leaf = leaf; } }
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = chain('container'); } }
class Setting { constructor() { return chain('setting'); } }
class TFile { constructor(p) { this.path = p; } }
const obsidianStub = {
  Plugin, ItemView, PluginSettingTab, Setting, TFile,
  requestUrl: async (p) => ({ status: 200, headers: {}, text: JSON.stringify({ echo: p.url }), arrayBuffer: new ArrayBuffer(0) }),
};
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return obsidianStub;
  return realLoad.call(this, request, parent, isMain);
};

const { createRouter, normaliseRoute } = require(path.join(SRC, 'router.js'));
const TABLE = require(path.join(SRC, 'routes.js'));
const store = require(path.join(SRC, 'store.js'));
const { createShellRoutes, checkVaultPath, checkExternalUrl } = require(path.join(SRC, 'shell-routes.js'));
const { PauseState } = require(path.join(SRC, 'pause.js'));
const { makeHttp } = require(path.join(SRC, 'http.js'));

const quiet = { error() {} };
function missing(spec) { const e = new Error("Cannot find module '" + spec + "'"); e.code = 'MODULE_NOT_FOUND'; return e; }
function loaderFrom(map) {
  return (spec) => {
    if (!(spec in map)) throw missing(spec);
    const v = map[spec];
    if (v instanceof Error) throw v;
    return v;
  };
}

// ---------------------------------------------------------------- router

test('route table covers every CONTRACT route with the right owner', () => {
  const want = {
    shell: ['state', 'settings', 'open', 'link', 'open-settings'],
    vault: ['focus', 'today', 'tasks', 'notes', 'quotes', 'onboarding'],
    integrations: ['weather', 'forecast', 'geocode', 'air', 'webcam', 'calendar', 'music'],
  };
  for (const [owner, routes] of Object.entries(want)) {
    for (const r of routes) assert.equal(TABLE[r] && TABLE[r].owner, owner, r);
  }
  assert.equal(Object.keys(TABLE).length, 18);
});

test('normaliseRoute accepts focus, /focus, /api/focus', () => {
  assert.equal(normaliseRoute('focus'), 'focus');
  assert.equal(normaliseRoute('/focus/'), 'focus');
  assert.equal(normaliseRoute('/api/focus'), 'focus');
});

test('unknown route is 404, traversal is 404', async () => {
  const r = createRouter({ load: loaderFrom({}), log: quiet });
  let res = await r.handle({ route: 'nope', method: 'GET' });
  assert.equal(res.status, 404);
  assert.match(res.json.error, /Unknown route/);
  res = await r.handle({ route: '../vault/index', method: 'GET' });
  assert.equal(res.status, 404);
});

test('table route with no module answers 501, never throws', async () => {
  const r = createRouter({ load: loaderFrom({}), log: quiet });
  for (const route of ['focus', 'tasks', 'weather', 'calendar']) {
    const res = await r.handle({ route, method: 'GET' });
    assert.equal(res.status, 501, route);
    assert.ok(res.json.error);
  }
});

test('handler from index.js routes, then <route>.js, method objects and 405', async () => {
  const r = createRouter({
    log: quiet,
    load: loaderFrom({
      '../vault/index.js': { routes: { focus: (req) => ({ focus: 'x', q: req.query.a }), tasks: { GET: () => ({ today: [] }) } } },
      '../integrations/weather.js': { get: (req, ctx) => ({ temp: 20, hasCtx: ctx.tag }) },
      '../integrations/music.js': async () => ({ tracks: [] }),
    }),
    ctx: { tag: 'ctx' },
  });
  assert.deepEqual(await r.handle({ route: 'focus', method: 'GET', query: { a: '1' } }), { status: 200, json: { focus: 'x', q: '1' } });
  assert.deepEqual(await r.handle({ route: 'tasks', method: 'GET' }), { status: 200, json: { today: [] } });
  assert.equal((await r.handle({ route: 'tasks', method: 'POST', body: {} })).status, 405);
  assert.deepEqual(await r.handle({ route: 'weather', method: 'GET' }), { status: 200, json: { temp: 20, hasCtx: 'ctx' } });
  assert.deepEqual(await r.handle({ route: 'music', method: 'GET' }), { status: 200, json: { tracks: [] } });
  assert.equal((await r.handle({ route: 'air', method: 'GET' })).status, 501);
});

test('route file may export routes{}, table `file` hint, handlers get request merged over ctx', async () => {
  const r = createRouter({
    log: quiet,
    ctx: { app: 'APP', getSettings: () => ({ units: 'metric' }) },
    load: loaderFrom({
      '../integrations/weather.js': { routes: { weather: () => ({ w: 1 }), forecast: () => ({ f: 1 }), geocode: (a, b) => ({ q: a.query.q, ctx2: !!b }) } },
      '../vault/postits.js': { get: (c) => ({ notes: [], app: c.app, units: c.settings.units }), post: (c) => ({ got: c.body }) },
    }),
  });
  assert.deepEqual((await r.handle({ route: 'weather', method: 'GET' })).json, { w: 1 });
  assert.deepEqual((await r.handle({ route: 'forecast', method: 'GET' })).json, { f: 1 });
  assert.deepEqual((await r.handle({ route: 'geocode', method: 'GET', query: { q: 'Oslo' } })).json, { q: 'Oslo', ctx2: true });
  assert.deepEqual((await r.handle({ route: 'notes', method: 'GET' })).json, { notes: [], app: 'APP', units: 'metric' });
  assert.deepEqual((await r.handle({ route: 'notes', method: 'POST', body: { op: 'add' } })).json, { got: { op: 'add' } });
});

test('errors: throw -> 500, error.status -> that status, {status,json} reply, load error -> 500', async () => {
  const stale = Object.assign(new Error('stale'), { status: 412 });
  const r = createRouter({
    log: quiet,
    load: loaderFrom({
      '../vault/index.js': { routes: {
        focus: () => { throw new Error('boom'); },
        tasks: () => { throw stale; },
        notes: () => ({ status: 201, json: { notes: [] } }),
        quotes: () => { const o = {}; o.self = o; return o; },
      } },
      '../integrations/index.js': new SyntaxError('Unexpected token'),
    }),
  });
  let res = await r.handle({ route: 'focus', method: 'GET' });
  assert.equal(res.status, 500); assert.equal(res.json.error, 'boom');
  res = await r.handle({ route: 'tasks', method: 'POST', body: { op: 'toggle' } });
  assert.deepEqual(res, { status: 412, json: { error: 'stale' } });
  assert.deepEqual(await r.handle({ route: 'notes', method: 'GET' }), { status: 201, json: { notes: [] } });
  assert.equal((await r.handle({ route: 'quotes', method: 'GET' })).status, 500);
  res = await r.handle({ route: 'weather', method: 'GET' });
  assert.equal(res.status, 500); assert.match(res.json.error, /failed to load/);
});

test('extra routes from an index.js, setup(ctx) runs once, dispose runs cleanups', async () => {
  let setups = 0; let disposed = 0;
  const r = createRouter({
    log: quiet,
    ctx: { name: 'c' },
    load: loaderFrom({ '../vault/index.js': { setup: (ctx) => { setups++; assert.equal(ctx.name, 'c'); return () => { disposed++; }; }, routes: { daily: () => ({ ok: 1 }) } } }),
  });
  await r.preload();
  assert.deepEqual(await r.handle({ route: 'daily', method: 'GET' }), { status: 200, json: { ok: 1 } });
  await r.handle({ route: 'daily', method: 'GET' });
  assert.equal(setups, 1);
  r.dispose();
  assert.equal(disposed, 1);
});

test('oversized body is 413', async () => {
  const r = createRouter({ load: loaderFrom({ '../vault/index.js': { routes: { notes: () => ({}) } } }), log: quiet });
  const res = await r.handle({ route: 'notes', method: 'POST', body: { text: 'x'.repeat(2 * 1024 * 1024 + 10) } });
  assert.equal(res.status, 413);
});

// ---------------------------------------------------------------- store + shell routes

test('settings: defaults, partial merge, unknown keys dropped, bad value rejects the whole patch', () => {
  const s = store.createStore({ delay: 5 });
  s.load(null);
  assert.deepEqual(s.getSettings(), Object.assign({}, store.DEFAULT_SETTINGS));
  const next = s.updateSettings({ units: 'imperial', calm: true, junk: 1, city: { name: 'Lisbon', lat: '38.7', lon: -9.1 } });
  assert.equal(next.units, 'imperial');
  assert.equal(next.calm, true);
  assert.deepEqual(next.city, { name: 'Lisbon', lat: 38.7, lon: -9.1 });
  assert.ok(!('junk' in next));
  assert.throws(() => s.updateSettings({ calm: false, units: 'furlongs' }), (e) => e.status === 400);
  assert.equal(s.getSettings().calm, true, 'nothing applied from a rejected patch');
  assert.throws(() => s.updateSettings({ city: { name: 'X', lat: 200, lon: 0 } }), (e) => e.status === 400);
  assert.throws(() => s.updateSettings({ calendarUrl: 'file:///etc/passwd' }), (e) => e.status === 400);
  assert.equal(s.updateSettings({ calendarUrl: ' webcal://example.com/a.ics ' }).calendarUrl, 'webcal://example.com/a.ics');
  assert.equal(s.updateSettings({ city: null }).city, null);
  for (const k of ['weatherOn', 'webcamOn', 'airOn', 'musicOn']) assert.equal(typeof s.getSettings()[k], 'boolean', k);
});

test('settings from disk keep valid keys and repair bad ones', () => {
  const got = store.settingsFromDisk({ units: 'imperial', calm: 'yes', buddy: false, extra: 1 });
  assert.equal(got.units, 'imperial');
  assert.equal(got.calm, false);
  assert.equal(got.buddy, false);
  assert.ok(!('extra' in got));
});

test('state merge: keys merge, null deletes, {state:{...}} form accepted', () => {
  let st = store.mergeState({}, { a: 1, b: { c: 2 } });
  st = store.mergeState(st, { state: { a: null, d: 'x' } });
  assert.deepEqual(st, { b: { c: 2 }, d: 'x' });
  assert.throws(() => store.mergeState({}, [1]), (e) => e.status === 400);
});

test('store saves once per burst (debounced) and flush saves now', async () => {
  const saved = [];
  const s = store.createStore({ delay: 20, save: async (d) => { saved.push(d); } });
  s.load({});
  s.updateState({ a: 1 }); s.updateState({ b: 2 }); s.updateSettings({ calm: true });
  assert.equal(saved.length, 0);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].state, { a: 1, b: 2 });
  assert.equal(saved[0].settings.calm, true);
  s.setMeta('firstOpenDone', true);
  await s.flush();
  assert.equal(saved.length, 2);
  assert.equal(s.pending(), false);
});

test('shell routes: state, settings, open, link', async () => {
  const s = store.createStore({ delay: 1000 });
  s.load({});
  const opened = []; const links = []; const notes = [];
  const shell = createShellRoutes({
    store: s,
    openNote: async (p, o) => { opened.push([p, o]); return p === 'Daily/2026-01-01.md'; },
    openUrl: (u) => { links.push(u); },
    notify: (k) => notes.push(k),
  });
  const r = createRouter({ shell, load: loaderFrom({}), log: quiet });
  assert.deepEqual((await r.handle({ route: 'state', method: 'POST', body: { lamp: true } })).json, { ok: true, state: { lamp: true } });
  assert.deepEqual((await r.handle({ route: 'state', method: 'GET' })).json, { lamp: true });
  const set = await r.handle({ route: 'settings', method: 'POST', body: { buddy: false } });
  assert.equal(set.status, 200); assert.equal(set.json.buddy, false); assert.deepEqual(notes, ['settings']);
  assert.equal((await r.handle({ route: 'settings', method: 'POST', body: { units: 1 } })).status, 400);
  assert.deepEqual(await r.handle({ route: 'open', method: 'POST', body: { path: 'Daily/2026-01-01.md', line: 4 } }), { status: 200, json: { ok: true } });
  assert.deepEqual(opened[0], ['Daily/2026-01-01.md', { line: 4, newTab: false }]);
  assert.equal((await r.handle({ route: 'open', method: 'POST', body: { path: 'Missing.md' } })).status, 404);
  assert.equal((await r.handle({ route: 'open', method: 'POST', body: { path: '../outside.md' } })).status, 400);
  assert.equal((await r.handle({ route: 'open', method: 'GET' })).status, 405);
  assert.deepEqual((await r.handle({ route: 'link', method: 'POST', body: { url: 'https://casa.adrianofontanari.com/#notify' } })).json, { ok: true });
  assert.equal((await r.handle({ route: 'link', method: 'POST', body: { url: 'http://example.com' } })).status, 400);
  assert.equal((await r.handle({ route: 'link', method: 'POST', body: { url: 'javascript:alert(1)' } })).status, 400);
  assert.deepEqual(links, ['https://casa.adrianofontanari.com/#notify']);
  assert.throws(() => checkVaultPath('/etc/hosts'));
  assert.throws(() => checkExternalUrl('https://user:pw@example.com'));
});

test('security: the room cannot set URL or path settings (SSRF), only the allowlist', async () => {
  const s = store.createStore({ delay: 1000 });
  s.load({});
  const notes = [];
  const r = createRouter({ shell: createShellRoutes({ store: s, notify: (k) => notes.push(k) }), load: loaderFrom({}), log: quiet });

  let res = await r.handle({ route: 'settings', method: 'POST', body: { webcamUrl: 'http://192.168.1.1/' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.ignored, ['webcamUrl']);
  assert.equal(s.getSettings().webcamUrl, '', 'LAN webcam URL not stored');

  res = await r.handle({ route: 'settings', method: 'POST', body: {
    calm: true, airUrl: 'http://10.0.0.5/data.json', calendarUrl: 'http://localhost:8080/a.ics',
    dailyFolder: '../..', dailyFormat: 'x', dailyTemplate: 'x.md', weatherOn: false, __proto__x: 1,
  } });
  assert.equal(res.status, 200);
  assert.equal(res.json.calm, true, 'allowlisted key applied');
  assert.deepEqual(res.json.ignored.sort(), ['__proto__x', 'airUrl', 'calendarUrl', 'dailyFolder', 'dailyFormat', 'dailyTemplate', 'weatherOn'].sort());
  const now = s.getSettings();
  assert.equal(now.airUrl, ''); assert.equal(now.calendarUrl, ''); assert.equal(now.dailyFolder, ''); assert.equal(now.weatherOn, true);

  // every allowlisted key is writable from the room
  res = await r.handle({ route: 'settings', method: 'POST', body: { calm: false, buddy: false, units: 'imperial', musicOn: false, webcamOn: false, airOn: false, onboarded: true, city: { name: 'Oslo', lat: 59.91, lon: 10.75 } } });
  assert.deepEqual(res.json.ignored, []);
  assert.deepEqual(store.ROOM_WRITABLE.slice().sort(), ['airOn', 'buddy', 'calm', 'city', 'musicOn', 'onboarded', 'units', 'webcamOn']);

  // the room may finish the welcome but never reopen it (reopening is a settings-tab action)
  res = await r.handle({ route: 'settings', method: 'POST', body: { onboarded: false } });
  assert.deepEqual(res.json.ignored, ['onboarded']);
  assert.equal(s.getSettings().onboarded, true, 'room cannot reset onboarding');
  s.updateSettings({ onboarded: false });
  assert.equal(s.getSettings().onboarded, false, 'settings tab can reset onboarding');
  res = await r.handle({ route: 'settings', method: 'POST', body: { onboarded: true } });
  assert.deepEqual(res.json.ignored, []);
  assert.equal(s.getSettings().onboarded, true, 'room can finish onboarding');

  // the settings tab (trusted) can set URLs; the room only sees whether they are set
  s.updateSettings({ calendarUrl: 'https://calendar.example.com/private/abc.ics', webcamUrl: 'http://192.168.1.20/cam.jpg' });
  const seen = (await r.handle({ route: 'settings', method: 'GET' })).json;
  assert.equal(seen.calendarUrl, '(set)'); assert.equal(seen.webcamUrl, '(set)'); assert.equal(seen.airUrl, '');
  assert.ok(!JSON.stringify(seen).includes('abc.ics'));
  assert.equal(s.getSettings().calendarUrl, 'https://calendar.example.com/private/abc.ics');
});

test('security: city validation rejects bad input and applies nothing', async () => {
  const s = store.createStore({ delay: 1000 });
  s.load({});
  const r = createRouter({ shell: createShellRoutes({ store: s }), load: loaderFrom({}), log: quiet });
  const bads = [
    { name: 'x'.repeat(81), lat: 1, lon: 1 },
    { name: 'Nowhere', lat: 91, lon: 0 },
    { name: 'Nowhere', lat: -90.5, lon: 0 },
    { name: 'Nowhere', lat: 0, lon: 180.01 },
    { name: 'Nowhere', lat: 0, lon: -181 },
    { name: '', lat: 0, lon: 0 },
    { name: '   ', lat: 0, lon: 0 },
    { name: 42, lat: 0, lon: 0 },
    { name: 'Nowhere', lat: 'abc', lon: 0 },
    { name: 'Nowhere', lat: null, lon: 0 },
    { name: 'Nowhere', lat: [], lon: 0 },
    { name: 'Nowhere' },
    'Lisbon',
    42,
  ];
  for (const city of bads) {
    const res = await r.handle({ route: 'settings', method: 'POST', body: { calm: true, city } });
    assert.equal(res.status, 400, JSON.stringify(city));
    assert.match(res.json.error, /city/);
  }
  assert.equal(s.getSettings().city, null);
  assert.equal(s.getSettings().calm, false, 'nothing applied from a rejected patch');
  const ok = await r.handle({ route: 'settings', method: 'POST', body: { city: { name: 'x'.repeat(80), lat: -90, lon: 180 } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.city.name.length, 80);
});

test('open-settings: POST opens the settings tab, 501 when it cannot, GET is 405', async () => {
  const s = store.createStore({ delay: 1000 });
  s.load({});
  let opened = 0;
  let r = createRouter({ shell: createShellRoutes({ store: s, openSettings: () => { opened++; return true; } }), load: loaderFrom({}), log: quiet });
  assert.deepEqual(await r.handle({ route: 'open-settings', method: 'POST' }), { status: 200, json: { ok: true } });
  assert.equal(opened, 1);
  assert.equal((await r.handle({ route: 'open-settings', method: 'GET' })).status, 405);
  r = createRouter({ shell: createShellRoutes({ store: s, openSettings: () => false }), load: loaderFrom({}), log: quiet });
  assert.equal((await r.handle({ route: 'open-settings', method: 'POST' })).status, 501);
});

test('pause state posts only on change, force re-posts', () => {
  const posts = [];
  const p = new PauseState((v) => posts.push(v));
  p.force();
  p.set('inView', false); p.set('inView', false); p.set('focused', false); p.set('inView', true); p.set('focused', true);
  p.force();
  assert.deepEqual(posts, [false, true, false, false]);
});

test('http adapter wraps requestUrl: lazy json, null for non JSON, timeout', async () => {
  const http = makeHttp(async (p) => ({ status: 200, headers: {}, text: p.url.endsWith('bad') ? 'nope' : '{"a":1}', arrayBuffer: null }));
  const ok = await http('https://example.com/x');
  assert.equal(ok.status, 200); assert.deepEqual(ok.json, { a: 1 });
  assert.equal((await http('https://example.com/bad')).json, null);
  const slow = makeHttp(() => new Promise(() => {}), { timeout: 20 });
  await assert.rejects(slow('https://example.com/slow'), /timed out/);
});

// ---------------------------------------------------------------- plugin wiring (obsidian stub)

function fakeApp() {
  const leaves = [];
  const app = {
    leaves,
    workspace: {
      on: (name, fn) => ({ name, fn }),
      onLayoutReady: (fn) => fn(),
      getLeavesOfType: (t) => leaves.filter((l) => l.type === t),
      getLeaf: () => {
        const leaf = {
          type: null, view: null, files: [],
          async setViewState(s) { leaf.type = s.type; leaves.push(leaf); },
          async openFile(f, st) { leaf.files.push([f.path, st]); },
        };
        return leaf;
      },
      revealLeaf: async () => {},
    },
    vault: { getAbstractFileByPath: (p) => (p === 'Note.md' ? new TFile(p) : null) },
  };
  return app;
}

test('plugin onload: view, ribbon, commands, settings tab, first open once, bridge replies', async () => {
  const opened = [];
  global.window = new EventTarget();
  global.window.open = (u) => opened.push(u);
  delete require.cache[path.join(SRC, 'main.js')];
  const CasaPlugin = require(path.join(SRC, 'main.js'));
  assert.equal(CasaPlugin.default, CasaPlugin);
  const app = fakeApp();
  const plugin = new CasaPlugin(app, { id: 'casa' });
  plugin.manifest = { id: 'casa' };
  await plugin.onload();
  assert.equal(typeof plugin.views['casa-room'], 'function');
  assert.deepEqual(plugin.ribbons.map((r) => r.icon), ['home']);
  assert.deepEqual(plugin.commands.map((c) => [c.id, c.name]), [['open-room', 'Open room'], ['open-room-new-tab', 'Open room in a new tab']]);
  assert.equal(plugin.tabs.length, 1);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(app.leaves.length, 1, 'first load opens the room once');
  assert.equal(app.leaves[0].type, 'casa-room');
  plugin.onUserEnable();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(app.leaves.length, 1, 'not twice');
  assert.equal(plugin.disk.meta.firstOpenDone, true);

  // the view constructs (no DOM needed until onOpen)
  const view = plugin.views['casa-room']({});
  assert.equal(view.getViewType(), 'casa-room');
  assert.equal(view.getDisplayText(), 'Casa');
  assert.equal(view.getIcon(), 'home');

  // bridge: only frames owned by a Casa view get an answer
  const replies = [];
  const source = { postMessage: (m) => replies.push(m) };
  plugin.attachView({ ownsSource: (s) => s === source, post() {}, recheck() {}, teardown() {} });
  await plugin.handleMessage({ data: { casa: 1, id: 7, route: 'settings', method: 'GET', query: {} }, source });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 7); assert.equal(replies[0].status, 200); assert.equal(replies[0].json.units, 'metric');
  await plugin.handleMessage({ data: { casa: 1, id: 8, route: 'settings', method: 'GET' }, source: { postMessage: (m) => replies.push(m) } });
  assert.equal(replies.length, 1, 'foreign frame ignored');
  await plugin.handleMessage({ data: { casa: 1, id: 9, route: 'open', method: 'POST', body: { path: 'Note.md' } }, source });
  assert.equal(replies[1].status, 200);
  await plugin.handleMessage({ data: { casa: 1, id: 10, route: 'link', method: 'POST', body: { url: 'https://example.com/' } }, source });
  assert.deepEqual(opened, ['https://example.com/']);
  await plugin.handleMessage({ data: { casa: 1, id: 11, route: 'weather', method: 'GET' }, source });
  assert.ok([200, 501].includes(replies[3].status), 'weather answers 200 once the integration exists, 501 before');
  const tabs = [];
  app.setting = { open() { tabs.push('open'); }, openTabById(id) { tabs.push(id); } };
  await plugin.handleMessage({ data: { casa: 1, id: 12, route: 'open-settings', method: 'POST' }, source });
  assert.equal(replies[4].status, 200);
  assert.deepEqual(tabs, ['open', 'casa']);

  // the settings tab renders every setting without throwing
  settingNames.length = 0;
  plugin.tabs[0].display();
  for (const name of ['Calm mode', 'Show buddy', 'Units', 'Music', 'Weather data', 'City', 'Find a city', 'Calendar link (ICS)',
    'Webcam', 'Webcam image link', 'Air quality', 'Air quality sensor link', 'Daily notes source', 'Run the welcome again']) {
    assert.ok(settingNames.includes(name), 'setting ' + name);
  }
  await plugin.runWelcomeAgain();
  assert.equal(plugin.getSettings().onboarded, false);
  plugin.onunload();
  await new Promise((r) => setTimeout(r, 10));
  delete global.window;
});

// ---------------------------------------------------------------- room shim (vm, fake window)

function loadShim() {
  const posted = [];
  const host = { postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) };
  class Doc extends EventTarget {}
  Object.defineProperty(Doc.prototype, 'visibilityState', { configurable: true, get: () => 'visible' });
  Object.defineProperty(Doc.prototype, 'hidden', { configurable: true, get: () => false });
  const document = new Doc();
  document.baseURI = 'app://obsidian.md/index.html';
  const win = new EventTarget();
  const realFetchCalls = [];
  Object.assign(win, {
    document, parent: host, setTimeout, clearTimeout, URL, URLSearchParams, Response, CustomEvent, Event, DOMException, Map, Array, Object, JSON, Promise,
    fetch: async (u) => { realFetchCalls.push(u); return new Response('real'); },
  });
  Object.defineProperty(win, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'room-side', 'shim.js'), 'utf8'), ctx, { filename: 'shim.js' });
  const deliver = (data, source) => {
    const ev = new Event('message');
    Object.defineProperty(ev, 'data', { value: data });
    Object.defineProperty(ev, 'source', { value: source === undefined ? host : source });
    win.dispatchEvent(ev);
  };
  return { win, document, posted, deliver, realFetchCalls };
}

test('shim: fetch /api/... becomes postMessage and resolves a Response', async () => {
  const { win, posted, deliver, realFetchCalls } = loadShim();
  const p = win.fetch('/api/tasks?when=today', { method: 'POST', body: JSON.stringify({ op: 'add', text: 'x' }) });
  assert.deepEqual(posted[0], { casa: 1, id: 1, route: 'tasks', method: 'POST', query: { when: 'today' }, body: { op: 'add', text: 'x' } });
  deliver({ casa: 1, id: 1, status: 412, json: { error: 'stale' } }, {});   // wrong source: ignored
  deliver({ casa: 1, id: 1, status: 412, json: { error: 'stale' } });
  const res = await p;
  assert.equal(res.status, 412);
  assert.equal(res.ok, false);
  assert.deepEqual(await res.json(), { error: 'stale' });
  const g = win.fetch('/api/focus');
  assert.deepEqual(posted[1], { casa: 1, id: 2, route: 'focus', method: 'GET', query: {}, body: null });
  deliver({ casa: 1, id: 2, status: 200, json: { focus: 'Ship it' } });
  assert.equal((await (await g).json()).focus, 'Ship it');
  await win.fetch('data:text/plain,hi');
  assert.deepEqual(realFetchCalls, ['data:text/plain,hi']);
});

test('shim: pause/resume events, visibilityState follows, casa:data re-dispatched, storage and links', async () => {
  const { win, document, posted, deliver } = loadShim();
  const seen = [];
  for (const t of ['casa:pause', 'casa:resume', 'visibilitychange', 'casa:data']) document.addEventListener(t, (e) => seen.push([t, e.detail || null]));
  deliver({ casa: 1, pause: true });
  deliver({ casa: 1, pause: true });
  assert.equal(document.visibilityState, 'hidden');
  assert.equal(document.hidden, true);
  assert.equal(win.CasaBridge.isPaused(), true);
  deliver({ casa: 1, pause: false });
  assert.equal(document.visibilityState, 'visible');
  deliver({ casa: 1, event: 'casa:data', detail: { kind: 'settings' } });
  deliver({ casa: 1, event: 'not-casa', detail: {} });
  assert.deepEqual(seen, [['casa:pause', null], ['visibilitychange', null], ['casa:resume', null], ['visibilitychange', null], ['casa:data', { kind: 'settings' }]]);
  win.localStorage.setItem('k', 1);
  assert.equal(win.localStorage.getItem('k'), '1');
  win.open('https://example.com/a');
  assert.deepEqual(posted.at(-1), { casa: 1, id: 1, route: 'link', method: 'POST', query: {}, body: { url: 'https://example.com/a' } });
  deliver({ casa: 1, id: 1, status: 200, json: { ok: true } });   // settle it so no timer stays pending
});

// ---------------------------------------------------------------- build.py

function runBuild(args, cwd) {
  return spawnSync('python3', ['-I', path.join(ROOT, 'build.py')].concat(args), { cwd: cwd || os.tmpdir(), encoding: 'utf8' });
}

test('build.py: builds, node --check passes, room has the shim and no dev files', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'casa-dist-'));
  const r = runBuild(['--dist', dist]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /main\.js ok \(node --check\)/);
  for (const f of ['main.js', 'manifest.json', 'styles.css']) assert.ok(fs.existsSync(path.join(dist, f)), f);
  const main = fs.readFileSync(path.join(dist, 'main.js'), 'utf8');
  execFileSync(process.execPath, ['--check', path.join(dist, 'main.js')]);
  // pull the room document out of the bundle
  const m = /var __casaRoomDoc = ("(?:[^"\\]|\\.)*");/.exec(main);
  assert.ok(m, 'room document literal');
  const room = JSON.parse(m[1]);
  assert.match(room, /window\.CasaBridge = \{/);
  assert.match(room, /Content-Security-Policy/);
  assert.ok(room.indexOf('casa-room/bridge-shim.js') < (room.indexOf('casa-room/engine/') === -1 ? Infinity : room.indexOf('casa-room/engine/')), 'shim first');
  assert.ok(!/src\/room\/dev|casa-room\/dev\/|__mockDB/.test(room), 'no dev files in the room');
  assert.ok(!/\/Users\//.test(main), 'no local paths in main.js');
  // the bundle loads as CommonJS with the obsidian stub and exports the plugin class
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', main)(mod, mod.exports, (id) => (id === 'obsidian' ? obsidianStub : require(id)));
  assert.equal(typeof mod.exports, 'function');
  assert.equal(mod.exports.default, mod.exports);
  assert.equal(mod.exports.VIEW_TYPE, 'casa-room');
  fs.rmSync(dist, { recursive: true, force: true });
});

test('build.py fails loudly on a syntax error and skips dev files listed in order.txt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'casa-root-'));
  fs.mkdirSync(path.join(root, 'src/plugin/room-side'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/room/dev'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/vault'), { recursive: true });
  fs.copyFileSync(path.join(SRC, 'room-side/shim.js'), path.join(root, 'src/plugin/room-side/shim.js'));
  fs.writeFileSync(path.join(root, 'src/plugin/main.js'), 'module.exports = class {};\n');
  fs.writeFileSync(path.join(root, 'src/room/dev/mock.js'), 'window.__mockDB = 1;\n');
  fs.writeFileSync(path.join(root, 'src/room/a.js'), 'window.A = 1;\n');
  fs.writeFileSync(path.join(root, 'src/room/order.txt'), '# order\na.js   # first\ndev/mock.js\nmissing.js\n');
  const dist = path.join(root, 'dist');
  let r = runBuild(['--root', root, '--dist', dist]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /dev file, never bundled/);
  assert.match(r.stderr, /'missing\.js' not found/);
  const main = fs.readFileSync(path.join(dist, 'main.js'), 'utf8');
  assert.ok(main.includes('window.A = 1;'));
  assert.ok(!main.includes('__mockDB'));

  fs.writeFileSync(path.join(root, 'src/vault/broken.js'), 'module.exports = function ( {\n');
  r = runBuild(['--root', root, '--dist', dist]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SYNTAX src\/vault\/broken\.js/);
  fs.rmSync(path.join(root, 'src/vault/broken.js'));

  fs.writeFileSync(path.join(root, 'src/room/a.js'), 'window.A = ;\n');
  r = runBuild(['--root', root, '--dist', dist]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SYNTAX src\/room\/a\.js/);
  fs.rmSync(root, { recursive: true, force: true });
});
