import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMainWindow } from '../../src/main/window'

const { appMock, browserWindowMock, sessionMock } = vi.hoisted(() => {
  const window = {
    on: vi.fn(),
    webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() }
  }
  return {
    appMock: { isPackaged: true },
    browserWindowMock: vi.fn(function () { return window }),
    sessionMock: {
      defaultSession: {
        setPermissionCheckHandler: vi.fn(),
        setPermissionRequestHandler: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() }
      }
    }
  }
})
vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: browserWindowMock,
  session: sessionMock
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
  else Reflect.deleteProperty(process, 'resourcesPath')
})

const digest = (path: string) => createHash('sha256').update(readFileSync(resolve(path))).digest('hex')

describe('application icon assets', () => {
  it('keeps website PNG variants byte-identical to the packaged sources', () => {
    for (const name of ['icon.png', 'icon-32.png', 'icon-64.png', 'icon-128.png', 'icon-256.png']) {
      expect(digest(`site/${name}`), name).toBe(digest(`resources/${name}`))
    }
  })

  it('packages both platform icon formats and retains the Windows installer ICO', () => {
    const builder = readFileSync(resolve('electron-builder.yml'), 'utf8')
    expect(builder).toContain('icon: resources/icon.ico')
    expect(builder).toMatch(/from: resources\/icon\.ico\s+to: icon\.ico/u)
    expect(builder).toMatch(/from: resources\/icon\.png\s+to: icon\.png/u)
  })

  it.each([
    { platform: 'win32', fileName: 'icon.ico' },
    { platform: 'linux', fileName: 'icon.png' }
  ])('gives packaged $platform windows their supported icon format', ({ platform, fileName }) => {
    const resourcesPath = resolve('installed-resources')
    Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesPath })

    createMainWindow()

    expect(browserWindowMock).toHaveBeenCalledWith(expect.objectContaining({
      icon: join(resourcesPath, fileName)
    }))
  })
})
