import { describe, expect, it, vi } from 'vitest'
import { PendingSaves } from '../../src/renderer/src/pending-saves'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

describe('pending session saves', () => {
  it('keeps failed snapshots until retry succeeds and deduplicates acknowledged saves', async () => {
    const failure = new Error('disk full')
    const write = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    const changed = vi.fn()
    const saves = new PendingSaves<{ draft: string }>(write, changed)

    await expect(saves.save('book-a', { draft: 'first draft' })).rejects.toBe(failure)
    expect(saves.pendingCount).toBe(1)
    expect(saves.failedKeys).toEqual(['book-a'])
    await saves.wait('book-a')
    expect(write).toHaveBeenCalledTimes(1)
    await saves.retry()
    expect(write).toHaveBeenLastCalledWith('book-a', { draft: 'first draft' })
    expect(saves.pending).toBe(false)
    expect(saves.failed).toBe(false)
    await saves.save('book-a', { draft: 'first draft' })
    expect(write).toHaveBeenCalledTimes(2)
    expect(changed).toHaveBeenCalled()
  })

  it('serializes writes and coalesces intermediate edits without acknowledging the latest too early', async () => {
    const first = deferred()
    const last = deferred()
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    const saves = new PendingSaves<{ draft: string }>(write)
    const initial = saves.save('book-a', { draft: 'initial' })
    await Promise.resolve()
    const intermediate = saves.save('book-a', { draft: 'intermediate' })
    const latest = saves.save('book-a', { draft: 'latest' })
    expect(write).toHaveBeenCalledTimes(1)
    first.resolve()
    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith('book-a', { draft: 'latest' })
    expect(saves.pendingCount).toBe(1)
    last.resolve()
    await Promise.all([initial, intermediate, latest])
    expect(saves.pending).toBe(false)
  })

  it('does not let an old failure overwrite a successful newer edit', async () => {
    const first = deferred()
    const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
    const saves = new PendingSaves<string>(write)
    const initial = saves.save('book-a', 'old')
    await Promise.resolve()
    const latest = saves.save('book-a', 'new')
    first.reject(new Error('old write rejected'))
    await Promise.all([initial, latest])
    expect(write.mock.calls).toEqual([['book-a', 'old'], ['book-a', 'new']])
    expect(saves.failed).toBe(false)
    expect(saves.pending).toBe(false)
  })

  it('saves an edit that arrives immediately after storage acknowledgement', async () => {
    const first = deferred()
    const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
    const saves = new PendingSaves<string>(write)
    const initial = saves.save('book-a', 'first')
    await Promise.resolve()
    let latest!: Promise<void>
    first.resolve()
    queueMicrotask(() => { latest = saves.save('book-a', 'latest') })
    await initial
    await latest
    expect(write.mock.calls).toEqual([['book-a', 'first'], ['book-a', 'latest']])
    expect(saves.pending).toBe(false)
  })

  it('retains the newest failed value and never loops retrying a persistent failure', async () => {
    const first = deferred()
    const failure = new Error('unavailable storage')
    const write = vi.fn().mockReturnValueOnce(first.promise).mockRejectedValue(failure)
    const saves = new PendingSaves<string>(write)
    const initial = saves.save('book-a', 'old')
    await Promise.resolve()
    const latest = saves.save('book-a', 'new')
    const rejected = expect(Promise.all([initial, latest])).rejects.toBe(failure)
    first.resolve()
    await rejected
    expect(write).toHaveBeenCalledTimes(2)
    expect(saves.failedKeys).toEqual(['book-a'])
    await expect(saves.retry()).rejects.toBe(failure)
    expect(write).toHaveBeenCalledTimes(3)
    expect(write).toHaveBeenLastCalledWith('book-a', 'new')
  })

  it('writes different books independently and waits for all retry results', async () => {
    let failing = true
    const second = deferred()
    const write = vi.fn(async (key: string) => {
      if (failing) throw new Error('disk full')
      if (key === 'book-b') return second.promise
      throw new Error('book-a still unavailable')
    })
    const saves = new PendingSaves<string>(write)
    await Promise.allSettled([saves.save('book-a', 'A'), saves.save('book-b', 'B')])
    failing = false
    let settled = false
    const retry = saves.retry().finally(() => { settled = true })
    const rejected = expect(retry).rejects.toThrow('book-a still unavailable')
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(write).toHaveBeenCalledTimes(4)
    second.resolve()
    await rejected
    expect(saves.failedKeys).toEqual(['book-a'])
    expect(saves.pendingCount).toBe(1)
  })

  it('waits before discarding a deleted session and never resurrects it on retry', async () => {
    const writing = deferred()
    const failure = new Error('failed write')
    const write = vi.fn().mockReturnValue(writing.promise)
    const saves = new PendingSaves<string>(write)
    const pending = saves.save('book-a', 'will be cleared')
    const rejected = expect(pending).rejects.toBe(failure)
    const barrier = saves.wait('book-a').catch(() => undefined)
    expect(() => saves.forget('book-a')).toThrow('while it is running')
    writing.reject(failure)
    await barrier
    await rejected
    saves.forget('book-a')
    await saves.retry()
    expect(write).toHaveBeenCalledTimes(1)
    expect(saves.failedKeys).toEqual([])
    expect(saves.pending).toBe(false)
  })

  it('snapshots payloads and handles synchronous storage errors as rejected saves', async () => {
    const payload = { draft: 'original', tabs: ['one'] }
    const write = vi.fn(() => { throw new Error('sync disk failure') })
    const saves = new PendingSaves<typeof payload>(write)
    const pending = saves.save('tabs', payload)
    payload.draft = 'mutated'
    payload.tabs.push('two')
    await expect(pending).rejects.toThrow('sync disk failure')
    expect(write).toHaveBeenCalledWith('tabs', { draft: 'original', tabs: ['one'] })
    expect(saves.failed).toBe(true)
  })

  it('rewrites a reverted value after an uncertain failed write instead of trusting its old acknowledgement', async () => {
    const second = deferred()
    const write = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(second.promise).mockResolvedValue(undefined)
    const saves = new PendingSaves<string>(write)
    await saves.save('book-a', 'original')
    const changed = saves.save('book-a', 'changed')
    await Promise.resolve()
    const reverted = saves.save('book-a', 'original')
    second.reject(new Error('write outcome uncertain'))
    await Promise.all([changed, reverted])
    expect(write.mock.calls).toEqual([['book-a', 'original'], ['book-a', 'changed'], ['book-a', 'original']])
    expect(saves.pending).toBe(false)
  })
})
