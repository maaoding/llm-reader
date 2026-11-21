import { useEffect, useState, type ReactNode } from 'react'
import { Minus, Minimize2, Square, X } from 'lucide-react'
import { copy } from '@shared/copy'

export function WindowControls(): ReactNode {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!window.readerApi) return undefined
    let alive = true

    void window.readerApi.isWindowMaximized().then((value) => {
      if (alive) setMaximized(value)
    })
    const unsubscribe = window.readerApi.onWindowMaximizedChange(setMaximized)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return (
    <div className="window-controls" role="group" aria-label={copy('window.controlsAria')}>
      <button
        data-testid="window-minimize"
        type="button"
        aria-label={copy('window.minimizeAria')}
        title={copy('window.minimizeAria')}
        onClick={() => void window.readerApi.minimizeWindow()}
      >
        <Minus size={14} />
      </button>
      <button
        data-testid="window-toggle-maximize"
        type="button"
        aria-label={copy(maximized ? 'window.restoreAria' : 'window.maximizeAria')}
        title={copy(maximized ? 'window.restoreAria' : 'window.maximizeAria')}
        onClick={() => void window.readerApi.toggleMaximizeWindow()}
      >
        {maximized ? <Minimize2 size={13} /> : <Square size={12} />}
      </button>
      <button
        className="is-close"
        data-testid="window-close"
        type="button"
        aria-label={copy('window.closeAria')}
        title={copy('window.closeAria')}
        onClick={() => void window.readerApi.closeWindow()}
      >
        <X size={15} />
      </button>
    </div>
  )
}
