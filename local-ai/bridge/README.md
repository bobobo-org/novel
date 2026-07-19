# Novel Local Bridge

The Local Bridge connects the browser Studio to the user's own Ollama process without exposing Ollama to the public network.

## Prerequisites

1. Install Ollama from its official distribution.
2. Start Ollama locally and install a text model yourself. The Bridge never downloads a model.
3. Node.js 22 or the bundled Codex Node runtime.

## Start on Windows

```powershell
ollama serve
pnpm start:ai:closed:bridge
```

The Bridge listens on `127.0.0.1:3217`. It refuses `0.0.0.0`, LAN addresses, public addresses, wildcard CORS, and Ollama endpoints other than `http://127.0.0.1:11434`. No firewall rule is added.

Open Studio's **AI 使用方式** page, choose **開始安全配對**, read the six-digit code from the local Bridge window, and enter it in Studio. The authorization token remains in page memory; it is not written to localStorage, a URL, or normal logs.

## Stop and revoke

- Use **撤銷配對** in Studio before stopping when possible.
- Stop the Bridge with `Ctrl+C`.
- A Bridge restart creates a new instance ID and invalidates old in-memory authorization.
- To remove local runtime data, stop the Bridge. Phase 1 stores no prompt, output, or token files.

## Optional origins

Extra preview origins require an explicit environment setting and HTTPS:

```powershell
$env:BRIDGE_ALLOWED_ORIGINS='https://your-preview.example'
pnpm start:ai:closed:bridge
```

## Common errors

- `BRIDGE_NOT_PAIRED`: request a new local pairing.
- `OLLAMA_UNREACHABLE`: start or restart Ollama.
- `OLLAMA_MODEL_NOT_FOUND`: select an installed text model.
- `OLLAMA_TIMEOUT`: retry with a shorter task or larger allowed timeout.
- `LOCAL_CONCURRENCY_LIMIT`: wait for the active local generation to finish.
- `EADDRINUSE`: another Bridge process already owns port 3217.

Debug content logging is not implemented in Phase 1. Normal logs contain only request ID, task type, provider, model ID, timing, status, and sanitized error code.
