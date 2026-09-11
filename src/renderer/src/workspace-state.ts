export type WorkspacePage = 'library' | 'overview' | 'reading' | 'notes' | 'conversation' | 'archives'
export interface WorkspaceState { bookId: string | null; page: WorkspacePage }
const KEY = 'llm-reader.workspace'
const pages: WorkspacePage[] = ['library', 'overview', 'reading', 'notes', 'conversation', 'archives']
export function readWorkspaceState(): WorkspaceState {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<WorkspaceState> | null
    if (value && pages.includes(value.page as WorkspacePage) && (value.bookId === null || typeof value.bookId === 'string')) {
      return { page: value.page as WorkspacePage, bookId: value.bookId ?? null }
    }
  } catch { /* The library remains usable when local display preferences cannot be read. */ }
  return { bookId: null, page: 'library' }
}
export function saveWorkspaceState(state: WorkspaceState): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(state)) }
  catch { /* Display preferences are optional and contain no book text or credentials. */ }
}
