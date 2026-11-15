/* Objects with hotspots: goal garland and sign, tear-off calendar, round cork
   board, portable TV, typewriter, agenda binder, headphones on a stand, power
   strip, backpack, spindle chair.

   Each painter gets (D, tw): tw is CasaTheme.tweak[id] or {}. tw.shape and
   tw.pattern pick a silhouette and a surface variant; tw.colors gives role
   colours (pre-grade) that replace the default tones; tw.tones is already in
   front of the palette (PIX.withTweak). A missing field means the default
   drawing. Each painter registers its hotspot; a click dispatches casa:open
   {id} (room.js). The buddy and the pet are live sprites, see room.js. */
Decor.MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
Decor.WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

Decor.objects = function (D) {
  ["goal", "calendar", "cork", "tv", "typewriter", "agenda", "headphones", "strip", "backpack", "chair"].forEach((id) => {
    if (PIX.tweak(id).hidden || (D.state.hidden && D.state.hidden.has(id))) return;   // theme, or put away by the user
    try { PIX.withTweak(id, (tw) => Decor.obj[id](D, tw)); } catch (e) { console.error("[casa] object " + id, e); }
  });
};

Decor.obj = {};

// put the four corner pixels back to what is behind them
Decor.round = function (D, x, y, w, h, behind) {
  D.p(x, y, behind); D.p(x + w - 1, y, behind); D.p(x, y + h - 1, behind); D.p(x + w - 1, y + h - 1, behind);
};
// a role colour lightened (k > 0) or darkened (k < 0); a palette name falls back
Decor.shadeOf = (c, k, fallback) => (Array.isArray(c) ? PIX.mix(c, k > 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(k)) : fallback);

// --- goal: a garland of flags across the desk wall, and a sign hanging from it with the goal (DOM text)
Decor.obj.goal = function (D, tw) {
  const { g } = D, b = g.banner, gl = g.garland;
  const c = D.roles(tw, { paper: "paper", ink: "ink", cord: "umber", flagA: "gold", flagB: "teal", flagC: "rose" });
  const x0 = Math.round(b.cx - b.w / 2), y = b.y, w = b.w, h = b.h;
  // the cord sags a little between two nails
  const sag = (x) => { const t = (x - gl.x0) / Math.max(1, gl.x1 - gl.x0); return Math.round(gl.y + 5 * 4 * t * (1 - t)); };
  D.p(gl.x0, gl.y - 1, "ink"); D.p(gl.x1, gl.y - 1, "ink");
  for (let x = gl.x0; x <= gl.x1; x++) D.p(x, sag(x), c.cord);
  if (tw.pattern !== "plain") {
    const flags = [c.flagA, c.flagB, c.flagC];
    let i = 0;
    for (let x = gl.x0 + 4; x < gl.x1 - 8; x += 12, i++) {
      if (x + 8 > x0 - 4 && x < x0 + w + 4) continue;          // leave the sign's span clear
      const fy = sag(x + 4) + 1;
      for (let r = 0; r < 8; r++) D.r(x + (r >> 1), fy + r, 8 - (r >> 1) * 2, 1, flags[i % 3]);
    }
  }
  // the sign on two short strings
  D.r(x0 + 6, sag(x0 + 6), 1, y - sag(x0 + 6), c.cord);
  D.r(x0 + w - 7, sag(x0 + w - 7), 1, y - sag(x0 + w - 7), c.cord);
  D.dith(x0 + 2, y + 2, w, h, "plasd", "plast", 0.5);
  D.r(x0, y, w, h, c.paper);
  D.r(x0, y, w, 1, Decor.shadeOf(c.paper, 0.4, "bone"));
  D.r(x0, y + h - 1, w, 1, "tan");
  D.r(x0 + w - 1, y, 1, h, "cream");
  D.p(x0 + 6, y + 1, "ink"); D.p(x0 + w - 7, y + 1, "ink");
  D.state.goalInk = c.ink;
  D.hot("goal", x0 - 2, y - 2, w + 4, h + 2, () => (D.state.focus ? "Today's goal - click to edit" : "Write today's goal"));
};

// --- tear-off calendar: nail and string, navy header with the month, the day, the next event
Decor.obj.calendar = function (D, tw) {
  const { g } = D, cal = g.calendar, S = D.state;
  const c = D.roles(tw, { header: "verm", digits: "bone", paper: "paper", ring: "steel", nail: "ink" });
  const x = cal.x, y = cal.y, w = cal.w, h = cal.h, t = S.now, mid = x + (w >> 1);
  // nail and string triangle
  D.p(mid, y - 6, c.nail);
  for (let i = 1; i <= 5; i++) { D.p(mid - i * 2, y - 6 + i, "dark"); D.p(mid + i * 2, y - 6 + i, "dark"); }
  D.dith(x + 2, y + 2, w, h + 1, "plasd", "plast", 0.5);
  D.r(x, y, w, h, c.paper);
  D.r(x + w - 1, y, 1, h, "cream");
  // two torn edges at the bottom: the pages under today's
  for (let i = 0; i < w; i++) {
    if (i % 3 !== 2) D.p(x + i, y + h, "cream");
    if (i % 4 !== 1 && i > 0 && i < w - 1) D.p(x + i, y + h + 1, "pale");
  }
  // header: the month, centred
  D.r(x, y, w, 10, c.header);
  D.r(x, y + 9, w, 1, Decor.shadeOf(c.header, -0.3, "rust"));
  const mon = Decor.MONTHS[t.getMonth()];
  D.x.fillStyle = D.tone(c.digits);
  Font.draw(D.x, mon, Math.round(x + w / 2 - Font.width(mon) / 2), y + 3, 1);
  // the day, at twice the font size
  const day = String(t.getDate());
  D.x.fillStyle = D.tone("ink");
  Font.draw(D.x, day, Math.round(x + w / 2 - Font.width(day, 2) / 2), y + 13, 2);
  D.r(x + 2, y + 25, w - 4, 1, "pale");
  // the next event: when in the pixel font ("16:00", "TODAY", "WED"), the title as DOM text below
  const nx = S.calNext;
  if (nx) {
    D.x.fillStyle = D.tone("verm");
    Font.draw(D.x, nx.when, Math.round(x + w / 2 - Font.width(nx.when) / 2), y + 27, 1);
    if (!S.slipFits) D.r(x + 4, y + 35, w - 8, 1, "mist");
  } else {
    for (let i = 0; i < 3; i++) D.r(x + 4, y + 28 + i * 3, w - 8 - (i % 2) * 6, 1, "pale");
  }
  D.hot("calendar", x - 1, y - 6, w + 2, h + 8, () => {
    const base = "Calendar - " + S.now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    if (!S.calNext) return base;
    const when = /^\d/.test(S.calNext.when) ? S.calNext.when : S.calNext.when[0] + S.calNext.when.slice(1).toLowerCase();
    return base + " - next: " + when + " " + S.calNext.title;
  });
};

// --- round cork board with the vault's post-its
Decor.obj.cork = function (D, tw) {
  const { g } = D, cb = g.cork, S = D.state;
  const c = D.roles(tw, { frame: "wood", pinA: "gold", pinB: "teal" });
  const R = cb.r, cx = cb.cx, cy = cb.cy;
  D.x.fillStyle = D.tone("plasd"); PIX.disc(D.x, cx + 2, cy + 2, R);
  D.x.fillStyle = D.tone(c.frame); PIX.disc(D.x, cx, cy, R);
  D.x.fillStyle = D.tone("cork"); PIX.disc(D.x, cx, cy, R - 2);
  // cork grain, inside the circle only
  D.x.fillStyle = D.tone("corkd");
  for (let yy = -R + 3; yy <= R - 3; yy++) for (let xx = -R + 3; xx <= R - 3; xx++)
    if (xx * xx + yy * yy < (R - 3) * (R - 3) && PIX.thr(cx + xx, cy + yy) < 0.28) D.x.fillRect(cx + xx, cy + yy, 1, 1);
  D.r(cx - 6, cy - R, 12, 1, Decor.shadeOf(c.frame, 0.3, "oak"));
  const tone = { yellow: "hay", pink: "rose", blue: "sky", green: "leaf", orange: "flame", purple: "lilac", red: "verm", white: "paper" };
  const notes = (S.notes || []).slice(0, 5);
  const placed = notes.length ? notes : [{ color: "white", x: 0.3, y: 0.3, blank: true }];
  const span = Math.floor((R - 3) * 1.25) - 7;          // a square well inside the circle
  placed.forEach((n, i) => {
    const fx = Number.isFinite(n.x) ? n.x : (i % 3) / 3, fy = Number.isFinite(n.y) ? n.y : Math.floor(i / 3) / 2;
    const nx = Math.round(cx - span / 2 + Math.max(0, Math.min(1, fx)) * span) - 3;
    const ny = Math.round(cy - span / 2 + Math.max(0, Math.min(1, fy)) * span) - 3;
    D.r(nx + 1, ny + 1, 7, 7, "corkd");
    D.r(nx, ny, 7, 7, tone[n.color] || "hay");
    D.p(nx + 6, ny + 6, "cork");
    D.r(nx + 1, ny + 3, 4, 1, n.blank ? "pale" : "steel");
    D.r(nx + 1, ny + 5, 3, 1, n.blank ? "pale" : "mist");
    D.p(nx + 3, ny, i % 2 ? c.pinB : c.pinA);
  });
  D.hot("cork", cx - R, cy - R, R * 2 + 1, R * 2 + 1, () => {
    const n = (S.notes || []).length;
    return n ? `Cork board - ${n} note${n === 1 ? "" : "s"}` : "Cork board";
  });
};

// --- a small portable TV on the desk: antenna, handle, two knobs; drawn channels only
Decor.obj.tv = function (D, tw) {
  const { g } = D, S = D.state;
  const c = D.roles(tw, { body: "verm", bodyD: "rust", knob: "cream", rim: "ink", handle: "ink" });
  const w = 30, h = 22, x = g.on.tv - (w >> 1), y = g.desk.y - h;
  // antenna and handle
  for (let i = 0; i < 9; i++) { D.p(x + 9 - Math.floor(i / 2), y - 4 - i, "steel"); D.p(x + 14 + Math.floor(i / 1.6), y - 4 - i, "steel"); }
  D.r(x + 10, y - 4, 4, 2, c.rim);
  D.r(x + 5, y - 3, 1, 3, c.handle); D.r(x + w - 6, y - 3, 1, 3, c.handle); D.r(x + 5, y - 3, w - 10, 1, c.handle);
  // body
  D.r(x, y, w, h, c.body);
  D.r(x, y, w, 1, Decor.shadeOf(c.body, 0.25, "flame"));
  D.r(x, y + h - 2, w, 2, c.bodyD);
  D.p(x, y, "plast"); D.p(x + w - 1, y, "plast");
  D.r(x + 2, y + h, 3, 1, c.rim); D.r(x + w - 5, y + h, 3, 1, c.rim);
  const sx = x + 2, sy = y + 2, sw = 19, sh = h - 6;
  Decor.tvRect = { x: sx, y: sy, w: sw, h: sh };   // the room plays the picked channel on top (room.js tvTick)
  D.r(sx - 1, sy - 1, sw + 2, sh + 2, c.rim);
  Decor.channel(D, S.tvChannel || 0, sx, sy, sw, sh);
  D.emit(sx, sy, sw, sh);
  const kx = x + w - 6;
  [y + 3, y + 9].forEach((ky) => { D.r(kx, ky, 4, 4, c.knob); D.p(kx + 1, ky + 1, Decor.shadeOf(c.knob, -0.25, "tan")); });
  for (let i = 0; i < 2; i++) D.r(kx, y + 15 + i * 2, 4, 1, c.bodyD);
  if (S.night > 0.3) D.lamp(sx + sw / 2, sy + sh / 2, 40, 0.3);
  D.hot("tv", x - 1, y - 12, w + 2, h + 12, "TV");
};

// a drawn programme: no logos, no real broadcasts
Decor.channel = function (D, n, x, y, w, h) {
  const ch = ((n % 6) + 6) % 6;
  if (ch === 0) {                         // test bars
    const bars = ["bone", "gold", "teal", "leaf", "lilac", "verm", "blue"];
    const bw = w / bars.length;
    bars.forEach((b, i) => D.r(x + Math.round(i * bw), y, Math.ceil(bw), Math.round(h * 0.72), b));
    D.r(x, y + Math.round(h * 0.72), w, h - Math.round(h * 0.72), "coal");
    D.r(x + 2, y + Math.round(h * 0.8), Math.round(w * 0.3), 2, "bone");
    D.r(x + Math.round(w * 0.6), y + Math.round(h * 0.8), Math.round(w * 0.25), 2, "steel");
  } else if (ch === 1) {                  // sea at sunset
    D.r(x, y, w, h, "berry");
    D.r(x, y, w, Math.round(h * 0.25), "blue");
    D.dith(x, y + Math.round(h * 0.25), w, Math.round(h * 0.2), "blue", "berry", 0.5);
    D.r(x, y + Math.round(h * 0.45), w, Math.round(h * 0.15), "flame");
    const hz = y + Math.round(h * 0.6);
    D.x.fillStyle = D.tone("gold");
    PIX.disc(D.x, x + w / 2, hz, Math.round(h * 0.18));
    D.r(x, hz, w, h - (hz - y), "slate");
    for (let i = 0; i < 3; i++) D.r(x + w / 2 - 5 + i * 2, hz + 2 + i * 2, 10 - i * 4, 1, "flame");
  } else if (ch === 2) {                  // aquarium
    D.r(x, y, w, h, "teal");
    D.dith(x, y + h - 6, w, 6, "teal", "pine", 0.5);
    D.r(x, y + h - 2, w, 2, "cream");
    [[0.2, 0.3, "flame"], [0.6, 0.5, "gold"], [0.38, 0.66, "rose"]].forEach(([fx, fy, col]) => {
      const px = x + Math.round(fx * w), py = y + Math.round(fy * h);
      D.r(px, py, 5, 3, col); D.r(px - 2, py - 1, 2, 5, col); D.p(px + 3, py + 1, "ink");
    });
    for (let i = 0; i < 4; i++) D.p(x + Math.round(w * 0.8), y + 2 + i * 4, "pale");
    for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) D.p(x + 3 + i * Math.round(w / 3) + (j % 2), y + h - 3 - j, "leaf");
  } else if (ch === 3) {                  // a starry night over soft hills
    D.r(x, y, w, h, "coal");
    const r = PIX.rand(3);
    for (let i = 0; i < 14; i++) D.p(x + Math.floor(r() * w), y + Math.floor(r() * h * 0.5), "pale");
    D.x.fillStyle = D.tone("cream");
    PIX.disc(D.x, x + Math.round(w * 0.75), y + 5, 3);
    for (let i = 0; i < w; i++) {
      const hh = Math.round(h * (0.3 + 0.1 * Math.sin(i * 0.15) + 0.04 * Math.sin(i * 0.4)));
      D.r(x + i, y + h - hh, 1, hh, "slate");
    }
  } else if (ch === 4) {                  // fireplace
    D.r(x, y, w, h, "soot");
    const fx = x + Math.round(w * 0.2), fw = Math.round(w * 0.6);
    D.r(fx, y + h - 3, fw, 2, "umber");
    D.r(fx + 2, y + h - 5, fw - 4, 2, "wood");
    for (let i = 0; i < fw; i++) {
      const fh = Math.max(2, Math.round(3 + 5 * Math.abs(Math.sin(i * 0.5)) + 2 * Math.sin(i * 1.7)));
      D.r(fx + i, y + h - 5 - fh, 1, fh, i % 3 ? "flame" : "verm");
      D.r(fx + i, y + h - 5 - Math.round(fh * 0.5), 1, Math.round(fh * 0.5), "gold");
    }
  } else {                                // garden
    D.r(x, y, w, h, "sky");
    D.r(x, y + Math.round(h * 0.65), w, h - Math.round(h * 0.65), "moss");
    D.r(x + w - 8, y + 3, 4, 4, "gold");
    for (let i = 0; i < 5; i++) {
      const px = x + 3 + i * Math.round((w - 6) / 5);
      D.r(px, y + Math.round(h * 0.5), 1, Math.round(h * 0.15), "pine");
      D.r(px - 1, y + Math.round(h * 0.45), 3, 2, ["rose", "gold", "verm", "lilac", "bone"][i]);
    }
  }
};

// --- typewriter with a sheet in it
Decor.obj.typewriter = function (D, tw) {
  const { g } = D, cx = g.on.typewriter, by = g.desk.y;
  const c = D.roles(tw, { body: "teal", bodyD: "pine", keys: "bone", platen: "ink" });
  const low = tw.shape === "low-carriage" ? 1 : 0, round = tw.pattern === "round-keys";
  const x = cx - 13;
  D.r(cx - 6, by - 19 + low, 12, 9, "paper");
  D.r(cx + 5, by - 19 + low, 1, 9, "cream");
  for (let i = 0; i < 3; i++) D.r(cx - 4, by - 17 + low + i * 2, 8 - (i === 2 ? 3 : 0), 1, "mist");
  D.r(x + 1, by - 11 + low, 24, 2, c.platen);
  D.r(x - 1, by - 12 + low, 2, 4, "pale");
  D.r(x + 25, by - 12 + low, 2, 4, "pale");
  D.r(x + 26, by - 13 + low, 3, 1, "pale");
  D.r(x + 2, by - 9 + low, 22, 3 - low, c.bodyD);
  D.r(x, by - 6, 26, 5, c.body);
  D.r(x, by - 6, 26, 1, Decor.shadeOf(c.body, 0.3, "leaf"));
  D.r(x, by - 1, 26, 1, "ink");
  if (low) { D.p(x, by - 6, "plast"); D.p(x + 25, by - 6, "plast"); }
  for (let r = 0; r < 2; r++) for (let k = 0; k < 8; k++) {
    const kx = x + 3 + k * 3 + r, ky = by - 5 + r * 2;
    if (round) D.r(kx, ky, 2, 1, c.keys); else D.p(kx, ky, c.keys);
  }
  D.r(x + 8, by - 2, 10, 1, c.keys);
  D.hot("typewriter", x - 1, by - 19, 30, 19, "Typewriter");
};

// --- agenda: a cloth notebook lying on the desk, the open-task count on its label
Decor.obj.agenda = function (D, tw) {
  const { g } = D, S = D.state, cx = g.on.agenda, by = g.desk.y;
  const c = D.roles(tw, { cover: "verm", coverD: "rust", band: "ink", pages: "cream" });
  const w = 20, x = cx - 10;
  // pages (the block's edge) and the cover, seen a little from above
  D.r(x + 1, by - 3, w - 1, 2, c.pages);
  D.r(x + 1, by - 1, w - 1, 1, "tan");
  D.r(x, by - 11, w, 8, c.cover);
  D.r(x, by - 4, w, 1, c.coverD);
  D.r(x, by - 11, w, 1, Decor.shadeOf(c.cover, 0.3, "rose"));
  if (tw.shape === "rounded-corners") { D.p(x, by - 11, "plast"); D.p(x + w - 1, by - 11, "plast"); }
  D.r(x + w - 5, by - 11, 2, 10, c.band);
  D.r(x + 3, by - 12, 2, 3, "gold");                // ribbon
  // label with the count
  D.r(x + 4, by - 10, 9, 6, "bone");
  const n = S.openTasks;
  const txt = n == null ? "-" : n > 99 ? "99" : String(n);
  D.x.fillStyle = D.tone(n === 0 ? "moss" : "ink");
  Font.draw(D.x, txt, Math.round(x + 8.5 - Font.width(txt) / 2), by - 10, 1);
  D.hot("agenda", x - 1, by - 13, w + 2, 13, () => {
    if (S.openTasks == null) return "Agenda";
    if (S.openTasks === 0) return "Agenda - all done for today";
    return `Agenda - ${S.openTasks} open task${S.openTasks === 1 ? "" : "s"}`;
  });
};

// --- headphones resting on a small stand (no logo)
Decor.obj.headphones = function (D, tw) {
  const { g } = D, cx = g.on.headphones, by = g.desk.y;
  const c = D.roles(tw, { band: "coal", cup: "coal", cushion: "slate", slider: "steel", stand: "wood" });
  // the stand: a foot and a post with a rounded top
  D.r(cx - 5, by - 2, 11, 2, c.stand);
  D.r(cx - 1, by - 17, 2, 15, c.stand);
  D.r(cx - 3, by - 18, 6, 2, c.stand);
  // band over the top, cups hanging either side
  for (let a = 0; a <= 24; a++) {
    const t = Math.PI * (a / 24);
    D.r(Math.round(cx - Math.cos(t) * 7), Math.round(by - 13 - Math.sin(t) * 6), 1, 2, a > 4 && a < 20 ? c.band : c.slider);
  }
  [cx - 10, cx + 6].forEach((ex, i) => {
    D.r(ex, by - 14, 5, 8, c.cup);
    D.r(ex + (i ? 0 : 3), by - 13, 2, 6, c.cushion);
    D.p(ex, by - 14, "plast"); D.p(ex + 4, by - 14, "plast"); D.p(ex, by - 7, "plast"); D.p(ex + 4, by - 7, "plast");
  });
  D.hot("headphones", cx - 11, by - 20, 23, 20, "Headphones");
};

// --- power strip on the floor; its light follows the battery
Decor.obj.strip = function (D, tw) {
  const { g } = D, s = g.strip, S = D.state;
  const c = D.roles(tw, { body: "bone", bodyD: "pale", switch: "verm", cable: "coal" });
  const four = tw.shape === "four-sockets";
  const x = s.x, y = s.y, w = four ? s.w + 4 : s.w;
  D.r(x - 8, g.floorY - 3, 4, 3, "bone");
  D.p(x - 7, g.floorY - 2, "coal"); D.p(x - 5, g.floorY - 2, "coal");
  for (let i = 0; i < 8; i++) D.p(x - 7 + i, y + 2 + (i < 3 ? 0 : 1) - (i < 2 ? 1 : 0), c.cable);
  D.dith(x + 1, y + s.h, w, 1, "tan", "umber", 0.5);
  D.r(x, y, w, s.h, c.body);
  D.r(x, y + s.h - 1, w, 1, c.bodyD);
  for (let i = 0; i < (four ? 4 : 3); i++) { D.r(x + 2 + i * 5, y + 1, 3, 3, c.bodyD); D.p(x + 3 + i * 5, y + 2, "coal"); }
  const swx = x + w - 7;
  D.r(swx, y + 1, 4, 3, c.switch);
  if (tw.pattern === "switch-lit") D.emit(swx, y + 1, 4, 3);
  const b = S.battery;
  const led = !b ? "steel" : b.charging ? "leaf" : b.level < 0.15 ? "verm" : b.level < 0.3 ? "flame" : "leaf";
  D.p(x + w - 2, y + 2, led);
  D.emit(x + w - 2, y + 2, 1, 1);
  // a charger plugged into the first socket
  D.r(x + 2, y - 2, 3, 3, "coal");
  for (let i = 0; i < 6; i++) D.p(x + 3 - Math.floor(i / 2), y - 3 - i, "coal");
  D.hot("strip", x - 2, y - 9, w + 4, s.h + 10, () => {
    if (!b) return "Power strip";
    return `Battery ${Math.round(b.level * 100)}%` + (b.charging ? ", charging" : "");
  });
};

// --- backpack on the floor, leaning on the desk
Decor.obj.backpack = function (D, tw) {
  const { g } = D, p = g.backpack;
  const c = D.roles(tw, { body: "moss", bodyD: "pine", strap: "pine", buckle: "gold" });
  const x = p.x, y = p.base - p.h, w = p.w, h = p.h;
  D.dith(x + 1, p.base, w, 2, "tan", "umber", 0.6);
  if (tw.shape === "roll-top") {
    D.r(x + 1, y - 2, w - 2, 4, c.bodyD);
    D.r(x + 1, y - 2, w - 2, 1, c.body);
    D.r(x + 2, y, w - 4, 1, Decor.shadeOf(c.bodyD, -0.2, "dark"));
  } else {
    D.r(x + w / 2 - 3, y - 3, 6, 1, "dark");
    D.r(x + w / 2 - 3, y - 3, 1, 3, "dark");
    D.r(x + w / 2 + 2, y - 3, 1, 3, "dark");
  }
  D.r(x + 1, y + 1, w - 2, 1, c.body);
  D.r(x, y + 2, w, h - 2, c.body);
  D.r(x + w - 2, y + 2, 2, h - 2, c.bodyD);
  D.r(x, y + h - 1, w, 1, c.bodyD);
  const py = y + Math.round(h * 0.55);
  D.r(x + 2, py, w - 4, h - (py - y) - 2, c.bodyD);
  D.r(x + 2, py, w - 4, 1, c.body);
  if (tw.pattern === "leather-straps") {
    [x + 4, x + w - 6].forEach((sx) => { D.r(sx, y - 1, 2, h - 5, c.strap); D.r(sx, y + h - 9, 2, 2, c.buckle); });
  } else {
    D.r(x + 2, y + 3, 1, h - 5, c.strap);
    D.r(x + w - 4, y + 3, 1, h - 5, "dark");
    D.p(x + w / 2, py + 1, c.buckle);
  }
  D.hot("backpack", x - 1, y - 3, w + 2, h + 3, "Backpack");
};

// --- wooden spindle chair with a seat cushion, pulled up to the desk
Decor.obj.chair = function (D, tw) {
  const { g } = D, ch = g.chair;
  const c = D.roles(tw, { wood: "wood", woodD: "umber", seat: "gold", seatD: "amber" });
  const cx = ch.cx, seatY = ch.seat, half = (ch.w >> 1) - 3;
  const top = Math.max(g.desk.y + 2, seatY - 30), feet = Math.min(g.H - 2, Math.max(g.floorY + 4, seatY + 40));
  // back: top rail, spindles, posts
  D.r(cx - half, top, half * 2, 3, c.wood);
  D.r(cx - half, top, half * 2, 1, Decor.shadeOf(c.wood, 0.25, "oak"));
  D.r(cx - half, top + 2, half * 2, 1, c.woodD);
  for (let i = 1; i <= 5; i++) D.r(Math.round(cx - half + (i * half * 2) / 6), top + 3, 1, seatY - top - 3, c.woodD);
  D.r(cx - half, top, 2, seatY - top, c.wood);
  D.r(cx + half - 2, top, 2, seatY - top, c.woodD);
  // seat and cushion
  D.r(cx - half - 1, seatY, half * 2 + 2, 3, c.wood);
  D.r(cx - half - 1, seatY + 2, half * 2 + 2, 1, c.woodD);
  D.r(cx - half + 1, seatY - 3, half * 2 - 2, 3, c.seat);
  D.r(cx - half + 1, seatY - 3, half * 2 - 2, 1, Decor.shadeOf(c.seat, 0.3, "hay"));
  D.r(cx - half + 1, seatY - 1, half * 2 - 2, 1, c.seatD);
  // legs, splayed a little, with a stretcher
  const legH = feet - (seatY + 3);
  for (let yy = 0; yy < legH; yy++) {
    const sp = Math.round((yy / legH) * 2);
    D.r(cx - half - sp, seatY + 3 + yy, 2, 1, c.wood);
    D.r(cx + half - 2 + sp, seatY + 3 + yy, 2, 1, c.woodD);
    D.p(cx - 4 - Math.round(sp / 2), seatY + 3 + yy, c.woodD);
    D.p(cx + 3 + Math.round(sp / 2), seatY + 3 + yy, c.woodD);
  }
  D.r(cx - half, seatY + 3 + Math.round(legH * 0.6), half * 2, 1, c.woodD);
  D.dith(cx - half - 2, feet, half * 2 + 5, 1, "umber", "dark", 0.5);
  D.hot("chair", cx - half - 2, top, half * 2 + 4, feet - top + 1, "Chair");
};
