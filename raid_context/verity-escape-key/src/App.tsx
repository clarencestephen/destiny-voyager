import { useEffect, useRef, useState } from "react";

/* ============================================================= data (verified) */

type Shape2D = "circle" | "square" | "triangle";
type Shape3D = "Sphere" | "Cube" | "Pyramid" | "Cone" | "Cylinder" | "Prism";

const COLOR: Record<Shape2D, string> = { circle: "#67d0cf", square: "#d8c79f", triangle: "#e0708f" };
const KEY = "#e8b24c";
const LABEL: Record<Shape2D, string> = { circle: "Circle", square: "Square", triangle: "Triangle" };
const ROMAN = ["I", "II", "III", "IV", "V"];

const OTHERS: Record<Shape2D, [Shape2D, Shape2D]> = {
  circle: ["square", "triangle"],
  square: ["circle", "triangle"],
  triangle: ["circle", "square"],
};

function combine(a: Shape2D, b: Shape2D): Shape3D {
  const k = [a, b].sort().join("+");
  const map: Record<string, Shape3D> = {
    "circle+circle": "Sphere",
    "square+square": "Cube",
    "triangle+triangle": "Pyramid",
    "circle+triangle": "Cone",
    "circle+square": "Cylinder",
    "square+triangle": "Prism",
  };
  return map[k];
}

const ALL_COMBOS: { a: Shape2D; b: Shape2D; r: Shape3D }[] = [
  { a: "circle", b: "circle", r: "Sphere" },
  { a: "square", b: "square", r: "Cube" },
  { a: "triangle", b: "triangle", r: "Pyramid" },
  { a: "circle", b: "triangle", r: "Cone" },
  { a: "circle", b: "square", r: "Cylinder" },
  { a: "square", b: "triangle", r: "Prism" },
];

const ROLES = [
  {
    id: "Inside ×3",
    team: "Inside" as const,
    job: "Solve your statue, forge your escape key, kill the Knights and the Unstoppable Ogre, leave through the glass.",
    loadout: {
      subclass: "Healing — Solar (restoration) or Prismatic w/ healing class ability",
      weapons: "Add-clear primary w/ sustain (Heal Clip + Incandescent) · Anti-Unstoppable for the room Ogre",
      exotic: "— current post-Armor-3.0 pick unverified",
      stats: "Health + Class",
    },
  },
  {
    id: "Outside ×3",
    team: "Outside" as const,
    job: "Dissect the 3D forms, send the right 2D shapes to the inside statues, run the Witness 'notices your efforts' check.",
    loadout: {
      subclass: "Healing / Prismatic — survival-first",
      weapons: "Add-clear primary w/ sustain · reliable Anti-Unstoppable for the two Ogres each round",
      exotic: "— current post-Armor-3.0 pick unverified",
      stats: "Health + Class",
    },
  },
];

const THREATS = {
  noDps: "Verity has no boss and no DPS phase — completion is three rounds of correct dissection plus Ghost revival. Build for survival, not damage; no surge applies.",
  champions: ["Unstoppable Ogre — spawns when the Knights die → bring Anti-Unstoppable. Two outside per round; one can spawn in the inside room."],
  mods: [
    "No fixed element to resist (the adds are Taken) — invest Health/Class and self-healing over an elemental resist mod.",
    "Concussive Dampener — against the Unstoppable Ogre's splash and add explosions.",
  ],
  mistakes: [
    "Depositing a shape on your OWN statue — only ever deposit on a teammate's statue.",
    "Holding the wrong pair? Deposit BOTH on any other statue to reset, then re-pull.",
    "Picking up a third shape — you can only carry two; take exactly your key's two shapes.",
    "Grabbing your shapes before the team is ready to escape — the timer punishes it.",
    "Outside sends a wrong dissection — the inside statue never resolves.",
  ],
};

/* ============================================================= ornament */

function Mandala() {
  const ring = (r: number, o: number) => (
    <circle cx="200" cy="200" r={r} fill="none" stroke="var(--bone)" strokeWidth="0.6" opacity={o} />
  );
  const tri = (rot: number) => {
    const pts = [0, 120, 240].map((a) => {
      const rad = ((a + rot) * Math.PI) / 180;
      return `${200 + 165 * Math.sin(rad)},${200 - 165 * Math.cos(rad)}`;
    });
    return <polygon points={pts.join(" ")} fill="none" stroke="var(--bone)" strokeWidth="0.6" opacity={0.5} />;
  };
  const spokes = Array.from({ length: 24 }, (_, i) => {
    const a = (i * 15 * Math.PI) / 180;
    return (
      <line
        key={i}
        x1={200 + 70 * Math.sin(a)}
        y1={200 - 70 * Math.cos(a)}
        x2={200 + 190 * Math.sin(a)}
        y2={200 - 190 * Math.cos(a)}
        stroke="var(--bone)"
        strokeWidth="0.4"
        opacity="0.35"
      />
    );
  });
  return (
    <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden">
      <svg
        viewBox="0 0 400 400"
        className="h-[140vmin] w-[140vmin]"
        style={{ opacity: 0.07, animation: "spin-slow 240s linear infinite" }}
      >
        {ring(190, 0.7)}
        {ring(150, 0.4)}
        {ring(110, 0.5)}
        {ring(70, 0.4)}
        {ring(30, 0.6)}
        {tri(0)}
        {tri(60)}
        {spokes}
      </svg>
      <svg
        viewBox="0 0 400 400"
        className="absolute h-[70vmin] w-[70vmin]"
        style={{ opacity: 0.06, animation: "spin-rev 160s linear infinite" }}
      >
        {tri(15)}
        {tri(75)}
        {ring(120, 0.5)}
      </svg>
    </div>
  );
}

function Oculus() {
  const pupil = useRef<SVGGElement>(null);
  useEffect(() => {
    let raf = 0;
    const move = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const dx = (e.clientX / window.innerWidth - 0.5) * 10;
        const dy = (e.clientY / window.innerHeight - 0.5) * 10;
        if (pupil.current) pupil.current.style.transform = `translate(${dx}px, ${dy}px)`;
      });
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);
  return (
    <svg width="74" height="74" viewBox="0 0 74 74" style={{ animation: "flicker 6s ease-in-out infinite" }} aria-hidden>
      <circle cx="37" cy="37" r="34" fill="none" stroke="var(--witness)" strokeWidth="0.8" opacity="0.5" />
      <circle cx="37" cy="37" r="26" fill="none" stroke="var(--bone)" strokeWidth="0.5" opacity="0.35" />
      <g ref={pupil} style={{ transition: "transform 0.18s ease-out" }}>
        <circle cx="37" cy="37" r="13" fill="none" stroke="var(--witness)" strokeWidth="1.4" />
        <circle cx="37" cy="37" r="4" fill="var(--witness)" />
      </g>
    </svg>
  );
}

/* ============================================================= shapes (engraved) */

function S2D({ s, size = 56 }: { s: Shape2D; size?: number }) {
  const c = COLOR[s];
  const p: Record<string, string | number> = { stroke: c, strokeWidth: 2.4, fill: `${c}14`, strokeLinejoin: "round" };
  const inner: Record<string, string | number> = { stroke: c, strokeWidth: 0.8, fill: "none", opacity: 0.45 };
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ filter: `drop-shadow(0 0 7px ${c}66)` }}>
      {s === "circle" && (
        <>
          <circle cx="32" cy="32" r="22" {...p} />
          <circle cx="32" cy="32" r="16" {...inner} />
        </>
      )}
      {s === "square" && (
        <>
          <rect x="11" y="11" width="42" height="42" {...p} />
          <rect x="17" y="17" width="30" height="30" {...inner} />
        </>
      )}
      {s === "triangle" && (
        <>
          <polygon points="32,9 55,52 9,52" {...p} />
          <polygon points="32,20 46,47 18,47" {...inner} />
        </>
      )}
    </svg>
  );
}

function S3D({ s, size = 72 }: { s: Shape3D; size?: number }) {
  const c = KEY;
  const st = { stroke: c, strokeWidth: 2.2, fill: `${c}10`, strokeLinejoin: "round" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" style={{ filter: `drop-shadow(0 0 9px ${c}88)` }}>
      {s === "Sphere" && (
        <g>
          <circle cx="40" cy="40" r="26" {...st} />
          <ellipse cx="40" cy="40" rx="26" ry="9" stroke={c} strokeWidth="1.4" fill="none" opacity="0.6" />
          <ellipse cx="40" cy="40" rx="9" ry="26" stroke={c} strokeWidth="1.4" fill="none" opacity="0.6" />
        </g>
      )}
      {s === "Cube" && (
        <g>
          <polygon points="22,28 40,20 58,28 40,36" {...st} />
          <polygon points="22,28 22,54 40,62 40,36" {...st} />
          <polygon points="58,28 58,54 40,62 40,36" {...st} opacity={0.85} />
        </g>
      )}
      {s === "Pyramid" && (
        <g>
          <polygon points="40,14 60,58 20,58" {...st} />
          <line x1="40" y1="14" x2="40" y2="52" stroke={c} strokeWidth="1.4" opacity="0.6" />
          <ellipse cx="40" cy="58" rx="20" ry="6" stroke={c} strokeWidth="1.4" fill="none" opacity="0.6" />
        </g>
      )}
      {s === "Cone" && (
        <g>
          <path d="M40 14 L58 56 A20 6 0 0 1 22 56 Z" {...st} />
          <ellipse cx="40" cy="56" rx="18" ry="5.5" stroke={c} strokeWidth="1.4" fill="none" opacity="0.6" />
        </g>
      )}
      {s === "Cylinder" && (
        <g>
          <path d="M20 22 L20 56 A20 6 0 0 0 60 56 L60 22" {...st} />
          <ellipse cx="40" cy="22" rx="20" ry="6" {...st} />
        </g>
      )}
      {s === "Prism" && (
        <g>
          <polygon points="28,22 48,22 38,42" {...st} />
          <polygon points="28,22 38,42 26,58 16,38" {...st} opacity={0.85} />
          <polygon points="48,22 38,42 26,58 36,38" {...st} opacity={0.7} />
        </g>
      )}
    </svg>
  );
}

/* ============================================================= ui atoms */

function Tag({ children, color = "var(--ash)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1.5 text-[0.78rem] font-medium"
      style={{ border: `1px solid ${color}44`, color, background: `${color}0d` }}
    >
      {children}
    </span>
  );
}

const TABS = ["Escape Key", "Combinations", "Walkthrough", "Loadout", "Mistakes"] as const;
type Tab = (typeof TABS)[number];

/* ============================================================= app */

export default function App() {
  const [tab, setTab] = useState<Tab>("Escape Key");
  const [statue, setStatue] = useState<Shape2D | null>(null);
  const key2 = statue ? OTHERS[statue] : null;
  const key3 = key2 ? combine(key2[0], key2[1]) : null;

  return (
    <div className="relative min-h-full" style={{ background: "radial-gradient(125% 90% at 50% -8%, #140f26 0%, var(--void) 55%)" }}>
      <Mandala />
      <div className="grain pointer-events-none fixed inset-0 z-0" />
      <div className="vignette pointer-events-none fixed inset-0 z-0" />

      <div className="relative z-10">
        {/* ---------------------------------------------------- header monolith */}
        <header className="mx-auto max-w-5xl px-6 pt-12 pb-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="eyebrow anim-rise" style={{ animationDelay: "0.05s" }}>
                Salvation&apos;s Edge — Rite IV
              </div>
              <h1
                className="carved anim-rise mt-4 text-[3.4rem] font-bold uppercase leading-[0.86] sm:text-[5rem]"
                style={{ animationDelay: "0.12s" }}
              >
                Verity
              </h1>
              <div className="rule-amber anim-rise mt-5 h-px w-40" style={{ animationDelay: "0.2s" }} />
              <p
                className="anim-rise mt-5 max-w-md text-[0.95rem] leading-relaxed"
                style={{ color: "var(--bone-dim)", animationDelay: "0.26s" }}
              >
                The shape-rite of the Witness. Name the form your statue holds; the ledger forges the key you must carry out.
              </p>
            </div>
            <div className="anim-rise mt-1 shrink-0" style={{ animationDelay: "0.34s" }} title="The Witness observes.">
              <Oculus />
            </div>
          </div>
          <div className="eyebrow mt-7" style={{ letterSpacing: "0.3em" }}>
            After a card by <span style={{ color: "var(--key)" }}>FearlessNurseJo</span>
          </div>
        </header>

        {/* ---------------------------------------------------- ledger tabs */}
        <nav className="sticky top-0 z-30" style={{ background: "rgba(7,6,16,0.82)", backdropFilter: "blur(10px)" }}>
          <div className="mx-auto flex max-w-5xl gap-0 overflow-x-auto border-y border-[rgba(236,228,210,0.1)] px-3">
            {TABS.map((t, i) => {
              const on = tab === t;
              return (
                <button
                  key={t}
                  aria-label={t}
                  onClick={() => setTab(t)}
                  className="group relative flex shrink-0 items-baseline gap-2 px-4 py-4"
                  style={{ borderRight: i < TABS.length - 1 ? "1px solid rgba(236,228,210,0.07)" : "none" }}
                >
                  <span className="display text-[0.62rem]" style={{ color: on ? KEY : "var(--ash)" }}>
                    {ROMAN[i]}
                  </span>
                  <span
                    className="text-[0.74rem] font-semibold uppercase tracking-[0.18em]"
                    style={{ color: on ? "var(--bone)" : "var(--ash)" }}
                  >
                    {t}
                  </span>
                  {on && <span className="rule-amber absolute bottom-0 left-0 h-[2px] w-full" />}
                </button>
              );
            })}
          </div>
        </nav>

        <main className="mx-auto max-w-5xl px-6 py-10">
          {/* ============================================ ESCAPE KEY */}
          {tab === "Escape Key" && (
            <section>
              <SectionHead n="I" title="Observe" sub="Which form does your statue hold?" />

              <div className="mt-7 grid grid-cols-3 gap-3 sm:gap-5">
                {(["circle", "square", "triangle"] as Shape2D[]).map((s, i) => {
                  const on = statue === s;
                  return (
                    <button
                      key={s}
                      aria-label={LABEL[s]}
                      onClick={() => setStatue(s)}
                      className={`monolith anim-rise group flex flex-col items-center gap-4 px-2 py-8 transition-all duration-300 ${
                        on ? "plinth-active" : "hover:-translate-y-1"
                      }`}
                      style={{ animationDelay: `${0.1 + i * 0.08}s` }}
                    >
                      <span className="display text-[0.6rem]" style={{ color: on ? KEY : "var(--ash)" }}>
                        {["i", "ii", "iii"][i]}
                      </span>
                      <S2D s={s} size={66} />
                      <span
                        className="text-sm font-semibold uppercase tracking-[0.22em]"
                        style={{ color: on ? "var(--bone)" : "var(--bone-dim)" }}
                      >
                        {LABEL[s]}
                      </span>
                    </button>
                  );
                })}
              </div>

              {!statue && (
                <p
                  className="mt-9 border border-dashed px-5 py-8 text-center text-sm"
                  style={{ borderColor: "rgba(236,228,210,0.14)", color: "var(--ash)" }}
                >
                  Select your statue&apos;s form to forge the escape key.
                </p>
              )}

              {statue && key2 && key3 && (
                <div key={statue} className="mt-9 grid gap-6 md:grid-cols-[1.05fr_1fr]">
                  {/* the forge */}
                  <div className="monolith relative overflow-hidden p-7">
                    <div className="forge-ring pointer-events-none absolute -right-16 -top-16 opacity-40">
                      <svg width="220" height="220" viewBox="0 0 220 220">
                        <circle cx="110" cy="110" r="86" fill="none" stroke={KEY} strokeWidth="0.6" opacity="0.5" />
                        <circle cx="110" cy="110" r="64" fill="none" stroke={KEY} strokeWidth="0.4" opacity="0.4" />
                      </svg>
                    </div>
                    <div className="eyebrow">The Forge</div>
                    <div className="mt-6 flex items-center justify-center gap-3 sm:gap-5">
                      <div className="forge-a">
                        <S2D s={key2[0]} size={58} />
                      </div>
                      <span style={{ color: "var(--ash)" }}>+</span>
                      <div className="forge-b">
                        <S2D s={key2[1]} size={58} />
                      </div>
                      <span style={{ color: "var(--ash)" }}>=</span>
                      <div className="forge-key">
                        <S3D s={key3} size={92} />
                      </div>
                    </div>
                    <div className="mt-6 text-center">
                      <div
                        data-testid="key3d"
                        className="display key-text forge-key text-3xl font-bold uppercase sm:text-[2.6rem]"
                      >
                        {key3}
                      </div>
                      <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed" style={{ color: "var(--bone-dim)" }}>
                        Inscribe your backboard with{" "}
                        <b style={{ color: COLOR[key2[0]] }}>{LABEL[key2[0]]}</b> and{" "}
                        <b style={{ color: COLOR[key2[1]] }}>{LABEL[key2[1]]}</b> — the two forms your{" "}
                        <b style={{ color: COLOR[statue] }}>{LABEL[statue]}</b> statue does <i>not</i> hold.
                      </p>
                    </div>
                  </div>

                  {/* the four rites */}
                  <ol className="space-y-3">
                    {[
                      { t: "Observe", d: `Your statue holds ${LABEL[statue]}. Your backboard must end on ${LABEL[key2[0]]} + ${LABEL[key2[1]]}.` },
                      { t: "Pair", d: "If a backboard shape is wrong, give the mismatched form to its corresponding statue — the teammate whose statue holds it." },
                      { t: "Share", d: "Once two guardians are correct, distribute the remaining forms left-to-right to the non-corresponding statues." },
                      { t: "Combine", d: `Kill both Knights, take ${LABEL[key2[0]]} + ${LABEL[key2[1]]}, the ${key3} forms — leave through the glass.` },
                    ].map((st, i) => (
                      <li key={st.t} className="monolith relative flex items-center gap-5 overflow-hidden p-5">
                        <span
                          className="display absolute -left-1 -top-3 text-5xl font-bold leading-none"
                          style={{ color: "rgba(232,178,76,0.08)" }}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="display ml-8 text-sm" style={{ color: KEY }}>
                          0{i + 1}
                        </span>
                        <div>
                          <div className="text-sm font-bold uppercase tracking-[0.2em] carved">{st.t}</div>
                          <p className="mt-1 text-[0.85rem] leading-relaxed" style={{ color: "var(--ash)" }}>
                            {st.d}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="mt-8 flex flex-wrap gap-2.5">
                <Tag color={KEY}>Wrong pair? Deposit BOTH on any other statue to reset.</Tag>
                <Tag color={COLOR.circle}>Knights carry the shapes shown on your backboard.</Tag>
                <Tag color={COLOR.triangle}>Killing Knights spawns an Unstoppable Ogre.</Tag>
              </div>
            </section>
          )}

          {/* ============================================ COMBINATIONS */}
          {tab === "Combinations" && (
            <section>
              <SectionHead n="II" title="The Lexicon of Forms" sub="Two 2D shapes are forged into one 3D form. This is the whole language of Verity." />
              <div className="mt-7 divide-y" style={{ borderColor: "rgba(236,228,210,0.08)" }}>
                {ALL_COMBOS.map((c, i) => (
                  <div
                    key={c.r}
                    className="anim-rise flex items-center justify-between px-2 py-4"
                    style={{ animationDelay: `${i * 0.05}s`, borderColor: "rgba(236,228,210,0.08)", borderTopWidth: i ? 1 : 0 }}
                  >
                    <div className="flex items-center gap-3">
                      <S2D s={c.a} size={40} />
                      <span style={{ color: "var(--ash)" }}>+</span>
                      <S2D s={c.b} size={40} />
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="display text-sm font-bold uppercase key-text">{c.r}</span>
                      <S3D s={c.r} size={50} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-sm" style={{ color: "var(--ash)" }}>
                <b style={{ color: "var(--bone)" }}>Outside dissection</b> is this lexicon in reverse — shatter a 3D form into its two 2D shapes, then send them in.
              </p>
            </section>
          )}

          {/* ============================================ WALKTHROUGH */}
          {tab === "Walkthrough" && (
            <section>
              <SectionHead n="III" title="The Rite" sub="Two teams of three, one shared geometry." />
              <div className="mt-7 grid gap-5 md:grid-cols-2">
                <Inscription title="Inside" color={COLOR.circle} lines={[
                  ["Observe", "note your statue's form and your backboard's two shapes."],
                  ["Pair", "give any mismatched form to its corresponding statue."],
                  ["Share", "once two of you are correct, distribute the rest left-to-right."],
                  ["Combine", "kill the Knights, take your two key shapes, drop the Ogre, leave through the glass."],
                ]} />
                <Inscription title="Outside" color={COLOR.triangle} lines={[
                  ["Read", "each inside statue needs the two forms that are NOT its own."],
                  ["Dissect", "shatter the 3D forms into 2D shapes (the lexicon, reversed)."],
                  ["Send", "deposit the right 2D shapes onto the matching outside statues."],
                  ["Verify", "run the 'Witness notices your efforts' check before the timer lapses."],
                ]} />
              </div>
            </section>
          )}

          {/* ============================================ LOADOUT */}
          {tab === "Loadout" && (
            <section>
              <SectionHead n="IV" title="Panoply" sub="Verified against the most-recent guide — blanks are unverified, never guessed." />
              <div
                className="mt-6 flex items-start gap-3 border-l-2 px-4 py-3 text-sm"
                style={{ borderColor: KEY, background: "rgba(232,178,76,0.06)", color: "#f0d59a" }}
              >
                <span>🛡</span>
                <span><b>Survival-first.</b> {THREATS.noDps}</span>
              </div>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                {ROLES.map((r) => (
                  <div key={r.id} className="monolith p-6">
                    <div className="flex items-center justify-between">
                      <h3 className="display text-base font-bold uppercase carved">{r.id}</h3>
                      <Tag color={r.team === "Inside" ? COLOR.circle : COLOR.triangle}>{r.team}</Tag>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--bone-dim)" }}>{r.job}</p>
                    <dl className="mt-5 space-y-2.5 text-sm">
                      {[["Subclass", r.loadout.subclass], ["Weapons", r.loadout.weapons], ["Exotic", r.loadout.exotic], ["Stats", r.loadout.stats]].map(
                        ([k, v]) => (
                          <div key={k} className="grid grid-cols-[84px_1fr] gap-3">
                            <dt className="eyebrow" style={{ letterSpacing: "0.18em", paddingTop: "2px" }}>{k}</dt>
                            <dd style={{ color: v.startsWith("—") ? "var(--ash)" : "var(--bone)" }}>{v}</dd>
                          </div>
                        )
                      )}
                    </dl>
                  </div>
                ))}
              </div>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <Inscription title="Champions" color={COLOR.triangle} bullets={THREATS.champions} />
                <Inscription title="Defensive Mods" color={COLOR.circle} bullets={THREATS.mods} />
              </div>
            </section>
          )}

          {/* ============================================ MISTAKES */}
          {tab === "Mistakes" && (
            <section>
              <SectionHead n="V" title="Transgressions" sub="The ways a run dies." />
              <ul className="mt-7 space-y-3">
                {THREATS.mistakes.map((m, i) => (
                  <li
                    key={m}
                    className="monolith anim-rise flex items-center gap-4 p-5"
                    style={{ animationDelay: `${i * 0.06}s` }}
                  >
                    <span className="display text-lg" style={{ color: "var(--destructive, #d9577d)" }}>✕</span>
                    <span className="text-sm" style={{ color: "var(--bone-dim)" }}>{m}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>

        <footer className="mx-auto max-w-5xl px-6 pb-12 pt-4 text-xs leading-relaxed" style={{ color: "rgba(138,132,153,0.6)" }}>
          The key is deterministic: it is the two forms your statue does not hold. Loadout and defense come from the most-recent raid guide — a
          blank field is unverified, never invented.
        </footer>
      </div>
    </div>
  );
}

/* ============================================================= section helpers */

function SectionHead({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="display text-sm" style={{ color: KEY }}>{n}</span>
      <div>
        <h2 className="display text-lg font-bold uppercase carved sm:text-xl">{title}</h2>
        <p className="mt-1.5 text-sm" style={{ color: "var(--ash)" }}>{sub}</p>
      </div>
    </div>
  );
}

function Inscription({
  title,
  color,
  lines,
  bullets,
}: {
  title: string;
  color: string;
  lines?: [string, string][];
  bullets?: string[];
}) {
  return (
    <div className="monolith p-6">
      <h3 className="display text-base font-bold uppercase" style={{ color }}>{title}</h3>
      <div className="rule-amber mt-3 h-px w-12" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      {lines && (
        <ol className="mt-4 space-y-2.5">
          {lines.map(([k, v]) => (
            <li key={k} className="text-sm leading-relaxed" style={{ color: "var(--ash)" }}>
              <b className="carved">{k}</b> — {v}
            </li>
          ))}
        </ol>
      )}
      {bullets && (
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm" style={{ color: "var(--ash)" }}>
          {bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
