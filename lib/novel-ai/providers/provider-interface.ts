import type { AiProviderCapabilities } from "./provider-capabilities";
import type { AiProviderHealth } from "./provider-health";
import type { AiProviderResult } from "./provider-result";
import type { AiProviderRequest } from "./provider-types";

export interface NovelAiProvider {
  readonly id: AiProviderCapabilities["provider"];
  analyzeStory(request: AiProviderRequest): Promise<AiProviderResult>;
  extractStoryBible(request: AiProviderRequest): Promise<AiProviderResult>;
  summarizeChapter(request: AiProviderRequest): Promise<AiProviderResult>;
  checkConsistency(request: AiProviderRequest): Promise<AiProviderResult>;
  continueWriting(request: AiProviderRequest): Promise<AiProviderResult>;
  rewriteText(request: AiProviderRequest): Promise<AiProviderResult>;
  brainstormPlot(request: AiProviderRequest): Promise<AiProviderResult>;
  classifyTask(request: AiProviderRequest): Promise<AiProviderResult>;
  ping(): Promise<AiProviderHealth>;
  getCapabilities(): Promise<AiProviderCapabilities>;
  estimateContext(request: AiProviderRequest): Promise<{ estimatedTokens: number; maxContextTokens: number; fits: boolean }>;
  cancel(requestId: string): Promise<boolean>;
}
