import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  api, loadManifest, decorate,
  type LeanItem, type Item, type SlimManifest, type UserProfile,
} from "@/lib/api";
import { bucketPlugs, WEAPON_STAT_LABELS, type LoadoutBuckets, type ResolvedPlug } from "@/lib/loadout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "dv_fireteam_names";
const CLASS_COLOR: Record<string, string> = {
  hunter: "text-hunter",
  titan:  "text-titan",
  warlock:"text-warlock",
};

// Slot display order for the engram.blue-style tile column
const SLOT_ORDER = [
  "Kinetic", "Energy", "Heavy",
  "Helmet", "Gauntlets", "Chest", "Legs", "Class",
  "Ghost",
] as const;

type ApiMember = Awaited<ReturnType<typeof api.fireteam>>["members"][number];
type SuccessMember = Extract<ApiMember, { display_name: string }>;
type Character = SuccessMember["characters"][number];

// ============================================================
// Page
// ============================================================
export default function Fireteam() {
  const [params, setParams] = useSearchParams();
  const [inputText, setInputText] = useState<string>("");
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [autoExpanded, setAutoExpanded] = useState(false);
  const [manifest, setManifest] = useState<SlimManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openMember, setOpenMember] = useState<{
    member: SuccessMember; character: Character;
  } | null>(null);
  // My own profile + inventory + active char — needed for the "Load this
  // loadout" button on the modal. Loaded lazily; null = not signed in.
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [myItems, setMyItems] = useState<Item[]>([]);
  const [myActiveCharId, setMyActiveCharId] = useState<string | null>(null);

  // Restore last fireteam list (or take ?q=Name#1234 from URL for shareable links)
  useEffect(() => {
    const q = params.get("q");
    if (q) {
      setInputText(q);
      // Auto-load when URL drives the query
      loadFireteamFromInput(q);
    } else {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) setInputText(cached);
    }
    loadManifest().then(setManifest).catch(() => {});
    // Try to load the user's own inventory in the background — drives
    // the "Load this loadout" button on the modal. Silent failure when
    // not signed in.
    (async () => {
      try {
        const [me, items] = await Promise.all([api.me(), api.inventoryDecorated()]);
        setMyProfile(me);
        setMyItems(items);
        if (me.characters?.length) {
          const cached = localStorage.getItem("dv_active_char");
          const found = me.characters.find((c) => c.id === cached);
          setMyActiveCharId(found ? found.id : me.characters[0].id);
        }
      } catch { /* not signed in — fine */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFireteamFromInput(text: string) {
    const names = text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    if (names.length > 12) {
      setErr("max 12 members per lookup");
      return;
    }
    setErr(null);
    setLoading(true);
    setOpenMember(null);
    localStorage.setItem(STORAGE_KEY, text);
    try {
      const resp = await api.fireteam(names);
      setMembers(resp.members);
      // If we sent 1 name and got > 1 back, the Worker auto-expanded the fireteam.
      setAutoExpanded(names.length === 1 && resp.members.length > 1);
      // Sync ?q= URL param when single-name (so the page is shareable)
      if (names.length === 1) {
        setParams({ q: names[0] }, { replace: true });
      } else {
        setParams({}, { replace: true });
      }
    } catch (e: any) {
      setErr(e?.message ?? "lookup failed");
    } finally {
      setLoading(false);
    }
  }

  function loadFireteam() {
    return loadFireteamFromInput(inputText);
  }

  // Group successful members by class for the grouped layout
  const grouped = useMemo(() => {
    const groups: Record<"hunter" | "titan" | "warlock" | "other", Array<{
      m: SuccessMember; c: Character;
    }>> = { hunter: [], titan: [], warlock: [], other: [] };
    for (const m of members) {
      if (!("characters" in m) || !m.characters?.length) continue;
      // Show the highest-light character only — matches engram.blue convention
      const top = m.characters[0];
      const key = (top.class in groups ? top.class : "other") as keyof typeof groups;
      groups[key].push({ m, c: top });
    }
    return groups;
  }, [members]);

  const errored = members.filter((m): m is Extract<ApiMember, { error: string }> => "error" in m);

  return (
    <section className="container py-10 flex flex-col gap-6 max-w-6xl">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">
          ▲ Fireteam Viewer
        </span>
        <h1 className="font-display text-3xl tracking-[0.18em] font-black text-signature">
          FIRETEAM
        </h1>
        <p className="font-ui text-sm text-muted-foreground max-w-2xl">
          Type <strong>one</strong> Bungie name to auto-pull everyone in their current fireteam
          (via Bungie's profile-transitory data — engram.blue-style). Or paste multiple names
          to view an arbitrary list. Public equipment only — no sign-in needed for the people
          you're looking up.
        </p>
      </header>

      <Card className="p-5 space-y-4">
        <label className="block font-mono text-[10px] tracking-[0.25em] uppercase text-muted">
          Bungie name(s) (Name#1234 — one for auto-fireteam, or multiple)
        </label>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          rows={3}
          placeholder={"Darth_Bankai#1541\n\n(or paste multiple names — one per line)"}
          className="w-full bg-void/40 border border-border rounded px-3 py-2 font-ui text-sm focus:outline-none focus:ring-1 focus:ring-sith"
        />
        <div className="flex items-center gap-3">
          <Button onClick={loadFireteam} disabled={loading || !inputText.trim()}>
            {loading ? "Loading…" : "Load fireteam"}
          </Button>
          {err && <span className="font-ui text-xs text-red-400">⚠ {err}</span>}
          {autoExpanded && (
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-emerald-400">
              auto-discovered {members.length}-player fireteam
            </span>
          )}
          {!autoExpanded && members.length === 1 && inputText.trim().split(/[\n,]+/).filter(Boolean).length === 1 && (
            <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted">
              no active fireteam — showing single guardian
            </span>
          )}
        </div>
      </Card>

      {errored.length > 0 && (
        <Card className="p-4 border-amber-400/30">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-400 mb-2">
            Couldn't look up
          </h3>
          <ul className="font-ui text-xs text-muted-foreground space-y-1">
            {errored.map((e, i) => (
              <li key={i}>
                <span className="text-foreground">{e.bungie_name}</span> — {e.error}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Class-grouped grid */}
      {(["hunter", "titan", "warlock", "other"] as const).map((klass) => {
        const list = grouped[klass];
        if (!list.length) return null;
        return (
          <div key={klass}>
            <h2 className={`font-display text-xl tracking-wide mb-3 capitalize ${CLASS_COLOR[klass] ?? ""}`}>
              {klass}
            </h2>
            <div className="flex flex-wrap gap-6">
              {list.map(({ m, c }) => (
                <GuardianColumn
                  key={`${m.membership_id}-${c.id}`}
                  member={m}
                  character={c}
                  manifest={manifest}
                  onClick={() => setOpenMember({ member: m, character: c })}
                />
              ))}
            </div>
          </div>
        );
      })}

      {openMember && manifest && (
        <DetailModal
          member={openMember.member}
          character={openMember.character}
          manifest={manifest}
          onClose={() => setOpenMember(null)}
          myProfile={myProfile}
          myItems={myItems}
          myActiveCharId={myActiveCharId}
        />
      )}
    </section>
  );
}

// ============================================================
// Single guardian column (engram.blue-style stack)
// ============================================================
function GuardianColumn({
  member, character, manifest, onClick,
}: {
  member: SuccessMember; character: Character;
  manifest: SlimManifest | null; onClick: () => void;
}) {
  // Sort equipped items into our display order
  const bySlot = useMemo(() => {
    const m: Record<string, typeof character.equipped[number]> = {};
    for (const it of character.equipped) m[it.slot] = it;
    return m;
  }, [character.equipped]);

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-stretch gap-1 group"
      title="Click for full loadout"
    >
      <div className="text-center font-ui text-sm font-medium group-hover:text-saber truncate w-24">
        {member.display_name}
      </div>
      <div className="text-center font-mono text-[10px] tracking-[0.25em] uppercase text-muted">
        pw {character.light}
      </div>
      <div className="grid grid-cols-1 gap-1">
        {SLOT_ORDER.map((slot) => {
          const item = bySlot[slot];
          return (
            <ItemTile key={slot} item={item ?? null} slot={slot} manifest={manifest} />
          );
        })}
      </div>
    </button>
  );
}

// ============================================================
// Single armor / weapon tile
// ============================================================
function ItemTile({
  item, slot, manifest,
}: {
  item: { hash: number } | null; slot: string; manifest: SlimManifest | null;
}) {
  if (!item) {
    return (
      <div
        title={`${slot} (empty)`}
        className="w-16 h-16 rounded border border-border bg-void/40"
      />
    );
  }
  const m = manifest?.[String(item.hash)];
  const icon = m?.i ? `https://www.bungie.net${m.i}` : "";
  const isExotic = m?.x;
  return (
    <div
      title={`${m?.n ?? "?"} (${slot})`}
      className={`w-16 h-16 rounded border overflow-hidden bg-deepspace/60 ${
        isExotic ? "border-amber-300/80" : "border-border"
      }`}
    >
      {icon ? (
        <img src={icon} alt={m?.n ?? ""} className="w-full h-full" />
      ) : (
        <div className="w-full h-full flex items-center justify-center font-mono text-[8px] text-muted">
          {slot}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Modal — full detail on click
// ============================================================
// Plug-name → "category" classifier. Resistance/dampener/anti- mods are
// the most useful for copying a raid leader's loadout, so we highlight
// them. Other mods are still shown as plain badges.
const RESIST_PATTERNS: Array<[string, string]> = [
  [/\barc resistance\b/i.source,           "arc"],
  [/\bvoid resistance\b/i.source,          "void"],
  [/\bsolar resistance\b/i.source,         "solar"],
  [/\bstasis resistance\b/i.source,        "stasis"],
  [/\bstrand resistance\b/i.source,        "strand"],
  [/\bkinetic resistance\b/i.source,       "kinetic"],
  [/\bmelee resistance\b/i.source,         "melee"],
  [/\bconcussive dampener\b/i.source,      "concussive"],
  [/\banti[- ]?sniper\b/i.source,          "anti-sniper"],
  [/\banti[- ]?barrier\b/i.source,         "anti-barrier"],
  [/\banti[- ]?overload\b/i.source,        "anti-overload"],
  [/\banti[- ]?unstoppable\b/i.source,     "anti-unstoppable"],
];

const RESIST_COLOR: Record<string, string> = {
  "arc":              "border-yellow-300 text-yellow-300",
  "void":             "border-purple-400 text-purple-300",
  "solar":            "border-orange-400 text-orange-300",
  "stasis":           "border-sky-400 text-sky-300",
  "strand":           "border-emerald-400 text-emerald-300",
  "kinetic":          "border-zinc-300 text-zinc-200",
  "melee":            "border-rose-400 text-rose-300",
  "concussive":       "border-amber-500 text-amber-400",
  "anti-sniper":      "border-fuchsia-400 text-fuchsia-300",
  "anti-barrier":     "border-yellow-500 text-yellow-400",
  "anti-overload":    "border-blue-500 text-blue-400",
  "anti-unstoppable": "border-red-400 text-red-300",
};

function classifyMod(name: string): string | null {
  for (const [pat, label] of RESIST_PATTERNS) {
    if (new RegExp(pat, "i").test(name)) return label;
  }
  return null;
}

function DetailModal({
  member, character, manifest, onClose,
  myProfile, myItems, myActiveCharId,
}: {
  member: SuccessMember; character: Character; manifest: SlimManifest;
  onClose: () => void;
  myProfile: import("@/lib/api").UserProfile | null;
  myItems: import("@/lib/api").Item[];
  myActiveCharId: string | null;
}) {
  // Decorate equipped items: name + element + tier + per-item bucketed plugs.
  type DecoratedItem = Item & {
    buckets: LoadoutBuckets;
    /** Full active plug list (kept for back-compat with armor-mod chip rendering). */
    mods: Array<{ hash: number; name: string; type: string }>;
    item_stats?: Record<string, number>;
  };
  const decorated: DecoratedItem[] = useMemo(() => {
    return character.equipped.map((it) => {
      const lean: LeanItem = {
        instance_id: it.instance_id,
        hash: it.hash,
        power: it.power,
        location: "EQUIPPED",
      };
      const item = decorate(lean, manifest);
      item.slot = it.slot || item.slot;
      const plugs = it.plug_hashes ?? [];
      const buckets = bucketPlugs(plugs, manifest);
      // Legacy flat "mods" list — used by the armor-mod resistance
      // summary chip block. Keep both shapes available.
      const mods = plugs.map((h) => {
        const m = manifest[String(h)];
        return { hash: h, name: m?.n ?? "", type: m?.t ?? "" };
      }).filter((m) => m.name && m.name !== "Empty Mod Socket");
      return Object.assign(item, { buckets, mods, item_stats: it.item_stats });
    });
  }, [character.equipped, manifest]);

  const bySlot = useMemo(() => {
    const m: Record<string, DecoratedItem> = {};
    for (const it of decorated) m[it.slot] = it;
    return m;
  }, [decorated]);

  // Match leader's items (by hash, the item template) to MY inventory
  // so we can offer a one-click "load this loadout" copy. For weapons +
  // armor the user has, we collect instance_ids and equip via /api/equip.
  // Subclass + mods are NOT applied (Bungie doesn't expose mod-insert
  // without a per-plug call we haven't built yet) — surfaced as a
  // separate "you'll also want to set" hint.
  type LoadPlan = {
    items: Array<{ slot: string; theirName: string; myItem?: import("@/lib/api").Item }>;
    instanceIds: string[];
    missing: Array<{ slot: string; name: string }>;
    /** For each armor slot we matched, the mods (by socket index +
     *  plug hash) the leader has equipped. Frontend builds this from
     *  the leader's plug_hashes + slim-manifest type lookups; Worker
     *  applies them via /api/equip-with-mods. */
    modPlan: Array<{
      instance_id: string;
      sockets: Array<{ socketIndex: number; plugItemHash: number }>;
    }>;
    modCount: number;
  };
  const loadPlan = useMemo<LoadPlan>(() => {
    const items: LoadPlan["items"] = [];
    const instanceIds: string[] = [];
    const missing: LoadPlan["missing"] = [];
    const modPlan: LoadPlan["modPlan"] = [];
    let modCount = 0;
    if (!myItems.length) return { items, instanceIds, missing, modPlan, modCount };
    const mineByHash: Record<number, import("@/lib/api").Item[]> = {};
    for (const it of myItems) {
      mineByHash[it.hash] = mineByHash[it.hash] || [];
      mineByHash[it.hash].push(it);
    }
    // Try every leader-equipped slot that's not Subclass / Ghost / Ship etc.
    const COPY_SLOTS = ["Kinetic", "Energy", "Heavy", "Helmet", "Gauntlets", "Chest", "Legs", "Class"];
    const ARMOR_SLOTS_SET = new Set(["Helmet", "Gauntlets", "Chest", "Legs", "Class"]);
    for (const slot of COPY_SLOTS) {
      const theirs = decorated.find((d) => d.slot === slot);
      if (!theirs) continue;
      const myHits = mineByHash[theirs.hash] || [];
      const mine = myHits[0];
      items.push({ slot, theirName: theirs.name, myItem: mine });
      if (mine) {
        instanceIds.push(mine.instance_id);
        // Mod copy is armor-only (weapons mods don't transfer cleanly —
        // they're random rolls). For armor pieces the user owns, scan
        // the leader's plug_hashes; for any plug whose manifest type
        // says it's an "Armor Mod" / "Stat Mod" / "Seasonal Mod",
        // emit a {socketIndex, plugItemHash} entry. Socket index =
        // position in the leader's plug_hashes array (which mirrors
        // Bungie's sockets[] order for that item).
        if (ARMOR_SLOTS_SET.has(slot)) {
          const leaderPlugs = character.equipped.find((e) => e.slot === slot)?.plug_hashes ?? [];
          const sockets: Array<{ socketIndex: number; plugItemHash: number }> = [];
          leaderPlugs.forEach((h, idx) => {
            const m = manifest[String(h)];
            if (!m?.t) return;
            const t = m.t.toLowerCase();
            // Only target plugs that look like mods (skip archetype
            // intrinsics, ornaments, shaders, etc.)
            const isMod =
              t.includes("armor mod") ||
              t.includes("stat mod") ||
              t.includes("seasonal mod") ||
              t.includes("artifice");
            if (isMod) {
              sockets.push({ socketIndex: idx, plugItemHash: h });
            }
          });
          if (sockets.length > 0) {
            modPlan.push({ instance_id: mine.instance_id, sockets });
            modCount += sockets.length;
          }
        }
      } else {
        missing.push({ slot, name: theirs.name });
      }
    }
    return { items, instanceIds, missing, modPlan, modCount };
  }, [decorated, myItems, character.equipped, manifest]);

  const [loadState, setLoadState] = useState<
    | { kind: "idle" }
    | { kind: "working" }
    | {
        kind: "done";
        msg: string;
        skipped: Array<{ instance_id: string; reason: string }>;
        modsInserted?: number;
        modsFailed?: number;
        modFailures?: Array<{ instance_id: string; socketIndex: number; error?: string }>;
      }
    | { kind: "error"; msg: string }
  >({ kind: "idle" });
  // User toggle: try to copy armor mods socket-by-socket too. Off by
  // default since per-socket Bungie calls are slow + can fail (mod not
  // unlocked, socket incompatible).
  const [copyMods, setCopyMods] = useState(true);

  async function loadLoadout() {
    if (!myActiveCharId || loadPlan.instanceIds.length === 0) return;
    setLoadState({ kind: "working" });
    try {
      if (copyMods && loadPlan.modPlan.length > 0) {
        const res = await api.equipWithMods(
          myActiveCharId,
          loadPlan.instanceIds,
          loadPlan.modPlan,
        );
        const failures = res.mod_results
          .filter((m) => !m.ok)
          .map((m) => ({ instance_id: m.instance_id, socketIndex: m.socketIndex, error: m.error }));
        setLoadState({
          kind: "done",
          msg: `equipped ${res.equipped_count}/${loadPlan.instanceIds.length} · mods ${res.mods_inserted}/${res.mods_inserted + res.mods_failed}`,
          skipped: res.skipped,
          modsInserted: res.mods_inserted,
          modsFailed: res.mods_failed,
          modFailures: failures,
        });
      } else {
        const res = await api.equip(myActiveCharId, loadPlan.instanceIds);
        setLoadState({
          kind: "done",
          msg: `equipped ${res.equipped_count}/${loadPlan.instanceIds.length}`,
          skipped: res.skipped,
        });
      }
    } catch (e: any) {
      setLoadState({ kind: "error", msg: e?.message ?? "equip failed" });
    }
  }

  // Resistance/utility mods, aggregated across all armor pieces — for the
  // top-of-modal "what is this guardian shielding against?" callout.
  const resistSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of decorated) {
      for (const m of it.mods) {
        const cat = classifyMod(m.name);
        if (cat) counts[cat] = (counts[cat] ?? 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [decorated]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <Card
        className="max-w-3xl w-full p-6 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="min-w-0">
            <div className={`font-mono text-[10px] tracking-[0.3em] uppercase ${CLASS_COLOR[character.class] ?? ""}`}>
              {character.class} · pw {character.light}
            </div>
            <h2 className="font-display text-2xl tracking-wide mt-1">
              {member.display_name}
              <span className="text-muted ml-2 font-mono text-xs">#{member.bungie_name.split("#")[1] ?? ""}</span>
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {myActiveCharId && loadPlan.instanceIds.length > 0 && (
              <>
                {loadPlan.modCount > 0 && (
                  <label className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] uppercase text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={copyMods}
                      onChange={(e) => setCopyMods(e.target.checked)}
                      className="accent-saber"
                    />
                    <span>copy mods ({loadPlan.modCount})</span>
                  </label>
                )}
                <Button
                  onClick={loadLoadout}
                  disabled={loadState.kind === "working"}
                  variant="primary"
                  title={
                    copyMods && loadPlan.modPlan.length > 0
                      ? `Equip ${loadPlan.instanceIds.length} items + copy ${loadPlan.modCount} armor mods`
                      : `Equip ${loadPlan.instanceIds.length} matched items`
                  }
                >
                  {loadState.kind === "working"
                    ? "Loading…"
                    : `Load ${loadPlan.instanceIds.length}/${loadPlan.items.length}${
                        copyMods && loadPlan.modCount > 0 ? ` +${loadPlan.modCount} mods` : ""
                      }`}
                </Button>
              </>
            )}
            <button onClick={onClose} className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted hover:text-saber px-2">
              ✕ close
            </button>
          </div>
        </div>

        {loadState.kind === "done" && (
          <div className="mb-3 px-3 py-2 rounded border border-emerald-400/40 bg-emerald-400/5 font-ui text-xs text-emerald-300">
            ✓ {loadState.msg}
            {loadState.skipped.length > 0 && (
              <div className="mt-1 text-amber-300">
                skipped: {loadState.skipped.map((s) => s.reason).join(" · ")}
              </div>
            )}
            {loadState.modFailures && loadState.modFailures.length > 0 && (
              <div className="mt-1 text-amber-300">
                {loadState.modFailures.length} mod insert{loadState.modFailures.length === 1 ? "" : "s"} failed
                <span className="text-muted ml-2">
                  (usually means the mod isn't unlocked on your account, or the
                  socket layout differs from the leader's)
                </span>
              </div>
            )}
          </div>
        )}
        {loadState.kind === "error" && (
          <div className="mb-3 px-3 py-2 rounded border border-red-400/40 bg-red-400/5 font-ui text-xs text-red-300">
            ⚠ {loadState.msg}
          </div>
        )}

        {!myProfile && (
          <div className="mb-3 px-3 py-2 rounded border border-saber/30 bg-saber/5 font-ui text-xs text-saber">
            Sign in (top of /play or /dashboard) to copy this loadout onto your guardian.
          </div>
        )}
        {myProfile && loadPlan.missing.length > 0 && (
          <div className="mb-3 px-3 py-2 rounded border border-amber-400/30 bg-amber-400/5 font-ui text-xs">
            <span className="text-amber-400 font-mono tracking-[0.2em] uppercase text-[10px]">
              You don't own ({loadPlan.missing.length}):
            </span>{" "}
            <span className="text-muted-foreground">
              {loadPlan.missing.map((m) => `${m.name} (${m.slot})`).join(" · ")}
            </span>
          </div>
        )}

        {character.emblem_background_path && (
          <div
            className="rounded border border-border h-20 mb-4 bg-cover bg-center"
            style={{ backgroundImage: `url(${character.emblem_background_path})` }}
          />
        )}

        {/* Resistance / utility mod summary — top of the modal so you can
            spot what damage type they're shielding against per encounter. */}
        {resistSummary.length > 0 && (
          <div className="mb-4 px-3 py-2 rounded border border-saber/30 bg-saber/5">
            <div className="font-mono text-[10px] tracking-[0.25em] uppercase text-saber mb-2">
              Resistance / utility mods (across all armor)
            </div>
            <div className="flex flex-wrap gap-2">
              {resistSummary.map(([cat, n]) => (
                <span
                  key={cat}
                  className={`font-mono text-[10px] tracking-[0.2em] uppercase px-2 py-0.5 rounded border ${
                    RESIST_COLOR[cat] ?? "border-border text-muted"
                  }`}
                >
                  {n}× {cat}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Section: WEAPONS (Kinetic / Energy / Heavy). Each weapon shows
            its perk roll columns (Intrinsic + Barrel + Magazine + Trait1+2 +
            Masterwork + Mod) plus the per-instance stat sheet. */}
        <Section title="Weapons">
          <div className="space-y-4">
            {["Kinetic", "Energy", "Heavy"].map((slot) => {
              const it = bySlot[slot];
              if (!it) return <EmptySlotLine key={slot} slot={slot} />;
              return <WeaponLine key={slot} item={it} />;
            })}
          </div>
        </Section>

        {/* Section: ARMOR + MODS — each piece shows its mods inline,
            resistance-type chips color-coded. */}
        <Section title="Armor + Mods">
          <div className="space-y-3">
            {["Helmet", "Gauntlets", "Chest", "Legs", "Class"].map((slot) => {
              const it = bySlot[slot];
              if (!it) return <EmptySlotLine key={slot} slot={slot} />;
              return <ArmorLine key={slot} item={it} />;
            })}
          </div>
        </Section>

        {/* Section: SUBCLASS — super + abilities + aspects + fragments. */}
        {bySlot["Subclass"] && (
          <Section title="Subclass">
            <SubclassLine item={bySlot["Subclass"]} />
          </Section>
        )}

        {/* Section: GHOST — if mod plugs exist (finders / ghost trackers). */}
        {bySlot["Ghost"] && (bySlot["Ghost"].mods?.length ?? 0) > 0 && (
          <Section title="Ghost">
            <ArmorLine item={bySlot["Ghost"]} />
          </Section>
        )}
      </Card>
    </div>
  );
}

// ============================================================
// Loadout sub-components used by the modal
// ============================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 pt-4 border-t border-border">
      <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted mb-3">{title}</div>
      {children}
    </div>
  );
}

function EmptySlotLine({ slot }: { slot: string }) {
  return (
    <div className="flex items-baseline gap-3 text-muted/60 italic text-sm font-ui">
      <span className="font-mono text-[10px] tracking-[0.25em] uppercase w-20 shrink-0">{slot}</span>
      <span>empty</span>
    </div>
  );
}

function PlugChip({ p, className = "" }: { p: ResolvedPlug; className?: string }) {
  return (
    <span
      className={`font-ui text-[11px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${
        className || (p.isExotic ? "border-amber-300/70 text-amber-200" : "border-border text-muted-foreground")
      }`}
      title={`${p.name}${p.type ? ` (${p.type})` : ""}`}
    >
      {p.icon && <img src={p.icon} alt="" className="w-3.5 h-3.5 rounded-sm" />}
      <span>{p.name}</span>
    </span>
  );
}

function WeaponLine({ item }: { item: any }) {
  const b: LoadoutBuckets = item.buckets;
  const stats = (item.item_stats ?? {}) as Record<string, number>;
  // Render the 4 key shooter stats if available
  const keyStatKeys = ["1240592695", "155624089", "4188031367", "943549884", "1345609583"];
  const keyStats = keyStatKeys
    .map((k) => ({ k, label: WEAPON_STAT_LABELS[k], v: stats[k] }))
    .filter((s) => s.label && s.v !== undefined);

  return (
    <div className="font-ui text-sm">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-20 shrink-0">
          {item.slot}
        </span>
        <span className={`font-medium ${item.isExotic ? "text-amber-300" : ""}`}>{item.name}</span>
        {item.element && (
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted">{item.element}</span>
        )}
        {item.power > 0 && (
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted ml-auto">pw {item.power}</span>
        )}
      </div>
      {/* Perk roll — columns side-by-side */}
      <div className="ml-[5rem] mt-2 flex flex-wrap gap-1.5">
        {b.intrinsic.map((p) => <PlugChip key={p.hash} p={p} className="border-fuchsia-400/60 text-fuchsia-300" />)}
        {b.barrel.map((p) => <PlugChip key={p.hash} p={p} />)}
        {b.magazine.map((p) => <PlugChip key={p.hash} p={p} />)}
        {b.traits.map((p) => <PlugChip key={p.hash} p={p} className="border-saber/60 text-saber" />)}
        {b.masterwork.map((p) => <PlugChip key={p.hash} p={p} className="border-yellow-400/50 text-yellow-300" />)}
        {b.weaponMod.map((p) => <PlugChip key={p.hash} p={p} className="border-emerald-400/50 text-emerald-300" />)}
      </div>
      {/* Compact stat sheet */}
      {keyStats.length > 0 && (
        <div className="ml-[5rem] mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted">
          {keyStats.map((s) => (
            <span key={s.k}>
              <span className="tracking-[0.2em] uppercase">{s.label}</span>{" "}
              <span className="text-foreground">{s.v}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ArmorLine({ item }: { item: any }) {
  return (
    <div className="font-ui text-sm">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-20 shrink-0">
          {item.slot}
        </span>
        <span className={`font-medium ${item.isExotic ? "text-amber-300" : ""}`}>{item.name}</span>
        {item.set && (
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded border border-saber/40 text-saber/80">
            {item.set}
          </span>
        )}
        {item.power > 0 && (
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted ml-auto">pw {item.power}</span>
        )}
      </div>
      {item.mods && item.mods.length > 0 && (
        <div className="ml-[5rem] mt-1.5 flex flex-wrap gap-1.5">
          {item.mods.map((m: any, i: number) => {
            const cat = classifyMod(m.name);
            const cls = cat ? RESIST_COLOR[cat] : "border-border text-muted/80";
            return (
              <span
                key={`${m.hash}-${i}`}
                className={`font-ui text-[10px] px-1.5 py-0.5 rounded border ${cls}`}
                title={m.type}
              >
                {m.name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SubclassLine({ item }: { item: any }) {
  const b: LoadoutBuckets = item.buckets;
  return (
    <div className="font-ui text-sm space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-20 shrink-0">
          Subclass
        </span>
        <span className="font-medium text-amber-300">{item.name}</span>
      </div>
      {b.super.length > 0 && (
        <RowLabel label="Super">
          {b.super.map((p) => <PlugChip key={p.hash} p={p} className="border-amber-300/60 text-amber-200" />)}
        </RowLabel>
      )}
      {b.abilities.length > 0 && (
        <RowLabel label="Abilities">
          {b.abilities.map((p) => <PlugChip key={p.hash} p={p} />)}
        </RowLabel>
      )}
      {b.aspects.length > 0 && (
        <RowLabel label="Aspects">
          {b.aspects.map((p) => <PlugChip key={p.hash} p={p} className="border-saber/60 text-saber" />)}
        </RowLabel>
      )}
      {b.fragments.length > 0 && (
        <RowLabel label="Fragments">
          {b.fragments.map((p) => <PlugChip key={p.hash} p={p} className="border-emerald-400/40 text-emerald-300" />)}
        </RowLabel>
      )}
    </div>
  );
}

function RowLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-20 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
