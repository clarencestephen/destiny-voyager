"""
darth-bot/kb/scrape_raid_sources.py
===================================
Targeted multi-source scraper for raid + dungeon encounter detail.

SOURCE HIERARCHY (most-trusted → least-trusted):
  1. AUTHORITATIVE — mechanics + facts (use as source of truth):
     • blueberries.gg     — structured encounter guides
     • help.bungie.net    — official mechanics + bug acknowledgments
     • destinypedia       — already scraped separately; edited wiki
  2. SUPPLEMENTAL — cheese, variations, edge cases (cite, don't trust blindly):
     • r/raidsecrets      — community spreadsheets, peer-vetted cheese
                            (only fetched, tagged 'supplemental', NEVER used
                            to settle a mechanics dispute)

EXPLICITLY DROPPED:
  • r/DestinyTheGame — popularity-driven, complaints/memes, low signal
  • Any source ranked purely by upvotes without peer-review process

When sources conflict on mechanics, AUTHORITATIVE wins. Supplemental gets
documented as a permutation only if multiple authoritative sources are silent.

Output: data/scrape/<source>/<activity_slug>/<doc>.md with frontmatter.

Run:
    python3 -m darth_bot.kb.scrape_raid_sources
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path

import httpx
import trafilatura
from bs4 import BeautifulSoup

from config import SCRAPE_DIR

USER_AGENT = "darth-bot/0.1 (+https://github.com/clarencestephen/destiny-voyager)"
HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}
DELAY = 1.5

# Canonical roster — 10 raids + 10 dungeons (current as of 2026-05).
ACTIVITIES = [
    # (slug, name, type, blueberries_slug, search_query)
    ("root-of-nightmares",    "Root of Nightmares",     "raid",
     "root-of-nightmares-raid-guide",    "Root of Nightmares"),
    ("salvations-edge",       "Salvation's Edge",       "raid",
     "salvations-edge-raid-guide",       "Salvation's Edge"),
    ("desert-perpetual",      "Desert Perpetual",       "raid",
     "desert-perpetual-raid-guide",      "Desert Perpetual"),
    ("vow-of-the-disciple",   "Vow of the Disciple",    "raid",
     "vow-of-the-disciple-raid-guide",   "Vow of the Disciple"),
    ("deep-stone-crypt",      "Deep Stone Crypt",       "raid",
     "deep-stone-crypt-raid-guide",      "Deep Stone Crypt"),
    ("garden-of-salvation",   "Garden of Salvation",    "raid",
     "garden-of-salvation-raid-guide",   "Garden of Salvation"),
    ("last-wish",             "Last Wish",              "raid",
     "last-wish-raid-guide",             "Last Wish raid"),
    ("kings-fall",            "King's Fall",            "raid",
     "kings-fall-raid-guide",            "Kings Fall raid"),
    ("vault-of-glass",        "Vault of Glass",         "raid",
     "vault-of-glass-raid-guide",        "Vault of Glass"),
    ("crotas-end",            "Crota's End",            "raid",
     "crotas-end-raid-guide",            "Crota's End"),

    ("equilibrium",           "Equilibrium",            "dungeon",
     "equilibrium-dungeon-guide",        "Equilibrium dungeon"),
    ("sundered-doctrine",     "Sundered Doctrine",      "dungeon",
     "sundered-doctrine-dungeon-guide",  "Sundered Doctrine"),
    ("warlords-ruin",         "Warlord's Ruin",         "dungeon",
     "warlords-ruin-dungeon-guide",      "Warlord's Ruin"),
    ("ghosts-of-the-deep",    "Ghosts of the Deep",     "dungeon",
     "ghosts-of-the-deep-dungeon-guide", "Ghosts of the Deep"),
    ("spire-of-the-watcher",  "Spire of the Watcher",   "dungeon",
     "spire-of-the-watcher-dungeon-guide", "Spire of the Watcher"),
    ("duality",               "Duality",                "dungeon",
     "duality-dungeon-guide",            "Duality dungeon"),
    ("grasp-of-avarice",      "Grasp of Avarice",       "dungeon",
     "grasp-of-avarice-dungeon-guide",   "Grasp of Avarice"),
    ("prophecy",              "Prophecy",               "dungeon",
     "prophecy-dungeon-guide",           "Prophecy dungeon"),
    ("pit-of-heresy",         "Pit of Heresy",          "dungeon",
     "pit-of-heresy-dungeon-guide",      "Pit of Heresy"),
    ("shattered-throne",      "Shattered Throne",       "dungeon",
     "shattered-throne-dungeon-guide",   "Shattered Throne"),
]


def slugify(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()[:80] or "untitled"


def write_doc(source: str, activity_slug: str, title: str, url: str, body: str):
    out_dir = SCRAPE_DIR / source / activity_slug
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = out_dir / f"{slugify(title)}.md"
    fm = [
        "---",
        f'title: "{title.replace(chr(34), chr(39))}"',
        f"source: {source}",
        f"activity_slug: {activity_slug}",
        f"url: {url}",
        f"scraped: {int(time.time())}",
        "---",
    ]
    fname.write_text("\n".join(fm) + "\n\n" + body, encoding="utf-8")
    return fname


async def fetch(client: httpx.AsyncClient, url: str) -> str | None:
    try:
        r = await client.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
        if r.status_code != 200:
            return None
        return r.text
    except Exception as e:
        return None


async def try_blueberries(client, activity_slug: str, bb_slug: str, name: str) -> int:
    """Try several URL patterns blueberries.gg has used."""
    patterns = [
        f"https://blueberries.gg/raids/{bb_slug}/",
        f"https://blueberries.gg/dungeons/{bb_slug}/",
        f"https://blueberries.gg/guides/{bb_slug}/",
        f"https://blueberries.gg/{bb_slug}/",
    ]
    for url in patterns:
        html = await fetch(client, url)
        if not html or "<title>404" in html or "page not found" in html.lower():
            await asyncio.sleep(DELAY)
            continue
        extracted = trafilatura.extract(html, include_tables=True,
                                        output_format="markdown")
        if extracted and len(extracted) > 500:
            soup = BeautifulSoup(html, "lxml")
            title = (soup.title.string if soup.title else name).strip()
            write_doc("blueberries", activity_slug, title, url, extracted)
            print(f"  ✓ blueberries.gg → {activity_slug}: {title[:50]} ({len(extracted)} chars)")
            await asyncio.sleep(DELAY)
            return 1
        await asyncio.sleep(DELAY)
    print(f"  ✗ blueberries.gg → {activity_slug}: no page found")
    return 0


async def try_reddit_search(client, sub: str, activity_slug: str, query: str,
                              limit: int = 15) -> int:
    """Pull top posts of all-time from a subreddit matching the raid name."""
    url = (f"https://www.reddit.com/r/{sub}/search/.json?"
           f"q={query.replace(' ', '+')}&restrict_sr=1&sort=top&t=all&limit={limit}")
    html = await fetch(client, url)
    if not html:
        await asyncio.sleep(DELAY)
        return 0
    try:
        data = json.loads(html)
    except Exception:
        return 0
    children = data.get("data", {}).get("children", [])
    n = 0
    for child in children:
        d = child["data"]
        if d.get("is_video") or d.get("over_18"):
            continue
        body = d.get("selftext", "")
        title = d.get("title", "")
        if not body or len(body) < 300:  # only substantive posts
            continue
        permalink = "https://reddit.com" + d.get("permalink", "")
        write_doc(f"reddit-{sub}", activity_slug, title, permalink, body)
        n += 1
    if n:
        print(f"  ✓ r/{sub} → {activity_slug}: {n} posts")
    else:
        print(f"  ✗ r/{sub} → {activity_slug}: 0 substantive posts")
    await asyncio.sleep(DELAY)
    return n


async def try_bungie_help(client, activity_slug: str, name: str) -> int:
    """Search Bungie help for the activity. Bungie posts known-issue and
    mechanic clarifications here that other sources miss."""
    q = name.replace(" ", "+").replace("'", "")
    url = f"https://help.bungie.net/hc/en-us/search?query={q}"
    html = await fetch(client, url)
    if not html:
        await asyncio.sleep(DELAY)
        return 0
    soup = BeautifulSoup(html, "lxml")
    links = soup.select("a.search-result-link, a.results-list-item-link")
    seen = 0
    for a in links[:8]:
        href = a.get("href", "")
        if not href.startswith("http"):
            href = "https://help.bungie.net" + href
        title = a.get_text(strip=True)
        article = await fetch(client, href)
        await asyncio.sleep(DELAY)
        if not article:
            continue
        body = trafilatura.extract(article, output_format="markdown")
        if body and len(body) > 200:
            write_doc("bungie-help", activity_slug, title or name, href, body)
            seen += 1
    if seen:
        print(f"  ✓ help.bungie.net → {activity_slug}: {seen} articles")
    else:
        print(f"  ✗ help.bungie.net → {activity_slug}: 0 relevant articles")
    return seen


async def main(only: str | None = None):
    async with httpx.AsyncClient(http2=True) as client:
        for slug, name, kind, bb_slug, query in ACTIVITIES:
            if only and slug != only:
                continue
            print(f"\n[{kind.upper()}] {name}")
            # AUTHORITATIVE sources first
            await try_blueberries(client, slug, bb_slug, name)
            await try_bungie_help(client, slug, name)
            # SUPPLEMENTAL — r/raidsecrets only, tagged for cheese / edge cases.
            # NOTE: deweighted. Reddit goes by upvotes, not accuracy. Use these
            # for cheese discovery and conflict-flagging only. Do NOT rely on
            # raidsecrets when blueberries/destinypedia/Bungie-help conflict
            # with it on mechanics.
            await try_reddit_search(client, "raidsecrets", slug, query, limit=8)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--activity", help="Only scrape this slug (e.g. root-of-nightmares)")
    args = ap.parse_args()
    asyncio.run(main(only=args.activity))
