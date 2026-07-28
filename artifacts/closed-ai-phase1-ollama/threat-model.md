# Threat model

Controls cover malicious origins, CSRF, wildcard CORS, token-in-URL leakage, Host-header rebinding, SSRF, metadata endpoints, LAN scanning, public Ollama proxies, redirects, oversized prompts, excessive output, queue exhaustion, duplicate request IDs, stale Bridge instances, revoked/expired sessions, prompt/token logging, and silent external fallback.

Residual limitations: browser memory sessions are intentionally lost on reload; users pair again. TLS is not used on loopback. Studio integration is branch-local until a later approved deployment.
