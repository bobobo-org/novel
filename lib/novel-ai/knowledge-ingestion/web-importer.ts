import type { KnowledgeLicense } from "./types";

export type ControlledWebImport = {
  url: string;
  title: string;
  author?: string;
  content: string;
  license: KnowledgeLicense;
  userConfirmsAuthorization: boolean;
};

export function validateControlledWebImport(input: ControlledWebImport) {
  let parsed: URL;
  try { parsed = new URL(input.url); }
  catch { return { valid: false as const, errorCode: "KNOWLEDGE_SOURCE_URL_INVALID" }; }
  if (!["https:", "http:"].includes(parsed.protocol)) return { valid: false as const, errorCode: "KNOWLEDGE_SOURCE_PROTOCOL_FORBIDDEN" };
  if (!input.content.trim()) return { valid: false as const, errorCode: "KNOWLEDGE_SOURCE_EMPTY" };
  if (!input.userConfirmsAuthorization) return { valid: false as const, errorCode: "KNOWLEDGE_SOURCE_AUTHORIZATION_REQUIRED" };
  return {
    valid: true as const,
    errorCode: null,
    retrievalOnly: input.license === "unknown" || input.license === "retrieval_only",
    networkFetchedBySystem: false,
  };
}
