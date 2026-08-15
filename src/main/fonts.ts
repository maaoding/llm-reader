import { execFile } from 'node:child_process'

/**
 * Broadcasts WM_FONTCHANGE to every top-level window so Chromium's renderer
 * processes refresh their DirectWrite font caches before we enumerate fonts.
 * This makes fonts installed while the app is running visible immediately.
 */
const FONT_CHANGE_BROADCAST = [
  "$s='[DllImport(\"user32.dll\")] public static extern System.IntPtr SendMessageTimeout(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l, uint f, uint t, out System.IntPtr r);'",
  'Add-Type -Namespace W -Name N -MemberDefinition $s',
  '$r=[IntPtr]::Zero',
  '[W.N]::SendMessageTimeout([IntPtr]0xffff,0x001D,[IntPtr]::Zero,[IntPtr]::Zero,0x0002,1000,[ref]$r) | Out-Null'
].join(';')

const ENUMERATION_SCRIPT = [
  FONT_CHANGE_BROADCAST,
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Drawing',
  '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'
].join(';')

const SPAWN_TIMEOUT_MS = 6_000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const MAX_FONT_COUNT = 2_000

let lastGoodFonts: string[] = []

export function parseInstalledFontOutput(output: string): string[] {
  return Array.from(
    new Set(
      output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

function enumerateSystemFonts(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ENUMERATION_SCRIPT],
      { timeout: SPAWN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve([])
          return
        }
        resolve(parseInstalledFontOutput(stdout).slice(0, MAX_FONT_COUNT))
      }
    )
  })
}

/**
 * Enumerates fonts freshly on every call (the settings dialog requests it on
 * open), broadcasting WM_FONTCHANGE first so caches stay in sync with the
 * registry. Falls back to the last successful result when enumeration fails.
 */
export async function listSystemFonts(): Promise<string[]> {
  const fonts = await enumerateSystemFonts()
  if (fonts.length > 0) {
    lastGoodFonts = fonts
    return fonts
  }
  return lastGoodFonts
}

export function clearSystemFontsCache(): void {
  lastGoodFonts = []
}
