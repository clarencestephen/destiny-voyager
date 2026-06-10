#!/usr/bin/env node
/**
 * Verifies the mod-selection engine against the real baked catalog.
 * Compiles src/lib/mods.ts with esbuild (in-memory) and runs assertions.
 *   node scripts/test-mods.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "public/mods.json"), "utf8"));

// Transpile the engine (zero imports → clean standalone JS) then import it.
const tmp = "/tmp/modtest-engine";
execSync(
  `npx tsc "${path.join(root, "src/lib/mods.ts")}" --outDir ${tmp} ` +
  `--module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
  { stdio: "ignore" },
);
const { selectMods } = await import(path.join(tmp, "mods.js"));

let pass = 0, fail = 0;
const named = (slot, lo) => lo.slots[slot].mods.map((m) => m.n).join(" + ");
function check(label, got, want) {
  const ok = got === want;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${got}${ok ? "" : `   (expected: ${want})`}`);
  ok ? pass++ : fail++;
}

// ── Scenario 1: pure Void build, no encounter data ──────────────────
console.log("\nScenario 1 — Void subclass, Void DPS, no encounter:");
let lo = selectMods({ subclassElement: "Void" }, catalog);
check("Legs (offense)",  named("Legs", lo).split(" + ")[0],  "Void Weapon Surge");
check("Arms (reload)",   named("Arms", lo).split(" + ")[0],  "Void Loader");
check("Helmet (orbs)",   named("Helmet", lo).split(" + ")[0], "Void Siphon");
check("Chest (defense)", named("Chest", lo).split(" + ")[0], "Void Resistance");

// ── Scenario 2: Void build, KINETIC Praxic sword DPS, Hydra = Void incoming ──
console.log("\nScenario 2 — Void build + Kinetic DPS sword, encounter incoming Void:");
lo = selectMods(
  { subclassElement: "Void", dpsWeaponElement: "Kinetic", incomingElements: ["Void"] },
  catalog,
);
check("Legs follows weapon",  named("Legs", lo).split(" + ")[0],  "Kinetic Weapon Surge");
check("Arms follows build",   named("Arms", lo).split(" + ")[0],  "Void Loader");
check("Chest = anti-Void",    named("Chest", lo).split(" + ")[0], "Void Resistance");

// ── Scenario 3: explosive encounter → Concussive Dampener on chest ──
console.log("\nScenario 3 — Strand build, explosive-heavy encounter:");
lo = selectMods({ subclassElement: "Strand", concussive: true }, catalog);
check("Chest = Concussive",  named("Chest", lo).split(" + ")[0], "Concussive Dampener");
check("Legs = Strand Surge", named("Legs", lo).split(" + ")[0],  "Strand Weapon Surge");

// ── Scenario 4: stat mods distributed into general sockets ──────────
console.log("\nScenario 4 — Solar build + stat mods (Health 10, Grenade 5):");
lo = selectMods(
  { subclassElement: "Solar", statMods: [{ stat: "health", mag: 10 }, { stat: "grenade", mag: 5 }] },
  catalog,
);
const allMods = Object.values(lo.slots).flatMap((s) => s.mods.map((m) => m.n));
check("Health Mod placed",  allMods.includes("Health Mod") ? "yes" : "no", "yes");
check("Minor Grenade placed", allMods.includes("Minor Grenade Mod") ? "yes" : "no", "yes");
check("No cross-pollination (no Arc/Void/Stasis mod present)",
  allMods.some((n) => /\b(Arc|Void|Stasis|Strand|Kinetic)\b/.test(n)) ? "leaked" : "clean", "clean");

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
