import crypto from "crypto";
import type { SQLiteProjectConnection } from "../../storage/sqlite/sqlite-connection";

export function hashContent(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export function writeIntimacyAudit(connection: SQLiteProjectConnection, input: {
  projectId: string;
  sceneId?: string;
  stageId?: string;
  versionId?: string;
  branchId?: string;
  action: string;
  previousStatus?: string;
  nextStatus?: string;
  policyVersion?: number;
  validationResult?: unknown;
  actorType?: string;
  details?: unknown;
}) {
  const id = `intimacy_audit_${crypto.randomUUID()}`;
  const row = { id, ...input, actorType: input.actorType || "system", contentHash: hashContent(input.details), summaryHash: hashContent(input.validationResult), createdAt: new Date().toISOString(), dataLeftDevice: false, externalRequestCount: 0 };
  connection.run(
    "INSERT INTO intimacy_scene_audits(id, project_id, scene_id, stage_id, version_id, branch_id, action, previous_status, next_status, policy_version, validation_result_json, actor_type, content_hash, summary_hash, row_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, input.projectId, input.sceneId ?? null, input.stageId ?? null, input.versionId ?? null, input.branchId ?? null, input.action, input.previousStatus ?? null, input.nextStatus ?? null, input.policyVersion ?? null, JSON.stringify(input.validationResult ?? {}), row.actorType, row.contentHash, row.summaryHash, JSON.stringify(row)]
  );
  return row;
}
