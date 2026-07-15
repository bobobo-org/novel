import { TASK_POLICIES, providerSupports, type AiProviderCapabilities } from "../providers/provider-capabilities";
import { AiProviderError } from "../providers/provider-errors";
import type { AiProviderId } from "../providers/provider-types";
import { buildContextPlan } from "./context-budget";
import type { AiRouterDecision } from "./router-decision";
import type { AiRouterInput } from "./router-policy";
import { effectivePrivacyMode, externalAllowed } from "./privacy-policy";

const EXTERNAL_PROVIDERS = new Set<AiProviderId>(["google-gemini", "openai", "grok"]);

function timeoutFor(timeoutClass: string) {
  if (timeoutClass === "short") return 8_000;
  if (timeoutClass === "medium") return 20_000;
  return 45_000;
}

function orderedProviders(input: AiRouterInput, policyOrder: AiProviderId[]) {
  const preferred = input.providerPreference?.filter((item): item is AiProviderId => policyOrder.includes(item as AiProviderId)) ?? [];
  return Array.from(new Set([...preferred, ...policyOrder]));
}

export function decideAiProvider(input: AiRouterInput): AiRouterDecision {
  const policy = TASK_POLICIES[input.taskType];
  if (!policy) throw new AiProviderError("AI_PROVIDER_CONFIGURATION_INVALID", `Unsupported task type: ${input.taskType}`);
  const privacyMode = effectivePrivacyMode({
    storageMode: input.storageMode,
    requestedPrivacyMode: input.requestedPrivacyMode,
    fullOfflineRequired: input.fullOfflineRequired,
  });
  const mayUseExternal = externalAllowed(privacyMode, input.allowExternalProvider) && policy.externalProviderAllowed && input.internetAvailable !== false;
  const contextPlan = buildContextPlan({
    chapterCharacters: input.contextCharacters?.chapter ?? 0,
    recentContextCharacters: input.contextCharacters?.recent ?? 0,
    storyBibleCharacters: input.contextCharacters?.storyBible ?? 0,
    sourceExcerptCharacters: input.contextCharacters?.sourceExcerpts ?? 0,
    promptOverheadTokens: 450,
    expectedOutputTokens: policy.structuredOutputRequired ? 900 : 1400,
    modelContextWindow: Math.max(...input.availableProviders.map((p) => p.maxContextTokens), 4096),
  });
  const candidates = orderedProviders(input, policy.preferredProviderOrder);
  const providers = new Map(input.availableProviders.map((p) => [p.provider, p]));
  const warnings: string[] = [];
  const fallbackChain: AiProviderId[] = [];

  for (const id of candidates) {
    const capabilities = providers.get(id);
    if (!capabilities) continue;
    if (EXTERNAL_PROVIDERS.has(id) && !mayUseExternal) {
      warnings.push(`${id} blocked by ${privacyMode} privacy policy`);
      continue;
    }
    if (capabilities.status !== "ready" && capabilities.status !== "configured") {
      warnings.push(`${id} unavailable: ${capabilities.status}`);
      continue;
    }
    if (!providerSupports(capabilities, policy.requiredCapabilities)) {
      warnings.push(`${id} missing capabilities`);
      continue;
    }
    if (contextPlan.estimatedTokens > capabilities.maxContextTokens) {
      warnings.push(`${id} context too large`);
      continue;
    }
    fallbackChain.push(id);
  }

  const selectedProvider = fallbackChain[0];
  if (!selectedProvider) {
    const code = privacyMode === "local_only" ? "AI_LOCAL_PROVIDER_REQUIRED" : "AI_NO_ALLOWED_PROVIDER";
    throw new AiProviderError(code, "No allowed AI provider can satisfy this task", { retryable: false, stage: "router" });
  }
  const selected = providers.get(selectedProvider);
  return {
    selectedProvider,
    selectedModel: selected?.models[0],
    orderedFallbackChain: privacyMode === "local_only" ? fallbackChain.filter((p) => !EXTERNAL_PROVIDERS.has(p)) : fallbackChain,
    decisionReason: `${selectedProvider} selected for ${input.taskType} under ${privacyMode}`,
    dataMayLeaveDevice: EXTERNAL_PROVIDERS.has(selectedProvider),
    consentRequired: EXTERNAL_PROVIDERS.has(selectedProvider) && input.allowExternalProvider !== true,
    contextPlan,
    timeoutPlan: { timeoutMs: timeoutFor(policy.timeoutClass), timeoutClass: policy.timeoutClass },
    warnings,
    privacyMode,
  };
}

export function fallbackAudit(input: {
  originalProvider: AiProviderId;
  fallbackProvider: AiProviderId;
  failureCode: string;
  userPolicy: string;
  dataLeftDevice: boolean;
  consentRequired: boolean;
  consentGranted: boolean;
}) {
  return { ...input, silentFallback: false, createdAt: new Date().toISOString() };
}
