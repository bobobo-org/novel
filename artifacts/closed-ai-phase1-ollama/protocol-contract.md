# Protocol contract

- Protocol: `novel-local-bridge/v1`
- Bridge: `1.0.0-phase1`
- Endpoints: `/health`, `/pair/request`, `/pair/confirm`, `/pair/revoke`, `/models`, `/models/:modelId`, `/generate`, `/cancel`
- Streaming: NDJSON events `started`, `token`, `metadata`, `completed`, `cancelled`, `failed`
- Unknown protocol: `BRIDGE_PROTOCOL_INCOMPATIBLE`
