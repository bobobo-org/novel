import type { ContextConnection } from "./context-composer-service";

export function comparePublicCorpusStructure(connection: ContextConnection, projectId: string) {
  const rows = connection.all("SELECT work_id, title, body FROM public_corpus_fts_documents WHERE project_id=? LIMIT 10", [projectId]);
  return {
    selectedWorks: rows.map((row) => String(row.work_id || row.title)),
    comparisonDimensions: ["plot_structure", "pacing", "reveal_pattern"],
    structuralSimilarities: rows.length ? ["chapterized reference available"] : [],
    structuralDifferences: [],
    reusablePrinciples: ["use structural pattern only, never copy prose"],
    originalityRisks: [],
    citations: rows.map((row) => String(row.title)),
  };
}
