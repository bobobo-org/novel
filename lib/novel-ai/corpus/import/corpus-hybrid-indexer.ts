export function createCorpusHybridIndexSummary(input: { chunkCount: number; ftsDocumentCount: number; embeddingLinkCount: number }) {
  return {
    hybridIndexCount: Math.min(input.chunkCount, input.ftsDocumentCount + input.embeddingLinkCount),
    sourceScopeSupported: ["PUBLIC_CORPUS", "USER_IMPORTED_LIBRARY"],
    metadataOnlyExcludedFromFullText: true,
  };
}
