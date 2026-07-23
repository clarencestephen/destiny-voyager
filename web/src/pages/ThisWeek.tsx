import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api, loadManifest, decorate,
  type LeanItem, type Item, type SlimManifest,
} from "@/lib/api";
import { Card } from "@/components/ui/card";

/**
 * /this-week/:section? — Kyber-Community-parity weekly rotation surface.
 *
 * Routed sections (each a nav-dropdown destination, all auto-flip at the
 * Tuesday 17:00 UTC reset because the data is live Bungie API, KV-cached):
 *   rotation  — featured raid + dungeon BY NAME (public milestones →
 *               activity hashes → /activities.json bake) + all milestones
 *   xur       — Xûr's inventory (Fri–Tue)
 *   eververse — weekly Bright-Dust stock (Silver toggle)
 *   vendors   — Ada-1 · Banshee-44 · Rahool
 *   news      — latest Bungie RSS (TWIDs / patches)
 */

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
  activity_hashes?: number[];
  resolved_names?: string[];
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

/** Baked activity-name lookup (scripts/bake-activities.mjs). */
type ActivityNames = Record<string, { n: string; t: string }>;

const SECTIONS = [
  { key: "rotation",  label: "Rotation" },
  { key: "xur",       label: "Xûr" },
  { key: "eververse", label: "Eververse" },
  { key: "vendors",   label: "Vendors" },
  { key: "news",      label: "News" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

// Which vendor cards each section shows.
const VENDOR_SLICE: Record<string, string[]> = {
  xur: ["xur"],
  eververse: ["eververse"],
  vendors: ["ada1", "banshee", "rahool"],
};

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

const CURRENCY_NAMES: Record<number, string> = {
  3159615086: "Glimmer",
  800069450:  "Legendary Shard",
  2817410917: "Bright Dust",
  3147280338: "Silver",
  1022552290: "Legendary Shards",
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

/** Next weekly reset — Tuesday 17:00 UTC. */
function nextReset(): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0, 0));
  while (d.getUTCDay() !== 2 || d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Next daily reset — every day 17:00 UTC (Eververse daily stock, Lost
 *  Sector, Vex Incursion zone, etc. flip on this cadence). */
function nextDailyReset(): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0, 0));
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Milestones that rotate DAILY, not weekly. */
const DAILY_KEYS = new Set(["lost-sector", "vex-incursion"]);

/** Milestone → deduped base activity names: server-resolved names first
 *  (rotations the public API dropped), then hash resolution via
 *  /activities.json ("Duality: Master" + "Duality: Standard" → "Duality"). */
function featuredNames(m: ActivityWeekRaw | undefined, acts: ActivityNames | null): string[] {
  const base = new Set<string>(m?.resolved_names ?? []);
  for (const h of m?.activity_hashes ?? []) {
    const e = acts?.[String(h)];
    if (e?.n) base.add(e.n.split(":")[0].trim());
  }
  return [...base];
}

export default function ThisWeek() {
  const params = useParams();
  const section: SectionKey = (SECTIONS.some((s) => s.key === params.section)
    ? params.section
    : "rotation") as SectionKey;

  const [data, setData] = useState<ThisWeekResponseRaw | null>(null);
  const [manifest, setManifest] = useState<SlimManifest | null>(null);
  const [acts, setActs] = useState<ActivityNames | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSilver, setShowSilver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/activities.json").then((r) => r.json()).then((a) => !cancelled && setActs(a)).catch(() => {});
    Promise.all([
      fetch("/api/this-week", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error(r.status === 401 ? "Sign in with Bungie to see this week's stock." : `/api/this-week: HTTP ${r.status}`);
        return r.json();
      }),
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
    // Guard the shape — an unexpected API body must degrade, not white-screen.
    if (!data?.vendors || !manifest) return [];
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

  const resetIn = formatRefresh(Math.floor((nextReset().getTime() - Date.now()) / 1000));
  const dailyIn = formatRefresh(Math.floor((nextDailyReset().getTime() - Date.now()) / 1000));

  const milestones = data.milestones || [];
  const raidWeek = milestones.find((m) => m.activity === "raid-challenge");
  const dungeonWeek = milestones.find((m) => m.activity === "dungeon-rotator");
  const raidNames = featuredNames(raidWeek, acts);
  const dungeonNames = featuredNames(dungeonWeek, acts);

  const vendorKeys = VENDOR_SLICE[section];
  const vendorsToShow = vendorKeys
    ? decorated.filter((v) => vendorKeys.includes(v.vendor))
    : [];

  return (
    <div className="p-8 font-ui">
      <header className="mb-6">
        <h1 className="text-3xl font-display tracking-wider text-star">This Week</h1>
        <p className="text-xs uppercase tracking-[0.22em] text-muted">
          Live Bungie data ·{" "}
          <span className="text-saber">weekly resets in {resetIn}</span> ·{" "}
          <span className="text-star">daily resets in {dailyIn}</span>{" "}
          <span className="normal-case tracking-normal">(Eververse dailies · Lost Sector · Vex Incursion)</span>
        </p>
      </header>

      <nav className="flex items-center gap-2 mb-6 border-b border-void overflow-x-auto">
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            to={`/this-week/${s.key}`}
            className={
              "px-4 py-2 text-xs uppercase tracking-[0.22em] whitespace-nowrap transition-colors " +
              (section === s.key
                ? "text-saber border-b-2 border-saber -mb-px"
                : "text-muted hover:text-star")
            }
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {section === "rotation" && (
      <section className="space-y-6">
        {/* Featured raid + dungeon — the headline answer, BY NAME */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            { title: "Featured Raids", names: raidNames, m: raidWeek },
            { title: "Featured Dungeons", names: dungeonNames, m: dungeonWeek },
          ].map(({ title, names, m }) => (
            <Card key={title} className="p-6 relative overflow-hidden">
              <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-sith via-saber to-darksith opacity-70" />
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted mb-2">▲ {title} · lockout removed</p>
              {names.length > 0 ? (
                <div className="flex flex-wrap gap-2 mb-3">
                  {names.map((n) => (
                    <span key={n} className="px-3 py-1.5 rounded border border-saber/60 bg-saber/10 font-display text-lg tracking-wider text-star">
                      {n}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted mb-3">
                  {m?.available === false ? "Off-rotation this week." : "Names unavailable — rotation data missing."}
                </p>
              )}
              {m?.end_time && (
                <p className="text-[11px] text-muted">
                  farmable until {new Date(m.end_time).toLocaleString()}
                </p>
              )}
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {milestones.map((a) => (
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
                {a.category} ·{" "}
                <span className={DAILY_KEYS.has(a.activity) ? "text-star" : ""}>
                  {DAILY_KEYS.has(a.activity) ? "rotates daily" : "weekly"}
                </span>
              </p>
              {(() => {
                const names = featuredNames(a, acts);
                return names.length > 0 && (
                  <p className="text-sm text-star mb-1">{names.slice(0, 6).join(" · ")}</p>
                );
              })()}
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

      {vendorKeys && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {vendorsToShow.length === 0 && (
          <p className="text-sm text-muted">Vendor data unavailable right now.</p>
        )}
        {vendorsToShow.map((v) => {
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
                {items.slice(0, section === "xur" || section === "eververse" ? 40 : 12).map((it) => (
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
          </Card>
          );
        })}
      </div>
      )}

      {section === "news" && (
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
        Live from the Bungie API — vendors cached 60min · activities 15min · news 6h.
        Weekly rotation flips Tuesday 17:00 UTC; Eververse daily stock, Lost Sector, and
        Vex Incursion flip every day at 17:00 UTC (worst-case one cache cycle behind).
      </footer>
    </div>
  );
}
