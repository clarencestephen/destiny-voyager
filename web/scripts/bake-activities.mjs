/**
 * web/scripts/bake-activities.mjs
 *
 * Emits web/public/activities.json — a slim { activityHash: {n, t} } lookup
 * used by the "This Week" pages to resolve WHICH raid/dungeon/etc. the
 * Bungie /Destiny2/Milestones/ rotation is pointing at.
 *
 * Kept small by filtering to rotation-relevant activity types only.
 * Exits 0 with a warning if the source defs are missing (so the prebuild
 * chain never breaks on a machine without the manifest cache).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MC_CANDIDATES = [
  "/home/cs/workspace/Destiny 2/manifest_cache",
  path.resolve(__dirname, "../../manifest_cache"),
];
const MC = MC_CANDIDATES.find((p) => fs.existsSync(path.join(p, "DestinyActivityDefinition.json")));
const OUT = path.resolve(__dirname, "../public/activities.json");

if (!MC) {
  console.warn("[bake-activities] DestinyActivityDefinition.json not in manifest cache — skipping (existing activities.json kept).");
  process.exit(0);
}

const acts = JSON.parse(fs.readFileSync(path.join(MC, "DestinyActivityDefinition.json"), "utf8"));
const types = JSON.parse(fs.readFileSync(path.join(MC, "DestinyActivityTypeDefinition.json"), "utf8"));

const typeName = {};
for (const [h, t] of Object.entries(types)) {
  typeName[h] = t?.displayProperties?.name ?? "";
}

// Rotation-relevant type names — everything the This Week milestones can
// reference. Anything else (patrols, story, strikes playlists…) is noise.
const KEEP_TYPES = new Set([
  "Raid", "Dungeon", "Lost Sector", "Trials of Osiris", "Iron Banner",
  "Nightfall", "Exotic Mission",
]);

const out = {};
let kept = 0;
for (const [h, a] of Object.entries(acts)) {
  const n = a?.displayProperties?.name;
  if (!n) continue;
  const t = typeName[String(a.activityTypeHash)] ?? "";
  if (!KEEP_TYPES.has(t) && !n.includes("Lost Sector")) continue;
  out[h] = { n, t: t || "Lost Sector" };
  kept++;
}

fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`✓ wrote ${OUT}`);
console.log(`  activities kept: ${kept} (${kb} KB)`);
