# Training run contract

Version: `closed-ai-training-run-v1`

A run must bind an immutable dataset ID/version, base model ID/version, method, evaluator version, and benchmark version. Optional profiles describe hyperparameters, hardware, and checkpoints. Phase 0 permits `contract_only` records but launches no run and allocates no GPU.

