# Encounter Schema v3 — delta over v2

v3 keeps **everything** in `raids/SCHEMA.md` (v2) and adds the fields that answer
the four questions a player actually asks at the door of an encounter:

1. **What do I do here?** → `plain_language_steps`
2. **What's the ideal loadout for my role?** → `permutations[].roles[].loadout`
3. **What surges for damage?** → `damage.surges`
4. **What defensive mods vs adds and boss?** → `defense.recommended_defensive_mods`

v3 also makes the **encounter the atomic unit** (one file per encounter) and
records **source provenance with recency**, so "most-recent raid guide = canon"
is machine-checkable, not oral.

---

## 1. Atomic file layout (the big change)

v2: one file per activity (`raids/salvations-edge.yaml`) with an `encounters[]` array.
v3: one file per **encounter**, generated from v2 + purification:

```
raid_context/content/
  raids/
    salvations-edge/
      _activity.yaml              # activity header + overview (raid-wide)
      1-substratum.yaml
      2-herald-of-finality.yaml
      3-repository.yaml
      4-verity.yaml               # <- the MCP serves THIS by key
      5-the-witness.yaml
  dungeons/
    sundered-doctrine/
      _activity.yaml
      1-solve-the-riddle.yaml
      ...
```

Each encounter file carries a small retrieval header so it is self-describing
when the MCP hands it to a model in isolation:

```yaml
activity:
  slug: salvations-edge
  name: Salvation's Edge
  activity_type: raid          # raid | dungeon  — HARD isolation key
  fireteam_size: 6
encounter:
  order: 4
  slug: verity
  name: Verity
  # ... full v2 encounter object + v3 additions below
```

The v2 activity-level `overview`, `overall_notes` live in `_activity.yaml`.

---

## 2. New encounter-level fields (added to the v2 encounter object)

```yaml
# NEW — the plain-language answer to "what do I do here", as numbered steps.
# Derived from parallel_timeline + setup, rewritten so a first-timer gets it
# in one read. Game-canonical names, no jargon dumps.
plain_language_steps:
  - "1. ..."
  - "2. ..."

# NEW — incoming-threat profile + the defensive mods that counter it.
defense:
  incoming_damage:
    adds: ["<element> (<source enemy>)"]      # e.g. "Void (Subjugators)"
    boss: ["<element> (<attack>)"]
  champions: ["<type> (<enemy>) -> <counter>"]  # "Unstoppable (Ogre) -> Anti-Unstoppable"
  recommended_defensive_mods:
    elemental: ["<mod> — <when>"]   # "Void Resist x2 — vs Subjugator volleys"
    concussive: ["Concussive Dampener — <when>"]  # vs AoE/stomp/splash
  # blank "" any slot you can't source; never guess

# NEW — DPS-phase guidance.
damage:
  surges: ["<element> — <note>"]    # "match weekly surge; Solar strong here"
  burst_windows: "<one line: when/how long the damage window is>"
  recommended_dps: ["<weapon/archetype> — <why>"]

# NEW — provenance. Canon = most recent guide. Reddit allowed but never overrides.
sources:
  - tier: 1                 # 1=canon guide/destinypedia, 2=raidsecrets/community, 3=dropped
    name: "<source>"
    url: "<url>"
    date_checked: "YYYY-MM-DD"
    used_for: ["mechanics", "loadout", "surge", "mods"]
```

## 3. New per-role loadout block (inside `permutations[].roles[]`)

```yaml
roles:
  - id: inside
    count: 3
    does: "..."
    loadout:
      subclass: "<element + super>"        # "Void — Ward of Dawn" / "Prismatic — Song of Flame"
      weapons:
        primary: "<name + element>"        # "" if unsure
        special: "<name + element>"
        heavy: "<name + element>"
      exotic_armor: "<name>"
      armor_stats: ["Health", "Class"]     # EoF NAMES ONLY (see below)
      surges_mods: "<role-specific surge/defensive note>"
    notes: []
```

### Stat naming — Edge of Fate (mandatory)

Use the **current** stat names everywhere. Old guides use the old names — translate:

| Old | v3 (current) |
|---|---|
| Mobility | **Weapons** |
| Resilience | **Health** |
| Recovery | **Class** |
| Discipline | **Grenade** |
| Intellect | **Super** |
| Strength | **Melee** |

Hashes are unchanged; only display names changed. A guide that says "high
Resilience" → author as **Health**.

---

## 4. Authoring rules (unchanged from v2 + two additions)

- **No guessing.** Unknown field → `""` + `# TODO: confirm`. Blank renders as
  "ask a human", never as fabricated data.
- **Raids and dungeons strictly separate.** `activity_type` is the hard key.
- **NEW — Canon by recency.** When sources disagree, the **most recent raid
  guide wins**. Reddit/community is a rich resource for cheese, edge cases, and
  current meta and may be cited in `sources` (tier 2) or `cheese`, but it
  **never overrides** the canon guide. Flag stale/confused posts; don't carry them.
- **NEW — One source-brief per encounter.** Fetch + distill the canon guide once;
  all downstream purification reads the brief, not raw pages.

---

## 5. Retrieval tags (emitted per encounter file by the ingest step)

`activity_type` · `slug` · `encounter` · `order` · `role` · `section`
(`section` ∈ overview | steps | mechanics | timeline | permutation | loadout |
defense | damage | cheese | rewards | mistakes | sources)

`activity_type:raid` + `slug:salvations-edge` + `encounter:verity` is the
strictest filter. The MCP's `get_encounter` returns exactly one file by this
key — **no similarity search, so no cross-encounter bleed is possible.**
