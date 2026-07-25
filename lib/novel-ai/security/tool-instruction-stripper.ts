import type { KnowledgeBoundaryFinding } from "./knowledge-instruction-boundary";

export function stripToolInstructions(text: string, findings: KnowledgeBoundaryFinding[]) {
  const blocking = findings
    .filter((finding) => finding.severity === "blocking")
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((finding, index, rows) => index === 0 || finding.start >= rows[index - 1].end)
    .sort((a, b) => b.start - a.start);
  let sanitized = text;
  for (const finding of blocking) {
    sanitized = `${sanitized.slice(0, finding.start)}[untrusted instruction quarantined:${finding.code}]${sanitized.slice(finding.end)}`;
  }
  return sanitized
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const FORBIDDEN_KEYS = new Set([
  "toolname",
  "toolarguments",
  "shellcommand",
  "databasecommand",
  "approvalaction",
  "externalrequest",
  "selectedprovider",
  "canonicalmutation",
]);

export function stripUntrustedToolPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUntrustedToolPayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !FORBIDDEN_KEYS.has(key.toLocaleLowerCase("en-US")))
      .map(([key, child]) => [key, stripUntrustedToolPayload(child)]),
  );
}
