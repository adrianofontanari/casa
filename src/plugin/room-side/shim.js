/* Casa room bridge. build.py inlines this file as the first script of the room document.

   The room runs in an iframe sandboxed with `allow-scripts` only, so it has an opaque origin
   and no direct access to Obsidian. This shim connects it to the plugin:

   - fetch('/api/<route>?query', {method, body}) is sent to the parent as
     {casa:1, id, route, method, query, body}. The plugin answers {casa:1, id, status, json}
     and fetch resolves with a real Response. Other URLs go to the browser fetch
     (the room CSP only allows data: and blob: there).
   - {casa:1, pause:true|false} dispatches `casa:pause` / `casa:resume` on document.
     While paused, document.visibilityState is "hidden" and a `visibilitychange` event fires,
     so loops written against the Page Visibility API stop as well.
   - {casa:1, event:'<name>', detail} is dispatched as a CustomEvent on document
     (the plugin uses it for `casa:data` after a write made outside the room).
   - localStorage / sessionStorage throw in an opaque origin. They are replaced by in-memory
     stores so room code does not crash. Use /api/state for anything that must survive a reload.
   - window.open and clicks on external links go to /api/link, which opens the system browser.
*/
(function () {
  'use strict';
  if (window.CasaBridge) return;

  var TIMEOUT_MS = 60000;
  var MAX_BODY = 2 * 1024 * 1024;
  var host = window.parent;
  var realFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  var seq = 0;
  var waiting = Object.create(null);
  var paused = false;

  function jsonResponse(status, json) {
    status = Number(status) | 0;
    if (status < 200 || status > 599) status = 500;
    var empty = status === 204 || status === 205 || status === 304;
    return new Response(empty ? null : JSON.stringify(json === undefined ? null : json), {
      status: status,
      headers: { 'content-type': 'application/json' },
    });
  }

  function apiTarget(input) {
    var raw = typeof input === 'string' ? input : (input && typeof input.url === 'string' ? input.url : String(input));
    var u, base, route;
    var relative = raw.indexOf('/api/') === 0;
    try {
      // the srcdoc base URL is the parent's; it may not be hierarchical, so a relative /api/ path gets a fixed base
      u = new URL(raw, relative ? 'http://casa.local/' : document.baseURI);
      base = relative ? u : new URL(document.baseURI);
    } catch (e) { return null; }
    var isApi = relative ||
      (u.pathname.indexOf('/api/') === 0 && u.protocol === base.protocol && u.host === base.host);
    if (!isApi) return null;
    try { route = decodeURIComponent(u.pathname.slice(5)); } catch (e) { route = u.pathname.slice(5); }
    var query = {};
    u.searchParams.forEach(function (v, k) { query[k] = v; });
    return { route: route.replace(/\/+$/, ''), query: query };
  }

  function readBody(body) {
    if (body == null) return null;
    if (typeof body === 'string') {
      if (body.length > MAX_BODY) throw new TypeError('Casa bridge: body too large');
      try { return JSON.parse(body); } catch (e) { return body; }
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      var o = {};
      body.forEach(function (v, k) { o[k] = v; });
      return o;
    }
    if (Object.prototype.toString.call(body) === '[object Object]' || Array.isArray(body)) return body;
    throw new TypeError('Casa bridge: only JSON or string bodies are supported');
  }

  window.fetch = function (input, init) {
    var target = apiTarget(input);
    if (!target) {
      if (realFetch) return realFetch(input, init);
      return Promise.reject(new TypeError('fetch is not available'));
    }
    init = init || {};
    var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    var body;
    try { body = method === 'GET' || method === 'HEAD' ? null : readBody(init.body); } catch (e) { return Promise.reject(e); }
    var signal = init.signal;
    if (signal && signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    var id = ++seq;
    return new Promise(function (resolve, reject) {
      var entry = { resolve: resolve, reject: reject };
      entry.timer = setTimeout(function () {
        delete waiting[id];
        resolve(jsonResponse(504, { error: 'The plugin did not answer /api/' + target.route }));
      }, TIMEOUT_MS);
      if (signal) {
        signal.addEventListener('abort', function () {
          if (!waiting[id]) return;
          clearTimeout(entry.timer);
          delete waiting[id];
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }
      waiting[id] = entry;
      host.postMessage({ casa: 1, id: id, route: target.route, method: method, query: target.query, body: body }, '*');
    });
  };

  // ---- pause / resume and page visibility
  function descriptor(obj, key) {
    for (var o = obj; o; o = Object.getPrototypeOf(o)) {
      var d = Object.getOwnPropertyDescriptor(o, key);
      if (d) return d;
    }
    return null;
  }
  var visDesc = descriptor(document, 'visibilityState');
  var hidDesc = descriptor(document, 'hidden');
  try {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: function () {
        if (paused) return 'hidden';
        return visDesc && visDesc.get ? visDesc.get.call(document) : 'visible';
      },
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: function () {
        if (paused) return true;
        return hidDesc && hidDesc.get ? hidDesc.get.call(document) : false;
      },
    });
  } catch (e) { /* the room still gets casa:pause / casa:resume */ }

  function setPaused(next) {
    next = !!next;
    if (next === paused) return;
    paused = next;
    document.dispatchEvent(new CustomEvent(paused ? 'casa:pause' : 'casa:resume'));
    document.dispatchEvent(new Event('visibilitychange'));
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== host) return;
    var d = ev.data;
    if (!d || d.casa !== 1) return;
    if (d.id != null && waiting[d.id]) {
      var entry = waiting[d.id];
      delete waiting[d.id];
      clearTimeout(entry.timer);
      entry.resolve(jsonResponse(d.status, d.json));
      return;
    }
    if (typeof d.pause === 'boolean') { setPaused(d.pause); return; }
    if (typeof d.event === 'string' && /^casa:/.test(d.event)) {
      document.dispatchEvent(new CustomEvent(d.event, { detail: d.detail }));
    }
  });

  // ---- storage in an opaque origin
  function memoryStorage() {
    var m = new Map();
    return {
      get length() { return m.size; },
      key: function (i) { var k = Array.from(m.keys())[i]; return k === undefined ? null : k; },
      getItem: function (k) { k = String(k); return m.has(k) ? m.get(k) : null; },
      setItem: function (k, v) { m.set(String(k), String(v)); },
      removeItem: function (k) { m.delete(String(k)); },
      clear: function () { m.clear(); },
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var works = false;
    try { var s = window[name]; s.getItem('casa'); works = true; } catch (e) { works = false; }
    if (!works) {
      try { Object.defineProperty(window, name, { configurable: true, value: memoryStorage() }); } catch (e) { /* ignore */ }
    }
  });

  // ---- external links open in the system browser
  function openExternal(url) {
    window.fetch('/api/link', { method: 'POST', body: JSON.stringify({ url: String(url) }) }).catch(function () {});
  }
  window.open = function (url) {
    if (url) openExternal(new URL(String(url), document.baseURI).href);
    return null;
  };
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href)) {
      ev.preventDefault();
      openExternal(href);
    }
  }, true);

  window.CasaBridge = {
    version: 1,
    isPaused: function () { return paused; },
  };
})();
