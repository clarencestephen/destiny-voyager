#!/usr/bin/env node
/**
 * web/scripts/bake-mods.mjs
 * =========================
 * Reads the local Bungie manifest cache and writes a curated armor-MOD
 * catalog to web/public/mods.json — the data layer for the optimizer's
 * mod-selection engine (web/src/lib/mods.ts).
 *
 * Only the modern "combat style" + stat sockets are included
 * (plugCategoryIdentifier `enhancements.v2_*`). Ornaments, armor glows,
 * empty/locked sockets, deprecated mods, and activity-specific raid mods
 * are dropped — the engine only ever equips the general slot-mods that
 * any Legendary armor piece can socket.
 *
 * Output schema  { "<hash>": { n, slot, fam, el, cost, i?, stat?, mag?, deltas? } }
 *   n    = display name                       ("Void Weapon Surge")
 *   slot = Helmet|Arms|Chest|Legs|Class|General|Tuning
 *   fam  = family the engine selects on:
 *            surge      (offense  — legs)   resist     (defense  — chest)
 *            loader     (reload   — arms)   concussive (defense  — chest)
 *            siphon     (orbs     — head)   holster|dexterity|targeting
 *            stat       (general socket)    survivability|ammo|unflinch|other
 *            tuning     (Tier-5 tuning socket: "+X / -Y" +5/−5 mods + Balanced)
 *   el   = Kinetic|Arc|Solar|Void|Stasis|Strand|Harmonic|""  (Harmonic = matches subclass)
 *   cost = energy cost (integer)
 *   i    = icon path (optional)
 *   stat = for fam=stat: which stat (health|weapons|class|grenade|super|melee)
 *   mag  = for fam=stat: +magnitude (10 full / 5 minor)
 *   deltas = for fam=tuning: full stat delta map from investmentStats, e.g.
 *            {"grenade":5,"health":-5} — Balanced Tuning is +1 to all six.
 *            Verified 2026-07-22 against live component-304 sheets: the names
 *            match the investment effects (no manifest drift).
 *
 * Run after a Bungie patch:  node web/scripts/bake-mods.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_CANDIDATES = [
  "/home/cs/workspace/Destiny 2/manifest_cache/DestinyInventoryItemDefinition.json",
  "/home/cs/workspace/Destiny 2/destiny2-loadout-toolkit/manifest_cache/DestinyInventoryItemDefinition.json",
];
const OUT = path.resolve(__dirname, "../public/mods.json");

function findSrc() {
  for (const p of SRC_CANDIDATES) if (fs.existsSync(p)) return p;
  console.error("ERROR: manifest cache not found. Checked:");
  SRC_CANDIDATES.forEach((p) => console.error("  " + p));
  process.exit(1);
}

// plugCategoryIdentifier prefix -> our slot label. Only these v2 sockets
// are slottable on every Legendary armor piece; everything else is
// cosmetic / activity-locked and intentionally excluded.
const PLUG_SLOT = {
  "enhancements.v2_head":       "Helmet",
  "enhancements.v2_arms":       "Arms",
  "enhancements.v2_chest":      "Chest",
  "enhancements.v2_legs":       "Legs",
  "enhancements.v2_class_item": "Class",
  "enhancements.v2_general":    "General",
};

const ELEMENTS = ["Kinetic", "Arc", "Solar", "Void", "Stasis", "Strand", "Harmonic"];
const STAT_WORDS = {
  Health: "health", Weapons: "weapons", Class: "class",
  Grenade: "grenade", Super: "super", Melee: "melee",
};

// Tier-5 tuning socket plugs. Canonical stat hashes (unchanged since D2 launch;
// EoF renamed the labels only — Recovery→Class, Discipline→Grenade, Intellect→Super).
const TUNING_CAT = "core.gear_systems.armor_tiering.plugs.tuning.mods";
const STAT_BY_HASH = {
  2996146975: "weapons", 392767087: "health", 1943323491: "class",
  1735777505: "grenade", 144602215: "super", 4244567218: "melee",
};

// Names we never want the engine to consider, even inside a v2 socket.
const NAME_SKIP = /^(Empty .*Socket|Locked .*|Upgrade to Artifice Armor|Balanced Tuning|\+.* \/ -.*|.* Forged)$/i;

function parseElement(name) {
  for (const el of ELEMENTS) {
    if (new RegExp(`\\b${el}\\b`).test(name)) return el;
  }
  return "";
}

/** Classify a mod into the family the selection engine reasons about. */
function classify(name) {
  if (/Weapon Surge$/.test(name))            return "surge";       // offense (legs)
  if (/\bLoader$/.test(name))                return "loader";      // reload (arms)
  if (/\bSiphon$/.test(name))                return "siphon";      // orbs (head)
  if (/Concussive Dampener/.test(name))      return "concussive";  // defense (chest)
  if (/\bResistance$/.test(name))            return "resist";      // defense (chest)
  if (/Damage Resistance$/.test(name))       return "resist";      // Melee/Sniper Damage Resistance (chest)
  if (/\bHolster$/.test(name))               return "holster";     // ready speed (legs)
  if (/\bDexterity$/.test(name))             return "dexterity";   // ready/stow (arms)
  if (/\bTargeting$/.test(name))             return "targeting";   // aim assist (head)
  if (/^Unflinching .* Aim$/.test(name))     return "unflinch";    // flinch resist (chest)
  if (/Ammo (Finder|Scout)$/.test(name))     return "ammo";        // ammo economy (head)
  if (/^(Recuperation|Better Already|Innervation|Invigoration|Insulation|Absolution|Orbs of Restoration|Stacks on Stacks|Bomber|Distribution|Reaper|Powerful Attraction|Time Dilation|Outreach|Proximity Ward)$/.test(name))
    return "survivability";
  return "other";
}

function statOf(name) {
  // "Health Mod" (+10) / "Minor Health Mod" (+5) — EoF stat names.
  const m = name.match(/^(Minor )?(Health|Weapons|Class|Grenade|Super|Melee) Mod$/);
  if (!m) return null;
  return { stat: STAT_WORDS[m[2]], mag: m[1] ? 5 : 10 };
}

const src = findSrc();
console.log(`Reading ${src} (~${(fs.statSync(src).size / 1e6).toFixed(1)} MB)...`);
const items = JSON.parse(fs.readFileSync(src, "utf8"));
console.log(`  ${Object.keys(items).length.toLocaleString()} raw item definitions`);

const out = {};
const byFamily = {};
const byStat = {};
let kept = 0;

for (const [hash, defn] of Object.entries(items)) {
  if (defn.redacted === true) continue;
  const plug = defn.plug || {};

  // Armor masterwork / "Upgrade Armor" plugs — each grants +N to ALL six stats
  // (EoF v460: +1 per upgrade level up to +5; legacy armor 2.0: +2 at
  // masterwork). Baked so the client can (a) strip the CURRENT level out of the
  // live sheet and (b) project "assume masterworked" stats. Zero-bonus level
  // plugs are skipped — absence of a baked plug simply means +0.
  const pid = plug.plugCategoryIdentifier || "";
  if (/plugs\.(armor\.)?masterworks/.test(pid) && /armor/.test(pid)) {
    const deltas = {};
    for (const s of defn.investmentStats || []) {
      const k = STAT_BY_HASH[s.statTypeHash];
      if (k && s.value) deltas[k] = (deltas[k] ?? 0) + s.value;
    }
    if (!Object.keys(deltas).length) continue;
    const name = (defn.displayProperties?.name || "Upgrade Armor").trim();
    out[hash] = { n: name, slot: "Tuning", fam: "masterwork", el: "", cost: 0, deltas };
    byFamily.masterwork = (byFamily.masterwork || 0) + 1;
    kept++;
    continue;
  }

  // Tuning socket plugs (Tier-5 armor). Keep every "+X / -Y" mod + Balanced;
  // skip the Empty socket plug. Effects come from investmentStats (verified to
  // match the display names).
  if (plug.plugCategoryIdentifier === TUNING_CAT) {
    const name = (defn.displayProperties?.name || "").trim();
    if (!name || /^Empty /.test(name)) continue;
    const deltas = {};
    for (const s of defn.investmentStats || []) {
      const k = STAT_BY_HASH[s.statTypeHash];
      if (k && s.value) deltas[k] = (deltas[k] ?? 0) + s.value;
    }
    if (!Object.keys(deltas).length) continue;
    out[hash] = {
      n: name, slot: "Tuning", fam: "tuning", el: "",
      cost: defn.plug?.energyCost?.energyCost ?? 0, deltas,
    };
    byFamily.tuning = (byFamily.tuning || 0) + 1;
    kept++;
    continue;
  }

  const slot = PLUG_SLOT[plug.plugCategoryIdentifier];
  if (!slot) continue;                                   // not a slottable v2 armor mod
  const name = (defn.displayProperties?.name || "").trim();
  if (!name || NAME_SKIP.test(name)) continue;

  // Skip ARTIFACT-gated copies ("Must Be Selected in the Seasonal Artifact").
  // The manifest carries a permanent armor mod AND a same-named seasonal-artifact
  // version (cheaper energy, no collectible). The artifact one is only insertable
  // while chosen in the artifact — recommending it blind fails Bungie's
  // DestinyFailedPlugInsertionRules. The equip flow must only ever recommend mods
  // it can actually insert, so keep the permanent versions only.
  if ((plug.enabledRules || []).some((r) => /Artifact/i.test(r.failureMessage || ""))) continue;

  const cost = defn.plug?.energyCost?.energyCost ?? 0;
  const icon = (defn.displayProperties?.icon || "").trim();

  let fam, el = "", extra = {};
  const stat = statOf(name);
  if (slot === "General" && stat) {
    fam = "stat";
    extra = { stat: stat.stat, mag: stat.mag };
  } else if (slot === "General") {
    continue;                                            // skip non-stat general (tuning/deprecated)
  } else {
    fam = classify(name);
    el = parseElement(name);
  }

  // de-dupe by (name,slot,fam,el,cost,stat,mag): the manifest keeps many
  // legacy copies of identically-named mods. Keep the first; record hash.
  const dedupeKey = `${name}|${slot}|${fam}|${el}|${cost}|${extra.stat ?? ""}|${extra.mag ?? ""}`;
  if (out.__seen?.has(dedupeKey)) continue;
  (out.__seen ??= new Set()).add(dedupeKey);

  out[hash] = { n: name, slot, fam, el, cost, ...(icon ? { i: icon } : {}), ...extra };
  byFamily[fam] = (byFamily[fam] || 0) + 1;
  if (fam === "stat") byStat[`${extra.stat}+${extra.mag}`] = (byStat[`${extra.stat}+${extra.mag}`] || 0) + 1;
  kept++;
}
delete out.__seen;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\n✓ wrote ${OUT}`);
console.log(`  size: ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB · ${kept} mods`);
console.log(`  families: ${Object.entries(byFamily).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
console.log(`  stat mods: ${Object.entries(byStat).sort().map(([k, v]) => `${k}(${v})`).join("  ")}`);
