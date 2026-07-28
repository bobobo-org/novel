# Local Bridge Launcher Contract

Schema: `novel-local-bridge-launcher-v1`

## Commands

Run commands from the project directory with `pnpm local-ai <command>`.

| Command | Result | Safety property |
| --- | --- | --- |
| `start` | Starts one hidden Bridge process | Binds only `127.0.0.1:3217`; never installs Ollama or downloads a model |
| `status` | Reports Bridge, Ollama, model, and next step | Does not expose credentials |
| `stop` | Stops only the launcher-owned Bridge | Does not stop Ollama |
| `restart` | Replaces the Bridge instance | Invalidates the old instance and pairing |
| `pair` | Displays one short-lived one-use pairing code | Code file is removed when read; session token is never shown |
| `revoke` | Replaces the Bridge instance | Old tokens immediately become invalid |
| `diagnose` | Reports local prerequisites and endpoints | Does not include prompts, outputs, Story Bible content, or tokens |

## Fixed boundaries

- Bridge endpoint: `http://127.0.0.1:3217`
- Ollama endpoint: `http://127.0.0.1:11434`
- Protocol: `novel-local-bridge/v1`
- Node.js: 22 or newer
- No firewall modification, LAN listener, telemetry, model download, or external inference.
- Maximum prompt: 65,536 bytes; maximum output: 2,048 tokens; maximum concurrent jobs: 1; queue: 2; timeout: 120 seconds; rate: 30 requests/minute/origin.

## Failure contract

Every launcher failure returns an error code, a Traditional Chinese message, and an actionable `nextStep`. Corrupt configuration, occupied port, missing model, unsupported Node version, stale PID, and unwritable runtime directory are tested in `launcher-test-results.json`.
