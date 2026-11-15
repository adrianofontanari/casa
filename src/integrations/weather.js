/* Weather, forecast and city search from Open-Meteo (no key, no account).

   /api/weather keeps the key names of the original room's weather endpoint so the sky
   engine reads it unchanged: temp, code, code_hour, day, feels, hum, cloud, press,
   wind{kmh, gust, dir}, uv, uv_band, uv_st, zero, sun{rise, set, rise_h, set_h}, moon{...},
   stale, age_min. Added: where{name, lat, lon}, latlon [lat, lon], units, tz, credit.

   Licence: Open-Meteo data is CC BY 4.0 and must be credited with a link next to where it
   is shown ("Weather data by Open-Meteo.com"). The free API is for non-commercial use,
   with limits of 10,000 calls a day per user. See docs/dev/credits.md. */
'use strict';

const U = require('./util.js');

const WEATHER_TTL = 15 * 60 * 1000;
const WEATHER_STALE = 3 * 3600 * 1000;
const FORECAST_TTL = 60 * 60 * 1000;
const FORECAST_STALE = 6 * 3600 * 1000;
const GEOCODE_TTL = 24 * 3600 * 1000;

const CREDIT = {
  credit: 'Weather data by Open-Meteo.com',
  creditHref: 'https://open-meteo.com/',
  licence: 'CC BY 4.0',
  licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
};
const GEO_CREDIT = {
  credit: 'Search by Open-Meteo.com, location data based on GeoNames',
  creditHref: 'https://open-meteo.com/',
  licence: 'CC BY 4.0',
  licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
};

const ROSE = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const UV_BANDS = [[3, 'low', 'ok'], [6, 'moderate', 'ok'], [8, 'high', 'warn'], [11, 'very high', 'orange']];
const MOON_NAMES = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous',
  'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];
const SYNODIC = 29.530588853;

function rose(deg) {
  const d = Number(deg);
  if (!Number.isFinite(d)) return '';
  return ROSE[Math.floor(((d % 360) + 360) % 360 / 22.5 + 0.5) % 16];
}

function uvBand(uv) {
  const v = Number(uv);
  if (uv === null || uv === undefined || !Number.isFinite(v)) return null;
  for (const [lim, band, st] of UV_BANDS) if (v < lim) return { band: band, st: st };
  return { band: 'extreme', st: 'alert' };
}

/* Moon phase from the date alone: same number everywhere on earth, no request needed. */
function moon(ts) {
  const t = ts === undefined ? Date.now() : ts;
  const jd = t / 86400000 + 2440587.5;
  const ph = (((jd - 2451550.1) / SYNODIC) % 1 + 1) % 1;
  return {
    phase: Math.round(ph * 10000) / 10000,
    illum: Math.round((1 - Math.cos(2 * Math.PI * ph)) / 2 * 1000) / 1000,
    waxing: ph < 0.5,
    name: MOON_NAMES[Math.floor(((ph + 1 / 16) % 1) * 8)],
    age: Math.round(ph * SYNODIC * 10) / 10,
  };
}

/* "2026-09-08T06:53" -> ["06:53", 6.8833] */
function hhmm(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
  if (!m) return [null, null];
  const h = +m[1], mi = +m[2];
  return [m[1] + ':' + m[2], Math.round((h + mi / 60) * 10000) / 10000];
}

function cityOf(settings) {
  const c = settings && settings.city;
  if (!c || typeof c !== 'object') return null;
  const lat = Number(c.lat), lon = Number(c.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: String(c.name || ''), lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000 };
}

function unitsOf(settings) {
  const imperial = settings && settings.units === 'imperial';
  return {
    imperial: imperial,
    q: imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' : '',
    label: { temp: imperial ? '°F' : '°C', wind: imperial ? 'mph' : 'km/h', press: 'hPa', precip: imperial ? 'in' : 'mm' },
  };
}

function weatherOff(settings) {
  return settings && settings.weatherOn === false;
}

const OM = 'https://api.open-meteo.com/v1/forecast';

function weatherUrl(city, units) {
  return OM + '?latitude=' + city.lat + '&longitude=' + city.lon +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,' +
    'wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,cloud_cover' +
    '&daily=sunrise,sunset,uv_index_max' +
    '&hourly=freezing_level_height,weather_code' +
    '&timezone=auto&forecast_days=1' + units.q;
}

/* Turn an Open-Meteo answer into the room's weather shape. Pure, so tests can feed fixtures. */
function shapeWeather(got, city, units, nowMs) {
  const cur = got.current || {};
  const day = got.daily || {};
  const h = got.hourly || {};
  if (cur.temperature_2m === null || cur.temperature_2m === undefined) throw U.httpError(502, 'Open-Meteo answered without a temperature');
  const out = {
    temp: U.num(cur.temperature_2m),
    code: U.num(cur.weather_code) || 0,
    day: cur.is_day === undefined ? true : !!cur.is_day,
  };
  out.feels = U.num(cur.apparent_temperature);
  out.hum = U.num(cur.relative_humidity_2m);
  out.cloud = U.num(cur.cloud_cover);
  out.press = U.num(cur.surface_pressure);
  const sp = U.num(cur.wind_speed_10m), gu = U.num(cur.wind_gusts_10m);
  if (sp !== null) {
    const toKmh = (v) => (v === null ? null : units.imperial ? Math.round(v * 1.609344) : v);
    out.wind = { kmh: toKmh(sp), gust: toKmh(gu), dir: rose(cur.wind_direction_10m), speed: sp, gustSpeed: gu, unit: units.label.wind };
  }
  const uv = (day.uv_index_max || [])[0];
  if (uv !== null && uv !== undefined) {
    out.uv = U.num(uv, 1);
    const b = uvBand(uv);
    if (b) { out.uv_band = b.band; out.uv_st = b.st; }
  }
  const times = h.time || [];
  const i = times.indexOf(String(cur.time || '').slice(0, 13) + ':00');
  if (i >= 0) {
    const fl = (h.freezing_level_height || [])[i];
    out.zero = fl === null || fl === undefined ? null : U.num(fl);
    const wc = (h.weather_code || [])[i];
    out.code_hour = wc === null || wc === undefined ? null : U.num(wc);
  }
  const [rise, riseH] = hhmm((day.sunrise || [])[0]);
  const [set, setH] = hhmm((day.sunset || [])[0]);
  if (riseH !== null && setH !== null && riseH < setH) out.sun = { rise: rise, set: set, rise_h: riseH, set_h: setH };
  out.moon = moon(nowMs);
  out.where = { name: city.name, lat: city.lat, lon: city.lon };
  out.latlon = [city.lat, city.lon];
  out.units = units.label;
  out.tz = { name: got.timezone || null, offset: U.num(got.utc_offset_seconds) };
  out.observed = cur.time || null;
  return Object.assign(out, CREDIT);
}

async function weather(a, b) {
  const c = U.ctxOf(a, b);
  if (weatherOff(c.settings)) return U.reply(200, { off: true, reason: 'weather is off' });
  const city = cityOf(c.settings);
  if (!city) return U.reply(200, { off: true, reason: 'no city' });
  const units = unitsOf(c.settings);
  const key = 'weather:' + city.lat + ',' + city.lon + ':' + (units.imperial ? 'i' : 'm');
  try {
    const r = await U.cached(c, key, WEATHER_TTL, WEATHER_STALE, async () =>
      shapeWeather(await U.getJson(c, weatherUrl(city, units), 'Open-Meteo'), city, units, c.now()));
    const out = Object.assign({}, r.value, { at: new Date(r.at).toISOString() });
    if (r.stale) { out.stale = true; out.age_min = r.ageMin; }
    return U.reply(200, out);
  } catch (e) {
    return U.reply(e.status || 502, Object.assign({ error: e.message }, CREDIT));
  }
}

function forecastUrl(city, units) {
  return OM + '?latitude=' + city.lat + '&longitude=' + city.lon +
    '&current=temperature_2m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,' +
    'sunrise,sunset,uv_index_max,wind_speed_10m_max' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m' +
    '&timezone=auto&forecast_days=7' + units.q;
}

const HOURS = 24;

function shapeForecast(got, city, units) {
  const h = got.hourly || {};
  const d = got.daily || {};
  const times = h.time || [];
  if (!times.length && !(d.time || []).length) throw U.httpError(502, 'Open-Meteo answered without a forecast');
  const nowHour = String((got.current || {}).time || '').slice(0, 13) + ':00';
  let start = times.indexOf(nowHour);
  if (start < 0) start = 0;
  const hourly = [];
  for (let i = start; i < Math.min(start + HOURS, times.length); i++) {
    hourly.push({
      t: times[i],
      temp: U.num((h.temperature_2m || [])[i]),
      code: U.num((h.weather_code || [])[i]) || 0,
      pop: U.num((h.precipitation_probability || [])[i]) || 0,
      precip: U.num((h.precipitation || [])[i], 1),
      wind: U.num((h.wind_speed_10m || [])[i]),
    });
  }
  const daily = (d.time || []).map((date, i) => ({
    date: date,
    min: U.num((d.temperature_2m_min || [])[i]),
    max: U.num((d.temperature_2m_max || [])[i]),
    code: U.num((d.weather_code || [])[i]) || 0,
    pop: U.num((d.precipitation_probability_max || [])[i]) || 0,
    sunrise: hhmm((d.sunrise || [])[i])[0],
    sunset: hhmm((d.sunset || [])[i])[0],
    uv: U.num((d.uv_index_max || [])[i], 1),
    wind: U.num((d.wind_speed_10m_max || [])[i]),
  }));
  return Object.assign({
    hourly: hourly, daily: daily, units: units.label,
    where: { name: city.name, lat: city.lat, lon: city.lon },
    tz: { name: got.timezone || null, offset: U.num(got.utc_offset_seconds) },
  }, CREDIT);
}

async function forecast(a, b) {
  const c = U.ctxOf(a, b);
  if (weatherOff(c.settings)) return U.reply(200, { off: true, reason: 'weather is off', hourly: [], daily: [] });
  const city = cityOf(c.settings);
  if (!city) return U.reply(200, { off: true, reason: 'no city', hourly: [], daily: [] });
  const units = unitsOf(c.settings);
  const key = 'forecast:' + city.lat + ',' + city.lon + ':' + (units.imperial ? 'i' : 'm');
  try {
    const r = await U.cached(c, key, FORECAST_TTL, FORECAST_STALE, async () =>
      shapeForecast(await U.getJson(c, forecastUrl(city, units), 'Open-Meteo'), city, units));
    const out = Object.assign({}, r.value, { at: new Date(r.at).toISOString() });
    if (r.stale) { out.stale = true; out.age_min = r.ageMin; }
    return U.reply(200, out);
  } catch (e) {
    return U.reply(e.status || 502, Object.assign({ error: e.message, hourly: [], daily: [] }, CREDIT));
  }
}

function shapeGeocode(got) {
  return (got.results || []).map((r) => ({
    name: r.name,
    country: r.country || '',
    admin1: r.admin1 || '',
    lat: U.num(r.latitude, 4),
    lon: U.num(r.longitude, 4),
    countryCode: r.country_code || '',
    timezone: r.timezone || '',
    population: r.population || null,
  })).filter((r) => r.lat !== null && r.lon !== null);
}

async function geocode(a, b) {
  const c = U.ctxOf(a, b);
  const q = String((c.query && c.query.q) || '').trim().slice(0, 80);
  if (q.length < 2) return U.reply(200, Object.assign({ results: [] }, GEO_CREDIT));
  const lang = /^[a-z]{2}$/i.test(String(c.query.lang || '')) ? String(c.query.lang).toLowerCase() : 'en';
  const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) +
    '&count=8&language=' + lang + '&format=json';
  try {
    const r = await U.cached(c, 'geocode:' + lang + ':' + q.toLowerCase(), GEOCODE_TTL, GEOCODE_TTL, async () =>
      shapeGeocode(await U.getJson(c, url, 'Open-Meteo city search')));
    return U.reply(200, Object.assign({ results: r.value }, GEO_CREDIT));
  } catch (e) {
    return U.reply(e.status || 502, Object.assign({ error: e.message, results: [] }, GEO_CREDIT));
  }
}

module.exports = {
  routes: { weather: weather, forecast: forecast, geocode: geocode },
  shapeWeather, shapeForecast, shapeGeocode, weatherUrl, forecastUrl, moon, rose, uvBand, cityOf, unitsOf, CREDIT,
};
