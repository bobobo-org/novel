import { corpusId, type CorpusImportConnection } from "./corpus-import-repository";

export function auditCorpusImport(connection: CorpusImportConnection, projectId: string, action: string, entityType: string, entityId: string, details: unknown) {
  connection.run(`INSERT OR REPLACE INTO public_corpus_audits(project_id, audit_id, action, entity_type, entity_id, row_json, created_at)
    VALUES(?,?,?,?,?,?,?)`, [projectId, corpusId("audit", { action, entityType, entityId, at: new Date().toISOString() }), action, entityType, entityId, JSON.stringify(details), new Date().toISOString()]);
}
