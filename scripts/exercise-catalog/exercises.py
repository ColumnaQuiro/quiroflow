"""How each catalogue exercise moves: a start pose and the steps from it.

Each entry:
  slug     the file name, and the key utils/exerciseCatalog.ts uses
  view     'side' (default) or 'front'
  props    what is drawn around the figure: ('mat', x0, x1), ('wall', x),
           ('door', x), ('roller', x, r), ('ball', x, y, r),
           ('box', x0, x1, h), ('stool' | 'chair' | 'table', x0, x1, h),
           ('band' | 'strap', joint, joint-or-point) drawn over the figure
  start    the rest pose
  seq      [(pose, seconds moving, seconds holding), ...] from the start,
           normally ending back at it
  repeat   how many times seq plays (default 2)
  poster   which step's pose the poster shows (default 0)

A limb keeps one mode (angles or a target) through an exercise, because the
frames in between are interpolated key by key.
"""
import math

from figure import pose, solve

# ---- base poses ------------------------------------------------------------

STAND = pose()
STAND_F = pose(arm_a={'a': (-84.0, -88.0)}, arm_b={'a': (-96.0, -92.0)},
               leg_a={'t': (0.10, 0.07), 'bend': 1, 'foot': -25.0, 'foot_len': 0.5},
               leg_b={'t': (-0.10, 0.07), 'bend': -1, 'foot': -155.0, 'foot_len': 0.5})

SIT = pose(pelvis=(0.0, 0.53), lo=94.0, hi=90.0, neck=84.0, head=90.0,
           arm_a={'t': (0.30, 0.60), 'bend': -1}, arm_b={'t': (0.27, 0.60), 'bend': -1},
           leg_a={'t': (0.46, 0.07), 'bend': 1}, leg_b={'t': (0.42, 0.07), 'bend': 1})
STOOL = ('stool', -0.20, 0.20, 0.46)
CHAIR = ('chair', -0.20, 0.22, 0.46)

SUPINE = pose(pelvis=(0.0, 0.10), lo=180.0, hi=180.0, neck=175.0, head=172.0,
              arm_a={'a': (-3.0, -3.0)}, arm_b={'a': (-3.0, -3.0)},
              leg_a={'t': (0.38, 0.07), 'bend': 1, 'foot': 0.0}, leg_b={'t': (0.36, 0.07), 'bend': 1, 'foot': 0.0})
# The same, with the knees bent by angle rather than by where the feet are.
BENT_A = {'a': (57.0, -71.0), 'foot': 0.0}
BENT_B = {'a': (55.0, -72.0), 'foot': 0.0}
STRAIGHT = {'a': (-1.0, -1.0), 'foot': 90.0}
SUPINE_ANG = pose(SUPINE, leg_a=BENT_A, leg_b=BENT_B)
MAT = ('mat', -0.95, 0.95)

PRONE = pose(pelvis=(0.0, 0.10), lo=0.0, hi=0.0, neck=5.0, head=0.0,
             arm_a={'t': (0.36, 0.035), 'bend': -1}, arm_b={'t': (0.34, 0.035), 'bend': -1},
             leg_a={'a': (180.0, 180.0), 'foot': 185.0}, leg_b={'a': (181.0, 180.0), 'foot': 185.0})

QUAD = pose(pelvis=(0.0, 0.495), lo=12.0, hi=12.0, neck=20.0, head=5.0,
            arm_a={'a': (-90.0, -90.0)}, arm_b={'a': (-92.0, -92.0)},
            leg_a={'a': (-90.0, -180.0), 'foot': -180.0}, leg_b={'a': (-93.0, -180.0), 'foot': -180.0})
QUAD_IK = pose(QUAD, arm_a={'t': (0.46, 0.035), 'bend': -1}, arm_b={'t': (0.44, 0.035), 'bend': -1})
MAT_QUAD = ('mat', -0.75, 0.80)

# Lying on the left side, facing the camera: a front view turned 90 degrees,
# so the top hip and shoulder are _a.
SIDE_LYING = pose(pelvis=(0.0, 0.19), lo=180.0, hi=180.0, neck=190.0, head=200.0,
                  arm_a={'a': (-30.0, -60.0)}, arm_b={'a': (180.0, 180.0)},
                  leg_a={'a': (-5.0, -5.0), 'foot': 60.0, 'foot_len': 0.4},
                  leg_b={'a': (-1.0, -1.0), 'foot': 60.0, 'foot_len': 0.4})
MAT_SIDE = ('mat', -1.1, 0.95)

p = pose  # shorthand below

EXERCISES = [
    # ---- neck ----------------------------------------------------------------
    dict(slug='chin-tuck', props=[STOOL],
         start=p(SIT, neck=66.0, head=86.0),
         seq=[(p(SIT, neck=104.0, head=94.0), 1.0, 2.0), (p(SIT, neck=66.0, head=86.0), 1.0, 0.6)], repeat=3),
    dict(slug='neck-side-bend', view='front',
         start=STAND_F,
         seq=[(p(STAND_F, neck=74.0, head=50.0), 1.4, 2.0), (STAND_F, 1.1, 0.4),
              (p(STAND_F, neck=106.0, head=130.0), 1.4, 2.0), (STAND_F, 1.1, 0.4)], repeat=1),
    dict(slug='neck-rotation', view='front',
         start=STAND_F,
         seq=[(p(STAND_F, turn=0.95), 1.3, 1.8), (STAND_F, 1.1, 0.4),
              (p(STAND_F, turn=-0.95), 1.3, 1.8), (STAND_F, 1.1, 0.4)], repeat=1),
    # ---- shoulders and upper back ----------------------------------------------
    dict(slug='scapular-retraction', props=[STOOL],
         start=p(SIT, arm_a={'a': (-88.0, 0.0)}, arm_b={'a': (-90.0, 2.0)}),
         seq=[(p(SIT, sh=(-0.04, 0.0), hi=92.0, arm_a={'a': (-116.0, -4.0)}, arm_b={'a': (-118.0, -2.0)}), 1.0, 2.5),
              (p(SIT, arm_a={'a': (-88.0, 0.0)}, arm_b={'a': (-90.0, 2.0)}), 1.0, 0.6)]),
    dict(slug='thoracic-extension', props=[STOOL],
         start=p(SIT, arm_a={'a': (-70.0, 105.0)}, arm_b={'a': (-74.0, 100.0)}),
         seq=[(p(SIT, lo=98.0, hi=122.0, neck=130.0, head=124.0, arm_a={'a': (-40.0, 135.0)}, arm_b={'a': (-44.0, 130.0)}), 1.6, 1.5),
              (p(SIT, arm_a={'a': (-70.0, 105.0)}, arm_b={'a': (-74.0, 100.0)}), 1.4, 0.6)]),
    dict(slug='wall-angels', view='front',
         start=p(STAND_F, arm_a={'a': (-35.0, 80.0)}, arm_b={'a': (-145.0, 100.0)}),
         seq=[(p(STAND_F, arm_a={'a': (62.0, 72.0)}, arm_b={'a': (118.0, 108.0)}), 1.8, 0.6),
              (p(STAND_F, arm_a={'a': (-35.0, 80.0)}, arm_b={'a': (-145.0, 100.0)}), 1.8, 0.6)]),
    dict(slug='pendulum', props=[('table', 0.62, 1.15, 0.75)],
         start=p(STAND, pelvis=(0.0, 0.90), lo=35.0, hi=28.0, neck=20.0, head=-5.0,
                 arm_a={'a': (-90.0, -90.0)}, arm_b={'t': (0.82, 0.78), 'bend': -1},
                 leg_a={'t': (0.14, 0.07), 'bend': 1}, leg_b={'t': (-0.20, 0.07), 'bend': 1}),
         seq=[], repeat=1),
    dict(slug='shoulder-external-rotation', view='front',
         props=[('band', 'hand_a', 'hand_b')],
         start=p(STAND_F, arm_a={'a': (-90.0, -8.0), 'scale': (1.0, 0.3)}, arm_b={'a': (-90.0, -172.0), 'scale': (1.0, 0.3)}),
         seq=[(p(STAND_F, arm_a={'a': (-90.0, 6.0), 'scale': (1.0, 0.95)}, arm_b={'a': (-90.0, 174.0), 'scale': (1.0, 0.95)}), 1.3, 1.2),
              (p(STAND_F, arm_a={'a': (-90.0, -8.0), 'scale': (1.0, 0.3)}, arm_b={'a': (-90.0, -172.0), 'scale': (1.0, 0.3)}), 1.3, 0.5)]),
    dict(slug='cross-body-stretch', view='front',
         start=p(STAND_F, arm_a={'t': (0.20, 0.835), 'bend': 1}, arm_b={'t': (-0.20, 0.835), 'bend': -1}),
         seq=[(p(STAND_F, arm_a={'t': (-0.42, 1.33), 'bend': 1}, arm_b={'t': (-0.04, 1.30), 'bend': -1}), 1.4, 2.5),
              (p(STAND_F, arm_a={'t': (0.20, 0.835), 'bend': 1}, arm_b={'t': (-0.20, 0.835), 'bend': -1}), 1.2, 0.4),
              (p(STAND_F, arm_b={'t': (0.42, 1.33), 'bend': -1}, arm_a={'t': (0.04, 1.30), 'bend': 1}), 1.4, 2.5),
              (p(STAND_F, arm_a={'t': (0.20, 0.835), 'bend': 1}, arm_b={'t': (-0.20, 0.835), 'bend': -1}), 1.2, 0.4)], repeat=1),
    # ---- low back and core -----------------------------------------------------
    dict(slug='glute-bridge', props=[MAT],
         start=SUPINE,
         seq=[(p(SUPINE, pelvis=(0.0, 0.36), lo=207.0, hi=207.0, neck=192.0, head=185.0), 1.4, 1.5), (SUPINE, 1.4, 0.8)]),
    dict(slug='dead-bug', props=[MAT],
         start=p(SUPINE, arm_a={'a': (88.0, 88.0)}, arm_b={'a': (92.0, 92.0)},
                 leg_a={'a': (90.0, 0.0), 'foot': 90.0}, leg_b={'a': (88.0, -2.0), 'foot': 88.0}),
         seq=[], repeat=1),
    dict(slug='bird-dog', props=[MAT_QUAD],
         start=QUAD,
         seq=[(p(QUAD, neck=12.0, head=0.0, arm_a={'a': (10.0, 10.0)}, leg_b={'a': (-182.0, -182.0), 'foot': -172.0}), 1.4, 1.6), (QUAD, 1.1, 0.4),
              (p(QUAD, neck=12.0, head=0.0, arm_b={'a': (10.0, 10.0)}, leg_a={'a': (-182.0, -182.0), 'foot': -172.0}), 1.4, 1.6), (QUAD, 1.1, 0.4)],
         repeat=1),
    dict(slug='cat-camel', props=[MAT_QUAD],
         start=QUAD_IK,
         seq=[(p(QUAD_IK, lo=36.0, hi=-12.0, neck=-40.0, head=-62.0), 1.6, 1.0),
              (p(QUAD_IK, lo=-10.0, hi=34.0, neck=40.0, head=30.0), 2.2, 1.0),
              (QUAD_IK, 1.4, 0.3)]),
    dict(slug='childs-pose', props=[MAT_QUAD],
         start=QUAD_IK,
         seq=[(p(QUAD_IK, pelvis=(-0.33, 0.27), lo=5.0, hi=-8.0, neck=-20.0, head=-60.0,
                 arm_a={'t': (0.66, 0.05), 'bend': 1}, arm_b={'t': (0.64, 0.05), 'bend': 1},
                 leg_a={'a': (-30.0, -180.0), 'foot': -180.0}, leg_b={'a': (-32.0, -180.0), 'foot': -180.0}), 2.2, 2.5),
              (QUAD_IK, 1.8, 0.5)], repeat=1),
    dict(slug='knee-to-chest', props=[MAT],
         start=SUPINE_ANG,
         seq=[(p(SUPINE_ANG, leg_a={'a': (128.0, 25.0), 'foot': 60.0}, arm_a={'a': (95.0, 30.0)}, arm_b={'a': (97.0, 28.0)}), 1.3, 2.5), (SUPINE_ANG, 1.2, 0.4),
              (p(SUPINE_ANG, leg_b={'a': (128.0, 25.0), 'foot': 60.0}, arm_a={'a': (95.0, 30.0)}, arm_b={'a': (97.0, 28.0)}), 1.3, 2.5), (SUPINE_ANG, 1.2, 0.4)],
         repeat=1),
    dict(slug='prone-press-up', props=[MAT],
         start=PRONE,
         seq=[(p(PRONE, lo=36.0, hi=60.0, neck=68.0, head=62.0), 1.6, 1.5), (PRONE, 1.4, 0.6)]),
    dict(slug='forearm-plank', props=[MAT],
         start=p(PRONE, pelvis=(0.0, 0.10), lo=28.0, hi=32.0, neck=30.0, head=10.0,
                 arm_a={'a': (-90.0, 0.0)}, arm_b={'a': (-91.0, 1.0)}),
         seq=[(p(PRONE, pelvis=(0.0, 0.345), lo=6.0, hi=6.0, neck=10.0, head=0.0,
                 arm_a={'a': (-90.0, 0.0)}, arm_b={'a': (-91.0, 1.0)},
                 leg_a={'a': (191.5, 191.5), 'foot': 292.0}, leg_b={'a': (191.0, 191.5), 'foot': 292.0}), 1.3, 3.0),
              (p(PRONE, pelvis=(0.0, 0.10), lo=28.0, hi=32.0, neck=30.0, head=10.0,
                 arm_a={'a': (-90.0, 0.0)}, arm_b={'a': (-91.0, 1.0)}), 1.3, 0.8)], repeat=1),
    dict(slug='side-plank', view='front', props=[MAT_SIDE],
         start=p(SIDE_LYING, pelvis=(0.0, 0.17), lo=152.0, hi=152.0, neck=152.0, head=150.0,
                 arm_a={'t': (0.04, 0.27), 'bend': 1}, arm_b={'t': (-0.50, 0.04), 'bend': -1, 'scale': (0.52, 0.52)},
                 leg_a={'a': (-7.0, -7.0), 'foot': 60.0, 'foot_len': 0.4}, leg_b={'a': (-3.0, -3.0), 'foot': 60.0, 'foot_len': 0.4}),
         seq=[(p(SIDE_LYING, pelvis=(0.0, 0.34), lo=165.0, hi=165.0, neck=165.0, head=163.0,
                 arm_a={'t': (0.02, 0.48), 'bend': 1}, arm_b={'t': (-0.50, 0.04), 'bend': -1, 'scale': (0.52, 0.52)},
                 leg_a={'a': (-20.0, -20.0), 'foot': 60.0, 'foot_len': 0.4}, leg_b={'a': (-15.0, -15.0), 'foot': 60.0, 'foot_len': 0.4}), 1.3, 3.0),
              (p(SIDE_LYING, pelvis=(0.0, 0.17), lo=152.0, hi=152.0, neck=152.0, head=150.0,
                 arm_a={'t': (0.04, 0.27), 'bend': 1}, arm_b={'t': (-0.50, 0.04), 'bend': -1, 'scale': (0.52, 0.52)},
                 leg_a={'a': (-7.0, -7.0), 'foot': 60.0, 'foot_len': 0.4}, leg_b={'a': (-3.0, -3.0), 'foot': 60.0, 'foot_len': 0.4}), 1.3, 0.8)], repeat=1),
    # ---- hips ------------------------------------------------------------------
    dict(slug='piriformis-stretch', props=[MAT],
         # Starts already crossed: uncrossing would flip the knee to the other side.
         start=p(SUPINE, leg_a={'t': (0.25, 0.52), 'bend': -1, 'scale': (0.7, 0.7)}, leg_b=BENT_B),
         seq=[(p(SUPINE, leg_a={'t': (-0.03, 0.60), 'bend': -1, 'scale': (0.7, 0.7)}, leg_b={'a': (95.0, 5.0), 'foot': 60.0},
                 arm_a={'a': (80.0, 35.0)}, arm_b={'a': (83.0, 32.0)}), 1.4, 2.5),
              (p(SUPINE, leg_a={'t': (0.25, 0.52), 'bend': -1, 'scale': (0.7, 0.7)}, leg_b=BENT_B), 1.3, 0.6)]),
    dict(slug='hip-flexor-stretch', props=[MAT],
         start=p(STAND, pelvis=(0.0, 0.48), leg_a={'t': (0.45, 0.07), 'bend': 1}, leg_b={'a': (-100.0, -180.0), 'foot': 180.0}),
         seq=[(p(STAND, pelvis=(0.14, 0.44), leg_a={'t': (0.45, 0.07), 'bend': 1}, leg_b={'a': (-114.0, -180.0), 'foot': 180.0},
                 lo=92.0, hi=96.0, arm_a={'a': (98.0, 100.0)}), 1.6, 2.5),
              (p(STAND, pelvis=(0.0, 0.48), leg_a={'t': (0.45, 0.07), 'bend': 1}, leg_b={'a': (-100.0, -180.0), 'foot': 180.0}), 1.4, 0.6)], repeat=1),
    dict(slug='side-lying-hip-abduction', view='front', props=[MAT_SIDE],
         start=SIDE_LYING,
         seq=[(p(SIDE_LYING, leg_a={'a': (24.0, 24.0), 'foot': 60.0, 'foot_len': 0.4}), 1.2, 1.2), (SIDE_LYING, 1.2, 0.4)]),
    dict(slug='clamshell', view='front', props=[MAT_SIDE],
         start=p(SIDE_LYING, leg_a={'a': (-8.0, -8.0), 'scale': (0.6, 0.6), 'foot': 60.0, 'foot_len': 0.4},
                 leg_b={'a': (-3.0, -3.0), 'scale': (0.6, 0.6), 'foot': 60.0, 'foot_len': 0.4}),
         seq=[(p(SIDE_LYING, leg_a={'a': (32.0, -42.0), 'scale': (0.6, 0.6), 'foot': 60.0, 'foot_len': 0.4},
                 leg_b={'a': (-3.0, -3.0), 'scale': (0.6, 0.6), 'foot': 60.0, 'foot_len': 0.4}), 1.1, 1.2),
              (p(SIDE_LYING, leg_a={'a': (-8.0, -8.0), 'scale': (0.6, 0.6), 'foot': 60.0, 'foot_len': 0.4},
                 leg_b={'a': (-3.0, -3.0), 'scale': (0.6, 0.6), 'foot': 60.0, 'foot_len': 0.4}), 1.1, 0.4)]),
    dict(slug='hamstring-stretch', props=[MAT, ('strap', 'hand_a', 'toe_a')],
         start=p(SUPINE, leg_a=BENT_A, leg_b=STRAIGHT, arm_a={'a': (60.0, 30.0)}, arm_b={'a': (62.0, 28.0)}),
         seq=[(p(SUPINE, leg_a={'a': (72.0, 72.0), 'foot': 160.0}, leg_b=STRAIGHT, arm_a={'a': (62.0, 50.0)}, arm_b={'a': (64.0, 48.0)}), 1.6, 3.0),
              (p(SUPINE, leg_a=BENT_A, leg_b=STRAIGHT, arm_a={'a': (60.0, 30.0)}, arm_b={'a': (62.0, 28.0)}), 1.4, 0.6)], repeat=1),
    # ---- knees and legs ----------------------------------------------------------
    dict(slug='sit-to-stand', props=[CHAIR],
         start=p(SIT, arm_a={'a': (-70.0, 105.0)}, arm_b={'a': (-74.0, 100.0)}),
         seq=[(p(SIT, pelvis=(0.06, 0.56), lo=52.0, hi=56.0, neck=62.0, head=72.0, arm_a={'a': (-108.0, 67.0)}, arm_b={'a': (-112.0, 62.0)}), 0.9, 0.0),
              (p(SIT, pelvis=(0.40, 0.91), lo=90.0, hi=90.0, neck=88.0, head=90.0, arm_a={'a': (-70.0, 105.0)}, arm_b={'a': (-74.0, 100.0)}), 1.1, 0.8),
              (p(SIT, pelvis=(0.06, 0.56), lo=52.0, hi=56.0, neck=62.0, head=72.0, arm_a={'a': (-108.0, 67.0)}, arm_b={'a': (-112.0, 62.0)}), 1.2, 0.0),
              (p(SIT, arm_a={'a': (-70.0, 105.0)}, arm_b={'a': (-74.0, 100.0)}), 0.9, 0.6)],
         poster=1),
    dict(slug='heel-slides', props=[MAT],
         start=p(SUPINE, leg_a=STRAIGHT, leg_b=STRAIGHT),
         seq=[(p(SUPINE, leg_a=BENT_A, leg_b=STRAIGHT), 1.6, 0.8), (p(SUPINE, leg_a=STRAIGHT, leg_b=STRAIGHT), 1.6, 0.5)]),
    dict(slug='straight-leg-raise', props=[MAT],
         start=p(SUPINE, leg_a=STRAIGHT, leg_b=BENT_B),
         seq=[(p(SUPINE, leg_a={'a': (40.0, 40.0), 'foot': 128.0}, leg_b=BENT_B), 1.4, 1.8), (p(SUPINE, leg_a=STRAIGHT, leg_b=BENT_B), 1.4, 0.6)]),
    dict(slug='step-up', props=[('box', 0.25, 0.75, 0.20)],
         start=STAND,
         seq=[(p(STAND, pelvis=(0.08, 0.90), lo=84.0, hi=82.0, leg_a={'t': (0.47, 0.27), 'bend': 1}), 0.9, 0.2),
              (p(STAND, pelvis=(0.40, 1.08), lo=86.0, hi=86.0, leg_a={'t': (0.47, 0.27), 'bend': 1}, leg_b={'t': (0.22, 0.42), 'bend': 1}), 1.0, 0.0),
              (p(STAND, pelvis=(0.44, 1.12), leg_a={'t': (0.47, 0.27), 'bend': 1}, leg_b={'t': (0.42, 0.27), 'bend': 1}), 0.5, 0.7),
              (p(STAND, pelvis=(0.40, 1.08), lo=86.0, hi=86.0, leg_a={'t': (0.47, 0.27), 'bend': 1}, leg_b={'t': (0.16, 0.40), 'bend': 1}), 0.6, 0.0),
              (p(STAND, pelvis=(0.08, 0.90), lo=84.0, hi=82.0, leg_a={'t': (0.47, 0.27), 'bend': 1}), 1.0, 0.0),
              (STAND, 0.8, 0.5)], repeat=1, poster=2),
    dict(slug='standing-quad-stretch', props=[('wall', 0.60)],
         start=p(STAND, arm_a={'t': (0.02, 0.84), 'bend': -1}, arm_b={'t': (-0.02, 0.84), 'bend': -1}, leg_a={'a': (-92.0, -90.0), 'foot': 0.0}),
         seq=[(p(STAND, arm_a={'t': (-0.15, 0.87), 'bend': -1}, arm_b={'t': (0.58, 1.22), 'bend': -1},
                 leg_a={'a': (-95.0, -255.0), 'foot': -170.0}), 1.6, 3.0),
              (p(STAND, arm_a={'t': (0.02, 0.84), 'bend': -1}, arm_b={'t': (-0.02, 0.84), 'bend': -1}, leg_a={'a': (-92.0, -90.0), 'foot': 0.0}), 1.4, 0.6)],
         repeat=1),
    dict(slug='calf-raise', props=[('wall', 0.60)],
         start=p(STAND, arm_a={'t': (0.58, 1.22), 'bend': -1}, arm_b={'t': (0.58, 1.18), 'bend': -1}),
         seq=[(p(STAND, pelvis=(0.03, 1.00), arm_a={'t': (0.58, 1.22), 'bend': -1}, arm_b={'t': (0.58, 1.18), 'bend': -1},
                 leg_a={'t': (0.06, 0.16), 'bend': 1, 'foot': -45.0}, leg_b={'t': (0.02, 0.16), 'bend': 1, 'foot': -45.0}), 1.0, 1.0),
              (p(STAND, arm_a={'t': (0.58, 1.22), 'bend': -1}, arm_b={'t': (0.58, 1.18), 'bend': -1}), 1.0, 0.5)]),
    dict(slug='calf-stretch', props=[('wall', 0.78)],
         start=p(STAND, pelvis=(0.08, 0.88), lo=86.0, hi=86.0, arm_a={'t': (0.76, 1.30), 'bend': -1}, arm_b={'t': (0.76, 1.26), 'bend': -1},
                 leg_a={'t': (0.40, 0.07), 'bend': 1}, leg_b={'t': (-0.20, 0.07), 'bend': 1}),
         seq=[(p(STAND, pelvis=(0.22, 0.82), lo=72.0, hi=72.0, neck=76.0, arm_a={'t': (0.76, 1.30), 'bend': -1}, arm_b={'t': (0.76, 1.26), 'bend': -1},
                 leg_a={'t': (0.40, 0.07), 'bend': 1}, leg_b={'t': (-0.20, 0.07), 'bend': 1}), 1.5, 3.0),
              (p(STAND, pelvis=(0.08, 0.88), lo=86.0, hi=86.0, arm_a={'t': (0.76, 1.30), 'bend': -1}, arm_b={'t': (0.76, 1.26), 'bend': -1},
                 leg_a={'t': (0.40, 0.07), 'bend': 1}, leg_b={'t': (-0.20, 0.07), 'bend': 1}), 1.3, 0.6)], repeat=1),
    dict(slug='single-leg-balance',
         start=p(STAND, arm_a={'t': (0.06, 0.95), 'bend': -1}, arm_b={'t': (0.04, 0.95), 'bend': -1}),
         seq=[(p(STAND, arm_a={'t': (0.06, 0.95), 'bend': -1}, arm_b={'t': (0.04, 0.95), 'bend': -1}, leg_b={'t': (0.20, 0.47), 'bend': 1, 'foot': -20.0}), 1.0, 0.8),
              (p(STAND, lo=88.0, hi=92.0, arm_a={'t': (0.05, 0.95), 'bend': -1}, arm_b={'t': (0.03, 0.95), 'bend': -1}, leg_b={'t': (0.21, 0.46), 'bend': 1, 'foot': -20.0}), 1.2, 0.0),
              (p(STAND, lo=91.0, hi=89.0, arm_a={'t': (0.07, 0.95), 'bend': -1}, arm_b={'t': (0.05, 0.95), 'bend': -1}, leg_b={'t': (0.19, 0.47), 'bend': 1, 'foot': -20.0}), 1.2, 0.0),
              (p(STAND, arm_a={'t': (0.06, 0.95), 'bend': -1}, arm_b={'t': (0.04, 0.95), 'bend': -1}, leg_b={'t': (0.20, 0.47), 'bend': 1, 'foot': -20.0}), 1.0, 0.5),
              (p(STAND, arm_a={'t': (0.06, 0.95), 'bend': -1}, arm_b={'t': (0.04, 0.95), 'bend': -1}), 1.0, 0.6)], repeat=1),
    # ---- trunk -----------------------------------------------------------------
    dict(slug='standing-side-bend', view='front',
         start=STAND_F,
         seq=[(p(STAND_F, lo=84.0, hi=68.0, neck=64.0, head=62.0, arm_b={'a': (-280.0, -340.0)}, arm_a={'a': (-80.0, -82.0)}), 1.8, 2.0), (STAND_F, 1.5, 0.4),
              (p(STAND_F, lo=96.0, hi=112.0, neck=116.0, head=118.0, arm_a={'a': (100.0, 160.0)}, arm_b={'a': (-100.0, -98.0)}), 1.8, 2.0), (STAND_F, 1.5, 0.4)],
         repeat=1),
]

# Rhythmic ones are easier to write out than to list by hand.
_pend = EXERCISES[[e['slug'] for e in EXERCISES].index('pendulum')]
_swing = []
for a in (-68.0, -112.0, -68.0, -112.0, -68.0, -112.0):
    _swing.append((p(_pend['start'], arm_a={'a': (a, a)}), 0.8, 0.0))
_swing.append((_pend['start'], 0.5, 0.4))
_pend['seq'] = _swing

_bug = EXERCISES[[e['slug'] for e in EXERCISES].index('dead-bug')]
_s = _bug['start']
_bug['seq'] = [
    (p(_s, arm_a={'a': (172.0, 172.0)}, leg_b={'a': (10.0, 10.0), 'foot': 70.0}), 1.6, 1.0), (_s, 1.3, 0.3),
    (p(_s, arm_b={'a': (172.0, 172.0)}, leg_a={'a': (10.0, 10.0), 'foot': 70.0}), 1.6, 1.0), (_s, 1.3, 0.3),
]

# ---- added from the clinic's own list (28 Oct 2026) ---------------------------

# Both scalene stretches tilt the head away from the side being stretched
# (screen-left here, the person's right): the anterior one looking up, with
# both hands holding that collarbone down; the posterior one looking down,
# with that arm reaching for the floor and the other hand resting on the head.
_ant = p(STAND_F, arm_a={'t': (-0.06, 1.30), 'bend': 1}, arm_b={'t': (-0.11, 1.28), 'bend': -1})
_post_head = p(STAND_F, neck=66.0, head=38.0, nod=-0.7)
_hc = solve(_post_head, 'front')['head']
_post_rest = p(STAND_F, arm_a={'t': (0.19, 0.83), 'bend': -1}, arm_b={'a': (-96.0, -92.0)})
_post = p(_post_head, arm_a={'t': (_hc[0] - 0.02, _hc[1] + 0.09), 'bend': -1}, arm_b={'a': (-100.0, -97.0)}, sh=(0.0, -0.02))


def _crab(px, a, b):
    """Lateral band walk, front view: the pelvis follows the feet, hands on hips."""
    return p(STAND_F, pelvis=(px, 0.84),
             leg_a={'t': a, 'bend': 1, 'foot': -25.0, 'foot_len': 0.5},
             leg_b={'t': b, 'bend': -1, 'foot': -155.0, 'foot_len': 0.5},
             arm_a={'t': (px + 0.15, 0.97), 'bend': 1}, arm_b={'t': (px - 0.15, 0.97), 'bend': -1})


_crab0 = _crab(0.0, (0.15, 0.07), (-0.15, 0.07))


def _roller(hi, neck, head):
    """On a foam roller with the hands behind the head: the hands follow the
    head, so their targets come from the solved pose."""
    base = p(SUPINE, lo=150.0, hi=hi, neck=neck, head=head)
    c = solve(base)['head']
    back = math.radians(head + 90.0)
    hand = (c[0] + 0.10 * math.cos(back), c[1] + 0.10 * math.sin(back))
    return p(base, arm_a={'t': hand, 'bend': -1}, arm_b={'t': (hand[0] + 0.02, hand[1] - 0.01), 'bend': -1})


_roll0 = _roller(166.0, 170.0, 165.0)

_door0 = p(STAND, arm_a={'a': (178.0, 92.0), 'scale': (0.42, 1.0)}, arm_b={'a': (176.0, 94.0), 'scale': (0.42, 1.0)})
_STAGGER = dict(leg_a={'t': (0.15, 0.07), 'bend': 1}, leg_b={'t': (-0.12, 0.07), 'bend': 1})
_face0 = p(STAND, arm_a={'t': (0.53, 1.50), 'bend': 1, 'scale': (1.0, 1.0)}, arm_b={'t': (0.51, 1.48), 'bend': 1, 'scale': (1.0, 1.0)}, **_STAGGER)
_row0 = p(STAND, arm_a={'t': (0.50, 1.08), 'bend': -1}, arm_b={'t': (0.48, 1.06), 'bend': -1}, **_STAGGER)
_pnf0 = p(STAND_F, arm_a={'t': (-0.20, 0.92), 'bend': -1, 'scale': (1.0, 1.0)}, turn=-0.4, nod=-0.4)
_pnf_mid = p(STAND_F, arm_a={'t': (0.22, 1.22), 'bend': -1, 'scale': (0.3, 0.3)}, turn=0.0, nod=0.0)
_pnf1 = p(STAND_F, arm_a={'t': (0.52, 1.82), 'bend': -1, 'scale': (1.0, 1.0)}, turn=0.5, nod=0.6)
_psoas0 = p(SIT, lo=90.0, arm_a={'t': (0.15, 0.50), 'bend': -1}, arm_b={'t': (0.13, 0.50), 'bend': -1})
_piri = dict(lo=95.0, hi=104.0, neck=94.0, head=90.0,
             leg_a={'t': (0.22, 0.07), 'bend': 1}, leg_b={'t': (0.18, 0.07), 'bend': 1})
_hip_pend0 = p(STAND, pelvis=(0.0, 1.06), arm_a={'t': (0.60, 1.30), 'bend': -1},
               leg_a={'a': (-90.0, -90.0), 'foot': 0.0}, leg_b={'t': (0.0, 0.22), 'bend': 1})

EXERCISES += [
    dict(slug='anterior-scalene-stretch', view='front',
         start=_ant,
         seq=[(p(_ant, neck=66.0, head=38.0, nod=0.9), 1.6, 3.0), (_ant, 1.4, 0.6)]),
    dict(slug='posterior-scalene-stretch', view='front',
         start=_post_rest,
         seq=[(_post, 1.8, 3.0), (_post_rest, 1.5, 0.6)]),
    dict(slug='thoracic-extension-roller', props=[MAT, ('roller', -0.21, 0.075)],
         start=_roll0,
         seq=[(_roller(186.0, 190.0, 195.0), 1.6, 2.0), (_roll0, 1.4, 0.6)]),
    dict(slug='doorway-pec-stretch', props=[('door', -0.165)],
         start=_door0,
         seq=[(p(_door0, pelvis=(0.10, 0.90), lo=86.0, hi=84.0, neck=86.0,
                 arm_a={'a': (180.0, 92.0), 'scale': (0.95, 1.0)}, arm_b={'a': (178.0, 94.0), 'scale': (0.95, 1.0)},
                 leg_a={'t': (0.38, 0.07), 'bend': 1}), 1.6, 3.0),
              (_door0, 1.4, 0.6)], repeat=1),
    dict(slug='band-row', props=[('wall', 1.0), ('band', 'hand_a', (1.0, 1.05))],
         start=_row0,
         seq=[(p(_row0, sh=(-0.04, 0.0), arm_a={'t': (0.12, 1.02), 'bend': -1}, arm_b={'t': (0.10, 1.00), 'bend': -1}), 1.2, 1.0),
              (_row0, 1.2, 0.4)]),
    dict(slug='face-pull', props=[('wall', 1.0), ('band', 'hand_a', (1.0, 1.55))],
         start=_face0,
         seq=[(p(_face0, sh=(-0.03, 0.0), arm_a={'t': (0.15, 1.63), 'bend': 1, 'scale': (0.6, 1.0)},
                 arm_b={'t': (0.13, 1.61), 'bend': 1, 'scale': (0.6, 1.0)}), 1.2, 1.0),
              (_face0, 1.2, 0.4)]),
    dict(slug='pnf-shoulder-diagonal', view='front', props=[('band', 'hand_a', (-0.10, 0.05))],
         start=_pnf0,
         seq=[(_pnf_mid, 0.7, 0.0), (_pnf1, 0.7, 0.6), (_pnf_mid, 0.8, 0.0), (_pnf0, 0.8, 0.4)], poster=1),
    dict(slug='lateral-band-walk', view='front', props=[('band', 'ankle_a', 'ankle_b')],
         start=_crab0,
         seq=[(_crab(0.07, (0.40, 0.13), (-0.15, 0.07)), 0.45, 0.0),
              (_crab(0.12, (0.40, 0.07), (-0.15, 0.07)), 0.3, 0.1),
              (_crab(0.20, (0.40, 0.07), (0.12, 0.13)), 0.45, 0.0),
              (_crab(0.25, (0.40, 0.07), (0.10, 0.07)), 0.3, 0.2),
              (_crab(0.18, (0.40, 0.07), (-0.15, 0.13)), 0.45, 0.0),
              (_crab(0.13, (0.40, 0.07), (-0.15, 0.07)), 0.3, 0.1),
              (_crab(0.05, (0.17, 0.13), (-0.15, 0.07)), 0.45, 0.0),
              (_crab0, 0.3, 0.2)], poster=1),
    dict(slug='psoas-activation', props=[STOOL],
         start=_psoas0,
         seq=[(p(_psoas0, leg_a={'t': (0.40, 0.30), 'bend': 1}), 1.0, 3.0), (_psoas0, 1.0, 0.6)]),
    dict(slug='piriformis-ball-release', props=[('wall', -0.30), ('ball', -0.175, 0.86, 0.055)],
         start=p(STAND, pelvis=(-0.03, 0.86), **_piri),
         seq=[(p(STAND, pelvis=(-0.03, 0.93), **_piri), 1.3, 0.0),
              (p(STAND, pelvis=(-0.03, 0.79), **_piri), 2.0, 0.0),
              (p(STAND, pelvis=(-0.03, 0.86), **_piri), 1.2, 2.0)]),
    dict(slug='hip-pendulum', props=[('box', -0.30, 0.22, 0.15), ('wall', 0.62)],
         start=_hip_pend0, seq=[], repeat=1),
]

_hp = EXERCISES[[e['slug'] for e in EXERCISES].index('hip-pendulum')]
_hp['seq'] = [(p(_hip_pend0, leg_a={'a': (a, a + s), 'foot': f}), 0.85, 0.0)
              for a, s, f in [(-62.0, -6.0, 20.0), (-118.0, 8.0, -20.0)] * 3] + [(_hip_pend0, 0.6, 0.4)]
