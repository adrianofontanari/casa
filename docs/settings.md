# Settings

Open **Settings > Casa**. Changes apply to the room right away.

| Setting | What it does | Default |
|---|---|---|
| Calm mode | Keeps the room still: no animations. | Off |
| Show buddy | Shows or hides the buddy. | On |
| Units | Metric (°C, km/h) or imperial (°F, mph). | Metric |
| Music | Music and ambient sounds in the room. Nothing is downloaded until you press play. Off: no music requests. | On |
| **Weather** | | |
| Weather data | Weather, forecast and daylight for your city. Off: no weather requests. | On |
| City / Find a city | Type a name and press **Search**, then pick your city. The **x** clears it. No city: no weather or air quality requests. | None |
| **Calendar** | | |
| Calendar link (ICS) | Your events on the wall calendar. Empty: no calendar and no request. See [Calendar](calendar.md). | Empty |
| **Window and air** | | |
| Webcam | A live view through the window. Off: no webcam requests. | On |
| Webcam image link | A still image that refreshes, shown through the window. Empty: the default NOAA BuoyCAM. | Empty |
| Air quality | Air quality for your city. Off: no air quality or sensor requests. | On |
| Air quality sensor link | Data from a sensor you trust, shown as the air at home. Works with AirGradient, PurpleAir, Sensor.Community, or any JSON with a PM2.5 value. | Empty |
| **Daily notes** | | |
| Daily notes source | **Auto-detect** (shows what Casa found) or **Custom folder and format**. | Auto-detect |
| Folder, File name format, Template | With a custom source: the folder (empty means the vault root), the date format of the file name (for example `YYYY-MM-DD`), and an optional template for a new daily note. | - |
| **Welcome** | | |
| Run the welcome again | Opens the room and walks through the first-time setup again. | - |

Links (calendar, webcam, sensor) and folders change only here or in Obsidian's own dialogs. The room cannot read or change them; it only knows whether a link is set.

Casa saves these settings in `<your vault>/.obsidian/plugins/casa/data.json`.

## No network at all

Turn off **Weather data**, **Air quality**, **Webcam** and **Music**, and leave **Calendar link** empty. Casa then makes no network request. See [Privacy](privacy.md).

## Performance

The room pauses whenever you cannot see it: another tab in front, a collapsed sidebar, a minimised window or Obsidian in the background. It starts again when you come back. Calm mode keeps it still even while you look at it.
