import { Card } from "@/components/ui/card";

/**
 * /credits — mirrors destiny.report/credits: thanks to the data sources + tools
 * we build on (each linked), plus the third-party OSS this app bundles. Kept in
 * sync with Darth Bot's /credits command. Cite everything; fabricate nothing.
 */

type Link = { label: string; url: string; note?: string };

const THANKS: { heading: string; items: Link[] }[] = [
  {
    heading: "Data & API",
    items: [
      { label: "Bungie", url: "https://www.bungie.net", note: "Destiny 2 & the Bungie.net API — all game data comes from here." },
      { label: "Bungie.net API", url: "https://github.com/Bungie-net/api", note: "The official OpenAPI spec." },
      { label: "Destiny Item Manager (DIM)", url: "https://github.com/DestinyItemManager/DIM", note: "Search query language + season/source/event data. MIT licensed, © Destiny Item Manager." },
      { label: "Clarity", url: "https://www.d2clarity.com/", note: "Community-written perk & weapon descriptions. MIT." },
      { label: "light.gg", url: "https://www.light.gg/", note: "Community weapon database & god rolls." },
    ],
  },
  {
    heading: "Tools & inspiration",
    items: [
      { label: "Crayon, by Mijago", url: "https://crayon.mijago.net/", note: "Community Destiny weapon-info Discord bot." },
      { label: "d2foundry", url: "https://d2foundry.gg/", note: "Community weapon tool that set the bar for a great weapon browser." },
      { label: "D2Gunsmith", url: "https://d2gunsmith.com/", note: "Weapon roll tooling." },
      { label: "destiny.report", url: "https://destiny.report/", note: "This credits page mirrors theirs." },
      { label: "Josh Hunt", url: "https://github.com/joshhunt", note: "Many contributions to the Bungie.net API." },
      { label: "The wider Destiny community", url: "https://www.bungie.net/", note: "For the data and documentation that make projects like this possible." },
    ],
  },
];

// Third-party OSS this app ships to your browser (our actual dependencies).
const LICENSES: { name: string; license: string; url: string }[] = [
  { name: "React", license: "MIT", url: "https://react.dev" },
  { name: "React DOM", license: "MIT", url: "https://react.dev" },
  { name: "React Router", license: "MIT", url: "https://reactrouter.com" },
  { name: "@radix-ui/react-slot", license: "MIT", url: "https://www.radix-ui.com" },
  { name: "class-variance-authority", license: "Apache-2.0", url: "https://cva.style" },
  { name: "clsx", license: "MIT", url: "https://github.com/lukeed/clsx" },
  { name: "lucide-react", license: "ISC", url: "https://lucide.dev" },
  { name: "tailwind-merge", license: "MIT", url: "https://github.com/dcastil/tailwind-merge" },
  { name: "tailwindcss", license: "MIT", url: "https://tailwindcss.com" },
  { name: "tailwindcss-animate", license: "MIT", url: "https://github.com/jamiebuilds/tailwindcss-animate" },
  { name: "Vite", license: "MIT", url: "https://vitejs.dev" },
  { name: "TypeScript", license: "Apache-2.0", url: "https://www.typescriptlang.org" },
];

export default function Credits() {
  return (
    <section className="container py-10 max-w-4xl flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-muted">▲ Credits & Licenses</span>
        <h1 className="font-display text-3xl tracking-[0.16em] font-black text-signature">CREDITS</h1>
        <p className="font-ui text-sm text-muted-foreground max-w-2xl">
          Destiny Voyager builds on Bungie's API and the work of many Destiny tool-makers and
          open-source maintainers. Thank you. All data is sourced and cited — nothing is fabricated.
        </p>
      </header>

      {THANKS.map((group) => (
        <div key={group.heading} className="flex flex-col gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-saber">{group.heading}</h2>
          <div className="grid gap-2">
            {group.items.map((it) => (
              <Card key={it.label} className="p-3">
                <a href={it.url} target="_blank" rel="noopener noreferrer"
                   className="font-display text-star hover:text-saber transition-colors">
                  {it.label} <span className="text-muted text-xs">↗</span>
                </a>
                {it.note && <p className="font-ui text-xs text-muted mt-1">{it.note}</p>}
              </Card>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-saber">Third-party licenses</h2>
        <p className="font-ui text-xs text-muted">
          Destiny Voyager ships open-source software to your browser. God-roll data is derived from
          DIM community wishlists + Clarity (both MIT). The bundled libraries:
        </p>
        <Card className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {LICENSES.map((l) => (
              <a key={l.name} href={l.url} target="_blank" rel="noopener noreferrer"
                 className="flex items-baseline justify-between gap-3 font-ui text-xs hover:text-saber transition-colors group">
                <span className="text-foreground group-hover:text-saber">{l.name}</span>
                <span className="font-mono text-[10px] text-muted">{l.license}</span>
              </a>
            ))}
          </div>
        </Card>
      </div>

      <footer className="border-t border-border pt-5 flex flex-col gap-1 font-mono text-[10px] tracking-[0.2em] uppercase text-muted">
        <span>Built & maintained under ダースバンカイ · Destiny Voyager</span>
        <span>Not affiliated with Bungie · Destiny 2 ™ Bungie, Inc.</span>
      </footer>
    </section>
  );
}
