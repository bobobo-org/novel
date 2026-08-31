import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION,
  WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD,
  WHOLE_NOVEL_LOUNGE_THRESHOLD,
  WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION,
  WHOLE_NOVEL_PRIMARY_JUDGE_ROLES,
  WHOLE_NOVEL_REVIEW_RUBRIC,
  aggregateWholeNovelModelReviews,
  buildWholeNovelChunkContext,
  buildWholeNovelChunkReviewObjective,
  buildWholeNovelCompletionFingerprint,
  buildWholeNovelSynthesisContext,
  buildWholeNovelSynthesisObjective,
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
  wholeNovelModelReviewTotalScore,
  wholeNovelReviewScoreSpread,
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
const snapshot = {
  project,
  chapters,
  storyBible: { id: "bible-review", revision: 3, premise: "封港前找出真兇" },
  storyState: { id: "state-review", revision: 4, locationState: "封鎖中的港口" },
  characters: [{ id: "character-investigator", revision: 2, name: "沈遙", goal: "查明真相" }],
  relationships: [{ id: "relationship-investigator-doctor", revision: 1, summary: "互相試探" }],
  worldRules: [{ id: "rule-lockdown", revision: 2, statement: "午夜前不得離港" }],
  timeline: [{ id: "event-lighthouse", revision: 5, summary: "燈塔重新亮起" }],
  worlds: [{ id: "world-fog-harbor", revision: 1, name: "霧港" }],
  offstageCharacterNames: ["港務長"],
};

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
for (const mutateContext of [
  (candidate) => { candidate.storyBible.premise = "封港前找出失蹤航線"; },
  (candidate) => { candidate.storyState.locationState = "燈塔地下室"; },
  (candidate) => { candidate.characters[0].goal = "保護證人"; },
  (candidate) => { candidate.relationships[0].summary = "正式結盟"; },
  (candidate) => { candidate.worldRules[0].statement = "日出前不得離港"; },
  (candidate) => { candidate.timeline[0].summary = "燈塔永久熄滅"; },
  (candidate) => { candidate.worlds[0].name = "新霧港"; },
  (candidate) => { candidate.offstageCharacterNames[0] = "副港務長"; },
]) {
  const changedContext = structuredClone(snapshot);
  mutateContext(changedContext);
  assert.notEqual(await buildWholeNovelCompletionFingerprint(changedContext), fingerprint);
}

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

const packets = WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.flatMap((judgeRole) => chunks.map((chunk) => (
  parseWholeNovelChunkAnalysis(JSON.stringify({
    schemaVersion: WHOLE_NOVEL_CHUNK_ANALYSIS_SCHEMA_VERSION,
    judgeRole,
    chunkId: chunk.id,
    chapterId: chunk.chapterId,
    chunkIndex: chunk.chunkIndex,
    summary: `${judgeRole}：${chunk.chapterTitle}片段摘要`,
    events: [`${judgeRole}：事件推進`],
    characterChanges: [`${judgeRole}：主角承擔代價`],
    canonSignals: [`${judgeRole}：物件狀態連貫`],
    pacingAndProse: [`${judgeRole}：節奏清楚`],
    foreshadowingAndPayoff: [`${judgeRole}：線索獲得回應`],
    endingState: `${judgeRole}：片段結束狀態`,
  }), chunk, judgeRole)
)));
assert.equal(packets.length, chunks.length * WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.length);
for (const judgeRole of WHOLE_NOVEL_PRIMARY_JUDGE_ROLES) {
  assert.equal(packets.filter((packet) => packet.judgeRole === judgeRole).length, chunks.length);
  assert.match(
    buildWholeNovelChunkReviewObjective(project.title, chunks[0], judgeRole),
    new RegExp(`judgeRole 必須原樣輸出為 ${judgeRole}`, "u"),
  );
}
assert.throws(() => parseWholeNovelChunkAnalysis(JSON.stringify({
  ...packets[0],
  chunkId: "wrong",
}), chunks[0], packets[0].judgeRole), /WHOLE_NOVEL_CHUNK_IDENTITY_MISMATCH/u);
assert.throws(() => parseWholeNovelChunkAnalysis(JSON.stringify({
  ...packets[0],
  judgeRole: "continuity-editor",
}), chunks[0], "literary-editor"), /WHOLE_NOVEL_CHUNK_IDENTITY_MISMATCH/u);

const literaryPackets = packets.filter((packet) => packet.judgeRole === "literary-editor");
const synthesisContext = buildWholeNovelSynthesisContext({
  project,
  completionFingerprint: fingerprint,
  chunks,
  packets: literaryPackets,
  judgeRole: "literary-editor",
});
assert.match(synthesisContext, new RegExp(chunks.at(-1).id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
assert.match(synthesisContext, /"judgeRole":"literary-editor"/u);
assert.doesNotMatch(synthesisContext, /continuity-editor/u);
const arbitrationContext = buildWholeNovelSynthesisContext({
  project,
  completionFingerprint: fingerprint,
  chunks,
  packets,
  judgeRole: "score-arbitrator",
});
for (const judgeRole of WHOLE_NOVEL_PRIMARY_JUDGE_ROLES) {
  assert.match(arbitrationContext, new RegExp(judgeRole, "u"));
}
assert.throws(() => buildWholeNovelSynthesisContext({
  project,
  completionFingerprint: fingerprint,
  chunks,
  packets: literaryPackets.slice(1),
  judgeRole: "literary-editor",
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
const passedCompliance = {
  publicSafetyPassed: true,
  completenessPassed: true,
  privacyCopyrightPassed: true,
  hiddenDraftResidueDetected: false,
  matureContentDetected: false,
  reasons: ["完整覆蓋且未見隱私或著作權殘留"],
};
function modelReviewPayload(judgeRole, scores = scoreByDimension, compliance = passedCompliance) {
  return {
    schemaVersion: WHOLE_NOVEL_MODEL_REVIEW_SCHEMA_VERSION,
    judgeRole,
    outline: chapters.filter((item) => item.content).map((item) => ({
      chapterId: item.id,
      title: `模型亂改：${item.title}`,
      summary: `${item.title}的完整章節摘要`,
      keyTurn: `${item.title}的關鍵轉折`,
      endingState: `${item.title}的結束狀態`,
    })),
    dimensions: Object.fromEntries(WHOLE_NOVEL_REVIEW_RUBRIC.map((rubric) => [rubric.key, {
      score: scores[rubric.key],
      evidence: [`${judgeRole}：${rubric.label}的章節短證據`],
      strengths: [`${judgeRole}：具體優點`],
      issues: [`${judgeRole}：可核對問題`],
      recommendations: [`${judgeRole}：優先修訂方向`],
    }])),
    compliance,
    editorialVerdict: `${judgeRole}：全書因果成立，但仍有可精修之處。`,
    priorityRevisions: [`${judgeRole}：先修正世界規則交代`, "共同：再強化結局代價"],
  };
}
function parsedJudge(judgeRole, delta = 0, scores = null, compliance = passedCompliance) {
  const adjusted = scores ?? Object.fromEntries(Object.entries(scoreByDimension).map(([key, score]) => [
    key,
    score + delta,
  ]));
  return parseWholeNovelModelReview(
    `\`\`\`json\n${JSON.stringify(modelReviewPayload(judgeRole, adjusted, compliance))}\n\`\`\``,
    chapters.filter((item) => item.content),
    judgeRole,
  );
}
const primaryJudgeReviews = [
  parsedJudge("literary-editor", 0),
  parsedJudge("continuity-editor", 2),
  parsedJudge("genre-reader", -2),
];
const aggregation = aggregateWholeNovelModelReviews(primaryJudgeReviews);
const modelReview = aggregation.modelReview;
assert.equal(modelReview.outline[0].title, chapters[0].title);
assert.equal(modelReview.judgeRole, "aggregate");
assert.equal(modelReview.dimensions.plot_coherence.score, 90);
for (const judgeRole of WHOLE_NOVEL_PRIMARY_JUDGE_ROLES) {
  assert.ok(modelReview.editorialVerdict.includes(judgeRole));
  assert.ok(modelReview.dimensions.plot_coherence.strengths.some((item) => item.includes(judgeRole)));
  assert.ok(modelReview.dimensions.plot_coherence.issues.some((item) => item.includes(judgeRole)));
  assert.ok(modelReview.priorityRevisions.some((item) => item.includes(judgeRole)));
}
assert.equal(
  modelReview.priorityRevisions.filter((item) => item === "共同：再強化結局代價").length,
  1,
);
assert.equal(wholeNovelReviewScoreSpread(primaryJudgeReviews), 4);
assert.equal(aggregation.arbitrationRequired, false);
assert.match(buildWholeNovelSynthesisObjective({
  projectTitle: project.title,
  completionFingerprint: fingerprint,
  chapterIds: chapters.filter((item) => item.content).map((item) => item.id),
  judgeRole: "continuity-editor",
}), /judgeRole 必須原樣輸出為 continuity-editor/u);
assert.match(buildWholeNovelSynthesisObjective({
  projectTitle: project.title,
  completionFingerprint: fingerprint,
  chapterIds: chapters.filter((item) => item.content).map((item) => item.id),
  judgeRole: "score-arbitrator",
  primaryReviews: primaryJudgeReviews,
}), /三位初審的精簡分數卡/u);
assert.throws(() => buildWholeNovelSynthesisObjective({
  projectTitle: project.title,
  completionFingerprint: fingerprint,
  chapterIds: chapters.filter((item) => item.content).map((item) => item.id),
  judgeRole: "score-arbitrator",
}), /WHOLE_NOVEL_JUDGE_SET_INVALID/u);
assert.throws(() => parseWholeNovelModelReview(JSON.stringify({
  ...modelReviewPayload("literary-editor"),
  outline: modelReviewPayload("literary-editor").outline.slice(1),
}), chapters.filter((item) => item.content), "literary-editor"), /WHOLE_NOVEL_OUTLINE_COVERAGE_INCOMPLETE/u);
assert.throws(() => parseWholeNovelModelReview(JSON.stringify({
  ...modelReviewPayload("literary-editor"),
  compliance: { ...passedCompliance, completenessPassed: "yes" },
}), chapters.filter((item) => item.content), "literary-editor"), /WHOLE_NOVEL_COMPLIANCE_INVALID/u);
assert.throws(() => parseWholeNovelModelReview(
  JSON.stringify(modelReviewPayload("literary-editor")),
  chapters.filter((item) => item.content),
  "genre-reader",
), /WHOLE_NOVEL_MODEL_SCHEMA_INVALID/u);

function verifiedExecution(
  stage,
  index,
  backendId = "browser-ai",
  judgeRole = undefined,
  sourceChunk = undefined,
) {
  const contentDigest = String(index + 1).padStart(64, "a").slice(-64);
  const contextDigest = String(index + 1).padStart(64, "b").slice(-64);
  const modelDigest = "c".repeat(64);
  const candidate = {
    id: `candidate-${index}`,
    taskId: `task-${index}`,
    backendId,
    actualExecutor: backendId,
    modelId: judgeRole ? `local-webllm-${judgeRole}` : "local-webllm-chunk-reader",
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
      modelId: judgeRole ? `local-webllm-${judgeRole}` : "local-webllm-chunk-reader",
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
      chunkId: stage === "chunk-analysis" ? sourceChunk?.id : undefined,
      judgeRole,
    }),
  };
}

const executionRecords = WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.flatMap((judgeRole, judgeIndex) => (
  chunks.map((chunk, chunkIndex) => verifiedExecution(
    "chunk-analysis",
    judgeIndex * chunks.length + chunkIndex,
    "browser-ai",
    judgeRole,
    chunk,
  ).proof)
));
for (const [index, judgeRole] of WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.entries()) {
  executionRecords.push(verifiedExecution(
    "whole-book-synthesis",
    chunks.length * WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.length + index,
    "browser-ai",
    judgeRole,
  ).proof);
}
assert.equal(executionRecords.every(Boolean), true);
assert.equal(
  executionRecords.filter((item) => item.stage === "chunk-analysis").length,
  chunks.length * WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.length,
);
for (const judgeRole of WHOLE_NOVEL_PRIMARY_JUDGE_ROLES) {
  assert.equal(
    executionRecords.filter((item) => (
      item.stage === "chunk-analysis" && item.judgeRole === judgeRole
    )).length,
    chunks.length,
  );
}
const mismatched = verifiedExecution(
  "chunk-analysis",
  0,
  "browser-ai",
  "literary-editor",
  chunks[0],
);
mismatched.result.candidate.actualExecutor = "local-ollama";
assert.equal(verifiedWholeNovelReviewExecution({
  result: mismatched.result,
  expectedBackend: "browser-ai",
  stage: "chunk-analysis",
  chunkId: chunks[0].id,
  judgeRole: "literary-editor",
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
  judgeReviews: primaryJudgeReviews,
  executions: executionRecords,
  backendId: "browser-ai",
  publicMetadata: {
    authorDisplayName: "測試作者",
    category: "懸疑／密室",
    synopsis: "公開書庫用的作品簡介。",
  },
});
assert.equal(review.totalScore, 82);
assert.equal(review.eligibleForPublicLounge, true);
assert.equal(review.loungeEligibility.eligible, true);
assert.equal(review.loungeEligibility.hardGatePassed, true);
assert.equal(review.loungeEligibility.compliancePassed, true);
assert.equal(review.loungeEligibility.criticalDimensionsPassed, true);
assert.equal(review.loungeEligibility.criticalDimensionThreshold, WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD);
assert.deepEqual(review.loungeEligibility.blockingReasons, []);
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
assert.equal(review.provenance.judges.length, 3);
assert.equal(review.provenance.aggregation.method, "per-dimension-median");
assert.equal(review.provenance.aggregation.primaryScoreSpread, 4);
assert.equal(review.provenance.aggregation.arbitrationRequired, false);
assert.equal(review.provenance.aggregation.arbitrationPerformed, false);
assert.equal(review.privacy.rawNovelContentStoredInReview, false);
assert.doesNotMatch(JSON.stringify(review), new RegExp(chapters[0].content.slice(0, 500), "u"));
assert.throws(() => createWholeNovelReviewContract({
  reviewId: "whole-novel-review:missing-role-packet",
  generatedAt: "2026-08-29T01:01:00.000Z",
  snapshot,
  declaration,
  currentCompletionFingerprint: fingerprint,
  chunks,
  packets: packets.filter((packet) => !(
    packet.judgeRole === "genre-reader" && packet.chunkId === chunks.at(-1).id
  )),
  modelReview,
  judgeReviews: primaryJudgeReviews,
  executions: executionRecords,
  backendId: "browser-ai",
}), /WHOLE_NOVEL_REVIEW_CONTRACT_INCOMPLETE/u);
assert.throws(() => createWholeNovelReviewContract({
  reviewId: "whole-novel-review:missing-role-execution",
  generatedAt: "2026-08-29T01:02:00.000Z",
  snapshot,
  declaration,
  currentCompletionFingerprint: fingerprint,
  chunks,
  packets,
  modelReview,
  judgeReviews: primaryJudgeReviews,
  executions: executionRecords.filter((execution) => !(
    execution.stage === "chunk-analysis"
    && execution.judgeRole === "continuity-editor"
    && execution.chunkId === chunks[0].id
  )),
  backendId: "browser-ai",
}), /WHOLE_NOVEL_REVIEW_CONTRACT_INCOMPLETE/u);

const uniformScores = (score, overrides = {}) => Object.fromEntries(
  WHOLE_NOVEL_REVIEW_RUBRIC.map((rubric) => [rubric.key, overrides[rubric.key] ?? score]),
);
const widePrimaryReviews = [
  parsedJudge("literary-editor", 0, uniformScores(55)),
  parsedJudge("continuity-editor", 0, uniformScores(82)),
  parsedJudge("genre-reader", 0, uniformScores(96)),
];
assert.equal(wholeNovelReviewScoreSpread(widePrimaryReviews), 41);
assert.throws(() => aggregateWholeNovelModelReviews(widePrimaryReviews), /WHOLE_NOVEL_ARBITRATION_REQUIRED/u);
const arbitrationJudge = parsedJudge("score-arbitrator", 0, uniformScores(84));
const arbitratedReviews = [...widePrimaryReviews, arbitrationJudge];
const arbitratedAggregation = aggregateWholeNovelModelReviews(arbitratedReviews);
assert.equal(arbitratedAggregation.arbitrationRequired, true);
assert.deepEqual(arbitratedAggregation.selectedJudgeRoles, [
  "score-arbitrator",
  "continuity-editor",
  "genre-reader",
]);
assert.equal(arbitratedAggregation.modelReview.dimensions.plot_coherence.score, 84);
assert.equal(wholeNovelModelReviewTotalScore(arbitratedAggregation.modelReview), 84);
const arbitrationExecutionRecords = WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.flatMap((judgeRole, judgeIndex) => (
  chunks.map((chunk, chunkIndex) => verifiedExecution(
    "chunk-analysis",
    judgeIndex * chunks.length + chunkIndex,
    "browser-ai",
    judgeRole,
    chunk,
  ).proof)
));
for (const [index, judgeRole] of WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.entries()) {
  arbitrationExecutionRecords.push(verifiedExecution(
    "whole-book-synthesis",
    chunks.length * WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.length + index,
    "browser-ai",
    judgeRole,
  ).proof);
}
arbitrationExecutionRecords.push(verifiedExecution(
  "whole-book-arbitration",
  chunks.length * WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.length
    + WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.length,
  "browser-ai",
  "score-arbitrator",
).proof);
const arbitratedContract = createWholeNovelReviewContract({
  reviewId: "whole-novel-review:arbitrated",
  generatedAt: "2026-08-29T01:10:00.000Z",
  snapshot,
  declaration,
  currentCompletionFingerprint: fingerprint,
  chunks,
  packets,
  modelReview: arbitratedAggregation.modelReview,
  judgeReviews: arbitratedReviews,
  executions: arbitrationExecutionRecords,
  backendId: "browser-ai",
});
assert.equal(arbitratedContract.totalScore, 84);
assert.equal(arbitratedContract.provenance.aggregation.arbitrationPerformed, true);
assert.equal(arbitratedContract.provenance.judges.length, 4);

const privacyFailedReviews = [
  parsedJudge("literary-editor", 0, uniformScores(90)),
  parsedJudge("continuity-editor", 0, uniformScores(90), {
    ...passedCompliance,
    privacyCopyrightPassed: false,
    reasons: ["偵測到未釐清權利來源"],
  }),
  parsedJudge("genre-reader", 0, uniformScores(90)),
];
const privacyFailedAggregation = aggregateWholeNovelModelReviews(privacyFailedReviews);
const privacyFailedContract = createWholeNovelReviewContract({
  reviewId: "whole-novel-review:privacy-gate",
  generatedAt: "2026-08-29T01:20:00.000Z",
  snapshot,
  declaration,
  currentCompletionFingerprint: fingerprint,
  chunks,
  packets,
  modelReview: privacyFailedAggregation.modelReview,
  judgeReviews: privacyFailedReviews,
  executions: executionRecords,
  backendId: "browser-ai",
});
assert.equal(privacyFailedContract.totalScore, 90);
assert.equal(privacyFailedContract.eligibleForPublicLounge, false);
assert.equal(privacyFailedContract.loungeEligibility.compliancePassed, false);
assert.ok(privacyFailedContract.loungeEligibility.blockingReasons.includes("privacy_copyright_failed"));

const criticalScores = uniformScores(100, { plot_coherence: 59 });
const criticalFailedReviews = WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.map((role) => (
  parsedJudge(role, 0, criticalScores)
));
const criticalFailedAggregation = aggregateWholeNovelModelReviews(criticalFailedReviews);
const criticalFailedContract = createWholeNovelReviewContract({
  reviewId: "whole-novel-review:critical-gate",
  generatedAt: "2026-08-29T01:30:00.000Z",
  snapshot,
  declaration,
  currentCompletionFingerprint: fingerprint,
  chunks,
  packets,
  modelReview: criticalFailedAggregation.modelReview,
  judgeReviews: criticalFailedReviews,
  executions: executionRecords,
  backendId: "browser-ai",
});
assert.equal(criticalFailedContract.totalScore > WHOLE_NOVEL_LOUNGE_THRESHOLD, true);
assert.equal(criticalFailedContract.eligibleForPublicLounge, false);
assert.equal(criticalFailedContract.loungeEligibility.criticalDimensionsPassed, false);
assert.ok(criticalFailedContract.loungeEligibility.blockingReasons.includes(
  `critical_dimension_below_${WHOLE_NOVEL_CRITICAL_DIMENSION_THRESHOLD}:plot_coherence`,
));

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
saveWholeNovelReview({
  ...privacyFailedContract,
  eligibleForPublicLounge: true,
  loungeEligibility: {
    ...privacyFailedContract.loungeEligibility,
    eligible: true,
  },
}, storage);
assert.equal(loadWholeNovelReview(project.id, storage), null);
const forgedGatePass = structuredClone(review);
forgedGatePass.provenance.judges[0].compliance.privacyCopyrightPassed = false;
saveWholeNovelReview(forgedGatePass, storage);
assert.equal(loadWholeNovelReview(project.id, storage), null);
const forgedCriticalPass = structuredClone(review);
forgedCriticalPass.dimensions.plot_coherence.score = 59;
forgedCriticalPass.dimensions.plot_coherence.weightedPoints = 11.8;
forgedCriticalPass.totalScore = Math.round((
  forgedCriticalPass.rubric.reduce((total, rubric) => (
    total + forgedCriticalPass.dimensions[rubric.key].score * rubric.weight
  ), 0)
) * 100) / 10_000;
forgedCriticalPass.loungeEligibility.score = forgedCriticalPass.totalScore;
saveWholeNovelReview(forgedCriticalPass, storage);
assert.equal(loadWholeNovelReview(project.id, storage), null);
saveWholeNovelReview(review, storage);
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
assert.match(panel, /WHOLE_NOVEL_PRIMARY_JUDGE_ROLES/u);
assert.match(panel, /for \(const \[judgeIndex, judgeRole\] of WHOLE_NOVEL_PRIMARY_JUDGE_ROLES\.entries\(\)\)/u);
assert.match(panel, /buildWholeNovelChunkReviewObjective\(snapshot\.project\.title, chunk, judgeRole\)/u);
assert.match(panel, /parseWholeNovelChunkAnalysis\([\s\S]*judgeRole,[\s\S]*\)/u);
assert.match(panel, /packet\.judgeRole === judgeRole/u);
assert.match(panel, /score-arbitrator/u);
assert.match(panel, /judgeReviews: modelReviews/u);
assert.match(panel, /wholeNovelReviewScoreSpread\(modelReviews\) > 10/u);
assert.match(panel, /blockingReasons/u);
assert.match(panel, /reviewCurrent=\{reviewCurrent && review\.eligibleForPublicLounge\}/u);
assert.match(panel, /completionFingerprint/u);
assert.match(panel, /maxLength=\{PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS\}/u);
assert.match(panel, /authorDisplayName/u);
assert.match(panel, /opt-in/u);
assert.doesNotMatch(panel, /approveStudioClosedAgentCandidate/u);
assert.match(professional, /authorToolHref\(project\.id, "completion-review"\)/u);

console.log(JSON.stringify({
  status: "PASS",
  schemaVersion: review.schemaVersion,
  fullContentCoverage: true,
  independentRoleChunkPasses: WHOLE_NOVEL_PRIMARY_JUDGE_ROLES.length,
  verifiedClosedBackends: ["browser-ai", "local-ollama", "private-ai-hub"],
  rubricWeightTotal: WHOLE_NOVEL_REVIEW_RUBRIC.reduce((sum, item) => sum + item.weight, 0),
  totalScore: review.totalScore,
  primaryJudgeCount: review.provenance.aggregation.primaryJudgeCount,
  arbitrationGateVerified: arbitratedContract.provenance.aggregation.arbitrationPerformed,
  complianceHardGateVerified: !privacyFailedContract.eligibleForPublicLounge,
  criticalDimensionHardGateVerified: !criticalFailedContract.eligibleForPublicLounge,
  eligibleForPublicLounge: review.eligibleForPublicLounge,
  autoPublished: review.publication.autoPublished,
  deterministicFallbackUsed: review.provenance.deterministicFallbackUsed,
}, null, 2));
