import { HybridRetrievalService, type RetrievalQuery, type RetrievalResult } from "../retrieval/hybrid";
import type { TraceableMemory } from "./types";

type RetrievalConnection = {
  run(sql: string, params?: unknown[]): unknown;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
};

function memoryKind(result: RetrievalResult): TraceableMemory["kind"] {
  if (result.sourceType === "character") return "character";
  if (result.sourceType === "relationship") return "relationship";
  if (result.sourceType === "world_rule") return "world_rule";
  if (result.sourceType === "event") return "event";
  if (result.sourceType === "clue") return "foreshadowing";
  if (result.sourceType === "consequence_candidate") return "accepted_choice";
  if (result.canonicalStatus === "current_scene") return "current_scene";
  return "recent_chapter";
}

export function retrievalResultToMemory(input: {
  projectId: string;
  result: RetrievalResult;
  document?: Record<string, unknown>;
}): TraceableMemory {
  const documentText = String(input.document?.body ?? input.result.textExcerpt);
  const located = documentText.indexOf(input.result.textExcerpt);
  if (located < 0) {
    throw Object.assign(new Error("Retrieval excerpt cannot be located in its source document."), {
      code: "RETRIEVAL_EVIDENCE_NOT_FOUND",
      documentId: input.result.documentId,
      chunkId: input.result.chunkId,
    });
  }
  const start = located;
  const version = String(input.document?.version_id ?? input.document?.content_hash ?? input.result.chunkId);
  return {
    memoryId: `retrieval:${input.result.chunkId}`,
    kind: memoryKind(input.result),
    text: input.result.textExcerpt,
    source: {
      sourceChapterId: String(input.document?.chapter_id ?? input.result.sourceId),
      sourceRevision: version,
      evidenceExcerpt: input.result.textExcerpt,
      start,
      end: start + input.result.textExcerpt.length,
    },
    metadata: {
      projectId: input.projectId,
      branchId: input.result.branchId,
      entityIds: [...input.result.matchedEntities, ...input.result.matchedEvents],
      canonical: input.result.canonicalStatus === "approved" || input.result.canonicalStatus === "approved_version",
      visibility: input.result.visibility === "private" ? "private" : "project",
    },
    keywordScore: input.result.scoreBreakdown.keywordScore,
    vectorScore: input.result.scoreBreakdown.semanticScore,
    recencyScore: input.result.scoreBreakdown.recencyScore,
  };
}

export class HybridMemoryRetriever {
  readonly projectId: string;
  readonly connection: RetrievalConnection;
  readonly retrieval: HybridRetrievalService;

  constructor(options: { projectId: string; connection: RetrievalConnection }) {
    this.projectId = options.projectId;
    this.connection = options.connection;
    this.retrieval = new HybridRetrievalService(options);
  }

  async retrieve(query: Omit<RetrievalQuery, "projectId">): Promise<{
    memories: TraceableMemory[];
    executionTime: number;
    externalRequestCount: 0;
    dataLeftDevice: false;
  }> {
    const response = await this.retrieval.search({
      ...query,
      projectId: this.projectId,
      topK: Math.min(40, Math.max(1, query.topK ?? 20)),
    });
    const memories = response.results.map((result) => {
      const document = this.connection.get(
        "SELECT version_id, chapter_id, content_hash, body FROM retrieval_documents WHERE project_id=? AND document_id=?",
        [this.projectId, result.documentId],
      );
      return retrievalResultToMemory({ projectId: this.projectId, result, document });
    });
    return {
      memories,
      executionTime: response.executionTime,
      externalRequestCount: 0,
      dataLeftDevice: false,
    };
  }
}
