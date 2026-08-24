from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


FIXTURE_DIR = Path(__file__).resolve().parent
FONT_PATH = Path(r"C:\Windows\Fonts\msyh.ttc")
FONT_NAME = "FixtureMicrosoftYaHei"


def register_font() -> None:
    pdfmetrics.registerFont(TTFont(FONT_NAME, str(FONT_PATH), subfontIndex=0))


def create_text_pdf(path: Path) -> None:
    width, height = A4
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    pdf.setTitle("PDF 阅读测试")
    pdf.setAuthor("LLM Reader")

    pdf.bookmarkPage("page-one")
    pdf.addOutlineEntry("第一章", "page-one", level=0)
    pdf.setFont(FONT_NAME, 24)
    pdf.drawString(72, height - 92, "第一章：可搜索的文本")
    pdf.setFont(FONT_NAME, 13)
    pdf.drawString(72, height - 138, "中文关键词：星河。English Keyword: Aurora.")
    pdf.drawString(72, height - 166, "这一页用于验证 PDF 文字选择和有限上下文。")
    pdf.setFillColorRGB(0.25, 0.37, 0.48)
    pdf.drawString(72, height - 212, "跳到第三页（内部链接）")
    pdf.linkRect("", "page-three", (70, height - 218, 260, height - 194), relative=0, thickness=0)
    pdf.showPage()

    pdf.bookmarkPage("page-two")
    pdf.addOutlineEntry("第二章", "page-two", level=0)
    pdf.setFont(FONT_NAME, 24)
    pdf.drawString(72, height - 92, "第二章：连续滚动")
    pdf.setFont(FONT_NAME, 13)
    for index in range(12):
        pdf.drawString(72, height - 138 - index * 25, f"第 {index + 1} 行包含重复词星河，用于多结果搜索与滚动进度。")
    pdf.showPage()

    pdf.bookmarkPage("page-three")
    pdf.addOutlineEntry("第三章", "page-three", level=0)
    pdf.setFont(FONT_NAME, 24)
    pdf.drawString(72, height - 92, "第三章：内部导航目标")
    pdf.setFont(FONT_NAME, 13)
    pdf.drawString(72, height - 138, "内部链接只改变当前视图，不应覆盖自然阅读位置。")
    pdf.save()


def create_scanned_pdf(path: Path) -> None:
    width, height = A4
    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.truetype(str(FONT_PATH), 54)
    body_font = ImageFont.truetype(str(FONT_PATH), 32)
    draw.text((130, 180), "扫描页测试", font=title_font, fill="#23313a")
    draw.text((130, 280), "这些字只存在于图片中，不应产生文字层。", font=body_font, fill="#465861")
    draw.rectangle((120, 390, 1120, 1320), outline="#9aa6ac", width=4)
    draw.line((170, 500, 1070, 500), fill="#c8cfd2", width=3)
    draw.line((170, 620, 1070, 620), fill="#c8cfd2", width=3)
    image_bytes = BytesIO()
    image.save(image_bytes, format="JPEG", quality=88, optimize=True)
    image_bytes.seek(0)

    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    pdf.setTitle("扫描 PDF 测试")
    pdf.drawImage(ImageReader(image_bytes), 0, 0, width=width, height=height)
    pdf.save()


def create_damaged_pdf(path: Path) -> None:
    path.write_bytes(b"%PDF-1.7\nThis fixture is intentionally damaged.\n")


def main() -> None:
    register_font()
    create_text_pdf(FIXTURE_DIR / "text-reader.pdf")
    create_scanned_pdf(FIXTURE_DIR / "scanned-reader.pdf")
    create_damaged_pdf(FIXTURE_DIR / "damaged-reader.pdf")


if __name__ == "__main__":
    main()
