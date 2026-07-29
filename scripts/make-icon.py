#!/usr/bin/env python3
# Renders a static soap-bubble icon (dark iridescent orb, purple/magenta sheen,
# glints, misty halo) on a transparent background, as a PNG. Pure stdlib.
import math, struct, zlib

N = 512
cx = cy = 0.0
R = 0.80            # orb radius in [-1,1] space
FOG = 0.985

def pal(t, d):
    return 0.5 + 0.5 * math.cos(2 * math.pi * (t + d))

def smooth(a, b, x):
    if a == b:
        return 0.0 if x < a else 1.0
    t = (x - a) / (b - a)
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)

def clamp01(v):
    return 0.0 if v < 0 else (1.0 if v > 1 else v)

rows = bytearray()
for y in range(N):
    rows.append(0)  # PNG filter byte (none)
    py = -(( (y + 0.5) / N) * 2 - 1)      # flip so +y is up
    for x in range(N):
        px = ((x + 0.5) / N) * 2 - 1
        r = math.hypot(px, py)
        a = math.atan2(py, px)

        if r > FOG:
            rows += b'\x00\x00\x00\x00'
            continue

        # --- body ---
        rn = min(r / R, 1.0)
        z = math.sqrt(max(0.0, 1 - rn * rn))
        fres = (1 - z) ** 3

        # oil-slick thickness with soft angular swirl (fades to calm at centre)
        swirl = (0.5 * math.sin(a * 3 + rn * 4) + 0.3 * math.sin(a * 5 - 2.0)) * (rn ** 0.6)
        thick = 0.55 + fres * 1.5 + rn * 0.5 + 0.30 * swirl
        ir = [pal(thick, 0.0), pal(thick, 0.33), pal(thick, 0.67)]
        # bgr mix + purple bias + purple pulse-ish constant
        ir = [ir[2] * 0.35 + ir[0] * 0.65, ir[1], ir[0] * 0.35 + ir[2] * 0.65]
        prince = (0.42, 0.06, 0.55)
        ir = [ir[i] * 0.72 + prince[i] * 0.28 for i in range(3)]

        base = (0.015, 0.02, 0.045)
        sheen = 0.55 * (0.5 + 0.5 * math.sin(a * 4 + rn * 6) * (rn ** 0.5)) + fres * 0.95
        col = [base[i] + ir[i] * sheen for i in range(3)]

        # misty, wobbling rim
        rimStart = 0.55 + 0.20 * (0.5 + 0.5 * math.sin(a * 4 + 1.0))
        rim = smooth(rimStart, 1.0, rn)
        rim *= 0.5 + 0.6 * (0.5 + 0.5 * math.sin(a * 6 - rn * 5))
        rim = clamp01(rim)
        for i in range(3):
            col[i] += ir[i] * rim * 0.8 + prince[i] * rim * 0.5

        # glints: white catch-light (upper-left) + magenta glam (lower-right)
        d1 = math.hypot(px - (-0.30), py - 0.34)
        g1 = max(0.0, 1 - d1 * 1.7) ** 10
        d2 = math.hypot(px - 0.30, py - (-0.32))
        g2 = max(0.0, 1 - d2 * 2.1) ** 12
        col[0] += 0.95 * g1 * 0.9 + 0.85 * g2 * 0.8
        col[1] += 0.97 * g1 * 0.9 + 0.20 * g2 * 0.8
        col[2] += 1.00 * g1 * 0.9 + 0.95 * g2 * 0.8

        col = [c * (0.7 + 0.3 * (rn * 0.6 + 0.4)) for c in col]

        bodyMask = smooth(R, R - 0.06, r)
        # misty halo outside the body
        halo = smooth(FOG, R - 0.02, r)
        fogN = 0.4 + 0.6 * (0.5 + 0.5 * math.sin(a * 8 + r * 12))
        haloA = halo * fogN * 0.22 * (1 - bodyMask)
        fogCol = [0.03 + ir[i] * 0.3 + prince[i] * 0.3 for i in range(3)]

        out = [fogCol[i] * (1 - bodyMask) + col[i] * bodyMask for i in range(3)]
        edge = smooth(1.0, 0.82, rn)
        alpha = clamp01((0.94 * edge + rim * 0.5) * bodyMask + haloA)

        rows += bytes(
            max(0, min(255, int((v ** (1 / 2.2)) * 255 + 0.5))) for v in out
        ) + bytes([max(0, min(255, int(alpha * 255 + 0.5)))])

def chunk(tag, data):
    return (struct.pack('>I', len(data)) + tag + data +
            struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 8, 6, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(bytes(rows), 9))
png += chunk(b'IEND', b'')

with open('assets/icon.png', 'wb') as f:
    f.write(png)
print('wrote assets/icon.png', N, 'x', N)
