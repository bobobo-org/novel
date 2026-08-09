import type { ClosedAIProgressEvent } from "../closed-agent-os";
import type {
  AcceptedChoice,
  Chapter,
  Character,
  CharacterRelationship,
  LoreEntry,
  NovelProject,
  StoryBible,
  StoryState,
  TimelineEvent,
  WorldRule,
} from "../domain";
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
  playMode: StoryPlayModeId;
  progressionMode: RpgMode;
  language: StoryOutputLanguage;
  progression: RpgProgressionSnapshot;
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
        .map((item) => ({ name: item.name, quantity: item.quantity, effect: item.effectDescription })),
      quests: input.storyState.questStates,
      relationships: input.storyState.relationships,
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
  const [chapters, states, bibles, characters, relationships, worldRules, lore, timeline, acceptedChoices] = await Promise.all([
    repository.list<Chapter>("chapters", projectId),
    repository.list<StoryState>("storyStates", projectId),
    repository.list<StoryBible>("storyBibles", projectId),
    repository.list<Character>("characters", projectId),
    repository.list<CharacterRelationship>("relationships", projectId),
    repository.list<WorldRule>("worldRules", projectId),
    repository.list<LoreEntry>("lore", projectId),
    repository.list<TimelineEvent>("timeline", projectId),
    repository.listAcceptedChoices(projectId),
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
    playMode,
    progressionMode: mode,
    language,
    progression,
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
  const choices = mergeRpgChoiceDirection(
    input.snapshot.baseChoices,
    parseRpgChoiceDirectorOutput(result.content),
  );
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
}

export function buildRpgChatCustomAction(input: {
  snapshot: RpgChatSnapshot;
  action: string;
  rules?: RpgRuleSettings;
}) {
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
  });
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
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    generated = await runStudioClosedAI({
      projectId: input.snapshot.project.id,
      task: "branch_choice",
      input: `${directorPrompt}${validationCorrection}`,
      targetLength: input.snapshot.language === "en" ? 1_700 : 1_600,
      sourceChapterId: input.snapshot.chapter.id,
      sourceRevision: input.snapshot.chapter.revision,
      // RPG turns need one substantial pass. Balanced/deep would multiply the
      // same long scene into two or three provider calls.
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
      break;
    } catch (error) {
      if (generated.candidateId) {
        await rejectStudioClosedAgentCandidate(generated.candidateId).catch(() => undefined);
      }
      const errorCode = error instanceof Error ? error.message : String(error);
      if (
        attempt === 2
        || (errorCode !== "RPG_AI_CONTINUATION_TOO_SHORT"
          && errorCode !== "RPG_AI_CONTINUATION_TOO_LONG")
      ) {
        throw error;
      }
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
          instruction: input.snapshot.language === "en"
            ? "Discard the previous attempt. Regenerate from scratch; after the round title, write exactly 10 substantial paragraphs with no extra headings and output story prose only."
            : "捨棄前次內容並從頭重寫；回合標題後恰好寫 10 個完整段落，不加分節標題，每段約 130 至 155 個中文字，正文總長以 1,050 至 1,450 字為安全目標，只輸出小說正文。",
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
  return {
    schemaVersion: RPG_CHAT_TURN_SCHEMA_VERSION,
    taskId: generated.taskId,
    candidateId: generated.candidateId,
    candidateDigest: generated.contentDigest,
    model: generated.model,
    modelDigest: generated.modelDigest,
    actualExecutor: generated.actualExecutor,
    executionReceipt: generated.executionReceipt,
    contextDigest: generated.contextDigest,
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
    },
  );
  let canonical: Awaited<ReturnType<typeof acceptStudioChoice>> | null = null;
  const approved = await approveStudioClosedAgentCandidate({
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
      return { commitId: canonical.acceptedChoice.effectOperationId };
    },
  });
  if (!canonical || approved.canonicalMutationCount !== 1) {
    throw Object.assign(new Error("RPG 本回合沒有完成唯一一次正式交易。"), {
      code: "RPG_CHAT_CANONICAL_COMMIT_MISSING",
    });
  }
  const transaction = canonical as Awaited<ReturnType<typeof acceptStudioChoice>>;
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
