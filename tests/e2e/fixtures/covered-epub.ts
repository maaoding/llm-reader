import { writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

const COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8xUowAAAABJRU5ErkJggg==',
  'base64'
)

/**
 * Creates a small EPUB with a raster cover and common reading metadata so E2E
 * tests can observe both the shelf cover and the book details modal.
 */
export async function createCoveredEpubFixture(
  path: string,
  options: { identifier?: string; title?: string } = {}
): Promise<void> {
  const identifier = options.identifier ?? 'urn:isbn:9787111111111'
  const title = options.title ?? '带封面的元数据样本'
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${identifier}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:publisher>示例出版社</dc:publisher>
    <dc:date>2024-05-01</dc:date>
    <dc:description>用于验证书籍信息窗口显示对阅读有参考价值的常用元数据。</dc:description>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">第一章</a></li></ol></nav></body>
</html>`
  )
  zip.file(
    'OEBPS/chapter.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>第一章</title></head>
  <body><h1>第一章</h1><p>封面与元数据窗口的桌面交互验证。</p></body>
</html>`
  )
  zip.file('OEBPS/images/cover.png', COVER_PNG)

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(path, bytes)
}
