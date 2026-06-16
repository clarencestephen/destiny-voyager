import { useEffect, useMemo, useState } from "react";
import { recommendBuild, buildCFIndex, type SynergyData, type WeaponLite, type ArmorData, type CFIndex } from "@/lib/recommend";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";

/**
 * /recommend — drive the build-coherence engine. Pick class · subclass · goal ·
 * (optional) weapon focus, and it assembles a coherent build: aspects, fragments,
 * weapons that roll synergistic perks, and the armor set whose bonus matches your
 * goal — each with a cited "why". Works anonymously (no Bungie calls).
 *
 * Engine: lib/recommend.ts over synergy.json + weapons.json + armor.json.
 */

const CDN = "https://www.bungie.net";
const CLASSES = ["Warlock", "Titan", "Hunter"] as const;
const ELEMENTS = ["solar", "void", "arc", "stasis", "strand", "prismatic"] as const;
const GOALS = ["boss damage", "melee", "grenade spam", "ability uptime", "survivability", "add clear", "faster reload"];
const WEAPON_FOCUS = ["", "auto rifle", "hand cannon", "pulse rifle", "scout rifle", "sidearm", "submachine gun",
  "bow", "fusion rifle", "shotgun", "sniper rifle", "trace rifle", "glaive", "grenade launcher",
  "linear fusion rifle", "machine gun", "rocket launcher", "sword"];
const EL_COLOR: Record<string, string> = {
  solar: "text-orange-400", void: "text-violet-400", arc: "text-cyan-300",
  stasis: "text-sky-300", strand: "text-green-400", prismatic: "text-fuchsia-300",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Recommend() {
  const [syn, setSyn] = useState<SynergyData | null>(null);
  const [weapons, setWeapons] = useState<WeaponLite[]>([]);
  const [armor, setArmor] = useState<ArmorData>({ sets: {} });
  const [cf, setCf] = useState<CFIndex>({});
  const [owned, setOwned] = useState<Set<string> | null>(null);  // null = anonymous (no ownership info)
  const [loading, setLoading] = useState(true);

  const [cls, setCls] = useState<(typeof CLASSES)[number]>("Warlock");
  const [element, setElement] = useState<(typeof ELEMENTS)[number]>("solar");
  const [goal, setGoal] = useState("boss damage");
  const [weaponType, setWeaponType] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/synergy.json").then((r) => r.json()),
      fetch("/weapons.json").then((r) => r.json()),
      fetch("/armor.json").then((r) => r.json()),
      fetch("/builds.json").then((r) => r.json()).catch(() => ({ builds: [] })),
    ]).then(([s, w, a, bl]) => {
      setSyn(s);
      setWeapons(Object.entries(w).map(([hash, v]) => ({ hash, ...(v as object) }) as WeaponLite));
      setArmor(a);
      setCf(buildCFIndex(bl.builds || []));
    }).finally(() => setLoading(false));
    // Ownership is optional — only when signed in. Anonymous users still get recs.
    api.inventoryDecorated()
      .then((items) => setOwned(new Set(items.filter((i) => i.name).map((i) => i.name.toLowerCase()))))
      .catch(() => setOwned(null));
  }, []);

  const rec = useMemo(() => {
    if (!syn) return null;
    return recommendBuild({ cls, element, goal, weaponType: weaponType || undefined }, syn, weapons, armor, cf);
  }, [syn, weapons, armor, cf, cls, element, goal, weaponType]);

  if (loading) return <div className="container py-20 font-ui text-muted">Loading the synergy graph…</div>;

  return (
    <section className="container py-8 flex flex-col gap-5 max-w-6xl">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">▲ Build Recommender</span>
        <h1 className="font-display text-3xl tracking-[0.16em] font-black text-signature">RECOMMEND</h1>
        <p className="font-ui text-sm text-muted-foreground max-w-3xl">
          A coherent build, assembled so every piece reinforces one theme. Pick a class, subclass, and goal —
          weapons, fragments, aspects, and the armor set all chosen to chain together. Every pick is explained.
        </p>
      </header>

      <Card className="p-4 flex flex-wrap items-end gap-4">
        <Field label="Class">
          <select value={cls} onChange={(e) => setCls(e.target.value as any)} className="dv-sel">
            {CLASSES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Subclass">
          <select value={element} onChange={(e) => setElement(e.target.value as any)} className="dv-sel">
            {ELEMENTS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
        </Field>
        <Field label="Weapon focus">
          <select value={weaponType} onChange={(e) => setWeaponType(e.target.value)} className="dv-sel">
            {WEAPON_FOCUS.map((c) => <option key={c} value={c}>{c ? cap(c) : "Any"}</option>)}
          </select>
        </Field>
        <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">Goal</span>
          <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. boss damage"
            className="bg-void/40 border border-border rounded px-3 py-2 font-ui text-sm focus:border-saber outline-none" />
          <div className="flex flex-wrap gap-1 mt-1">
            {GOALS.map((g) => (
              <button key={g} onClick={() => setGoal(g)}
                className={`px-2 py-0.5 rounded-full border text-[10px] font-ui transition-colors ${goal === g ? "text-saber border-saber bg-saber/5" : "border-border text-muted hover:text-foreground"}`}>
                {g}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {rec && (
        <>
          <div className="font-mono text-[11px] tracking-wide text-muted">
            theme: <span className={EL_COLOR[element]}>{rec.theme.join(" · ") || "—"}</span>
            {rec.goalKeywords.length > 0 && <> · goal: <span className="text-saber">{rec.goalKeywords.join(", ")}</span></>}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Aspects">
              {rec.aspects.map((p) => <Row key={p.item.hash} name={p.item.n} why={p.why} />)}
              {rec.aspects.length === 0 && <Empty />}
            </Section>
            <Section title="Fragments">
              {rec.fragments.map((p) => <Row key={p.item.hash} name={p.item.n} why={p.why} />)}
              {rec.fragments.length === 0 && <Empty />}
            </Section>
          </div>

          <Section title={`Weapons — one per slot, ≤1 Exotic${weaponType ? ` · ${cap(weaponType)} focus` : ""}`}>
            {(["kinetic", "energy", "heavy"] as const).map((slot) => {
              const picks = rec.weaponLoadout[slot];
              return (
                <div key={slot} className="mb-2.5">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted mb-1">
                    {slot === "heavy" ? "Power" : cap(slot)}
                  </div>
                  {picks.length === 0 ? (
                    <span className="text-muted text-xs italic px-1">no strong match — run anything</span>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {picks.map((p, idx) => {
                        const own = owned?.has(p.item.n.toLowerCase());
                        const src = ((p.item as any).source || "").replace(/^Source:\s*/i, "").trim();
                        return (
                          <div key={p.item.hash} className={`flex items-center gap-2 px-2 py-1.5 rounded border ${idx === 0 ? "border-saber/50 bg-saber/[0.03]" : "border-border"}`}>
                            {(p.item as any).icon && <img src={CDN + (p.item as any).icon} alt="" className="w-8 h-8 rounded border border-void shrink-0" />}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className={`truncate font-ui text-sm ${p.item.exotic ? "text-amber-300" : "text-star"}`}>{p.item.n}</span>
                                {p.item.exotic && <span className="text-[8px] font-mono uppercase text-amber-400 border border-amber-400/40 rounded px-1 shrink-0">exo</span>}
                                {owned !== null && (own
                                  ? <span className="text-emerald-400 text-xs shrink-0" title="in your vault">✓</span>
                                  : <span className="text-amber-400/70 text-[9px] font-mono uppercase shrink-0">need</span>)}
                              </div>
                              <div className="font-mono text-[10px] text-muted truncate">
                                <span className={EL_COLOR[p.item.el.toLowerCase()] || ""}>{p.item.el}</span> {p.item.t} · {p.why}
                                {owned !== null && !own && src && <span className="text-muted/70"> · {src}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <p className="font-ui text-[11px] text-muted mt-1">
              The highlighted lead pick in each slot is the recommendation; only one Exotic can be equipped, so at most one slot leads with an Exotic.
              {owned !== null ? " ✓ = in your vault; “need” shows where it drops." : " Sign in to see which you own + where the rest drop."}
            </p>
          </Section>

          {rec.exotics.length > 0 && (
            <Section title="Exotic armor (popular in builds)">
              <div className="flex flex-wrap gap-2">
                {rec.exotics.map((p) => (
                  <div key={p.item.n} className="px-3 py-1.5 rounded border border-amber-500/40 font-ui text-sm text-amber-300">
                    {p.item.n} <span className="font-mono text-[10px] text-muted">· {p.why}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {rec.artifact.picks.length > 0 && (
            <Section title={`Artifact mods${rec.artifact.name ? ` · ${rec.artifact.name}` : ""}`}>
              <div className="flex flex-wrap gap-2">
                {rec.artifact.picks.map((p) => (
                  <div key={p.item.n} className="px-3 py-1.5 rounded border border-border font-ui text-sm">
                    <span className="text-star">{p.item.n}</span> <span className="font-mono text-[10px] text-muted">· {p.why}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Armor set (matched to your goal)">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {rec.sets.map((p) => (
                <Card key={p.item.hash} className="p-3">
                  <div className="font-display text-star">{p.item.n}</div>
                  <div className="font-mono text-[10px] text-saber mt-0.5">{p.why}</div>
                  <div className="mt-1 space-y-0.5">
                    {p.item.perks.filter((x: any) => x.n).map((x: any) => (
                      <div key={x.count} className="text-[11px] text-muted"><span className="text-foreground">{x.count}pc</span> {x.n}</div>
                    ))}
                  </div>
                </Card>
              ))}
              {rec.sets.length === 0 && <Empty />}
            </div>
          </Section>

          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted/60">
            Synergy graph from Bungie manifest + Clarity · statistical blend (usage / wishlists) layering in · /credits
          </p>
        </>
      )}
      <style>{`.dv-sel{background:rgba(10,10,18,.5);border:1px solid hsl(var(--border));border-radius:.375rem;padding:.45rem .6rem;font-size:.85rem}`}</style>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">{label}</span>{children}</label>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-saber">{title}</h2>
      {children}
    </div>
  );
}
function Row({ name, why }: { name: string; why: string }) {
  return (
    <Card className="p-2.5 flex items-baseline justify-between gap-3">
      <span className="font-ui text-sm text-foreground">{name}</span>
      <span className="font-mono text-[10px] text-muted text-right">{why}</span>
    </Card>
  );
}
function Empty() {
  return <p className="font-ui text-xs text-muted py-2">No strong match for this combo — try a different goal or subclass.</p>;
}
