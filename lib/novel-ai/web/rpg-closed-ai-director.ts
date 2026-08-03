import type { RpgChoice } from "../game/progression/rpg-progression";

export type RpgDirectedChoice = RpgChoice & {
  aiContinuityReason: string;
};

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
}) {
  return JSON.stringify({
    instruction: [
      "你是閉端小說 RPG 導演。請先理解目前章節、角色、世界規則、未解伏筆、最近選擇與正式 RPG 狀態，再設計本回合 A/B/C。",
      "A 必須是穩健／觀察策略，B 必須是資源／關係策略，C 必須是高風險／突破策略；三者要導向不同事件、人物反應與後續代價。",
      "不得重述前情、不得沿用最近回合標題、不得使用空泛句型，也不得修改 baseChoices 中的成功率、數值、代價或效果。",
      "每個選項都要指出它承接哪個具體上下文。只輸出 JSON，不要 Markdown。",
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

export function cleanRpgContinuation(raw: string, recentAcceptedTexts: string[]) {
  const value = raw
    .replace(/^\s*```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  // qwen2.5:3b reliably produces a compact 2–3 sentence turn even when given a
  // larger token budget. The verified formula settlement is appended by the
  // canonical transaction, so reject fragments while allowing complete,
  // responsive local-model turns instead of demanding padded prose.
  if (value.length < 64) throw new Error("RPG_AI_CONTINUATION_TOO_SHORT");
  if (/^(?:說明|分析|以下是|作為(?:AI|人工智慧)|工程|JSON|```)/i.test(value)) {
    throw new Error("RPG_AI_CONTINUATION_NOT_STORY");
  }
  const mostSimilar = recentAcceptedTexts.reduce(
    (highest, previous) => Math.max(highest, rpgTextSimilarity(value, previous)),
    0,
  );
  if (mostSimilar >= 0.72) throw Object.assign(
    new Error("RPG_AI_CONTINUATION_REPETITIVE"),
    { similarityScore: mostSimilar },
  );
  return value;
}

export function buildRpgResolutionDirectorPrompt(input: {
  context: Record<string, unknown>;
  choice: RpgChoice;
  resolution: {
    outcomeLabel: string;
    roll: number;
    successChance: number;
    settlement: string[];
  };
}) {
  return JSON.stringify({
    instruction: [
      "你是閉端小說 RPG 導演。依照已鎖定的玩家選擇與規則判定，寫出 3 到 6 段可直接接到目前章節末尾的繁體中文正文。",
      "必須承接最後場景、角色個性、人物關係、世界規則、未解伏筆及最近回合；用動作、對話、感官和具體新變化推進。",
      "結果必須符合 lockedResolution，不能改成功或失敗，也不能自創能力值、貨幣或物品數字。至少引入一個由本次選擇造成、下回合可處理的新局勢。",
      "正文至少 150 個繁體中文字，分成 3 到 6 個完整段落；未達最低篇幅時繼續推進人物反應與直接後果，不要提早總結。",
      "避免摘要、重述、例行訓練、空泛反應與工程說明。只輸出小說正文，不要標題、JSON 或 Markdown。",
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
