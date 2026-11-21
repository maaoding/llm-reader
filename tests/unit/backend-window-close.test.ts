import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/contracts'
import { createMainWindow } from '../../src/main/window'

type Listener = (...args: unknown[]) => void
const mocks = vi.hoisted(() => {
  const events = new Map<string, Listener>()
  const contentsEvents = new Map<string, Listener>()
  const quitEvents = new Map<string, Listener>()
  const app = {
    isPackaged: false,
    once: vi.fn((event: string, listener: Listener) => { quitEvents.set(event, listener) }),
    removeListener: vi.fn((event: string, listener: Listener) => {
      if (quitEvents.get(event) === listener) quitEvents.delete(event)
    })
  }
  const window = {
    on: vi.fn((event: string, listener: Listener) => { events.set(event, listener) }),
    close: vi.fn(),
    show: vi.fn(),
    isDestroyed: vi.fn(() => false),
    webContents: {
      on: vi.fn((event: string, listener: Listener) => { contentsEvents.set(event, listener) }),
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn()
    }
  }
  return { app, quitEvents, events, contentsEvents, window, showMessageBox: vi.fn() }
})

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: vi.fn(function () { return mocks.window }),
  dialog: { showMessageBox: mocks.showMessageBox },
  session: { defaultSession: {
    setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(), webRequest: { onBeforeRequest: vi.fn() }
  } }
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.events.clear()
  mocks.contentsEvents.clear()
  mocks.quitEvents.clear()
  mocks.window.isDestroyed.mockReturnValue(false)
  mocks.window.webContents.isDestroyed.mockReturnValue(false)
  mocks.showMessageBox.mockReset().mockResolvedValue({ response: 0 })
})
afterEach(() => { vi.useRealTimers() })

const requestWindowClose = (): void => {
  const event = { preventDefault: vi.fn() }
  mocks.events.get('close')!(event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
}

describe('save-before-close handshake', () => {
  it('waits for the current save result without the old 1.5 second forced close', async () => {
    const created = createMainWindow()
    requestWindowClose()
    requestWindowClose()
    expect(mocks.window.webContents.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.appBeforeClose, 1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.window.close).not.toHaveBeenCalled()
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
    created.respondToClose({ requestId: 1, approved: true })
    expect(mocks.window.close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })

  it('allows retry after a failed save and ignores approval for an obsolete request', () => {
    const created = createMainWindow()
    requestWindowClose()
    created.respondToClose({ requestId: 1, approved: false })
    requestWindowClose()
    expect(mocks.window.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.appBeforeClose, 2)
    created.respondToClose({ requestId: 1, approved: true })
    expect(mocks.window.close).not.toHaveBeenCalled()
    created.respondToClose({ requestId: 2, approved: true })
    expect(mocks.window.close).toHaveBeenCalledOnce()
  })

  it('offers waiting by default and only discards unsaved content after an explicit choice', async () => {
    createMainWindow()
    requestWindowClose()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.showMessageBox).toHaveBeenCalledWith(mocks.window, expect.objectContaining({ defaultId: 0, cancelId: 0 }))
    expect(mocks.window.close).not.toHaveBeenCalled()
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.window.close).toHaveBeenCalledOnce()
  })

  it('does not apply an old force-exit dialog to a new close attempt', async () => {
    let decide!: (result: { response: number }) => void
    mocks.showMessageBox.mockImplementationOnce(() => new Promise((resolve) => { decide = resolve }))
    const created = createMainWindow()
    requestWindowClose()
    await vi.advanceTimersByTimeAsync(15_000)
    created.respondToClose({ requestId: 1, approved: false })
    requestWindowClose()
    decide({ response: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.window.close).not.toHaveBeenCalled()
    created.respondToClose({ requestId: 2, approved: true })
    expect(mocks.window.close).toHaveBeenCalledOnce()
  })

  it('keeps unsaved content when the native exit prompt fails', async () => {
    mocks.showMessageBox.mockRejectedValueOnce(new Error('dialog unavailable'))
    createMainWindow()
    requestWindowClose()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.window.close).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
  })

  it('provides an explicit exit route after a renderer crash', async () => {
    createMainWindow()
    mocks.contentsEvents.get('render-process-gone')!()
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 })
    requestWindowClose()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.window.webContents.send).not.toHaveBeenCalled()
    expect(mocks.showMessageBox).toHaveBeenCalledOnce()
    expect(mocks.window.close).toHaveBeenCalledOnce()
  })

  it('offers explicit exit when a renderer stops responding during close', async () => {
    createMainWindow()
    requestWindowClose()
    mocks.events.get('unresponsive')!()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.showMessageBox).toHaveBeenCalledOnce()
    expect(mocks.window.close).not.toHaveBeenCalled()
  })

  it('runs a pending installation only when its close request is approved', () => {
    const created = createMainWindow()
    const install = vi.fn(() => true)
    created.requestClose(install)
    expect(install).not.toHaveBeenCalled()
    created.respondToClose({ requestId: 1, approved: false })
    expect(install).not.toHaveBeenCalled()
    created.requestClose(install)
    created.respondToClose({ requestId: 1, approved: true })
    expect(install).not.toHaveBeenCalled()
    created.respondToClose({ requestId: 2, approved: true })
    expect(install).toHaveBeenCalledOnce()
    expect(mocks.window.close).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'an unsuccessful installation', install: () => false },
    { name: 'an installer exception', install: () => { throw new Error('installer failed') } }
  ])('restores the close guard and renderer after $name', ({ install }) => {
    const created = createMainWindow()
    created.requestClose(install)
    created.respondToClose({ requestId: 1, approved: true })
    expect(mocks.window.close).not.toHaveBeenCalled()
    expect(mocks.window.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.appCloseCancelled)
    requestWindowClose()
    expect(mocks.window.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.appBeforeClose, 2)
    created.respondToClose({ requestId: 2, approved: true })
    expect(mocks.window.close).toHaveBeenCalledOnce()
  })

  it('restores editing after a delayed installer error and cancels the already queued quit', async () => {
    const created = createMainWindow()
    let rejectInstall!: () => void
    const queuedQuit = { preventDefault: vi.fn() }
    created.requestClose((cancel) => {
      rejectInstall = cancel
      setImmediate(() => mocks.quitEvents.get('before-quit')?.(queuedQuit))
      return true
    })
    created.respondToClose({ requestId: 1, approved: true })
    rejectInstall()
    expect(mocks.window.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.appCloseCancelled)
    await vi.advanceTimersByTimeAsync(0)
    expect(queuedQuit.preventDefault).toHaveBeenCalledOnce()
    expect(mocks.quitEvents.size).toBe(0)
    requestWindowClose()
    expect(mocks.window.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.appBeforeClose, 2)
    // Duplicate and stale failures cannot cancel a later close attempt.
    rejectInstall()
    expect(mocks.window.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.appBeforeClose, 2)
    created.respondToClose({ requestId: 2, approved: true })
    expect(mocks.window.close).toHaveBeenCalledOnce()
    rejectInstall()
    expect(mocks.window.webContents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.appBeforeClose, 2)
  })
})
