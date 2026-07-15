import crypto from "crypto";
import type { SQLiteProjectConnection } from "../../storage/sqlite/sqlite-connection";

export class IntimacySceneRepository {
  readonly connection: SQLiteProjectConnection;
  readonly projectId: string;

  constructor(connection: SQLiteProjectConnection, projectId: string) {
    this.connection = connection;
    this.projectId = projectId;
  }

  id(prefix: string) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  insert(table: string, id: string, row: Record<string, unknown>, columns: Record<string, unknown> = {}) {
    const all: Record<string, string | number | null> = { id, project_id: this.projectId, row_json: JSON.stringify(row), ...(columns as Record<string, string | number | null>) };
    const keys = Object.keys(all);
    this.connection.run(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`, keys.map((key) => all[key] as string | number | null));
    return row;
  }

  updateRow(table: string, id: string, row: Record<string, unknown>, columns: Record<string, unknown> = {}) {
    const assignments = ["row_json=?", "updated_at=?"].concat(Object.keys(columns).map((key) => `${key}=?`));
    const values = Object.values(columns) as Array<string | number | null>;
    this.connection.run(`UPDATE ${table} SET ${assignments.join(", ")} WHERE id=? AND project_id=?`, [JSON.stringify(row), new Date().toISOString(), ...values, id, this.projectId]);
    return row;
  }

  getById<T>(table: string, id: string): T | null {
    const row = this.connection.get(`SELECT row_json FROM ${table} WHERE id=? AND project_id=?`, [id, this.projectId]);
    return row ? JSON.parse(String(row.row_json)) as T : null;
  }

  listByScene<T>(table: string, sceneId: string, order = "created_at ASC"): T[] {
    return this.connection.all(`SELECT row_json FROM ${table} WHERE project_id=? AND scene_id=? ORDER BY ${order}`, [this.projectId, sceneId]).map((row) => JSON.parse(String(row.row_json)) as T);
  }

  count(table: string, where = "1=1") {
    return Number(this.connection.get(`SELECT count(*) AS count FROM ${table} WHERE project_id=? AND ${where}`, [this.projectId])?.count ?? 0);
  }
}
