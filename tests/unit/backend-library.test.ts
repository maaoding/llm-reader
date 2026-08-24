import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { LibraryService } from '../../src/main/library-service'
import { highlightIdSchema, insightIdSchema } from '../../src/main/schemas'
import type { ArchivedChatMessage } from '../../src/shared/contracts'

const temporaryDirectories: string[] = []

function makeTemporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'llm-reader-backend-'))
  temporaryDirectories.push(path)
  return path
}

async function minimalEpubBytes(title = '转换书籍'): Promise<Buffer> {
  const epub = new JSZip()
  epub.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  epub.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>'
  )
  epub.file(
    'OPS/content.opf',
    `<package><metadata><dc:title>${title}</dc:title><dc:creator>转换作者</dc:creator></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`
  )
  epub.file('OPS/chapter.xhtml', '<html><body><p>转换后的正文</p></body></html>')
  return epub.generateAsync({ type: 'nodebuffer' })
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('LibraryService', () => {
  it('migrates existing EPUB/TXT rows to a repeatable sourceFormat column', () => {
    const root = makeTemporaryDirectory()
    const databasePath = join(root, 'reader.sqlite3')
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256) = 64),
        title TEXT NOT NULL,
        author TEXT,
        format TEXT NOT NULL CHECK(format IN ('epub', 'txt')),
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL UNIQUE,
        imported_at TEXT NOT NULL,
        last_opened_at TEXT,
        last_locator TEXT,
        progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1)
      ) STRICT;
      CREATE TABLE insights (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        selection_json TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        history_json TEXT NOT NULL DEFAULT '[]'
      ) STRICT;
      CREATE TABLE highlights (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        quote TEXT NOT NULL,
        anchor TEXT NOT NULL,
        chapter_title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(book_id, anchor)
      ) STRICT;
      INSERT INTO schema_migrations(version, applied_at) VALUES
        (1, '2026-01-01'), (2, '2026-01-01'), (3, '2026-01-01'),
        (4, '2026-01-01'), (5, '2026-01-01');
      INSERT INTO books(
        id, sha256, title, author, format, original_name, stored_name,
        imported_at, last_opened_at, last_locator, progress
      ) VALUES (
        'legacy-txt', '${'a'.repeat(64)}', 'Legacy TXT', NULL, 'txt',
        'legacy.txt', '${'a'.repeat(64)}.txt', '2026-01-01', NULL, NULL, 0
      );
      INSERT INTO highlights(id, book_id, quote, anchor, chapter_title, created_at)
      VALUES ('legacy-highlight', 'legacy-txt', 'Legacy', 'txt:0:6', '全文', '2026-01-01');
      INSERT INTO insights(
        id, book_id, selection_json, question, answer, model, created_at, history_json
      ) VALUES (
        'legacy-insight', 'legacy-txt',
        '{"bookId":"legacy-txt","quote":"Legacy","anchor":"txt:0:6","chapterTitle":"全文","passages":[]}',
        'Question', 'Answer', 'test-model', '2026-01-01', '[]'
      );
    `)
    legacy.close()

    let database = new AppDatabase(databasePath)
    expect(database.listBooks()).toEqual([
      expect.objectContaining({ id: 'legacy-txt', format: 'txt', sourceFormat: 'txt' })
    ])
    expect(database.connection.prepare('SELECT MAX(version) AS version FROM schema_migrations').get())
      .toMatchObject({ version: 7 })
    expect(database.listHighlights('legacy-txt')).toEqual([
      expect.objectContaining({ id: 'legacy-highlight', quote: 'Legacy' })
    ])
    expect(database.listInsights('legacy-txt')).toEqual([
      expect.objectContaining({ id: 'legacy-insight', question: 'Question' })
    ])
    database.close()

    database = new AppDatabase(databasePath)
    expect(database.listBooks()[0].sourceFormat).toBe('txt')
    database.close()
  })

  it('imports UTF-8 TXT, deduplicates by hash, and exposes only BookRecord fields', async () => {
    const root = makeTemporaryDirectory()
    const source = join(root, '示例.txt')
    await writeFile(source, '第一章\n这是一段测试文本。', 'utf8')
    const database = new AppDatabase(join(root, 'reader.sqlite3'))
    const library = new LibraryService(database, join(root, 'library'))

    const first = await library.importFromPath(source)
    const second = await library.importFromPath(source)

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.book.id).toBe(first.book.id)
    for (const result of [first, second]) {
      expect(result.book).not.toHaveProperty('sha256')
      expect(result.book).not.toHaveProperty('storedName')
      expect(Object.keys(result.book).sort()).toEqual(
        [
          'author',
          'format',
          'id',
          'importedAt',
          'lastLocator',
          'lastOpenedAt',
          'originalName',
          'progress',
          'sourceFormat',
          'title'
        ].sort()
      )
    }
    expect(database.listBooks()).toHaveLength(1)

    const payload = await library.readBook(first.book.id)
    expect(new TextDecoder().decode(payload.bytes)).toContain('测试文本')
    expect(payload.book).not.toHaveProperty('sha256')
    expect(payload.book).not.toHaveProperty('storedName')
    database.close()
  })

  it('imports a PDF by original hash and preserves its native format', async () => {
    const root = makeTemporaryDirectory()
    const source = join(root, '示例.pdf')
    const bytes = Buffer.from('%PDF-1.7\nminimal fixture bytes\n', 'ascii')
    await writeFile(source, bytes)
    const database = new AppDatabase(join(root, 'reader.sqlite3'))
    const library = new LibraryService(database, join(root, 'library'))

    const first = await library.importFromPath(source)
    const duplicate = await library.importFromPath(source)

    expect(first).toMatchObject({
      duplicate: false,
      book: { title: '示例', format: 'pdf', sourceFormat: 'pdf', originalName: '示例.pdf' }
    })
    expect(duplicate).toEqual({ book: first.book, duplicate: true })
    expect(database.getStoredBook(first.book.id)).toMatchObject({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      storedName: `${createHash('sha256').update(bytes).digest('hex')}.pdf`
    })
    expect(Buffer.from((await library.readBook(first.book.id)).bytes)).toEqual(bytes)
    database.close()
  })

  it('rejects a .pdf file without a PDF header', async () => {
    const root = makeTemporaryDirectory()
    const source = join(root, 'not-a-pdf.pdf')
    await writeFile(source, 'not a PDF', 'utf8')
    const database = new AppDatabase(join(root, 'reader.sqlite3'))
    const library = new LibraryService(database, join(root, 'library'))

    await expect(library.importFromPath(source)).rejects.toMatchObject({ code: 'INVALID_PDF' })
    expect(database.listBooks()).toEqual([])
    database.close()
  })

  it.each(['mobi', 'azw3'] as const)(
    'converts %s through the injected Calibre bridge, validates EPUB and deduplicates the original input',
    async (sourceFormat) => {
      const root = makeTemporaryDirectory()
      const source = join(root, `source.${sourceFormat}`)
      const sourceBytes = Buffer.from(`original-${sourceFormat}-bytes`)
      const convertedBytes = await minimalEpubBytes(`${sourceFormat.toUpperCase()} 书籍`)
      await writeFile(source, sourceBytes)
      const converter = { convert: vi.fn(async () => convertedBytes) }
      const databasePath = join(root, 'reader.sqlite3')
      let database = new AppDatabase(databasePath)
      let library = new LibraryService(database, join(root, 'library'), converter)

      const first = await library.importFromPath(source)
      const duplicate = await library.importFromPath(source)

      expect(converter.convert).toHaveBeenCalledOnce()
      expect(converter.convert).toHaveBeenCalledWith(source)
      expect(first).toMatchObject({
        duplicate: false,
        book: {
          format: 'epub',
          sourceFormat,
          originalName: `source.${sourceFormat}`,
          title: `${sourceFormat.toUpperCase()} 书籍`
        }
      })
      expect(duplicate).toEqual({ book: first.book, duplicate: true })
      const stored = database.getStoredBook(first.book.id)
      expect(stored?.sha256).toBe(createHash('sha256').update(sourceBytes).digest('hex'))
      expect(stored?.storedName).toMatch(/\.epub$/u)
      expect(Buffer.from((await library.readBook(first.book.id)).bytes)).toEqual(convertedBytes)
      database.close()

      database = new AppDatabase(databasePath)
      library = new LibraryService(database, join(root, 'library'), converter)
      expect(library.listBooks()[0]).toMatchObject({ format: 'epub', sourceFormat })
      database.close()
    }
  )

  it('rejects a converter result that fails the existing EPUB safety validation', async () => {
    const root = makeTemporaryDirectory()
    const source = join(root, 'unsafe.mobi')
    await writeFile(source, 'untrusted source bytes')
    const unsafe = new JSZip()
    unsafe.file('mimetype', 'application/epub+zip')
    unsafe.file('../escape.txt', 'escape')
    unsafe.file(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'
    )
    unsafe.file('book.opf', '<package><metadata><title>Unsafe</title></metadata></package>')
    const converter = { convert: vi.fn(async () => unsafe.generateAsync({ type: 'nodebuffer' })) }
    const database = new AppDatabase(join(root, 'reader.sqlite3'))
    const libraryDirectory = join(root, 'library')
    const library = new LibraryService(database, libraryDirectory, converter)

    await expect(library.importFromPath(source)).rejects.toMatchObject({ code: 'INVALID_EPUB' })
    expect(database.listBooks()).toEqual([])
    await expect(readdir(libraryDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    database.close()
  })

  it('persists reading progress and saved insights across database reopen', async () => {
    const root = makeTemporaryDirectory()
    const source = join(root, 'book.txt')
    const databasePath = join(root, 'reader.sqlite3')
    await writeFile(source, 'A short UTF-8 book.', 'utf8')

    let database = new AppDatabase(databasePath)
    let library = new LibraryService(database, join(root, 'library'))
    const imported = await library.importFromPath(source)
    library.updateBookProgress(imported.book.id, 'txt:18', 0.75)
    const selection = {
      bookId: imported.book.id,
      quote: 'short',
      anchor: 'txt:2-7',
      chapterTitle: 'book',
      passages: [{ id: 'p-1', text: 'A short UTF-8 book.', anchor: 'txt:0-19' }]
    }
    library.saveInsight({
      bookId: imported.book.id,
      selection,
      question: 'What does this mean?',
      answer: 'It is concise. [p-1]',
      model: 'test-model'
    })
    database.close()

    database = new AppDatabase(databasePath)
    library = new LibraryService(database, join(root, 'library'))
    expect(library.listBooks()[0]).toMatchObject({ lastLocator: 'txt:18', progress: 0.75 })
    expect(library.listInsights(imported.book.id)).toEqual([
      expect.objectContaining({ question: 'What does this mean?', selection })
    ])
    database.close()
  })

  it('persists archived conversation history and updates it by id', async () => {
    const root = makeTemporaryDirectory()
    const databasePath = join(root, 'reader.sqlite3')
    const source = join(root, 'history.txt')
    await writeFile(source, 'History book.', 'utf8')

    let database = new AppDatabase(databasePath)
    let library = new LibraryService(database, join(root, 'library'))
    const book = (await library.importFromPath(source)).book
    const selection = {
      bookId: book.id,
      quote: 'History book',
      anchor: 'txt:0-12',
      chapterTitle: '全文',
      passages: [{ id: 'p-1', text: 'History book.', anchor: 'txt:0-13' }]
    }
    const saved = library.saveInsight({
      bookId: book.id,
      selection,
      question: 'What is this?',
      answer: 'A book.',
      model: 'history-model'
    })
    expect(saved.history).toEqual([
      { role: 'user', content: 'What is this?' },
      { role: 'assistant', content: 'A book.', model: 'history-model' }
    ])

    const updatedHistory: ArchivedChatMessage[] = [
      { role: 'user', content: 'What is this?' },
      { role: 'assistant', content: 'A book.', model: 'history-model' },
      { role: 'user', content: 'Follow up?' },
      { role: 'assistant', content: 'Follow up answer.', model: 'history-model' }
    ]
    const updated = library.updateInsightHistory({ bookId: book.id, id: saved.id, history: updatedHistory })
    expect(updated.history).toEqual(updatedHistory)
    database.close()

    database = new AppDatabase(databasePath)
    library = new LibraryService(database, join(root, 'library'))
    expect(library.listInsights(book.id)[0]?.history).toEqual(updatedHistory)
    database.close()
  })
  it('deletes exactly one saved insight and treats an unknown id as a no-op', async () => {
    const root = makeTemporaryDirectory()
    const databasePath = join(root, 'reader.sqlite3')
    const firstSource = join(root, 'first.txt')
    const secondSource = join(root, 'second.txt')
    await writeFile(firstSource, 'First book.', 'utf8')
    await writeFile(secondSource, 'Second book.', 'utf8')

    let database = new AppDatabase(databasePath)
    let library = new LibraryService(database, join(root, 'library'))
    const firstBook = (await library.importFromPath(firstSource)).book
    const secondBook = (await library.importFromPath(secondSource)).book
    const makeInsight = (bookId: string, answer: string) =>
      library.saveInsight({
        bookId,
        selection: {
          bookId,
          quote: answer,
          anchor: 'txt:0-5',
          chapterTitle: 'book',
          passages: [{ id: 'p-1', text: answer, anchor: 'txt:0-5' }]
        },
        question: 'What does this mean?',
        answer,
        model: 'test-model'
      })

    const deleted = makeInsight(firstBook.id, 'Delete me')
    const retainedFromSameBook = makeInsight(firstBook.id, 'Keep me')
    const retainedFromOtherBook = makeInsight(secondBook.id, 'Keep the other book')

    expect(library.deleteInsight(deleted.id)).toBe(true)
    expect(library.deleteInsight('00000000-0000-4000-8000-000000000000')).toBe(false)
    expect(library.listInsights(firstBook.id)).toEqual([retainedFromSameBook])
    expect(library.listInsights(secondBook.id)).toEqual([retainedFromOtherBook])

    database.close()
    database = new AppDatabase(databasePath)
    library = new LibraryService(database, join(root, 'library'))
    expect(library.listInsights(firstBook.id)).toEqual([retainedFromSameBook])
    expect(library.listInsights(secondBook.id)).toEqual([retainedFromOtherBook])
    expect(insightIdSchema.safeParse('not-an-insight-id').success).toBe(false)
    database.close()
  })

  it('persists per-book highlights, deduplicates identical anchors and deletes by id', async () => {
    const root = makeTemporaryDirectory()
    const databasePath = join(root, 'reader.sqlite3')
    const firstSource = join(root, 'first.txt')
    const secondSource = join(root, 'second.txt')
    await writeFile(firstSource, 'First book.', 'utf8')
    await writeFile(secondSource, 'Second book.', 'utf8')

    let database = new AppDatabase(databasePath)
    let library = new LibraryService(database, join(root, 'library'))
    const firstBook = (await library.importFromPath(firstSource)).book
    const secondBook = (await library.importFromPath(secondSource)).book

    const first = library.saveHighlight({
      bookId: firstBook.id,
      quote: 'First',
      anchor: 'txt:0:5',
      chapterTitle: '第一章'
    })
    const duplicate = library.saveHighlight({
      bookId: firstBook.id,
      quote: 'First',
      anchor: 'txt:0:5',
      chapterTitle: '第一章'
    })
    const second = library.saveHighlight({
      bookId: firstBook.id,
      quote: 'book',
      anchor: 'txt:6:10',
      chapterTitle: '第二章'
    })
    const otherBook = library.saveHighlight({
      bookId: secondBook.id,
      quote: 'Second',
      anchor: 'txt:0:6',
      chapterTitle: '另一本'
    })

    expect(duplicate.id).toBe(first.id)
    expect(library.listHighlights(firstBook.id)).toEqual([second, first])
    expect(library.listHighlights(secondBook.id)).toEqual([otherBook])
    expect(library.deleteHighlight(second.id)).toBe(true)
    expect(library.deleteHighlight('00000000-0000-4000-8000-000000000000')).toBe(false)
    expect(() =>
      library.saveHighlight({
        bookId: '00000000-0000-4000-8000-000000000000',
        quote: 'missing',
        anchor: 'txt:0:0',
        chapterTitle: ''
      })
    ).toThrow('找不到这本书')
    expect(highlightIdSchema.safeParse('not-a-highlight-id').success).toBe(false)
    database.close()

    database = new AppDatabase(databasePath)
    library = new LibraryService(database, join(root, 'library'))
    expect(library.listHighlights(firstBook.id)).toEqual([first])
    expect(library.listHighlights(secondBook.id)).toEqual([otherBook])
    database.close()
  })

  it('reads EPUB metadata and rejects invalid UTF-8 and DRM EPUB files', async () => {
    const root = makeTemporaryDirectory()
    const database = new AppDatabase(join(root, 'reader.sqlite3'))
    const library = new LibraryService(database, join(root, 'library'))

    const epub = new JSZip()
    epub.file('mimetype', 'application/epub+zip')
    epub.file(
      'META-INF/container.xml',
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    )
    epub.file(
      'OPS/book.opf',
      '<package><metadata><dc:title>深度阅读</dc:title><dc:creator>测试作者</dc:creator></metadata></package>'
    )
    const epubPath = join(root, 'book.epub')
    await writeFile(epubPath, await epub.generateAsync({ type: 'nodebuffer' }))
    await expect(library.importFromPath(epubPath)).resolves.toEqual(
      expect.objectContaining({ book: expect.objectContaining({ title: '深度阅读', author: '测试作者' }) })
    )

    const invalidTxt = join(root, 'invalid.txt')
    await writeFile(invalidTxt, Buffer.from([0xc3, 0x28]))
    await expect(library.importFromPath(invalidTxt)).rejects.toMatchObject({ code: 'INVALID_UTF8' })

    const drm = new JSZip()
    drm.file('mimetype', 'application/epub+zip')
    drm.file(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'
    )
    drm.file('META-INF/rights.xml', '<rights/>')
    drm.file('book.opf', '<package><metadata><title>DRM</title></metadata></package>')
    const drmPath = join(root, 'drm.epub')
    await writeFile(drmPath, await drm.generateAsync({ type: 'nodebuffer' }))
    await expect(library.importFromPath(drmPath)).rejects.toMatchObject({ code: 'DRM_EPUB' })

    const unsafe = new JSZip()
    unsafe.file('mimetype', 'application/epub+zip')
    unsafe.file('../escape.txt', 'must not escape')
    unsafe.file(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'
    )
    unsafe.file('book.opf', '<package><metadata><title>Unsafe</title></metadata></package>')
    const unsafePath = join(root, 'unsafe.epub')
    await writeFile(unsafePath, await unsafe.generateAsync({ type: 'nodebuffer' }))
    await expect(library.importFromPath(unsafePath)).rejects.toMatchObject({ code: 'INVALID_EPUB' })

    const copiedBytes = await readFile(join(root, 'library', `${database.getStoredBook(library.listBooks()[0].id)?.sha256}.epub`))
    expect(copiedBytes.length).toBeGreaterThan(0)
    database.close()
  })
  it('extracts EPUB covers and reading metadata without exposing storage details', async () => {
    const root = makeTemporaryDirectory()
    const database = new AppDatabase(join(root, 'reader.sqlite3'))
    const library = new LibraryService(database, join(root, 'library'))
    const coverPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8xUowAAAABJRU5ErkJggg==',
      'base64'
    )

    const epub = new JSZip()
    epub.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
    epub.file(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>'
    )
    epub.file(
      'OPS/content.opf',
      '<package version="3.0"><metadata><dc:title>封面书</dc:title><dc:creator>测试作者</dc:creator><dc:language>zh-CN</dc:language><dc:publisher>示例出版社</dc:publisher><dc:date>2024-03-01</dc:date><dc:identifier>urn:isbn:9780000000000</dc:identifier><dc:description>用于验证<strong>封面</strong>与阅读元数据。</dc:description></metadata><manifest><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>'
    )
    epub.file('OPS/cover.png', coverPng)
    epub.file('OPS/chapter.xhtml', '<html><body><p>正文</p></body></html>')
    const epubPath = join(root, 'cover.epub')
    await writeFile(epubPath, await epub.generateAsync({ type: 'nodebuffer' }))

    const imported = await library.importFromPath(epubPath)
    const cover = await library.getBookCover(imported.book.id)
    expect(cover?.mimeType).toBe('image/png')
    expect(Array.from(cover?.bytes ?? [])).toEqual(Array.from(coverPng))

    const details = await library.getBookDetails(imported.book.id)
    expect(details.book).toEqual(imported.book)
    expect(details.fileSizeBytes).toBe((await stat(epubPath)).size)
    expect(details.metadata).toEqual({
      language: 'zh-CN',
      publisher: '示例出版社',
      publishedAt: '2024-03-01',
      identifier: 'urn:isbn:9780000000000',
      description: '用于验证 封面 与阅读元数据。'
    })
    expect(details.cover?.mimeType).toBe('image/png')
    expect(details.book).not.toHaveProperty('sha256')
    expect(details.book).not.toHaveProperty('storedName')

    const cached = await readdir(join(root, 'library', 'covers'))
    expect(cached).toContain(imported.book.id + '.png')

    await rm(join(root, 'library', 'covers'), { recursive: true, force: true })
    const recachedCover = await library.getBookCover(imported.book.id)
    expect(recachedCover?.mimeType).toBe('image/png')
    expect(Array.from(recachedCover?.bytes ?? [])).toEqual(Array.from(coverPng))
    const recachedDetails = await library.getBookDetails(imported.book.id)
    expect(recachedDetails.metadata.publisher).toBe('示例出版社')
    expect(recachedDetails.cover?.mimeType).toBe('image/png')
    database.close()
  })

  it('supports OPF2 cover metadata, skips SVG covers, and ignores unsafe cover paths', async () => {
    const root = makeTemporaryDirectory()
    const database = new AppDatabase(join(root, 'reader.sqlite3'))
    const library = new LibraryService(database, join(root, 'library'))

    const svg = new JSZip()
    svg.file('mimetype', 'application/epub+zip')
    svg.file(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'
    )
    svg.file(
      'book.opf',
      '<package><metadata><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-image" href="cover.svg" media-type="image/svg+xml"/></manifest></package>'
    )
    svg.file('cover.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const svgPath = join(root, 'svg-cover.epub')
    await writeFile(svgPath, await svg.generateAsync({ type: 'nodebuffer' }))
    const svgBook = await library.importFromPath(svgPath)
    expect(await library.getBookCover(svgBook.book.id)).toBeNull()

    const unsafe = new JSZip()
    unsafe.file('mimetype', 'application/epub+zip')
    unsafe.file(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    )
    unsafe.file(
      'OPS/book.opf',
      '<package><metadata><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-image" href="../cover.png" media-type="image/png"/></manifest></package>'
    )
    const unsafePath = join(root, 'unsafe-cover.epub')
    await writeFile(unsafePath, await unsafe.generateAsync({ type: 'nodebuffer' }))
    const unsafeBook = await library.importFromPath(unsafePath)
    expect(await library.getBookCover(unsafeBook.book.id)).toBeNull()

    const opf2 = new JSZip()
    opf2.file('mimetype', 'application/epub+zip')
    opf2.file(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    )
    opf2.file(
      'OPS/book.opf',
      '<package><metadata><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/></manifest></package>'
    )
    opf2.file('OPS/images/cover.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    const opf2Path = join(root, 'opf2-cover.epub')
    await writeFile(opf2Path, await opf2.generateAsync({ type: 'nodebuffer' }))
    const opf2Book = await library.importFromPath(opf2Path)
    expect(await library.getBookCover(opf2Book.book.id)).toEqual({
      mimeType: 'image/jpeg',
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    })
    database.close()
  })

  it('returns TXT details without cover or EPUB metadata', async () => {
    const root = makeTemporaryDirectory()
    const source = join(root, 'plain.txt')
    await writeFile(source, '只有文字。', 'utf8')
    const database = new AppDatabase(join(root, 'reader.sqlite3'))
    const library = new LibraryService(database, join(root, 'library'))
    const imported = await library.importFromPath(source)

    expect(await library.getBookCover(imported.book.id)).toBeNull()
    const details = await library.getBookDetails(imported.book.id)
    expect(details.fileSizeBytes).toBe((await stat(source)).size)
    expect(details.metadata).toEqual({
      language: null,
      publisher: null,
      publishedAt: null,
      identifier: null,
      description: null
    })
    expect(details.cover).toBeNull()
    database.close()
  })

})
