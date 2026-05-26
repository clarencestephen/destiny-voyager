# Raid + Dungeon Encounter Guide Schema (v2)

Replaces 30-60min YouTube walkthroughs with brief, scannable text. Built
for adult gamers who want a fast pre-pull reminder, not an essay.

The data is authored as **YAML** (human-editable, diff-friendly) and ingested
by Darth Bot's `/raid`, `/role`, and `/raid-roles` slash commands.

---

## Authoring rules (read first)

1. **Brevity > completeness.** 1-sentence values. Bullets over paragraphs.
2. **Game-name terminology.** Use the in-game UI label (Field of Light,
   Sweeping Terror, Nodes of Splendor). Colloquial names ("the buff",
   "the runner") allowed in role notes, but the canonical name appears
   at least once in every mechanic block.
3. **No guessing.** Leave fields as `""` if unsure — user fills via
   review. The bot's rendering treats blank as "ask a human."
4. **Raids and dungeons strictly separate.** Different folders, different
   `activity_type`. Retrieval filters: a query about Salvation's Edge
   never pulls Crota's End or any dungeon.
5. **Cross-compare sources.** If Datto, blueberries, raidsecrets, and
   destinypedia disagree, document the variants as separate permutations.

---

## File layout

```
raids/
├── SCHEMA.md
├── _template.yaml
├── root-of-nightmares.yaml          ← one file per raid
├── salvations-edge.yaml
├── desert-perpetual.yaml
└── dungeons/
    ├── equilibrium.yaml             ← one file per dungeon
    └── sundered-doctrine.yaml
```

---

## Top-level structure

```yaml
slug:              # url-safe id, used as retrieval tag
name:              # display name
activity_type:     # raid | dungeon
released: { expansion, year }
roster_status:     # current | sunset | vaulted
fireteam_size:     # raids = 6, dungeons = 1-3
power_floor: { normal, master }
location: ""
tags: []
average_clear_time: { normal_experienced, normal_learning, master }
overview: { ... }                 # see below
encounters: [ ... ]               # see below
overall_notes: [ ... ]            # raid-wide tips
```

---

## `overview` — read-this-first abstract

The fastest possible primer for someone who's never run the activity.
Lives ABOVE the encounters block so a sherpa can copy-paste this single
section into a Discord channel before a pull.

```yaml
overview:
  abstract: |
    2-3 sentences: theme + mechanic feel + difficulty.

  bosses:
    - name: ""
      encounter: 1
      role: "1-liner."

  # The mechanics that REPEAT across encounters. Learn these and most
  # of the raid is just variations.
  recurring_mechanics:
    - name: "Field of Light"
      brief: |
        2-4 sentence explanation of the mechanic in plain language.

  # The kinds of jobs people do. Encounters assign these archetypes
  # to specific positions.
  role_archetypes:
    - id: runner
      brief: "1-line description."

  # Sherpa playbook — assign-this-newbie-here rules.
  sherpa_playbook:
    - "1st-timer: add-clear in encounter 1."
    - "..."

  loadout_general:
    weapons: ["Anti-Barrier mandatory.", "Burst-DPS preferred."]
    armor_stats: ["Runners: Class + Health (movement comes from Stompees/Lift/Heat Rises exotics, not stats)."]
    common_exotics: ["Hunter: Stompees."]

  common_mistakes:
    - "The things that wipe runs."
```

---

## `encounters[]` — per-encounter detail

Each encounter is a structured object with the standard sections:

```yaml
- order: 1
  slug: cataclysm
  name: Cataclysm                 # community / sherpa-circuit name
  ingame_name: "Survive the Onslaught"  # in-game UI title (optional; only if different from `name`)
  difficulty: easy
  estimated_time: "8-12 min"

  abstract: |
    1-2 sentences. What's the team accomplishing?

  # NEW — describe what you SEE when you walk in. Visual cues, glowing
  # objects, platform layout. Plus the platform mechanics: do you stand
  # on it? walk through? must you stay? does the team need to be on it
  # simultaneously? what happens if someone steps off too early?
  setup: |
    WHAT YOU SEE:
    - <visible object>: <description>
    - ...

    PLATFORM MECHANICS:
    - <name>: <exactly how to interact — step on / stay / leave when / etc.>

  # NEW — explicit comms protocol. WHO says WHAT to WHOM and WHEN.
  # No paragraphs, no narrative. One row per callout.
  callouts:
    - when: "Trigger event"
      from: role_id
      to:   role_id_or_"team"
      say:  '"Exact words to speak."'
      why:  "What this callout enables. Why other roles need to hear it."

  wipe_triggers:
    - "X = death."

  damage_phase_triggers:
    - "When does the DPS window open?"

  # The narrative — what each role is doing AT THE SAME TIME.
  # 2-6 phases per encounter. Use role names as keys.
  parallel_timeline:
    - phase: "Pull"
      runner_1: "Active Node → Field of Light → link."
      runner_2: "Mirror."
      add_clear_4: "Hold centre, kill Cabal."

    - phase: "First Aspirant wave (~0:45)"
      runner_1: "Mid-chain."
      runner_2: "Mid-chain."
      add_clear_4: "Kill both Aspirants → drop Cavum."

  # 1-4 ways to organize the fireteam. Each permutation is named.
  permutations:
    - name: "Standard X / Y"
      learner_friendly: true
      summary: "1-2 sentences."
      best_for: "When to use it."
      roles:
        - id: runner
          count: 2
          does: "1-sentence what they do."
          loadout: ""              # blank if unsure
          notes: []                # optional

  # Known cheese — exploits, line-of-sight tricks, etc. Only document
  # what's confirmed.
  cheese:
    - title: "Back-wall corner DPS"
      detail: "2-4 sentences."

  # Encounter-specific mistakes (raid-wide go in overview.common_mistakes)
  common_mistakes:
    - "..."

  # Per-encounter loot
  rewards:
    guaranteed:
      - "1× raid armor or weapon."
    hidden_chest:               # null if none
      location: "How to find it, with landmarks."
      rewards:
        - "Spoils of Conquest"
        - "Deepsight puzzle seed (see overall_notes)"
    potential_drops:
      - "Specific weapon name if known"

  # Master-difficulty challenge for this encounter — adds a constraint that,
  # when satisfied, awards bonus loot. Each raid has exactly N challenges
  # (one per encounter), and only ONE is on rotation per week.
  master_challenge:
    name: "Illuminated Torment"
    requirement: |
      Plain-language description of the constraint.
    enforced_on: "Master only (some carry to Normal for bonus loot — note here)"

  learner_path:
    - "1st clear: add-clear."
    - "2nd: runner."
```

---

## `parallel_timeline` — the key innovation

Most guides describe roles in isolation: "the runner does X, the
add-clear does Y." That doesn't help a fireteam understand the
**simultaneity** of the encounter.

The parallel timeline groups actions by **phase** (a time window or
state), then breaks down what each role does WITHIN that phase. Read
top-to-bottom for the encounter narrative; left-to-right for what
each role is doing.

Role keys are flexible — use `runner_1`, `runner_2`, `add_clear_4`,
`hunted`, `refuge_makers_2`, etc. — whatever's clearest for that
encounter. Use `all` when everyone does the same thing.

Phases per encounter: 2-6. Don't over-decompose.

---

## Permutation taxonomy

Common permutation names — use these where applicable so the bot can
detect patterns across raids:

| Name | Meaning |
|---|---|
| **Standard X / Y** | The most-documented split. "Standard 4-DPS / 2-Runners" |
| **Mechanics-Heavy** | More on mechanics, fewer on DPS — Master / low-power |
| **Jump-Minimizer** | Routes assigned to reduce platform-jumping load |
| **Underman (N-Person)** | Doable with fewer players — what changes |
| **Tag-Team** | Multiple players alternate one role (e.g. 2 hunted) |
| **Stack-DPS** | All collapse to one spot for damage windows |
| **Solo-Carry** | One player handles disproportionate load (sherpa runs) |
| **Speed-Run** | Skips optional rotations; assumes high skill |
| **Contest** | Master / Contest Mode tuning |

---

## Retrieval tagging (for Darth Bot)

Every chunk embedded into the KB carries:

| Tag | Value |
|---|---|
| `activity_type` | `raid` or `dungeon` |
| `slug` | the raid's slug (e.g. `root-of-nightmares`) |
| `encounter` | the encounter's slug (e.g. `cataclysm`) |
| `role` | the role's id (when chunk is role-specific) |
| `section` | `overview` / `mechanics` / `timeline` / `permutation` / `cheese` / `rewards` / `mistakes` |

`activity_type:raid` + `slug:salvations-edge` is the strictest filter —
NEVER serve a Crota's End chunk to a Salvation's Edge query.

---

## Status

| Activity | Status |
|---|---|
| Root of Nightmares | 🟢 fully populated in v2 schema |
| Salvation's Edge | ❌ unauthored |
| Desert Perpetual | ❌ unauthored |
| Vow of the Disciple | ❌ unauthored |
| Deep Stone Crypt | ❌ unauthored |
| Garden of Salvation | ❌ unauthored |
| Last Wish | ❌ unauthored |
| King's Fall | ❌ unauthored |
| Vault of Glass | ❌ unauthored |
| Crota's End | ❌ unauthored |
| *(all dungeons)* | ❌ unauthored |

---

## Sources to cross-compare (per encounter)

Not all sources are equal. Reddit ranks by upvotes, not accuracy — popular
posts on r/DestinyTheGame are often complaints, memes, or hot takes, not
verified mechanics. Treat the hierarchy below as load-bearing.

### Tier 1 — AUTHORITATIVE (mechanics, callouts, sequencing)

Cite at least TWO of these for any mechanics claim in a guide:

- **destinypedia** — wiki-edited mechanics + lore; high accuracy, dense.
  Realistically the ONLY broad-coverage Tier-1 written mechanics source.
- **blueberries.gg** — Pass-2 reality check (2026-05): NOT a mechanics
  source. They publish loot tables (per-encounter drops) and Master
  Challenges, which IS authoritative for those slots. Don't expect
  encounter callouts or role splits from them.
- **help.bungie.net** — official mechanic clarifications. Rare hits for
  raids — most articles are platform / account / known-issue. Search
  per-activity; usually 0 relevant results.
- **YouTube creator transcripts** — Datto, Esoterickk, Skarrow9 etc.
  publish in video, not text. Pass-3 enrichment (youtube-transcript-api)
  unlocks these as written corroboration; without it, mechanics depth
  beyond destinypedia is genuinely hard to source.

### Tier 2 — SUPPLEMENTAL (cheese, edge cases, variation discovery)

Use ONLY for cheese, hidden chests, and known-bug edge cases. NEVER use
to settle a mechanics dispute between Tier 1 sources:

- **r/raidsecrets pinned/megathread posts** — peer-vetted spreadsheets
- **Kyber's Discord** — current-meta strategy adjustments (when accessible)

### Tier 3 — DROPPED

Do not pull from these as a primary mechanics source:

- **r/DestinyTheGame** — popularity bias; mostly news, memes, complaints
- **YouTube comments** — unsourced, unverified
- **Random gaming blogs** — typically reword destinypedia anyway

### Conflict resolution

- Tier 1 vs Tier 1: document BOTH as separate permutations
- Tier 1 vs Tier 2: Tier 1 wins; Tier 2 may be added as a `cheese:` entry
- Tier 2 only: flag with `# TODO: needs Tier 1 confirmation`
