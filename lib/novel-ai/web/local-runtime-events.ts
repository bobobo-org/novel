export type WebRuntimeEventType =
  | "start"
  | "progress"
  | "token"
  | "warning"
  | "structured_result"
  | "candidate_persisted"
  | "completed"
  | "cancelled"
  | "error";

export type WebRuntimeEvent = {
  type: WebRuntimeEventType;
  at: string;
  createdAt: string;
  taskId?: string;
  message?: string;
  payload?: unknown;
};

export function runtimeEvent(type: WebRuntimeEventType, input: Omit<WebRuntimeEvent, "type" | "at" | "createdAt"> = {}): WebRuntimeEvent {
  const createdAt = new Date().toISOString();
  return { type, at: createdAt, createdAt, ...input };
}

export function workflowSteps() {
  return [
    "分析任務",
    "讀取作品",
    "載入人物",
    "檢索章節",
    "檢查時間線",
    "讀取伏筆",
    "建立章節規劃",
    "生成初稿",
    "品質評估",
    "一致性檢查",
    "局部重寫",
    "更新記憶",
  ];
}
