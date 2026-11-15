/* Layout: where everything stands, in logical pixels, for a room of W x H.

   The arrangement is the product's own (docs/dev/theme.md): an arched window
   on the left with a window seat under it, a trestle desk on the right with a
   garland and the goal sign above it, a round cork board, two floating
   shelves, a floor lamp arching over the desk, a hanging plant, the dog's bed
   on the floor. Positions are fractions of the room (x of W, y of H) taken
   from CasaTheme.layout when the theme provides one (v >= 2), else from the
   same numbers below. Small objects are fixed-size sprites placed by their
   centre, so the room reads from about 700x450 to 2560x1440. */
const Layout = (() => {
  const r = Math.round;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const DEFAULT = {
    floorY: 0.787,
    beam: { h: 0.027 },
    window: { x0: 0.083, x1: 0.292, y0: 0.133, y1: 0.567, transom: 0.4 },
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
  };

  // theme numbers win field by field; anything missing or malformed keeps the default
  function plan() {
    const t = typeof PIX !== "undefined" ? PIX.theme() : null;
    const L = t && t.layout && t.layout.v >= 2 ? t.layout : null;
    if (!L) return DEFAULT;
    const merge = (d, s) => {
      if (Array.isArray(d)) return Array.isArray(s) && s.length && s.every((v) => typeof v === "number" && isFinite(v)) ? s : d;
      if (d && typeof d === "object") {
        const o = {};
        for (const k in d) o[k] = merge(d[k], s && typeof s === "object" ? s[k] : undefined);
        return o;
      }
      return typeof s === typeof d && (typeof s !== "number" || isFinite(s)) ? s : d;
    };
    return merge(DEFAULT, L);
  }

  function compute(W, H) {
    const p = plan();
    const X = (f) => r(W * f), Y = (f) => r(H * f);
    const g = { W, H };
    g.floorY = Y(p.floorY);
    g.beam = Math.max(4, Y(p.beam.h));

    // arched window: the glass rect; the arch radius is half the glass width
    const w = p.window;
    g.win = { x: X(w.x0), y: Y(w.y0), w: X(w.x1) - X(w.x0), h: Y(w.y1) - Y(w.y0), f: 3, transom: w.transom };
    g.win.r = g.win.w >> 1;
    g.seat = { x0: X(p.seat.x0), x1: X(p.seat.x1), top: Y(p.seat.top), cubbies: clamp(p.seat.cubbies | 0, 1, 5) };

    g.plantHang = { cx: X(p.plantHang.cx), y: Math.max(g.beam, Y(p.plantHang.y)), drop: Y(p.plantHang.drop) };
    g.plantFloor = { cx: X(p.plantFloor.cx), h: Y(p.plantFloor.h), base: g.floorY + 2 };
    g.clock = { cx: X(p.clock.cx), cy: Y(p.clock.cy), r: clamp(p.clock.r | 0, 6, 12) };
    // tall enough for the month, the day, the next event's time and its title
    g.calendar = { x: X(p.calendar.x0), y: Y(p.calendar.y0), w: Math.max(24, p.calendar.w | 0), h: Math.max(42, p.calendar.h | 0) };

    g.deskY = Y(p.desk.y);
    g.desk = { x0: X(p.desk.x0), x1: X(p.desk.x1), y: g.deskY, slab: 4 };
    const gs = p.goal.sign;
    g.garland = { x0: X(p.goal.x0), x1: X(p.goal.x1), y: Y(p.goal.y) };
    g.banner = { cx: X(gs.cx), y: Y(gs.y), w: gs.w, h: gs.h, max: Math.max(60, g.garland.x1 - g.garland.x0 - 12) };

    g.cork = { cx: X(p.cork.cx), cy: Y(p.cork.cy), r: clamp(p.cork.r | 0, 14, 30) };
    g.shelves = { x0: X(p.shelves.x0), x1: X(p.shelves.x1), y: p.shelves.y.map(Y) };
    g.lamp = { x: X(p.lamp.base), top: Y(p.lamp.top), shadeX: X(p.lamp.shade.cx), shadeY: Y(p.lamp.shade.y) };
    g.on = {};
    for (const k in p.on) g.on[k] = X(p.on[k]);
    g.chair = { cx: X(p.chair.cx), seat: Y(p.chair.seat), w: p.chair.w | 0 || 34 };
    g.rug = { cx: X(p.rug.cx), cy: Y(p.rug.cy), rx: X(p.rug.rx), ry: Math.max(8, Y(p.rug.ry)) };
    g.petbed = { cx: X(p.petbed.cx), cy: Y(p.petbed.cy), rx: Math.max(16, X(p.petbed.rx)), ry: Math.max(5, Y(p.petbed.ry)) };
    g.backpack = { x: X(p.backpack.x0), w: clamp(X(p.backpack.x1) - X(p.backpack.x0), 14, 22), h: 21, base: g.floorY + 5 };
    g.strip = { x: X(p.strip.cx) - 12, y: g.floorY + 4, w: 24, h: 5 };

    // live sprites: the buddy sits on the window seat, the pet lives on the floor
    g.buddy = { cx: X(p.buddy.cx), base: Y(p.buddy.base) };
    g.pet = { y: g.petbed.cy + 4, home: g.petbed.cx, min: X(0.1), max: X(0.86) };
    return g;
  }

  return { compute, DEFAULT };
})();
