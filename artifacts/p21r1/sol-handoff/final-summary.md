# P2.1R1 Sol Handoff

All three High findings have implementation fixes and local release-candidate evidence.

- High 1: Studio acceptance now waits for `acceptChoiceTransaction`; its seven canonical stores commit atomically with revision and idempotency guards. localStorage is a non-canonical shell only.
- High 2: IndexedDB v3 adds `acceptedChoices`, `storyBranches`, and `operationJournal`. Backup v3 exports, validates, remaps, copies, and restores interaction records.
- High 3: `lib/novel-ai/capabilities` is the source for Health and capability reporting. Full IndexedDB adoption and legacy-format import remain honestly `partial`.
- `/studio?screen=home` completed a real browser walkthrough through create, write, interactive acceptance, reload, reopen, and full backup. The compatibility query `screen=interactive` resolves to the canonical `choice` screen and is never a data store.
- High-risk suite: 3 consecutive runs, each 21 PASS / 0 FAIL.
- Regression: P2.1 7/0, P2 18/0, P1.5 30/0, P1.2 95/0, H2W.3 737/0. TypeScript, focused ESLint, production build, desktop/mobile browser checks passed; console errors 0.

No tag, push, or Production deployment was performed. Independent Sol review remains the next gate.
