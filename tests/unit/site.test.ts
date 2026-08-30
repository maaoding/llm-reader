import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const siteRoot = resolve('site')
const html = readFileSync(resolve(siteRoot, 'index.html'), 'utf8')
const styles = readFileSync(resolve(siteRoot, 'styles.css'), 'utf8')
const script = readFileSync(resolve(siteRoot, 'script.js'), 'utf8')
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
      expect(link.href).toBe('https://github.com/maaoding/llm-reader')
    }
  })

  it('ships a desktop-shaped Reader interaction with a real-image fallback', () => {
    const demo = document.querySelector('[data-reader-demo]')
    const windowControls = Array.from(document.querySelectorAll<HTMLButtonElement>('.demo-window-controls button'))
    const passiveControls = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-demo-passive]'))
    const scriptElement = document.querySelector<HTMLScriptElement>('script[src="./script.js"]')

    expect(demo?.getAttribute('data-demo-state')).toBe('selected')
    expect(demo?.querySelector('.demo-left-sidebar')).not.toBeNull()
    expect(demo?.querySelector('.demo-reader-column')).not.toBeNull()
    expect(demo?.querySelector('.demo-right-sidebar')).not.toBeNull()
    expect(windowControls.map((control) => control.getAttribute('aria-label'))).toEqual(['最小化', '最大化', '关闭'])
    expect(passiveControls.length).toBeGreaterThan(10)
    expect(passiveControls.filter((control) => !control.closest('.demo-window-controls')).every((control) => control.getAttribute('aria-disabled') === 'true')).toBe(true)
    expect(windowControls.every((control) => control.title === '官网演示中不可用')).toBe(true)
    expect(document.querySelector('[data-demo-explain]')).not.toBeNull()
    expect(document.querySelector('.demo-selected-paragraph > .demo-selection-toolbar')).not.toBeNull()
    expect(document.querySelector('.demo-selection-spark svg')).not.toBeNull()
    expect(document.querySelector('[data-demo-explain] svg')).not.toBeNull()
    expect(document.querySelector('.demo-selection-toolbar')?.textContent).not.toContain('✦')
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.demo-selection-toolbar button')).map((button) => button.textContent?.trim())).toEqual(['解释这段', '联系上下文', '自由提问', '收藏', ''])
    expect(document.querySelector('.demo-selection-toolbar .toolbar-close')?.getAttribute('aria-label')).toBe('关闭选区工具')
    expect(document.querySelector('.demo-assistant-tabs')).toBeNull()
    expect(styles).not.toContain('.demo-assistant-tabs')
    expect(document.querySelector('[data-demo-answer]')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('[data-demo-citation]')).not.toBeNull()
    expect(document.querySelector('[data-demo-selection]')?.getAttribute('tabindex')).toBe('-1')
    expect(scriptElement).not.toBeNull()
    expect(existsSync(resolve(siteRoot, 'script.js'))).toBe(true)
    expect(script).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(script).toContain("demo.dataset.demoState = 'answered'")
    expect(script).toContain('selection.scrollIntoView')
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

    const productImage = document.querySelector<HTMLImageElement>('.product-image')
    expect(productImage?.alt.length).toBeGreaterThan(20)
    expect(productImage?.width).toBe(1536)
    expect(productImage?.height).toBe(864)
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
