# Troubleshooting

## The room does not open

- Check that Casa is enabled in **Settings > Community plugins**.
- Open it from the house icon in the left ribbon (**Open Casa**), or run **Casa: Open room in a new tab** from the command palette.
- Casa needs Obsidian desktop. It does not run on mobile.

## The room looks frozen

The room pauses whenever you cannot see it, including when Obsidian is not the active window. Click inside Obsidian and it starts again. In calm mode the room stays still on purpose.

## The banner or the agenda is empty

- Casa reads today's daily note. **Settings > Casa > Daily notes source** shows what Casa detected: the source, the folder and the date format. The welcome also shows today's note name.
- The note name must match the date format, for example `2026-03-14.md` for `YYYY-MM-DD`.
- The goal is a `goal:` property, the first line under a heading with "goal", "focus" or "today", or a `Goal:` line.
- Tasks are lines like `- [ ] text`. Empty checkboxes and checkboxes inside code blocks are ignored.
- No daily note today? Write a goal or a task in Casa and it creates the note.

## A tick did not reach my note

If the line changed since the room read it (for example you were typing in it), Casa writes nothing and the agenda reloads. Tick the task again.

## The calendar is empty

- Check that you pasted the **private** ICS link, not the calendar's web page. See [Calendar](calendar.md).
- Open the link in your browser: it should download a `.ics` file. If it does not, the link is wrong or has been reset.
- Work accounts can block shared calendar links. Ask your admin.
- In the calendar panel, a calendar that could not be read is marked "not loaded", with a short reason. The link itself is never shown.

## No weather in the window

- Check that **Weather data** is on and a city is chosen in **Settings > Casa**.
- Check your internet connection. Casa shows the last weather it has and refreshes when you are back online.

## The webcam is dark or missing

- At night the default buoy camera is dark, and sometimes it is offline: the window says so.
- Check that **Webcam** is on. Your own webcam link must point to a JPEG, PNG, GIF or WebP image under 2 MB.

## No music

- Check that **Music** is on in **Settings > Casa**.
- Lofi tracks need internet when you press play. Ambient sounds work offline.

## High CPU or a warm laptop

- Turn on calm mode in **Settings > Casa**.
- The room pauses when you cannot see it. Switch to another tab when you do not need it.

## Report a bug

Open an issue on [GitHub Issues](https://github.com/adrianofontanari/casa/issues/new/choose). Please include your Casa, Obsidian and operating system versions, and a made-up example line in the same shape as yours. Do not paste private notes or your calendar link.
