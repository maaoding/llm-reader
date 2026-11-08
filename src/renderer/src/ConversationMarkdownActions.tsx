import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Download, LoaderCircle, X } from 'lucide-react'
import { CONVERSATION_COPY_MAX_LENGTH } from '@shared/contracts'
import { copy } from '@shared/copy'
import { useDialogFocus } from './use-dialog-focus'
import type { ConversationMarkdownController } from './use-conversation-markdown'

export function ConversationMarkdownTools({ controller, target }: { controller: ConversationMarkdownController; target?: HTMLElement | null }) {
  const tools = <div className="conversation-markdown-tools" data-testid="conversation-markdown-tools">
      <button type="button" className="icon-button" data-testid="conversation-copy"
        disabled={!controller.canCopyConversation} aria-label={copy('conversationMarkdown.copySession')}
        title={controller.canCopyConversation ? copy('conversationMarkdown.copySession') : controller.disabledHint}
        onClick={(event) => controller.copyConversation(event.currentTarget)}>
        <Copy size={16} />
      </button>
      <button type="button" className="icon-button" data-testid="conversation-export"
        disabled={!controller.canCopyConversation} aria-label={copy('conversationMarkdown.save')}
        title={controller.canCopyConversation ? copy('conversationMarkdown.save') : controller.disabledHint}
        onClick={(event) => controller.exportConversation(event.currentTarget)}><Download size={16} /></button>
    </div>
  return <>
    {target === undefined ? tools : target && createPortal(tools, target)}
    {(controller.feedback || controller.busy) && <p className="field-hint conversation-markdown-feedback" role="status" data-testid="conversation-markdown-status">
      {controller.busy ? copy('conversationMarkdown.working') : controller.feedback}
    </p>}
  </>
}

export function ConversationMarkdownFallback({ controller }: { controller: ConversationMarkdownController }) {
  const dialogRef = useRef<HTMLElement>(null)
  useDialogFocus(Boolean(controller.failure), controller.closeFailure, dialogRef, controller.returnRef)
  if (!controller.failure) return null
  const snapshot = controller.failure.snapshot
  return createPortal(<div className="modal-backdrop conversation-markdown-backdrop" role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) controller.closeFailure() }}>
    <section className="conversation-markdown-dialog" ref={dialogRef} role="dialog" aria-modal="true"
      aria-labelledby="conversation-markdown-title" aria-describedby="conversation-markdown-detail" data-testid="conversation-markdown-fallback">
      <header className="modal-header"><h2 id="conversation-markdown-title">{copy('conversationMarkdown.fallbackTitle')}</h2>
        <button type="button" className="icon-button" disabled={controller.busy} data-testid="conversation-markdown-close"
          aria-label={copy('conversationMarkdown.close')} onClick={controller.closeFailure}><X size={18} /></button></header>
      <p id="conversation-markdown-detail">{controller.failure.message}</p>
      {controller.busy && <p className="field-hint" role="status"><LoaderCircle className="spin" size={14} />{copy('conversationMarkdown.working')}</p>}
      <footer className="modal-actions">
        <button type="button" className="secondary-button" disabled={controller.busy} onClick={controller.closeFailure}>{copy('conversationMarkdown.close')}</button>
        {snapshot && snapshot.markdown.length <= CONVERSATION_COPY_MAX_LENGTH && <button type="button" className="secondary-button"
          data-testid="conversation-markdown-retry-copy" disabled={controller.busy} onClick={controller.retryCopy}>{copy('conversationMarkdown.copyRetry')}</button>}
        {snapshot && <button type="button" className="primary-button" data-testid="conversation-markdown-save"
          disabled={controller.busy} onClick={controller.savePrepared}>{copy('conversationMarkdown.save')}</button>}
      </footer>
    </section>
  </div>, document.body)
}
