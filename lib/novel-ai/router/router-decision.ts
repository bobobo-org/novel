import type { AiProviderId, AiPrivacyMode } from "../providers/provider-types";
import type { ContextPlan } from "./context-budget";

export type AiRouterDecision = {
  selectedProvider?: AiProviderId;
  selectedModel?: string;
  orderedFallbackChain: AiProviderId[];
  decisionReason: string;
  dataMayLeaveDevice: boolean;
  consentRequired: boolean;
  contextPlan: ContextPlan;
  timeoutPlan: { timeoutMs: number; timeoutClass: string };
  warnings: string[];
  privacyMode: AiPrivacyMode;
};
