import { inferOllamaModelProfile, type OllamaModelProfile } from "./ollama-capabilities";

export function profilesFromTags(tags: Array<{ name?: string; model?: string }>): OllamaModelProfile[] {
  return tags.map((tag) => inferOllamaModelProfile(tag.model || tag.name || "unknown")).filter((profile) => profile.modelId !== "unknown");
}

export function chooseDefaultOllamaModel(profiles: OllamaModelProfile[]) {
  const preferred = ["qwen3", "qwen2.5", "llama3.2", "llama3.1", "mistral", "gemma", "deepseek"];
  return profiles.find((profile) => preferred.some((item) => profile.modelId.toLowerCase().includes(item))) ?? profiles[0];
}
