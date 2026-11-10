import type { AppDatabase } from '../../../src/main/database'
import { removeHighlightMetadataSchema } from './legacy-highlights'

/** Restore the pre-search fields for fixtures that rewind the migration history. */
export function removeWebSearchSchema(database: AppDatabase): void {
  removeHighlightMetadataSchema(database)
  database.connection.exec(`DROP TABLE web_source_records;
    ALTER TABLE book_sessions DROP COLUMN web_search;
    ALTER TABLE book_session_history DROP COLUMN web_search;
    ALTER TABLE session_tabs DROP COLUMN web_search;
    ALTER TABLE insights DROP COLUMN web_search;`)
}
