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
 * Calls GET /api/this-week which aggregates:
 *   • Vendors (Xur / Ada-1 / Banshee / Rahool / Eververse) — Phase 1+2
 *   • Milestones (raid challenge / Trials / IB / Lost Sector / etc.) — Phase 3
 *   • News (latest 5 Bungie RSS items — TWIDs / patches / season launches) — Phase 4
 *
 * Three-tab layout. Vendor items are decorated client-side using the
 * slim manifest already loaded by the rest of the app.
 */

// Shape returned by /api/this-week — mirrors VendorWeek + ThisWeekResponse
// in worker/src/this-week.ts. Items carry only `hash` from the server;
// name/type/tier/icon are decorated client-side via the slim manifest.
interface VendorItemRaw {
  hash: number;
  cost?: Array<{ currency_hash: number; quantity: number }>;
  bright_dust?: boolean;
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
interface ActivityWeekRaw {
  activity: string;
  display_name: string;
  category: string;
  description: string;
  rewards: string[];
  end_time?: string;
  available: boolean;
  notes?: string;
}

interface TWIDPostRaw {
  title: string;
  url: string;
  pub_date: string;
  category: "twid" | "patch" | "season" | "news";
  summary: string;
}

interface ThisWeekResponseRaw {
  vendors: Record<string, VendorWeekRaw | null>;
  milestones: ActivityWeekRaw[];
  news: TWIDPostRaw[];
  generated_at: string;
}

type Tab = "vendors" | "activities" | "news";

interface DecoratedVendorItem extends Item {
  cost?: Array<{ currency_hash: number; quantity: number; currency_name: string }>;
  bright_dust?: boolean;
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
  const [tab, setTab] = useState<Tab>("vendors");
  // Eververse returns hundreds of Silver-only items; default to the
  // weekly Bright-Dust featured stock and let the user opt into Silver.
  const [showSilver, setShowSilver] = useState(false);

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
          return { ...dec, cost: costs, bright_dust: it.bright_dust };
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

      <nav className="flex items-center gap-2 mb-6 border-b border-void">
        {(["vendors", "activities", "news"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "px-4 py-2 text-xs uppercase tracking-[0.22em] transition-colors " +
              (tab === t
                ? "text-saber border-b-2 border-saber -mb-px"
                : "text-muted hover:text-star")
            }
          >
            {t}
            {t === "vendors" && ` (${decorated.length})`}
            {t === "activities" && ` (${(data.milestones || []).length})`}
            {t === "news" && ` (${(data.news || []).length})`}
          </button>
        ))}
      </nav>

      {tab === "vendors" && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {decorated.map((v) => {
          // Eververse: default to the weekly Bright-Dust featured stock
          // (hide the hundreds of permanent Silver-only items) unless the
          // user toggles Silver on. Other vendors show everything.
          const isEververse = v.vendor === "eververse";
          const silverCount = isEververse
            ? v.items.filter((it) => !it.bright_dust).length
            : 0;
          const items =
            isEververse && !showSilver
              ? v.items.filter((it) => it.bright_dust)
              : v.items;
          return (
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

            {isEververse && silverCount > 0 && (
              <button
                onClick={() => setShowSilver((s) => !s)}
                className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-saber border border-void rounded px-2 py-1 transition-colors"
              >
                {showSilver ? "Showing all" : "Bright Dust only"} ·{" "}
                {showSilver ? "hide" : `+${silverCount}`} Silver
              </button>
            )}

            {!v.available && (
              <p className="text-sm text-muted">
                Returns in {formatRefresh(v.refresh_in_seconds)}.
              </p>
            )}

            {v.available && items.length === 0 && (
              <p className="text-sm text-muted">
                {isEververse && !showSilver
                  ? "No Bright-Dust items this week. Toggle Silver to see the rest."
                  : "No items in current rotation."}
              </p>
            )}

            {v.available && items.length > 0 && (
              <ul className="space-y-2 mt-3">
                {items.slice(0, 12).map((it) => (
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

            {items.length > 12 && (
              <p className="text-[11px] text-muted mt-2">
                +{items.length - 12} more items (full list in /this-week/{v.vendor})
              </p>
            )}
          </Card>
          );
        })}
      </div>
      )}

      {tab === "activities" && (
      <section>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data.milestones || []).map((a) => (
            <Card key={a.activity} className="p-4">
              <div className="flex items-baseline justify-between mb-1">
                <h3 className="text-base font-display text-saber">{a.display_name}</h3>
                <span
                  className={`text-[10px] uppercase tracking-wider ${
                    a.available ? "text-star" : "text-muted"
                  }`}
                >
                  {a.available ? "active" : "off-rotation"}
                </span>
              </div>
              <p className="text-[11px] uppercase tracking-widest text-muted mb-2">
                {a.category}
              </p>
              <p className="text-sm text-fg mb-2">{a.description}</p>
              {a.rewards.length > 0 && (
                <ul className="text-xs text-muted mb-2 space-y-0.5">
                  {a.rewards.map((r, i) => (
                    <li key={i}>· {r}</li>
                  ))}
                </ul>
              )}
              {a.notes && <p className="text-[11px] italic text-muted">{a.notes}</p>}
              {a.end_time && (
                <p className="text-[10px] text-muted mt-1">
                  ends {new Date(a.end_time).toLocaleString()}
                </p>
              )}
            </Card>
          ))}
        </div>
      </section>
      )}

      {tab === "news" && (
      <section className="space-y-4">
        {(data.news || []).length === 0 && (
          <p className="text-sm text-muted">No news items loaded. Check back later.</p>
        )}
        {(data.news || []).map((post, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-baseline justify-between mb-1">
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base font-display text-saber hover:text-star"
              >
                {post.title} ↗
              </a>
              <span className="text-[10px] uppercase tracking-wider text-muted">
                {post.category}
              </span>
            </div>
            {post.pub_date && (
              <p className="text-[11px] text-muted mb-2">
                {new Date(post.pub_date).toLocaleDateString()}
              </p>
            )}
            <p className="text-sm text-fg">{post.summary}</p>
          </Card>
        ))}
      </section>
      )}

      <footer className="mt-8 text-[11px] text-muted">
        Phase 1+2+3+4 surface: vendors (60min cache) · activities (15min) ·
        news (6h). See THIS_WEEK_PLAN.md for the channel map.
      </footer>
    </div>
  );
}
