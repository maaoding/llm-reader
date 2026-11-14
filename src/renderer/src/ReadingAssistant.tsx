import { useState, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles } from 'lucide-react'
import { copy } from '@shared/copy'
import { ConversationPane } from './ConversationPane'

interface ReadingAssistantProps {
  container: HTMLDivElement | null
  fullscreen: boolean
  inactive: boolean
  actions?: ReactNode
  conversation?: ComponentProps<typeof ConversationPane>
  conversationKey?: string
}

export function ReadingAssistant({ container, fullscreen, inactive, actions, conversation, conversationKey }: ReadingAssistantProps) {
  const [markdownTarget, setMarkdownTarget] = useState<HTMLDivElement | null>(null)
  if (fullscreen && !container) return null
  const documentTarget = fullscreen ? container?.ownerDocument : undefined
  const panel = (
    <aside className="right-sidebar" data-testid="ai-panel" inert={inactive}>
      <header className="assistant-header">
        <div className="assistant-title"><span><Sparkles size={16} /></span><strong>{copy('assistant.title')}</strong></div>
        <div className="assistant-header-actions">
          <div className="conversation-markdown-slot" ref={setMarkdownTarget} inert={inactive} />
          {actions}
        </div>
      </header>
      {conversation && <ConversationPane key={conversationKey} {...conversation}
        markdownToolsTarget={markdownTarget?.isConnected && markdownTarget.ownerDocument === (documentTarget ?? document) ? markdownTarget : null}
        documentTarget={documentTarget} />}
    </aside>
  )
  return fullscreen && container ? createPortal(panel, container) : panel
}
