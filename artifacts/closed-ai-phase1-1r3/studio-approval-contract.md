# Studio Story Bible Approval Contract

The Studio extraction path reads a formal IndexedDB project and chapter, records the chapter revision, runs the existing local quality guard, and stores validated candidates inside the existing `storyBibles` record.

Formal commit requires an explicit, high-confidence, schema-valid fact with exact source evidence and matching source revision. Author approval then writes the candidate state, canonical fact, evidence, approval event, audit, revision, and any conflict as one revision-guarded repository `put`. Replays return `ALREADY_COMMITTED`; stale revisions fail; conflicting facts remain reviewable and do not overwrite canonical data; injected faults occur before the atomic put.

No accepted choice, story branch, Story State, backup, restore, or IndexedDB schema path is changed.

The current deterministic functional suite is not browser E2E evidence. Preview browser results are recorded separately after deployment.
