// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ContextSnapshot, InsightArchiveRecord } from '../../src/shared/contracts'
import { copyIn, setCopyLanguage } from '../../src/shared/copy'
import { DeferredDetails } from '../../src/renderer/src/DeferredDetails'
import { WebSources } from '../../src/renderer/src/WebSources'
import InsightsView from '../../src/renderer/src/InsightsView'

function toggle(details: HTMLElement, open: boolean): void {
  const element = details as HTMLDetailsElement
  element.open = open
  fireEvent(details, new Event('toggle'))
}

afterEach(() => { cleanup(); setCopyLanguage('zh'); vi.unstubAllGlobals() })

it('defers mounting until expansion and preserves local state through closing and reopening', () => {
  const content = vi.fn(() => <input aria-label="nested draft" defaultValue="initial" />)
  const view = render(<DeferredDetails summary="Details">{content}</DeferredDetails>)
  const details = view.container.querySelector('details')!
  expect(content).not.toHaveBeenCalled()
  expect(screen.queryByRole('textbox')).toBeNull()
  toggle(details, true)
  const draft = screen.getByRole('textbox') as HTMLInputElement
  fireEvent.change(draft, { target: { value: 'retained draft' } })
  toggle(details, false)
  toggle(details, true)
  expect(screen.getByRole('textbox')).toBe(draft)
  expect(draft.value).toBe('retained draft')
  view.rerender(<DeferredDetails summary="Latest details">{() => <input aria-label="nested draft" defaultValue="new default" />}</DeferredDetails>)
  expect(screen.getByRole('textbox')).toBe(draft)
  expect(draft.value).toBe('retained draft')
  expect(details.querySelector('summary')?.textContent).toBe('Latest details')
})

it('keeps web excerpts lazy and cached while refreshing language, errors and the available book', async () => {
  const read = vi.fn(() => '<script>untrusted</script> excerpt')
  const open = vi.fn(async () => { throw new Error('Synthetic open failure') })
  Object.defineProperty(window, 'readerApi', { configurable: true, value: { openWebSource: open } })
  const context: ContextSnapshot = { scope: 'books', bookId: 'first', books: [{ id: 'first', title: 'First' }, { id: 'second', title: 'Second' }],
    selection: null, passages: [], background: '', coverage: { covered: 0, total: 0 },
    webSearch: { status: 'searched', reason: 'searched', query: 'query', sources: [{ id: 'W1', title: 'Source', url: 'https://synthetic.invalid/source', get excerpt() { return read() } }] } }
  const available = ['first', 'second']
  const view = render(<WebSources context={context} availableBookIds={available} uiLanguage="zh" />)
  expect(read).not.toHaveBeenCalled()
  expect(screen.queryByTestId('web-source-open')).toBeNull()
  const details = screen.getByTestId('web-sources')
  toggle(details, true)
  expect(read).toHaveBeenCalledOnce()
  expect(view.container.querySelector('script')).toBeNull()
  read.mockClear()
  view.rerender(<WebSources context={context} availableBookIds={available} uiLanguage="zh" />)
  expect(read).not.toHaveBeenCalled()
  fireEvent.click(screen.getByTestId('web-source-open'))
  await waitFor(() => expect(screen.getByText(copyIn('zh', 'webSearch.openFailed'))).toBeTruthy())
  toggle(details, false)
  toggle(details, true)
  expect(view.container.textContent).toContain(copyIn('zh', 'webSearch.openFailed'))
  const remaining = ['second']
  setCopyLanguage('en')
  view.rerender(<WebSources context={context} availableBookIds={remaining} uiLanguage="en" />)
  expect(details.querySelector('summary')?.textContent).toBe(copyIn('en', 'webSearch.sourcesTitle'))
  fireEvent.click(screen.getByTestId('web-source-open'))
  await waitFor(() => expect(open).toHaveBeenLastCalledWith({ bookId: 'second', url: 'https://synthetic.invalid/source' }))
})

it('refreshes translated archive citations and search fields while preserving saved answer text', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const insight: InsightArchiveRecord = { id: 'archive', conversationId: 'conversation', bookId: 'book', selection: null,
    question: 'Saved question', answer: 'Saved answer [P99]', model: 'mock', createdAt: '2026-10-31T00:00:00Z', history: [],
    book: { id: 'book', title: 'A book', author: null, format: 'txt' } }
  const props = { insights: [insight], loading: false, error: '', onRetry: vi.fn(), activeBookId: null, pendingDeleteInsightId: null,
    exporting: false, onOpenInsight: vi.fn(), onRequestDeleteInsight: vi.fn(), onDeleteInsight: vi.fn(), onCancelDeleteInsight: vi.fn(), onExportInsights: vi.fn() }
  const view = render(<InsightsView {...props} />)
  setCopyLanguage('en')
  view.rerender(<InsightsView {...props} />)
  expect(screen.getByTestId('citation-unverified').textContent).toBe(copyIn('en', 'assistant.citationUnverified'))
  expect(view.container.textContent).toContain('Saved answer')
  setCopyLanguage('zh')
  view.rerender(<InsightsView {...props} />)
  fireEvent.change(screen.getByTestId('insights-search-input'), { target: { value: copyIn('en', 'analysis.bookSource') } })
  expect(screen.queryByTestId('insight-item')).toBeNull()
  setCopyLanguage('en')
  view.rerender(<InsightsView {...props} />)
  expect(screen.getByTestId('insight-item').textContent).toContain('Saved answer')
})
