import { useEffect, useMemo, useState } from "react";
import { api, type Item, type UserProfile } from "@/lib/api";
import { Button } from "@/components/ui/button";

// ============================================================
// Constants
// ============================================================

const CLASS_COLOR: Record<string, string> = {
  hunter: "text-hunter",
  titan: "text-titan",
  warlock: "text-warlock",
};

// Slots that contribute to power level (8-slot avg in Bungie's formula)
const POWER_SLOTS = ["Kinetic", "Energy", "Heavy", "Helmet", "Gauntlets",
                     "Chest", "Legs", "Class"];

const TAG_CYCLE: Array<NonNullable<Item["tag"]> | null> = [
  null, "favorite", "keep", "infuse", "junk", "archive",
];
const TAG_LABEL: Record<NonNullable<Item["tag"]>, string> = {
  favorite: "F", keep: "K", infuse: "I", junk: "J", archive: "A",
};
const TAG_STYLE: Record<NonNullable<Item["tag"]>, string> = {
  favorite: "bg-yellow-400 text-void",
  keep:     "bg-emerald-400 text-void",
  infuse:   "bg-amber-500 text-void",
  junk:     "bg-saber text-void",
  archive:  "bg-muted text-void",
};

// ============================================================
// Max-power computation per character
// ============================================================

function maxPowerForClass(items: Item[], charClass: string): number {
  // items eligible: class-neutral ("Any") OR exactly matching this class
  const cls = charClass.charAt(0).toUpperCase() + charClass.slice(1);  // "Warlock"
  const eligible = items.filter(
    (i) => i.power > 0 && (i.class === "Any" || i.class === cls),
  );
  // Highest-power item per power slot
  const perSlot: Record<string, number> = {};
  for (const slot of POWER_SLOTS) perSlot[slot] = 0;
  for (const it of eligible) {
    if (!(it.slot in perSlot)) continue;
    if (it.power > perSlot[it.slot]) perSlot[it.slot] = it.power;
  }
  const vals = Object.values(perSlot).filter((v) => v > 0);
  if (vals.length < POWER_SLOTS.length) return 0;
  return Math.floor(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// ============================================================
// Component
// ============================================================

export default function Dashboard() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeChar, setActiveChar] = useState<string | null>(null);
  const [tagBusy, setTagBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [profile, decorated] = await Promise.all([
          api.me(),
          api.inventoryDecorated(),
        ]);
        setMe(profile);
        decorated.sort((a, b) => (b.power || 0) - (a.power || 0));
        setItems(decorated);
        if (profile.characters?.length) {
          setActiveChar(profile.characters[0].id);
        }
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, []);

  // ---- compute max power per character once items load ----
  const maxPower = useMemo(() => {
    const out: Record<string, number> = {};
    if (!me?.characters) return out;
    for (const ch of me.characters) {
      out[ch.id] = maxPowerForClass(items, ch.class);
    }
    return out;
  }, [items, me]);

  // ---- filter items shown in the grid by selected character ----
  const filtered = useMemo(() => {
    let list = items;
    if (activeChar && me?.characters) {
      const ch = me.characters.find((c) => c.id === activeChar);
      if (ch) {
        const cls = ch.class.charAt(0).toUpperCase() + ch.class.slice(1);
        // Items usable by this character: class-neutral OR matching class.
        // We show vault + this char's gear; hide other characters' gear.
        list = items.filter(
          (i) =>
            (i.class === "Any" || i.class === cls) &&
            !/EQUIPPED|\d{3,}/.test(i.location)
              || (i.location.toLowerCase().startsWith(ch.class.toLowerCase()))
              || i.location === "VAULT",
        );
      }
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q) ||
          i.tag?.toLowerCase().includes(q.replace("#", "")) ||
          i.element.toLowerCase().includes(q),
      );
    }
    return list;
  }, [items, activeChar, search, me]);

  // ---- tag cycling ----
  async function cycleTag(item: Item) {
    if (tagBusy === item.instance_id) return;
    const idx = TAG_CYCLE.indexOf(item.tag ?? null);
    const next = TAG_CYCLE[(idx + 1) % TAG_CYCLE.length];
    setTagBusy(item.instance_id);
    // Optimistic update
    setItems((prev) =>
      prev.map((i) =>
        i.instance_id === item.instance_id
          ? { ...i, tag: next ?? undefined }
          : i,
      ),
    );
    try {
      await api.setTag(item.instance_id, next);
    } catch (e: any) {
      // Roll back on failure
      setItems((prev) =>
        prev.map((i) =>
          i.instance_id === item.instance_id
            ? { ...i, tag: item.tag }
            : i,
        ),
      );
      alert(`Failed to set tag: ${e?.message ?? e}`);
    } finally {
      setTagBusy(null);
    }
  }

  // ============================================================
  // Render
  // ============================================================

  if (err) {
    return (
      <div className="container py-20">
        <h1 className="font-display text-3xl text-saber">Access denied.</h1>
        <p className="mt-4 text-muted font-ui">{err}</p>
        <Button variant="primary" className="mt-6" onClick={() => (location.href = "/")}>
          Back to sign-in
        </Button>
      </div>
    );
  }

  return (
    <div className="container py-10">

      {/* ====================================================
          GUARDIAN HEADER  (DIM-style character cards)
          ==================================================== */}
      <section className="grid md:grid-cols-3 gap-1 bg-border">
        {me?.characters?.length ? (
          me.characters.map((ch) => {
            const isActive = ch.id === activeChar;
            const max = maxPower[ch.id] ?? 0;
            const delta = max - ch.equipped_power;
            return (
              <button
                key={ch.id}
                onClick={() => setActiveChar(ch.id)}
                className={`relative text-left bg-deepspace hover:bg-nebula transition-colors p-5 border-b-2 ${
                  isActive ? "border-sith" : "border-transparent"
                }`}
                style={
                  ch.emblem_background_path
                    ? {
                        backgroundImage: `linear-gradient(90deg, rgba(13,10,20,0.92), rgba(13,10,20,0.6)), url(${ch.emblem_background_path})`,
                        backgroundSize: "cover",
                        backgroundPosition: "right center",
                      }
                    : undefined
                }
              >
                <div className="flex items-center gap-4">
                  {ch.emblem_path && (
                    <img
                      src={ch.emblem_path}
                      alt=""
                      className="w-12 h-12 object-cover border border-darksith"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">
                      {me.characters && ch.class === me.characters[0].class ? "PRIMARY" : ""}
                    </div>
                    <div className={`font-display text-2xl font-black tracking-wide ${CLASS_COLOR[ch.class]}`}>
                      {ch.class.toUpperCase()}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-baseline gap-6">
                  <div>
                    <div className="font-mono text-[9px] tracking-[0.3em] uppercase text-muted">
                      Equipped
                    </div>
                    <div className="font-display text-3xl font-bold text-star">
                      {ch.equipped_power}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] tracking-[0.3em] uppercase text-muted">
                      Max in inventory
                    </div>
                    <div className="font-display text-3xl font-bold text-saber">
                      {max || "—"}
                    </div>
                  </div>
                  {delta > 0 && (
                    <div className="ml-auto">
                      <div className="font-mono text-[9px] tracking-[0.3em] uppercase text-muted">
                        Δ
                      </div>
                      <div className="font-display text-2xl font-bold text-sith">
                        +{delta}
                      </div>
                    </div>
                  )}
                </div>
              </button>
            );
          })
        ) : (
          <div className="bg-deepspace p-5 col-span-3 text-muted font-ui">
            Loading characters…
          </div>
        )}
      </section>

      {/* ====================================================
          IDENTITY STRIP
          ==================================================== */}
      <section className="flex flex-wrap items-end justify-between gap-6 pt-8 pb-8 border-b border-border">
        <div>
          <p className="font-mono text-xs tracking-[0.4em] text-sith uppercase">▸ Guardian</p>
          <h1 className={`font-display text-4xl font-black tracking-wide ${me ? CLASS_COLOR[me.primary_class] : "text-muted"}`}>
            {me?.bungie_name || "Loading…"}
          </h1>
        </div>
        <div className="font-mono text-right">
          <p className="text-[10px] tracking-[0.3em] text-muted uppercase">Total records</p>
          <p className="font-display text-3xl text-sith">{items.length.toLocaleString()}</p>
        </div>
      </section>

      {/* ====================================================
          SEARCH
          ==================================================== */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='QUERY · "crimson" · "void" · "#favorite"'
          className="flex-1 min-w-[20rem] bg-deepspace border border-border px-4 py-3 font-mono text-sm tracking-wider text-star placeholder:text-muted focus:outline-none focus:border-sith focus:ring-1 focus:ring-sith transition-colors"
        />
        {activeChar && (
          <Button variant="outline" size="sm" onClick={() => setActiveChar(null)}>
            Show all classes
          </Button>
        )}
      </div>

      {/* ====================================================
          INVENTORY GRID
          ==================================================== */}
      <section className="mt-6">
        <header className="flex items-center justify-between pb-3 border-b border-border font-mono text-[10px] tracking-[0.25em] uppercase text-muted">
          <span>
            Displaying <strong className="text-sith">{filtered.length.toLocaleString()}</strong> records
            {activeChar && me?.characters && (
              <> · <span className="text-star">
                {me.characters.find(c => c.id === activeChar)?.class.toUpperCase()}
              </span></>
            )}
          </span>
          <span>click a row to cycle its tag · sort by power ↓</span>
        </header>

        <ul className="divide-y divide-border">
          {filtered.map((it) => (
            <li
              key={it.instance_id}
              onClick={() => cycleTag(it)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && cycleTag(it)}
              className="group grid grid-cols-[4px_48px_1fr_120px_60px_36px] items-center gap-4 px-2 py-3 hover:bg-nebula cursor-pointer transition-colors relative overflow-hidden focus:outline-none focus:ring-1 focus:ring-sith focus:bg-nebula"
            >
              <span
                className={`h-12 ${
                  it.isExotic
                    ? "bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.6)]"
                    : it.tier === "Legendary"
                    ? "bg-warlock"
                    : it.tier === "Rare"
                    ? "bg-hunter"
                    : "bg-muted"
                }`}
              />
              {it.iconUrl ? (
                <img
                  src={it.iconUrl}
                  alt=""
                  loading="lazy"
                  className={`w-12 h-12 object-cover border ${
                    it.isExotic ? "border-yellow-400" : "border-darksith"
                  }`}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="w-12 h-12 border border-dashed border-darksith opacity-50" />
              )}
              <div className="min-w-0">
                <div
                  className={`font-display text-base font-bold tracking-wide truncate ${
                    it.isExotic ? "text-signature" : "text-star"
                  }`}
                >
                  {it.name}
                </div>
                <div className="font-mono text-[10px] tracking-wider text-muted uppercase mt-1 truncate">
                  {it.type || "—"} · {it.element || "—"} · {it.slot || "—"}
                </div>
              </div>
              <div className="font-mono text-[10px] tracking-wider text-muted uppercase text-right truncate">
                {it.location}
              </div>
              <div className="font-display text-lg text-saber text-right">
                {it.power || ""}
              </div>
              <div className="flex justify-center">
                {it.tag ? (
                  <span className={`w-6 h-6 grid place-items-center font-mono text-xs font-bold ${TAG_STYLE[it.tag]} ${tagBusy === it.instance_id ? "opacity-50" : ""}`}>
                    {TAG_LABEL[it.tag]}
                  </span>
                ) : (
                  <span className="w-6 h-6 border border-dashed border-border opacity-50 group-hover:opacity-100" />
                )}
              </div>
            </li>
          ))}
        </ul>

        {filtered.length === 0 && (
          <p className="mt-12 text-center font-mono text-muted text-sm tracking-wider uppercase">
            {items.length === 0
              ? "Loading inventory…"
              : "No items match the current filter."}
          </p>
        )}
      </section>

      <p className="mt-12 font-mono text-[9px] tracking-[0.3em] uppercase text-muted text-center">
        click any row to cycle its tag · none → favorite → keep → infuse → junk → archive
      </p>
    </div>
  );
}
