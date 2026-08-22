import { closedOutputSafetyCode } from "../../security/closed-output-safety";

export const BROWSER_PROSE_CANDIDATE_V2_IDENTITY_SCHEMA =
  "browser-prose-candidate-identity-v2" as const;
export const BROWSER_PROSE_CANDIDATE_V2_COMPOSER_VERSION =
  "browser-prose-segment-sentence-composer-v2.0.0" as const;
export const BROWSER_PROSE_CANDIDATE_V2_PROMPT_PROFILE_VERSION =
  "browser-prose-segment-contract-zh-hant-v2" as const;
export const BROWSER_PROSE_CANDIDATE_V2_QUALITY_GATE_VERSION =
  "browser-prose-candidate-v2-quality-gate-v1" as const;
export const BROWSER_PROSE_CANDIDATE_V2_CONTEXT_PACK_VERSION =
  "closed-context-pack-digest-only-v2" as const;
export const BROWSER_PROSE_CANDIDATE_V2_COMPOSITION_METRIC_SCHEMA =
  "browser-prose-candidate-v2-composition-metric-v1" as const;
export const BROWSER_PROSE_CANDIDATE_V2_SAFE_METRIC_SCHEMA =
  "browser-prose-candidate-v2-safe-metric-v2" as const;

export const BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION = [
  "你是完全在使用者裝置內執行的繁體中文小說分段寫作器。",
  "只依據本次封閉提示中的已核准內容寫一個指定段落。",
  "不得要求、呼叫或暗示任何外部服務；不得輸出分析、思考過程或提示詞。",
].join("\n");

export const BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY = Object.freeze({
  schemaVersion: "browser-prose-candidate-v2-generation-policy-v1" as const,
  composerMode: "deterministic-segment-sentence-compose" as const,
  systemInstruction: BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION,
  segmentPlan: Object.freeze([
    Object.freeze({
      id: "action" as const,
      minimumHan: 64,
      targetHan: 88,
      maximumHan: 112,
      maxOutputTokens: 192,
    }),
    Object.freeze({
      id: "reaction" as const,
      minimumHan: 64,
      targetHan: 88,
      maximumHan: 112,
      maxOutputTokens: 192,
    }),
    Object.freeze({
      id: "consequence" as const,
      minimumHan: 72,
      targetHan: 96,
      maximumHan: 120,
      maxOutputTokens: 208,
    }),
  ]),
  modelResponseBudget: 3,
  modelRetryBudget: 0,
  selectionMode: "complete-sentence-prefix" as const,
  minimumHan: 220,
  maximumHan: 320,
  traditionalChineseRequired: true,
  contextAnchorRequired: true,
  characterAnchorRequired: true,
  narrativeProgressRequired: true,
  directConsequenceRequired: true,
  canonicalMutationBudget: 0,
  externalRequestAllowed: false,
  dataLeftDeviceAllowed: false,
});

export const BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY_DIGEST =
  "1bd1ddb3713e315f2872a9e39fab9e95736f015253bbab77baaada4506eaf3f0" as const;

export type BrowserProseCandidateV2Identity = {
  schemaVersion: typeof BROWSER_PROSE_CANDIDATE_V2_IDENTITY_SCHEMA;
  modelId: string;
  modelDigest: string;
  modelRevision: string;
  modelLibDigest: string;
  composerVersion: typeof BROWSER_PROSE_CANDIDATE_V2_COMPOSER_VERSION;
  promptProfileVersion: typeof BROWSER_PROSE_CANDIDATE_V2_PROMPT_PROFILE_VERSION;
  qualityGateVersion: typeof BROWSER_PROSE_CANDIDATE_V2_QUALITY_GATE_VERSION;
  contextPackVersion: typeof BROWSER_PROSE_CANDIDATE_V2_CONTEXT_PACK_VERSION;
  generationPolicyDigest: string;
  candidateIdentityDigest: string;
};

const CANDIDATE_V2_IDENTITY_BODY = Object.freeze({
  schemaVersion: BROWSER_PROSE_CANDIDATE_V2_IDENTITY_SCHEMA,
  modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  modelDigest: "664d1a6498af539e1919c34bf04101ff9d3ac39eaa0f1f1c3ed1b46c7d87b168",
  modelRevision: "9bd564b064631febf14deadcac492efb761d60c3",
  modelLibDigest: "0fceb50bbaf47efdc31fce96b72c115dcb7f5221c85abe6a9fc02dda9d1d6fc3",
  composerVersion: BROWSER_PROSE_CANDIDATE_V2_COMPOSER_VERSION,
  promptProfileVersion: BROWSER_PROSE_CANDIDATE_V2_PROMPT_PROFILE_VERSION,
  qualityGateVersion: BROWSER_PROSE_CANDIDATE_V2_QUALITY_GATE_VERSION,
  contextPackVersion: BROWSER_PROSE_CANDIDATE_V2_CONTEXT_PACK_VERSION,
  generationPolicyDigest: BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY_DIGEST,
});

export const BROWSER_PROSE_CANDIDATE_V2_IDENTITY = Object.freeze({
  ...CANDIDATE_V2_IDENTITY_BODY,
  candidateIdentityDigest: "613a38d1d9201eed8acdb4851b4a7674e5e1baacdc5faf84d405352d6293af41",
}) satisfies BrowserProseCandidateV2Identity;

export const BROWSER_PROSE_CANDIDATE_V2_MATERIAL_DIFFERENCE = Object.freeze({
  blockedCampaign: "P2.4B_RC6_4_STANDARD_ONLY_FRESH",
  blockedDisposition: "NOT_A_RELEASE_PASS",
  blockedComposerVersion: "browser-prose-composer-v1",
  candidateComposerVersion: BROWSER_PROSE_CANDIDATE_V2_COMPOSER_VERSION,
  architectureBefore: "monolithic-full-prose-generation",
  architectureAfter: "deterministic-three-segment-complete-sentence-compose",
  materialDimensions: Object.freeze([
    "composerArchitecture",
    "composerVersion",
    "promptProfileVersion",
    "contextPackVersion",
    "generationPolicyDigest",
  ]),
  parameterOnlyChange: false,
});

export const RC6_4_BLOCKED_CANDIDATE_SAFE_DIGESTS = Object.freeze([
  "5dad4b92027be971309636ef52f3f00c76409c82baece122fe950168fd26bd85",
  "f50f9153fca22f7965c68a11a61a101b757072b5d3cb1b7f29d149f8b7c676c8",
  "a65a294554e9e62fdd1ff382d170863be02169c8",
]);

type JsonValue = null | boolean | number | string | readonly JsonValue[] | {
  readonly [key: string]: JsonValue;
};

export function stableBrowserProseCandidateV2Json(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableBrowserProseCandidateV2Json(entry)).join(",")}]`;
  }
  const objectValue = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(objectValue).sort().map((key) => (
    `${JSON.stringify(key)}:${stableBrowserProseCandidateV2Json(objectValue[key])}`
  )).join(",")}}`;
}

export async function browserProseCandidateV2Sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_CRYPTO_UNAVAILABLE");
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function browserProseCandidateV2IdentityDigest(
  identity: Omit<BrowserProseCandidateV2Identity, "candidateIdentityDigest">,
): Promise<string> {
  return browserProseCandidateV2Sha256(stableBrowserProseCandidateV2Json(identity));
}

export async function assertBrowserProseCandidateV2Identity(): Promise<void> {
  const policyDigest = await browserProseCandidateV2Sha256(
    stableBrowserProseCandidateV2Json(BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY),
  );
  if (policyDigest !== BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY_DIGEST) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_POLICY_DIGEST_MISMATCH");
  }
  const identityDigest = await browserProseCandidateV2IdentityDigest(
    CANDIDATE_V2_IDENTITY_BODY,
  );
  if (identityDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_IDENTITY_DIGEST_MISMATCH");
  }
  if (RC6_4_BLOCKED_CANDIDATE_SAFE_DIGESTS.some((digest) => digest === identityDigest)) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_REUSES_BLOCKED_DIGEST");
  }
}

export type BrowserProseCandidateV2Genre =
  | "modern"
  | "xianxia"
  | "mystery"
  | "emotion"
  | "adventure";
export type BrowserProseCandidateV2Partition =
  | "development"
  | "holdout"
  | "product";
export type BrowserProseCandidateV2ExecutionMode =
  | "cold"
  | "warm"
  | "cancel-retry"
  | "product";

export type BrowserProseCandidateV2SafeFixture = {
  schemaVersion: "browser-prose-candidate-v2-safe-fixture-v1";
  fixtureId: string;
  partition: BrowserProseCandidateV2Partition;
  genre: BrowserProseCandidateV2Genre;
  storyBibleDigest: string;
  currentChapterDigest: string;
  characterAnchorDigest: string;
  worldRulesDigest: string;
  nextActionGoalDigest: string;
  tuningAllowed: boolean;
  rawContextStored: false;
};

const FIXTURE_GENRES = Object.freeze([
  "modern",
  "xianxia",
  "mystery",
  "emotion",
  "adventure",
] as const);

export async function createBrowserProseCandidateV2SafeFixtures(): Promise<{
  development: BrowserProseCandidateV2SafeFixture[];
  holdout: BrowserProseCandidateV2SafeFixture[];
}> {
  const createPartition = async (
    partition: BrowserProseCandidateV2Partition,
  ): Promise<BrowserProseCandidateV2SafeFixture[]> => Promise.all(
    FIXTURE_GENRES.map(async (genre, index) => {
      const fixtureId = `rc65-${partition}-${String(index + 1).padStart(2, "0")}`;
      const digest = (field: string) => browserProseCandidateV2Sha256(
        `p2.4b-rc6.5-safe-fixture-v1\n${partition}\n${genre}\n${fixtureId}\n${field}`,
      );
      return {
        schemaVersion: "browser-prose-candidate-v2-safe-fixture-v1",
        fixtureId,
        partition,
        genre,
        storyBibleDigest: await digest("story-bible"),
        currentChapterDigest: await digest("current-chapter"),
        characterAnchorDigest: await digest("character-anchor"),
        worldRulesDigest: await digest("world-rules"),
        nextActionGoalDigest: await digest("next-action-goal"),
        tuningAllowed: partition === "development",
        rawContextStored: false,
      };
    }),
  );
  return {
    development: await createPartition("development"),
    holdout: await createPartition("holdout"),
  };
}

const SHA256_HEX = /^[a-f0-9]{64}$/u;

export function assertBrowserProseCandidateV2FixtureIsolation(input: {
  development: BrowserProseCandidateV2SafeFixture[];
  holdout: BrowserProseCandidateV2SafeFixture[];
}): void {
  if (input.development.length !== 5 || input.holdout.length !== 5) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_FIXTURE_COUNT_INVALID");
  }
  const expectedGenres = [...FIXTURE_GENRES].sort().join("|");
  for (const [partition, rows] of Object.entries(input) as Array<[
    BrowserProseCandidateV2Partition,
    BrowserProseCandidateV2SafeFixture[],
  ]>) {
    if (rows.map((row) => row.genre).sort().join("|") !== expectedGenres) {
      throw new Error("BROWSER_PROSE_CANDIDATE_V2_GENRE_MATRIX_INVALID");
    }
    for (const row of rows) {
      if (row.partition !== partition || row.rawContextStored !== false) {
        throw new Error("BROWSER_PROSE_CANDIDATE_V2_PARTITION_INVALID");
      }
      if (row.tuningAllowed !== (partition === "development")) {
        throw new Error("BROWSER_PROSE_CANDIDATE_V2_HOLDOUT_TUNING_BOUNDARY_BROKEN");
      }
      for (const digest of [
        row.storyBibleDigest,
        row.currentChapterDigest,
        row.characterAnchorDigest,
        row.worldRulesDigest,
        row.nextActionGoalDigest,
      ]) {
        if (!SHA256_HEX.test(digest)) {
          throw new Error("BROWSER_PROSE_CANDIDATE_V2_FIXTURE_DIGEST_INVALID");
        }
      }
    }
  }
  const developmentDigests = new Set(input.development.flatMap((row) => [
    row.storyBibleDigest,
    row.currentChapterDigest,
    row.characterAnchorDigest,
    row.worldRulesDigest,
    row.nextActionGoalDigest,
  ]));
  const overlaps = input.holdout.flatMap((row) => [
    row.storyBibleDigest,
    row.currentChapterDigest,
    row.characterAnchorDigest,
    row.worldRulesDigest,
    row.nextActionGoalDigest,
  ]).filter((digest) => developmentDigests.has(digest));
  if (overlaps.length) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_PARTITION_DIGEST_OVERLAP");
  }
}

export type BrowserProseCandidateV2Context = {
  storyBible: string;
  currentChapter: string;
  characterAnchors: string[];
  contextAnchors: string[];
  worldRules: string[];
  nextActionGoal: string;
  genre: BrowserProseCandidateV2Genre;
};

export type BrowserProseCandidateV2SegmentId =
  (typeof BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.segmentPlan)[number]["id"];

export type BrowserProseCandidateV2SegmentRequest = {
  candidateIdentityDigest: string;
  segmentId: BrowserProseCandidateV2SegmentId;
  ordinal: 1 | 2 | 3;
  maxOutputTokens: number;
  prompt: string;
  temperature: 0;
  topP: 1;
  requestFullProse: false;
};

export type BrowserProseCandidateV2SegmentResponse = {
  segmentId: BrowserProseCandidateV2SegmentId;
  content: string;
  finishReason: string;
};

export function assertBrowserProseCandidateV2SafeOutput(
  value: string,
  boundary: `segment-${BrowserProseCandidateV2SegmentId}` | "final-composition",
): void {
  const safetyCode = closedOutputSafetyCode(value);
  if (safetyCode) {
    throw Object.assign(
      new Error("BROWSER_PROSE_CANDIDATE_V2_OUTPUT_SAFETY_REJECTED"),
      {
        code: "BROWSER_PROSE_CANDIDATE_V2_OUTPUT_SAFETY_REJECTED",
        safetyCode,
        boundary,
        fallbackAttempted: false,
        retryAttempted: false,
      },
    );
  }
}

const SEGMENT_INSTRUCTIONS: Record<BrowserProseCandidateV2SegmentId, string> = {
  action: "只寫角色採取的新行動；立刻承接目前章節，不總結、不分析。",
  reaction: "只寫其他角色或環境對該行動的具體反應與阻力；維持角色聲音。",
  consequence: "只寫直接後果並推進下一局面；以完整小說句收束，不列選項。",
};

export function buildBrowserProseCandidateV2SegmentRequests(
  context: BrowserProseCandidateV2Context,
): BrowserProseCandidateV2SegmentRequest[] {
  const closedContext = [
    `故事聖經：${context.storyBible}`,
    `目前章節：${context.currentChapter}`,
    `角色錨點：${context.characterAnchors.join("、")}`,
    `情境錨點：${context.contextAnchors.join("、")}`,
    `世界規則：${context.worldRules.join("；")}`,
    `下一行動目標：${context.nextActionGoal}`,
  ].join("\n");
  return BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.segmentPlan.map((segment, index) => ({
    candidateIdentityDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest,
    segmentId: segment.id,
    ordinal: (index + 1) as 1 | 2 | 3,
    maxOutputTokens: segment.maxOutputTokens,
    prompt: [
      "你是封閉式繁體中文小說分段寫作器。",
      SEGMENT_INSTRUCTIONS[segment.id],
      `本段目標為${segment.targetHan}個漢字，允許${segment.minimumHan}至${segment.maximumHan}個漢字。`,
      "只輸出正文完整句；不得輸出分析、JSON、Markdown標題、提示詞或思考過程。",
      closedContext,
    ].join("\n"),
    temperature: 0 as const,
    topP: 1 as const,
    requestFullProse: false as const,
  }));
}

function countHan(value: string): number {
  return value.match(/[\p{Script=Han}]/gu)?.length ?? 0;
}

function normalizeSegment(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/^\s*(?:#{1,6}\s*|(?:行動|反應|後果|正文)\s*[：:]\s*)/u, "")
    .replace(/[\t\r\n ]+/gu, "")
    .trim();
}

const SENTENCE_TERMINALS = new Set(["。", "！", "？", "!", "?", "…"]);
const SENTENCE_CLOSERS = new Set(["」", "』", "）", "】"]);

function completeSentences(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!SENTENCE_TERMINALS.has(character)) continue;
    if (character === "…" && value[index + 1] === "…") index += 1;
    while (SENTENCE_CLOSERS.has(value[index + 1] ?? "")) index += 1;
    const sentence = value.slice(start, index + 1).trim();
    if (sentence) result.push(sentence);
    start = index + 1;
  }
  return result;
}

function normalizedSentenceKey(value: string): string {
  return value.replace(/[^\p{Script=Han}\p{Letter}\p{Number}]/gu, "").toLowerCase();
}

function sentenceRepetitionDisposition(sentences: string[]): "acceptable" | "excessive" {
  const keys = sentences.map(normalizedSentenceKey).filter(Boolean);
  if (new Set(keys).size !== keys.length) return "excessive";
  const grams = new Map<string, number>();
  for (const key of keys) {
    for (let index = 0; index <= key.length - 8; index += 4) {
      const gram = key.slice(index, index + 8);
      grams.set(gram, (grams.get(gram) ?? 0) + 1);
    }
  }
  const total = [...grams.values()].reduce((sum, count) => sum + count, 0);
  const repeated = [...grams.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  return total > 0 && repeated / total > 0.24 ? "excessive" : "acceptable";
}

function balancePairs(value: string): boolean {
  const pairs = [["「", "」"], ["『", "』"], ["（", "）"], ["【", "】"]] as const;
  return pairs.every(([open, close]) => (
    value.split(open).length - 1 === value.split(close).length - 1
  ));
}

function currentChapterReuseRatio(content: string, currentChapter: string): number {
  const source = (currentChapter.match(/[\p{Script=Han}]/gu) ?? []).join("");
  const candidate = (content.match(/[\p{Script=Han}]/gu) ?? []).join("");
  if (source.length < 3 || candidate.length < 3) return 0;
  const sourceGrams = new Set<string>();
  for (let index = 0; index <= source.length - 3; index += 1) {
    sourceGrams.add(source.slice(index, index + 3));
  }
  let reused = 0;
  const total = candidate.length - 2;
  for (let index = 0; index <= candidate.length - 3; index += 1) {
    if (sourceGrams.has(candidate.slice(index, index + 3))) reused += 1;
  }
  return total > 0 ? reused / total : 0;
}

const ACTION_SIGNAL = /[走跑推拉握抬轉退進開啟關閉躍衝拔刺擋追躲取放遞敲踏掀攔救查問答喊]/u;
const REACTION_SIGNAL = /(?:回應|反應|察覺|發現|指出|迫使|震響|擋|躲|退|驚|怒|喊|望|看)/u;
const CONSEQUENCE_SIGNAL = /(?:因此|於是|隨即|結果|迫使|使得|終於|卻|便|從而|當場)/u;

type SentenceSelection = {
  content: string;
  sentences: string[];
  counts: [number, number, number];
  han: number;
  penalty: number;
};

function selectDeterministicSentencePrefixes(
  sentencesBySegment: [string[], string[], string[]],
): SentenceSelection | null {
  const plan = BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.segmentPlan;
  const candidates: SentenceSelection[] = [];
  for (let first = 1; first <= Math.min(8, sentencesBySegment[0].length); first += 1) {
    for (let second = 1; second <= Math.min(8, sentencesBySegment[1].length); second += 1) {
      for (let third = 1; third <= Math.min(8, sentencesBySegment[2].length); third += 1) {
        const selectedBySegment = [
          sentencesBySegment[0].slice(0, first),
          sentencesBySegment[1].slice(0, second),
          sentencesBySegment[2].slice(0, third),
        ] as const;
        const sentences = selectedBySegment.flat();
        const content = sentences.join("");
        const han = countHan(content);
        if (
          han < BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.minimumHan
          || han > BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.maximumHan
        ) continue;
        const segmentHan = selectedBySegment.map((rows) => countHan(rows.join("")));
        if (segmentHan.some((current, index) => (
          current < plan[index].minimumHan || current > plan[index].maximumHan
        ))) continue;
        const selectedSegmentText = selectedBySegment.map((rows) => rows.join(""));
        if (
          !ACTION_SIGNAL.test(selectedSegmentText[0])
          || !REACTION_SIGNAL.test(selectedSegmentText[1])
          || !CONSEQUENCE_SIGNAL.test(selectedSegmentText[2])
        ) continue;
        const balancePenalty = segmentHan.reduce((sum, current, index) => (
          sum + Math.abs(current - plan[index].targetHan)
        ), 0);
        const outputPenalty = Math.abs(han - 264);
        candidates.push({
          content,
          sentences,
          counts: [first, second, third],
          han,
          penalty: balancePenalty * 2 + outputPenalty,
        });
      }
    }
  }
  return candidates.sort((left, right) => (
    left.penalty - right.penalty
    || left.sentences.length - right.sentences.length
    || left.content.localeCompare(right.content, "zh-Hant")
  ))[0] ?? null;
}

const SIMPLIFIED_MARKERS = /[这发会还让从与个们说对开关无过达应见体么]/u;
const META_OUTPUT = /(?:作為(?:一個)?AI|以下是|我將|分析如下|思考過程|提示詞|無法協助)/u;

export type BrowserProseCandidateV2QualityResult = {
  pass: boolean;
  qualityScore: number;
  qualityReasonCodes: string[];
  observedHanCharacters: number;
  selectedHanCharacters: number;
  sentenceBoundaryCount: number;
  selectedBoundaryIndex: number;
  contextAnchorVerified: boolean;
  characterAnchorVerified: boolean;
  narrativeProgressVerified: boolean;
  repetitionDisposition: "acceptable" | "excessive";
};

function evaluateCandidateV2Quality(input: {
  context: BrowserProseCandidateV2Context;
  selection: SentenceSelection;
  observedHanCharacters: number;
}): BrowserProseCandidateV2QualityResult {
  const { content, sentences, han } = input.selection;
  const reasons: string[] = [];
  if (han < 220) reasons.push("minimum_han_not_met");
  if (han > 320) reasons.push("maximum_han_exceeded");
  if (!/[。！？…」』）】]$/u.test(content)) reasons.push("incomplete_sentence_ending");
  if (!balancePairs(content)) reasons.push("unbalanced_punctuation");
  if (SIMPLIFIED_MARKERS.test(content)) reasons.push("simplified_chinese_detected");
  if (META_OUTPUT.test(content)) reasons.push("meta_output_detected");
  if (/^\s*(?:\{|\[|#{1,6}\s)/u.test(content)) reasons.push("structured_or_markdown_output");

  const contextAnchorVerified = input.context.contextAnchors.some((anchor) => (
    anchor.length >= 2 && content.includes(anchor)
  ));
  if (!contextAnchorVerified) reasons.push("context_anchor_missing");
  const firstCharacterAnchor = input.context.characterAnchors.find((anchor) => (
    anchor.length >= 2 && content.includes(anchor)
  ));
  const characterAnchorVerified = Boolean(firstCharacterAnchor)
    && content.indexOf(firstCharacterAnchor!) <= Math.max(80, Math.floor(content.length * 0.35));
  if (!characterAnchorVerified) reasons.push("character_anchor_missing");

  const reuseRatio = currentChapterReuseRatio(content, input.context.currentChapter);
  const narrativeProgressVerified = ACTION_SIGNAL.test(content)
    && CONSEQUENCE_SIGNAL.test(content)
    && reuseRatio < 0.68;
  if (!narrativeProgressVerified) reasons.push("narrative_progress_missing");
  const repetitionDisposition = sentenceRepetitionDisposition(sentences);
  if (repetitionDisposition === "excessive") reasons.push("excessive_repetition");
  const qualityScore = Math.max(0, Number((1 - reasons.length / 10).toFixed(3)));
  return {
    pass: reasons.length === 0,
    qualityScore,
    qualityReasonCodes: reasons,
    observedHanCharacters: input.observedHanCharacters,
    selectedHanCharacters: han,
    sentenceBoundaryCount: sentences.length,
    selectedBoundaryIndex: sentences.length - 1,
    contextAnchorVerified,
    characterAnchorVerified,
    narrativeProgressVerified,
    repetitionDisposition,
  };
}

export type BrowserProseCandidateV2CompositionMetric = {
  schemaVersion: typeof BROWSER_PROSE_CANDIDATE_V2_COMPOSITION_METRIC_SCHEMA;
  candidateIdentityDigest: string;
  modelId: string;
  modelDigest: string;
  composerMode: typeof BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.composerMode;
  fixtureId: string;
  partition: BrowserProseCandidateV2Partition;
  executionMode: BrowserProseCandidateV2ExecutionMode;
  modelResponseCount: number;
  finishReasons: string[];
  observedHanCharacters: number;
  selectedHanCharacters: number;
  sentenceBoundaryCount: number;
  selectedBoundaryIndex: number;
  selectedPrefixDigest: string;
  qualityScore: number;
  qualityReasonCodes: string[];
  contextAnchorVerified: boolean;
  characterAnchorVerified: boolean;
  narrativeProgressVerified: boolean;
  repetitionDisposition: "acceptable" | "excessive";
  modelResponseBudgetExceeded: false;
  pass: boolean;
};

export type BrowserProseCandidateV2SafeMetric = Omit<
  BrowserProseCandidateV2CompositionMetric,
  "schemaVersion"
> & {
  schemaVersion: typeof BROWSER_PROSE_CANDIDATE_V2_SAFE_METRIC_SCHEMA;
  runtimeReceiptDigest: string;
  finalAttestationDigest: string;
  actualExecutor: "browser-ai";
  underlyingExecutor: "webllm-worker";
  candidateOnly: true;
  externalRequest: false;
  dataLeftDevice: false;
  externalNetworkRequestCount: 0;
  dataEgressEventCount: 0;
  networkObservationComplete: true;
  canonicalMutationCount: 0;
  formalApprovalMutationCount: 0;
  profileDisposed: true;
  edgeResidueCount: 0;
  workerResidueCount: 0;
  rawOutputStored: false;
  rawPromptStored: false;
  rawStoryBibleStored: false;
  rawChapterStored: false;
  chainOfThoughtStored: false;
  cancelledSegment: BrowserProseCandidateV2SegmentId | null;
  cancelledPartialPersisted: false;
  retryReusedCancelledOutput: false;
  syntheticObservedReceipt: boolean;
  productionPassClaimed: boolean;
};

export type BrowserProseCandidateV2ComposeResult = {
  content: string;
  candidateIdentity: typeof BROWSER_PROSE_CANDIDATE_V2_IDENTITY;
  compositionMetric: BrowserProseCandidateV2CompositionMetric;
};

export async function composeBrowserProseCandidateV2(input: {
  fixtureId: string;
  partition: BrowserProseCandidateV2Partition;
  executionMode: BrowserProseCandidateV2ExecutionMode;
  context: BrowserProseCandidateV2Context;
  responses: BrowserProseCandidateV2SegmentResponse[];
}): Promise<BrowserProseCandidateV2ComposeResult> {
  await assertBrowserProseCandidateV2Identity();
  const expectedIds = BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.segmentPlan
    .map((segment) => segment.id);
  if (
    input.responses.length !== expectedIds.length
    || input.responses.some((response, index) => response.segmentId !== expectedIds[index])
  ) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_SEGMENT_SEQUENCE_INVALID");
  }
  if (input.responses.some((response) => response.finishReason !== "stop")) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_FINISH_REASON_INVALID");
  }
  for (const response of input.responses) {
    assertBrowserProseCandidateV2SafeOutput(
      response.content,
      `segment-${response.segmentId}`,
    );
  }
  const normalized = input.responses.map((response) => normalizeSegment(response.content));
  const sentencesBySegment = normalized.map(completeSentences) as [string[], string[], string[]];
  if (sentencesBySegment.some((sentences) => sentences.length === 0)) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_COMPLETE_SEGMENT_MISSING");
  }
  const selection = selectDeterministicSentencePrefixes(sentencesBySegment);
  if (!selection) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_LENGTH_WINDOW_UNSATISFIED");
  }
  assertBrowserProseCandidateV2SafeOutput(
    selection.content,
    "final-composition",
  );
  const observedHanCharacters = normalized.reduce((sum, value) => sum + countHan(value), 0);
  const quality = evaluateCandidateV2Quality({
    context: input.context,
    selection,
    observedHanCharacters,
  });
  const selectedPrefixDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-selected-prefix-v1\n${selection.content}`,
  );
  return {
    content: selection.content,
    candidateIdentity: BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
    compositionMetric: {
      schemaVersion: BROWSER_PROSE_CANDIDATE_V2_COMPOSITION_METRIC_SCHEMA,
      candidateIdentityDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest,
      modelId: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId,
      modelDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest,
      composerMode: BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.composerMode,
      fixtureId: input.fixtureId,
      partition: input.partition,
      executionMode: input.executionMode,
      modelResponseCount: input.responses.length,
      finishReasons: input.responses.map((response) => response.finishReason),
      ...quality,
      selectedPrefixDigest,
      modelResponseBudgetExceeded: false,
      pass: quality.pass,
    },
  };
}

const SAFE_METRIC_FORBIDDEN_KEYS = new Set([
  "content",
  "output",
  "rawOutput",
  "prompt",
  "rawPrompt",
  "storyBible",
  "currentChapter",
  "chapter",
  "chainOfThought",
  "reasoning",
]);

const COMPOSITION_METRIC_OBSERVED_KEYS = new Set([
  "actualExecutor",
  "underlyingExecutor",
  "candidateOnly",
  "externalRequest",
  "dataLeftDevice",
  "externalNetworkRequestCount",
  "dataEgressEventCount",
  "networkObservationComplete",
  "canonicalMutationCount",
  "formalApprovalMutationCount",
  "profileDisposed",
  "edgeResidueCount",
  "workerResidueCount",
  "rawOutputStored",
  "rawPromptStored",
  "rawStoryBibleStored",
  "rawChapterStored",
  "chainOfThoughtStored",
  "cancelledSegment",
  "cancelledPartialPersisted",
  "retryReusedCancelledOutput",
  "syntheticObservedReceipt",
  "productionPassClaimed",
]);

export function assertBrowserProseCandidateV2CompositionMetric(
  metric: BrowserProseCandidateV2CompositionMetric,
): void {
  if (Object.keys(metric).some((key) => (
    SAFE_METRIC_FORBIDDEN_KEYS.has(key) || COMPOSITION_METRIC_OBSERVED_KEYS.has(key)
  ))) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_COMPOSITION_METRIC_OBSERVED_KEY_FORBIDDEN");
  }
  const qualificationBoundary = ["development", "holdout"].includes(metric.partition)
    && ["cold", "warm", "cancel-retry"].includes(metric.executionMode);
  const productBoundary = metric.partition === "product"
    && metric.executionMode === "product";
  if (
    metric.schemaVersion !== BROWSER_PROSE_CANDIDATE_V2_COMPOSITION_METRIC_SCHEMA
    || metric.candidateIdentityDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest
    || metric.modelId !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId
    || metric.modelDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest
    || metric.composerMode !== BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.composerMode
    || metric.modelResponseCount !== 3
    || metric.finishReasons.length !== 3
    || metric.finishReasons.some((reason) => reason !== "stop")
    || !metric.fixtureId.trim()
    || (!qualificationBoundary && !productBoundary)
    || metric.modelResponseBudgetExceeded !== false
    || metric.qualityScore !== 1
    || metric.observedHanCharacters < metric.selectedHanCharacters
    || metric.selectedHanCharacters < 220
    || metric.selectedHanCharacters > 320
    || metric.sentenceBoundaryCount < 3
    || metric.selectedBoundaryIndex !== metric.sentenceBoundaryCount - 1
    || !SHA256_HEX.test(metric.selectedPrefixDigest)
    || !metric.contextAnchorVerified
    || !metric.characterAnchorVerified
    || !metric.narrativeProgressVerified
    || metric.repetitionDisposition !== "acceptable"
    || !metric.pass
    || metric.qualityReasonCodes.length !== 0
  ) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_COMPOSITION_METRIC_REJECTED");
  }
}

export function assertBrowserProseCandidateV2SafeMetric(
  metric: BrowserProseCandidateV2SafeMetric,
  options: { allowSyntheticObservedReceipt?: boolean } = {},
): void {
  if (Object.keys(metric).some((key) => SAFE_METRIC_FORBIDDEN_KEYS.has(key))) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_RAW_EVIDENCE_KEY_FORBIDDEN");
  }
  if (
    metric.schemaVersion !== BROWSER_PROSE_CANDIDATE_V2_SAFE_METRIC_SCHEMA
    || metric.candidateIdentityDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest
    || metric.modelId !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId
    || metric.modelDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest
    || metric.composerMode !== BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.composerMode
    || metric.actualExecutor !== "browser-ai"
    || metric.underlyingExecutor !== "webllm-worker"
    || metric.candidateOnly !== true
    || metric.modelResponseCount !== 3
    || metric.finishReasons.length !== 3
    || metric.finishReasons.some((reason) => reason !== "stop")
    || !metric.fixtureId.trim()
    || !["development", "holdout"].includes(metric.partition)
    || !["cold", "warm", "cancel-retry"].includes(metric.executionMode)
    || metric.modelResponseBudgetExceeded !== false
    || metric.qualityScore !== 1
    || metric.observedHanCharacters < metric.selectedHanCharacters
    || metric.selectedHanCharacters < 220
    || metric.selectedHanCharacters > 320
    || metric.sentenceBoundaryCount < 3
    || metric.selectedBoundaryIndex !== metric.sentenceBoundaryCount - 1
    || !SHA256_HEX.test(metric.selectedPrefixDigest)
    || !SHA256_HEX.test(metric.runtimeReceiptDigest)
    || !SHA256_HEX.test(metric.finalAttestationDigest)
    || !metric.contextAnchorVerified
    || !metric.characterAnchorVerified
    || !metric.narrativeProgressVerified
    || metric.repetitionDisposition !== "acceptable"
    || metric.externalRequest !== false
    || metric.dataLeftDevice !== false
    || metric.externalNetworkRequestCount !== 0
    || metric.dataEgressEventCount !== 0
    || metric.networkObservationComplete !== true
    || metric.canonicalMutationCount !== 0
    || metric.formalApprovalMutationCount !== 0
    || metric.profileDisposed !== true
    || metric.edgeResidueCount !== 0
    || metric.workerResidueCount !== 0
    || metric.rawOutputStored !== false
    || metric.rawPromptStored !== false
    || metric.rawStoryBibleStored !== false
    || metric.rawChapterStored !== false
    || metric.chainOfThoughtStored !== false
    || metric.cancelledPartialPersisted !== false
    || metric.retryReusedCancelledOutput !== false
    || (metric.cancelledSegment !== null
      && !["action", "reaction", "consequence"].includes(metric.cancelledSegment))
    || (metric.executionMode === "cancel-retry") !== (metric.cancelledSegment !== null)
    || metric.productionPassClaimed === metric.syntheticObservedReceipt
    || (metric.syntheticObservedReceipt && options.allowSyntheticObservedReceipt !== true)
    || !metric.pass
    || metric.qualityReasonCodes.length !== 0
  ) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_SAFE_METRIC_REJECTED");
  }
}

export type BrowserProseCandidateV2Qualification = {
  development: BrowserProseCandidateV2SafeMetric[];
  holdout: BrowserProseCandidateV2SafeMetric[];
  warm: BrowserProseCandidateV2SafeMetric[];
  cancelRetry: BrowserProseCandidateV2SafeMetric[];
};

export function assertBrowserProseCandidateV2Qualification(
  input: BrowserProseCandidateV2Qualification,
  options: { allowSyntheticObservedReceipt?: boolean } = {},
): void {
  const phases = [
    ["development", input.development, 5, "development", "cold"],
    ["holdout", input.holdout, 5, "holdout", "cold"],
    ["warm", input.warm, 5, "holdout", "warm"],
    ["cancelRetry", input.cancelRetry, 3, "holdout", "cancel-retry"],
  ] as const;
  for (const [name, rows, requiredCount, partition, executionMode] of phases) {
    if (rows.length !== requiredCount) {
      throw new Error(`BROWSER_PROSE_CANDIDATE_V2_${name.toUpperCase()}_COUNT_INVALID`);
    }
    for (const row of rows) {
      if (row.partition !== partition || row.executionMode !== executionMode) {
        throw new Error(`BROWSER_PROSE_CANDIDATE_V2_${name.toUpperCase()}_BOUNDARY_INVALID`);
      }
      assertBrowserProseCandidateV2SafeMetric(row, options);
    }
  }
  const developmentIds = new Set(input.development.map((row) => row.fixtureId));
  const holdoutIds = new Set(input.holdout.map((row) => row.fixtureId));
  if (
    developmentIds.size !== 5
    || holdoutIds.size !== 5
    || [...developmentIds].some((fixtureId) => holdoutIds.has(fixtureId))
  ) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_QUALIFICATION_PARTITIONS_OVERLAP");
  }
  const warmIds = new Set(input.warm.map((row) => row.fixtureId));
  if (
    warmIds.size !== 5
    || [...warmIds].some((fixtureId) => !holdoutIds.has(fixtureId))
  ) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_WARM_FIXTURE_NOT_HOLDOUT");
  }
  const cancelRetryIds = new Set(input.cancelRetry.map((row) => row.fixtureId));
  if (
    cancelRetryIds.size !== 3
    || [...cancelRetryIds].some((fixtureId) => !holdoutIds.has(fixtureId))
  ) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_CANCEL_RETRY_FIXTURE_NOT_HOLDOUT");
  }
  const cancelledSegments = new Set(input.cancelRetry.map((row) => row.cancelledSegment));
  if (
    cancelledSegments.size !== 3
    || !["action", "reaction", "consequence"].every((segment) => cancelledSegments.has(
      segment as BrowserProseCandidateV2SegmentId,
    ))
  ) {
    throw new Error("BROWSER_PROSE_CANDIDATE_V2_CANCEL_RETRY_SEGMENT_MATRIX_INVALID");
  }
}

export const BROWSER_PROSE_RC65_CANDIDATE_REGISTRY = Object.freeze([
  BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
]);

export function assertBrowserProseRc65CandidateLimit(): void {
  const candidateCount: number = BROWSER_PROSE_RC65_CANDIDATE_REGISTRY.length;
  if (candidateCount < 1 || candidateCount > 2) {
    throw new Error("BROWSER_PROSE_RC65_CANDIDATE_LIMIT_EXCEEDED");
  }
}
