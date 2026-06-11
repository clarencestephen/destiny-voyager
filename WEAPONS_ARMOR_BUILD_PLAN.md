# Weapons · Armor · Build — Destiny Voyager expansion

A DIM/destiny.report-class browser layered onto the existing app: search the full
weapon/armor database, compare against your inventory (or browse anonymously),
rank rolls, save wishlists/builds, and equip the closest match. Plus a recommendation
wrapper (built last) and a **weapon-lookup** command set in Darth Bot.

## Surfaces (5)
1. **Weapons page** (web) — search/rank weapons, perk pools + Clarity insights, compare, wishlist.
2. **Armor page** (web) — same + set perks/themes/bonuses + archetypes; ties into the Optimizer.
3. **Build page** (web) — armor + weapons + ghost + artifact + fragments + class/subclass; save; equip closest match.
4. **Recommendation/ranking** (web) — **built LAST**, after navigation + UI/UX are optimized.
5. **weapon-lookup** (Darth Bot) — `/weapon` `/perk` `/godroll` over the same data. Surfacing the *web* features in Discord = optional **last-step** integration.

## The headline capability — inventory ↔ potential, at every level
- **Anonymous (no sign-in):** browse the full static DB (potential rolls) — **zero Bungie calls**.
- **Signed-in:** three modes — **Potential** / **Inventory-only** / **Both** (overlay owned rolls). Works at weapon, armor (incl. set bonuses/themes), and build level.
- **Equip closest match:** pick the owned roll most similar to a wishlist target (perk-overlap score) and `api.equip`.

## Leverage (why this is cheap)
- **Existing app:** React+Vite+Tailwind+router, Worker+KV+**Bungie OAuth**, manifest-bake pipeline, `api.ts`, inventory + **equip / equip-with-mods / transfer-to-vault**, the Optimizer mod engine + `encounters.json`.
- **DIM (MIT):** search grammar + `d2-additional-info` enums (seasons/sources/watermarks/foundry) — *ported/derived, not invented*.
- **Clarity (MIT):** perk/weapon descriptions, keyed by hash.
- **DIM community wishlists:** the god-roll source (light.gg has no public API — credit it + Crayon, but source god rolls from DIM wishlists + Clarity).
- **Bungie OpenAPI** (`/home/cs/workspace/Bungie/api/openapi.json`): authoritative reference.

## Data layer — BUILT ✅ (all real manifest data, cited, nothing fabricated)
Fresh manifest pulled to `manifest_cache/` (version `244019.26.05.29`). Bake scripts:
| Output | Script | Contents |
|---|---|---|
| `web/public/weapons.json` (6 MB) | `web/scripts/bake-weapons.mjs` | **2,058** L+E weapons · perk pools (barrel/mag/trait1/trait2/origin) with **can-roll** flags · season (DIM watermarks) · source · stats · frame · element · ammo · craftable (219) |
| `web/public/armor.json` (1.8 MB) | `web/scripts/bake-armor.mjs` | **5,326** pieces · **56 sets** with resolved 2pc/4pc **set-bonus** perks · slot/class/tier/element/source/season/set |
| `web/public/perks.json` (568 KB) | `web/scripts/bake-clarity.mjs` | **1,585** Clarity descriptions, hash-keyed (joins to weapon perk pools) |

The **can-roll flag** is what powers "potential (all history, light.gg-style)" vs "currently obtainable," and the inventory overlay. Armor **archetype is instance-level** (Armor-3.0 migrated all armor) — read from owned `plug_hashes` in the inventory view (Optimizer already does this).

Re-bake after a Bungie patch: pull the manifest tables, run the three scripts.

## Search — BUILT ✅
`web/src/lib/search.ts` — DIM-style declarative engine over the baked JSON.
Grammar: ANDed terms, `is:`/`not:` flags, `key:value` (quoted ok), leading `-` negate, bare words match name-or-type (or a known flag). Filters: type, element, ammo, tier, source, season (ranges), perk, frame, name (weapons) + slot, class, set (armor). Verified: `is:exotic hand cannon`→12, `is:craftable solar sword`→4, `perk:rampage is:craftable`→28, `source:trials`→89.
**NLP:** deterministic mapper first (free); optional LLM fallback later emitting this grammar.

## Persistence
Wishlists + saved builds in **KV per user** (reuse OAuth+KV). Anonymous = localStorage.

## Credits page
Mirror destiny.report/credits — **Thanks:** Bungie · Josh Hunt · DIM · Clarity (d2clarity.com) · **light.gg** · **Crayon (Mijago)** · d2foundry/D2Gunsmith · **destiny.report** · the community. Plus OUR app's third-party licenses (React etc.) + DIM/Clarity MIT notices. **Cite everything; fabricate nothing.**

## Build order + status
1. ✅ Weapons data bake (#9)
2. ✅ Armor data bake (#10)
3. ✅ Clarity perk descriptions (#11)
4. ✅ DIM search port (#12)
5. ⬜ Weapons page UI — search + perk pools + Clarity + inventory↔potential toggle + compare + wishlist (#13)
6. ⬜ Armor page + Build page + wishlists/builds KV persistence (#14)
7. ⬜ Credits page + weapon-lookup Darth Bot commands (#15)
8. ⬜ Recommendation/ranking — LAST, real cited signals only (#16)

## Token strategy
Local repos are the source of truth (no web scouts). Copy/derive (DIM enums, Clarity), don't regenerate. Bake static data once; re-bake on patch. Reuse existing infra. Deterministic NLP first. Incremental direct edits, verified with `tsc`/`vite build` — no agent fan-outs.

## Open assumptions
- New pages live in the **existing React app** (not a new SolidJS one).
- "Bungie usage" popularity isn't a real Bungie endpoint → recommendation ranks on Clarity quality + DIM wishlist curation + your build goals + can-roll. No invented usage stats.
