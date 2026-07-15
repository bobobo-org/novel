import type { AiTaskType } from "../provider-types";

export type OllamaModelProfile = {
  modelId: string;
  displayName: string;
  family: string;
  parameterSize?: string;
  quantization?: string;
  contextWindow: number;
  supportsJson: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsEmbedding: boolean;
  recommendedTasks: AiTaskType[];
  minimumRamGb?: number;
  recommendedRamGb?: number;
  enabled: boolean;
  installed: boolean;
};

export function inferOllamaModelProfile(modelId: string): OllamaModelProfile {
  const id = modelId.toLowerCase();
  const family = id.includes("qwen") ? "qwen" : id.includes("llama") ? "llama" : id.includes("mistral") ? "mistral" : id.includes("gemma") ? "gemma" : id.includes("deepseek") ? "deepseek" : "unknown";
  const contextWindow = id.includes("qwen3") || id.includes("llama3.2") ? 32768 : 8192;
  return {
    modelId,
    displayName: modelId,
    family,
    contextWindow,
    supportsJson: true,
    supportsTools: false,
    supportsStreaming: true,
    supportsEmbedding: false,
    recommendedTasks: ["simple_summary", "story_bible_extraction", "consistency_check", "continue_writing", "rewrite", "plot_brainstorm"],
    minimumRamGb: id.includes("7b") || id.includes("8b") ? 8 : 4,
    recommendedRamGb: id.includes("7b") || id.includes("8b") ? 16 : 8,
    enabled: true,
    installed: true,
  };
}
