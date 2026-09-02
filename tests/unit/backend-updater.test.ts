import { describe, expect, it, vi } from 'vitest'
import type { AppUpdatePhase } from '../../src/shared/contracts'
import { UpdaterService, type AppUpdaterEvent, type AppUpdaterLike } from '../../src/main/updater-service'

type Listener = (...args: unknown[]) => void

class FakeUpdater implements AppUpdaterLike {
  autoDownload = true

  checkForUpdatesResult: 'available' | 'not-available' | 'reject' = 'not-available'
  downloadShouldReject = false
  availableReleaseNotes?: unknown
  downloadedReleaseNotes?: unknown

  private readonly listeners = new Map<AppUpdaterEvent, Listener[]>()

  constructor() {
    for (const event of [
      'checking-for-update',
      'update-available',
      'update-not-available',
      'download-progress',
      'update-downloaded',
      'error'
    ] as const) {
      this.listeners.set(event, [])
    }
  }

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    const bucket = this.listeners.get(event as AppUpdaterEvent)
    bucket?.push(listener)
    return this
  }

  removeAllListeners(): unknown {
    for (const bucket of this.listeners.values()) bucket.length = 0
    return this
  }

  async checkForUpdates(): Promise<unknown> {
    if (this.checkForUpdatesResult === 'reject') throw new Error('network unreachable')
    if (this.checkForUpdatesResult === 'available') {
      this.emit('update-available', {
        version: '1.0.1',
        ...(this.availableReleaseNotes !== undefined ? { releaseNotes: this.availableReleaseNotes } : {})
      })
    } else {
      this.emit('update-not-available', { version: '0.3.0' })
    }
    return null
  }

  async downloadUpdate(): Promise<string[]> {
    if (this.downloadShouldReject) throw new Error('download interrupted')
    this.emit('download-progress', { percent: 42.4 })
    this.emit('download-progress', { percent: 100 })
    this.emit('update-downloaded', {
      version: '1.0.1',
      ...(this.downloadedReleaseNotes !== undefined ? { releaseNotes: this.downloadedReleaseNotes } : {})
    })
    return ['LLM Reader-1.0.1-setup.exe']
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.emit('quit-and-install', isSilent, isForceRunAfter)
  }

  emit(event: AppUpdaterEvent | 'quit-and-install', ...args: unknown[]): void {
    for (const listener of this.listeners.get(event as AppUpdaterEvent) ?? []) listener(...args)
  }
}

function makeUpdaterService(options?: {
  supportsUpdate?: boolean
  updater?: FakeUpdater
}): { service: UpdaterService; updater: FakeUpdater; phases: AppUpdatePhase[] } {
  const updater = options?.updater ?? new FakeUpdater()
  const phases: AppUpdatePhase[] = []
  const service = new UpdaterService(
    (phase) => phases.push(phase),
    options?.supportsUpdate ?? true,
    updater
  )
  return { service, updater, phases }
}

describe('UpdaterService', () => {
  it('reports a newer release after a manual check', async () => {
    const { service, updater } = makeUpdaterService()
    updater.checkForUpdatesResult = 'available'

    await expect(service.check('manual')).resolves.toEqual({ status: 'available', version: '1.0.1', releaseNotes: null })
    expect(service.getPhase()).toEqual({ status: 'available', version: '1.0.1', releaseNotes: null })
  })

  it('reports up to date when no newer release exists', async () => {
    const { service } = makeUpdaterService()

    await expect(service.check('manual')).resolves.toEqual({ status: 'upToDate' })
  })

  it('keeps auto-download disabled on the underlying updater', () => {
    const { updater } = makeUpdaterService()
    expect(updater.autoDownload).toBe(false)
  })

  it('falls back to idle without surfacing an error when the silent startup check fails', async () => {
    const { service, updater } = makeUpdaterService()
    updater.checkForUpdatesResult = 'reject'

    await expect(service.check('startup')).resolves.toEqual({ status: 'idle' })
  })

  it('surfaces an error phase when a manual check fails', async () => {
    const { service, updater } = makeUpdaterService()
    updater.checkForUpdatesResult = 'reject'

    await expect(service.check('manual')).resolves.toEqual({ status: 'error' })
  })

  it('downloads after a release was found and reports progress then completion', async () => {
    const { service, updater, phases } = makeUpdaterService()
    updater.checkForUpdatesResult = 'available'
    await service.check('manual')

    await expect(service.download()).resolves.toEqual({ status: 'downloaded', version: '1.0.1', releaseNotes: null })
    const downloading = phases.filter((phase) => phase.status === 'downloading')
    expect(downloading[0]).toEqual({ status: 'downloading', percent: 0 })
    expect(downloading[1]).toEqual({ status: 'downloading', percent: 42 })
    expect(downloading.at(-1)).toEqual({ status: 'downloading', percent: 100 })
  })

  it('refuses to download before a release was confirmed', async () => {
    const { service } = makeUpdaterService()

    await expect(service.download()).resolves.toEqual({ status: 'idle' })
  })

  it('surfaces an error phase when the download fails', async () => {
    const { service, updater } = makeUpdaterService()
    updater.checkForUpdatesResult = 'available'
    updater.downloadShouldReject = true
    await service.check('manual')

    await expect(service.download()).resolves.toEqual({ status: 'error' })
  })

  it('quits and relaunches after install once an update was downloaded', async () => {
    const { service, updater } = makeUpdaterService()
    updater.checkForUpdatesResult = 'available'
    await service.check('manual')
    await service.download()
    const quitAndInstall = vi.spyOn(updater, 'quitAndInstall')

    service.install()
    expect(quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('ignores install requests before an update was downloaded', async () => {
    const { service, updater } = makeUpdaterService()
    const quitAndInstall = vi.spyOn(updater, 'quitAndInstall')

    service.install()
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('returns the in-flight phase instead of starting a concurrent check', async () => {
    const { service, updater } = makeUpdaterService()
    let settleCheck: (() => void) | undefined
    vi.spyOn(updater, 'checkForUpdates').mockImplementation(
      () =>
        new Promise((resolve) => {
          settleCheck = () => {
            resolve(null)
            updater.emit('update-not-available', { version: '0.3.0' })
          }
        })
    )

    const pending = service.check('manual')
    const second = await service.check('manual')

    expect(second).toEqual({ status: 'checking' })
    settleCheck?.()
    await pending
    expect(service.getPhase()).toEqual({ status: 'upToDate' })
  })

  it('reports an unsupported environment for manual checks when updates are disabled', async () => {
    const { service, updater } = makeUpdaterService({ supportsUpdate: false })
    const checkForUpdates = vi.spyOn(updater, 'checkForUpdates')

    await expect(service.check('manual')).resolves.toEqual({ status: 'unsupported' })
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('skips the silent startup check entirely when updates are disabled', () => {
    const { service, updater } = makeUpdaterService({ supportsUpdate: false })
    const checkForUpdates = vi.spyOn(updater, 'checkForUpdates')

    vi.useFakeTimers()
    try {
      service.scheduleStartupCheck()
      vi.advanceTimersByTime(10_000)
    } finally {
      vi.useRealTimers()
    }
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('performs the delayed silent startup check when updates are supported', async () => {
    const { service, updater } = makeUpdaterService()
    updater.checkForUpdatesResult = 'available'
    const checkForUpdates = vi.spyOn(updater, 'checkForUpdates')

    vi.useFakeTimers()
    try {
      service.scheduleStartupCheck()
      await vi.advanceTimersByTimeAsync(3_000)
    } finally {
      vi.useRealTimers()
    }
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(service.getPhase()).toEqual({ status: 'available', version: '1.0.1', releaseNotes: null })
  })

  it('stops listening for updater events after dispose', async () => {
    const { service, updater, phases } = makeUpdaterService()

    service.dispose()
    updater.emit('update-downloaded', { version: '1.0.1' })

    expect(phases).toEqual([])
    expect(service.getPhase()).toEqual({ status: 'idle' })
  })

  it('carries plain-text release notes into the available phase', async () => {
    const { service, updater } = makeUpdaterService()
    updater.checkForUpdatesResult = 'available'
    updater.availableReleaseNotes = '- 修复了导入问题\n- 新增批量导入'

    await expect(service.check('manual')).resolves.toEqual({
      status: 'available',
      version: '1.0.1',
      releaseNotes: '- 修复了导入问题\n- 新增批量导入'
    })
  })

  it('truncates oversized release notes and keeps the downloaded phase notes', async () => {
    const { service, updater } = makeUpdaterService()
    updater.checkForUpdatesResult = 'available'
    updater.availableReleaseNotes = 'x'.repeat(900)
    updater.downloadedReleaseNotes = '已修复批量导入。'
    await service.check('manual')

    const available = service.getPhase()
    expect(available.status === 'available' && available.releaseNotes).toBe(`${'x'.repeat(800)}…`)

    await service.download()
    expect(service.getPhase()).toEqual({
      status: 'downloaded',
      version: '1.0.1',
      releaseNotes: '已修复批量导入。'
    })
  })

  it('normalizes array release notes and strips markup', async () => {
    const { service, updater } = makeUpdaterService()
    updater.checkForUpdatesResult = 'available'
    updater.availableReleaseNotes = [
      { title: '修复', note: '<b>导入失败</b><br/>的问题 &amp; 提示' },
      '纯文本条目'
    ]

    await expect(service.check('manual')).resolves.toEqual({
      status: 'available',
      version: '1.0.1',
      releaseNotes: '修复\n导入失败\n的问题 & 提示\n\n纯文本条目'
    })
  })
})
