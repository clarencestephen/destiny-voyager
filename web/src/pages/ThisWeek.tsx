import { useEffect, useState } from "react";
import {
  api, loadManifest, decorate,
  type LeanItem, type Item, type SlimManifest,
} from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * /this-week — Kyber-Community-parity weekly rotation surface.
 *
 * Calls GET /api/this-week (which aggregates Xur / Ada-1 / Banshee /
 * Rahool / Eververse via the Bungie Vendor API, KV-cached per-user).
 * Decorates each vendor's items client-side using the slim manifest
 * already loaded by the rest of the app.
 *
 * Phase 1+2 scope: vendors only. Phase 3 will add Milestones (raid
 * challenge / Trials / IB / lost sector). Phase 4 will add TWID + a
 * multi-tab layout.
 */

// Shape returned by /api/this-week — mirrors VendorWeek + ThisWeekResponse
// in worker/src/this-week.ts. Items carry only `hash` from the server;
// name/type/tier/icon are decorated client-side via the slim manifest.
interface VendorItemRaw {
  hash: number;
  cost?: Array<{ currency_hash: number; quantity: number }>;
}
interface VendorWeekRaw {
  vendor: string;
  display_name: string;
  available: boolean;
  location?: { name: string; planet: string };
  refresh_in_seconds: number;
  items: VendorItemRaw[];
  notes?: string;
}
interface ThisWeekResponseRaw {
  vendors: Record<string, VendorWeekRaw | null>;
  generated_at: string;
}

interface DecoratedVendorItem extends Item {
  cost?: Array<{ currency_hash: number; quantity: number; currency_name: string }>;
}

interface DecoratedVendor {
  vendor: string;
  display_name: string;
  available: boolean;
  location?: { name: string; planet: string };
  refresh_in_seconds: number;
  items: DecoratedVendorItem[];
  notes?: string;
}

// Common currency hashes — Bungie's manifest entries for them. Hard-
// coded fallback when manifest lookup misses (these are stable since
// D2 launch).
const CURRENCY_NAMES: Record<number, string> = {
  3159615086: "Glimmer",
  800069450:  "Legendary Shard",
  2817410917: "Bright Dust",
  3147280338: "Silver",
  1022552290: "Legendary Shards",  // alt hash
  44811435:   "Spoils of Conquest",
};

function formatRefresh(seconds: number): string {
  if (seconds <= 0) return "any moment";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ThisWeek() {
  const [data, setData] = useState<ThisWeekResponseRaw | null>(null);
  const [manifest, setManifest] = useState<SlimManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch("/api/this-week", { credentials: "include" }).then((r) => r.json()),
      loadManifest(),
    ])
      .then(([raw, m]) => {
        if (cancelled) return;
        setData(raw);
        setManifest(m);
      })
      .catch((e) => !cancelled && setError(String(e?.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const decorated: DecoratedVendor[] = (() => {
    if (!data || !manifest) return [];
    return Object.values(data.vendors)
      .filter((v): v is VendorWeekRaw => v !== null)
      .map((v) => ({
        ...v,
        items: v.items.map((it) => {
          const lean: LeanItem = {
            instance_id: `vendor-${v.vendor}-${it.hash}`,
            hash: it.hash,
            power: 0,
            location: "vendor",
          };
          const dec = decorate(lean, manifest);
          const costs = (it.cost ?? []).map((c) => ({
            ...c,
            currency_name:
              CURRENCY_NAMES[c.currency_hash] ??
              manifest[String(c.currency_hash)]?.n ??
              "?",
          }));
          return { ...dec, cost: costs };
        }),
      }));
  })();

  if (loading) return <div className="p-8 font-ui text-muted">Loading this week…</div>;
  if (error)   return <div className="p-8 font-ui text-rebel">Error: {error}</div>;
  if (!data)   return <div className="p-8 font-ui text-muted">No data.</div>;

  return (
    <div className="p-8 font-ui">
      <header className="mb-8">
        <h1 className="text-3xl font-display tracking-wider text-star">This Week</h1>
        <p className="text-xs uppercase tracking-[0.22em] text-muted">
          Weekly vendor rotations · cached 60min ·{" "}
          generated {new Date(data.generated_at).toLocaleTimeString()}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {decorated.map((v) => (
          <Card key={v.vendor} className="p-6">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-xl font-display text-saber">{v.display_name}</h2>
              {v.available ? (
                <span className="text-[10px] uppercase text-muted tracking-wider">
                  refresh in {formatRefresh(v.refresh_in_seconds)}
                </span>
              ) : (
                <span className="text-[10px] uppercase text-rebel tracking-wider">
                  unavailable
                </span>
              )}
            </div>

            {v.location && (
              <p className="text-xs text-muted mb-3">
                📍 {v.location.name} · {v.location.planet}
              </p>
            )}

            {v.notes && <p className="text-xs italic text-muted mb-3">{v.notes}</p>}

            {!v.available && (
              <p className="text-sm text-muted">
                Returns in {formatRefresh(v.refresh_in_seconds)}.
              </p>
            )}

            {v.available && v.items.length === 0 && (
              <p className="text-sm text-muted">No items in current rotation.</p>
            )}

            {v.available && v.items.length > 0 && (
              <ul className="space-y-2 mt-3">
                {v.items.slice(0, 12).map((it) => (
                  <li key={it.instance_id} className="flex items-center gap-3 text-sm">
                    {it.iconUrl && (
                      <img
                        src={it.iconUrl}
                        alt=""
                        className="w-10 h-10 rounded border border-void"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="truncate">
                        <span className={
                          it.tier === "Exotic"    ? "text-rebel" :
                          it.tier === "Legendary" ? "text-saber" :
                          "text-star"
                        }>
                          {it.name || `#${it.hash}`}
                        </span>
                        {it.type && <span className="text-muted text-xs ml-2">{it.type}</span>}
                      </div>
                      {it.cost && it.cost.length > 0 && (
                        <div className="text-[11px] text-muted">
                          {it.cost.map((c) =>
                            `${c.quantity.toLocaleString()} ${c.currency_name}`).join(" + ")}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {v.items.length > 12 && (
              <p className="text-[11px] text-muted mt-2">
                +{v.items.length - 12} more items (full list in /this-week/{v.vendor})
              </p>
            )}
          </Card>
        ))}
      </div>

      <footer className="mt-8 text-[11px] text-muted">
        Phase 1+2 surface (vendors only). Milestones, Trials, Lost Sector,
        and TWID land in future updates — see THIS_WEEK_PLAN.md.
      </footer>
    </div>
  );
}
