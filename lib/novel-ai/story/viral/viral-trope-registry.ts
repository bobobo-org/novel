import type { ViralTopicProfile, ViralTrope } from "./viral-story-types";

const categories = ["identity", "reversal", "social", "mystery", "romance", "revenge", "comedy", "power", "family", "business", "fantasy"] as const;
const names = [
  "Hidden heir reveal", "Wrong identity contract", "Public humiliation rebound", "Evidence reversal", "Secret alliance",
  "Fake betrayal", "Double life", "Dramatic inheritance", "Absurd office trial", "Mistaken prophecy",
  "Contract marriage reversal", "Villain self-exposure", "Viral apology trap", "Unreliable witness", "Impossible message",
  "Returned memory", "Swap at the banquet", "Secret mentor", "False confession", "Public vote twist",
  "Family ledger trap", "Business hostage clause", "Magic debt", "System error comedy", "Live broadcast accident",
  "Screenshot proof", "Quote line comeback", "Disguised expert", "Fake defeat", "Alliance flip",
  "Evidence planted twice", "Forbidden rule loophole", "Identity stack collapse", "Romantic misunderstanding", "Villain legal trap",
  "Short drama cold open", "Absurd witness", "Public ranking reversal", "Hidden adult autonomy pact", "Social consequence storm",
];

export const VIRAL_TROPE_REGISTRY: ViralTrope[] = names.map((displayName, index) => {
  const category = categories[index % categories.length];
  const tropeId = `viral_trope_${String(index + 1).padStart(3, "0")}`;
  const compatibleTropes = [`viral_trope_${String(((index + 1) % names.length) + 1).padStart(3, "0")}`, `viral_trope_${String(((index + 7) % names.length) + 1).padStart(3, "0")}`];
  const incompatibleTropes = index % 5 === 0 ? [`viral_trope_${String(((index + 13) % names.length) + 1).padStart(3, "0")}`] : [];
  return {
    tropeId,
    category,
    displayName,
    aliases: [displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), `${category}-trope-${index + 1}`],
    setupRequirements: [`Establish ${displayName} before payoff`, "Attach consequence to the reveal"],
    compatibleTropes,
    incompatibleTropes,
    requiredWorldRules: index % 3 === 0 ? ["Public consequences must remain canonical"] : [],
    requiredCharacterRoles: ["protagonist", index % 2 === 0 ? "opponent" : "ally"],
    revealRequirements: ["At least one clue before reveal", "Reveal must change a relationship or objective"],
    consequenceRequirements: ["No shock without consequence", "Branch outcome must remain isolated"],
    fatigueWeight: (index % 4) + 1,
    absurdityWeight: (index % 5) + 1,
    controversyWeight: (index % 3) + 1,
    noveltyWeight: 5 - (index % 5),
    shortDramaSuitability: 60 + (index % 40),
    adultProfileCompatibility: index % 9 === 0 ? "private" : "general",
    enabled: true,
    version: "h2v-v1",
  };
});

export const VIRAL_CLASSIFICATION_PACKS = [
  "popular_common", "ancient_romance", "urban_power", "suspense_mystery", "fantasy_xianxia", "business_career",
  "school_youth", "family_drama", "short_drama", "black_humor", "adult_private",
];

export const VIRAL_TOPIC_PROFILES: ViralTopicProfile[] = VIRAL_CLASSIFICATION_PACKS.flatMap((classificationPackId, packIndex) =>
  Array.from({ length: classificationPackId === "adult_private" ? 18 : 20 }, (_, topicIndex) => {
    const topicId = `${classificationPackId}_viral_topic_${String(topicIndex + 1).padStart(2, "0")}`;
    const start = (packIndex * 5 + topicIndex) % VIRAL_TROPE_REGISTRY.length;
    const recommendedTropes = [0, 1, 2].map((offset) => VIRAL_TROPE_REGISTRY[(start + offset) % VIRAL_TROPE_REGISTRY.length].tropeId);
    return {
      classificationPackId,
      topicId,
      storyEngineId: "viral_absurd_story_engine",
      compatibleTropes: recommendedTropes.concat(VIRAL_TROPE_REGISTRY[(start + 3) % VIRAL_TROPE_REGISTRY.length].tropeId),
      recommendedTropes,
      excludedTropes: [VIRAL_TROPE_REGISTRY[(start + 13) % VIRAL_TROPE_REGISTRY.length].tropeId],
      defaultAbsurdity: packIndex % 4 === 0 ? "absurd" : packIndex % 3 === 0 ? "melodramatic" : "heightened",
      defaultReversalDepth: topicIndex % 5 === 0 ? "arc" : "chapter",
      defaultHookStyle: topicIndex % 2 === 0 ? "argument-trigger" : "identity-pressure",
      shortDramaSuitability: 65 + ((packIndex + topicIndex) % 30),
      adultProfileCompatibility: classificationPackId === "adult_private" ? "private" : "general",
      fallbackProfile: "general_viral_fallback",
    };
  }),
);

export function getTrope(tropeId: string) {
  return VIRAL_TROPE_REGISTRY.find((trope) => trope.tropeId === tropeId);
}

export function getTopicProfile(classificationPackId?: string, topicId?: string) {
  return VIRAL_TOPIC_PROFILES.find((profile) => profile.classificationPackId === classificationPackId && profile.topicId === topicId)
    ?? VIRAL_TOPIC_PROFILES[0];
}
