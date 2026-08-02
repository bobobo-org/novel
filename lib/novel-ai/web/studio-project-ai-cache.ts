import type {
  Chapter,
  NovelProject,
  StoryBible,
  StoryState,
} from "../domain";
import {
  CLOSED_AI_CACHE_LAYERS,
  type ClosedAICache,
  type ClosedAICacheLayer,
  type ClosedAIPrivacyLevel,
  type ClosedAINamespace,
} from "../closed-ai-cache";
import type { NovelRepository } from "../repository";
import {
  composeProjectContext,
  PROJECT_CONTEXT_COMPOSER_SCHEMA_VERSION,
  type ProjectContextComposition,
} from "./project-context-composer";

export const STUDIO_PROJECT_AI_CACHE_PROFILE = "studio-project-resume-cache-v1" as const;

type ResumeIdentity = {
  projectId: string;
  projectRevision: number;
  chapterId: string;
  chapterRevision: number;
  storyBibleRevision: number;
  storyStateRevision: number;
};

type ResumeCacheValue = {
  schemaVersion: typeof STUDIO_PROJECT_AI_CACHE_PROFILE;
  identity: ResumeIdentity;
  contextDigest: string;
  composition?: ProjectContextComposition;
  contextItemIds?: string[];
  sourceSummary?: ProjectContextComposition["contextSourceSummary"];
  stages?: string[];
  modelSession?: {
    contextReady: true;
    runtimeHandleStored: false;
    kvPayloadStored: false;
  };
};

type ResumeSource = {
  project: NovelProject;
  chapter: Chapter;
  storyBible: StoryBible;
  storyState: StoryState;
  identity: ResumeIdentity;
};

function sameIdentity(left: ResumeIdentity, right: ResumeIdentity) {
  return Object.keys(left).every((field) =>
    left[field as keyof ResumeIdentity] === right[field as keyof ResumeIdentity]);
}

async function resolveResumeSource(
  repository: NovelRepository,
  projectId: string,
  sourceChapterId?: string,
  sourceRevision?: number,
): Promise<ResumeSource | null> {
  const project = await repository.get<NovelProject>("projects", projectId);
  if (!project) return null;
  const chapterId = sourceChapterId ?? project.activeChapterId;
  const [directChapter, storyBible, storyState] = await Promise.all([
    chapterId ? repository.get<Chapter>("chapters", chapterId) : Promise.resolve(null),
    project.storyBibleId
      ? repository.get<StoryBible>("storyBibles", project.storyBibleId)
      : Promise.resolve(null),
    project.storyStateId
      ? repository.get<StoryState>("storyStates", project.storyStateId)
      : Promise.resolve(null),
  ]);
  const [chapters, storyBibles, storyStates] = await Promise.all([
    directChapter ? Promise.resolve([] as Chapter[]) : repository.list<Chapter>("chapters", projectId),
    storyBible ? Promise.resolve([] as StoryBible[]) : repository.list<StoryBible>("storyBibles", projectId),
    storyState ? Promise.resolve([] as StoryState[]) : repository.list<StoryState>("storyStates", projectId),
  ]);
  const chapter = directChapter
    ?? [...chapters].sort((left, right) => right.order - left.order)[0]
    ?? null;
  const resolvedBible = storyBible
    ?? [...storyBibles].sort((left, right) => right.revision - left.revision)[0]
    ?? null;
  const resolvedState = storyState
    ?? [...storyStates].sort((left, right) => right.revision - left.revision)[0]
    ?? null;
  if (
    !chapter
    || chapter.projectId !== projectId
    || !resolvedBible
    || !resolvedState
    || (sourceRevision !== undefined && chapter.revision !== sourceRevision)
  ) return null;
  return {
    project,
    chapter,
    storyBible: resolvedBible,
    storyState: resolvedState,
    identity: {
      projectId,
      projectRevision: project.revision,
      chapterId: chapter.id,
      chapterRevision: chapter.revision,
      storyBibleRevision: resolvedBible.revision,
      storyStateRevision: resolvedState.revision,
    },
  };
}

function cacheNamespace(source: ResumeSource, privacyLevel: ClosedAIPrivacyLevel): ClosedAINamespace {
  return {
    tenantId: "local-tenant",
    userId: "local-author",
    projectId: source.project.id,
    storyId: source.project.id,
    canonId: `canon:${source.project.id}`,
    branchId: "main",
    characterId: "shared",
    agentRole: "project-context-prewarmer",
    modelId: "project-context-composer",
    modelDigest: PROJECT_CONTEXT_COMPOSER_SCHEMA_VERSION,
    promptProfileVersion: STUDIO_PROJECT_AI_CACHE_PROFILE,
    storyBibleRevision: String(source.storyBible.revision),
    knowledgeScopeRevision: [
      source.project.revision,
      source.chapter.revision,
      source.storyState.revision,
    ].join(":"),
    privacyLevel,
  };
}

function cacheInput(taskType: string, identity: ResumeIdentity) {
  return {
    schemaVersion: STUDIO_PROJECT_AI_CACHE_PROFILE,
    kind: "saved-project-resume-context",
    taskType,
    identity,
  };
}

function layerValue(
  layer: ClosedAICacheLayer,
  source: ResumeSource,
  composition: ProjectContextComposition,
): ResumeCacheValue {
  const base = {
    schemaVersion: STUDIO_PROJECT_AI_CACHE_PROFILE,
    identity: source.identity,
    contextDigest: composition.contextDigest,
  } as const;
  if (layer === "retrieval") return { ...base, composition };
  if (layer === "semantic") return {
    ...base,
    contextItemIds: composition.context.map((item) => item.id),
  };
  if (layer === "agent-plan") return {
    ...base,
    stages: ["restore-active-chapter", "retrieve-approved-context", "continue-from-source-revision"],
  };
  if (layer === "tool-result") return {
    ...base,
    sourceSummary: composition.contextSourceSummary,
  };
  if (layer === "model-session") return {
    ...base,
    modelSession: {
      contextReady: true,
      runtimeHandleStored: false,
      kvPayloadStored: false,
    },
  };
  return base;
}

export async function prewarmStudioProjectAICache(input: {
  cache: ClosedAICache;
  repository: NovelRepository;
  projectId: string;
  taskType: string;
  sourceChapterId?: string;
  sourceRevision?: number;
  privacyLevel?: ClosedAIPrivacyLevel;
}) {
  const privacyLevel = input.privacyLevel ?? "device_only";
  const source = await resolveResumeSource(
    input.repository,
    input.projectId,
    input.sourceChapterId,
    input.sourceRevision,
  );
  if (!source) return null;
  const composition = await composeProjectContext({
    repository: input.repository,
    taskType: input.taskType,
    projectId: input.projectId,
    storyId: input.projectId,
    canonId: `canon:${input.projectId}`,
    branchId: "main",
    revision: source.storyBible.revision,
    privacyLevel,
    audience: "actor",
    semanticQuery: [
      source.project.title,
      source.chapter.title,
      source.chapter.content.slice(-1_200),
    ].filter(Boolean).join("\n"),
  });
  const namespace = cacheNamespace(source, privacyLevel);
  const key = cacheInput(input.taskType, source.identity);
  const entries = await Promise.all(CLOSED_AI_CACHE_LAYERS.map((layer) =>
    input.cache.put({
      layer,
      namespace,
      input: key,
      value: layerValue(layer, source, composition),
      semanticText: layer === "semantic"
        ? `${source.project.title}\n${source.chapter.title}\n${source.chapter.content.slice(-1_200)}`
        : undefined,
      tags: [
        "studio-project-resume",
        `task:${input.taskType}`,
        `chapter:${source.chapter.id}`,
      ],
      ttlMs: 30 * 60 * 1_000,
    })));
  return {
    schemaVersion: STUDIO_PROJECT_AI_CACHE_PROFILE,
    projectId: source.project.id,
    chapterId: source.chapter.id,
    chapterRevision: source.chapter.revision,
    contextDigest: composition.contextDigest,
    warmedLayers: entries.map((entry) => entry.layer),
    canonicalMutationCount: 0 as const,
    memoryMutationCount: 0 as const,
    learningMutationCount: 0 as const,
  };
}

export async function readPrewarmedStudioProjectContext(input: {
  cache: ClosedAICache;
  repository: NovelRepository;
  projectId: string;
  taskType: string;
  sourceChapterId?: string;
  sourceRevision?: number;
  privacyLevel?: ClosedAIPrivacyLevel;
}) {
  const privacyLevel = input.privacyLevel ?? "device_only";
  const source = await resolveResumeSource(
    input.repository,
    input.projectId,
    input.sourceChapterId,
    input.sourceRevision,
  );
  if (!source) return null;
  const lookup = await input.cache.get<ResumeCacheValue>(
    "retrieval",
    cacheNamespace(source, privacyLevel),
    cacheInput(input.taskType, source.identity),
  );
  const value = lookup.entry?.value;
  if (
    !lookup.hit
    || !value?.composition
    || value.schemaVersion !== STUDIO_PROJECT_AI_CACHE_PROFILE
    || !sameIdentity(value.identity, source.identity)
    || value.contextDigest !== value.composition.contextDigest
  ) return null;
  return value.composition;
}
