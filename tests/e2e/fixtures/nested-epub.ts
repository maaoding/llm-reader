import { writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

/**
 * Creates a small reflowable EPUB whose navigation depth and authored black
 * text are both observable from Electron E2E tests.
 */
export async function createNestedEpubFixture(path: string): Promise<void> {
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
    <dc:identifier id="book-id">urn:uuid:llm-reader-nested-toc</dc:identifier>
    <dc:title>嵌套目录与夜间阅读样本</dc:title>
    <dc:creator>LLM Reader</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
    <itemref idref="chapter-2"/>
  </spine>
</package>`
  )
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li>
          <a href="chapter-1.xhtml">第一部</a>
          <ol>
            <li><a href="chapter-1.xhtml#section-a">概念边界</a></li>
            <li><a href="chapter-2.xhtml">第二章</a></li>
          </ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`
  )
  zip.file(
    'OEBPS/chapter-1.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>第一部</title>
    <style>body { color: #111111; } p { margin: 0 0 1em; }</style>
  </head>
  <body>
    <h1>第一部</h1>
    <p>这一章用于确认原书黑色文字在深色应用框架中仍位于浅色书页上。</p>
    <h2 id="section-a">概念边界</h2>
    <p>目录标题应该跳转，展开按钮则只负责折叠目录树。</p>
    <blockquote><p>引文不应获得普通正文的首行缩进。</p></blockquote>
  </body>
</html>`
  )
  zip.file(
    'OEBPS/chapter-2.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>第二章</title><style>body { color: #111111; }</style></head>
  <body><h1>第二章</h1><p>后续加载章节也应继承当前阅读偏好。</p></body>
</html>`
  )

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(path, bytes)
}
