/* Casa theme: the product's own look.

   Loaded before the engine (see src/room/order.txt). It defines
   window.CasaTheme, the one place the room asks for:
     grade([r,g,b]) -> [r,g,b]   a gentle colour grade, run on every final pixel
     P                            tones that replace base palette entries (before the grade)
     palette(base)                base palette -> what the room shows by day (P, then grade)
     trees                        tones read only while drawing trees (window, garden)
     buddy.draw(ctx, x, y, u, frame, mood, opts)   the companion penguin
     pet.draw(ctx, x, y, u, gait, frame, opts)     the dog
     tweak                        per-object variation specs (docs/dev/theme.md)

   Sprites are original pixel art drawn here in code on small fixed grids.
   Every frame is rendered once into an offscreen canvas and cached, so a
   draw() call is one drawImage. No timers live here: the engine owns the
   clock (pace helper, casa:pause) and only passes a frame number in. */
(function () {
  "use strict";

  // ------------------------------------------------------------ colour math

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const mix = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];

  function toHsl(c) {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn;
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function fromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const ch = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [Math.round(ch(h + 1 / 3) * 255), Math.round(ch(h) * 255), Math.round(ch(h - 1 / 3) * 255)];
  }

  const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  // 1 at the centre of a band, easing to 0 at `w` degrees away
  const bell = (d, w) => (d >= w ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / w));
  // a trapezoid: 0 below a, up to 1 by b, 1 until c, down to 0 by d
  const ramp = (v, a, b, c, d) => (v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v <= c ? 1 : (d - v) / (d - c));

  /* THE GRADE. The look lives in the palette below, not in a filter, so the
     grade is only a breath of warmth on lit tones (+2 red, -2 blue), the
     same on every pixel, so nothing drawn with a literal colour stands out
     from the palette. Pure and memoised. */
  const GRADE = { warm: 2 };
  const memo = new Map();
  function grade(c) {
    if (!c || c.length < 3) return c;
    const key = ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);
    const hit = memo.get(key);
    if (hit) return hit;
    const l = (Math.max(c[0], c[1], c[2]) + Math.min(c[0], c[1], c[2])) / 510;
    const wm = GRADE.warm * Math.min(1, l * 2.2);
    const out = [Math.min(255, Math.round(c[0] + wm)), c[1], Math.max(0, Math.round(c[2] - wm))];
    if (memo.size > 20000) memo.clear();
    memo.set(key, out);
    return out;
  }

  /* THE PALETTE: "clay and ink". It replaces every base tone by name (the
     engine reads CasaTheme.P[name] first). Same pixel rules as before (flat
     tones, Bayer dither, the night pulls every tone toward `night`), new
     materials: clay plaster walls, cream trim, walnut floor and beams, a
     pale ash desk, indigo textiles, mustard linen, garden greens. Gold and
     vermilion are the only tones kept as they were: they are the family's. */
  const P = {
    ink: [0x14, 0x10, 0x16], coal: [0x22, 0x1C, 0x24], slate: [0x36, 0x30, 0x3A],
    blue: [0x3A, 0x4A, 0x78], steel: [0x6A, 0x74, 0x8E], mist: [0xA6, 0xAC, 0xBC],
    pale: [0xD8, 0xD6, 0xD2], bone: [0xF6, 0xF0, 0xE4], cream: [0xEE, 0xE2, 0xC8], paper: [0xFA, 0xF3, 0xE2],
    // clay plaster, light to dark
    plas: [0xC4, 0x8A, 0x6E], plast: [0xB2, 0x78, 0x5E], plasd: [0x8E, 0x5C, 0x48], plasx: [0x62, 0x3E, 0x34],
    gold: [0xF2, 0xC1, 0x4E], amber: [0xC8, 0x8A, 0x2E], verm: [0xD2, 0x47, 0x3A], rust: [0x86, 0x30, 0x26],
    flame: [0xF8, 0x9A, 0x46], hay: [0xFC, 0xD0, 0x6E], rose: [0xE8, 0x9C, 0xB0], berry: [0x8E, 0x40, 0x50],
    leaf: [0x86, 0xB8, 0x5C], moss: [0x54, 0x8A, 0x48], pine: [0x2C, 0x5A, 0x3E],
    teal: [0x3A, 0x8A, 0x86], sky: [0x7A, 0xB4, 0xDC], lilac: [0xA2, 0x92, 0xCC],
    // walnut: floor, beam, frames
    oak: [0x9C, 0x6C, 0x48], wood: [0x7A, 0x4E, 0x32], umber: [0x56, 0x36, 0x24], dark: [0x3A, 0x24, 0x1A], soot: [0x24, 0x16, 0x10],
    // pale ash: the desk and the shelves
    birch: [0xE4, 0xD4, 0xB4], beech: [0xCC, 0xB6, 0x90], tan: [0xA2, 0x8C, 0x68],
    // textiles
    curt: [0xD8, 0xA8, 0x4E], curtd: [0xB0, 0x84, 0x34],
    rug: [0x3C, 0x4E, 0x84], rugd: [0x2A, 0x36, 0x60], rugl: [0xEC, 0xDC, 0xB8],
    cork: [0xC6, 0x96, 0x5E], corkd: [0xA0, 0x74, 0x46],
    night: [0x1C, 0x16, 0x2A],
  };

  // what a tone looks like by day: override if any, then the grade
  const tone = (name, base) => grade(P[name] || base);
  function palette(base) {
    const out = {};
    for (const k in base) out[k] = tone(k, base[k]);
    for (const k in P) if (!(k in out)) out[k] = grade(P[k]);
    return out;
  }

  /* TREES. Read instead of the palette while drawing a tree (the window's,
     the garden's): an olive summer and a red-orange maple autumn (the
     turning mixes toward `gold`, then `wood`; olive to red-orange passes
     through amber, never grey), dark blue-green pines, grey-brown bark. */
  const trees = {
    leaf: [0xC4, 0xB0, 0x4C],
    moss: [0x5E, 0x86, 0x4A],
    pine: [0x1E, 0x4E, 0x4A],
    gold: [0xE4, 0x5C, 0x2C],
    wood: [0x96, 0x3C, 0x30],
    umber: [0x6A, 0x60, 0x58],
    dark: [0x3C, 0x34, 0x30],
  };

  // ------------------------------------------------------------ sprite kit

  /* A grid of one-letter codes, painted with a few shape helpers that sample
     each pixel at its centre. Codes become colours only at render time, so
     one rig serves every frame, mirror and night level. */
  function Grid(w, h) {
    this.w = w; this.h = h;
    this.a = new Array(w * h).fill("");
  }
  Grid.prototype.get = function (x, y) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? "" : this.a[y * this.w + x];
  };
  Grid.prototype.put = function (x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.a[y * this.w + x] = c;
  };
  // fill an ellipse; `only` (optional) limits painting to pixels already holding one of those codes
  Grid.prototype.ell = function (cx, cy, rx, ry, c, only) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
        if (u * u + v * v > 1) continue;
        if (only && only.indexOf(this.get(x, y)) < 0) continue;
        this.put(x, y, c);
      }
  };
  Grid.prototype.poly = function (pts, c, only) {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min.apply(null, ys))); y <= Math.min(this.h - 1, Math.ceil(Math.max.apply(null, ys))); y++) {
      const sy = y + 0.5, cuts = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a[1] > sy) !== (b[1] > sy)) cuts.push(a[0] + (sy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      cuts.sort((p, q) => p - q);
      for (let i = 0; i + 1 < cuts.length; i += 2)
        for (let x = Math.ceil(cuts[i] - 0.5); x + 0.5 <= cuts[i + 1]; x++) {
          if (only && only.indexOf(this.get(x, y)) < 0) continue;
          this.put(x, y, c);
        }
    }
  };
  // a limb: a quad from a (width wa) to b (width wb)
  Grid.prototype.limb = function (ax, ay, bx, by, wa, wb, c) {
    const dx = bx - ax, dy = by - ay, n = Math.hypot(dx, dy) || 1;
    const px = -dy / n, py = dx / n;
    this.poly([[ax + px * wa / 2, ay + py * wa / 2], [bx + px * wb / 2, by + py * wb / 2],
      [bx - px * wb / 2, by - py * wb / 2], [ax - px * wa / 2, ay - py * wa / 2]], c);
  };
  // every empty pixel touching a filled one (4-neighbour) becomes `c`
  Grid.prototype.outline = function (c, skip) {
    const add = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        const n = [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)];
        if (n.some((v) => v && v !== c && (!skip || skip.indexOf(v) < 0))) add.push(x, y);
      }
    for (let i = 0; i < add.length; i += 2) this.put(add[i], add[i + 1], c);
  };
  // pixels of code `from` whose neighbour in direction (dx,dy) is empty or outline become `to`
  Grid.prototype.rim = function (from, to, dx, dy, edge) {
    const hits = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== from) continue;
        const v = this.get(x + dx, y + dy);
        if (!v || v === edge) hits.push(x, y);
      }
    for (let i = 0; i < hits.length; i += 2) this.put(hits[i], hits[i + 1], to);
  };

  const night = () => P.night;
  // a grid to a canvas: codes through the colour table, pulled toward the
  // night by k times each code's own share (faces glow a little at night)
  function toCanvas(g, colors, share, k, flip) {
    const cv = makeCanvas(g.w, g.h);
    const x = cv.getContext("2d");
    const img = x.createImageData(g.w, g.h), d = img.data;
    const cache = {};
    for (let y = 0; y < g.h; y++)
      for (let xx = 0; xx < g.w; xx++) {
        const code = g.a[y * g.w + xx];
        if (!code || !colors[code]) continue;
        let col = cache[code];
        if (!col) col = cache[code] = k > 0 ? mix(colors[code], night(), k * (share[code] == null ? 0.75 : share[code])) : colors[code];
        const i = (y * g.w + (flip ? g.w - 1 - xx : xx)) << 2;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
    x.putImageData(img, 0, 0);
    return cv;
  }
  function makeCanvas(w, h) {
    if (typeof document !== "undefined" && document.createElement) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      return c;
    }
    return new OffscreenCanvas(w, h);
  }
  // night level in twentieths, so a slow dusk re-renders at most 13 times
  const kStep = (k) => Math.max(0, Math.min(0.62, Math.round((+k || 0) * 20) / 20));

  function frameCache(limit) {
    const m = new Map();
    return {
      get: (key, make) => {
        let v = m.get(key);
        if (!v) {
          v = make();
          if (m.size >= limit) m.delete(m.keys().next().value);
          m.set(key, v);
        }
        return v;
      },
      clear: () => m.clear(),
      size: () => m.size,
    };
  }

  // fit a native-size canvas into a w x h tile, bottom-centred, whole-number
  // scale when it fills the tile well, nearest-neighbour stretch otherwise
  function fitURL(src, w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    const c = makeCanvas(w, h), x = c.getContext("2d");
    x.imageSmoothingEnabled = false;
    const sw = src.width, sh = src.height;
    const s = Math.min(w / sw, h / sh);
    const si = Math.max(1, Math.floor(s));
    const use = s >= 1 && si / s >= 0.8 ? si : s;
    const dw = Math.round(sw * use), dh = Math.round(sh * use);
    x.drawImage(src, Math.round((w - dw) / 2), h - dh, dw, dh);
    return c.toDataURL();
  }

  // ------------------------------------------------------------ the buddy

  /* The companion: a round night-blue penguin with a white belly and a
     yellow scarf. Head and body are two rounds joined under the scarf, the
     face is a white mask with two lobes round the eyes, small orange beak,
     short orange feet set close. 26 x 28 sprite pixels. */
  const BW = 26, BH = 28, BC = 13;
  const BUDDY_COLORS = {
    o: [0x0E, 0x14, 0x2A],   // outline
    n: [0x24, 0x33, 0x5E],   // night-blue body
    h: [0x3A, 0x50, 0x88],   // its lit edge
    d: [0x19, 0x23, 0x45],   // its turned-away side, the flippers
    w: [0xF4, 0xF1, 0xEA],   // belly and face
    g: [0xC8, 0xCF, 0xDE],   // belly in its own shade
    e: [0x0B, 0x0D, 0x12],   // eye
    l: [0xFF, 0xFF, 0xFF],   // eye glint
    b: [0xF2, 0x90, 0x3A],   // beak
    k: [0xBE, 0x5E, 0x24],   // beak, lower half
    m: [0x7E, 0x24, 0x2A],   // inside the beak
    f: [0xF2, 0x90, 0x3A],   // feet
    F: [0xB0, 0x56, 0x22],   // feet, underside
    s: [0xF6, 0xC9, 0x3E],   // scarf
    S: [0xCC, 0x94, 0x1C],   // scarf, fold
    t: [0xE0, 0x62, 0x2E],   // scarf stripe
  };
  const BUDDY_SHARE = { w: 0.35, g: 0.45, e: 0.4, l: 0.25, b: 0.5, k: 0.6, f: 0.55, F: 0.65, s: 0.5, S: 0.6, t: 0.55 };

  const MOODS = {
    idle: { n: 4, ms: 600, hy: [0, 0, 1, 0], tail: [0, 1, 1, 0] },
    blink: { n: 3, ms: 90, eyes: ["half", "shut", "half"] },
    wave: { n: 4, ms: 170, wing: ["up1", "up2", "up1", "up2"] },
    sleep: { n: 4, ms: 750, hy: [0, 0, 1, 1], eyes: ["sleep", "sleep", "sleep", "sleep"] },
    talk: { n: 4, ms: 140, beak: ["shut", "open", "shut", "half"] },
    happy: { n: 2, ms: 320, hy: [0, 1], eyes: ["happy", "happy"] },
  };

  function buddyGrid(mood, f) {
    const M = MOODS[mood] || MOODS.idle;
    const pick = (arr, dflt) => (arr ? arr[f % arr.length] : dflt);
    const hy = pick(M.hy, 0), tail = pick(M.tail, 0);
    const eyes = pick(M.eyes, "open"), beak = pick(M.beak, "shut"), wing = pick(M.wing, "rest");
    const g = new Grid(BW, BH);
    const cx = BC;

    // body, then the head over it (the head carries the breath: hy)
    const body = { cx, cy: 19.1, rx: 9.3, ry: 6.9 };
    const head = { cx, cy: 8.6 + hy, rx: 8.7, ry: 7.4 };
    g.ell(body.cx, body.cy, body.rx, body.ry, "n");
    // flippers: short, out from the sides; the right one lifts to wave
    g.poly([[4.6, 14.6], [1.3, 20.2], [1.9, 22.4], [4.9, 20.2]], "d");
    if (wing === "rest") g.poly([[21.4, 14.6], [24.7, 20.2], [24.1, 22.4], [21.1, 20.2]], "d");
    else if (wing === "up1") g.poly([[20.6, 16.4], [24.4, 10.6], [25.4, 12.2], [22.4, 17.8]], "d");
    else g.poly([[20.8, 15.6], [22.6, 8.8], [24.4, 9.2], [22.8, 16.6]], "d");
    g.ell(head.cx, head.cy, head.rx, head.ry, "n");

    // light from the upper left: a lit edge on head and body, shade lower right
    for (let y = 0; y < BH; y++)
      for (let x = 0; x < BW; x++) {
        if (g.get(x, y) !== "n") continue;
        const inHead = y + 0.5 < head.cy + head.ry * 0.85;
        const E = inHead ? head : body;
        const u = (x + 0.5 - E.cx) / E.rx, v = (y + 0.5 - E.cy) / E.ry, d = u * u + v * v;
        const lk = -0.62 * u - 0.78 * v;
        if (d > 0.52 && lk > 0.62) g.put(x, y, "h");
        else if (d > 0.62 && lk < -0.5) g.put(x, y, "d");
      }

    // the face mask: two lobes round the eyes and a muzzle below them
    const inHeadInner = (x, y) => {
      const u = (x + 0.5 - head.cx) / (head.rx - 1.3), v = (y + 0.5 - head.cy) / (head.ry - 1.2);
      return u * u + v * v <= 1;
    };
    for (let y = 0; y < BH; y++)
      for (let x = 0; x < BW; x++) {
        if (!inHeadInner(x, y)) continue;
        const px = x + 0.5, py = y + 0.5;
        const lobe = (ox) => (px - (cx + ox)) ** 2 + (py - (8.7 + hy)) ** 2 <= 3.2 * 3.2;
        const mu = (px - cx) / 4.9, mv = (py - (11.5 + hy)) / 2.9;
        if (lobe(-3.0) || lobe(3.0) || mu * mu + mv * mv <= 1) g.put(x, y, "w");
      }

    // the belly, white, a shade on its lower right
    for (let y = 0; y < BH; y++)
      for (let x = 0; x < BW; x++) {
        const c = g.get(x, y);
        if (c !== "n" && c !== "h" && c !== "d") continue;
        const u = (x + 0.5 - cx) / 6.3, v = (y + 0.5 - 20.3) / 5.3;
        if (u * u + v * v > 1) continue;
        g.put(x, y, u * 0.6 + v * 0.8 > 0.62 ? "g" : "w");
      }

    // eyes: 2 x 3, a glint top right
    const ey = 7 + hy;
    for (const ex of [cx - 4, cx + 2]) {
      if (eyes === "open") {
        for (let j = 0; j < 3; j++) { g.put(ex, ey + j, "e"); g.put(ex + 1, ey + j, "e"); }
        g.put(ex + 1, ey, "l");
      } else if (eyes === "half") {
        for (let j = 1; j < 3; j++) { g.put(ex, ey + j, "e"); g.put(ex + 1, ey + j, "e"); }
      } else if (eyes === "shut") {
        g.put(ex, ey + 2, "e"); g.put(ex + 1, ey + 2, "e");
      } else if (eyes === "sleep") {        // a smile-shaped lid
        g.put(ex - 1, ey + 1, "e"); g.put(ex, ey + 2, "e"); g.put(ex + 1, ey + 2, "e"); g.put(ex + 2, ey + 1, "e");
      } else if (eyes === "happy") {        // an arch
        g.put(ex - 1, ey + 2, "e"); g.put(ex, ey + 1, "e"); g.put(ex + 1, ey + 1, "e"); g.put(ex + 2, ey + 2, "e");
      }
    }

    // beak: a small orange wedge, two tones; open shows the inside
    const by = 10 + hy;
    for (let x = cx - 2; x <= cx + 1; x++) g.put(x, by, "b");
    if (beak === "shut") { g.put(cx - 1, by + 1, "k"); g.put(cx, by + 1, "k"); }
    else if (beak === "half") { g.put(cx - 1, by + 1, "m"); g.put(cx, by + 1, "k"); g.put(cx - 1, by + 2, "k"); }
    else { g.put(cx - 1, by + 1, "m"); g.put(cx, by + 1, "m"); g.put(cx - 1, by + 2, "k"); g.put(cx, by + 2, "k"); }

    // the scarf: a band where head meets body, a knot, and a tail that sways
    const sy = 13 + hy;
    for (let y = sy; y <= sy + 2; y++)
      for (let x = 0; x < BW; x++) {
        const c = g.get(x, y);
        if (!c || c === "o") continue;
        const inBody = ((x + 0.5 - body.cx) / (body.rx + 0.4)) ** 2 + ((y + 0.5 - body.cy) / (body.ry + 0.4)) ** 2 <= 1;
        const inHead = ((x + 0.5 - head.cx) / head.rx) ** 2 + ((y + 0.5 - head.cy) / head.ry) ** 2 <= 1;
        if (!inBody && !inHead) continue;
        if (c === "d" && (x < 5 || x > 20)) continue;   // the flippers stay over it
        g.put(x, y, y === sy + 2 ? "S" : "s");
      }
    g.put(cx + 3, sy + 1, "S"); g.put(cx + 4, sy + 1, "S");          // the knot
    for (let j = 0; j < 6; j++) {
      const sway = j >= 3 ? tail : 0;
      const tx = cx + 4 + sway, ty = sy + 3 + j;
      const code = j === 3 || j === 5 ? "t" : j === 0 ? "S" : "s";
      g.put(tx, ty, code); g.put(tx + 1, ty, j === 0 ? "S" : code);
    }

    // feet, close together, over the bottom of the body
    for (const [x0, x1] of [[cx - 6, cx - 2], [cx + 1, cx + 5]]) {
      for (let x = x0; x <= x1; x++) { g.put(x, 25, "f"); g.put(x, 26, "F"); }
    }
    g.put(cx - 6, 25, ""); g.put(cx + 5, 25, "");   // rounded outer toes

    g.outline("o");
    return g;
  }

  const buddyCache = frameCache(160);
  function buddyCanvas(mood, frame, flip, k) {
    const M = MOODS[mood] ? mood : "idle";
    const f = ((frame | 0) % MOODS[M].n + MOODS[M].n) % MOODS[M].n;
    const kq = kStep(k);
    return buddyCache.get(`${M}:${f}:${flip ? 1 : 0}:${kq}`, () => toCanvas(buddyGrid(M, f), BUDDY_COLORS, BUDDY_SHARE, kq, flip));
  }

  // the two sleep z's, drawn above the box: 3 x 3 and 4 x 4 glyphs
  const Z3 = ["111", "010", "111"], Z4 = ["1111", "0010", "0100", "1111"];
  function drawZ(ctx, x, y, u, rows, col) {
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === "1") ctx.fillRect(x + i * u, y + j * u, u, u); });
  }

  const buddy = {
    w: BW, h: BH,
    moods: MOODS,
    /* (x, y) is the top-left of the sprite box in ctx units; u is how many
       ctx units one sprite pixel takes (whole numbers keep it crisp).
       frame counts up at moods[mood].ms; it wraps. opts: {flip, k} where k
       is the night level 0..0.62 (the same number PIX.dusk takes). Sleep
       also paints two z's up to 8 sprite pixels above the box. */
    draw(ctx, x, y, u, frame, mood, opts) {
      const o = opts || {};
      const c = buddyCanvas(mood, frame, !!o.flip, o.k);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, Math.round(x), Math.round(y), BW * u, BH * u);
      if (mood === "sleep") {
        const f = ((frame | 0) % 4 + 4) % 4;
        const zc = mix([0xE4, 0xEA, 0xF6], night(), kStep(o.k) * 0.3);
        const zx = o.flip ? x + 2 * u : x + (BW - 6) * u;
        drawZ(ctx, Math.round(zx), Math.round(y + (-4 - (f >> 1)) * u), u, Z3, zc);
        if (f >= 2) drawZ(ctx, Math.round(zx + (o.flip ? -4 : 4) * u), Math.round(y - 9 * u), u, Z4, zc);
      }
    },
    canvas: (mood, frame, opts) => buddyCanvas(mood, frame, !!(opts && opts.flip), opts && opts.k),
    url(w, h, k, mood, frame, flip) { return fitURL(buddyCanvas(mood || "idle", frame || 0, !!flip, k), w, h); },
  };

  // ------------------------------------------------------------ the pet

  /* The dog: a cream-and-beige spitz, upright pointed ears, a tail curled
     over the back, cream muzzle, chest and socks, a teal collar. Side view,
     facing left on a 48 x 31 grid (opts.right mirrors it). */
  const DW = 48, DH = 31, GROUND = 29;
  const DOG_COLORS = {
    o: [0x4A, 0x30, 0x20],   // outline
    c: [0xD8, 0xA8, 0x6E],   // beige coat
    h: [0xEA, 0xC4, 0x8C],   // its lit back
    C: [0xB2, 0x80, 0x4E],   // coat in shade
    D: [0x96, 0x6A, 0x40],   // far legs
    w: [0xF6, 0xEC, 0xD6],   // cream
    W: [0xD8, 0xC6, 0xA6],   // cream, far side
    p: [0xE6, 0xB0, 0xA0],   // inside the ear
    e: [0x1C, 0x14, 0x12],   // eye
    l: [0xF6, 0xEC, 0xD6],   // eye glint
    k: [0x22, 0x18, 0x14],   // nose
    m: [0xD6, 0x66, 0x6E],   // tongue
    r: [0x2C, 0x8C, 0x88],   // collar
    y: [0xF2, 0xC1, 0x4E],   // its tag
  };
  const DOG_SHARE = { w: 0.5, W: 0.6, e: 0.4, l: 0.3, k: 0.4, y: 0.5 };

  // walk cycle: duty = share of the stride a paw is down; A = reach, in sprite px
  const WALK = { n: 8, ms: 140, duty: 0.62, A: 2.5, lift: 2.2, phase: [0.25, 0.75, 0.0, 0.5] };
  const TROT = { n: 8, ms: 85, duty: 0.45, A: 3.2, lift: 2.8, phase: [0.0, 0.5, 0.5, 0.0] };
  const stepOf = (G) => +(2 * G.A / (G.duty * G.n)).toFixed(3);
  const GAITS = {
    stand: { n: 1, ms: 0 },
    wag: { n: 4, ms: 120 },
    sit: { n: 2, ms: 900 },
    lie: { n: 2, ms: 1200 },
    sleep: { n: 2, ms: 1500 },
    walk: { n: WALK.n, ms: WALK.ms, step: stepOf(WALK) },
    trot: { n: TROT.n, ms: TROT.ms, step: stepOf(TROT) },
  };

  // where a paw is, relative to its hip, at stride phase p (moving left)
  function paw(G, p) {
    p = ((p % 1) + 1) % 1;
    if (p < G.duty) return { dx: -G.A + 2 * G.A * (p / G.duty), lift: 0 };
    const q = (p - G.duty) / (1 - G.duty);
    return { dx: G.A - 2 * G.A * q, lift: Math.sin(q * Math.PI) * G.lift };
  }

  function dogGrid(gait, f) {
    const g = new Grid(DW, DH);
    const kind = gait === "walk" || gait === "trot" || gait === "wag" ? "stand" : (GAITS[gait] ? gait : "stand");
    const G = gait === "trot" ? TROT : WALK;
    const moving = gait === "walk" || gait === "trot";
    const t = moving ? f / G.n : 0;

    // pose numbers
    let bob = 0, headX = 11, headY = 8.5, tailX = 39.2, tailY = 8.4, eyes = "open", mouth = false, ears = "up";
    if (moving) bob = Math.round(Math.abs(Math.sin(t * Math.PI * 4)) * 0.6);
    if (gait === "wag") { tailX += [0, 1, 0, -1][f % 4]; tailY += [0, -0.6, 0, -0.6][f % 4]; mouth = true; }
    if (kind === "sit") { headY = 6.8; headX = 11.5; tailX = 38.5; tailY = 24.5; eyes = f % 2 ? "open" : "open"; }
    if (kind === "lie") { headY = 14.6; headX = 11; tailX = 40; tailY = 17.6; eyes = f % 2 ? "open" : "open"; }
    if (kind === "sleep") { headY = 20.4; headX = 11.4; tailX = 40.4; tailY = 19.4; eyes = "shut"; ears = "soft"; }

    const coatFar = "D", sockFar = "W";
    const leg = (hx, hy, fx, fy, far, hind) => {
      const c = far ? coatFar : "c", s = far ? sockFar : "w";
      if (hind) {
        const kx = hx + 1.6 + (fx - hx) * 0.2, ky = hy + (fy - hy) * 0.55;
        g.limb(hx, hy, kx, ky, 3.6, 2.4, c);
        g.limb(kx, ky, fx + 0.4, fy, 2.4, 2.2, c);
      } else g.limb(hx, hy, fx, fy, 2.8, 2.3, c);
      // a cream sock and the paw
      for (let y = Math.round(fy - 3); y <= Math.round(fy); y++)
        for (let x = Math.round(fx - 1.6); x <= Math.round(fx + 1.4); x++) if (g.get(x, y) === c) g.put(x, y, s);
      g.put(Math.round(fx - 1.6), Math.round(fy), s);
    };

    if (kind === "stand") {
      const hips = [[17.6, 18.5, false], [33.6, 18, true], [20.4, 18.5, false], [36.2, 18, true]]; // far fore, far hind, near fore, near hind
      const order = [0, 1, 2, 3];
      const feet = order.map((i) => {
        const [hx, hy, hind] = hips[i];
        const pw = moving ? paw(G, t + G.phase[i]) : { dx: 0, lift: 0 };
        return { hx, hy: hy + bob, fx: hx + pw.dx + (hind ? -0.6 : 0), fy: GROUND - pw.lift, hind };
      });
      leg(feet[0].hx, feet[0].hy, feet[0].fx, feet[0].fy, true, false);
      leg(feet[1].hx, feet[1].hy, feet[1].fx, feet[1].fy, true, true);
      // tail behind the body
      g.ell(tailX, tailY + bob, 4.5, 4.3, "c");
      g.ell(tailX + 0.8, tailY + bob + 0.7, 2.2, 2.0, "w");
      g.put(Math.round(tailX + 0.8), Math.round(tailY + bob + 0.3), "C");
      g.poly([[35.4, 12.6 + bob], [37.6, 10.4 + bob], [39.4, 12.4 + bob], [37.2, 14.6 + bob]], "c");
      // body and chest
      g.ell(27, 16 + bob, 11.6, 5.3, "c");
      g.ell(17.6, 16.4 + bob, 4.6, 5.4, "c");
      g.ell(34.6, 17.4 + bob, 4.2, 4.6, "c");   // the haunch
      for (let y = 0; y < DH; y++)
        for (let x = 0; x < DW; x++) {
          if (g.get(x, y) !== "c") continue;
          const belly = y + 0.5 > 19.7 + bob && x > 15 && x < 31 - Math.max(0, y - 20 - bob) * 2;
          if (belly || (x < 19.5 && y + 0.5 > 13.8 + bob && y < 22)) g.put(x, y, "w");
        }
      leg(feet[2].hx, feet[2].hy, feet[2].fx, feet[2].fy, false, false);
      leg(feet[3].hx, feet[3].hy, feet[3].fx, feet[3].fy, false, true);
    } else if (kind === "sit") {
      // far front leg, tail on the ground, the body upright-ish, near legs
      leg(20.4, 19.5, 20.6, GROUND, true, false);
      g.ell(tailX, tailY, 3.8, 3.2, "c");
      g.ell(tailX + 0.6, tailY + 0.5, 1.8, 1.5, "w");
      g.poly([[15.6, 10.4], [26, 11.2], [33.6, 17.2], [35.4, 24.4], [33.4, 28.6], [21.6, 28.6], [16.2, 22.4]], "c");
      g.ell(30.6, 23.6, 5.0, 4.8, "c");          // the haunch, folded
      for (let y = 0; y < DH; y++)
        for (let x = 0; x < DW; x++) {
          if (g.get(x, y) !== "c") continue;
          if (x < 20.5 && y + 0.5 > 12.6 && y < 24) g.put(x, y, "w");
        }
      leg(17.6, 19.5, 17.4, GROUND, false, false);
      for (let x = 24; x <= 29; x++) { g.put(x, GROUND, "w"); g.put(x, GROUND - 1, x < 26 ? "w" : "c"); }   // hind paw
    } else {
      // lie / sleep: body on the floor, front paws ahead, haunch folded
      const breath = kind === "sleep" || kind === "lie" ? f % 2 : 0;
      g.ell(tailX, tailY, 4.0, 3.6, "c");
      g.ell(tailX + 0.7, tailY + 0.6, 1.9, 1.7, "w");
      g.limb(19, 25.6, 11.4, 27.6, 2.6, 2.4, "D");      // far front leg, ahead
      g.ell(27.6, 23.4 - breath * 0.4, 12.2, 5.1 + breath * 0.4, "c");
      g.ell(18.6, 22.6, 4.4, 5.0, "c");
      g.ell(34.2, 23.6, 5.0, 4.6, "c");               // the haunch
      for (let y = 0; y < DH; y++)
        for (let x = 0; x < DW; x++) {
          if (g.get(x, y) !== "c") continue;
          if ((y > 26 && x < 33) || (x < 20 && y + 0.5 > 21)) g.put(x, y, "w");
        }
      g.limb(20, 27, 8.6, 27.8, 2.8, 2.4, "c");         // near front leg, ahead on the floor
      for (let x = 6; x <= 11; x++) for (let y = 26; y <= 28; y++) if (g.get(x, y) === "c") g.put(x, y, "w");
      for (let x = 11; x <= 13; x++) for (let y = 26; y <= 28; y++) if (g.get(x, y) === "D") g.put(x, y, "W");
      for (let x = 29; x <= 33; x++) { g.put(x, GROUND - 1, "w"); g.put(x, GROUND - 2, x < 31 ? "w" : "c"); }   // hind paw
    }

    // neck, head, ears, muzzle
    const hb = kind === "stand" ? bob : 0;
    const hx = headX, hy = headY + hb;
    if (kind !== "sleep") g.poly([[hx + 1, hy + 0.6], [hx + 7, hy - 0.6], [hx + 10, hy + 6.4], [hx + 4.6, hy + 10.4]], "c");
    else g.poly([[hx + 2, hy - 1], [hx + 8, hy - 1.4], [hx + 10.4, hy + 4], [hx + 4, hy + 5]], "c");
    // the far ear first, then the head, then the near ear
    if (ears === "up") g.poly([[hx - 2.8, hy - 3], [hx - 2.1, hy - 7.6], [hx + 0.6, hy - 3.9]], "C");
    else g.poly([[hx - 2.6, hy - 3], [hx - 0.6, hy - 7], [hx + 0.8, hy - 3.6]], "C");
    g.ell(hx, hy, 5.6, 4.6, "c");
    if (ears === "up") {
      g.poly([[hx - 0.2, hy - 3.6], [hx + 2.6, hy - 8.0], [hx + 4.8, hy - 2.6]], "c");
      g.poly([[hx + 1.2, hy - 3.6], [hx + 2.5, hy - 6.2], [hx + 3.6, hy - 3.2]], "p");
    } else {
      g.poly([[hx + 0.4, hy - 3.6], [hx + 4.4, hy - 7.0], [hx + 5.0, hy - 2.4]], "c");
      g.poly([[hx + 1.8, hy - 3.4], [hx + 4.0, hy - 5.6], [hx + 4.2, hy - 2.8]], "p");
    }
    // cream cheek and muzzle (the muzzle points left)
    g.ell(hx - 1.4, hy + 2.4, 3.4, 2.3, "w");
    g.poly([[hx - 4, hy - 0.2], [hx - 8.8, hy + 0.9], [hx - 9.2, hy + 3.4], [hx - 7.4, hy + 4.6], [hx - 2.6, hy + 4.4]], "w");
    g.put(hx - 9, hy + 1, "k"); g.put(hx - 9, hy + 2, "k"); g.put(hx - 8, hy + 1, "k");   // nose
    g.put(hx - 6, hy + 3.4, "C"); g.put(hx - 5, hy + 3.6, "C");                           // mouth line
    if (mouth) { g.put(hx - 6, hy + 4.4, "m"); g.put(hx - 5, hy + 4.6, "m"); }
    // eye, with a cream brow dot above
    const ex = Math.round(hx - 3), ey = Math.round(hy - 1);
    if (eyes === "open") { g.put(ex, ey, "e"); g.put(ex + 1, ey, "e"); g.put(ex, ey + 1, "e"); g.put(ex + 1, ey + 1, "e"); g.put(ex, ey, "l"); }
    else { g.put(ex, ey + 1, "e"); g.put(ex + 1, ey + 1, "e"); g.put(ex - 1, ey, "C"); }
    g.put(ex + 1, ey - 2, "w");
    // the collar, round the neck, and its tag
    if (kind !== "sleep") {
      for (let i = 0; i <= 8; i++) {
        const x = hx + 3.6 + i * 0.32, y = hy + 4.4 - i * 0.62;
        for (const d of [0, 1]) { const v = g.get(Math.round(x + d), Math.round(y)); if (v === "c" || v === "w" || v === "C") g.put(x + d, y, "r"); }
      }
      g.put(hx + 4, hy + 5.6, "y");
    }

    // light: a lit back, a shaded belly line, then the outline
    g.rim("c", "h", 0, -1);
    g.rim("c", "C", 0, 1);
    g.outline("o");
    return g;
  }

  const petCache = frameCache(220);
  function petCanvas(gait, frame, right, k) {
    const G = GAITS[gait] ? gait : "stand";
    const n = GAITS[G].n;
    const f = ((frame | 0) % n + n) % n;
    const kq = kStep(k);
    return petCache.get(`${G}:${f}:${right ? 1 : 0}:${kq}`, () => toCanvas(dogGrid(G, f), DOG_COLORS, DOG_SHARE, kq, right));
  }

  const pet = {
    w: DW, h: DH,
    gaits: GAITS,
    /* (x, y) is the top-left of the sprite box; u ctx units per sprite
       pixel; frame counts up at gaits[gait].ms. While walking or trotting,
       move the sprite gaits[gait].step sprite pixels per frame (toward the
       way it faces) and the planted paws stay put on the floor.
       opts: {right, k}: right mirrors it to face right; k is the night level. */
    draw(ctx, x, y, u, gait, frame, opts) {
      const o = opts || {};
      const c = petCanvas(gait, frame, !!o.right, o.k);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, Math.round(x), Math.round(y), DW * u, DH * u);
    },
    canvas: (gait, frame, opts) => petCanvas(gait, frame, !!(opts && opts.right), opts && opts.k),
    url(w, h, k, gait, frame, right) { return fitURL(petCanvas(gait || "stand", frame || 0, !!right, k), w, h); },
  };

  // ------------------------------------------------------------ the room

  /* WHERE THINGS STAND (a proposal for the engine's layout). Fractions of
     the room: x of its width, y of its height. The composition is the
     product's own: the window is an arch on the LEFT with a window seat
     under it, the desk is a shorter trestle on the RIGHT, the goal hangs on
     a garland over the desk, the ceiling is a flat beam (no slope), there
     is no bed and no bookcase, the dog has its own bed. The concept picture
     drawn from these same numbers: test/out/theme/room-concept.png. */
  const layout = {
    v: 2,
    floorY: 0.787,
    beam: { h: 0.027 },
    window: { x0: 0.083, x1: 0.292, y0: 0.133, y1: 0.567, arch: true, transom: 0.4 },
    seat: { x0: 0.058, x1: 0.317, top: 0.587, cubbies: 3 },
    buddy: { cx: 0.15, base: 0.587 },
    plantHang: { cx: 0.316, y: 0.027, drop: 0.2 },
    plantFloor: { cx: 0.358, h: 0.25 },
    clock: { cx: 0.435, cy: 0.14, r: 9 },
    calendar: { x0: 0.408, y0: 0.22, w: 26, h: 36 },
    desk: { x0: 0.492, x1: 0.896, y: 0.573 },
    goal: { x0: 0.492, x1: 0.896, y: 0.085, sign: { cx: 0.694, y: 0.13, w: 74, h: 18 } },
    cork: { cx: 0.604, cy: 0.34, r: 22 },
    shelves: { x0: 0.683, x1: 0.79, y: [0.27, 0.37] },
    lamp: { base: 0.94, top: 0.19, shade: { cx: 0.817, y: 0.41 } },
    on: { mug: 0.528, agenda: 0.585, typewriter: 0.66, headphones: 0.748, tv: 0.85 },
    chair: { cx: 0.66, seat: 0.66, w: 34 },
    rug: { cx: 0.66, cy: 0.9, rx: 0.19, ry: 0.06 },
    petbed: { cx: 0.23, cy: 0.917, rx: 0.075, ry: 0.035 },
    backpack: { x0: 0.446, x1: 0.488 },
    strip: { cx: 0.62 },
    removed: ["slope", "bed", "bookcase", "wall-tv"],
  };

  /* What changes on each object, as data (docs/dev/theme.md explains each
     variant). Per object id:
       shape    a silhouette variant the object's drawing code implements
       pattern  a surface detail variant
       colors   named role colours for the parts the variant adds or recolours
       tones    base-palette tone names to replace while drawing this object
                only (PIX.withTweak puts them in front of the palette)
       was      the first-pass variant, kept for code that only knows it
     All colours are pre-grade, like the palette. A missing entry or field
     means: draw it as before. */
  const C = {
    navy: [0x24, 0x33, 0x5E], navyL: [0x3A, 0x50, 0x88],
    teal: [0x2E, 0x6E, 0x66], tealD: [0x1E, 0x4C, 0x46], tealL: [0x3A, 0x8A, 0x86],
    mint: [0x8E, 0xCC, 0xB6], mintD: [0x5E, 0x9C, 0x88],
    mustard: [0xD8, 0xA8, 0x4E], mustardD: [0xB0, 0x84, 0x34], mustardL: [0xF0, 0xD8, 0x9A],
    yellow: [0xF6, 0xC9, 0x3E], yellowD: [0xCC, 0x94, 0x1C],
    oat: [0xEE, 0xE2, 0xC8], oatD: [0xC8, 0xB8, 0x98], paper: [0xFA, 0xF3, 0xE2],
    ink: [0x2A, 0x24, 0x2E], steel: [0x9A, 0xA2, 0xAE], chrome: [0xD6, 0xD6, 0xD6], brass: [0xD0, 0xA4, 0x4C],
    ash: [0xE4, 0xD4, 0xB4], ashD: [0xCC, 0xB6, 0x90], walnut: [0x7A, 0x4E, 0x32], walnutD: [0x56, 0x36, 0x24],
    leather: [0x6E, 0x4A, 0x2E], verm: [0xD2, 0x47, 0x3A], rose: [0xE8, 0x9C, 0xB0],
    white: [0xF2, 0xEC, 0xE0], whiteD: [0xC4, 0xBC, 0xAE], indigo: [0x3C, 0x4E, 0x84], indigoD: [0x2A, 0x36, 0x60],
  };
  const tweak = {
    goal: { shape: "garland", pattern: "flags", was: { shape: "pennant", pattern: "cord-hung" },
      colors: { paper: C.paper, ink: C.ink, cord: C.walnutD, flagA: C.mustard, flagB: C.tealL, flagC: C.rose } },
    window: { shape: "arched", pattern: "no-curtains", seat: true, was: { shape: "four-pane", pattern: "curtain-stripe" },
      colors: { frame: C.oat, frameD: C.oatD, sill: C.ash, seat: C.white, seatD: C.whiteD, cushion: C.mustard, cushionD: C.mustardD,
        pillowA: C.tealL, pillowB: C.rose, curtain: C.mustard, curtainD: C.mustardD, stripe: C.mustardL },
      tones: { curt: C.mustard, curtd: C.mustardD }, tree: "trees" },
    desk: { shape: "trestle", pattern: "plain", colors: { top: C.ash, topD: C.ashD, leg: C.ashD, legD: [0xA2, 0x8C, 0x68] } },
    chair: { shape: "spindle", pattern: "cushion", was: { shape: "rounded-back", pattern: "fabric-weave" },
      colors: { wood: C.walnut, woodD: C.walnutD, seat: C.mustard, seatD: C.mustardD, frame: C.walnutD, wheel: C.walnutD } },
    lamp: { shape: "floor-arc", pattern: "plain", was: { shape: "dome-shade" },
      colors: { shade: C.tealL, shadeD: C.teal, shadeIn: [0xF6, 0xE2, 0xA8], arm: C.ink, base: C.ink } },
    shelf: { shape: "floating-pair", pattern: "plain", was: { shape: "visible-brackets" },
      colors: { board: C.ash, boardD: C.ashD, bracket: C.ink } },
    rug: { shape: "oval", pattern: "border-stripes", was: { shape: "rounded-rect", pattern: "three-stripes" },
      colors: { a: C.indigo, b: C.oat, c: C.mustard, fringe: C.paper },
      tones: { rug: C.indigo, rugd: C.indigoD, rugl: C.oat } },
    plants: { shape: "hanging-and-floor", pattern: "macrame", was: { shape: "round-leaves", pattern: "glazed-pot" },
      colors: { pot: C.white, potD: C.whiteD, rope: C.oat, soil: [0x44, 0x2A, 0x1C] } },
    tv: { shape: "portable", pattern: "antenna", place: "desk", was: { shape: "rounded-crt", pattern: "two-knobs" },
      colors: { body: C.verm, bodyD: [0xA0, 0x34, 0x2A], knob: C.oat, rim: C.ink, handle: C.ink } },
    typewriter: { shape: "low-carriage", pattern: "round-keys",
      colors: { body: C.mint, bodyD: C.mintD, keys: C.paper, platen: C.ink } },
    headphones: { shape: "on-stand", pattern: "plain", was: { shape: "round-cups" },
      colors: { band: C.oat, cup: C.navy, cushion: C.navyL, slider: C.oatD, stand: C.walnut } },
    cork: { shape: "round", pattern: "pins-yellow-teal", was: { shape: "rounded-frame" },
      colors: { frame: C.walnut, pinA: C.yellow, pinB: C.tealL },
      tones: { cork: [0xC6, 0x96, 0x5E], corkd: [0xA0, 0x74, 0x46] } },
    calendar: { shape: "tear-off", pattern: "plain-header", was: { shape: "spiral-top" },
      colors: { header: C.navy, digits: C.yellow, paper: C.white, ring: C.steel, nail: C.ink } },
    agenda: { shape: "rounded-corners", pattern: "elastic-band",
      colors: { cover: C.teal, coverD: C.tealD, band: C.yellow, pages: C.paper } },
    strip: { shape: "four-sockets", pattern: "switch-lit",
      colors: { body: C.white, bodyD: C.whiteD, switch: C.tealL, cable: C.ink } },
    backpack: { shape: "roll-top", pattern: "leather-straps", place: "floor-by-desk",
      colors: { body: C.mustard, bodyD: C.mustardD, strap: C.leather, buckle: C.chrome } },
    mug: { shape: "tall", pattern: "band",
      colors: { body: C.yellow, bodyD: C.yellowD, band: C.navy, coffee: [0x4A, 0x2C, 0x1C] } },
    clock: { shape: "round-simple", colors: { face: C.paper, rim: C.walnut, hands: C.ink } },
    petbed: { shape: "round-cushion", colors: { rim: C.verm, rimD: [0xA0, 0x34, 0x2A], inside: C.oat } },
    ceiling: { shape: "beam", colors: { beam: C.walnut, beamD: C.walnutD } },
    floor: { pattern: "wide-planks", colors: { a: [0x9C, 0x6C, 0x48], b: [0x8A, 0x5C, 0x3C], seam: [0x56, 0x36, 0x24] } },
  };

  window.CasaTheme = {
    name: "casa",
    version: 2,
    grade,
    P,
    palette,
    tone,
    trees,
    buddy,
    pet,
    tweak,
    layout,
    // render every frame now (call once when the room is idle); cheap after
    warm(k) {
      for (const m in MOODS) for (let f = 0; f < MOODS[m].n; f++) buddyCanvas(m, f, false, k);
      for (const g in GAITS) for (let f = 0; f < GAITS[g].n; f++) { petCanvas(g, f, false, k); petCanvas(g, f, true, k); }
    },
    _debug: { buddyGrid, dogGrid, stats: () => ({ buddy: buddyCache.size(), pet: petCache.size(), grade: memo.size }) },
  };
})();
