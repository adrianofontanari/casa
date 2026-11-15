# First run

The room appears right away, with sensible defaults. A moment later a small card walks you through three steps. Each one can be skipped, and the whole setup takes under a minute.

Links and folders are never typed inside the room: Casa opens Obsidian's own dialogs for them.

## 1. Your daily notes

The card shows where Casa found your daily notes and today's note name. Casa looks, in this order, at:

1. the core **Daily notes** settings;
2. the **Periodic Notes** settings (daily notes);
3. the **Journals** settings (the first daily journal);
4. a folder that already holds daily notes named `YYYY-MM-DD.md`;
5. otherwise Casa's default: `Daily/YYYY-MM-DD.md`.

If more than one is set up, the one with notes from the last month wins. Casa only reads these settings and never changes them.

Somewhere else? **Change folder** opens Obsidian's folder picker. Pick a folder, or type a new name to create it on the first write. The date format stays as it is; change it in **Settings > Casa > Daily notes source**.

No daily notes yet? Keep the default. Casa creates today's note the first time you write a goal or a task.

## 2. Your city

Type your city and pick it from the list. The search sends the name you type to the Open-Meteo geocoding service. The window then shows the real weather and air quality there.

**Skip, no weather** leaves the city empty: no weather or air quality requests.

## 3. Your calendar

**Add my calendar** opens an Obsidian dialog. Paste your calendar's private ICS link (`https://` or `webcal://`) and press Enter; Esc cancels. The dialog has short how-tos for Google, Outlook and iCloud, and [Calendar](calendar.md) has the full steps.

Skip it and the wall calendar stays empty, with no calendar requests.

## After the welcome

The buddy says hi and the objects pulse once. Click any object to open it: see [Objects](objects.md).

To see the welcome again: **Settings > Casa > Run the welcome again**.
