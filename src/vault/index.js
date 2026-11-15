'use strict';
// Vault routes for the room bridge: focus (today's goal), tasks, notes (post-its), quotes and
// onboarding. Shapes are documented in docs/dev/routes.md.
//
// Handlers accept the shell router's call `(req, ctx)` (req = {route, method, query, body};
// ctx = {app, obsidian, getSettings, saveSettings, notify, ...}) and also a single merged
// object `{app, method?, query, body, settings, saveSettings, moment, now?}` as used in tests.
// GET never creates or changes a file: Casa writes only when the user writes.

const io = require('./io');
const when = require('./when');
const daily = require('./daily');
const goal = require('./goal');
const tasks = require('./tasks');
const postits = require('./postits');
const quotes = require('./quotes');
const onboard = require('./onboard');

function hostMoment(c) {
  if (c && typeof c.moment === 'function') return c.moment;
  if (c && c.obsidian && typeof c.obsidian.moment === 'function') return c.obsidian.moment;
  if (typeof window !== 'undefined' && typeof window.moment === 'function') return window.moment;
  return when.makeMoment(c && c.now);
}

function parseBody(b) {
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch (e) { return {}; }
  }
  return b && typeof b === 'object' ? b : null;
}

function makeCtx(req, host) {
  const one = host === undefined;
  const h = one ? req || {} : host || {};
  const r = one ? req || {} : req || {};
  const body = parseBody(r.body);
  const method = String(r.method || (body && Object.keys(body).length ? 'POST' : 'GET')).toUpperCase();
  return {
    app: h.app,
    method,
    query: r.query || {},
    body,
    settings: typeof h.getSettings === 'function' ? h.getSettings() : h.settings || {},
    getSettings: typeof h.getSettings === 'function' ? h.getSettings : null,
    saveSettings: h.saveSettings,
    notify: typeof h.notify === 'function' ? h.notify : null,
    moment: hostMoment(h),
    now: h.now,
    obsidian: h.obsidian || null,
    prompts: h.prompts || null,
  };
}

function notify(ctx, kinds) {
  if (!ctx.notify) return;
  for (const k of kinds) {
    try { ctx.notify(k); } catch (e) { /* the room refreshes on its own */ }
  }
}

function route(handlers, writeKinds) {
  return async function (req, host) {
    const ctx = makeCtx(req, host);
    try {
      if (ctx.method === 'GET') return await handlers.get(ctx);
      const out = await handlers.post(ctx);
      notify(ctx, writeKinds);
      return out;
    } catch (e) {
      const status = e && Number.isInteger(e.status) ? e.status : 500;
      if (status >= 500 && typeof console !== 'undefined') console.error('[casa] vault route failed', e);
      return { status, json: { error: status === 412 ? 'stale' : String((e && e.message) || e) } };
    }
  };
}

// /api/focus
const focus = {
  async get(ctx) {
    const t = await daily.readToday(ctx);
    const g = goal.readGoal(t.text);
    return { status: 200, json: { focus: g.focus, exists: t.exists, date: when.isoDate(when.today(ctx)), path: t.info.path, source: g.source, daily: { source: t.info.source, folder: t.info.folder } } };
  },
  async post(ctx) {
    const b = ctx.body || {};
    if (typeof b.focus !== 'string') throw new io.HttpError(400, 'focus must be text');
    const value = b.focus.replace(/\s+/g, ' ').trim();
    const t = await daily.readToday(ctx);
    if (!t.exists && !value) return focus.get(ctx);
    const { file } = t.exists ? t : await daily.ensureToday(ctx, t.info);
    await io.processFile(ctx.app, file, (text) => goal.writeGoal(text, value));
    return focus.get(ctx);
  },
};

// /api/today: today's daily note as plain text, read only (the mug on the desk opens it)
const today = {
  async get(ctx) {
    const t = await daily.readToday(ctx);
    const text = t.exists ? String(t.text || '') : '';
    return { status: 200, json: { date: when.isoDate(when.today(ctx)), exists: !!t.exists, path: t.info.path, text: text.length > 20000 ? text.slice(0, 20000) : text } };
  },
  async post() { throw new io.HttpError(405, "Today's note is read only here: open it in Obsidian to edit it"); },
};

const routes = {
  today: route(today, []),
  focus: route(focus, ['focus']),
  tasks: route(tasks, ['tasks']),
  notes: route(postits, ['notes']),
  quotes: route(quotes, []),
  onboarding: route(onboard, []),
};

// Live refresh: when the user edits today's note, the post-its note or a note with dated tasks
// in Obsidian, tell the open rooms (debounced, so typing does not cause a storm).
function setup(host) {
  if (!host || !host.app || !host.app.vault || typeof host.app.vault.on !== 'function') return undefined;
  const app = host.app;
  const pending = new Set();
  let timer = null;
  let todayPath = '';
  let todayAt = 0;
  const DATED = /(?:📅|📆|🗓|⏳|⌛|✅)/u;

  async function flush() {
    timer = null;
    const paths = Array.from(pending);
    pending.clear();
    const ctx = makeCtx({ method: 'GET' }, host);
    if (!todayPath || Date.now() - todayAt > 60000) {
      try { todayPath = (await daily.detect(ctx)).path; todayAt = Date.now(); } catch (e) { todayPath = ''; }
    }
    const kinds = new Set();
    const notesPath = postits.filePath(ctx.settings);
    for (const p of paths) {
      if (p === todayPath) { kinds.add('focus'); kinds.add('tasks'); }
      else if (p === notesPath) kinds.add('notes');
      else if (!kinds.has('tasks')) {
        const f = io.getFile(app, p);
        if (!f) { kinds.add('tasks'); continue; }
        try { if (DATED.test(await io.cachedRead(app, f))) kinds.add('tasks'); } catch (e) { /* ignore */ }
      }
    }
    notify(ctx, Array.from(kinds));
  }

  function touch(file, oldPath) {
    if (!file || !/\.md$/i.test(file.path || '')) return;
    pending.add(file.path);
    if (oldPath) pending.add(oldPath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  }

  const refs = ['modify', 'create', 'delete', 'rename'].map((ev) => app.vault.on(ev, touch));
  if (typeof host.registerEvent === 'function') refs.forEach((r) => host.registerEvent(r));
  return () => {
    if (timer) clearTimeout(timer);
    if (typeof host.registerEvent !== 'function' && typeof app.vault.offref === 'function') refs.forEach((r) => app.vault.offref(r));
  };
}

module.exports = { routes, setup, makeCtx };
