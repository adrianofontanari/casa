'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeVault, fakeApp, handWrite, readFile, exists, ctxFor, call } = require('./vault-fake');
const { routes } = require('../../src/vault/index');
const quotes = require('../../src/vault/quotes');

const NOW = new Date(2026, 10, 9, 9, 30);

test('post-its: no file until the first add, then a readable note', async () => {
  const root = makeVault({});
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  let r = await call(routes, 'notes', ctx);
  assert.deepEqual(r.json, { notes: [], path: 'Casa/Post-its.md', exists: false });
  assert.equal(exists(root, 'Casa/Post-its.md'), false);
  r = await call(routes, 'notes', ctx, { op: 'move', id: 'x', x: 0.1, y: 0.1 });
  assert.equal(r.status, 404);
  assert.equal(exists(root, 'Casa/Post-its.md'), false);

  r = await call(routes, 'notes', ctx, { op: 'add', text: 'Call mum back', color: 'pink' });
  assert.equal(r.status, 200);
  assert.equal(r.json.notes.length, 1);
  const n = r.json.notes[0];
  assert.deepEqual([n.text, n.color, typeof n.x, typeof n.y], ['Call mum back', 'pink', 'number', 'number']);
  const text = readFile(root, 'Casa/Post-its.md');
  assert.match(text, /^# Post-its\n/);
  assert.ok(text.includes('- Call mum back %%casa ' + n.id + ' pink '), text);
});

test('post-its: hand edits round-trip; move, edit, delete touch only their item', async () => {
  const root = makeVault({});
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  const a = (await call(routes, 'notes', ctx, { op: 'add', text: 'First', x: 0.2, y: 0.3 })).json.notes[0];
  await call(routes, 'notes', ctx, { op: 'add', text: 'Second\nwith a second line', color: 'blue' });

  // By hand: a prose line, a new bullet without the hidden code, and the first note's text changed.
  let t = readFile(root, 'Casa/Post-its.md');
  t = t.replace('- First %%', '- First, edited by hand %%') + 'A line of my own.\n- Typed in Obsidian\n';
  handWrite(root, 'Casa/Post-its.md', t);

  let notes = (await call(routes, 'notes', ctx)).json.notes;
  assert.deepEqual(notes.map((x) => x.text), ['First, edited by hand', 'Second\nwith a second line', 'Typed in Obsidian']);
  assert.equal(notes[0].id, a.id, 'id survives a text edit');
  assert.deepEqual([notes[0].x, notes[0].y], [0.2, 0.3]);
  assert.equal(notes[1].color, 'blue');
  assert.equal(notes[2].color, 'yellow', 'default colour for a hand-typed note');
  const handId = notes[2].id;
  assert.equal((await call(routes, 'notes', ctx)).json.notes[2].id, handId, 'hand-typed note has a stable id');

  let r = await call(routes, 'notes', ctx, { op: 'move', id: handId, x: 0.9, y: 1.7 });
  assert.equal(r.status, 200);
  notes = r.json.notes;
  assert.deepEqual([notes[2].x, notes[2].y], [0.9, 1]);
  assert.ok(readFile(root, 'Casa/Post-its.md').includes('A line of my own.'), 'prose kept');

  r = await call(routes, 'notes', ctx, { op: 'edit', id: notes[1].id, text: 'Second, shorter', color: 'green' });
  assert.deepEqual([r.json.notes[1].text, r.json.notes[1].color], ['Second, shorter', 'green']);
  assert.ok(!readFile(root, 'Casa/Post-its.md').includes('with a second line'));

  r = await call(routes, 'notes', ctx, { op: 'delete', id: a.id });
  assert.deepEqual(r.json.notes.map((x) => x.text), ['Second, shorter', 'Typed in Obsidian']);
  const final = readFile(root, 'Casa/Post-its.md');
  assert.ok(final.startsWith('# Post-its\n'));
  assert.ok(!final.includes('First'));

  r = await call(routes, 'notes', ctx, { op: 'edit', id: 'nope', text: 'x' });
  assert.equal(r.status, 404);
  r = await call(routes, 'notes', ctx, { op: 'add', text: '   ' });
  assert.equal(r.status, 400);
});

test('post-its: casaFolder setting moves the note; %% in text cannot break the hidden code', async () => {
  const root = makeVault({});
  const ctx = ctxFor(fakeApp(root), { now: NOW, settings: { casaFolder: 'Home/Casa' } });
  const r = await call(routes, 'notes', ctx, { op: 'add', text: 'a %%casa evil%% b' });
  assert.equal(r.json.path, 'Home/Casa/Post-its.md');
  assert.equal(r.json.notes[0].text, 'a %casa evil% b');
});

test('quotes: built-in public-domain set when the note is missing, file only on add', async () => {
  const root = makeVault({});
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  let r = await call(routes, 'quotes', ctx);
  assert.equal(r.json.exists, false);
  assert.equal(r.json.builtin, true);
  assert.equal(r.json.path, 'Casa/Quotes.md');
  assert.ok(r.json.quotes.length >= 20);
  assert.ok(r.json.quotes.every((q) => typeof q === 'string' && q.length < 120));
  assert.deepEqual(r.json.items[0], { text: 'Slow but steady wins the race.', author: 'Aesop' });
  assert.equal(exists(root, 'Casa/Quotes.md'), false);

  r = await call(routes, 'quotes', ctx, { op: 'add', text: 'Small steps every day.' });
  assert.equal(r.status, 200);
  assert.equal(r.json.exists, true);
  assert.equal(r.json.quotes.length, quotes.BUILTIN.length + 1);
  assert.equal(r.json.quotes[r.json.quotes.length - 1], 'Small steps every day.');
  assert.ok(readFile(root, 'Casa/Quotes.md').startsWith('# Quotes\n'));

  r = await call(routes, 'quotes', ctx, { op: 'add', text: 'Another.' });
  assert.equal(r.json.quotes[r.json.quotes.length - 1], 'Another.');
  r = await call(routes, 'quotes', ctx, { op: 'add', text: '' });
  assert.equal(r.status, 400);
});

test('quotes: a hand-written note, bullets, plain lines and blockquotes', () => {
  const q = quotes.parse('---\ntags: x\n---\n# My quotes\n\n- One - Someone\nTwo\n> Three\n1. Four\n%% hidden %%\n%%\nblock\ncomment\n%%\n```\ncode\n```\n');
  assert.deepEqual(q, ['One - Someone', 'Two', 'Three', 'Four']);
  assert.deepEqual(quotes.split('One - Someone'), { text: 'One', author: 'Someone' });
  assert.deepEqual(quotes.split('No author here'), { text: 'No author here', author: '' });
});
