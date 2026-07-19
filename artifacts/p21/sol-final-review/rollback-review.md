# Rollback Review

The target release documents a code rollback to the previous P2 commit and retention of IndexedDB data. This is directionally safe, but it is not an executable rollback proof.

The prior client has no demonstrated unknown-schema read-only guard. A user opening the old build could write an older ReaderState shape after rollback. The independent review therefore requires a downgrade fixture, safe refusal/read-only mode, rollback rehearsal, and upgrade recovery test before rollback can be called ready.

The review patch itself was not deployed because the target release is rejected. Production remains on `cb70dfce7bbaca2622652580a2fe60ce325da700`.
