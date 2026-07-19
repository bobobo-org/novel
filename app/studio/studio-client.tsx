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
import { WebLocalRuntimeClient } from "@/lib/novel-ai/web/local-runtime-client";

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
type EntryMode = "quick" | "guided" | "explore";
type AssistantStatus =
  | "checking"
  | "ollama_ready"
  | "runtime_ready"
  | "runtime_required"
  | "auth_required";
type OptionalKey =
  | "protagonist"
  | "identity"
  | "archetype"
  | "goal"
  | "weakness"
  | "world"
  | "worldRule"
  | "factions"
  | "conflict"
  | "villain"
  | "style"
  | "storySeed"
  | "outline";
type Wizard = {
  entryMode: EntryMode;
  creationMethod: "" | "topic" | "idea" | "recommend" | "random" | "blank";
  title: string;
  coreIdea: string;
  consumerGroupId: string;
  packId: string;
  topicId: string;
  subCategory: string;
  playModeId: string;
  enabledStats: string[];
  optionalFields: Record<OptionalKey, OptionalField>;
  adultMode: boolean;
  ageConfirmed: boolean;
};
type Project = {
  id: string;
  title: string;
  consumerGroupId: string | null;
  packId: string | null;
  topicId: string | null;
  topicName: string | null;
  subCategory: string | null;
  coreIdea: OptionalField;
  selectedPlayModeId: string | null;
  enabledStats: string[];
  adultMode: boolean;
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
};
type BackupRecord = {
  backupId: string;
  name: string;
  type: "quick" | "full";
  createdAt: string;
  bytes: number;
  snapshot: BackupPackage;
};
type Candidate = {
  task: string;
  title: string;
  content: string;
  source: string;
  model: string;
  usedLocalMemory: boolean;
  externalRequest: boolean;
  proposal?: Partial<Wizard>;
  choiceText?: string;
  impacts?: string[];
  statChanges?: StatChange[];
  createdAt: string;
} | null;
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
const LEGACY_KEYS = ["novel_p11r2_studio_state", "novel_p11_consumer_state"];
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
    consumerGroupId: selection.consumerGroupId,
    packId: selection.packId,
    topicId: selection.topicId,
    topicName: selection.topicName,
    subCategory: String(raw.subCategory || "") || null,
    coreIdea: selection.coreIdea,
    selectedPlayModeId: selection.selectedPlayModeId,
    enabledStats: selection.enabledStats,
    adultMode: raw.adultMode === true,
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
  for (const key of [STORAGE_KEY, ...LEGACY_KEYS])
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
function taskType(task: string) {
  if (task === "continue_story" || task === "first_chapter")
    return "continue_writing";
  if (task === "improve_settings") return "rewrite";
  if (
    task === "plan_chapter" ||
    task === "three_choices" ||
    task.includes("recommend") ||
    task === "idea_directions" ||
    task === "story_seed"
  )
    return "plot_brainstorm";
  return "simple_summary";
}

export default function StudioClient({
  initialScreen,
  initialTask,
  release,
}: {
  initialScreen: string;
  initialTask: string;
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
      useState<AssistantStatus>("checking");
  const project = useMemo(
    () =>
      state.projects.find((item) => item.id === state.activeProjectId) ||
      state.projects[0] ||
      null,
    [state.projects, state.activeProjectId],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setState(migrate());
      setLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, loaded]);
  useEffect(() => {
    if (!loaded || !project || state.autoBackup !== "daily") return;
    const day = new Date().toISOString().slice(0, 10),
      marker = `novel_daily_backup_${project.id}_${day}`;
    if (localStorage.getItem(marker)) return;
    localStorage.setItem(marker, "started");
    const timer = setTimeout(
      () =>
        setState((value) => ({
          ...value,
          backups: [makeBackupRecord(project, "full", value), ...value.backups],
        })),
      0,
    );
    return () => clearTimeout(timer);
  }, [loaded, project, state.autoBackup]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("screen", screen);
    history.replaceState({}, "", url);
  }, [screen]);
  useEffect(() => {
    if (!loaded) return;
    const token =
      sessionStorage.getItem("novel_local_runtime_token") || undefined;
    new WebLocalRuntimeClient({ token, timeoutMs: 2500 })
      .discover()
      .then((snapshot) => {
        setAssistantStatus(
          snapshot.status === "ready"
            ? snapshot.ollamaStatus === "ready"
              ? "ollama_ready"
              : "runtime_ready"
            : snapshot.status === "auth_required"
              ? "auth_required"
              : "runtime_required",
        );
      });
  }, [loaded]);
  useEffect(() => {
    if (initialTask && loaded && project) void runTask(initialTask);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
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
  function navigate(value: Screen) {
    setScreen(value);
    setMenuOpen(false);
  }
  function createProject() {
    const w = state.wizard;
    if (!w.creationMethod) {
      alert("請先選擇一種建立方式，也可以選擇「保持空白」。");
      return;
    }
    if (w.adultMode && !w.ageConfirmed) {
      alert("成人模式需要先完成年齡確認。");
      return;
    }
    const topic = resolveStoryTopic(w.topicId),
      now = new Date().toISOString(),
      id = crypto.randomUUID();
    const next: Project = {
      id,
      title: w.title.trim() || "未命名作品",
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
      optionalFields: w.optionalFields,
      storyLibrarySchemaVersion: STORY_LIBRARY.schemaVersion,
      chapterTitle: "第一章",
      draft: "",
      updatedAt: now,
      versions: [],
    };
    update({
      projects: [next, ...state.projects],
      activeProjectId: id,
      candidate: null,
      gameStates: {
        ...state.gameStates,
        [id]: emptyGameState(next.enabledStats),
      },
      wizard: { ...emptyWizard, optionalFields: emptyOptional() },
      wizardStep: 1,
    });
    navigate("write");
  }
  function saveDraft(title: string, draft: string) {
    if (!project) return;
    setState((value) => ({
      ...value,
      projects: value.projects.map((item) =>
        item.id === project.id
          ? {
              ...item,
              chapterTitle: title,
              draft,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    }));
  }
  function createBackup(type: "quick" | "full") {
    if (!project) return null;
    const record = makeBackupRecord(project, type, state);
    update({ backups: [record, ...state.backups] });
    return record;
  }
  function importBackup(snapshot: BackupPackage) {
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
    setState((value) => ({
      ...value,
      projects: [importedProject, ...value.projects],
      activeProjectId: newId,
      gameStates: {
        ...value.gameStates,
        [newId]: normalizeGameState(snapshot.gameState),
      },
      branches: [...value.branches, ...importedBranches],
      candidate: null,
    }));
  }
  function restoreBackup(record: BackupRecord, asCopy: boolean) {
    if (!project) return;
    if (asCopy) {
      importBackup(record.snapshot);
      return;
    }
    const safety = makeBackupRecord(project, "full", state),
      restored = { ...record.snapshot.project, id: project.id, updatedAt: new Date().toISOString() };
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
  function deleteBackup(backupId: string) {
    update({ backups: state.backups.filter((backup) => backup.backupId !== backupId) });
  }
  function updateProjectOptional(
    changes: Partial<Record<OptionalKey, OptionalField>>,
  ) {
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
  function completeChapter() {
    if (!project) return;
    const completedAt = new Date().toISOString(),
      old = {
        at: completedAt,
        title: "完成章節前",
        content: project.draft,
      };
    setState((value) => {
      const projects = value.projects.map((item) =>
          item.id === project.id
            ? {
                ...item,
                updatedAt: completedAt,
                versions: [old, ...item.versions],
              }
            : item,
        ),
        nextState = { ...value, projects },
        nextProject = projects.find((item) => item.id === project.id)!,
        chapterBackup =
          value.autoBackup === "chapter_complete"
            ? [makeBackupRecord(nextProject, "full", nextState)]
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
  }
  function contextFor(task: string) {
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
      recentText: project?.draft.slice(-1600) || null,
      instruction:
        "只提出候選，不得假設空白欄位已設定；若輸出推薦或三選一，請使用簡潔 JSON。",
    });
  }
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
  async function runTask(task: string) {
    const started = performance.now();
    let candidate: Candidate;
    try {
      const token =
          sessionStorage.getItem("novel_local_runtime_token") || undefined,
        client = new WebLocalRuntimeClient({
          token,
          timeoutMs: 45000,
          externalFallbackAllowed: false,
        }),
        snapshot = await client.discover();
      if (snapshot.status !== "ready") throw new Error(snapshot.status);
      const result = await client.runTask({
        projectId: project?.id || "draft-project",
        taskType: taskType(task),
        input: contextFor(task),
        targetLength:
          task === "first_chapter"
            ? 1600
            : task === "continue_story"
              ? 900
              : 700,
      });
      candidate = {
        task,
        title:
          assistantTasks.find((item) => item[0] === task)?.[1] || "故事建議",
        content: result.content,
        source: result.provider === "ollama" ? "本機 AI" : "本機創作服務",
        model: result.model,
        usedLocalMemory: Boolean(project),
        externalRequest: Boolean(result.dataLeftDevice),
        createdAt: new Date().toISOString(),
      };
      setAssistantStatus(
        result.provider === "ollama" ? "ollama_ready" : "runtime_ready",
      );
    } catch {
      candidate = ruleCandidate(task);
      setAssistantStatus((current) =>
        current === "auth_required" ? current : "runtime_required",
      );
    }
    const elapsedMs = Math.round(performance.now() - started),
      status: ExecutionLog["status"] =
        candidate?.model === "local-rule" ? "fallback" : "completed";
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
    if (screen !== "write") navigate("write");
  }
  function acceptCandidate(editedContent?: string) {
    if (!project || !state.candidate) return;
    const old = {
        at: new Date().toISOString(),
        title: project.chapterTitle,
        content: project.draft,
      },
      content = editedContent ?? state.candidate.content;
    setState((value) => {
      const projects = value.projects.map((item) =>
        item.id === project.id
          ? {
              ...item,
              draft:
                `${item.draft}${item.draft ? "\n\n" : ""}${content}`.trim(),
              updatedAt: new Date().toISOString(),
              versions: [old, ...item.versions],
            }
          : item,
      ), nextState = { ...value, candidate: null, projects },
        nextProject = projects.find((item) => item.id === project.id)!;
      return value.autoBackup === "accepted_content"
        ? { ...nextState, backups: [makeBackupRecord(nextProject, "full", nextState), ...value.backups] }
        : nextState;
    });
  }
  function acceptWizardSuggestion(content: string) {
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
  ) {
    if (!project) return;
    const fields = project.optionalFields,
      name = optionalValue(fields, "protagonist"),
      conflict = optionalValue(fields, "conflict"),
      world = optionalValue(fields, "world"),
      hasStory = Boolean(
        project.draft.trim() || name || conflict || project.coreIdea.value,
      );
    if (!hasStory) {
      if (!signal?.aborted)
        setState((value) => ({
          ...value,
          candidate: {
            task: "branch_choice",
            title: "故事資料不足",
            content:
              "目前故事資料還不夠，請先建立主角、核心想法，或寫一小段開場。",
            source: "本機故事建議",
            model: "local-rule",
            usedLocalMemory: false,
            externalRequest: false,
            choiceText,
            impacts: [],
            statChanges: [],
            createdAt: new Date().toISOString(),
          },
        }));
      return;
    }
    const protagonist = name || "主角",
      scene = world || "目前場景",
      activeConflict = conflict || "尚未解決的問題";
    let content = `${protagonist}依照「${choiceText}」採取行動。\n\n在${scene}裡，這個決定立刻改變了局勢：${activeConflict}不再只是等待處理的問題，而成為必須正面承擔的後果。${protagonist}從對方的反應中察覺一個新的細節，也因此確定下一步不能照原來的方式進行。`,
      source = "本機故事建議",
      model = "local-rule";
    try {
      const token =
          sessionStorage.getItem("novel_local_runtime_token") || undefined,
        client = new WebLocalRuntimeClient({
          token,
          timeoutMs: 45000,
          externalFallbackAllowed: false,
        }),
        snapshot = await client.discover();
      if (snapshot.status === "ready") {
        const result = await client.runTask({
          projectId: project.id,
          taskType: "continue_writing",
          input: JSON.stringify({
            instruction:
              "請使用繁體中文，根據作品資料與作者選擇產生兩到四段具體後續劇情。不得輸出工程說明或英文模板。",
            selectedAction: choiceText,
            protagonist,
            conflict: activeConflict,
            scene,
            worldRule: optionalValue(fields, "worldRule") || null,
            recentText: project.draft.slice(-1200),
            branchNumber:
              state.branches.filter((branch) => branch.projectId === project.id)
                .length + 1,
          }),
          targetLength: 650,
        });
        if (/[\u4e00-\u9fff]{20}/.test(result.content)) {
          content = result.content;
          source =
            result.provider === "ollama" ? "本機 AI 劇情發展" : "本機創作服務";
          model = result.model;
        }
      }
    } catch {}
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
        : [];
    setState((value) => ({
      ...value,
      candidate: {
        task: "branch_choice",
        title: "故事發展",
        content,
        source,
        model,
        usedLocalMemory: true,
        externalRequest: false,
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
  function acceptChoiceResult(content: string) {
    if (!project || !state.candidate?.choiceText) return;
    const candidate = state.candidate,
      currentGame = state.gameStates[project.id] || emptyGameState(),
      old = {
        at: new Date().toISOString(),
        title: project.chapterTitle,
        content: project.draft,
      },
      nextStats = { ...currentGame.stats },
      branchAt = new Date().toISOString(),
      eventId = crypto.randomUUID(),
      conflict = optionalValue(project.optionalFields, "conflict"),
      existingTask = currentGame.tasks.find(
        (task) => task.status === "active" && task.name === conflict,
      ),
      nextTasks = conflict
        ? existingTask
          ? currentGame.tasks.map((task) =>
              task.taskId === existingTask.taskId
                ? {
                    ...task,
                    progress: Math.min(task.target, task.progress + 20),
                    status: task.progress + 20 >= task.target ? "completed" as const : task.status,
                    completedAt: task.progress + 20 >= task.target ? branchAt : null,
                  }
                : task,
            )
          : [
              {
                taskId: crypto.randomUUID(),
                name: conflict,
                description: `依照已接受的故事選擇，處理「${conflict}」。`,
                status: "active" as const,
                progress: 20,
                target: 100,
                reward: "推進主線並取得新的故事線索",
                sourceEventId: eventId,
                chapterTitle: project.chapterTitle,
                branchAt,
                versionAt: old.at,
                createdAt: branchAt,
                completedAt: null,
              },
              ...currentGame.tasks,
            ]
        : currentGame.tasks,
      hasFirstChoice = currentGame.achievements.some(
        (achievement) => achievement.achievementId === "first-story-choice",
      ),
      nextAchievements = hasFirstChoice
        ? currentGame.achievements
        : [
            {
              achievementId: "first-story-choice",
              name: "故事由你決定",
              description: "完成第一次互動故事選擇。",
              condition: "接受一份互動故事發展",
              progress: 100,
              unlocked: true,
              unlockedAt: branchAt,
              rarity: "一般" as const,
              reward: "解鎖故事分支紀錄",
              hidden: false,
              sourceEventId: eventId,
            },
            ...currentGame.achievements,
          ];
    for (const change of candidate.statChanges || [])
      nextStats[change.stat] = change.after;
    setState((value) => {
      const nextGameState: GameState = {
          stats: nextStats,
          history: [
            ...(candidate.statChanges || []).map((change) => ({
              ...change,
              projectId: project.id,
              branchAt,
              event: candidate.choiceText || "故事選擇",
              eventId,
              sourceType: "player_choice" as const,
              chapterTitle: project.chapterTitle,
              versionAt: old.at,
              createdAt: branchAt,
            })),
            ...(value.gameStates[project.id]?.history || []),
          ],
          tasks: nextTasks,
          achievements: nextAchievements,
        },
        projects = value.projects.map((item) =>
          item.id === project.id
            ? {
                ...item,
                draft:
                  `${item.draft}${item.draft ? "\n\n" : ""}${content}`.trim(),
                updatedAt: new Date().toISOString(),
                versions: [old, ...item.versions],
              }
            : item,
        ),
        nextState: StudioState = {
          ...value,
          candidate: null,
          gameStates: { ...value.gameStates, [project.id]: nextGameState },
          branches: [
            ...value.branches,
            {
              projectId: project.id,
              choice: candidate.choiceText || "",
              gameState: JSON.parse(JSON.stringify(currentGame)) as GameState,
              draft: project.draft,
              versionsLength: project.versions.length,
              at: branchAt,
            },
          ],
          projects,
        },
        nextProject = projects.find((item) => item.id === project.id)!;
      return value.autoBackup === "accepted_content"
        ? {
            ...nextState,
            backups: [
              makeBackupRecord(nextProject, "full", nextState),
              ...value.backups,
            ],
          }
        : nextState;
    });
  }
  function undoBranch() {
    if (!project) return;
    const index = state.branches
      .map((branch) => branch.projectId)
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
  const navItems: Array<[Screen, string]> = [
    ["home", "首頁"],
    ["create", "開始創作"],
    ["write", "繼續寫作"],
    ["world", "角色與世界"],
    ["dashboard", "任務與成就"],
    ["backup", "存檔與備份"],
    ["library", "我的作品"],
    ["inspect", "檢查作品"],
    ["choice", "互動故事"],
  ];
  return (
    <div
      className="studioShell"
      data-consumer-release={release.consumerRelease}
      data-app-commit={release.appCommit}
      data-story-library={STORY_LIBRARY.schemaVersion}
    >
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
        <Link className="studioCreate" href="/studio/create">
          ＋ 建立新作品
        </Link>
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
        <Link className="studioProfessional" href="/professional">
          專業工具
        </Link>
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
            <button onClick={() => navigate("choice")}>互動故事</button>
          </nav>
          <span>
            {assistantStatus === "ollama_ready"
              ? "本機 AI 已連線"
              : assistantStatus === "runtime_ready"
                ? "本機創作服務已連線"
                : assistantStatus === "auth_required"
                  ? "本機服務需要授權"
                  : "本機故事功能可用"}
          </span>
        </header>
        <main className="studioContent">
          {screen === "home" && (
            <HomeScreen project={project} navigate={navigate} />
          )}{" "}
          {screen === "create" && (
            <CreateScreen
              state={state}
              updateWizard={updateWizard}
              setOptionalField={setOptionalField}
              setStep={(step) => update({ wizardStep: step })}
              createProject={createProject}
              runTask={runTask}
              candidate={state.candidate}
              acceptSuggestion={acceptWizardSuggestion}
              discard={() => update({ candidate: null })}
            />
          )}{" "}
          {(screen === "write" || screen === "inspect") && (
            <WriteScreen
              key={project?.id || "empty"}
              project={project}
              candidate={
                state.candidate?.task === "branch_choice"
                  ? null
                  : state.candidate
              }
              navigate={navigate}
              saveDraft={saveDraft}
              runTask={runTask}
              completeChapter={completeChapter}
              acceptCandidate={acceptCandidate}
              discard={() => update({ candidate: null })}
              assistantStatus={assistantStatus}
            />
          )}{" "}
          {screen === "world" && (
            <WorldScreen
              project={project}
              updateProject={updateProjectOptional}
              runTask={runTask}
            />
          )}{" "}
          {screen === "choice" && (
            <ChoiceScreen
              project={project}
              choices={choices()}
              selected={selectedChoice}
              setSelected={setSelectedChoice}
              custom={customChoice}
              setCustom={setCustomChoice}
              generateChoice={generateChoiceResult}
              result={
                state.candidate?.task === "branch_choice"
                  ? state.candidate
                  : null
              }
              accept={acceptChoiceResult}
              discard={() => update({ candidate: null })}
              undo={undoBranch}
              canUndo={state.branches.some(
                (branch) => branch.projectId === project?.id,
              )}
              regenerate={() =>
                void generateChoiceResult(
                  state.candidate?.choiceText ||
                    customChoice ||
                    choices().find((choice) => choice.key === selectedChoice)
                      ?.text ||
                    "",
                )
              }
              stats={project ? state.gameStates[project.id]?.stats || {} : {}}
              history={
                project ? state.gameStates[project.id]?.history || [] : []
              }
            />
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
}: {
  project: Project | null;
  navigate: (screen: Screen) => void;
}) {
  return (
    <section className="studioHome">
      <div className="studioWelcome">
        <div>
          <span>完整故事庫已連線</span>
          <h1>從一個想法開始，也可以先保持空白</h1>
          <p>
            {STORY_LIBRARY.packs.length} 個分類包・
            {STORY_LIBRARY.topics.filter((topic) => topic.classic).length}{" "}
            類經典題材・設定可稍後逐步補充
          </p>
        </div>
        <div>
          <Link className="gold studioLinkButton" href="/studio/create">
            建立新作品
          </Link>
          <button onClick={() => navigate("write")}>繼續最近作品</button>
          <button onClick={() => navigate("library")}>我的作品</button>
        </div>
      </div>
      <h2>最近作品</h2>
      {project ? (
        <article className="studioRecent">
          <section>
            <small>{project.topicName || "題材尚未設定"}</small>
            <h3>{project.title}</h3>
            <p>
              {project.chapterTitle}・{words(project.draft)} 字・
              {formatTime(project.updatedAt)}
            </p>
            <div className="recentActions">
              <button onClick={() => navigate("write")}>繼續創作</button>
              <Link href={`/studio/read/${project.id}`}>閱讀作品</Link>
              {project.selectedPlayModeId &&
                project.selectedPlayModeId !== "general" && (
                  <button onClick={() => navigate("choice")}>進入故事</button>
                )}
            </div>
          </section>
        </article>
      ) : (
        <div className="studioEmpty">
          <b>尚未建立作品</b>
          <p>不用先填完整設定，邊寫邊補也可以。</p>
          <button onClick={() => navigate("create")}>建立第一部小說</button>
        </div>
      )}
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
  runTask: (task: string) => Promise<void>;
  candidate: Candidate;
  acceptSuggestion: (content: string) => void;
  discard: () => void;
}) {
  const w = state.wizard,
    step = state.wizardStep;
  const topics = listStoryTopics({
    groupId: w.consumerGroupId || undefined,
    packId: w.packId || undefined,
    includeAdult: w.adultMode,
    ageConfirmed: w.ageConfirmed,
    limit: w.entryMode === "explore" ? 218 : 12,
  });
  const selectedTopic = resolveStoryTopic(w.topicId);
  const optionalInput = (key: OptionalKey) => (
    <div className="optionalField" key={key}>
      <label>
        {optionalLabels[key]} <small>選填</small>
        <input
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
  return (
    <section className="studioWizard">
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
        <p>第 {step} 步，共 5 步・除建立方式外皆可略過</p>
      </header>
      <div className="studioSteps">
        {[1, 2, 3, 4, 5].map((index) => (
          <i className={index <= step ? "done" : ""} key={index} />
        ))}
      </div>
      <div className="studioWizardBody">
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
            <h2>
              故事玩法 <small>選填</small>
            </h2>
            <div className="studioGenreGrid">
              {STORY_LIBRARY.playModes
                .filter((mode) => !mode.adultOnly || w.adultMode)
                .map((mode) => (
                  <button
                    key={mode.playModeId}
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
            </dl>
            <p>
              空白欄位會原樣保存，不會被填入假值。稍後可在故事發展中逐步補充。
            </p>
            {candidate && (
              <SuggestionCard
                key={candidate.createdAt}
                candidate={candidate}
                accept={acceptSuggestion}
                retry={() => void runTask(candidate.task)}
                discard={discard}
              />
            )}
          </>
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
          <>
          <button onClick={() => setStep(Math.min(5, step + 1))}>
            略過這一步
          </button>
            <button className="gold" onClick={() => setStep(Math.min(5, step + 1))}>
              下一步
            </button>
          </>
        ) : (
          <button className="gold" onClick={createProject}>
            建立作品
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
  saveDraft,
  runTask,
  completeChapter,
  acceptCandidate,
  discard,
  assistantStatus,
}: {
  project: Project | null;
  candidate: Candidate;
  navigate: (screen: Screen) => void;
  saveDraft: (title: string, draft: string) => void;
  runTask: (task: string) => Promise<void>;
  completeChapter: () => void;
  acceptCandidate: (content?: string) => void;
  discard: () => void;
  assistantStatus: AssistantStatus;
}) {
  const [title, setTitle] = useState(project?.chapterTitle || "第一章"),
    [draft, setDraft] = useState(project?.draft || ""),
    [focus, setFocus] = useState(false),
    [helperOpen, setHelperOpen] = useState(false);
  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(() => saveDraft(title, draft), 1000);
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
    <section className={`studioWriting ${focus ? "focusMode" : ""}`}>
      {!focus && (
        <aside>
          <h2>{project.title}</h2>
          <p>{project.topicName || "題材尚未設定"}</p>
          <nav>
            <Link href={`/studio/read/${project.id}`}>閱讀作品</Link>
            <button onClick={() => navigate("library")}>章節列表</button>
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
          <span>已啟用自動保存</span>
        </header>
        <textarea
          aria-label="正文編輯器"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
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
            <Link href={`/studio/read/${project.id}`}>閱讀作品</Link>
            <button onClick={completeChapter}>完成章節</button>
            <button className="gold" onClick={() => saveDraft(title, draft)}>
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
                ? "本機 AI 已連線"
                : assistantStatus === "runtime_ready"
                  ? "本機創作服務已連線"
                  : "本機模型未連線，仍可使用本機故事建議"}
            </h2>
          </header>
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
              <button key={id} onClick={() => void runTask(id)}>
                <b>{label}</b>
                <span>先提供建議，由你決定是否加入</span>
              </button>
            ))}
          </div>
          {candidate && (
            <SuggestionCard
              key={candidate.createdAt}
              candidate={candidate}
              accept={acceptCandidate}
              retry={() => void runTask(candidate.task)}
              discard={discard}
            />
          )}
        </aside>
      )}
    </section>
  );
}

function SuggestionCard({
  candidate,
  accept,
  retry,
  discard,
}: {
  candidate: NonNullable<Candidate>;
  accept: (content: string) => void;
  retry: () => void;
  discard: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [content, setContent] = useState(candidate.content);
  return (
    <article className="studioCandidate">
      <header>
        <b>
          {candidate.model === "local-rule" ? "本機故事建議" : "本機 AI 建議"}
        </b>
        <span>這份內容還沒有加入正式故事</span>
      </header>
      <p>
        根據你目前的故事設定，我整理出以下建議。你可以直接採用、修改後採用，或暫時不使用。
      </p>
      {editing ? (
        <textarea
          aria-label="修改故事建議"
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      ) : (
        <pre>{content}</pre>
      )}
      <footer>
        <button className="gold" onClick={() => accept(content)}>
          {editing ? "修改後採用" : "採用這份建議"}
        </button>
        <button onClick={() => setEditing(true)}>修改後採用</button>
        <button onClick={retry}>再產生一份</button>
        <button onClick={discard}>保持空白</button>
        <button onClick={discard}>暫時不用</button>
      </footer>
      <details>
        <summary>查看技術資訊</summary>
        <dl>
          <div>
            <dt>使用中的 AI</dt>
            <dd>
              {candidate.model === "local-rule"
                ? "本機故事規則"
                : candidate.model}
            </dd>
          </div>
          <div>
            <dt>執行方式</dt>
            <dd>{candidate.source}</dd>
          </div>
          <div>
            <dt>是否使用外部網路</dt>
            <dd>{candidate.externalRequest ? "是" : "否"}</dd>
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
  runTask: (task: string) => Promise<void>;
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
  stats,
  history,
}: {
  project: Project | null;
  choices: Choice[];
  selected: string;
  setSelected: (value: string) => void;
  custom: string;
  setCustom: (value: string) => void;
  generateChoice: (choice: string, signal?: AbortSignal) => Promise<void>;
  result: Candidate;
  accept: (content: string) => void;
  discard: () => void;
  undo: () => void;
  canUndo: boolean;
  regenerate: () => void;
  stats: Record<string, number>;
  history: StatHistory[];
}) {
  const [loading, setLoading] = useState(false),
    [cancelled, setCancelled] = useState(false),
    [progress, setProgress] = useState(0),
    [editing, setEditing] = useState(false),
    [edited, setEdited] = useState(""),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(
      () =>
        setProgress((value) =>
          Math.min(choiceProgressSteps.length - 1, value + 1),
        ),
      650,
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
    setProgress(0);
    await generateChoice(text, controller.current.signal);
    setLoading(false);
    setEdited("");
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
  return (
    <section
      className={`studioChoice gameTheme-${project.selectedPlayModeId || "general"}`}
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
          <h2>已選擇的行動</h2>
          <p>
            {custom.trim() ||
              choices.find((choice) => choice.key === selected)?.text}
          </p>
          <ol>
            {choiceProgressSteps.map((step, index) => (
              <li
                className={
                  index < progress ? "done" : index === progress ? "active" : ""
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
      {result && (
        <article className="choiceResult">
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
              className="gold"
              onClick={() => accept(edited || result.content)}
            >
              {editing ? "修改後接受" : "接受並繼續"}
            </button>
            <button onClick={() => setEditing(true)}>修改後接受</button>
            <button onClick={regenerate}>再生成一次</button>
            {canUndo && <button onClick={undo}>回到上一個選擇</button>}
            <button onClick={discard}>暫時不採用</button>
          </footer>
          <p className="localPrivacy">這次使用本機故事系統，內容未送出裝置。</p>
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
                <dd>{result.source}</dd>
              </div>
              <div>
                <dt>是否使用外部網路</dt>
                <dd>{result.externalRequest ? "是" : "否"}</dd>
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
}: {
  project: Project | null;
  backups: BackupRecord[];
  autoBackup: StudioState["autoBackup"];
  createBackup: (type: "quick" | "full") => BackupRecord | null;
  importBackup: (snapshot: BackupPackage) => void;
  restoreBackup: (record: BackupRecord, asCopy: boolean) => void;
  deleteBackup: (backupId: string) => void;
  setAutoBackup: (value: StudioState["autoBackup"]) => void;
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
    const record = createBackup(type);
    setSelected(record); setMessage(record ? "備份完成。" : "尚未開啟作品。"); setBusy(false);
  };
  if (!project)
    return <section className="studioEmpty"><b>尚未開啟作品</b><p>載入作品後才能建立備份。</p></section>;
  return <section className="backupCenter">
    <header><span>存檔與備份</span><h1>保護你的作品</h1><p>作品目前主要保存在這個瀏覽器中。建議定期下載備份，避免清除瀏覽器資料後遺失。</p></header>
    <div className="backupActions"><button className="gold" disabled={busy} onClick={() => void startBackup("quick")}>立即快速備份</button><button disabled={busy} onClick={() => void startBackup("full")}>建立完整備份</button><label className="fileButton">匯入作品備份<input type="file" accept="application/json,.json" onChange={async (event) => {setError("");const file=event.target.files?.[0];if(!file)return;try{setImportPreview(coerceBackupPackage(JSON.parse(await file.text())))}catch(reason){setError(`無法讀取備份：${reason instanceof Error?reason.message:"檔案已損壞"}`)}finally{event.target.value=""}}}/></label></div>
    {message && <div className="backupNotice" role="status">{message}</div>}{error && <div className="backupError" role="alert">{error}</div>}
    <section><h2>純文字匯出</h2><div className="backupActions"><button onClick={() => download(`${project.title}.txt`, project.draft, "text/plain;charset=utf-8")}>下載 TXT</button><button onClick={() => download(`${project.title}.md`, `# ${project.title}\n\n## ${project.chapterTitle}\n\n${project.draft}`, "text/markdown;charset=utf-8")}>下載 Markdown</button><button onClick={() => download(`${project.title}.html`, `<!doctype html><meta charset="utf-8"><title>${project.title}</title><h1>${project.title}</h1><h2>${project.chapterTitle}</h2>${project.draft.split("\n").map((line) => `<p>${line.replace(/[&<>]/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[char]||char))}</p>`).join("")}`, "text/html;charset=utf-8")}>下載 HTML</button></div></section>
    <section><h2>自動備份</h2><label>備份時機<select value={autoBackup} onChange={(event) => setAutoBackup(event.target.value as StudioState["autoBackup"])}><option value="off">關閉</option><option value="accepted_content">每次正式採用內容後</option><option value="chapter_complete">每完成一章後</option><option value="daily">每日第一次開啟作品時</option></select></label><p>自動備份保存在此瀏覽器；仍建議定期下載備份檔。</p></section>
    <section><h2>最近備份</h2>{backups.length ? <div className="backupList">{backups.map((backup) => <article key={backup.backupId}><div><b>{backup.name}</b><span>{formatTime(backup.createdAt)}・{backup.type === "full" ? "完整備份" : "快速備份"}・{Math.max(1,Math.round(backup.bytes/1024))} KB</span></div><button onClick={() => setSelected(backup)}>查看詳情</button><button onClick={() => download(`${backup.name}.json`,JSON.stringify(backup.snapshot,null,2),"application/json")}>下載</button></article>)}</div> : <div className="worldEmpty">這本作品目前還沒有備份。建立第一份備份，可以避免瀏覽器資料遺失。</div>}</section>
    {importPreview && <div className="backupPreview"><h2>匯入預覽</h2><dl><div><dt>作品名稱</dt><dd>{importPreview.project.title}</dd></div><div><dt>備份日期</dt><dd>{formatTime(importPreview.exportedAt)}</dd></div><div><dt>總字數</dt><dd>{words(importPreview.project.draft)}</dd></div><div><dt>版本／分支</dt><dd>{importPreview.project.versions.length}／{importPreview.branches.length}</dd></div><div><dt>任務／成就</dt><dd>{importPreview.gameState.tasks.length}／{importPreview.gameState.achievements.length}</dd></div><div><dt>成人內容標記</dt><dd>{importPreview.project.adultMode?"有":"無"}</dd></div></dl><button className="gold" onClick={() => {importBackup(importPreview);setImportPreview(null);setMessage("已匯入為新作品。")}}>匯入為新作品</button><button onClick={() => setImportPreview(null)}>取消</button></div>}
    {selected && <div className="worldScrim" onClick={() => setSelected(null)}><aside className="worldDetail" role="dialog" aria-modal="true" aria-labelledby="backupTitle" onClick={(event)=>event.stopPropagation()}><header><div><small>備份詳情</small><h2 id="backupTitle">{selected.name}</h2></div><button onClick={() => setSelected(null)}>關閉</button></header><dl><div><dt>建立時間</dt><dd>{formatTime(selected.createdAt)}</dd></div><div><dt>作品名稱</dt><dd>{selected.snapshot.project.title}</dd></div><div><dt>章節數</dt><dd>1</dd></div><div><dt>總字數</dt><dd>{words(selected.snapshot.project.draft)}</dd></div><div><dt>備份大小</dt><dd>{Math.max(1,Math.round(selected.bytes/1024))} KB</dd></div><div><dt>草稿與版本</dt><dd>{selected.type === "full" ? "包含" : "只含目前進度"}</dd></div><div><dt>角色與世界資料</dt><dd>包含已確認的消費者設定快照</dd></div><div><dt>閱讀資料</dt><dd>包含閱讀位置、書籤與筆記</dd></div></dl><h3>還原差異摘要</h3><p>目前作品將改回備份時的正文、設定、版本、分支、數值、任務、成就與閱讀進度。系統會先建立一份目前狀態的安全備份。</p><footer><button onClick={() => download(`${selected.name}.json`,JSON.stringify(selected.snapshot,null,2),"application/json")}>下載備份</button><button className="gold" onClick={() => {restoreBackup(selected,false);setSelected(null);setMessage("已先建立安全備份並完成還原。")}}>安全還原</button><button onClick={() => {restoreBackup(selected,true);setSelected(null);setMessage("已還原為新副本。")}}>還原成新副本</button><button onClick={() => {deleteBackup(selected.backupId);setSelected(null);setMessage("備份已刪除。")}}>刪除備份</button></footer></aside></div>}
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
