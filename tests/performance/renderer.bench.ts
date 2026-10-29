import { test, expect } from 'vitest'
import type { LlmEvent } from '../../src/shared/contracts'
import { citationExcerpt } from '../../src/renderer/src/citations'
import { parseMarkdown } from '../../src/renderer/src/answer-markdown'
import { LlmEventBuffer } from '../../src/renderer/src/llm-event-buffer'

// Baseline from 4294da5. Keep this small reference local to the benchmark so
// production never carries a second implementation or a performance mode.
function previousExcerpt(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  const characters = Array.from(normalized)
  return characters.length > 24 ? `${characters.slice(0, 24).join('')}…` : normalized
}

const passage = '  证据😀\n\t'.repeat(4_000)
expect(citationExcerpt(passage)).toBe(previousExcerpt(passage))
const options = { time: 300, iterations: 3, warmupTime: 100, warmupIterations: 1 }

test('long citation excerpt (28,000 source code points)', async ({ bench }) => {
  await bench.compare(
    bench('before: normalize and allocate the whole passage', { writeResult: 'output/benchmarks/renderer/citation-before.json' }, () => { previousExcerpt(passage) }),
    bench('after: stop at the visible excerpt boundary', { writeResult: 'output/benchmarks/renderer/citation-after.json' }, () => { citationExcerpt(passage) }),
    options
  )
})

const fragments = Array.from({ length: 1_000 }, (_, index) => index % 5 ? '解释 **证据** [P1]。' : '\n\n')
function consumeBurst(buffered: boolean): { answer: string; updates: number } {
  let answer = '', updates = 0
  const render = (event: LlmEvent): void => {
    if (event.type !== 'delta') return
    answer += event.delta
    parseMarkdown(answer)
    updates += 1
  }
  const buffer = new LlmEventBuffer()
  for (const delta of fragments) {
    const event: LlmEvent = { type: 'delta', requestId: 'benchmark', delta }
    if (buffered) buffer.push(event, render)
    else render(event)
  }
  buffer.flush()
  buffer.dispose()
  return { answer, updates }
}

const before = consumeBurst(false), after = consumeBurst(true)
expect(after.answer).toBe(before.answer)
expect(before.updates).toBe(1_000)
expect(after.updates).toBe(2)

// Synchronous synthetic burst, including the real Markdown parser, not an
// end-to-end latency or FPS measurement. IPC, network and painting are excluded.
test('1,000-fragment burst with Markdown parsing', async ({ bench }) => {
  await bench.compare(
    bench('before: publish and parse every fragment', { writeResult: 'output/benchmarks/renderer/stream-before.json' }, () => { consumeBurst(false) }),
    bench('after: publish the first and coalesced remainder', { writeResult: 'output/benchmarks/renderer/stream-after.json' }, () => { consumeBurst(true) }),
    options
  )
})
