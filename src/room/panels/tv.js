/* Panel: the TV. Hand-drawn channels on a 64x48 canvas scaled up with
   nearest-neighbour: little scenes, the clock, the weather. The knob turns to the
   next channel. Each channel repaints only as often as its picture changes, through
   the room's Pace helper, and nothing runs while the panel is closed or the room is
   paused. Calm mode and reduced motion show still frames. */
(function () {
  'use strict';
  const P = window.CasaPanels;
  if (!P) return;
  const { el } = P;
  const W = 64, H = 48;
  P.debug = P.debug || {};
  P.debug.tvPaints = 0;

  /* The set as the room draws it: a cream body with rounded corners and two vermilion
     knobs beside the screen (next channel, previous channel). */
  P.css(`
.cp-tv .cp-body{display:flex;justify-content:center;padding:20px 18px}
.tv-wrap{width:100%;max-width:620px}
.tv-set{display:flex;gap:16px;width:100%;padding:16px;background:#efe6d0;border:4px solid var(--cp-navy);border-radius:18px;
  box-shadow:inset 0 -6px 0 #d8caa8,inset 0 4px 0 #fbf5e6,5px 5px 0 rgba(20,26,44,.35)}
.tv-glass{position:relative;flex:1;min-width:0;padding:7px;background:#1b1f27;border-radius:12px;box-shadow:inset 0 0 0 3px #0d1015}
.tv-glass canvas{display:block;width:100%;height:auto;aspect-ratio:4/3;border-radius:6px;image-rendering:pixelated;image-rendering:crisp-edges;background:#0b0e14}
.tv-glass::before{content:"";position:absolute;inset:7px;border-radius:6px;pointer-events:none;
  background:repeating-linear-gradient(180deg,rgba(0,0,0,.2) 0 1px,transparent 1px 100%);background-size:100% calc(100% / ${H})}
.tv-glass::after{content:"";position:absolute;inset:7px;border-radius:6px;pointer-events:none;
  background:linear-gradient(120deg,transparent 0 18%,rgba(255,255,255,.08) 18% 26%,transparent 26% 31%,rgba(255,255,255,.05) 31% 34%,transparent 34%)}
.tv-side{flex:none;width:78px;display:flex;flex-direction:column;align-items:center;gap:12px}
.tv-tag{width:100%;padding:5px 2px;text-align:center;background:var(--cp-paper);color:var(--cp-navy);border:2px solid var(--cp-navy);
  font:700 13px/1 var(--cp-mono);letter-spacing:.06em}
.tv-knob{position:relative;width:52px;height:52px;padding:0;border:3px solid #8f2a20;border-radius:50%;cursor:pointer;
  background:radial-gradient(circle at 38% 34%,#f07a62 0 22%,#d2473a 23% 70%,#b2382c 71%);box-shadow:0 4px 0 #8f2a20}
.tv-knob::after{content:"";position:absolute;left:50%;top:4px;width:4px;height:16px;margin-left:-2px;background:#fffdf8;
  transform-origin:2px 20px;transform:rotate(var(--rot,0deg));transition:transform .25s steps(4)}
.tv-knob.small{width:40px;height:40px}
.tv-knob.small::after{height:11px;transform-origin:2px 14px}
.tv-knob:active{transform:translateY(2px);box-shadow:0 2px 0 #8f2a20}
.tv-knob:focus-visible{outline:3px solid var(--cp-navy);outline-offset:3px}
.tv-slots{display:grid;gap:4px;width:44px}
.tv-slots i{height:4px;background:#cdbf9c;border-radius:2px}
.tv-name{margin:14px 0 0;text-align:center;font:650 15px/1.3 var(--cp-sans);color:var(--cp-navy)}
.tv-hint{margin:4px 0 0;text-align:center;font-size:12px;color:var(--cp-muted)}
@media (max-width:560px){.tv-set{padding:10px;gap:10px}.tv-side{width:56px}.tv-knob{width:44px;height:44px}.tv-slots{display:none}}
`);

  const C = {
    night: '#0b0e14', ink: '#151c26', deep: '#223241', sea: '#1b2c3a', cyan: '#4f8a96', pale: '#a3c2c6',
    bone: '#f2eee5', gold: '#f2c14e', amber: '#e3923f', red: '#cf4a3c', pine: '#2c5f43', pine2: '#3d8259',
    dusk1: '#3b2f4a', dusk2: '#7a3f48', dusk3: '#d0704a',
  };

  // tiny 3x5 font (lowercase letters, digits, a few marks) and 5x7 digits
  const SMALL = {
    a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111',
    f: '111100110100100', g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010',
    k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101', o: '010101101101010',
    p: '110101110100100', q: '010101101110011', r: '110101110101101', s: '011100010001110', t: '111010010010010',
    u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010',
    z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
    '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001010010', '8': '111101111101111',
    '9': '111101111001111', ':': '000010000010000', '.': '000000000000010', '-': '000000111000000', '°': '010101010000000',
    ' ': '000000000000000',
  };
  const BIG = {
    '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110', '2': '01110100010000100010001000100011111',
    '3': '11110000010000101110000010000111110', '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110',
    '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000', '8': '01110100011000101110100011000101110',
    '9': '01110100011000101111000010001001100', '-': '00000000000000011111000000000000000',
  };

  /* The channels draw on any 64x48 context: the panel uses them at full size and the room
     plays the same channel, shrunk, on the set by the desk (window.CasaTV). */
  function makeScreen(g, env) {
    const fill = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    const band = (y, h, c) => fill(c, 0, y, W, h);
    const disc = (cx, cy, r, c) => {
      g.fillStyle = c;
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.5) g.fillRect(cx + x, cy + y, 1, 1);
    };
    const rnd = (n) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; x ^= x >>> 16; return (x >>> 0) / 4294967296; };
    const sin = Math.sin;
    function glyph(face, ch1, x, y, c, s, cols) {
      const bits = face[ch1] || face[' '];
      if (!bits) return 0;
      g.fillStyle = c;
      for (let i = 0; i < bits.length; i++) if (bits[i] === '1') g.fillRect(x + (i % cols) * s, y + Math.floor(i / cols) * s, s, s);
      return (cols + 1) * s;
    }
    const textW = (str) => str.length * 4 - 1;
    function text(str, x, y, c) {
      str = String(str).toLowerCase().replace(/[^a-z0-9:.\- °]/g, '');
      for (const k of str) x += glyph(SMALL, k, x, y, c, 1, 3);
    }
    const centre = (str, y, c) => { str = String(str).toLowerCase().replace(/[^a-z0-9:.\- °]/g, ''); text(str, Math.round((W - textW(str)) / 2), y, c); };
    function stars(n, maxY, seed, twinkle) {
      for (let i = 0; i < n; i++) {
        const x = Math.floor(rnd(seed + i) * W), y = Math.floor(rnd(seed + i + 99) * maxY);
        const on = !twinkle || ((Math.floor(twinkle / 7) + i) % 9) !== 0;
        if (on) fill(i % 3 ? '#5f7484' : C.pale, x, y, 1, 1);
      }
    }

    // ------------------------------------------------------------ channels
    function clock() {
      const now = new Date();
      band(0, H, C.night);
      const hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0');
      const x0 = 7, y0 = 8;
      glyph(BIG, hh[0], x0, y0, C.gold, 2, 5);
      glyph(BIG, hh[1], x0 + 12, y0, C.gold, 2, 5);
      const blink = env.still() || now.getSeconds() % 2 === 0;
      fill(blink ? C.gold : C.deep, x0 + 24, y0 + 4, 2, 2);
      fill(blink ? C.gold : C.deep, x0 + 24, y0 + 9, 2, 2);
      glyph(BIG, mm[0], x0 + 29, y0, C.gold, 2, 5);
      glyph(BIG, mm[1], x0 + 41, y0, C.gold, 2, 5);
      const DN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], MN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      centre(DN[now.getDay()] + ' ' + now.getDate() + ' ' + MN[now.getMonth()], 28, C.pale);
      // the day as a line, with the sun (or the moon) on it
      const f = (now.getHours() + now.getMinutes() / 60) / 24;
      for (let x = 6; x < W - 6; x += 2) fill(C.deep, x, 41, 1, 1);
      const day = f > 0.27 && f < 0.8;
      disc(6 + Math.round(f * (W - 12)), 40, 2, day ? C.gold : C.pale);
    }

    function weather(t) {
      if (!env.wx() || env.wx().off || typeof env.wx().temp !== 'number') {
        band(0, H, C.night);
        centre('no weather', 16, C.pale);
        centre(env.wx() && env.wx().off ? 'set a city' : 'not yet', 24, '#5f7484');
        centre('in settings', 30, '#5f7484');
        return;
      }
      const c = Number(env.wx().code) || 0, night = env.wx().day === false;
      const kind = c >= 95 ? 'storm' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow' : c >= 51 ? 'rain' : c >= 45 ? 'fog' : c >= 2 ? 'cloud' : 'clear';
      band(0, 30, night ? C.ink : '#35505e'); band(30, H - 30, C.night);
      if (night) stars(10, 26, 7, 0);
      if (kind === 'clear' || kind === 'cloud') {
        disc(18, 12, 6, night ? C.pale : C.gold);
        if (night) disc(21, 9, 5, C.ink);
      }
      const cloud = (x, y, w, col) => { fill(col, x + 2, y + 4, w - 4, 4); fill(col, x, y + 6, w, 3); fill(col, x + Math.round(w * 0.18), y + 2, Math.round(w * 0.3), 5); fill(col, x + Math.round(w * 0.45), y, Math.round(w * 0.32), 7); };
      if (kind === 'cloud') cloud(28 + Math.round(sin(t * 0.02) * 2), 8, 26, '#c9d6dc');
      if (kind === 'fog') for (let i = 0; i < 6; i++) fill(C.pale, 6 + Math.round(sin(t * 0.03 + i) * 4) + (i % 2) * 6, 5 + i * 4, 40 - (i % 3) * 8, 1);
      if (kind === 'rain' || kind === 'snow' || kind === 'storm') {
        cloud(14, 2, 36, kind === 'storm' ? '#1c2630' : '#b9c7cf');
        for (let i = 0; i < 18; i++) {
          const x = 16 + Math.floor(rnd(i) * 32);
          const y = 13 + ((Math.floor(rnd(i + 40) * 16) + t * (kind === 'snow' ? 0.35 : 1.2)) % 16);
          if (kind === 'snow') fill(C.bone, x + Math.round(sin(t * 0.05 + i) * 1.5), Math.floor(y), 1, 1);
          else fill('#6fb0d8', x, Math.floor(y), 1, 2);
        }
        if (kind === 'storm' && (env.still() || Math.floor(t) % 40 < 3)) { fill(C.gold, 33, 12, 2, 3); fill(C.gold, 31, 15, 2, 2); fill(C.gold, 29, 17, 6, 2); fill(C.gold, 31, 19, 2, 3); }
      }
      const temp = String(Math.round(env.wx().temp));
      let x = Math.round((W - (temp.length * 6 + 4)) / 2);
      for (const k of temp) x += glyph(BIG, k, x, 33, night ? C.pale : C.gold, 1, 5);
      fill(night ? C.pale : C.gold, x, 33, 2, 2);
      if (env.wx().where && env.wx().where.name) centre(env.wx().where.name.slice(0, 15), 42, '#5f7484');
    }

    function lighthouse(t) {
      band(0, 30, C.ink); band(30, H - 30, C.night);
      stars(14, 26, 3, t);
      for (let x = 0; x < 24; x++) fill('#0d1218', x, 27 - Math.round(x * 0.35) + (x > 18 ? x - 18 : 0), 1, 22);
      const bx = 9, top = 9;
      for (let y = top; y < 26; y++) {
        const w = 4 + Math.floor((y - top) / 8);
        fill(Math.floor((y - top) / 3) % 2 ? C.red : C.bone, bx - (w >> 1), y, w, 1);
      }
      fill('#0d1218', bx - 3, top - 1, 7, 1);
      const a = t * 0.035;
      const facing = Math.cos(a);
      fill(facing > 0 ? C.gold : C.amber, bx - 1, top - 4, 3, 3);
      fill('#0d1218', bx - 2, top - 5, 5, 1);
      if (facing > 0.05) {
        const len = Math.round(52 * facing);
        for (let i = 3; i < len; i++) {
          const y = top - 3 + Math.round(i * 0.12 * sin(a));
          const spread = 1 + Math.floor(i / 14);
          for (let k = 0; k < spread; k++) {
            if ((i + k) % (i > len * 0.6 ? 3 : 2)) continue;
            fill('rgba(242,193,78,' + (0.75 - i / len * 0.55).toFixed(2) + ')', bx + i, y + k, 1, 1);
          }
        }
      }
      for (let y = 31; y < H; y += 2) {
        const near = (y - 30) / (H - 30);
        const w = 2 + Math.round(near * 4), gap = 6 + Math.round(near * 5);
        for (let x = -8 + ((y * 5) % 7); x < W; x += gap) fill(near > 0.5 ? '#2d4a5c' : C.deep, x + Math.round(sin(t * 0.06 + y + x * 0.1) * 2), y, w, 1);
      }
    }

    const PINES = [[7, 19], [19, 24], [31, 17], [43, 22], [56, 19]];
    function pines(t) {
      for (let y = 0; y < 36; y++) band(y, 1, y % 2 ? '#43526a' : '#3b4960');
      for (const [x, h] of PINES) {
        const base = 34;
        for (let i = 0; i < h; i++) {
          const tier = i % 6;
          const w = Math.max(1, Math.round(((h - i) / h) * 8 + (5 - tier) * 0.6));
          fill(tier < 2 ? C.pine2 : C.pine, x - (w >> 1), base - i, w, 1);
          if (tier === 5 && i < h - 2) fill(C.bone, x - (w >> 1), base - i, Math.max(1, w - 1), 1);
        }
        fill('#3a2618', x, base + 1, 1, 2);
      }
      band(36, H - 36, '#dfe5ec');
      for (let y = 38; y < H; y += 3) for (let x = (y * 3) % 5; x < W; x += 9) fill('#c6ced8', x, y, 4, 1);
      for (let i = 0; i < 30; i++) {
        const x = Math.floor(rnd(i + 11) * W) + Math.round(sin(t * 0.04 + i) * 2);
        const y = Math.floor((rnd(i + 70) * H + t * (0.25 + rnd(i) * 0.3)) % H);
        fill(i % 4 ? C.bone : '#c6ced8', x, y, 1, 1);
      }
    }

    function moonfield(t) {
      band(0, 24, C.ink); band(24, H - 24, C.night);
      stars(12, 18, 21, t);
      disc(48, 9, 5, '#cfdadc');
      fill('#aebfc2', 46, 8, 2, 1); fill('#aebfc2', 50, 11, 1, 1); fill('#aebfc2', 47, 12, 2, 1);
      for (let x = 0; x < W; x += 6) { fill('#2a3a48', x, 20, 1, 4); }
      band(21, 1, '#2a3a48');
      for (let i = 0; i < 110; i++) {
        const x = Math.floor(rnd(i + 300) * W);
        const base = 26 + Math.floor(rnd(i + 500) * 22);
        const len = 3 + Math.floor(rnd(i + 700) * 5);
        const lean = sin(t * 0.08 + x * 0.25 + base * 0.15) * 2;
        const near = (base - 26) / 22;
        g.fillStyle = near > 0.6 ? '#5f9aa6' : near > 0.3 ? C.cyan : '#2c4d5a';
        for (let s = 0; s < len; s++) g.fillRect(x + Math.round(lean * s / len), base - s, 1, 1);
      }
    }

    const BLOCKS = [[0, 5, 14], [5, 6, 24], [11, 5, 16], [16, 7, 30], [23, 5, 20], [28, 6, 27], [34, 5, 15], [39, 7, 33], [46, 5, 21], [51, 6, 26], [57, 7, 18]];
    function city(t) {
      band(0, 38, C.night); band(38, H - 38, '#0a1016');
      stars(9, 12, 51, t);
      const slow = Math.floor(t / 60);
      BLOCKS.forEach(([x, w, h], b) => {
        fill(b % 2 ? '#111924' : '#151f2b', x, 38 - h, w, h);
        for (let y = 38 - h + 2; y < 36; y += 3) for (let wx2 = x + 1; wx2 < x + w - 1; wx2 += 2) {
          const on = rnd(wx2 * 31 + y * 7 + slow * 3 + b) < 0.42;
          fill(on ? C.gold : '#0c131b', wx2, y, 1, 1);
        }
      });
      for (let y = 39; y < H; y += 2) {
        for (let x = (y * 5) % 6; x < W; x += 6) fill('#1a2733', x + Math.round(sin(t * 0.05 + y) * 1.5), y, 3, 1);
        for (let i = 0; i < 6; i++) {
          const rx = 3 + i * 11 + Math.round(sin(t * 0.07 + y + i) * 1.5);
          if (rnd(i * 13 + y) < 0.55) fill('rgba(242,193,78,.55)', rx, y, 2, 1);
        }
      }
    }

    function sea(t) {
      band(0, 8, C.dusk1); band(8, 8, C.dusk2); band(16, 8, C.dusk3); band(24, H - 24, C.sea);
      g.save(); g.beginPath(); g.rect(0, 0, W, 24); g.clip(); disc(20, 24, 6, '#f6c25b'); g.restore();
      for (let y = 25; y < H; y += 2) {
        const near = (y - 24) / (H - 24);
        const w = 2 + Math.round(near * 5), gap = 5 + Math.round(near * 7);
        for (let x = -6 + ((y * 3) % 5); x < W; x += gap) fill(near > 0.5 ? '#2f4f63' : '#27404f', x + Math.round(sin(t * 0.05 + x * 0.2 + y) * (1 + near * 2)), y, w, 1);
        fill(y < 34 ? '#f6c25b' : C.amber, 18 + Math.round(sin(t * 0.09 + y) * 2), y, 4 - Math.floor(near * 2), 1);
      }
      const bx = Math.round(W + 10 - ((t * 0.12) % (W + 24)));
      const bob = Math.round(sin(t * 0.08));
      fill('#141016', bx, 22 + bob, 9, 2); fill('#141016', bx + 4, 13 + bob, 1, 9);
      for (let i = 0; i < 6; i++) fill('#e9dccb', bx + 5, 14 + i + bob, Math.max(1, 4 - Math.floor(i / 2)), 1);
    }

    function rain(t) {
      band(0, H, '#10151c');
      const lights = [[16, 14, 9, '242,193,78'], [44, 20, 7, '227,146,63'], [30, 34, 6, '163,194,198']];
      for (const [x, y, r, rgb] of lights) for (let k = r; k > 0; k -= 2) { g.fillStyle = 'rgba(' + rgb + ',' + (0.05 + (r - k) * 0.012).toFixed(3) + ')'; disc(x, y, k, g.fillStyle); }
      for (let i = 0; i < 40; i++) {
        const x = Math.floor(rnd(i + 900) * W);
        const y = Math.floor((rnd(i + 950) * (H + 10) + t * (0.6 + rnd(i) * 0.9)) % (H + 10)) - 5;
        fill(i % 5 ? '#4b6170' : C.pale, x, y, 1, 2 + (i % 3));
      }
      fill('#06080b', 0, 0, W, 2); fill('#06080b', 0, H - 2, W, 2); fill('#06080b', 0, 0, 2, H); fill('#06080b', W - 2, 0, 2, H);
      fill('#06080b', 31, 0, 2, H); fill('#06080b', 0, 23, W, 2);
    }

    function fire(t) {
      band(0, H, '#08060a');
      for (let y = 0; y < H; y += 3) for (let x = (y / 3) % 2 ? 0 : 4; x < W; x += 8) {
        if (x > 10 && x < 52 && y > 7) continue;
        fill('#3a2420', x, y, 7, 2);
      }
      fill('#1a1112', 10, 8, 42, H - 13);
      fill('#4a2d24', 6, H - 6, 52, 4);
      fill('#2b1b14', 18, 35, 28, 4); fill('#3d281d', 22, 32, 20, 3); fill('#5a3a28', 20, 35, 4, 1); fill('#5a3a28', 38, 35, 5, 1);
      const T = [[25, 16, 0.19], [31, 21, 0.15], [37, 14, 0.23], [28, 10, 0.31], [35, 11, 0.27]];
      for (const [bx, hgt, sp] of T) for (let i = 0; i < hgt; i++) {
        const k = i / hgt;
        const w = Math.max(1, Math.round((1 - k) * 5));
        const sway = Math.round(sin(t * sp + i * 0.45) * (1 + k * 2.5));
        fill(k > 0.7 ? '#ffe39b' : k > 0.35 ? C.gold : C.red, bx + sway - (w >> 1), 32 - i, w, 1);
      }
      for (let i = 0; i < 8; i++) {
        const y = 31 - ((i * 7 + t * 0.6) % 24);
        fill(y < 14 ? C.red : C.gold, 22 + Math.floor(rnd(i) * 20) + Math.round(sin(t * 0.1 + i) * 2), Math.floor(y), 1, 1);
      }
    }

    const CHANNELS = [
      { name: 'Clock', draw: clock, ms: 1000, still: 30000 },
      { name: 'Weather', draw: weather, ms: 200, still: 600000 },
      { name: 'Lighthouse', draw: lighthouse, ms: 150 },
      { name: 'Snowy pines', draw: pines, ms: 180 },
      { name: 'Moon over the field', draw: moonfield, ms: 200 },
      { name: 'City at night', draw: city, ms: 250 },
      { name: 'Sea at dusk', draw: sea, ms: 180 },
      { name: 'Rain on the glass', draw: rain, ms: 140 },
      { name: 'Fireplace', draw: fire, ms: 130 },
    ];
    return { CHANNELS, fill };
  }
  window.CasaTV = { W, H, makeScreen, DEFAULT: 0 };

  P.register('tv', {
    title: 'TV',
    size: 'm',
    async render(ctx) {
      const canvas = el('canvas', { width: W, height: H, role: 'img', 'aria-label': 'TV picture' });
      const g = canvas.getContext('2d');
      let t0 = performance.now();
      let ch = 0, noise = 0, wx = null, calm = false;
      const still = () => calm || ctx.reduced();

      const { CHANNELS, fill } = makeScreen(g, { wx: () => wx, still });

      function paint() {
        if (noise > 0) {
          noise--;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 2) { const v = Math.floor(Math.random() * 120) + 20; fill('rgb(' + v + ',' + v + ',' + (v + 8) + ')', x, y, 2, 1); }
          return;
        }
        const t = still() ? 240 : (performance.now() - t0) / 100;
        CHANNELS[ch].draw(t);
        P.debug.tvPaints++;   // read by test/panels-shots.cjs to prove the loop stops
      }

      // ------------------------------------------------------------ the set
      const lcd = el('div', { class: 'tv-tag', 'aria-hidden': 'true' });
      const knob = el('button', { class: 'tv-knob', type: 'button', dataset: { autofocus: '' } });
      const back = el('button', { class: 'tv-knob small', type: 'button', 'aria-label': 'Previous channel', title: 'Previous channel' });
      const name = el('p', { class: 'tv-name', 'aria-live': 'polite' });
      const set = el('div', { class: 'tv-set' },
        el('div', { class: 'tv-glass' }, canvas),
        el('div', { class: 'tv-side' }, lcd, knob, back, el('div', { class: 'tv-slots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i'))));
      let loop = null;

      function frameMs() { const c = CHANNELS[ch]; return still() ? (c.still || 0) : c.ms; }
      function arm() {
        if (loop) { loop.stop(); loop = null; }
        const ms = frameMs();
        if (ms) loop = ctx.loop('frame', ms, paint);
      }
      function tune(next, quiet) {
        ch = (next + CHANNELS.length) % CHANNELS.length;
        lcd.textContent = 'CH ' + (ch + 1);
        name.textContent = CHANNELS[ch].name;
        knob.style.setProperty('--rot', (ch * 40) + 'deg');
        back.style.setProperty('--rot', (-ch * 40) + 'deg');
        knob.setAttribute('aria-label', 'Next channel. Now: ' + (ch + 1) + ', ' + CHANNELS[ch].name);
        canvas.setAttribute('aria-label', 'TV channel ' + (ch + 1) + ': ' + CHANNELS[ch].name);
        if (!quiet) {
          if (typeof Kept !== 'undefined' && Kept && typeof Kept.set === 'function') Kept.set('tvChannel', ch);
          else ctx.api('state', { method: 'POST', body: { tvChannel: ch } });
          ctx.emit('tv', { channel: ch });
          if (!still()) { noise = 2; paint(); setTimeout(() => { if (ctx.alive() && !ctx.paused()) paint(); }, 90); }
        }
        if (quiet || still()) paint();
        arm();
      }
      knob.addEventListener('click', () => tune(ch + 1));
      back.addEventListener('click', () => tune(ch - 1));
      knob.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); tune(ch + 1); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); tune(ch - 1); }
      });
      canvas.addEventListener('click', () => tune(ch + 1));

      const [st, s, w] = await Promise.all([ctx.api('state'), ctx.api('settings'), ctx.api('weather')]);
      if (!ctx.alive()) return;
      calm = !!(s.ok && s.json.calm);
      wx = w.ok ? w.json : null;
      let saved = st.ok ? Number(st.json.tvChannel) : NaN;
      if (typeof Kept !== 'undefined' && Kept && typeof Kept.get === 'function') { const k = Number(Kept.get('tvChannel', NaN)); if (Number.isInteger(k)) saved = k; }
      ctx.clear(ctx.body);
      ctx.body.appendChild(el('div', { class: 'tv-wrap' }, set, name,
        el('p', { class: 'tv-hint', text: 'The big knob (or a click on the screen) turns to the next channel, the small one goes back.' })));
      t0 = performance.now();
      tune(Number.isInteger(saved) && saved >= 0 ? saved : 0, true);
      ctx.onResume(() => paint());
      ctx.onData(['weather'], async () => { const r = await ctx.api('weather'); if (ctx.alive() && r.ok) wx = r.json; });
      ctx.onData(['settings'], async () => { const r = await ctx.api('settings'); if (ctx.alive() && r.ok) { calm = !!r.json.calm; arm(); paint(); } });
    },
  });
})();
