'use strict';
// Date helpers for the vault routes.
// In Obsidian the caller passes `window.moment`, so formats follow the user's locale exactly as
// Obsidian's own daily notes do. Without it (node tests) a small built-in formatter covers the
// tokens daily-note formats use in practice.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

function pad(n, w) {
  let s = String(Math.abs(n));
  while (s.length < w) s = '0' + s;
  return (n < 0 ? '-' : '') + s;
}

function ordinal(n) {
  const b = n % 10;
  const t = Math.floor((n % 100) / 10) === 1;
  return n + (t ? 'th' : b === 1 ? 'st' : b === 2 ? 'nd' : b === 3 ? 'rd' : 'th');
}

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 864e5) + 1;
}

// ISO 8601 week (Monday first, week 1 holds the first Thursday).
function isoWeek(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - day + 3);
  const year = t.getFullYear();
  const first = new Date(year, 0, 4);
  const week = 1 + Math.round(((t - first) / 864e5 - 3 + ((first.getDay() + 6) % 7)) / 7);
  return { week, year };
}

// moment's default "en" locale week: Sunday first, week 1 holds January 1st.
function localeWeek(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sat = new Date(t);
  sat.setDate(t.getDate() + (6 - t.getDay()));
  const year = sat.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const firstSun = new Date(year, 0, 1 - jan1.getDay());
  const week = Math.floor((new Date(t.getFullYear(), t.getMonth(), t.getDate() - t.getDay()) - firstSun) / (7 * 864e5)) + 1;
  return { week, year };
}

const TOKEN = /\[([^\]]*)]|YYYY|YY|Y|Qo|Q|MMMM|MMM|MM|Mo|M|DDDD|DDDo|DDD|Do|DD|D|dddd|ddd|dd|do|d|E|e|WW|Wo|W|ww|wo|w|GGGG|GG|gggg|gg|HH|H|hh|h|kk|k|mm|m|ss|s|SSS|A|a|X|x|ZZ|Z/g;

function formatDate(date, fmt) {
  const d = date instanceof Date ? date : new Date(date);
  const Y = d.getFullYear(), M = d.getMonth(), D = d.getDate(), wd = d.getDay();
  const h = d.getHours(), mi = d.getMinutes(), s = d.getSeconds();
  const tz = () => {
    const o = -d.getTimezoneOffset();
    return (o >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(o) / 60), 2) + ':' + pad(Math.abs(o) % 60, 2);
  };
  return String(fmt == null ? 'YYYY-MM-DDTHH:mm:ssZ' : fmt).replace(TOKEN, (tok, lit) => {
    if (lit !== undefined) return lit;
    switch (tok) {
      case 'YYYY': return pad(Y, 4);
      case 'YY': return pad(Y % 100, 2);
      case 'Y': return String(Y);
      case 'Q': return String(Math.floor(M / 3) + 1);
      case 'Qo': return ordinal(Math.floor(M / 3) + 1);
      case 'MMMM': return MONTHS[M];
      case 'MMM': return MONTHS[M].slice(0, 3);
      case 'MM': return pad(M + 1, 2);
      case 'Mo': return ordinal(M + 1);
      case 'M': return String(M + 1);
      case 'DDDD': return pad(dayOfYear(d), 3);
      case 'DDDo': return ordinal(dayOfYear(d));
      case 'DDD': return String(dayOfYear(d));
      case 'Do': return ordinal(D);
      case 'DD': return pad(D, 2);
      case 'D': return String(D);
      case 'dddd': return DAYS[wd];
      case 'ddd': return DAYS[wd].slice(0, 3);
      case 'dd': return DAYS[wd].slice(0, 2);
      case 'do': return ordinal(wd);
      case 'd': case 'e': return String(wd);
      case 'E': return String(((wd + 6) % 7) + 1);
      case 'WW': return pad(isoWeek(d).week, 2);
      case 'Wo': return ordinal(isoWeek(d).week);
      case 'W': return String(isoWeek(d).week);
      case 'ww': return pad(localeWeek(d).week, 2);
      case 'wo': return ordinal(localeWeek(d).week);
      case 'w': return String(localeWeek(d).week);
      case 'GGGG': return pad(isoWeek(d).year, 4);
      case 'GG': return pad(isoWeek(d).year % 100, 2);
      case 'gggg': return pad(localeWeek(d).year, 4);
      case 'gg': return pad(localeWeek(d).year % 100, 2);
      case 'HH': return pad(h, 2);
      case 'H': return String(h);
      case 'hh': return pad(h % 12 || 12, 2);
      case 'h': return String(h % 12 || 12);
      case 'kk': return pad(h || 24, 2);
      case 'k': return String(h || 24);
      case 'mm': return pad(mi, 2);
      case 'm': return String(mi);
      case 'ss': return pad(s, 2);
      case 's': return String(s);
      case 'SSS': return pad(d.getMilliseconds(), 3);
      case 'A': return h < 12 ? 'AM' : 'PM';
      case 'a': return h < 12 ? 'am' : 'pm';
      case 'X': return String(Math.floor(d.getTime() / 1000));
      case 'x': return String(d.getTime());
      case 'Z': return tz();
      case 'ZZ': return tz().replace(':', '');
      default: return tok;
    }
  });
}

// A moment-like factory for tests: moment() is "now", moment(date) wraps a date.
function makeMoment(now) {
  const fixed = now == null ? null : new Date(now);
  return function moment(input) {
    const d = input == null ? (fixed ? new Date(fixed) : new Date()) : new Date(input);
    return { format: (f) => formatDate(d, f), toDate: () => new Date(d), valueOf: () => d.getTime() };
  };
}

// Format through the caller's moment when it behaves like moment, else the built-in formatter.
function formatWith(moment, date, fmt) {
  if (typeof moment === 'function') {
    try {
      const m = moment(date);
      if (m && typeof m.format === 'function') {
        const out = m.format(fmt);
        if (typeof out === 'string') return out;
      }
    } catch (e) { /* fall through */ }
  }
  return formatDate(date, fmt);
}

function today(ctx) {
  const d = ctx && ctx.now != null ? new Date(ctx.now) : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function addDays(d, n) {
  const t = new Date(d);
  t.setDate(t.getDate() + n);
  return t;
}

function isoDate(d) {
  return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
}

module.exports = { formatDate, formatWith, makeMoment, today, addDays, isoDate };
