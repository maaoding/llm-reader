export type WorkspacePage = 'library' | 'reading' | 'notes' | 'conversation' | 'archives'
export type BookTabPage = Extract<WorkspacePage, 'reading' | 'notes'>
export interface BookTabState { bookId: string; page: BookTabPage }
export interface WorkspaceState { bookId: string | null; page: WorkspacePage; tabs: BookTabState[] }
const KEY = 'llm-reader.workspace'
const pages: WorkspacePage[] = ['library', 'reading', 'notes', 'conversation', 'archives']
const bookPages: BookTabPage[] = ['reading', 'notes']
const MAX_TABS = 20

function migratePage(value: unknown): unknown {
  return value === 'overview' ? 'reading' : value
}

export function bookTabPage(page: WorkspacePage): BookTabPage | null {
  return bookPages.includes(page as BookTabPage) ? page as BookTabPage : null
}

function readTabs(value: unknown): BookTabState[] {
  if (!Array.isArray(value)) return []
  const tabs: BookTabState[] = []
  for (const item of value) {
    const record = item as { bookId?: unknown; page?: unknown } | null
    if (!record || typeof record !== 'object') continue
    if (typeof record.bookId !== 'string' || !record.bookId) continue
    const page = migratePage(record.page)
    if (!bookPages.includes(page as BookTabPage)) continue
    if (tabs.some((tab) => tab.bookId === record.bookId)) continue
    tabs.push({ bookId: record.bookId, page: page as BookTabPage })
    if (tabs.length >= MAX_TABS) break
  }
  return tabs
}

export function readWorkspaceState(): WorkspaceState {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { bookId?: unknown; page?: unknown; tabs?: unknown } | null
    const migratedPage = migratePage(value?.page)
    if (value && typeof value === 'object' && pages.includes(migratedPage as WorkspacePage) && (value.bookId === null || typeof value.bookId === 'string')) {
      const bookId = (value.bookId as string | null) ?? null
      const page = migratedPage as WorkspacePage
      // 只有当前书籍的旧记录迁移为单个标签；已写入标签列表时保持原样，重复读取结果一致。
      const tabs = Array.isArray(value.tabs)
        ? readTabs(value.tabs)
        : bookId ? [{ bookId, page: bookTabPage(page) ?? 'reading' } as BookTabState] : []
      return { bookId, page, tabs }
    }
  } catch { /* The library remains usable when local display preferences cannot be read. */ }
  return { bookId: null, page: 'library', tabs: [] }
}

export function saveWorkspaceState(state: WorkspaceState): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(state)) }
  catch { /* Display preferences are optional and contain no book text or credentials. */ }
}
