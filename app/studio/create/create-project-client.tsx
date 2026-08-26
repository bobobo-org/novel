"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  STORY_LIBRARY,
  listStoryTopics,
  resolveStoryTopic,
} from "@/lib/novel-data/story-library";
import {
  buildProjectBundle,
  buildSeedCandidate,
  createDraft,
} from "@/lib/novel-ai/domain/creation";
import {
  selectedStoryPlayMode,
  STORY_PLAY_MODE_LABELS,
  type StoryPlayModeId,
} from "@/lib/novel-ai/domain/play-mode";
import {
  topicWorldContractAt,
  type TopicWorldPlayMode,
} from "@/lib/novel-ai/game/topic-world-contract";
import {
  buildTopicWorldFamilyStageMatrix,
  listTopicWorldFamilyStageCandidates,
  restoreTopicWorldFamilyDraftSelection,
  serializeTopicWorldFamilyDraftSelection,
  type TopicWorldFamilyStageMatrix,
  type TopicWorldStageFamily,
  type TopicWorldStageMember,
} from "@/lib/novel-ai/game/topic-world-family-stage-matrix";
import {
  makeRecord,
  optionalValue,
  type Chapter,
  type NovelProject,
  type ProjectCreationDraft,
  type ProjectSeed,
  type ReaderState,
} from "@/lib/novel-ai/domain";
import {
  createNovelRepository,
  persistenceFailureOrNull,
  type PersistenceFailure,
} from "@/lib/novel-ai/repository";
import { createProjectBackup } from "@/lib/novel-ai/repository/backup";
import { mirrorProjectToLegacyStudio } from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import {
  buildProjectPlaymodeCloneDraftWithRetry,
  isCurrentProjectPlaymodeCloneDraft,
  type ProjectCloneSourceSummary,
} from "@/lib/novel-ai/repository/project-playmode-clone";
import {
  createCreationStorySeedRequestGate,
  creationStorySeedPrompt,
  mergeCreationStorySeed,
  parseCreationStorySeed,
  type CreationStorySeed,
} from "@/lib/novel-ai/web/creation-story-seed";
import { runStudioPreCreationClosedAI } from "@/lib/novel-ai/web/studio-closed-ai";
import PersistenceRecoveryNotice from "../persistence-recovery-notice";

const DRAFT_KEY = "novel_p2_creation_draft";
const CREATION_AI_DEADLINE_MS = 24_000;
const MODE_NEUTRAL_STORY_SEED_LABEL = "尚未選定創作／遊玩方式；只產生不綁定玩法的共同故事核心，不替作者選擇玩法";
const CLOSED_AI_UNAVAILABLE_CODES = new Set([
  "NO_CLOSED_PROVIDER_AVAILABLE",
  "CLOSED_AI_EXPLICIT_PROSE_BACKEND_REQUIRED",
  "AI_LOCAL_PROVIDER_REQUIRED",
  "LOCAL_PROVIDER_NOT_READY",
]);

function draftStorageKey(cloneFrom: string | null) {
  return `${DRAFT_KEY}:${cloneFrom ? `clone:${cloneFrom}` : "new"}`;
}

const questions = [
  {
    key: "story",
    title: "這是一個關於什麼的故事？",
    choices: ["一段改變命運的冒險", "一場人物關係的考驗", "一個逐步揭開的謎團"],
  },
  {
    key: "familyIntent",
    title: "哪一個陣營／家族／宗門會走上舞台？",
    choices: ["守成組織｜想保住傳承，內部卻有人要求改革", "新興團體｜想打破舊秩序，但資源與名分不足", "邊緣陣營｜同時受兩方拉攏，必須選擇代價"],
  },
  {
    key: "conflict",
    title: "主角想完成什麼，又被什麼阻擋？",
    choices: ["守住所愛的人，卻被強大制度逼迫讓步", "找回失去的真相，但每次追查都要付出代價", "證明自己的選擇，卻必須先克服內心恐懼"],
  },
  {
    key: "worldRule",
    title: "這個世界不可違背的規則是什麼？",
    choices: ["每次獲得力量都必須付出代價", "真相只能由行動證明", "平凡秩序下藏著另一套會回應選擇的規則"],
  },
  {
    key: "opening",
    title: "開場從哪個具體事件開始？",
    choices: ["主角收到一個無法忽視的消息", "熟悉的日常秩序突然被打破", "主角必須立刻做出一次會留下後果的選擇"],
  },
] as const;

const proceduralNames = [
  "林知微", "沈星河", "江離", "蘇晚晴", "顧明川", "葉清和", "陸沉舟", "程予安",
  "夏青禾", "周既白", "聞人月", "段雲歸", "艾琳・沃克", "諾亞・陳", "米拉・宋", "里昂・顧",
];
const proceduralGoals = [
  "找回被奪走的選擇權", "守住一個即將消失的家", "查清一段被集體遺忘的真相",
  "在期限前救回重要的人", "阻止熟悉的世界被另一套規則取代", "證明一場被判定失敗的選擇仍有意義",
];
const proceduralWorlds = [
  "一座會記錄每次承諾的山城", "一個以記憶交換資源的群島", "一座白天正常、夜裡重排街道的都市",
  "資源與商路同時中斷的邊境聚落", "由五個互不信任勢力共同維持的空中聚落", "每逢月蝕便會顯露過去分支的古國",
];
const proceduralRules = [
  "任何力量都會留下可追查的代價", "人物只能依自己實際接觸過的情報行動",
  "已發生的事件不能無故重置", "每次改變關係都會同時改變資源與風險",
  "秘密越接近真相，保護它的人就越必須作出選擇", "世界會記住承諾，但不保證用原意實現",
];
const proceduralOpenings = [
  "主角在最熟悉的地方，看見一件只有失蹤者才知道的物品。",
  "一封寫著明日日期的信，要求主角在今晚背叛最信任的人。",
  "原本例行的交易突然中止，而所有人都假裝從未見過主角。",
  "主角醒來後發現自己的名字仍在，卻被另一個人合法使用。",
  "一場不該失敗的儀式成功了，代價卻落在完全無關的人身上。",
  "城門關閉前最後一位旅人，帶來了主角已親手銷毀的證據。",
];

const MIN_SUPPORTING_CAST = 4;

const SUPPORTING_CAST_ROLES = [
  {
    role: "companion",
    roleLabel: "核心同行者",
    relationship: "與主角互補，也敢在主角冒進時提出反對",
  },
  {
    role: "opposition",
    roleLabel: "對立者",
    relationship: "與主角追求互相衝突的結果，但有自己想守住的事物",
  },
  {
    role: "catalyst",
    roleLabel: "事件推動者",
    relationship: "掌握關鍵消息或資源，會主動改變第一幕局面",
  },
  {
    role: "witness",
    roleLabel: "關鍵見證者",
    relationship: "知道部分真相，是否開口會改變眾人對主角的判斷",
  },
] as const;

const TOPIC_SEARCH_ALIASES: Record<string, string[]> = {
  "classic-topic-001": [
    "附身變身（男變女／女變男／靈魂交換）",
    "男變女",
    "女變男",
    "靈魂交換",
  ],
};

function normalizeTopicSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function topicDisplayName(topicId: string, name: string) {
  return topicId === "classic-topic-001"
    ? "附身變身（男變女／女變男／靈魂交換）"
    : name;
}

function topicMatchesSearch(topic: ReturnType<typeof listStoryTopics>[number], query: string) {
  const normalizedQuery = normalizeTopicSearch(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeTopicSearch([
    topicDisplayName(topic.topicId, topic.name),
    topic.description,
    ...topic.subCategories,
    ...topic.tags,
    ...topic.legacyAliases,
    ...(TOPIC_SEARCH_ALIASES[topic.topicId] ?? []),
  ].join(" "));
  return haystack.includes(normalizedQuery);
}

type CoreCastRole = "protagonist" | "companion" | "opposition" | "catalyst" | "witness" | `supporting-${number}`;

type CoreCastEntry = {
  role: CoreCastRole;
  roleLabel: string;
  value: string;
  name: string;
  relationship: string;
  goal: string;
  description: string;
  complete: boolean;
};

function splitProtagonist(value: string) {
  const [rawName, ...details] = value.split(/[｜|]/u).map((item) => item.trim()).filter(Boolean);
  return {
    name: rawName || "尚未設定",
    description: details.join("｜"),
  };
}

function supportingRoleOf(roleLabel: string, index: number): CoreCastRole {
  if (roleLabel.includes("同行") || roleLabel.includes("夥伴")) return "companion";
  if (roleLabel.includes("對立") || roleLabel.includes("反派")) return "opposition";
  if (roleLabel.includes("推動") || roleLabel.includes("引路")) return "catalyst";
  if (roleLabel.includes("見證") || roleLabel.includes("證人")) return "witness";
  return `supporting-${index}`;
}

function parseSupportingCast(value: string | null | undefined): CoreCastEntry[] {
  return (value ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [name = "", roleLabel = "", relationship = "", ...goalParts] = line
        .split(/[｜|]/u)
        .map((item) => item.trim());
      const goal = goalParts.join("｜").trim();
      return {
        role: supportingRoleOf(roleLabel, index),
        roleLabel,
        value: line,
        name,
        relationship,
        goal,
        description: [relationship, goal].filter(Boolean).join("；"),
        complete: Boolean(name && roleLabel && relationship && goal),
      };
    });
}

function serializeSupportingCast(entries: Array<Pick<CoreCastEntry, "name" | "roleLabel" | "relationship" | "goal">>) {
  return entries
    .map((entry) => [entry.name, entry.roleLabel, entry.relationship, entry.goal].join("｜"))
    .join("\n");
}

function supportingCastOf(draft: ProjectCreationDraft) {
  return parseSupportingCast(draft.answers.cast?.value);
}

function supportingCastSlotsOf(draft: ProjectCreationDraft) {
  const entries = supportingCastOf(draft);
  const assigned = new Set<number>();
  const requiredSlots = SUPPORTING_CAST_ROLES.map((template) => {
    const exactIndex = entries.findIndex((entry, index) => !assigned.has(index) && entry.role === template.role);
    const fallbackIndex = entries.findIndex((_, index) => !assigned.has(index));
    const sourceIndex = exactIndex >= 0 ? exactIndex : fallbackIndex;
    if (sourceIndex >= 0) assigned.add(sourceIndex);
    const entry = sourceIndex >= 0 ? entries[sourceIndex] : null;
    return {
      role: template.role,
      roleLabel: entry?.roleLabel || template.roleLabel,
      value: entry?.value || "",
      name: entry?.name || "",
      relationship: entry?.relationship || "",
      goal: entry?.goal || "",
      description: entry?.description || "",
      complete: entry?.complete ?? false,
    } satisfies CoreCastEntry;
  });
  const additionalFamilyMembers = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => !assigned.has(index))
    .map(({ entry }, index) => ({
      ...entry,
      role: `supporting-${SUPPORTING_CAST_ROLES.length + index}` as const,
    }));
  return [...requiredSlots, ...additionalFamilyMembers];
}

function coreCastOf(draft: ProjectCreationDraft, seed = draft.seedCandidate ?? buildSeedCandidate(draft)): CoreCastEntry[] {
  const protagonistValue = seed.protagonist.value?.trim()
    || draft.protagonist.value?.trim()
    || draft.answers.protagonist?.value?.trim()
    || "";
  const protagonist = splitProtagonist(protagonistValue);
  return [
    {
      role: "protagonist",
      roleLabel: "主角",
      value: protagonistValue,
      name: protagonist.name,
      relationship: "作品主要視角與決策者",
      goal: seed.goal.value?.trim() || protagonist.description,
      description: protagonist.description,
      complete: Boolean(protagonistValue),
    },
    ...supportingCastSlotsOf(draft),
  ];
}

function enrichedSeedFromDraft(draft: ProjectCreationDraft, seed = draft.seedCandidate ?? buildSeedCandidate(draft)): ProjectSeed {
  const cast = coreCastOf(draft, seed);
  const protagonist = cast.find((entry) => entry.role === "protagonist")!;
  const opposition = cast.find((entry) => entry.role === "opposition");
  const topicContract = topicContractForCreationDraft(draft);
  const world = draft.answers.world?.value?.trim()
    || seed.world.value?.trim()
    || topicContract?.displaySummary
    || "";
  const worldRule = draft.answers.worldRule?.value?.trim() || "";
  const contractRules = topicContract?.canonRules.join("\n") || "";
  const castDirections = cast
    .filter((entry) => entry.complete)
    .map((entry) => entry.role === "protagonist"
      ? `核心陣容｜主角：${entry.value}`
      : `核心陣容｜${entry.name}｜${entry.roleLabel}｜${entry.relationship}｜${entry.goal}`);
  return {
    ...seed,
    protagonist: protagonist.value
      ? optionalValue(protagonist.name, seed.protagonist.status === "ai_suggested" ? "ai_suggested" : "user_defined")
      : seed.protagonist,
    world: world
      ? optionalValue(
          world,
          draft.answers.world?.value
            ? draft.answers.world.status === "ai_suggested" ? "ai_suggested" : "user_defined"
            : seed.world.value
              ? seed.world.status
              : "inferred",
        )
      : seed.world,
    worldRule: worldRule || contractRules
      ? optionalValue(
          worldRule || contractRules,
          worldRule
            ? draft.answers.worldRule?.status === "ai_suggested" ? "ai_suggested" : "user_defined"
            : "inferred",
        )
      : seed.worldRule,
    opposition: opposition?.complete
      ? optionalValue(`${opposition.name}｜${opposition.relationship}｜${opposition.goal}`, draft.answers.cast?.status === "ai_suggested" ? "ai_suggested" : "user_defined")
      : seed.opposition,
    directions: [
      ...seed.directions.filter((item) => !item.startsWith("核心陣容｜")),
      ...castDirections,
    ],
  };
}

type CandidatePayload = {
  logline?: string;
  protagonist?: string;
  goal?: string;
  weakness?: string;
  world?: string;
  worldRule?: string;
  conflict?: string;
  opposition?: string;
  opening?: string;
  style?: string;
  directions?: string[];
};

function safeLoadDraft(storageKey: string, cloneFrom: string | null) {
  if (typeof localStorage === "undefined") return null;
  const keys = [storageKey];
  for (const key of keys) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null") as ProjectCreationDraft | null;
      if (!parsed?.schemaVersion) continue;
      const parsedCloneFrom = parsed.answers.cloneFrom?.value ?? null;
      if (cloneFrom ? parsedCloneFrom === cloneFrom : !parsedCloneFrom) return parsed;
    } catch {
      // A damaged draft must not block creation or leak into a cloned project.
    }
  }
  return null;
}

function randomIndex(length: number) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % length;
}

function pick<T>(items: readonly T[]) {
  return items[randomIndex(items.length)];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function playModeOf(draft: ProjectCreationDraft) {
  const mode = selectedStoryPlayMode(draft.answers);
  // "interactive" is retained only for older saved projects. New projects
  // use it as a parent choice and must select one concrete three-choice mode.
  return mode === "interactive" ? null : mode;
}

function topicContractForCreationDraft(draft: ProjectCreationDraft) {
  const topic = resolveStoryTopic(draft.genreId);
  const playMode = playModeOf(draft);
  if (!topic) return null;
  const contractMode: TopicWorldPlayMode = playMode === "rpg"
    || playMode === "romance"
    || playMode === "management"
    ? playMode
    : "general";
  const contract = topicWorldContractAt({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: topic.topicId,
    playMode: contractMode,
  });
  if (playMode) return contract;

  // A mode-neutral seed may reuse the general contract's topic/era lookup, but
  // it must not tell the author that General Writing was selected. The author
  // still owns that decision and the UI keeps it explicitly incomplete.
  const neutralSummary = contract.displaySummary
    .split("\n")
    .filter((line) => !/本作採用|採用「一般章節寫作」/u.test(line))
    .join("\n");
  return {
    ...contract,
    displaySummary: `${neutralSummary}\n玩法尚未選定；目前只固定題材、時代、制度與不可變世界規則，不預先啟用任何玩法機制。`,
    playMechanics: {
      ...contract.playMechanics,
      label: "玩法尚未選定",
      dimensions: [],
      rules: [],
    },
  };
}

function topicWorldFamilyMatrixForCreationDraft(draft: ProjectCreationDraft) {
  const topic = resolveStoryTopic(draft.genreId);
  const playMode = playModeOf(draft);
  if (!topic || !playMode) return null;
  const matrixMode: TopicWorldPlayMode = playMode === "rpg"
    || playMode === "romance"
    || playMode === "management"
    ? playMode
    : "general";
  return buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: topic.topicId,
    playMode: matrixMode,
  });
}

function restoredStageFamilyForDraft(
  draft: ProjectCreationDraft,
  expectedMatrix?: TopicWorldFamilyStageMatrix | null,
) {
  const serialized = draft.answers.stageFamily?.value?.trim();
  if (!serialized) return null;
  try {
    const restored = restoreTopicWorldFamilyDraftSelection(serialized);
    if (expectedMatrix && restored.matrix.matrixId !== expectedMatrix.matrixId) return null;
    return restored;
  } catch {
    return null;
  }
}

function relationshipDescription(
  family: TopicWorldStageFamily,
  member: TopicWorldStageMember,
  protagonist: TopicWorldStageMember,
) {
  const relationship = family.relationships.find((entry) => (
    entry.sourceCharacterId === member.characterId && entry.targetCharacterId === protagonist.characterId
  ) || (
    entry.targetCharacterId === member.characterId && entry.sourceCharacterId === protagonist.characterId
  ));
  if (!relationship) return `${family.name}的${member.familyRole}，與${protagonist.name}共同承擔群體局勢`;
  return `${family.name}的${member.familyRole}；與${protagonist.name}是${relationship.kind}，信任 ${relationship.trust}／張力 ${relationship.tension}；${relationship.historyHook}`;
}

function applyStageFamilyToDraft(
  draft: ProjectCreationDraft,
  matrix: TopicWorldFamilyStageMatrix,
  familyId: string,
  preferredCharacterId?: string,
) {
  const family = matrix.stageFamilies.find((entry) => entry.familyId === familyId);
  if (!family) return draft;
  const protagonist = family.members.find((entry) => entry.characterId === preferredCharacterId)
    ?? family.members.find((entry) => entry.stageRole === "男主角候選")
    ?? family.members[0];
  if (!protagonist) return draft;
  const supportingCast = family.members
    .filter((entry) => entry.characterId !== protagonist.characterId)
    .map((member) => ({
      name: member.name,
      roleLabel: member.stageRole,
      relationship: relationshipDescription(family, member, protagonist),
      goal: member.goal,
    }));
  const protagonistValue = `${protagonist.name}｜${protagonist.identity}`;
  const worldValue = matrix.worldSituation;
  const worldRuleValue = matrix.worldContract.canonRules.join("\n");
  const baseSeed = draft.seedCandidate ?? buildSeedCandidate(draft);
  const directions = [
    ...baseSeed.directions.filter((item) => !item.startsWith("上場家族｜") && !item.startsWith("世界勢力｜") && !item.startsWith("世界資產｜")),
    `上場家族｜${family.name}｜${family.organizationKind}「${family.organizationName}」｜${family.stagePremise}`,
    ...matrix.organizations.map((organization) => `世界勢力｜${organization.kindLabel}「${organization.name}」｜${organization.situationBrief}`),
    ...matrix.assetControls.map((asset) => `世界資產｜${asset.category}「${asset.name}」｜${asset.controllerOrganizationName}${asset.controlRelation}｜持有人：${asset.holderName}`),
  ];
  const conflictValue = draft.answers.conflict?.value?.trim() || family.stagePremise;
  const nextSeed: ProjectSeed = {
    ...baseSeed,
    protagonist: optionalValue(protagonist.name, "user_defined"),
    goal: optionalValue(protagonist.goal, "user_defined"),
    weakness: optionalValue(protagonist.personality.privateNeed, "inferred"),
    world: optionalValue(worldValue, "user_defined"),
    worldRule: optionalValue(worldRuleValue, "user_defined"),
    conflict: optionalValue(conflictValue, "user_defined"),
    opposition: optionalValue(
      family.members.find((entry) => entry.stageRole === "對手代表")?.goal || family.stagePremise,
      "inferred",
    ),
    directions,
  };
  return {
    ...draft,
    protagonist: optionalValue(protagonistValue, "user_defined"),
    answers: {
      ...draft.answers,
      stageFamily: optionalValue(serializeTopicWorldFamilyDraftSelection({
        matrix,
        familyId,
        selectedProtagonistId: protagonist.characterId,
      }), "user_defined"),
      protagonist: optionalValue(protagonistValue, "user_defined"),
      cast: optionalValue(serializeSupportingCast(supportingCast), "user_defined"),
      world: optionalValue(worldValue, "user_defined"),
      worldRule: optionalValue(worldRuleValue, "user_defined"),
      conflict: optionalValue(conflictValue, "user_defined"),
    },
    seedCandidate: nextSeed,
    updatedAt: new Date().toISOString(),
  } satisfies ProjectCreationDraft;
}

type StoryLanguage = "zh-TW" | "zh-CN" | "en";

const STORY_LANGUAGE_LABELS: Record<StoryLanguage, string> = {
  "zh-TW": "繁體中文",
  "zh-CN": "简体中文",
  en: "English",
};

const STORY_LANGUAGE_HELP: Record<StoryLanguage, string> = {
  "zh-TW": "台灣繁體",
  "zh-CN": "中國大陸簡體",
  en: "英文內容",
};

function storyLanguageOf(draft: ProjectCreationDraft): StoryLanguage {
  const language = draft.answers.language?.value;
  return language === "zh-CN" || language === "en" ? language : "zh-TW";
}

function foundationMissing(draft: ProjectCreationDraft, seed: ProjectSeed) {
  const missing: string[] = [];
  const mode = playModeOf(draft);
  const supportingCast = supportingCastOf(draft);
  if (!draft.title.trim()) missing.push("作品名稱");
  if (!mode) missing.push("創作／遊玩方式");
  if (mode) {
    if (!draft.genreId) missing.push("題材方向（218 類擇一）");
    if (!draft.answers.stageFamily?.value?.trim()) missing.push("上場陣營／家族／宗門（請親自選一組）");
    if (!seed.protagonist.value?.trim()) missing.push("主要人物");
    if (supportingCast.filter((entry) => entry.complete).length < MIN_SUPPORTING_CAST) {
      missing.push(`登場配角（至少 ${MIN_SUPPORTING_CAST} 位，且每位都要有姓名、定位、關係與目標）`);
    }
    if (!seed.world.value?.trim()) missing.push("故事舞台");
    if (!seed.worldRule.value?.trim()) missing.push("不可變世界規則");
    if (!seed.conflict.value?.trim() && !seed.goal.value?.trim()) missing.push("目標或衝突");
    if (!seed.opening.value?.trim()) missing.push("開場事件");
  }
  return missing;
}

const GUIDED_ANSWER_KEYS = ["story", "familyIntent", "conflict", "worldRule", "opening"] as const;

function guidedAnswersComplete(draft: ProjectCreationDraft) {
  return GUIDED_ANSWER_KEYS.every((key) => Boolean(draft.answers[key]?.value?.trim()));
}

function guidedSeedFromDraft(draft: ProjectCreationDraft): ProjectSeed {
  const base = buildSeedCandidate(draft);
  const topicContract = topicContractForCreationDraft(draft);
  const story = draft.answers.story?.value?.trim() || "一段由選擇推動的故事";
  const familyIntent = draft.answers.familyIntent?.value?.trim() || "一個即將被捲入局勢的陣營／家族／組織";
  const rawProtagonist = draft.protagonist.value?.trim() || "待由上場群像選出的主視角人物";
  const [protagonistName, ...protagonistTraits] = rawProtagonist.split("｜").map((item) => item.trim()).filter(Boolean);
  const protagonist = protagonistName || rawProtagonist;
  const weakness = protagonistTraits.join("｜") || null;
  const conflict = draft.answers.conflict?.value?.trim() || "必須面對一個會留下代價的阻力";
  const world = draft.answers.world?.value?.trim()
    || topicContract?.displaySummary
    || base.world.value?.trim()
    || "一個會記住人物選擇與後果的故事世界";
  const worldRule = draft.answers.worldRule?.value?.trim()
    || topicContract?.canonRules.join("\n")
    || "每個選擇都會留下後果";
  const opening = draft.answers.opening?.value?.trim() || "一件打破日常秩序的事件發生";
  return {
    ...base,
    titleCandidates: [draft.title.trim()],
    logline: optionalValue(`${familyIntent}將走進${story}，並在「${worldRule}」的世界中面對${conflict}。`, "user_defined"),
    protagonist: optionalValue(protagonist, draft.protagonist.value?.trim() ? "user_defined" : "deferred"),
    goal: optionalValue(conflict, "user_defined"),
    weakness: optionalValue(weakness, weakness ? "user_defined" : "deferred"),
    world: optionalValue(world, draft.answers.world?.value ? "user_defined" : "inferred"),
    worldRule: optionalValue(worldRule, "user_defined"),
    conflict: optionalValue(conflict, "user_defined"),
    opposition: optionalValue(conflict, "user_defined"),
    opening: optionalValue(opening, "user_defined"),
    directions: [`上場勢力意向｜${familyIntent}`],
  };
}

function proceduralPayload(draft: ProjectCreationDraft): CandidatePayload {
  const hero = draft.protagonist.value?.trim() || draft.answers.protagonist?.value?.trim() || pick(proceduralNames);
  const goal = pick(proceduralGoals);
  const topicContract = topicContractForCreationDraft(draft);
  const world = topicContract?.displaySummary || pick(proceduralWorlds);
  const worldRule = topicContract?.canonRules.join("\n") || pick(proceduralRules);
  const opening = pick(proceduralOpenings);
  const topic = resolveStoryTopic(draft.genreId)?.name || "原創幻想";
  const mode = playModeOf(draft) ?? "general";
  return {
    protagonist: hero,
    goal,
    weakness: pick(["害怕再次失去重要的人", "過度相信自己可以獨自承擔", "面對親密關係時容易退縮", "習慣把真相看得比人更重要"]),
    world,
    worldRule,
    conflict: `${hero}若追查「${goal}」，就會失去眼前的安全；若退縮，危機會先傷害身邊的人。`,
    opposition: pick(["相信犧牲少數才能維持秩序的執行者", "掌握舊規則並拒絕交出權力的聯盟", "與主角追求同一目標、卻採取相反方法的人"]),
    opening,
    logline: `${hero}在${world}裡，因${opening.replace(/[。！]$/u, "")}而被迫追查${goal}，並面對「${worldRule}」的代價。`,
    style: `${topic}；場景先於說明，人物以行動表達情緒，每次選擇都留下後果。`,
    directions: mode === "general"
      ? ["人物關係先行", "謎團逐層揭露", "以具體代價推進章節"]
      : ["穩健承擔代價", "交換資源取得情報", "高風險打破既有規則"],
  };
}

function completeCreationStorySeed(payload: CandidatePayload): CreationStorySeed {
  return {
    logline: text(payload.logline),
    protagonist: text(payload.protagonist),
    goal: text(payload.goal),
    weakness: text(payload.weakness),
    world: text(payload.world),
    worldRule: text(payload.worldRule),
    conflict: text(payload.conflict),
    opposition: text(payload.opposition),
    opening: text(payload.opening),
  };
}

function suggestedDraftValue(value: string, source: "closed-ai" | "device-fallback") {
  const next = optionalValue(value, source === "closed-ai" ? "ai_suggested" : "inferred");
  return {
    ...next,
    source: source === "closed-ai" ? "ai_candidate" as const : "system" as const,
  };
}

function mergeCreationCoreCast(
  merged: ProjectCreationDraft,
  suggestion: CreationStorySeed,
  source: "closed-ai" | "device-fallback",
) {
  const existing = supportingCastSlotsOf(merged);
  const mainName = splitProtagonist(suggestion.protagonist).name;
  const used = new Set([mainName, ...existing.map((entry) => entry.name).filter(Boolean)]);
  const nextName = () => {
    const candidates = proceduralNames.filter((name) => !used.has(name));
    const selected = pick(candidates.length ? candidates : proceduralNames);
    used.add(selected);
    return selected;
  };
  const generatedGoals = [
    `協助主角推進「${suggestion.goal}」，同時守住自己的底線`,
    suggestion.opposition,
    `查清「${suggestion.opening}」背後的真相，迫使眾人立即行動`,
    `保住親眼見過的證據，並在最關鍵的時刻決定是否公開`,
  ];
  const completedCast = existing.map((entry, index) => ({
    ...entry,
    name: entry.name || nextName(),
    roleLabel: entry.roleLabel || SUPPORTING_CAST_ROLES[index]?.roleLabel || `群像成員 ${index + 1}`,
    relationship: entry.relationship || SUPPORTING_CAST_ROLES[index]?.relationship || "與主角同屬上場群體，另有自己的責任與選擇",
    goal: entry.goal || generatedGoals[index] || `完成自己的群體責任，同時回應「${suggestion.goal}」造成的局勢變化`,
  }));
  const castValue = serializeSupportingCast(completedCast);
  const castAnswer = merged.answers.cast?.value?.trim() && existing.every((entry) => entry.complete)
    ? merged.answers.cast
    : suggestedDraftValue(castValue, source);
  const worldAnswer = merged.answers.world?.value?.trim()
    ? merged.answers.world
    : suggestedDraftValue(suggestion.world, source);
  const worldRuleAnswer = merged.answers.worldRule?.value?.trim()
    ? merged.answers.worldRule
    : suggestedDraftValue(suggestion.worldRule, source);
  const mergedWithCast = {
    ...merged,
    answers: {
      ...merged.answers,
      cast: castAnswer,
      world: worldAnswer,
      worldRule: worldRuleAnswer,
    },
    updatedAt: new Date().toISOString(),
  } satisfies ProjectCreationDraft;
  return mergedWithCast;
}

function closedAISeedSource(provider: string) {
  if (provider === "browser-ai") return "閉端 AI 自動協調器（實際執行：瀏覽器 AI）";
  if (provider === "local-ollama") return "閉端 AI 自動協調器（實際執行：本機 Ollama）";
  return "閉端 AI 自動協調器";
}

export default function CreateProjectClient({ cloneFrom = null }: { cloneFrom?: string | null }) {
  const [draft, setDraft] = useState<ProjectCreationDraft>(() => createDraft());
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [titleError, setTitleError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdMode, setCreatedMode] = useState<StoryPlayModeId>("general");
  const [persistenceIssue, setPersistenceIssue] = useState<PersistenceFailure | null>(null);
  const [seedAssistantBusy, setSeedAssistantBusy] = useState(false);
  const [seedAssistantStatus, setSeedAssistantStatus] = useState("");
  const [seedAssistantSource, setSeedAssistantSource] = useState("");
  const [cloneSource, setCloneSource] = useState<ProjectCloneSourceSummary | null>(null);
  const [cloneSourceError, setCloneSourceError] = useState("");
  const [cloneReadAttempt, setCloneReadAttempt] = useState(0);
  const requestId = useRef(crypto.randomUUID());
  const titleInputRef = useRef<HTMLInputElement>(null);
  const seedAssistantControllerRef = useRef<AbortController | null>(null);
  const seedAssistantRequestGateRef = useRef(createCreationStorySeedRequestGate());
  const storageKey = draftStorageKey(cloneFrom);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const restored = safeLoadDraft(storageKey, cloneFrom);
        let next = restored ?? createDraft();
        if (cloneFrom) {
          // Always re-read the canonical IndexedDB source, even when a local
          // clone draft exists.  This prevents a deleted or changed source from
          // silently turning a stale draft into a new project.
          const clone = await buildProjectPlaymodeCloneDraftWithRetry(createNovelRepository(), cloneFrom);
          if (!active) return;
          setCloneSource(clone.source);
          setCloneSourceError("");
          const restoredRevision = Number(restored?.answers.cloneSourceRevision?.value ?? -1);
          next = isCurrentProjectPlaymodeCloneDraft(restored, cloneFrom)
            && restoredRevision === clone.source.sourceRevision
            ? restored!
            : clone.draft;
        }
        if (!active) return;
        setDraft(next);
        if (cloneFrom) setMessage("已讀取原作品的設定與故事起點。請輸入新作品名稱並親自選擇玩法；原作品、正文、Canon 與備份都不會被修改。");
      } catch (error) {
        if (!active) return;
        setDraft(createDraft());
        const nextFailure = persistenceFailureOrNull(error);
        setPersistenceIssue(nextFailure);
        if (!nextFailure && cloneFrom) {
          setCloneSource(null);
          setCloneSourceError(error instanceof Error ? error.message : "無法讀取複製來源。");
        }
        setMessage(nextFailure
          ? "無法安全讀取原作品；系統沒有改用暫存資料，也不會把它當成全新作品繼續建立。"
          : error instanceof Error ? error.message : "無法讀取原作品；已改為建立全新作品。");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [cloneFrom, cloneReadAttempt, storageKey]);

  useEffect(() => {
    if (ready) localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, ready, storageKey]);

  useEffect(() => () => {
    seedAssistantRequestGateRef.current.invalidate("CREATE_STORY_SEED_UNMOUNTED");
  }, []);

  function retryCloneSourceRead() {
    setReady(false);
    setPersistenceIssue(null);
    setCloneSource(null);
    setCloneSourceError("");
    setMessage("");
    setCloneReadAttempt((attempt) => attempt + 1);
  }

  const storedPlayMode = selectedStoryPlayMode(draft.answers);
  const currentPlayMode = playModeOf(draft);
  const playStructure = draft.answers.playStructure?.value === "general"
    || draft.answers.playStructure?.value === "choice"
    ? draft.answers.playStructure.value
    : storedPlayMode === "general"
      ? "general"
      : storedPlayMode
        ? "choice"
        : null;
  const topics = useMemo(
    () => listStoryTopics().filter((item) => item.classic && !item.adultOnly),
    [],
  );
  const topic = resolveStoryTopic(draft.genreId);
  const modeSteps = draft.mode === "guided" ? 6 : draft.mode === "blank" ? 2 : 3;
  const nextStepLabel = draft.step === 1
    ? draft.mode === "blank"
      ? "下一步：選擇上場群像"
      : draft.mode === "quick"
        ? "下一步：整理故事核心"
        : "下一步：回答故事問題"
    : draft.step + 1 === modeSteps
      ? draft.mode === "guided"
        ? "下一步：完成最後一題並選上場群像"
        : "下一步：選擇上場群像"
      : `下一步：第 ${draft.step} 題`;
  const seed = enrichedSeedFromDraft(draft);
  const coreCast = coreCastOf(draft, seed);
  const previewStageFamily = useMemo(
    () => restoredStageFamilyForDraft(draft)?.family ?? null,
    [draft],
  );
  const missing = foundationMissing(draft, seed);

  const set = (partial: Partial<ProjectCreationDraft>) => setDraft((value) => ({
    ...value,
    ...partial,
    updatedAt: new Date().toISOString(),
  }));
  const setAnswer = (
    key: string,
    value: string | null,
    status: "user_defined" | "deferred" = "user_defined",
  ) => {
    setDraft((current) => {
      const resetFamilySelection = key === "playMode";
      const next: ProjectCreationDraft = {
        ...current,
        protagonist: resetFamilySelection ? optionalValue<string>(null, "deferred") : current.protagonist,
        answers: {
          ...current.answers,
          [key]: optionalValue(value, status),
          ...(resetFamilySelection ? {
            stageFamily: optionalValue<string>(null, "deferred"),
            protagonist: optionalValue<string>(null, "deferred"),
            cast: optionalValue<string>(null, "deferred"),
          } : {}),
        },
        seedCandidate: null,
        updatedAt: new Date().toISOString(),
      };
      if (next.mode !== "guided" || !guidedAnswersComplete(next)) return next;
      const guidedSeed = guidedSeedFromDraft(next);
      return {
        ...next,
        coreIdea: optionalValue(guidedSeed.logline.value, "user_defined"),
        seedCandidate: guidedSeed,
      };
    });
    if (draft.mode === "guided" && key === GUIDED_ANSWER_KEYS.at(-1) && value?.trim()) {
      setMessage("五題已整理成可修改的完整故事起點；不需安裝或檢查 AI 就能建立作品。");
    }
  };

  const requireTitle = (action: string) => {
    if (draft.title.trim()) {
      setTitleError("");
      return true;
    }
    setTitleError(`請先輸入作品名稱，再${action}。`);
    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return false;
  };

  const chooseBuildMode = (mode: ProjectCreationDraft["mode"]) => {
    if (!requireTitle("選擇建立方式")) return;
    set({ mode, step: 1 });
  };

  function invalidateAssistedSeedForContextChange() {
    seedAssistantRequestGateRef.current.invalidate("CREATE_STORY_SEED_CONTEXT_CHANGED");
  }

  const choosePlayMode = (mode: StoryPlayModeId) => {
    if (!requireTitle("選擇創作方式")) return;
    if (currentPlayMode !== mode) invalidateAssistedSeedForContextChange();
    setDraft((current) => {
      const previousMode = playModeOf(current);
      const switchingExistingMode = Boolean(previousMode && previousMode !== mode);
      return {
        ...current,
        protagonist: switchingExistingMode
          ? optionalValue<string>(null, "deferred")
          : current.protagonist,
        answers: {
          ...current.answers,
          playMode: optionalValue(mode, "user_defined"),
          ...(previousMode !== mode ? {
            stageFamily: optionalValue<string>(null, "deferred"),
          } : {}),
          ...(switchingExistingMode ? {
            protagonist: optionalValue<string>(null, "deferred"),
            cast: optionalValue<string>(null, "deferred"),
          } : {}),
        },
        seedCandidate: switchingExistingMode ? null : current.seedCandidate,
        updatedAt: new Date().toISOString(),
      };
    });
    setMessage(`已選擇「${STORY_PLAY_MODE_LABELS[mode]}」。作品建立後這個玩法會鎖定；若要比較其他玩法，請複製為新作品。`);
  };

  const choosePlayStructure = (structure: "general" | "choice") => {
    if (!requireTitle("選擇寫作方式")) return;
    if (playStructure !== structure) invalidateAssistedSeedForContextChange();
    setDraft((current) => {
      const existing = playModeOf(current);
      const keepThreeChoiceMode = existing === "rpg" || existing === "romance" || existing === "management";
      const nextMode = structure === "general" ? "general" : keepThreeChoiceMode ? existing : null;
      const switchingExistingMode = Boolean(existing && existing !== nextMode);
      return {
        ...current,
        answers: {
          ...current.answers,
          playStructure: optionalValue(structure, "user_defined"),
          playMode: optionalValue(
            nextMode,
            structure === "general" || keepThreeChoiceMode ? "user_defined" : "deferred",
          ),
          stageFamily: optionalValue<string>(null, "deferred"),
          ...(switchingExistingMode ? {
            protagonist: optionalValue<string>(null, "deferred"),
            cast: optionalValue<string>(null, "deferred"),
          } : {}),
        },
        protagonist: switchingExistingMode
          ? optionalValue<string>(null, "deferred")
          : current.protagonist,
        seedCandidate: switchingExistingMode ? null : current.seedCandidate,
        updatedAt: new Date().toISOString(),
      };
    });
    setMessage(structure === "general"
      ? "已選擇一般章節寫作。建立後仍可使用改寫、校訂、角色與世界工具。"
      : "已選擇三選一互動。請再選 RPG 養成、戀愛養成或經營模擬。");
  };

  const advance = () => {
    if (!requireTitle("進入下一步")) return;
    if (!currentPlayMode) {
      setMessage("請先選擇這部作品要使用的一種創作／遊玩方式。");
      return;
    }

    if (draft.step === 1 && !draft.genreId) {
      setMessage("請先從完整故事庫選擇一個題材方向；系統會先建立該題材的世界規則、勢力與資源，再讓你繼續設定人物。");
      return;
    }

    if (draft.mode === "guided" && draft.step >= 2) {
      const questionIndex = Math.min(questions.length - 1, draft.step - 2);
      const question = questions[questionIndex];
      if (!draft.answers[question.key]?.value?.trim()) {
        setMessage(`請先回答第 ${questionIndex + 1} 題「${question.title}」，再繼續下一題。`);
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(".p2GuidedChoices")?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }
    }

    set({
      step: Math.min(modeSteps, draft.step + 1),
    });
    setMessage(draft.step + 1 === modeSteps
      ? "已到最後一步。請親自選擇一組上場陣營／家族／宗門／組織；系統不會代選第一組。選定後再確認右側預覽並建立作品。"
      : `第 ${draft.step} 步已保存，現在進入第 ${draft.step + 1} 步。`);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".p2CreatePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  async function applyAssistedSeed() {
    if (!draft.title.trim()) {
      requireTitle("建立故事雛形");
      setSeedAssistantSource("尚未開始");
      setSeedAssistantStatus("請先填寫作品名稱，再由 AI 依作品名稱與題材補齊故事雛形。");
      return;
    }
    if (!draft.genreId) {
      setMessage("請先選擇一個題材方向。閉端 AI 會依該題材的正式世界合約補齊雛形，不會用泛用內容取代世界觀。");
      setSeedAssistantSource("尚未開始");
      setSeedAssistantStatus("請先選擇題材方向，再產生與該世界規則一致的故事雛形。");
      return;
    }
    if (seedAssistantBusy) return;
    const playModePending = !currentPlayMode;
    const controller = new AbortController();
    const requestRevision = seedAssistantRequestGateRef.current.begin(controller);
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      controller.abort("CREATE_STORY_SEED_TIMEOUT");
    }, CREATION_AI_DEADLINE_MS);
    seedAssistantControllerRef.current = controller;
    setSeedAssistantBusy(true);
    setSeedAssistantSource("");
    setSeedAssistantStatus(playModePending
      ? "尚未選擇創作／遊玩方式；正在先建立不綁定玩法的共同故事雛形。最多等待 24 秒，若確認裝置沒有可用模型會立即改用後備。"
      : "正在由閉端 AI 自動協調器選擇可用算力；最多等待 24 秒，若確認裝置沒有可用模型會立即改用後備。");
    setMessage(playModePending
      ? "已收到操作，正在補齊共同故事核心；不會替你選擇玩法，也不會自動建立作品。"
      : "已收到操作，正在建立世界觀、故事起點與多人核心陣容；不會自動建立作品，也不會覆蓋你已填的內容。");
    try {
      const result = await runStudioPreCreationClosedAI({
        projectId: draft.projectId,
        task: "story_seed",
        input: creationStorySeedPrompt({
          title: draft.title.trim(),
          language: storyLanguageOf(draft),
          playModeLabel: currentPlayMode
            ? STORY_PLAY_MODE_LABELS[currentPlayMode]
            : MODE_NEUTRAL_STORY_SEED_LABEL,
          topic: topic?.name ?? null,
          existing: draft.seedCandidate ?? buildSeedCandidate(draft),
        }),
        targetLength: 520,
        qualityMode: "fast",
        browserComputePolicy: "balanced",
        generationOptions: {
          maxTokens: 280,
          temperature: 0.82,
          topP: 0.92,
          repetitionPenalty: 1.08,
        },
        signal: controller.signal,
        onProgress: (event) => {
          if (
            !controller.signal.aborted
            && seedAssistantRequestGateRef.current.isCurrent(requestRevision)
          ) {
            setSeedAssistantStatus(event.label || "閉端 AI 正在整理故事因果、世界觀與核心陣容。");
          }
        },
      });
      if (
        controller.signal.aborted
        || !seedAssistantRequestGateRef.current.isCurrent(requestRevision)
      ) return;
      const suggestion = parseCreationStorySeed(result.content);
      if (!suggestion) {
        throw Object.assign(new Error("模型輸出未通過故事起點格式檢查。"), {
          code: "CREATE_STORY_SEED_INVALID_OUTPUT",
        });
      }
      setDraft((current) => mergeCreationCoreCast(
        mergeCreationStorySeed(current, suggestion, "closed-ai"),
        suggestion,
        "closed-ai",
      ));
      const source = closedAISeedSource(result.provider);
      setSeedAssistantSource(source);
      setSeedAssistantStatus(playModePending
        ? "AI 已填入不綁定玩法的共同故事雛形、世界觀與四名核心配角；請閱讀後親自選擇創作／遊玩方式。"
        : "AI 雛形、世界觀與四名核心配角已填入空白欄位；請先閱讀、修改，再自行按下建立作品。");
      setMessage(playModePending
        ? `${source}已產生共同故事雛形；沒有替你選擇玩法，選定後才能建立作品。`
        : `${source}已產生可修改雛形；原有內容完整保留，且尚未建立作品。`);
    } catch (error) {
      if (!seedAssistantRequestGateRef.current.isCurrent(requestRevision)) return;
      const manuallyCancelled = controller.signal.aborted && !timedOut;
      if (manuallyCancelled) {
        setSeedAssistantSource("");
        setSeedAssistantStatus("已取消 AI 雛形生成；目前欄位與正式作品都沒有被改動。");
        setMessage("已取消這次生成。你原本填寫的內容仍在，系統沒有建立作品。");
        return;
      }
      setDraft((current) => {
        const suggestion = completeCreationStorySeed(proceduralPayload(current));
        return mergeCreationCoreCast(
          mergeCreationStorySeed(current, suggestion, "device-fallback"),
          suggestion,
          "device-fallback",
        );
      });
      const code = timedOut
        ? "CREATE_STORY_SEED_TIMEOUT"
        : String((error as { code?: unknown })?.code ?? "MODEL_NOT_READY");
      const providerUnavailable = CLOSED_AI_UNAVAILABLE_CODES.has(code);
      setSeedAssistantSource("裝置安全後備（非 AI）");
      const pendingModeReminder = playModePending
        ? " 這份雛形不綁定玩法；仍須由你親自選擇創作／遊玩方式。"
        : "";
      setSeedAssistantStatus(timedOut
        ? `閉端 AI 等待滿 24 秒仍未完成，已改用裝置後備填入空白欄位。${pendingModeReminder}`
        : providerUnavailable
          ? `已確認目前裝置沒有可完成此任務的閉端模型，已立即改用裝置後備填入空白欄位（${code}）。${pendingModeReminder}`
          : `閉端 AI 未能完成這次雛形，已立即改用裝置後備填入空白欄位（${code}）。${pendingModeReminder}`);
      setMessage(timedOut
        ? `閉端 AI 已等待滿 24 秒但未完成，因此改用裝置後備雛形；你已填的內容仍完整保留，也尚未建立作品。${pendingModeReminder}`
        : providerUnavailable
          ? `閉端 AI 已確認目前裝置沒有可用模型，因此立即改用裝置後備雛形；這不是逾時，你已填的內容仍完整保留，也尚未建立作品。${pendingModeReminder}`
          : `閉端 AI 執行或輸出檢查未完成（${code}），因此立即改用裝置後備；你已填的內容仍完整保留，也尚未建立作品。${pendingModeReminder}`);
    } finally {
      window.clearTimeout(deadline);
      seedAssistantRequestGateRef.current.complete(requestRevision);
      if (seedAssistantControllerRef.current === controller) {
        seedAssistantControllerRef.current = null;
        setSeedAssistantBusy(false);
      }
    }
  }

  function cancelAssistedSeed() {
    seedAssistantControllerRef.current?.abort("CREATE_STORY_SEED_CANCELLED");
  }

  function abandonCreation() {
    if (!window.confirm("放棄這次建立草稿？已建立的正式作品不會被刪除。")) return;
    localStorage.removeItem(storageKey);
    if (!cloneFrom) localStorage.removeItem(DRAFT_KEY);
    window.location.assign("/");
  }

  async function finish() {
    if (!requireTitle("建立作品")) return;
    if (missing.length) {
      setMessage(`還不能開始：請先完成 ${missing.join("、")}。互動與遊戲作品不會在空白設定上產生 A／B／C。`);
      return;
    }
    if (saving || !currentPlayMode) return;
    if (cloneFrom && (!cloneSource || draft.projectId === cloneFrom)) {
      setMessage("無法確認獨立的新作品識別碼；已安全停止，原作品沒有被修改。請重新載入複製來源。");
      return;
    }
    setSaving(true);
    setPersistenceIssue(null);
    setMessage("正在建立獨立作品、第一章與可還原備份……");
    try {
      const repository = createNovelRepository();
      const withSeed = { ...draft, seedCandidate: enrichedSeedFromDraft(draft, seed) };
      const bundle = await repository.createProject(
        buildProjectBundle(withSeed),
        requestId.current,
      );
      const chapter = await repository.put<Chapter>("chapters", {
        ...makeRecord(bundle.project.id, "user"),
        title: "第一章",
        order: 1,
        content: "",
        summary: seed.opening.value,
        status: "draft",
      });
      const project = await repository.put<NovelProject>("projects", {
        ...bundle.project,
        activeChapterId: chapter.id,
      }, bundle.project.revision);
      const reader = await repository.get<ReaderState>("readerStates", bundle.readerState.id);
      if (reader) {
        bundle.readerState = await repository.put<ReaderState>("readerStates", {
          ...reader,
          chapterId: chapter.id,
        }, reader.revision);
      }
      bundle.project = project;
      await createProjectBackup(repository, project.id, "full");
      mirrorProjectToLegacyStudio(bundle);
      localStorage.setItem("novel_p2_active_project_id", project.id);
      localStorage.removeItem(storageKey);
      if (!cloneFrom) localStorage.removeItem(DRAFT_KEY);
      setCreatedMode(currentPlayMode);
      setCreatedId(project.id);
      setMessage(`作品已建立並鎖定為「${STORY_PLAY_MODE_LABELS[currentPlayMode]}」。起始種子、第一章與完整備份均已保存。`);
    } catch (error) {
      const nextFailure = persistenceFailureOrNull(error);
      setPersistenceIssue(nextFailure);
      setMessage(nextFailure
        ? "建立失敗：本機作品庫已安全停止。既有作品沒有被覆寫，也沒有改用 memory 替代庫。"
        : `建立失敗：${error instanceof Error ? error.message : "請稍後再試"}。既有作品沒有被修改。`);
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <main className="p2CreateShell"><p>正在讀取你的創作資料……</p></main>;

  if (persistenceIssue && cloneFrom) {
    return (
      <main
        className="p2CreateShell"
        data-persistence-backend="indexeddb"
        data-persistence-degraded="true"
        data-memory-fallback="false"
      >
        <PersistenceRecoveryNotice
          failure={persistenceIssue}
          onRetry={() => window.location.reload()}
        />
        <p><Link href="/studio/create">改為一般建立新作品</Link></p>
      </main>
    );
  }

  if (cloneFrom && cloneSourceError) {
    return (
      <main className="p2CreateShell" data-testid="clone-source-error">
        <section className="p2CloneSourceError" role="alert">
          <span>無法複製為其他玩法</span>
          <h1>沒有找到可安全讀取的原作品</h1>
          <p>{cloneSourceError}</p>
          <strong>系統沒有建立副本，也沒有修改任何原作品資料。</strong>
          <div>
            <button type="button" data-testid="clone-source-retry" onClick={retryCloneSourceRead}>重試讀取</button>
            <Link className="primaryAction" href="/studio/create">改為一般建立新作品</Link>
            <Link
              className="secondaryAction"
              href={`/professional?intent=library&projectId=${encodeURIComponent(cloneFrom)}`}
            >
              回作品庫確認
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (createdId) {
    const primaryHref = `/studio/project/${encodeURIComponent(createdId)}/chat${createdMode === "general" ? "" : "?mode=play"}`;
    return (
      <main
        className="p2CreateShell"
        data-testid="create-indexeddb-runtime"
        data-persistence-backend="indexeddb"
        data-persistence-degraded="false"
        data-memory-fallback="false"
      >
        <section className="p2CreateSuccess">
          <span>建立完成</span>
          <h1>{draft.title.trim()}</h1>
          <strong>{STORY_PLAY_MODE_LABELS[createdMode]} · 已鎖定</strong>
          <p>{message}</p>
          <div>
            <Link className="primaryAction" href={primaryHref}>
              {createdMode === "general" ? "進入故事工作台" : "在故事工作台開始遊玩"}
            </Link>
            <Link className="secondaryAction" href={`/studio/project/${createdId}/write`}>章節正式稿校訂（專業工具）</Link>
            <Link className="secondaryAction" href={`/professional?intent=library&projectId=${encodeURIComponent(createdId)}`}>作品資料管理（專業工具）</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="p2CreateShell" data-testid="canonical-create-flow">
      <header>
        <div className="p2CreateExitActions">
          <Link href="/">儲存草稿並回首頁</Link>
          <button type="button" className="dangerAction" onClick={abandonCreation}>放棄此次建立</button>
        </div>
        <div>
          <span>{cloneFrom ? "複製為新玩法" : "建立新作品"}</span>
          <h1>先命名、選玩法，再建立故事起點</h1>
          <p>設定完成前不會出現 A／B／C，也不會讓其他功能磚打斷這個流程。</p>
        </div>
        <small>建立後玩法鎖定；換玩法請複製新作品</small>
      </header>

      {cloneSource ? (
        <section className="p2CloneSourceBanner" data-testid="clone-source-banner">
          <div>
            <span>複製來源已確認</span>
            <h2>《{cloneSource.sourceTitle}》</h2>
            <p>
              原玩法：{cloneSource.sourcePlayMode ? STORY_PLAY_MODE_LABELS[cloneSource.sourcePlayMode] : "未記錄"}
              <b> · </b>
              來源含 {cloneSource.sourceChapterCount} 章
            </p>
          </div>
          <div>
            <strong>這會建立全新的獨立作品</strong>
            <p>已帶入題材、故事種子、主要人物與世界摘要；不複製章節正文、回合狀態、備份或核准紀錄。</p>
            <p>請在下方重新命名並選擇玩法。完成前不會寫入 IndexedDB，原作品永遠維持原狀。</p>
          </div>
          <Link href={`/professional?projectId=${encodeURIComponent(cloneSource.sourceProjectId)}`}>查看原作品</Link>
        </section>
      ) : null}

      <section className="p2TitleGate" data-valid={Boolean(draft.title.trim())}>
        <label htmlFor="p2-project-title">
          <span>作品名稱 <strong>必填</strong></span>
          <input
            ref={titleInputRef}
            id="p2-project-title"
            data-testid="p2-project-title"
            value={draft.title}
            aria-invalid={Boolean(titleError)}
            onChange={(event) => {
              set({ title: event.target.value });
              if (event.target.value.trim()) setTitleError("");
            }}
            placeholder={cloneSource ? `請為《${cloneSource.sourceTitle}》的新玩法命名` : "例如：星河盡頭的歸途"}
            autoComplete="off"
          />
        </label>
        <p>名稱會綁定這部作品的章節、玩法、角色、世界設定、StoryState 與備份。</p>
        {titleError ? <div className="p2TitleError" role="alert">{titleError}</div> : null}
      </section>

      <section className="p2LanguageGate" aria-labelledby="p2-story-language-title" data-testid="p2-story-language">
        <div>
          <span>作品語言</span>
          <h2 id="p2-story-language-title">正文與 AI 候選使用哪一種語言？</h2>
          <p>選定後，故事種子、正文、選項與回合續寫都必須使用同一種語言。</p>
        </div>
        <div className="p2LanguageChoices">
          {(Object.keys(STORY_LANGUAGE_LABELS) as StoryLanguage[]).map((language) => (
            <button
              key={language}
              type="button"
              className={storyLanguageOf(draft) === language ? "active" : ""}
              aria-pressed={storyLanguageOf(draft) === language}
              onClick={() => setAnswer("language", language)}
            >
              <b>{STORY_LANGUAGE_LABELS[language]}</b>
              <span>{STORY_LANGUAGE_HELP[language]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="p2PlayModeGate" aria-labelledby="p2-play-mode-title">
        <div>
          <span>第 1 個決定</span>
          <h2 id="p2-play-mode-title">先選擇寫作方式</h2>
          <p>一般小說使用章節續寫；三選一作品會在下一步再選玩法，而且每個回合都由三條路線推進。</p>
        </div>
        <div className="p2PlayModeGrid" data-level="structure">
          <button type="button" disabled={!draft.title.trim()} className={playStructure === "general" ? "active" : ""} aria-pressed={playStructure === "general"} data-testid="create-play-mode-general" data-play-structure="general" onClick={() => choosePlayStructure("general")}>
            <b>一般章節寫作</b>
            <span>自由續寫、改寫、章節校訂與閱讀，不強制回合選項。</span>
          </button>
          <button type="button" disabled={!draft.title.trim()} className={playStructure === "choice" ? "active" : ""} aria-pressed={playStructure === "choice"} data-testid="create-play-structure-choice" onClick={() => choosePlayStructure("choice")}>
            <b>三選一互動</b>
            <span>每回合自動提供三條真正不同的路線；只將選中的結果寫入正文。</span>
          </button>
        </div>
      </section>

      {playStructure === "choice" ? (
        <section className="p2PlayModeGate p2PlaySubtypeGate" aria-labelledby="p2-play-subtype-title" data-testid="create-three-choice-subtypes">
          <div>
            <span>第 2 個決定</span>
            <h2 id="p2-play-subtype-title">選擇三選一玩法</h2>
            <p>三種玩法都採 A／B／C 回合；差別只在要追蹤的成長、關係與資源。</p>
          </div>
          <div className="p2PlayModeGrid" data-level="subtype">
            {(["rpg", "romance", "management"] as StoryPlayModeId[]).map((mode) => (
              <button key={mode} type="button" disabled={!draft.title.trim()} className={currentPlayMode === mode ? "active" : ""} aria-pressed={currentPlayMode === mode} data-testid={`create-play-mode-${mode}`} onClick={() => choosePlayMode(mode)}>
                <b>{STORY_PLAY_MODE_LABELS[mode]}</b>
                <span>{mode === "rpg" ? "能力、任務、裝備、貨幣與故事回合" : mode === "romance" ? "關係、信任、事件與人物成長" : "資金、人力、品質、聲望與風險"}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <nav className="p2ModeTabs" aria-label="建立方式">
        <button disabled={!draft.title.trim()} className={draft.mode === "quick" ? "active" : ""} onClick={() => chooseBuildMode("quick")}><b>快速開始</b><span>少量設定，立即看可修改雛形</span></button>
        <button disabled={!draft.title.trim()} className={draft.mode === "guided" ? "active" : ""} onClick={() => chooseBuildMode("guided")}><b>引導建立</b><span>先選題材，再用五個問題整理人物與第一幕</span></button>
        <button disabled={!draft.title.trim()} className={draft.mode === "blank" ? "active" : ""} onClick={() => chooseBuildMode("blank")}><b>完整故事庫</b><span>從完整題材庫挑選，再確認故事種子</span></button>
      </nav>

      <div className="p2CreateLayout">
        <section className="p2CreatePanel">
          <div className="p2StepBar" aria-label={`第 ${draft.step} 步，共 ${modeSteps} 步`}>
            {Array.from({ length: modeSteps }, (_, index) => <i key={index} className={index < draft.step ? "done" : ""} />)}
          </div>

          {draft.mode === "blank"
            ? <Library draft={draft} set={set} topics={topics} />
            : draft.mode === "guided"
              ? <Guided draft={draft} set={set} setAnswer={setAnswer} topics={topics} />
              : <Quick draft={draft} set={set} topics={topics} />}

          {draft.genreId && draft.step === modeSteps ? <StoryFoundationSetup draft={draft} set={set} setMessage={setMessage} /> : null}

          <section className="p2CreationAssistant" aria-label="創作帶領精靈">
            <div>
              <span>創作帶領精靈</span>
              <h3>由閉端 AI 自動協調器補齊故事雛形</h3>
              <p>只有一個入口；建立前會自動調度瀏覽器 AI 或本機 Ollama。AI 失敗才使用裝置後備，而且只填空白欄位、不建立正式作品。</p>
            </div>
            <div className="p2CreationAssistantActions">
              <button
                type="button"
                disabled={seedAssistantBusy || !draft.genreId}
                data-testid="create-ai-story-seed"
                onClick={() => void applyAssistedSeed()}
              >
                {seedAssistantBusy ? "AI 正在建立雛形……" : "由 AI 協助產生故事雛形"}
                <small>自動協調算力 · 最長 24 秒；確認無模型會立即後備</small>
              </button>
              {seedAssistantBusy ? (
                <button type="button" data-testid="cancel-create-ai-story-seed" onClick={cancelAssistedSeed}>取消本次生成</button>
              ) : null}
            </div>
            {seedAssistantStatus ? (
              <div className="p2AIStatus" role="status" aria-live="polite" data-testid="create-ai-story-seed-status">
                <b>{seedAssistantSource || "閉端 AI 自動協調器"}</b>
                <span>{seedAssistantStatus}</span>
              </div>
            ) : null}
          </section>

          {missing.length ? <div className="p2FoundationWarning" role="status"><b>開始前還缺：</b>{missing.join("、")}<span>補齊前不會產生第一回合 A／B／C。</span></div> : <div className="p2FoundationReady"><b>故事起點已完整</b><span>建立作品後才會依選定玩法開啟正文或第一回合。</span></div>}

          <footer>
            <button disabled={draft.step <= 1} onClick={() => set({ step: Math.max(1, draft.step - 1) })}>上一步</button>
            {draft.step < modeSteps
              ? <button className="gold" data-testid="creation-primary-next" onClick={advance}>{nextStepLabel}</button>
              : <button className="gold" disabled={saving} onClick={() => void finish()}>{saving ? "建立中……" : `建立「${currentPlayMode ? STORY_PLAY_MODE_LABELS[currentPlayMode] : "尚未選玩法"}」作品`}</button>}
          </footer>
          {message ? <p className="p2CreateMessage" role="status" aria-live="polite">{message}</p> : null}
          {persistenceIssue ? (
            <PersistenceRecoveryNotice
              failure={persistenceIssue}
              onRetry={() => window.location.reload()}
            />
          ) : null}
        </section>

        <aside className="p2SeedPreview">
          <span>正式建立前預覽</span>
          <h2>{draft.title.trim() || "請先輸入作品名稱"}</h2>
          <strong>{currentPlayMode ? STORY_PLAY_MODE_LABELS[currentPlayMode] : "尚未選擇玩法"}</strong>
          <h3>世界觀</h3>
          <dl>
            <div><dt>題材</dt><dd>{topic ? topicDisplayName(topic.topicId, topic.name) : "尚未設定"}</dd></div>
            <div><dt>核心想法</dt><dd>{seed.logline.value || draft.coreIdea.value || "稍後補充"}</dd></div>
            <div><dt>故事舞台</dt><dd>{seed.world.value || "稍後補充"}</dd></div>
            <div><dt>世界規則</dt><dd>{seed.worldRule.value || "稍後補充"}</dd></div>
            <div><dt>主要阻力</dt><dd>{seed.conflict.value || "稍後補充"}</dd></div>
            <div><dt>第一章起點</dt><dd>{seed.opening.value || "稍後補充"}</dd></div>
          </dl>
          <h3>上場陣營與人物</h3>
          {previewStageFamily ? (
            <div className="p2SelectedFamilyPreview" data-testid="creation-selected-family-preview">
              <span>{previewStageFamily.organizationKind}・{previewStageFamily.organizationName}</span>
              <b>{previewStageFamily.name}</b>
              <p>{previewStageFamily.stagePremise}</p>
            </div>
          ) : <p>請先從題材相符候選中選擇一組上場陣營／家族／宗門／組織。</p>}
          <div className="p2CastPreview" data-testid="creation-cast-preview">
            {coreCast.map((entry, index) => (
              <article key={`${entry.role}-${index}`} data-cast-role={entry.role}>
                <span>{entry.roleLabel}</span>
                <b>{entry.complete ? entry.name : "尚未完整設定"}</b>
                <p>{entry.description || "需要補齊姓名、角色定位、與主角關係及個人目標"}</p>
              </article>
            ))}
          </div>
          <p>你填寫或保留的 AI 建議，只有在你按下「建立作品」後才會進入新作品。建立前不會自動寫入正式作品。</p>
        </aside>
      </div>
    </main>
  );
}

function TopicCatalog({ draft, set, topics }: {
  draft: ProjectCreationDraft;
  set: (partial: Partial<ProjectCreationDraft>) => void;
  topics: ReturnType<typeof listStoryTopics>;
}) {
  const [query, setQuery] = useState("");
  const [browsePackId, setBrowsePackId] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | "native">("all");
  const activePlayMode = playModeOf(draft);
  const selectedTopic = topics.find((item) => item.topicId === draft.genreId);
  const filteredTopics = useMemo(() => topics
    .filter((item) => !browsePackId || item.packIds.includes(browsePackId))
    .filter((item) => modeFilter === "all" || !activePlayMode || item.supportedPlayModes.includes(activePlayMode))
    .filter((item) => topicMatchesSearch(item, query)), [activePlayMode, browsePackId, modeFilter, query, topics]);
  return (
    <section className="p2TopicCatalog" aria-labelledby="p2-topic-catalog-title" data-testid="complete-story-topic-catalog">
      <header>
        <div>
          <span>完整經典題材目錄</span>
          <h2 id="p2-topic-catalog-title">從全部 {topics.length} 類題材選擇故事方向</h2>
          <p>題材不受一般寫作、RPG、戀愛或經營玩法限制；選定後再由玩法決定追蹤哪些狀態。</p>
        </div>
        <strong data-testid="story-topic-visible-count" aria-live="polite">
          顯示 {filteredTopics.length}／{topics.length} 類
        </strong>
      </header>
      <div className="p2TopicTools">
        <label htmlFor="p2-topic-search">
          搜尋題材、別名或子類型
          <input
            id="p2-topic-search"
            data-testid="story-topic-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：附身變身、男變女、女變男、靈魂交換"
            autoComplete="off"
          />
        </label>
        <label htmlFor="p2-topic-pack-filter">
          瀏覽分類包
          <select
            id="p2-topic-pack-filter"
            data-testid="story-topic-pack-filter"
            value={browsePackId}
            onChange={(event) => setBrowsePackId(event.target.value)}
          >
            <option value="">全部 218 類</option>
            {STORY_LIBRARY.packs.filter((item) => item.enabled && item.packId !== "pack-11").map((item) => (
              <option key={item.packId} value={item.packId}>{item.name}</option>
            ))}
          </select>
        </label>
        <label htmlFor="p2-topic-mode-filter">
          玩法分類
          <select
            id="p2-topic-mode-filter"
            data-testid="story-topic-mode-filter"
            value={modeFilter}
            onChange={(event) => setModeFilter(event.target.value === "native" ? "native" : "all")}
          >
            <option value="all">全部題材（可套用目前玩法）</option>
            <option value="native" disabled={!activePlayMode}>只看原生支援目前玩法</option>
          </select>
        </label>
      </div>
      <div className="p2TopicGrid p2TopicGridLarge" data-topic-count={filteredTopics.length}>
        {filteredTopics.map((item) => {
          const directlySupported = Boolean(activePlayMode && item.supportedPlayModes.includes(activePlayMode));
          const fitLabel = activePlayMode
            ? directlySupported
              ? `適合目前玩法：${STORY_PLAY_MODE_LABELS[activePlayMode]}`
              : `可改編為目前玩法：${STORY_PLAY_MODE_LABELS[activePlayMode]}`
            : "選定玩法後會自動顯示適配方式";
          return (
            <button
              type="button"
              key={item.topicId}
              data-topic-id={item.topicId}
              className={draft.genreId === item.topicId ? "active" : ""}
              aria-pressed={draft.genreId === item.topicId}
              onClick={() => set({
                genrePackId: item.packId,
                genreId: item.topicId,
                protagonist: optionalValue<string>(null, "deferred"),
                answers: {
                  ...draft.answers,
                  stageFamily: optionalValue<string>(null, "deferred"),
                  protagonist: optionalValue<string>(null, "deferred"),
                  cast: optionalValue<string>(null, "deferred"),
                  world: optionalValue<string>(null, "deferred"),
                  worldRule: optionalValue<string>(null, "deferred"),
                },
                seedCandidate: null,
              })}
            >
              <b>{topicDisplayName(item.topicId, item.name)}</b>
              <span>{item.description}</span>
              <span data-topic-play-fit={directlySupported ? "direct" : "adapted"}>{fitLabel}</span>
            </button>
          );
        })}
      </div>
      {!filteredTopics.length ? (
        <div className="p2TopicEmpty" role="status">
          找不到符合「{query.trim()}」的題材。請清除搜尋或改看全部分類。
        </div>
      ) : null}
      {draft.genreId ? (
        <div className="p2FoundationHint" data-testid="creation-stage-selection-route" role="status">
          <b>題材已選定：{selectedTopic ? topicDisplayName(selectedTopic.topicId, selectedTopic.name) : "自訂題材"}</b>
          <br />
          <span>接下來會整理故事核心，最後由你親自選擇上場陣營／家族／宗門／組織；系統不會代選第一組。</span>
        </div>
      ) : null}
    </section>
  );
}

function Quick({ draft, set, topics }: {
  draft: ProjectCreationDraft;
  set: (partial: Partial<ProjectCreationDraft>) => void;
  topics: ReturnType<typeof listStoryTopics>;
}) {
  if (draft.step === 1) {
    return (
      <div className="p2CreateFields">
        <TopicCatalog draft={draft} set={set} topics={topics} />
      </div>
    );
  }
  if (draft.step === 2) {
    return (
      <div className="p2CreateFields">
        <h2>放入上場勢力與故事核心</h2>
        <p>先整理核心衝突與開場；題材相符的上場陣營／家族／宗門候選會優先出現，完整世界與資產資料可再展開確認。</p>
        <label>核心想法<textarea value={draft.coreIdea.value || ""} onChange={(event) => set({ coreIdea: optionalValue(event.target.value || null, event.target.value ? "user_defined" : "deferred"), seedCandidate: null })} /></label>
        <label>目標或衝突<textarea value={draft.answers.conflict?.value || ""} onChange={(event) => set({ answers: { ...draft.answers, conflict: optionalValue(event.target.value || null, event.target.value ? "user_defined" : "deferred") }, seedCandidate: null })} /></label>
        <label>開場事件<textarea value={draft.answers.opening?.value || ""} onChange={(event) => set({ answers: { ...draft.answers, opening: optionalValue(event.target.value || null, event.target.value ? "user_defined" : "deferred") }, seedCandidate: null })} /></label>
      </div>
    );
  }
  return <SeedEditor draft={draft} set={set} />;
}

function Guided({ draft, set, setAnswer, topics }: {
  draft: ProjectCreationDraft;
  set: (partial: Partial<ProjectCreationDraft>) => void;
  setAnswer: (key: string, value: string | null, status?: "user_defined" | "deferred") => void;
  topics: ReturnType<typeof listStoryTopics>;
}) {
  if (draft.step === 1) {
    return (
      <div className="p2CreateFields">
        <TopicCatalog draft={draft} set={set} topics={topics} />
      </div>
    );
  }
  const questionIndex = Math.min(questions.length - 1, draft.step - 2);
  const question = questions[questionIndex];
  const selected = draft.answers[question.key]?.value;
  return (
    <div className="p2CreateFields">
      <span>第 {questionIndex + 1} 題／共 5 題</span>
      <h2>{question.title}</h2>
      <div className="p2GuidedChoices">
        {question.choices.map((choice, index) => <button type="button" key={choice} className={selected === choice ? "active" : ""} onClick={() => setAnswer(question.key, choice)}><b>{String.fromCharCode(65 + index)}</b>{choice}</button>)}
      </div>
      <label>自己輸入<input value={selected && !question.choices.some((choice) => choice === selected) ? selected : ""} onChange={(event) => setAnswer(question.key, event.target.value || null, event.target.value ? "user_defined" : "deferred")} /></label>
      <button type="button" onClick={() => setAnswer(question.key, null, "deferred")}>清除此題</button>
    </div>
  );
}

function Library({ draft, set, topics }: {
  draft: ProjectCreationDraft;
  set: (partial: Partial<ProjectCreationDraft>) => void;
  topics: ReturnType<typeof listStoryTopics>;
}) {
  if (draft.step === 1) {
    return (
      <div className="p2CreateFields">
        <p>這裡是題材與規則索引，不是下載小說全文。選擇後只會帶入創作方向。</p>
        <TopicCatalog draft={draft} set={set} topics={topics} />
      </div>
    );
  }
  return <SeedEditor draft={draft} set={set} />;
}

function StoryFoundationSetup({ draft, set, setMessage }: {
  draft: ProjectCreationDraft;
  set: (partial: Partial<ProjectCreationDraft>) => void;
  setMessage: (message: string) => void;
}) {
  const seed = enrichedSeedFromDraft(draft);
  const topic = resolveStoryTopic(draft.genreId);
  const topicContract = topicContractForCreationDraft(draft);
  const familyMatrix = useMemo(
    () => topicWorldFamilyMatrixForCreationDraft(draft),
    [draft],
  );
  const familyCandidates = useMemo(
    () => familyMatrix ? listTopicWorldFamilyStageCandidates({ matrix: familyMatrix }) : [],
    [familyMatrix],
  );
  const restoredFamily = useMemo(
    () => restoredStageFamilyForDraft(draft, familyMatrix),
    [draft, familyMatrix],
  );
  const selectedFamily = restoredFamily?.family ?? null;
  const protagonist = coreCastOf(draft, seed)[0];
  const supportingSlots = supportingCastSlotsOf(draft);
  const completeSupportingCount = supportingSlots.filter((entry) => entry.complete).length;
  const organizationById = new Map(familyMatrix?.organizations.map((entry) => [entry.organizationId, entry]) ?? []);
  const memberById = new Map(familyMatrix?.stageFamilies.flatMap((family) => family.members).map((entry) => [entry.characterId, entry]) ?? []);
  const stageGroupLabel = familyMatrix?.worldFamily === "cultivation"
    ? "陣營／家族／宗門"
    : "陣營／家族／組織";
  const selectStageFamily = (family: TopicWorldStageFamily, preferredCharacterId?: string) => {
    if (!familyMatrix) return;
    set(applyStageFamilyToDraft(draft, familyMatrix, family.familyId, preferredCharacterId));
    setMessage(`已選定「${family.name}」作為上場${stageGroupLabel}。你仍可改選其他候選；確認故事起點後再建立作品。`);
  };
  const updateProtagonist = (value: string) => {
    const next = optionalValue(value || null, value ? "user_defined" : "deferred");
    set({
      protagonist: next,
      answers: { ...draft.answers, protagonist: next },
      seedCandidate: { ...seed, protagonist: next },
    });
  };
  const updateWorld = (value: string) => {
    const next = optionalValue(value || null, value ? "user_defined" : "deferred");
    set({
      answers: { ...draft.answers, world: next },
      seedCandidate: { ...seed, world: next },
    });
  };
  const updateWorldRule = (value: string) => {
    const next = optionalValue(value || null, value ? "user_defined" : "deferred");
    set({
      answers: { ...draft.answers, worldRule: next },
      seedCandidate: { ...seed, worldRule: next },
    });
  };
  const updateSupportingCast = (
    index: number,
    key: "name" | "relationship" | "goal",
    value: string,
  ) => {
    const nextEntries = supportingSlots.map((entry, entryIndex) => entryIndex === index
      ? { ...entry, [key]: value }
      : entry);
    const castValue = serializeSupportingCast(nextEntries);
    set({
      answers: {
        ...draft.answers,
        cast: optionalValue(castValue, "user_defined"),
      },
      seedCandidate: seed,
    });
  };
  return (
    <section className="p2FoundationSetup p2CreateFields" aria-labelledby="p2-foundation-title" data-testid="creation-foundation-setup">
      <header>
        <div>
          <span>正式開始前確認</span>
          <h2 id="p2-foundation-title">由你選擇上場{stageGroupLabel}</h2>
          <p>請親自從目前題材產生的候選中選一組；系統不會代選第一組。選定時會把六名人物、關係網與持有物一起帶入，不會只產生一位孤立主角。</p>
        </div>
        <strong>{selectedFamily ? `已選定：${selectedFamily.name}` : "尚未選擇上場群像"}</strong>
      </header>

      {familyMatrix ? (
        <section className="p2StageFamilyChooser" data-testid="creation-stage-family-candidates" aria-labelledby="p2-stage-family-title">
          <header>
            <div>
              <span>依題材產生・先選再看詳情</span>
              <h3 id="p2-stage-family-title">
                依「{topic ? topicDisplayName(topic.topicId, topic.name) : familyMatrix.topicName}」選擇上場{stageGroupLabel}
              </h3>
              <p>每張卡都是一組完整群像。請選擇符合故事方向的一組；需要時再展開查看六名成員、資產與關係細節。</p>
            </div>
            <strong>{selectedFamily ? `${selectedFamily.name}已選定` : `${familyCandidates.length} 組題材相符候選待選`}</strong>
          </header>
          <div className="p2FoundationHint" data-testid="creation-materialization-truth">
            <b>
              本次實際生成：{familyMatrix.organizations.length} 個組織、{familyMatrix.stageFamilies.length} 組上場群像、
              {familyMatrix.capacity.materializedStageCharacters.toLocaleString("zh-TW")} 名人物與
              {familyMatrix.capacity.materializedStageAssets.toLocaleString("zh-TW")} 項資產；畫面提供 {familyCandidates.length} 組候選。
            </b>
            <br />
            <span>
              程序化索引容量為 {familyMatrix.capacity.characters.toLocaleString("zh-TW")} 名人物、
              {familyMatrix.capacity.treasures.toLocaleString("zh-TW")} 件物件與
              {familyMatrix.capacity.relationshipScenarios.toLocaleString("zh-TW")} 種關係情境；其餘資料未預先建立或載入，只會按種子與需求即時計算。
            </span>
          </div>
          <div className="p2StageFamilyGrid">
            {familyCandidates.map((candidate) => {
              const family = candidate.family;
              const isSelected = selectedFamily?.familyId === family.familyId;
              const familyAssets = familyMatrix.assetControls.filter((asset) => family.assetControlIds.includes(asset.assetControlId));
              return (
                <article className={`p2StageFamilyCard${isSelected ? " selected" : ""}`} key={candidate.optionId}>
                  <header>
                    <div><span>{family.organizationKind}・{family.organizationName}</span><h4>{family.name}</h4></div>
                    <b>{isSelected ? "已選定上場" : "題材相符候選"}</b>
                  </header>
                  <p className="p2StageFamilyLead">{family.stagePremise}</p>
                  <div className="p2StageFamilyActions">
                    <button type="button" className="primary" disabled={isSelected} onClick={() => selectStageFamily(family)}>
                      {isSelected ? "已選定這組上場群像" : "選擇這組上場群像"}
                    </button>
                    {family.members.filter((member) => member.stageRole === "男主角候選" || member.stageRole === "女主角候選").map((member) => (
                      <button type="button" key={member.characterId} onClick={() => selectStageFamily(family, member.characterId)}>
                        以 {member.name} 為主視角
                      </button>
                    ))}
                  </div>
                  <details className="p2StageRelationships" data-testid={`creation-stage-family-details-${family.familyId}`}>
                    <summary>查看 {family.members.length} 名成員、資產與關係詳情</summary>
                    <p className="p2StageFamilyLead">{family.introduction}</p>
                    <dl className="p2StageFamilyFacts">
                      <div><dt>根據地</dt><dd>{family.home}</dd></div>
                      <div><dt>聲望</dt><dd>{family.reputation}</dd></div>
                      <div><dt>群體特質</dt><dd>{family.inheritedTrait}</dd></div>
                      <div><dt>當前局勢</dt><dd>{family.standing}</dd></div>
                      <div><dt>掌握資產</dt><dd>{familyAssets.map((asset) => `${asset.category}「${asset.name}」`).join("、") || "將在故事中取得"}</dd></div>
                    </dl>
                    <div className="p2StageFamilyMembers">
                      {family.members.map((member) => (
                        <article className="p2StageMember" key={member.characterId}>
                          <Image
                            unoptimized
                            src={member.portrait.dataUrl}
                            alt={`${member.name}的原創人物相片`}
                            width={78}
                            height={78}
                          />
                          <div>
                            <span>{member.stageRole}・{member.familyRole}</span>
                            <b>{member.name}</b>
                            <p>{member.identity}</p>
                            <small>目標：{member.goal}</small>
                            <small>個性：{member.personality.traits.join("、")}；能力層級 {member.abilities.powerTier}</small>
                            <small>專長：{member.abilities.specialties.join("、")}；持有：{member.possessionNames.join("、") || "尚無"}</small>
                          </div>
                        </article>
                      ))}
                    </div>
                    <div>
                      <b>成員關係</b>
                      <ul>
                        {family.relationships.map((relationship) => {
                          const source = memberById.get(relationship.sourceCharacterId)?.name || "未知人物";
                          const target = memberById.get(relationship.targetCharacterId)?.name || "未知人物";
                          return <li key={relationship.relationshipId}><b>{source} ↔ {target}</b>・{relationship.kind}・信任 {relationship.trust}／張力 {relationship.tension}／責任 {relationship.obligation}；{relationship.historyHook}</li>;
                        })}
                      </ul>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="p2FoundationHint" role="status">請先選擇玩法與 218 類題材之一，系統才會建立相符的上場陣營、人物群像與資產控制圖。</div>
      )}

      <details className="p2AdvancedCast" data-testid="creation-world-foundation-details">
        <summary>展開世界規格、可修改欄位與完整資產詳情</summary>
      <div className="p2WorldFoundation">
        <label>
          <span>故事舞台 <b>必填</b></span>
          <textarea
            data-testid="creation-world"
            value={draft.answers.world?.value || seed.world.value || ""}
            onChange={(event) => updateWorld(event.target.value)}
            placeholder="例如：一座由多個組織共同維持秩序的城市；交通、資訊與禁區入口各有控制者。"
          />
        </label>
        <label>
          <span>不可變世界規則 <b>必填</b></span>
          <textarea
            data-testid="creation-world-rule"
            value={draft.answers.worldRule?.value || seed.worldRule.value || ""}
            onChange={(event) => updateWorldRule(event.target.value)}
            placeholder="例如：任何能力、資源或關係變化都必須有來源、限制與代價；已發生的事件不可無故重置。"
          />
        </label>
      </div>
      {topic?.recommendedWorlds.length ? (
        <div className="p2WorldSuggestions" aria-label="題材世界建議">
          <span>依「{topicDisplayName(topic.topicId, topic.name)}」選一個世界起點：</span>
          {topic.recommendedWorlds.slice(0, 3).map((world) => (
            <button type="button" key={world} onClick={() => updateWorld(world)}>{world}</button>
          ))}
        </div>
      ) : null}
      {topicContract ? (
        <section className="p2WorldContractPreview" data-testid="creation-topic-world-contract" aria-label="題材世界規格預覽">
          <header>
            <div>
              <span>題材世界規格・建立後寫入 Canon</span>
              <h3>{topicDisplayName(topicContract.topicId, topicContract.topicName)}世界已建立骨架</h3>
              <p>{topicContract.displaySummary}</p>
            </div>
            <strong>世界種子 {topicContract.worldOrdinal + 1}／1000</strong>
          </header>
          <div>
            <article>
              <h4>不可跳過的世界規則</h4>
              <ul>{topicContract.canonRules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </article>
            <article>
              <h4>組織、陣營與關係網</h4>
              <ul>{topicContract.institutions.map((institution) => <li key={institution}>{institution}</li>)}</ul>
            </article>
            <article>
              <h4>資源、物件與取得條件</h4>
              <ul>{topicContract.assets.map((asset) => <li key={asset}>{asset}</li>)}</ul>
            </article>
            <article data-play-mode={topicContract.playMechanics.mode}>
              <h4>{topicContract.playMechanics.label}專屬追蹤</h4>
              <p>{topicContract.playMechanics.dimensions.join("・")}</p>
              <ul>{topicContract.playMechanics.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </article>
          </div>
        </section>
      ) : null}
      {familyMatrix ? (
        <>
          <section className="p2WorldPowerAtlas" data-testid="creation-world-power-atlas" aria-labelledby="p2-world-power-title">
            <header>
              <div>
                <span>完整世界關係圖</span>
                <h3 id="p2-world-power-title">{familyMatrix.organizations.length} 個組織全貌</h3>
                <p>各組織都會依題材設定繼續獨立行動；選定上場人選不會讓其他陣營消失。</p>
              </div>
              <strong>
                本次已生成 {familyMatrix.organizations.length} 個組織・
                {familyMatrix.capacity.materializedStageCharacters.toLocaleString("zh-TW")} 名人物候選
              </strong>
            </header>
            <div className="p2PowerGrid">
              {familyMatrix.organizations.map((organization) => {
                const allies = organization.allyOrganizationIds
                  .map((id) => organizationById.get(id)?.name)
                  .filter(Boolean)
                  .join("、") || "暫無公開盟友";
                const rivals = organization.rivalOrganizationIds
                  .map((id) => organizationById.get(id)?.name)
                  .filter(Boolean)
                  .join("、") || "暫無公開對手";
                const controlledAssets = familyMatrix.assetControls
                  .filter((asset) => organization.controlledAssetIds.includes(asset.assetControlId))
                  .map((asset) => `${asset.category}「${asset.name}」`)
                  .join("、") || "尚無公開資產";
                const contestedAssets = familyMatrix.assetControls
                  .filter((asset) => organization.contestedAssetIds.includes(asset.assetControlId))
                  .map((asset) => `${asset.category}「${asset.name}」`)
                  .join("、") || "目前無爭奪資產";
                return (
                  <article className="p2PowerCard" key={organization.organizationId}>
                    <header><span>{organization.kindLabel}</span><b>{organization.name}</b></header>
                    <p>{organization.situationBrief}</p>
                    <dl>
                      <div><dt>所在與規模</dt><dd>{organization.territory}・可容納 {organization.memberCapacity.toLocaleString("zh-TW")} 人</dd></div>
                      <div><dt>宗旨</dt><dd>{organization.doctrine}</dd></div>
                      <div><dt>公開目標</dt><dd>{organization.publicGoal}</dd></div>
                      <div><dt>內部危機</dt><dd>{organization.hiddenConflict}</dd></div>
                      <div><dt>盟友／對手</dt><dd>{allies}／{rivals}</dd></div>
                      <div><dt>控制／爭奪</dt><dd>{controlledAssets}／{contestedAssets}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="p2AssetAtlas" data-testid="creation-world-asset-controls" aria-labelledby="p2-world-assets-title">
            <header>
              <div>
                <span>所有權與代價</span>
                <h3 id="p2-world-assets-title">關鍵資源、物件與場域的控制關係</h3>
                <p>每一項都有控制者、實際持有人、聲索者、用途、限制與代價；故事不能無來源地憑空取得。</p>
              </div>
              <strong>本次已生成 {familyMatrix.capacity.materializedStageAssets.toLocaleString("zh-TW")} 項資產候選</strong>
            </header>
            <div className="p2AssetGrid">
              {familyMatrix.assetControls.map((asset) => (
                <article className="p2AssetCard" key={asset.assetControlId}>
                  <header><span>{asset.category}</span><b>{asset.name}</b></header>
                  <p>{asset.visualDescription}</p>
                  <dl>
                    <div><dt>資產控制</dt><dd>{asset.controllerOrganizationName}{asset.controlRelation}</dd></div>
                    <div><dt>持有人</dt><dd>{asset.holderName}</dd></div>
                    <div><dt>其他聲索</dt><dd>{asset.claimantOrganizationName || "無"}</dd></div>
                    <div><dt>用途</dt><dd>{asset.function}</dd></div>
                    <div><dt>限制</dt><dd>{asset.limitation}</dd></div>
                    <div><dt>代價</dt><dd>{asset.cost}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </section>

        </>
      ) : null}
      </details>

      {selectedFamily ? (
        <details className="p2AdvancedCast">
          <summary>進階：調整已選定上場群像的主視角與成員資料</summary>
          <p>{selectedFamily.name}已帶入 {selectedFamily.members.length} 名原創人物。以下只供需要精修姓名或目標時使用；一般使用者不必再逐格設定。</p>
          <div className="p2CastSetup">
            <label data-cast-role="protagonist">
              <span>主角 <b>必填</b><small>故事主要視角與決策者</small></span>
              <input
                data-testid="creation-cast-protagonist"
                value={protagonist.value}
                onChange={(event) => updateProtagonist(event.target.value)}
                placeholder="姓名｜目標、性格弱點或身分"
              />
            </label>
            {supportingSlots.map((entry, index) => (
              <article key={entry.role} data-cast-role={entry.role}>
                <header>
                  <b>{entry.roleLabel}</b>
                  <span>{entry.complete ? "設定完整" : "需要補齊"}</span>
                </header>
                <label>
                  姓名
                  <input
                    data-testid={`creation-cast-${entry.role}-name`}
                    value={entry.name}
                    onChange={(event) => updateSupportingCast(index, "name", event.target.value)}
                    placeholder="原創角色姓名"
                  />
                </label>
                <label>
                  與主角關係
                  <input
                    data-testid={`creation-cast-${entry.role}-relationship`}
                    value={entry.relationship}
                    onChange={(event) => updateSupportingCast(index, "relationship", event.target.value)}
                    placeholder={SUPPORTING_CAST_ROLES[index]?.relationship || "與主角或所屬群體的具體關係"}
                  />
                </label>
                <label>
                  個人目標
                  <input
                    data-testid={`creation-cast-${entry.role}-goal`}
                    value={entry.goal}
                    onChange={(event) => updateSupportingCast(index, "goal", event.target.value)}
                    placeholder="他／她即使離開主角也會追求的目標"
                  />
                </label>
              </article>
            ))}
          </div>
          <p className="p2FoundationHint">目前為 {protagonist.complete ? 1 : 0} 名主角＋{completeSupportingCount} 名有獨立目標的群像人物。變更後會隨作品一起儲存。</p>
        </details>
      ) : null}
    </section>
  );
}

function SeedEditor({ draft, set }: {
  draft: ProjectCreationDraft;
  set: (partial: Partial<ProjectCreationDraft>) => void;
}) {
  const seed = draft.seedCandidate ?? buildSeedCandidate(draft);
  const update = (key: keyof Pick<ProjectSeed, "logline" | "protagonist" | "goal" | "world" | "worldRule" | "conflict" | "opening">, value: string) => set({
    seedCandidate: {
      ...seed,
      [key]: optionalValue(value || null, value ? "user_defined" : "deferred"),
    },
  });
  return (
    <div className="p2CreateFields p2SeedEditor">
      <h2>確認《{draft.title.trim()}》的故事起點</h2>
      <label>一句話故事<textarea value={seed.logline.value || ""} onChange={(event) => update("logline", event.target.value)} /></label>
      <div className="p2SeedEditorGrid">
        <label>主角目標<input value={seed.goal.value || ""} onChange={(event) => update("goal", event.target.value)} /></label>
        <label>主要衝突<textarea value={seed.conflict.value || ""} onChange={(event) => update("conflict", event.target.value)} /></label>
        <label>開場事件<textarea value={seed.opening.value || ""} onChange={(event) => update("opening", event.target.value)} /></label>
      </div>
    </div>
  );
}
