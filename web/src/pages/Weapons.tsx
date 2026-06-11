import { useEffect, useMemo, useState } from "react";
import { search } from "@/lib/search";
import { api } from "@/lib/api";
import { loadLibrary, saveLibrary, readLocalLibrary, type Library } from "@/lib/library";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * /weapons — browse the full weapon database (weapons.json), search with the
 * DIM-style engine, see real perk pools with Clarity insights, compare against
 * your inventory (or browse anonymously), and build a wishlist.
 *
 * Data: weapons.json (Bungie manifest + DIM season enums) · perks.json (Clarity).
 * See /credits. The inventory↔potential toggle is the headline: anonymous browse
 * needs zero Bungie calls; signing in overlays what you own.
 */

const CDN = "https://www.bungie.net";
const EL_COLOR: Record<string, string> = {
  Arc: "text-cyan-300", Solar: "text-orange-400", Void: "text-violet-400",
  Stasis: "text-sky-300", Strand: "text-green-400", Kinetic: "text-zinc-300",
};

interface Perk { h: number; n: string; c: boolean }
interface Weapon {
  hash: string; n: string; t: string; r: string; ammo: string; el: string;
  frame: string; random: boolean; craftable: boolean; season: number | null;
  source: string; icon: string; watermark: string; stats: Record<string, number>;
  columns: Perk[][]; exotic: boolean;
}
type PerkDB = Record<string, { n: string; t: string; d: string }>;

const CHIPS: Array<{ label: string; token: string }> = [
  { label: "Exotic", token: "is:exotic" }, { label: "Craftable", token: "is:craftable" },
  { label: "Hand Cannon", token: "hand cannon" }, { label: "Pulse", token: "pulse" },
  { label: "Scout", token: "scout" }, { label: "Auto", token: "auto" },
  { label: "Sniper", token: "sniper" }, { label: "Shotgun", token: "shotgun" },
  { label: "Sword", token: "sword" }, { label: "Rocket", token: "rocket" },
  { label: "Arc", token: "arc" }, { label: "Solar", token: "solar" }, { label: "Void", token: "void" },
  { label: "Stasis", token: "stasis" }, { label: "Strand", token: "strand" }, { label: "Kinetic", token: "kinetic" },
];

const RESULT_CAP = 90;

export default function Weapons() {
  const [weapons, setWeapons] = useState<Weapon[]>([]);
  const [perks, setPerks] = useState<PerkDB>({});
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"potential" | "inventory" | "both">("potential");
  const [owned, setOwned] = useState<Set<number> | null>(null);
  const [invNote, setInvNote] = useState<string | null>(null);
  const [lib, setLib] = useState<Library>(readLocalLibrary);
  const wishlist = useMemo(() => new Set(lib.weaponWishlist), [lib.weaponWishlist]);
  const [selected, setSelected] = useState<Weapon | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/weapons.json").then((r) => r.json()),
      fetch("/perks.json").then((r) => r.json()).catch(() => ({})),
    ])
      .then(([w, p]) => {
        setWeapons(Object.entries(w).map(([hash, v]) => ({ hash, ...(v as object) }) as Weapon));
        setPerks(p);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadLibrary().then(setLib); }, []);

  // Fetch inventory the first time the user switches to a compare mode.
  useEffect(() => {
    if (mode === "potential" || owned !== null) return;
    api.inventoryDecorated()
      .then((items) => setOwned(new Set(items.filter((i) => i.hash).map((i) => i.hash))))
      .catch(() => { setInvNote("Sign in (Link your Bungie account) to compare with your inventory."); setMode("potential"); });
  }, [mode, owned]);

  function toggleWish(hash: string) {
    setLib((prev) => {
      const set = new Set(prev.weaponWishlist);
      set.has(hash) ? set.delete(hash) : set.add(hash);
      const next = { ...prev, weaponWishlist: [...set] };
      saveLibrary(next);
      return next;
    });
  }
  function toggleChip(token: string) {
    setQuery((q) => {
      const parts = q.split(/\s+/).filter(Boolean);
      const i = parts.indexOf(token);
      if (i >= 0) parts.splice(i, 1); else parts.push(token);
      return parts.join(" ");
    });
  }

  const results = useMemo(() => {
    let r = search(query, weapons);
    if (mode === "inventory" && owned) r = r.filter((w) => owned.has(Number(w.hash)));
    return r;
  }, [query, weapons, mode, owned]);

  const ownedSet = owned ?? new Set<number>();
  const isOwned = (w: Weapon) => ownedSet.has(Number(w.hash));

  if (loading) return <div className="container py-20 font-ui text-muted">Loading the armory…</div>;

  return (
    <section className="container py-8 flex flex-col gap-5 max-w-7xl">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">▲ Weapon Database</span>
        <h1 className="font-display text-3xl tracking-[0.16em] font-black text-signature">WEAPONS</h1>
        <p className="font-ui text-sm text-muted-foreground max-w-3xl">
          {weapons.length.toLocaleString()} weapons · real perk pools + <span className="text-saber">Clarity</span> insights.
          Search like DIM (<code className="text-saber/80">is:exotic hand cannon</code>,{" "}
          <code className="text-saber/80">perk:rampage is:craftable</code>,{" "}
          <code className="text-saber/80">source:trials</code>).
        </p>
      </header>

      {/* Search + mode */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search weapons + perks…"
            className="flex-1 min-w-[260px] bg-void/40 border border-border rounded px-3 py-2 font-ui text-sm focus:border-saber outline-none"
          />
          <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em]">
            {(["potential", "both", "inventory"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-2 rounded border transition-colors ${
                  mode === m ? "text-saber border-saber" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {m === "potential" ? "All rolls" : m === "both" ? "Mark owned" : "Owned only"}
              </button>
            ))}
          </div>
        </div>
        {invNote && <p className="font-ui text-[11px] text-amber-400">{invNote}</p>}
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((c) => {
            const on = query.split(/\s+/).includes(c.token);
            return (
              <button
                key={c.token}
                onClick={() => toggleChip(c.token)}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-ui transition-colors ${
                  on ? "text-saber border-saber bg-saber/5" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.2em] uppercase text-muted">
          <span>{results.length.toLocaleString()} match{results.length === 1 ? "" : "es"}{results.length > RESULT_CAP ? ` · showing ${RESULT_CAP}` : ""}</span>
          <span>{wishlist.size} wishlisted</span>
        </div>
      </Card>

      {/* Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {results.slice(0, RESULT_CAP).map((w) => (
          <WeaponCard
            key={w.hash} w={w} perks={perks} owned={isOwned(w)} mark={mode === "both"}
            wished={wishlist.has(w.hash)} onWish={() => toggleWish(w.hash)} onOpen={() => setSelected(w)}
          />
        ))}
        {results.length === 0 && (
          <p className="text-muted font-ui text-sm py-8">No weapons match that query.</p>
        )}
      </div>

      {selected && <WeaponDetail w={selected} perks={perks} onClose={() => setSelected(null)} />}
    </section>
  );
}

function ammoColor(a: string) {
  return a === "Heavy" ? "text-purple-300" : a === "Special" ? "text-green-300" : "text-zinc-400";
}

function WeaponCard({
  w, perks, owned, mark, wished, onWish, onOpen,
}: {
  w: Weapon; perks: PerkDB; owned: boolean; mark: boolean;
  wished: boolean; onWish: () => void; onOpen: () => void;
}) {
  // For random-roll weapons, show the trait columns (last two perk columns are
  // usually the meaningful traits); show up to 4 columns.
  const cols = w.columns.slice(0, 4);
  return (
    <Card className={`p-3 ${owned && mark ? "border-saber/50" : "border-border"}`}>
      <div className="flex items-start gap-3">
        {w.icon && (
          <button onClick={onOpen} className="shrink-0">
            <img src={CDN + w.icon} alt="" className="w-12 h-12 rounded border border-void" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <button onClick={onOpen} className="text-left truncate">
              <span className={w.exotic ? "text-amber-300 font-display" : "text-star font-display"}>{w.n}</span>
            </button>
            {owned && mark && <span className="text-[9px] font-mono uppercase tracking-wider text-saber">owned</span>}
            <button onClick={onWish} className={`ml-auto text-sm ${wished ? "text-amber-300" : "text-muted hover:text-amber-300"}`} title="Wishlist">★</button>
          </div>
          <div className="font-mono text-[10px] tracking-wide text-muted flex flex-wrap gap-x-2">
            <span className={EL_COLOR[w.el] || "text-muted"}>{w.el}</span>
            <span>{w.t}</span>
            <span className={ammoColor(w.ammo)}>{w.ammo}</span>
            {w.frame && <span>· {w.frame}</span>}
            {w.craftable && <span className="text-emerald-400">· craftable</span>}
            {w.season != null && <span>· S{w.season}</span>}
          </div>
        </div>
      </div>
      {cols.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2">
          {cols.map((col, i) => (
            <div key={i} className="space-y-0.5">
              {col.slice(0, 4).map((p) => (
                <div
                  key={p.h}
                  title={perks[p.h]?.d || p.n}
                  className={`text-[11px] leading-tight truncate ${p.c ? "text-foreground" : "text-muted/50"}`}
                >
                  {p.n}
                </div>
              ))}
              {col.length > 4 && <div className="text-[10px] text-muted/60">+{col.length - 4}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function WeaponDetail({ w, perks, onClose }: { w: Weapon; perks: PerkDB; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <Card className="max-w-3xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          {w.icon && <img src={CDN + w.icon} alt="" className="w-16 h-16 rounded border border-void" />}
          <div className="flex-1">
            <h2 className={`font-display text-2xl ${w.exotic ? "text-amber-300" : "text-star"}`}>{w.n}</h2>
            <div className="font-mono text-[11px] text-muted flex flex-wrap gap-x-2 mt-1">
              <span className={EL_COLOR[w.el] || ""}>{w.el}</span><span>{w.t}</span>
              <span className={ammoColor(w.ammo)}>{w.ammo}</span>
              {w.frame && <span>· {w.frame}</span>}
              {w.craftable && <span className="text-emerald-400">· craftable</span>}
              {w.season != null && <span>· Season {w.season}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-star font-mono text-xs uppercase tracking-widest">close ✕</button>
        </div>
        {w.source && <p className="font-ui text-xs text-muted mb-4">{w.source}</p>}

        <div className="space-y-3">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-saber">
            {w.random ? "Perk pool (random rolls)" : "Perks"}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {w.columns.map((col, i) => (
              <div key={i} className="space-y-1">
                {col.map((p) => (
                  <div key={p.h} className="group">
                    <div className={`text-xs ${p.c ? "text-foreground" : "text-muted/50 italic"}`}>
                      {p.n}{!p.c && <span className="text-[9px] ml-1">(retired)</span>}
                    </div>
                    {perks[p.h]?.d && (
                      <div className="text-[10px] text-muted leading-tight hidden group-hover:block whitespace-pre-line">
                        {perks[p.h].d}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {Object.keys(w.stats).length > 0 && (
          <div className="mt-4">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-saber mb-2">Base stats</h3>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
              {Object.entries(w.stats).map(([k, v]) => (
                <div key={k} className="text-[11px] text-muted"><span className="text-foreground">{v}</span> {k}</div>
              ))}
            </div>
          </div>
        )}
        <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.2em] text-muted/60">
          Perk insights: Clarity (d2clarity.com) · data: Bungie manifest + DIM
        </p>
      </Card>
    </div>
  );
}
