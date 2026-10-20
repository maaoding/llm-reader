import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { copyConfiguration, inspectConfiguration, measureIndependentAnswer, sha256, verifyFixtureFiles } from '../../scripts/independent-reading-evaluation.mjs'

describe('independent reading evaluation', () => {
  it('copies only the selected routing configuration and ciphertext into an empty profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-independent-config-'))
    const source = join(root, 'source'), target = join(root, 'target')
    await mkdir(source)
    await mkdir(target)
    try {
      const database = new AppDatabase(join(source, 'reader.sqlite3'))
      try {
        for (const id of ['active', 'selected']) database.connection.prepare('INSERT INTO provider_profiles(id,name,base_url,model,is_active,created_at,updated_at,compatibility,protocol,request_json,headers_secret) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, id, 'https://fixture.invalid/v1', `${id}-model`, id === 'active' ? 1 : 0, '1', '1', 'auto', 'anthropic', '{"timeoutMs":45000}', Buffer.from('synthetic-encrypted-header'))
        database.connection.prepare('INSERT INTO knowledge_settings(kind,config_json,secret,headers_secret,revision) VALUES (?,?,?,?,?)')
          .run('document', '{"enabled":true,"processor":"docling","baseUrl":"http://127.0.0.1:6001","ocr":true,"language":"en"}', null, null, 'fixture-revision')
      } finally { database.close() }
      await writeFile(join(source, 'Local State'), '{"synthetic":"context-only"}')
      new AppDatabase(join(target, 'reader.sqlite3')).close()
      const before = await readFile(join(source, 'reader.sqlite3'))
      expect(inspectConfiguration(source, 'missing')).toMatchObject({ ready: false, reasons: ['SAVED_MODEL_PROFILE_MISSING'] })
      expect(inspectConfiguration(source, 'selected')).toMatchObject({ ready: true, model: 'selected-model', documentProcessor: 'docling' })
      await copyConfiguration(source, target, 'selected')
      const copied = new AppDatabase(join(target, 'reader.sqlite3'))
      try {
        const profiles = copied.connection.prepare('SELECT id,is_active,protocol,request_json,headers_secret FROM provider_profiles').all()
        expect(profiles).toHaveLength(1)
        expect(profiles[0]).toMatchObject({ id: 'selected', is_active: 1, protocol: 'anthropic', request_json: '{"timeoutMs":45000}' })
        expect(Buffer.from(profiles[0].headers_secret as Uint8Array).toString()).toBe('synthetic-encrypted-header')
        expect(copied.connection.prepare('SELECT count(*) AS n FROM books').get()?.n).toBe(0)
      } finally { copied.close() }
      expect(await readFile(join(source, 'reader.sqlite3'))).toEqual(before)
      await expect(copyConfiguration(source, target, 'selected')).rejects.toThrow('not empty')
      await expect(copyConfiguration(source, source, 'selected')).rejects.toThrow('isolated')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('detects modified fixture bytes and refuses paths outside the fixture directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reader-independent-files-'))
    try {
      await writeFile(join(root, 'sample.epub'), 'frozen sample')
      const manifest = { files: [{ key: 'epub', path: 'sample.epub', sha256: sha256('frozen sample') }] }
      expect(await verifyFixtureFiles(manifest, root)).toEqual([])
      await writeFile(join(root, 'sample.epub'), 'modified sample')
      expect(await verifyFixtureFiles(manifest, root)).toEqual(['epub:HASH_MISMATCH'])
      expect(await verifyFixtureFiles({ files: [{ key: 'escape', path: '../outside', sha256: '' }] }, root)).toEqual(['escape:INVALID_PATH'])
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('separates evidence recall, citations, cross-book provenance and semantic review', () => {
    const evidence = [{ id: 'E01', bookKey: 'epub', quote: 'Seven days.' }, { id: 'D01', bookKey: 'digital', quote: 'Two days.' }]
    const item = { bookKeys: ['epub', 'digital'], expectedEvidence: ['E01', 'D01'], expectedFacts: ['seven'], answerable: true }
    const result = { answer: 'seven [P1] [P99]', context: { bookId: 'epub-id', passages: [
      { id: 'P1', bookId: 'epub-id', text: 'Seven\n days.' },
      { id: 'P2', bookId: 'wrong-book', text: 'Two days.' }
    ] } }
    expect(measureIndependentAnswer(result, item, evidence, { epub: 'epub-id', digital: 'digital-id' })).toMatchObject({
      retrievedEvidence: ['E01'], citedEvidence: ['E01'], unknownCitations: ['P99'], unexpectedBookPassages: ['P2'],
      manualReviewRequired: true, review: { conclusionSupported: null, refusalAppropriate: null }
    })
    const absent = measureIndependentAnswer({ answer: 'No evidence.', context: { bookId: 'epub-id', passages: [] } },
      { bookKeys: ['epub'], expectedEvidence: [], expectedFacts: [], answerable: false }, evidence, { epub: 'epub-id' })
    expect(absent).not.toHaveProperty('passed')
    expect(absent.review.refusalAppropriate).toBeNull()
  })
})
