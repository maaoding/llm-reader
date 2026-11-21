import type { LlmAction } from '@shared/contracts'
import { copy } from '@shared/copy'
import { MarkedText } from './MarkedText'
import { normalizeNeedle, splitMatches } from './highlight'

export function QuestionBubble({ action, label, question, needle = '' }: {
  action: LlmAction; label: string; question: string; needle?: string
}) {
  // Older archives have no action metadata. Recognize only exact built-in prompts.
  const preset = action !== 'ask' || question === copy('assistant.questionExplain') || question === copy('assistant.questionContext')
  const matches = Boolean(needle && splitMatches(question, normalizeNeedle(needle)).some((part) => part.hit))
  const content = <p><MarkedText value={question} needle={needle} /></p>
  return <div className="question-bubble">
    <span>{label}</span>
    {preset ? <details className="question-prompt" data-testid="question-prompt" key={matches ? 'match' : 'normal'} open={matches || undefined}>
      <summary>{copy('assistant.promptDetails')}</summary>{content}
    </details> : content}
  </div>
}
