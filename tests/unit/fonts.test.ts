import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSystemFontsCache, listSystemFonts, parseInstalledFontOutput } from '../../src/main/fonts'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function usePlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

function enumerationReturns(output: string, error: Error | null = null): void {
  execFileMock.mockImplementationOnce((
    _executable: string,
    _arguments: string[],
    _options: unknown,
    callback: (error: Error | null, output: string) => void
  ) => callback(error, output))
}

beforeEach(() => {
  execFileMock.mockReset()
  clearSystemFontsCache()
})

afterEach(() => {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  clearSystemFontsCache()
})

describe('installed font output parsing', () => {
  it('trims lines, drops blanks, dedupes and keeps a stable localized order', () => {
    const output = '微软雅黑\r\n宋体\n\r\n微软雅黑\n  KaiTi  \nArial\n'
    const result = parseInstalledFontOutput(output)

    expect(result).toHaveLength(4)
    expect(new Set(result)).toEqual(new Set(['微软雅黑', '宋体', 'KaiTi', 'Arial']))
    expect(result).toEqual([...result].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')))
  })

  it('returns an empty list for empty or blank output', () => {
    expect(parseInstalledFontOutput('')).toEqual([])
    expect(parseInstalledFontOutput('\r\n \n\t')).toEqual([])
  })
})

describe('installed font enumeration', () => {
  it('keeps the Windows font refresh and PowerShell enumeration', async () => {
    usePlatform('win32')
    enumerationReturns('Arial\r\n微软雅黑\r\nArial\r\n')

    expect(new Set(await listSystemFonts())).toEqual(new Set(['Arial', '微软雅黑']))
    expect(execFileMock).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('SendMessageTimeout')],
      { timeout: 6_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      expect.any(Function)
    )
    expect(execFileMock.mock.calls[0][1][4]).toContain('System.Drawing.Text.InstalledFontCollection')
  })

  it('reads installed Linux font families through Fontconfig with the existing limits', async () => {
    usePlatform('linux')
    enumerationReturns('DejaVu Sans\nLatin Modern Roman\nDejaVu Sans\n')

    expect(new Set(await listSystemFonts())).toEqual(new Set(['DejaVu Sans', 'Latin Modern Roman']))
    expect(execFileMock).toHaveBeenCalledWith(
      'fc-list',
      ['--format=%{family[0]}\\n'],
      { timeout: 6_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      expect.any(Function)
    )
  })

  it('keeps the last successful fonts when the command fails or returns no fonts', async () => {
    usePlatform('linux')
    enumerationReturns('DejaVu Sans\n')
    enumerationReturns('', new Error('font enumeration unavailable'))
    enumerationReturns('\n \n')

    expect(await listSystemFonts()).toEqual(['DejaVu Sans'])
    expect(await listSystemFonts()).toEqual(['DejaVu Sans'])
    expect(await listSystemFonts()).toEqual(['DejaVu Sans'])
  })

  it('does not launch a Windows-only command on an unsupported platform', async () => {
    usePlatform('freebsd')

    expect(await listSystemFonts()).toEqual([])
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
