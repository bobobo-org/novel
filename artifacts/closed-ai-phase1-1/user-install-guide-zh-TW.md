# 本機 AI 使用指南

## Ollama 是什麼

Ollama 是在你的 Windows 電腦上執行文字模型的程式。小說內容會由本機橋接服務送到本機 Ollama，不需要送到外部 AI。

## 使用前確認

1. 在 PowerShell 執行 `ollama --version`，確認 Ollama 已安裝。
2. 執行 `ollama list`，確認已有可生成文字的模型。本次驗收使用 `qwen2.5:3b`。
3. 本工具不會替你安裝 Ollama，也不會自動下載模型。

## 啟動與配對

1. 在專案目錄執行 `pnpm local-ai start`。
2. 執行 `pnpm local-ai status`，確認 Bridge 已啟動、Ollama 可用。
3. 開啟 Studio 的「AI 使用方式」，按「開始安全配對」。
4. 回到 PowerShell 執行 `pnpm local-ai pair`。
5. 將畫面上的六位數一次性配對碼輸入 Studio，按「確認配對」。
6. 從 Studio 的下拉選單選擇已安裝模型。

配對碼不是授權 token；它只能使用一次且很快過期。真正的授權只留在目前頁面的記憶體中，不會寫入網址或瀏覽器儲存空間。重新整理後需重新配對。

## 停止、重啟與撤銷

- 查看狀態：`pnpm local-ai status`
- 停止 Bridge：`pnpm local-ai stop`
- 重啟 Bridge：`pnpm local-ai restart`
- 撤銷所有舊配對：`pnpm local-ai revoke`
- 診斷：`pnpm local-ai diagnose`

停止 Bridge 不會停止你的 Ollama。重啟或撤銷會建立新的 Bridge instance，舊授權立即失效。

## 移除與清除

1. 先執行 `pnpm local-ai stop`。
2. 若要清除 Launcher 狀態，可刪除 `%LOCALAPPDATA%\NovelLocalBridge`。
3. Studio 只保存非敏感的模型名稱與隱私偏好；不保存配對 token、提示詞或模型輸出。

## 確認沒有對外開放

執行 `pnpm local-ai diagnose`，確認：

- Bridge endpoint 是 `127.0.0.1:3217`
- Ollama endpoint 是 `127.0.0.1:11434`
- `nonLoopbackListening` 為 `false`
- `firewallModified` 為 `false`

請不要自行把 Bridge 改成 `0.0.0.0`、區域網路 IP 或公網位址。
