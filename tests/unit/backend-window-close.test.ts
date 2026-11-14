import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/contracts'
import { createMainWindow } from '../../src/main/window'

type Listener = (...args: unknown[]) => void
const mocks = vi.hoisted(() => {
  const events = new Map<string, Listener>()
  const contentsEvents = new Map<string, Listener>()
  const window = {
    on: vi.fn((event: string, listener: Listener) => { events.set(event, listener) }),
    close: vi.fn(),
    show: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1180, height: 800 })),
    isFullScreen: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    webContents: {
      on: vi.fn((event: string, listener: Listener) => { contentsEvents.set(event, listener) }),
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
      setWindowOpenHandler: vi.fn()
    }
  }
  return { events, contentsEvents, window, showMessageBox: vi.fn() }
})

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: vi.fn(function () { return mocks.window }),
  screen: { getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1180, height: 800 } })) },
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
  mocks.window.isDestroyed.mockReturnValue(false)
  mocks.window.isFullScreen.mockReturnValue(false)
  mocks.window.webContents.isDestroyed.mockReturnValue(false)
  mocks.showMessageBox.mockReset().mockResolvedValue({ response: 0 })
})

describe('reading window controls', () => {
  it('permits just one fixed blank child for a fresh fullscreen ticket', () => {
    const { readingWindow } = createMainWindow()
    const open = mocks.window.webContents.setWindowOpenHandler.mock.calls[0][0]
    const details = { url: 'about:blank', frameName: 'guessed', features: '', postBody: undefined }
    expect(readingWindow.reserveAssistantWindow()).toBeNull()
    expect(open(details)).toEqual({ action: 'deny' })
    mocks.window.isFullScreen.mockReturnValue(true)
    const ticket = readingWindow.reserveAssistantWindow()
    expect(ticket).toBeTruthy()
    const allowed = { ...details, frameName: ticket }
    expect(open({ ...allowed, url: 'https://example.test' })).toEqual({ action: 'deny' })
    expect(open({ ...allowed, features: 'nodeIntegration=yes' })).toEqual({ action: 'deny' })
    expect(open({ ...allowed, postBody: {} })).toEqual({ action: 'deny' })
    expect(open(allowed)).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: {
      parent: mocks.window, modal: false, show: false, alwaysOnTop: false
    } })
    expect(open(allowed)).toEqual({ action: 'deny' })
    expect(readingWindow.reserveAssistantWindow()).toBeNull()
    const stale = { ...details, frameName: readingWindow.reserveAssistantWindow() }
    expect(open(stale)).toEqual({ action: 'deny' })
    vi.advanceTimersByTime(5_001)
    const expired = readingWindow.reserveAssistantWindow()
    vi.advanceTimersByTime(5_001)
    expect(open({ ...details, frameName: expired })).toEqual({ action: 'deny' })
    const beforeNavigation = readingWindow.reserveAssistantWindow()
    mocks.contentsEvents.get('did-start-navigation')!({ isMainFrame: true, isSameDocument: false })
    expect(open({ ...details, frameName: beforeNavigation })).toEqual({ action: 'deny' })
  })

  it('emits native fullscreen changes and ignores F11 repeats and modifiers', () => {
    createMainWindow()
    const handleInput = mocks.contentsEvents.get('before-input-event')!
    const event = { preventDefault: vi.fn() }
    handleInput(event, { key: 'F11', type: 'keyDown', control: true })
    handleInput(event, { key: 'F11', type: 'keyDown', isAutoRepeat: true })
    handleInput(event, { key: 'F11', type: 'keyUp' })
    expect(mocks.window.webContents.send).not.toHaveBeenCalled()
    handleInput(event, { key: 'F11', type: 'keyDown' })
    expect(event.preventDefault).toHaveBeenCalledTimes(3)
    expect(mocks.window.webContents.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.windowFullscreenShortcut, undefined)
    mocks.events.get('enter-full-screen')!()
    mocks.events.get('leave-full-screen')!()
    expect(mocks.window.webContents.send).toHaveBeenNthCalledWith(2, IPC_CHANNELS.windowFullscreenChange, true)
    expect(mocks.window.webContents.send).toHaveBeenNthCalledWith(3, IPC_CHANNELS.windowFullscreenChange, false)
  })
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
})
