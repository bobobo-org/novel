import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const REQUIRED_SUPABASE_KEYS = Object.freeze([
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_REF",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

export function parseEnvFile(source) {
  const parsed = {};
  for (const rawLine of source.split(/\r?\n/u)) {
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

export function projectRefFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return "";
    const [candidate, ...suffix] = url.hostname.split(".");
    if (suffix.join(".") !== "supabase.co") return "";
    return /^[a-z0-9]{8,32}$/u.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

export function serviceRoleCredentialKind(value) {
  if (/^sb_secret_[A-Za-z0-9._-]{16,}$/u.test(value)) return "secret_key";
  const parts = String(value).split(".");
  if (parts.length !== 3) return "";
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role === "service_role" ? "service_role_jwt" : "";
  } catch {
    return "";
  }
}

export function mergeProductionWithSource(production, source) {
  const first = (...values) => String(values.find(Boolean) || "").trim();
  const url = first(
    production.NEXT_PUBLIC_SUPABASE_URL,
    production.SUPABASE_URL,
    source.NEXT_PUBLIC_SUPABASE_URL,
    source.SUPABASE_URL,
  );
  return {
    SUPABASE_ACCESS_TOKEN: first(
      production.SUPABASE_ACCESS_TOKEN,
      production.SUPABASE_MANAGEMENT_TOKEN,
      source.SUPABASE_ACCESS_TOKEN,
      source.SUPABASE_MANAGEMENT_TOKEN,
    ),
    SUPABASE_PROJECT_REF: first(
      production.SUPABASE_PROJECT_REF,
      source.SUPABASE_PROJECT_REF,
      projectRefFromUrl(url),
    ),
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: first(
      production.SUPABASE_SERVICE_ROLE_KEY,
      source.SUPABASE_SERVICE_ROLE_KEY,
    ),
  };
}

export function validateConfigurationShape(configuration) {
  const missingKeys = REQUIRED_SUPABASE_KEYS.filter((key) => !configuration[key]);
  if (missingKeys.length > 0) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_SOURCE_MISSING"), {
      code: "SUPABASE_BOOTSTRAP_SOURCE_MISSING",
      missingKeys,
    });
  }
  const projectRef = projectRefFromUrl(configuration.NEXT_PUBLIC_SUPABASE_URL);
  if (!projectRef || projectRef !== configuration.SUPABASE_PROJECT_REF) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_IDENTITY_MISMATCH"), {
      code: "SUPABASE_BOOTSTRAP_IDENTITY_MISMATCH",
    });
  }
  if (!/^sbp_[A-Za-z0-9._-]{16,}$/u.test(configuration.SUPABASE_ACCESS_TOKEN)) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_MANAGEMENT_TOKEN_INVALID"), {
      code: "SUPABASE_BOOTSTRAP_MANAGEMENT_TOKEN_INVALID",
    });
  }
  if (!serviceRoleCredentialKind(configuration.SUPABASE_SERVICE_ROLE_KEY)) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_SERVICE_ROLE_INVALID"), {
      code: "SUPABASE_BOOTSTRAP_SERVICE_ROLE_INVALID",
    });
  }
  return { projectRef };
}

function runVercel(args, { input } = {}) {
  const result = spawnSync("vercel", args, {
    encoding: "utf8",
    env: process.env,
    input,
    maxBuffer: 4 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw Object.assign(new Error("VERCEL_ENV_COMMAND_FAILED"), {
      code: "VERCEL_ENV_COMMAND_FAILED",
    });
  }
}

async function pullEnvironment({ filename, environment, projectId, scope, token }) {
  runVercel([
    "env", "pull", filename,
    "--environment", environment,
    "--project", projectId,
    "--scope", scope,
    "--token", token,
    "--yes",
  ]);
  return parseEnvFile(await readFile(filename, "utf8"));
}

async function fetchWithTimeout(url, options, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifySupabase(configuration, projectRef) {
  const managementResponse = await fetchWithTimeout(
    `https://api.supabase.com/v1/projects/${projectRef}`,
    { headers: { authorization: `Bearer ${configuration.SUPABASE_ACCESS_TOKEN}` } },
  );
  const project = await managementResponse.json().catch(() => null);
  if (!managementResponse.ok || ![project?.id, project?.ref].includes(projectRef)) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_MANAGEMENT_VERIFICATION_FAILED"), {
      code: "SUPABASE_BOOTSTRAP_MANAGEMENT_VERIFICATION_FAILED",
    });
  }

  const credentialKind = serviceRoleCredentialKind(configuration.SUPABASE_SERVICE_ROLE_KEY);
  const serviceRoleHeaders = {
    apikey: configuration.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (credentialKind === "service_role_jwt") {
    serviceRoleHeaders.authorization = `Bearer ${configuration.SUPABASE_SERVICE_ROLE_KEY}`;
  }
  const serviceRoleResponse = await fetchWithTimeout(
    `${configuration.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/u, "")}/rest/v1/`,
    { headers: serviceRoleHeaders },
  );
  await serviceRoleResponse.body?.cancel().catch(() => undefined);
  if (!serviceRoleResponse.ok) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_SERVICE_ROLE_VERIFICATION_FAILED"), {
      code: "SUPABASE_BOOTSTRAP_SERVICE_ROLE_VERIFICATION_FAILED",
    });
  }
}

export async function main() {
  const projectId = process.env.VERCEL_PROJECT_ID || "";
  const scope = process.env.VERCEL_SCOPE || "";
  const token = process.env.VERCEL_TOKEN || "";
  assert.ok(projectId && scope && token, "VERCEL_BOOTSTRAP_AUTH_MISSING");

  const directory = await mkdtemp(`${tmpdir()}/novel-supabase-bootstrap-`);
  const productionFile = resolve(directory, ".env.production");
  const previewFile = resolve(directory, ".env.preview");
  const developmentFile = resolve(directory, ".env.development");
  try {
    const production = await pullEnvironment({
      filename: productionFile,
      environment: "production",
      projectId,
      scope,
      token,
    });
    const productionMissing = REQUIRED_SUPABASE_KEYS.filter((key) => !production[key]);
    let source = {};
    if (productionMissing.length > 0) {
      const preview = await pullEnvironment({
        filename: previewFile,
        environment: "preview",
        projectId,
        scope,
        token,
      });
      const development = await pullEnvironment({
        filename: developmentFile,
        environment: "development",
        projectId,
        scope,
        token,
      });
      source = { ...development, ...preview };
    }
    const configuration = mergeProductionWithSource(production, source);
    let projectRef;
    try {
      ({ projectRef } = validateConfigurationShape(configuration));
    } catch (error) {
      error.availableSourceKeys = Object.keys(source)
        .filter((key) => /^(?:SUPABASE|DATABASE|POSTGRES)_/u.test(key))
        .sort();
      throw error;
    }
    await verifySupabase(configuration, projectRef);

    for (const key of productionMissing) {
      runVercel([
        "env", "add", key, "production",
        "--project", projectId,
        "--scope", scope,
        "--token", token,
        "--force",
        "--no-sensitive",
        "--yes",
      ], { input: `${configuration[key]}\n` });
    }

    const verified = await pullEnvironment({
      filename: productionFile,
      environment: "production",
      projectId,
      scope,
      token,
    });
    for (const key of REQUIRED_SUPABASE_KEYS) {
      assert.equal(verified[key], configuration[key], `${key}_PROMOTION_MISMATCH`);
    }
    console.log(JSON.stringify({
      status: productionMissing.length > 0
        ? "production_supabase_env_promoted"
        : "production_supabase_env_already_ready",
      promotedKeys: productionMissing,
      requiredKeyCount: REQUIRED_SUPABASE_KEYS.length,
      projectRefSuffix: projectRef.slice(-4),
      managementVerified: true,
      serviceRoleVerified: true,
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "production_supabase_env_bootstrap_failed",
      errorCode: String(error?.code || error?.message || "PRODUCTION_SUPABASE_ENV_BOOTSTRAP_FAILED"),
      missingKeys: Array.isArray(error?.missingKeys) ? error.missingKeys : [],
      availableSourceKeys: Array.isArray(error?.availableSourceKeys)
        ? error.availableSourceKeys
        : [],
    }));
    process.exitCode = 1;
  });
}
