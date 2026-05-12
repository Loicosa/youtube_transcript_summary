from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"
STORE = ROOT / "store"

BLUE = (37, 99, 235)
BLUE_LIGHT = (59, 130, 246)
BLUE_DARK = (30, 64, 175)
INK = (17, 24, 39)
MUTED = (92, 104, 124)
PAPER = (248, 250, 252)
WHITE = (255, 255, 255)
GREEN = (22, 163, 74)
YELLOW = (245, 158, 11)


def font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def ensure_dirs():
    ICONS.mkdir(exist_ok=True)
    STORE.mkdir(exist_ok=True)


def vertical_gradient(size, top, bottom):
    image = Image.new("RGB", size, top)
    draw = ImageDraw.Draw(image)
    width, height = size
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return image


def draw_icon(draw, box):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, radius=(x2 - x1) // 5, fill=BLUE)
    draw.rounded_rectangle((x1 + 6, y1 + 6, x2 - 6, y2 - 6), radius=(x2 - x1) // 6, outline=(147, 197, 253), width=2)
    doc = (x1 + 24, y1 + 20, x2 - 24, y2 - 18)
    draw.rounded_rectangle(doc, radius=10, fill=WHITE)
    draw.polygon([(x2 - 40, y1 + 20), (x2 - 24, y1 + 36), (x2 - 40, y1 + 36)], fill=(219, 234, 254))
    for i, width in enumerate([38, 50, 44]):
        y = y1 + 48 + i * 12
        draw.rounded_rectangle((x1 + 36, y, x1 + 36 + width, y + 4), radius=2, fill=(96, 165, 250))
    play = [(x1 + 48, y2 - 40), (x1 + 48, y2 - 22), (x1 + 64, y2 - 31)]
    draw.polygon(play, fill=BLUE_DARK)


def generate_icons():
    for size in [16, 32, 48, 128]:
        scale = 4
        canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
        draw = ImageDraw.Draw(canvas)
        pad = max(2 * scale, int(size * 0.125) * scale)
        draw_icon(draw, (pad, pad, size * scale - pad, size * scale - pad))
        canvas = canvas.resize((size, size), Image.Resampling.LANCZOS)
        canvas.save(ICONS / f"icon{size}.png")


def draw_card(draw, xy, radius=16, fill=WHITE, outline=(226, 232, 240)):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=1)


def draw_button(draw, xy, text, size=22):
    draw.rounded_rectangle(xy, radius=12, fill=BLUE, outline=(147, 197, 253), width=1)
    x1, y1, x2, y2 = xy
    icon = (x1 + 22, y1 + 16, x1 + 42, y2 - 16)
    draw.rounded_rectangle(icon, radius=5, outline=WHITE, width=2)
    draw.text((x1 + 54, y1 + (y2 - y1 - size) // 2 - 1), text, font=font(size, True), fill=WHITE)


def format_timestamp(seconds):
    return f"{seconds // 60}:{seconds % 60:02d}"


def draw_browser_frame(draw, xy, title="youtube.com/watch"):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=18, fill=(15, 23, 42))
    draw.rounded_rectangle((x1 + 14, y1 + 14, x2 - 14, y1 + 54), radius=12, fill=(30, 41, 59))
    for idx, color in enumerate([(239, 68, 68), (245, 158, 11), (34, 197, 94)]):
        cx = x1 + 34 + idx * 18
        draw.ellipse((cx, y1 + 28, cx + 9, y1 + 37), fill=color)
    draw.rounded_rectangle((x1 + 108, y1 + 24, x2 - 28, y1 + 44), radius=10, fill=(51, 65, 85))
    draw.text((x1 + 122, y1 + 24), title, font=font(13), fill=(203, 213, 225))


def draw_youtube_mock(draw, xy, show_panel=False, show_button=True):
    x1, y1, x2, y2 = xy
    draw_browser_frame(draw, xy)
    content = (x1 + 22, y1 + 72, x2 - 22, y2 - 22)
    cx1, cy1, cx2, cy2 = content
    video_w = int((cx2 - cx1) * 0.66)
    draw.rounded_rectangle((cx1, cy1, cx1 + video_w, cy1 + 360), radius=16, fill=(2, 6, 23))
    draw.rounded_rectangle((cx1 + 28, cy1 + 270, cx1 + video_w - 28, cy1 + 314), radius=8, fill=(0, 0, 0))
    draw.text((cx1 + 48, cy1 + 280), "Caption text appears here", font=font(22, True), fill=WHITE)
    draw.rounded_rectangle((cx1, cy1 + 382, cx1 + video_w, cy1 + 432), radius=10, fill=(30, 41, 59))
    draw.text((cx1 + 18, cy1 + 396), "Video title and channel controls", font=font(19, True), fill=(226, 232, 240))
    sidebar_x = cx1 + video_w + 24
    if show_button:
        draw_button(draw, (sidebar_x, cy1, cx2, cy1 + 52), "Get Transcript", 19)
    chip_y = cy1 + 66
    for i, label in enumerate(["All", "Related", "For you"]):
        chip_x = sidebar_x + i * 105
        draw.rounded_rectangle((chip_x, chip_y, chip_x + 88, chip_y + 34), radius=12, fill=(51, 65, 85))
        draw.text((chip_x + 18, chip_y + 8), label, font=font(14, True), fill=WHITE)
    for row in range(4):
        y = cy1 + 116 + row * 92
        if cx2 - sidebar_x >= 250:
            draw.rounded_rectangle((sidebar_x, y, sidebar_x + 148, y + 78), radius=10, fill=(51, 65, 85))
            draw.rectangle((sidebar_x, y + 66, sidebar_x + 148, y + 78), fill=(239, 68, 68))
            draw.rounded_rectangle((sidebar_x + 164, y + 4, cx2, y + 23), radius=4, fill=(148, 163, 184))
            draw.rounded_rectangle((sidebar_x + 164, y + 32, cx2 - 60, y + 48), radius=4, fill=(71, 85, 105))
        else:
            draw.rounded_rectangle((sidebar_x, y, cx2, y + 50), radius=8, fill=(51, 65, 85))
            draw.rectangle((sidebar_x, y + 42, cx2, y + 50), fill=(239, 68, 68))
    if show_panel:
        px1, py1 = x2 - 390, y1 + 92
        px2, py2 = x2 - 42, y2 - 44
        draw.rounded_rectangle((px1, py1, px2, py2), radius=16, fill=(24, 24, 27), outline=(63, 63, 70), width=1)
        draw.text((px1 + 18, py1 + 18), "Transcript", font=font(24, True), fill=WHITE)
        actions = [
            ("Get Transcript", 122, BLUE),
            ("Copy", 56, (39, 39, 42)),
            ("Download", 76, (39, 39, 42)),
            ("Summary", 72, (39, 39, 42)),
        ]
        bx = px1 + 18
        for label, width, fill in actions:
            draw.rounded_rectangle((bx, py1 + 58, bx + width, py1 + 92), radius=8, fill=fill, outline=(82, 82, 91))
            text_x = bx + 12 if width < 78 else bx + 14
            draw.text((text_x, py1 + 66), label, font=font(11, True), fill=WHITE)
            bx += width + 8
        for row in range(5):
            y = py1 + 120 + row * 76
            draw.text((px1 + 18, y), format_timestamp(row * 17), font=font(14, True), fill=(96, 165, 250))
            draw.rounded_rectangle((px1 + 74, y + 2, px2 - 22, y + 16), radius=4, fill=(226, 232, 240))
            draw.rounded_rectangle((px1 + 74, y + 24, px2 - 70, y + 38), radius=4, fill=(203, 213, 225))


def draw_settings_mock(draw, xy):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=18, fill=(226, 232, 240))
    panel_w = 430
    panel_h = 470
    px1 = x1 + (x2 - x1 - panel_w) // 2
    py1 = y1 + (y2 - y1 - panel_h) // 2
    px2 = px1 + panel_w
    py2 = py1 + panel_h
    draw.rounded_rectangle((px1, py1, px2, py2), radius=10, fill=(251, 251, 253), outline=(209, 213, 219), width=1)
    draw.rounded_rectangle((px1, py1, px2, py1 + 70), radius=10, fill=WHITE)
    draw.rectangle((px1, py1 + 60, px2, py1 + 70), fill=WHITE)

    icon = (px1 + 22, py1 + 20, px1 + 54, py1 + 52)
    draw.rounded_rectangle(icon, radius=4, fill=(113, 113, 113))
    draw.text((px1 + 35, py1 + 27), "Y", font=font(12, True), anchor="ma", fill=WHITE)
    draw.text((px1 + 66, py1 + 27), "YouTube Transcript Retriever", font=font(16), fill=(32, 33, 36))
    draw.line((px2 - 26, py1 + 22, px2 - 16, py1 + 32), fill=(32, 33, 36), width=2)
    draw.line((px2 - 16, py1 + 22, px2 - 26, py1 + 32), fill=(32, 33, 36), width=2)

    form_x = px1 + 20
    form_w = panel_w - 40
    body_y = py1 + 96
    draw.text((form_x, body_y), "Settings", font=font(22, True), fill=INK)

    fields = [
        ("Default caption language", "Auto / YouTube captions"),
        ("Select model", "ChatGPT"),
    ]
    for idx, (label, value) in enumerate(fields):
        y = body_y + 42 + idx * 76
        draw.text((form_x, y), label, font=font(13), fill=INK)
        select = (form_x, y + 22, form_x + form_w, y + 58)
        draw.rounded_rectangle(select, radius=6, fill=WHITE, outline=(199, 203, 209), width=1)
        draw.text((form_x + 14, y + 32), value, font=font(13, True), fill=INK)
        draw.polygon([(form_x + form_w - 18, y + 36), (form_x + form_w - 8, y + 36), (form_x + form_w - 13, y + 42)], fill=INK)

    check_y = body_y + 42 + len(fields) * 76 + 5
    draw.rounded_rectangle((form_x + 4, check_y, form_x + 20, check_y + 16), radius=2, fill=(26, 115, 232))
    draw.line((form_x + 8, check_y + 8, form_x + 11, check_y + 12), fill=WHITE, width=2)
    draw.line((form_x + 11, check_y + 12, form_x + 18, check_y + 4), fill=WHITE, width=2)
    draw.text((form_x + 30, check_y - 1), "Auto submit to LLM", font=font(13), fill=INK)

    translate_y = check_y + 28
    draw.rounded_rectangle((form_x + 4, translate_y, form_x + 20, translate_y + 16), radius=2, fill=WHITE, outline=(199, 203, 209))
    draw.text((form_x + 30, translate_y - 1), "Fallback translation in LLM", font=font(13), fill=INK)

    button_y = check_y + 62
    draw.rounded_rectangle((form_x, button_y, form_x + 54, button_y + 34), radius=6, fill=(26, 115, 232), outline=(26, 115, 232))
    draw.text((form_x + 27, button_y + 9), "Save", font=font(13, True), anchor="ma", fill=WHITE)
    draw.rounded_rectangle((form_x + 66, button_y, form_x + 126, button_y + 34), radius=6, fill=WHITE, outline=(199, 203, 209))
    draw.text((form_x + 96, button_y + 9), "Reset", font=font(13), anchor="ma", fill=INK)

    draw.text((form_x, button_y + 50), "Settings saved.", font=font(13), fill=(19, 115, 51))


def generate_store_images():
    image = vertical_gradient((440, 280), (239, 246, 255), (248, 250, 252))
    draw = ImageDraw.Draw(image)
    draw_icon(draw, (28, 48, 146, 166))
    draw.text((178, 62), "YouTube", font=font(24, True), fill=INK)
    draw.text((178, 92), "Transcript Retriever", font=font(24, True), fill=BLUE_DARK)
    draw.text((178, 132), "Copy, download, and summarize", font=font(15), fill=MUTED)
    draw.text((178, 154), "captions from the video page.", font=font(15), fill=MUTED)
    draw_button(draw, (178, 194, 382, 236), "Get Transcript", 16)
    image.save(STORE / "promo-440x280.png")

    image = vertical_gradient((1400, 560), (239, 246, 255), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw_icon(draw, (82, 126, 250, 294))
    draw.text((310, 142), "YouTube Transcript Retriever", font=font(54, True), fill=INK)
    draw.text((314, 218), "A simple Chrome extension for captions, timestamps, copying, downloads, and LLM summaries.", font=font(25), fill=MUTED)
    draw_button(draw, (314, 306, 558, 370), "Get Transcript", 25)
    draw.rounded_rectangle((828, 84, 1308, 476), radius=24, fill=(15, 23, 42))
    draw_youtube_mock(draw, (858, 116, 1278, 444), show_panel=True)
    image.save(STORE / "marquee-1400x560.png")

    image = vertical_gradient((1280, 800), (241, 245, 249), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw_youtube_mock(draw, (70, 70, 1210, 730), show_panel=False)
    image.save(STORE / "screenshot-1-button.png")

    image = vertical_gradient((1280, 800), (241, 245, 249), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw_youtube_mock(draw, (70, 70, 1210, 730), show_panel=True)
    image.save(STORE / "screenshot-2-panel.png")

    image = vertical_gradient((1280, 800), (241, 245, 249), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw_settings_mock(draw, (110, 80, 1170, 720))
    image.save(STORE / "screenshot-3-settings.png")


def main():
    ensure_dirs()
    generate_icons()
    generate_store_images()


if __name__ == "__main__":
    main()
