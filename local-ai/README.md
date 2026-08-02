# Novel Closed AI local runtimes

This directory contains the device-local members of the unified Closed Agent
OS. They are separate runtimes with one shared task, candidate, approval,
cache, learning and capability-truth contract; they are not independent copies
of the product.

## Runtime map

- `bridge/`: authenticated loopback bridge from Studio to the user's Ollama
  runtime for long-form generation and revision.
- `private-hub/`: authenticated heavy-task queue, encrypted cache, controlled
  learning ledger and reversible preference adapter.
- `training/`: operator-authorized local training and distillation runtime.
- `companion/`: packaged Windows companion and update metadata.

Browser AI runs inside Studio rather than this directory. It uses a WebLLM
worker when an installed WebGPU model is available, Transformers.js for
semantic retrieval, and a packaged extractive model only as an explicitly
labelled light-task fallback.

## Verified capability boundary

- Local Ollama and Private Hub perform real model inference when their local
  processes and selected models are available.
- The training runtime has produced a real PEFT LoRA candidate, immutable
  digests and a post-training inference proof.
- The preference trainer produces a real, reversible local style adapter.
- LoRA artifacts remain candidates. Activation, merge, export, promotion or
  sharing requires a separate approval transaction.
- QLoRA remains blocked on devices without compatible CUDA and sufficient
  VRAM. CPU LoRA is never relabelled as QLoRA.
- Cache, Memory, Learning and Canon remain separate. A runtime result cannot
  become Canon merely because it was generated or cached.
- No runtime silently downloads a model, opens a LAN listener, changes the
  firewall, or sends private story content to an external provider.

## Start and diagnose

Use the component instructions:

- [Local Bridge](./bridge/README.md)
- [Private Hub](./private-hub/README.md)
- [Live training](./training/README.md)
- [Windows companion](./companion/README.md)

The normal listeners are loopback-only (`127.0.0.1`). The two official
Production origins can request a short-lived exact-origin session
automatically; the browser may still require the user to approve its native
local-network permission once. Preview and custom origins remain explicit and
must be enrolled and revoked by exact origin.

Model and training artifacts are stored outside the repository under the
user's local application-data directory. Logs contain bounded operational
metadata and digests, not prompts, story text, model output, credentials or
chain-of-thought.
