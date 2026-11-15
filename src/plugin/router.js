/* Bridge router: turns a room request {route, method, query, body} into {status, json}.
   It never throws. A missing handler module answers 501, a handler that throws answers 500
   (or the error's own 4xx status), an unknown route answers 404. */
const ROUTE_TABLE = require('./routes.js');

const MAX_BODY_CHARS = 2 * 1024 * 1024;
const OWNERS = ['vault', 'integrations'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHOD_NOT_ALLOWED = {};

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function defaultLoad(spec) {
  return require(spec);
}

function isMissing(err, spec) {
  if (!err || err.code !== 'MODULE_NOT_FOUND') return false;
  return String(err.message || '').indexOf(spec) !== -1;
}

function normaliseRoute(route) {
  let r = String(route == null ? '' : route).trim();
  r = r.replace(/^\/+/, '').replace(/^api\//, '').replace(/\/+$/, '');
  return r;
}

function asHandler(h, method) {
  if (typeof h === 'function') return h;
  if (h && typeof h === 'object') {
    const f = h[method] || h[method.toLowerCase()] || h.handle;
    if (typeof f === 'function') return f.bind(h);
    const any = METHODS.some((m) => typeof h[m] === 'function' || typeof h[m.toLowerCase()] === 'function');
    if (any) return METHOD_NOT_ALLOWED;
  }
  return null;
}

function toReply(result) {
  if (result && typeof result === 'object' && !Array.isArray(result) && typeof result.status === 'number' &&
      'json' in result && Object.keys(result).every((k) => k === 'status' || k === 'json' || k === 'headers')) {
    return { status: result.status, json: result.json };
  }
  return { status: 200, json: result === undefined ? {} : result };
}

function createRouter(opts) {
  opts = opts || {};
  const table = opts.table || ROUTE_TABLE;
  const shell = opts.shell || {};
  const ctx = opts.ctx || {};
  const load = opts.load || defaultLoad;
  const log = opts.log || console;

  const loaded = new Map();      // spec -> { mod, ready } | { missing: true } | { error }
  const disposers = [];

  function loadModule(spec) {
    if (loaded.has(spec)) return loaded.get(spec);
    let rec;
    try {
      const mod = load(spec);
      rec = { mod: mod, ready: Promise.resolve() };
      if (mod && typeof mod.setup === 'function') {
        rec.ready = Promise.resolve()
          .then(() => mod.setup(ctx))
          .then((dispose) => { if (typeof dispose === 'function') disposers.push(dispose); })
          .catch((e) => { log.error('[casa] setup failed in ' + spec, e); });
      }
    } catch (e) {
      rec = isMissing(e, spec) ? { missing: true } : { error: e };
      if (rec.error) log.error('[casa] could not load ' + spec, e);
    }
    loaded.set(spec, rec);
    return rec;
  }

  // Look for a handler for `route` owned by `owner`: index.js `routes[route]` first, then the
  // route's own file (<file or route>.js): its `routes[route]`, or the module itself.
  function find(owner, route, method, file) {
    const own = (m) => (m && m.routes && m.routes[route] !== undefined ? m.routes[route] : m);
    const candidates = [
      { spec: '../' + owner + '/index.js', pick: (m) => (m && m.routes ? m.routes[route] : undefined) },
      { spec: '../' + owner + '/' + (file || route) + '.js', pick: own },
    ];
    let loadError = null;
    for (const c of candidates) {
      if (c.spec.indexOf('/index.js') === -1 && route.indexOf('/') !== -1) continue;
      const rec = loadModule(c.spec);
      if (rec.missing) continue;
      if (rec.error) { loadError = loadError || rec.error; continue; }
      const h = asHandler(c.pick(rec.mod), method);
      if (h) return { handler: h, ready: rec.ready };
    }
    return { handler: null, loadError: loadError };
  }

  async function run(handler, ready, req) {
    if (handler === METHOD_NOT_ALLOWED) return { status: 405, json: { error: req.method + ' is not supported on /api/' + req.route } };
    await ready;
    // first argument: the request merged over the context, so both `(req, ctx)` handlers and
    // `get(ctx)` handlers that read ctx.app / ctx.body / ctx.settings work
    const call = Object.assign({}, ctx, { settings: typeof ctx.getSettings === 'function' ? ctx.getSettings() : ctx.settings }, req);
    let reply;
    try {
      reply = toReply(await handler(call, ctx));
    } catch (e) {
      const status = e && Number.isInteger(e.status) && e.status >= 400 && e.status <= 599 ? e.status : 500;
      if (status >= 500) log.error('[casa] /api/' + req.route + ' failed', e);
      return { status: status, json: { error: String((e && e.message) || e || 'error') } };
    }
    try {
      // the answer crosses postMessage: keep it plain JSON
      reply.json = reply.json === undefined ? {} : JSON.parse(JSON.stringify(reply.json));
    } catch (e) {
      log.error('[casa] /api/' + req.route + ' returned data that is not JSON', e);
      return { status: 500, json: { error: 'Handler returned data that is not JSON' } };
    }
    return reply;
  }

  async function handle(msg) {
    try {
      msg = msg || {};
      const route = normaliseRoute(msg.route);
      const method = String(msg.method || 'GET').toUpperCase();
      const query = msg.query && typeof msg.query === 'object' ? msg.query : {};
      const body = msg.body === undefined ? null : msg.body;
      if (!/^[a-z0-9][a-z0-9_\-/]*$/i.test(route) || route.indexOf('..') !== -1) {
        return { status: 404, json: { error: 'Unknown route /api/' + route } };
      }
      if (body != null && typeof body !== 'string' && JSON.stringify(body).length > MAX_BODY_CHARS) {
        return { status: 413, json: { error: 'Body too large' } };
      }
      const req = { route: route, method: method, query: query, body: body };
      const entry = Object.prototype.hasOwnProperty.call(table, route) ? table[route] : null;

      if (entry && entry.owner === 'shell') {
        if (entry.methods && entry.methods.indexOf(method) === -1) {
          return { status: 405, json: { error: method + ' is not supported on /api/' + route } };
        }
        const h = asHandler(shell[route], method);
        if (!h) return { status: 501, json: { error: '/api/' + route + ' is not available' } };
        return await run(h, Promise.resolve(), req);
      }

      const owners = entry ? [entry.owner] : OWNERS;
      let loadError = null;
      for (const owner of owners) {
        const found = entry ? find(owner, route, method, entry.file) : findExtra(owner, route, method);
        if (found.handler) return await run(found.handler, found.ready, req);
        loadError = loadError || found.loadError;
      }
      if (loadError) return { status: 500, json: { error: 'The module for /api/' + route + ' failed to load: ' + loadError.message } };
      if (entry) return { status: 501, json: { error: '/api/' + route + ' is not available yet' } };
      return { status: 404, json: { error: 'Unknown route /api/' + route } };
    } catch (e) {
      log.error('[casa] router error', e);
      return { status: 500, json: { error: 'Router error' } };
    }
  }

  // Routes outside the table: only an owner's index.js `routes` can add them.
  function findExtra(owner, route, method) {
    const rec = loadModule('../' + owner + '/index.js');
    if (rec.missing || rec.error) return { handler: null, loadError: rec.error || null };
    const h = asHandler(rec.mod && rec.mod.routes ? rec.mod.routes[route] : undefined, method);
    return h ? { handler: h, ready: rec.ready } : { handler: null };
  }

  // Load the owners' index.js early so their setup(ctx) can watch the vault before the room asks.
  function preload() {
    const waits = [];
    for (const owner of OWNERS) {
      const rec = loadModule('../' + owner + '/index.js');
      if (rec.ready) waits.push(rec.ready);
    }
    return Promise.all(waits);
  }

  function dispose() {
    while (disposers.length) {
      const d = disposers.pop();
      try { d(); } catch (e) { log.error('[casa] dispose failed', e); }
    }
  }

  return { handle: handle, preload: preload, dispose: dispose, table: table };
}

module.exports = { createRouter, httpError, normaliseRoute, toReply };
