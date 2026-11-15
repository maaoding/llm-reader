// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useReadingGuide } from '../../src/renderer/src/use-reading-guide'

afterEach(() => { cleanup(); localStorage.clear() })

it('remembers a dismissed reading tip across restarts and can replay it', () => {
  const view = renderHook(() => useReadingGuide(true, false))
  expect(view.result.current.showReading).toBe(true)
  act(() => view.result.current.dismiss('reading'))
  view.unmount()
  const restored = renderHook(() => useReadingGuide(true, true))
  expect(restored.result.current.showReading).toBe(false)
  expect(restored.result.current.showAnswer).toBe(true)
  act(() => restored.result.current.replay())
  expect(restored.result.current.showReading).toBe(true)
})

it('waits for restored books and models before deciding whether to show tips', () => {
  const view = renderHook(({ ready, existing }) => useReadingGuide(ready, existing), { initialProps: { ready: false, existing: false } })
  expect(view.result.current.showReading).toBe(false)
  view.rerender({ ready: true, existing: true })
  expect(view.result.current.showReading).toBe(false)
  expect(view.result.current.showAnswer).toBe(false)
})
