#!/usr/bin/env node
/**
 * web/scripts/test-recommend.mjs — smoke test for the build-coherence recommender.
 * Transpiles lib/recommend.ts and runs the scorch-Warlock example against the
 * real synergy.json + weapons.json + armor.json, asserting the assembled build
 * is coherent (Incandescent GLs, Ember fragments, goal-appropriate set).
 *
 *   node web/scripts/test-recommend.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(__dirname, "..");
// run from the web dir with a relative path so tsc emits a flat /tmp/rec-test/recommend.js
execSync(`npx tsc src/lib/recommend.ts --outDir /tmp/rec-test --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`, { stdio: "inherit", cwd: web });
const { recommendBuild } = await import("/tmp/rec-test/recommend.js");

const syn = JSON.parse(fs.readFileSync(`${web}/public/synergy.json`, "utf8"));
const weapons = Object.entries(JSON.parse(fs.readFileSync(`${web}/public/weapons.json`, "utf8"))).map(([hash, v]) => ({ hash, ...v }));
const armor = JSON.parse(fs.readFileSync(`${web}/public/armor.json`, "utf8"));

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.log("  ✗ " + m)));

const boss = recommendBuild({ cls: "Warlock", element: "solar", theme: ["scorch", "ignition"], goal: "additional damage to the boss", weaponType: "grenade launcher" }, syn, weapons, armor);
console.log("Scorch Warlock · GL · boss damage:");
ok(boss.fragments.some((p) => /Ember of (Char|Singeing|Ashes|Wonder|Combustion|Blistering)/.test(p.item.n)), "recommends scorch fragments");
ok(boss.weapons.some((p) => p.item.t.toLowerCase().includes("grenade launcher")), "weapons honor grenade-launcher focus");
ok(boss.weapons.some((p) => /Incandescent/.test(p.why)), "weapons roll Incandescent (scorch)");
ok(boss.sets.some((p) => (syn.setKeywords[p.item.hash] || []).includes("surge")), "set bonus matches boss-damage (surge)");

const reload = recommendBuild({ cls: "Warlock", element: "solar", theme: ["scorch", "ignition"], goal: "faster reloading", weaponType: "grenade launcher" }, syn, weapons, armor);
console.log("Scorch Warlock · GL · reload:");
ok(reload.sets.some((p) => (syn.setKeywords[p.item.hash] || []).includes("reload")), "set bonus adapts to reload goal");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
