import { Outlet, Link } from "react-router-dom";
import { BrandMark } from "@/components/BrandMark";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-deepspace/60 backdrop-blur-sm relative">
        <div className="absolute inset-x-0 -bottom-px h-px bg-signature-gradient opacity-60" />
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <BrandMark size={40} />
            <div className="flex flex-col leading-none">
              <span className="font-display text-lg tracking-[0.18em] font-black text-signature">
                DESTINY VOYAGER
              </span>
              <span className="font-mono text-[10px] text-muted tracking-[0.25em] mt-1">
                ダースバンカイ · OPTIMIZER · WISHLIST
              </span>
            </div>
          </Link>
          <nav className="flex items-center gap-6 font-ui text-xs uppercase tracking-[0.22em] text-muted">
            <Link to="/" className="hover:text-star transition-colors">Home</Link>
            <Link to="/app" className="hover:text-star transition-colors">Dashboard</Link>
            <Link to="/play" className="hover:text-saber transition-colors">Play</Link>
            <Link to="/fireteam" className="hover:text-saber transition-colors">Fireteam</Link>
            <Link to="/builds" className="hover:text-star transition-colors">Builds</Link>
            <Link to="/optimizer" className="hover:text-saber transition-colors">Optimizer</Link>
            <Link to="/chat" className="hover:text-saber transition-colors">Darth Bot</Link>
            <a href="https://github.com/clarencestephen/destiny-voyager" target="_blank"
               rel="noopener noreferrer" className="hover:text-sith transition-colors">
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-deepspace/40 mt-12">
        <div className="container py-6 flex items-center justify-between font-mono text-[10px] tracking-[0.25em] uppercase text-muted">
          <span>Destiny Voyager · v0.1 · ダースバンカイ</span>
          <span>
            Not affiliated with Bungie · Destiny 2 ™ Bungie, Inc.
          </span>
        </div>
      </footer>
    </div>
  );
}
