import { z } from 'zod'
import type { LibraryPreferences } from './contracts'

const id = z.string().max(128)
const icon = z.enum(['highlighter', 'book-open', 'message-square-text', 'search', 'lightbulb', 'pen-line', 'quote', 'book-marked'])
const action = z.object({ label: z.string().max(48), prompt: z.string().max(8_000), icon })
const schemas: Record<string, z.ZodType> = {
  'llm-reader.reading-preferences': z.object({
    fontScale: z.number().min(50).max(400), lineHeight: z.enum(['original', '1.5', '1.7', '1.9']),
    indent: z.enum(['original', 'none', '2em']), fontFamily: z.string().max(200).nullable(),
    contentWidth: z.enum(['original', 'narrow', 'standard', 'wide']),
    paragraphSpacing: z.enum(['original', 'compact', 'standard', 'relaxed']),
    paperTheme: z.enum(['light', 'sepia', 'dark', 'dark-eye-care']),
    textAlign: z.enum(['original', 'justify', 'left']).optional()
  }),
  'llm-reader.assistant-actions': z.object({ explain: action, context: action,
    ask: z.object({ label: z.string().max(48), icon }), defaultPromptVersion: z.number().int().min(0).max(100).optional() }),
  'llm-reader.assistant-personas': z.object({ presets: z.array(z.object({ id,
    name: z.string().max(60), prompt: z.string().max(3_000) })).max(20), defaultId: id.nullable() }),
  'llm-reader.workspace': z.object({ bookId: id.nullable(), page: z.enum(['library', 'reading', 'notes', 'conversation', 'archives']),
    tabs: z.array(z.object({ bookId: id, page: z.enum(['reading', 'notes']) })).max(20).optional() })
}
const scalars: Record<string, z.ZodType<string>> = {
  'llm-reader.theme': z.enum(['light', 'dark', 'system']),
  'llm-reader.interface-scale': z.enum(['90', '100', '110', '125']),
  'llm-reader.ui-language': z.enum(['zh', 'en']),
  'llm-reader.paper-theme-preference': z.enum(['default', 'eye-care']),
  'llm-reader-workbench-active': id
}

export function isLibraryPreferenceKey(key: string): boolean {
  return Object.hasOwn(schemas, key) || Object.hasOwn(scalars, key) || /^llm-reader\.text-reading-mode\.[\w-]{1,128}$/u.test(key)
}

/** Allowlisted fields only; never serialize arbitrary Chromium storage or service settings. */
export function parseLibraryPreferences(value: unknown): LibraryPreferences {
  const input = z.record(z.string().max(180), z.string().max(256_000)).parse(value)
  if (Object.keys(input).length > 10_000 || JSON.stringify(input).length > 2_000_000) throw new Error('Preferences too large')
  const result: LibraryPreferences = {}
  for (const [key, stored] of Object.entries(input)) {
    if (!isLibraryPreferenceKey(key)) throw new Error('Unknown preference')
    if (Object.hasOwn(schemas, key)) result[key] = JSON.stringify(schemas[key].parse(JSON.parse(stored)))
    else result[key] = (scalars[key] ?? z.enum(['auto', 'plain', 'markdown'])).parse(stored)
  }
  return result
}
