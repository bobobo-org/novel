import type { RpgChoice } from "../game/progression/rpg-progression";
import { normalizeTraditionalChinesePreservingProperNouns } from "../language/traditional-chinese";

export type RpgDirectedChoice = RpgChoice & {
  aiContinuityReason: string;
};

export type StoryOutputLanguage = "zh-TW" | "zh-CN" | "en";

function outputLanguageInstruction(language: StoryOutputLanguage) {
  if (language === "zh-CN") return "只使用简体中文，不得混入繁體字。";
  if (language === "en") return "Use English only. Do not mix Chinese into the story output.";
  return "只使用臺灣繁體中文，不得混入簡體字。";
}

type DirectedChoicePayload = {
  key: "A" | "B" | "C";
  title: string;
  description: string;
  consequence: string;
  continuityReason: string;
};

function cleanText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function parseJsonObject(raw: string) {
  const withoutFence = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("RPG_AI_CHOICE_JSON_MISSING");
  return JSON.parse(withoutFence.slice(start, end + 1)) as Record<string, unknown>;
}

export function parseRpgChoiceDirectorOutput(raw: string): DirectedChoicePayload[] {
  const parsed = parseJsonObject(raw);
  if (!Array.isArray(parsed.choices)) throw new Error("RPG_AI_CHOICE_ARRAY_MISSING");
  const rows = parsed.choices.map((value) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const key = row.key === "A" || row.key === "B" || row.key === "C" ? row.key : null;
    const title = cleanText(row.title, 36);
    const description = cleanText(row.description, 240);
    const consequence = cleanText(row.consequence, 180);
    const continuityReason = cleanText(row.continuityReason, 180);
    if (!key || title.length < 3 || description.length < 18 || consequence.length < 8 || continuityReason.length < 8) {
      throw new Error("RPG_AI_CHOICE_INCOMPLETE");
    }
    return { key, title, description, consequence, continuityReason } satisfies DirectedChoicePayload;
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  if (byKey.size !== 3 || !byKey.has("A") || !byKey.has("B") || !byKey.has("C")) {
    throw new Error("RPG_AI_CHOICE_KEYS_INVALID");
  }
  const ordered = (["A", "B", "C"] as const).map((key) => byKey.get(key)!);
  const identities = ordered.map((row) => normalized(`${row.title}${row.description}`));
  if (new Set(identities).size !== 3) throw new Error("RPG_AI_CHOICES_NOT_DISTINCT");
  for (let left = 0; left < identities.length; left += 1) {
    for (let right = left + 1; right < identities.length; right += 1) {
      const shorter = identities[left].length <= identities[right].length ? identities[left] : identities[right];
      const longer = shorter === identities[left] ? identities[right] : identities[left];
      if (shorter.length > 12 && longer.includes(shorter)) throw new Error("RPG_AI_CHOICES_NOT_DISTINCT");
      if (rpgTextSimilarity(identities[left], identities[right]) >= 0.72) {
        throw new Error("RPG_AI_CHOICES_NOT_DISTINCT");
      }
    }
  }
  return ordered;
}

export function mergeRpgChoiceDirection(
  baseChoices: RpgChoice[],
  directed: DirectedChoicePayload[],
): RpgDirectedChoice[] {
  if (baseChoices.length !== 3) throw new Error("RPG_RULE_CHOICES_INCOMPLETE");
  const byKey = new Map(directed.map((row) => [row.key, row]));
  return baseChoices.map((choice) => {
    const narrative = byKey.get(choice.key as "A" | "B" | "C");
    if (!narrative) throw new Error("RPG_AI_CHOICE_KEY_MISSING");
    return {
      ...choice,
      title: narrative.title,
      description: narrative.description,
      consequence: narrative.consequence,
      acceptedText: `【互動分支 ${choice.key}｜${narrative.title}】\n\n${narrative.description}`,
      aiContinuityReason: narrative.continuityReason,
    };
  });
}

export function buildRpgChoiceDirectorPrompt(input: {
  context: Record<string, unknown>;
  baseChoices: RpgChoice[];
  language: StoryOutputLanguage;
}) {
  return JSON.stringify({
    instruction: [
      "你是閉端小說 RPG 導演。請先理解目前章節、角色、世界規則、未解伏筆、最近選擇與正式 RPG 狀態，再設計本回合 A/B/C。",
      "A 必須是穩健／觀察策略，B 必須是資源／關係策略，C 必須是高風險／突破策略；三者要導向不同事件、人物反應與後續代價。",
      "必須服從 context.project.fixedPlayMode；不得把其他玩法的戰鬥、修煉、戀愛或經營術語與資源混入目前作品。",
      "不得重述前情、不得沿用最近回合標題、不得使用空泛句型，也不得修改 baseChoices 中的成功率、數值、代價或效果。",
      "每個選項都要指出它承接哪個具體上下文。只輸出 JSON，不要 Markdown。",
      outputLanguageInstruction(input.language),
    ].join("\n"),
    outputSchema: {
      choices: [
        { key: "A", title: "3-18字", description: "具體行動與眼前阻力", consequence: "可預期代價", continuityReason: "承接的章節／角色／伏筆依據" },
        { key: "B", title: "3-18字", description: "具體行動與眼前阻力", consequence: "可預期代價", continuityReason: "承接的章節／角色／伏筆依據" },
        { key: "C", title: "3-18字", description: "具體行動與眼前阻力", consequence: "可預期代價", continuityReason: "承接的章節／角色／伏筆依據" },
      ],
    },
    context: input.context,
    immutableRuleChoices: input.baseChoices.map((choice) => ({
      key: choice.key,
      strategy: choice.approach,
      primaryStat: choice.primaryStat,
      secondaryStat: choice.secondaryStat,
      successChance: choice.successChance,
      risk: choice.risk,
      costs: choice.costLabels,
      impacts: choice.impactLabels,
      encounter: choice.encounter,
    })),
  });
}

function grams(value: string) {
  const text = normalized(value);
  const result = new Set<string>();
  for (let index = 0; index < text.length - 2; index += 1) result.add(text.slice(index, index + 3));
  return result;
}

export function rpgTextSimilarity(left: string, right: string) {
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return normalized(left) === normalized(right) ? 1 : 0;
  let overlap = 0;
  for (const gram of a) if (b.has(gram)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

export function cleanRpgContinuation(
  raw: string,
  recentAcceptedTexts: string[],
  language: StoryOutputLanguage = "zh-TW",
) {
  const unwrapped = raw
    .replace(/^\s*```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const choiceBlockIndex = unwrapped.search(
    /(?:^|\n)\s*(?:【\s*(?:下一(?:回合|步|次)[^】]{0,12}(?:選擇|選項)|本回合結算|選項)\s*】|[ABCＡＢＣ][.．、:：]\s*)/u,
  );
  let value = (choiceBlockIndex >= 0 ? unwrapped.slice(0, choiceBlockIndex) : unwrapped)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (language === "zh-TW") {
    value = normalizeTraditionalChinesePreservingProperNouns(
      value,
      recentAcceptedTexts.join("\n"),
    );
  }
  const narrativeLength = value.replace(/\s+/g, "").length;
  const paragraphCount = value.split(/\n+/u).map((paragraph) => paragraph.trim()).filter(Boolean).length;
  const sentenceCount = value.match(/[。！？!?]/gu)?.length ?? 0;
  const englishSentenceCount = value.match(/[.!?](?:\s|$)/gu)?.length ?? 0;
  const completeSentenceCount = language === "en" ? englishSentenceCount : sentenceCount;
  const minimumLength = language === "en" ? 950 : 750;
  const structurallyComplete = (paragraphCount >= 7 || completeSentenceCount >= 14)
    && completeSentenceCount >= 10;
  const mostSimilar = recentAcceptedTexts.reduce(
    (highest, previous) => Math.max(highest, rpgTextSimilarity(value, previous)),
    0,
  );
  // A short answer can also be a verbatim replay. Report the actionable
  // repetition fault first so regeneration changes the scene instead of only
  // padding the same paragraph to satisfy the length gate.
  if (mostSimilar >= 0.68) throw Object.assign(
    new Error("RPG_AI_CONTINUATION_REPETITIVE"),
    { similarityScore: mostSimilar },
  );
  if (narrativeLength < minimumLength || !structurallyComplete) {
    throw new Error("RPG_AI_CONTINUATION_TOO_SHORT");
  }
  if (/^(?:說明|分析|以下是|作為(?:AI|人工智慧)|工程|JSON|```)/i.test(value)) {
    throw new Error("RPG_AI_CONTINUATION_NOT_STORY");
  }
  if (language === "zh-TW" && /[这为个来时会发与还说对从过样开关门体应让边当书气国华见听处进远实线网]/u.test(value)) {
    throw new Error("RPG_AI_CONTINUATION_LANGUAGE_MISMATCH");
  }
  if (language === "zh-CN" && /[這為個來時會發與還說對從過樣開關門體應讓邊當書氣國華見聽處進遠實線網]/u.test(value)) {
    throw new Error("RPG_AI_CONTINUATION_LANGUAGE_MISMATCH");
  }
  if (language === "en" && (value.match(/[\u3400-\u9fff]/gu)?.length ?? 0) > 8) {
    throw new Error("RPG_AI_CONTINUATION_LANGUAGE_MISMATCH");
  }
  return value;
}

export function buildRpgResolutionDirectorPrompt(input: {
  context: Record<string, unknown>;
  choice: RpgChoice;
  language: StoryOutputLanguage;
  turnNumber?: number;
  resolution: {
    outcomeLabel: string;
    roll: number;
    successChance: number;
    settlement: string[];
  };
}) {
  return JSON.stringify({
    instruction: [
      "你是閉端小說故事導演。依照已鎖定的玩家選擇與規則判定，寫出一個完整、沉浸、可直接接到目前章節末尾的小說回合。",
      input.language === "en"
        ? `The first line must be "Round ${input.turnNumber ?? "N"} | <a concrete event title>".`
        : `第一行必須是「第 ${input.turnNumber ?? "N"} 回合｜具體事件標題」；標題要指出本回合真正發生的事，不可使用「新的冒險」等空話。`,
      "開頭要自然承認玩家剛選擇的行動，接著承接最後場景、角色個性、人物關係、世界規則、未解伏筆及最近回合；完整寫出一場有場景、行動、對話、感官、直接後果與新局勢的戲。",
      "使用 8 到 16 個完整段落；情節較長時用 2 到 6 個「一｜分節名」式短標題分節，但正文必須仍然像小說，不得變成儀表板或條列報告。",
      "結果必須符合 lockedResolution，不能改成功或失敗，也不能自創能力值、貨幣或物品數字。至少引入一個由本次選擇造成、下回合可處理的新局勢。",
      "故事要推進到下一次需要玩家決定的自然停頓點，但不要替玩家列出 A／B／C，也不要把未選方案、數值結算或系統文字寫進正文。",
      input.language === "en"
        ? "Write 1,100 to 2,200 characters in 8 to 16 complete paragraphs. Continue character reactions and concrete consequences until the scene reaches a genuine decision point."
        : "正文需有 900 至 1,600 個中文字，分成 8 到 16 個完整段落；未達最低篇幅時繼續推進人物反應、場景變化與直接後果，不要提早總結。",
      "必須服從 context.project.fixedPlayMode；不得把其他玩法的戰鬥、修煉、戀愛或經營術語與資源混入目前作品。",
      "避免摘要、重述、例行訓練、空泛反應與工程說明。只輸出回合標題、小說正文與短分節；不要行動結果、狀態面板、JSON、程式碼、規則解釋或下一組選項，這些會由規則引擎在正文後另行顯示。",
      outputLanguageInstruction(input.language),
    ].join("\n"),
    context: input.context,
    selectedChoice: {
      key: input.choice.key,
      title: input.choice.title,
      action: input.choice.description,
      expectedConsequence: input.choice.consequence,
      continuityReason: "aiContinuityReason" in input.choice
        ? String(input.choice.aiContinuityReason)
        : null,
      encounter: input.choice.encounter,
    },
    lockedResolution: input.resolution,
  });
}
