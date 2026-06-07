"""
destiny-raid-context — MCP server (stdio).

Thin wrapper over store.py. Every tool returns content for ONE activity /
ONE encounter, selected by key — so a model can never pull cross-raid context.

Run:  python server.py         (after: pip install "mcp[cli]" pyyaml)
Register (Claude Code):  claude mcp add destiny-raid-context -- python /abs/path/raid_context/server.py
"""
from mcp.server.fastmcp import FastMCP

import store

mcp = FastMCP("destiny-raid-context")


def _safe(fn, *a, **k):
    try:
        return fn(*a, **k)
    except store.NotFound as e:
        return {"error": str(e)}


@mcp.tool()
def identify_activity(query: str) -> dict:
    """Resolve free text to ONE raid/dungeon. Deterministic; returns slug + confidence."""
    return _safe(store.identify_activity, query)


@mcp.tool()
def identify_encounter(query: str, slug: str | None = None) -> dict:
    """Resolve free text to ONE encounter, optionally scoped to an activity slug."""
    return _safe(store.identify_encounter, query, slug)


@mcp.tool()
def list_encounters(slug: str) -> list:
    """Ordered encounters for an activity slug."""
    return _safe(store.list_encounters, slug)


@mcp.tool()
def get_encounter(slug: str, encounter: str) -> dict:
    """THE isolation tool. Returns exactly ONE encounter's full record (v3 if authored,
    else v2 fallback). `encounter` may be a slug, an order number, or a name."""
    return _safe(store.get_encounter, slug, encounter)


@mcp.tool()
def get_role(slug: str, encounter: str, role_id: str) -> dict:
    """One role's loadout/surges/defensive notes within one encounter."""
    return _safe(store.get_role, slug, encounter, role_id)


@mcp.tool()
def get_overview(slug: str) -> dict:
    """Activity-wide primer (overview + raid-wide notes) for one activity."""
    return _safe(store.get_overview, slug)


if __name__ == "__main__":
    mcp.run()
