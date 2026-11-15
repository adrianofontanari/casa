/* Plugin data: settings, room state, per-module data and shell flags, saved with
   Plugin.saveData (data.json in the plugin folder). Writes are debounced. */
const { httpError } = require('./router.js');

const DEFAULT_SETTINGS = Object.freeze({
  calm: false,
  buddy: true,
  units: 'metric',
  city: null,
  weatherOn: true,          // every external source has an off switch: off means no request at all
  calendarUrl: '',          // empty = calendar off
  webcamOn: true,
  webcamUrl: '',            // empty = the default webcam image
  airOn: true,
  airUrl: '',               // empty = public data for the city
  musicOn: true,
  onboarded: false,
  dailyMode: 'auto',        // 'auto' = detect from core Daily notes / Periodic Notes / Journals; 'custom' = folder + format below
  dailyFolder: '',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: '',        // optional template note for a new daily note (custom mode)
});

/* The room is untrusted (it renders outside text). It may change only these settings through
   POST /api/settings. URL and path settings change only in the settings tab, so a script injected
   into the room cannot point a fetcher at a LAN address. */
const ROOM_WRITABLE = Object.freeze(['calm', 'buddy', 'units', 'musicOn', 'webcamOn', 'airOn', 'onboarded', 'city']);
// never sent to the room: it only learns whether they are set
const ROOM_HIDDEN = Object.freeze(['calendarUrl', 'webcamUrl', 'airUrl']);
const HIDDEN_MARK = '(set)';

const MAX_STATE_CHARS = 1024 * 1024;

function bad(key, why) {
  return httpError(400, 'Bad value for ' + key + ': ' + why);
}

function checkUrl(key, value, protocols) {
  if (typeof value !== 'string') throw bad(key, 'expected text');
  const v = value.trim();
  if (!v) return '';
  let u;
  try { u = new URL(v); } catch (e) { throw bad(key, 'not a link'); }
  if (protocols.indexOf(u.protocol) === -1) throw bad(key, 'use a link starting with ' + protocols.map((p) => p + '//').join(' or '));
  return v;
}

function checkCity(value) {
  if (value === null || value === '') return null;
  if (!value || typeof value !== 'object') throw bad('city', 'expected {name, lat, lon} or null');
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const lat = typeof value.lat === 'number' || typeof value.lat === 'string' ? Number(value.lat) : NaN;
  const lon = typeof value.lon === 'number' || typeof value.lon === 'string' ? Number(value.lon) : NaN;
  if (!name) throw bad('city', 'missing name');
  if (name.length > 80) throw bad('city', 'name longer than 80 characters');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw bad('city', 'lat out of range');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw bad('city', 'lon out of range');
  return { name: name, lat: lat, lon: lon };
}

function checkBool(key, value) {
  if (typeof value !== 'boolean') throw bad(key, 'expected true or false');
  return value;
}

function checkText(key, value, max) {
  if (typeof value !== 'string') throw bad(key, 'expected text');
  return value.trim().slice(0, max);
}

const CHECKS = {
  calm: (v) => checkBool('calm', v),
  buddy: (v) => checkBool('buddy', v),
  musicOn: (v) => checkBool('musicOn', v),
  weatherOn: (v) => checkBool('weatherOn', v),
  webcamOn: (v) => checkBool('webcamOn', v),
  airOn: (v) => checkBool('airOn', v),
  onboarded: (v) => checkBool('onboarded', v),
  units: (v) => {
    if (v !== 'metric' && v !== 'imperial') throw bad('units', 'expected "metric" or "imperial"');
    return v;
  },
  city: checkCity,
  calendarUrl: (v) => checkUrl('calendarUrl', v, ['https:', 'http:', 'webcal:']),
  webcamUrl: (v) => checkUrl('webcamUrl', v, ['https:', 'http:']),
  airUrl: (v) => checkUrl('airUrl', v, ['https:', 'http:']),
  dailyMode: (v) => {
    if (v !== 'auto' && v !== 'custom') throw bad('dailyMode', 'expected "auto" or "custom"');
    return v;
  },
  dailyFolder: (v) => checkText('dailyFolder', v, 300).replace(/^\/+|\/+$/g, ''),
  dailyFormat: (v) => checkText('dailyFormat', v, 80) || DEFAULT_SETTINGS.dailyFormat,
  dailyTemplate: (v) => checkText('dailyTemplate', v, 300).replace(/^\/+/, ''),
};

/* Validate a partial settings object. Unknown keys are ignored; a bad value rejects the
   whole patch with a 400 error, so a half-applied change never happens. */
function sanitizeSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw httpError(400, 'Settings must be an object');
  const out = {};
  for (const key of Object.keys(patch)) {
    if (!Object.prototype.hasOwnProperty.call(CHECKS, key)) continue;
    out[key] = CHECKS[key](patch[key]);
  }
  return out;
}

/* Settings loaded from disk: keep every valid known key, fall back to the default for the rest. */
function settingsFromDisk(raw) {
  const s = Object.assign({}, DEFAULT_SETTINGS);
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(CHECKS)) {
      if (!(key in raw)) continue;
      try { s[key] = CHECKS[key](raw[key]); } catch (e) { /* keep the default */ }
    }
  }
  return s;
}

/* Room state patch: {key: value}; null or undefined removes the key. The source app posted
   {state: {...}}, which is accepted too. */
function mergeState(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw httpError(400, 'State must be an object');
  if (Object.keys(patch).length === 1 && patch.state && typeof patch.state === 'object' && !Array.isArray(patch.state)) {
    patch = patch.state;
  }
  const next = Object.assign({}, current);
  for (const key of Object.keys(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const v = patch[key];
    if (v === null || v === undefined) delete next[key];
    else next[key] = JSON.parse(JSON.stringify(v));
  }
  if (JSON.stringify(next).length > MAX_STATE_CHARS) throw httpError(413, 'Room state is too large');
  return next;
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/* Settings as the room sees them: URL settings replaced by "(set)" or "". */
function roomView(settings) {
  const s = clone(settings);
  for (const k of ROOM_HIDDEN) s[k] = s[k] ? HIDDEN_MARK : '';
  return s;
}

/* Split a room patch into allowed keys and ignored ones. */
function splitRoomPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw httpError(400, 'Settings must be an object');
  const allowed = {};
  const ignored = [];
  for (const key of Object.keys(patch)) {
    // The room may only finish the welcome, never reopen it: reopening is a settings-tab action,
    // so a script inside the room cannot bring back the onboarding steps on its own.
    if (key === 'onboarded' && patch[key] !== true) ignored.push(key);
    else if (ROOM_WRITABLE.indexOf(key) !== -1) allowed[key] = patch[key];
    else ignored.push(key);
  }
  return { allowed: allowed, ignored: ignored };
}

/* createStore({save(data) -> Promise, delay}) */
function createStore(opts) {
  opts = opts || {};
  const save = opts.save || (() => Promise.resolve());
  const delay = opts.delay == null ? 500 : opts.delay;
  let data = { settings: Object.assign({}, DEFAULT_SETTINGS), state: {}, mods: {}, meta: {} };
  let timer = null;
  let saving = Promise.resolve();

  function load(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    data = {
      settings: settingsFromDisk(raw.settings),
      state: raw.state && typeof raw.state === 'object' && !Array.isArray(raw.state) ? raw.state : {},
      mods: raw.mods && typeof raw.mods === 'object' && !Array.isArray(raw.mods) ? raw.mods : {},
      meta: raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta) ? raw.meta : {},
    };
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    const snapshot = clone(data);
    saving = saving.then(() => save(snapshot)).catch((e) => { console.error('[casa] could not save plugin data', e); });
    return saving;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, delay);
  }

  return {
    load: load,
    flush: flush,
    pending: () => timer !== null,
    raw: () => data,
    getSettings: () => clone(data.settings),
    getRoomSettings: () => roomView(data.settings),
    /* POST /api/settings from the room: allowlisted keys only -> {settings (room view), ignored} */
    updateRoomSettings(patch) {
      const split = splitRoomPatch(patch);
      const clean = sanitizeSettingsPatch(split.allowed);
      data.settings = Object.assign({}, data.settings, clean);
      if (Object.keys(clean).length) schedule();
      return { settings: roomView(data.settings), ignored: split.ignored };
    },
    updateSettings(patch) {
      const clean = sanitizeSettingsPatch(patch);
      data.settings = Object.assign({}, data.settings, clean);
      schedule();
      return clone(data.settings);
    },
    getState: () => clone(data.state),
    updateState(patch) {
      data.state = mergeState(data.state, patch);
      schedule();
      return clone(data.state);
    },
    getMod: (ns) => clone(data.mods[String(ns)]),
    setMod(ns, value) {
      if (value === undefined || value === null) delete data.mods[String(ns)];
      else data.mods[String(ns)] = clone(value);
      schedule();
    },
    getMeta: (key) => data.meta[key],
    setMeta(key, value) {
      data.meta[key] = value;
      schedule();
    },
  };
}

module.exports = {
  DEFAULT_SETTINGS, ROOM_WRITABLE, ROOM_HIDDEN, HIDDEN_MARK,
  sanitizeSettingsPatch, settingsFromDisk, mergeState, roomView, splitRoomPatch, createStore,
};
