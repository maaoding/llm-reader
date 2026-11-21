import { execFile, type ExecFileException, type ExecFileOptions } from 'node:child_process'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { copy } from '@shared/copy'
import { AppError } from './errors'

const DEFAULT_CONVERSION_TIMEOUT_MS = 120_000
const MAX_CALIBRE_OUTPUT_BYTES = 250 * 1024 * 1024
const MAX_CALIBRE_LOG_BYTES = 1024 * 1024

export type CalibreExecFile = (
  executable: string,
  arguments_: string[],
  options: ExecFileOptions,
  callback: (error: ExecFileException | null) => void
) => unknown

export interface CalibreConverterOptions {
  executablePath?: string
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  temporaryDirectory?: string
  timeoutMs?: number
  execFileImpl?: CalibreExecFile
}

export interface EpubConverter {
  convert(sourcePath: string): Promise<Buffer>
}

function executableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'ebook-convert.exe' : 'ebook-convert'
}

function standardCalibreCandidates(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): string[] {
  if (platform === 'win32') {
    return [
      environment.ProgramFiles ? join(environment.ProgramFiles, 'Calibre2', 'ebook-convert.exe') : '',
      environment['ProgramFiles(x86)']
        ? join(environment['ProgramFiles(x86)'], 'Calibre2', 'ebook-convert.exe')
        : '',
      environment.LOCALAPPDATA
        ? join(environment.LOCALAPPDATA, 'Programs', 'calibre', 'ebook-convert.exe')
        : ''
    ].filter(Boolean)
  }
  if (platform === 'darwin') {
    return ['/Applications/calibre.app/Contents/MacOS/ebook-convert']
  }
  return ['/usr/bin/ebook-convert', '/usr/local/bin/ebook-convert']
}

async function isExecutableFile(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const fileInfo = await stat(path)
    if (!fileInfo.isFile()) return false
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function findCalibreExecutable(
  options: Pick<CalibreConverterOptions, 'executablePath' | 'environment' | 'platform'> = {}
): Promise<string | null> {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const candidates: string[] = []
  if (options.executablePath) candidates.push(options.executablePath)

  const pathValue = environment.PATH ?? environment.Path ?? ''
  for (const entry of pathValue.split(delimiter)) {
    const directory = entry.trim().replace(/^"|"$/gu, '')
    if (directory) candidates.push(join(directory, executableName(platform)))
  }
  candidates.push(...standardCalibreCandidates(platform, environment))

  const seen = new Set<string>()
  for (const candidate of candidates) {
    const normalized = resolve(candidate)
    const key = platform === 'win32' ? normalized.toLowerCase() : normalized
    if (seen.has(key)) continue
    seen.add(key)
    if (await isExecutableFile(normalized, platform)) return normalized
  }
  return null
}

export class CalibreEpubConverter implements EpubConverter {
  private readonly options: CalibreConverterOptions

  constructor(options: CalibreConverterOptions = {}) {
    this.options = options
  }

  async convert(sourcePath: string): Promise<Buffer> {
    if (!isAbsolute(sourcePath)) {
      throw new AppError('INVALID_PATH', copy('error.importAbsolutePath'))
    }
    const executable = await findCalibreExecutable(this.options)
    if (!executable) {
      throw new AppError('CALIBRE_NOT_FOUND', copy('error.calibreNotFound'))
    }

    const temporaryRoot = this.options.temporaryDirectory ?? tmpdir()
    const workDirectory = await mkdtemp(join(temporaryRoot, 'llm-reader-calibre-'))
    const outputPath = join(workDirectory, 'converted.epub')
    try {
      await this.run(executable, [sourcePath, outputPath])
      let outputInfo
      try {
        outputInfo = await stat(outputPath)
      } catch (error) {
        throw new AppError('CALIBRE_CONVERSION_FAILED', copy('error.calibreConversionFailed'), false, {
          cause: error
        })
      }
      if (!outputInfo.isFile() || outputInfo.size <= 0) {
        throw new AppError('CALIBRE_CONVERSION_FAILED', copy('error.calibreConversionFailed'))
      }
      if (outputInfo.size > MAX_CALIBRE_OUTPUT_BYTES) {
        throw new AppError('FILE_TOO_LARGE', copy('error.importTooLarge'))
      }
      return await readFile(outputPath)
    } finally {
      await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async run(executable: string, arguments_: string[]): Promise<void> {
    const runner = this.options.execFileImpl ?? (execFile as CalibreExecFile)
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_CONVERSION_TIMEOUT_MS
    await new Promise<void>((resolvePromise, rejectPromise) => {
      runner(
        executable,
        arguments_,
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: MAX_CALIBRE_LOG_BYTES
        },
        (error) => {
          if (!error) {
            resolvePromise()
            return
          }
          const timedOut = error.killed || error.code === 'ETIMEDOUT'
          rejectPromise(
            new AppError(
              timedOut ? 'CALIBRE_TIMEOUT' : 'CALIBRE_CONVERSION_FAILED',
              timedOut ? copy('error.calibreTimeout') : copy('error.calibreConversionFailed'),
              false,
              { cause: error }
            )
          )
        }
      )
    })
  }
}
