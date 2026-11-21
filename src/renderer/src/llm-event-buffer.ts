import type { LlmEvent } from '@shared/contracts'

type Emit = (event: LlmEvent) => void
interface PendingText { chunks: string[]; emit: Emit }

const FLUSH_INTERVAL_MS = 32

/** Publishes the first fragment of a burst immediately and coalesces subsequent fragments.
 * Control events and explicit flushes always observe all preceding text. */
export class LlmEventBuffer {
  private readonly pending = new Map<string, PendingText>()
  private timer: ReturnType<typeof setTimeout> | null = null

  push(event: LlmEvent, emit: Emit): void {
    if (event.type !== 'delta') {
      this.flush(event.requestId)
      emit(event)
      return
    }
    if (!event.delta) return
    const pending = this.pending.get(event.requestId)
    if (pending) pending.chunks.push(event.delta)
    else this.pending.set(event.requestId, { chunks: [], emit })
    if (this.timer === null) this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, FLUSH_INTERVAL_MS)
    if (!pending) emit(event)
  }

  flush(requestId?: string): void {
    const ids = requestId === undefined ? [...this.pending.keys()] : [requestId]
    for (const id of ids) {
      const pending = this.pending.get(id)
      if (!pending) continue
      this.pending.delete(id)
      if (pending.chunks.length) pending.emit({ type: 'delta', requestId: id, delta: pending.chunks.join('') })
    }
    if (!this.pending.size && this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
  }
}

/** Call from an effect; drain buffered text during cleanup so resubscribing
 * preserves it. Owners also flush before cancellation and persistence. */
export function subscribeToBufferedLlmEvents(buffer: LlmEventBuffer, accepts: (requestId: string) => boolean, emit: Emit): () => void {
  const unsubscribe = window.readerApi.onLlmEvent((event) => {
    if (accepts(event.requestId)) buffer.push(event, emit)
  })
  return () => {
    unsubscribe()
    buffer.flush()
    buffer.dispose()
  }
}
