import { mkdtempSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CalibreEpubConverter,
  findCalibreExecutable,
  type CalibreExecFile
} from '../../src/main/calibre-converter'

const temporaryDirectories: string[] = []

function makeTemporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'llm-reader-calibre-test-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('CalibreEpubConverter', () => {
  it('detects ebook-convert from PATH before standard install directories', async () => {
    const root = makeTemporaryDirectory()
    const pathDirectory = join(root, 'path-calibre')
    const standardDirectory = join(root, 'Calibre2')
    await Promise.all([
      mkdir(pathDirectory, { recursive: true }),
      mkdir(standardDirectory, { recursive: true })
    ])
    const pathExecutable = join(pathDirectory, 'ebook-convert.exe')
    await writeFile(pathExecutable, '')
    await writeFile(join(standardDirectory, 'ebook-convert.exe'), '')

    await expect(findCalibreExecutable({
      platform: 'win32',
      environment: { PATH: pathDirectory, ProgramFiles: root }
    })).resolves.toBe(pathExecutable)
  })

  it('uses an argument array, returns the converted EPUB and removes its work directory', async () => {
    const root = makeTemporaryDirectory()
    const executable = join(root, 'ebook-convert.exe')
    const source = join(root, 'source book.mobi')
    const workRoot = join(root, 'work')
    await mkdir(workRoot, { recursive: true })
    await writeFile(executable, '')
    await writeFile(source, 'source')
    const converted = Buffer.from('converted epub')
    const calls: Array<{ executable: string; arguments_: string[] }> = []
    const fakeExecFile: CalibreExecFile = (command, arguments_, _options, callback) => {
      calls.push({ executable: command, arguments_: [...arguments_] })
      void writeFile(arguments_[1], converted).then(() => callback(null), callback)
    }

    const converter = new CalibreEpubConverter({
      executablePath: executable,
      temporaryDirectory: workRoot,
      execFileImpl: fakeExecFile
    })

    await expect(converter.convert(source)).resolves.toEqual(converted)
    expect(calls).toHaveLength(1)
    expect(calls[0].executable).toBe(executable)
    expect(calls[0].arguments_[0]).toBe(source)
    expect(calls[0].arguments_[1]).toMatch(/converted\.epub$/u)
    await expect(readdir(workRoot)).resolves.toEqual([])
  })

  it.each([
    { name: 'failure', error: Object.assign(new Error('failed'), { code: 1 }), code: 'CALIBRE_CONVERSION_FAILED' },
    { name: 'timeout', error: Object.assign(new Error('timeout'), { killed: true }), code: 'CALIBRE_TIMEOUT' }
  ])('reports $name without retaining temporary output', async ({ error, code }) => {
    const root = makeTemporaryDirectory()
    const executable = join(root, 'ebook-convert.exe')
    const source = join(root, 'source.azw3')
    const workRoot = join(root, 'work')
    await mkdir(workRoot, { recursive: true })
    await writeFile(executable, '')
    await writeFile(source, 'source')
    const fakeExecFile = vi.fn<CalibreExecFile>((_command, arguments_, _options, callback) => {
      void writeFile(arguments_[1], 'partial').then(() => callback(error), callback)
    })
    const converter = new CalibreEpubConverter({
      executablePath: executable,
      temporaryDirectory: workRoot,
      execFileImpl: fakeExecFile
    })

    await expect(converter.convert(source)).rejects.toMatchObject({ code })
    await expect(readdir(workRoot)).resolves.toEqual([])
  })

  it('explains how to proceed when Calibre is unavailable', async () => {
    const root = makeTemporaryDirectory()
    const source = join(root, 'source.mobi')
    await writeFile(source, 'source')
    const converter = new CalibreEpubConverter({
      executablePath: join(root, 'missing', 'ebook-convert.exe'),
      platform: 'win32',
      environment: { PATH: '', ProgramFiles: join(root, 'missing-standard') }
    })

    await expect(converter.convert(source)).rejects.toMatchObject({ code: 'CALIBRE_NOT_FOUND' })
  })
})
