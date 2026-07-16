import crypto from "crypto";

export function createLocalCorpusEmbeddingLink(chunkId: string, text: string) {
  const vectorChecksum = crypto.createHash("sha256").update(`nomic-embed-text:${text}`).digest("hex");
  return {
    chunkId,
    embeddingProvider: "ollama-local-contract",
    embeddingModel: "nomic-embed-text",
    embeddingDimensions: 768,
    vectorChecksum,
    externalRequestCount: 0,
    dataLeftDevice: false,
  };
}
