import crypto from "crypto";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection";

export type AiTaskStatus = "queued" | "running" | "streaming" | "completed" | "cancelled" | "failed" | "retryable";

export type AiTaskRow = {
  taskId: string;
  projectId: string;
  taskType: string;
  provider: string;
  model: string;
  status: AiTaskStatus;
  dataLeftDevice: boolean;
  row: Record<string, unknown>;
};

export class AiTaskSQLiteStore {
  private connection: SQLiteProjectConnection;

  private constructor(connection: SQLiteProjectConnection) {
    this.connection = connection;
  }

  static async open(projectId: string, storageDir?: string) {
    const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
    const store = new AiTaskSQLiteStore(connection);
    store.migrate();
    return store;
  }

  migrate() {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS ai_tasks (
        task_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        data_left_device INTEGER NOT NULL DEFAULT 0,
        row_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS ai_task_attempts (
        attempt_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        row_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS ai_task_results (
        result_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        row_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS ai_task_events (
        event_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        row_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS ai_generation_drafts (
        draft_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        draft_text TEXT NOT NULL,
        row_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS ai_provider_audits (
        audit_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        row_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
  }

  createTask(input: Omit<AiTaskRow, "taskId"> & { taskId?: string }) {
    const taskId = input.taskId ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const row = { ...input.row, createdAt: now };
    this.connection.run(
      "INSERT INTO ai_tasks(task_id, project_id, task_type, provider, model, status, data_left_device, row_json, updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      [taskId, input.projectId, input.taskType, input.provider, input.model, input.status, input.dataLeftDevice ? 1 : 0, JSON.stringify(row), now],
    );
    this.addEvent(taskId, input.projectId, "queued", { status: input.status });
    return taskId;
  }

  updateStatus(taskId: string, projectId: string, status: AiTaskStatus, patch: Record<string, unknown> = {}) {
    const current = this.getTask(taskId, projectId);
    if (!current) return false;
    const row = { ...current.row, ...patch, updatedAt: new Date().toISOString() };
    this.connection.run("UPDATE ai_tasks SET status = ?, row_json = ?, updated_at = ? WHERE task_id = ? AND project_id = ?", [status, JSON.stringify(row), row.updatedAt as string, taskId, projectId]);
    this.addEvent(taskId, projectId, status, patch);
    return true;
  }

  addResult(taskId: string, projectId: string, result: Record<string, unknown>) {
    this.connection.run("INSERT INTO ai_task_results(result_id, task_id, project_id, row_json) VALUES(?,?,?,?)", [crypto.randomUUID(), taskId, projectId, JSON.stringify(result)]);
  }

  addDraft(taskId: string, projectId: string, draftText: string, metadata: Record<string, unknown>) {
    this.connection.run("INSERT INTO ai_generation_drafts(draft_id, task_id, project_id, draft_text, row_json) VALUES(?,?,?,?,?)", [crypto.randomUUID(), taskId, projectId, draftText, JSON.stringify(metadata)]);
  }

  addAudit(taskId: string, projectId: string, audit: Record<string, unknown>) {
    this.connection.run("INSERT INTO ai_provider_audits(audit_id, task_id, project_id, row_json) VALUES(?,?,?,?)", [crypto.randomUUID(), taskId, projectId, JSON.stringify(audit)]);
  }

  addEvent(taskId: string, projectId: string, eventType: string, row: Record<string, unknown>) {
    this.connection.run("INSERT INTO ai_task_events(event_id, task_id, project_id, event_type, row_json) VALUES(?,?,?,?,?)", [crypto.randomUUID(), taskId, projectId, eventType, JSON.stringify(row)]);
  }

  getTask(taskId: string, projectId: string): AiTaskRow | null {
    const row = this.connection.get("SELECT * FROM ai_tasks WHERE task_id = ? AND project_id = ?", [taskId, projectId]);
    if (!row) return null;
    return {
      taskId: String(row.task_id),
      projectId: String(row.project_id),
      taskType: String(row.task_type),
      provider: String(row.provider),
      model: String(row.model),
      status: String(row.status) as AiTaskStatus,
      dataLeftDevice: Number(row.data_left_device) === 1,
      row: JSON.parse(String(row.row_json)),
    };
  }

  counts() {
    return {
      tasks: Number(this.connection.get("SELECT COUNT(*) AS count FROM ai_tasks")?.count || 0),
      attempts: Number(this.connection.get("SELECT COUNT(*) AS count FROM ai_task_attempts")?.count || 0),
      results: Number(this.connection.get("SELECT COUNT(*) AS count FROM ai_task_results")?.count || 0),
      events: Number(this.connection.get("SELECT COUNT(*) AS count FROM ai_task_events")?.count || 0),
      drafts: Number(this.connection.get("SELECT COUNT(*) AS count FROM ai_generation_drafts")?.count || 0),
      audits: Number(this.connection.get("SELECT COUNT(*) AS count FROM ai_provider_audits")?.count || 0),
    };
  }

  close() {
    this.connection.close();
  }
}
