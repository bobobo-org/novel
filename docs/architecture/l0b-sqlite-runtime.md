# L0B SQLite Runtime Decision

Status: accepted for L0B.1 foundation

## Goal

L0B introduces a real local canonical Story Bible storage backend. It is not a Supabase cache, not a cloud fallback, and not a browser database. The adapter must preserve the existing Story Bible Storage Adapter contract so services never see SQL, table names, driver details, PRAGMA settings, or raw database paths.

## Options Considered

### better-sqlite3

Pros:
- Mature synchronous SQLite API.
- Good transaction ergonomics and prepared statement support.
- Works well for desktop and CLI apps.

Cons:
- Native dependency install and rebuild friction on Windows.
- Adds a package and binary surface to the project.
- Vercel/serverless is not the intended target for local canonical storage.

### node:sqlite

Pros:
- Ships with current Node runtimes used by this workspace.
- No package install or native rebuild step.
- Provides real local SQLite, prepared statements, transactions, WAL, foreign keys, and PRAGMA support.
- Good fit for local desktop/CLI operation and early adapter contract tests.

Cons:
- Still experimental in Node at the time of this slice.
- Not available in older Node versions or browser runtimes.
- Should not be invoked by production Vercel routes unless explicitly local-only.

### libsql

Pros:
- SQLite-compatible API and cloud/local variants.
- Potential future sync story.

Cons:
- The cloud mode conflicts with L0B's local canonical authority goal.
- Adds service semantics that are not needed for the foundation slice.

### wa-sqlite

Pros:
- Can run in browser/WASM contexts.

Cons:
- Browser storage is L0C scope, not L0B.
- Transaction, file persistence, and runtime packaging semantics differ from local Node SQLite.

## Decision

Use `node:sqlite` for L0B.1.

The adapter loads it dynamically so normal Next.js builds can compile without requiring SQLite in browser or cloud execution paths. L0B.1 is local desktop/CLI storage. Vercel production remains on Supabase until an explicit runtime policy chooses `SQLITE_LOCAL`.

## Runtime Requirements

- Real local SQLite file per project.
- `BEGIN IMMEDIATE`, `COMMIT`, and `ROLLBACK` transactions.
- `PRAGMA foreign_keys = ON`.
- `PRAGMA journal_mode = WAL`.
- `PRAGMA synchronous = NORMAL`.
- `PRAGMA busy_timeout = 5000`.
- `PRAGMA temp_store = MEMORY`.
- Prepared statements only.
- No raw database path exposure in public health or admin diagnostics.

## Windows Support

The chosen runtime is bundled with the local Node runtime and avoids native package rebuilds. The path resolver validates storage directories, rejects `.next`, `node_modules`, OS temp paths, traversal, and unsafe project database names.

## Vercel and Browser Scope

Vercel production does not use SQLite as primary storage in L0B.1. Browser storage is explicitly out of scope and remains `INDEXEDDB_BROWSER` schema-only. Future Electron/Tauri packaging can provide the storage directory and project export ID to the same adapter.

## Future Review

Before promoting SQLite beyond foundation status, re-evaluate Node's SQLite stability, backup support, encryption-at-rest requirements, and packaging strategy for desktop runtimes.
