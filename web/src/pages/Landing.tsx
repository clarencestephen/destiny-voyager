import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark } from "@/components/BrandMark";
import { DiscordWidget } from "@/components/DiscordWidget";
import { api } from "@/lib/api";

const FEATURES = [
  {
    title: "Inventory Optimizer",
    desc: "Every weapon and armor piece you own, indexed and tagged. DIM-compatible tags (favorite / keep / infuse / junk / archive) sync across sessions.",
  },
  {
    title: "Wishlist Tracker",
    desc: "Track the rolls you're hunting. Cross-references against your real vault so you never re-shard the god roll.",
  },
  {
    title: "AI Build Assistant",
    desc: "Local Qwen 3 + Bungie API. Answers 'good PvP build with my current weapons' — using your actual inventory, not generic light.gg copy.",
  },
  {
    title: "Loadout Sharing",
    desc: "Export builds as portable JSON. Drop into a friend's instance, they have the same loadout.",
  },
];

export default function Landing() {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    try {
      const { url } = await api.authUrl();
      window.location.href = url;
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  }

  return (
    <div className="container py-20">
      {/* ============== HERO ============== */}
      <section className="relative animate-fade-up">
        <div className="absolute -inset-x-12 -inset-y-8 -z-10 opacity-30 blur-3xl bg-signature-gradient" />
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-12 items-center">
          <div>
            <p className="font-mono text-xs tracking-[0.4em] text-sith uppercase mb-6">
              ▸ For The Order 66 Clan
            </p>
            <h1 className="font-display font-black text-6xl md:text-7xl leading-[1.05] tracking-tight">
              <span className="text-signature">DESTINY VOYAGER</span>
            </h1>
            <p className="mt-6 text-xl text-star/80 max-w-2xl font-body">
              Destiny 2 inventory optimizer, wishlist tracker, and AI build assistant.
              Powered by your real vault — not generic guides.
            </p>
            <p className="mt-2 font-mono text-sm text-muted">
              <span className="text-saber">"</span>The dark side has better frame rates.<span className="text-saber">"</span>
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Button variant="primary" size="lg" onClick={signIn} disabled={loading}>
                {loading ? "Routing to Bungie…" : "Sign in with Bungie →"}
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link to="/chat">
                  Try the Chatbot ▶
                </Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <a href="https://github.com/clarencestephen/destiny-voyager" target="_blank" rel="noopener noreferrer">
                  ★ Star on GitHub
                </a>
              </Button>
            </div>

            <p className="mt-6 font-mono text-[10px] tracking-[0.25em] uppercase text-muted">
              We never see your password. Bungie OAuth · refresh tokens encrypted at rest in Cloudflare KV.
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <div className="relative">
              <div className="absolute inset-0 bg-signature-gradient blur-2xl opacity-40" />
              <BrandMark size={280} />
            </div>
          </div>
        </div>
      </section>

      {/* ============== FEATURE GRID ============== */}
      <section className="mt-24">
        <p className="font-mono text-xs tracking-[0.4em] text-sith uppercase mb-3">
          ▸ Capabilities
        </p>
        <h2 className="font-display text-3xl md:text-4xl font-bold tracking-wide text-star">
          What Voyager Does
        </h2>

        <div className="mt-10 grid md:grid-cols-2 gap-1 bg-border">
          {FEATURES.map((f) => (
            <Card key={f.title} className="border-0 bg-deepspace hover:bg-nebula transition-colors duration-300">
              <CardHeader>
                <CardTitle className="text-signature">{f.title}</CardTitle>
                <CardDescription>{f.desc}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* ============== HOW IT WORKS ============== */}
      <section className="mt-24">
        <p className="font-mono text-xs tracking-[0.4em] text-sith uppercase mb-3">
          ▸ Onboarding
        </p>
        <h2 className="font-display text-3xl md:text-4xl font-bold tracking-wide text-star">
          Three Steps. Sixty Seconds.
        </h2>

        <ol className="mt-10 grid md:grid-cols-3 gap-6 font-ui">
          {[
            { n: "01", t: "Sign in with Bungie", d: "OAuth flow. We get read-only access to your inventory. No password, no scraping." },
            { n: "02", t: "Pick your archetype", d: "Grenadier · Bulwark · Brawler · Paragon · Specialist · Gunner. We tune mod recommendations." },
            { n: "03", t: "Browse your vault", d: "Filter by tag, slot, element, power. Tag rolls. Ask the AI for builds. Share loadouts." },
          ].map((s) => (
            <div key={s.n} className="relative pt-6 border-t-2 border-darksith">
              <span className="absolute -top-4 left-0 font-mono text-[10px] tracking-[0.3em] text-saber bg-void px-2 py-1">
                STEP / {s.n}
              </span>
              <h3 className="font-display text-xl text-star tracking-wide">{s.t}</h3>
              <p className="mt-2 text-sm text-muted">{s.d}</p>
            </div>
          ))}
        </ol>
      </section>

      {/* ============== TWO PATHS ============== */}
      <section className="mt-24">
        <p className="font-mono text-xs tracking-[0.4em] text-sith uppercase mb-3">
          ▸ Two ways in
        </p>
        <h2 className="font-display text-3xl md:text-4xl font-bold tracking-wide text-star">
          Discord. Browser. Same Brain.
        </h2>

        <div className="mt-10 grid md:grid-cols-2 gap-6">
          <Card className="border-border bg-deepspace/80">
            <CardHeader>
              <CardTitle className="text-saber">▶  Discord — Darth Bot</CardTitle>
              <CardDescription className="font-ui text-sm leading-relaxed">
                Already in the Order 66 server. Run <code className="text-sith">/help</code>
                {" "}to see every command. Includes <code className="text-sith">/ask</code>,
                {" "}<code className="text-sith">/loadout-check</code>,
                {" "}<code className="text-sith">/upgrade</code> (uses your real vault),
                {" "}<code className="text-sith">/raid</code>, <code className="text-sith">/catalyst</code>.
                Run <code className="text-sith">/link-bungie</code> once to enable
                personalized answers — stays linked for 30 days.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-border bg-deepspace/80">
            <CardHeader>
              <CardTitle className="text-sith">▶  Browser — this site</CardTitle>
              <CardDescription className="font-ui text-sm leading-relaxed">
                No install, no Discord required. Sign in with Bungie once, then use
                the <Link to="/chat" className="text-saber hover:underline">chatbot at /chat</Link>
                {" "}or the <Link to="/app" className="text-saber hover:underline">dashboard at /app</Link>.
                Same answers as Discord — same anti-hallucination checks, same
                current-meta grounding, same Bungie-manifest verification.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* ============== CLAN — DISCORD WIDGET ============== */}
      <section className="mt-24">
        <p className="font-mono text-xs tracking-[0.4em] text-sith uppercase mb-3">
          ▸ The Clan
        </p>
        <h2 className="font-display text-3xl md:text-4xl font-bold tracking-wide text-star">
          Join <span className="text-signature">The Way of the Sith</span>
        </h2>
        <p className="mt-4 text-muted font-ui max-w-2xl">
          Voyager users hang out, share builds, run raids, and trash-talk in
          our Discord. Drop in — even if you're solo. We sherpa first-clears.
        </p>

        <div className="mt-10 grid lg:grid-cols-[1.4fr_1fr] gap-10 items-start">
          {/* left: what's inside */}
          <div className="space-y-4 font-ui">
            <div className="border-l-2 border-darksith pl-4">
              <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-sith">
                💬  The Cantina
              </div>
              <p className="text-star mt-1">
                General chat. Drop a meme, drop a god-roll. No politics, no drama.
              </p>
            </div>
            <div className="border-l-2 border-darksith pl-4">
              <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-sith">
                🤖  Darth Bot
              </div>
              <p className="text-star mt-1">
                AI assistant that knows Destiny + has read access to your vault.
                "Good PvP build with my current weapons?" — actual answers.
              </p>
            </div>
            <div className="border-l-2 border-darksith pl-4">
              <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-sith">
                🛡️  Imperial Troopers
              </div>
              <p className="text-star mt-1">
                Clan-only channel. Bungie clan members get the role automatically
                once you sign in here.
              </p>
            </div>
            <div className="border-l-2 border-darksith pl-4">
              <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-sith">
                ⚔️  LFG channels
              </div>
              <p className="text-star mt-1">
                Raids · dungeons · GMs · Trials · solo ops · day-one runs. Find
                a fireteam in your time zone.
              </p>
            </div>
          </div>

          {/* right: live widget */}
          <div className="relative">
            <div className="absolute -inset-4 -z-10 bg-signature-gradient opacity-20 blur-2xl" />
            <DiscordWidget />
          </div>
        </div>
      </section>

      {/* ============== CTA ============== */}
      <section className="mt-24 mb-12 relative border border-border bg-nebula/60 p-12 text-center">
        <div className="absolute inset-x-0 top-0 h-px bg-signature-gradient" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-signature-gradient" />
        <h2 className="font-display font-black text-3xl md:text-4xl tracking-wide">
          Ready, <span className="text-signature">Guardian?</span>
        </h2>
        <p className="mt-4 text-muted font-ui uppercase tracking-[0.18em] text-sm">
          Free. Open source. The dark side awaits.
        </p>
        <div className="mt-8 flex flex-wrap gap-4 justify-center">
          <Button variant="primary" size="lg" onClick={signIn} disabled={loading}>
            {loading ? "Routing to Bungie…" : "Begin"}
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link to="/chat">Ask Darth Bot →</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
