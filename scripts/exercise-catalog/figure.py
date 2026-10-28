"""The figure the catalogue videos are drawn with: a flat 2D person posed by
angles, solved into joint positions, and painted with Pillow.

World units are metres, the floor is y = 0 and y points up. Angles are in
degrees, counter-clockwise from +x, and absolute: an upright trunk is 90, an
arm hanging is -90, an arm pointing forward (the figure faces +x) is 0.

A pose is a dict; every key is optional and falls back to DEFAULT:

  pelvis   (x, y)            where the hips are
  lo, hi   spine angles       pelvis -> mid-back -> base of the neck
  neck     neck angle
  head     head angle         the direction the top of the head points
  turn     -1..1              head rotation, shown by the eyes (front view)
  sh       (dx, dy)           both shoulders moved (shrug, retraction)
  arm_a, arm_b, leg_a, leg_b  a limb, either
           {'a': (a1, a2)}             upper and lower segment angles, or
           {'t': (x, y), 'bend': s}    a target for the hand or ankle, solved
                                       with the elbow/knee to one side
           plus optional 'scale': (s1, s2) to foreshorten a segment that
           points at the camera, and on legs 'foot' (angle) and 'foot_len'
           (a foot pointing at the camera is drawn short).

Side view: _a is the near limb (solid), _b the far one (pale). Front view:
the person faces the camera, _a on screen-right, _b on screen-left.
"""
import math

SEG = dict(lo=0.24, hi=0.26, neck=0.10, head_off=0.085, head_r=0.105,
           upper_arm=0.29, forearm=0.27, thigh=0.44, shin=0.42, foot=0.15)
SHOULDER_HALF = 0.165
HIP_HALF = 0.085

WIDTH = dict(trunk=0.17, hips_front=0.24, neck=0.07,
             upper_arm=0.085, forearm=0.072, thigh=0.12, shin=0.095, foot=0.055, hand=0.075)

DEFAULT = {
    'pelvis': (0.0, 0.92), 'lo': 90.0, 'hi': 90.0, 'neck': 88.0, 'head': 90.0, 'turn': 0.0, 'sh': (0.0, 0.0),
    'arm_a': {'a': (-92.0, -88.0)}, 'arm_b': {'a': (-92.0, -88.0)},
    'leg_a': {'t': (0.02, 0.07), 'bend': 1, 'foot': 0.0}, 'leg_b': {'t': (-0.02, 0.07), 'bend': 1, 'foot': 0.0},
}


def pose(base=None, **changes):
    """A pose from a base with some keys replaced; limb dicts merge one level."""
    out = {}
    for src in (DEFAULT, base or {}, changes):
        for k, v in src.items():
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                merged = dict(out[k])
                # Switching a limb between angle and target mode drops the other.
                if 'a' in v:
                    merged.pop('t', None)
                if 't' in v:
                    merged.pop('a', None)
                merged.update(v)
                out[k] = merged
            else:
                out[k] = v
    return out


def lerp(a, b, t):
    if isinstance(a, dict):
        return {k: lerp(a[k], b[k], t) if k in b else a[k] for k in a}
    if isinstance(a, (tuple, list)):
        return tuple(lerp(x, y, t) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return a + (b - a) * t
    return a if t < 0.5 else b


def _pol(p, ang, length):
    r = math.radians(ang)
    return (p[0] + length * math.cos(r), p[1] + length * math.sin(r))


def _ik(p, t, l1, l2, bend):
    dx, dy = t[0] - p[0], t[1] - p[1]
    d = math.hypot(dx, dy)
    d = min(max(d, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
    th = math.atan2(dy, dx)
    ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    a1 = th + (1 if bend >= 0 else -1) * math.acos(max(-1.0, min(1.0, ca)))
    j = (p[0] + l1 * math.cos(a1), p[1] + l1 * math.sin(a1))
    a2 = math.atan2(t[1] - j[1], t[0] - j[0])
    return j, (j[0] + l2 * math.cos(a2), j[1] + l2 * math.sin(a2))


def _limb(root, spec, l1, l2):
    s1, s2 = spec.get('scale', (1.0, 1.0))
    if 't' in spec:
        return _ik(root, spec['t'], l1 * s1, l2 * s2, spec.get('bend', 1))
    a1, a2 = spec['a']
    j = _pol(root, a1, l1 * s1)
    return j, _pol(j, a2, l2 * s2)


def solve(p, view='side'):
    """Joint positions for a pose."""
    P = p['pelvis']
    mid = _pol(P, p['lo'], SEG['lo'])
    N = _pol(mid, p['hi'], SEG['hi'])
    S = _pol(N, p['hi'] + 180, 0.03)
    S = (S[0] + p['sh'][0], S[1] + p['sh'][1])
    if view == 'front':
        perp_hi, perp_lo = p['hi'] - 90, p['lo'] - 90
        sh_a, sh_b = _pol(S, perp_hi, SHOULDER_HALF), _pol(S, perp_hi + 180, SHOULDER_HALF)
        hip_a, hip_b = _pol(P, perp_lo, HIP_HALF), _pol(P, perp_lo + 180, HIP_HALF)
    else:
        sh_a = sh_b = S
        hip_a = hip_b = P
    H0 = _pol(N, p['neck'], SEG['neck'])
    C = _pol(H0, p['head'], SEG['head_off'])
    j = dict(pelvis=P, mid=mid, neck=N, neck_top=H0, head=C, sh_a=sh_a, sh_b=sh_b, hip_a=hip_a, hip_b=hip_b)
    for side, sh in (('a', sh_a), ('b', sh_b)):
        j['elbow_' + side], j['hand_' + side] = _limb(sh, p['arm_' + side], SEG['upper_arm'], SEG['forearm'])
    for side, hip in (('a', hip_a), ('b', hip_b)):
        leg = p['leg_' + side]
        j['knee_' + side], j['ankle_' + side] = _limb(hip, leg, SEG['thigh'], SEG['shin'])
        j['toe_' + side] = _pol(j['ankle_' + side], leg.get('foot', 0.0), SEG['foot'] * leg.get('foot_len', 1.0))
    return j


def lowest_point(j, view='side'):
    """The lowest painted point, to catch a pose that sinks into the floor."""
    pts = [(j['head'][1] - SEG['head_r'])]
    for k in ('hand_a', 'hand_b'):
        pts.append(j[k][1] - WIDTH['hand'] / 2)
    for k in ('elbow_a', 'elbow_b'):
        pts.append(j[k][1] - WIDTH['upper_arm'] / 2)
    for k in ('knee_a', 'knee_b'):
        pts.append(j[k][1] - WIDTH['thigh'] / 2)
    for k in ('ankle_a', 'ankle_b', 'toe_a', 'toe_b'):
        pts.append(j[k][1] - WIDTH['foot'] / 2)
    if view == 'side':
        for k in ('pelvis', 'mid', 'neck'):
            pts.append(j[k][1] - WIDTH['trunk'] / 2)
    return min(pts)
