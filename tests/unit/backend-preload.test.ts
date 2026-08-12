import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/contracts'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener
  }
}))

import { readerApi } from '../../src/preload/index'

describe('preload ReaderApi', () => {
  beforeEach(() => {
    electronMocks.invoke.mockReset()
  })

  it('exposes insight deletion through its dedicated IPC channel', async () => {
    const id = '45b45c27-b51d-4f49-8df7-480918cf2a0b'
    electronMocks.invoke.mockResolvedValueOnce(true)

    await expect(readerApi.deleteInsight(id)).resolves.toBe(true)

    expect(electronMocks.invoke).toHaveBeenCalledOnce()
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.insightsDelete, id)
    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledWith('readerApi', readerApi)
  })
})
