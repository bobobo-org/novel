import type { AbsurdityProfile } from "./viral-story-types";
export function detectCoincidenceOverload(profile: AbsurdityProfile) {
  return profile.coincidenceAllowance > profile.socialConsequence + 2;
}
