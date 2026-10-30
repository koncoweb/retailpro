#!/usr/bin/env python3
"""Compose a 1200×630 Elisa Cake share card from the circular bakery logo."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1200, 630
BLUSH = (246, 237, 232, 255)
ESPRESSO = (42, 33, 28, 255)
DUSTY = (168, 136, 137, 255)
GOLD = (197, 172, 122, 255)
CREAM = (251, 246, 236, 255)

LOGO_PATH = Path("/workspace/public/brand/logo-light.png")
OUT_PNG = Path("/workspace/.grok/og-card-raw.png")


def hex_rgba(rgb: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    return rgb


def paper_base() -> Image.Image:
    rng = np.random.default_rng(20260830)
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy = (W - 1) / 2.0, (H - 1) / 2.0
    nx = (xx - cx) / (W * 0.62)
    ny = (yy - cy) / (H * 0.72)
    r = np.sqrt(nx * nx + ny * ny)
    t = np.clip(r, 0.0, 1.0)
    t = t * t * (3 - 2 * t)

    cream = np.array(CREAM[:3], dtype=np.float32)
    blush = np.array(BLUSH[:3], dtype=np.float32)
    dusty = np.array(DUSTY[:3], dtype=np.float32)
    gold = np.array(GOLD[:3], dtype=np.float32)

    # Center cream glow fading to blush paper, with a faint dusty-rose vignette.
    rgb = cream * (1 - t)[..., None] + blush * t[..., None]
    vignette = np.clip((r - 0.55) / 0.7, 0, 1)[..., None]
    rgb = rgb * (1 - 0.10 * vignette) + dusty * (0.10 * vignette)

    # Soft gold wash in the lower third, like window light on a table.
    wash = np.clip((yy - H * 0.42) / (H * 0.7), 0, 1)
    wash = (wash * (1 - np.abs(nx) * 0.45))[..., None]
    rgb = rgb * (1 - 0.08 * wash) + gold * (0.08 * wash)

    grain = rng.normal(0, 4.2, (H, W, 1))
    fiber = rng.normal(0, 2.4, (H, W, 1))
    rgb = np.clip(rgb + grain + fiber * 0.35, 0, 255).astype(np.uint8)

    img = Image.fromarray(rgb, "RGB").convert("RGBA")
    return img


def blob(canvas: Image.Image, color: tuple[int, int, int, int], box, blur: int) -> None:
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse(box, fill=color)
    canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def watercolor_washes(base: Image.Image) -> Image.Image:
    # Translucent ellipses so the paper feels painted, not flat.
    blob(base, (251, 246, 236, 70), (280, 40, 920, 590), 42)
    blob(base, (168, 136, 137, 38), (-80, -90, 340, 260), 48)
    blob(base, (168, 136, 137, 32), (900, 380, 1320, 720), 52)
    blob(base, (197, 172, 122, 40), (820, -40, 1280, 220), 56)
    blob(base, (197, 172, 122, 28), (-60, 420, 380, 700), 50)
    blob(base, (246, 237, 232, 50), (140, 200, 520, 520), 40)
    return base


def gold_frame(base: Image.Image) -> None:
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    # Outer thin gold rule
    d.rounded_rectangle((36, 28, W - 37, H - 29), radius=18, outline=GOLD, width=2)
    # Inner hairline
    d.rounded_rectangle((48, 40, W - 49, H - 41), radius=12, outline=(*GOLD[:3], 170), width=1)

    # Corner diamonds
    def diamond(cx: float, cy: float, s: float = 7) -> None:
        d.polygon(
            [(cx, cy - s), (cx + s, cy), (cx, cy + s), (cx - s, cy)],
            fill=GOLD,
        )

    insets = [(58, 50), (W - 59, 50), (58, H - 51), (W - 59, H - 51)]
    for x, y in insets:
        diamond(x, y, 6)

    # Mid-side pips
    for x, y in ((W / 2, 40), (W / 2, H - 41), (48, H / 2), (W - 49, H / 2)):
        diamond(x, y, 4)

    base.alpha_composite(overlay)


def flourish(draw: ImageDraw.ImageDraw, origin: tuple[float, float], flip: int) -> None:
    ox, oy = origin
    # Simple botanical S-curve in gold, mirrored with flip.
    pts = []
    for i in range(48):
        t = i / 47
        x = ox + flip * (18 + 86 * t)
        y = oy + math.sin(t * math.pi) * -28 + math.sin(t * math.pi * 2) * 6
        pts.append((x, y))
    if len(pts) > 1:
        draw.line(pts, fill=(*GOLD[:3], 200), width=2, joint="curve")
    # Two leaves
    leaf_t = [0.38, 0.62]
    for t in leaf_t:
        x = ox + flip * (18 + 86 * t)
        y = oy + math.sin(t * math.pi) * -28 + math.sin(t * math.pi * 2) * 6
        leaf = [
            (x, y),
            (x + flip * 16, y - 11),
            (x + flip * 28, y - 2),
            (x + flip * 12, y + 4),
        ]
        draw.polygon(leaf, fill=(*GOLD[:3], 150))


def side_flourishes(base: Image.Image) -> None:
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    flourish(d, (168, 318), +1)
    flourish(d, (W - 168, 318), -1)
    # Soften slightly so they read as painted, not CAD
    base.alpha_composite(overlay.filter(ImageFilter.GaussianBlur(0.6)))


def place_logo(base: Image.Image) -> None:
    logo = Image.open(LOGO_PATH).convert("RGBA")
    target = 372
    logo = logo.resize((target, target), Image.Resampling.LANCZOS)

    # Soft drop shadow
    shadow = Image.new("RGBA", (target + 40, target + 40), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse((8, 12, target + 28, target + 32), fill=(42, 33, 28, 55))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))

    lx = (W - target) // 2
    ly = (H - target) // 2 - 2
    base.alpha_composite(shadow, (lx - 18, ly - 8))
    base.alpha_composite(logo, (lx, ly))


def main() -> None:
    card = paper_base()
    watercolor_washes(card)
    gold_frame(card)
    side_flourishes(card)
    place_logo(card)
    rgb = card.convert("RGB")
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    rgb.save(OUT_PNG, "PNG")
    print(f"wrote {OUT_PNG} {rgb.size}")


if __name__ == "__main__":
    main()
