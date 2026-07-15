import type { EmbeddingProvider } from "./embedding-provider";
import type { EmbeddingProviderId } from "./embedding-types";

const providers = new Map<EmbeddingProviderId, EmbeddingProvider>();

export function registerEmbeddingProvider(provider: EmbeddingProvider) {
  providers.set(provider.id, provider);
}

export function getEmbeddingProvider(id: EmbeddingProviderId) {
  return providers.get(id);
}

export function listEmbeddingProviders() {
  return Array.from(providers.values());
}

export function resetEmbeddingProviderRegistryForTests() {
  providers.clear();
}
