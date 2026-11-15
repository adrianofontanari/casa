'use strict';
// Quotes for the room, from <casaFolder>/Quotes.md: one quote per line or bullet. Without that
// note Casa shows a built-in set of short public-domain quotes (sources in docs/dev/credits.md)
// and creates the note, seeded with them, only when the user adds a quote.

const io = require('./io');

const BUILTIN = [
  'Slow but steady wins the race. - Aesop',
  'Lost time is never found again. - Benjamin Franklin',
  'One today is worth two tomorrows. - Benjamin Franklin',
  'Little strokes fell great oaks. - Benjamin Franklin',
  'Diligence is the mother of good luck. - Benjamin Franklin',
  'Dost thou love life? Then do not squander time, for that is the stuff life is made of. - Benjamin Franklin',
  'The readiness is all. - William Shakespeare',
  'Our doubts are traitors, and make us lose the good we oft might win by fearing to attempt. - William Shakespeare',
  'Nothing will come of nothing. - William Shakespeare',
  'Simplicity, simplicity, simplicity! - Henry David Thoreau',
  'Our life is frittered away by detail. Simplify, simplify. - Henry David Thoreau',
  'Nothing great was ever achieved without enthusiasm. - Ralph Waldo Emerson',
  'Write it on your heart that every day is the best day in the year. - Ralph Waldo Emerson',
  'Adopt the pace of Nature. Her secret is patience. - Ralph Waldo Emerson',
  'The journey of a thousand li commenced with a single step. - Laozi',
  'No longer talk at all about the kind of man that a good man ought to be, but be such. - Marcus Aurelius',
  'Very little indeed is necessary for living a happy life. - Marcus Aurelius',
  'Cheerfulness keeps up a kind of daylight in the mind. - Joseph Addison',
  'Hope is the thing with feathers that perches in the soul. - Emily Dickinson',
  "I'm not afraid of storms, for I'm learning how to sail my ship. - Louisa May Alcott",
];

const HEADER = '# Quotes\n\n%% One quote per line or bullet. Casa shows one of them in the room. %%\n\n';
const MAX = 400;

function filePath(settings) {
  return io.join((settings && settings.casaFolder) || 'Casa', 'Quotes.md');
}

function parse(text) {
  const { lines } = io.splitLines(text);
  const out = [];
  let inFm = lines[0] === '---';
  let fence = false;
  let comment = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (inFm) { if (i > 0 && (l === '---' || l === '...')) inFm = false; continue; }
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const opens = (l.match(/%%/g) || []).length;
    if (comment) { if (opens % 2 === 1) comment = false; continue; }
    if (/^\s*%%/.test(l) && opens % 2 === 1) { comment = true; continue; }
    if (/^\s*#{1,6}\s/.test(l) || /^\s*(---+|\*\*\*+)\s*$/.test(l)) continue;
    const t = l.replace(/%%.*?%%|<!--.*?-->/g, '')
      .replace(/^\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[.\]\s+)?/, '')
      .trim();
    if (t) out.push(t);
  }
  return out;
}

function split(q) {
  const m = /^(.*\S)\s+[-–—]{1,2}\s+([^-–—]{2,80})$/.exec(q);
  return m ? { text: m[1], author: m[2].trim() } : { text: q, author: '' };
}

function shape(quotes, path, exists) {
  return { quotes, items: quotes.map(split), path, exists, builtin: !exists };
}

async function get(ctx) {
  const path = filePath(ctx.settings);
  const file = io.getFile(ctx.app, path);
  if (!file) return { status: 200, json: shape(BUILTIN.slice(), path, false) };
  const quotes = parse(await io.read(ctx.app, file));
  return { status: 200, json: shape(quotes, path, true) };
}

async function post(ctx) {
  const b = ctx.body || {};
  if (b.op !== 'add') throw new io.HttpError(400, 'unknown op');
  const text = String(b.text == null ? '' : b.text).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX);
  if (!text) throw new io.HttpError(400, 'text is empty');
  const path = filePath(ctx.settings);
  const file = io.getFile(ctx.app, path);
  if (!file) {
    const body = HEADER + BUILTIN.concat([text]).map((q) => '- ' + q).join('\n') + '\n';
    await io.createNote(ctx.app, path, body);
  } else {
    await io.processFile(ctx.app, file, (t) => {
      const { lines, eol } = io.splitLines(t);
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      lines.push('- ' + text, '');
      return lines.join(eol);
    });
  }
  return get(ctx);
}

module.exports = { get, post, parse, split, filePath, BUILTIN };
