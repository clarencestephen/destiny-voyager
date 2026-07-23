#!/usr/bin/env python
"""
dv-poh-watch.py — Pit of Heresy email alerts for Darth_Bankai.

Two triggers, checked 4x daily (05:20/11:20/17:20/23:20 UTC — first check lands 20 min after reset) by dv-poh-watch.timer:

  1. FEATURED WEEK — the Bungie public-milestone dungeon rotator includes
     Pit of Heresy  ->  "go farm Apostate's Blade (Tier 5 window is open)".
  2. POSSIBLE BOSS-FARM FIX — a new Bungie news/patch post mentions
     Pit of Heresy  ->  forwarded for review. Context: during the
     2026-06-16 featured week the FINAL BOSS (easiest farm) dropped
     bugged 7-energy armor, so set farming was second-encounter only.

State lives in ~/.local/state/dv-poh-watch.json (no duplicate alerts;
first run grandfathers existing news posts silently). Email goes out via
Hostinger SMTP (info@clarencestephen.com) to clarence.stephen@gmail.com.

Manual:  dv-poh-watch.py [--test]   (--test just sends a test email)
"""
from __future__ import annotations

import json
import os
import re
import smtplib
import sys
import time
from email.message import EmailMessage
from pathlib import Path

import httpx

KYBER_URL = "https://kyberscorner.com/destiny2/weekly-featured-raids-and-dungeons/"
STATE_PATH = Path.home() / ".local/state/dv-poh-watch.json"
ACTIVITIES_JSON = Path("/home/cs/workspace/Destiny 2/destiny2-loadout-toolkit/web/public/activities.json")
DUNGEON_ROTATOR_MILESTONE = 526718853   # same registry as web/worker/src/this-week.ts
BUNGIE_API = "https://www.bungie.net/Platform"
BUNGIE_RSS = "https://www.bungie.net/en/Rss/News"

SMTP_HOST, SMTP_PORT = "smtp.hostinger.com", 465
MAIL_TO = "clarence.stephen@gmail.com"


def env(key: str) -> str:
    v = os.environ.get(key, "")
    if v:
        return v
    for line in Path("/home/cs/.env").read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def send_mail(subject: str, body: str) -> None:
    user, pw = env("SMTP_USER_CSS"), env("SMTP_PASS_CSS")
    if not user or not pw:
        raise SystemExit("SMTP_USER_CSS / SMTP_PASS_CSS missing from /home/cs/.env")
    msg = EmailMessage()
    msg["From"] = f"Destiny Voyager <{user}>"
    msg["To"] = MAIL_TO
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=30) as s:
        s.login(user, pw)
        s.send_message(msg)
    print(f"[mail] sent: {subject}")


def load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {}


def save_state(st: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(st, indent=1))


def rotation_week_id() -> str:
    """Current rotation week, identified by its Tuesday 17:00 UTC start date."""
    t = time.time()
    # walk back to the most recent Tuesday 17:00 UTC
    day = 86400
    ts = t - ((t - 17 * 3600) % day)          # today 17:00 UTC or earlier
    while time.gmtime(ts).tm_wday != 1 or ts > t:   # tm_wday: Tuesday == 1
        ts -= day
    return time.strftime("%Y-%m-%d", time.gmtime(ts))


def featured_dungeons() -> tuple[list[str], str]:
    """This week's featured dungeons, parsed from Kyber's Corner.

    NOTE: the Bungie public /Destiny2/Milestones/ endpoint stopped carrying
    the dungeon rotator in the current sandbox (verified 2026-07-11 — only
    per-raid milestones remain), so the community page is the live source.
    The parse anchors on the literal card label "Weekly Featured Dungeon".
    Returns (names, week_id) — week_id doubles as the alert dedupe key.
    """
    import html as html_mod
    r = httpx.get(KYBER_URL, headers={"User-Agent": "Mozilla/5.0"},
                  timeout=30, follow_redirects=True)
    r.raise_for_status()
    text = html_mod.unescape(r.text).replace("\u2019", "'")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    names: set[str] = set()
    try:
        acts = json.loads(ACTIVITIES_JSON.read_text())
        known = {v["n"].split(":")[0].strip().replace("\u2019", "'")
                 for v in acts.values() if v.get("t") == "Dungeon"}
        for n in known:
            if re.search(r"Weekly Featured Dungeon\s+" + re.escape(n), text, re.I):
                names.add(n)
    except Exception:
        pass
    return sorted(names), rotation_week_id()


def poh_news() -> list[dict]:
    """Bungie RSS items mentioning Pit of Heresy."""
    r = httpx.get(BUNGIE_RSS, timeout=30)
    r.raise_for_status()
    out = []
    for m in re.finditer(r"<item>(.*?)</item>", r.text, re.S):
        block = m.group(1)
        def tag(name: str) -> str:
            t = re.search(rf"<{name}>(.*?)</{name}>", block, re.S)
            v = t.group(1) if t else ""
            v = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", v, flags=re.S)
            return re.sub(r"<[^>]+>", "", v).strip()
        title, link, desc = tag("title"), tag("link"), tag("description")
        if "pit of heresy" in (title + " " + desc).lower():
            out.append({"title": title, "url": link, "summary": desc[:400]})
    return out


def main() -> int:
    if "--test" in sys.argv:
        send_mail(
            "[Destiny Voyager] PoH watch — test alert",
            "This is a test of the Pit of Heresy watcher.\n\n"
            "You will get real emails when:\n"
            "  1. Pit of Heresy becomes the FEATURED dungeon (Apostate's Blade Tier-5 farm window), and\n"
            "  2. a new Bungie news/patch post mentions Pit of Heresy (possible boss-farm armor fix).\n\n"
            "Checked 4x daily (20 min after each reset + every 6h). — dv-poh-watch on Kurosaki",
        )
        return 0

    st = load_state()
    first_run = not st
    changed = False

    # ---- 1. featured dungeon check -------------------------------------
    try:
        names, end = featured_dungeons()
        poh = any(n.lower().startswith("pit of heresy") for n in names)
        print(f"[featured] {names or '(none resolved)'} | PoH={poh}")
        if poh and st.get("last_poh_week") != end:
            send_mail(
                "🏴 Pit of Heresy is FEATURED — Apostate's Blade farm window open",
                "Pit of Heresy is this week's featured dungeon!\n\n"
                f"Rotation week starting: {end} — farmable (lockout removed, Tier 5 rolls) until next Tuesday 17:00 UTC\n\n"
                "Apostate's Blade set farm plan (from ThatUnkown's guide):\n"
                "  • Class item drops fastest from ENCOUNTER 1\n"
                "  • Armor: ENCOUNTER 2 — unless the boss drop bug is fixed\n"
                "  • BOSS encounter is the easiest farm, but last featured week it\n"
                "    dropped bugged 7-energy armor — test one boss clear first and\n"
                "    check the armor's energy/tier before committing to boss farming.\n\n"
                "Wishlist: destiny-voyager.clarencestephen.com/wishlist\n"
                "Rotation: destiny-voyager.clarencestephen.com/this-week/rotation",
            )
            st["last_poh_week"] = end
            changed = True
    except Exception as e:
        print(f"[featured] check failed: {e}")

    # ---- 2. news / patch-note watch -------------------------------------
    try:
        seen = set(st.get("seen_urls", []))
        fresh = [p for p in poh_news() if p["url"] not in seen]
        if fresh:
            if first_run:
                print(f"[news] first run — grandfathering {len(fresh)} existing post(s) silently")
            else:
                body_items = "\n\n".join(f"• {p['title']}\n  {p['url']}\n  {p['summary']}" for p in fresh)
                send_mail(
                    "📰 Bungie post mentions Pit of Heresy — boss-farm fix?",
                    "A new Bungie news/patch post mentions Pit of Heresy. If it patches the\n"
                    "final-boss armor drops (the 7-energy bug), the easiest Apostate's Blade\n"
                    "farm is back on the menu.\n\n" + body_items +
                    "\n\n— dv-poh-watch (4x daily)",
                )
            seen.update(p["url"] for p in fresh)
            st["seen_urls"] = sorted(seen)[-200:]
            changed = True
        else:
            print("[news] nothing new mentioning PoH")
    except Exception as e:
        print(f"[news] check failed: {e}")

    if changed or first_run:
        st.setdefault("seen_urls", [])
        st["last_checked"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        save_state(st)
    return 0


if __name__ == "__main__":
    sys.exit(main())
