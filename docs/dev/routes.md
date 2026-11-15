# Bridge routes: final shapes

Each owner keeps its own section. Owners may add fields, never rename or remove them.

## Vault routes (Agent 7: `src/vault/`)

Entry: `src/vault/index.js` exports `routes: {focus, tasks, notes, quotes, onboarding}` and `setup(ctx)`.
Handlers take the shell router's `(req merged over ctx, ctx)` or one merged object
`{app, method?, query, body, settings, saveSettings, moment, now?, prompts?}` (tests).
They return `{status, json}`. Errors: `{error}` with 400 (bad input), 403, 404, 409, 412 (`{error:"stale"}`), 501.
**GET never creates or changes a file.** Casa writes only when the user writes.
After a successful write the route calls `ctx.notify(kind)` (`focus`, `tasks`, `notes`).
`setup(ctx)` watches the vault (modify, create, delete, rename; debounced 1.5 s) and notifies
`focus`+`tasks` when today's note changes, `notes` for the post-its note, and `tasks` for a note that has dated tasks.

### Daily note detection (used by focus, tasks, onboarding)
Order, first match wins. No other plugin needs to be installed or running: its settings file is enough.
0. Casa settings `dailyMode: "custom"`: `dailyFolder` (empty = vault root) + `dailyFormat`.
1. Core Daily notes: `<configDir>/daily-notes.json` `{folder, format, template}`; on/off from
   `app.internalPlugins` or `core-plugins.json` (array or `{id: bool}` form).
2. Periodic Notes: `plugins/periodic-notes/data.json`, `daily` section, or 1.x `calendarSets[active].day`.
   Enabled = `daily.enabled` and listed in `community-plugins.json`.
3. Journals: `plugins/journals/data.json`, the first journal with `write.type: "day"`.
   `folder` + `nameTemplate` (`{{date}}`, `{{date:FMT}}`, `{{journal_name}}`) become a static folder + a moment format.
4. A folder holding 3 or more `YYYY-MM-DD.md` notes (`guessed: true`).
5. Casa default: `Daily/` + `YYYY-MM-DD`.

Among 1-3: a source with notes in the last 31 days wins; else an enabled, configured source whose folder exists;
else a settings-only source whose (non-root) folder exists. A settings file pointing at a missing folder is skipped.
Core switched on but never configured, with no notes, does not count (so Casa does not write into the vault root).
Formats may nest folders (`YYYY/MM/YYYY-MM-DD`). Missing folders are created on the first write.
New note: the user's template when set (tokens `{{date}}`, `{{title}}`, `{{time}}`, `{{date:FMT}}`, `{{time:FMT}}`,
`{{yesterday}}`, `{{tomorrow}}`; other syntax is left for its plugin), else
```
## Today's goal

## Tasks
```

`daily` object (in onboarding, partly in focus): `{source:"core"|"periodic"|"journals"|"casa", label, folder, format,
template, path, example, exists, found, enabled, custom, guessed}`. `example` = today's formatted name, `found` = notes in the last 31 days.

### `/api/focus`
- GET -> `{focus, exists, date:"YYYY-MM-DD", path, source:"frontmatter"|"heading"|"line"|null, daily:{source, folder}}`
- POST `{focus}` -> same as GET. 400 if `focus` is not text. An empty focus on a missing note writes nothing.

Read, first form that holds a value:
(a) frontmatter `goal:` (quoted or plain; a YAML list gives its first item);
(b) the first non-empty line under a heading (any level, any case) containing `goal`, else `focus`, else `today`
(not `task`/`to do`/`done`/`log`/`note`); comments skipped; a checkbox there means "not a goal slot"; list/quote markers kept on write;
(c) a line `Goal:` / `- Goal:` / `**Goal:**` / `Goal::`.
Write: the form holding the value is updated in place; else the first empty slot is filled; else
`## Today's goal` + the line is inserted after the frontmatter and after a leading `# H1`. One line, max 300 chars.
Clearing: removes the heading-slot line, leaves `goal:` / `Goal:` empty.

### `/api/tasks`
- GET -> `{date, path, exists, today:[Task], upcoming:[Task], rev}`
- `Task = {id, text, done, status, path, line, daily, due?, scheduled?, doneDate?, overdue?, indent?}`.
  `line` is 0-based. `due` = the 📅 date, else the ⏳ date. `text` has the Tasks metadata and block id removed.
- `today`: every checkbox of today's note (done ones too, `[-]` skipped), then vault tasks: overdue first
  (`overdue:true`, oldest first), then due or scheduled today, then tasks completed today (`✅ <today>`, kept visible as done).
  Max 100 vault tasks. `upcoming`: open tasks dated in the next 7 days, max 30.
- Vault tasks = Tasks-plugin emoji format: `📅|📆|🗓` due, `⏳|⌛` scheduled, `✅` done date; old done (`[x]`, `✅` before today)
  and cancelled `[-]` are skipped. The Tasks plugin is not needed. Its `globalFilter` (from its data.json) is respected.
  Skipped: the config folder, the core templates folder, `Casa/Post-its.md`, `Casa/Quotes.md`.
  metadataCache `listItems` decides which files to read; files are re-parsed only when mtime/size change.
- POST `{op:"toggle", id, rev?}` / `{op:"edit", id, text, rev?}` / `{op:"add", text, due?:"YYYY-MM-DD"}` -> `{ok:true, rev, task, date}`.
  - toggle: `[ ]` <-> `[x]`. Adds ` ✅ YYYY-MM-DD` (before a `^block-id`) only if the line already uses Tasks emoji format;
    un-ticking removes it. If the Tasks plugin is installed, its `apiV1.executeToggleTaskDoneCommand` is used for emoji
    tasks (recurring tasks roll over).
  - edit: replaces the description, keeps status, metadata and block id.
  - add: `- [ ] text` (+ ` 📅 due`) after the last line of the first heading containing `task`/`to do` in today's note;
    no heading: `## Tasks` at the end; no note: created as above.
  - Stale: `id` = `<hash of the line>:<line>:<path>`. If that line changed, 412 `{error:"stale"}` and nothing is written.
    If the same line moved (lines added above) and is unique in the file, it is found. `rev` (hash of the involved files' mtimes) is informational.

### `/api/notes` (post-its)
- GET -> `{notes:[{id, text, color, x, y}], path:"Casa/Post-its.md", exists}`. `x`, `y` in 0..1. Colours: `yellow pink blue green orange white`.
- POST `{op:"add", text, color?, x?, y?}` | `{op:"edit", id, text?, color?}` | `{op:"move", id, x, y}` | `{op:"delete", id}` -> same as GET.
  404 unknown id, 400 empty text. The note is created on the first add. Text: max 280 chars, 6 lines.
- File (folder from settings `casaFolder`, default `Casa`): one top-level bullet per post-it, extra lines indented by two spaces,
  and an Obsidian comment (hidden in reading view) on the first line:
  ```
  - Water the plants %%casa n1a2b yellow 0.20 0.30%%
    and the balcony ones
  ```
  Hand edits round-trip: a bullet without the comment gets yellow and a free spot, and an id derived from its text;
  headings and prose around the list are kept; only the touched item is rewritten.

### `/api/quotes`
- GET -> `{quotes:[string], items:[{text, author}], path:"Casa/Quotes.md", exists, builtin}`.
  Without the note: 20 built-in public-domain quotes (`builtin:true`; sources in `docs/dev/credits.md`), no file written.
- POST `{op:"add", text}` -> same as GET. The first add creates the note seeded with the built-in quotes, then appends.
- File: one quote per line; bullets, numbers, `>` are stripped; headings, frontmatter, `%% %%` comments and code blocks are ignored.
  `Text - Author` splits into `items`.

### `/api/onboarding`
- GET -> `{daily, city:{name, lat, lon}|null, calendar:boolean, done:boolean}` (never the calendar URL).
- POST `{step}`. The room never sends a URL or a folder (CONTRACT.md "Security"):
  - `"daily"`: confirms, saves nothing -> GET shape.
  - `"city"` + `city:{name <= 80 chars, lat -90..90, lon -180..180}` or `null` -> GET shape; 400 otherwise.
  - `"done"`: `onboarded:true` (finished or skipped) -> GET shape. The room cannot set it back to false.
  - `"calendar"`: opens a native Obsidian modal (link field, Google/Outlook/iCloud how-to, Enter saves, Esc cancels).
    Only `https://` or `webcal://` (saved as https). -> `{saved:true|false}`, never the value.
  - `"folder"`: opens a FuzzySuggestModal over the vault's folders plus "New folder: <typed>/" ->
    saves `dailyMode:"custom"`, `dailyFolder`, `dailyFormat` (current format) -> `{saved:true|false}`.
  - Any `url`, `calendarUrl`, `folder` field in the body is ignored. 501 `{saved:false}` without Obsidian's modals,
    409 if a prompt is already open, 400 for an invalid value typed in the prompt.

### Room events from the onboarding card (`src/room/panels/onboarding.js`)
- Opens by itself when GET says `done:false`, on `casa:welcome`, on `casa:open {id:"onboarding"}`, or `CasaOnboarding.open(step)`
  (`"daily"|"city"|"calendar"|"done"`).
- After a city: `casa:data {kind:"weather", source:"onboarding"}`.
- On "Enter the room" / "Skip setup" / Esc: `casa:data {kind:"settings", source:"onboarding"}` and
  `casa:hint {text:"Hi! Click anything in the room to open it.", pulse:true, source:"onboarding"}` (for the buddy and a one-time pulse of the objects).

## Integration routes (Agent 6: `src/integrations/`)

Entry: `src/integrations/index.js` exports `routes: {weather, forecast, geocode, air, webcam, calendar, music}`.
Each handler is `async (req, ctx) -> {status, json}`; it reads `ctx.http` (the plugin's `requestUrl` adapter),
`ctx.getSettings()` (or `ctx.settings`), optional `ctx.cache` (`get/set`, a `Map` works; default: a module Map)
and optional `ctx.now()`. Tests may pass one merged object.

**Network rules.** No module makes a request at load time or on a timer: every request happens inside a route
call. Each source has an off switch that means zero requests: `weatherOn:false` or no `city` (weather, forecast),
`airOn:false` (air and sensor), `webcamOn:false`, empty `calendarUrl`, `musicOn:false`. Fetchers accept only
`http:`/`https:` (`webcal:` is rewritten to `https:`), use timeouts (sensor 10 s, webcam 15 s, ICS 20 s, all under
the bridge's 60 s), refuse a declared `Content-Length` over the cap before parsing and check the real size after
reading (Obsidian's `requestUrl` buffers the whole body, so the header check saves parsing, not the download):
webcam 2 MB (must be `image/*` and JPEG/PNG/GIF/WebP bytes), ICS 5 MB, sensor 1 MB. URL settings come only from
the plugin's settings tab, which is why LAN sensor addresses are allowed. Errors that reach the room never contain
a link or a raw library message (`util.scrub`, `util.netReason`): calendar and sensor links can carry secrets.
Every failure answers `{error}` with 4xx/5xx; cached data is served `stale:true, age_min` when a source fails.

| Route | Cache (stale) | Answer |
|---|---|---|
| `GET /api/weather` | 15 min (3 h) | Original room keys: `temp, code, code_hour, day, feels, hum, cloud, press, wind{kmh, gust, dir, speed, gustSpeed, unit}, uv, uv_band, uv_st, zero, sun{rise, set, rise_h, set_h}, moon{phase, illum, waxing, name, age}`, plus `where{name, lat, lon}`, `latlon:[lat, lon]`, `units{temp, wind, press, precip}`, `tz{name, offset}`, `observed`, `at`, `credit, creditHref, licence, licenceHref`. `{off:true, reason}` without a city. |
| `GET /api/forecast` | 60 min (6 h) | `hourly:[{t:"YYYY-MM-DDTHH:00" city time, temp, code, pop, precip, wind}]` (24 h from the current hour), `daily:[{date, min, max, code, pop, sunrise:"HH:MM", sunset, uv, wind}]` (7 days), `units, where, tz, credit...` |
| `GET /api/geocode?q=` | 24 h | `results:[{name, country, admin1, lat, lon, countryCode, timezone, population}]` (max 8), `credit` (GeoNames). Under 2 characters: `[]`, no request. |
| `GET /api/air` | 30 min (3 h); sensor 2 min (15 min) | City (CAMS): `{aqi, scale:"eu"\|"us", band, st, eu, us, pm25, pm10, o3, no2, unit, source:"open-meteo", at, credit, creditHref, licence, notice}`. With `airUrl` also `sensor:{aqi, scale, band, st, approx:true, pm25, pm10, temp?, hum?, co2?, source:"sensor", kind, credit, at}` or `sensor:{error}`; without a city the sensor reading is the top level. Scale: `settings.airScale`, else `us` for imperial units, else `eu`. |
| `GET /api/webcam` | 15 min default, 5 min pasted (3 h / 30 min) | `{src:"data:image/...;base64,...", type, bytes, w, h, credit, href, licence?, terms?, at, source:"default"\|"user"}`; default also `station, name, frames:6, frameW:480, frameH:270, captionH:30` (the BuoyCAM JPEG is six 480x270 views side by side over a 30 px caption). `{off:true}` when `webcamOn` is false. |
| `GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | 15 min per feed (6 h) | `events:[{title, start, end, allDay, cal, color, location?, days? (all-day), partial?}]`, `cals:[{name, color, count, stale?, warnings?, error?}]`, `error` (null or one line per failed feed), `from, to`. Timed: ISO UTC. All-day: `"YYYY-MM-DD"`, **end exclusive** (iCalendar style). Default range today..today+7, max 400 days. 200 if at least one feed worked, 502 if all failed, `{off:true}` without a link. |
| `GET /api/music` | none, no request | `tracks:[{title, artist, album, src, type:"audio/mp4", seconds, license:"CC0 1.0", licenseHref, href}]`, `ambient:["sea","rain","fire","birds"]`, `credit, creditHref`; `{off:true, tracks:[]}` when `musicOn` is false. `src` = `https://github.com/adrianofontanari/casa/releases/download/music-v1/<file>.m4a`; dev only: `settings.musicBase` (http/https) replaces the base. |

**Calendar parser** (`ics.js`): line folding, escapes, VEVENT, DTSTART/DTEND in UTC, TZID (IANA, Windows names,
the feed's own VTIMEZONE), floating times (X-WR-TIMEZONE, else the computer's zone), all-day, DURATION, RRULE
DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (ordinals), BYMONTHDAY, BYMONTH, BYSETPOS, WKST;
RDATE, EXDATE, RECURRENCE-ID overrides, STATUS:CANCELLED, X-WR-CALNAME, X-APPLE-CALENDAR-COLOR/COLOR. Unsupported
(event shown once, `partial:true`, a warning in `cals[].warnings`): BYYEARDAY, BYWEEKNO, BYHOUR/BYMINUTE/BYSECOND,
FREQ below DAILY. Limits: 5000 VEVENTs read per feed, 5000 events returned per feed, rule periods walked 200,000 per
feed and 400,000 per request; rules jump straight to the window (COUNT is still counted from DTSTART).

**Air sensor links** (`settings.airUrl`, pasted in the settings tab): AirGradient local `/measures/current` or cloud
API (`pm02Compensated` else `pm02`), PurpleAir local `/json` (mean of `pm2_5_atm` and `pm2_5_atm_b`), PurpleAir API v1
(`sensor["pm2.5_atm"]`), legacy PurpleAir map JSON (`PM2_5Value`), Sensor.Community (`sensordatavalues` P2/P1),
or any JSON with a PM2.5 key (`pm25, pm2_5, pm2.5, pm02, pm2_5_atm, ...`, up to 4 levels deep). Index: Open-Meteo's
documented bands (EEA 2024 for `eu`, US EPA for `us`), linear inside each band; `approx:true` because a sensor gives
an instant reading where the official index uses averages.

**Ambient** (`src/room/panels/ambient.js`, room side): `window.CasaAmbient = {names, play(name), stop(), volume(0..1),
playing(), state(), render(name)}`. Sounds are rendered once per sound into a looping 24 kHz buffer; the AudioContext is
suspended when nothing plays and on `casa:pause`, resumed on `casa:resume` if a sound was playing.

Tests: `node --test test/unit/integrations*.test.js` (fixtures); `LIVE=1 node --test test/unit/integrations*.test.js`
(real services; evidence in `test/evidence/live-*.json`). Real Obsidian checks (battery API, AAC decoding, https
media under the room CSP, CPU of the ambient synth): `node test/integrations-probe.mjs` -> `test/evidence/obsidian-probe.json`.


## /api/today (vault, read only, added 2026-11-14)

`GET` -> `{date: "YYYY-MM-DD", exists, path, text}`: today's daily note as plain text (capped at 20,000 characters), for the
mug on the desk. `POST` answers 405. The room puts the text into the DOM with `textContent` only.
