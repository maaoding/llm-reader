import { join } from 'node:path'
import { BrowserWindow, session } from 'electron'
import { IPC_CHANNELS } from '@shared/contracts'

export interface CreatedWindow {
  window: BrowserWindow
  allowedOrigins: ReadonlySet<string>
  completeClose: () => void
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
  const allowedOrigins = new Set<string>(['llm-reader://app'])
  if (developmentUrl) allowedOrigins.add(new URL(developmentUrl).origin)

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#f5f3ee',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  let closeApproved = false
  let closeRequested = false
  let closeFallback: ReturnType<typeof setTimeout> | undefined
  const completeClose = (): void => {
    if (closeApproved || window.isDestroyed()) return
    closeApproved = true
    if (closeFallback) clearTimeout(closeFallback)
    window.close()
  }
  window.on('close', (event) => {
    if (closeApproved || window.webContents.isDestroyed()) {
      closeApproved = true
      return
    }
    event.preventDefault()
    if (closeRequested) return
    closeRequested = true
    window.webContents.send(IPC_CHANNELS.appBeforeClose)
    closeFallback = setTimeout(completeClose, 1_500)
  })
  window.on('closed', () => {
    if (closeFallback) clearTimeout(closeFallback)
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
  window.webContents.on('did-finish-load', () => window.show())

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

  return { window, allowedOrigins, completeClose }
}

export async function loadMainWindow(window: BrowserWindow): Promise<void> {
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) {
    await window.loadURL(developmentUrl)
  } else {
    await window.loadURL('llm-reader://app/index.html')
  }
}
