import type { BookExtractionApi, BookExtractionInput } from '@shared/contracts'
import { extractBookSections } from './readers/book-extraction'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { renderPdfOcrPage } from './readers/pdf-ocr'

const api = (window as unknown as { bookExtractor: BookExtractionApi }).bookExtractor
let input: BookExtractionInput | undefined
void (async () => {
  const job = await api.read()
  input = job.input
  if (job.payload.book.format === 'pdf') {
    const pdf = await import('pdfjs-dist')
    pdf.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const task = pdf.getDocument({ data: job.payload.bytes, isEvalSupported: false, useSystemFonts: false })
    let unsubscribe: (() => void) | undefined
    try {
      const document = await task.promise
      let rendering = false
      unsubscribe = api.onPdfPageRequest((request) => {
        if (request.bookId !== job.input.bookId || request.jobId !== job.input.jobId || rendering) return
        rendering = true
        void (async () => {
          let imageDataUrl: string | null = null
          try { imageDataUrl = await renderPdfOcrPage(document, request.pageNumber) } catch { /* Main process reports this page's failure. */ }
          rendering = false
          await api.submitPdfPage({ ...request, imageDataUrl })
        })().catch(() => undefined)
      })
      await api.processPdf({ ...job.input, pageCount: document.numPages })
    } finally { unsubscribe?.(); await task.destroy() }
    return
  }
  await extractBookSections(job.payload, new AbortController().signal, (sections, document) => api.append({ ...job.input, sections, document }))
  await api.finish(job.input)
})().catch(async () => {
  if (input) await api.fail(input).catch(() => undefined)
})
