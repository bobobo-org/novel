import type { ContextConnection } from "./context-composer-service";

export function analyzePacing(connection: ContextConnection, projectId: string) {
  const rows = connection.all("SELECT document_id, title, body FROM retrieval_documents WHERE project_id=? AND document_type='chapter' AND deleted_at IS NULL ORDER BY chapter_id LIMIT 80", [projectId]);
  const chapterScores = rows.map((row) => {
    const body = String(row.body || "");
    const dialogueRatio = ((body.match(/[「」"]/g) ?? []).length / Math.max(1, body.length));
    const actionDensity = ((body.match(/走|打|追|逃|推|闖|揭|問/g) ?? []).length / Math.max(1, body.length));
    return { chapterId: String(row.document_id), score: Number((0.5 + dialogueRatio + actionDensity).toFixed(3)) };
  });
  return {
    pacingProfile: rows.length > 20 ? "long_form" : "developing",
    chapterScores,
    slowZones: chapterScores.filter((score) => score.score < 0.51).map((score) => score.chapterId),
    rushedZones: [],
    repeatedPatterns: [],
    recommendedAdjustments: ["vary reveal spacing", "keep action tied to consequence"],
    evidence: rows.slice(0, 5).map((row) => String(row.title || row.document_id)),
  };
}
