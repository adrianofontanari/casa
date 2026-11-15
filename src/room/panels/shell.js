/* Casa room panels: the shared panel shell.

   Objects in the room fire `casa:open` {id}. This file opens the matching panel
   as an accessible dialog over the room: pixel frame, paper background, a close
   button, Esc closes, Tab stays inside, and focus goes back where it was.

   A panel registers itself:
     CasaPanels.register(id, { title, size: 's'|'m'|'l'|'xl', tall, render(ctx) })
   render(ctx) may be async. ctx gives:
     ctx.body, ctx.tools (header slot), ctx.panel, ctx.id, ctx.detail
     ctx.api(route, {method, body, query}) -> {ok, status, json, kind}
     ctx.loop(name, ms, fn) -> repeating job, stopped on close and on casa:pause
     ctx.onData(kinds, fn)  -> casa:data listener, removed on close
     ctx.onClose(fn), ctx.close(), ctx.alive()
     ctx.emit(kind, extra)  -> casa:data {kind, source:'panel:<id>'}
     ctx.setTitle(text)

   Events fired by the shell: `casa:panel` {id, open:true|false} on open and close.
   No timers run while no panel is open. */
(function () {
  'use strict';
  if (window.CasaPanels) return;
  const doc = document;
  const defs = Object.create(null);
  let cur = null;
  let paused = false;
  const handled = new WeakSet();

  // ------------------------------------------------------------ styles

  let styleEl = null;
  function css(text) {
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'casa-panels-css';
      (doc.head || doc.documentElement).appendChild(styleEl);
    }
    styleEl.appendChild(doc.createTextNode(text));
  }

  /* Widget design language (documented in docs/dev/theme.md, "Panels"): a paper card
     in a navy pixel frame with a hard shadow, a teal title bar, square buttons with a
     2px navy edge, oat rules between rows, teal for "done" and links, mustard and
     yellow for what is selected, vermilion only for "now" and errors. */
  css(`
.cp-overlay{--cp-paper:#fffdf8;--cp-ink:#18171c;--cp-navy:#24335e;--cp-navyL:#3a5088;--cp-teal:#2e6e66;--cp-tealL:#2c8c88;
  --cp-mint:#7ec2b0;--cp-mustard:#c89a48;--cp-mustardL:#f0d89a;--cp-yellow:#f6c93e;--cp-oat:#e6dac2;--cp-oatL:#f4eedf;
  --cp-honey:#cca270;--cp-verm:#d2473a;
  --cp-muted:#5d6170;--cp-faint:#8b8893;--cp-line:#e6dac2;--cp-wash:#f4eedf;--cp-accent:#c23e31;--cp-blue:#23716a;
  --cp-ok:#2e6e66;--cp-warn:#c89a48;
  --cp-sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --cp-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --cp-serif:ui-serif,"New York",Charter,Georgia,"Times New Roman",serif;
  position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
  padding:22px 18px;background:rgba(20,26,44,.55);box-sizing:border-box;
  font:14px/1.45 var(--cp-sans);color:var(--cp-ink);-webkit-font-smoothing:antialiased}
.cp-overlay *,.cp-overlay *::before,.cp-overlay *::after{box-sizing:border-box}
.cp-panel{position:relative;display:flex;flex-direction:column;width:var(--cp-w,640px);max-width:100%;
  max-height:100%;background:var(--cp-paper);color:var(--cp-ink);outline:none;
  box-shadow:-4px 0 0 0 var(--cp-navy),4px 0 0 0 var(--cp-navy),0 -4px 0 0 var(--cp-navy),0 4px 0 0 var(--cp-navy),
    8px 8px 0 0 rgba(20,26,44,.45),4px 12px 0 0 rgba(20,26,44,.45),12px 4px 0 0 rgba(20,26,44,.45)}
.cp-size-s{--cp-w:440px}.cp-size-m{--cp-w:660px}.cp-size-l{--cp-w:1000px}.cp-size-xl{--cp-w:1180px}
.cp-tall{height:100%}
.cp-head{display:flex;align-items:center;gap:10px;min-height:46px;padding:7px 8px 7px 14px;background:var(--cp-teal);color:var(--cp-paper);
  border-bottom:4px solid var(--cp-navy);flex:none}
.cp-head::before{content:"";flex:none;width:10px;height:10px;background:var(--cp-yellow);box-shadow:2px 2px 0 var(--cp-navy)}
.cp-title{margin:0;flex:1;min-width:0;font:650 15px/1.2 var(--cp-sans);letter-spacing:.01em;color:var(--cp-paper);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp-tools{display:flex;align-items:center;gap:6px}
.cp-head .cp-link{color:var(--cp-paper);text-decoration-color:rgba(255,253,248,.6)}
.cp-head .cp-link:hover{color:var(--cp-yellow)}
.cp-close,.cp-icon{flex:none;width:32px;height:32px;display:inline-grid;place-items:center;padding:0;margin:0;
  font:700 18px/1 var(--cp-mono);cursor:pointer}
.cp-close{color:var(--cp-navy);background:var(--cp-yellow);border:2px solid var(--cp-navy);box-shadow:2px 2px 0 var(--cp-navy)}
.cp-close:hover{background:var(--cp-mustardL)}
.cp-close:active{transform:translate(1px,1px);box-shadow:1px 1px 0 var(--cp-navy)}
.cp-icon{color:var(--cp-paper);background:transparent;border:2px solid rgba(255,253,248,.45)}
.cp-icon:hover{border-color:var(--cp-paper);background:rgba(255,253,248,.12)}
.cp-body{flex:1;min-height:0;overflow:auto;padding:16px 18px 18px;overscroll-behavior:contain}
.cp-overlay :focus-visible{outline:3px solid var(--cp-tealL);outline-offset:2px}
.cp-head :focus-visible{outline-color:var(--cp-yellow)}
.cp-overlay .cp-panel:focus-visible{outline:none}
.cp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:5px 14px;
  font:600 13px/1.2 var(--cp-sans);color:var(--cp-navy);background:var(--cp-paper);
  border:2px solid var(--cp-navy);box-shadow:3px 3px 0 var(--cp-navy);cursor:pointer;white-space:nowrap}
.cp-btn:hover{background:var(--cp-oatL)}
.cp-btn:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--cp-navy)}
.cp-btn[disabled]{opacity:.45;cursor:default;transform:none;box-shadow:3px 3px 0 var(--cp-navy)}
.cp-btn.cp-primary{background:var(--cp-navy);color:var(--cp-paper)}
.cp-btn.cp-primary:hover{background:var(--cp-navyL)}
.cp-btn[aria-pressed="true"]{background:var(--cp-yellow);color:var(--cp-navy)}
.cp-link{display:inline;padding:0;margin:0;border:0;background:none;color:var(--cp-blue);font:inherit;
  text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px;cursor:pointer}
.cp-link:hover{color:var(--cp-navy)}
.cp-input{width:100%;min-height:38px;padding:7px 10px;font:inherit;color:var(--cp-ink);background:#fff;
  border:2px solid var(--cp-navy);border-radius:0;outline:none}
.cp-input:focus{box-shadow:0 0 0 3px var(--cp-mustardL)}
.cp-label{display:flex;align-items:center;gap:8px;margin:0 0 8px;font:700 12px/1.2 var(--cp-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--cp-teal)}
.cp-label::after{content:"";flex:1;border-top:2px dotted var(--cp-mint)}
.cp-muted{color:var(--cp-muted)}
.cp-small{font-size:12px}
.cp-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.cp-check{appearance:none;-webkit-appearance:none;flex:none;width:20px;height:20px;margin:0;border:2px solid var(--cp-navy);
  background:#fff;display:inline-grid;place-items:center;cursor:pointer;box-shadow:2px 2px 0 var(--cp-oat)}
.cp-check:checked{background:var(--cp-teal);border-color:var(--cp-teal)}
.cp-check:checked::after{content:"";width:9px;height:5px;border:solid #fff;border-width:0 0 3px 3px;transform:translateY(-1px) rotate(-45deg)}
.cp-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:170px;
  padding:26px 12px;text-align:center}
.cp-state::before{content:"";width:14px;height:14px;margin-bottom:4px;background:var(--cp-mint);box-shadow:16px 0 0 var(--cp-mustardL),-16px 0 0 var(--cp-oat)}
.cp-state-error::before{background:var(--cp-verm)}
.cp-state h3{margin:0;font:650 16px/1.3 var(--cp-sans);color:var(--cp-navy)}
.cp-state p{margin:0;max-width:46ch;color:var(--cp-muted)}
.cp-state .cp-row{justify-content:center;margin-top:8px}
.cp-state-loading p::after{content:"";display:inline-block;width:1.2em;text-align:left;animation:cp-dots 1.2s steps(4) infinite}
@keyframes cp-dots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}
.cp-notice{margin:0 0 12px;padding:8px 12px;border-left:4px solid var(--cp-mustard);background:var(--cp-oatL);font-size:13px}
.cp-notice[hidden]{display:none}
.cp-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.cp-paused *,.cp-paused *::before,.cp-paused *::after{animation-play-state:paused!important}
@media (prefers-reduced-motion:reduce){.cp-overlay *,.cp-overlay *::before,.cp-overlay *::after{animation:none!important;transition:none!important}}
@media (max-width:760px){.cp-overlay{padding:12px 12px 16px 10px}.cp-body{padding:14px 14px 16px}}
`);

  // ------------------------------------------------------------ DOM helper

  function el(tag, props) {
    const n = doc.createElementNS && /^(svg|path|rect|circle|line|polyline|polygon|g|text|defs|linearGradient|stop)$/.test(tag)
      ? doc.createElementNS('http://www.w3.org/2000/svg', tag) : doc.createElement(tag);
    const svg = n.namespaceURI === 'http://www.w3.org/2000/svg';
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.setAttribute('class', v);
        else if (k === 'text') n.textContent = v;
        else if (k === 'value' && !svg) n.value = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (!svg && typeof v !== 'string' && k in n) n[k] = v;
        else n.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) add(n, arguments[i]);
    return n;
  }
  function add(n, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach((x) => add(n, x)); return; }
    n.appendChild(typeof c === 'object' ? c : doc.createTextNode(String(c)));
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  // ------------------------------------------------------------ bridge

  function kindOf(status) {
    if (status >= 200 && status < 300) return 'ok';
    if (status === 0) return 'offline';
    if (status === 412) return 'stale';
    if (status === 404 || status === 501) return 'notReady';
    if (status === 504) return 'offline';
    if (status >= 500) return 'broken';
    return 'bad';
  }

  async function api(route, opts) {
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    let url = '/api/' + route;
    if (opts.query) {
      const q = new URLSearchParams();
      Object.keys(opts.query).forEach((k) => { if (opts.query[k] != null) q.set(k, opts.query[k]); });
      const s = q.toString();
      if (s) url += '?' + s;
    }
    const init = { method };
    if (method !== 'GET') {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(opts.body || {});
    }
    let r;
    try { r = await fetch(url, init); } catch (e) { return { ok: false, status: 0, json: {}, kind: 'offline' }; }
    let json = null;
    try { json = await r.json(); } catch (e) { json = null; }
    const status = r.status | 0;
    return { ok: status >= 200 && status < 300, status, json: json && typeof json === 'object' ? json : {}, kind: kindOf(status) };
  }

  const ERR = {
    offline: ['Casa can\'t reach Obsidian', 'The room lost its link to the plugin for a moment.'],
    notReady: ['Not in this version yet', 'This part of Casa isn\'t available yet.'],
    broken: ['Something went wrong', 'Casa couldn\'t read this just now.'],
    bad: ['That didn\'t work', 'Casa couldn\'t do that.'],
    stale: ['Your note changed', 'The note changed in Obsidian, so Casa reloaded it.'],
  };

  /* One line for a failed request, for notices inside a panel that already shows data. */
  function errorLine(res, doing) {
    const k = res.kind in ERR ? res.kind : 'broken';
    let s = (doing ? doing + ': ' : '') + ERR[k][1];
    if (k === 'bad' && res.json && typeof res.json.error === 'string') s = (doing ? doing + ': ' : '') + res.json.error;
    return s;
  }

  /* A centred empty, error or loading state. o: {title, text, kind, retry, action:{label, run}, extra} */
  function state(target, o) {
    clear(target);
    const box = el('div', { class: 'cp-state' + (o.kind ? ' cp-state-' + o.kind : ''), role: o.kind === 'error' ? 'alert' : null });
    if (o.title) box.appendChild(el('h3', { text: o.title }));
    if (o.text) box.appendChild(el('p', { text: o.text }));
    if (o.extra) add(box, o.extra);
    const row = el('div', { class: 'cp-row' });
    if (o.action) row.appendChild(el('button', { class: 'cp-btn cp-primary', type: 'button', onclick: o.action.run }, o.action.label));
    if (o.retry) row.appendChild(el('button', { class: 'cp-btn', type: 'button', onclick: o.retry }, 'Try again'));
    if (row.firstChild) box.appendChild(row);
    target.appendChild(box);
    return box;
  }

  /* The error state for a failed request. */
  function fail(target, res, retry, what) {
    const k = res.kind in ERR ? res.kind : 'broken';
    const t = ERR[k];
    let text = t[1];
    if (k === 'offline' && navigator.onLine === false) text = 'You seem to be offline. Try again when you are back online.';
    if (what) text = what + ' ' + text.charAt(0).toLowerCase() + text.slice(1);
    return state(target, { kind: 'error', title: t[0], text, retry: k === 'notReady' ? null : retry });
  }

  function loading(target, text) {
    return state(target, { kind: 'loading', text: text || 'Loading' });
  }

  function emit(kind, extra, source) {
    doc.dispatchEvent(new CustomEvent('casa:data', { detail: Object.assign({ kind, source: source || 'panels' }, extra || {}) }));
  }

  // ------------------------------------------------------------ loops

  /* Repeating jobs go through the room's Pace helper when it is loaded (it owns
     pause, page visibility and the user's slow-down overrides). Without it, a
     small local timer that obeys casa:pause and visibility. */
  const localLoops = new Set();
  function startLoop(id, ms, fn) {
    if (typeof Pace !== 'undefined' && Pace && typeof Pace.every === 'function') {
      const h = Pace.every(id, ms, fn);
      return { stop: () => h.stop(), poke: () => h.poke(), set: (v) => h.set(v) };
    }
    const L = { id, ms, fn, timer: null, alive: true };
    const arm = () => { clearTimeout(L.timer); L.timer = null; if (L.alive && !paused && !doc.hidden) L.timer = setTimeout(run, L.ms); };
    const run = () => { L.timer = null; if (!L.alive || paused || doc.hidden) return; try { fn(); } catch (e) { console.error('[casa] loop ' + id, e); } arm(); };
    L.arm = arm;
    localLoops.add(L);
    arm();
    return {
      stop() { L.alive = false; clearTimeout(L.timer); localLoops.delete(L); },
      poke() { run(); },
      set(v) { L.ms = v; arm(); },
    };
  }
  function rearmLocal() { localLoops.forEach((L) => L.arm()); }

  function setPaused(p) {
    paused = p;
    if (cur) cur.overlay.classList.toggle('cp-paused', p);
    if (p) localLoops.forEach((L) => { clearTimeout(L.timer); L.timer = null; });
    else rearmLocal();
    if (cur) (p ? cur.onPause : cur.onResume).forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  }
  doc.addEventListener('casa:pause', () => setPaused(true));
  doc.addEventListener('casa:resume', () => setPaused(false));
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden && !paused) rearmLocal(); });

  // ------------------------------------------------------------ focus

  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),' +
    'textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),audio[controls]';
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), (n) => {
      if (n.closest('[hidden],[inert]')) return false;
      const r = n.getClientRects();
      return r.length > 0;
    });
  }

  function onKey(e) {
    if (!cur) return;
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const f = focusables(cur.panel);
      const a = doc.activeElement;
      if (!f.length) { e.preventDefault(); cur.panel.focus(); }
      else if (e.shiftKey && (a === f[0] || a === cur.panel || !cur.panel.contains(a))) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (a === f[f.length - 1] || !cur.panel.contains(a))) { e.preventDefault(); f[0].focus(); }
    }
    // keys typed in a panel never reach the room behind it
    e.stopPropagation();
  }

  function onFocusIn(e) {
    if (cur && !cur.overlay.contains(e.target)) cur.panel.focus();
  }

  // ------------------------------------------------------------ open / close

  function register(id, def) { defs[id] = def; }

  function open(id, detail) {
    const def = defs[id];
    if (!def) return false;
    let prev = doc.activeElement;
    if (cur) { prev = cur.prevFocus; close(true); }

    const titleId = 'cp-title-' + id;
    const title = el('h2', { class: 'cp-title', id: titleId, text: def.title || '' });
    const tools = el('div', { class: 'cp-tools' });
    // every object of the room can be put away from its panel; the box on the floor brings it back
    if (window.CasaRoomItems && window.CasaRoomItems.can(id)) {
      const put = el('button', { class: 'cp-link cp-small cp-put', type: 'button', title: 'Put this object away. The box on the floor brings it back.' }, 'Put away');
      put.addEventListener('click', () => { if (window.CasaRoomItems.hide(id)) close(); });
      tools.appendChild(put);
    }
    const closeBtn = el('button', { class: 'cp-close', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '×');
    const body = el('div', { class: 'cp-body' });
    const panel = el('section', {
      class: 'cp-panel cp-size-' + (def.size || 'm') + (def.tall ? ' cp-tall' : '') + ' cp-' + id,
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabIndex: -1, dataset: { panel: id },
    }, el('header', { class: 'cp-head' }, title, tools, closeBtn), body);
    const overlay = el('div', { class: 'cp-overlay' + (paused ? ' cp-paused' : ''), dataset: { panel: id } }, panel);

    const me = {
      id, overlay, panel, body, prevFocus: prev, cleanups: [], loops: [], onPause: [], onResume: [],
    };
    closeBtn.addEventListener('click', () => close());
    let downOnBackdrop = false;
    overlay.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === overlay; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay && downOnBackdrop) close(); downOnBackdrop = false; });
    overlay.addEventListener('keydown', onKey);

    const alive = () => cur === me;
    const ctx = {
      id, detail: detail || {}, body, tools, panel, el, clear, api, state, fail, loading, errorLine,
      alive,
      setTitle(t) { title.textContent = t; },
      close: () => { if (alive()) close(); },
      onClose(fn) { me.cleanups.push(fn); },
      onPause(fn) { me.onPause.push(fn); },
      onResume(fn) { me.onResume.push(fn); },
      paused: () => paused || doc.hidden,
      reduced: () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches),
      loop(name, ms, fn) {
        if (!alive()) return { stop() {}, poke() {}, set() {} };
        const h = startLoop('panel-' + id + '-' + name, ms, fn);
        me.loops.push(h);
        return h;
      },
      onData(kinds, fn) {
        const list = [].concat(kinds);
        const h = (e) => {
          const d = (e && e.detail) || {};
          if (d.source === 'panel:' + id) return;
          if (list.indexOf(d.kind) !== -1 || list.indexOf('*') !== -1) fn(d);
        };
        doc.addEventListener('casa:data', h);
        me.cleanups.push(() => doc.removeEventListener('casa:data', h));
      },
      emit(kind, extra) { emit(kind, extra, 'panel:' + id); },
      focusFirst() {
        const t = body.querySelector('[data-autofocus]') || focusables(body)[0];
        if (t && alive()) t.focus();
      },
    };

    cur = me;
    (doc.body || doc.documentElement).appendChild(overlay);
    doc.addEventListener('focusin', onFocusIn);
    panel.focus();
    loading(body);
    Promise.resolve()
      .then(() => def.render(ctx))
      .then(() => {
        if (!alive()) return;
        const a = doc.activeElement;
        if (a === panel || a === doc.body) {
          const t = body.querySelector('[data-autofocus]');
          if (t) t.focus();
        }
      })
      .catch((err) => {
        console.error('[casa] panel ' + id, err);
        if (alive()) state(body, { kind: 'error', title: 'Something went wrong', text: 'This panel could not open. Close it and try again.' });
      });
    doc.dispatchEvent(new CustomEvent('casa:panel', { detail: { id, open: true } }));
    return true;
  }

  function close(replacing) {
    const me = cur;
    if (!me) return;
    cur = null;
    me.loops.forEach((h) => { try { h.stop(); } catch (e) { /* already stopped */ } });
    me.cleanups.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    doc.removeEventListener('focusin', onFocusIn);
    if (me.overlay.parentNode) me.overlay.parentNode.removeChild(me.overlay);
    if (!replacing) {
      const p = me.prevFocus;
      if (p && p !== doc.body && p.isConnected && typeof p.focus === 'function') { try { p.focus(); } catch (e) { /* not focusable */ } }
    }
    doc.dispatchEvent(new CustomEvent('casa:panel', { detail: { id: me.id, open: false } }));
  }

  function onOpen(e) {
    if (!e || handled.has(e)) return;
    handled.add(e);
    const d = e.detail || {};
    if (d.id && defs[d.id]) open(d.id, d);
  }
  doc.addEventListener('casa:open', onOpen);
  window.addEventListener('casa:open', onOpen);

  // ------------------------------------------------------------ small shared formatters

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = {
    DAYS, MONTHS, pad,
    iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
    parseDay(s) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
      return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    },
    parse(s) {
      if (s instanceof Date) return s;
      const day = fmt.parseDay(s);
      if (day) return day;
      const d = new Date(s);
      return isNaN(d) ? null : d;
    },
    hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); },
    addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; },
    dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; },
    longDate(d) { return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; },
    short(d) { return DAYS[d.getDay()].slice(0, 3) + ' ' + d.getDate(); },
  };

  window.CasaPanels = {
    register, open, close, css, el, clear, api, state, fail, loading, errorLine, emit, fmt,
    isOpen: (id) => !!cur && (id == null || cur.id === id),
    current: () => (cur ? cur.id : null),
    ids: () => Object.keys(defs),
  };
})();
