from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import platform
import socket
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("DO_NOT_TRACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

RUNTIME_ROOT = Path(
    os.environ.get(
        "NOVEL_TRAINING_RUNTIME_DIR",
        str(Path(os.environ.get("LOCALAPPDATA", Path.home())) / "NovelTrainingRuntime"),
    )
)
RUNS_DIR = RUNTIME_ROOT / "runs"
STATUS_PATH = RUNTIME_ROOT / "status.json"
LEDGER_PATH = RUNTIME_ROOT / "training-ledger.jsonl"
LOCK_PATH = RUNTIME_ROOT / "training.lock"
SCHEMA_VERSION = "novel-closed-ai-live-training-v1"
DEFAULT_TEACHER = "qwen2.5:3b"
DEFAULT_STUDENT = "HuggingFaceTB/SmolLM2-135M-Instruct"
OLLAMA_ENDPOINT = "http://127.0.0.1:11434"

SYNTHETIC_TASKS = (
    "用繁體中文寫兩句小說續寫：主角在雨夜發現門鎖上有陌生人的指紋。",
    "用繁體中文寫兩句角色反應：盟友承認自己隱瞞了關鍵情報。",
    "用繁體中文寫一句場景摘要：斷電後的圖書館只剩緊急照明，帳冊失蹤。",
    "用繁體中文提出兩個互斥選擇：主角必須在救人與保住證據之間決定。",
)


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else default
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def append_ledger(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    previous_hash = "0" * 64
    sequence = 1
    try:
        lines = [line for line in LEDGER_PATH.read_text(encoding="utf-8").splitlines() if line]
        if lines:
            previous = json.loads(lines[-1])
            previous_hash = str(previous["eventHash"])
            sequence = int(previous["sequence"]) + 1
    except (FileNotFoundError, json.JSONDecodeError, KeyError, ValueError):
        pass
    core = {
        "schemaVersion": "novel-training-hash-chain-v1",
        "sequence": sequence,
        "eventType": event_type,
        "recordedAt": utc_now(),
        "previousHash": previous_hash,
        "payloadDigest": sha256_text(canonical_json(payload)),
    }
    record = {**core, "eventHash": sha256_text(canonical_json(core))}
    with LEDGER_PATH.open("a", encoding="utf-8") as stream:
        stream.write(canonical_json(record) + "\n")
    return record


def update_status(**values: Any) -> dict[str, Any]:
    current = read_json(
        STATUS_PATH,
        {
            "schemaVersion": SCHEMA_VERSION,
            "modelTraining": "not_started",
            "distillation": "not_started",
            "lora": "not_started",
            "qlora": "not_started",
            "fullWeightTraining": "not_started",
            "latestRunStatus": "idle",
        },
    )
    current.update(values)
    current["schemaVersion"] = SCHEMA_VERSION
    current["updatedAt"] = utc_now()
    atomic_json(STATUS_PATH, current)
    return current


def acquire_lock(run_id: str) -> None:
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(str(LOCK_PATH), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as error:
        raise RuntimeError("TRAINING_JOB_ALREADY_RUNNING") from error
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(json.dumps({"runId": run_id, "pid": os.getpid(), "startedAt": utc_now()}))


def release_lock() -> None:
    try:
        LOCK_PATH.unlink()
    except FileNotFoundError:
        pass


def post_json(route: str, payload: dict[str, Any], timeout: int = 180) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{OLLAMA_ENDPOINT}{route}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            value = json.loads(response.read().decode("utf-8"))
            if not isinstance(value, dict):
                raise RuntimeError("OLLAMA_INVALID_RESPONSE")
            return value
    except (urllib.error.URLError, socket.timeout) as error:
        raise RuntimeError("OLLAMA_UNREACHABLE") from error


def get_json(route: str, timeout: int = 10) -> dict[str, Any]:
    request = urllib.request.Request(f"{OLLAMA_ENDPOINT}{route}", method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            value = json.loads(response.read().decode("utf-8"))
            if not isinstance(value, dict):
                raise RuntimeError("OLLAMA_INVALID_RESPONSE")
            return value
    except (urllib.error.URLError, socket.timeout) as error:
        raise RuntimeError("OLLAMA_UNREACHABLE") from error


def model_tag(model_id: str) -> dict[str, Any]:
    tags = get_json("/api/tags")
    for item in tags.get("models", []):
        if item.get("model") == model_id or item.get("name") == model_id:
            return item
    raise RuntimeError("OLLAMA_MODEL_NOT_FOUND")


def teacher_metadata(model_id: str) -> dict[str, Any]:
    tag = model_tag(model_id)
    show = post_json("/api/show", {"model": model_id, "verbose": False}, timeout=30)
    license_text = str(show.get("license") or "")
    normalized_license = license_text.casefold()
    permissive_license = any(
        marker in normalized_license
        for marker in (
            "apache license",
            "mit license",
            "bsd license",
        )
    )
    qwen_research_license = "qwen research license agreement" in normalized_license
    distillation_permitted = permissive_license or qwen_research_license
    return {
        "modelId": model_id,
        "modelDigest": str(tag.get("digest") or sha256_text(canonical_json(tag))),
        "licenseDigest": sha256_text(license_text),
        "licensePolicy": (
            "permissive_license_verified"
            if permissive_license
            else (
                "noncommercial_research_candidate_only"
                if qwen_research_license
                else "license_review_required"
            )
        ),
        "distillationPermitted": distillation_permitted,
        "commercialUsePermitted": permissive_license,
        "distributionRequiresSeparateReview": qwen_research_license,
        "localOrPrivate": True,
    }


def collect_teacher_demonstrations(
    teacher: dict[str, Any],
    run_dir: Path,
) -> tuple[list[dict[str, Any]], str]:
    if not teacher["distillationPermitted"]:
        raise RuntimeError("DISTILLATION_TEACHER_LICENSE_UNVERIFIED")
    samples: list[dict[str, Any]] = []
    for index, prompt in enumerate(SYNTHETIC_TASKS):
        generated = post_json(
            "/api/generate",
            {
                "model": teacher["modelId"],
                "prompt": prompt,
                "system": (
                    "你是本機小說蒸餾教師。只回答題目，不提及訓練、政策或系統。"
                    "使用繁體中文，避免抄錄既有作品。"
                ),
                "stream": False,
                "keep_alive": "0" if index == len(SYNTHETIC_TASKS) - 1 else "10m",
                "options": {"temperature": 0, "seed": 100 + index, "num_predict": 96},
            },
        )
        output = str(generated.get("response") or "").strip()
        if not output:
            raise RuntimeError("DISTILLATION_TEACHER_EMPTY_OUTPUT")
        samples.append(
            {
                "sampleId": f"synthetic-{index + 1}",
                "instruction": prompt,
                "output": output,
                "approvedForTraining": True,
                "source": "operator-authorized-synthetic",
                "privacyLevel": "synthetic_public_safe",
                "teacherModelId": teacher["modelId"],
                "teacherModelDigest": teacher["modelDigest"],
                "demonstrationDigest": sha256_text(f"{prompt}\n{output}"),
            }
        )
    dataset_path = run_dir / "distillation-dataset.jsonl"
    dataset_text = "".join(canonical_json(sample) + "\n" for sample in samples)
    dataset_path.write_text(dataset_text, encoding="utf-8")
    return samples, sha256_text(dataset_text)


def package_versions() -> dict[str, Any]:
    import accelerate
    import peft
    import torch
    import transformers

    return {
        "python": platform.python_version(),
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "peft": peft.__version__,
        "accelerate": accelerate.__version__,
    }


def hardware_profile() -> dict[str, Any]:
    import psutil
    import torch

    memory = psutil.virtual_memory()
    cuda = bool(torch.cuda.is_available())
    return {
        "platform": platform.platform(),
        "logicalCpuCount": os.cpu_count(),
        "ramGiB": round(memory.total / (1024**3), 2),
        "availableRamGiB": round(memory.available / (1024**3), 2),
        "cudaAvailable": cuda,
        "cudaDevice": torch.cuda.get_device_name(0) if cuda else None,
        "qloraEligible": cuda and torch.cuda.get_device_properties(0).total_memory >= 8 * 1024**3,
        "trainingDevice": "cuda" if cuda else "cpu",
    }


def tensor_digest(parameters: Iterable[Any]) -> str:
    digest = hashlib.sha256()
    for parameter in parameters:
        tensor = parameter.detach().cpu().contiguous()
        digest.update(str(tuple(tensor.shape)).encode("ascii"))
        digest.update(tensor.numpy().tobytes())
    return digest.hexdigest()


def checkpoint_digest(directory: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in directory.rglob("*") if item.is_file()):
        digest.update(path.relative_to(directory).as_posix().encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def tokenize_sample(tokenizer: Any, sample: dict[str, Any], max_length: int) -> dict[str, Any]:
    import torch

    prompt = f"使用者：{sample['instruction']}\n助理："
    combined = f"{prompt}{sample['output']}{tokenizer.eos_token or ''}"
    encoded = tokenizer(
        combined,
        return_tensors="pt",
        truncation=True,
        max_length=max_length,
        padding=False,
    )
    prompt_tokens = tokenizer(
        prompt,
        return_tensors="pt",
        truncation=True,
        max_length=max_length,
        padding=False,
    )["input_ids"].shape[1]
    labels = encoded["input_ids"].clone()
    labels[:, : min(prompt_tokens, labels.shape[1])] = -100
    if bool(torch.all(labels == -100)):
        labels[:, -1] = encoded["input_ids"][:, -1]
    return {
        "input_ids": encoded["input_ids"],
        "attention_mask": encoded["attention_mask"],
        "labels": labels,
    }


def model_metadata(model: Any, model_id: str) -> dict[str, Any]:
    config = model.config
    return {
        "modelId": model_id,
        "modelType": str(getattr(config, "model_type", "unknown")),
        "commitHash": str(getattr(config, "_commit_hash", "") or ""),
        "parameterCount": int(sum(parameter.numel() for parameter in model.parameters())),
    }


def load_model_and_tokenizer(model_id: str) -> tuple[Any, Any]:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(
        model_id,
        trust_remote_code=False,
        use_fast=True,
    )
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        dtype=torch.float32,
        low_cpu_mem_usage=True,
        trust_remote_code=False,
        use_safetensors=True,
    )
    model.config.use_cache = False
    return model, tokenizer


@dataclass
class FullWeightEvidence:
    steps: int
    initialDigest: str
    finalDigest: str
    loss: float
    weightsChanged: bool
    checkpointPersisted: bool
    purpose: str


def run_full_weight_smoke(
    model: Any,
    tokenizer: Any,
    sample: dict[str, Any],
    steps: int,
) -> FullWeightEvidence:
    import torch

    model.train()
    parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
    initial_digest = tensor_digest(parameters)
    optimizer = torch.optim.SGD(parameters, lr=1e-4)
    batch = tokenize_sample(tokenizer, sample, max_length=64)
    loss_value = 0.0
    for _ in range(steps):
        optimizer.zero_grad(set_to_none=True)
        loss = model(**batch).loss
        loss.backward()
        optimizer.step()
        loss_value = float(loss.detach().cpu())
    final_digest = tensor_digest(parameters)
    return FullWeightEvidence(
        steps=steps,
        initialDigest=initial_digest,
        finalDigest=final_digest,
        loss=loss_value,
        weightsChanged=initial_digest != final_digest,
        checkpointPersisted=False,
        purpose="hardware-and-pipeline-qualification-only",
    )


def lora_targets(model: Any) -> list[str]:
    suffixes = {name.rsplit(".", 1)[-1] for name, _ in model.named_modules()}
    if {"q_proj", "v_proj"}.issubset(suffixes):
        return ["q_proj", "v_proj"]
    if "c_attn" in suffixes:
        return ["c_attn"]
    raise RuntimeError("LORA_TARGET_MODULES_UNSUPPORTED")


def run_lora_training(
    model: Any,
    tokenizer: Any,
    samples: list[dict[str, Any]],
    adapter_dir: Path,
    steps: int,
) -> dict[str, Any]:
    import torch
    from peft import LoraConfig, get_peft_model

    targets = lora_targets(model)
    config = LoraConfig(
        r=4,
        lora_alpha=8,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=targets,
    )
    model = get_peft_model(model, config)
    trainable = [parameter for parameter in model.parameters() if parameter.requires_grad]
    initial_digest = tensor_digest(trainable)
    optimizer = torch.optim.AdamW(trainable, lr=2e-4)
    losses: list[float] = []
    model.train()
    for step in range(steps):
        batch = tokenize_sample(tokenizer, samples[step % len(samples)], max_length=128)
        optimizer.zero_grad(set_to_none=True)
        loss = model(**batch).loss
        loss.backward()
        torch.nn.utils.clip_grad_norm_(trainable, 1.0)
        optimizer.step()
        losses.append(float(loss.detach().cpu()))
    final_digest = tensor_digest(trainable)
    if initial_digest == final_digest:
        raise RuntimeError("LORA_WEIGHTS_DID_NOT_CHANGE")
    adapter_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(adapter_dir, safe_serialization=True)
    tokenizer.save_pretrained(adapter_dir)
    model.eval()
    verification_prompt = "使用者：用一句繁體中文描述雨夜的抉擇。\n助理："
    encoded = tokenizer(verification_prompt, return_tensors="pt")
    with torch.no_grad():
        generated = model.generate(
            **encoded,
            max_new_tokens=24,
            do_sample=False,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    completion = tokenizer.decode(
        generated[0][encoded["input_ids"].shape[1] :],
        skip_special_tokens=True,
    ).strip()
    if not completion:
        raise RuntimeError("LORA_INFERENCE_EMPTY_OUTPUT")
    return {
        "steps": steps,
        "targetModules": targets,
        "trainableParameters": int(sum(parameter.numel() for parameter in trainable)),
        "initialTrainableDigest": initial_digest,
        "finalTrainableDigest": final_digest,
        "weightsChanged": True,
        "losses": losses,
        "adapterDigest": checkpoint_digest(adapter_dir),
        "inferenceProof": {
            "state": "inference_verified",
            "outputDigest": sha256_text(completion),
            "outputBytes": len(completion.encode("utf-8")),
            "externalRequest": False,
            "dataLeftDevice": False,
        },
    }


def run_training(args: argparse.Namespace) -> dict[str, Any]:
    run_id = f"closed-ai-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{uuid.uuid4().hex[:8]}"
    run_dir = RUNS_DIR / run_id
    adapter_dir = run_dir / "lora-adapter"
    run_dir.mkdir(parents=True, exist_ok=False)
    acquire_lock(run_id)
    try:
        started_at = utc_now()
        hardware = hardware_profile()
        qlora_status = (
            "eligible"
            if hardware["qloraEligible"]
            else (
                "hardware_blocked_no_cuda"
                if not hardware["cudaAvailable"]
                else "hardware_blocked_insufficient_vram"
            )
        )
        status = update_status(
            runId=run_id,
            modelTraining="started",
            distillation="started",
            lora="started",
            qlora=qlora_status,
            fullWeightTraining="started",
            latestRunStatus="running",
            startedAt=started_at,
            teacherModelId=args.teacher,
            studentModelId=args.student,
        )
        append_ledger(
            "training_started",
            {
                "runId": run_id,
                "teacherModelId": args.teacher,
                "studentModelId": args.student,
                "hardwareDigest": sha256_text(canonical_json(hardware)),
                "operatorAuthorized": True,
                "syntheticDataOnly": True,
            },
        )
    except Exception:
        release_lock()
        raise
    try:
        teacher = teacher_metadata(args.teacher)
        samples, dataset_digest = collect_teacher_demonstrations(teacher, run_dir)
        distillation = {
            "status": "dataset_sealed",
            "method": "sequence_level_knowledge_distillation",
            "teacher": teacher,
            "sampleCount": len(samples),
            "demonstrationHashes": [sample["demonstrationDigest"] for sample in samples],
            "datasetDigest": dataset_digest,
            "rawUserContentIncluded": False,
            "externalPromptRequest": False,
            "dataLeftDevice": False,
        }
        append_ledger(
            "distillation_dataset_sealed",
            {
                "runId": run_id,
                "teacherModelDigest": teacher["modelDigest"],
                "datasetDigest": dataset_digest,
                "sampleCount": len(samples),
            },
        )

        model, tokenizer = load_model_and_tokenizer(args.student)
        student = model_metadata(model, args.student)
        full_weight = run_full_weight_smoke(
            model,
            tokenizer,
            samples[0],
            args.full_weight_steps,
        )
        if not full_weight.weightsChanged:
            raise RuntimeError("FULL_WEIGHT_TRAINING_DID_NOT_CHANGE_WEIGHTS")
        append_ledger(
            "full_weight_step_verified",
            {
                "runId": run_id,
                "studentModelId": args.student,
                "steps": full_weight.steps,
                "initialDigest": full_weight.initialDigest,
                "finalDigest": full_weight.finalDigest,
            },
        )
        del model
        gc.collect()

        model, tokenizer = load_model_and_tokenizer(args.student)
        lora = run_lora_training(
            model,
            tokenizer,
            samples,
            adapter_dir,
            args.lora_steps,
        )
        append_ledger(
            "lora_candidate_created",
            {
                "runId": run_id,
                "adapterDigest": lora["adapterDigest"],
                "steps": lora["steps"],
                "datasetDigest": dataset_digest,
                "inferenceOutputDigest": lora["inferenceProof"]["outputDigest"],
            },
        )

        evidence = {
            "schemaVersion": SCHEMA_VERSION,
            "runId": run_id,
            "startedAt": started_at,
            "completedAt": utc_now(),
            "status": "candidate_ready",
            "modelTraining": "started",
            "distillation": "started",
            "lora": "candidate_ready",
            "qlora": qlora_status,
            "fullWeightTraining": "verified_smoke",
            "hardware": hardware,
            "packages": package_versions(),
            "teacher": teacher,
            "student": student,
            "distillationEvidence": distillation,
            "fullWeightEvidence": asdict(full_weight),
            "loraEvidence": lora,
            "privacy": {
                "syntheticDataOnly": True,
                "rawUserContentIncluded": False,
                "externalPromptRequest": False,
                "dataLeftDeviceDuringTeacherInference": False,
                "adapterActivationRequiresSeparateApproval": True,
            },
            "artifacts": {
                "adapterRuntimeUri": f"runtime://NovelTrainingRuntime/runs/{run_id}/lora-adapter",
                "datasetRuntimeUri": f"runtime://NovelTrainingRuntime/runs/{run_id}/distillation-dataset.jsonl",
                "adapterDigest": lora["adapterDigest"],
                "datasetDigest": dataset_digest,
            },
        }
        evidence["evidenceDigest"] = sha256_text(canonical_json(evidence))
        atomic_json(run_dir / "evidence.json", evidence)
        final_status = update_status(
            **{
                **status,
                "modelTraining": "started",
                "distillation": "started",
                "lora": "candidate_ready",
                "qlora": qlora_status,
                "fullWeightTraining": "verified_smoke",
                "latestRunStatus": "candidate_ready",
                "completedAt": evidence["completedAt"],
                "evidenceDigest": evidence["evidenceDigest"],
                "adapterDigest": lora["adapterDigest"],
                "datasetDigest": dataset_digest,
            }
        )
        append_ledger(
            "training_run_completed",
            {
                "runId": run_id,
                "evidenceDigest": evidence["evidenceDigest"],
                "adapterDigest": lora["adapterDigest"],
                "status": "candidate_ready",
            },
        )
        return {
            "ok": True,
            "runId": run_id,
            "status": final_status,
            "evidence": evidence,
        }
    except Exception as error:
        failed = update_status(
            **{
                **status,
                "latestRunStatus": "failed",
                "failedAt": utc_now(),
                "errorCode": str(error),
            }
        )
        append_ledger(
            "training_failed",
            {
                "runId": run_id,
                "errorDigest": sha256_text(f"{type(error).__name__}:{error}"),
            },
        )
        return {
            "ok": False,
            "runId": run_id,
            "status": failed,
            "errorCode": str(error),
        }
    finally:
        release_lock()


def diagnose() -> dict[str, Any]:
    try:
        teacher = teacher_metadata(DEFAULT_TEACHER)
        ollama = {"reachable": True, "teacher": teacher}
    except RuntimeError as error:
        ollama = {"reachable": False, "errorCode": str(error)}
    return {
        "ok": True,
        "schemaVersion": SCHEMA_VERSION,
        "hardware": hardware_profile(),
        "packages": package_versions(),
        "ollama": ollama,
        "runtimeRoot": str(RUNTIME_ROOT),
        "qloraGate": (
            "eligible"
            if hardware_profile()["qloraEligible"]
            else "hardware_blocked_no_cuda"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Novel Closed AI live LLM training runtime")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("diagnose")
    subparsers.add_parser("status")
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--teacher", default=DEFAULT_TEACHER)
    run_parser.add_argument("--student", default=DEFAULT_STUDENT)
    run_parser.add_argument("--lora-steps", type=int, default=2)
    run_parser.add_argument("--full-weight-steps", type=int, default=1)
    args = parser.parse_args()

    if args.command == "diagnose":
        result = diagnose()
    elif args.command == "status":
        result = read_json(
            STATUS_PATH,
            {
                "schemaVersion": SCHEMA_VERSION,
                "modelTraining": "not_started",
                "distillation": "not_started",
                "lora": "not_started",
                "qlora": "not_started",
                "fullWeightTraining": "not_started",
                "latestRunStatus": "idle",
            },
        )
    else:
        if args.lora_steps < 1 or args.full_weight_steps < 1:
            result = {"ok": False, "errorCode": "TRAINING_STEPS_INVALID"}
        else:
            result = run_training(args)

    sanitized = json.loads(json.dumps(result, ensure_ascii=False))
    if args.command == "run" and sanitized.get("evidence"):
        sanitized["evidence"]["distillationEvidence"].pop("demonstrationHashes", None)
    print(json.dumps(sanitized, ensure_ascii=False, indent=2))
    return 0 if result.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())
