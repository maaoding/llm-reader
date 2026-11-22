import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'

const siteRoot = resolve('site')
const html = readFileSync(resolve(siteRoot, 'index.html'), 'utf8')
const styles = readFileSync(resolve(siteRoot, 'styles.css'), 'utf8')
const script = readFileSync(resolve(siteRoot, 'script.js'), 'utf8')
const copySource = readFileSync(resolve('src/shared/copy.md'), 'utf8')
const document = new JSDOM(html).window.document

function startDemo() {
  const runtime = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = runtime
  window.matchMedia = () => ({ matches: false }) as MediaQueryList
  window.HTMLElement.prototype.scrollTo = vi.fn()
  window.eval(script)
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => {
    const element = window.document.querySelector<T>(selector)
    if (!element) throw new Error('Missing demo element ' + selector)
    return element
  }
  return { window, get }
}

describe('static product website', () => {
  it('has one semantic page heading and the expected regions', () => {
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(document.querySelector('header nav[aria-label="主导航"]')).not.toBeNull()
    expect(document.querySelector('header#top')).not.toBeNull()
    expect(document.querySelector('main')).not.toBeNull()
    expect(document.querySelector('#capabilities')).not.toBeNull()
    expect(document.querySelector('#formats')).not.toBeNull()
    expect(document.querySelector('footer')).not.toBeNull()
  })

  it('keeps every in-page link connected to an existing section', () => {
    const inPageLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))

    expect(inPageLinks.length).toBeGreaterThan(0)
    for (const link of inPageLinks) {
      const target = link.getAttribute('href')
      expect(target).toBeTruthy()
      expect(target).not.toBe('#')
      expect(document.querySelector(target!)).not.toBeNull()
    }
  })

  it('offers Store purchase and source build instructions at both installation entrances', () => {
    const store = 'https://apps.microsoft.com/detail/9PL7FB24VJMV'
    const build = '/docs/build-from-source.html'
    for (const actions of ['.hero .hero-actions', '.final-cta .hero-actions']) {
      expect(document.querySelector(`${actions} .button-primary`)?.getAttribute('href')).toBe(store)
      expect(document.querySelector(`${actions} .button-secondary`)?.getAttribute('href')).toBe(build)
    }
    expect(document.querySelector('a[href*="/releases/latest"]')).toBeNull()
    for (const path of ['README.md', 'docs/manual/index.md', 'docs/manual/getting-started.md']) {
      const source = readFileSync(resolve(path), 'utf8')
      expect(source).toContain(store)
      expect(source).toMatch(/build-from-source\.(html|md)/u)
    }
    expect(readFileSync(resolve('docs/manual/build-from-source.md'), 'utf8')).toContain('/tree/store-v1.4.0.0')
  })

  it('ships a desktop-shaped Reader demo built from markup instead of screenshots', () => {
    const demo = document.querySelector('[data-reader-demo]')
    const passiveControls = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-demo-passive]'))
    const scriptElement = document.querySelector<HTMLScriptElement>('script[src^="./script.js"]')

    expect(demo?.getAttribute('data-demo-state')).toBe('selected')
    expect(demo?.querySelector('.demo-workspace-header')).not.toBeNull()
    expect(demo?.querySelector('.demo-book-tab')).not.toBeNull()
    expect(demo?.querySelector('.demo-bookbar')).not.toBeNull()
    expect(demo?.querySelector('.demo-bookbar .demo-reading-position .demo-title-progress')).not.toBeNull()
    expect(demo?.querySelector('.demo-reader-column .demo-reader-header')).toBeNull()
    expect(demo?.querySelector('.demo-workspace-header > .demo-workspace-settings')).not.toBeNull()
    expect(demo?.querySelector('.demo-workspace-header nav .demo-workspace-settings')).toBeNull()
    expect(demo?.querySelector('.demo-reader-rail')).not.toBeNull()
    expect(demo?.querySelector('.demo-reader-column')).not.toBeNull()
    expect(demo?.querySelector('.demo-right-sidebar')).not.toBeNull()
    expect(Array.from(demo?.querySelectorAll('.demo-bookbar nav button') ?? []).map((button) => button.textContent?.trim())).toEqual(['阅读', '笔记', '对话'])
    expect(demo?.querySelector('.demo-book-actions .demo-book-prepare')?.textContent).toBe('本书准备')
    expect(demo?.querySelector('button[data-demo-fullscreen]')?.getAttribute('aria-pressed')).toBe('false')
    expect(passiveControls.length).toBeGreaterThan(10)
    expect(passiveControls.every((control) => control.getAttribute('aria-disabled') === 'true')).toBe(true)
    expect(document.querySelector('[data-demo-explain]')).not.toBeNull()
    expect(document.querySelector('.demo-selected-paragraph > .demo-selection-toolbar')).not.toBeNull()
    expect(document.querySelector('.demo-selection-spark svg')).not.toBeNull()
    expect(document.querySelector('[data-demo-explain] svg')).not.toBeNull()
    expect(document.querySelector('.demo-selection-toolbar')?.textContent).not.toContain('✦')
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.demo-selection-toolbar button')).map((button) => button.textContent?.trim())).toEqual(['解释这段', '联系上下文', '自由提问', '摘录这段', ''])
    expect(document.querySelector('.demo-selection-toolbar .toolbar-close')?.getAttribute('aria-label')).toBe('关闭选区工具')
    expect(document.querySelector('.demo-assistant-tabs')).toBeNull()
    expect(styles).not.toContain('.demo-assistant-tabs')
    expect(demo?.querySelector('[data-demo-turns]')?.childElementCount).toBe(0)
    expect(demo?.querySelectorAll('button[data-demo-copy-session]:disabled')).toHaveLength(2)
    expect(document.querySelector('[data-demo-selection]')?.getAttribute('tabindex')).toBe('0')
    expect(scriptElement).not.toBeNull()
    expect(scriptElement?.hasAttribute('defer')).toBe(true)
    expect(existsSync(resolve(siteRoot, 'script.js'))).toBe(true)
    expect(script).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
  })

  it('previews the cited text in place and jumps only on request', () => {
    const { window, get } = startDemo()
    try {
      get('[data-demo-explain]').click()
      const prompt = get<HTMLDetailsElement>('.demo-question-prompt')
      const currentExplainPrompt = copySource.match(/^\| assistant\.questionExplain \| (.+) \|\r?$/mu)?.[1]
      expect(currentExplainPrompt).toBeTruthy()
      expect(prompt.open).toBe(false)
      expect(prompt.querySelector('summary')?.textContent).toBe('查看本次提示词')
      expect(prompt.textContent).toContain(currentExplainPrompt!.split('。')[0])
      expect(prompt.textContent).toContain('以原文为依据')
      expect(prompt.textContent).toContain('区分明确表述与推断')

      get('button[data-demo-view="conversation"]').click()
      const citation = get('.demo-citation')
      const preview = get('#demo-source-preview')
      const reader = get('.demo-reader-surface')
      citation.focus()
      expect(citation.getAttribute('aria-expanded')).toBe('true')
      expect(preview.hidden).toBe(false)
      expect(preview.querySelector('strong')?.textContent).toBe('理解复杂概念')
      expect(preview.querySelector('small')?.textContent).toBe('全文')
      expect(get('.demo-preview-text').textContent).toBe(get('[data-demo-passage="P1"]').textContent)
      citation.click()
      expect(window.document.activeElement).toBe(get('.demo-preview-text'))
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(preview.hidden).toBe(true)
      expect(window.document.activeElement).toBe(citation)
      get<HTMLDetailsElement>('.demo-answer-sources').open = true
      for (const id of ['P1', 'P2', 'P3']) {
        get(`.demo-answer-sources button[data-demo-preview="${id}"]`).click()
        expect(get('.demo-preview-text').textContent).toBe(get(`[data-demo-passage="${id}"]`).textContent)
        expect(get('[data-reader-demo]').dataset.demoView).toBe('conversation')
        expect(reader.scrollTo).not.toHaveBeenCalled()
      }
      get('[data-demo-jump]').click()
      expect(preview.hidden).toBe(true)
      expect(get('[data-reader-demo]').dataset.demoView).toBe('reading')
      expect(window.document.activeElement).toBe(get('[data-demo-passage="P3"]'))
      expect(reader.scrollTo).toHaveBeenCalledOnce()
    } finally {
      window.close()
    }
  })

  it('keeps the same draft and completed turns across views and copies only the requested content', async () => {
    const { window, get } = startDemo()
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText } })
    try {
      get('[data-demo-explain]').click()
      const composer = get<HTMLTextAreaElement>('#demo-followup')
      composer.value = '遇到陡坡时呢？'
      composer.dispatchEvent(new window.Event('input'))
      get('button[data-demo-fullscreen]').click()
      get('[data-demo-close-assistant]').click()
      expect(get('.demo-right-sidebar').hidden).toBe(true)
      get('[data-demo-open-assistant]').click()
      get('button[data-demo-view="conversation"]').click()
      expect(get('[data-reader-demo]').dataset.demoFullscreen).toBe('false')
      expect(composer.value).toBe('遇到陡坡时呢？')
      get('[data-demo-send]').click()
      expect(get('[data-demo-turns]').children).toHaveLength(2)
      composer.value = '未发送的草稿'
      get('.demo-answer:last-child [data-demo-copy-turn]').click()
      get('.demo-conversation-controls [data-demo-copy-session]').click()
      await Promise.resolve()
      const [single, session] = writeText.mock.calls.map(([value]) => value)
      expect(single).toContain('## 第 2 轮')
      expect(single).not.toContain('## 第 1 轮')
      expect(session).toContain('## 第 1 轮')
      for (const markdown of [single, session]) {
        expect(markdown).toContain('遇到陡坡时呢？')
        expect(markdown).toContain(get('[data-demo-passage="P3"]').textContent)
        expect(markdown).not.toContain(composer.value)
      }
      get('[data-demo-clear]').click()
      get('[data-demo-clear-yes]').click()
      expect(get('[data-demo-turns]').children).toHaveLength(0)
      expect(get<HTMLButtonElement>('[data-demo-export]').disabled).toBe(true)
    } finally {
      window.close()
    }
  })

  it('finds recent sessions by book, question or answer and restores their own drafts and sources', () => {
    const { window, get } = startDemo()
    try {
      const composer = get<HTMLTextAreaElement>('#demo-followup')
      const query = get<HTMLInputElement>('[data-demo-recent-query]')
      const input = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        element.value = value
        element.dispatchEvent(new window.Event('input'))
      }
      const results = () => window.document.querySelectorAll('.demo-recent-list button')
      get('[data-demo-explain]').click()
      input(composer, '选区里未发送的草稿')
      get('button[data-demo-scope="book"]').click()
      input(composer, '书中怎样划分概念？')
      get('[data-demo-send]').click()
      input(composer, '整本书的下一问')
      get('.demo-assistant-header [data-demo-recent]').click()
      expect(window.document.activeElement).toBe(query)
      expect(results()).toHaveLength(1)
      input(query, '理解复杂概念')
      expect(results()).toHaveLength(2)
      input(query, '未发送的草稿')
      expect(results()).toHaveLength(0)
      input(query, '重新检查结论')
      expect(results()).toHaveLength(1)
      expect(get('.demo-recent-match mark').textContent).toBe('重新检查结论')
      get('.demo-recent-list button').click()
      expect(get('#demo-recent').hidden).toBe(true)
      expect(get('[data-reader-demo]').dataset.demoScope).toBe('selection')
      expect(composer.value).toBe('选区里未发送的草稿')
      expect(get('.demo-citation').dataset.demoPreview).toBe('P1')

      get('button[data-demo-view="conversation"]').click()
      get('.demo-conversation-controls [data-demo-recent]').click()
      input(query, '划分概念')
      get('.demo-recent-list button').click()
      expect(get('[data-reader-demo]').dataset.demoScope).toBe('book')
      expect(composer.value).toBe('整本书的下一问')
      expect(get('.demo-citation').dataset.demoPreview).toBe('P3')
    } finally {
      window.close()
    }
  })

  it('removes the old Mac-style frame and automatic stepper', () => {
    expect(document.querySelector('.product-frame-bar')).toBeNull()
    expect(document.querySelector('.window-dots')).toBeNull()
    expect(document.querySelector('[data-demo-step]')).toBeNull()
    expect(styles).not.toContain('.window-dots')
    expect(styles).not.toContain('.demo-stepper')
    // 提示与引用高亮可以延时收起，演示步骤必须由用户操作触发。
    vi.useFakeTimers()
    const runtime = new JSDOM(html, { runScripts: 'outside-only' })
    try {
      runtime.window.matchMedia = () => ({ matches: false }) as MediaQueryList
      runtime.window.eval(script)
      vi.advanceTimersByTime(60_000)
      const runtimeDemo = runtime.window.document.querySelector('[data-reader-demo]')
      expect(runtimeDemo?.getAttribute('data-demo-state')).toBe('selected')
      expect(runtimeDemo?.querySelector('[data-demo-turns]')?.childElementCount).toBe(0)
    } finally {
      runtime.window.close()
      vi.useRealTimers()
    }
  })

  it('provides accessible, present local image assets', () => {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'))

    expect(images.length).toBeGreaterThan(0)
    for (const image of images) {
      expect(image.hasAttribute('alt')).toBe(true)
      const source = image.getAttribute('src')
      expect(source).toMatch(/^\.\//u)
      expect(existsSync(resolve(siteRoot, source!.slice(2)))).toBe(true)
    }

    // 0.5.0 站点用 HTML 演示取代了真实截图，这里改为校验品牌图标本身带显式尺寸。
    const brandMark = document.querySelector<HTMLImageElement>('img.brand-mark')
    expect(brandMark?.getAttribute('src')).toBe('./icon.png')
    expect(brandMark?.width).toBe(36)
    expect(brandMark?.height).toBe(36)
  })

  it('references every fixed-size favicon asset', () => {
    const icons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]'))
    expect(icons.map((icon) => icon.getAttribute('href'))).toEqual([
      './icon-32.png',
      './icon-64.png',
      './icon-128.png',
      './icon-256.png',
      './icon-256.png'
    ])
    for (const icon of icons) expect(existsSync(resolve(siteRoot, icon.href.split('/').at(-1)!))).toBe(true)
  })

  it('keeps focus feedback and reduced-motion fallbacks in the static stylesheet', () => {
    expect(styles).toContain(':focus-visible')
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toMatch(/\.reveal,[\s\S]*animation:\s*none;/u)
    expect(styles).toMatch(/scroll-behavior:\s*auto;/u)
  })

  it('uses the light site theme without the previous dark canvas', () => {
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#f7f8f6')
    expect(styles).toContain('color-scheme: light')
    expect(styles).not.toContain('#11191d')
  })
})
