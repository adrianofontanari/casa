'use strict';
// A fake Obsidian `app` over a real temp folder, for the vault route tests.
// Mimics the parts Casa uses: vault (files, folders, read/modify/create/process), adapter
// (config files), metadataCache (listItems with task status) and vault events.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeMoment } = require('../../src/vault/when');

function makeVault(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'casa-vault-'));
  for (const [p, content] of Object.entries(files || {})) {
    const abs = path.join(root, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

function fakeApp(root, opts) {
  const o = opts || {};
  const configDir = '.obsidian';
  let tick = Date.now();
  const stats = { reads: 0, writes: 0, creates: 0 };
  const handlers = {};
  const abs = (p) => path.join(root, p);
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

  function bump(p) {
    tick += 1000;
    const t = new Date(tick);
    fs.utimesSync(abs(p), t, t);
  }

  function fileObj(p) {
    const st = fs.statSync(abs(p));
    const name = path.posix.basename(p);
    const dot = name.lastIndexOf('.');
    return {
      path: p, name,
      basename: dot > 0 ? name.slice(0, dot) : name,
      extension: dot > 0 ? name.slice(dot + 1) : '',
      stat: { mtime: Math.round(st.mtimeMs), ctime: Math.round(st.ctimeMs), size: st.size },
      parent: { path: path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p) },
    };
  }

  function folderObj(p) {
    return {
      path: p,
      name: path.posix.basename(p),
      get children() {
        return fs.readdirSync(abs(p)).map((n) => vault.getAbstractFileByPath(p ? p + '/' + n : n)).filter(Boolean);
      },
    };
  }

  function walk(dir, out) {
    for (const n of fs.readdirSync(abs(dir))) {
      const p = dir ? dir + '/' + n : n;
      if (n.startsWith('.')) continue;
      const st = fs.statSync(abs(p));
      if (st.isDirectory()) { out.push(folderObj(p)); walk(p, out); } else out.push(fileObj(p));
    }
    return out;
  }

  function emit(ev, file, oldPath) {
    (handlers[ev] || []).forEach((fn) => fn(file, oldPath));
  }

  const adapter = {
    exists: async (p) => fs.existsSync(abs(norm(p))),
    read: async (p) => fs.readFileSync(abs(norm(p)), 'utf8'),
    write: async (p, d) => { fs.writeFileSync(abs(norm(p)), d); },
  };

  const vault = {
    configDir,
    adapter,
    getAbstractFileByPath(p) {
      p = norm(p);
      if (!p) return folderObj('');
      if (!fs.existsSync(abs(p))) return null;
      return fs.statSync(abs(p)).isDirectory() ? folderObj(p) : fileObj(p);
    },
    getMarkdownFiles() {
      return walk('', []).filter((f) => f.extension === 'md');
    },
    getAllLoadedFiles() {
      return [folderObj('')].concat(walk('', []));
    },
    async read(file) { stats.reads++; return fs.readFileSync(abs(file.path), 'utf8'); },
    async cachedRead(file) { stats.reads++; return fs.readFileSync(abs(file.path), 'utf8'); },
    async modify(file, data) {
      fs.writeFileSync(abs(file.path), data); bump(file.path); stats.writes++;
      emit('modify', fileObj(file.path));
    },
    async process(file, fn) {
      const text = fs.readFileSync(abs(file.path), 'utf8');
      const next = fn(text);
      fs.writeFileSync(abs(file.path), next); bump(file.path); stats.writes++;
      emit('modify', fileObj(file.path));
      return next;
    },
    async create(p, data) {
      p = norm(p);
      if (fs.existsSync(abs(p))) throw new Error('File already exists.');
      if (!fs.existsSync(path.dirname(abs(p)))) throw new Error('Parent folder does not exist: ' + p);
      fs.writeFileSync(abs(p), data); bump(p); stats.creates++;
      const f = fileObj(p);
      emit('create', f);
      return f;
    },
    async createFolder(p) {
      p = norm(p);
      if (fs.existsSync(abs(p))) throw new Error('Folder already exists.');
      fs.mkdirSync(abs(p)); // not recursive, like a strict host
      return folderObj(p);
    },
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return { ev, fn }; },
    offref(ref) { handlers[ref.ev] = (handlers[ref.ev] || []).filter((f) => f !== ref.fn); },
  };

  const metadataCache = {
    getFileCache(file) {
      if (o.noCache) return null;
      const text = fs.readFileSync(abs(file.path), 'utf8');
      const listItems = [];
      text.split(/\r?\n/).forEach((l, i) => {
        const m = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+(?:\[(.)\])?/.exec(l);
        if (m) listItems.push({ position: { start: { line: i } }, task: m[1] });
      });
      return { listItems };
    },
  };

  const app = { vault, metadataCache, stats };
  if (o.plugins) app.plugins = { plugins: o.plugins };
  return app;
}

// Hand edit: what the user does in Obsidian (writes the file, new mtime).
function handWrite(root, p, text) {
  const abs = path.join(root, p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  const t = new Date(Date.now() + 5e6 + Math.floor(Math.random() * 1e6));
  fs.utimesSync(abs, t, t);
}

function readFile(root, p) {
  return fs.readFileSync(path.join(root, p), 'utf8');
}

function exists(root, p) {
  return fs.existsSync(path.join(root, p));
}

function listAll(root) {
  const out = [];
  (function walk(dir) {
    for (const n of fs.readdirSync(path.join(root, dir))) {
      const p = dir ? dir + '/' + n : n;
      if (fs.statSync(path.join(root, p)).isDirectory()) walk(p); else out.push(p);
    }
  })('');
  return out.sort();
}

// A ctx in the single-object form; `call(route, body)` runs a route through index.js.
function ctxFor(app, opts) {
  const o = opts || {};
  const now = o.now || new Date(2026, 10, 9, 9, 30);
  const settings = Object.assign({ onboarded: false, dailyMode: 'auto', dailyFolder: '', dailyFormat: 'YYYY-MM-DD', city: null, calendarUrl: '' }, o.settings || {});
  const saved = [];
  return {
    app, now, settings, saved,
    moment: makeMoment(now),
    saveSettings: async (patch) => { saved.push(patch); Object.assign(settings, patch); return settings; },
  };
}

async function call(routes, route, ctx, body) {
  const c = Object.assign({}, ctx, { query: {}, body: body || null, method: body ? 'POST' : 'GET' });
  return routes[route](c);
}

module.exports = { makeVault, fakeApp, handWrite, readFile, exists, listAll, ctxFor, call };
