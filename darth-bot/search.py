"""
darth-bot/search.py
===================
Brave Search wrapper. Free tier: 2,000 queries/month. Sign up at
https://api.search.brave.com/app/keys to get a key, then add to .env:

    BRAVE_SEARCH_API_KEY=BSA...

Used for current-meta questions where the curated KB might be stale:
  - "easiest solo ops map this week"
  - "current artifact mods"
  - "recent nerf to Crimson"

Falls back to a no-op (returns empty string) if no key is configured —
the bot still works, just without live search.
"""

from __future__ import annotations

import asyncio
from typing import Iterable

import httpx

from config import BRAVE_SEARCH_API_KEY, BRAVE_SEARCH_URL


TRUSTED_DESTINY_DOMAINS = (
    "light.gg", "destinytracker.com", "bungie.net", "raid.report",
    "d2foundry.gg", "blueberries.gg", "d2checklist.com",
    "ishtar-collective.net", "reddit.com",
)


async def brave_search(query: str, *, top_n: int = 5, prefer_destiny: bool = True) -> list[dict]:
    """
    Returns a list of dicts: {title, url, description}.
    """
    if not BRAVE_SEARCH_API_KEY:
        return []

    q = f"Destiny 2 {query}" if "destiny" not in query.lower() else query
    if prefer_destiny:
        # Boost trusted domains by appending site: hints. Brave supports OR.
        sites = " OR ".join(f"site:{d}" for d in TRUSTED_DESTINY_DOMAINS[:4])
        q = f"({q}) ({sites})"

    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_SEARCH_API_KEY,
    }
    params = {"q": q, "count": top_n, "country": "us", "safesearch": "moderate"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(BRAVE_SEARCH_URL, headers=headers, params=params)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        print(f"[search] Brave error: {e}")
        return []

    results = []
    for item in (data.get("web", {}).get("results") or [])[:top_n]:
        results.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "description": (item.get("description") or "").strip(),
        })
    return results


def format_results(results: Iterable[dict]) -> str:
    """Format search results as plain text for the LLM context."""
    out = []
    for r in results:
        out.append(f"- {r['title']}\n  {r['url']}\n  {r['description']}")
    return "\n".join(out)


async def search_context(query: str, *, top_n: int = 5) -> str:
    """Convenience: search + format → string ready for LLM context."""
    results = await brave_search(query, top_n=top_n)
    return format_results(results)


# CLI smoke-test
if __name__ == "__main__":
    import sys
    q = " ".join(sys.argv[1:]) or "how do I get Crimson catalyst"
    async def main():
        results = await brave_search(q)
        for r in results:
            print(f"\n{r['title']}\n  {r['url']}\n  {r['description'][:200]}")
    asyncio.run(main())
