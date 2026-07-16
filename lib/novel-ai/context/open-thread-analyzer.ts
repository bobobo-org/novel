import type { ContextConnection } from "./context-composer-service";

export function analyzeOpenThreads(connection: ContextConnection, projectId: string) {
  const rows = connection.all("SELECT document_id, title, body, branch_id FROM retrieval_documents WHERE project_id=? AND (lower(body) LIKE '%unresolved%' OR lower(body) LIKE '%open thread%' OR lower(body) LIKE '%mystery%' OR lower(body) LIKE '%not explained%' OR body LIKE '%未解%' OR body LIKE '%懸念%' OR body LIKE '%待解%') AND deleted_at IS NULL LIMIT 30", [projectId]);
  return rows.map((row, index) => ({
    threadId: String(row.document_id),
    description: String(row.title || row.document_id),
    introducedAt: `item_${index + 1}`,
    lastMentionedAt: `item_${index + 1}`,
    relatedCharacters: [],
    relatedEvents: [String(row.document_id)],
    urgency: index < 3 ? "high" : "medium",
    unresolvedReason: "not paid off yet",
    possiblePayoff: "connect to next chapter pressure",
    staleRisk: index > 10,
    branch: String(row.branch_id || "main"),
    evidence: [String(row.title || row.document_id)],
  }));
}
