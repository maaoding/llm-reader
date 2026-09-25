// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PdfImageRegionSource, SelectionContext } from '../../src/shared/contracts'
import { AnswerText } from '../../src/renderer/src/AnswerText'
import { citationExcerpt } from '../../src/renderer/src/citations'

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

afterEach(() => cleanup())

describe('citation presentation', () => {
  it('normalizes excerpts by Unicode code point and uses a safe empty fallback', () => {
    expect(citationExcerpt(' 第一段\n  第二段 ')).toBe('第一段 第二段')
    expect(citationExcerpt('中'.repeat(24))).toBe('中'.repeat(24))
    expect(citationExcerpt('😀'.repeat(25))).toBe(`${'😀'.repeat(24)}…`)
    expect(citationExcerpt('   ')).toBe('原文片段')
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
