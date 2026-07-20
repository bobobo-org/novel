# Exact Origin Enrollment Contract

Schema: `novel-bridge-origin-registry-v1`

## Commands

```text
launcher origin add <exact-origin> --confirm <exact-origin>
launcher origin list
launcher origin revoke <exact-origin> --confirm <exact-origin>
```

The PowerShell wrapper accepts the same command and remaining arguments.

## Accepted origins

- Exact remote HTTPS origin with no credentials, path, query, or fragment.
- Exact localhost or loopback development origin using HTTP or HTTPS.
- The built-in Production origin is immutable through enrollment commands.

## Rejected origins

- Wildcards, including `*.vercel.app`.
- Remote HTTP.
- Remote IP addresses and address ranges.
- URLs with credentials, paths, query strings, or fragments.
- `start --origin` when the exact origin was not enrolled first.

## Persistence and privacy

Only the origin, scope, enrollment timestamp, action, and result are persisted.
Pairing tokens, authorization headers, prompts, outputs, and Story Bible content
are not stored in the registry or access audit. Changes require explicit local
confirmation and a Bridge restart to affect the running process.

## Browser security

The Bridge remains bound to `127.0.0.1`. It returns the exact allowed origin,
never `*`, and returns `Access-Control-Allow-Private-Network: true` only when a
valid preflight explicitly requests private-network access. Host validation
rejects DNS-rebinding hostnames before routing.
