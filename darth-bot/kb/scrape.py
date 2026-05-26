"""
darth-bot/kb/scrape.py
======================
One-time scraper for Destiny 2 knowledge sources.

Targets (politely, with delays + cache):
  - light.gg          item/perk/roll pages
  - bungie.net        exotic mission + quest pages
  - reddit.com        top posts in r/destinythegame, r/destiny2 (last 90d)
  - destinypedia      raid + dungeon mechanic articles
  - d2checklist       weekly reset summary

Output: clean Markdown files under data/scrape/<source>/<slug>.md
        Each file has a YAML frontmatter with source URL + tags.

After scraping, run kb/embed.py to chunk + embed into chromadb.

Usage:
    python3 -m darth-bot.kb.scrape --source lightgg --pages 100
    python3 -m darth-bot.kb.scrape --source reddit --subreddit destinythegame --top 200
    python3 -m darth-bot.kb.scrape --all

NOTE: This file is a starter scraper — Light.gg & Reddit have rate limits.
Add User-Agent identifying yourself, respect robots.txt, throttle to ~1 req/s.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import time
from pathlib import Path
from typing import Iterable

import httpx
from bs4 import BeautifulSoup

from config import SCRAPE_DIR

USER_AGENT = "darth-bot/0.1 (+https://github.com/clarencestephen/destiny-voyager; personal Destiny 2 chatbot)"
HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}
DELAY_SECONDS = 1.2  # be a polite scraper


def slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:80] or "untitled"


def write_doc(source: str, title: str, url: str, body: str, tags: Iterable[str] = ()):
    out_dir = SCRAPE_DIR / source
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = out_dir / f"{slugify(title)}.md"
    fm = [
        "---",
        f'title: "{title.replace(chr(34), chr(39))}"',
        f"source: {source}",
        f"url: {url}",
        f"scraped: {int(time.time())}",
    ]
    if tags:
        fm.append("tags: [" + ", ".join(f'"{t}"' for t in tags) + "]")
    fm.append("---")
    fname.write_text("\n".join(fm) + "\n\n" + body, encoding="utf-8")
    return fname


async def fetch(client: httpx.AsyncClient, url: str) -> str | None:
    try:
        r = await client.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
        if r.status_code != 200:
            print(f"  ! {r.status_code} {url}")
            return None
        return r.text
    except Exception as e:
        print(f"  ! err {url}: {e}")
        return None


async def scrape_lightgg(pages: int = 50):
    """
    Light.gg has thousands of weapon/armor/perk pages. The cleanest starting
    point is their roll-and-perk database. Start with the top exotics page
    then crawl linked items.
    """
    import trafilatura
    seeds = [
        "https://www.light.gg/db/items/?Category=exotic",
        "https://www.light.gg/db/items/?Category=primary",
        "https://www.light.gg/god-rolls/",
    ]
    visited = set()
    queue = list(seeds)
    count = 0
    async with httpx.AsyncClient(http2=True) as client:
        while queue and count < pages:
            url = queue.pop(0)
            if url in visited:
                continue
            visited.add(url)
            html = await fetch(client, url)
            if not html:
                await asyncio.sleep(DELAY_SECONDS)
                continue
            extracted = trafilatura.extract(html, include_comments=False,
                                            include_tables=True, output_format="markdown")
            soup = BeautifulSoup(html, "lxml")
            title = (soup.title.string if soup.title else "untitled").strip()
            if extracted and len(extracted) > 300:
                write_doc("lightgg", title, url, extracted, tags=["lightgg"])
                count += 1
                print(f"  [{count}/{pages}] {title[:60]}")
            # discover more item links
            for a in soup.select("a[href]"):
                href = a.get("href")
                if not href or not href.startswith("/db/items/"):
                    continue
                full = "https://www.light.gg" + href
                if full not in visited and len(queue) < 500:
                    queue.append(full)
            await asyncio.sleep(DELAY_SECONDS)


async def scrape_reddit(subreddit: str = "destinythegame", top: int = 100,
                         windows: Iterable[str] = ("year",)):
    """
    Reddit JSON endpoints — no auth needed for read-only listings.

    subreddit  — single subreddit name (no "r/" prefix)
    top        — total posts to scrape (across all windows)
    windows    — time windows: any subset of "all", "year", "month", "week"
                 Posts surface different content per window (eg. all-time =
                 evergreen guides, week = current-meta complaints).
    """
    import json as _json
    count = 0
    per_window = max(1, top // max(1, len(list(windows))))
    async with httpx.AsyncClient() as client:
        for t in windows:
            after = None
            window_count = 0
            base = f"https://www.reddit.com/r/{subreddit}/top/.json?t={t}&limit=100"
            while window_count < per_window and count < top:
                url = base + (f"&after={after}" if after else "")
                html = await fetch(client, url)
                if not html:
                    break
                try:
                    data = _json.loads(html)
                except Exception:
                    break
                children = data.get("data", {}).get("children", [])
                if not children:
                    break
                for child in children:
                    if window_count >= per_window or count >= top:
                        break
                    d = child["data"]
                    if d.get("is_video") or d.get("over_18"):
                        continue
                    title = d.get("title", "")
                    body = d.get("selftext", "")
                    if not body or len(body) < 200:
                        continue
                    permalink = "https://reddit.com" + d.get("permalink", "")
                    write_doc("reddit", title, permalink, body,
                              tags=[subreddit, t, f"score:{d.get('score',0)}"])
                    window_count += 1
                    count += 1
                    if count <= 6 or count % 25 == 0:
                        print(f"  [{count}/{top}] r/{subreddit} ({t}) :: {title[:55]}")
                after = data.get("data", {}).get("after")
                if not after:
                    break
                await asyncio.sleep(DELAY_SECONDS)
    print(f"  r/{subreddit}: {count} posts scraped")


async def scrape_reddit_multi(subs: Iterable[str] = (), top_each: int = 200):
    """Convenience: scrape several subs with all-time + year + month windows."""
    default_subs = (
        "destinythegame",
        "destiny2",
        "CrucibleGuidebook",
        "raidsecrets",
    )
    subs = list(subs) or list(default_subs)
    for sub in subs:
        await scrape_reddit(sub, top=top_each,
                            windows=("all", "year", "month"))


async def scrape_bungie_help():
    """
    Bungie's official help articles — quest paths, troubleshooting, etc.
    The help portal exposes article URLs under /Article/Category/.
    """
    import trafilatura
    base = "https://help.bungie.net"
    seeds = [
        f"{base}/hc/en-us/categories/360003117052-Destiny-2",
        f"{base}/hc/en-us/sections/360008586251-Game-Guides",
        f"{base}/hc/en-us/sections/360008586271-Quests-and-Quest-Steps",
    ]
    visited = set()
    queue = list(seeds)
    scraped = 0
    async with httpx.AsyncClient(http2=True) as client:
        while queue and scraped < 200:
            url = queue.pop(0)
            if url in visited:
                continue
            visited.add(url)
            html = await fetch(client, url)
            if not html:
                await asyncio.sleep(DELAY_SECONDS)
                continue
            extracted = trafilatura.extract(html, include_tables=True,
                                            output_format="markdown")
            soup = BeautifulSoup(html, "lxml")
            title = (soup.title.string if soup.title else url).strip()
            if extracted and len(extracted) > 200:
                write_doc("bungie-help", title, url, extracted, tags=["help"])
                scraped += 1
                if scraped % 25 == 0 or scraped < 10:
                    print(f"  [{scraped}/200] {title[:55]}")
            # follow links into more articles
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "/hc/en-us/articles/" in href or "/hc/en-us/sections/" in href:
                    full = href if href.startswith("http") else base + href
                    if full not in visited and len(queue) < 800:
                        queue.append(full)
            await asyncio.sleep(DELAY_SECONDS)
    print(f"  bungie-help: {scraped} pages scraped")


async def scrape_destinypedia(seeds: Iterable[str] = ()):
    """Backward-compat wrapper — calls the deep crawler."""
    await scrape_destinypedia_deep(max_pages=15, depth=0, seeds=seeds)


async def scrape_destinypedia_deep(*, max_pages: int = 400, depth: int = 2,
                                    seeds: Iterable[str] = ()):
    """
    BFS-crawl destinypedia from seed pages, following internal /wiki/ links.

    max_pages — cap total pages scraped (default 400)
    depth     — how many hops from seed (0 = seeds only, 2 = seeds + 2 levels)
    """
    import trafilatura
    default_seeds = [
        # Raids
        "https://www.destinypedia.com/Salvation%27s_Edge",
        "https://www.destinypedia.com/Root_of_Nightmares",
        "https://www.destinypedia.com/Vow_of_the_Disciple",
        "https://www.destinypedia.com/Deep_Stone_Crypt",
        "https://www.destinypedia.com/King%27s_Fall",
        "https://www.destinypedia.com/Last_Wish",
        "https://www.destinypedia.com/Vault_of_Glass",
        "https://www.destinypedia.com/Crota%27s_End",
        "https://www.destinypedia.com/Garden_of_Salvation",
        "https://www.destinypedia.com/Desert_Perpetual",
        # Dungeons
        "https://www.destinypedia.com/Ghosts_of_the_Deep",
        "https://www.destinypedia.com/Spire_of_the_Watcher",
        "https://www.destinypedia.com/Duality_(dungeon)",
        "https://www.destinypedia.com/Prophecy",
        "https://www.destinypedia.com/Pit_of_Heresy",
        "https://www.destinypedia.com/Shattered_Throne",
        "https://www.destinypedia.com/Grasp_of_Avarice",
        "https://www.destinypedia.com/Warlord%27s_Ruin",
        "https://www.destinypedia.com/Sundered_Doctrine",
        # Expansions / seasons (drives links into every era)
        "https://www.destinypedia.com/Destiny_2",
        "https://www.destinypedia.com/Destiny",
        "https://www.destinypedia.com/Edge_of_Fate",
        "https://www.destinypedia.com/The_Final_Shape",
        "https://www.destinypedia.com/Lightfall",
        "https://www.destinypedia.com/Witch_Queen",
        "https://www.destinypedia.com/Beyond_Light",
        "https://www.destinypedia.com/Shadowkeep",
        "https://www.destinypedia.com/Forsaken",
        "https://www.destinypedia.com/Warmind",
        "https://www.destinypedia.com/Curse_of_Osiris",
        "https://www.destinypedia.com/The_Taken_King",
        "https://www.destinypedia.com/The_Dark_Below",
        "https://www.destinypedia.com/House_of_Wolves",
        "https://www.destinypedia.com/Rise_of_Iron",
        # Classes + subclasses (hub pages link to every aspect / fragment / super)
        "https://www.destinypedia.com/Hunter",
        "https://www.destinypedia.com/Titan",
        "https://www.destinypedia.com/Warlock",
        "https://www.destinypedia.com/Subclass",
        "https://www.destinypedia.com/Prismatic_(subclass)",
        # Activities
        "https://www.destinypedia.com/Strikes",
        "https://www.destinypedia.com/Nightfall",
        "https://www.destinypedia.com/Crucible",
        "https://www.destinypedia.com/Trials_of_Osiris",
        "https://www.destinypedia.com/Iron_Banner",
        "https://www.destinypedia.com/Gambit",
        # Exotic mission / quest hubs
        "https://www.destinypedia.com/Exotic_quest",
        "https://www.destinypedia.com/List_of_exotic_weapons",
        "https://www.destinypedia.com/List_of_exotic_armor",
        # D1 anchors (user explicitly mentioned wanting D1 lore)
        "https://www.destinypedia.com/Destiny:_The_Taken_King",
        "https://www.destinypedia.com/Cosmodrome",
        "https://www.destinypedia.com/Tower",
    ]
    seeds = list(seeds) or default_seeds

    # BFS state
    visited: set[str] = set()
    queue: list[tuple[str, int]] = [(u, 0) for u in seeds]
    scraped = 0
    SKIP_PREFIXES = ("Special:", "Category:", "Talk:", "File:", "User:", "Help:",
                     "Template:", "Destinypedia:", "MediaWiki:")

    def normalize(href: str) -> str | None:
        if not href.startswith("/"):
            return None
        if "#" in href:
            href = href.split("#", 1)[0]
        # Only follow /wiki/<title> style links
        if not href.startswith("/") or "/wiki/" not in (href if href.startswith("/wiki/") else "/wiki" + href):
            # destinypedia uses bare /Title not /wiki/Title
            pass
        # skip non-article namespaces
        for prefix in SKIP_PREFIXES:
            if href.startswith(f"/{prefix}"):
                return None
        return "https://www.destinypedia.com" + href

    async with httpx.AsyncClient(http2=True) as client:
        while queue and scraped < max_pages:
            url, hop = queue.pop(0)
            if url in visited:
                continue
            visited.add(url)
            html = await fetch(client, url)
            if not html:
                await asyncio.sleep(DELAY_SECONDS)
                continue

            extracted = trafilatura.extract(html, include_tables=True,
                                            output_format="markdown")
            soup = BeautifulSoup(html, "lxml")
            title = (soup.title.string if soup.title else url).strip()
            if extracted and len(extracted) > 300:
                write_doc("destinypedia", title, url, extracted,
                          tags=[f"hop:{hop}"])
                scraped += 1
                if scraped % 25 == 0 or scraped < 10:
                    print(f"  [{scraped}/{max_pages}] hop={hop}  {title[:55]}")

            # Discover links to follow
            if hop < depth:
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    full = normalize(href)
                    if full and full not in visited and len(queue) < 2000:
                        queue.append((full, hop + 1))

            await asyncio.sleep(DELAY_SECONDS)
    print(f"  destinypedia: {scraped} pages scraped")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source",
                    choices=["lightgg", "reddit", "destinypedia", "bungie-help",
                             "deep", "all"],
                    default="all")
    ap.add_argument("--pages", type=int, default=100, help="for lightgg")
    ap.add_argument("--subreddit", default="destinythegame", help="for reddit")
    ap.add_argument("--top", type=int, default=100, help="for reddit (single sub)")
    ap.add_argument("--depth", type=int, default=2,
                    help="destinypedia BFS depth (--source deep / all)")
    ap.add_argument("--dp-max", type=int, default=400,
                    help="destinypedia max pages (deep)")
    args = ap.parse_args()

    # "deep" = the expanded multi-source crawl
    if args.source == "deep":
        print("=== destinypedia (deep) ===")
        await scrape_destinypedia_deep(max_pages=args.dp_max, depth=args.depth)
        print("=== reddit (multi-sub) ===")
        await scrape_reddit_multi()
        print("=== bungie help ===")
        await scrape_bungie_help()
        return

    if args.source in ("lightgg", "all"):
        print("=== light.gg ===")
        await scrape_lightgg(pages=args.pages)
    if args.source in ("reddit", "all"):
        print("=== reddit ===")
        await scrape_reddit(args.subreddit, top=args.top)
    if args.source in ("destinypedia", "all"):
        print("=== destinypedia ===")
        await scrape_destinypedia_deep(max_pages=args.dp_max, depth=args.depth)
    if args.source in ("bungie-help", "all"):
        print("=== bungie help ===")
        await scrape_bungie_help()


if __name__ == "__main__":
    asyncio.run(main())
