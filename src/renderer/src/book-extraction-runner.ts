import type { BookExtractionApi, BookExtractionInput } from '@shared/contracts'
import { extractBookSections } from './readers/book-extraction'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const api = (window as unknown as { bookExtractor: BookExtractionApi }).bookExtractor
let input: BookExtractionInput | undefined
void (async () => {
  const job = await api.read()
  input = job.input
  if (job.payload.book.format === 'pdf') {
    const pdf = await import('pdfjs-dist')
    pdf.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const task = pdf.getDocument({ data: job.payload.bytes, isEvalSupported: false, useSystemFonts: false })
    try {
      const document = await task.promise
      await api.processPdf({ ...job.input, pageCount: document.numPages })
    } finally { await task.destroy() }
    return
  }
  await extractBookSections(job.payload, new AbortController().signal, (sections, document) => api.append({ ...job.input, sections, document }))
  await api.finish(job.input)
})().catch(async () => {
  if (input) await api.fail(input).catch(() => undefined)
})
