# PR23 R2.2 Edge-capable LUNA handoff

Verdict from this SOL environment: **PR23_R2_2_EDGE_ENVIRONMENT_BLOCKED**

Use the audit branch `audit/pr23-r22-luna-unblock`. From a runtime that can control the installed Microsoft Edge and let the reviewer make the native Local Network Access decision, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\audit\run-pr23-r22-edge-evidence.ps1
```

The runner uses a fresh random profile, the exact installed `msedge.exe`, sandboxing, no permission injection, no bypass, no mock, no external AI, redacted structured raw records, and exact-origin Bridge enrollment with cleanup.

Do not reuse v2 as fresh raw evidence. A valid R2 continuation requires a completed Edge run, non-empty records where the browser emits records, complete per-record classification, zero PRODUCT_ERROR, zero SECURITY_ERROR, zero UNCLASSIFIED, real qwen2.5:3b execution, and all Canon/ABC/workspace/backup assertions.

Protected boundaries remain:

- PR #23 Head: `6c00673bb3349e49a49f0f5d72cce499c67033d6`
- Production: `d0e80323dc68bf08cb541e46c6b9114a71e05cd9` / `dpl_8vdPA2mFkDJUezr5Rfn5MuxqJuBa`
- no Supabase Production repair
- no Production deploy/promote/rollback
- no Ready-for-Review or merge transition
