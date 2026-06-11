import { useEffect, useMemo, useState } from "react";
import { search } from "@/lib/search";
import { api } from "@/lib/api";
import { loadLibrary, saveLibrary, readLocalLibrary, type Library } from "@/lib/library";
import { Card } from "@/components/ui/card";

/**
 * /armor — browse the armor database (armor.json). Two views:
 *   • Sets — the 56 named armor sets with their 2pc/4pc SET-BONUS perks (themes).
 *   • Pieces — individual armor, DIM-style search + inventory↔potential toggle.
 *
 * Data: armor.json (Bungie manifest + DIM season enums). Set bonuses resolved
 * from DestinyEquipableItemSetDefinition + DestinySandboxPerkDefinition. /credits.
 * Archetype is instance-level (Armor 3.0) — read from owned gear in the Optimizer.
 */

const CDN = "https://www.bungie.net";
const EL_COLOR: Record<string, string> = {
  Arc: "text-cyan-300", Solar: "text-orange-400", Void: "text-violet-400",
  Stasis: "text-sky-300", Strand: "text-green-400", Kinetic: "text-zinc-300",
};
const CLASSES = ["All", "Titan", "Hunter", "Warlock"] as const;
type ClassSel = (typeof CLASSES)[number];

interface SetPerk { count: number; n: string; d: string }
interface ArmorSet { n: string; perks: SetPerk[] }
interface ArmorPiece {
  hash: string; n: string; slot: string; cls: string; r: string; el: string;
  set: number | null; season: number | null; source: string; icon: string; exotic: boolean;
}
interface ArmorData { sets: Record<string, ArmorSet>; items: Record<string, Omit<ArmorPiece, "hash">> }

const CHIPS: Array<{ label: string; token: string }> = [
  { label: "Exotic", token: "is:exotic" }, { label: "In a set", token: "is:set" },
  { label: "Helmet", token: "slot:helmet" }, { label: "Arms", token: "slot:gauntlets" },
  { label: "Chest", token: "slot:chest" }, { label: "Legs", token: "slot:legs" }, { label: "Class", token: "slot:class" },
  { label: "Arc", token: "arc" }, { label: "Solar", token: "solar" }, { label: "Void", token: "void" },
  { label: "Stasis", token: "stasis" }, { label: "Strand", token: "strand" },
];
const RESULT_CAP = 90;

export default function Armor() {
  const [sets, setSets] = useState<Record<string, ArmorSet>>({});
  const [pieces, setPieces] = useState<ArmorPiece[]>([]);
  const [view, setView] = useState<"sets" | "pieces">("sets");
  const [cls, setCls] = useState<ClassSel>("All");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"potential" | "inventory" | "both">("potential");
  const [owned, setOwned] = useState<Set<number> | null>(null);
  const [invNote, setInvNote] = useState<string | null>(null);
  const [lib, setLib] = useState<Library>(readLocalLibrary);
  const wishlist = useMemo(() => new Set(lib.armorWishlist), [lib.armorWishlist]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/armor.json").then((r) => r.json()).then((d: ArmorData) => {
      setSets(d.sets);
      setPieces(Object.entries(d.items).map(([hash, v]) => ({ hash, ...v }) as ArmorPiece));
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadLibrary().then(setLib); }, []);

  useEffect(() => {
    if (mode === "potential" || owned !== null) return;
    api.inventoryDecorated()
      .then((items) => setOwned(new Set(items.filter((i) => i.hash).map((i) => i.hash))))
      .catch(() => { setInvNote("Sign in (Link your Bungie account) to compare with your inventory."); setMode("potential"); });
  }, [mode, owned]);

  function toggleWish(hash: string) {
    setLib((prev) => {
      const set = new Set(prev.armorWishlist);
      set.has(hash) ? set.delete(hash) : set.add(hash);
      const next = { ...prev, armorWishlist: [...set] };
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

  const classOf = cls === "All" ? null : cls;

  // Sets view — sets with ≥1 member piece in the selected class.
  const setEntries = useMemo(() => {
    const bySet = new Map<number, ArmorPiece[]>();
    for (const p of pieces) {
      if (p.set == null) continue;
      if (classOf && p.cls !== classOf && p.cls !== "Any") continue;
      (bySet.get(p.set) ?? bySet.set(p.set, []).get(p.set)!).push(p);
    }
    const q = query.toLowerCase();
    return Object.entries(sets)
      .map(([sh, set]) => ({ sh, set, members: bySet.get(Number(sh)) ?? [] }))
      .filter((e) => e.members.length > 0 && (!q || e.set.n.toLowerCase().includes(q)));
  }, [sets, pieces, classOf, query]);

  // Pieces view — class filter → DIM search → inventory mode.
  const pieceResults = useMemo(() => {
    let r = pieces;
    if (classOf) r = r.filter((p) => p.cls === classOf || p.cls === "Any");
    r = search(query, r);
    if (mode === "inventory" && owned) r = r.filter((p) => owned.has(Number(p.hash)));
    return r;
  }, [pieces, classOf, query, mode, owned]);

  const ownedSet = owned ?? new Set<number>();

  if (loading) return <div className="container py-20 font-ui text-muted">Loading the vault…</div>;

  return (
    <section className="container py-8 flex flex-col gap-5 max-w-7xl">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">▲ Armor Database</span>
        <h1 className="font-display text-3xl tracking-[0.16em] font-black text-signature">ARMOR</h1>
        <p className="font-ui text-sm text-muted-foreground max-w-3xl">
          {pieces.length.toLocaleString()} pieces · {Object.keys(sets).length} sets with{" "}
          <span className="text-saber">2pc / 4pc set bonuses</span>. Archetype + stat rolls live on your owned gear.
        </p>
      </header>

      {/* Controls */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em]">
            {(["sets", "pieces"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-2 rounded border transition-colors ${view === v ? "text-saber border-saber" : "border-border text-muted hover:text-foreground"}`}>
                {v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em]">
            {CLASSES.map((c) => (
              <button key={c} onClick={() => setCls(c)}
                className={`px-2.5 py-2 rounded border transition-colors ${cls === c ? "text-star border-star" : "border-border text-muted hover:text-foreground"}`}>
                {c}
              </button>
            ))}
          </div>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={view === "sets" ? "Search sets…" : "Search armor — “exotic chest”, “titan legs”…"}
            className="flex-1 min-w-[200px] bg-void/40 border border-border rounded px-3 py-2 font-ui text-sm focus:border-saber outline-none"
          />
          {view === "pieces" && (
            <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em]">
              {(["potential", "both", "inventory"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-2 rounded border transition-colors ${mode === m ? "text-saber border-saber" : "border-border text-muted hover:text-foreground"}`}>
                  {m === "potential" ? "All" : m === "both" ? "Mark owned" : "Owned only"}
                </button>
              ))}
            </div>
          )}
        </div>
        {invNote && view === "pieces" && <p className="font-ui text-[11px] text-amber-400">{invNote}</p>}
        {view === "pieces" && (
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((c) => {
              const on = query.split(/\s+/).includes(c.token);
              return (
                <button key={c.token} onClick={() => toggleChip(c.token)}
                  className={`px-2.5 py-1 rounded-full border text-[11px] font-ui transition-colors ${on ? "text-saber border-saber bg-saber/5" : "border-border text-muted hover:text-foreground"}`}>
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
        <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted">
          {view === "sets"
            ? `${setEntries.length} set${setEntries.length === 1 ? "" : "s"}`
            : `${pieceResults.length.toLocaleString()} piece${pieceResults.length === 1 ? "" : "s"}${pieceResults.length > RESULT_CAP ? ` · showing ${RESULT_CAP}` : ""} · ${wishlist.size} wishlisted`}
        </div>
      </Card>

      {/* Sets view */}
      {view === "sets" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {setEntries.map(({ sh, set, members }) => (
            <Card key={sh} className="p-4">
              <h3 className="font-display text-lg text-star">{set.n}</h3>
              <div className="mt-2 space-y-2">
                {set.perks.filter((p) => p.n).map((p) => (
                  <div key={p.count} className="text-xs">
                    <span className="font-mono text-[10px] text-saber tracking-wider">{p.count}-PIECE · </span>
                    <span className="text-foreground">{p.n}</span>
                    {p.d && <p className="text-muted text-[11px] leading-tight mt-0.5">{p.d}</p>}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {members.slice(0, 15).map((m) => (
                  <img key={m.hash} src={CDN + m.icon} title={`${m.n} · ${m.cls} ${m.slot}`}
                    alt="" className="w-8 h-8 rounded border border-void" />
                ))}
              </div>
            </Card>
          ))}
          {setEntries.length === 0 && <p className="text-muted font-ui text-sm py-8">No sets match.</p>}
        </div>
      )}

      {/* Pieces view */}
      {view === "pieces" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {pieceResults.slice(0, RESULT_CAP).map((p) => {
            const owned = ownedSet.has(Number(p.hash));
            return (
              <Card key={p.hash} className={`p-3 ${owned && mode === "both" ? "border-saber/50" : "border-border"}`}>
                <div className="flex items-start gap-2.5">
                  {p.icon && <img src={CDN + p.icon} alt="" className="w-11 h-11 rounded border border-void shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className={`truncate font-display ${p.exotic ? "text-amber-300" : "text-star"}`}>{p.n}</span>
                      {owned && mode === "both" && <span className="text-[9px] font-mono uppercase text-saber">owned</span>}
                      <button onClick={() => toggleWish(p.hash)}
                        className={`ml-auto text-sm ${wishlist.has(p.hash) ? "text-amber-300" : "text-muted hover:text-amber-300"}`} title="Wishlist">★</button>
                    </div>
                    <div className="font-mono text-[10px] text-muted flex flex-wrap gap-x-2">
                      <span>{p.slot}</span><span>{p.cls}</span>
                      {p.el && <span className={EL_COLOR[p.el]}>{p.el}</span>}
                      {p.set != null && sets[p.set] && <span className="text-saber/80">· {sets[p.set].n}</span>}
                      {p.season != null && <span>· S{p.season}</span>}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
          {pieceResults.length === 0 && <p className="text-muted font-ui text-sm py-8">No armor matches that query.</p>}
        </div>
      )}
    </section>
  );
}
