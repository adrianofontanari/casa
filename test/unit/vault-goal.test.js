'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeVault, fakeApp, readFile, listAll, ctxFor, call } = require('./vault-fake');
const { routes } = require('../../src/vault/index');
const { readGoal, writeGoal } = require('../../src/vault/goal');

const NOW = new Date(2026, 10, 9, 9, 30);

test('read: frontmatter goal', () => {
  assert.deepEqual(readGoal('---\ntags: [daily]\ngoal: "Finish: the report"\n---\n# Day\n'), { focus: 'Finish: the report', source: 'frontmatter' });
  assert.equal(readGoal("---\ngoal: 'It''s fine'\n---\n").focus, "It's fine");
  assert.equal(readGoal('---\ngoal:\n  - First item\n---\n').focus, 'First item');
});

test('read: first non-empty line under a goal/focus/today heading', () => {
  assert.deepEqual(readGoal('# 2026-11-09\n\n### TODAY\n\n- Write the intro\n- second\n'), { focus: 'Write the intro', source: 'heading' });
  assert.equal(readGoal('## Focus of the day\n\n%% hint %%\n**Ship it**\n').focus, 'Ship it');
  // A tasks heading is not a goal slot; a checkbox is not a goal.
  assert.equal(readGoal("## Today's tasks\n- [ ] a\n## Today\n- [ ] b\n").focus, '');
  // Goal outranks focus outranks today.
  assert.equal(readGoal('## Today\nA\n## Focus\nB\n## Goal\nC\n').focus, 'C');
  // Headings inside code fences are ignored.
  assert.equal(readGoal('```\n## Goal\nnope\n```\n').focus, '');
});

test('read: a line starting Goal:', () => {
  assert.deepEqual(readGoal('Some text\nGoal: Clean the inbox\n'), { focus: 'Clean the inbox', source: 'line' });
  assert.equal(readGoal('- **Goal:** Run 5k\n').focus, 'Run 5k');
  assert.equal(readGoal('goal:: Read\n').focus, 'Read');
  assert.equal(readGoal('Goals: plural is not it\n').focus, '');
});

test('read: first form holding a value wins (empty heading slot does not hide a Goal: line)', () => {
  assert.equal(readGoal("## Today's goal\n\n## Notes\nGoal: from the line\n").focus, 'from the line');
});

test('write: updates each form in place', () => {
  assert.equal(writeGoal('---\ngoal: old\nmood: ok\n---\nbody\n', 'new: one'), '---\ngoal: "new: one"\nmood: ok\n---\nbody\n');
  assert.equal(writeGoal('---\ngoal: old\n---\n', 'plain words'), '---\ngoal: plain words\n---\n');
  assert.equal(writeGoal('# D\n## Focus\n- old goal\n## Tasks\n', 'new goal'), '# D\n## Focus\n- new goal\n## Tasks\n');
  assert.equal(writeGoal('## Goal\n\n## Tasks\n', 'fill me'), '## Goal\nfill me\n\n## Tasks\n');
  assert.equal(writeGoal('intro\n- **Goal:** old\n', 'new'), 'intro\n- **Goal:** new\n');
  assert.equal(writeGoal('a\r\nGoal: x\r\nb\r\n', 'y'), 'a\r\nGoal: y\r\nb\r\n', 'CRLF kept');
});

test('write: clearing', () => {
  assert.equal(writeGoal('## Goal\nold\n\n## Tasks\n', ''), '## Goal\n\n## Tasks\n');
  assert.equal(writeGoal('---\ngoal: old\n---\n', ''), '---\ngoal:\n---\n');
  assert.equal(writeGoal('just text\n', ''), 'just text\n', 'nothing to clear: unchanged');
});

test('write: no slot adds ## Today\'s goal near the top', () => {
  assert.equal(writeGoal('---\na: 1\n---\n# 2026-11-09\nNotes here\n', 'Do X'), "---\na: 1\n---\n# 2026-11-09\n\n## Today's goal\nDo X\n\nNotes here\n");
  assert.equal(writeGoal('Notes here\n', 'Do X'), "## Today's goal\nDo X\n\nNotes here\n");
  assert.equal(writeGoal('', 'Do X'), "## Today's goal\nDo X\n");
  assert.equal(writeGoal('a\nb', 'one\ntwo'), "## Today's goal\none two\n\na\nb", 'newlines collapse to one line');
});

test('route: goal written into an existing note in each form, file created only on write', async () => {
  const root = makeVault({ 'Daily/2026-11-09.md': '# Monday\nSome notes\n' });
  const ctx = ctxFor(fakeApp(root), { now: NOW });
  let r = await call(routes, 'focus', ctx);
  assert.deepEqual([r.json.focus, r.json.exists, r.json.source], ['', true, null]);
  r = await call(routes, 'focus', ctx, { focus: 'Finish chapter 2' });
  assert.equal(r.json.focus, 'Finish chapter 2');
  assert.equal(readFile(root, 'Daily/2026-11-09.md'), "# Monday\n\n## Today's goal\nFinish chapter 2\n\nSome notes\n");
  r = await call(routes, 'focus', ctx, { focus: 'Finish chapter 3' });
  assert.equal(readFile(root, 'Daily/2026-11-09.md'), "# Monday\n\n## Today's goal\nFinish chapter 3\n\nSome notes\n");
  r = await call(routes, 'focus', ctx, { nope: 1 });
  assert.equal(r.status, 400);

  const root2 = makeVault({});
  const ctx2 = ctxFor(fakeApp(root2), { now: NOW });
  await call(routes, 'focus', ctx2);
  assert.deepEqual(listAll(root2), []);
});
