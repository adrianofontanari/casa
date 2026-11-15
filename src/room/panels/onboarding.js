/* Casa room: the first-run card.

   The room appears at once with sensible defaults; a moment later this small pixel card walks
   through three skippable steps (under a minute):
     1. Your daily notes  - what Casa detected; "Change folder" opens Obsidian's own folder picker.
     2. Your city         - type-ahead over /api/geocode; "Skip, no weather".
     3. Your calendar     - "Add my calendar" opens Obsidian's own prompt for the ICS link.
   then a done state: the buddy says hi, and `casa:data {kind:"settings"}` plus `casa:hint`
   let the room refresh and pulse its objects once.

   The room never sends a URL or a folder: those are typed into native Obsidian modals opened by
   POST /api/onboarding {step:"calendar"|"folder"}, which answer only {saved}.
   Every string from the vault or the network is set with textContent.

   Opens when GET /api/onboarding says done:false, on `casa:welcome`, on `casa:open {id:"onboarding"}`,
   or with window.CasaOnboarding.open(step). No timers run while it is closed. */
(function () {
  'use strict';
  if (window.CasaOnboarding) return;
  const doc = document;
  const STEPS = ['daily', 'city', 'calendar'];
  const HINT = 'Hi! Click anything in the room to open it.';
  const HOWTO = [
    ['Google Calendar', 'Settings, your calendar, Integrate calendar: "Secret address in iCal format".'],
    ['Outlook', 'Settings, Calendar, Shared calendars, Publish a calendar: the ICS link.'],
    ['iCloud', 'Calendar app, share the calendar, Public Calendar: Copy Link.'],
  ];

  let st = null;          // last GET /api/onboarding
  let overlay = null;
  let card = null;
  let step = 0;           // 0..2, 3 = done
  let lastFocus = null;
  let dismissed = false;  // finished or skipped in this session
  let waiting = null;     // 'folder' | 'calendar' while a native prompt is open
  let geoOff = false;
  let geoSeq = 0;
  let geoTimer = null;

  // ------------------------------------------------------------ styles

  const style = doc.createElement('style');
  style.id = 'casa-onboarding-css';
  style.textContent = `
.cob-overlay{--ob-paper:#fffdf8;--ob-ink:#18171c;--ob-muted:#6c6873;--ob-line:#e7e1d4;--ob-wash:#f4efe4;
  --ob-kick:#8a5a3c;--ob-accent:#c4553b;--ob-focus:#f2b84b;
  --ob-sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --ob-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  position:fixed;inset:0;z-index:1100;display:flex;align-items:flex-end;justify-content:center;
  padding:16px 16px max(16px,7vh);background:rgba(12,11,16,.28);box-sizing:border-box;
  font:14px/1.45 var(--ob-sans);color:var(--ob-ink);-webkit-font-smoothing:antialiased}
.cob-overlay *,.cob-overlay *::before,.cob-overlay *::after{box-sizing:border-box}
.cob{position:relative;width:min(420px,100%);max-height:100%;overflow:auto;background:var(--ob-paper);color:var(--ob-ink);
  padding:14px 20px 18px;outline:none;--f:var(--ob-ink);
  box-shadow:4px 0 0 0 var(--f),-4px 0 0 0 var(--f),0 4px 0 0 var(--f),0 -4px 0 0 var(--f),inset 0 0 0 3px #efe8d9,8px 8px 0 0 rgba(0,0,0,.3);
  animation:cob-pop .3s steps(3)}
@keyframes cob-pop{from{transform:translateY(10px) scale(.96);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.cob{animation:none}}
.cob-top{display:flex;align-items:center;gap:10px;margin-bottom:8px;min-height:24px}
.cob-k{flex:1;font:600 11px/1.2 var(--ob-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ob-kick)}
.cob-skip{font:inherit;font-size:12px;background:none;border:0;padding:4px 2px;color:var(--ob-muted);text-decoration:underline;cursor:pointer}
.cob h2{margin:0 0 8px;font:700 20px/1.2 var(--ob-sans);letter-spacing:-.01em}
.cob p{margin:0 0 8px}
.cob-v{font-family:var(--ob-mono);font-size:13px;font-weight:500;background:var(--ob-wash);padding:1px 5px;overflow-wrap:anywhere}
.cob-muted{color:var(--ob-muted);font-size:13px}
.cob-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}
.cob-btn{font:600 14px/1 var(--ob-sans);min-height:38px;padding:0 16px;border:0;cursor:pointer;background:var(--ob-paper);color:var(--ob-ink);
  box-shadow:2px 0 0 0 var(--ob-ink),-2px 0 0 0 var(--ob-ink),0 2px 0 0 var(--ob-ink),0 -2px 0 0 var(--ob-ink)}
.cob-btn:hover{background:var(--ob-wash)}
.cob-btn.primary{background:var(--ob-ink);color:var(--ob-paper)}
.cob-btn.primary:hover{background:#34323b}
.cob-btn[disabled]{opacity:.5;cursor:default}
.cob-btn:focus-visible,.cob-skip:focus-visible,.cob-in:focus-visible,.cob:focus-visible{outline:3px solid var(--ob-focus);outline-offset:3px}
.cob-label{display:block;font:600 11px/1.2 var(--ob-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ob-kick);margin:10px 0 6px}
.cob-in{width:100%;font:inherit;font-size:15px;padding:9px 10px;background:#fff;color:var(--ob-ink);border:0;border-radius:0;box-shadow:inset 0 0 0 2px var(--ob-ink)}
.cob-in[disabled]{background:var(--ob-wash);color:var(--ob-muted)}
.cob-list{list-style:none;margin:4px 0 0;padding:0;background:#fff;border:2px solid var(--ob-ink);max-height:184px;overflow:auto}
.cob-list[hidden]{display:none}
.cob-list li{padding:8px 10px;cursor:pointer;border-top:2px dotted var(--ob-line)}
.cob-list li:first-child{border-top:0}
.cob-list li[aria-selected="true"]{background:#ffe9b8}
.cob-list .sub{color:var(--ob-muted)}
.cob-status{min-height:1.45em;margin:6px 0 0;font-size:13px;color:var(--ob-muted)}
.cob-status.err{color:#a8402b}
.cob-status.ok{color:#2f6b3a}
.cob-how{margin:8px 0 0;padding:0;list-style:none;font-size:13px;color:#4a4650}
.cob-how li{position:relative;padding:3px 0 3px 16px}
.cob-how li::before{content:"";position:absolute;left:2px;top:10px;width:6px;height:6px;background:var(--ob-accent)}
.cob-how b{font-weight:700;color:var(--ob-ink)}
.cob-dots{display:flex;gap:6px;margin-top:16px}
.cob-dots i{width:8px;height:8px;background:#e0d6c4}
.cob-dots i.on{background:var(--ob-ink)}
.cob-hi{display:flex;align-items:flex-end;gap:12px;margin:4px 0 12px}
.cob-hi canvas{image-rendering:pixelated;flex:none}
.cob-say{position:relative;background:#fff;padding:7px 10px;font-weight:700;margin-bottom:22px;
  box-shadow:2px 0 0 0 var(--ob-ink),-2px 0 0 0 var(--ob-ink),0 2px 0 0 var(--ob-ink),0 -2px 0 0 var(--ob-ink)}
.cob-dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 14px;margin:0}
.cob-dl dt{font:600 11px/1.7 var(--ob-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ob-kick)}
.cob-dl dd{margin:0;font-weight:600;overflow-wrap:anywhere}
`;
  (doc.head || doc.documentElement).appendChild(style);

  // ------------------------------------------------------------ helpers

  function h(tag, props) {
    const e = doc.createElement(tag);
    const p = props || {};
    for (const k of Object.keys(p)) {
      const v = p[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (let i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach((k) => add(e, k)); return; }
    e.appendChild(typeof kid === 'string' ? doc.createTextNode(kid) : kid);
  }
  const v = (text) => h('span', { class: 'cob-v', text: String(text) });
  const btn = (text, onclick, primary) => h('button', { type: 'button', class: 'cob-btn' + (primary ? ' primary' : ''), onclick, text });

  async function api(route, method, body, query) {
    const qs = query ? '?' + Object.keys(query).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&') : '';
    try {
      const opts = method && method !== 'GET'
        ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }
        : undefined;
      const r = await fetch('/api/' + route + qs, opts);
      let json = null;
      try { json = await r.json(); } catch (e) { json = null; }
      return { ok: r.ok, status: r.status, json };
    } catch (e) {
      return { ok: false, status: 0, json: null };
    }
  }

  async function refresh() {
    const r = await api('onboarding');
    if (r.ok && r.json && r.json.daily) st = r.json;
    return r;
  }

  function emit(name, detail) {
    try { doc.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* old engines */ }
  }

  // ------------------------------------------------------------ open / close

  function isOpen() { return !!overlay; }

  async function open(which) {
    if (!st) await refresh();
    if (!st) return;
    step = typeof which === 'number' ? which : which === 'done' ? 3 : Math.max(0, STEPS.indexOf(which));
    if (!overlay) {
      lastFocus = doc.activeElement;
      overlay = h('div', { class: 'cob-overlay', onkeydown: onKey });
      card = h('section', { class: 'cob', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cob-title', 'aria-describedby': 'cob-desc', tabindex: '-1' });
      overlay.appendChild(card);
      (doc.body || doc.documentElement).appendChild(overlay);
    }
    render();
  }

  async function finish(withHint) {
    dismissed = true;
    await api('onboarding', 'POST', { step: 'done' });
    if (st) st.done = true;
    close();
    emit('casa:data', { kind: 'settings', source: 'onboarding' });
    if (withHint) emit('casa:hint', { text: HINT, pulse: true, source: 'onboarding' });
  }

  function close() {
    if (geoTimer) { clearTimeout(geoTimer); geoTimer = null; }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    card = null;
    waiting = null;
    if (lastFocus && typeof lastFocus.focus === 'function' && doc.contains(lastFocus)) {
      try { lastFocus.focus(); } catch (e) { /* ignore */ }
    }
  }

  function focusables() {
    return card ? Array.prototype.filter.call(card.querySelectorAll('button,input,[tabindex="0"]'), (e) => !e.disabled && e.offsetParent !== null) : [];
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      const list = card && card.querySelector('.cob-list:not([hidden])');
      if (list) { list.hidden = true; const i = card.querySelector('[role="combobox"]'); if (i) i.setAttribute('aria-expanded', 'false'); }
      else finish(true);
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && (doc.activeElement === first || doc.activeElement === card)) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && doc.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  }

  // ------------------------------------------------------------ steps

  function go(n) { step = n; render(); }

  function render() {
    if (!card) return;
    if (geoTimer) { clearTimeout(geoTimer); geoTimer = null; }
    const view = step === 0 ? viewDaily() : step === 1 ? viewCity() : step === 2 ? viewCalendar() : viewDone();
    card.textContent = '';
    const top = h('div', { class: 'cob-top' },
      h('div', { class: 'cob-k', text: step < 3 ? 'Setup ' + (step + 1) + ' of 3' : 'All set' }),
      step < 3 ? h('button', { type: 'button', class: 'cob-skip', onclick: () => finish(true), title: 'You can run it again from Casa\'s settings', text: 'Skip setup' }) : null);
    const dots = h('div', { class: 'cob-dots', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('i', { class: i <= step ? 'on' : '' })));
    add(card, [top, h('h2', { id: 'cob-title', text: view.title }), h('div', { id: 'cob-desc' }, view.body), h('div', { class: 'cob-row' }, view.actions), dots]);
    const target = view.focus || card.querySelector('.cob-btn.primary') || card;
    setTimeout(() => { if (card && target && doc.contains(target)) target.focus(); }, 0);
  }

  function status(text, kind) {
    const s = card && card.querySelector('.cob-status');
    if (!s) return;
    s.textContent = text || '';
    s.className = 'cob-status' + (kind ? ' ' + kind : '');
  }

  function where(d) {
    return d.folder ? d.folder + '/' : 'the vault root';
  }

  function viewDaily() {
    const d = (st && st.daily) || {};
    const label = { core: 'Daily notes', periodic: 'Periodic Notes', journals: 'Journals' }[d.source] || 'daily notes';
    const none = d.source === 'casa' && !d.custom && !d.guessed && !d.found;
    let line;
    if (none) line = h('p', null, 'No daily notes yet: Casa will keep today\'s note in ', v(where(d)), '.');
    else if (d.custom) line = h('p', null, 'Casa keeps today\'s note in ', v(where(d)), ', named ', v(d.example || ''), '.');
    else if (d.found > 0 || d.guessed) line = h('p', null, 'Found ' + label + ' in ', v(where(d)), ', named ', v(d.example || ''), '.');
    else line = h('p', null, label + ' is set up for ', v(where(d)), ', named ', v(d.example || ''), '.');
    const body = [
      line,
      h('p', { class: 'cob-muted', text: 'Casa writes to it only when you set a goal or add a task. No other plugin or template is needed.' }),
      h('p', { class: 'cob-status', role: 'status', 'aria-live': 'polite' }),
    ];
    const ok = btn(none ? 'OK' : 'Looks right', () => { api('onboarding', 'POST', { step: 'daily' }); go(1); }, true);
    const change = btn(none ? 'Choose folder' : 'Change folder', () => ask('folder', change), false);
    return { title: 'Your daily notes', body, actions: [ok, change] };
  }

  // Opens a native Obsidian prompt (outside the room). The answer says only whether it saved.
  async function ask(kind, button) {
    if (waiting) return;
    waiting = kind;
    if (button) button.disabled = true;
    status(kind === 'folder' ? 'Choose the folder in the Obsidian window.' : 'Paste the link in the Obsidian window.');
    const r = await api('onboarding', 'POST', { step: kind });
    if (!card) return;
    if (r.status === 504) return; // still open in Obsidian: the settings event moves us on
    waiting = null;
    if (button) button.disabled = false;
    if (r.ok && r.json && r.json.saved) {
      await refresh();
      if (kind === 'folder') go(1);
      else { status('Calendar connected.', 'ok'); setTimeout(() => { if (card && step === 2) go(3); }, 500); }
    } else if (r.status === 501 || r.status === 404) {
      status(kind === 'folder' ? 'Change it in Casa\'s settings, under Daily notes.' : 'Add it in Casa\'s settings, under Calendar.', 'err');
    } else if (r.json && r.json.error && r.status !== 200) {
      status(r.json.error, 'err');
    } else {
      status(kind === 'folder' ? 'Folder unchanged.' : 'No calendar added.');
    }
  }

  function cityLabel(r) {
    const parts = [r.name];
    if (r.admin1 && r.admin1 !== r.name) parts.push(r.admin1);
    if (r.country) parts.push(r.country);
    return parts.filter(Boolean).join(', ');
  }

  function viewCity() {
    const cur = st && st.city;
    const input = h('input', {
      id: 'cob-city', class: 'cob-in', type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
      'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': 'cob-cities', placeholder: 'Start typing a city',
      disabled: geoOff,
    });
    const list = h('ul', { id: 'cob-cities', class: 'cob-list', role: 'listbox', 'aria-label': 'Cities', hidden: true });
    let results = [];
    let active = -1;

    function show(items) {
      results = items;
      active = items.length ? 0 : -1;
      list.textContent = '';
      items.forEach((r, i) => {
        const li = h('li', { id: 'cob-city-' + i, role: 'option', 'aria-selected': i === active ? 'true' : 'false' },
          String(r.name || ''), h('span', { class: 'sub', text: cityLabel(r).slice(String(r.name || '').length) }));
        li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
        list.appendChild(li);
      });
      list.hidden = !items.length;
      input.setAttribute('aria-expanded', items.length ? 'true' : 'false');
      mark();
    }
    function mark() {
      Array.prototype.forEach.call(list.children, (li, i) => li.setAttribute('aria-selected', i === active ? 'true' : 'false'));
      if (active >= 0) {
        input.setAttribute('aria-activedescendant', 'cob-city-' + active);
        const li = list.children[active];
        if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }
    async function search(q) {
      const seq = ++geoSeq;
      status('Searching...');
      const r = await api('geocode', 'GET', null, { q });
      if (seq !== geoSeq || !card) return;
      if (r.status === 404 || r.status === 501) {
        geoOff = true;
        input.disabled = true;
        show([]);
        status('City search is not available. You can add a city later in Casa\'s settings.', 'err');
        return;
      }
      const items = r.ok && r.json && Array.isArray(r.json.results) ? r.json.results.filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lon)).slice(0, 6) : [];
      show(items);
      status(r.ok ? (items.length ? '' : 'No match. Try another spelling.') : 'Search failed. Check the connection, or skip for now.', r.ok ? '' : 'err');
    }
    async function pick(i) {
      const r = results[i];
      if (!r) return;
      const city = { name: cityLabel(r).slice(0, 80), lat: r.lat, lon: r.lon };
      input.value = city.name;
      show([]);
      status('Saving...');
      const res = await api('onboarding', 'POST', { step: 'city', city });
      if (!card) return;
      if (res.ok) { if (res.json && res.json.daily) st = res.json; emit('casa:data', { kind: 'weather', source: 'onboarding' }); go(2); }
      else status((res.json && res.json.error) || 'Could not save the city.', 'err');
    }
    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (geoTimer) clearTimeout(geoTimer);
      if (q.length < 2) { geoSeq++; show([]); status(''); return; }
      geoTimer = setTimeout(() => { geoTimer = null; search(q); }, 280);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && results.length) { active = (active + 1) % results.length; mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && results.length) { active = (active - 1 + results.length) % results.length; mark(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (active >= 0) pick(active); e.preventDefault(); }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (doc.activeElement !== input) show([]); }, 120));

    const body = [h('p', { text: 'For the window: weather, daylight and the sky outside.' })];
    if (cur && cur.name) body.push(h('p', null, 'Now: ', v(cur.name)));
    body.push(h('label', { class: 'cob-label', for: 'cob-city', text: cur ? 'Another city' : 'City' }), input, list,
      h('p', { class: 'cob-status' + (geoOff ? ' err' : ''), role: 'status', 'aria-live': 'polite',
        text: geoOff ? 'City search is not available. You can add a city later in Casa\'s settings.' : '' }));
    const actions = cur ? [btn('Keep it', () => go(2), true), btn('Skip', () => go(2))] : [btn('Skip, no weather', () => go(2))];
    return { title: 'Your city', body, actions, focus: geoOff ? null : input };
  }

  function viewCalendar() {
    const has = st && st.calendar;
    const how = h('ul', { class: 'cob-how' }, HOWTO.map(([name, text]) => h('li', null, h('b', { text: name + ': ' }), text)));
    const body = [
      h('p', { text: has ? 'A calendar is connected. Today\'s events show on the desk.' : 'Show today\'s events on the desk. Casa asks for your calendar\'s ICS link in an Obsidian window.' }),
      how,
      h('p', { class: 'cob-status', role: 'status', 'aria-live': 'polite' }),
    ];
    const addBtn = btn(has ? 'Use another link' : 'Add my calendar', () => ask('calendar', addBtn), !has);
    const actions = has ? [btn('Keep it', () => go(3), true), addBtn] : [addBtn, btn('Skip', () => go(3))];
    return { title: 'Your calendar (optional)', body, actions };
  }

  function buddyCanvas() {
    const T = window.CasaTheme;
    const b = T && T.buddy;
    if (!b || typeof b.draw !== 'function') return null;
    try {
      const u = 2;
      const w = (b.w || 26) * u;
      const hgt = (b.h || 28) * u;
      const c = h('canvas', { width: w, height: hgt, 'aria-hidden': 'true' });
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      b.draw(g, 0, 0, u, 0, 'wave');
      return c;
    } catch (e) {
      return null;
    }
  }

  function viewDone() {
    if (!dismissed) { dismissed = true; api('onboarding', 'POST', { step: 'done' }); }
    const d = (st && st.daily) || {};
    const c = st && st.city;
    const pal = buddyCanvas();
    const body = [
      h('div', { class: 'cob-hi' }, pal, h('div', { class: 'cob-say', text: HINT })),
      h('dl', { class: 'cob-dl' },
        h('dt', { text: 'Daily notes' }), h('dd', { text: where(d) }),
        h('dt', { text: 'Weather' }), h('dd', { text: c && c.name ? c.name : 'Off' }),
        h('dt', { text: 'Calendar' }), h('dd', { text: st && st.calendar ? 'Connected' : 'Not connected' })),
      h('p', { class: 'cob-muted', style: 'margin-top:12px', text: 'Change any of this, or run the welcome again, from Casa\'s settings.' }),
    ];
    const enter = btn('Enter the room', () => {
      close();
      emit('casa:data', { kind: 'settings', source: 'onboarding' });
      emit('casa:hint', { text: HINT, pulse: true, source: 'onboarding' });
    }, true);
    return { title: 'Your room is ready', body, actions: [enter] };
  }

  // ------------------------------------------------------------ wiring

  doc.addEventListener('casa:welcome', () => { dismissed = false; refresh().then(() => open(0)); });
  doc.addEventListener('casa:open', (e) => { if (e.detail && e.detail.id === 'onboarding') open(0); });
  doc.addEventListener('casa:data', (e) => {
    const d = e.detail || {};
    if (d.kind !== 'settings' || d.source === 'onboarding') return;
    refresh().then(() => {
      if (!st) return;
      if (!overlay) { if (st.done === false && !dismissed) open(0); return; }
      // A native prompt answered after the bridge gave up waiting: move on from here.
      if (waiting === 'folder') { waiting = null; go(1); }
      else if (waiting === 'calendar' && st.calendar) { waiting = null; go(3); }
      else if (step === 0 || step === 3) render();
    });
  });

  function start() {
    refresh().then((r) => {
      if (r.ok && st && st.done === false && !dismissed) setTimeout(() => { if (!overlay && !dismissed) open(0); }, 700);
    });
  }

  window.CasaOnboarding = { open, close, isOpen, state: () => st };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})();
