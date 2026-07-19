# Rollback plan

If production verification finds a critical data, privacy, or consumer regression, promote the last known P2 deployment and tag `novel-ai-p2-grand-integration` at commit `6c2b379bf6fea64796100c27b0c7e36b1672bf9a`.

Do not purge local IndexedDB data during rollback. P2.1 data uses additive stores and reader defaults; the prior build ignores unknown records. Preserve production evidence and disable P2.1 preview flags before attempting a code rollback.
