# P2.1 architecture summary

P2.1 keeps the P2 domain/repository boundary and adds production closure around it.

- Consumer entry remains `/` and `/studio`; Legacy remains a compatibility tool at `/legacy/novel-system.html`.
- Reader state, notes and bookmarks are first-class IndexedDB records scoped by `projectId`.
- Backup format is `novel-backup-v3`: a manifest, content hash and portable project records. The snapshot deliberately excludes prior backups so recovery archives cannot recursively grow.
- Import supports `copy` and `replace`. Copy remaps project and record identifiers. Replace is one IndexedDB read/write transaction and keeps pre-restore backup records.
- External AI remains denied unless the existing router receives explicit consent. Browser AI and Private AI Hub are feature-flagged and honestly client/runtime-dependent.

Known partials: browser-side IndexedDB multi-tab stress, long-novel 100k/300k/500k measurements, advanced import preview/diff, and real Browser AI/Private Hub runtimes.
