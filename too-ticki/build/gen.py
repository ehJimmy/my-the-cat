#!/usr/bin/env python3
"""Draws Too-ticki (a wire-haired dachshund) and her puppies as pixel art and
writes the sprite data the hooks module reads:

  hooks/vectors.ts  the main poses, as SVG stroke paths (desktop)
  hooks/actions.ts  the action strips (dig, sniff, bark, zoomies, victory)
  hooks/pups.ts     the puppies, one coat per litter-mate
  hooks/sprites.ts  PNG frames for the terminal

Run:  python3 build/gen.py            (writes the four files)
      python3 build/gen.py preview.png (also writes a contact sheet to look at)
"""
import base64, json, math, os, struct, sys, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'hooks')

PAL = {
    'o': '#171412',  # outline
    'b': '#4b4845',  # coat: grizzled dark grey
    'd': '#2c2a29',  # coat, darker (back, crown, tail)
    'h': '#8a847b',  # coat, the pale wiry hairs
    'B': '#6d665e',  # belly
    'l': '#c48d55',  # tan: legs, chest
    'e': '#5e3f2c',  # ears: warm brown
    'f': '#8f633a',  # far-side legs
    'c': '#dba86c',  # beard and eyebrows: golden tan
    'n': '#0f0c0b',  # nose, eyes
    'w': '#ffffff',
    'r': '#4a2d1f',  # collar: dark leather
    'q': '#e2703a',  # collar's orange edge
    'u': '#d9d6cf',  # collar studs
    'g': '#f2c14e',  # trophy
    'G': '#c9962b',  # trophy shade
    't': '#e58fa0',  # tongue
    'm': '#3a2219',  # open mouth
    's': '#9a7b5a',  # soil
    'S': '#6e553c',  # soil, darker
    'y': '#c8e04a',  # ball
    'Y': '#9fb832',  # ball shade
    'z': '#7f9fd6',  # zzz, sound marks
    'k': '#f4efe6',  # bone
}

GRID = 56


def noise(x, y):
    n = (x * 374761393 + y * 668265263) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65536.0


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.p = [[None] * w for _ in range(h)]

    def set(self, x, y, k):
        x, y = int(math.floor(x)), int(math.floor(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.p[y][x] = k

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.p[y][x]
        return None

    def each(self):
        for y in range(self.h):
            for x in range(self.w):
                yield x, y

    def ellipse(self, cx, cy, rx, ry, k):
        for x, y in self.each():
            if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1:
                self.p[y][x] = k

    def capsule(self, x0, y0, x1, y1, r, k):
        dx, dy = x1 - x0, y1 - y0
        ll = dx * dx + dy * dy
        for x, y in self.each():
            px, py = x + .5 - x0, y + .5 - y0
            t = 0 if ll == 0 else max(0, min(1, (px * dx + py * dy) / ll))
            if (px - t * dx) ** 2 + (py - t * dy) ** 2 <= r * r:
                self.p[y][x] = k

    def rect(self, x, y, w, h, k):
        for yy in range(int(y), int(y + h)):
            for xx in range(int(x), int(x + w)):
                self.set(xx, yy, k)

    def outline(self, k='o'):
        edge = []
        for x, y in self.each():
            if self.p[y][x] is None and any(self.get(x + a, y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                edge.append((x, y))
        for x, y in edge:
            self.p[y][x] = k

    def blit(self, other, dx=0, dy=0):
        for x, y in other.each():
            if other.p[y][x] is not None:
                self.set(x + dx, y + dy, other.p[y][x])

    def mirrored(self):
        c = Canvas(self.w, self.h)
        for x, y in self.each():
            c.p[y][self.w - 1 - x] = self.p[y][x]
        return c

    def text(self, x, y, rows, k):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch != ' ':
                    self.set(x + i, y + j, k)


# --- The dog ---------------------------------------------------------------------

def coat(c, x0, y0, x1, y1, top, bottom, wiry=True):
    """Shade the coat inside a box: darker back, lighter belly, wiry flecks."""
    for y in range(max(0, int(y0)), min(c.h, int(y1) + 1)):
        for x in range(max(0, int(x0)), min(c.w, int(x1) + 1)):
            if c.p[y][x] != 'b':
                continue
            if y <= top:
                c.p[y][x] = 'd'
            elif y >= bottom:
                c.p[y][x] = 'B'
            elif wiry:
                n = noise(x, y)
                if n < .16:
                    c.p[y][x] = 'd'
                elif n > .8:
                    c.p[y][x] = 'h'


def head(c, hx, hy, s=1.0, eye='open', mouth=0, ear=0.0, tilt=0.0, beard=True):
    """The head, facing right: skull at (hx, hy), a long snout, drop ear, brows
    and beard. `tilt` lifts (negative) or drops the snout tip."""
    r = 6.2 * s
    c.ellipse(hx, hy, r, r * .92, 'b')
    sx, sy = hx + 9.5 * s, hy + 2 * s + tilt
    c.capsule(hx + 3 * s, hy + 1.6 * s + tilt * .3, sx, sy, 2.7 * s, 'b')
    for x, y in list(c.each()):  # darker crown
        if c.p[y][x] == 'b' and y < hy - r * .45 and abs(x - hx) < r:
            c.p[y][x] = 'd'
    if mouth:
        c.capsule(hx + 5 * s, sy + 2.2 * s, sx - 1, sy + 2.2 * s + mouth * .5, 1.2 * s, 'm')
        c.capsule(hx + 5 * s, sy + 3 * s + mouth, sx - 1.5, sy + 3.4 * s + mouth, 1.4 * s, 'b')
        if mouth > 1:
            c.set(sx - 3, sy + 2.6 * s, 't')
            c.set(sx - 2, sy + 2.6 * s, 't')
    if beard:
        by = sy + 2.6 * s + (mouth + 1 if mouth else 0)
        c.ellipse(sx - 2.8 * s, by + .9 * s, 3.9 * s, 2.7 * s, 'c')
        for i in range(int(6 * s)):  # ragged ends
            if noise(i, 7) > .4:
                c.set(sx - 5.5 * s + i, by + 3.4 * s, 'c')
    c.rect(round(sx + 1.2 * s), round(sy - 2.2 * s), max(1, round(2 * s)), max(1, round(2 * s)), 'n')
    ex, ey = round(hx + 2.4 * s), round(hy - 1.4 * s)
    if eye == 'open':
        c.rect(ex, ey, max(1, round(1.6 * s)), max(1, round(2 * s)), 'n')
        if s >= 1:
            c.set(ex, ey, 'w')
    else:
        c.rect(ex - 1, ey + 1, max(2, round(3 * s)), 1, 'n')
    for i in range(max(2, round(4 * s))):  # bushy brow
        c.set(ex - 1 + i, ey - 1 - (1 if 0 < i < 3 and s >= 1 else 0), 'c')
    ax, ay = hx - 2.2 * s - ear * 2.2 * s, hy - 2.2 * s - ear * 2.5 * s
    c.capsule(ax, ay, ax - 1.2 * s - ear * 4 * s, ay + (8.2 - ear * 6.5) * s, 2.6 * s, 'e')


def collar(c, x, y, h=6):
    c.capsule(x + 1, y, x + 2.6, y + h, .6, 'q')
    c.capsule(x, y, x + 1.6, y + h, 1.1, 'r')
    c.set(x + .6, y + h * .35, 'u')
    c.set(x + 1.2, y + h * .75, 'u')


def side(w=GRID, h=GRID, gx=3, L=41, H=13, leg=6, step=0, lift=0, hd=(0, 0), tail=0.0, s=1.0,
         tuck=False, low=False, gallop=None, **head_opts):
    """A side-on dog facing right, feet on the bottom row. `step` 0..3 is the
    walk cycle; `hd` nudges the head; `low` drops the head to the ground."""
    c = Canvas(w, h)
    gy = h - 1  # the outline's bottom row
    by = gy - leg - H / 2 - lift
    x0, x1 = gx + H / 2 + 1, gx + L - H / 2
    # Far-side legs first, then the body over them.
    swing = [(-2, 2), (0, 0), (2, -2), (0, 0)][step % 4]
    hind, fore = gx + 6 * s, gx + L - 10 * s
    lw = max(2, round(3 * s))
    def legs(far):
        k = 'f' if far else 'l'
        for base, sw in ((hind, swing[0]), (fore, swing[1])):
            off = (-sw if far else sw)
            if gallop is not None:
                off = (gallop if base == fore else -gallop) * (1 if not far else .6)
            up = 1 if (off > 0) != far and step % 2 == 0 and gallop is None else 0
            x = base + (lw + 1 if far else 0)
            if tuck:
                c.capsule(x + 1, by + H / 2 - 1, x + 3.5 * s, by + H / 2 + .5, 1.3 * s, k)
            elif gallop is not None:
                c.capsule(x + 1.5, by + H / 2 - 2, x + 1.5 + off * 1.5, gy - 1.2 - abs(off) * .35, 1.4 * s, k)
            else:
                c.capsule(x + 1.5, by + H / 2 - 2, x + 1.5 + off, gy - 1.6 - up, 1.45 * s, k)
    legs(True)
    c.capsule(x0, by, x1, by, H / 2, 'b')
    c.ellipse(x1 - 1, by + .8, H / 2 + .6, H / 2 + .9, 'b')  # deep chest
    c.ellipse(x0 + 1, by - .3, H / 2 + .3, H / 2 + .2, 'b')  # rump
    coat(c, 0, by - H, w, by + H, by - H / 2 + 1.6, by + H / 2 - 1.2, wiry=s >= 1)
    if s >= 1:  # tan chest
        c.ellipse(x1 + 3.2, by + 2.6, 2.6, 3.6, 'l')
    legs(False)
    # Tail: carried level, wagging up and down from the rump.
    tx, ty = gx + 2.5, by - H / 2 + 3
    c.capsule(tx, ty, tx - 3.2 * s, ty - (5.5 + tail * 3) * s, 1.25 * s, 'd')
    c.capsule(tx - 3.2 * s, ty - (5.5 + tail * 3) * s, tx - 4.4 * s, ty - (8 + tail * 4.5) * s, .9 * s, 'd')
    # Neck and head.
    nx, ny = x1 + 1.5, by - H / 2 + 3
    if low:
        hx, hy = x1 + 7 * s + hd[0], by + 1.5 + hd[1]
    else:
        hx, hy = x1 + 4.5 * s + hd[0], by - H / 2 - 3.5 * s + hd[1]
    c.capsule(nx, ny, hx - 1, hy + 1, 4.2 * s, 'b')
    coat(c, nx - 5, min(ny, hy) - 6, hx + 3, max(ny, hy) + 6, -1, 999, wiry=s >= 1)
    if s >= 1:
        mx, my = (nx + hx) / 2 - 2.5, (ny + hy) / 2 - 2.2
        collar(c, mx + (1 if low else 0), my + (2 if low else 0))
    head(c, hx, hy, s=s, **head_opts)
    c.outline()
    return c


def sit(eye='open', tail=0.0, paws=0, tilt=0.0, mouth=0, w=GRID, h=GRID, gx=0):
    c = Canvas(w, h)
    gy = h - 1
    c.capsule(gx + 12, gy - 3.5, gx + 5 - tail, gy - 3 - tail * 3.5, 1.25, 'd')
    c.capsule(gx + 5 - tail, gy - 3 - tail * 3.5, gx + 3 - tail, gy - 4 - tail * 5, .9, 'd')
    # Far front leg, torso, haunch.
    if paws:
        c.capsule(gx + 36, gy - 19, gx + 44, gy - 20 - paws, 1.5, 'f')
    else:
        c.capsule(gx + 35.5, gy - 18, gx + 35.5, gy - 1.6, 1.5, 'f')
    c.capsule(gx + 19, gy - 9, gx + 31, gy - 23, 7, 'b')
    c.ellipse(gx + 17, gy - 8.5, 9, 8, 'b')
    coat(c, 0, 0, w, h, -1, 999)
    for x, y in list(c.each()):  # darker along the back, lighter chest
        if c.p[y][x] in ('b', 'h', 'B'):
            d = (x - (gx + 19)) * 14 + (y - (gy - 9)) * 12  # across the torso axis
            if d < -62:
                c.p[y][x] = 'd'
            elif d > 86 and y < gy - 6:
                c.p[y][x] = 'l'
    c.capsule(gx + 16, gy - 2.6, gx + 25, gy - 2.6, 1.6, 'l')  # hind foot
    if paws:
        c.capsule(gx + 33, gy - 17, gx + 42, gy - 17 - paws, 1.6, 'l')
    else:
        c.capsule(gx + 32, gy - 18, gx + 32, gy - 1.6, 1.6, 'l')
    hx, hy = gx + 34, gy - 31
    c.capsule(gx + 30, gy - 24, hx - 1, hy + 1, 4.4, 'b')
    collar(c, gx + 28.5, gy - 26.5, 5)
    head(c, hx, hy, eye=eye, tilt=tilt, mouth=mouth)
    c.outline()
    return c


def lying(breath=0, w=GRID, h=GRID):
    c = Canvas(w, h)
    gy = h - 1
    c.capsule(8, gy - 3, 3, gy - 5, 1.25, 'd')
    c.capsule(3, gy - 5, 5, gy - 8, 1, 'd')
    c.ellipse(24, gy - 7.5 - breath * .5, 17, 6.5 + breath * .6, 'b')
    c.ellipse(11, gy - 7, 7, 6, 'b')
    coat(c, 0, 0, w, h, gy - 12 - breath, gy - 3)
    c.capsule(14, gy - 2.4, 21, gy - 2.4, 1.5, 'l')
    c.capsule(36, gy - 2.4, 46, gy - 2.4, 1.5, 'l')
    hx, hy = 40, gy - 7.5
    head(c, hx, hy, eye='closed', tilt=1.2)
    c.outline()
    return c


def zzz(c, x, y, n):
    Z = ['zzz', ' z ', 'zzz']
    z = ['zz', 'zz']
    if n >= 1:
        c.text(x, y, z, 'z')
    if n >= 2:
        c.text(x + 4, y - 6, Z, 'z')
    if n >= 3:
        c.text(x + 9, y - 13, ['zzzz', '  z ', ' z  ', 'zzzz'], 'z')


# --- Main poses (56 x 56) ------------------------------------------------------------

def main_frames():
    walk = [side(step=i, lift=(1 if i % 2 else 0), tail=(.3 if i % 2 else -.1), ear=(.08 if i % 2 else 0)) for i in range(4)]
    sits = [sit(), sit(eye='closed'), sit(eye='closed'), sit(tail=.5)]
    # Floating while you type: paws tucked, ears out like wings.
    flo = [side(tuck=True, lift=5, ear=e, tail=t, hd=(0, 0)) for e, t in ((.15, .2), (.75, .6), (.15, .2), (.5, .4))]
    sleep = []
    for i in range(4):
        c = lying(breath=i % 2)
        zzz(c, 44, 30, [1, 2, 3, 2][i])
        sleep.append(c)
    return {'sit': sits, 'float': flo, 'walk': walk, 'sleep': sleep}


# --- Action strips -----------------------------------------------------------------------

def strip(frames, ax, two_way=True):
    w, h = frames[0].w, frames[0].h
    out = {'right' if two_way else 'toward': {'w': w, 'h': h, 'ax': ax, 'frames': frames}}
    if two_way:
        out['left'] = {'w': w, 'h': h, 'ax': w - ax, 'frames': [f.mirrored() for f in frames]}
    return out


def dig_frames():
    out = []
    W = 72
    for i in range(4):
        d = side(w=W, h=GRID, gx=12, low=True, hd=(-1, 1 + i % 2), tail=(.7 if i % 2 else .2), gallop=(1.6 if i % 2 else -1.2), eye='closed')
        c = Canvas(W, GRID)
        gy = GRID - 1
        c.ellipse(60, gy + 1, 8, 3.2, 'S')  # the hole
        c.ellipse(60, gy + 1.6, 5.5, 2, 'n')
        c.blit(d)
        c.ellipse(9 - i % 2, gy, 7 + i, 2 + i * .8, 's')  # the growing heap behind
        # Soil flying back under the belly.
        for j in range(7):
            t = (j * 3 + i * 2) % 9
            x = 44 - t * 4 - j
            y = gy - 3 - math.sin(t / 9 * math.pi) * (9 + j % 3 * 2)
            c.rect(x, y, 2 if j % 2 else 1, 2 if j % 3 else 1, 's' if j % 2 else 'S')
        out.append(c)
    return strip(out, 12 + 22)


def sniff_frames():
    out = []
    W = 64
    for i in range(4):
        c = side(w=W, h=GRID, gx=3, low=True, hd=(i % 2, 2), tail=(.9 if i % 2 else .3), step=1)
        gy = GRID - 1
        # Little sniff puffs at the nose.
        nx = 56
        if i % 2:
            c.set(nx + 2, gy - 5, 'z'); c.set(nx + 4, gy - 7, 'z'); c.set(nx + 5, gy - 3, 'z')
        else:
            c.set(nx + 3, gy - 6, 'z'); c.set(nx + 6, gy - 5, 'z')
        if i >= 2:
            c.text(nx + 1, gy - 14, ['z z', ' z ', 'z  '], 'z')
        out.append(c)
    return strip(out, 3 + 22)


def bark_frames():
    out = []
    W = 68
    for i in range(4):
        loud = i % 2
        c = side(w=W, h=GRID, gx=3, hd=(0, -1 if loud else 0), tilt=(-1.5 if loud else 0), mouth=(3 if loud else 0),
                 tail=(.9 if loud else .4), lift=(1 if loud else 0), step=1, ear=(.25 if loud else 0))
        if loud:  # sound marks in front of the muzzle
            x, y = 60, 22
            for a, b, n in ((0, -6, 3), (3, -1, 4), (0, 4, 3)):
                for j in range(n):
                    c.set(x + a + j, y + b + (j * b) // 6, 'r')
        out.append(c)
    return strip(out, 3 + 22)


def ball(c, x, y):
    c.ellipse(x, y, 3.2, 3.2, 'y')
    c.set(x + 1, y + 1, 'Y'); c.set(x, y + 2, 'Y'); c.set(x + 1, y + 2, 'Y'); c.set(x - 2, y - 2, 'w')


def zoomies_frames():
    out = []
    W = 76
    for i in range(4):
        g = [3.2, 1, -2.6, 1][i]
        lift = [2, 4, 1, 0][i]
        d = side(w=W, h=GRID, gx=6, L=43, hd=(1, 1), gallop=g, lift=lift, tail=-.9, ear=.85, mouth=(2 if i % 2 else 0), tilt=.3)
        c = Canvas(W, GRID)
        gy = GRID - 1
        b = Canvas(W, GRID)
        ball(b, 68, gy - 5 - [0, 5, 7, 4][i])
        b.outline()
        c.blit(b)
        c.blit(d)
        for j in range(3):  # speed lines
            c.rect(0, gy - 12 - j * 6 - (i % 2) * 2, 4 - j, 1, 'z')
        out.append(c)
    return strip(out, 6 + 22)


def victory_frames():
    out = []
    W = 66
    for i in range(4):
        c = Canvas(W, GRID)
        gy = GRID - 1
        # A golden bone on a stand, where the cat had its star.
        t = Canvas(W, GRID)
        t.rect(49, gy - 3, 12, 3, 'G')
        t.rect(53, gy - 9, 4, 6, 'g')
        bx, by = 55, gy - 15 - (1 if i in (1, 3) else 0)
        t.capsule(bx - 5, by, bx + 5, by, 1.6, 'g')
        for ex in (-6, 6):
            t.ellipse(bx + ex, by - 1.6, 2, 2, 'g'); t.ellipse(bx + ex, by + 1.6, 2, 2, 'g')
        t.set(bx - 2, by - 1, 'w'); t.set(bx - 1, by - 1, 'w')
        t.outline()
        c.blit(t)
        d = sit(w=W, h=GRID, paws=[0, 3, 5, 3][i], tail=[.2, 1, .4, 1][i], tilt=(-1.5 if i >= 1 else 0), mouth=(3 if i == 2 else 0))
        c.blit(d)
        out.append(c)
    return strip(out, 22, two_way=False)


# --- Puppies ----------------------------------------------------------------------------

PUP_W, PUP_H = 28, 20
# Each litter-mate's coat: which main colours to swap.
COATS = [
    {},  # grizzled grey and tan, like mum
    {'b': '#b5632e', 'd': '#96501f', 'l': '#cf7f45', 'B': '#cf7f45', 'e': '#7a3e17', 'f': '#96501f', 'c': '#e0a36a'},  # red
    {'b': '#8c6b4a', 'd': '#6b4f36', 'l': '#b08d63', 'B': '#b08d63', 'e': '#4f3826', 'f': '#75573b', 'c': '#e2d0ae'},  # wild boar brown
    {'b': '#6a4630', 'd': '#553623', 'l': '#a8825a', 'B': '#a8825a', 'e': '#43291a', 'f': '#553623', 'c': '#c4a077'},  # chocolate
    {'b': '#d9c39c', 'd': '#c7ad82', 'l': '#ecdfc4', 'B': '#ecdfc4', 'e': '#a98c62', 'f': '#c7ad82', 'c': '#f6eedd'},  # cream
    {'b': '#8f8a84', 'd': '#6e6a65', 'l': '#b8b2a9', 'B': '#b8b2a9', 'e': '#55514d', 'f': '#6e6a65', 'c': '#ded9d0'},  # pepper and salt
]


def pup_frames():
    walk = []
    for i in range(3):  # played 0 1 2 1
        walk.append(side(w=PUP_W, h=PUP_H, gx=2, L=17, H=7.5, leg=3, s=.62, step=i, lift=(1 if i % 2 else 0),
                         tail=(.9 if i % 2 else .2), ear=(.2 if i % 2 else 0), beard=False))
    return walk


# --- Output ---------------------------------------------------------------------------------

def vec(c, swap=None):
    """A frame as [colour, path] pairs: each colour's pixels as 1px-high runs."""
    runs = {}
    for y in range(c.h):
        x = 0
        while x < c.w:
            k = c.p[y][x]
            if k is None:
                x += 1
                continue
            n = 1
            while x + n < c.w and c.p[y][x + n] == k:
                n += 1
            runs.setdefault(k, []).append(f'M{x} {y}.5h{n}')
            x += n
    return [[(swap or {}).get(k, PAL[k]), ''.join(v)] for k, v in runs.items()]


def png(c, size=None, scale=1, bg=None):
    w, h = (size or c.w), (size or c.h)
    ox, oy = (w - c.w) // 2, h - c.h
    rows = []
    for y in range(h * scale):
        row = bytearray([0])
        for x in range(w * scale):
            k = c.get(x // scale - ox, y // scale - oy)
            if k is None:
                row += bytes(bg) if bg else b'\0\0\0\0'
            else:
                v = PAL[k]
                row += bytes([int(v[1:3], 16), int(v[3:5], 16), int(v[5:7], 16), 255])
        rows.append(bytes(row))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w * scale, h * scale, 8, 6, 0, 0, 0)) + \
        chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')


def js(v):
    return json.dumps(v, separators=(',', ':'))


def write(name, text):
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(text)
    print(f'{name}: {len(text)} chars')


def main():
    m = main_frames()
    acts = {'dig': dig_frames(), 'sniff': sniff_frames(), 'bark': bark_frames(), 'zoomies': zoomies_frames(), 'victory': victory_frames()}
    pups = pup_frames()

    head_ = '// Generated by build/gen.py. Do not edit: change the drawing there and run it again.\n'
    out = head_ + '// Each frame: [colour, SVG stroke path of 1px runs] pairs on a %dx%d grid.\n' % (GRID, GRID)
    out += f'export const GRID = {GRID}\nexport type Frame = [string, string][]\n'
    for k, frames in m.items():
        out += f'export const {k}: Frame[] = {js([vec(f) for f in frames])}\n'
    write('vectors.ts', out)

    out = head_ + '// Each frame: [colour, SVG stroke path of 1px runs] pairs on a w x h grid;\n'
    out += '// `ax` is where the dog\'s body is, so it lines up with the walking dog.\n'
    out += 'export type Strip = { w: number; h: number; ax: number; frames: [string, string][][] }\n'
    for k, ways in acts.items():
        data = {way: {**s, 'frames': [vec(f) for f in s['frames']]} for way, s in ways.items()}
        out += f'export const {k}: Record<string, Strip> = {js(data)}\n'
    write('actions.ts', out)

    out = head_ + '// The puppies: a walk cycle on a %dx%d grid, one set per coat.\n' % (PUP_W, PUP_H)
    out += f'export const PUP_W = {PUP_W}\nexport const PUP_H = {PUP_H}\n'
    out += f'export const coats: [string, string][][][] = {js([[vec(f, coat_) for f in pups] for coat_ in COATS])}\n'
    write('pups.ts', out)

    b64 = lambda c: base64.b64encode(png(c, size=64)).decode()
    out = head_ + 'export const FRAME = 64\n'
    for name, frames in (('sitFrames', m['sit']), ('floatFrames', m['float']), ('walkFrames', m['walk']),
                         ('walkLeftFrames', [f.mirrored() for f in m['walk']]), ('sleepFrames', m['sleep'])):
        out += f'export const {name} = {js([b64(f) for f in frames])}\n'
    write('sprites.ts', out)

    if len(sys.argv) > 1:
        rows = [m['walk'], m['sit'], m['float'], m['sleep']] + [s['right' if 'right' in s else 'toward']['frames'] for s in acts.values()] + [pups]
        cw = max(f.w for r in rows for f in r) + 2
        sheet = Canvas(cw * 4, sum(max(f.h for f in r) + 2 for r in rows))
        y = 0
        for r in rows:
            for i, f in enumerate(r):
                sheet.blit(f, i * cw + 1, y + 1)
            y += max(f.h for f in r) + 2
        with open(sys.argv[1], 'wb') as f:
            f.write(png(sheet, scale=3, bg=(250, 249, 245, 255)))
        print('preview:', sys.argv[1], sheet.w * 3, sheet.h * 3)


if __name__ == '__main__':
    main()
