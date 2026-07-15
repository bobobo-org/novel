import { OllamaClient } from "./ollama-client";
import { chooseDefaultOllamaModel, profilesFromTags } from "./ollama-model-registry";

export async function checkOllamaHealth(endpoint?: string) {
  const started = Date.now();
  try {
    const client = new OllamaClient({ endpoint, timeoutMs: 2_000 });
    const [tagsResult, versionResult] = await Promise.allSettled([client.tags(), client.version()]);
    if (tagsResult.status === "rejected") throw tagsResult.reason;
    const tags = tagsResult.value;
    const version = versionResult.status === "fulfilled" ? versionResult.value.version : undefined;
    const profiles = profilesFromTags(tags.models ?? []);
    const selected = chooseDefaultOllamaModel(profiles);
    return {
      status: profiles.length > 0 ? "configured" as const : "model_not_installed" as const,
      runtimeStatus: "running" as const,
      latencyMs: Date.now() - started,
      version,
      modelCount: profiles.length,
      selectedModel: selected?.modelId,
      profiles,
      lastErrorCode: null,
    };
  } catch (error) {
    const lastErrorCode = error instanceof Error ? error.name : "OLLAMA_UNKNOWN_ERROR";
    return {
      status: lastErrorCode === "OllamaSecurityError" ? "unavailable" as const : "runtime_not_installed" as const,
      runtimeStatus: "not_reachable" as const,
      latencyMs: Date.now() - started,
      version: undefined,
      modelCount: 0,
      selectedModel: undefined,
      profiles: [],
      lastErrorCode,
    };
  }
}
