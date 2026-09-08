import { randomUUID } from 'node:crypto'
import type { ContextSnapshot, LlmRequest, NormalizedDocument, Passage } from '../src/shared/contracts'
import { documentSections } from '../src/shared/document-structure'
import { AppDatabase } from '../src/main/database'
import { BookContextStore } from '../src/main/book-context-store'
import { BookAnalysisService } from '../src/main/book-analysis'
import { boundContext, LlmService } from '../src/main/llm-service'
import type { ProviderService } from '../src/main/provider-service'
import { normalizeDoclingDocument } from '../src/main/document-normalizer'
import { createRerankFixture, evaluationCases } from './rerank-fixture'
import { structureDoclingFixture, structureQuestions, type StructureQuestion } from './document-structure-fixture'

function originalControl(): { document: NormalizedDocument; questions: (StructureQuestion & { anchors: string[] })[] } {
  const sections = createRerankFixture()
  const blocks = sections.flatMap((section) => section.blocks)
  const nodes = [...new Map(sections.map((section) => [section.chapterId, { id: section.chapterId, parentId: null, title: section.chapterTitle,
    level: 1, order: Number(section.chapterId.slice(1)), anchor: section.blocks[0].anchor, kind: 'section' as const }])).values()]
  const document: NormalizedDocument = { version: 2, nodes, diagnostics: [], units: sections.flatMap((section) => section.blocks.map((block) => ({
    id: 'control-u' + blocks.indexOf(block), nodeId: section.chapterId, order: blocks.indexOf(block), kind: block.kind, text: block.text,
    sources: [{ anchor: block.anchor, precision: 'text' as const }], relatedIds: [], searchable: true
  }))) }
  const questions = evaluationCases.map((item) => ({ id: item.id, question: item.question,
    expected: item.expected.map((id) => ({ quote: blocks.find((block) => block.id === id)!.text, pages: [] })),
    anchors: item.expected.map((id) => blocks.find((block) => block.id === id)!.anchor) }))
  return { document, questions }
}

function contains(passage: Passage, expected: StructureQuestion['expected'][number], anchor?: string): boolean {
  const pages = new Set(passage.sources?.map((source) => source.page))
  return passage.text.includes(expected.quote) && expected.pages.every((page) => pages.has(page)) && (!anchor || passage.anchor === anchor)
}

export async function runDocumentStructureEvaluation() {
  const results: { group: string; id: string; question: string; expected: number; finalHits: number; reducedHits: number; noAnswer: boolean;
    sourcePositionsValid: boolean; unsupportedFactAbsent: boolean | null; coverage: ContextSnapshot['coverage']; normal: Passage[]; reduced: Passage[] }[] = []
  const control = originalControl()
  for (const group of [{ id: 'retained-24', document: control.document, questions: control.questions },
    { id: 'structure-24', document: normalizeDoclingDocument(structureDoclingFixture(), 6), questions: structureQuestions }]) {
    const db = new AppDatabase(':memory:'), store = new BookContextStore(db), bookId = randomUUID()
    db.insertBook({ id: bookId, sha256: 'a'.repeat(64), title: '结构验收自建样本', author: null, format: group.id === 'retained-24' ? 'txt' : 'pdf',
      sourceFormat: group.id === 'retained-24' ? 'txt' : 'pdf', originalName: 'fixture', storedName: 'fixture', importedAt: '2026-09-08', lastOpenedAt: null, lastLocator: null, progress: 0 })
    const credentials = { baseUrl: 'http://127.0.0.1', model: 'deterministic-local', apiKey: '', compatibility: 'auto' as const }
    const provider = { getCredentials: () => credentials }
    const llm = new LlmService(provider)
    let plannerCalls = 0
    llm.requestText = async () => { plannerCalls++; return { text: '{"chapters":[],"terms":[]}' } }
    const analysis = new BookAnalysisService(store, provider as unknown as ProviderService, llm)
    try {
      // Feed normalized fixtures through the real store/index path without a network conversion or note model.
      store.prepare(bookId, randomUUID(), 'structure-fixture')
      const sections = documentSections(group.document)
      const originals = sections.flatMap((section) => section.blocks)
      store.cacheDocument(bookId, group.document, sections.length)
      store.append(bookId, sections)
      store.db.prepare("UPDATE book_documents SET status = 'ready' WHERE book_id = ?").run(bookId)
      if (group.id === 'retained-24') {
        store.resetNotes(bookId, randomUUID(), 'fixture', 'fixed-notes', 'fixture')
        const evidence = new Set(group.questions.flatMap((question) => question.expected.map((expected) => expected.quote)))
        for (const section of sections) store.saveNote(bookId, section.id, { summary: '固定对照笔记',
          claims: section.blocks.filter((block) => evidence.has(block.text)).map((block) => ({ text: block.text, sourceIds: [block.id] })), conditions: [], exceptions: [], concepts: [] })
      }
      for (const item of group.questions) {
        const before = plannerCalls
        const request: LlmRequest = { requestId: randomUUID(), conversationId: randomUUID(), bookId, scope: 'book', action: 'ask', question: item.question, history: [] }
        const source = await analysis.context(request, credentials, new AbortController().signal)
        if (plannerCalls !== before + 1) throw new Error('每轮规划次数不符合约定。')
        const normal = boundContext(request, source, 6_000).context, reduced = boundContext(request, source, 3_000).context
        const anchors = 'anchors' in item ? item.anchors as string[] : []
        const hits = (passages: Passage[]) => item.expected.filter((expected, index) => passages.some((passage) => contains(passage, expected, anchors[index]))).length
        const sameStart = (left: string, right: string): boolean => left.startsWith('txt:') && right.startsWith('txt:')
          ? left.split(':')[1] === right.split(':')[1] : left === right
        const actual = [...normal.passages, ...reduced.passages]
        const sourcePositionsValid = actual.every((passage) => originals.some((original) => original.text.startsWith(passage.text) &&
          sameStart(original.anchor, passage.anchor) && (passage.sources ?? []).every((source) => original.sources?.some((item) =>
            source.page === item.page && sameStart(source.anchor, item.anchor)))))
        results.push({ group: group.id, id: item.id, question: item.question, expected: item.expected.length, finalHits: hits(normal.passages), reducedHits: hits(reduced.passages),
          noAnswer: item.expected.length === 0, sourcePositionsValid,
          unsupportedFactAbsent: 'absent' in item && item.absent ? actual.every((passage) => !passage.text.includes(item.absent!)) : null,
          coverage: source.coverage, normal: normal.passages, reduced: reduced.passages })
      }
    } finally { analysis.dispose(); db.close() }
  }
  return { schema: 1, fixture: 'self-authored-document-structure-v2', realServiceVerified: false,
    scoring: '按实际原文文字及来源位置评分；新旧块 ID 不参与评分。无答案题单列，不计入证据召回分母。',
    results, totals: ['retained-24', 'structure-24'].map((group) => {
      const rows = results.filter((row) => row.group === group)
      return { group, questions: rows.length, expected: rows.reduce((sum, row) => sum + row.expected, 0),
        finalHits: rows.reduce((sum, row) => sum + row.finalHits, 0), reducedHits: rows.reduce((sum, row) => sum + row.reducedHits, 0), noAnswer: rows.filter((row) => row.noAnswer).length }
    }) }
}
