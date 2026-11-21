import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { conversationExportDefaultName, writeConversationMarkdown } from '../../src/main/conversation-export'

it('sanitizes the default Windows filename and writes complete UTF-8 Markdown with an extension', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reader-conversation-export-'))
  try {
    const name = conversationExportDefaultName('书名:/?*-当前会话', new Date(2026, 10, 8, 12, 34))
    expect(name).toBe('LLM-Reader-书名____-当前会话-20261108-1234.md')
    const markdown = '# 中文\n\n' + '完整来源\n'.repeat(10_000)
    expect(await writeConversationMarkdown(join(root, '完整问答'), markdown)).toBe('完整问答.md')
    expect(await readFile(join(root, '完整问答.md'), 'utf8')).toBe(markdown)
    await expect(writeConversationMarkdown(join(root, 'missing', 'private.md'), markdown)).rejects.toMatchObject({
      code: 'CONVERSATION_EXPORT_FAILED'
    })
    await expect(writeConversationMarkdown(join(root, 'missing', 'private.md'), markdown)).rejects.not.toThrow(root)
  } finally { await rm(root, { recursive: true, force: true }) }
})
