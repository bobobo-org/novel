# Schema and migrations

`NovelRepository` adds `readerNotes`, `readerBookmarks`, and `importProject`.

IndexedDB is upgraded from version 1 to 2. New stores receive the existing `projectId` index. Existing reader records are migrated lazily in the Reader by merging missing fields with defaults; no user text is replaced.

Backup import writes `migrationVersion: p21-backup-import-v1`. Empty or unknown optional fields remain empty rather than being replaced by placeholder story values.
