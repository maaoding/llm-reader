// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextReaderAdapter } from '../../src/renderer/src/readers/text-reader'
import { looksLikeMarkdown, MAX_MARKDOWN_CHARACTERS, renderMarkdownDocument } from '../../src/renderer/src/readers/markdown-document'
import { extractTextDocument } from '../../src/renderer/src/readers/book-extraction'
import { readTextReadingMode, saveTextReadingMode } from '../../src/renderer/src/text-reading-mode'

const adapters: TextReaderAdapter[] = []
afterEach(() => { adapters.splice(0).forEach((adapter) => adapter.destroy()); document.body.replaceChildren(); vi.restoreAllMocks() })
const cp = (value: string) => Array.from(value).length
const bytes = (value: string) => new TextEncoder().encode(value)
function setup() {
  const host = document.createElement('div'); document.body.append(host)
  const adapter = new TextReaderAdapter(host, { bookId: 'synthetic-markdown' })
  adapters.push(adapter)
  return { host, adapter }
}

describe('TXT Markdown presentation and original source positions', () => {
  it('requires structured evidence and bounds large input and unmatched fences', () => {
    for (const value of ['普通小说。\n\n第一章 开端\n\n一次偶然。', '# 单独的标题\n\n普通正文。', '价格 * 2；编号 #123。', '```js\n'.repeat(1_000)]) expect(looksLikeMarkdown(value)).toBe(false)
    for (const value of ['# 标题\n\n**重点**', '## 甲\n\n### 乙', '```ts\nconst x = 1\n```', '| 项目 | 值 |\n| --- | --- |\n| 甲 | 1 |']) expect(looksLikeMarkdown(value)).toBe(true)
    const large = '# 题\n\n**内容**' + '文'.repeat(MAX_MARKDOWN_CHARACTERS)
    expect(looksLikeMarkdown(large)).toBe(false)
    expect(() => renderMarkdownDocument(large, document)).toThrow('MARKDOWN_TOO_LARGE')
    expect(looksLikeMarkdown('x|'.repeat(900_000))).toBe(false)
  })

  it('renders headings, nested lists, quotes, code and tables through safe DOM only', () => {
    const source = '# 标题\n\n**重点**和*说明*、~~删除~~、`x`。\n\n- 条目\n  - 子项\n\n> 引用\n> 第二行\n\n```js\nconst x = "<img>"\n```\n\n| 项目 | 数值 |\n| --- | --- |\n| 一 | 2 |\n\n<script>alert(1)</script>\n\n![图](https://example.test/x.png)\n\n[外链](javascript:alert(1))'
    const rendered = renderMarkdownDocument(source, document)
    const root = document.createElement('article'); root.append(rendered.fragment)
    expect(root.querySelector('h1')?.textContent).toBe('标题')
    expect(root.querySelector('strong')?.textContent).toBe('重点')
    expect(root.querySelector('em')?.textContent).toBe('说明')
    expect(root.querySelector('s')?.textContent).toBe('删除')
    expect(root.querySelector('li li')?.textContent).toBe('子项')
    expect(root.querySelector('blockquote')?.textContent).toBe('引用\n第二行')
    expect(root.querySelector('pre code')?.textContent).toBe('const x = "<img>"')
    expect(root.querySelectorAll('table th')).toHaveLength(2)
    expect(root.querySelectorAll('table td')).toHaveLength(2)
    expect(root.querySelector('script,img,a,input,iframe')).toBeNull()
    expect(root.textContent).toContain('<script>alert(1)</script>')
    expect(root.textContent).toContain('[外链](javascript:alert(1))')
    for (const block of rendered.paragraphs) expect(Array.from(source).slice(block.start, block.end).join('')).toBe(block.text)
  })

  it('maps visible searches and selections across emphasis, emoji, escapes and entities to raw TXT anchors', async () => {
    const source = '# 文档\n\n甲**😀乙**丙 &amp; \\*星\\*。\n\n## 结尾\n\n结束。'
    const { host, adapter } = setup()
    const info = await adapter.open(bytes(source))
    expect(info.textRendering).toBe('markdown')
    expect(info.toc.map((item) => item.label)).toEqual(['文档', '结尾'])
    const hits = await adapter.search('甲😀乙丙')
    const start = cp(source.slice(0, source.indexOf('甲'))), end = cp(source.slice(0, source.indexOf('丙') + 1))
    expect(hits[0].anchor).toBe(`txt:${start}:${end}`)
    const paragraph = host.querySelector('p')!
    const range = document.createRange()
    range.setStart(paragraph.firstChild!, 0)
    range.setEnd(paragraph.querySelector('strong')!.nextSibling!, 1)
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    expect(adapter.getSelection()).toMatchObject({ quote: '甲😀乙丙', anchor: hits[0].anchor })
    expect(adapter.getSelection()?.passages.some((passage) => passage.text.includes('甲**😀乙**丙'))).toBe(true)
    const entity = await adapter.search('&')
    const entityStart = cp(source.slice(0, source.indexOf('&amp;')))
    expect(entity[0].anchor).toBe(`txt:${entityStart}:${entityStart + 5}`)
    const escaped = await adapter.search('*星*')
    expect(escaped).toHaveLength(1)
    await expect(adapter.highlight(hits[0].anchor)).resolves.toBeUndefined()
  })

  it('keeps old raw anchors, saved highlights and positions when switching presentation', async () => {
    const source = '# 甲\n\n普通**重点**结尾。\n\n## 乙\n\n第二节。'
    const { host, adapter } = setup()
    await adapter.open(bytes(source))
    const start = cp(source.slice(0, source.indexOf('普通'))), end = start + cp('普通**重点**结尾。')
    const anchor = `txt:${start}:${end}`
    await adapter.setHighlights([{ anchor }]); await adapter.goTo(anchor)
    const plain = await adapter.setTextMode('plain')
    expect(plain?.textRendering).toBe('plain')
    expect(host.textContent).toContain('普通**重点**结尾。')
    await expect(adapter.highlight(anchor)).resolves.toBeUndefined()
    const markdown = await adapter.setTextMode('markdown')
    expect(markdown?.textRendering).toBe('markdown')
    expect(host.querySelector('strong')?.textContent).toBe('重点')
    await expect(adapter.highlight(anchor)).resolves.toBeUndefined()
    const prepared = extractTextDocument(source)
    for (const unit of prepared.units) {
      const [, left, right] = unit.sources[0].anchor.split(':').map(Number)
      expect(Array.from(source).slice(left, right).join('')).toBe(unit.text)
    }
  })

  it('keeps forced Markdown useful for ambiguous short notes and literal content safe in plain mode', async () => {
    const { host, adapter } = setup()
    await adapter.setTextMode('markdown')
    expect((await adapter.open(bytes('短札中的**重点**。'))).textRendering).toBe('markdown')
    expect(host.querySelector('strong')?.textContent).toBe('重点')
    await adapter.setTextMode('plain')
    expect(host.querySelector('strong')).toBeNull()
    expect(host.textContent).toContain('**重点**')
  })

  it('stores only the selected book preference and safely rejects corrupt stored values', () => {
    localStorage.clear()
    expect(saveTextReadingMode('first', 'plain')).toBe(true)
    expect(saveTextReadingMode('second', 'markdown')).toBe(true)
    expect(readTextReadingMode('first')).toBe('plain')
    expect(readTextReadingMode('second')).toBe('markdown')
    expect(readTextReadingMode('unknown')).toBe('auto')
    localStorage.setItem('llm-reader.text-reading-mode.first', '<script>')
    expect(readTextReadingMode('first')).toBe('auto')
    localStorage.clear()
  })

  it('maps quoted escapes and indented fenced code back to the authored characters', () => {
    const source = '> 第一行\n> \\> 第二行\n\n> ```txt\n>   甲😀\n> 乙\n> ```\n\n未知 &notARealEntity;。\n\n> <div>\n> 原样 HTML\n> </div>'
    const rendered = renderMarkdownDocument(source, document)
    const quoted = rendered.paragraphs.find((block) => block.visibleText.includes('第一行'))!
    expect(quoted.visibleText).toBe('第一行\n> 第二行')
    expect(quoted.sourceOffset(quoted.visibleText.indexOf('>'))).toBe(cp(source.slice(0, source.indexOf('\\>') + 1)))
    const code = rendered.paragraphs.find((block) => block.element.tagName === 'PRE')!
    expect(code.visibleText).toBe('  甲😀\n乙')
    expect(code.sourceOffset(code.visibleText.indexOf('甲'))).toBe(cp(source.slice(0, source.indexOf('甲'))))
    const unknown = rendered.paragraphs.find((block) => block.visibleText.startsWith('未知'))!
    expect(unknown.sourceOffset(unknown.visibleText.indexOf('notARealEntity'))).toBe(cp(source.slice(0, source.indexOf('notARealEntity'))))
    expect(rendered.paragraphs.at(-1)!.visibleText).toBe('<div>\n原样 HTML\n</div>')
  })

  it('keeps basic reading available when forced Markdown exceeds nesting limits', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const onNotice = vi.fn()
    const adapter = new TextReaderAdapter(host, { bookId: 'deep-fixture', onNotice }); adapters.push(adapter)
    await adapter.setTextMode('markdown')
    const info = await adapter.open(bytes('> '.repeat(70) + '正文仍然可以阅读。'))
    expect(info.textRendering).toBe('plain')
    expect(host.textContent).toContain('正文仍然可以阅读。')
    expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ tone: 'info' }))
  })

  it('keeps metadata inference independent of Markdown blocks and presentation choice', async () => {
    const { adapter } = setup()
    for (const source of ['---\ntitle: 元数据\n---\n\n# 正文标题\n\n**正文**', '# **带强调的标题**\n\n正文。', '```txt\n第一段是代码\n```\n\n# 正文\n\n**内容**']) {
      await adapter.setTextMode('plain')
      const plain = await adapter.open(bytes(source))
      const markdown = await adapter.setTextMode('markdown')
      expect(markdown!.metadata).toEqual(plain.metadata)
    }
  })
})
