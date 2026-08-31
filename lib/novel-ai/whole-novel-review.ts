import type {
  ClosedAIBackendId,
  ClosedAgentExecutionResult,
} from "./closed-agent-os";
import type { Chapter, NovelProject } from "./domain";
import type { AuthorToolSnapshot } from "./author-tools";
import { PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS } from "./public-lounge/types";

export const WHOLE_NOVEL_REVIEW_SCHEMA_VERSION = "whole-novel-review-v2" as const;
export const WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION = "whole-novel-model-review-v1" as const;
export const WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION = "whole-novel-chunk-analysis-v2" as const;
export const WHOLE_NOVEL_COMPLETION_DECLARATION_SCHEMA_VERSION = "whole-novel-completion-declaration-v1" as const;
export const WHOLE_NOVEL_LOUNGE_ELIGIBILITY_SCHEMA_VERSION = "whole-novel-lounge-eligibility-v1" as const;
export const WHOLE_NOVEL_LOUNGE_THRESHOLD = 80;
export type WholeNovelReviewBackendId = ClosedAIBackendId;

export const WHOLE_NOVEL_PRIMARY_JUDGE_ROLES = [
  "literary-editor",
  "continuity-editor",
  "genre-reader",
] as const;
export type WholeNovelPrimaryJudgeRole = typeof WHOLE_NOVEL_PRIMARY_JUDGE_ROLES[number];
export type WholeNovelReviewJudgeRole = WholeNovelPrimaryJudgeRole | "score-arbitrator";
export const WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD = 60;

export type WholeNovelReviewDimensionKey =
  | "plot_coherence"
  | "character_arcs"
  | "world_canon_consistency"
  | "pacing"
  | "prose_dialogue"
  | "foreshadowing_payoff"
  | "ending";

export const WHOLE_NOVEL_REVIEW_RUBRIC = [
  {
    key: "plot_coherence",
    label: "情節與因果連貫",
    weight: 20,
    criteria: "核心衝突、事件因果、轉折與高潮是否成立，是否有斷鏈、重複或無代價推進。",
  },
  {
    key: "character_arcs",
    label: "角色弧線",
    weight: 15,
    criteria: "主要角色的目標、選擇、改變、關係與結局是否有可追溯的累積。",
  },
  {
    key: "world_canon_consistency",
    label: "世界與 Canon 一致性",
    weight: 15,
    criteria: "世界規則、時序、知識邊界、物件狀態與 Story Bible 是否前後一致。",
  },
  {
    key: "pacing",
    label: "節奏與篇章配置",
    weight: 15,
    criteria: "場景功能、資訊密度、張弛、章節比例與高潮前後節奏是否合宜。",
  },
  {
    key: "prose_dialogue",
    label: "敘事文字與對話",
    weight: 15,
    criteria: "敘事視角、語言清晰度、意象、人物聲線、對話潛台詞與可讀性。",
  },
  {
    key: "foreshadowing_payoff",
    label: "伏筆與回收",
    weight: 10,
    criteria: "重要伏筆是否有證據、推進與回收；回收是否自然，是否仍有逾期或遺漏線索。",
  },
  {
    key: "ending",
    label: "結局完成度",
    weight: 10,
    criteria: "核心衝突、角色弧線、主題與代價是否落地，結尾是否形成有意義的餘韻。",
  },
] as const satisfies ReadonlyArray<{
  key: WholeNovelReviewDimensionKey;
  label: string;
  weight: number;
  criteria: string;
}>;

export type WholeNovelCompletionReadiness = {
  readyToDeclare: boolean;
  substantiveChapterCount: number;
  completedChapterCount: number;
  totalInputCharacters: number;
  ignoredEmptyDraftCount: number;
  blockingChapterIds: string[];
  reasons: Array<"no_substantive_chapters" | "draft_chapters_contain_content">;
};

export type WholeNovelCompletionDeclaration = {
  schemaVersion: typeof WHOLE_NOVEL_COMPLETION_DECLARATION_SCHEMA_VERSION;
  projectId: string;
  projectTitle: string;
  completionFingerprint: string;
  declaredAt: string;
  declaredBy: "local-author";
  basis: "author-declared-after-structural-gate";
  substantiveChapterCount: number;
  totalInputCharacters: number;
  trailingEmptyDraftsIgnored: true;
};

export type WholeNovelReviewChunk = {
  id: string;
  chapterId: string;
  chapterTitle: string;
  chapterOrder: number;
  chapterRevision: number;
  chunkIndex: number;
  chunkCount: number;
  startOffset: number;
  endOffset: number;
  inputCharacters: number;
  text: string;
};

export type WholeNovelChunkAnalysis = {
  schemaVersion: typeof WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION;
  judgeRole: WholeNovelPrimaryJudgeRole;
  chunkId: string;
  chapterId: string;
  chunkIndex: number;
  summary: string;
  events: string[];
  characterChanges: string[];
  canonSignals: string[];
  pacingAndProse: string[];
  foreshadowingAndPayoff: string[];
  endingState: string;
};

export type WholeNovelDimensionAnalysis = {
  score: number;
  evidence: string[];
  strengths: string[];
  issues: string[];
  recommendations: string[];
};

export type WholeNovelReviewCompliance = {
  publicSafetyPassed: boolean;
  completenessPassed: boolean;
  privacyCopyrightPassed: boolean;
  hiddenDraftResidueDetected: boolean;
  matureContentDetected: boolean;
  reasons: string[];
};

export type WholeNovelModelReview = {
  schemaVersion: typeof WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION;
  judgeRole: WholeNovelReviewJudgeRole | "aggregate";
  outline: Array<{
    chapterId: string;
    title: string;
    summary: string;
    keyTurn: string;
    endingState: string;
  }>;
  dimensions: Record<WholeNovelReviewDimensionKey, WholeNovelDimensionAnalysis>;
  compliance: WholeNovelReviewCompliance;
  editorialVerdict: string;
  priorityRevisions: string[];
};

export type WholeNovelReviewExecutionProvenance = {
  stage: "chunk-analysis" | "whole-book-synthesis" | "whole-book-arbitration";
  chunkId: string | null;
  judgeRole: WholeNovelReviewJudgeRole | null;
  candidateId: string;
  taskId: string;
  receiptTaskId: string;
  backendId: WholeNovelReviewBackendId;
  actualExecutor: string;
  modelId: string;
  modelDigest: string;
  contentDigest: string;
  contextDigest: string;
  proofState: "verified";
  cacheHit: boolean;
  externalRequest: false;
  dataLeftDevice: false;
  canonicalMutationCount: 0;
};

export type WholeNovelJudgeSummary = {
  judgeRole: WholeNovelReviewJudgeRole;
  candidateId: string;
  modelId: string;
  modelDigest: string;
  totalScore: number;
  dimensionScores: Record<WholeNovelReviewDimensionKey, number>;
  compliance: WholeNovelReviewCompliance;
  editorialVerdict: string;
  priorityRevisions: string[];
  selectedForAggregation: boolean;
};

export type WholeNovelReviewAggregation = {
  modelReview: WholeNovelModelReview;
  primaryScoreSpread: number;
  arbitrationRequired: boolean;
  selectedJudgeRoles: WholeNovelReviewJudgeRole[];
};

export type WholeNovelReviewContract = {
  schemaVersion: typeof WHOLE_NOVEL_REVIEW_SCHEMA_VERSION;
  reviewId: string;
  generatedAt: string;
  project: {
    id: string;
    title: string;
    revision: number;
  };
  publicMetadata: {
    title: string;
    authorDisplayName: string | null;
    category: string | null;
    subcategory: string | null;
    completionStatus: "author-declared-complete";
    nonWhitespaceCharacters: number;
    chapterCount: number;
    completedAt: string;
    updatedAt: string;
    synopsis: string | null;
    missingBeforePublication: Array<"authorDisplayName" | "category" | "synopsis">;
  };
  completion: WholeNovelCompletionDeclaration & {
    stillMatchesReviewedContent: true;
  };
  coverage: {
    complete: true;
    substantiveChapterCount: number;
    chunkCount: number;
    inputCharacters: number;
    chapters: Array<{
      id: string;
      title: string;
      order: number;
      revision: number;
      inputCharacters: number;
      chunkIds: string[];
    }>;
  };
  outline: WholeNovelModelReview["outline"];
  rubric: Array<{
    key: WholeNovelReviewDimensionKey;
    label: string;
    weight: number;
    criteria: string;
  }>;
  dimensions: Record<WholeNovelReviewDimensionKey, WholeNovelDimensionAnalysis & {
    label: string;
    weight: number;
    weightedPoints: number;
  }>;
  totalScore: number;
  eligibleForPublicLounge: boolean;
  editorialVerdict: string;
  priorityRevisions: string[];
  loungeEligibility: {
    schemaVersion: typeof WHOLE_NOVEL_LOUNGE_ELIGIBILITY_SCHEMA_VERSION;
    threshold: typeof WHOLE_NOVEL_LOUNGE_THRESHOLD;
    eligible: boolean;
    score: number;
    hardGatePassed: boolean;
    compliancePassed: boolean;
    criticalDimensionsPassed: boolean;
    criticalDimensionThreshold: typeof WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD;
    matureContentDetected: boolean;
    blockingReasons: string[];
    reviewId: string;
    completionFingerprint: string;
    requiresCurrentMatchingCompletionFingerprint: true;
  };
  provenance: {
    mode: "verified-closed-ai";
    deterministicFallbackUsed: false;
    backendId: WholeNovelReviewBackendId;
    executions: WholeNovelReviewExecutionProvenance[];
    judges: WholeNovelJudgeSummary[];
    aggregation: {
      method: "per-dimension-median";
      primaryJudgeCount: 3;
      primaryScoreSpread: number;
      arbitrationRequired: boolean;
      arbitrationPerformed: boolean;
      selectedJudgeRoles: WholeNovelReviewJudgeRole[];
    };
  };
  privacy: {
    localPrivateReview: true;
    externalRequest: false;
    dataLeftDevice: false;
    rawNovelContentStoredInReview: false;
  };
  publication: {
    status: "not-published";
    autoPublished: false;
    optInRequired: true;
    publicationBackendConnected: false;
    publicUrl: null;
    authorActionRequiredForAnyExportOrPublication: true;
  };
};

const DIMENSION_KEYS = WHOLE_NOVEL_REVIEW_RUBRIC.map((item) => item.key);
const CRITICAL_DIMENSION_KEYS = [
  "plot_coherence",
  "character_arcs",
  "world_canon_consistency",
  "prose_dialogue",
] as const satisfies ReadonlyArray<WholeNovelReviewDimensionKey>;
const JUDGE_ROLE_LABELS: Record<WholeNovelReviewJudgeRole, string> = {
  "literary-editor": "文學編輯：優先檢查情節、角色弧線、文字與整體編輯完成度",
  "continuity-editor": "連續性編輯：優先檢查因果、時間線、世界規則、人物知識與伏筆狀態",
  "genre-reader": "類型讀者：優先檢查類型承諾、節奏、閱讀期待、高潮回收與結局滿足度",
  "score-arbitrator": "分數仲裁者：獨立重讀相同完整覆蓋包，針對三位評審的總分分歧作第四次裁決",
};
const REVIEW_STORAGE_PREFIX = "novel:whole-novel-review:v2:";
const DECLARATION_STORAGE_PREFIX = "novel:whole-novel-completion:v1:";

function substantiveChapters(chapters: Chapter[]) {
  return [...chapters]
    .filter((chapter) => chapter.content.trim().length > 0)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function evaluateWholeNovelCompletionReadiness(
  snapshot: Pick<AuthorToolSnapshot, "chapters">,
): WholeNovelCompletionReadiness {
  const substantive = substantiveChapters(snapshot.chapters);
  const blocking = substantive.filter((chapter) => chapter.status !== "completed");
  const reasons: WholeNovelCompletionReadiness["reasons"] = [];
  if (!substantive.length) reasons.push("no_substantive_chapters");
  if (blocking.length) reasons.push("draft_chapters_contain_content");
  return {
    readyToDeclare: reasons.length === 0,
    substantiveChapterCount: substantive.length,
    completedChapterCount: substantive.filter((chapter) => chapter.status === "completed").length,
    totalInputCharacters: substantive.reduce((total, chapter) => total + chapter.content.length, 0),
    ignoredEmptyDraftCount: snapshot.chapters.filter((chapter) => (
      chapter.status === "draft" && chapter.content.trim().length === 0
    )).length,
    blockingChapterIds: blocking.map((chapter) => chapter.id),
    reasons,
  };
}

function digestHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type WholeNovelCompletionFingerprintSnapshot = Pick<AuthorToolSnapshot, "project" | "chapters">
  & Partial<Omit<AuthorToolSnapshot, "project" | "chapters">>;

function compareFingerprintText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableFingerprintValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareFingerprintText(left, right))
    .map(([key, nested]) => [key, stableFingerprintValue(nested)]));
}

function stableFingerprintCollection(values: readonly unknown[] | undefined) {
  return [...(values ?? [])]
    .map(stableFingerprintValue)
    .sort((left, right) => compareFingerprintText(JSON.stringify(left) ?? "", JSON.stringify(right) ?? ""));
}

export async function buildWholeNovelCompletionFingerprint(
  snapshot: WholeNovelCompletionFingerprintSnapshot,
) {
  const chapters = substantiveChapters(snapshot.chapters);
  const payload = JSON.stringify(stableFingerprintValue({
    projectId: snapshot.project.id,
    project: snapshot.project,
    chapters,
    storyBible: snapshot.storyBible ?? null,
    storyState: snapshot.storyState ?? null,
    characters: stableFingerprintCollection(snapshot.characters),
    relationships: stableFingerprintCollection(snapshot.relationships),
    worldRules: stableFingerprintCollection(snapshot.worldRules),
    timeline: stableFingerprintCollection(snapshot.timeline),
    worlds: stableFingerprintCollection(snapshot.worlds),
    offstageCharacterNames: [...(snapshot.offstageCharacterNames ?? [])].sort(compareFingerprintText),
  }));
  return digestHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)));
}

export function createWholeNovelCompletionDeclaration(input: {
  project: NovelProject;
  readiness: WholeNovelCompletionReadiness;
  completionFingerprint: string;
  declaredAt?: string;
}): WholeNovelCompletionDeclaration {
  if (!input.readiness.readyToDeclare || !/^[a-f0-9]{64}$/u.test(input.completionFingerprint)) {
    throw Object.assign(new Error("WHOLE_NOVEL_NOT_READY_TO_DECLARE"), {
      code: "WHOLE_NOVEL_NOT_READY_TO_DECLARE",
    });
  }
  return {
    schemaVersion: WHOLE_NOVEL_COMPLETION_DECLARATION_SCHEMA_VERSION,
    projectId: input.project.id,
    projectTitle: input.project.title,
    completionFingerprint: input.completionFingerprint,
    declaredAt: input.declaredAt ?? new Date().toISOString(),
    declaredBy: "local-author",
    basis: "author-declared-after-structural-gate",
    substantiveChapterCount: input.readiness.substantiveChapterCount,
    totalInputCharacters: input.readiness.totalInputCharacters,
    trailingEmptyDraftsIgnored: true,
  };
}

export function planWholeNovelReviewChunks(input: {
  snapshot: Pick<AuthorToolSnapshot, "chapters">;
  maximumChunkCharacters: number;
}): WholeNovelReviewChunk[] {
  const maximum = Math.max(1_000, Math.min(16_000, Math.floor(input.maximumChunkCharacters)));
  return substantiveChapters(input.snapshot.chapters).flatMap((chapter) => {
    const chunkCount = Math.max(1, Math.ceil(chapter.content.length / maximum));
    return Array.from({ length: chunkCount }, (_, index) => {
      const startOffset = index * maximum;
      const endOffset = Math.min(chapter.content.length, startOffset + maximum);
      const text = chapter.content.slice(startOffset, endOffset);
      return {
        id: `${chapter.id}:r${chapter.revision}:chunk-${index + 1}-of-${chunkCount}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOrder: chapter.order,
        chapterRevision: chapter.revision,
        chunkIndex: index + 1,
        chunkCount,
        startOffset,
        endOffset,
        inputCharacters: text.length,
        text,
      };
    });
  });
}

export function buildWholeNovelChunkReviewObjective(
  projectTitle: string,
  chunk: WholeNovelReviewChunk,
  judgeRole: WholeNovelPrimaryJudgeRole,
) {
  return [
    `你正在以「${JUDGE_ROLE_LABELS[judgeRole]}」身分，獨立閱讀《${projectTitle}》第 ${chunk.chapterOrder} 章、片段 ${chunk.chunkIndex}/${chunk.chunkCount}。`,
    `judgeRole 必須原樣輸出為 ${judgeRole}；不得參照或模仿其他評審的摘要、判斷或分數。`,
    "只分析補充脈絡中與 chunkId 完全相符的正文片段，不得把其他最近章節當成這個片段，也不得增加原文沒有的情節。",
    "只輸出一個合法 JSON 物件，不要 Markdown、前言或結語。schemaVersion、chunkId、chapterId、chunkIndex 必須原樣回填。",
    `固定識別：schemaVersion=${WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION}；judgeRole=${judgeRole}；chunkId=${chunk.id}；chapterId=${chunk.chapterId}；chunkIndex=${chunk.chunkIndex}。`,
    "必要欄位：summary 字串；events、characterChanges、canonSignals、pacingAndProse、foreshadowingAndPayoff 為字串陣列；endingState 字串。",
    "每個陣列最多 4 項，每項最多 80 個中文字；summary 與 endingState 各最多 180 字。短證據只能定位或短引，不可大段複製正文。",
    "這只是閉端 AI 審查中間包，不是 Canon，不得評總分，也不得宣稱已完成全書審查。",
  ].join("\n");
}

export function buildWholeNovelChunkContext(chunk: WholeNovelReviewChunk) {
  return [
    "[WHOLE_NOVEL_REVIEW_SOURCE_CHUNK]",
    JSON.stringify({
      chunkId: chunk.id,
      chapterId: chunk.chapterId,
      chapterTitle: chunk.chapterTitle,
      chapterOrder: chunk.chapterOrder,
      chapterRevision: chunk.chapterRevision,
      chunkIndex: chunk.chunkIndex,
      chunkCount: chunk.chunkCount,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      inputCharacters: chunk.inputCharacters,
    }),
    "[SOURCE_TEXT_BEGIN]",
    chunk.text,
    "[SOURCE_TEXT_END]",
  ].join("\n");
}

function parseJSONObject(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)?.[1]?.trim();
  const source = fenced ?? trimmed;
  if (!source.startsWith("{") || !source.endsWith("}")) {
    throw Object.assign(new Error("WHOLE_NOVEL_REVIEW_JSON_REQUIRED"), {
      code: "WHOLE_NOVEL_REVIEW_JSON_REQUIRED",
    });
  }
  try {
    return JSON.parse(source);
  } catch {
    throw Object.assign(new Error("WHOLE_NOVEL_REVIEW_JSON_INVALID"), {
      code: "WHOLE_NOVEL_REVIEW_JSON_INVALID",
    });
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("WHOLE_NOVEL_REVIEW_SHAPE_INVALID"), {
      code: "WHOLE_NOVEL_REVIEW_SHAPE_INVALID",
    });
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, maximum: number, allowEmpty = false) {
  if (typeof value !== "string") throw new Error("WHOLE_NOVEL_REVIEW_STRING_REQUIRED");
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum) {
    throw new Error("WHOLE_NOVEL_REVIEW_STRING_OUT_OF_RANGE");
  }
  return normalized;
}

function boundedStrings(
  value: unknown,
  maximumItems: number,
  maximumCharacters: number,
  minimumItems = 0,
) {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > maximumItems) {
    throw new Error("WHOLE_NOVEL_REVIEW_ARRAY_OUT_OF_RANGE");
  }
  return value.map((item) => boundedString(item, maximumCharacters));
}

export function parseWholeNovelChunkAnalysis(
  content: string,
  chunk: WholeNovelReviewChunk,
  expectedJudgeRole: WholeNovelPrimaryJudgeRole,
): WholeNovelChunkAnalysis {
  const value = objectValue(parseJSONObject(content));
  if (
    value.schemaVersion !== WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION
    || value.judgeRole !== expectedJudgeRole
    || value.chunkId !== chunk.id
    || value.chapterId !== chunk.chapterId
    || value.chunkIndex !== chunk.chunkIndex
  ) {
    throw Object.assign(new Error("WHOLE_NOVEL_CHUNK_IDENTITY_MISMATCH"), {
      code: "WHOLE_NOVEL_CHUNK_IDENTITY_MISMATCH",
    });
  }
  return {
    schemaVersion: WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION,
    judgeRole: expectedJudgeRole,
    chunkId: chunk.id,
    chapterId: chunk.chapterId,
    chunkIndex: chunk.chunkIndex,
    summary: boundedString(value.summary, 180),
    events: boundedStrings(value.events, 4, 80),
    characterChanges: boundedStrings(value.characterChanges, 4, 80),
    canonSignals: boundedStrings(value.canonSignals, 4, 80),
    pacingAndProse: boundedStrings(value.pacingAndProse, 4, 80),
    foreshadowingAndPayoff: boundedStrings(value.foreshadowingAndPayoff, 4, 80),
    endingState: boundedString(value.endingState, 180),
  };
}

export function buildWholeNovelSynthesisObjective(input: {
  projectTitle: string;
  completionFingerprint: string;
  chapterIds: string[];
  judgeRole?: WholeNovelReviewJudgeRole;
  primaryReviews?: WholeNovelModelReview[];
}) {
  const judgeRole = input.judgeRole ?? "literary-editor";
  if (judgeRole === "score-arbitrator" && (
    input.primaryReviews?.length !== 3
    || WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.some((role) => (
      input.primaryReviews?.filter((review) => review.judgeRole === role).length !== 1
    ))
  )) {
    throw Object.assign(new Error("WHOLE_NOVEL_JUDGE_SET_INVALID"), {
      code: "WHOLE_NOVEL_JUDGE_SET_INVALID",
    });
  }
  const primaryScorecards = judgeRole === "score-arbitrator"
    ? (input.primaryReviews ?? []).map((review) => ({
      judgeRole: review.judgeRole,
      totalScore: wholeNovelModelReviewTotalScore(review),
      dimensions: Object.fromEntries(DIMENSION_KEYS.map((key) => [key, review.dimensions[key].score])),
      compliance: review.compliance,
    }))
    : [];
  return [
    `你是《${input.projectTitle}》的閉端 AI 全書評審。你的固定角色是：${JUDGE_ROLE_LABELS[judgeRole]}。`,
    judgeRole === "score-arbitrator"
      ? "補充脈絡含三位初審各自獨立完整閱讀全部正文後形成的三組覆蓋包；必須重新判斷分歧，不得直接採用任一初審的結論。"
      : `補充脈絡只含 ${judgeRole} 自己逐段獨立閱讀全部正文後形成的完整覆蓋包，不含其他評審摘要或分數。`,
    `完稿版本指紋：${input.completionFingerprint}。`,
    `章節 ID（順序與大綱必須完全一致，不可增刪）：${JSON.stringify(input.chapterIds)}。`,
    `judgeRole 必須原樣輸出為 ${judgeRole}。`,
    ...(judgeRole === "score-arbitrator" ? [
      `三位初審的精簡分數卡如下；只用來定位分歧，仍須依完整覆蓋包獨立仲裁：${JSON.stringify(primaryScorecards)}`,
    ] : []),
    "只輸出一個合法 JSON 物件，不要 Markdown、前言、結語或思考過程。不得用固定規則、篇幅統計或欄位填字取代小說判斷。",
    `schemaVersion 必須是 ${WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION}。`,
    "outline 必須逐章包含 chapterId、title、summary、keyTurn、endingState；每章恰好一項且依指定順序。",
    "dimensions 必須恰好包含 plot_coherence、character_arcs、world_canon_consistency、pacing、prose_dialogue、foreshadowing_payoff、ending。",
    "每個維度包含 score（0–100 整數）、evidence、strengths、issues、recommendations 五欄；後四欄為最多 6 項短字串陣列。證據須指向章節或短語，不得長段複製原文。",
    "compliance 必須包含 publicSafetyPassed、completenessPassed、privacyCopyrightPassed、hiddenDraftResidueDetected、matureContentDetected 五個布林值，以及 reasons 字串陣列（最多 10 項）。",
    "completenessPassed 只有在所有指定章節與覆蓋片均可辨識時才可為 true；hiddenDraftResidueDetected 要標示是否混入未完成草稿、提示詞、系統欄位或非小說殘片；matureContentDetected 只負責偵測，不可取代安全判斷。",
    "另輸出 editorialVerdict 字串與 priorityRevisions 字串陣列（最多 10 項）。資料不足時明確寫入問題欄，不得猜成 Canon。",
    "分數只代表此完稿版本的編輯審查；系統會依公開權重另行計算加權總分。不得宣稱已發布、已取得沙龍資格或已修改 Canon。",
  ].join("\n");
}

export function buildWholeNovelSynthesisContext(input: {
  project: Pick<NovelProject, "id" | "title" | "revision">;
  completionFingerprint: string;
  chunks: WholeNovelReviewChunk[];
  packets: WholeNovelChunkAnalysis[];
  judgeRole: WholeNovelReviewJudgeRole;
}) {
  const expectedRoles: WholeNovelPrimaryJudgeRole[] = input.judgeRole === "score-arbitrator"
    ? [...WHOLE_NOVEL_PRIMARY_JUDGE_ROLES]
    : [input.judgeRole];
  const expectedPacketCount = input.chunks.length * expectedRoles.length;
  const packetByIdentity = new Map(input.packets.map((packet) => [
    `${packet.judgeRole}:${packet.chunkId}`,
    packet,
  ]));
  if (
    input.packets.length !== expectedPacketCount
    || packetByIdentity.size !== expectedPacketCount
    || expectedRoles.some((role) => input.chunks.some((chunk) => (
      !packetByIdentity.has(`${role}:${chunk.id}`)
    )))
  ) {
    throw Object.assign(new Error("WHOLE_NOVEL_COVERAGE_INCOMPLETE"), {
      code: "WHOLE_NOVEL_COVERAGE_INCOMPLETE",
    });
  }
  return JSON.stringify({
    schemaVersion: "whole-novel-synthesis-input-v2",
    project: input.project,
    completionFingerprint: input.completionFingerprint,
    judgeRole: input.judgeRole,
    independentlyCoveredBy: expectedRoles,
    coverage: input.chunks.map((chunk) => ({
      chunkId: chunk.id,
      chapterId: chunk.chapterId,
      chapterTitle: chunk.chapterTitle,
      chapterOrder: chunk.chapterOrder,
      chunkIndex: chunk.chunkIndex,
      chunkCount: chunk.chunkCount,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      inputCharacters: chunk.inputCharacters,
    })),
    packets: expectedRoles.flatMap((role) => input.chunks.map((chunk) => (
      packetByIdentity.get(`${role}:${chunk.id}`)!
    ))),
  });
}

function dimensionAnalysis(value: unknown): WholeNovelDimensionAnalysis {
  const record = objectValue(value);
  if (!Number.isInteger(record.score) || Number(record.score) < 0 || Number(record.score) > 100) {
    throw new Error("WHOLE_NOVEL_SCORE_OUT_OF_RANGE");
  }
  return {
    score: Number(record.score),
    evidence: boundedStrings(record.evidence, 6, 220, 1),
    strengths: boundedStrings(record.strengths, 6, 220),
    issues: boundedStrings(record.issues, 6, 220),
    recommendations: boundedStrings(record.recommendations, 6, 220),
  };
}

function complianceAnalysis(value: unknown): WholeNovelReviewCompliance {
  const record = objectValue(value);
  const booleanKeys = [
    "publicSafetyPassed",
    "completenessPassed",
    "privacyCopyrightPassed",
    "hiddenDraftResidueDetected",
    "matureContentDetected",
  ] as const;
  if (booleanKeys.some((key) => typeof record[key] !== "boolean")) {
    throw Object.assign(new Error("WHOLE_NOVEL_COMPLIANCE_INVALID"), {
      code: "WHOLE_NOVEL_COMPLIANCE_INVALID",
    });
  }
  return {
    publicSafetyPassed: record.publicSafetyPassed as boolean,
    completenessPassed: record.completenessPassed as boolean,
    privacyCopyrightPassed: record.privacyCopyrightPassed as boolean,
    hiddenDraftResidueDetected: record.hiddenDraftResidueDetected as boolean,
    matureContentDetected: record.matureContentDetected as boolean,
    reasons: boundedStrings(record.reasons, 10, 240),
  };
}

export function parseWholeNovelModelReview(
  content: string,
  orderedChapters: Array<Pick<Chapter, "id" | "title">>,
  expectedJudgeRole: WholeNovelReviewJudgeRole = "literary-editor",
): WholeNovelModelReview {
  const value = objectValue(parseJSONObject(content));
  if (
    value.schemaVersion !== WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION
    || value.judgeRole !== expectedJudgeRole
    || !Array.isArray(value.outline)
  ) {
    throw Object.assign(new Error("WHOLE_NOVEL_MODEL_SCHEMA_INVALID"), {
      code: "WHOLE_NOVEL_MODEL_SCHEMA_INVALID",
    });
  }
  const rawOutline = value.outline;
  if (
    rawOutline.length !== orderedChapters.length
    || orderedChapters.some((chapter, index) => objectValue(rawOutline[index]).chapterId !== chapter.id)
  ) {
    throw Object.assign(new Error("WHOLE_NOVEL_OUTLINE_COVERAGE_INCOMPLETE"), {
      code: "WHOLE_NOVEL_OUTLINE_COVERAGE_INCOMPLETE",
    });
  }
  const outline = rawOutline.map((raw, index) => {
    const item = objectValue(raw);
    return {
      chapterId: orderedChapters[index]!.id,
      title: orderedChapters[index]!.title,
      summary: boundedString(item.summary, 700),
      keyTurn: boundedString(item.keyTurn, 400),
      endingState: boundedString(item.endingState, 400),
    };
  });
  const rawDimensions = objectValue(value.dimensions);
  if (
    Object.keys(rawDimensions).length !== DIMENSION_KEYS.length
    || DIMENSION_KEYS.some((key) => !(key in rawDimensions))
  ) {
    throw Object.assign(new Error("WHOLE_NOVEL_DIMENSIONS_INCOMPLETE"), {
      code: "WHOLE_NOVEL_DIMENSIONS_INCOMPLETE",
    });
  }
  const dimensions = Object.fromEntries(DIMENSION_KEYS.map((key) => [
    key,
    dimensionAnalysis(rawDimensions[key]),
  ])) as Record<WholeNovelReviewDimensionKey, WholeNovelDimensionAnalysis>;
  return {
    schemaVersion: WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION,
    judgeRole: expectedJudgeRole,
    outline,
    dimensions,
    compliance: complianceAnalysis(value.compliance),
    editorialVerdict: boundedString(value.editorialVerdict, 1_600),
    priorityRevisions: boundedStrings(value.priorityRevisions, 10, 320),
  };
}

export function wholeNovelModelReviewTotalScore(review: WholeNovelModelReview) {
  return Math.round(WHOLE_NOVEL_REVIEW_RUBRIC.reduce((total, rubric) => (
    total + review.dimensions[rubric.key].score * rubric.weight
  ), 0)) / 100;
}

export function wholeNovelReviewScoreSpread(reviews: WholeNovelModelReview[]) {
  if (!reviews.length) throw new Error("WHOLE_NOVEL_JUDGES_REQUIRED");
  const scores = reviews.map(wholeNovelModelReviewTotalScore);
  return Math.round((Math.max(...scores) - Math.min(...scores)) * 100) / 100;
}

function medianScore(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)]!;
}

function aggregateCompliance(reviews: WholeNovelModelReview[]): WholeNovelReviewCompliance {
  return {
    publicSafetyPassed: reviews.every((review) => review.compliance.publicSafetyPassed),
    completenessPassed: reviews.every((review) => review.compliance.completenessPassed),
    privacyCopyrightPassed: reviews.every((review) => review.compliance.privacyCopyrightPassed),
    hiddenDraftResidueDetected: reviews.some((review) => review.compliance.hiddenDraftResidueDetected),
    matureContentDetected: reviews.some((review) => review.compliance.matureContentDetected),
    reasons: [...new Set(reviews.flatMap((review) => review.compliance.reasons.map(
      (reason) => `${review.judgeRole}: ${reason}`,
    )))].slice(0, 30),
  };
}

function mergeUniqueReviewStrings(values: string[], maximumItems: number) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/gu, " ");
    const identity = normalized.toLocaleLowerCase("zh-TW");
    if (!normalized || seen.has(identity)) continue;
    seen.add(identity);
    merged.push(normalized);
    if (merged.length >= maximumItems) break;
  }
  return merged;
}

function judgeRoleName(role: WholeNovelReviewJudgeRole | "aggregate") {
  if (role === "aggregate") return "綜合評審";
  return JUDGE_ROLE_LABELS[role].split("：")[0] ?? role;
}

export function aggregateWholeNovelModelReviews(
  judgeReviews: WholeNovelModelReview[],
): WholeNovelReviewAggregation {
  const primaryReviews = WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.map((role) => (
    judgeReviews.find((review) => review.judgeRole === role)
  ));
  const arbitrators = judgeReviews.filter((review) => review.judgeRole === "score-arbitrator");
  if (
    judgeReviews.some((review) => review.judgeRole === "aggregate")
    || primaryReviews.some((review) => !review)
    || new Set(judgeReviews.map((review) => review.judgeRole)).size !== judgeReviews.length
    || arbitrators.length > 1
  ) {
    throw Object.assign(new Error("WHOLE_NOVEL_JUDGE_SET_INVALID"), {
      code: "WHOLE_NOVEL_JUDGE_SET_INVALID",
    });
  }
  const primaries = primaryReviews as WholeNovelModelReview[];
  const primaryScoreSpread = wholeNovelReviewScoreSpread(primaries);
  const arbitrationRequired = primaryScoreSpread > 10;
  if (arbitrationRequired !== (arbitrators.length === 1) || judgeReviews.length !== (arbitrationRequired ? 4 : 3)) {
    throw Object.assign(new Error("WHOLE_NOVEL_ARBITRATION_REQUIRED"), {
      code: "WHOLE_NOVEL_ARBITRATION_REQUIRED",
    });
  }
  const arbitrator = arbitrators[0] ?? null;
  const selected = arbitrator
    ? [
      arbitrator,
      ...primaries
        .map((review, index) => ({
          review,
          index,
          distance: Math.abs(
            wholeNovelModelReviewTotalScore(review) - wholeNovelModelReviewTotalScore(arbitrator),
          ),
        }))
        .sort((left, right) => left.distance - right.distance || left.index - right.index)
        .slice(0, 2)
        .map((item) => item.review),
    ]
    : primaries;
  const dimensions = Object.fromEntries(DIMENSION_KEYS.map((key) => {
    const score = medianScore(selected.map((review) => review.dimensions[key].score));
    const source = selected
      .map((review, index) => ({ review, index, distance: Math.abs(review.dimensions[key].score - score) }))
      .sort((left, right) => left.distance - right.distance || left.index - right.index)[0]!.review;
    return [key, {
      ...source.dimensions[key],
      score,
      evidence: mergeUniqueReviewStrings(
        selected.flatMap((review) => review.dimensions[key].evidence),
        18,
      ),
      strengths: mergeUniqueReviewStrings(
        selected.flatMap((review) => review.dimensions[key].strengths),
        18,
      ),
      issues: mergeUniqueReviewStrings(
        selected.flatMap((review) => review.dimensions[key].issues),
        18,
      ),
      recommendations: mergeUniqueReviewStrings(
        selected.flatMap((review) => review.dimensions[key].recommendations),
        18,
      ),
    }];
  })) as Record<WholeNovelReviewDimensionKey, WholeNovelDimensionAnalysis>;
  const editorialSource = arbitrator ?? primaries[0]!;
  const editorialVerdict = mergeUniqueReviewStrings(
    selected.map((review) => `${judgeRoleName(review.judgeRole)}：${review.editorialVerdict}`),
    selected.length,
  ).join("\n");
  const priorityRevisions = mergeUniqueReviewStrings(
    selected.flatMap((review) => review.priorityRevisions),
    30,
  );
  return {
    modelReview: {
      schemaVersion: WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION,
      judgeRole: "aggregate",
      outline: editorialSource.outline,
      dimensions,
      compliance: aggregateCompliance(judgeReviews),
      editorialVerdict,
      priorityRevisions,
    },
    primaryScoreSpread,
    arbitrationRequired,
    selectedJudgeRoles: selected.map((review) => review.judgeRole as WholeNovelReviewJudgeRole),
  };
}

export function verifiedWholeNovelReviewExecution(input: {
  result: ClosedAgentExecutionResult;
  expectedBackend: WholeNovelReviewBackendId;
  stage: WholeNovelReviewExecutionProvenance["stage"];
  chunkId?: string;
  judgeRole?: WholeNovelReviewJudgeRole;
}): WholeNovelReviewExecutionProvenance | null {
  const candidate = input.result.candidate;
  const receipt = candidate.executionReceipt ?? candidate.cacheOrigin?.originExecutionReceipt ?? null;
  const judgeRole = input.judgeRole ?? null;
  if (
    (input.stage === "chunk-analysis" && (
      !input.chunkId
      || !WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.includes(judgeRole as WholeNovelPrimaryJudgeRole)
    ))
    || (input.stage === "whole-book-synthesis" && !WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.includes(
      judgeRole as WholeNovelPrimaryJudgeRole,
    ))
    || (input.stage === "whole-book-arbitration" && judgeRole !== "score-arbitrator")
    || candidate.backendId !== input.expectedBackend
    || candidate.actualExecutor !== input.expectedBackend
    || candidate.candidateOnly !== true
    || candidate.canonicalMutationCount !== 0
    || candidate.status !== "awaiting-approval"
    || !candidate.content.trim()
    || candidate.dataLeftDevice !== false
    || candidate.externalRequest !== false
    || receipt?.proofState !== "verified"
    || receipt.backendId !== input.expectedBackend
    || receipt.actualExecutor !== input.expectedBackend
    || receipt.modelId !== candidate.modelId
    || receipt.modelDigest !== candidate.modelDigest
    || receipt.contentDigest !== candidate.contentDigest
    || receipt.outputCharacters < 1
    || receipt.dataLeftDevice !== false
    || receipt.externalRequest !== false
  ) return null;
  return {
    stage: input.stage,
    chunkId: input.chunkId ?? null,
    judgeRole,
    candidateId: candidate.id,
    taskId: candidate.taskId,
    receiptTaskId: receipt.taskId,
    backendId: input.expectedBackend,
    actualExecutor: receipt.actualExecutor,
    modelId: receipt.modelId,
    modelDigest: receipt.modelDigest,
    contentDigest: receipt.contentDigest,
    contextDigest: receipt.contextDigest,
    proofState: "verified",
    cacheHit: input.result.cache.candidateHit,
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
  };
}

export function createWholeNovelReviewContract(input: {
  reviewId: string;
  generatedAt?: string;
  snapshot: Pick<AuthorToolSnapshot, "project" | "chapters">;
  declaration: WholeNovelCompletionDeclaration;
  currentCompletionFingerprint: string;
  chunks: WholeNovelReviewChunk[];
  packets: WholeNovelChunkAnalysis[];
  modelReview: WholeNovelModelReview;
  judgeReviews?: WholeNovelModelReview[];
  executions: WholeNovelReviewExecutionProvenance[];
  backendId: WholeNovelReviewBackendId;
  publicMetadata?: {
    authorDisplayName?: string;
    category?: string;
    synopsis?: string;
  };
}): WholeNovelReviewContract {
  const chapters = substantiveChapters(input.snapshot.chapters);
  const judgeReviews = input.judgeReviews ?? [];
  const aggregation = aggregateWholeNovelModelReviews(judgeReviews);
  const modelReview = aggregation.modelReview;
  const chunkExecutions = input.executions.filter((execution) => execution.stage === "chunk-analysis");
  const synthesisExecutions = input.executions.filter((execution) => execution.stage === "whole-book-synthesis");
  const arbitrationExecutions = input.executions.filter((execution) => execution.stage === "whole-book-arbitration");
  const chunksCoverEveryCharacter = chapters.every((chapter) => {
    const chapterChunks = input.chunks.filter((chunk) => chunk.chapterId === chapter.id);
    return chapterChunks.length > 0
      && chapterChunks[0]?.startOffset === 0
      && chapterChunks.at(-1)?.endOffset === chapter.content.length
      && chapterChunks.every((chunk, index) => (
        chunk.chunkIndex === index + 1
        && chunk.chunkCount === chapterChunks.length
        && chunk.startOffset === (chapterChunks[index - 1]?.endOffset ?? 0)
      ))
      && chapterChunks.map((chunk) => chunk.text).join("") === chapter.content;
  });
  const expectedRoleChunkIdentities = WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.flatMap((role) => (
    input.chunks.map((chunk) => `${role}:${chunk.id}`)
  ));
  const packetIdentities = input.packets.map((packet) => `${packet.judgeRole}:${packet.chunkId}`);
  const executionIdentities = chunkExecutions.map((execution) => (
    `${execution.judgeRole}:${execution.chunkId}`
  ));
  if (
    input.declaration.projectId !== input.snapshot.project.id
    || input.declaration.completionFingerprint !== input.currentCompletionFingerprint
    || input.packets.length !== expectedRoleChunkIdentities.length
    || new Set(packetIdentities).size !== expectedRoleChunkIdentities.length
    || expectedRoleChunkIdentities.some((identity) => !packetIdentities.includes(identity))
    || modelReview.outline.length !== chapters.length
    || modelReview.outline.some((item, index) => (
      item.chapterId !== chapters[index]?.id || item.title !== chapters[index]?.title
    ))
    || JSON.stringify(input.modelReview) !== JSON.stringify(modelReview)
    || input.executions.length !== expectedRoleChunkIdentities.length + judgeReviews.length
    || input.executions.some((execution) => execution.backendId !== input.backendId)
    || chunkExecutions.length !== expectedRoleChunkIdentities.length
    || new Set(executionIdentities).size !== expectedRoleChunkIdentities.length
    || expectedRoleChunkIdentities.some((identity) => !executionIdentities.includes(identity))
    || synthesisExecutions.length !== 3
    || WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.some((role) => (
      synthesisExecutions.filter((execution) => execution.judgeRole === role).length !== 1
    ))
    || synthesisExecutions.some((execution) => execution.chunkId !== null)
    || arbitrationExecutions.length !== (aggregation.arbitrationRequired ? 1 : 0)
    || arbitrationExecutions.some((execution) => (
      execution.chunkId !== null || execution.judgeRole !== "score-arbitrator"
    ))
    || judgeReviews.some((review) => !input.executions.some((execution) => (
      execution.judgeRole === review.judgeRole
    )))
    || new Set(input.executions.map((execution) => execution.candidateId)).size !== input.executions.length
    || !chunksCoverEveryCharacter
  ) {
    throw Object.assign(new Error("WHOLE_NOVEL_REVIEW_CONTRACT_INCOMPLETE"), {
      code: "WHOLE_NOVEL_REVIEW_CONTRACT_INCOMPLETE",
    });
  }
  const dimensions = Object.fromEntries(WHOLE_NOVEL_REVIEW_RUBRIC.map((rubric) => {
    const analysis = modelReview.dimensions[rubric.key];
    return [rubric.key, {
      ...analysis,
      label: rubric.label,
      weight: rubric.weight,
      weightedPoints: Math.round(analysis.score * rubric.weight) / 100,
    }];
  })) as WholeNovelReviewContract["dimensions"];
  const totalScore = wholeNovelModelReviewTotalScore(modelReview);
  const compliancePassed = modelReview.compliance.publicSafetyPassed
    && modelReview.compliance.completenessPassed
    && modelReview.compliance.privacyCopyrightPassed
    && !modelReview.compliance.hiddenDraftResidueDetected;
  const criticalDimensionsPassed = CRITICAL_DIMENSION_KEYS.every((key) => (
    modelReview.dimensions[key].score >= WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD
  ));
  const blockingReasons: string[] = [];
  if (totalScore < WHOLE_NOVEL_LOUNGE_THRESHOLD) blockingReasons.push("quality_threshold_not_met");
  if (!modelReview.compliance.publicSafetyPassed) blockingReasons.push("public_safety_failed");
  if (!modelReview.compliance.completenessPassed) blockingReasons.push("completeness_failed");
  if (!modelReview.compliance.privacyCopyrightPassed) blockingReasons.push("privacy_copyright_failed");
  if (modelReview.compliance.hiddenDraftResidueDetected) blockingReasons.push("hidden_draft_residue_detected");
  for (const key of CRITICAL_DIMENSION_KEYS) {
    if (modelReview.dimensions[key].score < WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD) {
      blockingReasons.push(`critical_dimension_below_${WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD}:${key}`);
    }
  }
  const hardGatePassed = compliancePassed && criticalDimensionsPassed;
  const eligibleForPublicLounge = totalScore >= WHOLE_NOVEL_LOUNGE_THRESHOLD && hardGatePassed;
  const reviewId = input.reviewId.trim();
  if (!reviewId) throw new Error("WHOLE_NOVEL_REVIEW_ID_REQUIRED");
  const updatedAt = [input.snapshot.project.updatedAt, ...chapters.map((chapter) => chapter.updatedAt)]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? input.declaration.declaredAt;
  const authorDisplayName = input.publicMetadata?.authorDisplayName?.trim().slice(0, 80) || null;
  const category = input.publicMetadata?.category?.trim().slice(0, 120)
    || input.snapshot.project.genreId
    || input.snapshot.project.genrePackId;
  const synopsis = input.publicMetadata?.synopsis?.trim().slice(0, PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS)
    || input.snapshot.project.coreIdea.value?.trim().slice(0, PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS)
    || null;
  const publicMetadata: WholeNovelReviewContract["publicMetadata"] = {
    title: input.snapshot.project.title,
    authorDisplayName,
    category,
    subcategory: input.snapshot.project.subgenreId,
    completionStatus: "author-declared-complete",
    nonWhitespaceCharacters: chapters.reduce(
      (total, chapter) => total + chapter.content.replace(/\s/gu, "").length,
      0,
    ),
    chapterCount: chapters.length,
    completedAt: input.declaration.declaredAt,
    updatedAt,
    synopsis,
    missingBeforePublication: [],
  };
  if (!publicMetadata.authorDisplayName) publicMetadata.missingBeforePublication.push("authorDisplayName");
  if (!publicMetadata.category) publicMetadata.missingBeforePublication.push("category");
  if (!publicMetadata.synopsis) publicMetadata.missingBeforePublication.push("synopsis");
  return {
    schemaVersion: WHOLE_NOVEL_REVIEW_SCHEMA_VERSION,
    reviewId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    project: {
      id: input.snapshot.project.id,
      title: input.snapshot.project.title,
      revision: input.snapshot.project.revision,
    },
    publicMetadata,
    completion: {
      ...input.declaration,
      stillMatchesReviewedContent: true,
    },
    coverage: {
      complete: true,
      substantiveChapterCount: chapters.length,
      chunkCount: input.chunks.length,
      inputCharacters: input.chunks.reduce((total, chunk) => total + chunk.inputCharacters, 0),
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        order: chapter.order,
        revision: chapter.revision,
        inputCharacters: chapter.content.length,
        chunkIds: input.chunks.filter((chunk) => chunk.chapterId === chapter.id).map((chunk) => chunk.id),
      })),
    },
    outline: modelReview.outline,
    rubric: WHOLE_NOVEL_REVIEW_RUBRIC.map((rubric) => ({ ...rubric })),
    dimensions,
    totalScore,
    eligibleForPublicLounge,
    editorialVerdict: modelReview.editorialVerdict,
    priorityRevisions: modelReview.priorityRevisions,
    loungeEligibility: {
      schemaVersion: WHOLE_NOVEL_LOUNGE_ELIGIBILITY_SCHEMA_VERSION,
      threshold: WHOLE_NOVEL_LOUNGE_THRESHOLD,
      eligible: eligibleForPublicLounge,
      score: totalScore,
      hardGatePassed,
      compliancePassed,
      criticalDimensionsPassed,
      criticalDimensionThreshold: WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD,
      matureContentDetected: modelReview.compliance.matureContentDetected,
      blockingReasons,
      reviewId,
      completionFingerprint: input.currentCompletionFingerprint,
      requiresCurrentMatchingCompletionFingerprint: true,
    },
    provenance: {
      mode: "verified-closed-ai",
      deterministicFallbackUsed: false,
      backendId: input.backendId,
      executions: input.executions,
      judges: judgeReviews.map((judgeReview) => {
        const execution = input.executions.find((item) => item.judgeRole === judgeReview.judgeRole)!;
        return {
          judgeRole: judgeReview.judgeRole as WholeNovelReviewJudgeRole,
          candidateId: execution.candidateId,
          modelId: execution.modelId,
          modelDigest: execution.modelDigest,
          totalScore: wholeNovelModelReviewTotalScore(judgeReview),
          dimensionScores: Object.fromEntries(DIMENSION_KEYS.map((key) => [
            key,
            judgeReview.dimensions[key].score,
          ])) as Record<WholeNovelReviewDimensionKey, number>,
          compliance: judgeReview.compliance,
          editorialVerdict: judgeReview.editorialVerdict,
          priorityRevisions: judgeReview.priorityRevisions,
          selectedForAggregation: aggregation.selectedJudgeRoles.includes(
            judgeReview.judgeRole as WholeNovelReviewJudgeRole,
          ),
        };
      }),
      aggregation: {
        method: "per-dimension-median",
        primaryJudgeCount: 3,
        primaryScoreSpread: aggregation.primaryScoreSpread,
        arbitrationRequired: aggregation.arbitrationRequired,
        arbitrationPerformed: arbitrationExecutions.length === 1,
        selectedJudgeRoles: aggregation.selectedJudgeRoles,
      },
    },
    privacy: {
      localPrivateReview: true,
      externalRequest: false,
      dataLeftDevice: false,
      rawNovelContentStoredInReview: false,
    },
    publication: {
      status: "not-published",
      autoPublished: false,
      optInRequired: true,
      publicationBackendConnected: false,
      publicUrl: null,
      authorActionRequiredForAnyExportOrPublication: true,
    },
  };
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function wholeNovelReviewStorageKey(projectId: string) {
  return `${REVIEW_STORAGE_PREFIX}${projectId}`;
}

export function wholeNovelCompletionStorageKey(projectId: string) {
  return `${DECLARATION_STORAGE_PREFIX}${projectId}`;
}

export function saveWholeNovelCompletionDeclaration(
  declaration: WholeNovelCompletionDeclaration,
  storage: KeyValueStorage,
) {
  storage.setItem(wholeNovelCompletionStorageKey(declaration.projectId), JSON.stringify(declaration));
}

export function loadWholeNovelCompletionDeclaration(
  projectId: string,
  storage: KeyValueStorage,
): WholeNovelCompletionDeclaration | null {
  try {
    const value = JSON.parse(storage.getItem(wholeNovelCompletionStorageKey(projectId)) ?? "null") as Partial<WholeNovelCompletionDeclaration> | null;
    return value?.schemaVersion === WHOLE_NOVEL_COMPLETION_DECLARATION_SCHEMA_VERSION
      && value.projectId === projectId
      && typeof value.completionFingerprint === "string"
      && /^[a-f0-9]{64}$/u.test(value.completionFingerprint)
      ? value as WholeNovelCompletionDeclaration
      : null;
  } catch {
    return null;
  }
}

export function removeWholeNovelCompletionDeclaration(projectId: string, storage: KeyValueStorage) {
  storage.removeItem(wholeNovelCompletionStorageKey(projectId));
  storage.removeItem(wholeNovelReviewStorageKey(projectId));
}

export function saveWholeNovelReview(review: WholeNovelReviewContract, storage: KeyValueStorage) {
  storage.setItem(wholeNovelReviewStorageKey(review.project.id), JSON.stringify(review));
}

export function removeWholeNovelReview(projectId: string, storage: KeyValueStorage) {
  storage.removeItem(wholeNovelReviewStorageKey(projectId));
}

function storedWholeNovelReviewGatesAreConsistent(
  value: Partial<WholeNovelReviewContract>,
) {
  const dimensions = value.dimensions;
  const loungeEligibility = value.loungeEligibility;
  const judges = value.provenance?.judges;
  if (!dimensions || !loungeEligibility || !Array.isArray(judges) || judges.length < 3) return false;
  const scores = WHOLE_NOVEL_REVIEW_RUBRIC.map((rubric) => dimensions[rubric.key]?.score);
  if (scores.some((score) => !Number.isInteger(score) || (score ?? -1) < 0 || (score ?? 101) > 100)) {
    return false;
  }
  const computedTotalScore = Math.round(WHOLE_NOVEL_REVIEW_RUBRIC.reduce((total, rubric) => (
    total + dimensions[rubric.key].score * rubric.weight
  ), 0)) / 100;
  const compliancePassed = judges.every((judge) => (
    judge.compliance?.publicSafetyPassed === true
    && judge.compliance?.completenessPassed === true
    && judge.compliance?.privacyCopyrightPassed === true
    && judge.compliance?.hiddenDraftResidueDetected === false
  ));
  const criticalDimensionsPassed = CRITICAL_DIMENSION_KEYS.every((key) => (
    dimensions[key].score >= WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD
  ));
  const hardGatePassed = compliancePassed && criticalDimensionsPassed;
  const eligible = computedTotalScore >= WHOLE_NOVEL_LOUNGE_THRESHOLD && hardGatePassed;
  return value.totalScore === computedTotalScore
    && value.eligibleForPublicLounge === eligible
    && loungeEligibility.score === computedTotalScore
    && loungeEligibility.threshold === WHOLE_NOVEL_LOUNGE_THRESHOLD
    && loungeEligibility.criticalDimensionThreshold === WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD
    && loungeEligibility.compliancePassed === compliancePassed
    && loungeEligibility.criticalDimensionsPassed === criticalDimensionsPassed
    && loungeEligibility.hardGatePassed === hardGatePassed
    && loungeEligibility.eligible === eligible;
}

export function loadWholeNovelReview(
  projectId: string,
  storage: KeyValueStorage,
): WholeNovelReviewContract | null {
  try {
    const value = JSON.parse(storage.getItem(wholeNovelReviewStorageKey(projectId)) ?? "null") as Partial<WholeNovelReviewContract> | null;
    return value?.schemaVersion === WHOLE_NOVEL_REVIEW_SCHEMA_VERSION
      && value.project?.id === projectId
      && typeof value.totalScore === "number"
      && value.provenance?.mode === "verified-closed-ai"
      && value.provenance?.deterministicFallbackUsed === false
      && Array.isArray(value.provenance?.judges)
      && value.provenance.judges.length >= 3
      && value.provenance?.aggregation?.method === "per-dimension-median"
      && typeof value.loungeEligibility?.hardGatePassed === "boolean"
      && typeof value.loungeEligibility?.compliancePassed === "boolean"
      && typeof value.loungeEligibility?.criticalDimensionsPassed === "boolean"
      && Array.isArray(value.loungeEligibility?.blockingReasons)
      && storedWholeNovelReviewGatesAreConsistent(value)
      && value.eligibleForPublicLounge === value.loungeEligibility?.eligible
      && (!value.eligibleForPublicLounge || (
        value.totalScore >= WHOLE_NOVEL_LOUNGE_THRESHOLD
        && value.loungeEligibility.hardGatePassed
        && value.loungeEligibility.compliancePassed
        && value.loungeEligibility.criticalDimensionsPassed
      ))
      && value.publication?.autoPublished === false
      ? value as WholeNovelReviewContract
      : null;
  } catch {
    return null;
  }
}
