/* Panel: the power strip. The computer's battery level and charging state, read in
   the room with navigator.getBattery() (no bridge, no network). Listens to the
   battery events only while the panel is open. */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el } = P;

  P.css(`
.st-wrap{display:flex;align-items:center;gap:22px;padding:6px 2px 4px}
.st-cell{position:relative;flex:none;display:grid;grid-template-columns:repeat(10,1fr);gap:3px;width:150px;height:62px;padding:6px;
  border:4px solid var(--cp-navy);background:#fffdf8}
.st-cell::after{content:"";position:absolute;right:-12px;top:50%;width:8px;height:22px;margin-top:-11px;background:var(--cp-navy)}
.st-cell i{background:var(--cp-oat)}
.st-cell i.on{background:var(--cp-teal)}
.st-cell.low i.on{background:var(--cp-verm)}
.st-cell.mid i.on{background:var(--cp-mustard)}
.st-bolt{position:absolute;inset:0;display:grid;place-items:center;font:700 26px/1 var(--cp-mono);color:var(--cp-navy);text-shadow:2px 2px 0 var(--cp-yellow)}
.st-pct{font:700 34px/1 var(--cp-mono);color:var(--cp-navy)}
.st-what{margin:6px 0 0;font-size:14px;color:var(--cp-muted)}
.st-note{margin:16px 0 0;font-size:12px;color:var(--cp-faint)}
`);

  function duration(s) {
    if (!Number.isFinite(s) || s <= 0) return '';
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? h + ' h ' + m + ' min' : m + ' min';
  }

  P.register('strip', {
    title: 'Power strip',
    size: 's',
    async render(ctx) {
      if (!navigator.getBattery) {
        ctx.state(ctx.body, { title: 'No battery reading', text: 'This computer does not tell Casa about its battery.' });
        return;
      }
      let bat;
      try { bat = await navigator.getBattery(); } catch (e) { bat = null; }
      if (!ctx.alive()) return;
      if (!bat) { ctx.state(ctx.body, { title: 'No battery reading', text: 'This computer does not tell Casa about its battery.' }); return; }

      const cell = el('div', { class: 'st-cell', role: 'img' });
      const bars = Array.from({ length: 10 }, () => el('i'));
      bars.forEach((b) => cell.appendChild(b));
      const bolt = el('span', { class: 'st-bolt', 'aria-hidden': 'true', text: '⚡︎' });
      const pct = el('div', { class: 'st-pct' });
      const what = el('p', { class: 'st-what', 'aria-live': 'polite' });

      function show() {
        const lv = Math.max(0, Math.min(1, Number(bat.level) || 0));
        const p = Math.round(lv * 100);
        const on = Math.round(lv * 10);
        bars.forEach((b, i) => b.classList.toggle('on', i < on));
        cell.classList.toggle('low', !bat.charging && p <= 20);
        cell.classList.toggle('mid', !bat.charging && p > 20 && p <= 40);
        if (bat.charging) { if (!bolt.parentNode) cell.appendChild(bolt); } else if (bolt.parentNode) bolt.remove();
        pct.textContent = p + '%';
        let s;
        if (bat.charging && p >= 100) s = 'Plugged in and full.';
        else if (bat.charging) s = 'Charging' + (duration(bat.chargingTime) ? ', full in about ' + duration(bat.chargingTime) : '') + '.';
        else s = 'On battery' + (duration(bat.dischargingTime) ? ', about ' + duration(bat.dischargingTime) + ' left' : '') + '.';
        what.textContent = s;
        cell.setAttribute('aria-label', 'Battery ' + p + '%, ' + (bat.charging ? 'charging' : 'not charging'));
      }

      const evs = ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'];
      evs.forEach((e) => bat.addEventListener(e, show));
      ctx.onClose(() => evs.forEach((e) => bat.removeEventListener(e, show)));

      ctx.clear(ctx.body);
      ctx.body.append(el('div', { class: 'st-wrap' }, cell, el('div', {}, pct, what)),
        el('p', { class: 'st-note', text: 'Read from this computer only. A desktop without a battery shows as plugged in and full.' }));
      show();
    },
  });
})();
