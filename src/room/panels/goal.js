/* Panel: today's goal. One field; Enter saves it to today's note (POST /api/focus). */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el, fmt } = P;

  P.css(`
.cp-goal .cp-body{padding-top:18px}
.goal-date{margin:0 0 14px;font:500 13px/1.3 var(--cp-mono);color:var(--cp-muted)}
.goal-input{font:500 20px/1.3 var(--cp-serif);min-height:48px;padding:10px 12px}
.goal-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:14px}
.goal-status{min-height:1.4em;font-size:13px;color:var(--cp-muted)}
.goal-status.ok{color:var(--cp-ok)}.goal-status.err{color:var(--cp-accent)}
`);

  P.register('goal', {
    title: "Today's goal",
    size: 's',
    async render(ctx) {
      const res = await ctx.api('focus');
      if (!ctx.alive()) return;
      if (!res.ok) { ctx.fail(ctx.body, res, () => this.render(ctx)); return; }
      let data = res.json;
      const day = fmt.parseDay(data.date) || new Date();

      const input = el('input', {
        class: 'cp-input goal-input', type: 'text', maxLength: 200, value: data.focus || '',
        placeholder: 'One thing that would make today good', 'aria-label': "Today's goal",
        'aria-describedby': 'goal-hint', autocomplete: 'off', spellcheck: true, dataset: { autofocus: '' },
      });
      const status = el('div', { class: 'goal-status', role: 'status', 'aria-live': 'polite' });
      const save = el('button', { class: 'cp-btn cp-primary', type: 'button' }, 'Save');
      const openNote = el('button', { class: 'cp-link cp-small', type: 'button', hidden: !(data.exists && data.path) }, "Open today's note");
      let busy = false;

      async function commit() {
        if (busy) return;
        busy = true; save.disabled = true;
        status.className = 'goal-status'; status.textContent = 'Saving';
        const r = await ctx.api('focus', { method: 'POST', body: { focus: input.value.trim() } });
        busy = false; save.disabled = false;
        if (!ctx.alive()) return;
        if (!r.ok) {
          status.className = 'goal-status err';
          status.textContent = P.errorLine(r, 'Not saved');
          return;
        }
        data = Object.assign({}, data, r.json);
        openNote.hidden = !(data.exists && data.path);
        status.className = 'goal-status ok';
        status.textContent = input.value.trim() ? 'Saved in today’s note.' : 'Goal cleared.';
        ctx.emit('focus');
        // the room shows the new goal; close a moment later so the confirmation is seen
        setTimeout(() => ctx.close(), 650);
      }

      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commit(); } });
      save.addEventListener('click', commit);
      openNote.addEventListener('click', async () => {
        const r = await ctx.api('open', { method: 'POST', body: { path: data.path } });
        if (ctx.alive() && !r.ok) { status.className = 'goal-status err'; status.textContent = P.errorLine(r, 'Could not open the note'); }
      });

      ctx.clear(ctx.body);
      ctx.body.append(
        el('p', { class: 'goal-date', text: fmt.longDate(day) }),
        input,
        el('div', { class: 'goal-foot' },
          el('span', { id: 'goal-hint', class: 'cp-small cp-muted' }, 'Press Enter to save it in today’s note.'),
          el('div', { class: 'cp-row' }, openNote, save)),
        status,
      );
      input.focus();
      input.select();
    },
  });
})();
