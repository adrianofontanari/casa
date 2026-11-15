"""Proof for the room panels (src/room/panels). One headless Chromium at a time, local files only.

1. Composite screenshots (the whole viewport: room canvas + panel) of every panel at 1440x900 and
   800x600 in test/out/panels/<id>-<w>x<h>.png, plus a few empty/error states.
2. Behaviour checks, run on the panels alone (?room=0) where the console must stay at zero errors:
   keyboard (Tab stays inside, Esc closes, focus returns), goal Enter saves, agenda tick/add/412,
   cork add/move/delete/undo, TV loop stops on close and on casa:pause, audio keeps playing when
   the panel closes and the room pauses, open-settings / waitlist links, 700px width fits.
3. Console errors in the composite run are split by file: errors from panels must be zero; errors
   from other parts of the room are listed for their owner.

Run: ~/.venvs/main/bin/python -I test/panels_shots.py
"""
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOT / "test" / "panels-preview.html").as_uri()
OUT = ROOT / "test" / "out" / "panels"
SIZES = [(1440, 900), (800, 600)]
IDS = ["goal", "agenda", "calendar", "window", "tv", "typewriter", "headphones", "cork", "strip", "buddy", "chair", "backpack"]
STILL = "*{animation:none!important;transition:none!important;caret-color:transparent!important}"
MINE = re.compile(r"src/room/panels/(?!ambient|onboarding)|test/panels-")

results = []


def check(name, ok, info=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + ("" if ok or not info else " - " + str(info)))


def watch(page, sink):
    def on_console(m):
        if m.type == "error":
            loc = m.location.get("url", "") if m.location else ""
            sink.append((m.text, loc))
    page.on("console", on_console)
    page.on("pageerror", lambda e: sink.append((str(e), getattr(e, "stack", "") or "")))


def boot(page, query):
    page.goto(PAGE + "?shots=1" + query)
    page.wait_for_function("window.__previewReady && window.CasaPanels", timeout=10000)
    page.add_style_tag(content=STILL)


def open_panel(page, pid, wait_ms=350):
    page.evaluate("id => document.dispatchEvent(new CustomEvent('casa:open', {detail: {id}}))", pid)
    page.wait_for_selector(".cp-overlay .cp-panel", timeout=5000)
    page.wait_for_function("!document.querySelector('.cp-overlay .cp-state-loading')", timeout=8000)
    page.wait_for_timeout(wait_ms)


def close_panel(page):
    page.evaluate("CasaPanels.close()")


def order_matches():
    """The preview's script list must follow src/room/order.txt for the panel files."""
    order = [l.split()[0] for l in (ROOT / "src/room/order.txt").read_text().splitlines() if l.strip() and not l.strip().startswith("#")]
    html = (ROOT / "test/panels-preview.html").read_text()
    listed = re.findall(r"'(panels/[a-z]+\.js)'", html)
    want = [o for o in order if o.startswith("panels/") and o != "panels/onboarding.js"]
    return listed == want, (listed, want)


def composite(p):
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    browser = p.chromium.launch()
    try:
        for (w, h) in SIZES:
            page = browser.new_page(viewport={"width": w, "height": h})
            watch(page, errors)
            boot(page, "")
            page.wait_for_timeout(900)          # let the room paint once behind the panels
            for pid in IDS:
                open_panel(page, pid, 500 if pid in ("tv", "window") else 300)
                page.screenshot(path=str(OUT / f"{pid}-{w}x{h}.png"), full_page=False)
                close_panel(page)
            # empty and error states
            if w == 1440:
                page.evaluate("""() => { const d = window.__mockDB; d.calendar.events = []; d.calendar.cals = []; d.settings.calendarUrl = ''; }""")
                open_panel(page, "calendar")
                page.screenshot(path=str(OUT / "calendar-empty-1440x900.png"))
                close_panel(page)
                page.evaluate("() => { window.__casaFail.tasks = 501; }")
                open_panel(page, "agenda")
                page.screenshot(path=str(OUT / "agenda-501-1440x900.png"))
                close_panel(page)
                page.evaluate("() => { window.__casaFail = {weather: 'offline', forecast: 'offline', air: 500, webcam: 502}; }")
                open_panel(page, "window")
                page.screenshot(path=str(OUT / "window-errors-1440x900.png"))
                close_panel(page)
                page.evaluate("() => { window.__casaFail = {}; window.__mockDB.notes.notes = []; }")
                open_panel(page, "cork")
                page.screenshot(path=str(OUT / "cork-empty-1440x900.png"))
                close_panel(page)
            page.close()
    finally:
        browser.close()
    mine = [e for e in errors if MINE.search(e[0] + " " + e[1])]
    others = sorted({re.sub(r"\s+", " ", e[0])[:110] for e in errors if e not in mine})
    check("composite run: zero console errors from panel files", not mine, mine[:3])
    if others:
        print("NOTE  %d distinct console errors from other room files (not panels):" % len(others))
        for o in others:
            print("      - " + o)
    shots = sorted(OUT.glob("*.png"))
    check("screenshots written (%d)" % len(shots), len(shots) >= len(IDS) * len(SIZES) + 4)


def behaviour(p):
    errors = []
    browser = p.chromium.launch()
    try:
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        watch(page, errors)
        boot(page, "&room=0")
        ok, info = order_matches()
        check("preview loads panel files in order.txt order", ok, info)
        check("every panel id is registered", page.evaluate("ids => ids.every(i => CasaPanels.ids().includes(i))", IDS), page.evaluate("CasaPanels.ids()"))

        # keyboard: Tab stays inside, Esc closes, focus returns
        page.evaluate("() => { const b = document.createElement('button'); b.id = 'opener'; b.textContent = 'opener'; document.body.appendChild(b); b.focus(); }")
        open_panel(page, "agenda")
        check("dialog semantics: role=dialog, aria-modal, labelled by its title", page.evaluate(
            "(() => { const p = document.querySelector('.cp-panel'); const t = document.getElementById(p.getAttribute('aria-labelledby')); return p.getAttribute('role') === 'dialog' && p.getAttribute('aria-modal') === 'true' && !!t && t.textContent === 'Agenda'; })()"))
        inside = True
        for _ in range(30):
            page.keyboard.press("Tab")
            inside = inside and page.evaluate("document.querySelector('.cp-panel').contains(document.activeElement)")
        for _ in range(6):
            page.keyboard.press("Shift+Tab")
            inside = inside and page.evaluate("document.querySelector('.cp-panel').contains(document.activeElement)")
        check("agenda: Tab and Shift+Tab never leave the panel", inside)
        page.click(".ag-text >> nth=0")
        page.keyboard.press("Escape")
        check("agenda: Esc in an inline edit cancels the edit and keeps the panel", page.evaluate("!!document.querySelector('.cp-overlay') && !document.querySelector('.ag-edit')"))
        page.keyboard.press("Escape")
        check("agenda: Esc closes the panel", page.evaluate("!document.querySelector('.cp-overlay')"))
        check("focus returns to the element that opened the panel", page.evaluate("document.activeElement && document.activeElement.id === 'opener'"))

        # agenda writes
        open_panel(page, "agenda")
        page.click("input.cp-check >> nth=0")
        page.wait_for_timeout(300)
        check("agenda: tick writes toggle and the note's state", page.evaluate("__mockDB.tasks.today[0].done === true && __calls.some(c => c.route === 'tasks' && c.body && c.body.op === 'toggle')"))
        page.fill(".ag-add", "Water the basil")
        page.press(".ag-add", "Enter")
        page.wait_for_timeout(300)
        check("agenda: add puts the task in today's list", page.evaluate("[...document.querySelectorAll('.ag-text')].some(b => b.textContent === 'Water the basil')"))
        page.click(".ag-text >> nth=0")
        page.fill(".ag-edit", "Call the plumber at 9")
        page.press(".ag-edit", "Enter")
        page.wait_for_timeout(300)
        check("agenda: inline edit saves", page.evaluate("__calls.some(c => c.route === 'tasks' && c.body && c.body.op === 'edit' && c.body.text === 'Call the plumber at 9')"))
        page.evaluate("() => { __mockDB.tasks.rev = 'changed-in-obsidian'; }")
        page.click("input.cp-check >> nth=0")
        page.wait_for_timeout(400)
        check("agenda: 412 reloads and says nothing was written", page.evaluate("(document.querySelector('.ag-notice')||{}).textContent || ''").find("Nothing was written") >= 0)
        page.click(".ag-open >> nth=0")
        page.wait_for_timeout(150)
        check("agenda: open button calls /api/open with the task's path and line", page.evaluate("__calls.some(c => c.route === 'open' && c.body && c.body.path && Number.isInteger(c.body.line))"))
        close_panel(page)

        # goal
        page.evaluate("() => { window.__events = []; document.addEventListener('casa:data', e => __events.push(e.detail.kind)); }")
        open_panel(page, "goal")
        page.fill(".goal-input", "Ship the panels")
        page.press(".goal-input", "Enter")
        page.wait_for_timeout(900)
        check("goal: Enter saves, fires casa:data focus, closes", page.evaluate("__mockDB.focus.focus === 'Ship the panels' && __events.includes('focus') && !document.querySelector('.cp-overlay')"))

        # cork
        open_panel(page, "cork")
        n0 = page.evaluate("__mockDB.notes.notes.length")
        page.click("text=+ New post-it")
        page.keyboard.type("Pack the charger")
        page.click(".ck-bar")
        page.wait_for_timeout(400)
        check("cork: a new post-it is added", page.evaluate("__mockDB.notes.notes.length") == n0 + 1)
        box = page.locator(".ck-note .ck-grip").first.bounding_box()
        page.mouse.move(box["x"] + 10, box["y"] + 8)
        page.mouse.down()
        page.mouse.move(box["x"] + 140, box["y"] + 90, steps=6)
        page.mouse.up()
        page.wait_for_timeout(300)
        check("cork: drag saves a move", page.evaluate("__calls.some(c => c.route === 'notes' && c.body && c.body.op === 'move')"))
        page.click(".ck-note[data-id=n1] .ck-del")
        page.wait_for_timeout(300)
        check("cork: delete removes it", page.evaluate("__mockDB.notes.notes.length") == n0)
        page.click(".ck-toast .cp-link")
        page.wait_for_timeout(300)
        check("cork: undo puts it back", page.evaluate("__mockDB.notes.notes.length") == n0 + 1)
        page.focus(".ck-grip >> nth=0")
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(900)
        check("cork: arrow keys on the grip move a post-it", page.evaluate("__calls.filter(c => c.route === 'notes' && c.body && c.body.op === 'move').length >= 2"))
        close_panel(page)

        # TV loop: runs while open, stops on pause and on close, nothing left in Pace
        open_panel(page, "tv")
        page.click(".tv-knob >> nth=0")
        page.click(".tv-knob >> nth=0")   # a scene channel (150 ms)
        a = page.evaluate("CasaPanels.debug.tvPaints"); page.wait_for_timeout(1000); b = page.evaluate("CasaPanels.debug.tvPaints")
        check("tv: repaints while open (%d frames/s)" % (b - a), b - a >= 3)
        page.evaluate("document.dispatchEvent(new CustomEvent('casa:pause'))")
        a = page.evaluate("CasaPanels.debug.tvPaints"); page.wait_for_timeout(1000); b = page.evaluate("CasaPanels.debug.tvPaints")
        check("tv: no repaint while the room is paused", b == a, b - a)
        page.evaluate("document.dispatchEvent(new CustomEvent('casa:resume'))")
        page.wait_for_timeout(500)
        close_panel(page)
        a = page.evaluate("CasaPanels.debug.tvPaints"); page.wait_for_timeout(800); b = page.evaluate("CasaPanels.debug.tvPaints")
        check("tv: no repaint after close", b == a, b - a)
        check("no panel loop left in Pace after close", page.evaluate("Pace.list().filter(l => l.id.startsWith('panel-')).length === 0"), page.evaluate("Pace.list()"))
        check("tv: channel remembered in room state", page.evaluate("__calls.some(c => c.route === 'state' && c.body && 'tvChannel' in c.body) || (typeof Kept !== 'undefined' && Number.isInteger(Kept.get('tvChannel')))"))

        # headphones: sound keeps playing after close and pause; ambient via CasaAmbient
        open_panel(page, "headphones")
        page.click(".hp-track >> nth=0")
        page.wait_for_timeout(600)
        check("headphones: a track plays", page.evaluate("CasaHeadphones.playing() === 'Morning Desk'"), page.evaluate("CasaHeadphones.playing()"))
        close_panel(page)
        page.evaluate("document.dispatchEvent(new CustomEvent('casa:pause'))")
        page.wait_for_timeout(300)
        check("headphones: still playing after close + casa:pause", page.evaluate("CasaHeadphones.playing() === 'Morning Desk'"))
        page.evaluate("document.dispatchEvent(new CustomEvent('casa:resume'))")
        open_panel(page, "headphones")
        page.click(".hp-sounds .cp-btn >> text=Rain")
        page.wait_for_timeout(300)
        check("headphones: ambient rain through CasaAmbient", page.evaluate("CasaAmbient.playing() === 'rain' && CasaHeadphones.playing() === 'rain'"))
        page.click(".hp-play")
        page.wait_for_timeout(200)
        check("headphones: play button stops everything", page.evaluate("CasaHeadphones.playing() === null"))
        check("headphones: choice kept in room state", page.evaluate("Kept.get('headphones', null) && Kept.get('headphones').sound === 'rain'"))
        close_panel(page)

        # window, typewriter, buddy, soon, strip
        open_panel(page, "window")
        page.click("text=Use another webcam or your own air sensor")
        page.wait_for_timeout(200)
        check("window: webcam/sensor link calls /api/open-settings (no URL field in the room)", page.evaluate("__calls.some(c => c.route === 'open-settings') && !document.querySelector('.cp-window input[type=url]')"))
        check("window: weather credit, CAMS credit + full notice and webcam credit are visible links/text",
              page.evaluate("""(() => { const t = document.querySelector('.cp-window').innerText; const links = [...document.querySelectorAll('.cp-window .wn-credit .cp-link')].map(b => b.textContent);
                return links.includes('Weather data by Open-Meteo.com') && links.some(l => l.startsWith('Air quality: Copernicus')) && t.includes('Neither the European Commission nor ECMWF')
                  && links.includes(__mockDB.webcam.credit); })()"""))
        page.click("text=" + page.evaluate("__mockDB.webcam.credit"))
        page.wait_for_timeout(150)
        check("window: webcam credit opens its href through /api/link; strip shown full width", page.evaluate(
            "__calls.some(c => c.route === 'link' && c.body.url === __mockDB.webcam.href) && !!document.querySelector('.wn-full .wn-cam.wide')"))
        close_panel(page)
        open_panel(page, "typewriter")
        q1 = page.text_content(".tw-quote")
        page.click("text=Another")
        check("typewriter: roll shows another quote", page.text_content(".tw-quote") != q1)
        page.click("text=+ Add yours")
        page.fill("#tw-text", "Done is a nice place to be.")
        page.press("#tw-text", "Enter")
        page.wait_for_timeout(300)
        check("typewriter: add saves and shows it big", page.text_content(".tw-quote") == "Done is a nice place to be.")
        close_panel(page)
        open_panel(page, "buddy")
        page.click(".cp-buddy .cp-btn")
        page.wait_for_timeout(200)
        check("buddy: hide writes settings.buddy=false", page.evaluate("__mockDB.settings.buddy === false"))
        close_panel(page)
        open_panel(page, "chair")
        page.click("text=Join the waitlist")
        page.wait_for_timeout(200)
        check("chair: waitlist opens the notify URL through /api/link", page.evaluate("__calls.some(c => c.route === 'link' && c.body.url === 'https://casa.adrianofontanari.com/#notify')"))
        close_panel(page)
        open_panel(page, "strip")
        check("strip: battery level shown", re.search(r"\d+%", page.text_content(".st-pct") or "") is not None)
        close_panel(page)

        # error states: 501 and offline give a clear card, not a blank panel
        page.evaluate("() => { window.__casaFail = {quotes: 501, notes: 'offline'}; }")
        open_panel(page, "typewriter")
        check("typewriter: 501 shows 'Not in this version yet'", "Not in this version yet" in page.text_content(".cp-body"))
        close_panel(page)
        open_panel(page, "cork")
        check("cork: offline shows a retry card", "Try again" in page.text_content(".cp-body"))
        close_panel(page)
        page.evaluate("() => { window.__casaFail = {}; }")

        # 700px: no horizontal overflow, panel inside the viewport
        page.set_viewport_size({"width": 700, "height": 600})
        bad = []
        for pid in IDS:
            open_panel(page, pid, 200)
            fits = page.evaluate("""() => { const p = document.querySelector('.cp-panel').getBoundingClientRect();
                const b = document.querySelector('.cp-body');
                return p.left >= 0 && p.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth && b.scrollWidth <= b.clientWidth + 1; }""")
            if not fits:
                bad.append(pid)
            close_panel(page)
        check("700px wide: every panel fits with no horizontal scroll", not bad, bad)
        page.close()
    finally:
        browser.close()
    check("behaviour run (?room=0): zero console errors", not errors, errors[:5])


def main():
    with sync_playwright() as p:
        behaviour(p)
        composite(p)
    passed = sum(results)
    print("%d/%d checks passed" % (passed, len(results)))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
