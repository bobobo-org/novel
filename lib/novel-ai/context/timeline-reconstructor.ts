import type { ContextConnection } from "./context-composer-service";

export function reconstructTimeline(connection: ContextConnection, projectId: string, branchId = "main") {
  const rows = connection.all("SELECT d.document_id, d.title, m.chapter_id, m.branch_id FROM retrieval_documents d JOIN retrieval_metadata m ON m.project_id=d.project_id AND m.document_id=d.document_id WHERE d.project_id=? AND (m.branch_id=? OR m.branch_id='main') ORDER BY m.chapter_id, d.created_at LIMIT 80", [projectId, branchId]);
  return rows.map((row, index) => ({
    eventId: String(row.document_id),
    eventTime: `sequence_${index + 1}`,
    sequence: index + 1,
    chapter: row.chapter_id ? String(row.chapter_id) : "",
    branch: String(row.branch_id || "main"),
    participants: [],
    location: "",
    cause: "",
    consequence: "",
    contradiction: false,
    uncertainty: row.chapter_id ? "low" : "medium",
    confidence: row.chapter_id ? 0.9 : 0.65,
    evidence: [String(row.title || row.document_id)],
  }));
}
