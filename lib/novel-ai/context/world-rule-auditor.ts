import type { ContextConnection } from "./context-composer-service";

export function auditWorldRules(connection: ContextConnection, projectId: string) {
  const rules = connection.all("SELECT document_id, title, body FROM retrieval_documents WHERE project_id=? AND document_type='world_rule' LIMIT 30", [projectId]);
  return rules.map((row) => ({
    ruleId: String(row.document_id),
    conflictingEvidence: [],
    severity: "info",
    affectedChapters: [],
    possibleResolution: "keep rule explicit in next context",
    canonicalCandidate: String(row.title || row.document_id),
    evidence: [String(row.body || "").slice(0, 120)],
  }));
}
