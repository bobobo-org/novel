# Novel Local Bridge

The Local Bridge connects Studio to the user's own Ollama process. It only
listens on `127.0.0.1:3217`; it never opens Ollama to a LAN or public network.

## Prerequisites

1. Install and start Ollama yourself.
2. Install a text-generation model yourself. The Bridge never downloads one.
3. Install Node.js 22 or set `NOVEL_NODE_PATH` to a compatible `node.exe`.

## Windows launcher

Use a fresh PowerShell window. The explicit execution-policy flag avoids
machine policy ambiguity without changing the machine policy:

```powershell
$launcher = ".\local-ai\bridge\novel-local-ai.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher diagnose
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher status
```

If Node.js is not on `PATH`, point to an existing installation for this shell:

```powershell
$env:NOVEL_NODE_PATH = "C:\Program Files\nodejs\node.exe"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher diagnose
```

The launcher supports `diagnose`, `start`, `status`, `stop`, `restart`,
`pair`, `revoke`, and `origin`. It does not install software, edit `PATH`, modify the
firewall, or stop Ollama.

### Authorize an exact Preview origin

A Vercel Preview is not trusted automatically. Enroll its exact HTTPS origin
locally, then restart the Bridge so the new allowlist becomes active:

```powershell
$origin = "https://your-exact-preview.vercel.app"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher origin add $origin --confirm $origin
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher restart
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher origin list
```

After testing, revoke that exact origin and restart again:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher origin revoke $origin --confirm $origin
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher restart
```

Enrollment is an explicit local action. Wildcards, paths, query strings,
remote HTTP origins, and remote IP origins are rejected. The registry stores
only the non-sensitive origin and audit event; it never stores a pairing token.

After Studio requests pairing, read the one-time code locally:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher pair
```

Enter that code in Studio. The authorization token remains in page memory. It
is not written to localStorage, sessionStorage, a URL, or normal logs. Reloading
Studio or restarting the Bridge requires a new pairing.

## Security and limits

- Bridge bind address: `127.0.0.1`
- Ollama endpoint: `http://127.0.0.1:11434`
- CORS: explicit Studio origins only
- Preview access: enroll the exact HTTPS origin with `origin add`, restart the Bridge, and revoke it after testing. `start --origin` only selects an origin that is already enrolled; it cannot create authorization.
- Pairing: origin-bound, instance-bound, short-lived, revocable
- Logging: request ID, task type, provider, model ID, timing, status, and
  sanitized error code only
- Full prompts, outputs, Story Bible content, authorization headers, and
  pairing tokens are not logged
- Prompt size, output tokens, concurrency, queue depth, timeouts, and
  per-origin request rates are bounded by the Bridge runtime

## Stop and recover

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher stop
```

Stopping releases port 3217 and leaves Ollama running. A Bridge restart creates
a new instance ID, so old in-memory authorization cannot be reused.

Common errors:

- `LAUNCHER_NODE_NOT_FOUND`: install Node.js 22 or set `NOVEL_NODE_PATH`.
- `BRIDGE_NOT_PAIRED`: request a new pairing in Studio, then run `pair`.
- `BRIDGE_PAIRING_EXPIRED`: request and confirm a new one-time code.
- `OLLAMA_UNREACHABLE`: start or restart Ollama.
- `OLLAMA_MODEL_NOT_FOUND`: select an installed text model.
- `OLLAMA_TIMEOUT`: shorten the task or raise the task timeout.
- `LOCAL_CONCURRENCY_LIMIT`: wait for the active request to finish.
- `EADDRINUSE`: another process already owns port 3217.

Physical mobile devices cannot use the desktop's loopback Bridge. Phase 1.1R1
does not expose a LAN endpoint or implement a remote desktop Bridge.
