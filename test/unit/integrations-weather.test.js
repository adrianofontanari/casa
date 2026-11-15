'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./integrations-helpers.js');
const W = require('../../src/integrations/weather.js');

const SF = { name: 'San Francisco, California, United States', lat: 37.7749, lon: -122.4194 };

function omAnswer() {
  return {
    latitude: 37.77, longitude: -122.42, timezone: 'America/Los_Angeles', utc_offset_seconds: -28800,
    current: { time: '2026-11-09T09:15', temperature_2m: 13.6, apparent_temperature: 12.1, relative_humidity_2m: 81,
      weather_code: 3, is_day: 1, wind_speed_10m: 14.2, wind_direction_10m: 250, wind_gusts_10m: 30.1, surface_pressure: 1012.4, cloud_cover: 96 },
    daily: { time: ['2026-11-09'], sunrise: ['2026-11-09T06:44'], sunset: ['2026-11-09T17:04'], uv_index_max: [2.35] },
    hourly: { time: ['2026-11-09T08:00', '2026-11-09T09:00', '2026-11-09T10:00'], freezing_level_height: [2900, 2950, 3000], weather_code: [3, 61, 61] },
  };
}

test('weather: shape keeps the original keys the sky engine reads', () => {
  const units = W.unitsOf({ units: 'metric' });
  const w = W.shapeWeather(omAnswer(), W.cityOf({ city: SF }), units, Date.UTC(2026, 10, 9, 17));
  for (const k of ['temp', 'code', 'day', 'feels', 'hum', 'cloud', 'press', 'wind', 'uv', 'uv_band', 'uv_st', 'zero', 'code_hour', 'sun', 'moon', 'where', 'latlon', 'credit']) {
    assert.ok(k in w, 'missing ' + k);
  }
  assert.equal(w.temp, 14);
  assert.equal(w.code, 3);
  assert.equal(w.code_hour, 61, 'hourly code of the current hour');
  assert.equal(w.zero, 2950);
  assert.deepEqual(w.wind, { kmh: 14, gust: 30, dir: 'WSW', speed: 14, gustSpeed: 30, unit: 'km/h' });
  assert.deepEqual(w.sun, { rise: '06:44', set: '17:04', rise_h: 6.7333, set_h: 17.0667 });
  assert.equal(w.uv, 2.4);
  assert.equal(w.uv_band, 'low');
  assert.deepEqual(w.where, { name: SF.name, lat: 37.7749, lon: -122.4194 });
  assert.deepEqual(w.latlon, [37.7749, -122.4194]);
  assert.equal(w.credit, 'Weather data by Open-Meteo.com');
  assert.ok(['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent'].includes(w.moon.name));
});

test('weather: imperial asks Open-Meteo for °F and mph but keeps wind.kmh in km/h', () => {
  const units = W.unitsOf({ units: 'imperial' });
  assert.match(W.weatherUrl(W.cityOf({ city: SF }), units), /temperature_unit=fahrenheit&wind_speed_unit=mph/);
  const a = omAnswer(); a.current.wind_speed_10m = 10; a.current.wind_gusts_10m = 20;
  const w = W.shapeWeather(a, W.cityOf({ city: SF }), units, Date.now());
  assert.equal(w.wind.kmh, 16);
  assert.equal(w.wind.speed, 10);
  assert.equal(w.units.temp, '°F');
});

test('weather/forecast/geocode: off switches make zero requests', async () => {
  const http = H.fakeHttp({});
  for (const s of [{ city: null }, { city: SF, weatherOn: false }]) {
    const a = await W.routes.weather({ query: {} }, H.ctx(s, http));
    assert.equal(a.json.off, true);
    const b = await W.routes.forecast({ query: {} }, H.ctx(s, http));
    assert.equal(b.json.off, true);
  }
  const g = await W.routes.geocode({ query: { q: 'a' } }, H.ctx({}, http));
  assert.deepEqual(g.json.results, []);
  assert.equal(http.calls.length, 0);
});

test('weather: cached for 15 minutes, then stale for up to 3 hours when Open-Meteo fails', async () => {
  let now = Date.UTC(2026, 10, 9, 17);
  let fail = false;
  const http = H.fakeHttp({ 'https://api.open-meteo.com/': () => (fail ? new Error('offline') : { json: omAnswer() }) });
  const c = H.ctx({ city: SF }, http, { now: () => now });
  const r1 = await W.routes.weather({ query: {} }, c);
  assert.equal(r1.status, 200);
  await W.routes.weather({ query: {} }, c);
  assert.equal(http.calls.length, 1, 'second call within 15 min uses the cache');
  fail = true;
  now += 20 * 60 * 1000;
  const r3 = await W.routes.weather({ query: {} }, c);
  assert.equal(r3.status, 200);
  assert.equal(r3.json.stale, true);
  assert.equal(r3.json.age_min, 20);
  now += 3 * 3600 * 1000;
  const r4 = await W.routes.weather({ query: {} }, c);
  assert.equal(r4.status, 502);
  assert.match(r4.json.error, /Open-Meteo is unreachable/);
});

test('weather: an Open-Meteo error answer becomes a readable error', async () => {
  const http = H.fakeHttp({ 'https://api.open-meteo.com/': { status: 400, json: { error: true, reason: 'Latitude must be in range of -90 to 90°.' } } });
  const r = await W.routes.weather({ query: {} }, H.ctx({ city: SF }, http));
  assert.equal(r.status, 502);
  assert.match(r.json.error, /HTTP 400: Latitude must be/);
});

test('forecast: hourly starts at the current hour, daily has the contract keys', () => {
  const got = {
    timezone: 'Europe/Lisbon', utc_offset_seconds: 0, current: { time: '2026-11-09T10:15' },
    hourly: { time: ['2026-11-09T09:00', '2026-11-09T10:00', '2026-11-09T11:00'], temperature_2m: [15, 16, 17], weather_code: [1, 2, 3],
      precipitation_probability: [0, 10, null], precipitation: [0, 0.1, 0], wind_speed_10m: [5, 6, 7] },
    daily: { time: ['2026-11-09'], weather_code: [2], temperature_2m_max: [19.4], temperature_2m_min: [11.6], precipitation_probability_max: [20],
      sunrise: ['2026-11-09T07:12'], sunset: ['2026-11-09T17:28'], uv_index_max: [3.1], wind_speed_10m_max: [15] },
  };
  const f = W.shapeForecast(got, { name: 'Lisbon', lat: 38.72, lon: -9.14 }, W.unitsOf({}));
  assert.equal(f.hourly.length, 2);
  assert.deepEqual(f.hourly[0], { t: '2026-11-09T10:00', temp: 16, code: 2, pop: 10, precip: 0.1, wind: 6 });
  assert.equal(f.hourly[1].pop, 0, 'a null probability becomes 0');
  assert.deepEqual(f.daily[0], { date: '2026-11-09', min: 12, max: 19, code: 2, pop: 20, sunrise: '07:12', sunset: '17:28', uv: 3.1, wind: 15 });
});

test('LIVE: Open-Meteo weather, forecast and geocode for San Francisco', { skip: !H.LIVE && 'set LIVE=1' }, async () => {
  const log = [];
  const http = H.nodeHttp(log);
  const g = await W.routes.geocode({ query: { q: 'San Francisco' } }, H.ctx({}, http));
  assert.equal(g.status, 200, JSON.stringify(g.json));
  const sf = g.json.results.find((r) => r.country === 'United States' && r.admin1 === 'California');
  assert.ok(sf, 'San Francisco, California is in the results');
  const city = { name: sf.name + ', ' + sf.admin1, lat: sf.lat, lon: sf.lon };
  const w = await W.routes.weather({ query: {} }, H.ctx({ city: city, units: 'metric' }, http));
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal(typeof w.json.temp, 'number');
  assert.equal(typeof w.json.code, 'number');
  assert.ok(w.json.sun && w.json.sun.rise_h < w.json.sun.set_h);
  assert.equal(w.json.tz.name, 'America/Los_Angeles');
  const f = await W.routes.forecast({ query: {} }, H.ctx({ city: city, units: 'imperial' }, http));
  assert.equal(f.status, 200, JSON.stringify(f.json));
  assert.equal(f.json.daily.length, 7);
  assert.ok(f.json.hourly.length >= 20);
  assert.equal(f.json.units.temp, '°F');
  H.saveEvidence('live-weather-sf.json', { checked: new Date().toISOString(), requests: log, geocode: g.json.results.slice(0, 3), weather: w.json, forecast: { daily: f.json.daily, hourly: f.json.hourly.slice(0, 6), units: f.json.units } });
});
