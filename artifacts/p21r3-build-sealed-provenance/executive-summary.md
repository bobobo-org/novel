# P2.1R3 Build-Sealed Provenance

Status:

- `P2.1R3_BUILD_SEALED_PROVENANCE_REPAIR_PASS`
- `P2.1R3_APP_COMMIT_ENV_CONTAMINATION_BLOCKED`
- `P2.1R3_RUNTIME_PROVENANCE_FAIL_CLOSED`
- `P2.1R3_READY_FOR_RC3_PREVIEW_GATE`
- `P2.1_PRODUCTION_RELEASE_STILL_BLOCKED`

The release commit is now resolved and sealed during the build. Runtime metadata no
longer treats `APP_COMMIT` as authoritative. The public health response verifies the
sealed payload hash and reports unavailable provenance if verification fails.

This change does not deploy or promote Production. RC3 Preview verification remains
the next gated activity.
