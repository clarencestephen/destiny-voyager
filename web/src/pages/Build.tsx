import { useEffect, useMemo, useState } from "react";
import { search } from "@/lib/search";
import { api } from "@/lib/api";
import { loadLibrary, saveLibrary, readLocalLibrary, type Library } from "@/lib/library";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * /build — a build composer. Assemble a loadout from the weapon + armor
 * databases (kinetic/energy/power weapons, exotic armor, an armor set theme,
 * subclass/super, aspects/fragments/notes), save it, and equip the owned match.
 *
 * Anonymous: compose + save (localStorage) freely. Signed in: equip the picks
 * you own to the matching character. Data: weapons.json + armor.json (Bungie
 * manifest + DIM). Set bonuses from the manifest. /credits.
 */

const CDN = "https://www.bungie.net";
const CLASSES = ["Titan", "Hunter", "Warlock"] as const;
const ELEMENTS = ["Prismatic", "Arc", "Solar", "Void", "Stasis", "Strand", "Kinetic"] as const;
const WEAPON_SLOTS = ["Kinetic", "Energy", "Power"] as const;
const EL_COLOR: Record<string, string> = {
  Arc: "text-cyan-300", Solar: "text-orange-400", Void: "text-violet-400",
  Stasis: "text-sky-300", Strand: "text-green-400", Kinetic: "text-zinc-300", Prismatic: "text-fuchsia-300",
};
type SlotKey = (typeof WEAPON_SLOTS)[number];

interface Weapon { hash: string; n: string; t: string; r: string; ammo: string; slot: string; el: string; icon: string; exotic: boolean }
interface ArmorPiece { hash: string; n: string; slot: string; cls: string; r: string; el: string; set: number | null; icon: string; exotic: boolean }
interface ArmorSet { n: string; perks: { count: number; n: string; d: string }[] }
interface Pick { hash: string; n: string; icon: string; sub?: string; exotic?: boolean }
interface SavedBuild {
  id: string; name: string; cls: string; element: string; superName: string;
  weapons: Partial<Record<SlotKey, Pick>>; exoticArmor?: Pick; setHash?: string;
  aspects: string; fragments: string; notes: string;
}

type PickerState = { kind: "weapon"; slot: SlotKey } | { kind: "armor" } | { kind: "set" } | null;

export default function Build() {
  const [allWeapons, setAllWeapons] = useState<Weapon[]>([]);
  const [allArmor, setAllArmor] = useState<ArmorPiece[]>([]);
  const [sets, setSets] = useState<Record<string, ArmorSet>>({});
  const [loading, setLoading] = useState(true);

  const [cls, setCls] = useState<(typeof CLASSES)[number]>("Warlock");
  const [element, setElement] = useState<(typeof ELEMENTS)[number]>("Void");
  const [superName, setSuperName] = useState("");
  const [weapons, setWeapons] = useState<Partial<Record<SlotKey, Pick>>>({});
  const [exoticArmor, setExoticArmor] = useState<Pick | undefined>();
  const [setHash, setSetHash] = useState<string | undefined>();
  const [aspects, setAspects] = useState("");
  const [fragments, setFragments] = useState("");
  const [notes, setNotes] = useState("");
  const [name, setName] = useState("");

  const [lib, setLib] = useState<Library>(readLocalLibrary);
  const saved = lib.builds as SavedBuild[];
  const [picker, setPicker] = useState<PickerState>(null);
  const [equipMsg, setEquipMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/weapons.json").then((r) => r.json()),
      fetch("/armor.json").then((r) => r.json()),
    ]).then(([w, a]) => {
      setAllWeapons(Object.entries(w).map(([hash, v]) => ({ hash, ...(v as object) }) as Weapon));
      setAllArmor(Object.entries(a.items).map(([hash, v]) => ({ hash, ...(v as object) }) as ArmorPiece));
      setSets(a.sets);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadLibrary().then(setLib); }, []);

  function persist(list: SavedBuild[]) {
    setLib((prev) => { const next = { ...prev, builds: list }; saveLibrary(next); return next; });
  }
  function saveBuild() {
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || `build-${saved.length + 1}`;
    const b: SavedBuild = { id, name: name.trim() || "Untitled build", cls, element, superName, weapons, exoticArmor, setHash, aspects, fragments, notes };
    persist([...saved.filter((x) => x.id !== id), b]);
  }
  function loadBuild(b: SavedBuild) {
    setName(b.name); setCls(b.cls as any); setElement(b.element as any); setSuperName(b.superName);
    setWeapons(b.weapons); setExoticArmor(b.exoticArmor); setSetHash(b.setHash);
    setAspects(b.aspects); setFragments(b.fragments); setNotes(b.notes); setEquipMsg(null);
  }
  function clearBuild() {
    setWeapons({}); setExoticArmor(undefined); setSetHash(undefined);
    setSuperName(""); setAspects(""); setFragments(""); setNotes(""); setName(""); setEquipMsg(null);
  }

  const exoticWeaponCount = Object.values(weapons).filter((w) => w?.exotic).length;

  async function equipBuild() {
    setEquipMsg("Matching your inventory…");
    try {
      const [profile, inv] = await Promise.all([api.me(), api.inventoryDecorated()]);
      const char = (profile.characters || []).find((c) => c.class === cls.toLowerCase());
      if (!char) { setEquipMsg(`No ${cls} guardian found on your account.`); return; }
      const picks: Pick[] = [...(Object.values(weapons).filter(Boolean) as Pick[])];
      if (exoticArmor) picks.push(exoticArmor);
      const ids: string[] = []; const missing: string[] = [];
      for (const pk of picks) {
        const inst = inv.find((i) => i.hash === Number(pk.hash));
        if (inst) ids.push(inst.instance_id); else missing.push(pk.n);
      }
      if (!ids.length) { setEquipMsg("You don't own any of these picks yet."); return; }
      const res = await api.equip(char.id, ids);
      setEquipMsg(`✓ Equipped ${res.equipped_count ?? ids.length} to your ${cls}${missing.length ? ` · not owned: ${missing.join(", ")}` : ""}.`);
    } catch {
      setEquipMsg("Sign in (Link your Bungie account) to equip — anonymous build/save still works.");
    }
  }

  if (loading) return <div className="container py-20 font-ui text-muted">Loading the forge…</div>;

  const setObj = setHash ? sets[setHash] : undefined;

  return (
    <section className="container py-8 flex flex-col gap-5 max-w-6xl">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">▲ Build Composer</span>
        <h1 className="font-display text-3xl tracking-[0.16em] font-black text-signature">BUILD</h1>
        <p className="font-ui text-sm text-muted-foreground max-w-3xl">
          Compose a loadout from the weapon + armor databases, save it, and equip what you own. Browse + save work without signing in.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Composer */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Identity */}
          <Card className="p-4 space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Build name…"
              className="w-full bg-void/40 border border-border rounded px-3 py-2 font-display text-lg focus:border-saber outline-none" />
            <div className="flex flex-wrap gap-3">
              <Field label="Class">
                <select value={cls} onChange={(e) => setCls(e.target.value as any)} className="dv-select">
                  {CLASSES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Subclass">
                <select value={element} onChange={(e) => setElement(e.target.value as any)} className="dv-select">
                  {ELEMENTS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Super">
                <input value={superName} onChange={(e) => setSuperName(e.target.value)} placeholder="e.g. Nova Bomb"
                  className="bg-void/40 border border-border rounded px-2 py-1.5 font-ui text-sm w-44 focus:border-saber outline-none" />
              </Field>
            </div>
          </Card>

          {/* Weapons */}
          <Card className="p-4 space-y-2">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-saber">Weapons</h3>
            {WEAPON_SLOTS.map((s) => (
              <SlotRow key={s} label={s} pick={weapons[s]} onPick={() => setPicker({ kind: "weapon", slot: s })}
                onClear={() => setWeapons((w) => ({ ...w, [s]: undefined }))} />
            ))}
            {exoticWeaponCount > 1 && <p className="text-amber-400 text-[11px] font-ui">⚠ Only one Exotic weapon can be equipped at once.</p>}
          </Card>

          {/* Armor + set */}
          <Card className="p-4 space-y-2">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-saber">Exotic armor + set</h3>
            <SlotRow label="Exotic armor" pick={exoticArmor} onPick={() => setPicker({ kind: "armor" })} onClear={() => setExoticArmor(undefined)} />
            <div className="flex items-center gap-2">
              <button onClick={() => setPicker({ kind: "set" })}
                className="flex-1 text-left px-3 py-2 rounded border border-border hover:border-saber font-ui text-sm text-muted">
                {setObj ? <span className="text-star">{setObj.n}</span> : "+ Pick an armor set (theme)…"}
              </button>
              {setObj && <button onClick={() => setSetHash(undefined)} className="text-muted hover:text-sith text-xs">✕</button>}
            </div>
            {setObj && (
              <div className="space-y-1 pt-1">
                {setObj.perks.filter((p) => p.n).map((p) => (
                  <div key={p.count} className="text-[11px]"><span className="font-mono text-saber">{p.count}pc</span> <span className="text-foreground">{p.n}</span> <span className="text-muted">— {p.d}</span></div>
                ))}
              </div>
            )}
          </Card>

          {/* Subclass details */}
          <Card className="p-4 space-y-2">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-saber">Aspects · Fragments · Notes</h3>
            <textarea value={aspects} onChange={(e) => setAspects(e.target.value)} placeholder="Aspects (e.g. Chaos Accelerant, Feed the Void)" rows={1} className="dv-area" />
            <textarea value={fragments} onChange={(e) => setFragments(e.target.value)} placeholder="Fragments (e.g. Echo of Instability, Persistence…)" rows={2} className="dv-area" />
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ghost / artifact / mods / playstyle notes" rows={2} className="dv-area" />
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveBuild} variant="primary">Save build</Button>
            <Button onClick={equipBuild} variant="outline">Equip owned</Button>
            <Button onClick={clearBuild} variant="ghost">Clear</Button>
            {equipMsg && <span className="font-ui text-xs text-muted">{equipMsg}</span>}
          </div>
        </div>

        {/* Saved builds */}
        <div className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-saber">Saved builds ({saved.length})</h3>
          {saved.length === 0 && <p className="font-ui text-xs text-muted">No saved builds yet — compose one and hit Save.</p>}
          {saved.map((b) => (
            <Card key={b.id} className="p-3">
              <div className="flex items-baseline gap-2">
                <button onClick={() => loadBuild(b)} className="font-display text-star hover:text-saber text-left truncate">{b.name}</button>
                <button onClick={() => persist(saved.filter((x) => x.id !== b.id))} className="ml-auto text-muted hover:text-sith text-xs">✕</button>
              </div>
              <div className="font-mono text-[10px] text-muted">{b.cls} · {b.element}{b.superName ? ` · ${b.superName}` : ""}</div>
              <div className="flex gap-1 mt-1">
                {Object.values(b.weapons).filter(Boolean).map((p) => p && <img key={p.hash} src={CDN + p.icon} title={p.n} alt="" className="w-7 h-7 rounded border border-void" />)}
                {b.exoticArmor && <img src={CDN + b.exoticArmor.icon} title={b.exoticArmor.n} alt="" className="w-7 h-7 rounded border border-amber-500/50" />}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {picker && (
        <PickerModal
          picker={picker} weapons={allWeapons} armor={allArmor} sets={sets} cls={cls}
          onClose={() => setPicker(null)}
          onPickWeapon={(slot, p) => { setWeapons((w) => ({ ...w, [slot]: p })); setPicker(null); }}
          onPickArmor={(p) => { setExoticArmor(p); setPicker(null); }}
          onPickSet={(sh) => { setSetHash(sh); setPicker(null); }}
        />
      )}
      <style>{`.dv-select{background:rgba(10,10,18,.5);border:1px solid hsl(var(--border));border-radius:.375rem;padding:.375rem .5rem;font-size:.85rem}.dv-area{width:100%;background:rgba(10,10,18,.4);border:1px solid hsl(var(--border));border-radius:.375rem;padding:.4rem .6rem;font-size:.8rem;outline:none}.dv-area:focus{border-color:hsl(var(--saber,270 70% 60%))}`}</style>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">{label}</span>
      {children}
    </label>
  );
}

function SlotRow({ label, pick, onPick, onClear }: { label: string; pick?: Pick; onPick: () => void; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted w-24 shrink-0">{label}</span>
      <button onClick={onPick} className="flex-1 flex items-center gap-2 text-left px-2 py-1.5 rounded border border-border hover:border-saber min-w-0">
        {pick ? (
          <>
            <img src={CDN + pick.icon} alt="" className="w-7 h-7 rounded border border-void shrink-0" />
            <span className={`truncate font-ui text-sm ${pick.exotic ? "text-amber-300" : "text-star"}`}>{pick.n}</span>
            {pick.sub && <span className="font-mono text-[10px] text-muted ml-auto shrink-0">{pick.sub}</span>}
          </>
        ) : <span className="font-ui text-sm text-muted">+ Pick {label.toLowerCase()}…</span>}
      </button>
      {pick && <button onClick={onClear} className="text-muted hover:text-sith text-xs shrink-0">✕</button>}
    </div>
  );
}

function PickerModal({
  picker, weapons, armor, sets, cls, onClose, onPickWeapon, onPickArmor, onPickSet,
}: {
  picker: Exclude<PickerState, null>; weapons: Weapon[]; armor: ArmorPiece[]; sets: Record<string, ArmorSet>;
  cls: string; onClose: () => void;
  onPickWeapon: (slot: SlotKey, p: Pick) => void; onPickArmor: (p: Pick) => void; onPickSet: (sh: string) => void;
}) {
  const [q, setQ] = useState("");
  const title = picker.kind === "weapon" ? `Pick ${picker.slot} weapon` : picker.kind === "armor" ? `Pick exotic ${cls} armor` : "Pick an armor set";

  const results = useMemo(() => {
    if (picker.kind === "weapon") {
      return search(q, weapons.filter((w) => w.slot === picker.slot)).slice(0, 60);
    }
    if (picker.kind === "armor") {
      return search(q, armor.filter((a) => a.exotic && (a.cls === cls || a.cls === "Any"))).slice(0, 60);
    }
    const ql = q.toLowerCase();
    return Object.entries(sets).filter(([, s]) => !ql || s.n.toLowerCase().includes(ql)).slice(0, 60);
  }, [q, picker, weapons, armor, sets, cls]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <Card className="max-w-2xl w-full max-h-[80vh] flex flex-col p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display text-lg text-star">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-star font-mono text-xs uppercase tracking-widest">close ✕</button>
        </div>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
          className="bg-void/40 border border-border rounded px-3 py-2 font-ui text-sm focus:border-saber outline-none mb-3" />
        <div className="overflow-y-auto flex flex-col gap-1">
          {picker.kind === "set"
            ? (results as [string, ArmorSet][]).map(([sh, s]) => (
                <button key={sh} onClick={() => onPickSet(sh)} className="text-left px-3 py-2 rounded hover:bg-saber/5 border border-transparent hover:border-border">
                  <span className="text-star font-display">{s.n}</span>
                  <span className="text-muted text-[11px] ml-2">{s.perks.filter((p) => p.n).map((p) => `${p.count}pc ${p.n}`).join(" · ")}</span>
                </button>
              ))
            : (results as (Weapon | ArmorPiece)[]).map((it) => {
                const isWeapon = picker.kind === "weapon";
                const pk: Pick = { hash: it.hash, n: it.n, icon: it.icon, exotic: it.exotic, sub: isWeapon ? (it as Weapon).el : (it as ArmorPiece).slot };
                return (
                  <button key={it.hash} onClick={() => isWeapon ? onPickWeapon((picker as any).slot, pk) : onPickArmor(pk)}
                    className="flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-saber/5 border border-transparent hover:border-border">
                    <img src={CDN + it.icon} alt="" className="w-8 h-8 rounded border border-void shrink-0" />
                    <span className={`truncate font-ui text-sm ${it.exotic ? "text-amber-300" : "text-foreground"}`}>{it.n}</span>
                    <span className={`ml-auto font-mono text-[10px] shrink-0 ${EL_COLOR[(it as Weapon).el] || "text-muted"}`}>
                      {isWeapon ? `${(it as Weapon).el} ${(it as Weapon).t}` : (it as ArmorPiece).slot}
                    </span>
                  </button>
                );
              })}
          {results.length === 0 && <p className="text-muted font-ui text-sm py-6 text-center">No matches.</p>}
        </div>
      </Card>
    </div>
  );
}
