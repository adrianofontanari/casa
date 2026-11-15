/* Sky: the clock, the season, the weather and the view through the window.

   Model
     Sky.now()      Date the room shows (dev: ?hour=14.5, ?date=2026-12-25)
     Sky.hour()     fractional local hour
     Sky.where()    {lat, lon, name} from /api/weather (latlon or where), else the
                    /api/settings city, else null: the sky then follows the clock only
     Sky.palette()  sky colours for the hour, remapped to the real sunrise/sunset
     Sky.night()    0 at midday .. 0.62 at midnight: how far the room is pulled to night
     Sky.season()   {phase, prog, cold, leaf} (hemisphere aware)
     Sky.kind()     "" | "overcast" | "rain" | "snow" | "fog"  (dev: ?wx=rain)
     Sky.label()    "18°, partly cloudy" for the window's hover label
   Painter
     Sky.paintView(w, h)            -> canvas with sky, sun/moon, stars, land, tree
     Sky.drawFall(ctx, w, h, time)  rain or snow particles, for the live layer
   Data: GET /api/settings once and on casa:data settings; GET /api/weather every
   15 minutes (Pace "weather") and on casa:data weather. Without a city the sky
   still follows the clock, with a generic sunrise/sunset. */
const Sky = (() => {
  const QS = new URLSearchParams(location.search);
  const forcedHour = QS.get("hour");
  const forcedDate = QS.get("date");
  const forcedWx = QS.get("wx");

  let wx = null;          // last good /api/weather answer
  let settings = null;    // last /api/settings answer
  const subs = [];
  const changed = () => subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

  // ---------------------------------------------------------------- time
  function nowDate() {
    if (forcedDate) {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(forcedDate.trim());
      if (m) return new Date(+m[1], +m[2] - 1, +m[3], new Date().getHours(), new Date().getMinutes());
    }
    return new Date();
  }
  function hour() {
    if (forcedHour !== null) {
      const names = { dawn: 6.5, day: 13, sunset: 19, dusk: 20.5, night: 23 };
      if (names[forcedHour] !== undefined) return names[forcedHour];
      const n = parseFloat(forcedHour);
      if (!isNaN(n)) return ((n % 24) + 24) % 24;
    }
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }
  function now() {
    const d = nowDate();
    if (forcedHour === null) return d;
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return new Date(day.getTime() + hour() * 3600000);
  }

  // ---------------------------------------------------------------- place
  function where() {
    const ll = wx && wx.latlon;
    if (Array.isArray(ll) && ll.length >= 2 && isFinite(ll[0]) && isFinite(ll[1])) return { lat: +ll[0], lon: +ll[1], name: (wx.where && wx.where.name) || "" };
    const w = wx && wx.where;
    if (Array.isArray(w) && w.length >= 2 && isFinite(w[0]) && isFinite(w[1])) return { lat: +w[0], lon: +w[1], name: "" };
    if (w && isFinite(w.lat) && isFinite(w.lon)) return { lat: +w.lat, lon: +w.lon, name: w.name || "" };
    const c = settings && settings.city;
    if (c && isFinite(c.lat) && isFinite(c.lon)) return { lat: +c.lat, lon: +c.lon, name: c.name || "" };
    return null;
  }

  // ---------------------------------------------------------------- the hour
  /* Sky colours by hour. The table describes a day with sunrise at 6.2 and
     sunset at 19.6; the real hour is remapped onto it (solar) so dawn and
     dusk land on the real sunrise and sunset for the place and the date. */
  const SKY = [
    { h: 0.0,  top: [8, 11, 22],     mid: [14, 20, 34],    hor: [26, 30, 46],   glow: [96, 116, 158],  tint: 0.00, stars: 1.00 },
    { h: 4.6,  top: [12, 16, 32],    mid: [26, 32, 54],    hor: [52, 48, 70],   glow: [158, 126, 148], tint: 0.06, stars: 0.72 },
    { h: 6.2,  top: [40, 58, 104],   mid: [128, 104, 128], hor: [236, 148, 108], glow: [255, 182, 122], tint: 0.32, stars: 0.18 },
    { h: 8.0,  top: [104, 152, 208], mid: [172, 200, 226], hor: [236, 226, 214], glow: [255, 238, 198], tint: 0.64, stars: 0.00 },
    { h: 13.0, top: [110, 164, 220], mid: [180, 210, 234], hor: [240, 234, 224], glow: [255, 248, 226], tint: 0.74, stars: 0.00 },
    { h: 17.4, top: [86, 126, 186],  mid: [190, 172, 168], hor: [248, 182, 116], glow: [255, 204, 128], tint: 0.60, stars: 0.00 },
    { h: 19.6, top: [42, 54, 96],    mid: [128, 84, 96],   hor: [238, 126, 70], glow: [255, 158, 84],  tint: 0.36, stars: 0.16 },
    { h: 20.9, top: [20, 26, 52],    mid: [56, 46, 70],    hor: [138, 74, 62],  glow: [220, 114, 70],  tint: 0.14, stars: 0.60 },
    { h: 22.2, top: [9, 13, 26],     mid: [17, 23, 38],    hor: [40, 36, 50],   glow: [136, 116, 138], tint: 0.03, stars: 0.94 },
    { h: 24.0, top: [8, 11, 22],     mid: [14, 20, 34],    hor: [26, 30, 46],   glow: [96, 116, 158],  tint: 0.00, stars: 1.00 },
  ];
  const TBL_RISE = 6.2, TBL_SET = 19.6;

  let timesKey = "", timesVal = null;
  function sunTimes() {
    const s = wx && wx.sun;
    if (s && s.rise_h > 0 && s.set_h > s.rise_h && s.set_h < 24) return { rise: s.rise_h, set: s.set_h };
    const p = where();
    if (!p || typeof Astro === "undefined") return null;
    const d = nowDate();
    const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)},${d.toDateString()}`;
    if (key !== timesKey) {
      timesKey = key;
      const t = Astro.sunTimes(d, p.lat, p.lon);
      // hours after local midnight
      timesVal = t.rise !== null && t.set !== null && t.set > t.rise ? { rise: t.rise, set: t.set } : null;
    }
    return timesVal;
  }

  function solar(h) {
    const t = sunTimes();
    if (!t) return h;
    const sr = t.rise, ss = t.set;
    if (!(sr > 0 && ss > sr && ss < 24)) return h;
    if (h <= sr) return (h / sr) * TBL_RISE;
    if (h >= ss) return TBL_SET + ((h - ss) / (24 - ss)) * (24 - TBL_SET);
    return TBL_RISE + ((h - sr) / (ss - sr)) * (TBL_SET - TBL_RISE);
  }

  const mix = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];

  function palette() {
    const h = solar(hour());
    let i = 0;
    while (i < SKY.length - 2 && SKY[i + 1].h <= h) i++;
    const a = SKY[i], b = SKY[i + 1];
    const t = Math.max(0, Math.min(1, (h - a.h) / ((b.h - a.h) || 1)));
    const e = t * t * (3 - 2 * t);
    const hor = mix(a.hor, b.hor, e), mid = mix(a.mid, b.mid, e);
    // distant haze leans to the mid sky when the horizon is warm (sunset)
    const warm = Math.max(0, Math.min(1, (hor[0] - hor[2]) / 160));
    return { top: mix(a.top, b.top, e), mid, hor, haze: mix(hor, mid, 0.8 * warm), glow: mix(a.glow, b.glow, e),
      tint: a.tint + (b.tint - a.tint) * e, stars: a.stars + (b.stars - a.stars) * e, hour: h };
  }

  // how far the room goes toward night: 0 at midday, 0.62 at midnight
  function night() {
    const d = 1 - palette().tint;
    let k = Math.max(0, Math.min(0.62, ((d - 0.26) / 0.74) * 0.62));
    if (kind() === "overcast" || kind() === "rain") k = Math.min(0.62, k + 0.06);
    return k;
  }

  // ---------------------------------------------------------------- season
  function season() {
    let d = nowDate();
    const p = where();
    if (p && p.lat < 0) d = new Date(d.getTime() + 182.6 * 86400000);
    const y = d.getFullYear();
    const doy = Math.floor((d - new Date(y, 0, 1)) / 86400000);
    const cold = (Math.cos((2 * Math.PI * (doy - 15)) / 365.2422) + 1) / 2;
    const H = [new Date(y, 2, 20), new Date(y, 5, 21), new Date(y, 8, 22), new Date(y, 11, 21)].map((x) => x.getTime());
    const t = d.getTime();
    let phase, a, b;
    if (t < H[0]) { phase = "winter"; a = new Date(y - 1, 11, 21).getTime(); b = H[0]; }
    else if (t < H[1]) { phase = "spring"; a = H[0]; b = H[1]; }
    else if (t < H[2]) { phase = "summer"; a = H[1]; b = H[2]; }
    else if (t < H[3]) { phase = "autumn"; a = H[2]; b = H[3]; }
    else { phase = "winter"; a = H[3]; b = new Date(y + 1, 2, 20).getTime(); }
    const prog = Math.max(0, Math.min(1, (t - a) / (b - a)));
    const leaf = phase === "winter" ? "bare" : phase === "spring" ? (prog < 0.35 ? "buds" : "fresh")
      : phase === "summer" ? "full" : (prog < 0.85 ? "turn" : "bare");
    return { doy, cold, phase, prog, leaf };
  }

  // ---------------------------------------------------------------- weather
  const kindOf = (c) => {
    if (typeof c !== "number") return "";
    if ((c >= 71 && c < 80) || (c >= 85 && c < 90)) return "snow";
    if ((c >= 51 && c < 71) || (c >= 80 && c < 85) || c >= 95) return "rain";
    if (c >= 45 && c < 51) return "fog";
    if (c === 3) return "overcast";
    return "";
  };
  function kind() {
    if (forcedWx !== null) {
      const n = parseInt(forcedWx, 10);
      if (!isNaN(n)) return kindOf(n);
      return ["rain", "snow", "fog", "overcast"].includes(forcedWx) ? forcedWx : "";
    }
    if (!wx) return "";
    return kindOf(wx.code_hour) || kindOf(wx.code);
  }
  const WORDS = [[0, "clear"], [1, "mainly clear"], [2, "partly cloudy"], [3, "overcast"], [45, "fog"], [48, "fog"],
    [51, "drizzle"], [56, "freezing drizzle"], [61, "rain"], [66, "freezing rain"], [71, "snow"], [77, "snow grains"],
    [80, "showers"], [85, "snow showers"], [95, "thunderstorm"]];
  function words(c) {
    let w = "";
    for (const [n, s] of WORDS) if (c >= n) w = s;
    return w;
  }
  function label() {
    if (forcedWx !== null) return forcedWx;
    if (!wx || typeof wx.code !== "number") return where() ? "" : "Set a city in Settings to see the weather";
    const t = typeof wx.temp === "number" ? Math.round(wx.temp) + "°, " : "";
    return t + words(wx.code);
  }

  function askSettings() {
    return fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((s) => {
      if (s && typeof s === "object") { settings = s; changed(); }
    });
  }
  function askWeather() {
    return fetch("/api/weather").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((w) => {
      if (!w || typeof w !== "object") return;
      if (w.off) { if (wx) { wx = null; changed(); } return; }
      // a failed or empty answer keeps the last known sky
      if (typeof w.code === "number") { wx = w; changed(); }
    });
  }

  let loop = null;
  function start() {
    askSettings().then(askWeather);
    loop = Pace.every("weather", 15 * 60 * 1000, askWeather);
    document.addEventListener("casa:data", (e) => {
      const k = e.detail && e.detail.kind;
      if (k === "settings") askSettings().then(askWeather);
      else if (k === "weather") askWeather();
    });
  }

  // ---------------------------------------------------------------- painter
  const G = (c) => PIX.grade(c);
  const thr = PIX.thr;
  const HOR = 0.74;       // the horizon line, as a fraction of the glass height
  const ALT_TOP = 70;     // degrees of altitude at the top of the glass

  // where an object at (alt, az) sits in the glass, 0..1 each way
  function project(alt, az, lat) {
    const facing = lat < 0 ? 0 : 180;
    let da = az - facing;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    const x = 0.5 + (lat < 0 ? -da : da) / 200;
    const y = HOR - (alt / ALT_TOP) * HOR;
    return { x, y };
  }

  // the sun and the moon in the glass; a table arc when there is no place
  function bodies(time) {
    const p = where();
    const out = { sun: null, moon: null, illum: 0.5, waxing: true };
    if (p && typeof Astro !== "undefined") {
      const d = Astro.dayOf(time);
      const s = Astro.sun(d), m = Astro.moon(d);
      const sa = Astro.altAz(s.ra, s.dec, d, p.lat, p.lon), ma = Astro.altAz(m.ra, m.dec, d, p.lat, p.lon);
      out.sun = Object.assign(project(sa.alt, sa.az, p.lat), { alt: sa.alt });
      out.moon = Object.assign(project(ma.alt, ma.az, p.lat), { alt: ma.alt });
      const ph = Astro.phase(d);
      out.illum = ph.illum; out.waxing = ph.waxing;
      return out;
    }
    const h = hour();
    const t = (h - 7) / 11;                     // 07:00 .. 18:00
    out.sun = { x: 0.12 + 0.76 * t, y: HOR - Math.sin(Math.PI * t) * 0.6, alt: Math.sin(Math.PI * t) * 40 };
    const tm = ((h + 24 - 19) % 24) / 11;       // 19:00 .. 06:00
    out.moon = { x: 0.15 + 0.7 * tm, y: HOR - Math.sin(Math.PI * Math.min(1, tm)) * 0.55, alt: tm <= 1 ? Math.sin(Math.PI * tm) * 35 : -5 };
    return out;
  }

  // a ridge line: height 0..1 at x, from a few seeded sines
  function ridge(seed, x, w) {
    const r = PIX.rand(seed);
    let v = 0, amp = 1, f = 1.3, tot = 0;
    for (let i = 0; i < 4; i++) {
      const ph = r() * 6.28;
      v += amp * Math.sin((x / w) * f * 6.28 + ph);
      tot += amp; amp *= 0.5; f *= 2.1;
    }
    return (v / tot + 1) / 2;
  }

  function paintView(w, h) {
    w = Math.max(8, w | 0); h = Math.max(8, h | 0);
    const P = palette(), S = season(), K = kind();
    const time = now();
    const k = night();
    const hor = Math.round(h * HOR);
    const darkLand = (c) => mix(c, PIX.T("night"), Math.min(0.85, k * 1.25));
    const veil = K === "overcast" || K === "rain" || K === "snow";
    const grey = mix(P.mid, [150, 156, 166], 0.55);

    return PIX.raster(w, h, (set) => {
      const put = (x, y, c, a) => set(x, y, G(c), a);
      // --- sky
      const top = veil ? mix(P.top, grey, 0.7) : P.top;
      const mid = veil ? mix(P.mid, grey, 0.7) : P.mid;
      const lo = veil ? mix(P.hor, grey, 0.6) : P.hor;
      for (let y = 0; y < hor; y++) {
        const t = y / Math.max(1, hor - 1);
        const a = t < 0.55 ? top : mid, b = t < 0.55 ? mid : lo;
        const f = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
        for (let x = 0; x < w; x++) put(x, y, f > thr(x, y) ? b : a);
      }
      // --- stars
      if (P.stars > 0.05 && !veil) {
        const p = where();
        const list = p && typeof Astro !== "undefined" ? Astro.stars(time, p.lat, p.lon).map((s) => Object.assign(project(s.alt, s.az, p.lat), s))
          : (() => { const r = PIX.rand(7); return Array.from({ length: 40 }, () => ({ x: r(), y: r() * HOR * 0.9, alt: 10, mag: r() * 3 })); })();
        for (const s of list) {
          if (s.alt < 2 || s.x < 0 || s.x > 1 || s.y < 0) continue;
          const vis = P.stars * (1 - s.mag / 4);
          if (vis < 0.15) continue;
          const sx = Math.round(s.x * (w - 1)), sy = Math.round(s.y * h);
          if (sy >= hor - 2) continue;
          put(sx, sy, mix(P.mid, [240, 240, 250], Math.min(1, vis + 0.2)));
          if (s.mag < 0.6 && vis > 0.6) { put(sx + 1, sy, mix(P.mid, [200, 205, 230], 0.6)); put(sx, sy + 1, mix(P.mid, [200, 205, 230], 0.5)); }
        }
      }
      // --- sun and moon
      const B = bodies(time);
      const R = Math.max(3, Math.round(h * 0.075));
      if (B.sun && B.sun.alt > -3) {
        const cx = Math.round(B.sun.x * w), cy = Math.round(B.sun.y * h);
        const low = Math.max(0, Math.min(1, 1 - B.sun.alt / 18));
        const core = mix([255, 246, 214], [252, 148, 62], low);
        const rim = mix(P.glow, [255, 190, 110], low);
        for (let y = -R - 2; y <= R + 2; y++) for (let x = -R - 2; x <= R + 2; x++) {
          const d = Math.sqrt(x * x + y * y);
          if (cy + y >= hor) continue;
          if (d <= R) put(cx + x, cy + y, veil ? mix(core, grey, 0.75) : core);
          else if (d <= R + 2 && !veil && thr(cx + x, cy + y) < 0.5) put(cx + x, cy + y, rim);
        }
      }
      if (B.moon && B.moon.alt > -2 && P.tint < 0.5) {
        const r = Math.max(2, Math.round(R * 0.7));
        const cx = Math.round(B.moon.x * w), cy = Math.round(B.moon.y * h);
        const lit = [236, 234, 222], dark = mix(P.top, [60, 66, 84], 0.5);
        // the terminator: x position of the lit edge for illuminated fraction
        const e = 1 - 2 * B.illum;
        for (let y = -r; y <= r; y++) {
          const half = Math.sqrt(Math.max(0, r * r - y * y));
          for (let x = -r; x <= r; x++) {
            if (x * x + y * y > r * r + r * 0.3 || cy + y >= hor) continue;
            const u = half ? x / half : 0;           // -1 .. 1 across this row
            const on = B.waxing ? u > e : u < -e;
            put(cx + x, cy + y, veil ? mix(on ? lit : dark, grey, 0.7) : on ? lit : dark);
          }
        }
      }
      // --- clouds: a few puffy banks drifting slowly with the clock
      const drift = (time.getHours() * 60 + time.getMinutes()) / 1440;
      const cr = PIX.rand(11 + S.doy);
      const nC = veil ? 0 : K === "fog" ? 1 : 3;
      const day = P.tint > 0.3;
      const cloudC = day ? mix(P.hor, [255, 255, 255], 0.6) : mix(P.top, [150, 160, 190], 0.28);
      const cloudS = mix(cloudC, P.mid, 0.35);
      for (let n = 0; n < nC; n++) {
        const cw = Math.round(w * (0.16 + cr() * 0.14));
        const bx = Math.round((((cr() + drift * (0.6 + n * 0.3)) % 1) * 1.3 - 0.15) * w);
        const by = Math.round(h * (0.14 + cr() * 0.3));
        const puffs = 3 + Math.floor(cr() * 2);
        for (let k = 0; k < puffs; k++) {
          const pr = Math.max(2, Math.round(h * (0.035 + cr() * 0.03)));
          const px = bx + Math.round((k + 0.5) * cw / puffs);
          for (let y = -pr; y <= 0; y++) for (let x = -pr; x <= pr; x++) {
            if (x * x + y * y > pr * pr + pr * 0.4) continue;
            put(px + x, by + y, y > -pr * 0.35 ? cloudS : cloudC);
          }
        }
        for (let x = bx; x < bx + cw; x++) put(x, by, cloudS);
      }
      // --- two soft hills: a far one in the haze, a near meadow
      const snowy = (S.cold > 0.8 && S.phase === "winter") || K === "snow";
      const farC = snowy ? mix([214, 220, 232], P.haze, 0.35) : mix([104, 130, 112], P.haze, 0.5);
      const farL = snowy ? mix([240, 242, 248], P.haze, 0.25) : mix([128, 152, 128], P.haze, 0.45);
      for (let x = 0; x < w; x++) {
        const f = ridge(3, x, w);
        const top = Math.round(hor - h * (0.04 + f * 0.11));
        for (let y = top; y < hor + 3; y++) {
          put(x, y, darkLand((y - top) < 2 ? farL : farC));
        }
      }
      const green = S.leaf === "full" ? [96, 140, 76] : S.leaf === "fresh" ? [112, 156, 84] : S.leaf === "turn" ? [138, 128, 76] : [116, 118, 92];
      const nearC = snowy ? [236, 238, 244] : mix(green, P.haze, 0.18);
      const nearD = snowy ? [204, 210, 224] : mix(nearC, [40, 46, 52], 0.3);
      for (let x = 0; x < w; x++) {
        const f = ridge(9, x, w);
        const top = Math.round(hor + h * 0.02 - h * f * 0.09);
        for (let y = top; y < h; y++) {
          put(x, y, darkLand((y - top) < 2 ? nearC : nearD));
        }
      }
      // --- the tree, on the right of the glass
      tree(put, w, h, S, darkLand);
      // --- fog: pale bands over the land
      if (K === "fog") {
        const fogC = mix(P.hor, [210, 214, 220], 0.6);
        for (let y = Math.round(h * 0.35); y < h; y++) for (let x = 0; x < w; x++)
          if (thr(x, y) < 0.35 + 0.35 * Math.sin(y * 0.4)) put(x, y, darkLand(fogC));
      }
    }).c;
  }

  // tree tones: CasaTheme.trees first, then the palette
  function treeTone(n) {
    const t = PIX.theme();
    const v = t && t.trees && t.trees[n];
    return Array.isArray(v) && v.length >= 3 ? v : PIX.T(n);
  }

  function tree(put, w, h, S, darkLand) {
    const tx = Math.round(w * 0.8), base = h, height = Math.round(h * 0.58);
    const bark = darkLand(treeTone("dark")), barkL = darkLand(treeTone("umber"));
    for (let y = base - Math.round(height * 0.55); y < base; y++)
      for (let x = -1; x <= 1; x++) put(tx + x, y, x === -1 ? barkL : bark);
    // branches: a fixed fork pattern
    const br = [[0.45, -0.9], [0.5, 0.8], [0.62, -0.6], [0.7, 0.55], [0.85, 0.1]];
    const ends = [];
    br.forEach(([at, dir], i) => {
      const y0 = base - Math.round(height * at), len = Math.round(height * (0.32 - i * 0.03));
      for (let n = 0; n < len; n++) {
        const x = tx + Math.round(dir * n * 0.8), y = y0 - Math.round(n * 0.7);
        put(x, y, bark);
        if (n === len - 1) ends.push([x, y]);
      }
    });
    if (S.leaf === "bare") {
      if (S.cold > 0.75) ends.forEach(([x, y]) => { put(x, y - 1, darkLand([230, 234, 240])); put(x + 1, y - 1, darkLand([230, 234, 240])); });
      return;
    }
    const L = treeTone("leaf"), M = treeTone("moss"), Pn = treeTone("pine"), Gd = treeTone("gold"), Wd = treeTone("wood");
    let tones;
    if (S.leaf === "buds") tones = [mix(L, [244, 241, 234], 0.3), L];
    else if (S.leaf === "fresh") tones = [L, M];
    else if (S.leaf === "full") tones = [M, Pn];
    else {
      // autumn: green turns toward gold, then toward the darker wood tone
      const t = S.prog;
      const lit = t < 0.4 ? mix(L, Gd, Math.min(1, t * 2.5)) : mix(Gd, Wd, Math.min(1, (t - 0.4) / 0.45));
      tones = [lit, mix(lit, Wd, 0.5)];
    }
    const density = S.leaf === "buds" ? 0.18 : S.leaf === "turn" ? Math.max(0.25, 0.8 - S.prog * 0.7) : 0.85;
    const cx = tx, cy = base - Math.round(height * 0.78), rx = Math.round(w * 0.14), ry = Math.round(height * 0.32);
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
      const u = x / rx, v = y / ry;
      const wob = 0.82 + 0.18 * Math.sin(x * 0.7 + y * 0.4);
      if (u * u + v * v > wob) continue;
      if (thr(cx + x, cy + y) > density) continue;
      put(cx + x, cy + y, darkLand(v < -0.1 && u < 0.3 ? tones[0] : tones[1]));
    }
  }

  // rain or snow over the glass, for the live layer
  const DROPS = (() => { const r = PIX.rand(5); return Array.from({ length: 70 }, () => ({ x: r(), p: r(), v: 0.6 + r() * 0.8, s: r() })); })();
  function drawFall(ctx, w, h, time) {
    const K = kind();
    ctx.clearRect(0, 0, w, h);
    if (K !== "rain" && K !== "snow") return false;
    const k = night();
    const n = K === "rain" ? Math.min(70, Math.round(w * 0.45)) : Math.min(50, Math.round(w * 0.3));
    ctx.fillStyle = PIX.rgb(PIX.grade(mix(K === "rain" ? [190, 205, 225] : [244, 246, 250], [40, 48, 64], k * 0.8)));
    for (let i = 0; i < n; i++) {
      const d = DROPS[i];
      if (K === "rain") {
        const y = ((d.p + (time / 900) * d.v) % 1) * (h + 6) - 3;
        const x = (d.x * w + y * 0.25) % w;
        ctx.fillRect(Math.round(x), Math.round(y), 1, 3);
      } else {
        const y = ((d.p + (time / 9000) * d.v) % 1) * (h + 2) - 1;
        const x = (d.x * w + Math.sin(time / 1500 + d.s * 6.28) * 2 + w) % w;
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
    return true;
  }

  return {
    start, now, hour, where, palette, night, season, kind, label, paintView, drawFall, treeTone,
    on(fn) { subs.push(fn); },
    weather: () => wx, settings: () => settings,
  };
})();
