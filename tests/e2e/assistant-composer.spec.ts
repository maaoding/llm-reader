import { expect, test, type ElectronApplication } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader } from './support/electron-app'
import { resizeWorkspace } from './support/workspace'

test('keeps persona editing out of the composer and grows drafts without losing them between views', async () => {
  test.setTimeout(120_000)
  const workspace = await createE2eWorkspace('llm-reader-composer-')
  let application: ElectronApplication | undefined
  try {
    const fixture = join(workspace.root, '紧凑助手.txt')
    await writeFile(fixture, '第一章\n\n结合原文理解概念和论证。\n\n'.repeat(30), 'utf8')
    const launched = await launchReader({ userData: workspace.userData, importPath: fixture })
    application = launched.application
    const page = launched.page
    await expect(page.locator('.workspace-shell')).toHaveAttribute('data-workspace-ready', 'true')
    await page.getByTestId('book-item').click()
    await resizeWorkspace(application, page, 940, 600)
    const input = page.getByTestId('followup-input')
    const trigger = page.getByTestId('session-persona-trigger')
    const panel = page.getByTestId('session-persona-popover')
    const composer = page.locator('.assistant-composer:visible')
    const initialHeight = (await composer.boundingBox())!.height
    await expect(trigger).toHaveAttribute('aria-label', '助手：默认')
    await expect(trigger).toHaveText('')
    await expect(page.getByTestId('web-search-mode')).toHaveText('')
    await expect(page.getByTestId('web-search-mode')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('web-search-mode')).toBeDisabled()
    await trigger.focus()
    await expect(trigger.locator('..').getByRole('tooltip')).toBeVisible()
    await expect(trigger.locator('..').getByRole('tooltip')).toHaveText('助手：默认')
    await expect(page.getByTestId('session-persona-edit')).toBeHidden()

    // 打开和编辑均不改变底栏高度，Escape 返回入口，点击外部保留问题草稿。
    await trigger.focus()
    await trigger.press('Enter')
    await expect(panel).toBeVisible()
    await expect(page.getByTestId('session-persona')).toBeFocused()
    await page.getByTestId('session-persona-edit').click()
    const editor = page.getByTestId('session-persona-editor')
    await expect(editor.getByRole('textbox', { name: '人设名称' })).toBeFocused()
    await expect(page.locator('form form')).toHaveCount(0)
    expect(await input.evaluate((element) => (element as HTMLTextAreaElement).form?.id)).toBe(await page.getByTestId('send-question').getAttribute('form'))
    expect((await composer.boundingBox())!.height).toBe(initialHeight)
    await expect(panel).toBeInViewport()
    await expect(page.getByTestId('session-persona-apply')).toBeInViewport()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(trigger).toBeFocused()
    await input.fill('待续的提问')
    await trigger.click()
    await input.click()
    await expect(panel).toBeHidden()
    await expect(input).toHaveValue('待续的提问')

    // 长人设名保留在可访问名称与提示中；图标尺寸和输入区高度不受它影响。
    const longName = '关注证据与论证边界的阅读助手'.repeat(3)
    await trigger.click()
    await page.getByTestId('session-persona-edit').click()
    await editor.getByRole('textbox', { name: '人设名称' }).fill(longName)
    await editor.getByRole('textbox', { name: '提示词正文' }).fill('先核对原文，再解释概念。')
    await page.getByTestId('session-persona-apply').click()
    await expect(panel).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-label', `助手：${longName}`)
    expect((await composer.boundingBox())!.height).toBe(initialHeight)
    await trigger.click()
    await page.getByTestId('session-persona-save-as').click()
    await expect(panel).toBeHidden()
    await trigger.click()
    const savedId = await page.getByTestId('session-persona').inputValue()
    expect(savedId).not.toBe('custom')
    expect(savedId).not.toBe('')
    expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await page.getByTestId('session-persona').click()
    await expect.poll(() => page.getByTestId('session-persona').evaluate((element) => element.matches(':open'))).toBe(true)
    await page.screenshot({ path: test.info().outputPath('nested-persona-menu.png'), scale: 'css', animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(panel).toBeVisible()
    await expect.poll(() => page.getByTestId('session-persona').evaluate((element) => element.matches(':open'))).toBe(false)
    await page.getByTestId('session-persona').selectOption('')
    await expect(trigger).toHaveAttribute('aria-label', '助手：默认')
    await trigger.click()
    await page.getByTestId('session-persona').selectOption(savedId)
    await expect(trigger).toHaveAttribute('aria-label', `助手：${longName}`)

    await input.fill('短问题')
    const shortHeight = (await input.boundingBox())!.height
    const draft = '这段论证的条件是什么？\n'.repeat(20)
    await input.fill(draft)
    const tallHeight = (await input.boundingBox())!.height
    expect(tallHeight).toBeGreaterThan(shortHeight + 30)
    expect(tallHeight).toBeLessThanOrEqual(160)
    expect(await input.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await page.getByTestId('assistant-expand-button').click()
    await expect(input).toHaveValue(draft)
    await expect(trigger).toHaveAttribute('aria-label', `助手：${longName}`)
    await input.fill('短问题')
    expect((await input.boundingBox())!.height).toBe(shortHeight)

    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme })
      await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme', theme)
      await expect(trigger).toBeInViewport()
      await expect(page.getByTestId('web-search-mode')).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath(`compact-conversation-${theme}.png`), scale: 'css', animations: 'disabled' })
      await trigger.click()
      await page.getByTestId('session-persona-edit').click()
      await expect(page.getByTestId('session-persona-apply')).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath(`persona-popover-${theme}.png`), scale: 'css', animations: 'disabled' })
      await page.keyboard.press('Escape')
    }
    await page.getByTestId('workspace-tab-reading').click()
    await expect(input).toHaveValue('短问题')
    await page.screenshot({ path: test.info().outputPath('compact-sidebar.png'), scale: 'css', animations: 'disabled' })

    // 实际窗口、主题与字号下，两端留白一致，图标不侵占正文，也不挤出横向滚动。
    for (const [width, height] of [[940, 600], [1180, 760], [1440, 900]]) {
      await resizeWorkspace(application, page, width, height)
      for (const theme of ['light', 'dark'] as const) for (const scale of [100, 125]) {
        await page.getByTestId('settings-button').click()
        await page.getByTestId('settings-nav-appearance').click()
        await page.getByTestId(`theme-${theme}`).click()
        await page.getByTestId(`scale-${scale}`).click()
        await page.getByTestId('settings-close').click()
        for (const surface of ['reading', 'conversation'] as const) {
          await page.getByTestId(`workspace-tab-${surface}`).click()
          await expect(input).toHaveValue('短问题')
          const layout = await page.locator('.assistant-question-box:visible').evaluate((element) => {
            const box = element.getBoundingClientRect()
            const textarea = element.querySelector('textarea')!.getBoundingClientRect()
            const web = element.querySelector('[data-testid="web-search-mode"]')!.getBoundingClientRect()
            const persona = element.querySelector('[data-testid="session-persona-trigger"]')!.getBoundingClientRect()
            const send = element.querySelector('[data-testid="send-question"]')!.getBoundingClientRect()
            return { overflow: element.scrollWidth - element.clientWidth, sameLine: Math.abs(web.top - send.top),
              marginDelta: Math.abs((web.left - box.left) - (box.right - send.right)),
              toolsBelowText: web.top >= textarea.bottom, personaAfterWeb: persona.left >= web.right,
              minimumHitArea: Math.min(web.width, web.height, persona.width, persona.height, send.width, send.height) }
          })
          expect(layout.overflow).toBeLessThanOrEqual(1)
          expect(layout.sameLine).toBeLessThanOrEqual(1)
          expect(layout.marginDelta).toBeLessThanOrEqual(1)
          expect(layout.toolsBelowText).toBe(true)
          expect(layout.personaAfterWeb).toBe(true)
          expect(layout.minimumHitArea).toBeGreaterThanOrEqual(32)
          await page.screenshot({ path: test.info().outputPath(`composer-${surface}-${width}-${theme}-${scale}.png`), scale: 'css', animations: 'disabled' })
          if (width === 1440 && theme === 'light' && scale === 100) {
            await composer.screenshot({ path: test.info().outputPath(`input-area-${surface}.png`), scale: 'css', animations: 'disabled' })
          }
        }
      }
    }
  } finally { await cleanupE2eWorkspace(application, workspace.root) }
})
