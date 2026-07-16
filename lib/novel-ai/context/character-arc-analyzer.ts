import type { ContextConnection } from "./context-composer-service";

export function analyzeCharacterArcs(connection: ContextConnection, projectId: string) {
  const rows = connection.all("SELECT DISTINCT entity_id FROM retrieval_entities WHERE project_id=? AND entity_type='character' ORDER BY entity_id LIMIT 20", [projectId]);
  return rows.map((row) => ({
    characterId: String(row.entity_id),
    startingState: "introduced",
    goals: ["survive current conflict"],
    beliefs: [],
    fears: [],
    majorEvents: [],
    choices: [],
    relationshipChanges: [],
    turningPoints: [],
    contradictions: [],
    currentState: "active",
    unresolvedArc: true,
    proposedNextPressure: "force a concrete choice",
    evidence: [String(row.entity_id)],
  }));
}
