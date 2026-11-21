import { isPdfImageRegion, type ArchivedChatMessage, type BookRecord, type BookSessionTurn, type ContextSnapshot, type InsightArchiveRecord, type LlmAction, type LlmUsage, type PersonaSelection, type ReaderSource, type SavedInsight, type SaveBookSessionInput } from '@shared/contracts'
import { copy } from '@shared/copy'

type TurnStatus = 'queued' | 'streaming' | 'completed' | 'error'
// Storage limits match the main-process validation contract.
const MAX_SESSION_TURNS = 20
const MAX_SESSION_ANSWER_LENGTH = 20_000

export interface ConversationTurn {
  id: string
  requestId: string
  selection: ReaderSource | null
  context?: ContextSnapshot
  action: LlmAction
  actionLabel: string
  question: string
  answer: string
  model: string
  status: TurnStatus
  usage?: LlmUsage
  /** 真正开始生成的时刻，仅用于测耗时，不落库。 */
  startedAt?: number
  durationMs?: number
  error?: string
  saved?: boolean
  persona?: PersonaSelection | null
  webSearchPhase?: 'deciding' | 'searching'
}

type ConversationTabKind = 'live' | 'archive'

export interface ConversationTab {
  id: string
  conversationId: string
  kind: ConversationTabKind
  bookId: string
  title: string
  selection: ReaderSource | null
  scope: 'selection' | 'book'
  turns: ConversationTurn[]
  draft: string
  persona: PersonaSelection | null
  webSearch: import('@shared/contracts').WebSearchMode
  insightId?: string
}

function turnsFromInsight(insight: SavedInsight): ConversationTurn[] {
  const history = insight.history.length >= 2
    ? insight.history
    : [
        { role: 'user' as const, content: insight.question },
        { role: 'assistant' as const, content: insight.answer, model: insight.model }
      ]
  const turns: ConversationTurn[] = []
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index]
    if (message.role !== 'user') continue
    const answer = history[index + 1]?.role === 'assistant' ? history[index + 1] : null
    if (!answer) continue
    turns.push({
      id: `insight-${insight.id}-${turns.length}`,
      requestId: `insight-${insight.id}-${turns.length}`,
      selection: answer.context ? answer.context.selection : insight.selection,
      context: answer.context ?? insight.context,
      action: 'ask',
      actionLabel: turns.length === 0 ? copy('assistant.insightLabel') : copy('assistant.insightFollowupLabel'),
      question: message.content,
      answer: answer.content,
      model: answer.model || insight.model,
      persona: answer.persona ?? null,
      status: 'completed',
      saved: true
    })
    index += 1
  }
  return turns
}

function compactTabTitle(value: string, fallback: string): string {
  const compact = Array.from(value.replace(/\s+/gu, ' ').trim()).slice(0, 18).join('')
  return compact || fallback
}

export function createLiveTab(book: BookRecord, persona: PersonaSelection | null, webSearch: import('@shared/contracts').WebSearchMode = 'off'): ConversationTab {
  return {
    id: `live-${book.id}`,
    conversationId: crypto.randomUUID(),
    kind: 'live',
    bookId: book.id,
    title: book.title,
    selection: null,
    scope: 'book',
    turns: [],
    draft: '',
    persona,
    webSearch
  }
}

export function createArchiveTab(insight: InsightArchiveRecord): ConversationTab {
  const turns = turnsFromInsight(insight)
  const latest = turns.at(-1)
  return {
    id: `archive-${insight.id}`,
    conversationId: insight.conversationId,
    kind: 'archive',
    bookId: insight.bookId,
    title: compactTabTitle(insight.question || (insight.selection && !isPdfImageRegion(insight.selection) ? insight.selection.quote : '') || '', copy('assistant.insightLabel')),
    selection: latest ? latest.selection : insight.selection,
    scope: (latest?.context?.scope ?? insight.context?.scope) === 'book' ? 'book' : 'selection',
    turns,
    draft: '',
    persona: insight.persona ?? null,
    webSearch: insight.webSearch ?? 'off',
    insightId: insight.id
  }
}

export function historyFromTurns(turns: ConversationTurn[]): ArchivedChatMessage[] {
  return turns
    .filter((turn) => turn.status === 'completed' && turn.answer)
    .flatMap((turn) => [
      { role: 'user' as const, content: turn.question },
      { role: 'assistant' as const, content: turn.answer, model: turn.model || undefined, context: turn.context, ...(turn.persona ? { persona: turn.persona } : {}) }
    ])
}

// 只落库已结束的轮次，并裁到主进程允许的上限，避免保存被校验拒绝。
function persistableTurns(turns: ConversationTurn[]): BookSessionTurn[] {
  return turns
    .filter((turn) => turn.status === 'completed' || turn.status === 'error')
    .slice(-MAX_SESSION_TURNS)
    .map((turn) => ({
      id: turn.id,
      action: turn.action,
      actionLabel: turn.actionLabel,
      question: turn.question.slice(0, 2_000),
      answer: turn.answer.slice(0, MAX_SESSION_ANSWER_LENGTH),
      model: turn.model,
      status: turn.status as 'completed' | 'error',
      ...(turn.saved ? { saved: true } : {}),
      ...(turn.error ? { error: turn.error.slice(0, 2_000) } : {}),
      ...(turn.usage ? { usage: turn.usage } : {}),
      ...(turn.durationMs === undefined ? {} : { durationMs: Math.round(turn.durationMs) }),
      selection: turn.selection,
      context: turn.context ?? null,
      ...(turn.persona ? { persona: turn.persona } : {})
    }))
}

// 会话落库载荷：scope 与 selection 必须自洽（整本书不带选区、选中内容必须有选区），
// 否则主进程校验会整条拒收，草稿就再也存不进去。
export function sessionPayload(tab: ConversationTab): SaveBookSessionInput {
  const selection = tab.scope === 'selection' ? tab.selection : null
  return {
    bookId: tab.bookId,
    conversationId: tab.conversationId,
    scope: selection ? 'selection' : 'book',
    selection,
    draft: tab.draft,
    turns: persistableTurns(tab.turns),
    webSearch: tab.webSearch,
    ...(tab.persona ? { persona: tab.persona } : {})
  }
}

