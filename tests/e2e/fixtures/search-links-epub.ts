import { writeFile } from 'node:fs/promises'
import JSZip from 'jszip'

export async function createSearchLinksEpubFixture(path: string): Promise<void> {
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
    <dc:identifier id="book-id">urn:uuid:llm-reader-search-links</dc:identifier>
    <dc:title>全文搜索与内链样本</dc:title>
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
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
  <nav epub:type="toc"><ol>
    <li><a href="chapter-1.xhtml">第一章</a></li>
    <li><a href="chapter-2.xhtml">第二章</a></li>
  </ol></nav>
</body></html>`
  )
  zip.file(
    'OEBPS/chapter-1.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>
  <h1>第一章</h1>
  <p id="natural-start">SearchToken 首次出现在自然阅读位置附近。</p>
  <p><a id="same-fragment" href="#footnote">查看脚注</a></p>
  <p><a id="cross-chapter" href="chapter-2.xhtml#destination">前往第二章</a></p>
  <p>
    <a id="external-http" href="https://example.com">外部网站</a>
    <a id="external-relative" href="//example.com">协议相对</a>
    <a id="absolute-path" href="/etc/passwd">绝对路径</a>
    <a id="path-traversal" href="../secret.xhtml">路径穿越</a>
    <a id="script-link" href="javascript:alert(1)">脚本</a>
    <a id="mail-link" href="mailto:test@example.com">邮件</a>
  </p>
  ${Array.from({ length: 36 }, (_, index) => `<p>第一章填充段落 ${index + 1}：用于让跨章搜索和链接产生可观察的连续滚动。</p>`).join('\n  ')}
  <aside id="footnote">这是书内脚注正文，不使用弹窗。</aside>
</body></html>`
  )
  zip.file(
    'OEBPS/chapter-2.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body>
  <h1>第二章</h1>
  <p id="destination">第二章包含小写 searchtoken，用于验证跨章和大小写搜索。</p>
</body></html>`
  )
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await writeFile(path, bytes)
}
