import { Globe, GlobeX } from 'lucide-react'
import type { WebSearchMode } from '@shared/contracts'
import { copy } from '@shared/copy'
import { ComposerToolButton } from './ComposerToolButton'

export function WebSearchControl({ mode, enabled, busy, imageQuestion = false, changing = false, onChange }: {
  mode: WebSearchMode
  enabled: boolean
  busy: boolean
  imageQuestion?: boolean
  changing?: boolean
  onChange: (mode: WebSearchMode) => void
}) {
  const hint = imageQuestion ? copy('webSearch.imageUnavailable') : busy ? copy('assistant.busyHint') : changing ? copy('assistant.sessionLoading') : !enabled ? copy('webSearch.unavailable') : copy('webSearch.modeHint')
  return <ComposerToolButton data-testid="web-search-mode" label={copy(mode === 'auto' ? 'webSearch.modeAuto' : 'webSearch.modeOff')} hint={hint}
    aria-pressed={mode === 'auto'} data-available={enabled && !imageQuestion}
    disabled={busy || imageQuestion || changing || (!enabled && mode === 'off')}
    onClick={() => onChange(mode === 'auto' ? 'off' : 'auto')}>
    {mode === 'auto' ? <Globe size={16} aria-hidden="true" /> : <GlobeX size={16} aria-hidden="true" />}
  </ComposerToolButton>
}
