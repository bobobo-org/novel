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
  WorldRule,
} from "../domain";
import { sha256Hex, stableStringify } from "../closed-ai-cache";
import {
  STORY_PLAY_MODE_LABELS,
  resolveStoryPlayMode,
  type StoryPlayModeId,
} from "../domain/play-mode";
import {
  DEFAULT_RPG_RULE_SETTINGS,
  buildCustomRpgChoice,
  buildRpgChoices,
  readRpgProgression,
  resolveRpgChoice,
  type RpgChoice,
  type RpgChoiceResolution,
  type RpgMode,
  type RpgProgressionSnapshot,
  type RpgRuleSettings,
} from "../game/progression/rpg-progression";
import { RPG_RESOURCE_CATALOG_V3 } from "../game/progression/xianxia-ruleset-v3";
import type { AcceptChoiceConversationApprovalInput, NovelRepository } from "../repository";
import { createProjectBackup } from "../repository/backup";
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
  buildRpgChoiceDirectorPrompt,
  buildRpgResolutionDirectorPrompt,
  cleanRpgContinuation,
  mergeRpgChoiceDirection,
  parseRpgChoiceDirectorOutput,
  validateRpgStoryTurnContract,
  type RpgDirectedChoice,
  type StoryOutputLanguage,
} from "./rpg-closed-ai-director";
import { runStudioClosedAI } from "./studio-closed-ai";
import { hasVerifiedExecutedStoryOutput } from "./story-output-quality";

export const RPG_CHAT_TURN_SCHEMA_VERSION = "rpg-chat-turn-v1" as const;

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
  const value = storyState.worldFlags["story.language"];
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
  const protagonist = input.characters.find((character) =>
    input.storyBible.protagonistIds.includes(character.id))
    ?? input.characters[0]
    ?? null;
  const nameById = new Map(input.characters.map((character) => [character.id, character.name]));
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
    } : null,
    supportingCharacters: input.characters
      .filter((character) => character.id !== protagonist?.id)
      .slice(0, 10)
      .map((character) => ({
        name: character.name,
        identity: character.identity.value,
        personality: character.personality.value,
        goal: character.goal.value,
      })),
    relationships: input.relationships.slice(-16).map((relationship) => ({
      from: nameById.get(relationship.fromCharacterId) ?? relationship.fromCharacterId,
      to: nameById.get(relationship.toCharacterId) ?? relationship.toCharacterId,
      kind: relationship.kind,
      summary: relationship.summary,
      trust: relationship.trust,
    })),
    worldRules: input.worldRules.map((rule) => ({
      title: rule.title,
      description: rule.description,
      immutable: rule.immutable,
    })),
    lore: input.lore.slice(-12).map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      content: entry.content,
    })),
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
      appliedResourceChanges: receipt.appliedResourceChanges,
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
      factionFlags: Object.fromEntries(Object.entries(input.storyState.worldFlags)
        .filter(([key]) => key.startsWith("faction."))),
      contentMechanics: Object.fromEntries(Object.entries(input.storyState.worldFlags)
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
): Promise<RpgChatSnapshot> {
  const project = await repository.get<NovelProject>("projects", projectId);
  if (!project || project.deletedAt) {
    throw Object.assign(new Error("找不到這個作品。"), {
      code: "RPG_CHAT_PROJECT_NOT_FOUND",
    });
  }
  const [chapters, states, bibles, characters, relationships, worldRules, lore, timeline, acceptedChoices, rpgTurnReceipts] = await Promise.all([
    repository.list<Chapter>("chapters", projectId),
    repository.list<StoryState>("storyStates", projectId),
    repository.list<StoryBible>("storyBibles", projectId),
    repository.list<Character>("characters", projectId),
    repository.list<CharacterRelationship>("relationships", projectId),
    repository.list<WorldRule>("worldRules", projectId),
    repository.list<LoreEntry>("lore", projectId),
    repository.list<TimelineEvent>("timeline", projectId),
    repository.listAcceptedChoices(projectId),
    repository.list<RpgTurnReceipt>("rpgTurnReceipts", projectId),
  ]);
  const chapter = chapters.find((item) => item.id === project.activeChapterId)
    ?? [...chapters].sort((left, right) => left.order - right.order).at(-1)
    ?? null;
  const storyState = states.find((item) => item.id === project.storyStateId) ?? states[0] ?? null;
  const storyBible = bibles.find((item) => item.id === project.storyBibleId) ?? bibles[0] ?? null;
  if (!chapter || !storyState || !storyBible) {
    throw Object.assign(new Error("作品缺少章節、故事狀態或 Story Bible。"), {
      code: "RPG_CHAT_CANON_CONTEXT_INCOMPLETE",
    });
  }
  const playMode = resolveStoryPlayMode(storyState);
  const mode = progressionMode(playMode);
  const protagonist = characters.find((character) =>
    storyBible.protagonistIds.includes(character.id)) ?? characters[0] ?? null;
  const progression = readRpgProgression(
    storyState,
    `${project.title}|${protagonist?.name ?? ""}`,
    mode,
  );
  const conflict = chapter.content.slice(-420).trim()
    || chapter.summary?.trim()
    || storyBible.unresolvedThreads.at(-1)?.trim()
    || project.coreIdea.value?.trim()
    || "目前局勢";
  const language = storyLanguage(storyState);
  const directorContext = buildDirectorContext({
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
  });
  const baseChoices = buildRpgChoices({
    progression,
    protagonist: protagonist?.name ?? "主角",
    chapterTitle: chapter.title,
    conflict,
    mode,
    variant: progression.choiceVariant,
    seed: `${project.id}|${storyState.revision}`,
    rules,
    storyStateRevision: storyState.revision,
    storyState,
  });
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
    baseChoices,
  };
}

export async function planRpgChatChoices(input: {
  snapshot: RpgChatSnapshot;
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
}): Promise<RpgChatChoicePlan> {
  if (input.snapshot.baseChoices.length !== 3) {
    throw Object.assign(new Error("規則引擎沒有建立完整的三條策略。"), {
      code: "RPG_CHAT_RULE_CHOICES_INCOMPLETE",
    });
  }
  const seed = (
    input.snapshot.storyState.revision * 997
    + input.snapshot.progression.turn * 131
    + input.snapshot.progression.choiceVariant * 17
  ) >>> 0;
  try {
    const result = await runStudioClosedAI({
      projectId: input.snapshot.project.id,
      task: "three_choices",
      input: buildRpgChoiceDirectorPrompt({
        context: input.snapshot.directorContext,
        baseChoices: input.snapshot.baseChoices,
        language: input.snapshot.language,
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
      signal: input.signal,
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
      executionReceipt: result.executionReceipt,
      contextDigest: result.contextDigest,
      canonicalMutationCount: 0,
      dataLeftDevice: false,
      externalRequest: false,
    };
  } catch (error) {
    if (input.signal?.aborted) throw error;
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
      fallbackReason: error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "RPG_CHOICE_AI_UNAVAILABLE")
        : "RPG_CHOICE_AI_UNAVAILABLE",
    };
    const contentDigest = await sha256Hex(stableStringify(fallbackBody));
    const contextDigest = await sha256Hex(stableStringify(input.snapshot.directorContext));
    const modelDigest = await sha256Hex("rules-only:xianxia-cultivation-v3");
    const taskId = `rules-choice-plan:${contentDigest.slice(0, 24)}`;
    return {
      schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
      choices: structuredClone(input.snapshot.baseChoices),
      taskId,
      candidateId: taskId,
      contentDigest,
      model: "rules-only",
      modelDigest,
      actualExecutor: "deterministic-rule-fallback",
      executionReceipt: {
        receiptId: `rules-receipt:${contentDigest.slice(0, 24)}`,
        fallback: true,
        externalRequest: false,
        dataLeftDevice: false,
      },
      contextDigest,
      canonicalMutationCount: 0,
      dataLeftDevice: false,
      externalRequest: false,
    };
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
  return buildCustomRpgChoice({
    progression: input.snapshot.progression,
    action: input.action,
    protagonist: protagonist?.name ?? "主角",
    chapterTitle: input.snapshot.chapter.title,
    conflict: input.snapshot.conflict,
    rules: input.rules ?? DEFAULT_RPG_RULE_SETTINGS,
    storyState: input.snapshot.storyState,
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
  const hasApprovedItemGain = Object.entries(resolution.effect.resourceChanges)
    .some(([key, value]) => value > 0 && (key.startsWith("item.") || key.startsWith("currency.") || key.startsWith("material.")));
  if (claimsNewFormalItem && !hasApprovedItemGain) {
    throw new Error("RPG_AI_STORY_UNAPPROVED_FORMAL_ITEM");
  }
  return true;
}

export function buildDeterministicRpgTurnStory(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
}) {
  const protagonist = input.snapshot.characters.find((character) =>
    input.snapshot.storyBible.protagonistIds.includes(character.id))?.name
    ?? input.snapshot.characters[0]?.name
    ?? (input.snapshot.language === "en" ? "The protagonist" : input.snapshot.language === "zh-CN" ? "主角" : "主角");
  const turn = input.snapshot.progression.turn + 1;
  if (input.snapshot.language === "en") {
    const result = input.resolution.outcome === "critical_success"
      ? "The action succeeded beyond its immediate aim and exposed an additional opening."
      : input.resolution.outcome === "success"
        ? "The action succeeded, although the changed situation still demanded attention."
        : input.resolution.outcome === "partial_success"
          ? "Only part of the aim was secured, and the cost arrived before the remaining problem could be solved."
          : "The attempt failed to achieve its intended aim, but the obstruction revealed a concrete way to continue.";
    const paragraphs = [
      `${protagonist} committed to ${input.choice.title} without waiting for the uncertainty around ${input.snapshot.chapter.title} to settle. The first movement was deliberate: observe the nearest response, protect the path back, and force the present conflict to answer with something more useful than rumor.`,
      `The surroundings resisted at once. Familiar details no longer lined up, and a small change in sound made the distance ahead feel narrower than before. Instead of inventing a new advantage, ${protagonist} worked only with what the current scene had already made available.`,
      `Someone on the other side noticed the pressure and changed position. That reaction mattered more than any speech; it showed who was protecting the hidden route and who was merely pretending to understand it. The choice had now become visible, so retreat would carry a price of its own.`,
      `Light, dust, and held breath sharpened the moment. Each pause gave the opposition another chance to close the gap, while each hurried step risked exposing the intention too early. ${protagonist} kept the action tied to the chosen approach and accepted that certainty would not arrive first.`,
      `The cost became irreversible when the safe interval closed behind them. Time, trust, and position could no longer all be preserved together. No unexplained resource appeared to erase that pressure, and the people present understood that the consequence belonged to this decision.`,
      `${result} The result changed what could be done next rather than ending the scene. What had seemed like one obstacle separated into a visible problem and a second, quieter danger that had been concealed by the first.`,
      `The nearest ally answered the result with caution instead of automatic agreement. Their expression made clear that cooperation would continue, but not without a later accounting. That small shift in trust gave the outcome a human weight beyond the immediate tactical result.`,
      `Around them, the environment settled into a different order. A route once ignored now drew attention, a guarded place became exposed, and the current location could no longer be treated as neutral ground. Every witness would remember who had moved first.`,
      `A new danger then announced itself indirectly: a delayed pursuit, an unpaid obligation, or a clue that another faction had already begun to interpret. It was not an arbitrary punishment, but a trace left by the chosen action and therefore something that could be anticipated and answered.`,
      `At the edge of the changed scene, ${protagonist} finally had enough evidence to see the next decision clearly. One path would contain the immediate damage, another would use the new opening, and neither could be taken without abandoning the other for now. The story paused there, with action still possible and consequences already in motion.`,
    ];
    return `Round ${turn} | ${input.choice.title}\n\n${paragraphs.join("\n\n")}`;
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
      `主角决定执行眼前的选择，没有等局势自行安静。第一步先确认最近的反应，再守住退路，并让藏在当前冲突后面的人不得不表态。这个动作没有凭空增加力量，只把已经存在的线索推到所有人都看得见的位置。`,
      `周围立刻出现阻力。原本熟悉的声音和距离忽然对不上，前方的空间像被看不见的手压窄。主角没有假设自己拥有未记录的能力，而是依靠现场已经确认的条件，一点一点试出变化从哪里开始。`,
      `对面的人察觉压力，随即换了位置。这个反应比解释更诚实，因为它暴露出谁在保护秘密，谁只是借混乱掩饰无知。选择既然已经公开，退回原地也会付出代价，所有目光都开始衡量下一步。`,
      `光影、灰尘和压低的呼吸让气氛持续升高。每次停顿都会给对手更多封锁时间，每次冒进又可能过早暴露意图。主角只能服从已经选定的方法前进，让判断来自行动后的证据，而不是方便的巧合。`,
      `安全的空隙在身后合拢，真正的代价从这一刻变得不可逆。时间、信任和位置无法同时保全，也没有突然出现的资源替众人抹去压力。在场的人都明白，之后的责任会沿着这次决定追上来。`,
      `${result}结果没有让故事停止，反而把一个障碍分成了看得见的问题和藏在后面的危险。原先模糊的局势因此有了边界，主角也知道哪些成果已经留下，哪些部分绝不能假装完成。`,
      `最近的同伴没有立刻附和，只用谨慎的目光回应。他仍愿意合作，却显然会在稍后追问这次选择的责任。关系并未凭空翻转，但信任的重心已经移动，让眼前结果多了一层无法忽略的人情分量。`,
      `环境也重新排列了意义。过去没人注意的通道开始受到监视，原本安全的角落失去中立，目击者则会记得是谁先采取行动。当前地点不再只是背景，而成为后续冲突会反复争夺的一部分。`,
      `新的危险随后以间接方式出现：可能是延后的追索、尚未偿还的承诺，也可能是另一方已经开始解读的痕迹。它不是毫无来源的惩罚，而是这次行动真实留下的后果，因此仍能被预判和回应。`,
      `主角站在改变后的局势边缘，终于看清下一次决定。一个方向可以先压住眼前损失，另一个方向能够利用刚出现的机会，但此刻无法两边兼顾。故事停在行动仍然有效、后果已经前进的位置，等待下一步选择。`,
    ];
    return `第 ${turn} 回合｜规则接管的转折\n\n${paragraphs.join("\n\n")}`;
  }
  const result = input.resolution.outcome === "critical_success"
    ? "這次行動不只成功完成原定目標，還揭開了一條額外通路。"
    : input.resolution.outcome === "success"
      ? "這次行動成功達成目標，但改變後的局勢仍需要立刻處理。"
      : input.resolution.outcome === "partial_success"
        ? "目標只完成了一部分，代價卻先一步落下，剩餘問題仍在逼近。"
        : "這次嘗試未能達成原定目標，行動失敗了，但阻力也暴露出可以繼續追查的具體方向。";
  const paragraphs = [
    `${protagonist}決定執行「${input.choice.title}」，沒有等局勢自行安靜。第一步先確認最近的反應，再守住退路，並讓藏在目前衝突後面的人不得不表態。這個動作沒有憑空增加力量，只把已經存在的線索推到眾人都看得見的位置。`,
    `周圍立刻出現阻力。原本熟悉的聲音和距離忽然對不上，前方空間像被看不見的手壓窄。${protagonist}沒有假設自己擁有未記錄的能力，而是依靠現場已確認的條件，一點一點試出變化從哪裡開始。`,
    `對面的人察覺壓力，隨即換了位置。這個反應比解釋更誠實，因為它暴露出誰在保護秘密，誰只是借混亂掩飾無知。選擇既然已經公開，退回原地也會付出代價，所有目光都開始衡量下一步。`,
    `光影、灰塵和壓低的呼吸讓氣氛持續升高。每次停頓都會給對手更多封鎖時間，每次冒進又可能過早暴露意圖。${protagonist}只能服從已選定的方法前進，讓判斷來自行動後的證據，而不是方便的巧合。`,
    `安全的空隙在身後合攏，真正的代價從這一刻變得不可逆。時間、信任和位置無法同時保全，也沒有突然出現的資源替眾人抹去壓力。在場的人都明白，之後的責任會沿著這次決定追上來。`,
    `${result}結果沒有讓故事停止，反而把一個障礙分成了看得見的問題和藏在後面的危險。原先模糊的局勢因此有了邊界，${protagonist}也知道哪些成果已經留下，哪些部分絕不能假裝完成。`,
    `最近的同伴沒有立刻附和，只用謹慎的目光回應。他仍願意合作，卻顯然會在稍後追問這次選擇的責任。關係並未憑空翻轉，但信任的重心已經移動，讓眼前結果多了一層無法忽略的人情分量。`,
    `環境也重新排列了意義。過去沒人注意的通道開始受到監視，原本安全的角落失去中立，目擊者則會記得是誰先採取行動。目前地點不再只是背景，而成為後續衝突會反覆爭奪的一部分。`,
    `新的危險隨後以間接方式出現：可能是延後的追索、尚未償還的承諾，也可能是另一方已開始解讀的痕跡。它不是毫無來源的懲罰，而是這次行動真實留下的後果，因此仍能被預判和回應。`,
    `${protagonist}站在改變後的局勢邊緣，終於看清下一次決定。一個方向可以先壓住眼前損失，另一個方向能夠利用剛出現的機會，但此刻無法兩邊兼顧。故事停在行動仍然有效、後果已經前進的位置，等待下一步選擇。`,
  ];
  return `第 ${turn} 回合｜${input.choice.title}\n\n${paragraphs.join("\n\n")}`;
}

export async function generateRpgChatTurnCandidate(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  signal?: AbortSignal;
  onProgress?: (event: ClosedAIProgressEvent) => void;
}): Promise<RpgChatTurnCandidate> {
  const resolution = resolveRpgChoice(input.choice, {
    seed: `${input.snapshot.progression.procedural.runSeed}|${input.snapshot.chapter.id}|${input.snapshot.progression.turn}`,
    revision: input.snapshot.storyState.revision,
    recentEncounterSignatures: input.snapshot.progression.procedural.recentEncounterSignatures,
    turn: input.snapshot.progression.turn,
    storyState: input.snapshot.storyState,
  });
  const settlement = [
    ...input.choice.costLabels,
    ...input.choice.impactLabels,
    `${resolution.outcomeLabel} ${resolution.roll}/${resolution.successChance}`,
  ];
  const directorPrompt = buildRpgResolutionDirectorPrompt({
    context: input.snapshot.directorContext,
    choice: input.choice,
    language: input.snapshot.language,
    turnNumber: input.snapshot.progression.turn + 1,
    resolution: {
      outcomeLabel: resolution.outcomeLabel,
      roll: resolution.roll,
      successChance: resolution.successChance,
      settlement,
    },
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
        signal: input.signal,
        onProgress: input.onProgress,
      });
      try {
        story = cleanRpgContinuation(
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
              : "捨棄前次內容並從頭重寫；明確服從鎖定結果，不得自創任何資源數字；回合標題後恰好寫 10 個完整小說段落。",
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
  }
  const fallbackDigest = generated ? null : await sha256Hex(story.normalize("NFKC"));
  const fallbackContextDigest = generated
    ? null
    : await sha256Hex(stableStringify(input.snapshot.directorContext));
  const fallbackModelDigest = generated
    ? null
    : await sha256Hex("rules-only:xianxia-cultivation-v3:story-v1");
  const fallbackTaskId = fallbackDigest ? `rules-rpg-turn:${fallbackDigest.slice(0, 24)}` : null;
  return {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    taskId: generated?.taskId ?? fallbackTaskId!,
    candidateId: generated?.candidateId ?? fallbackTaskId!,
    candidateDigest: generated?.contentDigest ?? fallbackDigest!,
    model: generated?.model ?? "rules-only",
    modelDigest: generated?.modelDigest ?? fallbackModelDigest!,
    actualExecutor: generated?.actualExecutor ?? "deterministic-rule-fallback",
    executionReceipt: generated?.executionReceipt ?? {
      receiptId: `rules-receipt:${fallbackDigest?.slice(0, 24)}`,
      fallback: true,
      reason: generationError && typeof generationError === "object" && "code" in generationError
        ? String((generationError as { code?: unknown }).code ?? "RPG_STORY_AI_UNAVAILABLE")
        : "RPG_STORY_AI_UNAVAILABLE",
      externalRequest: false,
      dataLeftDevice: false,
    },
    contextDigest: generated?.contextDigest ?? fallbackContextDigest,
    sourceChapterId: input.snapshot.chapter.id,
    sourceRevision: input.snapshot.chapter.revision,
    choice: input.choice,
    resolution,
    story,
    outcomeLines: settlement,
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
        const verifiedStory = cleanRpgContinuation(
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
