import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const digest = (path: string) => createHash('sha256').update(readFileSync(resolve(path))).digest('hex')

describe('application icon assets', () => {
  it('keeps website PNG variants byte-identical to the packaged sources', () => {
    for (const name of ['icon.png', 'icon-32.png', 'icon-64.png', 'icon-128.png', 'icon-256.png']) {
      expect(digest(`site/${name}`), name).toBe(digest(`resources/${name}`))
    }
  })

  it('packages the ICO for both Electron Builder and BrowserWindow', () => {
    const builder = readFileSync(resolve('electron-builder.yml'), 'utf8')
    const windowSource = readFileSync(resolve('src/main/window.ts'), 'utf8')
    expect(builder).toContain('icon: resources/icon.ico')
    expect(builder).toMatch(/from: resources\/icon\.ico[\s\S]*to: icon\.ico/u)
    expect(windowSource).toContain("join(process.resourcesPath, 'icon.ico')")
    expect(windowSource).toContain("join(__dirname, '../../resources/icon.ico')")
  })
})
