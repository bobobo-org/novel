export const BROWSER_EXTRACTIVE_MODEL = Object.freeze({
  schemaVersion: "novel-browser-extractive-model-v1",
  modelId: "novel-browser-extractive-v1",
  trainingObjective: "softmax_sentence_ranking",
  featureNames: [
    "bias",
    "earlyPosition",
    "normalizedLength",
    "eventDensity",
    "consequenceDensity",
    "dialogue",
    "lexicalDiversity",
    "hookDensity",
  ],
  weights: [
    0,
    0.90673393,
    2.56597707,
    4.85477673,
    1.94294101,
    0,
    -0.09935576,
    2.89673998,
  ],
  trainingSource: "operator-authored-synthetic-ground-truth",
  trainingExamples: 12,
  holdoutExamples: 4,
  sentenceCandidates: 48,
  labelPositionDiversity: 3,
  trainingTop1Accuracy: 1,
  holdoutTop1Accuracy: 1,
  syntheticDataOnly: true,
  rawUserContentIncluded: false,
  trainingDatasetDigest:
    "307097630eb7a19160f4c9faa64a7976467e1f53ba5e756d156fb8473c6290bb",
  modelDigest:
    "1bc3d5a334549555d44c451d1723e44735ac48424fe3595a08a86aed5e0609ba",
} as const);

const EVENT_TERMS = [
  "發現",
  "突然",
  "必須",
  "決定",
  "證明",
  "否決",
  "失蹤",
  "敵人",
  "災難",
  "求救",
  "推翻",
  "刪除",
  "坦白",
  "隱瞞",
  "選擇",
  "改口",
  "不存在",
  "未來",
  "禁區",
  "受傷",
  "替換",
  "錄音",
  "座標",
  "記憶",
] as const;

const CONSEQUENCE_TERMS = [
  "因此",
  "所以",
  "卻",
  "但",
  "然而",
  "必須",
  "決定",
  "只有",
] as const;

const HOOK_TERMS = [
  "忽然",
  "突然",
  "竟",
  "原來",
  "發現",
  "真正",
  "唯一",
  "未來",
  "失蹤",
  "刪除",
  "隱瞞",
  "坦白",
] as const;

function countTerms(sentence: string, terms: readonly string[]) {
  return terms.reduce(
    (count, term) => count + (sentence.includes(term) ? 1 : 0),
    0,
  );
}

function sentenceFeatures(sentence: string, index: number, total: number) {
  const characters = [...sentence].filter((character) => !/\s/u.test(character));
  return [
    1,
    1 - index / Math.max(total - 1, 1),
    Math.min(characters.length / 45, 1),
    Math.min(countTerms(sentence, EVENT_TERMS) / 3, 1),
    Math.min(countTerms(sentence, CONSEQUENCE_TERMS) / 2, 1),
    sentence.includes("「") || sentence.includes("」") ? 1 : 0,
    new Set(characters).size / Math.max(characters.length, 1),
    Math.min(countTerms(sentence, HOOK_TERMS) / 2, 1),
  ];
}

function scoreSentence(sentence: string, index: number, total: number) {
  return sentenceFeatures(sentence, index, total).reduce(
    (score, feature, featureIndex) =>
      score + feature * BROWSER_EXTRACTIVE_MODEL.weights[featureIndex],
    0,
  );
}

export function splitBrowserModelSentences(text: string) {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return [];
  const sentences = normalized
    .split(/(?<=[。！？!?])|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 320);
  return sentences.length ? sentences : [normalized];
}

function desiredSentenceCount(total: number) {
  if (total <= 5) return 1;
  if (total <= 18) return 2;
  if (total <= 48) return 3;
  if (total <= 100) return 4;
  if (total <= 180) return 5;
  return 6;
}

function sentenceShingles(sentence: string) {
  const normalized = sentence
    .replace(/[\s，。！？、；：「」『』（）()!?.,;:'"]/gu, "")
    .toLocaleLowerCase("zh-Hant");
  const shingles = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    shingles.add(normalized.slice(index, index + 2));
  }
  if (!shingles.size && normalized) shingles.add(normalized);
  return shingles;
}

function sentenceSimilarity(left: string, right: string) {
  const leftSet = sentenceShingles(left);
  const rightSet = sentenceShingles(right);
  if (!leftSet.size || !rightSet.size) return 0;
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }
  return intersection / Math.max(1, leftSet.size + rightSet.size - intersection);
}

function selectDiverseSentences(sentences: string[], desired: number) {
  const ranked = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreSentence(sentence, index, sentences.length),
    }));
  const selected: typeof ranked = [];
  const addIfDiverse = (candidate: (typeof ranked)[number]) => {
    if (selected.some((item) => item.index === candidate.index)) return;
    if (selected.some((item) =>
      sentenceSimilarity(item.sentence, candidate.sentence) >= 0.78)) return;
    selected.push(candidate);
  };

  const chunkSize = Math.ceil(sentences.length / desired);
  for (let chunk = 0; chunk < desired; chunk += 1) {
    const start = chunk * chunkSize;
    const chunkCandidates = ranked
      .slice(start, Math.min(sentences.length, start + chunkSize))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    for (const candidate of chunkCandidates) {
      const before = selected.length;
      addIfDiverse(candidate);
      if (selected.length > before) break;
    }
  }

  for (const candidate of [...ranked].sort(
    (left, right) => right.score - left.score || left.index - right.index,
  )) {
    if (selected.length >= desired) break;
    addIfDiverse(candidate);
  }
  return selected.sort((left, right) => left.index - right.index);
}

export function runPackagedBrowserExtractiveModel(text: string) {
  const sentences = splitBrowserModelSentences(text);
  if (!sentences.length) {
    throw Object.assign(new Error("瀏覽器模型需要可摘要的文字。"), {
      code: "BROWSER_AI_INPUT_REQUIRED",
      retryable: false,
    });
  }
  const selected = selectDiverseSentences(
    sentences,
    desiredSentenceCount(sentences.length),
  );
  const output = selected
    .map((item) => item.sentence)
    .join(selected.length > 2 ? "\n" : "");
  if (!output) {
    throw Object.assign(new Error("瀏覽器模型沒有產生摘要。"), {
      code: "BROWSER_AI_INVALID_RESPONSE",
      retryable: true,
    });
  }
  return {
    content: output,
    modelId: BROWSER_EXTRACTIVE_MODEL.modelId,
    modelDigest: BROWSER_EXTRACTIVE_MODEL.modelDigest,
    selectedSentenceCount: selected.length,
    candidateSentenceCount: sentences.length,
    coverage: selected.length
      ? {
        firstSentenceIndex: selected[0].index,
        lastSentenceIndex: selected[selected.length - 1].index,
      }
      : null,
    externalRequest: false as const,
    dataLeftDevice: false as const,
  };
}
