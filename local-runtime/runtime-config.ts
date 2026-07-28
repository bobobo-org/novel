import crypto from "crypto";

export const LOCAL_RUNTIME_PROTOCOL_VERSION = "novel-local-runtime-v1";
export const LOCAL_RUNTIME_VERSION = "h1-local-runtime-v1";

export type LocalRuntimeConfig = {
  host: "127.0.0.1";
  port: number;
  allowedOrigins: string[];
  sessionTtlMs: number;
  maxRequestBytes: number;
  token: string;
  storageDir?: string;
};

const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1",
  "http://localhost",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "https://novel-orcin.vercel.app",
  "https://novel-lqtechs-projects.vercel.app",
];

export function normalizeLocalRuntimeOrigin(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid local runtime origin: ${value}`);
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || (parsed.protocol === "http:" && !loopback)
    || parsed.hostname.includes("*")
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`Invalid local runtime origin: ${value}`);
  }
  return parsed.origin;
}

export function createLocalRuntimeConfig(input: Partial<LocalRuntimeConfig> = {}): LocalRuntimeConfig {
  const allowedOrigins = [...new Set((input.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS).map(normalizeLocalRuntimeOrigin))];
  return {
    host: "127.0.0.1",
    port: input.port ?? Number(process.env.NOVEL_LOCAL_RUNTIME_PORT || 43117),
    allowedOrigins,
    sessionTtlMs: input.sessionTtlMs ?? 30 * 60 * 1000,
    maxRequestBytes: input.maxRequestBytes ?? 512 * 1024,
    token: input.token ?? process.env.NOVEL_LOCAL_RUNTIME_TOKEN ?? crypto.randomBytes(24).toString("hex"),
    storageDir: input.storageDir,
  };
}
