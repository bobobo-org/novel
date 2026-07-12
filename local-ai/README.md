# Novel Local AI Service

本目錄提供「諸天萬界小說生成系統」的本機橋接與訓練服務骨架。

目前完成：

- FastAPI 服務
- 硬體檢查
- 訓練資料集 JSONL 建立與驗證
- 訓練狀態、日誌、Adapter 管理端點
- LoRA/QLoRA 啟動前安全檢查

目前尚未完成：

- 真正執行 PyTorch/PEFT LoRA 訓練
- Adapter 推理載入與 A/B 測試

啟動方式：

```powershell
cd "C:\Users\user\OneDrive\文件\New project\novel\local-ai"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn server.main:app --host 127.0.0.1 --port 8765
```

前端預設呼叫：

```text
http://localhost:8765
```
