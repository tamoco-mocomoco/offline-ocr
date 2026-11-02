#!/usr/bin/env python3
"""imagegen で作った PNG (prompts.json の out ごと) を、サイト用の webp にする。要 Pillow。

  uv run --with pillow python site/assets-src/make_assets.py <生成した PNG のフォルダ>

- 幅はカードの表示の 2 倍 (高解像度の画面向け) まで縮める
- retype がある絵は、書きまちがえた文字を消して書体で組み直す
- OGP 画像 (1200×630) は hero の絵とロゴから作る
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
ASSETS = SITE / "assets"
MAX_W = {"hero": 1024, "offline": 1024}   # ほかはカード用に 900px
FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc"


def main(src: Path) -> None:
    spec = json.loads((HERE / "prompts.json").read_text())
    for item in spec["images"]:
        im = Image.open(src / f"{item['out']}.png").convert("RGB")
        if "retype" in item:
            retype(im, item["retype"])
        w = MAX_W.get(item["out"], 900)
        if im.width > w:
            im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(ASSETS / f"{item['out']}.webp", quality=84, method=6)
        print(f"assets/{item['out']}.webp", im.size)
    ogp(src)


def retype(im: Image.Image, r: dict) -> None:
    """絵が書きまちがえた文字を紙の色で消して、書体で組み直す (box の中央に置く)"""
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = r["box"]
    d.rectangle(r["box"], fill=tuple(r["fill"]))
    font = ImageFont.truetype(FONT, r["size"])
    l, t, rr, b = d.textbbox((0, 0), r["text"], font=font)
    d.text(((x0 + x1 - (rr - l)) / 2 - l, (y0 + y1 - (b - t)) / 2 - t), r["text"], font=font, fill=tuple(r["color"]))


def ogp(src: Path) -> None:
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), (246, 249, 252))
    hero = Image.open(src / "hero.png").convert("RGB")
    hero = hero.resize((round(hero.width * H / hero.height), H), Image.LANCZOS)
    img.paste(hero, (W - hero.width + 120, 0))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 640, H), fill=(246, 249, 252))
    icon = Image.open(SITE.parent / "public/icons/icon128.png").convert("RGBA").resize((88, 88))
    img.paste(icon, (64, 70), icon)
    navy = (30, 58, 95)
    d.text((168, 88), "オフラインOCR", font=ImageFont.truetype(FONT, 52), fill=navy)
    big = ImageFont.truetype(FONT, 60)
    d.text((64, 230), "画像の文字を、", font=big, fill=navy)
    d.text((64, 314), "ブラウザの中だけで", font=big, fill=navy)
    d.text((64, 398), "読み取る。", font=big, fill=navy)
    d.text((66, 520), "通信ゼロ ・ データ収集なし ・ Chrome 拡張", font=ImageFont.truetype(FONT, 26), fill=(47, 169, 138))
    img.save(ASSETS / "ogp.png", optimize=True)
    print("assets/ogp.png", img.size)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
