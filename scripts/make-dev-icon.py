#!/usr/bin/env python3
"""生成开发态专用的应用图标（带 DEV 标识），输出到 src-tauri/icons/dev/。

为什么需要：仓库里没有打包图标资源，未打包运行（pnpm dev，debug 构建）与
安装版都用集合里同一张图标，同机并存时分不出来。开发态用这份带 DEV 底边带的图标
（src-tauri/src/dev_icon.rs 只在 debug 构建里套用），安装版的图标不受影响。

这是**开发态占位素材**，不是产品品牌资源：将来给产品出正式图标时，
按同样版式重出一份带 DEV 标识的即可，或直接删掉本脚本与 src-tauri/icons/dev/。

用法：python3 scripts/make-dev-icon.py
依赖：Pillow（仅生成素材时需要，不参与构建）。字体用 macOS 自带的 SF Pro Rounded（可变字重），
字形接近渲染层品牌标所用的 Nunito ExtraBold。
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / 'src-tauri' / 'icons' / 'dev'

SIZE = 1024
# macOS 图标网格：824 内容 + 四周透明留白，圆角约 185
INSET = 100
RADIUS = 185

# 与 DESIGN.md §3 一致：品牌蓝 #3390ec（上亮下暗做轻微渐变），DEV 带用琥珀色以示"非正式"
BLUE_TOP = (85, 169, 242)
BLUE_BOTTOM = (39, 118, 214)
AMBER = (245, 158, 11)
WHITE = (255, 255, 255)

FONT_PATH = '/System/Library/Fonts/SFNSRounded.ttf'


def font(size: int, weight: str = 'Bold') -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(FONT_PATH, size)
    f.set_variation_by_name(weight)
    return f


def vertical_gradient(top, bottom, height: int) -> Image.Image:
    grad = Image.new('RGB', (SIZE, height))
    draw = ImageDraw.Draw(grad)
    for y in range(height):
        t = y / max(height - 1, 1)
        draw.line(
            [(0, y), (SIZE, y)],
            fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)),
        )
    return grad


def centered_text(draw, box, text, fnt, fill, tracking: int = 0):
    """把文本绘制在 box（left, top, right, bottom）的几何中心；tracking 为字间距（px）

    垂直方向按**墨迹**包围盒（textbbox）对齐，不用 ascent/descent：后者含行间距，
    会让字偏下（第一次生成的版本就是这个问题）。逐字绘制以支持字间距，共用同一基线。
    """
    widths = [draw.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    ink = draw.textbbox((0, 0), text, font=fnt)
    x = box[0] + (box[2] - box[0] - total) / 2
    y = box[1] + (box[3] - box[1] - (ink[3] - ink[1])) / 2 - ink[1]
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += w + tracking


def main() -> None:
    icon = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))

    # 主体：圆角方形 + 竖向渐变
    body_mask = Image.new('L', (SIZE, SIZE), 0)
    ImageDraw.Draw(body_mask).rounded_rectangle(
        [INSET, INSET, SIZE - INSET, SIZE - INSET], radius=RADIUS, fill=255
    )
    body = vertical_gradient(BLUE_TOP, BLUE_BOTTOM, SIZE - 2 * INSET)
    layer = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    layer.paste(body, (INSET, INSET))
    icon.paste(layer, (0, 0), body_mask)

    # DEV 底边带：裁进主体圆角内，小尺寸下也能一眼看出是开发态
    band_height = 168
    band = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    band_draw = ImageDraw.Draw(band)
    band_draw.rectangle(
        [INSET, SIZE - INSET - band_height, SIZE - INSET, SIZE - INSET], fill=AMBER + (255,)
    )
    band.putalpha(Image.composite(band.getchannel('A'), Image.new('L', (SIZE, SIZE), 0), body_mask))
    icon.alpha_composite(band)

    draw = ImageDraw.Draw(icon)

    # 品牌标 "edt"：居中于底边带以上的区域
    word = 'edt'
    word_font = font(316)
    centered_text(draw, (INSET, INSET, SIZE - INSET, SIZE - INSET - band_height), word, word_font, WHITE, tracking=-8)

    # DEV：底边带内，字间距拉开成标签感
    dev_font = font(96)
    centered_text(
        draw,
        (INSET, SIZE - INSET - band_height, SIZE - INSET, SIZE - INSET),
        'DEV',
        dev_font,
        WHITE,
        tracking=14,
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    png_path = OUT_DIR / 'icon-dev.png'
    icon.save(png_path)

    ico_path = OUT_DIR / 'icon-dev.ico'
    icon.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    # Rust 侧（src-tauri/src/dev_icon.rs）直接 include_bytes! 这份裸 RGBA：
    # 桌面壳没有 PNG 解码器（要多背 image 依赖），而窗口图标本来就只要一张位图。
    # 格式：132×132 的 RGBA 逐行扫描（每像素 4 字节，共 132*132*4 字节），无头无尾。
    raw_side = 132
    raw = icon.resize((raw_side, raw_side), Image.LANCZOS).convert('RGBA')
    raw_path = OUT_DIR / 'icon-dev-132.rgba'
    raw_path.write_bytes(raw.tobytes())

    print(
        f'✓ {png_path.relative_to(ROOT)} / {ico_path.relative_to(ROOT)}'
        f' / {raw_path.relative_to(ROOT)}'
    )


if __name__ == '__main__':
    main()
