# Ollama adapter

Ollama endpoint is fixed to `http://127.0.0.1:11434`; redirects and arbitrary URL forwarding are disabled. `/api/tags`, `/api/version`, `/api/show`, and `/api/generate` are proxied through purpose-specific handlers. Errors map to explicit Bridge/Ollama codes. Upstream cancellation uses AbortController.
