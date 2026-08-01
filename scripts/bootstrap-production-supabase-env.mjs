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
  const payload = decodeSupabaseJwt(value);
  return payload?.role === "service_role" ? "service_role_jwt" : "";
}

function decodeSupabaseJwt(value) {
  const parts = String(value).split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function projectRefFromServiceRole(value) {
  const payload = decodeSupabaseJwt(value);
  const projectRef = String(payload?.ref || "");
  return /^[a-z0-9]{8,32}$/u.test(projectRef) ? projectRef : "";
}

export function mergeProductionWithSource(production, source) {
  const first = (...values) => String(values.find(Boolean) || "").trim();
  const url = first(
    production.NEXT_PUBLIC_SUPABASE_URL,
    production.SUPABASE_URL,
    source.NEXT_PUBLIC_SUPABASE_URL,
    source.SUPABASE_URL,
  );
  const serviceRole = first(
    production.SUPABASE_SERVICE_ROLE_KEY,
    source.SUPABASE_SERVICE_ROLE_KEY,
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
      projectRefFromServiceRole(serviceRole),
    ),
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceRole,
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

function serviceRoleHeaders(serviceRoleCredential) {
  const headers = { apikey: serviceRoleCredential };
  if (serviceRoleCredentialKind(serviceRoleCredential) === "service_role_jwt") {
    headers.authorization = `Bearer ${serviceRoleCredential}`;
  }
  return headers;
}

export async function discoverProjectRef(configuration) {
  const response = await fetchWithTimeout("https://api.supabase.com/v1/projects", {
    headers: { authorization: `Bearer ${configuration.SUPABASE_ACCESS_TOKEN}` },
  });
  const body = await response.json().catch(() => null);
  const projects = Array.isArray(body)
    ? body
    : (Array.isArray(body?.projects) ? body.projects : null);
  if (!response.ok || !projects) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_PROJECT_DISCOVERY_FAILED"), {
      code: "SUPABASE_BOOTSTRAP_PROJECT_DISCOVERY_FAILED",
      httpStatus: response.status,
      responseShape: Array.isArray(body) ? "array" : typeof body,
    });
  }
  const projectRefs = [...new Set(projects
    .map((project) => String(project?.ref || project?.id || ""))
    .filter((projectRef) => /^[a-z0-9]{8,32}$/u.test(projectRef)))];
  const configuredCandidates = [
    projectRefFromUrl(configuration.NEXT_PUBLIC_SUPABASE_URL),
    projectRefFromServiceRole(configuration.SUPABASE_SERVICE_ROLE_KEY),
  ].filter(Boolean);
  const configuredMatches = [...new Set(
    configuredCandidates.filter((candidate) => projectRefs.includes(candidate)),
  )];
  if (configuredMatches.length === 1) {
    return { projectRef: configuredMatches[0], method: "configured_identity" };
  }
  if (configuredMatches.length > 1) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_PROJECT_IDENTITY_MISMATCH"), {
      code: "SUPABASE_BOOTSTRAP_PROJECT_IDENTITY_MISMATCH",
    });
  }

  const serviceRoleMatches = [];
  for (const projectRef of projectRefs) {
    const serviceRoleResponse = await fetchWithTimeout(
      `https://${projectRef}.supabase.co/rest/v1/`,
      { headers: serviceRoleHeaders(configuration.SUPABASE_SERVICE_ROLE_KEY) },
    );
    await serviceRoleResponse.body?.cancel().catch(() => undefined);
    if (serviceRoleResponse.ok) serviceRoleMatches.push(projectRef);
  }
  if (serviceRoleMatches.length === 1) {
    return { projectRef: serviceRoleMatches[0], method: "service_role_probe" };
  }
  if (serviceRoleMatches.length > 1) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_PROJECT_IDENTITY_AMBIGUOUS"), {
      code: "SUPABASE_BOOTSTRAP_PROJECT_IDENTITY_AMBIGUOUS",
      projectCount: serviceRoleMatches.length,
    });
  }

  if (projectRefs.length === 1) {
    return { projectRef: projectRefs[0], method: "unique_management_project" };
  }
  throw Object.assign(new Error("SUPABASE_BOOTSTRAP_PROJECT_IDENTITY_AMBIGUOUS"), {
    code: "SUPABASE_BOOTSTRAP_PROJECT_IDENTITY_AMBIGUOUS",
    projectCount: projectRefs.length,
  });
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

  const serviceRoleResponse = await fetchWithTimeout(
    `${configuration.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/u, "")}/rest/v1/`,
    { headers: serviceRoleHeaders(configuration.SUPABASE_SERVICE_ROLE_KEY) },
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
      if (process.env.SUPABASE_ACCESS_TOKEN) {
        source.SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
      }
    }
    const configuration = mergeProductionWithSource(production, source);
    let projectRef;
    let projectRefDiscovery = "configured";
    try {
      if (!configuration.SUPABASE_PROJECT_REF && configuration.SUPABASE_ACCESS_TOKEN) {
        const discovered = await discoverProjectRef(configuration);
        configuration.SUPABASE_PROJECT_REF = discovered.projectRef;
        projectRefDiscovery = discovered.method;
        if (projectRefFromUrl(configuration.NEXT_PUBLIC_SUPABASE_URL) !== discovered.projectRef) {
          configuration.NEXT_PUBLIC_SUPABASE_URL = `https://${discovered.projectRef}.supabase.co`;
        }
      }
      ({ projectRef } = validateConfigurationShape(configuration));
    } catch (error) {
      error.availableSourceKeys = Object.keys(source)
        .filter((key) => /^(?:SUPABASE|DATABASE|POSTGRES)_/u.test(key))
        .sort();
      throw error;
    }
    await verifySupabase(configuration, projectRef);

    const productionChanges = REQUIRED_SUPABASE_KEYS
      .filter((key) => production[key] !== configuration[key]);
    for (const key of productionChanges) {
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
      status: productionChanges.length > 0
        ? "production_supabase_env_promoted"
        : "production_supabase_env_already_ready",
      promotedKeys: productionChanges,
      requiredKeyCount: REQUIRED_SUPABASE_KEYS.length,
      projectRefSuffix: projectRef.slice(-4),
      projectRefDiscovery,
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
      httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
      responseShape: typeof error?.responseShape === "string" ? error.responseShape : null,
    }));
    process.exitCode = 1;
  });
}
