#!/usr/bin/env python3
"""Generates the Element Custom app icons (branding/build/icon.png/.ico).

The icon is original artwork (a tiled call layout on a rounded square), so
that the app is clearly distinguishable from the official Element client.
Requires Pillow. Run: python3 scripts/generate-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "branding" / "build"
S = 1024


def draw() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Background: rounded square with a vertical green→teal gradient
    bg = Image.new("RGBA", (S, S))
    top, bottom = (13, 189, 139), (8, 106, 128)
    for y in range(S):
        t = y / (S - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
        ImageDraw.Draw(bg).line([(0, y), (S, y)], fill=c + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([40, 40, S - 40, S - 40], 220, fill=255)
    img.paste(bg, (0, 0), mask)
    # Tiles: two large "screen shares" and three small "cameras"
    white = (255, 255, 255, 255)
    soft = (255, 255, 255, 190)
    d.rounded_rectangle([170, 210, 500, 600], 48, fill=white)
    d.rounded_rectangle([524, 210, 854, 600], 48, fill=white)
    for i in range(3):
        x = 170 + i * 236
        d.rounded_rectangle([x, 640, x + 212, 800], 40, fill=soft)
    # A small "play" and "code" hint inside the large tiles
    d.polygon([(300, 330), (300, 480), (410, 405)], fill=(8, 106, 128, 255))
    for j, w in enumerate((200, 150, 230, 120)):
        y = 300 + j * 62
        d.rounded_rectangle([590, y, 590 + w, y + 30], 15, fill=(8, 106, 128, 255))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img = draw()
    img.resize((512, 512), Image.LANCZOS).save(OUT / "icon.png")
    img.save(
        OUT / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
