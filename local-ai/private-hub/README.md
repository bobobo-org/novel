# Novel Private AI Hub — self-hosted private node

This runtime is the heavy-task member of the three Closed AI backends. It is
not a public cloud endpoint. The default node binds only to
`127.0.0.1:3227`, uses the user's existing local Ollama runtime, and keeps
prompts, outputs, training samples, and authorization material off normal
logs.

It adds a separate authenticated queue and runtime identity for heavy and
multi-agent tasks. It can also train a small offline pairwise preference
adapter that influences generation. This adapter is a real trained model
artifact with a dataset digest, model digest, metrics, activation record, and
rollback pointer. It is not presented as LoRA/QLoRA or as a modified LLM
weight file.

## Start and connect

```powershell
$launcher = ".\local-ai\private-hub\novel-private-hub.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher diagnose
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher start
```

The two official production origins connect automatically with an
exact-origin, short-lived session. No website password or pairing code is
required. Preview and custom origins remain explicit; only for those origins,
start pairing in the Closed AI Center and read the one-time code:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher pair
```

The short session may be retained only in the current tab's `sessionStorage`.
It is never written to localStorage, a URL, project data, backup data, or normal
logs. Studio also reads `hubVersion` from `/health`; when the running node is
older than the website's compatible release, it shows an update action. After
restart, Studio reconnects and re-verifies the selected model automatically.

## Security and capability truth

- Bind address: `127.0.0.1`
- Model endpoint: `http://127.0.0.1:11434`
- Session: exact-origin-, instance-, and expiry-bound
- Allowed origins: shared with the Local Bridge exact-origin registry
- Logs: request identity, task type, model/adapter identity, timing, and
  sanitized status only
- Raw training examples: used in memory for one training request and not
  persisted
- Preference artifact: aggregate numeric weights, metrics, hashes, version,
  activation, and rollback metadata
- LoRA/QLoRA: not claimed unless a compatible GPU training backend completes
  a separate weight-training gate
- Firewall changes, LAN binding, telemetry, hidden model downloads: none

## Encrypted Private Hub Cache

Private Hub persists user, story, task and model-session cache entries as
AES-256-GCM encrypted files with a fresh nonce per write. File names contain
only entry digests; namespace and candidate content are inside the encrypted
envelope. The local key file and cache files are created with owner-only mode
where the operating system supports it.

The live `/generate` path can reuse an exact candidate only when every one of
the fourteen namespace fields matches, including model digest, Story Bible
revision, agent role and privacy level. GPU/KV state remains owned by Ollama;
the Hub stores only encrypted runtime-handle metadata.

Paired clients can inspect `/cache/stats` and perform targeted
`/cache/invalidate`. Cache data never becomes Memory, Learning or Canon
without the separate evaluator, human approval and signed approval
transaction.

## Autonomous learning experience ledger

When the user enables controlled autonomous practice and experience sync,
Studio may submit only the sealed `controlled-autonomous-practice-v1` summary
to `/learning/experiences`. The Hub rejects unknown fields, raw prompts,
story text, model output, credentials, AUTHOR_ONLY data, chain-of-thought, or
any claimed Canon, Memory, or model-weight mutation.

Accepted summaries are deduplicated and appended to an owner-local JSONL
ledger. Every record commits to the previous record hash, its sequence,
receipt time, and the complete de-identified experience digest. The full hash
chain is verified whenever the Hub starts; corruption stops the runtime
instead of silently accepting the ledger. These summaries remain learning
candidates and cannot activate an adapter without the existing dataset,
evaluation, approval, activation, and rollback gates.

While Private Hub remains running, the continuous-learning coordinator checks
the verified experience ledger every five minutes and immediately after a new
experience is accepted. It creates a new append-only strategy candidate only
when the ledger head changes. Candidates contain aggregate scores and outcome
counts, never prompts, story text, model output, credentials, or chain-of-thought.
The coordinator cannot mutate Canon, Memory, adapters, or model weights.
