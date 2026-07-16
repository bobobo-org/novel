import { corpusId, type CorpusImportConnection } from "./corpus-import-repository";

export function recordCorpusImportProvenance(connection: CorpusImportConnection, projectId: string, input: { sourceId: string; entityType: string; entityId: string; sourceUrl?: string; checksum: string; row: unknown }) {
  const provenanceId = corpusId("prov", input);
  connection.run(`INSERT OR REPLACE INTO public_corpus_provenance(project_id, provenance_id, source_id, entity_type, entity_id, source_url, imported_at, checksum, row_json)
    VALUES(?,?,?,?,?,?,?,?,?)`, [projectId, provenanceId, input.sourceId, input.entityType, input.entityId, input.sourceUrl ?? null, new Date().toISOString(), input.checksum, JSON.stringify(input.row)]);
  return provenanceId;
}
