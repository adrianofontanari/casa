'use strict';
// Native Obsidian prompts for the two values the room must never send: the calendar link and
// the daily-notes folder. They open on top of the room, outside its iframe; the user types into
// Obsidian's own UI and the plugin validates and saves. Enter confirms, Esc cancels.
//
// makePrompts(host) -> { calendar(): Promise<string|null>, folder(): Promise<{path, create}|null> }
// Tests pass their own `prompts` object instead.

const io = require('./io');

const HOWTO = [
  ['Google Calendar', 'Settings, your calendar, Integrate calendar: "Secret address in iCal format".'],
  ['Outlook', 'Settings, Calendar, Shared calendars, Publish a calendar: the ICS link.'],
  ['iCloud', 'Calendar app, share the calendar, Public Calendar: Copy Link.'],
];

// Accepts https:// and webcal:// (stored as https://). Returns the URL or throws with a message.
function parseCalendarInput(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) throw new Error('Paste the link of your calendar first.');
  if (/^webcals?:\/\//i.test(s)) s = 'https://' + s.replace(/^webcals?:\/\//i, '');
  let u;
  try { u = new URL(s); } catch (e) { throw new Error('That does not look like a link. It should start with https:// or webcal://'); }
  if (u.protocol !== 'https:' || !u.hostname) throw new Error('Use a link that starts with https:// or webcal://');
  if (s.length > 2000) throw new Error('That link is too long.');
  return u.href;
}

const BAD_NAME = /[\\:*?"<>|#^[\]]/;

// Folder typed in the picker: vault-relative, no "..", no hidden segments, no forbidden characters.
function parseFolderInput(raw) {
  const p = io.norm(raw);
  const segs = p ? p.split('/') : [];
  if (segs.some((s) => !s.trim() || s === '.' || s === '..' || s.startsWith('.') || BAD_NAME.test(s))) {
    throw new Error('Folder names cannot start with a dot or contain \\ : * ? " < > | # ^ [ ]');
  }
  if (p.length > 300) throw new Error('That folder path is too long.');
  return p;
}

function vaultFolders(app) {
  const all = typeof app.vault.getAllLoadedFiles === 'function' ? app.vault.getAllLoadedFiles() : [];
  const out = [];
  for (const f of all) {
    if (!f || !Array.isArray(f.children)) continue;
    const p = io.norm(f.path);
    if (p.split('/').some((s) => s.startsWith('.'))) continue;
    out.push(p);
  }
  if (out.indexOf('') < 0) out.push('');
  return out.sort((a, b) => a.localeCompare(b));
}

function makePrompts(host) {
  const ob = host && host.obsidian;
  const app = host && host.app;
  if (!ob || !app || typeof ob.Modal !== 'function') return null;

  function calendar() {
    return new Promise((resolve) => {
      let result = null;
      const modal = new ob.Modal(app);
      modal.onOpen = function () {
        const el = this.contentEl;
        if (typeof this.setTitle === 'function') this.setTitle('Your calendar link');
        else this.titleEl.setText('Your calendar link');
        el.createEl('p', { text: 'Paste the private ICS link of your calendar. Casa keeps it in this vault\'s Casa settings and reads today\'s events from it.' });
        const input = el.createEl('input', { type: 'text', attr: { placeholder: 'https://... or webcal://...', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Calendar link' } });
        input.style.width = '100%';
        const err = el.createEl('p', { cls: 'mod-warning' });
        err.setAttr('role', 'alert');
        const how = el.createEl('ul', { cls: 'casa-howto' });
        for (const [name, text] of HOWTO) {
          const li = how.createEl('li');
          li.createEl('strong', { text: name + ': ' });
          li.appendText(text);
        }
        const row = el.createDiv({ cls: 'modal-button-container' });
        const cancel = row.createEl('button', { text: 'Cancel' });
        const save = row.createEl('button', { text: 'Save', cls: 'mod-cta' });
        const submit = () => {
          try {
            result = parseCalendarInput(input.value);
            this.close();
          } catch (e) {
            err.setText(e.message);
            input.focus();
          }
        };
        save.addEventListener('click', submit);
        cancel.addEventListener('click', () => this.close());
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
        });
        setTimeout(() => input.focus(), 0);
      };
      modal.onClose = function () {
        this.contentEl.empty();
        resolve(result);
      };
      modal.open();
    });
  }

  function folder() {
    return new Promise((resolve) => {
      if (typeof ob.FuzzySuggestModal !== 'function') { resolve(null); return; }
      let picked = null;
      const folders = vaultFolders(app);
      class FolderModal extends ob.FuzzySuggestModal {
        getItems() {
          const items = folders.map((p) => ({ path: p, label: p ? p + '/' : '/ (vault root)' }));
          const typed = this.inputEl ? this.inputEl.value.trim() : '';
          if (typed) {
            try {
              const p = parseFolderInput(typed);
              if (p && folders.indexOf(p) < 0) items.unshift({ path: p, label: 'New folder: ' + p + '/', create: true });
            } catch (e) { /* not a valid name: no "new folder" row */ }
          }
          return items;
        }
        getItemText(it) { return it.label; }
        onChooseItem(it) { picked = it; }
        onClose() {
          if (typeof super.onClose === 'function') super.onClose();
          // Obsidian closes the modal before it calls onChooseItem: resolve on the next tick.
          setTimeout(() => resolve(picked ? { path: picked.path, create: !!picked.create } : null), 0);
        }
      }
      const modal = new FolderModal(app);
      modal.setPlaceholder('Choose the folder for your daily notes, or type a new one');
      if (typeof modal.setInstructions === 'function') {
        modal.setInstructions([{ command: 'Enter', purpose: 'choose' }, { command: 'Esc', purpose: 'cancel' }]);
      }
      modal.open();
    });
  }

  return { calendar, folder };
}

module.exports = { makePrompts, parseCalendarInput, parseFolderInput, vaultFolders, HOWTO };
