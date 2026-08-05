import {
  STORY_LIBRARY,
  recommendStoryTopics,
  resolveStoryTopic,
} from "./story-library";
import {
  setOptional,
  type OptionalField,
} from "./story-library-types";
import type { AdultExperienceProfile } from "./adult-experience-profile";

export type CreationEntryMode = "quick" | "guided" | "explore";
export type CreationMethod = "" | "topic" | "idea" | "recommend" | "random" | "blank";
export type CreationOptionalKey =
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

export type CreationWizard = {
  entryMode: CreationEntryMode;
  creationMethod: CreationMethod;
  title: string;
  coreIdea: string;
  consumerGroupId: string;
  packId: string;
  topicId: string;
  subCategory: string;
  playModeId: string;
  enabledStats: string[];
  optionalFields: Record<CreationOptionalKey, OptionalField>;
  adultMode: boolean;
  ageConfirmed: boolean;
  adultExperienceProfile: AdultExperienceProfile;
};

export type CreationFoundationItem = {
  key: "title" | "method" | "direction" | "protagonist" | "playMode" | "world" | "dramaticEngine";
  label: string;
  detail: string;
  required: boolean;
  ready: boolean;
};

const GAME_MODE_IDS = new Set(["interactive", "rpg", "romance", "management", "adult"]);
const DEFAULT_TOPIC_BY_MODE: Record<string, string> = {
  general: "classic-topic-002",
  interactive: "classic-topic-014",
  rpg: "classic-topic-014",
  romance: "classic-topic-004",
  management: "classic-topic-015",
};
const DEFAULT_STATS_BY_MODE: Record<string, string[]> = {
  interactive: ["turns", "reputation", "questProgress"],
  rpg: ["stamina", "money", "experience", "level", "turns", "questProgress"],
  romance: ["affection", "reputation", "turns"],
  management: ["money", "reputation", "turns", "questProgress"],
  adult: ["affection", "reputation", "turns"],
};
const PROTAGONIST_NAMES = ["林知微", "沈星河", "江離", "蘇晚晴", "顧明川", "葉清和"];

function valueOf(wizard: CreationWizard, key: CreationOptionalKey) {
  return String(wizard.optionalFields[key]?.value ?? "").trim();
}

function stableIndex(value: string, length: number) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % length;
}

export function isStructuredGameMode(playModeId: string | null | undefined) {
  return GAME_MODE_IDS.has(String(playModeId ?? ""));
}

export function creationFoundationChecklist(wizard: CreationWizard): CreationFoundationItem[] {
  const gameMode = isStructuredGameMode(wizard.playModeId);
  const explicitBlankNovel = wizard.creationMethod === "blank" && !gameMode;
  const structuredStart = !explicitBlankNovel;
  const hasDirection = Boolean(wizard.coreIdea.trim() || wizard.topicId);
  const hasDramaticEngine = Boolean(valueOf(wizard, "goal") || valueOf(wizard, "conflict"));
  return [
    {
      key: "title",
      label: "作品名稱",
      detail: "先確認這次要建立的是哪一部作品",
      required: true,
      ready: Boolean(wizard.title.trim()),
    },
    {
      key: "method",
      label: "開始方式",
      detail: "自己設定、精靈代設，或明確選擇空白小說",
      required: true,
      ready: Boolean(wizard.creationMethod),
    },
    {
      key: "direction",
      label: "故事方向",
      detail: "至少有一句核心想法或一個題材",
      required: structuredStart,
      ready: hasDirection,
    },
    {
      key: "protagonist",
      label: "主要人物",
      detail: "先知道這個故事跟著誰走",
      required: structuredStart,
      ready: Boolean(valueOf(wizard, "protagonist")),
    },
    {
      key: "playMode",
      label: "閱讀／遊玩方式",
      detail: "一般寫作、三選一、RPG、戀愛或經營",
      required: structuredStart,
      ready: Boolean(wizard.playModeId),
    },
    {
      key: "world",
      label: "故事舞台",
      detail: "互動與養成需要一個可發生事件的世界",
      required: gameMode,
      ready: Boolean(valueOf(wizard, "world")),
    },
    {
      key: "dramaticEngine",
      label: "目標或衝突",
      detail: "建議先設定，AI 才知道第一幕要推動什麼",
      required: false,
      ready: hasDramaticEngine,
    },
  ];
}

export function creationFoundationMissing(wizard: CreationWizard) {
  return creationFoundationChecklist(wizard).filter((item) => item.required && !item.ready);
}

export function buildLocalCreationGuide(wizard: CreationWizard): Partial<CreationWizard> {
  const playModeId = wizard.playModeId || "general";
  const rankedTopics = recommendStoryTopics({
    coreIdea: wizard.coreIdea,
    groupId: wizard.consumerGroupId || undefined,
    playModeId: playModeId || undefined,
    includeAdult: wizard.adultMode,
    ageConfirmed: wizard.ageConfirmed,
  }, 16);
  const preferredTopic = resolveStoryTopic(wizard.topicId)
    ?? rankedTopics[0]
    ?? resolveStoryTopic(DEFAULT_TOPIC_BY_MODE[playModeId])
    ?? STORY_LIBRARY.topics.find((topic) =>
      topic.enabled
      && (!topic.adultOnly || (wizard.adultMode && wizard.ageConfirmed))
      && (playModeId === "general" || topic.supportedPlayModes.includes(playModeId)))
    ?? STORY_LIBRARY.topics.find((topic) => topic.enabled && !topic.adultOnly)
    ?? null;
  const topicName = preferredTopic?.name ?? "原創幻想";
  const subCategory = wizard.subCategory || preferredTopic?.subCategories[0] || "命運轉折";
  const name = valueOf(wizard, "protagonist")
    || PROTAGONIST_NAMES[stableIndex(`${wizard.title}|${topicName}|${playModeId}`, PROTAGONIST_NAMES.length)];
  const coreIdea = wizard.coreIdea.trim()
    || `${name}在「${topicName}」的世界裡，因${subCategory}被迫做出會改變自己與同伴命運的選擇。`;
  const guideValues: Partial<Record<CreationOptionalKey, string>> = {
    protagonist: name,
    identity: `${topicName}世界裡尚未被看見的行動者`,
    archetype: "有明確渴望、也會犯錯的成長型主角",
    goal: `在局勢失控前完成「${subCategory}」相關目標，保住最在意的人或事`,
    weakness: "遇到重要關係時容易猶豫，必須為每次選擇承擔代價",
    world: `${topicName}世界；日常秩序下藏著會被人物選擇改變的勢力、資源與祕密`,
    worldRule: "重要能力必須付出成本；人物只知道自己合理接觸過的資訊；已發生事件不能無故重置",
    factions: "維持秩序的既得利益者、尋求改變的行動者，以及立場會隨事件轉變的中間群體",
    conflict: `${name}若追查${subCategory}，會失去眼前的安全；若退縮，危機將先傷害身邊的人`,
    villain: "不是只為作惡，而是用另一套合理價值觀爭奪同一個目標的人",
    style: "場景先於說明、人物用行動表達情緒、每章留下具體推進與可回收懸念",
    storySeed: `${name}原本只想度過平凡的一天，卻在最熟悉的地方發現一項不該存在的線索。`,
  };
  const optionalFields = { ...wizard.optionalFields };
  for (const [key, value] of Object.entries(guideValues) as Array<[CreationOptionalKey, string]>) {
    if (!valueOf(wizard, key)) {
      optionalFields[key] = setOptional(value, "rule_suggested", "local-rule");
    }
  }
  return {
    entryMode: "guided",
    creationMethod: wizard.creationMethod || "recommend",
    title: wizard.title.trim(),
    coreIdea,
    consumerGroupId: wizard.consumerGroupId || preferredTopic?.consumerGroupId || "",
    packId: wizard.packId || preferredTopic?.packId || "",
    topicId: wizard.topicId || preferredTopic?.topicId || "",
    subCategory,
    playModeId,
    enabledStats: wizard.enabledStats.length
      ? wizard.enabledStats
      : [...(DEFAULT_STATS_BY_MODE[playModeId] ?? [])],
    optionalFields,
  };
}
