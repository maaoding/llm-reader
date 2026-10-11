import type { LlmUsage } from '@shared/contracts'
import { copy } from '@shared/copy'

function formatGenerationDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  if (seconds < 60) return copy('common.durationSeconds', { count: Number((Math.max(0, durationMs) / 1000).toFixed(1)) })
  return copy('common.durationMinutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
}

export function AnswerMetadata({ usage, durationMs }: { usage?: LlmUsage; durationMs?: number }) {
  if (!usage?.totalTokens && durationMs === undefined) return null
  return <div className="answer-meta">
    {!!usage?.totalTokens && <span className="answer-usage">{copy('assistant.tokenUsage', { count: usage.totalTokens })}</span>}
    {durationMs !== undefined && <span className="answer-duration">{copy('assistant.generationDuration', { duration: formatGenerationDuration(durationMs) })}</span>}
  </div>
}
