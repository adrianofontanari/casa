# GitHub repository settings

Settings for `adrianofontanari/casa`, to apply once when the repository is created.

## About

- **Description** (192 characters, limit 350):
  > A pixel room for your Obsidian vault: today's goal, tasks you can tick, your calendar and the real weather. Free, desktop only, no account, no telemetry. Make your second brain feel like home.
- **Website:** https://casa.adrianofontanari.com
- **Topics:** `obsidian`, `obsidian-plugin`, `obsidian-md`, `pixel-art`, `daily-notes`, `productivity`, `tasks`, `calendar`, `weather`, `cozy`
- **Social preview image:** `assets/social-preview.png`, 1280 x 640 px, 27 KB (a crop of the room screenshot). Upload it in **Settings > General > Social preview**; the API and `gh` cannot set it.

## Features

- **Issues:** on. Templates in `.github/ISSUE_TEMPLATE/` (bug report, small improvement). Blank issues off.
- **Discussions:** on. Categories: Announcements, Ideas, Q&A, Show and tell. The issue chooser sends ideas to Discussions.
- **Wiki:** off (docs live in `docs/`).
- **Projects:** off.
- **Releases:** created by `.github/workflows/release.yml` when a version tag is pushed.

## Commands

```sh
gh repo edit adrianofontanari/casa \
  --description "A pixel room for your Obsidian vault: today's goal, tasks you can tick, your calendar and the real weather. Free, desktop only, no account, no telemetry. Make your second brain feel like home." \
  --homepage "https://casa.adrianofontanari.com" \
  --enable-issues --enable-discussions \
  --enable-wiki=false --enable-projects=false \
  --add-topic obsidian,obsidian-plugin,obsidian-md,pixel-art,daily-notes,productivity,tasks,calendar,weather,cozy
```

## Release checklist

1. Set the same version in `manifest.json`, `versions.json` and `CHANGELOG.md`.
2. Push a tag equal to the version, with no `v` prefix: `git tag 0.1.0 && git push origin 0.1.0`.
3. The workflow builds, runs the unit tests, and creates a **draft** release with `main.js`, `manifest.json` and `styles.css`. It fails if the tag and `manifest.json` differ.
4. Check the draft on GitHub and press **Publish release**. Obsidian reads only published releases.

## Before the repository goes public

- Retake `assets/screenshot.png` (from `test/out/room/room-1440x900-14h.png`) and `assets/social-preview.png` (a 1280 x 640 crop) if the room changes. `assets/icon.png` is the 64 px house icon (`assets/icon-64.png`) scaled 4x, nearest neighbour.
- Check that `docs/dev/credits.md` lists every third-party item.
- Run the docs check: `python3 -I .github/scripts/docs_check.py`.
