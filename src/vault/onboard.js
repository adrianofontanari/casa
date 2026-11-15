'use strict';
// /api/onboarding: what Casa found in the vault, plus the setup steps.
// The room is untrusted (it shows outside text), so it never sends a URL or a folder:
//   - {step:"city", city:{name <= 80 chars, lat -90..90, lon -180..180} | null} is saved as is;
//   - {step:"calendar"} and {step:"folder"} open a native Obsidian prompt (src/vault/prompts.js)
//     where the user types the value; the answer is only {saved:true|false}, never the value;
//   - {step:"done"} sets onboarded true (finished or skipped); {step:"daily"} only confirms.
//     Only Casa's settings tab can show the welcome again (onboarded false).

const io = require('./io');
const daily = require('./daily');
const { makePrompts, parseCalendarInput, parseFolderInput } = require('./prompts');

async function state(ctx) {
  const s = ctx.settings || {};
  const info = await daily.detect(ctx);
  return {
    daily: daily.publicInfo(info),
    city: s.city || null,
    calendar: !!s.calendarUrl,
    done: s.onboarded === true,
  };
}

async function get(ctx) {
  return { status: 200, json: await state(ctx) };
}

async function save(ctx, patch) {
  if (typeof ctx.saveSettings !== 'function') throw new io.HttpError(501, 'settings are not available');
  const next = await ctx.saveSettings(patch);
  if (typeof ctx.getSettings === 'function') ctx.settings = ctx.getSettings();
  else if (next && typeof next === 'object' && !Array.isArray(next)) ctx.settings = Object.assign({}, ctx.settings, next);
  else ctx.settings = Object.assign({}, ctx.settings, patch);
}

function checkCity(c) {
  if (c === null || c === '') return null;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new io.HttpError(400, 'city must be {name, lat, lon} or null');
  const name = typeof c.name === 'string' ? c.name.replace(/\s+/g, ' ').trim() : '';
  const lat = typeof c.lat === 'number' ? c.lat : NaN;
  const lon = typeof c.lon === 'number' ? c.lon : NaN;
  if (!name || name.length > 80) throw new io.HttpError(400, 'city name must be 1 to 80 characters');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new io.HttpError(400, 'city lat out of range');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new io.HttpError(400, 'city lon out of range');
  return { name, lat, lon };
}

let busy = false;

// Opens a native prompt (outside the room) and saves what the user typed there.
async function ask(ctx, kind) {
  const prompts = ctx.prompts || makePrompts(ctx);
  if (!prompts || typeof prompts[kind] !== 'function') {
    return { status: 501, json: { saved: false, error: 'This step needs the Obsidian app.' } };
  }
  if (busy) return { status: 409, json: { saved: false, error: 'A Casa prompt is already open.' } };
  busy = true;
  try {
    if (kind === 'calendar') {
      const value = await prompts.calendar();
      if (value == null) return { status: 200, json: { saved: false } };
      await save(ctx, { calendarUrl: parseCalendarInput(value) });
    } else {
      const picked = await prompts.folder();
      if (!picked) return { status: 200, json: { saved: false } };
      const folder = parseFolderInput(picked.path);
      const current = await daily.detect(ctx);
      await save(ctx, { dailyMode: 'custom', dailyFolder: folder, dailyFormat: current.format || daily.DEFAULT_FORMAT });
    }
    return { status: 200, json: { saved: true } };
  } catch (e) {
    if (e && e.status) throw e;
    return { status: 400, json: { saved: false, error: String((e && e.message) || e) } };
  } finally {
    busy = false;
  }
}

// The body is read for `step` and, for the city step, `city`. Any url or folder in it is ignored.
async function post(ctx) {
  const b = ctx.body || {};
  if (b.step === 'daily') {
    // "Looks right": nothing to save.
  } else if (b.step === 'folder') {
    return ask(ctx, 'folder');
  } else if (b.step === 'calendar') {
    return ask(ctx, 'calendar');
  } else if (b.step === 'city') {
    await save(ctx, { city: checkCity(b.city) });
  } else if (b.step === 'done') {
    await save(ctx, { onboarded: true });
  } else {
    throw new io.HttpError(400, 'unknown step');
  }
  return { status: 200, json: await state(ctx) };
}

module.exports = { get, post, state, checkCity };
