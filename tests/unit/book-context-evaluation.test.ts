import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { copyEvaluationProfile, readEvaluationProfile } from '../../scripts/real-provider-profile.mjs'
import { evaluationCases, evidence, measureAnswer } from '../../scripts/book-context-fixture.mjs'

describe('real book evaluation preparation', () => {
  it('copies only the selected encrypted profile and refuses to overwrite existing settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'llm-reader-eval-profile-'))
    expect(dirname(root)).toBe(resolve(tmpdir()))
    const source = join(root, 'source'), target = join(root, 'target')
    try {
      await mkdir(join(source, 'provider-keys'), { recursive: true })
      await mkdir(target)
      await writeFile(join(source, 'Local State'), '{"test":"encrypted-context"}')
      for (const id of ['one', 'two']) await writeFile(join(source, 'provider-keys', `${id}.bin`), `encrypted-test-${id}`)
      const sourceDatabase = new AppDatabase(join(source, 'reader.sqlite3'))
      try {
        for (const id of ['one', 'two']) sourceDatabase.createProviderProfile({ id, name: id, base_url: 'http://127.0.0.1', model: id, compatibility: id === 'two' ? 'opencode-go' : 'auto', is_active: id === 'one' ? 1 : 0, created_at: '1', updated_at: '1' })
      } finally { sourceDatabase.close() }
      new AppDatabase(join(target, 'reader.sqlite3')).close()
      expect(readEvaluationProfile(source).profile.id).toBe('one')
      const before = await readFile(join(source, 'reader.sqlite3'))
      await expect(copyEvaluationProfile(source, target, 'two')).resolves.toEqual({ id: 'two', name: 'two', model: 'two' })
      const copied = new AppDatabase(join(target, 'reader.sqlite3'))
      try { expect(copied.listProviderProfiles().map((profile) => [profile.id, profile.is_active, profile.compatibility])).toEqual([['two', 1, 'opencode-go']]) } finally { copied.close() }
      expect(await readFile(join(target, 'provider-keys', 'two.bin'), 'utf8')).toBe('encrypted-test-two')
      await expect(readFile(join(target, 'provider-keys', 'one.bin'))).rejects.toThrow()
      expect(await readFile(join(source, 'reader.sqlite3'))).toEqual(before)
      await expect(copyEvaluationProfile(source, target, 'one')).rejects.toThrow('拒绝覆盖')
      await expect(copyEvaluationProfile(source, source)).rejects.toThrow('独立用户数据')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('reads the legacy encrypted-key layout without migrating the source database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'llm-reader-eval-legacy-'))
    expect(dirname(root)).toBe(resolve(tmpdir()))
    try {
      const database = new DatabaseSync(join(root, 'reader.sqlite3'))
      try { database.exec("CREATE TABLE provider_settings(singleton INTEGER, base_url TEXT, model TEXT); INSERT INTO provider_settings VALUES(1, 'http://127.0.0.1', 'legacy-model')") } finally { database.close() }
      await writeFile(join(root, 'api-key.bin'), 'encrypted-test-only')
      await writeFile(join(root, 'Local State'), '{}')
      expect(readEvaluationProfile(root).profile).toMatchObject({ id: 'legacy', model: 'legacy-model' })
      expect(() => readEvaluationProfile(root, 'missing')).toThrow()
      expect(await readFile(join(root, 'api-key.bin'), 'utf8')).toBe('encrypted-test-only')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('measures retrieved and cited original evidence separately and leaves semantic grading to review', () => {
    const result = { answer: '双证门槛要求独立复核。[P2] 引用不存在。[P99]', context: { passages: [
      { id: 'P1', text: evidence.definition }, { id: 'P2', text: evidence.threshold }
    ] } }
    expect(measureAnswer(result, evaluationCases[0])).toMatchObject({ retrievedEvidence: ['definition'], citedEvidence: [], unknownCitations: ['P99'], manualReviewRequired: true })
    expect(measureAnswer(result, evaluationCases[2])).toMatchObject({ retrievedEvidence: ['threshold'], citedEvidence: ['threshold'] })
    expect(measureAnswer({ answer: '不知道。', context: { passages: [] } }, evaluationCases[4])).toMatchObject({ retrievedEvidence: [], manualReviewRequired: true })
  })
})
