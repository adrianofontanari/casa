/* Kept: the room's small state store (lamp switch, pet spot, and so on).

   The record lives in the plugin (GET/POST /api/state, merged, saved in the
   plugin's data). localStorage is only a cache so the first paint does not
   wait for the bridge; every access to it is wrapped, because it can be
   missing or throw inside a sandboxed iframe.

     Kept.get(key, fallback)   value from the plugin once it answered, else the cache
     Kept.set(key, value)      cache now, POST {key: value} after 500 ms (batched)
     Kept.when(fn)             run fn once the plugin has answered (or failed) */
const Kept = (() => {
  // localStorage may be missing, throw, or be an in-memory stub in the iframe
  const Store = {
    get(k) { try { return localStorage.getItem("casa." + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem("casa." + k, v); } catch (e) { /* storage unavailable */ } },
  };
  let vault = null;
  let pending = {};
  const queue = [];

  fetch("/api/state").then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((v) => {
    vault = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    queue.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  });

  let timer = null;
  function send() {
    if (timer) { timer.stop(); timer = null; }
    const body = pending;
    pending = {};
    if (!Object.keys(body).length) return;
    fetch("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .catch(() => {});
  }
  function flush() {
    if (timer) timer.stop();
    timer = Pace.after("kept-flush", 500, send);
  }
  // a pause defers timers, so write what is pending before the room sleeps
  Pace.on("pause", send);
  addEventListener("pagehide", send);

  return {
    get(k, d) {
      if (vault && k in vault) return vault[k];
      const raw = Store.get(k);
      if (raw == null) return d;
      try { return JSON.parse(raw); } catch (e) { return d; }
    },
    set(k, v) {
      Store.set(k, JSON.stringify(v));
      if (vault) vault[k] = v;
      pending[k] = v;
      flush();
    },
    when(fn) { if (vault) fn(); else queue.push(fn); },
  };
})();
