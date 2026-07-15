import type { AiProviderId, AiTaskType } from "./provider-types";

export type AiProviderResult = {
  provider: AiProviderId;
  model: string;
  modelVersion?: string;
  taskType: AiTaskType;
  content: string;
  structuredOutput?: unknown;
  finishReason: "stop" | "length" | "cancelled" | "error";
  promptTokens?: number;
  estimatedInputTokens?: number;
  outputTokens?: number;
  estimatedOutputTokens?: number;
  latencyMs: number;
  dataLeftDevice: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
  warnings: string[];
  requestId: string;
  traceId: string;
};
