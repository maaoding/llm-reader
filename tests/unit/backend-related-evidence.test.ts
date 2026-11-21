import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { AppDatabase } from '../../src/main/database'
import { BookContextStore } from '../../src/main/book-context-store'
import { documentSections } from '../../src/shared/document-structure'
import type { NormalizedDocument, Passage } from '../../src/shared/contracts'

const databases: AppDatabase[] = []
afterEach(() => { databases.splice(0).forEach((database) => database.close()); vi.restoreAllMocks() })

function setup(units: Array<{ id: string; text: string; relatedIds?: string[]; searchable?: boolean }>) {
  const database = new AppDatabase(':memory:')
  databases.push(database)
  const bookId = randomUUID(), store = new BookContextStore(database)
  database.insertBook({ id: bookId, sha256: 'a'.repeat(64), title: '关联证据', author: null, format: 'txt', sourceFormat: 'txt', originalName: 'fixture.txt', storedName: 'fixture.txt', importedAt: '2026-10-26', lastOpenedAt: null, lastLocator: null, progress: 0 })
  const document: NormalizedDocument = { version: 2, diagnostics: [],
    nodes: [{ id: 'chapter', title: '正文', kind: 'section', level: 1, parentId: null, order: 0, anchor: 'txt:0:0' }],
    units: units.map((unit, order) => ({ nodeId: 'chapter', order, kind: 'paragraph', relatedIds: [], searchable: true, ...unit,
      sources: [{ anchor: `txt:${order * 5000}:${order * 5000 + Array.from(unit.text).length}`, precision: 'text' }] })) }
  const sections = documentSections(document)
  store.prepare(bookId, randomUUID(), 'fixture')
  store.cacheDocument(bookId, document, sections.length)
  store.append(bookId, sections)
  return { store, bookId, document, originals: store.originals(bookId) }
}

describe('related source evidence', () => {
  it('preserves source order before adjacent blocks, excludes direct hits and ignores nonsearchable units', () => {
    const { store, bookId, document, originals } = setup([
      { id: 'body', text: '正文'.repeat(1900), relatedIds: ['later-note', 'hidden', 'early-note', 'later-note'] },
      { id: 'early-note', text: '较早的注释。', relatedIds: ['body'] },
      { id: 'hidden', text: '不可检索内容。', searchable: false },
      { id: 'later-note', text: '注'.repeat(1900), relatedIds: ['body'] }
    ])
    const hits = [originals.find((passage) => passage.blockId === 'body-b1')!, originals.find((passage) => passage.blockId === 'later-note-b0')!]
    const originalSnapshot = structuredClone(originals)
    const result = store.related(bookId, hits, document, originals)
    expect(result.map((passage) => passage.blockId)).toEqual(['early-note-b0', 'later-note-b1', 'body-b0', 'body-b2'])
    expect(result.every((passage) => passage.evidenceRole === 'extension')).toBe(true)
    expect(originals).toEqual(originalSnapshot)
    expect(hits.every((passage) => passage.evidenceRole === undefined)).toBe(true)
  })

  it('returns the first twelve new sources even when relation IDs are reversed or repeated', () => {
    const notes = Array.from({ length: 20 }, (_, index) => ({ id: `note-${index}`, text: `注释${index}` }))
    const { store, bookId, originals } = setup([
      { id: 'body', text: '正文', relatedIds: [...notes.map((note) => note.id).reverse(), 'note-0'] }, ...notes
    ])
    const result = store.related(bookId, [originals[0], originals[2]])
    expect(result.map((passage) => passage.blockId)).toEqual(notes.filter((note) => note.id !== 'note-1').slice(0, 12).map((note) => `${note.id}-b0`))
  })

  it('reuses a caller-supplied source snapshot without reading the document or originals again', () => {
    const { store, bookId, document, originals } = setup([{ id: 'body', text: '正文', relatedIds: ['note'] }, { id: 'note', text: '关联注释' }])
    const readStructure = vi.spyOn(store, 'structure'), readOriginals = vi.spyOn(store, 'originals')
    expect(store.related(bookId, [originals[0]], document, originals).map((passage) => passage.text)).toEqual(['关联注释'])
    expect(readStructure).not.toHaveBeenCalled()
    expect(readOriginals).not.toHaveBeenCalled()
  })

  it('returns no evidence for empty hits, missing documents or unknown units', () => {
    const { store, bookId, originals } = setup([{ id: 'body', text: '正文' }])
    const readStructure = vi.spyOn(store, 'structure'), readOriginals = vi.spyOn(store, 'originals')
    expect(store.related(bookId, [])).toEqual([])
    expect(readStructure).not.toHaveBeenCalled()
    expect(store.related(randomUUID(), originals)).toEqual([])
    expect(readOriginals).not.toHaveBeenCalled()
    const unknown: Passage = { ...originals[0], unitId: 'unknown' }
    expect(store.related(bookId, [unknown])).toEqual([])
  })
})
