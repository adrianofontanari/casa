/* Panel: the typewriter. The quote on the paper, read big; roll another or add yours.
   Data: GET /api/quotes {quotes, path}; POST {op:"add", text}.
   The room shows quote number floor(hours since epoch) % count, a new one every hour;
   the panel opens on the same one unless casa:open passes {index} or {text}. */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el } = P;

  P.css(`
.cp-typewriter .cp-body{padding:20px 22px 22px}
.tw-sheet{position:relative;margin:0 34px;padding:34px 28px 30px;background:#fffefa;border:2px solid var(--cp-oat);border-bottom:0;
  background-image:repeating-linear-gradient(180deg,transparent 0 35px,#f1ead8 35px 36px)}
.tw-sheet::before{content:"";position:absolute;left:-14px;right:-14px;bottom:-6px;height:8px;background:var(--cp-navy);border-radius:4px}
.tw-quote{margin:0;text-align:center;font:italic 400 clamp(24px,3.4vw,34px)/1.3 var(--cp-serif);color:var(--cp-navy);overflow-wrap:anywhere;text-wrap:balance}
.tw-author{margin:12px 0 0;text-align:center;font:500 14px/1.3 var(--cp-sans);color:var(--cp-muted)}
.tw-author:empty{display:none}
.tw-count{margin:16px 0 0;text-align:center;font:11px/1 var(--cp-mono);letter-spacing:.12em;color:var(--cp-faint)}
.tw-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:20px}
@media (max-width:560px){.tw-sheet{margin:0 14px;padding:26px 16px 22px}.tw-machine{margin:0 6px}}
.tw-form{display:grid;gap:8px;margin-top:16px}
.tw-form[hidden]{display:none}
.tw-form textarea{resize:vertical;min-height:72px;font:18px/1.35 var(--cp-serif)}
.tw-machine{display:flex;justify-content:center;align-items:center;gap:9px;height:36px;margin:0 22px;background:var(--cp-mint);
  border:3px solid var(--cp-navy);border-top:0;border-radius:0 0 16px 16px;box-shadow:inset 0 -5px 0 #529282}
.tw-machine i{width:13px;height:13px;border-radius:50%;background:#f2ead6;box-shadow:0 2px 0 #3d7062}
.tw-status{min-height:1.3em;margin:6px 0 0;font-size:13px;color:var(--cp-muted)}
`);

  P.register('typewriter', {
    title: 'Typewriter',
    size: 'm',
    async render(ctx) {
      const res = await ctx.api('quotes');
      if (!ctx.alive()) return;
      if (!res.ok) { ctx.fail(ctx.body, res, () => { ctx.loading(ctx.body); this.render(ctx); }, 'Your quotes'); return; }
      let quotes = (Array.isArray(res.json.quotes) ? res.json.quotes : []).filter((q) => typeof q === 'string' && q.trim());
      let path = res.json.path || null;
      let exists = res.json.exists !== false;
      const split = (q) => { const m = /^(.*\S)\s+[-\u2013\u2014]{1,2}\s+([^-\u2013\u2014]{2,80})$/.exec(q); return m ? [m[1], m[2].trim()] : [q, '']; };
      const d = ctx.detail || {};
      let i = 0;
      if (quotes.length) {
        const byText = typeof d.text === 'string' ? quotes.indexOf(d.text) : -1;
        i = byText !== -1 ? byText : Number.isInteger(d.index) ? d.index % quotes.length : Math.floor(Date.now() / 3600000) % quotes.length;
      }

      const quote = el('p', { class: 'tw-quote', 'aria-live': 'polite' });
      const author = el('p', { class: 'tw-author' });
      const count = el('p', { class: 'tw-count' });
      const roll = el('button', { class: 'cp-btn', type: 'button', dataset: { autofocus: '' } }, '↻ Another');
      const addBtn = el('button', { class: 'cp-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'tw-form' }, '+ Add yours');
      const openNote = el('button', { class: 'cp-link cp-small', type: 'button' }, 'Open the quotes note');
      const area = el('textarea', { class: 'cp-input', id: 'tw-text', maxLength: 300, rows: 3, placeholder: 'A line that helps you' });
      const save = el('button', { class: 'cp-btn cp-primary', type: 'submit' }, 'Add');
      const cancel = el('button', { class: 'cp-btn', type: 'button' }, 'Cancel');
      const status = el('p', { class: 'tw-status', role: 'status', 'aria-live': 'polite' });
      const form = el('form', { class: 'tw-form', id: 'tw-form', hidden: true },
        el('label', { class: 'cp-label', for: 'tw-text', text: 'Your quote' }), area,
        el('div', { class: 'cp-row' }, save, cancel, el('span', { class: 'cp-small cp-muted', text: 'Enter adds it, Shift+Enter starts a new line.' })));

      function show() {
        if (!quotes.length) {
          quote.textContent = 'No quotes yet. Add the first one: a line you like to read now and then.';
          author.textContent = '';
          count.textContent = '';
        } else {
          const [q, who] = split(quotes[i]);
          quote.textContent = q;
          author.textContent = who ? '\u2014 ' + who : '';
          count.textContent = (i + 1) + ' / ' + quotes.length;
        }
        roll.disabled = quotes.length < 2;
        openNote.hidden = !(path && exists);
      }
      function toggleForm(open) {
        form.hidden = !open;
        addBtn.setAttribute('aria-expanded', String(open));
        if (open) area.focus(); else addBtn.focus();
      }

      roll.addEventListener('click', () => {
        if (quotes.length < 2) return;
        let n = i;
        while (n === i) n = Math.floor(Math.random() * quotes.length);
        i = n;
        show();
      });
      addBtn.addEventListener('click', () => toggleForm(form.hidden));
      cancel.addEventListener('click', () => { area.value = ''; toggleForm(false); });
      area.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : save.click(); }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = area.value.trim().replace(/\s+/g, ' ');
        if (!text) { area.focus(); return; }
        save.disabled = true; status.textContent = 'Adding';
        const r = await ctx.api('quotes', { method: 'POST', body: { op: 'add', text } });
        save.disabled = false;
        if (!ctx.alive()) return;
        if (!r.ok) { status.textContent = P.errorLine(r, 'Not added'); return; }
        if (Array.isArray(r.json.quotes)) quotes = r.json.quotes.filter((q) => typeof q === 'string' && q.trim());
        else quotes.push(text);
        if (r.json.path) path = r.json.path;
        exists = r.json.exists !== false;
        const at = quotes.lastIndexOf(text);
        i = at !== -1 ? at : quotes.length - 1;
        area.value = '';
        status.textContent = path ? 'Added to ' + path + '.' : 'Added.';
        show();
        toggleForm(false);
        ctx.emit('quotes');
      });
      openNote.addEventListener('click', async () => {
        const r = await ctx.api('open', { method: 'POST', body: { path } });
        if (ctx.alive() && !r.ok) status.textContent = P.errorLine(r, 'Could not open the note');
      });

      ctx.clear(ctx.body);
      ctx.body.append(el('div', { class: 'tw-sheet' }, quote, author, count),
        el('div', { class: 'tw-machine', 'aria-hidden': 'true' }, Array.from({ length: 9 }, () => el('i'))),
        el('div', { class: 'tw-bar' }, el('div', { class: 'cp-row' }, roll, addBtn), openNote), form, status);
      show();
      if (!quotes.length) toggleForm(true);
    },
  });
})();
