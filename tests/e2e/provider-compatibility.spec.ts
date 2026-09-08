import { expect, test, type ElectronApplication } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, restartReader } from './support/electron-app'
import type {} from '../../src/renderer/src/global'

let server: Server, endpoint: string
const requests: Array<{ sessionId: string | undefined; userAgent: string | undefined; path: string }> = []
test.beforeAll(async () => {
  server = createServer((request, response) => {
    const sessionId = request.headers['x-opencode-session'] as string | undefined
    requests.push({ sessionId, userAgent: request.headers['user-agent'], path: request.url! })
    request.resume()
    request.on('end', () => {
      const ordinary = request.url?.startsWith('/plain/')
      const missing = !ordinary && !sessionId
      response.writeHead(missing ? 400 : 200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(missing ? { error: 'missing x-opencode-session' }
        : request.url?.endsWith('/models') ? { data: [{ id: 'go-fixture-model' }] }
          : { choices: [{ message: { content: 'OK' } }] }))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local endpoint unavailable')
  endpoint = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()))
})

test('Go proxy drafts, profile switching and persisted settings work in both themes and window sizes', async () => {
  test.setTimeout(90_000)
  const workspace = await createE2eWorkspace('llm-reader-go-settings-')
  let application: ElectronApplication | undefined
  try {
    let launched = await launchReader({ userData: workspace.userData })
    application = launched.application
    let page = launched.page
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-model').click()
    await expect(page.getByTestId('provider-compatibility')).toHaveValue('auto')
    await page.getByTestId('provider-profile-name').fill('Go 中转')
    await page.getByTestId('provider-base-url').fill(endpoint)
    await page.getByTestId('provider-model').fill('go-fixture-model')
    await page.getByTestId('provider-api-key').fill('local-fixture-only')
    await page.getByTestId('provider-compatibility').selectOption('opencode-go')
    await page.getByTestId('provider-test').click()
    await expect(page.getByTestId('provider-status')).toContainText('连接成功')
    expect((await page.evaluate(() => window.readerApi.getProviderOverview())).profiles).toHaveLength(0)
    await page.getByTestId('provider-models-fetch').click()
    await expect(page.locator('#provider-model-options option')).toHaveCount(1)
    await page.getByTestId('provider-compatibility').selectOption('auto')
    await expect(page.locator('#provider-model-options option')).toHaveCount(0)
    await expect(page.getByTestId('provider-models-status')).toHaveCount(0)
    await page.getByTestId('provider-test').click()
    await expect(page.getByTestId('provider-status')).toContainText('会话标识')
    await page.getByTestId('provider-compatibility').selectOption('opencode-go')
    await page.getByTestId('provider-save').click()
    await expect(page.getByTestId('provider-dirty-hint')).toHaveCount(0)
    const goId = await page.getByTestId('provider-profile').inputValue()
    await page.getByTestId('provider-activate').click()
    await expect(page.getByTestId('provider-connection-status')).toHaveAttribute('aria-label', 'API 连接正常')
    await page.getByTestId('provider-compatibility').selectOption('auto')
    await expect(page.getByTestId('provider-dirty-hint')).toBeVisible()
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByTestId('provider-new').click()
    await expect(page.getByTestId('provider-profile')).toHaveValue(goId)
    await page.getByTestId('provider-compatibility').selectOption('opencode-go')
    await page.getByTestId('provider-new').click()
    await expect(page.getByTestId('provider-compatibility')).toHaveValue('auto')
    await page.getByTestId('provider-profile-name').fill('普通接口')
    await page.getByTestId('provider-base-url').fill(`${endpoint}/plain`)
    await page.getByTestId('provider-api-key').fill('ordinary-fixture-only')
    await page.getByTestId('provider-save').click()
    await page.getByTestId('provider-activate').click()
    await expect(page.getByTestId('provider-connection-status')).toHaveAttribute('aria-label', 'API 连接正常')
    await expect.poll(() => requests.some((request) => request.path.startsWith('/plain/') && !request.sessionId)).toBe(true)
    await page.getByTestId('provider-profile').selectOption(goId)
    await expect(page.getByTestId('provider-compatibility')).toHaveValue('opencode-go')
    await page.getByTestId('provider-activate').click()
    await expect(page.getByTestId('provider-connection-status')).toHaveAttribute('aria-label', 'API 连接正常')

    launched = await restartReader(application, { userData: workspace.userData })
    application = launched.application
    page = launched.page
    await page.getByTestId('settings-button').click()
    await page.getByTestId('settings-nav-model').click()
    await expect(page.getByTestId('provider-compatibility')).toHaveValue('opencode-go')
    for (const theme of ['light', 'dark']) {
      await page.getByTestId('settings-nav-appearance').click()
      await page.getByTestId(`theme-${theme}`).click()
      await page.getByTestId('settings-nav-model').click()
      for (const [width, height] of [[1440, 900], [940, 600]]) {
        await application.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setSize(size[0], size[1]) }, [width, height])
        await page.getByTestId('provider-compatibility').scrollIntoViewIfNeeded()
        await expect(page.getByTestId('provider-compatibility')).toBeVisible()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`go-settings-${theme}-${width}.png`) })
        await page.getByTestId('provider-compatibility').selectOption('auto')
        await expect(page.getByTestId('provider-dirty-hint')).toBeVisible()
        await page.getByTestId('provider-compatibility').selectOption('opencode-go')
        await page.getByTestId('provider-test').click()
        await expect(page.getByTestId('provider-status')).toContainText('连接成功')
        await page.getByTestId('provider-save').click()
        await expect(page.getByTestId('provider-dirty-hint')).toHaveCount(0)
        await expect(page.getByTestId('provider-save')).toBeVisible()
        await page.screenshot({ path: test.info().outputPath(`go-settings-${theme}-${width}-actions.png`) })
      }
    }
    const version = await application.evaluate(({ app }) => app.getVersion())
    expect(requests.every((request) => request.userAgent === `LLM-Reader/${version}`)).toBe(true)
    const sessions = requests.flatMap((request) => request.sessionId ? [request.sessionId] : [])
    expect(sessions.every((id) => /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(id))).toBe(true)
    expect(new Set(sessions).size).toBe(sessions.length)
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})
