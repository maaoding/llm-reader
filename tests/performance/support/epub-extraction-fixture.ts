import JSZip from 'jszip'
import type { BookPayload, BookRecord } from '../../../src/shared/contracts'

/** A real, local EPUB archive shared by extraction tests and benchmarks. */
export async function epubExtractionFixture(chapters: ReadonlyArray<{ href: string; body: string }>, navigation = ''): Promise<BookPayload> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file('OEBPS/book.opf', `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">extraction-fixture</dc:identifier><dc:title>原文提取样本</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map(({ href }, index) => `<item id="c${index}" href="${href}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, index) => `<itemref idref="c${index}"/>`).join('')}</spine></package>`)
  const xhtml = (body: string) => `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>原文提取样本</title></head><body>${body}</body></html>`
  zip.file('OEBPS/nav.xhtml', xhtml(`<nav epub:type="toc"><ol>${navigation}</ol></nav>`))
  for (const { href, body } of chapters) zip.file(`OEBPS/${decodeURI(href)}`, xhtml(body))
  return { book: { format: 'epub' } as BookRecord, bytes: await zip.generateAsync({ type: 'uint8array' }) }
}
