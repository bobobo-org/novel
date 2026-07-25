import { makeRecord } from "../domain/common";
import type { PlatformProviderId } from "../router/platform-types";

const PROVIDER_ACTOR = {
  "browser-ai": "browser-ai",
  "local-ollama": "local-ollama",
  "private-ai-hub": "private-ai-hub",
  "deterministic-local": "local-rule",
  openai: "local-rule",
  gemini: "local-rule",
  grok: "local-rule",
} as const;

export function makeDramaRecord(projectId: string, providerId: PlatformProviderId, requestId: string) {
  const record = makeRecord(projectId, "ai_candidate");
  return {
    ...record,
    provenance: {
      ...record.provenance,
      source: "ai_candidate" as const,
      actor: PROVIDER_ACTOR[providerId],
      requestId,
    },
  };
}
