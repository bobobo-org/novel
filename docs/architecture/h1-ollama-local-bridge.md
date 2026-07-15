# H1 Ollama Local Bridge

Status: contract ready. Real local runtime readiness depends on an installed Ollama service and model.

The Ollama bridge uses `http://127.0.0.1:11434` by default. It only allows localhost, `127.0.0.1`, and `::1`, and blocks public URLs, cloud metadata hosts, `file://`, non-HTTP protocols, redirects, and non-standard ports.

Supported endpoints:

- `/api/tags`
- `/api/show`
- `/api/generate`
- `/api/chat`

The bridge supports:

- model health
- model list
- streaming and non-streaming generation
- abort and timeout
- structured JSON candidate output
- local JSON parsing/repair hooks

Ollama outputs remain drafts or Story Bible candidates. They do not directly mutate canonical rows. Production Vercel cannot reach a user's localhost, so public health reports `ollamaBridgeStatus=contract_ready` and `ollamaStatus=local_runtime_required` unless a real local integration test is explicitly running in a local environment.
