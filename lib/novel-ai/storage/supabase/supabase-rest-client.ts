export type JsonRecord = Record<string, unknown>;

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

export function isSupabaseConfigured() {
  const cfg = supabaseConfig();
  return Boolean(cfg.url && cfg.key);
}

export async function supabaseRest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.key) throw new Error("STORY_BIBLE_PERSISTENCE_NOT_CONFIGURED");
  const query = init.query ? `?${init.query}` : "";
  const response = await fetch(`${cfg.url}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      prefer: "return=representation,resolution=merge-duplicates",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`STORY_BIBLE_HTTP_${response.status}:${text.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function supabaseUpsert(table: string, row: JsonRecord, onConflict = "id") {
  return supabaseRest<JsonRecord[]>(table, {
    method: "POST",
    query: `on_conflict=${encodeURIComponent(onConflict)}`,
    body: JSON.stringify(row),
  });
}

export async function supabaseInsertRows(table: string, rows: JsonRecord[]) {
  if (rows.length === 0) return [];
  return supabaseRest<JsonRecord[]>(table, { method: "POST", body: JSON.stringify(rows) });
}

export async function supabaseDeleteWhereProject(table: string, projectId: string) {
  return supabaseRest(table, {
    method: "DELETE",
    query: `project_id=eq.${encodeURIComponent(projectId)}`,
    headers: { prefer: "return=minimal" },
  });
}

export function queryValue(value: string) {
  return encodeURIComponent(value);
}
