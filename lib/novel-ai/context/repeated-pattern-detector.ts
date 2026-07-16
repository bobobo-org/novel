import type { ContextConnection } from "./context-composer-service";

export function detectRepeatedPatterns(connection: ContextConnection, projectId: string) {
  const rows = connection.all("SELECT title, body FROM retrieval_documents WHERE project_id=? AND deleted_at IS NULL LIMIT 100", [projectId]);
  const counts = new Map<string, number>();
  const phrases = ["capital archive", "Crimson Ledger", "Sky Seal", "silver moth", "unresolved", "council", "伏筆", "秘密", "線索"];
  for (const row of rows) {
    const body = String(row.body || "").toLowerCase();
    for (const phrase of phrases) {
      if (body.includes(phrase.toLowerCase())) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, count]) => count >= 3).map(([patternType, count]) => ({
    patternType,
    occurrences: count,
    similarity: Math.min(1, count / Math.max(1, rows.length)),
    fatigueRisk: count > 8 ? "high" : "medium",
    suggestedVariation: `vary ${patternType} presentation`,
  }));
}
