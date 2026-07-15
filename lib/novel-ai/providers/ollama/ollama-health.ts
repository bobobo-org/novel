import { OllamaClient } from "./ollama-client";
import { chooseDefaultOllamaModel, profilesFromTags } from "./ollama-model-registry";

export async function checkOllamaHealth(endpoint?: string) {
  const started = Date.now();
  try {
    const client = new OllamaClient({ endpoint, timeoutMs: 2_000 });
    const tags = await client.tags();
    const profiles = profilesFromTags(tags.models ?? []);
    const selected = chooseDefaultOllamaModel(profiles);
    return {
      status: profiles.length > 0 ? "configured" as const : "model_not_installed" as const,
      latencyMs: Date.now() - started,
      modelCount: profiles.length,
      selectedModel: selected?.modelId,
      profiles,
      lastErrorCode: null,
    };
  } catch (error) {
    return {
      status: "unavailable" as const,
      latencyMs: Date.now() - started,
      modelCount: 0,
      selectedModel: undefined,
      profiles: [],
      lastErrorCode: error instanceof Error ? error.name : "OLLAMA_UNKNOWN_ERROR",
    };
  }
}
