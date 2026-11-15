'use strict';
// Thin helpers over Obsidian's vault API. Kept free of require('obsidian') so node tests can
// drive them with a fake app.

function norm(p) {
  return String(p == null ? '' : p)
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function join(folder, rest) {
  const f = norm(folder);
  const r = norm(rest);
  return f ? (r ? f + '/' + r : f) : r;
}

function parentOf(path) {
  const p = norm(path);
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function baseName(path) {
  const p = norm(path);
  return p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '');
}

function isFileObj(f) {
  return !!f && !Array.isArray(f.children) && typeof f.extension === 'string';
}

function getFile(app, path) {
  const f = app.vault.getAbstractFileByPath(norm(path));
  return isFileObj(f) ? f : null;
}

function folderExists(app, path) {
  const p = norm(path);
  if (!p) return true;
  const f = app.vault.getAbstractFileByPath(p);
  return !!f && Array.isArray(f.children);
}

function mtime(file) {
  return (file && file.stat && file.stat.mtime) || 0;
}

async function read(app, file) {
  return app.vault.read(file);
}

async function cachedRead(app, file) {
  return typeof app.vault.cachedRead === 'function' ? app.vault.cachedRead(file) : app.vault.read(file);
}

async function ensureFolder(app, folder) {
  const parts = norm(folder).split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur = cur ? cur + '/' + part : part;
    if (folderExists(app, cur)) continue;
    try {
      await app.vault.createFolder(cur);
    } catch (e) {
      if (!folderExists(app, cur)) throw e;
    }
  }
}

async function createNote(app, path, text) {
  const p = norm(path);
  await ensureFolder(app, parentOf(p));
  return app.vault.create(p, text);
}

// Read-modify-write. fn(text) returns the new text, or the same text for "no change".
async function processFile(app, file, fn) {
  if (typeof app.vault.process === 'function') {
    let changed = false;
    const out = await app.vault.process(file, (text) => {
      const next = fn(text);
      changed = next !== text;
      return next;
    });
    return { text: out, changed };
  }
  const text = await app.vault.read(file);
  const next = fn(text);
  if (next !== text) await app.vault.modify(file, next);
  return { text: next, changed: next !== text };
}

async function readConfigJson(app, rel) {
  const dir = norm((app.vault && app.vault.configDir) || '.obsidian');
  const p = dir + '/' + norm(rel);
  const adapter = app.vault && app.vault.adapter;
  if (!adapter) return null;
  try {
    if (typeof adapter.exists === 'function' && !(await adapter.exists(p))) return null;
    const text = await adapter.read(p);
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function splitLines(text) {
  const s = String(text == null ? '' : text);
  const eol = s.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  return { lines: s.split(/\r?\n/), eol };
}

// FNV-1a, 32 bit, base36. Used for task ids and revs; not for security.
function hash(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  norm, join, parentOf, baseName, getFile, folderExists, mtime, read, cachedRead,
  ensureFolder, createNote, processFile, readConfigJson, splitLines, hash, HttpError,
};
