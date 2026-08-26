import type { ClosedAIProgressEvent } from "../closed-agent-os";
import type {
  AcceptedChoice,
  Chapter,
  Character,
  CharacterRelationship,
  LoreEntry,
  NovelProject,
  RpgTurnReceipt,
  StoryBible,
  StoryState,
  TimelineEvent,
  World,
  WorldRule,
} from "../domain";
import {
  activeStoryCharacters,
  activeStoryLore,
  activeStoryRelationships,
  activeStoryTimeline,
  activeStoryWorldRules,
  activeStoryWorlds,
} from "../domain/active-story-context";
import { isCharacterEraCompatible } from "../character-portraits/assignment";
import { sha256Hex, stableStringify } from "../closed-ai-cache";
import {
  isGameStoryPlayMode,
  STORY_PLAY_MODE_LABELS,
  resolveStoryPlayMode,
  type StoryPlayModeId,
} from "../domain/play-mode";
import {
  DEFAULT_RPG_RULE_SETTINGS,
  buildCustomRpgChoice,
  buildRpgChoices,
  materializeRpgStoryStateBaseline,
  readRpgProgression,
  resolveRpgChoice,
  type RpgChoice,
  type RpgChoiceResolution,
  type RpgMode,
  type RpgProgressionSnapshot,
  type RpgRuleSettings,
} from "../game/progression/rpg-progression";
import { RPG_RESOURCE_CATALOG_V3 } from "../game/progression/xianxia-ruleset-v3";
import {
  adaptProceduralEncounterForRomance,
  buildProceduralCausalFrame,
  romanceSafeProceduralText,
} from "../game/procedural-world-director";
import {
  PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
  proceduralCharacterTreasureScenarioAt,
  type ProceduralCharacterCandidate,
  type ProceduralCausalDimensionId,
} from "../game/procedural-story-library";
import {
  bindStoryArcToChoices,
  readStoryArcRuntime,
} from "../game/story-arc-runtime";
import type { AcceptChoiceConversationApprovalInput, NovelRepository } from "../repository";
import { createProjectBackup } from "../repository/backup";
import {
  APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
  buildApprovedLearningContext,
  type ApprovedLearningCausalSignal,
  type SovereignLearningRepository,
} from "../sovereign-learning";
import {
  acceptStudioChoice,
  persistStudioChoiceCandidate,
  type StudioProjectSeed,
} from "../repository/studio-canonical";
import {
  approveStudioClosedAgentCandidate,
  rejectStudioClosedAgentCandidate,
} from "./closed-agent-os-service";
import {
  buildRpgReaderSafeChoicePayload,
  buildRpgChoiceDirectorPrompt,
  buildRpgResolutionDirectorPrompt,
  cleanRpgContinuation,
  mergeRpgChoiceDirection,
  parseRpgChoiceDirectorOutput,
  toRpgReaderSafePromptPayload,
  validateRpgStoryTurnContract,
  type RpgDirectedChoice,
  type StoryOutputLanguage,
} from "./rpg-closed-ai-director";
import { runStudioClosedAI } from "./studio-closed-ai";
import { hasVerifiedExecutedStoryOutput } from "./story-output-quality";

export const RPG_CHAT_TURN_SCHEMA_VERSION = "rpg-chat-turn-v1" as const;
export const RPG_CHAT_CHOICE_AI_TIMEOUT_MS = 180_000;
export const RPG_CHAT_STORY_AI_TIMEOUT_MS = 28_000;
export const RPG_SHARED_LEARNING_SYNC_WAIT_MS = 350;

export type RpgChatSnapshot = {
  schemaVersion: typeof RPG_CHAT_TURN_SCHEMA_VERSION;
  project: NovelProject;
  chapter: Chapter;
  chapters: Chapter[];
  storyState: StoryState;
  storyBible: StoryBible;
  characters: Character[];
  relationships: CharacterRelationship[];
  worldRules: WorldRule[];
  lore: LoreEntry[];
  timeline: TimelineEvent[];
  acceptedChoices: AcceptedChoice[];
  rpgTurnReceipts: RpgTurnReceipt[];
  playMode: StoryPlayModeId;
  progressionMode: RpgMode;
  language: StoryOutputLanguage;
  progression: RpgProgressionSnapshot;
  conflict: string;
  directorContext: Record<string, unknown>;
  causalKnowledge: {
    snapshotVersion: typeof APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION;
    snapshotDigest: string;
    selectedRuleIds: string[];
    instructions: string[];
    causalSignals: ApprovedLearningCausalSignal[];
    maximumRules: 8;
    entireLibraryScanned: false;
  };
  baseChoices: RpgChoice[];
};

export type RpgChatChoicePlan = {
  schemaVersion: typeof RPG_CHAT_TURN_SCHEMA_VERSION;
  choices: RpgDirectedChoice[];
  taskId: string;
  candidateId: string;
  contentDigest: string;
  model: string;
  modelDigest: string;
  actualExecutor: string;
  executionReceipt: unknown;
  contextDigest: string | null;
  canonicalMutationCount: 0;
  dataLeftDevice: false;
  externalRequest: false;
};

function assertThreePlayableChoices(choices: readonly RpgDirectedChoice[]) {
  const keys = choices.map((choice) => choice.key);
  const titles = new Set(choices.map((choice) => choice.title.trim().toLocaleLowerCase()));
  const approaches = new Set(choices.map((choice) => choice.approach));
  if (
    choices.length !== 3
    || keys.join("") !== "ABC"
    || titles.size !== 3
    || approaches.size !== 3
    || choices.some((choice) => Boolean(choice.disabledReason))
  ) {
    throw Object.assign(new Error("閉端規則引擎沒有建立恰好三個可玩的不同選項。"), {
      code: "RPG_CHAT_RULE_CHOICES_NOT_PLAYABLE",
    });
  }
}

function isPostArcChoiceSet(choices: readonly RpgDirectedChoice[]) {
  return choices.length === 3
    && choices.map((choice) => choice.key).join("") === "ABC"
    && choices.every((choice) => Boolean(choice.encounter?.arcNextAction));
}

function storyWorldFlags(storyState: StoryState): Record<string, unknown> {
  const flags = storyState.worldFlags;
  return flags && typeof flags === "object" ? flags : {};
}

function normalizedCausalKnowledge(snapshot: RpgChatSnapshot) {
  const knowledge = snapshot.causalKnowledge;
  const validSignals = (Array.isArray(knowledge?.causalSignals)
    ? knowledge.causalSignals
    : []).filter((signal): signal is ApprovedLearningCausalSignal => Boolean(
      signal
      && typeof signal === "object"
      && typeof signal.ruleId === "string"
      && typeof signal.statement === "string"
      && typeof signal.operation === "string"
      && typeof signal.constraint === "string"
      && typeof signal.evaluate === "string",
    ));
  const seenSignalIds = new Set<string>();
  const causalSignals: ApprovedLearningCausalSignal[] = [];
  for (const signal of validSignals) {
    const ruleId = signal.ruleId.trim();
    if (!ruleId || seenSignalIds.has(ruleId)) {
      continue;
    }
    seenSignalIds.add(ruleId);
    causalSignals.push({ ...signal, ruleId });
    if (causalSignals.length === 8) {
      break;
    }
  }
  const signalRuleIds = new Set(causalSignals.map((signal) => signal.ruleId));
  const snapshotDigest = typeof knowledge?.snapshotDigest === "string"
    && knowledge.snapshotDigest.trim()
    ? knowledge.snapshotDigest
    : null;
  const selectedRuleIds = snapshotDigest && Array.isArray(knowledge?.selectedRuleIds)
    ? [...new Set(knowledge.selectedRuleIds
        .filter((ruleId): ruleId is string => typeof ruleId === "string")
        .map((ruleId) => ruleId.trim())
        .filter((ruleId) => Boolean(ruleId) && signalRuleIds.has(ruleId)))]
        .slice(0, 8)
    : [];
  const instructions = selectedRuleIds.length && Array.isArray(knowledge?.instructions)
    ? [...new Set(knowledge.instructions
        .filter((instruction): instruction is string => typeof instruction === "string")
        .map((instruction) => instruction.trim())
        .filter(Boolean))]
        .slice(0, 8)
    : [];
  return {
    snapshotVersion: knowledge?.snapshotVersion === APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION
      ? knowledge.snapshotVersion
      : APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
    snapshotDigest: selectedRuleIds.length && snapshotDigest
      ? snapshotDigest
      : "no-approved-learning",
    selectedRuleIds,
    instructions,
    causalSignals: selectedRuleIds.length
      ? causalSignals.filter((signal) => selectedRuleIds.includes(signal.ruleId))
      : [],
    maximumRules: 8 as const,
    entireLibraryScanned: false as const,
  };
}

function assertRuleChoiceState(snapshot: RpgChatSnapshot) {
  const flags = storyWorldFlags(snapshot.storyState);
  const archived = flags["story.arc.archived"] === true;
  if (archived) {
    if (snapshot.baseChoices.length !== 0) {
      throw Object.assign(new Error("已封存的結局不能再產生故事行動。"), {
        code: "RPG_CHAT_ARCHIVED_CHOICES_PRESENT",
      });
    }
    return;
  }
  if (!isPostArcChoiceSet(snapshot.baseChoices)) {
    assertThreePlayableChoices(snapshot.baseChoices);
    return;
  }
  const titles = new Set(snapshot.baseChoices.map((choice) => choice.title.trim().toLocaleLowerCase()));
  const approaches = new Set(snapshot.baseChoices.map((choice) => choice.approach));
  const invalidDisabledChoice = snapshot.baseChoices.some((choice) =>
    Boolean(choice.disabledReason)
    && !(
      choice.encounter?.arcNextAction === "epilogue"
      && flags["story.arc.epilogueRead"] === true
    ));
  if (titles.size !== 3 || approaches.size !== 3 || invalidDisabledChoice) {
    throw Object.assign(new Error("結案後續必須保留尾聲、續篇與封存三種專用行為。"), {
      code: "RPG_CHAT_POST_ARC_CHOICES_INVALID",
    });
  }
}

function withCausalKnowledgeReceipt(receipt: unknown, snapshot: RpgChatSnapshot) {
  const upstream = receipt && typeof receipt === "object"
    ? receipt as Record<string, unknown>
    : { upstreamReceipt: receipt ?? null };
  const knowledge = normalizedCausalKnowledge(snapshot);
  return {
    ...upstream,
    causalKnowledgeSnapshotVersion: knowledge?.snapshotVersion
      ?? APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
    causalKnowledgeSnapshotDigest: knowledge?.snapshotDigest ?? "no-approved-learning",
    causalKnowledgeRuleIds: [...(knowledge?.selectedRuleIds ?? [])],
    causalKnowledgeRuleCount: knowledge?.selectedRuleIds.length ?? 0,
    causalKnowledgeMaximumRules: knowledge?.maximumRules ?? 8,
    entireLibraryScanned: false,
  };
}

export async function buildRpgRuleChoicePlan(input: {
  snapshot: RpgChatSnapshot;
  fallbackReason?: string;
}): Promise<RpgChatChoicePlan> {
  assertRuleChoiceState(input.snapshot);
  const knowledge = normalizedCausalKnowledge(input.snapshot);
  const flags = storyWorldFlags(input.snapshot.storyState);
  const fallbackBody = {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    sourceChapterId: input.snapshot.chapter.id,
    sourceRevision: input.snapshot.chapter.revision,
    storyStateRevision: input.snapshot.storyState.revision,
    choices: input.snapshot.baseChoices.map((choice) => ({
      key: choice.key,
      title: choice.title,
      description: choice.description,
      consequenceTeaser: choice.consequenceTeaser,
      strategy: choice.approach,
      successChance: choice.successChance,
    })),
    fallbackReason: input.fallbackReason || "RPG_RULE_FIRST_IMMEDIATE_PLAN",
    causalKnowledgeSnapshotVersion: knowledge.snapshotVersion,
    causalKnowledgeSnapshotDigest: knowledge.snapshotDigest,
    causalKnowledgeRuleIds: knowledge.selectedRuleIds,
  };
  const contentDigest = await sha256Hex(stableStringify(fallbackBody));
  const contextDigest = await sha256Hex(stableStringify(input.snapshot.directorContext));
  const modelDigest = await sha256Hex("closed-causal-teacher:rules-only:xianxia-cultivation-v3");
  const taskId = `rules-choice-plan:${contentDigest.slice(0, 24)}`;
  return {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    choices: structuredClone(input.snapshot.baseChoices),
    taskId,
    candidateId: taskId,
    contentDigest,
    model: "closed-causal-teacher-rules",
    modelDigest,
    actualExecutor: "deterministic-rule-fallback",
    executionReceipt: {
      receiptId: `rules-receipt:${contentDigest.slice(0, 24)}`,
      fallback: true,
      fallbackReason: fallbackBody.fallbackReason,
      choiceCount: input.snapshot.baseChoices.length,
      exactKeys: input.snapshot.baseChoices.map((choice) => choice.key),
      terminalArchive: flags["story.arc.archived"] === true,
      causalKnowledgeRuleCount: knowledge.selectedRuleIds.length,
      causalKnowledgeRuleIds: knowledge.selectedRuleIds,
      causalKnowledgeSnapshotVersion: knowledge.snapshotVersion,
      causalKnowledgeSnapshotDigest: knowledge.snapshotDigest,
      causalKnowledgeSelection: "approved-indexed-top-k",
      entireLibraryScanned: false,
      externalRequest: false,
      dataLeftDevice: false,
    },
    contextDigest,
    canonicalMutationCount: 0,
    dataLeftDevice: false,
    externalRequest: false,
  };
}

export type RpgChatTurnCandidate = {
  schemaVersion: typeof RPG_CHAT_TURN_SCHEMA_VERSION;
  taskId: string;
  candidateId: string;
  candidateDigest: string;
  model: string;
  modelDigest: string;
  actualExecutor: string;
  executionReceipt: unknown;
  contextDigest: string | null;
  sourceChapterId: string;
  sourceRevision: number;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  story: string;
  outcomeLines: string[];
  canonicalMutationCount: 0;
  dataLeftDevice: false;
  externalRequest: false;
};

function progressionMode(playMode: StoryPlayModeId): RpgMode {
  if (playMode === "management") return "management";
  if (playMode === "romance") return "cultivation";
  return "adventure";
}

function storyLanguage(storyState: StoryState): StoryOutputLanguage {
  const value = storyWorldFlags(storyState)["story.language"];
  return value === "zh-CN" || value === "en" ? value : "zh-TW";
}

function projectSeed(snapshot: RpgChatSnapshot): StudioProjectSeed {
  const protagonist = snapshot.characters.find((character) =>
    snapshot.storyBible.protagonistIds.includes(character.id))
    ?? snapshot.characters[0];
  return {
    id: snapshot.project.id,
    title: snapshot.project.title,
    chapterId: snapshot.chapter.id,
    chapterTitle: snapshot.chapter.title,
    draft: snapshot.chapter.content,
    packId: snapshot.project.genrePackId,
    topicId: snapshot.project.genreId,
    subCategory: snapshot.project.subgenreId,
    coreIdea: snapshot.project.coreIdea.value,
    protagonist: protagonist?.name ?? null,
    goal: protagonist?.goal.value ?? null,
    worldRule: snapshot.worldRules[0]?.description ?? null,
    conflict: snapshot.conflict,
    style: snapshot.project.narrativeStyle.value,
    adultMode: snapshot.project.adultMode,
    adultExperienceProfile: snapshot.project.adultExperienceProfile ?? null,
  };
}

const FAMILY_STAGE_INTERNAL_LORE_PATTERN = /(?:世界契約|題材契約|所屬家族\s*ID|contractStatement|canonicalStatus|VIRTUAL_CANDIDATE|schemaVersion|十因果維度)/iu;

function loreDisplayParts(entry: LoreEntry) {
  const [prefix, ...rest] = entry.title.split("｜").map((value) => value.trim()).filter(Boolean);
  return {
    prefix: prefix || entry.kind,
    name: rest.join("｜") || prefix || entry.title,
  };
}

function readerSafeLoreContent(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !FAMILY_STAGE_INTERNAL_LORE_PATTERN.test(line))
    .join("\n")
    .replace(/(?:social-(?:family|institution)-[^\s，。；、)）]+|[\da-f]{8,}-[\da-f-]{20,})/giu, "既有勢力")
    .trim();
}

function loreField(content: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = content.match(new RegExp(`(?:^|[；;\\n])\\s*${escaped}\\s*[：:]\\s*([^；;\\n。]+)`, "u"));
  return match?.[1]?.trim() || null;
}

function firstLoreNarrativeLine(content: string) {
  return content.split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && !/^[^：:]{1,12}[：:]/u.test(line)) ?? "";
}

function cleanLoreEntityName(value: string | null | undefined) {
  return value
    ?.replace(/（[^）]*）/gu, "")
    .replace(/[。；;，,：:\s]+$/gu, "")
    .trim() || null;
}

type FamilyStageOrganizationNarrative = {
  id: string;
  kind: string;
  name: string;
  situation: string;
  territory: string | null;
  doctrine: string | null;
  publicGoal: string | null;
  hiddenConflict: string | null;
  allies: string | null;
  rivals: string | null;
  controlledAssets: string | null;
  contestedAssets: string | null;
};

type FamilyStageAssetNarrative = {
  id: string;
  category: string;
  name: string;
  storyHook: string;
  controller: string | null;
  holder: string | null;
  claimant: string | null;
  function: string | null;
  limitation: string | null;
  cost: string | null;
  visualDescription: string | null;
  holderCharacterId: string | null;
  stakeholderCharacterIds: string[];
  controllerOrganizationId: string | null;
  claimantOrganizationId: string | null;
};

function buildFamilyStageNarrativeContext(input: {
  lore: readonly LoreEntry[];
  storyState: StoryState;
}) {
  const loreById = new Map(input.lore.map((entry) => [entry.id, entry] as const));
  const flags = storyWorldFlags(input.storyState);
  const selectedFamilyId = typeof flags["story.selectedFamilyId"] === "string"
    ? String(flags["story.selectedFamilyId"])
    : null;
  const factionLore = input.lore.filter((entry) => entry.kind === "faction");
  const selectedFamilyLore = (selectedFamilyId ? loreById.get(selectedFamilyId) : null)
    ?? factionLore.find((entry) => loreDisplayParts(entry).prefix === "上場家族")
    ?? null;
  const organizationLore = factionLore.filter((entry) => entry.id !== selectedFamilyLore?.id);
  const organizations: FamilyStageOrganizationNarrative[] = organizationLore.map((entry) => {
    const safeContent = readerSafeLoreContent(entry.content);
    const parts = loreDisplayParts(entry);
    return {
      id: entry.id,
      kind: parts.prefix,
      name: parts.name,
      situation: firstLoreNarrativeLine(safeContent),
      territory: loreField(safeContent, "領域"),
      doctrine: loreField(safeContent, "內部準則"),
      publicGoal: loreField(safeContent, "公開目標"),
      hiddenConflict: loreField(safeContent, "隱藏衝突"),
      allies: loreField(safeContent, "盟友"),
      rivals: loreField(safeContent, "對手"),
      controlledAssets: loreField(safeContent, "控制"),
      contestedAssets: loreField(safeContent, "爭奪"),
    };
  });
  const organizationByName = new Map(organizations.map((organization) => [organization.name, organization] as const));
  const assets: FamilyStageAssetNarrative[] = input.lore
    .filter((entry) => entry.kind === "item")
    .map((entry) => {
      const safeContent = readerSafeLoreContent(entry.content);
      const parts = loreDisplayParts(entry);
      const controller = cleanLoreEntityName(loreField(safeContent, "控制勢力"));
      const claimant = cleanLoreEntityName(loreField(safeContent, "聲索勢力"));
      return {
        id: entry.id,
        category: parts.prefix,
        name: parts.name,
        storyHook: firstLoreNarrativeLine(safeContent),
        controller,
        holder: cleanLoreEntityName(loreField(safeContent, "持有人")),
        claimant,
        function: loreField(safeContent, "作用"),
        limitation: loreField(safeContent, "限制"),
        cost: loreField(safeContent, "代價"),
        visualDescription: loreField(safeContent, "外觀"),
        holderCharacterId: entry.proceduralTreasureProfile?.holderCharacterId ?? null,
        stakeholderCharacterIds: entry.proceduralTreasureProfile?.stakeholderCharacterIds ?? [],
        controllerOrganizationId: controller ? organizationByName.get(controller)?.id ?? null : null,
        claimantOrganizationId: claimant ? organizationByName.get(claimant)?.id ?? null : null,
      };
    });
  const selectedStageFamily = selectedFamilyLore ? {
    id: selectedFamilyLore.id,
    name: loreDisplayParts(selectedFamilyLore).name,
    introduction: firstLoreNarrativeLine(readerSafeLoreContent(selectedFamilyLore.content)),
    standing: loreField(readerSafeLoreContent(selectedFamilyLore.content), "家族位置"),
    stagePremise: loreField(readerSafeLoreContent(selectedFamilyLore.content), "上場前提"),
    controlledAssets: loreField(readerSafeLoreContent(selectedFamilyLore.content), "掌握資產"),
  } : null;
  const prioritizedLore = [
    ...organizationLore,
    ...(selectedFamilyLore ? [selectedFamilyLore] : []),
    ...input.lore.filter((entry) => entry.kind === "item"),
    ...input.lore.filter((entry) => entry.kind !== "faction" && entry.kind !== "item").slice(-7),
  ].filter((entry, index, values) => values.findIndex((candidate) => candidate.id === entry.id) === index);
  return {
    loreById,
    selectedStageFamily,
    organizations,
    assets,
    readerSafeLore: prioritizedLore.slice(0, 20).map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      content: readerSafeLoreContent(entry.content),
    })),
  };
}

function buildDirectorContext(input: {
  project: NovelProject;
  chapter: Chapter;
  chapters: Chapter[];
  storyState: StoryState;
  storyBible: StoryBible;
  characters: Character[];
  relationships: CharacterRelationship[];
  worldRules: WorldRule[];
  lore: LoreEntry[];
  timeline: TimelineEvent[];
  acceptedChoices: AcceptedChoice[];
  rpgTurnReceipts: RpgTurnReceipt[];
  playMode: StoryPlayModeId;
  progressionMode: RpgMode;
  language: StoryOutputLanguage;
  progression: RpgProgressionSnapshot;
  conflict: string;
}) {
  const worldFlags = storyWorldFlags(input.storyState);
  const familyStage = buildFamilyStageNarrativeContext({
    lore: input.lore,
    storyState: input.storyState,
  });
  const protagonist = input.characters.find((character) =>
    input.storyBible.protagonistIds.includes(character.id))
    ?? input.characters[0]
    ?? null;
  const nameById = new Map(input.characters.map((character) => [character.id, character.name]));
  const stagedCharacters = input.characters.slice(0, 14);
  const stagedFamilyMap = new Map<string, {
    family: string | null;
    faction: string | null;
    members: string[];
  }>();
  for (const character of stagedCharacters) {
    const affiliation = characterNarrativeAffiliation(character, familyStage.loreById);
    if (!affiliation.affiliationKey) continue;
    const current = stagedFamilyMap.get(affiliation.affiliationKey) ?? {
      family: affiliation.familyLabel,
      faction: affiliation.factionLabel,
      members: [],
    };
    if (!current.members.includes(character.name)) current.members.push(character.name);
    stagedFamilyMap.set(affiliation.affiliationKey, current);
  }
  return {
    project: {
      title: input.project.title,
      coreIdea: input.project.coreIdea.value,
      genre: input.project.genreId,
      narrativeStyle: input.project.narrativeStyle.value,
      language: input.language,
      fixedPlayMode: input.playMode,
      fixedPlayModeLabel: STORY_PLAY_MODE_LABELS[input.playMode],
    },
    currentChapter: {
      id: input.chapter.id,
      title: input.chapter.title,
      order: input.chapter.order,
      revision: input.chapter.revision,
      recentText: input.chapter.content.trim()
        ? input.chapter.content.slice(-1_200)
        : "故事尚無正文。",
    },
    currentConflict: input.conflict,
    previousChapters: [...input.chapters]
      .filter((item) => item.order <= input.chapter.order)
      .sort((left, right) => left.order - right.order)
      .slice(-3)
      .map((item) => ({
        id: item.id,
        order: item.order,
        title: item.title,
        status: item.status,
        recentText: item.content.slice(-700),
      })),
    storyBible: {
      theme: input.storyBible.theme.value,
      style: input.storyBible.style.value,
      foreshadowing: input.storyBible.foreshadowing.slice(-8),
      unresolvedThreads: input.storyBible.unresolvedThreads.slice(-10),
      forbiddenContradictions: input.storyBible.forbiddenContradictions.slice(-10),
      authorPreferences: input.storyBible.authorPreferences.slice(-8),
    },
    protagonist: protagonist ? {
      name: protagonist.name,
      identity: protagonist.identity.value,
      personality: protagonist.personality.value,
      goal: protagonist.goal.value,
      values: protagonist.values ?? [],
      capabilities: protagonist.capabilities ?? [],
      limitations: protagonist.limitations ?? [],
      family: characterNarrativeAffiliation(protagonist, familyStage.loreById).familyLabel,
      faction: characterNarrativeAffiliation(protagonist, familyStage.loreById).factionLabel,
    } : null,
    supportingCharacters: input.characters
      .filter((character) => character.id !== protagonist?.id)
      .slice(0, 10)
      .map((character) => {
        const affiliation = characterNarrativeAffiliation(character, familyStage.loreById);
        return {
          name: character.name,
          identity: character.identity.value,
          personality: character.personality.value,
          goal: character.goal.value,
          capabilities: character.capabilities?.slice(0, 5) ?? [],
          limitations: character.limitations?.slice(0, 3) ?? [],
          hiddenMotivations: character.privateSecrets?.slice(0, 2) ?? [],
          family: affiliation.familyLabel,
          faction: affiliation.factionLabel,
        };
      }),
    stagedFamilies: [...stagedFamilyMap.values()].slice(0, 8),
    selectedStageFamily: familyStage.selectedStageFamily ? {
      name: familyStage.selectedStageFamily.name,
      introduction: familyStage.selectedStageFamily.introduction,
      standing: familyStage.selectedStageFamily.standing,
      stagePremise: familyStage.selectedStageFamily.stagePremise,
      controlledAssets: familyStage.selectedStageFamily.controlledAssets,
    } : null,
    stagedOrganizations: familyStage.organizations.map((organization) => {
      const { id, ...serializedOrganization } = organization;
      void id;
      return serializedOrganization;
    }),
    stagedAssets: familyStage.assets.map((asset) => ({
      category: asset.category,
      name: asset.name,
      storyHook: asset.storyHook,
      controller: asset.controller,
      holder: asset.holder,
      claimant: asset.claimant,
      function: asset.function,
      limitation: asset.limitation,
      cost: asset.cost,
      visualDescription: asset.visualDescription,
    })),
    relationships: input.relationships.slice(-16).map((relationship) => ({
      from: nameById.get(relationship.fromCharacterId) ?? "未登錄人物",
      to: nameById.get(relationship.toCharacterId) ?? "未登錄人物",
      kind: relationship.kind,
      summary: relationship.summary,
      trust: relationship.trust,
    })),
    worldRules: input.worldRules.map((rule) => ({
      title: rule.title,
      description: rule.description,
      immutable: rule.immutable,
    })),
    lore: familyStage.readerSafeLore,
    timeline: input.timeline.slice(-12).map((event) => ({
      storyTime: event.storyTime,
      title: event.title,
      summary: event.summary,
    })),
    recentAcceptedChoices: input.acceptedChoices.slice(0, 8).map((choice) => ({
      label: choice.choiceLabel,
      text: choice.acceptedText.slice(0, 520),
    })),
    recentRpgTurnReceipts: input.rpgTurnReceipts.slice(0, 3).map((receipt) => ({
      receiptId: receipt.receiptId,
      turnNumber: receipt.turnNumber,
      choiceKey: receipt.choiceKey,
      choiceTitle: receipt.choiceTitle,
      strategy: receipt.selectedStrategy,
      outcome: receipt.outcome,
      successChance: receipt.successChance,
      appliedResourceChanges: receipt.appliedResourceChanges ?? {},
      appliedMeterChanges: receipt.appliedMeterChanges,
      realmChange: receipt.appliedRealmChanges,
    })),
    lockedStoryState: {
      time: input.storyState.timeState,
      location: input.storyState.locationState,
      risk: input.storyState.riskState,
      money: input.storyState.money,
      reputation: input.storyState.reputation,
      stats: input.progression.stats,
      status: input.progression.status,
      currencies: input.progression.currencies,
      inventory: input.progression.inventory
        .filter((item) => item.quantity > 0)
        .map((item) => ({ id: item.itemId, name: item.name, quantity: item.quantity, usable: Boolean(item.useEffect || item.proceduralPill), effect: item.effectDescription })),
      quests: input.storyState.questStates,
      revision: input.storyState.revision,
      rawResources: input.storyState.resources,
      relationships: input.storyState.relationships,
      realm: input.progression.rpgState.realm,
      realmProgress: input.progression.rpgState.realm?.progress ?? 0,
      cultivationDerived: input.progression.cultivationDerived,
      narrativeMeters: input.progression.rpgState.meters,
      strategicAssets: input.progression.rpgState.strategicAssets,
      pendingConsequences: input.progression.rpgState.pendingConsequences,
      factionFlags: Object.fromEntries(Object.entries(worldFlags)
        .filter(([key]) => key.startsWith("faction."))),
      contentMechanics: Object.fromEntries(Object.entries(worldFlags)
        .filter(([key]) => key.startsWith("xianxia.mingtan."))),
      factionStandings: input.storyState.factionStanding,
      resourceConstraints: RPG_RESOURCE_CATALOG_V3.map((resource) => ({
        id: resource.id,
        name: resource.localizedName,
        type: resource.type,
        nonNegative: resource.nonNegative,
      })),
      day: input.progression.day,
      turn: input.progression.turn,
      fixedPlayMode: input.playMode,
      progressionMode: input.progressionMode,
    },
  };
}

export async function loadRpgChatSnapshot(
  repository: NovelRepository,
  projectId: string,
  rules: RpgRuleSettings = DEFAULT_RPG_RULE_SETTINGS,
  learningRepository?: SovereignLearningRepository,
): Promise<RpgChatSnapshot> {
  const project = await repository.get<NovelProject>("projects", projectId);
  if (!project || project.deletedAt) {
    throw Object.assign(new Error("找不到這個作品。"), {
      code: "RPG_CHAT_PROJECT_NOT_FOUND",
    });
  }
  const [chapters, states, bibles, allCharacters, allRelationships, allWorlds, allWorldRules, allLore, allTimeline, acceptedChoices, rpgTurnReceipts] = await Promise.all([
    repository.list<Chapter>("chapters", projectId),
    repository.list<StoryState>("storyStates", projectId),
    repository.list<StoryBible>("storyBibles", projectId),
    repository.list<Character>("characters", projectId),
    repository.list<CharacterRelationship>("relationships", projectId),
    repository.list<World>("worlds", projectId),
    repository.list<WorldRule>("worldRules", projectId),
    repository.list<LoreEntry>("lore", projectId),
    repository.list<TimelineEvent>("timeline", projectId),
    repository.listAcceptedChoices(projectId),
    repository.list<RpgTurnReceipt>("rpgTurnReceipts", projectId),
  ]);
  const chapter = chapters.find((item) => item.id === project.activeChapterId)
    ?? [...chapters].sort((left, right) => left.order - right.order).at(-1)
    ?? null;
  let storyState = states.find((item) => item.id === project.storyStateId) ?? states[0] ?? null;
  const storyBible = bibles.find((item) => item.id === project.storyBibleId) ?? bibles[0] ?? null;
  if (!chapter || !storyState || !storyBible) {
    throw Object.assign(new Error("作品缺少章節、故事狀態或 Story Bible。"), {
      code: "RPG_CHAT_CANON_CONTEXT_INCOMPLETE",
    });
  }
  const worlds = activeStoryWorlds(allWorlds, storyState, storyBible);
  const characters = storyState.activeWorldId !== undefined && worlds.length === 0
    ? []
    : activeStoryCharacters(allCharacters, storyState, storyBible)
    .filter((character) => isCharacterEraCompatible({ character, project, worlds }));
  const relationships = activeStoryRelationships(allRelationships, characters);
  const worldRules = activeStoryWorldRules(allWorldRules, storyState, storyBible);
  const lore = activeStoryLore(allLore, storyState, storyBible);
  const timeline = activeStoryTimeline(allTimeline, storyState, storyBible);
  const playMode = resolveStoryPlayMode(storyState);
  const mode = progressionMode(playMode);
  const protagonist = characters.find((character) =>
    storyBible.protagonistIds.includes(character.id)) ?? characters[0] ?? null;
  const baselineSeed = `${project.title}|${protagonist?.name ?? ""}`;
  const materialized = isGameStoryPlayMode(playMode)
    ? materializeRpgStoryStateBaseline(storyState, baselineSeed, mode)
    : storyState;
  if (materialized !== storyState) {
    try {
      storyState = await repository.put("storyStates", materialized, storyState.revision);
    } catch (error) {
      // React development retries or two tabs may race this idempotent migration.
      // Re-read once: a completed baseline is success; a newer incomplete state
      // receives one normal optimistic-concurrency retry. Storage failures still
      // surface instead of being disguised as a playable snapshot.
      const latest = await repository.get<StoryState>("storyStates", storyState.id);
      if (!latest || latest.revision === storyState.revision) throw error;
      const latestMaterialized = materializeRpgStoryStateBaseline(latest, baselineSeed, mode);
      storyState = latestMaterialized === latest
        ? latest
        : await repository.put("storyStates", latestMaterialized, latest.revision);
    }
  }
  const progression = readRpgProgression(
    storyState,
    baselineSeed,
    mode,
  );
  const conflict = chapter.content.slice(-420).trim()
    || chapter.summary?.trim()
    || storyBible.unresolvedThreads.at(-1)?.trim()
    || project.coreIdea.value?.trim()
    || "目前局勢";
  const language = storyLanguage(storyState);
  const emptyCausalKnowledge = {
    snapshotVersion: APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
    snapshotDigest: await sha256Hex(stableStringify({
      snapshotVersion: APPROVED_LEARNING_CONTEXT_SNAPSHOT_VERSION,
      projectId,
      taskType: "three_choices",
      maximumRules: 8,
      selectedRuleIds: [],
    })),
    selectedRuleIds: [],
    instructions: [],
    causalSignals: [],
    maximumRules: 8 as const,
    entireLibraryScanned: false as const,
  };
  const causalKnowledge = learningRepository?.isAvailable()
    ? await buildApprovedLearningContext({
      repository: learningRepository,
      projectId,
      taskType: "three_choices",
      maximumRules: 8,
    }).then((context) => ({
      snapshotVersion: context.snapshotVersion,
      snapshotDigest: context.snapshotDigest,
      selectedRuleIds: context.selectedRuleIds,
      instructions: context.instructions,
      causalSignals: context.causalSignals,
      maximumRules: 8 as const,
      entireLibraryScanned: false as const,
    })).catch(() => emptyCausalKnowledge)
    : emptyCausalKnowledge;
  const directorContext = {
    ...buildDirectorContext({
    project,
    chapter,
    chapters,
    storyState,
    storyBible,
    characters,
    relationships,
    worldRules,
    lore,
    timeline,
    acceptedChoices,
    rpgTurnReceipts: [...rpgTurnReceipts].sort((left, right) => right.turnNumber - left.turnNumber),
    playMode,
    progressionMode: mode,
    language,
    progression,
    conflict,
    }),
    closedCausalTeacherKnowledge: {
      snapshotVersion: causalKnowledge.snapshotVersion,
      snapshotDigest: causalKnowledge.snapshotDigest,
      instructions: causalKnowledge.instructions,
      selectedRuleIds: causalKnowledge.selectedRuleIds,
      selectedRuleCount: causalKnowledge.selectedRuleIds.length,
      selection: "approved-indexed-top-k",
      maximumRules: causalKnowledge.maximumRules,
      entireLibraryScanned: false,
    },
  };
  const fallbackThread = storyBible.unresolvedThreads.at(-1)?.trim()
    || "先前留下的承諾仍未得到回答";
  const storyArc = readStoryArcRuntime({
    storyState,
    projectId: project.id,
    progressionTurn: progression.turn,
    fallbackGoal: conflict,
    fallbackThread,
  });
  const remainingThread = storyBible.unresolvedThreads
    .find((thread) => thread.trim() && thread.trim() !== storyArc.thread)?.trim();
  const familyStageNarrative = buildFamilyStageNarrativeContext({ lore, storyState });
  const firstStagedOrganization = familyStageNarrative.organizations[0] ?? null;
  const firstStagedAsset = familyStageNarrative.assets[0] ?? null;
  const latestTurnReceipt = [...rpgTurnReceipts]
    .sort((left, right) => right.turnNumber - left.turnNumber)[0] ?? null;
  const recentStoryBeat = chapter.content.trim()
    ? narrativeFact(chapter.content.slice(-360), conflict, 96)
    : conflict;
  const latestOutcomeLabel = latestTurnReceipt
    ? ({
        critical_success: "關鍵成功",
        success: "成功",
        partial_success: "部分成功",
        failure: "失敗但留下新線索",
      } as const)[latestTurnReceipt.outcome]
    : null;
  const evolvingConflict = latestTurnReceipt
    ? `上一個選擇「${latestTurnReceipt.choiceTitle}」已造成${latestOutcomeLabel}的具體後果；${recentStoryBeat}`
    : recentStoryBeat;
  const activeSupportingName = typeof storyState.worldFlags?.["story.activeSupportingCharacterName"] === "string"
    ? String(storyState.worldFlags["story.activeSupportingCharacterName"]).trim()
    : "";
  const continuation = storyArc.resolved ? {
    thread: remainingThread ?? "結案後果引發的新責任、新對手與下一個期限",
    goal: remainingThread
      ? `在不重開舊結局的前提下，處理「${remainingThread}」`
      : "承接已完成結局留下的關係與局勢後果，建立下一卷的新目標",
  } : undefined;
  const generatedBaseChoices = buildRpgChoices({
    progression,
    protagonist: protagonist?.name ?? "主角",
    chapterTitle: chapter.title,
    // The arc goal stays locked in the encounter contract.  Choice copy must
    // instead start from the latest accepted consequence, otherwise every
    // round reprints the first-round problem with different decorative nouns.
    conflict: storyArc.resolved ? conflict : evolvingConflict,
    mode,
    playMode,
    variant: progression.choiceVariant,
    seed: `${project.id}|${storyState.revision}|${causalKnowledge.selectedRuleIds.join("|")}`,
    rules,
    storyStateRevision: storyState.revision,
    storyState,
    narrativeAnchors: {
      supportingCharacter: activeSupportingName
        || characters.find((character) =>
          !storyBible.protagonistIds.includes(character.id))?.name
        || null,
      familyOrFaction: familyStageNarrative.selectedStageFamily?.name
        ?? firstStagedOrganization?.name
        ?? null,
      storyAsset: firstStagedAsset?.name ?? null,
      factionPressure: firstStagedOrganization?.hiddenConflict
        ?? firstStagedOrganization?.rivals
        ?? firstStagedAsset?.claimant
        ?? null,
      unresolvedThread: storyArc.resolved
        ? storyBible.unresolvedThreads.find((thread) => thread.trim() !== storyArc.thread) ?? null
        : storyArc.thread,
      worldContext: [
        project.genrePackId,
        project.genreId,
        project.subgenreId,
        project.coreIdea.value,
        storyBible.theme.value,
      ].filter(Boolean).join("｜"),
    },
    causalKnowledgeDigest: causalKnowledge.selectedRuleIds.length
      ? causalKnowledge.snapshotDigest
      : undefined,
  });
  const arcBoundChoices = bindStoryArcToChoices(generatedBaseChoices, storyArc, continuation);
  const baseChoices = playMode === "romance"
    ? arcBoundChoices.map((choice) => ({
        ...choice,
        title: romanceSafeProceduralText(choice.title),
        description: romanceSafeProceduralText(choice.description),
        acceptedText: romanceSafeProceduralText(choice.acceptedText),
        consequenceTeaser: romanceSafeProceduralText(choice.consequenceTeaser),
        impactLabels: choice.impactLabels.map(romanceSafeProceduralText),
        costLabels: choice.costLabels.map(romanceSafeProceduralText),
        encounter: adaptProceduralEncounterForRomance(choice.encounter),
      }))
    : arcBoundChoices;
  return {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    project,
    chapter,
    chapters,
    storyState,
    storyBible,
    characters,
    relationships,
    worldRules,
    lore,
    timeline,
    acceptedChoices: [...acceptedChoices].sort((left, right) =>
      right.acceptedAt.localeCompare(left.acceptedAt)),
    rpgTurnReceipts: [...rpgTurnReceipts].sort((left, right) => right.turnNumber - left.turnNumber),
    playMode,
    progressionMode: mode,
    language,
    progression,
    conflict,
    directorContext,
    causalKnowledge,
    baseChoices,
  };
}

export async function loadLearningAwareRpgChatSnapshot(input: {
  repository: NovelRepository;
  projectId: string;
  rules?: RpgRuleSettings;
  learningRepository: SovereignLearningRepository;
  ensureSharedLearningReady?: (signal?: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
}) {
  if (input.ensureSharedLearningReady) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([
      Promise.resolve()
        .then(() => input.ensureSharedLearningReady?.(input.signal))
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RPG_SHARED_LEARNING_SYNC_WAIT_MS);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
  return loadRpgChatSnapshot(
    input.repository,
    input.projectId,
    input.rules ?? DEFAULT_RPG_RULE_SETTINGS,
    input.learningRepository,
  );
}

export async function planRpgChatChoices(input: {
  snapshot: RpgChatSnapshot;
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
}): Promise<RpgChatChoicePlan> {
  const flags = storyWorldFlags(input.snapshot.storyState);
  if (
    flags["story.arc.archived"] === true
    || isPostArcChoiceSet(input.snapshot.baseChoices)
  ) {
    return buildRpgRuleChoicePlan({
      snapshot: input.snapshot,
      fallbackReason: flags["story.arc.archived"] === true
        ? "STORY_ARC_ARCHIVED_TERMINAL"
        : "STORY_ARC_POST_CLOSURE_ACTIONS",
    });
  }
  assertThreePlayableChoices(input.snapshot.baseChoices);
  const seed = (
    input.snapshot.storyState.revision * 997
    + input.snapshot.progression.turn * 131
    + input.snapshot.progression.choiceVariant * 17
  ) >>> 0;
  const enhancementController = new AbortController();
  const relayAbort = () => enhancementController.abort(input.signal?.reason);
  if (input.signal?.aborted) relayAbort();
  else input.signal?.addEventListener("abort", relayAbort, { once: true });
  const enhancementTimeout = setTimeout(() => {
    enhancementController.abort("RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT");
  }, RPG_CHAT_CHOICE_AI_TIMEOUT_MS);
  try {
    const readerSafeCausalContracts = input.snapshot.baseChoices.map((choice) => ({
      key: choice.key,
      contract: buildRpgReaderSafeCausalPayload({ snapshot: input.snapshot, choice }),
    }));
    const result = await runStudioClosedAI({
      projectId: input.snapshot.project.id,
      task: "three_choices",
      input: buildRpgChoiceDirectorPrompt({
        context: input.snapshot.directorContext,
        baseChoices: input.snapshot.baseChoices,
        language: input.snapshot.language,
        readerSafeCausalContracts,
      }),
      sourceChapterId: input.snapshot.chapter.id,
      sourceRevision: input.snapshot.chapter.revision,
      qualityMode: "fast",
      browserComputePolicy: "balanced",
      generationOptions: {
        maxTokens: 520,
        temperature: 0.82,
        topP: 0.94,
        repetitionPenalty: 1.16,
        seed,
      },
      signal: enhancementController.signal,
      onProgress: input.onProgress,
    });
    if (
      !hasVerifiedExecutedStoryOutput(result)
      || !result.candidateId
      || !result.modelDigest
      || result.sourceChapterId !== input.snapshot.chapter.id
      || result.sourceRevision !== input.snapshot.chapter.revision
      || result.canonicalMutationCount !== 0
      || result.externalRequest
      || result.dataLeftDevice
    ) {
      if (result.candidateId) {
        await rejectStudioClosedAgentCandidate(result.candidateId).catch(() => undefined);
      }
      throw Object.assign(new Error("閉端 AI 選項缺少真實模型或來源章節證明。"), {
        code: "RPG_CHAT_CHOICE_PROOF_MISSING",
      });
    }
    let choices: RpgDirectedChoice[];
    try {
      choices = mergeRpgChoiceDirection(
        input.snapshot.baseChoices,
        parseRpgChoiceDirectorOutput(result.content),
      );
    } catch (error) {
      await rejectStudioClosedAgentCandidate(result.candidateId).catch(() => undefined);
      throw error;
    }
    return {
      schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
      choices,
      taskId: result.taskId,
      candidateId: result.candidateId,
      contentDigest: result.contentDigest,
      model: result.model,
      modelDigest: result.modelDigest,
      actualExecutor: result.actualExecutor,
      executionReceipt: withCausalKnowledgeReceipt(result.executionReceipt, input.snapshot),
      contextDigest: result.contextDigest,
      canonicalMutationCount: 0,
      dataLeftDevice: false,
      externalRequest: false,
    };
  } catch (error) {
    return buildRpgRuleChoicePlan({
      snapshot: input.snapshot,
      fallbackReason: error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "RPG_CHOICE_AI_UNAVAILABLE")
        : enhancementController.signal.aborted && !input.signal?.aborted
          ? "RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT"
        : input.signal?.aborted
          ? "RPG_CHOICE_AI_ABORTED"
          : "RPG_CHOICE_AI_UNAVAILABLE",
    });
  } finally {
    clearTimeout(enhancementTimeout);
    input.signal?.removeEventListener("abort", relayAbort);
  }
}

export function buildRpgChatCustomAction(input: {
  snapshot: RpgChatSnapshot;
  action: string;
  rules?: RpgRuleSettings;
}) {
  if (!input.snapshot.progression.rpgState.customActionEnabled) {
    throw Object.assign(new Error("目前預設已關閉自訂行動，請從正式三選一中選擇。"), {
      code: "RPG_CUSTOM_ACTION_DISABLED",
    });
  }
  const protagonist = input.snapshot.characters.find((character) =>
    input.snapshot.storyBible.protagonistIds.includes(character.id))
    ?? input.snapshot.characters[0]
    ?? null;
  const causalKnowledge = normalizedCausalKnowledge(input.snapshot);
  return buildCustomRpgChoice({
    progression: input.snapshot.progression,
    action: input.action,
    protagonist: protagonist?.name ?? "主角",
    chapterTitle: input.snapshot.chapter.title,
    conflict: input.snapshot.conflict,
    rules: input.rules ?? DEFAULT_RPG_RULE_SETTINGS,
    storyState: input.snapshot.storyState,
    causalKnowledgeDigest: causalKnowledge.selectedRuleIds.length
      ? causalKnowledge.snapshotDigest
      : undefined,
  });
}

export function parseRpgChoiceSelection(
  input: string,
  choices: readonly RpgChoice[],
): RpgChoice | null {
  const value = input.normalize("NFKC").trim().toLocaleLowerCase();
  const compact = value.replace(/[\s，,。.!！?？、:：｜|／/()（）「」『』]/gu, "");
  const keyMatch = compact.match(/^(?:選擇|选择|選|选)?([abc])(?:路線|路线|選項|选项|方案)?$/iu);
  if (keyMatch) {
    const key = keyMatch[1].toUpperCase();
    return choices.find((choice) => choice.key === key) ?? null;
  }
  const ordinalPatterns: ReadonlyArray<readonly [number, RegExp]> = [
    [0, /^(?:(?:選擇|选择|選|选))?(?:1|一|第一|第1)(?:個|个|項|项|條|条|路|種|种|選項|选项|路線|路线)?$/u],
    [1, /^(?:(?:選擇|选择|選|选))?(?:2|二|第二|第2)(?:個|个|項|项|條|条|路|種|种|選項|选项|路線|路线)?$/u],
    [2, /^(?:(?:選擇|选择|選|选))?(?:3|三|第三|第3)(?:個|个|項|项|條|条|路|種|种|選項|选项|路線|路线)?$/u],
  ];
  for (const [index, pattern] of ordinalPatterns) {
    if (pattern.test(compact)) return choices[index] ?? null;
  }
  const strategy = /(?:穩健|稳健|觀察|观察|保守|安全)(?:路線|路线|策略|方案)?/u.test(compact)
    ? "steady"
    : /(?:資源|资源|關係|关系|交換|交换|協商|协商)(?:路線|路线|策略|方案)?/u.test(compact)
      ? "resource"
      : /(?:大膽|大胆|冒險|冒险|突破|高風險|高风险|激進|激进)(?:路線|路线|策略|方案)?/u.test(compact)
        ? "bold"
        : null;
  return strategy ? choices.find((choice) => choice.approach === strategy) ?? null : null;
}

export function validateRpgOutcomeNarrative(
  story: string,
  resolution: Pick<RpgChoiceResolution, "outcome" | "effect" | "settlement">,
  language: StoryOutputLanguage,
  choice?: Pick<RpgChoice, "title" | "description">,
) {
  const forbiddenNumberClaim = /(?:靈石|灵石|金幣|金币|行動點|行动点|經驗值|经验值|生命值|HP|氣運|气运|道心|心魔)\s*(?:增加|減少|减少|獲得|获得|失去|消耗|[+＋-－])?\s*\d+/iu;
  if (forbiddenNumberClaim.test(story)) {
    throw Object.assign(new Error("RPG_AI_STORY_INVENTED_NUMERIC_EFFECT"), {
      code: "RPG_AI_STORY_INVENTED_NUMERIC_EFFECT",
    });
  }
  const normalizedStory = story.normalize("NFKC").toLocaleLowerCase();
  const containsAny = (patterns: readonly string[]) => patterns.some((value) => normalizedStory.includes(value));
  if (choice && language !== "zh-CN") {
    const normalizedAction = `${choice.title} ${choice.description}`.normalize("NFKC").toLocaleLowerCase();
    const actionTokens = normalizedAction
      .split(/[\s，,。.!！?？、:：；;｜|／/()（）「」『』]+/gu)
      .flatMap((part) => {
        const characters = Array.from(part);
        if (characters.length < 3) return [];
        return Array.from({ length: Math.max(1, characters.length - 2) }, (_, index) =>
          characters.slice(index, index + 3).join(""));
      })
      .filter((token) => token.length >= 3);
    if (actionTokens.length && !actionTokens.some((token) => normalizedStory.includes(token))) {
      throw new Error("RPG_AI_STORY_SELECTED_ACTION_MISSING");
    }
  }
  if (resolution.outcome === "failure" && !containsAny(
    language === "en"
      ? ["failed", "did not", "could not", "fell short", "blocked"]
      : ["失敗", "失败", "未能", "沒能", "没能", "落空", "受阻"],
  )) throw new Error("RPG_AI_STORY_OUTCOME_MISMATCH");
  if (resolution.outcome === "partial_success" && !containsAny(
    language === "en"
      ? ["partial", "only part", "cost", "but", "not fully"]
      : ["部分", "只完成", "代價", "代价", "卻", "却", "未能全"],
  )) throw new Error("RPG_AI_STORY_OUTCOME_MISMATCH");
  if (
    (resolution.outcome === "success" || resolution.outcome === "critical_success")
    && containsAny(language === "en"
      ? ["complete failure", "nothing was achieved", "entirely failed"]
      : ["徹底失敗", "彻底失败", "一無所獲", "一无所获", "完全落空"])
  ) throw new Error("RPG_AI_STORY_OUTCOME_MISMATCH");
  const claimsRealmAdvancement = /(?:突破|晉升|晋升|踏入|升至|升到).{0,12}(?:境|期|真仙|金丹|元嬰|元婴|築基|筑基)/u.test(story);
  if (claimsRealmAdvancement && !resolution.settlement.realmChange?.breakthrough) {
    throw new Error("RPG_AI_STORY_UNAPPROVED_REALM_ADVANCEMENT");
  }
  const claimsNewFormalItem = /(?:獲得|获得|取得|拾得|煉成|炼成|領到|领到).{0,18}(?:丹|劍|剑|法寶|法宝|靈石|灵石|符|陣旗|阵旗)/u.test(story);
  const hasApprovedItemGain = Object.entries(resolution.effect.resourceChanges ?? {})
    .some(([key, value]) => value > 0 && (key.startsWith("item.") || key.startsWith("currency.") || key.startsWith("material.")));
  if (claimsNewFormalItem && !hasApprovedItemGain) {
    throw new Error("RPG_AI_STORY_UNAPPROVED_FORMAL_ITEM");
  }
  return true;
}

function narrativeFact(value: string | null | undefined, fallback: string, maximum = 56) {
  const compact = value?.replace(/\s+/gu, " ").trim() || fallback;
  return Array.from(compact).slice(0, maximum).join("");
}

function embeddedNarrativeFact(value: string) {
  return value.replace(/[。！？!?；;：:]+$/u, "").trim();
}

function readableAffiliationName(value: string | null | undefined) {
  const compact = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (
    !compact
    || compact.length > 32
    || compact.includes(":")
    || /^social-(?:family|institution)-/iu.test(compact)
    || /^[\da-f]{8,}(?:-[\da-f-]+)?$/iu.test(compact)
  ) return null;
  return narrativeFact(compact, "", 32) || null;
}

function affiliationNameFromLore(
  affiliationId: string | null,
  loreById?: ReadonlyMap<string, LoreEntry>,
) {
  if (!affiliationId) return null;
  const lore = loreById?.get(affiliationId);
  if (!lore || lore.kind !== "faction") return null;
  return loreDisplayParts(lore).name || null;
}

function inferredFamilyName(
  character: Character,
  familyId: string,
  loreById?: ReadonlyMap<string, LoreEntry>,
) {
  const canonical = affiliationNameFromLore(familyId, loreById);
  if (canonical) return canonical;
  const readable = readableAffiliationName(familyId);
  if (readable) return readable;
  const firstHan = Array.from(character.name).find((letter) => /[\u3400-\u9fff]/u.test(letter));
  return firstHan ? `${firstHan}氏家族` : `${narrativeFact(character.name, "該角色", 16)}家族`;
}

function inferredFactionName(
  character: Character,
  factionId: string,
  loreById?: ReadonlyMap<string, LoreEntry>,
) {
  const canonical = affiliationNameFromLore(factionId, loreById);
  if (canonical) return canonical;
  const readable = readableAffiliationName(factionId);
  if (readable) return readable;
  const identity = character.identity?.value?.replace(/\s+/gu, " ").trim() ?? "";
  const identityFaction = identity.match(/同時隸屬([^，。；、]{2,18})/u)?.[1]?.trim()
    ?? identity.match(/^([^，。；、]{2,18}?)(?:的|門下|所屬|成員|弟子|代表)/u)?.[1]?.trim();
  return identityFaction && identityFaction !== character.name
    ? identityFaction
    : null;
}

function characterNarrativeAffiliation(
  character: Character | null | undefined,
  loreById?: ReadonlyMap<string, LoreEntry>,
) {
  const familyId = character?.socialMatrixProfile?.familyId?.trim() || null;
  const factionId = character?.socialMatrixProfile?.institutionId?.trim()
    || character?.factionIds?.find((value) => value.trim() && value !== familyId)?.trim()
    || null;
  const familyLabel = character && familyId
    ? inferredFamilyName(character, familyId, loreById)
    : null;
  const factionLabel = character && factionId
    ? inferredFactionName(character, factionId, loreById)
    : null;
  return {
    familyId,
    factionId,
    familyLabel,
    factionLabel,
    affiliationKey: familyId
      ? `family:${familyId}`
      : factionId
        ? `faction:${factionId}`
        : null,
  };
}

function stageDistinctAffiliations(
  characters: readonly Character[],
  turn: number,
  loreById?: ReadonlyMap<string, LoreEntry>,
) {
  if (!characters.length) return [];
  const rotated = characters.map((_, index) => characters[(turn + index) % characters.length]);
  const staged: Character[] = [];
  const stagedIds = new Set<string>();
  const affiliationKeys = new Set<string>();
  for (const character of rotated) {
    const key = characterNarrativeAffiliation(character, loreById).affiliationKey;
    if (!key || affiliationKeys.has(key)) continue;
    staged.push(character);
    stagedIds.add(character.id);
    affiliationKeys.add(key);
    if (staged.length === 3) return staged;
  }
  for (const character of rotated) {
    if (stagedIds.has(character.id)) continue;
    staged.push(character);
    stagedIds.add(character.id);
    if (staged.length === 3) break;
  }
  return staged;
}

function relationshipNarrativeBetween(
  relationships: readonly CharacterRelationship[] | undefined,
  firstId: string | undefined,
  secondId: string | undefined,
) {
  if (!firstId || !secondId) return null;
  const relationship = (relationships ?? []).find((candidate) => (
    candidate.fromCharacterId === firstId && candidate.toCharacterId === secondId
  ) || (
    candidate.fromCharacterId === secondId && candidate.toCharacterId === firstId
  ));
  if (!relationship) return null;
  return narrativeFact(relationship.summary || relationship.kind, relationship.kind, 44);
}

function existingCharacterAsCandidate(
  character: Character | null | undefined,
  fallback: ProceduralCharacterCandidate,
): ProceduralCharacterCandidate {
  if (!character) return fallback;
  const name = embeddedNarrativeFact(narrativeFact(character.name, fallback.name, 24)) || fallback.name;
  const goal = embeddedNarrativeFact(narrativeFact(
    character.goal?.value,
    fallback.goal,
    36,
  ));
  const personality = character.personality?.value?.trim() || fallback.personality;
  const limitation = embeddedNarrativeFact(narrativeFact(
    character.limitations?.find((value) => value.trim()),
    fallback.refusalCondition,
    40,
  ));
  return {
    ...fallback,
    id: character.id,
    name,
    personality,
    goal,
    refusalCondition: limitation,
    proactiveAction: fallback.proactiveAction.replace(fallback.name, name),
    directDialogue: `「我願意一起處理，但不會放棄${goal}。」${name}沒有移開視線，「我的底線是：${limitation.replace(/^若/u, "一旦")}。」`,
    portrait: character.portrait ? {
      baseId: character.portrait.id,
      assetUri: character.portrait.assetUri,
      atlasCell: character.portrait.atlas
        ? character.portrait.atlas.row * character.portrait.atlas.columns + character.portrait.atlas.column
        : 0,
      visualSeed: character.portrait.assetDigest,
      visualDescription: character.portrait.visualDescription,
    } : fallback.portrait,
  };
}

function deterministicTurnContext(snapshot: RpgChatSnapshot) {
  const flags = storyWorldFlags(snapshot.storyState);
  const familyStage = buildFamilyStageNarrativeContext({
    lore: snapshot.lore ?? [],
    storyState: snapshot.storyState,
  });
  const protagonist = snapshot.characters.find((character) =>
    snapshot.storyBible.protagonistIds.includes(character.id))
    ?? snapshot.characters[0]
    ?? null;
  const existingSupporting = snapshot.characters.filter((character) => character.id !== protagonist?.id);
  const inventory = snapshot.progression.inventory.find((item) => item.quantity > 0) ?? null;
  const location = narrativeFact(snapshot.storyState.locationState, "目前場景");
  const conflict = narrativeFact(
    typeof flags["story.arc.goal"] === "string"
      ? String(flags["story.arc.goal"])
      : snapshot.conflict,
    `${snapshot.chapter.title}仍有必須處理的阻力`,
  );
  const turn = Math.max(0, Math.trunc(snapshot.progression.turn));
  const scenario = proceduralCharacterTreasureScenarioAt({
    seed: `${snapshot.project.id}|${snapshot.chapter.id}|${snapshot.playMode}`,
    ordinal: (Math.floor(turn / 3) * 7_919 + existingSupporting.length * 101) % PROCEDURAL_RELATIONSHIP_SCENARIO_CAPACITY,
    context: {
      genre: [snapshot.project.genrePackId, snapshot.project.genreId, snapshot.project.subgenreId]
        .filter(Boolean).join(" "),
      playMode: snapshot.playMode,
      storyTags: snapshot.lore?.slice(0, 6).map((entry) => `${entry.kind}:${entry.title}`) ?? [],
      protagonist: protagonist?.name,
      location,
      conflict,
    },
  });
  const stagedExisting = stageDistinctAffiliations(
    existingSupporting,
    turn,
    familyStage.loreById,
  );
  const rotatedProcedural = scenario.cast.members.map((_, index) =>
    scenario.cast.members[(turn + index) % scenario.cast.members.length]);
  const supporting = existingCharacterAsCandidate(stagedExisting[0], rotatedProcedural[0]);
  const counterforce = existingCharacterAsCandidate(stagedExisting[1], rotatedProcedural[1]);
  const witness = existingCharacterAsCandidate(stagedExisting[2], rotatedProcedural[2]);
  const castAffiliations = {
    supporting: characterNarrativeAffiliation(stagedExisting[0], familyStage.loreById),
    counterforce: characterNarrativeAffiliation(stagedExisting[1], familyStage.loreById),
    witness: characterNarrativeAffiliation(stagedExisting[2], familyStage.loreById),
  };
  const castRelationships = {
    supporting: relationshipNarrativeBetween(
      snapshot.relationships,
      protagonist?.id,
      stagedExisting[0]?.id,
    ),
    counterforce: relationshipNarrativeBetween(
      snapshot.relationships,
      protagonist?.id,
      stagedExisting[1]?.id,
    ),
    witness: relationshipNarrativeBetween(
      snapshot.relationships,
      protagonist?.id,
      stagedExisting[2]?.id,
    ),
  };
  const stagedCharacterIds = new Set([
    protagonist?.id,
    ...stagedExisting.map((character) => character.id),
  ].filter((value): value is string => Boolean(value)));
  const stagedAssetCandidates = familyStage.assets.filter((asset) =>
    Boolean(asset.holderCharacterId && stagedCharacterIds.has(asset.holderCharacterId)));
  const assetPool = stagedAssetCandidates.length ? stagedAssetCandidates : familyStage.assets;
  const stageAsset = assetPool.length
    ? assetPool[(turn + existingSupporting.length) % assetPool.length]!
    : null;
  const stageAssetLore = stageAsset ? familyStage.loreById.get(stageAsset.id) : null;
  const holderRelationship = stageAsset
    ? [
        stageAsset.controller ? `${stageAsset.controller}掌控` : null,
        stageAsset.holder ? `${stageAsset.holder}持有` : null,
        stageAsset.claimant && stageAsset.claimant !== "無其他聲索者"
          ? `${stageAsset.claimant}另有聲索`
          : null,
      ].filter(Boolean).join("，")
    : null;
  const treasure = stageAsset ? {
    ...scenario.treasure,
    id: stageAsset.id,
    ordinal: stageAssetLore?.proceduralTreasureProfile?.ordinal ?? scenario.treasure.ordinal,
    name: stageAsset.name,
    category: stageAsset.category,
    holderRelationship: holderRelationship || scenario.treasure.holderRelationship,
    function: stageAsset.function || scenario.treasure.function,
    limitation: stageAsset.limitation || scenario.treasure.limitation,
    cost: stageAsset.cost || scenario.treasure.cost,
    visualDescription: stageAsset.visualDescription || scenario.treasure.visualDescription,
  } : scenario.treasure;
  const activeFamilyIds = [
    familyStage.selectedStageFamily?.id,
    ...Object.values(castAffiliations).map((affiliation) => affiliation.familyId),
  ].filter((value): value is string => Boolean(value));
  const activeFactionIds = [
    stageAsset?.controllerOrganizationId,
    stageAsset?.claimantOrganizationId,
    ...Object.values(castAffiliations).map((affiliation) => affiliation.factionId),
  ].filter((value): value is string => Boolean(value));
  return {
    protagonist: protagonist?.name
      ?? (snapshot.language === "en" ? "The protagonist" : "主角"),
    supporting: supporting.name,
    supportingCharacter: supporting,
    counterforce,
    witness,
    castAffiliations,
    castRelationships,
    activeFamilyIds,
    activeFactionIds,
    selectedStageFamily: familyStage.selectedStageFamily,
    stagedOrganizations: familyStage.organizations,
    stageAsset,
    scenario,
    conflict,
    unresolved: narrativeFact(
      typeof flags["story.arc.thread"] === "string"
        ? String(flags["story.arc.thread"])
        : snapshot.storyBible.unresolvedThreads.at(-1),
      "先前留下的承諾仍未得到回答",
    ),
    location,
    inventory: inventory?.name ?? "現有資源",
    storyProp: stageAsset?.name ?? inventory?.name ?? scenario.treasure.name,
    treasure,
  };
}

function countConsecutiveRpgSetbacks(receipts: readonly RpgTurnReceipt[]) {
  let count = 0;
  for (const receipt of receipts) {
    if (receipt.outcome === "failure" || receipt.outcome === "partial_success") count += 1;
    else break;
  }
  return count;
}

type RpgCausalInferenceDimension = keyof ReturnType<
  typeof buildProceduralCausalFrame
>["inferenceDimensions"];

const STORY_LIBRARY_CAUSAL_TARGET: Record<
  ProceduralCausalDimensionId,
  RpgCausalInferenceDimension
> = {
  trigger: "catalyst",
  desire: "goal",
  agency: "pressure",
  relationship: "leverage",
  resource: "resourceProp",
  stance: "relationshipTension",
  price: "cost",
  constraint: "deadline",
  refusal: "reversal",
  consequence: "aftermath",
};

/** One causal contract is shared by closed-AI direction and rules fallback. */
export function buildRpgTurnCausalContract(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  outcome?: RpgChoiceResolution["outcome"];
}) {
  const context = deterministicTurnContext(input.snapshot);
  const causalKnowledge = normalizedCausalKnowledge(input.snapshot);
  const causalSignals = input.snapshot.playMode === "romance"
    ? (causalKnowledge?.causalSignals ?? []).map((signal) => ({
        ...signal,
        statement: romanceSafeProceduralText(signal.statement),
        operation: romanceSafeProceduralText(signal.operation),
        constraint: romanceSafeProceduralText(signal.constraint),
        evaluate: romanceSafeProceduralText(signal.evaluate),
      }))
    : causalKnowledge?.causalSignals ?? [];
  const arc = readStoryArcRuntime({
    storyState: input.snapshot.storyState,
    projectId: input.snapshot.project.id,
    progressionTurn: input.snapshot.progression.turn,
    fallbackGoal: context.conflict,
    fallbackThread: context.unresolved,
  });
  const crossCausalDimensions = Object.fromEntries(
    context.scenario.causalDimensions.map((dimension) => [
      STORY_LIBRARY_CAUSAL_TARGET[dimension.id],
      dimension.signal,
    ]),
  ) as Partial<ReturnType<typeof buildProceduralCausalFrame>["inferenceDimensions"]>;
  return buildProceduralCausalFrame({
    encounter: input.choice.encounter,
    protagonist: context.protagonist,
    supportingCharacter: context.supporting,
    location: context.location,
    conflict: input.choice.encounter.arcGoal ?? context.conflict,
    unresolvedThread: input.choice.encounter.arcThread ?? context.unresolved,
    availableResource: context.inventory,
    outcome: input.outcome,
    consecutiveSetbacks: countConsecutiveRpgSetbacks(input.snapshot.rpgTurnReceipts ?? []),
    arcKey: input.choice.encounter.arcKey ?? arc.key,
    turn: input.choice.encounter.arcLocalTurn ?? arc.localTurn,
    arcHorizon: input.choice.encounter.arcHorizon ?? arc.horizon,
    approvedEnding: arc.ending.isEnding,
    relationshipScenarioId: context.scenario.id,
    crossCausalDimensions,
    causalKnowledge: causalKnowledge.selectedRuleIds.length ? {
      snapshotVersion: causalKnowledge.snapshotVersion,
      snapshotDigest: causalKnowledge.snapshotDigest,
      selectedRuleIds: causalKnowledge.selectedRuleIds,
      signals: causalSignals,
      maximumRules: causalKnowledge.maximumRules,
      entireLibraryScanned: false,
    } : undefined,
  });
}

/**
 * The rules engine keeps the complete bounded-arc contract internally.  Closed
 * AI receives only reader-visible continuity, prose dimensions, and directions
 * that are already available on the current screen.
 */
export function buildRpgReaderSafeCausalPayload(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  outcome?: RpgChoiceResolution["outcome"];
}) {
  const contract = buildRpgTurnCausalContract(input);
  const disclosure = contract.persistentArc.readerDisclosure;
  const mayRevealCurrentDirections = disclosure.mayRevealClosureChoices
    || disclosure.mayRevealPostEndingActions;
  const currentDirections = mayRevealCurrentDirections
    ? input.snapshot.baseChoices.map((choice) => {
        const safeChoice = buildRpgReaderSafeChoicePayload(choice);
        return {
          key: safeChoice.key,
          title: safeChoice.title,
          description: safeChoice.description,
          consequenceTeaser: safeChoice.consequenceTeaser,
        };
      })
    : [];
  const consequence = mayRevealCurrentDirections
    ? `${contract.inferenceDimensions.reversal}${contract.inferenceDimensions.aftermath}${disclosure.readerBeat}`
    : contract.consequenceBeat;
  return toRpgReaderSafePromptPayload({
    continuity: {
      goal: contract.persistentArc.goal,
      unresolvedThread: contract.persistentArc.unresolvedThread,
      currentStoryBeat: disclosure.readerBeat,
      currentDirections,
    },
    narrativeDimensions: contract.inferenceDimensions,
    sceneBeats: {
      inciting: contract.incitingBeat,
      pressure: contract.pressureBeat,
      opportunity: contract.opportunityBeat,
      consequence,
    },
    progressSupport: {
      progress: contract.hopeGuard.progressBeat,
      recovery: contract.hopeGuard.recoveryBeat,
    },
  });
}

export function buildRpgOutcomeLines(choice: RpgChoice, resolution: RpgChoiceResolution) {
  return [
    `行動結果：${choice.key === "custom" ? "自由行動" : choice.key}｜${choice.title}｜${resolution.outcomeLabel}`,
    `收益：${choice.impactLabels.join("、") || "保留可繼續推進的線索"}`,
    `代價：${choice.costLabels.join("、") || choice.consequenceTeaser}`,
    `規則判定：${resolution.roll}/${resolution.successChance}；正式數值只會在你核准正文後一次寫入。`,
  ];
}

function compactDeterministicCausalDimension(value: string, maximum = 44) {
  const normalized = value
    .normalize("NFC")
    .replace(/核准規則校準\s*[：:]\s*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length <= maximum) return normalized;
  return `${sliceDeterministicText(normalized, maximum - 1)}…`;
}

function sliceDeterministicText(value: string, maximum: number) {
  let output = "";
  for (const character of value) {
    if (output.length + character.length > maximum) break;
    output += character;
  }
  return output;
}

function compactDeterministicCausalDimensions(
  dimensions: ReturnType<typeof buildRpgTurnCausalContract>["inferenceDimensions"],
) {
  return {
    catalyst: compactDeterministicCausalDimension(dimensions.catalyst),
    goal: compactDeterministicCausalDimension(dimensions.goal),
    pressure: compactDeterministicCausalDimension(dimensions.pressure),
    leverage: compactDeterministicCausalDimension(dimensions.leverage),
    resourceProp: compactDeterministicCausalDimension(dimensions.resourceProp),
    relationshipTension: compactDeterministicCausalDimension(dimensions.relationshipTension),
    cost: compactDeterministicCausalDimension(dimensions.cost),
    deadline: compactDeterministicCausalDimension(dimensions.deadline),
    reversal: compactDeterministicCausalDimension(dimensions.reversal),
    aftermath: compactDeterministicCausalDimension(dimensions.aftermath),
  };
}

function finishDeterministicParagraph(value: string, language: StoryOutputLanguage) {
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return language === "en"
      ? "The immediate consequence remained visible and could not be reset."
      : language === "zh-CN"
        ? "眼前后果仍然有效，不能回到选择之前。"
        : "眼前後果仍然有效，不能回到選擇之前。";
  }
  const hasTerminalPunctuation = language === "en"
    ? /(?:[.!?]|…)["'’”)]?$/u.test(normalized)
    : /(?:[。！？!?]|……|…)[」』）》】"]?$/u.test(normalized);
  if (hasTerminalPunctuation) return normalized;
  return `${normalized.replace(/[，,；;：:、…—.\-\s]+$/gu, "")}${language === "en" ? "." : "。"}`;
}

function pendingQuotationClosers(value: string) {
  const openingToClosing = new Map([
    ["「", "」"],
    ["『", "』"],
    ["“", "”"],
    ["（", "）"],
    ["《", "》"],
    ["【", "】"],
  ]);
  const closing = new Set(openingToClosing.values());
  const stack: string[] = [];
  for (const character of Array.from(value)) {
    const expectedClosing = openingToClosing.get(character);
    if (expectedClosing) {
      stack.push(expectedClosing);
    } else if (closing.has(character) && stack.at(-1) === character) {
      stack.pop();
    }
  }
  return stack.reverse().join("");
}

function closeDeterministicQuotation(value: string, maximum: number) {
  let body = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const closers = pendingQuotationClosers(body);
    if (!closers) return body;
    if (Array.from(body).length + Array.from(closers).length <= maximum) {
      return `${body}${closers}`;
    }
    body = sliceDeterministicText(body, maximum - Array.from(closers).length);
  }
  return body;
}

function truncateDeterministicParagraph(
  value: string,
  maximum: number,
  language: StoryOutputLanguage,
) {
  const normalized = finishDeterministicParagraph(value, language);
  if (normalized.length <= maximum) return normalized;
  const prefix = sliceDeterministicText(normalized, maximum - 2);
  const sentenceBoundary = Math.max(
    prefix.lastIndexOf("。"),
    prefix.lastIndexOf("！"),
    prefix.lastIndexOf("？"),
    prefix.lastIndexOf("!"),
    prefix.lastIndexOf("?"),
    prefix.lastIndexOf("."),
  );
  if (sentenceBoundary >= Math.floor(maximum * 0.78)) {
    return closeDeterministicQuotation(
      finishDeterministicParagraph(prefix.slice(0, sentenceBoundary + 1), language),
      maximum,
    );
  }
  let body = prefix.replace(/[，,；;：:、…—.\-\s]+$/gu, "").trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const closers = pendingQuotationClosers(body);
    const ending = `${language === "en" ? "…" : "……"}${closers}`;
    const remaining = maximum - Array.from(ending).length;
    const clipped = sliceDeterministicText(body, remaining)
      .replace(/[，,；;：:、…—.\-\s]+$/gu, "")
      .trim();
    if (clipped === body) return `${body}${ending}`;
    body = clipped;
  }
  return closeDeterministicQuotation(body, maximum);
}

function deterministicStoryLength(title: string, paragraphs: readonly string[]) {
  return [title, ...paragraphs].join("").replace(/\s+/gu, "").length;
}

function finalizeDeterministicRpgStory(input: {
  title: string;
  paragraphs: readonly string[];
  language: StoryOutputLanguage;
}) {
  const paragraphMaximum = input.language === "en" ? 208 : 150;
  const titleMaximum = input.language === "en" ? 90 : 64;
  const minimumLength = input.language === "en" ? 950 : 900;
  const targetMinimum = minimumLength + 24;
  const title = sliceDeterministicText(
    input.title.normalize("NFC").replace(/\s+/gu, " ").trim(),
    titleMaximum,
  );
  const paragraphs = input.paragraphs.map((paragraph) =>
    truncateDeterministicParagraph(paragraph, paragraphMaximum, input.language));
  const padding = input.language === "en"
    ? [
        "Everyone checked the conditions still available before moving again.",
        "That confirmation preserved the cost and did not reset the result.",
        "Outside the room, approaching footsteps made the changed situation impossible to ignore.",
      ]
    : input.language === "zh-CN"
      ? [
          "众人重新核对仍可动用的条件，没有把愿望误当成已经完成的结果。",
          "这份确认没有抹去代价，只让后续能够承接已经发生的变化。",
          "门外逐渐逼近的脚步声，让已经发生的变化再也无法被忽略。",
        ]
      : [
          "眾人重新核對仍可動用的條件，沒有把願望誤當成已經完成的結果。",
          "這份確認沒有抹去代價，只讓後續能夠承接已經發生的變化。",
          "門外逐漸逼近的腳步聲，讓已經發生的變化再也無法被忽略。",
        ];
  for (let attempt = 0; deterministicStoryLength(title, paragraphs) < targetMinimum && attempt < 40; attempt += 1) {
    const indexes = paragraphs
      .map((paragraph, index) => ({ index, length: paragraph.length }))
      .sort((left, right) => left.length - right.length || left.index - right.index);
    const supplement = padding[attempt % padding.length];
    const target = indexes.find(({ length }) => length + supplement.length + 1 <= paragraphMaximum);
    if (!target) break;
    paragraphs[target.index] = finishDeterministicParagraph(
      `${paragraphs[target.index]} ${supplement}`,
      input.language,
    );
  }
  return `${title}\n\n${paragraphs.join("\n\n")}`;
}

function deterministicPostArcOutcome(
  resolution: RpgChoiceResolution,
  language: StoryOutputLanguage,
) {
  if (language === "en") {
    if (resolution.outcome === "failure") {
      return "The attempt failed to arrange every detail, but it did not undo the ending or reopen the resolved conflict.";
    }
    if (resolution.outcome === "partial_success") {
      return "Only part of the intended arrangement was secured, but the cost remained visible and the ending stayed final.";
    }
    return resolution.outcome === "critical_success"
      ? "The arrangement succeeded beyond expectation while leaving the completed ending intact."
      : "The arrangement succeeded, and every retained consequence remained attached to the completed ending.";
  }
  if (language === "zh-CN") {
    if (resolution.outcome === "failure") {
      return "这次安置未能顾全每个细节，但失败没有撤销结局，也没有重新打开已经解决的冲突。";
    }
    if (resolution.outcome === "partial_success") {
      return "这次只完成部分安置，代价仍清楚保留，已经落定的结局也没有因此失效。";
    }
    return resolution.outcome === "critical_success"
      ? "这次安置取得超出预期的成功，同时完整保留已经落定的结局。"
      : "这次安置成功完成，所有留下的后果仍然归属于已经落定的结局。";
  }
  if (resolution.outcome === "failure") {
    return "這次安置未能顧全每個細節，但失敗沒有撤銷結局，也沒有重新打開已經解決的衝突。";
  }
  if (resolution.outcome === "partial_success") {
    return "這次只完成部分安置，代價仍清楚保留，已經落定的結局也沒有因此失效。";
  }
  return resolution.outcome === "critical_success"
    ? "這次安置取得超出預期的成功，同時完整保留已經落定的結局。"
    : "這次安置成功完成，所有留下的後果仍然歸屬於已經落定的結局。";
}

function deterministicProseHash(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value.normalize("NFC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function chooseDeterministicProse<T>(seed: string, values: readonly T[], offset = 0) {
  return values[(deterministicProseHash(`${seed}|${offset}`) + offset) % values.length];
}

function spokenByCharacter(value: string, protagonist: string) {
  return value.replace(/主角/gu, protagonist);
}

/**
 * Reader-facing Traditional Chinese fallback. The causal contract, rolls,
 * state deltas and learning-rule receipts stay outside the novel body.  This
 * function renders only scene, character agency, dialogue, action and result.
 */
function buildTraditionalNovelFallback(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  context: ReturnType<typeof deterministicTurnContext>;
  turn: number;
}) {
  const { snapshot, choice, resolution, context } = input;
  const protagonist = context.protagonist;
  const ally = context.supportingCharacter;
  const counterforce = context.counterforce;
  const witness = context.witness;
  const treasure = context.treasure;
  const stageAsset = context.stageAsset;
  const stageOrganization = context.stagedOrganizations.find((organization) =>
    organization.id === stageAsset?.controllerOrganizationId
      || organization.id === stageAsset?.claimantOrganizationId)
    ?? context.stagedOrganizations[0]
    ?? null;
  const causalFrame = buildRpgTurnCausalContract({ snapshot, choice, outcome: resolution.outcome });
  const seed = stableStringify({
    projectId: snapshot.project.id,
    chapterId: snapshot.chapter.id,
    turn: input.turn,
    playMode: snapshot.playMode,
    choice: choice.title,
    outcome: resolution.outcome,
    scenario: context.scenario.id,
    learnedShape: causalFrame.inferenceDimensions,
  });
  const weather = chooseDeterministicProse(seed, [
    "窗縫灌進來的風把紙角吹得不停顫動",
    "遠處的鐘聲被雨幕磨得低沉而急促",
    "屋簷落水一滴接一滴，像有人在暗處計時",
    "燈芯爆出細小火花，牆上的影子也跟著一縮",
    "門外忽然安靜下來，反而襯得室內每次呼吸都格外清楚",
  ]);
  const sensory = chooseDeterministicProse(seed, [
    "潮濕木料、舊紙與冷茶的氣味混在一起",
    "石地留下凌亂水痕，鞋底每移一步都發出短促摩擦聲",
    "未散的藥香貼在衣袖上，苦味一直壓到舌根",
    "桌面殘留一圈乾涸墨跡，幾張被反覆折過的紙壓在燈下",
    "外頭人聲忽近忽遠，偶爾夾著車輪或金屬碰撞的聲響",
  ], 1);
  const visiblePressure = chooseDeterministicProse(seed, [
    "門外傳來第三次催促，等候的人已經失去耐性",
    "一名陌生人從窗前走過兩次，第二次停得明顯更久",
    "原本答應保持中立的人先一步撤走，留下的位置立刻被另一方占住",
    "通往後門的燈忽然熄滅，熟悉的退路因此變得難以判斷",
    "遠端送來的消息少了一行關鍵內容，卻多出一枚不該出現的印記",
  ], 2);
  const outcomeProse = resolution.outcome === "critical_success"
    ? `${protagonist}的安排成功得超出預期。眼前難題被推開之餘，一份原本不肯露面的證據也隨之現身；在場的人都看見，這並非幸運憑空降臨，而是先前每一步試探終於連成了線。`
    : resolution.outcome === "success"
      ? `${protagonist}的安排成功了。最迫切的危機終於被壓住，然而留在現場的痕跡也證明，事情只是改變了形狀，並沒有因此失去重量。`
      : resolution.outcome === "partial_success"
        ? `計畫只完成了一部分，卻已把局面推過無法回頭的界線。${protagonist}保住最重要的一端，另一端則在眾目睽睽下脫手，代價比預想更早落到每個人面前。`
        : `${protagonist}原先的安排未能成功。阻力在最後一步合攏，把眾人逼回門內；但那次失敗也讓藏在暗處的人露出手勢，至少沒有人再把真正的阻礙認錯。`;
  const allySpeech = spokenByCharacter(ally.directDialogue, protagonist);
  const allyAction = spokenByCharacter(ally.proactiveAction, protagonist);
  const counterSpeech = spokenByCharacter(counterforce.directDialogue, protagonist);
  const counterAction = spokenByCharacter(counterforce.proactiveAction, protagonist);
  const witnessAction = spokenByCharacter(witness.proactiveAction, protagonist);
  const allyGroup = context.castAffiliations.supporting.familyLabel
    ?? context.castAffiliations.supporting.factionLabel;
  const counterGroup = context.castAffiliations.counterforce.familyLabel
    ?? context.castAffiliations.counterforce.factionLabel;
  const witnessGroup = context.castAffiliations.witness.familyLabel
    ?? context.castAffiliations.witness.factionLabel;
  const allyCollectiveBeat = allyGroup
    ? `${allyGroup}的人先封住側門，把退路留給傷者；`
    : "";
  const counterCollectiveBeat = counterGroup
    ? `${counterGroup}也換下門外哨位，把出入口握在自己手中。`
    : "";
  const witnessCollectiveBeat = witnessGroup
    ? `${witnessGroup}的信使送來兩份互相矛盾的證詞；`
    : "";
  const familyCollectiveBeat = context.selectedStageFamily
    ? `${context.selectedStageFamily.name}沒有置身事外，族中負責接應的人已守在門外；`
    : "";
  const organizationPressureBeat = stageOrganization
    ? `${stageOrganization.kind}「${stageOrganization.name}」派人封住另一端，表面為了${stageOrganization.publicGoal || "維持眼前秩序"}，實際上仍受${stageOrganization.hiddenConflict || stageOrganization.rivals || "未公開的內部爭議"}牽制。`
    : "";
  const stageAssetOwnershipBeat = stageAsset
    ? `${stageAsset.controller ? `${stageAsset.controller}控制此物` : "此物的控制權尚未落定"}，${stageAsset.holder ? `${stageAsset.holder}此刻親自持有` : "持有人仍未現身"}${stageAsset.claimant && stageAsset.claimant !== "無其他聲索者" ? `，${stageAsset.claimant}則當眾提出聲索` : ""}。${stageAsset.storyHook ? narrativeFact(stageAsset.storyHook, "它已被捲入眼前爭端", 70) : "它已被捲入眼前爭端"}`
    : "";
  const allyRelationshipBeat = context.castRelationships.supporting
    ? `兩人之間那段「${embeddedNarrativeFact(context.castRelationships.supporting)}」的舊關係，也因此被迫攤到燈下。`
    : "";
  const terminalAction = choice.encounter.arcNextAction
    ?? (choice.encounter.arcPhase === "resolution" ? "resolution" : null);
  const modeOpening = snapshot.playMode === "management"
    ? `${context.location}裡還亮著最後一盞燈。${weather}。${sensory}。${protagonist}沒有再看那份被改過條件的交付單，而是把它推到桌面中央，當著所有人的面說出要做的事：「${choice.title}，現在開始。」`
    : snapshot.playMode === "romance"
      ? `${context.location}比平常更安靜。${weather}。${sensory}。${protagonist}原本準備好的話到了唇邊，最後只留下最誠實的一句：「我選擇${choice.title}，但答案由你自己決定。」`
      : `${context.location}的光線被來往人影切成幾段。${weather}。${sensory}。${protagonist}確認退路仍在，才將手按上${context.storyProp}，依照「${choice.title}」邁出第一步。`;
  const modeAction = snapshot.playMode === "management"
    ? `${protagonist}只動用眼前已有的${context.inventory}，把人分成兩組：一組查清最早出現異常的環節，另一組守住仍能兌現的承諾。每張單據都必須找到經手者，每個承諾都得有人願意署名。`
    : snapshot.playMode === "romance"
      ? `${protagonist}沒有追著解釋，只把${context.inventory}和曾經隱瞞的部分放到兩人都看得見的位置。問題一個接一個說清，沒有替對方預設原諒，也沒有把沉默當成默許。`
      : `${protagonist}只帶上${context.inventory}，壓低身形沿著既有痕跡前進，先用${context.storyProp}確認方位，再把退路留給身後的人。每個動作都能被看見，也因此無法假裝沒有做過。`;
  const titleImage = chooseDeterministicProse(seed, [
    `${context.location}未熄的燈`,
    `${treasure.name}留下的影子`,
    `${counterforce.name}推開的門`,
    `${snapshot.chapter.title}的雨聲`,
    `${ally.name}沒有說完的話`,
  ], 3);
  const embeddedConflict = embeddedNarrativeFact(context.conflict);

  const paragraphs = [
    modeOpening,
    `${familyCollectiveBeat}${allyCollectiveBeat}${allyAction}${allySpeech}${ally.name}把條件說得很清楚。那不是替${protagonist}補位，而是為了${ally.goal}；若這件事被忽略，${ally.name}寧可獨自離開。${allyRelationshipBeat}`,
    `${treasure.name}就在這時被帶到眾人眼前。${stageAssetOwnershipBeat || treasure.holderRelationship}；它可以${treasure.function}，卻也有不能繞過的缺口：${treasure.limitation}。${protagonist}只查看封口與磨損，沒有把尚未屬於自己的東西收進手中。`,
    `${counterCollectiveBeat}${organizationPressureBeat}${counterforce.name}沒有等人邀請便插手。${counterAction}${counterSpeech}${visiblePressure}。${counterforce.name}想守住的是${counterforce.goal}，即使合作也不會沿著${protagonist}預先畫好的線走。`,
    modeAction,
    `${witnessCollectiveBeat}${witness.name}原本站在光線以外，此刻卻主動改變局面。${witnessAction}隨後，${witness.name}把看見的細節交給兩邊核對，卻扣下最關鍵的一句，要求眾人先證明誰願意承擔後果。`,
    outcomeProse,
    `${ally.name}沒有因結果立刻改變立場。${ally.name}先將能保住的部分交給${witness.name}看管，再把${treasure.name}推回原持有人面前。${treasure.cost}，這筆代價落在眾人之間，也讓原本模糊的信任有了明確邊界。`,
    `直到人聲稍歇，${protagonist}才從散亂痕跡裡辨出「${context.unresolved}」的新線索。它指向${counterforce.name}先前避開的那個位置，也解釋了「${embeddedConflict}」為何會在今天忽然惡化。答案仍不完整，方向卻再也不是原地打轉。`,
    terminalAction === "archive-ending"
      ? `${protagonist}最後關上門，讓${titleImage}停在身後。${ally.name}、${counterforce.name}與${witness.name}各自帶走應負的責任，沒有人再把已結束的衝突喚回來；那道關門聲落下後，故事真正安靜了。`
      : terminalAction === "epilogue"
        ? `天色慢慢越過${context.location}，${titleImage}也不再催促任何人。三人各自安置留下的傷、承諾與工作，沒有新的危機闖入這幅畫面；即使旅程就停在此處，他們也已經擁有完整的去向。`
        : terminalAction === "new-arc"
          ? `${titleImage}在清晨重新顯出輪廓。舊事沒有被推翻，${ally.name}保留的證據卻指向另一個從未回答的問題；${protagonist}帶著已承擔的一切走向新地點，另一段故事由此開始。`
          : terminalAction === "resolution"
            ? `${titleImage}終於安定下來。${protagonist}沒有再追逐多餘的勝利，只與三人確認誰留下、誰離開，以及什麼已經不能挽回。當最後一個人走出${context.location}，這段紛爭也抵達了真正的終點。`
            : `${titleImage}還留在原處，卻已和片刻前不同。門外三聲叩響，新條件已送到門檻；${ally.name}握住尚未交出的證據，${counterforce.name}則伸手攔住${witness.name}。門閂被推開以前，${protagonist}必須決定先相信誰。`,
  ];
  return finalizeDeterministicRpgStory({ title: `〈${titleImage}〉`, paragraphs, language: "zh-TW" });
}

function buildDeterministicPostArcStory(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  context: ReturnType<typeof deterministicTurnContext>;
  turn: number;
}) {
  const nextAction = input.choice.encounter.arcNextAction;
  if (!nextAction) return null;
  const flags = storyWorldFlags(input.snapshot.storyState);
  const oldThread = narrativeFact(
    typeof flags["story.arc.resolvedThread"] === "string"
      ? String(flags["story.arc.resolvedThread"])
      : input.context.unresolved,
    input.context.unresolved,
  );
  const newThread = narrativeFact(
    input.choice.encounter.arcThread,
    input.snapshot.language === "en"
      ? "a consequence left by the completed ending"
      : input.snapshot.language === "zh-CN"
        ? "由既有结局后果形成的续篇命题"
        : "由既有結局後果形成的續篇命題",
  );
  const newGoal = narrativeFact(
    input.choice.encounter.arcGoal,
    input.snapshot.language === "en"
      ? "define and answer the next volume's central responsibility"
      : input.snapshot.language === "zh-CN"
        ? "确认并回应下一卷必须承担的核心责任"
        : "確認並回應下一卷必須承擔的核心責任",
  );
  const result = deterministicPostArcOutcome(input.resolution, input.snapshot.language);

  if (input.snapshot.language === "en") {
    const actionToken = nextAction === "epilogue"
      ? "閱讀尾聲"
      : nextAction === "new-arc"
        ? "開啟續篇"
        : "封存結局";
    const title = nextAction === "epilogue"
      ? `Round ${input.turn} | Epilogue after the settled ending`
      : nextAction === "new-arc"
        ? `Round ${input.turn} | The next volume begins`
        : `Round ${input.turn} | The ending is archived`;
    const paragraphs = nextAction === "epilogue"
      ? [
          `${actionToken} named the chosen action, but it did not become another crisis. The resolved conflict stayed closed while the scene moved quietly through the people, promises, and material consequences left behind by the ending.`,
          `At the established location, the protagonist checked what could actually be carried forward. No lost time returned, no spent supply reappeared, and no convenient discovery replaced the price already paid to finish the former arc.`,
          `The nearest companion answered with measured honesty. Trust retained the exact distance earned before the ending, so gratitude could coexist with caution and affection could remain present without erasing an unresolved personal boundary.`,
          `Each surviving character received a concrete place in the aftermath. Their decisions were described through work, departure, recovery, or continued responsibility rather than through a promise that everything had suddenly become perfect.`,
          `${result} The important fact was not a fresh victory, but the preservation of a truthful ending whose gains and losses could still be recognized by everyone involved.`,
          `The closure record remained unchanged. Its arc key, settled goal, resolved thread, resolution kind, and original completion turn stayed fixed, so reading this epilogue could not consume the ending twice.`,
          `Canon, relationships, abilities, equipment, funds, and timeline history all kept their established values. The epilogue interpreted those facts as lived consequences without silently granting a new reward or applying a second gameplay cost.`,
          `The former thread remained resolved and could not return under a renamed disguise. Any future volume would need a different causal question drawn from another established clue or from a consequence that this ending genuinely created.`,
          `For now, the final image belonged to rest and recognition. The characters understood what had ended, what they had kept, and what they would carry even if no further volume were ever opened.`,
          `The epilogue closed on that complete image. It offered space to remember the journey and preserved the possibility of a sequel, yet it created no ordinary crisis choices and demanded no replay of the settled conflict.`,
        ]
      : nextAction === "new-arc"
        ? [
            `${actionToken} marked a genuine continuation rather than a reset. The completed arc remained in the ledger, while a distinct causal question took shape from a surviving Canon clue or a consequence created by the ending.`,
            `Nothing about the former resolution was revoked. Its settled thread stayed closed, its costs stayed paid, and its witnesses retained the knowledge and relationships earned before the opening of this volume.`,
            `The protagonist entered the new volume with the same abilities, equipment, funds, obligations, and personal history. Continuity therefore shaped the opening conditions instead of serving as decoration around a fresh blank state.`,
            `The new thread and goal were recorded as a separate contract. They defined one bounded responsibility for this volume and prevented the director from recycling the former hook merely because it was familiar.`,
            `The nearest companion recognized both continuity and change. Their existing trust affected how they responded, but the new problem still required a fresh decision instead of automatic loyalty or an unexplained reversal.`,
            `${result} The meaningful success was the clean handoff between volumes: the old ending remained immutable while the new setup gained a clear subject, pressure, and reachable conclusion.`,
            `The story advanced to the real opening of this volume. Reading an epilogue beforehand could not make the sequel skip the first encounter with its new responsibility or erase the choices that shaped that encounter.`,
            `No resolved thread returned to the unresolved list. If no older open clue was available, the system used a visible consequence of the ending to form a new proposition with a different key, goal, and responsibility.`,
            `The location, cast, and retained resources now established the first causal frame. Pressure could rise from that frame, but every later turn would still have to advance, transform, or settle this specific new thread.`,
            `The next volume was now genuinely open. Three contextual approaches waited at its first decision point, each tied to the preserved state and none pretending that the completed ending had never happened.`,
          ]
        : [
            `${actionToken} was the final authorized act for this arc. The archive preserved the completed ending exactly as approved and did not reinterpret closure as a temporary pause before another automatic emergency.`,
            `The former goal remained complete and its thread remained resolved. Evidence, relationships, resources, and losses stayed attached to the characters who had carried them through the ending.`,
            `The protagonist did not search for another door at the edge of the scene. Instead, the final place was allowed to keep its silence, its visible repairs, and the marks left by decisions that could not be taken back.`,
            `The nearest companion acknowledged the same boundary. Their final gesture neither promised a hidden continuation nor erased the distance that remained between them after the cost of closure.`,
            `${result} Archiving did not grant another reward, repeat a settlement, or change the immutable completion record; it only confirmed that the work would remain at its complete endpoint.`,
            `The closure ledger kept its original arc key, goal, resolved thread, resolution kind, and completion turn. Repeating the archive request therefore could not create a second receipt or rewrite history.`,
            `Canon and all retained state remained available for reading, export, or a separately authorized future project action. None of those preservation operations counted as a new story turn inside this archived arc.`,
            `No ordinary branch cards were generated after the terminal flag was written. There was no concealed fourth route, no renamed copy of the resolved hook, and no automatic opening of another volume.`,
            `The final image held long enough for every consequence to become legible. What was saved, what was lost, and who accepted responsibility could be understood without another conflict being attached to it.`,
            `The archive closed there as a complete endpoint. The story remained readable and its history remained intact, but this arc had no further playable action and consumed no additional choice.`,
          ];
    return finalizeDeterministicRpgStory({ title, paragraphs, language: input.snapshot.language });
  }

  if (input.snapshot.language === "zh-CN") {
    const title = nextAction === "epilogue"
      ? `第 ${input.turn} 回合｜尾声：安置人物与成果`
      : nextAction === "new-arc"
        ? `第 ${input.turn} 回合｜开启续篇／下一卷`
        : `第 ${input.turn} 回合｜封存结局：完整终点`;
    const paragraphs = nextAction === "epilogue"
      ? [
          `选择“阅读尾声”之后，现场没有再长出一场危机。已经解决的因果链保持关闭，叙事只沿着人物、承诺、资源与环境留下的余波缓慢移动。`,
          `主角在原来的地点逐项核对能够保留的事物。失去的时间没有倒转，消耗的资源没有恢复，已经承担的责任也没有被一段温柔文字轻易抹去。`,
          `同行者以克制而诚实的态度回应。信任停在此前真正累积的位置，感谢可以存在，警戒也可以保留，关系不因结局就突然变成毫无裂缝的圆满。`,
          `其他人物也获得明确安置：有人继续修复，有人带着职责离开，有人选择留下照看后果。他们的去向来自既有选择，而不是临时编造的奖励。`,
          `${result}这次行动的价值不在于制造新胜利，而在于让所有人都能辨认这段旅程真正得到、失去并承担了什么。`,
          `结案记录保持不变。故事弧编号、目标、已解决线索、结案方式与原完成回合都固定保存，阅读尾声不会把同一个结局再结算一次。`,
          `作品设定、人物关系、能力、装备、资金与时间线全都沿用原值。尾声只把这些事实转化为生活后果，不暗中增加奖励，也不支付第二次代价。`,
          `旧线索不会换个名称回到未解清单。若未来开启续篇，必须采用另一条既有线索，或由当前结局造成的明确后果建立全新因果命题。`,
          `此刻的画面属于休息与确认。人物知道什么已经结束、什么被保留下来，也知道即使没有下一卷，他们仍会带着这些经历继续生活。`,
          `尾声最终停在完整画面上。它保留未来开启续篇的可能，却不会产生普通危机路线，也不会要求人物重新处理已经解决的冲突。`,
        ]
      : nextAction === "new-arc"
        ? [
            `选择“开启续篇／下一卷”不是重新开始，而是让另一条因果链从既有结局之后成立。旧弧仍留在结案记录中，新命题来自作品原有线索或真实后果。`,
            `旧结局没有被撤销。已经关闭的线索继续关闭，支付过的代价仍然有效，见证者也保留他们在上一卷获得的知识与关系位置。`,
            `主角带着同一份作品设定、能力、装备、资金、关系与时间线进入续篇。连续性直接决定开场条件，不会只当作装饰摆在一张空白地图旁边。`,
            `新线索与新目标以独立契约保存。它们规定本卷必须回应的核心责任，也阻止系统因为熟悉而把上一卷的问题改名重复。`,
            `同行者同时认得延续与变化。既有信任会影响他的反应，但新问题仍需要新的判断，不能靠自动忠诚或突然翻转替主角完成。`,
            `${result}真正完成的是两卷之间的交接：旧结局保持不可更改，新阶段则取得明确主题、压力与能够抵达的收束方向。`,
            `作品推进到续篇真实开始的位置。先阅读尾声不会让下一卷跳过人物首次面对新责任的场景，也不会抹去塑造这次相遇的旧选择。`,
            `已解决线索不会回到未解清单。若没有其他旧线索，系统会从结局留下的可见后果形成不同编号、目标与责任的新命题。`,
            `地点、人物与保留资源共同组成续篇第一份因果框架。以后每个回合都必须推进、转化或回收这条新线索，不能无限增加无关伏笔。`,
            `下一卷至此正式开启。第一个决策点出现三种符合当前状态的方法，各自具有不同后果，也都承认上一卷确实已经完成。`,
          ]
        : [
            `选择“封存结局”是目前故事弧最后一次有效行动。系统保存已经核准的完整终点，不把结案曲解成下一场自动危机之前的短暂停顿。`,
            `原目标继续维持完成，旧线索继续维持解决。证据、关系、资源与损失仍属于一路承担它们的人物，没有任何内容被归零。`,
            `主角没有在场景边缘寻找另一扇门，而是让最后地点保留安静、修复痕迹与那些无法撤回的选择。故事因此拥有真正停下来的权利。`,
            `同行者也承认同一条边界。他最后的动作没有暗示隐藏续集，也没有抹去结案代价留在两人之间的真实距离。`,
            `${result}封存不会再次发奖、重复结算或修改不可变记录，只确认作品停在已经完成的终点。`,
            `结案台账保留原故事弧编号、目标、已解决线索、结案方式与完成回合。重复提出封存请求不会产生第二张凭证，也不会重写历史。`,
            `作品设定与所有保留状态仍可阅读、导出或备份。这些保存操作不是本故事弧的新回合，也不会改变人物已经承担的后果。`,
            `终止标记写入后，系统不会再建立普通分支卡。这里没有隐藏的第四条路，没有旧线索的改名复制，也不会自动开启下一卷。`,
            `最后画面停留到每项后果都清楚可见。保住了什么、失去了什么、谁愿意负责，都能在不追加冲突的情况下被理解。`,
            `封存最终停在完整终点。故事仍然可以阅读，历史仍然完整，但本弧已经没有可执行行动，也不会再消耗任何选择。`,
          ];
    return finalizeDeterministicRpgStory({ title, paragraphs, language: input.snapshot.language });
  }

  const title = nextAction === "epilogue"
    ? `第 ${input.turn} 回合｜尾聲：安置人物與成果`
    : nextAction === "new-arc"
      ? `第 ${input.turn} 回合｜開啟續篇／下一卷`
      : `第 ${input.turn} 回合｜封存結局：完整終點`;
  const paragraphs = nextAction === "epilogue"
    ? [
        `選擇「閱讀尾聲」之後，現場沒有再長出一場危機。已經解決的因果鏈保持關閉，敘事只沿著人物、承諾、資源與環境留下的餘波緩慢移動。`,
        `${input.context.protagonist}在${input.context.location}逐項核對能夠保留的事物。失去的時間沒有倒轉，消耗的${input.context.inventory}沒有恢復，已經承擔的責任也沒有被一段溫柔文字輕易抹去。`,
        `${input.context.supporting}以克制而誠實的態度回應。信任停在此前真正累積的位置，感謝可以存在，警戒也可以保留，關係不因結局就突然變成毫無裂縫的圓滿。`,
        `其他人物也獲得明確安置：有人繼續修復，有人帶著職責離開，有人選擇留下照看後果。他們的去向來自既有選擇，而不是臨時編造的獎勵。`,
        `${result}這次行動的價值不在製造新勝利，而在讓所有人都能辨認這段旅程真正得到、失去並承擔了什麼。`,
        `結案紀錄保持不變。故事弧編號、目標、已解決線索「${oldThread}」、結案方式與原完成回合都固定保存，閱讀尾聲不會把同一個結局再結算一次。`,
        `作品 Canon、人物關係、能力、裝備、資金與時間線全都沿用原值。尾聲只把這些事實轉化為生活後果，不暗中增加獎勵，也不支付第二次代價。`,
        `舊線索不會換個名稱回到未解清單。若未來開啟續篇，必須採用另一條既有線索，或由目前結局造成的明確後果建立全新因果命題。`,
        `此刻的畫面屬於休息與確認。人物知道什麼已經結束、什麼被保留下來，也知道即使沒有下一卷，他們仍會帶著這些經歷繼續生活。`,
        `尾聲最終停在完整畫面上。它保留未來開啟續篇的可能，卻不會產生普通危機路線，也不會要求人物重新處理已經解決的衝突。`,
      ]
    : nextAction === "new-arc"
      ? [
          `選擇「開啟續篇／下一卷」不是重新開始，而是讓另一條因果鏈從既有結局之後成立。舊弧仍留在結案紀錄中，新命題「${newThread}」來自作品原有線索或真實後果。`,
          `舊結局沒有被撤銷。已經關閉的線索「${oldThread}」繼續關閉，支付過的代價仍然有效，見證者也保留他們在上一卷取得的知識與關係位置。`,
          `${input.context.protagonist}帶著同一份 Canon、能力、裝備、資金、關係與時間線進入續篇。連續性直接決定開場條件，不會只當作裝飾擺在一張空白地圖旁邊。`,
          `新目標「${newGoal}」以獨立契約保存。它規定本卷必須回應的核心責任，也阻止系統因為熟悉而把上一卷的問題改名重複。`,
          `${input.context.supporting}同時認得延續與變化。既有信任會影響回應，但新問題仍需要新的判斷，不能靠自動忠誠或突然翻轉替${input.context.protagonist}完成。`,
          `${result}真正完成的是兩卷之間的交接：舊結局保持不可更改，新階段則取得明確主題、壓力與能夠抵達的收束方向。`,
          `作品推進到續篇真實開始的位置。先閱讀尾聲不會讓下一卷跳過人物首次面對新責任的場景，也不會抹去塑造這次相遇的舊選擇。`,
          `已解決線索不會回到未解清單。若沒有其他舊線索，系統會從結局留下的可見後果形成不同編號、目標與責任的新命題。`,
          `${input.context.location}、既有人物與保留資源共同組成續篇第一份因果框架。往後每回合都必須推進、轉化或回收這條新線索，不能無限增加無關伏筆。`,
          `下一卷至此正式開啟。第一個決策點出現三種符合目前狀態的方法，各自具有不同後果，也都承認上一卷確實已經完成。`,
        ]
      : [
          `選擇「封存結局」是目前故事弧最後一次有效行動。系統保存已經核准的完整終點，不把結案曲解成下一場自動危機之前的短暫停頓。`,
          `原目標繼續維持完成，舊線索「${oldThread}」繼續維持解決。證據、關係、資源與損失仍屬於一路承擔它們的人物，沒有任何內容被歸零。`,
          `${input.context.protagonist}沒有在${input.context.location}邊緣尋找另一扇門，而是讓最後地點保留安靜、修復痕跡與那些無法撤回的選擇。故事因此擁有真正停下來的權利。`,
          `${input.context.supporting}也承認同一條邊界。最後的動作沒有暗示隱藏續集，也沒有抹去結案代價留在彼此之間的真實距離。`,
          `${result}封存不會再次發獎、重複結算或修改不可變紀錄，只確認作品停在已經完成的終點。`,
          `結案台帳保留原故事弧編號、目標、已解決線索、結案方式與完成回合。重複提出封存要求不會產生第二張憑證，也不會重寫歷史。`,
          `作品 Canon 與所有保留狀態仍可閱讀、匯出或備份。這些保存操作不是本故事弧的新回合，也不會改變人物已經承擔的後果。`,
          `終止標記寫入後，系統不會再建立普通分支卡。這裡沒有隱藏的第四條路，沒有舊線索的改名複製，也不會自動開啟下一卷。`,
          `最後畫面停留到每項後果都清楚可見。保住了什麼、失去了什麼、誰願意負責，都能在不追加衝突的情況下被理解。`,
          `封存最終停在完整終點。故事仍然可以閱讀，歷史仍然完整，但本弧已經沒有可執行行動，也不會再消耗任何選擇。`,
        ];
  return finalizeDeterministicRpgStory({ title, paragraphs, language: input.snapshot.language });
}

export function buildDeterministicRpgTurnStory(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
}) {
  const context = deterministicTurnContext(input.snapshot);
  const protagonist = context.protagonist;
  const turn = input.snapshot.progression.turn + 1;
  if (input.snapshot.language === "zh-TW") {
    return buildTraditionalNovelFallback({ ...input, context, turn });
  }
  const postArcStory = buildDeterministicPostArcStory({
    ...input,
    context,
    turn,
  });
  if (postArcStory) return postArcStory;
  if (input.snapshot.language === "en") {
    const result = input.resolution.outcome === "critical_success"
      ? "The action succeeded beyond its immediate aim and exposed an additional opening."
      : input.resolution.outcome === "success"
        ? "The action succeeded, although the changed situation still demanded attention."
        : input.resolution.outcome === "partial_success"
          ? "Only part of the aim was secured, and the cost arrived before the remaining problem could be solved."
          : "The attempt failed to achieve its intended aim, but the obstruction revealed a concrete way to continue.";
    const paragraphs = [
      `At ${context.location}, ${protagonist} chose “${input.choice.title}” to answer the immediate conflict: ${context.conflict}. The decision began with ${context.storyProp}, the resource already present, rather than an advantage invented after the fact.`,
      `${context.supporting} moved first, not as an obedient helper but to protect a separate goal: ${context.supportingCharacter.goal}. The two agreed on what each would do, and on the line ${context.supporting} would refuse to cross.`,
      `${context.counterforce.name} reacted before the arrangement was complete. Seeking ${context.counterforce.goal}, the opposing figure shifted the pressure toward ${context.unresolved} and forced the chosen action to become visible to every witness.`,
      `${context.treasure.name} became the center of the dispute. It could ${context.treasure.function}, but ${context.treasure.limitation}; ownership, access, and responsibility therefore mattered as much as possession.`,
      `${protagonist} used ${context.inventory} to carry out the selected approach. ${input.choice.encounter.complication} The action consumed the promised time and position, so retreat could no longer restore the scene to its earlier state.`,
      `${result} ${input.choice.encounter.locationShift} The outcome answered the chosen action specifically and left a visible fact that no later explanation could erase.`,
      `${context.witness.name} checked what remained and recorded who had acted first. ${context.supporting} kept cooperating, but the response made clear that trust now depended on how ${protagonist} handled the cost already paid.`,
      `${input.choice.encounter.worldAspect} changed the meaning of ${context.location}. The opposition could no longer pretend nothing had happened, while the protagonists could no longer rely on the route or neutrality they had before this turn.`,
      `Evidence from the action exposed a new edge of “${context.unresolved}.” It pointed back to ${context.counterforce.name} and explained why ${context.conflict} had intensified now, carrying the same story forward instead of reopening its beginning.`,
      `${protagonist} ended the turn with three concrete facts: what the choice achieved, what it cost, and who now controlled ${context.treasure.name}. The next decision must begin from those facts; none of the unchosen paths has occurred.`,
    ];
    return finalizeDeterministicRpgStory({
      title: `Round ${turn} | ${input.choice.title}`,
      paragraphs,
      language: input.snapshot.language,
    });
  }
  if (input.snapshot.language === "zh-CN") {
    const result = input.resolution.outcome === "critical_success"
      ? "这次行动不但成功完成原定目标，还揭开了一条额外通路。"
      : input.resolution.outcome === "success"
        ? "这次行动成功达成目标，但改变后的局势仍需要马上处理。"
        : input.resolution.outcome === "partial_success"
          ? "目标只完成了一部分，代价却先一步落下，剩余问题仍在逼近。"
          : "这次尝试未能达成原定目标，行动失败了，但阻力也暴露出可以继续追查的具体方向。";
    const paragraphs = [
      `${protagonist}在${context.location}选定“${input.choice.title}”，正面回应“${context.conflict}”。第一步只动用现场已有的${context.storyProp}，没有临时获得不属于自己的能力或资源。`,
      `${context.supporting}先移到侧面接应，却没有盲目服从。为了${context.supportingCharacter.goal}，两人当场分清各自负责的行动，也说定一旦碰到${context.supportingCharacter.refusalCondition}便立即停手。`,
      `${context.counterforce.name}察觉安排后抢先改变位置。此人要守住的是${context.counterforce.goal}，于是把压力推向“${context.unresolved}”，迫使这次选择暴露在所有目击者面前。`,
      `${context.treasure.name}随即成为争夺中心。它可以${context.treasure.function}，却受限于${context.treasure.limitation}；谁持有、谁有权动用、谁承担代价，必须分别说清。`,
      `${protagonist}带着${context.inventory}执行既定方案。${input.choice.encounter.complication}行动占用了已经承诺的时间与位置，退回原处也无法把一切恢复成选择之前。`,
      `${result}${input.choice.encounter.locationShift}这项结果明确回应了刚才的行动，也留下任何人都无法靠事后解释抹去的证据。`,
      `${context.witness.name}核对现场并记下谁先采取行动。${context.supporting}仍愿意合作，却把信任系在${protagonist}接下来是否承担已付代价之上，没有因为一次成败突然改变态度。`,
      `${input.choice.encounter.worldAspect}改变了${context.location}的意义。对手不能再假装无事发生，${protagonist}一方也失去了原先那条退路与中立位置，故事因此真正向前移动。`,
      `行动留下的痕迹揭开“${context.unresolved}”的新一角，并指向${context.counterforce.name}先前避开的地方。它解释了“${context.conflict}”为何此刻恶化，却没有把已完成的行动重新再演一次。`,
      `${protagonist}最后确认三件事：刚才完成了什么、付出了什么，以及${context.treasure.name}目前由谁控制。接下来的故事只能从这些事实继续，未选择的两条路线都没有发生。`,
    ];
    return finalizeDeterministicRpgStory({
      title: `${context.location}｜${context.treasure.name}`,
      paragraphs,
      language: input.snapshot.language,
    });
  }
  const result = input.resolution.outcome === "critical_success"
    ? "這次行動不只成功完成原定目標，還揭開了一條額外通路。"
    : input.resolution.outcome === "success"
      ? "這次行動成功達成目標，但改變後的局勢仍需要立刻處理。"
      : input.resolution.outcome === "partial_success"
      ? "目標只完成了一部分，代價卻先一步落下，剩餘問題仍在逼近。"
      : "這次嘗試未能達成原定目標，行動失敗了，但阻力也暴露出可以繼續追查的具體方向。";
  const causalFrame = buildRpgTurnCausalContract({
    snapshot: input.snapshot,
    choice: input.choice,
    outcome: input.resolution.outcome,
  });
  const dimensions = compactDeterministicCausalDimensions(causalFrame.inferenceDimensions);
  const commonOpening = `${dimensions.catalyst}${dimensions.goal}${protagonist}在${context.location}面對「${context.conflict}」，選定「${input.choice.title}」後立刻行動，沒有重開故事或重演未選路線。`;
  const commonResources = `${dimensions.leverage}${dimensions.resourceProp}`;
  const commonRelationship = dimensions.relationshipTension;
  const commonResistance = `${dimensions.pressure}${dimensions.deadline}`;
  const commonCost = dimensions.cost;
  const commonResult = `${result}${causalFrame.hopeGuard.progressBeat}${dimensions.reversal}${protagonist}清楚區分已完成與仍未解決的部分。`;
  const commonAftermath = `${dimensions.aftermath}${causalFrame.hopeGuard.recoveryBeat}`;
  const modeParagraphs: Record<StoryPlayModeId, string[]> = {
    rpg: [
      commonOpening,
      `${commonResources}${protagonist}先確認${context.inventory}仍可使用，再沿退路探查阻力來源。裝備不是萬能答案，任務也不會自行完成；他只能把既有條件落成旁人看得見的動作。`,
      `${commonRelationship}${context.supporting}察覺意圖後移到側面掩護，卻沒有盲目服從。對方用一句急促提醒指出最危險的位置，使合作有了具體作用，也留下稍後必須說清的責任。`,
      `${commonResistance}光影、腳步與壓低的呼吸持續升高。每次停頓都會讓對手收窄空間，每次冒進也可能過早暴露意圖，行動只能服從已選方法。`,
      `${commonCost}當退路在身後收窄，代價便無法撤回。${protagonist}付出行動要求的體力、行動點與既定資源，沒有靠突然出現的寶物解圍；風險也留下可追查的痕跡。`,
      commonResult,
      `${context.supporting}沒有因一次結果就完全改變立場，只在看見${protagonist}承擔後果後多給了一點合作空間。那份克制讓關係變化顯得真實：信任可以累積，警戒也仍在，下一次同行必須繼續用行動證明。`,
      `${commonAftermath}${input.choice.encounter.locationShift}使場景重新排列，${input.choice.encounter.worldAspect}也不再只是背景。新的路線暴露在視線中，原先安全的角落失去中立。`,
      `未解線索「${context.unresolved}」在變動中露出新的邊角，卻沒有立刻得到答案。它與本次選擇留下的後果扣在一起，形成下一回合能追查、能防守也可能反過來利用的具體危機。`,
      `${protagonist}在新的局勢邊緣停下。眼前已出現三種互不相同的策略：先穩住傷害、調度現有裝備與盟友，或冒險逼近未解線索；他不能同時完成三者，只能帶著本回合結算後的狀態作出下一次決定。`,
    ],
    romance: [
      commonOpening,
      `${commonResources}${protagonist}先確認可用條件只剩${context.inventory}，沒有替${context.supporting}決定感受，而是把目的、限制與可能代價說清。關係推進建立在對方知道自己能拒絕的前提上。`,
      `${commonRelationship}${context.supporting}沉默片刻才回應，語氣裡同時有信任與保留。那句話沒有讓關係突然圓滿，卻指出事件進度下一個可確認的門檻。`,
      `${commonResistance}光影、距離與壓低的聲音持續升高。每次停頓都可能讓誤會加深，每句回答也必須服從彼此已說明的界線，不能靠強迫或巧合抹去。`,
      `${commonCost}氣氛升高時，${protagonist}仍守住彼此已說明的界線。代價落在時間、信任與錯過其他機會上；人物成長是願意在不確定中說真話並接受答案。`,
      commonResult,
      `${context.supporting}根據實際結果調整了距離：願意保留下一次談話的入口，卻沒有忘記尚未兌現的部分。關係因此前進了一小步，也留下新的疑問，信任、事件進度與個人成長將在後續回合分別累積。`,
      `${commonAftermath}${input.choice.encounter.locationShift}讓兩人的相處位置改變，${input.choice.encounter.worldAspect}則把私人的決定推向更大的外部壓力。旁人的目光與有限時間同時逼近。`,
      `未解心結「${context.unresolved}」被本次行動重新照亮。它沒有被一句承諾消除，反而成為下一次必須面對的事件節點：可以先修補信任、共同處理外患，或冒險追問一直避開的真相。`,
      `${protagonist}看著${context.supporting}留下的反應，知道下一步不能只重複同一句告白。新的三條路必須分別改變關係、事件與人物成長，而且每條路都有不同代價；故事停在雙方仍有選擇權的位置。`,
    ],
    management: [
      commonOpening,
      `${commonResources}${protagonist}攤開帳冊，先確認${context.inventory}與現有人力、品質承諾後才下令。每項調度都會占用團隊時間與體力，也會改變聲望、風險和下回合能動用的資源。`,
      `${commonRelationship}${context.supporting}代表團隊提出反對，指出速度與品質無法同時拉滿。${protagonist}要求對方標出最可能失守的環節，使人力配置成為可驗證的選擇。`,
      `${commonResistance}通知、腳步與帳頁翻動聲持續升高。每次停頓都會縮短交付窗口，每次冒進也可能提早暴露品質缺口，調度只能依照已選策略執行。`,
      `${commonCost}窗口一旦關閉，投入就無法全數收回。資金、工時與信用都沿著決策流出；即使成功，也必須支付維持品質與履行承諾的成本。`,
      commonResult,
      `${context.supporting}根據結算結果重新安排人手，沒有因一次勝負就讓組織突然翻身。團隊看見${protagonist}是否承擔責任，士氣與信任因此小幅移動；這種變化會影響下一輪執行，而不是只留在對話裡。`,
      `${commonAftermath}${input.choice.encounter.locationShift}改變了客戶與競爭者的判斷，${input.choice.encounter.worldAspect}也讓聲望不再只是面板數字。市場開始形成下一回合的實際壓力。`,
      `尚未化解的營運危機「${context.unresolved}」在帳冊上留下新的缺口。它可以靠保守止損、重新調度資金人力，或抓住市場窗口正面突破，但三者會分別牽動品質、聲望與風險。`,
      `${protagonist}合上帳冊時，新的三條策略已經清楚分開。他必須以更新後的資金、人力、品質、聲望與風險選下一步，不能回到第一回合，也不能把剛才的三個選項原樣再印一次。`,
    ],
    interactive: [],
    general: [],
  };
  const paragraphs = modeParagraphs[input.snapshot.playMode].length
    ? modeParagraphs[input.snapshot.playMode]
    : modeParagraphs.rpg;
  return finalizeDeterministicRpgStory({
    title: `第 ${turn} 回合｜${input.choice.title}`,
    paragraphs,
    language: input.snapshot.language,
  });
}

function assertRpgArcActionAvailable(snapshot: RpgChatSnapshot, choice: RpgChoice) {
  const flags = storyWorldFlags(snapshot.storyState);
  if (flags["story.arc.archived"] === true) {
    throw Object.assign(new Error("這個結局已封存；目前故事弧沒有可再消耗的行動。"), {
      code: "STORY_ARC_ARCHIVED",
    });
  }
  if (
    choice.disabledReason
    || (
      choice.encounter.arcNextAction === "epilogue"
      && flags["story.arc.epilogueRead"] === true
    )
  ) {
    throw Object.assign(new Error(choice.disabledReason || "尾聲已閱讀；請開啟續篇或封存結局。"), {
      code: "STORY_ARC_EPILOGUE_ALREADY_READ",
    });
  }
}

function attachProceduralSceneReceipt(
  snapshot: RpgChatSnapshot,
  resolution: RpgChoiceResolution,
): RpgChoiceResolution {
  const context = deterministicTurnContext(snapshot);
  const previousActors = typeof snapshot.storyState.worldFlags?.["story.recentSupportingActors"] === "string"
    ? String(snapshot.storyState.worldFlags["story.recentSupportingActors"])
        .split("|").map((value) => value.trim()).filter(Boolean)
    : [];
  const recentActors = [
    context.supportingCharacter.id,
    context.counterforce.id,
    context.witness.id,
    ...previousActors,
  ]
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 9);
  const activeFamilyIds = context.activeFamilyIds
    .filter((value, index, all) => all.indexOf(value) === index);
  const activeFactionIds = context.activeFactionIds
    .filter((value, index, all) => all.indexOf(value) === index);
  const effect = {
    ...resolution.effect,
    worldFlags: {
      ...(resolution.effect.worldFlags ?? {}),
      "story.activeSupportingCharacterId": context.supportingCharacter.id,
      "story.activeSupportingCharacterName": context.supportingCharacter.name,
      "story.activeCounterforceCharacterId": context.counterforce.id,
      "story.activeCounterforceCharacterName": context.counterforce.name,
      "story.activeWitnessCharacterId": context.witness.id,
      "story.activeWitnessCharacterName": context.witness.name,
      "story.activeFamilyIds": activeFamilyIds.join("|"),
      "story.activeFactionIds": activeFactionIds.join("|"),
      "story.activeTreasureId": context.treasure.id,
      "story.activeTreasureName": context.treasure.name,
      ...(context.stageAsset ? {
        "story.activeStageAssetLoreId": context.stageAsset.id,
        ...(context.stageAsset.holderCharacterId
          ? { "story.activeStageAssetHolderCharacterId": context.stageAsset.holderCharacterId }
          : {}),
        ...(context.stageAsset.controllerOrganizationId
          ? { "story.activeStageAssetControllerOrganizationId": context.stageAsset.controllerOrganizationId }
          : {}),
        ...(context.stageAsset.claimantOrganizationId
          ? { "story.activeStageAssetClaimantOrganizationId": context.stageAsset.claimantOrganizationId }
          : {}),
      } : {}),
      "story.relationshipScenarioId": context.scenario.id,
      "story.recentSupportingActors": recentActors.join("|"),
    },
  };
  return {
    ...resolution,
    effect,
    settlement: {
      ...resolution.settlement,
      resolvedEffect: structuredClone(effect),
    },
  };
}

export async function buildDeterministicRpgChatTurnCandidate(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution?: RpgChoiceResolution;
  failureReason?: string;
}): Promise<RpgChatTurnCandidate> {
  assertRpgArcActionAvailable(input.snapshot, input.choice);
  const fallbackStartedAt = performance.now();
  const resolution = attachProceduralSceneReceipt(input.snapshot, input.resolution ?? resolveRpgChoice(input.choice, {
    seed: `${input.snapshot.progression.procedural.runSeed}|${input.snapshot.chapter.id}|${input.snapshot.progression.turn}`,
    revision: input.snapshot.storyState.revision,
    recentEncounterSignatures: input.snapshot.progression.procedural.recentEncounterSignatures,
    turn: input.snapshot.progression.turn,
    storyState: input.snapshot.storyState,
  }));
  const story = buildDeterministicRpgTurnStory({
    snapshot: input.snapshot,
    choice: input.choice,
    resolution,
  });
  validateRpgStoryTurnContract(story, input.snapshot.language);
  validateRpgOutcomeNarrative(story, resolution, input.snapshot.language, input.choice);
  const candidateDigest = await sha256Hex(story.normalize("NFKC"));
  const contextDigest = await sha256Hex(stableStringify(input.snapshot.directorContext));
  const modelDigest = await sha256Hex("rules-only:immersive-story-turn-contract-v1");
  const taskId = `rules-rpg-turn:${candidateDigest.slice(0, 24)}`;
  const fallbackGenerationMs = Math.max(0, performance.now() - fallbackStartedAt);
  return {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    taskId,
    candidateId: taskId,
    candidateDigest,
    model: "rules-only",
    modelDigest,
    actualExecutor: "deterministic-rule-fallback",
    executionReceipt: withCausalKnowledgeReceipt({
      receiptId: `rules-receipt:${candidateDigest.slice(0, 24)}`,
      fallback: true,
      handoffReason: input.failureReason ?? "RPG_STORY_AI_UNAVAILABLE",
      fallbackGenerationMs,
      reason: input.failureReason ?? "RPG_STORY_AI_UNAVAILABLE",
      externalRequest: false,
      dataLeftDevice: false,
    }, input.snapshot),
    contextDigest,
    sourceChapterId: input.snapshot.chapter.id,
    sourceRevision: input.snapshot.chapter.revision,
    choice: input.choice,
    resolution,
    story,
    outcomeLines: buildRpgOutcomeLines(input.choice, resolution),
    canonicalMutationCount: 0,
    dataLeftDevice: false,
    externalRequest: false,
  };
}

export async function generateRpgChatTurnCandidate(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
}): Promise<RpgChatTurnCandidate> {
  assertRpgArcActionAvailable(input.snapshot, input.choice);
  const resolution = attachProceduralSceneReceipt(input.snapshot, resolveRpgChoice(input.choice, {
    seed: `${input.snapshot.progression.procedural.runSeed}|${input.snapshot.chapter.id}|${input.snapshot.progression.turn}`,
    revision: input.snapshot.storyState.revision,
    recentEncounterSignatures: input.snapshot.progression.procedural.recentEncounterSignatures,
    turn: input.snapshot.progression.turn,
    storyState: input.snapshot.storyState,
  }));
  const outcomeLines = buildRpgOutcomeLines(input.choice, resolution);
  const readerSafeCausalContract = buildRpgReaderSafeCausalPayload({
    snapshot: input.snapshot,
    choice: input.choice,
    outcome: resolution.outcome,
  });
  const directorPrompt = buildRpgResolutionDirectorPrompt({
    context: input.snapshot.directorContext,
    choice: input.choice,
    language: input.snapshot.language,
    turnNumber: input.snapshot.progression.turn + 1,
    resolution: {
      outcomeLabel: resolution.outcomeLabel,
      roll: resolution.roll,
      successChance: resolution.successChance,
      settlement: outcomeLines,
    },
    readerSafeCausalContract,
  });
  const recentAcceptedTexts = input.snapshot.acceptedChoices
    .slice(0, 8)
    .map((item) => item.acceptedText);
  const baseSeed = (
    input.snapshot.storyState.revision * 1009
    + input.snapshot.progression.turn * 149
    + resolution.roll * 23
  ) >>> 0;
  let generated: Awaited<ReturnType<typeof runStudioClosedAI>> | null = null;
  let story = "";
  let validationCorrection = "";
  let generationError: unknown = null;
  const generationController = new AbortController();
  const relayAbort = () => generationController.abort(input.signal?.reason);
  if (input.signal?.aborted) relayAbort();
  else input.signal?.addEventListener("abort", relayAbort, { once: true });
  const generationTimeout = setTimeout(() => {
    generationController.abort("RPG_STORY_AI_TIMEOUT");
  }, RPG_CHAT_STORY_AI_TIMEOUT_MS);
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      generated = await runStudioClosedAI({
        projectId: input.snapshot.project.id,
        task: "branch_choice",
        input: `${directorPrompt}${validationCorrection}`,
        targetLength: input.snapshot.language === "en" ? 1_700 : 1_600,
        sourceChapterId: input.snapshot.chapter.id,
        sourceRevision: input.snapshot.chapter.revision,
        qualityMode: "fast",
        browserComputePolicy: "balanced",
        generationOptions: {
          maxTokens: 1_792,
          temperature: attempt === 1 ? 0.72 : 0.66,
          topP: attempt === 1 ? 0.92 : 0.88,
          repetitionPenalty: 1.18,
          seed: (baseSeed + (attempt - 1) * 104_729) >>> 0,
          substantiveScene: true,
        },
        signal: generationController.signal,
        onProgress: input.onProgress,
      });
      try {
        story = await cleanRpgContinuation(
          generated.content,
          recentAcceptedTexts,
          input.snapshot.language,
        );
        validateRpgOutcomeNarrative(story, resolution, input.snapshot.language, input.choice);
        break;
      } catch (error) {
        if (generated.candidateId) {
          await rejectStudioClosedAgentCandidate(generated.candidateId).catch(() => undefined);
        }
        if (attempt === 2) throw error;
        const errorCode = error instanceof Error ? error.message : String(error);
        const metrics = error && typeof error === "object"
          ? error as Record<string, unknown>
          : {};
        validationCorrection = `\n\n${JSON.stringify({
          validatorCorrection: {
            errorCode,
            narrativeLength: Number(metrics.narrativeLength) || 0,
            paragraphCount: Number(metrics.paragraphCount) || 0,
            sentenceCount: Number(metrics.sentenceCount) || 0,
            requiredNarrativeCharacters: input.snapshot.language === "en"
              ? "1100-2200"
              : "900-1600",
            requiredParagraphs: "8-16",
            lockedOutcome: resolution.outcome,
            instruction: input.snapshot.language === "en"
              ? "Discard the previous attempt. Regenerate from scratch; preserve the locked outcome, invent no numeric resource changes, and write exactly 10 substantial story paragraphs."
              : "捨棄前次內容並從頭重寫；明確服從鎖定結果，不得自創任何資源數字；以文學標題起首，之後恰好寫 10 個完整小說段落，正文不得出現任何規則或系統術語。",
          },
        })}`;
      }
    }
    if (!generated || !story) throw new Error("RPG_AI_CONTINUATION_EMPTY");
    if (
      !hasVerifiedExecutedStoryOutput(generated)
      || !generated.candidateId
      || !generated.modelDigest
      || generated.sourceChapterId !== input.snapshot.chapter.id
      || generated.sourceRevision !== input.snapshot.chapter.revision
      || generated.canonicalMutationCount !== 0
      || generated.externalRequest
      || generated.dataLeftDevice
    ) {
      if (generated.candidateId) {
        await rejectStudioClosedAgentCandidate(generated.candidateId).catch(() => undefined);
      }
      throw Object.assign(new Error("閉端 AI 本回合內容缺少模型、章節或執行證明。"), {
        code: "RPG_CHAT_TURN_PROOF_MISSING",
      });
    }
  } catch (error) {
    if (input.signal?.aborted) throw error;
    generationError = error;
    if (generated?.candidateId) {
      await rejectStudioClosedAgentCandidate(generated.candidateId).catch(() => undefined);
    }
    generated = null;
    story = buildDeterministicRpgTurnStory({
      snapshot: input.snapshot,
      choice: input.choice,
      resolution,
    });
    validateRpgStoryTurnContract(story, input.snapshot.language);
    validateRpgOutcomeNarrative(story, resolution, input.snapshot.language, input.choice);
  } finally {
    clearTimeout(generationTimeout);
    input.signal?.removeEventListener("abort", relayAbort);
  }
  if (!generated) {
    return buildDeterministicRpgChatTurnCandidate({
      snapshot: input.snapshot,
      choice: input.choice,
      resolution,
      failureReason: generationError && typeof generationError === "object" && "code" in generationError
        ? String((generationError as { code?: unknown }).code ?? "RPG_STORY_AI_UNAVAILABLE")
        : "RPG_STORY_AI_UNAVAILABLE",
    });
  }
  return {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    taskId: generated.taskId,
    candidateId: generated.candidateId,
    candidateDigest: generated.contentDigest,
    model: generated.model,
    modelDigest: generated.modelDigest,
    actualExecutor: generated.actualExecutor,
    executionReceipt: withCausalKnowledgeReceipt(generated.executionReceipt, input.snapshot),
    contextDigest: generated.contextDigest,
    sourceChapterId: input.snapshot.chapter.id,
    sourceRevision: input.snapshot.chapter.revision,
    choice: input.choice,
    resolution,
    story,
    outcomeLines,
    canonicalMutationCount: 0,
    dataLeftDevice: false,
    externalRequest: false,
  };
}

export async function approveRpgChatTurn(input: {
  repository: NovelRepository;
  snapshot: RpgChatSnapshot;
  candidate: RpgChatTurnCandidate;
  conversationApproval?: AcceptChoiceConversationApprovalInput;
  afterCanonicalCommit?: (result: {
    commitId: string;
    resultingRevision: number;
  }) => Promise<void>;
}) {
  if (input.conversationApproval && input.afterCanonicalCommit) {
    throw Object.assign(new Error("RPG conversation approval must use exactly one commit boundary."), {
      code: "RPG_CHAT_APPROVAL_BOUNDARY_AMBIGUOUS",
    });
  }
  assertRpgArcActionAvailable(input.snapshot, input.candidate.choice);
  if (
    input.candidate.sourceChapterId !== input.snapshot.chapter.id
    || input.candidate.sourceRevision !== input.snapshot.chapter.revision
    || input.candidate.canonicalMutationCount !== 0
  ) {
    throw Object.assign(new Error("RPG 對話候選來源已過期。"), {
      code: "RPG_CHAT_TURN_SOURCE_STALE",
    });
  }
  const saved = await persistStudioChoiceCandidate(
    input.repository,
    projectSeed(input.snapshot),
    {
      optionKey: input.candidate.choice.key,
      text: `${input.candidate.choice.title}｜${input.candidate.choice.description}`,
      consequence: `${input.candidate.choice.consequence}；${input.candidate.resolution.outcomeLabel}`,
      effect: input.candidate.resolution.effect,
      providerId: input.candidate.actualExecutor === "local-ollama"
        ? "ollama"
        : input.candidate.actualExecutor,
      modelId: input.candidate.model,
      externalRequest: false,
      dataLeftDevice: false,
      rpgSettlement: input.candidate.resolution.settlement,
    },
  );
  let canonical: Awaited<ReturnType<typeof acceptStudioChoice>> | null = null;
  const commitVerifiedStory = async (verifiedStory: string) => {
    validateRpgStoryTurnContract(verifiedStory, input.snapshot.language);
    validateRpgOutcomeNarrative(verifiedStory, input.candidate.resolution, input.snapshot.language, input.candidate.choice);
    if (input.conversationApproval) {
      await createProjectBackup(input.repository, input.snapshot.project.id, "safety");
    }
    canonical = await acceptStudioChoice(
      input.repository,
      saved.candidate.id,
      verifiedStory,
      `${input.candidate.choice.key === "custom" ? "自由行動" : input.candidate.choice.key}｜${input.candidate.choice.title}｜${input.candidate.resolution.outcomeLabel}`,
      input.conversationApproval,
    );
    return canonical;
  };
  let approved: { canonicalMutationCount: number; [key: string]: unknown };
  if (input.candidate.actualExecutor === "deterministic-rule-fallback") {
    const verifiedDigest = await sha256Hex(input.candidate.story.normalize("NFKC"));
    if (verifiedDigest !== input.candidate.candidateDigest) {
      throw Object.assign(new Error("規則後備候選內容摘要不一致。"), {
        code: "RPG_CHAT_RESULT_IDENTITY_MISMATCH",
      });
    }
    const transaction = await commitVerifiedStory(input.candidate.story);
    approved = {
      candidateId: input.candidate.candidateId,
      status: "approved",
      actualExecutor: "deterministic-rule-fallback",
      canonicalMutationCount: 1,
      commitId: transaction.acceptedChoice.effectOperationId,
    };
  } else {
    approved = await approveStudioClosedAgentCandidate({
      candidateId: input.candidate.candidateId,
      canonicalCommit: async ({ candidate }) => {
        if (
          candidate.taskId !== input.candidate.taskId
          || candidate.contentDigest !== input.candidate.candidateDigest
          || candidate.modelId !== input.candidate.model
          || candidate.modelDigest !== input.candidate.modelDigest
          || candidate.sourceChapterId !== input.snapshot.chapter.id
          || candidate.sourceRevision !== input.snapshot.chapter.revision
        ) {
          throw Object.assign(new Error("RPG 候選與閉端 AI 執行證明不一致。"), {
            code: "RPG_CHAT_RESULT_IDENTITY_MISMATCH",
          });
        }
        const verifiedStory = await cleanRpgContinuation(
          candidate.content,
          input.snapshot.acceptedChoices.slice(0, 8).map((item) => item.acceptedText),
          input.snapshot.language,
        );
        if (verifiedStory !== input.candidate.story) {
          throw Object.assign(new Error("RPG 候選正文與閉端 AI 證明不一致。"), {
            code: "RPG_CHAT_RESULT_STORY_MISMATCH",
          });
        }
        const transaction = await commitVerifiedStory(verifiedStory);
        return { commitId: transaction.acceptedChoice.effectOperationId };
      },
    });
  }
  if (!canonical || approved.canonicalMutationCount !== 1) {
    throw Object.assign(new Error("RPG 本回合沒有完成唯一一次正式交易。"), {
      code: "RPG_CHAT_CANONICAL_COMMIT_MISSING",
    });
  }
  const transaction = canonical as Awaited<ReturnType<typeof acceptStudioChoice>>;
  if (
    !transaction.rpgTurnReceipt
    || transaction.rpgTurnReceipt.acceptedChoiceId !== transaction.acceptedChoice.id
    || transaction.acceptedChoice.rpgTurnReceiptId !== transaction.rpgTurnReceipt.id
  ) {
    throw Object.assign(new Error("RPG 正式交易缺少同筆寫入的回合收據。"), {
      code: "RPG_CHAT_TURN_RECEIPT_MISSING",
    });
  }
  const result = {
    approved,
    transaction,
    commitId: transaction.acceptedChoice.effectOperationId,
    resultingRevision: transaction.chapter.revision,
  };
  if (
    input.conversationApproval
    && (
      !transaction.conversationArtifact
      || !transaction.conversationApprovalTransaction
      || transaction.conversationArtifact.id !== input.conversationApproval.artifactId
      || transaction.conversationArtifact.status !== "approved"
      || transaction.conversationApprovalTransaction.idempotencyKey !== input.conversationApproval.idempotencyKey
    )
  ) {
    throw Object.assign(new Error("RPG conversation approval was not committed with Canon."), {
      code: "RPG_CHAT_CONVERSATION_APPROVAL_MISSING",
    });
  }
  await input.afterCanonicalCommit?.({
    commitId: result.commitId,
    resultingRevision: result.resultingRevision,
  });
  return result;
}
