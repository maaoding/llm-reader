/* global process, performance, URL, Buffer, AbortController, AbortSignal, fetch, Headers, Response */
import { _electron as electron } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve, basename } from 'node:path'
import { copyEvaluationProfile, evaluationSourceDirectory } from './real-provider-profile.mjs'

/** Evaluation only: keys stay encrypted on disk and are used only inside Electron's main process. */
export async function createEvaluationSession(directory = 'tmp/knowledge-hard-20260909') {
  const root = resolve(directory), userData = join(root, 'profile')
  if (dirname(root) !== resolve('tmp') || !basename(root).startsWith('knowledge-hard-')) throw new Error('Invalid evaluation directory')
  await mkdir(root, { recursive: true })
  let application
  const launch = async () => {
    application = await electron.launch({ args: ['.'], env: { ...process.env, LLM_READER_USER_DATA: userData,
      LLM_READER_E2E_IMPORT: '', LLM_READER_UPDATER_DISABLED: '1' } })
    await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide())
  }
  if (!existsSync(join(root, 'initialized.json'))) {
    if (existsSync(join(userData, 'reader.sqlite3'))) throw new Error('Unrecognized evaluation profile; refusing to overwrite it')
    await launch(); await application.close(); application = undefined
    const source = evaluationSourceDirectory()
    await copyEvaluationProfile(source, userData, process.env.LLM_READER_REAL_API_PROFILE_ID)
    const target = new DatabaseSync(join(userData, 'reader.sqlite3'))
    try {
      const cryptoContext = JSON.parse(await readFile(join(source, 'Local State'), 'utf8')).os_crypt
      for (const kind of ['embedding', 'rerank', 'document']) {
        const profile = resolve(process.env[`LLM_READER_EVAL_${kind.toUpperCase()}_SOURCE_USER_DATA`] ?? source)
        if (JSON.stringify(JSON.parse(await readFile(join(profile, 'Local State'), 'utf8')).os_crypt) !== JSON.stringify(cryptoContext)) throw new Error('Credential encryption context differs')
        const database = new DatabaseSync(join(profile, 'reader.sqlite3'), { readOnly: true })
        try {
          const row = database.prepare('SELECT * FROM knowledge_settings WHERE kind = ?').get(kind)
          if (!row?.secret) throw new Error(`Authorized ${kind} credential is unavailable; configure LLM_READER_EVAL_${kind.toUpperCase()}_SOURCE_USER_DATA`)
          const config = JSON.parse(row.config_json)
          if (config.baseUrl !== (kind === 'document' ? 'https://mineru.net' : 'https://api.siliconflow.cn/v1')) throw new Error('Unexpected credential endpoint')
          target.prepare('INSERT OR REPLACE INTO knowledge_settings(kind, config_json, secret, revision) VALUES (?, ?, ?, ?)')
            .run(kind, row.config_json, row.secret, row.revision)
        } finally { database.close() }
      }
    } finally { target.close() }
    await writeFile(join(root, 'initialized.json'), JSON.stringify({ createdAt: new Date().toISOString(), personalBooks: false }) + '\n', 'utf8')
  }
  await launch()
  const page = await application.firstWindow()
  const trace = []
  const fetcher = (kind) => async (input, init = {}) => {
    const id = randomUUID(), url = String(input), started = performance.now()
    init.signal?.throwIfAborted()
    const abort = () => { void application.evaluate((_, requestId) => globalThis.__evaluationRequests?.get(requestId)?.abort(), id).catch(() => undefined) }
    init.signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await application.evaluate(async ({ app, safeStorage }, request) => {
        const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
        const { readFileSync } = process.getBuiltinModule('node:fs')
        const { join } = process.getBuiltinModule('node:path')
        const root = app.getPath('userData'), database = new DatabaseSync(join(root, 'reader.sqlite3'), { readOnly: true })
        let key
        try {
          if (request.kind === 'qa') {
            const profile = database.prepare('SELECT id, base_url FROM provider_profiles WHERE is_active = 1').get()
            if (new URL(profile.base_url).origin !== 'https://opencode.ai') throw new Error('Unexpected QA endpoint')
            const encrypted = readFileSync(join(root, 'provider-keys', profile.id + '.bin'))
            const magic = Buffer.from('LLMRKEY1', 'ascii')
            if (encrypted.length <= magic.length || encrypted.length > 64 * 1024 || !encrypted.subarray(0, magic.length).equals(magic)) {
              throw new Error('Invalid evaluation credential envelope')
            }
            key = safeStorage.decryptString(encrypted.subarray(magic.length))
          } else {
            const row = database.prepare('SELECT secret FROM knowledge_settings WHERE kind = ?').get(request.kind)
            key = safeStorage.decryptString(Buffer.from(row.secret))
          }
        } finally { database.close() }
        const url = new URL(request.url)
        const allowed = request.kind === 'qa' ? url.origin === 'https://opencode.ai' && url.pathname.startsWith('/zen/go/v1/') :
          request.kind === 'document' ? url.origin === 'https://mineru.net' && url.pathname.startsWith('/api/v4/') :
            url.origin === 'https://api.siliconflow.cn' && url.pathname.startsWith('/v1/')
        if (!allowed || url.username || url.password || url.hash) throw new Error('Unexpected evaluation request endpoint')
        const controller = new AbortController()
        globalThis.__evaluationRequests ??= new Map()
        globalThis.__evaluationRequests.set(request.id, controller)
        try {
          const headers = { ...request.headers, Authorization: `Bearer ${key}`, 'User-Agent': `LLM-Reader/${app.getVersion()}` }
          key = ''
          const response = await fetch(url, { method: request.method, headers, body: request.body,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]), redirect: 'manual' })
          const reader = response.body?.getReader(), chunks = []
          let length = 0
          if (reader) while (true) {
            const result = await reader.read()
            if (result.done) break
            length += result.value.byteLength
            if (length > 8_000_000) { await reader.cancel(); throw new Error('Evaluation response too large') }
            chunks.push(result.value)
          }
          return { status: response.status, contentType: response.headers.get('content-type') ?? '', text: Buffer.concat(chunks).toString('utf8') }
        } finally { globalThis.__evaluationRequests.delete(request.id) }
      }, { id, kind, url, method: init.method ?? 'GET', body: init.body === undefined ? undefined : String(init.body),
        headers: Object.fromEntries([...new Headers(init.headers)].filter(([name]) => name.toLowerCase() !== 'authorization')) })
      init.signal?.throwIfAborted()
      trace.push({ kind, path: new URL(url).pathname, status: response.status, elapsedMs: Math.round(performance.now() - started) })
      return new Response(response.text, { status: response.status, headers: { 'content-type': response.contentType } })
    } catch {
      trace.push({ kind, path: new URL(url).pathname, status: 'failed', elapsedMs: Math.round(performance.now() - started) })
      init.signal?.throwIfAborted()
      throw new Error('Evaluation transport failed')
    } finally { init.signal?.removeEventListener('abort', abort) }
  }
  return { root, userData, application, page, fetcher, trace, close: () => application.close() }
}
