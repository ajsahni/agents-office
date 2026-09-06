"""Rebake individual MCP tiles from PNG sources (no cairosvg needed).

bake.py is still the source of truth for the full set, but it requires cairosvg
to rasterise the SVG sources. This script bakes a subset from PNG sources using
the exact same tile chrome (256px white rounded tile, r=58, 2px hairline,
logo fitted to 176px, downscaled to 160px) so the output is pixel-consistent
with the tiles bake.py produces.

Usage: python3 rebake.py           # rebakes SUBSET + contact sheet
"""
import math
import os

from PIL import Image, ImageDraw

# key -> source png (square brand app-icon, transparent corners)
SUBSET = {
    'zoominfo': 'zoominfo-icon.png',   # 2020+ red "Z" logomark (was the retired orange sunburst)
    'apollo': 'apollo-icon.png',       # yellow tile + black asterisk (was the asterisk alone)
    'stripe': 'stripe-icon.png',       # purple tile mark (was the "stripe" wordmark)
}

T, R, FIT = 256, 58, 176


def bbox_crop(im):
    b = im.getbbox()
    return im.crop(b) if b else im


def tile_from(im, fit=FIT):
    im = bbox_crop(im)
    tile = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle([0, 0, T - 1, T - 1], radius=R,
                        fill=(255, 255, 255, 255), outline=(28, 26, 23, 26), width=2)
    w, h = im.size
    sc = min(fit / w, fit / h)
    nw, nh = max(1, round(w * sc)), max(1, round(h * sc))
    tile.alpha_composite(im.resize((nw, nh), Image.LANCZOS), ((T - nw) // 2, (T - nh) // 2))
    return tile.resize((160, 160), Image.LANCZOS)


os.makedirs('tiles', exist_ok=True)
for key, fp in SUBSET.items():
    src = Image.open(fp).convert('RGBA')
    tile_from(src).save(f'tiles/{key}.png')
    print(f'{key:12s} src={fp}')

files = sorted(os.listdir('tiles'))
cs = Image.new('RGBA', (4 * 180, math.ceil(len(files) / 4) * 180), (246, 243, 238, 255))
for i, f in enumerate(files):
    cs.alpha_composite(Image.open(f'tiles/{f}'), (10 + (i % 4) * 180, 10 + (i // 4) * 180))
cs.convert('RGB').save('contact-sheet.png')
print('sheet done')
