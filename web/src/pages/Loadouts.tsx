import { useEffect, useMemo, useState } from "react";
import { api, type DVLoadout, type Item } from "@/lib/api";
import { loadLibrary, saveLibrary, readLocalLibrary, type Library } from "@/lib/library";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * /loadouts — the in-game Loadout slot manager (Bungie's 20 per character).
 *
 * Save your currently-equipped gear into a slot (SnapshotLoadout), Load/swap a
 * saved slot (EquipLoadout — atomic, works in any non-combat lull), or Clear a
 * slot. Identifiers (name/icon/color) are Bungie's predefined set (no free
 * text) — resolved from loadout-meta.json. Overriding a populated slot asks
 * first. This is the mid-activity swap path: build in orbit → save to a slot →
 * swap to it in-game during events.
 */

const CDN = "https://www.bungie.net";
const WEAPON_SLOTS = ["Kinetic", "Energy", "Power"];
const DV_ARMOR_SLOTS = ["Helmet", "Gauntlets", "Chest", "Legs", "Class"];

interface Slot { index: number; nameHash: number; colorHash: number; iconHash: number; itemCount: number }
interface Char { character_id: string; class: string; light: number; emblemPath: string; dateLastPlayed: string; slots: Slot[] }
interface Meta { names: Record<string, string>; colors: Record<string, string>; icons: Record<string, string> }

type Pending =
  | { kind: "save"; slot: Slot }
  | { kind: "clear"; slot: Slot }
  | { kind: "push"; slot: Slot; ld: DVLoadout }
  | null;

export default function Loadouts() {
  const [chars, setChars] = useState<Char[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [active, setActive] = useState<string>("");
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  // save-picker identifier choices (default to first available)
  const [pick, setPick] = useState<{ nameHash: number; iconHash: number; colorHash: number } | null>(null);
  // DV library (phase 2): unlimited named loadouts stored in KV
  const [inv, setInv] = useState<Item[]>([]);
  const [lib, setLib] = useState<Library>(readLocalLibrary);
  const [saveName, setSaveName] = useState("");
  const [pushFor, setPushFor] = useState<DVLoadout | null>(null);   // when set, slot grid is in "push here" mode
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  function refresh() {
    return api.getLoadouts()
      .then((d) => { setChars(d.characters); if (!active && d.characters[0]) setActive(d.characters[0].character_id); })
      .catch(() => setSignedOut(true));
  }
  useEffect(() => {
    fetch("/loadout-meta.json").then((r) => r.json()).then(setMeta).catch(() => {});
    api.inventoryDecorated().then(setInv).catch(() => {});
    loadLibrary().then(setLib).catch(() => {});
    refresh().finally(() => setLoading(false));
  }, []); // eslint-disable-line

  const char = useMemo(() => chars.find((c) => c.character_id === active), [chars, active]);
  const myLoadouts = useMemo(
    () => (lib.loadouts ?? []).filter((l) => !char || l.class === char.class),
    [lib.loadouts, char],
  );
  const nameOf = (h: number) => meta?.names[String(h)] || `Slot`;
  const iconOf = (h: number) => meta?.icons[String(h)] || "";

  // identifier option lists (sorted by hash for stable order)
  const nameOpts = useMemo(() => Object.entries(meta?.names || {}), [meta]);
  const iconOpts = useMemo(() => Object.entries(meta?.icons || {}), [meta]);
  const colorOpts = useMemo(() => Object.entries(meta?.colors || {}), [meta]);

  function openSave(slot: Slot) {
    // seed picker from the slot's current identity (or first available)
    setPick({
      nameHash: slot.nameHash || Number(nameOpts[0]?.[0] || 0),
      iconHash: slot.iconHash || Number(iconOpts[0]?.[0] || 0),
      colorHash: slot.colorHash || Number(colorOpts[0]?.[0] || 0),
    });
    setPending({ kind: "save", slot });
  }

  async function doSave() {
    if (pending?.kind !== "save" || !pick) return;
    const slot = pending.slot;
    setBusy(slot.index); setPending(null); setMsg(null);
    try {
      await api.snapshotLoadout(active, slot.index, pick.nameHash, pick.colorHash, pick.iconHash);
      await refresh();
      setMsg({ kind: "ok", text: `Saved your equipped gear to slot ${slot.index + 1} (${nameOf(pick.nameHash)}).` });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "save failed" });
    } finally { setBusy(null); }
  }

  async function doLoad(slot: Slot) {
    setBusy(slot.index); setMsg(null);
    try {
      await api.equipLoadout(active, slot.index);
      setMsg({ kind: "ok", text: `Equipped slot ${slot.index + 1} (${nameOf(slot.nameHash)}). Blocked in active combat — works in any lull.` });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "equip failed" });
    } finally { setBusy(null); }
  }

  async function doClear(slot: Slot) {
    setBusy(slot.index); setPending(null); setMsg(null);
    try {
      await api.clearLoadout(active, slot.index);
      await refresh();
      setMsg({ kind: "ok", text: `Cleared slot ${slot.index + 1}.` });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "clear failed" });
    } finally { setBusy(null); }
  }

  // ---- DV library (unlimited named loadouts in KV) ----------------------------
  function persist(next: Library) { setLib(next); saveLibrary(next); }

  function captureEquipped(): DVLoadout["items"] {
    if (!char) return [];
    const eqLoc = `${char.class.toUpperCase()} EQUIPPED`;
    return inv
      .filter((i) => i.location === eqLoc && [...WEAPON_SLOTS, ...DV_ARMOR_SLOTS].includes(i.slot))
      .map((i) => ({ instance_id: i.instance_id, hash: i.hash, slot: i.slot, name: i.name, iconUrl: i.iconUrl, exotic: i.isExotic }));
  }

  function saveCurrentToDV() {
    if (!char) return;
    const items = captureEquipped();
    if (!items.length) { setMsg({ kind: "err", text: "Couldn't read your equipped gear — reload and try again." }); return; }
    const ld: DVLoadout = {
      id: `ld_${Date.now().toString(36)}`,
      name: saveName.trim() || `${char.class} loadout`,
      class: char.class, items, createdAt: Date.now(),
    };
    persist({ ...lib, loadouts: [ld, ...(lib.loadouts ?? [])] });
    setSaveName("");
    setMsg({ kind: "ok", text: `Saved “${ld.name}” to your DV library (${items.length} items).` });
  }

  function deleteDV(id: string) { persist({ ...lib, loadouts: (lib.loadouts ?? []).filter((l) => l.id !== id) }); }
  function commitRename() {
    if (!renaming) return;
    persist({ ...lib, loadouts: (lib.loadouts ?? []).map((l) => l.id === renaming.id ? { ...l, name: renaming.name.trim() || l.name } : l) });
    setRenaming(null);
  }

  async function applyDV(ld: DVLoadout) {
    const target = chars.find((c) => c.class === ld.class)?.character_id || active;
    setBusy(-1); setMsg(null);
    try {
      await api.equip(target, ld.items.map((i) => i.instance_id));
      setMsg({ kind: "ok", text: `Equipped “${ld.name}” — mods ride along on the gear. Blocked only in active combat.` });
    } catch (e: any) { setMsg({ kind: "err", text: e?.message || "apply failed" }); }
    finally { setBusy(null); }
  }

  async function doPush(slot: Slot, ld: DVLoadout) {
    const target = chars.find((c) => c.class === ld.class)?.character_id || active;
    setBusy(slot.index); setPending(null); setMsg(null);
    try {
      await api.equip(target, ld.items.map((i) => i.instance_id));            // equip the build…
      const nameHash = ld.nameHash || slot.nameHash || Number(nameOpts[0]?.[0] || 0);
      const iconHash = ld.iconHash || slot.iconHash || Number(iconOpts[0]?.[0] || 0);
      const colorHash = ld.colorHash || slot.colorHash || Number(colorOpts[0]?.[0] || 0);
      await api.snapshotLoadout(target, slot.index, nameHash, colorHash, iconHash); // …snapshot into the slot
      await refresh();
      setMsg({ kind: "ok", text: `Pushed “${ld.name}” into in-game slot ${slot.index + 1}.` });
    } catch (e: any) { setMsg({ kind: "err", text: e?.message || "push failed" }); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="container py-20 font-ui text-muted">Loading your loadouts…</div>;
  if (signedOut) return (
    <section className="container py-8 max-w-3xl">
      <h1 className="font-display text-3xl tracking-[0.16em] font-black text-signature">LOADOUTS</h1>
      <p className="font-ui text-amber-400 mt-4">Link your Bungie account to manage your in-game loadout slots.</p>
    </section>
  );

  return (
    <section className="container py-8 flex flex-col gap-5 max-w-5xl">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">▲ In-game Loadout slots</span>
        <h1 className="font-display text-3xl tracking-[0.16em] font-black text-signature">LOADOUTS</h1>
        <p className="font-ui text-sm text-muted-foreground max-w-3xl">
          Save your equipped gear into a slot, then swap to it in-game during any non-combat lull
          (<span className="text-saber">EquipLoadout</span> is atomic — weapons, armor, mods + subclass at once).
          Swaps are blocked only during active combat. Identifiers are Bungie's preset names/icons/colors.
        </p>
      </header>

      {/* Character tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {chars.map((c) => (
          <button key={c.character_id} onClick={() => { setActive(c.character_id); setMsg(null); }}
            className={`px-3 py-2 rounded border font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
              active === c.character_id ? "text-saber border-saber" : "border-border text-muted hover:text-foreground"}`}>
            {c.class} · pw {c.light} · {c.slots.filter((s) => s.itemCount).length}/{c.slots.length}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`px-3 py-2 rounded border font-ui text-xs ${msg.kind === "ok"
          ? "border-emerald-400/40 bg-emerald-400/5 text-emerald-300"
          : "border-red-400/40 bg-red-400/5 text-red-300"}`}>
          {msg.kind === "ok" ? "✓ " : "⚠ "}{msg.text}
        </div>
      )}

      {pushFor && (
        <div className="px-3 py-2 rounded border border-saber/50 bg-saber/5 font-ui text-xs text-saber flex items-center justify-between gap-3">
          <span>Pick an in-game slot to push <b>“{pushFor.name}”</b> into — empty fills instantly; a saved slot asks first.</span>
          <button onClick={() => setPushFor(null)} className="text-muted hover:text-saber text-[10px] uppercase tracking-[0.25em] shrink-0">cancel</button>
        </div>
      )}

      {/* In-game slot grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {char?.slots.map((slot) => {
          const filled = slot.itemCount > 0;
          const working = busy === slot.index;
          return (
            <Card key={slot.index} className={`p-3 ${filled ? "border-saber/40" : "border-border/60"}`}>
              <div className="flex items-center gap-3">
                <div className="relative w-10 h-10 shrink-0">
                  {filled && iconOf(slot.iconHash)
                    ? <img src={CDN + iconOf(slot.iconHash)} alt="" className="w-10 h-10 rounded border border-void" />
                    : <div className="w-10 h-10 rounded border border-dashed border-border/60 grid place-items-center text-muted text-[9px] font-mono">{slot.index + 1}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-sm truncate">
                    {filled ? nameOf(slot.nameHash) : <span className="text-muted">Empty slot {slot.index + 1}</span>}
                  </div>
                  <div className="font-mono text-[10px] text-muted">
                    {filled ? `${slot.itemCount} items · slot ${slot.index + 1}` : "available"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {pushFor ? (
                    <button
                      onClick={() => { const ld = pushFor; setPushFor(null); filled ? setPending({ kind: "push", slot, ld }) : doPush(slot, ld); }}
                      disabled={working}
                      className={`px-2.5 py-1 rounded border text-[10px] font-mono uppercase tracking-wider disabled:opacity-40 ${
                        filled ? "border-amber-300/60 text-amber-300 hover:bg-amber-300/10" : "border-saber/60 text-saber hover:bg-saber/10"}`}>
                      {filled ? "Override" : "Push here"}
                    </button>
                  ) : (
                    <>
                      {filled && (
                        <button onClick={() => doLoad(slot)} disabled={working}
                          className="px-2.5 py-1 rounded border border-saber/50 text-saber text-[10px] font-mono uppercase tracking-wider hover:bg-saber/10 disabled:opacity-40">
                          {working ? "…" : "Load"}
                        </button>
                      )}
                      <button onClick={() => openSave(slot)} disabled={working}
                        className="px-2.5 py-1 rounded border border-border text-muted text-[10px] font-mono uppercase tracking-wider hover:text-foreground disabled:opacity-40">
                        Save
                      </button>
                      {filled && (
                        <button onClick={() => setPending({ kind: "clear", slot })} disabled={working}
                          className="px-2 py-1 rounded border border-border text-muted text-[10px] font-mono uppercase hover:text-red-300 disabled:opacity-40">✕</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* DV Library — unlimited named loadouts (KV) */}
      <div className="border-t border-border/60 pt-5 mt-1">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-display text-xl tracking-wide text-star">DV Library</h2>
            <p className="font-ui text-[11px] text-muted">Unlimited named {char?.class} loadouts — keep more than your 20 in-game slots. Apply directly, or push one into a slot for in-game swaps.</p>
          </div>
          <div className="flex items-center gap-2">
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={`Name this ${char?.class ?? ""} loadout…`}
              className="bg-void/40 border border-border rounded px-2.5 py-1.5 font-ui text-xs w-48 focus:border-saber outline-none" />
            <Button onClick={saveCurrentToDV} variant="primary">Save current</Button>
          </div>
        </div>
        {myLoadouts.length === 0 ? (
          <p className="font-ui text-sm text-muted py-3">
            No saved loadouts for your {char?.class}. Equip a build (in-game or via the Optimizer), name it above, then <span className="text-saber">Save current</span>.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {myLoadouts.map((ld) => (
              <Card key={ld.id} className="p-3">
                {renaming?.id === ld.id ? (
                  <div className="flex items-center gap-2 mb-2">
                    <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: ld.id, name: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && commitRename()}
                      className="bg-void/60 border border-saber/50 rounded px-2 py-1 font-ui text-sm flex-1" />
                    <button onClick={commitRename} className="text-saber text-[10px] uppercase">save</button>
                    <button onClick={() => setRenaming(null)} className="text-muted text-[10px] uppercase">×</button>
                  </div>
                ) : (
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="font-display text-sm truncate">{ld.name}</span>
                    <span className="font-mono text-[10px] text-muted">{ld.items.length} items</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1 mb-2.5">
                  {ld.items.map((it) => (
                    <img key={it.instance_id} src={CDN + it.iconUrl} title={`${it.name} · ${it.slot}`} alt=""
                      className={`w-8 h-8 rounded border ${it.exotic ? "border-amber-500/50" : "border-void"}`} />
                  ))}
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
                  <button onClick={() => applyDV(ld)} disabled={busy === -1}
                    className="px-2.5 py-1 rounded border border-saber/50 text-saber hover:bg-saber/10 disabled:opacity-40">{busy === -1 ? "…" : "Apply"}</button>
                  <button onClick={() => { setPushFor(ld); setMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    className="px-2.5 py-1 rounded border border-border text-muted hover:text-foreground">→ Slot</button>
                  <button onClick={() => setRenaming({ id: ld.id, name: ld.name })} className="px-2 py-1 rounded border border-border text-muted hover:text-foreground">rename</button>
                  <button onClick={() => deleteDV(ld.id)} className="px-2 py-1 rounded border border-border text-muted hover:text-red-300 ml-auto">delete</button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Save picker / confirm */}
      {pending?.kind === "save" && pick && (
        <Card className="p-4 border-saber/40 fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(560px,92vw)] z-40 bg-void/95 backdrop-blur">
          <div className="font-display text-sm text-saber mb-1">
            Save equipped gear → slot {pending.slot.index + 1}
            {pending.slot.itemCount > 0 && <span className="text-amber-300"> · overrides “{nameOf(pending.slot.nameHash)}”</span>}
          </div>
          <p className="font-ui text-[11px] text-muted mb-3">
            Captures whatever you have equipped on this {char?.class} <em>right now</em>. Pick a name, icon + color:
          </p>
          <div className="space-y-2 font-ui text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted w-12">Name</span>
              <select value={pick.nameHash} onChange={(e) => setPick({ ...pick, nameHash: Number(e.target.value) })}
                className="bg-void/60 border border-border rounded px-2 py-1 flex-1">
                {nameOpts.map(([h, n]) => <option key={h} value={h}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-muted w-12 pt-1">Icon</span>
              <div className="flex flex-wrap gap-1 flex-1">
                {iconOpts.map(([h, p]) => (
                  <button key={h} onClick={() => setPick({ ...pick, iconHash: Number(h) })}
                    className={`w-7 h-7 rounded border ${pick.iconHash === Number(h) ? "border-saber" : "border-border/50"}`}>
                    <img src={CDN + p} alt="" className="w-full h-full rounded" />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-muted w-12 pt-1">Color</span>
              <div className="flex flex-wrap gap-1 flex-1">
                {colorOpts.map(([h, p]) => (
                  <button key={h} onClick={() => setPick({ ...pick, colorHash: Number(h) })}
                    className={`w-7 h-7 rounded border ${pick.colorHash === Number(h) ? "border-saber" : "border-border/50"}`}>
                    <img src={CDN + p} alt="" className="w-full h-full rounded" />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <Button onClick={doSave} variant="primary">{pending.slot.itemCount > 0 ? "Override + Save" : "Save"}</Button>
            <button onClick={() => setPending(null)} className="text-muted hover:text-saber text-[10px] uppercase tracking-[0.25em]">cancel</button>
          </div>
        </Card>
      )}

      {pending?.kind === "clear" && (
        <Card className="p-4 border-red-400/40 fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(460px,92vw)] z-40 bg-void/95 backdrop-blur">
          <div className="font-ui text-xs text-red-300 mb-3">Clear slot {pending.slot.index + 1} (“{nameOf(pending.slot.nameHash)}”)? This removes the saved loadout (your equipped gear is untouched).</div>
          <div className="flex items-center gap-3">
            <Button onClick={() => doClear(pending.slot)} variant="primary">Clear slot</Button>
            <button onClick={() => setPending(null)} className="text-muted hover:text-saber text-[10px] uppercase tracking-[0.25em]">cancel</button>
          </div>
        </Card>
      )}

      {pending?.kind === "push" && (
        <Card className="p-4 border-amber-300/40 fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(480px,92vw)] z-40 bg-void/95 backdrop-blur">
          <div className="font-ui text-xs text-amber-200 mb-3">
            Override in-game slot {pending.slot.index + 1} (“{nameOf(pending.slot.nameHash)}”) with <b>“{pending.ld.name}”</b>? This equips the build, then snapshots it into that slot.
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => doPush(pending.slot, pending.ld)} variant="primary">Override + Push</Button>
            <button onClick={() => setPending(null)} className="text-muted hover:text-saber text-[10px] uppercase tracking-[0.25em]">cancel</button>
          </div>
        </Card>
      )}
    </section>
  );
}
