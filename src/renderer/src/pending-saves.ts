interface PendingSave<T> {
  payload: T
  fingerprint: string
  acknowledged: string | null
  revision: number
  failed: boolean
  running?: Promise<void>
}

/** Keeps JSON-compatible snapshots until storage acknowledges them. Writes for
 * one key are serialized; edits made during a write replace its queued successor. */
export class PendingSaves<T> {
  private readonly entries = new Map<string, PendingSave<T>>()

  constructor(
    private readonly write: (key: string, payload: T) => Promise<unknown>,
    private readonly onChange: () => void = () => undefined
  ) {}

  get pendingCount(): number {
    return [...this.entries.values()].filter((entry) => entry.running || entry.acknowledged !== entry.fingerprint).length
  }

  get pending(): boolean { return this.pendingCount > 0 }
  get failedKeys(): string[] { return [...this.entries].filter(([, entry]) => entry.failed).map(([key]) => key) }
  get failed(): boolean { return this.failedKeys.length > 0 }

  save(key: string, payload: T): Promise<void> {
    const fingerprint = JSON.stringify(payload)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { payload: structuredClone(payload), fingerprint, acknowledged: null, revision: 0, failed: false }
      this.entries.set(key, entry)
    } else if (entry.fingerprint !== fingerprint) {
      entry.payload = structuredClone(payload)
      entry.fingerprint = fingerprint
      entry.revision += 1
    }
    return this.flush(key, entry)
  }

  /** Retries every pending key, waiting for all keys even if one still fails. */
  async retry(): Promise<void> {
    const results = await Promise.allSettled([...this.entries].map(([key, entry]) => this.flush(key, entry)))
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }

  /** A barrier for deletion/clear operations; this never retries a failed save. */
  wait(key: string): Promise<void> { return this.entries.get(key)?.running ?? Promise.resolve() }

  /** Call only after wait(key), and prevent new edits until deletion completes. */
  forget(key: string): void {
    if (this.entries.get(key)?.running) throw new Error('Cannot discard a save while it is running')
    if (this.entries.delete(key)) this.onChange()
  }

  private flush(key: string, entry: PendingSave<T>): Promise<void> {
    if (entry.running) return entry.running
    if (entry.acknowledged === entry.fingerprint) return Promise.resolve()
    // Set running before invoking storage, including storage that throws synchronously.
    const pending = Promise.resolve().then(async () => {
      try {
        while (entry.acknowledged !== entry.fingerprint) {
          const { payload, fingerprint, revision } = entry
          try {
            await this.write(key, payload)
            entry.acknowledged = fingerprint
            if (revision === entry.revision) entry.failed = false
          } catch (error) {
            // A rejected write may have reached storage; do not trust the old acknowledgement.
            entry.acknowledged = null
            if (revision === entry.revision) {
              entry.failed = true
              throw error
            }
            // A newer edit is already queued. Try it once, without replaying the old snapshot.
          }
          this.onChange()
        }
      } finally {
        // Clear in the same microtask as the final acknowledgement. A separate
        // promise.finally would let a new edit join an already-finished drain.
        if (entry.running === pending) entry.running = undefined
        this.onChange()
      }
    })
    entry.running = pending
    this.onChange()
    return pending
  }
}
