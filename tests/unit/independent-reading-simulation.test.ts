import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createReadingSimulation, simulatedSearchPlan } from '../../scripts/independent-reading-simulation.mjs'

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

it('accepts only frozen PDF bytes, keeps independent jobs, and returns only the context-reader answer without usage', async () => {
  const output = await mkdtemp(join(tmpdir(), 'llm-reader-simulation-unit-'))
  const digital = Buffer.from('%PDF-1.7\nunit digital fixture only\n')
  const scanned = Buffer.from('%PDF-1.7\nunit scanned fixture only\n')
  const simulation = await createReadingSimulation({ output, files: [
    { key: 'digital', sha256: sha256(digital) }, { key: 'scanned', sha256: sha256(scanned) }
  ], waitMs: 5000 })
  const postJson = (body: unknown) => fetch(simulation.endpoint + '/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  const upload = async (bytes: Uint8Array, filename: string) => {
    const form = new FormData()
    form.append('files', new Blob([bytes], { type: 'application/pdf' }), filename)
    return fetch(simulation.endpoint + '/v1/convert/file/async', { method: 'POST', body: form })
  }
  try {
    // Byte identity, rather than a claimed filename or MIME type, selects the
    // known authored document. These are disposable unit buffers, not 12 runs.
    const first = await (await upload(digital, 'misleading-scanned-name.pdf')).json()
    const second = await (await upload(scanned, 'misleading-digital-name.pdf')).json()
    expect(first.task_id).toBe('simulation-pdf-1')
    expect(second.task_id).toBe('simulation-pdf-2')
    expect(first.task_id).not.toBe(second.task_id)
    expect(simulation.trace.uploads.map((item: { key: string; sha256: string }) => [item.key, item.sha256])).toEqual([
      ['digital', sha256(digital)], ['scanned', sha256(scanned)]
    ])
    const unknown = await upload(Buffer.from('%PDF-1.7\nnot frozen\n'), 'ridge-nursery-digital.pdf')
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toEqual({ error: 'UNRECOGNIZED_FROZEN_PDF' })
    expect(simulation.trace.uploads).toHaveLength(2)
    for (const job of [first.task_id, second.task_id]) {
      const status = await (await fetch(simulation.endpoint + '/v1/status/poll/' + job)).json()
      expect(status.task_status).toBe('success')
      const result = await (await fetch(simulation.endpoint + '/v1/result/' + job)).json()
      expect(Object.keys(result.document.json_content.pages)).toEqual(['1', '2', '3', '4'])
      expect(result.document.json_content.name).toContain('not OCR')
    }

    simulation.setCase('disposable-unit-turn')
    const input = { question: '运输延误的规则是什么？', books: [{ id: 'unit-book' }] }
    const planned = await (await postJson({ model: 'unit', messages: [
      { role: 'system', content: '为阅读问题生成检索规划。' }, { role: 'user', content: JSON.stringify(input) }
    ] })).json()
    expect(JSON.parse(planned.choices[0].message.content)).toEqual(simulatedSearchPlan(input))

    const reference = { passages: [{ id: 'P7', text: 'Only this supplied sentence is available to the unit reader.' }] }
    const messages = [
      { role: 'system', content: '你是阅读助手。' },
      { role: 'user', content: '本轮参考资料：\n' + JSON.stringify(reference) + '\n读者请求：复述提供的句子。' }
    ]
    const responsePromise = postJson({ model: 'unit', stream: true, messages })
    const requestPath = join(simulation.queue, 'request-001.json')
    let pending: { reference: unknown; question: string; messages: unknown; caseId: string }
    await vi.waitFor(async () => {
      pending = JSON.parse(await readFile(requestPath, 'utf8'))
    }, { timeout: 2000, interval: 20 })
    expect(pending!.reference).toEqual(reference)
    expect(pending!.messages).toEqual(messages)
    expect(pending!.question).toBe('复述提供的句子。')
    expect(pending!.caseId).toBe('disposable-unit-turn')
    const answer = '当前只提供了这一句话。[P7]'
    await writeFile(join(simulation.queue, 'answer-001.json'), JSON.stringify({ answer }) + '\n')
    const response = await responsePromise
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const stream = await response.text()
    const event = JSON.parse(stream.split('\n').find((line) => line.startsWith('data: {'))!.slice(6))
    expect(event.choices[0].delta.content).toBe(answer)
    expect(stream).toContain('data: [DONE]')
    expect(stream).not.toContain('"usage"')
    expect(event).not.toHaveProperty('usage')

    const trace = JSON.parse(await readFile(join(output, 'simulation-trace.json'), 'utf8'))
    expect(trace).toMatchObject({ mode: 'simulation', liveCalls: 0, simulatedPlanning: true,
      simulatedPdfParsing: true, actualOcrPerformed: false, usagePolicy: 'not-reported-no-token-counter',
      planner: { source: 'synthetic-planner', sha256: sha256(simulatedSearchPlan.toString()), frozenBeforeCalls: true } })
    expect(trace.plans).toHaveLength(1)
    expect(trace.answers).toHaveLength(1)
    expect(trace.answers[0]).toMatchObject({ contextSha256: sha256(JSON.stringify(reference)), answerSha256: sha256(answer), syntheticProvider: true })
  } finally {
    await simulation.close()
    await rm(output, { recursive: true, force: true })
  }
})
