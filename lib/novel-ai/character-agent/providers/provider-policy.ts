import type {
  PlatformAIRequest,
  PlatformProviderId,
  PlatformProviderSnapshot,
  PlatformTaskType,
} from "../../router/platform-types";
import { resolvePlatformProvider } from "../../router/platform-router";
import { CharacterAgentError } from "../errors";

export const BROWSER_CHARACTER_TASKS: PlatformTaskType[] = [
  "character.nameExtract",
  "character.traitClassify",
  "character.voiceClassify",
  "character.emotionClassify",
  "character.relationshipEventClassify",
  "character.dialogueConsistency",
];

export const OLLAMA_CHARACTER_TASKS: PlatformTaskType[] = [
  "character.actionPlan",
  "character.dialogue",
  "character.privateArc",
  "character.multiAgentSimulation",
  "character.evaluate",
  "character.relationshipImpact",
];

export type CharacterExternalConsent = {
  consentId: string;
  projectId: string;
  requestId: string;
  providerId: Extract<PlatformProviderId, "openai" | "gemini" | "grok" | "claude">;
  taskType: PlatformTaskType;
  grantedAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export function assertCharacterProviderTask(providerId: PlatformProviderId, taskType: PlatformTaskType) {
  if (providerId === "browser-ai" && !BROWSER_CHARACTER_TASKS.includes(taskType)) {
    throw new CharacterAgentError("BROWSER_CHARACTER_TASK_BLOCKED", "Browser AI 只允許輕量角色抽取、分類與短對話檢查。");
  }
  if (providerId === "private-ai-hub") {
    throw new CharacterAgentError("PRIVATE_HUB_CONTRACT_ONLY", "Private AI Hub 尚未連線。");
  }
  return true;
}
export function resolveCharacterAgentProvider(
  request: PlatformAIRequest,
  providers: PlatformProviderSnapshot[],
) {
  const decision = resolvePlatformProvider(request, providers);
  assertCharacterProviderTask(decision.providerId, request.taskType);
  if (decision.externalRequest && !request.externalConsent) {
    throw new CharacterAgentError("CHARACTER_EXTERNAL_CONSENT_REQUIRED", "外部 AI 需要本次單次明確同意。");
  }
  return decision;
}

export function consumeCharacterExternalConsent(
  consent: CharacterExternalConsent,
  input: { projectId: string; requestId: string; providerId: PlatformProviderId; taskType: PlatformTaskType; now?: string },
) {
  const now = input.now ?? new Date().toISOString();
  if (
    consent.consumedAt
    || consent.projectId !== input.projectId
    || consent.requestId !== input.requestId
    || consent.providerId !== input.providerId
    || consent.taskType !== input.taskType
    || Date.parse(consent.expiresAt) <= Date.parse(now)
  ) {
    throw new CharacterAgentError("CHARACTER_EXTERNAL_CONSENT_INVALID", "外部 AI 單次同意無效、已使用或已過期。");
  }
  return { ...consent, consumedAt: now };
}

export function noSilentExternalFallback(
  fallbackChain: PlatformProviderId[],
  externalConsent: boolean,
) {
  if (!externalConsent && fallbackChain.some((provider) => ["openai", "gemini", "grok", "claude"].includes(provider))) {
    throw new CharacterAgentError("CHARACTER_SILENT_EXTERNAL_FALLBACK_BLOCKED", "未取得單次明確同意，不得切換到外部 AI。");
  }
  return true;
}
