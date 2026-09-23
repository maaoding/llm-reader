// @vitest-environment jsdom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QuestionBubble } from '../../src/renderer/src/QuestionBubble'
import { copy } from '../../src/shared/copy'

beforeEach(() => vi.stubGlobal('React', React))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('collapses fixed actions while preserving the complete custom prompt', () => {
  const prompt = '请保留公式并解释论证条件。'.repeat(30)
  const { container } = render(<QuestionBubble action="explain" label="我的解释" question={prompt} />)
  expect(container.querySelector('details')?.open).toBe(false)
  expect(container.querySelector('p')?.textContent).toBe(prompt)
  expect(container.querySelector('.question-bubble > span')?.textContent).toBe('我的解释')
})

it('shows free questions directly and recognizes exact default prompts in older archives', () => {
  const question = '请解释这个概念，尤其是它的适用条件。'.repeat(20)
  const { container, rerender } = render(<QuestionBubble action="ask" label="自由提问" question={question} />)
  expect(container.querySelector('details')).toBeNull()
  expect(container.querySelector('p')?.textContent).toBe(question)
  rerender(<QuestionBubble action="ask" label="已保存的回答" question={copy('assistant.questionExplain')} />)
  expect(container.querySelector('details')?.open).toBe(false)
})

it('opens prompt matches for conversation search and closes them when the search is cleared', () => {
  const { container, rerender } = render(<QuestionBubble action="context" label="联系上下文" question="Check ABC 和引用" needle="abc" />)
  expect(container.querySelector('details')?.open).toBe(true)
  expect(container.querySelector('mark')?.textContent).toBe('ABC')
  rerender(<QuestionBubble action="context" label="联系上下文" question="Check ABC 和引用" />)
  expect(container.querySelector('details')?.open).toBe(false)
})
