'use strict';
// The native prompts (src/vault/prompts.js) against a tiny fake of Obsidian's Modal classes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeVault, fakeApp } = require('./vault-fake');
const { makePrompts } = require('../../src/vault/prompts');

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.text = ''; this.attrs = {}; this.listeners = {}; this.style = {}; this.value = ''; this.cls = ''; }
  createEl(tag, o) {
    const e = new El(tag);
    o = o || {};
    if (o.text) e.text = o.text;
    if (o.cls) e.cls = o.cls;
    if (o.type) e.attrs.type = o.type;
    Object.assign(e.attrs, o.attr || {});
    this.children.push(e);
    return e;
  }
  createDiv(o) { return this.createEl('div', o); }
  setText(t) { this.text = t; }
  setAttr(k, v) { this.attrs[k] = v; }
  appendText(t) { const e = new El('#text'); e.text = t; this.children.push(e); }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  fire(ev, extra) { (this.listeners[ev] || []).forEach((f) => f(Object.assign({ preventDefault() {} }, extra))); }
  empty() { this.children = []; }
  focus() {}
  all() { return this.children.reduce((a, c) => a.concat([c], c.all ? c.all() : []), []); }
  find(pred) { return this.all().find(pred); }
  allText() { return this.all().map((e) => e.text).join(' '); }
}

let last = null;
class Modal {
  constructor(app) { this.app = app; this.contentEl = new El('div'); this.titleEl = new El('h2'); this.isOpen = false; last = this; }
  setTitle(t) { this.titleEl.text = t; }
  open() { this.isOpen = true; this.onOpen(); }
  close() { if (!this.isOpen) return; this.isOpen = false; this.onClose(); }
  onOpen() {}
  onClose() {}
}
class FuzzySuggestModal extends Modal {
  constructor(app) { super(app); this.inputEl = new El('input'); }
  setPlaceholder(p) { this.placeholder = p; }
  setInstructions(i) { this.instructions = i; }
  onOpen() {}
  // Obsidian closes first, then calls onChooseItem.
  choose(item) { this.close(); this.onChooseItem(item); }
}
const obsidian = { Modal, FuzzySuggestModal };

test('calendar prompt: Enter with a bad link shows an error and stays open; a good one resolves', async () => {
  const prompts = makePrompts({ obsidian, app: fakeApp(makeVault({})) });
  const p = prompts.calendar();
  const m = last;
  assert.equal(m.titleEl.text, 'Your calendar link');
  const text = m.contentEl.allText();
  assert.ok(text.includes('Google Calendar') && text.includes('Outlook') && text.includes('iCloud'), 'how-to lines');
  const input = m.contentEl.find((e) => e.tag === 'input');
  const err = m.contentEl.find((e) => e.cls === 'mod-warning');
  input.value = 'http://cal.example.com/x.ics';
  input.fire('keydown', { key: 'Enter' });
  assert.equal(m.isOpen, true);
  assert.match(err.text, /https:\/\/ or webcal:\/\//);
  input.value = 'webcal://cal.example.com/x.ics';
  input.fire('keydown', { key: 'Enter' });
  assert.equal(m.isOpen, false);
  assert.equal(await p, 'https://cal.example.com/x.ics');
});

test('calendar prompt: Cancel and Esc resolve null', async () => {
  const prompts = makePrompts({ obsidian, app: fakeApp(makeVault({})) });
  let p = prompts.calendar();
  last.contentEl.find((e) => e.tag === 'button' && e.text === 'Cancel').fire('click');
  assert.equal(await p, null);
  p = prompts.calendar();
  last.close(); // Esc
  assert.equal(await p, null);
});

test('folder prompt: lists existing folders and offers a new one; Esc resolves null', async () => {
  const root = makeVault({ 'Journal/a.md': 'x', 'Work/Notes/b.md': 'y', '.obsidian/app.json': {} });
  const prompts = makePrompts({ obsidian, app: fakeApp(root) });
  let p = prompts.folder();
  let m = last;
  assert.deepEqual(m.getItems().map((i) => m.getItemText(i)), ['/ (vault root)', 'Journal/', 'Work/', 'Work/Notes/']);
  m.inputEl.value = 'Life/Days';
  const items = m.getItems();
  assert.deepEqual(items[0], { path: 'Life/Days', label: 'New folder: Life/Days/', create: true });
  m.inputEl.value = '../etc';
  assert.equal(m.getItems()[0].path, '', 'no "new folder" row for a bad name');
  m.choose(items[0]);
  assert.deepEqual(await p, { path: 'Life/Days', create: true });

  p = prompts.folder();
  m = last;
  m.close();
  assert.equal(await p, null);
});

test('no Obsidian Modal available: no prompts', () => {
  assert.equal(makePrompts({ app: fakeApp(makeVault({})) }), null);
});
