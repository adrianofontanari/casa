# Calendar

Casa reads your calendar from a private **ICS link**, the address calendar apps use to share a calendar as a file. Add it in either place:

- in the welcome: **Add my calendar** opens an Obsidian dialog; paste the link and press Enter;
- in **Settings > Casa > Calendar link (ICS)**.

Links starting with `https://` or `webcal://` work; Casa reads `webcal://` over `https://`. Casa only reads the link and never changes your calendar. It shows today's events and the week, recurring events included.

**Keep the link private.** Anyone with it can read that calendar. Casa stores it in its settings file inside your vault, so it travels with your vault if you sync or share it. The room never sees the link, and error messages never show it.

Menu names below can change over time. If a step does not match, search your calendar's help for "ICS" or "iCal".

## Google Calendar

1. Open Google Calendar on the web and go to **Settings** (the gear icon).
2. Under **Settings for my calendars**, select the calendar.
3. Open **Integrate calendar**.
4. Copy **Secret address in iCal format**.

A work or school account may hide this option. Ask your admin, or use a personal calendar.

## Outlook

1. Open Outlook on the web and go to **Settings > Calendar > Shared calendars**.
2. Under **Publish a calendar**, choose the calendar and **Can view all details**.
3. Select **Publish**.
4. Copy the **ICS** link.

A work account may block publishing. Ask your admin.

## iCloud

On a Mac, in the Calendar app:

1. Control-click the calendar in the sidebar and choose **Share Calendar**.
2. Tick **Public Calendar**.
3. Copy the link. It starts with `webcal://`: paste it as it is.

On iCloud.com, open Calendar, select the share button next to the calendar, turn on **Public Calendar** and copy the link.

## Other calendars

Most calendar apps can share a calendar as an ICS or iCal link. Look for "subscribe", "publish", "export" or "secret address".

## How often it refreshes

Casa asks for the calendar at most every 15 minutes while the room is open. If the provider does not answer, the room keeps the last events it has.

## Remove the calendar

Empty **Calendar link (ICS)** in **Settings > Casa**. Casa stops reading it straight away.

## Not showing?

See [Troubleshooting](troubleshooting.md#the-calendar-is-empty).
