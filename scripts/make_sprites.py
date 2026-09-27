"""Turn Higgsfield-generated character sheets into app-ready animation strips.

Ported from the Trainer App (aphile-m/Lifestyle-App) unchanged except for the
output prefix: NODE's sheets are the six characters in scripts/character-prompts.md,
so strips land as www/img/ch-<key>.webp rather than ex-<key>.webp.

The keying is why character-prompts.md insists on a magenta background rather
than the near-black the Trainer App used — see key_cell() below, and the note in
that file.


For each sheet: download, slice the grid (default 4x2, per-line override as a
third `colsxrows` column in sprite-urls.txt), key out the background per cell,
crop all frames to their union bbox (preserving inter-frame registration), and
compose a horizontal 8-frame WebP strip with alpha (grids with more cells are
capped to the first 8 frames). Keying is multi-pass so it handles both flat
backgrounds and "card" sheets where each cell is a framed panel: pass 1 floods
the border-connected background; if that removed less than half the cell (it
only ate a gutter/frame), later passes sample a ring 4px past the keyed region
— beyond the frame/card anti-aliasing — and flood the card colour inward. A
final connected-component sweep keeps only alpha connected to the cell centre,
dropping leftover anti-aliased frame rings. Writes www/img/ch-<key>.webp +
www/img/ch-meta.json. Run by .github/workflows/sprites.yml on a runner with
open internet.
"""
import json
import os
import urllib.request

import numpy as np
from PIL import Image

TARGET_H = 200
OUT = 'www/img'
PREFIX = 'ch-'
THRESH = 30


def flood(simil, seed):
    conn = seed & simil
    for _ in range(4000):
        grown = conn.copy()
        grown[1:, :] |= conn[:-1, :]; grown[:-1, :] |= conn[1:, :]
        grown[:, 1:] |= conn[:, :-1]; grown[:, :-1] |= conn[:, 1:]
        grown &= simil
        if (grown == conn).all():
            break
        conn = grown
    return conn


def dilate(m, n=1):
    for _ in range(n):
        grown = m.copy()
        grown[1:, :] |= m[:-1, :]; grown[:-1, :] |= m[1:, :]
        grown[:, 1:] |= m[:, :-1]; grown[:, :-1] |= m[:, 1:]
        m = grown
    return m


def key_cell(a):
    h, w = a.shape[:2]
    corners = np.concatenate([a[:8, :8].reshape(-1, 3), a[:8, -8:].reshape(-1, 3),
                              a[-8:, :8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    border = np.zeros((h, w), bool)
    border[0, :] = border[-1, :] = True
    border[:, 0] = border[:, -1] = True
    # hysteresis keying: flood a TIGHT core (flat background only), then grow a
    # 3px fringe at a loose threshold for anti-aliased edges — a loose single
    # threshold creeps deep into dark clothing on these near-black backgrounds
    core = flood((np.abs(a - bg).max(axis=2) < 14), border)
    keyed = core | (dilate(core, 3) & (np.abs(a - bg).max(axis=2) < 40))
    ran2 = False
    if keyed.mean() < 0.5:
        for _ in range(3):
            d = dilate(keyed, 4)
            ring = dilate(d, 1) & ~d
            if ring.sum() < 50:
                break
            bg2 = np.median(a[ring], axis=0)
            # a real card interior differs strongly from the outer background;
            # on a flat sheet where the figure just fills the cell, the ring
            # lands on the FIGURE (dark clothing ~ dark bg) — never key that
            if np.abs(bg2 - bg).max() < 40:
                break
            uniform = (np.abs(a[ring] - bg2).max(axis=1) < THRESH).mean()
            if uniform < 0.5:
                break
            simil2 = (np.abs(a - bg2).max(axis=2) < THRESH) & ~keyed
            add = flood(simil2, ring & simil2)
            if not add.any():
                break
            keyed |= add
            ran2 = True
            if keyed.mean() >= 0.5:
                break
    if ran2:
        opaque = ~keyed
        centre = np.zeros((h, w), bool)
        centre[h // 5:4 * h // 5, w // 5:4 * w // 5] = True
        keyed = ~flood(opaque, opaque & centre)
    return keyed


def process(key, path, cols=4, rows=2, center=False):
    im = Image.open(path).convert('RGB')
    W, H = im.size
    cw, ch = W // cols, H // rows
    a = np.asarray(im).astype(np.int16)
    frames = []
    for r in range(rows):
        for c in range(cols):
            cell = a[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
            alpha = np.where(key_cell(cell), 0, 255).astype(np.uint8)
            frames.append(np.dstack([cell.astype(np.uint8), alpha]))
    frames = frames[:8]
    pad = 6
    out = os.path.join(OUT, f'{PREFIX}{key}.webp')
    if center:
        # per-frame bottom-centre alignment: for sheets where the model drew
        # the figure at different spots per cell (union bbox would make the
        # animation jump sideways)
        crops = []
        for f in frames:
            ys, xs = np.where(f[:, :, 3] > 0)
            crops.append(f[ys.min():ys.max() + 1, xs.min():xs.max() + 1] if len(ys) else f)
        fh = max(c.shape[0] for c in crops) + pad * 2
        fw = max(c.shape[1] for c in crops) + pad * 2
        tw = round(fw * TARGET_H / fh)
        strip = Image.new('RGBA', (tw * len(crops), TARGET_H), (0, 0, 0, 0))
        for i, c in enumerate(crops):
            cell = Image.new('RGBA', (fw, fh), (0, 0, 0, 0))
            cell.paste(Image.fromarray(c), ((fw - c.shape[1]) // 2, fh - pad - c.shape[0]))
            strip.paste(cell.resize((tw, TARGET_H), Image.LANCZOS), (i * tw, 0))
        strip.save(out, 'WEBP', quality=86, method=6)
        return {'fw': tw, 'fh': TARGET_H}
    boxes = []
    for f in frames:
        ys, xs = np.where(f[:, :, 3] > 0)
        boxes.append((ys.min(), xs.min(), ys.max() + 1, xs.max() + 1) if len(ys) else (0, 0, ch, cw))
    y0 = max(0, min(b[0] for b in boxes) - pad); x0 = max(0, min(b[1] for b in boxes) - pad)
    y1 = min(ch, max(b[2] for b in boxes) + pad); x1 = min(cw, max(b[3] for b in boxes) + pad)
    fh, fw = y1 - y0, x1 - x0
    tw = round(fw * TARGET_H / fh)
    strip = Image.new('RGBA', (tw * len(frames), TARGET_H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        cell = Image.fromarray(f[y0:y1, x0:x1]).resize((tw, TARGET_H), Image.LANCZOS)
        strip.paste(cell, (i * tw, 0))
    strip.save(out, 'WEBP', quality=86, method=6)
    return {'fw': tw, 'fh': TARGET_H}


def contiguous(mask):
    """Index ranges where mask is True, as [(start, end_inclusive), ...]."""
    out, run = [], None
    for i, v in enumerate(mask):
        if v and run is None:
            run = i
        elif not v and run is not None:
            out.append((run, i - 1)); run = None
    if run is not None:
        out.append((run, len(mask) - 1))
    return out


def process_auto(key, path, gap=6):
    """Find the figures instead of assuming a grid.

    The `colsxrows` path assumes the model honoured the cell boundaries it was
    asked for. It often does not: of six character sheets generated from
    scripts/character-prompts.md, three had the bottom row running off the
    canvas, so a 4x2 slice would have packed four frames with their feet cut
    off and the union bbox would have stretched every frame to match.

    On the flat chroma background the prompts require, detection is easy and
    exact: threshold against the corner colour, split into column bands, split
    each band into row bands, and drop any figure touching the top or bottom
    edge (which is what "cropped" looks like). No multi-pass keying is needed
    either -- that machinery exists for messy near-black sheets, and a single
    threshold against #FF00FF is unambiguous.
    """
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    H, W = a.shape[:2]
    corners = np.concatenate([a[:8, :8].reshape(-1, 3), a[:8, -8:].reshape(-1, 3),
                              a[-8:, :8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    fg = np.abs(a - bg).max(axis=2) > THRESH

    # Chroma fringe. Where the figure meets the background the renderer
    # anti-aliased between skin and #FF00FF, leaving a pink halo about a pixel
    # wide that a hard threshold keeps. Erode the mask by one pixel to drop it:
    # these figures carry a heavy black outline, so a pixel off the edge is
    # invisible, whereas the halo is not.
    fg = ~dilate(~fg, 1)

    boxes = []
    for x0, x1 in contiguous(fg.any(axis=0)):
        if x1 - x0 < 20:
            continue  # a speck, not a person
        band = fg[:, x0:x1 + 1]
        for y0, y1 in contiguous(band.any(axis=1)):
            if y1 - y0 < 40:
                continue
            if y0 <= 1 or y1 >= H - 2:
                continue  # runs off the canvas: the figure is cut off
            boxes.append((x0, x1, y0, y1))

    if not boxes:
        raise SystemExit(f'{key}: no complete figures found')

    # Reading order: rows top to bottom, then left to right within a row.
    rowspan = max(b[3] - b[2] for b in boxes)
    boxes.sort(key=lambda b: (b[2] // max(1, rowspan // 2), b[0]))
    boxes = boxes[:8]

    crops = []
    for x0, x1, y0, y1 in boxes:
        cell = a[y0:y1 + 1, x0:x1 + 1].astype(np.int16)
        keep = fg[y0:y1 + 1, x0:x1 + 1]
        # Despill whatever magenta survived: on a pixel where both red and blue
        # sit above green, the excess is background bleed rather than paint —
        # nothing in the wardrobe is magenta, which is why the prompts forbid it.
        r, g, b = cell[:, :, 0], cell[:, :, 1], cell[:, :, 2]
        spill = keep & (r > g + 30) & (b > g + 30)
        if spill.any():
            cap = np.maximum(g, 0) + 30
            cell[:, :, 0] = np.where(spill, np.minimum(r, cap), r)
            cell[:, :, 2] = np.where(spill, np.minimum(b, cap), b)
        alpha = np.where(keep, 255, 0).astype(np.uint8)
        crops.append(np.dstack([cell.astype(np.uint8), alpha]))

    pad = 6
    fh = max(c.shape[0] for c in crops) + pad * 2
    fw = max(c.shape[1] for c in crops) + pad * 2
    tw = round(fw * TARGET_H / fh)
    strip = Image.new('RGBA', (tw * len(crops), TARGET_H), (0, 0, 0, 0))
    for i, c in enumerate(crops):
        frame = Image.new('RGBA', (fw, fh), (0, 0, 0, 0))
        # bottom-centre: every figure stands on the same line, so the loop does
        # not bob sideways or float
        frame.paste(Image.fromarray(c), ((fw - c.shape[1]) // 2, fh - pad - c.shape[0]))
        strip.paste(frame.resize((tw, TARGET_H), Image.LANCZOS), (i * tw, 0))
    strip.save(os.path.join(OUT, f'{PREFIX}{key}.webp'), 'WEBP', quality=86, method=6)
    return {'fw': tw, 'fh': TARGET_H, 'frames': len(crops)}


def main():
    meta = {}
    with open('scripts/sprite-urls.txt') as fh:
        for line in fh:
            if not line.strip() or line.lstrip().startswith('#'):
                continue  # blank and comment lines (added for NODE)
            parts = line.split()
            key, url = parts[0], parts[1]
            cols, rows, center, auto = 4, 2, False, False
            for tok in parts[2:]:
                if tok == 'center':
                    center = True
                elif tok == 'auto':
                    auto = True
                elif 'x' in tok:
                    cols, rows = (int(x) for x in tok.split('x'))
            path = f'/tmp/sheet_{key}.png'
            urllib.request.urlretrieve(url, path)
            meta[key] = process_auto(key, path) if auto else process(key, path, cols, rows, center)
            print(key, meta[key], os.path.getsize(os.path.join(OUT, f'{PREFIX}{key}.webp')), 'bytes')
    with open(os.path.join(OUT, f'{PREFIX}meta.json'), 'w') as fh:
        json.dump(meta, fh)


if __name__ == '__main__':
    main()
