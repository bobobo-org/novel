export type StructuredRepairResult = {
  value: unknown;
  attempts: number;
  valid: boolean;
  failureCode: string | null;
};

type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

function parseCandidate(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = Math.min(...[trimmed.indexOf("{"), trimmed.indexOf("[")].filter((value) => value >= 0));
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (Number.isFinite(start) && start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    throw Object.assign(new Error("Structured output is not JSON."), { code: "STRUCTURED_OUTPUT_INVALID" });
  }
}

function matches(value: unknown, schema: JsonSchema): boolean {
  if (!schema.type) return true;
  if (schema.type === "null") return value === null;
  if (schema.type === "array") {
    return Array.isArray(value) && (!schema.items || value.every((item) => matches(item, schema.items!)));
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (schema.required?.some((key) => !(key in record))) return false;
    return Object.entries(schema.properties ?? {}).every(([key, nested]) =>
      !(key in record) || matches(record[key], nested));
  }
  if (schema.type === "integer") return Number.isInteger(value);
  return typeof value === schema.type;
}

function deterministicRepair(text: string, attempt: number) {
  let repaired = text.trim().replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
  if (attempt === 1) {
    repaired = repaired
      .replace(/[“”]/gu, '"')
      .replace(/[‘’]/gu, "'")
      .replace(/,\s*([}\]])/gu, "$1");
  } else {
    repaired = repaired
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/gu, '$1"$2"$3')
      .replace(/'/gu, '"');
  }
  return repaired;
}

export function validateAndRepairStructuredOutput(input: {
  text: string;
  schema: JsonSchema;
  maximumRepairAttempts?: number;
}): StructuredRepairResult {
  const maximum = Math.min(2, Math.max(0, input.maximumRepairAttempts ?? 2));
  let candidate = input.text;
  for (let attempt = 0; attempt <= maximum; attempt += 1) {
    try {
      const value = parseCandidate(candidate);
      if (matches(value, input.schema)) return { value, attempts: attempt, valid: true, failureCode: null };
    } catch {
      // The next deterministic repair pass may recover syntax.
    }
    if (attempt < maximum) candidate = deterministicRepair(candidate, attempt + 1);
  }
  return { value: null, attempts: maximum, valid: false, failureCode: "STRUCTURED_OUTPUT_INVALID" };
}
