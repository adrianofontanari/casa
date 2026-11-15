'use strict';
// Tasks for the room: every checkbox in today's daily note, plus tasks anywhere in the vault
// written in the Tasks plugin's emoji format that are due (📅) or scheduled (⏳) today, or
// overdue. The Tasks plugin is not needed; when it is installed its toggle API is used so
// recurring tasks roll over the way the user expects.

const io = require('./io');
const when = require('./when');
const daily = require('./daily');

const TASK_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[(.)\](?=\s|$)\s?(.*)$/;
const VS = '\\uFE0F?';
const DUE_RE = new RegExp('(?:📅|📆|🗓)' + VS + '\\s*(\\d{4}-\\d{2}-\\d{2})', 'u');
const SCHED_RE = new RegExp('(?:⏳|⌛)' + VS + '\\s*(\\d{4}-\\d{2}-\\d{2})', 'u');
const DONE_RE = new RegExp('\\s*✅' + VS + '\\s*(\\d{4}-\\d{2}-\\d{2})', 'u');
const META_RE = /(?:📅|📆|🗓|⏳|⌛|🛫|✅|➕|❌|🔁|⏫|🔼|🔽|🔺|⏬|🆔|⛔)/u;
const BLOCK_ID = /\s+\^[A-Za-z0-9-]+\s*$/;
const UPCOMING_DAYS = 7;
const MAX_VAULT = 100;
const MAX_UPCOMING = 30;
const MAX_TEXT = 500;

class Stale extends Error {
  constructor() { super('stale'); this.status = 412; }
}

function isDone(status) { return status === 'x' || status === 'X'; }
function isCancelled(status) { return status === '-'; }

function parseLine(raw) {
  const m = TASK_RE.exec(raw);
  if (!m) return null;
  const body = m[3] || '';
  const metaAt = body.search(META_RE);
  let desc = metaAt >= 0 ? body.slice(0, metaAt) : body;
  desc = desc.replace(BLOCK_ID, '').trim();
  const due = DUE_RE.exec(body);
  const sched = SCHED_RE.exec(body);
  const done = DONE_RE.exec(body);
  return {
    prefix: m[1],
    status: m[2],
    body,
    text: desc || body.replace(BLOCK_ID, '').trim(),
    emoji: metaAt >= 0,
    due: due ? due[1] : null,
    scheduled: sched ? sched[1] : null,
    doneDate: done ? done[1] : null,
    indent: (m[1].match(/^\s*/)[0].replace(/\t/g, '    ').length / 2) | 0,
  };
}

// Line numbers that sit inside fenced code blocks (``` or ~~~, CommonMark rules: up to 3 spaces of
// indent, the closing fence uses the same character and is at least as long). Checkboxes there are
// examples, not tasks.
function fencedLines(lines) {
  const out = new Set();
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (fence) {
      out.add(i);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(lines[i])) fence = null;
    } else if (m) {
      fence = m[1];
      out.add(i);
    }
  }
  return out;
}

// A checkbox with no words ("- [ ] " left by a template) is a placeholder, not a task.
const isBlank = (p) => !p.text;

function makeId(path, line, raw) {
  return io.hash(raw) + ':' + line + ':' + path;
}

function parseId(id) {
  const m = /^([0-9a-z]+):(\d+):(.+)$/.exec(String(id || ''));
  if (!m) return null;
  return { h: m[1], line: Number(m[2]), path: m[3] };
}

function toTask(p, path, line, raw, extra) {
  const t = { id: makeId(path, line, raw), text: p.text, done: isDone(p.status), status: p.status, path, line };
  if (p.due || p.scheduled) t.due = p.due || p.scheduled;
  if (p.scheduled) t.scheduled = p.scheduled;
  if (p.doneDate) t.doneDate = p.doneDate;
  if (p.indent) t.indent = p.indent;
  return Object.assign(t, extra);
}

// Per-app cache of parsed dated tasks, keyed by path and invalidated by mtime/size.
const caches = new WeakMap();
function cacheFor(app) {
  let c = caches.get(app);
  if (!c) { c = new Map(); caches.set(app, c); }
  return c;
}

async function tasksSettings(app) {
  const data = await io.readConfigJson(app, 'plugins/obsidian-tasks-plugin/data.json');
  return { globalFilter: data && typeof data.globalFilter === 'string' ? data.globalFilter.trim() : '' };
}

async function excludedFolders(app, ctx) {
  const out = [io.norm(app.vault.configDir || '.obsidian')];
  const tpl = await io.readConfigJson(app, 'templates.json');
  if (tpl && tpl.folder) out.push(io.norm(tpl.folder));
  const casa = io.norm((ctx.settings && ctx.settings.casaFolder) || 'Casa');
  return { folders: out.filter(Boolean), files: [casa + '/Post-its.md', casa + '/Quotes.md'] };
}

function hasTaskItems(app, file) {
  const mc = app.metadataCache;
  if (!mc || typeof mc.getFileCache !== 'function') return null;
  const cache = mc.getFileCache(file);
  if (!cache) return null;
  return Array.isArray(cache.listItems) && cache.listItems.some((li) => li.task !== undefined);
}

async function datedTasksIn(app, file) {
  const cache = cacheFor(app);
  const key = io.mtime(file) + ':' + ((file.stat && file.stat.size) || 0);
  const hit = cache.get(file.path);
  if (hit && hit.key === key) return hit.items;
  let items = [];
  if (hasTaskItems(app, file) !== false) {
    const text = await io.cachedRead(app, file);
    const { lines } = io.splitLines(text);
    const fenced = fencedLines(lines);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.indexOf('[') < 0 || !META_RE.test(raw) || fenced.has(i)) continue;
      const p = parseLine(raw);
      if (p && !isBlank(p) && (p.due || p.scheduled)) items.push({ p, line: i, raw });
    }
  }
  cache.set(file.path, { key, items });
  return items;
}

function revOf(files) {
  const parts = files.filter(Boolean).map((f) => f.path + ':' + io.mtime(f)).sort();
  return io.hash(parts.join('|') || 'empty');
}

async function collect(ctx) {
  const app = ctx.app;
  const info = await daily.detect(ctx);
  const date = when.isoDate(when.today(ctx));
  const horizon = when.isoDate(when.addDays(when.today(ctx), UPCOMING_DAYS));
  const todayList = [];
  const seen = new Set();
  const involved = [];

  const dfile = io.getFile(app, info.path);
  if (dfile) {
    involved.push(dfile);
    const { lines } = io.splitLines(await io.read(app, dfile));
    const fenced = fencedLines(lines);
    for (let i = 0; i < lines.length; i++) {
      if (fenced.has(i)) continue;
      const p = parseLine(lines[i]);
      if (!p || isCancelled(p.status) || isBlank(p)) continue;
      todayList.push(toTask(p, dfile.path, i, lines[i], { daily: true }));
      seen.add(dfile.path + ':' + i);
    }
  }

  const { globalFilter } = await tasksSettings(app);
  const ex = await excludedFolders(app, ctx);
  const overdue = [];
  const dueToday = [];
  const upcoming = [];
  const files = typeof app.vault.getMarkdownFiles === 'function' ? app.vault.getMarkdownFiles() : [];
  for (const f of files) {
    if (f.path === info.path) continue;
    if (ex.files.indexOf(f.path) >= 0) continue;
    if (ex.folders.some((d) => f.path === d || f.path.startsWith(d + '/'))) continue;
    const items = await datedTasksIn(app, f);
    let used = false;
    for (const { p, line, raw } of items) {
      if (seen.has(f.path + ':' + line) || isCancelled(p.status)) continue;
      if (globalFilter && raw.indexOf(globalFilter) < 0) continue;
      const dates = [p.due, p.scheduled].filter(Boolean).sort();
      const first = dates[0];
      const isToday = p.due === date || p.scheduled === date;
      if (isDone(p.status)) {
        // Completed today: keep it visible (struck through) so a toggle does not vanish.
        if (p.doneDate === date && first <= date) { dueToday.push(toTask(p, f.path, line, raw, { daily: false })); used = true; }
        continue;
      }
      if (isToday) { dueToday.push(toTask(p, f.path, line, raw, { daily: false })); used = true; }
      else if (first < date) { overdue.push(toTask(p, f.path, line, raw, { daily: false, overdue: true })); used = true; }
      else if (first <= horizon) { upcoming.push(toTask(p, f.path, line, raw, { daily: false })); used = true; }
    }
    if (used) involved.push(f);
  }
  overdue.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  upcoming.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const vault = overdue.concat(dueToday).slice(0, MAX_VAULT);
  return {
    date,
    path: info.path,
    exists: !!dfile,
    today: todayList.concat(vault),
    upcoming: upcoming.slice(0, MAX_UPCOMING),
    rev: revOf(involved),
  };
}

function tasksApi(app) {
  try {
    const p = app.plugins && app.plugins.plugins && app.plugins.plugins['obsidian-tasks-plugin'];
    const api = p && p.apiV1;
    return api && typeof api.executeToggleTaskDoneCommand === 'function' ? api : null;
  } catch (e) {
    return null;
  }
}

function toggleLine(raw, date) {
  const m = TASK_RE.exec(raw);
  const p = parseLine(raw);
  if (!m || !p) return null;
  if (isDone(p.status)) {
    return (m[1] + '[ ] ' + p.body.replace(DONE_RE, '')).trimEnd();
  }
  let body = p.body;
  if (p.emoji && !p.doneDate) {
    const bid = BLOCK_ID.exec(body);
    const done = ' ✅ ' + date;
    body = bid ? body.slice(0, bid.index) + done + bid[0] : body.trimEnd() + done;
  }
  return (m[1] + '[x] ' + body).trimEnd();
}

function editLine(raw, text) {
  const m = TASK_RE.exec(raw);
  if (!m) return null;
  const body = m[3] || '';
  const metaAt = body.search(META_RE);
  let tail = metaAt >= 0 ? body.slice(metaAt) : '';
  if (!tail) { const bid = BLOCK_ID.exec(body); if (bid) tail = bid[0].trim(); }
  return (m[1] + '[' + m[2] + '] ' + text + (tail ? ' ' + tail.trim() : '')).trimEnd();
}

function cleanText(t) {
  return String(t == null ? '' : t).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

// Locate the task line; it may have moved if lines were added above it.
function locate(lines, ref) {
  if (ref.line < lines.length && io.hash(lines[ref.line]) === ref.h) return ref.line;
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (io.hash(lines[i]) === ref.h) hits.push(i);
  if (hits.length === 1) return hits[0];
  throw new Stale();
}

async function changeLine(ctx, id, fn) {
  const ref = parseId(id);
  if (!ref) throw new io.HttpError(400, 'bad task id');
  const file = io.getFile(ctx.app, ref.path);
  if (!file) throw new Stale();
  let out = null;
  await io.processFile(ctx.app, file, (text) => {
    const { lines, eol } = io.splitLines(text);
    const at = locate(lines, ref);
    const next = fn(lines[at], ref.path);
    if (next == null) throw new Stale();
    const nextLines = String(next).split(/\r?\n/);
    lines.splice(at, 1, ...nextLines);
    const raw = pickChanged(nextLines);
    out = { path: ref.path, line: at + nextLines.indexOf(raw), raw };
    return lines.join(eol);
  });
  return out;
}

// For a toggle that produced two lines (recurring task: new open copy + completed one), the
// changed task is the completed one; otherwise the single line.
function pickChanged(lines) {
  if (lines.length === 1) return lines[0];
  const done = lines.find((l) => { const m = TASK_RE.exec(l); return m && isDone(m[2]); });
  return done || lines[0];
}

const TASKS_HEADING = /^(#{1,6})\s+(.*)$/;

function insertTask(text, line) {
  const { lines, eol } = io.splitLines(text);
  let head = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = TASKS_HEADING.exec(lines[i]);
    if (h && /\b(tasks?|to-?dos?|to do)\b/i.test(h[2]) && !/goal/i.test(h[2])) { head = i; level = h[1].length; break; }
  }
  if (head >= 0) {
    let end = lines.length;
    for (let j = head + 1; j < lines.length; j++) {
      const h = TASKS_HEADING.exec(lines[j]);
      if (h && h[1].length <= level) { end = j; break; }
    }
    let last = head;
    for (let j = head + 1; j < end; j++) if (lines[j].trim()) last = j;
    lines.splice(last + 1, 0, line);
    return lines.join(eol);
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length) lines.push('');
  lines.push('## Tasks', line, '');
  return lines.join(eol);
}

async function get(ctx) {
  return { status: 200, json: await collect(ctx) };
}

async function post(ctx) {
  const b = ctx.body || {};
  const date = when.isoDate(when.today(ctx));
  let changed = null;
  if (b.op === 'toggle') {
    const api = tasksApi(ctx.app);
    changed = await changeLine(ctx, b.id, (raw, path) => {
      const p = parseLine(raw);
      if (api && p && p.emoji) {
        try {
          const out = api.executeToggleTaskDoneCommand(raw, path);
          if (typeof out === 'string' && out !== raw) return out;
        } catch (e) { /* fall back to a plain toggle */ }
      }
      return toggleLine(raw, date);
    });
  } else if (b.op === 'edit') {
    const text = cleanText(b.text);
    if (!text) throw new io.HttpError(400, 'text is empty');
    changed = await changeLine(ctx, b.id, (raw) => editLine(raw, text));
  } else if (b.op === 'add') {
    const text = cleanText(b.text);
    if (!text) throw new io.HttpError(400, 'text is empty');
    const due = /^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? ' 📅 ' + b.due : '';
    const line = '- [ ] ' + text + due;
    const { file } = await daily.ensureToday(ctx);
    let at = -1;
    await io.processFile(ctx.app, file, (t) => {
      const next = insertTask(t, line);
      at = io.splitLines(next).lines.indexOf(line);
      return next;
    });
    changed = { path: file.path, line: at, raw: line };
  } else {
    throw new io.HttpError(400, 'unknown op');
  }
  const state = await collect(ctx);
  const task = changed ? state.today.concat(state.upcoming).find((t) => t.path === changed.path && t.line === changed.line) : null;
  return { status: 200, json: { ok: true, rev: state.rev, task: task || null, date: state.date } };
}

module.exports = { get, post, collect, parseLine, toggleLine, editLine, insertTask, parseId, Stale };
