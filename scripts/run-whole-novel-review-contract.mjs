import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION,
  WHOLE_NOVEL_LOUNGE_THRESHOLD,
  WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION,
  WHOLE_NOVEL_REVIEW_RUBRIC,
  buildWholeNovelChunkContext,
  buildWholeNovelCompletionFingerprint,
  buildWholeNovelSynthesisContext,
  createWholeNovelCompletionDeclaration,
  createWholeNovelReviewContract,
  evaluateWholeNovelCompletionReadiness,
  loadWholeNovelCompletionDeclaration,
  loadWholeNovelReview,
  parseWholeNovelChunkAnalysis,
  parseWholeNovelModelReview,
  planWholeNovelReviewChunks,
  removeWholeNovelCompletionDeclaration,
  saveWholeNovelCompletionDeclaration,
  saveWholeNovelReview,
  verifiedWholeNovelReviewExecution,
} from "../lib/novel-ai/whole-novel-review.ts";

const project = {
  id: "project-whole-review",
  projectId: "project-whole-review",
  schemaVersion: "novel-domain-v1",
  revision: 7,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-28T12:00:00.000Z",
  deletedAt: null,
  provenance: { source: "user", actor: "author", createdAt: "2026-08-01T00:00:00.000Z" },
  title: "完整覆蓋測試小說",
  creationMode: "blank",
  genrePackId: "suspense",
  genreId: "mystery",
  subgenreId: "locked-room",
  coreIdea: { value: "一名調查員必須在封鎖解除前找出真兇。", source: "user_defined" },
  narrativeStyle: { value: "繁體中文懸疑", source: "user_defined" },
  adultMode: false,
  activeChapterId: "chapter-empty-next",
  storyBibleId: "bible-review",
  storyStateId: "state-review",
};

function chapter(id, order, content, status = "completed") {
  return {
    id,
    projectId: project.id,
    schemaVersion: "novel-domain-v1",
    revision: order + 2,
    createdAt: `2026-08-0${order}T00:00:00.000Z`,
    updatedAt: `2026-08-2${order}T00:00:00.000Z`,
    deletedAt: null,
    provenance: { source: "user", actor: "author", createdAt: "2026-08-01T00:00:00.000Z" },
    title: `第${order}章`,
    order,
    content,
    summary: null,
    status,
  };
}

const chapters = [
  chapter("chapter-1", 1, "第一章正文。".repeat(210)),
  chapter("chapter-2", 2, "第二章正文與真相。".repeat(160)),
  chapter("chapter-empty-next", 3, "", "draft"),
];
const snapshot = { project, chapters };

const readiness = evaluateWholeNovelCompletionReadiness(snapshot);
assert.equal(readiness.readyToDeclare, true);
assert.equal(readiness.substantiveChapterCount, 2);
assert.equal(readiness.completedChapterCount, 2);
assert.equal(readiness.ignoredEmptyDraftCount, 1);
assert.deepEqual(readiness.reasons, []);
assert.equal(evaluateWholeNovelCompletionReadiness({
  chapters: [chapters[0], { ...chapters[1], status: "draft" }],
}).readyToDeclare, false);

const fingerprint = await buildWholeNovelCompletionFingerprint(snapshot);
assert.match(fingerprint, /^[a-f0-9]{64}$/u);
assert.notEqual(
  await buildWholeNovelCompletionFingerprint({
    project,
    chapters: [{ ...chapters[0], content: `${chapters[0].content}改字` }, chapters[1]],
  }),
  fingerprint,
);

const declaration = createWholeNovelCompletionDeclaration({
  project,
  readiness,
  completionFingerprint: fingerprint,
  declaredAt: "2026-08-29T00:00:00.000Z",
});
assert.equal(declaration.basis, "author-declared-after-structural-gate");
assert.equal(declaration.trailingEmptyDraftsIgnored, true);

const chunks = planWholeNovelReviewChunks({ snapshot, maximumChunkCharacters: 1_000 });
assert.equal(chunks.length > chapters.filter((item) => item.content).length, true);
for (const sourceChapter of chapters.filter((item) => item.content)) {
  assert.equal(
    chunks.filter((item) => item.chapterId === sourceChapter.id).map((item) => item.text).join(""),
    sourceChapter.content,
  );
}
assert.match(buildWholeNovelChunkContext(chunks[0]), /SOURCE_TEXT_BEGIN/u);

const packets = chunks.map((chunk) => parseWholeNovelChunkAnalysis(JSON.stringify({
  schemaVersion: WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION,
  chunkId: chunk.id,
  chapterId: chunk.chapterId,
  chunkIndex: chunk.chunkIndex,
  summary: `${chunk.chapterTitle}片段摘要`,
  events: ["事件推進"],
  characterChanges: ["主角承擔代價"],
  canonSignals: ["物件狀態連貫"],
  pacingAndProse: ["節奏清楚"],
  foreshadowingAndPayoff: ["線索獲得回應"],
  endingState: "片段結束狀態",
}), chunk));
assert.throws(() => parseWholeNovelChunkAnalysis(JSON.stringify({
  ...packets[0],
  chunkId: "wrong",
}), chunks[0]), /WHOLE_NOVEL_CHUNK_IDENTITY_MISMATCH/u);

const synthesisContext = buildWholeNovelSynthesisContext({
  project,
  completionFingerprint: fingerprint,
  chunks,
  packets,
});
assert.match(synthesisContext, new RegExp(chunks.at(-1).id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
assert.throws(() => buildWholeNovelSynthesisContext({
  project,
  completionFingerprint: fingerprint,
  chunks,
  packets: packets.slice(1),
}), /WHOLE_NOVEL_COVERAGE_INCOMPLETE/u);

const scoreByDimension = {
  plot_coherence: 90,
  character_arcs: 80,
  world_canon_consistency: 70,
  pacing: 80,
  prose_dialogue: 90,
  foreshadowing_payoff: 70,
  ending: 90,
};
const modelReviewJson = {
  schemaVersion: WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION,
  outline: chapters.filter((item) => item.content).map((item) => ({
    chapterId: item.id,
    title: `模型亂改：${item.title}`,
    summary: `${item.title}的完整章節摘要`,
    keyTurn: `${item.title}的關鍵轉折`,
    endingState: `${item.title}的結束狀態`,
  })),
  dimensions: Object.fromEntries(WHOLE_NOVEL_REVIEW_RUBRIC.map((rubric) => [rubric.key, {
    score: scoreByDimension[rubric.key],
    evidence: [`${rubric.label}的章節短證據`],
    strengths: ["具體優點"],
    issues: ["可核對問題"],
    recommendations: ["優先修訂方向"],
  }])),
  editorialVerdict: "全書因果成立，但仍有可精修之處。",
  priorityRevisions: ["先修正世界規則交代", "再強化結局代價"],
};
const modelReview = parseWholeNovelModelReview(
  `\`\`\`json\n${JSON.stringify(modelReviewJson)}\n\`\`\``,
  chapters.filter((item) => item.content),
);
assert.equal(modelReview.outline[0].title, chapters[0].title);
assert.throws(() => parseWholeNovelModelReview(JSON.stringify({
  ...modelReviewJson,
  outline: modelReviewJson.outline.slice(1),
}), chapters.filter((item) => item.content)), /WHOLE_NOVEL_OUTLINE_COVERAGE_INCOMPLETE/u);

function verifiedExecution(stage, index, backendId = "browser-ai") {
  const contentDigest = String(index + 1).padStart(64, "a").slice(-64);
  const contextDigest = String(index + 1).padStart(64, "b").slice(-64);
  const modelDigest = "c".repeat(64);
  const candidate = {
    id: `candidate-${index}`,
    taskId: `task-${index}`,
    backendId,
    actualExecutor: backendId,
    modelId: "local-webllm-model",
    modelDigest,
    content: "模型輸出",
    contentDigest,
    candidateOnly: true,
    canonicalMutationCount: 0,
    status: "awaiting-approval",
    dataLeftDevice: false,
    externalRequest: false,
    cacheOrigin: null,
    executionReceipt: {
      taskId: `task-${index}`,
      backendId,
      actualExecutor: backendId,
      modelId: "local-webllm-model",
      modelDigest,
      contentDigest,
      contextDigest,
      proofState: "verified",
      outputCharacters: 4,
      dataLeftDevice: false,
      externalRequest: false,
    },
  };
  const result = { candidate, cache: { candidateHit: false } };
  return {
    result,
    proof: verifiedWholeNovelReviewExecution({
      result,
      expectedBackend: backendId,
      stage,
      chunkId: stage === "chunk-analysis" ? chunks[index]?.id : undefined,
    }),
  };
}

const executionRecords = chunks.map((chunk, index) => verifiedExecution("chunk-analysis", index).proof);
executionRecords.push(verifiedExecution("whole-book-synthesis", chunks.length).proof);
assert.equal(executionRecords.every(Boolean), true);
const mismatched = verifiedExecution("chunk-analysis", 0);
mismatched.result.candidate.actualExecutor = "local-ollama";
assert.equal(verifiedWholeNovelReviewExecution({
  result: mismatched.result,
  expectedBackend: "browser-ai",
  stage: "chunk-analysis",
  chunkId: chunks[0].id,
}), null);

const review = createWholeNovelReviewContract({
  reviewId: "whole-novel-review:test",
  generatedAt: "2026-08-29T01:00:00.000Z",
  snapshot,
  declaration,
  currentCompletionFingerprint: fingerprint,
  chunks,
  packets,
  modelReview,
  executions: executionRecords,
  backendId: "browser-ai",
  publicMetadata: {
    authorDisplayName: "測試作者",
    category: "懸疑／密室",
    synopsis: "公開書庫用的作品簡介。",
  },
});
assert.equal(review.totalScore, 82);
assert.equal(review.eligibleForPublicLounge, review.totalScore >= WHOLE_NOVEL_LOUNGE_THRESHOLD);
assert.equal(review.loungeEligibility.eligible, true);
assert.equal(review.dimensions.plot_coherence.weight, 20);
assert.equal(review.dimensions.plot_coherence.weightedPoints, 18);
assert.equal(review.publicMetadata.authorDisplayName, "測試作者");
assert.equal(review.publicMetadata.chapterCount, 2);
assert.equal(review.publicMetadata.completionStatus, "author-declared-complete");
assert.equal(review.publication.status, "not-published");
assert.equal(review.publication.autoPublished, false);
assert.equal(review.publication.optInRequired, true);
assert.equal(review.publication.publicationBackendConnected, false);
assert.equal(review.provenance.mode, "verified-closed-ai");
assert.equal(review.provenance.deterministicFallbackUsed, false);
assert.equal(review.privacy.rawNovelContentStoredInReview, false);
assert.doesNotMatch(JSON.stringify(review), new RegExp(chapters[0].content.slice(0, 500), "u"));

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const storage = memoryStorage();
saveWholeNovelCompletionDeclaration(declaration, storage);
saveWholeNovelReview(review, storage);
assert.equal(loadWholeNovelCompletionDeclaration(project.id, storage)?.completionFingerprint, fingerprint);
assert.equal(loadWholeNovelReview(project.id, storage)?.totalScore, 82);
removeWholeNovelCompletionDeclaration(project.id, storage);
assert.equal(loadWholeNovelCompletionDeclaration(project.id, storage), null);
assert.equal(loadWholeNovelReview(project.id, storage), null);

const [authorTools, workspace, panel, professional] = await Promise.all([
  readFile("lib/novel-ai/author-tools.ts", "utf8"),
  readFile("app/studio/project/[projectId]/author-tools/author-tools-workspace.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/author-tools/whole-novel-review-panel.tsx", "utf8"),
  readFile("app/professional/professional-client.tsx", "utf8"),
]);
assert.match(authorTools, /"completion-review"/u);
assert.match(workspace, /WholeNovelReviewPanel/u);
assert.match(workspace, /tool === "completion-review"/u);
assert.match(panel, /value="browser-ai"/u);
assert.match(panel, /taskType: "story\.chapterReview"/u);
assert.match(panel, /taskType: "story\.plotAnalysis"/u);
assert.match(panel, /verifiedWholeNovelReviewExecution/u);
assert.match(panel, /completionFingerprint/u);
assert.match(panel, /authorDisplayName/u);
assert.match(panel, /opt-in/u);
assert.doesNotMatch(panel, /approveStudioClosedAgentCandidate/u);
assert.match(professional, /authorToolHref\(project\.id, "completion-review"\)/u);

console.log(JSON.stringify({
  status: "PASS",
  schemaVersion: review.schemaVersion,
  fullContentCoverage: true,
  verifiedClosedBackends: ["browser-ai", "local-ollama", "private-ai-hub"],
  rubricWeightTotal: WHOLE_NOVEL_REVIEW_RUBRIC.reduce((sum, item) => sum + item.weight, 0),
  totalScore: review.totalScore,
  eligibleForPublicLounge: review.eligibleForPublicLounge,
  autoPublished: review.publication.autoPublished,
  deterministicFallbackUsed: review.provenance.deterministicFallbackUsed,
}, null, 2));
