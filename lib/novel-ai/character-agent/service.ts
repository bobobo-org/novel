import type { NovelRepository } from "../repository/contracts";
import { planActionCandidates } from "./action-planner";
import { proposeBeliefUpdates } from "./belief-engine";
import { assertCanonContextCurrent } from "./canon-context";
import { evaluateCharacterCandidate } from "./character-evaluator";
import { planDialogueCandidates } from "./dialogue-planner";
import { CharacterAgentError } from "./errors";
import { planCharacterGoal } from "./goal-planner";
import { assertNoKnowledgeLeak } from "./knowledge-gateway";
import { selectCharacterMemories } from "./memory-selector";
import { buildCharacterActorContext, buildCharacterEvaluatorContext } from "./perspective-context-builder";
import { assertNoRawReasoningStorage, secureCharacterContent } from "./security/character-security";
import type { CharacterAgentLoopInput, CharacterAgentRun } from "./types";

export class CharacterAgentConcurrencyGuard {
  private inFlight = new Map<string, Promise<CharacterAgentRun>>();

  run(key: string, operation: () => Promise<CharacterAgentRun>) {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = operation().finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }
}

export class CharacterAgentService {
  private readonly repository: NovelRepository | null;
  private readonly concurrencyGuard: CharacterAgentConcurrencyGuard;

  constructor(repository?: NovelRepository, concurrencyGuard = new CharacterAgentConcurrencyGuard()) {
    this.repository = repository ?? null;
    this.concurrencyGuard = concurrencyGuard;
  }

  async run(input: CharacterAgentLoopInput): Promise<CharacterAgentRun> {
    const key = `${input.canonContext.projectId}:${input.character.id}:${input.canonContext.canonContextId}`;
    return this.concurrencyGuard.run(key, () => this.runInternal(input));
  }

  private async runInternal(input: CharacterAgentLoopInput): Promise<CharacterAgentRun> {
    const startedAt = performance.now();
    if (input.signal?.aborted) throw new CharacterAgentError("CHARACTER_AGENT_CANCELLED", "角色思考已取消。");
    assertCanonContextCurrent({
      expected: input.canonContext,
      currentNovelRevision: input.currentProjectRevision,
      currentStoryBibleVersion: input.currentStoryBibleRevision,
      currentDramaAdaptationRevision: input.currentDramaAdaptationRevision,
      currentCharacterRevisions: input.currentCharacterRevisions,
    });
    if (input.project.id !== input.canonContext.projectId
      || input.storyBible.projectId !== input.canonContext.projectId
      || input.character.projectId !== input.canonContext.projectId) {
      throw new CharacterAgentError("CHARACTER_AGENT_PROJECT_SCOPE_MISMATCH", "角色、作品與 Story Bible 必須屬於同一作品。");
    }
    if (
      input.timelinePosition !== input.canonContext.timelinePosition
      || input.state.timelinePosition !== input.canonContext.timelinePosition
      || input.state.canonContextId !== input.canonContext.canonContextId
    ) {
      throw new CharacterAgentError("CHARACTER_AGENT_TIMELINE_CONTEXT_MISMATCH", "角色狀態與執行時間點必須屬於同一 Canon Context。");
    }
    if (
      input.profile.sourceStoryRevision !== input.currentProjectRevision
      || input.profile.sourceStoryBibleVersion !== input.currentStoryBibleRevision
      || input.profile.sourceCharacterRevision !== input.currentCharacterRevision
    ) {
      throw new CharacterAgentError("CHARACTER_AGENT_PROFILE_STALE", "角色 Profile 來源版本已更新，請重新建立。");
    }
    if (input.provider.externalRequest && !input.provider.consentId) {
      throw new CharacterAgentError("CHARACTER_EXTERNAL_CONSENT_REQUIRED", "故事或角色資料送往外部 Provider 前需要本次明確同意。");
    }
    const securedObservations = await Promise.all(input.observations.map((content, index) => secureCharacterContent({
      sourceId: `observation:${input.character.id}:${index}`,
      sourceRevision: input.currentProjectRevision,
      content,
    })));
    const observations = securedObservations.map((result) => result.sanitizedText);
    const actorContext = await buildCharacterActorContext({
      canonContext: input.canonContext,
      characterId: input.character.id,
      knowledge: input.knowledge,
      beliefs: input.beliefs,
      memories: input.memories,
      goals: input.state.activeGoals,
      relationships: input.relationships,
      observableEvents: observations,
      allowedWorldRules: [],
      allowedSceneData: observations,
      factionIdsAtTimeline: input.factionIdsAtTimeline,
      revealedConditionIds: input.revealedConditionIds,
    });
    const evaluatorContext = await buildCharacterEvaluatorContext({
      canonContext: input.canonContext,
      characterId: input.character.id,
      knowledge: input.knowledge,
      futureForeshadowing: input.storyBible.foreshadowing,
      globalTimeline: [],
      privateCharacterData: [],
      consistencyConstraints: input.storyBible.forbiddenContradictions,
      evaluatorAuthorized: true,
    });
    const memorySelection = selectCharacterMemories(actorContext.memories, {
      projectId: input.project.id,
      characterId: input.character.id,
      timelinePosition: input.timelinePosition,
      currentGoal: input.state.activeGoals[0] ?? null,
      currentSceneId: input.sceneId,
      relatedCharacterIds: input.targetCharacterIds,
      emotionalState: input.state.emotionalState,
      canonContext: input.canonContext,
      privateSimulationSessionId: input.canonContext.privateSimulationSessionId,
      limit: 8,
    });
    actorContext.memories = memorySelection.map((item) => item.memory);
    const beliefUpdateCandidates = proposeBeliefUpdates({
      projectId: input.project.id,
      characterId: input.character.id,
      existingBeliefs: actorContext.beliefs,
      observations,
      allowedKnowledge: actorContext.allowedKnowledge,
      timelinePosition: input.timelinePosition,
      canonContextId: input.canonContext.canonContextId,
    });
    const goalPlan = planCharacterGoal({
      profile: input.profile,
      state: input.state,
      beliefs: [...actorContext.beliefs, ...beliefUpdateCandidates],
      observations,
    });
    const runId = crypto.randomUUID();
    const actionCandidates = planActionCandidates({
      seed: `${input.canonContext.canonContextId}:${runId}`,
      actorContext,
      profile: input.profile,
      state: input.state,
      goalPlan,
      beliefs: [...actorContext.beliefs, ...beliefUpdateCandidates],
      relationships: actorContext.relationshipView,
      mode: input.canonContext.canonType === "PRIVATE_SIMULATION" ? "PRIVATE_SIMULATION" : "PRESENT_ACTION",
    });
    const recipients = input.otherProfiles
      .filter((profile) => input.targetCharacterIds.includes(profile.characterId))
      .map((profile) => ({ characterId: profile.characterId, name: profile.name }));
    const dialogueCandidates = planDialogueCandidates({
      seed: `${input.canonContext.canonContextId}:${runId}`,
      actorContext,
      profile: input.profile,
      state: input.state,
      goalPlan,
      relationships: actorContext.relationshipView,
      recipients,
    });
    const evaluation = evaluateCharacterCandidate({
      projectId: input.project.id,
      agentRunId: runId,
      profile: input.profile,
      state: input.state,
      actorContext,
      evaluatorContext,
      actions: actionCandidates,
      dialogues: dialogueCandidates,
      sceneLocationId: input.state.locationId,
      attemptedCanonicalMutation: false,
    });
    const usedKnowledgeIds = [
      ...actionCandidates.flatMap((candidate) => candidate.knowledgeIds),
      ...dialogueCandidates.flatMap((candidate) => candidate.knowledgeIds),
    ];
    let leakReport: CharacterAgentRun["knowledgeLeakReport"];
    try {
      leakReport = assertNoKnowledgeLeak({
        contextId: actorContext.contextId,
        projectId: input.project.id,
        characterId: input.character.id,
        kind: "ACTOR",
        timelinePosition: input.timelinePosition,
        allowedKnowledgeIds: actorContext.allowedKnowledge.map((record) => record.knowledgeId),
        deniedKnowledgeIds: actorContext.informationFlowTrace.filter((trace) => !trace.allowed).map((trace) => trace.inputEntityId),
        denialReasons: {},
        sourceReferences: actorContext.allowedKnowledge.flatMap((record) => record.sourceReferences),
        visibilityTrace: [],
        scopeDecisionHash: actorContext.informationFlowTrace[0]?.decisionHash ?? "",
        informationFlowTrace: actorContext.informationFlowTrace,
      }, usedKnowledgeIds);
    } catch {
      leakReport = {
        leakedKnowledgeIds: usedKnowledgeIds.filter((id) => !actorContext.allowedKnowledge.some((record) => record.knowledgeId === id)),
        blockedKnowledgeIds: actorContext.informationFlowTrace.filter((trace) => !trace.allowed).map((trace) => trace.inputEntityId),
        status: "BLOCKED",
      };
    }
    if (this.repository) await this.repository.put("characterAgentEvaluations", evaluation);
    const result: CharacterAgentRun = {
      agentRunId: runId,
      projectId: input.project.id,
      characterId: input.character.id,
      canonContext: structuredClone(input.canonContext),
      observations,
      allowedKnowledge: actorContext.allowedKnowledge,
      deniedKnowledge: input.knowledge.filter((record) => !actorContext.allowedKnowledge.some((allowed) => allowed.knowledgeId === record.knowledgeId)),
      beliefStateBefore: actorContext.beliefs,
      beliefUpdateCandidates,
      activeGoals: goalPlan.activeGoals,
      selectedGoal: goalPlan.selectedGoal,
      plan: goalPlan.plan,
      actionCandidates,
      dialogueCandidates,
      relationshipImpactCandidates: actionCandidates.flatMap((candidate) => Object.entries(candidate.relationshipImpact).map(([targetId, delta]) => ({
        relationshipId: actorContext.relationshipView.find((edge) => edge.toCharacterId === targetId)?.relationshipId ?? `candidate:${input.character.id}:${targetId}`,
        delta,
        cause: `action-candidate:${candidate.candidateId}`,
      }))),
      privateArcImpact: input.state.privateArcIds,
      characterConsistencyReport: evaluation,
      knowledgeLeakReport: leakReport,
      canonicalImpact: [],
      canonicalMutation: 0,
      provider: input.provider.providerId,
      model: input.provider.modelId,
      latency: Math.round(performance.now() - startedAt),
      tokenEstimate: Math.ceil((observations.join("").length + actorContext.allowedKnowledge.reduce((sum, record) => sum + record.claim.length, 0)) / 4),
      status: evaluation.blockingIssueCount || leakReport.status === "BLOCKED" ? "BLOCKED" : "CANDIDATE",
      decisionSummary: goalPlan.selectedGoal
        ? `角色依可知資訊選擇「${goalPlan.selectedGoal}」，產生三個尚未套用的行動方向。`
        : "角色目前沒有可支持的主動目標，因此不會臆造正式動機。",
      knownEvidenceIds: [...new Set(actorContext.allowedKnowledge.flatMap((record) => record.sourceReferences.map((reference) => reference.referenceId)))],
      uncertainty: [
        ...(input.profile.personalityTraits.support !== "SUPPORTED" ? ["角色性格尚未由直接來源完整支持。"] : []),
        ...(actorContext.informationFlowTrace.some((trace) => !trace.allowed) ? ["部分資訊受知識邊界限制。"] : []),
      ],
      rejectedCandidateCodes: evaluation.deterministicIssues.map((issue) => issue.code),
      constraintViolations: evaluation.deterministicIssues.map((issue) => issue.reason),
      sourceReferences: actorContext.allowedKnowledge.flatMap((record) => record.sourceReferences),
      freshnessStatus: "CURRENT",
    };
    assertNoRawReasoningStorage(result);
    return result;
  }
}
