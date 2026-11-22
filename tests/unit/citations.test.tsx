// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContextSnapshot, PdfImageRegionSource, SelectionContext } from '../../src/shared/contracts'
import { AnswerText } from '../../src/renderer/src/AnswerText'
import { EvidenceSources } from '../../src/renderer/src/EvidenceSources'
import { citationExcerpt, createCitationResolver } from '../../src/renderer/src/citations'
import { copyIn, setCopyLanguage } from '../../src/shared/copy'

const selection: SelectionContext = {
  bookId: 'book-citations',
  quote: '选中的内容',
  anchor: 'txt:100:106',
  chapterTitle: '第一章',
  passages: [
    {
      id: 'P2',
      text: '  这是包含   多余空格与换行的原文摘要，用于确认引用展示不会再暴露内部段落标识符。  ',
      anchor: 'txt:80:150'
    }
  ]
}

afterEach(() => { cleanup(); setCopyLanguage('zh') })

describe('citation presentation', () => {
  it.each([
    ['', ''],
    ['短证据😀', '短证据😀'],
    ['中'.repeat(59) + '😀末尾', '中'.repeat(59) + '😀'],
    ['😀'.repeat(100_000), '😀'.repeat(60)]
  ])('bounds source previews by Unicode code points (case %#)', (text, preview) => {
    render(<EvidenceSources passages={[{ id: 'P1', text, anchor: 'txt:0:1' }]} onNavigate={vi.fn()} />)
    expect(screen.getByRole('button').textContent).toBe(preview)
  })

  it('keeps source and PDF page navigation book-specific while preserving single-book navigation', () => {
    const onNavigate = vi.fn()
    const passages = [
      { id: 'P1', text: '甲书证据', anchor: 'pdf:2', chapterTitle: '判断', bookId: 'first', bookTitle: '甲书', sources: [{ anchor: 'pdf:3', page: 3, precision: 'text' as const }] },
      { id: 'P2', text: '乙书证据', anchor: 'pdf:2', chapterTitle: '判断', bookId: 'second', bookTitle: '乙书', sources: [{ anchor: 'pdf:3', page: 3, precision: 'text' as const }] }
    ]
    const view = render(<EvidenceSources passages={passages} availableBookIds={['first', 'second']} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: /乙书证据/u }))
    fireEvent.click(screen.getAllByRole('button', { name: /3/u })[1])
    expect(onNavigate.mock.calls).toEqual([['pdf:2', '判断', 'second'], ['pdf:3', '判断', 'second']])
    view.rerender(<EvidenceSources passages={passages} availableBookIds={['first']} onNavigate={onNavigate} />)
    expect(screen.getByRole('button', { name: /乙书证据/u }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: /3/u })[1])
    expect(onNavigate).toHaveBeenCalledTimes(2)
    view.rerender(<EvidenceSources passages={[{ id: 'P1', text: '单书证据', anchor: 'pdf:2', chapterTitle: '判断' }]} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: /单书证据/u }))
    expect(onNavigate).toHaveBeenLastCalledWith('pdf:2', '判断')
  })
  it('routes identical anchors to their own books and keeps deleted evidence readable', () => {
    const onNavigate = vi.fn()
    const context = { scope: 'books' as const, bookId: 'first', books: [{ id: 'first', title: '甲书' }, { id: 'second', title: '乙书' }], selection: null,
      background: '', coverage: { covered: 0, total: 2 }, passages: [
        { id: 'P1', anchor: 'txt:0:5', text: '相同原文', bookId: 'first', bookTitle: '甲书' },
        { id: 'P2', anchor: 'txt:0:5', text: '相同原文', bookId: 'second', bookTitle: '乙书' }
      ] }
    const view = render(<AnswerText text="比较 [P1] 与 [P2]" selection={null} context={context} onNavigate={onNavigate} availableBookIds={['first', 'second']} />)
    fireEvent.click(screen.getByRole('button', { name: /甲书/u }))
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('source-preview-jump'))
    fireEvent.click(screen.getByRole('button', { name: /乙书/u }))
    fireEvent.click(screen.getByTestId('source-preview-jump'))
    expect(onNavigate.mock.calls).toEqual([['txt:0:5', 'first', undefined], ['txt:0:5', 'second', undefined]])
    view.rerender(<AnswerText text="比较 [P1] 与 [P2]" selection={null} context={context} onNavigate={onNavigate} availableBookIds={['first']} />)
    fireEvent.click(screen.getByRole('button', { name: /乙书.*书籍已删除/u }))
    expect(screen.getByTestId('source-preview-text').textContent).toBe('相同原文')
    expect(screen.getByText(copyIn('zh', 'workbench.missingSource'))).toBeTruthy()
    expect(screen.queryByTestId('source-preview-jump')).toBeNull()
  })

  it('previews the exact passage for each turn and uses the same evidence in the source list', () => {
    const longText = `第一轮原文\n  ${'段落内容'.repeat(400)}\n<em>原始文本</em>`
    const first: ContextSnapshot = {
      scope: 'book', bookId: selection.bookId, selection: null, background: '', coverage: { covered: 0, total: 0 },
      passages: [{ id: 'P1', text: longText, anchor: 'txt:100:106', headingPath: ['第一章', '第一节'] }]
    }
    const second: ContextSnapshot = {
      ...first,
      passages: [{ id: 'P1', text: '第二轮保留的原文', anchor: '' }]
    }
    const onNavigate = vi.fn()
    render(<>
      <AnswerText text="第一轮 [P1] [P99] `[P1]`" selection={selection} context={first} bookTitle="测试书名" onNavigate={onNavigate} />
      <AnswerText text="第二轮 [P1]" selection={selection} context={second} onNavigate={onNavigate} />
      <EvidenceSources passages={first.passages} context={first} bookTitle="测试书名" onNavigate={onNavigate} />
    </>)
    const [firstRef, secondRef] = screen.getAllByTestId('citation-valid')
    fireEvent.pointerEnter(firstRef)
    expect(screen.getByTestId('source-preview-text').textContent).toBe(longText)
    expect(screen.getByTestId('source-preview').textContent).toContain('第一章 / 第一节')
    expect(screen.getByTestId('source-preview').textContent).toContain('测试书名')
    expect(screen.getByTestId('source-preview-text').querySelector('em')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('source-preview')).toBeNull()
    expect(document.activeElement).toBe(firstRef)

    fireEvent.click(secondRef)
    expect(screen.getByTestId('source-preview-text').textContent).toBe('第二轮保留的原文')
    expect(screen.getByText(copyIn('zh', 'sources.locationUnavailable'))).toBeTruthy()
    expect(screen.queryByTestId('source-preview-jump')).toBeNull()
    fireEvent.click(screen.getByLabelText(copyIn('zh', 'window.closeAria')))

    fireEvent.click(screen.getByTestId('source-preview-trigger'))
    expect(screen.getByTestId('source-preview-text').textContent).toBe(longText)
    expect(screen.getAllByTestId('citation-unverified')).toHaveLength(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })
  it('normalizes excerpts by Unicode code point and uses a safe empty fallback', () => {
    expect(citationExcerpt(' 第一段\n  第二段 ')).toBe('第一段 第二段')
    expect(citationExcerpt('中'.repeat(24))).toBe('中'.repeat(24))
    expect(citationExcerpt('😀'.repeat(25))).toBe(`${'😀'.repeat(24)}…`)
    expect(citationExcerpt('   ')).toBe('原文片段')
    expect(citationExcerpt('中'.repeat(24) + '\n\t  ')).toBe('中'.repeat(24))
    expect(citationExcerpt('中'.repeat(23) + '\n\t😀尾文')).toBe('中'.repeat(23) + ' …')
    expect(citationExcerpt('\u00a0😀\u2003中\ufeff')).toBe('😀 中')
    expect(citationExcerpt('😀'.repeat(1_000_000))).toBe('😀'.repeat(24) + '…')
  })

  it('reuses cited excerpts across answer fragments without reading uncited passages', () => {
    const read = vi.fn(() => '引用原文'.repeat(5_000))
    const source: SelectionContext = { ...selection, passages: [
      { id: 'P1', anchor: 'txt:1:2', get text() { return read() } },
      { id: 'P2', anchor: 'txt:2:3', get text(): string { throw new Error('Uncited source should stay lazy') } }
    ] }
    const navigate = vi.fn()
    const view = render(<AnswerText text={'引用 [P1]。\n\n'.repeat(30)} selection={source} onNavigate={navigate} />)
    view.rerender(<AnswerText text={'引用 [P1]。\n\n'.repeat(40)} selection={source} onNavigate={navigate} />)
    expect(read).toHaveBeenCalledOnce()
    fireEvent.click(view.getAllByTestId('citation-valid')[0])
    expect(navigate).toHaveBeenCalledWith('txt:1:2')
  })

  it('refreshes translated labels and empty fallbacks while reusing the same source index', () => {
    const resolve = createCitationResolver([{ id: 'P1', text: ' \n ', anchor: 'txt:1:2' }])
    expect(resolve('[P1]')).toContainEqual(expect.objectContaining({ label: '原文：原文片段' }))
    setCopyLanguage('en')
    expect(resolve('[P1] [P99]')).toContainEqual(expect.objectContaining({ label: copyIn('en', 'assistant.citationExcerpt', { excerpt: copyIn('en', 'assistant.citationSourceFallback') }) }))
    expect(resolve('[P99]')).toContainEqual(expect.objectContaining({ label: copyIn('en', 'assistant.citationUnverified') }))
  })

  it('renders valid citations as excerpt buttons without exposing internal ids', () => {
    const onNavigate = vi.fn()
    render(
      <AnswerText
        text="依据 [P2]；未知 [P99]；术语 [API]。"
        selection={selection}
        onNavigate={onNavigate}
      />
    )

    const answer = screen.getByText(/依据/u).closest('.answer-text')!
    expect(answer.textContent).toContain('原文：这是包含 多余空格与换行的原文摘要')
    expect(answer.textContent).toContain('未验证引用')
    expect(answer.textContent).toContain('[API]')
    expect(answer.textContent).not.toContain('P2')
    expect(answer.textContent).not.toContain('P99')

    const valid = screen.getByTestId('citation-valid')
    const unverified = screen.getByTestId('citation-unverified')
    expect(valid.title).not.toContain('P2')
    expect(unverified.tagName).toBe('SPAN')
    fireEvent.click(unverified)
    expect(onNavigate).not.toHaveBeenCalled()
    fireEvent.click(valid)
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenCalledWith('txt:80:150')
  })

  it('hides an incomplete streaming citation marker until it closes', () => {
    const { rerender } = render(
      <AnswerText text="正在生成 [P" selection={selection} onNavigate={() => undefined} />
    )
    expect(screen.getByText(/正在生成/u).closest('.answer-text')?.textContent).toBe('正在生成 ')

    rerender(<AnswerText text="正在生成 [P2]" selection={selection} onNavigate={() => undefined} />)
    expect(screen.getByTestId('citation-valid').textContent).not.toContain('P2')
  })

  it('never presents model-invented text citations as valid for an image region', () => {
    const imageSelection: PdfImageRegionSource = { kind: 'pdf-image-region', bookId: 'book-citations',
      anchor: 'pdfrect:1:0.1:0.2:0.8:0.9', pageNumber: 1, left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 }
    render(<AnswerText text="图中是表格 [P1]。" selection={imageSelection} onNavigate={vi.fn()} />)
    expect(screen.queryByTestId('citation-valid')).toBeNull()
    expect(screen.getByTestId('citation-unverified').textContent).toContain('未验证引用')
  })
})
