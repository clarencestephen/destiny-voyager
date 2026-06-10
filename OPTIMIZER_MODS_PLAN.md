# Optimizer: Mods + One-Click Optimize-and-Equip

Goal: the Destiny Voyager optimizer should hand the Guardian a **finished,
equipped build** — right armor pieces *and* the right mods — from a single
click, tuned to the activity or encounter, with **zero downtime** mid-raid /
mid-match. Today it suggests "+50 Health" and the player still equips every
piece and every mod by hand.

## The vision (from the user)

1. **One click does it all.** Pick options → **Optimize & Equip** → the app
   pulls pieces into inventory (from vault if needed), equips the armor, and
   inserts the mods. No cycling inventory, no manual sockets.
2. **Mods are first-class in the optimization**, not an afterthought:
   - **Legs = offense** → element-matched **Weapon Surge**
   - **Chest = defense** → **Resistance** / **Concussive Dampener** (anti incoming dmg)
   - **Arms = reload** → element-matched **Loader**
   - **Helmet = orbs** → element-matched **Siphon**
   - **General socket (every piece) = stat mods** (Health/Weapons/Class/Grenade/Super/Melee)
3. **Anti-cross-pollination by element.** A Void build gets Void Loader + Void
   Surge + Void Siphon; Arc gets Arc, etc. A single piece never mixes elements.
   `Harmonic` mods auto-match the subclass and are the safe default. The **Surge**
   follows the **DPS weapon's** element (Kinetic Surge for a Kinetic Praxic sword
   even on a Void subclass); Loader/Siphon follow the **build** element.
4. **Anti-damage mods are activity/encounter-specific.** Vow / Desert Perpetual:
   anti-Void one encounter, anti-Concussive + anti-Void the next, anti-Void for
   the Hydra, flip to Kinetic Surge when swinging a Praxic sword. Both **pieces
   and mods** vary per encounter. Source of truth = the per-encounter raid KB
   (`recommended_defensive_mods.elemental/concussive` + `damage.surges`).
5. **Zero downtime.** If inventory/vault is full, evict the weakest-total-stat
   item(s) to the vault, then equip the optimized set live.
6. **Builds** (usually built around one exotic) considered where possible.

## Current state (mapped 2026-06-09)

- Optimizer: `web/src/pages/Optimizer.tsx` — synchronous TS cartesian-product
  solver (`optimize()` L208-301), stat-only `planMods()` (L97-143) that emits
  abstract +10/+5 counts, rendered as text (`ComboCard` L712-906). "Equip"
  button (`api.equip`) equips **pieces only** — no mod insertion.
- Mod insertion **already exists**: `api.equipWithMods()` (`web/src/lib/api.ts`
  L271-296) + the Fireteam page (`web/src/pages/Fireteam.tsx` L400-527) already
  drives per-socket plug inserts. We reuse this plumbing.
- Armor model: `Item` (`api.ts` L82-97) carries `stats`, `slot`, `element`,
  `archetype`, `plug_hashes`. Stat keys are EoF-renamed (weapons/health/class/
  grenade/super/melee). Worker `extractPlugs()` returns flat `plug_hashes`;
  full socket metadata (category/energy) is discarded → must be surfaced for
  the equip step to target sockets.
- Subclass/element of the character is **not** currently fetched in the
  optimizer (only guardian class). Needed for element-matched selection.

## Phases

### ✅ Phase 1 — Mod data + selection engine (DONE, 2026-06-09)
- `web/scripts/bake-mods.mjs` → `web/public/mods.json` (292 curated armor mods:
  surge/loader/siphon/resist/concussive/stat/survivability/…, each with slot,
  family, element, energy cost, icon). Re-run after a Bungie patch.
- `web/src/lib/mods.ts` — pure `selectMods(input, catalog)` engine. Given
  subclass element, DPS weapon element, encounter incoming-damage, and stat-mod
  requests, returns a concrete per-slot mod loadout (real plug hashes) within a
  per-piece energy budget. Anti-cross-pollination enforced.
- `web/scripts/test-mods.mjs` — 12 assertions over the real catalog, all green
  (incl. the Void-build / Kinetic-Praxic-sword / anti-Void-Hydra case).

### Phase 2 — Wire the engine into the optimizer UI  *(next)*
- Fetch the character's equipped subclass (Bungie component 205) → element.
- Add UI: subclass/element (auto-detected, overridable), DPS-weapon element,
  goal (offense/survival/balanced), and an **activity/encounter** selector.
- Replace the abstract mod-plan render in `ComboCard` with the real per-piece
  mod loadout from `selectMods()` (names + icons + energy used / budget).
- `frontend-design` skill for the card layout.

### Phase 3 — Encounter-aware mod sourcing from the raid KB
- New worker endpoint (or static export) surfacing per-encounter
  `recommended_defensive_mods.elemental/concussive` + `damage.surges` from
  `raid_context/content/{raids,dungeons}/<activity>/<encounter>.yaml`.
- Encounter selector feeds `incomingElements` / `concussive` / surge element
  into `selectMods()` so chest/legs swap per encounter. Depends on the KB being
  clean per-encounter (Task #6 fan-out).

### Phase 4 — One-click Optimize & Equip orchestration  *(account-mutating — GATED)*
Ordered pipeline (the "first & last" stat-eval bookends it):
1. **Evaluate** stat mods to pick the target set (already in `optimize()`).
2. **Stage pieces**: transfer the 5 pieces to the character (pull from vault).
   If inventory is full, **evict the weakest-total-stat item(s) to the vault**
   first so there is no gap.
3. **Equip** the armor pieces.
4. **Insert mods** (surge/resist/loader/siphon + stat mods) via
   `equipWithMods`, mapped to real socket indices + energy from live sockets.
> Requires worker socket metadata (category + energy per socket) on each piece.
> **Touches the real Destiny account** → ships behind an explicit confirm +
> dry-run preview, and is verified with the `webapp-testing` (Playwright) skill
> before it can mutate gear.

### Phase 5 — Builds around an exotic
- Curated build templates keyed on an exotic armor piece; the optimizer biases
  selection toward the build's stat profile + mods.

## Mod model (baked schema)
`mods.json`: `{ "<hash>": { n, slot, fam, el, cost, i?, stat?, mag? } }`
- `slot` Helmet|Arms|Chest|Legs|Class|General
- `fam`  surge|loader|siphon|resist|concussive|holster|dexterity|targeting|
         unflinch|ammo|survivability|stat|other
- `el`   Kinetic|Arc|Solar|Void|Stasis|Strand|Harmonic|"" (Harmonic = subclass-matched)
- `cost` energy; `stat`/`mag` for stat mods (+10 full / +5 minor)

## Selection rules (anti-cross-pollination)
| Slot   | Family            | Element driver                                  |
|--------|-------------------|-------------------------------------------------|
| Legs   | surge (offense)   | **DPS weapon** element (falls back to subclass) |
| Chest  | resist/concussive | **encounter** incoming dmg (else subclass)      |
| Arms   | loader (reload)   | **build** (subclass) element                    |
| Helmet | siphon (orbs)     | **build** (subclass) element                    |
| Class  | survivability     | n/a (Bomber/Distribution/Reaper)                |
| *each* | stat (general)    | biggest stat-need first, fit to 10e budget      |

## Open questions
- EoF armor energy: confirm the per-piece budget is still 10 and socket layout
  (how many slot-specific sockets coexist with the general/stat socket).
- Surge vs. weapon element when running **two** different-element DPS weapons.
- Vault-eviction "weakest total stat" tie-breaks (keep exotics? keep favorited?).
