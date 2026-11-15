/* Panel: the buddy. One friendly line for the time of day, and a switch to hide it
   (settings.buddy, one of the keys the room may write) or show it again. */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el } = P;

  P.css(`
.bd-line{position:relative;margin:4px 0 18px;padding:14px 16px;background:var(--cp-oatL);border:2px solid var(--cp-navy);
  font:500 17px/1.4 var(--cp-sans);color:var(--cp-navy)}
.bd-line::after{content:"";position:absolute;left:24px;bottom:-8px;width:12px;height:12px;background:var(--cp-oatL);
  border-right:2px solid var(--cp-navy);border-bottom:2px solid var(--cp-navy);transform:rotate(45deg)}
.bd-foot{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:8px}
.bd-status{margin:12px 0 0;font-size:13px;color:var(--cp-muted)}
`);

  const LINES = {
    morning: ['Good morning! One small thing first, then the rest.', 'Morning. The room is warm and the desk is clear.', 'Hi! I saved you the sunny spot.'],
    midday: ['Lunch soon? I will keep your seat.', 'Halfway through the day. Water is a good idea.', 'Still here, still cheering.'],
    afternoon: ['The afternoon light is the nicest in here.', 'Need a stretch? I will watch the desk.', 'Tea, then the next small step?'],
    evening: ['Evening. Whatever got done today counts.', 'The lamp is on. Take your time.', 'Nice work today. The room says so too.'],
    night: ['It is late. I am keeping you company.', 'Quiet hours. The room is all yours.', 'The stars are out. So am I, sort of.'],
  };
  function line(d) {
    const h = d.getHours();
    const k = h >= 5 && h < 11 ? 'morning' : h < 14 && h >= 11 ? 'midday' : h >= 14 && h < 18 ? 'afternoon' : h >= 18 && h < 22 ? 'evening' : 'night';
    const list = LINES[k];
    return list[(d.getDate() + h) % list.length];
  }

  // Pebble: a line for the time of day. "Put away" in the title bar hides Pebble (the "buddy" setting);
  // the box on the floor, or Settings > Casa > Show buddy, brings Pebble back.
  P.register('buddy', {
    title: 'Pebble',
    size: 's',
    render(ctx) {
      ctx.clear(ctx.body);
      ctx.body.append(
        el('p', { class: 'bd-line', text: line(new Date()) }),
        el('p', { class: 'cp-small cp-muted', text: 'Before a screen share: Put away, above. The box on the floor brings Pebble back.' }));
    },
  });

  // Biscuit, the dog: a click makes it wag (room.js) and opens this little card
  P.register('pet', {
    title: 'Biscuit',
    size: 's',
    render(ctx) {
      const h = new Date().getHours();
      const what = h >= 22 || h < 7 ? 'Biscuit is asleep on the rug. Now and then it gets up for a short stroll, then back to bed.'
        : 'Biscuit naps on the rug and goes for a walk around the room now and then.';
      ctx.clear(ctx.body);
      ctx.body.append(el('p', { class: 'bd-line', text: what }),
        el('p', { class: 'cp-small cp-muted', text: 'Put away, above, sends Biscuit to the box on the floor.' }));
    },
  });
})();
