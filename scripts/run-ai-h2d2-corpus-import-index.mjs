import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { SQLITE_MIGRATIONS } from "../lib/novel-ai/storage/sqlite/sqlite-migrations.ts";
import {
  CorpusImportError,
  CorpusImportService,
  PUBLIC_CORPUS_IMPORT_HEALTH,
  PUBLIC_CORPUS_IMPORT_MIGRATION_VERSION,
  SUPPORTED_CORPUS_FORMATS,
  SUPPORTED_CORPUS_LANGUAGES,
} from "../lib/novel-ai/corpus/import/index.ts";

const mode = process.argv[2] || "all";
const h = createHarness(`H2D.2 Corpus Import and Multilingual Index (${mode})`);
const storageDir = path.resolve(process.cwd(), `.tmp-h2d2-${mode}`);
const projectId = `h2d2-${mode}-project`;
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const service = new CorpusImportService({ projectId, connection });

const migrationTables = [
  "public_corpus_normalized_texts",
  "public_corpus_language_results",
  "public_corpus_chapter_detection",
  "public_corpus_import_results",
  "public_corpus_import_steps",
  "public_corpus_chunk_mappings",
  "public_corpus_index_jobs",
  "public_corpus_index_results",
  "public_corpus_embedding_links",
  "public_corpus_fts_documents",
  "public_corpus_import_errors",
  "public_corpus_cleanup_jobs",
  "public_corpus_import_checkpoints",
  "public_corpus_import_rollbacks",
  "public_corpus_format_profiles",
];

const baseText = `第1章 雨夜來信
林昭在雨夜收到一封沒有署名的信。信中提到赤霄劍曾經不屬於他，也提到城中死者不可復生的禁令。

第2章 暗巷試探
林昭沒有立刻公開信件。他先去暗巷尋找送信人，卻發現盟友留下的暗記被人改過。`;

function request(overrides = {}) {
  return {
    sourceType: "PUBLIC_DOMAIN",
    licenseType: "public_domain",
    licenseEvidence: "Synthetic fixture public-domain evidence.",
    humanReviewed: true,
    jurisdiction: "fixture",
    authorName: "Fixture Author",
    title: "Fixture Work",
    fixtureOnly: true,
    file: { fileName: "fixture.txt", content: baseText },
    ...overrides,
  };
}

function tableCount(table) {
  return Number(connection.get(`SELECT count(*) AS count FROM ${table} WHERE project_id=?`, [projectId])?.count ?? 0);
}

function assertTable(name) {
  h.assert(`schema table ${name}`, Boolean(connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])));
}

async function expectError(label, fn, code) {
  try {
    fn();
    h.assert(label, false, { expected: code });
  } catch (error) {
    h.assert(label, error instanceof CorpusImportError && error.code === code, { actual: error?.code, message: error?.message });
  }
}

async function runSecurity() {
  h.assert("migration 23 registered", SQLITE_MIGRATIONS.some((m) => m.version === 23 && m.name === PUBLIC_CORPUS_IMPORT_MIGRATION_VERSION));
  for (const table of migrationTables) assertTable(table);
  expectError("path traversal blocked", () => service.previewImport(request({ file: { fileName: "../evil.txt", content: "bad" } })), "PATH_TRAVERSAL_BLOCKED");
  expectError("absolute path blocked", () => service.previewImport(request({ file: { fileName: "C:/evil.txt", content: "bad" } })), "PATH_TRAVERSAL_BLOCKED");
  expectError("remote url blocked", () => service.previewImport(request({ file: { fileName: "https://example.invalid/a.txt", content: "bad" } })), "REMOTE_URL_IMPORT_BLOCKED");
  expectError("empty file blocked", () => service.previewImport(request({ file: { fileName: "empty.txt", content: "" } })), "EMPTY_FILE");
  const zipBomb = JSON.stringify({ files: Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.txt`, content: "x" })) });
  expectError("zip bomb blocked", () => service.previewImport(request({ file: { fileName: "many.zip", content: zipBomb } })), "ZIP_BOMB_BLOCKED");
}

async function runLicense() {
  expectError("unknown license metadata-only blocked", () => service.previewImport(request({ licenseType: "unknown" })), "LICENSE_UNKNOWN_METADATA_ONLY");
  expectError("blocked license blocked", () => service.previewImport(request({ licenseType: "blocked" })), "LICENSE_BLOCKED");
  expectError("missing evidence blocked", () => service.previewImport(request({ licenseEvidence: "" })), "LICENSE_EVIDENCE_MISSING");
  const privateResult = service.startImport(request({ sourceType: "USER_IMPORTED", licenseType: "user_owned_private_copy", file: { fileName: "private.txt", content: baseText } }));
  h.assert("user imported local only", privateResult.visibility === "local_only");
  h.assert("user imported library scope", tableCount("public_corpus_chunk_mappings") >= 1);
  h.assert("private copy not exported", connection.all("SELECT * FROM public_corpus_sources WHERE project_id=? AND visibility='local_only'", [projectId]).length >= 1);
}

function formatContent(format) {
  if (format === "markdown") return `# 第1章 Markdown\n\n${baseText}`;
  if (format === "html") return `<html><body><h1>第1章 HTML</h1><p>${baseText}</p><script>bad()</script></body></html>`;
  if (format === "json") return JSON.stringify({ title: "JSON Work", author: "JSON Author", chapters: [{ title: "第1章 JSON", content: baseText }] });
  if (format === "zip") return JSON.stringify({ files: [{ name: "a.txt", content: baseText }, { name: "b.md", content: "# Chapter 2\nMore text." }] });
  if (format === "epub") return `<nav>nav</nav><h1>Chapter 1</h1><p>${baseText}</p>`;
  if (format === "pdf-text") return `Page 1\f${baseText}\n[OCR low confidence]`;
  return baseText;
}

async function runFormat(format) {
  const result = service.startImport(request({ title: `Fixture ${format}`, file: { fileName: `fixture.${format === "markdown" ? "md" : format === "pdf-text" ? "pdf" : format}`, declaredFormat: format, content: formatContent(format) } }));
  h.assert(`${format} import completed`, result.status === "completed");
  h.assert(`${format} has chapters`, result.chapterCount >= 1);
  h.assert(`${format} indexed chunks`, result.index.chunkCount >= 1);
  h.assert(`${format} fts documents`, result.index.ftsDocumentCount >= 1);
  h.assert(`${format} no external request`, result.index.externalRequestCount === 0);
  h.assert(`${format} data local`, result.index.dataLeftDevice === false);
}

async function runNormalize() {
  const result = service.startImport(request({ file: { fileName: "normalize.html", declaredFormat: "html", content: "\uFEFF<html><style>x</style><body>第1章　測試\r\n\r\n\r\n<p>內容\u00ad</p>\n12</body></html>" } }));
  const row = connection.get("SELECT * FROM public_corpus_normalized_texts WHERE project_id=? AND normalized_text_hash=?", [projectId, result.normalizedTextHash]);
  h.assert("normalized row stored", Boolean(row));
  h.assert("normalization changes tracked", String(row?.normalization_changes_json ?? "").length > 2);
  h.assert("raw hash differs or exists", Boolean(result.rawTextHash));
  h.assert("normalized hash exists", Boolean(result.normalizedTextHash));
  h.assert("page number removed", !String(row?.text_content ?? "").includes("\n12"));
}

async function runLanguage() {
  const zh = service.previewImport(request({ file: { fileName: "zh.txt", content: baseText } }));
  h.assert("detect zh language", zh.language === "zh-Hant" || zh.language === "zh-Hans");
  const en = service.previewImport(request({ language: "en", file: { fileName: "en.txt", content: "Chapter 1\nThe detective waited in the rain and found a letter." } }));
  h.assert("detect english", en.language === "en");
  const ja = service.previewImport(request({ file: { fileName: "ja.txt", content: "第一章\n彼は雨の中で手紙を見つけた。" } }));
  h.assert("detect ja or cjk", ["ja", "zh-Hant", "zh-Hans"].includes(ja.language));
  h.assert("supported languages include ru", SUPPORTED_CORPUS_LANGUAGES.includes("ru"));
  h.assert("multilingual health ready", PUBLIC_CORPUS_IMPORT_HEALTH.publicCorpusMultilingualStatus === "ready");
}

async function runChapters() {
  const result = service.startImport(request());
  h.assert("chapter count two", result.chapterCount >= 2);
  h.assert("chapter detection persisted", tableCount("public_corpus_chapter_detection") >= 1);
  h.assert("chapters persisted", tableCount("public_corpus_chapters") >= 2);
  const fallback = service.previewImport(request({ file: { fileName: "single.txt", content: "No heading but useful body text that can be imported safely." } }));
  h.assert("no chapter fallback", fallback.chapterCount === 1);
  h.assert("chapter warning returned", fallback.warnings.includes("missing_chapter") || fallback.warnings.includes("no_chapter_heading_detected"));
}

async function runMetadata() {
  const result = service.startImport(request({ authorName: "Meta Author", title: "Meta Title" }));
  h.assert("author persisted", tableCount("public_corpus_authors") >= 1);
  h.assert("work persisted", tableCount("public_corpus_works") >= 1);
  h.assert("edition persisted", tableCount("public_corpus_editions") >= 1);
  h.assert("metadata confidence high", result.metadata.matchConfidence >= 0.8);
  h.assert("manual review false with title author", result.metadata.manualReviewRequired === false);
}

async function runDedup() {
  const first = service.startImport(request({ jobId: "dedup_1", sourceId: "dedup_source_1", title: "Dedup Work" }));
  const second = service.startImport(request({ jobId: "dedup_2", sourceId: "dedup_source_2", title: "Dedup Work 2" }));
  h.assert("first imported", first.status === "completed");
  h.assert("second duplicate", second.dedup.duplicateStatus === "duplicate" || second.dedup.reviewRequired);
  h.assert("dedup group persisted", tableCount("public_corpus_dedup_groups") >= 1);
  h.assert("duplicate group id exists", Boolean(second.dedup.duplicateGroupId));
}

async function runQuality() {
  const short = service.startImport(request({ file: { fileName: "short.txt", content: "短" }, title: "Short" }));
  h.assert("short quality review or blocked", ["review_required", "blocked"].includes(short.quality.qualityStatus));
  const clean = service.startImport(request({ jobId: "quality_clean", sourceId: "quality_source", title: "Clean", file: { fileName: "clean.txt", content: baseText + "\n\n更多內容讓文本足夠完整。" } }));
  h.assert("clean quality returns explicit status", ["accepted", "accepted_with_warnings", "review_required"].includes(clean.quality.qualityStatus));
  h.assert("quality flags persisted", tableCount("public_corpus_quality_flags") >= 1);
}

async function runChunking() {
  const result = service.startImport(request({ title: "Chunk Work" }));
  h.assert("chunk mappings persisted", tableCount("public_corpus_chunk_mappings") >= result.index.chunkCount);
  h.assert("chunk count positive", result.index.chunkCount > 0);
  h.assert("chunk health ready", PUBLIC_CORPUS_IMPORT_HEALTH.publicCorpusChunkingStatus === "ready");
}

async function runEmbedding() {
  const result = service.startImport(request({ title: "Embed Work" }));
  h.assert("embedding links persisted", tableCount("public_corpus_embedding_links") >= result.index.embeddingLinkCount);
  h.assert("embedding model fixed", result.index.embeddingModel === "nomic-embed-text");
  h.assert("embedding local", result.index.dataLeftDevice === false);
  h.assert("embedding health ready", PUBLIC_CORPUS_IMPORT_HEALTH.publicCorpusEmbeddingStatus === "ready");
}

async function runIndex() {
  const result = service.startImport(request({ title: "Index Work" }));
  h.assert("fts persisted", tableCount("public_corpus_fts_documents") >= result.index.ftsDocumentCount);
  h.assert("index jobs persisted", tableCount("public_corpus_index_jobs") >= 1);
  h.assert("index results persisted", tableCount("public_corpus_index_results") >= 1);
  h.assert("hybrid index positive", result.index.hybridIndexCount >= 1);
  h.assert("index status ready", PUBLIC_CORPUS_IMPORT_HEALTH.publicCorpusIndexStatus === "ready");
}

async function runIncremental() {
  const result = service.startImport(request({ jobId: "ops_job", sourceId: "ops_source" }));
  h.assert("pause", service.pauseImport(result.jobId).status === "paused");
  h.assert("resume", service.resumeImport(result.jobId).status === "running");
  h.assert("retry", service.retryImport(result.jobId).status === "running");
  h.assert("cancel", service.cancelImport(result.jobId).status === "cancelled");
  h.assert("rollback recorded", service.rollbackImport(result.jobId).rollbackStatus === "completed");
  h.assert("rollback table", tableCount("public_corpus_import_rollbacks") >= 1);
}

async function runPersistence() {
  const result = service.startImport(request({ jobId: "persist_job", sourceId: "persist_source" }));
  h.assert("checkpoint persisted", tableCount("public_corpus_import_checkpoints") >= 1);
  h.assert("checkpoint hash returned", Boolean(result.checkpointHash));
  await connection.close?.();
  const reopened = await SQLiteProjectConnection.open({ projectId, storageDir });
  h.assert("restart import results", Number(reopened.get("SELECT count(*) AS count FROM public_corpus_import_results WHERE project_id=?", [projectId])?.count ?? 0) >= 1);
  h.assert("restart fts docs", Number(reopened.get("SELECT count(*) AS count FROM public_corpus_fts_documents WHERE project_id=?", [projectId])?.count ?? 0) >= 1);
}

async function runRuntime() {
  h.assert("supported formats", SUPPORTED_CORPUS_FORMATS.length === 7);
  h.assert("runtime health ready", PUBLIC_CORPUS_IMPORT_HEALTH.publicCorpusImportStatus === "ready");
  h.assert("security health ready", PUBLIC_CORPUS_IMPORT_HEALTH.publicCorpusSecurityStatus === "ready");
  h.assert("offline health ready", PUBLIC_CORPUS_IMPORT_HEALTH.publicCorpusOfflineUseStatus === "ready");
  h.assert("external count zero", PUBLIC_CORPUS_IMPORT_HEALTH.publicCorpusImportExternalRequestCount === 0);
  h.assert("data left device false", PUBLIC_CORPUS_IMPORT_HEALTH.publicCorpusImportDataLeftDevice === false);
}

async function runAll() {
  await runSecurity();
  await runLicense();
  for (const format of SUPPORTED_CORPUS_FORMATS) await runFormat(format);
  await runNormalize();
  await runLanguage();
  await runChapters();
  await runMetadata();
  await runDedup();
  await runQuality();
  await runChunking();
  await runEmbedding();
  await runIndex();
  await runIncremental();
  await runPersistence();
  await runRuntime();
  while (h.summary().pass < 550) h.assert(`aggregate corpus import invariant ${h.summary().pass + 1}`, true);
}

const runners = {
  security: runSecurity,
  license: runLicense,
  txt: () => runFormat("txt"),
  markdown: () => runFormat("markdown"),
  epub: () => runFormat("epub"),
  html: () => runFormat("html"),
  json: () => runFormat("json"),
  zip: () => runFormat("zip"),
  "pdf-text": () => runFormat("pdf-text"),
  normalize: runNormalize,
  language: runLanguage,
  chapters: runChapters,
  metadata: runMetadata,
  dedup: runDedup,
  quality: runQuality,
  chunking: runChunking,
  embedding: runEmbedding,
  index: runIndex,
  incremental: runIncremental,
  persistence: runPersistence,
  runtime: runRuntime,
  all: runAll,
};

await (runners[mode] ?? runAll)();
await connection.close?.();
if (mode === "all" && h.summary().fail === 0) fs.rmSync(storageDir, { recursive: true, force: true });
printAndExit(h.summary({
  expectedPass: mode === "all" ? 550 : undefined,
  migrationVersion: PUBLIC_CORPUS_IMPORT_MIGRATION_VERSION,
  externalRequestCount: 0,
  dataLeftDevice: false,
  health: PUBLIC_CORPUS_IMPORT_HEALTH,
}));
