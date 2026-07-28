# Closed AI live training runtime

This runtime performs real local model work and records capability truth. It is
separate from Cache, Memory, Learning candidates, and Canon.

The first supported gate uses:

- local `qwen2.5:3b` through Ollama as the private teacher;
- operator-authorized synthetic prompts only;
- a one-step full-weight update as a hardware/pipeline qualification smoke;
- PEFT LoRA training on `HuggingFaceTB/SmolLM2-135M-Instruct`;
- an adapter checkpoint, fixed-input inference proof, dataset digest, and
  append-only hash-chain events;
- a fail-closed QLoRA hardware gate.

On a machine without compatible CUDA hardware, LoRA can run on CPU while QLoRA
remains `hardware_blocked_no_cuda`. The runtime never relabels CPU LoRA as
QLoRA.

Runtime artifacts are written outside the repository to:

```text
%LOCALAPPDATA%\NovelTrainingRuntime
```

The isolated Python environment is expected at:

```text
%LOCALAPPDATA%\NovelTrainingRuntime\venv
```

Run:

```powershell
$python = "$env:LOCALAPPDATA\NovelTrainingRuntime\venv\Scripts\python.exe"
& $python .\local-ai\training\live_training.py diagnose
& $python .\local-ai\training\live_training.py run
& $python .\local-ai\training\live_training.py status
& $python .\local-ai\training\browser_extractive_training.py
```

The LoRA artifact is a candidate. Activation, merge, export, promotion, or
sharing requires a separate approval transaction.

The currently verified `qwen2.5:3b` teacher reports the Qwen Research License.
Its distilled artifact therefore remains a local, non-commercial research
candidate and must not be distributed or commercially activated without a
separate license review. The runtime records that restriction instead of
treating every non-empty license string as permission.
