import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, STAT_LABEL, type ArmorStats, type Item, type UserProfile } from "@/lib/api";
import {
  loadBuilds, fitBuild, buildsForClass,
  type BuildTemplate, type BuildFit, type FitSlotStatus,
} from "@/lib/builds";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const CLASS_COLOR: Record<string, string> = {
  hunter: "text-hunter",
  titan:  "text-titan",
  warlock:"text-warlock",
};

export default function Builds() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});  // weapon hash → your lifetime kills
  const [builds, setBuilds] = useState<BuildTemplate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const [focusFilter, setFocusFilter] = useState<"All" | "PvE" | "PvP">("All");
  const [openId, setOpenId] = useState<string | null>(null);
  const [equipMsg, setEquipMsg] = useState<string | null>(null);
  const [equipping, setEquipping] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const manifest = await loadBuilds();
        setBuilds(manifest.builds);
      } catch (e: any) {
        setErr(`Build library failed to load: ${e?.message ?? e}`);
      }
      try {
        const [profile, decorated] = await Promise.all([
          api.me(),
          api.inventoryDecorated(),
        ]);
        setMe(profile);
        setItems(decorated);
        if (!classFilter && profile.primary_class) {
          setClassFilter(profile.primary_class);
        }
        api.getUsage().then((u) => setUsage(u?.weapons ?? {})).catch(() => { /* usage optional */ });
      } catch {
        // Not signed in — builds still browseable, just no fit %
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // Filtering + fit
  // ============================================================
  const filtered = useMemo(() => {
    if (!builds) return [];
    let list = buildsForClass(builds, classFilter);
    if (focusFilter !== "All") {
      list = list.filter((b) => b.focus === focusFilter || b.focus === "Both");
    }
    return list;
  }, [builds, classFilter, focusFilter]);

  const fits = useMemo(() => {
    const map: Record<string, BuildFit> = {};
    if (!items.length) return map;
    for (const b of filtered) map[b.id] = fitBuild(b, items);
    return map;
  }, [filtered, items]);

  // Rank: prefer builds you can equip (fit %) AND whose weapons you actually run
  // (your lifetime usage of the build's owned weapons). Score = fit + usage, 0..1 each.
  const usageOf = (b: BuildTemplate) => {
    const f = fits[b.id];
    if (!f) return 0;
    let s = 0;
    for (const slot of [f.kinetic, f.energy, f.heavy]) {
      if (slot.status === "owned") s += usage[String(slot.item.hash)] || 0;
    }
    return s;
  };
  const ranked = useMemo(() => {
    if (!items.length) return filtered;   // anonymous → original order
    const maxU = Math.max(1, ...filtered.map(usageOf));
    return [...filtered].sort((a, b) =>
      ((fits[b.id]?.fitPct ?? 0) + usageOf(b) / maxU) - ((fits[a.id]?.fitPct ?? 0) + usageOf(a) / maxU),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, fits, usage, items]);

  // Equip everything the user owns from this build (exotic armor + weapons)
  // onto the matching guardian. Missing pieces are reported, not blocking.
  async function equipBuildPieces(b: BuildTemplate) {
    const fit = fits[b.id];
    if (!fit || !me || equipping) return;
    setEquipping(true);
    setEquipMsg("Equipping owned pieces…");
    try {
      const char = b.class === "Any"
        ? (me.characters || [])[0]
        : (me.characters || []).find((c) => c.class === b.class.toLowerCase());
      if (!char) { setEquipMsg(`No ${b.class} guardian found on your account.`); return; }
      const slots: [string, FitSlotStatus][] = [
        ["Exotic", fit.exoticArmor], ["Kinetic", fit.kinetic], ["Energy", fit.energy], ["Heavy", fit.heavy],
      ];
      const ids: string[] = [];
      const missing: string[] = [];
      for (const [label, s] of slots) {
        if (s.status === "owned") ids.push(s.item.instance_id);
        else if (s.status === "missing") missing.push(`${label}: ${s.wantedOptions[0]}`);
      }
      if (!ids.length) { setEquipMsg("You don't own any of this build's pieces yet."); return; }
      const res = await api.equip(char.id, ids);
      setEquipMsg(
        `✓ Equipped ${res.equipped_count ?? ids.length} to your ${char.class}` +
        (missing.length ? ` · missing: ${missing.join(", ")}` : "."),
      );
    } catch {
      setEquipMsg("Equip failed — items equipped on another guardian must be unequipped first.");
    } finally {
      setEquipping(false);
    }
  }

  // ============================================================
  // Render
  // ============================================================
  return (
    <section className="container py-10 flex flex-col gap-6 max-w-6xl">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">
          ▲ Loadout Templates
        </span>
        <h1 className="font-display text-3xl tracking-[0.18em] font-black text-signature">
          BUILDS
        </h1>
        <p className="font-ui text-sm text-muted-foreground max-w-2xl">
          Curated build presets. Fit shows which pieces you already have and what's missing.
          Missing items don't block the build — they're called out with where to get them.{" "}
          {!me && (
            <Link to="/" className="text-saber underline">
              Sign in with Bungie
            </Link>
          )}{" "}
          {!me && "to see your personal fit %."}
        </p>
      </header>

      {err && <div className="text-red-400 text-xs font-ui">⚠ {err}</div>}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
        <span className="text-muted">Class:</span>
        {(["hunter", "titan", "warlock"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setClassFilter(classFilter === c ? null : c)}
            className={`px-3 py-1 rounded border transition-colors ${
              classFilter === c
                ? `${CLASS_COLOR[c]} border-current`
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {c}
          </button>
        ))}
        <span className="text-muted ml-3">Focus:</span>
        {(["All", "PvE", "PvP"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFocusFilter(f)}
            className={`px-3 py-1 rounded border transition-colors ${
              focusFilter === f
                ? "text-signature border-current"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ranked.map((b) => {
          const fit = fits[b.id];
          const open = openId === b.id;
          // your most-used weapon that this build calls for (drives the ranking)
          let topW = ""; let topK = 0;
          if (fit) for (const s of [fit.kinetic, fit.energy, fit.heavy]) {
            if (s.status === "owned") { const k = usage[String(s.item.hash)] || 0; if (k > topK) { topK = k; topW = s.item.name; } }
          }
          return (
            <Card
              key={b.id}
              className={`p-4 cursor-pointer transition-colors ${open ? "border-saber/60" : ""}`}
              onClick={() => { setOpenId(open ? null : b.id); setEquipMsg(null); }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.3em] uppercase text-muted mb-1">
                    <span className={CLASS_COLOR[b.class.toLowerCase()] ?? ""}>{b.class}</span>
                    <span>·</span>
                    <span>{b.subclass}</span>
                    <span>·</span>
                    <span>{b.focus}</span>
                  </div>
                  <h3 className="font-display text-lg font-bold tracking-wide truncate">
                    {b.name}
                  </h3>
                  {b.playstyle && !open && (
                    <p className="font-ui text-xs text-muted mt-2 line-clamp-2">{b.playstyle}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <FitBadge fit={fit} loaded={!!me} />
                  {topK > 0 && (
                    <span className="font-mono text-[9px] tracking-wide text-amber-300/80" title={`${topK.toLocaleString()} lifetime kills — ranks this build up`}>
                      ★ {topW}
                    </span>
                  )}
                </div>
              </div>

              {open && (
                <div className="mt-4 pt-4 border-t border-border space-y-4 font-ui text-sm">
                  {b.playstyle && (
                    <p className="text-muted-foreground italic">{b.playstyle}</p>
                  )}
                  <SlotRow label="Exotic Armor" status={fit?.exoticArmor} loaded={!!me} />
                  <SlotRow label="Kinetic" status={fit?.kinetic} loaded={!!me} />
                  <SlotRow label="Energy" status={fit?.energy} loaded={!!me} />
                  <SlotRow label="Heavy" status={fit?.heavy} loaded={!!me} />
                  {b.aspects && b.aspects.length > 0 && (
                    <Listing label="Aspects" items={b.aspects} />
                  )}
                  {b.fragments && b.fragments.length > 0 && (
                    <Listing label="Fragments" items={b.fragments} />
                  )}
                  {b.target_stats && (
                    <TargetStats stats={b.target_stats} />
                  )}
                  {me && fit && (
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        disabled={equipping}
                        onClick={(e) => { e.stopPropagation(); equipBuildPieces(b); }}
                      >
                        {equipping ? "Equipping…" : "Equip build (owned pieces)"}
                      </Button>
                      {equipMsg && <div className="font-ui text-xs text-muted">{equipMsg}</div>}
                    </div>
                  )}
                  {b.source && (
                    <div className="font-mono text-[9px] tracking-[0.25em] uppercase text-muted">
                      Source: {b.source}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
        {filtered.length === 0 && builds && (
          <div className="text-muted text-sm font-ui col-span-full text-center py-12">
            No builds match these filters.
          </div>
        )}
        {!builds && !err && (
          <div className="text-muted text-sm font-ui col-span-full text-center py-12">
            Loading templates…
          </div>
        )}
      </div>

      {!me && (
        <Card className="p-6 mt-2 border-saber/30">
          <h3 className="font-display text-lg font-bold tracking-wide text-saber mb-2">
            Sign in to see personal fit
          </h3>
          <p className="font-ui text-sm text-muted-foreground mb-4">
            Link your Bungie account to see which build pieces you already have and which ones to chase.
          </p>
          <Button onClick={async () => { const { url } = await api.authUrl(); location.href = url; }}>
            Sign in with Bungie
          </Button>
        </Card>
      )}
    </section>
  );
}

// ============================================================
// Sub-components
// ============================================================

function FitBadge({ fit, loaded }: { fit?: BuildFit; loaded: boolean }) {
  if (!loaded) {
    return (
      <span className="font-mono text-[9px] tracking-[0.25em] uppercase text-muted shrink-0">
        sign in for fit
      </span>
    );
  }
  if (!fit) return null;
  const pct = Math.round(fit.fitPct * 100);
  const color =
    pct === 100 ? "text-emerald-400 border-emerald-400/60"
    : pct >= 50 ? "text-amber-400 border-amber-400/60"
    : "text-saber border-saber/60";
  return (
    <span className={`font-mono text-[10px] tracking-[0.25em] uppercase px-2 py-1 rounded border shrink-0 ${color}`}>
      {fit.ownedSlots}/{fit.totalSlots} · {pct}%
    </span>
  );
}

function SlotRow({
  label, status, loaded,
}: { label: string; status?: FitSlotStatus; loaded: boolean }) {
  if (!status) {
    return (
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-28 shrink-0">
          {label}
        </span>
        <span className="text-muted text-xs italic">
          {loaded ? "—" : "sign in to check"}
        </span>
      </div>
    );
  }
  if (status.status === "owned") {
    return (
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-28 shrink-0">
          {label}
        </span>
        <span className="text-emerald-400">✓</span>
        <span className="font-medium">{status.item.name}</span>
        {status.item.power > 0 && (
          <span className="text-muted text-xs">pw {status.item.power}</span>
        )}
      </div>
    );
  }
  if (status.status === "flexible") {
    return (
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-28 shrink-0">
          {label}
        </span>
        <span className="text-muted text-xs italic">any — flexible</span>
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-28 shrink-0">
        {label}
      </span>
      <span className="text-saber">need:</span>
      <div className="flex-1 min-w-0">
        <div className="text-muted-foreground">{status.wantedOptions.join(" / ")}</div>
        {status.hint && (
          <div className="text-xs text-muted mt-0.5">
            {status.hint}
          </div>
        )}
      </div>
    </div>
  );
}

function Listing({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-28 shrink-0">
        {label}
      </span>
      <span className="text-muted-foreground">{items.join(" · ")}</span>
    </div>
  );
}

function TargetStats({ stats }: { stats: Partial<ArmorStats> }) {
  const entries = Object.entries(stats).filter(([, v]) => (v ?? 0) > 0);
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-28 shrink-0">
        Target stats
      </span>
      <div className="flex flex-wrap gap-2">
        {entries.map(([k, v]) => (
          <span
            key={k}
            className="font-mono text-[10px] tracking-[0.2em] uppercase px-2 py-0.5 rounded border border-saber/40 text-saber"
          >
            {STAT_LABEL[k as keyof ArmorStats]} {v}+
          </span>
        ))}
      </div>
    </div>
  );
}
