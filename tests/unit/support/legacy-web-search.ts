import type { AppDatabase } from '../../../src/main/database'

/** Remove the new schema as well as version stamps when constructing an old database fixture. */
export function removeWebSearchSchema(database: AppDatabase): void {
  database.connection.exec(`DROP TABLE web_source_records;
    ALTER TABLE book_sessions DROP COLUMN web_search;
    ALTER TABLE book_session_history DROP COLUMN web_search;
    ALTER TABLE session_tabs DROP COLUMN web_search;
    ALTER TABLE insights DROP COLUMN web_search;`)
}
