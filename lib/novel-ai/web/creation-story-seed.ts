import { buildSeedCandidate } from "../domain/creation";
import {
  optionalValue,
  type ProjectCreationDraft,
  type ProjectSeed,
} from "../domain";

export type CreationStorySeed = {
  logline: string;
  protagonist: string;
  goal: string;
  weakness: string;
  world: string;
  worldRule: string;
  conflict: string;
  opposition: string;
  opening: string;
};

export type CreationStorySeedSource = "closed-ai" | "device-fallback";

export type CreationStorySeedVariation = {
  batchNonce: string;
  batchOrdinal: number;
};

export type DeviceFallbackStorySeedInput = CreationStorySeedVariation & {
  protagonist?: string | null;
  topic: string;
  playMode: "general" | "rpg" | "romance" | "management";
  fixedWorld?: string | null;
  fixedWorldRule?: string | null;
};

const DEVICE_FALLBACK_NAMES = [
  "林知微", "沈星河", "江離", "蘇晚晴", "顧明川", "葉清和", "陸沉舟", "程予安",
  "夏青禾", "周既白", "聞人月", "段雲歸", "艾琳・沃克", "諾亞・陳", "米拉・宋", "里昂・顧",
] as const;
const DEVICE_FALLBACK_GOALS = [
  "找回被奪走的選擇權", "守住一個即將消失的家", "查清一段被集體遺忘的真相",
  "在期限前救回重要的人", "阻止熟悉的世界被另一套規則取代", "證明一場被判定失敗的選擇仍有意義",
] as const;
const DEVICE_FALLBACK_WEAKNESSES = [
  "害怕再次失去重要的人", "過度相信自己可以獨自承擔", "面對親密關係時容易退縮", "習慣把真相看得比人更重要",
] as const;
const DEVICE_FALLBACK_WORLDS = [
  "一座會記錄每次承諾的山城", "一個以記憶交換資源的群島", "一座白天正常、夜裡重排街道的都市",
  "資源與商路同時中斷的邊境聚落", "由五個互不信任勢力共同維持的空中聚落", "每逢月蝕便會顯露過去分支的古國",
] as const;
const DEVICE_FALLBACK_STAGE_FOCUSES = [
  "被封鎖的交通節點與臨時避難所",
  "同時被兩個組織聲索的公開交易現場",
  "只在特定時段開放、藏有舊事故痕跡的禁區",
  "資源即將耗盡、內部意見分裂的共同據點",
  "表面仍正常運作、實際正被祕密規則改寫的街區",
  "迫使敵我雙方暫時共處的災難現場",
] as const;
const DEVICE_FALLBACK_RULES = [
  "任何力量都會留下可追查的代價", "人物只能依自己實際接觸過的情報行動",
  "已發生的事件不能無故重置", "每次改變關係都會同時改變資源與風險",
  "秘密越接近真相，保護它的人就越必須作出選擇", "世界會記住承諾，但不保證用原意實現",
] as const;
const DEVICE_FALLBACK_OPENINGS = [
  "主角在最熟悉的地方，看見一件只有失蹤者才知道的物品。",
  "一封寫著明日日期的信，要求主角在今晚背叛最信任的人。",
  "原本例行的交易突然中止，而所有人都假裝從未見過主角。",
  "主角醒來後發現自己的名字仍在，卻被另一個人合法使用。",
  "一場不該失敗的儀式成功了，代價卻落在完全無關的人身上。",
  "城門關閉前最後一位旅人，帶來了主角已親手銷毀的證據。",
] as const;
const DEVICE_FALLBACK_OPPOSITION = [
  "相信犧牲少數才能維持秩序的執行者",
  "掌握舊規則並拒絕交出權力的聯盟",
  "與主角追求同一目標、卻採取相反方法的人",
] as const;

function stableVariationHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function variationPick<T>(
  values: readonly T[],
  variation: CreationStorySeedVariation,
  field: string,
) {
  const base = stableVariationHash(`${variation.batchNonce}:${field}`);
  const ordinal = Math.max(1, Math.trunc(variation.batchOrdinal));
  return values[(base + ordinal - 1) % values.length];
}

/** Stable for a recorded batch, but guaranteed to rotate across consecutive attempts. */
export function creationStorySeedVariationSeed(variation: CreationStorySeedVariation) {
  return (
    stableVariationHash(variation.batchNonce)
    + Math.max(1, Math.trunc(variation.batchOrdinal)) * 104_729
  ) >>> 0;
}

/**
 * Device-only emergency material. It never claims to be AI output. A batch
 * nonce plus monotonically increasing ordinal makes retries reproducible while
 * ensuring the first several batches do not present the same story again.
 */
export function createDeviceFallbackStorySeed(
  input: DeviceFallbackStorySeedInput,
): CreationStorySeed {
  const hero = input.protagonist?.trim()
    || variationPick(DEVICE_FALLBACK_NAMES, input, "protagonist");
  const goal = variationPick(DEVICE_FALLBACK_GOALS, input, "goal");
  const weakness = variationPick(DEVICE_FALLBACK_WEAKNESSES, input, "weakness");
  const fallbackWorld = variationPick(DEVICE_FALLBACK_WORLDS, input, "world");
  const stageFocus = variationPick(DEVICE_FALLBACK_STAGE_FOCUSES, input, "stage-focus");
  const world = input.fixedWorld?.trim()
    ? `${input.fixedWorld.trim()}\n本次故事舞台焦點：${stageFocus}`
    : fallbackWorld;
  const worldRule = input.fixedWorldRule?.trim()
    || variationPick(DEVICE_FALLBACK_RULES, input, "world-rule");
  const opening = variationPick(DEVICE_FALLBACK_OPENINGS, input, "opening");
  const opposition = variationPick(DEVICE_FALLBACK_OPPOSITION, input, "opposition");
  const modeDirection = input.playMode === "general"
    ? "以人物關係、具體代價與逐層揭露推進章節"
    : "讓每次選擇改變資源、關係與下一回合風險";
  return {
    protagonist: hero,
    goal,
    weakness,
    world,
    worldRule,
    conflict: `${hero}若追查「${goal}」，就會失去眼前的安全；若退縮，危機會先傷害身邊的人。`,
    opposition,
    opening,
    logline: `${hero}在${world}裡，因${opening.replace(/[。！]$/u, "")}而被迫追查${goal}，並面對「${worldRule}」的代價。題材走向為${input.topic}，${modeDirection}。`,
  };
}

/**
 * A tiny latest-request gate for creation-page AI work. React state updates can
 * be deferred, so the mode picker invalidates this gate synchronously before
 * an older provider promise gets a chance to merge into the new mode.
 */
export function createCreationStorySeedRequestGate() {
  let revision = 0;
  let activeController: AbortController | null = null;
  return {
    begin(controller: AbortController) {
      revision += 1;
      const previousController = activeController;
      activeController = controller;
      if (
        previousController
        && previousController !== controller
        && !previousController.signal.aborted
      ) {
        previousController.abort("CREATE_STORY_SEED_SUPERSEDED");
      }
      return revision;
    },
    invalidate(reason: unknown = "CREATE_STORY_SEED_CONTEXT_CHANGED") {
      revision += 1;
      const controller = activeController;
      activeController = null;
      if (controller && !controller.signal.aborted) controller.abort(reason);
    },
    isCurrent(requestRevision: number) {
      return requestRevision === revision;
    },
    complete(requestRevision: number) {
      if (requestRevision === revision) activeController = null;
    },
  };
}

/**
 * React state is intentionally not used as the mutual-exclusion primitive:
 * two clicks can run in the same event loop before a state update commits.
 */
export function tryAcquireCreationStorySeedRun(lockRef: { current: boolean }) {
  if (lockRef.current) return false;
  lockRef.current = true;
  return true;
}

export function releaseCreationStorySeedRun(lockRef: { current: boolean }) {
  lockRef.current = false;
}

type StorySeedJson = {
  story?: unknown;
  protagonist?: {
    name?: unknown;
    goal?: unknown;
    weakness?: unknown;
  };
  world?: {
    setting?: unknown;
    rule?: unknown;
  };
  conflict?: {
    main?: unknown;
    opposition?: unknown;
  };
  opening?: unknown;
};

const FIELD_LIMITS = {
  logline: 420,
  protagonist: 100,
  goal: 260,
  weakness: 220,
  world: 360,
  worldRule: 320,
  conflict: 420,
  opposition: 280,
  opening: 420,
} as const;

function compactText(value: unknown, limit: number) {
  return typeof value === "string"
    ? value.replace(/\s+/gu, " ").trim().slice(0, limit)
    : "";
}

function parseJsonObject(raw: string): StorySeedJson | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as StorySeedJson;
      }
    } catch {
      // Try the bounded object contained in a model code fence next.
    }
  }
  return null;
}

/**
 * The model returns five semantic groups (story, protagonist, world,
 * conflict and opening). They expand into the editable story-seed fields.
 */
export function parseCreationStorySeed(raw: string): CreationStorySeed | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  const seed: CreationStorySeed = {
    logline: compactText(parsed.story, FIELD_LIMITS.logline),
    protagonist: compactText(parsed.protagonist?.name, FIELD_LIMITS.protagonist),
    goal: compactText(parsed.protagonist?.goal, FIELD_LIMITS.goal),
    weakness: compactText(parsed.protagonist?.weakness, FIELD_LIMITS.weakness),
    world: compactText(parsed.world?.setting, FIELD_LIMITS.world),
    worldRule: compactText(parsed.world?.rule, FIELD_LIMITS.worldRule),
    conflict: compactText(parsed.conflict?.main, FIELD_LIMITS.conflict),
    opposition: compactText(parsed.conflict?.opposition, FIELD_LIMITS.opposition),
    opening: compactText(parsed.opening, FIELD_LIMITS.opening),
  };
  return Object.values(seed).every(Boolean) ? seed : null;
}

export function creationStorySeedPrompt(input: {
  title: string;
  language: "zh-TW" | "zh-CN" | "en";
  playModeLabel: string;
  topic: string | null;
  existing: ProjectSeed;
  variation?: CreationStorySeedVariation;
}) {
  const languageInstruction = input.language === "zh-TW"
    ? "全部內容使用自然的繁體中文"
    : input.language === "zh-CN"
      ? "全部内容使用自然的简体中文"
      : "Write every value in natural English";
  const existing = [
    input.existing.logline.value ? `已有故事想法：${input.existing.logline.value}` : "",
    input.existing.protagonist.value ? `已有主角：${input.existing.protagonist.value}` : "",
    input.existing.worldRule.value ? `已有世界規則：${input.existing.worldRule.value}` : "",
    input.existing.conflict.value ? `已有衝突：${input.existing.conflict.value}` : "",
    input.existing.opening.value ? `已有開場：${input.existing.opening.value}` : "",
  ].filter(Boolean).join("\n");
  const topicWorldInstruction = /仙俠|修仙|修真|玄幻/u.test(input.topic ?? "")
    ? "此題材的世界設定必須明確規範境界階梯（凡人、煉氣、築基、金丹、元嬰、化神、煉虛、合體、大乘、渡劫）、宗門與修行家族，以及丹藥、符籙、陣法、武器／法器、靈草與秘境機緣如何取得和付出代價。"
    : "世界設定必須具體交代此題材獨有的身分階序、主要組織、稀缺資源、能力或職業規則，以及違反規則的可追蹤代價；不要只寫通用奇幻背景。";
  return [
    "你是閉端 AI 自動協調器的故事起點編劇。請產生一份具體、可修改、彼此因果一致的原創故事雛形。",
    `作品名稱：${input.title}`,
    `玩法：${input.playModeLabel}`,
    `題材：${input.topic ?? "由作品名稱與已有設定推斷"}`,
    languageInstruction,
    topicWorldInstruction,
    existing,
    input.variation
      ? `本次候選批次：${input.variation.batchOrdinal}；變化識別：${input.variation.batchNonce}。請重新構思，不要重複上一批的事件組合。`
      : "",
    "不得覆寫、否定或改名已有設定；請補足空白並讓新內容與它們一致。",
    "只輸出一個 JSON 物件，不要 Markdown、解說或前後文字。必須恰有以下五個頂層欄位與完整子欄位：",
    '{"story":"一句話故事","protagonist":{"name":"主角姓名","goal":"具體目標","weakness":"性格弱點"},"world":{"setting":"故事舞台","rule":"不可任意違反的世界規則"},"conflict":{"main":"目標、阻力與失敗代價","opposition":"主要對手或阻力來源"},"opening":"第一幕立即發生的具體事件"}',
  ].filter(Boolean).join("\n");
}

function suggestedValue(value: string, source: CreationStorySeedSource) {
  const next = optionalValue(
    value,
    source === "closed-ai" ? "ai_suggested" : "inferred",
  );
  return {
    ...next,
    source: source === "closed-ai" ? "ai_candidate" as const : "system" as const,
  };
}

function keepOrSuggest(
  current: ProjectSeed[keyof Pick<
    ProjectSeed,
    "logline" | "protagonist" | "goal" | "weakness" | "world" | "worldRule" | "conflict" | "opposition" | "opening"
  >],
  suggestion: string,
  source: CreationStorySeedSource,
) {
  const authorLocked = Boolean(current.value?.trim()) && (
    current.status === "user_defined"
    || current.status === "ai_accepted"
    || current.source === "migration"
  );
  return authorLocked ? current : suggestedValue(suggestion, source);
}

/** Fill only empty fields. User-authored and previously edited values win. */
export function mergeCreationStorySeed(
  draft: ProjectCreationDraft,
  suggestion: CreationStorySeed,
  source: CreationStorySeedSource,
): ProjectCreationDraft {
  const current = draft.seedCandidate ?? buildSeedCandidate(draft);
  const seedCandidate: ProjectSeed = {
    ...current,
    logline: keepOrSuggest(current.logline, suggestion.logline, source),
    protagonist: keepOrSuggest(current.protagonist, suggestion.protagonist, source),
    goal: keepOrSuggest(current.goal, suggestion.goal, source),
    weakness: keepOrSuggest(current.weakness, suggestion.weakness, source),
    world: keepOrSuggest(current.world, suggestion.world, source),
    worldRule: keepOrSuggest(current.worldRule, suggestion.worldRule, source),
    conflict: keepOrSuggest(current.conflict, suggestion.conflict, source),
    opposition: keepOrSuggest(current.opposition, suggestion.opposition, source),
    opening: keepOrSuggest(current.opening, suggestion.opening, source),
  };
  const answer = (key: "story" | "protagonist" | "goal" | "conflict" | "world" | "worldRule" | "opening", value: string) => {
    const present = draft.answers[key];
    return present ? keepOrSuggest(present, value, source) : suggestedValue(value, source);
  };
  return {
    ...draft,
    coreIdea: keepOrSuggest(draft.coreIdea, suggestion.logline, source),
    protagonist: keepOrSuggest(draft.protagonist, suggestion.protagonist, source),
    answers: {
      ...draft.answers,
      story: answer("story", suggestion.logline),
      protagonist: answer("protagonist", suggestion.protagonist),
      goal: answer("goal", suggestion.goal),
      conflict: answer("conflict", suggestion.conflict),
      world: answer("world", suggestion.world),
      worldRule: answer("worldRule", suggestion.worldRule),
      opening: answer("opening", suggestion.opening),
    },
    seedCandidate,
    updatedAt: new Date().toISOString(),
  };
}
