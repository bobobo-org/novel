import type { ClosedAITaskComplexity } from "../closed-agent-os";
import type { LocalTextModel } from "../providers/local-ollama/local-bridge-client";

export const CLOSED_AI_MODEL_TIER_SCHEMA_VERSION =
  "closed-ai-model-tier-v1" as const;

export type ClosedAIModelTier = "FAST" | "BALANCED" | "QUALITY" | "HEAVY";

export type ClosedAIModelTierProfile = {
  schemaVersion: typeof CLOSED_AI_MODEL_TIER_SCHEMA_VERSION;
  tier: ClosedAIModelTier;
  role:
    | "FAST_LOCAL_BASELINE"
    | "BALANCED_LOCAL"
    | "QUALITY_LOCAL_OR_PRIVATE"
    | "HEAVY_PRIVATE";
  suitableFor: string[];
  limitations: string[];
  estimatedParametersB: number | null;
  contextLength: number | null;
  taskFit: Record<ClosedAITaskComplexity, "recommended" | "allowed" | "blocked">;
};

function parameterBillions(model: LocalTextModel) {
  const source = [
    model.parameterSize?.value,
    model.family?.value,
    model.modelId,
  ].filter(Boolean).join(" ");
  const billion = source.match(/(\d+(?:\.\d+)?)\s*[bB]\b/);
  if (billion) return Number(billion[1]);
  const million = source.match(/(\d+(?:\.\d+)?)\s*[mM]\b/);
  return million ? Number(million[1]) / 1_000 : null;
}

export function classifyClosedAIModelTier(
  model: LocalTextModel,
): ClosedAIModelTierProfile {
  const parameters = parameterBillions(model);
  const contextLength = Number(model.contextLength?.value ?? 0) || null;
  const normalizedId = model.modelId.toLowerCase();
  const qwenThreeB = normalizedId.includes("qwen2.5:3b")
    || (normalizedId.includes("qwen") && parameters !== null && parameters <= 3.5);
  const tier: ClosedAIModelTier = parameters === null
    ? contextLength && contextLength >= 65_536
      ? "QUALITY"
      : "BALANCED"
    : parameters <= 4
      ? "FAST"
      : parameters <= 9
        ? "BALANCED"
        : parameters <= 34
          ? "QUALITY"
          : "HEAVY";
  if (tier === "FAST") {
    return {
      schemaVersion: CLOSED_AI_MODEL_TIER_SCHEMA_VERSION,
      tier,
      role: "FAST_LOCAL_BASELINE",
      suitableFor: [
        "摘要",
        "分類",
        "名稱與情緒抽取",
        "A/B/C 短選項",
        "短場景與對話草稿",
      ],
      limitations: qwenThreeB
        ? [
          "qwen2.5:3b 是快速本機基線，不是大型長篇品質模型",
          "不建議直接生成 800–1500 字以上長章",
          "不適合高難度推理、長篇一致性或重型 Story Bible 工作",
        ]
        : [
          "小型模型不適合長篇一致性與高難度推理",
          "長內容應由更高階本機模型或 Private Hub 執行",
        ],
      estimatedParametersB: parameters,
      contextLength,
      taskFit: {
        light: "recommended",
        standard: "allowed",
        heavy: "blocked",
      },
    };
  }
  if (tier === "BALANCED") {
    return {
      schemaVersion: CLOSED_AI_MODEL_TIER_SCHEMA_VERSION,
      tier,
      role: "BALANCED_LOCAL",
      suitableFor: ["一般續寫", "改寫", "角色對話", "章節檢查"],
      limitations: ["重型多代理與大型 Story Bible 工作仍建議 Private Hub"],
      estimatedParametersB: parameters,
      contextLength,
      taskFit: {
        light: "allowed",
        standard: "recommended",
        heavy: "blocked",
      },
    };
  }
  if (tier === "QUALITY") {
    return {
      schemaVersion: CLOSED_AI_MODEL_TIER_SCHEMA_VERSION,
      tier,
      role: "QUALITY_LOCAL_OR_PRIVATE",
      suitableFor: ["長篇續寫", "深度改寫", "一致性審查", "多階段 Critic"],
      limitations: ["是否能處理重型任務仍取決於記憶體、上下文與實測"],
      estimatedParametersB: parameters,
      contextLength,
      taskFit: {
        light: "allowed",
        standard: "recommended",
        heavy: "allowed",
      },
    };
  }
  return {
    schemaVersion: CLOSED_AI_MODEL_TIER_SCHEMA_VERSION,
    tier,
    role: "HEAVY_PRIVATE",
    suitableFor: [
      "長上下文",
      "多角色代理模擬",
      "Private Arc",
      "大型 Story Bible",
      "深度評估與修訂",
    ],
    limitations: ["需要較高 RAM／VRAM；應在 Private Hub 完成真實負載驗證"],
    estimatedParametersB: parameters,
    contextLength,
    taskFit: {
      light: "allowed",
      standard: "allowed",
      heavy: "recommended",
    },
  };
}

export function modelTierLabel(model: LocalTextModel) {
  const profile = classifyClosedAIModelTier(model);
  return `${profile.tier} · ${profile.role}`;
}
