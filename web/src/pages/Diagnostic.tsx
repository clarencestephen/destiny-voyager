import { useEffect, useState } from "react";
import { api, STAT_KEYS, STAT_LABEL, ARMOR_ARCHETYPES, type Item } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Diagnostic — verifies that /api/inventory is returning armor stats +
 * archetypes + set names correctly. Use when something looks wrong on
 * /optimizer or /play.
 */
export default function Diagnostic() {
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setErr(null);
    setRunning(true);
    try {
      const list = await api.inventoryDecorated();
      setItems(list);
    } catch (e: any) {
      setErr(e?.message ?? "fetch failed");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => { run(); }, []);

  if (err) {
    return (
      <section className="container py-10 max-w-3xl">
        <h1 className="font-display text-2xl text-saber">Diagnostic</h1>
        <p className="text-red-400 font-ui mt-4">⚠ {err}</p>
        <p className="text-muted font-ui mt-2 text-sm">
          (If this says "not_signed_in", visit /play or /dashboard and sign in with Bungie first.)
        </p>
      </section>
    );
  }

  // --- aggregates ---
  const total = items.length;
  const armorAll = items.filter(
    (i) => ["Helmet", "Gauntlets", "Chest", "Legs", "Class"].includes(i.slot),
  );
  const armorWithStats = armorAll.filter(
    (i) =>
      i.stats &&
      (i.stats.weapons + i.stats.health + i.stats.class +
       i.stats.grenade + i.stats.super + i.stats.melee) > 0,
  );
  const armorWithArchetype = armorAll.filter((i) => !!i.archetype);
  const armorWithSet = armorAll.filter((i) => !!i.set);

  const byArchetype: Record<string, number> = {};
  for (const it of armorWithArchetype) {
    byArchetype[it.archetype] = (byArchetype[it.archetype] ?? 0) + 1;
  }

  const sampleArmor = armorWithStats.slice(0, 5);

  // --- render ---
  return (
    <section className="container py-10 flex flex-col gap-6 max-w-4xl">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">
            ▲ Inventory + Stats Health Check
          </span>
          <h1 className="font-display text-3xl tracking-[0.18em] font-black text-signature">DIAGNOSTIC</h1>
        </div>
        <Button onClick={run} disabled={running}>{running ? "Refreshing…" : "Refresh"}</Button>
      </header>

      <Card className="p-5 space-y-2 font-mono text-sm">
        <Row label="Total items returned" value={total} />
        <Row label="Armor pieces (Helmet/Gauntlets/Chest/Legs/Class)" value={armorAll.length} />
        <Row
          label="Armor pieces WITH non-zero stats"
          value={`${armorWithStats.length} / ${armorAll.length}`}
          good={armorWithStats.length > 0}
        />
        <Row
          label="Armor pieces WITH archetype label"
          value={`${armorWithArchetype.length} / ${armorAll.length}`}
          good={armorWithArchetype.length > 0}
        />
        <Row
          label="Armor pieces WITH set / theme name"
          value={`${armorWithSet.length} / ${armorAll.length}`}
          good={armorWithSet.length > 0}
        />
      </Card>

      {/* Archetype distribution */}
      {Object.keys(byArchetype).length > 0 && (
        <Card className="p-5">
          <div className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted mb-2">
            Archetype distribution
          </div>
          <div className="flex flex-wrap gap-2 font-ui text-xs">
            {ARMOR_ARCHETYPES.map((a) => (
              <span
                key={a}
                className={`px-2 py-1 rounded border ${
                  byArchetype[a] ? "border-fuchsia-400/60 text-fuchsia-300" : "border-border text-muted"
                }`}
              >
                {a}: {byArchetype[a] ?? 0}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Sample armor pieces with stats — confirms shape end-to-end */}
      <Card className="p-5">
        <div className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted mb-3">
          Sample armor (first 5 with non-zero stats)
        </div>
        {sampleArmor.length === 0 ? (
          <p className="font-ui text-sm text-red-400">
            ⚠ No armor with non-zero stats. /api/inventory returned items but the stats
            block is empty. Likely: Worker isn't fetching component 304 properly, OR
            the stat hash mapping is wrong.
          </p>
        ) : (
          <div className="space-y-2 font-ui text-sm">
            {sampleArmor.map((it) => (
              <div key={it.instance_id} className="border border-border rounded p-2">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium">{it.name}</span>
                  <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted">{it.slot}</span>
                  {it.archetype && (
                    <span className="font-mono text-[9px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded border border-fuchsia-400/40 text-fuchsia-300">
                      {it.archetype}
                    </span>
                  )}
                  {it.set && (
                    <span className="font-mono text-[9px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded border border-saber/40 text-saber/80">
                      {it.set}
                    </span>
                  )}
                  <span className="text-muted text-xs ml-auto">pw {it.power}</span>
                </div>
                <div className="mt-1 grid grid-cols-3 md:grid-cols-6 gap-2 font-mono text-[10px]">
                  {STAT_KEYS.map((k) => (
                    <span key={k} className={`px-1.5 py-0.5 rounded border ${
                      (it.stats?.[k] ?? 0) > 0
                        ? "border-saber/40 text-saber"
                        : "border-border text-muted/60"
                    }`}>
                      {STAT_LABEL[k]}: {it.stats?.[k] ?? 0}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted text-center">
        If the green numbers above match your DIM export, stats are flowing correctly.
      </p>
    </section>
  );
}

function Row({ label, value, good }: { label: string; value: string | number; good?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={good === true ? "text-emerald-400" : good === false ? "text-red-400" : ""}>
        {value}
      </span>
    </div>
  );
}
