/* Panel: the wall calendar. Today's events on the side, the week as a time grid.
   Read-only: Casa never writes to a calendar. Data: GET /api/calendar?from&to
   (from = Monday, to = the Monday after, both YYYY-MM-DD, `to` exclusive). */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el, fmt } = P;
  const HOUR = 40;   // px per hour in the grid

  P.css(`
.cp-calendar .cp-body{padding:0;display:flex}
.cal{flex:1;min-height:0;display:grid;grid-template-columns:220px minmax(0,1fr);width:100%}
.cal-side{min-width:0;overflow:auto;padding:16px 16px 20px;border-right:4px solid var(--cp-navy);background:var(--cp-oatL)}
.cal-side h3{margin:0 0 2px;font:650 17px/1.3 var(--cp-sans);color:var(--cp-navy)}
.cal-side .sub{margin:0 0 12px;font:12px/1.3 var(--cp-mono);color:var(--cp-muted)}
.cal-today{list-style:none;margin:0 0 18px;padding:0}
.cal-today li{display:grid;grid-template-columns:10px minmax(0,1fr);gap:4px 8px;padding:6px 0;border-bottom:1px dashed var(--cp-line)}
.cal-today .dot{width:10px;height:10px;margin-top:4px}
.cal-today .t{font:12px/1.2 var(--cp-mono);color:var(--cp-muted);grid-column:2}
.cal-today .n{grid-column:2;font-size:14px;overflow-wrap:anywhere}
.cal-today li.past{opacity:.5}
.cal-today li.next{background:var(--cp-mustardL);margin:0 -6px;padding:6px;box-shadow:3px 3px 0 var(--cp-mustard)}
.cal-cals{list-style:none;margin:0;padding:0}
.cal-cals li{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:13px}
.cal-cals .sq{width:12px;height:12px;flex:none}
.cal-cals .ro{margin-left:auto;font:11px/1 var(--cp-mono);color:var(--cp-faint)}
.cal-main{min-width:0;display:flex;flex-direction:column;min-height:0}
.cal-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:2px solid var(--cp-line);flex:none}
.cal-bar h3{margin:0 0 0 6px;font:650 18px/1.2 var(--cp-sans);color:var(--cp-navy)}
.cal-bar .wk{font:12px/1 var(--cp-mono);color:var(--cp-muted)}
.cal-nav{min-width:32px;padding:5px 8px}
.cal-notice{margin:10px 14px 0}
.cal-scroll{flex:1;min-height:0;overflow:auto}
.cal-grid{display:grid;grid-template-columns:44px repeat(7,minmax(0,1fr));min-width:0}
.cal-dh{position:sticky;top:0;z-index:3;background:var(--cp-navy);padding:7px 4px 6px;text-align:center;border-left:1px solid #33467a}
.cal-dh .w{display:block;font:600 10px/1 var(--cp-mono);letter-spacing:.12em;color:var(--cp-mint)}
.cal-dh .d{display:inline-grid;place-items:center;width:32px;height:30px;margin-top:3px;font:700 18px/1 var(--cp-mono);color:var(--cp-yellow)}
.cal-dh.today .d{background:var(--cp-yellow);color:var(--cp-navy);box-shadow:2px 2px 0 #11192f}
.cal-corner{position:sticky;top:0;z-index:3;background:var(--cp-navy)}
.cal-ad{min-height:6px;padding:2px;border-bottom:1px solid var(--cp-line);border-left:1px solid var(--cp-line)}
.cal-adl{font:10px/1 var(--cp-mono);color:var(--cp-faint);padding:6px 4px 0;text-align:right;border-bottom:1px solid var(--cp-line)}
.cal-chip{display:block;margin:2px 0;padding:2px 5px;font-size:11px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:3px solid}
.cal-hours{position:relative}
.cal-hours span{position:absolute;right:6px;transform:translateY(-50%);font:10px/1 var(--cp-mono);color:var(--cp-faint)}
.cal-col{position:relative;border-left:1px solid var(--cp-line);
  background-image:linear-gradient(var(--cp-line) 1px,transparent 1px);background-size:100% ${HOUR}px}
.cal-col.today{background-color:rgba(246,201,62,.12)}
.cal-ev{position:absolute;overflow:hidden;padding:2px 5px;font-size:11px;line-height:1.25;border-left:3px solid;color:var(--cp-ink)}
.cal-ev b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cal-ev i{font:10px/1.2 var(--cp-mono);font-style:normal;color:var(--cp-muted)}
.cal-now{position:absolute;left:-1px;right:0;height:2px;background:var(--cp-accent);z-index:2}
.cal-now::before{content:"";position:absolute;left:-4px;top:-3px;width:8px;height:8px;border-radius:50%;background:var(--cp-accent)}
.cal-help{max-width:560px;margin:0 auto;padding:28px 20px;text-align:left}
.cal-help h3{margin:0 0 8px;font:650 18px/1.3 var(--cp-sans);color:var(--cp-navy)}
.cal-help p{margin:0 0 10px;color:var(--cp-muted)}
.cal-help ol{margin:0 0 12px;padding-left:20px}
.cal-help li{margin:0 0 8px}
.cal-help ul{margin:6px 0 0;padding-left:18px;color:var(--cp-muted);font-size:13px}
.cal-help code{font:12px var(--cp-mono);background:var(--cp-wash);padding:1px 4px}
@media (max-width:860px){
  .cal{grid-template-columns:minmax(0,1fr)}
  .cal-side{border-right:0;border-bottom:2px solid var(--cp-line);max-height:none}
  .cp-calendar .cp-body{display:block;overflow:auto}
  .cal-main,.cal-scroll{min-height:auto;overflow:visible}
  .cal-dh{position:static}.cal-corner{position:static}
  .cal-today{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0 12px}
}
`);

  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return 'rgba(63,108,176,' + a + ')';
    const n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  const colourOf = (ev) => (/^#[0-9a-f]{6}$/i.test(ev.color || '') ? ev.color : '#3f6cb0');
  function monday(d) { const x = fmt.dayStart(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }

  function normalise(events) {
    const out = [];
    (events || []).forEach((e) => {
      const s = fmt.parse(e.start);
      if (!s) return;
      let en = fmt.parse(e.end);
      const allDay = !!e.allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(e.start));
      if (!en || en < s) en = allDay ? fmt.addDays(fmt.dayStart(s), 1) : new Date(s.getTime() + 30 * 60000);
      if (allDay && +en === +s) en = fmt.addDays(s, 1);
      out.push({ title: String(e.title || '(no title)'), start: s, end: en, allDay, cal: e.cal || '', color: colourOf(e) });
    });
    return out.sort((a, b) => a.start - b.start);
  }

  /* side-by-side columns for events that overlap within one day */
  function lanes(list) {
    const placed = [];
    let group = [], groupEnd = 0;
    const flush = () => {
      const ends = [];
      group.forEach((p) => {
        let i = ends.findIndex((t) => t <= p.a);
        if (i === -1) { i = ends.length; ends.push(0); }
        ends[i] = p.b; p.lane = i;
      });
      group.forEach((p) => { p.lanes = ends.length; placed.push(p); });
      group = [];
    };
    list.forEach((p) => {
      if (group.length && p.a >= groupEnd) flush();
      group.push(p);
      groupEnd = Math.max(groupEnd, p.b);
    });
    if (group.length) flush();
    return placed;
  }

  P.register('calendar', {
    title: 'Calendar',
    size: 'xl',
    tall: true,
    async render(ctx) {
      let week = monday(new Date());
      let settings = null;
      let nowLoop = null;

      async function show() {
        const from = fmt.iso(week), to = fmt.iso(fmt.addDays(week, 7));
        const [r, s] = await Promise.all([ctx.api('calendar', { query: { from, to } }), settings ? Promise.resolve(null) : ctx.api('settings')]);
        if (!ctx.alive()) return;
        if (s && s.ok) settings = s.json;
        if (!r.ok) { ctx.fail(ctx.body, r, show, 'The calendar'); return; }
        const data = r.json;
        const events = normalise(data.events);
        const cals = Array.isArray(data.cals) ? data.cals : [];
        const connected = !!(settings && settings.calendarUrl) || cals.length > 0 || events.length > 0;
        if (!connected && !data.error) { help(); return; }
        draw(events, cals, data.error);
      }

      function help() {
        ctx.clear(ctx.body);
        const steps = el('ol', {},
          el('li', {}, 'Copy your calendar’s private ICS link.',
            el('ul', {},
              el('li', {}, el('strong', { text: 'Google: ' }), 'Calendar settings > your calendar > Integrate calendar > Secret address in iCal format.'),
              el('li', {}, el('strong', { text: 'Outlook: ' }), 'Settings > Calendar > Shared calendars > Publish a calendar > copy the ICS link.'),
              el('li', {}, el('strong', { text: 'iCloud: ' }), 'Calendar app > share the calendar > Public Calendar > copy the link.'))),
          el('li', {}, 'In Obsidian, open ', el('strong', { text: 'Settings > Casa > Calendar' }), ' and paste it into ', el('code', { text: 'Calendar link (ICS)' }), '.'),
          el('li', {}, 'Come back here: your week appears in a few seconds.'));
        ctx.body.appendChild(el('div', { class: 'cal-help', role: 'region', 'aria-label': 'How to add a calendar' },
          el('h3', { text: 'No calendar yet' }),
          el('p', { text: 'Casa can show your week from any calendar that gives you an ICS link. It only reads it: nothing is ever written to your calendar.' }),
          steps,
          el('p', { class: 'cp-small', text: 'Keep the link private: anyone with it can read your calendar. Casa stores it only in this vault’s plugin data.' }),
          el('div', { class: 'cp-row' },
            el('button', { class: 'cp-btn cp-primary', type: 'button', onclick: async (e) => {
              const r = await ctx.api('open-settings', { method: 'POST', body: { section: 'calendar' } });
              if (ctx.alive() && !r.ok) e.target.textContent = 'Open it from Obsidian\u2019s Settings';
            } }, 'Open Casa settings'),
            el('button', { class: 'cp-btn', type: 'button', onclick: () => { ctx.loading(ctx.body); settings = null; show(); } }, 'Check again'))));
      }

      function draw(events, cals, error) {
        const now = new Date();
        const todayIso = fmt.iso(now);
        const days = [0, 1, 2, 3, 4, 5, 6].map((i) => fmt.addDays(week, i));
        const timed = events.filter((e) => !e.allDay);
        const allDay = events.filter((e) => e.allDay);

        // hour range: 8-20 at least, stretched to fit this week's events
        let h0 = 8, h1 = 20;
        timed.forEach((e) => {
          if (e.start >= fmt.addDays(week, 7) || e.end <= week) return;
          h0 = Math.min(h0, e.start.getHours());
          h1 = Math.max(h1, Math.min(24, e.end.getHours() + (e.end.getMinutes() ? 1 : 0) || 24));
        });
        h0 = Math.max(0, h0); h1 = Math.min(24, Math.max(h1, h0 + 4));
        const H = (h1 - h0) * HOUR;

        // side: today
        const todays = events.filter((e) => (e.allDay ? e.start <= fmt.dayStart(now) && e.end > fmt.dayStart(now) : fmt.iso(e.start) === todayIso));
        const next = todays.find((e) => !e.allDay && e.end > now);
        const side = el('aside', { class: 'cal-side', 'aria-label': 'Today' },
          el('h3', { text: 'Today' }), el('p', { class: 'sub', text: fmt.longDate(now) }));
        if (todays.length) {
          const ul = el('ul', { class: 'cal-today' });
          todays.forEach((e) => {
            const past = !e.allDay && e.end <= now;
            ul.appendChild(el('li', { class: (past ? 'past' : '') + (e === next ? ' next' : '') },
              el('span', { class: 'dot', style: { background: e.color }, 'aria-hidden': 'true' }),
              el('span', { class: 't', text: e.allDay ? 'all day' : fmt.hm(e.start) + ' – ' + fmt.hm(e.end) + (e === next ? ' · next' : '') }),
              el('span', { class: 'n', text: e.title })));
          });
          side.appendChild(ul);
        } else {
          side.appendChild(el('p', { class: 'cp-muted', style: { margin: '0 0 18px', fontSize: '13px' }, text: 'Nothing on the calendar today.' }));
        }
        if (cals.length) {
          side.appendChild(el('h4', { class: 'cp-label', text: 'Calendars' }));
          side.appendChild(el('ul', { class: 'cal-cals' }, cals.map((c) => el('li', {},
            el('span', { class: 'sq', style: { background: colourOf(c) }, 'aria-hidden': 'true' }),
            el('span', { text: c.name || 'Calendar' }), el('span', { class: 'ro', text: c.error ? 'not loaded' : 'read only' })))));
        }

        // bar
        const isThisWeek = fmt.iso(week) === fmt.iso(monday(now));
        const mid = fmt.addDays(week, 3);
        const bar = el('div', { class: 'cal-bar' },
          el('button', { class: 'cp-btn', type: 'button', disabled: isThisWeek, onclick: () => { week = monday(new Date()); show(); } }, 'Today'),
          el('button', { class: 'cp-btn cal-nav', type: 'button', 'aria-label': 'Previous week', onclick: () => { week = fmt.addDays(week, -7); show(); }, dataset: { k: 'prev' } }, '‹'),
          el('button', { class: 'cp-btn cal-nav', type: 'button', 'aria-label': 'Next week', onclick: () => { week = fmt.addDays(week, 7); show(); }, dataset: { k: 'next' } }, '›'),
          el('h3', { 'aria-live': 'polite', text: fmt.MONTHS[mid.getMonth()] + ' ' + mid.getFullYear() }),
          el('span', { class: 'wk', text: fmt.short(days[0]) + ' – ' + fmt.short(days[6]) }));

        // grid
        const grid = el('div', { class: 'cal-grid', role: 'group', 'aria-label': 'Week' });
        grid.appendChild(el('div', { class: 'cal-corner' }));
        days.forEach((d) => grid.appendChild(el('div', { class: 'cal-dh' + (fmt.iso(d) === todayIso ? ' today' : '') },
          el('span', { class: 'w', text: fmt.DAYS[d.getDay()].slice(0, 3).toUpperCase() }), el('span', { class: 'd', text: String(d.getDate()) }))));
        if (allDay.length) {
          grid.appendChild(el('div', { class: 'cal-adl', text: 'all day' }));
          days.forEach((d) => {
            const cell = el('div', { class: 'cal-ad' });
            const d0 = fmt.dayStart(d), d1 = fmt.addDays(d0, 1);
            allDay.filter((e) => e.start < d1 && e.end > d0).forEach((e) => cell.appendChild(el('span', {
              class: 'cal-chip', style: { background: rgba(e.color, 0.16), borderColor: e.color }, title: e.title, text: e.title })));
            grid.appendChild(cell);
          });
        }
        const hours = el('div', { class: 'cal-hours', style: { height: H + 'px' }, 'aria-hidden': 'true' });
        for (let h = h0 + 1; h < h1; h++) hours.appendChild(el('span', { style: { top: (h - h0) * HOUR + 'px' }, text: fmt.pad(h) + ':00' }));
        grid.appendChild(hours);
        let nowLine = null;
        days.forEach((d) => {
          const d0 = fmt.dayStart(d), d1 = fmt.addDays(d0, 1);
          const isToday = fmt.iso(d) === todayIso;
          const col = el('div', { class: 'cal-col' + (isToday ? ' today' : ''), style: { height: H + 'px' }, role: 'group', 'aria-label': fmt.longDate(d) });
          const top0 = d0.getTime() + h0 * 3600000;
          const items = timed.filter((e) => e.start < d1 && e.end > d0).map((e) => {
            const a = Math.max(e.start.getTime(), top0), b = Math.min(e.end.getTime(), d0.getTime() + h1 * 3600000);
            return { e, a, b: Math.max(b, a + 15 * 60000) };
          }).filter((p) => p.b > top0);
          lanes(items).forEach((p) => {
            const top = (p.a - top0) / 3600000 * HOUR;
            const h = Math.max(18, (p.b - p.a) / 3600000 * HOUR - 2);
            const w = 100 / p.lanes;
            col.appendChild(el('div', {
              class: 'cal-ev', title: p.e.title + ', ' + fmt.hm(p.e.start) + ' – ' + fmt.hm(p.e.end) + (p.e.cal ? ' (' + p.e.cal + ')' : ''),
              style: { top: top + 'px', height: h + 'px', left: 'calc(' + (p.lane * w) + '% + 2px)', width: 'calc(' + w + '% - 4px)', background: rgba(p.e.color, 0.16), borderColor: p.e.color },
            }, el('b', { text: p.e.title }), h > 30 ? el('i', { text: fmt.hm(p.e.start) + ' – ' + fmt.hm(p.e.end) }) : null));
          });
          if (isToday) { nowLine = el('div', { class: 'cal-now', 'aria-hidden': 'true' }); col.appendChild(nowLine); }
          grid.appendChild(col);
        });
        const place = () => {
          if (!nowLine) return;
          const t = new Date();
          const y = (t.getHours() + t.getMinutes() / 60 - h0) * HOUR;
          nowLine.style.display = y < 0 || y > H ? 'none' : '';
          nowLine.style.top = y + 'px';
        };
        place();
        if (nowLoop) nowLoop.stop();
        nowLoop = nowLine ? ctx.loop('now', 60000, place) : null;

        const scroll = el('div', { class: 'cal-scroll' }, grid);
        const main = el('div', { class: 'cal-main' }, bar,
          error ? el('p', { class: 'cp-notice cal-notice', role: 'alert', text: 'Some events could not be read: ' + String(error) }) : null,
          !events.length ? el('p', { class: 'cp-small cp-muted', style: { margin: '10px 14px 0' }, text: 'Nothing on the calendar this week.' }) : null,
          scroll);
        const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
        ctx.clear(ctx.body);
        ctx.body.appendChild(el('div', { class: 'cal' }, side, main));
        if (active) { const b = ctx.body.querySelector('[data-k="' + active + '"]'); if (b) b.focus(); }
        // start the grid near the current hour (or the first event)
        const first = timed.find((e) => e.start >= week);
        const hourNow = isThisWeek ? now.getHours() - 1 : (first ? first.start.getHours() - 1 : h0);
        scroll.scrollTop = Math.max(0, (hourNow - h0) * HOUR);
      }

      ctx.onData(['settings', 'calendar'], () => { settings = null; show(); });
      await show();
    },
  });
})();
