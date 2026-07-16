export const VIRAL_STORY_ENGINE_VERSION = "h2v-viral-absurd-story-engine-v1";
export const VIRAL_STORY_MIGRATION_VERSION = "020_viral_absurd_story_engine";

export type ViralTropeCategory =
  | "identity"
  | "reversal"
  | "social"
  | "mystery"
  | "romance"
  | "revenge"
  | "comedy"
  | "power"
  | "family"
  | "business"
  | "fantasy";

export type AbsurdityMode = "realism" | "heightened" | "melodramatic" | "absurd" | "extreme_absurd";
export type RevealMode = "immediate" | "delayed" | "chapter_end" | "arc_midpoint" | "arc_end" | "volume_end" | "staggered" | "false_then_true" | "partial_then_complete";
export type ReversalLevel = "scene" | "chapter" | "arc" | "volume" | "premise" | "double_reversal" | "false_reversal" | "delayed_reversal" | "identity_reversal" | "motive_reversal" | "alliance_reversal" | "evidence_reversal";
export type ClueType = "hard" | "soft" | "false" | "emotional" | "visual" | "dialogue" | "behavior" | "object" | "timeline";
export type ViralQualitySeverity = "info" | "warning" | "major" | "blocking";

export type ViralTrope = {
  tropeId: string;
  category: ViralTropeCategory;
  displayName: string;
  aliases: string[];
  setupRequirements: string[];
  compatibleTropes: string[];
  incompatibleTropes: string[];
  requiredWorldRules: string[];
  requiredCharacterRoles: string[];
  revealRequirements: string[];
  consequenceRequirements: string[];
  fatigueWeight: number;
  absurdityWeight: number;
  controversyWeight: number;
  noveltyWeight: number;
  shortDramaSuitability: number;
  adultProfileCompatibility: "general" | "private" | "restricted";
  enabled: boolean;
  version: string;
};

export type ViralTopicProfile = {
  classificationPackId: string;
  topicId: string;
  storyEngineId: string;
  compatibleTropes: string[];
  recommendedTropes: string[];
  excludedTropes: string[];
  defaultAbsurdity: AbsurdityMode;
  defaultReversalDepth: ReversalLevel;
  defaultHookStyle: string;
  shortDramaSuitability: number;
  adultProfileCompatibility: "general" | "private" | "restricted";
  fallbackProfile: string;
};

export type TropeMixInput = {
  seed?: string;
  mode?: "seeded" | "random" | "preference" | "topic-aware" | "classification-aware" | "story-engine-aware" | "adult-profile-aware";
  classificationPackId?: string;
  topicId?: string;
  storyEngineId?: string;
  adultProfile?: "general" | "private" | "restricted";
  requiredTropeIds?: string[];
  excludedTropeIds?: string[];
  surpriseMode?: boolean;
  conservativeMode?: boolean;
  extremeMode?: boolean;
  maxTropes?: number;
};

export type TropeMixResult = {
  selectedTropes: ViralTrope[];
  compatibilityStatus: "compatible" | "compatible_with_warnings" | "incompatible";
  requiredWorldRules: string[];
  requiredSetup: string[];
  requiredCharacters: string[];
  requiredRelationships: string[];
  plannedReveals: string[];
  incompatibilities: string[];
  continuityRisks: string[];
  absurdityScore: number;
  noveltyScore: number;
  controversyScore: number;
  shortDramaScore: number;
  recommendationReasons: string[];
};

export type AbsurdityProfile = {
  mode: AbsurdityMode;
  coincidenceAllowance: number;
  identityComplexity: number;
  reversalFrequency: number;
  emotionalAmplification: number;
  socialConsequence: number;
  worldRuleFlexibility: number;
  humorLevel: number;
  seriousnessFloor: number;
  requiredJustifications: string[];
};

export type IdentityLayer = {
  publicIdentity: string;
  believedIdentity: string;
  falseIdentity: string;
  secretIdentities: string[];
  identityEvidence: string[];
  falseEvidence: string[];
  whoKnowsWhat: Record<string, string[]>;
  whoBelievesWhat: Record<string, string>;
  whoIsLying: string[];
  revealConditions: string[];
  revealOrder: string[];
  falseReveal: string;
  partialReveal: string;
  finalTruth: string;
  identityConsequences: string[];
};

export type ReversalPlan = {
  reversalId: string;
  level: ReversalLevel;
  setup: string;
  clueIds: string[];
  misdirection: string;
  trigger: string;
  reveal: string;
  affectedCharacters: string[];
  affectedRelationships: string[];
  affectedFactions: string[];
  consequence: string;
  nextQuestion: string;
  canonicalCandidates: string[];
  unsupportedRisk: string;
  plannedChapter: number;
  earliestAllowedChapter: number;
  latestAllowedChapter: number;
};

export type ReversalClue = {
  clueId: string;
  reversalId: string;
  clueType: ClueType;
  content: string;
  sourceChapter: number;
  visibility: "hidden" | "subtle" | "visible" | "misleading";
  whoNotices: string[];
  whoIgnores: string[];
  interpretation: string;
  falseInterpretation: string;
  revealContribution: number;
  used: boolean;
  resolved: boolean;
};

export type RevealSchedule = {
  mode: RevealMode;
  revealTooEarly: boolean;
  revealTooLate: boolean;
  clueCoverage: number;
  audienceKnowledge: string[];
  characterKnowledge: Record<string, string[]>;
  branchConsistency: "safe" | "warning" | "conflict";
  requiredConsequence: string;
};

export type ViralHookSet = {
  openingHook: string;
  firstSentenceHook: string;
  firstThreeParagraphHook: string;
  chapterOpening: string;
  midpointTurn: string;
  endCliffhanger: string;
  quoteCandidates: string[];
  screenshotMoment: string;
  argumentTrigger: string;
  emotionalPeak: string;
  absurdReveal: string;
  teaserCopy: string;
  shortVideoTitle: string;
  episodeEnding: string;
  nextEpisodeHook: string;
};

export type ShortDramaPlan = {
  episodeCount: 1 | 3 | 5 | 10 | 20;
  segments: Array<{ segmentType: "coldOpen" | "setup" | "conflict" | "escalation" | "turn" | "payoff" | "cliffhanger"; requiredEvent: string; canonicalOutcome: string }>;
  canonicalOutcome: string;
  requiredEvents: string[];
  characterMotivation: string;
  relationshipOutcome: string;
  branchIdentity: string;
};

export type ViralQualityIssue = {
  issueType: string;
  severity: ViralQualitySeverity;
  affectedElements: string[];
  suggestedFixes: string[];
  blocked: boolean;
  retryAllowed: boolean;
};

export type ViralQualityResult = {
  qualityStatus: "pass" | "needs_revision" | "blocked";
  issues: ViralQualityIssue[];
  score: number;
  externalRequestCount: number;
  dataLeftDevice: boolean;
};

export type ViralStoryPlan = {
  planId: string;
  projectId: string;
  branchId: string;
  title: string;
  tropeMix: TropeMixResult;
  absurdityProfile: AbsurdityProfile;
  identityLayer: IdentityLayer;
  reversalPlans: ReversalPlan[];
  clues: ReversalClue[];
  revealSchedule: RevealSchedule;
  hooks: ViralHookSet;
  cliffhangers: string[];
  quoteMoments: string[];
  screenshotMoments: string[];
  shortDrama: ShortDramaPlan;
  quality: ViralQualityResult;
  topicProfile: ViralTopicProfile;
  externalRequestCount: number;
  dataLeftDevice: boolean;
  createdAt: string;
  updatedAt: string;
};
