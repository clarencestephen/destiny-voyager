import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
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

interface Slot { index: number; nameHash: number; colorHash: number; iconHash: number; itemCount: number }
interface Char { character_id: string; class: string; light: number; emblemPath: string; dateLastPlayed: string; slots: Slot[] }
interface Meta { names: Record<string, string>; colors: Record<string, string>; icons: Record<string, string> }

type Pending = { kind: "save"; slot: Slot } | { kind: "clear"; slot: Slot } | null;

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

  function refresh() {
    return api.getLoadouts()
      .then((d) => { setChars(d.characters); if (!active && d.characters[0]) setActive(d.characters[0].character_id); })
      .catch(() => setSignedOut(true));
  }
  useEffect(() => {
    fetch("/loadout-meta.json").then((r) => r.json()).then(setMeta).catch(() => {});
    refresh().finally(() => setLoading(false));
  }, []); // eslint-disable-line

  const char = useMemo(() => chars.find((c) => c.character_id === active), [chars, active]);
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

      {/* Slot grid */}
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
                </div>
              </div>
            </Card>
          );
        })}
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
    </section>
  );
}
