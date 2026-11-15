"""Real-browser check of the room iframe: sandbox, bridge, CSP, pause, storage.

Builds main.js into a temp folder, takes the room document out of it, loads it in a
`sandbox="allow-scripts"` srcdoc iframe in Chromium (the engine Obsidian runs on), with a
parent page that answers the bridge like the plugin does. Also reports console errors
from the room scripts that exist today.

Run: ~/.venvs/main/bin/python -I test/unit/shell_iframe_check.py
(needs the Python Playwright package and its Chromium; no network)
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]

PARENT = """<!doctype html><meta charset="utf-8"><title>parent</title>
<iframe id="f" sandbox="allow-scripts" style="width:800px;height:500px;border:0"></iframe>
<script>
const f = document.getElementById('f');
window.__msgs = [];
window.addEventListener('message', (ev) => {
  if (ev.source !== f.contentWindow) return;
  const d = ev.data;
  if (!d || d.casa !== 1) return;
  window.__msgs.push(d);
  const reply = (status, json) => ev.source.postMessage({ casa: 1, id: d.id, status, json }, '*');
  if (d.route === 'report') { window.__report = d.body; return reply(200, { ok: true }); }
  if (d.route === 'please-pause') { reply(200, {}); return ev.source.postMessage({ casa: 1, pause: true }, '*'); }
  if (d.route === 'missing') return reply(501, { error: 'not available' });
  reply(200, { route: d.route, method: d.method, query: d.query, body: d.body });
});
</script>"""

PROBE = r"""<script>
(async () => {
  const r = {};
  const res = await fetch('/api/echo?a=1', { method: 'POST', body: JSON.stringify({ x: 1 }) });
  r.echo = { status: res.status, json: await res.json() };
  r.missing = (await fetch('/api/missing')).status;
  try { void parent.document.title; r.parentAccess = 'allowed'; } catch (e) { r.parentAccess = e.name; }
  try { localStorage.setItem('a', 'b'); r.storage = localStorage.getItem('a'); } catch (e) { r.storage = 'threw ' + e.name; }
  try { await fetch('https://example.com/'); r.external = 'allowed'; } catch (e) { r.external = 'blocked ' + e.name; }
  r.battery = typeof navigator.getBattery;
  r.origin = String(location.origin);
  r.paused = await new Promise((done) => {
    document.addEventListener('casa:pause', () => done(document.visibilityState + '/' + window.CasaBridge.isPaused()), { once: true });
    fetch('/api/please-pause');
  });
  window.open('https://example.com/x');
  await fetch('/api/report', { method: 'POST', body: JSON.stringify(r) });
})();
</script>"""


def main():
    with tempfile.TemporaryDirectory() as tmp:
        dist = Path(tmp) / "dist"
        b = subprocess.run(["python3", "-I", str(ROOT / "build.py"), "--dist", str(dist)],
                           capture_output=True, text=True)
        if b.returncode != 0:
            print(b.stderr)
            sys.exit("build failed")
        main_js = (dist / "main.js").read_text(encoding="utf-8")
        m = re.search(r'var __casaRoomDoc = ("(?:[^"\\]|\\.)*");', main_js)
        room = json.loads(m.group(1))
        cut = room.lower().rfind("</body>")
        doc = room[:cut] + PROBE + room[cut:] if cut != -1 else room + PROBE
        parent = Path(tmp) / "parent.html"
        parent.write_text(PARENT, encoding="utf-8")

        errors = []
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
            page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
            page.goto(parent.as_uri())
            page.evaluate("(d) => { document.getElementById('f').srcdoc = d; }", doc)
            page.wait_for_function("() => !!window.__report", timeout=15000)
            report = page.evaluate("() => window.__report")
            msgs = page.evaluate("() => window.__msgs.map(m => m.route)")
            browser.close()

    checks = [
        ("bridge round trip", report["echo"] == {"status": 200, "json": {"route": "echo", "method": "POST", "query": {"a": "1"}, "body": {"x": 1}}}),
        ("501 passes through", report["missing"] == 501),
        ("opaque origin: parent not reachable", report["parentAccess"] == "SecurityError"),
        ("origin is null", report["origin"] == "null"),
        ("in-memory storage fallback", report["storage"] == "b"),
        ("CSP blocks direct network", report["external"].startswith("blocked")),
        ("pause event + visibilityState hidden", report["paused"] == "hidden/true"),
        ("window.open goes to /api/link", "link" in msgs),
    ]
    ok = True
    for name, passed in checks:
        ok = ok and passed
        print(("PASS " if passed else "FAIL ") + name)
    print("info: navigator.getBattery in the sandboxed frame: " + report["battery"])
    room_errors = [e for e in errors if "example.com" not in e]
    print("info: console errors from room scripts: %d" % len(room_errors))
    for e in room_errors[:20]:
        print("  " + e[:300])
    print("report: " + json.dumps(report))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
