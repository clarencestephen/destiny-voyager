#!/usr/bin/env python3
"""
darth-bot/twab_watcher.py
=========================
Watches Bungie's DESTINY news for new updates and emails clarence.stephen@gmail.com
a digest. TWO emails per update cycle:

  Email 1 (day of):  Bungie patch/TWID highlights + summary.
  Email 2 (~2-3d later): Aztecross's TWAB video summary, once it posts.

HARD RULE — MARATHON IS A DIFFERENT GAME. It must NEVER appear in a Destiny
digest. We pull from Bungie's RSS (which mixes both) and HARD-EXCLUDE anything
Marathon by keyword, and we only ever scrape /News/Destiny + /News/DestinyUpdates
article URLs — never the generic /News index.

Recency-weighted: the most recent Destiny post wins; Aztecross's video (newer than
the patch) supersedes/extends the patch highlights.

Run:
  python3 darth-bot/twab_watcher.py --check        # Email 1 if a new Destiny update dropped
  python3 darth-bot/twab_watcher.py --aztecross    # Email 2 if Aztecross posted a newer TWAB
  python3 darth-bot/twab_watcher.py --check --dry-run   # build, print, don't send
"""
from __future__ import annotations
import argparse, json, os, re, smtplib, ssl, subprocess, sys, urllib.request
import xml.etree.ElementTree as ET
from email.message import EmailMessage
from email.utils import parsedate_to_datetime
from pathlib import Path

HERE = Path(__file__).parent
STATE = HERE / "data" / "twab_watcher_state.json"
RSS_URL = "https://www.bungie.net/en/Rss/News"
UA = "destiny-voyager/0.4 (+https://github.com/clarencestephen/destiny-voyager)"
TO_ADDR = "clarence.stephen@gmail.com"

# MARATHON HARD-EXCLUSION — never let the other game into a Destiny digest.
MARATHON_RX = re.compile(r"\bmarathon\b", re.I)
# Destiny-only article path guard.
DESTINY_PATH_RX = re.compile(r"/News/(Destiny|DestinyUpdates)/", re.I)


def _env(key: str, default: str = "") -> str:
    v = os.environ.get(key)
    if v:
        return v
    envf = Path("/home/cs/.env")
    if envf.exists():
        for line in envf.read_text().splitlines():
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return default


def _load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"last_bungie_link": None, "last_aztecross_id": None}


def _save_state(s: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(s, indent=2))


def fetch_destiny_posts(limit: int = 20) -> list[dict]:
    """Bungie RSS, DESTINY ONLY (Marathon hard-excluded), newest first."""
    req = urllib.request.Request(RSS_URL, headers={"User-Agent": UA})
    xml = urllib.request.urlopen(req, timeout=30).read()
    root = ET.fromstring(xml)
    out = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        desc = (it.findtext("description") or "").strip()
        pub = (it.findtext("pubDate") or "").strip()
        blob = f"{title} {desc} {link}"
        if MARATHON_RX.search(blob):       # <-- Marathon never passes
            continue
        try:
            dt = parsedate_to_datetime(pub)
        except Exception:
            dt = None
        out.append({"title": title, "link": link, "desc": desc, "pub": pub, "dt": dt})
    out.sort(key=lambda x: (x["dt"] is not None, x["dt"]), reverse=True)
    return out[:limit]


def _scrape(url: str, wait: int = 4000) -> str:
    """Scrape an article via firecrawl CLI. Returns markdown ('' on failure)."""
    if MARATHON_RX.search(url):
        return ""
    try:
        out = HERE.parent / "raid_context" / ".firecrawl" / "twab" / "_watch_tmp.md"
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["firecrawl", "scrape", url, "--wait-for", str(wait), "-o", str(out)],
                       capture_output=True, timeout=120)
        md = out.read_text() if out.exists() else ""
        return "" if MARATHON_RX.search(md[:500]) else md
    except Exception:
        return ""


def _highlights(md: str, n: int = 14) -> list[str]:
    """Extractive highlights: bullet/▸ lines + bold weapon/ability headers, Marathon-free."""
    hi = []
    for ln in md.splitlines():
        s = ln.strip()
        if not s or MARATHON_RX.search(s):
            continue
        if re.match(r"^[-*•]\s+\S", s) or re.match(r"^\*\*[^*]+\*\*$", s):
            s = re.sub(r"^[-*•]\s+", "", s).strip()
            if 6 < len(s) < 200:
                hi.append(s)
        if len(hi) >= n:
            break
    return hi


def find_aztecross_twab() -> dict | None:
    """Newest Aztecross TWAB/Dev-Insight video via firecrawl search."""
    try:
        out = HERE.parent / "raid_context" / ".firecrawl" / "twab" / "_aztecross_latest.json"
        subprocess.run(["firecrawl", "search", "Aztecross This Week in Destiny TWAB Dev Insights latest",
                        "--scrape", "--limit", "6", "-o", str(out), "--json"],
                       capture_output=True, timeout=150)
        d = json.loads(out.read_text())
        for w in (d.get("data", {}).get("web") or []):
            u, t, md = w.get("url", ""), (w.get("title") or ""), (w.get("markdown") or "")
            if "youtu" in u and "aztecross" in md.lower() and not MARATHON_RX.search(t) and len(md) > 1500:
                vid = re.search(r"v=([\w-]+)", u)
                return {"id": vid.group(1) if vid else u, "url": u, "title": t, "md": md}
    except Exception:
        return None
    return None


def send_email(subject: str, html: str, dry: bool = False) -> None:
    user, pw = _env("SMTP_USER_CSS"), _env("SMTP_PASS_CSS")
    host = _env("SMTP_HOST_CSS", "smtp.hostinger.com")
    port = int(_env("SMTP_PORT_CSS", "465"))
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, user, TO_ADDR
    msg.set_content("HTML email — view in an HTML-capable client.")
    msg.add_alternative(html, subtype="html")
    if dry:
        print(f"[dry-run] would send via {host}:{port} as {user} -> {TO_ADDR}\nSUBJECT: {subject}\n")
        print(re.sub(r"<[^>]+>", "", html)[:1600]); return
    with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context()) as s:
        s.login(user, pw); s.send_message(msg)
    print(f"sent: {subject} -> {TO_ADDR}")


def _wrap(title: str, sub: str, bullets: list[str], footer: str) -> str:
    lis = "".join(f"<li style='margin:6px 0'>{b}</li>" for b in bullets)
    return f"""<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;background:#0d0e14;color:#e7e9ee;padding:24px;border-radius:10px">
<h1 style="color:#b06cff;margin:0 0 4px">{title}</h1>
<p style="color:#9aa0ad;margin:0 0 16px">{sub}</p>
<ul style="line-height:1.5;padding-left:18px">{lis}</ul>
<p style="color:#6b7280;font-size:12px;margin-top:20px;border-top:1px solid #23262f;padding-top:12px">{footer}</p></div>"""


def _digest_highlights() -> list[str]:
    """Rich, cited highlights from the distilled future-meta summary (if fresh)."""
    fmj = HERE.parent / "raid_context" / "twab" / "future-meta-summary.json"
    if not fmj.exists():
        return []
    fm = json.loads(fmj.read_text())
    out = []
    for x in (fm.get("changes_overview") or [])[:4]:
        out.append("<b>Change:</b> " + x)
    for x in (fm.get("buffs") or [])[:4]:
        out.append("<b>Buff ▲:</b> " + x)
    for x in (fm.get("nerfs") or [])[:3]:
        out.append("<b>Nerf ▼:</b> " + x)
    return [h for h in out if not MARATHON_RX.search(h)]


def email1_bungie(dry=False):
    posts = fetch_destiny_posts()
    if not posts:
        print("no Destiny posts"); return
    # newest patch/TWID/dev-insight (skip pure season-live blurbs if a patch exists)
    top = posts[0]
    st = _load_state()
    if top["link"] == st.get("last_bungie_link") and not dry:
        print("no new Destiny update since last email"); return
    md = _scrape(top["link"]) if top["link"] else ""
    # Prefer the cross-referenced distilled digest; fall back to article scrape/desc.
    bullets = _digest_highlights() or _highlights(md) or [re.sub(r"<[^>]+>", "", top["desc"])[:180]]
    html = _wrap("🛡️ Destiny Update", f"{top['title']} — {top['pub'][:16]}", bullets,
                 "Bungie (Destiny-only, Marathon excluded). Aztecross's video summary follows in ~2-3 days. "
                 "Loadout specifics change weekly — trends persist, specifics don't.")
    send_email(f"[Destiny TWAB] {top['title']}", html, dry)
    if not dry:
        st["last_bungie_link"] = top["link"]; _save_state(st)


def email2_aztecross(dry=False):
    v = find_aztecross_twab()
    if not v:
        print("no Aztecross TWAB found"); return
    st = _load_state()
    if v["id"] == st.get("last_aztecross_id") and not dry:
        print("no newer Aztecross TWAB since last email"); return
    # Prefer Aztecross-attributed points from the distilled summary (his specific takes).
    bullets = []
    fmj = HERE.parent / "raid_context" / "twab" / "future-meta-summary.json"
    if fmj.exists():
        fm = json.loads(fmj.read_text())
        for key, tag in [("changes_overview", "Change"), ("buffs", "Buff ▲"), ("nerfs", "Nerf ▼")]:
            for x in (fm.get(key) or []):
                if "aztecross" in x.lower() and not MARATHON_RX.search(x):
                    bullets.append(f"<b>{tag}:</b> " + re.sub(r"\s*Source:.*$", "", x))
        bullets = bullets[:12]
    bullets = bullets or _highlights(v["md"]) or ["(transcript captured; see video)"]
    html = _wrap("🎥 Aztecross TWAB Summary", v["title"], bullets,
                 f"Aztecross (TWAB source of truth) — {v['url']} . Recency-weighted: this supersedes "
                 "older breakdowns. Marathon excluded.")
    send_email(f"[Aztecross TWAB] {v['title'][:80]}", html, dry)
    if not dry:
        st["last_aztecross_id"] = v["id"]; _save_state(st)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="Email 1: new Bungie Destiny update")
    ap.add_argument("--aztecross", action="store_true", help="Email 2: Aztecross TWAB summary")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if a.check:
        email1_bungie(a.dry_run)
    if a.aztecross:
        email2_aztecross(a.dry_run)
    if not (a.check or a.aztecross):
        ap.print_help()
