import { describe, expect, it, vi } from 'vitest'
import type { BookCoverPayload } from '../../src/shared/contracts'
import { BookCoverCache } from '../../src/renderer/src/book-cover-cache'

const cover: BookCoverPayload = { mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }

describe('BookCoverCache', () => {
  it('coalesces in-flight requests and reuses the session URL', async () => {
    const loader = vi.fn(async () => cover)
    const createUrl = vi.fn(() => 'blob:cover-1')
    const cache = new BookCoverCache(loader, createUrl, vi.fn())

    const first = cache.load('book-1')
    const second = cache.load('book-1')

    expect(first).toBe(second)
    await expect(first).resolves.toBe('blob:cover-1')
    await expect(cache.load('book-1')).resolves.toBe('blob:cover-1')
    expect(loader).toHaveBeenCalledOnce()
    expect(createUrl).toHaveBeenCalledOnce()
  })

  it('negative-caches missing covers but evicts transient loader failures', async () => {
    const loader = vi.fn(async (bookId: string) => {
      if (bookId === 'missing') return null
      if (loader.mock.calls.filter(([id]) => id === 'failed').length === 1) {
        throw new Error('private failure')
      }
      return cover
    })
    const cache = new BookCoverCache(loader, vi.fn(() => 'blob:unused'), vi.fn())

    await expect(cache.load('missing')).resolves.toBeNull()
    await expect(cache.load('missing')).resolves.toBeNull()
    await expect(cache.load('failed')).rejects.toThrow('private failure')
    await expect(cache.load('failed')).resolves.toBe('blob:unused')
    expect(loader).toHaveBeenCalledTimes(3)
  })

  it('evicts object URL creation failures so a later request can recover', async () => {
    const createUrl = vi.fn()
      .mockImplementationOnce(() => { throw new Error('blob unavailable') })
      .mockReturnValueOnce('blob:recovered')
    const cache = new BookCoverCache(vi.fn(async () => cover), createUrl, vi.fn())

    await expect(cache.load('book-1')).rejects.toThrow('blob unavailable')
    await expect(cache.load('book-1')).resolves.toBe('blob:recovered')
    expect(createUrl).toHaveBeenCalledTimes(2)
  })

  it('revokes URLs on removal and disposal', async () => {
    const revokeUrl = vi.fn()
    const cache = new BookCoverCache(
      vi.fn(async () => cover),
      ({ bytes }) => `blob:cover-${bytes[0]}`,
      revokeUrl
    )

    await cache.load('book-1')
    cache.remove('book-1')
    await cache.load('book-2')
    cache.dispose()

    expect(revokeUrl.mock.calls.flat()).toEqual(['blob:cover-1', 'blob:cover-1'])
    await expect(cache.load('book-3')).resolves.toBeNull()
  })
})
