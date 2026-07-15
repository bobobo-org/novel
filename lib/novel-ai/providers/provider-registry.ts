import type { NovelAiProvider } from "./provider-interface";
import type { AiProviderId } from "./provider-types";

const providers = new Map<AiProviderId, NovelAiProvider>();

export function registerAiProvider(provider: NovelAiProvider) {
  providers.set(provider.id, provider);
}

export function getAiProvider(id: AiProviderId) {
  return providers.get(id);
}

export function listAiProviders() {
  return Array.from(providers.values());
}

export function resetAiProviderRegistryForTests() {
  providers.clear();
}
