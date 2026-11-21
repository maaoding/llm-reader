/* global process */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import { chapters, evidence, fixtureContract, fixturePayload, fixtureTitle, pdfPages, questions, schemaVersion, sources } from './independent-reading-fixture.mjs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const root = dirname(fileURLToPath(import.meta.url))
const output = resolve(process.argv[2] ?? 'tmp/independent-reading-fixtures')
await mkdir(output, { recursive: true })
const fixedDate = new Date('2026-10-20T00:00:00Z')
const zip = new JSZip()
const add = (name, text, compression = 'DEFLATE') => zip.file(name, text, { compression, date: fixedDate, createFolders: false })
add('mimetype', 'application/epub+zip', 'STORE')
add('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
add('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:llm-reader:independent-seed-archive:1</dc:identifier><dc:title>${xml(sources[0].title)}</dc:title><dc:creator>LLM Reader authored holdout</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-20T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((c) => `<item id="c${c.number}" href="chapter-${c.number}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((c) => `<itemref idref="c${c.number}"/>`).join('')}</spine></package>`)
add('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${chapters.map((c) => `<li><a href="chapter-${c.number}.xhtml">${xml(c.title)}</a></li>`).join('')}</ol></nav></body></html>`)
for (const c of chapters) add(`OEBPS/chapter-${c.number}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xml(c.title)}</title></head><body><h1>${xml(c.title)}</h1>${c.paragraphs.map((p, index) => `<p id="p-${c.number}-${index + 1}">${xml(p)}</p>`).join('')}</body></html>`)
const epubPath = join(output, 'glasshouse-seed-archive.epub')
await writeFile(epubPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
const pdfSourcePath = join(output, 'pdf-source.json')
await writeFile(pdfSourcePath, JSON.stringify({ title: sources[1].title, pages: pdfPages }, null, 2) + '\n')
const pdfCheck = JSON.parse(execFileSync('python', [join(root, 'independent-reading-pdf.py'), pdfSourcePath, output], { encoding: 'utf8' }))
const characters = Array.from(chapters.map((c) => [c.title, ...c.paragraphs].join('\n')).join('\n')).length
if (characters < 80_000) throw new Error('Long EPUB must contain at least 80,000 Unicode characters')
const files = []
for (const [key, filename] of [['epub', 'glasshouse-seed-archive.epub'], ['digital', 'ridge-nursery-digital.pdf'], ['scanned', 'ridge-nursery-scanned.pdf']]) {
  const path = join(output, filename)
  files.push({ key, path: filename, sha256: sha256(await readFile(path)), ...(key === 'epub' ? { characters, chapters: chapters.length } : { pages: pdfCheck.pages, scanned: key === 'scanned' }) })
}
const manifest = { schemaVersion, fixtureTitle, fixtureSha256: sha256(JSON.stringify(fixtureContract)), questionsSha256: sha256(JSON.stringify(questions)), payloadSha256: sha256(JSON.stringify(fixturePayload)), authored: true, personalContent: false, files, questions, evidence, validation: pdfCheck }
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(join(output, 'frozen-fixture.json'), JSON.stringify(fixturePayload, null, 2) + '\n')
process.stdout.write(JSON.stringify({ fixtureSha256: manifest.fixtureSha256, questionsSha256: manifest.questionsSha256, characters, files, validation: pdfCheck }, null, 2) + '\n')
