# 本機 AI 常見問題

## Bridge 未啟動

執行 `pnpm local-ai start`，再回 Studio 按「重新檢查」。若仍失敗，執行 `pnpm local-ai diagnose`。

## Port 3217 已被占用

先確認是否已有 Bridge：`pnpm local-ai status`。若不是 Bridge，關閉占用該 port 的程式後再試。本工具不會自動結束未知程序。

## Ollama 未啟動

開啟 Ollama 應用程式，再執行 `pnpm local-ai status`。Bridge 可保持啟動，但在 Ollama 恢復前不會標示可生成。

## 沒有模型或模型被移除

執行 `ollama list`。Studio 只列出 Ollama 實際回報、可生成文字的模型。請自行安裝模型或選擇仍存在的模型；本工具不會自動下載。

## 配對過期或撤銷

回到 Studio 重新按「開始安全配對」，再執行 `pnpm local-ai pair` 取得新的六位數配對碼。不要重用舊碼。

## Studio 與 Bridge 版本不相容

更新較舊的一方，停止 Bridge 後重新啟動，再重新整理 Studio。不要用開發者工具修改協定或配對狀態。

## 生成逾時

縮短輸入、提高 Studio 的執行上限，再按「重新嘗試」。逾時後 Bridge 會中止該工作，不會偷偷改用外部 AI。

## 模型載入失敗或記憶體不足

先關閉其他占用大量記憶體的程式，確認模型容量適合這台電腦，再重啟 Ollama。錯誤不會清除作品。

## 設定檔損壞或無法寫入

停止 Bridge，確認 `%LOCALAPPDATA%\NovelLocalBridge` 可寫入。設定檔損壞時可移除該資料夾後重新啟動；此操作不會刪除小說作品。

## Windows 防火牆提示

Bridge 只監聽 loopback，不需要開放公用或私人網路。不要為它新增入站規則。若 Ollama 自己顯示提示，仍應維持只供本機使用。
