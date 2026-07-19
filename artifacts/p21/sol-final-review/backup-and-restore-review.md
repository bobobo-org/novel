# Backup and Restore Review

## Passed independently

- Backup payload uses SHA-256 and rejects tampering.
- Operational stores and credential-bearing settings are excluded.
- Copy import recursively remaps nested record IDs and isolates the copy.
- Replace failure removes partially imported rows before restoring the previous snapshot.
- IndexedDB export uses one readonly transaction across all formal stores.
- P2.1 data closure: 7/7 PASS.

## Release blocker

The formal store registry does not include `acceptedChoices` or `storyBranches`. The public Studio maintains these values inside `novel_p12_studio_state`, so the formal `novel-backup-v3` round-trip is not a complete round-trip of the production consumer experience. Production browser verification of import failure rollback is also absent. Backup/restore must remain partial until these stores and browser tests exist.
