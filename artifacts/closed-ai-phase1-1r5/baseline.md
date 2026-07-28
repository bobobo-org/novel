# Closed AI Phase 1.1R5 Baseline

- Base commit: `15e58c7aefc7b6df9e8ae0366ed4980021c9249e`
- Base Preview: `https://novel-l1h7l9tbt-lqtechs-projects.vercel.app`
- Branch: `feature/closed-ai-phase1-1r5-preview-loopback`
- Worktree: `C:\dev\novel-closed-ai-r5`
- Production deployment modified: no
- External AI called: no
- Model downloaded: no

## Reproduced R4 failure

From the HTTPS Preview Studio UI, selecting **開始安全配對** ended with
`signal timed out`. The local Bridge remained alive and its request log showed
no matching browser request. Direct diagnostic requests to the same Bridge are
not counted as Preview E2E; they only established that the server-side exact
origin CORS and Private Network Access preflight contract was functioning.

Initial classification: `BRIDGE_PROCESS_UNREACHABLE` at the browser-to-loopback
boundary. Mixed-content, PNA, browser isolation, and test-environment loopback
mapping remain hypotheses until a new Preview is tested through its visible UI.

## Scope lock

R5 changes only the Local Bridge origin enrollment, browser diagnostics,
connection-state presentation, security telemetry, and their tests. It does
not modify Story Bible persistence, approval transactions, Studio canonical
data, Production deployment, or model runtime behavior.
