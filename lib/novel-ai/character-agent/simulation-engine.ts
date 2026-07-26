import { planActionCandidates } from "./action-planner";
import { planDialogueCandidates } from "./dialogue-planner";
import { CharacterAgentError } from "./errors";
import { planCharacterGoal } from "./goal-planner";
import { buildCharacterActorContext } from "./perspective-context-builder";
import { makeCharacterAgentRecord, sha256, stableStringify } from "./record-factory";
import {
  evaluateSimulationProgress,
  nextScheduledCharacter,
  NO_PROGRESS_LIMIT,
} from "./turn-scheduler";
import type {
  CharacterAgentProfile,
  CharacterAgentState,
  CharacterBelief,
  CharacterCanonContext,
  CharacterKnowledgeRecord,
  CharacterMemory,
  CharacterRelationshipEdge,
  CharacterSimulationResult,
  CharacterSimulationSession,
  CharacterSimulationTurn,
} from "./types";

function privateMemory(input: {
  session: CharacterSimulationSession;
  canonContext: CharacterCanonContext;
  turnId: string;
  characterId: string;
  relatedCharacterIds: string[];
  summary: string;
  turnNumber: number;
}): CharacterMemory {
  const record = makeCharacterAgentRecord(input.session.projectId, "ai_candidate");
  return {
    ...record,
    id: record.id,
    memoryId: record.id,
    characterId: input.characterId,
    canonContextId: input.canonContext.canonContextId,
    memoryType: "EPISODIC",
    eventId: input.turnId,
    sourceChapterId: null,
    sourceSceneId: null,
    timelinePosition: `${input.session.timelinePosition}:${String(input.turnNumber).padStart(2, "0")}`,
    summary: input.summary,
    perspective: "私人模擬中的角色觀點",
    emotionalValence: 0,
    salience: 45,
    confidence: 0.5,
    truthStatus: "UNKNOWN",
    visibility: "CHARACTER_KNOWN",
    relatedCharacterIds: input.relatedCharacterIds,
    relationshipImpact: {},
    originType: "PRIVATE_SIMULATION",
    sourceEventIds: [input.turnId],
    sourceRevision: input.canonContext.novelRevision,
    approvalStatus: "PRIVATE_ONLY",
    supersedesMemoryId: null,
    contradictedByMemoryIds: [],
    usableInCanonTypes: ["PRIVATE_SIMULATION"],
    usableAfterTimelinePosition: input.session.timelinePosition,
    privateSimulationSessionId: input.session.sessionId,
    freshnessStatus: "CURRENT",
  };
}

export async function runCharacterSimulation(input: {
  session: CharacterSimulationSession;
  canonContext: CharacterCanonContext;
  profiles: CharacterAgentProfile[];
  states: CharacterAgentState[];
  knowledge: CharacterKnowledgeRecord[];
  beliefs: CharacterBelief[];
  memories: CharacterMemory[];
  relationships: CharacterRelationshipEdge[];
  maxTurns?: number;
  existingTurns?: CharacterSimulationTurn[];
  signal?: AbortSignal;
  now?: () => number;
}): Promise<CharacterSimulationResult> {
  if (input.session.canonContextId !== input.canonContext.canonContextId || input.canonContext.canonType !== "PRIVATE_SIMULATION") {
    throw new CharacterAgentError("SIMULATION_CANON_CONTEXT_MISMATCH", "私人模擬必須綁定唯一 PRIVATE_SIMULATION Context。");
  }
  if (input.session.canonContext.canonContextId !== input.canonContext.canonContextId) {
    throw new CharacterAgentError("SIMULATION_PERSISTED_CONTEXT_MISMATCH", "Session 保存的 Canon Context 與執行 Context 不一致。");
  }
  if (input.canonContext.privateSimulationSessionId !== input.session.sessionId) {
    throw new CharacterAgentError("SIMULATION_SESSION_CONTEXT_MISMATCH", "Session 與 Canon Context 不一致。");
  }
  if (!["READY", "RUNNING", "PAUSED"].includes(input.session.status)) {
    throw new CharacterAgentError("SIMULATION_NOT_RUNNABLE", "已完成、放棄或失敗的模擬不能繼續執行。");
  }
  const now = input.now ?? Date.now;
  const deadline = now() + input.session.resourceBudget.timeoutMs;
  let session: CharacterSimulationSession = {
    ...input.session,
    status: "RUNNING",
    startedAt: input.session.startedAt ?? new Date().toISOString(),
  };
  const turns: CharacterSimulationTurn[] = [...(input.existingTurns ?? [])];
  const priorLines: string[] = turns.map((turn) => turn.dialogue?.line).filter((value): value is string => Boolean(value));
  const maxTurns = Math.min(input.maxTurns ?? session.turnBudget, session.turnBudget);
  while (turns.length < maxTurns) {
    if (input.signal?.aborted || session.status === "CANCELLED") {
      session = { ...session, status: "CANCELLED", terminationCode: "CANCELLED", completedAt: new Date().toISOString() };
      break;
    }
    if (now() > deadline) {
      session = { ...session, status: "TIMED_OUT", terminationCode: "TIMEOUT", completedAt: new Date().toISOString() };
      break;
    }
    const speakerCharacterId = nextScheduledCharacter(session);
    const profile = input.profiles.find((item) => item.characterId === speakerCharacterId);
    const state = input.states.find((item) => item.characterId === speakerCharacterId);
    if (!profile || !state) throw new CharacterAgentError("SIMULATION_CHARACTER_STATE_MISSING", "模擬角色缺少 Profile 或 State。");
    const recipients = input.profiles.filter((item) => item.characterId !== speakerCharacterId);
    const actorContext = await buildCharacterActorContext({
      canonContext: input.canonContext,
      characterId: speakerCharacterId,
      knowledge: input.knowledge,
      beliefs: input.beliefs,
      memories: [...input.memories, ...turns.flatMap((turn) => turn.memoryCandidates)],
      goals: state.activeGoals,
      relationships: input.relationships,
      observableEvents: turns.slice(-2).map((turn) => turn.publicMessage).filter((value): value is string => Boolean(value)),
      allowedWorldRules: [],
      allowedSceneData: [session.scenario, session.locationId ?? ""].filter(Boolean),
      factionIdsAtTimeline: profile.factionIds,
      revealedConditionIds: [],
    });
    const goalPlan = planCharacterGoal({
      profile,
      state,
      beliefs: actorContext.beliefs,
      observations: actorContext.observableEvents,
    });
    const seed = `${session.seed}:${turns.length + 1}:${speakerCharacterId}`;
    const actions = planActionCandidates({
      seed,
      actorContext,
      profile,
      state,
      goalPlan,
      beliefs: actorContext.beliefs,
      relationships: actorContext.relationshipView,
      mode: "PRIVATE_SIMULATION",
    });
    const action = actions[turns.length % actions.length];
    const dialogues = planDialogueCandidates({
      seed,
      actorContext,
      profile,
      state,
      goalPlan,
      relationships: actorContext.relationshipView,
      recipients: recipients.map((item) => ({ characterId: item.characterId, name: item.name })),
      priorLines,
    });
    const dialogue = dialogues[0] ?? null;
    if (dialogue) priorLines.push(dialogue.line);
    const turnNumber = turns.length + 1;
    const turnId = `turn:${session.sessionId}:${String(turnNumber).padStart(2, "0")}`;
    const memory = privateMemory({
      session,
      canonContext: input.canonContext,
      turnId,
      characterId: speakerCharacterId,
      relatedCharacterIds: dialogue?.recipientCharacterIds ?? [],
      summary: dialogue?.line ?? action.action,
      turnNumber,
    });
    const relationshipChangeCandidates = dialogue
      ? dialogue.recipientCharacterIds.map((recipientCharacterId) => ({
          relationshipId: actorContext.relationshipView.find((edge) => edge.toCharacterId === recipientCharacterId)?.relationshipId ?? `candidate:${speakerCharacterId}:${recipientCharacterId}`,
          delta: dialogue.relationshipImpact[recipientCharacterId] ?? {},
          cause: `simulation-turn:${turnId}`,
        }))
      : [];
    const decisionPayload = {
      canonContextId: input.canonContext.canonContextId,
      turnNumber,
      speakerCharacterId,
      actionKey: action.key,
      recipientCharacterIds: dialogue?.recipientCharacterIds ?? [],
      knowledgeIds: action.knowledgeIds,
      relationshipChangeCandidates,
    };
    const turnRecord = makeCharacterAgentRecord(session.projectId, "ai_candidate");
    const turn: CharacterSimulationTurn = {
      ...turnRecord,
      id: turnId,
      turnId,
      sessionId: session.sessionId,
      canonContextId: input.canonContext.canonContextId,
      turnNumber,
      speakerCharacterId,
      recipientCharacterIds: dialogue?.recipientCharacterIds ?? [],
      observableEventIds: turns.slice(-2).map((prior) => prior.turnId),
      allowedKnowledgeIds: actorContext.allowedKnowledge.map((record) => record.knowledgeId),
      deniedKnowledgeIds: actorContext.informationFlowTrace.filter((trace) => !trace.allowed).map((trace) => trace.inputEntityId),
      action,
      dialogue,
      publicMessage: dialogue?.publicMessage ? dialogue.line : null,
      privateMessages: dialogue && !dialogue.publicMessage
        ? dialogue.recipientCharacterIds.map((recipientCharacterId) => ({ recipientCharacterId, message: dialogue.line }))
        : [],
      relationshipChangeCandidates,
      memoryCandidates: [memory],
      decisionSummary: `角色依目前可知資訊選擇 ${action.key} 候選；此結果只存在於私人模擬。`,
      knownEvidenceIds: action.knowledgeIds,
      uncertainty: actorContext.allowedKnowledge.length ? [] : ["目前沒有可用的角色知識。"],
      rejectedCandidateCodes: actions.filter((item) => item.key !== action.key).map((item) => `NOT_SELECTED_${item.key}`),
      constraintViolations: [],
      decisionHash: await sha256(stableStringify(decisionPayload)),
      canonicalMutation: 0,
    };
    turns.push(turn);
    const progress = evaluateSimulationProgress(turns);
    const noProgressCount = progress.progress ? 0 : session.noProgressCount + 1;
    const fairnessCounter = { ...session.fairnessCounter, [speakerCharacterId]: (session.fairnessCounter[speakerCharacterId] ?? 0) + 1 };
    session = {
      ...session,
      currentTurn: turnNumber,
      noProgressCount,
      fairnessCounter,
      updatedAt: new Date().toISOString(),
    };
    if (noProgressCount >= NO_PROGRESS_LIMIT) {
      session = { ...session, status: "COMPLETED", terminationCode: "NO_PROGRESS_TERMINATION", completedAt: new Date().toISOString() };
      break;
    }
  }
  if (session.status === "RUNNING") {
    session = maxTurns < session.turnBudget
      ? { ...session, status: "PAUSED", terminationCode: null }
      : { ...session, status: "COMPLETED", terminationCode: "TURN_BUDGET_REACHED", completedAt: new Date().toISOString() };
  }
  return {
    resultId: `result:${session.sessionId}`,
    sessionId: session.sessionId,
    projectId: session.projectId,
    status: session.status,
    session,
    turns,
    relationshipImpactCandidates: turns.flatMap((turn) => turn.relationshipChangeCandidates),
    memoryCandidates: turns.flatMap((turn) => turn.memoryCandidates),
    proposalCandidates: [],
    canonicalMutation: 0,
  };
}
