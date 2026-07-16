import type { ContextConnection } from "./context-composer-service";

export function analyzeRelationshipProgression(connection: ContextConnection, projectId: string) {
  const rows = connection.all("SELECT DISTINCT relationship_id FROM retrieval_relationships WHERE project_id=? LIMIT 20", [projectId]);
  return rows.map((row) => ({
    relationshipId: String(row.relationship_id),
    startingState: "known",
    majorInteractions: [],
    trustProgression: "stable",
    attractionProgression: "not_assessed",
    conflictProgression: "active",
    powerBalance: "unclear",
    turningPoints: [],
    currentState: "in_progress",
    contradictions: [],
    unresolvedIssues: [],
    evidence: [String(row.relationship_id)],
  }));
}
