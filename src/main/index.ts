import { isAbsolute, join } from 'node:path'
import { app, BrowserWindow, Menu } from 'electron'
import electronUpdater from 'electron-updater'
import { IPC_CHANNELS } from '@shared/contracts'
import { registerAppScheme, installAppProtocol } from './app-protocol'
import { AppDatabase } from './database'
import { ElectronKeyProtector } from './electron-key-protector'
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc'
import { LibraryService } from './library-service'
import { LlmService } from './llm-service'
import { ProviderService } from './provider-service'
import { ProfileSecretStore } from './secret-store'
import { UpdaterService } from './updater-service'
import { createMainWindow, loadMainWindow } from './window'

registerAppScheme()

const userDataOverride = process.env.LLM_READER_USER_DATA
if (userDataOverride) {
  if (!isAbsolute(userDataOverride)) {
    throw new Error('LLM_READER_USER_DATA must be an absolute path')
  }
  app.setPath('userData', userDataOverride)
}

let database: AppDatabase | undefined
let llm: LlmService | undefined
let library: LibraryService | undefined
let provider: ProviderService | undefined
let updater: UpdaterService | undefined

const { autoUpdater } = electronUpdater

async function openWindow(): Promise<void> {
  if (!library || !provider || !llm) throw new Error('Application services are not initialized')
  updater?.dispose()
  updater = undefined
  const created = createMainWindow()
  updater = new UpdaterService(
    (phase) => {
      if (!created.window.isDestroyed() && !created.window.webContents.isDestroyed()) {
        created.window.webContents.send(IPC_CHANNELS.appUpdateEvent, phase)
      }
    },
    app.isPackaged && process.env.LLM_READER_UPDATER_DISABLED !== '1',
    autoUpdater
  )
  registerIpcHandlers({
    window: created.window,
    library,
    provider,
    llm,
    updater,
    allowedRendererOrigins: created.allowedOrigins,
    completeClose: created.completeClose
  })
  await loadMainWindow(created.window)
  updater.scheduleStartupCheck()
}

async function initialize(): Promise<void> {
  Menu.setApplicationMenu(null)
  const userData = app.getPath('userData')
  database = new AppDatabase(join(userData, 'reader.sqlite3'))
  library = new LibraryService(database, join(userData, 'library'))
  provider = new ProviderService(
    database,
    new ElectronKeyProtector(),
    new ProfileSecretStore(join(userData, 'provider-keys'), join(userData, 'api-key.bin'))
  )
  llm = new LlmService(provider)

  await installAppProtocol(join(__dirname, '../renderer'))
  const e2eImportPath = process.env.LLM_READER_E2E_IMPORT
  if (e2eImportPath) {
    if (!isAbsolute(e2eImportPath)) throw new Error('LLM_READER_E2E_IMPORT must be an absolute path')
    await library.importFromPath(e2eImportPath)
  }
  await openWindow()
}

app.whenReady().then(initialize).catch((error: unknown) => {
  console.error('LLM Reader startup failed:', error instanceof Error ? error.message : 'unknown error')
  app.exit(1)
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void openWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  unregisterIpcHandlers()
  updater?.dispose()
  updater = undefined
  llm?.cancelAll()
  database?.close()
  database = undefined
})
