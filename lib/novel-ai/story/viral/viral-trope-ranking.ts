import type { ViralTrope } from "./viral-story-types";
export function rankViralTropes(tropes: ViralTrope[]) {
  return [...tropes].sort((a, b) => (b.noveltyWeight + b.shortDramaSuitability / 20) - (a.noveltyWeight + a.shortDramaSuitability / 20));
}
