/* Decor: the arched window and the window seat under it.

   The glass is cut out of the base picture (D.clear, row by row along the
   arch) so the live view from Sky.paintView shows through it. A mullion and
   a transom make four panes; the seat below has a cushion, two pillows and
   open cubbies. Theme: CasaTheme.tweak.window colours (frame, sill, seat,
   cushion, pillows). */
Decor.window = function (D) {
  PIX.withTweak("window", (tw) => Decor.windowDraw(D, tw));
};

// half-width of the arched shape at row y (relative to its top), radius r, total width w
Decor.archSpan = function (yy, r, w) {
  if (yy >= r) return w / 2;
  const dy = r - yy - 0.5;
  return Math.sqrt(Math.max(0, r * r - dy * dy));
};

Decor.windowDraw = function (D, tw) {
  const { g } = D;
  const c = D.roles(tw, {
    frame: "bone", frameD: "pale", sill: "birch", seat: "bone", seatD: "pale",
    cushion: "gold", cushionD: "amber", pillowA: "teal", pillowB: "rose",
  });
  const w = g.win, f = w.f, cx = w.x + w.w / 2;
  const R = w.r;

  // shadow on the wall, then the frame (an arch one frame-width larger than the glass)
  for (let yy = 0; yy < w.h + 2 * f; yy++) {
    const hw = Math.round(Decor.archSpan(yy, R + f, w.w + 2 * f));
    D.dith(Math.round(cx - hw) + 2, w.y - f + yy + 2, hw * 2, 1, "plasd", "plast", 0.5);
  }
  for (let yy = 0; yy < w.h + 2 * f; yy++) {
    const hw = Math.round(Decor.archSpan(yy, R + f, w.w + 2 * f));
    D.r(Math.round(cx - hw), w.y - f + yy, hw * 2, 1, c.frame);
    D.p(Math.round(cx + hw) - 1, w.y - f + yy, c.frameD);
  }
  // the glass, cut along the arch
  for (let yy = 0; yy < w.h; yy++) {
    const hw = Math.round(Decor.archSpan(yy, R, w.w));
    if (hw > 0) D.clear(Math.round(cx - hw), w.y + yy, hw * 2, 1);
  }
  // mullion, transom, and a thin inner shadow line
  const mx = Math.round(cx) - 1;
  const ty = w.y + Math.round(w.h * (w.transom || 0.4));
  for (let yy = 0; yy < w.h; yy++) {
    const hw = Math.round(Decor.archSpan(yy, R, w.w));
    if (hw > 1) { D.r(mx, w.y + yy, 2, 1, c.frame); D.p(mx + 2, w.y + yy, c.frameD); }
  }
  D.r(w.x, ty, w.w, 2, c.frame);
  D.r(w.x, ty + 2, w.w, 1, c.frameD);
  D.r(w.x, w.y + w.h - 1, w.w, 1, c.frameD);
  // a latch
  D.r(mx - 3, ty + Math.round((w.h - (ty - w.y)) * 0.5), 3, 1, "steel");

  // sill
  const sy = w.y + w.h + f;
  D.r(w.x - f - 3, w.y + w.h, w.w + 2 * f + 6, 3, c.sill);
  D.r(w.x - f - 3, w.y + w.h, w.w + 2 * f + 6, 1, Decor.shadeOf(c.sill, 0.3, "paper"));

  // window seat: cushion on top, a box with open cubbies below
  const s = g.seat, top = s.top, sw = s.x1 - s.x0;
  const boxTop = top + 5, boxH = g.floorY - boxTop;
  D.r(s.x0, boxTop, sw, boxH, c.seat);
  D.r(s.x0 + sw - 2, boxTop, 2, boxH, c.seatD);
  D.r(s.x0, boxTop, sw, 1, c.seatD);
  D.dith(s.x0, g.floorY, sw + 2, 2, "umber", "dark", 0.5);
  const n = s.cubbies, gap = 3, cw = Math.floor((sw - gap * (n + 1)) / n), ch = Math.max(8, boxH - 12);
  // three cubbies of books: the only books in the room
  for (let i = 0; i < n; i++) {
    const x = s.x0 + gap + i * (cw + gap), y = boxTop + 5;
    D.r(x, y, cw, ch, "dark");
    D.r(x, y, cw, 1, "soot");
    Decor.books(D, x + 1, x + cw - 1, y + ch, ch - 3, 23 + i * 17);
  }
  // cushion
  D.r(s.x0 - 1, top, sw + 2, 5, c.cushion);
  D.r(s.x0 - 1, top + 4, sw + 2, 1, c.cushionD);
  D.r(s.x0 - 1, top, sw + 2, 1, Decor.shadeOf(c.cushion, 0.3, "hay"));
  for (let x = s.x0 + 8; x < s.x1 - 4; x += 16) D.p(x, top + 2, c.cushionD);   // buttons
  // two pillows leaning at the ends
  const pillow = (x, col) => {
    D.r(x + 1, top - 9, 9, 9, col);
    D.r(x, top - 8, 11, 7, col);
    D.r(x + 1, top - 9, 9, 1, Decor.shadeOf(col, 0.3, "bone"));
    D.r(x, top - 2, 11, 1, Decor.shadeOf(col, -0.3, "dark"));
    D.p(x + 5, top - 5, Decor.shadeOf(col, -0.2, "dark"));
  };
  pillow(s.x0 + 2, c.pillowA);
  pillow(s.x1 - 13, c.pillowB);

  D.hot("window", w.x, w.y, w.w, w.h, () => {
    const l = Sky.label();
    return l ? "Window - " + l : "Window";
  });
};

// the rect weather particles may use (the glass), the mullion and transom in it, and the arch radius
Decor.glass = function (g) {
  const w = g.win;
  return { x: w.x, y: w.y, w: w.w, h: w.h - 1, r: w.r, mullion: Math.round(w.w / 2) - 1, transom: Math.round(w.h * (w.transom || 0.4)) };
};
