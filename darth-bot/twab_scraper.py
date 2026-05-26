"""
darth-bot/twab_scraper.py
==========================
Scrapes Bungie's official RSS feed and updates meta_state.json's
recent_patches with the latest news / TWID / hotfix posts.

Source: https://www.bungie.net/en/Rss/News  (RSS 2.0, no auth needed)

The feed includes everything from TWIDs (This Week In Destiny, the
renamed TWAB) to patch notes ("Update 9.0.1.2"), season/episode
launches, and Marathon dev blogs. Each item is categorized by title
keyword so the LLM can filter relevance:

    twid    — "This Week In Destiny ..." (weekly digest)
    patch   — hotfix / update / patch notes
    season  — Season N / Episode N launches
    news    — anything else (Marathon, AOTW, etc.)

Usage:
    # Show recent posts + update meta_state.json
    python3 -m darth-bot.twab_scraper

    # Programmatic
    from darth_bot.twab_scraper import fetch_recent, update_meta_state
    items = fetch_recent(limit=10)
    update_meta_state(items)
"""
from __future__ import annotations

import json
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

RSS_URL = "https://www.bungie.net/en/Rss/News"
USER_AGENT = "destiny-voyager/0.3 (https://github.com/clarencestephen/destiny-voyager)"
DEFAULT_LIMIT = 10

STATE_FILE = Path(__file__).parent / "data" / "meta_state.json"


def _categorize(title: str) -> str:
    t = title.lower()
    if "this week in" in t or "twid" in t or "twab" in t or "this week at bungie" in t:
        return "twid"
    if re.search(r"\b(hotfix|patch|update \d+\.\d+|build \d+\.\d+)\b", t):
        return "patch"
    if re.search(r"\b(season \d+|episode \d+|episode:|launch|launches)\b", t):
        return "season"
    return "news"


def _strip_html(s: str) -> str:
    """Crude HTML→text. RSS descriptions can contain <p>, <br>, &nbsp; etc."""
    s = re.sub(r"<[^>]+>", " ", s)
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&")
           .replace("&lt;", "<").replace("&gt;", ">")
           .replace("&quot;", '"').replace("&#39;", "'").replace("&#8217;", "'"))
    return re.sub(r"\s+", " ", s).strip()


def fetch_recent(limit: int = DEFAULT_LIMIT, url: str = RSS_URL) -> list[dict[str, Any]]:
    """Fetch + parse the RSS feed. Returns a list of dicts ready for meta_state."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as r:
        xml_bytes = r.read()
    root = ET.fromstring(xml_bytes)

    items = []
    for item in root.findall(".//item")[:limit]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if link and not link.startswith("http"):
            link = "https://www.bungie.net" + link
        raw_date = (item.findtext("pubDate") or "").strip()
        try:
            date = parsedate_to_datetime(raw_date).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            date = raw_date
        summary = _strip_html(item.findtext("description") or "")
        items.append({
            "date": date,
            "title": title,
            "category": _categorize(title),
            "url": link,
            "summary": summary[:280],
        })
    return items


def update_meta_state(items: list[dict[str, Any]]) -> Path:
    """Write items to meta_state.json's recent_patches field, preserving
    other state. If the file doesn't exist yet, bootstrap from BASELINE."""
    if STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    else:
        from meta_state import BASELINE
        state = dict(BASELINE)
    state["recent_patches"] = items
    state["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state["generated_at_ts"] = int(time.time())
    state.pop("_baseline", None)
    STATE_FILE.parent.mkdir(exist_ok=True)
    STATE_FILE.write_text(
        json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return STATE_FILE


def main() -> None:
    items = fetch_recent(DEFAULT_LIMIT)
    for it in items:
        print(f"[{it['date']}] [{it['category']:6}] {it['title']}")
        if it["summary"]:
            print(f"           {it['summary'][:140]}")
        print(f"           {it['url']}")
        print()
    path = update_meta_state(items)
    print(f"✓ updated {path} with {len(items)} items")


if __name__ == "__main__":
    main()
