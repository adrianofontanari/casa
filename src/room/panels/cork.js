/* Panel: the cork board. Post-its on a dotted page: write one, edit it, drag it,
   delete it (with undo). Data: GET /api/notes {notes:[{id, text, color, x, y}]};
   POST {op:"add", text, color, x, y} | {op:"edit", id, text} | {op:"move", id, x, y} |
   {op:"delete", id}, each answering the whole list. x and y (0..1) place the note's
   top-left corner across the free room of the board, as the room draws it. */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el } = P;

  const COLORS = { yellow: '#f8e58c', pink: '#f6c4d0', blue: '#c3def2', green: '#cfe8bd', orange: '#f8d0a0', white: '#fbf9f2' };
  const PICK = ['yellow', 'pink', 'blue', 'green'];

  P.css(`
.cp-cork .cp-body{display:flex;flex-direction:column;gap:12px;padding:14px 16px 16px}
.ck-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;flex:none}
.ck-swatches{display:flex;gap:6px}
.ck-sw{width:26px;height:26px;padding:0;border:2px solid var(--cp-navy);cursor:pointer}
.ck-sw[aria-checked="true"]{box-shadow:0 0 0 3px var(--cp-paper),0 0 0 5px var(--cp-navy)}
.ck-frame{position:relative;flex:1;min-height:360px;padding:12px;background:var(--cp-honey);border-radius:12px;
  box-shadow:inset 0 0 0 3px #8e623a,inset 0 -6px 0 #b08550,4px 4px 0 rgba(20,26,44,.3)}
.ck-board{position:relative;width:100%;height:100%;min-height:336px;overflow:hidden;border-radius:4px;background-color:#fffdf8;
  background-image:radial-gradient(circle,#d8cdb4 1.2px,transparent 1.6px);background-size:18px 18px;background-position:9px 9px}
.ck-empty{position:absolute;inset:0;display:grid;place-items:center;padding:20px;text-align:center;color:var(--cp-muted);font:italic 16px/1.4 var(--cp-serif);pointer-events:none}
.ck-note{position:absolute;display:flex;flex-direction:column;width:var(--ck-w);min-height:var(--ck-h);padding:0 0 8px;
  box-shadow:3px 3px 0 rgba(20,26,44,.28);touch-action:none}
.ck-note.drag{z-index:5;box-shadow:6px 6px 0 rgba(20,26,44,.3);cursor:grabbing}
.ck-note:focus-within{z-index:4}
.ck-top{display:flex;align-items:center;justify-content:space-between;height:24px;padding:0 2px 0 4px;cursor:grab}
.ck-grip{width:30px;height:20px;padding:0;border:0;background:
  radial-gradient(circle,rgba(24,23,28,.35) 1.2px,transparent 1.6px) 0 0/6px 6px;cursor:grab}
.ck-del{width:22px;height:22px;padding:0;border:0;background:none;color:rgba(24,23,28,.55);font:700 15px/1 var(--cp-mono);cursor:pointer}
.ck-del:hover{color:var(--cp-accent)}
.ck-text{flex:1;width:100%;min-height:72px;padding:0 10px;border:0;background:transparent;resize:none;outline:none;
  font:15px/1.35 var(--cp-sans);color:var(--cp-ink)}
.ck-note:focus-within .ck-text{background:rgba(255,255,255,.35)}
.ck-toast{display:flex;align-items:center;gap:10px;padding:6px 10px;background:var(--cp-navy);color:#fffdf8;font-size:13px}
.ck-toast[hidden]{display:none}
.ck-toast .cp-link{color:var(--cp-yellow)}
@media (max-width:760px){.ck-frame{min-height:300px}.ck-board{min-height:276px}}
`);

  P.register('cork', {
    title: 'Post-its',
    size: 'xl',
    tall: true,
    async render(ctx) {
      let notes = [];
      let color = 'yellow';
      let busy = 0;
      let undo = null, undoTimer = null;
      const doc = document;

      const res = await ctx.api('notes');
      if (!ctx.alive()) return;
      if (!res.ok) { ctx.fail(ctx.body, res, () => { ctx.loading(ctx.body); this.render(ctx); }, 'Your post-its'); return; }
      notes = sanitize(res.json.notes);

      function sanitize(list) {
        return (Array.isArray(list) ? list : []).filter((n) => n && n.id != null).map((n) => ({
          id: String(n.id), text: String(n.text == null ? '' : n.text), color: COLORS[n.color] ? n.color : 'yellow',
          x: clamp01(Number(n.x)), y: clamp01(Number(n.y)),
        }));
      }
      function clamp01(v) { return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.1; }

      const board = el('div', { class: 'ck-board', role: 'region', 'aria-label': 'Post-its' });
      const status = el('p', { class: 'cp-small cp-muted', role: 'status', 'aria-live': 'polite', style: { margin: 0 } });
      const toast = el('div', { class: 'ck-toast', hidden: true, role: 'status' });

      async function send(body, failLine) {
        busy++;
        const r = await ctx.api('notes', { method: 'POST', body });
        busy--;
        if (!ctx.alive()) return null;
        if (!r.ok) {
          status.textContent = r.kind === 'bad' && r.json.error ? 'Not saved: ' + r.json.error + '.' : P.errorLine(r, failLine);
          return null;
        }
        status.textContent = '';
        ctx.emit('notes');
        if (Array.isArray(r.json.notes)) notes = sanitize(r.json.notes);
        return r.json;
      }

      // ---------------------------------------------------------- geometry
      function size() {
        const n = board.querySelector('.ck-note');
        const w = n ? n.offsetWidth : 170, h = n ? n.offsetHeight : 130;
        return { W: board.clientWidth, H: board.clientHeight, w, h };
      }
      function place(node, x, y) {
        node.style.left = 'calc((100% - var(--ck-w)) * ' + x + ')';
        node.style.top = 'calc((100% - var(--ck-h)) * ' + y + ')';
      }

      // ---------------------------------------------------------- one note
      function noteEl(n, draft) {
        const node = el('div', { class: 'ck-note', role: 'group', 'aria-label': draft ? 'New post-it' : 'Post-it', dataset: { id: n.id }, style: { background: COLORS[n.color] } });
        const grip = el('button', { class: 'ck-grip', type: 'button', 'aria-label': 'Move this post-it (arrow keys)', title: 'Drag to move', dataset: { k: 'grip-' + n.id } });
        const del = el('button', { class: 'ck-del', type: 'button', 'aria-label': 'Delete this post-it', title: 'Delete', dataset: { k: 'del-' + n.id } }, '×');
        const text = el('textarea', { class: 'ck-text', maxLength: 280, rows: 4, value: n.text, 'aria-label': draft ? 'Write the new post-it' : 'Post-it text', dataset: { k: 'text-' + n.id } });
        node.append(el('div', { class: 'ck-top' }, grip, del), text);
        place(node, n.x, n.y);

        // text: saved a moment after typing stops, and on leaving the field
        let timer = null, last = n.text;
        const flush = async () => {
          clearTimeout(timer); timer = null;
          const v = text.value.replace(/\s+$/, '');
          if (draft) return;
          if (v === last) return;
          if (!v.trim()) { status.textContent = 'A post-it needs some text. To remove it, use ×.'; return; }
          last = v;
          n.text = v;
          await send({ op: 'edit', id: n.id, text: v }, 'Text not saved');
        };
        text.addEventListener('input', () => { if (draft) return; clearTimeout(timer); timer = setTimeout(flush, 800); });
        text.addEventListener('blur', async () => {
          if (draft) {
            const v = text.value.trim();
            node.remove();
            if (!v) { drawEmpty(); return; }
            const out = await send({ op: 'add', text: v, color: n.color, x: n.x, y: n.y }, 'Post-it not added');
            if (out) draw();
            return;
          }
          if (!text.value.trim()) { text.value = last; status.textContent = 'A post-it needs some text. To remove it, use ×.'; return; }
          flush();
        });
        text.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { e.preventDefault(); text.blur(); }
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); text.blur(); }
        });
        ctx.onClose(() => { if (timer) flush(); });

        del.addEventListener('click', async () => {
          if (draft) { node.remove(); drawEmpty(); return; }
          clearTimeout(timer); timer = null;
          const gone = { text: text.value.trim() || n.text, color: n.color, x: n.x, y: n.y };
          const out = await send({ op: 'delete', id: n.id }, 'Not deleted');
          if (!out) return;
          draw();
          offerUndo(gone);
        });

        // dragging, by the top strip or the note's edge
        let drag = null;
        const down = (e) => {
          if (e.button !== 0 || e.target === del || e.target === text) return;
          const s = size();
          drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: n.x * (s.W - s.w), oy: n.y * (s.H - s.h), s, moved: false };
          // the note you pick up comes to the top of the pile
          if (node.nextElementSibling && node.nextElementSibling.classList.contains('ck-note')) board.appendChild(node);
          node.setPointerCapture(e.pointerId);
          node.classList.add('drag');
          e.preventDefault();
        };
        const move = (e) => {
          if (!drag || e.pointerId !== drag.id) return;
          const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
          if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
          const fw = Math.max(1, drag.s.W - drag.s.w), fh = Math.max(1, drag.s.H - drag.s.h);
          n.x = Math.round(clamp01((drag.ox + dx) / fw) * 1000) / 1000;
          n.y = Math.round(clamp01((drag.oy + dy) / fh) * 1000) / 1000;
          place(node, n.x, n.y);
        };
        const up = (e) => {
          if (!drag || e.pointerId !== drag.id) return;
          const moved = drag.moved;
          drag = null;
          node.classList.remove('drag');
          if (moved && !draft) send({ op: 'move', id: n.id, x: n.x, y: n.y }, 'Position not saved');
          else if (!moved) text.focus();
        };
        node.addEventListener('pointerdown', down);
        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up);
        node.addEventListener('pointercancel', up);

        // keyboard move: arrows on the grip, saved when the keys rest
        let keyTimer = null;
        grip.addEventListener('keydown', (e) => {
          const step = e.shiftKey ? 0.1 : 0.03;
          const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
          if (!d) return;
          e.preventDefault();
          n.x = Math.round(clamp01(n.x + d[0]) * 1000) / 1000;
          n.y = Math.round(clamp01(n.y + d[1]) * 1000) / 1000;
          place(node, n.x, n.y);
          clearTimeout(keyTimer);
          if (!draft) keyTimer = setTimeout(() => send({ op: 'move', id: n.id, x: n.x, y: n.y }, 'Position not saved'), 600);
        });
        ctx.onClose(() => { if (keyTimer) { clearTimeout(keyTimer); send({ op: 'move', id: n.id, x: n.x, y: n.y }); } });
        return node;
      }

      function offerUndo(gone) {
        undo = gone;
        clearTimeout(undoTimer);
        ctx.clear(toast);
        toast.append(el('span', { text: 'Post-it deleted.' }), el('button', { class: 'cp-link', type: 'button', onclick: async () => {
          const g = undo; undo = null; toast.hidden = true;
          if (!g) return;
          const out = await send({ op: 'add', text: g.text, color: g.color, x: g.x, y: g.y }, 'Not restored');
          if (out) draw();
        } }, 'Undo'));
        toast.hidden = false;
        undoTimer = setTimeout(() => { toast.hidden = true; undo = null; }, 8000);
      }
      ctx.onClose(() => clearTimeout(undoTimer));

      function drawEmpty() {
        const e = board.querySelector('.ck-empty');
        const any = board.querySelector('.ck-note');
        if (!any && !e) board.appendChild(el('div', { class: 'ck-empty', text: 'No post-its yet. Pick a colour and press + New post-it.' }));
        if (any && e) e.remove();
      }

      function draw() {
        const a = doc.activeElement;
        const keep = a && a.dataset ? a.dataset.k : null;
        ctx.clear(board);
        notes.forEach((n) => board.appendChild(noteEl(n, false)));
        drawEmpty();
        const t = keep && board.querySelector('[data-k="' + keep + '"]');
        if (t) t.focus();
      }

      // a free spot for a new note: the first place on a grid where it overlaps no other note
      function freeSpot() {
        const s = size();
        const fw = Math.max(1, s.W - s.w), fh = Math.max(1, s.H - s.h);
        const rects = notes.map((n) => ({ x: n.x * fw, y: n.y * fh }));
        const free = (x, y) => rects.every((r) => x + s.w + 8 <= r.x || r.x + s.w + 8 <= x || y + s.h + 8 <= r.y || r.y + s.h + 8 <= y);
        for (let y = 0; y <= fh; y += Math.max(20, Math.round(s.h / 3))) {
          for (let x = 0; x <= fw; x += Math.max(20, Math.round(s.w / 3))) {
            if (free(x, y)) return { x: Math.round(x / fw * 1000) / 1000, y: Math.round(y / fh * 1000) / 1000 };
          }
        }
        return { x: 0.45, y: 0.4 };
      }

      const swatches = el('div', { class: 'ck-swatches', role: 'radiogroup', 'aria-label': 'Colour of the new post-it' },
        PICK.map((c) => el('button', { class: 'ck-sw', type: 'button', role: 'radio', 'aria-checked': String(c === color), 'aria-label': c,
          style: { background: COLORS[c] }, onclick: (e) => {
            color = c;
            swatches.querySelectorAll('.ck-sw').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget)));
          } })));
      const addBtn = el('button', { class: 'cp-btn cp-primary', type: 'button', dataset: { autofocus: '' } }, '+ New post-it');
      addBtn.addEventListener('click', () => {
        if (board.querySelector('.ck-note[aria-label="New post-it"]')) { board.querySelector('.ck-note[aria-label="New post-it"] textarea').focus(); return; }
        const spot = freeSpot();
        const node = noteEl({ id: 'new', text: '', color, x: spot.x, y: spot.y }, true);
        board.appendChild(node);
        drawEmpty();
        node.querySelector('textarea').focus();
      });

      ctx.clear(ctx.body);
      const w = 'clamp(130px, 17%, 190px)', h = 'clamp(112px, 22%, 150px)';
      board.style.setProperty('--ck-w', w);
      board.style.setProperty('--ck-h', h);
      ctx.body.append(
        el('div', { class: 'ck-bar' }, addBtn, swatches, el('span', { class: 'cp-small cp-muted', text: 'Drag a post-it by its top strip. Text saves as you type.' }), toast, status),
        el('div', { class: 'ck-frame' }, board));
      draw();

      ctx.onData(['notes'], async () => {
        if (busy || board.contains(doc.activeElement)) return;
        const r = await ctx.api('notes');
        if (ctx.alive() && r.ok) { notes = sanitize(r.json.notes); draw(); }
      });
    },
  });
})();
