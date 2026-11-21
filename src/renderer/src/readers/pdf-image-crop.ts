import type { PDFPageProxy } from 'pdfjs-dist'
import type { PdfImageRegionSource } from '@shared/contracts'
import { PDF_REGION_IMAGE_MAX_DATA_URL, PDF_REGION_IMAGE_MAX_EDGE, PDF_REGION_IMAGE_MAX_PIXELS, validPdfImageRegion } from '@shared/pdf-image-region'

/** Render source pixels without reader zoom, theme, highlights, or interactive annotations. */
export async function capturePdfImageRegion(page: PDFPageProxy, source: PdfImageRegionSource, signal?: AbortSignal): Promise<string> {
  if (!validPdfImageRegion(source)) throw new Error('Invalid image region')
  signal?.throwIfAborted()
  const { AnnotationMode } = await import('pdfjs-dist')
  const base = page.getViewport({ scale: 1 })
  if (![base.width, base.height].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Invalid PDF page size')
  const scale = Math.min(3, PDF_REGION_IMAGE_MAX_EDGE / Math.max(base.width, base.height), Math.sqrt(16_000_000 / (base.width * base.height)))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const crop = document.createElement('canvas')
  try {
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    const render = page.render({ canvas, viewport, background: '#ffffff', annotationMode: AnnotationMode.DISABLE })
    const abort = () => render.cancel()
    signal?.addEventListener('abort', abort, { once: true })
    try { await render.promise; signal?.throwIfAborted() }
    finally { signal?.removeEventListener('abort', abort) }
    const left = Math.floor(source.left * canvas.width), top = Math.floor(source.top * canvas.height)
    const width = Math.max(1, Math.ceil(source.right * canvas.width) - left)
    const height = Math.max(1, Math.ceil(source.bottom * canvas.height) - top)
    if (width < 24 || height < 24) throw new Error('Image region is too small')
    const outputScale = Math.min(1, Math.sqrt(PDF_REGION_IMAGE_MAX_PIXELS / (width * height)))
    crop.width = Math.max(1, Math.floor(width * outputScale))
    crop.height = Math.max(1, Math.floor(height * outputScale))
    const context = crop.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.drawImage(canvas, left, top, width, height, 0, 0, crop.width, crop.height)
    const image = crop.toDataURL('image/jpeg', 0.86)
    if (!image.startsWith('data:image/jpeg;base64,') || image.length > PDF_REGION_IMAGE_MAX_DATA_URL) throw new Error('Image region is too large')
    return image
  } finally { canvas.width = 0; canvas.height = 0; crop.width = 0; crop.height = 0 }
}
