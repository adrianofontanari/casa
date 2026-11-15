# Plugin shell: bridge, pause, build

Owner: Agent 1. Files: `manifest.json`, `versions.json`, `build.py`, `styles.css`, `src/plugin/`.

## Names users see
- View type `casa-room`, tab title "Casa", icon `home` (Lucide house). Ribbon icon `home`, tooltip "Open Casa".
- Commands (Obsidian prefixes the plugin name): **Casa: Open room** (`casa:open-room`, reveals the open room or opens one in a new tab)
  and **Casa: Open room in a new tab** (`casa:open-room-new-tab`).
- First ever load opens the room once in a new tab (flag `meta.firstOpenDone` in data.json; also on `onUserEnable`).

## Build
`python3 -I build.py` writes `main.js` at the repo root. `python3 -I build.py --dist DIR` writes `main.js`, `manifest.json`,
`styles.css` into DIR instead (use it to install into a test vault: `--dist <vault>/.obsidian/plugins/casa`).
`--root DIR` builds another tree (used by the tests).

1. Plugin modules: every `.js`/`.json` under `src/plugin`, `src/vault`, `src/integrations` (not `src/plugin/room-side/`, not `*.test.js`)
   becomes `function (module, exports, require)` in a registry. Relative requires resolve at runtime (`./x`, `./x.js`, `./x/index.js`),
   so dynamic paths work. `require('obsidian')` (any bare name) goes to Obsidian's require; bare names other than `obsidian` print a WARNING.
2. Room document: `src/room/room.html` (placeholder if missing) + `room.css` + each line of `src/room/order.txt`
   (first token of the line, relative to `src/room/`; `#` lines skipped; `.js` inlined as `<script>`, `.css` as `<style>` after room.css;
   missing files, duplicates and anything under `dev/` WARN and are skipped). Room scripts not listed are printed as a note.
   `<head>` gets the CSP meta and the bridge shim first; styles go at the end of `<head>`, scripts at the end of `<body>`.
   Each script ends with `//# sourceURL=casa-room/<file>` so DevTools names it.
3. The document is embedded as a JSON string, exposed to the plugin as module `src/plugin/room-doc.generated.js`.
4. Syntax: every plugin module (as a CommonJS function) and every room script (as a classic script) is compiled with node `vm`,
   then `node --check` runs on main.js. Any error: exit 1, file and message on stderr.

## Room iframe
`<iframe sandbox="allow-scripts" srcdoc=...>`. No `allow-same-origin`: with it, a srcdoc frame shares Obsidian's origin and can reach
`parent.require` (Node, the file system). Without it the room has an opaque origin (`location.origin === "null"`) and talks to Obsidian
only through postMessage. Consequences for room code:
- `localStorage`/`sessionStorage` are in-memory replacements (they throw otherwise). Persist with `/api/state`.
- No popups, forms or navigation. `window.open(url)` and clicks on `<a href="https://...">` go to `/api/link` (system browser).
- CSP: `default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob: https:;
  font-src data:; connect-src data: blob:; worker-src blob:`. The room cannot fetch the network itself; no `eval`/`new Function`.
  Audio may stream from https (music). Use `preload="none"` so nothing loads before the user presses play.
- `navigator.getBattery` exists in the sandboxed frame (checked in Chromium); whether it resolves inside Obsidian is for the harness to confirm.

## Bridge protocol
Room -> plugin: `{casa:1, id, route, method, query, body}`; `route` is the path after `/api/` (`"tasks"`), `query` an object of strings,
`body` the parsed JSON (or the raw string if it is not JSON, or null). Plugin -> room: `{casa:1, id, status, json}`.
The shim resolves fetch with a real `Response` (`res.ok`, `res.status`, `res.json()` work). No answer in 60 s: 504.
The plugin answers only frames that belong to a Casa view (`ev.source === iframe.contentWindow`), in the main window and in popouts.

Plugin -> room, no id:
- `{casa:1, pause:true|false}`: the shim dispatches `casa:pause` / `casa:resume` on `document` (only on change), makes
  `document.visibilityState` "hidden" / `document.hidden` true while paused, and fires `visibilitychange`. `CasaBridge.isPaused()` reads it.
- `{casa:1, event:'casa:data', detail:{kind}}`: re-dispatched as `CustomEvent('casa:data')`. Sent after settings change (`kind:"settings"`)
  and whenever a module calls `ctx.notify(kind)`. `casa:welcome` is sent by "Run the welcome again".

## Pause
The room runs only while all are true, per view: the window is visible (`visibilitychange`, covers minimise), the iframe has a box
on screen (IntersectionObserver, plus a re-check on `layout-change`, `active-leaf-change`, `resize`: covers background tabs and collapsed
sidebars), and the window has focus (`blur`/`focus`; focus inside the room counts via `document.hasFocus()`). The state is re-sent when
the iframe (re)loads. Note for the harness: a window that never gets focus keeps the room paused.

## Routes and handler modules
Table in `src/plugin/routes.js`. Shell routes (in `src/plugin/shell-routes.js`):
- `GET /api/state` -> the store. `POST {key:value}` (or `{state:{...}}`) merges, `null` deletes -> `{ok:true, state}`. Max 1 MB.
- `GET /api/settings` -> the room view of the settings: `calendarUrl`, `webcamUrl`, `airUrl` read `"(set)"` or `""`, never the URL.
- `POST /api/settings` partial -> room view plus `ignored:[keys]`. The room is untrusted, so only `calm, buddy, units, musicOn,
  webcamOn, airOn, onboarded, city` are applied (`store.ROOM_WRITABLE`); everything else (URL and path settings, `weatherOn`, unknown keys)
  is dropped and listed in `ignored`. One bad allowlisted value (e.g. city name > 80 chars, lat outside -90..90) -> 400, nothing applied.
  URL/path settings change only in the settings tab, or plugin-side through `ctx.saveSettings` (trusted code, full validation).
- `POST /api/open-settings` -> opens Obsidian settings on Casa's tab `{ok}`; 501 if this Obsidian cannot (it uses `app.setting`,
  which is not in the public typings, guarded). Any body (e.g. `{section}`) is accepted and ignored.
- `POST /api/open {path, line?, newTab?}` -> opens a vault note (never replaces the room tab) `{ok}`; 404 if missing, 400 if outside the vault.
- `POST /api/link {url}` -> https only, no credentials -> system browser `{ok}`.

Vault and integration routes: the router looks, in order, for
1. `src/<owner>/index.js` exporting `routes: { <route>: handler }`, then
2. `src/<owner>/<file>.js` (`file` from the table, default the route name: `notes` -> `postits.js`, `forecast`/`geocode` -> `weather.js`)
   exporting `routes: { <route>: handler }` or being the handler itself.
A handler is `async (req, ctx) => json` or an object `{ GET(req, ctx), POST(req, ctx) }` (any case; `handle` as catch-all).
Return plain JSON (200) or `{status, json}`; throw an Error with `.status` (e.g. 412 + message "stale") for an error reply.
No module: 501. Module fails to load: 500. Handler throws: 500 `{error}`. Wrong method: 405. Unknown route: 404.
An owner's `index.js` may serve extra routes not in the table. Optional `setup(ctx)` export: called once (index.js at layout ready,
others on first load); may return a cleanup function, called on unload.

The first argument is the request `{route, method, query, body}` merged over the context plus `settings` (a snapshot), so
`get(ctx)`-style handlers reading `ctx.app`, `ctx.body`, `ctx.settings`, `ctx.moment` work too; the second argument is the context. `ctx`:
`app`, `obsidian`, `moment` (Obsidian's), `plugin`, `http(url, {method, headers, body, contentType, timeout}) -> {status, headers, json, text, arrayBuffer}`
(requestUrl; `json`/`text`/`arrayBuffer` are properties, `json` is null for non-JSON; rejects on network error or 20 s timeout),
`requestUrl`, `getSettings()`, `saveSettings(patch)`, `getState()`, `setState(patch)`, `getData(ns)`, `setData(ns, value)`
(private per-module storage in data.json), `notify(kind, detail?)`, `registerEvent(ref)`.

## Settings (`GET /api/settings`)
`{calm, buddy, units:"metric"|"imperial", city:{name,lat,lon}|null, weatherOn, calendarUrl, webcamOn, webcamUrl, airOn, airUrl,
musicOn, onboarded, dailyMode:"auto"|"custom", dailyFolder, dailyFormat, dailyTemplate}` (plugin side; the room sees URLs masked). Defaults: calm false, buddy true, units metric, city null,
weatherOn/webcamOn/airOn/musicOn true, URLs empty, onboarded false, dailyMode auto, dailyFormat `YYYY-MM-DD`.
Off states (no request at all): `weatherOn:false` or no city (weather, forecast, air), `airOn:false`, `webcamOn:false`,
`calendarUrl:""`, `musicOn:false`; music also makes no request until play. Integrations must check these.
"Run the welcome again" sets `onboarded:false`, sends `casa:welcome` and opens the room: onboarding treats `onboarded === false` as "show it".

## Tests
`node --test test/unit/` (router, store, shell routes, plugin wiring with an obsidian stub, shim in node vm, build.py output and failures).
`~/.venvs/main/bin/python -I test/unit/shell_iframe_check.py`: the real sandboxed srcdoc iframe in Chromium (bridge, opaque origin,
storage, CSP, pause, links) and console errors of the current room scripts.
