# Raid + Dungeon Encounter Guides

Structured, multi-permutation encounter guides. Goal: replace 30-60 min
YouTube videos with text a fireteam can scan before pulling the trigger.

See **[SCHEMA.md](SCHEMA.md)** for the YAML format and authoring rules.

## Status — Pass 1 (destinypedia baseline, ship-fast)

All 20 activities authored at Pass-1 quality. Pending: multi-source synthesis (Pass 2) + image upload (manual). See [TODO.md](TODO.md).

### Raids (10)

| Activity | File | Pass 1 | Pass 2 | Images |
|---|---|---|---|---|
| Root of Nightmares | `root-of-nightmares.yaml` | ✅ | ✅ | ⬜ |
| Salvation's Edge | `salvations-edge.yaml` | ✅ | ✅ | ⬜ |
| Desert Perpetual | `desert-perpetual.yaml` | ✅ | ⬜ | ⬜ |
| Vow of the Disciple | `vow-of-the-disciple.yaml` | ✅ | ⬜ | ⬜ |
| Deep Stone Crypt | `deep-stone-crypt.yaml` | ✅ | ⬜ | ⬜ |
| Garden of Salvation | `garden-of-salvation.yaml` | ✅ | ⬜ | ⬜ |
| Last Wish | `last-wish.yaml` | ✅ | ⬜ | ⬜ |
| King's Fall | `kings-fall.yaml` | ✅ | ⬜ | ⬜ |
| Vault of Glass | `vault-of-glass.yaml` | ✅ | ⬜ | ⬜ |
| Crota's End | `crotas-end.yaml` | ✅ | ⬜ | ⬜ |

### Dungeons (10)

| Activity | File | Pass 1 | Pass 2 | Images |
|---|---|---|---|---|
| Equilibrium | `dungeons/equilibrium.yaml` | ✅ | ⬜ | ⬜ |
| Sundered Doctrine | `dungeons/sundered-doctrine.yaml` | ✅ | ⬜ | ⬜ |
| Warlord's Ruin | `dungeons/warlords-ruin.yaml` | ✅ | ⬜ | ⬜ |
| Ghosts of the Deep | `dungeons/ghosts-of-the-deep.yaml` | ✅ | ⬜ | ⬜ |
| Spire of the Watcher | `dungeons/spire-of-the-watcher.yaml` | ✅ | ⬜ | ⬜ |
| Duality | `dungeons/duality.yaml` | ✅ | ⬜ | ⬜ |
| Grasp of Avarice | `dungeons/grasp-of-avarice.yaml` | ✅ | ⬜ | ⬜ |
| Prophecy | `dungeons/prophecy.yaml` | ✅ | ⬜ | ⬜ |
| Pit of Heresy | `dungeons/pit-of-heresy.yaml` | ✅ | ⬜ | ⬜ |
| Shattered Throne | `dungeons/shattered-throne.yaml` | ✅ | ⬜ | ⬜ |

**Pass 2 plan:** per-encounter WebFetch against blueberries.gg (loot table
+ master challenges) + destinypedia (mechanics) + r/raidsecrets (cheese,
secret chests). Real Pass-2 reality (discovered 2026-05-25): blueberries
is loot/challenges only, not mechanics; Bungie help has 0 relevant raid
articles; written-form Tier-1 mechanics is destinypedia alone. Mechanics
depth beyond Pass-1 requires Pass-3 YouTube transcripts. See [TODO.md](TODO.md).

## Hard rules

1. **Raids and dungeons are SEPARATE.** Never let a dungeon callout bleed into a raid answer or vice-versa. Retrieval tags strictly: `activity_type:raid|dungeon` + `slug:<name>` + `encounter:<encounter-slug>` + `role:<role-id>`.
2. **Multiple permutations per encounter.** Don't pick "the right" strategy — document Standard, Mechanics-Heavy, Jump-Minimizer, Learner-Friendly, Solo-Carry, Speed-Run as applicable.
3. **No guessing.** If you don't know a detail, leave the field `""` with a `# TODO: confirm` comment. The bot rendering layer treats blank as "ask a human."
4. **Cross-compare sources.** Datto, blueberries.gg, raidsecrets, destinypedia — if two contradict, document both as permutations.

## Authoring a new raid

```bash
cp _template.yaml my-new-raid.yaml
# fill in the top matter + encounter blocks
# leave loadouts blank if you're not certain
python3 ../darth-bot/scripts/embed_raids.py   # (TBD — pushes into KB)
```

## Bot integration (TBD)

Once embedded, Darth Bot supports:

- `/raid <name>` — full raid summary with encounter list
- `/raid <name> <encounter>` — specific encounter, all permutations
- `/role <raid> <encounter> <role>` — deep-dive one role
- `/raid-start <name>` — fireteam role-tracker session begins
- `/raid-history @member` — what roles this person has played
