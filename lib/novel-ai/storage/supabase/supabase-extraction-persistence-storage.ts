type JsonRecord = Record<string, unknown>;

export const STORY_BIBLE_EXTRACTION_ATOMIC_RPC = "persist_story_bible_extraction_atomic";

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

async function rpc<T>(functionName: string, payload: JsonRecord): Promise<T> {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.key) throw new Error("STORAGE_ADAPTER_UNAVAILABLE:STORY_BIBLE_PERSISTENCE_NOT_CONFIGURED");
  const response = await fetch(`${cfg.url}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const code = response.status === 404 || response.status === 400 ? "STORAGE_SCHEMA_INCOMPATIBLE" : "STORAGE_PERSISTENCE_FAILED";
    throw new Error(`${code}:${response.status}:${text.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
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
  const result = await rpc<JsonRecord>(STORY_BIBLE_EXTRACTION_ATOMIC_RPC, {
    p_payload: {
      projectId: input.projectId,
      requestId: String(input.extractionRunRow.id || ""),
      storyBibleRow: input.storyBibleRow,
      extractionRunRow: input.extractionRunRow,
      candidateRows: input.candidateRows,
      conflictRows: input.conflictRows,
      sourceRows: input.sourceRows,
      chapterSummaryRow: input.chapterSummaryRow,
    },
  });
  if (result?.transactionStatus !== "committed") {
    throw new Error(`STORAGE_TRANSACTION_FAILED:${String(result?.transactionStatus || "unknown")}`);
  }
  return result;
}
