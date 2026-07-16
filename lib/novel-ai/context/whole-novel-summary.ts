import type { ContextConnection } from "./context-composer-service";

export function summarizeWholeNovel(connection: ContextConnection, projectId: string, branchId = "main") {
  const chapters = connection.all("SELECT title, body, chapter_id FROM retrieval_documents WHERE project_id=? AND document_type='chapter' AND (branch_id=? OR branch_id='main') AND deleted_at IS NULL ORDER BY chapter_id", [projectId, branchId]);
  const evidence = chapters.slice(0, 8).map((row) => String(row.title || row.chapter_id));
  return {
    premise: chapters[0] ? String(chapters[0].body || "").slice(0, 120) : "No chapters available.",
    majorArcs: chapters.slice(0, 5).map((row) => `Arc from ${row.title || row.chapter_id}`),
    majorEvents: chapters.map((row) => String(row.title || row.chapter_id)).slice(0, 12),
    characterChanges: [],
    relationshipChanges: [],
    unresolvedThreads: chapters.filter((row) => /未解|伏筆|秘密|疑/.test(String(row.body || ""))).map((row) => String(row.title || row.chapter_id)).slice(0, 8),
    foreshadowing: chapters.filter((row) => /伏筆|線索|秘密/.test(String(row.body || ""))).map((row) => String(row.title || row.chapter_id)).slice(0, 8),
    worldRuleChanges: chapters.filter((row) => /規則|能力|代價/.test(String(row.body || ""))).map((row) => String(row.title || row.chapter_id)).slice(0, 8),
    pacingNotes: [`chapterCount=${chapters.length}`],
    evidence,
  };
}
