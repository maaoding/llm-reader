/* global AbortSignal, Buffer, console, fetch, process, window */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'
import { _electron as electron, expect } from '@playwright/test'

// NSIS also writes installation registration and shortcuts. Run only on a
// disposable GitHub-hosted Windows runner, never on a daily-use machine.
assert.equal(process.platform, 'win32', 'Package acceptance requires native Windows')
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use a disposable GitHub Actions runner')
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Use a GitHub-hosted runner')
assert.ok(process.env.RUNNER_TEMP, 'RUNNER_TEMP is required')

const { values } = parseArgs({ options: { output: { type: 'string', default: 'release' }, installer: { type: 'string' } } })
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const expectedElectron = manifest.devDependencies.electron
assert.match(expectedElectron, /^\d+\.\d+\.\d+$/, 'The Electron runtime must be pinned')
const evidence = resolve(values.output)
mkdirSync(evidence, { recursive: true })
const installer = resolve(values.installer ?? `release/LLM-Reader-${manifest.version}-setup.exe`)
const buildArchive = resolve('release/win-unpacked/resources/app.asar')
const testRoot = mkdtempSync(join(resolve(process.env.RUNNER_TEMP), 'llm-reader-package-validation-'))
// NSIS /D and _?= consume the remaining command line without quote handling.
assert.equal(/\s/.test(testRoot), false, 'RUNNER_TEMP must not contain spaces for NSIS acceptance')
const installDir = join(testRoot, 'installed')
const executablePath = join(installDir, 'LLM Reader.exe')
const cleanProfile = join(testRoot, 'clean-profile')
const upgradeProfile = join(testRoot, 'upgrade-profile')
const fixturePath = join(testRoot, 'upgrade-fixture.txt')
const oldInstaller = join(testRoot, 'LLM-Reader-1.1.0-setup.exe')
const oldRelease = {
  version: '1.1.0',
  electron: '43.5.0',
  bytes: 127_346_352,
  sha256: '82f5c20a09cf02707b700327a560e768b14e059e72ff982aefc800bf0f09ab22',
  url: 'https://github.com/maaoding/llm-reader/releases/download/v1.1.0/LLM-Reader-1.1.0-setup.exe'
}
const syntheticKey = `package-validation-${randomUUID()}`
const marker = 'package-validation-preserved'
const report = { passed: false, version: manifest.version, expectedElectron, installedExecutable: executablePath, checks: {} }
let application
let server
let failure
let validAuthorizations = 0

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function runInstaller(path, args) {
  // /D must be last. /S on the assisted installer does not launch the app;
  // --force-run is deliberately absent so every launch receives a test profile.
  const result = spawnSync(path, args, { timeout: 180_000, windowsHide: true, encoding: 'utf8' })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `NSIS exited unsuccessfully: ${result.stderr ?? ''}`)
}

function install(path) {
  runInstaller(path, ['/S', '/currentuser', `/D=${installDir}`])
  assert.ok(existsSync(executablePath), 'NSIS did not install the expected executable')
}

function verifyArchive() {
  const installed = readFileSync(join(installDir, 'resources/app.asar'))
  assert.ok(installed.equals(readFileSync(buildArchive)), 'Installed app.asar differs from the tested build')
  return sha256(installed)
}

function verifyBuildArtifacts() {
  const require = createRequire(resolve('package.json'))
  const builderRequire = createRequire(require.resolve('app-builder-lib', { paths: [require.resolve('electron-builder')] }))
  const asar = builderRequire('@electron/asar')
  const yaml = builderRequire('js-yaml')
  const bytes = readFileSync(installer)
  const filename = `LLM-Reader-${manifest.version}-setup.exe`
  const metadata = yaml.load(readFileSync('release/latest.yml', 'utf8'))
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  assert.equal(metadata.version, manifest.version)
  assert.equal(metadata.path, filename)
  assert.equal(metadata.sha512, sha512)
  assert.deepEqual(metadata.files, [{ url: filename, sha512, size: bytes.length }])
  const blockmap = JSON.parse(gunzipSync(readFileSync(`${installer}.blockmap`)))
  let coverage = 0
  let blocks = 0
  for (const file of blockmap.files) {
    assert.equal(file.offset, coverage)
    assert.equal(file.sizes.length, file.checksums.length)
    for (const size of file.sizes) {
      assert.ok(Number.isSafeInteger(size) && size > 0)
      coverage += size
      blocks += 1
    }
  }
  assert.equal(coverage, bytes.length)
  assert.equal(JSON.parse(asar.extractFile(buildArchive, 'package.json').toString()).version, manifest.version)
  let checkedOutputFiles = 0
  function checkOutput(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) checkOutput(path)
      else {
        const archivePath = relative(process.cwd(), path).replaceAll('\\', '/')
        assert.ok(asar.extractFile(buildArchive, archivePath).equals(readFileSync(path)), archivePath)
        checkedOutputFiles += 1
      }
    }
  }
  checkOutput(resolve('out'))
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    assert.ok(readFileSync(join('release/win-unpacked/resources', name)).equals(readFileSync(name)))
  }
  assert.ok(readFileSync('release/win-unpacked/resources/icon.ico').equals(readFileSync('resources/icon.ico')))
  const updateConfig = yaml.load(readFileSync('release/win-unpacked/resources/app-update.yml', 'utf8'))
  assert.equal(updateConfig.provider, 'github')
  assert.equal(updateConfig.owner, 'maaoding')
  assert.equal(updateConfig.repo, 'llm-reader')
  return {
    filename, bytes: bytes.length, sha256: sha256(bytes), sha512,
    appAsarSha256: sha256(readFileSync(buildArchive)), checkedOutputFiles,
    blockmapBlocks: blocks, blockmapCoverage: coverage,
    metadataVerified: true, assetsVerified: true, updateSourceVerified: true
  }
}

async function launch(userData, importPath = '', runtimeVersion = expectedElectron) {
  application = await electron.launch({
    executablePath,
    args: [],
    env: {
      ...process.env,
      LLM_READER_USER_DATA: userData,
      LLM_READER_E2E_IMPORT: importPath,
      LLM_READER_UPDATER_DISABLED: '1'
    }
  })
  const page = await application.firstWindow()
  await page.waitForFunction(() => Boolean(window.readerApi))
  const runtime = await application.evaluate(({ app, safeStorage }) => ({
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    userData: app.getPath('userData'),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }))
  assert.equal(runtime.electron, runtimeVersion)
  assert.equal(runtime.isPackaged, true)
  assert.equal(resolve(runtime.userData), resolve(userData))
  assert.equal(runtime.encryptionAvailable, true)
  return { page, runtime }
}

async function closeApplication() {
  await application?.close()
  application = undefined
}

async function retainedState(page, bookId) {
  return page.evaluate(async (id) => {
    const state = {
      books: await window.readerApi.listBooks(),
      highlights: await window.readerApi.listHighlights(id),
      insights: await window.readerApi.listInsights(id),
      session: await window.readerApi.getBookSession(id),
      workbenches: await window.readerApi.listWorkbenches(),
      providers: await window.readerApi.getProviderOverview(),
      marker: window.localStorage.getItem('package-validation-marker')
    }
    // Startup may legitimately refresh use/autosave timestamps. All identifiers,
    // creation dates, reading positions, settings and saved content must match.
    for (const book of state.books) delete book.lastOpenedAt
    if (state.session) delete state.session.updatedAt
    for (const workbench of state.workbenches) delete workbench.updatedAt
    return state
  }, bookId)
}

try {
  report.artifacts = verifyBuildArtifacts()
  writeFileSync(fixturePath, '依赖升级验收\n\n第一章 原文\n\n用于验证书籍、阅读进度、摘录、归档、工作台和会话草稿在升级后保留。\n')

  install(installer)
  const clean = await launch(cleanProfile)
  assert.equal(clean.runtime.version, manifest.version)
  const empty = await clean.page.evaluate(async () => ({
    books: await window.readerApi.listBooks(),
    workbenches: await window.readerApi.listWorkbenches(),
    profiles: (await window.readerApi.getProviderOverview()).profiles
  }))
  assert.deepEqual(empty, { books: [], workbenches: [], profiles: [] })
  report.checks.cleanInstall = { passed: true, runtime: clean.runtime.electron, appAsarSha256: verifyArchive(), emptyIsolatedProfile: true }
  await closeApplication()
  // There is no second installation yet. Remove only this known temporary
  // installation before exercising the released installer and its registration.
  const uninstaller = join(installDir, 'Uninstall LLM Reader.exe')
  assert.ok(existsSync(uninstaller), 'The isolated installation has no uninstaller')
  runInstaller(uninstaller, ['/S', '/currentuser', '/KEEP_APP_DATA', `_?=${installDir}`])
  assert.equal(existsSync(executablePath), false, 'The isolated clean installation was not removed')

  const response = await fetch(oldRelease.url, { signal: AbortSignal.timeout(180_000) })
  assert.equal(response.status, 200, 'Could not download the public baseline installer')
  const oldBytes = Buffer.from(await response.arrayBuffer())
  assert.equal(oldBytes.length, oldRelease.bytes)
  assert.equal(sha256(oldBytes), oldRelease.sha256, 'The baseline installer checksum changed')
  writeFileSync(oldInstaller, oldBytes)
  report.baselineInstaller = { version: oldRelease.version, bytes: oldBytes.length, sha256: oldRelease.sha256 }

  server = createServer((request, reply) => {
    request.resume()
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      reply.writeHead(404).end()
      return
    }
    if (request.headers.authorization !== `Bearer ${syntheticKey}`) {
      reply.writeHead(401).end()
      return
    }
    validAuthorizations += 1
    reply.writeHead(200, { 'content-type': 'application/json' })
    reply.end(JSON.stringify({ model: 'package-validation', choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }))
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpoint = `http://127.0.0.1:${address.port}/v1`

  install(oldInstaller)
  const baseline = await launch(upgradeProfile, fixturePath, oldRelease.electron)
  assert.equal(baseline.runtime.version, oldRelease.version)
  await expect.poll(() => baseline.page.evaluate(async () => (await window.readerApi.listBooks()).length)).toBe(1)
  const bookId = (await baseline.page.evaluate(() => window.readerApi.listBooks()))[0].id
  await baseline.page.getByTestId('nav-library').click()
  const conversationId = randomUUID()
  const workbenchTurnId = randomUUID()
  const seeded = await baseline.page.evaluate(async ({ bookId, conversationId, workbenchTurnId, endpoint, syntheticKey, marker }) => {
    const api = window.readerApi
    await api.updateBookProgress(bookId, 'txt:0:6', 0.42)
    const highlight = await api.saveHighlight({ bookId, quote: '依赖升级验收', anchor: 'txt:0:6', chapterTitle: '第一章 原文' })
    const insight = await api.saveInsight({
      bookId,
      selection: { bookId, quote: '依赖升级验收', anchor: 'txt:0:6', chapterTitle: '第一章 原文', passages: [{ id: 'package-validation-p1', text: '依赖升级验收', anchor: 'txt:0:6', chapterTitle: '第一章 原文' }] },
      question: '升级验收问题', answer: '升级验收回答', model: 'package-validation'
    })
    await api.saveBookSession({ bookId, conversationId, scope: 'book', selection: null, draft: '升级后继续的草稿', turns: [] })
    const created = await api.createWorkbench({ name: '升级验收工作台', bookIds: [bookId] })
    await api.saveWorkbench({
      id: created.id, name: created.name, bookIds: created.bookIds,
      draft: '工作台未发送草稿', webSearch: 'off', persona: null,
      turns: [{ id: workbenchTurnId, bookIds: [bookId], question: '工作台验收问题', answer: '工作台验收回答', model: 'package-validation', status: 'completed' }]
    })
    const overview = await api.createProviderProfile({ name: '升级凭据验收', baseUrl: endpoint, model: 'package-validation', apiKey: syntheticKey })
    const profileId = overview.profiles[0].id
    await api.activateProviderProfile(profileId)
    window.localStorage.setItem('package-validation-marker', marker)
    return { highlightId: highlight.id, insightId: insight.id, workbenchId: created.id, profileId, probe: await api.testProvider() }
  }, { bookId, conversationId, workbenchTurnId, endpoint, syntheticKey, marker })
  assert.equal(seeded.probe.ok, true)
  assert.ok(validAuthorizations >= 1)
  const secretPath = join(upgradeProfile, 'provider-keys', `${seeded.profileId}.bin`)
  const encryptedKey = readFileSync(secretPath)
  assert.equal(encryptedKey.subarray(0, 8).toString('ascii'), 'LLMRKEY1')
  assert.equal(encryptedKey.includes(Buffer.from(syntheticKey)), false, 'The synthetic credential was stored in plaintext')
  const before = await retainedState(baseline.page, bookId)
  assert.equal(before.books[0].lastLocator, 'txt:0:6')
  assert.equal(before.books[0].progress, 0.42)
  assert.equal(before.session.conversationId, conversationId)
  assert.equal(before.session.draft, '升级后继续的草稿')
  await closeApplication()

  install(installer)
  const upgraded = await launch(upgradeProfile)
  assert.equal(upgraded.runtime.version, manifest.version)
  const archiveHash = verifyArchive()
  const after = await retainedState(upgraded.page, bookId)
  assert.deepEqual(after, before, 'The upgrade changed the seeded library or settings')
  assert.ok(readFileSync(secretPath).equals(encryptedKey), 'The encrypted credential changed during upgrade')
  assert.equal((await upgraded.page.evaluate(() => window.readerApi.testProvider())).ok, true)
  assert.ok(validAuthorizations >= 2)
  await closeApplication()
  const restarted = await launch(upgradeProfile)
  assert.deepEqual(await retainedState(restarted.page, bookId), before, 'The upgraded data changed after restart')
  assert.equal((await restarted.page.evaluate(() => window.readerApi.testProvider())).ok, true)
  assert.ok(validAuthorizations >= 3)
  report.checks.upgrade = {
    passed: true, fromVersion: oldRelease.version, toVersion: manifest.version,
    fromElectron: baseline.runtime.electron, toElectron: upgraded.runtime.electron,
    appAsarSha256: archiveHash, book: true, readingProgress: true, highlight: true,
    archive: true, sessionDraft: true, workbenchDraftAndTurn: true, localStorage: true,
    providerSettings: true, encryptedSyntheticCredential: true, loopbackProbeAfterRestart: true
  }
  await closeApplication()
  writeFileSync(join(evidence, 'installed-executable.txt'), `${executablePath}\n`)
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `LLM_READER_E2E_EXECUTABLE=${executablePath}\n`)
  report.passed = true
} catch (error) {
  failure = error
} finally {
  const closing = await Promise.allSettled([
    closeApplication(),
    (async () => {
      if (!server) return
      server.closeAllConnections()
      await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
    })()
  ])
  const closeFailure = closing.find((result) => result.status === 'rejected')
  if (closeFailure) {
    failure ??= closeFailure.reason
    report.passed = false
  }
  const cleanup = await Promise.allSettled([cleanProfile, upgradeProfile, fixturePath, oldInstaller].map((path) => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
  report.isolatedTestDataRemoved = cleanup.every((result) => result.status === 'fulfilled')
  if (!report.isolatedTestDataRemoved) {
    failure ??= new Error('Could not remove all disposable test data')
    report.passed = false
  }
  // Only summaries are uploaded; synthetic profiles and credentials stay out.
  writeFileSync(join(evidence, 'package-validation.json'), `${JSON.stringify(report, null, 2)}\n`)
}

if (failure) throw failure
assert.equal(statSync(executablePath).isFile(), true)
console.log(`Native clean installation and ${oldRelease.electron} → ${expectedElectron} upgrade verified; isolated data removed.`)
