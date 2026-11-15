/* Pace: the only place in the room that owns a timer.

   Every repeating job (data refresh, clock hands, weather particles, buddy
   and pet frames) is registered here by id. That gives three guarantees:

   - nothing runs while the room is paused (casa:pause, or the iframe hidden);
   - a user can slow any loop down (localStorage "casa.timers", id -> seconds),
     never speed it up: the shipped delay is the floor;
   - the dev page can list every live loop (Pace.list()) to check the idle cost.

   API
     Pace.ms(id, shippedMs)            -> the delay to use for that loop
     Pace.every(id, ms, fn, {now})     -> {stop, poke, set(ms)}  repeating job
     Pace.after(id, ms, fn)            -> {stop}  one-shot, deferred while paused
     Pace.paused()                     -> boolean
     Pace.on('pause'|'resume', fn)
*/
const Pace = (() => {
  const KEY = "casa.timers";
  const loops = new Map();          // id -> loop record
  const subs = { pause: [], resume: [] };
  let stopped = false;              // casa:pause received
  let hidden = false;               // document.hidden

  const overrides = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
  };

  function ms(id, shipped) {
    const v = overrides()[id];
    if (typeof v !== "number" || !isFinite(v)) return shipped;
    return Math.max(shipped, Math.min(3600000, Math.round(v * 1000)));
  }

  const paused = () => stopped || hidden;

  function arm(L) {
    clearTimeout(L.timer);
    L.timer = null;
    if (!L.alive || paused()) return;
    L.timer = setTimeout(() => run(L), L.ms);
  }

  function run(L) {
    // a poke runs the job early: drop the pending timer so only one chain lives
    clearTimeout(L.timer);
    L.timer = null;
    if (!L.alive || paused()) return;
    try { L.fn(); } catch (e) { console.error("[casa] loop " + L.id, e); }
    if (L.once) { L.alive = false; loops.delete(L.id); return; }
    arm(L);
  }

  function every(id, shipped, fn, opts) {
    const old = loops.get(id);
    if (old) { old.alive = false; clearTimeout(old.timer); }
    const L = { id, ms: ms(id, shipped), fn, timer: null, alive: true, once: false };
    loops.set(id, L);
    if (opts && opts.now && !paused()) run(L); else arm(L);
    return {
      stop() { L.alive = false; clearTimeout(L.timer); if (loops.get(id) === L) loops.delete(id); },
      poke() { if (L.alive && !paused()) run(L); },
      set(next) { L.ms = ms(id, next); arm(L); },
      get alive() { return L.alive; },
    };
  }

  function after(id, delay, fn) {
    const old = loops.get(id);
    if (old) { old.alive = false; clearTimeout(old.timer); }
    const L = { id, ms: Math.max(0, delay), fn, timer: null, alive: true, once: true };
    loops.set(id, L);
    arm(L);
    return { stop() { L.alive = false; clearTimeout(L.timer); if (loops.get(id) === L) loops.delete(id); } };
  }

  function update() {
    const was = update.last;
    const now = paused();
    update.last = now;
    if (now) {
      loops.forEach((L) => { clearTimeout(L.timer); L.timer = null; });
      if (!was) subs.pause.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    } else {
      // a resumed room catches up once, then keeps its cadence
      if (was) subs.resume.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
      loops.forEach((L) => { if (L.alive && !L.timer) { if (L.once) arm(L); else run(L); } });
    }
  }
  update.last = false;

  document.addEventListener("casa:pause", () => { stopped = true; update(); });
  document.addEventListener("casa:resume", () => { stopped = false; update(); });
  document.addEventListener("visibilitychange", () => { hidden = document.hidden; update(); });
  hidden = !!document.hidden;
  update.last = paused();

  /* The plugin posts {casa:1, pause:true|false}; the bridge shim
     (src/plugin/room-side/shim.js) turns that into casa:pause / casa:resume
     and also reports document.hidden while paused. Both are handled above. */

  return {
    KEY, ms, every, after, paused,
    on(kind, fn) { if (subs[kind]) subs[kind].push(fn); },
    list() { return [...loops.values()].filter((L) => L.alive).map((L) => ({ id: L.id, ms: L.ms, once: L.once, armed: !!L.timer })); },
  };
})();
