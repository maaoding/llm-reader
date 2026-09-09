// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { extractEpubDocument, extractTextDocument, extractTextSections } from '../../src/renderer/src/readers/book-extraction'
import { documentSections, cropPassage } from '../../src/shared/document-structure'
import { normalizeDoclingDocument, normalizeMineruDocument } from '../../src/main/document-normalizer'
import { documentSectionSchema, normalizedDocumentSchema } from '../../src/main/schemas'
import { structureDoclingFixture } from '../../scripts/document-structure-fixture'
import type { BookRecord, LlmRequest } from '../../src/shared/contracts'
import { boundContext } from '../../src/main/llm-service'

describe('logical document units and source positions', () => {
  it('uses explicit Markdown and volume/chapter/section levels, keeping uncertain headings flat', () => {
    const document = extractTextDocument('# 总论\n\n## 定义\n\n内容。\n\n### 限制\n\n条件。\n\n一、附言\n\n另文。')
    expect(document.nodes.map((node) => [node.title, node.parentId])).toEqual([['总论', null], ['定义', 'txt-n0'], ['限制', 'txt-n1'], ['一、附言', null]])
    const numbered = extractTextDocument('第一卷 总论\n\n第一章 定义\n\n第一节 限制\n\n原文。')
    expect(numbered.nodes.map((node) => node.level)).toEqual([1, 2, 3])
    expect(documentSections(numbered).at(-1)?.blocks[0].headingPath).toEqual(['第一卷 总论', '第一章 定义', '第一节 限制'])
  })
  it('keeps duplicate headings and paragraphs at distinct Unicode positions, including long units', () => {
    const paragraph = '😀𠮷 é，必须核对真实位置。'.repeat(240)
    const original = '\uFEFF# 重复章\r\n\r\n' + paragraph + '\r\n\r\n# 重复章\r\n\r\n' + paragraph
    const normalized = Array.from(original.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n'))
    const document = extractTextDocument(original), sections = documentSections(document)
    expect(document.nodes).toHaveLength(2)
    const blocks = sections.flatMap((section) => section.blocks)
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length)
    expect(new Set(blocks.filter((block) => block.kind === 'paragraph').map((block) => block.unitId)).size).toBe(2)
    for (const block of blocks) {
      const [, start, end] = block.anchor.split(':').map(Number)
      expect(normalized.slice(start, end).join('')).toBe(block.text)
      expect(block.sources?.[0]).toMatchObject({ start, end })
    }
    expect(sections.every((section) => documentSectionSchema.safeParse(section).success)).toBe(true)
  })
  it('keeps untitled text honest and links only unambiguous footnote definitions', () => {
    expect(extractTextSections('普通正文。\n\n没有章名。').map((section) => section.chapterTitle)).toEqual(['文本分节'])
    const document = extractTextDocument('定义见脚注[^a]。\n\n- 清单一\n- 清单二\n\n[^a]: 明确的限制。\n\n[^b]: 孤立脚注。')
    expect(document.units[0].relatedIds).toEqual([document.units[2].id])
    expect(document.units[1].kind).toBe('list')
    expect(document.diagnostics).toContainEqual({ code: 'unlinked-note', unitId: document.units[3].id })
    const ambiguous = extractTextDocument('来源[^a]。\n\n[^a]: 第一处。\n\n[^a]: 第二处。')
    expect(ambiguous.units[0].relatedIds).toEqual([])
  })
  it('preserves EPUB fragment hierarchy, merges same-position headings, and links an authored footnote', async () => {
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip')
    zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    zip.file('OEBPS/book.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">structure-fixture</dc:identifier><dc:title>结构样本</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="body"/></spine></package>')
    zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="body.xhtml#a">总论</a><ol><li><a href="body.xhtml#b">同文件子章</a></li></ol></li></ol></nav></body></html>')
    zip.file('OEBPS/body.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><h1 id="a">总论</h1><p>正文 A。</p><h2 id="b">同文件子章</h2><p>正文 B <a href="#n" epub:type="noteref">脚注</a>。</p><aside epub:type="footnote" id="n"><p>只在条件满足时适用。</p></aside><h3>正文补充标题</h3><p>😀补充文字。</p></body></html>')
    const document = await extractEpubDocument({ book: { format: 'epub' } as BookRecord, bytes: await zip.generateAsync({ type: 'uint8array' }) }, new AbortController().signal)
    expect(document.nodes.map((node) => node.title)).toEqual(['总论', '同文件子章', '正文补充标题'])
    expect(document.nodes[1].parentId).toBe(document.nodes[0].id)
    expect(document.nodes[2].parentId).toBe(document.nodes[1].id)
    const reference = document.units.find((unit) => unit.text.includes('正文 B'))!
    expect(document.units.find((unit) => unit.id === reference.relatedIds[0])?.kind).toBe('note')
    expect(documentSections(document).every((section) => section.blocks.every((block) => /^epubcfi\(/u.test(block.anchor)))).toBe(true)
  })
})

describe('PDF tables, body tree and honest diagnostics', () => {
  it.each(['table', 'code', 'image', 'chart'])('retains %s annotations and sources when its body is missing', (type) => {
    for (const hasCaption of [false, true]) {
      const caption = '样本统计 😀', footnote = '注：样本数为三十，仅适用于历史样本。'
      const document = normalizeMineruDocument([
        { type: 'text', page_idx: 0, text: '正常正文。' },
        { type, page_idx: 1, bbox: [40, 200, 900, 800], [type + '_body']: '',
          [type + '_caption']: hasCaption ? [caption] : [], [type + '_footnote']: [footnote] }
      ], 2)
      const annotations = document.units.filter((unit) => unit.sources.some((source) => source.page === 2))
      expect(annotations.map((unit) => unit.text)).toEqual(hasCaption ? [caption, footnote] : [footnote])
      expect(annotations.every((unit) => unit.searchable && ['caption', 'note'].includes(unit.kind))).toBe(true)
      for (const unit of annotations) {
        expect(unit.sources[0]).toMatchObject({ page: 2, anchor: 'pdfpos:2:0.2', bbox: { left: 40, top: 200, right: 900, bottom: 800 } })
        expect(unit.relatedIds.every((id) => document.units.some((other) => other.id === id))).toBe(true)
      }
      expect(document.diagnostics).toContainEqual({ code: 'missing-body', page: 2 })
      if (type === 'table') expect(document.diagnostics.some((item) => item.code === 'table-degraded' && item.page === 2)).toBe(true)
      const sections = documentSections(document), blocks = sections.flatMap((section) => section.blocks)
      expect(blocks.some((block) => block.text === footnote && block.anchor === 'pdfpos:2:0.2')).toBe(true)
      expect(normalizedDocumentSchema.safeParse(document).success).toBe(true)
      expect(document.units.every((unit) => unit.text.trim())).toBe(true)
      expect(sections.every((section) => documentSectionSchema.safeParse(section).success)).toBe(true)
    }
  })
  it('preserves the body hierarchy, formula, explicit footnotes and every table source page', () => {
    const document = normalizeDoclingDocument(structureDoclingFixture(), 6)
    expect(normalizedDocumentSchema.safeParse(document).success).toBe(true)
    expect(document.nodes.filter((node) => node.parentId === document.nodes[0].id)).toHaveLength(5)
    const table = document.units.find((unit) => unit.table)!
    expect(table.sources.map((source) => source.page)).toEqual([3, 4])
    expect(table.sources.every((source) => source.bbox?.origin === 'TOPLEFT')).toBe(true)
    expect(table.table).toMatchObject({ rows: 4, columns: 2 })
    expect(table.relatedIds).toHaveLength(2)
    expect(document.units.find((unit) => unit.kind === 'formula')?.text).toContain('T = E / C')
    expect(document.units.find((unit) => unit.kind === 'header')?.searchable).toBe(false)
    expect(document.diagnostics.some((diagnostic) => diagnostic.code === 'unlinked-note')).toBe(true)
    expect(document.diagnostics.some((diagnostic) => diagnostic.code === 'suspected-duplicate')).toBe(true)
    const blocks = documentSections(document).flatMap((section) => section.blocks).filter((block) => block.kind === 'table')
    expect(blocks.every((block) => block.sources?.every((source) => source.precision === 'table'))).toBe(true)
    expect(blocks[0].tableSlice?.cells.some((cell) => cell.header)).toBe(true)
  })
  it('retains supplied group ancestry and classifies footer and missing-body pages without deleting unknown text', () => {
    const fixture = structureDoclingFixture()
    const children = fixture.body.children.splice(0, 3)
    const grouped = { ...fixture, groups: [{ name: '正文组', children }], body: { children: [{ $ref: '#/groups/0' }, ...fixture.body.children] } }
    const document = normalizeDoclingDocument(grouped, 6)
    expect(document.nodes[0].kind).toBe('group')
    expect(document.nodes[1].parentId).toBe(document.nodes[0].id)
    expect(document.nodes[2].parentId).toBe(document.nodes[1].id)
    const mineru = normalizeMineruDocument([{ type: 'page_footer', text: '页脚', page_idx: 0 }, { type: 'alien', text: '未知结构仍可核对。', page_idx: 1 }], 3)
    expect(mineru.units[0].searchable).toBe(false)
    expect(mineru.units[1]).toMatchObject({ kind: 'unknown', searchable: true })
    expect(mineru.diagnostics).toContainEqual({ code: 'missing-body', page: 3 })
    expect(mineru.diagnostics.some((item) => item.code === 'unknown-structure' && item.page === 2)).toBe(true)
  })
  it('parses merged HTML cells without executing markup, loading links or guessing cross-page tables', () => {
    const document = normalizeMineruDocument([{ type: 'text', text: '一级', text_level: 1, page_idx: 0 }, { type: 'text', text: '二级', text_level: 2, page_idx: 0 },
      { type: 'table', page_idx: 0, table_body: '<table><tr><th colspan="2">真实表头</th></tr><tr><td rowspan="2">共用条件</td><td>甲&amp;乙<img src="https://invalid/image"/><script>steal()</script></td></tr><tr><td>第二行</td></tr></table>', table_caption: ['表格标题'], table_footnote: ['表注限定。'] },
      { type: 'table', page_idx: 1, table_body: '<table><tr><td>同名但未关联的第二张表</td></tr></table>' }], 2)
    expect(document.nodes[1].parentId).toBe(document.nodes[0].id)
    const tables = document.units.filter((unit) => unit.table)
    expect(tables).toHaveLength(2)
    expect(tables[0].table?.cells.map((cell) => [cell.rowSpan, cell.columnSpan])).toContainEqual([2, 1])
    expect(tables[0].table?.cells[0].columnSpan).toBe(2)
    expect(tables[0].text).toContain('甲&乙')
    expect(JSON.stringify(document)).not.toMatch(/steal|https:\/\/invalid/u)
    expect(tables[0].sources.map((source) => source.page)).toEqual([1])
    expect(tables[1].relatedIds).toEqual([])
  })
  it('keeps complete headers with long rows and crops cell ranges together with evidence text', () => {
    const fixture = [{ type: 'table', page_idx: 0, table_body: '<table><tr><th>名称</th><th>说明</th></tr>' +
      '<tr><td>长行</td><td>' + '😀条件成立后才能实施。'.repeat(360) + '</td></tr>' +
      Array.from({ length: 100 }, (_, index) => '<tr><td>行' + index + '</td><td>完整行的实际规则。</td></tr>').join('') + '</table>' }]
    const document = normalizeMineruDocument(fixture, 1), table = document.units[0].table!
    const blocks = documentSections(document).flatMap((section) => section.blocks)
    expect(blocks.length).toBeGreaterThan(3)
    for (const original of blocks) for (const block of [original, cropPassage(original, Array.from(original.text).slice(0, 160).join(''))]) {
      expect(block.text.startsWith('名称\t说明\n')).toBe(true)
      expect(Array.from(block.text).length).toBeLessThanOrEqual(1_800)
      for (const range of block.tableSlice!.cells) expect(Array.from(table.cells.find((cell) => cell.id === range.id)!.text).slice(range.start, range.end).join(''))
        .toBe(Array.from(block.text).slice(range.textStart, range.textEnd).join(''))
    }
  })
  it('bounds merged-cell expansion before materializing an oversized table', () => {
    const document = normalizeMineruDocument([{ type: 'table', page_idx: 0, table_body: '<table><tr><td>' + '字符'.repeat(500) + '</td></tr></table>' }], 1)
    const table = document.units[0].table!
    table.rows = 1000; table.columns = 100
    table.cells[0].rowSpan = 1000; table.cells[0].columnSpan = 100
    expect(() => documentSections(document)).toThrow('表格展开超过处理上限')
  })
  it('retains actual column positions and separate header rows for merged provider tables', () => {
    // MinerU cloud returns td even for visual headers; preserve geometry without inventing header labels.
    const rows = '<tr><td>组别</td><td colspan="2">普通样本</td><td colspan="2">异常样本</td></tr>' +
      '<tr><td></td><td>保留天数</td><td>阈值</td><td>保留天数</td><td>阈值</td></tr>' +
      '<tr><td>蓝组</td><td>31</td><td>0.72</td><td>93</td><td>0.88</td></tr>'
    for (const markup of [rows, rows.replaceAll('<td', '<th').replaceAll('</td>', '</th>')]) {
      const document = normalizeMineruDocument([{ type: 'table', page_idx: 0, table_body: '<table>' + markup + '</table>' }], 1)
      const table = document.units[0].table!
      const block = documentSections(document).flatMap((section) => section.blocks)[0]
      expect(block.text.split('\n')).toEqual(['组别\t普通样本\t普通样本\t异常样本\t异常样本', '\t保留天数\t阈值\t保留天数\t阈值', '蓝组\t31\t0.72\t93\t0.88'])
      expect(table.cells[0].header).toBe(markup !== rows)
      for (const passage of [block, cropPassage(block, Array.from(block.text).slice(0, 18).join(''))]) {
        for (const range of passage.tableSlice!.cells) expect(Array.from(table.cells.find((cell) => cell.id === range.id)!.text).slice(range.start, range.end).join(''))
          .toBe(Array.from(passage.text).slice(range.textStart, range.textEnd).join(''))
      }
    }
  })
  it('degrades malformed table structure while keeping text and position, and rejects fabricated locations', () => {
    const document = normalizeMineruDocument([{ type: 'table', table_body: '<table><tr><td rowspan="bad">有效 &lt;文字&gt;</td></tr></table>', page_idx: 0, bbox: [0, 200, 900, 300] }], 2)
    expect(document.units[0]).toMatchObject({ kind: 'paragraph', text: '有效 <文字>' })
    expect(document.units[0].sources[0].anchor).toBe('pdfpos:1:0.2')
    expect(document.diagnostics).toContainEqual({ code: 'table-degraded', unitId: 'mineru-u0', page: 1 })
    expect(() => normalizeMineruDocument([{ type: 'text', text: '正文', page_idx: 2 }], 2)).toThrow()
    const fixture = structureDoclingFixture()
    fixture.tables[0].prov[1].page_no = 7
    expect(() => normalizeDoclingDocument(fixture, 6)).toThrow()
  })
  it('crops row metadata and precise cell page sources to only the actual evidence', () => {
    const fixture = structureDoclingFixture()
    for (const cell of fixture.tables[0].data.table_cells) Object.assign(cell, { prov: [{ page_no: cell.start_row_offset_idx < 2 ? 3 : 4,
      bbox: { l: 40, t: 100, r: 300, b: 150, coord_origin: 'TOPLEFT' } }] })
    const original = documentSections(normalizeDoclingDocument(fixture, 6)).flatMap((section) => section.blocks).find((block) => block.tableSlice)!
    const cropped = cropPassage(original, original.text.split('\n').slice(0, 2).join('\n'))
    expect(cropped.tableSlice?.rows).toEqual([1])
    expect([...new Set(cropped.sources?.map((source) => source.page))]).toEqual([3])
    expect(cropped.sources?.every((source) => source.precision === 'block')).toBe(true)
    expect(cropped.tableSlice?.cells.every((cell) => cell.textEnd <= Array.from(cropped.text).length)).toBe(true)
    const fixtureText = '😀跨页正文。'.repeat(360)
    const split = normalizeDoclingDocument({ pages: fixture.pages, body: { children: [{ $ref: '#/texts/0' }] },
      texts: [{ label: 'text', text: fixtureText, prov: [
        { page_no: 1, bbox: { t: 100, coord_origin: 'TOPLEFT' }, charspan: [0, 1200] },
        { page_no: 2, bbox: { t: 100, coord_origin: 'TOPLEFT' }, charspan: [1200, Array.from(fixtureText).length] }
      ] }] }, 6)
    const part = documentSections(split).flatMap((section) => section.blocks).at(-1)!
    const shortened = cropPassage(part, Array.from(part.text).slice(0, 100).join(''))
    expect(Number(shortened.sources?.[0].end) - Number(shortened.sources?.[0].start)).toBe(100)
    expect(shortened.sources?.[0].textEnd).toBe(100)
  })
  it('keeps the supplied double-column reading order and source coordinates', () => {
    const fixture = structureDoclingFixture()
    const first = fixture.texts[2], second = fixture.texts[3]
    first.prov = [{ page_no: 1, bbox: { l: 40, t: 600, r: 450, b: 640, coord_origin: 'TOPLEFT' } }]
    second.prov = [{ page_no: 1, bbox: { l: 520, t: 100, r: 900, b: 140, coord_origin: 'TOPLEFT' } }]
    const document = normalizeDoclingDocument(fixture, 6)
    const left = document.units.find((unit) => unit.text === first.text)!, right = document.units.find((unit) => unit.text === second.text)!
    expect(left.order).toBeLessThan(right.order)
    expect(left.sources[0].bbox?.left).toBe(40); expect(right.sources[0].bbox?.left).toBe(520)
  })
  it('degrades a missing Docling table schema and malformed HTML while retaining valid words and page', () => {
    const fixture = structureDoclingFixture()
    Object.assign(fixture.tables[0], { data: null, text: '有效表格文字仍需核对。', footnotes: [{ $ref: '#/texts/99999' }] })
    const document = normalizeDoclingDocument(fixture, 6)
    expect(document.units.find((unit) => unit.id === 'docling-tables-0')).toMatchObject({ kind: 'paragraph', text: '有效表格文字仍需核对。' })
    expect(document.diagnostics).toContainEqual({ code: 'table-degraded', page: 3, unitId: 'docling-tables-0' })
    expect(document.diagnostics.some((item) => item.code === 'unlinked-note')).toBe(true)
    const html = normalizeMineruDocument([{ page_idx: 0, type: 'table', table_body: '<table><tr><td>不完整表格文字' }], 1)
    expect(html.units[0]).toMatchObject({ kind: 'paragraph', text: '不完整表格文字' })
  })
  it('retains an oversized header and distinguishes row headers from repeatable column headers', () => {
    const document = normalizeMineruDocument([{ page_idx: 0, type: 'table', table_body: '<table><tr><th>' + '😀'.repeat(2000) +
      '</th><th>列标题</th></tr><tr><th scope="row">行标题</th><td>内容</td></tr></table>' }], 1)
    const table = document.units[0].table!
    expect(table.cells.find((cell) => cell.text === '行标题')).toMatchObject({ header: false, rowHeader: true })
    const blocks = documentSections(document).flatMap((section) => section.blocks)
    expect(blocks.every((block) => Array.from(block.text).length <= 1800)).toBe(true)
    const largeHeader = table.cells[0]
    const ranges = blocks.flatMap((block) => block.tableSlice!.cells).filter((cell) => cell.id === largeHeader.id)
    expect(ranges.reduce((sum, range) => sum + range.end - range.start, 0)).toBe(2000)
    expect(blocks.some((block) => block.text.includes('行标题\t内容'))).toBe(true)
  })
  it('budgets a dense table by actual model input rather than its local cell metadata', () => {
    const document = normalizeMineruDocument([{ page_idx: 0, type: 'table', table_body: '<table><tr><th>项</th><th>值</th></tr>' +
      Array.from({ length: 120 }, (_, index) => `<tr><td>${index}</td><td>甲</td></tr>`).join('') + '</table>' }], 1)
    const passages = documentSections(document).flatMap((section) => section.blocks).map((block) => ({ ...block, evidenceRole: 'chapter' as const }))
    const request: LlmRequest = { scope: 'book', bookId: 'book', requestId: 'test', conversationId: 'test', action: 'ask', question: '表中是什么？', history: [] }
    const result = boundContext(request, { scope: 'book', bookId: 'book', selection: null, passages, background: '', coverage: { covered: 0, total: 1 } }, 3000)
    expect(result.context.passages).toHaveLength(1)
    expect(result.context.passages[0].text).toContain('119\t甲')
    expect(result.context.passages[0].tableSlice?.rows).toHaveLength(120)
  })
})
