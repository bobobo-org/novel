import type { KnowledgeChunk } from "./types";

export type SovereignEmbeddingProvider = {
  providerId: string;
  local: boolean;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
};

export async function indexKnowledgeEmbeddings(input: {
  chunks: KnowledgeChunk[];
  provider: SovereignEmbeddingProvider;
  signal?: AbortSignal;
}) {
  if (!input.provider.local) throw Object.assign(new Error("知識索引只允許已核准的閉端 embedding provider。"), { code: "KNOWLEDGE_EXTERNAL_EMBEDDING_FORBIDDEN" });
  const vectors = await input.provider.embed(input.chunks.map((chunk) => chunk.text), input.signal);
  if (vectors.length !== input.chunks.length || vectors.some((vector) => !vector.length || vector.some((value) => !Number.isFinite(value)))) {
    throw Object.assign(new Error("Embedding 輸出與知識切片不一致。"), { code: "KNOWLEDGE_EMBEDDING_INVALID" });
  }
  return input.chunks.map((chunk, index) => ({
    chunkId: chunk.chunkId,
    sourceId: chunk.sourceId,
    vector: vectors[index],
    providerId: input.provider.providerId,
  }));
}
