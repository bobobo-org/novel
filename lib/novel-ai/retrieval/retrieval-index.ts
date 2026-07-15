import { EmbeddingProviderError } from "../embeddings/embedding-errors";
import type { EmbeddingProvider } from "../embeddings/embedding-provider";
import type { EmbeddingResult } from "../embeddings/embedding-types";
import type { SQLiteProjectConnection } from "../storage/sqlite/sqlite-connection";
import { chunkChapter, chunkTextAsSingleStructuredPiece } from "./chapter-chunker";
import { chunkContentHash, sha256Hex } from "./chunk-hash";
import { CHUNKING_VERSION, type ChapterChunkRequest, type RetrievalChunk } from "./chunk-types";
import { checksumVectorBlob, decodeVector, encodeVector } from "./vector-blob";

export type RetrievalPolicyMetadata = {
  relationshipIds?: string[];
  participantIds?: string[];
  contentRating?: "general" | "teen" | "mature" | "adult";
  sceneType?: "normal" | "romance" | "intimacy" | "violence" | "horror" | "other_sensitive";
  sensitivityLevel?: number;
  policyProfileId?: string;
  adultVerificationStatus?: "not_applicable" | "verified_adult" | "unknown" | "blocked";
  consentState?: "not_applicable" | "unspecified" | "active" | "withdrawn" | "invalid";
  intimacyStage?: "none" | "setup" | "approach" | "consent" | "escalation" | "explicit" | "deescalation" | "aftermath";
};

export type RetrievalIndexOptions = {
  projectId: string;
  provider: EmbeddingProvider;
  connection: SQLiteProjectConnection;
  modelDigest?: string;
  batchSize?: number;
};

export type IndexChapterInput = Omit<ChapterChunkRequest, "projectId"> & {
  policyMetadata?: RetrievalPolicyMetadata;
};

export type IndexGenerationSummary = {
  generationId: string;
  projectId: string;
  totalChunks: number;
  embeddedChunks: number;
  reusedChunks: number;
  failedChunks: number;
  status: "active" | "failed" | "cancelled";
  reuseRate: number;
};

export class RetrievalIndexManager {
  private readonly projectId: string;
  private readonly provider: EmbeddingProvider;
  private readonly connection: SQLiteProjectConnection;
  private readonly batchSize: number;
  private readonly modelDigest?: string;

  constructor(options: RetrievalIndexOptions) {
    this.projectId = options.projectId;
    this.provider = options.provider;
    this.connection = options.connection;
    this.batchSize = options.batchSize ?? 8;
    this.modelDigest = options.modelDigest;
  }

  ensureProject() {
    const now = new Date().toISOString();
    this.connection.run(
      "INSERT OR IGNORE INTO projects(id, project_id, row_json, created_at, updated_at) VALUES(?,?,?,?,?)",
      [this.projectId, this.projectId, JSON.stringify({ projectId: this.projectId }), now, now],
    );
  }

  async initialIndexProject(chapters: IndexChapterInput[]) {
    return this.createGeneration(chapters, "initial");
  }

  async reindexProject(chapters: IndexChapterInput[]) {
    return this.createGeneration(chapters, "reindex");
  }

  async updateChapterIndex(chapter: IndexChapterInput) {
    return this.createGeneration([chapter], "chapter-update");
  }

  deleteChapterIndex(chapterId: string) {
    this.connection.run("UPDATE retrieval_chunks SET status = 'deleted', updated_at = ? WHERE project_id = ? AND chapter_id = ?", [new Date().toISOString(), this.projectId, chapterId]);
    return { chapterId, deletedChunks: Number(this.connection.get("SELECT changes() AS changes")?.changes ?? 0) };
  }

  restoreChapterIndex(chapterId: string) {
    this.connection.run("UPDATE retrieval_chunks SET status = 'active', updated_at = ? WHERE project_id = ? AND chapter_id = ? AND status = 'deleted'", [new Date().toISOString(), this.projectId, chapterId]);
    return { chapterId, restoredChunks: Number(this.connection.get("SELECT changes() AS changes")?.changes ?? 0) };
  }

  async updateCanonicalIndex(input: { entityId: string; entityType: RetrievalChunk["contentType"]; text: string; policyMetadata?: RetrievalPolicyMetadata }) {
    const chunks = chunkTextAsSingleStructuredPiece({
      projectId: this.projectId,
      contentType: input.entityType,
      text: input.text,
      metadata: { entityIds: [input.entityId] },
    });
    return this.createGenerationFromChunks(chunks, "canonical-update", input.policyMetadata);
  }

  cancelIndexJob(jobId: string) {
    this.connection.run("UPDATE retrieval_index_jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND project_id = ?", [new Date().toISOString(), jobId, this.projectId]);
    return Number(this.connection.get("SELECT changes() AS changes")?.changes ?? 0) > 0;
  }

  resumeIndexJob(jobId: string) {
    this.connection.run("UPDATE retrieval_index_jobs SET status = 'resumable', updated_at = ? WHERE id = ? AND project_id = ? AND status IN ('failed','cancelled','running')", [new Date().toISOString(), jobId, this.projectId]);
    return Number(this.connection.get("SELECT changes() AS changes")?.changes ?? 0) > 0;
  }

  verifyIndexGeneration(generationId?: string) {
    const generation = generationId
      ? this.connection.get("SELECT * FROM retrieval_index_generations WHERE id = ? AND project_id = ?", [generationId, this.projectId])
      : this.connection.get("SELECT * FROM retrieval_index_generations WHERE project_id = ? AND active = 1", [this.projectId]);
    if (!generation) return { status: "missing", ok: false };
    const id = String(generation.id);
    const chunkCount = Number(this.connection.get("SELECT count(*) AS count FROM retrieval_chunks WHERE project_id = ? AND generation_id = ? AND status = 'active'", [this.projectId, id])?.count ?? 0);
    const embeddingCount = Number(this.connection.get("SELECT count(*) AS count FROM retrieval_embeddings WHERE project_id = ? AND generation_id = ?", [this.projectId, id])?.count ?? 0);
    const orphanCount = Number(this.connection.get(`
      SELECT count(*) AS count FROM retrieval_embeddings e
      LEFT JOIN retrieval_chunks c ON c.id = e.chunk_id AND c.generation_id = e.generation_id
      WHERE e.project_id = ? AND e.generation_id = ? AND c.id IS NULL
    `, [this.projectId, id])?.count ?? 0);
    return {
      status: chunkCount === embeddingCount && orphanCount === 0 ? "ok" : "partial",
      ok: chunkCount === embeddingCount && orphanCount === 0,
      generationId: id,
      activeChunkCount: chunkCount,
      embeddingCount,
      noOrphanEmbedding: orphanCount === 0,
    };
  }

  private async createGeneration(chapters: IndexChapterInput[], reason: string) {
    const chunks = chapters.flatMap((chapter) => chunkChapter({ ...chapter, projectId: this.projectId }));
    const policy = chapters[0]?.policyMetadata;
    return this.createGenerationFromChunks(chunks, reason, policy);
  }

  private async createGenerationFromChunks(chunks: RetrievalChunk[], reason: string, policyMetadata?: RetrievalPolicyMetadata): Promise<IndexGenerationSummary> {
    this.ensureProject();
    const model = await this.provider.getModelInfo();
    const generationId = `retrieval_generation_${sha256Hex(`${this.projectId}|${reason}|${Date.now()}|${Math.random()}`).slice(0, 24)}`;
    const now = new Date().toISOString();
    const modelDigest = this.modelDigest ?? model.digest ?? "unknown";
    let embeddedChunks = 0;
    let reusedChunks = 0;
    let failedChunks = 0;
    const previous = this.connection.all("SELECT content_hash, id FROM retrieval_chunks WHERE project_id = ? AND status = 'active'", [this.projectId]);
    const previousHashes = new Map(previous.map((row) => [String(row.content_hash), String(row.id)]));

    this.connection.beginImmediate();
    try {
      this.connection.run(`
        INSERT INTO retrieval_index_generations(id, project_id, provider, model, model_digest, dimensions, chunking_version, normalization_version, status, active, total_chunks, embedded_chunks, reused_chunks, failed_chunks, row_json, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        generationId,
        this.projectId,
        this.provider.id,
        model.modelId,
        modelDigest,
        model.dimensions,
        CHUNKING_VERSION,
        model.normalizationVersion,
        "building",
        0,
        chunks.length,
        0,
        0,
        0,
        JSON.stringify({ reason, dataLeftDevice: false }),
        now,
      ]);
      this.connection.run(`
        INSERT INTO retrieval_index_jobs(id, project_id, generation_id, status, total, row_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?)
      `, [`retrieval_job_${generationId}`, this.projectId, generationId, "running", chunks.length, JSON.stringify({ reason }), now, now]);
      this.connection.commit();
    } catch (error) {
      this.connection.rollback();
      throw error;
    }

    for (let index = 0; index < chunks.length; index += this.batchSize) {
      const batch = chunks.slice(index, index + this.batchSize);
      const batchResult = await this.provider.embedBatch({
        batchId: `batch-${generationId}-${index}`,
        projectId: this.projectId,
        contentType: "chapter_segment",
        normalizationVersion: model.normalizationVersion,
        privacyMode: "local_only",
        items: batch.map((chunk) => ({ requestId: chunk.chunkId, text: chunk.normalizedText, contentType: chunk.contentType })),
      });
      const byId = new Map(batchResult.results.map((result) => [result.requestId, result]));
      this.connection.beginImmediate();
      try {
        for (const chunk of batch) {
          const result = byId.get(chunk.chunkId);
          if (!result) {
            failedChunks += 1;
            continue;
          }
          const reused = previousHashes.has(chunk.contentHash);
          if (reused) reusedChunks += 1;
          await this.persistChunkAndEmbedding(chunk, result, generationId, policyMetadata);
          embeddedChunks += 1;
        }
        this.connection.run("UPDATE retrieval_index_jobs SET processed = ?, reused = ?, embedded = ?, failed = ?, current_batch = ?, last_checkpoint = ?, updated_at = ? WHERE id = ? AND project_id = ?", [
          Math.min(index + batch.length, chunks.length),
          reusedChunks,
          embeddedChunks,
          failedChunks,
          Math.floor(index / this.batchSize) + 1,
          batch[batch.length - 1]?.chunkId ?? null,
          new Date().toISOString(),
          `retrieval_job_${generationId}`,
          this.projectId,
        ]);
        this.connection.commit();
      } catch (error) {
        this.connection.rollback();
        throw error;
      }
    }

    const status = failedChunks === 0 ? "active" : "failed";
    this.connection.beginImmediate();
    try {
      if (status === "active") {
        this.connection.run("UPDATE retrieval_index_generations SET active = 0, status = 'stale' WHERE project_id = ? AND active = 1", [this.projectId]);
      }
      this.connection.run("UPDATE retrieval_index_generations SET status = ?, active = ?, embedded_chunks = ?, reused_chunks = ?, failed_chunks = ?, completed_at = ?, row_json = ? WHERE id = ? AND project_id = ?", [
        status,
        status === "active" ? 1 : 0,
        embeddedChunks,
        reusedChunks,
        failedChunks,
        new Date().toISOString(),
        JSON.stringify({ reason, reuseRate: chunks.length ? reusedChunks / chunks.length : 0, dataLeftDevice: false }),
        generationId,
        this.projectId,
      ]);
      this.connection.run("UPDATE retrieval_index_jobs SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?", [status === "active" ? "completed" : "failed", new Date().toISOString(), `retrieval_job_${generationId}`, this.projectId]);
      this.connection.commit();
    } catch (error) {
      this.connection.rollback();
      throw error;
    }

    return {
      generationId,
      projectId: this.projectId,
      totalChunks: chunks.length,
      embeddedChunks,
      reusedChunks,
      failedChunks,
      status,
      reuseRate: chunks.length ? reusedChunks / chunks.length : 0,
    };
  }

  private async persistChunkAndEmbedding(chunk: RetrievalChunk, result: EmbeddingResult, generationId: string, policyMetadata?: RetrievalPolicyMetadata) {
    const vectorBlob = encodeVector(result.vector, result.dimensions);
    const vectorChecksum = checksumVectorBlob(vectorBlob);
    const metadata = normalizePolicyMetadata(policyMetadata);
    const metadataHash = chunkContentHash(JSON.stringify({
      entityIds: chunk.entityIds,
      eventIds: chunk.eventIds,
      sourceIds: chunk.sourceIds,
      relationshipIds: metadata.relationshipIds,
      participantIds: metadata.participantIds,
      policy: metadata,
    }));
    this.connection.run(`
      INSERT OR REPLACE INTO retrieval_chunks(id, project_id, chapter_id, scene_id, content_type, ordinal, start_offset, end_offset, normalized_text, content_hash, metadata_hash, embedding_input_hash, token_estimate, chunking_version, status, generation_id, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      chunk.chunkId,
      this.projectId,
      chunk.chapterId ?? null,
      chunk.sceneId ?? null,
      chunk.contentType,
      chunk.ordinal,
      chunk.startOffset,
      chunk.endOffset,
      chunk.normalizedText,
      chunk.contentHash,
      metadataHash,
      chunkContentHash(`${chunk.normalizedText}|${metadataHash}`),
      chunk.tokenEstimate,
      chunk.chunkingVersion,
      chunk.status,
      generationId,
      JSON.stringify({ ...chunk, relationshipIds: metadata.relationshipIds, participantIds: metadata.participantIds }),
      chunk.createdAt,
      new Date().toISOString(),
    ]);
    const persistedModelDigest = this.modelDigest ?? result.modelDigest ?? "unknown";
    this.connection.run(`
      INSERT OR REPLACE INTO retrieval_embeddings(chunk_id, project_id, provider, model, model_digest, dimensions, vector_blob, vector_checksum, normalized, normalization_version, generation_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `, [chunk.chunkId, this.projectId, result.provider, result.model, persistedModelDigest, result.dimensions, vectorBlob, vectorChecksum, result.normalized ? 1 : 0, "embedding-normalization-v1", generationId]);
    for (const entityId of chunk.entityIds) this.connection.run("INSERT OR IGNORE INTO retrieval_chunk_entities(chunk_id, project_id, entity_id) VALUES(?,?,?)", [chunk.chunkId, this.projectId, entityId]);
    for (const eventId of chunk.eventIds) this.connection.run("INSERT OR IGNORE INTO retrieval_chunk_events(chunk_id, project_id, event_id) VALUES(?,?,?)", [chunk.chunkId, this.projectId, eventId]);
    for (const sourceId of chunk.sourceIds) this.connection.run("INSERT OR IGNORE INTO retrieval_chunk_sources(chunk_id, project_id, source_id) VALUES(?,?,?)", [chunk.chunkId, this.projectId, sourceId]);
    for (const relationshipId of metadata.relationshipIds) this.connection.run("INSERT OR IGNORE INTO retrieval_chunk_relationships(chunk_id, project_id, relationship_id) VALUES(?,?,?)", [chunk.chunkId, this.projectId, relationshipId]);
    this.connection.run(`
      INSERT OR REPLACE INTO retrieval_chunk_policy_metadata(chunk_id, project_id, content_rating, scene_type, sensitivity_level, policy_profile_id, adult_verification_status, consent_state, intimacy_stage, row_json, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `, [
      chunk.chunkId,
      this.projectId,
      metadata.contentRating,
      metadata.sceneType,
      metadata.sensitivityLevel,
      metadata.policyProfileId ?? null,
      metadata.adultVerificationStatus,
      metadata.consentState,
      metadata.intimacyStage,
      JSON.stringify(metadata),
      new Date().toISOString(),
    ]);
    decodeVector(vectorBlob, result.dimensions);
    if (vectorChecksum !== checksumVectorBlob(vectorBlob)) throw new EmbeddingProviderError("EMBEDDING_INVALID_VECTOR", "Vector checksum mismatch after write", { stage: "retrieval-index" });
  }
}

export function normalizePolicyMetadata(input: RetrievalPolicyMetadata = {}) {
  return {
    relationshipIds: input.relationshipIds ?? [],
    participantIds: input.participantIds ?? [],
    contentRating: input.contentRating ?? "general",
    sceneType: input.sceneType ?? "normal",
    sensitivityLevel: input.sensitivityLevel ?? 0,
    policyProfileId: input.policyProfileId,
    adultVerificationStatus: input.adultVerificationStatus ?? "unknown",
    consentState: input.consentState ?? "unspecified",
    intimacyStage: input.intimacyStage ?? "none",
  };
}
