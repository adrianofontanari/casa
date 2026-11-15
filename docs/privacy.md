# Privacy

Casa stays home. It reads your vault on your computer and keeps no copy anywhere else.

- **No account.** Nothing to sign up for.
- **No telemetry.** No analytics, no crash reports, no usage counts.
- **No AI.** Casa never sends your notes to an AI or to any server.
- **No files outside your vault.** Casa reads and writes only inside it.
- **No code downloads.** Casa does not download or run code, and updates come only through Obsidian.

## What leaves your computer

Only the requests below, and only for the sources you leave on. None happens at startup.

| Request | Sent to | Contains | Off switch |
|---|---|---|---|
| Weather and forecast | Open-Meteo (`api.open-meteo.com`) | Your city's coordinates | **Weather data** off, or no city |
| City search | Open-Meteo (`geocoding-api.open-meteo.com`) | The name you type | Do not search |
| Air quality | Open-Meteo (`air-quality-api.open-meteo.com`) | Your city's coordinates | **Air quality** off, or no city |
| Indoor air | Your own sensor link | A request to that link | **Air quality** off, or no sensor link |
| Calendar | The host in your calendar link | A request to that link | Empty calendar link |
| Default webcam | NOAA National Data Buoy Center (`www.ndbc.noaa.gov`) | A request for the latest BuoyCAM image of station 46026 | **Webcam** off |
| Your webcam | Your own image link | A request for that image | **Webcam** off |
| Music | This repository's GitHub release `music-v1` | A request for the music file, only when you press play | **Music** off |

Like any web request, these reach the service with your computer's IP address. Each service has its own privacy policy. Turn every source off and Casa makes no network request: see [Settings](settings.md#no-network-at-all).

## What Casa stores

- **Your notes:** only the changes you make in the room (goal, tasks, post-its, quotes). See the [README](../README.md#how-casa-reads-and-writes-your-notes).
- **Settings and room state:** your city, links and room preferences, in `<your vault>/.obsidian/plugins/casa/data.json`.

The room runs in a sandbox: it cannot read files, reach the network or open pages by itself, and it never sees your calendar, webcam or sensor links. Every request goes through the plugin.

Your calendar link works like a password. It travels with your vault if you sync it or put it in a public Git repository, so leave the settings file out of anything you share. Error messages in the room never show the link.

## Links you click

The "Coming soon" cards contain a waitlist button. Casa opens it in your browser only when you click it. The waitlist on [casa.adrianofontanari.com](https://casa.adrianofontanari.com/#notify) has its own privacy policy on that site.
