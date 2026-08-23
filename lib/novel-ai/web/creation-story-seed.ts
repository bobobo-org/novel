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
  return [
    "你是閉端 AI 自動協調器的故事起點編劇。請產生一份具體、可修改、彼此因果一致的原創故事雛形。",
    `作品名稱：${input.title}`,
    `玩法：${input.playModeLabel}`,
    `題材：${input.topic ?? "由作品名稱與已有設定推斷"}`,
    languageInstruction,
    existing,
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
  return current.value?.trim() ? current : suggestedValue(suggestion, source);
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
  const answer = (key: "story" | "protagonist" | "goal" | "conflict" | "worldRule" | "opening", value: string) => {
    const present = draft.answers[key];
    return present?.value?.trim() ? present : suggestedValue(value, source);
  };
  return {
    ...draft,
    coreIdea: draft.coreIdea.value?.trim()
      ? draft.coreIdea
      : suggestedValue(suggestion.logline, source),
    protagonist: draft.protagonist.value?.trim()
      ? draft.protagonist
      : suggestedValue(suggestion.protagonist, source),
    answers: {
      ...draft.answers,
      story: answer("story", suggestion.logline),
      protagonist: answer("protagonist", suggestion.protagonist),
      goal: answer("goal", suggestion.goal),
      conflict: answer("conflict", suggestion.conflict),
      worldRule: answer("worldRule", suggestion.worldRule || suggestion.world),
      opening: answer("opening", suggestion.opening),
    },
    seedCandidate,
    updatedAt: new Date().toISOString(),
  };
}
