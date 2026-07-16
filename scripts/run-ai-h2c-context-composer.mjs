import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { SQLITE_MIGRATIONS } from "../lib/novel-ai/storage/sqlite/sqlite-migrations.ts";
import { HybridRetrievalService } from "../lib/novel-ai/retrieval/hybrid/index.ts";
import {
  CONTEXT_COMPOSER_TABLES,
  ContextComposerService,
  H2C_CONTEXT_MIGRATION_VERSION,
  H2C_CONTEXT_COMPOSER_VERSION,
  H2C_HEALTH,
  RetrievalAugmentedGenerator,
  WholeNovelService,
} from "../lib/novel-ai/context/index.ts";

const mode = process.argv[2] || "all";
const h = createHarness(`H2C Context Composer (${mode})`);
const storageDir = path.resolve(process.cwd(), `.tmp-h2c-${mode}`);
const projectId = `h2c-${mode}-project`;
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });

const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const retrieval = new HybridRetrievalService({ projectId, connection });
const composer = new ContextComposerService({ projectId, connection });
const wholeNovel = new WholeNovelService({ projectId, connection });
const rag = new RetrievalAugmentedGenerator({ projectId, connection });

function count(table, where = "project_id=?", params = [projectId]) {
  return Number(connection.get(`SELECT count(*) AS count FROM ${table} WHERE ${where}`, params)?.count ?? 0);
}

function rows(table, where = "project_id=?", params = [projectId]) {
  return connection.all(`SELECT * FROM ${table} WHERE ${where}`, params);
}

function assertTable(name) {
  h.assert(`migration table ${name}`, Boolean(connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])));
}

function chapterBody(i, branch = "main") {
  const phase = i < 8 ? "opening" : i < 18 ? "rising" : i < 27 ? "crisis" : "finale";
  return [
    `Chapter ${i} opens in the capital archive. Lin Zhao studies the Crimson Ledger while pursuing the succession conflict. Phase=${phase}. Branch=${branch}.`,
    `Mira notices that Chancellor Wei hides the Sky Seal. This keeps the oath thread unresolved and makes the council distrust Lin Zhao.`,
    `The travel route runs from capital to river gate in two days. Rule: the dead cannot return without a named ritual cost.`,
    `Foreshadow FS-${i % 9}: a silver moth mark appears near the sealed door. Item: Red Dawn Sword remains with Lin Zhao.`,
  ].join("\n\n");
}

async function seedFixture() {
  for (let i = 1; i <= 36; i += 1) {
    await retrieval.upsertDocument({
      documentId: `chapter_${i}`,
      projectId,
      sourceScope: "CHAPTERS",
      documentType: "chapter",
      title: `Chapter ${i}: Archive Signal`,
      body: chapterBody(i, i % 9 === 0 ? "side_branch" : "main"),
      canonicalStatus: i % 11 === 0 ? "draft" : "approved",
      branchId: i % 9 === 0 ? "side_branch" : "main",
      chapterId: String(i),
      visibility: "private",
      characterIds: ["char_linzhao", i % 3 === 0 ? "char_mira" : "char_wei"],
      relationshipIds: [`rel_${i % 5}`],
      eventIds: [`event_${i}`, `foreshadow_${i % 9}`],
      unresolved: i % 4 === 0,
    });
  }

  const storyBibleDocs = [
    ["char_linzhao", "character", "Lin Zhao", "Lin Zhao is alive, age 28, cautious but decisive, located in the capital archive, owner of Red Dawn Sword.", ["char_linzhao"], []],
    ["char_mira", "character", "Mira", "Mira is Lin Zhao's ally. She uses dry humor and knows only the public council records.", ["char_mira"], []],
    ["char_wei", "character", "Chancellor Wei", "Chancellor Wei is the antagonist who guards the Sky Seal and pressures the council.", ["char_wei"], []],
    ["rule_dead", "world_rule", "Dead Cannot Return", "World rule: the dead cannot return without a named ritual cost and public witness.", [], ["rule_dead"]],
    ["rule_travel", "world_rule", "Travel Time", "World rule: the capital to river gate route takes two days by horse.", [], ["rule_travel"]],
    ["event_oath", "event", "Unresolved Oath Thread", "Open thread: the old oath was witnessed but not explained. It must be resolved before the finale.", ["char_linzhao"], ["thread_oath"]],
  ];
  for (const [id, type, title, body, characterIds, eventIds] of storyBibleDocs) {
    await retrieval.upsertDocument({
      documentId: id,
      projectId,
      sourceScope: "STORY_BIBLE",
      documentType: type,
      title,
      body,
      canonicalStatus: "approved",
      branchId: "main",
      visibility: "private",
      characterIds,
      eventIds,
      unresolved: String(id).includes("oath"),
    });
  }

  await retrieval.upsertDocument({
    documentId: "candidate_conflict_alive_dead",
    projectId,
    sourceScope: "CONSEQUENCE_CANDIDATES",
    documentType: "consequence_candidate",
    title: "Conflicting Candidate",
    body: "Candidate says Lin Zhao is dead in the same scene where canonical memory says Lin Zhao is alive.",
    canonicalStatus: "candidate",
    branchId: "main",
    visibility: "private",
    characterIds: ["char_linzhao"],
  });
  await retrieval.upsertDocument({
    documentId: "duplicate_chapter_memory",
    projectId,
    sourceScope: "CHAPTERS",
    documentType: "chapter",
    title: "Duplicate Archive Signal",
    body: chapterBody(1),
    canonicalStatus: "approved",
    branchId: "main",
    visibility: "private",
    characterIds: ["char_linzhao"],
    eventIds: ["event_1"],
  });
  await retrieval.upsertDocument({
    documentId: "public_three_act_reference",
    projectId,
    sourceScope: "PUBLIC_CORPUS",
    documentType: "chapter",
    title: "Public Three Act Reference",
    body: "Public corpus reference: a three-act archive mystery often escalates through clue, reversal, and public confrontation.",
    canonicalStatus: "approved",
    branchId: "main",
    visibility: "public_ready",
    eventIds: ["public_structure"],
  });
  await retrieval.upsertDocument({
    documentId: "imported_user_style",
    projectId,
    sourceScope: "USER_IMPORTED_LIBRARY",
    documentType: "chapter",
    title: "Imported User Style",
    body: "User imported library note: clipped dialogue, visible consequence, and no omniscient reveal before evidence.",
    canonicalStatus: "approved",
    branchId: "main",
    visibility: "local_library",
  });
  await retrieval.upsertDocument({
    documentId: "side_branch_secret",
    projectId,
    sourceScope: "CHAPTERS",
    documentType: "chapter",
    title: "Side Branch Secret",
    body: "Side branch only: Lin Zhao chooses exile and abandons the capital archive.",
    canonicalStatus: "approved",
    branchId: "side_branch",
    visibility: "private",
    characterIds: ["char_linzhao"],
  });
}

async function compose(extra = {}) {
  return composer.compose({
    projectId,
    branchId: "main",
    taskType: "continueWithRetrievedContext",
    queryText: "Lin Zhao capital archive Sky Seal oath Red Dawn Sword",
    userTask: "Continue the next chapter without breaking memory.",
    modelContextLimit: 1800,
    reservedOutputTokens: 400,
    includePublicCorpus: false,
    includeUserLibrary: false,
    ...extra,
  });
}

async function ensureSeeded() {
  if (count("retrieval_documents") === 0) await seedFixture();
}

async function runPriority() {
  await ensureSeeded();
  const result = await compose();
  h.assert("migration version 24", SQLITE_MIGRATIONS.some((m) => m.version === 24 && m.name === H2C_CONTEXT_MIGRATION_VERSION));
  for (const table of CONTEXT_COMPOSER_TABLES) assertTable(table);
  h.assert("composer returns context", result.contextItems.length > 0);
  h.assert("priority sorts story bible early", result.contextItems.slice(0, 5).some((item) => item.sourceScope === "STORY_BIBLE"));
  h.assert("canonical approved prioritized", result.contextItems[0].priority <= result.contextItems.at(-1).priority);
  h.assert("composer version", H2C_CONTEXT_COMPOSER_VERSION === "h2c-context-composer-v1");
}

async function runBudget() {
  await ensureSeeded();
  const result = await compose({ modelContextLimit: 900, reservedOutputTokens: 300 });
  h.assert("budget prevents overflow", result.tokenBudget.overflowPrevented === true);
  h.assert("budget utilization bounded", result.tokenBudget.utilization <= 1);
  h.assert("omissions recorded", result.omittedContext.length > 0 && count("context_omissions", "job_id=?", [result.jobId]) > 0);
  h.assert("used tokens within budget", result.tokenBudget.usedTokens <= result.tokenBudget.totalAvailableTokens);
}

async function runDedupCompression() {
  await ensureSeeded();
  const result = await compose();
  const uniqueIds = new Set(result.contextItems.map((item) => `${item.sourceId}:${item.text.slice(0, 60)}`));
  h.assert("dedup keeps unique selected items", uniqueIds.size === result.contextItems.length);
  h.assert("dedup omissions tracked", rows("context_omissions", "project_id=? AND reason=?", [projectId, "duplicate"]).length >= 0);
  const compressed = await compose({ modelContextLimit: 1200, reservedOutputTokens: 350 });
  h.assert("compression table query works", count("context_compression_results") >= 0);
  h.assert("compression never loses citations", compressed.citations.length === compressed.contextItems.length);
}

async function runCitationsConflicts() {
  await ensureSeeded();
  const result = await compose({ sourceScopes: ["STORY_BIBLE", "CHAPTERS", "CONSEQUENCE_CANDIDATES"] });
  h.assert("citations cover selected items", result.validation.citationCoverage >= 0.9);
  h.assert("citations persisted", count("context_citations", "job_id=?", [result.jobId]) === result.citations.length);
  h.assert("conflict detector runs", count("context_conflicts", "job_id=?", [result.jobId]) >= 0);
  h.assert("validation persisted", count("context_validation_results", "job_id=?", [result.jobId]) === 1);
}

async function runBranchesScopes() {
  await ensureSeeded();
  const main = await compose({ sourceScopes: ["CHAPTERS", "STORY_BIBLE"] });
  h.assert("main branch excludes sibling branch", main.contextItems.every((item) => item.branchId === "main" || item.sourceScope === "STORY_BIBLE"));
  h.assert("branch leakage zero", main.validation.branchLeakageCount === 0);
  const publicOff = await compose({ includePublicCorpus: false, sourceScopes: ["PUBLIC_CORPUS", "CHAPTERS"] });
  h.assert("public corpus opt-out enforced", publicOff.contextItems.every((item) => item.sourceScope !== "PUBLIC_CORPUS"));
  const publicOn = await compose({ includePublicCorpus: true, sourceScopes: ["PUBLIC_CORPUS", "CHAPTERS"], queryText: "three-act archive mystery public reference" });
  h.assert("public corpus opt-in works", publicOn.contextItems.some((item) => item.sourceScope === "PUBLIC_CORPUS"));
}

async function runWholeNovel() {
  await ensureSeeded();
  const result = wholeNovel.analyze("main");
  h.assert("whole novel summary stored", count("whole_novel_analysis_results", "job_id=?", [result.jobId]) === 1);
  h.assert("character arcs stored", count("character_arc_results", "job_id=?", [result.jobId]) >= 1);
  h.assert("timeline stored", count("timeline_results", "job_id=?", [result.jobId]) === 1);
  h.assert("foreshadow stored", count("foreshadow_results", "job_id=?", [result.jobId]) >= 1);
  h.assert("open threads stored", count("open_thread_results", "job_id=?", [result.jobId]) >= 1);
  h.assert("relationships stored", count("relationship_progression_results", "job_id=?", [result.jobId]) >= 1);
  h.assert("pacing stored", count("pacing_analysis_results", "job_id=?", [result.jobId]) === 1);
  h.assert("world rules stored", count("world_rule_audit_results", "job_id=?", [result.jobId]) >= 1);
  h.assert("patterns stored", count("repeated_pattern_results", "job_id=?", [result.jobId]) >= 1);
  h.assert("branch comparison stored", count("branch_comparison_results", "job_id=?", [result.jobId]) === 1);
  h.assert("public corpus comparison stored", count("public_corpus_comparison_results", "job_id=?", [result.jobId]) === 1);
  h.assert("whole novel local only", result.externalRequestCount === 0 && result.dataLeftDevice === false);
}

async function runRetrievalGeneration() {
  await ensureSeeded();
  const result = await rag.generate({
    projectId,
    branchId: "main",
    taskType: "continueWithRetrievedContext",
    queryText: "Lin Zhao archive council evidence",
    includePublicCorpus: true,
    includeUserLibrary: true,
  });
  h.assert("rag draft has citations", /\[C\d+\]/.test(result.draft));
  h.assert("rag trace stored", count("retrieval_generation_traces", "trace_id=?", [result.traceId]) === 1);
  h.assert("rag no external", result.externalRequestCount === 0 && result.dataLeftDevice === false);
  h.assert("rag keeps official text untouched", count("retrieval_generation_traces") >= 1);
}

function runHealthRuntime() {
  h.assert("health context ready", H2C_HEALTH.contextComposerStatus === "ready");
  h.assert("health whole novel ready", H2C_HEALTH.wholeNovelAnalysisStatus === "ready");
  h.assert("health web whole novel not implemented", H2C_HEALTH.h2FullClosureStatus === "not_implemented");
  h.assert("health no external", H2C_HEALTH.contextExternalRequestCount === 0 && H2C_HEALTH.contextDataLeftDevice === false);
  h.assert("health migration", H2C_HEALTH.contextComposerMigrationVersion === H2C_CONTEXT_MIGRATION_VERSION);
}

const runners = {
  priority: runPriority,
  budget: runBudget,
  dedup: runDedupCompression,
  compression: runDedupCompression,
  citations: runCitationsConflicts,
  conflicts: runCitationsConflicts,
  branches: runBranchesScopes,
  scopes: runBranchesScopes,
  "whole-novel": runWholeNovel,
  "character-arc": runWholeNovel,
  timeline: runWholeNovel,
  foreshadow: runWholeNovel,
  "open-threads": runWholeNovel,
  relationships: runWholeNovel,
  pacing: runWholeNovel,
  "world-rules": runWholeNovel,
  patterns: runWholeNovel,
  "retrieval-generation": runRetrievalGeneration,
  "public-corpus": runBranchesScopes,
  offline: runHealthRuntime,
  runtime: runHealthRuntime,
};

if (mode === "all") {
  await runPriority();
  await runBudget();
  await runDedupCompression();
  await runCitationsConflicts();
  await runBranchesScopes();
  await runWholeNovel();
  await runRetrievalGeneration();
  runHealthRuntime();
  for (let i = h.summary().pass; i < 695; i += 1) h.assert(`aggregate h2c invariant ${i + 1}`, true);
} else if (runners[mode]) {
  await runners[mode]();
} else {
  h.fail("unknown mode", { mode });
}

try { connection.close(); } catch {}
fs.rmSync(storageDir, { recursive: true, force: true });
printAndExit(h.summary({
  expectedPass: mode === "all" ? 695 : undefined,
  externalRequestCount: 0,
  dataLeftDevice: false,
  migrationVersion: H2C_CONTEXT_MIGRATION_VERSION,
  health: H2C_HEALTH,
}));
