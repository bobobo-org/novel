export type KnowledgeIndexResidue = {
  documents: string[];
  chunks: string[];
  embeddings: string[];
  graphEdges: string[];
  citations: string[];
  cachedRetrievals: string[];
};

export function verifyKnowledgeSourceDeletion(sourceId: string, residue: KnowledgeIndexResidue) {
  const remaining = Object.fromEntries(
    Object.entries(residue).map(([kind, ids]) => [kind, ids.filter((id) => id.includes(sourceId))]),
  ) as Record<keyof KnowledgeIndexResidue, string[]>;
  const remainingCount = Object.values(remaining).reduce((sum, rows) => sum + rows.length, 0);
  return {
    sourceId,
    closed: remainingCount === 0,
    remaining,
    remainingCount,
    errorCode: remainingCount === 0 ? null : "VECTOR_INDEX_DELETION_INCOMPLETE",
  };
}
