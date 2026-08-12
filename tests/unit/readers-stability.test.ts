// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { stabilizeContinuousManager } from '../../src/renderer/src/readers/epub-continuous-stability'

describe('EPUB continuous manager compatibility', () => {
  it('uses the live native scroll position before every boundary check', async () => {
    const container = document.createElement('div')
    container.scrollTop = 384
    container.scrollLeft = 12
    const positionsSeenByCheck: Array<{ top: number; left: number }> = []
    const originalDestroy = vi.fn()
    const manager = {
      name: 'continuous',
      settings: { fullsize: false, offset: 500, afterScrolledTimeout: 10 },
      container,
      request: vi.fn(),
      q: {
        enqueue: async <T>(task: () => T | Promise<T>): Promise<T> => task()
      },
      views: { all: () => [] },
      scrollTop: 0,
      scrollLeft: 0,
      prevScrollTop: undefined as number | undefined,
      prevScrollLeft: undefined as number | undefined,
      addScrollListeners: vi.fn(),
      scrolled: vi.fn(),
      check: vi.fn(function (this: { scrollTop: number; scrollLeft: number }) {
        positionsSeenByCheck.push({ top: this.scrollTop, left: this.scrollLeft })
        return Promise.resolve(false)
      }),
      destroy: originalDestroy,
      emit: vi.fn(),
      isVisible: vi.fn(() => false),
      bounds: vi.fn(() => container.getBoundingClientRect()),
      trim: vi.fn(),
      update: vi.fn(async () => undefined)
    }

    expect(stabilizeContinuousManager({ manager })).toBe(true)
    await manager.check()

    expect(positionsSeenByCheck).toEqual([{ top: 384, left: 12 }])
    expect(manager.scrollTop).toBe(384)
    expect(manager.scrollLeft).toBe(12)

    manager.addScrollListeners()
    expect(container.style.overflowAnchor).toBe('none')
    expect(manager.prevScrollTop).toBe(384)
    expect(manager.prevScrollLeft).toBe(12)
    expect(stabilizeContinuousManager({ manager })).toBe(false)

    manager.destroy()
    expect(originalDestroy).toHaveBeenCalledOnce()
  })

  it('ignores non-continuous view managers', () => {
    expect(stabilizeContinuousManager({ manager: { name: 'default' } })).toBe(false)
    expect(stabilizeContinuousManager(null)).toBe(false)
  })

  it('keeps the configured preload offset while honoring an explicit zero offset', async () => {
    const container = document.createElement('div')
    const containerBounds = container.getBoundingClientRect()
    const isVisible = vi.fn(() => true)
    const view = {
      displayed: true,
      element: document.createElement('div'),
      iframe: document.createElement('iframe'),
      display: vi.fn().mockResolvedValue(undefined),
      show: vi.fn(),
      hide: vi.fn()
    }
    view.element.style.visibility = 'visible'
    view.iframe.style.visibility = 'visible'
    const manager = {
      name: 'continuous',
      settings: { fullsize: false, offset: 500, afterScrolledTimeout: 10 },
      container,
      request: vi.fn(),
      q: { enqueue: async <T>(task: () => T | Promise<T>): Promise<T> => task() },
      views: { all: () => [view] },
      scrollTop: 0,
      scrollLeft: 0,
      addScrollListeners: vi.fn(),
      scrolled: vi.fn(),
      check: vi.fn().mockResolvedValue(false),
      destroy: vi.fn(),
      emit: vi.fn(),
      isVisible,
      bounds: vi.fn(() => containerBounds),
      trim: vi.fn(),
      update: vi.fn(async (offset?: number) => {
        void offset
      })
    }

    expect(stabilizeContinuousManager({ manager })).toBe(true)
    await manager.update()
    await manager.update(0)

    expect(isVisible).toHaveBeenNthCalledWith(1, view, 500, 500, containerBounds)
    expect(isVisible).toHaveBeenNthCalledWith(2, view, 0, 0, containerBounds)
    expect(view.show).not.toHaveBeenCalled()
    expect(view.hide).not.toHaveBeenCalled()
  })
})
