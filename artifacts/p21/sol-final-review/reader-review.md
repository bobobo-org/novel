# Reader Review

Reader state, notes, and bookmarks are represented in the formal repository. Production mobile Studio loaded without horizontal overflow and with zero captured console errors.

The review found a stale-revision race when rapid preference or scroll updates reused the rendered `state.revision`. The review patch serializes writes through `saveQueue` and reads the latest committed state from `stateRef`. TypeScript and production build pass after this change.

Remaining non-blocking limitation: intelligent note relocation after major正文 edits is not implemented.
