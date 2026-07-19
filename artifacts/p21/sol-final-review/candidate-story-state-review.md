# Candidate, Canonical, and Story State Review

The formal game effect validator rejects non-finite and excessive values before applying effects. Existing P0 Story Bible transactions remain intact.

The production consumer acceptance path does not use that formal transaction. `app/studio/studio-client.tsx:1297` mutates candidate output,正文, versions, branches, Story State-like game values, tasks, and achievements in one in-memory object and persists the object asynchronously to localStorage. Double execution is not replay-safe.

Because `acceptedChoices` and `storyBranches` are absent from `NOVEL_STORES`, the release does not meet the P2.1 atomicity and backup closure gate.
