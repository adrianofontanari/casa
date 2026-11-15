"""Renders test/onboarding-preview.html in Chromium (installed Playwright), one browser at a time.

Writes test/out/onboarding/<step>-<w>x<h>.png for each step at 1440x900 and 800x600, then runs a
keyboard-only walk through the card and prints PASS/FAIL lines.

Run: ~/.venvs/main/bin/python -I test/onboarding_shots.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOT / "test" / "onboarding-preview.html").as_uri()
OUT = ROOT / "test" / "out" / "onboarding"
SIZES = [(1440, 900), (800, 600)]
STILL = "*{animation:none!important;transition:none!important}"

results = []


def check(name, ok, info=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (" - " + str(info) if info and not ok else ""))


def load(page, scenario, step):
    page.goto(PAGE + "?scenario=" + scenario)
    page.add_style_tag(content=STILL)
    page.wait_for_function("window.CasaOnboarding && window.CasaOnboarding.state()", timeout=5000)
    page.evaluate("s => window.CasaOnboarding.open(s)", step)
    page.wait_for_selector(".cob h2", timeout=5000)
    page.wait_for_timeout(250)


def shot(page, name, w, h):
    path = OUT / f"{name}-{w}x{h}.png"
    page.screenshot(path=str(path), full_page=False)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for (w, h) in SIZES:
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

            load(page, "found", "daily")
            check(f"{w}x{h} daily found text", "Found Daily notes in Journal/, named" in page.inner_text(".cob"), page.inner_text(".cob"))
            shot(page, "1-daily-found", w, h)

            load(page, "none", "daily")
            check(f"{w}x{h} daily none text", "No daily notes yet: Casa will keep today's note in Daily/." in page.inner_text(".cob"), page.inner_text(".cob"))
            shot(page, "1-daily-none", w, h)

            load(page, "found", "city")
            page.fill("#cob-city", "Lis")
            page.wait_for_selector("#cob-cities li", timeout=3000)
            check(f"{w}x{h} city results", page.locator("#cob-cities li").count() == 3)
            shot(page, "2-city", w, h)

            load(page, "nogeo", "city")
            page.fill("#cob-city", "Lis")
            page.wait_for_function("document.querySelector('.cob-status').textContent.includes('not available')", timeout=3000)
            check(f"{w}x{h} city without geocode route", page.is_disabled("#cob-city"))
            shot(page, "2-city-no-geocode", w, h)

            load(page, "found", "calendar")
            shot(page, "3-calendar", w, h)

            load(page, "done", "done")
            shot(page, "4-done", w, h)
            box = page.locator(".cob").bounding_box()
            check(f"{w}x{h} card inside viewport", box and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= w and box["y"] + box["height"] <= h, box)
            ctx.close()

        # Keyboard-only walk: Enter, type + arrows + Enter, Enter on the calendar, Enter the room.
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(PAGE + "?scenario=found")
        page.add_style_tag(content=STILL)
        page.wait_for_selector(".cob h2", timeout=5000)  # opens by itself (done:false)
        page.wait_for_timeout(100)
        check("auto-open on first run", page.inner_text(".cob h2") == "Your daily notes")
        check("focus on the primary button", page.evaluate("document.activeElement.textContent") == "Looks right")
        page.keyboard.press("Enter")
        page.wait_for_selector("#cob-city")
        page.wait_for_timeout(50)
        check("focus moves to the city field", page.evaluate("document.activeElement.id") == "cob-city")
        page.keyboard.type("Lis")
        page.wait_for_selector("#cob-cities li")
        page.keyboard.press("ArrowDown")
        check("arrow moves the active option", page.get_attribute("#cob-city", "aria-activedescendant") == "cob-city-1")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        page.wait_for_function("document.querySelector('.cob h2').textContent.startsWith('Your calendar')")
        check("city saved without a URL or folder", page.evaluate("JSON.stringify(window.__posts)") == '[{"step":"daily"},{"step":"city","city":{"name":"Lisbon, Portugal","lat":38.72,"lon":-9.14}}]',
              page.evaluate("JSON.stringify(window.__posts)"))
        # Tab stays inside the card.
        for _ in range(6):
            page.keyboard.press("Tab")
        check("tab stays inside the card", page.evaluate("!!document.activeElement.closest('.cob')"))
        page.focus(".cob-btn.primary")
        page.keyboard.press("Enter")  # Add my calendar: the native prompt is simulated
        page.wait_for_function("document.querySelector('.cob h2').textContent === 'Your room is ready'", timeout=3000)
        check("calendar step posts only the step", {"step": "calendar"} in page.evaluate("window.__posts"))
        check("done posted", {"step": "done"} in page.evaluate("window.__posts"))
        page.keyboard.press("Enter")
        page.wait_for_timeout(50)
        ev = page.evaluate("window.__events.map(e => e[0] + ':' + (e[1].kind || e[1].text))")
        check("closed after Enter the room", page.locator(".cob").count() == 0)
        check("casa:data settings and casa:hint fired", "casa:data:settings" in ev and any(e.startswith("casa:hint:Hi!") for e in ev), ev)

        # Escape skips the whole setup.
        page.goto(PAGE + "?scenario=none")
        page.wait_for_selector(".cob h2", timeout=5000)
        page.keyboard.press("Escape")
        page.wait_for_timeout(100)
        check("Escape skips setup", page.locator(".cob").count() == 0 and {"step": "done"} in page.evaluate("window.__posts"))
        ctx.close()
        browser.close()

    real = [e for e in errors if "favicon" not in e]
    check("no page errors", not real, real[:5])
    print(f"{sum(results)}/{len(results)} checks passed; screenshots in {OUT.relative_to(ROOT)}")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
