import { CharacterAgentError } from "./errors";
import { sha256, stableStringify } from "./record-factory";
import { createCharacterCanonContext } from "./canon-context";
import type { PlatformProviderId } from "../router/platform-types";
import type {
  CharacterCanonContext,
  CharacterSimulationSession,
  CharacterSimulationTurn,
  CharacterSimulationStatus,
} from "./types";

export const DEFAULT_SIMULATION_TURN_BUDGET = 12;
export const MAX_SIMULATION_TURN_BUDGET = 30;
export const NO_PROGRESS_LIMIT = 3;

function normalizeAction(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}]+/gu, "");
}

export async function createCharacterSimulationSession(input: {
  canonContext: CharacterCanonContext;
  participantCharacterIds: string[];
  scenario: string;
  timelinePosition: string;
  locationId: string | null;
  turnBudget?: number;
  timeoutMs?: number;
  maxContextCharacters?: number;
  maxGeneratedCharacters?: number;
  seed: string;
  providerId?: PlatformProviderId;
  model?: string | null;
  modelDigest?: string | null;
  temperature?: number;
  topP?: number;
  promptProfileVersion?: string;
  providerRunId?: string;
  sessionId?: string;
}): Promise<CharacterSimulationSession> {
  const participants = [...new Set(input.participantCharacterIds)];
  if (participants.length < 2) throw new CharacterAgentError("SIMULATION_PARTICIPANTS_REQUIRED", "私人模擬至少需要兩位角色。");
  const turnBudget = Math.max(1, Math.min(input.turnBudget ?? DEFAULT_SIMULATION_TURN_BUDGET, MAX_SIMULATION_TURN_BUDGET));
  const identity = {
    canonContextId: input.canonContext.canonContextId,
    participants,
    scenario: input.scenario,
    timelinePosition: input.timelinePosition,
    locationId: input.locationId,
    turnBudget,
    seed: input.seed,
  };
  const sessionId = input.sessionId
    ?? input.canonContext.privateSimulationSessionId
    ?? `simulation:${(await sha256(stableStringify(identity))).slice(0, 40)}`;
  if (input.canonContext.canonType === "PRIVATE_SIMULATION" && input.canonContext.privateSimulationSessionId !== sessionId) {
    throw new CharacterAgentError("SIMULATION_SESSION_CONTEXT_MISMATCH", "Session ID 必須與私人 Canon Context 綁定。");
  }
  const now = new Date().toISOString();
  const contextHash = await sha256(stableStringify(identity));
  const providerId = input.providerId ?? "deterministic-local";
  return {
    schemaVersion: "novel-domain-v1",
    id: sessionId,
    projectId: input.canonContext.projectId,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    source: "ai_candidate",
    provenance: { source: "ai_candidate", actor: providerId === "local-ollama" ? "local-ollama" : "local-rule", createdAt: now },
    deletedAt: null,
    parentRevision: null,
    migrationVersion: "p24b-character-agent-v1",
    characterAgentSchemaVersion: "character-agent-v1",
    sessionId,
    canonContextId: input.canonContext.canonContextId,
    canonContext: structuredClone(input.canonContext),
    participantCharacterIds: participants,
    scenario: input.scenario,
    timelinePosition: input.timelinePosition,
    locationId: input.locationId,
    privateMode: true,
    turnBudget,
    resourceBudget: {
      timeoutMs: Math.max(250, Math.min(input.timeoutMs ?? 30_000, 180_000)),
      maxContextCharacters: Math.max(1_000, Math.min(input.maxContextCharacters ?? 30_000, 250_000)),
      maxGeneratedCharacters: Math.max(500, Math.min(input.maxGeneratedCharacters ?? 12_000, 100_000)),
    },
    seed: input.seed,
    status: "READY",
    currentTurn: 0,
    startedAt: null,
    completedAt: null,
    noProgressCount: 0,
    fairnessCounter: Object.fromEntries(participants.map((id) => [id, 0])),
    providerReplay: {
      providerId,
      model: input.model ?? null,
      modelDigest: input.modelDigest ?? null,
      temperature: input.temperature ?? 0,
      topP: input.topP ?? 1,
      seed: input.seed,
      contextHash,
      promptProfileVersion: input.promptProfileVersion ?? "character-agent-p24b-v1",
      providerRunId: input.providerRunId ?? `provider:${contextHash.slice(0, 24)}`,
      deterministicClaim: providerId === "deterministic-local" ? "FULL" : "STRUCTURE_ONLY",
    },
    terminationCode: null,
    canonicalMutation: 0,
  };
}

export async function createPrivateSimulationBundle(input: {
  sourceCanonContext: CharacterCanonContext;
  participantCharacterIds: string[];
  scenario: string;
  timelinePosition: string;
  locationId: string | null;
  turnBudget?: number;
  timeoutMs?: number;
  seed: string;
  providerId?: PlatformProviderId;
  model?: string | null;
  modelDigest?: string | null;
  temperature?: number;
  topP?: number;
  promptProfileVersion?: string;
  providerRunId?: string;
}) {
  if (input.sourceCanonContext.canonType === "PRIVATE_SIMULATION") {
    throw new CharacterAgentError("PRIVATE_SIMULATION_NESTING_BLOCKED", "私人模擬不能再啟動巢狀私人模擬。");
  }
  const participants = [...new Set(input.participantCharacterIds)];
  const turnBudget = Math.max(1, Math.min(input.turnBudget ?? DEFAULT_SIMULATION_TURN_BUDGET, MAX_SIMULATION_TURN_BUDGET));
  const sessionIdentity = {
    sourceCanonContextId: input.sourceCanonContext.canonContextId,
    participants,
    scenario: input.scenario,
    timelinePosition: input.timelinePosition,
    locationId: input.locationId,
    turnBudget,
    seed: input.seed,
  };
  const sessionId = `simulation:${(await sha256(stableStringify(sessionIdentity))).slice(0, 40)}`;
  const canonContext = await createCharacterCanonContext({
    projectId: input.sourceCanonContext.projectId,
    canonType: "PRIVATE_SIMULATION",
    novelRevision: input.sourceCanonContext.novelRevision,
    storyBibleVersion: input.sourceCanonContext.storyBibleVersion,
    dramaAdaptationRevision: input.sourceCanonContext.dramaAdaptationRevision,
    privateSimulationSessionId: sessionId,
    sourceCanonContextId: input.sourceCanonContext.canonContextId,
    branchId: input.sourceCanonContext.branchId,
    timelinePosition: input.timelinePosition,
    sourceCharacterRevisions: input.sourceCanonContext.sourceCharacterRevisions,
  });
  const session = await createCharacterSimulationSession({
    ...input,
    canonContext,
    participantCharacterIds: participants,
    turnBudget,
    sessionId,
  });
  return { canonContext, session };
}

export function nextScheduledCharacter(session: CharacterSimulationSession) {
  const minimum = Math.min(...session.participantCharacterIds.map((id) => session.fairnessCounter[id] ?? 0));
  const eligible = session.participantCharacterIds.filter((id) => (session.fairnessCounter[id] ?? 0) === minimum);
  const offset = Number.parseInt(session.seed.slice(0, 8).replace(/[^a-f0-9]/gi, "0") || "0", 16);
  return eligible[(session.currentTurn + offset) % eligible.length];
}

export function evaluateSimulationProgress(turns: CharacterSimulationTurn[]) {
  if (turns.length < 2) return {
    progress: true,
    duplicateAction: false,
    semanticRepetition: false,
    deadlock: false,
    livelock: false,
  };
  const current = turns.at(-1)!;
  const priorSameSpeaker = [...turns.slice(0, -1)].reverse().find((turn) => turn.speakerCharacterId === current.speakerCharacterId);
  const duplicateAction = Boolean(priorSameSpeaker && priorSameSpeaker.action.action === current.action.action);
  const semanticRepetition = Boolean(priorSameSpeaker
    && normalizeAction(priorSameSpeaker.action.action) === normalizeAction(current.action.action));
  const relationshipProgress = current.relationshipChangeCandidates.some((candidate) =>
    Object.values(candidate.delta).some((value) => value !== 0));
  const memoryProgress = current.memoryCandidates.length > 0;
  const recent = turns.slice(-NO_PROGRESS_LIMIT);
  const deadlock = recent.length >= NO_PROGRESS_LIMIT && recent.every((turn) =>
    turn.memoryCandidates.length === 0
    && turn.relationshipChangeCandidates.every((candidate) =>
      Object.values(candidate.delta).every((value) => value === 0)));
  const livelock = semanticRepetition;
  return {
    progress: !(duplicateAction || semanticRepetition || deadlock) && (relationshipProgress || memoryProgress),
    duplicateAction,
    semanticRepetition,
    deadlock,
    livelock,
  };
}

export function transitionSimulation(
  session: CharacterSimulationSession,
  status: Extract<CharacterSimulationStatus, "RUNNING" | "PAUSED" | "CANCELLED">,
) {
  const allowed: Record<CharacterSimulationStatus, CharacterSimulationStatus[]> = {
    READY: ["RUNNING", "CANCELLED"],
    RUNNING: ["PAUSED", "CANCELLED"],
    PAUSED: ["RUNNING", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
    DISCARDED: [],
    TIMED_OUT: [],
    FAILED: [],
  };
  if (!allowed[session.status].includes(status)) {
    throw new CharacterAgentError("SIMULATION_STATE_TRANSITION_INVALID", `不能從 ${session.status} 切換到 ${status}。`);
  }
  const now = new Date().toISOString();
  return {
    ...session,
    status,
    startedAt: status === "RUNNING" ? session.startedAt ?? now : session.startedAt,
    completedAt: status === "CANCELLED" ? now : session.completedAt,
    terminationCode: status === "CANCELLED" ? "CANCELLED" as const : session.terminationCode,
    parentRevision: session.revision,
    revision: session.revision + 1,
    updatedAt: now,
  };
}

export function discardCharacterSimulation(session: CharacterSimulationSession) {
  if (!["READY", "PAUSED", "COMPLETED", "CANCELLED", "TIMED_OUT", "FAILED"].includes(session.status)) {
    throw new CharacterAgentError("SIMULATION_DISCARD_INVALID", "執行中的模擬必須先取消，才能放棄結果。");
  }
  const now = new Date().toISOString();
  return {
    ...session,
    status: "DISCARDED" as const,
    parentRevision: session.revision,
    revision: session.revision + 1,
    updatedAt: now,
    completedAt: session.completedAt ?? now,
    canonicalMutation: 0 as const,
  };
}

export class CharacterSimulationConcurrencyGuard {
  private active = new Map<string, Promise<unknown>>();

  run<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const current = this.active.get(sessionId);
    if (current) return current as Promise<T>;
    const result = operation().finally(() => {
      if (this.active.get(sessionId) === result) this.active.delete(sessionId);
    });
    this.active.set(sessionId, result);
    return result;
  }
}
