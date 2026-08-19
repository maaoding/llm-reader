// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SelectionContext } from '../../src/shared/contracts'
import { parseInline, parseMarkdown } from '../../src/renderer/src/answer-markdown'
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
