from playwright.sync_api import sync_playwright
import pathlib
html = pathlib.Path("jo_card.html").resolve().as_uri()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width":1860,"height":1380}, device_scale_factor=2)
    pg.goto(html)
    pg.wait_for_timeout(600)
    pg.locator("svg").screenshot(path="verity-jo.png")
    b.close()
print("rendered verity-jo.png")
