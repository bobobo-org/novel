from __future__ import annotations

import json
import os
import platform
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

try:
    import psutil  # type: ignore
except Exception:  # pragma: no cover
    psutil = None

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parents[1]
DATASETS = ROOT / "datasets"
ADAPTERS = ROOT / "adapters"
LOGS = ROOT / "logs"
MODELS = ROOT / "models"
for folder in (DATASETS, ADAPTERS, LOGS, MODELS):
    folder.mkdir(parents=True, exist_ok=True)

STATUS_FILE = LOGS / "training-status.json"
LOG_FILE = LOGS / "training.log"

app = FastAPI(title="Novel Local AI Training Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DatasetRequest(BaseModel):
    samples: List[Dict[str, Any]] = Field(default_factory=list)


class TrainingRequest(BaseModel):
    base_model: str = ""
    dataset_path: str = ""
    method: str = "lora"
    max_steps: int = 100
    learning_rate: float = 2e-4
    allow_cpu: bool = False


class AdapterRequest(BaseModel):
    adapter_id: str = ""
    prompt: str = ""


def now() -> float:
    return time.time()


def write_log(message: str) -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as fh:
        fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")


def read_status() -> Dict[str, Any]:
    if STATUS_FILE.exists():
        return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    return {
        "status": "idle",
        "epoch": 0,
        "step": 0,
        "loss": None,
        "learning_rate": None,
        "vram": None,
        "started_at": None,
        "updated_at": now(),
        "message": "尚未開始訓練",
    }


def save_status(status: Dict[str, Any]) -> Dict[str, Any]:
    status["updated_at"] = now()
    STATUS_FILE.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    return status


def detect_torch() -> Dict[str, Any]:
    try:
        import torch  # type: ignore

        cuda_available = bool(torch.cuda.is_available())
        gpu_name = torch.cuda.get_device_name(0) if cuda_available else ""
        vram = None
        if cuda_available:
            props = torch.cuda.get_device_properties(0)
            vram = round(props.total_memory / (1024 ** 3), 2)
        return {
            "installed": True,
            "version": getattr(torch, "__version__", ""),
            "cuda_available": cuda_available,
            "gpu_name": gpu_name,
            "vram_gb": vram,
        }
    except Exception as exc:
        return {
            "installed": False,
            "version": "",
            "cuda_available": False,
            "gpu_name": "",
            "vram_gb": None,
            "error": str(exc),
        }


def hardware_info() -> Dict[str, Any]:
    disk = shutil.disk_usage(str(ROOT))
    memory_gb = None
    if psutil:
      memory_gb = round(psutil.virtual_memory().total / (1024 ** 3), 2)
    torch_info = detect_torch()
    can_train = bool(torch_info["installed"] and torch_info["cuda_available"] and (torch_info.get("vram_gb") or 0) >= 8)
    recommendation = "可以嘗試 QLoRA" if can_train else "硬體或套件不足，建議只使用作品記憶與偏好學習；禁止直接開始 LoRA 訓練"
    return {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "cpu": platform.processor() or platform.machine(),
        "ram_gb": memory_gb,
        "disk_free_gb": round(disk.free / (1024 ** 3), 2),
        "torch": torch_info,
        "can_train_lora": can_train,
        "recommendation": recommendation,
    }


def validate_samples(samples: List[Dict[str, Any]]) -> Dict[str, Any]:
    issues: List[Dict[str, Any]] = []
    usable_sft = 0
    usable_preference = 0
    approved = 0
    for index, sample in enumerate(samples):
        if sample.get("approvedForTraining"):
            approved += 1
        if sample.get("instruction") and sample.get("output"):
            usable_sft += 1
        elif sample.get("prompt") and sample.get("chosen") and sample.get("rejected"):
            usable_preference += 1
        else:
            issues.append({"index": index, "severity": "medium", "message": "樣本缺少 SFT 或偏好資料欄位"})
    return {
        "passed": not issues,
        "total": len(samples),
        "usable_sft": usable_sft,
        "usable_preference": usable_preference,
        "approved": approved,
        "issues": issues,
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "service": "novel-local-ai-training", "version": app.version, "time": now()}


@app.get("/hardware")
def hardware() -> Dict[str, Any]:
    return hardware_info()


@app.get("/models")
def models() -> Dict[str, Any]:
    found = [{"id": p.name, "path": str(p)} for p in MODELS.iterdir()] if MODELS.exists() else []
    return {"models": found, "models_dir": str(MODELS)}


@app.get("/training/status")
def training_status() -> Dict[str, Any]:
    return read_status()


@app.get("/training/logs")
def training_logs() -> Dict[str, Any]:
    text = LOG_FILE.read_text(encoding="utf-8") if LOG_FILE.exists() else ""
    return {"logs": text.splitlines()[-300:]}


@app.get("/adapters")
def adapters() -> Dict[str, Any]:
    found = [{"id": p.name, "path": str(p), "active": (p / "ACTIVE").exists()} for p in ADAPTERS.iterdir() if p.is_dir()]
    return {"adapters": found, "adapters_dir": str(ADAPTERS)}


@app.post("/dataset/validate")
def dataset_validate(payload: DatasetRequest) -> Dict[str, Any]:
    return validate_samples(payload.samples)


@app.post("/dataset/build")
def dataset_build(payload: DatasetRequest) -> Dict[str, Any]:
    report = validate_samples(payload.samples)
    dataset_id = f"dataset-{int(now())}-{uuid.uuid4().hex[:8]}"
    path = DATASETS / f"{dataset_id}.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for sample in payload.samples:
            if sample.get("approvedForTraining"):
                fh.write(json.dumps(sample, ensure_ascii=False) + "\n")
    write_log(f"dataset built {path}")
    return {"dataset_id": dataset_id, "path": str(path), **report}


@app.post("/training/start")
def training_start(payload: TrainingRequest) -> Dict[str, Any]:
    hw = hardware_info()
    if not payload.base_model:
        raise HTTPException(status_code=400, detail="尚未指定基礎模型。")
    if not payload.dataset_path:
        raise HTTPException(status_code=400, detail="尚未指定資料集。")
    if not Path(payload.dataset_path).exists():
        raise HTTPException(status_code=400, detail="資料集路徑不存在。")
    if not hw["can_train_lora"] and not payload.allow_cpu:
        save_status({
            "status": "blocked",
            "epoch": 0,
            "step": 0,
            "loss": None,
            "learning_rate": payload.learning_rate,
            "vram": hw["torch"].get("vram_gb"),
            "started_at": None,
            "message": hw["recommendation"],
        })
        raise HTTPException(status_code=409, detail=hw["recommendation"])
    status = save_status({
        "status": "queued",
        "epoch": 0,
        "step": 0,
        "loss": None,
        "learning_rate": payload.learning_rate,
        "vram": hw["torch"].get("vram_gb"),
        "started_at": now(),
        "message": "訓練任務已建立。此服務目前只負責安全排程與硬體檢查；實際 Trainer 接入留待第四階段。",
    })
    write_log(f"training queued base_model={payload.base_model} dataset={payload.dataset_path} method={payload.method}")
    return status


@app.post("/training/stop")
def training_stop() -> Dict[str, Any]:
    status = read_status()
    status["status"] = "stopped"
    status["message"] = "已要求停止訓練。"
    write_log("training stopped")
    return save_status(status)


@app.post("/adapters/test")
def adapters_test(payload: AdapterRequest) -> Dict[str, Any]:
    if not payload.adapter_id:
        raise HTTPException(status_code=400, detail="尚未指定 Adapter。")
    return {"ok": False, "message": "Adapter 推理測試需要第四階段模型載入器；目前未啟用。", "adapter_id": payload.adapter_id}


@app.post("/adapters/activate")
def adapters_activate(payload: AdapterRequest) -> Dict[str, Any]:
    target = ADAPTERS / payload.adapter_id
    if not payload.adapter_id or not target.exists():
        raise HTTPException(status_code=404, detail="找不到 Adapter。")
    for flag in ADAPTERS.glob("*/ACTIVE"):
        flag.unlink(missing_ok=True)
    (target / "ACTIVE").write_text(str(now()), encoding="utf-8")
    return {"ok": True, "active": payload.adapter_id}


@app.post("/adapters/delete")
def adapters_delete(payload: AdapterRequest) -> Dict[str, Any]:
    target = ADAPTERS / payload.adapter_id
    if not payload.adapter_id or not target.exists():
        raise HTTPException(status_code=404, detail="找不到 Adapter。")
    shutil.rmtree(target)
    return {"ok": True, "deleted": payload.adapter_id}
