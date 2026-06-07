#!/usr/bin/env python3
"""Lithic Notation — Tabula IV. Generates plate.html (SVG) for high-DPI render."""
import math

W, H = 1500, 2100
VOID = "#0b0912"
VOID2 = "#0a0814"
BONE = "#e9e1cf"
ASH = "#8a8597"
AMBER = "#e3a93f"

ML, MR, MT = 130, 1370, 120
CX = 750

S = []  # svg fragments
def add(x): S.append(x)

# ----------------------------------------------------------------- primitives
def line(x1, y1, x2, y2, c=BONE, w=1.0, o=1.0, dash=None):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{c}" stroke-width="{w}" opacity="{o}"{d}/>'

def txt(x, y, s, font, size, c=BONE, anchor="middle", ls=0.0, o=1.0, weight=None):
    wt = f' font-weight="{weight}"' if weight else ""
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{font}" font-size="{size}" fill="{c}" '
            f'text-anchor="{anchor}" letter-spacing="{ls}" opacity="{o}"{wt}>{s}</text>')

def glyph2d(cx, cy, shape, s, c, w=1.6, inner=True):
    g = [f'<g style="filter:drop-shadow(0 0 5px {c}40)">']
    fill = c + "12"
    if shape == "circle":
        g.append(f'<circle cx="{cx}" cy="{cy}" r="{s}" fill="{fill}" stroke="{c}" stroke-width="{w}"/>')
        if inner: g.append(f'<circle cx="{cx}" cy="{cy}" r="{s*0.7:.1f}" fill="none" stroke="{c}" stroke-width="{w*0.4:.2f}" opacity="0.5"/>')
    elif shape == "square":
        g.append(f'<rect x="{cx-s:.1f}" y="{cy-s:.1f}" width="{2*s:.1f}" height="{2*s:.1f}" fill="{fill}" stroke="{c}" stroke-width="{w}"/>')
        if inner: g.append(f'<rect x="{cx-s*0.7:.1f}" y="{cy-s*0.7:.1f}" width="{1.4*s:.1f}" height="{1.4*s:.1f}" fill="none" stroke="{c}" stroke-width="{w*0.4:.2f}" opacity="0.5"/>')
    else:  # triangle
        p = f'{cx},{cy-s:.1f} {cx+s*0.92:.1f},{cy+s*0.62:.1f} {cx-s*0.92:.1f},{cy+s*0.62:.1f}'
        g.append(f'<polygon points="{p}" fill="{fill}" stroke="{c}" stroke-width="{w}" stroke-linejoin="round"/>')
        if inner:
            pi = f'{cx},{cy-s*0.6:.1f} {cx+s*0.55:.1f},{cy+s*0.37:.1f} {cx-s*0.55:.1f},{cy+s*0.37:.1f}'
            g.append(f'<polygon points="{pi}" fill="none" stroke="{c}" stroke-width="{w*0.4:.2f}" opacity="0.5" stroke-linejoin="round"/>')
    g.append('</g>')
    return "".join(g)

def solid3d(cx, cy, kind, s, c, w=1.6):
    """Engraved isometric solids. s ~ half-extent."""
    o = 0.9
    f = c + "0d"
    st = f'fill="{f}" stroke="{c}" stroke-width="{w}" stroke-linejoin="round"'
    ln = f'stroke="{c}" stroke-width="{w*0.6:.2f}" fill="none"'
    g = [f'<g style="filter:drop-shadow(0 0 6px {c}55)">']
    if kind == "Sphere":
        g.append(f'<circle cx="{cx}" cy="{cy}" r="{s}" {st}/>')
        g.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{s}" ry="{s*0.34:.1f}" {ln} opacity="0.6"/>')
        g.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{s*0.34:.1f}" ry="{s}" {ln} opacity="0.6"/>')
    elif kind == "Cube":
        t = s*0.78
        g.append(f'<polygon points="{cx-t:.1f},{cy-t*0.5:.1f} {cx:.1f},{cy-t:.1f} {cx+t:.1f},{cy-t*0.5:.1f} {cx:.1f},{cy:.1f}" {st}/>')
        g.append(f'<polygon points="{cx-t:.1f},{cy-t*0.5:.1f} {cx-t:.1f},{cy+t:.1f} {cx:.1f},{cy+t*1.5:.1f} {cx:.1f},{cy:.1f}" {st}/>')
        g.append(f'<polygon points="{cx+t:.1f},{cy-t*0.5:.1f} {cx+t:.1f},{cy+t:.1f} {cx:.1f},{cy+t*1.5:.1f} {cx:.1f},{cy:.1f}" {st} opacity="0.82"/>')
    elif kind == "Pyramid":
        b = s*0.96
        g.append(f'<polygon points="{cx:.1f},{cy-s:.1f} {cx+b:.1f},{cy+s*0.78:.1f} {cx-b:.1f},{cy+s*0.78:.1f}" {st}/>')
        g.append(f'<line x1="{cx}" y1="{cy-s:.1f}" x2="{cx}" y2="{cy+s*0.62:.1f}" {ln} opacity="0.55"/>')
        g.append(f'<ellipse cx="{cx}" cy="{cy+s*0.78:.1f}" rx="{b}" ry="{s*0.22:.1f}" {ln} opacity="0.55"/>')
    elif kind == "Cone":
        b = s*0.86
        g.append(f'<path d="M {cx} {cy-s:.1f} L {cx+b:.1f} {cy+s*0.72:.1f} A {b:.1f} {s*0.24:.1f} 0 0 1 {cx-b:.1f} {cy+s*0.72:.1f} Z" {st}/>')
        g.append(f'<ellipse cx="{cx}" cy="{cy+s*0.72:.1f}" rx="{b*0.92:.1f}" ry="{s*0.2:.1f}" {ln} opacity="0.55"/>')
    elif kind == "Cylinder":
        b = s*0.74
        g.append(f'<path d="M {cx-b:.1f} {cy-s*0.78:.1f} L {cx-b:.1f} {cy+s*0.78:.1f} A {b:.1f} {s*0.26:.1f} 0 0 0 {cx+b:.1f} {cy+s*0.78:.1f} L {cx+b:.1f} {cy-s*0.78:.1f}" {st}/>')
        g.append(f'<ellipse cx="{cx}" cy="{cy-s*0.78:.1f}" rx="{b}" ry="{s*0.26:.1f}" {st}/>')
    elif kind == "Prism":
        t = s*0.82
        g.append(f'<polygon points="{cx-t*0.5:.1f},{cy-s:.1f} {cx+t*0.7:.1f},{cy-s:.1f} {cx+t*0.1:.1f},{cy:.1f}" {st}/>')
        g.append(f'<polygon points="{cx-t*0.5:.1f},{cy-s:.1f} {cx+t*0.1:.1f},{cy:.1f} {cx-t*0.2:.1f},{cy+s:.1f} {cx-t*1.0:.1f},{cy-s*0.1:.1f}" {st}/>')
        g.append(f'<polygon points="{cx+t*0.7:.1f},{cy-s:.1f} {cx+t*0.1:.1f},{cy:.1f} {cx-t*0.2:.1f},{cy+s:.1f} {cx+t*0.4:.1f},{cy-s*0.05:.1f}" {st} opacity="0.78"/>')
    g.append('</g>')
    return "".join(g)

# ----------------------------------------------------------------- background
add(f'<rect width="{W}" height="{H}" fill="{VOID}"/>')
add(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
# faint engraved grid
for gx in range(ML, MR+1, 62):
    add(line(gx, MT, gx, H-MT, BONE, 0.4, 0.03))
for gy in range(MT, H-MT+1, 62):
    add(line(ML, gy, MR, gy, BONE, 0.4, 0.03))

# ----------------------------------------------------------------- header
add(txt(ML, 150, "MORPHOLOGIA · DE DISSECTIONE FORMARVM", "Plex", 15, ASH, "start", "2.5"))
add(txt(MR, 150, "TABVLA IV", "Plex", 15, ASH, "end", "2.5"))
add(line(ML, 176, MR, 176, BONE, 1.0, 0.16))
add(txt(CX, 312, "VERITY", "Italiana", 132, BONE, "middle", "14"))
add(txt(CX, 356, "THE DISSECTION OF FORMS", "Jura", 21, ASH, "middle", "11"))
add(line(ML, 392, MR, 392, BONE, 1.0, 0.16))

# ----------------------------------------------------------------- §I primae
add(txt(ML, 452, "§ I — PRIMAE", "Plex", 14, AMBER, "start", "3"))
primae = [("circle", "circvlvs", "i"), ("square", "qvadratvm", "ii"), ("triangle", "trigonvm", "iii")]
COL = {"circle": "#c9c1b0", "square": "#c9c1b0", "triangle": "#c9c1b0"}
px = [500, 750, 1000]
for (shape, name, num), x in zip(primae, px):
    add(glyph2d(x, 540, shape, 50, COL[shape], 1.8))
    add(txt(x, 632, name, "Italiana", 27, BONE, "middle", "3"))
    add(txt(x, 658, f"fig. {num}", "Plex", 13, ASH, "middle", "2"))

add(line(ML, 700, MR, 700, BONE, 1.0, 0.1))

# ----------------------------------------------------------------- §II dissection apparatus
add(txt(ML, 752, "§ II — THE DISSECTION", "Plex", 14, AMBER, "start", "3"))
add(txt(MR, 752, "FIG. IV–IX", "Plex", 14, ASH, "end", "3"))

ocx, ocy, R = CX, 1188, 344
# hexagon frame + spokes
verts = []
for i in range(6):
    a = math.radians(-90 + 60*i)
    verts.append((ocx + R*math.cos(a), ocy + R*math.sin(a)))
hexpts = " ".join(f"{x:.1f},{y:.1f}" for x, y in verts)
add(f'<polygon points="{hexpts}" fill="none" stroke="{BONE}" stroke-width="0.8" opacity="0.12"/>')
for x, y in verts:
    add(line(ocx, ocy, x, y, BONE, 0.6, 0.1))

# central oculus (the watcher / the warm vein)
for rr, oo in [(166, 0.16), (122, 0.12), (80, 0.17)]:
    add(f'<circle cx="{ocx}" cy="{ocy}" r="{rr}" fill="none" stroke="{BONE}" stroke-width="0.8" opacity="{oo}"/>')
# inscribed hexagram in oculus
for rot in (0, 60):
    tp = []
    for k in range(3):
        aa = math.radians(rot + 120*k)
        tp.append(f"{ocx+80*math.sin(aa):.1f},{ocy-80*math.cos(aa):.1f}")
    add(f'<polygon points="{" ".join(tp)}" fill="none" stroke="{BONE}" stroke-width="0.6" opacity="0.14"/>')
add(f'<circle cx="{ocx}" cy="{ocy}" r="32" fill="none" stroke="{AMBER}" stroke-width="1.2" opacity="0.7"/>')
add(f'<circle cx="{ocx}" cy="{ocy}" r="7.5" fill="{AMBER}" style="filter:drop-shadow(0 0 12px {AMBER}dd)"/>')
add(txt(ocx, ocy+190, "the witness", "Italiana", 19, ASH, "middle", "5", 0.8))

# six solids on the hexagon vertices.  (parents) -> solid
solids = [
    ("Sphere", "sphaera", ["circle", "circle"], "iv"),
    ("Cylinder", "cylindrvs", ["circle", "square"], "v"),
    ("Cube", "cvbvs", ["square", "square"], "vi"),
    ("Prism", "prisma", ["square", "triangle"], "vii"),   # the clavis
    ("Pyramid", "pyramis", ["triangle", "triangle"], "viii"),
    ("Cone", "convs", ["circle", "triangle"], "ix"),
]
CLAVIS = "Prism"
for (kind, name, parents, num), (x, y) in zip(solids, verts):
    c = AMBER if kind == CLAVIS else BONE
    add(solid3d(x, y, kind, 52, c, 1.6))
    add(txt(x, y-72, f"fig. {num}", "Plex", 13, ASH if kind != CLAVIS else AMBER, "middle", "2"))
    add(txt(x, y+86, name, "Italiana", 25, c, "middle", "3"))
    # parent notation (two tiny glyphs)
    gx0 = x - 26
    add(glyph2d(gx0, y+110, parents[0], 9, ASH, 1.1, inner=False))
    add(txt(x, y+115, "›", "Jura", 16, ASH, "middle"))
    add(glyph2d(x+26, y+110, parents[1], 9, ASH, 1.1, inner=False))
    if kind == CLAVIS:
        add(txt(x, y+138, "clavis", "Plex", 13, AMBER, "middle", "4"))

# ----------------------------------------------------------------- margin instrument ticks
for ty in range(440, 1621, 24):
    long = (ty - 440) % 120 == 0
    L = 14 if long else 7
    add(line(ML-22, ty, ML-22+L, ty, BONE, 0.8, 0.22 if long else 0.12))
    add(line(MR+22-L, ty, MR+22, ty, BONE, 0.8, 0.22 if long else 0.12))

# ----------------------------------------------------------------- caption register
add(line(ML, 1712, MR, 1712, BONE, 1.0, 0.14))
add(txt(CX, 1792, "The key is the two forms the figure does not hold.", "Italiana", 38, BONE, "middle", "1.5"))
add(f'<rect x="{CX-70}" y="1818" width="140" height="2" fill="{AMBER}" opacity="0.85"/>')
add(txt(ML, 1958, "AFTER A FIELD CARD BY FEARLESSNURSEJO", "Plex", 14, ASH, "start", "2.5"))
add(txt(MR, 1958, "ANNO MMXXVI · PLATE IV / IX", "Plex", 14, ASH, "end", "2.5"))
add(line(ML, 1924, MR, 1924, BONE, 1.0, 0.1))

svg = f'''<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">
<defs>
<radialGradient id="bg" cx="50%" cy="34%" r="80%">
  <stop offset="0%" stop-color="#161028"/>
  <stop offset="48%" stop-color="{VOID}"/>
  <stop offset="100%" stop-color="{VOID2}"/>
</radialGradient>
</defs>
{"".join(S)}
</svg>'''

html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:'Italiana';src:url('fonts/Italiana-Regular.ttf')}}
@font-face{{font-family:'Jura';src:url('fonts/Jura-Light.ttf')}}
@font-face{{font-family:'Plex';src:url('fonts/IBMPlexMono-Regular.ttf')}}
*{{margin:0;padding:0}} html,body{{background:{VOID}}}
</style></head><body>{svg}
<div id="grain" style="position:fixed;inset:0;opacity:0.045;mix-blend-mode:overlay;pointer-events:none;
background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E&quot;)"></div>
</body></html>'''

open("plate.html", "w").write(html)
print("wrote plate.html")
