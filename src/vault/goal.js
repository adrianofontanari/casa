'use strict';
// Today's goal, read from and written to today's daily note. Three forms, in this order:
//   (a) frontmatter `goal: ...`
//   (b) the first non-empty line under a heading that mentions goal, focus or today
//   (c) a line starting `Goal:` (also `- Goal:`, `**Goal:**`, `Goal::`)
// Read returns the first form that holds a value. Write updates that form in place; with no
// value anywhere it fills the first empty slot found; with no slot it adds "## Today's goal"
// near the top (after frontmatter and a leading H1).

const io = require('./io');

const MAX = 300;

function frontmatterEnd(lines) {
  if (lines[0] !== '---') return -1;
  for (let i = 1; i < lines.length; i++) if (lines[i] === '---' || lines[i] === '...') return i;
  return -1;
}

function unquote(v) {
  const s = v.trim();
  if (s.startsWith('"')) {
    try { return JSON.parse(s); } catch (e) { return s.replace(/^"|"$/g, ''); }
  }
  if (s.startsWith("'")) return s.replace(/^'|'$/g, '').replace(/''/g, "'");
  return s.replace(/\s+#.*$/, '').trim();
}

function yamlValue(v) {
  if (v === '') return '';
  const plain = !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(v) && !/:\s|\s#|:$|\s$/.test(v) &&
    !/^(true|false|null|yes|no|on|off|~|[-+]?\d[\d_.]*(e[-+]?\d+)?)$/i.test(v);
  return plain ? v : JSON.stringify(v);
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TASK_LINE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[.\]/;
const COMMENT_LINE = /^\s*(%%.*%%|<!--.*-->)\s*$/;
const PREFIX = /^(\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+)?)(.*)$/;
const GOAL_LINE = /^(\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+)?(?:\*\*|__)?goal(?:\*\*|__)?\s*::?\s*(?:\*\*|__)?\s*)(.*?)\s*$/i;

function headingRank(text) {
  const t = text.toLowerCase();
  if (/goal/.test(t)) return 0;
  if (/focus/.test(t)) return 1;
  if (/today/.test(t) && !/task|to-?do|done|log|note/.test(t)) return 2;
  return -1;
}

function bodyRanges(lines, start) {
  // Lines outside fenced code blocks.
  const ok = new Array(lines.length).fill(false);
  let fence = null;
  for (let i = start; i < lines.length; i++) {
    const m = /^\s*(```|~~~)/.exec(lines[i]);
    if (m) {
      if (!fence) fence = m[1];
      else if (m[1] === fence) fence = null;
      continue;
    }
    ok[i] = !fence;
  }
  return ok;
}

function stripDisplay(v) {
  return v.replace(/^(\*\*|__)(.*)\1$/, '$2').trim();
}

// Returns every goal slot found, in priority order.
function findSlots(lines) {
  const slots = [];
  const fmEnd = frontmatterEnd(lines);
  if (fmEnd > 0) {
    for (let i = 1; i < fmEnd; i++) {
      const m = /^goal\s*:(.*)$/i.exec(lines[i]);
      if (!m) continue;
      let value = unquote(m[1]);
      let end = i;
      if (!m[1].trim()) {
        let j = i + 1;
        while (j < fmEnd && /^\s+-\s+/.test(lines[j])) j++;
        if (j > i + 1) { value = unquote(lines[i + 1].replace(/^\s+-\s+/, '')); end = j - 1; }
      }
      slots.push({ kind: 'frontmatter', line: i, end, value });
      break;
    }
  }
  const body = bodyRanges(lines, fmEnd > 0 ? fmEnd + 1 : 0);
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    if (!body[i]) continue;
    const h = HEADING.exec(lines[i]);
    if (!h) continue;
    const rank = headingRank(h[2]);
    if (rank >= 0) heads.push({ i, rank });
  }
  heads.sort((a, b) => a.rank - b.rank || a.i - b.i);
  for (const h of heads) {
    let found = null;
    for (let j = h.i + 1; j < lines.length; j++) {
      if (!body[j]) break;
      const l = lines[j];
      if (!l.trim() || COMMENT_LINE.test(l)) continue;
      if (HEADING.test(l)) { found = { empty: true }; break; }
      if (TASK_LINE.test(l)) { found = { task: true }; break; }
      found = { line: j };
      break;
    }
    if (found && found.task) continue;
    if (!found || found.empty) { slots.push({ kind: 'heading', heading: h.i, line: -1, value: '' }); continue; }
    const m = PREFIX.exec(lines[found.line]);
    slots.push({ kind: 'heading', heading: h.i, line: found.line, prefix: m[1], value: stripDisplay(m[2]) });
  }
  for (let i = 0; i < lines.length; i++) {
    if (!body[i]) continue;
    const m = GOAL_LINE.exec(lines[i]);
    if (m) { slots.push({ kind: 'line', line: i, prefix: m[1], value: stripDisplay(m[2]) }); break; }
  }
  return slots;
}

function readGoal(text) {
  if (text == null) return { focus: '', source: null };
  const { lines } = io.splitLines(text);
  const slots = findSlots(lines);
  const hit = slots.find((s) => s.value) || null;
  return { focus: hit ? hit.value : '', source: hit ? hit.kind : (slots[0] ? slots[0].kind : null) };
}

function clean(v) {
  return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX);
}

// Returns the new note text. Unchanged text means nothing to write.
function writeGoal(text, value) {
  const v = clean(value);
  const { lines, eol } = io.splitLines(text);
  const slots = findSlots(lines);
  const slot = slots.find((s) => s.value) || slots[0];
  if (slot) {
    if (slot.kind === 'frontmatter') {
      lines.splice(slot.line, slot.end - slot.line + 1, ('goal: ' + yamlValue(v)).trimEnd());
    } else if (slot.kind === 'heading') {
      if (slot.line >= 0) {
        if (v) lines[slot.line] = slot.prefix + v;
        else lines.splice(slot.line, 1);
      } else if (v) {
        lines.splice(slot.heading + 1, 0, v);
      }
    } else {
      const pre = v && !/\s$/.test(slot.prefix) ? slot.prefix + ' ' : slot.prefix;
      lines[slot.line] = (pre + v).trimEnd();
    }
    return lines.join(eol);
  }
  if (!v) return text;
  const fmEnd = frontmatterEnd(lines);
  let at = fmEnd > 0 ? fmEnd + 1 : 0;
  let k = at;
  while (k < lines.length && !lines[k].trim()) k++;
  if (k < lines.length && /^#\s+/.test(lines[k])) at = k + 1;
  const block = ["## Today's goal", v, ''];
  if (at > 0 && lines[at - 1].trim()) block.unshift('');
  if (at < lines.length && !lines[at].trim()) block.pop();
  lines.splice(at, 0, ...block);
  return lines.join(eol);
}

module.exports = { readGoal, writeGoal, findSlots, MAX };
