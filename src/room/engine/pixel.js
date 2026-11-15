/* PIX: the grid and the palette.

   The room is drawn on one logical grid. A backing canvas of LW x LH logical
   pixels is stretched by a whole number of DEVICE pixels per logical pixel
   (image-rendering: pixelated), so one fillRect(x, y, 1, 1) is always one hard
   square on screen. Tones never blend smoothly: a change of tone across a
   surface is two palette colours in a 4x4 ordered (Bayer) dither.

   Colour pipeline
     tone name -> CasaTheme.P[name] override (or the object's tweak tones)
               -> base palette below
     The room canvas is painted with these "day" tones, then PIX.shade() pulls
     every pixel toward the night tone by the hour (less where a lamp reaches)
     and finally runs CasaTheme.grade([r,g,b]) on it, memoised per colour.
     Canvases painted directly (sky, clock hands) call PIX.col(), which applies
     the theme override and the grade in one go.

   Tone names are part of the theme API: Agent 5 may override any of them. */
const PIX = (() => {
  // ---------------------------------------------------------------- palette
  const BASE = {
    ink:   [0x0B, 0x0D, 0x12],   // the darkest thing in the room
    coal:  [0x16, 0x1A, 0x24],
    slate: [0x24, 0x2C, 0x3C],
    blue:  [0x38, 0x44, 0x5C],
    steel: [0x56, 0x65, 0x7F],
    mist:  [0x8E, 0x9C, 0xB4],
    pale:  [0xC6, 0xCE, 0xDC],
    bone:  [0xF4, 0xF1, 0xEA],   // paper white
    cream: [0xE9, 0xDF, 0xC6],
    paper: [0xF7, 0xF0, 0xDC],
    // wall plaster, light to dark
    plas:  [0x60, 0x6F, 0x80],
    plast: [0x55, 0x63, 0x72],
    plasd: [0x3F, 0x49, 0x55],
    plasx: [0x2A, 0x30, 0x37],
    // warm accents
    gold:  [0xF2, 0xC1, 0x4E],
    amber: [0xB8, 0x86, 0x2B],
    verm:  [0xD2, 0x47, 0x3A],
    rust:  [0x7E, 0x2A, 0x22],
    flame: [0xFC, 0x94, 0x3E],
    hay:   [0xFD, 0xC8, 0x5D],
    rose:  [0xE8, 0x98, 0xBD],
    berry: [0x90, 0x47, 0x4A],
    // greens
    leaf:  [0x5F, 0xB8, 0x6D],
    moss:  [0x3E, 0x8B, 0x4C],
    pine:  [0x1F, 0x5A, 0x2E],
    // cool accents
    teal:  [0x3F, 0x8C, 0x8F],
    sky:   [0x6E, 0xA8, 0xD8],
    lilac: [0x9A, 0x8C, 0xC8],
    // wood, lit to the joins
    oak:   [0xBF, 0x8C, 0x5B],
    wood:  [0xA6, 0x54, 0x29],
    umber: [0x6A, 0x33, 0x20],
    dark:  [0x3E, 0x1D, 0x16],
    soot:  [0x2D, 0x13, 0x0B],
    // pale wood for the desk and the floor
    birch: [0xD8, 0xB8, 0x8C],
    beech: [0xC4, 0x9A, 0x68],
    tan:   [0x9E, 0x76, 0x4C],
    // fabric
    curt:  [0x8F, 0xA9, 0xC4],   // curtain, lit
    curtd: [0x6C, 0x84, 0xA0],   // curtain, in its folds
    rug:   [0xA8, 0x4A, 0x3E],
    rugd:  [0x7A, 0x32, 0x2C],
    rugl:  [0xE0, 0xB8, 0x7A],
    cork:  [0xC2, 0x91, 0x5E],
    corkd: [0xA0, 0x72, 0x45],
    // every tone in the room goes toward this one at midnight
    night: [0x15, 0x1A, 0x27],
  };

  const theme = () => (typeof window !== "undefined" && window.CasaTheme) || null;
  let scope = null;                    // per-object tweak tones while drawing
  const valid = (c) => Array.isArray(c) && c.length >= 3 && c.every((v, i) => i > 2 || (typeof v === "number" && isFinite(v)));
  const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)));

  function T(name) {
    if (scope && valid(scope[name])) return scope[name];
    const t = theme();
    if (t && t.P && valid(t.P[name])) return t.P[name];
    return BASE[name] || [255, 0, 255];
  }

  /* CasaTheme.grade, called at most once per distinct colour. A missing or
     throwing grade is the identity. */
  const gradeMemo = new Map();
  let gradeFn = undefined;
  function grader() {
    const t = theme();
    const g = t && typeof t.grade === "function" ? t.grade : null;
    if (g !== gradeFn) { gradeFn = g; gradeMemo.clear(); }
    return g;
  }
  function grade(c) {
    const g = grader();
    if (!g) return c;
    const key = (c[0] << 16) | (c[1] << 8) | c[2];
    let out = gradeMemo.get(key);
    if (!out) {
      try { out = g([c[0], c[1], c[2]]); } catch (e) { out = null; }
      out = valid(out) ? [clamp8(out[0]), clamp8(out[1]), clamp8(out[2])] : [c[0], c[1], c[2]];
      if (gradeMemo.size > 50000) gradeMemo.clear();
      gradeMemo.set(key, out);
    }
    return out;
  }

  const rgb = (c, a) => a === undefined
    ? `rgb(${c[0]},${c[1]},${c[2]})`
    : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mix = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  const dusk = (c, k) => mix(c, T("night"), k);

  // tone -> day colour string for the base canvas (no grade: shade() grades)
  const fs = (name) => rgb(T(name));
  // tone -> final colour for canvases painted directly
  const col = (name, k) => grade(k ? dusk(T(name), k) : T(name));
  const css = (name, k, a) => rgb(col(name, k), a);

  /* Run fn with the object's tweak tones (CasaTheme.tweak[id].tones) in
     front of the palette. */
  function withTweak(id, fn) {
    const t = theme();
    const tw = t && t.tweak && t.tweak[id];
    const prev = scope;
    scope = tw && tw.tones && typeof tw.tones === "object" ? tw.tones : null;
    try { return fn(tw || {}); } finally { scope = prev; }
  }
  function tweak(id) {
    const t = theme();
    return (t && t.tweak && t.tweak[id]) || {};
  }

  // ---------------------------------------------------------------- the grid
  /* Device pixels per logical pixel, chosen so the room is about 280-300
     logical pixels tall (and at least ~440 wide) at any window size. */
  function measure(cssW, cssH, dpr) {
    dpr = dpr || 1;
    const dw = Math.max(1, Math.round(cssW * dpr)), dh = Math.max(1, Math.round(cssH * dpr));
    const px = Math.max(1, Math.round(Math.min(dh / 280, dw / 440)));
    const lw = Math.ceil(dw / px), lh = Math.ceil(dh / px);
    return { px, lw, lh, dpr, css: px / dpr, dw, dh };
  }

  // ---------------------------------------------------------------- dither
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const thr = (x, y) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;

  function buf(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    const x = c.getContext("2d");
    x.imageSmoothingEnabled = false;
    return { c, x };
  }

  /* A painter that writes straight into ImageData, for whole surfaces
     (wall, floor, sky) where a fillRect per pixel would be wasteful. */
  function raster(w, h, fn) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    const { c, x } = buf(w, h);
    const img = x.createImageData(w, h);
    const d = img.data;
    const set = (fx, fy, colr, a) => {
      const px = fx | 0, py = fy | 0;
      if (px < 0 || py < 0 || px >= w || py >= h) return;
      const i = (py * w + px) << 2;
      d[i] = colr[0]; d[i + 1] = colr[1]; d[i + 2] = colr[2];
      d[i + 3] = a === undefined ? 255 : Math.round(a * 255);
    };
    fn(set, w, h, d);
    x.putImageData(img, 0, 0);
    return { c, x, w, h };
  }

  // a vertical run of tones, dithered between neighbouring stops
  function ditherV(set, x0, y0, w, h, stops) {
    for (let y = 0; y < h; y++) {
      const t = h === 1 ? 0 : y / (h - 1);
      let i = 0;
      while (i < stops.length - 2 && stops[i + 1][0] <= t) i++;
      const a = stops[i], b = stops[i + 1] || stops[i];
      const f = Math.max(0, Math.min(1, (t - a[0]) / ((b[0] - a[0]) || 1)));
      for (let x = 0; x < w; x++) set(x0 + x, y0 + y, f > thr(x0 + x, y0 + y) ? b[1] : a[1]);
    }
  }

  function fill(set, x, y, w, h, colr, a) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) set(x + px, y + py, colr, a);
  }

  // two tones checked at a fixed density
  function mixFill(set, x, y, w, h, a, b, k) {
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) set(x + px, y + py, k > thr(x + px, y + py) ? b : a);
  }

  // ---------------------------------------------------------------- shapes
  function disc(ctx, cx, cy, r) {
    for (let y = -r; y <= r; y++) {
      const dx = Math.floor(Math.sqrt(Math.max(0, r * r + r * 0.4 - y * y)));
      ctx.fillRect(Math.round(cx - dx), Math.round(cy + y), dx * 2 + 1, 1);
    }
  }
  function discSet(set, cx, cy, r, colr, a) {
    for (let y = -r; y <= r; y++) {
      const dx = Math.floor(Math.sqrt(Math.max(0, r * r + r * 0.4 - y * y)));
      for (let x = -dx; x <= dx; x++) set(cx + x, cy + y, colr, a);
    }
  }
  function box(ctx, x, y, w, h) {
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  // seeded generator: the grain of a surface is the same on every load
  function rand(seed) {
    let s = (seed >>> 0) || 1;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  }

  // ---------------------------------------------------------------- night
  /* Pull an ImageData toward the night tone.
     k      0 (midday) .. ~0.62 (midnight)
     light  optional Float32Array (0..1 per pixel): how much a lamp reaches
     emit   optional Uint8Array: 1 where the pixel gives light (never darkened)
     warm   0..1, how warm the lamp light is
     The amount is quantised to 24 flat steps: a lamp's pool of light shows
     as soft rings, the way a pixel-art light does. */
  function shade(src, dst, opts) {
    const k = Math.max(0, opts.k || 0);
    const light = opts.light || null, emit = opts.emit || null;
    const warm = opts.warm || 0;
    const w = src.width, h = src.height, s = src.data, d = dst.data;
    const N = T("night"), H = T("hay");
    const g = grader();
    const LV = 24;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, p = i << 2;
        const a = s[p + 3];
        if (!a) { d[p + 3] = 0; continue; }
        let r = s[p], gg = s[p + 1], b = s[p + 2];
        const isEmit = emit && emit[i];
        if (!isEmit) {
          const L = light ? light[i] : 0;
          const kk = k * (1 - L);
          // flat steps, no dither: a dithered night reads as a grid of dots
          const q = Math.round(kk * LV) / LV;
          if (q > 0) { r += (N[0] - r) * q; gg += (N[1] - gg) * q; b += (N[2] - b) * q; }
          if (warm && L > 0.05) {
            const wq = Math.round(L * warm * 6) / 6 * 0.22;
            if (wq > 0) { r += (H[0] - r) * wq; gg += (H[1] - gg) * wq; b += (H[2] - b) * wq; }
          }
          r = r | 0; gg = gg | 0; b = b | 0;
        }
        if (g) {
          const c = gradeMemo.get((r << 16) | (gg << 8) | b) || grade([r, gg, b]);
          r = c[0]; gg = c[1]; b = c[2];
        }
        d[p] = r; d[p + 1] = gg; d[p + 2] = b; d[p + 3] = a;
      }
    }
    return dst;
  }

  return {
    BASE, T, fs, col, css, grade, rgb, mix, dusk, withTweak, tweak, theme,
    measure, thr, buf, raster, ditherV, fill, mixFill, disc, discSet, box, rand, shade,
  };
})();
