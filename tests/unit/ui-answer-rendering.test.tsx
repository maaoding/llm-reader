// @vitest-environment jsdom

import React, { createRef, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BookRecord, ContextSnapshot, ProviderSettings, WorkbenchRecord } from '../../src/shared/contracts'
import { copyIn, setCopyLanguage } from '../../src/shared/copy'
import { ConversationPane } from '../../src/renderer/src/ConversationPane'
import WorkbenchesView from '../../src/renderer/src/WorkbenchesView'
import type { ConversationTurn } from '../../src/renderer/src/conversation-session'

const { answerRenders } = vi.hoisted(() => ({ answerRenders: vi.fn() }))
vi.mock('../../src/renderer/src/AnswerText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/src/AnswerText')>()
  return { ...actual, AnswerText: (props: ComponentProps<typeof actual.AnswerText>) => {
    answerRenders(props.text)
    return <actual.AnswerText {...props} />
  } }
})
vi.mock('../../src/renderer/src/BookCover', () => ({ BookCover: () => null }))

const provider: ProviderSettings = { baseUrl: 'https://synthetic.invalid/v1', model: 'mock', hasApiKey: true, compatibility: 'auto' }
const books: BookRecord[] = ['first', 'second'].map((id) => ({
  id, title: id, author: null, format: 'txt', sourceFormat: 'txt', originalName: `${id}.txt`,
  importedAt: '', lastOpenedAt: null, lastLocator: null, progress: 0
}))
function context(bookId = 'first', read = () => '历史证据'): ContextSnapshot {
  return { scope: 'book', bookId, selection: null, background: '', coverage: { covered: 0, total: 1 },
    passages: [{ id: 'P1', anchor: 'txt:0:6', chapterTitle: '第一章', bookId, get text() { return read() } }] }
}
function turn(index: number, evidence = context()): ConversationTurn {
  return { id: String(index), requestId: String(index), selection: null, context: evidence, action: 'ask', actionLabel: '提问',
    question: `问题 ${index}`, answer: `历史回答 ${index} [P1] [P99]`, model: 'mock', status: 'completed' }
}
function toggleDetails(details: Element, open: boolean): void {
  const element = details as HTMLDetailsElement
  element.open = open
  fireEvent(details, new Event('toggle'))
}
function singleProps(turns: ConversationTurn[]): ComponentProps<typeof ConversationPane> {
  return { turns, scope: 'book', conversationSelection: null, provider, activeRequestId: null, draft: '', canAsk: true,
    followupRef: createRef<HTMLTextAreaElement>(), onDraftChange: vi.fn(), onNavigate: vi.fn(), onCancel: vi.fn(), onSubmit: vi.fn() }
}
function workbenchProps(turns: ConversationTurn[]): ComponentProps<typeof WorkbenchesView> {
  const record: WorkbenchRecord = { id: 'workbench', name: '工作台', bookIds: books.map((book) => book.id), draft: '',
    turns: turns.map((item) => ({ ...item, bookIds: ['first'] })), webSearch: 'off', persona: null, createdAt: '', updatedAt: '' }
  return {
    books, provider, states: {}, personas: { presets: [], defaultId: null }, webSearchEnabled: false,
    coverCache: {} as ComponentProps<typeof WorkbenchesView>['coverCache'], refresh: vi.fn(async () => undefined),
    onPrepare: vi.fn(), onNavigate: vi.fn(), onConfigure: vi.fn(), onSavePersonaAs: vi.fn(), onArchiveViewChange: vi.fn(),
    controller: { records: [record], activeId: record.id, active: record, activate: vi.fn(), create: vi.fn(), remove: vi.fn(),
      update: vi.fn(), submit: vi.fn(), cancel: vi.fn(), flush: vi.fn(), beforeClose: vi.fn(), resumeAfterClose: vi.fn(),
      retrySaves: vi.fn(), loading: false, loadError: '', load: vi.fn(), errors: {}, dirty: [] }
  }
}

beforeEach(() => { answerRenders.mockClear(); setCopyLanguage('zh') })
afterEach(() => { cleanup(); setCopyLanguage('zh') })

it('keeps 20 historical single-book answers and current sources idle while text and drafts change', () => {
  const read = vi.fn(() => '活动证据')
  const history = Array.from({ length: 20 }, (_, index) => turn(index))
  const active = { ...turn(20, context('first', read)), status: 'streaming' as const, answer: '活动回答 0 [P1]' }
  const props = singleProps([...history, active])
  const view = render(<ConversationPane {...props} />)
  answerRenders.mockClear(); read.mockClear()
  for (let index = 1; index <= 10; index++) {
    view.rerender(<ConversationPane {...props} turns={[...history, { ...active, answer: `活动回答 ${index} [P1]` }]} draft={`草稿 ${index}`} />)
  }
  expect(answerRenders.mock.calls.map(([text]) => text)).toEqual(Array.from({ length: 10 }, (_, index) => `活动回答 ${index + 1} [P1]`))
  expect(read).not.toHaveBeenCalled()
  expect(screen.getByTestId('answer-current').textContent).toContain('活动回答 10')
})

it('refreshes single-book navigation, search, language and replaced evidence without stale callbacks', () => {
  const props = singleProps([turn(1)])
  const view = render(<ConversationPane {...props} />)
  const latestNavigate = vi.fn()
  view.rerender(<ConversationPane {...props} onNavigate={latestNavigate} searchNeedle="历史回答" />)
  expect(view.container.querySelector('.answer-text mark')?.textContent).toBe('历史回答')
  fireEvent.click(screen.getByTestId('citation-valid'))
  expect(latestNavigate).toHaveBeenLastCalledWith('txt:0:6', '第一章')
  expect(props.onNavigate).not.toHaveBeenCalled()
  setCopyLanguage('en')
  view.rerender(<ConversationPane {...props} onNavigate={latestNavigate} searchNeedle="历史回答" />)
  expect(screen.getByTestId('citation-unverified').textContent).toBe(copyIn('en', 'assistant.citationUnverified'))
  const changed = context('first', () => '替换后的证据')
  changed.passages[0].anchor = 'txt:10:16'
  view.rerender(<ConversationPane {...props} turns={[{ ...props.turns[0], context: changed }]} onNavigate={latestNavigate} />)
  fireEvent.click(screen.getByTestId('citation-valid'))
  expect(latestNavigate).toHaveBeenLastCalledWith('txt:10:16', '第一章')
  expect(screen.getByTestId('citation-valid').textContent).toContain('替换后的证据')
})

it('keeps 20 historical workbench answers and current sources idle during streaming', () => {
  const read = vi.fn(() => '活动证据')
  const props = workbenchProps([...Array.from({ length: 20 }, (_, index) => turn(index)), turn(20, context('first', read))])
  const record = props.controller.active!
  const history = record.turns.slice(0, -1)
  const active = { ...record.turns.at(-1)!, status: 'streaming' as const }
  const view = render(<WorkbenchesView {...props} />)
  answerRenders.mockClear(); read.mockClear()
  for (let index = 1; index <= 10; index++) {
    view.rerender(<WorkbenchesView {...props} controller={{ ...props.controller,
      active: { ...record, draft: `草稿 ${index}`, turns: [...history, { ...active, answer: `活动回答 ${index} [P1]` }] } }} />)
  }
  expect(answerRenders.mock.calls.map(([text]) => text)).toEqual(Array.from({ length: 10 }, (_, index) => `活动回答 ${index + 1} [P1]`))
  expect(read).not.toHaveBeenCalled()
})

it('refreshes workbench book identities, deleted sources, language and the latest navigation callback', () => {
  const evidence = context()
  evidence.scope = 'books'
  evidence.books = books.map(({ id, title }) => ({ id, title }))
  evidence.passages.push({ ...evidence.passages[0], id: 'P2', bookId: 'second', bookTitle: 'second', text: '第二本证据' })
  const props = workbenchProps([{ ...turn(1, evidence), answer: '对照 [P1] [P2] [P99]' }])
  const view = render(<WorkbenchesView {...props} />)
  const latestNavigate = vi.fn()
  view.rerender(<WorkbenchesView {...props} onNavigate={latestNavigate} />)
  fireEvent.click(screen.getAllByTestId('citation-valid')[1])
  expect(latestNavigate).toHaveBeenLastCalledWith('second', 'txt:0:6', '第一章')
  expect(props.onNavigate).not.toHaveBeenCalled()
  const remainingBooks = [books[0]]
  view.rerender(<WorkbenchesView {...props} onNavigate={latestNavigate} books={remainingBooks} />)
  expect(screen.getAllByTestId('citation-valid')).toHaveLength(1)
  toggleDetails(view.container.querySelector('details.answer-sources')!, true)
  expect(screen.getByRole('button', { name: /第二本证据/u }).hasAttribute('disabled')).toBe(true)
  setCopyLanguage('en')
  view.rerender(<WorkbenchesView {...props} onNavigate={latestNavigate} books={remainingBooks} />)
  expect(screen.getByTestId('citation-unverified').textContent).toBe(copyIn('en', 'assistant.citationUnverified'))
  expect(view.container.textContent).toContain(copyIn('en', 'workbench.deletedBook'))
})

it.each(['single', 'workbench'])('does not read uncited %s sources until their details are expanded', (kind) => {
  const read = vi.fn(() => '未引用的原文')
  const evidence = context()
  evidence.passages.push({ id: 'P2', anchor: 'txt:10:20', get text() { return read() } })
  const turns = [turn(1, evidence)]
  const view = kind === 'single' ? render(<ConversationPane {...singleProps(turns)} />) : render(<WorkbenchesView {...workbenchProps(turns)} />)
  expect(read).not.toHaveBeenCalled()
  expect(view.container.querySelector('.answer-source-item')).toBeNull()
  toggleDetails(view.container.querySelector('details.answer-sources')!, true)
  expect(read).toHaveBeenCalledOnce()
  expect(view.container.querySelectorAll('.answer-source-item')).toHaveLength(2)
})

it('does not filter or mount a closed workbench picker and restores its query when reopened', () => {
  const readAuthor = vi.fn(() => 'writer')
  const extra: BookRecord[] = Array.from({ length: 150 }, (_, index) => ({ ...books[0], id: `extra-${index}`, title: `extra-${index}`, get author() { return readAuthor() } }))
  const props = { ...workbenchProps([]), books: [...books, ...extra] }
  const view = render(<WorkbenchesView {...props} />)
  const details = view.container.querySelector('.workbench-book-selection')!
  expect(readAuthor).not.toHaveBeenCalled()
  expect(view.container.querySelector('.workbench-book-picker')).toBeNull()
  toggleDetails(details, true)
  expect(view.container.querySelectorAll('.workbench-book-picker label')).toHaveLength(100)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'extra-149' } })
  expect(view.container.querySelectorAll('.workbench-book-picker label')).toHaveLength(1)
  toggleDetails(details, false)
  readAuthor.mockClear()
  view.rerender(<WorkbenchesView {...props} controller={{ ...props.controller, active: { ...props.controller.active!, draft: 'new draft' } }} />)
  expect(readAuthor).not.toHaveBeenCalled()
  expect(view.container.querySelector('.workbench-book-picker')).toBeNull()
  toggleDetails(details, true)
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('extra-149')
  expect(view.container.querySelectorAll('.workbench-book-picker label')).toHaveLength(1)
})
