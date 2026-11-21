import type { AppDatabase } from '../../../src/main/database'

export function removeHighlightMetadataSchema(database: AppDatabase): void {
  database.connection.exec('ALTER TABLE highlights DROP COLUMN tags_json; ALTER TABLE highlights DROP COLUMN note;')
}
