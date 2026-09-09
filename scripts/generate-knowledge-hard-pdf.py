"""Reproducible authored PDF and raster twin; no private books or model output."""
import json
import os
import shutil
import subprocess
from pathlib import Path
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase import ttfonts
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from pypdf import PdfReader

# The bundled ReportLab emits non-BMP CMap destinations as odd-length scalar hex.
# PDF ToUnicode destinations require UTF-16BE; fix only this generator's emitted maps.
make_to_unicode = ttfonts.makeToUnicodeCMap
def make_utf16_cmap(fontname, subset):
    cmap = make_to_unicode(fontname, subset)
    for index, value in enumerate(subset):
        if value > 0xFFFF:
            cmap = cmap.replace(f'<{index:02X}> <{value:04X}>', f'<{index:02X}> <{chr(value).encode("utf-16-be").hex().upper()}>')
    return cmap
ttfonts.makeToUnicodeCMap = make_utf16_cmap

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output/pdf'
PREVIEW = ROOT / 'tmp/knowledge-hard-20260909/pdf-pages'
OUTPUT.mkdir(parents=True, exist_ok=True)
PREVIEW.mkdir(parents=True, exist_ok=True)
fonts = []
for name, filename in [('Body', 'msyh.ttc'), ('Extended', 'simsunb.ttf'), ('Symbols', 'seguisym.ttf')]:
    font = TTFont(name, str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / filename), subfontIndex=0)
    pdfmetrics.registerFont(font)
    fonts.append((name, font.face.charToGlyph))
pdf = canvas.Canvas(str(OUTPUT / 'knowledge-hard-digital.pdf'), pagesize=(600, 800), pageCompression=1, invariant=1)
pdf.setTitle('白鹭站资料管理手册 · 虚构复杂文档评测')
pdf.setAuthor('LLM Reader authored fixture')
gold = []

def line(text, x, y, size=11):
    for character in text:
        name = next((name for name, cmap in fonts if ord(character) in cmap), None)
        if not name:
            raise ValueError('No font for ' + repr(character))
        pdf.setFont(name, size)
        pdf.drawString(x, y, character)
        x += pdfmetrics.stringWidth(character, name, size)

def paragraph(text, x, y, width=244, size=11):
    current, length = '', 0
    for character in text:
        name = next(name for name, cmap in fonts if ord(character) in cmap)
        advance = pdfmetrics.stringWidth(character, name, size)
        if length + advance > width:
            line(current, x, y, size)
            current, length, y = '', 0, y - size * 1.7
        current += character
        length += advance
    if current:
        line(current, x, y, size)
    return y - size * 2.4

def page(number, title):
    line('白鹭站手册 · 页眉控制词：松柏紫荆', 40, 777, 8)
    pdf.line(40, 767, 560, 767)
    line(title, 40, 732, 18)
    line('自建虚构评测材料 / 第 ' + str(number) + ' 页', 40, 24, 9)

def evidence(identifier, text, page_number, x, y, width=244, size=11):
    gold.append({'id': identifier, 'quote': text, 'page': page_number})
    return paragraph(text, x, y, width, size)

page(1, '第一章 定义、现行规则与旧版干扰')
y = evidence('D01', '双钥封存须由两位不同值守人分别持有开启权限，禁止一人兼任。', 1, 40, 687)
y = evidence('D02', '白鹭站现行首次复查期限是封存后18小时，起点为封条登记时刻。', 1, 40, y - 18)
evidence('D03', '本手册小时均为连续自然小时，包含夜间及节假日。', 1, 40, y - 18)
y = evidence('D04', '旧版白鹭站规定12小时内复查，第三次修订后已废止。', 1, 316, 687)
y = evidence('D05', '苍鹭站仍以12小时为首次复查期限，不能把异站规则用于白鹭站。', 1, 316, y - 18)
paragraph('阅读提示：本页为双栏。左栏讲现行规则，右栏讲旧规及其他站点。下文没有给出事故率或作者电话。', 316, y - 18)
pdf.showPage()

page(2, '第二章 紧急授权与脚注')
y = evidence('D06', '应急旁路仅在电源中断、有人身危险、双签人无法到场且措施可撤回时使用。四项须同时满足。', 2, 40, 687)
evidence('D07', '通信故障不等于断电；供电正常时，不能因电话失联启用旁路。', 2, 40, y - 18)
y = evidence('D08', '危险解除不能免除追认义务。应急旁路启用后6小时内须交独立审计员追认。', 2, 316, 687)
paragraph('冻结时钟只适用于迁移中的只读镜像[1]。', 316, y - 18)
pdf.line(40, 175, 560, 175)
evidence('D09', '[1] 在线主库的复查计时不可随镜像暂停。', 2, 40, 151, 520, 10)
pdf.showPage()

def table(top, values):
    xs = [40, 136, 242, 348, 454, 560]
    height = 37
    for r in range(4):
        pdf.line(40, top-r*height, 560, top-r*height)
    for x in xs:
        if x in (242, 454):
            pdf.line(x, top-height, x, top-3*height)
        else:
            pdf.line(x, top, x, top-3*height)
    line('组别', 61, top-25)
    line('普通样本', 193, top-25)
    line('异常样本', 405, top-25)
    for i, text in enumerate(['', '保留天数', '复核阈值', '保留天数', '复核阈值']):
        line(text, xs[i]+10, top-62, 10)
    for i, text in enumerate(values):
        line(text, xs[i]+12, top-99)

page(3, '第三章 分类表（跨页）')
line('表1 白鹭站现行样本留存与复核标准', 40, 683, 13)
table(650, ['蓝组', '31', '0.72', '93', '0.88'])
gold.append({'id': 'D10', 'quote': '蓝组 31 0.72 93 0.88', 'page': 3})
paragraph('表中普通样本与异常样本各有两列；保留天数和复核阈值不能交换。续表在下一页。', 40, 490, 520)
pdf.showPage()

page(4, '第三章 分类表（续）')
line('表1（续） 白鹭站现行样本留存与复核标准', 40, 683, 13)
table(650, ['青组', '41', '0.62', '103', '0.98'])
gold.append({'id': 'D11', 'quote': '青组 41 0.62 103 0.98', 'page': 4})
evidence('D12', '表注：蓝组异常样本到93天仍有申诉时，应保留到结案后3天，再执行删除审批。', 4, 40, 490, 520)
paragraph('注意：此处“青组”不是“蓝组”的别名；同名列必须结合上层表头解释。', 40, 397, 520)
pdf.showPage()

page(5, '第四章 公式、边界与副本')
y = evidence('D13', '置信余量 M = (A - B) / C，只有 C > 0 且 A ≥ B 时可计算，M没有物理量纲。', 5, 40, 687)
evidence('D14', 'C = 0 时登记“不可计算”，不能用零或无穷大代替。', 5, 40, y - 18)
y = evidence('D15', '副本验收须逐段核对校验和，并随机试读5段；能打开或页数相同并不足够。', 5, 316, 687)
evidence('D16', '原件和复印件属于同一证据链；分别编号、保管不能使其成为独立来源。', 5, 316, y - 18)
pdf.showPage()

page(6, '第五章 恢复清单与字符保真')
y = evidence('D17', '迁移失败先恢复原索引，再核对原始记录校验和，最后重建派生缓存。禁止缓存反向覆盖原件。', 6, 40, 687, 520)
y = evidence('D18', '撤销共享仅取消他人访问权限，本地原始记录仍保留；销毁另需双签审批。', 6, 40, y - 18, 520)
evidence('D19', '字符保真：μ、Ω、😀、𠮷、é。这里没有联系电话、事故成功率或海鸥站规则。', 6, 40, y - 18, 520)
pdf.showPage()
pdf.save()

poppler = Path(os.environ.get('LLM_READER_PDFTOPPM') or shutil.which('pdftoppm') or
               Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe')
subprocess.run([str(poppler), '-png', '-r', '140', str(OUTPUT / 'knowledge-hard-digital.pdf'), str(PREVIEW / 'page')], check=True, capture_output=True)
scanned = canvas.Canvas(str(OUTPUT / 'knowledge-hard-scanned.pdf'), pagesize=(600, 800), pageCompression=1, invariant=1)
scanned.setTitle('白鹭站资料管理手册 · 图像扫描版')
for image in sorted(PREVIEW.glob('page-*.png')):
    scanned.drawImage(str(image), 0, 0, width=600, height=800)
    scanned.showPage()
scanned.save()
assert len(PdfReader(OUTPUT / 'knowledge-hard-digital.pdf').pages) == 6
extracted = ''.join(PdfReader(OUTPUT / 'knowledge-hard-digital.pdf').pages[5].extract_text().split())
assert all(character in extracted for character in ['μ', 'Ω', '😀', '𠮷', 'é'])
assert all(not page.extract_text().strip() for page in PdfReader(OUTPUT / 'knowledge-hard-scanned.pdf').pages)
(OUTPUT / 'knowledge-hard-gold.json').write_text(json.dumps(gold, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'pages': 6, 'variants': 2, 'gold': len(gold), 'scannedTextLayer': False}))
