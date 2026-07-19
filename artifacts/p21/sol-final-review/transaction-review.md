# Transaction Review

`IndexedDbNovelRepository.createProject` and import replacement use multi-store transactions. The review patch also makes export a single readonly multi-store snapshot. Revision conflicts are enforced for individual records.

The public `/studio` consumer path is separate. `acceptChoiceResult` calculates and applies正文、版本、branch、game state、task and achievement changes in a React state update; persistence occurs later through `localStorage.setItem`. There is no durable request ledger, transaction abort, or revision precondition. This is a High release blocker.

Required boundary: candidate status, accepted choice, branch, chapter version, Story State effects, task/achievement effects, and requestId ledger must commit or abort together in the authoritative repository.
