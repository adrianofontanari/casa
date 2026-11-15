/* Routes answered by the plugin shell: /api/state, /api/settings, /api/open, /api/link, /api/open-settings.
   The room is untrusted: /api/settings exposes the room view of the settings (URLs hidden) and
   accepts only the room-writable keys (store.ROOM_WRITABLE); the rest is reported in `ignored`.
   deps: { store, openNote(path, {line, newTab}) -> Promise<boolean>, openUrl(url), openSettings() -> boolean, notify(kind) } */
const { httpError } = require('./router.js');

function checkVaultPath(path) {
  if (typeof path !== 'string' || !path.trim()) throw httpError(400, 'Missing path');
  const p = path.trim().replace(/\\/g, '/');
  if (p.charAt(0) === '/' || /^[a-z]+:/i.test(p) || p.split('/').indexOf('..') !== -1) {
    throw httpError(400, 'The path must be inside the vault');
  }
  return p;
}

function checkExternalUrl(url) {
  if (typeof url !== 'string' || !url.trim()) throw httpError(400, 'Missing url');
  let u;
  try { u = new URL(url.trim()); } catch (e) { throw httpError(400, 'Not a link'); }
  if (u.protocol !== 'https:') throw httpError(400, 'Only https links can be opened');
  if (u.username || u.password) throw httpError(400, 'Links with credentials are not opened');
  return u.href;
}

function createShellRoutes(deps) {
  const store = deps.store;
  const notify = deps.notify || (() => {});
  return {
    state: {
      GET: () => store.getState(),
      POST: (req) => ({ ok: true, state: store.updateState(req.body || {}) }),
    },
    settings: {
      GET: () => store.getRoomSettings(),
      POST: (req) => {
        const out = store.updateRoomSettings(req.body || {});
        notify('settings');
        return Object.assign({}, out.settings, { ignored: out.ignored });
      },
    },
    'open-settings': {
      POST: async () => {
        const ok = deps.openSettings ? await deps.openSettings() : false;
        if (!ok) throw httpError(501, 'Settings cannot be opened from here');
        return { ok: true };
      },
    },
    open: {
      POST: async (req) => {
        const body = req.body || {};
        const path = checkVaultPath(body.path);
        const line = Number.isInteger(body.line) && body.line >= 0 ? body.line : undefined;
        const ok = await deps.openNote(path, { line: line, newTab: body.newTab === true });
        if (!ok) throw httpError(404, 'Note not found: ' + path);
        return { ok: true };
      },
    },
    link: {
      POST: async (req) => {
        const url = checkExternalUrl((req.body || {}).url);
        await deps.openUrl(url);
        return { ok: true };
      },
    },
  };
}

module.exports = { createShellRoutes, checkVaultPath, checkExternalUrl };
