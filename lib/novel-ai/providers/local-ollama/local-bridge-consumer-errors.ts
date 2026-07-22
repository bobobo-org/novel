const messages: Record<string, string> = {
  BRIDGE_NOT_RUNNING: "本機創作助手尚未啟動。啟動後即可重新嘗試，系統不會改用外部 AI。",
  BRIDGE_PROCESS_UNREACHABLE: "目前無法連接本機創作助手。請確認助手已啟動後重新嘗試。",
  BRIDGE_ORIGIN_NOT_ALLOWED: "目前網站尚未獲准連接本機創作助手。請授權正確網站後重新嘗試。",
  BRIDGE_NOT_PAIRED: "本機創作助手尚未配對。完成配對後即可重新嘗試。",
  BRIDGE_PAIRING_EXPIRED: "本機配對碼已過期，請取得新的配對碼後重新嘗試。",
  BRIDGE_PROTOCOL_INCOMPATIBLE: "Studio 與本機創作助手版本不相容，請更新後重新嘗試。",
  REQUEST_TIMEOUT: "本機創作助手回應逾時。請確認服務狀態後重新嘗試。",
  OLLAMA_INVALID_RESPONSE: "本機 AI 回應格式不正確，結果未被套用，請重新嘗試。",
  OLLAMA_STREAM_INTERRUPTED: "本機 AI 連線在完成前中斷，結果未被套用，請重新嘗試。",
  OLLAMA_MODEL_NOT_FOUND: "選定的本機模型目前不可用，請選擇已安裝的模型後重新嘗試。",
  OLLAMA_TIMEOUT: "本機模型回應逾時，結果未被套用，請稍後重新嘗試。",
  LOCAL_DUPLICATE_REQUEST: "這項工作已送出，系統已阻止重複執行。",
  LOCAL_REQUEST_IDENTITY_MISMATCH: "收到的結果與這次工作不一致，已停止套用，請重新嘗試。",
};

export function getLocalBridgeConsumerMessage(code: string) {
  return messages[code] || "本機 AI 工作沒有完成，正式作品未變更。請重新嘗試。";
}
