"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  STORY_LIBRARY,
  listStoryTopics,
  randomStoryTopic,
  recommendStoryTopics,
  resolveStoryTopic,
} from "@/lib/novel-data/story-library";
import {
  blankOptional,
  setOptional,
  type OptionalField,
  type OptionalFieldStatus,
} from "@/lib/novel-data/story-library-types";
import { migrateStorySelection } from "@/lib/novel-data/story-library-migration";
import {
  createAdultExperienceProfile,
  normalizeAdultExperienceProfile,
  type AdultExperienceProfile,
} from "@/lib/novel-data/adult-experience-profile";
import {
  buildLocalCreationGuide,
  creationFoundationChecklist,
  creationFoundationMissing,
  isStructuredGameMode,
  type CreationEntryMode as EntryMode,
  type CreationOptionalKey as OptionalKey,
  type CreationWizard as Wizard,
} from "@/lib/novel-data/creation-guide";
import {
  discoverStudioClosedAI,
  prewarmStudioInteractiveChoiceAI,
  regenerateStudioClosedAI,
  runStudioClosedAI,
} from "@/lib/novel-ai/web/studio-closed-ai";
import {
  normalizeStudioClosedComputePolicy,
  STUDIO_AI_SETTINGS_KEY,
  type StudioClosedComputePolicy,
} from "@/lib/novel-ai/web/studio-closed-compute-policy";
import { adaptStudioProfileForExplicitLocalCompute } from "@/lib/novel-ai/web/studio-local-performance-policy";
import { scheduleBrowserModelPrewarm } from "@/lib/novel-ai/providers/browser-ai/browser-prewarm-controller";
import {
  hasVerifiedExecutedStoryOutput,
  isUsableChineseStoryOutput,
} from "@/lib/novel-ai/web/story-output-quality";
import {
  clearStudioTaskHandoff,
  readStudioTaskHandoff,
  stageStudioTaskHandoff,
  type StudioTaskHandoff,
} from "@/lib/novel-ai/web/studio-task-session";
import { sha256Hex } from "@/lib/novel-ai/closed-ai-cache";
import type { ClosedAIProgressEvent } from "@/lib/novel-ai/closed-agent-os";
import {
  approveStudioClosedAgentCandidate,
  prewarmStudioProjectAIState,
  rejectStudioClosedAgentCandidate,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import {
  readStudioWritingResume,
  writeStudioWritingResume,
} from "@/lib/novel-ai/web/studio-writing-resume";
import {
  applyWritingAidTransaction,
  commitStudioCandidateToChapter,
  type StudioCanonicalApplyResult,
} from "@/lib/novel-ai/web/studio-canonical-approval";
import {
  canPersistStudioShell,
  hydrateCanonicalWithNonDestructiveFallback,
  runDailyBackupAndMark,
  type CanonicalRuntimeGate,
} from "@/lib/novel-ai/web/studio-canonical-runtime-gate";
import { createNovelRepository, type NovelRepository } from "@/lib/novel-ai/repository";
import {
  EXPLICIT_LEGACY_STUDIO_KEYS,
  migrateLegacyStudioProjects,
  previewLegacyStudioProjects,
} from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import {
  resolvePersistenceRuntimeHealth,
  type PersistenceRuntimeMode,
} from "@/lib/novel-ai/repository/runtime-health";
import {
  acceptStudioChoice,
  auditLegacyStudioInteractions,
  completeStudioChapter as completeCanonicalStudioChapter,
  ensureStudioCanonicalProject,
  persistStudioChoiceCandidate,
  saveStudioChapter,
  type StudioProjectSeed,
} from "@/lib/novel-ai/repository/studio-canonical";
import { createProjectBackup, validateBackupPayload, type BackupPayload } from "@/lib/novel-ai/repository/backup";
import { makeRecord, type Chapter, type NovelProject, type ProjectBackup, type ProjectSeed, type StoryState as CanonicalStoryState, type StoryBranch as CanonicalStoryBranch } from "@/lib/novel-ai/domain";
import type {
  ExternalAIProviderId as ExternalAIConnectorId,
  NovelAIExecutionMode,
} from "@/lib/novel-ai/providers/external/external-provider-contract";
import { generateExternalAIStream } from "@/lib/novel-ai/providers/external/external-provider-client";

type Screen =
  | "home"
  | "create"
  | "write"
  | "choice"
  | "inspect"
  | "library"
  | "world"
  | "dashboard"
  | "backup";
type AssistantStatus =
  | "checking"
  | "ollama_ready"
  | "runtime_ready"
  | "external_ready"
  | "runtime_required"
  | "auth_required";
const STUDIO_SCREENS: Screen[] = ["home", "create", "write", "choice", "inspect", "library", "world", "dashboard", "backup"];
const STUDIO_TASK_SCREENS: Screen[] = ["write", "choice", "inspect", "world", "dashboard", "backup"];
const STUDIO_SCREEN_LABELS: Record<Screen, string> = {
  home: "首頁",
  create: "開始創作",
  write: "章節寫作",
  choice: "互動故事",
  inspect: "作品檢查",
  library: "我的作品",
  world: "角色與世界",
  dashboard: "任務與成就",
  backup: "存檔與備份",
};

function resolveStudioScreen(value: string | null): Screen {
  if (value === "interactive") return "choice";
  return STUDIO_SCREENS.includes(value as Screen) ? value as Screen : "home";
}
type Project = {
  id: string;
  title: string;
  activeChapterId: string | null;
  consumerGroupId: string | null;
  packId: string | null;
  topicId: string | null;
  topicName: string | null;
  subCategory: string | null;
  coreIdea: OptionalField;
  selectedPlayModeId: string | null;
  enabledStats: string[];
  adultMode: boolean;
  adultExperienceProfile: AdultExperienceProfile | null;
  optionalFields: Record<OptionalKey, OptionalField>;
  storyLibrarySchemaVersion: string;
  chapterTitle: string;
  draft: string;
  updatedAt: string;
  versions: Array<{ at: string; title: string; content: string }>;
};
type StatChange = {
  stat: string;
  label: string;
  before: number;
  delta: number;
  after: number;
  reason: string;
};
type StatHistory = StatChange & {
  projectId: string;
  branchAt: string;
  event: string;
  eventId: string;
  sourceType: "player_choice" | "story_event" | "manual";
  chapterTitle: string;
  versionAt: string;
  createdAt: string;
};
type StoryTask = {
  taskId: string;
  name: string;
  description: string;
  status: "not_started" | "active" | "completed" | "failed" | "paused" | "abandoned" | "hidden";
  progress: number;
  target: number;
  reward: string;
  sourceEventId: string;
  chapterTitle: string;
  branchAt: string;
  versionAt: string;
  createdAt: string;
  completedAt: string | null;
};
type Achievement = {
  achievementId: string;
  name: string;
  description: string;
  condition: string;
  progress: number;
  unlocked: boolean;
  unlockedAt: string | null;
  rarity: "一般" | "稀有" | "傳奇";
  reward: string;
  hidden: boolean;
  sourceEventId: string;
};
type GameState = {
  stats: Record<string, number>;
  history: StatHistory[];
  tasks: StoryTask[];
  achievements: Achievement[];
};
type BackupPackage = {
  schemaVersion: "consumer-backup-v1";
  backupType: "quick" | "full";
  exportedAt: string;
  project: Project;
  gameState: GameState;
  branches: StudioState["branches"];
  candidate: Candidate;
  readingProgress: Record<string, unknown>;
  storyBibleSnapshot: {
    projectId: string;
    title: string;
    characters: Array<{ name: string; identity: string; goal: string }>;
    world: string;
    worldRule: string;
    conflict: string;
    unresolvedThreads: string[];
    updatedAt: string;
    source: "consumer_confirmed_fields";
  };
  storyBibleStatus: "consumer_snapshot";
  formalPayload?: BackupPayload;
};
type BackupRecord = {
  backupId: string;
  name: string;
  type: "quick" | "full";
  createdAt: string;
  bytes: number;
  snapshot: BackupPackage;
  formalPayload?: BackupPayload;
};
type Candidate = {
  projectId?: string | null;
  canonicalCandidateId?: string;
  candidateId?: string | null;
  taskId?: string | null;
  task: string;
  title: string;
  content: string;
  source: string;
  model: string;
  provider?: string | null;
  modelId?: string | null;
  modelDigest?: string | null;
  contextDigest?: string | null;
  contextSourceSummary?: string | null;
  contentDigest?: string | null;
  actualExecutor?: string;
  generatedTokenEvents?: number;
  dataLeftDevice?: boolean;
  canonicalMutationCount?: number;
  regenerationAttempt?: number;
  newCandidate?: boolean;
  previousContentReused?: boolean;
  cacheBypassed?: boolean;
  similarityMetric?: string;
  similarityScore?: number;
  sourceChapterId?: string | null;
  sourceRevision?: number | null;
  candidateKind?: "closed-ai" | "external-ai" | "local-writing-aid";
  usedLocalMemory: boolean;
  externalRequest: boolean;
  proposal?: Partial<Wizard>;
  choiceText?: string;
  impacts?: string[];
  statChanges?: StatChange[];
  diagnostic?: string;
  createdAt: string;
} | null;
type RunTaskOptions = {
  regenerateFrom?: NonNullable<Candidate>;
  extraRequirement?: string;
};
type StudioRunTask = (task: string, options?: RunTaskOptions) => Promise<void>;
type Choice = {
  key: "A" | "B" | "C";
  text: string;
  impact: string;
  stat?: string;
  delta?: number;
};
type ExecutionLog = {
  id: string;
  task: string;
  source: string;
  model: string;
  elapsedMs: number;
  externalRequest: boolean;
  at: string;
  status: "completed" | "fallback" | "failed";
};
type StudioState = {
  schemaVersion: number;
  activeProjectId: string;
  projects: Project[];
  wizard: Wizard;
  wizardStep: number;
  candidate: Candidate;
  gameStates: Record<string, GameState>;
  branches: Array<{
    branchId?: string;
    acceptedChoiceId?: string;
    reversible?: boolean;
    projectId: string;
    choice: string;
    gameState: GameState;
    draft: string;
    versionsLength: number;
    at: string;
  }>;
  backups: BackupRecord[];
  autoBackup: "off" | "accepted_content" | "chapter_complete" | "daily";
  executionLogs: ExecutionLog[];
};

const STORAGE_KEY = "novel_p12_studio_state";
const CLOUD_NOTICE_SESSION_KEY = "novel_cloud_degraded_notice_dismissed_v1";
const optionalKeys: OptionalKey[] = [
  "protagonist",
  "identity",
  "archetype",
  "goal",
  "weakness",
  "world",
  "worldRule",
  "factions",
  "conflict",
  "villain",
  "style",
  "storySeed",
  "outline",
];
const optionalLabels: Record<OptionalKey, string> = {
  protagonist: "主角姓名",
  identity: "主角身分",
  archetype: "主角原型",
  goal: "主角目標",
  weakness: "主角弱點",
  world: "世界核心",
  worldRule: "世界規則",
  factions: "重要勢力",
  conflict: "主要衝突",
  villain: "反派核心",
  style: "敘事風格",
  storySeed: "故事種子",
  outline: "十章大綱",
};
const emptyOptional = () =>
  Object.fromEntries(
    optionalKeys.map((key) => [key, blankOptional()]),
  ) as Record<OptionalKey, OptionalField>;
const emptyWizard: Wizard = {
  entryMode: "quick",
  creationMethod: "",
  title: "",
  coreIdea: "",
  consumerGroupId: "",
  packId: "",
  topicId: "",
  subCategory: "",
  playModeId: "",
  enabledStats: [],
  optionalFields: emptyOptional(),
  adultMode: false,
  ageConfirmed: false,
  adultExperienceProfile: createAdultExperienceProfile(),
};
const initialState: StudioState = {
  schemaVersion: 3,
  activeProjectId: "",
  projects: [],
  wizard: emptyWizard,
  wizardStep: 1,
  candidate: null,
  gameStates: {},
  branches: [],
  backups: [],
  autoBackup: "off",
  executionLogs: [],
};
const assistantTasks = [
  ["idea_directions", "推薦故事方向"],
  ["topic_recommendation", "推薦題材"],
  ["protagonist_recommendation", "推薦主角"],
  ["world_recommendation", "推薦世界"],
  ["conflict_recommendation", "推薦衝突"],
  ["mode_recommendation", "推薦玩法"],
  ["improve_settings", "完善故事設定"],
  ["story_seed", "產生故事種子"],
  ["plan_chapter", "產生十章大綱"],
  ["first_chapter", "建立第一章候選"],
  ["continue_story", "續寫下一章"],
  ["rewrite_selection", "改寫選取內容"],
  ["dialogue_boost", "加強人物對話"],
  ["emotion_boost", "增加情緒張力"],
  ["pacing_tune", "調整節奏"],
  ["chapter_hook", "製造章尾懸念"],
  ["three_choices", "產生三個選擇"],
] as const;

type StudioTaskExecutionProfile = {
  targetLength: number;
  maxTokens: number;
  timeoutMs: number;
  qualityMode: "fast" | "balanced" | "deep";
};

const STUDIO_TASK_EXECUTION_PROFILES: Record<string, StudioTaskExecutionProfile> = {
  idea_directions: { targetLength: 240, maxTokens: 160, timeoutMs: 90_000, qualityMode: "fast" },
  topic_recommendation: { targetLength: 220, maxTokens: 144, timeoutMs: 90_000, qualityMode: "fast" },
  protagonist_recommendation: { targetLength: 260, maxTokens: 176, timeoutMs: 90_000, qualityMode: "fast" },
  world_recommendation: { targetLength: 280, maxTokens: 192, timeoutMs: 90_000, qualityMode: "fast" },
  conflict_recommendation: { targetLength: 260, maxTokens: 176, timeoutMs: 90_000, qualityMode: "fast" },
  mode_recommendation: { targetLength: 220, maxTokens: 144, timeoutMs: 90_000, qualityMode: "fast" },
  improve_settings: { targetLength: 420, maxTokens: 288, timeoutMs: 120_000, qualityMode: "fast" },
  story_seed: { targetLength: 520, maxTokens: 352, timeoutMs: 120_000, qualityMode: "fast" },
  plan_chapter: { targetLength: 900, maxTokens: 640, timeoutMs: 180_000, qualityMode: "balanced" },
  first_chapter: { targetLength: 1_600, maxTokens: 1_024, timeoutMs: 240_000, qualityMode: "balanced" },
  continue_story: { targetLength: 900, maxTokens: 640, timeoutMs: 180_000, qualityMode: "balanced" },
  rewrite_selection: { targetLength: 520, maxTokens: 384, timeoutMs: 150_000, qualityMode: "fast" },
  dialogue_boost: { targetLength: 480, maxTokens: 352, timeoutMs: 150_000, qualityMode: "fast" },
  emotion_boost: { targetLength: 520, maxTokens: 384, timeoutMs: 150_000, qualityMode: "fast" },
  pacing_tune: { targetLength: 480, maxTokens: 352, timeoutMs: 150_000, qualityMode: "fast" },
  chapter_hook: { targetLength: 360, maxTokens: 256, timeoutMs: 120_000, qualityMode: "fast" },
  three_choices: { targetLength: 360, maxTokens: 256, timeoutMs: 120_000, qualityMode: "fast" },
};

function studioTaskExecutionProfile(
  task: string,
  browserComputePolicy: StudioClosedComputePolicy,
  externalSelected: boolean,
): StudioTaskExecutionProfile {
  const profile = STUDIO_TASK_EXECUTION_PROFILES[task]
    ?? { targetLength: 420, maxTokens: 288, timeoutMs: 120_000, qualityMode: "fast" };
  return adaptStudioProfileForExplicitLocalCompute(profile, {
    browserComputePolicy,
    externalSelected,
  });
}

function closedAIRootCauseCode(error: unknown) {
  const typed = error as {
    code?: unknown;
    causeCode?: unknown;
    cause?: { code?: unknown; causeCode?: unknown; cause?: { code?: unknown } };
  } | null;
  return String(
    typed?.causeCode
      ?? typed?.cause?.causeCode
      ?? typed?.cause?.code
      ?? typed?.cause?.cause?.code
      ?? typed?.code
      ?? "MODEL_NOT_READY",
  );
}
const choiceProgressSteps = [
  "正在整理故事脈絡……",
  "正在推進劇情……",
  "正在計算可能影響……",
  "正在建立故事分支……",
];
const emptyGameState = (enabledStats: string[] = []): GameState => ({
  stats: Object.fromEntries(
    enabledStats.map((stat) => [stat, stat === "stamina" ? 100 : stat === "level" ? 1 : 0]),
  ),
  history: [],
  tasks: [],
  achievements: [],
});
function normalizeStatValue(stat: string, value: number) {
  if (!Number.isFinite(value)) return stat === "level" ? 1 : 0;
  if (stat === "stamina" || stat === "questProgress")
    return Math.max(0, Math.min(100, value));
  if (stat === "affection") return Math.max(-100, Math.min(100, value));
  if (["experience", "turns"].includes(stat)) return Math.max(0, value);
  if (stat === "level") return Math.max(1, value);
  return value;
}
function normalizeGameState(value: unknown): GameState {
  const raw = value && typeof value === "object" ? (value as Partial<GameState>) : {};
  const history = Array.isArray(raw.history)
    ? raw.history.map((event) => {
        const before = normalizeStatValue(event.stat, Number(event.before)),
          after = normalizeStatValue(event.stat, Number(event.after));
        return { ...event, before, after, delta: after - before };
      })
    : [];
  return {
    stats:
      raw.stats && typeof raw.stats === "object"
        ? Object.fromEntries(
            Object.entries(raw.stats).map(([stat, statValue]) => [
              stat,
              normalizeStatValue(stat, Number(statValue)),
            ]),
          )
        : {},
    history,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    achievements: Array.isArray(raw.achievements) ? raw.achievements : [],
  };
}
function buildBackupPackage(
  project: Project,
  type: "quick" | "full",
  state: StudioState,
): BackupPackage {
  const fields = project.optionalFields,
    protagonist = optionalValue(fields, "protagonist"),
    storyBibleSnapshot: BackupPackage["storyBibleSnapshot"] = {
      projectId: project.id,
      title: project.title,
      characters: protagonist
        ? [
            {
              name: protagonist,
              identity: optionalValue(fields, "identity"),
              goal: optionalValue(fields, "goal"),
            },
          ]
        : [],
      world: optionalValue(fields, "world"),
      worldRule: optionalValue(fields, "worldRule"),
      conflict: optionalValue(fields, "conflict"),
      unresolvedThreads: optionalValue(fields, "conflict")
        ? [optionalValue(fields, "conflict")]
        : [],
      updatedAt: new Date().toISOString(),
      source: "consumer_confirmed_fields",
    };
  let readingProgress: Record<string, unknown> = {};
  try {
    readingProgress = JSON.parse(
      localStorage.getItem(`novel_reader_progress_${project.id}`) || "{}",
    ) as Record<string, unknown>;
  } catch {}
  return {
    schemaVersion: "consumer-backup-v1",
    backupType: type,
    exportedAt: new Date().toISOString(),
    project,
    gameState: normalizeGameState(state.gameStates[project.id]),
    branches:
      type === "full"
        ? state.branches.filter((branch) => branch.projectId === project.id)
        : [],
    candidate: type === "full" ? state.candidate : null,
    readingProgress,
    storyBibleSnapshot,
    storyBibleStatus: "consumer_snapshot",
  };
}
function makeBackupRecord(
  project: Project,
  type: "quick" | "full",
  state: StudioState,
): BackupRecord {
  const snapshot = buildBackupPackage(project, type, state),
    createdAt = snapshot.exportedAt;
  return {
    backupId: crypto.randomUUID(),
    name: `${project.title}・${type === "full" ? "完整備份" : "快速備份"}`,
    type,
    createdAt,
    bytes: new Blob([JSON.stringify(snapshot)]).size,
    snapshot,
  };
}

function coerceBackupPackage(raw: unknown): BackupPackage {
  if (!raw || typeof raw !== "object")
    throw new Error("檔案中沒有可讀取的作品資料。");
  const source = raw as Record<string, unknown>;
  if (source.manifest && source.records) {
    const payload = source as unknown as BackupPayload,
      records = payload.records,
      canonicalProject = records.projects?.[0] as Record<string, unknown> | undefined,
      canonicalChapter = records.chapters?.[0] as { title?: string; content?: string } | undefined,
      canonicalState = records.storyStates?.[0] as CanonicalStoryState | undefined;
    if (!canonicalProject) throw new Error("備份缺少作品資料。");
    const project = migrateProject({ ...canonicalProject, chapterTitle: canonicalChapter?.title, draft: canonicalChapter?.content });
    return {
      schemaVersion: "consumer-backup-v1", backupType: "full", exportedAt: payload.manifest.createdAt, project,
      gameState: canonicalState ? gameStateFromCanonical(canonicalState) : emptyGameState(),
      branches: ((records.storyBranches ?? []) as CanonicalStoryBranch[]).map((branch) => ({ branchId: branch.id, acceptedChoiceId: branch.acceptedChoiceId, reversible: false, projectId: project.id, choice: branch.name, gameState: canonicalState ? gameStateFromCanonical(canonicalState) : emptyGameState(), draft: project.draft, versionsLength: 0, at: branch.createdAt })),
      candidate: null, readingProgress: {}, storyBibleSnapshot: { projectId: project.id, title: project.title, characters: [], world: "", worldRule: "", conflict: "", unresolvedThreads: [], updatedAt: payload.manifest.createdAt, source: "consumer_confirmed_fields" }, storyBibleStatus: "consumer_snapshot", formalPayload: payload,
    };
  }
  if (source.schemaVersion === "consumer-backup-v1" && source.project)
    return source as unknown as BackupPackage;
  const legacyProject =
    (source.project && typeof source.project === "object"
      ? source.project
      : null) ||
    (Array.isArray(source.projects) && source.projects[0]
      ? source.projects[0]
      : null) ||
    (source.currentProject && typeof source.currentProject === "object"
      ? source.currentProject
      : null) ||
    (source.novel && typeof source.novel === "object" ? source.novel : null);
  if (!legacyProject || typeof legacyProject !== "object")
    throw new Error("無法辨識這份舊版作品備份。");
  const project = migrateProject(legacyProject as Record<string, unknown>);
  return {
    schemaVersion: "consumer-backup-v1",
    backupType: "full",
    exportedAt: String(source.exportedAt || source.updatedAt || new Date().toISOString()),
    project,
    gameState: normalizeGameState(
      source.gameState ||
        (source.gameStates && typeof source.gameStates === "object"
          ? (source.gameStates as Record<string, unknown>)[project.id]
          : null),
    ),
    branches: Array.isArray(source.branches)
      ? (source.branches as BackupPackage["branches"])
      : [],
    candidate: null,
    readingProgress:
      source.readingProgress && typeof source.readingProgress === "object"
        ? (source.readingProgress as Record<string, unknown>)
        : {},
    storyBibleSnapshot: {
      projectId: project.id,
      title: project.title,
      characters: [],
      world: optionalValue(project.optionalFields, "world"),
      worldRule: optionalValue(project.optionalFields, "worldRule"),
      conflict: optionalValue(project.optionalFields, "conflict"),
      unresolvedThreads: optionalValue(project.optionalFields, "conflict")
        ? [optionalValue(project.optionalFields, "conflict")]
        : [],
      updatedAt: new Date().toISOString(),
      source: "consumer_confirmed_fields",
    },
    storyBibleStatus: "consumer_snapshot",
  };
}

function words(text: string) {
  return (
    (text.match(/[\u4e00-\u9fff]/g) || []).length +
    (text.replace(/[\u4e00-\u9fff]/g, " ").match(/\b[\w'-]+\b/g) || []).length
  );
}
function formatTime(value: string) {
  return value ? new Date(value).toLocaleString("zh-TW") : "尚未儲存";
}
function optionalValue(
  fields: Record<OptionalKey, OptionalField>,
  key: OptionalKey,
) {
  return String(fields[key]?.value ?? "");
}
function normalizeOptional(raw: unknown) {
  const fields = emptyOptional();
  if (raw && typeof raw === "object")
    for (const key of optionalKeys) {
      const item = (raw as Record<string, unknown>)[key];
      if (item && typeof item === "object" && "status" in item)
        fields[key] = { ...blankOptional(), ...(item as OptionalField) };
      else if (typeof item === "string" && item)
        fields[key] = setOptional(item, "user_defined", "migration");
    }
  return fields;
}
function migrateProject(raw: Record<string, unknown>): Project {
  const selection = migrateStorySelection(raw);
  const optionalFields = normalizeOptional(raw.optionalFields);
  const map: Partial<Record<OptionalKey, unknown>> = {
    protagonist: raw.protagonist ?? raw.name,
    identity: raw.identity,
    goal: raw.goal,
    world: raw.location ?? raw.world,
    worldRule: raw.rule,
    conflict: raw.conflict,
  };
  for (const key of optionalKeys) {
    const value = map[key];
    if (value && optionalFields[key].status === "unset")
      optionalFields[key] = setOptional(
        String(value),
        "user_defined",
        "migration",
      );
  }
  return {
    id: String(raw.id || crypto.randomUUID()),
    title: String(raw.title || "未命名作品"),
    activeChapterId: typeof raw.activeChapterId === "string"
      ? raw.activeChapterId
      : null,
    consumerGroupId: selection.consumerGroupId,
    packId: selection.packId,
    topicId: selection.topicId,
    topicName: selection.topicName,
    subCategory: String(raw.subCategory || "") || null,
    coreIdea: selection.coreIdea,
    selectedPlayModeId: selection.selectedPlayModeId,
    enabledStats: selection.enabledStats,
    adultMode: raw.adultMode === true,
    adultExperienceProfile: raw.adultMode === true
      ? normalizeAdultExperienceProfile(raw.adultExperienceProfile)
      : null,
    optionalFields,
    storyLibrarySchemaVersion: selection.storyLibrarySchemaVersion,
    chapterTitle: String(raw.chapterTitle || "第一章"),
    draft: String(raw.draft ?? raw.text ?? ""),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    versions: Array.isArray(raw.versions)
      ? (raw.versions as Project["versions"])
      : [],
  };
}
function migrate(): StudioState {
  // RC3 keeps P11 source bytes as an explicit migration choice. Only the
  // current compatibility shell may hydrate automatically.
  const orderedKeys = [STORAGE_KEY];
  for (const key of orderedKeys)
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "null");
      if (raw) {
        const projects = (raw.projects || []).map(
          (project: Record<string, unknown>) => migrateProject(project),
        );
        const wizardRaw = raw.wizard || {};
        const selection = migrateStorySelection(wizardRaw);
        return {
          ...initialState,
          ...raw,
          schemaVersion: 3,
          projects,
          activeProjectId: String(raw.activeProjectId || projects[0]?.id || ""),
          wizard: {
            ...emptyWizard,
            ...wizardRaw,
            consumerGroupId: selection.consumerGroupId || "",
            packId: selection.packId || "",
            topicId: selection.topicId || "",
            playModeId: selection.selectedPlayModeId || "",
            coreIdea: String(wizardRaw.coreIdea ?? wizardRaw.synopsis ?? ""),
            optionalFields: normalizeOptional(wizardRaw.optionalFields),
            adultExperienceProfile: normalizeAdultExperienceProfile(wizardRaw.adultExperienceProfile),
          },
          gameStates: Object.fromEntries(
            Object.entries(
              raw.gameStates && typeof raw.gameStates === "object"
                ? raw.gameStates
                : {},
            ).map(([projectId, gameState]) => [
              projectId,
              normalizeGameState(gameState),
            ]),
          ),
          branches: Array.isArray(raw.branches)
            ? raw.branches.map((branch: Record<string, unknown>) => ({
                ...branch,
                gameState: normalizeGameState(
                  branch.gameState || {
                    stats: branch.stats || {},
                    history: [],
                  },
                ),
              }))
            : [],
          backups: Array.isArray(raw.backups) ? raw.backups : [],
          autoBackup: ["off", "accepted_content", "chapter_complete", "daily"].includes(String(raw.autoBackup))
            ? raw.autoBackup as StudioState["autoBackup"]
            : "off",
          executionLogs: Array.isArray(raw.executionLogs)
            ? raw.executionLogs
            : [],
        };
      }
    } catch {}
  return initialState;
}

function projectSeed(project: Project): StudioProjectSeed {
  return {
    id: project.id,
    title: project.title,
    chapterId: project.activeChapterId,
    chapterTitle: project.chapterTitle,
    draft: project.draft,
    packId: project.packId,
    topicId: project.topicId,
    subCategory: project.subCategory,
    coreIdea: project.coreIdea.value,
    protagonist: optionalValue(project.optionalFields, "protagonist"),
    goal: optionalValue(project.optionalFields, "goal"),
    world: optionalValue(project.optionalFields, "world"),
    worldRule: optionalValue(project.optionalFields, "worldRule"),
    conflict: optionalValue(project.optionalFields, "conflict"),
    style: optionalValue(project.optionalFields, "style"),
    enabledStats: project.enabledStats,
    adultMode: project.adultMode,
    adultExperienceProfile: project.adultExperienceProfile,
  };
}

function shellStateForLocalStorage(state: StudioState): StudioState {
  return {
    ...state,
    candidate: null,
    gameStates: {},
    branches: [],
    backups: [],
    projects: state.projects.map((project) => ({ ...project, draft: "", versions: [] })),
  };
}

function canonicalWriteBlocked(action: string) {
  return Object.assign(
    new Error(`本機正式作品庫目前是唯讀狀態，無法${action}。請恢復 IndexedDB 後重新載入。`),
    { code: "LOCAL_CANONICAL_WRITE_BLOCKED" },
  );
}

function candidateApplyMode(task: string) {
  return task === "rewrite_selection" ? "replace" as const : "append" as const;
}

function downloadRecoverySnapshot(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], {
    type: "application/json;charset=utf-8",
  }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `novel-legacy-recovery-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function projectFromCanonical(project: NovelProject, seed: ProjectSeed | null, existing?: Project): Project {
  const fields = existing?.optionalFields ?? emptyOptional();
  const setIfEmpty = (key: OptionalKey, raw: string | null | undefined) => {
    if (raw && fields[key].status === "unset") fields[key] = setOptional(raw, "user_defined", "migration");
  };
  setIfEmpty("protagonist", seed?.protagonist.value);
  setIfEmpty("goal", seed?.goal.value);
  setIfEmpty("world", seed?.world.value);
  setIfEmpty("worldRule", seed?.worldRule.value);
  setIfEmpty("conflict", seed?.conflict.value);
  return {
    ...(existing ?? {
      id: project.id, title: project.title, consumerGroupId: null, packId: project.genrePackId, topicId: project.genreId,
      topicName: null, subCategory: project.subgenreId, coreIdea: project.coreIdea as OptionalField, selectedPlayModeId: null,
      enabledStats: [], adultMode: project.adultMode, adultExperienceProfile: project.adultExperienceProfile ?? null, optionalFields: fields, storyLibrarySchemaVersion: STORY_LIBRARY.schemaVersion,
      activeChapterId: project.activeChapterId, chapterTitle: "第一章", draft: "", updatedAt: project.updatedAt, versions: [],
    }),
    id: project.id,
    title: project.title,
    activeChapterId: project.activeChapterId,
    coreIdea: project.coreIdea as OptionalField,
    adultMode: project.adultMode,
    adultExperienceProfile: project.adultExperienceProfile ?? existing?.adultExperienceProfile ?? null,
    optionalFields: fields,
    updatedAt: project.updatedAt,
  };
}

function gameStateFromCanonical(state: CanonicalStoryState): GameState {
  return {
    stats: { ...state.protagonistStats },
    history: [],
    tasks: Object.entries(state.questStates).map(([name, progress]) => ({ taskId: `quest:${name}`, name, description: "由正式故事狀態保存", status: Number(progress) >= 100 ? "completed" : "active", progress: Number(progress) || 0, target: 100, reward: "", sourceEventId: "canonical", chapterTitle: "", branchAt: state.updatedAt, versionAt: state.updatedAt, createdAt: state.updatedAt, completedAt: Number(progress) >= 100 ? state.updatedAt : null })),
    achievements: Object.entries(state.achievementStates).map(([name, progress]) => ({ achievementId: name, name, description: "由正式故事狀態保存", condition: "", progress: Number(progress) || 0, unlocked: Number(progress) >= 100, unlockedAt: Number(progress) >= 100 ? state.updatedAt : null, rarity: "一般", reward: "", hidden: false, sourceEventId: "canonical" })),
  };
}

async function hydrateCanonicalStudio(repository: NovelRepository, shell: StudioState): Promise<StudioState> {
  for (const legacy of shell.projects) await ensureStudioCanonicalProject(repository, projectSeed(legacy));
  const formalProjects = await repository.list<NovelProject>("projects"), projects: Project[] = [], gameStates: Record<string, GameState> = {}, branches: StudioState["branches"] = [], backups: BackupRecord[] = [];
  for (const formal of formalProjects) {
    const seed = (await repository.list<ProjectSeed>("projectSeeds", formal.id))[0] ?? null;
    const existing = shell.projects.find((item) => item.id === formal.id);
    const snapshot = await ensureStudioCanonicalProject(repository, projectSeed(projectFromCanonical(formal, seed, existing)));
    const item = projectFromCanonical(snapshot.project, seed, existing);
    item.activeChapterId = snapshot.chapter.id;
    item.chapterTitle = snapshot.chapter.title;
    item.draft = snapshot.chapter.content;
    item.updatedAt = snapshot.chapter.updatedAt;
    item.versions = [];
    projects.push(item);
    gameStates[formal.id] = gameStateFromCanonical(snapshot.storyState);
    branches.push(...snapshot.branches.map((branch: CanonicalStoryBranch) => ({ branchId: branch.id, acceptedChoiceId: branch.acceptedChoiceId, reversible: false, projectId: formal.id, choice: branch.name, gameState: gameStateFromCanonical(snapshot.storyState), draft: snapshot.chapter.content, versionsLength: 0, at: branch.createdAt })));
    for (const backup of await repository.list<ProjectBackup>("backups", formal.id)) if (["novel-backup-v3", "novel-backup-v4", "novel-backup-v5"].includes(backup.formatVersion) && backup.manifest) {
      const records = backup.snapshot as Record<string, unknown[]>, savedChapter = (records.chapters?.[0] as { title?: string; content?: string } | undefined), savedState = (records.storyStates?.[0] as CanonicalStoryState | undefined) ?? snapshot.storyState;
      const backupProject = { ...item, chapterTitle: savedChapter?.title || item.chapterTitle, draft: savedChapter?.content || "" }, backupGame = gameStateFromCanonical(savedState);
      const backupBranches = ((records.storyBranches ?? []) as CanonicalStoryBranch[]).map((branch) => ({ branchId: branch.id, acceptedChoiceId: branch.acceptedChoiceId, reversible: false, projectId: formal.id, choice: branch.name, gameState: backupGame, draft: backupProject.draft, versionsLength: 0, at: branch.createdAt }));
      const snapshotPackage = buildBackupPackage(backupProject, backup.kind === "quick" ? "quick" : "full", { ...shell, projects: [backupProject], activeProjectId: formal.id, gameStates: { [formal.id]: backupGame }, branches: backupBranches, candidate: null });
      backups.push({ backupId: backup.id, name: `${item.title}－${backup.kind === "quick" ? "快速備份" : "完整備份"}`, type: backup.kind === "quick" ? "quick" : "full", createdAt: backup.createdAt, bytes: backup.byteSize, snapshot: snapshotPackage, formalPayload: { manifest: backup.manifest, records } });
    }
  }
  return { ...shell, projects, activeProjectId: projects.some((item) => item.id === shell.activeProjectId) ? shell.activeProjectId : projects[0]?.id || "", candidate: null, gameStates, branches, backups };
}
export default function StudioClient({
  initialScreen,
  initialTask,
  initialProjectId = "",
  initialLegacyMigrationAction = "",
  release,
}: {
  initialScreen: string;
  initialTask: string;
  initialProjectId?: string;
  initialLegacyMigrationAction?: string;
  release: Record<string, string>;
}) {
  const [screen, setScreen] = useState<Screen>(
      (initialScreen as Screen) || "home",
    ),
    [state, setState] = useState<StudioState>(initialState),
    [loaded, setLoaded] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [selectedChoice, setSelectedChoice] = useState("A"),
    [customChoice, setCustomChoice] = useState(""),
    [assistantStatus, setAssistantStatus] =
      useState<AssistantStatus>("checking"),
    [assistantBusy, setAssistantBusy] = useState<string | null>(null),
    [assistantStreamText, setAssistantStreamText] = useState(""),
    [assistantStreamEvents, setAssistantStreamEvents] = useState(0),
    [assistantProgress, setAssistantProgress] = useState<ClosedAIProgressEvent | null>(null),
    [assistantFailure, setAssistantFailure] = useState(""),
    [lastRejectedCandidate, setLastRejectedCandidate] =
      useState<NonNullable<Candidate> | null>(null),
    [regenerationError, setRegenerationError] = useState(""),
    [storageFailure, setStorageFailure] = useState<{
      code: string;
      message: string;
    } | null>(null),
    [persistenceMode, setPersistenceMode] =
      useState<PersistenceRuntimeMode | null>(null),
    [cloudPersistenceIssue, setCloudPersistenceIssue] = useState<{
      errorCategory: string | null;
      migrationStatus: string;
    } | null>(null),
    [cloudNoticeDismissed, setCloudNoticeDismissed] = useState(false),
    [canonicalRuntimeGate, setCanonicalRuntimeGate] =
      useState<CanonicalRuntimeGate>({
        canonicalHydrationSucceeded: false,
        localCanonicalWritable: false,
        legacySnapshotPreserved: false,
      }),
    [migrationRecoverySnapshot, setMigrationRecoverySnapshot] =
      useState<string | null>(null),
    [legacyMigrationPreview, setLegacyMigrationPreview] = useState<
      ReturnType<typeof previewLegacyStudioProjects> | null
    >(null),
    [legacyMigrationDetails, setLegacyMigrationDetails] = useState(false),
    [legacyMigrationDismissed, setLegacyMigrationDismissed] = useState(false),
    [legacyMigrationBusy, setLegacyMigrationBusy] = useState(false),
    [legacyMigrationStatus, setLegacyMigrationStatus] = useState(""),
    [aiExecutionMode, setAiExecutionMode] = useState<NovelAIExecutionMode>("closed-only"),
    [studioAiSource, setStudioAiSource] = useState<"closed" | "external">("closed"),
    [closedComputePolicy, setClosedComputePolicy] =
      useState<StudioClosedComputePolicy>("browser-first"),
    [externalConnectorId, setExternalConnectorId] = useState<ExternalAIConnectorId>("openai"),
    [externalRunConsent, setExternalRunConsent] = useState(false),
    [aiModeMessage, setAiModeMessage] = useState(""),
    [aiPreferencesLoaded, setAiPreferencesLoaded] = useState(false),
    [taskHandoff, setTaskHandoff] = useState<StudioTaskHandoff | null>(null);
  const repositoryRef = useRef<NovelRepository | null>(null);
  const assistantControllerRef = useRef<AbortController | null>(null);
  const writerSaveRef = useRef<(() => Promise<void>) | null>(null);
  const navigationBusyRef = useRef(false);
  if (!repositoryRef.current) repositoryRef.current = createNovelRepository();
  const project = useMemo(
    () =>
      state.projects.find((item) => item.id === state.activeProjectId) ||
      state.projects[0] ||
      null,
    [state.projects, state.activeProjectId],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setCloudNoticeDismissed(
          sessionStorage.getItem(CLOUD_NOTICE_SESSION_KEY) === "1",
        );
      } catch {
        // Session storage is optional; the close control still works in memory.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loaded || screen !== "home") return;
    const timer = window.setTimeout(() => {
      setTaskHandoff(readStudioTaskHandoff());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loaded, screen]);

  useEffect(() => {
    if (!loaded || screen !== "choice" || !project) return;
    // The former lightweight single-choice page hid the real RPG dashboard.
    // Keep old bookmarks compatible, but always land on the unified HUD.
    window.location.replace(`/studio/project/${encodeURIComponent(project.id)}/rpg`);
  }, [loaded, project, screen]);

  function dismissCloudNotice() {
    setCloudNoticeDismissed(true);
    try {
      sessionStorage.setItem(CLOUD_NOTICE_SESSION_KEY, "1");
    } catch {
      // Do not turn a non-blocking cloud notice into a local writing failure.
    }
  }
  useEffect(() => {
    if (persistenceMode !== "CLOUD_DEGRADED" || cloudNoticeDismissed) return;
    const timer = window.setTimeout(() => {
      setCloudNoticeDismissed(true);
      try {
        sessionStorage.setItem(CLOUD_NOTICE_SESSION_KEY, "1");
      } catch {
        // The transient notice may still close when session storage is unavailable.
      }
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [persistenceMode, cloudNoticeDismissed]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        const originalStorageBytes = localStorage.getItem(STORAGE_KEY);
        const legacy = migrate();
        const explicitLegacyPreview = previewLegacyStudioProjects(
          EXPLICIT_LEGACY_STUDIO_KEYS,
        );
        setLegacyMigrationPreview(explicitLegacyPreview);
        const hydrationShell = /^[A-Za-z0-9_-]{1,128}$/.test(initialProjectId)
          ? { ...legacy, activeProjectId: initialProjectId }
          : legacy;
        let raw: unknown = null;
        try {
          raw = JSON.parse(originalStorageBytes || "null");
        } catch {
          raw = null;
        }
        const recoverySnapshot = originalStorageBytes
          ?? JSON.stringify({
            ...legacy,
            migrationAudit: auditLegacyStudioInteractions(raw),
          });
        const result = await hydrateCanonicalWithNonDestructiveFallback({
          originalStorageBytes,
          legacyState: hydrationShell,
          fallbackSnapshot: recoverySnapshot,
          hydrate: () =>
            hydrateCanonicalStudio(repositoryRef.current!, hydrationShell),
        });
        let hydratedState = result.state;
        if (
          initialLegacyMigrationAction === "import"
          && explicitLegacyPreview.pending
          && result.gate.localCanonicalWritable
        ) {
          try {
            const migration = await migrateLegacyStudioProjects(
              repositoryRef.current!,
              {
                sourceKeys: EXPLICIT_LEGACY_STUDIO_KEYS,
                overwriteExisting: false,
              },
            );
            hydratedState = await hydrateCanonicalStudio(
              repositoryRef.current!,
              hydratedState,
            );
            setLegacyMigrationStatus(
              `已匯入 ${migration.migrated} 部舊版作品；${migration.skippedExisting} 部同名正式作品保持不變，舊版來源仍完整保留。`,
            );
            setLegacyMigrationPreview(
              previewLegacyStudioProjects(EXPLICIT_LEGACY_STUDIO_KEYS),
            );
          } catch (error) {
            setLegacyMigrationStatus(
              `舊版作品尚未匯入：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        setMigrationRecoverySnapshot(result.recoverySnapshot);
        setState(hydratedState);
        setCanonicalRuntimeGate(result.gate);
        if (result.error) {
          const error = result.error;
          console.error("STUDIO_CANONICAL_HYDRATION_FAILED", error);
          setStorageFailure({
            code: String(
              (error as { code?: string })?.code
              || (error as Error)?.message
              || "INDEXEDDB_HYDRATION_FAILED",
            ),
            message: "IndexedDB 正式作品庫目前無法開啟；畫面保留既有資料，不會清空、覆蓋或改用暫存記憶。",
          });
        } else {
          setStorageFailure(null);
        }
        setLoaded(true);
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [initialLegacyMigrationAction, initialProjectId]);
  useEffect(() => {
    if (loaded && canPersistStudioShell(canonicalRuntimeGate)) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(shellStateForLocalStorage(state)),
      );
    }
  }, [state, loaded, canonicalRuntimeGate]);
  useEffect(() => {
    if (!loaded) return;
    void resolvePersistenceRuntimeHealth({
      repository: repositoryRef.current ?? undefined,
    }).then((health) => {
      setPersistenceMode(health.mode);
      setCloudPersistenceIssue({
        errorCategory: health.cloudPersistence.errorCategory,
        migrationStatus: health.cloudPersistence.migrationStatus,
      });
      if (!health.localFeaturesAvailable) {
        setCanonicalRuntimeGate((current) => ({
          ...current,
          localCanonicalWritable: false,
          legacySnapshotPreserved: true,
        }));
        setStorageFailure({
          code: health.localCanonicalStorage.errorCode ?? "INDEXEDDB_BLOCKED",
          message: "IndexedDB 正式作品庫目前不可用；本機創作功能已安全停止，既有畫面與匯出入口仍保留。",
        });
      }
    });
  }, [loaded]);
  useEffect(() => {
    if (
      !loaded
      || !project
      || state.autoBackup !== "daily"
      || !canonicalRuntimeGate.canonicalHydrationSucceeded
      || !canonicalRuntimeGate.localCanonicalWritable
    ) return;
    const day = new Date().toISOString().slice(0, 10),
      marker = `novel_daily_backup_${project.id}_${day}`;
    if (localStorage.getItem(marker)) return;
    const timer = setTimeout(
      () => {
        void runDailyBackupAndMark({
          createBackup: () => createBackup("full"),
          markCompleted: () => localStorage.setItem(marker, "completed"),
        })
          .catch((error) => console.error("AUTO_BACKUP_FAILED", error));
      },
      0,
    );
    return () => clearTimeout(timer);
    // createBackup intentionally resolves the latest canonical snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loaded,
    project,
    state.autoBackup,
    canonicalRuntimeGate.canonicalHydrationSucceeded,
    canonicalRuntimeGate.localCanonicalWritable,
  ]);
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get("screen") !== screen) {
      url.searchParams.set("screen", screen);
      history.replaceState({ screen }, "", url);
    }
  }, [screen]);
  useEffect(() => {
    if (!loaded || screen !== "choice") return;
    if (!project?.id) {
      commitScreen("create", true);
      return;
    }
    // The former /studio?screen=choice page exposed three deterministic strings
    // before a story existed. Keep the URL compatible, but move every consumer
    // to the canonical RPG director where foundation, model proof and StoryState
    // effects are enforced.
    window.location.replace(`/studio/project/${encodeURIComponent(project.id)}/rpg`);
  }, [loaded, project?.id, screen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onPopState = () => {
      const requested = new URL(location.href).searchParams.get("screen");
      void requestScreenNavigation(resolveStudioScreen(requested), true);
    };
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, [screen, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      const saved = JSON.parse(
        localStorage.getItem(STUDIO_AI_SETTINGS_KEY) || "null",
      ) || {};
      const mode: NovelAIExecutionMode = ["closed-only", "hybrid", "external-only"].includes(saved.executionMode)
        ? saved.executionMode
        : saved.privacy === "external-allowed"
          ? "hybrid"
          : "closed-only";
      const provider: ExternalAIConnectorId = ["openai", "gemini", "grok", "claude"].includes(saved.externalProviderId)
        ? saved.externalProviderId
        : "openai";
      setAiExecutionMode(mode);
      setStudioAiSource(mode === "external-only" ? "external" : "closed");
      setClosedComputePolicy(
        normalizeStudioClosedComputePolicy(saved.closedComputePolicy),
      );
      setExternalConnectorId(provider);
      setAiPreferencesLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loaded]);
  useEffect(() => {
    if (!loaded) return;
    const externalSelected = aiExecutionMode === "external-only" || (aiExecutionMode === "hybrid" && studioAiSource === "external");
    if (externalSelected) {
      fetch(`/api/ai/external/providers?probe=1&providers=${encodeURIComponent(externalConnectorId)}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((payload: { providers?: Array<{ id: string; configured: boolean; verification: string }> }) => {
          const selected = payload.providers?.find((provider) => provider.id === externalConnectorId);
          const verified = selected?.configured === true && selected.verification === "verified";
          setAssistantStatus(verified ? "external_ready" : "runtime_required");
          setAiModeMessage(verified ? "外接 AI 金鑰與模型已實測可用；每次送出前仍需單次同意。" : "所選外接 AI 尚未通過金鑰與模型實測，請到 AI 使用方式查看。" );
        })
        .catch(() => {
          setAssistantStatus("runtime_required");
          setAiModeMessage("目前無法讀取外接 AI 狀態。");
        });
      return;
    }
    discoverStudioClosedAI()
      .then((snapshot) => {
        setAssistantStatus(snapshot.status === "browser_ready" ? "runtime_ready" : snapshot.status);
        setAiModeMessage("");
      })
      .catch(() => setAssistantStatus("runtime_required"));
  }, [aiExecutionMode, externalConnectorId, loaded, studioAiSource]);
  useEffect(() => {
    if (
      initialTask
      && loaded
      && aiPreferencesLoaded
      && project
      && canonicalRuntimeGate.localCanonicalWritable
    ) {
      void runTask(initialTask);
    }
  }, [loaded, aiPreferencesLoaded, canonicalRuntimeGate.localCanonicalWritable]); // eslint-disable-line react-hooks/exhaustive-deps
  function ensureCanonicalWritable(action: string) {
    if (
      canonicalRuntimeGate.canonicalHydrationSucceeded
      && canonicalRuntimeGate.localCanonicalWritable
    ) return true;
    setStorageFailure((current) => current ?? {
      code: "LOCAL_CANONICAL_WRITE_BLOCKED",
      message: `本機正式作品庫目前不可寫入，已阻擋${action}；原始資料保持不變，仍可匯出復原快照。`,
    });
    return false;
  }
  function update(partial: Partial<StudioState>) {
    setState((value) => ({ ...value, ...partial }));
  }
  function updateWizard(partial: Partial<Wizard>) {
    setState((value) => ({
      ...value,
      wizard: { ...value.wizard, ...partial },
    }));
  }
  function setOptionalField(
    key: OptionalKey,
    value: string,
    status: OptionalFieldStatus = "user_defined",
  ) {
    updateWizard({
      optionalFields: {
        ...state.wizard.optionalFields,
        [key]: value
          ? setOptional(value, status, "user")
          : blankOptional(
              status === "not_applicable" ? "not_applicable" : "unset",
            ),
      },
    });
  }
  function commitScreen(value: Screen, replace = false, projectIdOverride?: string) {
    const url = new URL(location.href);
    url.pathname = "/studio";
    url.searchParams.set("screen", value);
    const destinationProjectId = projectIdOverride ?? project?.id;
    if (destinationProjectId) url.searchParams.set("projectId", destinationProjectId);
    else url.searchParams.delete("projectId");
    const method = replace ? "replaceState" : "pushState";
    history[method]({ screen: value }, "", url);
    setScreen(value);
    setMenuOpen(false);
  }

  function screenDestination(value: Screen) {
    if (!project) return `/studio?screen=${encodeURIComponent(value)}`;
    if (value === "choice") {
      return `/studio/project/${encodeURIComponent(project.id)}/rpg`;
    }
    return `/studio?screen=${encodeURIComponent(value)}&projectId=${encodeURIComponent(project.id)}`;
  }

  async function leaveCurrentTask(
    destinationHref: string,
    destinationLabel: string,
    replace = false,
  ) {
    if (!project || navigationBusyRef.current) return;
    navigationBusyRef.current = true;
    try {
      if (screen === "write" && writerSaveRef.current) {
        await writerSaveRef.current();
      }
      const handoff = stageStudioTaskHandoff({
        projectId: project.id,
        sourceLabel: STUDIO_SCREEN_LABELS[screen],
        destinationLabel,
        destinationHref,
        chapterId: project.activeChapterId,
        chapterTitle: project.chapterTitle,
      });
      setTaskHandoff(handoff);
      commitScreen("home", replace);
    } catch (error) {
      alert(`${error instanceof Error ? error.message : "目前內容尚未安全儲存"}\n\n系統已留在原頁，沒有跳到其他任務。`);
    } finally {
      navigationBusyRef.current = false;
    }
  }

  async function requestScreenNavigation(value: Screen, replace = false) {
    if (value === screen) return;
    if (STUDIO_TASK_SCREENS.includes(screen) && project) {
      if (value === "home") {
        if (navigationBusyRef.current) return;
        navigationBusyRef.current = true;
        try {
          if (screen === "write" && writerSaveRef.current) await writerSaveRef.current();
          clearStudioTaskHandoff();
          setTaskHandoff(null);
          commitScreen("home", replace);
        } catch (error) {
          alert(`${error instanceof Error ? error.message : "目前內容尚未安全儲存"}\n\n系統已留在原頁。`);
        } finally {
          navigationBusyRef.current = false;
        }
        return;
      }
      await leaveCurrentTask(screenDestination(value), STUDIO_SCREEN_LABELS[value], replace);
      return;
    }
    if (screen === "home" && value === "choice" && project) {
      clearStudioTaskHandoff();
      setTaskHandoff(null);
      window.location.assign(`/studio/project/${encodeURIComponent(project.id)}/rpg`);
      return;
    }
    if (screen === "home") {
      clearStudioTaskHandoff();
      setTaskHandoff(null);
    }
    commitScreen(value, replace);
  }

  function navigate(value: Screen) {
    void requestScreenNavigation(value);
  }

  function requestTaskHref(href: string, label: string) {
    if (!project) return;
    if (screen === "home") {
      clearStudioTaskHandoff();
      setTaskHandoff(null);
      window.location.assign(href);
      return;
    }
    void leaveCurrentTask(href, label);
  }

  function continueTaskHandoff() {
    if (!taskHandoff) return;
    const target = taskHandoff;
    clearStudioTaskHandoff();
    setTaskHandoff(null);
    setState((value) => ({ ...value, activeProjectId: target.projectId }));
    const parsed = new URL(target.destinationHref, location.origin);
    if (parsed.pathname === "/studio") {
      commitScreen(resolveStudioScreen(parsed.searchParams.get("screen")));
      return;
    }
    window.location.assign(target.destinationHref);
  }

  function dismissTaskHandoff() {
    clearStudioTaskHandoff();
    setTaskHandoff(null);
  }
  function persistStudioAISettings(input: {
    mode?: NovelAIExecutionMode;
    providerId?: ExternalAIConnectorId;
    closedComputePolicy?: StudioClosedComputePolicy;
  }) {
    const mode = input.mode ?? aiExecutionMode;
    const providerId = input.providerId ?? externalConnectorId;
    const nextClosedComputePolicy = input.closedComputePolicy
      ?? closedComputePolicy;
    const saved = JSON.parse(
      localStorage.getItem(STUDIO_AI_SETTINGS_KEY) || "null",
    ) || {};
    localStorage.setItem(STUDIO_AI_SETTINGS_KEY, JSON.stringify({
      ...saved,
      executionMode: mode,
      externalProviderId: providerId,
      closedComputePolicy: nextClosedComputePolicy,
      privacy: mode === "closed-only" ? "strict-local" : "external-allowed",
      external: mode !== "closed-only",
    }));
  }
  async function createProject() {
    if (!ensureCanonicalWritable("建立作品")) return;
    const w = state.wizard;
    if (!w.creationMethod) {
      alert("請先選擇一種建立方式，也可以選擇「保持空白」。");
      return;
    }
    if (w.adultMode && !w.ageConfirmed) {
      alert("成人模式需要先完成年齡確認。");
      return;
    }
    if (w.adultMode && !w.adultExperienceProfile.fictionalAdultsConfirmed) {
      alert("成人模式只接受明確成年、虛構且可撤回同意的角色；請先完成角色安全確認。");
      return;
    }
    const missingFoundation = creationFoundationMissing(w);
    if (missingFoundation.length) {
      alert(
        `還不能開始：請先完成${missingFoundation.map((item) => `「${item.label}」`).join("、")}。\n\n你可以自己填寫，或按「引導精靈代為完成」。`,
      );
      return;
    }
    const topic = resolveStoryTopic(w.topicId),
      now = new Date().toISOString(),
      id = crypto.randomUUID();
    const next: Project = {
      id,
      title: w.title.trim() || "未命名作品",
      activeChapterId: null,
      consumerGroupId: w.consumerGroupId || topic?.consumerGroupId || null,
      packId: w.packId || topic?.packId || null,
      topicId: topic?.topicId || null,
      topicName: topic?.name || null,
      subCategory: w.subCategory || null,
      coreIdea: w.coreIdea
        ? setOptional(w.coreIdea, "user_defined", "user")
        : blankOptional(),
      selectedPlayModeId: w.playModeId || null,
      enabledStats: w.playModeId ? w.enabledStats : [],
      adultMode: Boolean(w.adultMode && w.ageConfirmed),
      adultExperienceProfile: w.adultMode && w.ageConfirmed
        ? normalizeAdultExperienceProfile(w.adultExperienceProfile)
        : null,
      optionalFields: w.optionalFields,
      storyLibrarySchemaVersion: STORY_LIBRARY.schemaVersion,
      chapterTitle: "第一章",
      draft: "",
      updatedAt: now,
      versions: [],
    };
    let canonical: Awaited<ReturnType<typeof ensureStudioCanonicalProject>>;
    try { canonical = await ensureStudioCanonicalProject(repositoryRef.current!, projectSeed(next)); }
    catch (error) { console.error("PROJECT_CANONICAL_CREATE_FAILED", error); alert("作品保存失敗，尚未建立正式作品，請再試一次。"); return; }
    const persistedNext: Project = {
      ...next,
      activeChapterId: canonical.chapter.id,
      chapterTitle: canonical.chapter.title,
      draft: canonical.chapter.content,
      updatedAt: canonical.chapter.updatedAt,
    };
    update({
      projects: [persistedNext, ...state.projects],
      activeProjectId: id,
      candidate: null,
      gameStates: {
        ...state.gameStates,
        [id]: emptyGameState(next.enabledStats),
      },
      wizard: { ...emptyWizard, optionalFields: emptyOptional() },
      wizardStep: 1,
    });
    commitScreen("write", false, id);
  }
  async function saveDraft(chapterId: string, title: string, draft: string) {
    if (!ensureCanonicalWritable("儲存草稿")) return;
    if (!project) return;
    if (!chapterId) throw new Error("目前章節缺少識別碼，內容未儲存到其他章節。");
    try {
      const canonical = await saveStudioChapter(
        repositoryRef.current!,
        { ...projectSeed({ ...project, chapterTitle: title, draft }), chapterId },
      );
      setState((value) => ({
        ...value,
        projects: value.projects.map((item) =>
          item.id === project.id
            ? item.activeChapterId === canonical.chapter.id ? {
                ...item,
                chapterTitle: canonical.chapter.title,
                draft: canonical.chapter.content,
                updatedAt: canonical.chapter.updatedAt,
              }
              : item
            : item,
        ),
      }));
    } catch (error) {
      console.error("CHAPTER_CANONICAL_SAVE_FAILED", error);
      throw error;
    }
  }
  async function activateStudioChapter(chapterId: string) {
    if (!ensureCanonicalWritable("切換章節")) throw canonicalWriteBlocked("切換章節");
    if (!project) throw new Error("目前沒有可切換的作品。");
    const repository = repositoryRef.current!;
    const [formalProject, targetChapter] = await Promise.all([
      repository.get<NovelProject>("projects", project.id),
      repository.get<Chapter>("chapters", chapterId),
    ]);
    if (!formalProject || !targetChapter || targetChapter.projectId !== project.id) {
      throw new Error("找不到指定章節，未切換任何內容。");
    }
    if (formalProject.activeChapterId !== targetChapter.id) {
      await repository.put<NovelProject>("projects", {
        ...formalProject,
        activeChapterId: targetChapter.id,
      }, formalProject.revision);
    }
    setState((value) => ({
      ...value,
      candidate: null,
      projects: value.projects.map((item) => item.id === project.id
        ? {
            ...item,
            activeChapterId: targetChapter.id,
            chapterTitle: targetChapter.title,
            draft: targetChapter.content,
            updatedAt: targetChapter.updatedAt,
          }
        : item),
    }));
    return targetChapter;
  }
  async function createStudioChapter() {
    if (!ensureCanonicalWritable("新增章節")) throw canonicalWriteBlocked("新增章節");
    if (!project) throw new Error("目前沒有可新增章節的作品。");
    const repository = repositoryRef.current!;
    const chapters = (await repository.list<Chapter>("chapters", project.id))
      .sort((left, right) => left.order - right.order);
    const order = Math.max(0, ...chapters.map((item) => item.order)) + 1;
    const chapter = await repository.put<Chapter>("chapters", {
      ...makeRecord(project.id, "user"),
      title: `第${order}章`,
      order,
      content: "",
      summary: null,
      status: "draft",
    });
    await activateStudioChapter(chapter.id);
    return chapter;
  }
  async function deleteStudioChapter(chapterId: string) {
    if (!ensureCanonicalWritable("刪除章節")) throw canonicalWriteBlocked("刪除章節");
    if (!project) throw new Error("目前沒有可刪除章節的作品。");
    const repository = repositoryRef.current!;
    const chapters = (await repository.list<Chapter>("chapters", project.id))
      .sort((left, right) => left.order - right.order);
    if (chapters.length <= 1) throw new Error("作品至少要保留一章。");
    const index = chapters.findIndex((item) => item.id === chapterId);
    if (index < 0) throw new Error("找不到要刪除的章節。");
    await repository.remove("chapters", chapterId);
    const remaining = chapters.filter((item) => item.id !== chapterId);
    const next = remaining[Math.min(index, remaining.length - 1)];
    await activateStudioChapter(next.id);
    return next;
  }
  async function createBackup(type: "quick" | "full") {
    if (!ensureCanonicalWritable("建立備份")) return null;
    if (!project) return null;
    await saveStudioChapter(repositoryRef.current!, projectSeed(project));
    const formal = await createProjectBackup(repositoryRef.current!, project.id, type, release),
      record = { ...makeBackupRecord(project, type, state), backupId: formal.backup.id, bytes: formal.backup.byteSize, createdAt: formal.backup.createdAt, formalPayload: formal.payload };
    update({ backups: [record, ...state.backups] });
    return record;
  }
  async function importBackup(snapshot: BackupPackage) {
    if (!ensureCanonicalWritable("匯入備份")) {
      throw canonicalWriteBlocked("匯入備份");
    }
    if (snapshot.formalPayload) {
      const validated = await validateBackupPayload(snapshot.formalPayload);
      if (!validated.valid) throw new Error(validated.reason);
      const newId = await repositoryRef.current!.importProject(validated.payload.records, "copy");
      const hydrated = await hydrateCanonicalStudio(repositoryRef.current!, { ...state, activeProjectId: newId });
      setState(hydrated);
      return;
    }
    if (!snapshot?.project || snapshot.schemaVersion !== "consumer-backup-v1")
      throw new Error("這不是有效的作品備份檔。");
    const newId = crypto.randomUUID(),
      importedProject = {
        ...migrateProject(snapshot.project as unknown as Record<string, unknown>),
        id: newId,
        title: `${snapshot.project.title}（匯入）`,
        updatedAt: new Date().toISOString(),
      },
      importedBranches = (snapshot.branches || []).map((branch) => ({
        ...branch,
        projectId: newId,
      }));
    const importedCanonical = await ensureStudioCanonicalProject(repositoryRef.current!, projectSeed(importedProject)), importedGame = normalizeGameState(snapshot.gameState);
    await repositoryRef.current!.put("storyStates", { ...importedCanonical.storyState, protagonistStats: importedGame.stats }, importedCanonical.storyState.revision);
    setState((value) => ({
      ...value,
      projects: [importedProject, ...value.projects],
      activeProjectId: newId,
      gameStates: {
        ...value.gameStates,
        [newId]: importedGame,
      },
      branches: [...value.branches, ...importedBranches],
      candidate: null,
    }));
  }
  async function restoreBackup(record: BackupRecord, asCopy: boolean) {
    if (!ensureCanonicalWritable("還原備份")) {
      throw canonicalWriteBlocked("還原備份");
    }
    if (!project) return;
    if (record.formalPayload) {
      const validated = await validateBackupPayload(record.formalPayload);
      if (!validated.valid) throw new Error(validated.reason);
      if (!asCopy) await createProjectBackup(repositoryRef.current!, project.id, "safety", release);
      const restoredId = await repositoryRef.current!.importProject(validated.payload.records, asCopy ? "copy" : "replace", asCopy ? undefined : project.id);
      setState(await hydrateCanonicalStudio(repositoryRef.current!, { ...state, activeProjectId: restoredId }));
      return;
    }
    if (asCopy) {
      await importBackup(record.snapshot);
      return;
    }
    const safety = makeBackupRecord(project, "full", state),
      restored = { ...record.snapshot.project, id: project.id, updatedAt: new Date().toISOString() };
    await createProjectBackup(repositoryRef.current!, project.id, "safety", release);
    const restoredCanonical = await saveStudioChapter(repositoryRef.current!, projectSeed(restored)), restoredGame = normalizeGameState(record.snapshot.gameState);
    await repositoryRef.current!.put("storyStates", { ...restoredCanonical.storyState, protagonistStats: restoredGame.stats }, restoredCanonical.storyState.revision);
    setState((value) => ({
      ...value,
      backups: [safety, ...value.backups],
      projects: value.projects.map((item) => item.id === project.id ? restored : item),
      gameStates: { ...value.gameStates, [project.id]: normalizeGameState(record.snapshot.gameState) },
      branches: [
        ...value.branches.filter((branch) => branch.projectId !== project.id),
        ...(record.snapshot.branches || []).map((branch) => ({ ...branch, projectId: project.id })),
      ],
      candidate: null,
    }));
    localStorage.setItem(
      `novel_reader_progress_${project.id}`,
      JSON.stringify(record.snapshot.readingProgress || {}),
    );
  }
  async function deleteBackup(backupId: string) {
    if (!ensureCanonicalWritable("刪除備份")) {
      throw canonicalWriteBlocked("刪除備份");
    }
    await repositoryRef.current!.remove("backups", backupId);
    update({ backups: state.backups.filter((backup) => backup.backupId !== backupId) });
  }
  function updateProjectOptional(
    changes: Partial<Record<OptionalKey, OptionalField>>,
  ) {
    if (!ensureCanonicalWritable("更新角色與世界設定")) return;
    if (!project) return;
    const old = {
      at: new Date().toISOString(),
      title: "角色與世界設定修改前",
      content: project.draft,
    };
    setState((value) => ({
      ...value,
      projects: value.projects.map((item) =>
        item.id === project.id
          ? {
              ...item,
              optionalFields: { ...item.optionalFields, ...changes },
              updatedAt: new Date().toISOString(),
              versions: [old, ...item.versions],
            }
          : item,
      ),
    }));
  }
  async function completeChapter(chapterTitle: string, draft: string) {
    if (!ensureCanonicalWritable("完成章節")) {
      throw new Error("本機正式作品庫目前不可寫入，沒有完成或切換章節。");
    }
    if (!project) throw new Error("目前沒有可完成的作品。");
    const completedAt = new Date().toISOString();
    const old = {
      at: completedAt,
      title: chapterTitle,
      content: draft,
    };
    try {
      const repository = repositoryRef.current!;
      if (!project.activeChapterId) {
        throw new Error("完成章節時找不到目前章節資料。");
      }
      const {
        completedChapter: completed,
        nextChapter,
        backup: formalBackup,
      } = await completeCanonicalStudioChapter(repository, {
        projectId: project.id,
        chapterId: project.activeChapterId,
        chapterTitle,
        draft,
        createFullBackup: state.autoBackup === "chapter_complete",
        release,
      });
      const completedProject: Project = {
        ...project,
        activeChapterId: completed.id,
        chapterTitle: completed.title,
        draft: completed.content,
        updatedAt: completed.updatedAt,
        versions: [{ ...old, title: `${completed.title}（完成）` }, ...project.versions],
      };
      const nextProject: Project = {
        ...completedProject,
        activeChapterId: nextChapter.id,
        chapterTitle: nextChapter.title,
        draft: nextChapter.content,
        updatedAt: nextChapter.updatedAt,
      };
      setState((value) => {
        const projects = value.projects.map((item) => item.id === project.id
          ? nextProject
          : item);
        const nextState = { ...value, projects, candidate: null };
        const backupState = {
          ...value,
          projects: value.projects.map((item) => item.id === project.id
            ? completedProject
            : item),
          candidate: null,
        };
        const chapterBackup = formalBackup
          ? [{
              ...makeBackupRecord(completedProject, "full", backupState),
              name: `${completedProject.title}・${completed.title}完成備份`,
              backupId: formalBackup.backup.id,
              bytes: formalBackup.backup.byteSize,
              createdAt: formalBackup.backup.createdAt,
              formalPayload: formalBackup.payload,
            }]
          : [];
        return {
          ...nextState,
          backups: [...chapterBackup, ...value.backups],
          executionLogs: [
            {
              id: crypto.randomUUID(),
              task: "chapter_completed",
              source: "正式章節完成事件",
              model: "local-event",
              elapsedMs: 0,
              externalRequest: false,
              at: completedAt,
              status: "completed" as const,
            },
            ...value.executionLogs,
          ].slice(0, 50),
        };
      });
    } catch (error) {
      console.error("CHAPTER_COMPLETE_FAILED", error);
      throw error instanceof Error ? error : new Error("完成章節失敗，沒有建立下一章。");
    }
  }
  function contextFor(task: string, currentChapterText = project?.draft ?? "") {
    const fields = project?.optionalFields ?? state.wizard.optionalFields;
    return JSON.stringify({
      task,
      title: project?.title || state.wizard.title || null,
      topic:
        project?.topicName ||
        resolveStoryTopic(state.wizard.topicId)?.name ||
        null,
      coreIdea: project?.coreIdea.value || state.wizard.coreIdea || null,
      protagonist: optionalValue(fields, "protagonist") || null,
      world: optionalValue(fields, "world") || null,
      conflict: optionalValue(fields, "conflict") || null,
      recentText: currentChapterText.slice(-1600) || null,
      instruction:
        "只提出候選，不得假設空白欄位已設定；若輸出推薦或三選一，請使用簡潔 JSON。",
    });
  }
  // Kept only to decode pre-RC5 local-rule records during migration. New tasks
  // never call this constructor and fail closed when no real model answers.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function ruleCandidate(task: string): Candidate {
    const fields = project?.optionalFields ?? state.wizard.optionalFields,
      name = optionalValue(fields, "protagonist") || "主角",
      rawConflict = optionalValue(fields, "conflict"),
      conflict = rawConflict || "眼前仍待作者決定的問題",
      topic =
        project?.topicName ||
        resolveStoryTopic(state.wizard.topicId)?.name ||
        "目前故事",
      hasContext = Boolean(
        project?.topicName ||
          state.wizard.topicId ||
          state.wizard.coreIdea ||
          optionalKeys.some((key) => optionalValue(fields, key)),
      );
    const recommended = recommendStoryTopics(
      {
        coreIdea: state.wizard.coreIdea,
        groupId: state.wizard.consumerGroupId || undefined,
      },
      6,
    );
    const sparse =
      "目前設定仍較少，你可以先保持空白，也可以請閉端創作助手幫你補充世界背景。";
    const texts: Record<string, string> = {
      idea_directions: hasContext
        ? recommended
            .map(
              (item, index) =>
                `${index + 1}. ${item.name}：${item.description}`,
            )
            .join("\n")
        : sparse,
      topic_recommendation: hasContext
        ? recommended.map((item) => item.name).join("、")
        : sparse,
      protagonist_recommendation: hasContext
        ? `${topic}可考慮一位目標清楚、但仍保留弱點與選擇空間的主角。`
        : sparse,
      world_recommendation: hasContext
        ? `可先建立一個會直接影響${name}選擇的地點或規則，其餘保持空白。`
        : sparse,
      conflict_recommendation: hasContext
        ? `可讓${name}面對「${conflict}」，並先定義一項看得見的代價。`
        : sparse,
      mode_recommendation:
        "一般小說適合直接寫作；互動與數值玩法都可稍後再啟用。",
      improve_settings: hasContext
        ? `依照「${topic}」目前最值得先補充的是主角目標、世界規則或主要衝突其中一項，其餘欄位可繼續空白。`
        : sparse,
      story_seed: hasContext
        ? `${name}在${topic}的起點發現一個會改變原有目標的線索，但是否追查仍由作者決定。`
        : sparse,
      plan_chapter: hasContext
        ? Array.from(
            { length: 10 },
            (_, index) =>
              `第${index + 1}章：${index < 3 ? "建立人物目標與壓力" : index < 7 ? "擴大選擇代價" : "回收線索並留下新懸念"}`,
          ).join("\n")
        : sparse,
      first_chapter: hasContext
        ? `${name}在一個平常時刻察覺異常。故事先呈現具體行動，再讓「${conflict}」逐步成形。`
        : sparse,
      continue_story: project?.draft
        ? `${name}沒有立刻下結論，而是從最近發生的事情中挑出一個可驗證的細節。`
        : sparse,
      rewrite_selection: project?.draft
        ? `可把目前章節中最摘要的段落改成具體場景：讓${name}先做出一個小動作，再讓旁人用反應呈現壓力。`
        : sparse,
      dialogue_boost: hasContext
        ? `新增一段對話時，讓${name}的每句話都帶著目標；對方則用迴避、追問或試探，使「${conflict}」更清楚。`
        : sparse,
      emotion_boost: hasContext
        ? `不要直接說情緒，改用${name}的停頓、視線、握緊物件或改變語氣來呈現壓力。`
        : sparse,
      pacing_tune: project?.draft
        ? "可先刪掉重複說明，再用一個具體阻礙把段落推向下一個行動。"
        : sparse,
      chapter_hook: hasContext
        ? `章尾可讓${name}剛以為問題暫時穩住，卻發現「${conflict}」背後還藏著另一個更急迫的後果。`
        : sparse,
      three_choices: hasContext
        ? `A｜${name}主動處理${conflict}，推進較快但風險較高。\nB｜${name}先調查再決定，推進較慢但資訊較多。\nC｜${name}借第三方製造轉折，人物關係可能改變。`
        : sparse,
    };
    return {
      task,
      title: "故事建議",
      content: texts[task] || texts.story_seed,
      source: "本機故事建議",
      model: "local-rule",
      usedLocalMemory: Boolean(project),
      externalRequest: false,
      createdAt: new Date().toISOString(),
    };
  }
  async function runTask(task: string, options: RunTaskOptions = {}) {
    const regenerationSource = options.regenerateFrom;
    if (!ensureCanonicalWritable("執行會產生候選的助手工作")) {
      if (regenerationSource) {
        setRegenerationError(
          "本機作品資料仍在準備中，重新生成尚未啟動。（LOCAL_CANONICAL_WRITE_BLOCKED）",
        );
      }
      return;
    }
    if (assistantBusy) {
      if (regenerationSource) {
        setRegenerationError(
          "上一個 AI 工作仍在結束中，重新生成尚未啟動。（STUDIO_AI_BUSY）",
        );
      }
      return;
    }
    const externalSelected = aiExecutionMode === "external-only" || (aiExecutionMode === "hybrid" && studioAiSource === "external");
    const started = performance.now();
    const executionProfile = studioTaskExecutionProfile(
      task,
      closedComputePolicy,
      externalSelected,
    );
    if (externalSelected && !externalRunConsent) {
      setAiModeMessage("外接 AI 需要本次單次同意；請先勾選寫作頁上方的同意框。");
      return;
    }
    let candidate: Candidate = null;
    let sourceChapterId: string | null = null;
    let sourceRevision: number | null = null;
    let currentChapterText = project?.draft ?? "";
    if (regenerationSource && regenerationSource.candidateKind === "local-writing-aid") {
      setRegenerationError("只有具備真實模型證明的候選才能換一個版本。");
      return;
    }
    setRegenerationError("");
    if (!regenerationSource) setLastRejectedCandidate(null);
    if (
      regenerationSource?.candidateId
      && state.candidate?.candidateId === regenerationSource.candidateId
    ) {
      if (regenerationSource.candidateKind === "closed-ai") {
        try {
          await rejectStudioClosedAgentCandidate(regenerationSource.candidateId);
          setState((value) => ({ ...value, candidate: null }));
          setLastRejectedCandidate(regenerationSource);
        } catch (error) {
          console.error("STUDIO_REGENERATION_SOURCE_REJECTION_FAILED", error);
          setRegenerationError("原候選尚未安全放棄，系統沒有開始重新生成。");
          return;
        }
      } else {
        setState((value) => ({ ...value, candidate: null }));
        setLastRejectedCandidate(regenerationSource);
      }
    }
    const taskController = new AbortController();
    let taskTimedOut = false;
    const taskDeadline = window.setTimeout(() => {
      taskTimedOut = true;
      taskController.abort("STUDIO_AI_TASK_TIMEOUT");
    }, executionProfile.timeoutMs);
    assistantControllerRef.current = taskController;
    setAssistantStreamText("");
    setAssistantStreamEvents(0);
    setAssistantProgress(null);
    setAssistantFailure("");
    setAssistantBusy(regenerationSource ? `regenerate:${task}` : task);
    try {
      if (project) {
        const canonical = await ensureStudioCanonicalProject(
          repositoryRef.current!,
          projectSeed(project),
        );
        sourceChapterId = canonical.chapter.id;
        sourceRevision = canonical.chapter.revision;
        currentChapterText = canonical.chapter.content;
      }
      const taskInput = {
        projectId: project?.id || "draft-project",
        task,
        input: contextFor(task, currentChapterText),
        sourceChapterId: sourceChapterId ?? undefined,
        sourceRevision: sourceRevision ?? undefined,
        targetLength: executionProfile.targetLength,
        qualityMode: executionProfile.qualityMode,
        browserComputePolicy: closedComputePolicy,
        generationOptions: {
          maxTokens: executionProfile.maxTokens,
          temperature: regenerationSource ? 0.9 : 0.76,
          topP: 0.92,
          repetitionPenalty: regenerationSource ? 1.18 : 1.1,
        },
        signal: taskController.signal,
        onProgress: (event: ClosedAIProgressEvent) => {
          setAssistantProgress(event);
          if (event.delta) setAssistantStreamText((value) => value + event.delta);
          setAssistantStreamEvents((value) => Math.max(
            value + 1,
            event.generatedTokenEvents ?? 0,
          ));
        },
      };
      if (externalSelected) {
        setExternalRunConsent(false);
        const externalPrompt = [
          taskInput.input,
          regenerationSource ? `\n請重新生成真正不同的版本，不得重用以下候選內容：\n${regenerationSource.content}` : "",
          options.extraRequirement ? `\n本次額外要求：${options.extraRequirement}` : "",
          regenerationSource ? `\n重新生成識別：${crypto.randomUUID()}` : "",
        ].filter(Boolean).join("\n");
        const generated = await generateExternalAIStream({
          executionMode: aiExecutionMode,
          providerId: externalConnectorId,
          externalConsent: true,
          prompt: externalPrompt,
          maxOutputTokens: executionProfile.maxTokens,
        }, {
          signal: taskController.signal,
          onDelta: (delta, generatedTokenEvents) => {
            setAssistantStreamText((value) => value + delta);
            setAssistantStreamEvents(generatedTokenEvents);
            setAssistantProgress({
              taskId: `external:${task}`,
              phase: "generating",
              label: `外接 AI 已串流 ${generatedTokenEvents} 個片段`,
              percent: Math.min(82, 48 + Math.round(Math.sqrt(generatedTokenEvents) * 4)),
              occurredAt: new Date().toISOString(),
              generatedTokenEvents,
            });
          },
        });
        const contentDigest = await sha256Hex(generated.text);
        if (regenerationSource?.contentDigest === contentDigest) {
          throw Object.assign(new Error("外接 AI 重新產生了完全相同的內容。"), { code: "REGENERATION_NOT_DISTINCT" });
        }
        candidate = {
          projectId: project?.id ?? null,
          candidateId: `external:${generated.requestId || crypto.randomUUID()}`,
          taskId: `external-task:${crypto.randomUUID()}`,
          task,
          title: assistantTasks.find((item) => item[0] === task)?.[1] || "故事建議",
          content: generated.text,
          source: `${externalConnectorId} 外接 AI`,
          model: generated.modelId || externalConnectorId,
          provider: externalConnectorId,
          modelId: generated.modelId || externalConnectorId,
          modelDigest: null,
          contextDigest: await sha256Hex(externalPrompt),
          contextSourceSummary: "目前章節、作品設定與本次明確指示",
          contentDigest,
          actualExecutor: `external-api:${externalConnectorId}`,
          generatedTokenEvents: generated.generatedTokenEvents,
          dataLeftDevice: true,
          canonicalMutationCount: 0,
          regenerationAttempt: regenerationSource ? (regenerationSource.regenerationAttempt || 0) + 1 : undefined,
          newCandidate: Boolean(regenerationSource),
          previousContentReused: false,
          cacheBypassed: Boolean(regenerationSource),
          sourceChapterId,
          sourceRevision,
          candidateKind: "external-ai",
          usedLocalMemory: Boolean(project),
          externalRequest: true,
          createdAt: new Date().toISOString(),
        };
        setAssistantStatus("external_ready");
        setAiModeMessage("外接 AI 已完成候選；核准前正式章節沒有變更。");
      } else {
        const result = regenerationSource
          ? await regenerateStudioClosedAI(taskInput, {
            taskId: regenerationSource.taskId,
            candidateId: regenerationSource.candidateId,
            content: regenerationSource.content,
            contentDigest: regenerationSource.contentDigest,
            regenerationAttempt: regenerationSource.regenerationAttempt,
          }, {
            extraRequirement: options.extraRequirement,
          })
          : await runStudioClosedAI(taskInput);
        const distinctness = ("distinctness" in result ? result.distinctness : null) as null | { similarityMetric: string; similarityScore: number };
        candidate = {
          projectId: project?.id ?? null,
          candidateId: result.candidateId,
          taskId: result.taskId,
          task,
          title: assistantTasks.find((item) => item[0] === task)?.[1] || "故事建議",
          content: result.content,
          source: result.provider === "local-ollama" ? "本機 AI" : "瀏覽器閉端 AI",
          model: result.model,
          provider: result.provider,
          modelId: result.model,
          modelDigest: result.modelDigest,
          contextDigest: result.contextDigest,
          contextSourceSummary: result.contextSourceSummary,
          contentDigest: result.contentDigest,
          actualExecutor: result.actualExecutor,
          generatedTokenEvents: result.executionReceipt?.generatedTokenEvents ?? 0,
          dataLeftDevice: result.dataLeftDevice,
          canonicalMutationCount: result.canonicalMutationCount,
          regenerationAttempt: result.regeneration?.regenerationAttempt ?? undefined,
          newCandidate: result.regeneration?.newCandidate ?? undefined,
          previousContentReused: result.regeneration?.previousContentReused ?? undefined,
          cacheBypassed: result.regeneration?.cacheBypassed ?? undefined,
          similarityMetric: distinctness?.similarityMetric,
          similarityScore: distinctness?.similarityScore,
          sourceChapterId: result.sourceChapterId,
          sourceRevision: result.sourceRevision,
          candidateKind: "closed-ai",
          usedLocalMemory: Boolean(project),
          externalRequest: Boolean(result.externalRequest),
          createdAt: new Date().toISOString(),
        };
        setAssistantStatus(result.provider === "local-ollama" ? "ollama_ready" : "runtime_ready");
      }
      setAssistantFailure("");
      setLastRejectedCandidate(null);
    } catch (error) {
      const code = taskTimedOut ? "STUDIO_AI_TASK_TIMEOUT" : closedAIRootCauseCode(error);
      if (regenerationSource) {
        console.error("STUDIO_EXPLICIT_REGENERATION_FAILED", {
          code,
          normalizedDigestDifferent: (error as { normalizedDigestDifferent?: boolean })
            ?.normalizedDigestDifferent,
          similarityMetric: (error as { similarityMetric?: string })?.similarityMetric,
          similarityScore: (error as { similarityScore?: number })?.similarityScore,
        });
        setRegenerationError(
          code === "REGENERATION_NOT_DISTINCT"
            ? "模型連續產生相同內容，請調整額外要求或改用其他模型。"
            : "模型沒有完成不同版本；原候選已放棄，正式故事沒有變更。",
        );
        setRegenerationError((current) => `${current}（${code}）`);
        setState((value) => ({
          ...value,
          candidate: null,
          executionLogs: [
            {
              id: crypto.randomUUID(),
              task,
              source: "explicit-regeneration",
              model: regenerationSource.model,
              elapsedMs: Math.round(performance.now() - started),
              externalRequest: externalSelected,
              at: new Date().toISOString(),
              status: "failed" as const,
            },
            ...value.executionLogs,
          ].slice(0, 50),
        }));
        return;
      }
      if (externalSelected) {
        setAiModeMessage(`${error instanceof Error ? error.message : "外接 AI 沒有完成這次工作。"}（${code}）系統沒有回退到閉端或規則模板。`);
        setState((value) => ({
          ...value,
          candidate: null,
          executionLogs: [{ id: crypto.randomUUID(), task, source: `${externalConnectorId} 外接 AI`, model: externalConnectorId, elapsedMs: Math.round(performance.now() - started), externalRequest: true, at: new Date().toISOString(), status: "failed" as const }, ...value.executionLogs].slice(0, 50),
        }));
        return;
      }
      if (taskController.signal.aborted) {
        const message = taskTimedOut
          ? `真實模型在 ${Math.round(executionProfile.timeoutMs / 1_000)} 秒內沒有完成「${assistantTasks.find((item) => item[0] === task)?.[1] ?? task}」。已停止本次工作，沒有建立候選或修改正文。`
          : "已停止本次生成；未完成內容沒有建立候選，也沒有修改正式章節。";
        setAssistantFailure(`${message}（${code}）`);
        setAiModeMessage(message);
        setState((value) => ({ ...value, candidate: null }));
        return;
      }
      const guidance = code === "LOCAL_NETWORK_PERMISSION_DENIED"
        ? "瀏覽器拒絕本機網路權限。請在網址列的網站權限中允許「本機網路存取」，再到閉端 AI 指揮中心重新配對。"
        : code === "BROWSER_AI_ESCALATE_LOCAL_OLLAMA"
          ? "瀏覽器生成模型本次執行失敗，而且 Local Ollama 尚未連線。請先在閉端 AI 指揮中心重測已安裝的 Browser 模型，或啟動本機 AI Companion。"
          : code.startsWith("BROWSER_AI_REQUIRED_GENERATIVE") || code.startsWith("BROWSER_WEBLLM")
            ? "已安裝的 Browser 生成模型沒有完成真實推理。請重新實測模型；若裝置資源不足，改用較小模型或 Local Ollama。"
        : code === "CLOSED_AI_REQUIRED_BACKEND_NOT_READY"
          ? "這項創作需要真實生成模型；Local Ollama 尚未完成配對與實測。"
          : code === "BROWSER_AI_TASK_NOT_SUPPORTED"
            ? "目前瀏覽器只有摘要／分類模型，不能拿來冒充續寫模型。"
            : "真實閉端模型沒有完成這次工作，系統已安全停止。";
      candidate = null;
      setAssistantFailure(`${guidance}（${code}）`);
      setAiModeMessage(guidance);
      setAssistantStatus((current) =>
        current === "auth_required" ? current : "runtime_required",
      );
    } finally {
      window.clearTimeout(taskDeadline);
      if (assistantControllerRef.current === taskController) assistantControllerRef.current = null;
      setAssistantBusy(null);
    }
    const elapsedMs = Math.round(performance.now() - started),
      status: ExecutionLog["status"] =
        !candidate ? "failed" : candidate.model === "local-rule" ? "fallback" : "completed";
    setState((value) => ({
      ...value,
      candidate,
      executionLogs: [
        {
          id: crypto.randomUUID(),
          task,
          source: candidate?.source || "failed",
          model: candidate?.model || "none",
          elapsedMs,
          externalRequest: Boolean(candidate?.externalRequest),
          at: new Date().toISOString(),
          status,
        },
        ...value.executionLogs,
      ].slice(0, 50),
    }));
    const creationTasks = new Set([
      "idea_directions",
      "topic_recommendation",
      "protagonist_recommendation",
      "world_recommendation",
      "conflict_recommendation",
      "mode_recommendation",
      "improve_settings",
      "story_seed",
      "plan_chapter",
    ]);
    if (screen !== "write" && !creationTasks.has(task)) navigate("write");
  }
  function stopAssistantTask() {
    if (!assistantControllerRef.current || !assistantBusy) return;
    assistantControllerRef.current.abort("USER_CANCELLED");
    setAiModeMessage("已停止本次生成；未完成內容沒有建立候選，也沒有寫入正式章節。");
  }
  async function acceptCandidate(editedContent?: string) {
    if (!ensureCanonicalWritable("核准候選內容")) return;
    if (!project || !state.candidate || assistantBusy) return;
    const pending = state.candidate;
    if (
      !pending.taskId
      || !pending.sourceChapterId
      || pending.sourceRevision == null
    ) {
      alert("這份候選缺少來源章節版本，不能安全核准；請重新產生。");
      return;
    }
    const old = {
      at: new Date().toISOString(),
      title: project.chapterTitle,
      content: project.draft,
    };
    const content = (editedContent ?? pending.content).trim();
    let committed: StudioCanonicalApplyResult;
    setAssistantBusy("accept_candidate");
    try {
      if (pending.candidateKind === "closed-ai") {
        if (
          !pending.candidateId
          || !pending.modelId
          || !pending.modelDigest
          || !pending.contentDigest
          || pending.actualExecutor === "not_executed"
        ) {
          throw Object.assign(
            new Error("真實 AI 候選缺少模型或執行證明，不能核准。"),
            { code: "STUDIO_CLOSED_AI_CANDIDATE_PROOF_MISSING" },
          );
        }
        let canonicalResult: StudioCanonicalApplyResult | null = null;
        const approved = await approveStudioClosedAgentCandidate({
          candidateId: pending.candidateId,
          canonicalCommit: async ({ candidate, idempotencyKey }) => {
            if (
              candidate.taskId !== pending.taskId
              || candidate.contentDigest !== pending.contentDigest
              || candidate.modelId !== pending.modelId
              || candidate.modelDigest !== pending.modelDigest
              || candidate.sourceChapterId !== pending.sourceChapterId
              || candidate.sourceRevision !== pending.sourceRevision
            ) {
              throw Object.assign(
                new Error("候選身分與畫面內容不一致，核准已停止。"),
                { code: "STUDIO_CANDIDATE_IDENTITY_MISMATCH" },
              );
            }
            canonicalResult = await commitStudioCandidateToChapter({
              repository: repositoryRef.current!,
              projectId: project.id,
              chapterId: pending.sourceChapterId!,
              sourceRevision: pending.sourceRevision!,
              taskId: pending.taskId!,
              idempotencyKey,
              content,
              mode: candidateApplyMode(pending.task),
            });
            return {
              commitId: canonicalResult.commitId,
            };
          },
        });
        if (!canonicalResult || approved.canonicalMutationCount !== 1) {
          throw Object.assign(
            new Error("候選核准沒有產生正式章節交易。"),
            { code: "STUDIO_CANONICAL_COMMIT_MISSING" },
          );
        }
        committed = canonicalResult;
      } else {
        if (pending.candidateKind === "external-ai" && (
          !pending.modelId
          || !pending.contentDigest
          || !pending.actualExecutor?.startsWith("external-api:")
          || pending.dataLeftDevice !== true
        )) {
          throw Object.assign(new Error("外接 AI 候選缺少執行來源或內容證明，不能核准。"), { code: "STUDIO_EXTERNAL_AI_CANDIDATE_PROOF_MISSING" });
        }
        committed = await applyWritingAidTransaction({
          repository: repositoryRef.current!,
          projectId: project.id,
          chapterId: pending.sourceChapterId,
          sourceRevision: pending.sourceRevision,
          taskId: pending.taskId,
          content,
          mode: candidateApplyMode(pending.task),
        });
      }
    } catch (error) {
      console.error("STUDIO_CANDIDATE_APPROVAL_FAILED", error);
      alert(error instanceof Error ? error.message : "候選核准失敗，內容仍保留供你重試。");
      setAssistantBusy(null);
      return;
    }

    setState((value) => {
      const projects = value.projects.map((item) =>
        item.id === project.id
          ? {
              ...item,
              chapterTitle: committed.chapter.title,
              draft: committed.chapter.content,
              updatedAt: committed.chapter.updatedAt,
              versions: [old, ...item.versions],
            }
          : item,
      );
      return {
        ...value,
        candidate: null,
        projects,
      };
    });
    setLastRejectedCandidate(null);
    setRegenerationError("");
    setAssistantBusy(null);

    if (state.autoBackup === "accepted_content") {
      void createProjectBackup(
        repositoryRef.current!,
        project.id,
        "full",
        release,
      ).then((formal) => {
        setState((value) => {
          const savedProject =
            value.projects.find((item) => item.id === project.id) ?? project;
          const record = {
            ...makeBackupRecord(savedProject, "full", value),
            backupId: formal.backup.id,
            bytes: formal.backup.byteSize,
            createdAt: formal.backup.createdAt,
            formalPayload: formal.payload,
          };
          return { ...value, backups: [record, ...value.backups] };
        });
      }).catch((error) => console.error("ACCEPTED_CONTENT_AUTO_BACKUP_FAILED", error));
    }
  }
  async function discardCandidate() {
    const pending = state.candidate;
    if (!pending) return;
    if (
      pending.candidateKind === "closed-ai"
      && pending.candidateId
    ) {
      try {
        await rejectStudioClosedAgentCandidate(pending.candidateId);
      } catch (error) {
        console.error("STUDIO_CANDIDATE_REJECTION_FAILED", error);
        return;
      }
    }
    if (
      (pending.candidateKind === "closed-ai" || pending.candidateKind === "external-ai")
      && pending.task !== "branch_choice"
    ) {
      setLastRejectedCandidate(pending);
      setRegenerationError("");
    }
    update({ candidate: null });
  }
  function acceptWizardSuggestion(content: string) {
    if (!ensureCanonicalWritable("採用創作建議")) return;
    const task = state.candidate?.task;
    const target: OptionalKey =
      task === "protagonist_recommendation"
        ? "protagonist"
        : task === "world_recommendation"
          ? "world"
          : task === "conflict_recommendation"
            ? "conflict"
            : task === "plan_chapter"
              ? "outline"
              : "storySeed";
    updateWizard({
      optionalFields: {
        ...state.wizard.optionalFields,
        [target]: setOptional(
          content,
          "ai_accepted",
          state.candidate?.model === "local-rule" ? "local-rule" : "ollama",
        ),
      },
    });
    update({ candidate: null });
  }
  function choices(): Choice[] {
    const fields = project?.optionalFields ?? state.wizard.optionalFields,
      name = optionalValue(fields, "protagonist") || "主角",
      conflict = optionalValue(fields, "conflict") || "目前問題";
    return [
      {
        key: "A",
        text: `${name}主動面對${conflict}，迫使局勢改變。`,
        impact: "主線推進較快",
      },
      {
        key: "B",
        text: `${name}先確認線索，再決定是否公開行動。`,
        impact: "風險較低",
      },
      {
        key: "C",
        text: `${name}借第三方製造轉折，引出新的代價。`,
        impact: "人物關係可能改變",
      },
    ];
  }
  async function generateChoiceResult(
    choiceText: string,
    signal?: AbortSignal,
    regenerationSource?: NonNullable<Candidate>,
    onProgress?: (event: ClosedAIProgressEvent) => void,
  ) {
    if (!ensureCanonicalWritable("建立互動候選")) return;
    if (!project) return;
    const fields = project.optionalFields,
      name = optionalValue(fields, "protagonist"),
      conflict = optionalValue(fields, "conflict"),
      world = optionalValue(fields, "world"),
      hasStory = Boolean(
        project.draft.trim() || name || conflict || project.coreIdea.value,
      );
    if (!hasStory) {
      if (!signal?.aborted) {
        setAiModeMessage("故事資料還不夠：請先建立主角、核心想法，或寫一小段開場；系統沒有建立固定規則選項。");
        setState((value) => ({ ...value, candidate: null }));
      }
      return;
    }
    const protagonist = name || "主角",
      scene = world || "目前場景",
      activeConflict = conflict || "尚未解決的問題";
    const externalSelected = aiExecutionMode === "external-only" || (aiExecutionMode === "hybrid" && studioAiSource === "external");
    if (externalSelected && !externalRunConsent) {
      setAiModeMessage("外接 AI 需要本次單次同意；請先勾選頁面上方的同意框。");
      return;
    }
    const expectedCandidateKind = externalSelected ? "external-ai" : "closed-ai";
    if (regenerationSource && regenerationSource.candidateKind !== expectedCandidateKind) {
      setRegenerationError("只有具備真實模型證明的故事候選才能換一個版本。");
      return;
    }
    if (
      regenerationSource?.candidateId
      && state.candidate?.candidateId === regenerationSource.candidateId
    ) {
      if (regenerationSource.candidateKind === "closed-ai") {
        try {
          await rejectStudioClosedAgentCandidate(regenerationSource.candidateId);
          update({ candidate: null });
        } catch (error) {
          console.error("STUDIO_CHOICE_REGENERATION_SOURCE_REJECTION_FAILED", error);
          setRegenerationError("原故事候選尚未安全放棄，系統沒有開始重新生成。");
          return;
        }
      } else {
        update({ candidate: null });
      }
    }
    setRegenerationError("");
    let content = "",
      source = "",
      model = "",
      providerId = "",
      candidateIdentity: Partial<NonNullable<Candidate>> = {};
    try {
      const canonical = await ensureStudioCanonicalProject(
        repositoryRef.current!,
        projectSeed(project),
      );
      const taskInput = {
        projectId: project.id,
        task: "branch_choice",
        input: JSON.stringify({
          instruction:
            "請使用繁體中文，根據作品資料與作者選擇，直接產生一到三段精煉、具體、可接續的即時後果。用行動、反應與新問題推進，不得重述前情、輸出工程說明或英文模板。",
          selectedAction: choiceText,
          protagonist,
          conflict: activeConflict,
          scene,
          worldRule: optionalValue(fields, "worldRule") || null,
          recentText: project.draft.slice(-700),
          branchNumber:
            state.branches.filter((branch) => branch.projectId === project.id)
              .length + 1,
        }),
        targetLength: 260,
        sourceChapterId: canonical.chapter.id,
        sourceRevision: canonical.chapter.revision,
        qualityMode: "fast" as const,
        browserComputePolicy: closedComputePolicy,
        generationOptions: {
          maxTokens: 144,
          temperature: 0.68,
          topP: 0.9,
          repetitionPenalty: 1.1,
        },
        signal,
        onProgress,
      };
      if (externalSelected) {
        setExternalRunConsent(false);
        const externalPrompt = [
          taskInput.input,
          regenerationSource ? `請產生真正不同的後續版本，不得重用以下內容：\n${regenerationSource.content}` : "",
          regenerationSource ? `重新生成識別：${crypto.randomUUID()}` : "",
        ].filter(Boolean).join("\n\n");
        const generated = await generateExternalAIStream({
          executionMode: aiExecutionMode,
          providerId: externalConnectorId,
          externalConsent: true,
          prompt: externalPrompt,
          maxOutputTokens: 384,
        }, { signal });
        const contentDigest = await sha256Hex(generated.text);
        if (regenerationSource?.contentDigest === contentDigest) {
          throw Object.assign(new Error("外接 AI 重新產生了完全相同的內容。"), { code: "REGENERATION_NOT_DISTINCT" });
        }
        content = generated.text;
        source = `${externalConnectorId} 外接 AI 劇情發展`;
        model = generated.modelId;
        providerId = externalConnectorId;
        candidateIdentity = {
          candidateId: `external:${generated.requestId}`,
          taskId: `external-choice:${crypto.randomUUID()}`,
          provider: externalConnectorId,
          modelId: generated.modelId,
          modelDigest: null,
          contextDigest: await sha256Hex(externalPrompt),
          contentDigest,
          actualExecutor: `external-api:${externalConnectorId}`,
          generatedTokenEvents: generated.generatedTokenEvents,
          dataLeftDevice: true,
          canonicalMutationCount: 0,
          sourceChapterId: canonical.chapter.id,
          sourceRevision: canonical.chapter.revision,
          candidateKind: "external-ai",
          regenerationAttempt: regenerationSource ? (regenerationSource.regenerationAttempt || 0) + 1 : undefined,
          newCandidate: Boolean(regenerationSource),
          previousContentReused: false,
          cacheBypassed: Boolean(regenerationSource),
        };
        setAssistantStatus("external_ready");
        setAiModeMessage("外接 AI 已完成互動故事候選；接受前 Canon 與 RPG 數值都沒有變更。");
      } else {
        const result = regenerationSource
          ? await regenerateStudioClosedAI(taskInput, {
            taskId: regenerationSource.taskId,
            candidateId: regenerationSource.candidateId,
            content: regenerationSource.content,
            contentDigest: regenerationSource.contentDigest,
            regenerationAttempt: regenerationSource.regenerationAttempt,
          })
          : await runStudioClosedAI(taskInput);
        if (!hasVerifiedExecutedStoryOutput(result)) {
          throw Object.assign(
            new Error("閉端 AI 回傳內容缺少可驗證的實際執行證明。"),
            { code: "CLOSED_AI_EXECUTION_PROOF_MISSING" },
          );
        }
        content = result.content;
        source = result.provider === "local-ollama" ? "本機 AI 劇情發展" : "瀏覽器閉端 AI";
        model = result.model;
        providerId = result.provider === "local-ollama" ? "ollama" : result.provider;
        const distinctness = ("distinctness" in result
          ? result.distinctness
          : null) as null | { similarityMetric: string; similarityScore: number };
        candidateIdentity = {
          candidateId: result.candidateId,
          taskId: result.taskId,
          provider: result.provider,
          modelId: result.model,
          modelDigest: result.modelDigest,
          contextDigest: result.contextDigest,
          contentDigest: result.contentDigest,
          actualExecutor: result.actualExecutor,
          generatedTokenEvents: result.executionReceipt?.generatedTokenEvents ?? 0,
          dataLeftDevice: result.dataLeftDevice,
          canonicalMutationCount: result.canonicalMutationCount,
          sourceChapterId: result.sourceChapterId,
          sourceRevision: result.sourceRevision,
          candidateKind: "closed-ai",
          regenerationAttempt: result.regeneration?.regenerationAttempt ?? undefined,
          newCandidate: result.regeneration?.newCandidate ?? undefined,
          previousContentReused: result.regeneration?.previousContentReused ?? undefined,
          cacheBypassed: result.regeneration?.cacheBypassed ?? undefined,
          similarityMetric: distinctness?.similarityMetric,
          similarityScore: distinctness?.similarityScore,
          diagnostic: isUsableChineseStoryOutput(result.content)
            ? undefined
            : "本機模型已完成推理，但這份候選偏短；你可以重新生成或直接編輯。",
        };
      }
    } catch (error) {
      if (signal?.aborted) {
        setAiModeMessage("已取消互動故事生成；沒有建立候選，也沒有修改 Canon 或 RPG 數值。");
        return;
      }
      if (regenerationSource) {
        const code = String((error as { code?: string })?.code || "MODEL_NOT_READY");
        console.error("STUDIO_CHOICE_EXPLICIT_REGENERATION_FAILED", { code });
        setRegenerationError(
          code === "REGENERATION_NOT_DISTINCT"
            ? `${externalSelected ? "外接" : "閉端"}模型連續產生相同內容，請調整要求或改用其他模型。`
            : `${externalSelected ? "外接" : "閉端"}模型沒有完成不同版本；正式故事沒有變更。`,
        );
        return;
      }
      const code = String((error as { code?: string })?.code || "MODEL_NOT_READY");
      if (externalSelected) {
        setAiModeMessage(`${error instanceof Error ? error.message : "外接 AI 沒有完成互動故事。"}（${code}）系統沒有回退到閉端或規則模板。`);
        return;
      }
      console.error("STUDIO_CHOICE_CLOSED_AI_FAILED", { code });
      setAiModeMessage(`真實閉端模型未完成這次推理（${code}）。沒有建立規則替代品，也沒有修改 Canon 或 RPG 數值。`);
      setState((value) => ({ ...value, candidate: null }));
      return;
    }
    if (signal?.aborted) return;
    const deltaByChoice: Record<string, number> = { A: 3, B: 2, C: -2 },
      suggestedDelta = deltaByChoice[selectedChoice] ?? 1,
      currentStats = state.gameStates[project.id]?.stats || {},
      statId =
        project.enabledStats.find(
          (id) =>
            suggestedDelta < 0 ||
            !["stamina", "questProgress", "affection"].includes(id) ||
            (currentStats[id] ?? 0) < 100,
        ) || project.enabledStats[0],
      labels: Record<string, string> = {
        stamina: "體力",
        money: "金錢",
        affection: "好感度",
        reputation: "聲望",
        experience: "經驗值",
        level: "等級",
        turns: "回合",
        questProgress: "任務進度",
      },
      before = statId ? (currentStats[statId] ?? 0) : 0,
      after = statId
        ? normalizeStatValue(statId, before + suggestedDelta)
        : before,
      delta = after - before,
      statChanges: StatChange[] = statId
        ? [
            {
              stat: statId,
              label: labels[statId] || statId,
              before,
              delta,
              after,
              reason: `因為你選擇「${choiceText}」，故事中的行動方式產生了對應影響。`,
            },
          ]
        : [],
      optionKey = (["A", "B", "C"].includes(selectedChoice) ? selectedChoice : "custom") as "A" | "B" | "C" | "custom",
      effect = {
        statChanges: Object.fromEntries(statChanges.map((change) => [change.stat, change.delta])),
        relationshipChanges: {}, resourceChanges: {}, moneyChange: 0, worldFlags: {}, questProgress: {}, achievementProgress: {}, timelineEvents: [choiceText],
      };
    let canonicalCandidateId: string;
    try {
      const saved = await persistStudioChoiceCandidate(repositoryRef.current!, projectSeed(project), {
        optionKey,
        text: choiceText,
        consequence: statChanges.map((change) => change.reason).join("；"),
        effect,
        providerId,
        modelId: model,
        externalRequest: externalSelected,
        dataLeftDevice: externalSelected,
      });
      canonicalCandidateId = saved.candidate.id;
    } catch (error) {
      console.error("CHOICE_CANDIDATE_PERSIST_FAILED", error);
      setState((value) => ({ ...value, candidate: { task: "branch_choice", title: "故事推進未保存", content: "故事推進沒有成功，請再試一次。", source: "本機故事系統", model: "none", usedLocalMemory: false, externalRequest: false, choiceText, impacts: [], statChanges: [], createdAt: new Date().toISOString() } }));
      return;
    }
    setState((value) => ({
      ...value,
      candidate: {
        ...candidateIdentity,
        projectId: project.id,
        canonicalCandidateId,
        task: "branch_choice",
        title: "故事發展",
        content,
        source,
        model,
        usedLocalMemory: true,
        externalRequest: externalSelected,
        choiceText,
        impacts: [
          "故事方向：目前衝突進入下一個階段",
          "角色關係：相關人物會依這次決定重新評估主角",
          "線索變化：新的反應可能成為後續線索",
        ],
        statChanges,
        createdAt: new Date().toISOString(),
      },
    }));
  }
  async function acceptChoiceResult(content: string) {
    if (!ensureCanonicalWritable("核准互動選擇")) return;
    if (!project || !state.candidate?.choiceText || !state.candidate.canonicalCandidateId) return;
    const candidate = state.candidate,
      currentGame = state.gameStates[project.id] || emptyGameState(),
      old = { at: new Date().toISOString(), title: project.chapterTitle, content: project.draft };
    if (candidate.candidateKind === "external-ai" && (
      !candidate.modelId
      || !candidate.contentDigest
      || !candidate.actualExecutor?.startsWith("external-api:")
      || candidate.dataLeftDevice !== true
      || candidate.canonicalMutationCount !== 0
    )) {
      alert("外接 AI 故事候選缺少完整執行證明，正式作品與 RPG 數值都沒有變更。");
      return;
    }
    try {
      const result = await acceptStudioChoice(repositoryRef.current!, candidate.canonicalCandidateId!, content, candidate.choiceText),
        branchAt = result.acceptedChoice.acceptedAt,
        eventId = result.acceptedChoice.effectOperationId;
      setState((value) => {
        const nextGameState: GameState = {
            ...currentGame,
            stats: { ...result.storyState.protagonistStats },
            history: [
              ...(candidate.statChanges || []).map((change) => ({ ...change, projectId: project.id, branchAt, event: candidate.choiceText || "故事選擇", eventId, sourceType: "player_choice" as const, chapterTitle: project.chapterTitle, versionAt: old.at, createdAt: branchAt })),
              ...currentGame.history,
            ],
          },
          projects = value.projects.map((item) => item.id === project.id ? { ...item, draft: result.chapter.content, updatedAt: result.chapter.updatedAt, versions: [old, ...item.versions] } : item);
        return {
          ...value,
          candidate: null,
          projects,
          gameStates: { ...value.gameStates, [project.id]: nextGameState },
          branches: [...value.branches, { branchId: result.branch.id, acceptedChoiceId: result.acceptedChoice.id, reversible: false, projectId: project.id, choice: candidate.choiceText || "", gameState: currentGame, draft: project.draft, versionsLength: project.versions.length, at: branchAt }],
        };
      });
      if (state.autoBackup === "accepted_content") await createProjectBackup(repositoryRef.current!, project.id, "full", release);
    } catch (error) {
      console.error("ACCEPT_CHOICE_TRANSACTION_FAILED", error);
      alert("故事選擇尚未保存，正式作品沒有變更，請重新整理後再試一次。");
    }
  }
  function undoBranch() {
    if (!ensureCanonicalWritable("回復故事分支")) return;
    if (!project) return;
    const index = state.branches
      .map((branch) => branch.projectId === project.id && branch.reversible ? project.id : "")
      .lastIndexOf(project.id);
    if (index < 0) return;
    const last = state.branches[index];
    setState((value) => ({
      ...value,
      branches: value.branches.filter(
        (_, branchIndex) => branchIndex !== index,
      ),
      gameStates: {
        ...value.gameStates,
        [project.id]: last.gameState,
      },
      candidate: null,
      projects: value.projects.map((item) =>
        item.id === project.id
          ? {
              ...item,
              draft: last.draft,
              versions: item.versions.slice(
                Math.max(0, item.versions.length - last.versionsLength),
              ),
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    }));
  }
  async function importLegacyProjectsExplicitly() {
    if (legacyMigrationBusy) return;
    if (!canonicalRuntimeGate.localCanonicalWritable) {
      setLegacyMigrationStatus(
        "IndexedDB 正式作品庫目前不可寫入；舊版來源未變更，請先恢復本機作品庫。",
      );
      return;
    }
    setLegacyMigrationBusy(true);
    setLegacyMigrationStatus("正在以非覆蓋方式匯入舊版作品……");
    try {
      const migration = await migrateLegacyStudioProjects(
        repositoryRef.current!,
        {
          sourceKeys: EXPLICIT_LEGACY_STUDIO_KEYS,
          overwriteExisting: false,
        },
      );
      const hydrated = await hydrateCanonicalStudio(
        repositoryRef.current!,
        state,
      );
      setState(hydrated);
      setLegacyMigrationPreview(
        previewLegacyStudioProjects(EXPLICIT_LEGACY_STUDIO_KEYS),
      );
      setLegacyMigrationStatus(
        `已匯入 ${migration.migrated} 部舊版作品；${migration.skippedExisting} 部同名正式作品保持不變，舊版來源仍完整保留。`,
      );
    } catch (error) {
      setLegacyMigrationStatus(
        `舊版作品尚未匯入：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLegacyMigrationBusy(false);
    }
  }
  const showLegacyMigration = !legacyMigrationDismissed && Boolean(
    legacyMigrationPreview?.pending || legacyMigrationStatus,
  );
  const studioReturnTo = `/studio?screen=${encodeURIComponent(screen)}${
    project?.id ? `&projectId=${encodeURIComponent(project.id)}` : ""
  }`;
  const localAISetupHref = `/settings/local-ai?returnTo=${encodeURIComponent(studioReturnTo)}`;
  const navItems: Array<[Screen, string]> = [
    ["home", "首頁"],
    ["create", "開始創作"],
    ["write", "繼續寫作"],
    ["world", "角色與世界"],
    ["dashboard", "任務與成就"],
    ["backup", "存檔與備份"],
    ["library", "我的作品"],
    ["inspect", "檢查作品"],
    ["choice", "互動故事／RPG"],
  ];
  return (
    <div
      className="studioShell"
      data-testid="modern-studio"
      data-consumer-release={release.consumerRelease}
      data-app-commit={release.appCommit}
      data-story-library={STORY_LIBRARY.schemaVersion}
      data-canonical-hydration-succeeded={
        canonicalRuntimeGate.canonicalHydrationSucceeded
      }
      data-local-canonical-writable={
        canonicalRuntimeGate.localCanonicalWritable
      }
      data-legacy-snapshot-preserved={
        canonicalRuntimeGate.legacySnapshotPreserved
      }
    >
      {showLegacyMigration ? (
        <section
          className="studioLegacyMigration"
          data-testid="studio-legacy-migration"
          data-pending={legacyMigrationPreview?.pending ?? false}
          role="status"
        >
          <div>
            <strong>
              {legacyMigrationStatus || "發現舊版作品"}
            </strong>
            <span>
              {legacyMigrationStatus
                || `找到 ${legacyMigrationPreview?.projectCount ?? 0} 部作品。匯入前可先預覽，系統不會覆蓋同 ID 的新版正式作品。`}
            </span>
            {legacyMigrationDetails && legacyMigrationPreview?.titles.length ? (
              <ul>
                {legacyMigrationPreview.titles.map((title) => (
                  <li key={title}>{title}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            {legacyMigrationPreview?.pending ? (
              <>
                <button
                  type="button"
                  onClick={() => setLegacyMigrationDetails((value) => !value)}
                >
                  {legacyMigrationDetails ? "收起遷移預覽" : "查看遷移預覽"}
                </button>
                <button
                  type="button"
                  disabled={legacyMigrationBusy}
                  onClick={() => void importLegacyProjectsExplicitly()}
                >
                  {legacyMigrationBusy ? "匯入中……" : "匯入到新版作品庫"}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => setLegacyMigrationDismissed(true)}
            >
              暫不匯入
            </button>
            <a href="/legacy/novel-system.html">繼續使用舊版</a>
          </div>
        </section>
      ) : null}
      {(storageFailure || (
        persistenceMode === "CLOUD_DEGRADED" && !cloudNoticeDismissed
      )) ? (
        <section
          className="studioPersistenceBanner"
          data-blocked={Boolean(storageFailure)}
          data-testid="studio-persistence-banner"
          role={storageFailure ? "alert" : "status"}
        >
          <strong>
            {storageFailure
              ? "本機正式作品庫需要恢復"
              : "雲端同步暫時不可用，本機創作仍可使用"}
          </strong>
          <span>
            {storageFailure?.message
              ?? (cloudPersistenceIssue?.errorCategory === "migration"
                ? "Supabase 雲端同步尚未完成；新變更會保留在 IndexedDB Outbox，修復後自動核對版本與雜湊。"
                : "Supabase 權威目前無法驗證；新變更標為 PendingSync，本機寫作、閉端 AI、核准與匯出仍可使用。")}
          </span>
          <small>
            模式：{persistenceMode ?? "檢查中"}
            {storageFailure ? ` · ${storageFailure.code}` : ""}
          </small>
          {storageFailure ? (
            <>
              {migrationRecoverySnapshot ? (
                <button
                  type="button"
                  data-testid="download-migration-recovery-snapshot"
                  onClick={() =>
                    downloadRecoverySnapshot(migrationRecoverySnapshot)}
                >
                  匯出唯讀復原快照
                </button>
              ) : null}
              <button type="button" onClick={() => location.reload()}>
                重新檢查 IndexedDB
              </button>
            </>
          ) : (
            <div className="studioPersistenceActions">
              <Link href="/studio/settings/storage">查看雲端設定</Link>
              <button
                type="button"
                data-testid="dismiss-cloud-degraded-notice"
                onClick={dismissCloudNotice}
              >
                關閉本次提示
              </button>
            </div>
          )}
        </section>
      ) : null}
      <button
        className="studioMenuButton"
        onClick={() => setMenuOpen(true)}
        aria-label="開啟導覽選單"
      >
        ☰
      </button>
      <aside className={`studioRail ${menuOpen ? "open" : ""}`}>
        <Link className="studioBrand" href="/">
          <b>諸天萬界</b>
          <span>小說生成系統</span>
        </Link>
        {canonicalRuntimeGate.localCanonicalWritable ? (
          <Link className="studioCreate" href="/studio/create">
            ＋ 建立新作品
          </Link>
        ) : (
          <span className="studioCreate" aria-disabled="true">
            ＋ 建立新作品（唯讀）
          </span>
        )}
        <nav>
          {navItems.map(([id, label]) => (
            <button
              key={id}
              className={screen === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <Link className="studioLocalAI" href={localAISetupHref}>
          設定本機 AI
        </Link>
        <a className="studioProfessional" href="/professional">
          專業工具
        </a>
      </aside>
      {menuOpen && (
        <button
          className="studioScrim"
          aria-label="關閉導覽選單"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="studioMain">
        <header className="studioTop">
          <Link href="/">諸天萬界小說生成系統</Link>
          <nav>
            <button onClick={() => navigate("home")}>首頁</button>
            <button onClick={() => navigate("create")}>創作</button>
            <button onClick={() => navigate("write")}>閉端創作助手</button>
            <button onClick={() => navigate("choice")}>互動故事／RPG</button>
          </nav>
          <span>
            {assistantStatus === "ollama_ready"
              ? "真實本機 AI 已連線"
              : assistantStatus === "external_ready"
                ? `${externalConnectorId} 外接 AI 已就緒`
              : assistantStatus === "runtime_ready"
                ? "瀏覽器輕量 AI 可用"
                : assistantStatus === "auth_required"
                  ? "本機 AI 等待授權"
                  : "真實 AI 尚未連線"}
          </span>
        </header>
        <section className="studioAiModeBar" data-testid="studio-ai-mode" data-mode={aiExecutionMode}>
          <label>AI 模式
            <select value={aiExecutionMode} onChange={(event) => {
              const mode = event.target.value as NovelAIExecutionMode;
              setAiExecutionMode(mode);
              setStudioAiSource(mode === "external-only" ? "external" : "closed");
              setExternalRunConsent(false);
              persistStudioAISettings({ mode });
            }}>
              <option value="closed-only">全部閉端</option>
              <option value="hybrid">閉端＋外接共用</option>
              <option value="external-only">全部外接</option>
            </select>
          </label>
          {aiExecutionMode === "hybrid" && <label>本次來源
            <select value={studioAiSource} onChange={(event) => { setStudioAiSource(event.target.value as "closed" | "external"); setExternalRunConsent(false); }}>
              <option value="closed">閉端 AI</option>
              <option value="external">外接 AI</option>
            </select>
          </label>}
          {(aiExecutionMode === "closed-only"
            || (aiExecutionMode === "hybrid" && studioAiSource === "closed")) && (
            <label>閉端引擎
              <select
                data-testid="studio-closed-compute-policy"
                value={closedComputePolicy}
                onChange={(event) => {
                  const policy = normalizeStudioClosedComputePolicy(
                    event.target.value,
                  );
                  setClosedComputePolicy(policy);
                  persistStudioAISettings({ closedComputePolicy: policy });
                  setAiModeMessage(
                    policy === "quality-first"
                      ? "已明確選擇本機 Ollama；後續閉端任務會使用已配對且驗證通過的本機模型。"
                      : "已選擇 Browser AI 優先；瀏覽器模型無法完成時不會暗中轉交。",
                  );
                }}
              >
                <option value="browser-first">Browser AI 優先</option>
                <option value="quality-first">本機 Ollama 優先</option>
              </select>
            </label>
          )}
          {(aiExecutionMode === "external-only" || (aiExecutionMode === "hybrid" && studioAiSource === "external")) && <>
            <label>外接模型
              <select value={externalConnectorId} onChange={(event) => {
                const providerId = event.target.value as ExternalAIConnectorId;
                setExternalConnectorId(providerId);
                setExternalRunConsent(false);
                persistStudioAISettings({ providerId });
              }}>
                <option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="grok">Grok</option><option value="claude">Claude</option>
              </select>
            </label>
            <label className="studioExternalApproval"><input type="checkbox" checked={externalRunConsent} onChange={(event) => setExternalRunConsent(event.target.checked)} /><span>同意下一次工作把內容傳給所選外接 AI（只用一次）</span></label>
          </>}
          <Link href="/studio/settings/ai">完整 AI 設定</Link>
          {aiModeMessage && <p role="status">{aiModeMessage}</p>}
        </section>
        <main className="studioContent">
          {screen === "home" && (
            <HomeScreen
              project={project}
              navigate={navigate}
              taskHandoff={taskHandoff}
              continueTaskHandoff={continueTaskHandoff}
              dismissTaskHandoff={dismissTaskHandoff}
            />
          )}{" "}
          {screen === "create" && (
            <fieldset
              className="studioWriteGate"
              data-testid="studio-write-gate"
              data-writable={canonicalRuntimeGate.localCanonicalWritable}
              disabled={!canonicalRuntimeGate.localCanonicalWritable}
            >
              <CreateScreen
                state={state}
                updateWizard={updateWizard}
                setOptionalField={setOptionalField}
                setStep={(step) => update({ wizardStep: step })}
                createProject={createProject}
                runTask={runTask}
                candidate={state.candidate}
                acceptSuggestion={acceptWizardSuggestion}
                discard={() => void discardCandidate()}
              />
            </fieldset>
          )}{" "}
          {(screen === "write" || screen === "inspect") && (
            <fieldset
              className="studioWriteGate"
              data-testid="studio-write-gate"
              data-writable={canonicalRuntimeGate.localCanonicalWritable}
              disabled={!canonicalRuntimeGate.localCanonicalWritable}
            >
              <WriteScreen
                key={project?.id || "empty"}
                project={project}
                candidate={
                  state.candidate?.task === "branch_choice"
                    ? null
                    : state.candidate
                }
                navigate={navigate}
                requestTaskHref={requestTaskHref}
                registerSaveHandler={(handler) => { writerSaveRef.current = handler; }}
                saveDraft={saveDraft}
                activateChapter={activateStudioChapter}
                createChapter={createStudioChapter}
                deleteChapter={deleteStudioChapter}
                runTask={runTask}
                completeChapter={completeChapter}
                acceptCandidate={acceptCandidate}
                discard={() => void discardCandidate()}
                assistantStatus={assistantStatus}
                assistantBusy={assistantBusy}
                assistantStreamText={assistantStreamText}
                assistantStreamEvents={assistantStreamEvents}
                assistantProgress={assistantProgress}
                assistantFailure={assistantFailure}
                stopAssistantTask={stopAssistantTask}
                lastRejectedCandidate={
                  lastRejectedCandidate?.projectId === project?.id
                    ? lastRejectedCandidate
                    : null
                }
                regenerationError={
                  lastRejectedCandidate?.projectId === project?.id
                    ? regenerationError
                    : ""
                }
              />
            </fieldset>
          )}{" "}
          {screen === "world" && (
            <fieldset
              className="studioWriteGate"
              data-testid="studio-write-gate"
              data-writable={canonicalRuntimeGate.localCanonicalWritable}
              disabled={!canonicalRuntimeGate.localCanonicalWritable}
            >
              <WorldScreen
                project={project}
                updateProject={updateProjectOptional}
                runTask={runTask}
              />
            </fieldset>
          )}{" "}
          {screen === "choice" && (
            <fieldset
              className="studioWriteGate"
              data-testid="studio-write-gate"
              data-writable={canonicalRuntimeGate.localCanonicalWritable}
              disabled={!canonicalRuntimeGate.localCanonicalWritable}
            >
              <ChoiceScreen
                project={project}
                choices={choices()}
                selected={selectedChoice}
                setSelected={setSelectedChoice}
                custom={customChoice}
                setCustom={setCustomChoice}
                generateChoice={(choiceText, signal, onProgress) =>
                  generateChoiceResult(
                    choiceText,
                    signal,
                    undefined,
                    onProgress,
                  )
                }
                result={
                  state.candidate?.task === "branch_choice"
                    ? state.candidate
                    : null
                }
                accept={acceptChoiceResult}
                discard={() => void discardCandidate()}
                undo={undoBranch}
                canUndo={state.branches.some(
                  (branch) => branch.projectId === project?.id && branch.reversible,
                )}
                regenerate={(signal, onProgress) =>
                  generateChoiceResult(
                    state.candidate?.choiceText ||
                      customChoice ||
                      choices().find((choice) => choice.key === selectedChoice)
                      ?.text ||
                      "",
                    signal,
                    state.candidate?.task === "branch_choice"
                      ? state.candidate
                      : undefined,
                    onProgress,
                  )
                }
                regenerationError={regenerationError}
                stats={project ? state.gameStates[project.id]?.stats || {} : {}}
                history={
                  project ? state.gameStates[project.id]?.history || [] : []
                }
              />
            </fieldset>
          )}{" "}
          {screen === "dashboard" && (
            <StoryDashboard
              project={project}
              gameState={project ? state.gameStates[project.id] || emptyGameState() : null}
              navigate={navigate}
            />
          )}{" "}
          {screen === "backup" && (
            <BackupCenter
              project={project}
              backups={state.backups.filter((backup) => backup.snapshot.project.id === project?.id)}
              autoBackup={state.autoBackup}
              createBackup={createBackup}
              importBackup={importBackup}
              restoreBackup={restoreBackup}
              deleteBackup={deleteBackup}
              setAutoBackup={(autoBackup) => update({ autoBackup })}
              writable={canonicalRuntimeGate.localCanonicalWritable}
            />
          )}{" "}
          {screen === "library" && (
            <LibraryScreen
              projects={state.projects}
              open={(id) => {
                update({ activeProjectId: id });
                navigate("write");
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function HomeScreen({
  project,
  navigate,
  taskHandoff,
  continueTaskHandoff,
  dismissTaskHandoff,
}: {
  project: Project | null;
  navigate: (screen: Screen) => void;
  taskHandoff: StudioTaskHandoff | null;
  continueTaskHandoff: () => void;
  dismissTaskHandoff: () => void;
}) {
  const projectWordCount = project ? words(project.draft) : 0;
  const projectVersionCount = project?.versions.length ?? 0;
  return (
    <section className="studioHome">
      {taskHandoff ? (
        <section className="studioTaskHandoff" data-testid="studio-task-handoff" role="status">
          <span className="studioTaskHandoffSeal" aria-hidden="true">✓</span>
          <div>
            <small>目前工作已安全儲存</small>
            <h2>已從「{taskHandoff.sourceLabel}」回到首頁</h2>
            <p>
              {taskHandoff.chapterTitle ? `「${taskHandoff.chapterTitle}」已按原章節保存。` : "目前資料已保存。"}
              現在可再進入「{taskHandoff.destinationLabel}」，不會把兩個任務或章節混在一起。
            </p>
          </div>
          <div>
            <button type="button" className="gold" data-testid="studio-task-handoff-continue" onClick={continueTaskHandoff}>
              繼續前往{taskHandoff.destinationLabel}
            </button>
            <button type="button" onClick={dismissTaskHandoff}>留在首頁</button>
          </div>
        </section>
      ) : null}
      <section className="studioHomeHero">
        <div className="studioHomeHeroCopy">
          <span className="studioHeroEyebrow">THE TEN THOUSAND WORLDS · STORY FORGE</span>
          <h1>一念開天地，落筆成萬界</h1>
          <p>在同一座創作殿堂裡完成小說、角色、世界、互動分支與 RPG。每一個 AI 候選都先由你核准，才會成為正式故事。</p>
          <div className="studioHeroSignals" aria-label="系統特色">
            <span>本機優先</span>
            <span>章節獨立保存</span>
            <span>Canon 可回溯</span>
          </div>
          <div className="studioHeroActions">
            <Link className="studioHeroPrimary" href="/studio/create">開啟新世界</Link>
            <button type="button" disabled={!project} onClick={() => navigate("write")}>續寫目前篇章</button>
            <button type="button" onClick={() => navigate("library")}>走進我的書庫</button>
          </div>
        </div>
        <aside className="studioRealmObservatory" aria-label="目前世界狀態">
          <div className="studioRealmOrb" aria-hidden="true">
            <i /><i /><i />
            <div><small>STORY REALM</small><b>{project ? "續" : "始"}</b><span>{project?.topicName || "等待命名的世界"}</span></div>
          </div>
          <div className="studioWorldLedger">
            <small>WORLD STATUS · 世界觀測</small>
            <strong>{project?.title || "尚未開啟第一個世界"}</strong>
            <div>
              <span><small>當前篇章</small><b>{project?.chapterTitle || "等待落筆"}</b></span>
              <span><small>正文規模</small><b>{project ? `${projectWordCount} 字` : "—"}</b></span>
              <span><small>版本留痕</small><b>{project ? `${projectVersionCount} 筆` : "—"}</b></span>
            </div>
          </div>
        </aside>
      </section>

      <section className="studioHomePortals" aria-label="快速入口">
        <Link href="/studio/create"><i className="studioPortalGlyph" aria-hidden="true">創</i><small>01 · CREATE</small><b>建立新作品</b><span>由引導精靈陪你完成世界與人物</span></Link>
        <button type="button" disabled={!project} onClick={() => navigate("write")}><i className="studioPortalGlyph" aria-hidden="true">章</i><small>02 · WRITE</small><b>章節寫作</b><span>回到上次游標與六層 AI Cache</span></button>
        <button type="button" disabled={!project} onClick={() => project && window.location.assign(`/studio/project/${encodeURIComponent(project.id)}/rpg`)}><i className="studioPortalGlyph" aria-hidden="true">遊</i><small>03 · PLAY</small><b>互動故事／RPG</b><span>讓選擇真正改變正文、關係與數值</span></button>
        <Link href={project ? `/studio/project/${encodeURIComponent(project.id)}/closed-ai` : "/settings/local-ai"}><i className="studioPortalGlyph" aria-hidden="true">智</i><small>04 · INTELLIGENCE</small><b>閉端 AI 中樞</b><span>查看真實模型、裝置與執行證明</span></Link>
      </section>

      <section className="studioHomeLower">
        <div className="studioLatestWorld">
          <div className="studioHomeSectionTitle"><div><small>YOUR LATEST WORLD</small><h2>最近作品</h2></div><span>{project ? "旅程仍在延續" : "第一個世界正等待你"}</span></div>
          {project ? (
            <article className="studioRecent">
              <div className="studioBookCover" aria-hidden="true">
                <small>{project.topicName || "原創小說"}</small>
                <b>{(project.title || "書").slice(0, 1)}</b>
                <span>諸天萬界典藏</span>
              </div>
              <section>
                <small>{project.topicName || "題材尚未設定"}</small>
                <h3>{project.title}</h3>
                <div className="studioRecentFacts" aria-label="作品進度">
                  <span><small>目前章節</small><b>{project.chapterTitle}</b></span>
                  <span><small>正文字數</small><b>{projectWordCount} 字</b></span>
                  <span><small>版本紀錄</small><b>{projectVersionCount} 筆</b></span>
                  <span><small>最近保存</small><b>{formatTime(project.updatedAt)}</b></span>
                </div>
                <div className="recentActions">
                  <button className="gold" onClick={() => navigate("write")}>繼續創作</button>
                  <Link href={`/studio/read/${project.id}`}>閱讀作品</Link>
                  <button
                    data-testid="studio-open-rpg-dashboard"
                    onClick={() => window.location.assign(`/studio/project/${encodeURIComponent(project.id)}/rpg`)}
                  >
                    開啟完整 RPG 儀表板
                  </button>
                </div>
              </section>
            </article>
          ) : (
            <div className="studioEmpty">
              <b>尚未建立作品</b>
              <p>不用先填完整設定，邊寫邊補也可以。</p>
              <Link className="studioLinkButton" href="/studio/create">建立第一部小說</Link>
            </div>
          )}
        </div>
        <aside className="studioHomeCompass">
          <small>CREATOR&apos;S COMPASS</small>
          <h2>創作羅盤</h2>
          <p>{project ? "從保存的位置繼續，章節、世界與檢查各自清楚分流。" : "先開啟世界，再依序建立人物、篇章與正式故事。"}</p>
          <nav aria-label="創作下一步">
            <Link href="/studio/create"><span>01</span><div><b>建立新世界</b><small>由引導精靈開始</small></div></Link>
            <button type="button" disabled={!project} onClick={() => navigate("write")}><span>02</span><div><b>續寫目前篇章</b><small>{project?.chapterTitle || "建立作品後開放"}</small></div></button>
            <button type="button" disabled={!project} onClick={() => navigate("world")}><span>03</span><div><b>整理角色與世界</b><small>補齊設定與伏筆</small></div></button>
            <button type="button" disabled={!project} onClick={() => navigate("inspect")}><span>04</span><div><b>檢查作品</b><small>確認故事一致性</small></div></button>
          </nav>
        </aside>
      </section>
    </section>
  );
}

function CreateScreen({
  state,
  updateWizard,
  setOptionalField,
  setStep,
  createProject,
  runTask,
  candidate,
  acceptSuggestion,
  discard,
}: {
  state: StudioState;
  updateWizard: (partial: Partial<Wizard>) => void;
  setOptionalField: (
    key: OptionalKey,
    value: string,
    status?: OptionalFieldStatus,
  ) => void;
  setStep: (step: number) => void;
  createProject: () => void;
  runTask: StudioRunTask;
  candidate: Candidate;
  acceptSuggestion: (content: string) => void;
  discard: () => void;
}) {
  const w = state.wizard,
    step = state.wizardStep;
  const adultProfile = w.adultExperienceProfile;
  const updateAdultProfile = (partial: Partial<AdultExperienceProfile>) => updateWizard({
    adultExperienceProfile: normalizeAdultExperienceProfile({ ...adultProfile, ...partial }),
  });
  const gameMode = isStructuredGameMode(w.playModeId);
  const structuredStart = w.creationMethod !== "blank" || gameMode;
  const foundation = creationFoundationChecklist(w);
  const missingFoundation = foundation.filter((item) => item.required && !item.ready);
  const topics = listStoryTopics({
    groupId: w.consumerGroupId || undefined,
    packId: w.packId || undefined,
    includeAdult: w.adultMode,
    ageConfirmed: w.ageConfirmed,
    limit: w.entryMode === "explore" ? 218 : 12,
  });
  const selectedTopic = resolveStoryTopic(w.topicId);
  const optionalInput = (key: OptionalKey) => {
    const required = (key === "protagonist" && structuredStart)
      || (key === "world" && gameMode);
    return (
    <div className="optionalField" key={key}>
      <label>
        {optionalLabels[key]} <small>{required ? "開始前必填" : "可稍後補充"}</small>
        <input
          data-testid={`studio-optional-${key}`}
          value={optionalValue(w.optionalFields, key)}
          onChange={(event) => setOptionalField(key, event.target.value)}
        />
      </label>
      <div>
        <button
          type="button"
          onClick={() => setOptionalField(key, "", "deferred")}
        >
          稍後設定
        </button>
        <button
          type="button"
          onClick={() => setOptionalField(key, "", "not_applicable")}
        >
          不適用
        </button>
      </div>
    </div>
    );
  };
  return (
    <section className="studioWizard" data-testid="studio-create-wizard">
      <header>
        <span>建立新作品</span>
        <h1>
          {
            [
              "",
              "選擇起點",
              "選擇題材",
              "補充人物與世界",
              "選擇玩法",
              "預覽並建立",
            ][step]
          }
        </h1>
        <p>第 {step} 步，共 5 步・自己設定，或讓引導精靈代為完成後再修改</p>
      </header>
      <div className="studioSteps">
        {[1, 2, 3, 4, 5].map((index) => (
          <i className={index <= step ? "done" : ""} key={index} />
        ))}
      </div>
      <div className="studioWizardBody">
        <section className="studioCreationGuide" data-testid="studio-creation-guide">
          <div>
            <small>創作帶領精靈</small>
            <h2>先準備人物與第一幕，再開始寫或玩</h2>
            <p>
              不需要面對一整頁空白。你可以逐項設定，也能先產生一套可修改的本機建議；
              規則建議會清楚標示，不會冒充真實 AI。
            </p>
          </div>
          <ol aria-label="起始設定完成度">
            {foundation.map((item) => (
              <li
                key={item.key}
                data-ready={item.ready}
                data-required={item.required}
              >
                <span aria-hidden="true">{item.ready ? "✓" : item.required ? "!" : "○"}</span>
                <div><b>{item.label}</b><small>{item.detail}</small></div>
              </li>
            ))}
          </ol>
          <div className="studioCreationGuideActions">
            <button
              type="button"
              data-testid="studio-guide-autofill"
              className="gold"
              onClick={() => updateWizard(buildLocalCreationGuide(w))}
            >
              引導精靈代為完成
            </button>
            <button
              type="button"
              disabled={Boolean(candidate)}
              onClick={() => void runTask("improve_settings")}
            >
              請真實模型深化候選
            </button>
          </div>
        </section>
        {step === 1 && (
          <>
            <div className="entryModeTabs">
              {(["quick", "guided", "explore"] as EntryMode[]).map((mode) => (
                <button
                  className={w.entryMode === mode ? "active" : ""}
                  key={mode}
                  onClick={() => updateWizard({ entryMode: mode })}
                >
                  {mode === "quick"
                    ? "快速開始"
                    : mode === "guided"
                      ? "引導建立"
                      : "完整故事庫"}
                </button>
              ))}
            </div>
            <label>
              作品名稱 <small>可空白</small>
              <input
                data-testid="studio-project-title"
                value={w.title}
                onChange={(event) =>
                  updateWizard({ title: event.target.value })
                }
                placeholder="未填時使用「未命名作品」"
              />
            </label>
            <label>
              核心想法 <small>選填</small>
              <textarea
                value={w.coreIdea}
                onChange={(event) =>
                  updateWizard({
                    coreIdea: event.target.value,
                    creationMethod: event.target.value
                      ? "idea"
                      : w.creationMethod,
                  })
                }
                placeholder="只寫一句也可以"
              />
            </label>
            <div className="creationMethods">
              <button
                className={w.creationMethod === "recommend" ? "active" : ""}
                onClick={() => {
                  updateWizard({ creationMethod: "recommend" });
                  void runTask("idea_directions");
                }}
              >
                閉端助手推薦
              </button>
              <button
                className={w.creationMethod === "random" ? "active" : ""}
                onClick={() => {
                  const topic = randomStoryTopic();
                  if (topic)
                    updateWizard({
                      creationMethod: "random",
                      consumerGroupId: topic.consumerGroupId,
                      packId: topic.packId,
                      topicId: topic.topicId,
                    });
                }}
              >
                隨機驚喜
              </button>
              <button
                data-testid="studio-create-blank"
                className={w.creationMethod === "blank" ? "active" : ""}
                onClick={() => updateWizard({ creationMethod: "blank" })}
              >
                保持空白
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>故事方向</h2>
            <div className="studioGenreGrid">
              {STORY_LIBRARY.consumerGroups.map((group) => (
                <button
                  key={group.groupId}
                  className={
                    w.consumerGroupId === group.groupId ? "active" : ""
                  }
                  onClick={() =>
                    updateWizard({
                      consumerGroupId: group.groupId,
                      topicId: "",
                      creationMethod: "topic",
                    })
                  }
                >
                  <b>{group.name}</b>
                  <span>{group.description}</span>
                </button>
              ))}
            </div>
            <label>
              分類包 <small>選填</small>
              <select
                value={w.packId}
                onChange={(event) =>
                  updateWizard({ packId: event.target.value, topicId: "" })
                }
              >
                <option value="">尚未設定</option>
                {STORY_LIBRARY.packs.map((pack) => (
                  <option key={pack.packId} value={pack.packId}>
                    {pack.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="topicPicker">
              {topics.map((topic) => (
                <button
                  key={topic.topicId}
                  className={w.topicId === topic.topicId ? "active" : ""}
                  onClick={() =>
                    updateWizard({
                      topicId: topic.topicId,
                      creationMethod: "topic",
                    })
                  }
                >
                  <b>{topic.name}</b>
                  <span>{topic.description}</span>
                </button>
              ))}
            </div>
            {selectedTopic && (
              <label>
                細分類 <small>選填</small>
                <select
                  value={w.subCategory}
                  onChange={(event) =>
                    updateWizard({ subCategory: event.target.value })
                  }
                >
                  <option value="">尚未設定</option>
                  {selectedTopic.subCategories.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              onClick={() =>
                updateWizard({
                  consumerGroupId: "",
                  packId: "",
                  topicId: "",
                  subCategory: "",
                })
              }
            >
              暫時略過
            </button>
          </>
        )}
        {step === 3 && (
          <>
            <div className="studioForm">
              {(
                [
                  "protagonist",
                  "identity",
                  "archetype",
                  "goal",
                  "weakness",
                  "world",
                  "worldRule",
                  "factions",
                  "conflict",
                  "villain",
                  "style",
                ] as OptionalKey[]
              ).map(optionalInput)}
            </div>
            <button onClick={() => void runTask("improve_settings")}>
              由閉端助手提出補充候選
            </button>
          </>
        )}
        {step === 4 && (
          <>
            <h2>選擇讀者要「讀故事」還是「玩故事」</h2>
            <p className="studioWizardHint">互動、RPG、戀愛與經營會先確認人物和世界；一般小說仍可直接進入章節寫作。</p>
            <div className="studioGenreGrid">
              {STORY_LIBRARY.playModes
                .filter((mode) => !mode.adultOnly || w.adultMode)
                .map((mode) => (
                  <button
                    key={mode.playModeId}
                    data-testid={`studio-play-mode-${mode.playModeId}`}
                    className={w.playModeId === mode.playModeId ? "active" : ""}
                    onClick={() =>
                      updateWizard({ playModeId: mode.playModeId })
                    }
                  >
                    <b>{mode.name}</b>
                    <span>
                      {mode.playModeId === "general"
                        ? "不啟用數值也能寫作"
                        : "可自行選擇是否啟用數值"}
                    </span>
                  </button>
                ))}
            </div>
            <button
              onClick={() => updateWizard({ playModeId: "", enabledStats: [] })}
            >
              玩法保持未設定
            </button>
            {w.playModeId && w.playModeId !== "general" && (
              <fieldset>
                <legend>
                  故事數值 <small>全部選填</small>
                </legend>
                {STORY_LIBRARY.storyStats.map((stat) => (
                  <label key={stat.statId}>
                    <input
                      data-testid={`studio-story-stat-${stat.statId}`}
                      type="checkbox"
                      checked={w.enabledStats.includes(stat.statId)}
                      onChange={(event) =>
                        updateWizard({
                          enabledStats: event.target.checked
                            ? [...w.enabledStats, stat.statId]
                            : w.enabledStats.filter((id) => id !== stat.statId),
                        })
                      }
                    />
                    {({
                      stamina: "體力",
                      money: "金錢",
                      affection: "好感度",
                      reputation: "聲望",
                      experience: "經驗值",
                      level: "等級",
                      turns: "回合數",
                      questProgress: "任務進度",
                    } as Record<string, string>)[stat.statId] || stat.name}
                  </label>
                ))}
              </fieldset>
            )}
            <details>
              <summary>成人模式（預設關閉）</summary>
              <label>
                <input
                  type="checkbox"
                  checked={w.ageConfirmed}
                  onChange={(event) =>
                    updateWizard({
                      ageConfirmed: event.target.checked,
                      adultMode: event.target.checked ? w.adultMode : false,
                    })
                  }
                />{" "}
                我確認已成年
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={!w.ageConfirmed}
                  checked={w.adultMode}
                  onChange={(event) =>
                    updateWizard({
                      adultMode: event.target.checked,
                      playModeId: event.target.checked ? w.playModeId : "",
                    })
                  }
                />{" "}
                主動開啟成人模式
              </label>
              {w.adultMode && w.ageConfirmed ? (
                <section className="studioAdultDirector" data-testid="studio-adult-character-director">
                  <header>
                    <div>
                      <small>成年角色導演</small>
                      <h3>從一句設定到可持續互動的角色</h3>
                    </div>
                    <span>外觀・個性・聲音・關係・記憶・群像</span>
                  </header>
                  <p>
                    先給少量設定即可開始，之後可在角色 AI 中繼續補人物與關係。角色記憶、關係與視覺規格會分開保存，避免每次生成變成不同人物。
                  </p>
                  <fieldset>
                    <legend>視覺呈現</legend>
                    <div className="studioAdultChoiceRow">
                      {([
                        ["realistic", "寫實"],
                        ["anime", "動畫"],
                        ["illustrated", "小說插畫"],
                      ] as const).map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          className={adultProfile.visualStyle === value ? "active" : ""}
                          onClick={() => updateAdultProfile({ visualStyle: value })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="studioForm studioAdultForm">
                    <label>
                      性別呈現
                      <select value={adultProfile.genderPresentation} onChange={(event) => updateAdultProfile({ genderPresentation: event.target.value as AdultExperienceProfile["genderPresentation"] })}>
                        <option value="woman">女性</option>
                        <option value="man">男性</option>
                        <option value="trans">跨性別</option>
                        <option value="nonbinary">非二元</option>
                        <option value="custom">自訂／故事決定</option>
                      </select>
                    </label>
                    <label>
                      互動形式
                      <select value={adultProfile.interactionMode} onChange={(event) => updateAdultProfile({ interactionMode: event.target.value as AdultExperienceProfile["interactionMode"] })}>
                        <option value="one_to_one">單一角色關係</option>
                        <option value="ensemble">群像與多角色關係網</option>
                      </select>
                    </label>
                    <label>
                      個性與說話方式
                      <input value={adultProfile.personality} onChange={(event) => updateAdultProfile({ personality: event.target.value })} placeholder="例如：冷靜、嘴硬心軟、慢熱但記仇" />
                    </label>
                    <label>
                      聲音風格
                      <input value={adultProfile.voiceStyle} onChange={(event) => updateAdultProfile({ voiceStyle: event.target.value })} placeholder="例如：低沉克制、明亮俐落" />
                    </label>
                    <label>
                      身分／職業
                      <input value={adultProfile.occupation} onChange={(event) => updateAdultProfile({ occupation: event.target.value })} placeholder="角色在世界中的工作與位置" />
                    </label>
                    <label>
                      關係動態
                      <input value={adultProfile.relationshipDynamic} onChange={(event) => updateAdultProfile({ relationshipDynamic: event.target.value })} placeholder="例如：宿敵到知己、重逢舊識、互相試探" />
                    </label>
                    <label>
                      外觀一致性描述
                      <textarea value={adultProfile.appearancePrompt} onChange={(event) => updateAdultProfile({ appearancePrompt: event.target.value })} placeholder="只描述虛構角色的固定辨識特徵、服裝風格與氣質；不接受真人仿貌。" />
                    </label>
                    <label>
                      背景與第一幕
                      <textarea value={adultProfile.backstory} onChange={(event) => updateAdultProfile({ backstory: event.target.value })} placeholder="角色過去、當前渴望、不能輕易說出的矛盾" />
                    </label>
                    <label>
                      初次登場台詞
                      <textarea value={adultProfile.openingMessage} onChange={(event) => updateAdultProfile({ openingMessage: event.target.value })} placeholder="角色第一次出場時會說什麼、做什麼" />
                    </label>
                    <label>
                      釘選記憶 <small>每行一項</small>
                      <textarea
                        value={adultProfile.pinnedMemories.join("\n")}
                        onChange={(event) => updateAdultProfile({ pinnedMemories: event.target.value.split(/\r?\n/u) })}
                        placeholder={"必須記得的承諾\n共同經歷的重要事件\n不能跨越的界線"}
                      />
                    </label>
                  </div>
                  <div className="studioAdultSafety">
                    <label>
                      <input type="checkbox" checked={adultProfile.mediaContinuity} onChange={(event) => updateAdultProfile({ mediaContinuity: event.target.checked })} />
                      人像、場景與短片沿用同一角色識別規格
                    </label>
                    <label>
                      <input
                        data-testid="studio-adult-fictional-confirmation"
                        type="checkbox"
                        checked={adultProfile.fictionalAdultsConfirmed}
                        onChange={(event) => updateAdultProfile({ fictionalAdultsConfirmed: event.target.checked })}
                      />
                      我確認相關人物均為明確成年虛構角色，互動同意可隨時撤回
                    </label>
                    <small>成人資料使用獨立命名空間；禁止未成年內容、真人仿貌與未經同意的私密素材。</small>
                  </div>
                </section>
              ) : null}
            </details>
          </>
        )}
        {step === 5 && (
          <>
            <dl className="studioPreview">
              <div>
                <dt>作品</dt>
                <dd>{w.title || "未命名作品"}</dd>
              </div>
              <div>
                <dt>題材</dt>
                <dd>{selectedTopic?.name || "尚未設定"}</dd>
              </div>
              <div>
                <dt>核心想法</dt>
                <dd>{w.coreIdea || "尚未設定"}</dd>
              </div>
              <div>
                <dt>玩法</dt>
                <dd>
                  {STORY_LIBRARY.playModes.find(
                    (mode) => mode.playModeId === w.playModeId,
                  )?.name || "尚未設定"}
                </dd>
              </div>
              <div>
                <dt>成人模式</dt>
                <dd>{w.adultMode && w.ageConfirmed ? "已主動開啟" : "關閉"}</dd>
              </div>
              {w.adultMode && w.ageConfirmed ? (
                <div>
                  <dt>成年角色導演</dt>
                  <dd>{adultProfile.personality || adultProfile.relationshipDynamic || "可建立後逐步補充"}・{adultProfile.interactionMode === "ensemble" ? "群像" : "單一角色"}</dd>
                </div>
              ) : null}
            </dl>
            <p>
              空白欄位會原樣保存，不會被填入假值。稍後可在故事發展中逐步補充。
            </p>
            {missingFoundation.length ? (
              <div className="studioFoundationBlock" role="alert" data-testid="studio-foundation-blocked">
                <strong>還差 {missingFoundation.length} 項，暫時不能開始</strong>
                <span>{missingFoundation.map((item) => item.label).join("、")}</span>
                <button type="button" onClick={() => updateWizard(buildLocalCreationGuide(w))}>
                  由引導精靈補齊後再檢查
                </button>
              </div>
            ) : (
              <div className="studioFoundationReady" role="status" data-testid="studio-foundation-ready">
                <strong>起始設定已足夠</strong>
                <span>{gameMode ? "建立後可先寫開場，也可直接進入第一個 RPG／互動回合。" : "建立後可自己寫第一幕，或請真實模型提出開場候選。"}</span>
              </div>
            )}
          </>
        )}
        {candidate && (
          <SuggestionCard
            key={candidate.createdAt}
            candidate={candidate}
            originalContent=""
            accept={acceptSuggestion}
            retry={() => void runTask(candidate.task, {
              regenerateFrom: candidate,
            })}
            discard={discard}
          />
        )}
      </div>
      <footer>
        <button
          disabled={step === 1}
          onClick={() => setStep(Math.max(1, step - 1))}
        >
          返回修改
        </button>
        {step < 5 ? (
          <button data-testid="studio-create-next" className="gold" onClick={() => setStep(Math.min(5, step + 1))}>
            儲存本步並繼續
          </button>
        ) : (
          <button data-testid="studio-create-submit" className="gold" disabled={missingFoundation.length > 0} onClick={createProject}>
            {missingFoundation.length ? "完成必要設定後才能開始" : "建立作品並進入第一幕"}
          </button>
        )}
      </footer>
    </section>
  );
}

function WriteScreen({
  project,
  candidate,
  navigate,
  requestTaskHref,
  registerSaveHandler,
  saveDraft,
  activateChapter,
  createChapter,
  deleteChapter,
  runTask,
  completeChapter,
  acceptCandidate,
  discard,
  assistantStatus,
  assistantBusy,
  assistantStreamText,
  assistantStreamEvents,
  assistantProgress,
  assistantFailure,
  stopAssistantTask,
  lastRejectedCandidate,
  regenerationError,
}: {
  project: Project | null;
  candidate: Candidate;
  navigate: (screen: Screen) => void;
  requestTaskHref: (href: string, label: string) => void;
  registerSaveHandler: (handler: (() => Promise<void>) | null) => void;
  saveDraft: (chapterId: string, title: string, draft: string) => Promise<void>;
  activateChapter: (chapterId: string) => Promise<Chapter>;
  createChapter: () => Promise<Chapter>;
  deleteChapter: (chapterId: string) => Promise<Chapter>;
  runTask: StudioRunTask;
  completeChapter: (title: string, draft: string) => Promise<void>;
  acceptCandidate: (content?: string) => Promise<void>;
  discard: () => void;
  assistantStatus: AssistantStatus;
  assistantBusy: string | null;
  assistantStreamText: string;
  assistantStreamEvents: number;
  assistantProgress: ClosedAIProgressEvent | null;
  assistantFailure: string;
  stopAssistantTask: () => void;
  lastRejectedCandidate: NonNullable<Candidate> | null;
  regenerationError: string;
}) {
  const [title, setTitle] = useState(project?.chapterTitle || "第一章"),
    [draft, setDraft] = useState(project?.draft || ""),
    [focus, setFocus] = useState(false),
    [helperOpen, setHelperOpen] = useState(false),
    [regenerationExtra, setRegenerationExtra] = useState(""),
    [chapters, setChapters] = useState<Chapter[]>([]),
    [chapterBusy, setChapterBusy] = useState(false),
    [chapterMessage, setChapterMessage] = useState("章節彼此獨立保存"),
    [aiCacheStatus, setAiCacheStatus] = useState("正在準備本作品的閉端 AI 脈絡…");
  const lastSubmitted = useRef<{
    chapterId: string | null;
    title: string;
    draft: string;
  } | null>(null);
  const displayedChapterId = useRef(project?.activeChapterId ?? null);
  const displayedProjectStamp = useRef(project?.updatedAt ?? "");
  const titleRef = useRef(title);
  const draftRef = useRef(draft);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const chapterSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const resumeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    titleRef.current = title;
    draftRef.current = draft;
  }, [title, draft]);

  useEffect(() => {
    if (!project?.id || !project.activeChapterId) return;
    const marker = readStudioWritingResume(project.id);
    if (!marker || marker.chapterId !== project.activeChapterId) return;
    const timer = window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const start = Math.min(marker.selectionStart, editor.value.length);
      const end = Math.min(Math.max(start, marker.selectionEnd), editor.value.length);
      editor.setSelectionRange(start, end);
      editor.scrollTop = marker.scrollTop;
      setChapterMessage(`已恢復「${project.chapterTitle}」上次保存的編輯位置`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [project?.activeChapterId, project?.chapterTitle, project?.id]);

  useEffect(() => {
    if (!project?.id || !project.activeChapterId) return;
    const controller = new AbortController();
    let cancelModelPrewarm = () => {};
    const statusTimer = window.setTimeout(() => {
      setAiCacheStatus("正在把目前章節與作品記憶預載到六層 AI Cache…");
    }, 0);
    const timer = window.setTimeout(() => {
      void Promise.allSettled([
        prewarmStudioProjectAIState({
          projectId: project.id,
          taskTypes: ["chapter.continue"],
          sourceChapterId: project.activeChapterId ?? undefined,
          signal: controller.signal,
        }),
        prewarmStudioInteractiveChoiceAI(controller.signal),
        scheduleBrowserModelPrewarm({
          policy: "browser-first",
          signal: controller.signal,
        }).then((decision) => {
          cancelModelPrewarm = decision.cancel;
          return decision;
        }),
      ]).then(([cacheResult]) => {
        if (controller.signal.aborted) return;
        const warmed = cacheResult.status === "fulfilled" ? cacheResult.value[0] : null;
        setAiCacheStatus(warmed
          ? `六層 AI Cache 已就緒｜${project.chapterTitle} r${warmed.chapterRevision}｜閉端 AI 可立即承接`
          : "章節已安全保存；閉端模型連線後會自動重建 AI Cache");
      });
    }, 650);
    return () => {
      window.clearTimeout(statusTimer);
      window.clearTimeout(timer);
      cancelModelPrewarm();
      controller.abort("STUDIO_WRITING_CONTEXT_REPLACED");
    };
  }, [project?.activeChapterId, project?.chapterTitle, project?.id, project?.updatedAt]);

  function rememberCurrentEditorPosition(editor: HTMLTextAreaElement) {
    if (!project?.id || !project.activeChapterId) return;
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    const marker = {
      projectId: project.id,
      chapterId: project.activeChapterId,
      selectionStart: editor.selectionStart,
      selectionEnd: editor.selectionEnd,
      scrollTop: editor.scrollTop,
    };
    resumeTimerRef.current = window.setTimeout(() => {
      writeStudioWritingResume(marker);
      resumeTimerRef.current = null;
    }, 180);
  }

  useEffect(() => () => {
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!project) return;
    const identityChanged = displayedChapterId.current !== project.activeChapterId;
    const stampChanged = displayedProjectStamp.current !== project.updatedAt;
    if (!identityChanged && !stampChanged) return;
    const submitted = lastSubmitted.current;
    const isOwnSave = Boolean(
      submitted
      && submitted.chapterId === project.activeChapterId
      && submitted.title === project.chapterTitle
      && submitted.draft === project.draft,
    );
    displayedChapterId.current = project.activeChapterId;
    displayedProjectStamp.current = project.updatedAt;
    if (identityChanged || !isOwnSave) {
      setTitle(project.chapterTitle);
      setDraft(project.draft);
    }
    if (isOwnSave) lastSubmitted.current = null;
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    if (!project) return;
    void createNovelRepository().list<Chapter>("chapters", project.id)
      .then((rows) => {
        if (!cancelled) setChapters(rows.sort((left, right) => left.order - right.order));
      })
      .catch((error) => {
        if (!cancelled) setChapterMessage(error instanceof Error ? error.message : "章節列表讀取失敗");
      });
    return () => { cancelled = true; };
  }, [project]);

  async function persistCurrentChapter() {
    if (!project) return;
    if (!project.activeChapterId) {
      throw new Error("目前章節缺少識別碼，系統沒有把內容寫到其他章節。");
    }
    const payload = {
      chapterId: project.activeChapterId,
      title: titleRef.current,
      draft: draftRef.current,
    };
    lastSubmitted.current = payload;
    setChapterMessage("正在保存目前章節……");
    const operation = chapterSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await saveDraft(payload.chapterId, payload.title, payload.draft);
        setChapters((rows) => rows.map((item) => item.id === payload.chapterId
          ? { ...item, title: payload.title, content: payload.draft }
          : item));
        setChapterMessage(`「${payload.title || "目前章節"}」已按章節 ID 獨立保存`);
        const editor = editorRef.current;
        if (editor) rememberCurrentEditorPosition(editor);
      })
      .catch((error) => {
        lastSubmitted.current = null;
        setChapterMessage(error instanceof Error ? error.message : "章節保存失敗");
        throw error;
      });
    chapterSaveQueueRef.current = operation.catch(() => undefined);
    return operation;
  }

  useEffect(() => {
    const handler = () => persistCurrentChapter();
    registerSaveHandler(handler);
    return () => registerSaveHandler(null);
  });

  async function selectChapter(next: Chapter) {
    if (!project || next.id === project.activeChapterId || chapterBusy) return;
    if (candidate) {
      alert("請先採用或放棄目前 AI 候選，再切換章節，避免候選套用到錯誤章節。");
      return;
    }
    setChapterBusy(true);
    try {
      await persistCurrentChapter();
      const activated = await activateChapter(next.id);
      setTitle(activated.title);
      setDraft(activated.content);
      setChapterMessage(`已切換到「${activated.title}」`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "章節切換失敗。");
    } finally {
      setChapterBusy(false);
    }
  }

  async function addChapter() {
    if (!project || chapterBusy) return;
    if (candidate) {
      alert("請先處理目前 AI 候選，再新增章節。");
      return;
    }
    setChapterBusy(true);
    try {
      await persistCurrentChapter();
      const created = await createChapter();
      setChapters((rows) => [...rows, created].sort((left, right) => left.order - right.order));
      setTitle(created.title);
      setDraft(created.content);
      setChapterMessage(`已建立「${created.title}」`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "新增章節失敗。");
    } finally {
      setChapterBusy(false);
    }
  }

  async function removeCurrentChapter() {
    if (!project?.activeChapterId || chapterBusy) return;
    if (candidate) {
      alert("請先處理目前 AI 候選，再刪除章節。");
      return;
    }
    if (!confirm(`確定刪除「${titleRef.current}」嗎？其他章節不會受影響。`)) return;
    setChapterBusy(true);
    try {
      const next = await deleteChapter(project.activeChapterId);
      setChapters((rows) => rows.filter((item) => item.id !== project.activeChapterId));
      setTitle(next.title);
      setDraft(next.content);
      setChapterMessage(`已刪除章節，現在是「${next.title}」`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "刪除章節失敗。");
    } finally {
      setChapterBusy(false);
    }
  }

  async function finishCurrentChapter() {
    if (!project || chapterBusy) return;
    if (candidate) {
      alert("請先採用或放棄目前 AI 候選，再完成章節，避免候選失去來源章節。");
      return;
    }
    setChapterBusy(true);
    setChapterMessage("正在保存、完成並備份目前章節……");
    try {
      await completeChapter(titleRef.current, draftRef.current);
      setChapterMessage("本章已完成，已開啟下一章");
    } catch (error) {
      const message = error instanceof Error ? error.message : "完成章節失敗，沒有建立下一章。";
      setChapterMessage(message);
      alert(message);
    } finally {
      setChapterBusy(false);
    }
  }

  useEffect(() => {
    if (
      !project
      || (title === project.chapterTitle && draft === project.draft)
    ) return;
    const timer = setTimeout(() => {
      void persistCurrentChapter().catch(() => undefined);
    }, 1000);
    return () => clearTimeout(timer);
  }, [title, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!project)
    return (
      <div className="studioEmpty">
        <b>此作品尚未建立</b>
        <p>先建立作品，才能開始寫作。</p>
        <button onClick={() => navigate("create")}>建立第一部小說</button>
      </div>
    );
  return (
    <section
      className={`studioWriting ${focus ? "focusMode" : ""}`}
      data-testid="studio-writing"
      data-project-id={project.id}
    >
      {!focus && (
        <aside className="studioChapterSidebar">
          <h2>{project.title}</h2>
          <p>{project.topicName || "題材尚未設定"}</p>
          <section className="studioChapterManager" aria-label="章節列表" data-testid="studio-chapter-manager">
            <header>
              <div><small>章節列表</small><b>{chapters.length} 章</b></div>
              <button type="button" disabled={chapterBusy} onClick={() => void addChapter()}>＋ 新增</button>
            </header>
            <div>
              {chapters.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  data-testid={`studio-chapter-${item.id}`}
                  className={item.id === project.activeChapterId ? "active" : ""}
                  disabled={chapterBusy}
                  onClick={() => void selectChapter(item)}
                >
                  <span>{item.order}. {item.title}</span>
                  <small>{item.status === "completed" ? "已完成" : `${words(item.content)} 字`}</small>
                </button>
              ))}
            </div>
            <footer>
              <small>{chapterMessage}</small>
              <button type="button" disabled={chapterBusy || chapters.length <= 1} onClick={() => void removeCurrentChapter()}>刪除本章</button>
            </footer>
          </section>
          <nav>
            <button type="button" onClick={() => requestTaskHref(`/studio/read/${project.id}`, "閱讀作品")}>閱讀作品</button>
            <button onClick={() => navigate("create")}>故事設定</button>
            <button onClick={() => navigate("world")}>主要角色</button>
            <button onClick={() => navigate("world")}>世界設定</button>
            <button onClick={() => navigate("world")}>伏筆與線索</button>
            <button onClick={() => navigate("backup")}>版本紀錄</button>
          </nav>
        </aside>
      )}
      <main>
        <header>
          <label>
            目前章節
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <span>{chapterMessage}</span>
        </header>
        <small className="studioWritingCacheStatus" role="status">{aiCacheStatus}</small>
        {!draft.trim() && !candidate ? (
          <section className="studioStoryStarter" data-testid="studio-story-starter">
            <div>
              <small>第一幕起跑區</small>
              <h2>設定完成了，現在只選一件最想做的事</h2>
              <p>不必先理解全部工具。自己寫一個場景、請模型提出開場候選，或直接進入第一個互動回合。</p>
            </div>
            <div>
              <button
                type="button"
                className="gold"
                disabled={Boolean(assistantBusy)}
                onClick={() => void runTask("first_chapter")}
              >
                {assistantBusy === "first_chapter" ? "正在產生開場候選…" : "請 AI 寫開場候選"}
              </button>
              <button type="button" onClick={() => editorRef.current?.focus()}>
                我自己寫第一幕
              </button>
              <button type="button" data-testid="studio-writing-open-rpg" onClick={() => requestTaskHref(`/studio/project/${project.id}/rpg`, "完整 RPG 儀表板")}>進入第一個遊戲回合</button>
              <button type="button" onClick={() => navigate("world")}>先調整人物與世界</button>
            </div>
          </section>
        ) : null}
        <textarea
          ref={editorRef}
          aria-label="正文編輯器"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onSelect={(event) => rememberCurrentEditorPosition(event.currentTarget)}
          onScroll={(event) => rememberCurrentEditorPosition(event.currentTarget)}
          placeholder="從這裡開始寫你的故事……"
        />
        <footer>
          <span>{words(draft)} 字</span>
          <div>
            {focus && (
              <button onClick={() => setHelperOpen(!helperOpen)}>
                小型 AI 助手
              </button>
            )}
            <button onClick={() => setFocus(!focus)}>
              {focus ? "離開專注模式" : "專注寫作"}
            </button>
            <button type="button" onClick={() => requestTaskHref(`/studio/read/${project.id}`, "閱讀作品")}>閱讀作品</button>
            <button disabled={chapterBusy} onClick={() => void finishCurrentChapter()}>
              {chapterBusy ? "正在完成本章……" : "完成本章並建立下一章"}
            </button>
            <button className="gold" onClick={() => void persistCurrentChapter()}>
              儲存草稿
            </button>
          </div>
        </footer>
      </main>
      {(!focus || helperOpen) && (
        <aside className="studioAssistant">
          <header>
            <span>閉端創作助手</span>
            <h2>
              {assistantStatus === "ollama_ready"
                ? "真實本機 AI 已連線"
                : assistantStatus === "external_ready"
                  ? "真實外接 AI 已就緒"
                : assistantStatus === "runtime_ready"
                  ? "瀏覽器輕量 AI 可用；創作模型未連線"
                  : "真實創作模型尚未連線"}
            </h2>
          </header>
          {assistantStatus !== "ollama_ready" && assistantStatus !== "external_ready" ? (
            <div className="studioAiConnection" role="status">
              <strong>續寫、改寫與對話需要真實生成模型</strong>
              <span>未連線時只會提供清楚標示的離線寫作工具，不會把規則模板冒充 AI。</span>
              <Link href={`/studio/project/${project.id}/closed-ai?task=chapter.continue`}>
                連接並實測閉端 AI
              </Link>
            </div>
          ) : null}
          <div className="studioTaskGrid">
            {(focus
              ? assistantTasks.filter(([id]) =>
                  [
                    "continue_story",
                    "rewrite_selection",
                    "dialogue_boost",
                    "emotion_boost",
                    "pacing_tune",
                    "chapter_hook",
                    "improve_settings",
                    "three_choices",
                  ].includes(id),
                )
              : assistantTasks
            ).map(([id, label]) => (
              <button
                key={id}
                disabled={Boolean(assistantBusy)}
                onClick={() => void persistCurrentChapter().then(() => runTask(id))}
              >
                <b>{assistantBusy === id ? "真實模型執行中…" : label}</b>
                <span>
                  {assistantStatus === "ollama_ready"
                    ? "本機 AI 建議：由本機模型產生候選，再由你決定是否加入"
                    : assistantStatus === "external_ready"
                      ? "外接 AI 建議：資料會離開裝置，結果仍須由你核准"
                    : "先嘗試真實模型；未連線時改顯示非 AI 寫作工具"}
                </span>
              </button>
            ))}
          </div>
          {assistantBusy && (
            <section className="studioStreamPreview" data-testid="studio-stream-preview" aria-live="polite">
              <header>
                <div>
                  <strong>{assistantProgress?.label ?? (assistantStreamText ? "模型正在寫作" : "正在連接真實模型")}</strong>
                  <small>
                    {assistantProgress
                      ? `${assistantProgress.percent}%${assistantProgress.generatedCharacters != null ? `・${assistantProgress.generatedCharacters} 字` : ""}`
                      : assistantStreamEvents > 0
                        ? `${assistantStreamEvents} 個串流片段`
                        : "正在核對模型與裝置資源"}
                  </small>
                </div>
                <button type="button" onClick={stopAssistantTask}>停止生成</button>
              </header>
              <progress max={100} value={assistantProgress?.percent ?? 8} aria-label="AI 工作進度" />
              {assistantStreamText && <pre>{assistantStreamText}</pre>}
            </section>
          )}
          {!assistantBusy && assistantFailure ? (
            <div className="studioAiWarning" role="alert" data-testid="studio-assistant-failure">
              <strong>這次沒有取得真實模型回答</strong>
              <span>{assistantFailure}</span>
              <Link href={`/studio/project/${project.id}/closed-ai?task=chapter.continue`}>
                檢查並重測閉端 AI
              </Link>
            </div>
          ) : null}
          {!candidate && lastRejectedCandidate && (
            <div className="studioRegenerationPrompt" data-testid="studio-rejected-regeneration">
              <strong>原候選已放棄，正式故事沒有變更</strong>
              <label>
                額外要求（選填）
                <input
                  data-testid="studio-regeneration-extra-requirement"
                  value={regenerationExtra}
                  onChange={(event) => setRegenerationExtra(event.target.value)}
                  placeholder="例如：改由配角先採取行動"
                />
              </label>
              <button
                data-testid="studio-candidate-regenerate"
                className="gold"
                disabled={Boolean(assistantBusy)}
                onClick={() => void runTask(lastRejectedCandidate.task, {
                  regenerateFrom: lastRejectedCandidate,
                  extraRequirement: regenerationExtra,
                })}
              >
                {assistantBusy?.startsWith("regenerate:")
                  ? "正在產生不同版本"
                  : "換一個版本"}
              </button>
            </div>
          )}
          {regenerationError && (
            <div className="studioAiWarning" role="alert" data-testid="studio-regeneration-error">
              <strong>沒有建立新的候選</strong>
              <span>{regenerationError}</span>
            </div>
          )}
          {candidate && (
            <SuggestionCard
              key={candidate.createdAt}
              candidate={candidate}
              originalContent={project.draft}
              accept={acceptCandidate}
              retry={() => void runTask(candidate.task, {
                regenerateFrom: candidate,
              })}
              discard={discard}
              busy={Boolean(assistantBusy)}
              regenerating={Boolean(assistantBusy?.startsWith("regenerate:"))}
              closedAiHref={`/studio/project/${project.id}/closed-ai?task=${encodeURIComponent(
                candidate.task === "continue_story"
                  ? "chapter.continue"
                  : "assistant.general",
              )}`}
            />
          )}
        </aside>
      )}
    </section>
  );
}

function SuggestionCard({
  candidate,
  originalContent,
  accept,
  retry,
  discard,
  busy = false,
  regenerating = false,
  closedAiHref = "/studio/settings/ai",
}: {
  candidate: NonNullable<Candidate>;
  originalContent: string;
  accept: (content: string) => void | Promise<void>;
  retry: () => void;
  discard: () => void;
  busy?: boolean;
  regenerating?: boolean;
  closedAiHref?: string;
}) {
  const [editing, setEditing] = useState(false),
    [content, setContent] = useState(candidate.content);
  const proposedContent = candidateApplyMode(candidate.task) === "replace"
    ? content.trim()
    : `${originalContent.trim()}${originalContent.trim() ? "\n\n" : ""}${content.trim()}`;
  const beforeCharacters = originalContent.replace(/\s/g, "").length;
  const afterCharacters = proposedContent.replace(/\s/g, "").length;
  return (
    <article className="studioCandidate" data-testid="studio-candidate">
      <header>
        <b>
          {candidate.model === "local-rule"
            ? "離線寫作工具（非 AI）"
            : candidate.candidateKind === "external-ai"
              ? "真實外接 AI 候選"
              : "真實閉端 AI 候選"}
        </b>
        <span>這份內容還沒有加入正式故事</span>
      </header>
      {candidate.diagnostic ? (
        <div className="studioAiWarning" role="alert">
          <strong>本次沒有取得真實模型回答</strong>
          <span>{candidate.diagnostic}</span>
          <Link href={closedAiHref}>前往連接與實測真實 AI</Link>
        </div>
      ) : (
        <p>
          這是模型產生、尚未核准的候選。你可以直接採用、修改後採用，或暫時不使用。
        </p>
      )}
      {editing ? (
        <textarea
          aria-label="修改故事建議"
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      ) : (
        <pre>{content}</pre>
      )}
      <details data-testid="studio-candidate-diff">
        <summary>查看與目前正文的差異</summary>
        <p data-testid="studio-candidate-diff-summary">
          目前 {beforeCharacters} 字 → 核准後 {afterCharacters} 字
          {" · "}
          {afterCharacters >= beforeCharacters ? "+" : ""}
          {afterCharacters - beforeCharacters} 字
        </p>
        <div className="studioCandidateDiff">
          <section>
            <h4>目前正式正文</h4>
            <pre>{originalContent || "（目前正文為空白）"}</pre>
          </section>
          <section>
            <h4>核准後預覽</h4>
            <pre>{proposedContent || "（核准後正文為空白）"}</pre>
          </section>
        </div>
      </details>
      <footer>
        <button
          data-testid="studio-candidate-accept"
          className="gold"
          disabled={busy}
          onClick={() => void accept(content)}
        >
          {busy ? "正在完成核准交易…" : editing ? "修改後採用" : "採用這份建議"}
        </button>
        <button disabled={busy} onClick={() => setEditing(true)}>修改後採用</button>
        <button data-testid="studio-candidate-regenerate" disabled={busy} onClick={retry}>
          {regenerating ? "正在產生不同版本" : "換一個版本"}
        </button>
        <button data-testid="studio-candidate-discard" disabled={busy} onClick={discard}>保持空白</button>
        <button disabled={busy} onClick={discard}>暫時不用</button>
      </footer>
      <details>
        <summary>查看技術資訊</summary>
        <dl>
          <div>
            <dt>使用中的 AI</dt>
            <dd>
              {candidate.model === "local-rule"
                ? "本機規則工具（不是生成模型）"
                : candidate.model}
            </dd>
          </div>
          <div>
            <dt>實際執行器</dt>
            <dd data-testid="studio-candidate-actual-executor">{candidate.actualExecutor ?? "not_executed"}</dd>
          </div>
          <div>
            <dt>模型證明</dt>
            <dd>
              {candidate.candidateKind === "closed-ai"
                ? `${candidate.modelId ?? "missing"} · ${candidate.modelDigest ?? "missing"}`
                : "不適用（非 AI 寫作工具）"}
            </dd>
          </div>
          <div>
            <dt>來源章節版本</dt>
            <dd>{candidate.sourceRevision ?? "missing"}</dd>
          </div>
          {candidate.regenerationAttempt != null && (
            <>
              <div>
                <dt>regenerationAttempt</dt>
                <dd data-testid="studio-regeneration-attempt">{candidate.regenerationAttempt}</dd>
              </div>
              <div>
                <dt>new candidate</dt>
                <dd data-testid="studio-regeneration-new-candidate">{candidate.newCandidate ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>previous content reused</dt>
                <dd data-testid="studio-regeneration-content-reused">{candidate.previousContentReused ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>cache bypassed</dt>
                <dd data-testid="studio-regeneration-cache-bypassed">{candidate.cacheBypassed ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt>差異檢查</dt>
                <dd data-testid="studio-regeneration-similarity">
                  {candidate.similarityMetric ?? "missing"} · {candidate.similarityScore ?? "missing"}
                </dd>
              </div>
            </>
          )}
          <div>
            <dt>脈絡來源摘要</dt>
            <dd data-testid="studio-candidate-context-source-summary">
              {candidate.contextSourceSummary ?? "missing"}
            </dd>
          </div>
          <div>
            <dt>真實生成事件</dt>
            <dd data-testid="studio-candidate-generated-token-events">
              {candidate.generatedTokenEvents ?? 0}
            </dd>
          </div>
          <div>
            <dt>資料離開裝置</dt>
            <dd data-testid="studio-candidate-data-left-device">
              {candidate.dataLeftDevice ? "是" : "否"}
            </dd>
          </div>
          <div>
            <dt>執行方式</dt>
            <dd>{candidate.source}</dd>
          </div>
          <div>
            <dt>是否使用外部網路</dt>
            <dd data-testid="studio-candidate-external-request">{candidate.externalRequest ? "是" : "否"}</dd>
          </div>
          <div>
            <dt>是否參考目前作品</dt>
            <dd>{candidate.usedLocalMemory ? "是" : "否"}</dd>
          </div>
          <div>
            <dt>建議產生時間</dt>
            <dd>{formatTime(candidate.createdAt)}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function WorldScreen({
  project,
  updateProject,
  runTask,
}: {
  project: Project | null;
  updateProject: (changes: Partial<Record<OptionalKey, OptionalField>>) => void;
  runTask: StudioRunTask;
}) {
  const [selected, setSelected] = useState<
      "protagonist" | "archetype" | "conflict" | "world" | null
    >(null),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(""),
    [review, setReview] = useState(false);
  if (!project)
    return (
      <div className="studioEmpty">
        <b>尚未建立作品</b>
        <p>建立作品後，角色與世界設定會顯示在這裡。</p>
        <Link href="/studio?screen=create">建立作品</Link>
      </div>
    );
  const fields = project.optionalFields,
    cards = [
      {
        id: "protagonist" as const,
        title: "主角",
        value: optionalValue(fields, "protagonist"),
        subtitle: optionalValue(fields, "identity"),
      },
      {
        id: "archetype" as const,
        title: "主角原型",
        value: optionalValue(fields, "archetype"),
        subtitle: optionalValue(fields, "goal"),
      },
      {
        id: "conflict" as const,
        title: "主要衝突",
        value: optionalValue(fields, "conflict"),
        subtitle: optionalValue(fields, "villain"),
      },
      {
        id: "world" as const,
        title: "世界背景",
        value: optionalValue(fields, "world"),
        subtitle: optionalValue(fields, "worldRule"),
      },
    ];
  const active = cards.find((card) => card.id === selected);
  function open(id: (typeof cards)[number]["id"]) {
    const card = cards.find((item) => item.id === id);
    setSelected(id);
    setDraft(card?.value || "");
    setEditing(false);
    setReview(false);
  }
  function accept() {
    if (!selected) return;
    updateProject({
      [selected]: draft
        ? setOptional(draft, "user_defined", "user")
        : blankOptional(),
    });
    setReview(false);
    setEditing(false);
  }
  return (
    <section className="worldWorkspace">
      <header>
        <span>角色與世界</span>
        <h1>{project.title}</h1>
        <p>
          這裡整理正式採用的人物與世界設定。所有欄位都可以保持空白或稍後再設定。
        </p>
      </header>
      <section>
        <h2>主要角色</h2>
        <div className="worldCardGrid">
          {cards.slice(0, 1).map((card) => (
            <button key={card.id} onClick={() => open(card.id)}>
              <span className="characterInitial">
                {card.value?.slice(0, 1) || "角"}
              </span>
              <b>{card.value || "尚未設定主角"}</b>
              <small>{card.subtitle || "目前沒有更多人物資料"}</small>
              <em>查看詳情</em>
            </button>
          ))}
          <button onClick={() => open("protagonist")}>
            <b>新增或補充角色</b>
            <small>不必一次填完</small>
            <em>編輯角色</em>
          </button>
        </div>
      </section>
      <section>
        <h2>故事核心</h2>
        <div className="worldCardGrid">
          {cards.slice(1, 3).map((card) => (
            <button key={card.id} onClick={() => open(card.id)}>
              <b>{card.title}</b>
              <strong>{card.value || "尚未設定"}</strong>
              <small>{card.subtitle || "可保持空白"}</small>
              <em>查看詳情</em>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>世界設定</h2>
        <div className="worldCardGrid">
          {cards.slice(3).map((card) => (
            <button key={card.id} onClick={() => open(card.id)}>
              <b>{card.title}</b>
              <strong>{card.value || "尚未建立世界背景"}</strong>
              <small>{card.subtitle || "現實題材也可以不設定特殊規則"}</small>
              <em>查看詳情</em>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>人物與世界動態</h2>
        <div className="worldEmpty">
          目前沒有已確認的新角色、關係或地點變化。故事發展中出現的新資料，仍會先讓你確認。
        </div>
      </section>
      {active && (
        <div className="worldScrim" onClick={() => setSelected(null)}>
          <aside
            className="worldDetail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="worldDetailTitle"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>{active.title}</small>
                <h2 id="worldDetailTitle">
                  {active.value || `${active.title}尚未設定`}
                </h2>
              </div>
              <button aria-label="關閉詳情" onClick={() => setSelected(null)}>
                關閉
              </button>
            </header>
            {active.id === "protagonist" && (
              <>
                <h3>基本資料</h3>
                <dl>
                  <div>
                    <dt>姓名</dt>
                    <dd>
                      {optionalValue(fields, "protagonist") || "尚未設定"}
                    </dd>
                  </div>
                  <div>
                    <dt>身分</dt>
                    <dd>{optionalValue(fields, "identity") || "尚未設定"}</dd>
                  </div>
                  <div>
                    <dt>目標</dt>
                    <dd>{optionalValue(fields, "goal") || "尚未設定"}</dd>
                  </div>
                  <div>
                    <dt>弱點</dt>
                    <dd>{optionalValue(fields, "weakness") || "尚未設定"}</dd>
                  </div>
                </dl>
                <h3>故事狀態</h3>
                <p>
                  {project.draft
                    ? `最近出現在「${project.chapterTitle}」。`
                    : "目前只有少量角色資料。你可以繼續補充，也可以先保持空白。"}
                </p>
                <h3>人物關係與出場紀錄</h3>
                <p>目前沒有已確認的關係或出場紀錄。</p>
              </>
            )}
            {active.id === "archetype" && (
              <>
                <p>
                  主角原型是選填資料，用來描述常見行動方式與成長方向；不設定也能正常創作。
                </p>
                <p>
                  與目前主角的關聯：
                  {active.value
                    ? `目前採用「${active.value}」作為創作參考。`
                    : "尚未建立關聯。"}
                </p>
              </>
            )}
            {active.id === "conflict" && (
              <>
                <p>
                  {active.value ||
                    "這部作品尚未設定主要衝突；沒有單一主要衝突也可以標記為不適用。"}
                </p>
                <p>相關角色與章節：目前沒有額外確認資料。</p>
              </>
            )}
            {active.id === "world" && (
              <>
                <p>
                  {active.value ||
                    "目前尚未建立世界背景。現實題材也可以不設定特殊世界規則。"}
                </p>
                <dl>
                  <div>
                    <dt>世界規則</dt>
                    <dd>{optionalValue(fields, "worldRule") || "尚未設定"}</dd>
                  </div>
                  <div>
                    <dt>重要勢力</dt>
                    <dd>{optionalValue(fields, "factions") || "尚未設定"}</dd>
                  </div>
                </dl>
              </>
            )}
            {editing && (
              <label>
                修改內容
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="可以保持空白"
                />
              </label>
            )}
            {review && (
              <div className="worldReview">
                <b>變更預覽</b>
                <p>{draft || "保持空白"}</p>
                <span>接受後才會更新正式設定，並保留修改前版本。</span>
              </div>
            )}
            <footer>
              {!editing ? (
                <button onClick={() => setEditing(true)}>編輯</button>
              ) : (
                <button onClick={() => setReview(true)}>查看修改預覽</button>
              )}
              <button
                onClick={() =>
                  void runTask(
                    active.id === "protagonist"
                      ? "protagonist_recommendation"
                      : active.id === "world"
                        ? "world_recommendation"
                        : active.id === "conflict"
                          ? "conflict_recommendation"
                          : "protagonist_recommendation",
                  )
                }
              >
                AI 幫我完善
              </button>
              <button
                onClick={() => {
                  setDraft("");
                  setReview(true);
                }}
              >
                保持空白
              </button>
              <button
                onClick={() => {
                  setDraft("");
                  if (selected)
                    updateProject({
                      [selected]: blankOptional("not_applicable"),
                    });
                  setSelected(null);
                }}
              >
                標記為不適用
              </button>
              {review && (
                <>
                  <button className="gold" onClick={accept}>
                    接受變更
                  </button>
                  <button onClick={() => setReview(false)}>放棄變更</button>
                </>
              )}
            </footer>
          </aside>
        </div>
      )}
    </section>
  );
}

function ChoiceScreen({
  project,
  choices,
  selected,
  setSelected,
  custom,
  setCustom,
  generateChoice,
  result,
  accept,
  discard,
  undo,
  canUndo,
  regenerate,
  regenerationError,
  stats,
  history,
}: {
  project: Project | null;
  choices: Choice[];
  selected: string;
  setSelected: (value: string) => void;
  custom: string;
  setCustom: (value: string) => void;
  generateChoice: (
    choice: string,
    signal?: AbortSignal,
    onProgress?: (event: ClosedAIProgressEvent) => void,
  ) => Promise<void>;
  result: Candidate;
  accept: (content: string) => void;
  discard: () => void;
  undo: () => void;
  canUndo: boolean;
  regenerate: (
    signal?: AbortSignal,
    onProgress?: (event: ClosedAIProgressEvent) => void,
  ) => Promise<void>;
  regenerationError: string;
  stats: Record<string, number>;
  history: StatHistory[];
}) {
  const [loading, setLoading] = useState(false),
    [cancelled, setCancelled] = useState(false),
    [progressEvent, setProgressEvent] = useState<ClosedAIProgressEvent | null>(null),
    [elapsedMs, setElapsedMs] = useState(0),
    [editing, setEditing] = useState(false),
    [edited, setEdited] = useState(""),
    [regenerating, setRegenerating] = useState(false),
    controller = useRef<AbortController | null>(null),
    projectId = project?.id;
  useEffect(() => {
    if (!projectId) return;
    const warmupController = new AbortController();
    void prewarmStudioInteractiveChoiceAI(warmupController.signal);
    return () => warmupController.abort("CHOICE_SCREEN_UNMOUNTED");
  }, [projectId]);
  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(
      () => setElapsedMs((value) => value + 250),
      250,
    );
    return () => clearInterval(timer);
  }, [loading]);
  async function submit(choiceKey = selected, ignoreCustom = false) {
    if (!project) return;
    const option =
        choices.find((choice) => choice.key === choiceKey) || choices[0],
      text = ignoreCustom ? option.text : custom.trim() || option.text;
    controller.current = new AbortController();
    setCancelled(false);
    setLoading(true);
    setProgressEvent(null);
    setElapsedMs(0);
    try {
      await generateChoice(
        text,
        controller.current.signal,
        (event) => setProgressEvent(event),
      );
      setEdited("");
    } finally {
      controller.current = null;
      setLoading(false);
    }
  }
  if (!project)
    return (
      <section className="studioChoice">
        <div className="studioEmpty">
          <b>目前故事資料還不夠</b>
          <p>請先建立作品、補充核心想法，或寫一小段開場。</p>
          <Link href="/studio?screen=create">補充故事想法</Link>
        </div>
      </section>
    );
  const statLabels: Record<string, string> = {
    stamina: "體力",
    money: "金錢",
    affection: "好感度",
    reputation: "聲望",
    experience: "經驗值",
    level: "等級",
    turns: "回合",
    questProgress: "任務進度",
  };
  const progressPercent = Math.max(
    3,
    Math.min(100, progressEvent?.percent ?? 3),
  );
  const progressStage = Math.min(
    choiceProgressSteps.length - 1,
    Math.floor(progressPercent / 25),
  );
  return (
    <section
      className={`studioChoice gameTheme-${project.selectedPlayModeId || "general"}`}
      data-testid="studio-rpg-choice"
    >
      <header>
        <span>互動故事</span>
        <h1>你準備怎麼做？</h1>
        <p>點選一張卡片，再確認你的決定。正式故事只會在你接受後推進。</p>
      </header>
      {project.enabledStats.length > 0 && (
        <aside className="gameDashboard" aria-label="故事數值">
          <header>
            <span className="characterInitial">
              {optionalValue(project.optionalFields, "protagonist").slice(
                0,
                1,
              ) || "角"}
            </span>
            <div>
              <small>
                {optionalValue(project.optionalFields, "protagonist") ||
                  "主角尚未命名"}
              </small>
              <h2>角色狀態</h2>
            </div>
          </header>
          <div>
            {project.enabledStats.map((stat) => (
              <article key={stat}>
                <span>{statLabels[stat] || stat}</span>
                <b>{stats[stat] ?? 0}</b>
                {history.find((entry) => entry.stat === stat) && (
                  <small>
                    最近變化：
                    {history.find((entry) => entry.stat === stat)!.delta >= 0
                      ? "+"
                      : ""}
                    {history.find((entry) => entry.stat === stat)!.delta}
                    <br />
                    {history.find((entry) => entry.stat === stat)!.reason}
                  </small>
                )}
              </article>
            ))}
          </div>
          {history.length > 0 && (
            <details>
              <summary>查看變化紀錄</summary>
              {history.slice(0, 12).map((entry, index) => (
                <p key={`${entry.branchAt}-${index}`}>
                  <b>
                    {entry.label} {entry.before} → {entry.after}
                  </b>
                  <span>{entry.reason}</span>
                </p>
              ))}
            </details>
          )}
        </aside>
      )}
      {!result && !loading && (
        <>
          <div className="choiceCards">
            {choices.map((choice) => (
              <button
                key={choice.key}
                data-testid={`studio-choice-${choice.key}`}
                className={selected === choice.key ? "active" : ""}
                onClick={() => {
                  setSelected(choice.key);
                  setCustom("");
                  void submit(choice.key, true);
                }}
                disabled={loading}
              >
                <b>
                  {choice.key}. {choice.text}
                </b>
                <span>可能影響：{choice.impact}</span>
              </button>
            ))}
          </div>
          <label>
            自己決定
            <input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="輸入你的行動"
            />
          </label>
          <footer>
            <button className="gold" onClick={() => void submit()}>
              確認並查看故事發展
            </button>
            {canUndo && <button onClick={undo}>回到上一個選擇</button>}
          </footer>
        </>
      )}
      {loading && !cancelled && (
        <div className="choiceProgress" role="status">
          <h2>已收到你的選擇</h2>
          <p>
            {custom.trim() ||
              choices.find((choice) => choice.key === selected)?.text}
          </p>
          <div className="choiceProgressMeter">
            <span>{progressEvent?.label ?? "正在喚醒本機模型……"}</span>
            <b>{progressPercent}%</b>
            <progress max="100" value={progressPercent} />
            <small>
              {progressEvent?.generatedCharacters
                ? `已產生 ${progressEvent.generatedCharacters} 字 · `
                : ""}
              已等待 {(elapsedMs / 1_000).toFixed(1)} 秒
            </small>
          </div>
          <ol>
            {choiceProgressSteps.map((step, index) => (
              <li
                className={
                  index < progressStage
                    ? "done"
                    : index === progressStage
                      ? "active"
                      : ""
                }
                key={step}
              >
                {step}
              </li>
            ))}
          </ol>
          <button
            onClick={() => {
              controller.current?.abort();
              setCancelled(true);
              setLoading(false);
            }}
          >
            取消
          </button>
        </div>
      )}
      {regenerationError && (
        <div className="studioAiWarning" role="alert" data-testid="studio-choice-regeneration-error">
          <strong>沒有建立新的故事候選</strong>
          <span>{regenerationError}</span>
        </div>
      )}
      {result && (
        <article className="choiceResult" data-testid="studio-choice-result">
          <section>
            <h2>你選擇了</h2>
            <p>{result.choiceText}</p>
          </section>
          <section>
            <h2>故事發展</h2>
            {editing ? (
              <textarea
                value={edited || result.content}
                onChange={(event) => setEdited(event.target.value)}
              />
            ) : (
              <div className="choiceStory">
                {result.content.split(/\n\s*\n/).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            )}
          </section>
          <section>
            <h2>可能影響</h2>
            <ul>
              {result.impacts?.map((impact) => (
                <li key={impact}>{impact}</li>
              ))}
            </ul>
            {result.statChanges?.map((change) => (
              <div className="statSuggestion" key={change.stat}>
                <b>
                  {change.label} {change.delta >= 0 ? "+" : ""}
                  {change.delta}
                </b>
                <span>原因：{change.reason}</span>
              </div>
            ))}
            {!result.statChanges?.length && (
              <p>這部作品尚未啟用故事數值，因此不會套用任何數值變化。</p>
            )}
          </section>
          <footer>
            <button
              data-testid="studio-choice-accept"
              className="gold"
              onClick={() => accept(edited || result.content)}
            >
              {editing ? "修改後接受" : "接受並繼續"}
            </button>
            <button onClick={() => setEditing(true)}>修改後接受</button>
            <button
              onClick={() => {
                if (regenerating) {
                  controller.current?.abort("USER_CANCELLED");
                  return;
                }
                controller.current = new AbortController();
                setRegenerating(true);
                setProgressEvent(null);
                void regenerate(
                  controller.current.signal,
                  (event) => setProgressEvent(event),
                ).finally(() => {
                  controller.current = null;
                  setRegenerating(false);
                });
              }}
            >
              {regenerating ? "停止重新生成" : "換一個版本"}
            </button>
            {canUndo && <button onClick={undo}>回到上一個選擇</button>}
            <button data-testid="studio-choice-discard" onClick={discard}>暫時不採用</button>
          </footer>
          <p className="localPrivacy">
            {result.externalRequest
              ? "這次使用外接 AI，送出的作品脈絡已離開裝置；候選仍須核准才會寫入正式故事。"
              : "這次使用本機故事系統，內容未送出裝置。"}
          </p>
          <details>
            <summary>查看技術資訊</summary>
            <dl>
              <div>
                <dt>使用中的 AI</dt>
                <dd>
                  {result.model === "local-rule"
                    ? "本機故事規則"
                    : result.model}
                </dd>
              </div>
              <div>
                <dt>執行方式</dt>
                <dd data-testid="studio-choice-actual-executor">{result.actualExecutor ?? result.source}</dd>
              </div>
              <div>
                <dt>是否使用外部網路</dt>
                <dd data-testid="studio-choice-external-request">{result.externalRequest ? "是" : "否"}</dd>
              </div>
              <div>
                <dt>資料離開裝置</dt>
                <dd data-testid="studio-choice-data-left-device">{result.dataLeftDevice ? "是" : "否"}</dd>
              </div>
            </dl>
          </details>
        </article>
      )}
    </section>
  );
}
function BackupCenter({
  project,
  backups,
  autoBackup,
  createBackup,
  importBackup,
  restoreBackup,
  deleteBackup,
  setAutoBackup,
  writable,
}: {
  project: Project | null;
  backups: BackupRecord[];
  autoBackup: StudioState["autoBackup"];
  createBackup: (type: "quick" | "full") => Promise<BackupRecord | null>;
  importBackup: (snapshot: BackupPackage) => Promise<void>;
  restoreBackup: (record: BackupRecord, asCopy: boolean) => Promise<void>;
  deleteBackup: (backupId: string) => Promise<void>;
  setAutoBackup: (value: StudioState["autoBackup"]) => void;
  writable: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [selected, setSelected] = useState<BackupRecord | null>(null),
    [importPreview, setImportPreview] = useState<BackupPackage | null>(null),
    [error, setError] = useState("");
  const download = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type })),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const startBackup = async (type: "quick" | "full") => {
    setBusy(true); setError(""); setMessage("正在整理作品資料……");
    await new Promise((resolve) => setTimeout(resolve, 80));
    setMessage("正在保存章節、角色與世界設定……");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const record = await createBackup(type);
    setSelected(record); setMessage(record ? "備份完成。" : "尚未開啟作品。"); setBusy(false);
  };
  if (!project)
    return <section className="studioEmpty"><b>尚未開啟作品</b><p>載入作品後才能建立備份。</p></section>;
  return <section className="backupCenter">
    <header><span>存檔與備份</span><h1>保護你的作品</h1><p>作品目前主要保存在這個瀏覽器中。建議定期下載備份，避免清除瀏覽器資料後遺失。</p></header>
    {!writable ? <div className="backupError" role="alert" data-testid="backup-read-only-gate">本機正式作品庫目前不可寫入；建立、匯入、還原、刪除與自動備份已停用，但下載匯出仍可使用。</div> : null}
    <div className="backupActions"><button className="gold" disabled={busy || !writable} onClick={() => void startBackup("quick")}>立即快速備份</button><button disabled={busy || !writable} onClick={() => void startBackup("full")}>建立完整備份</button><label className="fileButton" aria-disabled={!writable}>匯入作品備份<input disabled={!writable} type="file" accept="application/json,.json" onChange={async (event) => {setError("");const file=event.target.files?.[0];if(!file)return;try{setImportPreview(coerceBackupPackage(JSON.parse(await file.text())))}catch(reason){setError(`無法讀取備份：${reason instanceof Error?reason.message:"檔案已損壞"}`)}finally{event.target.value=""}}}/></label></div>
    {message && <div className="backupNotice" role="status">{message}</div>}{error && <div className="backupError" role="alert">{error}</div>}
    <section><h2>純文字匯出</h2><div className="backupActions"><button onClick={() => download(`${project.title}.txt`, project.draft, "text/plain;charset=utf-8")}>下載 TXT</button><button onClick={() => download(`${project.title}.md`, `# ${project.title}\n\n## ${project.chapterTitle}\n\n${project.draft}`, "text/markdown;charset=utf-8")}>下載 Markdown</button><button onClick={() => download(`${project.title}.html`, `<!doctype html><meta charset="utf-8"><title>${project.title}</title><h1>${project.title}</h1><h2>${project.chapterTitle}</h2>${project.draft.split("\n").map((line) => `<p>${line.replace(/[&<>]/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[char]||char))}</p>`).join("")}`, "text/html;charset=utf-8")}>下載 HTML</button></div></section>
    <section><h2>自動備份</h2><label>備份時機<select disabled={!writable} value={autoBackup} onChange={(event) => setAutoBackup(event.target.value as StudioState["autoBackup"])}><option value="off">關閉</option><option value="accepted_content">每次正式採用內容後</option><option value="chapter_complete">每完成一章後</option><option value="daily">每日第一次開啟作品時</option></select></label><p>自動備份保存在此瀏覽器；仍建議定期下載備份檔。</p></section>
    <section><h2>最近備份</h2>{backups.length ? <div className="backupList">{backups.map((backup) => <article key={backup.backupId}><div><b>{backup.name}</b><span>{formatTime(backup.createdAt)}・{backup.type === "full" ? "完整備份" : "快速備份"}・{Math.max(1,Math.round(backup.bytes/1024))} KB</span></div><button onClick={() => setSelected(backup)}>查看詳情</button><button onClick={() => download(`${backup.name}.json`,JSON.stringify(backup.formalPayload || backup.snapshot,null,2),"application/json")}>下載</button></article>)}</div> : <div className="worldEmpty">這本作品目前還沒有備份。建立第一份備份，可以避免瀏覽器資料遺失。</div>}</section>
    {importPreview && <div className="backupPreview"><h2>匯入預覽</h2><dl><div><dt>作品名稱</dt><dd>{importPreview.project.title}</dd></div><div><dt>備份日期</dt><dd>{formatTime(importPreview.exportedAt)}</dd></div><div><dt>總字數</dt><dd>{words(importPreview.project.draft)}</dd></div><div><dt>版本／分支</dt><dd>{importPreview.project.versions.length}／{importPreview.branches.length}</dd></div><div><dt>任務／成就</dt><dd>{importPreview.gameState.tasks.length}／{importPreview.gameState.achievements.length}</dd></div><div><dt>成人內容標記</dt><dd>{importPreview.project.adultMode?"有":"無"}</dd></div></dl><button className="gold" disabled={!writable} onClick={() => void importBackup(importPreview).then(() => {setImportPreview(null);setMessage("已匯入為新作品。");}).catch((reason) => setError(`匯入失敗：${reason instanceof Error ? reason.message : "請重試"}`))}>匯入為新作品</button><button onClick={() => setImportPreview(null)}>取消</button></div>}
    {selected && <div className="worldScrim" onClick={() => setSelected(null)}><aside className="worldDetail" role="dialog" aria-modal="true" aria-labelledby="backupTitle" onClick={(event)=>event.stopPropagation()}><header><div><small>備份詳情</small><h2 id="backupTitle">{selected.name}</h2></div><button onClick={() => setSelected(null)}>關閉</button></header><dl><div><dt>建立時間</dt><dd>{formatTime(selected.createdAt)}</dd></div><div><dt>作品名稱</dt><dd>{selected.snapshot.project.title}</dd></div><div><dt>章節數</dt><dd>1</dd></div><div><dt>總字數</dt><dd>{words(selected.snapshot.project.draft)}</dd></div><div><dt>備份大小</dt><dd>{Math.max(1,Math.round(selected.bytes/1024))} KB</dd></div><div><dt>草稿與版本</dt><dd>{selected.type === "full" ? "包含" : "只含目前進度"}</dd></div><div><dt>互動選擇與故事分支</dt><dd>{selected.formalPayload ? `${selected.formalPayload.manifest.recordCounts.acceptedChoices || 0}／${selected.formalPayload.manifest.recordCounts.storyBranches || 0}` : "舊格式未完整記錄"}</dd></div><div><dt>角色與世界資料</dt><dd>包含已確認的消費者設定快照</dd></div><div><dt>閱讀資料</dt><dd>包含閱讀位置、書籤與筆記</dd></div></dl><h3>還原差異摘要</h3><p>目前作品將改回備份時的正文、設定、版本、分支、數值、任務、成就與閱讀進度。系統會先建立一份目前狀態的安全備份。</p><footer><button onClick={() => download(`${selected.name}.json`,JSON.stringify(selected.formalPayload || selected.snapshot,null,2),"application/json")}>下載備份</button><button className="gold" disabled={!writable} onClick={() => void restoreBackup(selected,false).then(() => {setSelected(null);setMessage("已先建立安全備份並完成還原。");}).catch((reason) => setError(`還原失敗：${reason instanceof Error ? reason.message : "請重試"}`))}>安全還原</button><button disabled={!writable} onClick={() => void restoreBackup(selected,true).then(() => {setSelected(null);setMessage("已還原為新副本。");}).catch((reason) => setError(`還原失敗：${reason instanceof Error ? reason.message : "請重試"}`))}>還原成新副本</button><button disabled={!writable} onClick={() => void deleteBackup(selected.backupId).then(() => {setSelected(null);setMessage("備份已刪除。");}).catch((reason) => setError(`刪除失敗：${reason instanceof Error ? reason.message : "請重試"}`))}>刪除備份</button></footer></aside></div>}
  </section>;
}

function StoryDashboard({
  project,
  gameState,
  navigate,
}: {
  project: Project | null;
  gameState: GameState | null;
  navigate: (screen: Screen) => void;
}) {
  const [panel, setPanel] = useState<
    | { kind: "stat"; id: string }
    | { kind: "task"; id: string }
    | { kind: "achievement"; id: string }
    | null
  >(null);
  const labels: Record<string, string> = {
      stamina: "體力",
      money: "金錢",
      affection: "好感度",
      reputation: "聲望",
      experience: "經驗值",
      level: "等級",
      turns: "回合數",
      questProgress: "任務進度",
    },
    ranges: Record<string, string> = {
      stamina: "0 至 100",
      affection: "-100 至 100",
      reputation: "不限",
      experience: "0 以上",
      level: "1 以上",
      turns: "0 以上",
      questProgress: "0% 至 100%",
      money: "依作品設定",
    };
  if (!project || !gameState)
    return (
      <section className="studioEmpty">
        <b>尚未開啟作品</b>
        <p>建立或載入作品後，才能查看故事狀態。</p>
        <button onClick={() => navigate("create")}>建立作品</button>
      </section>
    );
  if (!project.enabledStats.length)
    return (
      <section className="storyDashboard dashboardDisabled">
        <header><span>故事狀態</span><h1>任務、成就與故事數值</h1></header>
        <div className="worldEmpty">
          <b>這本作品尚未啟用故事數值。</b>
          <p>一般小說不需要體力、等級或任務。你可以保持一般小說，或稍後在作品設定中選擇需要的數值。</p>
          <button onClick={() => navigate("create")}>前往玩法設定</button>
          <button onClick={() => navigate("write")}>保持一般小說</button>
        </div>
      </section>
    );
  const selectedStat = panel?.kind === "stat" ? panel.id : "",
    selectedTask = panel?.kind === "task" ? gameState.tasks.find((task) => task.taskId === panel.id) : null,
    selectedAchievement = panel?.kind === "achievement" ? gameState.achievements.find((item) => item.achievementId === panel.id) : null,
    statHistory = selectedStat ? gameState.history.filter((event) => event.stat === selectedStat) : [];
  return (
    <section className="storyDashboard">
      <header><span>故事狀態</span><h1>任務、成就與故事數值</h1><p>只顯示這本作品已啟用並由正式故事事件寫入的內容。</p></header>
      <section><h2>能力值</h2><div className="dashboardStatGrid">
        {project.enabledStats.map((stat) => {
          const latest = gameState.history.find((event) => event.stat === stat);
          return <button key={stat} onClick={() => setPanel({kind:"stat",id:stat})}><small>{labels[stat] || stat}</small><strong>{gameState.stats[stat] ?? 0}{stat === "stamina" ? "／100" : stat === "questProgress" ? "%" : ""}</strong><span>{latest ? `最近 ${latest.delta >= 0 ? "+" : ""}${latest.delta}・${latest.reason}` : "已啟用，尚未發生變化"}</span><em>查看詳情</em></button>;
        })}
      </div></section>
      <section className="dashboardColumns">
        <div><h2>任務</h2>{gameState.tasks.length ? <div className="dashboardList">{gameState.tasks.map((task) => <button key={task.taskId} onClick={() => setPanel({kind:"task",id:task.taskId})}><b>{task.name}</b><span>{task.status === "active" ? "進行中" : task.status === "completed" ? "已完成" : "尚未開始"}・{task.progress}/{task.target}</span><progress max={task.target} value={task.progress}/></button>)}</div> : <div className="worldEmpty">目前還沒有任務。接受與主要衝突相關的故事發展後，任務才會建立。</div>}</div>
        <div><h2>成就</h2>{gameState.achievements.length ? <div className="dashboardList">{gameState.achievements.map((achievement) => <button key={achievement.achievementId} onClick={() => setPanel({kind:"achievement",id:achievement.achievementId})}><b>{achievement.hidden && !achievement.unlocked ? "隱藏成就" : achievement.name}</b><span>{achievement.unlocked ? `已解鎖・${achievement.rarity}` : `進度 ${achievement.progress}%`}</span></button>)}</div> : <div className="worldEmpty">目前還沒有成就。故事繼續發展後，解鎖紀錄會出現在這裡。</div>}</div>
      </section>
      <section><h2>最近變化</h2>{gameState.history.length ? <div className="eventTimeline">{gameState.history.slice(0,20).map((event) => <button key={event.eventId} onClick={() => setPanel({kind:"stat",id:event.stat})}><b>{event.label} {event.delta >= 0 ? "+" : ""}{event.delta}</b><span>{event.reason}・{event.chapterTitle}</span><time>{formatTime(event.createdAt)}</time></button>)}</div> : <div className="worldEmpty"><p>故事繼續發展後，能力變化、任務進度與成就解鎖會出現在這裡。</p><button onClick={() => navigate("choice")}>前往互動故事</button><button onClick={() => navigate("write")}>繼續寫作</button></div>}</section>
      {panel && <div className="worldScrim" onClick={() => setPanel(null)}><aside className="worldDetail dashboardDetail" role="dialog" aria-modal="true" aria-labelledby="dashboardDetailTitle" onClick={(event) => event.stopPropagation()}><header><div><small>故事狀態詳情</small><h2 id="dashboardDetailTitle">{selectedStat ? labels[selectedStat] || selectedStat : selectedTask?.name || selectedAchievement?.name || "目前尚無更多資料"}</h2></div><button onClick={() => setPanel(null)}>關閉</button></header>
        {selectedStat && <><dl><div><dt>目前值</dt><dd>{gameState.stats[selectedStat] ?? 0}</dd></div><div><dt>範圍</dt><dd>{ranges[selectedStat] || "依作品設定"}</dd></div><div><dt>最近變化</dt><dd>{statHistory[0] ? `${statHistory[0].before} → ${statHistory[0].after}` : "尚未發生變化"}</dd></div><div><dt>變化原因</dt><dd>{statHistory[0]?.reason || "目前還沒有相關資料。"}</dd></div><div><dt>來源章節</dt><dd>{statHistory[0]?.chapterTitle || "目前還沒有相關資料。"}</dd></div></dl><h3>歷史紀錄</h3>{statHistory.length ? statHistory.map((event) => <p key={event.eventId}>{formatTime(event.createdAt)}・{event.before} → {event.after}・{event.reason}</p>) : <p>目前尚無更多資料。</p>}</>}
        {selectedTask && <dl><div><dt>任務說明</dt><dd>{selectedTask.description}</dd></div><div><dt>完成條件</dt><dd>{selectedTask.progress}/{selectedTask.target}</dd></div><div><dt>任務狀態</dt><dd>{selectedTask.status === "active" ? "進行中" : selectedTask.status === "completed" ? "已完成" : "尚未開始"}</dd></div><div><dt>可能獎勵</dt><dd>{selectedTask.reward}</dd></div><div><dt>來源章節</dt><dd>{selectedTask.chapterTitle}</dd></div></dl>}
        {selectedAchievement && <dl><div><dt>成就說明</dt><dd>{selectedAchievement.hidden && !selectedAchievement.unlocked ? "隱藏成就" : selectedAchievement.description}</dd></div><div><dt>解鎖條件</dt><dd>{selectedAchievement.hidden && !selectedAchievement.unlocked ? "達成後揭曉" : selectedAchievement.condition}</dd></div><div><dt>目前進度</dt><dd>{selectedAchievement.progress}%</dd></div><div><dt>解鎖狀態</dt><dd>{selectedAchievement.unlocked ? "已解鎖" : "尚未解鎖"}</dd></div><div><dt>獎勵</dt><dd>{selectedAchievement.reward}</dd></div></dl>}
      </aside></div>}
    </section>
  );
}

function LibraryScreen({
  projects,
  open,
}: {
  projects: Project[];
  open: (id: string) => void;
}) {
  return (
    <section className="studioLibrary">
      <header>
        <span>我的作品</span>
        <h1>作品與存檔</h1>
      </header>
      {projects.length ? (
        <div>
          {projects.map((project) => (
            <article key={project.id}>
              <section>
                <h2>{project.title}</h2>
                <p>
                  {project.topicName || "題材尚未設定"}・{words(project.draft)}{" "}
                  字・{formatTime(project.updatedAt)}
                </p>
                <button onClick={() => open(project.id)}>繼續寫作</button>
              </section>
            </article>
          ))}
        </div>
      ) : (
        <div className="studioEmpty">
          <b>尚未建立作品</b>
          <p>作品會保存在目前瀏覽器。</p>
        </div>
      )}
    </section>
  );
}
