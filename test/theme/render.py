"""Render the theme preview to PNG (dev only).

Usage: python3 test/theme/render.py
Writes test/out/theme/preview.png (+ buddy-x4.png, dog-x4.png crops) and
exits non-zero on any page error or if the page did not finish.
Local files only: every network request other than file:// is aborted.
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "test" / "out" / "theme"
OUT.mkdir(parents=True, exist_ok=True)


def main():
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=1)
        page.route("**/*", lambda r: r.continue_() if r.request.url.startswith("file://") else r.abort())
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto((ROOT / "test" / "theme-preview.html").as_uri())
        try:
            page.wait_for_function("window.__done === true", timeout=10000)
        except Exception:
            print("FAIL: the page did not finish:", errors)
            sys.exit(1)
        status = page.inner_text("#status")
        page.screenshot(path=str(OUT / "preview.png"), full_page=True)
        stats = page.evaluate("""() => {
          const T = window.CasaTheme;
          const res = T.palette(window.__BASE);
          const moods = Object.keys(T.buddy.moods), gaits = Object.keys(T.pet.gaits);
          // every frame non-empty and inside its box
          const filled = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; };
          const b = moods.flatMap((m) => [...Array(T.buddy.moods[m].n).keys()].map((f) => filled(T.buddy.canvas(m, f))));
          const g = gaits.flatMap((m) => [...Array(T.pet.gaits[m].n).keys()].map((f) => filled(T.pet.canvas(m, f))));
          // draw cost: 1000 draws of a cached frame
          const c = document.createElement('canvas'); c.width = 400; c.height = 200; const x = c.getContext('2d');
          const t0 = performance.now(); for (let i = 0; i < 1000; i++) { T.buddy.draw(x, 10, 10, 2, i, 'idle'); T.pet.draw(x, 100, 10, 2, 'walk', i); }
          const ms = performance.now() - t0;
          return { moods, gaits, buddyMin: Math.min(...b), petMin: Math.min(...g), frames: b.length + g.length,
                   drawMsPer1000: +ms.toFixed(1), wall: res.plast, steps: gaits.map((k) => [k, T.pet.gaits[k].step || 0]),
                   tweakIds: Object.keys(T.tweak) };
        }""")
        for sel, name in (("#buddy", "buddy.png"), ("#dog", "dog.png"), ("#pal", "palette.png"), ("#room", "room-swatch.png")):
            page.locator(sel).screenshot(path=str(OUT / name))
        b.close()
    print("status:", status)
    print("stats:", stats)
    if errors:
        print("ERRORS:", errors)
        sys.exit(1)
    if stats["buddyMin"] < 200 or stats["petMin"] < 300:
        print("FAIL: an empty frame")
        sys.exit(1)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
