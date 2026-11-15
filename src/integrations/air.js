/* Air quality: Open-Meteo's Air Quality API (CAMS model data) for the city, and an optional
   sensor link the user pastes (AirGradient, PurpleAir, Sensor.Community or any JSON with a
   PM2.5 field).

   Index bands are the ones Open-Meteo documents for its own european_aqi and us_aqi
   (EEA bands revised in 2024, US EPA bands), interpolated linearly inside each band. A
   sensor gives an instant reading, so its index is marked approx:true (the official US index
   for particles uses a 24-hour average).

   Attribution: CAMS data must credit the Copernicus programme and Open-Meteo, with the
   year and the non-endorsement sentence of the Copernicus licence (clauses 5.1.1-5.1.3). */
'use strict';

const U = require('./util.js');

const AIR_TTL = 30 * 60 * 1000;
const AIR_STALE = 3 * 3600 * 1000;
const SENSOR_TTL = 2 * 60 * 1000;
const SENSOR_STALE = 15 * 60 * 1000;

function camsCredit(year) {
  return {
    credit: 'Air quality: Copernicus Atmosphere Monitoring Service (CAMS) via Open-Meteo.com',
    creditHref: 'https://open-meteo.com/en/docs/air-quality-api',
    licence: 'CC BY 4.0 (Open-Meteo), Licence to use Copernicus Products',
    licenceHref: 'https://creativecommons.org/licenses/by/4.0/',
    notice: 'Contains modified Copernicus Atmosphere Monitoring Service information ' + year +
      '. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.',
  };
}

// [upper bound of each band] per pollutant; index bands are 0-20-40-60-80-100 (EU) and 0-50-100-150-200-300-500 (US)
const EU = {
  names: ['good', 'fair', 'moderate', 'poor', 'very poor', 'extremely poor'],
  st: ['ok', 'ok', 'warn', 'orange', 'alert', 'alert'],
  idx: [0, 20, 40, 60, 80, 100, 120],
  pm25: [0, 5, 15, 50, 90, 140, 800],
  pm10: [0, 15, 45, 120, 195, 270, 1200],
};
const US = {
  names: ['good', 'moderate', 'unhealthy for sensitive groups', 'unhealthy', 'very unhealthy', 'hazardous'],
  st: ['ok', 'warn', 'orange', 'alert', 'alert', 'alert'],
  idx: [0, 50, 100, 150, 200, 300, 500],
  pm25: [0, 9, 35.5, 55.5, 125.5, 225.5, 325.5],
  pm10: [0, 55, 155, 255, 355, 425, 605],
};

function scaleOf(name) { return name === 'us' ? US : EU; }

function bandOf(scale, aqi) {
  const s = scaleOf(scale);
  if (aqi === null || aqi === undefined || !Number.isFinite(Number(aqi))) return null;
  for (let i = 1; i < s.idx.length - 1; i++) if (aqi < s.idx[i]) return { band: s.names[i - 1], st: s.st[i - 1] };
  return { band: s.names[s.names.length - 1], st: s.st[s.st.length - 1] };
}

/* Index for one pollutant concentration, interpolated inside its band. */
function indexFor(scale, pollutant, conc) {
  const s = scaleOf(scale);
  const c = Number(conc);
  if (conc === null || conc === undefined || !Number.isFinite(c) || c < 0) return null;
  const bp = s[pollutant];
  for (let i = 1; i < bp.length; i++) {
    if (c < bp[i] || i === bp.length - 1) {
      const lo = bp[i - 1], hi = bp[i];
      const v = s.idx[i - 1] + (Math.min(c, hi) - lo) / (hi - lo) * (s.idx[i] - s.idx[i - 1]);
      return Math.round(v);
    }
  }
  return null;
}

function aqiFromPm(scale, pm25, pm10) {
  const a = indexFor(scale, 'pm25', pm25);
  const b = indexFor(scale, 'pm10', pm10);
  if (a === null && b === null) return null;
  return Math.max(a === null ? -1 : a, b === null ? -1 : b);
}

function pickScale(settings) {
  if (settings && (settings.airScale === 'eu' || settings.airScale === 'us')) return settings.airScale;
  return settings && settings.units === 'imperial' ? 'us' : 'eu';
}

function withOffset(localIso, offsetSec) {
  if (!localIso) return null;
  const o = Number(offsetSec);
  if (!Number.isFinite(o)) return localIso;
  const sign = o < 0 ? '-' : '+';
  const a = Math.abs(o);
  const hh = String(Math.floor(a / 3600)).padStart(2, '0');
  const mm = String(Math.floor((a % 3600) / 60)).padStart(2, '0');
  return String(localIso).slice(0, 16) + sign + hh + ':' + mm;
}

function camsUrl(city) {
  return 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + city.lat + '&longitude=' + city.lon +
    '&current=european_aqi,us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto';
}

function shapeCams(got, scale, year) {
  const cur = got.current || {};
  const eu = U.num(cur.european_aqi);
  const us = U.num(cur.us_aqi);
  const aqi = scale === 'us' ? us : eu;
  if (aqi === null) throw U.httpError(502, 'Open-Meteo air quality answered without an index');
  const b = bandOf(scale, aqi);
  return Object.assign({
    aqi: aqi, scale: scale, band: b.band, st: b.st, eu: eu, us: us,
    pm25: U.num(cur.pm2_5, 1), pm10: U.num(cur.pm10, 1), o3: U.num(cur.ozone), no2: U.num(cur.nitrogen_dioxide, 1),
    unit: 'µg/m³', source: 'open-meteo', at: withOffset(cur.time, got.utc_offset_seconds),
  }, camsCredit(year));
}

// ---------------------------------------------------------------- sensor links

const PM25_KEYS = ['pm02compensated', 'pm25', 'pm2_5', 'pm2.5', 'pm_2_5', 'pm2p5', 'pm02', 'pm2_5_atm', 'pm2.5_atm',
  'pm25_value', 'pm2_5value', 'pm2.5_value', 'pm25value', 'pm2_5_ugm3', 'pm25_ugm3'];
const PM10_KEYS = ['pm10', 'pm10.0', 'pm10_0', 'pm10_0_atm', 'pm10.0_atm', 'pm10_value', 'pm10value', 'pm10_ugm3'];

function asNum(v) {
  if (v && typeof v === 'object' && 'value' in v) v = v.value;
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function findKey(obj, keys, depth) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
  for (const k of keys) {
    if (k in lower) { const n = asNum(lower[k]); if (n !== null) return n; }
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') { const n = findKey(v, keys, depth + 1); if (n !== null) return n; }
  }
  return null;
}

function mean(a, b) {
  if (a !== null && b !== null) return (a + b) / 2;
  return a !== null ? a : b;
}

/* -> {kind, pm25, pm10, temp?, hum?, co2?} or null when no PM2.5 value is found. Pure. */
function parseSensor(data) {
  if (data === null || data === undefined) return null;
  // AirGradient cloud API can answer an array of locations
  if (Array.isArray(data)) {
    for (const item of data) { const r = parseSensor(item); if (r) return r; }
    return null;
  }
  if (typeof data !== 'object') return null;
  // AirGradient local server /measures/current and cloud API
  if ('pm02' in data || 'pm02Compensated' in data) {
    const pm25 = asNum(data.pm02Compensated) !== null ? asNum(data.pm02Compensated) : asNum(data.pm02);
    if (pm25 !== null) {
      return { kind: 'airgradient', pm25: pm25, pm10: asNum(data.pm10), temp: asNum(data.atmpCompensated) !== null ? asNum(data.atmpCompensated) : asNum(data.atmp),
        hum: asNum(data.rhumCompensated) !== null ? asNum(data.rhumCompensated) : asNum(data.rhum), co2: asNum(data.rco2) };
    }
  }
  // PurpleAir local /json: channels A and B
  if ('pm2_5_atm' in data || 'pm2_5_atm_b' in data) {
    const pm25 = mean(asNum(data.pm2_5_atm), asNum(data.pm2_5_atm_b));
    if (pm25 !== null) {
      const f = asNum(data.current_temp_f);
      return { kind: 'purpleair', pm25: pm25, pm10: mean(asNum(data.pm10_0_atm), asNum(data.pm10_0_atm_b)),
        temp: f === null ? null : Math.round((f - 32) * 5 / 9 * 10) / 10, hum: asNum(data.current_humidity) };
    }
  }
  // PurpleAir API v1: {sensor:{"pm2.5_atm", "pm10.0_atm", ...}}
  if (data.sensor && typeof data.sensor === 'object' && ('pm2.5_atm' in data.sensor || 'pm2.5' in data.sensor || 'pm2.5_atm_a' in data.sensor)) {
    const s = data.sensor;
    const pm25 = asNum(s['pm2.5_atm']) !== null ? asNum(s['pm2.5_atm']) : asNum(s['pm2.5']) !== null ? asNum(s['pm2.5']) : mean(asNum(s['pm2.5_atm_a']), asNum(s['pm2.5_atm_b']));
    if (pm25 !== null) {
      const f = asNum(s.temperature);
      return { kind: 'purpleair', pm25: pm25, pm10: asNum(s['pm10.0_atm']) !== null ? asNum(s['pm10.0_atm']) : asNum(s['pm10.0']),
        temp: f === null ? null : Math.round((f - 32) * 5 / 9 * 10) / 10, hum: asNum(s.humidity), name: s.name };
    }
  }
  // Legacy PurpleAir map JSON: {results:[{PM2_5Value:"12.3"}]}
  if (Array.isArray(data.results) && data.results.length && data.results[0] && 'PM2_5Value' in data.results[0]) {
    const vals = data.results.map((r) => asNum(r.PM2_5Value)).filter((v) => v !== null);
    if (vals.length) return { kind: 'purpleair', pm25: vals.reduce((x, y) => x + y, 0) / vals.length, pm10: null };
  }
  // Sensor.Community (luftdaten): sensordatavalues [{value_type:"P2"|"SDS_P2", value}]
  const sdv = Array.isArray(data.sensordatavalues) ? data.sensordatavalues : null;
  if (sdv) {
    let pm25 = null, pm10 = null, temp = null, hum = null;
    for (const v of sdv) {
      const t = String(v.value_type || '');
      if (/(^|_)P2$/.test(t)) pm25 = asNum(v.value);
      else if (/(^|_)P1$/.test(t)) pm10 = asNum(v.value);
      else if (/temperature$/.test(t)) temp = asNum(v.value);
      else if (/humidity$/.test(t)) hum = asNum(v.value);
    }
    if (pm25 !== null) return { kind: 'sensor.community', pm25: pm25, pm10: pm10, temp: temp, hum: hum };
  }
  // Anything else: the first PM2.5-looking key, at any depth up to 4
  const pm25 = findKey(data, PM25_KEYS, 0);
  if (pm25 !== null) return { kind: 'json', pm25: pm25, pm10: findKey(data, PM10_KEYS, 0) };
  return null;
}

function sensorShape(r, scale, at) {
  const aqi = aqiFromPm(scale, r.pm25, r.pm10);
  const b = bandOf(scale, aqi) || { band: null, st: null };
  const out = {
    aqi: aqi, scale: scale, band: b.band, st: b.st, approx: true,
    pm25: Math.round(r.pm25 * 10) / 10, pm10: r.pm10 === null || r.pm10 === undefined ? null : Math.round(r.pm10 * 10) / 10,
    o3: null, no2: null, unit: 'µg/m³', source: 'sensor', kind: r.kind,
    credit: 'Your sensor (' + r.kind + ')', at: at,
  };
  if (r.temp !== null && r.temp !== undefined) out.temp = r.temp;
  if (r.hum !== null && r.hum !== undefined) out.hum = r.hum;
  if (r.co2 !== null && r.co2 !== undefined) out.co2 = r.co2;
  return out;
}

const SENSOR_MAX_CHARS = 1024 * 1024;

function sensorUrl(raw) {
  return U.checkScheme(raw, 'The sensor link').toString();
}

async function readSensor(c, raw, scale) {
  const url = sensorUrl(raw);
  const host = new URL(url).host;
  const r = await U.cached(c, 'sensor:' + url + ':' + scale, SENSOR_TTL, SENSOR_STALE, async () => {
    let res;
    try { res = await c.http(url, { method: 'GET', timeout: 10000 }); } catch (e) {
      throw U.httpError(502, 'Could not reach the sensor at ' + host + ' (' + U.netReason(e) + ')');
    }
    if (res.status < 200 || res.status >= 300) throw U.httpError(502, 'The sensor at ' + host + ' answered HTTP ' + res.status);
    if (U.declaredTooLarge(res, SENSOR_MAX_CHARS)) throw U.httpError(413, 'The sensor at ' + host + ' sent more than 1 MB');
    if (U.readText(res).length > SENSOR_MAX_CHARS) throw U.httpError(413, 'The sensor at ' + host + ' sent more than 1 MB');
    const j = U.readJson(res);
    if (j === null) throw U.httpError(422, 'The sensor link at ' + host + ' did not return JSON');
    const parsed = parseSensor(j);
    if (!parsed) {
      throw U.httpError(422, 'No PM2.5 value in the data from ' + host +
        '. Supported: AirGradient (/measures/current), PurpleAir (/json or the PurpleAir API), Sensor.Community, or JSON with a pm2.5 field.');
    }
    return sensorShape(parsed, scale, new Date(c.now()).toISOString());
  });
  return r.stale ? Object.assign({}, r.value, { stale: true, age_min: r.ageMin }) : r.value;
}

async function air(a, b) {
  const c = U.ctxOf(a, b);
  const s = c.settings;
  if (s.airOn === false) return U.reply(200, { off: true, reason: 'air quality is off' });
  const scale = pickScale(s);
  const city = require('./weather.js').cityOf(s);
  const year = new Date(c.now()).getUTCFullYear();
  const wantSensor = typeof s.airUrl === 'string' && s.airUrl.trim() !== '';
  if (!city && !wantSensor) return U.reply(200, { off: true, reason: 'no city' });

  let outdoor = null, outdoorErr = null, sensor = null, sensorErr = null;
  if (city) {
    try {
      const r = await U.cached(c, 'air:' + city.lat + ',' + city.lon + ':' + scale, AIR_TTL, AIR_STALE, async () =>
        shapeCams(await U.getJson(c, camsUrl(city), 'Open-Meteo air quality'), scale, year));
      outdoor = r.stale ? Object.assign({}, r.value, { stale: true, age_min: r.ageMin }) : r.value;
    } catch (e) { outdoorErr = e; }
  }
  if (wantSensor) {
    try { sensor = await readSensor(c, s.airUrl, scale); } catch (e) { sensorErr = e; }
  }
  if (outdoor) {
    const out = Object.assign({}, outdoor);
    if (wantSensor) out.sensor = sensor || { error: sensorErr.message, source: 'sensor' };
    return U.reply(200, out);
  }
  if (sensor) {
    const out = Object.assign({}, sensor);
    if (outdoorErr) out.outdoorError = outdoorErr.message;
    return U.reply(200, out);
  }
  const e = sensorErr || outdoorErr;
  return U.reply(e.status || 502, { error: e.message, source: sensorErr ? 'sensor' : 'open-meteo' });
}

module.exports = { routes: { air: air }, parseSensor, aqiFromPm, indexFor, bandOf, shapeCams, camsUrl, camsCredit, pickScale, withOffset };
