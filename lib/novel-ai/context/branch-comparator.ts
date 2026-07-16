import type { ContextConnection } from "./context-composer-service";

export function compareBranches(connection: ContextConnection, projectId: string, branchIds = ["main", "branch_side"]) {
  return {
    branchIds,
    plotDifferences: branchIds.map((branchId) => ({ branchId, documentCount: connection.all("SELECT document_id FROM retrieval_documents WHERE project_id=? AND branch_id=?", [projectId, branchId]).length })),
    characterOutcomes: [],
    relationshipOutcomes: [],
    worldStateDifferences: [],
    unresolvedThreads: [],
    consequences: [],
    canonicalCandidates: [],
    pacing: [],
    readerImpact: "branch comparison available",
  };
}
