"""Renders the QuiroFlow exercise catalogue's demonstration videos.

  python3 scripts/exercise-catalog/render.py                 every exercise
  python3 scripts/exercise-catalog/render.py bridge plank    just these
  python3 scripts/exercise-catalog/render.py --sheet DIR     key poses as PNGs, to check them

Writes public/exercise-catalog/<slug>.mp4 (a short loop) and <slug>.jpg (the
poster: the movement's end pose over a faint copy of its start). Needs Pillow
and an ffmpeg with libx264: either on PATH or from `pip install imageio-ffmpeg`.

The exercises themselves, and the text a clinic sees, are in exercises.py and
utils/exerciseCatalog.ts; every slug in one must be in the other
(tests/unit/exercise-catalog.test.ts checks).
"""
import math
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from figure import SEG, WIDTH, lerp, lowest_point, solve  # noqa: E402
from exercises import EXERCISES  # noqa: E402

W, H = 960, 540
SS = 2  # supersampling
FPS = 24
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'exercise-catalog')

BG = (246, 246, 250)
FLOOR = (214, 216, 226)
MAT = (226, 229, 251)
PROP = (205, 208, 220)
PROP_DARK = (178, 182, 198)
NEAR = (79, 70, 229)
FAR = (170, 165, 241)
FACE = (238, 240, 254)
BAND = (245, 158, 11)


def ffmpeg_exe():
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def timeline(ex):
    """Every frame's pose: rest, then each step (move, hold), repeated."""
    start = ex['start']
    frames = [start] * int(ex.get('rest', 0.6) * FPS)
    for _ in range(ex.get('repeat', 2)):
        prev = start
        for target, move, hold in ex['seq']:
            n = max(1, int(move * FPS))
            for i in range(1, n + 1):
                t = (1 - math.cos(math.pi * i / n)) / 2
                frames.append(lerp(prev, target, t))
            frames += [target] * int(hold * FPS)
            prev = target
    return frames


def camera(ex, poses):
    view = ex.get('view', 'side')
    xs, ys = [], [0.0]
    for p in poses[:: max(1, len(poses) // 60)] + [poses[-1]]:
        j = solve(p, view)
        for x, y in j.values():
            xs.append(x)
            ys.append(y)
    for prop in ex.get('props', []):
        kind = prop[0]
        if kind == 'wall':
            xs.append(prop[1])
        elif kind in ('mat', 'box', 'table', 'chair', 'stool'):
            xs += [prop[1], prop[2]]
            ys.append(prop[3] if len(prop) > 3 else 0)
    pad = 0.22
    x0, x1 = min(xs) - pad, max(xs) + pad
    y0, y1 = min(ys) - 0.12, max(ys) + pad
    scale = min(W * SS / (x1 - x0), H * SS / (y1 - y0))
    scale = min(scale, H * SS / 1.0)  # never closer than a metre of height
    cx = (x0 + x1) / 2
    # The floor sits near the bottom of the frame whatever the pose.
    cy = y0 + (H * SS / scale) / 2 - 0.04
    return lambda pt: ((pt[0] - cx) * scale + W * SS / 2, H * SS / 2 - (pt[1] - cy) * scale), scale


class Painter:
    def __init__(self, img, to_px, scale):
        self.d = ImageDraw.Draw(img)
        self.px = to_px
        self.s = scale

    def seg(self, a, b, width, color):
        pa, pb = self.px(a), self.px(b)
        w = width * self.s
        self.d.line([pa, pb], fill=color, width=max(1, int(w)))
        for q in (pa, pb):
            self.d.ellipse([q[0] - w / 2, q[1] - w / 2, q[0] + w / 2, q[1] + w / 2], fill=color)

    def dot(self, c, r, color):
        q = self.px(c)
        rr = r * self.s
        self.d.ellipse([q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr], fill=color)

    def rect(self, x0, y0, x1, y1, color, radius=0.02):
        a, b = self.px((x0, y1)), self.px((x1, y0))
        self.d.rounded_rectangle([a, b], radius=radius * self.s, fill=color)

    def poly(self, pts, color):
        self.d.polygon([self.px(p) for p in pts], fill=color)


def draw_props(pt, props, behind=True):
    for prop in props:
        kind = prop[0]
        if kind == 'mat' and behind:
            pt.rect(prop[1], -0.005, prop[2], 0.025, MAT, 0.012)
        elif kind == 'wall' and behind:
            x = prop[1]
            pt.rect(x, 0, x + 0.07, 2.4, PROP, 0.0)
        elif kind == 'box' and behind:
            pt.rect(prop[1], 0, prop[2], prop[3], PROP, 0.02)
        elif kind in ('stool', 'chair', 'table') and behind:
            x0, x1, h = prop[1], prop[2], prop[3]
            pt.rect(x0, h - 0.045, x1, h, PROP_DARK if kind != 'table' else PROP, 0.015)
            for lx in (x0 + 0.03, x1 - 0.06):
                pt.rect(lx, 0, lx + 0.03, h - 0.04, PROP, 0.0)
            if kind == 'chair':
                pt.rect(x0, h, x0 + 0.04, h + 0.45, PROP_DARK, 0.015)


def draw_bands(pt, props, j):
    for prop in props:
        if prop[0] in ('band', 'strap'):
            a = j[prop[1]] if isinstance(prop[1], str) else prop[1]
            b = j[prop[2]] if isinstance(prop[2], str) else prop[2]
            pt.seg(a, b, 0.022 if prop[0] == 'band' else 0.03, BAND)


def draw_figure(pt, j, p, view, near=NEAR, far=FAR, face=FACE):
    """Back to front, so near limbs cover far ones."""
    def arm(side, color):
        pt.seg(j['sh_' + side], j['elbow_' + side], WIDTH['upper_arm'], color)
        pt.seg(j['elbow_' + side], j['hand_' + side], WIDTH['forearm'], color)
        pt.dot(j['hand_' + side], WIDTH['hand'] / 2, color)

    def leg(side, color):
        pt.seg(j['hip_' + side], j['knee_' + side], WIDTH['thigh'], color)
        pt.seg(j['knee_' + side], j['ankle_' + side], WIDTH['shin'], color)
        pt.seg(j['ankle_' + side], j['toe_' + side], WIDTH['foot'], color)

    def trunk_side(color):
        P, M, N = j['pelvis'], j['mid'], j['neck']
        steps = 28
        for i in range(steps + 1):
            t = i / steps
            # Quadratic curve that passes through the mid-back point.
            cx, cy = 2 * M[0] - (P[0] + N[0]) / 2, 2 * M[1] - (P[1] + N[1]) / 2
            x = (1 - t) ** 2 * P[0] + 2 * (1 - t) * t * cx + t * t * N[0]
            y = (1 - t) ** 2 * P[1] + 2 * (1 - t) * t * cy + t * t * N[1]
            r = WIDTH['trunk'] / 2 * (1.08 - 0.12 * t)
            pt.dot((x, y), r, color)

    def head(color):
        pt.seg(j['neck'], j['neck_top'], WIDTH['neck'], color)
        C = j['head']
        r = SEG['head_r']
        pt.dot(C, r, color)
        up = math.radians(p['head'])
        if view == 'side':
            fwd = up - math.pi / 2
            pt.dot((C[0] + r * 0.93 * math.cos(fwd), C[1] + r * 0.93 * math.sin(fwd)), 0.028, color)
            ex = C[0] + r * 0.5 * math.cos(fwd) + r * 0.22 * math.cos(up)
            ey = C[1] + r * 0.5 * math.sin(fwd) + r * 0.22 * math.sin(up)
            pt.dot((ex, ey), 0.013, face)
        else:
            side = up - math.pi / 2
            def on_face(o, lift):
                return (C[0] + o * math.cos(side) + lift * math.cos(up), C[1] + o * math.sin(side) + lift * math.sin(up))
            for k in (-1, 1):
                o = k * 0.036 + p['turn'] * 0.05
                if abs(o) < r * 0.8:
                    pt.dot(on_face(o, 0.018), 0.013, face)
            pt.dot(on_face(p['turn'] * 0.075, -0.03), 0.011, face)

    if view == 'side':
        arm('b', far)
        leg('b', far)
        trunk_side(near)
        head(near)
        leg('a', near)
        arm('a', near)
    else:
        leg('b', near)
        leg('a', near)
        hw = WIDTH['hips_front'] / 2
        pt.seg(j['hip_a'], j['hip_b'], WIDTH['hips_front'] * 0.55, near)
        pt.poly([j['hip_a'], j['sh_a'], j['sh_b'], j['hip_b']], near)
        pt.seg(j['sh_a'], j['sh_b'], WIDTH['upper_arm'] * 1.3, near)
        pt.seg(j['pelvis'], j['neck'], hw * 1.2, near)
        head(near)
        arm('b', near)
        arm('a', near)


def render_frame(ex, p, to_px, scale, ghost=None):
    view = ex.get('view', 'side')
    img = Image.new('RGB', (W * SS, H * SS), BG)
    pt = Painter(img, to_px, scale)
    d = pt.d
    fy = to_px((0, 0))[1]
    d.rectangle([0, fy, W * SS, H * SS], fill=(240, 241, 247))
    d.line([(0, fy), (W * SS, fy)], fill=FLOOR, width=3 * SS)
    draw_props(pt, ex.get('props', []))
    if ghost is not None:
        layer = img.copy()
        gj = solve(ghost, view)
        draw_figure(Painter(layer, to_px, scale), gj, ghost, view)
        img = Image.blend(img, layer, 0.22)
        pt = Painter(img, to_px, scale)
    j = solve(p, view)
    draw_figure(pt, j, p, view)
    draw_bands(pt, ex.get('props', []), j)
    return img.resize((W, H), Image.LANCZOS)


def render(ex, sheet_dir=None):
    view = ex.get('view', 'side')
    frames = timeline(ex)
    to_px, scale = camera(ex, frames)
    low = min(lowest_point(solve(p, view), view) for p in frames)
    floor_ok = ex.get('floor', 0.0)
    if low < floor_ok - 0.03:
        print(f"  ! {ex['slug']}: something reaches {low:.3f} m, below the floor", file=sys.stderr)
    key = ex['seq'][ex.get('poster', 0)][0]
    if sheet_dir:
        os.makedirs(sheet_dir, exist_ok=True)
        shots = [ex['start']] + [s[0] for s in ex['seq']]
        tiles = [render_frame(ex, s, to_px, scale) for s in shots]
        sheet = Image.new('RGB', (W // 2 * len(tiles), H // 2), BG)
        for i, t in enumerate(tiles):
            sheet.paste(t.resize((W // 2, H // 2)), (i * W // 2, 0))
        sheet.save(os.path.join(sheet_dir, ex['slug'] + '.png'))
        return
    os.makedirs(OUT, exist_ok=True)
    render_frame(ex, key, to_px, scale, ghost=ex['start']).save(os.path.join(OUT, ex['slug'] + '.jpg'), quality=82, optimize=True)
    cmd = [ffmpeg_exe(), '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
           os.path.join(OUT, ex['slug'] + '.mp4')]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for p in frames:
        proc.stdin.write(render_frame(ex, p, to_px, scale).tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit(f"ffmpeg failed on {ex['slug']}")


def main(argv):
    sheet = None
    if '--sheet' in argv:
        i = argv.index('--sheet')
        sheet = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    wanted = set(argv)
    unknown = wanted - {e['slug'] for e in EXERCISES}
    if unknown:
        raise SystemExit('unknown: ' + ', '.join(sorted(unknown)))
    for ex in EXERCISES:
        if wanted and ex['slug'] not in wanted:
            continue
        print(ex['slug'])
        render(ex, sheet)


if __name__ == '__main__':
    main(sys.argv[1:])
