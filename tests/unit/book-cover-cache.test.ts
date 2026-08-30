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

  it('negative-caches missing covers and loader failures', async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('private failure'))
    const cache = new BookCoverCache(loader, vi.fn(() => 'blob:unused'), vi.fn())

    await expect(cache.load('missing')).resolves.toBeNull()
    await expect(cache.load('missing')).resolves.toBeNull()
    await expect(cache.load('failed')).resolves.toBeNull()
    await expect(cache.load('failed')).resolves.toBeNull()
    expect(loader).toHaveBeenCalledTimes(2)
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
