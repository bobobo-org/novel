import crypto from "crypto";
import type {
  PublicCorpusAuthorInput,
  PublicCorpusChapterInput,
  PublicCorpusDedupInput,
  PublicCorpusEditionInput,
  PublicCorpusLicenseDecision,
  PublicCorpusLicenseType,
  PublicCorpusQualityFlagInput,
  PublicCorpusSourceInput,
  PublicCorpusVisibility,
  PublicCorpusWorkInput,
} from "./public-fiction-corpus-types";
import {
  PUBLIC_FICTION_CORPUS_MIGRATION_VERSION,
  PUBLIC_FICTION_CORPUS_VERSION,
} from "./public-fiction-corpus-types";

type Connection = {
  run(sql: string, params?: unknown[]): unknown;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
};

function now() { return new Date().toISOString(); }
function sha(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function id(prefix: string, value: unknown) { return `${prefix}_${sha(value).slice(0, 16)}`; }
function bool(value: unknown) { return value ? 1 : 0; }
function json(value: unknown) { return JSON.stringify(value); }

export const PUBLIC_FICTION_CORPUS_HEALTH = {
  publicCorpusFoundationStatus: "ready",
  publicCorpusLicenseStatus: "ready",
  publicCorpusProvenanceStatus: "ready",
  publicCorpusAuthorWorkStatus: "ready",
  publicCorpusEditionStatus: "ready",
  publicCorpusDedupFoundationStatus: "ready",
  publicCorpusVisibilityStatus: "ready",
  publicCorpusImportStatus: "not_implemented",
  publicCorpusIndexStatus: "not_implemented",
  publicCorpusSchemaVersion: PUBLIC_FICTION_CORPUS_VERSION,
  publicCorpusMigrationVersion: PUBLIC_FICTION_CORPUS_MIGRATION_VERSION,
  publicCorpusExternalRequestCount: 0,
  publicCorpusDataLeftDevice: false,
};

export class PublicFictionCorpusService {
  readonly projectId: string;
  readonly connection: Connection;

  constructor(options: { projectId: string; connection: Connection }) {
    this.projectId = options.projectId;
    this.connection = options.connection;
  }

  decideLicense(licenseType: PublicCorpusLicenseType, sourceType: PublicCorpusSourceInput["sourceType"]): PublicCorpusLicenseDecision {
    if (licenseType === "blocked") {
      return { licenseStatus: "blocked", allowFullTextAnalysis: false, allowDerivativeReference: false, allowExport: false, visibility: "blocked", reason: "Blocked license cannot be imported." };
    }
    if (licenseType === "unknown") {
      return { licenseStatus: "review_required", allowFullTextAnalysis: false, allowDerivativeReference: false, allowExport: false, visibility: "metadata_only", reason: "Unknown license is metadata-only until reviewed." };
    }
    if (sourceType === "USER_IMPORTED" || licenseType === "user_owned_private_copy") {
      return { licenseStatus: "allowed", allowFullTextAnalysis: true, allowDerivativeReference: false, allowExport: false, visibility: "local_only", reason: "User imported private copy remains local-only." };
    }
    if (licenseType === "metadata_only") {
      return { licenseStatus: "allowed", allowFullTextAnalysis: false, allowDerivativeReference: false, allowExport: false, visibility: "metadata_only", reason: "Metadata-only source cannot expose full text." };
    }
    if (["public_domain", "cc0", "cc_by", "cc_by_sa", "cc_by_nc", "author_permission"].includes(licenseType)) {
      return { licenseStatus: "allowed", allowFullTextAnalysis: true, allowDerivativeReference: true, allowExport: licenseType !== "cc_by_nc", visibility: "public_reference", reason: "License permits reference analysis with provenance." };
    }
    return { licenseStatus: "review_required", allowFullTextAnalysis: false, allowDerivativeReference: false, allowExport: false, visibility: "metadata_only", reason: "License requires review." };
  }

  upsertSource(input: PublicCorpusSourceInput) {
    const time = now();
    const decision = this.decideLicense(input.licenseType, input.sourceType);
    const visibility: PublicCorpusVisibility = input.visibility ?? decision.visibility;
    const licenseId = id("lic", { sourceId: input.sourceId, licenseType: input.licenseType });
    const evidenceId = id("evidence", { sourceId: input.sourceId, evidence: input.licenseEvidence });
    const provenanceId = id("prov", { sourceId: input.sourceId, checksum: input.checksum });
    const row = { ...input, decision, visibility };

    this.connection.run(`INSERT OR REPLACE INTO public_corpus_sources(project_id, source_id, source_type, source_url, license_type, jurisdiction, language, country, publication_year, completeness, checksum, duplicate_group_id, allow_full_text_analysis, allow_derivative_reference, allow_export, human_reviewed, visibility, row_json, imported_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      this.projectId, input.sourceId, input.sourceType, input.sourceUrl ?? null, input.licenseType, input.jurisdiction ?? null, input.language, input.country ?? null,
      input.publicationYear ?? null, input.completeness, input.checksum, null, bool(decision.allowFullTextAnalysis), bool(decision.allowDerivativeReference), bool(decision.allowExport),
      bool(input.humanReviewed), visibility, json(row), time, time,
    ]);
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_licenses(project_id, license_id, source_id, license_type, license_status, license_evidence, license_verified_at, jurisdiction, allow_full_text_analysis, allow_derivative_reference, allow_export, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      this.projectId, licenseId, input.sourceId, input.licenseType, decision.licenseStatus, input.licenseEvidence, input.humanReviewed ? time : null, input.jurisdiction ?? null,
      bool(decision.allowFullTextAnalysis), bool(decision.allowDerivativeReference), bool(decision.allowExport), json({ input, decision }), time, time,
    ]);
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_license_evidence(project_id, evidence_id, source_id, license_id, evidence_type, evidence_text, evidence_url, captured_at, row_json)
      VALUES(?,?,?,?,?,?,?,?,?)`, [this.projectId, evidenceId, input.sourceId, licenseId, "declared_license", input.licenseEvidence, input.sourceUrl ?? null, time, json({ input })]);
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_provenance(project_id, provenance_id, source_id, entity_type, entity_id, source_url, imported_at, checksum, row_json)
      VALUES(?,?,?,?,?,?,?,?,?)`, [this.projectId, provenanceId, input.sourceId, "source", input.sourceId, input.sourceUrl ?? null, time, input.checksum, json({ input, decision })]);
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_visibility_rules(project_id, rule_id, source_scope, visibility, local_only, allow_cross_project, row_json, created_at)
      VALUES(?,?,?,?,?,?,?,?)`, [this.projectId, id("vis", input.sourceId), input.sourceType, visibility, bool(visibility === "local_only"), bool(visibility === "public_reference"), json({ sourceId: input.sourceId, visibility }), time]);
    this.audit("source_upserted", "source", input.sourceId, { decision });
    return { sourceId: input.sourceId, licenseId, evidenceId, provenanceId, decision };
  }

  upsertAuthor(input: PublicCorpusAuthorInput) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_authors(project_id, author_id, canonical_name, birth_year, death_year, nationality, language, authority_source, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [
      this.projectId, input.authorId, input.canonicalName, input.birthYear ?? null, input.deathYear ?? null, input.nationality ?? null, input.language ?? null, input.authoritySource ?? null, json(input), time, time,
    ]);
    for (const alias of input.aliases ?? []) {
      this.connection.run(`INSERT OR REPLACE INTO public_corpus_author_aliases(project_id, alias_id, author_id, alias, row_json, created_at)
        VALUES(?,?,?,?,?,?)`, [this.projectId, id("alias", { authorId: input.authorId, alias }), input.authorId, alias, json({ authorId: input.authorId, alias }), time]);
    }
    this.audit("author_upserted", "author", input.authorId, input);
  }

  upsertWork(input: PublicCorpusWorkInput) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_works(project_id, work_id, author_id, canonical_title, original_language, first_publication_year, genre, topics_json, public_domain_status, copyright_jurisdiction, work_status, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      this.projectId, input.workId, input.authorId, input.canonicalTitle, input.originalLanguage, input.firstPublicationYear ?? null, input.genre ?? null, json(input.topics ?? []),
      input.publicDomainStatus, input.copyrightJurisdiction ?? null, input.workStatus, json(input), time, time,
    ]);
    for (const title of [input.canonicalTitle, ...(input.alternateTitles ?? [])]) {
      this.connection.run(`INSERT OR REPLACE INTO public_corpus_work_titles(project_id, title_id, work_id, title, title_type, language, row_json, created_at)
        VALUES(?,?,?,?,?,?,?,?)`, [this.projectId, id("title", { workId: input.workId, title }), input.workId, title, title === input.canonicalTitle ? "canonical" : "alternate", input.originalLanguage, json({ workId: input.workId, title }), time]);
    }
    this.audit("work_upserted", "work", input.workId, input);
  }

  upsertEdition(input: PublicCorpusEditionInput) {
    const time = now();
    const licenseId = input.licenseId ?? id("lic", input.sourceId);
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_editions(project_id, edition_id, work_id, source_id, publisher, publication_year, language, translator, license_id, completeness, checksum, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      this.projectId, input.editionId, input.workId, input.sourceId, input.publisher ?? null, input.publicationYear ?? null, input.language, input.translator ?? null, licenseId, input.completeness, input.checksum, json(input), time, time,
    ]);
    if (input.translator) {
      this.connection.run(`INSERT OR REPLACE INTO public_corpus_translations(project_id, translation_id, work_id, edition_id, source_language, target_language, translator, license_id, row_json, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [this.projectId, id("translation", input), input.workId, input.editionId, "unknown", input.language, input.translator, licenseId, json(input), time]);
    }
    this.audit("edition_upserted", "edition", input.editionId, input);
  }

  upsertChapter(input: PublicCorpusChapterInput) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_chapters(project_id, chapter_id, edition_id, volume_id, title, chapter_order, checksum, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [this.projectId, input.chapterId, input.editionId, input.volumeId ?? null, input.title, input.chapterOrder, input.checksum, json(input), time, time]);
    this.audit("chapter_upserted", "chapter", input.chapterId, input);
  }

  addDedupGroup(input: PublicCorpusDedupInput) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_dedup_groups(project_id, dedup_group_id, dedup_type, canonical_entity_type, canonical_entity_id, exact_checksum, normalized_checksum, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [this.projectId, input.dedupGroupId, input.dedupType, input.canonicalEntityType, input.canonicalEntityId, input.exactChecksum ?? null, input.normalizedChecksum ?? null, json(input), time, time]);
    this.audit("dedup_group_upserted", "dedup_group", input.dedupGroupId, input);
  }

  addQualityFlag(input: PublicCorpusQualityFlagInput) {
    const time = now();
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_quality_flags(project_id, flag_id, entity_type, entity_id, flag_type, severity, explanation, status, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [this.projectId, input.flagId, input.entityType, input.entityId, input.flagType, input.severity, input.explanation, input.status ?? "open", json(input), time, time]);
    this.audit("quality_flag_upserted", "quality_flag", input.flagId, input);
  }

  addMetadataOnlyText(sourceId: string, editionId?: string, chapterId?: string) {
    const time = now();
    const textId = id("text", { sourceId, editionId, chapterId });
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_texts(project_id, text_id, source_id, edition_id, chapter_id, text_kind, text_status, checksum, storage_policy, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [this.projectId, textId, sourceId, editionId ?? null, chapterId ?? null, "metadata_record", "metadata_only", sha({ sourceId, editionId, chapterId }), "no_full_text", json({ sourceId, editionId, chapterId }), time, time]);
    return textId;
  }

  count(table: string) {
    return Number(this.connection.get(`SELECT count(*) AS count FROM ${table} WHERE project_id=?`, [this.projectId])?.count ?? 0);
  }

  listVisibleSources() {
    return this.connection.all("SELECT source_id, source_type, license_type, visibility, allow_full_text_analysis, allow_export FROM public_corpus_sources WHERE project_id=? AND visibility <> 'blocked'", [this.projectId]);
  }

  private audit(action: string, entityType: string, entityId: string, details: unknown) {
    this.connection.run(`INSERT OR REPLACE INTO public_corpus_audits(project_id, audit_id, action, entity_type, entity_id, row_json, created_at)
      VALUES(?,?,?,?,?,?,?)`, [this.projectId, id("audit", { action, entityType, entityId, at: now() }), action, entityType, entityId, json(details), now()]);
  }
}
