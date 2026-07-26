import type { CharacterAgentProfile, CharacterAgentProfileInput, CharacterEvidenceSupport, CharacterSourceReference, SourcedCharacterFact } from "./types";
import { makeCharacterAgentRecord } from "./record-factory";

function reference(
  entityId: string,
  entityType: CharacterSourceReference["entityType"],
  sourceRevision: number,
  excerpt: string,
  support: CharacterEvidenceSupport = "SUPPORTED",
): CharacterSourceReference {
  return {
    referenceId: `${entityType}:${entityId}:${sourceRevision}`,
    entityId,
    entityType,
    sourceRevision,
    excerpt: excerpt.slice(0, 1200),
    support,
  };
}

function unknownStrings(): SourcedCharacterFact<string[]> {
  return { value: null, support: "UNKNOWN", sourceReferences: [], risk: "目前沒有可支持的正式來源；不會補成角色事實。" };
}

function normalizeFact(input: SourcedCharacterFact<string[]> | undefined) {
  if (!input) return unknownStrings();
  if (input.support === "SUPPORTED") return { ...input, value: [...(input.value ?? [])] };
  return {
    ...input,
    value: input.value ? [...input.value] : null,
    risk: input.risk ?? (input.support === "INFERRED" ? "這是推論，不會作為硬限制。" : "來源不足或互相衝突。"),
  };
}

export function buildCharacterAgentProfile(input: CharacterAgentProfileInput): CharacterAgentProfile {
  const record = makeCharacterAgentRecord(input.project.id, "user");
  const characterReference = reference(
    input.character.id,
    "character",
    input.character.revision,
    `${input.character.name}；${input.character.identity.value ?? ""}；${input.character.goal.value ?? ""}`,
  );
  const storyBibleReference = reference(
    input.storyBible.id,
    "story_bible",
    input.storyBible.revision,
    input.storyBible.forbiddenContradictions.join("；"),
  );
  const age = input.age ?? null;
  const ageVerified = Boolean(input.ageVerified && age !== null);
  const adultEnabled = Boolean(input.adultModeEnabled);
  const adultOptedIn = Boolean(input.adultOptedIn);
  const adultEligible = age !== null && age >= 18 && ageVerified && adultEnabled && adultOptedIn;
  const goalFact: SourcedCharacterFact<string[]> = input.character.goal.value
    ? { value: [input.character.goal.value], support: "SUPPORTED", sourceReferences: [characterReference], risk: null }
    : unknownStrings();
  const identity: SourcedCharacterFact<string> = input.character.identity.value
    ? { value: input.character.identity.value, support: "SUPPORTED", sourceReferences: [characterReference], risk: null }
    : { value: null, support: "UNKNOWN", sourceReferences: [], risk: "身分尚未由作者確認。" };
  const profile: CharacterAgentProfile = {
    ...record,
    id: record.id,
    profileId: record.id,
    characterId: input.character.id,
    sourceCharacterRevision: input.character.revision,
    sourceStoryBibleVersion: input.storyBible.revision,
    sourceStoryRevision: input.sourceStoryRevision,
    name: input.character.name,
    aliases: [...input.character.aliases],
    age,
    ageVerified,
    lifeStatus: input.character.lifeStatus,
    identity,
    factionIds: [...(input.factionIds ?? [])],
    personalityTraits: normalizeFact(input.personalityTraits),
    values: normalizeFact(input.values),
    goals: goalFact,
    fears: normalizeFact(input.fears),
    flaws: normalizeFact(input.flaws),
    motives: normalizeFact(input.motives),
    capabilities: normalizeFact(input.capabilities),
    limitations: normalizeFact(input.limitations),
    forbiddenContradictions: [...input.storyBible.forbiddenContradictions],
    voiceProfile: {
      formality: input.voiceProfile?.formality ?? 50,
      sentenceLength: input.voiceProfile?.sentenceLength ?? "mixed",
      vocabularyStyle: [...(input.voiceProfile?.vocabularyStyle ?? [])],
      directness: input.voiceProfile?.directness ?? 50,
      emotionalExpressiveness: input.voiceProfile?.emotionalExpressiveness ?? 50,
      humorStyle: input.voiceProfile?.humorStyle ?? "未設定",
      preferredAddressTerms: [...(input.voiceProfile?.preferredAddressTerms ?? [])],
      avoidedPhrases: [...(input.voiceProfile?.avoidedPhrases ?? [])],
      speechPatterns: [...(input.voiceProfile?.speechPatterns ?? [])],
      dialogueExamples: [...(input.voiceProfile?.dialogueExamples ?? [])],
      sourceReferences: [...(input.voiceProfile?.sourceReferences ?? (input.character.personality.value ? [characterReference] : []))],
    },
    privateBoundaries: [...(input.privateBoundaries ?? [])],
    adultEligibility: {
      isFictional: true,
      ageAtLeast18: age !== null && age >= 18,
      ageVerified,
      adultModeEnabled: adultEnabled,
      optedIn: adultOptedIn,
      namespace: adultEligible ? `adult:${input.project.id}` : "general",
      eligible: adultEligible,
    },
    status: "CURRENT",
  };
  if (profile.forbiddenContradictions.length) {
    profile.identity.sourceReferences = [...profile.identity.sourceReferences];
    void storyBibleReference;
  }
  return profile;
}
