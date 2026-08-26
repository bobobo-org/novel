"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClosedAgentExecutionResult } from "@/lib/novel-ai/closed-agent-os";
import type { Chapter, Character, CharacterRelationship, NovelProject, StoryBible, StoryState, World } from "@/lib/novel-ai/domain";
import { activeStoryCharacters, activeStoryWorlds } from "@/lib/novel-ai/domain/active-story-context";
import { isCharacterEraCompatible, suggestedCharacterPortrait } from "@/lib/novel-ai/character-portraits/assignment";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  executeStudioClosedAgent,
  getStudioClosedAgentOS,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import { stageStoryWorkspaceHandoff } from "@/lib/novel-ai/web/story-workspace-handoff";
import { evaluateNovelContinuityGate } from "@/lib/novel-ai/web/story-output-quality";
import { buildCharacterAgentProfile } from "@/lib/novel-ai/character-agent/profile-builder";
import { projectCharacterAgentState } from "@/lib/novel-ai/character-agent/state-projector";
import { createCharacterCanonContext } from "@/lib/novel-ai/character-agent/canon-context";
import { buildActorPerspectiveContext, buildCharacterActorContext, buildCharacterEvaluatorContext } from "@/lib/novel-ai/character-agent/perspective-context-builder";
import { falseBelief } from "@/lib/novel-ai/character-agent/belief-engine";
import { createCharacterRelationshipEdge } from "@/lib/novel-ai/character-agent/relationship-engine";
import {
  CHARACTER_PERSONALITY_AXIS_LABELS,
  buildCharacterDynamicsCandidate,
  calculateSocialNetworkComplexity,
  type CharacterDynamicsCandidate,
} from "@/lib/novel-ai/character-agent/character-dynamics-engine";
import { planPrivateCharacterArc } from "@/lib/novel-ai/character-agent/private-arc-planner";
import { CharacterSimulationConcurrencyGuard, createPrivateSimulationBundle, discardCharacterSimulation, transitionSimulation } from "@/lib/novel-ai/character-agent/turn-scheduler";
import { runCharacterSimulation } from "@/lib/novel-ai/character-agent/simulation-engine";
import { evaluateCharacterCandidate } from "@/lib/novel-ai/character-agent/character-evaluator";
import { mapCharacterCandidateToProposal } from "@/lib/novel-ai/character-agent/proposal-mapper";
import type {
  CharacterAgentEvaluation,
  CharacterAgentProfile,
  CharacterAgentState,
  CharacterBelief,
  CharacterCanonContext,
  CharacterKnowledgeRecord,
  CharacterMemory,
  CharacterPrivateArc,
  CharacterProposalEnvelope,
  CharacterRelationshipEdge,
  CharacterRelationshipEvent,
  RelationshipMetrics,
  CharacterSimulationSession,
  CharacterSimulationTurn,
  CharacterSourceReference,
  SourcedCharacterFact,
} from "@/lib/novel-ai/character-agent/types";
import CharacterPortraitImage from "../character-portrait";
import ProjectNavigation from "../project-navigation";
import { ProjectContextTabs } from "../project-context-tabs";
import styles from "./character-ai.module.css";

type WorkspaceData = {
  project: NovelProject;
  storyBible: StoryBible;
  storyStates: StoryState[];
  chapters: Chapter[];
  worlds: World[];
  characters: Character[];
  formalRelationships: CharacterRelationship[];
  profiles: CharacterAgentProfile[];
  states: CharacterAgentState[];
  knowledge: CharacterKnowledgeRecord[];
  beliefs: CharacterBelief[];
  memories: CharacterMemory[];
  relationships: CharacterRelationshipEdge[];
  relationshipEvents: CharacterRelationshipEvent[];
  privateArcs: CharacterPrivateArc[];
  simulations: CharacterSimulationSession[];
  turns: CharacterSimulationTurn[];
  evaluations: CharacterAgentEvaluation[];
  proposals: CharacterProposalEnvelope[];
};

const TIMELINE_POSITION = "present:0001";

function sourceReference(character: Character, excerpt: string): CharacterSourceReference {
  return {
    referenceId: `character:${character.id}:${character.revision}`,
    entityId: character.id,
    entityType: "character",
    sourceRevision: character.revision,
    excerpt: excerpt.slice(0, 1200),
    support: "SUPPORTED",
  };
}

function supported(values: string[] | undefined, character: Character): SourcedCharacterFact<string[]> {
  return values?.length
    ? { value: values, support: "SUPPORTED", sourceReferences: [sourceReference(character, values.join("；"))], risk: null }
    : { value: null, support: "UNKNOWN", sourceReferences: [], risk: "作者尚未提供直接來源。" };
}

function graphPosition(index: number, total: number) {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
  return { x: 300 + Math.cos(angle) * 205, y: 145 + Math.sin(angle) * 95 };
}

function verifiedCharacterRehearsal(result: ClosedAgentExecutionResult, context: {
  continuityExcerpt: string;
  activeCharacterNames: string[];
  offstageCharacterNames: string[];
}) {
  const candidate = result.candidate;
  const receipt = candidate.executionReceipt
    ?? candidate.cacheOrigin?.originExecutionReceipt
    ?? null;
  const prose = candidate.content
    .split(/(?:【|#{1,3}\s*)角色一致性檢查/u, 1)[0]
    ?.trim() ?? "";
  const continuityGate = evaluateNovelContinuityGate({
    prose,
    minimumHanCharacters: 550,
    minimumParagraphs: 4,
    minimumDialogueCount: 2,
    ...context,
  });
  return candidate.candidateOnly === true
    && candidate.canonicalMutationCount === 0
    && candidate.status === "awaiting-approval"
    && candidate.actualExecutor === candidate.backendId
    && receipt?.proofState === "verified"
    && receipt.backendId === candidate.backendId
    && receipt.actualExecutor === candidate.actualExecutor
    && receipt.modelId === candidate.modelId
    && receipt.modelDigest === candidate.modelDigest
    && receipt.contentDigest === candidate.contentDigest
    && continuityGate.passed;
}

export default function CharacterAgentWorkspace({ projectId }: { projectId: string }) {
  const simulationGuard = useRef(new CharacterSimulationConcurrencyGuard()).current;
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [canonContext, setCanonContext] = useState<CharacterCanonContext | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [perspective, setPerspective] = useState<{ allowed: CharacterKnowledgeRecord[]; denied: CharacterKnowledgeRecord[] } | null>(null);
  const [message, setMessage] = useState("角色只能使用他知道的資訊。");
  const [busy, setBusy] = useState(false);
  const [beliefText, setBeliefText] = useState("");
  const [scenario, setScenario] = useState("三位角色在同一場景交換彼此能公開的線索。");
  const [turnBudget, setTurnBudget] = useState("5");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [dynamicsCandidate, setDynamicsCandidate] = useState<CharacterDynamicsCandidate | null>(null);
  const [closedRehearsal, setClosedRehearsal] = useState<{
    candidateId: string;
    content: string;
    modelId: string;
    actualExecutor: string;
  } | null>(null);
  const closedRehearsalControllerRef = useRef<AbortController | null>(null);

  async function load() {
    const repository = createNovelRepository();
    const [project, bibles, storyStates, chapters, worlds, characters, formalRelationships, profiles, states, knowledge, beliefs, memories, relationships, relationshipEvents, privateArcs, simulations, turns, evaluations, proposals] = await Promise.all([
      repository.get<NovelProject>("projects", projectId),
      repository.list<StoryBible>("storyBibles", projectId),
      repository.list<StoryState>("storyStates", projectId),
      repository.list<Chapter>("chapters", projectId),
      repository.list<World>("worlds", projectId),
      repository.list<Character>("characters", projectId),
      repository.list<CharacterRelationship>("relationships", projectId),
      repository.list<CharacterAgentProfile>("characterAgentProfiles", projectId),
      repository.list<CharacterAgentState>("characterAgentStates", projectId),
      repository.list<CharacterKnowledgeRecord>("characterKnowledge", projectId),
      repository.list<CharacterBelief>("characterBeliefs", projectId),
      repository.list<CharacterMemory>("characterMemories", projectId),
      repository.list<CharacterRelationshipEdge>("characterRelationships", projectId),
      repository.list<CharacterRelationshipEvent>("characterRelationshipEvents", projectId),
      repository.list<CharacterPrivateArc>("characterPrivateArcs", projectId),
      repository.list<CharacterSimulationSession>("characterSimulations", projectId),
      repository.list<CharacterSimulationTurn>("characterSimulationTurns", projectId),
      repository.list<CharacterAgentEvaluation>("characterAgentEvaluations", projectId),
      repository.list<CharacterProposalEnvelope>("characterProposals", projectId),
    ]);
    if (!project || !bibles[0]) throw new Error("找不到作品或 Story Bible。");
    const context = await createCharacterCanonContext({
      projectId,
      canonType: "NOVEL_CANON",
      novelRevision: project.revision,
      storyBibleVersion: bibles[0].revision,
      timelinePosition: TIMELINE_POSITION,
      sourceCharacterRevisions: Object.fromEntries(characters.map((character) => [character.id, character.revision])),
    });
    setCanonContext(context);
    const storyState = storyStates.find((item) => item.id === project.storyStateId) ?? storyStates[0] ?? null;
    const activeWorlds = activeStoryWorlds(worlds, storyState, bibles[0]);
    const stagedCharacters = storyState?.activeWorldId !== undefined && !activeWorlds.length
      ? []
      : activeStoryCharacters(characters, storyState, bibles[0])
        .filter((character) => isCharacterEraCompatible({ character, project, worlds: activeWorlds }));
    setData({ project, storyBible: bibles[0], storyStates, chapters, worlds, characters, formalRelationships, profiles, states, knowledge, beliefs, memories, relationships, relationshipEvents, privateArcs, simulations, turns, evaluations, proposals });
    setSelectedCharacterId((current) => current && stagedCharacters.some((character) => character.id === current) ? current : stagedCharacters[0]?.id ?? "");
    setParticipantIds((current) => current.length ? current.filter((id) => stagedCharacters.some((character) => character.id === id)) : stagedCharacters.slice(0, 3).map((character) => character.id));
    setSelectedSessionId((current) => current && simulations.some((session) => session.sessionId === current) ? current : simulations.at(-1)?.sessionId ?? "");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => setMessage(error instanceof Error ? error.message : "角色 AI 載入失敗。"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!data || !canonContext || !selectedCharacterId) return;
    let cancelled = false;
    void buildActorPerspectiveContext({
      projectId,
      characterId: selectedCharacterId,
      timelinePosition: canonContext.timelinePosition,
      knowledge: data.knowledge,
      factionIdsAtTimeline: data.characters.find((character) => character.id === selectedCharacterId)?.factionIds ?? [],
      revealedConditionIds: [],
      canonContext,
    }).then((result) => {
      if (cancelled) return;
      const allowed = new Set(result.context.allowedKnowledgeIds);
      setPerspective({
        allowed: data.knowledge.filter((record) => allowed.has(record.knowledgeId)),
        denied: data.knowledge.filter((record) => !allowed.has(record.knowledgeId)),
      });
    });
    return () => { cancelled = true; };
  }, [canonContext, data, projectId, selectedCharacterId]);

  const activeStoryState = data?.storyStates.find((item) => item.id === data.project.storyStateId)
    ?? data?.storyStates[0]
    ?? null;
  const activeWorlds = data
    ? activeStoryWorlds(data.worlds, activeStoryState, data.storyBible)
    : [];
  const stagedCharacters = data
    ? activeStoryState?.activeWorldId !== undefined && !activeWorlds.length
      ? []
      : activeStoryCharacters(data.characters, activeStoryState, data.storyBible)
        .filter((character) => isCharacterEraCompatible({ character, project: data.project, worlds: activeWorlds }))
    : [];
  const stagedCharacterIds = new Set(stagedCharacters.map((character) => character.id));
  const selectedCharacter = stagedCharacters.find((character) => character.id === selectedCharacterId) ?? null;
  const selectedProfile = data?.profiles.filter((profile) => profile.characterId === selectedCharacterId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  const selectedState = data?.states.filter((state) => state.characterId === selectedCharacterId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  const selectedSession = data?.simulations.find((session) => session.sessionId === selectedSessionId) ?? null;
  const sessionTurns = useMemo(
    () => data?.turns.filter((turn) => turn.sessionId === selectedSessionId).sort((a, b) => a.turnNumber - b.turnNumber) ?? [],
    [data, selectedSessionId],
  );
  const socialComplexity = data ? calculateSocialNetworkComplexity({
    characterIds: stagedCharacters.map((character) => character.id),
    edges: data.relationships.filter((edge) => (
      stagedCharacterIds.has(edge.fromCharacterId) && stagedCharacterIds.has(edge.toCharacterId)
    )).map((edge) => ({
      fromCharacterId: edge.fromCharacterId,
      toCharacterId: edge.toCharacterId,
      metrics: {
        trust: edge.trust,
        affection: edge.affection,
        attraction: edge.attraction,
        fear: edge.fear,
        resentment: edge.resentment,
        loyalty: edge.loyalty,
        debt: edge.debt,
        dependency: edge.dependency,
        conflict: edge.conflict,
        powerBalance: edge.powerBalance,
      } satisfies RelationshipMetrics,
    })),
  }) : null;

  function generateDynamicsCandidate() {
    if (!data) return;
    const candidate = buildCharacterDynamicsCandidate({
      projectId,
      characters: stagedCharacters,
      existingRelationships: data.relationships,
      playthroughSeed: crypto.randomUUID(),
    });
    setDynamicsCandidate(candidate);
    setMessage(`已產生 ${candidate.profiles.length} 位人物能力／個性與 ${candidate.relationships.length} 條朋友圈候選；Canonical mutation = 0。`);
  }

  async function syncProfiles() {
    if (!data || !canonContext || !stagedCharacters.length) return;
    setBusy(true);
    try {
      const repository = createNovelRepository();
      const formalRelationshipIds = new Set(data.formalRelationships.map((relationship) => relationship.id));
      const staleDerivedRelationships = data.relationships.filter((edge) => {
        const formalReferences = edge.sourceReferences.filter((reference) => reference.entityType === "relationship");
        return formalReferences.length > 0
          && formalReferences.every((reference) => !formalRelationshipIds.has(reference.entityId));
      });
      const staleRelationshipIds = new Set(staleDerivedRelationships.flatMap((edge) => [edge.id, edge.relationshipId]));
      for (const event of data.relationshipEvents) {
        if (staleRelationshipIds.has(event.relationshipId)) {
          await repository.remove("characterRelationshipEvents", event.id);
        }
      }
      for (const edge of staleDerivedRelationships) {
        await repository.remove("characterRelationships", edge.id);
      }
      const retainedRelationships = data.relationships.filter((edge) => !staleRelationshipIds.has(edge.id));
      const synchronizedRelationships = [...retainedRelationships.filter((edge) => (
        stagedCharacterIds.has(edge.fromCharacterId) && stagedCharacterIds.has(edge.toCharacterId)
      ))];
      for (const relationship of data.formalRelationships.filter((edge) => (
        stagedCharacterIds.has(edge.fromCharacterId) && stagedCharacterIds.has(edge.toCharacterId)
      ))) {
        const current = retainedRelationships.find((edge) => edge.sourceReferences.some((reference) => (
          reference.entityType === "relationship" && reference.entityId === relationship.id
        ))) ?? null;
        const derived = createCharacterRelationshipEdge({
          canonContext,
          fromCharacterId: relationship.fromCharacterId,
          toCharacterId: relationship.toCharacterId,
          relationshipTypes: [relationship.kind],
          metrics: { trust: relationship.trust ?? 0 },
          publicStatus: relationship.summary,
          privateStatus: "由首頁正式關係同步的角色視角資料；不另建 Canon。",
          knownByCharacterIds: [relationship.fromCharacterId, relationship.toCharacterId],
          sourceReferences: [{
            referenceId: `relationship:${relationship.id}:${relationship.revision}`,
            entityId: relationship.id,
            entityType: "relationship",
            sourceRevision: relationship.revision,
            excerpt: `${relationship.kind}｜${relationship.summary}`.slice(0, 1_200),
            support: "SUPPORTED",
          }],
        });
        const saved = await repository.put<CharacterRelationshipEdge>("characterRelationships", current ? {
          ...derived,
          id: current.id,
          relationshipId: current.relationshipId,
          revision: current.revision,
          createdAt: current.createdAt,
        } : derived, current?.revision);
        const index = synchronizedRelationships.findIndex((edge) => edge.id === saved.id);
        if (index >= 0) synchronizedRelationships[index] = saved;
        else synchronizedRelationships.push(saved);
      }
      for (const character of stagedCharacters) {
        const current = data.profiles.find((profile) => profile.characterId === character.id);
        const built = buildCharacterAgentProfile({
          project: data.project,
          storyBible: data.storyBible,
          character,
          sourceStoryRevision: data.project.revision,
          age: character.age ?? null,
          ageVerified: character.ageVerified ?? false,
          factionIds: character.factionIds ?? [],
          personalityTraits: supported([
            ...(character.personality.value ? [character.personality.value] : []),
            ...(character.dynamicsProfile?.personalityTraits ?? []),
          ], character),
          values: supported(character.values, character),
          fears: supported(character.fears, character),
          capabilities: supported(character.capabilities, character),
          limitations: supported(character.limitations, character),
          motives: supported(character.privateSecrets, character),
          privateBoundaries: character.privateSecrets ?? [],
          voiceProfile: character.voiceStyle,
          adultModeEnabled: data.project.adultMode,
          adultOptedIn: false,
        });
        const profile = current ? { ...built, id: current.id, profileId: current.profileId, revision: current.revision, createdAt: current.createdAt } : built;
        const saved = await repository.put("characterAgentProfiles", profile, current?.revision);
        const currentState = data.states.find((state) => state.characterId === character.id && state.canonContextId === canonContext.canonContextId);
        const projected = projectCharacterAgentState({
          projectId,
          sourceRevision: data.project.revision,
          timelinePosition: canonContext.timelinePosition,
          character,
          profile: saved,
          canonContext,
          beliefs: data.beliefs,
          memories: data.memories,
          relationships: synchronizedRelationships,
          privateArcs: data.privateArcs,
          knownKnowledgeIds: perspective?.allowed.map((record) => record.knowledgeId) ?? [],
        });
        await repository.put("characterAgentStates", currentState ? { ...projected, id: currentState.id, stateId: currentState.stateId, revision: currentState.revision, createdAt: currentState.createdAt } : projected, currentState?.revision);
      }
      setMessage("角色 AI 檔案已依作者確認的資料同步；未知欄位保持未知。");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function addBelief(event: React.FormEvent) {
    event.preventDefault();
    if (!canonContext || !selectedCharacterId || !beliefText.trim()) return;
    const belief = falseBelief(projectId, selectedCharacterId, beliefText.trim(), 75, [], canonContext.canonContextId, TIMELINE_POSITION);
    await createNovelRepository().put("characterBeliefs", belief);
    setBeliefText("");
    setMessage("已保存為角色信念；它不會改變 Canonical Truth。");
    await load();
  }

  async function addPrivateArc() {
    if (!canonContext || !selectedProfile || !data) return;
    const arc = planPrivateCharacterArc({
      canonContext,
      profile: selectedProfile,
      relationships: data.relationships,
      secret: selectedCharacter?.privateSecrets?.[0],
    });
    await createNovelRepository().put("characterPrivateArcs", arc);
    setMessage("私人故事線已建立。這段內容尚未套用。");
    await load();
  }

  async function startSimulation() {
    if (!data || !canonContext || participantIds.length < 2) {
      setMessage("請先選擇至少兩位已有角色 AI 檔案的角色。");
      return;
    }
    const profiles = participantIds.map((id) => data.profiles.find((profile) => profile.characterId === id)).filter((profile): profile is CharacterAgentProfile => Boolean(profile));
    if (profiles.length !== participantIds.length) {
      setMessage("請先同步全部角色 AI 檔案。");
      return;
    }
    setBusy(true);
    try {
      const bundle = await createPrivateSimulationBundle({
        sourceCanonContext: canonContext,
        participantCharacterIds: participantIds,
        scenario: scenario.trim(),
        timelinePosition: TIMELINE_POSITION,
        locationId: data.characters.find((character) => participantIds.includes(character.id))?.locationId ?? null,
        turnBudget: Number(turnBudget),
        timeoutMs: 30_000,
        seed: crypto.randomUUID(),
        providerId: "deterministic-local",
      });
      const repository = createNovelRepository();
      const savedSession = await repository.put("characterSimulations", bundle.session);
      const states = profiles.map((profile) => {
        const character = data.characters.find((item) => item.id === profile.characterId)!;
        return projectCharacterAgentState({
          projectId,
          sourceRevision: data.project.revision,
          timelinePosition: TIMELINE_POSITION,
          character,
          profile,
          canonContext: bundle.canonContext,
          beliefs: data.beliefs,
          memories: data.memories,
          relationships: data.relationships,
          privateArcs: data.privateArcs,
        });
      });
      const result = await runCharacterSimulation({
        session: savedSession,
        canonContext: bundle.canonContext,
        profiles,
        states,
        knowledge: data.knowledge,
        beliefs: data.beliefs,
        memories: data.memories,
        relationships: data.relationships,
        maxTurns: 1,
      });
      await repository.put("characterSimulations", result.session, savedSession.revision);
      for (const turn of result.turns) await repository.put("characterSimulationTurns", turn);
      setSelectedSessionId(result.sessionId);
      setMessage("私人模擬已開始並暫停在第一回合；可繼續到設定回合數。");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function resumeSimulation() {
    if (!data || !selectedSession || !selectedSession.privateMode || !["PAUSED", "READY"].includes(selectedSession.status)) return;
    return simulationGuard.run(selectedSession.sessionId, async () => {
    const privateContext = selectedSession.canonContext;
    const profiles = selectedSession.participantCharacterIds.map((id) => data.profiles.find((profile) => profile.characterId === id)).filter((profile): profile is CharacterAgentProfile => Boolean(profile));
    const states = profiles.map((profile) => projectCharacterAgentState({
      projectId,
      sourceRevision: data.project.revision,
      timelinePosition: selectedSession.timelinePosition,
      character: data.characters.find((character) => character.id === profile.characterId)!,
      profile,
      canonContext: privateContext,
      beliefs: data.beliefs,
      memories: data.memories,
      relationships: data.relationships,
      privateArcs: data.privateArcs,
    }));
    setBusy(true);
    try {
      const result = await runCharacterSimulation({
        session: selectedSession,
        canonContext: privateContext,
        profiles,
        states,
        knowledge: data.knowledge,
        beliefs: data.beliefs,
        memories: data.memories,
        relationships: data.relationships,
        existingTurns: sessionTurns,
        maxTurns: selectedSession.turnBudget,
      });
      const repository = createNovelRepository();
      await repository.put("characterSimulations", result.session, selectedSession.revision);
      for (const turn of result.turns.filter((turn) => !sessionTurns.some((existing) => existing.turnId === turn.turnId))) {
        await repository.put("characterSimulationTurns", turn);
      }
      setMessage(result.session.terminationCode === "NO_PROGRESS_TERMINATION" ? "模擬因連續沒有進展而安全停止。" : "私人模擬已完成；所有內容仍是候選。");
      await load();
    } finally {
      setBusy(false);
    }
    });
  }

  async function cancelSimulation() {
    if (!selectedSession || !["READY", "RUNNING", "PAUSED"].includes(selectedSession.status)) return;
    const cancelled = transitionSimulation(selectedSession, "CANCELLED");
    await createNovelRepository().put("characterSimulations", cancelled, selectedSession.revision);
    setMessage("已取消私人模擬；正式故事、角色與關係都未被修改。");
    await load();
  }

  async function pauseSimulation() {
    if (!selectedSession) return;
    if (selectedSession.status === "PAUSED") {
      setMessage("模擬已暫停；可安全繼續或取消。");
      return;
    }
    if (!["READY", "RUNNING"].includes(selectedSession.status)) return;
    const running = selectedSession.status === "READY"
      ? transitionSimulation(selectedSession, "RUNNING")
      : selectedSession;
    const paused = transitionSimulation(running, "PAUSED");
    await createNovelRepository().put("characterSimulations", paused, selectedSession.revision);
    setMessage("模擬已暫停；可安全繼續或取消。");
    await load();
  }

  async function discardSimulation() {
    if (!selectedSession || selectedSession.status === "RUNNING" || selectedSession.status === "DISCARDED") return;
    const discarded = discardCharacterSimulation(selectedSession);
    await createNovelRepository().put("characterSimulations", discarded, selectedSession.revision);
    setMessage("已放棄私人模擬；正式故事、角色與關係都未被修改。");
    await load();
  }

  async function turnIntoProposal() {
    if (!data || !selectedSession || !sessionTurns.length || !canonContext) return;
    const turn = sessionTurns.at(-1)!;
    const profile = data.profiles.find((item) => item.characterId === turn.speakerCharacterId);
    const character = data.characters.find((item) => item.id === turn.speakerCharacterId);
    if (!profile || !character) return;
    const privateContext = selectedSession.canonContext;
    const state = projectCharacterAgentState({
      projectId,
      sourceRevision: data.project.revision,
      timelinePosition: selectedSession.timelinePosition,
      character,
      profile,
      canonContext: privateContext,
      beliefs: data.beliefs,
      memories: data.memories,
      relationships: data.relationships,
      privateArcs: data.privateArcs,
    });
    const actor = await buildCharacterActorContext({
      canonContext: privateContext,
      characterId: character.id,
      knowledge: data.knowledge,
      beliefs: data.beliefs,
      memories: data.memories,
      goals: state.activeGoals,
      relationships: data.relationships,
      observableEvents: [selectedSession.scenario],
      allowedWorldRules: [],
      allowedSceneData: [selectedSession.scenario],
    });
    const evaluator = await buildCharacterEvaluatorContext({
      canonContext: privateContext,
      characterId: character.id,
      knowledge: data.knowledge,
      futureForeshadowing: data.storyBible.foreshadowing,
      globalTimeline: [],
      privateCharacterData: [],
      consistencyConstraints: data.storyBible.forbiddenContradictions,
      evaluatorAuthorized: true,
    });
    const evaluation = evaluateCharacterCandidate({
      projectId,
      proposalId: null,
      profile,
      state,
      actorContext: actor,
      evaluatorContext: evaluator,
      actions: [turn.action],
      dialogues: turn.dialogue ? [turn.dialogue] : [],
    });
    const proposal = mapCharacterCandidateToProposal({
      canonContext: privateContext,
      proposalType: "MULTI_CHARACTER_SCENE",
      characterIds: selectedSession.participantCharacterIds,
      sourceCharacterRevisions: privateContext.sourceCharacterRevisions,
      sourceEntityIds: [selectedSession.sessionId, turn.turnId],
      generatedPayload: {
        decisionSummary: turn.decisionSummary,
        action: turn.action,
        dialogue: turn.dialogue,
        knownEvidenceIds: turn.knownEvidenceIds,
        uncertainty: turn.uncertainty,
      },
      detectedChanges: ["PROMOTE_PRIVATE_SIMULATION_RESULT_CANDIDATE"],
      knowledgeScopeImpact: turn.allowedKnowledgeIds,
      relationshipImpact: Object.fromEntries(turn.relationshipChangeCandidates.map((item) => [item.relationshipId, item.delta])),
      canonicalPatch: { targetLayer: "NOVEL_CANON", entityType: "character", entityId: character.id, changes: {} },
      evaluation,
    });
    const repository = createNovelRepository();
    await repository.put("characterAgentEvaluations", evaluation);
    await repository.put("characterProposals", proposal);
    setMessage("私人結果已轉為候選。核准前不會修改正式故事。");
    await load();
  }

  async function rejectProposal(proposal: CharacterProposalEnvelope) {
    try {
      await createNovelRepository().rejectCharacterProposalTransaction({
        projectId,
        proposalId: proposal.proposalId,
        expectedProposalRevision: proposal.revision,
        expectedCanonContextId: proposal.canonContext.canonContextId,
        rejectedBy: "user",
      });
      setMessage("候選已放棄；正式內容未變更。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "候選已更新，請重新載入。");
    }
  }

  async function runClosedCharacterRehearsal() {
    if (!data || !selectedCharacter || busy || !scenario.trim()) return;
    setBusy(true);
    setMessage("閉端 AI 正在讀取目前章尾、上場人物、角色可知資訊、誤信與關係，撰寫私人小說試演候選……");
    const controller = new AbortController();
    closedRehearsalControllerRef.current?.abort("CHARACTER_REHEARSAL_REPLACED");
    closedRehearsalControllerRef.current = controller;
    try {
      if (closedRehearsal?.candidateId) {
        await getStudioClosedAgentOS().rejectCandidate(closedRehearsal.candidateId).catch(() => undefined);
      }
      const requestedParticipantIds = new Set([selectedCharacter.id, ...participantIds]);
      const participantCharacters = stagedCharacters
        .filter((character) => requestedParticipantIds.has(character.id));
      const participants = participantCharacters.map((character) => character.name);
      const result = await executeStudioClosedAgent({
        taskId: `character-rehearsal:${crypto.randomUUID()}`,
        projectId,
        taskType: participants.length > 1 ? "character.multiAgentSimulation" : "character.dialogue",
        characterId: selectedCharacter.id,
        characterIds: participantCharacters.map((character) => character.id),
        objective: [
          `以「${selectedCharacter.name}」的有限視角，為下列場景撰寫一段可直接閱讀的繁體中文小說試演候選：${scenario.trim()}`,
          `上場人物：${participants.join("、") || selectedCharacter.name}。`,
          "先承接目前正式章節最後發生的行動與因果；不要重新介紹整個世界，也不要跳過前一個結果。",
          "正文須有具體場景、人物動作、至少兩次推動情節的自然對話、不同角色的語氣與未說出口的張力；結尾留下由本段行動自然造成的後續鉤子。",
          "角色只能使用其可知資訊；不知道的秘密不得突然說出，錯誤信念可影響判斷但不可改寫正式真相。",
          "不要輸出規則模板、摘要式填字或空泛建議。先輸出 700 至 1400 字的【小說試演候選】，再用不超過四點的【角色一致性檢查】列出所依據的目標、記憶邊界、關係與仍不確定之處。",
          "這只是私人候選，不得宣稱已寫入正文、Story Bible 或 Canon。",
        ].join("\n"),
        storyBibleRevision: "current",
        knowledgeScopeRevision: "current",
        contextTokenBudget: 6_144,
        qualityMode: "deep",
        browserComputePolicy: "quality-first",
        allowPreAuthorizedClosedEscalation: false,
        generationOptions: {
          maxTokens: 2_200,
          temperature: 0.72,
          topP: 0.9,
          repetitionPenalty: 1.12,
        },
        signal: controller.signal,
        onProgress: (event) => setMessage(event.label),
      });
      const activeChapter = data.chapters.find((chapter) => chapter.id === data.project.activeChapterId)
        ?? [...data.chapters].sort((left, right) => left.order - right.order).at(-1)
        ?? null;
      if (!verifiedCharacterRehearsal(result, {
        continuityExcerpt: activeChapter?.content ?? "",
        activeCharacterNames: stagedCharacters.map((character) => character.name),
        offstageCharacterNames: data.characters
          .filter((character) => !stagedCharacterIds.has(character.id))
          .map((character) => character.name),
      })) {
        await getStudioClosedAgentOS().rejectCandidate(result.candidate.id).catch(() => undefined);
        throw Object.assign(new Error("Character rehearsal did not pass the readable-prose gate."), {
          code: "CLOSED_CHARACTER_REHEARSAL_INCOMPLETE",
        });
      }
      setClosedRehearsal({
        candidateId: result.candidate.id,
        content: result.candidate.content,
        modelId: result.candidate.modelId,
        actualExecutor: result.candidate.actualExecutor,
      });
      setMessage("真正閉端 AI 的小說試演候選已完成；尚未修改正文或 Canon。 ");
    } catch (cause) {
      setClosedRehearsal(null);
      const code = cause && typeof cause === "object" && "code" in cause
        ? String((cause as { code?: unknown }).code ?? "CLOSED_CHARACTER_REHEARSAL_FAILED")
        : "CLOSED_CHARACTER_REHEARSAL_FAILED";
      setMessage(code === "CLOSED_CHARACTER_REHEARSAL_INCOMPLETE"
        ? "閉端模型有回應，但篇幅、段落、自然對話或執行證明未達小說試演門檻；不完整輸出已擋下，也沒有修改正文。"
        : `閉端 AI 未完成（${code}）；沒有用規則後備冒充小說成品，也沒有修改正文。`);
    } finally {
      if (closedRehearsalControllerRef.current === controller) closedRehearsalControllerRef.current = null;
      setBusy(false);
    }
  }

  async function discardClosedCharacterRehearsal() {
    if (!closedRehearsal) return;
    await getStudioClosedAgentOS().rejectCandidate(closedRehearsal.candidateId).catch(() => undefined);
    setClosedRehearsal(null);
    setMessage("小說試演候選已放棄；正式內容未變更。 ");
  }

  function handoffClosedCharacterRehearsal() {
    if (!closedRehearsal) return;
    try {
      const { href } = stageStoryWorkspaceHandoff({
        projectId,
        source: "character-ai",
        prompt: [
          "請把以下私人角色試演當作候選參考，先檢查是否承接目前章尾、角色可知資訊與 Canon，再重寫成完整、連貫且可直接閱讀的繁體中文小說段落。",
          "不要直接採用其中未核准的設定；不要輸出分析模板或摘要式填字。",
          "",
          closedRehearsal.content,
        ].join("\n"),
      });
      window.location.assign(href);
    } catch {
      setMessage("瀏覽器阻擋同分頁安全交接；候選沒有放進網址，也沒有遺失。請保留此頁或手動複製後重試。");
    }
  }

  if (!data || !canonContext) return <main className="p2ProjectShell"><p role="status">{message === "角色只能使用他知道的資訊。" ? "正在載入角色 AI…" : message}</p></main>;
  const points = Object.fromEntries(stagedCharacters.map((character, index) => [character.id, graphPosition(index, stagedCharacters.length)]));
  const displayedComplexity = dynamicsCandidate?.complexity ?? socialComplexity;
  const selectedDynamicsCandidate = dynamicsCandidate?.profiles.find((profile) => profile.characterId === selectedCharacterId) ?? null;

  return (
    <main className="p2ProjectShell">
      <header><Link href={`/professional?intent=library&projectId=${encodeURIComponent(projectId)}#character-world-memory-home`}>← 首頁正式設定</Link><div><small>{data.project.title}</small><h1>角色視角模擬</h1></div><span>私人試演，不等於正式人物資料</span></header>
      <ProjectNavigation projectId={projectId} active="character-ai" />
      <ProjectContextTabs projectId={projectId} context="people-world" active="character-ai" />
      <section className={`${styles.root} characterAgentWorkspace`} data-testid="character-agent-workspace">
        <header className="characterAgentIntro">
          <div><span>CHARACTER PERSPECTIVE · PRIVATE REHEARSAL</span><h2>從角色自己的視角探索下一步</h2><p>首頁的「角色、世界與記憶」保存客觀 Canon；這裡只模擬角色依目前所知、誤信、目標與關係會如何說話及行動。私人試演與候選不會直接修改正式故事。</p></div>
          <button disabled={busy || !stagedCharacters.length} onClick={() => void syncProfiles()}>同步上場角色 AI 檔案</button>
        </header>
        <p className="characterAgentStatus" role="status">{message}</p>
        {!stagedCharacters.length ? <section className="characterEmpty"><h2>目前沒有可試演的上場角色</h2><p>請先在首頁正式設定中加入與目前世界時代相容的角色；候場或跨時代不相容人物不會進入角色 AI。</p><Link href={`/professional?intent=library&projectId=${encodeURIComponent(projectId)}#character-world-memory-home`}>回首頁選擇上場角色</Link></section> : (
          <>
            <section className="characterSelector" aria-label="選擇角色">
              {stagedCharacters.map((character) => <button key={character.id} className={selectedCharacterId === character.id ? "active" : ""} onClick={() => setSelectedCharacterId(character.id)}><CharacterPortraitImage portrait={suggestedCharacterPortrait({ character, project: data.project, worlds: activeWorlds })} className="characterSelectorPortrait" decorative /><b>{character.name}</b><small>{character.goal.value || "目標尚未設定"}</small></button>)}
            </section>

            <section className="characterOverview">
              <article><small>目前狀態</small><h3>{selectedState?.lifeStatus === "dead" ? "已死亡（不能進行當前行動）" : selectedState?.locationId || selectedCharacter?.locationId || "位置未知"}</h3><p>{selectedProfile ? "角色檔案已同步" : "尚未同步角色 AI 檔案"}</p></article>
              <article><small>角色目標</small><h3>{selectedProfile?.goals.value?.[0] || selectedCharacter?.goal.value || "尚未設定"}</h3><p>只有作者支持的目標會成為硬限制。</p></article>
              <article><small>角色語氣</small><h3>{selectedProfile ? `${selectedProfile.voiceProfile.sentenceLength === "short" ? "簡短" : selectedProfile.voiceProfile.sentenceLength === "long" ? "慎重完整" : "自然混合"}句型` : "尚未建立"}</h3><p>對話會檢查稱謂、正式程度與重複。</p></article>
              <article><small>核准外觀</small><h3>{selectedCharacter?.portrait?.role || "尚未設定"}</h3><p>{selectedCharacter?.portrait?.visualDescription || "選擇人像後，角色 AI 才會取得外觀特徵文字。"}</p></article>
              <article><small>私人故事線</small><h3>{data.privateArcs.filter((arc) => arc.characterId === selectedCharacterId).length} 條</h3><button disabled={!selectedProfile} onClick={() => void addPrivateArc()}>建立私人故事線</button></article>
            </section>

            <section className={styles.dynamicsLab} data-testid="character-dynamics-lab">
              <header><div><small>PRIVATE DYNAMICS PREVIEW · CANON 0</small><h2>個性與朋友圈私人試算</h2><p>只探索上場人物可能形成的社交張力，不建立能力值、不改正式關係。要修改客觀人物與關係，請回首頁正式設定。</p></div><div><button type="button" disabled={busy || !stagedCharacters.length} onClick={generateDynamicsCandidate}>重新試算候選</button><Link href={`/professional?intent=library&projectId=${encodeURIComponent(projectId)}#character-world-memory-home`}>回首頁管理 Canon</Link></div></header>
              {displayedComplexity ? <div className={styles.complexityGrid}><article><small>朋友圈</small><b>{displayedComplexity.label}</b><span>{displayedComplexity.complexityScore}/100</span></article><article><small>方向關係</small><b>{displayedComplexity.directedEdgeCount}</b><span>密度 {displayedComplexity.density}%</span></article><article><small>互惠程度</small><b>{displayedComplexity.reciprocity}%</b><span>三角連結 {displayedComplexity.triangleRatio}%</span></article><article><small>張力／凝聚</small><b>{displayedComplexity.tension}／{displayedComplexity.cohesion}</b><span>分化 {displayedComplexity.polarization}</span></article></div> : null}
              {selectedDynamicsCandidate ? <article className={styles.dynamicsCandidate}><header><div><small>私人預覽 · Canonical mutation = {dynamicsCandidate?.canonicalMutation}</small><h3>{selectedCharacter?.name}｜{selectedDynamicsCandidate.archetypeLabel}</h3></div><span>{selectedDynamicsCandidate.socialRole}</span></header><p>{selectedDynamicsCandidate.personalityTraits.join("、")}；需要：{selectedDynamicsCandidate.relationshipNeeds.join("、")}</p><div className={styles.axisGrid}>{Object.entries(selectedDynamicsCandidate.personalityAxes).map(([axis, value]) => <label key={axis}><span>{CHARACTER_PERSONALITY_AXIS_LABELS[axis as keyof typeof CHARACTER_PERSONALITY_AXIS_LABELS]}</span><progress max={100} value={value} /><b>{value}</b></label>)}</div><footer><span>不建立或覆蓋 RPG 能力</span><span>模擬關係 {dynamicsCandidate?.relationships.length ?? 0} 條</span></footer></article> : <p className={styles.dynamicsEmpty}>按「重新試算候選」後，這裡只顯示私人社交假設；正式人物、能力與關係維持不變。</p>}
            </section>

            <section className="knowledgeColumns">
              <article data-testid="known-knowledge"><h2>角色知道什麼</h2>{perspective?.allowed.length ? <ul>{perspective.allowed.map((record) => <li key={record.knowledgeId}>{record.claim}</li>)}</ul> : <p>目前沒有可用資訊。</p>}</article>
              <article data-testid="denied-knowledge"><h2>角色不知道什麼</h2>{perspective?.denied.length ? <ul>{perspective.denied.map((record) => <li key={record.knowledgeId}>這個秘密角色目前不知道 <small>（{record.scope}）</small></li>)}</ul> : <p>目前沒有被阻擋的資訊。</p>}</article>
            </section>

            <section className="setupGrid">
              <article><h2>客觀 Canon 在首頁管理</h2><p>姓名、能力、世界、公開關係與 Story Bible 只有一份正式來源；角色 AI 不再另建第二套正式資料。</p><Link href={`/professional?intent=library&projectId=${encodeURIComponent(projectId)}#character-world-memory-home`}>前往首頁正式設定</Link></article>
              <form onSubmit={(event) => void addBelief(event)}><h2>角色信念</h2><p>信念可以是錯的，不會改變正式真相。</p><label>角色目前相信<input value={beliefText} onChange={(event) => setBeliefText(event.target.value)} /></label><button type="submit">保存信念</button><ul>{data.beliefs.filter((belief) => belief.characterId === selectedCharacterId).map((belief) => <li key={belief.beliefId}>{belief.proposition} <small>{belief.beliefStatus}</small></li>)}</ul></form>
              <article><h2>視角資料只讀同步</h2><p>角色知道／不知道的資訊與視角關係由首頁正式資料和已發生章節投影而來；按上方同步不會改寫 Canon。</p><small>上場 {stagedCharacters.length} 人 · 視角關係 {data.relationships.filter((edge) => stagedCharacterIds.has(edge.fromCharacterId) && stagedCharacterIds.has(edge.toCharacterId)).length} 條</small></article>
            </section>

            <section className="relationshipSection">
              <header><div><h2>角色關係</h2><p>箭頭方向代表「前者如何看待後者」；反方向會獨立保存。</p></div></header>
              <svg className="relationshipGraph" viewBox="0 0 600 290" role="img" aria-label="有方向的角色關係圖">
                <defs><marker id="relationship-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" /></marker></defs>
                {data.relationships.filter((edge) => stagedCharacterIds.has(edge.fromCharacterId) && stagedCharacterIds.has(edge.toCharacterId)).map((edge) => {
                  const from = points[edge.fromCharacterId]; const to = points[edge.toCharacterId];
                  return from && to ? <line key={edge.relationshipId} x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#relationship-arrow)" /> : null;
                })}
                {stagedCharacters.map((character) => { const point = points[character.id]; return <g key={character.id}><circle cx={point.x} cy={point.y} r="38" /><text x={point.x} y={point.y + 5} textAnchor="middle">{character.name}</text></g>; })}
              </svg>
              <div className="relationshipList" aria-label="角色關係文字列表" data-testid="relationship-list">
                {data.relationships.some((edge) => stagedCharacterIds.has(edge.fromCharacterId) && stagedCharacterIds.has(edge.toCharacterId)) ? data.relationships.filter((edge) => stagedCharacterIds.has(edge.fromCharacterId) && stagedCharacterIds.has(edge.toCharacterId)).map((edge) => {
                  const from = stagedCharacters.find((character) => character.id === edge.fromCharacterId)?.name;
                  const to = stagedCharacters.find((character) => character.id === edge.toCharacterId)?.name;
                  const latest = data.relationshipEvents.filter((event) => event.relationshipId === edge.relationshipId).at(-1);
                  return <article key={edge.relationshipId}><h3>{from} → {to}</h3><p>{edge.relationshipTypes.join("、")}</p><dl><div><dt>信任</dt><dd>{edge.trust}</dd></div><div><dt>好感</dt><dd>{edge.affection}</dd></div><div><dt>吸引</dt><dd>{edge.attraction}</dd></div><div><dt>恐懼</dt><dd>{edge.fear}</dd></div><div><dt>衝突</dt><dd>{edge.conflict}</dd></div><div><dt>權力平衡</dt><dd>{edge.powerBalance}</dd></div></dl><small>{latest ? `最近變化：${latest.cause}` : "尚無核准後的關係歷史"}</small></article>;
                }) : <p>尚未建立方向關係。</p>}
              </div>
            </section>

            <section className="simulationSection">
              <header>
                <h2>私人場景試演</h2>
                <p>先用規則試算檢查資訊邊界、輪替與關係流；真正可閱讀的小說段落必須由下方已驗證的閉端 AI 產生，模型未完成時不會拿後備模板冒充。</p>
              </header>
              <div className="simulationSetup"><fieldset><legend>參與角色（只列目前上場且時代相容）</legend>{stagedCharacters.map((character) => <label key={character.id}><input type="checkbox" checked={participantIds.includes(character.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...new Set([...current, character.id])] : current.filter((id) => id !== character.id))} />{character.name}</label>)}</fieldset><label>場景與希望探索的矛盾<textarea value={scenario} onChange={(event) => setScenario(event.target.value)} /></label><label>規則試算回合數<input type="number" min="1" max="30" value={turnBudget} onChange={(event) => setTurnBudget(event.target.value)} /></label><div><button disabled={busy} onClick={() => void runClosedCharacterRehearsal()}>由真正閉端 AI 試演小說段落</button><button disabled={busy} onClick={() => void startSimulation()}>規則邊界試算（非 AI）</button><button disabled={busy || !selectedSession || !["READY", "RUNNING", "PAUSED"].includes(selectedSession.status)} onClick={() => void pauseSimulation()}>暫停規則試算</button><button disabled={busy || !selectedSession || !["PAUSED", "READY"].includes(selectedSession.status)} onClick={() => void resumeSimulation()}>繼續規則試算</button><button disabled={busy || !selectedSession || !["PAUSED", "READY", "RUNNING"].includes(selectedSession.status)} onClick={() => void cancelSimulation()}>取消</button></div></div>
              {closedRehearsal ? <article className={styles.closedRehearsal} data-testid="closed-character-rehearsal">
                <header><div><small>真正閉端 AI · 私人候選 · Canonical mutation = 0</small><h3>角色視角小說試演</h3></div><span>{closedRehearsal.actualExecutor} · {closedRehearsal.modelId}</span></header>
                <div>{closedRehearsal.content}</div>
                <footer><button type="button" onClick={handoffClosedCharacterRehearsal}>帶到故事工作台續寫</button><button type="button" onClick={() => void discardClosedCharacterRehearsal()}>放棄候選</button></footer>
              </article> : null}
              {data.simulations.length ? <label className="sessionPicker">模擬紀錄<select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>{data.simulations.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.status} · {session.currentTurn}/{session.turnBudget} 回合</option>)}</select></label> : null}
              <ol className="simulationTurns" data-testid="simulation-turns">{sessionTurns.map((turn) => <li key={turn.turnId}><header><b>第 {turn.turnNumber} 回合 · {data.characters.find((character) => character.id === turn.speakerCharacterId)?.name}</b><span>{turn.publicMessage ? "公開訊息" : "私人訊息"}</span></header><p>{turn.action.action}</p>{turn.dialogue ? <blockquote>{turn.dialogue.line}</blockquote> : null}<small>角色參考了 {turn.knownEvidenceIds.length} 筆已知資訊；Canonical mutation = {turn.canonicalMutation}</small></li>)}</ol>
              {selectedSession && sessionTurns.length ? <div className="simulationActions"><button disabled={selectedSession.status === "DISCARDED"} onClick={() => void turnIntoProposal()}>轉為候選</button><button disabled={selectedSession.status === "RUNNING" || selectedSession.status === "DISCARDED"} onClick={() => void discardSimulation()}>放棄模擬</button></div> : null}
            </section>

            <section className="proposalSection">
              <header><h2>待你決定的候選</h2><p>接受前都不會套用；有設定衝突時會阻擋核准。</p></header>
              {data.proposals.length ? data.proposals.map((proposal) => <article key={proposal.proposalId} data-testid="character-proposal"><div><small>{proposal.proposalType}</small><h3>{proposal.status === "ACCEPTED" ? "舊版已核准紀錄" : proposal.status === "REJECTED" ? "已放棄的角色候選" : "私人模擬轉成的參考候選"}</h3><p>{proposal.detectedChanges.join("、")}</p>{proposal.warnings.length ? <p className="proposalWarning">發現角色設定衝突：{proposal.warnings.join("；")}</p> : null}</div>{["GENERATED", "REVIEWING"].includes(proposal.status) ? <footer><Link href={`/professional?intent=library&projectId=${encodeURIComponent(projectId)}#character-world-memory-home`}>到首頁人工核准正式變更</Link><button onClick={() => void rejectProposal(proposal)}>放棄</button></footer> : <span>{proposal.status === "ACCEPTED" ? "歷史紀錄；目前版本不再由此頁寫入 Canon" : "正式內容未變更"}</span>}</article>) : <p>目前沒有待處理候選。</p>}
            </section>

            <details className="characterTechnical"><summary>查看技術資訊</summary><p>角色視角與全局檢查分開建立；被拒絕的秘密會保持受限制狀態。系統只保存可稽核的決策摘要，不保存內部推理草稿。</p></details>
          </>
        )}
      </section>
    </main>
  );
}
