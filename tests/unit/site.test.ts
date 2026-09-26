import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const siteRoot = resolve('site')
const html = readFileSync(resolve(siteRoot, 'index.html'), 'utf8')
const styles = readFileSync(resolve(siteRoot, 'styles.css'), 'utf8')
const script = readFileSync(resolve(siteRoot, 'script.js'), 'utf8')
const copySource = readFileSync(resolve('src/shared/copy.md'), 'utf8')
const document = new JSDOM(html).window.document

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

  it('uses the GitHub project as the primary call to action', () => {
    const primaryLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.button-primary'))

    expect(primaryLinks).toHaveLength(2)
    for (const link of primaryLinks) {
      // 0.5.0 站点的主动按钮指向 Releases，导航里才是仓库首页；两者都属于 GitHub 项目入口。
      expect(link.href.startsWith('https://github.com/maaoding/llm-reader')).toBe(true)
    }
    expect(primaryLinks.some((link) => link.href.endsWith('/releases/latest'))).toBe(true)
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
    expect(Array.from(demo?.querySelectorAll('.demo-bookbar nav button') ?? []).map((button) => button.textContent?.trim())).toEqual(['阅读', '章节笔记', '对话'])
    expect(demo?.querySelector('.demo-bookbar > .demo-book-prepare')?.textContent).toBe('本书准备')
    expect(passiveControls.length).toBeGreaterThan(10)
    expect(passiveControls.every((control) => control.getAttribute('aria-disabled') === 'true')).toBe(true)
    expect(document.querySelector('[data-demo-explain]')).not.toBeNull()
    expect(document.querySelector('.demo-selected-paragraph > .demo-selection-toolbar')).not.toBeNull()
    expect(document.querySelector('.demo-selection-spark svg')).not.toBeNull()
    expect(document.querySelector('[data-demo-explain] svg')).not.toBeNull()
    expect(document.querySelector('.demo-selection-toolbar')?.textContent).not.toContain('✦')
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.demo-selection-toolbar button')).map((button) => button.textContent?.trim())).toEqual(['解释这段', '联系上下文', '自由提问', '摘录这段', ''])
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.demo-selection-toolbar [data-demo-passive]')).every((button) => button.title === '官网演示中不可用')).toBe(true)
    expect(document.querySelector('.demo-selection-toolbar .toolbar-close')?.getAttribute('aria-label')).toBe('关闭选区工具')
    expect(document.querySelector('.demo-assistant-tabs')).toBeNull()
    expect(styles).not.toContain('.demo-assistant-tabs')
    expect(document.querySelector('[data-demo-answer]')?.hasAttribute('hidden')).toBe(true)
    const questionPrompt = document.querySelector<HTMLDetailsElement>('.demo-user-message .demo-question-prompt')
    const currentExplainPrompt = copySource.match(/^\| assistant\.questionExplain \| (.+) \|\r?$/mu)?.[1]
    expect(currentExplainPrompt).toBeTruthy()
    expect(questionPrompt?.open).toBe(false)
    expect(questionPrompt?.querySelector('summary')?.textContent).toBe('查看本次提示词')
    expect(questionPrompt?.querySelector('p')?.textContent).toBe(currentExplainPrompt)
    expect(document.querySelector('[data-demo-citation]')).toBeNull()
    expect(document.querySelector('.demo-citation[data-demo-return]')).not.toBeNull()
    expect(document.querySelector('[data-demo-selection]')?.getAttribute('tabindex')).toBe('-1')
    expect(scriptElement).not.toBeNull()
    // 0.5.0 站点用 ./script.js?v=... 做缓存失效，并保持 defer。
    expect(scriptElement?.hasAttribute('defer')).toBe(true)
    expect(existsSync(resolve(siteRoot, 'script.js'))).toBe(true)
    expect(script).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(script).toContain("demo.dataset.demoState = 'answered'")
    expect(script).toContain('[data-demo-return]')
    expect(script).toContain("demo.dataset.demoState = 'citation'")
    expect(script).not.toContain('模拟回答已显示')
  })

  it('removes the old Mac-style frame and automatic stepper', () => {
    expect(document.querySelector('.product-frame-bar')).toBeNull()
    expect(document.querySelector('.window-dots')).toBeNull()
    expect(document.querySelector('[data-demo-step]')).toBeNull()
    expect(styles).not.toContain('.window-dots')
    expect(styles).not.toContain('.demo-stepper')
    expect(script).not.toContain('setTimeout')
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
