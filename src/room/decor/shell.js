/* Decor: the room's shell. Wall, ceiling beam, floor, skirting, rug.

   Every painter in decor/ receives D, the drawing kit built by room.js:
     D.r(x, y, w, h, tone)   filled rect (tone = palette name or [r,g,b])
     D.p(x, y, tone)         one pixel
     D.dith(x, y, w, h, a, b, k)  two tones in the Bayer pattern (small areas)
     D.blit(canvas, x, y)    draw a rastered surface
     D.clear(x, y, w, h)     make pixels transparent (the window glass)
     D.wall(x, y, w, h)      paint the plain wall back over a rect
     D.emit(x, y, w, h)      these pixels give light: night never darkens them
     D.lamp(cx, cy, r, s)    add a pool of light (0..1) to the light map
     D.hot(id, x, y, w, h, label)  register a hotspot
     D.roles(tw, defaults)   role colours from a theme tweak, else default tones
     D.tone(t)               a tone as a CSS colour (for fillStyle)
     D.g                     the layout (engine/layout.js), D.W, D.H
     D.state                 room data: focus, tasks, calendar, notes, battery, lampOn...
   Painters draw the day picture; room.js applies night and the theme grade. */
const Decor = {};

Decor.shell = function (D) {
  const { g, W, H } = D;
  const T = PIX.T, thr = PIX.thr;

  // --- wall: four plaster tones, lighter round the window, darker in corners
  const tones = [T("plasx"), T("plasd"), T("plast"), T("plas")];
  const wcx = g.win.x + g.win.w / 2, wcy = g.win.y + g.win.h * 0.6;
  const sx = W * 0.4, sy = H * 0.5;
  const wall = PIX.raster(W, g.floorY, (set) => {
    for (let y = 0; y < g.floorY; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x - wcx) / sx, dy = (y - wcy) / sy;
        let v = 0.56 + 0.3 * Math.exp(-(dx * dx + dy * dy));
        v -= 0.12 * Math.max(0, 1 - y / (H * 0.16));                          // under the ceiling
        v -= 0.14 * Math.max(0, Math.abs(x - W / 2) / (W / 2) - 0.75) / 0.25;   // toward the side walls
        if (y > g.desk.y + g.desk.slab && x > g.desk.x0 + 2 && x < g.desk.x1 - 2)
          v -= 0.18 + 0.1 * (1 - (y - g.desk.y) / Math.max(1, g.floorY - g.desk.y));  // under the desk
        // flat tones with a narrow dithered seam between them, not dots everywhere
        const t = Math.max(0, Math.min(2.999, v * 3));
        const i = t | 0, f = t - i;
        const up = f > 0.62 ? true : f < 0.38 ? false : (f - 0.38) / 0.24 > thr(x, y);
        set(x, y, up ? tones[Math.min(3, i + 1)] : tones[i]);
      }
    }
  });
  D.wallCanvas(wall.c);
  D.blit(wall.c, 0, 0);

  // --- ceiling beam
  PIX.withTweak("ceiling", (tw) => {
    const c = D.roles(tw, { beam: "wood", beamD: "umber" });
    D.r(0, 0, W, g.beam, c.beam);
    D.r(0, g.beam - 1, W, 1, c.beamD);
    D.r(0, 0, W, 1, c.beamD);
    for (let x = 6; x < W; x += 23) D.p(x, 2 + (x % 3), c.beamD);   // grain
    D.dith(0, g.beam, W, 2, "plasd", "plasx", 0.35);
  });

  // --- floor: wide planks, a little lighter near the wall
  const fy = g.floorY, fh = H - fy;
  PIX.withTweak("floor", (tw) => {
    const c = D.roles(tw, { a: "oak", b: "wood", seam: "umber" });
    const A = Array.isArray(c.a) ? c.a : T(c.a), B = Array.isArray(c.b) ? c.b : T(c.b), J = Array.isArray(c.seam) ? c.seam : T(c.seam);
    const lift = PIX.mix(A, [255, 255, 255], 0.12);
    // by day the window throws a slanted pale patch on the floor
    const sun = D.state.sunPatch;
    const px0 = g.win.x + 6, px1 = g.win.x + g.win.w - 6, slant = 0.9, depth = Math.round(fh * 0.62);
    const inPatch = (x, y) => sun && y > 2 && y < depth && x > px0 + y * slant && x < px1 + y * slant;
    const warmLight = [255, 236, 196];
    const floor = PIX.raster(W, fh, (set) => {
      const rowH = Math.max(6, Math.round(fh / 7));
      for (let y = 0; y < fh; y++) {
        const row = Math.floor(y / rowH), inRow = y % rowH;
        const rnd = PIX.rand(row * 7919 + 13);
        let x0 = -Math.floor(rnd() * 60), ix = 0;
        const seams = [];
        while (x0 < W) { const len = 60 + Math.floor(rnd() * 50); seams.push([x0, len, rnd() < 0.5, rnd()]); x0 += len; }
        for (let x = 0; x < W; x++) {
          while (ix < seams.length - 1 && x >= seams[ix][0] + seams[ix][1]) ix++;
          const s = seams[ix];
          let col;
          if (inRow === rowH - 1 || x === s[0]) col = J;
          else {
            col = s[2] ? A : B;
            if (inRow === 0 && thr(x, y) < 0.5) col = lift;                       // the lit edge
            if (inRow === (rowH >> 1) && ((x + Math.floor(s[3] * 30)) % 17) < 5) col = s[2] ? B : J;  // grain
            if (y < 3 && thr(x, y) < 0.5) col = J;                               // contact shadow
          }
          if (inPatch(x, y)) {
            const edge = Math.min(x - (px0 + y * slant), (px1 + y * slant) - x, depth - y);
            if (edge > 3 || thr(x, y) < 0.5) col = PIX.mix(col, warmLight, 0.22);
          }
          set(x, y, col);
        }
      }
    });
    D.blit(floor.c, 0, fy);
  });

  // --- skirting
  D.r(0, fy - 4, W, 4, "cream");
  D.r(0, fy - 4, W, 1, "bone");
  D.r(0, fy - 1, W, 1, "tan");

  // --- oval rug under the chair (theme: oval, border-stripes)
  PIX.withTweak("rug", (tw) => {
    const c = D.roles(tw, { a: "rug", b: "rugl", c: "gold", fringe: "bone" });
    const rgbOf = (v) => (Array.isArray(v) ? v : T(v));
    const a = rgbOf(c.a), b = rgbOf(c.b), m = rgbOf(c.c), fringe = rgbOf(c.fringe), ad = PIX.mix(a, [0, 0, 0], 0.25);
    const R = g.rug, w = R.rx * 2 + 1, h = R.ry * 2 + 1;
    const rug = PIX.raster(w + 6, h, (set) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x - R.rx) / R.rx, v = (y - R.ry) / R.ry;
        const d = Math.sqrt(u * u + v * v);
        if (d > 1) continue;
        // indigo ground, an oat outer ring, a mustard inner ring
        let col = a;
        if (d > 0.95) col = ad;
        else if (d > 0.83) col = b;
        else if (d > 0.74) col = a;
        else if (d > 0.66) col = m;
        else if ((x + y * 2) % 7 === 0) col = ad;                                // weave
        set(x + 3, y, col);
      }
      // short fringe at both ends
      for (let y = R.ry - 3; y <= R.ry + 3; y += 2) { set(1, y, fringe); set(2, y, fringe); set(w + 3, y, fringe); set(w + 4, y, fringe); }
    });
    D.blit(rug.c, R.cx - R.rx - 3, R.cy - R.ry);
  });
};
