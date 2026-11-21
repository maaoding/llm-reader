import { BookMarked, BookOpen, Highlighter, Lightbulb, MessageSquareText, PenLine, Quote, Search, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AssistantActionIcon } from './assistant-actions'

const ASSISTANT_ACTION_ICON_VIEWS: Readonly<Record<AssistantActionIcon, LucideIcon>> = {
  'highlighter': Highlighter,
  'book-open': BookOpen,
  'message-square-text': MessageSquareText,
  'search': Search,
  'lightbulb': Lightbulb,
  'pen-line': PenLine,
  'quote': Quote,
  'book-marked': BookMarked
}

export function AssistantActionIconView({ icon, size = 15 }: { icon: AssistantActionIcon; size?: number }): ReactNode {
  const Icon = ASSISTANT_ACTION_ICON_VIEWS[icon]
  return <Icon size={size} />
}
