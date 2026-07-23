import { useEffect, useRef, useState } from "react";
import { api, type Library, type WishSpace } from "@/lib/api";
import { loadLibrary, saveLibrary } from "@/lib/library";

/**
 * Wishlist — a completely personalizable space, tied to the Bungie login.
 *
 * Rows are free-form text boxes: add, remove, reorder (sequential), undo.
 * "Got it" REMOVES the row (no mark-off state) — undo is the safety net.
 * Persistence rides the library layer: localStorage immediately, per-user
 * KV (library:<bungie_id>) when signed in.
 *
 * Design: DARTH_BANKAI "personal ledger" — numbered directives on corner-cut
 * panels, saber edge-glow, kanji watermark, terminal scratchpad.
 */

const uid = () => Math.random().toString(36).slice(2, 10);

// Seeded once from the user's "Destiny 2 wish list.xlsx" (2026-07-07) — fully
// editable/deletable; this is only the starting content for an empty space.
const SEED: WishSpace = {
  sections: [
    {
      id: uid(), title: "Weapons & Exotics",
      items: [
        { id: uid(), name: "Necrochasm — Crota's End boss farm" },
        { id: uid(), name: "Ergo Sum — Excisions on the Pale Heart" },
        { id: uid(), name: "Conditional Finality (scorch) — Root of Nightmares boss farm" },
        { id: uid(), name: "Vex Mythoclast + Catalyst — VoG boss farm + Masters" },
        { id: uid(), name: "Void glaive — Warlord's Ruin" },
        { id: uid(), name: "Winterbite exotic glaive (freezes) — complete \"Strider\" quest on Neptune" },
        { id: uid(), name: "Heartshadow (invisibility + void) [solo!] — Duality dungeon boss farm · https://www.youtube.com/watch?v=24o0TOHhtyM" },
        { id: uid(), name: "The Navigator — Ghost of the Deep" },
        { id: uid(), name: "Insidious (Adept) pulse rifle — Vow of the Disciple master challenges" },
        { id: uid(), name: "Parasite — The Witch Queen campaign" },
        { id: uid(), name: "Appetence — Stasis trace rifle, special ammo · Starcrossed" },
        { id: uid(), name: "Vexcalibur" },
        { id: uid(), name: "Adhortative — really strong · Heal Clip / Incandescent + free ammo from the origin trait" },
      ],
    },
    {
      id: uid(), title: "Catalysts",
      items: [
        { id: uid(), name: "Leviathan Catalyst — EDZ Widow's Walk" },
        { id: uid(), name: "Auger's Finality catalyst — Sundered Doctrine" },
      ],
    },
    {
      id: uid(), title: "Cosmetics & Armor",
      items: [
        { id: uid(), name: "The Bushido armor set — Pinnacle Ops / Encore mission (Edge of Fate / Renegades rotations)" },
        { id: uid(), name: "Apostate's Blade set (2pc/4pc bonuses) — Pit of Heresy ONLY · not featured this week (was Jun 16–23) · Tier 5 + lockout-free farm need a featured week" },
      ],
    },
  ],
  notes: "",
};

const clone = (w: WishSpace): WishSpace => JSON.parse(JSON.stringify(w));

export default function Wishlist() {
  const [space, setSpace] = useState<WishSpace | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [bungieName, setBungieName] = useState<string>("");
  const libRef = useRef<Library | null>(null);
  const undoStack = useRef<WishSpace[]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const editSnap = useRef<WishSpace | null>(null); // one snapshot per typing burst

  useEffect(() => {
    (async () => {
      api.me()
        .then((p) => { setSignedIn(true); setBungieName(p.bungie_name ?? ""); })
        .catch(() => setSignedIn(false));
      const lib = await loadLibrary();
      libRef.current = lib;
      setSpace(lib.wishSpace?.sections?.length ? lib.wishSpace : clone(SEED));
    })();
  }, []);

  function persist(next: WishSpace) {
    setSpace(next);
    const lib = { ...(libRef.current ?? { builds: [], weaponWishlist: [], armorWishlist: [] }), wishSpace: next };
    libRef.current = lib as Library;
    saveLibrary(lib as Library);
  }

  /** Structural mutation — snapshot for undo, then apply. */
  function mutate(fn: (w: WishSpace) => void) {
    if (!space) return;
    undoStack.current.push(clone(space));
    if (undoStack.current.length > 50) undoStack.current.shift();
    setUndoDepth(undoStack.current.length);
    editSnap.current = null;
    const next = clone(space);
    fn(next);
    persist(next);
  }

  /** Text edit — snapshot once per editing burst (not per keystroke). */
  function edit(fn: (w: WishSpace) => void) {
    if (!space) return;
    if (!editSnap.current) {
      editSnap.current = clone(space);
      undoStack.current.push(editSnap.current);
      if (undoStack.current.length > 50) undoStack.current.shift();
      setUndoDepth(undoStack.current.length);
    }
    const next = clone(space);
    fn(next);
    persist(next);
  }

  function undo() {
    const prev = undoStack.current.pop();
    if (!prev) return;
    editSnap.current = null;
    setUndoDepth(undoStack.current.length);
    persist(prev);
  }

  const move = <T,>(arr: T[], i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  };

  if (!space) {
    return (
      <section className="container py-20">
        <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted animate-pulse-soft">
          loading wishlist…
        </div>
      </section>
    );
  }

  const total = space.sections.reduce((n, s) => n + s.items.length, 0);
  const chipBtn =
    "px-3 py-1.5 panel-cut border border-border bg-deepspace/60 text-saber hover:border-saber hover:bg-saber/5 transition-colors";

  return (
    <section className="container py-12 flex flex-col gap-7 max-w-4xl relative">
      {/* 願 = "wish" — brand kanji watermark */}
      <div aria-hidden className="pointer-events-none select-none absolute -top-2 right-2 font-body text-[10rem] leading-none text-sith/[0.06]">
        願
      </div>

      <header className="relative flex flex-col gap-3">
        <span className="font-mono text-[10px] tracking-[0.35em] uppercase text-muted">
          ▲ 欲しいものリスト · personal ledger · yours alone
        </span>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-4xl md:text-5xl tracking-[0.16em] font-black text-signature drop-shadow-[0_0_28px_rgba(255,51,136,0.25)]">
            WISHLIST
          </h1>
          <div className="flex items-center gap-2.5 font-mono text-[10px] tracking-[0.2em] uppercase pb-1">
            <span className="text-muted">{total} to chase</span>
            <button
              onClick={undo}
              disabled={undoDepth === 0}
              title="Undo last change"
              className={`${chipBtn} disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent`}
            >
              ↶ undo
            </button>
            <button
              onClick={() => mutate((w) => w.sections.push({ id: uid(), title: "New section", items: [{ id: uid(), name: "" }] }))}
              className={chipBtn}
            >
              ＋ section
            </button>
          </div>
        </div>
        <div className="saber-draw h-px bg-signature-gradient" />
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase">
          {signedIn === true && (
            <span className="text-saber">◈ synced to {bungieName || "your Bungie account"}</span>
          )}
          {signedIn === false && (
            <span className="text-amber-400">◈ stored on this device only — sign in with Bungie to tie it to your account</span>
          )}
          {signedIn === null && <span className="text-muted">◈ checking sign-in…</span>}
        </p>
      </header>

      {space.sections.map((sec, si) => (
        <div
          key={sec.id}
          className="panel-cut relative bg-deepspace/70 border border-border/80 p-6 pl-7 space-y-4 animate-fade-up group/section"
          style={{ animationDelay: `${si * 90}ms`, animationFillMode: "backwards" }}
        >
          {/* saber edge — brightens while you work in the section */}
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-sith via-saber to-darksith opacity-40 group-hover/section:opacity-100 group-focus-within/section:opacity-100 transition-opacity duration-300"
          />
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-saber/70 tracking-[0.2em] shrink-0">
              {String(si + 1).padStart(2, "0")}
            </span>
            <input
              value={sec.title}
              onChange={(e) => edit((w) => { w.sections[si].title = e.target.value; })}
              placeholder="Section title…"
              className="flex-1 min-w-0 bg-transparent font-display text-lg tracking-[0.2em] uppercase text-star outline-none border-b border-transparent focus:border-saber/40 transition-colors placeholder:text-muted/40"
            />
            <div className="flex items-center gap-1 font-mono text-[10px] shrink-0">
              <button onClick={() => mutate((w) => move(w.sections, si, -1))} disabled={si === 0}
                className="px-2 py-1 rounded border border-border text-muted hover:text-saber hover:border-saber/50 disabled:opacity-30 transition-colors" title="Move section up">▲</button>
              <button onClick={() => mutate((w) => move(w.sections, si, 1))} disabled={si === space.sections.length - 1}
                className="px-2 py-1 rounded border border-border text-muted hover:text-saber hover:border-saber/50 disabled:opacity-30 transition-colors" title="Move section down">▼</button>
              <button onClick={() => mutate((w) => { w.sections.splice(si, 1); })}
                className="px-2 py-1 rounded border border-border text-muted hover:text-titan hover:border-titan/50 transition-colors" title="Remove section (undo available)">✕</button>
            </div>
          </div>

          <div className="space-y-0.5">
            {sec.items.map((it, ii) => {
              const url = it.name.match(/https?:\/\/\S+/)?.[0];
              return (
                <div key={it.id} className="flex items-center gap-3 group relative">
                  <span className="font-mono text-[9px] text-muted/40 w-5 text-right shrink-0 select-none">
                    {String(ii + 1).padStart(2, "0")}
                  </span>
                  <button
                    onClick={() => mutate((w) => { w.sections[si].items.splice(ii, 1); })}
                    title="Got it! — remove from wishlist (undo available)"
                    className="w-5 h-5 shrink-0 rounded-full border border-border/80 flex items-center justify-center text-[10px] text-transparent transition-all duration-200 hover:text-void hover:bg-saber hover:border-saber hover:shadow-[0_0_14px_rgba(255,51,136,0.65)]"
                  >
                    ✓
                  </button>
                  <input
                    value={it.name}
                    onChange={(e) => edit((w) => { w.sections[si].items[ii].name = e.target.value; })}
                    placeholder="Type anything…"
                    className="flex-1 min-w-0 bg-transparent font-ui text-[15px] tracking-wide outline-none border-b border-border/30 focus:border-saber/60 transition-colors py-1.5 text-foreground placeholder:text-muted/40"
                  />
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer"
                       className="text-muted hover:text-saber text-xs shrink-0 transition-colors" title={url}>🔗</a>
                  )}
                  <div className="flex items-center gap-1 font-mono text-[10px] shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => mutate((w) => move(w.sections[si].items, ii, -1))} disabled={ii === 0}
                      className="px-1.5 py-0.5 rounded border border-border text-muted hover:text-saber disabled:opacity-30" title="Move up">▲</button>
                    <button onClick={() => mutate((w) => move(w.sections[si].items, ii, 1))} disabled={ii === sec.items.length - 1}
                      className="px-1.5 py-0.5 rounded border border-border text-muted hover:text-saber disabled:opacity-30" title="Move down">▼</button>
                    <button onClick={() => mutate((w) => { w.sections[si].items.splice(ii, 1); })}
                      className="px-1.5 py-0.5 rounded border border-border text-muted hover:text-titan" title="Remove row (undo available)">✕</button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => mutate((w) => w.sections[si].items.push({ id: uid(), name: "" }))}
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-saber/80 hover:text-saber hover:underline underline-offset-4 transition-colors"
          >
            ＋ add row
          </button>
        </div>
      ))}

      {/* Personal log — terminal scratchpad */}
      <div
        className="panel-cut bg-deepspace/70 border border-border/80 animate-fade-up"
        style={{ animationDelay: `${space.sections.length * 90}ms`, animationFillMode: "backwards" }}
      >
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/60 bg-void/60">
          <span className="font-display text-xs tracking-[0.3em] uppercase text-saber">Scratchpad</span>
          <span className="font-mono text-[9px] tracking-[0.25em] uppercase text-muted">
            personal log // ダースバンカイ
          </span>
        </div>
        <div className="relative">
          <textarea
            value={space.notes ?? ""}
            onChange={(e) => edit((w) => { w.notes = e.target.value; })}
            placeholder="Free space — anything goes. Roll notes, farm plans, reminders…"
            className="w-full min-h-[150px] bg-transparent p-5 font-mono text-[13px] leading-relaxed text-star outline-none resize-y placeholder:text-muted/40"
          />
          <div aria-hidden className="scanlines absolute inset-0 pointer-events-none" />
        </div>
      </div>

      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted/60">
        Everything here is yours to shape — rows are free text, sections are yours to rename,
        reorder, or delete. Changes save automatically{signedIn ? " to your account" : " on this device"}.
      </p>
    </section>
  );
}
