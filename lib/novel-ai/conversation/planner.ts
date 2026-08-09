import { sha256Hex, stableStringify } from "../closed-ai-cache";
import type { PlatformTaskType } from "../router/platform-types";
import { STUDIO_CLOSED_AGENT_TOOL_IDS } from "../web/studio-closed-agent-tools";
import {
  CONVERSATION_LOCAL_TOOL_IDS,
  type ConversationPlannerToolId,
} from "./tool-registry";

export const CONVERSATION_PLANNER_SCHEMA_VERSION =
  "conversation-natural-language-planner-v1" as const;

export type ConversationIntent =
  | "continue_writing"
  | "rewrite_selection"
  | "expand_scene"
  | "strengthen_dialogue"
  | "strengthen_emotion"
  | "adjust_pacing"
  | "chapter_outline"
  | "chapter_hook"
  | "create_abc_choices"
  | "rpg_turn"
  | "rpg_custom_action"
  | "character_candidate"
  | "world_rule_candidate"
  | "story_bible_query"
  | "consistency_check"
  | "timeline_check"
  | "project_search"
  | "attachment_analysis"
  | "learning_rule_candidate"
  | "backup_create"
  | "backup_restore"
  | "project_export"
  | "dashboard_query"
  | "general_assistant";

export type ConversationExecutionKind =
  | "closed_agent"
  | "rpg"
  | "attachment"
  | "learning_import"
  | "repository"
  | "query";

export type ConversationPlan = {
  schemaVersion: typeof CONVERSATION_PLANNER_SCHEMA_VERSION;
  intent: ConversationIntent;
  executionKind: ConversationExecutionKind;
  taskType: PlatformTaskType | null;
  objective: string;
  inputDigest: string;
  planDigest: string;
  allowedToolIds: ConversationPlannerToolId[];
  candidateOnly: boolean;
  approvalRequired: boolean;
  targetStore: "chapters" | "characters" | "worldRules" | "learningRules" | null;
  opensArtifactDrawer: boolean;
  confidence: number;
  reasonCode: string;
};

type PlannerInput = {
  content: string;
  attachmentCount?: number;
  hasActiveRpgTurn?: boolean;
};

type IntentRule = {
  intent: ConversationIntent;
  pattern: RegExp;
  taskType: PlatformTaskType | null;
  executionKind: ConversationExecutionKind;
  targetStore?: ConversationPlan["targetStore"];
  approvalRequired?: boolean;
  opensArtifactDrawer?: boolean;
};

const RULES: IntentRule[] = [
  {
    intent: "dashboard_query",
    pattern: /(?:查看|打開|顯示|目前).*(?:狀態|多少錢|金錢|人物關係|裝備|背包|資源)|^(?:我現在有多少錢|查看狀態)$/iu,
    taskType: null,
    executionKind: "query",
    opensArtifactDrawer: true,
  },
  {
    intent: "backup_restore",
    pattern: /(?:回復|恢復|還原|restore).*(?:備份|backup)|(?:備份|backup).*(?:回復|恢復|還原|restore)/iu,
    taskType: null,
    executionKind: "repository",
  },
  {
    intent: "backup_create",
    pattern: /(?:建立|新增|製作|create|make).*(?:備份|backup)|^(?:備份|backup)$/iu,
    taskType: null,
    executionKind: "repository",
  },
  {
    intent: "project_export",
    pattern: /(?:匯出|導出|export).*(?:作品|小說|專案|project|novel)?/iu,
    taskType: null,
    executionKind: "repository",
  },
  {
    intent: "learning_rule_candidate",
    pattern: /(?:建立|產生|整理|抽取|萃取).*(?:學習規則|寫作規則|敘事規則|learning rule)|(?:加入|匯入).*(?:學習庫|養分)/iu,
    taskType: "knowledge.ruleExtraction",
    executionKind: "learning_import",
    targetStore: "learningRules",
    approvalRequired: true,
  },
  {
    intent: "attachment_analysis",
    pattern: /(?:分析|閱讀|整理|摘要|研究|解析).*(?:附件|檔案|文件|pdf|docx|txt)|(?:附件|檔案|文件).*(?:分析|閱讀|整理|摘要|研究|解析)/iu,
    taskType: "knowledge.ruleExtraction",
    executionKind: "attachment",
  },
  {
    intent: "consistency_check",
    pattern: /(?:檢查|找出|分析).*(?:矛盾|衝突|一致性|設定漏洞)|(?:矛盾|一致性).*(?:檢查|分析)/iu,
    taskType: "story.consistencyCheck",
    executionKind: "closed_agent",
  },
  {
    intent: "timeline_check",
    pattern: /(?:檢查|分析|整理).*(?:時間線|時序|年代)|(?:時間線|時序).*(?:檢查|分析|整理)/iu,
    taskType: "story.timelineCheck",
    executionKind: "closed_agent",
  },
  {
    intent: "story_bible_query",
    pattern: /(?:查詢|查看|根據|對照|問).*(?:story\s*bible|故事聖經|設定集)|(?:story\s*bible|故事聖經).*(?:查詢|查看|告訴|對照)/iu,
    taskType: "story.retrieval",
    executionKind: "closed_agent",
  },
  {
    intent: "project_search",
    pattern: /(?:搜尋|尋找|查找|search).*(?:作品|正文|章節|設定|角色|目前專案)?/iu,
    taskType: "story.retrieval",
    executionKind: "closed_agent",
  },
  {
    intent: "create_abc_choices",
    pattern: /(?:建立|產生|給我|設計).*(?:a\s*[／/]\s*b\s*[／/]\s*c|三選一|三個選項)|(?:三選一|a\s*[／/]\s*b\s*[／/]\s*c).*(?:選項|行動|分支)?/iu,
    taskType: "chapter.abcChoices",
    executionKind: "rpg",
    approvalRequired: true,
  },
  {
    intent: "rpg_turn",
    pattern: /(?:執行|開始|繼續|進行|玩).*(?:rpg|回合|遊戲)|(?:rpg|故事回合).*(?:繼續|下一|開始)/iu,
    taskType: "chapter.continue",
    executionKind: "rpg",
    targetStore: "chapters",
    approvalRequired: true,
  },
  {
    intent: "chapter_hook",
    pattern: /(?:建立|產生|加強|設計).*(?:章尾|鉤子|懸念|hook)|(?:章尾|鉤子).*(?:建立|產生|加強)/iu,
    taskType: "chapter.endingCandidates",
    executionKind: "closed_agent",
    targetStore: "chapters",
    approvalRequired: true,
  },
  {
    intent: "chapter_outline",
    pattern: /(?:建立|產生|規劃|列出).*(?:章節大綱|下一章大綱|大綱)|(?:章節|下一章).*(?:大綱|規劃)/iu,
    taskType: "chapter.outline",
    executionKind: "closed_agent",
    targetStore: "chapters",
    approvalRequired: true,
  },
  {
    intent: "rewrite_selection",
    pattern: /(?:改寫|重寫|潤寫|rewrite)/iu,
    taskType: "chapter.rewrite",
    executionKind: "closed_agent",
    targetStore: "chapters",
    approvalRequired: true,
  },
  {
    intent: "expand_scene",
    pattern: /(?:擴寫|擴展|補完|展開).*(?:場景|片段|段落|章節)?/iu,
    taskType: "chapter.expand",
    executionKind: "closed_agent",
    targetStore: "chapters",
    approvalRequired: true,
  },
  {
    intent: "strengthen_dialogue",
    pattern: /(?:強化|加強|改善|調整).*(?:對話|台詞|潛台詞)/iu,
    taskType: "character.dialogue",
    executionKind: "closed_agent",
    targetStore: "chapters",
    approvalRequired: true,
  },
  {
    intent: "strengthen_emotion",
    pattern: /(?:強化|加強|深化|增加).*(?:情緒|情感|張力|感情)/iu,
    taskType: "chapter.expand",
    executionKind: "closed_agent",
    targetStore: "chapters",
    approvalRequired: true,
  },
  {
    intent: "adjust_pacing",
    pattern: /(?:調整|改善|加快|放慢|檢查).*(?:節奏|步調|pacing)/iu,
    taskType: "story.pacingCheck",
    executionKind: "closed_agent",
    targetStore: "chapters",
    approvalRequired: true,
  },
  {
    intent: "character_candidate",
    pattern: /(?:建立|新增|創建|設計|修改|調整).*(?:角色|人物)|(?:角色|人物).*(?:建立|新增|修改|設定)/iu,
    taskType: "character.create",
    executionKind: "closed_agent",
    targetStore: "characters",
    approvalRequired: true,
  },
  {
    intent: "world_rule_candidate",
    pattern: /(?:建立|新增|創建|設計|修改|調整).*(?:世界規則|世界觀|設定規則)|(?:世界規則|世界觀).*(?:建立|新增|修改|設定)/iu,
    taskType: "world.ruleCandidate",
    executionKind: "closed_agent",
    targetStore: "worldRules",
    approvalRequired: true,
  },
  {
    intent: "continue_writing",
    pattern: /(?:續寫|繼續寫|接著寫|往下寫|延續故事|下一段)/iu,
    taskType: "chapter.continue",
    executionKind: "closed_agent",
    targetStore: "chapters",
    approvalRequired: true,
  },
];

function normalizeObjective(value: string) {
  return value.replace(/\r\n?/gu, "\n").trim().slice(0, 32_000);
}

function isRpgChoice(content: string, hasActiveRpgTurn: boolean) {
  return hasActiveRpgTurn && /^(?:選擇\s*)?[ABCＡＢＣ](?:\s*[：:].*)?$/iu.test(content);
}

function selectedRule(input: PlannerInput, objective: string): IntentRule | null {
  if (isRpgChoice(objective, Boolean(input.hasActiveRpgTurn))) {
    return {
      intent: "rpg_custom_action",
      pattern: /./u,
      taskType: "chapter.continue",
      executionKind: "rpg",
      targetStore: "chapters",
      approvalRequired: true,
    };
  }
  if (input.hasActiveRpgTurn && objective && !RULES.some((rule) => rule.pattern.test(objective))) {
    return {
      intent: "rpg_custom_action",
      pattern: /./u,
      taskType: "chapter.continue",
      executionKind: "rpg",
      targetStore: "chapters",
      approvalRequired: true,
    };
  }
  const explicitRule = RULES.find((rule) => rule.pattern.test(objective)) ?? null;
  if (explicitRule?.intent === "learning_rule_candidate") return explicitRule;
  if ((input.attachmentCount ?? 0) > 0) {
    return RULES.find((rule) => rule.intent === "attachment_analysis") ?? null;
  }
  return explicitRule;
}

export async function planConversationRequest(
  input: PlannerInput,
): Promise<ConversationPlan> {
  const objective = normalizeObjective(input.content);
  if (!objective && (input.attachmentCount ?? 0) === 0) {
    throw Object.assign(new Error("Conversation input cannot be empty."), {
      code: "CONVERSATION_INPUT_EMPTY",
    });
  }
  const rule = selectedRule(input, objective);
  const intent = rule?.intent ?? "general_assistant";
  const executionKind = rule?.executionKind ?? "closed_agent";
  const taskType = rule?.taskType ?? "assistant.general";
  const approvalRequired = Boolean(rule?.approvalRequired);
  const targetStore = rule?.targetStore ?? null;
  const allowedToolIds: ConversationPlannerToolId[] = (() => {
    if (executionKind === "closed_agent") {
      return [...STUDIO_CLOSED_AGENT_TOOL_IDS];
    }
    if (executionKind === "rpg") {
      return [intent === "rpg_custom_action"
        ? CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
        : CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan];
    }
    if (executionKind === "attachment") return [CONVERSATION_LOCAL_TOOL_IDS.attachmentParse];
    if (executionKind === "learning_import") return [CONVERSATION_LOCAL_TOOL_IDS.atomicLearningImport];
    if (executionKind === "query") return [CONVERSATION_LOCAL_TOOL_IDS.storyStateQuery];
    if (intent === "backup_create") return [CONVERSATION_LOCAL_TOOL_IDS.backupCreate];
    if (intent === "backup_restore") return [CONVERSATION_LOCAL_TOOL_IDS.backupRestoreGuide];
    if (intent === "project_export") return [CONVERSATION_LOCAL_TOOL_IDS.projectExport];
    return [];
  })();
  const inputDigest = await sha256Hex(objective || `[${input.attachmentCount} local attachments]`);
  const planBody = {
    schemaVersion: CONVERSATION_PLANNER_SCHEMA_VERSION,
    intent,
    executionKind,
    taskType,
    inputDigest,
    allowedToolIds,
    candidateOnly: executionKind !== "query",
    approvalRequired,
    targetStore,
    opensArtifactDrawer: Boolean(rule?.opensArtifactDrawer),
    reasonCode: rule ? `NATURAL_LANGUAGE_${intent.toUpperCase()}` : "NATURAL_LANGUAGE_GENERAL_ASSISTANT",
  };
  return {
    ...planBody,
    objective,
    planDigest: await sha256Hex(stableStringify(planBody)),
    confidence: rule ? 0.9 : 0.55,
  };
}

export const CONVERSATION_PLANNER_TOOL_ALLOWLIST = [
  ...STUDIO_CLOSED_AGENT_TOOL_IDS,
  ...Object.values(CONVERSATION_LOCAL_TOOL_IDS),
] as const;
