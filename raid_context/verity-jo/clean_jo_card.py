#!/usr/bin/env python3
"""VERITY — clean up + re-space FearlessNurseJa's ORIGINAL card, style retained.

GRAPHIC-ONLY: keeps her real pixels for the header + all four step rows (her
photoreal statues / knights / key / glass / chrome header / colours), then
extends the canvas and rebuilds ONLY the bottom info band — which overflowed
the original canvas and got cut off — with the full text, properly spaced.
Her actual signature is reused (cropped from the source). Cut-off lines are
restored from the repo's verified Verity facts (Unstoppable Ogre; pedestals 1-6).
"""
from PIL import Image, ImageDraw, ImageFont

SRC = "jo_original.jpg"
CUT_Y = 836            # her own row-divider: keeps STEP 4 intact, lands just above HELPFUL INFO
BAND_H = 256           # room the bottom band actually needs
OUT = "verity-jo-clean.png"

# palette sampled from her card
BG     = (9, 4, 18)
GOLD   = (224, 178, 74)
SILVER = (198, 202, 214)
WHITE  = (238, 238, 245)
PINK   = (255, 95, 158)
MAG    = (228, 96, 200)

im = Image.open(SRC).convert("RGB")
W, _H = im.size
top = im.crop((0, 0, W, CUT_Y))
sig = im.crop((1360, 852, W, 942))          # her real "FearlessNurseJa" + heart

canvas = Image.new("RGB", (W, CUT_Y + BAND_H), BG)
canvas.paste(top, (0, 0))
d = ImageDraw.Draw(canvas)

def F(path, size):
    return ImageFont.truetype(f"fonts/{path}", size)

big = lambda s: F("BigShoulders-Bold.ttf", s)   # condensed display → matches her headers
body = lambda s: F("WorkSans-Bold.ttf", s)

# seam: a gold divider, consistent with her grid lines
d.rectangle([0, CUT_Y, W, CUT_Y + 3], fill=GOLD)
y0 = CUT_Y + 3

# ── HELPFUL INFO (left column) ──────────────────────────────────────────
d.text((22, y0 + 16), "HELPFUL INFO", font=big(40), fill=SILVER)
info = [
    "Pick up wrong shape? Deposit both on any other statue.",
    "Knights carry the shapes shown on the backboard.",
    "Killing both Knights spawns an Unstoppable Ogre — be ready.",
]
iy = y0 + 74
for ln in info:
    d.ellipse([26, iy + 8, 36, iy + 18], fill=PINK)
    d.text((48, iy), ln, font=body(21), fill=WHITE)
    iy += 40

# vertical divider between the two halves (matches her gold grid rails)
d.rectangle([702, y0 + 12, 704, y0 + BAND_H - 18], fill=(120, 96, 40))

# ── WITNESS TEST (right column) ─────────────────────────────────────────
ex, ey = 726, y0 + 18                         # eye glyph
d.rounded_rectangle([ex, ey, ex + 52, ey + 44], radius=9, outline=MAG, width=3)
d.ellipse([ex + 9, ey + 11, ex + 43, ey + 33], outline=MAG, width=3)
d.ellipse([ex + 21, ey + 16, ex + 31, ey + 28], fill=MAG)
d.text((ex + 70, y0 + 14), '"WITNESS NOTICES YOUR EFFORTS" TEST', font=big(30), fill=GOLD)
d.text((ex + 70, y0 + 62), "Use your camera to see the outside guardian call out", font=body(20), fill=WHITE)
d.text((ex + 70, y0 + 92), "the statue you set on the glowing pedestal (1–6).", font=body(20), fill=WHITE)
# numbered pedestals 1-6
cy = y0 + 152
for n in range(6):
    cx = ex + 96 + n * 70
    d.ellipse([cx - 21, cy - 21, cx + 21, cy + 21], outline=GOLD, width=3)
    num = big(30)
    tw = d.textlength(str(n + 1), font=num)
    d.text((cx - tw / 2, cy - 19), str(n + 1), font=num, fill=GOLD)

# ── her real signature (reused) ─────────────────────────────────────────
canvas.paste(sig, (W - sig.width - 24, CUT_Y + BAND_H - sig.height - 14))

canvas.save(OUT)
print(f"wrote {OUT} ({canvas.size[0]}x{canvas.size[1]})")
