export const DOCUMENT_PARSER_POLICY_VERSION = "p23-document-parser-policy-v1" as const;

export type DocumentParserPolicy = {
  maxFileBytes: number;
  maxExtractedCharacters: number;
  maxPages: number;
  maxJsonDepth: number;
  maxArchiveEntries: number;
  maxCompressionRatio: number;
  maxParseTimeMs: number;
  maxParserMemoryMb: number;
  networkAllowed: false;
  childProcessAllowed: false;
  externalResourceLoading: false;
};

export const DEFAULT_DOCUMENT_PARSER_POLICY: DocumentParserPolicy = {
  maxFileBytes: 10 * 1024 * 1024,
  maxExtractedCharacters: 2_000_000,
  maxPages: 1000,
  maxJsonDepth: 64,
  maxArchiveEntries: 1000,
  maxCompressionRatio: 100,
  maxParseTimeMs: 10_000,
  maxParserMemoryMb: 256,
  networkAllowed: false,
  childProcessAllowed: false,
  externalResourceLoading: false,
};

function approximateJsonDepth(value: string) {
  let depth = 0;
  let maxDepth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (escaped) { escaped = false; continue; }
    if (character === "\\" && quoted) { escaped = true; continue; }
    if (character === "\"") { quoted = !quoted; continue; }
    if (quoted) continue;
    if (character === "{" || character === "[") maxDepth = Math.max(maxDepth, ++depth);
    if (character === "}" || character === "]") depth = Math.max(0, depth - 1);
  }
  return maxDepth;
}

export function enforceParserPolicy(input: {
  name: string;
  content: string;
  mimeType?: string;
  startedAt?: number;
}, policy: DocumentParserPolicy = DEFAULT_DOCUMENT_PARSER_POLICY) {
  const extension = input.name.split(".").pop()?.toLocaleLowerCase("en-US");
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(input.name) || /^[A-Za-z]:/.test(input.name)) {
    throw Object.assign(new Error("Document path traversal is forbidden."), { code: "DOCUMENT_PATH_TRAVERSAL_REJECTED" });
  }
  if (new TextEncoder().encode(input.content).byteLength > policy.maxFileBytes || input.content.length > policy.maxExtractedCharacters) {
    throw Object.assign(new Error("Document exceeds parser limits."), { code: "DOCUMENT_TOO_LARGE" });
  }
  if (["zip", "7z", "rar", "tar", "gz"].includes(extension ?? "")) {
    throw Object.assign(new Error("Archives require the isolated archive parser."), { code: "DOCUMENT_ARCHIVE_BOMB_REJECTED" });
  }
  if ((extension === "json" || input.mimeType === "application/json") && approximateJsonDepth(input.content) > policy.maxJsonDepth) {
    throw Object.assign(new Error("JSON nesting exceeds parser limits."), { code: "DOCUMENT_DEPTH_EXCEEDED" });
  }
  if ((input.startedAt ?? Date.now()) + policy.maxParseTimeMs < Date.now()) {
    throw Object.assign(new Error("Document parser timed out."), { code: "DOCUMENT_PARSE_TIMEOUT" });
  }
  return {
    policyVersion: DOCUMENT_PARSER_POLICY_VERSION,
    externalResourcesBlocked: /<(?:img|script|link|iframe|video|audio|source)\b[^>]+(?:src|href)\s*=\s*["']https?:/giu.test(input.content),
    networkAllowed: false as const,
    childProcessAllowed: false as const,
    externalResourceLoading: false as const,
  };
}
