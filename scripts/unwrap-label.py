# -*- coding: utf-8 -*-
"""
Un-warp text printed around a cylindrical jar.

The ingredient panel is on the curved body, so near the silhouette edge it is
compressed to almost nothing. On a cylinder the horizontal screen position of a
point at angle t is x = R*sin(t), so the inverse map t = asin(x/R) stretches the
edge back out to even spacing. Not photogrammetry - just enough to read it.
"""
import sys, math
from PIL import Image

def flat(f):
    im = Image.open(f).convert('RGBA')
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    return bg.convert('RGB')

def unwrap(src, top, bottom, left, right, out, scale=3):
    """left/right are the jar's silhouette edges at this height, in px."""
    im = flat(src)
    band = im.crop((left, top, right, bottom))
    W, H = band.size
    R = W / 2.0
    cx = W / 2.0

    outw = int(W * 1.6)
    dst = Image.new('RGB', (outw, H), (255, 255, 255))
    sp = band.load(); dp = dst.load()
    for xo in range(outw):
        # even angle steps across the visible half-cylinder
        t = (xo / (outw - 1.0) - 0.5) * math.pi * 0.98
        xs = int(round(cx + R * math.sin(t)))
        if xs < 0 or xs >= W:
            continue
        for y in range(H):
            dp[xo, y] = sp[xs, y]
    dst = dst.resize((outw * scale, H * scale), Image.LANCZOS)
    dst.save(out, quality=95)
    print(out, dst.size)

if __name__ == '__main__':
    f, top, bottom, left, right, out = sys.argv[1:7]
    unwrap(f, int(top), int(bottom), int(left), int(right), out)
