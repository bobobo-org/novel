# Root Cause Analysis

## Incident

The RC2 deployment could report an old commit even when the deployed source was
newer.

## Proven Cause

Runtime metadata resolved the commit using:

`VERCEL_GIT_COMMIT_SHA || APP_COMMIT || local`

Promoted deployments do not always expose `VERCEL_GIT_COMMIT_SHA`. A stale
Production `APP_COMMIT` value therefore became authoritative and contaminated the
health response.

## Repair

The build now resolves the commit in this strict order:

1. `VERCEL_GIT_COMMIT_SHA`
2. `NOVEL_BUILD_APP_COMMIT`
3. `git rev-parse HEAD`
4. fail with `BUILD_COMMIT_UNAVAILABLE`

It serializes the result into a versioned, SHA-256 sealed build artifact. Runtime
reads that artifact and independently verifies its payload hash. `APP_COMMIT` is
never consulted.

## Boundary

Deployment identity remains runtime-scoped. No Preview or Production deployment ID
is written into the build seal.
