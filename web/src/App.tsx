import { useEffect, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";

type NavItem = { to: string; label: string };

// Touch devices synthesize mouseenter right before click, so hover-open +
// click-toggle makes the menu flash open then instantly close. Only wire the
// hover handlers on devices that actually hover.
const CAN_HOVER =
  typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches;

/** Grouped nav dropdown — opens on hover (desktop) or tap (touch), closes on
 *  navigation. Highlights when any of its routes is active. */
function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const active = items.some((i) => loc.pathname === i.to);
  return (
    <div
      className="relative"
      onMouseEnter={CAN_HOVER ? () => setOpen(true) : undefined}
      onMouseLeave={CAN_HOVER ? () => setOpen(false) : undefined}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 uppercase tracking-[0.22em] transition-colors hover:text-saber ${
          active ? "text-saber" : ""
        }`}
      >
        {label}
        <span className={`text-[8px] transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full pt-3 z-50">
          <div className="min-w-[190px] rounded border border-border bg-deepspace/95 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.6)] py-2 flex flex-col">
            {items.map((i) => (
              <Link
                key={i.to}
                to={i.to}
                className={`px-4 py-2 uppercase tracking-[0.22em] transition-colors hover:text-saber hover:bg-saber/5 ${
                  loc.pathname === i.to ? "text-saber" : "text-muted"
                }`}
              >
                {i.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const GEAR: NavItem[] = [
  { to: "/weapons", label: "Weapons" },
  { to: "/armor", label: "Armor" },
  { to: "/loadouts", label: "Loadouts" },
  { to: "/wishlist", label: "Wishlist" },
];
const BUILDS: NavItem[] = [
  { to: "/builds", label: "Build Library" },
  { to: "/build", label: "Forge" },
  { to: "/optimizer", label: "Optimizer" },
  { to: "/recommend", label: "Recommend" },
];
const ACTIVITIES: NavItem[] = [
  { to: "/play", label: "Play" },
  { to: "/fireteam", label: "Fireteam" },
];
const THIS_WEEK: NavItem[] = [
  { to: "/this-week/rotation", label: "Rotation" },
  { to: "/this-week/xur", label: "Xûr" },
  { to: "/this-week/eververse", label: "Eververse" },
  { to: "/this-week/vendors", label: "Vendors" },
  { to: "/this-week/news", label: "News" },
];

/** Full-screen-width mobile menu — grouped sections, closes on navigation. */
function MobileMenu({ onNavigate }: { onNavigate: () => void }) {
  const loc = useLocation();
  const groups: { label: string; items: NavItem[] }[] = [
    { label: "Gear", items: GEAR },
    { label: "Builds", items: BUILDS },
    { label: "This Week", items: THIS_WEEK },
    { label: "Activities", items: ACTIVITIES },
  ];
  const link = (i: NavItem) => (
    <Link
      key={i.to}
      to={i.to}
      onClick={onNavigate}
      className={`block px-4 py-2.5 uppercase tracking-[0.22em] transition-colors active:text-saber ${
        loc.pathname === i.to ? "text-saber" : "text-muted"
      }`}
    >
      {i.label}
    </Link>
  );
  return (
    <div className="md:hidden absolute inset-x-0 top-full z-50 border-b border-border bg-deepspace/95 backdrop-blur-md shadow-[0_16px_40px_rgba(0,0,0,0.7)] max-h-[calc(100vh-4rem)] overflow-y-auto">
      <nav className="container py-3 font-ui text-xs">
        {link({ to: "/app", label: "Dashboard" })}
        {groups.map((g) => (
          <div key={g.label} className="mt-2">
            <div className="px-4 pt-2 pb-1 font-mono text-[9px] tracking-[0.3em] uppercase text-sith">
              {g.label}
            </div>
            {g.items.map(link)}
          </div>
        ))}
        <div className="mt-2 border-t border-border/60 pt-2">
          {link({ to: "/chat", label: "Darth Bot" })}
        </div>
      </nav>
    </div>
  );
}

export default function App() {
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [loc.pathname]);
  return (
    <div className="min-h-screen flex flex-col">
      {/* z-40: backdrop-blur makes the header its own stacking context, so the
          nav dropdown panels need the header itself lifted above <main>. */}
      <header className="border-b border-border bg-deepspace/60 backdrop-blur-sm relative z-40">
        <div className="absolute inset-x-0 -bottom-px h-px bg-signature-gradient opacity-60" />
        <div className="container flex h-16 items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-3 group min-w-0">
            <BrandMark size={40} />
            <div className="flex flex-col leading-none min-w-0">
              <span className="font-display text-base sm:text-lg tracking-[0.18em] font-black text-signature truncate">
                DESTINY VOYAGER
              </span>
              <span className="hidden sm:block font-mono text-[10px] text-muted tracking-[0.25em] mt-1">
                ダースバンカイ · OPTIMIZER · WISHLIST
              </span>
            </div>
          </Link>
          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 font-ui text-xs uppercase tracking-[0.22em] text-muted">
            <Link to="/app" className={`hover:text-star transition-colors ${loc.pathname === "/app" ? "text-star" : ""}`}>
              Dashboard
            </Link>
            <NavGroup label="Gear" items={GEAR} />
            <NavGroup label="Builds" items={BUILDS} />
            <NavGroup label="This Week" items={THIS_WEEK} />
            <NavGroup label="Activities" items={ACTIVITIES} />
            <Link to="/chat" className={`hover:text-saber transition-colors ${loc.pathname === "/chat" ? "text-saber" : ""}`}>
              Darth Bot
            </Link>
          </nav>
          {/* Mobile hamburger */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={menuOpen}
            className="md:hidden shrink-0 flex flex-col justify-center items-center gap-[5px] w-10 h-10 rounded border border-border text-muted active:border-saber"
          >
            <span className={`block w-4 h-px bg-current transition-transform ${menuOpen ? "translate-y-[6px] rotate-45" : ""}`} />
            <span className={`block w-4 h-px bg-current transition-opacity ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`block w-4 h-px bg-current transition-transform ${menuOpen ? "-translate-y-[6px] -rotate-45" : ""}`} />
          </button>
        </div>
        {menuOpen && <MobileMenu onNavigate={() => setMenuOpen(false)} />}
      </header>

      {/* overflow-x-clip: decorative absolutely-positioned glows (Landing hero)
          intentionally bleed past their section — clip them at the page edge so
          they don't create horizontal scroll on phones. */}
      <main className="flex-1 overflow-x-clip">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-deepspace/40 mt-12">
        <div className="container py-6 flex items-center justify-between font-mono text-[10px] tracking-[0.25em] uppercase text-muted">
          <span>Destiny Voyager · v0.1 · ダースバンカイ</span>
          <span className="flex items-center gap-4">
            <Link to="/credits" className="hover:text-saber transition-colors">Credits</Link>
            <a href="https://github.com/clarencestephen/destiny-voyager" target="_blank"
               rel="noopener noreferrer" className="hover:text-sith transition-colors">
              GitHub
            </a>
            <span>Not affiliated with Bungie · Destiny 2 ™ Bungie, Inc.</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
