import { appendFile, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";

export const ORIGIN_REGISTRY_SCHEMA_VERSION = "novel-bridge-origin-registry-v1";
export const BUILT_IN_ORIGINS = Object.freeze([
  "https://novel-orcin.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

export function normalizeEnrolledOrigin(value) {
  if (!value || String(value).includes("*")) throw Object.assign(new Error("Origin must be exact and cannot contain a wildcard."), { code: "LAUNCHER_ORIGIN_INVALID" });
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw Object.assign(new Error("Origin is not a valid URL."), { code: "LAUNCHER_ORIGIN_INVALID" }); }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw Object.assign(new Error("Origin must contain only scheme, host, and optional port."), { code: "LAUNCHER_ORIGIN_INVALID" });
  if ((!local && parsed.protocol !== "https:") || (local && !["http:", "https:"].includes(parsed.protocol))) throw Object.assign(new Error("Remote origins must use HTTPS."), { code: "LAUNCHER_ORIGIN_INVALID" });
  if (!local && isIP(parsed.hostname.replace(/^\[|\]$/g, ""))) throw Object.assign(new Error("Remote IP origins are not allowed."), { code: "LAUNCHER_ORIGIN_INVALID" });
  return parsed.origin;
}

export function originScope(origin) {
  const hostname = new URL(origin).hostname;
  if (origin === "https://novel-orcin.vercel.app") return "production";
  if (["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) return "local";
  if (hostname.endsWith(".vercel.app")) return "preview";
  return "custom_https";
}

export function normalizeOriginRegistry(config = {}) {
  const rows = Array.isArray(config.originEnrollments) ? config.originEnrollments : [];
  const seen = new Set();
  const originEnrollments = [];
  for (const row of rows) {
    try {
      const origin = normalizeEnrolledOrigin(typeof row === "string" ? row : row?.origin);
      if (BUILT_IN_ORIGINS.includes(origin) || seen.has(origin)) continue;
      seen.add(origin);
      originEnrollments.push({ origin, scope: originScope(origin), enrolledAt: typeof row === "object" && row?.enrolledAt ? String(row.enrolledAt) : null });
    } catch { /* Invalid legacy rows are ignored and never authorized. */ }
  }
  return { ...config, schemaVersion: ORIGIN_REGISTRY_SCHEMA_VERSION, originEnrollments };
}

export function registeredOrigins(config = {}) {
  return [...BUILT_IN_ORIGINS, ...normalizeOriginRegistry(config).originEnrollments.map((row) => row.origin)];
}

export async function persistOriginRegistry(configPath, config) {
  const normalized = normalizeOriginRegistry(config);
  await writeFile(configPath, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  return normalized;
}

export async function appendOriginAudit(auditPath, event) {
  await appendFile(auditPath, `${JSON.stringify({ schemaVersion: ORIGIN_REGISTRY_SCHEMA_VERSION, ...event })}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readOriginAudit(auditPath) {
  try {
    return (await readFile(auditPath, "utf8")).split(/\r?\n/).filter(Boolean).slice(-100).map((line) => JSON.parse(line));
  } catch { return []; }
}
