/* Room: composes the canvas room, keeps it in step with the clock and the
   vault, and turns clicks on objects into casa:open events.

   Layers (bottom to top)
     view     the window's outside (Sky.paintView), repainted once a minute
     base     every fixture and object, painted in day tones, then shaded for
              the hour (PIX.shade) and cached. The glass is transparent in it.
     clock    the wall clock's hands, drawn on the visible canvas each minute
     sprites  small canvases: weather particles on the glass, buddy, pet
     DOM      goal text, next-event text, hotspot buttons, hover label
   Nothing repaints faster than its picture changes: the base is rebuilt only
   when data, size, lamp, theme or date change; the shading is recomputed only
   when the night level changes by a step; weather particles run only while it
   rains or snows. Every loop goes through Pace and stops on casa:pause.

   Theme sprites (window.CasaTheme, docs/dev/theme.md)
     buddy.draw(ctx, x, y, u, frame, mood, {k})   (x, y) = top-left of the box
       buddy.w x buddy.h; moods buddy.moods[m] = {n, ms}: idle, blink, wave,
       sleep, talk, happy. The room plays idle (blink every few seconds), wave
       on hover, happy on click, sleep at night.
     pet.draw(ctx, x, y, u, gait, frame, {right, k})  box pet.w x pet.h, faces
       left; gaits pet.gaits[g] = {n, ms, step?}: stand, wag, sit, lie, sleep,
       walk, trot. While walking the box moves `step` sprite px per frame.
     Sprites sit on their own canvases, so the room passes the night level k
     (less where the lamp reaches) and the theme shades them itself.
   A missing or throwing theme falls back to simple neutral placeholders. */
const Room = (() => {
  const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const S = {
    now: new Date(), hour: 12, night: 0, season: null,
    focus: "", focusLoaded: false, openTasks: null, calNext: null, notes: [],
    battery: null, lampMode: "auto", lampOn: false, tvChannel: 0, calm: false, buddyOn: true, hidden: new Set(), tagsSeen: new Set(),
  };

  // ---------------------------------------------------------------- DOM
  let root, stage, canvas, ctx, fallC, tvC, buddyC, petC, goalEl, slipEl, hotsEl, labelEl, sayEl;
  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    parent.appendChild(e);
    return e;
  }
  function dom() {
    root = document.getElementById("casa-room");
    if (!root) { root = document.createElement("div"); root.id = "casa-room"; document.body.appendChild(root); }
    stage = root.querySelector(".casa-stage") || el("div", "casa-stage", root);
    canvas = stage.querySelector(".casa-canvas") || el("canvas", "casa-canvas", stage);
    fallC = stage.querySelector(".casa-fall") || el("canvas", "casa-sprite casa-fall", stage);
    tvC = stage.querySelector(".casa-tv") || el("canvas", "casa-sprite casa-tv", stage);
    buddyC = stage.querySelector(".casa-buddy") || el("canvas", "casa-sprite casa-buddy", stage);
    petC = stage.querySelector(".casa-pet") || el("canvas", "casa-sprite casa-pet", stage);
    goalEl = stage.querySelector(".casa-goal") || el("div", "casa-goal", stage);
    if (!goalEl.firstElementChild) el("span", "", goalEl);
    slipEl = stage.querySelector(".casa-slip") || el("div", "casa-slip", stage);
    hotsEl = stage.querySelector(".casa-hots") || el("div", "casa-hots", stage);
    labelEl = stage.querySelector(".casa-label") || el("div", "casa-label", stage);
    labelEl.setAttribute("role", "tooltip");
    sayEl = stage.querySelector(".casa-say") || el("div", "casa-say", stage);
    sayEl.setAttribute("role", "status");
    sayEl.hidden = true;
    labelEl.hidden = true;
    ctx = canvas.getContext("2d");
  }

  // ---------------------------------------------------------------- build
  let M = null, G = null;
  let baseC = null, baseImg = null, light = null, emit = null, shadedC = null, shadedKey = "";
  let viewC = null, viewKey = "";
  let hots = [];
  let wallC = null;
  const kq = (k) => Math.round(k * 50) / 50;

  const textFont = (px) => `italic ${px}px Georgia, "Times New Roman", serif`;
  let measureCtx = null;
  function goalText() { return S.focus || "Click to write today's goal"; }
  function bannerWidth() {
    const fpx = goalFontPx();
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = textFont(fpx);
    const tw = measureCtx.measureText(goalText()).width / M.css;
    return Math.round(Math.max(64, Math.min(G.W * 0.56, tw + 16)));
  }
  const goalFontPx = () => Math.max(11, Math.min(42, Math.round(G.banner.h * M.css * 0.52)));

  function kit(c2, extra) {
    const x = c2;
    const tone = (t) => (typeof t === "string" ? PIX.fs(t) : PIX.rgb(t));
    const W = G.W;
    return Object.assign({
      x, g: G, W: G.W, H: G.H, state: S,
      r(px, py, w, h, t) { w = Math.round(w); h = Math.round(h); if (w <= 0 || h <= 0) return; x.fillStyle = tone(t); x.fillRect(Math.round(px), Math.round(py), w, h); },
      p(px, py, t) { x.fillStyle = tone(t); x.fillRect(Math.round(px), Math.round(py), 1, 1); },
      dith(px, py, w, h, a, b, k) {
        px = Math.round(px); py = Math.round(py); w = Math.round(w); h = Math.round(h);
        if (w <= 0 || h <= 0) return;
        x.fillStyle = tone(a); x.fillRect(px, py, w, h);
        x.fillStyle = tone(b);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (k > PIX.thr(px + xx, py + yy)) x.fillRect(px + xx, py + yy, 1, 1);
      },
      clear(px, py, w, h) { x.clearRect(px, py, w, h); },
      wallCanvas(c) { wallC = c; },
      wall(px, py, w, h) { if (wallC && w > 0 && h > 0) x.drawImage(wallC, px, py, w, h, px, py, w, h); },
      blit(c, px, py) { x.drawImage(c, Math.round(px), Math.round(py)); },
      emit(px, py, w, h) {
        for (let yy = Math.max(0, py | 0); yy < Math.min(G.H, (py + h) | 0); yy++)
          for (let xx = Math.max(0, px | 0); xx < Math.min(W, (px + w) | 0); xx++) emit[yy * W + xx] = 1;
      },
      lamp(cx, cy, r, s) {
        const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(G.H, Math.ceil(cy + r));
        const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W, Math.ceil(cx + r));
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
          const d = Math.hypot(xx - cx, (yy - cy) * 1.25) / r;
          if (d >= 1) continue;
          const v = s * Math.pow(1 - d * d, 1.6);
          const i = yy * W + xx;
          if (v > light[i]) light[i] = v;
        }
      },
      // a cone of light opening downward from (cx, cy): len pixels long, spread = half-width per pixel
      cone(cx, cy, len, spread, s) {
        const y1 = Math.min(G.H, Math.ceil(cy + len));
        for (let yy = Math.max(0, cy | 0); yy < y1; yy++) {
          const dy = yy - cy, half = 4 + dy * spread;
          const x0 = Math.max(0, Math.floor(cx - half)), x1 = Math.min(W, Math.ceil(cx + half));
          for (let xx = x0; xx < x1; xx++) {
            const across = Math.abs(xx - cx) / half;
            const v = s * (1 - dy / len) * (1 - across * across);
            const i = yy * W + xx;
            if (v > light[i]) light[i] = v;
          }
        }
      },
      hot(id, px, py, w, h, label) { hots.push({ id, x: px, y: py, w, h, label }); },
      tone,
      // role colours: tw.colors[role] (an [r,g,b]) or the default tone name
      roles(tw, defs) {
        const c = (tw && tw.colors) || {};
        const out = {};
        for (const k in defs) out[k] = Array.isArray(c[k]) && c[k].length >= 3 ? c[k] : defs[k];
        return out;
      },
      treeTone: (n) => Sky.treeTone(n),
    }, extra || {});
  }

  function paintBase() {
    hots = [];
    baseC = PIX.buf(G.W, G.H);
    light = new Float32Array(G.W * G.H);
    emit = new Uint8Array(G.W * G.H);
    const D = kit(baseC.x);
    const steps = [Decor.shell, Decor.window, Decor.furniture, Decor.objects];
    for (const f of steps) {
      try { f(D); } catch (e) { console.error("[casa] decor", e); }
    }
    baseImg = baseC.x.getImageData(0, 0, G.W, G.H);
    shadedKey = "";
  }

  function shade() {
    const key = kq(S.night) + "|" + S.lampOn;
    if (key === shadedKey && shadedC) return false;
    shadedKey = key;
    if (!shadedC || shadedC.c.width !== G.W || shadedC.c.height !== G.H) shadedC = PIX.buf(G.W, G.H);
    const out = shadedC.x.createImageData(G.W, G.H);
    PIX.shade(baseImg, out, { k: kq(S.night), light: S.lampOn ? light : null, emit, warm: S.lampOn ? 1 : 0 });
    shadedC.x.putImageData(out, 0, 0);
    textColours();
    spriteCache.clear();
    return true;
  }

  function paintView() {
    const w = G.win;
    const key = [S.now.getHours(), S.now.getMinutes(), kq(S.night), Sky.kind(), w.w, w.h, S.now.toDateString()].join("|");
    if (key === viewKey && viewC) return false;
    viewKey = key;
    viewC = Sky.paintView(w.w, w.h);
    return true;
  }

  function compose() {
    if (!G || !shadedC) return;
    if (viewC) ctx.drawImage(viewC, G.win.x, G.win.y);
    ctx.drawImage(shadedC.c, 0, 0);
    const k = kq(S.night) * (1 - lightAt(G.clock.cx, G.clock.cy, S.lampOn));
    Decor.clockHands(ctx, G, S.now, k);
  }

  const lightAt = (x, y, on) => (on && light ? light[Math.max(0, Math.min(G.H - 1, y | 0)) * G.W + Math.max(0, Math.min(G.W - 1, x | 0))] : 0);

  function textColours() {
    if (!G) return;
    const b = G.banner;
    const kb = kq(S.night) * (1 - lightAt(b.cx, b.y + 7, S.lampOn));
    const ink = Array.isArray(S.goalInk) ? S.goalInk : PIX.T("ink");
    const col = S.focus ? ink : PIX.mix(ink, PIX.T("paper"), 0.45);
    goalEl.style.color = PIX.rgb(PIX.grade(kb ? PIX.dusk(col, kb) : col));
    const c = G.calendar;
    slipEl.style.color = PIX.css("ink", kq(S.night) * (1 - lightAt(c.x + (c.w >> 1), c.y + 32, S.lampOn)));
  }

  function size(c, w, h, x, y) {
    c.width = w; c.height = h;
    c.style.width = w * M.css + "px";
    c.style.height = h * M.css + "px";
    if (x !== undefined) { c.style.left = x * M.css + "px"; c.style.top = y * M.css + "px"; }
    const cx = c.getContext("2d");
    cx.imageSmoothingEnabled = false;
    return cx;
  }

  function build() {
    stats.builds++;
    const rect = root.getBoundingClientRect();
    const cw = Math.max(200, rect.width || innerWidth), ch = Math.max(150, rect.height || innerHeight);
    M = PIX.measure(cw, ch, window.devicePixelRatio || 1);
    G = Layout.compute(M.lw, M.lh);
    refreshClock();
    G.banner.w = bannerWidth();
    S.slipFits = M.css * 6 >= 9;
    stage.style.width = M.lw * M.css + "px";
    stage.style.height = M.lh * M.css + "px";
    document.documentElement.style.setProperty("--casa-px", M.css + "px");
    ctx = size(canvas, M.lw, M.lh, 0, 0);
    paintBase();
    shade();
    viewKey = "";
    paintView();
    compose();
    placeText();
    placeHots();
    placeSprites();
    fallStart();
  }

  // ---------------------------------------------------------------- text
  function placeText() {
    const b = G.banner, css = M.css;
    const x0 = Math.round(b.cx - b.w / 2);
    Object.assign(goalEl.style, { left: (x0 + 4) * css + "px", top: b.y * css + "px", width: (b.w - 8) * css + "px", height: (b.h - 2) * css + "px", font: textFont(goalFontPx()) });
    goalEl.firstElementChild.textContent = goalText();
    goalEl.hidden = S.hidden.has("goal");
    goalEl.classList.toggle("empty", !S.focus);
    const c = G.calendar;
    const fpx = Math.max(9, Math.round(4 * css));
    slipEl.textContent = S.slipFits && S.calNext ? S.calNext.title : "";
    slipEl.hidden = S.hidden.has("calendar");
    Object.assign(slipEl.style, { left: (c.x + 2) * css + "px", top: (c.y + 33) * css + "px", width: (c.w - 4) * css + "px", height: 6 * css + "px", fontSize: fpx + "px", lineHeight: 6 * css + "px" });
    textColours();
  }

  // ---------------------------------------------------------------- put away / bring back
  // Every object of the room can be put away (its panel has "Put away"); a box shows up on the floor
  // with what was put away, and its panel brings things back. Saved in the room state (Kept).
  const ITEMS = {
    goal: "Today's goal sign", calendar: "Wall calendar", cork: "Cork board", tv: "TV", typewriter: "Typewriter",
    agenda: "Agenda", headphones: "Headphones", today: "Mug (today's note)", strip: "Power strip", chair: "Chair",
    backpack: "Backpack", orbit: "Photo frame (Orbit)", lighthouse: "Lighthouse figurine", kitchen: "Arrow to the kitchen",
    garden: "Arrow to the garden", widget: "Add-your-own ticket", buddy: "Pebble, the penguin", pet: "Biscuit, the dog",
  };
  // Pebble follows the "buddy" setting (also in Settings > Casa), so the box and the settings tab never disagree
  const hiddenIds = () => Array.from(S.hidden).filter((id) => ITEMS[id] && id !== "buddy").concat(S.buddyOn ? [] : ["buddy"]);
  const listOf = (v) => new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  function readItems() {
    const h = listOf(Kept.get("hidden", [])), t = listOf(Kept.get("tagsSeen", []));
    const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    const changed = !same(h, S.hidden) || !same(t, S.tagsSeen);
    S.hidden = h; S.tagsSeen = t;
    return changed;
  }
  function setHidden(id, on) {
    if (!ITEMS[id]) return false;
    if (id === "buddy") {
      S.buddyOn = !on;
      fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ buddy: !on }) })
        .catch(() => {})
        .then(() => document.dispatchEvent(new CustomEvent("casa:data", { detail: { kind: "settings", source: "room:box" } })));
      if (G) build();
      return true;
    }
    if (on) S.hidden.add(id); else S.hidden.delete(id);
    Kept.set("hidden", Array.from(S.hidden));
    if (G) build();
    return true;
  }
  window.CasaRoomItems = {
    names: ITEMS,
    can: (id) => !!ITEMS[id],
    hidden: hiddenIds,
    count: () => hiddenIds().length,
    hide: (id) => setHidden(id, true),
    show: (id) => setHidden(id, false),
    showAll: () => { S.hidden.clear(); Kept.set("hidden", []); if (!S.buddyOn) setHidden("buddy", false); else if (G) build(); },
  };

  // ---------------------------------------------------------------- hotspots
  const labelOf = (h) => (typeof h.label === "function" ? h.label() : h.label) || h.id;
  let buttons = new Map();
  function placeHots() {
    const css = M.css;
    const seen = new Set();
    const all = hots.concat(liveHots());
    // Stack by size: a small object (the power strip on the floor) stays clickable even when a big
    // one (the chair) overlaps it. Largest area gets the lowest z-index.
    const bySize = all.slice().sort((a, b) => b.w * b.h - a.w * a.h);
    all.forEach((h) => {
      seen.add(h.id);
      let b = buttons.get(h.id);
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.className = "casa-hot";
        b.dataset.id = h.id;
        b.addEventListener("click", (e) => { e.preventDefault(); activate(b.dataset.id); });
        b.addEventListener("pointerenter", () => { showLabel(b.dataset.id); if (b.dataset.id === "buddy" && bud.mood !== "sleep") buddyPlay("wave", 1400); });
        b.addEventListener("pointerleave", hideLabel);
        b.addEventListener("focus", () => showLabel(b.dataset.id));
        b.addEventListener("blur", hideLabel);
        hotsEl.appendChild(b);
        buttons.set(h.id, b);
      }
      b._hot = h;
      b.style.zIndex = String(bySize.indexOf(h) + 1);
      Object.assign(b.style, { left: h.x * css + "px", top: h.y * css + "px", width: h.w * css + "px", height: h.h * css + "px" });
      b.setAttribute("aria-label", labelOf(h));
    });
    buttons.forEach((b, id) => { if (!seen.has(id)) { b.remove(); buttons.delete(id); } });
    placeTags();
  }

  // yellow tags pinned on the doors to packs that are not out yet, and on the "add your own" ticket
  const TAGS = { chair: "Coming soon", backpack: "Coming soon", orbit: "Coming soon", lighthouse: "Coming soon",
    kitchen: "Kitchen \u00b7 soon", garden: "Garden \u00b7 soon", widget: "Add yours +" };
  const tagEls = new Map();
  function placeTags() {
    const css = M.css, seen = new Set();
    hots.forEach((h) => {
      const text = TAGS[h.id];
      if (!text || S.tagsSeen.has(h.id)) return;
      seen.add(h.id);
      let t = tagEls.get(h.id);
      if (!t) { t = el("span", "casa-tag", stage); t.setAttribute("aria-hidden", "true"); tagEls.set(h.id, t); }
      t.textContent = text;
      t.classList.toggle("add", h.id === "widget");
      t.classList.toggle("end", h.id === "kitchen");
      t.style.left = (h.id === "kitchen" ? h.x + h.w : h.x + h.w / 2) * css + "px";
      t.style.top = h.y * css + "px";
    });
    tagEls.forEach((t, id) => { if (!seen.has(id)) { t.remove(); tagEls.delete(id); } });
  }

  function liveHots() {
    const out = [];
    if (S.buddyOn) {
      const bd = G.buddy, bw = Math.round(bud.w * 0.7), bh = Math.round(bud.h * 0.9);
      out.push({ id: "buddy", x: bd.cx - (bw >> 1), y: bd.base - bh, w: bw, h: bh, label: "Pebble" });
    }
    if (S.hidden.has("pet")) return out;
    const pw = Math.round(pet.w * 0.7), ph = Math.round(pet.h * 0.75);
    out.push({ id: "pet", x: Math.round(pet.x - pw / 2), y: G.pet.y - ph, w: pw, h: ph, label: "Biscuit" });
    return out;
  }

  let labelFor = null;
  function showLabel(id) {
    const b = buttons.get(id);
    if (!b) return;
    labelFor = id;
    const h = b._hot, css = M.css;
    labelEl.textContent = labelOf(h);
    labelEl.hidden = false;
    const sw = M.lw * css;
    const lw = labelEl.offsetWidth || 120;
    let cx = (h.x + h.w / 2) * css;
    cx = Math.max(lw / 2 + 4, Math.min(sw - lw / 2 - 4, cx));
    let top = h.y * css - 6;
    labelEl.classList.toggle("below", top < labelEl.offsetHeight + 4);
    if (top < labelEl.offsetHeight + 4) top = (h.y + h.h) * css + 6 + labelEl.offsetHeight;
    labelEl.style.left = cx + "px";
    labelEl.style.top = top + "px";
  }
  function hideLabel() { labelEl.hidden = true; labelFor = null; }

  function activate(id) {
    if (id === "lamp") {
      const next = { auto: "on", on: "off", off: "auto" }[S.lampMode] || "auto";
      S.lampMode = next;
      Kept.set("lamp", next);
      updateLamp(true);
      if (labelFor === "lamp") showLabel("lamp");
      return;
    }
    if (id === "pet") petHappy();
    if (TAGS[id] && !S.tagsSeen.has(id)) {          // the first click retires its yellow tag for good
      S.tagsSeen.add(id);
      Kept.set("tagsSeen", Array.from(S.tagsSeen));
      placeTags();
    }
    if (id === "clock") return;                     // label only
    if (id === "buddy") buddyPlay("happy", 2400);
    document.dispatchEvent(new CustomEvent("casa:open", { detail: { id } }));
  }

  // ---------------------------------------------------------------- sprites
  const spriteCache = new Map();
  /* Render one sprite frame once and keep it: a repaint is then one
     clearRect and one drawImage. */
  function spriteFrame(key, w, h, draw, shadeK) {
    let c = spriteCache.get(key);
    if (c) return c;
    const raw = PIX.buf(w, h);
    try { draw(raw.x); } catch (e) { console.error("[casa] sprite", e); }
    if (shadeK !== null) {
      const img = raw.x.getImageData(0, 0, w, h);
      const out = raw.x.createImageData(w, h);
      PIX.shade(img, out, { k: shadeK });
      raw.x.putImageData(out, 0, 0);
    }
    c = raw.c;
    if (spriteCache.size > 96) spriteCache.clear();
    spriteCache.set(key, c);
    return c;
  }
  const themeSprite = (which) => {
    const t = PIX.theme();
    const o = t && t[which];
    return o && typeof o.draw === "function" ? o : null;
  };

  // neutral placeholders when no theme is loaded (a round bird, a small cat)
  function placeholderBuddy(x, cx, by, frame, mood) {
    const f = (c, px, py, w, h) => { x.fillStyle = PIX.fs(c); x.fillRect(cx + px, by + py, w, h); };
    const bob = mood === "happy" ? (frame % 2 ? -2 : 0) : frame % 4 === 2 ? 1 : 0;
    f("mist", -6, -15 + bob, 12, 13);
    f("mist", -5, -16 + bob, 10, 1);
    f("pale", -4, -11 + bob, 8, 8);
    if (mood === "sleep" || mood === "blink") { f("ink", -3, -12 + bob, 2, 1); f("ink", 2, -12 + bob, 2, 1); }
    else { f("ink", -3, -13 + bob, 2, 2); f("ink", 2, -13 + bob, 2, 2); }
    f("gold", -1, -10 + bob, 2, 1);
    f("gold", -4, -2, 3, 2); f("gold", 2, -2, 3, 2);
  }
  function placeholderPet(x, cx, by, gait, frame, right) {
    const s = right ? 1 : -1;
    const f = (c, px, py, w, h) => { x.fillStyle = PIX.fs(c); x.fillRect(s > 0 ? cx + px : cx - px - w, by + py, w, h); };
    const low = gait === "sleep" || gait === "lie" ? 3 : 0;
    const step = gait === "walk" || gait === "trot" ? frame % 2 : 0;
    f("coal", -9, -9 + low, 16, 7 - low);
    f("coal", 5, -13 + low, 7, 7);
    f("coal", 6, -15 + low, 2, 2); f("coal", 10, -15 + low, 2, 2);
    if (low) f("slate", 7, -10 + low, 4, 1);
    else { f("gold", 7, -11, 1, 1); f("gold", 10, -11, 1, 1); }
    f("coal", -12, -10 + low - (gait === "wag" ? frame % 2 : 0), 3, 2);
    if (!low) { f("coal", -8 + step, -2, 2, 2); f("coal", 3 - step, -2, 2, 2); }
  }

  // --- buddy: idle with a blink now and then, wave on hover, happy on click, sleep at night
  const ZTOP = 10;                       // room for the sleep z's above the box
  const bud = { mood: "idle", frame: 0, until: 0, nextBlink: 0, w: 24, h: 24 };
  let buddyLoop = null;
  function buddyDims() {
    const t = themeSprite("buddy");
    bud.w = (t && t.w) || 24; bud.h = (t && t.h) || 24;
  }
  function buddyMoodNow() {
    const t = Date.now();
    if (bud.until > t && (bud.mood === "happy" || bud.mood === "wave" || bud.mood === "blink")) return bud.mood;
    if (S.hour >= 23 || S.hour < 6) return "sleep";
    if (!S.calm && !REDUCED && t >= bud.nextBlink) {
      bud.nextBlink = t + 4000 + Math.floor(Math.random() * 3000);
      bud.until = t + 3 * 95;
      bud.frame = -1;
      return "blink";
    }
    return "idle";
  }
  function buddyMs(m) {
    const t = themeSprite("buddy");
    const ms = t && t.moods && t.moods[m] && t.moods[m].ms;
    return Math.max(80, ms || ({ idle: 600, blink: 90, wave: 170, sleep: 750, talk: 140, happy: 320 }[m] || 600));
  }
  function buddyN(m) {
    const t = themeSprite("buddy");
    return (t && t.moods && t.moods[m] && t.moods[m].n) || 4;
  }
  const stats = { buddy: 0, pet: 0, builds: 0, shades: 0, views: 0 };
  function buddyTick() {
    if (!G) return;
    if (!S.buddyOn) { if (buddyLoop) buddyLoop.set(60000); return; }
    stats.buddy++;
    const prev = bud.mood;
    bud.mood = buddyMoodNow();
    bud.frame = bud.mood !== prev && bud.mood !== "blink" ? 0 : (bud.frame + 1) % buddyN(bud.mood);
    if (S.calm || REDUCED) bud.frame = 0;
    const bd = G.buddy;
    const k = kq(kq(S.night) * (1 - lightAt(bd.cx, bd.base - 8, S.lampOn)));
    const t = themeSprite("buddy");
    const W = bud.w, H = bud.h + ZTOP;
    const c = spriteFrame(`b|${bud.mood}|${bud.frame}|${k}|${t ? 1 : 0}`, W, H, (x) => {
      if (t) t.draw(x, 0, ZTOP, 1, bud.frame, bud.mood, { k });
      else placeholderBuddy(x, W >> 1, H, bud.frame, bud.mood);
    }, t ? null : k);
    const bx = buddyC.getContext("2d");
    bx.clearRect(0, 0, W, H);
    bx.drawImage(c, 0, 0);
    if (buddyLoop) buddyLoop.set(S.calm || REDUCED ? 60000 : buddyMs(bud.mood));
  }
  function buddyPlay(mood, ms) {
    if (S.calm || REDUCED) return;
    bud.mood = mood; bud.frame = -1; bud.until = Date.now() + ms;
    if (buddyLoop) buddyLoop.poke();
  }

  // --- pet: sits, lies down after lunch, sleeps at night, wanders now and then
  const pet = { x: 0, target: null, gait: "sit", frame: 0, right: false, queue: [], wagUntil: 0, w: 32, h: 20 };
  let petLoop = null, petWander = null;
  function petDims() {
    const t = themeSprite("pet");
    pet.w = (t && t.w) || 32; pet.h = (t && t.h) || 20;
  }
  const petGaitInfo = (g) => { const t = themeSprite("pet"); return (t && t.gaits && t.gaits[g]) || null; };
  function restGait() {
    const onBed = G && Math.abs(pet.x - G.pet.home) < 3;
    if (S.hour >= 22 || S.hour < 7) return "sleep";
    if (onBed) return S.hour >= 13 && S.hour < 16 ? "sleep" : "lie";
    return "sit";
  }
  function petPlace() {
    const css = M.css;
    petC.style.left = Math.round(pet.x - pet.w / 2) * css + "px";
    petC.style.top = (G.pet.y - pet.h) * css + "px";
    const b = buttons.get("pet");
    const h = liveHots().find((x) => x.id === "pet");
    if (b && h) { b._hot = h; b.style.left = h.x * css + "px"; }
  }
  function petTick() {
    if (!G) return;
    if (S.hidden.has("pet")) { if (petLoop) petLoop.set(60000); return; }
    stats.pet++;
    const t = Date.now();
    let next;
    if (pet.queue.length) next = pet.queue.shift();
    else if (pet.target !== null) {
      next = "walk";
      const d = pet.target - pet.x;
      const info = petGaitInfo("walk");
      const step = (info && info.step) || 1.5;
      if (Math.abs(d) <= step) { pet.x = pet.target; pet.target = null; next = "stand"; Kept.set("pet.x", +(pet.x / G.W).toFixed(3)); }
      else { pet.right = d > 0; pet.x += pet.right ? step : -step; }
    } else if (t < pet.wagUntil) next = "wag";
    else next = restGait();
    pet.frame = next === pet.gait ? pet.frame + 1 : 0;
    pet.gait = next;
    const info = petGaitInfo(pet.gait);
    const n = (info && info.n) || 2;
    if (S.calm || REDUCED) pet.frame = 0;
    const p = G.pet;
    const k = kq(kq(S.night) * (1 - lightAt(pet.x, p.y - 6, S.lampOn)));
    const tp = themeSprite("pet");
    const f = pet.frame % n;
    const c = spriteFrame(`p|${pet.gait}|${f}|${pet.right ? 1 : 0}|${k}|${tp ? 1 : 0}`, pet.w, pet.h, (x) => {
      if (tp) tp.draw(x, 0, 0, 1, pet.gait, f, { right: pet.right, k });
      else placeholderPet(x, pet.w >> 1, pet.h, pet.gait, f, pet.right);
    }, tp ? null : k);
    const px = petC.getContext("2d");
    px.clearRect(0, 0, pet.w, pet.h);
    px.drawImage(c, 0, 0);
    petPlace();
    const ms = info && info.ms ? info.ms : 400;
    const resting = pet.target === null && !pet.queue.length && t >= pet.wagUntil;
    if (petLoop) petLoop.set(S.calm || REDUCED ? 60000 : resting ? Math.max(ms, 900) : Math.max(80, ms));
  }
  function petHappy() {
    pet.wagUntil = Date.now() + 1800;
    if (pet.gait === "lie" || pet.gait === "sleep") pet.queue = ["sit", "stand"];
    if (petLoop) petLoop.poke();
  }
  function scheduleWander() {
    if (REDUCED || S.calm) { if (petWander) { petWander.stop(); petWander = null; } return; }
    // one clock only: a data refresh must not push the next walk further away (it used to restart the wait)
    if (petWander) return;
    const h = Sky.hour();
    const night = h >= 22 || h < 7;   // the afternoon nap is not night: it still gets up now and then
    // by day a walk every 40 s to 2 min; at night a short stroll every 3 to 6 minutes
    const wait = night ? 180000 + Math.floor(Math.random() * 180000) : 40000 + Math.floor(Math.random() * 80000);
    petWander = Pace.after("pet-wander", wait, () => {
      petWander = null;
      if (G) {
        const p = G.pet;
        const home = Math.abs(pet.x - p.home) < 3;
        const spot = Math.round(p.min + Math.random() * (p.max - p.min));
        // out to a spot and back home; at night the stroll stays short and it goes back to bed
        const to = home ? (night ? Math.round(p.home + (spot - p.home) * 0.4) : spot) : p.home;
        if (to !== null && Math.abs(to - pet.x) >= 3) {
          pet.queue = pet.gait === "lie" || pet.gait === "sleep" ? ["sit", "stand"] : ["stand"];
          pet.target = to;
          if (petLoop) petLoop.poke();
        }
      }
      scheduleWander();
    });
  }

  function placeSprites() {
    buddyDims(); petDims();
    const bd = G.buddy, p = G.pet;
    size(buddyC, bud.w, bud.h + ZTOP, bd.cx - (bud.w >> 1), bd.base - bud.h - ZTOP);
    buddyC.style.display = S.buddyOn ? "" : "none";
    petC.style.display = S.hidden.has("pet") ? "none" : "";
    size(petC, pet.w, pet.h);
    const saved = Kept.get("pet.x", null);
    const fx = typeof saved === "number" && saved > 0 && saved < 1 ? saved * G.W : p.home;
    pet.x = Math.round(Math.max(p.min, Math.min(p.max, fx)));
    pet.target = null;
    spriteCache.clear();
    if (!buddyLoop) buddyLoop = Pace.every("buddy", 600, buddyTick, { now: true }); else buddyLoop.poke();
    if (!petLoop) petLoop = Pace.every("pet", 1200, petTick, { now: true }); else petLoop.poke();
    petPlace();
    tvPlace();
  }

  // --- the TV plays the channel picked in its panel: the panel's own drawings (window.CasaTV),
  // shrunk to the screen of the set. At most one picture every 400 ms; calm and reduced motion
  // show a still frame; Pace stops it while the room is paused.
  let tvLoop = null, tvScr = null, tvOff = null, tvT0 = 0;
  function tvChannel() {
    const n = Number(Kept.get("tvChannel", NaN));
    return Number.isInteger(n) && n >= 0 ? n : (window.CasaTV ? window.CasaTV.DEFAULT : 0);
  }
  function tvPlace() {
    const r = Decor.tvRect, TV = window.CasaTV;
    if (!r || !TV || S.hidden.has("tv")) { tvC.style.display = "none"; return; }
    tvC.style.display = "";
    size(tvC, r.w, r.h, r.x, r.y);
    if (!tvScr) {
      tvOff = document.createElement("canvas");
      tvOff.width = TV.W; tvOff.height = TV.H;
      tvScr = TV.makeScreen(tvOff.getContext("2d"), { wx: () => Sky.weather(), still: () => S.calm || REDUCED });
      tvT0 = performance.now();
    }
    tvTick();
  }
  function tvTick() {
    const r = Decor.tvRect;
    if (!tvScr || !r || !G || S.hidden.has("tv")) return;
    const list = tvScr.CHANNELS, ch = ((tvChannel() % list.length) + list.length) % list.length;
    const still = S.calm || REDUCED;
    list[ch].draw(still ? 240 : (performance.now() - tvT0) / 100);
    const c = tvC.getContext("2d");
    c.imageSmoothingEnabled = true;
    c.clearRect(0, 0, r.w, r.h);
    c.drawImage(tvOff, 0, 0, r.w, r.h);
    stats.tvPaints = (stats.tvPaints || 0) + 1;
    const ms = still ? 60000 : Math.max(400, list[ch].ms);
    if (!tvLoop) tvLoop = Pace.every("tv", ms, tvTick); else tvLoop.set(ms);
  }

  // --- weather particles on the glass
  let fallLoop = null, fallRect = null;
  function fallStart() {
    fallRect = Decor.glass(G);
    size(fallC, fallRect.w, fallRect.h, fallRect.x, fallRect.y);
    // keep the drops inside the arch
    const rr = fallRect.r * M.css;
    fallC.style.clipPath = `inset(0 round ${rr}px ${rr}px 0 0)`;
    const K = Sky.kind();
    const moving = (K === "rain" || K === "snow") && !REDUCED && !S.calm;
    if (fallLoop) { fallLoop.stop(); fallLoop = null; }
    const fx = fallC.getContext("2d");
    const step = () => {
      Sky.drawFall(fx, fallRect.w, fallRect.h, moving ? Date.now() : 0);
      if (K === "rain" || K === "snow") { fx.clearRect(fallRect.mullion, 0, 3, fallRect.h); fx.clearRect(0, fallRect.transom, fallRect.w, 3); }
    };
    step();
    if (moving) fallLoop = Pace.every("weather-fall", K === "rain" ? 100 : 160, step);
  }

  // ---------------------------------------------------------------- clock
  function refreshClock() {
    S.now = Sky.now();
    S.hour = Sky.hour();
    S.night = Sky.night();
    S.season = Sky.season();
    const ch = Kept.get("tv.channel", null);
    S.tvChannel = typeof ch === "number" ? ch : S.season ? S.season.doy : 0;
    S.lampOn = S.lampMode === "on" || (S.lampMode === "auto" && S.night > 0.22);
    S.sunPatch = S.night < 0.12 && !["overcast", "rain", "snow", "fog"].includes(Sky.kind());
  }

  let lastDate = "", lastKind = "";
  function minute() {
    if (!G) return;
    const wasLamp = S.lampOn, wasTv = S.tvChannel, wasSun = S.sunPatch;
    refreshClock();
    const date = S.now.toDateString();
    if (lastDate && date !== lastDate) { lastDate = date; loadAll(); rebuild(); return; }
    lastDate = date;
    if (S.lampOn !== wasLamp || S.tvChannel !== wasTv || S.sunPatch !== wasSun) { paintBase(); placeHots(); }
    shade();
    paintView();
    compose();
    const K = Sky.kind();
    if (K !== lastKind) { lastKind = K; fallStart(); }
  }
  function updateLamp(force) {
    const was = S.lampOn;
    refreshClock();
    if (force || was !== S.lampOn) { paintBase(); shade(); compose(); placeHots(); }
  }

  // ---------------------------------------------------------------- data
  const get = (route) => fetch("/api/" + route).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function loadFocus() {
    return get("focus").then((r) => {
      S.focusLoaded = true;
      S.focus = r && typeof r.focus === "string" ? r.focus.replace(/\s+/g, " ").trim() : "";
    });
  }
  function loadTasks() {
    return get("tasks").then((r) => {
      S.openTasks = r && Array.isArray(r.today) ? r.today.filter((t) => t && !t.done).length : null;
    });
  }
  function loadNotes() {
    return get("notes").then((r) => { S.notes = r && Array.isArray(r.notes) ? r.notes : []; });
  }
  function loadCalendar() {
    const d = Sky.now();
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
    return get(`calendar?from=${ymd(d)}&to=${ymd(to)}`).then((r) => {
      S.calNext = null;
      if (!r || !Array.isArray(r.events)) return;
      const now = Sky.now().getTime();
      const today = ymd(Sky.now());
      const evs = r.events.map((e) => ({ e, s: Date.parse(e.start), en: Date.parse(e.end || e.start) }))
        .filter((x) => isFinite(x.s) && (x.en > now || (x.e.allDay && ymd(new Date(x.s)) === today)))
        .sort((a, b) => a.s - b.s);
      const nx = evs.find((x) => !x.e.allDay && x.s >= now) || evs[0];
      if (!nx) return;
      const sd = new Date(nx.s);
      const title = String(nx.e.title || "Event").replace(/\s+/g, " ").trim().slice(0, 120);
      const when = ymd(sd) === today ? (nx.e.allDay ? "TODAY" : sd.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }))
        : Decor.WEEKDAYS[sd.getDay()];
      S.calNext = { when, title };
    });
  }
  function loadSettings() {
    return get("settings").then((r) => {
      if (!r) return;
      S.calm = !!r.calm;
      S.buddyOn = r.buddy !== false;
    });
  }
  function loadAll() {
    return Promise.all([loadFocus(), loadTasks(), loadNotes(), loadCalendar(), loadSettings()]);
  }

  let rebuildT = null;
  function rebuild() {
    if (rebuildT) rebuildT.stop();
    rebuildT = Pace.after("room-rebuild", 40, () => { if (root) build(); });
  }

  function battery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then((b) => {
      const cat = () => (b.charging ? "c" : b.level < 0.15 ? "r" : b.level < 0.3 ? "a" : "g");
      let last = "";
      const upd = () => {
        S.battery = { level: b.level, charging: b.charging };
        const c = cat();
        if (c !== last) { last = c; if (G) rebuild(); }
        if (labelFor === "strip") showLabel("strip");
      };
      b.addEventListener("levelchange", upd);
      b.addEventListener("chargingchange", upd);
      upd();
    }).catch(() => {});
  }

  // ---------------------------------------------------------------- hints
  /* casa:hint {text, pulse}: the buddy says the text for a few seconds, and
     with pulse every object glows once so the user sees what can be clicked. */
  let sayT = null, pulseT = null;
  function say(text) {
    if (!text || !G) return;
    sayEl.textContent = String(text).slice(0, 200);
    sayEl.hidden = false;
    const css = M.css, bd = G.buddy;
    sayEl.style.left = bd.cx * css + "px";
    sayEl.style.top = (bd.base - bud.h - 2) * css + "px";
    buddyPlay("talk", 2400);
    if (sayT) sayT.stop();
    sayT = Pace.after("buddy-say", 7000, () => { sayEl.hidden = true; });
  }
  function pulse() {
    if (REDUCED) return;
    hotsEl.classList.remove("casa-pulse");
    void hotsEl.offsetWidth;
    hotsEl.classList.add("casa-pulse");
    if (pulseT) pulseT.stop();
    pulseT = Pace.after("hot-pulse", 1800, () => hotsEl.classList.remove("casa-pulse"));
  }
  function onHint(e) {
    const d = (e && e.detail) || {};
    if (d.text) say(d.text);
    if (d.pulse) pulse();
  }

  // ---------------------------------------------------------------- start
  function start() {
    dom();
    S.lampMode = Kept.get("lamp", "auto");
    readItems();
    Kept.when(() => { if (readItems() && G) build(); });
    Kept.when(() => {
      const m = Kept.get("lamp", "auto");
      if (m !== S.lampMode) { S.lampMode = m; if (G) updateLamp(true); }
    });
    Sky.start();
    // new weather or settings: same path as the minute tick (lamp, daylight patch, view, particles)
    Sky.on(() => { if (!G) return; viewKey = ""; minute(); });
    build();
    lastDate = S.now.toDateString();
    lastKind = Sky.kind();
    loadAll().then(rebuild);
    battery();
    Pace.every("room-minute", 60000, minute);
    Pace.every("room-data", 5 * 60 * 1000, () => Promise.all([loadFocus(), loadTasks(), loadNotes()]).then(rebuild));
    Pace.every("room-calendar", 15 * 60 * 1000, () => loadCalendar().then(rebuild));
    scheduleWander();
    document.addEventListener("casa:data", (e) => {
      const k = e.detail && e.detail.kind;
      if (k === "tv") { tvTick(); return; }
      const job = k === "focus" ? loadFocus() : k === "tasks" ? loadTasks() : k === "notes" ? loadNotes()
        : k === "settings" ? Promise.all([loadSettings(), loadCalendar()]) : k === "weather" ? null : loadAll();
      if (job) job.then(() => { rebuild(); scheduleWander(); });
    });
    Pace.on("resume", () => rebuild());
    document.addEventListener("casa:hint", onHint);
    let resizeT = null;
    const onResize = () => { if (resizeT) resizeT.stop(); resizeT = Pace.after("room-resize", 120, build); };
    if (typeof ResizeObserver === "function") new ResizeObserver(onResize).observe(root);
    else addEventListener("resize", onResize);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  return {
    state: S,
    hots: () => hots.concat(G ? liveHots() : []).map((h) => ({ id: h.id, x: h.x, y: h.y, w: h.w, h: h.h, label: labelOf(h) })),
    metrics: () => ({ M, G }),
    stats: () => Object.assign({}, stats),
    rebuild: () => build(),
    open: activate,
    say,
  };
})();
