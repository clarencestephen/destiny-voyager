/**
 * web/src/lib/library.ts — the user's wishlists + saved builds.
 *
 * Signed in → synced to per-user KV (authoritative). Signed out → localStorage.
 * Saves always write localStorage immediately and (when signed in) debounce a
 * KV write, so the feature works offline/anonymous and upgrades transparently
 * once you Link your Bungie account.
 */
import { api, type Library } from "./api";

export type { Library };
export const emptyLibrary = (): Library => ({ builds: [], weaponWishlist: [], armorWishlist: [], loadouts: [], wishSpace: null });

const LS = "dv_library";

/** Synchronous read of the local library — use to seed UI state instantly. */
export function readLocalLibrary(): Library {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) return { ...emptyLibrary(), ...JSON.parse(raw) };
  } catch { /* fall through to migration */ }
  // Migrate the original per-feature keys (pre-library) if present.
  const lib = emptyLibrary();
  try {
    const ww = localStorage.getItem("dv_weapon_wishlist"); if (ww) lib.weaponWishlist = JSON.parse(ww);
    const aw = localStorage.getItem("dv_armor_wishlist"); if (aw) lib.armorWishlist = JSON.parse(aw);
    const sb = localStorage.getItem("dv_saved_builds"); if (sb) lib.builds = JSON.parse(sb);
  } catch { /* ignore */ }
  return lib;
}

function writeLocal(lib: Library) {
  try { localStorage.setItem(LS, JSON.stringify(lib)); } catch { /* quota — ignore */ }
}

let _signedIn = false;

function isLibrary(x: any): x is Library {
  return !!x && Array.isArray(x.builds) && Array.isArray(x.weaponWishlist) && Array.isArray(x.armorWishlist);
}
function hasData(l: Library) {
  return !!(l.builds.length || l.weaponWishlist.length || l.armorWishlist.length || l.loadouts?.length
    || l.wishSpace?.sections?.length);
}

/** Load the library. Uses KV when signed in (authoritative), else localStorage.
 *  Never wipes local data on a missing/malformed response, and on first sync
 *  pushes existing local data up to KV instead of clobbering it with an empty. */
export async function loadLibrary(): Promise<Library> {
  const local = readLocalLibrary();
  try {
    // Race the fetch against a timeout so a hung/unreachable API never blocks
    // the localStorage fallback.
    const remote = await Promise.race([
      api.getLibrary(), // throws 401 if not signed in
      new Promise<Library>((_, reject) => setTimeout(() => reject(new Error("library_timeout")), 3500)),
    ]);
    if (!isLibrary(remote)) { _signedIn = false; return local; } // not a real library → treat as signed-out
    _signedIn = true;
    if (!hasData(remote) && hasData(local)) {
      // First KV sync after signing in — keep what's local and push it up.
      writeLocal(local);
      api.saveLibrary(local).catch(() => { /* keep local */ });
      return local;
    }
    const merged = { ...emptyLibrary(), ...remote };
    writeLocal(merged);
    return merged;
  } catch {
    _signedIn = false;
    return local;
  }
}

let _timer: ReturnType<typeof setTimeout> | undefined;

/** Persist the library — localStorage now + a debounced KV write if signed in. */
export function saveLibrary(lib: Library) {
  writeLocal(lib);
  if (_signedIn) {
    clearTimeout(_timer);
    _timer = setTimeout(() => { api.saveLibrary(lib).catch(() => { /* keep local */ }); }, 800);
  }
}
