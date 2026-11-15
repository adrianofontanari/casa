# Test harness: Casa in a real, separate Obsidian

The harness runs the plugin inside a real Obsidian desktop app, in a **separate sandboxed instance**,
on a copy of a fixture vault, and drives it over the Chrome DevTools Protocol (CDP) with Playwright.
It never touches your own vaults or your own Obsidian settings, and it leaves your running Obsidian alone.

Requirements: macOS, Obsidian installed, Node 22+, and a Playwright package somewhere on disk
(the harness finds one in `~/.npm/_npx/*/node_modules/playwright`, `test/harness/node_modules`,
the global npm root, or `PLAYWRIGHT_PATH`). Nothing is installed by the harness.

## Commands

```sh
# Smoke test: launch, enable the plugin, print facts, close.
node test/harness/launch.mjs --vault empty            # uses main.js/manifest.json/styles.css at the repo root
node test/harness/launch.mjs --vault empty --stub     # uses test/harness/stub-plugin instead

# Drive the room and record everything (exit code 1 on console errors, failed steps,
# or external requests from Casa on an offline run).
node test/harness/run.mjs --vault empty
node test/harness/run.mjs --vault daily-core --steps "open,wait:3000,screenshot:room,object:goal,wait:500,screenshot:goal"
node test/harness/run.mjs --vault offline             # fails if Casa makes any external request

# CPU cost: visible room, hidden room (another tab active), blank note (control).
node test/harness/cpu.mjs --vault daily-core          # 3 x (10 s settle + 60 s measure)

# Close a leftover sandbox instance (only the sandbox one, never your own Obsidian).
node test/harness/launch.mjs --kill
```

Options shared by the three scripts: `--vault <name>`, `--stub`, `--build <dir>`, `--width 1440 --height 900`,
`--theme light|dark|system`, `--foreground` (keep the test window in front; default hands focus back).
`run.mjs` also takes `--steps`, `--allow <regex>` (repeatable, ignore a known console error), `--offline`,
`--scale css|device` (screenshot pixels, default css), `--no-reload`, `--keep-going`, `--timeout <s>`.
`cpu.mjs` takes `--seconds` (default 60) and `--settle` (default 10).

## Steps (`run.mjs --steps`, comma separated)

| Step | What it does |
|---|---|
| `open` / `open:command` | Opens the room via the command palette (types "Casa: Open room", Enter) / by command id |
| `button:<regex>` | Real click on the visible room button whose text matches (case-insensitive), e.g. `button:^Enter the room$` |
| `clickin:<selector>` | Real click on the first element matching a Playwright selector in the room, e.g. `clickin:.ag-task:has-text("Pay rent") .cp-check` |
| `fill:<selector>=<text>` | Clicks a room input and types the text |
| `key:<Key>` / `type:<text>` | Keyboard to whatever has focus (room or an Obsidian modal), e.g. `key:Escape`, `key:Enter` |
| `expect:<selector>` / `expectwin:<selector>` | Waits up to 6 s for a visible element in the room / in the Obsidian window (native modals: `.prompt`, `.modal-container .modal`) |
| `findfile:<regex>` | Searches every note of the sandbox vault for a matching line (waits up to 3 s), e.g. `findfile:^- \[x\] Pay rent` |
| `hotspots` | Lists every room hotspot (`.casa-hot`): rect, and whether a click at its centre reaches it |
| `wait:<ms>` | Sleeps |
| `screenshot:<name>` | Composite screenshot of the whole Obsidian window -> `test/out/<vault>/NN-<name>.png` |
| `click:<fx>/<fy>` | Real mouse click inside the room iframe at fractional coordinates (0..1) |
| `object:<id>` | Clicks an object by id (see "Clicking objects by id") |
| `read:<path>` | Reads a vault file back from disk (waits up to 3 s for it to appear) |
| `hide` / `show` | Another tab becomes active in the room's tab group / the room tab becomes active again; reports `casa:pause`/`casa:resume` events seen in the room |
| `blank` | Closes the room, opens `Blank.md` |
| `visibility` | `document.visibilityState` of the window and the room |
| `reload` | Reloads the Obsidian window |
| `sidebars:off` / `sidebars:on` | Collapses / expands both sidebars |

Default: `open,wait:3000,screenshot:room`. If the list contains `;`, steps are split on `;` (so arguments may contain
commas). Arguments may use the date tokens below (`read:Journal/<<date:0>>.md`). A failed step saves a
`NN-FAIL-<step>.png` screenshot. `--steps @e2e` runs the end-to-end preset: onboarding card visible, the folder prompt
and the calendar modal open from the card (and close with Esc), finish setup, open the agenda, add a task, tick it,
and find `- [x] ...` on disk.

`object:<id>` fails if something covers the hotspot's centre (an open panel, the onboarding card): close panels with
`key:Escape` first.

## Output (`test/out/`, git-ignored)

- `test/out/<vault>/NN-<name>.png`: screenshots. Always the composite window (DOM, iframe, canvases together).
  If a screenshot times out, animations are stopped and the same composite screenshot is retried. Never a single layer.
- `test/out/<vault>/console.json`: errors and warnings from the Obsidian window AND the room iframe
  (`console.error`, uncaught exceptions, browser log errors such as CSP or failed loads), each with `origin`:
  `room`, `plugin`, `window` or `frame`.
- `test/out/<vault>/network.json`: every request. `via: renderer` comes from the CDP Network domain (window and
  same-process iframes); `via: requestUrl` comes from a hook on Obsidian's `requestUrl` (it runs in the main process,
  so CDP never sees it); `origin` says who caused it: `room`, `plugin`, `obsidian` (Obsidian itself) or `harness-selftest`.
- `test/out/<vault>/summary.json`: steps, counts, separation checks, exit code.
- `test/out/<vault>/previous/`: the files of the run before (moved there at the start of each run).
- `test/out/cpu/<vault>.json`: the CPU measurement.

Obsidian itself fetches `community-plugin-deprecation.json` from GitHub when community plugins load. That request is
reported as `obsidian` and is not counted against Casa.

## Fixture vaults (`test/vaults/`)

| Vault | What it covers |
|---|---|
| `empty` | Nothing configured: core Daily notes and Templates off, no other plugins |
| `daily-core` | Core Daily notes: folder `Journal`, format `YYYY-MM-DD`, template `Templates/Daily` (stored without `.md`, as Obsidian writes it); past notes with goals and tasks, no note for today |
| `periodic` | Periodic Notes settings (`plugins/periodic-notes/data.json`, 0.x format, daily folder `Daily`, format `YYYY/MM/YYYY-MM-DD`) but the plugin itself is not installed; core Daily notes off |
| `tasks` | Tasks-plugin emoji format across notes: due today, scheduled today, overdue, upcoming, start date, done with done date, recurring, priorities, nested, a task inside a code block; Tasks plugin not installed |
| `offline` | Like `daily-core` plus today's note, plus `plugins/casa/data.json` with weather, webcam, air and music off and no calendar URL (a fictional city at 0,0 is set, so the off switches are what keeps it offline) |

Each vault has a `fixture.json` (description and generated files) and may have a `_gen/` folder of sources.
Dates are made at run time, relative to the run day: `<<date:N>>` becomes the local date N days from today as
`YYYY-MM-DD`, `<<date:N:FORMAT>>` uses `YYYY MM DD M D`. Tokens work in file contents and in `fixture.json`
paths (`"path": "Daily/<<date:-1:YYYY/MM/YYYY-MM-DD>>.md"`). Obsidian's own `{{date}}` template syntax is untouched.
Every sandbox copy also gets an empty `Blank.md` (control note for hide and CPU).

## How the separate instance works

- **Own profile:** `--user-data-dir=test/sandbox/profile`. Obsidian keeps its vault registry (`obsidian.json`),
  window state (`<vaultId>.json`), localStorage and caches there. Before each launch the harness writes
  `obsidian.json` with only the sandbox vault, `open: true`, and `updateDisabled: true` (no update download).
- **Own HOME:** `HOME=test/sandbox/home`. Obsidian 1.12+ binds its CLI socket at `$HOME/.obsidian-cli.sock` and
  first deletes whatever is there. Without this, the test instance would take over the CLI socket of your own Obsidian.
- **No keychain:** `--use-mock-keychain`.
- **Single-instance lock:** Electron's lock lives in the user data dir, so a different profile is a different app instance.
- **Window focus:** launched with `open -g -n`. Showing a window still activates the app, so the harness hides it
  (macOS gives focus back to the app that was in front), then shows it again without activating it and orders it
  behind the other windows. The window must stay on screen: a hidden app keeps running `requestAnimationFrame`
  but presents no frames, and screenshots time out. `--disable-backgrounding-occluded-windows` keeps the page
  `visible` while other windows cover it.
- **Trust dialog:** a fresh vault with community plugins shows "Trust author and enable plugins?". The harness
  clicks the enable button (falls back to `app.plugins.setEnable(true)` and says so), then closes Settings.
- **Reload:** `run.mjs` reloads the window once after installing its hooks, so the plugin's own startup is recorded.
- **One at a time:** `launch()` takes `test/sandbox/instance.lock` (owner pid, script, start time) and waits up to
  10 minutes while another script holds it, a sandbox instance runs, or the CDP port (9333) answers. Every script
  closes the instance IT started at the end, on Ctrl-C, and after a time limit, and never another script's instance.
  `launch.mjs --kill` refuses while the lock owner is alive (`--force` overrides).
- **Checks printed on every run** (`separation` in `summary.json`): every process in the test tree uses the sandbox
  profile, the Obsidian processes that were running before are still alive and not in the test tree, the real
  `~/.obsidian-cli.sock` is unchanged, the sandbox socket exists, and which app is frontmost.

`test/sandbox/` (profile, vault copies, logs) is git-ignored and disposable.

## Clicking objects by id

`object:<id>` asks the room where the object is, in CSS pixels inside the iframe:

1. `window.CasaDebug.hotspot(id)` returning `{x, y, w, h}` (preferred; the room engine should expose it), else
2. an element with `data-casa-id="<id>"`, else
3. it dispatches `casa:open` with `{detail: {id}}` and reports `how: "event casa:open (no hotspot found)"`
   (that skips hit-testing, so it does not prove the object is clickable).

Then it clicks the centre with a real mouse event through the window.

## CPU measurement

`cpu.mjs` builds the process tree of the sandbox instance from `ppid` (only processes started with the sandbox
profile), reads cumulative CPU time from `ps -o time` before and after the window, and reports the delta,
split by process type (main, gpu, renderer, utility). It never uses `ps %CPU`. Each state settles first.
The `window vis` and `room vis` columns are `document.visibilityState` read inside the window and the room at
start, middle and end of the measurement; `null` means there is no room.
