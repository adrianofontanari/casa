/* Astro: sun, moon and bright stars for a latitude/longitude, computed locally.

   Low-precision textbook formulas (Astronomical Almanac sun, a truncated
   Meeus moon). Good to a fraction of a degree, which is far finer than the
   window can draw. No network, no tables downloaded. Called only when the
   window view is rebuilt (about once a minute), never per frame. */
const Astro = (() => {
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const norm = (a) => ((a % 360) + 360) % 360;
  // days since J2000.0
  const dayOf = (t) => (t instanceof Date ? t.getTime() : t) / 86400000 - 10957.5;

  function equatorial(lon, lat, d) {
    const e = (23.4393 - 3.563e-7 * d) * RAD;
    const l = lon * RAD, b = lat * RAD;
    const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
    const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
    return { ra: norm(ra * DEG), dec: dec * DEG };
  }

  function sun(d) {
    const g = norm(357.529 + 0.98560028 * d) * RAD;
    const q = 280.459 + 0.98564736 * d;
    const lon = norm(q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
    return Object.assign(equatorial(lon, 0, d), { lon });
  }

  function moon(d) {
    const Lp = 218.3164477 + 13.17639648 * d;
    const D = norm(297.8501921 + 12.19074912 * d) * RAD;
    const M = norm(357.5291092 + 0.98560028 * d) * RAD;
    const Mp = norm(134.9633964 + 13.06499295 * d) * RAD;
    const F = norm(93.2720950 + 13.22935024 * d) * RAD;
    const s = Math.sin;
    const lon = norm(Lp + 6.289 * s(Mp) + 1.274 * s(2 * D - Mp) + 0.658 * s(2 * D) + 0.214 * s(2 * Mp)
      - 0.186 * s(M) - 0.114 * s(2 * F) + 0.059 * s(2 * D - 2 * Mp) + 0.057 * s(2 * D - M - Mp)
      + 0.053 * s(2 * D + Mp) + 0.046 * s(2 * D - M) - 0.041 * s(M - Mp) - 0.035 * s(D) - 0.030 * s(M + Mp));
    const lat = 5.128 * s(F) + 0.281 * s(Mp + F) + 0.278 * s(Mp - F) + 0.173 * s(2 * D - F);
    return Object.assign(equatorial(lon, lat, d), { lon, lat });
  }

  // altitude and azimuth (degrees from north through east); lon east-positive
  function altAz(ra, dec, d, lat, lon) {
    const lst = norm(280.46061837 + 360.98564736629 * d + lon);
    const H = (lst - ra) * RAD, ph = lat * RAD, de = dec * RAD;
    const alt = Math.asin(Math.sin(ph) * Math.sin(de) + Math.cos(ph) * Math.cos(de) * Math.cos(H));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(ph) - Math.tan(de) * Math.cos(ph));
    return { alt: alt * DEG, az: norm(az * DEG + 180) };
  }

  // illuminated fraction and whether the moon is waxing
  function phase(d) {
    const e = norm(moon(d).lon - sun(d).lon);
    return { elong: e, illum: (1 - Math.cos(e * RAD)) / 2, waxing: e < 180 };
  }

  // sunrise and sunset (local hours, fractional) for the day of `date`
  function sunTimes(date, lat, lon) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const alt = (t) => { const d = dayOf(t), s = sun(d); return altAz(s.ra, s.dec, d, lat, lon).alt + 0.833; };
    let rise = null, set = null, prev = alt(day);
    for (let m = 10; m <= 1440; m += 10) {
      const t = day + m * 60000, a = alt(t);
      if (prev < 0 && a >= 0 && rise === null) rise = m - 10 * a / (a - prev);
      if (prev >= 0 && a < 0 && set === null) set = m - 10 * a / (a - prev);
      prev = a;
    }
    return { rise: rise === null ? null : rise / 60, set: set === null ? null : set / 60 };
  }

  /* Bright stars: right ascension (hours), declination (degrees), magnitude.
     Public catalogue positions (J2000), rounded. */
  const STARS = [
    [6.752, -16.72, -1.46], [6.399, -52.70, -0.74], [14.261, 19.18, -0.05], [18.616, 38.78, 0.03],
    [5.278, 46.00, 0.08], [5.242, -8.20, 0.13], [7.655, 5.22, 0.34], [5.919, 7.41, 0.42],
    [1.629, -57.24, 0.46], [19.846, 8.87, 0.76], [4.599, 16.51, 0.86], [16.490, -26.43, 0.96],
    [13.420, -11.16, 0.97], [7.755, 28.03, 1.14], [22.961, -29.62, 1.16], [20.690, 45.28, 1.25],
    [10.140, 11.97, 1.35], [7.577, 31.89, 1.58], [5.419, 6.35, 1.64], [5.604, -1.20, 1.69],
    [5.679, -1.94, 1.77], [5.533, -0.30, 2.23], [2.530, 89.26, 1.98], [11.062, 61.75, 1.79],
    [11.031, 56.38, 2.37], [11.897, 53.69, 2.44], [12.257, 57.03, 3.31], [12.900, 55.96, 1.77],
    [13.399, 54.93, 2.23], [13.792, 49.31, 1.86], [0.675, 56.54, 2.24], [0.153, 59.15, 2.28],
    [0.945, 60.72, 2.15], [1.430, 60.24, 2.68], [1.906, 63.67, 3.37], [12.443, -63.10, 0.77],
    [12.795, -59.69, 1.25], [12.519, -57.11, 1.64], [14.660, -60.83, -0.27], [14.064, -60.37, 0.61],
    [3.405, 49.86, 1.79], [6.629, 16.40, 1.93], [5.438, 28.61, 1.65], [5.796, -9.67, 2.07],
    [2.120, 23.46, 2.00], [3.136, 40.96, 2.12], [0.140, 29.09, 2.06], [1.162, 35.62, 2.05],
    [2.065, 42.33, 2.10], [23.079, 15.21, 2.48], [23.063, 28.08, 2.42], [0.220, 15.18, 2.83],
    [11.818, 14.57, 2.13], [10.333, 19.84, 2.08], [17.560, -37.10, 1.62], [18.403, -34.38, 1.79],
    [18.921, -26.30, 2.05], [17.582, 12.56, 2.08], [15.578, 26.71, 2.23], [20.370, 40.26, 2.23],
    [19.512, 27.96, 3.05], [21.736, 9.88, 2.39], [0.727, -17.99, 2.04], [3.038, 4.09, 2.54],
    [20.427, -56.74, 1.94], [22.137, -46.96, 1.74], [9.220, -69.72, 1.67], [8.375, -59.51, 1.86],
    [7.140, -26.39, 1.83], [6.977, -28.97, 1.50], [6.378, -17.96, 1.98], [9.460, -8.66, 1.98],
    [14.845, 74.16, 2.08], [17.943, 51.49, 2.23],
  ];

  function stars(t, lat, lon) {
    const d = dayOf(t);
    return STARS.map(([ra, dec, mag]) => Object.assign(altAz(ra * 15, dec, d, lat, lon), { mag }));
  }

  return { dayOf, sun, moon, altAz, phase, sunTimes, stars, STARS };
})();
