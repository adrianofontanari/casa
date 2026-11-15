/* ICS calendars (Google, Outlook, iCloud or any iCalendar link) for /api/calendar.

   Parser coverage: line folding, escaped text, VEVENT, DTSTART/DTEND with UTC, TZID (IANA,
   Windows zone names, or the feed's own VTIMEZONE rules) and floating times, all-day events,
   DURATION, RRULE (FREQ DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY with
   ordinals, BYMONTHDAY, BYMONTH, BYSETPOS, WKST), RDATE, EXDATE, RECURRENCE-ID overrides,
   STATUS:CANCELLED, X-WR-CALNAME, X-WR-TIMEZONE, X-APPLE-CALENDAR-COLOR and COLOR.
   Not supported: BYYEARDAY, BYWEEKNO, BYHOUR/BYMINUTE/BYSECOND, FREQ below DAILY
   (those rules fall back to the first occurrence only, and the event is flagged).

   Output times: timed events as ISO strings in UTC ("2026-11-09T09:30:00.000Z"); all-day
   events as "YYYY-MM-DD" with an EXCLUSIVE end date, as in iCalendar (a one-day event on the
   9th has end "2026-11-10"), plus `days`. */
'use strict';

const U = require('./util.js');

const TTL = 15 * 60 * 1000;
const STALE = 6 * 3600 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RANGE_DAYS = 400;
const MAX_PERIODS = 50000;      // default iteration budget for one rule when none is given
const FEED_BUDGET = 200000;     // rule periods walked per calendar per request
const REQUEST_BUDGET = 400000;  // rule periods walked per /api/calendar request, all calendars
const MAX_VEVENTS = 5000;       // VEVENTs read from one feed
const MAX_OUT = 5000;           // events returned per calendar
const PALETTE = ['#4f7fd9', '#d97a4f', '#5aa469', '#b65fcf', '#d9b44f', '#4fb3b3', '#d95f7f', '#8a8f4f'];
const DAY = 86400000;
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// ---------------------------------------------------------------- lexing

function unfold(text) {
  const lines = [];
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if ((raw[0] === ' ' || raw[0] === '\t') && lines.length) lines[lines.length - 1] += raw.slice(1);
    else if (raw.length) lines.push(raw);
  }
  return lines;
}

function parseLine(line) {
  let i = 0, inQ = false;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === ':' && !inQ) break;
  }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts = [];
  let cur = '', q = false;
  for (const ch of head) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ';' && !q) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  const params = {};
  for (const p of parts.slice(1)) {
    const k = p.indexOf('=');
    if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1);
  }
  return { name: parts[0].toUpperCase(), params: params, value: value };
}

function unescapeText(s) {
  return String(s).replace(/\\([\\;,nN])/g, (m, c) => (c === 'n' || c === 'N' ? ' ' : c)).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- time zones

const WINDOWS_ZONES = {
  'dateline standard time': 'Etc/GMT+12', 'hawaiian standard time': 'Pacific/Honolulu', 'alaskan standard time': 'America/Anchorage',
  'pacific standard time': 'America/Los_Angeles', 'us mountain standard time': 'America/Phoenix', 'mountain standard time': 'America/Denver',
  'central standard time': 'America/Chicago', 'central standard time (mexico)': 'America/Mexico_City', 'canada central standard time': 'America/Regina',
  'eastern standard time': 'America/New_York', 'us eastern standard time': 'America/Indianapolis', 'atlantic standard time': 'America/Halifax',
  'newfoundland standard time': 'America/St_Johns', 'sa pacific standard time': 'America/Bogota', 'e. south america standard time': 'America/Sao_Paulo',
  'argentina standard time': 'America/Buenos_Aires', 'pacific sa standard time': 'America/Santiago', 'utc': 'UTC', 'coordinated universal time': 'UTC',
  'gmt standard time': 'Europe/London', 'greenwich standard time': 'Atlantic/Reykjavik', 'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest', 'central european standard time': 'Europe/Warsaw', 'romance standard time': 'Europe/Paris',
  'e. europe standard time': 'Europe/Chisinau', 'fle standard time': 'Europe/Kiev', 'gtb standard time': 'Europe/Bucharest',
  'russian standard time': 'Europe/Moscow', 'turkey standard time': 'Europe/Istanbul', 'israel standard time': 'Asia/Jerusalem',
  'egypt standard time': 'Africa/Cairo', 'south africa standard time': 'Africa/Johannesburg', 'w. central africa standard time': 'Africa/Lagos',
  'morocco standard time': 'Africa/Casablanca', 'arab standard time': 'Asia/Riyadh', 'arabian standard time': 'Asia/Dubai', 'iran standard time': 'Asia/Tehran',
  'pakistan standard time': 'Asia/Karachi', 'india standard time': 'Asia/Kolkata', 'bangladesh standard time': 'Asia/Dhaka',
  'se asia standard time': 'Asia/Bangkok', 'china standard time': 'Asia/Shanghai', 'singapore standard time': 'Asia/Singapore',
  'taipei standard time': 'Asia/Taipei', 'tokyo standard time': 'Asia/Tokyo', 'korea standard time': 'Asia/Seoul',
  'w. australia standard time': 'Australia/Perth', 'cen. australia standard time': 'Australia/Adelaide', 'e. australia standard time': 'Australia/Brisbane',
  'aus eastern standard time': 'Australia/Sydney', 'new zealand standard time': 'Pacific/Auckland',
  'tzone://microsoft/utc': 'UTC', 'tzone://microsoft/custom': null,
};

const fmtCache = new Map();
function ianaValid(tz) {
  if (!tz) return false;
  if (fmtCache.has(tz)) return true;
  try {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
    return true;
  } catch (e) { return false; }
}

/* Offset of an IANA zone at a UTC instant, in ms (positive east of Greenwich). */
function ianaOffset(ms, tz) {
  const parts = fmtCache.get(tz).formatToParts(new Date(ms));
  const g = {};
  for (const p of parts) g[p.type] = +p.value;
  return Date.UTC(g.year, g.month - 1, g.day, g.hour === 24 ? 0 : g.hour, g.minute, g.second) - Math.floor(ms / 1000) * 1000;
}

function offsetSeconds(s) {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(String(s || '').trim());
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (+m[2] * 3600 + +m[3] * 60 + +(m[4] || 0));
}

function cleanTzid(raw) {
  let t = String(raw || '').replace(/^"|"$/g, '').trim();
  if (ianaValid(t)) return t;
  const m = /([A-Za-z]+\/[A-Za-z_+\-]+(?:\/[A-Za-z_+\-]+)?)$/.exec(t);
  if (m && ianaValid(m[1])) return m[1];
  const w = WINDOWS_ZONES[t.toLowerCase()];
  if (w && ianaValid(w)) return w;
  return null;
}

/* A zone resolver: {kind:'utc'|'iana'|'vtz'|'floating', ...} */
function resolveZone(tzid, cal) {
  if (!tzid) return cal.defaultZone || { kind: 'floating' };
  const key = String(tzid).replace(/^"|"$/g, '');
  if (cal.zoneCache[key]) return cal.zoneCache[key];
  let z;
  const iana = cleanTzid(key);
  if (iana === 'UTC' || iana === 'Etc/UTC') z = { kind: 'utc' };
  else if (iana) z = { kind: 'iana', tz: iana };
  else if (cal.vtimezones[key]) z = { kind: 'vtz', def: cal.vtimezones[key] };
  else { z = { kind: 'floating' }; cal.warnings.add('unknown time zone ' + key); }
  cal.zoneCache[key] = z;
  return z;
}

/* Wall-clock time (as a fake-UTC ms) in a zone -> real UTC ms. */
function wallToUtc(wallMs, zone) {
  if (!zone || zone.kind === 'utc') return wallMs;
  if (zone.kind === 'floating') {
    const d = new Date(wallMs);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
  }
  if (zone.kind === 'iana') {
    const o1 = ianaOffset(wallMs, zone.tz);
    let utc = wallMs - o1;
    const o2 = ianaOffset(utc, zone.tz);
    if (o2 !== o1) utc = wallMs - o2;
    return utc;
  }
  return wallMs - vtzOffset(wallMs, zone.def) * 1000;
}

/* Offset (seconds) a VTIMEZONE gives a wall time: the latest STANDARD/DAYLIGHT onset wins. */
function vtzOffset(wallMs, def) {
  let best = null, bestAt = -Infinity, earliest = null;
  for (const comp of def) {
    if (!earliest || comp.start < earliest.start) earliest = comp;
    const onsets = [];
    if (comp.rrule) {
      const y = new Date(wallMs).getUTCFullYear();
      for (const yy of [y - 1, y]) {
        for (const t of yearlyOnsets(comp, yy)) onsets.push(t);
      }
    }
    onsets.push(comp.start);
    for (const t of comp.rdates) onsets.push(t);
    for (const t of onsets) {
      if (t <= wallMs && t >= comp.start && t > bestAt) {
        if (comp.rrule && comp.rrule.until !== null && t > comp.rrule.untilWall) continue;
        bestAt = t; best = comp;
      }
    }
  }
  if (best) return best.offsetTo;
  return earliest ? earliest.offsetFrom : 0;
}

function yearlyOnsets(comp, year) {
  const r = comp.rrule;
  const s = new Date(comp.start);
  const months = r.bymonth.length ? r.bymonth : [s.getUTCMonth() + 1];
  const out = [];
  for (const m of months) {
    let days;
    if (r.byday.length) days = monthDaysByDay(year, m, r.byday);
    else if (r.bymonthday.length) days = monthDaysByMonthDay(year, m, r.bymonthday);
    else days = [s.getUTCDate()];
    for (const d of days) out.push(Date.UTC(year, m - 1, d, s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds()));
  }
  return out;
}

// ---------------------------------------------------------------- dates

/* -> {wall, allDay, zone, utc} */
function parseDate(prop, cal) {
  if (!prop) return null;
  const v = String(prop.value).trim().split(',')[0];
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m || (prop.params.VALUE && prop.params.VALUE.toUpperCase() === 'DATE')) {
    m = m || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return { wall: wall, allDay: true, zone: { kind: 'utc' }, utc: wall };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(v);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const zone = m[7] ? { kind: 'utc' } : resolveZone(prop.params.TZID, cal);
  return { wall: wall, allDay: false, zone: zone, utc: wallToUtc(wall, zone) };
}

function parseDateList(prop, cal) {
  const out = [];
  for (const v of String(prop.value).split(',')) {
    const d = parseDate({ value: v, params: prop.params }, cal);
    if (d) out.push(d);
  }
  return out;
}

/* ISO 8601 duration ("P1DT2H", "PT45M", "P2W", "-PT15M") -> ms */
function parseDuration(s) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(s || '').trim());
  if (!m) return null;
  const ms = ((+(m[2] || 0) * 7 + +(m[3] || 0)) * 86400 + +(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function parseRrule(value, cal, dtstart) {
  const r = { freq: null, interval: 1, count: null, until: null, untilWall: null, byday: [], bymonthday: [], bymonth: [], bysetpos: [], wkst: 1, unsupported: [] };
  for (const part of String(value).split(';')) {
    const k = part.indexOf('=');
    if (k < 0) continue;
    const key = part.slice(0, k).toUpperCase();
    const val = part.slice(k + 1);
    if (key === 'FREQ') r.freq = val.toUpperCase();
    else if (key === 'INTERVAL') r.interval = Math.max(1, parseInt(val, 10) || 1);
    else if (key === 'COUNT') r.count = Math.max(0, parseInt(val, 10) || 0);
    else if (key === 'UNTIL') {
      const d = parseDate({ value: val, params: dtstart && dtstart.allDay ? { VALUE: 'DATE' } : (/Z$/i.test(val) ? {} : { TZID: dtstart && dtstart.tzid }) }, cal);
      if (d) {
        r.until = d.allDay ? d.wall + DAY - 1 : d.utc;
        r.untilWall = d.allDay ? d.wall + DAY - 1 : d.wall;
        if (d.allDay && dtstart && !dtstart.allDay) r.until = wallToUtc(d.wall + DAY - 1, dtstart.zone);
      }
    } else if (key === 'BYDAY') {
      for (const t of val.split(',')) {
        const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(t.trim());
        if (m) r.byday.push({ n: m[1] ? parseInt(m[1], 10) : 0, wd: WD[m[2].toUpperCase()] });
      }
    } else if (key === 'BYMONTHDAY') r.bymonthday = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x && Math.abs(x) <= 31);
    else if (key === 'BYMONTH') r.bymonth = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= 12);
    else if (key === 'BYSETPOS') r.bysetpos = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x);
    else if (key === 'WKST') r.wkst = WD[val.toUpperCase()] !== undefined ? WD[val.toUpperCase()] : 1;
    else if (key !== 'RSCALE' && key !== 'SKIP') r.unsupported.push(key);
  }
  if (['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].indexOf(r.freq) === -1) r.unsupported.push('FREQ=' + r.freq);
  return r;
}

// ---------------------------------------------------------------- parsing a feed

function parseICS(text) {
  const cal = { name: null, color: null, tz: null, events: [], vtimezones: {}, zoneCache: {}, warnings: new Set(), defaultZone: null };
  const lines = unfold(text);
  if (!lines.some((l) => /^BEGIN:VCALENDAR/i.test(l))) throw U.httpError(422, 'This link did not return an iCalendar (ICS) file');
  const stack = [];
  let ev = null, tz = null, tzc = null;
  const pendingTz = [];
  for (const line of lines) {
    // past the VEVENT cap, skip the body of further events without parsing it
    if (cal.truncated && !ev && stack[stack.length - 1] === 'VEVENT' && !/^END:/i.test(line)) continue;
    const p = parseLine(line);
    if (p.name === 'BEGIN') {
      const what = p.value.toUpperCase();
      stack.push(what);
      if (what === 'VEVENT') {
        if (cal.events.length >= MAX_VEVENTS) { ev = null; cal.truncated = true; continue; }
        ev = { props: {}, exdate: [], rdate: [] };
      }
      else if (what === 'VTIMEZONE') tz = { id: null, comps: [] };
      else if (tz && (what === 'STANDARD' || what === 'DAYLIGHT')) tzc = { kind: what, props: {}, rdate: [] };
      continue;
    }
    if (p.name === 'END') {
      const what = p.value.toUpperCase();
      stack.pop();
      if (what === 'VEVENT') { if (ev) cal.events.push(ev); ev = null; }
      else if (what === 'VTIMEZONE' && tz) { if (tz.id) pendingTz.push(tz); tz = null; }
      else if ((what === 'STANDARD' || what === 'DAYLIGHT') && tz && tzc) { tz.comps.push(tzc); tzc = null; }
      continue;
    }
    const top = stack[stack.length - 1];
    if (top === 'VEVENT' && ev) {
      if (p.name === 'EXDATE') ev.exdate.push(p);
      else if (p.name === 'RDATE') ev.rdate.push(p);
      else if (!(p.name in ev.props)) ev.props[p.name] = p;
    } else if (tzc && (top === 'STANDARD' || top === 'DAYLIGHT')) {
      if (p.name === 'RDATE') tzc.rdate.push(p);
      else tzc.props[p.name] = p;
    } else if (tz && top === 'VTIMEZONE') {
      if (p.name === 'TZID') tz.id = p.value.trim();
    } else if (top === 'VCALENDAR') {
      if (p.name === 'X-WR-CALNAME') cal.name = unescapeText(p.value);
      else if (p.name === 'X-WR-TIMEZONE') cal.tz = p.value.trim();
      else if (p.name === 'X-APPLE-CALENDAR-COLOR' || p.name === 'COLOR') cal.color = cal.color || normColor(p.value);
    }
  }
  // VTIMEZONE definitions, in fake-UTC wall time
  const bare = { vtimezones: {}, zoneCache: {}, warnings: new Set(), defaultZone: { kind: 'utc' } };
  for (const t of pendingTz) {
    const comps = [];
    for (const c of t.comps) {
      const st = c.props.DTSTART ? parseDate({ value: c.props.DTSTART.value, params: {} }, bare) : null;
      if (!st) continue;
      const comp = {
        kind: c.kind, start: st.wall, offsetTo: offsetSeconds(c.props.TZOFFSETTO && c.props.TZOFFSETTO.value),
        offsetFrom: offsetSeconds(c.props.TZOFFSETFROM && c.props.TZOFFSETFROM.value), rrule: null, rdates: [],
      };
      if (c.props.RRULE) {
        comp.rrule = parseRrule(c.props.RRULE.value, bare, { allDay: false, zone: { kind: 'utc' } });
        if (comp.rrule.until !== null) comp.rrule.untilWall = comp.rrule.until + comp.offsetFrom * 1000;
      }
      for (const rd of c.rdate) for (const d of parseDateList({ value: rd.value, params: {} }, bare)) comp.rdates.push(d.wall);
      comps.push(comp);
    }
    if (comps.length) cal.vtimezones[t.id] = comps;
  }
  if (cal.truncated) cal.warnings.add('only the first ' + MAX_VEVENTS + ' events of this calendar are read');
  if (cal.tz) {
    const iana = cleanTzid(cal.tz);
    if (iana) cal.defaultZone = { kind: 'iana', tz: iana };
  }
  return cal;
}

function normColor(v) {
  const s = String(v || '').trim();
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) return '#' + m[1].toLowerCase();
  return /^[a-z]{3,20}$/i.test(s) ? s.toLowerCase() : null;
}

// ---------------------------------------------------------------- recurrence

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

function monthDaysByDay(y, m, byday) {
  const n = daysInMonth(y, m);
  const out = new Set();
  for (const b of byday) {
    const all = [];
    for (let d = 1; d <= n; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.wd) all.push(d);
    if (!b.n) all.forEach((d) => out.add(d));
    else if (b.n > 0 && all[b.n - 1]) out.add(all[b.n - 1]);
    else if (b.n < 0 && all[all.length + b.n]) out.add(all[all.length + b.n]);
  }
  return Array.from(out).sort((a, b) => a - b);
}

function monthDaysByMonthDay(y, m, list) {
  const n = daysInMonth(y, m);
  const out = new Set();
  for (const x of list) { const d = x > 0 ? x : n + x + 1; if (d >= 1 && d <= n) out.add(d); }
  return Array.from(out).sort((a, b) => a - b);
}

function yearDaysByDay(y, byday) {
  const out = [];
  for (const b of byday) {
    const all = [];
    for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += DAY) if (new Date(t).getUTCDay() === b.wd) all.push(t);
    if (!b.n) out.push(...all);
    else if (b.n > 0 && all[b.n - 1] !== undefined) out.push(all[b.n - 1]);
    else if (b.n < 0 && all[all.length + b.n] !== undefined) out.push(all[all.length + b.n]);
  }
  return out;
}

function applySetpos(list, setpos) {
  if (!setpos.length) return list;
  const out = [];
  for (const p of setpos) { const v = p > 0 ? list[p - 1] : list[list.length + p]; if (v !== undefined) out.push(v); }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/* One RRULE as numbered periods: period k = the k-th day, week, month or year counted from the
   one that holds DTSTART. setFor(k) gives that period's occurrence starts (wall time, fake-UTC
   ms), periodStart(k) its first instant, and skipTo(wall) the period that holds `wall`, so the
   expansion can jump straight to the query window instead of walking from DTSTART. */
function periods(dtWall, r) {
  const s = new Date(dtWall);
  const time = (s.getUTCHours() * 3600 + s.getUTCMinutes() * 60 + s.getUTCSeconds()) * 1000;
  const day0 = dtWall - time;
  const y0 = s.getUTCFullYear(), m0 = s.getUTCMonth() + 1, d0 = s.getUTCDate();
  const inMonth = (t) => !r.bymonth.length || r.bymonth.indexOf(new Date(t).getUTCMonth() + 1) !== -1;
  function monthSet(y, m) {
    let days;
    if (r.byday.length && r.bymonthday.length) {
      const a = monthDaysByDay(y, m, r.byday);
      days = monthDaysByMonthDay(y, m, r.bymonthday).filter((d) => a.indexOf(d) !== -1);
    } else if (r.byday.length) days = monthDaysByDay(y, m, r.byday);
    else if (r.bymonthday.length) days = monthDaysByMonthDay(y, m, r.bymonthday);
    else days = d0 <= daysInMonth(y, m) ? [d0] : [];
    return days.map((d) => Date.UTC(y, m - 1, d) + time);
  }
  if (r.freq === 'DAILY') {
    const step = r.interval * DAY;
    return {
      constPerPeriod: !r.byday.length && !r.bymonthday.length && !r.bymonth.length ? 1 : null,
      periodStart: (k) => day0 + k * step,
      skipTo: (w) => Math.floor((w - day0) / step),
      setFor: (k) => {
        const t = day0 + k * step + time;
        const d = new Date(t);
        if (r.byday.length && !r.byday.some((x) => x.wd === d.getUTCDay())) return [];
        if (r.bymonthday.length && monthDaysByMonthDay(d.getUTCFullYear(), d.getUTCMonth() + 1, r.bymonthday).indexOf(d.getUTCDate()) === -1) return [];
        return inMonth(t) ? [t] : [];
      },
    };
  }
  if (r.freq === 'WEEKLY') {
    const back = (new Date(day0).getUTCDay() - r.wkst + 7) % 7;
    const week0 = day0 - back * DAY;
    const step = r.interval * 7 * DAY;
    const days = r.byday.length ? r.byday.map((b) => b.wd) : [new Date(day0).getUTCDay()];
    const setFor = (k) => {
      const wk = week0 + k * step, set = [];
      for (let i = 0; i < 7; i++) if (days.indexOf(new Date(wk + i * DAY).getUTCDay()) !== -1) set.push(wk + i * DAY + time);
      return applySetpos(set.filter(inMonth), r.bysetpos);
    };
    return {
      constPerPeriod: r.bymonth.length ? null : setFor(1).length,
      periodStart: (k) => week0 + k * step,
      skipTo: (w) => Math.floor((w - week0) / step),
      setFor: setFor,
    };
  }
  if (r.freq === 'MONTHLY') {
    const ym = (k) => { const i = (m0 - 1) + k * r.interval; return [y0 + Math.floor(i / 12), (i % 12) + 1]; };
    return {
      constPerPeriod: null,
      periodStart: (k) => { const [y, m] = ym(k); return Date.UTC(y, m - 1, 1); },
      skipTo: (w) => { const d = new Date(w); return Math.floor(((d.getUTCFullYear() - y0) * 12 + (d.getUTCMonth() + 1 - m0)) / r.interval); },
      setFor: (k) => {
        const [y, m] = ym(k);
        if (r.bymonth.length && r.bymonth.indexOf(m) === -1) return [];
        return applySetpos(monthSet(y, m), r.bysetpos);
      },
    };
  }
  if (r.freq === 'YEARLY') {
    return {
      constPerPeriod: null,
      periodStart: (k) => Date.UTC(y0 + k * r.interval, 0, 1),
      skipTo: (w) => Math.floor((new Date(w).getUTCFullYear() - y0) / r.interval),
      setFor: (k) => {
        const y = y0 + k * r.interval;
        let set = [];
        if (r.bymonth.length) for (const m of r.bymonth) set.push(...monthSet(y, m));
        else if (r.byday.length) set = yearDaysByDay(y, r.byday).map((t) => t + time);
        else if (r.bymonthday.length) for (let m = 1; m <= 12; m++) set.push(...monthSet(y, m));
        else if (d0 <= daysInMonth(y, m0)) set.push(Date.UTC(y, m0 - 1, d0) + time);
        set.sort((x, z) => x - z);
        return applySetpos(set, r.bysetpos);
      },
    };
  }
  return null;
}

/* Occurrence starts of a rule between fromWall and stopWall (wall time).
   -> {walls, before, dtInRule, partial}: `before` counts the rule's occurrences at or after
   DTSTART that fall before fromWall (needed for COUNT), computed arithmetically when every
   period holds the same number of occurrences and counted without being kept otherwise.
   `budget.left` is a shared iteration budget; when it runs out the result is partial. */
function expandWall(dtWall, r, fromWall, stopWall, budget) {
  const res = { walls: [], before: 0, dtInRule: false, partial: false };
  const P = periods(dtWall, r);
  if (!P) return res;
  budget = budget || { left: MAX_PERIODS };
  const first = P.setFor(0);
  res.dtInRule = first.indexOf(dtWall) !== -1;
  let k = 0;
  if (fromWall > dtWall) {
    const target = Math.max(0, P.skipTo(fromWall) - 1);
    if (r.count === null) k = target;
    else if (P.constPerPeriod !== null && target > 0) {
      res.before = first.filter((t) => t >= dtWall).length + (target - 1) * P.constPerPeriod;
      k = target;
    }
  }
  const enough = r.count === null ? Infinity : r.count + 1;
  for (; ; k++) {
    if (budget.left <= 0) { res.partial = true; break; }
    budget.left--;
    if (P.periodStart(k) > stopWall) break;
    for (const t of (k === 0 ? first : P.setFor(k))) {
      if (t < dtWall) continue;
      if (t < fromWall) res.before++;
      else if (t <= stopWall) res.walls.push(t);
    }
    if (res.before + res.walls.length >= enough) break;
    if (r.until !== null && P.periodStart(k) > r.untilWall + DAY) break;
  }
  return res;
}

// ---------------------------------------------------------------- events in a window

function isoDate(wallMs) { return new Date(wallMs).toISOString().slice(0, 10); }

/* The machine's local calendar date of a UTC instant, as YYYY-MM-DD. */
function localDate(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* Expand one parsed calendar into events overlapping [fromMs, toMs) (real UTC ms). */
function eventsBetween(cal, fromMs, toMs, label, color, budget) {
  budget = budget || { left: FEED_BUDGET };
  const out = [];
  const overrides = {};
  const evs = [];
  for (const e of cal.events) {
    const P = e.props;
    const start = parseDate(P.DTSTART, cal);
    if (!start) continue;
    if (P.DTSTART.params.TZID) start.tzid = P.DTSTART.params.TZID;
    const rec = P['RECURRENCE-ID'] ? parseDate(P['RECURRENCE-ID'], cal) : null;
    const uid = P.UID ? P.UID.value.trim() : null;
    if (rec && uid) (overrides[uid] = overrides[uid] || []).push(rec);
    evs.push({ e: e, start: start, rec: rec, uid: uid });
  }
  const fromDate = localDate(fromMs), toDate = localDate(toMs - 1);
  for (const it of evs) {
    const P = it.e.props;
    const status = P.STATUS ? P.STATUS.value.trim().toUpperCase() : '';
    if (status === 'CANCELLED') continue;
    const start = it.start;
    let durMs;
    const endD = P.DTEND ? parseDate(P.DTEND, cal) : null;
    const dur = P.DURATION ? parseDuration(P.DURATION.value) : null;
    if (endD) durMs = start.allDay ? endD.wall - start.wall : endD.utc - start.utc;
    else if (dur !== null) durMs = dur;
    else durMs = start.allDay ? DAY : 0;
    if (!(durMs >= 0)) durMs = start.allDay ? DAY : 0;
    if (start.allDay) durMs = Math.max(DAY, Math.round(durMs / DAY) * DAY);

    const base = {
      title: P.SUMMARY ? unescapeText(P.SUMMARY.value) || '(untitled)' : '(untitled)',
      cal: label, color: color,
    };
    if (P.LOCATION && unescapeText(P.LOCATION.value)) base.location = unescapeText(P.LOCATION.value).slice(0, 200);

    // occurrence starts as real UTC ms (timed) or wall dates (all-day)
    let starts = [];
    let flagged = false;
    if (P.RRULE && !it.rec) {
      const r = parseRrule(P.RRULE.value, cal, start);
      if (r.unsupported.length) { flagged = true; cal.warnings.add('unsupported RRULE part ' + r.unsupported.join(',')); starts = [start.wall]; }
      else {
        // wall-time window, widened by the event length and the largest zone offset (14 h)
        const fromWall = Math.max(start.wall, fromMs - durMs - DAY);
        const stopWall = toMs + DAY;
        const x = expandWall(start.wall, r, fromWall, stopWall, budget);
        if (x.partial) { flagged = true; cal.warnings.add('recurrence budget reached, some repeats are missing'); }
        let idx = x.before + (x.dtInRule ? 0 : 1);   // DTSTART is always the first instance
        const res = [];
        if (!x.dtInRule && start.wall >= fromWall) res.push(start.wall);
        for (const w of x.walls) {
          if (r.count !== null && idx >= r.count) break;
          if (r.until !== null && (start.allDay ? w : wallToUtc(w, start.zone)) > r.until) break;
          res.push(w);
          idx++;
        }
        starts = res;
      }
    } else starts = [start.wall];
    // each occurrence as {w: wall time, u: real UTC ms}; all-day events use the wall date for both
    const occ = starts.map((w) => ({ w: w, u: start.allDay ? w : (w + durMs + 2 * DAY < fromMs ? null : wallToUtc(w, start.zone)) }));
    for (const rd of it.e.rdate) {
      for (const d of parseDateList(rd, cal)) occ.push({ w: d.wall, u: start.allDay ? d.wall : d.allDay ? wallToUtc(d.wall + (start.wall % DAY), start.zone) : d.utc });
    }

    const ex = [];
    for (const xp of it.e.exdate) for (const d of parseDateList(xp, cal)) ex.push(d);
    const ovs = (!it.rec && it.uid && overrides[it.uid]) || [];

    for (const o of occ) {
      if (o.u === null) continue;
      const w = o.w, sUtc = o.u;
      if (ex.some((d) => (d.allDay ? isoDate(d.wall) === isoDate(w) : d.utc === sUtc))) continue;
      if (ovs.some((d) => (d.allDay ? isoDate(d.wall) === isoDate(w) : d.utc === sUtc))) continue;
      if (start.allDay) {
        const sDate = isoDate(w), eDate = isoDate(w + durMs);
        if (eDate <= fromDate || sDate > toDate) continue;
        if (out.length >= MAX_OUT) { cal.warnings.add('more than ' + MAX_OUT + ' events in the range, the rest are left out'); return out; }
        out.push(Object.assign({}, base, { start: sDate, end: eDate, allDay: true, days: Math.round(durMs / DAY) }, flagged ? { partial: true } : {}));
      } else {
        const eUtc = sUtc + durMs;
        if (!(eUtc > fromMs || (durMs === 0 && sUtc >= fromMs)) || sUtc >= toMs) continue;
        if (out.length >= MAX_OUT) { cal.warnings.add('more than ' + MAX_OUT + ' events in the range, the rest are left out'); return out; }
        out.push(Object.assign({}, base, { start: new Date(sUtc).toISOString(), end: new Date(eUtc).toISOString(), allDay: false }, flagged ? { partial: true } : {}));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- the route

function calendarUrls(settings) {
  const list = [];
  if (Array.isArray(settings.calendars)) {
    for (const c of settings.calendars) if (c && c.url) list.push({ url: String(c.url), name: c.name || null, color: normColor(c.color) });
  }
  const raw = typeof settings.calendarUrl === 'string' ? settings.calendarUrl : '';
  for (const u of raw.split(/[\s,]+/)) if (u.trim()) list.push({ url: u.trim(), name: null, color: null });
  return list;
}

function fetchUrl(raw) {
  let s = String(raw).trim();
  if (/^webcals?:\/\//i.test(s)) s = 'https://' + s.replace(/^webcals?:\/\//i, '');
  let u;
  try { u = new URL(s); } catch (e) { throw U.httpError(400, 'Not a valid calendar link'); }
  // (the link itself never appears in an error)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw U.httpError(400, 'Calendar links must start with https://, http:// or webcal://');
  return u.toString();
}

/* Errors that reach the room never contain the link or a raw library message: private
   calendar addresses work like passwords. */
async function loadCalendar(c, url) {
  return U.cached(c, 'ics:' + url, TTL, STALE, async () => {
    let res;
    try { res = await c.http(url, { method: 'GET', timeout: 20000 }); } catch (e) {
      throw U.httpError(502, 'Could not reach the calendar (' + U.netReason(e) + ')');
    }
    if (res.status === 401 || res.status === 403) throw U.httpError(502, 'The calendar refused access (HTTP ' + res.status + '). Use the secret or public iCal address.');
    if (res.status === 404 || res.status === 410) throw U.httpError(502, 'The calendar link was not found (HTTP ' + res.status + ')');
    if (res.status < 200 || res.status >= 300) throw U.httpError(502, 'The calendar server answered HTTP ' + res.status);
    // requestUrl has already buffered the body; the header check spares the parsing, the
    // length check below guards answers that do not declare their size
    if (U.declaredTooLarge(res, MAX_BYTES)) throw U.httpError(413, 'The calendar is larger than 5 MB');
    const text = U.readText(res);
    if (text.length > MAX_BYTES) throw U.httpError(413, 'The calendar is larger than 5 MB');
    try { return parseICS(text); } catch (e) {
      throw U.httpError(422, 'The link did not return a calendar (ICS) file');
    }
  });
}

function dayStart(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d.getTime() : null;
}

async function calendar(a, b) {
  const c = U.ctxOf(a, b);
  const list = calendarUrls(c.settings);
  if (!list.length) return U.reply(200, { off: true, events: [], cals: [], error: null });
  const today = new Date(c.now());
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const q = c.query || {};
  const from = q.from ? dayStart(q.from) : t0;
  const toDay = q.to ? dayStart(q.to) : new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).getTime();
  if (from === null || toDay === null) return U.reply(400, { error: 'from and to must be dates as YYYY-MM-DD', events: [], cals: [] });
  const to = new Date(new Date(toDay).getFullYear(), new Date(toDay).getMonth(), new Date(toDay).getDate() + 1).getTime();
  if (to <= from) return U.reply(400, { error: 'to is before from', events: [], cals: [] });
  if (to - from > MAX_RANGE_DAYS * DAY) return U.reply(400, { error: 'The range is longer than ' + MAX_RANGE_DAYS + ' days', events: [], cals: [] });

  const events = [], cals = [], errors = [];
  const reqBudget = { left: REQUEST_BUDGET };
  await Promise.all(list.map(async (spec, i) => {
    let url;
    const fallbackColor = spec.color || PALETTE[i % PALETTE.length];
    try {
      url = fetchUrl(spec.url);
      const r = await loadCalendar(c, url);
      const cal = r.value;
      const name = spec.name || cal.name || new URL(url).host;
      const color = spec.color || cal.color || PALETTE[i % PALETTE.length];
      const budget = { left: Math.min(FEED_BUDGET, Math.max(0, reqBudget.left)) };
      const before = budget.left;
      const evs = eventsBetween(cal, from, to, name, color, budget);
      reqBudget.left -= before - budget.left;
      const entry = { name: name, color: color, count: evs.length };
      if (r.stale) { entry.stale = true; entry.age_min = r.ageMin; }
      if (cal.warnings.size) entry.warnings = Array.from(cal.warnings).slice(0, 5);
      cals[i] = entry;
      events.push(...evs);
    } catch (e) {
      const name = spec.name || (url ? new URL(url).host : 'Calendar ' + (i + 1));
      const msg = U.scrub(e && e.status ? e.message : 'The calendar could not be read');
      cals[i] = { name: name, color: fallbackColor, error: msg };
      errors.push(name + ': ' + msg);
    }
  }));
  events.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : (x.allDay === y.allDay ? 0 : x.allDay ? -1 : 1)));
  const out = {
    events: events, cals: cals.filter(Boolean), error: errors.length ? errors.join('; ') : null,
    from: new Date(from).toISOString(), to: new Date(to).toISOString(),
  };
  return U.reply(errors.length && errors.length === list.length ? 502 : 200, out);
}

module.exports = {
  routes: { calendar: calendar },
  unfold, parseLine, unescapeText, parseICS, parseDate, parseDuration, parseRrule, expandWall, eventsBetween,
  wallToUtc, cleanTzid, fetchUrl, calendarUrls, vtzOffset,
};
