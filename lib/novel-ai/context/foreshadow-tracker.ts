import type { ContextConnection } from "./context-composer-service";

export function trackForeshadowing(connection: ContextConnection, projectId: string) {
  const rows = connection.all("SELECT document_id, title, body, branch_id FROM retrieval_documents WHERE project_id=? AND (lower(body) LIKE '%foreshadow%' OR lower(body) LIKE '%clue%' OR lower(body) LIKE '%secret%' OR lower(body) LIKE '%silver moth%' OR body LIKE '%伏筆%' OR body LIKE '%線索%' OR body LIKE '%秘密%') AND deleted_at IS NULL LIMIT 30", [projectId]);
  return rows.map((row) => {
    const body = String(row.body || "");
    const paid = /paid|payoff|resolved|revealed|回收|揭露/i.test(body);
    return {
      foreshadowId: String(row.document_id),
      setup: String(row.title || row.document_id),
      clueIds: [],
      sourceChapter: "",
      intendedPayoff: "",
      actualPayoff: paid ? "mentioned" : "",
      status: paid ? "paid" : "planted",
      overdue: false,
      contradicted: false,
      branch: String(row.branch_id || "main"),
      evidence: [String(row.title || row.document_id)],
    };
  });
}
