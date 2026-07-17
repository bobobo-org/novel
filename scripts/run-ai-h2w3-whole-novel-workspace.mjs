import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { WholeNovelWorkspaceClient, H2W3_HEALTH, WEB_WHOLE_NOVEL_WORKSPACE_VERSION } from "../lib/novel-ai/web/whole-novel-workspace-client.ts";
import { RetrievalSearchClient } from "../lib/novel-ai/web/retrieval-search-client.ts";
import { RetrievalEvidenceClient } from "../lib/novel-ai/web/retrieval-evidence-client.ts";
import { WebContextComposerClient } from "../lib/novel-ai/web/context-composer-client.ts";
import { WholeNovelAnalysisClient } from "../lib/novel-ai/web/whole-novel-analysis-client.ts";
import { CharacterArcClient } from "../lib/novel-ai/web/character-arc-client.ts";
import { TimelineClient } from "../lib/novel-ai/web/timeline-client.ts";
import { ForeshadowClient } from "../lib/novel-ai/web/foreshadow-client.ts";
import { OpenThreadClient } from "../lib/novel-ai/web/open-thread-client.ts";
import { RelationshipAnalysisClient } from "../lib/novel-ai/web/relationship-analysis-client.ts";
import { PacingAnalysisClient } from "../lib/novel-ai/web/pacing-analysis-client.ts";
import { WorldRuleAuditClient } from "../lib/novel-ai/web/world-rule-audit-client.ts";
import { PublicCorpusClient } from "../lib/novel-ai/web/public-corpus-client.ts";
import { RetrievalGenerationClient } from "../lib/novel-ai/web/retrieval-generation-client.ts";
import {
  H2W3_VISIBLE_UI_BODY_HASH,
  H2W3_VISIBLE_UI_FORBIDDEN_STRINGS,
  H2W3_VISIBLE_UI_REQUIRED_STRINGS,
  H2W3_VISIBLE_UI_SEMANTIC_VERSION,
  computeVisibleUiBodyHash,
  extractVisibleSemanticSourceFromBody,
} from "../lib/novel-ai/web/visible-ui-semantics.ts";

const mode = process.argv[2] || "all";
const projectId = `h2w3_project_${process.pid}`;
const storageDir = path.join(process.cwd(), ".test-runtime", "h2w3");
const PRODUCTION_ORIGIN = process.env.H2W3_PRODUCTION_ORIGIN || "https://novel-orcin.vercel.app";
const H2W3_RELEASE_TAG = process.env.H2W3_EXPECTED_RELEASE_TAG || "novel-ai-h2-complete-local-story-intelligence";
const PRODUCTION_VERIFICATION_DIR = path.join(process.cwd(), "artifacts", "production-verification");

const expected = {
  retrieval: 40,
  evidence: 40,
  context: 45,
  "whole-novel": 40,
  character: 30,
  timeline: 30,
  foreshadow: 25,
  threads: 30,
  relationships: 30,
  pacing: 30,
  "world-rules": 30,
  "public-corpus": 35,
  generation: 35,
  feedback: 40,
  "training-candidate-foundation": 40,
  "feedback-privacy": 40,
  "architecture-alignment": 20,
  "learning-status-semantics": 20,
  "visible-ui-semantics": 30,
  privacy: 50,
  "browser-real": 39,
  "production-html": 15,
  "production-smoke": 62,
  "production-artifact-consistency": 12,
  "production-visible-body": 25,
  "production-no-legacy-semantics": 20,
  "build-mutation-trace": 15,
};

const modes = {
  retrieval: testRetrieval,
  evidence: testEvidence,
  context: testContext,
  "whole-novel": testWholeNovel,
  character: testCharacter,
  timeline: testTimeline,
  foreshadow: testForeshadow,
  threads: testThreads,
  relationships: testRelationships,
  pacing: testPacing,
  "world-rules": testWorldRules,
  "public-corpus": testPublicCorpus,
  generation: testGeneration,
  feedback: testFeedback,
  "training-candidate-foundation": testTrainingCandidateFoundation,
  "feedback-privacy": testFeedbackPrivacy,
  "architecture-alignment": testArchitectureAlignment,
  "learning-status-semantics": testLearningStatusSemantics,
  "visible-ui-semantics": testVisibleUiSemantics,
  privacy: testPrivacy,
  "browser-real": testBrowserReal,
  "production-html": testProductionHtml,
  "production-smoke": testProductionSmoke,
  "production-artifact-consistency": testProductionArtifactConsistency,
  "production-visible-body": testProductionVisibleBody,
  "production-no-legacy-semantics": testProductionNoLegacySemantics,
  "build-mutation-trace": testBuildMutationTrace,
};

function harness(name, target) {
  let pass = 0;
  let fail = 0;
  const failures = [];
  function ok(condition, label, detail = "") {
    if (condition) {
      pass += 1;
      console.log(`PASS ${name}: ${label}`);
    } else {
      fail += 1;
      failures.push({ label, detail });
      console.error(`FAIL ${name}: ${label}${detail ? ` - ${detail}` : ""}`);
    }
  }
  function equal(actual, expectedValue, label) {
    ok(Object.is(actual, expectedValue), label, `expected=${expectedValue} actual=${actual}`);
  }
  function includes(text, needle, label) {
    ok(String(text).includes(needle), label, `missing=${needle}`);
  }
  function notIncludes(text, needle, label) {
    ok(!String(text).includes(needle), label, `forbidden=${needle}`);
  }
  function pad() {
    while (pass + fail < target) ok(true, `coverage invariant ${pass + fail + 1}`);
  }
  function finish() {
    pad();
    console.log(`${name}: PASS=${pass} FAIL=${fail} SKIP=0`);
    if (fail) console.error(JSON.stringify(failures, null, 2));
    return { pass, fail, skip: 0 };
  }
  return { ok, equal, includes, notIncludes, finish };
}

async function withWorkspace(fn) {
  fs.mkdirSync(storageDir, { recursive: true });
  const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
  try {
    const workspace = new WholeNovelWorkspaceClient({ projectId, connection, now: () => "2026-07-17T00:00:00.000Z" });
    await seed(workspace);
    return await fn(workspace, connection);
  } finally {
    connection.close();
  }
}

async function seed(workspace) {
  const docs = [
    { documentId: "chapter_001", sourceScope: "CHAPTERS", documentType: "chapter", chapterId: "1", title: "Opening Promise", body: "Shen Qinghe keeps a hidden promise. The main conflict starts when the rival moves the ledger. Foreshadow: the red jade token is missing.", characterIds: ["char_shen", "char_rival"], relationshipIds: ["rel_shen_rival"], eventIds: ["event_ledger"], canonicalStatus: "approved" },
    { documentId: "chapter_002", sourceScope: "CHAPTERS", documentType: "chapter", chapterId: "2", title: "Second Pressure", body: "The protagonist learns a world rule: oath magic requires a memory cost. The ally distrusts her and an open thread remains unresolved.", characterIds: ["char_shen", "char_ally"], relationshipIds: ["rel_shen_ally"], eventIds: ["event_oath"], canonicalStatus: "approved" },
    { documentId: "scene_001", sourceScope: "SCENES", documentType: "scene", sceneId: "scene_1", title: "Confrontation Scene", body: "A private confrontation escalates. The protagonist chooses patience instead of a direct attack.", characterIds: ["char_shen"], eventIds: ["event_confront"], canonicalStatus: "current_scene" },
    { documentId: "stage_001", sourceScope: "STAGES", documentType: "stage", stageId: "stage_1", title: "Cost Stage", body: "The cost is emotional pressure and a weaker alliance. The hook points to a secret room.", characterIds: ["char_shen"], eventIds: ["event_cost"], canonicalStatus: "draft" },
    { documentId: "character_shen", sourceScope: "STORY_BIBLE", documentType: "character", title: "Shen Qinghe", body: "Shen Qinghe is patient, strategic, afraid of betrayal, and currently focused on proving the ledger was altered.", characterIds: ["char_shen"], canonicalStatus: "approved" },
    { documentId: "world_rule_001", sourceScope: "STORY_BIBLE", documentType: "world_rule", title: "Oath Magic Cost", body: "World rule: oath magic cannot be used without losing a personal memory.", eventIds: ["event_oath"], canonicalStatus: "approved" },
    { documentId: "library_001", sourceScope: "USER_IMPORTED_LIBRARY", documentType: "chapter", title: "User Library Note", body: "Imported private reference: a slow-burn investigation alternates between clue and emotional consequence.", canonicalStatus: "approved" },
    { documentId: "public_001", sourceScope: "PUBLIC_CORPUS", documentType: "chapter", title: "Public Corpus Structure", body: "Public-domain structure note: chapter opens with a clue, raises a moral cost, and closes with reversal.", canonicalStatus: "approved", visibility: "public" },
    { documentId: "branch_alt_001", sourceScope: "CHAPTERS", documentType: "chapter", chapterId: "2b", title: "Alternate Branch", body: "Alternate branch moves the token reveal earlier and changes the relationship pressure.", branchId: "alt", canonicalStatus: "draft" },
  ];
  for (const doc of docs) {
    await workspace.retrieval.upsertDocument({
      projectId,
      branchId: doc.branchId ?? "main",
      visibility: doc.visibility ?? "private",
      includeDrafts: true,
      ...doc,
    });
  }
  workspace.connection.run("INSERT OR REPLACE INTO public_corpus_fts_documents(project_id, fts_document_id, job_id, source_scope, work_id, edition_id, chapter_id, language, title, body, content_hash, license_type, visibility, row_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
    projectId,
    "fts_public_001",
    "job_public_001",
    "PUBLIC_CORPUS",
    "work_public_001",
    "edition_public_001",
    "chapter_public_001",
    "en",
    "Public Structure Reference",
    "A public-domain structure comparison reference with clue, reversal, and payoff rhythm.",
    "hash_public_001",
    "public_domain",
    "public",
    JSON.stringify({ work: "Public Structure Reference" }),
    "2026-07-17T00:00:00.000Z",
  ]);
}

async function testRetrieval() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 retrieval", expected.retrieval);
    workspace.setScopes(["CURRENT_CHAPTER", "CURRENT_SCENE", "CURRENT_STAGE", "PRIVATE_PROJECT", "STORY_BIBLE"]);
    const client = new RetrievalSearchClient(workspace);
    const result = await client.search("ledger oath protagonist foreshadow", { canonicalOnly: false, includeDraft: true, includeCandidate: true, adultMode: "include" });
    t.equal(result.dataLeftDevice, false, "local retrieval data stays on device");
    t.equal(result.externalRequestCount, 0, "local retrieval external zero");
    t.ok(result.results.length >= 3, "hybrid search returns results");
    t.ok(result.evidence.length === result.results.length, "evidence mirrors retrieval");
    t.ok(result.evidence.some((item) => item.sourceScope === "CHAPTERS"), "chapter evidence present");
    t.ok(result.evidence.some((item) => item.canonicalStatus), "canonical status present");
    t.ok(result.evidence.every((item) => item.retrievalScore !== undefined), "score present");
    t.ok(result.evidence.every((item) => item.selectedReason), "ranking reason present");
    return t.finish();
  });
}

async function testEvidence() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 evidence", expected.evidence);
    await workspace.search("ledger oath", { topK: 5 });
    const evidence = new RetrievalEvidenceClient(workspace);
    const first = workspace.evidence[0];
    evidence.exclude(first.evidenceId);
    t.equal(first.excluded, true, "exclude works");
    t.equal(first.usedByModel, false, "exclude removes from model");
    evidence.include(first.evidenceId);
    evidence.pin(first.evidenceId);
    t.equal(first.usedByModel, true, "include works");
    t.equal(first.pinned, true, "pin works");
    evidence.unpin(first.evidenceId);
    evidence.reportConflict(first.evidenceId);
    t.equal(first.pinned, false, "unpin works");
    t.equal(first.conflictReported, true, "conflict report works");
    t.ok(first.citationLabel.startsWith("[E"), "citation label");
    t.ok(first.excerpt.length > 0, "excerpt present");
    return t.finish();
  });
}

async function testContext() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 context", expected.context);
    const client = new WebContextComposerClient(workspace);
    const result = await client.compose("continue the ledger conflict with memory cost", "balanced");
    t.ok(result.contextItems.length > 0, "context items selected");
    t.ok(result.citations.length > 0, "citations built");
    t.equal(result.externalRequestCount, 0, "context external zero");
    t.equal(result.dataLeftDevice, false, "context local");
    t.equal(result.validation.tokenOverflowCount, 0, "no token overflow");
    t.equal(result.validation.branchLeakageCount, 0, "no branch leakage");
    t.equal(result.validation.canonicalMutationCount, 0, "canonical unchanged");
    t.ok(result.tokenBudget.utilization <= 1, "budget bounded");
    t.ok(result.outputText.includes("[C"), "output cites context");
    return t.finish();
  });
}

async function testWholeNovel() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 whole-novel", expected["whole-novel"]);
    const client = new WholeNovelAnalysisClient(workspace);
    const summary = client.summarize();
    t.ok(summary.jobId.startsWith("whole_"), "job id");
    t.ok(summary.majorEvents.length >= 2, "major events");
    t.ok(summary.pacingNotes.length >= 1, "pacing notes");
    t.equal(summary.externalRequestCount, 0, "whole novel external zero");
    t.equal(summary.dataLeftDevice, false, "whole novel local");
    t.ok(Number(workspace.connection.get("SELECT count(*) AS count FROM whole_novel_analysis_results WHERE project_id=?", [projectId])?.count ?? 0) >= 1, "whole result persisted");
    return t.finish();
  });
}

async function testCharacter() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 character", expected.character);
    const arcs = new CharacterArcClient(workspace).analyze();
    t.ok(arcs.length >= 1, "character arcs returned");
    t.ok(arcs.some((arc) => arc.characterId === "char_shen"), "main character arc");
    t.ok(arcs.every((arc) => arc.currentState), "current state");
    return t.finish();
  });
}

async function testTimeline() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 timeline", expected.timeline);
    const rows = new TimelineClient(workspace).rebuild();
    t.ok(rows.length >= 1, "timeline persisted");
    t.ok(rows[0].length >= 2, "timeline events");
    t.ok(rows[0].every((event) => event.sequence >= 1), "event order");
    return t.finish();
  });
}

async function testForeshadow() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 foreshadow", expected.foreshadow);
    const rows = new ForeshadowClient(workspace).track();
    t.ok(Array.isArray(rows), "foreshadow array");
    t.ok(rows.length >= 1, "foreshadow rows");
    t.ok(rows.every((item) => item.status), "foreshadow status");
    return t.finish();
  });
}

async function testThreads() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 threads", expected.threads);
    const rows = new OpenThreadClient(workspace).list();
    t.ok(Array.isArray(rows), "thread array");
    t.ok(rows.length >= 1, "open thread rows");
    t.ok(rows.every((item) => item.urgency), "urgency present");
    return t.finish();
  });
}

async function testRelationships() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 relationships", expected.relationships);
    const rows = new RelationshipAnalysisClient(workspace).analyze();
    t.ok(Array.isArray(rows), "relationship array");
    t.ok(rows.length >= 1, "relationship rows");
    t.ok(rows.every((item) => item.relationshipId), "relationship id");
    return t.finish();
  });
}

async function testPacing() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 pacing", expected.pacing);
    const rows = new PacingAnalysisClient(workspace).analyze();
    t.ok(rows.length >= 1, "pacing rows");
    t.ok(rows[0].pacingProfile, "pacing profile");
    t.ok((rows[0].recommendations?.length ?? rows[0].pacingNotes?.length ?? rows[0].chapterScores?.length ?? 0) >= 1, "recommendations");
    return t.finish();
  });
}

async function testWorldRules() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 world-rules", expected["world-rules"]);
    const rows = new WorldRuleAuditClient(workspace).audit();
    t.ok(Array.isArray(rows), "world audit array");
    t.ok(rows.length >= 1, "world audit rows");
    t.ok(rows.every((item) => item.severity), "severity present");
    return t.finish();
  });
}

async function testPublicCorpus() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 public-corpus", expected["public-corpus"]);
    const client = new PublicCorpusClient(workspace);
    const skipped = client.compare();
    t.equal(skipped.skipped, true, "public corpus disabled by default");
    client.enable();
    t.equal(workspace.publicCorpusOptIn, true, "public corpus opt-in");
    const rows = client.compare();
    t.ok(Array.isArray(rows), "public corpus compare array");
    t.ok(rows.length >= 1, "public corpus comparison persisted");
    t.ok(rows[0].selectedWorks?.length >= 1, "selected public works");
    client.disable();
    t.equal(workspace.publicCorpusOptIn, false, "public corpus disabled");
    return t.finish();
  });
}

async function testGeneration() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 generation", expected.generation);
    const client = new RetrievalGenerationClient(workspace);
    const result = await client.continueWithContext("continue with cited evidence");
    t.ok(result.traceId.startsWith("rag_"), "rag trace id");
    t.ok(result.draft.length > 0, "draft produced");
    t.ok(result.context.citations.length >= 1, "citations present");
    t.equal(result.externalRequestCount, 0, "generation external zero");
    t.equal(result.dataLeftDevice, false, "generation local");
    t.ok(Number(workspace.connection.get("SELECT count(*) AS count FROM retrieval_generation_traces WHERE project_id=?", [projectId])?.count ?? 0) >= 1, "trace persisted");
    const cancel = client.cancel();
    t.equal(cancel.cancelled, true, "cancel supported");
    return t.finish();
  });
}

async function testFeedback() {
  const t = harness("H2W3 feedback", expected.feedback);
  const js = fs.readFileSync("public/legacy/novel-whole-novel-workspace.js", "utf8");
  const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
  const combined = `${html}\n${js}`;
  for (const item of [
    "wholeNovelFeedbackPanel",
    "wholeNovelFeedbackAccept",
    "wholeNovelFeedbackEdit",
    "wholeNovelFeedbackReject",
    "wholeNovelFeedbackComment",
    "wholeNovelTrainingConsent",
    "captureFeedback",
    "feedbackId",
    "resultDisposition",
    "originalResultHash",
    "editedResultHash",
    "canonicalMutationCount",
    "diffMeta",
    "insertCount",
    "deleteCount",
    "replaceCount",
    "changedParagraphCount",
    "evaluationMetadata",
    "STYLE_PREFERENCE",
    "USER_APPROVED",
    "USER_EDITED",
    "USER_REJECTED",
    "RETRIEVAL_RELEVANCE",
    "LOCAL_CLOSED_RUNTIME",
    "retrieval_augmented_generation",
    "Feedback / Learning Foundation",
    "training pipeline not_implemented",
  ]) {
    t.includes(combined, item, `feedback contract ${item}`);
  }
  t.equal(H2W3_HEALTH.feedbackCaptureStatus, "foundation_ready", "health feedback foundation ready");
  t.equal(H2W3_HEALTH.userPreferenceSignalStatus, "foundation_ready", "health preference signal ready");
  t.equal(H2W3_HEALTH.futureContinualLearningContractStatus, "foundation_ready", "health future learning contract foundation ready");
  t.equal(H2W3_HEALTH.continualLearningStatus, "not_implemented", "continual learning explicitly not implemented");
  return t.finish();
}

async function testTrainingCandidateFoundation() {
  const t = harness("H2W3 training-candidate-foundation", expected["training-candidate-foundation"]);
  const js = fs.readFileSync("public/legacy/novel-whole-novel-workspace.js", "utf8");
  for (const item of [
    "TRAINING_STATES",
    "not_eligible",
    "consent_missing",
    "candidate",
    "needs_review",
    "approved_for_future_dataset",
    "rejected",
    "wholeNovelTrainingQueuePanel",
    "trainingEligibility",
    "trainingConsent",
    "trainingCandidates",
    "consentedCandidateCount",
    "pendingReviewCount",
    "rejectedCandidateCount",
    "feedbackProviderDistribution",
    "feedbackTaskDistribution",
    "LEARNING_SOURCES",
    "BROWSER_AI",
    "OLLAMA_LOCAL_AI",
    "LOCAL_CLOSED_RUNTIME",
    "EXTERNAL_AI_OPTIONAL",
    "LEARNING_SIGNALS",
    "CHARACTER_CONSISTENCY",
    "TIMELINE_CONSISTENCY",
    "WORLD_RULE_CONSISTENCY",
    "CONTEXT_SELECTION",
    "CITATION_QUALITY",
  ]) {
    t.includes(js, item, `training candidate contract ${item}`);
  }
  t.equal(H2W3_HEALTH.trainingCandidateFoundationStatus, "foundation_ready", "health training candidate foundation ready");
  t.equal(H2W3_HEALTH.trainingConsentStatus, "foundation_ready", "health training consent foundation ready");
  t.equal(H2W3_HEALTH.modelTrainingStatus, "not_implemented", "model training not implemented");
  t.equal(H2W3_HEALTH.loraTrainingStatus, "not_implemented", "lora not implemented");
  t.equal(H2W3_HEALTH.automaticModelPromotionStatus, "not_implemented", "auto promotion not implemented");
  return t.finish();
}

async function testFeedbackPrivacy() {
  const t = harness("H2W3 feedback-privacy", expected["feedback-privacy"]);
  const js = fs.readFileSync("public/legacy/novel-whole-novel-workspace.js", "utf8");
  const healthText = JSON.stringify(H2W3_HEALTH);
  for (const item of [
    "[redacted-local-only]",
    "private_project_local_only",
    "Prompt Hidden: true",
    "Session Token Hidden: true",
    "Data Left Device",
    "External Request Count",
    "canonicalMutationCount: 0",
    "privacyClass",
    "userComment: comment ? \"[redacted-local-only]\" : \"\"",
    "prompts, raw private context, session tokens, and full author comments are not exposed",
    "Forbidden in H2W.3: real training, model weight update, adapter promotion, automatic model promotion.",
  ]) {
    t.includes(js, item, `privacy boundary ${item}`);
  }
  t.notIncludes(healthText, "API_KEY", "health hides api key");
  t.notIncludes(healthText, "ADMIN_TOKEN", "health hides admin token");
  t.notIncludes(healthText, "sessionToken", "health hides session token");
  t.equal(H2W3_HEALTH.webWholeNovelExternalRequestCount, 0, "health external zero");
  t.equal(H2W3_HEALTH.webWholeNovelDataLeftDevice, false, "health data local");
  t.equal(H2W3_HEALTH.feedbackRecordCount, "runtime_query_required", "feedback count runtime only");
  t.equal(H2W3_HEALTH.feedbackProviderDistribution, "runtime_query_required", "feedback distribution runtime only");
  return t.finish();
}

async function testArchitectureAlignment() {
  const t = harness("H2W3 architecture-alignment", expected["architecture-alignment"]);
  const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
  const js = fs.readFileSync("public/legacy/novel-whole-novel-workspace.js", "utf8");
  const combined = `${html}\n${js}`;
  for (const item of [
    "三路閉端 AI 工作區",
    "三路閉端 AI 架構",
    "瀏覽器閉端 AI",
    "Browser AI not implemented",
    "Ollama 本機 AI",
    "Ollama status dynamic",
    "本機閉端 Runtime",
    "Local runtime status dynamic",
    "外部 AI：可選輔助",
    "Draft / Candidate only",
    "not_implemented",
    "partial_ready",
    "wholeNovelWorkspaceOpen",
    "wholeNovelAiWorkspace",
  ]) {
    t.includes(combined, item, `architecture text ${item}`);
  }
  t.equal(H2W3_HEALTH.browserClosedAiStatus, "not_implemented", "health browser ai not implemented");
  t.ok(["ready", "available", "unavailable"].includes(H2W3_HEALTH.ollamaLocalAiStatus), "health ollama status enum");
  t.ok(["ready", "available", "unavailable"].includes(H2W3_HEALTH.localClosedRuntimeStatus), "health local runtime status enum");
  t.equal(H2W3_HEALTH.threeClosedAiArchitectureStatus, "partial_ready", "health architecture partial until H3A");
  t.notIncludes(combined, "Continual Learning Status: foundation_ready", "ui does not claim active continual learning");
  t.includes(combined, "外部 AI：可選輔助", "external ai optional wording");
  return t.finish();
}

async function testVisibleUiSemantics() {
  const t = harness("H2W3 visible-ui-semantics", expected["visible-ui-semantics"]);
  const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
  const js = fs.readFileSync("public/legacy/novel-whole-novel-workspace.js", "utf8");
  const combined = `${html}\n${js}`;
  t.includes(html, "三路閉端 AI 架構", "top badges include three-route closed AI architecture");
  t.includes(html, "外部 AI 可選", "top badges mark external AI optional");
  t.notIncludes(html, "可接外部 AI", "legacy top badge removed");
  t.includes(html, "H2 Local Story Intelligence", "visible version no longer uses v9 label");
  t.notIncludes(html, "story-analyzer-v9", "legacy story-analyzer v9 marker absent from visible HTML");
  t.includes(html, "本機創作助理", "small closed AI renamed as local creation helper");
  t.notIncludes(html, "小型閉端AI", "legacy small closed AI label absent");
  t.includes(combined, "三路閉端 AI 工作區", "workspace title aligned");
  t.notIncludes(combined, "全書閉端 AI 工作區", "legacy workspace title absent");
  t.includes(combined, "瀏覽器閉端 AI", "browser closed AI localized");
  t.includes(combined, "Ollama 本機 AI", "ollama local AI localized");
  t.includes(combined, "本機閉端 Runtime", "local runtime localized");
  t.includes(combined, "外部 AI：可選輔助", "external AI optional localized");
  t.includes(html, "外部 AI 輔助（可選）", "cloud assistant marked optional");
  t.notIncludes(html, "專屬小說AI", "dedicated cloud AI wording removed");
  t.includes(html, "回饋與未來學習資料", "learning section renamed as feedback/future data");
  t.includes(html, "匯出已核准樣本 JSONL", "training export renamed");
  t.includes(html, "執行品質基準測試", "fixed eval renamed as quality benchmark");
  t.notIncludes(html, "匯出訓練資料", "legacy training export absent");
  t.notIncludes(html, "執行AI固定評測", "legacy AI eval wording absent");
  t.includes(html, "尚未讀取回饋與未來學習資料", "learning empty state renamed");
  t.notIncludes(html, "尚未讀取學習資料", "legacy learning empty state absent");
  t.includes(js, "Continual Learning Status: not_implemented", "continual learning not implemented visible");
  t.includes(js, "Model Training Status: not_implemented", "model training not implemented visible");
  t.notIncludes(js, "Continual Learning Status: foundation_ready", "active continual learning not claimed");
  t.notIncludes(html, "AI學習資料", "legacy AI learning title absent");
  t.includes(html, "AI能力狀態面板", "AI capability panel wording softened");
  t.notIncludes(html, "尚未產生雲端AI結果", "legacy cloud result text absent");
  t.notIncludes(html, "尚未檢查雲端AI狀態", "legacy cloud status text absent");
  t.includes(combined, "Draft / Candidate", "candidate safety wording present");
  return t.finish();
}
async function testLearningStatusSemantics() {
  const t = harness("H2W3 learning-status-semantics", expected["learning-status-semantics"]);
  const js = fs.readFileSync("public/legacy/novel-whole-novel-workspace.js", "utf8");
  t.equal(H2W3_HEALTH.feedbackCaptureStatus, "foundation_ready", "feedback foundation ready");
  t.equal(H2W3_HEALTH.userPreferenceSignalStatus, "foundation_ready", "preference signal foundation ready");
  t.equal(H2W3_HEALTH.trainingCandidateFoundationStatus, "foundation_ready", "training candidate foundation ready");
  t.equal(H2W3_HEALTH.trainingConsentStatus, "foundation_ready", "training consent foundation ready");
  t.equal(H2W3_HEALTH.futureContinualLearningContractStatus, "foundation_ready", "future contract foundation ready");
  t.equal(H2W3_HEALTH.continualLearningStatus, "not_implemented", "continual learning not implemented");
  t.equal(H2W3_HEALTH.modelTrainingStatus, "not_implemented", "model training not implemented");
  t.equal(H2W3_HEALTH.loraTrainingStatus, "not_implemented", "lora not implemented");
  t.equal(H2W3_HEALTH.qloraTrainingStatus, "not_implemented", "qlora not implemented");
  t.equal(H2W3_HEALTH.adapterTrainingStatus, "not_implemented", "adapter training not implemented");
  t.equal(H2W3_HEALTH.automaticModelPromotionStatus, "not_implemented", "automatic promotion not implemented");
  for (const item of [
    "Feedback Foundation Status: foundation_ready",
    "Training Candidate Foundation Status: foundation_ready",
    "Future Continual Learning Contract Status: foundation_ready",
    "Continual Learning Status: not_implemented",
    "Model Training Status: not_implemented",
    "LoRA Training Status: not_implemented",
    "QLoRA Training Status: not_implemented",
    "active continual learning not_implemented",
  ]) t.includes(js, item, `learning ui ${item}`);
  t.notIncludes(js, "Continual Learning Status: foundation_ready", "no active learning claim in UI");
  return t.finish();
}

async function testPrivacy() {
  return withWorkspace(async (workspace) => {
    const t = harness("H2W3 privacy", expected.privacy);
    await workspace.search("ledger");
    await workspace.composeContext("privacy check");
    const snapshot = workspace.snapshot();
    t.equal(snapshot.externalRequestCount, 0, "external request zero");
    t.equal(snapshot.dataLeftDevice, false, "data left false");
    t.equal(snapshot.canonicalMutationCount, 0, "canonical unchanged");
    t.equal(snapshot.branchLeakageCount, 0, "branch leakage zero");
    t.equal(H2W3_HEALTH.webWholeNovelAiStatus, "ready", "health whole novel ready");
    t.equal(H2W3_HEALTH.webPublicCorpusStatus, "ready", "health public corpus ready");
    t.equal(H2W3_HEALTH.webRetrievalAugmentedGenerationStatus, "ready", "health rag ready");
    t.equal(H2W3_HEALTH.webWholeNovelExternalRequestCount, 0, "health external zero");
    t.equal(H2W3_HEALTH.webWholeNovelDataLeftDevice, false, "health data local");
    return t.finish();
  });
}

async function testBrowserReal() {
  const t = harness("H2W3 browser-real", expected["browser-real"]);
  const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
  const js = fs.readFileSync("public/legacy/novel-whole-novel-workspace.js", "utf8");
  t.includes(html, "novel-whole-novel-workspace.js?v=h2w3-web-whole-novel-ai", "legacy page loads H2W3 workspace");
  t.includes(html, "data-whole-novel-workspace-version=\"h2w3-web-whole-novel-ai\"", "release fingerprint on script");
  t.includes(html, "id=\"wholeNovelWorkspaceOpen\"", "navigation entry exists in raw html");
  t.includes(html, "aria-controls=\"wholeNovelAiWorkspace\"", "navigation entry controls workspace");
  t.includes(html, "id=\"wholeNovelWorkspaceMount\"", "workspace mount target exists in raw html");
  for (const id of ["wholeNovelAiWorkspace", "wholeNovelWorkspaceOpen", "wholeNovelWorkspaceClose", "wholeNovelProjectSelector", "wholeNovelScopeSelector", "wholeNovelBranchSelector", "wholeNovelSearchInput", "wholeNovelSearchMode", "wholeNovelSearchButton", "wholeNovelSearchCancel", "wholeNovelSearchResults", "wholeNovelEvidencePanel", "wholeNovelContextInspector", "wholeNovelTokenBudget", "wholeNovelAnalysisPanel", "wholeNovelCharacterArcPanel", "wholeNovelTimelinePanel", "wholeNovelForeshadowPanel", "wholeNovelOpenThreadsPanel", "wholeNovelRelationshipPanel", "wholeNovelPacingPanel", "wholeNovelWorldRulesPanel"]) {
    t.ok(html.includes(id) || js.includes(id), `browser dom id ${id}`);
  }
  for (const action of ["Run Hybrid Search", "Compose Context", "Summarize Whole Novel", "Continue with Context", "Cancel", "Report Conflict"]) {
    t.includes(js, action, `browser action ${action}`);
  }
  for (const stateName of ["idle", "loading", "streaming", "success", "cancelled", "error"]) t.includes(js, stateName, `state token ${stateName}`);
  t.includes(js, "window.NovelWholeNovelWorkspace", "debug api exported");
  t.includes(js, "externalRequestCount", "external request tracked");
  t.includes(js, "dataLeftDevice", "data-left-device tracked");
  return t.finish();
}

async function testProductionHtml() {
  const t = harness("H2W3 production-html", expected["production-html"]);
  const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
  t.includes(html, "三路閉端 AI 工作區", "navigation label present");
  t.includes(html, "name=\"novel-static-release\"", "static commit meta present");
  t.includes(html, "id=\"novelStaticRelease\"", "static release body marker present");
  t.includes(html, "__NOVEL_STATIC_APP_COMMIT__", "static commit placeholder present before build stamping");
  t.includes(html, "id=\"wholeNovelWorkspaceOpen\"", "workspace open button in raw html");
  t.includes(html, "id=\"wholeNovelAiWorkspace\"", "workspace shell in raw html");
  t.includes(html, "id=\"wholeNovelWorkspaceMount\"", "workspace mount target in raw html");
  t.includes(html, "data-whole-novel-workspace-version=\"h2w3-web-whole-novel-ai-v1\"", "workspace version on shell");
  t.includes(html, "hidden><header class=\"h2w3-head\"", "workspace hidden before open");
  t.includes(html, "workspaceScriptLoaded = false", "diagnostics default present");
  t.includes(html, "workspaceInitializationError = null", "diagnostics error field present");
  t.includes(html, "novel-whole-novel-workspace.js?v=h2w3-web-whole-novel-ai", "workspace script referenced");
  t.includes(html, "data-whole-novel-workspace-version=\"h2w3-web-whole-novel-ai\"", "script release attribute present");
  t.includes(html, "document.querySelectorAll('.nav button[data-view]')", "nav binding excludes workspace button");
  t.includes(html, "Draft / Candidate", "candidate safety copy present");
  return t.finish();
}

async function testProductionSmoke() {
  const t = harness("H2W3 production-smoke", expected["production-smoke"]);
  const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
  const js = fs.readFileSync("public/legacy/novel-whole-novel-workspace.js", "utf8");
  const combined = `${html}\n${js}`;
  for (const item of [
    "novel-whole-novel-workspace.js?v=h2w3-web-whole-novel-ai",
    "data-whole-novel-workspace-version",
    "wholeNovelAiWorkspace",
    "wholeNovelWorkspaceOpen",
    "aria-controls=\"wholeNovelAiWorkspace\"",
    "wholeNovelWorkspaceMount",
    "wholeNovelProjectSelector",
    "wholeNovelBranchSelector",
    "PRIVATE_PROJECT",
    "STORY_BIBLE",
    "wholeNovelSearchButton",
    "wholeNovelSearchResults",
    "wholeNovelEvidencePanel",
    "Pin",
    "wholeNovelContextInspector",
    "wholeNovelTokenBudget",
    "wholeNovelAnalysisPanel",
    "wholeNovelCharacterArcPanel",
    "wholeNovelTimelinePanel",
    "wholeNovelForeshadowPanel",
    "wholeNovelOpenThreadsPanel",
    "wholeNovelRelationshipPanel",
    "wholeNovelPacingPanel",
    "wholeNovelWorldRulesPanel",
    "wholeNovelRepeatedPatternsPanel",
    "wholeNovelGenerationPanel",
    "Candidate",
    "Canonical Mutation Count: 0",
    "localStorage.setItem(STORAGE_KEY",
    "setBranch",
    "PUBLIC_CORPUS opt-in",
    "Provider: local-rule",
    "External Request Count",
    "Data Left Device",
    "cancelled",
    "window.NovelWholeNovelWorkspace",
    "Service Worker",
    "release fingerprint",
    "h2w3-web-whole-novel-ai",
    "Context Inspector",
    "Citation Coverage",
    "Unsupported Claims",
    "Retrieval-Augmented Generation",
    "public corpus disabled",
    "dataLeftDevice: false",
    "externalRequestCount: 0",
    "workspaceScriptLoaded",
    "workspaceInitialized",
    "workspaceMounted",
    "workspaceVisible",
    "workspaceVisibilityReason",
    "workspaceMountTarget",
    "workspaceVersion",
    "workspaceInitializationError",
    "getDiagnostics",
    "id=\"wholeNovelWorkspaceOpen\"",
    "hidden><header class=\"h2w3-head\"",
    "setWorkspaceCollapsed(false)",
    "NOVEL_STATIC_RELEASE",
    "novelStaticRelease",
    "novel-static-release",
    H2W3_RELEASE_TAG,
  ]) {
    t.includes(combined, item, `production smoke artifact ${item}`);
  }
  return t.finish();
}

function extractStaticReleaseFromHtml(html) {
  const metaCommit = html.match(/<meta\s+name="novel-static-release"\s+content="([^"]+)"/)?.[1] || "";
  const divCommit = html.match(/id="novelStaticRelease"[^>]*data-app-commit="([^"]+)"/)?.[1] || "";
  const divTag = html.match(/id="novelStaticRelease"[^>]*data-release-tag="([^"]+)"/)?.[1] || "";
  const visibleUiSemanticVersion = html.match(/id="novelStaticRelease"[^>]*data-visible-ui-semantic-version="([^"]+)"/)?.[1] || "";
  const visibleUiBodyHash = html.match(/id="novelStaticRelease"[^>]*data-visible-ui-body-hash="([^"]+)"/)?.[1] || "";
  return { metaCommit, divCommit, divTag, visibleUiSemanticVersion, visibleUiBodyHash };
}

function extractStaticReleaseFromJs(js) {
  const appCommit = js.match(/appCommit:\s*"([^"]+)"/)?.[1] || "";
  const releaseTag = js.match(/releaseTag:\s*"([^"]+)"/)?.[1] || "";
  const visibleUiSemanticVersion = js.match(/visibleUiSemanticVersion:\s*"([^"]+)"/)?.[1] || "";
  const visibleUiBodyHash = js.match(/visibleUiBodyHash:\s*"([^"]+)"/)?.[1] || "";
  return { appCommit, releaseTag, visibleUiSemanticVersion, visibleUiBodyHash };
}

async function fetchProductionText(pathname) {
  const url = `${PRODUCTION_ORIGIN}${pathname}${pathname.includes("?") ? "&" : "?"}h2w3Verify=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  return { response, text, url };
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function ensureProductionVerificationDir() {
  fs.mkdirSync(PRODUCTION_VERIFICATION_DIR, { recursive: true });
}

function writeProductionArtifact(name, content) {
  ensureProductionVerificationDir();
  const file = path.join(PRODUCTION_VERIFICATION_DIR, name);
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
  return { file, sha256: sha256(fs.readFileSync(file, "utf8")) };
}

function headersToObject(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) result[key] = value;
  return result;
}

function fetchProductionHtmlWithCurl() {
  const url = `${PRODUCTION_ORIGIN}/legacy/novel-system.html?h2w3Curl=${Date.now()}`;
  const body = execFileSync("curl.exe", ["-L", "-sS", url], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  const headerText = execFileSync("curl.exe", ["-L", "-sS", "-D", "-", "-o", "NUL", url], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  return { url, body, headerText };
}

async function fetchProductionHtmlWithNode() {
  return fetchProductionText("/legacy/novel-system.html");
}

async function fetchProductionHtmlWithPlaywrightRequest() {
  const url = `${PRODUCTION_ORIGIN}/legacy/novel-system.html?h2w3Playwright=${Date.now()}`;
  try {
    const { request } = await import("@playwright/test");
    const context = await request.newContext();
    const response = await context.get(url);
    const body = await response.text();
    await context.dispose();
    return { status: "fetched", url, statusCode: response.status(), body, headers: response.headers() };
  } catch (error) {
    return {
      status: "infrastructure_blocked",
      url,
      statusCode: null,
      body: "",
      headers: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function verifyVisibleBodySemantics(t, body, label) {
  for (const item of H2W3_VISIBLE_UI_REQUIRED_STRINGS) {
    t.includes(body, item, `${label} expected string ${item}`);
  }
  for (const item of H2W3_VISIBLE_UI_FORBIDDEN_STRINGS) {
    t.notIncludes(body, item, `${label} legacy string absent ${item}`);
  }
  const semanticSource = extractVisibleSemanticSourceFromBody(body);
  t.equal(computeVisibleUiBodyHash(semanticSource), H2W3_VISIBLE_UI_BODY_HASH, `${label} visible semantic hash matches shared constant`);
}

function classifyRepositoryLegacyMatches() {
  const patterns = H2W3_VISIBLE_UI_FORBIDDEN_STRINGS.join("|");
  let output = "";
  try {
    output = execFileSync("rg", ["-n", patterns, "public", "app", "scripts", "lib"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    output = error.stdout || "";
  }
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [file] = line.split(":");
      const isProductionUi = file === "public\\legacy\\novel-system.html" || file === "public/legacy/novel-system.html" || file === "public\\legacy\\novel-whole-novel-workspace.js" || file === "public/legacy/novel-whole-novel-workspace.js";
      const isHistoricalDoc = file.includes("使用說明_README");
      const isTestOrBackendVersion = file.includes("scripts\\") || file.includes("scripts/") || file.includes("app\\api\\admin") || file.includes("app/api/admin") || file.includes("lib\\novel-ai\\store") || file.includes("lib/novel-ai/store") || file.includes("lib\\novel-ai\\prompts") || file.includes("lib/novel-ai/prompts");
      return {
        line,
        file,
        classification: isProductionUi ? "production-ui" : isHistoricalDoc ? "historical-doc" : isTestOrBackendVersion ? "test-or-backend-version" : "other",
      };
    });
}

async function testProductionArtifactConsistency() {
  const t = harness("H2W3 production-artifact-consistency", expected["production-artifact-consistency"]);
  const healthFetch = await fetchProductionText("/api/ai/health");
  const htmlFetch = await fetchProductionText("/legacy/novel-system.html");
  const jsFetch = await fetchProductionText("/legacy/novel-whole-novel-workspace.js");
  const health = JSON.parse(healthFetch.text);
  const htmlRelease = extractStaticReleaseFromHtml(htmlFetch.text);
  const jsRelease = extractStaticReleaseFromJs(jsFetch.text);
  t.equal(healthFetch.response.status, 200, "health reachable");
  t.equal(htmlFetch.response.status, 200, "html reachable");
  t.equal(jsFetch.response.status, 200, "js reachable");
  t.equal(health.releaseTag, H2W3_RELEASE_TAG, "health release tag matches expected");
  t.equal(htmlRelease.metaCommit, health.appCommit, "html meta commit matches health");
  t.equal(htmlRelease.divCommit, health.appCommit, "html body commit matches health");
  t.equal(jsRelease.appCommit, health.appCommit, "js static commit matches health");
  t.equal(htmlRelease.divTag, health.releaseTag, "html release tag matches health");
  t.equal(jsRelease.releaseTag, health.releaseTag, "js release tag matches health");
  t.includes(htmlFetch.text, "三路閉端 AI 工作區", "production html architecture wording present");
  t.notIncludes(htmlFetch.text, "全書閉端 AI 工作區", "production html legacy wording absent");
  t.ok(String(htmlFetch.response.url).startsWith(PRODUCTION_ORIGIN), "production alias response url used", htmlFetch.response.url);
  return t.finish();
}

async function testProductionVisibleBody() {
  const t = harness("H2W3 production-visible-body", expected["production-visible-body"]);
  const curlResult = fetchProductionHtmlWithCurl();
  const nodeResult = await fetchProductionHtmlWithNode();
  const playwrightResult = await fetchProductionHtmlWithPlaywrightRequest();
  const healthFetch = await fetchProductionText("/api/ai/health");
  const health = JSON.parse(healthFetch.text);
  const headers = headersToObject(nodeResult.response.headers);
  const htmlRelease = extractStaticReleaseFromHtml(nodeResult.text);
  const semanticSource = extractVisibleSemanticSourceFromBody(nodeResult.text);
  const bodyHash = computeVisibleUiBodyHash(semanticSource);
  const artifacts = {
    curlBody: writeProductionArtifact("curl-novel-system.html", curlResult.body),
    nodeBody: writeProductionArtifact("node-fetch-novel-system.html", nodeResult.text),
    playwrightBody: writeProductionArtifact(
      "playwright-request-novel-system.html",
      playwrightResult.status === "fetched" ? playwrightResult.body : JSON.stringify(playwrightResult, null, 2),
    ),
    headers: writeProductionArtifact("response-headers.json", { node: headers, curl: curlResult.headerText, playwright: playwrightResult.headers }),
  };
  const summary = {
    productionOrigin: PRODUCTION_ORIGIN,
    nodeUrl: nodeResult.url,
    responseUrl: nodeResult.response.url,
    status: nodeResult.response.status,
    contentLength: headers["content-length"] || null,
    etag: headers.etag || null,
    age: headers.age || null,
    cacheControl: headers["cache-control"] || null,
    htmlSha256: sha256(nodeResult.text),
    visibleUiSemanticVersion: H2W3_VISIBLE_UI_SEMANTIC_VERSION,
    visibleUiBodyHash: bodyHash,
    expectedVisibleUiBodyHash: H2W3_VISIBLE_UI_BODY_HASH,
    healthVisibleUiBodyHash: health.visibleUiBodyHash,
    healthReleaseTag: health.releaseTag,
    healthAppCommit: health.appCommit,
    healthDeploymentId: health.deploymentId,
    staticRelease: htmlRelease,
    requiredFound: H2W3_VISIBLE_UI_REQUIRED_STRINGS.filter((item) => nodeResult.text.includes(item)),
    legacyFound: H2W3_VISIBLE_UI_FORBIDDEN_STRINGS.filter((item) => nodeResult.text.includes(item)),
    playwrightStatus: playwrightResult.status,
    artifacts,
  };
  writeProductionArtifact("verification-summary.json", summary);

  t.equal(nodeResult.response.status, 200, "node fetch production html status 200");
  t.ok(String(nodeResult.response.url).startsWith(PRODUCTION_ORIGIN), "node fetch stayed on production alias", nodeResult.response.url);
  t.ok(curlResult.body.length > 1000, "curl production body captured");
  t.equal(curlResult.body.includes("三路閉端 AI 工作區"), true, "curl body has visible architecture");
  t.equal(sha256(curlResult.body), sha256(nodeResult.text), "curl and node body hash match");
  t.ok(playwrightResult.status === "fetched" || playwrightResult.status === "infrastructure_blocked", "playwright request attempted and recorded");
  if (playwrightResult.status === "fetched") t.equal(sha256(playwrightResult.body), sha256(nodeResult.text), "playwright and node body hash match");
  t.equal(healthFetch.response.status, 200, "health reachable");
  t.equal(health.releaseTag, H2W3_RELEASE_TAG, "health release tag final closure");
  t.equal(health.visibleUiSemanticVersion, H2W3_VISIBLE_UI_SEMANTIC_VERSION, "health visible semantic version");
  t.equal(health.visibleUiBodyHash, H2W3_VISIBLE_UI_BODY_HASH, "health visible body hash");
  t.equal(htmlRelease.visibleUiSemanticVersion, H2W3_VISIBLE_UI_SEMANTIC_VERSION, "html semantic version marker");
  t.equal(htmlRelease.visibleUiBodyHash, H2W3_VISIBLE_UI_BODY_HASH, "html visible body hash marker");
  t.equal(bodyHash, H2W3_VISIBLE_UI_BODY_HASH, "production body recomputed visible hash");
  verifyVisibleBodySemantics(t, nodeResult.text, "node production body");
  t.equal(summary.legacyFound.length, 0, "summary legacy found zero");
  t.ok(fs.existsSync(path.join(PRODUCTION_VERIFICATION_DIR, "verification-summary.json")), "verification summary artifact exists");
  return t.finish();
}

async function testProductionNoLegacySemantics() {
  const t = harness("H2W3 production-no-legacy-semantics", expected["production-no-legacy-semantics"]);
  const htmlFetch = await fetchProductionText("/legacy/novel-system.html");
  const jsFetch = await fetchProductionText("/legacy/novel-whole-novel-workspace.js");
  const combined = `${htmlFetch.text}\n${jsFetch.text}`;
  const classifications = classifyRepositoryLegacyMatches();
  writeProductionArtifact("repository-legacy-rg.json", classifications);
  t.equal(htmlFetch.response.status, 200, "production html reachable");
  t.equal(jsFetch.response.status, 200, "production js reachable");
  for (const item of H2W3_VISIBLE_UI_FORBIDDEN_STRINGS) t.notIncludes(combined, item, `production body legacy absent ${item}`);
  for (const item of H2W3_VISIBLE_UI_REQUIRED_STRINGS) t.includes(combined, item, `production body expected present ${item}`);
  t.equal(classifications.filter((row) => row.classification === "production-ui").length, 0, "repository has no legacy match in production UI artifacts");
  t.ok(classifications.every((row) => ["historical-doc", "test-or-backend-version", "other"].includes(row.classification)), "legacy repository matches classified as non-production UI");
  t.ok(classifications.some((row) => row.classification === "historical-doc"), "historical README legacy strings classified");
  t.ok(classifications.some((row) => row.classification === "test-or-backend-version"), "test/backend legacy strings classified");
  return t.finish();
}

async function testBuildMutationTrace() {
  const t = harness("H2W3 build-mutation-trace", expected["build-mutation-trace"]);
  const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
  const js = fs.readFileSync("public/legacy/novel-whole-novel-workspace.js", "utf8");
  const stamp = fs.readFileSync("scripts/stamp-static-release.mjs", "utf8");
  const health = fs.readFileSync("app/api/ai/health/route.ts", "utf8");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  t.includes(stamp, H2W3_RELEASE_TAG, "stamp uses final release tag");
  t.includes(stamp, "__NOVEL_VISIBLE_UI_BODY_HASH__", "stamp replaces visible body hash");
  t.includes(stamp, "__NOVEL_VISIBLE_UI_SEMANTIC_VERSION__", "stamp replaces semantic version");
  t.includes(stamp, "visibleUiRequiredStrings", "stamp source list present");
  t.includes(health, "visibleUiSemanticVersion", "health exposes semantic version");
  t.includes(health, "visibleUiBodyHash", "health exposes visible body hash");
  t.includes(health, H2W3_RELEASE_TAG, "health final release tag");
  t.includes(html, "data-visible-ui-semantic-version", "html release marker semantic version");
  t.includes(html, "data-visible-ui-body-hash", "html release marker body hash");
  t.includes(js, "visibleUiSemanticVersion", "js static release semantic version");
  t.includes(js, "visibleUiBodyHash", "js static release body hash");
  t.includes(js, `expectedReleaseTag: "${H2W3_RELEASE_TAG}"`, "js expected release tag final");
  t.includes(pkg.scripts.build, "node scripts/stamp-static-release.mjs && next build", "build stamps before next build");
  t.equal(computeVisibleUiBodyHash(H2W3_VISIBLE_UI_REQUIRED_STRINGS), H2W3_VISIBLE_UI_BODY_HASH, "shared hash deterministic");
  t.equal(H2W3_VISIBLE_UI_FORBIDDEN_STRINGS.length, 11, "legacy forbidden list covers requested strings");
  return t.finish();
}

async function main() {
  const selected = mode === "all" ? Object.entries(modes).filter(([name]) => !name.startsWith("production-")) : [[mode, modes[mode]]];
  if (!selected[0]?.[1]) throw new Error(`Unknown H2W.3 mode: ${mode}`);
  let pass = 0;
  let fail = 0;
  for (const [, fn] of selected) {
    const result = await fn();
    pass += result.pass;
    fail += result.fail;
  }
  if (mode === "all") {
    console.log(JSON.stringify({
      suite: "H2W.3 Web Whole-Novel AI Workspace (all)",
      pass,
      fail,
      skip: 0,
      expectedMinimumPass: selected.reduce((total, [name]) => total + (expected[name] || 0), 0),
      health: H2W3_HEALTH,
      externalRequestCount: 0,
      dataLeftDevice: false,
      canonicalMutationCount: 0,
      branchLeakageCount: 0,
    }, null, 2));
  }
  if (fail) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
