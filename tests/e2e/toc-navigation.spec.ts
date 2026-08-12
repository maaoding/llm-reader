import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication
} from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNestedEpubFixture } from './fixtures/nested-epub'

test('nested TOC collapses via disclosure without jumping and navigates without CFI highlight', async () => {
  test.setTimeout(90_000)
  const testRoot = await mkdtemp(join(tmpdir(), 'llm-reader-toc-'))
  const userData = join(testRoot, 'profile')
  const fixture = join(testRoot, 'nested-toc.epub')
  await createNestedEpubFixture(fixture)
  let application: ElectronApplication | undefined

  try {
    application = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        LLM_READER_USER_DATA: userData,
        LLM_READER_E2E_IMPORT: fixture
      }
    })
    const page = await application.firstWindow()

    await expect(page.getByTestId('book-item').first()).toBeVisible()
    await page.getByTestId('book-item').first().click()
    await expect(page.getByTestId('reader-host').locator('iframe')).not.toHaveCount(0)

    await page.getByRole('button', { name: '目录' }).click()

    const tocItems = page.getByTestId('toc-item')
    const disclosure = page.getByTestId('toc-disclosure')

    // 默认展开：第一部 + 概念边界 + 第二章，第一部带 disclosure。
    await expect(tocItems).toHaveCount(3)
    await expect(disclosure).toHaveCount(1)
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')

    // disclosure 只负责折叠，不触发跳转；折叠后子项隐藏。
    await disclosure.click()
    await expect(tocItems).toHaveCount(1)
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText('无法跳转到这个章节')).toHaveCount(0)

    // 再点恢复展开。
    await disclosure.click()
    await expect(tocItems).toHaveCount(3)
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')

    // 点击目录标题才跳转：第二章 href 走 goTo，不进入 CFI highlight。
    await tocItems.filter({ hasText: '第二章' }).click()
    await expect
      .poll(() =>
        page.getByTestId('reader-host').evaluate((host) => {
          for (const frame of host.querySelectorAll('iframe')) {
            const document = frame.contentDocument
            if (document?.body?.textContent?.includes('后续加载章节也应继承当前阅读偏好')) {
              return true
            }
          }
          return false
        })
      )
      .toBe(true)

    await expect(page.getByText('无效的 EPUB 高亮锚点')).toHaveCount(0)
    await expect(page.getByText('无法跳转到这个章节')).toHaveCount(0)
  } finally {
    await application?.close().catch(() => undefined)
    await rm(testRoot, { recursive: true, force: true })
  }
})
