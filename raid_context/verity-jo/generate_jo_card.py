#!/usr/bin/env python3
"""VERITY — Inside Room cheat-sheet, rebuilt from FearlessNurseJo's card.

GRAPHIC EDIT ONLY: same content / same Observe→Pair→Share→Combine method
as Jo's original; this pass just cleans it up and spaces it properly so
nothing is cramped or cut off. The two lines her canvas truncated are
restored from the repo's verified Verity facts (Unstoppable Ogre on Knight
death; the 1-6 pedestal call-outs) — flagged for Jo to confirm wording.
"""

W, H = 1860, 1380

# palette — void black + neon, matching Jo's colour language
BG      = "#07080d"
PANEL   = "#10121b"
PANEL2  = "#0c0e16"
HAIR    = "#222637"
WHITE   = "#ffffff"
MUT     = "#9aa3b6"
GOLD    = "#ffb43f"
GOLDSOFT= "#ffe27a"
CYAN    = "#3fd0ff"   # circle
YELLOW  = "#ffd23f"   # square
PINK    = "#ff5f9e"   # triangle
GREEN   = "#52e08c"
RED     = "#ff5566"
ACCENT  = [CYAN, YELLOW, PINK, GREEN]   # per-step rail colour

S = []
def add(x): S.append(x)

def txt(x, y, s, size, c=WHITE, font="Outfit", anchor="start", sp=0, weight=700, opacity=1):
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{font}" font-weight="{weight}" '
            f'font-size="{size}" fill="{c}" text-anchor="{anchor}" letter-spacing="{sp}" '
            f'opacity="{opacity}">{s}</text>')

def shape(cx, cy, kind, r, c, sw=3.5):
    if kind == "circle":
        return f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{c}" stroke="#fff" stroke-width="{sw}"/>'
    if kind == "square":
        return (f'<rect x="{cx-r:.1f}" y="{cy-r:.1f}" width="{2*r:.1f}" height="{2*r:.1f}" '
                f'rx="{r*0.16:.1f}" fill="{c}" stroke="#fff" stroke-width="{sw}"/>')
    p = f"{cx:.1f},{cy-r:.1f} {cx+r*0.9:.1f},{cy+r*0.62:.1f} {cx-r*0.9:.1f},{cy+r*0.62:.1f}"
    return f'<polygon points="{p}" fill="{c}" stroke="#fff" stroke-width="{sw}" stroke-linejoin="round"/>'

def statue(cx, base_y, held, held_c, h=120, accent="#3a3f55"):
    """A clean iconographic Guardian statue holding one shape."""
    g = []
    w = h * 0.46
    # pedestal
    g.append(f'<rect x="{cx-w*0.7:.1f}" y="{base_y-10:.1f}" width="{w*1.4:.1f}" height="14" rx="3" fill="#2b3047"/>')
    # robe body (tapered)
    top = base_y - h
    body = (f"{cx-w*0.5:.1f},{base_y-10:.1f} {cx-w*0.34:.1f},{top+h*0.34:.1f} "
            f"{cx:.1f},{top+h*0.24:.1f} {cx+w*0.34:.1f},{top+h*0.34:.1f} {cx+w*0.5:.1f},{base_y-10:.1f}")
    g.append(f'<polygon points="{body}" fill="#1b2030" stroke="{accent}" stroke-width="2.5"/>')
    # head
    g.append(f'<circle cx="{cx:.1f}" cy="{top+h*0.16:.1f}" r="{h*0.12:.1f}" fill="#222a3d" stroke="{accent}" stroke-width="2.5"/>')
    # held shape badge on torso
    g.append(shape(cx, top + h*0.52, held, h*0.15, held_c, sw=3))
    return "".join(g)

def backboard(cx, cy, shapes, label=None, w=270, accent=GOLD):
    g = [f'<rect x="{cx-w/2:.1f}" y="{cy-58:.1f}" width="{w:.1f}" height="116" rx="12" '
         f'fill="{PANEL2}" stroke="{accent}" stroke-width="2.5" stroke-dasharray="9 7"/>']
    n = len(shapes)
    gap = w / (n + 1)
    for i, (k, c) in enumerate(shapes):
        g.append(shape(cx - w/2 + gap*(i+1), cy, k, 32, c))
    if label:
        g.append(txt(cx, cy-74, label, 21, MUT, "Outfit", "middle", 2))
    return "".join(g)

def arrow(x1, y1, x2, y2, c=RED, curve=40, wsize=15):
    mx, my = (x1+x2)/2, (y1+y2)/2 - curve
    path = f'<path d="M {x1:.0f} {y1:.0f} Q {mx:.0f} {my:.0f} {x2:.0f} {y2:.0f}" fill="none" stroke="{c}" stroke-width="5" stroke-linecap="round"/>'
    import math
    ang = math.atan2(y2-my, x2-mx)
    a1 = (x2 - wsize*math.cos(ang-0.5), y2 - wsize*math.sin(ang-0.5))
    a2 = (x2 - wsize*math.cos(ang+0.5), y2 - wsize*math.sin(ang+0.5))
    head = f'<polygon points="{x2:.0f},{y2:.0f} {a1[0]:.0f},{a1[1]:.0f} {a2[0]:.0f},{a2[1]:.0f}" fill="{c}"/>'
    return path + head

def knight(cx, base_y, h=120):
    top = base_y - h; w = h*0.5
    body = (f"{cx-w*0.5:.1f},{base_y:.1f} {cx-w*0.42:.1f},{top+h*0.36:.1f} "
            f"{cx-w*0.6:.1f},{top+h*0.28:.1f} {cx:.1f},{top+h*0.1:.1f} "
            f"{cx+w*0.6:.1f},{top+h*0.28:.1f} {cx+w*0.42:.1f},{top+h*0.36:.1f} {cx+w*0.5:.1f},{base_y:.1f}")
    g = [f'<polygon points="{body}" fill="#161b29" stroke="#3a4055" stroke-width="2.5"/>']
    g.append(f'<circle cx="{cx:.1f}" cy="{top+h*0.2:.1f}" r="{h*0.12:.1f}" fill="#10141f" stroke="#3a4055" stroke-width="2.5"/>')
    # glowing eyes
    g.append(f'<circle cx="{cx-7:.1f}" cy="{top+h*0.2:.1f}" r="3.6" fill="{GREEN}"/>')
    g.append(f'<circle cx="{cx+7:.1f}" cy="{top+h*0.2:.1f}" r="3.6" fill="{GREEN}"/>')
    return "".join(g)

def keyglyph(cx, cy, w=200):
    g = [f'<rect x="{cx-w/2:.1f}" y="{cy-7:.1f}" width="{w:.1f}" height="14" rx="7" fill="none" stroke="{GOLD}" stroke-width="4"/>']
    g.append(shape(cx-w/2, cy, "circle", 30, CYAN))
    g.append(shape(cx+w/2, cy, "square", 28, YELLOW))
    return "".join(g)

def glassburst(cx, cy, r=58):
    import math
    g = []
    for k in range(12):
        a = k*math.pi/6
        g.append(f'<line x1="{cx:.1f}" y1="{cy:.1f}" x2="{cx+r*math.cos(a):.1f}" y2="{cy+r*math.sin(a):.1f}" stroke="{CYAN}" stroke-width="2.4" opacity="0.7"/>')
    g.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r*0.5:.1f}" fill="none" stroke="{CYAN}" stroke-width="2.4"/>')
    g.append(f'<ellipse cx="{cx:.1f}" cy="{cy+6:.1f}" rx="11" ry="22" fill="#0a1622"/>')   # guardian
    g.append(f'<circle cx="{cx:.1f}" cy="{cy-14:.1f}" r="7" fill="#0a1622"/>')
    return "".join(g)

# ── background ───────────────────────────────────────────────────────
add(f'<rect width="{W}" height="{H}" fill="{BG}"/>')
add(f'<rect x="0" y="0" width="{W}" height="6" fill="{GOLD}"/>')

# ── header ───────────────────────────────────────────────────────────
add(txt(60, 70, "DESTINY 2", 26, GOLD, "Outfit", "start", 8))
add(txt(58, 138, "VERITY", 88, WHITE, "Outfit", "start", 4))
add(txt(W-60, 64, "INSIDE ROOM — MAKE YOUR ESCAPE KEY", 40, GOLDSOFT, "Outfit", "end", 1))
add(f'<text x="{W-60}" y="110" font-family="WorkSans" font-weight="700" font-size="30" fill="{MUT}" text-anchor="end">'
    f'<tspan>Your key is the 2 shapes your statue is </tspan><tspan fill="{GOLD}">NOT</tspan><tspan> holding.</tspan></text>')
add(f'<text x="{W-60}" y="146" font-family="WorkSans" font-weight="700" font-size="30" fill="{MUT}" text-anchor="end">'
    f'<tspan>Pass shapes until each statue holds the </tspan><tspan fill="{GOLD}">2 it lacks.</tspan></text>')
add(f'<line x1="60" y1="172" x2="{W-60}" y2="172" stroke="{HAIR}" stroke-width="2"/>')

# ── step rows ────────────────────────────────────────────────────────
STEPS = [
    ("OBSERVE", [
        (None, "What shape is your statue holding?"),
        (None, "Which 2 shapes are on your backboard?"),
    ]),
    ("PAIR", [
        ("GOAL",   "Match both backboard shapes"),
        (None,     "to the shape your statue is holding."),
        ("ACTION", "If a shape doesn't match,"),
        (None,     "give it to its corresponding statue."),
    ]),
    ("SHARE", [
        ("GOAL",   "When 2+ guardians have matching"),
        (None,     "shapes, share to the"),
        (None,     "non-corresponding statues."),
        ("ACTION", "Distribute left-to-right."),
    ]),
    ("COMBINE", [
        ("GOAL",   "Create your escape key and"),
        (None,     "exit through the glass."),
        ("ACTION", "Kill both Knights, pick up"),
        (None,     "both shapes."),
    ]),
]
ROW_Y0 = 196
ROW_H  = 218
GAP    = 14
RAIL_W = 210
TXT_X  = 296
VIS_X0 = 800

for i, (name, lines) in enumerate(STEPS):
    y = ROW_Y0 + i*(ROW_H + GAP)
    c = ACCENT[i]
    cy = y + ROW_H/2
    add(f'<rect x="60" y="{y}" width="{W-120}" height="{ROW_H}" rx="16" fill="{PANEL}" stroke="{c}" stroke-width="2.5" opacity="0.97"/>')
    add(f'<rect x="60" y="{y}" width="14" height="{ROW_H}" rx="7" fill="{c}"/>')
    # rail: number + name
    add(f'<circle cx="148" cy="{y+62:.0f}" r="34" fill="{c}"/>')
    add(txt(148, y+76, str(i+1), 44, BG, "Outfit", "middle"))
    add(txt(196, y+74, f"STEP {i+1}", 22, MUT, "Outfit", "start", 3))
    add(txt(104, y+ROW_H-32, name, 32, c, "Outfit", "start", 1))
    add(f'<line x1="{TXT_X-22}" y1="{y+26}" x2="{TXT_X-22}" y2="{y+ROW_H-26}" stroke="{HAIR}" stroke-width="2"/>')
    # instruction text (faithful wrap, contained within the text column)
    ty = y + 58
    for tag, ln in lines:
        if tag:
            add(txt(TXT_X, ty, tag, 23, (CYAN if tag=="GOAL" else GOLD), "Outfit", "start", 1))
            add(txt(TXT_X + (82 if tag=="GOAL" else 110), ty, ln, 26, WHITE, "WorkSans"))
        elif i == 0:
            add(f'<circle cx="{TXT_X+6}" cy="{ty-8:.0f}" r="4" fill="{c}"/>')
            add(txt(TXT_X+24, ty, ln, 26, WHITE, "WorkSans"))
        else:
            add(txt(TXT_X, ty, ln, 26, WHITE, "WorkSans"))
        ty += 44

    add(f'<line x1="{VIS_X0-24}" y1="{y+26}" x2="{VIS_X0-24}" y2="{y+ROW_H-26}" stroke="{HAIR}" stroke-width="2"/>')

    # ── per-step visual ──────────────────────────────────────────────
    if i == 0:
        add(txt(VIS_X0+120, y+44, "YOUR STATUE", 20, MUT, "Outfit", "middle", 2))
        add(statue(VIS_X0+120, y+ROW_H-28, "triangle", PINK, h=120))
        add(txt(VIS_X0+520, y+44, "YOUR BACKBOARD", 20, MUT, "Outfit", "middle", 2))
        add(backboard(VIS_X0+440, y+ROW_H/2+8, [("circle",CYAN),("triangle",PINK)], w=240))
        add(txt(VIS_X0+620, y+ROW_H/2+16, "OR", 30, GOLD, "Outfit", "middle"))
        add(backboard(VIS_X0+800, y+ROW_H/2+8, [("triangle",PINK),("triangle",PINK)], w=240))
    elif i == 1:
        add(backboard(VIS_X0+150, y+ROW_H/2, [("circle",CYAN),("triangle",PINK)], "YOUR BACKBOARD", w=240))
        add(arrow(VIS_X0+285, y+ROW_H/2, VIS_X0+430, y+86))
        for k,(sh,col,lab) in enumerate([("circle",CYAN,"matches"),("square",YELLOW,""),("triangle",PINK,"give here")]):
            sx = VIS_X0+470 + k*180
            add(statue(sx, y+ROW_H-26, sh, col, h=108))
    elif i == 2:
        add(backboard(VIS_X0+150, y+ROW_H/2, [("triangle",PINK),("triangle",PINK)], "MATCHED PAIR", w=240))
        for k,(sh,col) in enumerate([("circle",CYAN),("square",YELLOW),("triangle",PINK)]):
            sx = VIS_X0+470 + k*180
            add(statue(sx, y+ROW_H-26, sh, col, h=108))
            add(arrow(VIS_X0+285, y+ROW_H/2, sx-30, y+76, curve=30+k*18))
    else:
        cells = [("1. KILL BOTH KNIGHTS", "knights"), ("2. PICK UP BOTH SHAPES", "key"), ("3. EXIT THROUGH GLASS", "glass")]
        for k,(label, kind) in enumerate(cells):
            cx = VIS_X0 + 175 + k*320
            add(txt(cx, y+44, label, 22, GOLDSOFT, "Outfit", "middle", 1))
            if kind == "knights":
                add(knight(cx-44, y+ROW_H-24, h=110)); add(knight(cx+44, y+ROW_H-24, h=110))
            elif kind == "key":
                add(keyglyph(cx, y+ROW_H/2+18, 190))
            else:
                add(glassburst(cx, y+ROW_H/2+14, 56))
            if k < 2:
                add(txt(cx+160, y+ROW_H/2+14, "→", 40, MUT, "Outfit", "middle"))

# ── bottom band: helpful info + witness test ─────────────────────────
BY = ROW_Y0 + 4*(ROW_H+GAP) + 6
BH = H - BY - 70
colW = (W - 120 - 24) / 2

# helpful info
add(f'<rect x="60" y="{BY}" width="{colW:.0f}" height="{BH}" rx="16" fill="{PANEL2}" stroke="{HAIR}" stroke-width="2"/>')
add(txt(92, BY+44, "HELPFUL INFO", 28, GOLD, "Outfit", "start", 2))
info = [
    "Picked up the wrong shape? Deposit BOTH on any other statue.",
    "Knights carry the shapes shown on your backboard.",
    "Killing both Knights spawns an Unstoppable Ogre — be ready.",
]
for j, ln in enumerate(info):
    add(f'<circle cx="100" cy="{BY+84+j*42:.0f}" r="4" fill="{PINK}"/>')
    add(txt(118, BY+90+j*42, ln, 26, WHITE, "WorkSans"))

# witness test
wx = 60 + colW + 24
add(f'<rect x="{wx:.0f}" y="{BY}" width="{colW:.0f}" height="{BH}" rx="16" fill="{PANEL2}" stroke="{HAIR}" stroke-width="2"/>')
add(f'<rect x="{wx+28:.0f}" y="{BY+24:.0f}" width="46" height="46" rx="10" fill="none" stroke="{PINK}" stroke-width="2.5"/>')
add(f'<ellipse cx="{wx+51:.0f}" cy="{BY+47:.0f}" rx="14" ry="9" fill="none" stroke="{PINK}" stroke-width="2.5"/>')
add(f'<circle cx="{wx+51:.0f}" cy="{BY+47:.0f}" r="4" fill="{PINK}"/>')
add(txt(wx+92, BY+44, '"WITNESS NOTICES YOUR EFFORTS" TEST', 24, GOLDSOFT, "Outfit", "start", 1))
add(txt(wx+92, BY+82, "Use your camera to spot the outside guardian and call", 25, WHITE, "WorkSans"))
add(txt(wx+92, BY+114, "out the statue on the glowing pedestal (1–6).", 25, WHITE, "WorkSans"))
for n in range(6):
    ccx = wx + 112 + n*64
    add(f'<circle cx="{ccx:.0f}" cy="{BY+162:.0f}" r="20" fill="none" stroke="{GOLD}" stroke-width="2.5"/>')
    add(txt(ccx, BY+170, str(n+1), 24, GOLD, "Outfit", "middle"))

# ── footer / signature ───────────────────────────────────────────────
add(txt(60, H-30, "Observe · Pair · Share · Combine", 24, MUT, "Outfit", "start", 2))
add(txt(W-60, H-30, "FearlessNurseJo  ♥", 26, PINK, "Outfit", "end", 1))

svg = f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">{"".join(S)}</svg>'
html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:'Outfit';src:url('fonts/Outfit-Bold.ttf');font-weight:700}}
@font-face{{font-family:'WorkSans';src:url('fonts/WorkSans-Bold.ttf');font-weight:700}}
*{{margin:0;padding:0}}html,body{{background:{BG}}}
</style></head><body>{svg}</body></html>'''
open("jo_card.html", "w").write(html)
open("jo_card.svg", "w").write(svg)
print(f"wrote jo_card.html + jo_card.svg ({W}x{H})")
