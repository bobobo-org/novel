import { createAdultExperienceProfile } from "../../lib/novel-data/adult-experience-profile.ts";

const evaluatedAt = "2026-08-30T06:00:00.000Z";
const recordedAt = "2026-08-30T05:59:00.000Z";

export const adultRuntimeSafetyAssertions = Object.freeze({
  allParticipantsVerifiedAdults: true,
  activeRevocableConsent: true,
  participantsUnrelatedByBlood: true,
  noCoercion: true,
  noHiddenRecording: true,
  noExploitativePowerExchange: true,
  noRealCatalogCopying: true,
});

export function createAdultNarrativeRuntimeFixture({
  scopeId = "rpg-turn:chapter-1:scene-1:turn-2",
  executionSource = "closed-ai",
} = {}) {
  const projectId = "project-adult-runtime-binding";
  const participantIds = ["character-adult-a", "character-adult-b"];
  return {
    project: {
      id: projectId,
      adultMode: true,
      adultExperienceProfile: {
        ...createAdultExperienceProfile(),
        fictionalAdultsConfirmed: true,
      },
    },
    characters: [
      { id: participantIds[0], name: "林澄", aliases: [], age: 29, ageVerified: true },
      { id: participantIds[1], name: "蘇錦魚", aliases: [], age: 34, ageVerified: true },
      { id: "character-not-in-scene", name: "葉聞雪", aliases: [], age: null, ageVerified: false },
    ],
    participantIds,
    scopeId,
    executionSource,
    consentEvidence: participantIds.map((participantId, index) => ({
      evidenceId: `consent-evidence-${index + 1}`,
      projectId,
      scopeId,
      participantId,
      state: "active",
      revocable: true,
      withdrawalState: "none",
      recordedAt,
      expiresAt: "2026-08-30T07:00:00.000Z",
    })),
    safetyEvidence: {
      evidenceId: "safety-evidence-1",
      projectId,
      scopeId,
      participantIds: [...participantIds],
      recordedAt,
      assertions: { ...adultRuntimeSafetyAssertions },
    },
    request: {
      primaryEngine: "E8_world_heat",
      secondaryEngine: "E2_pretext",
      worldAdapter: "multiverse",
      parameters: {
        intensity: 2,
        consent_mode: "fade_to_black",
        ntr: false,
        climax_as_power: false,
        taboo_proximity: 0,
        aftercare: "required",
      },
      narrativeGoal: "A voluntary private decision changes two worlds' political alignment.",
      irreversibleEvent: "Both councils receive proof of the new alliance.",
      cost: "The pair lose access to their previously neutral refuge.",
    },
    evaluatedAt,
  };
}
