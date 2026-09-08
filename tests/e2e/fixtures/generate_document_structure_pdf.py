"""Render the self-authored structured fixture. Uses existing Windows fonts; installs nothing."""
import json
import shutil
from pathlib import Path
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[3]
DATA = json.loads((ROOT / 'output/document-structure-validation/fixture-docling.json').read_text(encoding='utf-8'))
OUTPUT = ROOT / 'output/pdf/document-structure-validation.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
fonts = []
for name, filename in [('Body', 'msyh.ttc'), ('Extended', 'simsunb.ttf'), ('Symbols', 'seguisym.ttf')]:
    font = TTFont(name, 'C:/Windows/Fonts/' + filename, subfontIndex=0)
    pdfmetrics.registerFont(font)
    fonts.append((name, font.face.charToGlyph))

pdf = canvas.Canvas(str(OUTPUT), pagesize=(600, 800), pageCompression=1, invariant=1)
pdf.setTitle('文档结构验收 - 自建多页样本')
pdf.setAuthor('LLM Reader test fixture')

def line(text, x, y, size=12):
    for character in text:
        name = next((name for name, cmap in fonts if ord(character) in cmap), None)
        if name is None:
            raise ValueError('No font for ' + repr(character))
        pdf.setFont(name, size)
        pdf.drawString(x, y, character)
        x += pdfmetrics.stringWidth(character, name, size)

def paragraph(text, x, y, size=12, width=510):
    current, length = '', 0
    for character in text:
        name = next(name for name, cmap in fonts if ord(character) in cmap)
        advance = pdfmetrics.stringWidth(character, name, size)
        if length + advance > width:
            line(current, x, y, size)
            current, length, y = '', 0, y - size * 1.5
        current += character
        length += advance
    if current:
        line(current, x, y, size)

for page in range(1, 7):
    pdf.bookmarkPage('page-' + str(page))
    pdf.addOutlineEntry('第 ' + str(page) + ' 页', 'page-' + str(page), level=0)
    pdf.setFillColorRGB(0.16, 0.20, 0.23)
    for node in DATA['texts']:
        source = node['prov'][0]
        if source['page_no'] != page:
            continue
        label = node['label']
        size = 18 if label == 'section_header' else 8 if label == 'page_header' else 12
        paragraph(node['text'], 40, 800 - source['bbox']['t'] * .8 - size, size)
    if page in (3, 4):
        top = 800 - (400 if page == 3 else 100) * .8
        rows = [['情境', '处理规则']] + ([['立即危险', '可逆行动并事后复核'], ['时间紧张', '继续核对，不启用例外']] if page == 3 else [['资料冲突', '分别核查两个来源']])
        pdf.setLineWidth(.5)
        for index, row in enumerate(rows):
            y = top - index * 32
            pdf.rect(40, y - 32, 180, 32)
            pdf.rect(220, y - 32, 340, 32)
            line(row[0], 48, y - 21)
            line(row[1], 228, y - 21)
        if page == 4:
            line('表一（续）', 40, top + 16, 10)
    line('自建验收材料 / 第 ' + str(page) + ' 页', 40, 26, 9)
    pdf.showPage()
pdf.save()
shutil.copyfile(OUTPUT, Path(__file__).with_name('document-structure.pdf'))
print(str(OUTPUT))
