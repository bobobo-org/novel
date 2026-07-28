import { makeRecord } from "../domain";
import { CHARACTER_AGENT_MIGRATION_VERSION, CHARACTER_AGENT_SCHEMA_VERSION } from "./types";

export function makeCharacterAgentRecord(projectId: string, source: "user" | "ai_candidate" | "system" = "ai_candidate") {
  const record = makeRecord(projectId, source);
  return {
    ...record,
    characterAgentSchemaVersion: CHARACTER_AGENT_SCHEMA_VERSION,
    migrationVersion: CHARACTER_AGENT_MIGRATION_VERSION,
  };
}

export function clampScore(value: number, min = -100, max = 100) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}
