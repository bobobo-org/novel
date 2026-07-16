import type { IdentityLayer } from "./viral-story-types";
export function detectIdentityOverload(layer: IdentityLayer) {
  return layer.secretIdentities.length > 3 || layer.revealOrder.length > 5;
}
