'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeVault, fakeApp, readFile, exists, listAll, ctxFor, call } = require('./vault-fake');
const { routes } = require('../../src/vault/index');
const daily = require('../../src/vault/daily');
const { formatDate } = require('../../src/vault/when');

const NOW = new Date(2026, 10, 9, 9, 30);

test('formatter covers the usual daily-note tokens', () => {
  assert.equal(formatDate(NOW, 'YYYY-MM-DD'), '2026-11-09');
  assert.equal(formatDate(NOW, 'YYYY/MM/YYYY-MM-DD'), '2026/11/2026-11-09');
  assert.equal(formatDate(NOW, 'dddd, MMMM Do YYYY'), 'Monday, November 9th 2026');
  assert.equal(formatDate(NOW, '[Week] WW, ddd D MMM'), 'Week 46, Mon 9 Nov');
  assert.equal(formatDate(NOW, 'GGGG-[W]WW'), '2026-W46');
  assert.equal(formatDate(new Date(2026, 0, 1), 'gggg-[W]ww'), '2026-W01');
});

test('empty vault, no config: Casa default, nothing written until the user writes', async () => {
  const root = makeVault({ 'Welcome.md': '# Hi\n' });
  const app = fakeApp(root);
  const ctx = ctxFor(app, { now: NOW });
  const before = listAll(root);

  const info = await daily.detect(ctx);
  assert.equal(info.source, 'casa');
  assert.equal(info.folder, 'Daily');
  assert.equal(info.format, 'YYYY-MM-DD');
  assert.equal(info.path, 'Daily/2026-11-09.md');
  assert.equal(info.exists, false);
  assert.equal(info.found, 0);

  for (const r of ['focus', 'tasks', 'notes', 'quotes', 'onboarding']) {
    const res = await call(routes, r, ctx);
    assert.equal(res.status, 200, r + ' answers 200');
  }
  const focus = await call(routes, 'focus', ctx);
  assert.deepEqual([focus.json.focus, focus.json.exists, focus.json.date, focus.json.path], ['', false, '2026-11-09', 'Daily/2026-11-09.md']);
  const tasks = await call(routes, 'tasks', ctx);
  assert.deepEqual(tasks.json.today, []);
  assert.equal(typeof tasks.json.rev, 'string');
  const quotes = await call(routes, 'quotes', ctx);
  assert.equal(quotes.json.builtin, true);
  assert.deepEqual(listAll(root), before, 'GET wrote nothing');

  // Clearing an empty goal on a missing note does not create it either.
  await call(routes, 'focus', ctx, { focus: '  ' });
  assert.deepEqual(listAll(root), before);

  const set = await call(routes, 'focus', ctx, { focus: 'Ship the first draft' });
  assert.equal(set.status, 200);
  assert.equal(set.json.focus, 'Ship the first draft');
  assert.equal(set.json.exists, true);
  assert.equal(readFile(root, 'Daily/2026-11-09.md'), "## Today's goal\nShip the first draft\n\n## Tasks\n");

  const add = await call(routes, 'tasks', ctx, { op: 'add', text: 'Call the plumber' });
  assert.equal(add.status, 200);
  assert.equal(add.json.ok, true);
  assert.equal(add.json.task.text, 'Call the plumber');
  assert.equal(readFile(root, 'Daily/2026-11-09.md'), "## Today's goal\nShip the first draft\n\n## Tasks\n- [ ] Call the plumber\n");
});

test('add task on a missing note creates it (minimal template) with the task under ## Tasks', async () => {
  const root = makeVault({});
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  const res = await call(routes, 'tasks', ctx, { op: 'add', text: 'Water plants' });
  assert.equal(res.status, 200);
  assert.equal(readFile(root, 'Daily/2026-11-09.md'), "## Today's goal\n\n## Tasks\n- [ ] Water plants\n");
});

test('core Daily notes with a template: detected, template used on first write', async () => {
  const root = makeVault({
    '.obsidian/core-plugins.json': { 'daily-notes': true, templates: true },
    '.obsidian/daily-notes.json': { folder: 'Journal', format: 'YYYY-MM-DD', template: 'Templates/Daily' },
    '.obsidian/templates.json': { folder: 'Templates' },
    'Templates/Daily.md': '---\ncreated: {{date:YYYY-MM-DD}}\n---\n# {{title}}\n\n## Focus\n\n## Tasks\n- [ ] Review inbox 📅 {{date}}\n',
    'Journal/2026-11-08.md': '# 2026-11-08\n',
  });
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  const info = await daily.detect(ctx);
  assert.equal(info.source, 'core');
  assert.equal(info.folder, 'Journal');
  assert.equal(info.template, 'Templates/Daily');
  assert.equal(info.found, 1);
  assert.equal(info.example, '2026-11-09');

  // Tasks in the template folder are not real tasks.
  const t0 = await call(routes, 'tasks', ctx);
  assert.deepEqual(t0.json.today, []);

  await call(routes, 'focus', ctx, { focus: 'Plan the week' });
  assert.equal(readFile(root, 'Journal/2026-11-09.md'),
    '---\ncreated: 2026-11-09\n---\n# 2026-11-09\n\n## Focus\nPlan the week\n\n## Tasks\n- [ ] Review inbox 📅 2026-11-09\n');
  const t1 = await call(routes, 'tasks', ctx);
  assert.deepEqual(t1.json.today.map((t) => t.text), ['Review inbox']);
});

test('core: legacy array core-plugins.json and live internalPlugins state both work', async () => {
  const root = makeVault({
    '.obsidian/core-plugins.json': ['file-explorer', 'daily-notes'],
    '.obsidian/daily-notes.json': { folder: 'Days', format: 'DD-MM-YYYY' },
    'Days/.keep': '',
  });
  const app = fakeApp(root);
  let info = await daily.detect(ctxFor(app, { now: NOW }));
  assert.deepEqual([info.source, info.path, info.enabled], ['core', 'Days/09-11-2026.md', true]);
  app.internalPlugins = { getPluginById: () => ({ enabled: false }) };
  info = await daily.detect(ctxFor(app, { now: NOW }));
  assert.equal(info.source, 'core', 'settings file alone still counts when its folder exists');
  assert.equal(info.enabled, false);
});

test('a settings file pointing at a missing folder falls back gracefully', async () => {
  const root = makeVault({
    '.obsidian/core-plugins.json': { 'daily-notes': true },
    '.obsidian/daily-notes.json': { folder: 'Gone', format: 'YYYY-MM-DD' },
    '.obsidian/plugins/periodic-notes/data.json': { daily: { enabled: true, folder: 'AlsoGone', format: 'YYYY-MM-DD' } },
  });
  const info = await daily.detect(ctxFor(fakeApp(root), { now: NOW }));
  assert.deepEqual([info.source, info.folder], ['casa', 'Daily']);
});

test('core enabled with no settings and no notes uses Casa default, not the vault root', async () => {
  const root = makeVault({ '.obsidian/core-plugins.json': { 'daily-notes': true } });
  const info = await daily.detect(ctxFor(fakeApp(root), { now: NOW }));
  assert.deepEqual([info.source, info.path], ['casa', 'Daily/2026-11-09.md']);
  // ...but root notes written by core Daily notes win.
  const root2 = makeVault({ '.obsidian/core-plugins.json': { 'daily-notes': true }, '2026-11-07.md': 'x' });
  const info2 = await daily.detect(ctxFor(fakeApp(root2), { now: NOW }));
  assert.deepEqual([info2.source, info2.path, info2.found], ['core', '2026-11-09.md', 1]);
});

test('Periodic Notes with a nested format, without the plugin installed', async () => {
  const root = makeVault({
    '.obsidian/plugins/periodic-notes/data.json': {
      daily: { format: 'YYYY/MM/YYYY-MM-DD', template: 'Templates/Daily', folder: 'Daily', enabled: true },
      weekly: { format: 'gggg-[W]ww', folder: 'Weekly', enabled: false },
    },
    'Templates/Daily.md': '# {{date}}\n\nGoal:\n',
    'Daily/2026/11/2026-11-06.md': 'old',
  });
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  const info = await daily.detect(ctx);
  assert.deepEqual([info.source, info.folder, info.format, info.path, info.found, info.enabled],
    ['periodic', 'Daily', 'YYYY/MM/YYYY-MM-DD', 'Daily/2026/11/2026-11-09.md', 1, false]);
  await call(routes, 'focus', ctx, { focus: 'Tidy the desk' });
  assert.equal(readFile(root, 'Daily/2026/11/2026-11-09.md'), '# 2026-11-09\n\nGoal: Tidy the desk\n');
});

test('Periodic Notes 1.x calendarSets shape', async () => {
  const root = makeVault({
    '.obsidian/plugins/periodic-notes/data.json': {
      activeCalendarSet: 'b',
      calendarSets: [{ id: 'a', day: { enabled: true, folder: 'X', format: 'YYYY' } }, { id: 'b', day: { enabled: true, folder: 'Log', format: 'YYYY-MM-DD', templatePath: 'T.md' } }],
    },
    '.obsidian/community-plugins.json': ['periodic-notes'],
    'Log/.keep': '',
  });
  const info = await daily.detect(ctxFor(fakeApp(root), { now: NOW }));
  assert.deepEqual([info.source, info.folder, info.template, info.enabled], ['periodic', 'Log', 'T.md', true]);
});

test('Journals plugin settings, plain and with a dated folder', async () => {
  const root = makeVault({
    '.obsidian/plugins/journals/data.json': {
      version: 8,
      journals: {
        monthly: { name: 'monthly', write: { type: 'month' }, dateFormat: 'YYYY-MM', folder: 'monthly' },
        daily: { name: 'daily', write: { type: 'day' }, dateFormat: 'YYYY-MM-DD', folder: 'day', templates: ['Templates/Day.md'] },
      },
    },
    '.obsidian/community-plugins.json': ['journals'],
    'day/.keep': '',
  });
  const info = await daily.detect(ctxFor(fakeApp(root), { now: NOW }));
  assert.deepEqual([info.source, info.folder, info.format, info.template, info.path], ['journals', 'day', 'YYYY-MM-DD', 'Templates/Day.md', 'day/2026-11-09.md']);

  assert.deepEqual(daily.journalsToFormat({ name: 'Diary', folder: 'Journal/{{journal_name}}/{{date:YYYY}}', nameTemplate: '{{date}}', dateFormat: 'YYYY-MM-DD' }),
    { folder: 'Journal/Diary', format: 'YYYY/YYYY-MM-DD' });
  assert.deepEqual(daily.journalsToFormat({ name: 'd', folder: '', nameTemplate: 'Day {{date:DD}}', dateFormat: 'YYYY' }), { folder: '', format: '[Day ]DD' });
  assert.equal(daily.journalsToFormat({ name: 'd', nameTemplate: '{{index}}', dateFormat: 'YYYY' }), null);
});

test('no config but a folder full of dated notes: guessed', async () => {
  const root = makeVault({ 'Notes/2026-11-01.md': 'a', 'Notes/2026-11-02.md': 'b', 'Notes/2026-10-01.md': 'c', 'Other/2026-01-01.md': 'd' });
  const info = await daily.detect(ctxFor(fakeApp(root), { now: NOW }));
  assert.deepEqual([info.source, info.folder, info.guessed], ['casa', 'Notes', true]);
});

test('custom mode from Casa settings wins', async () => {
  const root = makeVault({ '.obsidian/daily-notes.json': { folder: 'Journal' }, 'Journal/2026-11-08.md': 'x' });
  const ctx = ctxFor(fakeApp(root), { now: NOW, settings: { dailyMode: 'custom', dailyFolder: 'Life/Days', dailyFormat: 'YYYY-MM-DD dddd' } });
  const info = await daily.detect(ctx);
  assert.deepEqual([info.source, info.custom, info.path], ['casa', true, 'Life/Days/2026-11-09 Monday.md']);
  await call(routes, 'focus', ctx, { focus: 'Rest' });
  assert.ok(exists(root, 'Life/Days/2026-11-09 Monday.md'));
});
