import type { RpgChoice } from "../game/progression/rpg-progression";

export type RpgDirectedChoice = RpgChoice;

export type StoryOutputLanguage = "zh-TW" | "zh-CN" | "en";

const INTERNAL_STORY_MECHANICS_PATTERNS: ReadonlyArray<{
  kind: string;
  pattern: RegExp;
}> = [
  {
    kind: "internal-horizon",
    pattern: /\b(?:internal[\s_-]*)?(?:arc[\s_-]*)?horizon\b/iu,
  },
  {
    kind: "internal-arc-phase",
    pattern: /\b(?:arc[\s_-]*phase|(?:setup|escalation|reversal|climax|resolution)[\s_-]*phase)\b/iu,
  },
  {
    kind: "internal-arc-phase",
    pattern: /\b(?:arc|story|plot|narrative)\s+(?:is\s+)?(?:currently\s+)?(?:in|at|entering|enters?|has\s+entered)\s+(?:the\s+)?(?:setup|escalation|reversal|climax|resolution)(?:\s+(?:phase|stage))?\b/iu,
  },
  {
    kind: "internal-arc-phase",
    pattern: /(?:內部|系統|故事弧|劇情弧)(?:規劃)?(?:的)?(?:階段|相位)/u,
  },
  {
    kind: "internal-arc-phase",
    pattern: /(?:故事弧|劇情弧|主線|本卷)[^。！？\n]{0,16}(?:正處於|處於|進入|來到|目前是|現在是)[^。！？\n]{0,8}(?:鋪陳|升壓|升級|轉折|反轉|高潮|收束|結算|解決)(?:階段|相位)?/u,
  },
  {
    kind: "ending-criteria",
    pattern: /(?:結局|結案|完結|收束)(?:的)?(?:條件|門檻|判定|檢查|清單|觸發規則|證據要求|契約版本)/u,
  },
  {
    kind: "ending-criteria",
    pattern: /\b(?:ending|closure)[\s_-]*(?:condition|criteria|threshold|gate|checklist|trigger|evidence|contract)\b/iu,
  },
  {
    kind: "ending-criteria",
    pattern: /\b(?:conditions?|criteria|requirements?|thresholds?|gates?|checklists?|triggers?|evidence)\s+(?:required\s+)?(?:for|to\s+reach)\s+(?:the\s+)?(?:ending|closure)\b/iu,
  },
  {
    kind: "ending-criteria",
    pattern: /(?:達成|觸發|進入)(?:結局|結案|完結|收束)(?:所需|需要|必須)?(?:的)?(?:條件|門檻|證據|檢查)/u,
  },
  {
    kind: "preset-round-count",
    pattern: /(?:預設|固定|規劃|總共|總計|上限|最多|最晚|剩下|還有|再過)[^。！？\n]{0,12}(?:第\s*)?(?:\d{1,3}|[一二三四五六七八九十百兩]+)\s*(?:個)?回合/u,
  },
  {
    kind: "preset-round-count",
    pattern: /(?:故事弧|劇情弧|因果鏈|主線|本卷)[^。！？\n]{0,12}(?:\d{1,3}|[一二三四五六七八九十百兩]+)\s*(?:個)?回合/u,
  },
  {
    kind: "preset-round-count",
    pattern: /\b(?:preset|planned|fixed|maximum|total)\s+(?:of\s+)?\d{1,3}\s+rounds?\b/iu,
  },
  {
    kind: "preset-round-count",
    pattern: /\b(?:preset|planned|fixed|maximum|total|limited|scheduled|designed)[^.!?\n]{0,20}(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:rounds?|turns?)\b/iu,
  },
  {
    kind: "preset-round-count",
    pattern: /\b(?:story|arc|plot|narrative|volume)[^.!?\n]{0,20}(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:rounds?|turns?)\b/iu,
  },
  {
    kind: "preset-round-count",
    pattern: /\b\d{1,3}[\s-]*round\s+(?:arc|limit|horizon|plan)\b/iu,
  },
  {
    kind: "preset-round-count",
    pattern: /\b(?:ends?|finishes|concludes|closes)\s+(?:on|at|by)\s+round\s+\d{1,3}\b/iu,
  },
  {
    kind: "preset-round-count",
    pattern: /\b(?:ends?|finishes|concludes|closes)\s+(?:on|at|by|after)\s+(?:round|turn)\s+(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/iu,
  },
  {
    kind: "preset-round-count",
    pattern: /\b\d{1,3}\s+rounds?\s+(?:remain|remaining|left)\b/iu,
  },
  {
    kind: "preset-round-count",
    pattern: /\b(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:rounds?|turns?)\s+(?:remain|remaining|left)\b/iu,
  },
  {
    kind: "preset-round-count",
    pattern: /(?:\d{1,3}|[一二三四五六七八九十百兩]+)\s*(?:個)?回合[^。！？\n]{0,6}(?:後|內|時|就會|必須|將)[^。！？\n]{0,10}(?:結束|結案|完結|收束|進入結局)/u,
  },
  {
    kind: "preset-round-count",
    pattern: /(?:到|於|在)(?:了)?第\s*(?:\d{1,3}|[一二三四五六七八九十百兩]+)\s*回合[^。！？\n]{0,10}(?:結束|結案|完結|收束|進入結局)/u,
  },
  {
    kind: "family-stage-internal-contract",
    pattern: /(?:世界契約|題材契約|所屬家族\s*ID|因果維度)(?:\s*[：:=]\s*[^，。；\n]+)?/iu,
  },
  {
    kind: "story-engine-language",
    pattern: /(?:核准規則|規則校準|關係張力|下一回合|下一輪可用)(?:\s*[：:=]\s*[^，。；\n]+)?/iu,
  },
  {
    kind: "family-stage-internal-contract",
    pattern: /\b(?:contractStatement|canonicalStatus|schemaVersion|VIRTUAL_CANDIDATE)\b(?:\s*[：:=]\s*[^,.;\n]+)?/iu,
  },
];

const INTERNAL_PROMPT_KEYS = new Set([
  "arckey",
  "arcstartturn",
  "arclocalturn",
  "archorizon",
  "arcphase",
  "arcresolved",
  "arcresolutionkind",
  "arcnextaction",
  "persistentarc",
  "readerdisclosure",
  "endingreachable",
  "endingoptionsrequired",
  "mayrevealendingconditions",
  "mayrevealpresethorizon",
  "newsubplotbudget",
  "causalchainaction",
  "successfactorids",
  "contextsignature",
  "contractstatement",
  "canonicalstatus",
  "schemaversion",
  "virtualcandidate",
]);

function internalPromptKey(key: string) {
  const normalizedKey = key.normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]/gu, "");
  return INTERNAL_PROMPT_KEYS.has(normalizedKey)
    || normalizedKey.includes("horizon")
    || normalizedKey === "phase"
    || normalizedKey.startsWith("endingcondition")
    || normalizedKey.startsWith("endingcriteria")
    || normalizedKey.startsWith("endingthreshold");
}

function redactInternalStoryMechanics(value: string) {
  // This label is internal provenance, not story prose. Keep the learned
  // instruction after the label so Closed AI still benefits from it.
  let next = value.replace(/核准規則校準\s*[：:]\s*/gu, "");
  for (const { pattern } of INTERNAL_STORY_MECHANICS_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    next = next.replace(new RegExp(pattern.source, flags), "既有故事節奏");
  }
  return next.replace(/\s{2,}/gu, " ").trim();
}

/**
 * Defense in depth for every value serialized into a closed-AI prompt.  It
 * removes planning-only fields and redacts planning phrases while preserving
 * reader-visible story facts, the current turn, and the currently offered
 * actions.
 */
export function toRpgReaderSafePromptPayload<T>(value: T): T {
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") return redactInternalStoryMechanics(current);
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(Object.entries(current as Record<string, unknown>)
      .filter(([key]) => !internalPromptKey(key))
      .map(([key, child]) => [key, visit(child)]));
  };
  return visit(value) as T;
}

export function assertRpgReaderSafeOutput(value: string) {
  for (const { kind, pattern } of INTERNAL_STORY_MECHANICS_PATTERNS) {
    if (!pattern.test(value)) continue;
    throw Object.assign(new Error("RPG_AI_INTERNAL_STORY_MECHANICS_LEAK"), {
      leakKind: kind,
    });
  }
}

export function buildRpgReaderSafeChoicePayload(choice: RpgChoice) {
  return toRpgReaderSafePromptPayload({
    key: choice.key,
    title: choice.title,
    description: choice.description,
    consequenceTeaser: choice.consequenceTeaser,
    strategy: choice.approach,
    primaryStat: choice.primaryStat,
    secondaryStat: choice.secondaryStat,
    successChance: choice.successChance,
    risk: choice.risk,
    costs: choice.costLabels,
    impacts: choice.impactLabels,
    storySignals: {
      title: choice.encounter.title,
      telegraph: choice.encounter.telegraph,
      complication: choice.encounter.complication,
      locationShift: choice.encounter.locationShift,
      worldAspect: choice.encounter.worldAspect,
      catalyst: choice.encounter.catalyst,
      goal: choice.encounter.goal,
      pressure: choice.encounter.pressure,
      leverage: choice.encounter.leverage,
      resourceProp: choice.encounter.resourceProp,
      relationshipTension: choice.encounter.relationshipTension,
      cost: choice.encounter.cost,
      deadline: choice.encounter.deadline,
      reversal: choice.encounter.reversal,
      aftermath: choice.encounter.aftermath,
    },
  });
}

function outputLanguageInstruction(language: StoryOutputLanguage) {
  if (language === "zh-CN") return "只使用简体中文，不得混入繁體字。";
  if (language === "en") return "Use English only. Do not mix Chinese into the story output.";
  return "只使用臺灣繁體中文，不得混入簡體字。";
}

type DirectedChoicePayload = {
  key: "A" | "B" | "C";
  title: string;
  description: string;
  consequenceTeaser: string;
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
  assertRpgReaderSafeOutput(raw);
  const parsed = parseJsonObject(raw);
  if (!Array.isArray(parsed.choices)) throw new Error("RPG_AI_CHOICE_ARRAY_MISSING");
  const rows = parsed.choices.map((value) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const key = row.key === "A" || row.key === "B" || row.key === "C" ? row.key : null;
    const title = cleanText(row.title, 18);
    const description = cleanText(row.description, 72);
    const consequenceTeaser = cleanText(row.consequenceTeaser, 40);
    if (!key || title.length < 8 || description.length < 30 || consequenceTeaser.length < 12) {
      throw new Error("RPG_AI_CHOICE_INCOMPLETE");
    }
    return { key, title, description, consequenceTeaser } satisfies DirectedChoicePayload;
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
      consequenceTeaser: narrative.consequenceTeaser,
      acceptedText: `【互動分支 ${choice.key}｜${narrative.title}】\n\n${narrative.description}`,
    };
  });
}

export function buildRpgChoiceDirectorPrompt(input: {
  context: Record<string, unknown>;
  baseChoices: RpgChoice[];
  language: StoryOutputLanguage;
  readerSafeCausalContracts?: readonly unknown[];
}) {
  return JSON.stringify({
    instruction: [
      "你是閉端小說 RPG 文案導演。請理解目前章節、角色、世界規則、未解伏筆、最近選擇與正式 RPG 狀態，僅潤飾本回合 A/B/C 的顯示文案。",
      "每個 key 已由規則引擎綁定策略，而且 A/B/C 的策略位置會輪替；必須逐項服從 immutableRuleChoices，不可自行假設 A、B、C 的策略。",
      "context.project.fixedPlayMode 只鎖定本回合的操作、數值與結算方式；世界規則與 Lore 已核定的修煉、宗門、家族、丹藥、符籙、陣法、法器或靈草等題材詞仍必須保留。不得憑空引入其他玩法的數值機制。",
      "不得重述前情、不得沿用最近回合標題、不得使用空泛句型。只能重寫 title、description、consequenceTeaser；不得輸出或修改策略、需求、成功率、風險、成本、效果、判定或其他規則欄位。",
      "不得透露或猜測任何預設回合總數、回合上限、內部故事弧階段、結局條件、門檻或判定機制。若 readerSafeCausalContracts 提供 currentDirections，只能描述當下列出的三個方向，不得解釋它們為何現在出現。",
      "三項要承接具體上下文並導向不同事件與人物反應；若 context.selectedStageFamily、stagedOrganizations、stagedAssets 已提供資料，三項應分別讓具體人物、勢力或資產介入，不能只替換策略形容詞。只輸出 JSON，不要 Markdown。",
      outputLanguageInstruction(input.language),
    ].join("\n"),
    outputSchema: {
      choices: [
        { key: "A", title: "8-18字", description: "30-72字的具體行動與眼前阻力", consequenceTeaser: "12-40字的可預期後果提示" },
        { key: "B", title: "8-18字", description: "30-72字的具體行動與眼前阻力", consequenceTeaser: "12-40字的可預期後果提示" },
        { key: "C", title: "8-18字", description: "30-72字的具體行動與眼前阻力", consequenceTeaser: "12-40字的可預期後果提示" },
      ],
    },
    context: toRpgReaderSafePromptPayload(input.context),
    immutableRuleChoices: input.baseChoices.map(buildRpgReaderSafeChoicePayload),
    readerSafeCausalContracts: toRpgReaderSafePromptPayload(input.readerSafeCausalContracts ?? []),
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

export async function cleanRpgContinuation(
  raw: string,
  recentAcceptedTexts: string[],
  language: StoryOutputLanguage = "zh-TW",
) {
  const unwrapped = raw
    .replace(/^\s*```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  assertRpgReaderSafeOutput(unwrapped);
  const choiceBlockIndex = unwrapped.search(
    /(?:^|\n)\s*(?:【\s*(?:下一(?:回合|步|次)[^】]{0,12}(?:選擇|選項)|本回合結算|選項)\s*】|[ABCＡＢＣ][.．、:：]\s*)/u,
  );
  let value = (choiceBlockIndex >= 0 ? unwrapped.slice(0, choiceBlockIndex) : unwrapped)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (language === "zh-TW") {
    const { normalizeTraditionalChinesePreservingProperNouns } = await import(
      "../language/traditional-chinese"
    );
    value = normalizeTraditionalChinesePreservingProperNouns(
      value,
      recentAcceptedTexts.join("\n"),
    );
  }
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
  validateRpgStoryTurnContract(value, language);
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

export function validateRpgStoryTurnContract(
  value: string,
  language: StoryOutputLanguage = "zh-TW",
) {
  assertRpgReaderSafeOutput(value);
  const visibleEngineLanguage = language === "en"
    ? /\b(?:approved rule|rule calibration|this turn(?:'s)? goal|relationship tension|state update|settlement result|next-turn available|game loop|causal framework|system (?:stores?|will|does not))\b/iu
    : /核准規則|規則校準|本回合(?:目標|結算)|下一回合|回合制|關係張力|狀態更新|結算結果|下一輪可用|規則判定|因果框架|故事弧編號|作品\s*Canon|世界契約|題材契約|所屬家族\s*ID|因果維度|系統(?:保存|會|不會)/u;
  if (visibleEngineLanguage.test(value)) {
    throw new Error("RPG_AI_CONTINUATION_ENGINE_LANGUAGE_VISIBLE");
  }
  const narrativeLength = value.replace(/\s+/gu, "").length;
  const paragraphCount = value
    .split(/\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean).length;
  const sentenceCount = language === "en"
    ? value.match(/[.!?](?:\s|$)/gu)?.length ?? 0
    : value.match(/[。！？!?]/gu)?.length ?? 0;
  const minimumLength = language === "en" ? 950 : 900;
  const maximumLength = language === "en" ? 2_200 : 1_600;
  if (narrativeLength < minimumLength || paragraphCount < 8 || sentenceCount < 10) {
    throw Object.assign(new Error("RPG_AI_CONTINUATION_TOO_SHORT"), {
      narrativeLength,
      paragraphCount,
      sentenceCount,
      minimumLength,
    });
  }
  if (narrativeLength > maximumLength || paragraphCount > 16) {
    throw Object.assign(new Error("RPG_AI_CONTINUATION_TOO_LONG"), {
      narrativeLength,
      paragraphCount,
      maximumLength,
      maximumParagraphs: 16,
    });
  }
  return {
    narrativeLength,
    paragraphCount,
    sentenceCount,
    minimumLength,
    maximumLength,
    minimumParagraphs: 8 as const,
    maximumParagraphs: 16 as const,
  };
}

export function buildRpgResolutionDirectorPrompt(input: {
  context: Record<string, unknown>;
  choice: RpgChoice;
  language: StoryOutputLanguage;
  turnNumber?: number;
  readerSafeCausalContract?: unknown;
  resolution: {
    outcomeLabel: string;
    roll: number;
    successChance: number;
    settlement: string[];
  };
}) {
  return JSON.stringify({
    instruction: [
      "你是閉端小說故事導演。依照已鎖定的讀者選擇與既定結果，寫出一段完整、沉浸、可直接接到目前章節末尾的小說正文。",
      input.language === "en"
        ? "The first line must be a concrete literary title enclosed in angle quotation marks, with no round number or game label."
        : "第一行必須是「〈具體場景或事件標題〉」；不可顯示回合數、遊戲標籤，也不可使用「新的冒險」等空話。",
      "開頭要自然承認玩家剛選擇的行動，接著承接最後場景、角色個性、人物關係、世界規則、未解伏筆及最近回合；完整寫出一場有場景、行動、對話、感官、直接後果與新局勢的戲。",
      "把 context.stagedFamilies、supportingCharacters 與 relationships 視為會主動改變局勢的上場人物網絡，不可只讓主角自言自語。若既有資料提供至少兩名配角，正文至少讓主角與兩名具名配角登場；兩名配角必須各自採取不同且可見的行動，並由不同人物說出至少兩句推動衝突的對話。",
      "上場家族或派系必須透過成員、信使、資源、承諾、阻攔或旁觀者反應實際介入場景；不可只列家族名稱或把所有人都寫成服從主角的背景板。若既有資料不足兩名配角，可依世界規則創造原創臨時人物補足現場互動，但不得使用真實人物，也不得宣稱臨時人物已成為正式 Canon。",
      "若 context.selectedStageFamily、stagedOrganizations、stagedAssets 已提供資料，必須選用其中至少一個已核定資產，讓其控制勢力、目前持有人與聲索勢力透過行動形成可見因果；不得改名、換持有人或只把資料列成清單。資產的作用、限制與代價要成為場景阻力或解法。",
      "supportingCharacters.hiddenMotivations 只用來塑造角色行為；除非目前證據已揭露，不可讓角色直接說出秘密，也不可把欄位名稱寫入正文。",
      "人物的既有目標、拒絕底線與關係摘要要化成動作、語氣和選擇，不要列人物卡、設定表、家族 ID、派系 ID 或資料庫欄位。",
      "小說標題後使用 8 到 16 個完整小說段落；不要另加分節標題、編號或小標，避免把同一段拆成只有一句的碎片。",
      "結果必須符合 lockedResolution，不能改成功或失敗，也不能自創能力值、貨幣或物品數字。至少引入一個由本次選擇造成、下回合可處理的新局勢。",
      "故事要推進到需要玩家決定的自然停頓點，以門被推開、證據被交出、人物要求回答或迫近事件等具體畫面收尾；不要寫『下一回合』『下一輪』『等待下一步』等介面語句，不要替玩家列出 A／B／C，也不要把未選方案、數值結算或系統文字寫進正文。",
      input.language === "en"
        ? "Write 1,100 to 2,200 characters. After the literary title, write exactly 10 complete story paragraphs with no extra headings; keep each paragraph substantial and continue until the scene reaches a genuine decision point."
        : "正文需有 900 至 1,600 個中文字。小說標題後恰好寫 10 個完整小說段落，不加分節標題；每段約 130 至 155 個中文字，正文總長以 1,050 至 1,450 字為安全目標，未達最低篇幅時不得提早總結。",
      input.language === "en"
        ? "Use the ten paragraphs in order for: immediate action, resistance, opposing reaction, sensory escalation, irreversible cost, result taking effect, relationship reaction, changed environment, new danger, and a genuine decision point. Do not print this plan."
        : "十段依序完成：行動落地、阻力出現、對手反應、感官升壓、不可逆代價、判定結果生效、人物關係反應、環境改變、新危險逼近、自然決策點。不要把這份段落計畫印出來。",
      "context.project.fixedPlayMode 只鎖定本回合的操作、數值與結算方式；世界規則與 Lore 已核定的修煉、宗門、家族、丹藥、符籙、陣法、法器或靈草等題材詞仍必須保留。不得憑空引入其他玩法的數值機制。",
      "不得透露或猜測任何預設回合總數、回合上限、內部故事弧階段、結局條件、門檻或判定機制。若 readerSafeCausalContract 提供 currentDirections，只能呈現當下方向，不得說明系統為何在此時允許收束。",
      "避免摘要、重述、例行訓練、空泛反應與工程說明。只輸出小說標題與小說正文；不得寫出核准規則、規則校準、本回合目標、關係張力、狀態更新、結算結果、下一輪可用資源、因果框架或任何系統術語。不要分節標題、行動結果、狀態面板、JSON、程式碼、規則解釋或下一組選項，這些會由介面在正文後另行顯示。",
      outputLanguageInstruction(input.language),
    ].join("\n"),
    context: toRpgReaderSafePromptPayload(input.context),
    selectedChoice: buildRpgReaderSafeChoicePayload(input.choice),
    readerSafeCausalContract: toRpgReaderSafePromptPayload(input.readerSafeCausalContract ?? {}),
    lockedResolution: toRpgReaderSafePromptPayload(input.resolution),
  });
}
