"""Check the public docs before a release.

Run from anywhere:  python3 -I .github/scripts/docs_check.py
Exit code 0 when every check passes (warnings allowed), 1 otherwise.

Checks:
  1. required files exist (README.md, LICENSE, manifest.json, CHANGELOG.md, docs pages);
  2. README has every disclosure heading the Obsidian developer policies ask for;
  3. links are well-formed and relative links (and links to this repo's main branch)
     point to files and headings that exist; known placeholder assets are warnings;
  4. LICENSE is PolyForm Noncommercial 1.0.0 with the added permission for use at work;
  5. no personal or Italian strings in the public docs;
  6. Markdown renders (needs the `markdown` package; skipped with a note if missing);
  7. YAML files parse (needs PyYAML; skipped with a note if missing);
  8. the repository description in docs/dev/github-repo.md is at most 350 characters.
"""
import pathlib
import re
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
REPO_PREFIXES = (
    "https://github.com/adrianofontanari/casa/blob/main/",
    "https://github.com/adrianofontanari/casa/tree/main/",
    "https://raw.githubusercontent.com/adrianofontanari/casa/main/",
)
# Files other agents or the owner still have to provide: missing ones are warnings.
PLACEHOLDERS = {"assets/icon.png", "assets/screenshot.png", "assets/social-preview.png"}
OWNED_BY_OTHERS = {"manifest.json"}

REQUIRED_FILES = [
    "README.md", "LICENSE", "manifest.json", "CHANGELOG.md",
    "docs/install.md", "docs/first-run.md", "docs/objects.md", "docs/settings.md",
    "docs/calendar.md", "docs/privacy.md", "docs/faq.md", "docs/troubleshooting.md",
    "docs/dev/github-repo.md", "docs/dev/credits.md",
    ".github/ISSUE_TEMPLATE/bug.yml", ".github/ISSUE_TEMPLATE/idea.yml",
    ".github/ISSUE_TEMPLATE/config.yml", ".github/workflows/release.yml",
]
README_HEADINGS = [
    "What it does", "Install", "First run", "Works without other plugins or templates",
    "How Casa reads and writes your notes", "Settings", "Disclosures", "Network use",
    "Payments", "Accounts", "Ads and self-promotion", "Files outside your vault",
    "Telemetry", "Privacy", "Coming soon: packs", "Desktop only", "Support", "Licence",
    "Credits", "Author",
]
README_MUST_CONTAIN = [
    "open-meteo.com", "Copernicus", "https://casa.adrianofontanari.com/#notify",
    "Coming soon", "Join the waitlist", "station 46026", "music-v1", "Weather data by Open-Meteo.com", "Neither the European Commission nor ECMWF", "Adriano Fontanari", "https://adrianofontanari.com",
    "docs/dev/credits.md", "makes no network request",
]
# Case-sensitive personal strings, then Italian words (whole words, case-insensitive).
# Personal strings to block live in a local, untracked file (one per line), so this public script
# never lists them. Without the file only the generic checks run.
_PRIVATE = ROOT / ".private-words"
PERSONAL = ["/Users/"] + ([w.strip() for w in _PRIVATE.read_text().splitlines() if w.strip() and not w.startswith("#")]
                          if _PRIVATE.exists() else [])
ITALIAN = [
    "che", "della", "delle", "degli", "sono", "questo", "questa", "anche", "oggi", "giorno",
    "grazie", "ciao", "perché", "perche", "cosa", "fatto", "quando", "sempre", "tutto",
    "niente", "molto", "nota", "il", "lo", "gli", "una", "non", "con", "del",
]

errors, warnings, notes = [], [], []


def rel(p):
    return p.relative_to(ROOT).as_posix()


def public_files():
    out = [ROOT / "README.md", ROOT / "LICENSE", ROOT / "CHANGELOG.md"]
    out += sorted((ROOT / "docs").rglob("*.md"))
    out += sorted(p for p in (ROOT / ".github").rglob("*") if p.is_file() and p.suffix in (".yml", ".yaml", ".md"))
    return [p for p in out if p.exists()]


def slug(heading):
    """GitHub-style anchor for a heading."""
    h = re.sub(r"[`*_]", "", heading.strip().lower())
    h = re.sub(r"[^\w\- ]", "", h)
    return h.replace(" ", "-")


def anchors(path):
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    return {slug(m.group(1)) for m in re.finditer(r"^#{1,6}\s+(.+?)\s*#*\s*$", text, re.M)}


def links(text):
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"`[^`\n]*`", "", text)
    for m in re.finditer(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)", text):
        yield m.group(1)
    for m in re.finditer(r"(?:src|href)=\"([^\"]+)\"", text):
        yield m.group(1)


def check_link(src, url):
    where = f"{rel(src)}: {url}"
    if url.startswith("mailto:"):
        return
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme in ("http", "https"):
        if parsed.scheme != "https":
            errors.append(f"link is not https: {where}")
        if not parsed.netloc or " " in url:
            errors.append(f"malformed URL: {where}")
        for prefix in REPO_PREFIXES:
            if url.startswith(prefix):
                target_rel, _, frag = url[len(prefix):].partition("#")
                resolve(src, ROOT / target_rel, frag, where)
        return
    if parsed.scheme:
        errors.append(f"unexpected link scheme: {where}")
        return
    target_rel, _, frag = url.partition("#")
    target = src if not target_rel else (src.parent / target_rel)
    resolve(src, target, frag, where)


def resolve(src, target, frag, where):
    target = target.resolve()
    try:
        key = target.relative_to(ROOT).as_posix()
    except ValueError:
        errors.append(f"link leaves the repository: {where}")
        return
    if not target.exists():
        if key in PLACEHOLDERS:
            warnings.append(f"placeholder not provided yet: {key} (from {rel(src)})")
        else:
            errors.append(f"dead link: {where}")
        return
    if frag and target.suffix == ".md" and frag not in anchors(target):
        errors.append(f"missing heading #{frag}: {where}")


def main():
    for f in REQUIRED_FILES:
        if not (ROOT / f).exists():
            (warnings if f in OWNED_BY_OTHERS else errors).append(f"missing file: {f}")

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    found = {m.group(1).strip() for m in re.finditer(r"^#{2,3}\s+(.+?)\s*$", readme, re.M)}
    for h in README_HEADINGS:
        if h not in found:
            errors.append(f"README heading missing: {h}")
    for s in README_MUST_CONTAIN:
        if s not in readme:
            errors.append(f"README does not mention: {s}")

    lic = (ROOT / "LICENSE").read_text(encoding="utf-8") if (ROOT / "LICENSE").exists() else ""
    for s in ("PolyForm Noncommercial License 1.0.0", "Required Notice:", "Additional permission: use at work", "not legal advice", "Adriano Fontanari", "credits.md"):
        if s not in lic:
            errors.append(f"LICENSE does not contain: {s}")

    files = public_files()
    italian = re.compile(r"(?<![\w\-'/.])(" + "|".join(ITALIAN) + r")(?![\w\-'/])", re.I)
    for p in files:
        text = p.read_text(encoding="utf-8")
        for s in PERSONAL:
            if s in text:
                errors.append(f"personal string {s!r} in {rel(p)}")
        for n, line in enumerate(text.splitlines(), 1):
            m = italian.search(line)
            if m:
                errors.append(f"Italian word {m.group(1)!r} in {rel(p)}:{n}")
            if "—" in line:
                errors.append(f"em dash in {rel(p)}:{n} (use -)")
        if p.suffix == ".md" or p.name == "README.md":
            for url in links(text):
                check_link(p, url)

    try:
        import markdown  # noqa: PLC0415
        for p in files:
            if p.suffix == ".md":
                html = markdown.markdown(p.read_text(encoding="utf-8"), extensions=["tables", "fenced_code"])
                if not html.strip():
                    errors.append(f"renders empty: {rel(p)}")
        notes.append(f"markdown: rendered {sum(p.suffix == '.md' for p in files)} files with python-markdown {markdown.__version__}")
    except ImportError:
        notes.append("markdown: SKIPPED, python-markdown not installed (pip install markdown)")

    try:
        import yaml  # noqa: PLC0415
        ymls = [p for p in files if p.suffix in (".yml", ".yaml")]
        for p in ymls:
            try:
                yaml.safe_load(p.read_text(encoding="utf-8"))
            except yaml.YAMLError as e:
                errors.append(f"YAML error in {rel(p)}: {e}")
        notes.append(f"yaml: parsed {len(ymls)} files")
    except ImportError:
        notes.append("yaml: SKIPPED, PyYAML not installed (pip install pyyaml)")

    gh = ROOT / "docs/dev/github-repo.md"
    if gh.exists():
        m = re.search(r"^\s*> (.+)$", gh.read_text(encoding="utf-8"), re.M)
        if not m:
            errors.append("github-repo.md: description quote not found")
        elif len(m.group(1)) > 350:
            errors.append(f"repo description is {len(m.group(1))} characters (max 350)")
        else:
            notes.append(f"repo description: {len(m.group(1))} characters")

    notes.append(f"scanned {len(files)} public files")
    for n in notes:
        print("NOTE  " + n)
    for w in warnings:
        print("WARN  " + w)
    for e in errors:
        print("FAIL  " + e)
    print(f"\n{len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
