"""Generate an authored digital PDF and a rendered image-only twin, without services."""
import json
import sys
from pathlib import Path
import fitz
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from io import BytesIO

source = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
output = Path(sys.argv[2])
digital = output / 'ridge-nursery-digital.pdf'
scanned = output / 'ridge-nursery-scanned.pdf'
size = (612, 792)

def paragraph(pdf, text, x, y, width, font_size=11):
    pdf.setFont('Helvetica', font_size)
    words = text.split()
    current = ''
    for word in words:
        candidate = f'{current} {word}'.strip()
        if pdf.stringWidth(candidate, 'Helvetica', font_size) > width and current:
            pdf.drawString(x, y, current)
            current = word
            y -= font_size * 1.5
        else:
            current = candidate
    if current:
        pdf.drawString(x, y, current)
    return y - font_size * 2.7

pdf = canvas.Canvas(str(digital), pagesize=size, pageCompression=1, invariant=1)
pdf.setTitle(source['title'])
pdf.setAuthor('LLM Reader authored holdout')
for page in source['pages']:
    pdf.setFillColor(HexColor('#234050'))
    pdf.setFont('Helvetica-Bold', 17)
    pdf.drawString(42, 742, page['title'])
    pdf.setFillColor(HexColor('#111111'))
    pdf.setFont('Helvetica', 8)
    pdf.drawString(42, 768, 'FICTIONAL HOLDOUT MATERIAL - NOT BOTANICAL GUIDANCE')
    pdf.drawString(42, 28, f'Ridge Nursery Dispatch Addendum / page {page["number"]}')
    if 'columns' in page:
        for column, x in zip(page['columns'], [42, 321]):
            y = 690
            for text in column:
                y = paragraph(pdf, text, x, y, 249)
    else:
        y = 690
        if 'table' in page:
            columns = [42, 235, 390, 570]
            rows = [page['table']['header'], *page['table']['rows']]
            for row_index, row in enumerate(rows):
                row_top = y - row_index * 52
                for left, right in zip(columns, columns[1:]):
                    pdf.rect(left, row_top - 52, right - left, 52)
                pdf.setFont('Helvetica-Bold' if row_index == 0 else 'Helvetica', 10)
                for text, left in zip(row, columns):
                    pdf.drawString(left + 9, row_top - 31, text)
            y -= 52 * len(rows) + 35
        for text in page.get('paragraphs', []):
            y = paragraph(pdf, text, 42, y, 528)
    pdf.showPage()
pdf.save()

doc = fitz.open(digital)
image_pdf = canvas.Canvas(str(scanned), pagesize=size, pageCompression=1, invariant=1)
image_pdf.setTitle(source['title'] + ' (image-only twin)')
image_pdf.setAuthor('LLM Reader authored holdout')
for index, page in enumerate(doc):
    image = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    image_bytes = image.tobytes('png')
    (output / f'ridge-nursery-page-{index + 1}.png').write_bytes(image_bytes)
    image_pdf.drawImage(ImageReader(BytesIO(image_bytes)), 0, 0, width=size[0], height=size[1])
    image_pdf.showPage()
image_pdf.save()
scan = fitz.open(scanned)
assert len(doc) == len(scan) == 4
assert all(page.get_text().strip() for page in doc)
assert all(not page.get_text().strip() for page in scan)
assert all(page.get_images() for page in scan)
print(json.dumps({'pages': len(doc), 'digitalTextLayer': True, 'scannedTextLayer': False, 'scannedImagesPerPage': [len(page.get_images()) for page in scan]}))
