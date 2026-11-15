/* Panel: the mug on the desk opens today's daily note, read only, in a paper card.
   Text goes into the DOM with textContent only; "Open in Obsidian" opens the note itself. */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el } = P;

  P.css(`
.td-date{margin:0 0 12px;font:700 13px/1.2 var(--cp-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--cp-muted)}
.td-page{max-height:min(52vh,460px);overflow:auto;margin:0 0 16px;padding:14px 16px;background:var(--cp-paper);border:2px solid var(--cp-navy);
  font:15px/1.5 var(--cp-sans);color:var(--cp-ink)}
.td-page h3{margin:4px 0 8px;font:700 18px/1.25 var(--cp-sans)}
.td-page h4{margin:14px 0 6px;font:700 12px/1.2 var(--cp-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--cp-muted)}
.td-page p{margin:0 0 4px;white-space:pre-wrap;overflow-wrap:anywhere}
.td-page .td-task{display:flex;gap:8px}
.td-page .td-task.done{color:var(--cp-muted);text-decoration:line-through}
.td-empty{margin:0 0 16px;font:15px/1.45 var(--cp-sans);color:var(--cp-ink)}
.td-status{margin:10px 0 0;font-size:13px;color:var(--cp-muted)}
`);

  function lineEl(raw) {
    const s = raw.replace(/\s+$/, '');
    let m;
    if ((m = /^#\s+(.*)/.exec(s))) return el('h3', { text: m[1] });
    if ((m = /^#{2,6}\s+(.*)/.exec(s))) return el('h4', { text: m[1] });
    if ((m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)/.exec(s))) {
      const done = m[1] !== ' ';
      return el('p', { class: 'td-task' + (done ? ' done' : '') }, el('span', { 'aria-hidden': 'true', text: done ? '☑' : '☐' }), el('span', { text: m[2] }));
    }
    return el('p', { text: s || ' ' });
  }

  P.register('today', {
    title: "Today's note",
    size: 'm',
    async render(ctx) {
      const draw = async () => {
        const r = await ctx.api('today');
        if (!ctx.alive()) return;
        ctx.clear(ctx.body);
        if (!r.ok) { ctx.body.append(el('p', { class: 'td-empty', text: P.errorLine(r, "Could not read today's note") })); return; }
        const j = r.json || {};
        const d = j.date ? new Date(j.date + 'T12:00:00') : new Date();
        ctx.body.append(el('p', { class: 'td-date', text: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) }));
        if (!j.exists) {
          ctx.body.append(el('p', { class: 'td-empty', text: 'No note for today yet. Write a goal on the sign or add a task in the agenda, and Casa creates it.' }));
          return;
        }
        const lines = String(j.text || '').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        const page = el('div', { class: 'td-page' });
        lines.forEach((l) => page.appendChild(lineEl(l)));
        const status = el('p', { class: 'td-status', role: 'status', 'aria-live': 'polite' });
        const open = el('button', { class: 'cp-btn cp-primary', type: 'button', dataset: { autofocus: '' } }, 'Open in Obsidian');
        open.addEventListener('click', async () => {
          const o = await ctx.api('open', { method: 'POST', body: { path: j.path } });
          if (ctx.alive() && !o.ok) status.textContent = P.errorLine(o, 'Could not open the note');
        });
        ctx.body.append(page, open, status);
      };
      await draw();
      ctx.onData(['focus', 'tasks'], draw);
    },
  });
})();
