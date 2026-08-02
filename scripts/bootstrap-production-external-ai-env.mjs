import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_XAI_MODEL_ID = "grok-4.5";

export function parseExternalAIEnv(source) {
  const parsed = {};
  for (const rawLine of String(source || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

export function validateXaiBootstrapInput({ apiKey, modelId }) {
  const normalizedKey = String(apiKey || "").trim();
  const normalizedModel = String(modelId || DEFAULT_XAI_MODEL_ID).trim();
  if (normalizedKey.length < 20 || /\s/u.test(normalizedKey)) {
    throw Object.assign(new Error("XAI_API_KEY_INVALID"), { code: "XAI_API_KEY_INVALID" });
  }
  if (!/^grok-[a-z0-9.-]+$/u.test(normalizedModel)) {
    throw Object.assign(new Error("XAI_MODEL_ID_INVALID"), { code: "XAI_MODEL_ID_INVALID" });
  }
  return { apiKey: normalizedKey, modelId: normalizedModel };
}

export function resolveXaiBootstrapConfiguration({ githubApiKey, githubModelId, production = {} }) {
  const githubKey = String(githubApiKey || "").trim();
  const productionKey = String(production.XAI_API_KEY || "").trim();
  if (!githubKey && !productionKey) {
    throw Object.assign(new Error("XAI_API_KEY_NOT_CONFIGURED"), { code: "XAI_API_KEY_NOT_CONFIGURED" });
  }
  return {
    ...validateXaiBootstrapInput({
      apiKey: githubKey || productionKey,
      modelId: githubModelId || production.XAI_MODEL_ID || DEFAULT_XAI_MODEL_ID,
    }),
    credentialSource: githubKey ? "github_secret" : "vercel_production",
  };
}

export async function verifyXaiCredential({ apiKey, modelId, fetcher = fetch }) {
  const response = await fetcher("https://api.x.ai/v1/models", {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error("XAI_CREDENTIAL_VERIFICATION_FAILED"), {
      code: "XAI_CREDENTIAL_VERIFICATION_FAILED",
      httpStatus: response.status,
    });
  }
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const available = new Set(rows.flatMap((row) => [
    String(row?.id || ""),
    ...(Array.isArray(row?.aliases) ? row.aliases.map(String) : []),
  ]).filter(Boolean));
  if (!available.has(modelId)) {
    throw Object.assign(new Error("XAI_MODEL_NOT_AVAILABLE_TO_ACCOUNT"), {
      code: "XAI_MODEL_NOT_AVAILABLE_TO_ACCOUNT",
      modelCount: rows.length,
    });
  }
  return { modelCount: rows.length, modelAvailable: true };
}

function runVercel(args, input) {
  const result = spawnSync("vercel", args, {
    encoding: "utf8",
    env: process.env,
    input,
    maxBuffer: 4 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw Object.assign(new Error("VERCEL_EXTERNAL_AI_ENV_COMMAND_FAILED"), {
      code: "VERCEL_EXTERNAL_AI_ENV_COMMAND_FAILED",
    });
  }
}

async function pullProductionEnvironment({ filename, projectId, scope, token }) {
  runVercel([
    "env", "pull", filename,
    "--environment", "production",
    "--project", projectId,
    "--scope", scope,
    "--token", token,
    "--yes",
  ]);
  return parseExternalAIEnv(await readFile(filename, "utf8"));
}

export async function main() {
  const projectId = process.env.VERCEL_PROJECT_ID || "";
  const scope = process.env.VERCEL_SCOPE || "";
  const token = process.env.VERCEL_TOKEN || "";
  assert.ok(projectId && scope && token, "VERCEL_EXTERNAL_AI_BOOTSTRAP_AUTH_MISSING");
  const directory = await mkdtemp(`${tmpdir()}/novel-external-ai-bootstrap-`);
  const productionFile = resolve(directory, ".env.production");
  try {
    const production = await pullProductionEnvironment({
      filename: productionFile,
      projectId,
      scope,
      token,
    });
    const configuration = resolveXaiBootstrapConfiguration({
      githubApiKey: process.env.XAI_API_KEY,
      githubModelId: process.env.XAI_MODEL_ID,
      production,
    });
    const verification = await verifyXaiCredential(configuration);

    if (configuration.credentialSource === "github_secret") {
      runVercel([
        "env", "add", "XAI_API_KEY", "production",
        "--project", projectId,
        "--scope", scope,
        "--token", token,
        "--force",
        "--sensitive",
        "--yes",
      ], `${configuration.apiKey}\n`);
    }
    if (production.XAI_MODEL_ID !== configuration.modelId) {
      runVercel([
        "env", "add", "XAI_MODEL_ID", "production",
        "--project", projectId,
        "--scope", scope,
        "--token", token,
        "--force",
        "--no-sensitive",
        "--yes",
      ], `${configuration.modelId}\n`);
    }

    console.log(JSON.stringify({
      status: configuration.credentialSource === "github_secret"
        ? "production_xai_env_promoted"
        : "production_xai_env_already_ready",
      credentialSource: configuration.credentialSource,
      modelId: configuration.modelId,
      modelAvailable: verification.modelAvailable,
      modelCount: verification.modelCount,
      credentialExposed: false,
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "production_xai_env_bootstrap_failed",
      errorCode: String(error?.code || error?.message || "PRODUCTION_XAI_ENV_BOOTSTRAP_FAILED"),
      httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
      modelCount: Number.isInteger(error?.modelCount) ? error.modelCount : null,
      credentialExposed: false,
    }));
    process.exitCode = 1;
  });
}
