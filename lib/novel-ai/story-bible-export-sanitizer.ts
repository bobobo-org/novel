import crypto from "crypto";

type JsonRecord = Record<string, unknown>;

const SENSITIVE_KEY_PATTERNS = [
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /admin[_-]?token/i,
  /authorization/i,
  /password/i,
  /secret/i,
  /cookie/i,
  /connection[_-]?string/i,
  /database[_-]?url/i,
  /service[_-]?role/i,
  /session/i,
  /email/i,
  /phone/i,
  /ip[_-]?address/i,
  /^ip$/i,
  /local[_-]?path/i,
  /stack/i,
  /env/i,
];

const SECRET_VALUE_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: "openai_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { type: "gemini_key", pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/ },
  { type: "xai_key", pattern: /\bxai-[A-Za-z0-9_-]{20,}\b/ },
  { type: "vercel_token", pattern: /\bvcp_[A-Za-z0-9_-]{20,}\b/ },
  { type: "supabase_token", pattern: /\bsbp_[A-Za-z0-9_-]{20,}\b/ },
  { type: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { type: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i },
  { type: "database_url", pattern: /\bpostgres(?:ql)?:\/\/[^\s"']+/i },
  { type: "windows_path", pattern: /\b[A-Z]:\\(?:Users|Windows|Program Files|OneDrive)\\[^\s"']*/i },
  { type: "unix_home_path", pattern: /\/home\/[A-Za-z0-9._-]+\/[^\s"']*/ },
  { type: "authorization_header", pattern: /\bAuthorization\s*:\s*[^\n\r]+/i },
];

const SAFE_SOURCE_PROVIDERS = new Set([
  "browser_ai",
  "ollama",
  "local_rule",
  "local_closed_cloud",
  "chatgpt",
  "gemini",
  "grok",
  "supabase_import",
  "author",
  "system",
  "legacy_unknown",
]);

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function exportSafeId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(String(value ?? "unknown")).slice(0, 20)}`;
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function sanitizeProviderType(value: unknown) {
  const raw = String(value || "legacy_unknown").trim();
  return SAFE_SOURCE_PROVIDERS.has(raw) ? raw : "legacy_unknown";
}

export function redactSecretsDeep(value: unknown): { value: unknown; findings: Array<{ path: string; type: string }> } {
  const findings: Array<{ path: string; type: string }> = [];

  function walk(input: unknown, path: string): unknown {
    if (input == null || typeof input === "number" || typeof input === "boolean") return input;
    if (typeof input === "string") {
      let output = input;
      for (const item of SECRET_VALUE_PATTERNS) {
        if (item.pattern.test(output)) {
          findings.push({ path, type: item.type });
          output = output.replace(item.pattern, `[REDACTED:${item.type}]`);
        }
      }
      return output.normalize("NFC");
    }
    if (Array.isArray(input)) return input.map((item, index) => walk(item, `${path}[${index}]`));
    if (isPlainObject(input)) {
      const output: JsonRecord = {};
      for (const [key, item] of Object.entries(input)) {
        if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
          findings.push({ path: path ? `${path}.${key}` : key, type: "sensitive_key" });
          continue;
        }
        output[key] = walk(item, path ? `${path}.${key}` : key);
      }
      return output;
    }
    return String(input);
  }

  return { value: walk(value, ""), findings };
}

export function assertNoSecrets(value: unknown) {
  const text = JSON.stringify(value || null);
  const findings = SECRET_VALUE_PATTERNS
    .filter((item) => item.pattern.test(text))
    .map((item) => item.type);
  if (findings.length > 0) {
    return [...new Set(findings)];
  }
  return [];
}
