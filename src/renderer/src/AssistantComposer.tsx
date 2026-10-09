import { CircleStop, Send } from 'lucide-react'
import { useId, type FormEvent, type ReactNode, type RefObject } from 'react'
import { copy } from '@shared/copy'
import { ComposerToolButton } from './ComposerToolButton'

interface AssistantComposerProps {
  draft: string
  onDraftChange: (value: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  placeholder: string
  canAsk: boolean
  busy: boolean
  onSubmit: (event: FormEvent) => void
  onCancel: () => void
  controls?: ReactNode
  heading?: ReactNode
  blockedReason?: string
  resolveLabel?: string
  onResolve?: (trigger: HTMLButtonElement) => void
  inputTestId?: string
  sendTestId?: string
  stopTestId?: string
}

export function AssistantComposer({ draft, onDraftChange, inputRef, placeholder, canAsk, busy, onSubmit, onCancel,
  controls, heading, blockedReason, resolveLabel, onResolve,
  inputTestId = 'followup-input', sendTestId = 'send-question', stopTestId = 'cancel-request'
}: AssistantComposerProps): ReactNode {
  const formId = useId()
  return <div className="assistant-composer">
    {heading && <div className="composer-heading">{heading}</div>}
    {blockedReason && <div className="composer-hint" role="status"><span>{blockedReason}</span>
      {onResolve && resolveLabel && <button type="button" className="text-button" onClick={(event) => onResolve(event.currentTarget)}>{resolveLabel}</button>}
    </div>}
    <div className="assistant-question-box">
      <form id={formId} className="assistant-question-form" onSubmit={onSubmit}>
        <textarea className="assistant-question-input" data-testid={inputTestId} ref={inputRef} value={draft}
          onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }} placeholder={placeholder} aria-label={copy('assistant.questionAria')} rows={2} maxLength={2_000} />
      </form>
      <div className="composer-toolbar">
        <div className="composer-tools">{controls}</div>
        {busy
          ? <ComposerToolButton className="composer-submit cancel-generation" data-testid={stopTestId} label={copy('assistant.stop')} onClick={onCancel}><CircleStop size={16} aria-hidden="true" /></ComposerToolButton>
          : <ComposerToolButton className="composer-submit" type="submit" form={formId} data-testid={sendTestId} label={copy('assistant.sendAria')} disabled={!canAsk || !draft.trim()}><Send size={16} aria-hidden="true" /></ComposerToolButton>}
      </div>
    </div>
  </div>
}
