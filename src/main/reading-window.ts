import { randomUUID } from 'node:crypto'
import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { IPC_CHANNELS, type AssistantWindowPresentation } from '@shared/contracts'
import { copy } from '@shared/copy'

export function attachReadingWindow(window: BrowserWindow) {
  const contents = window.webContents
  let ticket: { token: string; expires: number } | undefined
  let opening: typeof ticket
  let assistant: { window: BrowserWindow; token: string; mode: AssistantWindowPresentation['mode'] } | undefined
  let lastBounds: Rectangle | undefined
  let savingBeforeClose = false
  let restoreAssistantFocus = false

  const send = (channel: string, value?: unknown): void => {
    if (!contents.isDestroyed()) contents.send(channel, value)
  }

  const fitToDisplay = (bounds: Rectangle): Rectangle => {
    const { workArea } = screen.getDisplayMatching(bounds)
    const width = Math.min(bounds.width, workArea.width)
    const height = Math.min(bounds.height, workArea.height)
    return {
      x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
      y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)),
      width,
      height
    }
  }
  const keepOnDisplay = (): void => {
    const popup = assistant?.window
    if (popup && !popup.isDestroyed()) popup.setBounds(fitToDisplay(popup.getBounds()))
  }
  const dispose = (): void => {
    ticket = undefined
    opening = undefined
    if (!assistant) return
    const popup = assistant.window
    if (!popup.isDestroyed()) {
      lastBounds = popup.getBounds()
      popup.destroy()
    }
  }
  const applyPresentation = (): void => {
    if (!assistant) return
    const popup = assistant.window
    if (savingBeforeClose || window.isMinimized() || assistant.mode === 'hidden') {
      const hadFocus = popup.isFocused()
      popup.hide()
      if (hadFocus && !window.isMinimized()) window.focus()
    } else if (assistant.mode === 'focused') {
      popup.show()
      popup.focus()
      assistant.mode = 'inactive'
    } else if (!popup.isVisible()) popup.showInactive()
  }

  const handleShortcut = (event: Electron.Event, input: Electron.Input): void => {
    if (input.key !== 'F11' || input.control || input.alt || input.shift || input.meta || input.isComposing) return
    event.preventDefault()
    if (input.type === 'keyDown' && !input.isAutoRepeat) send(IPC_CHANNELS.windowFullscreenShortcut)
  }
  contents.on('before-input-event', handleShortcut)
  window.on('enter-full-screen', () => send(IPC_CHANNELS.windowFullscreenChange, true))
  window.on('leave-full-screen', () => {
    send(IPC_CHANNELS.windowFullscreenChange, false)
    dispose()
  })
  window.on('minimize', applyPresentation)
  window.on('restore', applyPresentation)
  window.on('closed', dispose)
  contents.on('render-process-gone', dispose)
  contents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
    if (isMainFrame && !isSameDocument) dispose()
  })

  contents.setWindowOpenHandler(({ url, frameName, features, postBody }) => {
    if (!ticket || ticket.token !== frameName || ticket.expires < Date.now() || url !== 'about:blank' ||
        features || postBody || !window.isFullScreen() || savingBeforeClose || assistant) return { action: 'deny' }
    opening = ticket
    ticket = undefined
    const { workArea } = screen.getDisplayMatching(window.getBounds())
    const bounds = fitToDisplay(lastBounds ?? {
      x: workArea.x + Math.max(0, workArea.width - 460), y: workArea.y + 80, width: 440, height: 640
    })
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...bounds, parent: window, modal: false, frame: true, show: false, skipTaskbar: true,
        minWidth: Math.min(360, bounds.width), minHeight: Math.min(420, bounds.height),
        alwaysOnTop: false, fullscreenable: false, maximizable: false, minimizable: false, title: copy('assistant.title')
      }
    }
  })
  contents.on('did-create-window', (popup, { frameName }) => {
    if (opening?.token !== frameName || !window.isFullScreen() || assistant || savingBeforeClose) {
      popup.destroy()
      return
    }
    const token = opening.token
    opening = undefined
    assistant = { window: popup, token, mode: 'hidden' }
    const deny = (event: Electron.Event): void => event.preventDefault()
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    popup.webContents.on('will-frame-navigate', deny)
    popup.webContents.on('will-redirect', deny)
    popup.webContents.on('will-attach-webview', deny)
    popup.webContents.on('before-input-event', handleShortcut)
    popup.webContents.on('render-process-gone', () => { if (!popup.isDestroyed()) popup.destroy() })
    screen.on('display-removed', keepOnDisplay)
    screen.on('display-metrics-changed', keepOnDisplay)
    popup.on('close', () => { lastBounds = popup.getBounds() })
    popup.once('closed', () => {
      screen.removeListener('display-removed', keepOnDisplay)
      screen.removeListener('display-metrics-changed', keepOnDisplay)
      assistant = undefined
      send(IPC_CHANNELS.assistantWindowClosed, token)
    })
  })

  return {
    reserveAssistantWindow(): string | null {
      if (!window.isFullScreen() || savingBeforeClose || assistant || (opening && opening.expires > Date.now())) return null
      ticket = { token: randomUUID(), expires: Date.now() + 5_000 }
      return ticket.token
    },
    presentAssistantWindow({ token, mode }: AssistantWindowPresentation): void {
      if (assistant?.token !== token || !window.isFullScreen()) return
      assistant.mode = mode
      applyPresentation()
    },
    focusedAssistantWindow(): BrowserWindow | undefined {
      return assistant?.window.isFocused() ? assistant.window : undefined
    },
    setSavingBeforeClose(saving: boolean): void {
      if (saving) restoreAssistantFocus = assistant?.window.isFocused() ?? false
      else if (assistant && restoreAssistantFocus && assistant.mode !== 'hidden') assistant.mode = 'focused'
      savingBeforeClose = saving
      applyPresentation()
    }
  }
}

export type ReadingWindow = ReturnType<typeof attachReadingWindow>
