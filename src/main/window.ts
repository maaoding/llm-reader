import { join } from 'node:path'
import { app, BrowserWindow, dialog, session } from 'electron'
import { IPC_CHANNELS, type AppCloseResponse } from '@shared/contracts'
import { copy } from '@shared/copy'

export interface CreatedWindow {
  window: BrowserWindow
  allowedOrigins: ReadonlySet<string>
  requestClose: (afterSave?: (cancel: () => void) => boolean) => void
  respondToClose: (response: AppCloseResponse) => void
}

function isAllowedNavigation(target: string, allowedOrigins: ReadonlySet<string>): boolean {
  try {
    const url = new URL(target)
    return (
      (url.protocol === 'llm-reader:' && url.hostname === 'app') || allowedOrigins.has(url.origin)
    )
  } catch {
    return false
  }
}

export function createMainWindow(): CreatedWindow {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const allowedOrigins = new Set<string>(['llm-reader://app'])
  if (developmentUrl) allowedOrigins.add(new URL(developmentUrl).origin)

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    show: false,
    icon: app.isPackaged
      ? join(process.resourcesPath, iconFileName)
      : join(__dirname, '../../resources', iconFileName),
    backgroundColor: '#f5f3ee',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      spellcheck: false
    }
  })

  let closeApproved = false
  let closeSequence = 0
  let closeRequest: { id: number; afterSave?: (cancel: () => void) => boolean } | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  let closePrompt: number | undefined
  let closePromptController: AbortController | undefined
  let rendererUnavailable = false
  const clearCloseTimer = (): void => {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = undefined
  }
  const completeClose = (): void => {
    if (closeApproved || window.isDestroyed()) return
    const requestId = closeRequest?.id
    const afterSave = closeRequest?.afterSave
    closeApproved = true
    closeRequest = undefined
    clearCloseTimer()
    closePromptController?.abort()
    if (!afterSave) { window.close(); return }
    const cancel = (): void => {
      if (!closeApproved || closeSequence !== requestId || window.isDestroyed()) return
      closeApproved = false
      // electron-updater can emit an installation error after queuing app.quit()
      // for the next check phase. Cancel that queued quit as well as its UI guard.
      const preventQueuedQuit = (event: Electron.Event): void => {
        if (!window.isDestroyed()) event.preventDefault()
      }
      app.once('before-quit', preventQueuedQuit)
      setImmediate(() => app.removeListener('before-quit', preventQueuedQuit))
      if (!window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.appCloseCancelled)
    }
    try { if (afterSave(cancel)) return } catch { /* Installation errors keep the saved workspace open. */ }
    cancel()
  }
  const scheduleClosePrompt = (requestId: number): void => {
    clearCloseTimer()
    closeTimer = setTimeout(() => { void showClosePrompt(requestId) }, 15_000)
  }
  const showClosePrompt = async (requestId: number): Promise<void> => {
    if (closeApproved || window.isDestroyed() || closeRequest?.id !== requestId || closePrompt !== undefined) return
    clearCloseTimer()
    closePrompt = requestId
    const controller = new AbortController()
    closePromptController = controller
    try {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: copy('window.closeWaitTitle'),
        message: copy('window.closeWaitMessage'),
        detail: copy('window.closeWaitDetail'),
        buttons: [copy('window.closeWait'), copy('window.closeForce')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        signal: controller.signal
      })
      if (closeRequest?.id === requestId && result.response === 1) completeClose()
    } catch { /* A failed or dismissed prompt never authorizes discarding unsaved content. */ }
    finally {
      if (closePrompt === requestId) closePrompt = undefined
      if (closePromptController === controller) closePromptController = undefined
      if (closeRequest && !closeApproved && !window.isDestroyed()) scheduleClosePrompt(closeRequest.id)
    }
  }
  const requestClose = (afterSave?: (cancel: () => void) => boolean): void => {
    if (closeApproved || closeRequest || window.isDestroyed()) return
    const requestId = ++closeSequence
    closeRequest = { id: requestId, afterSave }
    if (rendererUnavailable || window.webContents.isDestroyed()) {
      void showClosePrompt(requestId)
      return
    }
    try {
      window.webContents.send(IPC_CHANNELS.appBeforeClose, requestId)
      scheduleClosePrompt(requestId)
    } catch { void showClosePrompt(requestId) }
  }
  const respondToClose = ({ requestId, approved }: AppCloseResponse): void => {
    if (closeApproved || closeRequest?.id !== requestId || window.isDestroyed()) return
    if (approved) completeClose()
    else {
      closeRequest = undefined
      clearCloseTimer()
      closePromptController?.abort()
    }
  }
  window.on('close', (event) => {
    if (closeApproved) return
    event.preventDefault()
    requestClose()
  })
  window.on('closed', clearCloseTimer)
  window.on('unresponsive', () => {
    if (closeRequest) void showClosePrompt(closeRequest.id)
  })
  window.webContents.on('render-process-gone', () => {
    rendererUnavailable = true
    if (closeRequest) void showClosePrompt(closeRequest.id)
  })

  const sendMaximizedChange = (): void => {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.windowMaximizedChange, window.isMaximized())
    }
  }
  window.on('maximize', sendMaximizedChange)
  window.on('unmaximize', sendMaximizedChange)

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    if (!isAllowedNavigation(target, allowedOrigins)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event, target) => {
    if (!isAllowedNavigation(target, allowedOrigins)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('did-finish-load', () => { rendererUnavailable = false; window.show() })

  const guardedSession = session.defaultSession
  guardedSession.setPermissionCheckHandler(() => false)
  guardedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  guardedSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const requestedUrl = new URL(details.url)
      const allowedLocalProtocol = ['llm-reader:', 'blob:', 'data:', 'about:'].includes(
        requestedUrl.protocol
      )
      const developmentOrigin = developmentUrl ? new URL(developmentUrl) : null
      const allowedInDevelopment = Boolean(
        developmentOrigin &&
          requestedUrl.host === developmentOrigin.host &&
          ['http:', 'https:', 'ws:', 'wss:'].includes(requestedUrl.protocol)
      )
      const allowedDevelopmentTool = Boolean(developmentUrl && requestedUrl.protocol === 'devtools:')
      callback({ cancel: !(allowedLocalProtocol || allowedInDevelopment || allowedDevelopmentTool) })
    } catch {
      callback({ cancel: true })
    }
  })

  return { window, allowedOrigins, requestClose, respondToClose }
}

export async function loadMainWindow(window: BrowserWindow): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) {
    await window.loadURL(developmentUrl)
  } else {
    await window.loadURL('llm-reader://app/index.html')
  }
}
