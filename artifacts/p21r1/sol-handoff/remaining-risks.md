# Remaining Risks

- Production has not been changed. The public `screen=home` E2E must be rerun after independent Sol approval and deployment.
- `indexedDb.fullAdoption` remains `partial` because some Legacy features still use localStorage. Those paths are not accepted-choice, branch, Story State, or canonical chapter storage for Studio.
- Legacy interaction rows without stable project, chapter, candidate, revision, and effect identifiers remain `manual_review`; no history is fabricated.
- Browser AI, Ollama, and Private AI Hub runtime availability remains client dependent and is outside this High-risk closure.
