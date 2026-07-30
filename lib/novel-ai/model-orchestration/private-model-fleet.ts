import type { LocalTextModel } from "../providers/local-ollama/local-bridge-client";
import type { PlatformTaskType } from "../router/platform-types";

export type PrivateModelRole =
  | "fast-writer"
  | "general-writer"
  | "deep-reasoner"
  | "embedding-memory"
  | "multimodal-reader";

export type PrivateModelScale = "micro" | "small" | "medium" | "large" | "frontier-local";

export type PrivateModelFleetProfile = {
  modelId: string;
  modelDigest: string | null;
  family: string;
  parameterBillions: number | null;
  parameterLabel: string;
  scale: PrivateModelScale;
  contextLength: number | null;
  quantization: string;
  diskSizeBytes: number | null;
  roles: PrivateModelRole[];
  readyForText: boolean;
  score: number;
  reasons: string[];
};

export type PrivateModelFleetRequest = {
  taskType: PlatformTaskType;
  complexity: "light" | "standard" | "heavy";
  preferLatency?: boolean;
};

const ANALYSIS_TASK = /(?:check|analysis|review|critique|evaluate|storyBible|multiAgent|endingPlan)/iu;
const CREATIVE_TASK = /(?:continue|rewrite|expand|dialogue|create|brainstorm|Candidate|outline|episodePlan)/u;

export function parseParameterBillions(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/,/gu, "");
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([BMK])?/u);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (match[2] === "M") return number / 1_000;
  if (match[2] === "K") return number / 1_000_000;
  return number;
}

function scaleForParameters(parameters: number | null): PrivateModelScale {
  if (parameters === null || parameters < 2) return "micro";
  if (parameters < 8) return "small";
  if (parameters < 24) return "medium";
  if (parameters < 70) return "large";
  return "frontier-local";
}

function rolesForModel(model: LocalTextModel, parameters: number | null) {
  const roles = new Set<PrivateModelRole>();
  if (model.capabilities?.embeddings?.value === true) roles.add("embedding-memory");
  if (model.capabilities?.vision?.value === true) roles.add("multimodal-reader");
  if (model.capabilities?.textGeneration?.value === true) {
    if (parameters === null || parameters < 8) roles.add("fast-writer");
    if (parameters === null || parameters >= 3) roles.add("general-writer");
    if ((parameters ?? 0) >= 14) roles.add("deep-reasoner");
  }
  return [...roles];
}

function scoreModel(
  profile: Omit<PrivateModelFleetProfile, "score" | "reasons">,
  request: PrivateModelFleetRequest,
) {
  if (!profile.readyForText) {
    return { score: -1, reasons: ["此模型未回報文字生成能力"] };
  }

  const reasons: string[] = [];
  let score = 35;
  const parameters = profile.parameterBillions ?? 0;
  const context = profile.contextLength ?? 0;
  const analysis = ANALYSIS_TASK.test(request.taskType);
  const creative = CREATIVE_TASK.test(request.taskType);

  if (request.complexity === "light") {
    const latencyFit = parameters === 0 || parameters <= 8;
    score += latencyFit ? 28 : 8;
    reasons.push(latencyFit ? "小型模型適合低延遲輕量工作" : "可執行，但模型規模可能增加等待時間");
  } else if (request.complexity === "standard") {
    const generalFit = parameters === 0 || (parameters >= 3 && parameters <= 32);
    score += generalFit ? 26 : 12;
    reasons.push(generalFit ? "模型規模符合一般創作與編輯工作" : "可執行一般工作");
  } else {
    const reasoningFit = parameters >= 14;
    score += reasoningFit ? 32 : Math.min(16, parameters);
    reasons.push(reasoningFit
      ? "較大參數量適合多階段與重型推理"
      : "目前可執行重型管線，但模型本體仍偏小");
  }

  if (analysis && profile.roles.includes("deep-reasoner")) {
    score += 15;
    reasons.push("已列入深度推理角色");
  }
  if (creative && profile.roles.some((role) => role === "fast-writer" || role === "general-writer")) {
    score += 12;
    reasons.push("適合小說生成與改寫");
  }
  if (context >= 32_768) {
    score += 12;
    reasons.push(`長上下文 ${context.toLocaleString()} tokens`);
  } else if (context >= 8_192) {
    score += 6;
    reasons.push(`上下文 ${context.toLocaleString()} tokens`);
  }
  if (request.preferLatency && parameters > 0 && parameters <= 8) {
    score += 10;
    reasons.push("符合低延遲偏好");
  }
  if (profile.modelDigest) {
    score += 3;
    reasons.push("模型身分具有內容雜湊");
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

export function rankPrivateModels(
  models: LocalTextModel[],
  request: PrivateModelFleetRequest,
): PrivateModelFleetProfile[] {
  return models.map((model) => {
    const parameterLabel = String(model.parameterSize?.value ?? "未回報");
    const parameterBillions = parseParameterBillions(model.parameterSize?.value);
    const base = {
      modelId: model.modelId,
      modelDigest: model.modelDigest ?? null,
      family: String(model.family?.value ?? "unknown"),
      parameterBillions,
      parameterLabel,
      scale: scaleForParameters(parameterBillions),
      contextLength: Number(model.contextLength?.value) || null,
      quantization: String(model.quantization?.value ?? "未回報"),
      diskSizeBytes: Number(model.diskSize?.value) || null,
      roles: rolesForModel(model, parameterBillions),
      readyForText: model.capabilities?.textGeneration?.value === true,
    } satisfies Omit<PrivateModelFleetProfile, "score" | "reasons">;
    return { ...base, ...scoreModel(base, request) };
  }).sort((left, right) =>
    right.score - left.score || left.modelId.localeCompare(right.modelId));
}

export function describePrivateModelRole(role: PrivateModelRole) {
  const labels: Record<PrivateModelRole, string> = {
    "fast-writer": "高速寫作",
    "general-writer": "通用創作",
    "deep-reasoner": "深度推理",
    "embedding-memory": "向量記憶",
    "multimodal-reader": "多模態閱讀",
  };
  return labels[role];
}
