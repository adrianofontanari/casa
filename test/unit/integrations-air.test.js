'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./integrations-helpers.js');
const A = require('../../src/integrations/air.js');

const SF = { name: 'San Francisco', lat: 37.7749, lon: -122.4194 };

// Shapes taken from each vendor's documentation (see docs/dev/routes.md, Air sensor links).
const AIRGRADIENT_LOCAL = { pm01: 3, pm02: 7, pm10: 8, pm003Count: 442, atmp: 25.87, atmpCompensated: 24.47, rhum: 43, rhumCompensated: 49, rco2: 447, tvocIndex: 100, noxIndex: 1, wifi: -51, serialno: 'ecda3b1eaaaf' };
const AIRGRADIENT_CLOUD = [{ locationId: 1, pm02: 12.5, pm10: 20, atmp: 18, rhum: 60, rco2: 600, timestamp: '2026-11-09T10:00:00.000Z' }];
const PURPLEAIR_LOCAL = { SensorId: 'aa:bb', current_temp_f: 70, current_humidity: 40, pm2_5_atm: 10.2, pm2_5_atm_b: 11.8, pm10_0_atm: 14, pm10_0_atm_b: 16, 'pm2.5_aqi': 55 };
const PURPLEAIR_API = { api_version: 'V1.0.11', sensor: { sensor_index: 1234, name: 'Backyard', 'pm2.5_atm': 22.4, 'pm10.0_atm': 30.1, humidity: 35, temperature: 77 } };
const SENSOR_COMMUNITY = [{ sensordatavalues: [{ value_type: 'P1', value: '18.40' }, { value_type: 'P2', value: '6.10' }], sensor: { sensor_type: { name: 'SDS011' } } }];
const GENERIC = { device: 'x', data: { readings: { 'PM2.5': '15', PM10: 25 } } };

test('air: sensor parsers read each vendor format', () => {
  assert.deepEqual(A.parseSensor(AIRGRADIENT_LOCAL), { kind: 'airgradient', pm25: 7, pm10: 8, temp: 24.47, hum: 49, co2: 447 });
  assert.equal(A.parseSensor(Object.assign({}, AIRGRADIENT_LOCAL, { pm02Compensated: 5.5 })).pm25, 5.5, 'compensated value wins');
  assert.equal(A.parseSensor(AIRGRADIENT_CLOUD).pm25, 12.5);
  const pa = A.parseSensor(PURPLEAIR_LOCAL);
  assert.equal(pa.kind, 'purpleair');
  assert.equal(pa.pm25, 11, 'mean of channels A and B');
  assert.equal(pa.pm10, 15);
  assert.equal(pa.temp, 21.1);
  assert.equal(A.parseSensor(PURPLEAIR_API).pm25, 22.4);
  assert.equal(A.parseSensor({ results: [{ PM2_5Value: '8.0' }, { PM2_5Value: '10.0' }] }).pm25, 9);
  assert.deepEqual(A.parseSensor(SENSOR_COMMUNITY), { kind: 'sensor.community', pm25: 6.1, pm10: 18.4, temp: null, hum: null });
  assert.deepEqual(A.parseSensor(GENERIC), { kind: 'json', pm25: 15, pm10: 25 });
  assert.equal(A.parseSensor({ pm1: 3, temperature: 20 }), null);
  assert.equal(A.parseSensor('not json'), null);
});

test('air: index bands follow the EEA 2024 and US EPA tables documented by Open-Meteo', () => {
  assert.equal(A.indexFor('eu', 'pm25', 5), 20);
  assert.equal(A.indexFor('eu', 'pm25', 10), 30);
  assert.equal(A.indexFor('eu', 'pm25', 140), 100);
  assert.equal(A.indexFor('us', 'pm25', 9), 50);
  assert.equal(A.indexFor('us', 'pm25', 35.5), 100);
  assert.equal(A.indexFor('us', 'pm10', 155), 100);
  assert.equal(A.indexFor('us', 'pm25', 9999), 500);
  assert.equal(A.bandOf('eu', 19).band, 'good');
  assert.equal(A.bandOf('eu', 20).band, 'fair');
  assert.equal(A.bandOf('eu', 130).band, 'extremely poor');
  assert.equal(A.bandOf('us', 120).band, 'unhealthy for sensitive groups');
  assert.equal(A.bandOf('us', 420).band, 'hazardous');
});

test('air: airOn false and no source make zero requests', async () => {
  const http = H.fakeHttp({});
  assert.equal((await A.routes.air({}, H.ctx({ airOn: false, city: SF, airUrl: 'http://192.168.1.5/measures/current' }, http))).json.off, true);
  assert.equal((await A.routes.air({}, H.ctx({ city: null, airUrl: '' }, http))).json.off, true);
  assert.equal(http.calls.length, 0);
});

test('air: city data from CAMS, with the Copernicus notice and year', async () => {
  const http = H.fakeHttp({ 'https://air-quality-api.open-meteo.com/': { json: { utc_offset_seconds: -28800, current: { time: '2026-11-09T10:00', european_aqi: 27, us_aqi: 41, pm2_5: 6.6, pm10: 10.2, ozone: 52, nitrogen_dioxide: 12.3 } } } });
  const r = await A.routes.air({}, H.ctx({ city: SF }, http, { now: () => Date.UTC(2026, 10, 9) }));
  assert.equal(r.status, 200);
  assert.equal(r.json.aqi, 27);
  assert.equal(r.json.scale, 'eu');
  assert.equal(r.json.band, 'fair');
  assert.equal(r.json.source, 'open-meteo');
  assert.equal(r.json.at, '2026-11-09T10:00-08:00');
  assert.match(r.json.notice, /Contains modified Copernicus Atmosphere Monitoring Service information 2026/);
  assert.match(r.json.notice, /Neither the European Commission nor ECMWF is responsible/);
  const us = await A.routes.air({}, H.ctx({ city: SF, units: 'imperial' }, http));
  assert.equal(us.json.scale, 'us');
  assert.equal(us.json.aqi, 41);
  assert.equal(us.json.band, 'good');
  assert.ok(http.calls[0].includes('current=european_aqi,us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide'));
});

test('air: sensor next to the city reading, and alone without a city', async () => {
  const http = H.fakeHttp({
    'https://air-quality-api.open-meteo.com/': { json: { current: { european_aqi: 30, us_aqi: 40, pm2_5: 7 } } },
    'http://192.168.1.50/measures/current': { json: AIRGRADIENT_LOCAL },
  });
  const both = await A.routes.air({}, H.ctx({ city: SF, airUrl: 'http://192.168.1.50/measures/current' }, http));
  assert.equal(both.json.source, 'open-meteo');
  assert.equal(both.json.sensor.source, 'sensor');
  assert.equal(both.json.sensor.pm25, 7);
  assert.equal(both.json.sensor.aqi, 24, 'EU: pm2.5 7 is 20 + 2/10 of the fair band');
  assert.equal(both.json.sensor.approx, true);
  const alone = await A.routes.air({}, H.ctx({ city: null, airUrl: 'http://192.168.1.50/measures/current' }, http));
  assert.equal(alone.json.source, 'sensor');
  assert.equal(alone.json.kind, 'airgradient');
});

test('air: clear errors for unreachable, HTTP error, not JSON, unknown format, bad scheme, too large', async () => {
  const big = 'x'.repeat(1024 * 1024 + 10);
  const http = H.fakeHttp({
    'http://10.0.0.9/': new Error('connect ECONNREFUSED 10.0.0.9:80'),
    'https://sensor.example/404': { status: 404, text: 'nope' },
    'https://sensor.example/html': { text: '<!doctype html><p>hi' },
    'https://sensor.example/other': { json: { temperature: 21 } },
    'https://sensor.example/big': { text: '{"pm25": 1, "pad": "' + big + '"}' },
    'https://sensor.example/declared': { json: { pm25: 1 }, headers: { 'content-length': String(2 * 1024 * 1024) } },
    'https://api.purpleair.com/': new Error('Request timed out after 10000 ms: https://api.purpleair.com/v1/sensors/1?api_key=SECRETKEY'),
  });
  const cases = [
    ['http://10.0.0.9/measures/current', 502, /^Could not reach the sensor at 10\.0\.0\.9 \(connection refused\)$/],
    ['https://sensor.example/declared', 413, /more than 1 MB/],
    ['https://api.purpleair.com/v1/sensors/1?api_key=SECRETKEY', 502, /^Could not reach the sensor at api\.purpleair\.com \(timed out\)$/],
    ['https://sensor.example/404', 502, /answered HTTP 404/],
    ['https://sensor.example/html', 422, /did not return JSON/],
    ['https://sensor.example/other', 422, /No PM2\.5 value .* Supported: AirGradient/],
    ['https://sensor.example/big', 413, /more than 1 MB/],
    ['file:///etc/passwd', 400, /must start with https:\/\/ or http:\/\//],
    ['javascript:alert(1)', 400, /must start with https:\/\/ or http:\/\//],
    ['ftp://example.com/x.json', 400, /must start with https:\/\/ or http:\/\//],
    ['not a url', 400, /not a valid URL/],
  ];
  for (const [url, status, re] of cases) {
    const r = await A.routes.air({}, H.ctx({ city: null, airUrl: url }, http));
    assert.equal(r.status, status, url + ' -> ' + JSON.stringify(r.json));
    assert.match(r.json.error, re);
    assert.equal(r.json.source, 'sensor');
    assert.equal(JSON.stringify(r.json).indexOf('SECRETKEY'), -1, 'no key in the error');
  }
  assert.ok(!http.calls.some((u) => /^(file|javascript|ftp):/.test(u)), 'rejected schemes are never fetched');
  const withCity = await A.routes.air({}, H.ctx({ city: SF, airUrl: 'https://sensor.example/other' }, H.fakeHttp({
    'https://air-quality-api.open-meteo.com/': { json: { current: { european_aqi: 30 } } },
    'https://sensor.example/other': { json: { temperature: 21 } },
  })));
  assert.equal(withCity.status, 200, 'the city reading still shows when the sensor fails');
  assert.match(withCity.json.sensor.error, /No PM2\.5 value/);
});

test('LIVE: Open-Meteo air quality (CAMS) for San Francisco and a public Sensor.Community sensor', { skip: !H.LIVE && 'set LIVE=1' }, async () => {
  const log = [];
  const http = H.nodeHttp(log);
  const r = await A.routes.air({}, H.ctx({ city: SF }, http));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  for (const k of ['aqi', 'eu', 'us', 'pm25', 'pm10', 'o3', 'no2']) assert.equal(typeof r.json[k], 'number', k + ' is a number');
  // A public Sensor.Community sensor near a city, through the generic "paste your sensor link" path
  const area = 'https://data.sensor.community/airrohr/v1/filter/area=52.52,13.40,5';
  const list = (await http(area, { timeout: 30000 })).json;
  assert.ok(Array.isArray(list) && list.length, 'Sensor.Community answered a list');
  const withPm = list.find((x) => (x.sensordatavalues || []).some((v) => v.value_type === 'P2'));
  assert.ok(withPm, 'a sensor with PM2.5 exists');
  const one = 'https://data.sensor.community/airrohr/v1/sensor/' + withPm.sensor.id + '/';
  const s = await A.routes.air({}, H.ctx({ city: null, airUrl: one }, http));
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.kind, 'sensor.community');
  assert.equal(typeof s.json.pm25, 'number');
  const bad = await A.routes.air({}, H.ctx({ city: null, airUrl: 'https://example.com/' }, http));
  assert.equal(bad.status, 422);
  const dead = await A.routes.air({}, H.ctx({ city: null, airUrl: 'https://casa-no-such-host.invalid/json' }, http));
  assert.equal(dead.status, 502);
  H.saveEvidence('live-air.json', { checked: new Date().toISOString(), requests: log.filter((u) => u !== area), cams: r.json, sensorCommunity: s.json, unknownFormat: bad.json, unreachable: dead.json });
});
