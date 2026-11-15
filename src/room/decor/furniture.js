/* Decor: furniture and the small things in the room. Trestle desk, two
   floating shelves, the floor lamp arching over the desk, a hanging plant and
   a floor plant, the mug, the wall clock, the dog's bed.
   Theme variants (CasaTheme.tweak): desk, shelf, lamp, plants, mug, clock, petbed. */

// a row of book spines standing on a line at y (bottom), from x0 to x1
Decor.books = function (D, x0, x1, y, maxH, seed) {
  const rnd = PIX.rand(seed);
  const hues = [["verm", "rust"], ["teal", "pine"], ["gold", "amber"], ["steel", "blue"], ["moss", "pine"], ["berry", "rust"], ["lilac", "steel"], ["cream", "tan"]];
  let x = x0;
  while (x < x1 - 2) {
    const bw = 2 + Math.floor(rnd() * 3);
    if (x + bw > x1) break;
    const bh = Math.max(4, Math.round(maxH * (0.62 + rnd() * 0.38)));
    const [a, b] = hues[Math.floor(rnd() * hues.length)];
    D.r(x, y - bh, bw, bh, a);
    D.r(x + bw - 1, y - bh, 1, bh, b);
    if (bh > 7) D.r(x, y - bh + 2, bw - 1, 1, b);
    x += bw;
  }
};

// a plant's leaf tone: CasaTheme.trees first (plants tweak leaves: "trees"), then the palette
Decor.leaf = function (D, tw, name) {
  return tw && tw.leaves === "trees" ? D.treeTone(name) : name;
};

Decor.furniture = function (D) {
  const { g, W } = D;
  const S = D.state;

  // --- two floating shelves
  PIX.withTweak("shelf", (tw) => {
    const c = D.roles(tw, { board: "birch", boardD: "beech" });
    const sh = g.shelves, sw = sh.x1 - sh.x0;
    if (sw < 16) return;
    sh.y.forEach((y, i) => {
      D.dith(sh.x0 + 1, y + 3, sw, 2, "plasd", "plast", 0.5);
      D.r(sh.x0, y, sw, 3, c.board);
      D.r(sh.x0, y + 2, sw, 1, c.boardD);
      if (i === 0) {
        // a vase with two stems, a small round box, and a trailing plant in a white pot
        const vx = sh.x0 + 4;
        D.r(vx, y - 7, 5, 7, "teal"); D.r(vx + 4, y - 7, 1, 7, "pine"); D.r(vx + 1, y - 8, 3, 1, "pine");
        for (let k = 0; k < 7; k++) { D.p(vx + 1 - (k >> 2), y - 9 - k, "umber"); D.p(vx + 3 + (k >> 2), y - 9 - k, "umber"); }
        D.r(vx - 2, y - 17, 3, 2, "rose"); D.r(vx + 4, y - 16, 3, 2, "hay");
        // a little lighthouse figurine: the door to the Lighthouse pack (coming soon)
        const bx = sh.x0 + Math.round(sw * 0.42);
        if (!S.hidden.has("lighthouse")) {
        D.r(bx + 1, y - 2, 6, 2, "steel");
        D.r(bx + 2, y - 10, 4, 8, "bone");
        D.r(bx + 2, y - 8, 4, 2, "verm"); D.r(bx + 2, y - 4, 4, 2, "verm");
        D.r(bx + 2, y - 13, 4, 3, "ink"); D.r(bx + 3, y - 12, 2, 1, "gold");
        D.r(bx + 1, y - 14, 6, 1, "verm");
        if (S.night > 0.3) { D.emit(bx + 3, y - 12, 2, 1); D.lamp(bx + 4, y - 12, 12, 0.35); }
        D.hot("lighthouse", bx - 1, y - 15, 10, 15, "Lighthouse \u00b7 coming soon");
        }
        const px = sh.x0 + Math.round(sw * 0.78);
        D.r(px - 3, y - 5, 7, 5, "bone");
        D.r(px + 3, y - 5, 1, 5, "pale");
        PIX.withTweak("plants", (pt) => {
          [[-4, -8], [-1, -10], [2, -8]].forEach(([dx, dy], k) => D.r(px + dx, y + dy, 3, 3, Decor.leaf(D, pt, k % 2 ? "moss" : "leaf")));
          for (let k = 0; k < 7; k++) D.p(px + 3 + (k % 2), y + 1 + k, Decor.leaf(D, pt, k % 3 ? "moss" : "leaf"));
        });
      } else {
        // a framed photo of two friends (the door to the Orbit pack, coming soon), a jar candle, a cup of pencils
        const fx = sh.x0 + 3;
        if (!S.hidden.has("orbit")) {
        D.r(fx, y - 12, 11, 12, "dark");
        D.r(fx + 1, y - 11, 9, 10, "cream");
        D.r(fx + 2, y - 4, 7, 2, "teal");
        D.r(fx + 3, y - 9, 2, 2, "tan"); D.r(fx + 3, y - 7, 2, 3, "verm");
        D.r(fx + 6, y - 9, 2, 2, "tan"); D.r(fx + 6, y - 7, 2, 3, "blue"); D.r(fx + 6, y - 10, 2, 1, "umber");
        D.hot("orbit", fx - 1, y - 13, 13, 13, "Orbit \u00b7 coming soon");
        }
        const jx = sh.x0 + Math.round(sw * 0.5);
        D.r(jx, y - 6, 5, 6, "amber"); D.r(jx, y - 6, 5, 1, "hay"); D.p(jx + 2, y - 8, "flame");
        if (S.night > 0.3) { D.emit(jx + 2, y - 8, 1, 1); D.lamp(jx + 2, y - 7, 14, 0.4); }
        // a little ceramic cup with pencils
        const bx = sh.x1 - 9;
        D.r(bx, y - 6, 6, 6, "cream"); D.r(bx + 5, y - 6, 1, 6, "pale"); D.r(bx, y - 4, 6, 1, "rug");
        D.r(bx + 1, y - 10, 1, 4, "verm"); D.r(bx + 3, y - 9, 1, 3, "gold");
      }
    });
  });

  // --- a yellow ticket pinned under the calendar: "add your own object" (opens the widget prompt)
  if (!S.hidden.has("widget")) {
    const c = g.calendar, tx = c.x + 1, ty = c.y + c.h + 14;
    D.r(tx + 1, ty + 1, 22, 15, "plasd");
    D.r(tx, ty, 22, 15, "gold"); D.r(tx, ty, 22, 1, "hay"); D.r(tx + 21, ty, 1, 15, "amber"); D.r(tx, ty + 14, 22, 1, "amber");
    D.r(tx + 10, ty - 2, 3, 3, "verm"); D.p(tx + 11, ty - 1, "rose");
    D.r(tx + 3, ty + 6, 5, 1, "ink"); D.r(tx + 5, ty + 4, 1, 5, "ink");
    D.r(tx + 10, ty + 5, 9, 1, "ink"); D.r(tx + 10, ty + 8, 7, 1, "umber"); D.r(tx + 3, ty + 11, 14, 1, "umber");
    D.hot("widget", tx - 2, ty - 3, 26, 20, "Add your own object");
  }

  // --- doors to the other rooms of the house (Living pack, coming soon):
  // an arrow through the right wall to the kitchen, and one down past the rug to the garden
  if (!S.hidden.has("kitchen")) {
    const ax = W - 16, ay = g.floorY - 32;
    D.r(ax + 1, ay + 4, 7, 3, "plasd");
    D.r(ax, ay + 3, 7, 3, "gold"); D.r(ax, ay + 3, 7, 1, "hay");
    for (let i = 0; i < 5; i++) D.r(ax + 7 + i, ay + i, 1, 9 - i * 2, i === 0 ? "amber" : "gold");
    D.hot("kitchen", ax - 4, ay - 4, 20, 17, "Kitchen \u00b7 coming soon");
  }
  if (!S.hidden.has("garden")) {
    const gx = Math.round(W * 0.405), gy = D.H - 15;
    D.r(gx + 3, gy, 3, 6, "gold"); D.r(gx + 3, gy, 1, 6, "hay");
    for (let i = 0; i < 5; i++) D.r(gx + i, gy + 6 + i, 9 - i * 2, 1, i === 0 ? "amber" : "gold");
    D.hot("garden", gx - 4, gy - 4, 17, 19, "Garden \u00b7 coming soon");
  }

  // --- the put-away box: on the floor, front left, only while something has been put away
  const away = window.CasaRoomItems ? window.CasaRoomItems.count() : S.hidden.size;
  if (away) {
    const bx = Math.round(W * 0.03), by = g.floorY + 16;
    D.r(bx + 1, by + 12, 21, 2, "plasd");
    D.r(bx, by, 20, 12, "tan"); D.r(bx, by, 20, 2, "hay"); D.r(bx + 19, by, 1, 12, "umber"); D.r(bx, by + 11, 20, 1, "umber");
    D.r(bx - 2, by - 2, 9, 2, "hay"); D.r(bx + 13, by - 2, 9, 2, "hay");
    D.r(bx + 6, by + 5, 8, 3, "cream"); D.r(bx + 7, by + 6, 6, 1, "steel");
    D.hot("box", bx - 3, by - 4, 26, 19, () => "Put-away box \u00b7 " + (window.CasaRoomItems ? window.CasaRoomItems.count() : S.hidden.size));
  }

  // --- trestle desk
  PIX.withTweak("desk", (tw) => {
    const c = D.roles(tw, { top: "birch", topD: "beech", leg: "beech", legD: "tan" });
    const d = g.desk, dw = d.x1 - d.x0;
    D.r(d.x0, d.y, dw, d.slab, c.top);
    D.r(d.x0, d.y, dw, 1, Decor.shadeOf(c.top, 0.3, "paper"));
    D.r(d.x0, d.y + d.slab - 1, dw, 1, c.topD);
    const legTop = d.y + d.slab, legH = g.floorY + 1 - legTop;
    [d.x0 + 12, d.x1 - 12].forEach((lx) => {
      // an A-frame: two legs splaying out to the floor
      for (let yy = 0; yy < legH; yy++) {
        const spread = Math.round((yy / legH) * 6);
        D.r(lx - 2 - spread, legTop + yy, 2, 1, c.leg);
        D.r(lx + 1 + spread, legTop + yy, 2, 1, c.legD);
      }
      D.r(lx - 4, legTop, 8, 2, c.legD);
    });
    // stretcher between the legs, 18 px above the floor
    const sy = Math.max(legTop + 4, g.floorY - 18);
    D.r(d.x0 + 14, sy, dw - 28, 2, c.leg);
    D.r(d.x0 + 14, sy + 1, dw - 28, 1, c.legD);
    D.dith(d.x0 + 4, g.floorY, dw - 8, 2, "umber", "dark", 0.3);
  });

  // --- floor lamp: a weighted base, a pole, an arc over the desk, a dome shade
  let shadeX = g.lamp.shadeX, shadeY = g.lamp.shadeY;
  PIX.withTweak("lamp", (tw) => {
    const c = D.roles(tw, { shade: "teal", shadeD: "pine", shadeIn: "hay", arm: "coal", base: "coal" });
    const L = g.lamp;
    D.r(L.x - 6, g.floorY + 2, 13, 3, c.base);
    D.r(L.x - 5, g.floorY + 1, 11, 1, c.base);
    D.r(L.x - 4, g.floorY + 2, 4, 1, "slate");
    D.r(L.x, L.top, 2, g.floorY + 2 - L.top, c.arm);
    // the arc: a quadratic curve from the pole top to the shade
    const P0 = [L.x + 1, L.top], P2 = [shadeX, shadeY - 7], C = [L.x - (L.x - shadeX) * 0.25, L.top - 18];
    let px = null, py = null;
    for (let i = 0; i <= 240; i++) {
      const t = i / 240, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, e = t * t;
      const qx = Math.round(a * P0[0] + b * C[0] + e * P2[0]), qy = Math.round(a * P0[1] + b * C[1] + e * P2[1]);
      if (qx === px && qy === py) continue;
      px = qx; py = qy;
      D.r(qx, qy, 2, 2, c.arm);
    }
    // dome shade
    const sx = shadeX, sy = shadeY;
    D.r(sx - 2, sy - 8, 4, 1, c.shadeD);
    D.r(sx - 4, sy - 7, 8, 2, c.shade);
    D.r(sx - 6, sy - 5, 12, 2, c.shade);
    D.r(sx - 7, sy - 3, 14, 3, c.shade);
    D.r(sx - 7, sy - 1, 14, 1, c.shadeD);
    D.r(sx - 4, sy - 7, 1, 4, Decor.shadeOf(c.shade, 0.35, "leaf"));
    if (S.lampOn) {
      D.r(sx - 6, sy, 12, 1, c.shadeIn);
      D.r(sx - 3, sy + 1, 6, 1, "paper");
      D.emit(sx - 6, sy, 12, 2);
      D.cone(sx, sy + 1, g.desk.y - sy + 14, 0.75, 1);
      D.lamp(sx, sy + 3, Math.round(W * 0.12), 0.8);
    }
    D.hot("lamp", sx - 8, sy - 9, 16, 12, () => "Lamp: " + ({ auto: "auto", on: "on", off: "off" }[S.lampMode] || "auto"));
  });

  // --- plants: one hanging from the beam in a macrame sling, one on the floor
  PIX.withTweak("plants", (tw) => {
    const c = D.roles(tw, { pot: "bone", potD: "pale", rope: "cream", soil: "dark" });
    const lf = (n) => Decor.leaf(D, tw, n);
    const h = g.plantHang, py = h.y + h.drop;
    D.r(h.cx - 1, h.y, 3, 2, "dark");                                   // hook
    for (let yy = h.y + 2; yy < py - 6; yy++) {
      const t = (yy - h.y) / Math.max(1, py - 6 - h.y);
      D.p(Math.round(h.cx - t * 4), yy, c.rope); D.p(Math.round(h.cx + t * 4), yy, c.rope); D.p(h.cx, yy, c.rope);
    }
    D.r(h.cx - 5, py - 6, 11, 7, c.pot);
    D.r(h.cx + 4, py - 6, 1, 7, c.potD);
    D.r(h.cx - 5, py - 6, 11, 1, c.soil);
    D.r(h.cx - 5, py - 3, 11, 1, c.rope);                               // the sling round the pot
    for (let k = 0; k < 5; k++) {
      const vx = h.cx - 6 + k * 3, len = 6 + ((k * 7) % 9);
      for (let i = 0; i < len; i++) D.p(vx + (i % 4 === 3 ? 1 : 0), py - 5 + i, lf(i % 3 ? "moss" : "leaf"));
      D.r(vx - 1, py - 5 + len, 3, 2, lf("leaf"));
    }
    for (let k = 0; k < 4; k++) D.r(h.cx - 5 + k * 3, py - 9 - (k % 2) * 2, 3, 3, lf(k % 2 ? "moss" : "leaf"));

    const f = g.plantFloor, base = f.base;
    D.r(f.cx - 6, base - 12, 12, 12, c.pot);
    D.r(f.cx + 4, base - 12, 2, 12, c.potD);
    D.r(f.cx - 7, base - 13, 14, 2, c.potD);
    D.r(f.cx - 5, base - 13, 10, 1, c.soil);
    D.dith(f.cx - 6, base, 13, 1, "umber", "dark", 0.5);
    const top = base - 13 - f.h;
    D.r(f.cx, top + 4, 1, f.h - 4, lf("pine"));
    for (let i = 0, y = base - 18; y > top; i++, y -= 7) {
      const side = i % 2 ? 1 : -1, lx = f.cx + side * 5;
      for (let yy = -3; yy <= 3; yy++) for (let xx = -4; xx <= 4; xx++)
        if (xx * xx / 16 + yy * yy / 9 <= 1) D.p(lx + xx, y + yy, yy < 0 ? lf("leaf") : lf("moss"));
      D.r(Math.min(f.cx, lx), y, Math.abs(lx - f.cx), 1, lf("pine"));
    }
    D.r(f.cx - 3, top, 7, 5, lf("leaf"));
    D.r(f.cx - 2, top - 1, 5, 1, lf("leaf"));
  });

  // --- mug on the desk
  if (!S.hidden.has("today")) PIX.withTweak("mug", (tw) => {
    const c = D.roles(tw, { body: "bone", bodyD: "pale", band: "verm", coffee: "umber" });
    const mx = g.on.mug, my = g.desk.y, mh = tw.shape === "tall" ? 9 : 7;
    D.r(mx - 3, my - mh, 6, mh, c.body);
    D.r(mx + 2, my - mh, 1, mh, c.bodyD);
    D.r(mx - 3, my - mh, 6, 1, c.coffee);
    D.r(mx + 3, my - mh + 2, 2, 1, c.body); D.r(mx + 4, my - mh + 3, 1, 2, c.body); D.r(mx + 3, my - mh + 5, 2, 1, c.body);
    D.r(mx - 3, my - Math.round(mh * 0.55), 6, tw.pattern === "band" ? 2 : 1, c.band);
    D.hot("today", mx - 5, my - mh - 4, 12, mh + 4, "Today's note");
  });

  // --- wall clock (the hands are drawn live, Decor.clockHands)
  PIX.withTweak("clock", (tw) => {
    const c = D.roles(tw, { face: "paper", rim: "wood" });
    const k = g.clock;
    D.x.fillStyle = D.tone("plasd");
    PIX.disc(D.x, k.cx + 2, k.cy + 2, k.r);
    D.x.fillStyle = D.tone(c.rim);
    PIX.disc(D.x, k.cx, k.cy, k.r);
    D.x.fillStyle = D.tone(c.face);
    PIX.disc(D.x, k.cx, k.cy, k.r - 1);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, rr = k.r - 2;
      D.p(Math.round(k.cx + Math.sin(a) * rr), Math.round(k.cy - Math.cos(a) * rr), i % 3 ? "mist" : "ink");
    }
    D.hot("clock", k.cx - k.r, k.cy - k.r, k.r * 2 + 1, k.r * 2 + 1, () => S.now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
  });

  // --- the dog's bed
  PIX.withTweak("petbed", (tw) => {
    const c = D.roles(tw, { rim: "verm", rimD: "rust", inside: "cream" });
    const b = g.petbed;
    for (let yy = -b.ry - 1; yy <= b.ry + 2; yy++) for (let xx = -b.rx - 1; xx <= b.rx + 1; xx++) {
      const u = xx / b.rx, v = yy / b.ry;
      const d = u * u + v * v;
      if (yy > b.ry && d <= 1.4 && PIX.thr(b.cx + xx, b.cy + yy) < 0.5) { D.p(b.cx + xx, b.cy + yy, "dark"); continue; }
      if (d > 1) continue;
      const inner = (xx / (b.rx - 4)) ** 2 + ((yy + 1) / (b.ry - 2)) ** 2;
      D.p(b.cx + xx, b.cy + yy, inner <= 1 ? c.inside : yy > 0 ? c.rimD : c.rim);
    }
  });
};

// clock hands, drawn on the visible canvas once a minute
Decor.clockHands = function (ctx, g, time, k) {
  const ck = g.clock, cx = ck.cx, cy = ck.cy;
  const m = time.getMinutes(), h = (time.getHours() % 12) + m / 60;
  const tw = PIX.tweak("clock");
  const hands = tw.colors && Array.isArray(tw.colors.hands) ? tw.colors.hands : PIX.T("ink");
  const col = PIX.rgb(PIX.grade(k ? PIX.dusk(hands, k) : hands));
  ctx.fillStyle = col;
  const hand = (ang, len) => {
    for (let i = 1; i <= len; i++) ctx.fillRect(Math.round(cx + Math.sin(ang) * i), Math.round(cy - Math.cos(ang) * i), 1, 1);
  };
  hand((h / 12) * Math.PI * 2, Math.round(ck.r * 0.45));
  hand((m / 60) * Math.PI * 2, ck.r - 3);
  ctx.fillStyle = PIX.css("verm", k);
  ctx.fillRect(cx, cy, 1, 1);
};
