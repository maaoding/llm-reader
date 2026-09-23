import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { copy } from '@shared/copy'
import { OCR_MAX_PAGES } from '@shared/vision-ocr'
import { renderPdfOcrPage } from './pdf-ocr'

/** Keep preview rendering separate from reader zoom, highlights and reading progress. */
export async function loadPdfPreview(bookId: string, pageNumber: number, signal: AbortSignal): Promise<{ imageDataUrl: string; pageCount: number }> {
  signal.throwIfAborted()
  const payload = await window.readerApi.readBook(bookId)
  signal.throwIfAborted()
  if (payload.book.format !== 'pdf' || payload.bytes.length > 200_000_000) throw new Error(copy('knowledge.tooLarge'))
  const pdf = await import('pdfjs-dist')
  signal.throwIfAborted()
  pdf.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const task = pdf.getDocument({ data: payload.bytes, isEvalSupported: false, useSystemFonts: false })
  let destroyed: Promise<void> | undefined
  const destroy = () => { destroyed ??= task.destroy(); void destroyed.catch(() => undefined) }
  signal.addEventListener('abort', destroy, { once: true })
  try {
    const document = await task.promise
    signal.throwIfAborted()
    if (document.numPages > OCR_MAX_PAGES) throw new Error(copy('knowledge.tooLarge'))
    if (pageNumber < 1 || pageNumber > document.numPages) throw new Error(copy('vision.previewPageRange', { count: document.numPages }))
    return { imageDataUrl: await renderPdfOcrPage(document, pageNumber, signal), pageCount: document.numPages }
  } finally {
    signal.removeEventListener('abort', destroy)
    destroy()
    await destroyed!.catch(() => undefined)
  }
}
