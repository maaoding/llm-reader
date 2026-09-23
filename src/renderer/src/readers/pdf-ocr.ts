import { AnnotationMode, type PDFDocumentProxy } from 'pdfjs-dist'
import { OCR_MAX_IMAGE_DATA_URL, OCR_MAX_IMAGE_EDGE } from '@shared/vision-ocr'

/** Render the original page independently of reader zoom, highlights and theme. */
export async function renderPdfOcrPage(pdf: PDFDocumentProxy, pageNumber: number, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) throw new Error('Invalid PDF page')
  const page = await pdf.getPage(pageNumber)
  const canvas = document.createElement('canvas')
  try {
    signal?.throwIfAborted()
    const base = page.getViewport({ scale: 1 })
    if (![base.width, base.height].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Invalid PDF size')
    const viewport = page.getViewport({ scale: Math.min(3, OCR_MAX_IMAGE_EDGE / Math.max(base.width, base.height)) })
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const render = page.render({ canvas, viewport, background: '#ffffff', annotationMode: AnnotationMode.DISABLE })
    const abort = () => render.cancel()
    signal?.addEventListener('abort', abort, { once: true })
    try { await render.promise; signal?.throwIfAborted() }
    finally { signal?.removeEventListener('abort', abort) }
    const image = canvas.toDataURL('image/jpeg', 0.9)
    if (!image.startsWith('data:image/jpeg;base64,') || image.length > OCR_MAX_IMAGE_DATA_URL) throw new Error('Invalid PDF image')
    return image
  } finally {
    canvas.width = 0; canvas.height = 0
    page.cleanup()
  }
}
