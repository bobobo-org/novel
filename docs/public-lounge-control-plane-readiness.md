# Public Lounge control plane readiness

Migration `public_lounge_control_plane_028` replaces object-Storage catalog
enumeration and Storage-object quota slots with service-role-only PostgreSQL
RPCs.

## Authority boundary

Supabase Storage remains the publication authority. Cross-system atomic commit
between Storage and PostgreSQL is not available, so
`public_lounge_catalog_anchors` stores only `public_id`, immutable
`published_at`, and liveness timestamps/flags. It stores no title, author,
synopsis, topics, quality data, or chapter content.

Every catalog candidate is re-read from its private Storage head, including its
immutable mutation-claim chain, before a summary can be returned. Missing,
retracted, stale, weak-review, or hard-gate-invalid heads are not exposed.
Retraction commits its Storage claim first and then marks the DB anchor inactive;
if the second operation is interrupted, the surviving active anchor still
cannot expose the tombstoned Storage head and an idempotent retract retry repairs
the anchor.

## Quota boundary

`novel_public_lounge_rate_reserve` performs one atomic fixed-window reservation
in PostgreSQL. It is shared by serverless instances and performs at most 64 TTL
deletions per call. Production requests derive their quota identity only from
Vercel's `x-vercel-forwarded-for` header and a server-only 32-byte HMAC key;
user agent and language never mint a new quota. Raw IP addresses are not stored.

Set `PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY` to 32 random bytes encoded as a
43-character base64url value. Rotating it rotates opaque identities; old quota
rows expire through bounded cleanup.

## Apply and verify

With `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` (or the existing
`SUPABASE_PROJECT_REF_FALLBACK`) configured:

```text
node scripts/apply-public-lounge-control-plane-migration.mjs --required
node scripts/apply-public-lounge-control-plane-migration.mjs --check
```

Static migration and real gateway RPC contracts:

```text
pnpm test:public-lounge:control-plane-migration
pnpm test:public-lounge:control-plane-rpc
```

The production gateway calls `novel_public_lounge_control_plane_status` along
with the private-bucket readiness check. Missing/stale migration markers, RPCs,
tables, service-role configuration, trusted IPs, or the HMAC key all fail closed
with the public `PUBLIC_LOUNGE_NOT_CONNECTED` response.
