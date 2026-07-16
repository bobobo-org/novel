import type { IdentityLayer } from "./viral-story-types";
export function buildIdentityKnowledgeMap(layer: IdentityLayer) {
  return { whoKnowsWhat: layer.whoKnowsWhat, whoBelievesWhat: layer.whoBelievesWhat, whoIsLying: layer.whoIsLying };
}
