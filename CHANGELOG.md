# Changelog

All notable changes to Casa are listed here. Versions follow
[Semantic Versioning](https://semver.org/). Each version is also a
[GitHub release](https://github.com/adrianofontanari/casa/releases) with
`main.js`, `manifest.json` and `styles.css`.

## 0.1.1 - 2026-11-15

### Fixed
- README: the Copernicus air quality notice no longer shows a `[year]`
  placeholder.
- Room stylesheet: dropped a duplicate `image-rendering` line and the
  `ui-monospace` font name, which Obsidian does not support. The room looks
  the same.

## 0.1.0 - 2026-11-15

First public version.

### Added
- The room: a pixel room in its own tab, with seasons and light that follow
  your computer's clock. Ribbon icon "Open Casa" and the commands
  "Casa: Open room" and "Casa: Open room in a new tab".
- Today's goal on the banner, read from a `goal:` property, a goal heading or
  a `Goal:` line in today's note; written in place or as `## Today's goal`.
- The agenda: today's tasks and the next 7 days. Tick, add and edit them.
  Reads Tasks plugin dates without needing the plugin.
- The wall calendar: events from a private calendar link (ICS), recurring
  events included. Read-only.
- The window: weather, forecast and air quality from Open-Meteo (CAMS), an
  optional home air sensor, and a webcam strip (default: NOAA BuoyCAM 46026).
- The TV with nine hand-drawn channels, the typewriter (your quotes or 20
  built-in public-domain ones), the headphones player (CC0 lofi music and
  ambient sounds made on your computer), the cork board (post-its in
  `Casa/Post-its.md`), the power strip (battery), Pebble the penguin buddy
  and Biscuit, a dog who naps and wanders around the room.
- Put away: any object can leave the room and come back from a box on the
  floor.
- A three-step welcome: daily notes, city, calendar. Links and folders are
  entered in Obsidian's own dialogs, never in the room.
- Works with no other plugins and no templates. Reads core Daily notes,
  Periodic Notes or Journals settings when they exist.
- Calm mode, show buddy, units, and an off switch for every online source.
- "Coming soon" cards for the chair and the backpack, with a button to the
  packs waitlist.
- The room pauses whenever you cannot see it.
