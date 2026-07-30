export type ObjectiveAcceptanceContract = {
  requestedItemCount: number | null;
  requiredDimensions: string[];
  strictRules: string[];
};

const CHINESE_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const DIMENSIONS: Array<{ id: string; terms: string[] }> = [
  { id: "風險", terms: ["風險", "失敗條件", "可能後果"] },
  { id: "代價", terms: ["代價", "成本", "犧牲"] },
  { id: "做法", terms: ["做法", "方法", "修法", "方案"] },
  { id: "證據", terms: ["證據", "依據", "引用"] },
  { id: "影響", terms: ["影響", "讀者效果", "後果"] },
  { id: "觸發條件", terms: ["觸發條件", "何時觸發"] },
  { id: "效果", terms: ["效果", "結果"] },
  { id: "限制", terms: ["限制", "邊界"] },
  { id: "例外", terms: ["例外", "特殊情況"] },
  { id: "衝突", terms: ["衝突", "阻力"] },
  { id: "人物選擇", terms: ["人物選擇", "角色選擇", "選擇"] },
  { id: "回接主線", terms: ["回接主線", "接回主線"] },
];

export function analyzeObjectiveAcceptance(
  objective: string,
): ObjectiveAcceptanceContract {
  const normalized = objective.replace(/\r\n?/gu, "\n").trim();
  const countMatch = normalized.match(
    /(?:提出|列出|產生|建立|提供|給出|生成)?\s*(\d{1,2}|[一二兩三四五六七八九十])\s*(?:個|條|份|種|項|組|段|章|集|方向|方案|候選)/u,
  );
  const requestedItemCount = countMatch
    ? /^\d+$/u.test(countMatch[1])
      ? Number(countMatch[1])
      : CHINESE_NUMBERS[countMatch[1]] ?? null
    : null;
  const requiredDimensions = DIMENSIONS
    .filter((dimension) => dimension.terms.some((term) => normalized.includes(term)))
    .map((dimension) => dimension.id);
  const strictRules = normalized
    .split(/[\n。；]/u)
    .map((item) => item.trim())
    .filter((item) => /(?:必須|不得|不可|不要|只能|至少|依序)/u.test(item))
    .slice(0, 12);
  return {
    requestedItemCount:
      requestedItemCount && requestedItemCount > 0 && requestedItemCount <= 30
        ? requestedItemCount
        : null,
    requiredDimensions,
    strictRules,
  };
}

export function evaluateObjectiveAcceptance(input: {
  objective: string;
  content: string;
}) {
  const contract = analyzeObjectiveAcceptance(input.objective);
  const content = input.content.trim();
  const warningCodes: string[] = [];
  const missingDimensions = contract.requiredDimensions.filter((dimension) => {
    const definition = DIMENSIONS.find((item) => item.id === dimension);
    return !definition?.terms.some((term) => content.includes(term));
  });
  for (const dimension of missingDimensions) {
    warningCodes.push(`OBJECTIVE_DIMENSION_MISSING:${dimension}`);
  }
  const itemMarkers = content.match(
    /(?:^|\n)\s*(?:[-*•]\s*)?(?:\d{1,2}|[一二兩三四五六七八九十]+)[.、)）:：]/gu,
  ) ?? [];
  const namedMarkers = content.match(
    /(?:方向|方案|規則|候選|分支)\s*(?:\d{1,2}|[一二兩三四五六七八九十])/gu,
  ) ?? [];
  const detectedItemCount = Math.max(itemMarkers.length, namedMarkers.length);
  const itemSections = content
    .split(
      /(?=^\s*(?:[-*•]\s*)?(?:\d{1,2}|[一二兩三四五六七八九十]+)[.、)）:：])/gmu,
    )
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    contract.requestedItemCount
    && detectedItemCount > 0
    && detectedItemCount < contract.requestedItemCount
  ) {
    warningCodes.push(
      `OBJECTIVE_ITEM_COUNT_MISSING:${detectedItemCount}/${contract.requestedItemCount}`,
    );
  }
  if (
    contract.requestedItemCount
    && detectedItemCount === 0
    && contract.requestedItemCount > 1
  ) {
    warningCodes.push(
      `OBJECTIVE_ITEM_COUNT_UNVERIFIED:0/${contract.requestedItemCount}`,
    );
  }
  const dimensionCoverage = Object.fromEntries(
    contract.requiredDimensions.map((dimension) => {
      const definition = DIMENSIONS.find((item) => item.id === dimension);
      const coveredItems = itemSections.filter((section) =>
        definition?.terms.some((term) => section.includes(term))).length;
      return [dimension, {
        coveredItems,
        totalItems: itemSections.length,
      }];
    }),
  );
  if (
    contract.requestedItemCount
    && contract.requestedItemCount > 1
    && itemSections.length > 1
  ) {
    for (const [dimension, coverage] of Object.entries(dimensionCoverage)) {
      const expected = Math.min(contract.requestedItemCount, itemSections.length);
      if (coverage.coveredItems < expected) {
        warningCodes.push(
          `OBJECTIVE_DIMENSION_INCOMPLETE:${dimension}:${coverage.coveredItems}/${expected}`,
        );
      }
    }
  }
  return {
    contract,
    detectedItemCount,
    missingDimensions,
    dimensionCoverage,
    warningCodes,
  };
}
