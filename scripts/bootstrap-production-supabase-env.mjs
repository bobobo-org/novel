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

export const PRODUCTION_RUNTIME_SUPABASE_KEYS = Object.freeze([
  "SUPABASE_PROJECT_REF",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

export const SUPABASE_SERVER_CREDENTIAL_KEYS = Object.freeze([
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_KEY",
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
  if (payload?.role === "service_role") return "service_role_jwt";
  return "";
}

export function isSupabaseManagementAccessToken(value) {
  return /^sbp_[A-Za-z0-9._-]{16,}$/u.test(String(value || "").trim());
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

function preferredServerCredential(environment = {}) {
  const values = SUPABASE_SERVER_CREDENTIAL_KEYS
    .map((key) => String(environment[key] || "").trim())
    .filter(Boolean);
  return values.find((value) => serviceRoleCredentialKind(value)) || values[0] || "";
}

export function collectEnvironmentServiceRoleCandidates(environments = {}) {
  return Object.entries(environments).flatMap(([environmentName, environment]) =>
    SUPABASE_SERVER_CREDENTIAL_KEYS.map((key) => ({
      source: `${environmentName}:${key}`,
      value: String(environment?.[key] || "").trim(),
    })),
  );
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
    preferredServerCredential(production),
    preferredServerCredential(source),
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

export function overrideSupabaseProjectIdentity(configuration, rawProjectRef) {
  const projectRef = String(rawProjectRef || "").trim();
  if (!/^[a-z0-9]{8,32}$/u.test(projectRef)) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_PROJECT_REF_OVERRIDE_INVALID"), {
      code: "SUPABASE_BOOTSTRAP_PROJECT_REF_OVERRIDE_INVALID",
    });
  }
  return {
    ...configuration,
    SUPABASE_PROJECT_REF: projectRef,
    NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
  };
}

export function validateRuntimeConfigurationShape(configuration) {
  const missingKeys = PRODUCTION_RUNTIME_SUPABASE_KEYS.filter((key) => !configuration[key]);
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
  if (!serviceRoleCredentialKind(configuration.SUPABASE_SERVICE_ROLE_KEY)) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_SERVICE_ROLE_INVALID"), {
      code: "SUPABASE_BOOTSTRAP_SERVICE_ROLE_INVALID",
    });
  }
  return { projectRef };
}

export function validateBootstrapConfigurationShape(configuration) {
  const missingKeys = PRODUCTION_RUNTIME_SUPABASE_KEYS.filter((key) => !configuration[key]);
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
  return { projectRef };
}

export function validateConfigurationShape(configuration) {
  const missingKeys = REQUIRED_SUPABASE_KEYS.filter((key) => !configuration[key]);
  if (missingKeys.length > 0) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_SOURCE_MISSING"), {
      code: "SUPABASE_BOOTSTRAP_SOURCE_MISSING",
      missingKeys,
    });
  }
  const result = validateRuntimeConfigurationShape(configuration);
  if (!isSupabaseManagementAccessToken(configuration.SUPABASE_ACCESS_TOKEN)) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_MANAGEMENT_TOKEN_INVALID"), {
      code: "SUPABASE_BOOTSTRAP_MANAGEMENT_TOKEN_INVALID",
    });
  }
  return result;
}

function runVercel(args, { input } = {}) {
  const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "vercel", ...args], {
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
  if (String(serviceRoleCredential).split(".").length === 3) {
    headers.authorization = `Bearer ${serviceRoleCredential}`;
  }
  return headers;
}

export async function selectServiceRoleCredential({
  url,
  candidates,
  fetcher = fetchWithTimeout,
}) {
  const normalizedUrl = String(url || "").replace(/\/$/u, "");
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const value = String(candidate?.value || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push({ source: String(candidate?.source || "unknown"), value });
  }

  const probes = [];
  for (const candidate of unique) {
    const kind = serviceRoleCredentialKind(candidate.value);
    if (!kind) {
      probes.push({
        source: candidate.source,
        kind: "invalid_shape",
        restHttpStatus: null,
        storageHttpStatus: null,
      });
      continue;
    }
    const headers = serviceRoleHeaders(candidate.value);
    let restHttpStatus = null;
    let storageHttpStatus = null;
    try {
      const restResponse = await fetcher(`${normalizedUrl}/rest/v1/`, { headers });
      restHttpStatus = restResponse.status;
      await restResponse.body?.cancel().catch(() => undefined);
      if (restResponse.ok) {
        const storageResponse = await fetcher(`${normalizedUrl}/storage/v1/bucket`, {
          headers: { ...headers, accept: "application/json" },
        });
        storageHttpStatus = storageResponse.status;
        await storageResponse.body?.cancel().catch(() => undefined);
        if (storageResponse.ok) {
          return {
            value: candidate.value,
            source: candidate.source,
            kind,
            restHttpStatus,
            storageHttpStatus,
            probes,
          };
        }
      }
    } catch {
      // The sanitized probe summary below is sufficient; credentials are never logged.
    }
    probes.push({
      source: candidate.source,
      kind,
      restHttpStatus,
      storageHttpStatus,
    });
  }

  throw Object.assign(new Error("SUPABASE_BOOTSTRAP_NO_VALID_SERVICE_ROLE_CREDENTIAL"), {
    code: "SUPABASE_BOOTSTRAP_NO_VALID_SERVICE_ROLE_CREDENTIAL",
    credentialProbes: probes,
  });
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

export async function discoverProjectApiKeyCandidates({
  accessToken,
  projectRef,
  fetcher = fetchWithTimeout,
}) {
  if (!accessToken) return { candidates: [], httpStatus: null };
  const response = await fetcher(
    `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  const body = await response.json().catch(() => null);
  const rows = Array.isArray(body) ? body : null;
  if (!response.ok || !rows) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_API_KEY_DISCOVERY_FAILED"), {
      code: "SUPABASE_BOOTSTRAP_API_KEY_DISCOVERY_FAILED",
      httpStatus: response.status,
      responseShape: Array.isArray(body) ? "array" : typeof body,
    });
  }
  const candidates = rows
    .map((row, index) => ({
      source: `management_api_${index + 1}`,
      value: String(row?.api_key || "").trim(),
    }))
    .filter((candidate) => serviceRoleCredentialKind(candidate.value));
  return { candidates, httpStatus: response.status };
}

async function verifySupabase(configuration, projectRef) {
  if (!serviceRoleCredentialKind(configuration.SUPABASE_SERVICE_ROLE_KEY)) {
    return {
      managementVerified: false,
      managementHttpStatus: null,
      serviceRoleVerified: false,
      serviceRoleVerification: "deferred_to_staged_runtime",
    };
  }
  const serviceRoleResponse = await fetchWithTimeout(
    `${configuration.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/u, "")}/rest/v1/`,
    { headers: serviceRoleHeaders(configuration.SUPABASE_SERVICE_ROLE_KEY) },
  );
  await serviceRoleResponse.body?.cancel().catch(() => undefined);
  if (!serviceRoleResponse.ok) {
    throw Object.assign(new Error("SUPABASE_BOOTSTRAP_SERVICE_ROLE_VERIFICATION_FAILED"), {
      code: "SUPABASE_BOOTSTRAP_SERVICE_ROLE_VERIFICATION_FAILED",
      httpStatus: serviceRoleResponse.status,
    });
  }

  if (!configuration.SUPABASE_ACCESS_TOKEN) {
    return {
      managementVerified: false,
      managementHttpStatus: null,
      serviceRoleVerified: true,
      serviceRoleVerification: "ci_readable_value",
    };
  }
  const managementResponse = await fetchWithTimeout(
    `https://api.supabase.com/v1/projects/${projectRef}`,
    { headers: { authorization: `Bearer ${configuration.SUPABASE_ACCESS_TOKEN}` } },
  );
  const project = await managementResponse.json().catch(() => null);
  if (managementResponse.ok && [project?.id, project?.ref].includes(projectRef)) {
    return {
      managementVerified: true,
      managementHttpStatus: managementResponse.status,
      serviceRoleVerified: true,
      serviceRoleVerification: "ci_readable_value",
    };
  }
  if ([401, 403].includes(managementResponse.status)) {
    return {
      managementVerified: false,
      managementHttpStatus: managementResponse.status,
      serviceRoleVerified: true,
      serviceRoleVerification: "ci_readable_value",
    };
  }
  throw Object.assign(new Error("SUPABASE_BOOTSTRAP_MANAGEMENT_VERIFICATION_FAILED"), {
    code: "SUPABASE_BOOTSTRAP_MANAGEMENT_VERIFICATION_FAILED",
    httpStatus: managementResponse.status,
  });
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
    const source = { ...development, ...preview };
    if (process.env.SUPABASE_ACCESS_TOKEN) {
      source.SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
    }
    if (process.env.SUPABASE_PROJECT_REF_FALLBACK) {
      source.SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF_FALLBACK;
    }
    let configuration = mergeProductionWithSource(production, source);
    let projectRef;
    let projectRefDiscovery = "configured";
    try {
      if (process.env.SUPABASE_PROJECT_REF_FALLBACK) {
        configuration = overrideSupabaseProjectIdentity(
          configuration,
          process.env.SUPABASE_PROJECT_REF_FALLBACK,
        );
        projectRefDiscovery = "repository_fallback_override";
      } else if (
        configuration.SUPABASE_PROJECT_REF
        && projectRefFromUrl(configuration.NEXT_PUBLIC_SUPABASE_URL)
          !== configuration.SUPABASE_PROJECT_REF
        && source.SUPABASE_PROJECT_REF === configuration.SUPABASE_PROJECT_REF
      ) {
        configuration.NEXT_PUBLIC_SUPABASE_URL = `https://${configuration.SUPABASE_PROJECT_REF}.supabase.co`;
        projectRefDiscovery = "repository_fallback";
      } else if (!configuration.SUPABASE_PROJECT_REF && configuration.SUPABASE_ACCESS_TOKEN) {
        const discovered = await discoverProjectRef(configuration);
        configuration.SUPABASE_PROJECT_REF = discovered.projectRef;
        projectRefDiscovery = discovered.method;
        if (projectRefFromUrl(configuration.NEXT_PUBLIC_SUPABASE_URL) !== discovered.projectRef) {
          configuration.NEXT_PUBLIC_SUPABASE_URL = `https://${discovered.projectRef}.supabase.co`;
        }
      }
      ({ projectRef } = validateBootstrapConfigurationShape(configuration));
    } catch (error) {
      error.availableSourceKeys = Object.keys(source)
        .filter((key) => /^(?:SUPABASE|DATABASE|POSTGRES)_/u.test(key))
        .sort();
      throw error;
    }
    const environments = { production, preview, development };
    const environmentCandidates = [
      ...collectEnvironmentServiceRoleCandidates(environments),
      {
        source: "github:SUPABASE_ACCESS_TOKEN",
        value: configuration.SUPABASE_ACCESS_TOKEN,
      },
    ];
    const availableSourceKeys = [...new Set(Object.values(environments)
      .flatMap((environment) => Object.keys(environment))
      .filter((key) => /^(?:SUPABASE|DATABASE|POSTGRES)_/u.test(key)))]
      .sort();
    let discoveredKeys = { candidates: [], httpStatus: null };
    let credential;
    try {
      credential = await selectServiceRoleCredential({
        url: configuration.NEXT_PUBLIC_SUPABASE_URL,
        candidates: environmentCandidates,
      });
    } catch (environmentError) {
      if (!isSupabaseManagementAccessToken(configuration.SUPABASE_ACCESS_TOKEN)) {
        environmentError.availableSourceKeys = availableSourceKeys;
        throw environmentError;
      }
      try {
        discoveredKeys = await discoverProjectApiKeyCandidates({
          accessToken: configuration.SUPABASE_ACCESS_TOKEN,
          projectRef,
        });
      } catch (discoveryError) {
        discoveryError.availableSourceKeys = availableSourceKeys;
        discoveryError.credentialProbes = environmentError.credentialProbes || [];
        throw discoveryError;
      }
      try {
        credential = await selectServiceRoleCredential({
          url: configuration.NEXT_PUBLIC_SUPABASE_URL,
          candidates: [...environmentCandidates, ...discoveredKeys.candidates],
        });
      } catch (selectionError) {
        selectionError.availableSourceKeys = availableSourceKeys;
        throw selectionError;
      }
    }
    configuration.SUPABASE_SERVICE_ROLE_KEY = credential.value;
    validateRuntimeConfigurationShape(configuration);
    const management = await verifySupabase(configuration, projectRef);

    const productionChanges = PRODUCTION_RUNTIME_SUPABASE_KEYS
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
    for (const key of PRODUCTION_RUNTIME_SUPABASE_KEYS) {
      assert.equal(verified[key], configuration[key], `${key}_PROMOTION_MISMATCH`);
    }
    console.log(JSON.stringify({
      status: productionChanges.length > 0
        ? "production_supabase_env_promoted"
        : "production_supabase_env_already_ready",
      promotedKeys: productionChanges,
      requiredRuntimeKeyCount: PRODUCTION_RUNTIME_SUPABASE_KEYS.length,
      projectRefSuffix: projectRef.slice(-4),
      projectRefDiscovery,
      managementVerified: management.managementVerified,
      managementHttpStatus: management.managementHttpStatus,
      serviceRoleVerified: management.serviceRoleVerified,
      serviceRoleVerification: management.serviceRoleVerification,
      serviceRoleSource: credential.source,
      serviceRoleKind: credential.kind,
      serviceRoleRestHttpStatus: credential.restHttpStatus,
      serviceRoleStorageHttpStatus: credential.storageHttpStatus,
      managementApiKeyDiscoveryHttpStatus: discoveredKeys.httpStatus,
      managementApiKeyCandidateCount: discoveredKeys.candidates.length,
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
      credentialProbes: Array.isArray(error?.credentialProbes)
        ? error.credentialProbes
        : [],
    }));
    process.exitCode = 1;
  });
}
