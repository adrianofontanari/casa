/* Panel: the headphones. Lofi tracks (GET /api/music, streamed only on play) and the
   ambient sounds made on this computer by window.CasaAmbient (ambient.js).

   The player lives outside the panel: closing the panel or hiding the room keeps the
   sound the user started. Only visuals stop. The last choice and the volume are kept
   in the room state (`headphones`). window.CasaHeadphones exposes
   {toggle(), stop(), playing()} for the room object, and every change fires
   casa:data {kind:"music", playing, what}. */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el } = P;

  // ------------------------------------------------------------ the player

  const player = {
    tracks: [],
    choice: { mode: 'track', index: 0, sound: 'rain' },
    volume: 0.6,
    error: '',
    audio: null,
    subs: new Set(),
    restored: false,
  };
  const amb = () => (window.CasaAmbient && typeof window.CasaAmbient.play === 'function' ? window.CasaAmbient : null);

  function notify() {
    const what = nowPlaying();
    document.dispatchEvent(new CustomEvent('casa:data', { detail: { kind: 'music', source: 'panel:headphones', playing: !!what, what: what ? what.label : null } }));
    player.subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  }
  function remember() {
    const v = { mode: player.choice.mode, index: player.choice.index, sound: player.choice.sound, volume: Math.round(player.volume * 100) / 100 };
    if (typeof Kept !== 'undefined' && Kept && typeof Kept.set === 'function') Kept.set('headphones', v);
    else fetch('/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ headphones: v }) }).catch(() => {});
  }
  function audio() {
    if (player.audio) return player.audio;
    const a = new Audio();
    a.preload = 'none';
    a.volume = player.volume * player.volume;
    a.addEventListener('ended', () => { if (player.tracks.length) playTrack((player.choice.index + 1) % player.tracks.length); });
    a.addEventListener('error', () => { if (a.getAttribute('src')) { player.error = 'This track could not be played. Check your connection, or try another one.'; notify(); } });
    ['play', 'pause', 'playing'].forEach((ev) => a.addEventListener(ev, notify));
    player.audio = a;
    return a;
  }
  function trackPlaying() { return !!(player.audio && !player.audio.paused && player.audio.getAttribute('src')); }
  function nowPlaying() {
    if (trackPlaying()) { const t = player.tracks[player.choice.index]; return { mode: 'track', label: t ? t.title : 'Music' }; }
    const a = amb();
    const s = a && a.playing();
    return s ? { mode: 'ambient', label: s } : null;
  }
  function playTrack(i) {
    const t = player.tracks[i];
    if (!t) return;
    const a = amb();
    if (a) a.stop();
    player.error = '';
    player.choice.mode = 'track';
    player.choice.index = i;
    const el2 = audio();
    if (el2.getAttribute('src') !== t.src) el2.setAttribute('src', t.src);
    el2.volume = player.volume * player.volume;
    const p = el2.play();
    if (p && p.catch) p.catch((e) => { if (e && e.name === 'AbortError') return; player.error = 'This track could not be played. Check your connection, or try another one.'; notify(); });
    remember();
    notify();
  }
  function playSound(name) {
    const a = amb();
    if (!a) { player.error = 'Ambient sounds are not available here.'; notify(); return; }
    if (player.audio) player.audio.pause();
    player.error = '';
    player.choice.mode = 'ambient';
    player.choice.sound = name;
    a.volume(player.volume);
    if (!a.play(name)) player.error = 'This computer cannot play the ambient sounds.';
    remember();
    notify();
  }
  function stopAll() {
    if (player.audio) player.audio.pause();
    const a = amb();
    if (a) a.stop();
    notify();
  }
  function toggle() {
    if (nowPlaying()) { stopAll(); return; }
    if (player.choice.mode === 'ambient') playSound(player.choice.sound);
    else if (player.tracks.length) playTrack(Math.min(player.choice.index, player.tracks.length - 1));
  }
  function setVolume(v) {
    player.volume = Math.max(0, Math.min(1, v));
    if (player.audio) player.audio.volume = player.volume * player.volume;
    const a = amb();
    if (a) a.volume(player.volume);
    remember();
  }

  window.CasaHeadphones = { toggle, stop: stopAll, playing: () => { const n = nowPlaying(); return n ? n.label : null; } };

  // ------------------------------------------------------------ the panel

  P.css(`
.hp-now{display:flex;align-items:center;gap:14px;padding:12px 14px;background:var(--cp-navy);color:#fffdf8;border-radius:30px 8px 8px 30px;box-shadow:4px 4px 0 var(--cp-oat)}
.hp-play{flex:none;width:52px;height:52px;padding:0;border:3px solid #3a5088;border-radius:50%;background:var(--cp-oat);color:var(--cp-navy);font:700 18px/1 var(--cp-mono);cursor:pointer;box-shadow:0 3px 0 #11192f}
.hp-play:active{transform:translateY(2px);box-shadow:0 1px 0 #11192f}
.hp-play:focus-visible{outline-color:var(--cp-yellow)}
.hp-play[disabled]{opacity:.5;cursor:default}
.hp-what{flex:1;min-width:0}
.hp-what b{display:block;font:600 16px/1.3 var(--cp-sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hp-what span{display:block;font:12px/1.3 var(--cp-mono);color:#c8d0e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hp-eq{flex:none;display:flex;align-items:flex-end;gap:3px;height:22px}
.hp-eq i{width:4px;height:6px;background:var(--cp-oat)}
.hp-eq.on i{animation:hp-eq 1.1s steps(5) infinite}
.hp-eq.on i:nth-child(2){animation-duration:.9s}.hp-eq.on i:nth-child(3){animation-duration:1.3s}.hp-eq.on i:nth-child(4){animation-duration:.8s}
@keyframes hp-eq{0%{height:5px}25%{height:18px}50%{height:9px}75%{height:22px}100%{height:5px}}
.hp-vol{display:flex;align-items:center;gap:10px;margin:14px 0 4px}
.hp-vol input{flex:1;accent-color:#2e6e66}
.hp-vol .cp-label::after{display:none}
.hp-sec{margin:16px 0 0}
.hp-sounds{display:flex;flex-wrap:wrap;gap:8px}
.hp-sounds .cp-btn{min-width:84px}
.hp-list{list-style:none;margin:0;padding:0;border-top:1px dashed var(--cp-line)}
.hp-list li{display:flex;align-items:center;gap:8px;border-bottom:1px dashed var(--cp-line)}
.hp-track{flex:1;min-width:0;display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;gap:8px;padding:8px 4px;border:0;background:none;
  text-align:left;font:14px/1.3 var(--cp-sans);color:var(--cp-ink);cursor:pointer}
.hp-track:hover{background:var(--cp-wash)}
.hp-track .m{font:12px var(--cp-mono);color:var(--cp-muted)}
.hp-track .t small{display:block;font:12px/1.3 var(--cp-sans);color:var(--cp-muted)}
.hp-track[aria-current="true"]{color:var(--cp-teal);font-weight:650;background:rgba(246,201,62,.16)}
.hp-track[aria-current="true"] .m{color:var(--cp-teal)}
.hp-lic{flex:none;font-size:12px;padding-right:4px}
.hp-err{margin:10px 0 0;color:var(--cp-accent);font-size:13px}
.hp-err:empty{display:none}
.hp-note{margin:14px 0 0;font-size:12px;color:var(--cp-muted)}
`);

  const NAMES = { sea: 'Sea', rain: 'Rain', fire: 'Fire', birds: 'Birds' };
  const mmss = (s) => (s ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : '');

  P.register('headphones', {
    title: 'Headphones',
    size: 'm',
    async render(ctx) {
      const [res, st] = await Promise.all([ctx.api('music'), player.restored ? Promise.resolve(null) : ctx.api('state')]);
      if (!ctx.alive()) return;
      if (!res.ok) { ctx.fail(ctx.body, res, () => { ctx.loading(ctx.body); this.render(ctx); }, 'The music list'); return; }
      const M = res.json;
      if (M.off) {
        ctx.state(ctx.body, {
          title: 'Music and sounds are off',
          text: 'They are turned off in Settings > Casa. Turn them on to play lofi music or ambient sounds here.',
          action: { label: 'Turn on', run: async () => {
            const r = await ctx.api('settings', { method: 'POST', body: { musicOn: true } });
            if (!ctx.alive()) return;
            if (r.ok) { ctx.loading(ctx.body); this.render(ctx); }
          } },
        });
        return;
      }
      player.tracks = (Array.isArray(M.tracks) ? M.tracks : []).filter((t) => t && typeof t.src === 'string' && /^(https:|data:|blob:)/.test(t.src));
      if (!player.restored) {
        player.restored = true;
        let saved = null;
        if (typeof Kept !== 'undefined' && Kept && typeof Kept.get === 'function') saved = Kept.get('headphones', null);
        if (!saved && st && st.ok) saved = st.json.headphones;
        if (saved && typeof saved === 'object') {
          if (saved.mode === 'ambient' || saved.mode === 'track') player.choice.mode = saved.mode;
          if (Number.isInteger(saved.index) && saved.index >= 0) player.choice.index = saved.index;
          if (NAMES[saved.sound]) player.choice.sound = saved.sound;
          if (typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1) player.volume = saved.volume;
        }
      }
      if (player.choice.index >= player.tracks.length) player.choice.index = 0;
      const sounds = (Array.isArray(M.ambient) ? M.ambient : Object.keys(NAMES)).filter((n) => NAMES[n]);
      const ambOk = !!amb();

      const playBtn = el('button', { class: 'hp-play', type: 'button', dataset: { autofocus: '' } });
      const whatB = el('b'), whatS = el('span');
      const eq = el('div', { class: 'hp-eq', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i'));
      const vol = el('input', { type: 'range', min: 0, max: 100, step: 1, value: String(Math.round(player.volume * 100)), id: 'hp-vol', 'aria-label': 'Volume' });
      const err = el('p', { class: 'hp-err', role: 'alert' });
      const soundBtns = sounds.map((n) => el('button', { class: 'cp-btn', type: 'button', 'aria-pressed': 'false', disabled: !ambOk, onclick: () => {
        const cur = amb() && amb().playing();
        if (cur === n) stopAll(); else playSound(n);
      } }, NAMES[n]));
      const list = el('ul', { class: 'hp-list', 'aria-label': 'Songs' });
      const trackBtns = player.tracks.map((t, i) => {
        const b = el('button', { class: 'hp-track', type: 'button', onclick: () => {
          if (trackPlaying() && player.choice.index === i) stopAll(); else playTrack(i);
        } }, el('span', { class: 'm', 'aria-hidden': 'true' }), el('span', { class: 't' }, t.title || 'Untitled', el('small', { text: [t.artist, t.album].filter(Boolean).join(' · ') })), el('span', { class: 'm', text: mmss(t.seconds) }));
        const lic = t.license ? (t.licenseHref && /^https:/.test(t.licenseHref)
          ? el('button', { class: 'cp-link hp-lic', type: 'button', title: 'Licence', onclick: () => ctx.api('link', { method: 'POST', body: { url: t.licenseHref } }) }, t.license)
          : el('span', { class: 'hp-lic cp-muted', text: t.license })) : null;
        const src = t.href && /^https:/.test(t.href)
          ? el('button', { class: 'cp-link hp-lic', type: 'button', 'aria-label': 'Source page of ' + (t.title || 'this track'), onclick: () => ctx.api('link', { method: 'POST', body: { url: t.href } }) }, 'source') : null;
        list.appendChild(el('li', {}, b, lic, src));
        return b;
      });

      function sync() {
        if (!ctx.alive()) return;
        const n = nowPlaying();
        const cur = player.choice.mode === 'track' ? player.tracks[player.choice.index] : null;
        playBtn.textContent = n ? '❚❚' : '▶';
        playBtn.setAttribute('aria-label', n ? 'Pause' : 'Play');
        playBtn.disabled = !n && (player.choice.mode === 'track' ? !player.tracks.length : !ambOk);
        if (n && n.mode === 'ambient') { whatB.textContent = NAMES[n.label] || n.label; whatS.textContent = 'ambient sound, made on this computer'; }
        else if (cur) { whatB.textContent = cur.title || 'Untitled'; whatS.textContent = [cur.artist, cur.license].filter(Boolean).join(' · ') + (n ? '' : ' · paused'); }
        else if (player.choice.mode === 'ambient') { whatB.textContent = NAMES[player.choice.sound]; whatS.textContent = 'ambient sound · stopped'; }
        else { whatB.textContent = 'Nothing playing'; whatS.textContent = 'Pick a song or a sound'; }
        eq.classList.toggle('on', !!n && !ctx.reduced());
        const ambNow = amb() && amb().playing();
        soundBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(ambNow === sounds[i])));
        trackBtns.forEach((b, i) => {
          const on = player.choice.mode === 'track' && player.choice.index === i;
          b.setAttribute('aria-current', on ? 'true' : 'false');
          b.firstChild.textContent = on && trackPlaying() ? '♪' : '';
          b.setAttribute('aria-label', (on && trackPlaying() ? 'Pause ' : 'Play ') + (player.tracks[i].title || 'track'));
        });
        err.textContent = player.error || '';
      }

      playBtn.addEventListener('click', toggle);
      vol.addEventListener('input', () => setVolume(Number(vol.value) / 100));
      player.subs.add(sync);
      ctx.onClose(() => player.subs.delete(sync));

      ctx.clear(ctx.body);
      ctx.body.append(
        el('div', { class: 'hp-now' }, playBtn, el('div', { class: 'hp-what', 'aria-live': 'polite' }, whatB, whatS), eq),
        el('div', { class: 'hp-vol' }, el('label', { for: 'hp-vol', class: 'cp-label', style: { margin: 0 }, text: 'Volume' }), vol),
        err,
        el('section', { class: 'hp-sec', 'aria-label': 'Ambient sounds' }, el('h3', { class: 'cp-label', text: 'Ambient sounds' }),
          ambOk ? el('div', { class: 'hp-sounds' }, soundBtns) : el('p', { class: 'cp-muted cp-small', text: 'Ambient sounds are not available in this build.' })),
        el('section', { class: 'hp-sec', 'aria-label': 'Songs' }, el('h3', { class: 'cp-label', text: 'Lofi songs' }),
          player.tracks.length ? list : el('p', { class: 'cp-muted cp-small', text: 'No songs available right now.' })),
        el('p', { class: 'hp-note' }, 'Songs stream from the internet only when you press play. Sounds are made on your computer. ',
          M.credit ? (M.creditHref && /^https:/.test(M.creditHref)
            ? el('button', { class: 'cp-link', type: 'button', onclick: () => ctx.api('link', { method: 'POST', body: { url: M.creditHref } }) }, M.credit)
            : M.credit) : null));
      sync();
    },
  });
})();
