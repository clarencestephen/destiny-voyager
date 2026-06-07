#!/usr/bin/env python3
"""VERITY — dead-simple, high-contrast, no-geometry accessible card."""
W, H = 1480, 2190
BG = "#0a0b10"
PANEL = "#14161f"
WHITE = "#ffffff"
YEL = "#ffe27a"
GOLD = "#ffb43f"
MUT = "#aeb4c2"
CIRCLE = "#36d3ff"
SQUARE = "#ffd23f"
TRIANGLE = "#ff5f9e"
COL = {"circle": CIRCLE, "square": SQUARE, "triangle": TRIANGLE}
NM = {"circle": "CIRCLE", "square": "SQUARE", "triangle": "TRIANGLE"}
KEYNAME = {"circle": "PRISM", "square": "CONE", "triangle": "CYLINDER"}
OTHERS = {"circle": ("square", "triangle"), "square": ("circle", "triangle"), "triangle": ("circle", "square")}

S = []
def add(x): S.append(x)

def txt(x, y, s, size, c=WHITE, font="Outfit", anchor="start", spacing=0):
    return (f'<text x="{x}" y="{y}" font-family="{font}" font-weight="700" font-size="{size}" '
            f'fill="{c}" text-anchor="{anchor}" letter-spacing="{spacing}">{s}</text>')

def shape(cx, cy, kind, r, big=True):
    c = COL[kind]
    sw = 6 if big else 4
    fill = c
    if kind == "circle":
        return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="{WHITE}" stroke-width="{sw}"/>'
    if kind == "square":
        return f'<rect x="{cx-r}" y="{cy-r}" width="{2*r}" height="{2*r}" rx="6" fill="{fill}" stroke="{WHITE}" stroke-width="{sw}"/>'
    p = f"{cx},{cy-r} {cx+r*0.92:.0f},{cy+r*0.66:.0f} {cx-r*0.92:.0f},{cy+r*0.66:.0f}"
    return f'<polygon points="{p}" fill="{fill}" stroke="{WHITE}" stroke-width="{sw}" stroke-linejoin="round"/>'

add(f'<rect width="{W}" height="{H}" fill="{BG}"/>')

# ---- header
add(txt(W/2, 150, "VERITY", 132, WHITE, "Outfit", "middle", 6))
add(txt(W/2, 226, "JUST GRAB THE RIGHT 2 SHAPES", 50, GOLD, "Outfit", "middle", 2))
add(txt(W/2, 286, "Look at YOUR statue. Grab the 2 shapes it does NOT have. That's it.", 36, MUT, "WorkSans", "middle"))

# ---- THE RULE banner
add(f'<rect x="80" y="330" width="{W-160}" height="120" rx="14" fill="{GOLD}"/>')
add(txt(W/2, 392, "THE ONLY RULE", 34, "#1a1206", "Outfit", "middle", 3))
add(txt(W/2, 432, "YOUR KEY = THE 2 SHAPES YOUR STATUE DOES NOT HAVE", 33, "#1a1206", "Outfit", "middle"))

# ---- 3 giant lookup rows
rows = ["circle", "square", "triangle"]
y0 = 500
rh = 330
gap = 22
for i, st in enumerate(rows):
    y = y0 + i * (rh + gap)
    c = COL[st]
    a, b = OTHERS[st]
    # panel with thick colored left bar
    add(f'<rect x="80" y="{y}" width="{W-160}" height="{rh}" rx="16" fill="{PANEL}" stroke="{c}" stroke-width="4"/>')
    add(f'<rect x="80" y="{y}" width="22" height="{rh}" rx="0" fill="{c}"/>')
    cy = y + rh/2
    # LEFT: your statue
    add(txt(150, y+58, "IF YOUR STATUE HOLDS", 30, MUT, "WorkSans", "start", 1))
    add(shape(250, cy+24, st, 96))
    add(txt(250, y+rh-26, NM[st], 40, c, "Outfit", "middle", 1))
    # arrow
    add(txt(430, cy+18, "&#8594;", 110, WHITE, "Outfit", "middle"))
    # RIGHT: grab these 2
    add(txt(560, y+58, "GRAB THESE 2:", 32, WHITE, "Outfit", "start", 1))
    add(shape(700, cy+18, a, 92))
    add(txt(700, y+rh-26, NM[a], 36, COL[a], "Outfit", "middle"))
    add(txt(880, cy+34, "+", 90, WHITE, "Outfit", "middle"))
    add(shape(1040, cy+18, b, 92))
    add(txt(1040, y+rh-26, NM[b], 36, COL[b], "Outfit", "middle"))
    add(txt(1300, cy+8, f"makes a", 26, MUT, "WorkSans", "middle"))
    add(txt(1300, cy+44, KEYNAME[st], 30, GOLD, "Outfit", "middle"))
    add(txt(1300, cy+76, "(ignore the word)", 21, MUT, "WorkSans", "middle"))

# ---- HOW TO (4 steps)
sy = y0 + 3 * (rh + gap) + 16
add(txt(80, sy, "HOW TO DO IT", 40, WHITE, "Outfit", "start", 2))
steps = [
    "KILL the 2 glowing Knights in your room.",
    "PICK UP the 2 shapes — the ones your statue does NOT have.",
    "They turn into your KEY automatically.",
    "WALK into the glass wall to escape.",
]
for i, s in enumerate(steps):
    yy = sy + 56 + i * 70
    add(f'<circle cx="112" cy="{yy-12}" r="26" fill="{GOLD}"/>')
    add(txt(112, yy-2, str(i+1), 34, "#1a1206", "Outfit", "middle"))
    add(txt(160, yy, s, 36, WHITE, "WorkSans", "start"))

# ---- NEVER
ny = sy + 56 + 4 * 70 + 24
add(f'<rect x="80" y="{ny}" width="{W-160}" height="150" rx="14" fill="#2a0f17" stroke="{TRIANGLE}" stroke-width="3"/>')
add(txt(112, ny+50, "NEVER DO THIS", 34, TRIANGLE, "Outfit", "start", 1))
add(txt(112, ny+96, "&#10006;  Put a shape on YOUR OWN statue.", 32, WHITE, "WorkSans", "start"))
add(txt(112, ny+134, "&#10006;  Hold 3 shapes. Only ever carry 2.", 32, WHITE, "WorkSans", "start"))

# ---- footer credit
add(txt(W/2, H-34, "Verity made simple  ·  after FearlessNurseJo's card", 26, MUT, "WorkSans", "middle"))

svg = f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">{"".join(S)}</svg>'
html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:'Outfit';src:url('fonts/Outfit-Bold.ttf');font-weight:700}}
@font-face{{font-family:'WorkSans';src:url('fonts/WorkSans-Bold.ttf');font-weight:700}}
*{{margin:0;padding:0}}body{{background:{BG}}}
</style></head><body>{svg}</body></html>'''
open("simple.html", "w").write(html)
print("wrote simple.html")
