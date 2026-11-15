'use strict';
// Floating times and the query window use the machine's zone: pin it for repeatable results.
process.env.TZ = 'America/Los_Angeles';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./integrations-helpers.js');
const I = require('../../src/integrations/ics.js');

const cal = () => I.parseICS(H.fixture('basic.ics'));
const between = (c, a, b) => I.eventsBetween(c, Date.parse(a), Date.parse(b), 'Test', '#123456');
const byTitle = (evs, t) => evs.filter((e) => e.title === t).map((e) => e.start);

test('ics: folding, escapes, calendar name and colour', () => {
  const c = cal();
  assert.equal(c.name, 'Work, team');
  assert.equal(c.color, '#ff2968');
  const evs = between(c, '2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z');
  const s = evs.find((e) => e.title === 'Standup, daily sync');
  assert.ok(s, 'folded and unescaped title');
  assert.equal(s.location, 'Room 4; floor 2');
  assert.deepEqual([s.start, s.end], ['2026-11-10T17:00:00.000Z', '2026-11-10T17:30:00.000Z']);
  const e = between(c, '2026-11-14T00:00:00Z', '2026-11-15T00:00:00Z').find((x) => x.title.indexOf('Dinner') === 0);
  assert.equal(e.title, 'Dinner; then \\ backslash line two');
  assert.equal(between(c, '2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z').some((x) => x.title === 'Never shown'), false, 'STATUS:CANCELLED is dropped');
});

test('ics: TZID across a DST change, Windows names, custom VTIMEZONE, X-WR-TIMEZONE for floating times', () => {
  const c = cal();
  const evs = between(c, '2026-10-25T00:00:00Z', '2026-12-31T00:00:00Z');
  assert.deepEqual(byTitle(evs, 'Across the DST change'), ['2026-10-30T13:00:00.000Z', '2026-11-06T14:00:00.000Z', '2026-11-13T14:00:00.000Z']);
  assert.deepEqual(byTitle(evs, 'Outlook zone name'), ['2026-11-10T09:00:00.000Z']);
  assert.deepEqual(byTitle(evs, 'Custom zone in winter'), ['2026-12-10T09:00:00.000Z']);
  assert.deepEqual(byTitle(evs, 'Floating time uses X-WR-TIMEZONE'), ['2026-11-13T13:00:00.000Z']);
  assert.deepEqual(byTitle(between(c, '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'), 'Custom zone in summer'), ['2026-07-15T08:00:00.000Z']);
});

test('ics: all-day and DURATION', () => {
  const evs = between(cal(), '2026-11-11T08:00:00Z', '2026-11-16T08:00:00Z');
  const hol = evs.find((e) => e.title === 'Holiday');
  assert.deepEqual([hol.start, hol.end, hol.allDay, hol.days], ['2026-11-11', '2026-11-12', true, 1]);
  const trip = evs.find((e) => e.title === 'Trip');
  assert.deepEqual([trip.start, trip.end, trip.days], ['2026-11-12', '2026-11-15', 3]);
  const w = evs.find((e) => e.title === 'Workshop');
  assert.deepEqual([w.start, w.end], ['2026-11-12T15:00:00.000Z', '2026-11-12T16:30:00.000Z']);
  // a window that starts the local day after the holiday does not show it
  assert.equal(between(cal(), '2026-11-12T08:00:00Z', '2026-11-13T08:00:00Z').some((e) => e.title === 'Holiday'), false);
});

test('ics: RRULE weekly/monthly/yearly with INTERVAL, BYDAY, COUNT, UNTIL, EXDATE, RECURRENCE-ID, RDATE', () => {
  const c = cal();
  const evs = between(c, '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z');
  assert.deepEqual(byTitle(evs, 'Every other week'), ['2026-11-02T09:00:00.000Z', '2026-11-16T09:00:00.000Z', '2026-11-18T09:00:00.000Z']);
  assert.deepEqual(byTitle(evs, 'Last Friday'), ['2026-09-26T01:00:00.000Z', '2026-10-31T01:00:00.000Z', '2026-11-28T02:00:00.000Z', '2026-12-26T02:00:00.000Z']);
  assert.deepEqual(byTitle(evs, 'Month end'), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
  assert.deepEqual(byTitle(evs, 'Fourth Thursday'), ['2026-11-26']);
  assert.deepEqual(byTitle(evs, 'Lunch'), ['2026-11-09T12:00:00.000Z', '2026-11-11T12:00:00.000Z']);
  assert.deepEqual(byTitle(evs, 'Lunch (moved)'), ['2026-11-10T15:00:00.000Z']);
  assert.deepEqual(byTitle(evs, 'Extra dates'), ['2026-11-16T07:00:00.000Z', '2026-11-17T07:00:00.000Z', '2026-11-19T07:00:00.000Z']);
  const hourly = evs.filter((e) => e.title === 'Unsupported rule');
  assert.equal(hourly.length, 1);
  assert.equal(hourly[0].partial, true);
  assert.ok(Array.from(c.warnings).some((w) => /unsupported RRULE part FREQ=HOURLY/.test(w)));
  assert.deepEqual(byTitle(between(c, '2027-01-01T00:00:00Z', '2029-01-01T00:00:00Z'), 'Leap day'), ['2028-02-29']);
});

test('ics: DTSTART in 1900 with FREQ=DAILY jumps to the window, COUNT still counts from 1900', () => {
  const mk = (rule) => I.parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:old\r\nDTSTART;TZID=Europe/Paris:19000101T070000\r\nDTEND;TZID=Europe/Paris:19000101T073000\r\n' +
    'RRULE:' + rule + '\r\nSUMMARY:Old\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  let t = Date.now();
  const daily = between(mk('FREQ=DAILY'), '2026-11-09T08:00:00Z', '2026-11-12T08:00:00Z');
  assert.ok(Date.now() - t < 200, 'fast: ' + (Date.now() - t) + ' ms');
  // 07:00 in Paris is 06:00Z: the 9th ends before the window opens at 08:00Z
  assert.deepEqual(daily.map((e) => e.start), ['2026-11-10T06:00:00.000Z', '2026-11-11T06:00:00.000Z', '2026-11-12T06:00:00.000Z']);
  // 1900-01-01 + 46,000 days = 2025-12-11: COUNT=46001 ends that day
  assert.deepEqual(between(mk('FREQ=DAILY;COUNT=46001'), '2025-12-10T00:00:00Z', '2025-12-14T08:00:00Z').map((e) => e.start.slice(0, 10)), ['2025-12-10', '2025-12-11']);
  t = Date.now();
  const wk = between(mk('FREQ=WEEKLY;BYDAY=MO,TH;COUNT=13000'), '2024-07-15T00:00:00Z', '2024-08-05T00:00:00Z');
  assert.ok(Date.now() - t < 200, 'weekly with COUNT is arithmetic');
  // 13,000 Mondays and Thursdays from Mon 1900-01-01: the last one is Thu 2024-07-25
  assert.deepEqual(wk.map((e) => e.start.slice(0, 10)), ['2024-07-15', '2024-07-18', '2024-07-22', '2024-07-25']);
  const byday = between(mk('FREQ=DAILY;BYDAY=SA;COUNT=6000'), '2015-01-01T08:00:00Z', '2015-01-20T08:00:00Z');
  // 6,000 Saturdays from 1900-01-06 end on 2014-12-27, so nothing in January 2015
  assert.deepEqual(byday, []);
});

test('ics: budgets and caps', () => {
  const lines = ['BEGIN:VCALENDAR'];
  for (let i = 0; i < 100000; i++) lines.push('BEGIN:VEVENT', 'UID:e' + i, 'DTSTART:20261110T' + String(i % 24).padStart(2, '0') + '0000Z', 'SUMMARY:E' + i, 'END:VEVENT');
  lines.push('END:VCALENDAR');
  let t = Date.now();
  const big = I.parseICS(lines.join('\r\n'));
  const parseMs = Date.now() - t;
  assert.equal(big.events.length, 5000);
  assert.ok(Array.from(big.warnings).some((w) => /only the first 5000 events/.test(w)));
  assert.ok(parseMs < 3000, 'parse of 100k events took ' + parseMs + ' ms');
  // a rule that cannot be skipped arithmetically (BYMONTH) stops at the budget and says so
  const c = I.parseICS('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:19000101T070000Z\r\nRRULE:FREQ=DAILY;BYMONTH=1;COUNT=9999999\r\nSUMMARY:X\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  t = Date.now();
  const evs = I.eventsBetween(c, Date.parse('2026-01-01T00:00:00Z'), Date.parse('2026-01-03T00:00:00Z'), 'T', '#000', { left: 1000 });
  assert.ok(Date.now() - t < 200);
  assert.ok(evs.every((e) => e.partial));
  assert.ok(Array.from(c.warnings).some((w) => /recurrence budget reached/.test(w)));
});

test('ics: webcal, schemes, size cap, bad answers, secret links never in errors', async () => {
  const SECRET = 'https://cal.example.com/private/SECRET123/basic.ics';
  const http = H.fakeHttp({
    'https://cal.example.com/ok.ics': { text: H.fixture('basic.ics'), headers: { 'content-type': 'text/calendar' } },
    'https://cal.example.com/private/': new Error('Request timed out after 20000 ms: ' + SECRET),
    'https://cal.example.com/html': { text: '<!doctype html><title>login</title>' },
    'https://cal.example.com/forbidden': { status: 403, text: 'no' },
    'https://cal.example.com/declared-big': { text: 'BEGIN:VCALENDAR', headers: { 'Content-Length': String(6 * 1024 * 1024) } },
    'https://cal.example.com/big': { text: 'BEGIN:VCALENDAR\r\n' + 'X'.repeat(5 * 1024 * 1024) },
  });
  assert.equal(I.fetchUrl('webcal://cal.example.com/ok.ics'), 'https://cal.example.com/ok.ics');
  for (const bad of ['file:///etc/hosts', 'javascript:alert(1)', 'ftp://cal.example.com/a.ics', 'data:text/calendar,BEGIN']) {
    assert.throws(() => I.fetchUrl(bad), /must start with https:\/\/, http:\/\/ or webcal:\/\//);
  }
  const settings = { calendarUrl: 'webcal://cal.example.com/ok.ics, ' + SECRET + ', https://cal.example.com/html, https://cal.example.com/forbidden, https://cal.example.com/declared-big, https://cal.example.com/big, file:///etc/hosts' };
  const r = await I.routes.calendar({ query: { from: '2026-11-09', to: '2026-11-15' } }, H.ctx(settings, http));
  assert.equal(r.status, 200, 'one good calendar is enough for 200');
  assert.ok(r.json.events.length > 5);
  assert.equal(r.json.cals[0].name, 'Work, team');
  assert.equal(r.json.cals[0].color, '#ff2968');
  const errs = r.json.cals.slice(1).map((x) => x.error);
  assert.deepEqual(errs, [
    'Could not reach the calendar (timed out)',
    'The link did not return a calendar (ICS) file',
    'The calendar refused access (HTTP 403). Use the secret or public iCal address.',
    'The calendar is larger than 5 MB',
    'The calendar is larger than 5 MB',
    'Calendar links must start with https://, http:// or webcal://',
  ]);
  const all = JSON.stringify(r.json);
  assert.equal(all.indexOf('SECRET'), -1, 'the secret path never reaches the room');
  assert.equal(all.indexOf('/private/'), -1);
  assert.ok(!http.calls.some((u) => /^file:/.test(u)));
  const off = await I.routes.calendar({ query: {} }, H.ctx({ calendarUrl: '' }, http));
  assert.equal(off.json.off, true);
  const before = http.calls.length;
  await I.routes.calendar({ query: {} }, H.ctx({ calendarUrl: '   ' }, http));
  assert.equal(http.calls.length, before, 'empty link: no request');
  const bad = await I.routes.calendar({ query: { from: '2026-13-01', to: '2026-11-15' } }, H.ctx({ calendarUrl: 'https://cal.example.com/ok.ics' }, http));
  assert.equal(bad.status, 400);
  const long = await I.routes.calendar({ query: { from: '2026-01-01', to: '2028-01-01' } }, H.ctx({ calendarUrl: 'https://cal.example.com/ok.ics' }, http));
  assert.equal(long.status, 400);
  const only = await I.routes.calendar({ query: {} }, H.ctx({ calendarUrl: SECRET }, http));
  assert.equal(only.status, 502);
  assert.equal(JSON.stringify(only.json).indexOf('SECRET'), -1);
});

test('LIVE: public ICS feeds from Google and iCloud (webcal), with live RRULEs', { skip: !H.LIVE && 'set LIVE=1' }, async () => {
  const log = [];
  const http = H.nodeHttp(log);
  const google = 'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics';
  const icloud = 'webcal://calendars.icloud.com/holidays/us_en.ics';
  const r = await I.routes.calendar({ query: { from: '2026-11-01', to: '2027-01-31' } }, H.ctx({ calendarUrl: google + ',' + icloud }, http));
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
  assert.equal(r.json.error, null);
  assert.deepEqual(r.json.cals.map((c) => c.name), ['Holidays in United States', 'US Holidays']);
  const days = (cal, t) => r.json.events.filter((e) => e.cal === cal && /Thanksgiving|Christmas Day|New Year/.test(e.title)).map((e) => e.title + ' ' + e.start);
  const g = days('Holidays in United States');
  const a = days('US Holidays');
  assert.ok(g.includes('Thanksgiving Day 2026-11-26'), g.join(' | '));
  assert.ok(a.some((x) => /Thanksgiving.* 2026-11-26/.test(x)), a.join(' | '));
  assert.ok(a.some((x) => /Christmas.* 2026-12-25/.test(x)), a.join(' | '));
  assert.ok(r.json.events.every((e) => e.allDay));
  assert.ok(log.includes('https://calendars.icloud.com/holidays/us_en.ics'), 'webcal was fetched as https');
  H.saveEvidence('live-calendar.json', { checked: new Date().toISOString(), requests: log, cals: r.json.cals, sample: r.json.events.slice(0, 30), error: r.json.error });
});
