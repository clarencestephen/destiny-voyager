import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  api, type CharacterSummary, type Item, type UserProfile,
} from "@/lib/api";
import {
  loadBuilds, fitBuild, type BuildTemplate, type BuildFit, type FitSlotStatus,
} from "@/lib/builds";
import {
  loadRecipes, matchRecipes, rolesFromRecipes,
  type WeaponRecipe, type RecipeFit, type RecipeSlotStatus,
} from "@/lib/recipes";
import {
  RAIDS, DUNGEONS, STRIKES,
  PVP_MODES, PVP_MODE_LABEL,
  CUSTOM_CHALLENGES, CUSTOM_CHALLENGE_LABEL,
  type Activity, type PvEMode, type PvPMode, type CustomChallenge, type Situation,
} from "@/lib/situation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const CLASS_COLOR: Record<string, string> = {
  hunter: "text-hunter",
  titan:  "text-titan",
  warlock:"text-warlock",
};

const PVE_MODE_LABEL: Record<PvEMode, string> = {
  "raid": "Raid",
  "dungeon": "Dungeon",
  "strike": "Strike / Nightfall",
  "playlist-ops": "Playlist Ops",
  "add-clear": "Add-clear",
  "gm": "Grandmaster",
};

// ============================================================
// Page
// ============================================================

export default function Play() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [builds, setBuilds] = useState<BuildTemplate[]>([]);
  const [recipes, setRecipes] = useState<WeaponRecipe[]>([]);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeCharId, setActiveCharId] = useState<string | null>(null);
  const [situation, setSituation] = useState<Situation | null>(null);

  // ---- load on mount ----
  useEffect(() => {
    (async () => {
      try {
        const [profile, decorated, b, r] = await Promise.all([
          api.me().catch(() => null),
          api.inventoryDecorated().catch(() => [] as Item[]),
          loadBuilds(),
          loadRecipes().catch(() => ({ recipes: [] } as any)),
        ]);
        if (profile) setMe(profile);
        setItems(decorated);
        setBuilds(b.builds);
        setRecipes(r.recipes ?? []);
        if (profile?.characters?.length) {
          const cached = localStorage.getItem("dv_active_char");
          const found = profile.characters.find((c) => c.id === cached);
          setActiveCharId(found ? found.id : profile.characters[0].id);
        }
      } catch (e: any) {
        setErr(`Load failed: ${e?.message ?? e}`);
      }
    })();
  }, []);

  const activeChar = useMemo(
    () => me?.characters?.find((c) => c.id === activeCharId) ?? null,
    [me, activeCharId],
  );
  const activeClass = useMemo(() => {
    if (!activeChar) return null;
    return activeChar.class.charAt(0).toUpperCase() + activeChar.class.slice(1);
  }, [activeChar]);

  // ---- compute fits for current situation ----
  const ranked = useMemo(() => {
    if (!situation || !builds.length || !items.length || !activeClass) return [];
    const eligible = builds.filter((b) => b.class === activeClass || b.class === "Any");
    const withFit = eligible.map((b) => fitBuild(b, items));
    withFit.sort((a, b) => b.fitPct - a.fitPct);
    return withFit;
  }, [builds, items, activeClass, situation]);

  // ---- weapon recipes matching the (raid, encounter [, role]) ----
  const matchingRecipes = useMemo<RecipeFit[]>(() => {
    if (!situation || !recipes.length) return [];
    if (!situation.pveActivity) return [];
    return matchRecipes(recipes, items, {
      raid: situation.pveActivity,
      encounter: situation.encounter,
      role: roleFilter ?? undefined,
    });
  }, [situation, recipes, items, roleFilter]);

  /** Roles available for the currently-picked (raid, encounter). */
  const availableRoles = useMemo<string[]>(() => {
    if (!situation?.pveActivity) return [];
    const subset = recipes.filter((r) =>
      r.raid === situation.pveActivity &&
      (!situation.encounter || r.encounter === situation.encounter)
    );
    return rolesFromRecipes(subset);
  }, [recipes, situation]);

  function pickCharacter(id: string) {
    setActiveCharId(id);
    localStorage.setItem("dv_active_char", id);
  }

  function resetWizard() {
    setSituation(null);
    setRoleFilter(null);
  }

  // ---- render ----
  return (
    <section className="container py-10 flex flex-col gap-6 max-w-6xl">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">
          ▲ Situational Loadout Picker
        </span>
        <h1 className="font-display text-3xl tracking-[0.18em] font-black text-signature">
          PLAY
        </h1>
        <p className="font-ui text-sm text-muted-foreground max-w-2xl">
          Pick what you're about to do, get the buildable loadout you already own. Tap{" "}
          <span className="text-saber">Equip</span> to send it straight to your guardian.
        </p>
      </header>

      {err && <div className="text-red-400 text-xs font-ui">⚠ {err}</div>}

      {/* Guardian picker — drives both the class filter AND the equip target */}
      {me?.characters && me.characters.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
            <span className="text-muted w-20">Guardian:</span>
            {me.characters.map((ch) => (
              <button
                key={ch.id}
                onClick={() => pickCharacter(ch.id)}
                className={`px-3 py-1 rounded border transition-colors ${
                  activeCharId === ch.id
                    ? `${CLASS_COLOR[ch.class]} border-current`
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {ch.class} · pw {ch.equipped_power}
              </button>
            ))}
          </div>
        </Card>
      )}

      {!me && (
        <Card className="p-6 border-saber/30">
          <h3 className="font-display text-lg font-bold tracking-wide text-saber mb-2">
            Sign in for personalized picks
          </h3>
          <p className="font-ui text-sm text-muted-foreground mb-4">
            Link your Bungie account so we can recommend only builds you can actually equip.
          </p>
          <Button onClick={async () => { const { url } = await api.authUrl(); location.href = url; }}>
            Sign in with Bungie
          </Button>
        </Card>
      )}

      {/* Wizard — either picking, or showing results */}
      {!situation && (
        <Wizard onPick={setSituation} />
      )}

      {situation && (
        <Results
          situation={situation}
          ranked={ranked}
          recipeFits={matchingRecipes}
          availableRoles={availableRoles}
          roleFilter={roleFilter}
          onRoleFilterChange={setRoleFilter}
          activeCharId={activeCharId}
          characters={me?.characters ?? []}
          loaded={!!me}
          onReset={resetWizard}
        />
      )}
    </section>
  );
}

// ============================================================
// Wizard (progressive disclosure)
// ============================================================

function Wizard({ onPick }: { onPick: (s: Situation) => void }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  // PvE branch
  const [pveMode, setPveMode] = useState<PvEMode | null>(null);
  const [pveActivity, setPveActivity] = useState<string | null>(null);
  const [encounter, setEncounter] = useState<string | null>(null);

  const activities: ActivityEntry[] | null = useMemo(() => {
    if (pveMode === "raid") return RAIDS;
    if (pveMode === "dungeon") return DUNGEONS;
    if (pveMode === "strike" || pveMode === "gm") return STRIKES;
    return null;
  }, [pveMode]);

  const encounterOptions = useMemo(() => {
    if (!activities || !pveActivity) return [] as string[];
    const e = activities.find((a) => a.name === pveActivity);
    return e?.encounters ?? [];
  }, [activities, pveActivity]);

  function reset() {
    setActivity(null);
    setPveMode(null);
    setPveActivity(null);
    setEncounter(null);
  }

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg tracking-wide">Pick a situation</h2>
        {activity && (
          <button onClick={reset} className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted hover:text-saber">
            ← reset
          </button>
        )}
      </div>

      {/* Step 1 — activity */}
      <Row label="Activity">
        {(["PvE", "PvP", "Custom"] as const).map((a) => (
          <Chip key={a} active={activity === a} onClick={() => { reset(); setActivity(a); }}>
            {a}
          </Chip>
        ))}
      </Row>

      {/* Step 2a — PvE mode */}
      {activity === "PvE" && (
        <Row label="Mode">
          {(["raid", "dungeon", "strike", "gm", "playlist-ops", "add-clear"] as PvEMode[]).map((m) => (
            <Chip
              key={m}
              active={pveMode === m}
              onClick={() => { setPveMode(m); setPveActivity(null); setEncounter(null); }}
            >
              {PVE_MODE_LABEL[m]}
            </Chip>
          ))}
        </Row>
      )}

      {/* Step 2b — PvP mode */}
      {activity === "PvP" && (
        <Row label="Mode">
          {PVP_MODES.map((m) => (
            <Chip key={m} onClick={() => onPick({ activity: "PvP", pvpMode: m })}>
              {PVP_MODE_LABEL[m]}
            </Chip>
          ))}
        </Row>
      )}

      {/* Step 2c — Custom challenge */}
      {activity === "Custom" && (
        <Row label="Challenge">
          {CUSTOM_CHALLENGES.map((c) => (
            <Chip key={c} onClick={() => onPick({ activity: "Custom", challenge: c })}>
              {CUSTOM_CHALLENGE_LABEL[c]}
            </Chip>
          ))}
        </Row>
      )}

      {/* Step 3 — specific activity (raid/dungeon/strike) */}
      {activity === "PvE" && activities && (
        <Row label={pveMode === "raid" ? "Raid" : pveMode === "dungeon" ? "Dungeon" : "Strike"}>
          {activities.map((e) => {
            // Modes WITHOUT encounter selection commit immediately
            const hasEncounters = e.encounters.length > 0;
            return (
              <Chip
                key={e.name}
                active={pveActivity === e.name}
                onClick={() => {
                  if (!hasEncounters) {
                    onPick({
                      activity: "PvE",
                      pveMode: pveMode!,
                      pveActivity: e.name,
                    });
                    return;
                  }
                  setPveActivity(e.name);
                  setEncounter(null);
                }}
              >
                {e.name}
              </Chip>
            );
          })}
        </Row>
      )}

      {/* Step 2.5 — PvE mode with no specific activity (playlist-ops, add-clear) */}
      {activity === "PvE" && pveMode && !activities && (
        <Row label="Confirm">
          <Chip onClick={() => onPick({ activity: "PvE", pveMode: pveMode! })}>
            Recommend builds for {PVE_MODE_LABEL[pveMode]}
          </Chip>
        </Row>
      )}

      {/* Step 4 — encounter (raids + dungeons) */}
      {activity === "PvE" && pveActivity && encounterOptions.length > 0 && (
        <Row label="Encounter">
          {encounterOptions.map((enc) => (
            <Chip
              key={enc}
              onClick={() =>
                onPick({
                  activity: "PvE",
                  pveMode: pveMode!,
                  pveActivity: pveActivity!,
                  encounter: enc,
                })
              }
            >
              {enc}
            </Chip>
          ))}
          <Chip
            onClick={() =>
              onPick({
                activity: "PvE",
                pveMode: pveMode!,
                pveActivity: pveActivity!,
              })
            }
          >
            (any encounter)
          </Chip>
        </Row>
      )}
    </Card>
  );
}

// ============================================================
// Results — show ranked builds for the picked situation
// ============================================================

function Results({
  situation, ranked, recipeFits, availableRoles, roleFilter, onRoleFilterChange,
  activeCharId, characters, loaded, onReset,
}: {
  situation: Situation;
  ranked: BuildFit[];
  recipeFits: RecipeFit[];
  availableRoles: string[];
  roleFilter: string | null;
  onRoleFilterChange: (r: string | null) => void;
  activeCharId: string | null;
  characters: CharacterSummary[];
  loaded: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 flex items-center justify-between">
        <div className="font-ui text-sm text-muted">
          <span className="font-mono text-[10px] tracking-[0.3em] uppercase">situation:</span>{" "}
          <SituationLabel s={situation} />
        </div>
        <button onClick={onReset} className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted hover:text-saber">
          ← pick again
        </button>
      </Card>

      {!loaded && (
        <Card className="p-6 border-amber-400/30">
          <p className="font-ui text-sm text-amber-400">
            Sign in to see which builds you can actually equip — without an inventory link, we just sort by build-template completeness.
          </p>
        </Card>
      )}

      {/* Weapon recipes for this encounter — split out by role chip */}
      {availableRoles.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3 mb-3 font-mono text-[10px] tracking-[0.25em] uppercase">
            <span className="text-muted">Weapon role:</span>
            <button
              onClick={() => onRoleFilterChange(null)}
              className={`px-3 py-1 rounded border transition-colors ${
                roleFilter === null
                  ? "text-saber border-saber"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              All
            </button>
            {availableRoles.map((r) => (
              <button
                key={r}
                onClick={() => onRoleFilterChange(r === roleFilter ? null : r)}
                className={`px-3 py-1 rounded border transition-colors ${
                  roleFilter === r
                    ? "text-saber border-saber"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {recipeFits.length === 0 && (
            <p className="font-ui text-xs text-muted">
              No recipes match this filter. Pick a different role or "All".
            </p>
          )}
          <div className="grid grid-cols-1 gap-3">
            {recipeFits.map((rf) => (
              <RecipeCard
                key={rf.recipe.id}
                fit={rf}
                activeCharId={activeCharId}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Buildable build templates */}
      {ranked.length === 0 ? (
        <Card className="p-6">
          <p className="font-ui text-sm text-muted-foreground">
            No builds in the library for this class yet. Add some on the{" "}
            <Link to="/builds" className="text-saber underline">/builds</Link>{" "}
            page or via <code>decode_dim_loadouts.py</code>.
          </p>
        </Card>
      ) : (
        <>
          <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted pt-2">
            Buildable templates (sorted by fit %)
          </div>
          {ranked.slice(0, 5).map((fit, i) => (
            <ResultCard
              key={fit.build.id}
              rank={i + 1}
              fit={fit}
              activeCharId={activeCharId}
              characters={characters}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ============================================================
// Weapon recipe card (kinetic / energy / heavy with ownership + equip)
// ============================================================
function RecipeCard({
  fit, activeCharId,
}: { fit: RecipeFit; activeCharId: string | null }) {
  const [equipState, setEquipState] = useState<
    | { kind: "idle" }
    | { kind: "working" }
    | { kind: "done"; msg: string; skipped: Array<{ instance_id: string; reason: string }> }
    | { kind: "error"; msg: string }
  >({ kind: "idle" });

  const ownedIds = useMemo(() => {
    const ids: string[] = [];
    for (const s of [fit.kinetic, fit.energy, fit.heavy]) {
      if (s.status === "owned") ids.push(s.item.instance_id);
    }
    return ids;
  }, [fit]);

  async function equipWeapons() {
    if (!activeCharId || ownedIds.length === 0) return;
    setEquipState({ kind: "working" });
    try {
      const res = await api.equip(activeCharId, ownedIds);
      setEquipState({
        kind: "done",
        msg: `equipped ${res.equipped_count}/${ownedIds.length}`,
        skipped: res.skipped,
      });
    } catch (e: any) {
      setEquipState({ kind: "error", msg: e?.message ?? "equip failed" });
    }
  }

  const pct = Math.round(fit.fitPct * 100);
  const pctColor =
    pct === 100 ? "text-emerald-400 border-emerald-400/60"
    : pct >= 50 ? "text-amber-400 border-amber-400/60"
    : "text-saber border-saber/60";

  return (
    <Card className="p-3 border-saber/30">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.3em] uppercase text-muted">
            <span>{fit.recipe.role}</span>
            <span>·</span>
            <span>{fit.recipe.encounter}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`font-mono text-[10px] tracking-[0.25em] uppercase px-2 py-0.5 rounded border ${pctColor}`}>
            {fit.ownedSlots}/3 · {pct}%
          </span>
          {activeCharId && ownedIds.length > 0 && (
            <Button
              onClick={equipWeapons}
              disabled={equipState.kind === "working"}
              variant="primary"
            >
              {equipState.kind === "working" ? "Equipping…" : `Equip ${ownedIds.length}`}
            </Button>
          )}
        </div>
      </div>

      {equipState.kind === "done" && (
        <div className="mb-2 px-3 py-1.5 rounded border border-emerald-400/40 bg-emerald-400/5 font-ui text-xs text-emerald-300">
          ✓ {equipState.msg}
          {equipState.skipped.length > 0 && (
            <span className="ml-2 text-amber-300">
              · skipped: {equipState.skipped.map((s) => s.reason).join(" · ")}
            </span>
          )}
        </div>
      )}
      {equipState.kind === "error" && (
        <div className="mb-2 px-3 py-1.5 rounded border border-red-400/40 bg-red-400/5 font-ui text-xs text-red-300">
          ⚠ {equipState.msg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 font-ui text-sm">
        <WeaponSlotLine label="Kinetic" status={fit.kinetic} />
        <WeaponSlotLine label="Energy"  status={fit.energy} />
        <WeaponSlotLine label="Heavy"   status={fit.heavy} />
      </div>

      {fit.recipe.rationale && (
        <p className="mt-2 text-xs text-muted-foreground italic">{fit.recipe.rationale}</p>
      )}
    </Card>
  );
}

function WeaponSlotLine({ label, status }: { label: string; status: RecipeSlotStatus }) {
  return (
    <div className="rounded border border-border bg-deepspace/40 p-2">
      <div className="font-mono text-[9px] tracking-[0.25em] uppercase text-muted mb-1">
        {label}
      </div>
      {status.status === "owned" ? (
        <>
          <div className="text-emerald-400 truncate">✓ {status.item.name}</div>
          <div className="font-mono text-[9px] text-muted">pw {status.item.power}</div>
          {status.alternatives.length > 0 && (
            <div className="text-[10px] text-muted/70 mt-1 truncate">
              alt: {status.alternatives.slice(0, 2).join(" / ")}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="text-saber">need:</div>
          <div className="text-muted-foreground text-xs">
            {status.wantedOptions.join(" / ")}
          </div>
        </>
      )}
    </div>
  );
}

function SituationLabel({ s }: { s: Situation }) {
  const parts: string[] = [s.activity];
  if (s.pveMode) parts.push(PVE_MODE_LABEL[s.pveMode]);
  if (s.pveActivity) parts.push(s.pveActivity);
  if (s.encounter) parts.push(s.encounter);
  if (s.pvpMode) parts.push(PVP_MODE_LABEL[s.pvpMode]);
  if (s.challenge) parts.push(CUSTOM_CHALLENGE_LABEL[s.challenge]);
  return <span className="text-foreground font-medium">{parts.join(" → ")}</span>;
}

function ResultCard({
  rank, fit, activeCharId, characters,
}: {
  rank: number; fit: BuildFit; activeCharId: string | null; characters: CharacterSummary[];
}) {
  const [equipState, setEquipState] = useState<
    | { kind: "idle" }
    | { kind: "working" }
    | { kind: "done"; msg: string; skipped: Array<{ instance_id: string; reason: string }> }
    | { kind: "error"; msg: string }
  >({ kind: "idle" });
  const [open, setOpen] = useState(rank === 1);

  // Collect instance IDs for slots where we have an owned match
  const ownedIds = useMemo(() => {
    const ids: string[] = [];
    for (const slot of ["exoticArmor", "kinetic", "energy", "heavy"] as const) {
      const s = fit[slot] as FitSlotStatus;
      if (s.status === "owned") ids.push(s.item.instance_id);
    }
    return ids;
  }, [fit]);

  async function equipNow() {
    if (!activeCharId) {
      setEquipState({ kind: "error", msg: "no active guardian selected" });
      return;
    }
    if (ownedIds.length === 0) {
      setEquipState({ kind: "error", msg: "no owned items in this build" });
      return;
    }
    setEquipState({ kind: "working" });
    try {
      const res = await api.equip(activeCharId, ownedIds);
      setEquipState({
        kind: "done",
        msg: `equipped ${res.equipped_count}/${ownedIds.length}`,
        skipped: res.skipped,
      });
    } catch (e: any) {
      setEquipState({ kind: "error", msg: e?.message ?? "equip failed" });
    }
  }

  const pct = Math.round(fit.fitPct * 100);
  const pctColor =
    pct === 100 ? "text-emerald-400 border-emerald-400/60"
    : pct >= 50 ? "text-amber-400 border-amber-400/60"
    : "text-saber border-saber/60";

  return (
    <Card className={rank === 1 ? "p-4 border-saber/60" : "p-4"}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.3em] uppercase text-muted mb-1">
            <span>#{rank}</span>
            <span>·</span>
            <span>{fit.build.class}</span>
            <span>·</span>
            <span>{fit.build.subclass}</span>
            <span>·</span>
            <span>{fit.build.focus}</span>
          </div>
          <h3 className="font-display text-lg font-bold tracking-wide truncate">
            {fit.build.name}
          </h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`font-mono text-[10px] tracking-[0.25em] uppercase px-2 py-1 rounded border ${pctColor}`}>
            {fit.ownedSlots}/{fit.totalSlots} · {pct}%
          </span>
          {activeCharId && ownedIds.length > 0 && (
            <Button onClick={equipNow} disabled={equipState.kind === "working"} variant="primary">
              {equipState.kind === "working" ? "Equipping…" : `Equip ${ownedIds.length}`}
            </Button>
          )}
          <button
            onClick={() => setOpen(!open)}
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted hover:text-saber"
          >
            {open ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {equipState.kind === "done" && (
        <div className="mt-3 px-3 py-2 rounded border border-emerald-400/40 bg-emerald-400/5 font-ui text-xs text-emerald-300">
          ✓ {equipState.msg}
          {equipState.skipped.length > 0 && (
            <div className="mt-1 text-amber-300">
              skipped: {equipState.skipped.map((s) => s.reason).join(" · ")}
            </div>
          )}
        </div>
      )}
      {equipState.kind === "error" && (
        <div className="mt-3 px-3 py-2 rounded border border-red-400/40 bg-red-400/5 font-ui text-xs text-red-300">
          ⚠ {equipState.msg}
        </div>
      )}

      {open && (
        <div className="mt-4 pt-4 border-t border-border space-y-3 font-ui text-sm">
          {fit.build.playstyle && (
            <p className="text-muted-foreground italic whitespace-pre-line">{fit.build.playstyle}</p>
          )}
          <SlotLine label="Exotic" status={fit.exoticArmor} />
          <SlotLine label="Kinetic" status={fit.kinetic} />
          <SlotLine label="Energy"  status={fit.energy} />
          <SlotLine label="Heavy"   status={fit.heavy} />
          <div className="flex justify-end gap-3">
            <Link
              to={`/builds`}
              className="text-xs font-mono uppercase tracking-[0.25em] text-muted hover:underline"
            >
              view in /builds
            </Link>
            {fit.build.target_stats && (
              <Link
                to={`/optimizer?build=${encodeURIComponent(fit.build.id)}`}
                className="text-xs font-mono uppercase tracking-[0.25em] text-saber hover:underline"
              >
                → optimize stats
              </Link>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function SlotLine({ label, status }: { label: string; status: FitSlotStatus }) {
  if (status.status === "owned") {
    return (
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-20 shrink-0">{label}</span>
        <span className="text-emerald-400">✓</span>
        <span className="font-medium">{status.item.name}</span>
        {status.item.power > 0 && (
          <span className="text-muted text-xs">pw {status.item.power}</span>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted w-20 shrink-0">{label}</span>
      <span className="text-saber">need:</span>
      <div className="flex-1 min-w-0">
        <div className="text-muted-foreground">{status.wantedOptions.join(" / ")}</div>
        {status.hint && <div className="text-xs text-muted mt-0.5">{status.hint}</div>}
      </div>
    </div>
  );
}

// ============================================================
// Tiny presentational helpers
// ============================================================

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] tracking-[0.25em] uppercase">
      <span className="text-muted w-20 shrink-0">{label}:</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active, onClick, children,
}: {
  active?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded border transition-colors ${
        active
          ? "text-saber border-saber"
          : "border-border text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// Re-export for tsc — situation.ts has the type
type ActivityEntry = { name: string; encounters: string[] };
