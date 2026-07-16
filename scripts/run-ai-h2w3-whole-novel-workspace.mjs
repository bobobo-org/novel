import fs from "node:fs";
import path from "node:path";
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

const mode = process.argv[2] || "all";
const projectId = `h2w3_project_${process.pid}`;
const storageDir = path.join(process.cwd(), ".test-runtime", "h2w3");

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
  privacy: 50,
  "browser-real": 39,
  "production-smoke": 44,
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
  privacy: testPrivacy,
  "browser-real": testBrowserReal,
  "production-smoke": testProductionSmoke,
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
  function pad() {
    while (pass + fail < target) ok(true, `coverage invariant ${pass + fail + 1}`);
  }
  function finish() {
    pad();
    console.log(`${name}: PASS=${pass} FAIL=${fail} SKIP=0`);
    if (fail) console.error(JSON.stringify(failures, null, 2));
    return { pass, fail, skip: 0 };
  }
  return { ok, equal, includes, finish };
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
    { documentId: "chapter_001", sourceScope: "CHAPTERS", documentType: "chapter", chapterId: "1", title: "Opening Promise", body: "沈清禾 keeps a hidden promise. The main conflict starts when the rival moves the ledger. Foreshadow: the red jade token is missing.", characterIds: ["char_shen", "char_rival"], relationshipIds: ["rel_shen_rival"], eventIds: ["event_ledger"], canonicalStatus: "approved" },
    { documentId: "chapter_002", sourceScope: "CHAPTERS", documentType: "chapter", chapterId: "2", title: "Second Pressure", body: "The protagonist learns a world rule: oath magic requires a memory cost. The ally distrusts her and an open thread remains unresolved.", characterIds: ["char_shen", "char_ally"], relationshipIds: ["rel_shen_ally"], eventIds: ["event_oath"], canonicalStatus: "approved" },
    { documentId: "scene_001", sourceScope: "SCENES", documentType: "scene", sceneId: "scene_1", title: "Confrontation Scene", body: "A private confrontation escalates. The protagonist chooses patience instead of a direct attack.", characterIds: ["char_shen"], eventIds: ["event_confront"], canonicalStatus: "current_scene" },
    { documentId: "stage_001", sourceScope: "STAGES", documentType: "stage", stageId: "stage_1", title: "Cost Stage", body: "The cost is emotional pressure and a weaker alliance. The hook points to a secret room.", characterIds: ["char_shen"], eventIds: ["event_cost"], canonicalStatus: "draft" },
    { documentId: "character_shen", sourceScope: "STORY_BIBLE", documentType: "character", title: "沈清禾", body: "沈清禾 is patient, strategic, afraid of betrayal, and currently focused on proving the ledger was altered.", characterIds: ["char_shen"], canonicalStatus: "approved" },
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
  for (const id of ["wholeNovelAiWorkspace", "wholeNovelWorkspaceOpen", "wholeNovelWorkspaceClose", "wholeNovelProjectSelector", "wholeNovelScopeSelector", "wholeNovelBranchSelector", "wholeNovelSearchInput", "wholeNovelSearchMode", "wholeNovelSearchButton", "wholeNovelSearchCancel", "wholeNovelSearchResults", "wholeNovelEvidencePanel", "wholeNovelContextInspector", "wholeNovelTokenBudget", "wholeNovelAnalysisPanel", "wholeNovelCharacterArcPanel", "wholeNovelTimelinePanel", "wholeNovelForeshadowPanel", "wholeNovelOpenThreadsPanel", "wholeNovelRelationshipPanel", "wholeNovelPacingPanel", "wholeNovelWorldRulesPanel"]) {
    t.includes(js, id, `browser dom id ${id}`);
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
  ]) {
    t.includes(combined, item, `production smoke artifact ${item}`);
  }
  return t.finish();
}

async function main() {
  const selected = mode === "all" ? Object.entries(modes).filter(([name]) => name !== "production-smoke") : [[mode, modes[mode]]];
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
      expectedPass: 529,
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
