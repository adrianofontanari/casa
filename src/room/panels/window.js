/* Panel: the window. Weather now, the next hours, five days, the air outside (and at
   home, with a sensor link), and the webcam view.
   Data: /api/weather, /api/forecast, /api/air, /api/webcam, /api/settings.
   Every source answers on its own: one that fails leaves the others on screen. */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el, fmt } = P;

  P.css(`
.cp-window .cp-body{padding:14px 16px 18px}
.wn-sec{margin:0 0 16px;padding:12px 14px 14px;border:2px solid var(--cp-oat);background:#fffdf8;box-shadow:4px 4px 0 var(--cp-oat)}
.wn-sec>h3{margin:0 0 10px;font:700 12px/1.2 var(--cp-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--cp-teal)}
.wn-sec>h3 span{color:var(--cp-faint);font-weight:500;letter-spacing:.06em;text-transform:none}
.wn-sum{margin:0 0 12px;padding:6px 10px;border-left:4px solid var(--cp-teal);background:var(--cp-oatL);font:550 16px/1.35 var(--cp-sans);color:var(--cp-navy)}
.wn-now{display:flex;align-items:center;gap:14px;margin:0 0 10px}
.wn-now .big{font:700 40px/1 var(--cp-mono);letter-spacing:-.06em;color:var(--cp-navy)}
.wn-now svg{width:40px;height:40px}
.wn-now .what{font:15px/1.3 var(--cp-sans)}
.wn-now .where{font:12px/1.3 var(--cp-mono);color:var(--cp-muted)}
.wn-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px}
.wn-chip{min-width:92px;padding:6px 10px;background:var(--cp-wash)}
.wn-chip b{display:block;font:600 15px/1.2 var(--cp-sans)}
.wn-chip span{font:11px/1.2 var(--cp-mono);color:var(--cp-muted)}
.wn-chart{display:block;width:100%;height:auto;margin:6px 0 2px}
.wn-chart text{font-family:ui-monospace,Menlo,monospace}
.wn-sun{display:flex;flex-wrap:wrap;gap:16px;margin:4px 0 12px;font:12px/1.3 var(--cp-mono);color:var(--cp-muted)}
.wn-days{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.wn-day{padding:8px 6px;text-align:center;background:var(--cp-wash);border:2px solid transparent}
.wn-day.today{border-color:var(--cp-navy);background:var(--cp-mustardL)}
.wn-day .dn{font:700 11px/1 var(--cp-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--cp-teal)}
.wn-day svg{display:block;width:28px;height:28px;margin:6px auto}
.wn-day .rg{position:relative;height:4px;margin:4px 6px;background:#e3ddd0}
.wn-day .rg i{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,#2c8c88,#c89a48)}
.wn-day .mm{font:13px/1.3 var(--cp-sans)}.wn-day .mm b{font-weight:600}
.wn-day .lb{font-size:12px;color:var(--cp-muted);overflow-wrap:anywhere}
.wn-day .wet{color:#2f6f9f}
.wn-credit{margin:8px 0 0;font-size:11px;color:var(--cp-faint)}
.wn-credit .cp-link{font-size:11px}
.wn-two{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px}
.wn-two>.wn-sec{margin:0}
.wn-aqi{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.wn-aqi .n{font:700 40px/1 var(--cp-mono)}
.wn-aqi .s{font-size:13px;color:var(--cp-muted)}
.wn-aqi .b{font:600 15px/1.2 var(--cp-sans)}
.wn-bar{display:grid;grid-template-columns:repeat(6,1fr);gap:3px;margin:10px 0}
.wn-bar i{height:6px;background:#e3ddd0}
.wn-pol{width:100%;border-collapse:collapse;font:13px/1.3 var(--cp-mono)}
.wn-pol td{padding:3px 0;border-bottom:1px dashed var(--cp-line)}
.wn-pol td:last-child{text-align:right;color:var(--cp-muted)}
.wn-home{margin-top:12px;padding-top:10px;border-top:2px solid var(--cp-line)}
.wn-home h4{margin:0 0 6px;font:600 11px/1.2 var(--cp-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--cp-muted)}
.wn-cam{margin:0}
.wn-cam img{display:block;width:100%;height:auto;max-height:340px;object-fit:cover;background:#22262c;image-rendering:auto}
.wn-strip{display:block}
.wn-cam.wide .wn-strip{overflow-x:auto;overscroll-behavior-x:contain}
.wn-cam.wide img{width:100%;min-width:900px;max-height:none;object-fit:fill}
.wn-two>.wn-full{grid-column:1/-1}
.wn-two.cam-wide{grid-template-columns:minmax(0,1fr)}
.wn-two.cam-wide .wn-airgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0 28px}
.wn-two.cam-wide .wn-home{margin-top:0;padding-top:0;border-top:0}
.wn-cam figcaption{margin-top:6px;font-size:12px;color:var(--cp-muted)}
.wn-off{margin:0;color:var(--cp-muted);font-size:14px}
.wn-err{margin:0;color:var(--cp-accent);font-size:13px}
.wn-mini{margin:4px 0 0;font-size:11px;color:var(--cp-faint)}
.wn-more{margin:12px 0 0}
.st-ok{color:#2f7d4f}.st-warn{color:#a77a12}.st-orange{color:#c4621d}.st-alert{color:#b4322a}
.bg-ok{background:#58a06e!important}.bg-warn{background:#d7b13a!important}.bg-orange{background:#dd8a3b!important}.bg-alert{background:#c4473b!important}
@media (max-width:860px){.wn-two{grid-template-columns:minmax(0,1fr)}.wn-two>.wn-sec{margin:0}}
@media (max-width:620px){.wn-days{grid-template-columns:repeat(3,minmax(0,1fr))}}
`);

  // ------------------------------------------------------------ weather words and icons

  const WMO = [
    [0, 'clear', 'sun'], [1, 'mostly clear', 'sun'], [2, 'partly cloudy', 'part'], [3, 'overcast', 'cloud'],
    [45, 'fog', 'fog'], [48, 'icy fog', 'fog'], [51, 'light drizzle', 'rain'], [53, 'drizzle', 'rain'], [55, 'heavy drizzle', 'rain'],
    [56, 'freezing drizzle', 'rain'], [57, 'freezing drizzle', 'rain'], [61, 'light rain', 'rain'], [63, 'rain', 'rain'],
    [65, 'heavy rain', 'rain'], [66, 'freezing rain', 'rain'], [67, 'freezing rain', 'rain'], [71, 'light snow', 'snow'],
    [73, 'snow', 'snow'], [75, 'heavy snow', 'snow'], [77, 'snow grains', 'snow'], [80, 'showers', 'rain'], [81, 'showers', 'rain'],
    [82, 'heavy showers', 'rain'], [85, 'snow showers', 'snow'], [86, 'snow showers', 'snow'], [95, 'thunderstorm', 'storm'],
    [96, 'thunderstorm with hail', 'storm'], [99, 'thunderstorm with hail', 'storm'],
  ];
  function wmo(code) {
    const c = Number(code);
    let best = WMO[0];
    for (const w of WMO) if (w[0] <= c) best = w;
    return { label: best[1], kind: best[2] };
  }

  /* 12x12 pixel icons, drawn as SVG rects */
  function icon(kind, night, label) {
    const R = [];
    const r = (x, y, w, h, c) => R.push([x, y, w, h, c]);
    const disc = (cx, cy, rad, c) => { for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rad * 0.6) r(cx + x, cy + y, 1, 1, c); };
    const cloud = (ox, oy, c) => { r(ox + 1, oy + 3, 9, 3, c); r(ox, oy + 4, 11, 2, c); r(ox + 2, oy + 1, 4, 3, c); r(ox + 5, oy, 4, 4, c); };
    if (kind === 'sun') {
      if (night) { disc(6, 6, 4, '#c9d3dc'); disc(8, 4, 3, 'cut'); }
      else { disc(6, 6, 3, '#e9b23c'); r(6, 0, 1, 2, '#e9b23c'); r(6, 11, 1, 1, '#e9b23c'); r(0, 6, 2, 1, '#e9b23c'); r(11, 6, 1, 1, '#e9b23c'); r(2, 2, 1, 1, '#e9b23c'); r(10, 2, 1, 1, '#e9b23c'); r(2, 10, 1, 1, '#e9b23c'); r(10, 10, 1, 1, '#e9b23c'); }
    } else if (kind === 'part') {
      if (night) { disc(4, 4, 3, '#c9d3dc'); disc(6, 3, 2, 'cut'); } else disc(4, 4, 3, '#e9b23c');
      cloud(1, 5, '#a9b4bf');
    } else if (kind === 'cloud') {
      cloud(0, 3, '#97a3af');
    } else if (kind === 'fog') {
      r(1, 3, 10, 1, '#97a3af'); r(0, 6, 9, 1, '#97a3af'); r(3, 9, 9, 1, '#97a3af');
    } else if (kind === 'rain' || kind === 'snow' || kind === 'storm') {
      cloud(0, 0, kind === 'storm' ? '#5d6875' : '#97a3af');
      if (kind === 'rain') { r(2, 8, 1, 2, '#4a8fc7'); r(5, 9, 1, 2, '#4a8fc7'); r(8, 8, 1, 2, '#4a8fc7'); }
      if (kind === 'snow') { r(2, 8, 1, 1, '#7d8b99'); r(5, 10, 1, 1, '#7d8b99'); r(8, 8, 1, 1, '#7d8b99'); r(10, 10, 1, 1, '#7d8b99'); }
      if (kind === 'storm') { r(6, 7, 2, 1, '#e9b23c'); r(5, 8, 2, 1, '#e9b23c'); r(4, 9, 3, 1, '#e9b23c'); r(5, 10, 1, 1, '#e9b23c'); }
    }
    // 'cut' pixels carve a crescent out of the moon
    const cut = new Set(R.filter((q) => q[4] === 'cut').map((q) => q[0] + ',' + q[1]));
    const svg = el('svg', { viewBox: '0 0 12 12', 'shape-rendering': 'crispEdges', role: 'img', 'aria-label': label || kind });
    R.forEach((q) => { if (q[4] && q[4] !== 'cut' && !cut.has(q[0] + ',' + q[1])) svg.appendChild(el('rect', { x: q[0], y: q[1], width: q[2], height: q[3], fill: q[4] })); });
    return svg;
  }

  const MOONS = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];
  const moonName = (ph) => MOONS[Math.floor(((Number(ph) || 0) + 1 / 16) % 1 * 8)];

  function feelWord(maxC) {
    if (maxC <= 3) return 'cold'; if (maxC <= 10) return 'chilly'; if (maxC <= 17) return 'cool';
    if (maxC <= 24) return 'mild'; if (maxC <= 30) return 'warm'; return 'hot';
  }
  function summary(hours, fahrenheit) {
    if (!hours.length) return '';
    let iPop = 0, iMax = 0;
    hours.forEach((h, i) => { if ((h.pop || 0) > (hours[iPop].pop || 0)) iPop = i; if (h.temp > hours[iMax].temp) iMax = i; });
    const pop = hours[iPop].pop || 0;
    const hh = (h) => fmt.pad(new Date(h.t).getHours()) + ':00';
    const span = hours.length >= 12 ? 'the next 12 hours' : 'the next hours';
    const wet = pop >= 60 ? 'Rain likely around ' + hh(hours[iPop]) : pop >= 30 ? 'A chance of rain around ' + hh(hours[iPop]) + ' (' + pop + '%)' : 'Dry for ' + span;
    const maxT = hours[iMax].temp;
    const c = fahrenheit ? (maxT - 32) * 5 / 9 : maxT;
    return wet + ', ' + feelWord(c) + ' at ' + Math.round(maxT) + '° around ' + hh(hours[iMax]) + '.';
  }

  /* temperature line for the next hours, with rain chance bars under it */
  function chart(hours) {
    const W = 640, H = 168, L = 18, Rr = 18, top = 28, bottom = 104;
    const n = hours.length;
    const xs = (i) => L + (n === 1 ? (W - L - Rr) / 2 : i * (W - L - Rr) / (n - 1));
    const temps = hours.map((h) => h.temp);
    let lo = Math.min.apply(null, temps), hi = Math.max.apply(null, temps);
    if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
    const ys = (t) => bottom - (t - lo) / (hi - lo) * (bottom - top);
    const svg = el('svg', { class: 'wn-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Temperature for the next hours: ' + hours.map((h) => fmt.pad(new Date(h.t).getHours()) + ':00 ' + Math.round(h.temp) + '°').join(', ') });
    const defs = el('defs', {}, el('linearGradient', { id: 'wn-fill', x1: '0', y1: '0', x2: '0', y2: '1' },
      el('stop', { offset: '0', 'stop-color': '#7ec2b0', 'stop-opacity': '0.45' }), el('stop', { offset: '1', 'stop-color': '#7ec2b0', 'stop-opacity': '0' })));
    svg.appendChild(defs);
    const pts = hours.map((h, i) => xs(i).toFixed(1) + ',' + ys(h.temp).toFixed(1));
    if (n > 1) {
      svg.appendChild(el('polygon', { points: xs(0) + ',' + bottom + ' ' + pts.join(' ') + ' ' + xs(n - 1) + ',' + bottom, fill: 'url(#wn-fill)' }));
      svg.appendChild(el('polyline', { points: pts.join(' '), fill: 'none', stroke: '#2e6e66', 'stroke-width': '2.5', 'stroke-linejoin': 'round' }));
    }
    const iMax = temps.indexOf(Math.max.apply(null, temps)), iMin = temps.indexOf(Math.min.apply(null, temps));
    const step = Math.max(1, Math.ceil(n / 13));
    hours.forEach((h, i) => {
      const x = xs(i), y = ys(h.temp);
      if (i === iMax || i === iMin || i === 0) {
        svg.appendChild(el('circle', { cx: x, cy: y, r: 3.5, fill: '#fffdf8', stroke: '#2e6e66', 'stroke-width': '2' }));
        svg.appendChild(el('text', { x, y: i === iMin && i !== iMax ? y + 18 : y - 9, 'text-anchor': 'middle', 'font-size': '13', fill: '#18171c' }, Math.round(h.temp) + '°'));
      }
      const pop = h.pop || 0;
      if (pop > 0) {
        const bh = Math.max(2, pop / 100 * 22);
        svg.appendChild(el('rect', { x: x - 7, y: 136 - bh, width: 14, height: bh, fill: '#4a8fc7', opacity: pop >= 30 ? '0.9' : '0.45' }));
        if (pop >= 20 && i % step === 0) svg.appendChild(el('text', { x, y: 136 - bh - 4, 'text-anchor': 'middle', 'font-size': '10', fill: '#2f6f9f' }, pop + '%'));
      }
      if (i % step === 0) svg.appendChild(el('text', { x, y: 156, 'text-anchor': 'middle', 'font-size': '11', fill: '#6c6873' }, i === 0 ? 'now' : fmt.pad(new Date(h.t).getHours())));
    });
    svg.appendChild(el('line', { x1: L - 8, x2: W - Rr + 8, y1: 137, y2: 137, stroke: '#e7e1d4', 'stroke-width': '1' }));
    return svg;
  }

  P.register('window', {
    title: 'Outside',
    size: 'l',
    tall: true,
    async render(ctx) {
      let settings = null;
      const box = { weather: el('div'), air: el('div'), cam: el('div') };

      const linkBtn = (text, url) => el('button', { class: 'cp-link', type: 'button', onclick: async (e) => {
        const r = await ctx.api('link', { method: 'POST', body: { url } });
        if (!r.ok && ctx.alive()) { e.target.textContent = text + ' (' + P.errorLine(r).toLowerCase().replace(/\.$/, '') + ')'; }
      } }, text);
      const credit = (o) => {
        if (!o || !o.credit) return null;
        const p = el('p', { class: 'wn-credit' });
        if (o.creditHref && /^https:/.test(o.creditHref)) p.appendChild(linkBtn(o.credit, o.creditHref)); else p.appendChild(document.createTextNode(o.credit));
        if (o.licence) {
          p.appendChild(document.createTextNode(' · '));
          if (o.licenceHref && /^https:/.test(o.licenceHref)) p.appendChild(linkBtn(o.licence, o.licenceHref)); else p.appendChild(document.createTextNode(o.licence));
        }
        if (o.notice) p.appendChild(el('span', { style: { display: 'block', marginTop: '3px' }, text: o.notice }));
        return p;
      };
      const offText = (reason, what) => (/no city/.test(reason || '')
        ? 'Choose your city in Settings > Casa > Weather to see ' + what + ' here.'
        : what.charAt(0).toUpperCase() + what.slice(1) + ' is turned off in Settings > Casa.');
      const errText = (r, what) => (r.kind === 'offline' && navigator.onLine === false
        ? 'You seem to be offline: ' + what + ' comes back when you are online.'
        : r.kind === 'notReady' ? what.charAt(0).toUpperCase() + what.slice(1) + ' isn’t available in this version yet.'
          : what.charAt(0).toUpperCase() + what.slice(1) + ' isn’t available right now.');
      const at = (s) => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? fmt.hm(d) : ''; };

      // ---------------------------------------------------------- weather + forecast
      async function weather() {
        const [w, f] = await Promise.all([ctx.api('weather'), ctx.api('forecast')]);
        if (!ctx.alive()) return;
        const out = ctx.clear(box.weather);
        if (!w.ok) {
          out.appendChild(el('section', { class: 'wn-sec' }, el('h3', { text: 'Today' }), el('p', { class: 'wn-err', text: errText(w, 'the weather') }),
            w.json && w.json.error ? el('p', { class: 'wn-mini', text: String(w.json.error) }) : null,
            el('div', { class: 'cp-row', style: { marginTop: '8px' } }, el('button', { class: 'cp-btn', type: 'button', onclick: weather }, 'Try again'))));
          ctx.setTitle('Outside');
          return;
        }
        const W = w.json;
        if (W.off) {
          ctx.setTitle('Outside');
          out.appendChild(el('section', { class: 'wn-sec' }, el('h3', { text: 'Today' }), el('p', { class: 'wn-off', text: offText(W.reason, 'the weather') })));
          return;
        }
        const u = W.units || {};
        const deg = '°';
        const fahrenheit = u.temp === '°F' || (settings && settings.units === 'imperial');
        const what = wmo(W.code);
        const where = W.where && W.where.name ? W.where.name : '';
        ctx.setTitle('Outside · ' + Math.round(W.temp) + deg + ' · ' + what.label);

        const F = f.ok && !f.json.off ? f.json : null;
        const now = Date.now();
        const hours = F && Array.isArray(F.hourly)
          ? F.hourly.filter((h) => h && typeof h.temp === 'number' && new Date(h.t).getTime() > now - 3600000).slice(0, 13) : [];

        const sec = el('section', { class: 'wn-sec', 'aria-label': 'Weather today' }, el('h3', {}, 'Today', where ? el('span', { text: ' · ' + where }) : null));
        const sum = summary(hours, fahrenheit);
        if (sum) sec.appendChild(el('p', { class: 'wn-sum', text: sum }));
        sec.appendChild(el('div', { class: 'wn-now' }, icon(what.kind, W.day === false, what.label),
          el('span', { class: 'big', text: Math.round(W.temp) + deg }),
          el('span', {}, el('span', { class: 'what', text: what.label }), el('br'),
            el('span', { class: 'where', text: W.stale ? 'last reading ' + (W.age_min || 0) + ' min ago' : (W.observed ? 'at ' + at(W.observed) : '') }))));
        const chips = el('div', { class: 'wn-chips' });
        const chip = (b, s) => chips.appendChild(el('div', { class: 'wn-chip' }, el('b', { text: b }), el('span', { text: s })));
        if (W.feels != null) chip(Math.round(W.feels) + deg, 'feels like');
        if (W.wind && typeof W.wind === 'object') {
          const sp = W.wind.speed != null ? W.wind.speed : W.wind.kmh;
          const unit = W.wind.unit || (W.wind.speed != null ? u.wind : 'km/h') || 'km/h';
          const gust = W.wind.gustSpeed != null ? W.wind.gustSpeed : W.wind.gust;
          chip(Math.round(sp) + ' ' + unit + (W.wind.dir ? ' ' + W.wind.dir : ''), gust != null ? 'gusts ' + Math.round(gust) : 'wind');
        } else if (typeof W.wind === 'number') chip(Math.round(W.wind) + ' ' + (u.wind || 'km/h'), 'wind');
        if (W.uv != null) chip(String(W.uv), 'UV' + (W.uv_band ? ' ' + W.uv_band : ''));
        if (W.hum != null) chip(W.hum + '%', 'humidity');
        if (W.press != null) chip(Math.round(W.press) + ' hPa', 'pressure');
        sec.appendChild(chips);
        if (hours.length > 1) sec.appendChild(chart(hours));
        else if (!f.ok) sec.appendChild(el('p', { class: 'wn-err', text: errText(f, 'the forecast') }));

        const sunLine = el('div', { class: 'wn-sun' });
        if (W.sun && W.sun.rise) sunLine.appendChild(el('span', { text: 'sunrise ' + W.sun.rise + ' · sunset ' + W.sun.set }));
        if (W.moon && W.moon.phase != null) sunLine.appendChild(el('span', { text: moonName(W.moon.phase) + (W.moon.illum != null ? ' ' + Math.round(W.moon.illum * 100) + '%' : '') }));
        if (sunLine.firstChild) sec.appendChild(sunLine);

        if (F && Array.isArray(F.daily) && F.daily.length) {
          const days = F.daily.slice(0, 5);
          const lo = Math.min.apply(null, days.map((d) => d.min)), hi = Math.max.apply(null, days.map((d) => d.max));
          const grid = el('div', { class: 'wn-days', role: 'list', 'aria-label': 'Next five days' });
          const todayIso = fmt.iso(new Date());
          days.forEach((d) => {
            const date = fmt.parseDay(d.date);
            const dw = wmo(d.code);
            const isToday = d.date === todayIso;
            const left = hi > lo ? (d.min - lo) / (hi - lo) * 100 : 0, right = hi > lo ? (hi - d.max) / (hi - lo) * 100 : 0;
            grid.appendChild(el('div', { class: 'wn-day' + (isToday ? ' today' : ''), role: 'listitem' },
              el('div', { class: 'dn', text: isToday ? 'Today' : (date ? fmt.DAYS[date.getDay()].slice(0, 3) : d.date) }),
              icon(dw.kind, false, dw.label),
              el('div', { class: 'rg', 'aria-hidden': 'true' }, el('i', { style: { left: left + '%', right: right + '%' } })),
              el('div', { class: 'mm' }, Math.round(d.min) + deg + ' ', el('b', { text: Math.round(d.max) + deg })),
              el('div', { class: 'lb' + (d.pop >= 30 ? ' wet' : '') , text: d.pop >= 20 && dw.kind !== 'rain' && dw.kind !== 'storm' && dw.kind !== 'snow' ? dw.label + ', rain ' + d.pop + '%' : dw.label + (d.pop >= 20 ? ' ' + d.pop + '%' : '') })));
          });
          sec.appendChild(grid);
        }
        // Open-Meteo's CC BY 4.0 licence needs the credit next to the data, even if the route left it out
        sec.appendChild(credit(W) || credit({ credit: 'Weather data by Open-Meteo.com', creditHref: 'https://open-meteo.com/' }));
        out.appendChild(sec);
      }

      // ---------------------------------------------------------- air
      const ST = ['ok', 'warn', 'orange', 'alert'];
      const stOf = (s) => (ST.indexOf(s) !== -1 ? s : 'ok');
      function aqiBlock(A) {
        const scale = A.scale === 'us' ? 'US AQI' : 'European AQI';
        const steps = A.scale === 'us' ? [50, 100, 150, 200, 300, 500] : [20, 40, 60, 80, 100, 120];
        const filled = steps.findIndex((s) => A.aqi < s);
        const lit = filled === -1 ? 6 : filled + 1;
        const frag = el('div');
        frag.appendChild(el('div', { class: 'wn-aqi' },
          el('span', { class: 'n st-' + stOf(A.st), text: String(Math.round(A.aqi)) }),
          el('span', {}, el('span', { class: 's', text: scale + (A.approx ? ' (approx.)' : '') }), el('br'), el('span', { class: 'b', text: A.band || '' }))));
        const bar = el('div', { class: 'wn-bar', role: 'img', 'aria-label': 'Index ' + Math.round(A.aqi) + ', ' + (A.band || '') });
        for (let i = 0; i < 6; i++) bar.appendChild(el('i', { class: i < lit ? 'bg-' + stOf(A.st) : '' }));
        frag.appendChild(bar);
        const unit = A.unit || 'µg/m³';
        const rows = [['PM2.5', A.pm25, unit], ['PM10', A.pm10, unit], ['O₃', A.o3, unit], ['NO₂', A.no2, unit],
          ['Temperature', A.temp, '°'], ['Humidity', A.hum, '%'], ['CO₂', A.co2, 'ppm']].filter((x) => x[1] != null);
        if (rows.length) frag.appendChild(el('table', { class: 'wn-pol' }, el('tbody', {}, rows.map((x) => el('tr', {}, el('td', { text: x[0] }), el('td', { text: x[1] + (x[2] === '°' || x[2] === '%' ? x[2] : ' ' + x[2]) }))))));
        return frag;
      }
      async function air() {
        const r = await ctx.api('air');
        if (!ctx.alive()) return;
        const out = ctx.clear(box.air);
        const sec = el('section', { class: 'wn-sec', 'aria-label': 'Air quality' });
        out.appendChild(sec);
        if (!r.ok) {
          sec.append(el('h3', { text: 'Air' }), el('p', { class: 'wn-err', text: errText(r, 'air quality') }),
            r.json && r.json.error ? el('p', { class: 'wn-mini', text: String(r.json.error) }) : null);
          return;
        }
        const A = r.json;
        if (A.off) { sec.append(el('h3', { text: 'Air' }), el('p', { class: 'wn-off', text: offText(A.reason, 'air quality') })); return; }
        const home = A.source === 'sensor';
        sec.appendChild(el('h3', {}, home ? 'Air at home' : 'Air outside', A.at ? el('span', { text: ' · ' + at(A.at) + (A.stale ? ', older reading' : '') }) : null));
        const grid = el('div', { class: 'wn-airgrid' });
        sec.appendChild(grid);
        if (typeof A.aqi === 'number') grid.appendChild(aqiBlock(A));
        if (A.outdoorError) grid.appendChild(el('p', { class: 'wn-mini', text: 'Outdoor data isn’t available right now.' }));
        if (A.sensor) {
          const S = A.sensor;
          const h = el('div', { class: 'wn-home' }, el('h4', { text: 'At home · your sensor' + (S.at ? ' · ' + at(S.at) : '') }));
          if (S.error) h.appendChild(el('p', { class: 'wn-err', text: 'Your sensor didn’t answer: ' + S.error }));
          else if (typeof S.aqi === 'number') h.appendChild(aqiBlock(S));
          grid.appendChild(h);
        }
        const c = credit(A);
        if (c) sec.appendChild(c);
      }

      // ---------------------------------------------------------- webcam
      async function cam() {
        const r = await ctx.api('webcam');
        if (!ctx.alive()) return;
        const out = ctx.clear(box.cam);
        box.cam.classList.remove('wn-full');
        const sec = el('section', { class: 'wn-sec', 'aria-label': 'Webcam' }, el('h3', { text: 'Webcam' }));
        out.appendChild(sec);
        const C = r.json || {};
        // the credit is a visible link to the source page, next to the picture (or the error)
        const camCredit = () => {
          const p = el('p', { class: 'wn-credit' });
          if (C.href && /^https:/.test(C.href)) p.appendChild(linkBtn(C.credit || 'Source', C.href));
          else if (C.credit) p.appendChild(document.createTextNode(C.credit));
          [C.licence, C.terms].forEach((x) => {
            if (typeof x !== 'string' || !x) return;
            p.appendChild(document.createTextNode(' \u00b7 '));
            if (/^https:\/\//.test(x)) p.appendChild(linkBtn('Terms', x)); else p.appendChild(document.createTextNode(x));
          });
          return p.firstChild ? p : null;
        };
        if (!r.ok) {
          sec.append(el('p', { class: 'wn-err', text: errText(r, 'the webcam') }), C.error ? el('p', { class: 'wn-mini', text: String(C.error) }) : null,
            el('div', { class: 'cp-row', style: { marginTop: '8px' } }, el('button', { class: 'cp-btn', type: 'button', onclick: cam }, 'Try again')), camCredit());
          return;
        }
        if (C.off) { sec.appendChild(el('p', { class: 'wn-off', text: /off/.test(C.reason || '') ? 'The webcam is turned off in Settings > Casa.' : 'No webcam yet.' })); return; }
        if (!/^data:image\//.test(C.src || '')) { sec.appendChild(el('p', { class: 'wn-off', text: 'No webcam image yet.' })); return; }
        // a panorama (the default BuoyCAM is six views side by side, 2880x300) gets the full
        // width and scrolls sideways on narrow screens
        const wide = Number(C.w) > 0 && Number(C.h) > 0 && C.w / C.h > 2.5;
        if (wide) box.cam.classList.add('wn-full');
        if (box.cam.parentNode) box.cam.parentNode.classList.toggle('cam-wide', wide);
        const views = Number(C.frames) > 1 ? C.frames + ' views' : '';
        const when = [C.name || '', views, C.at ? 'taken ' + at(C.at) : '', C.stale ? 'older image' : ''].filter(Boolean).join(' \u00b7 ');
        sec.appendChild(el('figure', { class: 'wn-cam' + (wide ? ' wide' : '') },
          el('div', { class: 'wn-strip', tabIndex: wide ? 0 : -1, 'aria-label': wide ? 'Webcam strip, scroll sideways' : null },
            el('img', { src: C.src, alt: 'Webcam view' + (C.credit ? ': ' + C.credit : ''), decoding: 'async' })),
          el('figcaption', {}, when ? el('span', { text: when + (C.source === 'default' ? ' \u00b7 dark at night' : '') }) : null)));
        const c = camCredit();
        if (c) sec.appendChild(c);
      }

      // ---------------------------------------------------------- your own webcam / sensor
      /* Links to fetch are set only in the plugin's settings tab (CONTRACT, Security):
         this opens it, and says where it is if the plugin cannot open it. */
      function sources() {
        const status = el('span', { class: 'cp-small cp-muted', role: 'status', 'aria-live': 'polite' });
        const btn = el('button', { class: 'cp-link cp-small', type: 'button' }, 'Use another webcam or your own air sensor');
        btn.addEventListener('click', async () => {
          status.textContent = '';
          const r = await ctx.api('open-settings', { method: 'POST', body: { section: 'window' } });
          if (!ctx.alive()) return;
          status.textContent = r.ok ? ' Opened Casa settings: see Window and air.'
            : ' In Obsidian, open Settings > Casa > Window and air.';
        });
        return el('p', { class: 'wn-more' }, btn, status);
      }

      // ---------------------------------------------------------- layout
      const refresh = el('button', { class: 'cp-icon', type: 'button', 'aria-label': 'Refresh', title: 'Refresh', onclick: () => loadAll() }, '↻');
      ctx.tools.appendChild(refresh);

      async function loadAll() {
        const s = await ctx.api('settings');
        if (!ctx.alive()) return;
        if (s.ok) settings = s.json;
        await Promise.all([weather(), air(), cam()]);
      }

      const s0 = await ctx.api('settings');
      if (!ctx.alive()) return;
      if (s0.ok) settings = s0.json;
      await Promise.all([weather(), air(), cam()]);
      if (!ctx.alive()) return;
      ctx.clear(ctx.body);
      ctx.body.append(box.weather, el('div', { class: 'wn-two' + (box.cam.classList.contains('wn-full') ? ' cam-wide' : '') }, box.air, box.cam), sources());

      ctx.onData(['weather', 'settings'], () => loadAll());
      // the plugin caches each source; a long-open panel refreshes now and then
      ctx.loop('refresh', 15 * 60 * 1000, loadAll);
    },
  });
})();
