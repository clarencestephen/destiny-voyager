# raid_context — keyed, context-isolated raid/dungeon retrieval

The replan's core. Cross-raid hallucinations were structural: the bot's ChromaDB
mixed every source in one collection and retrieved by similarity, so a Verity
query could pull Last Wish chunks. This layer makes that **impossible** by
retrieving encounters **by key**, never by similarity.

## Pieces

| File | Role |
|---|---|
| `encounter_registry.json` | canonical activity → ordered encounters (20 activities, 94 encounters) |
| `SCHEMA_v3.md` | the v3 atomic-encounter schema (per-role loadout, surges, defensive mods, sources) |
| `content/{raids,dungeons}/<slug>/<order>-<enc>.yaml` | authored v3 encounter files (Verity is the reference) |
| `store.py` | dependency-light retrieval engine — **the isolation core** |
| `server.py` | thin MCP (stdio) wrapper over `store.py` |
| `build_foundation.py` | (Phase 0) builds registry + per-encounter resource folders |

## Isolation guarantee

`store.get_encounter(slug, encounter)` returns **exactly one** encounter's record
and asserts `activity.slug` + `encounter.slug` match the request. It prefers the
authored v3 file and falls back to extracting the single encounter block from the
v2 monolith — so every encounter is serveable today, improving as v3 files land.
Cross-*raid* leakage cannot occur; same-raid sibling references (e.g. Verity's
Deepsight puzzle pointing at Repository) are intentional.

## MCP tools

`identify_activity` · `identify_encounter` · `list_encounters` · `get_encounter`
· `get_role` · `get_overview`

The intended bot/web flow: `identify_activity` → `identify_encounter` →
`get_encounter` (load ONLY that encounter into the model's context).

## Run

```bash
pip install "mcp[cli]" pyyaml
python server.py
# register with Claude Code:
claude mcp add destiny-raid-context -- python "$(pwd)/server.py"
```

The retrieval engine is testable without the MCP runtime: `import store`.
