// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SelectionContext } from '../../src/shared/contracts'
import { parseInline, parseMarkdown, previewInlines } from '../../src/renderer/src/answer-markdown'
import { AnswerText } from '../../src/renderer/src/AnswerText'

const selection: SelectionContext = {
  bookId: 'book-markdown',
  quote: '选中的内容',
  anchor: 'txt:100:106',
  chapterTitle: '第一章',
  passages: [
    {
      id: 'P2',
      text: '这是用于 Markdown 测试的原文摘要。',
      anchor: 'txt:80:150'
    }
  ]
}

afterEach(() => cleanup())

describe('markdown preview', () => {
  it('keeps inline marks and drops block markers', () => {
    const nodes = previewInlines('## 标题\n\n正文 **加粗** 与 `行内代码`。\n\n- 甲\n- 乙', 200)
    expect(nodes).toEqual([
      { type: 'text', text: '标题 正文 ' },
      { type: 'strong', children: [{ type: 'text', text: '加粗' }] },
      { type: 'text', text: ' 与 ' },
      { type: 'code', text: '行内代码' },
      { type: 'text', text: '。 甲 · 乙' }
    ])
  })

  it('truncates after parsing so cut markers never leak', () => {
    const nodes = previewInlines('**粗体内容**后面还有很多文字，足够超越限制。', 8)
    expect(nodes).toEqual([
      { type: 'strong', children: [{ type: 'text', text: '粗体内容' }] },
      { type: 'text', text: '后面还有…' }
    ])
    expect(JSON.stringify(nodes)).not.toContain('**')
  })

  it('returns an empty preview for empty input', () => {
    expect(previewInlines('', 20)).toEqual([])
    expect(previewInlines('正文', 0)).toEqual([{ type: 'text', text: '…' }])
  })
})

describe('answer markdown parser', () => {
  it('parses headings, lists, code fences, blockquotes, and inline marks', () => {
    const blocks = parseMarkdown(
      '### 标题\n\n**加粗**与*斜体*和`行内代码`。\n\n- 甲\n- 乙\n\n1. 第一\n2. 第二\n\n```ts\nconst x = 1\n```\n\n> 引文'
    )

    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'code',
      'blockquote'
    ])

    const heading = blocks[0]
    if (heading.type !== 'heading') throw new Error('expected heading')
    expect(heading.level).toBe(3)
    expect(heading.inlines).toEqual([{ type: 'text', text: '标题' }])

    const paragraph = blocks[1]
    if (paragraph.type !== 'paragraph') throw new Error('expected paragraph')
    expect(paragraph.inlines.map((inline) => inline.type)).toEqual(['strong', 'text', 'emphasis', 'text', 'code', 'text'])

    const unordered = blocks[2]
    if (unordered.type !== 'list') throw new Error('expected list')
    expect(unordered.ordered).toBe(false)
    expect(unordered.items).toHaveLength(2)

    const ordered = blocks[3]
    if (ordered.type !== 'list') throw new Error('expected list')
    expect(ordered.ordered).toBe(true)
    expect(ordered.items).toHaveLength(2)

    const code = blocks[4]
    if (code.type !== 'code') throw new Error('expected code')
    expect(code.language).toBe('ts')
    expect(code.text).toBe('const x = 1')
  })

  it('supports one level of nested lists', () => {
    const blocks = parseMarkdown('- 甲\n  - 甲一\n  - 甲二\n- 乙')
    expect(blocks).toHaveLength(1)
    const list = blocks[0]
    if (list.type !== 'list') throw new Error('expected list')
    expect(list.items).toHaveLength(2)
    expect(list.items[0].children.map((block) => block.type)).toEqual(['list'])
    const nested = list.items[0].children[0]
    if (nested.type !== 'list') throw new Error('expected nested list')
    expect(nested.items).toHaveLength(2)
  })

  it('treats an unclosed fence as a code block while streaming', () => {
    expect(parseMarkdown('```js\nlet x')).toEqual([
      { type: 'code', language: 'js', text: 'let x' }
    ])
  })

  it('keeps unmatched inline markers literal and honours backslash escapes', () => {
    expect(parseInline('**未闭合')).toEqual([{ type: 'text', text: '**未闭合' }])
    expect(parseInline('`未闭合')).toEqual([{ type: 'text', text: '`未闭合' }])
    expect(parseInline('\\*不是斜体\\*')).toEqual([{ type: 'text', text: '*不是斜体*' }])
  })

  it('preserves nested formatting, escaped markers and literal inline code', () => {
    expect(parseInline('前缀 \\*字面\\*，**重点 *嵌套* 和 `*代码*`**。')).toEqual([
      { type: 'text', text: '前缀 *字面*，' },
      { type: 'strong', children: [
        { type: 'text', text: '重点 ' },
        { type: 'emphasis', children: [{ type: 'text', text: '嵌套' }] },
        { type: 'text', text: ' 和 ' },
        { type: 'code', text: '*代码*' }
      ] },
      { type: 'text', text: '。' }
    ])
  })

  it.each(['*', '**', '`'])('distinguishes escaped and unescaped %s after backslashes', (marker) => {
    const escapedMarker = [...marker].map((character) => `\\${character}`).join('')
    const escaped = `${'\\'.repeat(2)}${escapedMarker}正文${escapedMarker}`
    expect(parseInline(escaped)).toEqual([{ type: 'text', text: `\\${marker}正文${marker}` }])

    const unescaped = `${'\\'.repeat(2)}${marker}正文${marker}`
    expect(parseInline(unescaped)).toEqual([
      { type: 'text', text: '\\' },
      marker === '`' ? { type: 'code', text: '正文' }
        : { type: marker === '**' ? 'strong' : 'emphasis', children: [{ type: 'text', text: '正文' }] }
    ])
  })

  it('keeps overlapping markers and incomplete streaming suffixes in their existing order', () => {
    expect(parseInline('***重点*** 后续 `未闭合')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: '*重点' }] },
      { type: 'text', text: '* 后续 `未闭合' }
    ])
    expect(parseInline('**重点\\*** 结尾')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: '重点*' }] },
      { type: 'text', text: ' 结尾' }
    ])
  })

  it.each(['*', '**', '`'])('parses a long paragraph of %s spans with a partial citation suffix', (marker) => {
    const count = 2_000
    const text = `${marker}内容😀${marker}。`.repeat(count) + '待补充 [P'
    const nodes = parseInline(text)
    expect(nodes).toHaveLength(count * 2)
    expect(nodes.filter((node) => node.type !== 'text')).toEqual(Array.from({ length: count }, () =>
      marker === '`' ? { type: 'code', text: '内容😀' }
        : { type: marker === '**' ? 'strong' : 'emphasis', children: [{ type: 'text', text: '内容😀' }] }))
    expect(nodes.at(-1)).toEqual({ type: 'text', text: '。待补充 [P' })
  })
})

describe('answer markdown component', () => {
  it('renders markdown structures without raw markers', () => {
    const { container } = render(
      <AnswerText
        text={'### 标题\n\n**重点**、*强调*、`term`。\n\n- 甲\n- 乙\n\n> 引文'}
        selection={selection}
        onNavigate={vi.fn()}
      />
    )

    expect(container.querySelector('h3')?.textContent).toBe('标题')
    expect(container.querySelector('strong')?.textContent).toBe('重点')
    expect(container.querySelector('em')?.textContent).toBe('强调')
    expect(container.querySelector('.answer-code-inline')?.textContent).toBe('term')
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.querySelector('blockquote')?.textContent).toContain('引文')
    expect(container.textContent).not.toContain('**')
  })

  it('keeps citations interactive in prose but literal inside code', () => {
    const onNavigate = vi.fn()
    const { container } = render(
      <AnswerText
        text={'依据 [P2]。\n\n```text\n[P2]\n```\n\n行内 `[P2]`。'}
        selection={selection}
        onNavigate={onNavigate}
      />
    )

    const citations = screen.getAllByTestId('citation-valid')
    expect(citations).toHaveLength(1)
    citations[0].click()
    expect(onNavigate).toHaveBeenCalledWith('txt:80:150')

    expect(container.querySelector('.answer-code-block')?.textContent).toBe('[P2]')
    expect(container.querySelector('.answer-code-inline')?.textContent).toBe('[P2]')
  })

  it('renders HTML-looking content as plain text only', () => {
    const { container } = render(
      <AnswerText
        text={'<script>alert("x")</script> <b>不是标签</b>'}
        selection={selection}
        onNavigate={vi.fn()}
      />
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<script>alert("x")</script>')
    expect(container.textContent).toContain('<b>不是标签</b>')
  })

  it('keeps partial streaming output readable', () => {
    const { container, rerender } = render(
      <AnswerText text={'```js\nlet x'} selection={selection} onNavigate={vi.fn()} />
    )
    expect(container.querySelector('.answer-code-block')?.textContent).toBe('let x')
    expect(container.textContent).not.toContain('```')

    rerender(<AnswerText text={'加粗 **未完成'} selection={selection} onNavigate={vi.fn()} />)
    expect(container.textContent).toContain('**未完成')
  })

  it('updates highlights, citation sources, callbacks and read-only mode while the answer stays unchanged', () => {
    const text = '**重点** 依据 [P2]。'
    const firstNavigate = vi.fn(), nextNavigate = vi.fn()
    const { container, rerender } = render(<AnswerText text={text} selection={selection} onNavigate={firstNavigate} />)
    fireEvent.click(screen.getByTestId('citation-valid'))
    expect(firstNavigate).toHaveBeenCalledExactlyOnceWith('txt:80:150')

    const updatedSelection: SelectionContext = { ...selection, passages: [{ id: 'P2', text: '更新后的原文', anchor: 'txt:200:206' }] }
    rerender(<AnswerText text={text} selection={updatedSelection} onNavigate={nextNavigate} highlight="重点" />)
    expect(container.querySelector('strong mark')?.textContent).toBe('重点')
    expect(screen.getByTestId('citation-valid').textContent).toContain('更新后的原文')
    fireEvent.click(screen.getByTestId('citation-valid'))
    expect(nextNavigate).toHaveBeenCalledExactlyOnceWith('txt:200:206')
    expect(firstNavigate).toHaveBeenCalledOnce()

    rerender(<AnswerText text={text} selection={updatedSelection} onNavigate={nextNavigate} readOnly />)
    expect(container.querySelector('mark')).toBeNull()
    expect(screen.getByTestId('citation-valid').tagName).toBe('SPAN')
    fireEvent.click(screen.getByTestId('citation-valid'))
    expect(nextNavigate).toHaveBeenCalledOnce()
  })

  it('renders citations as non-interactive spans in read-only previews', () => {
    const onNavigate = vi.fn()
    const { container } = render(
      <AnswerText
        text={'依据 [P2]，**重点**。'}
        selection={selection}
        onNavigate={onNavigate}
        readOnly
      />
    )

    const citation = screen.getByTestId('citation-valid')
    expect(citation.tagName).toBe('SPAN')
    fireEvent.click(citation)
    expect(onNavigate).not.toHaveBeenCalled()
    expect(container.querySelector('.answer-text strong')?.textContent).toBe('重点')
  })
})
