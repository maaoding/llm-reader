/* global document, Element, MutationObserver, performance, requestAnimationFrame, window */
import { _electron as electron, expect } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { platform, release, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const pageCount = 1000
const pageSizes = [[600, 800], [800, 600], [400, 900]]
const phase = process.env.LLM_READER_BENCH_PHASE ?? 'current'
const outputFile = resolve(`output/benchmarks/pdf-layout/${phase}.json`)

// Generate a local PDF without Python, additional packages or private samples.
function fixturePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, index) => `${4 + index * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  for (let index = 0; index < pageCount; index++) {
    const [width, height] = pageSizes[index % pageSizes.length]
    const stream = `BT /F1 12 Tf 24 ${height - 48} Td (Page ${index + 1}: mixed page sizes for layout measurement.) Tj ET\n`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`
    )
  }
  const parts = ['%PDF-1.4\n']
  let length = Buffer.byteLength(parts[0])
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(length)
    const part = `${index + 1} 0 obj\n${object}\nendobj\n`
    parts.push(part)
    length += Buffer.byteLength(part)
  }
  parts.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`)
  parts.push(offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join(''))
  parts.push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`)
  return parts.join('')
}

const workspace = await mkdtemp(join(tmpdir(), 'llm-reader-pdf-layout-'))
let application
try {
  const fixture = join(workspace, 'PDF layout benchmark.pdf')
  await writeFile(fixture, fixturePdf())
  application = await electron.launch({ args: ['.'], env: {
    ...process.env,
    LLM_READER_USER_DATA: join(workspace, 'profile'),
    LLM_READER_E2E_IMPORT: fixture
  } })
  const page = await application.firstWindow()
  await expect(page.locator('[data-workspace-ready="true"]')).toBeVisible({ timeout: 90_000 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="reader-host"]')
    const probe = { active: false, widths: 0, styles: 0 }
    window.__pdfLayoutProbe = probe
    const originalStyle = window.getComputedStyle
    window.getComputedStyle = function (element, ...args) {
      if (probe.active && element.classList.contains('pdf-document')) probe.styles++
      return originalStyle.call(this, element, ...args)
    }
    const width = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth').get
    Object.defineProperty(host, 'clientWidth', { configurable: true, get() {
      if (probe.active) probe.widths++
      return width.call(host)
    } })
  })

  const beforeOpening = await metrics()
  const opened = await page.evaluate(() => new Promise((done, fail) => {
    const probe = window.__pdfLayoutProbe
    const surface = document.querySelector('.reader-surface')
    const start = performance.now()
    const observer = new MutationObserver(() => {
      if (!surface.classList.contains('is-ready')) return
      probe.active = false
      window.clearTimeout(timer)
      observer.disconnect()
      done({ readyMs: performance.now() - start, widthReads: probe.widths, styleReads: probe.styles })
    })
    const timer = window.setTimeout(() => {
      observer.disconnect()
      fail(new Error('PDF did not become ready within two minutes'))
    }, 120_000)
    observer.observe(surface, { attributes: true, attributeFilter: ['class'] })
    probe.active = true
    document.querySelector('[data-testid="book-item"]').click()
  }))
  const afterOpening = await metrics()
  const opening = { ...opened,
    layoutCount: afterOpening.LayoutCount - beforeOpening.LayoutCount,
    layoutMs: (afterOpening.LayoutDuration - beforeOpening.LayoutDuration) * 1000 }
  await expect(page.locator('.pdf-page')).toHaveCount(pageCount)
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 })
  await page.getByTestId('reader-settings-button').click()

  const pageGeometry = () => page.evaluate(() => [...document.querySelectorAll('.pdf-page')]
    .filter((_, index, pages) => index < 3 || index === pages.length - 1)
    .map((element) => ({ page: Number(element.dataset.pageNumber), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })))
  const assertGeometry = (geometry) => {
    for (const bounds of geometry) {
      const [width, height] = pageSizes[(bounds.page - 1) % pageSizes.length]
      expect(bounds.width / bounds.height).toBeCloseTo(width / height, 2)
      expect(Math.abs(bounds.width - geometry[0].width)).toBeLessThan(1)
    }
  }
  opening.geometry = await pageGeometry()
  assertGeometry(opening.geometry)

  const samples = []
  for (let index = 0; index < 8; index++) {
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    const before = await metrics()
    const sync = await page.evaluate((zoomIn) => {
      const probe = window.__pdfLayoutProbe
      probe.widths = 0; probe.styles = 0; probe.active = true
      const start = performance.now()
      document.querySelector(`button[aria-label="${zoomIn ? '放大' : '缩小'}"]`).click()
      const syncMs = performance.now() - start
      probe.active = false
      return { syncMs, widthReads: probe.widths, styleReads: probe.styles }
    }, index % 2 === 0)
    const after = await metrics()
    await expect(page.locator('.pdf-page').first()).toHaveAttribute('aria-busy', 'false', { timeout: 90_000 })
    const geometry = await pageGeometry()
    assertGeometry(geometry)
    samples.push({ warmup: index < 2, ...sync, geometry,
      layoutCount: after.LayoutCount - before.LayoutCount,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount
    })
  }
  const median = (values) => {
    values.sort((a, b) => a - b)
    const middle = Math.floor(values.length / 2)
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
  }
  const measured = samples.filter((sample) => !sample.warmup)
  const medians = Object.fromEntries(['syncMs', 'widthReads', 'styleReads', 'layoutCount', 'layoutMs']
    .map((key) => [key, median(measured.map((sample) => sample[key]))]))
  const environment = { platform: platform(), release: release(), node: process.versions.node,
    electron: await application.evaluate(() => process.versions.electron),
    window: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })) }
  await mkdir(dirname(outputFile), { recursive: true })
  await writeFile(outputFile, JSON.stringify({ phase, pages: pageCount, environment, opening, samples, medians }, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ outputFile, opening, medians }, null, 2) + '\n')
} finally {
  await application?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
  }).catch(() => undefined)
  await application?.close().catch(() => undefined)
  await rm(workspace, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 })
}
