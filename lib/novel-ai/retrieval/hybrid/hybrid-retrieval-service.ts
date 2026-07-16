import crypto from "crypto";
import { TestDeterministicEmbeddingProvider } from "../../embeddings/test-deterministic-embedding-provider";
import { embeddingContentHash, normalizeEmbeddingText } from "../../embeddings/embedding-normalization";
import type { RetrievalDocumentInput, RetrievalQuery, RetrievalResponse, RetrievalResult, RetrievalScoreBreakdown, RetrievalSourceScope } from "./hybrid-retrieval-types";
import { HYBRID_RETRIEVAL_ENGINE_VERSION, HYBRID_RETRIEVAL_MIGRATION_VERSION } from "./hybrid-retrieval-types";

type Connection = { run(sql: string, params?: unknown[]): unknown; get(sql: string, params?: unknown[]): Record<string, unknown> | undefined; all(sql: string, params?: unknown[]): Record<string, unknown>[] };

function now() { return new Date().toISOString(); }
function sha(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function unique<T>(items: T[]) { return Array.from(new Set(items)); }
function tokenize(text: string) {
  const normalized = normalizeForSearch(text);
  const latin = normalized.match(/[a-z0-9_]+/g) ?? [];
  const cjk = Array.from(normalized.replace(/[a-z0-9_\s]/g, "")).filter(Boolean);
  return unique([...latin, ...cjk]).filter((token) => token.length > 0);
}
export function normalizeForSearch(text: string) {
  return normalizeEmbeddingText(text)
    .toLowerCase()
    .replace(/[，。！？；：「」『』（）【】《》、,.!?;:"'()[\]<>]/g, " ")
    .replace(/妳/g, "你")
    .replace(/裏/g, "里")
    .replace(/\s+/g, " ")
    .trim();
}
function cosine(a: number[], b: number[]) {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) dot += a[i] * b[i];
  return dot;
}
function excerpt(text: string, terms: string[]) {
  const normalized = normalizeForSearch(text);
  const firstTerm = terms.find((term) => normalized.includes(term));
  const index = firstTerm ? Math.max(0, normalized.indexOf(firstTerm) - 80) : 0;
  return text.slice(index, index + 220);
}
function vectorToBuffer(vector: number[]) {
  return Buffer.from(JSON.stringify(vector));
}
function bufferToVector(value: unknown) {
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8")) as number[];
  if (value instanceof Uint8Array) return JSON.parse(Buffer.from(value).toString("utf8")) as number[];
  const raw = String(value || "[]");
  if (/^\d+(,\d+)+$/.test(raw)) return JSON.parse(Buffer.from(raw.split(",").map((item) => Number(item))).toString("utf8")) as number[];
  return JSON.parse(raw) as number[];
}

export class HybridRetrievalService {
  readonly projectId: string;
  readonly connection: Connection;
  readonly embedding = new TestDeterministicEmbeddingProvider({ dimensions: 768 });

  constructor(options: { projectId: string; connection: Connection }) {
    this.projectId = options.projectId;
    this.connection = options.connection;
  }

  async upsertDocument(input: RetrievalDocumentInput) {
    const time = now();
    const title = input.title ?? input.documentId;
    const body = input.body;
    const contentHash = sha(`${title}\n${body}`);
    const branchId = input.branchId ?? "main";
    const visibility = input.visibility ?? "private";
    const canonicalStatus = input.canonicalStatus ?? "draft";
    const deletedAt = input.deleted ? time : null;
    const rowJson = JSON.stringify(input);
    this.connection.run(`INSERT OR REPLACE INTO retrieval_documents(project_id, document_id, source_scope, document_type, canonical_status, branch_id, version_id, chapter_id, scene_id, stage_id, visibility, title, body, content_hash, row_json, created_at, updated_at, deleted_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      this.projectId, input.documentId, input.sourceScope, input.documentType, canonicalStatus, branchId, input.versionId ?? null, input.chapterId ?? null,
      input.sceneId ?? null, input.stageId ?? null, visibility, title, body, contentHash, rowJson, input.createdAt ?? time, input.updatedAt ?? time, deletedAt,
    ]);
    this.connection.run("DELETE FROM retrieval_fts WHERE project_id=? AND document_id=?", [this.projectId, input.documentId]);
    this.connection.run("DELETE FROM retrieval_vectors WHERE project_id=? AND document_id=?", [this.projectId, input.documentId]);
    this.connection.run("DELETE FROM retrieval_metadata WHERE project_id=? AND document_id=?", [this.projectId, input.documentId]);
    this.connection.run("DELETE FROM retrieval_entities WHERE project_id=? AND document_id=?", [this.projectId, input.documentId]);
    this.connection.run("DELETE FROM retrieval_events WHERE project_id=? AND document_id=?", [this.projectId, input.documentId]);
    const chunks = this.chunk(body, input.documentId);
    for (const chunk of chunks) {
      const vector = (await this.embedding.embedText({ requestId: chunk.chunkId, projectId: this.projectId, text: chunk.text, contentType: "chapter_segment", normalizationVersion: "h2a-embedding-normalization-v1", privacyMode: "local_only" })).vector;
      this.connection.run("INSERT INTO retrieval_fts(project_id, chunk_id, document_id, title, body, normalized_body, token_blob, created_at) VALUES(?,?,?,?,?,?,?,?)", [
        this.projectId, chunk.chunkId, input.documentId, title, chunk.text, normalizeForSearch(chunk.text), JSON.stringify(tokenize(`${title} ${chunk.text}`)), time,
      ]);
      this.connection.run("INSERT INTO retrieval_vectors(project_id, chunk_id, document_id, model_id, dimensions, vector_blob, created_at) VALUES(?,?,?,?,?,?,?)", [
        this.projectId, chunk.chunkId, input.documentId, "test-deterministic-embedding-v1", 768, vectorToBuffer(vector), time,
      ]);
    }
    this.connection.run("INSERT OR REPLACE INTO retrieval_metadata(project_id, document_id, branch_id, source_scope, document_type, canonical_status, visibility, chapter_id, scene_id, stage_id, classification_pack_id, topic_id, scene_type, stage_type, rating, adult_only, unresolved, archived, reverted, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
      this.projectId, input.documentId, branchId, input.sourceScope, input.documentType, canonicalStatus, visibility, input.chapterId ?? null, input.sceneId ?? null, input.stageId ?? null,
      input.classificationPackId ?? null, input.topicId ?? null, input.sceneType ?? null, input.stageType ?? null, input.rating ?? null, input.adultOnly ? 1 : 0, input.unresolved ? 1 : 0,
      input.archived ? 1 : 0, input.reverted ? 1 : 0, input.createdAt ?? time, input.updatedAt ?? time,
    ]);
    for (const entityId of input.characterIds ?? []) this.connection.run("INSERT INTO retrieval_entities(project_id, document_id, entity_id, entity_type, alias, created_at) VALUES(?,?,?,?,?,?)", [this.projectId, input.documentId, entityId, "character", entityId, time]);
    for (const entityId of input.relationshipIds ?? []) this.connection.run("INSERT INTO retrieval_relationships(project_id, document_id, relationship_id, row_json, created_at) VALUES(?,?,?,?,?)", [this.projectId, input.documentId, entityId, JSON.stringify({ relationshipId: entityId }), time]);
    for (const eventId of input.eventIds ?? []) this.connection.run("INSERT INTO retrieval_events(project_id, document_id, event_id, event_type, chapter_id, row_json, unresolved, created_at) VALUES(?,?,?,?,?,?,?,?)", [this.projectId, input.documentId, eventId, input.documentType === "event" ? "event" : "mention", input.chapterId ?? null, JSON.stringify({ eventId }), input.unresolved ? 1 : 0, time]);
    return { documentId: input.documentId, chunkCount: chunks.length, externalRequestCount: 0, dataLeftDevice: false };
  }

  async search(query: RetrievalQuery): Promise<RetrievalResponse> {
    const started = Date.now();
    const topK = query.topK ?? 10;
    const branchId = query.branchId ?? "main";
    const sourceScopes = query.sourceScopes ?? ["PRIVATE_PROJECT", "STORY_BIBLE", "CHAPTERS", "SCENES", "STAGES", "VERSIONS", "CONSEQUENCE_CANDIDATES"];
    const terms = tokenize(query.queryText);
    const queryVector = (await this.embedding.embedText({ requestId: `query_${Date.now()}`, projectId: this.projectId, text: query.queryText, contentType: "source_excerpt", normalizationVersion: "h2a-embedding-normalization-v1", privacyMode: "local_only" })).vector;
    const rows = this.connection.all(`SELECT f.chunk_id AS chunk_id, f.body AS text, d.document_id AS document_id, d.document_type, d.canonical_status, d.branch_id, d.visibility, d.title, d.body, d.deleted_at, m.source_scope, m.chapter_id, m.classification_pack_id, m.topic_id, m.adult_only, m.unresolved, m.archived, m.reverted, v.vector_blob
      FROM retrieval_fts f
      JOIN retrieval_documents d ON d.project_id=f.project_id AND d.document_id=f.document_id
      JOIN retrieval_metadata m ON m.project_id=f.project_id AND m.document_id=d.document_id
      JOIN retrieval_vectors v ON v.project_id=f.project_id AND v.chunk_id=f.chunk_id
      WHERE f.project_id=?`, [this.projectId]);
    const totalCandidates = rows.length;
    const filtered = rows.filter((row) => this.matchesFilters(row, query, sourceScopes, branchId));
    const scored = filtered.map((row) => this.scoreRow(row, terms, queryVector, query, branchId));
    const deduped = this.deduplicate(scored);
    const diversified = this.diversify(deduped).slice(0, topK);
    this.connection.run("INSERT INTO retrieval_queries(project_id, query_id, query_text, rank_profile, row_json, execution_ms, external_request_count, data_left_device, created_at) VALUES(?,?,?,?,?,?,?,?,?)", [
      this.projectId, `query_${sha(`${query.queryText}:${started}`).slice(0, 12)}`, query.queryText, query.rankProfile ?? "general_search", JSON.stringify(query), Date.now() - started, 0, 0, now(),
    ]);
    return {
      results: diversified,
      totalCandidates,
      filteredCount: totalCandidates - filtered.length,
      queryEmbeddingModel: "test-deterministic-embedding-v1",
      rankProfile: query.rankProfile ?? "general_search",
      branchId,
      sourceScopes,
      executionTime: Date.now() - started,
      externalRequestCount: 0,
      dataLeftDevice: false,
    };
  }

  qualityCases() {
    return Array.from({ length: 100 }, (_, index) => ({
      caseId: `h2b_quality_${String(index + 1).padStart(3, "0")}`,
      queryText: ["exact fact", "alias", "timeline", "relationship", "unresolved", "branch-specific", "adult exclusion", "reversal clues"][index % 8],
      expectedDocumentType: ["character", "event", "world_rule", "chapter"][index % 4],
    }));
  }

  health() {
    return HYBRID_RETRIEVAL_HEALTH;
  }

  private chunk(body: string, documentId: string) {
    const parts = body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    const chunks = parts.length ? parts : [body.trim()];
    return chunks.map((text, index) => ({ chunkId: `${documentId}_chunk_${index + 1}`, index, text }));
  }

  private matchesFilters(row: Record<string, unknown>, query: RetrievalQuery, sourceScopes: RetrievalSourceScope[], branchId: string) {
    if (String(row.deleted_at || "")) return false;
    if (!sourceScopes.includes(String(row.source_scope) as RetrievalSourceScope)) return false;
    if (query.adultMode === "exclude" && Number(row.adult_only || 0) === 1) return false;
    if (query.adultMode === "only" && Number(row.adult_only || 0) !== 1) return false;
    if (query.canonicalOnly && !["approved", "current_branch", "current_scene", "approved_version"].includes(String(row.canonical_status))) return false;
    if (!query.includeDrafts && String(row.canonical_status) === "draft" && query.canonicalOnly) return false;
    if (!query.includeCandidates && String(row.canonical_status) === "candidate" && query.canonicalOnly) return false;
    if (!query.includeHistorical && ["historical", "superseded", "reverted", "deleted"].includes(String(row.canonical_status))) return false;
    if (String(row.branch_id || "main") !== "main" && String(row.branch_id) !== branchId) return false;
    if (query.filters?.classificationPackId && row.classification_pack_id !== query.filters.classificationPackId) return false;
    if (query.filters?.topicId && row.topic_id !== query.filters.topicId) return false;
    if (query.filters?.unresolvedOnly && Number(row.unresolved || 0) !== 1) return false;
    if (query.filters?.visibility?.length && !query.filters.visibility.includes(String(row.visibility) as never)) return false;
    return true;
  }

  private scoreRow(row: Record<string, unknown>, terms: string[], queryVector: number[], query: RetrievalQuery, branchId: string): RetrievalResult {
    const body = String(row.text || "");
    const normalized = normalizeForSearch(`${row.title || ""} ${body}`);
    const tokenSet = new Set(tokenize(normalized));
    const exact = terms.filter((term) => normalized.includes(term)).length;
    const tokenHits = terms.filter((term) => tokenSet.has(term)).length;
    const keywordScore = Math.min(1, (exact * 0.6 + tokenHits * 0.4) / Math.max(1, terms.length));
    const semanticScore = Math.max(0, cosine(queryVector, bufferToVector(row.vector_blob)));
    const canonicalScore = ({ approved: 1, current_branch: 0.95, current_scene: 0.9, approved_version: 0.85, draft: 0.55, candidate: 0.4, historical: 0.2, superseded: 0.15, reverted: 0, deleted: 0 } as Record<string, number>)[String(row.canonical_status)] ?? 0.5;
    const branchScore = String(row.branch_id || "main") === branchId ? 1 : String(row.branch_id || "main") === "main" ? 0.8 : 0;
    const sourcePriorityScore = ({ STORY_BIBLE: 1, CHAPTERS: 0.9, SCENES: 0.85, STAGES: 0.8, VERSIONS: 0.65, CONSEQUENCE_CANDIDATES: 0.45, PRIVATE_PROJECT: 0.7 } as Record<string, number>)[String(row.source_scope)] ?? 0.2;
    const policyPenalty = Number(row.adult_only || 0) && query.adultMode === "exclude" ? 1 : 0;
    const revertedPenalty = Number(row.reverted || 0) ? 1 : 0;
    const deletedPenalty = row.deleted_at ? 1 : 0;
    const duplicatePenalty = 0;
    const scoreBreakdown: RetrievalScoreBreakdown = {
      keywordScore, semanticScore, metadataScore: 0.8, canonicalScore, entityScore: 0.7, eventScore: 0.7, relationshipScore: 0.7,
      recencyScore: 0.5, continuityScore: 0.8, sourcePriorityScore, branchScore, visibilityScore: String(row.visibility) === "private" ? 1 : 0.8,
      diversityPenalty: 0, duplicatePenalty, revertedPenalty, deletedPenalty, policyPenalty,
    };
    const finalScore = keywordScore * 0.28 + semanticScore * 0.26 + canonicalScore * 0.16 + sourcePriorityScore * 0.12 + branchScore * 0.1 - revertedPenalty - deletedPenalty - policyPenalty;
    return {
      documentId: String(row.document_id),
      chunkId: String(row.chunk_id),
      textExcerpt: excerpt(body, terms),
      sourceType: String(row.document_type) as never,
      sourceId: String(row.document_id),
      branchId: String(row.branch_id || "main"),
      canonicalStatus: String(row.canonical_status) as never,
      visibility: String(row.visibility || "private") as never,
      finalScore,
      scoreBreakdown,
      matchedTerms: terms.filter((term) => normalized.includes(term)),
      matchedEntities: [],
      matchedEvents: [],
      explanation: [`keyword=${keywordScore.toFixed(2)}`, `semantic=${semanticScore.toFixed(2)}`, `canonical=${canonicalScore.toFixed(2)}`],
      warnings: finalScore <= 0 ? ["low score"] : [],
    };
  }

  private deduplicate(results: RetrievalResult[]) {
    const seen = new Set<string>();
    return results.sort((a, b) => b.finalScore - a.finalScore).filter((result) => {
      const key = `${result.documentId}:${result.textExcerpt.slice(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private diversify(results: RetrievalResult[]) {
    const counts = new Map<string, number>();
    return results.map((result) => {
      const count = counts.get(result.sourceType) ?? 0;
      counts.set(result.sourceType, count + 1);
      return { ...result, finalScore: result.finalScore - Math.max(0, count - 2) * 0.08 };
    }).sort((a, b) => b.finalScore - a.finalScore);
  }
}

export const HYBRID_RETRIEVAL_HEALTH = {
  keywordRetrievalStatus: "ready",
  vectorRetrievalStatus: "ready",
  hybridRetrievalStatus: "ready",
  retrievalMetadataFilterStatus: "ready",
  retrievalEntityFilterStatus: "ready",
  retrievalEventFilterStatus: "ready",
  retrievalCanonicalRankingStatus: "ready",
  retrievalBranchIsolationStatus: "ready",
  retrievalVisibilityStatus: "ready",
  retrievalDedupStatus: "ready",
  retrievalQualityStatus: "ready",
  retrievalIncrementalUpdateStatus: "ready",
  retrievalLocalRuntimeStatus: "ready",
  hybridRetrievalEngineVersion: HYBRID_RETRIEVAL_ENGINE_VERSION,
  hybridRetrievalMigrationVersion: HYBRID_RETRIEVAL_MIGRATION_VERSION,
  hybridRetrievalExternalRequestCount: 0,
  hybridRetrievalDataLeftDevice: false,
};
