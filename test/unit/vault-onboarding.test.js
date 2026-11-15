'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeVault, fakeApp, listAll, ctxFor, call } = require('./vault-fake');
const { routes, setup } = require('../../src/vault/index');
const { parseCalendarInput, parseFolderInput } = require('../../src/vault/prompts');
const { createRouter } = require('../../src/plugin/router');

const NOW = new Date(2026, 10, 9, 9, 30);

test('GET onboarding: what was detected, nothing written', async () => {
  const root = makeVault({
    '.obsidian/core-plugins.json': { 'daily-notes': true },
    '.obsidian/daily-notes.json': { folder: 'Journal' },
    'Journal/2026-11-08.md': 'x',
  });
  const before = listAll(root);
  const r = await call(routes, 'onboarding', ctxFor(fakeApp(root), { now: NOW }));
  assert.equal(r.status, 200);
  assert.deepEqual(
    [r.json.daily.source, r.json.daily.folder, r.json.daily.example, r.json.daily.found, r.json.city, r.json.calendar, r.json.done],
    ['core', 'Journal', '2026-11-09', 1, null, false, false]);
  assert.deepEqual(listAll(root), before);
});

test('steps: daily confirms, city saved, done; restart is not a room step', async () => {
  const ctx = ctxFor(fakeApp(makeVault({})), { now: NOW });
  let r = await call(routes, 'onboarding', ctx, { step: 'daily' });
  assert.equal(r.status, 200);
  assert.deepEqual(ctx.saved, [], 'daily step only confirms');
  r = await call(routes, 'onboarding', ctx, { step: 'city', city: { name: 'Lisbon, Portugal', lat: 38.72, lon: -9.14, extra: 'dropped' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.city, { name: 'Lisbon, Portugal', lat: 38.72, lon: -9.14 });
  r = await call(routes, 'onboarding', ctx, { step: 'city', city: null });
  assert.equal(r.json.city, null);
  r = await call(routes, 'onboarding', ctx, { step: 'done' });
  assert.equal(r.json.done, true);
  r = await call(routes, 'onboarding', ctx, { step: 'restart' });
  assert.equal(r.status, 400);
  assert.equal(ctx.settings.onboarded, true);
});

test('calendar and folder: the room body is never used; without a native prompt nothing is saved', async () => {
  const ctx = ctxFor(fakeApp(makeVault({})), { now: NOW });
  let r = await call(routes, 'onboarding', ctx, { step: 'calendar', url: 'https://x.example.com/a.ics', calendarUrl: 'https://x.example.com/b.ics' });
  assert.equal(r.status, 501);
  assert.equal(r.json.saved, false);
  r = await call(routes, 'onboarding', ctx, { step: 'folder', folder: '../../etc', dailyFolder: 'X' });
  assert.equal(r.status, 501);
  r = await call(routes, 'onboarding', ctx, { step: 'settings', calendarUrl: 'https://example.com/a.ics' });
  assert.equal(r.status, 400);
  assert.deepEqual(ctx.saved, []);
  assert.equal(ctx.settings.calendarUrl, '');
  assert.equal(ctx.settings.dailyMode, 'auto');
});

test('calendar: the value typed in the native prompt is saved (webcal becomes https), never echoed', async () => {
  const asked = [];
  const prompts = {
    calendar: async () => { asked.push('calendar'); return 'webcal://p01-caldav.example.com/published/2/abc'; },
    folder: async () => { asked.push('folder'); return { path: 'Life/Journal', create: true }; },
  };
  const ctx = Object.assign(ctxFor(fakeApp(makeVault({ 'Journal/2026-11-08.md': 'x', '.obsidian/daily-notes.json': { folder: 'Journal', format: 'YYYY-MM-DD' } })), { now: NOW }), { prompts });
  let r = await call(routes, 'onboarding', ctx, { step: 'calendar', url: 'https://evil.example.com/ignored.ics' });
  assert.deepEqual([r.status, r.json], [200, { saved: true }]);
  assert.equal(ctx.settings.calendarUrl, 'https://p01-caldav.example.com/published/2/abc');
  assert.ok(!JSON.stringify(r.json).includes('example'), 'value not echoed');

  r = await call(routes, 'onboarding', ctx, { step: 'folder', folder: 'ignored' });
  assert.deepEqual([r.status, r.json], [200, { saved: true }]);
  assert.deepEqual([ctx.settings.dailyMode, ctx.settings.dailyFolder, ctx.settings.dailyFormat], ['custom', 'Life/Journal', 'YYYY-MM-DD']);
  assert.deepEqual(asked, ['calendar', 'folder']);
  r = await call(routes, 'onboarding', ctx);
  assert.deepEqual([r.json.daily.source, r.json.daily.folder, r.json.calendar], ['casa', 'Life/Journal', true]);
});

test('calendar and folder: cancel and invalid values save nothing', async () => {
  const answers = [null, 'http://plain.example.com/a.ics', 'javascript:alert(1)', 'not a link'];
  const folders = [null, { path: '../outside' }, { path: '.hidden' }, { path: 'a:b' }];
  const prompts = { calendar: async () => answers.shift(), folder: async () => folders.shift() };
  const ctx = Object.assign(ctxFor(fakeApp(makeVault({})), { now: NOW }), { prompts });
  for (let i = 0; i < 4; i++) {
    const r = await call(routes, 'onboarding', ctx, { step: 'calendar' });
    assert.equal(r.json.saved, false, 'calendar ' + i);
    assert.equal(r.status, i === 0 ? 200 : 400);
  }
  for (let i = 0; i < 4; i++) {
    const r = await call(routes, 'onboarding', ctx, { step: 'folder' });
    assert.equal(r.json.saved, false, 'folder ' + i);
  }
  assert.deepEqual(ctx.saved, []);
});

test('prompt input checks', () => {
  assert.equal(parseCalendarInput(' webcals://cal.example.com/x '), 'https://cal.example.com/x');
  assert.equal(parseCalendarInput('https://calendar.google.com/calendar/ical/a/basic.ics'), 'https://calendar.google.com/calendar/ical/a/basic.ics');
  for (const bad of ['', 'http://a.example.com/x', 'ftp://a.example.com', 'file:///etc/passwd', 'data:text/calendar,x', 'cal.example.com/x']) {
    assert.throws(() => parseCalendarInput(bad), Error, bad);
  }
  assert.equal(parseFolderInput('/Life//Journal/'), 'Life/Journal');
  assert.equal(parseFolderInput(''), '');
  for (const bad of ['..', 'a/../b', '.obsidian', 'a/.git', 'x*y', 'a|b', 'a/ /b']) assert.throws(() => parseFolderInput(bad), Error, bad);
});

test('only one native prompt at a time', async () => {
  let release;
  const prompts = { calendar: () => new Promise((res) => { release = res; }) };
  const ctx = Object.assign(ctxFor(fakeApp(makeVault({})), { now: NOW }), { prompts });
  const first = call(routes, 'onboarding', ctx, { step: 'calendar' });
  await new Promise((r) => setTimeout(r, 5));
  const second = await call(routes, 'onboarding', ctx, { step: 'calendar' });
  assert.equal(second.status, 409);
  release(null);
  assert.equal((await first).json.saved, false);
});

test('city values are validated', async () => {
  const ctx = ctxFor(fakeApp(makeVault({})), { now: NOW });
  const cities = [
    'Lisbon',
    { name: '', lat: 1, lon: 1 },
    { name: 'x'.repeat(81), lat: 1, lon: 1 },
    { name: 'A', lat: 91, lon: 0 },
    { name: 'A', lat: 0, lon: -181 },
    { name: 'A', lat: '38', lon: '9' },
    [1, 2],
  ];
  for (const c of cities) {
    const r = await call(routes, 'onboarding', ctx, { step: 'city', city: c });
    assert.equal(r.status, 400, JSON.stringify(c));
  }
  assert.deepEqual(ctx.saved, []);
});

test('through the shell router: (req, ctx) call, notify after writes, no 501', async () => {
  const root = makeVault({});
  const app = fakeApp(root);
  let settings = { onboarded: false, dailyMode: 'auto', dailyFolder: '', dailyFormat: 'YYYY-MM-DD', city: null, calendarUrl: '' };
  const notified = [];
  const router = createRouter({
    ctx: {
      app,
      getSettings: () => settings,
      saveSettings: (patch) => { settings = Object.assign({}, settings, patch); return settings; },
      notify: (k) => notified.push(k),
    },
    log: { error() {} },
  });
  for (const route of ['focus', 'tasks', 'notes', 'quotes', 'onboarding']) {
    const r = await router.handle({ route, method: 'GET', query: {} });
    assert.equal(r.status, 200, route + ': ' + JSON.stringify(r.json));
  }
  let r = await router.handle({ route: 'focus', method: 'POST', body: { focus: 'From the router' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.focus, 'From the router');
  assert.deepEqual(notified, ['focus']);
  r = await router.handle({ route: 'tasks', method: 'POST', body: JSON.stringify({ op: 'toggle', id: '1:0:Nope.md' }) });
  assert.equal(r.status, 412);
  r = await router.handle({ route: 'onboarding', method: 'POST', body: { step: 'done' } });
  assert.equal(r.json.done, true);
  assert.equal(settings.onboarded, true);
});

test('setup watches the vault and notifies the room, debounced', async () => {
  const root = makeVault({ 'Daily/2026-11-09.md': '- [ ] a\n', 'P.md': '- [ ] b 📅 2026-11-09\n', 'Plain.md': 'text\n' });
  const app = fakeApp(root);
  const notified = [];
  const host = { app, getSettings: () => ({ dailyMode: 'auto' }), notify: (k) => notified.push(k), now: NOW };
  const dispose = setup(host);
  const file = (p) => app.vault.getAbstractFileByPath(p);
  await app.vault.modify(file('Plain.md'), 'still plain\n');
  await app.vault.modify(file('P.md'), '- [ ] b 📅 2026-11-09\n- [ ] c\n');
  await app.vault.modify(file('Daily/2026-11-09.md'), '- [ ] a\n- [ ] d\n');
  assert.deepEqual(notified, [], 'nothing before the debounce');
  await new Promise((res) => setTimeout(res, 1700));
  assert.deepEqual(notified.sort(), ['focus', 'tasks']);
  dispose();
});
