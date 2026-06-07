"""Live functional + responsive + a11y test for the Verity artifact (dev server)."""
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173"
results, console = [], []


def check(name, cond):
    results.append((name, bool(cond)))


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1100, "height": 1400})
    pg.on("console", lambda m: console.append((m.type, m.text)) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: console.append(("pageerror", str(e))))
    pg.goto(URL)
    pg.wait_for_load_state("networkidle")

    # 1. solver correctness (live)
    expect = {"Circle": "PRISM", "Square": "CONE", "Triangle": "CYLINDER"}
    for statue, key3 in expect.items():
        pg.get_by_role("button", name=statue, exact=True).click()
        pg.wait_for_timeout(120)
        big = pg.locator("[data-testid=key3d]").inner_text().strip()
        check(f"solver: {statue} -> {key3}", big == key3)

    # 2. STATE PERSISTENCE across tab switches (Triangle should survive)
    pg.get_by_role("button", name="Triangle", exact=True).click()
    pg.get_by_role("button", name="Combinations").click(); pg.wait_for_timeout(100)
    pg.get_by_role("button", name="Escape Key").click(); pg.wait_for_timeout(100)
    persisted = pg.locator("[data-testid=key3d]").inner_text().strip()
    check("state persists across tabs (Triangle->CYLINDER)", persisted == "CYLINDER")

    # 3. RAPID re-selection ends on last choice
    pg.get_by_role("button", name="Circle", exact=True).click()
    pg.get_by_role("button", name="Square", exact=True).click()
    pg.wait_for_timeout(120)
    check("rapid reselect Circle->Square ends CONE", pg.locator("[data-testid=key3d]").inner_text().strip() == "CONE")

    # 4. ACCESSIBILITY: every interactive button has an accessible name
    names = [ (el.inner_text() or el.get_attribute("aria-label") or "").strip() for el in pg.get_by_role("button").all() ]
    check("all buttons have accessible names", all(n for n in names))

    # 5. RESPONSIVE: mobile viewport, no horizontal body overflow, content present
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.wait_for_timeout(200)
    ov = pg.evaluate("() => document.body.scrollWidth - document.body.clientWidth")
    check(f"mobile: no body horizontal overflow (delta={ov}px)", ov <= 2)
    check("mobile: shape buttons visible", pg.get_by_role("button", name="Circle", exact=True).is_visible())
    pg.screenshot(path="/tmp/verity_mobile.png", full_page=True)

    b.close()

passed = sum(1 for _, ok in results if ok)
for name, ok in results:
    print(("PASS" if ok else "FAIL"), name)
print(f"\n{passed}/{len(results)} assertions passed")
errs = [c for c in console if c[0] in ("error", "pageerror")]
warns = [c for c in console if c[0] == "warning"]
print("console errors:", errs if errs else "NONE")
print("console warnings:", warns if warns else "NONE")
