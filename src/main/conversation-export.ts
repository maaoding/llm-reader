import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { copy } from '@shared/copy'
import { AppError } from './errors'
import { ensureMarkdownExtension, sanitizeExportFileName } from './insight-export'

export function conversationExportDefaultName(title: string, now = new Date()): string {
  const pad = (part: number): string => String(part).padStart(2, '0')
  const stamp = String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes())
  return 'LLM-Reader-' + sanitizeExportFileName(title) + '-' + stamp + '.md'
}

export async function writeConversationMarkdown(path: string, markdown: string): Promise<string> {
  const target = ensureMarkdownExtension(path)
  try {
    await writeFile(target, markdown, 'utf8')
  } catch {
    // Never expose a native path, the document text, or an OS error to renderer.
    throw new AppError('CONVERSATION_EXPORT_FAILED', copy('conversationMarkdown.saveFailed'))
  }
  return basename(target)
}
