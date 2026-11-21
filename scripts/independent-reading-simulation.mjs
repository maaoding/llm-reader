/* global process, Buffer, Request */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pdfPages } from './independent-reading-fixture.mjs'
import { buildSimulatedDoclingDocument } from './independent-reading-docling.mjs'

/** General query translation only; no expected answers, evidence IDs or numeric rules. */
export function simulatedSearchPlan(input) {
  const question = String(input.question ?? '')
  const english = [...question.matchAll(/[A-Za-z]+(?:[- ][A-Za-z]+)*/gu)].map((match) => match[0].trim())
  const dictionary = [
    [/湿度/u, 'humidity'], [/休眠/u, 'dormant'], [/野生/u, 'wild-origin'], [/稳定/u, 'stable'],
    [/干燥|储存/u, 'storage'], [/补水/u, 'hydration'], [/种皮/u, 'seed coat'], [/批准/u, 'approved'],
    [/留置/u, 'hold'], [/起算|到达/u, 'arrival'], [/档案/u, 'archive'], [/运输|快递/u, 'courier transit'],
    [/配送|发运/u, 'dispatch'], [/天气|延误/u, 'weather-delay'], [/工作台/u, 'bench'], [/校准/u, 'calibration'],
    [/储备/u, 'reserve packs'], [/信封/u, 'envelopes'], [/条码/u, 'barcode'], [/替换/u, 'replacement'],
    [/核对|顺序/u, 'reconcile'], [/改善|改进/u, 'improvement'], [/损耗率/u, 'loss rate'], [/萌发/u, 'germination']
  ]
  const terms = [...new Set([...english, ...dictionary.filter(([pattern]) => pattern.test(question)).map(([, term]) => term)])].slice(0, 8)
  return { chapters: [], terms, ...(input.books ? { books: input.books.map((book) => book.id) } : {}) }
}

const digest = (value) => createHash('sha256').update(value).digest('hex')

/** Loopback-only protocol simulation. Final answers come only from a context-only file queue. */
export async function createReadingSimulation({ output, files, waitMs = 540_000 }) {
  const queue = join(output, 'queue')
  await mkdir(queue, { recursive: true })
  const trace = { mode: 'simulation', liveCalls: 0, simulatedPlanning: true, simulatedPdfParsing: true,
    actualOcrPerformed: false, usagePolicy: 'not-reported-no-token-counter', elapsedIncludesAssistantWait: true,
    planner: { source: 'synthetic-planner', sha256: digest(simulatedSearchPlan.toString()), frozenBeforeCalls: true },
    documentSource: 'fixture-docling', answerSource: 'assistant-interactive', uploads: [], plans: [], answers: [] }
  const jobs = new Map()
  let sequence = 0
  let currentCaseId = null
  let closed = false
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(value))
  }
  const saveTrace = () => writeFile(join(output, 'simulation-trace.json'), JSON.stringify(trace, null, 2) + '\n')
  const server = createServer(async (request, response) => {
    try {
      const chunks = []
      let length = 0
      for await (const chunk of request) {
        length += chunk.length
        if (length > 16_000_000) { json(response, { error: 'SIMULATION_REQUEST_TOO_LARGE' }, 413); return }
        chunks.push(chunk)
      }
      const raw = Buffer.concat(chunks)
      const path = request.url ?? ''
      if (path === '/openapi.json') { json(response, { paths: { '/v1/convert/file/async': { post: {} } } }); return }
      if (path === '/v1/models') { json(response, { data: [{ id: 'assistant-context-only-simulation' }] }); return }
      if (path === '/v1/convert/file/async' && request.method === 'POST') {
        const form = await new Request('http://127.0.0.1/simulation-upload', { method: 'POST',
          headers: { 'content-type': request.headers['content-type'] ?? '' }, body: raw }).formData()
        const upload = form.get('files')
        if (!upload || typeof upload === 'string') { json(response, { error: 'PDF_UPLOAD_MISSING' }, 400); return }
        const bytes = Buffer.from(await upload.arrayBuffer())
        const sha256 = digest(bytes)
        const file = files.find((entry) => ['digital', 'scanned'].includes(entry.key) && entry.sha256 === sha256)
        if (!file) { json(response, { error: 'UNRECOGNIZED_FROZEN_PDF' }, 400); return }
        const id = `simulation-pdf-${jobs.size + 1}`
        jobs.set(id, file.key)
        trace.uploads.push({ taskId: id, key: file.key, uploadedFilename: upload.name, bytes: bytes.length, sha256,
          simulation: 'Docling document synthesized from the frozen pdfPages, not PDF parsing or OCR' })
        await saveTrace()
        json(response, { task_id: id }); return
      }
      const status = /^\/v1\/status\/poll\/(simulation-pdf-\d+)$/u.exec(path)
      if (status) { json(response, { task_status: jobs.has(status[1]) ? 'success' : 'failure' }); return }
      const document = /^\/v1\/result\/(simulation-pdf-\d+)$/u.exec(path)
      if (document) {
        if (!jobs.has(document[1])) { json(response, { error: 'UNKNOWN_DOCUMENT_JOB' }, 404); return }
        json(response, { status: 'success', document: { json_content: buildSimulatedDoclingDocument(pdfPages) } }); return
      }
      if (path !== '/v1/chat/completions' || request.method !== 'POST') { json(response, { error: 'UNKNOWN_SIMULATION_ROUTE' }, 404); return }
      const body = JSON.parse(raw.toString('utf8'))
      const system = String(body.messages?.[0]?.content ?? '')
      if (system.includes('为阅读问题')) {
        const input = JSON.parse(body.messages.at(-1).content)
        const plan = simulatedSearchPlan(input)
        trace.plans.push({ caseId: currentCaseId, question: input.question, plan, method: 'fixed general bilingual keyword mapping' })
        await saveTrace()
        json(response, { model: body.model, choices: [{ message: { content: JSON.stringify(plan) } }] }); return
      }
      if (!system.includes('你是阅读助手')) {
        json(response, { model: body.model, choices: [{ message: { content: 'Local protocol simulation is connected.' } }] }); return
      }
      const content = body.messages.at(-1).content
      const reference = JSON.parse(content.split('\n')[1])
      const question = content.split('\n读者请求：').at(-1).trim()
      const number = String(++sequence).padStart(3, '0')
      const requestPath = join(queue, `request-${number}.json`)
      const responsePath = join(queue, `answer-${number}.json`)
      const textPath = join(queue, `answer-${number}.txt`)
      const started = Date.now()
      const pending = { number, caseId: currentCaseId, question, reference, messages: body.messages,
        instructions: 'Answer only from this actual reference. Do not read the fixture, gold evidence or expected facts. State missing evidence and cite only passage IDs present here.',
        answerFile: responsePath, syntheticProvider: true, createdAt: new Date().toISOString() }
      await writeFile(requestPath + '.tmp', JSON.stringify(pending, null, 2) + '\n')
      await rename(requestPath + '.tmp', requestPath)
      process.stdout.write(`SIMULATION_PENDING ${currentCaseId ?? number} ${requestPath}\n`)
      while (!closed && !response.destroyed && Date.now() - started < waitMs) {
        let answer
        try { answer = JSON.parse(await readFile(responsePath, 'utf8')).answer } catch {
          try { answer = await readFile(textPath, 'utf8') } catch { /* Wait for the context-only reader. */ }
        }
        if (typeof answer === 'string' && answer.trim()) {
          trace.answers.push({ number, caseId: pending.caseId, answerFile: responsePath, elapsedIncludingAssistantWaitMs: Date.now() - started,
            contextSha256: digest(JSON.stringify(reference)), answerSha256: digest(answer), syntheticProvider: true })
          await saveTrace()
          if (body.stream) {
            response.writeHead(200, { 'content-type': 'text/event-stream' })
            response.write(`data: ${JSON.stringify({ model: body.model, choices: [{ delta: { content: answer.trim() } }] })}\n\n`)
            response.end('data: [DONE]\n\n')
          } else json(response, { model: body.model, choices: [{ message: { content: answer.trim() } }] })
          return
        }
        await delay(200)
      }
      if (!response.destroyed) json(response, { error: 'SIMULATION_READER_TIMEOUT' }, 504)
    } catch {
      if (!response.destroyed) json(response, { error: 'SIMULATION_PROTOCOL_ERROR' }, 500)
    }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('SIMULATION_LISTENER_FAILED')
  await saveTrace()
  return { endpoint: `http://127.0.0.1:${address.port}`, queue, trace,
    setCase: (id) => { currentCaseId = id },
    close: async () => { closed = true; server.closeAllConnections(); await new Promise((done) => server.close(done)); await saveTrace() } }
}
