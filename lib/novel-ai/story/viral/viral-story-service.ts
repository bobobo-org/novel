import crypto from "crypto";
import type {
  AbsurdityMode, AbsurdityProfile, ClueType, IdentityLayer, RevealMode, RevealSchedule, ReversalClue, ReversalLevel,
  ReversalPlan, ShortDramaPlan, TropeMixInput, TropeMixResult, ViralHookSet, ViralQualityIssue, ViralQualityResult,
  ViralStoryPlan, ViralTopicProfile, ViralTrope,
} from "./viral-story-types";
import { VIRAL_STORY_ENGINE_VERSION } from "./viral-story-types";
import { getTopicProfile, getTrope, VIRAL_CLASSIFICATION_PACKS, VIRAL_TOPIC_PROFILES, VIRAL_TROPE_REGISTRY } from "./viral-trope-registry";

function now() { return new Date().toISOString(); }
function hash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function seededIndex(seed: string, mod: number) { return Number.parseInt(hash(seed).slice(0, 8), 16) % mod; }
function unique<T>(items: T[]) { return Array.from(new Set(items)); }

export function mixTropes(input: TropeMixInput = {}): TropeMixResult {
  const topic = getTopicProfile(input.classificationPackId, input.topicId);
  const excluded = new Set([...(input.excludedTropeIds ?? []), ...topic.excludedTropes]);
  const required = (input.requiredTropeIds ?? []).map(getTrope).filter(Boolean) as ViralTrope[];
  const seed = input.seed || `${topic.topicId}:${input.mode || "seeded"}`;
  const start = seededIndex(seed, VIRAL_TROPE_REGISTRY.length);
  const preferred = unique([...topic.recommendedTropes, ...topic.compatibleTropes])
    .map(getTrope).filter(Boolean) as ViralTrope[];
  const requiredIds = new Set(required.map((trope) => trope.tropeId));
  const pool = [...required, ...preferred, ...VIRAL_TROPE_REGISTRY.slice(start), ...VIRAL_TROPE_REGISTRY.slice(0, start)]
    .filter((trope) => trope.enabled && (requiredIds.has(trope.tropeId) || !excluded.has(trope.tropeId)))
    .filter((trope) => input.adultProfile ? trope.adultProfileCompatibility === "general" || trope.adultProfileCompatibility === input.adultProfile : true);
  const selectedTropes = unique(pool.map((trope) => trope.tropeId)).slice(0, input.maxTropes ?? (input.extremeMode ? 6 : input.conservativeMode ? 3 : 4)).map((id) => getTrope(id)!).filter(Boolean);
  const incompatibilities = selectedTropes.flatMap((trope) => trope.incompatibleTropes.filter((id) => selectedTropes.some((item) => item.tropeId === id)).map((id) => `${trope.tropeId}:${id}`));
  const requiredWorldRules = unique(selectedTropes.flatMap((trope) => trope.requiredWorldRules));
  const requiredSetup = unique(selectedTropes.flatMap((trope) => trope.setupRequirements));
  const requiredCharacters = unique(selectedTropes.flatMap((trope) => trope.requiredCharacterRoles));
  const requiredRelationships = selectedTropes.some((trope) => trope.category === "romance" || trope.category === "family") ? ["relationship baseline", "trust delta"] : ["conflict baseline"];
  const plannedReveals = selectedTropes.map((trope) => `${trope.displayName} reveal`);
  const continuityRisks = incompatibilities.length ? ["Incompatible trope combination requires replacement"] : selectedTropes.length > 5 ? ["High trope density may cause fatigue"] : [];
  const absurdityScore = Math.min(100, selectedTropes.reduce((sum, trope) => sum + trope.absurdityWeight * 7, 0));
  const noveltyScore = Math.min(100, selectedTropes.reduce((sum, trope) => sum + trope.noveltyWeight * 6, 0));
  const controversyScore = Math.min(100, selectedTropes.reduce((sum, trope) => sum + trope.controversyWeight * 8, 0));
  const shortDramaScore = Math.round(selectedTropes.reduce((sum, trope) => sum + trope.shortDramaSuitability, 0) / Math.max(1, selectedTropes.length));
  return {
    selectedTropes,
    compatibilityStatus: incompatibilities.length ? "incompatible" : continuityRisks.length ? "compatible_with_warnings" : "compatible",
    requiredWorldRules,
    requiredSetup,
    requiredCharacters,
    requiredRelationships,
    plannedReveals,
    incompatibilities,
    continuityRisks,
    absurdityScore,
    noveltyScore,
    controversyScore,
    shortDramaScore,
    recommendationReasons: selectedTropes.map((trope) => `${trope.displayName} fits ${topic.defaultHookStyle}`),
  };
}

export function buildAbsurdityProfile(mode: AbsurdityMode = "heightened"): AbsurdityProfile {
  const level = { realism: 1, heightened: 2, melodramatic: 3, absurd: 4, extreme_absurd: 5 }[mode];
  return {
    mode,
    coincidenceAllowance: level,
    identityComplexity: Math.min(5, level + 1),
    reversalFrequency: level,
    emotionalAmplification: Math.min(5, level + 1),
    socialConsequence: Math.max(2, 6 - level),
    worldRuleFlexibility: level,
    humorLevel: mode.includes("absurd") ? 5 : level,
    seriousnessFloor: Math.max(1, 5 - level),
    requiredJustifications: ["setup", "world rule", "consequence", "character motivation", "continuity impact"],
  };
}

export function buildIdentityLayer(hero = "protagonist", antagonist = "opponent", tropes: ViralTrope[] = []): IdentityLayer {
  const identityTrope = tropes.find((trope) => trope.category === "identity")?.displayName ?? "hidden pressure";
  return {
    publicIdentity: `${hero} public role`,
    believedIdentity: `${hero} as understood by allies`,
    falseIdentity: `${antagonist}'s misleading frame about ${hero}`,
    secretIdentities: [`${hero} linked to ${identityTrope}`],
    identityEvidence: ["public record", "object clue", "dialogue contradiction"],
    falseEvidence: ["edited screenshot", "partial witness claim"],
    whoKnowsWhat: { [hero]: ["finalTruth"], [antagonist]: ["falseEvidence"] },
    whoBelievesWhat: { audience: "partialReveal", ally: "believedIdentity" },
    whoIsLying: [antagonist],
    revealConditions: ["at least two clues are visible", "relationship consequence is prepared"],
    revealOrder: ["falseReveal", "partialReveal", "finalTruth"],
    falseReveal: `${hero} appears to be exposed too early`,
    partialReveal: `A clue proves the public story is incomplete`,
    finalTruth: `${hero}'s identity changes the conflict objective`,
    identityConsequences: ["trust shift", "new antagonist move", "branch-specific knowledge update"],
  };
}

export function planReversal(tropes: ViralTrope[], level: ReversalLevel = "chapter", chapter = 1): ReversalPlan {
  const trope = tropes[0] ?? VIRAL_TROPE_REGISTRY[0];
  return {
    reversalId: `reversal_${hash(`${trope.tropeId}:${level}:${chapter}`).slice(0, 10)}`,
    level,
    setup: `Seed ${trope.displayName} with visible consequence.`,
    clueIds: [],
    misdirection: `Make the audience expect ${trope.aliases[0]}.`,
    trigger: `A public action forces hidden information into the scene.`,
    reveal: `${trope.displayName} changes the power balance.`,
    affectedCharacters: ["protagonist", "opponent"],
    affectedRelationships: ["trust", "rivalry"],
    affectedFactions: ["public audience"],
    consequence: "The next scene must pay a social or strategic cost.",
    nextQuestion: "Who benefits from the reveal being mistimed?",
    canonicalCandidates: ["event", "foreshadowing", "open_thread"],
    unsupportedRisk: "Reversal without setup",
    plannedChapter: chapter,
    earliestAllowedChapter: Math.max(1, chapter - 1),
    latestAllowedChapter: chapter + 3,
  };
}

export function planClues(reversal: ReversalPlan): ReversalClue[] {
  const clueTypes: ClueType[] = ["hard", "soft", "false", "emotional", "visual", "dialogue", "behavior", "object", "timeline"];
  return clueTypes.slice(0, 5).map((clueType, index) => ({
    clueId: `${reversal.reversalId}_clue_${index + 1}`,
    reversalId: reversal.reversalId,
    clueType,
    content: `${clueType} clue for ${reversal.reveal}`,
    sourceChapter: Math.max(1, reversal.plannedChapter - 1 + (index % 2)),
    visibility: index === 2 ? "misleading" : index === 0 ? "visible" : "subtle",
    whoNotices: index % 2 === 0 ? ["protagonist"] : ["audience"],
    whoIgnores: ["opponent"],
    interpretation: "Supports the final reveal after context changes.",
    falseInterpretation: "Looks like coincidence before the trigger.",
    revealContribution: 20 + index * 10,
    used: false,
    resolved: false,
  }));
}

export function scheduleReveal(reversal: ReversalPlan, clues: ReversalClue[], mode: RevealMode = "chapter_end"): RevealSchedule {
  const coverage = clues.reduce((sum, clue) => sum + clue.revealContribution, 0);
  return {
    mode,
    revealTooEarly: coverage < 50,
    revealTooLate: reversal.latestAllowedChapter < reversal.plannedChapter,
    clueCoverage: Math.min(100, coverage),
    audienceKnowledge: clues.filter((clue) => clue.whoNotices.includes("audience")).map((clue) => clue.content),
    characterKnowledge: { protagonist: clues.filter((clue) => clue.whoNotices.includes("protagonist")).map((clue) => clue.content) },
    branchConsistency: coverage >= 80 ? "safe" : "warning",
    requiredConsequence: reversal.consequence,
  };
}

export function generateHooks(tropes: ViralTrope[], identity: IdentityLayer): ViralHookSet {
  const trope = tropes[0] ?? VIRAL_TROPE_REGISTRY[0];
  return {
    openingHook: `Everyone believed ${identity.falseIdentity}, until ${trope.displayName} made the room go silent.`,
    firstSentenceHook: `The proof arrived from someone who should not exist.`,
    firstThreeParagraphHook: `A public scene, a wrong assumption, and one visible clue collide.`,
    chapterOpening: `Open on consequence before explanation.`,
    midpointTurn: `${trope.displayName} flips from accusation to leverage.`,
    endCliffhanger: `The last witness recognizes the secret identity.`,
    quoteCandidates: [`"You were right about the lie, but wrong about who told it."`, `"Keep the screenshot. I kept the original."`],
    screenshotMoment: `A visible object contradicts the public story.`,
    argumentTrigger: `A public accusation uses incomplete evidence.`,
    emotionalPeak: `An ally chooses whether to trust the protagonist after the partial reveal.`,
    absurdReveal: `The most ridiculous detail is the only true evidence.`,
    teaserCopy: `A secret identity, a public trap, and a reversal with a price.`,
    shortVideoTitle: `They exposed the wrong person`,
    episodeEnding: `Cut when the false evidence becomes useful.`,
    nextEpisodeHook: `The real owner of the clue appears.`,
  };
}

export function buildShortDramaPlan(hooks: ViralHookSet, episodeCount: 1 | 3 | 5 | 10 | 20 = 5): ShortDramaPlan {
  const types: ShortDramaPlan["segments"][number]["segmentType"][] = ["coldOpen", "setup", "conflict", "escalation", "turn", "payoff", "cliffhanger"];
  return {
    episodeCount,
    segments: types.map((segmentType, index) => ({
      segmentType,
      requiredEvent: index === 0 ? hooks.firstSentenceHook : `${segmentType} advances the reversal`,
      canonicalOutcome: index === types.length - 1 ? hooks.nextEpisodeHook : `${segmentType} state recorded`,
    })),
    canonicalOutcome: hooks.endCliffhanger,
    requiredEvents: [hooks.openingHook, hooks.midpointTurn, hooks.endCliffhanger],
    characterMotivation: "Protect agency while forcing the public conflict to reveal a cost.",
    relationshipOutcome: "Trust changes only after visible action.",
    branchIdentity: `branch_${hash(hooks.teaserCopy).slice(0, 8)}`,
  };
}

export function runViralQualityGuard(plan: Partial<ViralStoryPlan> & { tropeMix?: TropeMixResult; revealSchedule?: RevealSchedule; reversalPlans?: ReversalPlan[] }): ViralQualityResult {
  const issues: ViralQualityIssue[] = [];
  if (plan.tropeMix?.incompatibilities.length) issues.push(issue("Repeated Trope Combination", "blocking", plan.tropeMix.incompatibilities, ["Replace one incompatible trope"], true));
  if ((plan.tropeMix?.selectedTropes.length ?? 0) > 6) issues.push(issue("Twist Fatigue", "major", ["tropeMix"], ["Reduce trope count"], false));
  if ((plan.revealSchedule?.clueCoverage ?? 0) < 60) issues.push(issue("Reversal Without Setup", "major", ["clues"], ["Add two earlier clues"], false));
  if ((plan.reversalPlans ?? []).some((item) => item.unsupportedRisk)) issues.push(issue("Unsupported Reveal", "warning", ["reversal"], ["Attach source evidence"], false));
  const blocked = issues.some((item) => item.blocked);
  return {
    qualityStatus: blocked ? "blocked" : issues.length ? "needs_revision" : "pass",
    issues,
    score: Math.max(0, 100 - issues.reduce((sum, item) => sum + (item.severity === "blocking" ? 40 : item.severity === "major" ? 20 : 8), 0)),
    externalRequestCount: 0,
    dataLeftDevice: false,
  };
}

function issue(issueType: string, severity: ViralQualityIssue["severity"], affectedElements: string[], suggestedFixes: string[], blocked: boolean): ViralQualityIssue {
  return { issueType, severity, affectedElements, suggestedFixes, blocked, retryAllowed: !blocked };
}

export class ViralStoryService {
  readonly options: { projectId: string; connection?: { run(sql: string, params?: unknown[]): unknown; get(sql: string, params?: unknown[]): Record<string, unknown> | undefined; all(sql: string, params?: unknown[]): Record<string, unknown>[] } };

  constructor(options: { projectId: string; connection?: { run(sql: string, params?: unknown[]): unknown; get(sql: string, params?: unknown[]): Record<string, unknown> | undefined; all(sql: string, params?: unknown[]): Record<string, unknown>[] } }) {
    this.options = options;
  }

  seedViralRegistry() {
    if (!this.options.connection) return { tropeCount: VIRAL_TROPE_REGISTRY.length, topicCount: VIRAL_TOPIC_PROFILES.length };
    const time = now();
    for (const trope of VIRAL_TROPE_REGISTRY) {
      this.options.connection.run("INSERT OR REPLACE INTO viral_trope_registry(project_id, trope_id, category, display_name, row_json, enabled, version, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)", [
        this.options.projectId, trope.tropeId, trope.category, trope.displayName, JSON.stringify(trope), trope.enabled ? 1 : 0, trope.version, time, time,
      ]);
    }
    for (const profile of VIRAL_TOPIC_PROFILES) {
      this.options.connection.run("INSERT OR REPLACE INTO viral_topic_profiles(project_id, classification_pack_id, topic_id, row_json, created_at, updated_at) VALUES(?,?,?,?,?,?)", [
        this.options.projectId, profile.classificationPackId, profile.topicId, JSON.stringify(profile), time, time,
      ]);
    }
    return { tropeCount: VIRAL_TROPE_REGISTRY.length, topicCount: VIRAL_TOPIC_PROFILES.length };
  }

  createPlan(input: TropeMixInput & { title?: string; branchId?: string; hero?: string; antagonist?: string; episodeCount?: 1 | 3 | 5 | 10 | 20 } = {}): ViralStoryPlan {
    const topicProfile = getTopicProfile(input.classificationPackId, input.topicId);
    const tropeMix = mixTropes({ ...input, classificationPackId: topicProfile.classificationPackId, topicId: topicProfile.topicId });
    const absurdityProfile = buildAbsurdityProfile(input.extremeMode ? "extreme_absurd" : topicProfile.defaultAbsurdity);
    const identityLayer = buildIdentityLayer(input.hero, input.antagonist, tropeMix.selectedTropes);
    const reversal = planReversal(tropeMix.selectedTropes, topicProfile.defaultReversalDepth, 1);
    const clues = planClues(reversal);
    reversal.clueIds = clues.map((clue) => clue.clueId);
    const revealSchedule = scheduleReveal(reversal, clues);
    const hooks = generateHooks(tropeMix.selectedTropes, identityLayer);
    const shortDrama = buildShortDramaPlan(hooks, input.episodeCount ?? 5);
    const draft: Partial<ViralStoryPlan> = { tropeMix, revealSchedule, reversalPlans: [reversal] };
    const quality = runViralQualityGuard(draft);
    const time = now();
    const plan: ViralStoryPlan = {
      planId: `viral_plan_${hash(`${this.options.projectId}:${time}:${input.title ?? "untitled"}`).slice(0, 12)}`,
      projectId: this.options.projectId,
      branchId: input.branchId ?? "main",
      title: input.title ?? "Viral absurd story plan",
      tropeMix,
      absurdityProfile,
      identityLayer,
      reversalPlans: [reversal],
      clues,
      revealSchedule,
      hooks,
      cliffhangers: [hooks.endCliffhanger, hooks.nextEpisodeHook],
      quoteMoments: hooks.quoteCandidates,
      screenshotMoments: [hooks.screenshotMoment],
      shortDrama,
      quality,
      topicProfile,
      externalRequestCount: 0,
      dataLeftDevice: false,
      createdAt: time,
      updatedAt: time,
    };
    this.persistPlan(plan);
    return plan;
  }

  persistPlan(plan: ViralStoryPlan) {
    const db = this.options.connection;
    if (!db) return;
    db.run("INSERT OR REPLACE INTO viral_story_plans(project_id, plan_id, branch_id, title, row_json, quality_status, external_request_count, data_left_device, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", [
      plan.projectId, plan.planId, plan.branchId, plan.title, JSON.stringify(plan), plan.quality.qualityStatus, 0, 0, plan.createdAt, plan.updatedAt,
    ]);
    for (const trope of plan.tropeMix.selectedTropes) {
      db.run("INSERT OR REPLACE INTO viral_story_plan_tropes(project_id, plan_id, trope_id, row_json, created_at) VALUES(?,?,?,?,?)", [plan.projectId, plan.planId, trope.tropeId, JSON.stringify(trope), now()]);
    }
    db.run("INSERT OR REPLACE INTO viral_identity_layers(project_id, plan_id, row_json, created_at, updated_at) VALUES(?,?,?,?,?)", [plan.projectId, plan.planId, JSON.stringify(plan.identityLayer), now(), now()]);
    for (const reversal of plan.reversalPlans) db.run("INSERT OR REPLACE INTO viral_reversal_plans(project_id, plan_id, reversal_id, row_json, created_at, updated_at) VALUES(?,?,?,?,?,?)", [plan.projectId, plan.planId, reversal.reversalId, JSON.stringify(reversal), now(), now()]);
    for (const clue of plan.clues) db.run("INSERT OR REPLACE INTO viral_reversal_clues(project_id, plan_id, clue_id, reversal_id, row_json, created_at, updated_at) VALUES(?,?,?,?,?,?,?)", [plan.projectId, plan.planId, clue.clueId, clue.reversalId, JSON.stringify(clue), now(), now()]);
    db.run("INSERT OR REPLACE INTO viral_reveal_schedules(project_id, plan_id, row_json, created_at, updated_at) VALUES(?,?,?,?,?)", [plan.projectId, plan.planId, JSON.stringify(plan.revealSchedule), now(), now()]);
    db.run("INSERT OR REPLACE INTO viral_hook_candidates(project_id, plan_id, row_json, created_at) VALUES(?,?,?,?)", [plan.projectId, plan.planId, JSON.stringify(plan.hooks), now()]);
    db.run("INSERT OR REPLACE INTO viral_short_drama_versions(project_id, plan_id, row_json, created_at, updated_at) VALUES(?,?,?,?,?)", [plan.projectId, plan.planId, JSON.stringify(plan.shortDrama), now(), now()]);
    db.run("INSERT OR REPLACE INTO viral_quality_results(project_id, plan_id, quality_status, row_json, created_at) VALUES(?,?,?,?,?)", [plan.projectId, plan.planId, plan.quality.qualityStatus, JSON.stringify(plan.quality), now()]);
    db.run("INSERT OR REPLACE INTO viral_story_versions(project_id, plan_id, version_id, row_json, created_at) VALUES(?,?,?,?,?)", [plan.projectId, plan.planId, `viral_version_${hash(plan.planId).slice(0, 10)}`, JSON.stringify(plan), now()]);
  }

  listPlans() {
    return this.options.connection?.all("SELECT * FROM viral_story_plans WHERE project_id=? ORDER BY created_at ASC", [this.options.projectId]) ?? [];
  }
}

export const VIRAL_STORY_HEALTH = {
  viralStoryEngineStatus: "ready",
  absurdStoryEngineStatus: "ready",
  viralTropeRegistryStatus: "ready",
  viralTropeMixerStatus: "ready",
  identityLayerStatus: "ready",
  reversalPlannerStatus: "ready",
  cluePlannerStatus: "ready",
  revealSchedulerStatus: "ready",
  viralHookStatus: "ready",
  cliffhangerSchedulerStatus: "ready",
  shortDramaEngineStatus: "ready",
  viralQualityGuardStatus: "ready",
  viralTopicIntegrationStatus: "ready",
  viralLocalGenerationStatus: "verified_on_client_runtime",
  viralTropeCount: VIRAL_TROPE_REGISTRY.length,
  viralTopicProfileCount: VIRAL_TOPIC_PROFILES.length,
  viralClassificationPackCount: VIRAL_CLASSIFICATION_PACKS.length,
  viralStoryEngineVersion: VIRAL_STORY_ENGINE_VERSION,
  viralStoryMigrationVersion: "020_viral_absurd_story_engine",
};
