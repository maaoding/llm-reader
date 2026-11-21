from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    RectangleObject,
    TextStringObject,
)


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

    pdf.bookmarkHorizontalAbsolute("page-one-selection", height - 300)
    pdf.addOutlineEntry("1.1 同页目录定位", "page-one-selection", level=1)
    pdf.setFillColorRGB(0.12, 0.18, 0.22)
    pdf.setFont(FONT_NAME, 18)
    pdf.drawString(72, height - 320, "1.1 同页目录定位")
    pdf.setFont(FONT_NAME, 12)
    for index in range(7):
        pdf.drawString(72, height - 352 - index * 22, f"同页小节第一段第 {index + 1} 行，用于验证目录内进度。")

    pdf.bookmarkHorizontalAbsolute("page-one-fit", height - 560)
    pdf.addOutlineEntry("1.2 适宽稳定性", "page-one-fit", level=1)
    pdf.setFont(FONT_NAME, 18)
    pdf.drawString(72, height - 580, "1.2 适宽稳定性")
    pdf.setFont(FONT_NAME, 12)
    for index in range(6):
        pdf.drawString(72, height - 612 - index * 22, f"同页小节第二段第 {index + 1} 行，用于验证缩放后定位。")
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


def create_no_outline_pdf(path: Path) -> None:
    width, height = A4
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    pdf.setTitle("无目录 PDF 测试")
    pdf.setAuthor("LLM Reader")
    for page_number in range(1, 3):
        pdf.setFont(FONT_NAME, 24)
        pdf.drawString(72, height - 92, f"无目录正文第 {page_number} 页")
        pdf.setFont(FONT_NAME, 13)
        for index in range(18):
            pdf.drawString(72, height - 138 - index * 28, f"第 {index + 1} 行用于验证全文进度回退。")
        pdf.showPage()
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


def create_complex_layout_pdf(path: Path) -> None:
    width, height = A4
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    pdf.setTitle("复杂排版 PDF 划词测试")
    pdf.setAuthor("LLM Reader")
    pdf.setFont(FONT_NAME, 20)
    pdf.drawString(58, height - 58, "复杂排版划词测试")

    body = pdf.beginText(58, height - 98)
    body.setFont(FONT_NAME, 12)
    body.setLeading(18)
    body.textLine("换行测试：复杂排版中的可读文本需要保留")
    body.textLine("自然空格和稳定锚点。")
    pdf.drawText(body)

    pdf.setStrokeColorRGB(0.75, 0.78, 0.8)
    pdf.rect(48, height - 340, 235, 170, stroke=1, fill=0)
    pdf.rect(312, height - 340, 235, 170, stroke=1, fill=0)
    left = pdf.beginText(62, height - 198)
    left.setFont(FONT_NAME, 11)
    left.setLeading(24)
    left.textLine("左栏第一行：区域框选目标。")
    left.textLine("左栏第二行：不应混入右栏。")
    left.textLine("左栏第三行：确认后可编辑。")
    pdf.drawText(left)
    right = pdf.beginText(326, height - 198)
    right.setFont(FONT_NAME, 11)
    right.setLeading(24)
    right.textLine("右栏第一行：必须被排除。")
    right.textLine("右栏第二行：验证几何边界。")
    right.textLine("右栏第三行：保持原始顺序。")
    pdf.drawText(right)

    table_top = height - 390
    table_left = 90
    table_width = 415
    row_height = 32
    column_widths = (125, 145, 145)
    pdf.setFont(FONT_NAME, 10)
    x = table_left
    for column_width in column_widths:
        pdf.line(x, table_top, x, table_top - row_height * 3)
        x += column_width
    pdf.line(x, table_top, x, table_top - row_height * 3)
    for row in range(4):
        y = table_top - row * row_height
        pdf.line(table_left, y, table_left + table_width, y)
    rows = (
        ("项目", "输入", "输出"),
        ("段落", "文字层", "可读文本"),
        ("公式", "几何区域", "可编辑预览"),
    )
    for row_index, row in enumerate(rows):
        x = table_left + 8
        y = table_top - 21 - row_index * row_height
        for column_index, value in enumerate(row):
            pdf.drawString(x, y, value)
            x += column_widths[column_index]

    pdf.setFont("Helvetica", 12)
    pdf.drawString(110, height - 535, "Formula: E = mc^2,  f(x) = x^2 + 1")
    pdf.setFont(FONT_NAME, 10)
    pdf.drawString(110, height - 560, "公式只提取文字，二维结构由用户在预览中确认。")

    pdf.setStrokeColorRGB(0.55, 0.6, 0.63)
    pdf.rect(110, 90, 375, 120, stroke=1, fill=0)
    pdf.setFont(FONT_NAME, 11)
    pdf.drawCentredString(width / 2, 70, "上方矩形内部没有文字，用于验证空区域提示。")
    pdf.save()


def create_damaged_pdf(path: Path) -> None:
    path.write_bytes(b"%PDF-1.7\nThis fixture is intentionally damaged.\n")


def create_oversized_pdf(path: Path) -> None:
    width = 2_000
    height = 20_000
    pdf = canvas.Canvas(str(path), pagesize=(width, height), pageCompression=1)
    pdf.setTitle("Oversized PDF Boundary Test")
    pdf.setAuthor("LLM Reader")
    pdf.setFont(FONT_NAME, 52)
    pdf.drawString(120, height - 160, "超大页面边界测试")
    pdf.setFont(FONT_NAME, 28)
    pdf.drawString(120, height - 240, "页面比例为 1:10，画布输出必须受尺寸与像素上限约束。")
    for index in range(1, 20):
        y = height - 240 - index * 980
        pdf.setStrokeColorRGB(0.72, 0.76, 0.79)
        pdf.line(120, y + 80, width - 120, y + 80)
        pdf.setFillColorRGB(0.18, 0.25, 0.29)
        pdf.drawString(120, y, f"超大页定位标记 {index:02d}")
    pdf.save()


def create_hostile_pdf(path: Path) -> None:
    width, height = A4
    source = BytesIO()
    pdf = canvas.Canvas(source, pagesize=A4, pageCompression=1)
    pdf.setTitle("Hostile PDF Capability Test")
    pdf.setAuthor("LLM Reader")

    pdf.bookmarkPage("hostile-page-one")
    pdf.setFont(FONT_NAME, 22)
    pdf.drawString(72, height - 82, "危险能力拦截测试")
    pdf.setFont(FONT_NAME, 12)
    pdf.drawString(72, height - 126, "本文件故意包含脚本、附件、表单、外链和启动动作。")
    pdf.drawString(72, height - 162, "唯一允许的交互：跳到第二页")
    pdf.linkRect("", "hostile-page-two", (70, height - 170, 300, height - 145), relative=0, thickness=0)
    pdf.drawString(72, height - 206, "外部网址（必须被忽略）")
    pdf.linkURL("https://example.invalid/blocked", (70, height - 214, 300, height - 190), relative=0)
    pdf.acroForm.textfield(
        name="unsafe-field",
        tooltip="This form control must not be exposed",
        x=72,
        y=height - 286,
        width=220,
        height=28,
        value="BLOCKED_FORM_FIELD",
        borderWidth=1,
    )
    pdf.drawString(72, height - 330, "启动动作（必须被忽略）")
    pdf.showPage()

    pdf.bookmarkPage("hostile-page-two")
    pdf.setFont(FONT_NAME, 22)
    pdf.drawString(72, height - 82, "安全的内部跳转目标")
    pdf.setFont(FONT_NAME, 12)
    pdf.drawString(72, height - 126, "到达此页说明当前文档内导航仍然可用。")
    pdf.save()
    source.seek(0)

    reader = PdfReader(source)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    writer.add_js("app.alert('PDF_JAVASCRIPT_MUST_NOT_RUN');")
    writer.add_attachment("unsafe-attachment.txt", b"ATTACHMENT_MUST_NOT_BE_EXPOSED")

    launch_action = DictionaryObject({
        NameObject("/S"): NameObject("/Launch"),
        NameObject("/F"): TextStringObject("calc.exe"),
    })
    launch_annotation = DictionaryObject({
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/Subtype"): NameObject("/Link"),
        NameObject("/Rect"): RectangleObject((70, height - 350, 300, height - 325)),
        NameObject("/Border"): ArrayObject([FloatObject(0), FloatObject(0), FloatObject(0)]),
        NameObject("/A"): launch_action,
    })
    writer.add_annotation(page_number=0, annotation=launch_annotation)

    with path.open("wb") as output:
        writer.write(output)


def main() -> None:
    register_font()
    create_text_pdf(FIXTURE_DIR / "text-reader.pdf")
    create_no_outline_pdf(FIXTURE_DIR / "no-outline-reader.pdf")
    create_scanned_pdf(FIXTURE_DIR / "scanned-reader.pdf")
    create_complex_layout_pdf(FIXTURE_DIR / "complex-layout-reader.pdf")
    create_damaged_pdf(FIXTURE_DIR / "damaged-reader.pdf")
    create_oversized_pdf(FIXTURE_DIR / "oversized-reader.pdf")
    create_hostile_pdf(FIXTURE_DIR / "hostile-reader.pdf")


if __name__ == "__main__":
    main()
