type JsonRecord = Record<string, unknown>;

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

async function rest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
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

async function upsert(table: string, row: JsonRecord, onConflict = "id") {
  return rest<JsonRecord[]>(table, {
    method: "POST",
    query: `on_conflict=${encodeURIComponent(onConflict)}`,
    body: JSON.stringify(row),
  });
}

async function insertRows(table: string, rows: JsonRecord[]) {
  if (rows.length === 0) return [];
  return rest<JsonRecord[]>(table, { method: "POST", body: JSON.stringify(rows) });
}

export async function persistStoryBibleExtractionRows(input: {
  projectId: string;
  storyBibleRow: JsonRecord;
  extractionRunRow: JsonRecord;
  candidateRows: JsonRecord[];
  conflictRows: JsonRecord[];
  sourceRows: JsonRecord[];
  chapterSummaryRow: JsonRecord;
}) {
  await upsert("story_bibles", input.storyBibleRow, "project_id");
  await upsert("story_bible_extraction_runs", input.extractionRunRow);
  await insertRows("story_fact_candidates", input.candidateRows);
  await insertRows("story_fact_conflicts", input.conflictRows);
  await insertRows("story_fact_sources", input.sourceRows);
  await upsert("story_chapter_summaries", input.chapterSummaryRow);
}
