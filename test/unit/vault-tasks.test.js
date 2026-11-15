'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeVault, fakeApp, handWrite, readFile, ctxFor, call } = require('./vault-fake');
const { routes } = require('../../src/vault/index');
const tasks = require('../../src/vault/tasks');

const NOW = new Date(2026, 10, 9, 9, 30);

test('parseLine reads Tasks emoji metadata without the plugin', () => {
  const p = tasks.parseLine('  - [ ] Pay rent #home 🔼 📅 2026-11-09 ⏳ 2026-11-08 ^abc');
  assert.equal(p.text, 'Pay rent #home');
  assert.equal(p.due, '2026-11-09');
  assert.equal(p.scheduled, '2026-11-08');
  assert.equal(p.emoji, true);
  assert.equal(p.indent, 1);
  const d = tasks.parseLine('* [x] Done thing ✅ 2026-11-01');
  assert.deepEqual([d.status, d.doneDate, d.text], ['x', '2026-11-01', 'Done thing']);
  assert.equal(tasks.parseLine('1. [ ] numbered').text, 'numbered');
  assert.equal(tasks.parseLine('> - [/] in a callout ⌛ 2026-11-09').scheduled, '2026-11-09');
  assert.equal(tasks.parseLine('- [ ]').text, '');
  assert.equal(tasks.parseLine('- not a task'), null);
  assert.equal(tasks.parseLine('- [ ] plain').emoji, false);
});

function vaultWithTasks() {
  return makeVault({
    'Daily/2026-11-09.md': "## Today's goal\nFocus\n\n## Tasks\n- [ ] Morning run\n- [x] Coffee\n  - [ ] nested step\n- [-] Cancelled one\n",
    'Projects/Home.md': [
      '# Home',
      '- [ ] Fix the tap 📅 2026-11-09',
      '- [ ] Call the bank ⏳ 2026-11-09',
      '- [ ] Old bill 📅 2026-11-02',
      '- [ ] Late scheduled ⏳ 2026-11-05 📅 2026-11-20',
      '- [x] Done long ago 📅 2026-11-09 ✅ 2026-11-01',
      '- [x] Done today 📅 2026-11-08 ✅ 2026-11-09',
      '- [x] Plain done 📅 2026-11-09',
      '- [-] Dropped 📅 2026-11-09',
      '- [ ] Next week 📅 2026-11-12',
      '- [ ] Far away 📅 2026-12-30',
      '- [ ] Undated',
      '',
    ].join('\n'),
    'Templates/Daily.md': '- [ ] Template task 📅 2026-11-09\n',
    '.obsidian/templates.json': { folder: 'Templates' },
    'Casa/Post-its.md': '- [ ] not a real task 📅 2026-11-09\n',
  });
}

test('collect: today note checkboxes, due/scheduled today, overdue flagged, done skipped, upcoming', async () => {
  const root = vaultWithTasks();
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  const r = await call(routes, 'tasks', ctx);
  assert.equal(r.status, 200);
  const j = r.json;
  assert.equal(j.date, '2026-11-09');
  assert.equal(j.path, 'Daily/2026-11-09.md');
  assert.deepEqual(j.today.map((t) => [t.text, t.done, !!t.overdue, t.daily]), [
    ['Morning run', false, false, true],
    ['Coffee', true, false, true],
    ['nested step', false, false, true],
    ['Old bill', false, true, false],
    ['Late scheduled', false, true, false],
    ['Fix the tap', false, false, false],
    ['Call the bank', false, false, false],
    ['Done today', true, false, false],
  ]);
  const tap = j.today.find((t) => t.text === 'Fix the tap');
  assert.deepEqual([tap.path, tap.line, tap.due], ['Projects/Home.md', 1, '2026-11-09']);
  assert.equal(j.today.find((t) => t.text === 'Call the bank').due, '2026-11-09');
  assert.equal(j.today.find((t) => t.text === 'nested step').indent, 1);
  assert.deepEqual(j.upcoming.map((t) => [t.text, t.due]), [['Next week', '2026-11-12']]);
  assert.match(j.rev, /^[0-9a-z]+$/);
});

test('collect: tasks inside fenced code blocks and empty template rows are not listed (harness bugs 1-2)', async () => {
  const root = makeVault({
    'Daily/2026-11-09.md': [
      "## Today's goal", 'Focus', '', '## Tasks', '- [ ] Real task', '- [ ] ', '- [ ]',
      '```markdown', '- [ ] Code block task, must be ignored', '```',
      '~~~', '- [ ] Tilde fence task', '~~~', '- [ ] After the fences', '',
    ].join('\n'),
    'Notes/Example.md': ['# How to write tasks', '```', '- [ ] Example task 📅 2026-11-09', '```', '- [ ] Real dated task 📅 2026-11-09', ''].join('\n'),
  });
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  const r = await call(routes, 'tasks', ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.today.map((t) => t.text), ['Real task', 'After the fences', 'Real dated task']);
});

test('collect: same result without metadataCache (fallback reads files)', async () => {
  const root = vaultWithTasks();
  const a = await call(routes, 'tasks', ctxFor(fakeApp(root), { now: NOW }));
  const b = await call(routes, 'tasks', ctxFor(fakeApp(root, { noCache: true }), { now: NOW }));
  assert.deepEqual(b.json.today.map((t) => t.id), a.json.today.map((t) => t.id));
});

test('collect: files without tasks are not read (metadataCache says so)', async () => {
  const files = { 'Daily/2026-11-09.md': '- [ ] a\n' };
  for (let i = 0; i < 50; i++) files['Notes/n' + i + '.md'] = 'Just prose, no list.\n';
  const app = fakeApp(makeVault(files));
  await call(routes, 'tasks', ctxFor(app, { now: NOW }));
  assert.ok(app.stats.reads <= 2, 'reads: ' + app.stats.reads);
});

test('Tasks global filter is respected for vault tasks', async () => {
  const root = makeVault({
    '.obsidian/plugins/obsidian-tasks-plugin/data.json': { globalFilter: '#task' },
    'P.md': '- [ ] tagged #task 📅 2026-11-09\n- [ ] untagged 📅 2026-11-09\n',
  });
  const r = await call(routes, 'tasks', ctxFor(fakeApp(root), { now: NOW }));
  assert.deepEqual(r.json.today.map((t) => t.text), ['tagged #task']);
});

test('toggle round-trip: plain line gets no done date, emoji line gets ✅ and loses it on undo', async () => {
  const root = vaultWithTasks();
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  let j = (await call(routes, 'tasks', ctx)).json;
  const run = j.today.find((t) => t.text === 'Morning run');
  let r = await call(routes, 'tasks', ctx, { op: 'toggle', id: run.id, rev: j.rev });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.notEqual(r.json.rev, j.rev);
  assert.equal(r.json.task.done, true);
  assert.match(readFile(root, 'Daily/2026-11-09.md'), /\n- \[x\] Morning run\n/);

  const tap = j.today.find((t) => t.text === 'Fix the tap');
  r = await call(routes, 'tasks', ctx, { op: 'toggle', id: tap.id, rev: j.rev });
  assert.equal(r.status, 200);
  assert.equal(readFile(root, 'Projects/Home.md').split('\n')[1], '- [x] Fix the tap 📅 2026-11-09 ✅ 2026-11-09');
  j = (await call(routes, 'tasks', ctx)).json;
  const tapDone = j.today.find((t) => t.text === 'Fix the tap');
  assert.equal(tapDone.done, true, 'completed today stays visible, struck through');
  r = await call(routes, 'tasks', ctx, { op: 'toggle', id: tapDone.id });
  assert.equal(readFile(root, 'Projects/Home.md').split('\n')[1], '- [ ] Fix the tap 📅 2026-11-09');
});

test('toggle keeps a block id last', () => {
  assert.equal(tasks.toggleLine('- [ ] Pay 📅 2026-11-09 ^b1', '2026-11-09'), '- [x] Pay 📅 2026-11-09 ✅ 2026-11-09 ^b1');
  assert.equal(tasks.toggleLine('- [x] Pay 📅 2026-11-09 ✅ 2026-11-09 ^b1', '2026-11-09'), '- [ ] Pay 📅 2026-11-09 ^b1');
});

test('stale: changed line answers 412 and writes nothing; moved line is found', async () => {
  const root = vaultWithTasks();
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  const j = (await call(routes, 'tasks', ctx)).json;
  const tap = j.today.find((t) => t.text === 'Fix the tap');
  const bank = j.today.find((t) => t.text === 'Call the bank');

  const text = readFile(root, 'Projects/Home.md');
  handWrite(root, 'Projects/Home.md', text.replace('Fix the tap', 'Fix the kitchen tap'));
  const before = readFile(root, 'Projects/Home.md');
  let r = await call(routes, 'tasks', ctx, { op: 'toggle', id: tap.id, rev: j.rev });
  assert.equal(r.status, 412);
  assert.deepEqual(r.json, { error: 'stale' });
  assert.equal(readFile(root, 'Projects/Home.md'), before);

  // A line added above: the task moved down one line but is unique, so the toggle lands on it.
  handWrite(root, 'Projects/Home.md', 'New first line\n' + before);
  r = await call(routes, 'tasks', ctx, { op: 'toggle', id: bank.id });
  assert.equal(r.status, 200);
  assert.equal(readFile(root, 'Projects/Home.md').split('\n')[3], '- [x] Call the bank ⏳ 2026-11-09 ✅ 2026-11-09');

  r = await call(routes, 'tasks', ctx, { op: 'toggle', id: 'abc:1:Missing.md' });
  assert.equal(r.status, 412);
  r = await call(routes, 'tasks', ctx, { op: 'toggle', id: 'garbage' });
  assert.equal(r.status, 400);
});

test('edit keeps status and metadata; add goes under the Tasks heading', async () => {
  const root = vaultWithTasks();
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  const j = (await call(routes, 'tasks', ctx)).json;
  const bill = j.today.find((t) => t.text === 'Old bill');
  let r = await call(routes, 'tasks', ctx, { op: 'edit', id: bill.id, text: 'Pay the old bill' });
  assert.equal(r.status, 200);
  assert.equal(readFile(root, 'Projects/Home.md').split('\n')[3], '- [ ] Pay the old bill 📅 2026-11-02');
  r = await call(routes, 'tasks', ctx, { op: 'edit', id: bill.id, text: '' });
  assert.equal(r.status, 400);

  r = await call(routes, 'tasks', ctx, { op: 'add', text: 'Buy stamps\nand envelopes' });
  assert.equal(r.status, 200);
  assert.equal(r.json.task.text, 'Buy stamps and envelopes');
  assert.equal(readFile(root, 'Daily/2026-11-09.md'),
    "## Today's goal\nFocus\n\n## Tasks\n- [ ] Morning run\n- [x] Coffee\n  - [ ] nested step\n- [-] Cancelled one\n- [ ] Buy stamps and envelopes\n");
  r = await call(routes, 'tasks', ctx, { op: 'nope' });
  assert.equal(r.status, 400);
});

test('insertTask: heading with following section, or a new heading at the end', () => {
  assert.equal(tasks.insertTask('# Day\n## To do\n- [ ] a\n\n## Notes\ntext\n', '- [ ] b'), '# Day\n## To do\n- [ ] a\n- [ ] b\n\n## Notes\ntext\n');
  assert.equal(tasks.insertTask('# Day\nsome text\n\n', '- [ ] b'), '# Day\nsome text\n\n## Tasks\n- [ ] b\n');
});

test('Tasks plugin API is used for emoji tasks when present (recurring tasks roll over)', async () => {
  const root = makeVault({ 'R.md': '- [ ] Water plants 🔁 every week 📅 2026-11-09\n' });
  const calls = [];
  const plugins = {
    'obsidian-tasks-plugin': {
      apiV1: {
        executeToggleTaskDoneCommand(line, path) {
          calls.push(path);
          return '- [ ] Water plants 🔁 every week 📅 2026-11-16\n' + line.replace('[ ]', '[x]') + ' ✅ 2026-11-09';
        },
      },
    },
  };
  const ctx = ctxFor(fakeApp(root, { plugins }), { now: NOW });
  const j = (await call(routes, 'tasks', ctx)).json;
  const r = await call(routes, 'tasks', ctx, { op: 'toggle', id: j.today[0].id });
  assert.equal(r.status, 200);
  assert.deepEqual(calls, ['R.md']);
  assert.equal(readFile(root, 'R.md'), '- [ ] Water plants 🔁 every week 📅 2026-11-16\n- [x] Water plants 🔁 every week 📅 2026-11-09 ✅ 2026-11-09\n');
  assert.equal(r.json.task && r.json.task.done, true);
});
