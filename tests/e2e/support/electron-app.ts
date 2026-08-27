import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface E2eWorkspace {
  root: string
  userData: string
}

export interface LaunchReaderOptions {
  userData: string
  importPath?: string
  env?: NodeJS.ProcessEnv
}

export async function createE2eWorkspace(prefix: string): Promise<E2eWorkspace> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  return { root, userData: join(root, 'profile') }
}

export async function launchReader(options: LaunchReaderOptions): Promise<{
  application: ElectronApplication
  page: Page
}> {
  const executablePath = process.env.LLM_READER_E2E_EXECUTABLE
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : ['.'],
    env: {
      ...process.env,
      ...options.env,
      LLM_READER_USER_DATA: options.userData,
      LLM_READER_E2E_IMPORT: options.importPath ?? ''
    }
  })
  return { application, page: await application.firstWindow() }
}

export async function restartReader(
  application: ElectronApplication,
  options: LaunchReaderOptions
): Promise<{ application: ElectronApplication; page: Page }> {
  await application.close()
  return launchReader(options)
}

export async function cleanupE2eWorkspace(
  application: ElectronApplication | undefined,
  root: string
): Promise<void> {
  await application?.close().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}
