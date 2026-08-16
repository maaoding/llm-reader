import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import JSZip from 'jszip'
import type {
  BookFormat,
  BookPayload,
  BookRecord,
  HighlightRecord,
  ImportedBookResult,
  SavedInsight,
  SaveHighlightInput,
  SaveInsightInput
} from '@shared/contracts'
import { copy } from '@shared/copy'
import { AppDatabase, type StoredBook } from './database'
import { AppError } from './errors'

const MAX_IMPORT_BYTES = 250 * 1024 * 1024
const MAX_TXT_BYTES = 64 * 1024 * 1024
const MAX_EPUB_ENTRIES = 20_000
const MAX_METADATA_BYTES = 2 * 1024 * 1024
const MAX_EPUB_ENTRY_BYTES = 128 * 1024 * 1024
const MAX_EPUB_EXPANDED_BYTES = 512 * 1024 * 1024

interface ValidatedBook {
  format: BookFormat
  title: string
  author: string | null
}

function publicBook(book: StoredBook): BookRecord {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    originalName: book.originalName,
    importedAt: book.importedAt,
    lastOpenedAt: book.lastOpenedAt,
    lastLocator: book.lastLocator,
    progress: book.progress
  }
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

function extractXmlText(xml: string, localName: string): string | null {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = xml.match(new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}>`, 'i'))
  if (!match) return null
  const text = decodeXmlEntities(match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
  return text || null
}

function safeZipPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '')
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

  const containerXml = await readZipText(zip, 'META-INF/container.xml')
  const rootfileMatch = containerXml.match(/<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i)
  if (!rootfileMatch) throw new AppError('INVALID_EPUB', copy('error.epubMissingContent'))

  const packageXml = await readZipText(zip, decodeXmlEntities(rootfileMatch[1]))
  return {
    format: 'epub',
    title: extractXmlText(packageXml, 'title') ?? fallbackTitle,
    author: extractXmlText(packageXml, 'creator')
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
  return { format: 'txt', title: fallbackTitle, author: null }
}

export class LibraryService {
  constructor(
    private readonly database: AppDatabase,
    private readonly libraryDirectory: string
  ) {
    if (!isAbsolute(libraryDirectory)) {
      throw new Error('libraryDirectory must be absolute')
    }
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
    if (extension !== '.epub' && extension !== '.txt') {
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
    const validated =
      extension === '.epub' ? await validateEpub(bytes, fallbackTitle) : validateTxt(bytes, fallbackTitle)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const duplicate = this.database.findBookByHash(sha256)
    if (duplicate) return { book: publicBook(duplicate), duplicate: true }

    await mkdir(this.libraryDirectory, { recursive: true })
    const storedName = `${sha256}${extension}`
    const destination = this.resolveStoredPath(storedName)
    try {
      await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
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
      originalName,
      importedAt: now,
      lastOpenedAt: null,
      lastLocator: null,
      progress: 0
    })
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
      originalName: stored.originalName,
      importedAt: stored.importedAt,
      lastOpenedAt: openedAt,
      lastLocator: stored.lastLocator,
      progress: stored.progress
    }
    return { book, bytes: Uint8Array.from(bytes) }
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
