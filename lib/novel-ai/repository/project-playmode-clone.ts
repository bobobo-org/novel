import {
  buildSeedCandidate,
  createDraft,
} from "../domain/creation";
import {
  optionalValue,
  type Chapter,
  type Character,
  type NovelProject,
  type ProjectCreationDraft,
  type ProjectSeed,
  type StoryBible,
  type StoryState,
  type World,
  type WorldRule,
} from "../domain";
import { resolveProjectStoryBible } from "../domain/story-bible-selection";
import {
  isStoryPlayModeId,
  type StoryPlayModeId,
} from "../domain/play-mode";
import type { NovelRepository } from "./contracts";
import {
  indexedDbErrorCode,
  isIndexedDbPersistenceError,
} from "./persistence-recovery";

export const PROJECT_PLAYMODE_CLONE_VERSION = "project-playmode-clone-v2" as const;

// A project committed immediately before a route transition can be briefly
// invisible to a newly opened IndexedDB connection in some browsers. Keep the
// recovery deliberately small: three retries and 900 ms total delay.
export const PROJECT_PLAYMODE_CLONE_RETRY_DELAYS_MS = [150, 300, 450] as const;

export type ProjectCloneSourceSummary = {
  sourceProjectId: string;
  sourceRevision: number;
  sourceTitle: string;
  sourcePlayMode: StoryPlayModeId | null;
  sourceChapterCount: number;
  copiedSeed: boolean;
  copiedCharacter: boolean;
  copiedWorld: boolean;
  copiedWorldRuleCount: number;
};

export type ProjectCloneDraftResult = {
  draft: ProjectCreationDraft;
  source: ProjectCloneSourceSummary;
};

export class ProjectCloneSourceError extends Error {
  readonly code: "PROJECT_CLONE_SOURCE_INVALID" | "PROJECT_CLONE_SOURCE_NOT_FOUND";

  constructor(
    code: "PROJECT_CLONE_SOURCE_INVALID" | "PROJECT_CLONE_SOURCE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ProjectCloneSourceError";
    this.code = code;
  }
}

const RETRYABLE_INDEXEDDB_READ_CODES = new Set([
  "INDEXEDDB_OPEN_FAILED",
  "INDEXEDDB_UPGRADE_BLOCKED",
  "INDEXEDDB_VERSION_CHANGED",
  "INDEXEDDB_CONNECTION_INVALID",
  "INDEXEDDB_REQUEST_FAILED",
  "INDEXEDDB_TRANSACTION_ABORTED",
  "INDEXEDDB_TRANSACTION_FAILED",
  "INDEXEDDB_OPERATION_FAILED",
]);

function retryableCloneRead(error: unknown) {
  if (error instanceof ProjectCloneSourceError) {
    return error.code === "PROJECT_CLONE_SOURCE_NOT_FOUND";
  }
  return isIndexedDbPersistenceError(error)
    && RETRYABLE_INDEXEDDB_READ_CODES.has(indexedDbErrorCode(error));
}

export type ProjectPlaymodeCloneRetryOptions = {
  delaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
};

/**
 * Resolves a clone draft across the short IndexedDB visibility window that can
 * follow project creation. Invalid URLs and non-transient storage failures fail
 * immediately. A truly missing source still produces the normal typed error
 * after the bounded retry budget is exhausted.
 */
export async function buildProjectPlaymodeCloneDraftWithRetry(
  repository: NovelRepository,
  sourceProjectId: string,
  options: ProjectPlaymodeCloneRetryOptions = {},
): Promise<ProjectCloneDraftResult> {
  const delaysMs = options.delaysMs ?? PROJECT_PLAYMODE_CLONE_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }));

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await buildProjectPlaymodeCloneDraft(repository, sourceProjectId);
    } catch (error) {
      const delayMs = delaysMs[attempt];
      if (delayMs === undefined || !retryableCloneRead(error)) throw error;
      await sleep(Math.max(0, delayMs));
    }
  }
}

function storedText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const nested = (value as { value?: unknown }).value;
  return typeof nested === "string" ? nested.trim() : "";
}

function latest<T extends { updatedAt?: string }>(rows: T[]) {
  return [...rows].sort((left, right) =>
    String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0] ?? null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const next = storedText(value);
    if (next) return next;
  }
  return "";
}

function cloneValue(value: string) {
  return optionalValue(value || null, value ? "user_defined" : "deferred");
}

function sourcePlayMode(storyState: StoryState | null): StoryPlayModeId | null {
  const value = storyState?.worldFlags?.["story.playMode"];
  return typeof value === "string" && isStoryPlayModeId(value) ? value : null;
}

/**
 * Builds a new, independent creation draft from an existing canonical project.
 * This is deliberately read-only: chapter prose, backups, interaction history and
 * mutable StoryState are not copied into a different play mode.  The new project
 * receives fresh IDs, Canon and backups through the normal buildProjectBundle /
 * createProject path after the author confirms a new title and play mode.
 */
export async function buildProjectPlaymodeCloneDraft(
  repository: NovelRepository,
  sourceProjectId: string,
): Promise<ProjectCloneDraftResult> {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sourceProjectId)) {
    throw new ProjectCloneSourceError(
      "PROJECT_CLONE_SOURCE_INVALID",
      "複製來源網址無效。原作品沒有被修改。",
    );
  }

  const source = await repository.get<NovelProject>("projects", sourceProjectId);
  if (!source || source.deletedAt) {
    throw new ProjectCloneSourceError(
      "PROJECT_CLONE_SOURCE_NOT_FOUND",
      "找不到要複製的原作品；可能已刪除、尚未同步到這個瀏覽器，或網址不完整。原作品沒有被修改。",
    );
  }

  const [seeds, storyStates, storyBibles, characters, worlds, worldRules, chapters] = await Promise.all([
    repository.list<ProjectSeed>("projectSeeds", sourceProjectId),
    repository.list<StoryState>("storyStates", sourceProjectId),
    repository.list<StoryBible>("storyBibles", sourceProjectId),
    repository.list<Character>("characters", sourceProjectId),
    repository.list<World>("worlds", sourceProjectId),
    repository.list<WorldRule>("worldRules", sourceProjectId),
    repository.list<Chapter>("chapters", sourceProjectId),
  ]);

  const seed = latest(seeds);
  const storyState = storyStates.find((item) => item.id === source.storyStateId)
    ?? latest(storyStates);
  const storyBible = resolveProjectStoryBible(source, storyBibles);
  const protagonist = characters.find((item) => storyBible?.protagonistIds?.includes(item.id))
    ?? characters.find((item) => storyBible?.characterIds?.includes(item.id))
    ?? latest(characters);
  const world = worlds.find((item) => item.id === storyBible?.worldId)
    ?? latest(worlds);
  const relevantWorldRules = storyBible?.worldRuleIds?.length
    ? worldRules.filter((item) => storyBible.worldRuleIds.includes(item.id))
    : worldRules;
  const firstChapter = [...chapters]
    .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt))[0]
    ?? null;

  const logline = firstText(seed?.logline, source.coreIdea, storyBible?.theme);
  const protagonistName = firstText(seed?.protagonist, protagonist?.name);
  const goal = firstText(seed?.goal, protagonist?.goal);
  const weakness = firstText(seed?.weakness);
  const worldSummary = firstText(seed?.world, world?.summary);
  const worldRule = firstText(
    seed?.worldRule,
    relevantWorldRules.slice(0, 3).map((item) => item.description).filter(Boolean).join("；"),
  );
  const conflict = firstText(seed?.conflict, storyBible?.unresolvedThreads?.[0], goal);
  const opposition = firstText(seed?.opposition);
  const opening = firstText(seed?.opening, firstChapter?.summary);
  const style = firstText(source.narrativeStyle, storyBible?.style);
  const storedLanguage = storyState?.worldFlags?.["story.language"];
  const language = storedLanguage === "zh-CN" || storedLanguage === "en" ? storedLanguage : "zh-TW";

  const draft = createDraft("quick");
  draft.title = "";
  draft.genrePackId = source.genrePackId ?? null;
  draft.genreId = source.genreId ?? null;
  draft.subgenreId = source.subgenreId ?? null;
  draft.coreIdea = cloneValue(logline);
  draft.protagonist = cloneValue(protagonistName);
  draft.style = cloneValue(style);
  draft.answers = {
    cloneFrom: optionalValue(sourceProjectId, "user_defined"),
    cloneFlowVersion: optionalValue(PROJECT_PLAYMODE_CLONE_VERSION, "user_defined"),
    cloneSourceRevision: optionalValue(String(source.revision), "user_defined"),
    story: cloneValue(logline),
    protagonist: cloneValue(protagonistName),
    goal: cloneValue(goal),
    conflict: cloneValue(conflict),
    worldRule: cloneValue(worldRule || worldSummary),
    opening: cloneValue(opening),
    playMode: optionalValue<string>(null, "deferred"),
    playStructure: optionalValue<string>(null, "deferred"),
    language: optionalValue(language, "user_defined"),
  };

  const clonedSeed = buildSeedCandidate(draft);
  draft.seedCandidate = {
    ...clonedSeed,
    titleCandidates: [],
    logline: cloneValue(logline),
    protagonist: cloneValue(protagonistName),
    goal: cloneValue(goal),
    weakness: cloneValue(weakness),
    world: cloneValue(worldSummary),
    worldRule: cloneValue(worldRule),
    conflict: cloneValue(conflict),
    opposition: cloneValue(opposition),
    opening: cloneValue(opening),
    directions: Array.isArray(seed?.directions) ? seed.directions.map(storedText).filter(Boolean).slice(0, 3) : [],
  };

  return {
    draft,
    source: {
      sourceProjectId,
      sourceRevision: source.revision,
      sourceTitle: source.title?.trim() || "未命名作品",
      sourcePlayMode: sourcePlayMode(storyState),
      sourceChapterCount: chapters.length,
      copiedSeed: Boolean(seed),
      copiedCharacter: Boolean(protagonist),
      copiedWorld: Boolean(world),
      copiedWorldRuleCount: relevantWorldRules.length,
    },
  };
}

export function isCurrentProjectPlaymodeCloneDraft(
  draft: ProjectCreationDraft | null,
  sourceProjectId: string,
) {
  return draft?.answers.cloneFrom?.value === sourceProjectId
    && draft.answers.cloneFlowVersion?.value === PROJECT_PLAYMODE_CLONE_VERSION
    && draft.projectId !== sourceProjectId;
}
