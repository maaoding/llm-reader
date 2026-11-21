// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CONVERSATION_COPY_MAX_LENGTH } from '../../src/shared/contracts'
import { useConversationMarkdown } from '../../src/renderer/src/use-conversation-markdown'
import { ConversationMarkdownTools, ConversationMarkdownFallback } from '../../src/renderer/src/ConversationMarkdownActions'
import type { ConversationTurn } from '../../src/renderer/src/conversation-session'
import { deferred } from './support/deferred'

const copyMarkdown = vi.fn(), exportMarkdown = vi.fn()
const book = { title: '复制测试', author: null }
const makeTurn = (answer = '原回答', status: ConversationTurn['status'] = 'completed'): ConversationTurn => ({
  id: 'one', requestId: '', action: 'ask', actionLabel: '提问', question: '原问题', answer, model: 'fixture', status, selection: null
})
function Controls({ turns, active = null, target }: { turns: ConversationTurn[]; active?: string | null; target?: HTMLElement }) {
  const controller = useConversationMarkdown(book, turns, active)
  return <>
    <ConversationMarkdownTools controller={controller} target={target} />
    {turns.map(turn => <button key={turn.id} data-testid={'copy-' + turn.id} disabled={!controller.canCopyTurn(turn)}
      onClick={event => controller.copyTurn(turn.id, event.currentTarget)}>复制本轮</button>)}
    <ConversationMarkdownFallback controller={controller} />
  </>
}
function View({ identity = 'a', ...props }: { identity?: string; turns: ConversationTurn[]; active?: string | null }) {
  return <Controls key={identity} {...props} />
}
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('readerApi', { copyConversationMarkdown: copyMarkdown, exportConversationMarkdown: exportMarkdown })
  copyMarkdown.mockReset().mockResolvedValue(undefined)
  exportMarkdown.mockReset().mockResolvedValue({ canceled: false, fileName: '会话.md' })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('places accessible icon actions in the header target while keeping feedback in the conversation', async () => {
  const header = document.createElement('header')
  document.body.append(header)
  try {
    const view = render(<Controls turns={[makeTurn()]} target={header} />)
    const trigger = screen.getByRole('button', { name: '复制当前会话' })
    expect(header.contains(trigger)).toBe(true)
    expect(trigger.textContent).toBe('')
    expect(header.contains(screen.getByRole('button', { name: '另存为 Markdown' }))).toBe(true)
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByTestId('conversation-markdown-status').textContent).toContain('已复制'))
    expect(header.contains(screen.getByTestId('conversation-markdown-status'))).toBe(false)
    view.unmount()
    expect(header.childElementCount).toBe(0)
  } finally { header.remove() }
})

it('copies ended turns while another turn is generating and blocks full-session actions', async () => {
  render(<View turns={[makeTurn(), { ...makeTurn('', 'streaming'), id: 'running' }]} active="request" />)
  expect(screen.getByTestId('conversation-copy').hasAttribute('disabled')).toBe(true)
  expect(screen.getByTestId('conversation-export').hasAttribute('disabled')).toBe(true)
  expect(screen.getByTestId('copy-running').hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByTestId('copy-one'))
  await waitFor(() => expect(copyMarkdown).toHaveBeenCalledOnce())
  expect(copyMarkdown.mock.calls[0][0]).toContain('原回答')
  expect(copyMarkdown.mock.calls[0][0]).not.toContain('第 2 轮')
})

it('freezes a failed copy snapshot, retains it across canceled/failed saves and retries exactly that content', async () => {
  const pending = deferred<void>()
  copyMarkdown.mockReturnValueOnce(pending.promise)
  const view = render(<View turns={[makeTurn()]} />)
  const trigger = screen.getByTestId('copy-one')
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(trigger)
  expect(copyMarkdown).toHaveBeenCalledOnce()
  view.rerender(<View turns={[makeTurn('后来改写的答案')]} />)
  await act(async () => pending.reject(new Error('private native clipboard error')))
  await waitFor(() => expect(screen.getByTestId('conversation-markdown-fallback')).toBeTruthy())
  expect(screen.getByTestId('conversation-markdown-fallback').textContent).not.toContain('private native')
  exportMarkdown.mockResolvedValueOnce({ canceled: true })
  fireEvent.click(screen.getByTestId('conversation-markdown-save'))
  await waitFor(() => expect(screen.getByTestId('conversation-markdown-save').hasAttribute('disabled')).toBe(false))
  expect(screen.getByTestId('conversation-markdown-fallback')).toBeTruthy()
  exportMarkdown.mockRejectedValueOnce(new Error('private path'))
  fireEvent.click(screen.getByTestId('conversation-markdown-save'))
  await waitFor(() => expect(screen.getByTestId('conversation-markdown-fallback').textContent).toContain('未能保存'))
  fireEvent.click(screen.getByTestId('conversation-markdown-save'))
  await waitFor(() => expect(screen.queryByTestId('conversation-markdown-fallback')).toBeNull())
  for (const [input] of exportMarkdown.mock.calls) {
    expect(input.markdown).toContain('原回答')
    expect(input.markdown).not.toContain('后来改写')
  }
  expect(screen.getByTestId('conversation-markdown-status').textContent).toContain('会话.md')
  expect(document.activeElement).toBe(trigger)
})

it('offers a file when copy is oversized and never sends an oversized clipboard request', async () => {
  render(<View turns={[makeTurn('x'.repeat(CONVERSATION_COPY_MAX_LENGTH + 1))]} />)
  fireEvent.click(screen.getByTestId('conversation-copy'))
  expect(copyMarkdown).not.toHaveBeenCalled()
  expect(screen.getByTestId('conversation-markdown-fallback').textContent).toContain('超过复制上限')
  expect(screen.queryByTestId('conversation-markdown-retry-copy')).toBeNull()
  fireEvent.click(screen.getByTestId('conversation-markdown-save'))
  await waitFor(() => expect(exportMarkdown).toHaveBeenCalledOnce())
  expect(exportMarkdown.mock.calls[0][0].markdown.length).toBeGreaterThan(CONVERSATION_COPY_MAX_LENGTH)
})

it('dismisses fallback with Escape and returns keyboard focus to its trigger', async () => {
  copyMarkdown.mockRejectedValueOnce(new Error('clipboard'))
  render(<View turns={[makeTurn()]} />)
  const trigger = screen.getByTestId('copy-one')
  trigger.focus()
  fireEvent.click(trigger)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('conversation-markdown-close')))
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByTestId('conversation-markdown-fallback')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it.each(['resolve', 'reject'] as const)('ignores a late copy %s after switching conversations', async result => {
  const pending = deferred<void>()
  copyMarkdown.mockReturnValueOnce(pending.promise)
  const view = render(<View turns={[makeTurn()]} />)
  fireEvent.click(screen.getByTestId('copy-one'))
  view.rerender(<View identity="other" turns={[makeTurn('另一本书')]} />)
  await act(async () => result === 'resolve' ? pending.resolve() : pending.reject(new Error('late')))
  expect(screen.queryByTestId('conversation-markdown-fallback')).toBeNull()
  expect(screen.queryByTestId('conversation-markdown-status')).toBeNull()
})

it('does not report a canceled direct save as success', async () => {
  exportMarkdown.mockResolvedValueOnce({ canceled: true })
  render(<View turns={[makeTurn()]} />)
  fireEvent.click(screen.getByTestId('conversation-export'))
  await waitFor(() => expect(screen.getByTestId('conversation-export').hasAttribute('disabled')).toBe(false))
  expect(screen.queryByTestId('conversation-markdown-status')).toBeNull()
  expect(screen.queryByTestId('conversation-markdown-fallback')).toBeNull()
})
