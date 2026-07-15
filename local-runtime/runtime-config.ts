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

export function createLocalRuntimeConfig(input: Partial<LocalRuntimeConfig> = {}): LocalRuntimeConfig {
  return {
    host: "127.0.0.1",
    port: input.port ?? Number(process.env.NOVEL_LOCAL_RUNTIME_PORT || 43117),
    allowedOrigins: input.allowedOrigins ?? ["http://127.0.0.1", "http://localhost", "https://novel-orcin.vercel.app"],
    sessionTtlMs: input.sessionTtlMs ?? 30 * 60 * 1000,
    maxRequestBytes: input.maxRequestBytes ?? 512 * 1024,
    token: input.token ?? process.env.NOVEL_LOCAL_RUNTIME_TOKEN ?? crypto.randomBytes(24).toString("hex"),
    storageDir: input.storageDir,
  };
}
