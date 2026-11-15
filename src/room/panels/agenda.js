/* Panel: the agenda. An open notebook: today's goal and today's tasks on the left
   page, the next days on the right page, one tab per day.

   Data: GET /api/tasks and GET /api/focus. Every write is POST /api/tasks
   {op, id?, text?, rev}; a 412 means the note changed in Obsidian since the
   panel read it, so the panel reloads and says nothing was written. */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el, fmt } = P;

  /* The agenda as the room draws it: a teal cloth cover with rounded corners and a
     yellow elastic band, two ruled pages, index tabs along the top of the right page. */
  P.css(`
.cp-agenda .cp-body{padding:0;display:flex;background:var(--cp-teal)}
.ag-cover{position:relative;flex:1;min-height:0;display:flex;padding:12px 30px 14px 12px;background:var(--cp-teal);
  background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.035) 0 2px,transparent 2px 4px)}
.ag-band{position:absolute;top:0;bottom:0;right:10px;width:10px;background:var(--cp-yellow);box-shadow:inset -3px 0 0 #cc941c}
.ag-book{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 10px minmax(0,1fr);width:100%;
  border-radius:10px;overflow:hidden;box-shadow:0 0 0 2px #1e4c46}
.ag-page{min-width:0;overflow:auto;padding:16px 20px 24px 30px;background-color:#fffdf8;
  background-image:linear-gradient(90deg,transparent 18px,rgba(210,71,58,.28) 18px 19px,transparent 19px),
    repeating-linear-gradient(180deg,transparent 0 31px,#e9e0cc 31px 32px);background-position:0 0,0 12px}
.ag-spine{background:linear-gradient(90deg,#d8ccb0,#f4eedf 45%,#f4eedf 55%,#d8ccb0)}
.ag-head{display:flex;align-items:flex-end;gap:12px;margin:0 0 16px}
.ag-day{flex:none;font:700 44px/0.9 var(--cp-mono);color:var(--cp-navy)}
.ag-head h3{margin:0;font:650 19px/1.2 var(--cp-sans);color:var(--cp-ink)}
.ag-head p{margin:2px 0 0;font:12px/1.2 var(--cp-mono);color:var(--cp-muted)}
.ag-sec{margin:0 0 18px}
.ag-label{display:flex;align-items:center;gap:8px;margin:0 0 4px;font:700 12px/1.2 var(--cp-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--cp-teal)}
.ag-label::after{content:"";flex:1;border-top:2px dotted var(--cp-mint)}
.ag-goal{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--cp-mustardL);box-shadow:3px 3px 0 var(--cp-mustard)}
.ag-goal-text{flex:1;min-width:0;text-align:left;padding:2px 0;border:0;background:none;font:650 18px/1.3 var(--cp-sans);color:var(--cp-navy);cursor:text}
.ag-goal-text.empty{color:var(--cp-muted);font:italic 15px/1.3 var(--cp-serif)}
.ag-list{list-style:none;margin:0;padding:0}
.ag-task{display:flex;align-items:center;gap:10px;min-height:32px;padding:0}
.ag-text{flex:1;min-width:0;padding:5px 2px;border:0;background:none;text-align:left;font:15px/1.4 var(--cp-sans);color:var(--cp-ink);cursor:text;overflow-wrap:anywhere}
.ag-text:hover{background:rgba(246,201,62,.18)}
.ag-task.done .ag-text{color:var(--cp-faint);text-decoration:line-through}
.ag-meta{flex:none;font:12px/1 var(--cp-mono);color:var(--cp-muted)}
.ag-meta.late{color:var(--cp-accent)}
.ag-open{flex:none;width:28px;height:28px;padding:0;border:2px solid transparent;background:none;color:var(--cp-teal);font:700 14px/1 var(--cp-mono);cursor:pointer}
.ag-open:hover{border-color:var(--cp-navy);color:var(--cp-navy)}
.ag-edit{flex:1;min-height:30px;padding:3px 6px;font-size:15px}
.ag-add{display:block;width:100%;margin:2px 0 2px;padding:6px 2px;border:0;border-bottom:2px solid transparent;background:transparent;
  font:15px/1.3 var(--cp-sans);color:var(--cp-ink);outline:none}
.ag-add::placeholder{color:var(--cp-teal)}
.ag-add:focus{border-bottom-color:var(--cp-navy);background:rgba(255,255,255,.85)}
.ag-fold{margin-top:6px;font:600 12px/1.2 var(--cp-sans);color:var(--cp-teal);background:none;border:0;padding:4px 0;cursor:pointer}
.ag-fold:hover{color:var(--cp-navy)}
.ag-empty{margin:4px 0;font:italic 15px/1.4 var(--cp-serif);color:var(--cp-muted)}
.ag-right{padding-top:0}
.ag-right h3{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin:0 0 10px;font:650 19px/1.2 var(--cp-sans)}
.ag-right h3 em{font:12px/1 var(--cp-mono);font-style:normal;color:var(--cp-muted)}
.ag-tabs{display:flex;flex-wrap:wrap;gap:4px;margin:0 -20px 16px -30px;padding:10px 12px 0;background:var(--cp-oatL);border-bottom:2px solid var(--cp-oat)}
.ag-tab{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:4px 10px;border:2px solid var(--cp-oat);border-bottom:0;
  background:var(--cp-mustardL);color:var(--cp-navy);font:600 12px/1 var(--cp-sans);cursor:pointer;margin-bottom:-2px}
.ag-tab:nth-child(even){background:#d9ece6}
.ag-tab.later{background:var(--cp-oat)}
.ag-tab[aria-selected="true"]{background:#fffdf8;border-color:var(--cp-navy);box-shadow:inset 0 3px 0 var(--cp-teal)}
.ag-tab .n{min-width:16px;padding:1px 4px;background:var(--cp-navy);color:#fffdf8;font:700 10px/1.2 var(--cp-mono);text-align:center}
.ag-tab .n:empty{display:none}
.ag-notice{margin:0 0 12px}
@media (max-width:860px){
  .cp-agenda .cp-body{display:block;overflow:auto}
  .ag-cover{padding:10px 24px 10px 10px}
  .ag-book{grid-template-columns:minmax(0,1fr);grid-auto-rows:auto}
  .ag-spine{height:10px;background:linear-gradient(180deg,#d8ccb0,#f4eedf 45%,#f4eedf 55%,#d8ccb0)}
  .ag-page{overflow:visible;padding-left:28px}
}
`);

  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }
  function dayOfYear(d) {
    return Math.round((fmt.dayStart(d) - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1;
  }

  P.register('agenda', {
    title: 'Agenda',
    size: 'l',
    tall: true,
    async render(ctx) {
      let tasks = null, focus = null, notice = '', busy = false;
      let tab = null;              // selected right-page key: 'YYYY-MM-DD' or 'later'
      let editing = null;          // id being edited ('goal' for the goal)
      let refocus = null;          // data-k to focus after the next draw
      const showDone = new Set();  // lists with their ticked tasks unfolded
      const doc = document;

      async function load() {
        const [t, f] = await Promise.all([ctx.api('tasks'), ctx.api('focus')]);
        if (!ctx.alive()) return false;
        if (!t.ok) { ctx.fail(ctx.body, t, () => start()); return false; }
        tasks = Object.assign({ today: [], upcoming: [] }, t.json);
        focus = f.ok ? f.json : null;
        return true;
      }

      async function start() {
        ctx.loading(ctx.body);
        if (await load()) draw();
      }

      function say(s) { notice = s || ''; draw(); }

      async function write(body, failLine) {
        if (busy) return false;
        busy = true;
        const r = await ctx.api('tasks', { method: 'POST', body: Object.assign({ rev: tasks.rev }, body) });
        busy = false;
        if (!ctx.alive()) return false;
        if (r.status === 412) {
          await load();
          say('Your note changed in Obsidian, so Casa reloaded it. Nothing was written: please try again.');
          return false;
        }
        if (!r.ok) { await load(); say(P.errorLine(r, failLine)); return false; }
        notice = '';
        if (r.json && r.json.rev) tasks.rev = r.json.rev;
        ctx.emit('tasks');
        await load();
        draw();
        return true;
      }

      async function saveGoal(text) {
        if (busy) return;
        busy = true;
        const r = await ctx.api('focus', { method: 'POST', body: { focus: text } });
        busy = false;
        if (!ctx.alive()) return;
        if (!r.ok) { say(P.errorLine(r, 'Goal not saved')); return; }
        focus = Object.assign({}, focus || {}, r.json);
        ctx.emit('focus');
        editing = null;
        draw();
      }

      async function openNote(path, line) {
        if (!path) return;
        const body = { path };
        if (Number.isInteger(line)) body.line = line;
        const r = await ctx.api('open', { method: 'POST', body });
        if (ctx.alive() && !r.ok) say(P.errorLine(r, 'Could not open the note'));
      }

      // ---------------------------------------------------------- pieces

      function inlineEditor(value, label, onSave, k, back) {
        const input = el('input', { class: 'cp-input ag-edit', type: 'text', value, 'aria-label': label, maxLength: 500, dataset: { k } });
        let done = false;
        const finish = (save) => {
          if (done) return;
          done = true;
          if (doc.activeElement === input || !ctx.body.contains(doc.activeElement)) refocus = back;
          const v = input.value.trim();
          if (save && v && v !== value) onSave(v);
          else { editing = null; draw(); }
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => setTimeout(() => finish(true), 0));
        return input;
      }

      function taskRow(t, todayIso, showDate) {
        const li = el('li', { class: 'ag-task' + (t.done ? ' done' : '') });
        const box = el('input', {
          class: 'cp-check', type: 'checkbox', checked: !!t.done,
          'aria-label': (t.done ? 'Done: ' : 'Mark done: ') + t.text, dataset: { k: 'chk-' + t.id },
        });
        box.addEventListener('change', () => {
          if (busy) { box.checked = !!t.done; return; }
          t.done = !t.done;        // drawn at once, confirmed by the reload after the write
          draw();
          write({ op: 'toggle', id: t.id }, 'Not ticked');
        });
        li.appendChild(box);
        if (editing === t.id) {
          li.appendChild(inlineEditor(t.text, 'Edit task', (v) => { editing = null; t.text = v; draw(); write({ op: 'edit', id: t.id, text: v }, 'Not saved'); }, 'edit-' + t.id, 'txt-' + t.id));
        } else {
          li.appendChild(el('button', {
            class: 'ag-text', type: 'button', title: 'Edit', 'aria-label': 'Edit task: ' + t.text, dataset: { k: 'txt-' + t.id },
            onclick: () => { editing = t.id; draw(); },
          }, t.text));
        }
        const due = t.due && fmt.parseDay(t.due);
        if (due && (showDate || t.due < todayIso)) {
          li.appendChild(el('span', { class: 'ag-meta' + (t.due < todayIso && !t.done ? ' late' : '') }, fmt.short(due)));
        }
        if (t.path) {
          li.appendChild(el('button', {
            class: 'ag-open', type: 'button', title: 'Open ' + t.path, 'aria-label': 'Open the note of: ' + t.text,
            onclick: () => openNote(t.path, t.line),
          }, '↗'));
        }
        return li;
      }

      function taskList(key, list, todayIso, showDate, emptyText) {
        const frag = el('div');
        const open = list.filter((t) => !t.done);
        const done = list.filter((t) => t.done);
        const ul = el('ul', { class: 'ag-list' });
        open.forEach((t) => ul.appendChild(taskRow(t, todayIso, showDate)));
        if (showDone.has(key)) done.forEach((t) => ul.appendChild(taskRow(t, todayIso, showDate)));
        if (!open.length && !(showDone.has(key) && done.length) && emptyText) frag.appendChild(el('p', { class: 'ag-empty' }, emptyText));
        frag.appendChild(ul);
        if (done.length) {
          frag.appendChild(el('button', {
            class: 'ag-fold', type: 'button', 'aria-expanded': String(showDone.has(key)), dataset: { k: 'fold-' + key },
            onclick: () => { if (showDone.has(key)) showDone.delete(key); else showDone.add(key); draw(); },
          }, (showDone.has(key) ? 'Hide ' : '✓ ') + done.length + ' done'));
        }
        return frag;
      }

      // ---------------------------------------------------------- draw

      function draw() {
        if (!ctx.alive() || !tasks) return;
        const a = doc.activeElement;
        const keep = a && a.dataset ? a.dataset.k : null;

        const today = fmt.parseDay(tasks.date) || fmt.dayStart(new Date());
        const todayIso = fmt.iso(today);
        const days = [];
        for (let i = 1; i <= 6; i++) days.push(fmt.addDays(today, i));
        const lastIso = fmt.iso(days[days.length - 1]);
        const bucket = { later: [] };
        days.forEach((d) => { bucket[fmt.iso(d)] = []; });
        const late = [];
        (tasks.upcoming || []).forEach((t) => {
          if (t.due && t.due < todayIso) late.push(t);
          else if (t.due && t.due <= lastIso && bucket[t.due]) bucket[t.due].push(t);
          else bucket.later.push(t);
        });
        if (!tab || !(tab in bucket)) {
          tab = days.map(fmt.iso).concat('later').find((k) => bucket[k].some((t) => !t.done)) || fmt.iso(days[0]);
        }

        // left page
        const left = el('div', { class: 'ag-page ag-left' });
        left.appendChild(el('div', { class: 'ag-head' },
          el('span', { class: 'ag-day', 'aria-hidden': 'true', text: String(today.getDate()) }),
          el('div', {},
            el('h3', { text: fmt.longDate(today) + ' ' + today.getFullYear() }),
            el('p', { text: 'week ' + isoWeek(today) + ' · day ' + dayOfYear(today) }))));

        if (notice) left.appendChild(el('p', { class: 'cp-notice ag-notice', role: 'alert' }, notice));

        if (focus) {
          const sec = el('section', { class: 'ag-sec', 'aria-label': "Today's goal" }, el('h4', { class: 'ag-label', text: "Today's goal" }));
          const row = el('div', { class: 'ag-goal' });
          if (editing === 'goal') {
            row.appendChild(inlineEditor(focus.focus || '', "Today's goal", (v) => saveGoal(v), 'edit-goal', 'goal'));
          } else {
            const g = (focus.focus || '').trim();
            row.appendChild(el('button', {
              class: 'ag-goal-text' + (g ? '' : ' empty'), type: 'button', dataset: { k: 'goal' },
              'aria-label': g ? "Edit today's goal: " + g : "Write today's goal",
              onclick: () => { editing = 'goal'; draw(); },
            }, g || '+ write it'));
          }
          sec.appendChild(row);
          left.appendChild(sec);
        }

        const tsec = el('section', { class: 'ag-sec', 'aria-label': "Today's tasks" }, el('h4', { class: 'ag-label', text: 'Today' }));
        const addIn = el('input', {
          class: 'ag-add', type: 'text', placeholder: '+ add a task', 'aria-label': 'Add a task for today', maxLength: 500,
          dataset: { k: 'add', autofocus: '' },
        });
        addIn.addEventListener('keydown', async (e) => {
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          const v = addIn.value.trim();
          if (!v || busy) return;
          addIn.value = '';
          await write({ op: 'add', text: v }, 'Not added');
        });
        tsec.appendChild(addIn);
        tsec.appendChild(taskList('today', (tasks.today || []).concat(late), todayIso, false, 'Nothing for today yet.'));
        left.appendChild(tsec);

        // right page + tabs
        const sel = tab === 'later' ? null : fmt.parseDay(tab);
        const right = el('div', { class: 'ag-page ag-right' });
        const dayPane = el('div', { id: 'ag-day', role: 'tabpanel', 'aria-labelledby': 'ag-tab-' + tab });
        const dayName = sel ? (fmt.iso(sel) === fmt.iso(days[0]) ? 'Tomorrow' : fmt.DAYS[sel.getDay()]) : 'Later';
        dayPane.appendChild(el('h3', {}, dayName, el('em', { text: sel ? fmt.longDate(sel) : 'no date, or further ahead' })));
        dayPane.appendChild(taskList(tab, bucket[tab], todayIso, tab === 'later', sel ? 'Nothing planned.' : 'Nothing here.'));
        dayPane.appendChild(el('p', { class: 'cp-small cp-muted', style: { marginTop: '16px' } }, 'New tasks go to today. To plan a task for another day, give it a date in your note.'));

        const tabs = el('div', { class: 'ag-tabs', role: 'tablist', 'aria-label': 'Days' });
        const keys = days.map(fmt.iso).concat('later');
        keys.forEach((k, i) => {
          const d = k === 'later' ? null : fmt.parseDay(k);
          const n = bucket[k].filter((t) => !t.done).length;
          const label = d ? (i === 0 ? 'Tomorrow' : fmt.DAYS[d.getDay()].slice(0, 3) + ' ' + d.getDate()) : 'Later';
          const b = el('button', {
            class: 'ag-tab' + (k === 'later' ? ' later' : ''), type: 'button', role: 'tab', id: 'ag-tab-' + k,
            'aria-selected': String(k === tab), 'aria-controls': 'ag-day', tabIndex: k === tab ? 0 : -1, dataset: { k: 'tab-' + k },
            'aria-label': label + ', ' + n + ' open',
            onclick: () => { tab = k; draw(); },
          }, el('span', { text: label }), el('span', { class: 'n', text: n ? String(n) : '' }));
          b.addEventListener('keydown', (e) => {
            const dir = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            tab = keys[(i + dir + keys.length) % keys.length];
            draw();
            const t = ctx.body.querySelector('[data-k="tab-' + tab + '"]');
            if (t) t.focus();
          });
          tabs.appendChild(b);
        });

        ctx.clear(ctx.body);
        right.append(tabs, dayPane);
        ctx.body.appendChild(el('div', { class: 'ag-cover' },
          el('div', { class: 'ag-book' }, left, el('div', { class: 'ag-spine', 'aria-hidden': 'true' }), right),
          el('span', { class: 'ag-band', 'aria-hidden': 'true' })));

        const q = (k) => (k ? ctx.body.querySelector('[data-k="' + k + '"]') : null);
        let target = editing ? ctx.body.querySelector('.ag-edit') : (q(refocus) || q(keep));
        refocus = null;
        // a ticked task folds away: keep the keyboard nearby
        if (!target && keep && /^chk-/.test(keep)) target = ctx.body.querySelector('.ag-fold') || q('add');
        if (target) { target.focus(); if (editing && target.select) target.select(); }
      }

      // header: open today's note
      const dailyPath = () => (focus && focus.exists && focus.path) || (tasks && tasks.today && tasks.today[0] && tasks.today[0].path) || null;
      const openBtn = el('button', { class: 'cp-link cp-small', type: 'button', onclick: () => openNote(dailyPath()) }, "Open today's note");
      ctx.tools.appendChild(openBtn);

      ctx.onData(['tasks', 'focus'], async () => { if (!busy && !editing && await load()) draw(); });

      await start();
      openBtn.hidden = !dailyPath();
    },
  });
})();
