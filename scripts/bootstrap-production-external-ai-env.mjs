import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readVercelProductionEnvironmentMetadata } from "./production-environment-governance.mjs";
import { upsertSensitiveProductionEnvironment } from "./vercel-environment-mutation.mjs";

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
  const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "vercel", ...args], {
    encoding: "utf8",
    env: process.env,
    input,
    maxBuffer: 4 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    timeout: 60_000,
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

export function planXaiProductionChanges({
  production,
  configuration,
  allowedMutationKeys = PRODUCTION_EXTERNAL_AI_MUTATION_KEYS,
  environmentMetadata,
}) {
  const allowed = new Set(allowedMutationKeys);
  for (const key of allowed) {
    if (!PRODUCTION_EXTERNAL_AI_MUTATION_KEYS.includes(key)) {
      throw Object.assign(new Error("XAI_UNSUPPORTED_MUTATION_KEY"), {
        code: "XAI_UNSUPPORTED_MUTATION_KEY",
      });
    }
  }
  const planned = [];
  const credentialMetadataType = environmentMetadata?.entries?.XAI_API_KEY?.type;
  const credentialMetadataSafe = ["encrypted", "sensitive"].includes(credentialMetadataType);
  const credentialReadable = Boolean(String(production.XAI_API_KEY || "").trim())
    && credentialMetadataType !== "sensitive";
  if (
    configuration.credentialSource === "github_secret"
    && (
      allowed.has("XAI_API_KEY")
      || (credentialReadable && production.XAI_API_KEY !== configuration.apiKey)
      || (!credentialReadable && !credentialMetadataSafe)
    )
  ) planned.push("XAI_API_KEY");
  if (production.XAI_MODEL_ID !== configuration.modelId) planned.push("XAI_MODEL_ID");
  const unaudited = planned.filter((key) => !allowed.has(key));
  if (unaudited.length > 0) {
    throw Object.assign(new Error("XAI_UNAUDITED_PRODUCTION_DRIFT"), {
      code: "XAI_UNAUDITED_PRODUCTION_DRIFT",
      unauditedKeys: unaudited,
    });
  }
  return planned;
}

export const PRODUCTION_EXTERNAL_AI_MUTATION_KEYS = Object.freeze([
  "XAI_API_KEY",
  "XAI_MODEL_ID",
]);

export async function main({
  allowedMutationKeys = PRODUCTION_EXTERNAL_AI_MUTATION_KEYS,
} = {}) {
  const projectId = process.env.VERCEL_PROJECT_ID || "";
  const scope = process.env.VERCEL_SCOPE || "";
  const token = process.env.VERCEL_TOKEN || "";
  const teamId = process.env.VERCEL_ORG_ID || "";
  assert.ok(projectId && scope && token && teamId, "VERCEL_EXTERNAL_AI_BOOTSTRAP_AUTH_MISSING");
  const directory = await mkdtemp(`${tmpdir()}/novel-external-ai-bootstrap-`);
  const productionFile = resolve(directory, ".env.production");
  try {
    const production = await pullProductionEnvironment({
      filename: productionFile,
      projectId,
      scope,
      token,
    });
    const environmentMetadata = await readVercelProductionEnvironmentMetadata({
      token,
      teamId,
      projectId,
    });
    let configuration;
    try {
      configuration = resolveXaiBootstrapConfiguration({
        githubApiKey: process.env.XAI_API_KEY,
        githubModelId: process.env.XAI_MODEL_ID,
        production,
      });
    } catch (error) {
      if (error?.code !== "XAI_API_KEY_NOT_CONFIGURED") throw error;
      console.log(JSON.stringify({
        status: "production_xai_env_not_configured",
        modelId: process.env.XAI_MODEL_ID || DEFAULT_XAI_MODEL_ID,
        modelAvailable: false,
        credentialExposed: false,
      }));
      return {
        mutationCount: 0,
        changedKeys: [],
        credentialVerification: {
          verified: false,
          modelId: process.env.XAI_MODEL_ID || DEFAULT_XAI_MODEL_ID,
          credentialSource: null,
          secretValuesStored: false,
        },
      };
    }
    const verification = await verifyXaiCredential(configuration);
    const productionChanges = planXaiProductionChanges({
      production,
      configuration,
      allowedMutationKeys,
      environmentMetadata,
    });

    const actualChangedKeys = [];
    if (productionChanges.includes("XAI_API_KEY")) {
      const mutation = await upsertSensitiveProductionEnvironment({
        token,
        teamId,
        projectId,
        key: "XAI_API_KEY",
        value: configuration.apiKey,
      });
      actualChangedKeys.push(...mutation.changedKeys);
    }
    if (productionChanges.includes("XAI_MODEL_ID")) {
      runVercel([
        "env", "add", "XAI_MODEL_ID", "production",
        "--project", projectId,
        "--scope", scope,
        "--token", token,
        "--force",
        "--no-sensitive",
        "--yes",
      ], `${configuration.modelId}\n`);
      actualChangedKeys.push("XAI_MODEL_ID");
    }
    if (actualChangedKeys.includes("XAI_API_KEY")) {
      const verifiedMetadata = await readVercelProductionEnvironmentMetadata({
        token,
        teamId,
        projectId,
      });
      assert.equal(
        verifiedMetadata.entries.XAI_API_KEY?.type,
        "sensitive",
        "XAI_API_KEY_METADATA_NOT_SENSITIVE",
      );
    }

    console.log(JSON.stringify({
      status: actualChangedKeys.length > 0
        ? "production_xai_env_promoted"
        : "production_xai_env_already_ready",
      credentialSource: configuration.credentialSource,
      modelId: configuration.modelId,
      modelAvailable: verification.modelAvailable,
      modelCount: verification.modelCount,
      credentialExposed: false,
      promotedKeys: actualChangedKeys,
      mutationCount: actualChangedKeys.length,
    }));
    return {
      mutationCount: actualChangedKeys.length,
      changedKeys: actualChangedKeys,
      credentialVerification: {
        verified: verification.modelAvailable === true,
        modelId: configuration.modelId,
        credentialSource: configuration.credentialSource,
        verificationCode: "MODEL_ACCESS_VERIFIED",
        secretValuesStored: false,
      },
    };
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
