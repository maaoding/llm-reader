import { expect, test } from './support/reader-test'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContextSnapshot } from '../../src/shared/contracts'
import { enterReading, hidePreparation, showLibrary, showPreparation } from './support/workspace'

const original = 'This handbook reports no measured percentage improvement in germination.'

test.describe('single-book evidence', () => {
  test.use({ importText: `Chapter 1\n\n${original}\n\nStorage logs contain dates and container labels.` })

  for (const mode of ['translated', 'empty', 'failed'] as const) {
    test(`${mode} plan: preserves the actual evidence through answering, citations and archiving`, async ({ reader: { page } }) => {
      let planningCalls = 0
      const answers: Array<{ system: string; reference: ContextSnapshot }> = []
      const server = createServer((request, response) => {
        let raw = ''
        request.setEncoding('utf8')
        request.on('data', (chunk) => { raw += chunk })
        request.on('end', () => {
          const body = JSON.parse(raw) as { messages: Array<{ content: string }> }
          const system = body.messages[0].content
          let content = 'OK'
          if (system.includes('为阅读问题')) {
            planningCalls++
            if (mode === 'failed') {
              response.writeHead(503, { 'content-type': 'application/json' })
              response.end(JSON.stringify({ error: 'Synthetic planner unavailable' }))
              return
            }
            content = JSON.stringify({ chapters: [], terms: mode === 'translated' ? ['germination'] : [] })
          } else if (system.includes('你是阅读助手')) {
            const reference = JSON.parse(body.messages.at(-1)!.content.split('\n')[1]) as ContextSnapshot
            answers.push({ system, reference })
            const source = reference.passages.find((passage) => passage.text.includes(original))
            // Deterministic fixture answers test transport/rendering, not model quality.
            content = source ? `手册明确没有报告测得的提升百分比。[${source.id}]` : '本轮未取得相关书内原文，暂时无法判断。'
          }
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ choices: [{ message: { content } }] }))
        })
      })
      try {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Missing local fixture endpoint')
        await page.evaluate(async (baseUrl) => {
          const result = await window.readerApi.createProviderProfile({ name: '隔离取材测试', baseUrl, model: 'retrieval-fixture', apiKey: 'synthetic-only', compatibility: 'auto' })
          await window.readerApi.activateProviderProfile(result.profiles[0].id)
        }, `http://127.0.0.1:${address.port}`)
        await page.reload()
        await showLibrary(page)
        await page.getByTestId('book-item').first().click()
        await enterReading(page)
        const bookId = await page.evaluate(async () => (await window.readerApi.listBooks())[0].id)
        await showPreparation(page)
        await page.getByTestId('document-prepare').click()
        await expect(page.getByTestId('document-status')).toHaveText('原文已就绪')
        await hidePreparation(page)
        await page.getByTestId('scope-book').click()
        const question = `${Array.from({ length: 80 }, (_, index) => `背景${index}`).join('，')}。发芽率提高了百分之多少？`
        const input = page.getByTestId('followup-input')
        await input.click()
        await input.fill(question)
        await expect(input).toHaveValue(question)
        await page.getByTestId('send-question').click()
        const answer = page.getByTestId('answer-current')
        await expect(answer).toContainText(mode === 'translated' ? '手册明确没有报告' : '本轮未取得相关书内原文')
        await expect(page.getByTestId('cancel-request')).toHaveCount(0)
        expect(planningCalls).toBe(1)
        expect(answers).toHaveLength(1)
        expect(answers[0].reference.coverage.covered).toBe(0)
        expect(answers[0].system).toContain('不能据此断言全书没有')
        if (mode === 'translated') {
          expect(answers[0].reference.passages.some((passage) => passage.text.includes(original))).toBe(true)
          await expect(answer.getByTestId('citation-valid')).toHaveCount(1)
          await answer.getByTestId('citation-valid').click()
          await expect(page.getByTestId('reader-host')).toContainText(original)
          await expect(page.getByTestId('reader-return-button')).toBeEnabled()
        } else {
          expect(answers[0].reference.passages).toEqual([])
          expect(answers[0].system).toContain('本轮没有提供书内原文')
          await expect(answer.getByTestId('citation-valid')).toHaveCount(0)
        }
        await page.getByTestId('answer-save').click()
        await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.listInsights(id)).length, bookId)).toBe(1)
        const saved = await page.evaluate(async (id) => (await window.readerApi.listInsights(id))[0], bookId)
        expect(saved.context?.passages.map(({ id, text }) => ({ id, text })))
          .toEqual(answers[0].reference.passages.map(({ id, text }) => ({ id, text })))
        expect(saved.context?.coverage.covered).toBe(0)
        await page.screenshot({ path: test.info().outputPath(`retrieval-${mode}.png`) })
      } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    })
  }
})

test('preserves cross-book evidence and saved citations when optional book IDs are malformed', async ({ reader: { application, page, workspace } }) => {
  const titles = ['Archive handbook', 'Courier addendum']
  const arrival = 'The archive hold begins with physical arrival of the sealed lot.'
  const dispatch = 'Courier transit is limited to two days after dispatch.'
  const paths = titles.map((title) => join(workspace.root, `${title}.txt`))
  await writeFile(paths[0], `Archive handbook\n\nThe archive hold lasts seven days.\n\n${arrival}`, 'utf8')
  await writeFile(paths[1], `Courier addendum\n\n${dispatch}`, 'utf8')
  let planningCalls = 0
  const answers: ContextSnapshot[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      const body = JSON.parse(raw) as { messages: Array<{ content: string }> }
      const system = body.messages[0].content
      let content = 'OK'
      if (system.includes('为阅读问题')) {
        planningCalls++
        const input = JSON.parse(body.messages[1].content) as { books: Array<{ id: string }> }
        content = JSON.stringify({ chapters: [], terms: ['archive hold', 'physical arrival', 'courier transit', 'dispatch'],
          books: input.books.map(({ id }) => ({ id })) })
      } else if (system.includes('你是阅读助手')) {
        const context = JSON.parse(body.messages.at(-1)!.content.split('\n')[1]) as ContextSnapshot
        answers.push(context)
        const first = context.passages.find((passage) => passage.text.includes(arrival))
        const second = context.passages.find((passage) => passage.text.includes(dispatch))
        // A deterministic answer checks evidence transport and citations, not model quality.
        content = first && second ? `档案从实际到达起算。[${first.id}]\n\n快递从发运起算。[${second.id}]` : '本轮依据不足。'
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing local fixture endpoint')
    await showLibrary(page)
    await application.evaluate(({ dialog }, filePaths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths }) }, paths)
    await page.getByTestId('import-book').click()
    await expect(page.getByTestId('book-import-summary')).toContainText('已导入 2 本')
    await page.getByTestId('book-import-close').click()
    const bookIds = await page.evaluate(async (baseUrl) => {
      const overview = await window.readerApi.createProviderProfile({ name: '隔离多书取材测试', baseUrl, model: 'retrieval-fixture', apiKey: 'synthetic-only' })
      await window.readerApi.activateProviderProfile(overview.profiles[0].id)
      return (await window.readerApi.listBooks()).map((book) => book.id)
    }, `http://127.0.0.1:${address.port}`)
    for (const bookId of bookIds) {
      await page.evaluate((id) => window.readerApi.prepareBookDocument({ bookId: id }), bookId)
      await expect.poll(() => page.evaluate(async (id) => (await window.readerApi.getBookAnalysis(id)).document?.status, bookId)).toBe('ready')
    }
    await page.reload()
    await page.getByTestId('nav-archives').click()
    await page.getByTestId('nav-workbenches').click()
    await page.getByTestId('workbench-new').click()
    await page.getByTestId('workbench-name').fill('规划格式回退验证')
    await page.getByRole('button', { name: '创建工作台', exact: true }).click()
    for (const title of titles) await page.getByRole('checkbox', { name: title }).check()
    await page.getByTestId('workbench-question').fill('档案留置和快递运输分别从何时起算？')
    await page.getByTestId('workbench-send').click()
    const turn = page.getByTestId('workbench-turn')
    await expect(turn).toContainText('档案从实际到达起算')
    await expect(turn).toContainText('快递从发运起算')
    await expect(turn.getByTestId('citation-valid')).toHaveCount(2)
    expect(planningCalls).toBe(1)
    expect(answers).toHaveLength(1)
    expect(new Set(answers[0].passages.map((passage) => passage.bookId))).toEqual(new Set(bookIds))
    await turn.getByTestId('citation-valid').filter({ hasText: titles[0] }).click()
    await expect(page.getByTestId('reader-host')).toContainText(arrival)
    await page.getByTestId('nav-archives').click()
    await page.getByTestId('nav-workbenches').click()
    await expect.poll(() => page.evaluate(async () => (await window.readerApi.listWorkbenches())[0].turns[0].status)).toBe('completed')
    const saved = await page.evaluate(async () => (await window.readerApi.listWorkbenches())[0].turns[0])
    // Model payloads omit navigation metadata; saved snapshots must retain it.
    expect(saved.context?.passages).toMatchObject(answers[0].passages)
    expect(saved.context?.passages.every((passage) => passage.anchor.startsWith('txt:') && Boolean(passage.sources?.length))).toBe(true)
    await page.reload()
    await expect(page.getByTestId('workbench-turn').getByTestId('citation-valid')).toHaveCount(2)
    await page.screenshot({ path: test.info().outputPath('retrieval-malformed-books.png') })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
