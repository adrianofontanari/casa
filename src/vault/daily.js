'use strict';
// Finds where the user keeps daily notes, without needing any other plugin to be installed or
// running: a plugin's settings file is enough. Order:
//   0. the user's own choice (settings.dailyMode "custom": dailyFolder + dailyFormat);
//   1. core Daily notes   (.obsidian/daily-notes.json + core-plugins.json),
//   2. Periodic Notes     (.obsidian/plugins/periodic-notes/data.json, daily section),
//   3. Journals           (.obsidian/plugins/journals/data.json, first day journal),
//   4. a folder that already holds YYYY-MM-DD notes (guessed),
//   5. Casa's default: Daily/ + YYYY-MM-DD.
// A source wins when recent notes exist at its path; otherwise when it is enabled and its folder
// exists; otherwise when only its settings file is left but the folder exists. A settings file
// pointing at a missing folder is skipped. Detection never writes anything.

const io = require('./io');
const when = require('./when');

const DEFAULT_FOLDER = 'Daily';
const DEFAULT_FORMAT = 'YYYY-MM-DD';
const RECENT_DAYS = 31;
const LABELS = { core: 'Daily notes', periodic: 'Periodic Notes', journals: 'Journals', casa: 'Casa' };

const MINIMAL_NOTE = "## Today's goal\n\n## Tasks\n";

async function coreEnabled(app) {
  try {
    const ip = app.internalPlugins;
    if (ip) {
      const p = typeof ip.getPluginById === 'function' ? ip.getPluginById('daily-notes') : ip.plugins && ip.plugins['daily-notes'];
      if (p && typeof p.enabled === 'boolean') return p.enabled;
    }
  } catch (e) { /* fall back to the file */ }
  const cp = await io.readConfigJson(app, 'core-plugins.json');
  if (Array.isArray(cp)) return cp.indexOf('daily-notes') >= 0;
  if (cp && typeof cp === 'object') return cp['daily-notes'] === true;
  return false;
}

async function communityEnabled(app, id) {
  const list = await io.readConfigJson(app, 'community-plugins.json');
  return Array.isArray(list) && list.indexOf(id) >= 0;
}

function cleanTemplate(t) {
  return t ? io.norm(t) : '';
}

function periodicDaily(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.daily && typeof data.daily === 'object') {
    const d = data.daily;
    return { enabled: !!d.enabled, folder: d.folder, format: d.format, template: d.template || d.templatePath };
  }
  if (Array.isArray(data.calendarSets) && data.calendarSets.length) {
    const set = data.calendarSets.find((s) => s && s.id === data.activeCalendarSet) || data.calendarSets[0];
    const d = set && set.day;
    if (d) return { enabled: d.enabled !== false, folder: d.folder, format: d.format, template: d.templatePath || d.template };
  }
  return null;
}

// Journals stores {folder, nameTemplate, dateFormat} with {{date}} / {{date:FMT}} /
// {{journal_name}} tokens. Turn that into a static folder plus a moment format.
function journalsToFormat(j) {
  const name = String(j.name || '');
  const dateFormat = j.dateFormat || DEFAULT_FORMAT;
  const full = (j.folder ? j.folder + '/' : '') + (j.nameTemplate || '{{date}}');
  let ok = true;
  const parts = io.norm(full).split('/').map((seg) => {
    let fmt = '';
    let text = '';
    let dated = false;
    let last = 0;
    seg.replace(/\{\{\s*([a-z_]+)\s*(?::([^}]*))?\}\}/gi, (m, key, arg, at) => {
      const lit = seg.slice(last, at);
      if (lit) { fmt += '[' + lit + ']'; text += lit; }
      last = at + m.length;
      const k = key.toLowerCase();
      if (k === 'date') { fmt += arg ? arg.trim() : dateFormat; dated = true; }
      else if (k === 'journal_name') { fmt += '[' + name + ']'; text += name; }
      else ok = false;
      return m;
    });
    const tail = seg.slice(last);
    if (tail) { fmt += '[' + tail + ']'; text += tail; }
    return { fmt, text, dated };
  });
  if (!ok || !parts.length || !parts[parts.length - 1].dated) return null;
  const first = parts.findIndex((p) => p.dated);
  return {
    folder: parts.slice(0, first).map((p) => p.text).join('/'),
    format: parts.slice(first).map((p) => p.fmt).join('/'),
  };
}

function journalsDaily(data) {
  if (!data || typeof data !== 'object' || !data.journals) return null;
  const list = Array.isArray(data.journals) ? data.journals : Object.keys(data.journals).map((k) => Object.assign({ name: k }, data.journals[k]));
  const isDay = (j) => j && ((j.write && j.write.type === 'day') || j.calendarGranularity === 'day' || j.granularity === 'day');
  const j = list.find((x) => isDay(x) && (x.id === data.defaultId || x.name === data.defaultId)) || list.find(isDay);
  if (!j) return null;
  const conv = journalsToFormat(j);
  if (!conv) return null;
  const template = Array.isArray(j.templates) ? j.templates[0] : j.template;
  return { enabled: true, folder: conv.folder, format: conv.format, template };
}

function pathFor(info, date, moment) {
  return io.join(info.folder, when.formatWith(moment, date, info.format || DEFAULT_FORMAT) + '.md');
}

function countRecent(app, info, ctx) {
  const base = when.today(ctx);
  let n = 0;
  for (let i = 0; i < RECENT_DAYS; i++) {
    if (io.getFile(app, pathFor(info, when.addDays(base, -i), ctx.moment))) n++;
  }
  return n;
}

// A folder full of YYYY-MM-DD notes, for vaults whose notes came from elsewhere.
function guessFolder(app) {
  if (typeof app.vault.getMarkdownFiles !== 'function') return null;
  const counts = new Map();
  for (const f of app.vault.getMarkdownFiles()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.basename || io.baseName(f.path))) continue;
    const parent = io.parentOf(f.path);
    if (parent.split('/').some((s) => s.startsWith('.'))) continue;
    counts.set(parent, (counts.get(parent) || 0) + 1);
  }
  let best = null;
  for (const [folder, n] of counts) if (n >= 3 && (!best || n > best.n)) best = { folder, n };
  return best;
}

async function candidates(app) {
  const list = [];
  const coreOn = await coreEnabled(app);
  const core = await io.readConfigJson(app, 'daily-notes.json');
  if (coreOn || core) {
    const c = core || {};
    list.push({ source: 'core', enabled: coreOn, configured: !!core, folder: io.norm(c.folder), format: c.format || DEFAULT_FORMAT, template: cleanTemplate(c.template) });
  }
  const pnData = await io.readConfigJson(app, 'plugins/periodic-notes/data.json');
  const pn = periodicDaily(pnData);
  if (pn) {
    const on = pn.enabled && (await communityEnabled(app, 'periodic-notes'));
    list.push({ source: 'periodic', enabled: on, configured: true, folder: io.norm(pn.folder), format: pn.format || DEFAULT_FORMAT, template: cleanTemplate(pn.template) });
  }
  const jnData = await io.readConfigJson(app, 'plugins/journals/data.json');
  const jn = journalsDaily(jnData);
  if (jn) {
    const on = await communityEnabled(app, 'journals');
    list.push({ source: 'journals', enabled: on, configured: true, folder: io.norm(jn.folder), format: jn.format, template: cleanTemplate(jn.template) });
  }
  return list;
}

function finish(app, ctx, c, extra) {
  const date = when.today(ctx);
  const info = {
    source: c.source,
    label: LABELS[c.source],
    folder: c.folder || '',
    format: c.format || DEFAULT_FORMAT,
    template: c.template || '',
    enabled: !!c.enabled,
    custom: false,
    guessed: false,
  };
  Object.assign(info, extra || {});
  info.path = pathFor(info, date, ctx.moment);
  info.example = when.formatWith(ctx.moment, date, info.format);
  info.exists = !!io.getFile(app, info.path);
  if (info.found == null) info.found = countRecent(app, info, ctx);
  return info;
}

async function detect(ctx) {
  const app = ctx.app;
  const settings = ctx.settings || {};
  if (settings.dailyMode === 'custom') {
    return finish(app, ctx, { source: 'casa', enabled: true, folder: io.norm(settings.dailyFolder), format: settings.dailyFormat || DEFAULT_FORMAT, template: cleanTemplate(settings.dailyTemplate) }, { custom: true });
  }
  const list = await candidates(app);
  const scored = list.map((c) => ({ c, recent: countRecent(app, c, ctx), folderOk: io.folderExists(app, c.folder) }));
  const pick =
    scored.find((s) => s.recent > 0) ||
    scored.find((s) => s.c.enabled && s.c.configured && s.folderOk) ||
    scored.find((s) => s.c.configured && s.folderOk && s.c.folder);
  if (pick) return finish(app, ctx, pick.c, { found: pick.recent });
  const guess = guessFolder(app);
  if (guess) return finish(app, ctx, { source: 'casa', enabled: true, folder: guess.folder, format: DEFAULT_FORMAT }, { guessed: true });
  return finish(app, ctx, { source: 'casa', enabled: true, folder: DEFAULT_FOLDER, format: DEFAULT_FORMAT });
}

// Core-style template tokens: {{date}}, {{title}}, {{time}}, {{date:FMT}}, {{time:FMT}},
// {{yesterday}}, {{tomorrow}}. Anything else (Templater, etc.) is left for its plugin.
function renderTemplate(text, info, date, moment) {
  const fmt = info.format || DEFAULT_FORMAT;
  const title = io.baseName(pathFor(info, date, moment));
  const name = when.formatWith(moment, date, fmt.split('/').pop());
  const now = new Date();
  const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), now.getHours(), now.getMinutes());
  return String(text)
    .replace(/\{\{\s*(date|time)\s*:\s*([^}]+?)\s*\}\}/gi, (m, k, f) => when.formatWith(moment, at, f))
    .replace(/\{\{\s*date\s*\}\}/gi, name)
    .replace(/\{\{\s*time\s*\}\}/gi, when.formatWith(moment, at, 'HH:mm'))
    .replace(/\{\{\s*title\s*\}\}/gi, title)
    .replace(/\{\{\s*yesterday\s*\}\}/gi, when.formatWith(moment, when.addDays(date, -1), fmt.split('/').pop()))
    .replace(/\{\{\s*tomorrow\s*\}\}/gi, when.formatWith(moment, when.addDays(date, 1), fmt.split('/').pop()));
}

async function templateText(app, info, date, moment) {
  if (!info.template) return null;
  const t = io.norm(info.template);
  const file = io.getFile(app, t) || io.getFile(app, t + '.md');
  if (!file) return null;
  try {
    return renderTemplate(await io.read(app, file), info, date, moment);
  } catch (e) {
    return null;
  }
}

// Today's note, read only. Never creates anything.
async function readToday(ctx, info) {
  const d = info || (await detect(ctx));
  const file = io.getFile(ctx.app, d.path);
  const text = file ? await io.read(ctx.app, file) : null;
  return { info: d, file, text, exists: !!file };
}

// Called only on a user write. Creates today's note from the user's template, or a minimal one.
async function ensureToday(ctx, info) {
  const d = info || (await detect(ctx));
  const existing = io.getFile(ctx.app, d.path);
  if (existing) return { info: d, file: existing, created: false };
  const date = when.today(ctx);
  const fromTemplate = await templateText(ctx.app, d, date, ctx.moment);
  const file = await io.createNote(ctx.app, d.path, fromTemplate != null ? fromTemplate : MINIMAL_NOTE);
  return { info: d, file: file || io.getFile(ctx.app, d.path), created: true, templated: fromTemplate != null };
}

function publicInfo(d) {
  return {
    source: d.source, label: d.label, folder: d.folder, format: d.format, template: d.template,
    path: d.path, example: d.example, exists: d.exists, found: d.found, enabled: d.enabled,
    custom: d.custom, guessed: d.guessed,
  };
}

module.exports = {
  detect, readToday, ensureToday, renderTemplate, pathFor, publicInfo, journalsToFormat,
  MINIMAL_NOTE, DEFAULT_FOLDER, DEFAULT_FORMAT,
};
