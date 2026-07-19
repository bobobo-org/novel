# Transaction boundaries

- Project creation: project bundle plus request ledger in one IndexedDB transaction.
- Replace restore: delete current project records except recovery backups, then write the validated backup payload in one transaction.
- Candidate and canonical transaction safety remain governed by the existing P0-C2 storage boundary; P2.1 does not bypass it.
- Story effects are validated before application by the existing P2 effect validator.
