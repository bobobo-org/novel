"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Character, NovelProject, StoryBible } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import { buildCharacterAgentProfile } from "@/lib/novel-ai/character-agent/profile-builder";
import { projectCharacterAgentState } from "@/lib/novel-ai/character-agent/state-projector";
import { createCharacterCanonContext } from "@/lib/novel-ai/character-agent/canon-context";
import { buildActorPerspectiveContext, buildCharacterActorContext, buildCharacterEvaluatorContext } from "@/lib/novel-ai/character-agent/perspective-context-builder";
import { falseBelief } from "@/lib/novel-ai/character-agent/belief-engine";
import { createCharacterRelationshipEdge } from "@/lib/novel-ai/character-agent/relationship-engine";
import { evaluateMatureNarrativeFormula } from "@/lib/novel-ai/character-agent/mature-narrative-formula";
import {
  CHARACTER_PERSONALITY_AXIS_LABELS,
  approveCharacterDynamicsProfile,
  buildCharacterDynamicsCandidate,
  calculateSocialNetworkComplexity,
  type CharacterDynamicsCandidate,
} from "@/lib/novel-ai/character-agent/character-dynamics-engine";
import { planPrivateCharacterArc } from "@/lib/novel-ai/character-agent/private-arc-planner";
import { CharacterSimulationConcurrencyGuard, createPrivateSimulationBundle, discardCharacterSimulation, transitionSimulation } from "@/lib/novel-ai/character-agent/turn-scheduler";
import { runCharacterSimulation } from "@/lib/novel-ai/character-agent/simulation-engine";
import { evaluateCharacterCandidate } from "@/lib/novel-ai/character-agent/character-evaluator";
import { mapCharacterCandidateToProposal } from "@/lib/novel-ai/character-agent/proposal-mapper";
import { characterProposalFingerprint } from "@/lib/novel-ai/character-agent/approval-service";
import { makeCharacterAgentRecord } from "@/lib/novel-ai/character-agent/record-factory";
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
import type { KnowledgeScope } from "@/lib/novel-ai/drama-os/knowledge-scope";
import CharacterPortraitImage from "../character-portrait";
import ProjectNavigation from "../project-navigation";
import styles from "./character-ai.module.css";

type WorkspaceData = {
  project: NovelProject;
  storyBible: StoryBible;
  characters: Character[];
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

export default function CharacterAgentWorkspace({ projectId }: { projectId: string }) {
  const simulationGuard = useRef(new CharacterSimulationConcurrencyGuard()).current;
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [canonContext, setCanonContext] = useState<CharacterCanonContext | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [perspective, setPerspective] = useState<{ allowed: CharacterKnowledgeRecord[]; denied: CharacterKnowledgeRecord[] } | null>(null);
  const [message, setMessage] = useState("角色只能使用他知道的資訊。");
  const [busy, setBusy] = useState(false);
  const [knowledgeClaim, setKnowledgeClaim] = useState("");
  const [knowledgeScope, setKnowledgeScope] = useState<KnowledgeScope>("PUBLIC");
  const [knowledgeFaction, setKnowledgeFaction] = useState("");
  const [revealCondition, setRevealCondition] = useState("");
  const [beliefText, setBeliefText] = useState("");
  const [relationshipTarget, setRelationshipTarget] = useState("");
  const [relationshipType, setRelationshipType] = useState("認識");
  const [trust, setTrust] = useState("0");
  const [affection, setAffection] = useState("0");
  const [scenario, setScenario] = useState("三位角色在同一場景交換彼此能公開的線索。");
  const [turnBudget, setTurnBudget] = useState("5");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [dynamicsCandidate, setDynamicsCandidate] = useState<CharacterDynamicsCandidate | null>(null);
  const [explicitConsent, setExplicitConsent] = useState(false);
  const [boundaryConfirmed, setBoundaryConfirmed] = useState(false);

  async function load() {
    const repository = createNovelRepository();
    const [project, bibles, characters, profiles, states, knowledge, beliefs, memories, relationships, relationshipEvents, privateArcs, simulations, turns, evaluations, proposals] = await Promise.all([
      repository.get<NovelProject>("projects", projectId),
      repository.list<StoryBible>("storyBibles", projectId),
      repository.list<Character>("characters", projectId),
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
    setData({ project, storyBible: bibles[0], characters, profiles, states, knowledge, beliefs, memories, relationships, relationshipEvents, privateArcs, simulations, turns, evaluations, proposals });
    setSelectedCharacterId((current) => current && characters.some((character) => character.id === current) ? current : characters[0]?.id ?? "");
    setParticipantIds((current) => current.length ? current.filter((id) => characters.some((character) => character.id === id)) : characters.slice(0, 3).map((character) => character.id));
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

  const selectedCharacter = data?.characters.find((character) => character.id === selectedCharacterId) ?? null;
  const relationshipTargetCharacter = data?.characters.find((character) => character.id === relationshipTarget) ?? null;
  const selectedProfile = data?.profiles.filter((profile) => profile.characterId === selectedCharacterId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  const selectedState = data?.states.filter((state) => state.characterId === selectedCharacterId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  const selectedSession = data?.simulations.find((session) => session.sessionId === selectedSessionId) ?? null;
  const sessionTurns = useMemo(
    () => data?.turns.filter((turn) => turn.sessionId === selectedSessionId).sort((a, b) => a.turnNumber - b.turnNumber) ?? [],
    [data, selectedSessionId],
  );
  const matureNarrativePreview = useMemo(() => {
    if (!data?.project.adultMode || !selectedCharacter || !relationshipTargetCharacter) return null;
    const safeNumber = (value: string) => Number.isFinite(Number(value)) ? Math.max(-100, Math.min(100, Number(value))) : 0;
    return evaluateMatureNarrativeFormula({
      projectAdultMode: data.project.adultMode,
      from: selectedCharacter,
      to: relationshipTargetCharacter,
      metrics: {
        trust: safeNumber(trust),
        affection: safeNumber(affection),
        attraction: 0,
        fear: 0,
        resentment: 0,
        loyalty: 0,
        debt: 0,
        dependency: 0,
        conflict: 0,
        powerBalance: 0,
      },
      explicitConsent,
      boundaryConfirmed,
    });
  }, [affection, boundaryConfirmed, data, explicitConsent, relationshipTargetCharacter, selectedCharacter, trust]);
  const socialComplexity = useMemo(() => data ? calculateSocialNetworkComplexity({
    characterIds: data.characters.map((character) => character.id),
    edges: data.relationships.map((edge) => ({
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
  }) : null, [data]);

  function generateDynamicsCandidate() {
    if (!data) return;
    const candidate = buildCharacterDynamicsCandidate({
      projectId,
      characters: data.characters,
      existingRelationships: data.relationships,
      playthroughSeed: crypto.randomUUID(),
    });
    setDynamicsCandidate(candidate);
    setMessage(`已產生 ${candidate.profiles.length} 位人物能力／個性與 ${candidate.relationships.length} 條朋友圈候選；Canonical mutation = 0。`);
  }

  async function approveDynamicsCandidate() {
    if (!data || !canonContext || !dynamicsCandidate || busy) return;
    setBusy(true);
    try {
      const repository = createNovelRepository();
      const approvedAt = new Date().toISOString();
      for (const profileCandidate of dynamicsCandidate.profiles) {
        const character = data.characters.find((item) => item.id === profileCandidate.characterId);
        if (!character) continue;
        const approved = approveCharacterDynamicsProfile(profileCandidate, dynamicsCandidate.playthroughSeed, approvedAt);
        await repository.put<Character>("characters", {
          ...character,
          dynamicsProfile: approved.dynamicsProfile,
          rpgProfile: character.rpgProfile ?? approved.rpgProfile,
        }, character.revision);
      }
      for (const relationship of dynamicsCandidate.relationships) {
        const from = data.characters.find((character) => character.id === relationship.fromCharacterId);
        const to = data.characters.find((character) => character.id === relationship.toCharacterId);
        if (!from || !to) continue;
        const edge = createCharacterRelationshipEdge({
          canonContext,
          fromCharacterId: from.id,
          toCharacterId: to.id,
          relationshipTypes: relationship.relationshipTypes,
          metrics: relationship.metrics,
          publicStatus: relationship.relationshipTypes.join("／"),
          privateStatus: `由角色動態引擎核准：${relationship.rationale}`,
          knownByCharacterIds: [from.id],
          sourceReferences: [sourceReference(from, `${from.name}對${to.name}的核准關係候選`)],
        });
        await repository.put("characterRelationships", edge);
      }
      setDynamicsCandidate(null);
      await load();
      setMessage("角色能力、個性與有方向朋友圈已核准；閉端 AI 只會讀取這批已核准資料。既有手動 RPG 數值未被覆蓋。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "角色動態候選核准失敗，正式資料未完整套用。");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function syncProfiles() {
    if (!data || !canonContext || !data.characters.length) return;
    setBusy(true);
    try {
      const repository = createNovelRepository();
      for (const character of data.characters) {
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
          relationships: data.relationships,
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

  async function addKnowledge(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !canonContext || !knowledgeClaim.trim()) return;
    const repository = createNovelRepository();
    const record = makeCharacterAgentRecord(projectId, "user");
    const knowledge: CharacterKnowledgeRecord = {
      ...record,
      id: record.id,
      knowledgeId: record.id,
      canonContextId: canonContext.canonContextId,
      subjectEntityIds: selectedCharacterId ? [selectedCharacterId] : [],
      claim: knowledgeClaim.trim(),
      canonicalTruthStatus: "UNKNOWN",
      scope: knowledgeScope,
      authorizedCharacterIds: knowledgeScope === "CHARACTER_KNOWN" && selectedCharacterId ? [selectedCharacterId] : [],
      authorizedFactionIds: knowledgeScope === "FACTION_KNOWN" && knowledgeFaction.trim() ? [knowledgeFaction.trim()] : [],
      revealConditionId: knowledgeScope === "FUTURE_REVEAL" ? revealCondition.trim() || "pending-reveal" : null,
      sourceReferences: [{
        referenceId: `story-bible:${data.storyBible.id}:${data.storyBible.revision}`,
        entityId: data.storyBible.id,
        entityType: "story_bible",
        sourceRevision: data.storyBible.revision,
        excerpt: knowledgeClaim.trim(),
        support: "SUPPORTED",
      }],
      confidence: 1,
      acquiredAt: null,
      usableAfterTimelinePosition: TIMELINE_POSITION,
      expiresAt: null,
      status: "CURRENT",
    };
    await repository.put("characterKnowledge", knowledge);
    setKnowledgeClaim("");
    setMessage("知識邊界已保存。角色只能讀取目前獲准的資訊。");
    await load();
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

  async function addRelationship(event: React.FormEvent) {
    event.preventDefault();
    if (!data || !canonContext || !selectedCharacter || !relationshipTarget || relationshipTarget === selectedCharacter.id) return;
    const target = data.characters.find((character) => character.id === relationshipTarget);
    if (!target) return;
    const edge = createCharacterRelationshipEdge({
      canonContext,
      fromCharacterId: selectedCharacter.id,
      toCharacterId: target.id,
      relationshipTypes: [relationshipType.trim() || "認識"],
      metrics: { trust: Number(trust), affection: Number(affection) },
      publicStatus: relationshipType.trim() || "認識",
      privateStatus: "由作者建立的起始關係",
      knownByCharacterIds: [selectedCharacter.id],
      sourceReferences: [sourceReference(selectedCharacter, `${selectedCharacter.name}對${target.name}的起始關係`)],
    });
    await createNovelRepository().put("characterRelationships", edge);
    setMessage("有方向的角色關係已保存；反方向關係保持獨立。");
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

  async function approveProposal(proposal: CharacterProposalEnvelope) {
    const fingerprint = await characterProposalFingerprint(proposal);
    try {
      await createNovelRepository().approveCharacterProposalTransaction({
        projectId,
        proposalId: proposal.proposalId,
        idempotencyKey: `character-approval:${proposal.proposalId}`,
        payloadFingerprint: fingerprint,
        expectedProposalRevision: proposal.revision,
        expectedSourceRevision: proposal.sourceRevision,
        expectedSourceStoryBibleVersion: proposal.sourceStoryBibleVersion,
        approvedBy: "user",
        expectedCanonContextId: proposal.canonContext.canonContextId,
      });
      setMessage("候選已核准；只套用明列的角色層變更。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "版本已更新，請重新產生。");
    }
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

  if (!data || !canonContext) return <main className="p2ProjectShell"><p role="status">{message === "角色只能使用他知道的資訊。" ? "正在載入角色 AI…" : message}</p></main>;
  const points = Object.fromEntries(data.characters.map((character, index) => [character.id, graphPosition(index, data.characters.length)]));
  const displayedComplexity = dynamicsCandidate?.complexity ?? socialComplexity;
  const selectedDynamicsCandidate = dynamicsCandidate?.profiles.find((profile) => profile.characterId === selectedCharacterId) ?? null;

  return (
    <main className="p2ProjectShell">
      <header><Link href="/studio">← 我的作品</Link><div><small>{data.project.title}</small><h1>角色 AI</h1></div><span>私人思考，核准後才套用</span></header>
      <ProjectNavigation projectId={projectId} active="character-ai" />
      <section className={`${styles.root} characterAgentWorkspace`} data-testid="character-agent-workspace">
        <header className="characterAgentIntro">
          <div><span>角色正在思考</span><h2>從角色自己的視角探索下一步</h2><p>角色只能使用他知道的資訊。模擬與候選不會直接修改正式故事。</p></div>
          <button disabled={busy || !data.characters.length} onClick={() => void syncProfiles()}>同步全部角色 AI 檔案</button>
        </header>
        <p className="characterAgentStatus" role="status">{message}</p>
        {!data.characters.length ? <section className="characterEmpty"><h2>先建立角色</h2><p>至少建立兩位角色後，就能探索不同視角與關係。</p><Link href={`/studio/project/${projectId}/characters`}>前往建立角色</Link></section> : (
          <>
            <section className="characterSelector" aria-label="選擇角色">
              {data.characters.map((character) => <button key={character.id} className={selectedCharacterId === character.id ? "active" : ""} onClick={() => setSelectedCharacterId(character.id)}>{character.portrait ? <CharacterPortraitImage portrait={character.portrait} className="characterSelectorPortrait" decorative /> : null}<b>{character.name}</b><small>{character.goal.value || "目標尚未設定"}</small></button>)}
            </section>

            <section className="characterOverview">
              <article><small>目前狀態</small><h3>{selectedState?.lifeStatus === "dead" ? "已死亡（不能進行當前行動）" : selectedState?.locationId || selectedCharacter?.locationId || "位置未知"}</h3><p>{selectedProfile ? "角色檔案已同步" : "尚未同步角色 AI 檔案"}</p></article>
              <article><small>角色目標</small><h3>{selectedProfile?.goals.value?.[0] || selectedCharacter?.goal.value || "尚未設定"}</h3><p>只有作者支持的目標會成為硬限制。</p></article>
              <article><small>角色語氣</small><h3>{selectedProfile ? `${selectedProfile.voiceProfile.sentenceLength === "short" ? "簡短" : selectedProfile.voiceProfile.sentenceLength === "long" ? "慎重完整" : "自然混合"}句型` : "尚未建立"}</h3><p>對話會檢查稱謂、正式程度與重複。</p></article>
              <article><small>核准外觀</small><h3>{selectedCharacter?.portrait?.role || "尚未設定"}</h3><p>{selectedCharacter?.portrait?.visualDescription || "選擇人像後，角色 AI 才會取得外觀特徵文字。"}</p></article>
              <article><small>私人故事線</small><h3>{data.privateArcs.filter((arc) => arc.characterId === selectedCharacterId).length} 條</h3><button disabled={!selectedProfile} onClick={() => void addPrivateArc()}>建立私人故事線</button></article>
            </section>

            <section className={styles.dynamicsLab} data-testid="character-dynamics-lab">
              <header><div><small>CLOSED BROWSER CHARACTER ENGINE</small><h2>角色能力、個性與朋友圈運算</h2><p>先產生候選，再由你核准；每次新周目 seed 都會重新排列關係與人物傾向，既有手動能力值不會被覆蓋。</p></div><div><button type="button" disabled={busy || !data.characters.length} onClick={generateDynamicsCandidate}>重新運算候選</button><button type="button" disabled={busy || !dynamicsCandidate} onClick={() => void approveDynamicsCandidate()}>核准能力與朋友圈</button></div></header>
              {displayedComplexity ? <div className={styles.complexityGrid}><article><small>朋友圈</small><b>{displayedComplexity.label}</b><span>{displayedComplexity.complexityScore}/100</span></article><article><small>方向關係</small><b>{displayedComplexity.directedEdgeCount}</b><span>密度 {displayedComplexity.density}%</span></article><article><small>互惠程度</small><b>{displayedComplexity.reciprocity}%</b><span>三角連結 {displayedComplexity.triangleRatio}%</span></article><article><small>張力／凝聚</small><b>{displayedComplexity.tension}／{displayedComplexity.cohesion}</b><span>分化 {displayedComplexity.polarization}</span></article></div> : null}
              {selectedDynamicsCandidate ? <article className={styles.dynamicsCandidate}><header><div><small>待核准 · Canonical mutation = {dynamicsCandidate?.canonicalMutation}</small><h3>{selectedCharacter?.name}｜{selectedDynamicsCandidate.archetypeLabel}</h3></div><span>{selectedDynamicsCandidate.socialRole}</span></header><p>{selectedDynamicsCandidate.personalityTraits.join("、")}；需要：{selectedDynamicsCandidate.relationshipNeeds.join("、")}</p><div className={styles.axisGrid}>{Object.entries(selectedDynamicsCandidate.personalityAxes).map(([axis, value]) => <label key={axis}><span>{CHARACTER_PERSONALITY_AXIS_LABELS[axis as keyof typeof CHARACTER_PERSONALITY_AXIS_LABELS]}</span><progress max={100} value={value} /><b>{value}</b></label>)}</div><footer><span>{selectedDynamicsCandidate.preservesApprovedRpgProfile ? "保留既有核准 RPG 數值" : "核准後建立 300 點 RPG 能力"}</span><span>候選關係 {dynamicsCandidate?.relationships.length ?? 0} 條</span></footer></article> : <p className={styles.dynamicsEmpty}>{selectedCharacter?.dynamicsProfile ? `已核准：${selectedCharacter.dynamicsProfile.archetypeLabel}／${selectedCharacter.dynamicsProfile.socialRole}` : "按「重新運算候選」後，這裡會顯示可檢查的能力、個性與朋友圈；尚未核准前正式資料不變。"}</p>}
            </section>

            <section className="knowledgeColumns">
              <article data-testid="known-knowledge"><h2>角色知道什麼</h2>{perspective?.allowed.length ? <ul>{perspective.allowed.map((record) => <li key={record.knowledgeId}>{record.claim}</li>)}</ul> : <p>目前沒有可用資訊。</p>}</article>
              <article data-testid="denied-knowledge"><h2>角色不知道什麼</h2>{perspective?.denied.length ? <ul>{perspective.denied.map((record) => <li key={record.knowledgeId}>這個秘密角色目前不知道 <small>（{record.scope}）</small></li>)}</ul> : <p>目前沒有被阻擋的資訊。</p>}</article>
            </section>

            <section className="setupGrid">
              <form onSubmit={(event) => void addKnowledge(event)}><h2>建立知識邊界</h2><label>資訊內容<textarea value={knowledgeClaim} onChange={(event) => setKnowledgeClaim(event.target.value)} /></label><label>誰可以知道<select value={knowledgeScope} onChange={(event) => setKnowledgeScope(event.target.value as KnowledgeScope)}><option value="PUBLIC">所有角色可知</option><option value="AUTHOR_ONLY">只有作者與檢查器</option><option value="CHARACTER_KNOWN">只有目前角色</option><option value="FACTION_KNOWN">指定勢力</option><option value="READER_KNOWN">只有讀者知道</option><option value="FUTURE_REVEAL">未來條件成立後</option></select></label>{knowledgeScope === "FACTION_KNOWN" ? <label>勢力名稱<input value={knowledgeFaction} onChange={(event) => setKnowledgeFaction(event.target.value)} /></label> : null}{knowledgeScope === "FUTURE_REVEAL" ? <label>揭露條件<input value={revealCondition} onChange={(event) => setRevealCondition(event.target.value)} /></label> : null}<button type="submit">保存知識邊界</button></form>
              <form onSubmit={(event) => void addBelief(event)}><h2>角色信念</h2><p>信念可以是錯的，不會改變正式真相。</p><label>角色目前相信<input value={beliefText} onChange={(event) => setBeliefText(event.target.value)} /></label><button type="submit">保存信念</button><ul>{data.beliefs.filter((belief) => belief.characterId === selectedCharacterId).map((belief) => <li key={belief.beliefId}>{belief.proposition} <small>{belief.beliefStatus}</small></li>)}</ul></form>
              <form onSubmit={(event) => void addRelationship(event)}><h2>建立有方向的關係</h2><label>從<b>{selectedCharacter?.name}</b></label><label>到<select value={relationshipTarget} onChange={(event) => setRelationshipTarget(event.target.value)}><option value="">選擇角色</option>{data.characters.filter((character) => character.id !== selectedCharacterId).map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label><label>關係類型<input value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)} /></label><label>信任（-100 至 100）<input type="number" min="-100" max="100" value={trust} onChange={(event) => setTrust(event.target.value)} /></label><label>好感（-100 至 100）<input type="number" min="-100" max="100" value={affection} onChange={(event) => setAffection(event.target.value)} /></label>{data.project.adultMode ? <fieldset className={styles.matureFormula}><legend>成年關係安全公式（選填）</legend><label><input type="checkbox" checked={explicitConsent} onChange={(event) => setExplicitConsent(event.target.checked)} />雙方已明確同意且可撤回</label><label><input type="checkbox" checked={boundaryConfirmed} onChange={(event) => setBoundaryConfirmed(event.target.checked)} />界線與事後影響已確認</label>{matureNarrativePreview ? <p data-eligible={matureNarrativePreview.eligible}>{matureNarrativePreview.eligible ? `可建立非露骨成年關係候選；張力 ${matureNarrativePreview.tension}，安全 ${matureNarrativePreview.boundarySafety}` : `目前只可保留一般關係：${matureNarrativePreview.blockers.join("；")}`}</p> : <p>選擇另一位角色後才會檢查成年、同意、界線、信任與權力差。</p>}</fieldset> : null}<button type="submit">保存方向關係</button></form>
            </section>

            <section className="relationshipSection">
              <header><div><h2>角色關係</h2><p>箭頭方向代表「前者如何看待後者」；反方向會獨立保存。</p></div></header>
              <svg className="relationshipGraph" viewBox="0 0 600 290" role="img" aria-label="有方向的角色關係圖">
                <defs><marker id="relationship-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" /></marker></defs>
                {data.relationships.map((edge) => {
                  const from = points[edge.fromCharacterId]; const to = points[edge.toCharacterId];
                  return from && to ? <line key={edge.relationshipId} x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#relationship-arrow)" /> : null;
                })}
                {data.characters.map((character) => { const point = points[character.id]; return <g key={character.id}><circle cx={point.x} cy={point.y} r="38" /><text x={point.x} y={point.y + 5} textAnchor="middle">{character.name}</text></g>; })}
              </svg>
              <div className="relationshipList" aria-label="角色關係文字列表" data-testid="relationship-list">
                {data.relationships.length ? data.relationships.map((edge) => {
                  const from = data.characters.find((character) => character.id === edge.fromCharacterId)?.name;
                  const to = data.characters.find((character) => character.id === edge.toCharacterId)?.name;
                  const latest = data.relationshipEvents.filter((event) => event.relationshipId === edge.relationshipId).at(-1);
                  return <article key={edge.relationshipId}><h3>{from} → {to}</h3><p>{edge.relationshipTypes.join("、")}</p><dl><div><dt>信任</dt><dd>{edge.trust}</dd></div><div><dt>好感</dt><dd>{edge.affection}</dd></div><div><dt>吸引</dt><dd>{edge.attraction}</dd></div><div><dt>恐懼</dt><dd>{edge.fear}</dd></div><div><dt>衝突</dt><dd>{edge.conflict}</dd></div><div><dt>權力平衡</dt><dd>{edge.powerBalance}</dd></div></dl><small>{latest ? `最近變化：${latest.cause}` : "尚無核准後的關係歷史"}</small></article>;
                }) : <p>尚未建立方向關係。</p>}
              </div>
            </section>

            <section className="simulationSection">
              <header>
                <h2>私人模擬場景</h2>
                <p>每位角色只會看到自己的資訊；私下訊息不會自動廣播。</p>
                <Link href={`/studio/project/${encodeURIComponent(projectId)}/closed-ai?task=character.multiAgentSimulation&objective=${encodeURIComponent(`依角色知識邊界深度推演：${scenario}`)}`}>
                  用閉端 AI 深度推演
                </Link>
              </header>
              <div className="simulationSetup"><fieldset><legend>參與角色</legend>{data.characters.map((character) => <label key={character.id}><input type="checkbox" checked={participantIds.includes(character.id)} onChange={(event) => setParticipantIds((current) => event.target.checked ? [...new Set([...current, character.id])] : current.filter((id) => id !== character.id))} />{character.name}</label>)}</fieldset><label>場景<textarea value={scenario} onChange={(event) => setScenario(event.target.value)} /></label><label>回合數<input type="number" min="1" max="30" value={turnBudget} onChange={(event) => setTurnBudget(event.target.value)} /></label><div><button disabled={busy} onClick={() => void startSimulation()}>開始私人模擬</button><button disabled={busy || !selectedSession || !["READY", "RUNNING", "PAUSED"].includes(selectedSession.status)} onClick={() => void pauseSimulation()}>暫停</button><button disabled={busy || !selectedSession || !["PAUSED", "READY"].includes(selectedSession.status)} onClick={() => void resumeSimulation()}>繼續</button><button disabled={busy || !selectedSession || !["PAUSED", "READY", "RUNNING"].includes(selectedSession.status)} onClick={() => void cancelSimulation()}>取消</button><button disabled={busy} onClick={() => void startSimulation()}>重新產生</button></div></div>
              {data.simulations.length ? <label className="sessionPicker">模擬紀錄<select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}>{data.simulations.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.status} · {session.currentTurn}/{session.turnBudget} 回合</option>)}</select></label> : null}
              <ol className="simulationTurns" data-testid="simulation-turns">{sessionTurns.map((turn) => <li key={turn.turnId}><header><b>第 {turn.turnNumber} 回合 · {data.characters.find((character) => character.id === turn.speakerCharacterId)?.name}</b><span>{turn.publicMessage ? "公開訊息" : "私人訊息"}</span></header><p>{turn.action.action}</p>{turn.dialogue ? <blockquote>{turn.dialogue.line}</blockquote> : null}<small>角色參考了 {turn.knownEvidenceIds.length} 筆已知資訊；Canonical mutation = {turn.canonicalMutation}</small></li>)}</ol>
              {selectedSession && sessionTurns.length ? <div className="simulationActions"><button disabled={selectedSession.status === "DISCARDED"} onClick={() => void turnIntoProposal()}>轉為候選</button><button disabled={selectedSession.status === "RUNNING" || selectedSession.status === "DISCARDED"} onClick={() => void discardSimulation()}>放棄模擬</button></div> : null}
            </section>

            <section className="proposalSection">
              <header><h2>待你決定的候選</h2><p>接受前都不會套用；有設定衝突時會阻擋核准。</p></header>
              {data.proposals.length ? data.proposals.map((proposal) => <article key={proposal.proposalId} data-testid="character-proposal"><div><small>{proposal.proposalType}</small><h3>{proposal.status === "ACCEPTED" ? "已核准的角色候選" : proposal.status === "REJECTED" ? "已放棄的角色候選" : "私人模擬轉成的角色候選"}</h3><p>{proposal.detectedChanges.join("、")}</p>{proposal.warnings.length ? <p className="proposalWarning">發現角色設定衝突：{proposal.warnings.join("；")}</p> : null}</div>{["GENERATED", "REVIEWING"].includes(proposal.status) ? <footer><button onClick={() => void approveProposal(proposal)}>接受</button><button onClick={() => void rejectProposal(proposal)}>拒絕</button></footer> : <span>{proposal.status === "ACCEPTED" ? "已套用核准紀錄" : "正式內容未變更"}</span>}</article>) : <p>目前沒有待處理候選。</p>}
            </section>

            <details className="characterTechnical"><summary>查看技術資訊</summary><p>角色視角與全局檢查分開建立；被拒絕的秘密會保持受限制狀態。系統只保存可稽核的決策摘要，不保存內部推理草稿。</p></details>
          </>
        )}
      </section>
    </main>
  );
}
