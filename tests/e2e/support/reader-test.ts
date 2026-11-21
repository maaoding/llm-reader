import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanupE2eWorkspace, createE2eWorkspace, launchReader, type E2eWorkspace } from './electron-app'

interface ReaderFixtures {
  importText: string | undefined
  reader: { application: ElectronApplication; page: Page; workspace: E2eWorkspace }
}

// Electron startup and disposal have their own bounded budget. A slow Windows
// first window must not consume the time reserved for assertions or cleanup.
export const test = base.extend<ReaderFixtures>({
  importText: [undefined, { option: true }],
  reader: [async ({ importText }, use) => {
    const workspace = await createE2eWorkspace('llm-reader-e2e-')
    let application: ElectronApplication | undefined
    try {
      const importPath = importText === undefined ? undefined : join(workspace.root, 'book.txt')
      if (importPath) await writeFile(importPath, importText!, 'utf8')
      const launched = await launchReader({ userData: workspace.userData, importPath })
      application = launched.application
      await expect(launched.page.getByTestId('app-shell')).toBeVisible()
      await use({ ...launched, workspace })
    } finally {
      await cleanupE2eWorkspace(application, workspace.root)
    }
  }, { timeout: 60_000 }]
})

export { expect }
