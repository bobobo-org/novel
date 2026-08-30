import { buildProjectBundle, createDraft } from "../domain/creation";
import { makeRecord, optionalValue, type AcceptedChoice, type Chapter, type ChoiceCandidate, type ExternalAttemptProvenance, type NovelProject, type RpgContextRevisionGuard, type RpgTurnSettlement, type StoryBible, type StoryBranch, type StoryChoiceEffect, type StoryState } from "../domain";
import { resolveProjectStoryBible } from "../domain/story-bible-selection";
import { createProjectBackup } from "./backup";
import { RepositoryOperationError, type AcceptChoiceConversationApprovalInput, type AcceptChoiceTransactionResult, type NovelRepository } from "./contracts";
import type { AdultExperienceProfile } from "../../novel-data/adult-experience-profile";
import {
  isStoryPlayModeId,
  type StoryPlayModeId,
} from "../domain/play-mode";
import rawStoryLibrary from "../../../data/story-library.json" with { type: "json" };
import type { StoryLibrary } from "../../novel-data/story-library-types";

export type StudioProjectSeed = {
  id: string;
  title: string;
  chapterId?: string | null;
  chapterTitle: string;
  draft: string;
  packId?: string | null;
  topicId?: string | null;
  subCategory?: string | null;
  coreIdea?: string | null;
  protagonist?: string | null;
  goal?: string | null;
  world?: string | null;
  worldRule?: string | null;
  conflict?: string | null;
  style?: string | null;
  enabledStats?: string[];
  selectedPlayModeId?: StoryPlayModeId | null;
  adultMode?: boolean;
  adultExperienceProfile?: AdultExperienceProfile | null;
};

export type StudioCanonicalSnapshot = {
  project: NovelProject;
  chapter: Chapter;
  storyState: StoryState;
  storyBible: StoryBible;
  acceptedChoices: AcceptedChoice[];
  branches: StoryBranch[];
};

const value = (input?: string | null) => optionalValue(input?.trim() || null, input?.trim() ? "user_defined" : "deferred");

const EXPLICIT_LEGACY_TOPICS = (rawStoryLibrary as StoryLibrary).topics.filter((topic) => (
  topic.enabled && topic.classic && !topic.adultOnly
));

function resolveExplicitLegacyTopic(topicLabel?: string | null) {
  const requested = topicLabel?.trim() || null;
  if (!requested) return null;
  return EXPLICIT_LEGACY_TOPICS.find((topic) => (
    topic.topicId === requested
    || topic.name === requested
    || topic.legacyAliases.includes(requested)
  )) ?? null;
}

export async function ensureStudioCanonicalProject(repository: NovelRepository, input: StudioProjectSeed): Promise<StudioCanonicalSnapshot> {
  let project = await repository.get<NovelProject>("projects", input.id);
  if (!project) {
    const explicitTopic = resolveExplicitLegacyTopic(input.topicId);
    const draft = createDraft("legacy");
    draft.id = `studio-migration-${input.id}`;
    draft.projectId = input.id;
    draft.title = input.title;
    draft.genrePackId = input.packId ?? explicitTopic?.packId ?? null;
    draft.genreId = explicitTopic?.topicId ?? null;
    draft.subgenreId = input.subCategory ?? null;
    draft.coreIdea = value(input.coreIdea);
    draft.protagonist = value(input.protagonist);
    draft.style = value(input.style);
    draft.answers.goal = value(input.goal);
    draft.answers.world = value(input.world);
    draft.answers.worldRule = value(input.worldRule);
    draft.answers.obstacle = value(input.conflict);
    if (input.selectedPlayModeId) {
      draft.answers.playMode = optionalValue(
        input.selectedPlayModeId,
        "user_defined",
      );
    }
    const bundle = buildProjectBundle(draft);
    if (!explicitTopic) {
      bundle.storyState.worldFlags = {
        ...bundle.storyState.worldFlags,
        ...(input.topicId?.trim()
          ? { "story.legacyUnresolvedTopicLabel": input.topicId.trim() }
          : {}),
        ...(input.topicId?.trim()
          ? { "story.legacyTopicMigrationWarning": `舊題材「${input.topicId.trim()}」未對應正式 ID，已保留原文字。` }
          : {}),
      };
    }
    bundle.project.adultMode = input.adultMode === true;
    bundle.project.adultExperienceProfile = input.adultMode ? input.adultExperienceProfile ?? null : null;
    await repository.createProject(bundle, `studio-project:${input.id}`);
    project = bundle.project;
  }
  const nextAdultMode = input.adultMode ?? project.adultMode;
  const nextAdultProfile = nextAdultMode ? input.adultExperienceProfile ?? project.adultExperienceProfile ?? null : null;
  if (
    project.adultMode !== nextAdultMode
    || JSON.stringify(project.adultExperienceProfile ?? null) !== JSON.stringify(nextAdultProfile)
  ) {
    project = await repository.put("projects", {
      ...project,
      adultMode: nextAdultMode,
      adultExperienceProfile: nextAdultProfile,
    }, project.revision);
  }
  let chapter = input.chapterId
    ? await repository.get<Chapter>("chapters", input.chapterId)
    : project.activeChapterId
      ? await repository.get<Chapter>("chapters", project.activeChapterId)
      : null;
  if (input.chapterId && (!chapter || chapter.projectId !== input.id)) {
    throw new RepositoryOperationError("STUDIO_SOURCE_CHAPTER_NOT_FOUND");
  }
  if (!chapter) {
    chapter = { ...makeRecord(input.id, "migration"), title: input.chapterTitle || "第一章", order: 1, content: input.draft || "", summary: null, status: "draft" };
    chapter = await repository.put("chapters", chapter);
    project = await repository.put("projects", { ...project, activeChapterId: chapter.id }, project.revision);
  }
  let storyState = (await repository.list<StoryState>("storyStates", input.id))[0];
  const storyBibles = await repository.list<StoryBible>("storyBibles", input.id);
  const storyBible = resolveProjectStoryBible(project, storyBibles);
  if (!storyState || !storyBible) throw new Error("CANONICAL_PROJECT_STATE_MISSING");
  const importedPlayMode = input.selectedPlayModeId;
  const existingWorldFlags = storyState.worldFlags ?? {};
  const storedPlayMode = existingWorldFlags["story.playMode"];
  const shouldApplyImportedPlayMode = (
    project.creationMode === "legacy"
    && isStoryPlayModeId(importedPlayMode)
    && storedPlayMode !== importedPlayMode
  );
  if (storyState.worldFlags == null || shouldApplyImportedPlayMode) {
    storyState = await repository.put("storyStates", {
      ...storyState,
      worldFlags: {
        ...existingWorldFlags,
        ...(shouldApplyImportedPlayMode ? {
          "story.playMode": importedPlayMode,
          "story.playModeLocked": true,
        } : {}),
      },
    }, storyState.revision);
  }
  if (input.enabledStats?.length && Object.keys(storyState.protagonistStats).length === 0) {
    const protagonistStats = Object.fromEntries(input.enabledStats.map((stat) => [stat, stat === "stamina" ? 100 : stat === "level" ? 1 : 0]));
    const updated = await repository.put("storyStates", { ...storyState, protagonistStats }, storyState.revision);
    return { project, chapter, storyState: updated, storyBible, acceptedChoices: await repository.listAcceptedChoices(input.id), branches: await repository.listStoryBranches(input.id) };
  }
  return { project, chapter, storyState, storyBible, acceptedChoices: await repository.listAcceptedChoices(input.id), branches: await repository.listStoryBranches(input.id) };
}

export async function saveStudioChapter(repository: NovelRepository, input: StudioProjectSeed) {
  const current = await ensureStudioCanonicalProject(repository, input);
  if (
    current.chapter.title === input.chapterTitle
    && current.chapter.content === input.draft
  ) {
    return current;
  }
  const chapter = await repository.put("chapters", { ...current.chapter, title: input.chapterTitle, content: input.draft }, current.chapter.revision);
  return { ...current, chapter };
}

export async function completeStudioChapter(repository: NovelRepository, input: {
  projectId: string;
  chapterId: string;
  chapterTitle: string;
  draft: string;
  createFullBackup: boolean;
  release?: { appCommit?: string | null; releaseTag?: string | null };
}) {
  const project = await repository.get<NovelProject>("projects", input.projectId);
  if (!project) throw new RepositoryOperationError("STUDIO_PROJECT_NOT_FOUND", "完成章節時找不到作品資料。");
  if (project.activeChapterId !== input.chapterId) {
    throw new RepositoryOperationError("STUDIO_ACTIVE_CHAPTER_CHANGED", "目前章節已在其他操作中切換，請確認內容後再完成章節。");
  }
  const currentChapter = await repository.get<Chapter>("chapters", input.chapterId);
  if (!currentChapter || currentChapter.projectId !== input.projectId) {
    throw new RepositoryOperationError("STUDIO_SOURCE_CHAPTER_NOT_FOUND", "完成章節時找不到目前章節資料。");
  }

  const completedChapter = await repository.put<Chapter>("chapters", {
    ...currentChapter,
    title: input.chapterTitle.trim() || currentChapter.title,
    content: input.draft,
    status: "completed",
  }, currentChapter.revision);

  // The recovery point belongs to the chapter that just completed. Create it
  // before a new blank chapter exists or becomes the project's active chapter.
  const backup = input.createFullBackup
    ? await createProjectBackup(repository, input.projectId, "full", input.release)
    : null;

  const chapters = (await repository.list<Chapter>("chapters", input.projectId))
    .sort((left, right) => left.order - right.order);
  const nextOrder = completedChapter.order + 1;
  const existingNextChapter = chapters.find((item) => item.id !== completedChapter.id && item.order === nextOrder) ?? null;
  const nextChapter = existingNextChapter ?? await repository.put<Chapter>("chapters", {
    ...makeRecord(input.projectId, "user"),
    title: `第${nextOrder}章`,
    order: nextOrder,
    content: "",
    summary: null,
    status: "draft",
  });
  const nextProject = await repository.put<NovelProject>("projects", {
    ...project,
    activeChapterId: nextChapter.id,
  }, project.revision);

  return {
    completedChapter,
    nextChapter,
    nextProject,
    backup,
    reusedNextChapter: Boolean(existingNextChapter),
  };
}

export async function persistStudioChoiceCandidate(repository: NovelRepository, input: StudioProjectSeed, candidate: {
  optionKey: "A" | "B" | "C" | "custom";
  text: string;
  consequence: string;
  effect: StoryChoiceEffect;
  providerId: string;
  modelId: string | null;
  externalRequest?: boolean;
  dataLeftDevice?: boolean;
  externalAttempt?: ExternalAttemptProvenance;
  rpgContextRevisionGuard?: RpgContextRevisionGuard;
  rpgSettlement?: RpgTurnSettlement;
}) {
  const current = await ensureStudioCanonicalProject(repository, input);
  const base = makeRecord(input.id, "ai_candidate");
  const record: ChoiceCandidate = {
    ...base,
    prompt: "主角接下來要怎麼做？",
    optionKey: candidate.optionKey,
    text: candidate.text,
    consequence: candidate.consequence,
    effect: candidate.effect,
    status: "pending",
    chapterId: current.chapter.id,
    sceneId: null,
    inputRevision: current.project.revision,
    chapterRevision: current.chapter.revision,
    storyStateRevision: current.storyState.revision,
    storyBibleRevision: current.storyBible.revision,
    rpgContextRevisionGuard: candidate.rpgContextRevisionGuard
      ? structuredClone(candidate.rpgContextRevisionGuard)
      : undefined,
    rpgSettlement: candidate.rpgSettlement,
    provenance: {
      ...base.provenance,
      actor: candidate.externalRequest ? "external-ai" : candidate.providerId === "ollama" ? "local-ollama" : candidate.providerId === "browser-ai" ? "browser-ai" : "local-rule",
      requestId: base.id,
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      taskType: "interactive_choice",
      externalRequest: candidate.externalRequest === true,
      dataLeftDevice: candidate.dataLeftDevice === true,
      ...(candidate.externalAttempt ? {
        externalAttempt: structuredClone(candidate.externalAttempt),
      } : {}),
      contextSources: ["project", "chapter", "story_state"],
      elapsedMs: null,
    },
  };
  const saved = await repository.put("candidates", record);
  return { candidate: saved, current };
}

export async function acceptStudioChoice(
  repository: NovelRepository,
  candidateId: string,
  acceptedText: string,
  choiceLabel?: string | null,
  conversationApproval?: AcceptChoiceConversationApprovalInput,
): Promise<AcceptChoiceTransactionResult> {
  const candidate = await repository.get<ChoiceCandidate>("candidates", candidateId);
  if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");
  if (candidate.storyBibleRevision == null) throw new RepositoryOperationError("CANDIDATE_STORY_BIBLE_REVISION_MISSING");
  const project = await repository.get<NovelProject>("projects", candidate.projectId), chapter = await repository.get<Chapter>("chapters", candidate.chapterId), storyState = (await repository.list<StoryState>("storyStates", candidate.projectId))[0];
  if (!project || !chapter || !storyState) throw new Error("ACCEPT_CHOICE_RECORD_MISSING");
  const operationId = `accept:${candidate.id}`;
  return repository.acceptChoiceTransaction({
    operationId,
    idempotencyKey: `${candidate.projectId}:${candidate.id}:${candidate.inputRevision}`,
    projectId: candidate.projectId,
    chapterId: candidate.chapterId,
    candidateId: candidate.id,
    acceptedText,
    choiceLabel,
    expectedProjectRevision: candidate.inputRevision,
    expectedChapterRevision: candidate.chapterRevision,
    // A second identical approval must reproduce the original transaction
    // fingerprint. The accepted candidate keeps its pre-commit revision in
    // parentRevision, while a genuinely pending candidate uses its current
    // revision as before.
    expectedCandidateRevision: candidate.status === "accepted"
      ? candidate.parentRevision ?? Math.max(0, candidate.revision - 1)
      : candidate.revision,
    expectedStoryStateRevision: candidate.storyStateRevision,
    expectedStoryBibleRevision: candidate.storyBibleRevision,
    rpgContextRevisionGuard: candidate.rpgContextRevisionGuard
      ? structuredClone(candidate.rpgContextRevisionGuard)
      : undefined,
    conversationApproval,
  });
}

export function auditLegacyStudioInteractions(input: unknown) {
  const state = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const branches = Array.isArray(state.branches) ? state.branches : [];
  const candidate = state.candidate && typeof state.candidate === "object" ? state.candidate : null;
  return {
    found: branches.length + (candidate ? 1 : 0),
    valid: 0,
    invalid: 0,
    ambiguous: branches.length + (candidate ? 1 : 0),
    migratable: 0,
    disposition: branches.length || candidate ? "manual_review" : "not_applicable",
    reason: branches.length || candidate ? "Legacy interaction rows do not contain stable candidate, chapter, revision, and effect operation identifiers." : null,
  };
}
