#!/usr/bin/env python3
"""VERITY inside-room — FearlessNurseJo's Observe/Pair/Share/Combine method,
kept intact but said in plain, high-contrast, normal-human language."""
W, H = 1500, 2300
BG = "#0a0b10"
PANEL = "#14161f"
WHITE = "#ffffff"
YEL = "#ffe27a"
GOLD = "#ffb43f"
MUT = "#aeb4c2"
CIRCLE = "#36d3ff"
SQUARE = "#ffd23f"
TRIANGLE = "#ff5f9e"
GREEN = "#46e08a"
STEPC = ["#36d3ff", "#ffd23f", "#ff5f9e", "#46e08a"]

S = []
def add(x): S.append(x)
def txt(x, y, s, size, c=WHITE, font="Outfit", anchor="start", sp=0):
    return (f'<text x="{x}" y="{y}" font-family="{font}" font-weight="700" font-size="{size}" '
            f'fill="{c}" text-anchor="{anchor}" letter-spacing="{sp}">{s}</text>')
def shp(cx, cy, kind, r, c):
    if kind == "circle": return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{c}" stroke="{WHITE}" stroke-width="4"/>'
    if kind == "square": return f'<rect x="{cx-r}" y="{cy-r}" width="{2*r}" height="{2*r}" rx="5" fill="{c}" stroke="{WHITE}" stroke-width="4"/>'
    p = f"{cx},{cy-r} {cx+r*0.92:.0f},{cy+r*0.66:.0f} {cx-r*0.92:.0f},{cy+r*0.66:.0f}"
    return f'<polygon points="{p}" fill="{c}" stroke="{WHITE}" stroke-width="4" stroke-linejoin="round"/>'

add(f'<rect width="{W}" height="{H}" fill="{BG}"/>')
# header
add(txt(W/2, 130, "VERITY", 116, WHITE, "Outfit", "middle", 6))
add(txt(W/2, 196, "INSIDE ROOM — MAKE YOUR ESCAPE KEY", 44, GOLD, "Outfit", "middle", 1))
add(txt(W/2, 248, "Your key is the 2 shapes your statue is NOT holding. Here's how you get them:", 32, MUT, "WorkSans", "middle"))

# what's going on box
add(f'<rect x="80" y="284" width="{W-160}" height="150" rx="14" fill="{PANEL}" stroke="{GOLD}" stroke-width="3"/>')
add(txt(112, 330, "WHAT'S GOING ON", 30, GOLD, "Outfit", "start", 2))
add(txt(112, 374, "There are 3 of you inside, each at a statue. You pass shapes between the statues so", 30, WHITE, "WorkSans"))
add(txt(112, 410, "each statue ends up with the 2 shapes it is NOT holding. Do these 4 steps in order.", 30, WHITE, "WorkSans"))

steps = [
    ("OBSERVE", "circle", [
        "Look at YOUR statue — it holds exactly 1 shape.",
        "Look at YOUR backboard — it shows 2 shapes.",
        "Remember both. The Knights you fight carry the 2 shapes on your backboard.",
    ]),
    ("PAIR", "square", [
        "GOAL: make your backboard show TWO of your statue's own shape.",
        "If a backboard shape is WRONG, give that shape to the statue that DOES hold it",
        "(that's its 'matching' statue — deposit the shape there). Never deposit on your own.",
    ]),
    ("SHARE", "triangle", [
        "GOAL: once at least 2 of you have a matched pair (two-of-your-own-shape),",
        "give your shapes to the OTHER statues — the ones that don't match that shape.",
        "Do it LEFT to RIGHT so nobody doubles up.",
    ]),
    ("COMBINE", "green", [
        "Kill BOTH Knights, then pick up your 2 shapes — that becomes your escape KEY.",
        "Walk out through the glass wall.",
        "(Killing the Knights spawns an Unstoppable Ogre — be ready for it.)",
    ]),
]
y0 = 450
rh = 360
for i, (name, sh, lines) in enumerate(steps):
    y = y0 + i * (rh + 14)
    c = STEPC[i]
    add(f'<rect x="80" y="{y}" width="{W-160}" height="{rh}" rx="16" fill="{PANEL}" stroke="{c}" stroke-width="4"/>')
    add(f'<rect x="80" y="{y}" width="20" height="{rh}" fill="{c}"/>')
    # big number circle
    add(f'<circle cx="170" cy="{y+78}" r="46" fill="{c}"/>')
    add(txt(170, y+96, str(i+1), 58, "#0a0b10", "Outfit", "middle"))
    add(txt(250, y+96, f"STEP {i+1} — {name}", 50, c, "Outfit", "start", 1))
    for j, ln in enumerate(lines):
        add(txt(112, y+170 + j*52, ln, 33, WHITE, "WorkSans"))

# helpful info
hy = y0 + 4 * (rh + 14) + 8
add(f'<rect x="80" y="{hy}" width="{W-160}" height="180" rx="14" fill="#2a0f17" stroke="{TRIANGLE}" stroke-width="3"/>')
add(txt(112, hy+50, "IF YOU MESS UP", 32, TRIANGLE, "Outfit", "start", 1))
add(txt(112, hy+98, "Wrong shape? Dump BOTH shapes on any OTHER statue, then redo your pair.", 30, WHITE, "WorkSans"))
add(txt(112, hy+140, "Outside team: zoom your camera to call the statue on the glowing pedestal.", 30, WHITE, "WorkSans"))

add(txt(W/2, H-34, "FearlessNurseJo's Observe / Pair / Share / Combine method — directions kept intact, said plainly.", 25, MUT, "WorkSans", "middle"))

svg = f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">{"".join(S)}</svg>'
html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:'Outfit';src:url('fonts/Outfit-Bold.ttf');font-weight:700}}
@font-face{{font-family:'WorkSans';src:url('fonts/WorkSans-Bold.ttf');font-weight:700}}
*{{margin:0;padding:0}}body{{background:{BG}}}
</style></head><body>{svg}</body></html>'''
open("simple.html", "w").write(html)
print("wrote simple.html")
