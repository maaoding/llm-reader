import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { copy, type UiLanguage } from '@shared/copy'

interface AssistantWindow {
  token: string
  popup: Window
  container: HTMLDivElement
  cancelStyles: () => void
}

interface ReadingFullscreenOptions {
  reading: boolean
  blocked: boolean
  theme: 'light' | 'dark'
  scale: number
  language: UiLanguage
  focusComposer: () => void
  onError: (message: string, tone: 'error') => void
}

type AssistantFocus = 'window' | 'composer'

function loadAssistantStyles(popup: Window, signal: AbortSignal): Promise<void> {
  // The blank child inherits the app origin and CSP. Copy only app styles so the
  // conversation tree can render there using the same theme tokens.
  const styles = Array.from(document.head.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style'))
  return Promise.all(styles.map((style) => {
    const node = style.cloneNode(true)
    if (node instanceof HTMLLinkElement && style instanceof HTMLLinkElement) {
      node.href = style.href
      return new Promise<void>((resolve, reject) => {
        node.addEventListener('load', () => resolve(), { once: true, signal })
        node.addEventListener('error', () => reject(new Error('Assistant styles failed to load')), { once: true, signal })
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        popup.document.head.append(node)
      })
    }
    popup.document.head.append(node)
  })).then(() => undefined)
}

export function useReadingFullscreen({ reading, blocked, theme, scale, language, focusComposer, onError }: ReadingFullscreenOptions) {
  const [fullscreen, setFullscreen] = useState(false)
  const [assistantWindow, setAssistantWindow] = useState<AssistantWindow | null>(null)
  const fullscreenRef = useRef(false)
  const requestedFullscreenRef = useRef<boolean | null>(null)
  const requestRef = useRef(0)
  const fullscreenTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const readingRef = useRef(reading)
  const blockedRef = useRef(blocked)
  const revisionRef = useRef(0)
  const openingRef = useRef<number | null>(null)
  const popupRef = useRef<AssistantWindow | null>(null)
  const focusAssistantRef = useRef<AssistantFocus | undefined>(undefined)
  const autoOpenRef = useRef(false)

  const presentAssistant = useCallback((assistant: AssistantWindow): void => {
    const focus = focusAssistantRef.current
    focusAssistantRef.current = undefined
    const mode = blockedRef.current ? 'hidden' : focus ? 'focused' : 'inactive'
    void window.readerApi.presentAssistantWindow({ token: assistant.token, mode }).then(() => {
      if (mode === 'focused' && focus === 'composer' && popupRef.current?.token === assistant.token && !blockedRef.current) {
        focusComposer()
      }
    }).catch(() => {
      if (popupRef.current?.token !== assistant.token || assistant.popup.closed) return
      assistant.popup.close()
      onError(copy('assistant.windowFailed'), 'error')
    })
  }, [focusComposer, onError])

  const requestFullscreen = useCallback((next: boolean): void => {
    if (next === (requestedFullscreenRef.current ?? fullscreenRef.current)) return
    requestedFullscreenRef.current = next
    const request = ++requestRef.current
    const fail = (): void => {
      if (requestRef.current !== request || requestedFullscreenRef.current !== next) return
      clearTimeout(fullscreenTimerRef.current)
      requestedFullscreenRef.current = null
      onError(copy('reader.fullscreenFailed'), 'error')
    }
    clearTimeout(fullscreenTimerRef.current)
    fullscreenTimerRef.current = setTimeout(fail, 5_000)
    void window.readerApi.setWindowFullscreen(next).catch(fail)
  }, [onError])

  const toggleFullscreen = useCallback((): void => {
    if (readingRef.current && !blockedRef.current && requestedFullscreenRef.current === null) requestFullscreen(!fullscreenRef.current)
  }, [requestFullscreen])

  const openAssistant = useCallback(async (focus?: AssistantFocus): Promise<void> => {
    if (!fullscreenRef.current || !readingRef.current || blockedRef.current) return
    if (focus) focusAssistantRef.current = focus
    if (openingRef.current !== null) return
    const existing = popupRef.current
    if (existing && !existing.popup.closed) {
      if (focus) presentAssistant(existing)
      return
    }
    const revision = revisionRef.current
    openingRef.current = revision
    let popup: Window | null = null
    let timeout: ReturnType<typeof setTimeout> | undefined
    const styles = new AbortController()
    const stillCurrent = (): boolean => revision === revisionRef.current && fullscreenRef.current && readingRef.current
    try {
      const token = await window.readerApi.reserveAssistantWindow()
      if (!stillCurrent()) return
      if (!token) throw new Error('Assistant window unavailable')
      popup = window.open('about:blank', token)
      if (!popup) throw new Error('Assistant window could not be opened')
      const container = popup.document.createElement('div')
      container.className = 'assistant-window-root'
      popup.document.body.append(container)
      const created = { token, popup, container, cancelStyles: () => styles.abort() }
      popupRef.current = created
      timeout = setTimeout(() => styles.abort(), 5_000)
      await loadAssistantStyles(popup, styles.signal)
      if (stillCurrent() && !popup.closed) setAssistantWindow(created)
    } catch {
      if (popup && !popup.closed) popup.close()
      if (stillCurrent()) onError(copy('assistant.windowFailed'), 'error')
    } finally {
      clearTimeout(timeout)
      styles.abort()
      if (openingRef.current === revision) openingRef.current = null
    }
  }, [onError, presentAssistant])

  useLayoutEffect(() => {
    readingRef.current = reading
    blockedRef.current = blocked
    if (!reading && (fullscreenRef.current || requestedFullscreenRef.current)) requestFullscreen(false)
    if (reading && !blocked && autoOpenRef.current && fullscreenRef.current) {
      autoOpenRef.current = false
      void openAssistant()
    }
  }, [reading, blocked, openAssistant, requestFullscreen])

  useEffect(() => {
    let active = true
    let receivedChange = false
    const update = (next: boolean): void => {
      if (requestedFullscreenRef.current === next) {
        clearTimeout(fullscreenTimerRef.current)
        requestedFullscreenRef.current = null
      }
      const changed = fullscreenRef.current !== next
      fullscreenRef.current = next
      setFullscreen(next)
      if (next) {
        if (readingRef.current && requestedFullscreenRef.current !== false) {
          if (changed && blockedRef.current) autoOpenRef.current = true
          else if (changed) void openAssistant()
        }
        else requestFullscreen(false)
      } else {
        revisionRef.current += 1
        openingRef.current = null
        focusAssistantRef.current = undefined
        autoOpenRef.current = false
        popupRef.current?.cancelStyles()
        popupRef.current = null
        setAssistantWindow(null)
      }
    }
    const unsubscribeFullscreen = window.readerApi.onWindowFullscreenChange((next) => {
      receivedChange = true
      update(next)
    })
    const unsubscribeShortcut = window.readerApi.onWindowFullscreenShortcut(toggleFullscreen)
    const unsubscribeClose = window.readerApi.onAssistantWindowClosed((token) => {
      if (popupRef.current?.token !== token) return
      focusAssistantRef.current = undefined
      if (openingRef.current !== null) onError(copy('assistant.windowFailed'), 'error')
      popupRef.current.cancelStyles()
      revisionRef.current += 1
      openingRef.current = null
      popupRef.current = null
      setAssistantWindow(null)
    })
    void window.readerApi.isWindowFullscreen().then((next) => {
      if (active && !receivedChange) update(next)
    }).catch(() => undefined)
    return () => {
      active = false
      unsubscribeFullscreen()
      unsubscribeShortcut()
      unsubscribeClose()
      clearTimeout(fullscreenTimerRef.current)
      revisionRef.current += 1
      openingRef.current = null
      popupRef.current?.cancelStyles()
      popupRef.current?.popup.close()
      popupRef.current = null
    }
  }, [onError, openAssistant, requestFullscreen, toggleFullscreen])

  useLayoutEffect(() => {
    const current = popupRef.current
    if (!assistantWindow || current?.token !== assistantWindow.token || current.popup.closed) return
    const { document: childDocument } = current.popup
    childDocument.title = copy('assistant.title')
    childDocument.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
    childDocument.documentElement.dataset.assistantWindow = ''
    childDocument.documentElement.dataset.theme = theme
    childDocument.documentElement.dataset.interfaceScale = String(scale)
    childDocument.documentElement.style.colorScheme = theme
  }, [assistantWindow, theme, scale, language])

  useLayoutEffect(() => {
    if (!assistantWindow || assistantWindow.popup.closed) return
    presentAssistant(assistantWindow)
  }, [assistantWindow, blocked, presentAssistant])

  return { fullscreen, toggleFullscreen, openAssistant, assistantContainer: assistantWindow?.container ?? null }
}
