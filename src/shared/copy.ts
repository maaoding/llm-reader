import copySource from './copy.md?raw'

export const COPY_KEYS = [
  'app.name',
  'common.retry',
  'common.confirm',
  'common.back',
  'common.currentChapter',
  'common.unknownAuthor',
  'assistant.title',
  'assistant.viewsAria',
  'assistant.tabConversation',
  'assistant.tabInsights',
  'assistant.emptyTitle',
  'assistant.emptyDetail',
  'assistant.sourceTitle',
  'assistant.sourceSummary',
  'assistant.backToSource',
  'assistant.thinking',
  'assistant.generatingAria',
  'assistant.modelUnavailable',
  'assistant.tokenUsage',
  'assistant.save',
  'assistant.saved',
  'assistant.stop',
  'assistant.placeholderFollowup',
  'assistant.placeholderFirst',
  'assistant.placeholderNoSelection',
  'assistant.sendAria',
  'assistant.actionExplain',
  'assistant.actionContext',
  'assistant.actionAsk',
  'assistant.questionExplain',
  'assistant.questionContext',
  'assistant.cancelledPartial',
  'assistant.cancelledEmpty',
  'assistant.expandDialog',
  'assistant.dialogTitle',
  'assistant.closeDialog',
  'assistant.citationUnknownTitle',
  'assistant.citationUnverified',
  'assistant.citationSourceFallback',
  'assistant.citationExcerpt',
  'assistant.citationJumpTitle',
  'assistant.selectionToolbarAria',
  'assistant.selectionCloseAria',
  'insights.loading',
  'insights.noBookTitle',
  'insights.noBookDetail',
  'insights.emptyTitle',
  'insights.emptyDetail',
  'insights.removeQuestion',
  'insights.backToSource',
  'insights.removeAria',
  'insights.removed',
  'insights.alreadyRemoved',
  'insights.removeFailed',
  'insights.savedToast',
  'insights.saveFailed',
  'insights.readFailed',
  'settings.title',
  'settings.closeAria',
  'settings.sectionsAria',
  'settings.appearanceTitle',
  'settings.themeLabel',
  'settings.themeHint',
  'settings.themeGroupAria',
  'settings.themeLight',
  'settings.themeLightAria',
  'settings.themeSystem',
  'settings.themeSystemAria',
  'settings.themeDark',
  'settings.themeDarkAria',
  'settings.scaleLabel',
  'settings.scaleHint',
  'settings.scaleGroupAria',
  'settings.readingTitle',
  'settings.restoreDefaults',
  'settings.fontLabel',
  'settings.fontAria',
  'settings.fontFamilyLabel',
  'settings.commonChineseFonts',
  'settings.allFonts',
  'settings.fontsLoading',
  'settings.fontsUnavailable',
  'settings.fontUnavailableHint',
  'settings.lineHeight',
  'settings.indent',
  'settings.contentWidth',
  'settings.contentWidthNarrow',
  'settings.contentWidthStandard',
  'settings.contentWidthWide',
  'settings.paragraphSpacing',
  'settings.spacingCompact',
  'settings.spacingStandard',
  'settings.spacingRelaxed',
  'settings.followBookDefault',
  'settings.noIndent',
  'settings.modelTitle',
  'settings.baseUrlLabel',
  'settings.baseUrlPlaceholder',
  'settings.baseUrlHint',
  'settings.modelLabel',
  'settings.modelPlaceholder',
  'settings.apiKeyLabel',
  'settings.apiKeySaved',
  'settings.apiKeyPlaceholderSaved',
  'settings.apiKeyPlaceholderEmpty',
  'settings.apiKeyHint',
  'settings.testConnection',
  'settings.save',
  'settings.savedToast',
  'settings.saveFailed',
  'settings.testSuccessToast',
  'settings.testFailed',
  'provider.statusNotConfigured',
  'provider.statusChecking',
  'provider.statusConnected',
  'provider.statusDisconnected',
  'provider.backgroundTestFailed',
  'library.navAria',
  'library.tabLibrary',
  'library.tabToc',
  'library.loading',
  'library.unavailableTitle',
  'library.emptyTitle',
  'library.emptyDetail',
  'library.epubDescription',
  'library.txtDescription',
  'library.tocAria',
  'library.tocLoading',
  'library.tocEmptyTitle',
  'library.tocEmptyDetail',
  'library.tocExpandAria',
  'library.tocCollapseAria',
  'library.import',
  'library.importing',
  'library.duplicateToast',
  'library.importedToast',
  'library.importFailed',
  'library.readFailed',
  'bookDetails.title',
  'bookDetails.closeAria',
  'bookDetails.openAria',
  'bookDetails.coverAlt',
  'bookDetails.loading',
  'bookDetails.readFailed',
  'bookDetails.coverMissing',
  'bookDetails.titleLabel',
  'bookDetails.authorLabel',
  'bookDetails.formatLabel',
  'bookDetails.formatEpub',
  'bookDetails.formatTxt',
  'bookDetails.originalNameLabel',
  'bookDetails.fileSizeLabel',
  'bookDetails.importedAtLabel',
  'bookDetails.lastOpenedAtLabel',
  'bookDetails.neverOpened',
  'bookDetails.progressLabel',
  'bookDetails.languageLabel',
  'bookDetails.publisherLabel',
  'bookDetails.publishedAtLabel',
  'bookDetails.identifierLabel',
  'bookDetails.descriptionLabel',
  'bookDetails.notProvided',
  'reader.progress',
  'reader.progressAria',
  'reader.readingSettings',
  'reader.areaAria',
  'reader.emptyAria',
  'reader.emptyText',
  'reader.opening',
  'reader.openingDetail',
  'reader.openFailedTitle',
  'reader.openAgain',
  'reader.openFailed',
  'reader.preferencesFailed',
  'reader.bridgeFailed',
  'reader.navigateSourceFailed',
  'reader.navigateChapterFailed',
  'error.internal',
  'error.invalidInput',
  'error.untrustedSender',
  'dialog.importTitle',
  'dialog.importFilter',
  'error.epubUnsafePath',
  'error.epubIncomplete',
  'error.epubMetadataTooLarge',
  'error.epubOpenFailed',
  'error.epubTooManyEntries',
  'error.epubEntryTooLarge',
  'error.epubExpandedTooLarge',
  'error.epubInvalid',
  'error.epubDrm',
  'error.epubMissingContent',
  'error.txtEncoding',
  'error.txtBinary',
  'error.importAbsolutePath',
  'error.importNotFound',
  'error.importNotFile',
  'error.importEmpty',
  'error.importTooLarge',
  'error.importUnsupported',
  'error.txtTooLarge',
  'library.untitled',
  'error.bookNotFound',
  'error.storagePath',
  'reader.epubUntitledChapter',
  'reader.epubEmpty',
  'reader.epubUntitled',
  'reader.epubInvalidAnchor',
  'reader.epubAnchorFailed',
  'reader.epubInvalidHighlight',
  'reader.epubSection',
  'reader.epubNotOpen',
  'reader.txtDefaultTitle',
  'reader.txtEmpty',
  'reader.txtOpening',
  'reader.txtInvalidAnchor',
  'reader.txtAnchorOutside',
  'reader.txtInvalidHighlight',
  'reader.txtHighlightOutside',
  'reader.txtFullText',
  'error.baseUrlInvalid',
  'error.baseUrlUnsafe',
  'error.http400',
  'error.http401',
  'error.http403',
  'error.http404',
  'error.http429',
  'error.httpOther',
  'error.responseTooLarge',
  'error.providerInvalidJson',
  'error.providerEmptyText',
  'error.answerTooLarge',
  'error.providerEmptyStream',
  'error.streamEventTooLarge',
  'error.streamInterrupted',
  'error.duplicateRequest',
  'error.answerCancelled',
  'error.requestTimeout',
  'error.requestStartFailed',
  'error.keyStorageUnavailable',
  'error.providerNotConfigured',
  'error.keyReadUnavailable',
  'error.keyDecryptFailed',
  'provider.testConnected',
  'provider.testTimeout',
  'provider.testFailed',
  'error.keyReadFailed',
  'error.keyCipherInvalid',
  'error.keyCipherSize',
  'error.keyWriteFailed'
] as const

export type CopyKey = (typeof COPY_KEYS)[number]
export type CopyValues = Readonly<Record<string, string | number>>

export const COPY_PLACEHOLDERS = {
  'assistant.sourceSummary': ['chapter', 'count'],
  'assistant.tokenUsage': ['count'],
  'assistant.citationExcerpt': ['excerpt'],
  'assistant.citationJumpTitle': ['excerpt'],
  'settings.baseUrlHint': ['path'],
  'library.tocExpandAria': ['title'],
  'library.tocCollapseAria': ['title'],
  'bookDetails.openAria': ['title'],
  'bookDetails.coverAlt': ['title'],
  'reader.progressAria': ['percent'],
  'reader.opening': ['title'],
  'reader.epubSection': ['number'],
  'error.httpOther': ['status']
} as const satisfies Partial<Record<CopyKey, readonly string[]>>

type DynamicCopyKey = keyof typeof COPY_PLACEHOLDERS
type CopyArguments<Key extends CopyKey> = Key extends DynamicCopyKey
  ? [values: Readonly<Record<(typeof COPY_PLACEHOLDERS)[Key][number], string | number>>]
  : []

const TABLE_ROW = /^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/u
const KEY = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/u
const PLACEHOLDER = /\{([a-z][a-zA-Z0-9]*)\}/gu

function validatePlaceholders(key: string, text: string): void {
  const withoutPlaceholders = text.replace(PLACEHOLDER, '')
  if (withoutPlaceholders.includes('{') || withoutPlaceholders.includes('}')) {
    throw new Error(`Invalid copy placeholder in "${key}"`)
  }
}

function validatePlaceholderContract(
  key: string,
  text: string,
  placeholderSchema: Readonly<Record<string, readonly string[]>>
): void {
  const actual = new Set(Array.from(text.matchAll(PLACEHOLDER), (match) => match[1]))
  const expected = new Set(placeholderSchema[key] ?? [])
  for (const name of expected) {
    if (!actual.has(name)) throw new Error(`Missing copy placeholder "${name}" in "${key}"`)
  }
  for (const name of actual) {
    if (!expected.has(name)) throw new Error(`Unknown copy placeholder "${name}" in "${key}"`)
  }
}

export function parseCopySource<const Keys extends readonly string[]>(
  source: string,
  requiredKeys: Keys,
  placeholderSchema: Readonly<Record<string, readonly string[]>> = {}
): Readonly<Record<Keys[number], string>> {
  const values = new Map<string, string>()
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(TABLE_ROW)
    if (!match) continue
    const key = match[1].trim()
    const text = match[2].trim()
    if (key === 'key' || /^-+$/u.test(key)) continue
    if (!KEY.test(key)) throw new Error(`Invalid copy key "${key}"`)
    if (values.has(key)) throw new Error(`Duplicate copy key "${key}"`)
    if (!text) throw new Error(`Empty copy text for "${key}"`)
    if (text.includes('|')) throw new Error(`Unescaped table separator in "${key}"`)
    validatePlaceholders(key, text)
    validatePlaceholderContract(key, text, placeholderSchema)
    values.set(key, text)
  }

  const required = new Set<string>(requiredKeys)
  for (const key of required) {
    if (!values.has(key)) throw new Error(`Missing copy key "${key}"`)
  }
  for (const key of values.keys()) {
    if (!required.has(key)) throw new Error(`Unknown copy key "${key}"`)
  }
  return Object.freeze(Object.fromEntries(values) as Record<Keys[number], string>)
}

export function formatCopy(template: string, values: CopyValues = {}): string {
  const placeholders = new Set(Array.from(template.matchAll(PLACEHOLDER), (match) => match[1]))
  for (const placeholder of placeholders) {
    if (!(placeholder in values)) throw new Error(`Missing copy value "${placeholder}"`)
  }
  for (const name of Object.keys(values)) {
    if (!placeholders.has(name)) throw new Error(`Unknown copy value "${name}"`)
  }
  return template.replace(PLACEHOLDER, (_match, name: string) => String(values[name]))
}

const COPY_TEXT = parseCopySource(copySource, COPY_KEYS, COPY_PLACEHOLDERS)

export function copy<Key extends CopyKey>(key: Key, ...args: CopyArguments<Key>): string {
  return formatCopy(COPY_TEXT[key], args[0] ?? {})
}
