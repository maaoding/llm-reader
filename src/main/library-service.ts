import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import JSZip from 'jszip'
import type {
  BookCoverMimeType,
  BookCoverPayload,
  BookDetails,
  BookFormat,
  BookMetadata,
  BookPayload,
  BookRecord,
  BookSourceFormat,
  HighlightRecord,
  ImportedBookResult,
  SavedInsight,
  SaveHighlightInput,
  SaveInsightInput,
  UpdateInsightHistoryInput
} from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppDatabase, type StoredBook } from './database'
import { CalibreEpubConverter, type EpubConverter } from './calibre-converter'
import { AppError } from './errors'

const MAX_IMPORT_BYTES = 250 * 1024 * 1024
const MAX_TXT_BYTES = 64 * 1024 * 1024
const MAX_EPUB_ENTRIES = 20_000
const MAX_METADATA_BYTES = 2 * 1024 * 1024
const MAX_EPUB_ENTRY_BYTES = 128 * 1024 * 1024
const MAX_EPUB_EXPANDED_BYTES = 512 * 1024 * 1024
const MAX_COVER_BYTES = 8 * 1024 * 1024
const MAX_DESCRIPTION_LENGTH = 2_000
const NO_COVER_MARKER = '.none'

const COVER_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
])

const COVER_EXTENSIONS: Readonly<Record<BookCoverMimeType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

const COVER_MIME_BY_EXTENSION: Readonly<Record<string, BookCoverMimeType>> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

interface ValidatedBook {
  format: BookFormat
  title: string
  author: string | null
  metadata: BookMetadata
  cover: ExtractedCover | null
}

interface ExtractedCover {
  bytes: Uint8Array
  mimeType: BookCoverMimeType
  extension: string
}

interface EpubPackage {
  packagePath: string
  packageXml: string
}

interface StoredEpubInfo extends EpubPackage {
  metadata: BookMetadata
  cover: ExtractedCover | null
}

type CachedCover = BookCoverPayload | null | 'missing'

function emptyBookMetadata(): BookMetadata {
  return {
    language: null,
    publisher: null,
    publishedAt: null,
    identifier: null,
    description: null
  }
}

function publicBook(book: StoredBook): BookRecord {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    sourceFormat: book.sourceFormat,
    originalName: book.originalName,
    importedAt: book.importedAt,
    lastOpenedAt: book.lastOpenedAt,
    lastLocator: book.lastLocator,
    progress: book.progress
  }
}

function toPublicCover(cover: ExtractedCover | null): BookCoverPayload | null {
  if (!cover) return null
  return { mimeType: cover.mimeType, bytes: cover.bytes }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
}

function assertXmlLocalName(localName: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(localName)) {
    throw new Error('Invalid XML local name: ' + localName)
  }
  return localName
}

const XML_TAG_PREFIX = '(?:(?:[A-Za-z0-9_.-]+):)?'
const XML_TAG_END = '(?=[ ' + String.fromCharCode(9, 10, 13) + '/>])'

function isXmlSpace(value: string): boolean {
  return value === ' ' || value === String.fromCharCode(9) || value === String.fromCharCode(10) || value === String.fromCharCode(13)
}

function collapseXmlWhitespace(value: string): string {
  let output = ''
  let previousSpace = false
  for (const character of value) {
    if (isXmlSpace(character)) {
      if (!previousSpace && output.length > 0) output += ' '
      previousSpace = true
    } else {
      output += character
      previousSpace = false
    }
  }
  return output.trim()
}

function parseXmlAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>()
  let cursor = 0
  while (cursor < source.length) {
    while (cursor < source.length && isXmlSpace(source[cursor] ?? '')) cursor += 1
    if (cursor >= source.length || source[cursor] === '>' || source[cursor] === '/') break
    const equals = source.indexOf('=', cursor)
    if (equals < 0) break
    const name = source.slice(cursor, equals).trim().toLowerCase()
    cursor = equals + 1
    while (cursor < source.length && isXmlSpace(source[cursor] ?? '')) cursor += 1
    const quote = source[cursor] ?? ''
    if (quote !== '"' && quote !== "'") break
    const end = source.indexOf(quote, cursor + 1)
    if (end < 0) break
    if (name) attributes.set(name, decodeXmlEntities(source.slice(cursor + 1, end)))
    cursor = end + 1
  }
  return attributes
}

function extractXmlText(xml: string, localName: string): string | null {
  assertXmlLocalName(localName)
  const opening = '<' + XML_TAG_PREFIX + localName + XML_TAG_END + '(?:[^>]*)>'
  const closing = '</' + XML_TAG_PREFIX + localName + '>'
  const match = xml.match(new RegExp(opening + '([^]*?)' + closing, 'i'))
  if (!match) return null
  const text = collapseXmlWhitespace(decodeXmlEntities(match[1].replace(/<[^>]*>/g, ' ')))
  return text || null
}

function extractXmlSection(xml: string, localName: string): string | null {
  assertXmlLocalName(localName)
  const opening = '<' + XML_TAG_PREFIX + localName + XML_TAG_END + '(?:[^>]*)>'
  const closing = '</' + XML_TAG_PREFIX + localName + '>'
  const match = xml.match(new RegExp(opening + '([^]*?)' + closing, 'i'))
  return match ? match[1] : null
}

function extractXmlElements(xml: string, localName: string): Array<{ attributes: Map<string, string> }> {
  assertXmlLocalName(localName)
  const pattern = new RegExp('<' + XML_TAG_PREFIX + localName + XML_TAG_END + '([^>]*)>', 'gi')
  return Array.from(xml.matchAll(pattern), (match) => ({ attributes: parseXmlAttributes(match[1] ?? '') }))
}

function extractBookMetadata(packageXml: string): BookMetadata {
  const description = extractXmlText(packageXml, 'description')
  return {
    language: extractXmlText(packageXml, 'language'),
    publisher: extractXmlText(packageXml, 'publisher'),
    publishedAt: extractXmlText(packageXml, 'date'),
    identifier: extractXmlText(packageXml, 'identifier'),
    description: description ? description.slice(0, MAX_DESCRIPTION_LENGTH) : null
  }
}

function coverMimeType(value: string | null | undefined): BookCoverMimeType | null {
  const normalized = value?.trim().toLowerCase()
  return normalized && COVER_MIME_TYPES.has(normalized) ? (normalized as BookCoverMimeType) : null
}

function coverMimeTypeFromPath(path: string): BookCoverMimeType | null {
  const extension = extname(path.split('?')[0].split('#')[0]).toLowerCase()
  return COVER_MIME_BY_EXTENSION[extension] ?? null
}

function safeZipPath(value: string): string {
  let normalized = value.replaceAll(String.fromCharCode(92), '/')
  if (normalized.startsWith('./')) normalized = normalized.slice(2)
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new AppError('INVALID_EPUB', copy('error.epubUnsafePath'))
  }
  return normalized
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(safeZipPath(path))
  if (!entry) throw new AppError('INVALID_EPUB', copy('error.epubIncomplete'))
  const privateEntry = entry as unknown as { _data?: { uncompressedSize?: number } }
  if ((privateEntry._data?.uncompressedSize ?? 0) > MAX_METADATA_BYTES) {
    throw new AppError('INVALID_EPUB', copy('error.epubMetadataTooLarge'))
  }
  const text = await entry.async('string')
  if (text.length > MAX_METADATA_BYTES) {
    throw new AppError('INVALID_EPUB', copy('error.epubMetadataTooLarge'))
  }
  return text
}

async function readEpubPackage(zip: JSZip): Promise<EpubPackage> {
  const containerXml = await readZipText(zip, 'META-INF/container.xml')
  const rootfileMatch = containerXml.match(/<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i)
  if (!rootfileMatch) throw new AppError('INVALID_EPUB', copy('error.epubMissingContent'))
  const packagePath = safeZipPath(decodeXmlEntities(rootfileMatch[1]))
  return { packagePath, packageXml: await readZipText(zip, packagePath) }
}

function hasUnsupportedEncryption(encryptionXml: string): boolean {
  const algorithms = [...encryptionXml.matchAll(/<EncryptionMethod\b[^>]*\bAlgorithm\s*=\s*["']([^"']+)["']/gi)].map(
    (match) => match[1]
  )
  if (algorithms.length === 0) return /<EncryptedData\b/i.test(encryptionXml)

  const fontObfuscationAlgorithms = new Set([
    'http://www.idpf.org/2008/embedding',
    'http://ns.adobe.com/pdf/enc#RC'
  ])
  return algorithms.some((algorithm) => !fontObfuscationAlgorithms.has(algorithm))
}

function resolveEpubHref(packagePath: string, href: string): string | null {
  const clean = decodeXmlEntities(href).trim().split('#')[0]
  if (!clean) return null
  const directory = posix.dirname(packagePath)
  return directory === '.' ? clean : `${directory}/${clean}`
}

async function extractEpubCover(
  zip: JSZip,
  packagePath: string,
  packageXml: string
): Promise<ExtractedCover | null> {
  try {
    const manifest = extractXmlSection(packageXml, 'manifest') ?? packageXml
    const items = extractXmlElements(manifest, 'item')
    const itemsById = new Map<string, { href: string; mediaType: string | null }>()
    let target: { href: string; mediaType: string | null } | null = null

    for (const { attributes } of items) {
      const id = attributes.get('id')?.trim() ?? ''
      const href = attributes.get('href')?.trim() ?? ''
      const mediaType = attributes.get('media-type')?.trim() ?? null
      if (id && href) itemsById.set(id, { href, mediaType })
      const properties = attributes.get('properties')?.toLowerCase() ?? ''
      if (href && properties.split(/\s+/u).includes('cover-image')) {
        target = { href, mediaType }
      }
    }

    if (!target) {
      const metadata = extractXmlSection(packageXml, 'metadata') ?? packageXml
      for (const { attributes } of extractXmlElements(metadata, 'meta')) {
        const name = attributes.get('name')?.trim().toLowerCase()
        if (name !== 'cover') continue
        const content = attributes.get('content')?.trim()
        if (content && itemsById.has(content)) {
          target = itemsById.get(content) ?? null
          break
        }
      }
    }

    if (!target) {
      const guide = extractXmlSection(packageXml, 'guide') ?? ''
      for (const { attributes } of extractXmlElements(guide, 'reference')) {
        const type = attributes.get('type')?.trim().toLowerCase()
        const href = attributes.get('href')?.trim()
        if (type === 'cover' && href) {
          target = { href, mediaType: null }
          break
        }
      }
    }

    if (!target) return null

    const resolved = resolveEpubHref(packagePath, target.href)
    if (!resolved) return null
    const candidates = new Set<string>([resolved])
    try {
      candidates.add(decodeURIComponent(resolved))
    } catch {
      // The raw zip path is still attempted below.
    }

    for (const candidate of candidates) {
      let entry
      try {
        entry = zip.file(safeZipPath(candidate))
      } catch {
        continue
      }
      if (!entry || entry.dir) continue
      const privateEntry = entry as unknown as { _data?: { uncompressedSize?: number } }
      const entryBytes = privateEntry._data?.uncompressedSize
      if (
        typeof entryBytes !== 'number' ||
        !Number.isSafeInteger(entryBytes) ||
        entryBytes < 0 ||
        entryBytes > MAX_COVER_BYTES
      ) {
        continue
      }

      const mediaType = target.mediaType
        ? coverMimeType(target.mediaType)
        : coverMimeTypeFromPath(candidate)
      if (!mediaType) continue

      const buffer = await entry.async('nodebuffer')
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_COVER_BYTES) continue
      return {
        bytes: Uint8Array.from(buffer),
        mimeType: mediaType,
        extension: COVER_EXTENSIONS[mediaType]
      }
    }
  } catch {
    // Cover extraction is optional; the book remains importable without it.
  }
  return null
}

async function validateEpub(bytes: Buffer, fallbackTitle: string): Promise<ValidatedBook> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false })
  } catch (error) {
    throw new AppError('INVALID_EPUB', copy('error.epubOpenFailed'), false, { cause: error })
  }

  if (Object.keys(zip.files).length > MAX_EPUB_ENTRIES) {
    throw new AppError('INVALID_EPUB', copy('error.epubTooManyEntries'))
  }

  let expandedBytes = 0
  for (const entry of Object.values(zip.files)) {
    const privateEntry = entry as unknown as {
      unsafeOriginalName?: string
      _data?: { uncompressedSize?: number }
    }
    safeZipPath(privateEntry.unsafeOriginalName ?? entry.name)
    if (entry.dir) continue
    const entryBytes = privateEntry._data?.uncompressedSize
    if (
      typeof entryBytes !== 'number' ||
      !Number.isSafeInteger(entryBytes) ||
      entryBytes < 0 ||
      entryBytes > MAX_EPUB_ENTRY_BYTES
    ) {
      throw new AppError('INVALID_EPUB', copy('error.epubEntryTooLarge'))
    }
    expandedBytes += entryBytes
    if (expandedBytes > MAX_EPUB_EXPANDED_BYTES) {
      throw new AppError('INVALID_EPUB', copy('error.epubExpandedTooLarge'))
    }
  }

  const mimetype = zip.file('mimetype')
  if (mimetype) {
    const value = (await mimetype.async('string')).trim()
    if (value !== 'application/epub+zip') {
      throw new AppError('INVALID_EPUB', copy('error.epubInvalid'))
    }
  }

  if (zip.file('META-INF/rights.xml')) {
    throw new AppError('DRM_EPUB', copy('error.epubDrm'))
  }
  const encryptionEntry = zip.file('META-INF/encryption.xml')
  if (encryptionEntry) {
    const encryptionXml = await readZipText(zip, 'META-INF/encryption.xml')
    if (hasUnsupportedEncryption(encryptionXml)) {
      throw new AppError('DRM_EPUB', copy('error.epubDrm'))
    }
  }

  const pkg = await readEpubPackage(zip)
  return {
    format: 'epub',
    title: extractXmlText(pkg.packageXml, 'title') ?? fallbackTitle,
    author: extractXmlText(pkg.packageXml, 'creator'),
    metadata: extractBookMetadata(pkg.packageXml),
    cover: await extractEpubCover(zip, pkg.packagePath, pkg.packageXml)
  }
}

function validateTxt(bytes: Buffer, fallbackTitle: string): ValidatedBook {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new AppError('INVALID_UTF8', copy('error.txtEncoding'), false, { cause: error })
  }
  if (text.includes('\0')) {
    throw new AppError('INVALID_TXT', copy('error.txtBinary'))
  }
  return { format: 'txt', title: fallbackTitle, author: null, metadata: emptyBookMetadata(), cover: null }
}

export class LibraryService {
  private readonly coverDirectory: string
  private readonly epubInfoPromises = new Map<string, Promise<StoredEpubInfo | null>>()
  private epubParseQueue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly database: AppDatabase,
    private readonly libraryDirectory: string,
    private readonly epubConverter: EpubConverter = new CalibreEpubConverter()
  ) {
    if (!isAbsolute(libraryDirectory)) {
      throw new Error('libraryDirectory must be absolute')
    }
    this.coverDirectory = join(libraryDirectory, 'covers')
  }

  listBooks(): BookRecord[] {
    return this.database.listBooks()
  }

  async importFromPath(sourcePath: string): Promise<ImportedBookResult> {
    if (!isAbsolute(sourcePath)) {
      throw new AppError('INVALID_PATH', copy('error.importAbsolutePath'))
    }

    let fileInfo
    try {
      fileInfo = await stat(sourcePath)
    } catch (error) {
      throw new AppError('FILE_NOT_FOUND', copy('error.importNotFound'), false, { cause: error })
    }
    if (!fileInfo.isFile()) throw new AppError('INVALID_FILE', copy('error.importNotFile'))
    if (fileInfo.size <= 0) throw new AppError('EMPTY_FILE', copy('error.importEmpty'))
    if (fileInfo.size > MAX_IMPORT_BYTES) throw new AppError('FILE_TOO_LARGE', copy('error.importTooLarge'))

    const extension = extname(sourcePath).toLowerCase()
    if (extension !== '.epub' && extension !== '.txt' && extension !== '.mobi' && extension !== '.azw3') {
      throw new AppError('UNSUPPORTED_FORMAT', copy('error.importUnsupported'))
    }
    if (extension === '.txt' && fileInfo.size > MAX_TXT_BYTES) {
      throw new AppError('FILE_TOO_LARGE', copy('error.txtTooLarge'))
    }

    const originalName = basename(sourcePath).slice(0, 255)
    const fallbackTitle = basename(sourcePath, extension).trim().slice(0, 500) || copy('library.untitled')
    const bytes = await readFile(sourcePath)
    if (bytes.byteLength === 0) throw new AppError('EMPTY_FILE', copy('error.importEmpty'))
    if (bytes.byteLength > MAX_IMPORT_BYTES) {
      throw new AppError('FILE_TOO_LARGE', copy('error.importTooLarge'))
    }
    if (extension === '.txt' && bytes.byteLength > MAX_TXT_BYTES) {
      throw new AppError('FILE_TOO_LARGE', copy('error.txtTooLarge'))
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const duplicate = this.database.findBookByHash(sha256)
    if (duplicate) return { book: publicBook(duplicate), duplicate: true }

    const sourceFormat = extension.slice(1) as BookSourceFormat
    const storedBytes = sourceFormat === 'mobi' || sourceFormat === 'azw3'
      ? await this.epubConverter.convert(sourcePath)
      : bytes
    if (storedBytes.byteLength === 0) throw new AppError('EMPTY_FILE', copy('error.importEmpty'))
    if (storedBytes.byteLength > MAX_IMPORT_BYTES) {
      throw new AppError('FILE_TOO_LARGE', copy('error.importTooLarge'))
    }
    const validated = sourceFormat === 'txt'
      ? validateTxt(storedBytes, fallbackTitle)
      : await validateEpub(storedBytes, fallbackTitle)

    await mkdir(this.libraryDirectory, { recursive: true })
    const storedName = `${sha256}.${validated.format}`
    const destination = this.resolveStoredPath(storedName)
    try {
      await writeFile(destination, storedBytes, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }

    const now = new Date().toISOString()
    const book = this.database.insertBook({
      id: randomUUID(),
      sha256,
      storedName,
      title: validated.title.slice(0, 500),
      author: validated.author?.slice(0, 500) ?? null,
      format: validated.format,
      sourceFormat,
      originalName,
      importedAt: now,
      lastOpenedAt: null,
      lastLocator: null,
      progress: 0
    })
    if (validated.format === 'epub') {
      await this.writeCoverCache(book.id, validated.cover).catch(() => undefined)
    }
    return { book, duplicate: false }
  }

  async readBook(bookId: string): Promise<BookPayload> {
    const stored = this.database.getStoredBook(bookId)
    if (!stored) throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))
    const bytes = await readFile(this.resolveStoredPath(stored.storedName))
    const openedAt = new Date().toISOString()
    this.database.touchBook(bookId, openedAt)
    const book: BookRecord = {
      id: stored.id,
      title: stored.title,
      author: stored.author,
      format: stored.format,
      sourceFormat: stored.sourceFormat,
      originalName: stored.originalName,
      importedAt: stored.importedAt,
      lastOpenedAt: openedAt,
      lastLocator: stored.lastLocator,
      progress: stored.progress
    }
    return { book, bytes: Uint8Array.from(bytes) }
  }

  async getBookCover(bookId: string): Promise<BookCoverPayload | null> {
    const stored = this.database.getStoredBook(bookId)
    if (!stored) throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))
    if (stored.format !== 'epub') return null

    const cached = await this.readCoverCache(bookId)
    if (cached !== 'missing') return cached

    const parsed = await this.loadStoredEpub(stored)
    if (!parsed) return null
    await this.writeCoverCache(bookId, parsed.cover).catch(() => undefined)
    return toPublicCover(parsed.cover)
  }

  async getBookDetails(bookId: string): Promise<BookDetails> {
    const stored = this.database.getStoredBook(bookId)
    if (!stored) throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))

    let fileInfo
    try {
      fileInfo = await stat(this.resolveStoredPath(stored.storedName))
    } catch (error) {
      throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'), false, { cause: error })
    }

    let metadata = emptyBookMetadata()
    let cover: BookCoverPayload | null = null
    if (stored.format === 'epub') {
      const [cached, parsed] = await Promise.all([
        this.readCoverCache(bookId),
        this.loadStoredEpub(stored)
      ])
      if (cached !== 'missing') {
        cover = cached
      } else if (parsed) {
        await this.writeCoverCache(bookId, parsed.cover).catch(() => undefined)
        cover = toPublicCover(parsed.cover)
      }
      if (parsed) metadata = parsed.metadata
    }

    return {
      book: publicBook(stored),
      fileSizeBytes: fileInfo.size,
      metadata,
      cover
    }
  }

  updateBookMetadata(bookId: string, title: string, author: string | null): BookRecord {
    const book = this.database.updateBookMetadata(bookId, title, author)
    if (!book) throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))
    return book
  }

  updateBookProgress(bookId: string, locator: string, progress: number): void {
    if (!this.database.updateBookProgress(bookId, locator, progress, new Date().toISOString())) {
      throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))
    }
  }

  listInsights(bookId: string): SavedInsight[] {
    if (!this.database.getStoredBook(bookId)) {
      throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))
    }
    return this.database.listInsights(bookId)
  }

  saveInsight(input: SaveInsightInput): SavedInsight {
    if (!this.database.getStoredBook(input.bookId)) {
      throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))
    }
    return this.database.insertInsight(randomUUID(), input, new Date().toISOString())
  }

  deleteInsight(id: string): boolean {
    return this.database.deleteInsight(id)
  }

  updateInsightHistory(input: UpdateInsightHistoryInput): SavedInsight {
    if (!this.database.getStoredBook(input.bookId)) {
      throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))
    }
    const updated = this.database.updateInsightHistory(input.id, input)
    if (!updated) throw new AppError('INSIGHT_NOT_FOUND', copy('insights.alreadyRemoved'))
    return updated
  }

  listHighlights(bookId: string): HighlightRecord[] {
    if (!this.database.getStoredBook(bookId)) {
      throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))
    }
    return this.database.listHighlights(bookId)
  }

  saveHighlight(input: SaveHighlightInput): HighlightRecord {
    if (!this.database.getStoredBook(input.bookId)) {
      throw new AppError('BOOK_NOT_FOUND', copy('error.bookNotFound'))
    }
    const existing = this.database.findHighlightByAnchor(input.bookId, input.anchor)
    if (existing) return existing
    return this.database.insertHighlight(randomUUID(), input, new Date().toISOString())
  }

  deleteHighlight(id: string): boolean {
    return this.database.deleteHighlight(id)
  }

  private async readCoverCache(bookId: string): Promise<CachedCover> {
    try {
      const entries = await readdir(this.coverDirectory)
      if (entries.includes(`${bookId}${NO_COVER_MARKER}`)) return null
      const coverFile = entries.find((name) => name.startsWith(`${bookId}.`))
      if (!coverFile) return 'missing'
      const mimeType = COVER_MIME_BY_EXTENSION[extname(coverFile).toLowerCase()]
      if (!mimeType) return 'missing'
      const bytes = await readFile(join(this.coverDirectory, coverFile))
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_COVER_BYTES) return 'missing'
      return { mimeType, bytes: Uint8Array.from(bytes) }
    } catch {
      return 'missing'
    }
  }

  private async writeCoverCache(bookId: string, cover: ExtractedCover | null): Promise<void> {
    await mkdir(this.coverDirectory, { recursive: true })
    const fileName = cover ? `${bookId}.${cover.extension}` : `${bookId}${NO_COVER_MARKER}`
    try {
      await writeFile(join(this.coverDirectory, fileName), cover?.bytes ?? new Uint8Array(), {
        flag: 'wx',
        mode: 0o600
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  private async parseStoredEpub(stored: StoredBook): Promise<StoredEpubInfo | null> {
    try {
      const bytes = await readFile(this.resolveStoredPath(stored.storedName))
      const zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false })
      const pkg = await readEpubPackage(zip)
      return {
        packagePath: pkg.packagePath,
        packageXml: pkg.packageXml,
        metadata: extractBookMetadata(pkg.packageXml),
        cover: await extractEpubCover(zip, pkg.packagePath, pkg.packageXml)
      }
    } catch {
      return null
    }
  }

  private loadStoredEpub(stored: StoredBook): Promise<StoredEpubInfo | null> {
    if (stored.format !== 'epub') return Promise.resolve(null)
    const existing = this.epubInfoPromises.get(stored.id)
    if (existing) return existing

    const tracked = this.enqueueEpubParse(stored)
    const promise = tracked.finally(() => {
      if (this.epubInfoPromises.get(stored.id) === promise) this.epubInfoPromises.delete(stored.id)
    })
    this.epubInfoPromises.set(stored.id, promise)
    return promise
  }

  private enqueueEpubParse(stored: StoredBook): Promise<StoredEpubInfo | null> {
    const run = async (): Promise<StoredEpubInfo | null> => this.parseStoredEpub(stored)
    const result = this.epubParseQueue.then(run, run)
    this.epubParseQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private resolveStoredPath(storedName: string): string {
    const root = resolve(this.libraryDirectory)
    const candidate = resolve(join(root, storedName))
    const pathWithinRoot = relative(root, candidate)
    if (!pathWithinRoot || pathWithinRoot.startsWith('..') || isAbsolute(pathWithinRoot)) {
      throw new AppError('INVALID_STORAGE_PATH', copy('error.storagePath'))
    }
    return candidate
  }
}
