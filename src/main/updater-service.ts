import type { AppUpdatePhase } from '@shared/contracts'

export type AppUpdaterEvent = 'checking-for-update' | 'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error'

export interface AppUpdaterLike {
  autoDownload: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeAllListeners(): unknown
}

const STARTUP_CHECK_DELAY_MS = 3_000
const MAX_RELEASE_NOTES_LENGTH = 800

function readVersion(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const version = (payload as { version?: unknown }).version
  return typeof version === 'string' && version.length > 0 ? version : null
}

function normalizeReleaseNotes(notes: unknown): string | null {
  const parts = typeof notes === 'string'
    ? [notes]
    : Array.isArray(notes)
      ? notes.map((entry) => {
        if (typeof entry === 'string') return entry
        if (typeof entry === 'object' && entry !== null) {
          return [entry.title, entry.note]
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
            .join('\n')
        }
        return ''
      })
      : []
  const text = parts
    .map((part) =>
      part
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gu, ' ')
        .replace(/&amp;/gu, '&')
        .replace(/&lt;/gu, '<')
        .replace(/&gt;/gu, '>')
        .replace(/&quot;/gu, '"')
        .replace(/&#0?39;/gu, "'")
        .trim()
    )
    .filter((part) => part.length > 0)
    .join('\n\n')
  if (text.length === 0) return null
  return text.length > MAX_RELEASE_NOTES_LENGTH
    ? `${text.slice(0, MAX_RELEASE_NOTES_LENGTH).trimEnd()}…`
    : text
}

function readReleaseNotes(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  return normalizeReleaseNotes((payload as { releaseNotes?: unknown }).releaseNotes)
}

function readPercent(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const percent = (payload as { percent?: unknown }).percent
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
  return Math.min(100, Math.max(0, Math.round(percent)))
}

export class UpdaterService {
  private phase: AppUpdatePhase = { status: 'idle' }
  private checkMode: 'startup' | 'manual' = 'manual'
  private startupTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly emit: (phase: AppUpdatePhase) => void,
    private readonly supportsUpdate: boolean,
    private readonly updater: AppUpdaterLike
  ) {
    updater.autoDownload = false
    updater.on('update-available', (payload: unknown) => {
      const version = readVersion(payload)
      if (version && this.phase.status === 'checking') {
        this.setPhase({ status: 'available', version, releaseNotes: readReleaseNotes(payload) })
      }
    })
    updater.on('update-not-available', () => {
      if (this.phase.status === 'checking') this.setPhase({ status: 'upToDate' })
    })
    updater.on('download-progress', (payload: unknown) => {
      const percent = readPercent(payload)
      if (percent !== null && this.phase.status === 'downloading') this.setPhase({ status: 'downloading', percent })
    })
    updater.on('update-downloaded', (payload: unknown) => {
      const version = readVersion(payload)
      if (version) this.setPhase({ status: 'downloaded', version, releaseNotes: readReleaseNotes(payload) })
    })
    updater.on('error', (payload: unknown) => {
      if (this.phase.status !== 'checking' && this.phase.status !== 'downloading') return
      console.error(
        'LLM Reader update failed:',
        payload instanceof Error ? payload.message : 'unknown update error'
      )
      this.fail()
    })
  }

  getPhase(): AppUpdatePhase {
    return this.phase
  }

  scheduleStartupCheck(): void {
    if (!this.supportsUpdate || this.phase.status !== 'idle') return
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      void this.check('startup')
    }, STARTUP_CHECK_DELAY_MS)
  }

  async check(mode: 'startup' | 'manual'): Promise<AppUpdatePhase> {
    if (!this.supportsUpdate) {
      return mode === 'manual' ? this.setPhase({ status: 'unsupported' }) : this.phase
    }
    if (this.phase.status === 'checking' || this.phase.status === 'downloading' || this.phase.status === 'downloaded') {
      return this.phase
    }
    if (mode === 'startup' && this.phase.status !== 'idle') return this.phase

    this.checkMode = mode
    this.setPhase({ status: 'checking' })
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      console.error(
        'LLM Reader update check failed:',
        error instanceof Error ? error.message : 'unknown update error'
      )
      this.fail()
    }
    return this.phase
  }

  async download(): Promise<AppUpdatePhase> {
    if (this.phase.status !== 'available') return this.phase
    this.setPhase({ status: 'downloading', percent: 0 })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      console.error(
        'LLM Reader update download failed:',
        error instanceof Error ? error.message : 'unknown update error'
      )
      this.fail()
    }
    return this.phase
  }

  install(): void {
    if (this.phase.status !== 'downloaded') return
    this.updater.quitAndInstall(false, true)
  }

  dispose(): void {
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
    this.updater.removeAllListeners()
  }

  private fail(): void {
    if (this.checkMode === 'startup') {
      this.setPhase({ status: 'idle' })
    } else {
      this.setPhase({ status: 'error' })
    }
  }

  private setPhase(phase: AppUpdatePhase): AppUpdatePhase {
    this.phase = phase
    this.emit(phase)
    return this.phase
  }
}
