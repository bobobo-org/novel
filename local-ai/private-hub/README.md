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

## Start and pair

```powershell
$launcher = ".\local-ai\private-hub\novel-private-hub.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher diagnose
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher start
```

Start pairing in the Closed AI Center, then read the one-time code:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher pair
```

The authorization token stays in the current page's memory. Reloading the
page or restarting the node requires pairing again.

## Security and capability truth

- Bind address: `127.0.0.1`
- Model endpoint: `http://127.0.0.1:11434`
- Pairing: origin-, instance-, and expiry-bound
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
