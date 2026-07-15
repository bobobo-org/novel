# AI Provider Contract

Status: H1 contract ready.

The provider boundary isolates model execution from storage, canonical mutation, and user-facing application state. Providers receive only an `AiProviderRequest` and return an `AiProviderResult`. They must not expose Supabase tables, SQLite tables, canonical SQL, storage paths, API keys, admin tokens, private prompts, or stack traces.

Supported provider ids in H1:

- `local-rule`
- `ollama-local`
- `google-gemini`
- `openai` placeholder
- `grok` placeholder

Every provider implements:

- `analyzeStory`
- `extractStoryBible`
- `summarizeChapter`
- `checkConsistency`
- `continueWriting`
- `rewriteText`
- `brainstormPlot`
- `classifyTask`
- `ping`
- `getCapabilities`
- `estimateContext`
- `cancel`

Provider results are candidates only. They never write canonical Story Bible rows or replace user prose directly.
