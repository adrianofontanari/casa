/* Panel: the put-away box on the floor. It lists the objects put away from their panels
   ("Put away") and brings them back, one by one or all together (window.CasaRoomItems, room.js). */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el } = P;

  P.css(`
.bx-intro,.bx-empty{margin:0 0 12px;font:15px/1.45 var(--cp-sans);color:var(--cp-ink)}
.bx-list{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:8px}
.bx-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;background:var(--cp-paper);border:2px solid var(--cp-navy)}
.bx-list span{font:600 15px/1.3 var(--cp-sans);color:var(--cp-ink)}
`);

  P.register('box', {
    title: 'Put-away box',
    size: 's',
    render(ctx) {
      const R = window.CasaRoomItems;
      const draw = () => {
        if (!ctx.alive()) return;
        ctx.clear(ctx.body);
        const ids = R ? R.hidden() : [];
        if (!ids.length) {
          ctx.body.append(el('p', { class: 'bx-empty', text: 'The box is empty. Every object in the room has "Put away" in its panel.' }));
          return;
        }
        ctx.body.append(el('p', { class: 'bx-intro', text: 'What you put away. Bring back what you miss.' }));
        const list = el('ul', { class: 'bx-list' });
        ids.forEach((id) => {
          const b = el('button', { class: 'cp-btn', type: 'button' }, 'Bring back');
          b.addEventListener('click', () => { R.show(id); if (R.hidden().length) draw(); else ctx.close(); });
          list.appendChild(el('li', {}, el('span', { text: R.names[id] || id }), b));
        });
        const all = el('button', { class: 'cp-btn cp-primary', type: 'button', dataset: { autofocus: '' } }, 'Bring back everything');
        all.addEventListener('click', () => { R.showAll(); ctx.close(); });
        ctx.body.append(list, all);
      };
      draw();
    },
  });
})();
