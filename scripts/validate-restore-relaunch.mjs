/* global AbortSignal, WebSocket, fetch, process, window, setTimeout, clearTimeout */

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { URL } from 'node:url'
import { chromium, expect } from '@playwright/test'

async function unusedPort() {
  const server = createServer()
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const { port } = server.address()
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()))
  return port
}

// Plain --inspect does not pause startup. Unlike Playwright's Electron loader,
// these loopback debugger arguments can survive a real app.relaunch().
async function evaluateMain(port, expression) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2_000) })
  assert.equal(response.ok, true)
  const [target] = await response.json()
  const endpoint = new URL(target.webSocketDebuggerUrl)
  assert.equal(endpoint.protocol, 'ws:')
  assert.equal(endpoint.hostname, '127.0.0.1')
  assert.equal(endpoint.port, String(port))
  return new Promise((done, reject) => {
    const socket = new WebSocket(endpoint)
    const timer = setTimeout(() => finish(new Error('Main-process inspector request timed out')), 5_000)
    let finished = false
    function finish(error, value) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else done(value)
    }
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true }
    })))
    socket.addEventListener('error', () => finish(new Error('Main-process inspector connection failed')))
    socket.addEventListener('close', () => finish(new Error('Main-process inspector closed before replying')))
    socket.addEventListener('message', ({ data }) => {
      try {
        const message = JSON.parse(String(data))
        if (message.id !== 1) return
        if (message.error || message.result.exceptionDetails) finish(new Error('Main-process evaluation failed'))
        else finish(null, message.result.result.value)
      } catch (error) { finish(error) }
    })
  })
}

const electronModule = "process.getBuiltinModule('module').createRequire(process.execPath)('electron')"
const runtimeExpression = `(() => {
  const { app } = ${electronModule}
  return { pid: process.pid, executable: app.getPath('exe'), userData: app.getPath('userData'),
    packaged: app.isPackaged, version: app.getVersion() }
})()`

async function stopOwnedProcesses(executablePath) {
  // The caller must provide an executable inside its disposable root. Never
  // kill by image name: another Electron application may be running.
  if (process.platform === 'win32') {
    const path = executablePath.replaceAll("'", "''")
    const script = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${path}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 15_000, windowsHide: true })
    if (result.error) throw result.error
    assert.equal(result.status, 0, 'Could not stop the disposable installed application')
  } else if (process.platform === 'linux') {
    for (const id of await readdir('/proc')) {
      if (!/^\d+$/u.test(id)) continue
      const executable = await readlink(`/proc/${id}/exe`).catch(() => null)
      if (executable === executablePath) {
        try { process.kill(Number(id), 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
    }
  }
}

export async function verifyRestoreRelaunch({ executablePath, root, fixturePath, screenshot }) {
  executablePath = await realpath(resolve(executablePath))
  root = await realpath(resolve(root))
  const executableRelative = relative(root, executablePath)
  assert.ok(executableRelative && !executableRelative.startsWith('..') && !isAbsolute(executableRelative),
    'Relaunch acceptance requires an executable inside its disposable root')
  assert.ok(['win32', 'linux'].includes(process.platform), 'Unsupported acceptance host')
  const scratch = await mkdtemp(join(root, 'restore-relaunch-'))
  const userData = join(scratch, 'profile'), backups = join(scratch, 'backups')
  await mkdir(backups)
  const mainPort = await unusedPort()
  let browserPort = await unusedPort()
  while (mainPort === browserPort) browserPort = await unusedPort()
  const browserEndpoint = `http://127.0.0.1:${browserPort}`
  let browser, failure, result
  const child = spawn(executablePath, [`--inspect=127.0.0.1:${mainPort}`, `--remote-debugging-port=${browserPort}`, '--remote-debugging-address=127.0.0.1'], {
    stdio: 'ignore', env: { ...process.env, LLM_READER_USER_DATA: userData,
      LLM_READER_E2E_IMPORT: fixturePath, LLM_READER_UPDATER_DISABLED: '1', LLM_READER_E2E_NO_RELAUNCH: '1' }
  })
  let exit = null, launchError
  child.once('error', (error) => { launchError = error })
  child.once('exit', (code, signal) => { exit = { code, signal } })
  const inspect = (expression) => evaluateMain(mainPort, expression)
  const runtime = () => inspect(runtimeExpression)
  const connect = async () => {
    await expect.poll(async () => {
      if (launchError) throw launchError
      return fetch(`${browserEndpoint}/json/version`, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false)
    }, { timeout: 30_000 }).toBe(true)
    browser = await chromium.connectOverCDP(browserEndpoint)
    await expect.poll(() => browser.contexts()[0]?.pages().length ?? 0).toBeGreaterThan(0)
    const page = browser.contexts()[0].pages()[0]
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-workspace-ready', 'true', { timeout: 30_000 })
    return page
  }
  const chooseDirectory = (directory) => inspect(`${electronModule}.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(directory)}] }); true`)
  try {
    let page = await connect()
    const before = await runtime()
    assert.equal(before.packaged, true)
    assert.equal(before.pid, child.pid)
    assert.equal(resolve(before.executable), executablePath)
    assert.equal(resolve(before.userData), userData)
    await page.getByTestId('nav-library').click()
    await expect(page.getByTestId('book-item')).toHaveCount(1)
    await page.getByTestId('book-item').click()
    await page.getByTestId('workspace-tab-reading').click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-session-tabs-state', 'ready')
    const bookId = (await page.evaluate(() => window.readerApi.listBooks()))[0].id
    const draft = page.locator('.right-sidebar [data-testid="followup-input"]')
    await draft.fill('自动重启恢复的草稿')
    await page.getByTestId('settings-button').click()
    await page.getByTestId('theme-dark').click()
    await page.getByTestId('settings-nav-backup').click()
    await chooseDirectory(backups)
    await page.getByTestId('backup-create').click()
    await expect(page.getByTestId('backup-success')).toContainText('备份已保存')
    const [backup] = await readdir(backups)
    assert.ok(backup)
    await page.getByTestId('settings-close').click()
    await draft.fill('恢复前的另一份草稿')
    await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookSession(id))?.draft, bookId)).toBe('恢复前的另一份草稿')
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-appearance').click()
    await page.getByTestId('theme-light').click()
    await page.getByTestId('settings-nav-backup').click()
    await chooseDirectory(join(backups, backup))
    await page.getByTestId('backup-select').click()
    await expect(page.getByTestId('backup-preview')).toContainText('1 本书')
    page.once('dialog', (dialog) => dialog.accept())
    const started = Date.now()
    await page.getByTestId('backup-restore').click()
    await expect.poll(() => exit, { timeout: 30_000 }).toEqual({ code: 0, signal: null })
    // No second spawn and no app.relaunch override: only the application can
    // create the new process, using its original executable and isolated profile.
    await expect.poll(async () => (await runtime().catch(() => null))?.pid ?? before.pid, { timeout: 30_000 }).not.toBe(before.pid)
    // The inspector listens before the application sets userData and opens its
    // database. Wait for the new renderer's workspace, then inspect that runtime.
    page = await connect()
    const after = await runtime()
    assert.notEqual(after.pid, before.pid)
    assert.equal(after.packaged, true)
    assert.equal(after.executable, before.executable)
    assert.equal(after.userData, before.userData)
    assert.equal(after.version, before.version)
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark')
    const restored = await page.evaluate(async (id) => ({ books: await window.readerApi.listBooks(), session: await window.readerApi.getBookSession(id) }), bookId)
    assert.equal(restored.books.length, 1)
    assert.equal(restored.books[0].id, bookId)
    assert.equal(restored.session.draft, '自动重启恢复的草稿')
    const state = JSON.parse(await readFile(join(userData, 'library-state.json'), 'utf8'))
    assert.match(state.current, /^restored-/u)
    assert.equal(state.pending, undefined)
    await page.screenshot({ path: screenshot })
    result = { passed: true, platform: process.platform, initialPid: before.pid, relaunchedPid: after.pid,
      originalExitCode: exit.code, elapsedMs: Date.now() - started, sameExecutable: true, sameProfile: true,
      automaticRelaunch: true, restoredBook: true, restoredDraft: true, restoredPreferences: true, pendingRestoreAcknowledged: true }
  } catch (error) { failure = error }
  finally {
    const closed = await Promise.allSettled([browser?.close()])
    if (closed[0].status === 'rejected') failure ??= closed[0].reason
    try {
      await stopOwnedProcesses(executablePath)
      await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch (error) { failure ??= error }
  }
  if (failure) throw failure
  return { ...result, isolatedTestDataRemoved: true }
}
