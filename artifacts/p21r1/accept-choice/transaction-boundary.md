# Accept Choice Transaction Boundary

`NovelRepository.acceptChoiceTransaction` owns the complete acceptance commit. The IndexedDB implementation opens one read/write transaction over `projects`, `chapters`, `candidates`, `storyStates`, `acceptedChoices`, `storyBranches`, and `operationJournal`.

Before writing it verifies project ownership, chapter ownership, candidate status, project/chapter/candidate/story-state revisions, parent branch ownership, accepted text, and the validated Story State effect. It then writes the accepted choice, branch, accepted candidate, appended chapter content, updated Story State, project revision, and operation journal. UI success is set only after the transaction resolves.

The idempotency index is unique. A repeated `idempotencyKey` returns the recorded result; a different operation cannot accept an already accepted candidate. Any thrown validation or storage error aborts the transaction.

Studio stores only uncommitted preview state in React. Its localStorage shell removes candidate, branches, story state/game state, chapter body, versions, and formal backups. IndexedDB hydration failure does not silently promote the localStorage shell to canonical data.
