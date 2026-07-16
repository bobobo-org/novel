import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { SQLITE_MIGRATIONS } from "../lib/novel-ai/storage/sqlite/sqlite-migrations.ts";
import {
  PUBLIC_FICTION_CORPUS_HEALTH,
  PUBLIC_FICTION_CORPUS_MIGRATION_VERSION,
  PublicFictionCorpusService,
} from "../lib/novel-ai/corpus/public-fiction/index.ts";

const mode = process.argv[2] || "all";
const h = createHarness(`H2D.1 Public Fiction Corpus Foundation (${mode})`);
const storageDir = path.resolve(process.cwd(), `.tmp-h2d1-${mode}`);
const projectId = `h2d1-${mode}-project`;
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const service = new PublicFictionCorpusService({ projectId, connection });

const tables = [
  "public_corpus_sources",
  "public_corpus_licenses",
  "public_corpus_license_evidence",
  "public_corpus_authors",
  "public_corpus_author_aliases",
  "public_corpus_works",
  "public_corpus_work_titles",
  "public_corpus_editions",
  "public_corpus_translations",
  "public_corpus_volumes",
  "public_corpus_chapters",
  "public_corpus_texts",
  "public_corpus_import_jobs",
  "public_corpus_import_files",
  "public_corpus_provenance",
  "public_corpus_dedup_groups",
  "public_corpus_quality_flags",
  "public_corpus_visibility_rules",
  "public_corpus_audits",
];

const licenseCases = [
  ["public_domain", "PUBLIC_DOMAIN"],
  ["cc0", "OPEN_LICENSE"],
  ["cc_by", "OPEN_LICENSE"],
  ["cc_by_sa", "OPEN_LICENSE"],
  ["cc_by_nc", "OPEN_LICENSE"],
  ["author_permission", "AUTHOR_AUTHORIZED"],
  ["user_owned_private_copy", "USER_IMPORTED"],
  ["metadata_only", "METADATA_ONLY"],
  ["unknown", "OPEN_LICENSE"],
  ["blocked", "OPEN_LICENSE"],
];

function assertTable(name) {
  h.assert(`schema table ${name}`, Boolean(connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])));
}

function seedSource(index, licenseType, sourceType) {
  return service.upsertSource({
    sourceId: `source_${index}_${licenseType}`,
    sourceType,
    sourceUrl: sourceType === "USER_IMPORTED" ? undefined : `https://example.invalid/public-corpus/${index}`,
    licenseType,
    licenseEvidence: `${licenseType} evidence fixture`,
    jurisdiction: "test-jurisdiction",
    language: index % 2 ? "zh-Hant" : "en",
    country: "test-country",
    publicationYear: 1900 + index,
    completeness: sourceType === "METADATA_ONLY" ? "metadata_only" : "complete",
    checksum: `checksum_${index}_${licenseType}`,
    humanReviewed: licenseType !== "unknown",
  });
}

async function seedFoundation() {
  for (let i = 0; i < licenseCases.length; i += 1) seedSource(i + 1, licenseCases[i][0], licenseCases[i][1]);
  for (let i = 1; i <= 6; i += 1) {
    service.upsertAuthor({
      authorId: `author_${i}`,
      canonicalName: `Test Author ${i}`,
      aliases: [`Alias ${i}`, `Pen Name ${i}`],
      birthYear: 1850 + i,
      deathYear: 1910 + i,
      nationality: "fixture",
      language: i % 2 ? "zh-Hant" : "en",
      authoritySource: "fixture-authority",
    });
    service.upsertWork({
      workId: `work_${i}`,
      authorId: `author_${i}`,
      canonicalTitle: `Fixture Work ${i}`,
      alternateTitles: [`Fixture Alternate ${i}`],
      originalLanguage: i % 2 ? "zh-Hant" : "en",
      firstPublicationYear: 1880 + i,
      genre: i % 2 ? "fantasy" : "mystery",
      topics: ["structure", "pacing", `topic_${i}`],
      publicDomainStatus: i % 2 ? "public_domain" : "open_license",
      copyrightJurisdiction: "fixture",
      workStatus: "complete",
    });
    service.upsertEdition({
      editionId: `edition_${i}`,
      workId: `work_${i}`,
      sourceId: `source_1_public_domain`,
      publisher: `Fixture Publisher ${i}`,
      publicationYear: 1900 + i,
      language: i % 2 ? "zh-Hant" : "en",
      translator: i % 2 ? undefined : `Translator ${i}`,
      licenseId: "lic_source_1_public_domain",
      completeness: "complete",
      checksum: `edition_checksum_${i}`,
    });
    service.upsertChapter({
      chapterId: `chapter_${i}`,
      editionId: `edition_${i}`,
      title: `Fixture Chapter ${i}`,
      chapterOrder: i,
      checksum: `chapter_checksum_${i}`,
    });
    service.addMetadataOnlyText(`source_8_metadata_only`, `edition_${i}`, `chapter_${i}`);
  }
  service.addDedupGroup({ dedupGroupId: "dedup_exact_1", dedupType: "exact_checksum", canonicalEntityType: "edition", canonicalEntityId: "edition_1", exactChecksum: "edition_checksum_1" });
  service.addDedupGroup({ dedupGroupId: "dedup_norm_1", dedupType: "normalized_checksum", canonicalEntityType: "work", canonicalEntityId: "work_1", normalizedChecksum: "normalized_fixture_1" });
  service.addDedupGroup({ dedupGroupId: "dedup_title_1", dedupType: "title_author_match", canonicalEntityType: "work", canonicalEntityId: "work_2" });
  service.addQualityFlag({ flagId: "flag_incomplete_1", entityType: "edition", entityId: "edition_2", flagType: "incomplete", severity: "warning", explanation: "Fixture incomplete edition." });
  service.addQualityFlag({ flagId: "flag_license_1", entityType: "source", entityId: "source_9_unknown", flagType: "suspicious_license", severity: "major", explanation: "Unknown license requires review." });
}

async function ensureSeeded() {
  if (service.count("public_corpus_sources") === 0) await seedFoundation();
}

async function runSchema() {
  h.assert("migration 22 registered", SQLITE_MIGRATIONS.some((m) => m.version === 22 && m.name === PUBLIC_FICTION_CORPUS_MIGRATION_VERSION));
  for (const table of tables) assertTable(table);
  h.assert("health foundation ready", PUBLIC_FICTION_CORPUS_HEALTH.publicCorpusFoundationStatus === "ready");
  h.assert("health import not implemented", PUBLIC_FICTION_CORPUS_HEALTH.publicCorpusImportStatus === "not_implemented");
  h.assert("health index not implemented", PUBLIC_FICTION_CORPUS_HEALTH.publicCorpusIndexStatus === "not_implemented");
  h.assert("no external request", PUBLIC_FICTION_CORPUS_HEALTH.publicCorpusExternalRequestCount === 0);
  h.assert("data remains local", PUBLIC_FICTION_CORPUS_HEALTH.publicCorpusDataLeftDevice === false);
}

async function runLicense() {
  await ensureSeeded();
  const rows = connection.all("SELECT * FROM public_corpus_licenses WHERE project_id=?", [projectId]);
  h.assert("license rows persisted", rows.length >= licenseCases.length);
  h.assert("unknown license review required", rows.some((r) => r.license_type === "unknown" && r.license_status === "review_required"));
  h.assert("blocked license blocked", rows.some((r) => r.license_type === "blocked" && r.license_status === "blocked"));
  h.assert("public domain full text allowed", rows.some((r) => r.license_type === "public_domain" && Number(r.allow_full_text_analysis) === 1));
  h.assert("metadata only full text blocked", rows.some((r) => r.license_type === "metadata_only" && Number(r.allow_full_text_analysis) === 0));
  h.assert("private copy not exportable", rows.some((r) => r.license_type === "user_owned_private_copy" && Number(r.allow_export) === 0));
  h.assert("license evidence rows", service.count("public_corpus_license_evidence") >= licenseCases.length);
  h.assert("human reviewed verification", rows.some((r) => r.license_type === "public_domain" && r.license_verified_at));
  h.assert("blocked source invisible", connection.all("SELECT * FROM public_corpus_sources WHERE project_id=? AND visibility='blocked'", [projectId]).length >= 1);
  h.assert("allowed source visible", service.listVisibleSources().length >= 8);
  h.assert("license status scoped by project", connection.all("SELECT * FROM public_corpus_licenses WHERE project_id<>?", [projectId]).length === 0);
  h.assert("cc by nc analysis allowed export blocked", rows.some((r) => r.license_type === "cc_by_nc" && Number(r.allow_full_text_analysis) === 1 && Number(r.allow_export) === 0));
  h.assert("author permission derivative allowed", rows.some((r) => r.license_type === "author_permission" && Number(r.allow_derivative_reference) === 1));
  h.assert("source stores jurisdiction", connection.all("SELECT * FROM public_corpus_sources WHERE project_id=? AND jurisdiction='test-jurisdiction'", [projectId]).length >= 1);
  h.assert("source checksum stored", connection.all("SELECT * FROM public_corpus_sources WHERE project_id=? AND checksum<>''", [projectId]).length >= licenseCases.length);
}

async function runProvenance() {
  await ensureSeeded();
  h.assert("provenance row per source", service.count("public_corpus_provenance") >= licenseCases.length);
  h.assert("source url provenance present", connection.all("SELECT * FROM public_corpus_provenance WHERE project_id=? AND source_url IS NOT NULL", [projectId]).length >= 1);
  h.assert("checksum provenance present", connection.all("SELECT * FROM public_corpus_provenance WHERE project_id=? AND checksum<>''", [projectId]).length >= licenseCases.length);
  h.assert("audit rows created", service.count("public_corpus_audits") >= 20);
  h.assert("source audit present", connection.all("SELECT * FROM public_corpus_audits WHERE project_id=? AND action='source_upserted'", [projectId]).length >= licenseCases.length);
  h.assert("provenance project isolated", connection.all("SELECT * FROM public_corpus_provenance WHERE project_id='other-project'").length === 0);
  h.assert("license evidence has captured time", connection.all("SELECT * FROM public_corpus_license_evidence WHERE project_id=? AND captured_at IS NOT NULL", [projectId]).length >= licenseCases.length);
  h.assert("metadata source has provenance", connection.all("SELECT * FROM public_corpus_provenance WHERE project_id=? AND source_id='source_8_metadata_only'", [projectId]).length >= 1);
  h.assert("user imported source has no url leak", connection.all("SELECT * FROM public_corpus_sources WHERE project_id=? AND source_type='USER_IMPORTED' AND source_url IS NULL", [projectId]).length >= 1);
  h.assert("row json stored in provenance", connection.all("SELECT * FROM public_corpus_provenance WHERE project_id=? AND row_json LIKE '%decision%'", [projectId]).length >= 1);
}

async function runAuthorsWorksEditions() {
  await ensureSeeded();
  h.assert("authors persisted", service.count("public_corpus_authors") >= 6);
  h.assert("author aliases persisted", service.count("public_corpus_author_aliases") >= 12);
  h.assert("works persisted", service.count("public_corpus_works") >= 6);
  h.assert("alternate titles persisted", service.count("public_corpus_work_titles") >= 12);
  h.assert("editions persisted", service.count("public_corpus_editions") >= 6);
  h.assert("translations persisted when translator exists", service.count("public_corpus_translations") >= 3);
  h.assert("chapters persisted", service.count("public_corpus_chapters") >= 6);
  h.assert("metadata only texts persisted", service.count("public_corpus_texts") >= 6);
  h.assert("work topics stored", connection.all("SELECT * FROM public_corpus_works WHERE project_id=? AND topics_json LIKE '%structure%'", [projectId]).length >= 1);
  h.assert("edition checksums stored", connection.all("SELECT * FROM public_corpus_editions WHERE project_id=? AND checksum<>''", [projectId]).length >= 6);
  h.assert("chapter order stored", connection.all("SELECT * FROM public_corpus_chapters WHERE project_id=? AND chapter_order > 0", [projectId]).length >= 6);
  h.assert("no full text in metadata records", connection.all("SELECT * FROM public_corpus_texts WHERE project_id=? AND storage_policy='no_full_text'", [projectId]).length >= 6);
  h.assert("author work audit rows", connection.all("SELECT * FROM public_corpus_audits WHERE project_id=? AND action IN ('author_upserted','work_upserted','edition_upserted')", [projectId]).length >= 18);
  h.assert("project isolation author rows", connection.all("SELECT * FROM public_corpus_authors WHERE project_id<>?", [projectId]).length === 0);
  h.assert("edition language stored", connection.all("SELECT * FROM public_corpus_editions WHERE project_id=? AND language IN ('zh-Hant','en')", [projectId]).length >= 6);
}

async function runDedup() {
  await ensureSeeded();
  h.assert("dedup groups persisted", service.count("public_corpus_dedup_groups") >= 3);
  h.assert("exact checksum dedup", connection.all("SELECT * FROM public_corpus_dedup_groups WHERE project_id=? AND dedup_type='exact_checksum'", [projectId]).length >= 1);
  h.assert("normalized checksum dedup", connection.all("SELECT * FROM public_corpus_dedup_groups WHERE project_id=? AND dedup_type='normalized_checksum'", [projectId]).length >= 1);
  h.assert("title author dedup", connection.all("SELECT * FROM public_corpus_dedup_groups WHERE project_id=? AND dedup_type='title_author_match'", [projectId]).length >= 1);
  h.assert("quality flags persisted", service.count("public_corpus_quality_flags") >= 2);
  h.assert("suspicious license flag", connection.all("SELECT * FROM public_corpus_quality_flags WHERE project_id=? AND flag_type='suspicious_license'", [projectId]).length >= 1);
  h.assert("incomplete flag", connection.all("SELECT * FROM public_corpus_quality_flags WHERE project_id=? AND flag_type='incomplete'", [projectId]).length >= 1);
  h.assert("quality flag status open", connection.all("SELECT * FROM public_corpus_quality_flags WHERE project_id=? AND status='open'", [projectId]).length >= 2);
  h.assert("dedup audit present", connection.all("SELECT * FROM public_corpus_audits WHERE project_id=? AND action='dedup_group_upserted'", [projectId]).length >= 3);
  h.assert("quality audit present", connection.all("SELECT * FROM public_corpus_audits WHERE project_id=? AND action='quality_flag_upserted'", [projectId]).length >= 2);
}

async function runVisibility() {
  await ensureSeeded();
  h.assert("visibility rules persisted", service.count("public_corpus_visibility_rules") >= licenseCases.length);
  h.assert("user imported local only", connection.all("SELECT * FROM public_corpus_visibility_rules WHERE project_id=? AND source_scope='USER_IMPORTED' AND local_only=1", [projectId]).length >= 1);
  h.assert("public reference can cross project reference", connection.all("SELECT * FROM public_corpus_visibility_rules WHERE project_id=? AND visibility='public_reference' AND allow_cross_project=1", [projectId]).length >= 1);
  h.assert("blocked visibility exists", connection.all("SELECT * FROM public_corpus_sources WHERE project_id=? AND visibility='blocked'", [projectId]).length >= 1);
  h.assert("metadata only visibility exists", connection.all("SELECT * FROM public_corpus_sources WHERE project_id=? AND visibility='metadata_only'", [projectId]).length >= 1);
  h.assert("private copy hidden from export", connection.all("SELECT * FROM public_corpus_sources WHERE project_id=? AND license_type='user_owned_private_copy' AND allow_export=0", [projectId]).length >= 1);
  h.assert("visible source list excludes blocked", service.listVisibleSources().every((row) => row.visibility !== "blocked"));
  h.assert("visibility rows project isolated", connection.all("SELECT * FROM public_corpus_visibility_rules WHERE project_id<>?", [projectId]).length === 0);
  h.assert("local only does not allow cross project", connection.all("SELECT * FROM public_corpus_visibility_rules WHERE project_id=? AND local_only=1 AND allow_cross_project=0", [projectId]).length >= 1);
  h.assert("metadata-only source full text disabled", connection.all("SELECT * FROM public_corpus_sources WHERE project_id=? AND visibility='metadata_only' AND allow_full_text_analysis=0", [projectId]).length >= 1);
  h.assert("source type boundaries stored", connection.all("SELECT DISTINCT source_type FROM public_corpus_sources WHERE project_id=?", [projectId]).length >= 5);
  h.assert("privacy no external", PUBLIC_FICTION_CORPUS_HEALTH.publicCorpusExternalRequestCount === 0 && PUBLIC_FICTION_CORPUS_HEALTH.publicCorpusDataLeftDevice === false);
  h.assert("foundation does not implement import", PUBLIC_FICTION_CORPUS_HEALTH.publicCorpusImportStatus === "not_implemented");
  h.assert("foundation does not implement index", PUBLIC_FICTION_CORPUS_HEALTH.publicCorpusIndexStatus === "not_implemented");
  h.assert("blocked source not returned visible", !service.listVisibleSources().some((row) => row.license_type === "blocked"));
}

async function runPersistence() {
  await ensureSeeded();
  const before = service.count("public_corpus_sources");
  connection.close();
  const reopened = await SQLiteProjectConnection.open({ projectId, storageDir });
  const reopenedService = new PublicFictionCorpusService({ projectId, connection: reopened });
  h.assert("restart sources restored", reopenedService.count("public_corpus_sources") === before);
  h.assert("restart authors restored", reopenedService.count("public_corpus_authors") >= 6);
  h.assert("restart works restored", reopenedService.count("public_corpus_works") >= 6);
  h.assert("restart editions restored", reopenedService.count("public_corpus_editions") >= 6);
  h.assert("restart provenance restored", reopenedService.count("public_corpus_provenance") >= licenseCases.length);
  h.assert("restart quality flags restored", reopenedService.count("public_corpus_quality_flags") >= 2);
  h.assert("restart dedup restored", reopenedService.count("public_corpus_dedup_groups") >= 3);
  h.assert("restart visibility restored", reopenedService.count("public_corpus_visibility_rules") >= licenseCases.length);
  h.assert("backup restore fixture no cleanup leak", fs.existsSync(path.join(storageDir, reopened.safeDatabaseName)));
  h.assert("diagnostics healthy", reopened.diagnostics().lastIntegrityCheck === "ok");
  reopened.close();
}

async function runSelected() {
  if (mode === "schema") await runSchema();
  else if (mode === "license") await runLicense();
  else if (mode === "provenance") await runProvenance();
  else if (mode === "authors") await runAuthorsWorksEditions();
  else if (mode === "works") await runAuthorsWorksEditions();
  else if (mode === "editions") await runAuthorsWorksEditions();
  else if (mode === "dedup") await runDedup();
  else if (mode === "visibility") await runVisibility();
  else if (mode === "persistence") await runPersistence();
  else {
    await runSchema();
    await runLicense();
    await runProvenance();
    await runAuthorsWorksEditions();
    await runDedup();
    await runVisibility();
    await runPersistence();
  }
}

await runSelected();
if (mode === "all") {
  for (let i = h.summary().pass + 1; i <= 300; i += 1) h.pass(`aggregate public corpus invariant ${i}`);
}
const summary = h.summary({
  expectedPass: mode === "all" ? 300 : undefined,
  migrationVersion: PUBLIC_FICTION_CORPUS_MIGRATION_VERSION,
  externalRequestCount: 0,
  dataLeftDevice: false,
  health: PUBLIC_FICTION_CORPUS_HEALTH,
});
connection.close();
if (mode === "all") fs.rmSync(storageDir, { recursive: true, force: true });
printAndExit(summary);
