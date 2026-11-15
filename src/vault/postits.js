'use strict';
// Post-its on the cork board, kept in one readable note: <casaFolder>/Post-its.md.
// One top-level bullet per post-it. Extra lines of the same post-it are indented under it.
// Casa adds a hidden Obsidian comment to the first line with the note's id, colour and place:
//
//   - Water the plants %%casa n1a2b yellow 0.20 0.30%%
//     and the balcony ones
//
// Hand edits are fine: a bullet without the comment gets a default colour and a free spot,
// and any prose or headings around the list are left alone.

const io = require('./io');

const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'white'];
const MAX_TEXT = 280;
const MAX_LINES = 6;
const ITEM = /^([-*+])\s+(.*)$/;
const META = /\s*%%\s*casa\b([^%]*)%%\s*/;
const HEADER = '# Post-its\n\nNotes from the cork board in Casa. Edit them here or in the room: one bullet per note.\nThe small hidden code at the end of a line keeps the note\'s colour and place on the board.\n\n';

function filePath(settings) {
  return io.join((settings && settings.casaFolder) || 'Casa', 'Post-its.md');
}

function round(n) {
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}

function autoSpot(i) {
  return { x: round(0.12 + (i % 4) * 0.22), y: round(0.16 + (Math.floor(i / 4) % 3) * 0.26) };
}

function parseMeta(s) {
  const out = {};
  const nums = [];
  for (const tok of String(s).trim().split(/\s+/).filter(Boolean)) {
    const low = tok.toLowerCase();
    if (COLORS.indexOf(low) >= 0) out.color = low;
    else if (/^-?\d*\.?\d+$/.test(tok)) nums.push(Number(tok));
    else if (!out.id && /^[A-Za-z][\w-]*$/.test(tok)) out.id = tok;
  }
  if (nums.length >= 2) { out.x = round(nums[0]); out.y = round(nums[1]); }
  return out;
}

// Returns {lines, eol, items:[{start, end, text, id, color, x, y, explicitId}]}.
function parse(text) {
  const { lines, eol } = io.splitLines(text);
  const items = [];
  let inFm = lines[0] === '---';
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (inFm) { if (i > 0 && (l === '---' || l === '...')) inFm = false; continue; }
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const m = ITEM.exec(l);
    if (!m) continue;
    let end = i;
    const parts = [m[2]];
    while (end + 1 < lines.length && /^(\t| {2,})\S/.test(lines[end + 1]) && !ITEM.test(lines[end + 1])) {
      end++;
      parts.push(lines[end].replace(/^(\t| {2,4})/, ''));
    }
    let meta = {};
    const cleaned = parts.map((p) => {
      const mm = META.exec(p);
      if (mm) { meta = Object.assign(parseMeta(mm[1]), meta); return p.replace(META, ' ').trimEnd(); }
      return p;
    });
    items.push({ start: i, end, text: cleaned.join('\n').trim(), meta });
    i = end;
  }
  const seen = new Map();
  items.forEach((it, n) => {
    const key = it.text;
    const k = (seen.get(key) || 0) + 1;
    seen.set(key, k);
    it.explicitId = !!it.meta.id;
    it.id = it.meta.id || 'h' + io.hash(key + '#' + k);
    it.color = it.meta.color || 'yellow';
    const spot = autoSpot(n);
    it.x = it.meta.x != null ? it.meta.x : spot.x;
    it.y = it.meta.y != null ? it.meta.y : spot.y;
  });
  return { lines, eol, items };
}

function cleanText(t) {
  return String(t == null ? '' : t)
    .replace(/%%/g, '%')
    .replace(/\r/g, '')
    .split('\n').map((l) => l.trim()).filter((l, i, a) => l || (i > 0 && i < a.length - 1))
    .slice(0, MAX_LINES).join('\n').trim().slice(0, MAX_TEXT);
}

function render(item) {
  const rows = item.text.split('\n');
  const meta = ' %%casa ' + item.id + ' ' + item.color + ' ' + item.x.toFixed(2) + ' ' + item.y.toFixed(2) + '%%';
  return ['- ' + rows[0] + meta].concat(rows.slice(1).map((r) => '  ' + r));
}

function publicNotes(items) {
  return items.map((it) => ({ id: it.id, text: it.text, color: it.color, x: it.x, y: it.y }));
}

async function get(ctx) {
  const path = filePath(ctx.settings);
  const file = io.getFile(ctx.app, path);
  if (!file) return { status: 200, json: { notes: [], path, exists: false } };
  const { items } = parse(await io.read(ctx.app, file));
  return { status: 200, json: { notes: publicNotes(items), path, exists: true } };
}

function newId() {
  return 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

function freeSpot(items) {
  for (let i = 0; i < 24; i++) {
    const s = autoSpot(i);
    if (!items.some((it) => Math.abs(it.x - s.x) < 0.08 && Math.abs(it.y - s.y) < 0.08)) return s;
  }
  return autoSpot(items.length);
}

function applyOp(text, b) {
  const doc = parse(text);
  const { lines, eol, items } = doc;
  const find = () => {
    const it = items.find((x) => x.id === b.id);
    if (!it) throw new io.HttpError(404, 'post-it not found');
    return it;
  };
  if (b.op === 'add') {
    const t = cleanText(b.text);
    if (!t) throw new io.HttpError(400, 'text is empty');
    const spot = typeof b.x === 'number' && typeof b.y === 'number' ? { x: round(b.x), y: round(b.y) } : freeSpot(items);
    const item = { id: newId(), text: t, color: COLORS.indexOf(b.color) >= 0 ? b.color : 'yellow', x: spot.x, y: spot.y };
    const rows = render(item);
    if (items.length) {
      lines.splice(items[items.length - 1].end + 1, 0, ...rows);
    } else {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (lines.length) lines.push('');
      lines.push(...rows, '');
    }
    return { text: lines.join(eol), id: item.id };
  }
  const it = find();
  if (b.op === 'delete') {
    lines.splice(it.start, it.end - it.start + 1);
    return { text: lines.join(eol), id: it.id };
  }
  if (b.op === 'edit') {
    if (b.text != null) {
      const t = cleanText(b.text);
      if (!t) throw new io.HttpError(400, 'text is empty');
      it.text = t;
    }
    if (b.color != null && COLORS.indexOf(b.color) >= 0) it.color = b.color;
  } else if (b.op === 'move') {
    if (typeof b.x !== 'number' || typeof b.y !== 'number') throw new io.HttpError(400, 'x and y are required');
    it.x = round(b.x);
    it.y = round(b.y);
  } else {
    throw new io.HttpError(400, 'unknown op');
  }
  lines.splice(it.start, it.end - it.start + 1, ...render(it));
  return { text: lines.join(eol), id: it.id };
}

async function post(ctx) {
  const b = ctx.body || {};
  const path = filePath(ctx.settings);
  let file = io.getFile(ctx.app, path);
  if (!file) {
    if (b.op !== 'add') throw new io.HttpError(404, 'post-it not found');
    const first = applyOp(HEADER, b);
    await io.createNote(ctx.app, path, first.text);
  } else {
    await io.processFile(ctx.app, file, (text) => applyOp(text, b).text);
  }
  return get(ctx);
}

module.exports = { get, post, parse, applyOp, filePath, COLORS };
