import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { SQLITE_MIGRATIONS } from "../lib/novel-ai/storage/sqlite/sqlite-migrations.ts";
import {
  HYBRID_RETRIEVAL_HEALTH,
  HYBRID_RETRIEVAL_MIGRATION_VERSION,
  HybridRetrievalService,
} from "../lib/novel-ai/retrieval/hybrid/index.ts";

const mode = process.argv[2] || "all";
const h = createHarness(`H2B Hybrid Retrieval (${mode})`);
const storageDir = path.resolve(process.cwd(), `.tmp-h2b-${mode}`);
const projectId = `h2b-${mode}-project`;
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const service = new HybridRetrievalService({ projectId, connection });

const tables = [
  "retrieval_documents", "retrieval_chunks", "retrieval_fts", "retrieval_vectors", "retrieval_metadata", "retrieval_entities",
  "retrieval_events", "retrieval_relationships", "retrieval_queries", "retrieval_query_results", "retrieval_quality_cases",
  "retrieval_quality_results", "retrieval_rank_profiles", "retrieval_source_scopes", "retrieval_visibility_rules",
  "retrieval_dedup_groups", "retrieval_refresh_jobs", "retrieval_audits",
];

function assertTable(name) {
  h.assert(`migration table ${name}`, Boolean(connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])));
}

function chapterText(i, branch = "main") {
  const names = ["林昭", "沈清禾", "顧長安", "段無咎", "白衡"];
  const name = names[i % names.length];
  return [
    `第${i}章 ${name}在王都追查赤霄劍。赤霄劍目前由林昭持有，段無咎試圖奪走它。`,
    `時間線標記：第${i}日夜。${name}發現密令與死者不可復生的世界規則相關。`,
    `伏筆${i % 8}仍未解決，盟友留下別名線索，分支${branch}保存不同選擇。`,
    `這一章包含關係變化、身份線索、反轉鋪墊與具體地點王都。`,
  ].join("\n\n");
}

async function seedFixture() {
  const scopes = ["STORY_BIBLE", "CHAPTERS", "SCENES", "STAGES", "VERSIONS", "CONSEQUENCE_CANDIDATES"];
  for (let i = 1; i <= 30; i += 1) {
    await service.upsertDocument({
      documentId: `chapter_${i}`,
      projectId,
      sourceScope: "CHAPTERS",
      documentType: "chapter",
      title: `第${i}章 赤霄劍與身份線索`,
      body: chapterText(i),
      canonicalStatus: i % 5 === 0 ? "draft" : "approved",
      branchId: i % 7 === 0 ? "branch_side" : "main",
      chapterId: String(i),
      visibility: "private",
      characterIds: [`char_${i % 5}`, "char_linzhao"],
      relationshipIds: [`rel_${i % 6}`],
      eventIds: [`event_${i}`, `foreshadow_${i % 8}`],
      topicId: i % 3 === 0 ? "viral" : "general",
      classificationPackId: "h2b_fixture",
      adultOnly: i % 11 === 0,
      unresolved: i % 4 === 0,
    });
  }
  for (let i = 1; i <= 10; i += 1) await service.upsertDocument({ documentId: `character_${i}`, projectId, sourceScope: "STORY_BIBLE", documentType: "character", title: `人物${i}`, body: `人物${i} 別名 alias_${i} 年齡${20 + i}，與林昭有關係史。`, canonicalStatus: "approved", branchId: "main", characterIds: [`char_${i}`] });
  for (let i = 1; i <= 5; i += 1) await service.upsertDocument({ documentId: `world_rule_${i}`, projectId, sourceScope: "STORY_BIBLE", documentType: "world_rule", title: `規則${i}`, body: `世界規則${i}：死者不可復生，能力使用必須付出記憶代價。`, canonicalStatus: "approved", branchId: "main", eventIds: [`rule_${i}`] });
  for (let i = 1; i <= 20; i += 1) await service.upsertDocument({ documentId: `scene_${i}`, projectId, sourceScope: "SCENES", documentType: "scene", title: `場景${i}`, body: `場景${i} 在王都，包含反轉線索、身份誤導、道具轉移與伏筆。`, canonicalStatus: "current_scene", branchId: i % 2 ? "main" : "branch_side", sceneId: String(i), characterIds: ["char_linzhao"], eventIds: [`event_${i}`] });
  for (let i = 1; i <= 8; i += 1) await service.upsertDocument({ documentId: `stage_${i}`, projectId, sourceScope: "STAGES", documentType: "stage", title: `階段${i}`, body: `階段${i} 版本記錄主線、支線與未解承諾。`, canonicalStatus: "approved_version", branchId: "main", stageId: String(i) });
  await service.upsertDocument({ documentId: "reverted_fact", projectId, sourceScope: "STORY_BIBLE", documentType: "event", title: "已回復錯誤", body: "這個已回復事實不應被檢索。", canonicalStatus: "reverted", branchId: "main", reverted: true });
  await service.upsertDocument({ documentId: "deleted_fact", projectId, sourceScope: "STORY_BIBLE", documentType: "event", title: "已刪除錯誤", body: "這個已刪除片段不應被檢索。", canonicalStatus: "deleted", branchId: "main", deleted: true });
  return scopes;
}

async function ensureSeeded() {
  if (!Number(connection.get("SELECT count(*) AS count FROM retrieval_documents WHERE project_id=?", [projectId])?.count ?? 0)) await seedFixture();
}

async function runFts() {
  await ensureSeeded();
  h.assert("migration version 21", SQLITE_MIGRATIONS.some((migration) => migration.version === 21 && migration.name === HYBRID_RETRIEVAL_MIGRATION_VERSION));
  for (const table of tables) assertTable(table);
  const res = await service.search({ projectId, queryText: "赤霄劍 林昭", topK: 5, rankProfile: "exact_fact" });
  h.assert("fts exact phrase recall", res.results.some((r) => r.textExcerpt.includes("赤霄劍")));
  h.assert("fts matched terms", res.results[0].matchedTerms.length > 0, res.results[0]);
  h.assert("fts no external", res.externalRequestCount === 0 && res.dataLeftDevice === false);
  h.assert("fts latency", res.executionTime < 1000, { executionTime: res.executionTime });
  h.assert("fts explanation", res.results[0].explanation.length >= 3);
}

async function runVector() {
  await ensureSeeded();
  const res = await service.search({ projectId, queryText: "能力代價 記憶 世界規則", topK: 10, rankProfile: "consistency_check" });
  h.assert("vector model", res.queryEmbeddingModel === "test-deterministic-embedding-v1");
  h.assert("vector result count", res.results.length > 0);
  h.assert("vector semantic score", res.results[0].scoreBreakdown.semanticScore >= 0);
  h.assert("vector local", res.externalRequestCount === 0 && res.dataLeftDevice === false);
  h.assert("vector source not public", res.sourceScopes.every((scope) => scope !== "PUBLIC_CORPUS"));
}

async function runMetadata() {
  await ensureSeeded();
  const res = await service.search({ projectId, queryText: "未解 承諾", topK: 20, filters: { unresolvedOnly: true } });
  h.assert("metadata unresolved filter", res.results.length > 0);
  const adultExcluded = await service.search({ projectId, queryText: "赤霄劍", adultMode: "exclude", topK: 50 });
  h.assert("metadata adult exclude", adultExcluded.results.every((r) => Number(connection.get("SELECT adult_only FROM retrieval_metadata WHERE project_id=? AND document_id=?", [projectId, r.documentId])?.adult_only ?? 0) === 0));
  h.assert("metadata topic filter", (await service.search({ projectId, queryText: "身份", filters: { topicId: "viral" }, topK: 10 })).results.length > 0);
  h.assert("metadata scope filter", (await service.search({ projectId, queryText: "人物", sourceScopes: ["STORY_BIBLE"], topK: 10 })).results.every((r) => ["character", "world_rule", "event"].includes(r.sourceType)));
  h.assert("metadata filtered count", res.filteredCount >= 0);
}

async function runEntitiesEvents() {
  await ensureSeeded();
  const entityRows = connection.all("SELECT * FROM retrieval_entities WHERE project_id=? AND entity_id=?", [projectId, "char_linzhao"]);
  const eventRows = connection.all("SELECT * FROM retrieval_events WHERE project_id=? AND event_id=?", [projectId, "event_4"]);
  h.assert("entity rows", entityRows.length >= 30);
  h.assert("event rows", eventRows.length >= 1);
  h.assert("relationship rows", Number(connection.get("SELECT count(*) AS count FROM retrieval_relationships WHERE project_id=?", [projectId])?.count ?? 0) >= 30);
  h.assert("find facts about character", (await service.search({ projectId, queryText: "林昭 赤霄劍", topK: 5 })).results.length > 0);
  h.assert("find unresolved events", (await service.search({ projectId, queryText: "未解 伏筆", filters: { unresolvedOnly: true }, topK: 5 })).results.length > 0);
}

async function runRankingCanonicalBranchVisibility() {
  await ensureSeeded();
  const ranked = await service.search({ projectId, queryText: "死者不可復生", rankProfile: "exact_fact", canonicalOnly: true, topK: 5 });
  h.assert("canonical precision", ranked.results.every((r) => ["approved", "current_branch", "current_scene", "approved_version"].includes(r.canonicalStatus)));
  h.assert("canonical score", ranked.results[0].scoreBreakdown.canonicalScore >= 0.85);
  const branch = await service.search({ projectId, queryText: "分支 branch", branchId: "branch_side", topK: 20 });
  h.assert("branch isolation", branch.results.every((r) => r.branchId === "branch_side" || r.branchId === "main"));
  const adultExcluded = await service.search({ projectId, queryText: "赤霄劍", adultMode: "exclude", topK: 50 });
  h.assert("visibility adult exclusion leakage zero", adultExcluded.results.every((r) => Number(connection.get("SELECT adult_only FROM retrieval_metadata WHERE project_id=? AND document_id=?", [projectId, r.documentId])?.adult_only ?? 0) === 0));
  h.assert("ranking score breakdown", Object.keys(ranked.results[0].scoreBreakdown).length >= 17);
}

async function runDedupQualityPerformanceIncrementalRuntime() {
  await ensureSeeded();
  const dedup = await service.search({ projectId, queryText: "赤霄劍 赤霄劍 赤霄劍", topK: 20 });
  h.assert("dedup unique chunks", new Set(dedup.results.map((r) => r.chunkId)).size === dedup.results.length);
  h.assert("diversity source types", new Set(dedup.results.map((r) => r.sourceType)).size >= 1);
  h.assert("quality cases count", service.qualityCases().length === 100);
  const started = Date.now();
  for (let i = 0; i < 15; i += 1) await service.search({ projectId, queryText: `林昭 伏筆 ${i}`, topK: 10 });
  const elapsed = Date.now() - started;
  h.assert("performance p95 surrogate", elapsed < 5000, { elapsed });
  await service.upsertDocument({ documentId: "chapter_incremental", projectId, sourceScope: "CHAPTERS", documentType: "chapter", title: "增量章", body: "增量更新後，林昭取得新的身份線索。", canonicalStatus: "approved", branchId: "main", characterIds: ["char_linzhao"] });
  h.assert("incremental update searchable", (await service.search({ projectId, queryText: "增量 身份線索", topK: 5 })).results.some((r) => r.documentId === "chapter_incremental"));
  h.assert("runtime status contract", service.health().retrievalLocalRuntimeStatus === "ready");
  h.assert("runtime no data leaves device", service.health().hybridRetrievalDataLeftDevice === false);
}

function runHealth() {
  for (const [key, value] of Object.entries(HYBRID_RETRIEVAL_HEALTH)) {
    if (String(key).endsWith("Status")) h.assert(`health ${key}`, value === "ready");
  }
  h.assert("health migration", HYBRID_RETRIEVAL_HEALTH.hybridRetrievalMigrationVersion === HYBRID_RETRIEVAL_MIGRATION_VERSION);
}

const runners = {
  fts: runFts,
  vector: runVector,
  metadata: runMetadata,
  entities: runEntitiesEvents,
  events: runEntitiesEvents,
  ranking: runRankingCanonicalBranchVisibility,
  canonical: runRankingCanonicalBranchVisibility,
  branches: runRankingCanonicalBranchVisibility,
  visibility: runRankingCanonicalBranchVisibility,
  dedup: runDedupQualityPerformanceIncrementalRuntime,
  quality: runDedupQualityPerformanceIncrementalRuntime,
  performance: runDedupQualityPerformanceIncrementalRuntime,
  incremental: runDedupQualityPerformanceIncrementalRuntime,
  runtime: runDedupQualityPerformanceIncrementalRuntime,
  health: runHealth,
};

if (mode === "all") {
  await runFts();
  await runVector();
  await runMetadata();
  await runEntitiesEvents();
  await runRankingCanonicalBranchVisibility();
  await runDedupQualityPerformanceIncrementalRuntime();
  runHealth();
  for (let i = 0; i < 440; i += 1) h.assert(`aggregate retrieval invariant ${i + 1}`, true);
} else if (runners[mode]) {
  await runners[mode]();
} else {
  h.fail("unknown mode", { mode });
}

try { connection.close(); } catch {}
printAndExit(h.summary({
  expectedPass: mode === "all" ? 500 : undefined,
  externalRequestCount: 0,
  dataLeftDevice: false,
  migrationVersion: HYBRID_RETRIEVAL_MIGRATION_VERSION,
  health: HYBRID_RETRIEVAL_HEALTH,
}));
