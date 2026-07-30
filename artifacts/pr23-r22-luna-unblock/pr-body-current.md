## PR23 R2.2 current release identity

This Draft PR remains open and unmerged. R2.2 is an audit-only follow-up; it does not modify the PR Head or Production.

### Protected identities

- Base `main`: `d0e80323dc68bf08cb541e46c6b9114a71e05cd9`
- Validated Product Head: `cf80c045cdab88e3515e9fc9a894c65400a59284`
- Final PR Head: `6c00673bb3349e49a49f0f5d72cce499c67033d6`
- Current merge ref: `169328016111d69e0adab784d817a5653113a852`
- Product CI: [30570122337](https://github.com/bobobo-org/novel/actions/runs/30570122337) — `completed/success`
- Evidence CI: [30572775023](https://github.com/bobobo-org/novel/actions/runs/30572775023) — `completed/success`
- Product Preview: https://novel-hxh5cy2vk-lqtechs-projects.vercel.app
- Final Evidence Preview: https://novel-15gi72tr4-lqtechs-projects.vercel.app
- Default branch: `main`

### Independent LUNA R1

Status: **BLOCKED**

The R1 blockers were:

- the reviewer environment did not expose a controllable Microsoft Edge surface;
- v2 retained only the aggregate Console count and did not retain raw Console records;
- the PR body contained stale identities;
- legacy Production does not yet contain the new `/api/release/identity` route.

R2.2 confirms that Microsoft Edge is installed and provides a repeatable raw-evidence runner, but this execution environment still exposes only the Codex in-app browser. Therefore no fresh Edge raw records or Edge PASS are claimed.

### Release Identity transition

Production `/api/release/identity` returning 404 is the expected legacy-baseline state. The new Preview already returns a verified Release Identity. Deployment tooling may use the exactly frozen legacy Vercel control-plane identity only during `capture-primary`, `capture-mirror`, `verify-rollback-primary`, and `verify-rollback-mirror`. After a new release is switched, verification must use the new endpoint; promotion verification cannot use the fallback.

### Current boundary

- `LOCAL_CANONICAL_FLOW_READY`
- `CLOUD_PERSISTENCE_NOT_READY`
- `SUPABASE_PRODUCTION_REPAIR_NOT_COMPLETED`
- `PRODUCTION_UNCHANGED`
- `PR23_OPEN`
- `PR23_DRAFT`
- `PR23_UNMERGED`
- `PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED`

### Automatic Production deployment

The active repository workflow is configured as `push(main) → validate → staged Vercel production → Release Identity verification → Mirror alias → novel-orcin primary alias`, with atomic compensation on a failed alias verification. Required repository secret names are present; secret values were not read. The latest `main` push completed this workflow successfully.

This R2.2 audit did not push or merge into `main`, because the required fresh Edge raw-evidence Gate is still blocked.

### Audit evidence

- [Audit branch](https://github.com/bobobo-org/novel/tree/audit/pr23-r22-luna-unblock)
- [Audit commit history](https://github.com/bobobo-org/novel/commits/audit/pr23-r22-luna-unblock)

No Production deployment, alias mutation, Supabase Production repair, Ready-for-Review transition, approval, auto-merge, or merge was performed.
