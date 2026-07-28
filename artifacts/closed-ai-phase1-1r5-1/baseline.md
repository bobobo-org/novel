# Closed AI Phase 1.1R5.1 Baseline

- Base commit: `7479884c603612289d7b71fab4563e65486e4cae`
- Branch: `feature/closed-ai-phase1-1r5-1-dynamic-origin`
- Worktree: `C:\dev\novel-closed-ai-r5-1`
- Production deployment: unchanged and out of scope
- R5 Preview: `https://novel-dfb5ksxq3-lqtechs-projects.vercel.app`
- Root cause: the Studio settings component rendered `http://localhost:3000` during SSR and used it to construct a copyable enrollment command before browser hydration.

The R5 worktree remained untouched. R5.1 uses an independent clean worktree created from the R5 final commit.
