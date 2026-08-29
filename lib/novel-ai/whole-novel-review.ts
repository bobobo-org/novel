import type {
  ClosedAIBackendId,
  ClosedAgentExecutionResult,
} from "./closed-agent-os";
import type { Chapter, NovelProject } from "./domain";
import type { AuthorToolSnapshot } from "./author-tools";

export const WHOLE_NOVEL_REVIEW_SCHEMA_VERSION = "whole-novel-review-v1" as const;
export const WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION = "whole-novel-model-review-v1" as const;
export const WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION = "whole-novel-chunk-analysis-v1" as const;
export const WHOLE_NOVEL_COMPLETION_DECLARATION_SCHEMA_VERSION = "whole-novel-completion-declaration-v1" as const;
export const WHOLE_NOVEL_LOUNGE_ELIGIBILITY_SCHEMA_VERSION = "whole-novel-lounge-eligibility-v1" as const;
export const WHOLE_NOVEL_LOUNGE_THRESHOLD = 80;
export type WholeNovelReviewBackendId = ClosedAIBackendId;

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

export type WholeNovelModelReview = {
  schemaVersion: typeof WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION;
  outline: Array<{
    chapterId: string;
    title: string;
    summary: string;
    keyTurn: string;
    endingState: string;
  }>;
  dimensions: Record<WholeNovelReviewDimensionKey, WholeNovelDimensionAnalysis>;
  editorialVerdict: string;
  priorityRevisions: string[];
};

export type WholeNovelReviewExecutionProvenance = {
  stage: "chunk-analysis" | "whole-book-synthesis";
  chunkId: string | null;
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
    reviewId: string;
    completionFingerprint: string;
    requiresCurrentMatchingCompletionFingerprint: true;
  };
  provenance: {
    mode: "verified-closed-ai";
    deterministicFallbackUsed: false;
    backendId: WholeNovelReviewBackendId;
    executions: WholeNovelReviewExecutionProvenance[];
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
const REVIEW_STORAGE_PREFIX = "novel:whole-novel-review:v1:";
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

export async function buildWholeNovelCompletionFingerprint(
  snapshot: Pick<AuthorToolSnapshot, "project" | "chapters">,
) {
  const chapters = substantiveChapters(snapshot.chapters);
  const payload = JSON.stringify({
    projectId: snapshot.project.id,
    projectRevision: snapshot.project.revision,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      order: chapter.order,
      revision: chapter.revision,
      status: chapter.status,
      title: chapter.title,
      content: chapter.content,
    })),
  });
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
) {
  return [
    `你正在進行《${projectTitle}》的全書完稿審查第 ${chunk.chapterOrder} 章、片段 ${chunk.chunkIndex}/${chunk.chunkCount}。`,
    "只分析補充脈絡中與 chunkId 完全相符的正文片段，不得把其他最近章節當成這個片段，也不得增加原文沒有的情節。",
    "只輸出一個合法 JSON 物件，不要 Markdown、前言或結語。schemaVersion、chunkId、chapterId、chunkIndex 必須原樣回填。",
    `固定識別：schemaVersion=${WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION}；chunkId=${chunk.id}；chapterId=${chunk.chapterId}；chunkIndex=${chunk.chunkIndex}。`,
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
): WholeNovelChunkAnalysis {
  const value = objectValue(parseJSONObject(content));
  if (
    value.schemaVersion !== WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION
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
}) {
  return [
    `你是《${input.projectTitle}》的全書完稿總編審。補充脈絡含每一段正文由真實閉端模型產生的完整覆蓋分析包。`,
    `完稿版本指紋：${input.completionFingerprint}。`,
    `章節 ID（順序與大綱必須完全一致，不可增刪）：${JSON.stringify(input.chapterIds)}。`,
    "只輸出一個合法 JSON 物件，不要 Markdown、前言、結語或思考過程。不得用固定規則、篇幅統計或欄位填字取代小說判斷。",
    `schemaVersion 必須是 ${WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION}。`,
    "outline 必須逐章包含 chapterId、title、summary、keyTurn、endingState；每章恰好一項且依指定順序。",
    "dimensions 必須恰好包含 plot_coherence、character_arcs、world_canon_consistency、pacing、prose_dialogue、foreshadowing_payoff、ending。",
    "每個維度包含 score（0–100 整數）、evidence、strengths、issues、recommendations 五欄；後四欄為最多 6 項短字串陣列。證據須指向章節或短語，不得長段複製原文。",
    "另輸出 editorialVerdict 字串與 priorityRevisions 字串陣列（最多 10 項）。資料不足時明確寫入問題欄，不得猜成 Canon。",
    "分數只代表此完稿版本的編輯審查；系統會依公開權重另行計算加權總分。不得宣稱已發布、已取得沙龍資格或已修改 Canon。",
  ].join("\n");
}

export function buildWholeNovelSynthesisContext(input: {
  project: Pick<NovelProject, "id" | "title" | "revision">;
  completionFingerprint: string;
  chunks: WholeNovelReviewChunk[];
  packets: WholeNovelChunkAnalysis[];
}) {
  if (
    input.chunks.length !== input.packets.length
    || input.chunks.some((chunk, index) => input.packets[index]?.chunkId !== chunk.id)
  ) {
    throw Object.assign(new Error("WHOLE_NOVEL_COVERAGE_INCOMPLETE"), {
      code: "WHOLE_NOVEL_COVERAGE_INCOMPLETE",
    });
  }
  return JSON.stringify({
    schemaVersion: "whole-novel-synthesis-input-v1",
    project: input.project,
    completionFingerprint: input.completionFingerprint,
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
    packets: input.packets,
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

export function parseWholeNovelModelReview(
  content: string,
  orderedChapters: Array<Pick<Chapter, "id" | "title">>,
): WholeNovelModelReview {
  const value = objectValue(parseJSONObject(content));
  if (value.schemaVersion !== WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION || !Array.isArray(value.outline)) {
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
    outline,
    dimensions,
    editorialVerdict: boundedString(value.editorialVerdict, 1_600),
    priorityRevisions: boundedStrings(value.priorityRevisions, 10, 320),
  };
}

export function verifiedWholeNovelReviewExecution(input: {
  result: ClosedAgentExecutionResult;
  expectedBackend: WholeNovelReviewBackendId;
  stage: WholeNovelReviewExecutionProvenance["stage"];
  chunkId?: string;
}): WholeNovelReviewExecutionProvenance | null {
  const candidate = input.result.candidate;
  const receipt = candidate.executionReceipt ?? candidate.cacheOrigin?.originExecutionReceipt ?? null;
  if (
    candidate.backendId !== input.expectedBackend
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
  executions: WholeNovelReviewExecutionProvenance[];
  backendId: WholeNovelReviewBackendId;
  publicMetadata?: {
    authorDisplayName?: string;
    category?: string;
    synopsis?: string;
  };
}): WholeNovelReviewContract {
  const chapters = substantiveChapters(input.snapshot.chapters);
  const chunkExecutions = input.executions.filter((execution) => execution.stage === "chunk-analysis");
  const synthesisExecutions = input.executions.filter((execution) => execution.stage === "whole-book-synthesis");
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
  if (
    input.declaration.projectId !== input.snapshot.project.id
    || input.declaration.completionFingerprint !== input.currentCompletionFingerprint
    || input.chunks.length !== input.packets.length
    || input.chunks.some((chunk, index) => input.packets[index]?.chunkId !== chunk.id)
    || input.modelReview.outline.length !== chapters.length
    || input.modelReview.outline.some((item, index) => (
      item.chapterId !== chapters[index]?.id || item.title !== chapters[index]?.title
    ))
    || input.executions.length !== input.chunks.length + 1
    || input.executions.some((execution) => execution.backendId !== input.backendId)
    || chunkExecutions.length !== input.chunks.length
    || input.chunks.some((chunk) => !chunkExecutions.some((execution) => execution.chunkId === chunk.id))
    || synthesisExecutions.length !== 1
    || synthesisExecutions[0]?.chunkId !== null
    || new Set(input.executions.map((execution) => execution.candidateId)).size !== input.executions.length
    || !chunksCoverEveryCharacter
  ) {
    throw Object.assign(new Error("WHOLE_NOVEL_REVIEW_CONTRACT_INCOMPLETE"), {
      code: "WHOLE_NOVEL_REVIEW_CONTRACT_INCOMPLETE",
    });
  }
  const dimensions = Object.fromEntries(WHOLE_NOVEL_REVIEW_RUBRIC.map((rubric) => {
    const analysis = input.modelReview.dimensions[rubric.key];
    return [rubric.key, {
      ...analysis,
      label: rubric.label,
      weight: rubric.weight,
      weightedPoints: Math.round(analysis.score * rubric.weight) / 100,
    }];
  })) as WholeNovelReviewContract["dimensions"];
  const totalScore = Math.round(
    WHOLE_NOVEL_REVIEW_RUBRIC.reduce((total, rubric) => (
      total + input.modelReview.dimensions[rubric.key].score * rubric.weight
    ), 0),
  ) / 100;
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
  const synopsis = input.publicMetadata?.synopsis?.trim().slice(0, 1_200)
    || input.snapshot.project.coreIdea.value?.trim()
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
    outline: input.modelReview.outline,
    rubric: WHOLE_NOVEL_REVIEW_RUBRIC.map((rubric) => ({ ...rubric })),
    dimensions,
    totalScore,
    eligibleForPublicLounge: totalScore >= WHOLE_NOVEL_LOUNGE_THRESHOLD,
    editorialVerdict: input.modelReview.editorialVerdict,
    priorityRevisions: input.modelReview.priorityRevisions,
    loungeEligibility: {
      schemaVersion: WHOLE_NOVEL_LOUNGE_ELIGIBILITY_SCHEMA_VERSION,
      threshold: WHOLE_NOVEL_LOUNGE_THRESHOLD,
      eligible: totalScore >= WHOLE_NOVEL_LOUNGE_THRESHOLD,
      score: totalScore,
      reviewId,
      completionFingerprint: input.currentCompletionFingerprint,
      requiresCurrentMatchingCompletionFingerprint: true,
    },
    provenance: {
      mode: "verified-closed-ai",
      deterministicFallbackUsed: false,
      backendId: input.backendId,
      executions: input.executions,
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
      && value.publication?.autoPublished === false
      ? value as WholeNovelReviewContract
      : null;
  } catch {
    return null;
  }
}
