"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  makeRecord,
  optionalValue,
  type AcceptedChoice,
  type Chapter,
  type Character,
  type CharacterRelationship,
  type LoreEntry,
  type NovelProject,
  type RpgTurnReceipt,
  type StoryBible,
  type StoryChoiceEffect,
  type StoryState,
  type TimelineEvent,
  type World,
  type WorldRule,
} from "@/lib/novel-ai/domain";
import { activeStoryWorlds } from "@/lib/novel-ai/domain/active-story-context";
import { resolveProjectStoryBible } from "@/lib/novel-ai/domain/story-bible-selection";
import { suggestedCharacterPortrait } from "@/lib/novel-ai/character-portraits/assignment";
import {
  RPG_CHARACTER_LIBRARY_STORAGE_KEY,
  createRpgCharacterTemplate,
  mergeCharacterLibrary,
  parseRpgCharacterLibrary,
  type RpgCharacterTemplate,
} from "@/lib/novel-ai/game/character-library";
import {
  CHARACTER_RPG_ARCHETYPES,
  characterRpgStatsForArchetype,
  createCharacterRpgProfile,
} from "@/lib/novel-ai/game/character-rpg-profile";
import CharacterPortraitImage from "../character-portrait";
import { applyStoryChoiceEffect } from "@/lib/novel-ai/game/effects";
import {
  initialProceduralPillResources,
} from "@/lib/novel-ai/game/procedural-pill-engine";
import {
  PROCEDURAL_CHARACTER_CAPACITY,
  PROCEDURAL_TREASURE_CAPACITY,
  proceduralCharacterAt,
  proceduralTreasureAt,
  type ProceduralCharacterCandidate,
} from "@/lib/novel-ai/game/procedural-story-library";
import {
  DEFAULT_RPG_RULE_SETTINGS,
  RPG_FREE_WORLD_ACTIVITIES,
  RPG_FORMULA_VERSION,
  RPG_ITEM_CATALOG,
  RPG_MODE_DEFINITIONS,
  RPG_STAT_DEFINITIONS,
  initialRpgResources,
  initialRpgStats,
  normalizeRpgRuleSettings,
  readRpgProgression,
  rpgFormulaExplanation,
  statLabel,
  type RpgChoice,
  type RpgChoiceResolution,
  type RpgMode,
  type RpgProgressionSnapshot,
  type RpgRuleSettings,
  type RpgStatKey,
} from "@/lib/novel-ai/game/progression/rpg-progression";
import {
  XIANXIA_RULE_KIND_OPTIONS,
  generateXianxiaRuleCandidate,
  type XianxiaRuleCandidate,
  type XianxiaRuleKind,
} from "@/lib/novel-ai/game/xianxia-procedural-rule-packs";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  createSovereignLearningRepository,
  ingestSharedLearningSnapshot,
  type SharedLearningSnapshot,
} from "@/lib/novel-ai/sovereign-learning";
import {
  STORY_PLAY_MODE_LABELS,
  resolveStoryPlayMode,
  type StoryPlayModeId,
} from "@/lib/novel-ai/domain/play-mode";
import {
  prewarmStudioInteractiveChoiceAI,
} from "@/lib/novel-ai/web/studio-closed-ai";
import {
  prewarmStudioProjectAIState,
  rejectStudioClosedAgentCandidate,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import {
  approveRpgChatTurn,
  buildRpgRuleChoicePlan,
  buildRpgChatCustomAction,
  generateRpgChatTurnCandidate,
  loadRpgChatSnapshot,
  planRpgChatChoices,
  RPG_CHAT_FALLBACK_REPAIR_RETRY_TIMEOUT_MS,
  RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS,
  RPG_CHAT_STORY_AI_TIMEOUT_MS,
  type RpgChatChoicePlan,
  type RpgChatSnapshot,
  type RpgChatTurnCandidate,
} from "@/lib/novel-ai/web/rpg-chat-turn";
import {
  describeMingtanPresetPreview,
  initializeMingtanPreset,
} from "@/lib/novel-ai/web/rpg-preset";
import { inspectRpgFoundation } from "@/lib/novel-ai/web/rpg-foundation-gate";
import {
  stageStudioTaskHandoff,
} from "@/lib/novel-ai/web/studio-task-session";
import ProjectNavigation from "../project-navigation";
import styles from "./rpg.module.css";

type WorkspaceData = {
  project: NovelProject;
  chapter: Chapter;
  chapters: Chapter[];
  storyState: StoryState;
  storyBible: StoryBible;
  characters: Character[];
  relationships: CharacterRelationship[];
  worlds: World[];
  worldRules: WorldRule[];
  lore: LoreEntry[];
  timeline: TimelineEvent[];
  acceptedChoices: AcceptedChoice[];
  rpgTurnReceipts: RpgTurnReceipt[];
};

type RpgAiChoicePlan = RpgChatChoicePlan & {
  contextKey: string;
};

type DetailPanel = "inventory" | "quests" | "relationships" | "log" | "rules" | "characters";

const DETAIL_PANEL_LABELS: Record<DetailPanel, string> = {
  inventory: "裝備與寶物",
  quests: "任務與成就",
  relationships: "人物關係",
  log: "選擇紀錄",
  rules: "玩法規則",
  characters: "人物庫",
};

const PLAY_MODE_DETAIL_PANELS: Record<StoryPlayModeId, readonly DetailPanel[]> = {
  general: ["log", "rules", "characters"],
  interactive: ["relationships", "log", "rules", "characters"],
  rpg: ["inventory", "quests", "relationships", "log", "rules", "characters"],
  romance: ["relationships", "log", "rules", "characters"],
  management: ["quests", "relationships", "log", "rules", "characters"],
};

type RpgMutationLine = {
  key: string;
  label: string;
  before: string;
  after: string;
  delta: string;
  kind: "ability" | "status" | "currency" | "item" | "relationship" | "progress" | "world";
};

const FORMULA = rpgFormulaExplanation();
const RULE_STORAGE_PREFIX = "novel:rpg-rules:v2:";
const RPG_TURN_COMPLETION_GRACE_MS = 5_000;
const RPG_TURN_TIMEOUT_MS = (
  RPG_CHAT_STORY_AI_TIMEOUT_MS
  + RPG_CHAT_FALLBACK_REVIEW_TIMEOUT_MS
  + RPG_CHAT_FALLBACK_REPAIR_RETRY_TIMEOUT_MS
  + RPG_TURN_COMPLETION_GRACE_MS
);

type PlayModeDashboardCopy = {
  identity: string;
  hp: string;
  stamina: string;
  actions: string;
  questKind: string;
  questTitle: string;
  statLabels: Record<RpgStatKey, string>;
  derivedLabels: {
    attack: string;
    defense: string;
    speed: string;
    insight: string;
    negotiation: string;
    leadership: string;
  };
};

const PLAY_MODE_DASHBOARD_COPY: Record<StoryPlayModeId, PlayModeDashboardCopy> = {
  general: {
    identity: "小說主角", hp: "情節穩定", stamina: "創作動能", actions: "段落行動", questKind: "章節目標", questTitle: "推進目前章節",
    statLabels: { "rpg.physique": "行動力", "rpg.technique": "表現力", "rpg.intellect": "洞察力", "rpg.charisma": "感染力", "rpg.will": "意志力", "rpg.creativity": "創造力" },
    derivedLabels: { attack: "推進力", defense: "一致性", speed: "節奏", insight: "洞察", negotiation: "對話", leadership: "主導" },
  },
  interactive: {
    identity: "分支故事主角", hp: "局勢穩定", stamina: "專注力", actions: "本回合行動", questKind: "分支目標", questTitle: "推進目前故事分支",
    statLabels: { "rpg.physique": "行動力", "rpg.technique": "反應力", "rpg.intellect": "洞察力", "rpg.charisma": "同理心", "rpg.will": "決斷力", "rpg.creativity": "變通力" },
    derivedLabels: { attack: "推進力", defense: "風險抵抗", speed: "反應速度", insight: "線索洞察", negotiation: "說服力", leadership: "帶領力" },
  },
  rpg: {
    identity: "冒險主角", hp: "生命 HP", stamina: "體力 SP", actions: "行動點", questKind: "主線任務", questTitle: "推進當前主線",
    statLabels: { "rpg.physique": "力量／體魄", "rpg.technique": "敏捷／技巧", "rpg.intellect": "智力／感知", "rpg.charisma": "魅力／交涉", "rpg.will": "意志／抗性", "rpg.creativity": "創造／奇策" },
    derivedLabels: { attack: "攻擊", defense: "防禦", speed: "速度", insight: "洞察", negotiation: "談判", leadership: "領導" },
  },
  romance: {
    identity: "關係故事主角", hp: "安全感", stamina: "互動能量", actions: "互動次數", questKind: "關係目標", questTitle: "讓關係產生真實進展",
    statLabels: { "rpg.physique": "安全感", "rpg.technique": "互動技巧", "rpg.intellect": "理解力", "rpg.charisma": "吸引力", "rpg.will": "承諾力", "rpg.creativity": "浪漫創意" },
    derivedLabels: { attack: "主動表達", defense: "情緒防護", speed: "回應速度", insight: "情感洞察", negotiation: "溝通力", leadership: "關係承諾" },
  },
  management: {
    identity: "經營決策者", hp: "組織韌性", stamina: "執行能量", actions: "決策點", questKind: "階段目標", questTitle: "讓組織穩定成長",
    statLabels: { "rpg.physique": "執行力", "rpg.technique": "專業力", "rpg.intellect": "判斷力", "rpg.charisma": "溝通力", "rpg.will": "韌性", "rpg.creativity": "創新力" },
    derivedLabels: { attack: "執行產能", defense: "風險防禦", speed: "決策速度", insight: "市場洞察", negotiation: "談判力", leadership: "領導力" },
  },
};

function rpgModeForStoryPlayMode(mode: StoryPlayModeId): RpgMode {
  if (mode === "management") return "management";
  if (mode === "romance") return "cultivation";
  return "adventure";
}

function closedAIErrorCode(error: unknown) {
  const typed = error as {
    code?: unknown;
    causeCode?: unknown;
    message?: unknown;
    cause?: { code?: unknown; causeCode?: unknown; cause?: { code?: unknown } };
  } | null;
  const explicitCode =
    typed?.causeCode
      ?? typed?.cause?.causeCode
      ?? typed?.cause?.code
      ?? typed?.cause?.cause?.code
      ?? typed?.code;
  if (explicitCode) return String(explicitCode);
  const message = String(typed?.message ?? "").trim();
  return /^[A-Z][A-Z0-9_]+$/u.test(message) ? message : "MODEL_NOT_READY";
}

function readCustomLibrary() {
  try {
    return parseRpgCharacterLibrary(
      typeof window.localStorage === "undefined"
        ? null
        : window.localStorage.getItem(RPG_CHARACTER_LIBRARY_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

function readStoredRules(projectId: string) {
  try {
    return normalizeRpgRuleSettings(JSON.parse(
      window.localStorage?.getItem(`${RULE_STORAGE_PREFIX}${projectId}`) ?? "{}",
    ));
  } catch {
    return DEFAULT_RPG_RULE_SETTINGS;
  }
}

function errorMessage(error: unknown) {
  const code = closedAIErrorCode(error);
  const labels: Record<string, string> = {
    PROJECT_REVISION_CONFLICT: "作品在你選擇時已有更新，請重新整理三選一。",
    CHAPTER_REVISION_CONFLICT: "章節內容已更新，請重新整理三選一。",
    STORY_STATE_REVISION_CONFLICT: "能力值已有新變化，請重新整理。",
    CANDIDATE_STALE: "這個選項已過期，請產生新一輪選擇。",
    RPG_CHARACTER_NAME_REQUIRED: "角色姓名不能空白。",
    RPG_CUSTOM_ACTION_REQUIRED: "請先輸入你想採取的自由行動。",
    RPG_AI_CONTINUATION_TOO_SHORT: "本機模型這次只產生了過短片段，沒有寫入故事；請重新執行本回合。",
    RPG_AI_CONTINUATION_NOT_STORY: "本機模型這次回傳的是說明而非小說正文，沒有寫入故事；請重新執行本回合。",
    RPG_AI_CONTINUATION_REPETITIVE: "本機模型這次內容與最近回合過度相似，沒有寫入故事；請重新規劃後再試。",
    OLLAMA_TIMEOUT: "本機模型回應逾時，沒有寫入故事；請確認模型仍在運作後重試。",
    CLOSED_AGENT_EVALUATION_BLOCKED: "本回合沒有通過閉端 AI 品質檢查，因此沒有寫入故事。",
    RPG_CLOSED_AI_RESOLUTION_FAILED: "閉端 AI 沒有完成本回合，故事與能力值均未變更。",
  };
  const fallback = error instanceof Error ? error.message.trim() : "";
  const looksLikeInternalCode = /(?:^|\s)[A-Z][A-Z0-9_]{3,}(?:$|\s)/u.test(fallback);
  return labels[code] ?? (fallback && !looksLikeInternalCode
    ? fallback
    : "操作尚未完成，故事與數值都沒有改變，請稍後再試。");
}

function proceduralCharacterTemplate(candidate: ProceduralCharacterCandidate): RpgCharacterTemplate {
  return {
    ...createRpgCharacterTemplate({
      name: candidate.name,
      archetype: candidate.role,
      identity: `${candidate.storyAffinity}故事中的${candidate.role}`,
      personality: candidate.personality,
      goal: candidate.goal,
    }),
    templateId: candidate.id,
    rpgArchetype: candidate.rpgArchetype,
    values: [candidate.stance],
    capabilities: [candidate.proactiveAction],
    limitations: [candidate.refusalCondition],
    relationshipHooks: [candidate.directDialogue],
    builtin: true,
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(value);
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

const RESOURCE_LABELS: Record<string, string> = {
  "game.actionPoints": "行動點",
  "game.day": "遊戲日",
  "game.turn": "回合",
  "game.fatePoints": "命運點",
  "journey.mainlineMomentum": "主線動能",
  "journey.path.steady": "守序路線",
  "journey.path.resource": "結盟路線",
  "journey.path.bold": "破界路線",
  "journey.worldFreedom": "世界自由度",
  "adventure.clues": "情報線索",
  "adventure.mapProgress": "地圖進度",
  "adventure.supplies": "冒險補給",
  "adventure.tools": "實用工具",
  "adventure.momentum": "冒險動能",
  "adventure.renown": "冒險聲望",
  "growth.mastery": "修練熟練度",
  "growth.bondEvents": "共同經歷",
  "growth.alchemy": "煉製熟練度",
  "growth.realm": "境界進度",
  "growth.popularity": "人氣",
  "management.cash": "營運資金",
  "management.staff": "員工人數",
  "management.inventory": "商品庫存",
  "management.morale": "團隊士氣",
  "management.reputation": "商譽",
  "management.satisfaction": "顧客滿意",
  "management.technology": "技術力",
  "management.risk": "營運風險",
  "management.marketShare": "市場占有率",
  "management.socialImpact": "社會影響",
};

function buildRpgMutationLines(
  state: StoryState,
  effect: StoryChoiceEffect,
  seed: string,
  mode: RpgMode,
) {
  const before = readRpgProgression(state, seed, mode);
  const nextState = applyStoryChoiceEffect(state, effect, before.baseStats);
  const after = readRpgProgression(nextState, seed, mode);
  const lines: RpgMutationLine[] = [];
  const seen = new Set<string>();
  const pushNumber = (
    key: string,
    label: string,
    beforeValue: number,
    afterValue: number,
    kind: RpgMutationLine["kind"],
  ) => {
    if (beforeValue === afterValue || seen.has(key)) return;
    seen.add(key);
    lines.push({
      key,
      label,
      before: formatNumber(beforeValue),
      after: formatNumber(afterValue),
      delta: signed(afterValue - beforeValue),
      kind,
    });
  };

  for (const definition of RPG_STAT_DEFINITIONS) {
    pushNumber(
      definition.key,
      definition.labels[mode],
      before.stats[definition.key],
      after.stats[definition.key],
      "ability",
    );
  }
  pushNumber("rpg.xp", "經驗值", before.xp, after.xp, "progress");
  const derived: Array<[keyof RpgProgressionSnapshot["derived"], string]> = [
    ["maxHp", "生命上限"],
    ["attack", "攻擊力"],
    ["defense", "防禦力"],
    ["speed", "速度"],
    ["insight", "洞察"],
    ["negotiation", "談判"],
    ["leadership", "領導"],
    ["carryCapacity", "負重上限"],
  ];
  for (const [key, label] of derived) {
    pushNumber(`derived.${key}`, label, before.derived[key], after.derived[key], "ability");
  }
  const statuses: Array<[keyof RpgProgressionSnapshot["status"], string]> = [
    ["hp", "生命"], ["stamina", "體力"], ["spirit", "精神"],
    ["fatigue", "疲勞"], ["stress", "壓力"], ["mood", "心情"],
    ["health", "健康"], ["focus", "專注"], ["actionPoints", "行動點"],
  ];
  for (const [key, label] of statuses) {
    pushNumber(`status.${key}`, label, before.status[key], after.status[key], "status");
  }
  pushNumber("currency.gold", "金幣", before.currencies.gold, after.currencies.gold, "currency");
  pushNumber("currency.spiritStone", "靈石", before.currencies.spiritStone, after.currencies.spiritStone, "currency");
  pushNumber("currency.guildToken", "公會憑證", before.currencies.guildToken, after.currencies.guildToken, "currency");

  const itemIds = new Set([
    ...before.inventory.map((item) => item.itemId),
    ...after.inventory.map((item) => item.itemId),
    ...Object.keys(effect.resourceChanges).filter((key) => key.startsWith("item.")).map((key) => key.slice(5)),
  ]);
  for (const itemId of itemIds) {
    const beforeItem = before.inventory.find((item) => item.itemId === itemId);
    const afterItem = after.inventory.find((item) => item.itemId === itemId);
    const catalogItem = RPG_ITEM_CATALOG.find((item) => item.itemId === itemId);
    pushNumber(
      `item.${itemId}`,
      catalogItem?.name ?? afterItem?.name ?? beforeItem?.name ?? itemId,
      beforeItem?.quantity ?? 0,
      afterItem?.quantity ?? 0,
      "item",
    );
  }

  for (const key of Object.keys(effect.relationshipChanges)) {
    pushNumber(
      `relationship.${key}`,
      key === "rpg.partyTrust" ? "隊伍信任" : key,
      state.relationships[key] ?? 0,
      nextState.relationships[key] ?? 0,
      "relationship",
    );
  }
  for (const key of Object.keys(effect.questProgress)) {
    pushNumber(`quest.${key}`, `任務：${key}`, Number(state.questStates[key]) || 0, Number(nextState.questStates[key]) || 0, "progress");
  }
  for (const key of Object.keys(effect.achievementProgress)) {
    pushNumber(`achievement.${key}`, `成就：${key}`, Number(state.achievementStates[key]) || 0, Number(nextState.achievementStates[key]) || 0, "progress");
  }
  for (const key of Object.keys(effect.resourceChanges)) {
    if (key.startsWith("item.") || key.startsWith("currency.") || key.startsWith("status.") || key === "game.actionPoints") continue;
    pushNumber(key, RESOURCE_LABELS[key] ?? key, state.resources[key] ?? 0, nextState.resources[key] ?? 0, key.startsWith("game.") || key.startsWith("journey.") ? "progress" : "world");
  }

  const beforeWeapon = before.inventory.find((item) => item.equipped && item.slot === "weapon")?.name ?? "未裝備";
  const afterWeapon = after.inventory.find((item) => item.equipped && item.slot === "weapon")?.name ?? "未裝備";
  if (beforeWeapon !== afterWeapon) {
    lines.unshift({ key: "equipment.weapon", label: "目前武器", before: beforeWeapon, after: afterWeapon, delta: "已換裝", kind: "item" });
  }
  return lines;
}

function Meter({ label, value, inverted = false }: { label: string; value: number; inverted?: boolean }) {
  const tone = inverted
    ? value >= 75 ? "danger" : value >= 50 ? "warning" : "good"
    : value <= 25 ? "danger" : value <= 55 ? "warning" : "good";
  return (
    <div className={styles.meter} data-tone={tone}>
      <div><span>{label}</span><b>{Math.round(value)}</b></div>
      <progress max={100} value={value} />
    </div>
  );
}

function splitRoundStory(text: string, fallbackTitle: string) {
  const normalized = text.trim();
  const lines = normalized.split(/\r?\n/u);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  const candidate = firstContentIndex >= 0 ? lines[firstContentIndex].trim() : "";
  const hasRoundTitle = candidate.length <= 90
    && /^(?:第[一二三四五六七八九十百千〇零0-9]+(?:回合|日|章)|回合\s*[0-9]+|ROUND\s*[0-9]+)/iu.test(candidate);
  if (!hasRoundTitle) return { title: fallbackTitle, body: normalized };
  return {
    title: candidate.replace(/^#+\s*/u, ""),
    body: lines.filter((_, index) => index !== firstContentIndex).join("\n").trim(),
  };
}

export default function RpgWorkspace({ projectId }: { projectId: string }) {
  const learningRepository = useMemo(() => createSovereignLearningRepository(), []);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [customLibrary, setCustomLibrary] = useState<RpgCharacterTemplate[]>([]);
  const [status, setStatus] = useState("正在載入故事狀態與角色養成資料。");
  const [operationError, setOperationError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<RpgChoice | null>(null);
  const [lastResolution, setLastResolution] = useState<RpgChoiceResolution | null>(null);
  const [lastMutationLines, setLastMutationLines] = useState<RpgMutationLine[]>([]);
  const [pendingMutationLines, setPendingMutationLines] = useState<RpgMutationLine[]>([]);
  const [lastContinuation, setLastContinuation] = useState("");
  const [lastExecutorLabel, setLastExecutorLabel] = useState("");
  const [activeMode, setActiveMode] = useState<RpgMode>("adventure");
  const [storyPlayMode, setStoryPlayMode] = useState<StoryPlayModeId>("general");
  const [activePanel, setActivePanel] = useState<DetailPanel>("inventory");
  const [rules, setRules] = useState<RpgRuleSettings>(DEFAULT_RPG_RULE_SETTINGS);
  const [customAction, setCustomAction] = useState("");
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("");
  const [identity, setIdentity] = useState("");
  const [personality, setPersonality] = useState("");
  const [goal, setGoal] = useState("");
  const [xianxiaRuleKind, setXianxiaRuleKind] = useState<XianxiaRuleKind>("talisman");
  const [xianxiaRuleVariant, setXianxiaRuleVariant] = useState(0);
  const [aiChoicePlan, setAiChoicePlan] = useState<RpgAiChoicePlan | null>(null);
  const [aiChoiceStatus, setAiChoiceStatus] = useState("等待故事與 RPG 狀態完成同步。 ");
  const [aiChoiceElapsedSeconds, setAiChoiceElapsedSeconds] = useState(0);
  const [aiChoiceFallbackBusy, setAiChoiceFallbackBusy] = useState(false);
  const [aiChoiceRetry, setAiChoiceRetry] = useState(0);
  const [causalKnowledgeRevision, setCausalKnowledgeRevision] = useState(0);
  const [turnDraft, setTurnDraft] = useState("");
  const [pendingTurnCandidate, setPendingTurnCandidate] = useState<RpgChatTurnCandidate | null>(null);
  const [turnElapsedSeconds, setTurnElapsedSeconds] = useState(0);
  const [dashboardExpanded, setDashboardExpanded] = useState(false);
  const [proceduralLibraryVariant, setProceduralLibraryVariant] = useState(0);
  const [presetPreviewOpen, setPresetPreviewOpen] = useState(false);
  const aiChoiceControllerRef = useRef<AbortController | null>(null);
  const aiChoiceCandidateRef = useRef<string | null>(null);
  const aiChoiceSnapshotRef = useRef<{ contextKey: string; snapshot: RpgChatSnapshot } | null>(null);
  const turnControllerRef = useRef<AbortController | null>(null);
  const turnRunIdRef = useRef(0);
  const approvalRunningRef = useRef(false);
  const resultRef = useRef<HTMLElement | null>(null);
  const detailPanels = PLAY_MODE_DETAIL_PANELS[storyPlayMode];
  const visiblePanel = detailPanels.includes(activePanel) ? activePanel : detailPanels[0];

  useEffect(() => {
    if (!lastContinuation) return;
    const frame = window.requestAnimationFrame(() => {
      resultRef.current?.focus({ preventScroll: true });
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lastContinuation]);

  useEffect(() => () => {
    aiChoiceControllerRef.current?.abort();
    turnControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ai/learning/shared-library?limit=24", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("SHARED_CAUSAL_KNOWLEDGE_UNAVAILABLE");
        const snapshot = await response.json() as SharedLearningSnapshot;
        await ingestSharedLearningSnapshot(learningRepository, { projectId, snapshot });
        if (!cancelled) setCausalKnowledgeRevision((value) => value + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [learningRepository, projectId]);

  function leaveRpg(href: string, label: string) {
    stageStudioTaskHandoff({
      projectId,
      sourceLabel: "故事工作台（RPG 模式）",
      destinationLabel: label,
      destinationHref: href,
      chapterId: data?.chapter.id ?? null,
      chapterTitle: data?.chapter.title ?? null,
    });
    window.location.assign(href);
  }

  const load = useCallback(async () => {
    const repository = createNovelRepository();
    const loadedProject = await repository.get<NovelProject>("projects", projectId);
    if (!loadedProject) throw new Error("找不到這個作品。");
    let project: NovelProject = loadedProject;
    const [chapters, states, bibles, characters, relationships, worlds, worldRules, lore, timeline, acceptedChoices, rpgTurnReceipts] = await Promise.all([
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
    let chapter = chapters.find((item) => item.id === project.activeChapterId)
      ?? [...chapters].sort((left, right) => left.order - right.order).at(-1);
    if (!chapter) {
      const chapterBase = makeRecord(projectId, "user");
      chapter = await repository.put<Chapter>("chapters", {
        ...chapterBase,
        title: "第一章",
        order: 1,
        content: "",
        summary: null,
        status: "draft",
      });
      project = await repository.put<NovelProject>("projects", {
        ...project,
        activeChapterId: chapter.id,
      }, project.revision);
    }
    let storyState = states.find((item) => item.id === project.storyStateId) ?? states[0];
    const storyBible = resolveProjectStoryBible(project, bibles);
    if (!chapter || !storyState || !storyBible) {
      throw new Error("作品缺少章節、故事狀態或 Story Bible，無法啟動 RPG。");
    }
    const resolvedPlayMode = resolveStoryPlayMode(storyState);
    const existingWorldFlags = storyState.worldFlags ?? {};
    if (
      storyState.worldFlags == null
      || (existingWorldFlags["story.playMode"] === undefined && resolvedPlayMode !== "general")
    ) {
      storyState = await repository.put<StoryState>("storyStates", {
        ...storyState,
        worldFlags: {
          ...existingWorldFlags,
          ...(resolvedPlayMode !== "general" ? {
            "story.playMode": resolvedPlayMode,
            "story.playModeLocked": true,
          } : {}),
        },
      }, storyState.revision);
    }
    setStoryPlayMode(resolvedPlayMode);
    setActiveMode(rpgModeForStoryPlayMode(resolvedPlayMode));
    setData({
      project,
      chapter,
      chapters: (chapters.some((item) => item.id === chapter.id) ? [...chapters] : [...chapters, chapter])
        .sort((left, right) => left.order - right.order),
      storyState,
      storyBible,
      characters,
      relationships,
      worlds,
      worldRules,
      lore,
      timeline,
      acceptedChoices: [...acceptedChoices].sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt)),
      rpgTurnReceipts: [...rpgTurnReceipts].sort((left, right) => right.turnNumber - left.turnNumber),
    });
    setStatus("RPG、養成、經營規則引擎與正式故事狀態已同步。");
    void Promise.allSettled([
      prewarmStudioProjectAIState({
        projectId,
        taskTypes: ["chapter.abcChoices", "chapter.continue"],
        sourceChapterId: chapter.id,
        sourceRevision: chapter.revision,
      }),
      prewarmStudioInteractiveChoiceAI(),
    ]);
  }, [projectId]);

  useEffect(() => {
    void Promise.resolve()
      .then(() => {
        setCustomLibrary(readCustomLibrary());
        setRules(readStoredRules(projectId));
      })
      .then(load)
      .catch((error) => setStatus(errorMessage(error)));
  }, [load, projectId]);

  const protagonist = data?.characters.find((character) =>
    data.storyBible.protagonistIds.includes(character.id)) ?? data?.characters[0] ?? null;
  const activeWorlds = data
    ? activeStoryWorlds(data.worlds, data.storyState, data.storyBible)
    : [];
  const protagonistPortrait = data && protagonist
    ? suggestedCharacterPortrait({ character: protagonist, project: data.project, worlds: activeWorlds })
    : null;
  const mingtanPreview = useMemo(() => describeMingtanPresetPreview(), []);
  const storyLanguage = useMemo(() => {
    const value = data?.storyState.worldFlags?.["story.language"];
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }, [data?.storyState.worldFlags]);
  const progression = useMemo(
    () => data
      ? readRpgProgression(data.storyState, `${data.project.title}|${protagonist?.name ?? ""}`, activeMode)
      : null,
    [activeMode, data, protagonist?.name],
  );
  const selectedMutationLines = useMemo(() => {
    if (!data || !selectedChoice) return [];
    return buildRpgMutationLines(
      data.storyState,
      selectedChoice.immediateEffect,
      `${data.project.title}|${protagonist?.name ?? ""}`,
      activeMode,
    );
  }, [activeMode, data, protagonist?.name, selectedChoice]);
  const candidateMutationLines = pendingTurnCandidate ? pendingMutationLines : selectedMutationLines;
  const visibleSelectedMutationLines = dashboardExpanded
    ? candidateMutationLines
    : candidateMutationLines.slice(0, 4);
  const visibleLastMutationLines = dashboardExpanded
    ? lastMutationLines
    : lastMutationLines.slice(0, 4);
  const activated = Boolean(data?.storyState.protagonistStats["rpg.xp"] !== undefined);
  const conflict = data?.chapter.content.slice(-360).trim()
    || data?.chapter.summary?.trim()
    || data?.storyBible.unresolvedThreads.at(-1)?.trim()
    || data?.project.coreIdea.value?.trim()
    || "目前局勢";
  const aiContextKey = data && progression
    ? [
      data.project.id,
      data.chapter.id,
      data.chapter.revision,
      data.storyState.revision,
      data.storyBible.revision,
      storyPlayMode,
      activeMode,
      progression.turn,
      progression.choiceVariant,
      storyLanguage,
      aiChoiceRetry,
      causalKnowledgeRevision,
    ].join(":")
    : "not-ready";
  const aiChoicesReady = Boolean(
    aiChoicePlan?.contextKey === aiContextKey && aiChoicePlan.choices.length === 3,
  );
  const choices = useMemo(
    () => aiChoicesReady && aiChoicePlan ? aiChoicePlan.choices : [],
    [aiChoicePlan, aiChoicesReady],
  );
  const rpgFoundation = useMemo(() => {
    if (!data) return { ready: false, issues: [{ code: "STORY_CONTEXT_REQUIRED" as const, label: "作品資料" }] };
    return inspectRpgFoundation({
      protagonistName: protagonist?.name,
      coreIdea: data.project.coreIdea.value,
      theme: data.storyBible.theme.value,
      chapterContent: data.chapter.content,
      unresolvedThreadCount: data.storyBible.unresolvedThreads.length,
    });
  }, [data, protagonist?.name]);
  const rpgFoundationMissing = rpgFoundation.issues.map((issue) => issue.label);
  const rpgFoundationReady = rpgFoundation.ready;

  const activateRuleChoiceFallback = useCallback(async () => {
    if (!data || !progression || pendingTurnCandidate || aiChoiceFallbackBusy) return;
    setAiChoiceFallbackBusy(true);
    setAiChoiceStatus("已停止等待閉端 AI，正在用目前人物、世界、上一回合結果與正式狀態建立後備三選一。");
    setAiChoiceElapsedSeconds(0);
    aiChoiceControllerRef.current?.abort("USER_REQUESTED_RULE_FALLBACK");
    try {
      const cached = aiChoiceSnapshotRef.current;
      const snapshot = cached?.contextKey === aiContextKey
        ? cached.snapshot
        : await loadRpgChatSnapshot(createNovelRepository(), projectId, rules, learningRepository);
      const plan = await buildRpgRuleChoicePlan({
        snapshot,
        fallbackReason: "USER_REQUESTED_RULE_FALLBACK",
      });
      setAiChoicePlan({ ...plan, contextKey: aiContextKey });
      setAiChoiceStatus("已依上一回合的具體結果建立後備 A／B／C；三條路線會承接目前人物、場景與未解後果。");
    } catch (error) {
      setAiChoiceStatus(`${errorMessage(error)} 正式故事與數值維持原狀。`);
    } finally {
      setAiChoiceFallbackBusy(false);
    }
  }, [aiChoiceFallbackBusy, aiContextKey, data, learningRepository, pendingTurnCandidate, progression, projectId, rules]);

  useEffect(() => {
    if (pendingTurnCandidate) return;
    if (!activated || !rpgFoundationReady || !data || !progression) {
      const resetTimer = window.setTimeout(() => {
        setAiChoicePlan(null);
        setAiChoiceElapsedSeconds(0);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }
    const controller = new AbortController();
    aiChoiceControllerRef.current?.abort();
    aiChoiceControllerRef.current = controller;
    const planningStartedAt = Date.now();
    let planReady = false;
    const planningElapsedTimer = window.setInterval(() => {
      if (!controller.signal.aborted && !planReady) {
        setAiChoiceElapsedSeconds(Math.floor((Date.now() - planningStartedAt) / 1_000));
      }
    }, 1_000);
    const resetTimer = window.setTimeout(() => {
      setSelectedChoice(null);
      setPendingTurnCandidate(null);
      setAiChoicePlan(null);
      setAiChoiceElapsedSeconds(0);
      setAiChoiceStatus("閉端 AI 正在讀取上一回合、人物、世界與正式狀態，建立三條真正不同且連續的路線。");
    }, 0);
    const previousCandidateId = aiChoiceCandidateRef.current;
    aiChoiceCandidateRef.current = null;
    if (previousCandidateId) void rejectStudioClosedAgentCandidate(previousCandidateId).catch(() => undefined);

    void loadRpgChatSnapshot(createNovelRepository(), projectId, rules, learningRepository)
      .then(async (snapshot) => {
        aiChoiceSnapshotRef.current = { contextKey: aiContextKey, snapshot };
        return planRpgChatChoices({
          snapshot,
          signal: controller.signal,
          onProgress: (event) => {
            if (controller.signal.aborted) return;
            const generated = event.generatedCharacters ?? 0;
            setAiChoiceStatus(`${event.label}${generated > 0 ? ` · 已產生 ${generated} 字` : ""}`);
          },
        });
      })
      .then((plan) => {
        if (controller.signal.aborted || !plan) return;
        planReady = true;
        window.clearInterval(planningElapsedTimer);
        setAiChoiceElapsedSeconds(0);
        if (plan.actualExecutor !== "deterministic-rule-fallback") {
          aiChoiceCandidateRef.current = plan.candidateId;
        }
        setAiChoicePlan({ ...plan, contextKey: aiContextKey });
        setAiChoiceStatus(plan.actualExecutor === "deterministic-rule-fallback"
          ? "閉端 AI 已明確逾時，或你已明確選擇規則後備；已依上一回合具體結果啟用後備 A／B／C。"
          : `閉端 AI 已完成本回合三選一：${plan.model}；策略、成本、成功率與效果仍由規則引擎鎖定。`);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("RPG_CHOICE_PLANNING_FAILED", error);
        setAiChoiceStatus(`${errorMessage(error)} 正式故事與數值維持原狀。`);
      })
      .finally(() => {
        window.clearInterval(planningElapsedTimer);
      });
    return () => {
      window.clearTimeout(resetTimer);
      window.clearInterval(planningElapsedTimer);
      controller.abort();
    };
  }, [activated, aiChoiceRetry, aiContextKey, data, learningRepository, pendingTurnCandidate, progression, projectId, rpgFoundationReady, rules]);
  const library = useMemo(() => mergeCharacterLibrary(customLibrary), [customLibrary]);
  const proceduralLibrary = useMemo(() => {
    if (!data || !progression) return { characters: [], treasures: [] };
    const context = {
      genre: [data.project.genrePackId, data.project.genreId, data.project.subgenreId]
        .filter(Boolean)
        .join(" "),
      playMode: storyPlayMode,
      storyTags: data.lore.slice(0, 6).map((entry) => `${entry.kind}:${entry.title}`),
      protagonist: protagonist?.name ?? undefined,
      location: data.storyState.locationState ?? undefined,
      conflict,
    };
    const characterBase = (
      progression.turn * 7_919
      + proceduralLibraryVariant * 10_007
      + data.characters.length * 101
    ) % PROCEDURAL_CHARACTER_CAPACITY;
    const treasureBase = (
      progression.turn * 6_997
      + proceduralLibraryVariant * 9_973
      + progression.inventory.length * 211
    ) % PROCEDURAL_TREASURE_CAPACITY;
    const seed = `${projectId}|${data.chapter.id}|${storyPlayMode}`;
    return {
      characters: Array.from({ length: 3 }, (_, index) => proceduralCharacterAt({
        seed: `${seed}|characters`,
        ordinal: (characterBase + index * 33_331) % PROCEDURAL_CHARACTER_CAPACITY,
        context,
      })),
      treasures: Array.from({ length: 3 }, (_, index) => proceduralTreasureAt({
        seed: `${seed}|treasures`,
        ordinal: (treasureBase + index * 33_331) % PROCEDURAL_TREASURE_CAPACITY,
        context,
      })),
    };
  }, [conflict, data, proceduralLibraryVariant, progression, projectId, protagonist?.name, storyPlayMode]);
  const xianxiaRuleCandidate = useMemo<XianxiaRuleCandidate | null>(() => {
    if (!data || !progression) return null;
    const recentRuleIds = data.storyState.worldFlags?.["xianxia.recentRuleIds"];
    const recent = typeof recentRuleIds === "string"
      ? recentRuleIds.split(",").filter(Boolean).slice(-8)
      : [];
    return generateXianxiaRuleCandidate({
      runSeed: progression.procedural.runSeed,
      kind: xianxiaRuleKind,
      turn: progression.turn,
      variant: xianxiaRuleVariant,
      recentRuleIds: recent,
      adultMode: data.project.adultMode,
    });
  }, [data, progression, xianxiaRuleKind, xianxiaRuleVariant]);

  function persistCustomLibrary(next: RpgCharacterTemplate[]) {
    setCustomLibrary(next);
    try {
      window.localStorage?.setItem(
        RPG_CHARACTER_LIBRARY_STORAGE_KEY,
        JSON.stringify(next.filter((template) => !template.builtin)),
      );
    } catch {
      setStatus("人物已保留在本次工作階段；瀏覽器封鎖本機儲存，重新開啟後可能不會保留。");
    }
  }

  function updateRules(next: RpgRuleSettings) {
    if (pendingTurnCandidate) {
      setStatus("請先核准或拒絕目前候選，再變更作者規則。");
      return;
    }
    const normalized = normalizeRpgRuleSettings(next);
    setRules(normalized);
    setSelectedChoice(null);
    try {
      window.localStorage?.setItem(`${RULE_STORAGE_PREFIX}${projectId}`, JSON.stringify(normalized));
    } catch {
      // Rules still apply to this browser session.
    }
    setStatus("作者規則已套用；選項池與成長／風險計算已重新整理。");
  }

  async function initializeProgression() {
    if (!data || busy) return;
    setBusy(true);
    try {
      const defaults = protagonist?.rpgProfile?.formulaVersion === RPG_FORMULA_VERSION
        ? { ...protagonist.rpgProfile.stats }
        : initialRpgStats(`${data.project.title}|${protagonist?.name ?? ""}`);
      const existingSeed = data.storyState.worldFlags?.["rpg.runSeed"];
      const runSeed = typeof existingSeed === "string" && existingSeed ? existingSeed : crypto.randomUUID();
      const cycle = Math.max(1, Number(data.storyState.worldFlags?.["rpg.cycle"] ?? 1));
      const resources = {
        ...initialRpgResources(),
        ...initialProceduralPillResources(runSeed, cycle, 6),
      };
      await createNovelRepository().put<StoryState>("storyStates", {
        ...data.storyState,
        protagonistStats: {
          ...defaults,
          ...data.storyState.protagonistStats,
          "rpg.xp": data.storyState.protagonistStats["rpg.xp"] ?? 0,
        },
        resources: { ...resources, ...data.storyState.resources },
        money: data.storyState.money ?? 1_200,
        reputation: data.storyState.reputation ?? 20,
        locationState: data.storyState.locationState ?? "未命名邊境城",
        timeState: data.storyState.timeState ?? "第 1 日・清晨",
        riskState: data.storyState.riskState ?? "穩定",
        worldFlags: {
          "rpg.runSeed": runSeed,
          "rpg.cycle": cycle,
          "rpg.equipped.weapon": "iron-sword",
          "rpg.equipped.armor": "traveler-armor",
          "rpg.equipped.treasure": "contract-seal",
          ...(protagonist ? {
            "rpg.protagonistCharacterId": protagonist.id,
            "rpg.initialStatsSource": protagonist.rpgProfile ? "approved-character-profile" : "seeded-default",
          } : {}),
          ...data.storyState.worldFlags,
        },
      }, data.storyState.revision);
      await load();
      setStatus(`統合系統已啟用：${protagonist?.rpgProfile ? "已套用角色核准的 300 點初始能力" : "已套用公式種子能力"}；正文未被改寫。`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function activateMingtanPreset() {
    if (!data || busy || pendingTurnCandidate) return;
    setBusy(true);
    setOperationError(null);
    try {
      const result = await initializeMingtanPreset(createNovelRepository(), projectId, {
        initialStats: progression?.baseStats,
      });
      setPresetPreviewOpen(false);
      await load();
      setStatus(result.replayed
        ? "《明檀篇》仙俠預設先前已初始化；本次沒有重複發放資源，也沒有覆寫章節。"
        : "《明檀篇》仙俠預設已在安全備份後完成：極難、10,000 𩆜石、10 顆女體化媚心丹；章節正文未覆寫。");
    } catch (error) {
      const code = closedAIErrorCode(error) || "MINGTAN_PRESET_INITIALIZATION_FAILED";
      const message = errorMessage(error);
      setOperationError({ code, message });
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  function cancelTurn() {
    if (!turnControllerRef.current) return;
    turnRunIdRef.current += 1;
    turnControllerRef.current.abort();
    turnControllerRef.current = null;
    setBusy(false);
    const message = "已停止本回合；生成中的文字未寫入故事，數值、物品與貨幣均未結算。";
    setOperationError({ code: "RPG_AI_TURN_CANCELLED", message });
    setStatus(message);
  }

  async function generateTurnCandidate(choice: RpgChoice) {
    if (!data || busy || !activated || !progression || !aiChoicesReady || pendingTurnCandidate) return;
    const verifiedChoice = choice.key === "custom"
      ? choice
      : aiChoicePlan?.choices.find((row) =>
        row.key === choice.key && row.id === choice.id && row.title === choice.title);
    if (!verifiedChoice) {
      setStatus("這個選項已過期；本回合沒有修改故事或數值，請從目前三選一重新選擇。");
      return;
    }
    const runId = turnRunIdRef.current + 1;
    turnRunIdRef.current = runId;
    turnControllerRef.current?.abort();
    const controller = new AbortController();
    turnControllerRef.current = controller;
    const startedAt = Date.now();
    const elapsedTimer = window.setInterval(() => {
      if (turnRunIdRef.current === runId) {
        setTurnElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
      }
    }, 1_000);
    let turnTimeout: number | null = null;
    setOperationError(null);
    setTurnDraft("");
    setTurnElapsedSeconds(0);
    setBusy(true);
    setStatus(`已選擇「${choice.key}｜${choice.title}」；閉端 AI 正文階段最長等待 360 秒。若仍無有效正文，才會建立三份不可見後備草稿，並追加最多 360 秒閉端獨立合成複核；只有白名單內的嚴格內容門檻要求安全修正重試時，才會再追加最多 360 秒，而且只重試一次。正式 Canon 尚未修改。`);
    try {
      const repository = createNovelRepository();
      const snapshot = await loadRpgChatSnapshot(repository, projectId, rules, learningRepository);
      if (
        snapshot.chapter.id !== data.chapter.id
        || snapshot.chapter.revision !== data.chapter.revision
        || snapshot.storyState.revision !== data.storyState.revision
        || snapshot.contextRevisionDigest !== aiChoicePlan?.contextRevisionDigest
      ) {
        throw Object.assign(new Error("作品狀態已更新，請從新選項重新開始。"), {
          code: "RPG_CHAT_CHOICES_STALE",
        });
      }
      const candidate = await Promise.race([
        generateRpgChatTurnCandidate({
          snapshot,
          choice: verifiedChoice,
          signal: controller.signal,
          onProgress: (event) => {
            if (controller.signal.aborted || turnRunIdRef.current !== runId) return;
            const generated = event.generatedCharacters ?? 0;
            setStatus(`${event.label}${generated > 0 ? ` · 已產生 ${generated} 字` : ""}；正文階段最長 360 秒；若進入隱藏後備複核，最多另加 360 秒；只有白名單內的嚴格內容門檻要求安全修正重試時，才會再加最多 360 秒，而且只重試一次。尚未寫入 Canon。`);
          },
        }),
        new Promise<never>((_resolve, reject) => {
          turnTimeout = window.setTimeout(() => {
            controller.abort();
            reject(Object.assign(
              new Error("閉端 AI 正文 360 秒、後備獨立合成複核 360 秒，以及白名單內嚴格內容門檻的唯一一次安全修正重試 360 秒均未完成；已安全停止，正文與所有數值均維持原狀。"),
              { code: "RPG_AI_TURN_TIMEOUT" },
            ));
          }, RPG_TURN_TIMEOUT_MS);
        }),
      ]);
      if (controller.signal.aborted || turnRunIdRef.current !== runId) return;
      if (turnTimeout !== null) {
        window.clearTimeout(turnTimeout);
        turnTimeout = null;
      }
      setPendingTurnCandidate(candidate);
      setTurnDraft(candidate.story);
      setPendingMutationLines(buildRpgMutationLines(
        data.storyState,
        candidate.resolution.effect,
        `${data.project.title}|${protagonist?.name ?? ""}`,
        activeMode,
      ));
      if (aiChoiceCandidateRef.current) {
        await rejectStudioClosedAgentCandidate(aiChoiceCandidateRef.current).catch(() => undefined);
        aiChoiceCandidateRef.current = null;
      }
      setStatus(`候選正文已完成（${candidate.model}）；尚未修改 Canon，請閱讀後核准或拒絕。`);
    } catch (error) {
      if (turnRunIdRef.current !== runId) return;
      const code = closedAIErrorCode(error) || "RPG_CANDIDATE_GENERATION_FAILED";
      const message = errorMessage(error);
      setOperationError({ code, message });
      setStatus(message);
      setTurnDraft("");
      await load().catch(() => undefined);
    } finally {
      window.clearInterval(elapsedTimer);
      if (turnTimeout !== null) window.clearTimeout(turnTimeout);
      if (turnRunIdRef.current === runId) {
        turnControllerRef.current = null;
        setBusy(false);
      }
    }
  }

  async function approvePendingTurn() {
    if (!pendingTurnCandidate || !data || busy || approvalRunningRef.current) return;
    const candidate = pendingTurnCandidate;
    approvalRunningRef.current = true;
    setBusy(true);
    setOperationError(null);
    setStatus("已收到核准指令；正在原子寫入正文、故事狀態與唯一回合收據。");
    try {
      const repository = createNovelRepository();
      const snapshot = await loadRpgChatSnapshot(repository, projectId, rules, learningRepository);
      const result = await approveRpgChatTurn({
        repository,
        snapshot,
        candidate,
      });
      const receipt = result.transaction.rpgTurnReceipt;
      setLastResolution(candidate.resolution);
      setLastMutationLines(pendingMutationLines);
      setLastContinuation(candidate.story);
      setLastExecutorLabel(`已驗證模型 · ${candidate.model}`);
      setPendingTurnCandidate(null);
      setPendingMutationLines([]);
      setSelectedChoice(null);
      setCustomAction("");
      setTurnDraft("");
      await load();
      setStatus(`已核准並完成唯一一次原子交易：${candidate.resolution.summary}${receipt ? `；收據 ${receipt.receiptId}` : ""}。`);
    } catch (error) {
      const code = closedAIErrorCode(error) || "RPG_CANONICAL_APPROVAL_FAILED";
      const message = errorMessage(error);
      setOperationError({ code, message });
      setStatus(message);
      await load().catch(() => undefined);
    } finally {
      approvalRunningRef.current = false;
      setBusy(false);
    }
  }

  async function rejectPendingTurn() {
    if (!pendingTurnCandidate || busy) return;
    const candidate = pendingTurnCandidate;
    setPendingTurnCandidate(null);
    setTurnDraft("");
    setSelectedChoice(null);
    setPendingMutationLines([]);
    if (candidate.actualExecutor !== "deterministic-rule-fallback") {
      await rejectStudioClosedAgentCandidate(candidate.candidateId).catch(() => undefined);
    }
    setStatus("已拒絕本回合候選；正文、數值、資源、境界與收據都沒有變更。");
  }
  async function prepareCustomAction() {
    if (!data || !progression || !aiChoicesReady) {
      setStatus("請先等規則引擎完成本回合三選一，再建立自由行動候選。");
      return;
    }
    try {
      const snapshot = await loadRpgChatSnapshot(createNovelRepository(), projectId, rules, learningRepository);
      setSelectedChoice(buildRpgChatCustomAction({ snapshot, action: customAction, rules }));
      setStatus("自由行動已轉成規則候選；請先產生候選正文，再決定核准或拒絕。");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable='true']") === true;
      if (typing && event.key !== "Escape") return;
      if (event.key === "Escape") {
        const selector = busy
          ? "[data-testid='rpg-cancel-turn']"
          : pendingTurnCandidate
            ? "[data-testid='rpg-reject-choice']"
            : null;
        if (selector) {
          event.preventDefault();
          document.querySelector<HTMLButtonElement>(selector)?.click();
        }
        return;
      }
      if (event.key === "Enter") {
        const selector = pendingTurnCandidate
          ? "[data-testid='rpg-accept-choice']"
          : selectedChoice
            ? "[data-testid='rpg-generate-candidate']"
            : null;
        if (selector) {
          event.preventDefault();
          document.querySelector<HTMLButtonElement>(selector)?.click();
        }
        return;
      }
      if (busy || pendingTurnCandidate) return;
      const normalized = event.key.normalize("NFKC").toUpperCase();
      const index = normalized === "A" || normalized === "1"
        ? 0
        : normalized === "B" || normalized === "2"
          ? 1
          : normalized === "C" || normalized === "3"
            ? 2
            : -1;
      if (index >= 0 && choices[index] && !choices[index].disabledReason) {
        event.preventDefault();
        setSelectedChoice(choices[index]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, choices, pendingTurnCandidate, selectedChoice]);

  function saveTemplate() {
    try {
      const template = createRpgCharacterTemplate({ name, archetype, identity, personality, goal });
      persistCustomLibrary([...customLibrary, template]);
      setName("");
      setArchetype("");
      setIdentity("");
      setPersonality("");
      setGoal("");
      setStatus(`「${template.name}」已加入你的本機人物庫，可放入任何作品。`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function addCharacterToProject(template: RpgCharacterTemplate) {
    if (!data || busy) return;
    setBusy(true);
    try {
      const repository = createNovelRepository();
      const base = makeRecord(projectId, "user");
      const character: Character = {
        ...base,
        name: template.name,
        aliases: [],
        identity: optionalValue(template.identity || template.archetype, "user_defined"),
        personality: optionalValue(template.personality, template.personality ? "user_defined" : "deferred"),
        goal: optionalValue(template.goal, template.goal ? "user_defined" : "deferred"),
        lifeStatus: "alive",
        locationId: null,
        age: template.age ?? null,
        ageVerified: typeof template.age === "number" && template.age >= 18,
        fears: template.fears,
        privateSecrets: [],
        factionIds: [],
        values: [
          ...template.values,
          ...(template.boundaries ?? []).map((boundary) => `關係界線：${boundary}`),
        ],
        capabilities: template.capabilities,
        limitations: [
          ...template.limitations,
          ...(template.relationshipHooks ?? []).map((hook) => `關係鉤子：${hook}`),
        ],
        rpgProfile: template.rpgArchetype
          ? createCharacterRpgProfile({
            archetype: template.rpgArchetype,
            stats: characterRpgStatsForArchetype(template.rpgArchetype),
          })
          : null,
        voiceStyle: {
          formality: 50,
          directness: 55,
          emotionalExpressiveness: 55,
          sentenceLength: "mixed",
          preferredAddressTerms: [],
        },
      };
      await repository.put("characters", character);
      await repository.put<StoryBible>("storyBibles", {
        ...data.storyBible,
        characterIds: [...new Set([...data.storyBible.characterIds, character.id])],
      }, data.storyBible.revision);
      await load();
      setStatus(`「${template.name}」已加入目前作品；不會自動成為主角或改寫 Canon。`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function addProceduralCharacterToProject(candidate: ProceduralCharacterCandidate) {
    if (!data || busy) return;
    if (data.characters.some((character) => character.name === candidate.name)) {
      setStatus(`「${candidate.name}」已經在目前作品中，不需要重複加入。`);
      return;
    }
    await addCharacterToProject(proceduralCharacterTemplate(candidate));
  }

  function removeTemplate(template: RpgCharacterTemplate) {
    if (template.builtin) return;
    persistCustomLibrary(customLibrary.filter((item) => item.templateId !== template.templateId));
    setStatus(`「${template.name}」已從本機人物庫移除；作品內既有角色不受影響。`);
  }

  if (!data || !progression) {
    return <main className={styles.shell}><p className={styles.loading} role="status">{status}</p></main>;
  }

  if (storyPlayMode === "general") {
    return (
      <main className={styles.shell} data-testid="rpg-play-mode-gate">
        <header className={styles.header}>
          <div>
            <small>IMMUTABLE PLAY MODE</small>
            <h1>這部作品是一般章節寫作</h1>
            <p>玩法在建立作品時已固定，因此不會在寫到一半時突然加入 A／B／C、RPG 數值或其他儀表板。</p>
          </div>
        </header>
        <ProjectNavigation projectId={projectId} active="rpg" />
        <section className={styles.activation}>
          <div>
            <small>原作品不會被修改</small>
            <h2>要用同一組故事種子體驗其他玩法，請建立獨立副本</h2>
            <p>副本只帶入作品名稱與開場設定，會取得新的作品 ID、空白章節與獨立 StoryState。</p>
          </div>
          <div className={styles.activationAction}>
            <button type="button" onClick={() => window.location.assign(`/studio/project/${projectId}/write`)}>回到章節寫作</button>
            <button type="button" onClick={() => window.location.assign(`/studio/create?cloneFrom=${encodeURIComponent(projectId)}`)}>複製為其他玩法</button>
          </div>
        </section>
      </main>
    );
  }

  if (rpgFoundationMissing.length > 0) {
    return (
      <main className={styles.shell} data-testid="rpg-foundation-gate">
        <header className={styles.header}>
          <div>
            <small>UNIFIED STORY GAME OS · FOUNDATION GATE</small>
            <h1>先讓這個世界真正成立</h1>
            <p>RPG 不會在空白作品上假裝推演。完成最少故事基礎後，閉端 AI 才能依同一份 Canon 建立本回合 A／B／C。</p>
          </div>
        </header>
        <ProjectNavigation projectId={projectId} active="rpg" />
        <section className={styles.activation}>
          <div>
            <small>目前還缺少</small>
            <h2>{rpgFoundationMissing.join("、")}</h2>
            <p>補齊前不會建立固定選項、套用數值，或寫入任何故事分支。</p>
          </div>
          <div className={styles.activationAction}>
            <button type="button" onClick={() => leaveRpg(`/studio/project/${projectId}/write`, "章節寫作")}>先寫一段開場</button>
            <button type="button" onClick={() => leaveRpg(`/studio/project/${projectId}/characters`, "角色設定")}>設定主角</button>
            <button type="button" onClick={() => leaveRpg(`/studio/project/${projectId}/closed-ai?task=story.storyBibleCandidate&objective=${encodeURIComponent("請依目前作品建立主角、故事核心與第一個可玩的衝突候選；只建立候選，等待作者核准。")}`, "閉端 AI 引導精靈")}>請閉端 AI 引導設定</button>
          </div>
        </section>
      </main>
    );
  }

  const mode = RPG_MODE_DEFINITIONS[activeMode];
  const dashboardCopy = PLAY_MODE_DASHBOARD_COPY[storyPlayMode];
  const journeyActivities = RPG_FREE_WORLD_ACTIVITIES[activeMode];
  const trackedQuest = storyPlayMode === "management"
    ? "management.survive90"
    : storyPlayMode === "romance"
      ? "romance.main"
      : storyPlayMode === "interactive"
        ? "interactive.main"
        : "rpg.mainArc";
  const trackedProgress = Number(data.storyState.questStates[trackedQuest] ?? 0);
  const storyWorkspaceTitle = {
    general: "章節故事",
    interactive: "分支故事劇場",
    rpg: "命運冒險篇章",
    romance: "關係故事劇場",
    management: "經營故事劇場",
  }[storyPlayMode];
  const primaryCurrencyValue = activeMode === "management"
    ? formatNumber(progression.management.cash)
    : activeMode === "cultivation"
      ? String(progression.currencies.spiritStone)
      : formatNumber(progression.currencies.gold);
  const currentStoryText = data.chapter.content.trim()
    || "故事還沒有正文。請先建立開場；規則引擎完成上下文規劃後，才會提供可提交的故事選項。";
  const latestAcceptedChoice = data.acceptedChoices[0] ?? null;
  const displayedRoundText = lastContinuation
    || latestAcceptedChoice?.acceptedText.trim()
    || currentStoryText;
  const displayedRound = splitRoundStory(
    displayedRoundText,
    `第 ${Math.max(1, progression.turn)} 回合｜${data.chapter.title}`,
  );

  return (
    <main className={styles.shell} data-testid="rpg-workspace" data-mode={activeMode}>
      <header className={styles.header}>
        <div>
          <small>UNIFIED STORY GAME OS · {RPG_FORMULA_VERSION}</small>
          <h1>{storyWorkspaceTitle}</h1>
          <p>先閱讀本回合故事，再做一次選擇；真實模型完成續寫與數值結算後，才會進入下一回合。</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            disabled={busy || Boolean(pendingTurnCandidate)}
            onClick={() => setPresetPreviewOpen(true)}
          >
            {progression.rpgState.presetId === mingtanPreview.presetId ? "查看《明檀篇》預設" : "套用《明檀篇》仙俠預設"}
          </button>
          <div className={styles.levelBadge}><span>LV.</span><strong>{progression.level}</strong><small>{storyPlayMode === "rpg" ? "戰力" : "綜合能力"} {progression.powerScore}</small></div>
        </div>
      </header>

      <ProjectNavigation projectId={projectId} active="rpg" />
      <p
        className={styles.status}
        role="status"
        aria-live="polite"
        data-testid="rpg-operation-status"
        data-state={operationError ? "failed" : busy ? "running" : "ready"}
        data-error-code={operationError?.code ?? ""}
      >
        {status}
      </p>

      {presetPreviewOpen ? <section className={styles.confirmChoice} role="dialog" aria-modal="true" aria-labelledby="mingtan-preset-title" data-testid="mingtan-preset-preview">
        <div>
          <span>套用前預覽</span>
          <h2 id="mingtan-preset-title">《明檀篇》仙俠規則預設</h2>
          <p>規則集 {mingtanPreview.rulesetId} · 難度「極難」 · 自訂行動關閉。初始化只更新正式 StoryState，不會覆寫任何章節正文。</p>
          <ul>
            {mingtanPreview.resources.map((resource) => <li key={resource.resourceId}><b>{resource.amount.toLocaleString("zh-TW")}</b> {resource.localizedName}</li>)}
            <li>保留既有較高資源，不會重複疊加發放。</li>
            <li>先建立 safety backup，再以版本檢查寫入；重複按只會安全重播。</li>
            <li>年齡、同意與內容分級保護維持啟用。</li>
          </ul>
        </div>
        <div className={styles.choiceTags}>
          <button type="button" disabled={busy} onClick={() => void activateMingtanPreset()}>{busy ? "正在備份與初始化…" : "確認套用"}</button>
          <button type="button" disabled={busy} onClick={() => setPresetPreviewOpen(false)}>取消</button>
        </div>
      </section> : null}

      {(!activated || dashboardExpanded) ? <section className={styles.lockedMode} aria-label="固定玩法" data-testid="rpg-locked-play-mode">
        <div>
          <small>本作品固定玩法</small>
          <h2>{STORY_PLAY_MODE_LABELS[storyPlayMode]}</h2>
          <p>{mode.description}。正文、選擇紀錄與儀表板都只服務這一種玩法，不會在創作途中切換成其他系統。</p>
        </div>
        <a href={`/studio/create?cloneFrom=${encodeURIComponent(projectId)}`}>複製故事種子，建立其他玩法</a>
      </section> : null}

      {dashboardExpanded ? <details className={styles.stateDrawer} data-testid="rpg-core-state-drawer">
        <summary>
          <span>目前狀態</span>
          <strong>LV.{progression.level} · {mode.primaryCurrency} {primaryCurrencyValue} · EXP {formatNumber(progression.xp)}</strong>
          <small>展開能力、行動點與資源</small>
        </summary>
        <section className={styles.hud} aria-label="核心狀態 HUD">
          <div className={styles.identityHud}>
            <span>{dashboardCopy.identity}</span>
            <strong>{protagonist?.name ?? "尚未指定主角"}</strong>
            <small>{data.project.title} · {data.chapter.title}</small>
          </div>
          <div className={styles.hudStat}><span>{dashboardCopy.hp}</span><strong>{progression.status.hp}</strong><progress max={100} value={progression.status.hp} /></div>
          <div className={styles.hudStat}><span>{dashboardCopy.stamina}</span><strong>{progression.status.stamina}</strong><progress max={100} value={progression.status.stamina} /></div>
          <div className={styles.hudStat}><span>{dashboardCopy.actions}</span><strong>{progression.status.actionPoints}/{mode.dailyActionPoints}</strong><small>第 {progression.day} 日</small></div>
          <div className={styles.hudStat}><span>{mode.primaryCurrency}</span><strong>{primaryCurrencyValue}</strong><small>命運點 {progression.fatePoints}</small></div>
          <div className={styles.xpHud}><div><span>EXP {formatNumber(progression.xp)}</span><b>{progression.levelProgress}%</b></div><progress max={Math.max(1, progression.nextLevelXp - progression.currentLevelXp)} value={Math.max(0, progression.xp - progression.currentLevelXp)} /><small>下一級 {formatNumber(progression.nextLevelXp)} EXP</small></div>
        </section>
      </details> : null}

      {!activated ? (
        <section className={styles.activation}>
          <div>
            <small>新手只要三步</small>
            <h2>讓故事變成可以玩的第一回合</h2>
            <p>系統會依目前人物與故事建立能力、背包、寶物、貨幣和第一批事件；不會偷偷改寫章節。</p>
            <ol className={styles.activationSteps}>
              <li><span>1</span><div><b>建立初始狀態</b><small>人物設定會轉成可計算能力；未設定部分使用可重現公式。</small></div></li>
              <li><span>2</span><div><b>挑 A／B／C 或自由行動</b><small>先看成功率、代價與可能影響，不必理解所有儀表。</small></div></li>
              <li><span>3</span><div><b>確認後才寫入故事</b><small>正文、數值、關係、任務與物品會一起更新。</small></div></li>
            </ol>
          </div>
          <div className={styles.activationAction}>
            <button data-testid="rpg-initialize" type="button" disabled={busy} onClick={() => void initializeProgression()}>{busy ? "正在建立第一回合…" : "開始第一回合"}</button>
            <button type="button" onClick={() => leaveRpg(`/studio/project/${projectId}/write`, "章節寫作")}>先回正文寫作</button>
          </div>
        </section>
      ) : (
        <>
        {dashboardExpanded ? <><section className={styles.playGuide} data-testid="rpg-play-guide">
          <div><small>每回合只走一條路</small><strong>規則先結算 → 產生候選正文 → 你核准才原子寫入</strong></div>
          <ol><li><b>1</b> 先讀完整故事</li><li><b>2</b> 在 A／B／C 選一張</li><li><b>3</b> 確認後續寫正文並顯示變化</li></ol>
          <div><a href="#rpg-story">閱讀本回合故事</a><button type="button" onClick={() => leaveRpg(`/studio/project/${projectId}/write`, "查看／續寫正文")}>查看完整作品</button></div>
        </section>
        <details className={styles.worldDrawer}>
          <summary><span>世界狀態與變化周目</span><small>需要時再展開，不打斷閱讀</small></summary>
          <section className={styles.worldRibbon} aria-label="本周目世界脈動">
            <div className={styles.cycleEmblem}><small>VARIATION CYCLE</small><strong>{progression.procedural.cycle}</strong><span>世界種子 {progression.procedural.runSeed.slice(0, 8)}</span></div>
            <div><small>目前世界脈動</small><h2>{progression.procedural.currentAspect ?? "事件尚未揭露"}</h2><p>{progression.procedural.currentLocationVariant ?? "你的下一個核准選擇會改變地點、勢力與事件排列。"}</p></div>
            <div className={styles.ribbonMetrics}><span><b>{data.acceptedChoices.length}</b> 已核准選擇</span><span><b>{progression.procedural.recentEncounterSignatures.length}</b> 近期變化</span><span><b>{progression.inventory.filter((item) => item.rarity === "rare" || item.rarity === "epic").length}</b> 稀有物品</span></div>
            <small>變化周目不在回合外直接切換；所有世界變更都隨正式選擇留下收據。</small>
          </section>
        </details></> : null}
        <section className={styles.storyModeBar} aria-label="閱讀與儀表板顯示">
          <div>
            <small>閱讀模式</small>
            <strong>故事正文優先</strong>
            <span>每回合先讀完整續文與三個選擇；能力、背包、任務和世界數值需要時再展開。</span>
          </div>
          <button data-testid="rpg-dashboard-toggle" type="button" aria-controls="rpg-detailed-dashboard" aria-expanded={dashboardExpanded} onClick={() => setDashboardExpanded((value) => !value)}>
            {dashboardExpanded ? "收合完整儀表板" : "查看完整儀表板"}
          </button>
        </section>
        <section id="rpg-detailed-dashboard" className={styles.dashboard} data-testid="rpg-detailed-dashboard" data-dashboard-expanded={dashboardExpanded ? "true" : "false"}>
          <aside className={styles.leftRail}>
            <article className={styles.characterCard}>
              <div className={styles.avatar}>{protagonistPortrait ? <CharacterPortraitImage portrait={protagonistPortrait} className={styles.avatarPortrait} decorative /> : (protagonist?.name ?? "主").slice(0, 1)}</div>
              <div><small>{activeMode === "management" ? "創業者／領導者" : activeMode === "cultivation" ? "成長中的命運者" : "流浪冒險者"}</small><h2>{protagonist?.name ?? "未命名主角"}</h2><p>{data.storyState.locationState ?? "位置尚未設定"} · {data.storyState.riskState ?? "風險未知"}</p><small>能力來源：{protagonist?.rpgProfile ? "角色核准配點" : "作品公式種子"}</small></div>
            </article>

            <div className={styles.statusGrid}>
              <Meter label="精神" value={progression.status.spirit} />
              <Meter label="健康" value={progression.status.health} />
              <Meter label="疲勞" value={progression.status.fatigue} inverted />
              <Meter label="壓力" value={progression.status.stress} inverted />
              <Meter label="心情" value={progression.status.mood} />
              <Meter label="專注" value={progression.status.focus} />
            </div>

            <section className={styles.statPanel}>
              <header><h3>核心能力</h3><small>裝備加成已計入</small></header>
              {RPG_STAT_DEFINITIONS.map((definition) => (
                <div key={definition.key} className={styles.statRow}>
                  <span>{dashboardCopy.statLabels[definition.key]}</span>
                  <progress max={100} value={progression.stats[definition.key]} />
                  <b>{progression.stats[definition.key]}</b>
                  {progression.equipmentBonuses[definition.key] ? <em>+{progression.equipmentBonuses[definition.key]}</em> : null}
                </div>
              ))}
            </section>

            <div className={styles.derivedGrid}>
              <span>{dashboardCopy.derivedLabels.attack} <b>{progression.derived.attack}</b></span>
              <span>{dashboardCopy.derivedLabels.defense} <b>{progression.derived.defense}</b></span>
              <span>{dashboardCopy.derivedLabels.speed} <b>{progression.derived.speed}</b></span>
              <span>{dashboardCopy.derivedLabels.insight} <b>{progression.derived.insight}</b></span>
              <span>{dashboardCopy.derivedLabels.negotiation} <b>{progression.derived.negotiation}</b></span>
              <span>{dashboardCopy.derivedLabels.leadership} <b>{progression.derived.leadership}</b></span>
            </div>
          </aside>

          <section className={styles.centerStage}>
            <article className={styles.sceneCard} id="rpg-story">
              <header>
                <div><small>沉浸回合正文</small><h2>{displayedRound.title}</h2></div>
                {dashboardExpanded ? <span data-risk={data.storyState.riskState ?? "穩定"}>{data.storyState.locationState ?? "未知地點"}</span> : null}
              </header>
              {latestAcceptedChoice ? <p className={styles.selectedActionLead}>你選擇了 <strong>{latestAcceptedChoice.choiceLabel ?? `${latestAcceptedChoice.choiceKey}｜故事選擇`}</strong>。</p> : null}
              <div className={styles.storyText}>{displayedRound.body}</div>
              {dashboardExpanded ? <footer><span>當前目標</span><b>{conflict}</b></footer> : null}
            </article>
            {lastContinuation ? <span ref={resultRef} tabIndex={-1} className={styles.roundCommitReceipt} data-testid="rpg-continuation-result">已由 {lastExecutorLabel} 寫入正式正文</span> : null}

            {lastResolution ? (
              <article className={styles.resolution} data-outcome={lastResolution.outcome} data-testid="rpg-resolution">
                <div><small>行動結果</small><h3>{lastResolution.outcomeLabel}</h3></div>
                <p>{lastResolution.summary}</p>
                {dashboardExpanded ? <span>規則引擎擲骰 {lastResolution.roll}／成功率 {lastResolution.successChance}%</span> : null}
                {lastMutationLines.length ? (
                  <div className={styles.committedMutationSummary} data-testid="rpg-committed-mutations">
                    <b>本回合關鍵變化</b>
                    <div className={styles.mutationList}>
                      {visibleLastMutationLines.map((line) => (
                        <span key={line.key} data-kind={line.kind}>
                          <small>{line.label}</small><del>{line.before}</del><i>→</i><strong>{line.after}</strong><em>{line.delta}</em>
                        </span>
                      ))}
                    </div>
                    {!dashboardExpanded && lastMutationLines.length > visibleLastMutationLines.length ? (
                      <small>另有 {lastMutationLines.length - visibleLastMutationLines.length} 項已同步；可在完整儀表板查看。</small>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ) : null}

            <section className={styles.choiceSection} id="rpg-next-action">
              <header>
                <div><small>第 {progression.turn + 1} 回合</small><h2>你現在必須決定下一步</h2></div>
                <div>
                  {aiChoicesReady ? (
                    <button type="button" disabled={busy || Boolean(pendingTurnCandidate)} onClick={() => setAiChoiceRetry((value) => value + 1)}>重新用閉端 AI 規劃</button>
                  ) : (
                    <button type="button" disabled={busy || aiChoiceFallbackBusy || Boolean(pendingTurnCandidate)} onClick={() => void activateRuleChoiceFallback()}>
                      {aiChoiceFallbackBusy ? "正在建立後備選項" : "不等了，改用後備選項"}
                    </button>
                  )}
                </div>
              </header>
              <p className={styles.aiChoiceStatus} data-ready={aiChoicesReady} data-testid="rpg-ai-choice-status">
                <b>{aiChoicesReady ? "本回合三選一已完成" : "閉端 AI 正在建立三選一"}</b>
                <span>{aiChoiceStatus}</span>
                {!aiChoicesReady ? <small>已等待 {aiChoiceElapsedSeconds} 秒；最長等待 180 秒，你也可以隨時改用後備選項。</small> : null}
                {dashboardExpanded && aiChoicePlan?.contextKey === aiContextKey ? <small>執行者 {aiChoicePlan.actualExecutor} · 模型 {aiChoicePlan.model} · 章節 {data.chapter.title} r{data.chapter.revision}</small> : null}
              </p>
              {aiChoicesReady ? (
                <div className={styles.choiceGrid}>
                  {choices.map((choice) => (
                    <button
                      key={choice.key}
                      data-testid={`rpg-choice-${choice.key}`}
                      type="button"
                      aria-pressed={selectedChoice?.key === choice.key}
                      className={selectedChoice?.key === choice.key ? styles.selected : ""}
                      onClick={() => setSelectedChoice(choice)}
                      disabled={busy || !aiChoicesReady || Boolean(pendingTurnCandidate) || Boolean(choice.disabledReason)}
                    >
                      <div className={styles.choiceHeading}><span className={styles.choiceKey}>{choice.key}</span><div><small>【選項 {choice.key}】</small><h3>{choice.title}</h3></div></div>
                      {dashboardExpanded ? <div className={styles.encounterSignal}><span>{choice.encounter.title}</span><p>{choice.encounter.telegraph}</p></div> : null}
                      <p>{choice.description}</p>
                      {dashboardExpanded ? <p className={styles.continuityReason}><b>策略</b>{choice.strategyLabel} · {choice.displayedChanceBand}</p> : null}
                      {!dashboardExpanded ? <div className={styles.choiceOutcome}>
                        <span><b>收益：</b>{choice.impactLabels.join("、") || "推進目前事件"}</span>
                        <span><b>代價：</b>{choice.costLabels.join("、") || "後果將在正文中揭露"}</span>
                        <span><b>風險：</b>{"◆".repeat(choice.risk)}{"◇".repeat(5 - choice.risk)} · {choice.displayedChanceBand}</span>
                      </div> : null}
                      {dashboardExpanded ? (
                        <>
                          <dl><div><dt>成功率</dt><dd>{rules.choicePreview === "full" ? `${choice.successChance}%` : choice.displayedChanceBand}</dd></div><div><dt>EXP</dt><dd>+{choice.xpGain}</dd></div><div><dt>風險</dt><dd>{"◆".repeat(choice.risk)}{"◇".repeat(5 - choice.risk)}</dd></div></dl>
                          <div className={styles.choiceTags}>{choice.costLabels.map((label) => <span key={label} data-kind="cost">{label}</span>)}{choice.impactLabels.map((label) => <span key={label}>{label}</span>)}</div>
                        </>
                      ) : null}
                      <small className={styles.consequence}>{rules.choicePreview === "full" ? choice.consequence : "部分後果保持未知；規則與資源代價不隱藏。"}</small>
                      {choice.irreversibleWarning ? <strong role="note">不可逆警告：{choice.irreversibleWarning}</strong> : null}
                      {choice.disabledReason ? <small role="status">目前不可選：{choice.disabledReason}</small> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <p className={styles.choiceLoading} role="status">
                  閉端 AI 正在承接上一回合的行動與後果；只有明確逾時，或你明確選擇後備時，才會改用規則後備。
                </p>
              )}

              {dashboardExpanded && progression.rpgState.customActionEnabled ? <div className={styles.freeAction}>
                <label htmlFor="rpg-free-action">自由行動</label>
                <input id="rpg-free-action" value={customAction} onChange={(event) => setCustomAction(event.target.value)} disabled={busy || !aiChoicesReady || Boolean(pendingTurnCandidate)} placeholder="例：先假裝撤退，再觀察守衛換班規律" />
                <button type="button" disabled={busy || !aiChoicesReady || Boolean(pendingTurnCandidate) || !customAction.trim()} onClick={() => void prepareCustomAction()}>建立可驗證候選</button>
              </div> : null}

              {selectedChoice ? (
                <aside className={styles.confirmChoice}>
                  <div><span>{pendingTurnCandidate ? "候選待核准" : "已選分支"}</span><h3>{selectedChoice.key === "custom" ? "自由行動" : selectedChoice.key}｜{selectedChoice.title}</h3><p>{selectedChoice.consequenceTeaser}</p><small>主能力：{statLabel(selectedChoice.primaryStat, activeMode)} · 副能力：{statLabel(selectedChoice.secondaryStat, activeMode)}</small></div>
                  <div className={styles.choiceMutationPreview}>
                    <b>{dashboardExpanded ? "確認後的精確變化" : "預計關鍵變化"}</b>
                    <small>只套用這個選項；另外兩個選項不改正文，也不改任何數值。</small>
                    <div className={styles.mutationList} data-testid="rpg-mutation-preview">
                      {visibleSelectedMutationLines.map((line) => (
                        <span key={line.key} data-kind={line.kind}>
                          <small>{line.label}</small><del>{line.before}</del><i>→</i><strong>{line.after}</strong><em>{line.delta}</em>
                        </span>
                      ))}
                    </div>
                    {!dashboardExpanded && candidateMutationLines.length > visibleSelectedMutationLines.length ? (
                      <small>另有 {candidateMutationLines.length - visibleSelectedMutationLines.length} 項次要變化；確認後可在完整儀表板查看。</small>
                    ) : null}
                    {busy ? (
                      <p className={styles.resolutionProgress} role="status" aria-live="polite" data-testid="rpg-resolution-progress">
                        <b>正在產生或提交本回合</b>
                        <span>{status}</span>
                        <small>已等待 {turnElapsedSeconds} 秒；正文階段最長保留 360 秒，之後若進入不可見後備獨立合成複核，最多另加 360 秒；只有白名單內的嚴格內容門檻要求安全修正重試時，才會再加最多 360 秒，而且只重試一次。候選完成前不會修改正文或數值。</small>
                      </p>
                    ) : null}
                    {turnDraft ? (
                      <div className={styles.liveDraft} data-testid="rpg-live-draft">
                        <b>{pendingTurnCandidate ? "完整候選正文（尚未寫入 Canon）" : "正在生成的續文（尚未寫入 Canon）"}</b>
                        <p className={styles.liveDraftText}>{turnDraft}</p>
                      </div>
                    ) : null}
                    {!pendingTurnCandidate ? <button data-testid="rpg-generate-candidate" type="button" disabled={busy || !aiChoicesReady || Boolean(selectedChoice.disabledReason)} onClick={() => void generateTurnCandidate(selectedChoice)}>{busy ? `正在產生候選（${turnElapsedSeconds} 秒）…` : "產生候選正文（不寫入 Canon）"}</button> : null}
                    {pendingTurnCandidate ? <div className={styles.choiceTags}>
                      <button aria-describedby="rpg-approval-feedback" data-testid="rpg-accept-choice" type="button" disabled={busy} onClick={() => void approvePendingTurn()}>{busy ? "正在原子提交…" : "核准寫入正文、狀態與收據"}</button>
                      <button data-testid="rpg-reject-choice" className={styles.cancelTurn} type="button" disabled={busy} onClick={() => void rejectPendingTurn()}>拒絕候選（不結算）</button>
                      <p id="rpg-approval-feedback" className={styles.approvalFeedback} data-state={operationError ? "failed" : busy ? "running" : "ready"}>{operationError?.message ?? status}</p>
                    </div> : null}
                    {busy && !pendingTurnCandidate ? <button data-testid="rpg-cancel-turn" className={styles.cancelTurn} type="button" onClick={cancelTurn}>停止本回合（不結算）</button> : null}
                  </div>
                </aside>
              ) : null}
            </section>
          </section>

          <aside className={styles.rightRail}>
            <section className={styles.questCard}>
              <header><span>{dashboardCopy.questKind}</span><b>{trackedProgress}%</b></header>
              <h3>{dashboardCopy.questTitle}</h3>
              <progress max={100} value={trackedProgress} />
              <p>{progression.journey.mainlineGoal}</p>
              <div className={styles.gateGrid} aria-label="主線門檻">
                {([
                  ["數值門檻", progression.journey.gates.power],
                  ["情報門檻", progression.journey.gates.information],
                  ["道具門檻", progression.journey.gates.item],
                ] as const).map(([label, gate]) => <span key={label} data-ready={gate.ready}><b>{gate.ready ? "可通過" : "未滿足"}</b>{label}<small>{gate.current}／{gate.required}</small></span>)}
              </div>
            </section>

            <section className={styles.identityPathCard} data-testid="rpg-identity-path">
              <header><small>LIFE PATH</small><span>第二層</span></header>
              <h3>{progression.journey.identityLabel}</h3>
              <p>每次核准選擇都會累積人格與行事路線；這是角色走過的人生，不是可以無痛重置的職業皮膚。</p>
              <div className={styles.pathScores}>
                <span data-leading={progression.journey.identityStrategy === "steady"}>守序 <b>{progression.journey.identityScores.steady}</b></span>
                <span data-leading={progression.journey.identityStrategy === "resource"}>結盟 <b>{progression.journey.identityScores.resource}</b></span>
                <span data-leading={progression.journey.identityStrategy === "bold"}>破界 <b>{progression.journey.identityScores.bold}</b></span>
              </div>
              <small>目前承諾強度 {progression.journey.identityCommitment}</small>
            </section>

            <section className={styles.freedomCard} data-testid="rpg-free-world">
              <header><div><small>LIVING WORLD</small><h3>今天想做什麼？</h3></div><b>{progression.journey.worldFreedom}</b></header>
              <p>不必等主線指令；先選生活目標，系統會把它轉成同一套可驗證候選。</p>
              <div className={styles.activityGrid}>
                {journeyActivities.map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    data-testid={`rpg-activity-${activity.id}`}
                    onClick={() => {
                      setCustomAction(activity.action);
                      setSelectedChoice(null);
                      setStatus(`已準備「${activity.label}」自由行動；確認文字後建立候選，尚未寫入 Canon。`);
                    }}
                  >
                    <b>{activity.label}</b>
                    <small>{activity.description}</small>
                  </button>
                ))}
              </div>
            </section>

            {activeMode === "management" ? (
              <section className={styles.managementCard}>
                <header><div><small>TODAY FORECAST</small><h3>經營預估</h3></div><span data-alert={progression.management.risk >= 60}>{progression.management.risk >= 80 ? "高風險" : progression.management.risk >= 60 ? "警戒" : "穩定"}</span></header>
                <div className={styles.managementCoreMetrics} data-testid="management-core-metrics">
                  <span>資金 <b>{formatNumber(progression.management.cash)}</b></span>
                  <span>人力 <b>{progression.management.staff} 人</b></span>
                  <span>品質 <b>{Math.round(data.storyState.resources["management.quality"] ?? 70)}／100</b></span>
                  <span>聲望 <b>{formatNumber(progression.management.reputation)}／100</b></span>
                  <span>風險 <b>{formatNumber(progression.management.risk)}／100</b></span>
                </div>
                <div className={styles.metricGrid}>
                  <span>員工 <b>{progression.management.staff} 人</b></span><span>效率 <b>{progression.management.employeeEfficiency}%</b></span><span>需求 <b>{formatNumber(progression.management.expectedDemand)}</b></span><span>銷量 <b>{formatNumber(progression.management.expectedSales)}</b></span><span>營收 <b>{formatNumber(progression.management.expectedRevenue)}</b></span><span>淨利 <b data-negative={progression.management.expectedNetProfit < 0}>{signed(progression.management.expectedNetProfit)}</b></span>
                </div>
                <Meter label="士氣" value={progression.management.morale} />
                <Meter label="顧客滿意" value={progression.management.satisfaction} />
                <Meter label="營運風險" value={progression.management.risk} inverted />
                <small>下一個正式三選一會把營運結果與故事、資源及收據一起結算。</small>
              </section>
            ) : (
              <section className={styles.worldCard}>
                <header><small>WORLD PULSE</small><h3>世界與隊伍</h3></header>
                <dl><div><dt>所在地</dt><dd>{progression.procedural.currentLocationVariant ?? data.storyState.locationState ?? "未知"}</dd></div><div><dt>世界面向</dt><dd>{progression.procedural.currentAspect ?? "尚未揭露"}</dd></div><div><dt>危險</dt><dd>{data.storyState.riskState ?? "未知"}</dd></div><div><dt>隊伍信任</dt><dd>{Math.round(data.storyState.relationships["rpg.partyTrust"] ?? 0)}</dd></div><div><dt>世界動能</dt><dd>{Math.round(data.storyState.resources["world.momentum"] ?? 0)}</dd></div><div><dt>不穩定度</dt><dd>{Math.round(data.storyState.resources["world.instability"] ?? 0)}</dd></div></dl>
              </section>
            )}

            {storyPlayMode === "rpg" ? (
              <section className={styles.walletCard}>
                <header><small>WALLET & EXCHANGE</small><h3>貨幣與價值</h3></header>
                <div><span>金幣<small>旅店、交易、情報</small></span><b>{formatNumber(progression.currencies.gold)}</b></div>
                <div><span>靈石<small>修煉、煉製、稀有交換</small></span><b>{progression.currencies.spiritStone}</b></div>
                <div><span>公會憑證<small>特殊委託與限定物品</small></span><b>{progression.currencies.guildToken}</b></div>
                <small>交易與兌換只會出現在正式選項中，避免帳本在正文之外先行變更。</small>
              </section>
            ) : storyPlayMode === "romance" ? (
              <section className={styles.walletCard}>
                <header><small>RELATIONSHIP PULSE</small><h3>關係與情緒</h3></header>
                <div><span>信任<small>核准互動後才會改變</small></span><b>{Math.round(data.storyState.relationships["rpg.partyTrust"] ?? 0)}</b></div>
                <div><span>親密進展<small>共同事件與真實回應</small></span><b>{Math.round(data.storyState.resources["romance.intimacy"] ?? 0)}</b></div>
                <div><span>關係張力<small>越高越需要處理衝突</small></span><b>{Math.round(data.storyState.resources["romance.tension"] ?? 0)}</b></div>
                <div><span>命運點<small>由正式事件獲得或消耗</small></span><b>{progression.fatePoints}</b></div>
              </section>
            ) : storyPlayMode === "interactive" ? (
              <section className={styles.walletCard}>
                <header><small>BRANCH STATE</small><h3>分支資源</h3></header>
                <div><span>線索<small>可支撐後續判斷</small></span><b>{Math.round(data.storyState.resources["interactive.clues"] ?? 0)}</b></div>
                <div><span>分支動能<small>目前路線的推進程度</small></span><b>{Math.round(data.storyState.resources["interactive.branchMomentum"] ?? 0)}</b></div>
                <div><span>選擇壓力<small>高風險行動會提高</small></span><b>{Math.round(data.storyState.resources["interactive.choicePressure"] ?? 0)}</b></div>
                <div><span>命運點<small>由正式事件獲得或消耗</small></span><b>{progression.fatePoints}</b></div>
              </section>
            ) : (
              <section className={styles.walletCard}>
                <header><small>MANAGEMENT CAPITAL</small><h3>經營資源</h3></header>
                <div><span>可用資金<small>收入、支出與投資</small></span><b>{formatNumber(progression.management.cash)}</b></div>
                <div><span>聲望<small>影響合作與需求</small></span><b>{formatNumber(progression.management.reputation)}</b></div>
                <div><span>員工士氣<small>影響效率與穩定</small></span><b>{formatNumber(progression.management.morale)}</b></div>
                <div><span>營運風險<small>高於 60 需要優先處理</small></span><b>{formatNumber(progression.management.risk)}</b></div>
              </section>
            )}
          </aside>
        </section>
        </>
      )}

      {activated && dashboardExpanded ? (
        <section className={styles.detailDock} data-testid="rpg-dashboard-details">
          <nav aria-label="RPG 詳細功能">
            {detailPanels.map((panel) => (
              <button key={panel} type="button" className={visiblePanel === panel ? styles.activePanel : ""} onClick={() => setActivePanel(panel)}>{DETAIL_PANEL_LABELS[panel]}</button>
            ))}
          </nav>

          {visiblePanel === "inventory" ? (
            <div className={styles.inventoryPanel}>
              <header><div><small>INVENTORY & TREASURES</small><h2>背包、裝備與寶物功用</h2></div><p>負重 {progression.carryWeight}／{progression.derived.carryCapacity} · 每件物品都標示用途、價值與真實效果。</p></header>
              <div className={styles.inventoryGrid}>
                {progression.inventory.map((item) => (
                  <article key={item.itemId} data-rarity={item.rarity}>
                    <header><span>{item.proceduralPill ? `${item.proceduralPill.grade}丹藥` : `${item.category} · ${item.rarity}`}</span><b>×{item.quantity}</b></header>
                    <h3>{item.name}{item.equipped ? <em>已裝備</em> : null}</h3>
                    <p>{item.description}</p><strong>{item.effectDescription}</strong>
                    {item.proceduralPill ? <dl className={styles.pillMetrics}><div><dt>藥力</dt><dd>{item.proceduralPill.potency}</dd></div><div><dt>穩定</dt><dd>{item.proceduralPill.stability}</dd></div><div><dt>保存</dt><dd>{item.proceduralPill.shelfLife} 日</dd></div></dl> : null}
                    <footer><span>價值 {item.value ? `${formatNumber(item.value)} 金幣` : "任務限定"} · {item.weight} kg</span><div><small>{item.equipped ? "目前已裝備" : "使用、消耗或換裝會由正式回合選項結算"}</small></div></footer>
                  </article>
                ))}
              </div>
              <section className={styles.proceduralLibrary} data-testid="procedural-treasure-library">
                <header>
                  <div><small>STORY-MATCHED TREASURE VAULT</small><h3>原創寶物庫 {PROCEDURAL_TREASURE_CAPACITY.toLocaleString("zh-TW")} 件</h3></div>
                  <button type="button" onClick={() => setProceduralLibraryVariant((value) => value + 1)}>換一組故事匹配寶物</button>
                </header>
                <p>只即時挑出三件適合目前故事的候選，不會一次載入整座寶物庫，也不會把候選假裝成已取得物品。</p>
                <div className={styles.proceduralCandidateGrid}>
                  {proceduralLibrary.treasures.map((treasure) => (
                    <article key={treasure.id} data-status="candidate-not-owned">
                      <header><span>{treasure.storyAffinity} · {treasure.category}</span><b>尚未取得</b></header>
                      <h4>{treasure.name}</h4>
                      <p>{treasure.function}</p>
                      <dl>
                        <div><dt>限制</dt><dd>{treasure.limitation}</dd></div>
                        <div><dt>代價</dt><dd>{treasure.cost}</dd></div>
                      </dl>
                      <small>需要在故事中出現，並由你核准相應選擇後，才會正式進入背包。</small>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {visiblePanel === "quests" ? (
            <div className={styles.recordsPanel}>
              <section><small>QUESTS</small><h2>任務進度</h2>{Object.keys(data.storyState.questStates).length ? Object.entries(data.storyState.questStates).map(([key, value]) => <article key={key}><div><b>{key}</b><span>{value}%</span></div><progress max={100} value={Number(value) || 0} /></article>) : <p>尚無任務；核准第一個選擇後會建立主線進度。</p>}</section>
              <section><small>ACHIEVEMENTS</small><h2>成就與稱號</h2>{Object.keys(data.storyState.achievementStates).length ? Object.entries(data.storyState.achievementStates).map(([key, value]) => <article key={key}><div><b>{key}</b><span>{value}%</span></div><progress max={100} value={Number(value) || 0} /></article>) : <p>尚無成就進度。</p>}</section>
            </div>
          ) : null}

          {visiblePanel === "relationships" ? (
            <div className={styles.recordsPanel}>
              <section><small>RELATIONSHIPS</small><h2>人物關係</h2>{Object.keys(data.storyState.relationships).length ? Object.entries(data.storyState.relationships).map(([key, value]) => <article key={key}><div><b>{key}</b><span>{Math.round(value)}</span></div><progress max={200} value={value + 100} /></article>) : <p>尚未透過故事建立可計算的關係。</p>}</section>
              <section><small>FACTIONS</small><h2>陣營聲望</h2>{Object.keys(data.storyState.factionStanding).length ? Object.entries(data.storyState.factionStanding).map(([key, value]) => <article key={key}><div><b>{key}</b><span>{Math.round(value)}</span></div><progress max={200} value={value + 100} /></article>) : <p>目前陣營中立；後續選擇會分別累積，不會只用一個總好感。</p>}</section>
            </div>
          ) : null}

          {visiblePanel === "log" ? (
            <div className={styles.logPanel}>
              <header><small>ADVENTURE LOG</small><h2>真正寫入的選擇與世界變化</h2><p>這些紀錄來自核准交易，不是 AI 臨時描述，可用來防止死亡角色復活、物品回來或任務倒退。</p></header>
              {data.acceptedChoices.length ? data.acceptedChoices.slice(0, 20).map((choice) => (
                <article key={choice.id}><time>{new Date(choice.acceptedAt).toLocaleString("zh-TW")}</time><div><h3>{choice.choiceLabel ?? `${choice.choiceKey}｜故事選擇`}</h3><p>{choice.acceptedText.slice(0, 260)}{choice.acceptedText.length > 260 ? "…" : ""}</p><footer><span>StoryState {choice.storyStateRevisionBefore} → {choice.storyStateRevisionAfter}</span><span>交易 {choice.effectOperationId}</span></footer></div></article>
              )) : <p className={styles.empty}>尚未核准任何選擇。選擇 A／B／C 並確認後，完整結果會出現在這裡。</p>}
              <section aria-label="RPG 回合收據" data-testid="rpg-turn-receipts">
                <h3>RPG 回合收據</h3>
                <p>每張收據與正文、StoryState、分支及核准交易在同一筆原子提交中產生。</p>
                {data.rpgTurnReceipts.length ? data.rpgTurnReceipts.slice(0, 20).map((receipt) => (
                  <details key={receipt.id}>
                    <summary>第 {receipt.turnNumber} 回合 · {receipt.choiceKey}｜{receipt.choiceTitle} · {receipt.outcome}</summary>
                    <dl>
                      <div><dt>收據</dt><dd>{receipt.receiptId}</dd></div>
                      <div><dt>版本</dt><dd>StoryState {receipt.sourceRevision} → {receipt.resultingRevision}</dd></div>
                      <div><dt>判定</dt><dd>{receipt.roll}／成功率 {receipt.successChance}% · {receipt.selectedStrategy}</dd></div>
                      <div><dt>資源</dt><dd>{Object.entries(receipt.appliedResourceChanges ?? {}).map(([key, value]) => `${key} ${signed(value)}`).join("、") || "無"}</dd></div>
                      <div><dt>敘事量表</dt><dd>{Object.entries(receipt.appliedMeterChanges).map(([key, value]) => `${key} ${signed(value ?? 0)}`).join("、") || "無"}</dd></div>
                      <div><dt>境界</dt><dd>{receipt.appliedRealmChanges?.breakthrough ? `${receipt.appliedRealmChanges.from?.definitionId ?? "mortal"} → ${receipt.appliedRealmChanges.to?.definitionId ?? "unknown"}` : "本回合未跨境"}</dd></div>
                    </dl>
                  </details>
                )) : <p className={styles.empty}>尚無正式 RPG 回合收據。</p>}
              </section>
            </div>
          ) : null}

          {visiblePanel === "rules" ? (
            <div className={styles.rulesPanel}>
              <section><small>AUTHOR SETTINGS</small><h2>作者設定</h2><label>成長速度<select value={rules.growthPace} onChange={(event) => updateRules({ ...rules, growthPace: event.target.value as RpgRuleSettings["growthPace"] })}><option value="fast">快速</option><option value="standard">標準</option><option value="realistic">寫實</option></select></label><label>隨機程度<select value={rules.randomness} onChange={(event) => updateRules({ ...rules, randomness: event.target.value as RpgRuleSettings["randomness"] })}><option value="story">劇情型</option><option value="balanced">平衡型</option><option value="high_risk">高風險型</option></select></label><label>後果預覽<select value={rules.choicePreview} onChange={(event) => updateRules({ ...rules, choicePreview: event.target.value as RpgRuleSettings["choicePreview"] })}><option value="partial">保留未知</option><option value="full">完整顯示</option></select></label><label>事件頻率<select value={rules.eventFrequency} onChange={(event) => updateRules({ ...rules, eventFrequency: Number(event.target.value) as 3 | 4 | 5 })}><option value={3}>每 3 回合</option><option value={4}>每 4 回合</option><option value={5}>每 5 回合</option></select></label></section>
              <section><small>PLAYER CHOICE</small><h2>玩家選擇</h2><p>每回合固定有穩健、關係／資源與冒險三種策略，但它們會依種子、回合與版本輪替到 A／B／C，不以固定位置誤導玩家。</p><ul><li>重新規劃只更換候選顯示，不扣資源也不改 Canon。</li><li>失敗產生補救支線，不會因單次亂數直接壞結局。</li><li>只有另按核准後，正文、狀態、資源與收據才在同一筆交易寫入。</li></ul></section>
              <section><small>SYSTEM LOCK</small><h2>系統鎖定</h2><ul><li>{FORMULA.success}</li><li>{FORMULA.growth}</li><li>{FORMULA.employee}</li><li>{FORMULA.demand}</li><li>{FORMULA.governance}</li></ul><details><summary>查看等級與戰力公式</summary><p>{FORMULA.level}</p><p>{FORMULA.nextLevel}</p><p>{FORMULA.power}</p></details></section>
              <section className={styles.xianxiaForge}><small>USER-AUTHORED RULE FORGE</small><h2>仙俠規則工坊</h2><p>預覽符籙、陣法、職業、境界、契約與情緒原則；採用時必須由正式回合選項帶入，不能繞過收據直接改 Canon。</p><label>規則類型<select value={xianxiaRuleKind} onChange={(event) => { setXianxiaRuleKind(event.target.value as XianxiaRuleKind); setXianxiaRuleVariant((value) => value + 1); }}>{XIANXIA_RULE_KIND_OPTIONS.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}</select></label>{xianxiaRuleCandidate ? <article><header><span>{xianxiaRuleCandidate.rank} · {xianxiaRuleCandidate.kindLabel}</span><b>Canonical mutation = {xianxiaRuleCandidate.canonicalMutation}</b></header><h3>{xianxiaRuleCandidate.title}</h3><p>{xianxiaRuleCandidate.storyHook}</p><dl><div><dt>前置</dt><dd>{xianxiaRuleCandidate.preconditions.join("、")}</dd></div><div><dt>成本</dt><dd>{xianxiaRuleCandidate.costs.join("、")}</dd></div><div><dt>效果</dt><dd>{xianxiaRuleCandidate.effects.join("、")}</dd></div><div><dt>風險</dt><dd>{xianxiaRuleCandidate.risks.join("、")}</dd></div><div><dt>反制</dt><dd>{xianxiaRuleCandidate.counters.join("、")}</dd></div></dl><footer><button type="button" disabled={busy} onClick={() => setXianxiaRuleVariant((value) => value + 1)}>換一個預覽</button><small>預覽不寫入 Canon；正式採用會出現在三選一與回合收據。</small></footer></article> : null}</section>
            </div>
          ) : null}

          {visiblePanel === "characters" ? (
            <div className={styles.librarySection}>
              <header><div><small>CHARACTER VAULT</small><h2>我喜歡的人物庫</h2></div><p>內建角色可直接加入作品；自創角色保存在這台裝置，加入作品後才進入專案資料。</p></header>
              <section className={styles.proceduralLibrary} data-testid="procedural-character-library">
                <header>
                  <div><small>STORY-MATCHED CAST</small><h3>原創人物庫 {PROCEDURAL_CHARACTER_CAPACITY.toLocaleString("zh-TW")} 人</h3></div>
                  <button type="button" onClick={() => setProceduralLibraryVariant((value) => value + 1)}>換一組故事匹配人物</button>
                </header>
                <p>依目前類型、地點與衝突即時挑出三名原創人物；人物庫按需計算，不會一次載入十萬筆。</p>
                <div className={styles.proceduralCandidateGrid}>
                  {proceduralLibrary.characters.map((candidate) => {
                    const alreadyAdded = data.characters.some((character) => character.name === candidate.name);
                    return (
                      <article key={candidate.id}>
                        <header><span>{candidate.storyAffinity}</span><b>{candidate.role}</b></header>
                        <h4>{candidate.name}</h4>
                        <p>{candidate.personality}</p>
                        <dl>
                          <div><dt>自己的目標</dt><dd>{candidate.goal}</dd></div>
                          <div><dt>合作界線</dt><dd>{candidate.refusalCondition}</dd></div>
                        </dl>
                        <footer>
                          <small>{candidate.stance}</small>
                          <button type="button" disabled={busy || alreadyAdded} onClick={() => void addProceduralCharacterToProject(candidate)}>
                            {alreadyAdded ? "已在目前作品" : "加入目前作品"}
                          </button>
                        </footer>
                      </article>
                    );
                  })}
                </div>
              </section>
              <div className={styles.libraryLayout}>
                <form onSubmit={(event) => { event.preventDefault(); saveTemplate(); }}><h3>創造自己的角色</h3><label>姓名<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>角色原型<input value={archetype} onChange={(event) => setArchetype(event.target.value)} placeholder="例：被放逐的星艦領航員" /></label><label>身分<input value={identity} onChange={(event) => setIdentity(event.target.value)} /></label><label>性格<textarea rows={3} value={personality} onChange={(event) => setPersonality(event.target.value)} /></label><label>目標<textarea rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} /></label><button type="submit">加入我的人物庫</button></form>
                <div className={styles.characterGrid}>{library.map((template) => (
                  <article key={template.templateId}>
                    <div>
                      <span>{template.builtin ? "內建" : "我的角色"}{template.matureTheme ? " · 成熟題材" : ""}</span>
                      <h3>{template.name}</h3>
                      <small>
                        {template.gender === "woman" ? "女性" : template.gender === "man" ? "男性" : "角色"}
                        {template.age ? ` · ${template.age} 歲` : ""}
                        {template.rpgArchetype ? ` · ${CHARACTER_RPG_ARCHETYPES.find((option) => option.id === template.rpgArchetype)?.label ?? "RPG 角色"}` : ""}
                      </small>
                      <small>{template.archetype}</small>
                    </div>
                    <p>{template.personality || template.identity || "等待你補上更多角色設定。"}</p>
                    <b>目標：{template.goal || "尚未設定"}</b>
                    <footer>
                      <button type="button" disabled={busy} onClick={() => void addCharacterToProject(template)}>加入目前作品</button>
                      {!template.builtin ? <button type="button" className={styles.danger} onClick={() => removeTemplate(template)}>移除人物庫</button> : null}
                    </footer>
                  </article>
                ))}</div>
              </div>
              <p className={styles.projectCast}>目前作品角色：{data.characters.length ? data.characters.map((character) => character.name).join("、") : "尚未建立角色"}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
