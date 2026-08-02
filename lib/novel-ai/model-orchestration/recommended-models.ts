/**
 * Defaults are preferences, never download mandates. Runtime selection always
 * falls back to an installed, verified text model on the current device.
 */
export const FAST_LOCAL_WRITER_MODEL = "qwen2.5:3b" as const;
export const RECOMMENDED_LOCAL_WRITER_MODEL = "qwen2.5:7b" as const;
export const QUALITY_PRIVATE_WRITER_MODEL = "qwen2.5:14b" as const;

export const LOCAL_MODEL_INSTALL_CHOICES = [
  {
    modelId: FAST_LOCAL_WRITER_MODEL,
    label: "快速 3B",
    minimumRamGB: 8,
    useCase: "摘要、短對話、分類與低延遲草稿",
  },
  {
    modelId: RECOMMENDED_LOCAL_WRITER_MODEL,
    label: "平衡 7B（建議）",
    minimumRamGB: 16,
    useCase: "一般續寫、改寫、角色對話與章節檢查",
  },
  {
    modelId: QUALITY_PRIVATE_WRITER_MODEL,
    label: "品質 14B",
    minimumRamGB: 32,
    useCase: "長篇修訂與較深推理；優先放在 Private Hub",
  },
] as const;
