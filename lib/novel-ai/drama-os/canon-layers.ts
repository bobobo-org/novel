export const CANONICAL_LAYERS = [
  "CREATION_DNA",
  "STORY_BLUEPRINT",
  "STORY_BIBLE",
  "NOVEL_CANON",
  "DRAMA_ADAPTATION_CANON",
  "PRIVATE_SIMULATION",
] as const;

export type CanonicalLayer = typeof CANONICAL_LAYERS[number];

export const DRAMA_OS_WRITABLE_LAYERS: readonly CanonicalLayer[] = [
  "DRAMA_ADAPTATION_CANON",
];

export function isDramaOsCanonicalImpactAllowed(
  canonicalImpact: readonly CanonicalLayer[],
  approved: boolean,
): boolean {
  if (!approved) return canonicalImpact.length === 0;
  return canonicalImpact.every((layer) => DRAMA_OS_WRITABLE_LAYERS.includes(layer));
}

export function canPrivateSimulationWriteCanonicalLayer(target: CanonicalLayer): false {
  void target;
  return false;
}
