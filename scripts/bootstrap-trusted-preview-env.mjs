import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { boundedFetch, boundedOperation } from "./bounded-fetch.mjs";
import {
  PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION,
} from "../local-ai/private-hub/public-lounge-attestation-producer.mjs";

export const TRUSTED_PREVIEW_BRANCH = "trusted-attestation-producer";
const PREVIEW_TARGET = "preview";
const PREVIEW_AUDIENCE = "novel-public-lounge:preview";
const SUPABASE_PROJECT_HOST = /^([a-z0-9]{8,32})\.supabase\.co$/u;
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/u;
const KEY_ID = /^[A-Za-z0-9._-]{1,120}$/u;
const SAFE_ENVIRONMENT_KEY = /^[A-Z_][A-Z0-9_]{0,255}$/u;
const SAFE_CHILD_SIGNALS = new Set([
  "SIGABRT", "SIGALRM", "SIGBREAK", "SIGBUS", "SIGCHLD", "SIGCONT", "SIGFPE",
  "SIGHUP", "SIGILL", "SIGINT", "SIGIO", "SIGIOT", "SIGKILL", "SIGPIPE",
  "SIGPOLL", "SIGPROF", "SIGPWR", "SIGQUIT", "SIGSEGV", "SIGSTKFLT", "SIGSTOP",
  "SIGSYS", "SIGTERM", "SIGTRAP", "SIGTSTP", "SIGTTIN", "SIGTTOU", "SIGURG",
  "SIGUSR1", "SIGUSR2", "SIGVTALRM", "SIGWINCH", "SIGXCPU", "SIGXFSZ",
]);
const EXPECTED_GIT_PROVIDER = "github";
const EXPECTED_GIT_ORGANIZATION = "bobobo-org";
const EXPECTED_GIT_REPOSITORY = "novel";
const EXPECTED_GITHUB_REPOSITORY = `${EXPECTED_GIT_ORGANIZATION}/${EXPECTED_GIT_REPOSITORY}`;
const EXPECTED_GITHUB_REF = `refs/heads/${TRUSTED_PREVIEW_BRANCH}`;
const VERCEL_ENVIRONMENT_TYPES = new Set([
  "plain",
  "encrypted",
  "secret",
  "sensitive",
  "system",
]);
const VERCEL_ENVIRONMENT_TARGETS = new Set(["development", "preview", "production"]);
const VERCEL_ENVIRONMENT_VISIBILITIES = new Set(["config", "secret"]);

export const VERCEL_SAFE_WRITE_FAILURE_CODES = Object.freeze([
  "VERCEL_AUTH_FORBIDDEN",
  "VERCEL_PROJECT_NOT_LINKED",
  "VERCEL_BRANCH_NOT_FOUND",
  "VERCEL_POLICY_REQUIRES_SENSITIVE",
  "VERCEL_ENV_TYPE_REJECTED",
  "VERCEL_INVALID_ARGUMENT",
  "VERCEL_API_ERROR",
  "VERCEL_UNKNOWN_SAFE_FAILURE",
]);

const TRUSTED_PREVIEW_DIAGNOSTIC_ERROR_CODES = Object.freeze([
  "TRUSTED_PREVIEW_DIAG_AUTH_REJECTED",
  "TRUSTED_PREVIEW_DIAG_ACCESS_FORBIDDEN",
  "TRUSTED_PREVIEW_DIAG_TEAM_NOT_FOUND_OR_INACCESSIBLE",
  "TRUSTED_PREVIEW_DIAG_PROJECT_NOT_FOUND_OR_INACCESSIBLE",
  "TRUSTED_PREVIEW_DIAG_ENVIRONMENT_METADATA_NOT_FOUND_OR_INACCESSIBLE",
  "TRUSTED_PREVIEW_DIAG_RATE_LIMITED",
  "TRUSTED_PREVIEW_DIAG_VERCEL_UNAVAILABLE",
  "TRUSTED_PREVIEW_DIAG_TIMEOUT",
  "TRUSTED_PREVIEW_DIAG_NETWORK_UNAVAILABLE",
  "TRUSTED_PREVIEW_DIAG_REQUEST_REJECTED",
  "TRUSTED_PREVIEW_DIAG_RESPONSE_INVALID",
  "TRUSTED_PREVIEW_DIAG_METADATA_INVALID",
  "TRUSTED_PREVIEW_DIAG_INTERNAL",
]);

const SOURCE_ENV_NAMES = Object.freeze([
  "PREVIEW_SUPABASE_URL",
  "PREVIEW_SUPABASE_ANON_KEY",
  "PREVIEW_SUPABASE_SERVICE_ROLE_KEY",
  "PREVIEW_PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY",
  "PREVIEW_PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY",
  "PREVIEW_PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY",
  "PREVIEW_PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID",
]);

export const TRUSTED_PREVIEW_ENVIRONMENT_SPEC = Object.freeze([
  Object.freeze({
    key: "PUBLIC_LOUNGE_INTERACTIONS_ENABLED",
    type: "encrypted",
    value: "0",
  }),
  Object.freeze({
    key: "NEXT_PUBLIC_SUPABASE_URL",
    source: "PREVIEW_SUPABASE_URL",
    type: "encrypted",
  }),
  Object.freeze({
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    source: "PREVIEW_SUPABASE_ANON_KEY",
    type: "encrypted",
  }),
  Object.freeze({
    key: "SUPABASE_SERVICE_ROLE_KEY",
    source: "PREVIEW_SUPABASE_SERVICE_ROLE_KEY",
    type: "sensitive",
  }),
  Object.freeze({
    key: "PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY",
    source: "PREVIEW_PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY",
    type: "sensitive",
  }),
  Object.freeze({
    key: "PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY",
    source: "PREVIEW_PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY",
    type: "sensitive",
  }),
  Object.freeze({
    key: "PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY",
    source: "PREVIEW_PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY",
    type: "encrypted",
  }),
  Object.freeze({
    key: "PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID",
    source: "PREVIEW_PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID",
    type: "encrypted",
  }),
  Object.freeze({
    key: "PUBLIC_LOUNGE_ATTESTATION_ENVIRONMENT",
    type: "encrypted",
    value: "preview",
  }),
  Object.freeze({
    key: "PUBLIC_LOUNGE_ATTESTATION_AUDIENCE",
    type: "encrypted",
    value: PREVIEW_AUDIENCE,
  }),
  Object.freeze({
    key: "PUBLIC_LOUNGE_ATTESTATION_PRODUCER_VERSION",
    type: "encrypted",
    value: PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION,
  }),
]);

class TrustedPreviewEnvironmentError extends Error {
  constructor(code, safeDetails = null) {
    super(code);
    this.name = "TrustedPreviewEnvironmentError";
    this.code = code;
    this.safeDetails = safeDetails;
  }
}

function fail(code, safeDetails = null) {
  throw new TrustedPreviewEnvironmentError(code, safeDetails);
}

function requiredString(value, code) {
  const normalized = String(value ?? "").trim();
  if (!normalized) fail(code);
  return normalized;
}

function canonicalBase64Url32(value, code) {
  const normalized = requiredString(value, code);
  if (!BASE64URL_32_BYTES.test(normalized)) fail(code);
  let decoded;
  try {
    decoded = Buffer.from(normalized, "base64url");
  } catch {
    fail(code);
  }
  if (decoded.length !== 32 || decoded.toString("base64url") !== normalized) fail(code);
  return normalized;
}

function supabaseProjectRef(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail("TRUSTED_PREVIEW_SUPABASE_URL_INVALID");
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) fail("TRUSTED_PREVIEW_SUPABASE_URL_INVALID");
  const match = SUPABASE_PROJECT_HOST.exec(url.hostname);
  if (!match) fail("TRUSTED_PREVIEW_SUPABASE_URL_INVALID");
  return match[1];
}

function assertEd25519PublicKey(pem) {
  if (/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/u.test(pem)) {
    fail("TRUSTED_PREVIEW_ATTESTATION_PUBLIC_KEY_INVALID");
  }
  let key;
  try {
    key = crypto.createPublicKey(pem);
  } catch {
    fail("TRUSTED_PREVIEW_ATTESTATION_PUBLIC_KEY_INVALID");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    fail("TRUSTED_PREVIEW_ATTESTATION_PUBLIC_KEY_NOT_ED25519");
  }
}

function isServiceRoleCredential(value) {
  const normalized = String(value ?? "").trim();
  if (/^sb_secret_[A-Za-z0-9._-]{16,}$/u.test(normalized)) return true;
  const parts = normalized.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role";
  } catch {
    return false;
  }
}

export function trustedPreviewConfigurationFromEnvironment(environment = process.env) {
  const values = Object.fromEntries(TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map((entry) => [
    entry.key,
    entry.source ? requiredString(
      environment[entry.source],
      `TRUSTED_PREVIEW_SOURCE_${entry.source}_MISSING`,
    ) : entry.value,
  ]));
  const url = values.NEXT_PUBLIC_SUPABASE_URL;
  const projectRef = supabaseProjectRef(url);
  if (values.NEXT_PUBLIC_SUPABASE_ANON_KEY.length < 16) {
    fail("TRUSTED_PREVIEW_SUPABASE_ANON_KEY_INVALID");
  }
  if (!isServiceRoleCredential(values.SUPABASE_SERVICE_ROLE_KEY)) {
    fail("TRUSTED_PREVIEW_SUPABASE_SERVICE_ROLE_KEY_INVALID");
  }
  if (values.SUPABASE_SERVICE_ROLE_KEY === values.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    fail("TRUSTED_PREVIEW_SUPABASE_CREDENTIAL_ROLES_COLLIDE");
  }
  values.PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY = canonicalBase64Url32(
    values.PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY,
    "TRUSTED_PREVIEW_IDEMPOTENCY_KEY_INVALID",
  );
  values.PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY = canonicalBase64Url32(
    values.PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY,
    "TRUSTED_PREVIEW_RATE_IDENTITY_KEY_INVALID",
  );
  if (
    values.PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY
    === values.PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY
  ) fail("TRUSTED_PREVIEW_RUNTIME_KEYS_NOT_DISTINCT");
  assertEd25519PublicKey(values.PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY);
  if (!KEY_ID.test(values.PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID)) {
    fail("TRUSTED_PREVIEW_ATTESTATION_KEY_ID_INVALID");
  }
  return Object.freeze({ projectRef, values: Object.freeze(values) });
}

function normalizedTargets(target) {
  return [...new Set(
    (Array.isArray(target) ? target : typeof target === "string" ? [target] : [])
      .map(String)
      .map((value) => value.trim())
      .filter(Boolean),
  )].sort();
}

function safeDiagnosticDetails(stage, httpStatus = null, retryable = false) {
  const safeStages = new Set(["team", "project", "environment-metadata"]);
  return Object.freeze({
    stage: safeStages.has(stage) ? stage : "environment-metadata",
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
      ? httpStatus
      : null,
    retryable: retryable === true,
  });
}

function diagnosticHttpErrorCode(status, stage) {
  if (status === 401) return "TRUSTED_PREVIEW_DIAG_AUTH_REJECTED";
  if (status === 403) return "TRUSTED_PREVIEW_DIAG_ACCESS_FORBIDDEN";
  if (status === 404) {
    if (stage === "team") return "TRUSTED_PREVIEW_DIAG_TEAM_NOT_FOUND_OR_INACCESSIBLE";
    if (stage === "project") return "TRUSTED_PREVIEW_DIAG_PROJECT_NOT_FOUND_OR_INACCESSIBLE";
    return "TRUSTED_PREVIEW_DIAG_ENVIRONMENT_METADATA_NOT_FOUND_OR_INACCESSIBLE";
  }
  if (status === 429) return "TRUSTED_PREVIEW_DIAG_RATE_LIMITED";
  if (status >= 500 && status <= 599) return "TRUSTED_PREVIEW_DIAG_VERCEL_UNAVAILABLE";
  return "TRUSTED_PREVIEW_DIAG_REQUEST_REJECTED";
}

async function readVercelJsonWithoutErrorBody({
  url,
  token,
  stage,
  fetcher,
  fetchTimeoutMs,
  deadlineAt,
}) {
  let response;
  try {
    response = await boundedFetch(fetcher, url, {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
    }, {
      timeoutMs: fetchTimeoutMs,
      deadlineAt,
      timeoutCode: "TRUSTED_PREVIEW_DIAG_TIMEOUT",
    });
  } catch (error) {
    if (error?.code === "TRUSTED_PREVIEW_DIAG_TIMEOUT") {
      fail(
        "TRUSTED_PREVIEW_DIAG_TIMEOUT",
        safeDiagnosticDetails(stage, null, true),
      );
    }
    fail(
      "TRUSTED_PREVIEW_DIAG_NETWORK_UNAVAILABLE",
      safeDiagnosticDetails(stage, null, true),
    );
  }
  if (!response?.ok) {
    const status = Number.isInteger(response?.status) ? response.status : null;
    await response?.body?.cancel?.().catch(() => undefined);
    const code = diagnosticHttpErrorCode(status, stage);
    fail(code, safeDiagnosticDetails(
      stage,
      status,
      code === "TRUSTED_PREVIEW_DIAG_RATE_LIMITED"
        || code === "TRUSTED_PREVIEW_DIAG_VERCEL_UNAVAILABLE",
    ));
  }
  try {
    return await boundedOperation(() => response.json(), {
      timeoutMs: fetchTimeoutMs,
      deadlineAt,
      timeoutCode: "TRUSTED_PREVIEW_DIAG_TIMEOUT",
      onTimeout: () => response.body?.cancel().catch(() => undefined),
    });
  } catch (error) {
    if (error?.code === "TRUSTED_PREVIEW_DIAG_TIMEOUT") {
      fail(
        "TRUSTED_PREVIEW_DIAG_TIMEOUT",
        safeDiagnosticDetails(stage, null, true),
      );
    }
    fail(
      "TRUSTED_PREVIEW_DIAG_RESPONSE_INVALID",
      safeDiagnosticDetails(stage),
    );
  }
}

export async function readTrustedPreviewTeamMetadata({
  token,
  teamId,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  const url = new URL(`https://api.vercel.com/v2/teams/${encodeURIComponent(teamId)}`);
  const body = await readVercelJsonWithoutErrorBody({
    url,
    token,
    stage: "team",
    fetcher,
    fetchTimeoutMs,
    deadlineAt,
  });
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("TRUSTED_PREVIEW_DIAG_RESPONSE_INVALID", safeDiagnosticDetails("team"));
  }
  return Object.freeze({
    readable: true,
    teamIdMatches: String(body.id ?? "") === teamId,
  });
}

export async function readTrustedPreviewProjectMetadata({
  token,
  teamId,
  projectId,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`);
  url.searchParams.set("teamId", teamId);
  const body = await readVercelJsonWithoutErrorBody({
    url,
    token,
    stage: "project",
    fetcher,
    fetchTimeoutMs,
    deadlineAt,
  });
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("TRUSTED_PREVIEW_DIAG_RESPONSE_INVALID", safeDiagnosticDetails("project"));
  }
  const link = body.link && typeof body.link === "object" && !Array.isArray(body.link)
    ? body.link
    : null;
  const provider = String(link?.type ?? "").trim().toLowerCase();
  const organization = String(link?.org ?? "").trim().toLowerCase();
  const repository = String(link?.repo ?? "").trim().toLowerCase();
  const normalizedProductionBranch = String(link?.productionBranch ?? "").trim() || "main";
  return Object.freeze({
    readable: true,
    projectIdMatches: String(body.id ?? "") === projectId
      || String(body.name ?? "") === projectId,
    teamIdMatches: String(body.accountId ?? "") === teamId,
    gitRepositoryLinked: Boolean(link),
    gitProvider: provider === EXPECTED_GIT_PROVIDER ? EXPECTED_GIT_PROVIDER : provider ? "other" : "none",
    repositoryMatchesExpected: Boolean(
      link
      && provider === EXPECTED_GIT_PROVIDER
      && organization === EXPECTED_GIT_ORGANIZATION
      && repository === EXPECTED_GIT_REPOSITORY
    ),
    productionBranchIsMain: normalizedProductionBranch === "main",
  });
}

function safeDiagnosticEnvironmentRecord(entry) {
  const rawKey = String(entry?.key ?? "").trim();
  const rawType = String(entry?.type ?? "").trim().toLowerCase();
  const rawVisibility = String(entry?.visibility ?? "").trim().toLowerCase();
  const rawTargets = normalizedTargets(entry?.target);
  const gitBranch = String(entry?.gitBranch ?? "").trim();
  const customEnvironmentTargetCount = Array.isArray(entry?.customEnvironmentIds)
    ? entry.customEnvironmentIds.length
    : entry?.customEnvironmentIds == null ? 0 : 1;
  const legacyType = VERCEL_ENVIRONMENT_TYPES.has(rawType) ? rawType : "unknown";
  const visibility = VERCEL_ENVIRONMENT_VISIBILITIES.has(rawVisibility)
    ? rawVisibility
    : "legacy-or-unknown";
  const effectiveProtection = visibility === "secret"
    ? "secret"
    : visibility === "config"
      ? "config"
      : legacyType === "sensitive" || legacyType === "secret"
        ? "secret"
        : ["plain", "encrypted", "system"].includes(legacyType)
          ? "config"
          : "unknown";
  return Object.freeze({
    key: SAFE_ENVIRONMENT_KEY.test(rawKey) ? rawKey : "UNSAFE_NAME_REDACTED",
    keySafe: SAFE_ENVIRONMENT_KEY.test(rawKey),
    type: legacyType,
    visibility,
    effectiveProtection,
    targets: rawTargets.map((target) => (
      VERCEL_ENVIRONMENT_TARGETS.has(target) ? target : "other"
    )),
    customEnvironmentTargetCount,
    branchScope: gitBranch === TRUSTED_PREVIEW_BRANCH
      ? "expected"
      : gitBranch
        ? "other"
        : "unscoped",
  });
}

export async function readTrustedPreviewEnvironmentDiagnosticMetadata({
  token,
  teamId,
  projectId,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env`);
  url.searchParams.set("decrypt", "false");
  url.searchParams.set("teamId", teamId);
  const body = await readVercelJsonWithoutErrorBody({
    url,
    token,
    stage: "environment-metadata",
    fetcher,
    fetchTimeoutMs,
    deadlineAt,
  });
  if (!body || typeof body !== "object" || !Array.isArray(body.envs)) {
    fail(
      "TRUSTED_PREVIEW_DIAG_RESPONSE_INVALID",
      safeDiagnosticDetails("environment-metadata"),
    );
  }
  return Object.freeze({
    records: Object.freeze(body.envs.map(safeDiagnosticEnvironmentRecord)),
    decryptedValuesRequested: false,
    environmentValuePropertiesAccessed: false,
    environmentValuesEmitted: false,
    environmentValuesPersisted: false,
  });
}

export async function readTrustedPreviewEnvironmentMetadata({
  token,
  teamId,
  projectId,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env`);
  url.searchParams.set("target", PREVIEW_TARGET);
  url.searchParams.set("gitBranch", TRUSTED_PREVIEW_BRANCH);
  url.searchParams.set("decrypt", "false");
  url.searchParams.set("teamId", teamId);
  const response = await boundedFetch(fetcher, url, {
    method: "GET",
    redirect: "error",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  }, {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "TRUSTED_PREVIEW_METADATA_TIMEOUT",
  });
  const body = await boundedOperation(() => response.json(), {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "TRUSTED_PREVIEW_METADATA_BODY_TIMEOUT",
    onTimeout: () => response.body?.cancel().catch(() => undefined),
  }).catch(() => null);
  if (!response.ok || !Array.isArray(body?.envs)) {
    fail("TRUSTED_PREVIEW_METADATA_LOOKUP_FAILED");
  }
  const records = body.envs.map((entry) => Object.freeze({
    idPresent: Boolean(String(entry?.id ?? "").trim()),
    key: String(entry?.key ?? ""),
    type: String(entry?.type ?? "unknown"),
    targets: normalizedTargets(entry?.target),
    gitBranch: String(entry?.gitBranch ?? "").trim(),
    customEnvironmentIdCount: Array.isArray(entry?.customEnvironmentIds)
      ? entry.customEnvironmentIds.length
      : entry?.customEnvironmentIds == null ? 0 : 1,
    system: Boolean(entry?.system),
    configurationLinked: Boolean(String(entry?.configurationId ?? "").trim()),
    edgeConfigLinked: Boolean(
      String(entry?.edgeConfigId ?? "").trim()
      || String(entry?.edgeConfigTokenId ?? "").trim()
    ),
    sunsetSecretLinked: Boolean(String(entry?.sunsetSecretId ?? "").trim()),
    vsmValuePresent: entry?.vsmValue != null,
    createdByIntegration: /integration/iu.test(String(entry?.createdBy?.type ?? "")),
    secretValuesStored: false,
  }));
  return Object.freeze({ verified: true, records, secretValuesStored: false });
}

function safeBranchRecord(record, spec) {
  return Boolean(
    record?.idPresent
    && record.key === spec.key
    && record.type === spec.type
    && record.targets.length === 1
    && record.targets[0] === PREVIEW_TARGET
    && record.gitBranch === TRUSTED_PREVIEW_BRANCH
    && record.customEnvironmentIdCount === 0
    && record.system === false
    && record.configurationLinked === false
    && record.edgeConfigLinked === false
    && record.sunsetSecretLinked === false
    && record.vsmValuePresent === false
    && record.createdByIntegration === false
    && record.secretValuesStored === false
  );
}

export function verifyTrustedPreviewEnvironmentMetadata(metadata) {
  if (!metadata?.verified || metadata.secretValuesStored !== false || !Array.isArray(metadata.records)) {
    fail("TRUSTED_PREVIEW_METADATA_INVALID");
  }
  for (const spec of TRUSTED_PREVIEW_ENVIRONMENT_SPEC) {
    const branchRecords = metadata.records.filter((record) => (
      record?.key === spec.key && record?.gitBranch === TRUSTED_PREVIEW_BRANCH
    ));
    if (branchRecords.length !== 1) fail("TRUSTED_PREVIEW_METADATA_CARDINALITY_INVALID");
    if (!safeBranchRecord(branchRecords[0], spec)) fail("TRUSTED_PREVIEW_METADATA_SCOPE_OR_TYPE_INVALID");
  }
  return Object.freeze({
    status: "trusted_preview_environment_metadata_verified",
    target: PREVIEW_TARGET,
    gitBranch: TRUSTED_PREVIEW_BRANCH,
    recordCount: TRUSTED_PREVIEW_ENVIRONMENT_SPEC.length,
    sensitiveRecordCount: TRUSTED_PREVIEW_ENVIRONMENT_SPEC.filter((entry) => entry.type === "sensitive").length,
    secretValuesStored: false,
  });
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function expectedProtectionForSpec(spec) {
  return spec.type === "sensitive" ? "secret" : "config";
}

function recordMatchesExpectedProtection(record, spec) {
  return record.effectiveProtection === expectedProtectionForSpec(spec);
}

export function analyzeTrustedPreviewEnvironmentMetadata(metadata) {
  if (
    !metadata
    || !Array.isArray(metadata.records)
    || metadata.decryptedValuesRequested !== false
    || metadata.environmentValuePropertiesAccessed !== false
    || metadata.environmentValuesEmitted !== false
    || metadata.environmentValuesPersisted !== false
  ) fail("TRUSTED_PREVIEW_DIAG_METADATA_INVALID");

  const records = metadata.records;
  const expectedKeys = new Set(TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map(({ key }) => key));
  const missingExpectedKeys = [];
  const duplicateExpectedKeys = [];
  const typeDriftExpectedKeys = [];
  const targetDriftExpectedKeys = [];
  const wrongBranchExpectedKeys = [];
  const unscopedExpectedKeys = [];
  let matchingRecordCount = 0;
  let presentExpectedKeyCount = 0;

  for (const spec of TRUSTED_PREVIEW_ENVIRONMENT_SPEC) {
    const recordsForKey = records.filter((record) => record.keySafe && record.key === spec.key);
    const expectedBranchRecords = recordsForKey.filter((record) => record.branchScope === "expected");
    const otherBranchRecords = recordsForKey.filter((record) => record.branchScope === "other");
    const unscopedRecords = recordsForKey.filter((record) => record.branchScope === "unscoped");
    if (expectedBranchRecords.length === 0) missingExpectedKeys.push(spec.key);
    else presentExpectedKeyCount += 1;
    if (expectedBranchRecords.length > 1) duplicateExpectedKeys.push(spec.key);
    if (otherBranchRecords.length > 0) {
      wrongBranchExpectedKeys.push(spec.key);
    }
    if (unscopedRecords.length > 0) {
      unscopedExpectedKeys.push(spec.key);
    }
    if (expectedBranchRecords.some((record) => !recordMatchesExpectedProtection(record, spec))) {
      typeDriftExpectedKeys.push(spec.key);
    }
    if (expectedBranchRecords.some((record) => (
      record.targets.length !== 1
      || record.targets[0] !== PREVIEW_TARGET
      || record.customEnvironmentTargetCount !== 0
    ))) targetDriftExpectedKeys.push(spec.key);
    matchingRecordCount += expectedBranchRecords.filter((record) => (
      recordMatchesExpectedProtection(record, spec)
      && record.targets.length === 1
      && record.targets[0] === PREVIEW_TARGET
      && record.customEnvironmentTargetCount === 0
    )).length;
  }

  const branchScopedEnvironmentVariables = records
    .filter((record) => record.branchScope === "expected")
    .map((record) => Object.freeze({
      name: record.key,
      type: record.type,
      visibility: record.visibility,
      effectiveProtection: record.effectiveProtection,
      targets: Object.freeze([...record.targets]),
      customEnvironmentTargetCount: record.customEnvironmentTargetCount,
    }))
    .sort((left, right) => (
      left.name.localeCompare(right.name)
      || left.type.localeCompare(right.type)
      || left.visibility.localeCompare(right.visibility)
      || left.targets.join(",").localeCompare(right.targets.join(","))
    ));
  const unsafeNameCount = records.filter((record) => !record.keySafe).length;
  const unexpectedBranchScopedRecordCount = records.filter((record) => (
    record.branchScope === "expected" && (!record.keySafe || !expectedKeys.has(record.key))
  )).length;
  const driftDetected = Boolean(
    duplicateExpectedKeys.length
    || typeDriftExpectedKeys.length
    || targetDriftExpectedKeys.length
    || wrongBranchExpectedKeys.length
    || unscopedExpectedKeys.length
    || unexpectedBranchScopedRecordCount
    || unsafeNameCount
  );
  const completeExpectedSet = presentExpectedKeyCount === TRUSTED_PREVIEW_ENVIRONMENT_SPEC.length;
  const partialWriteDetected = presentExpectedKeyCount > 0 && !completeExpectedSet;
  const state = driftDetected
    ? "drift"
    : partialWriteDetected
      ? "partial"
      : completeExpectedSet
        ? "complete"
        : "empty";

  return Object.freeze({
    state,
    expectedRecordCount: TRUSTED_PREVIEW_ENVIRONMENT_SPEC.length,
    presentExpectedKeyCount,
    matchingRecordCount,
    branchScopedRecordCount: branchScopedEnvironmentVariables.length,
    branchScopedEnvironmentVariables: Object.freeze(branchScopedEnvironmentVariables),
    missingExpectedKeys: Object.freeze(sortedUnique(missingExpectedKeys)),
    duplicateExpectedKeys: Object.freeze(sortedUnique(duplicateExpectedKeys)),
    typeDriftExpectedKeys: Object.freeze(sortedUnique(typeDriftExpectedKeys)),
    targetDriftExpectedKeys: Object.freeze(sortedUnique(targetDriftExpectedKeys)),
    wrongBranchExpectedKeys: Object.freeze(sortedUnique(wrongBranchExpectedKeys)),
    unscopedExpectedKeys: Object.freeze(sortedUnique(unscopedExpectedKeys)),
    unexpectedBranchScopedRecordCount,
    unsafeNameCount,
    vercelBranchScopedMetadataObserved: branchScopedEnvironmentVariables.length > 0,
    vercelPreviewBranchScopedMetadataObserved: records.some((record) => (
      record.branchScope === "expected" && record.targets.includes(PREVIEW_TARGET)
    )),
    completeExpectedSet,
    partialWriteDetected,
    duplicateRecordsDetected: duplicateExpectedKeys.length > 0,
    typeDriftDetected: typeDriftExpectedKeys.length > 0,
    branchDriftDetected: wrongBranchExpectedKeys.length > 0 || unscopedExpectedKeys.length > 0,
    decryptedValuesRequested: false,
    environmentValuePropertiesAccessed: false,
    environmentValuesEmitted: false,
    environmentValuesPersisted: false,
  });
}

function vercelCommandEnvironment(token) {
  const environment = { ...process.env };
  for (const name of SOURCE_ENV_NAMES) delete environment[name];
  environment.VERCEL_TOKEN = token;
  return environment;
}

export function vercelEnvironmentAddArguments({ spec, projectId, scope }) {
  return [
    "exec", "vercel", "env", "add", spec.key, PREVIEW_TARGET, TRUSTED_PREVIEW_BRANCH,
    "--project", projectId,
    "--scope", scope,
    "--force",
    spec.type === "sensitive" ? "--sensitive" : "--no-sensitive",
    "--yes",
  ];
}

export function classifyVercelWriteFailure(result) {
  const diagnosticText = [
    result?.stdout,
    result?.stderr,
    result?.error?.message,
    result?.error?.code,
  ].map((value) => String(value ?? "")).join("\n").slice(0, 4 * 1024 * 1024);
  const rules = [
    ["VERCEL_PROJECT_NOT_LINKED", /(?:project|directory).{0,80}(?:not|isn't|is not).{0,30}link|no linked project/iu],
    ["VERCEL_BRANCH_NOT_FOUND", /(?:git\s+)?branch.{0,80}(?:not found|does not exist|unknown|invalid)/iu],
    ["VERCEL_POLICY_REQUIRES_SENSITIVE", /(?:must|requires?|required).{0,50}sensitive|sensitive.{0,50}(?:must|required)/iu],
    ["VERCEL_ENV_TYPE_REJECTED", /(?:environment|env).{0,40}(?:type|visibility).{0,40}(?:invalid|unsupported|rejected)|(?:invalid|unsupported).{0,40}(?:environment|env).{0,20}type/iu],
    ["VERCEL_INVALID_ARGUMENT", /invalid argument|unknown (?:argument|option)|unexpected argument|bad request/iu],
    ["VERCEL_AUTH_FORBIDDEN", /\b(?:401|403)\b|unauthenticated|unauthorized|forbidden|not authorized|access denied|invalid token/iu],
    ["VERCEL_API_ERROR", /\b(?:429|5\d\d)\b|vercel.{0,30}api.{0,30}(?:error|failed)|request.{0,30}(?:timed out|timeout)|network.{0,30}(?:error|failed)/iu],
  ];
  return rules.find(([, pattern]) => pattern.test(diagnosticText))?.[0]
    ?? "VERCEL_UNKNOWN_SAFE_FAILURE";
}

function safeChildStatus(status) {
  return Number.isInteger(status) ? status : null;
}

function safeChildSignal(signal) {
  const normalized = String(signal ?? "").trim().toUpperCase();
  return SAFE_CHILD_SIGNALS.has(normalized) ? normalized : null;
}

export function safeVercelWriteFailureDetails({ spec, result }) {
  const variableIndex = TRUSTED_PREVIEW_ENVIRONMENT_SPEC.findIndex(({ key }) => key === spec?.key);
  return Object.freeze({
    variableName: variableIndex >= 0
      ? TRUSTED_PREVIEW_ENVIRONMENT_SPEC[variableIndex].key
      : "UNKNOWN_ENVIRONMENT_VARIABLE",
    variableIndex: variableIndex >= 0 ? variableIndex + 1 : null,
    variableCount: TRUSTED_PREVIEW_ENVIRONMENT_SPEC.length,
    childStatus: safeChildStatus(result?.status),
    childSignal: safeChildSignal(result?.signal),
    errorCode: classifyVercelWriteFailure(result),
  });
}

export function writeTrustedPreviewEnvironmentValue({ spec, value, projectId, scope, token }) {
  const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", [
    ...vercelEnvironmentAddArguments({ spec, projectId, scope, token }),
  ], {
    encoding: "utf8",
    env: vercelCommandEnvironment(token),
    input: `${value}\n`,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    const safeDetails = safeVercelWriteFailureDetails({ spec, result });
    fail(safeDetails.errorCode, safeDetails);
  }
}

function trustedPreviewAuth(environment = process.env) {
  return Object.freeze({
    projectId: requiredString(environment.VERCEL_PROJECT_ID, "TRUSTED_PREVIEW_VERCEL_PROJECT_ID_MISSING"),
    scope: requiredString(environment.VERCEL_SCOPE, "TRUSTED_PREVIEW_VERCEL_SCOPE_MISSING"),
    teamId: requiredString(environment.VERCEL_ORG_ID, "TRUSTED_PREVIEW_VERCEL_ORG_ID_MISSING"),
    token: requiredString(environment.VERCEL_TOKEN, "TRUSTED_PREVIEW_VERCEL_TOKEN_MISSING"),
  });
}

function trustedPreviewReadAuth(environment = process.env) {
  return Object.freeze({
    projectId: requiredString(
      environment.VERCEL_PROJECT_ID,
      "TRUSTED_PREVIEW_VERCEL_PROJECT_ID_MISSING",
    ),
    teamId: requiredString(
      environment.VERCEL_ORG_ID,
      "TRUSTED_PREVIEW_VERCEL_ORG_ID_MISSING",
    ),
    token: requiredString(
      environment.VERCEL_TOKEN,
      "TRUSTED_PREVIEW_VERCEL_TOKEN_MISSING",
    ),
  });
}

export async function bootstrapTrustedPreviewEnvironment(options, dependencies = {}) {
  const configuration = options.configuration ?? trustedPreviewConfigurationFromEnvironment(options.environment);
  const auth = options.auth ?? trustedPreviewAuth(options.environment);
  const deps = {
    writeValue: writeTrustedPreviewEnvironmentValue,
    readMetadata: readTrustedPreviewEnvironmentMetadata,
    delay: (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
    ...dependencies,
  };
  let mutationCount = 0;
  for (const spec of TRUSTED_PREVIEW_ENVIRONMENT_SPEC) {
    await deps.writeValue({
      spec,
      value: configuration.values[spec.key],
      projectId: auth.projectId,
      scope: auth.scope,
      token: auth.token,
    });
    mutationCount += 1;
  }
  let verified;
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      verified = verifyTrustedPreviewEnvironmentMetadata(await deps.readMetadata({
        token: auth.token,
        teamId: auth.teamId,
        projectId: auth.projectId,
      }));
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await deps.delay(1_000);
    }
  }
  if (!verified) throw lastError ?? new TrustedPreviewEnvironmentError("TRUSTED_PREVIEW_METADATA_UNVERIFIED");
  return Object.freeze({
    status: "trusted_preview_environment_bootstrapped",
    target: PREVIEW_TARGET,
    gitBranch: TRUSTED_PREVIEW_BRANCH,
    projectRef: configuration.projectRef,
    mutationCount,
    metadataVerified: true,
    interactionsEnabled: false,
    secretValuesStored: false,
  });
}

export async function auditTrustedPreviewEnvironment(options, dependencies = {}) {
  const configuration = options.configuration ?? trustedPreviewConfigurationFromEnvironment(options.environment);
  const auth = options.auth ?? trustedPreviewAuth(options.environment);
  const readMetadata = dependencies.readMetadata ?? readTrustedPreviewEnvironmentMetadata;
  const verified = verifyTrustedPreviewEnvironmentMetadata(await readMetadata({
    token: auth.token,
    teamId: auth.teamId,
    projectId: auth.projectId,
  }));
  return Object.freeze({
    ...verified,
    projectRef: configuration.projectRef,
    mutationCount: 0,
    sourceConfigurationValidated: true,
  });
}

export async function diagnoseTrustedPreviewEnvironment(options = {}, dependencies = {}) {
  const environment = options.environment ?? process.env;
  const auth = options.auth ?? trustedPreviewReadAuth(environment);
  const deadlineAt = Number.isFinite(options.deadlineAt)
    ? options.deadlineAt
    : Date.now() + 30_000;
  const fetchTimeoutMs = Number.isFinite(options.fetchTimeoutMs)
    ? options.fetchTimeoutMs
    : 10_000;
  const readTeam = dependencies.readTeam ?? readTrustedPreviewTeamMetadata;
  const readProject = dependencies.readProject ?? readTrustedPreviewProjectMetadata;
  const readMetadata = dependencies.readMetadata
    ?? readTrustedPreviewEnvironmentDiagnosticMetadata;
  const readOptions = {
    token: auth.token,
    teamId: auth.teamId,
    projectId: auth.projectId,
    fetcher: dependencies.fetcher ?? fetch,
    fetchTimeoutMs,
    deadlineAt,
  };
  const team = await readTeam(readOptions);
  const project = await readProject(readOptions);
  const metadata = analyzeTrustedPreviewEnvironmentMetadata(await readMetadata(readOptions));
  const githubRepositoryMatches = String(environment.GITHUB_REPOSITORY ?? "").trim().toLowerCase()
    === EXPECTED_GITHUB_REPOSITORY;
  const githubRefMatches = String(environment.GITHUB_REF ?? "").trim()
    === EXPECTED_GITHUB_REF;
  const repositoryLinkageValid = Boolean(
    team?.readable
    && team.teamIdMatches
    && project?.readable
    && project.projectIdMatches
    && project.teamIdMatches
    && project.gitRepositoryLinked
    && project.gitProvider === EXPECTED_GIT_PROVIDER
    && project.repositoryMatchesExpected
  );
  const branchTargetEligibleByReadOnlyEvidence = Boolean(
    repositoryLinkageValid
    && project?.productionBranchIsMain
    && githubRepositoryMatches
    && githubRefMatches
  );
  const vercelBranchScopedMetadataObserved = metadata.vercelBranchScopedMetadataObserved === true;
  const vercelPreviewBranchScopedMetadataObserved =
    metadata.vercelPreviewBranchScopedMetadataObserved === true;
  const branchTargetValid = branchTargetEligibleByReadOnlyEvidence
    && vercelPreviewBranchScopedMetadataObserved;
  const status = !branchTargetEligibleByReadOnlyEvidence
    ? "linkage-drift"
    : metadata.state;
  return Object.freeze({
    schemaVersion: "trusted-preview-environment-diagnosis-v2",
    mode: "diagnose-only",
    status,
    readOnly: true,
    mutationCount: 0,
    requestCount: 3,
    requestMethods: Object.freeze(["GET"]),
    scope: Object.freeze({
      target: PREVIEW_TARGET,
      gitBranch: TRUSTED_PREVIEW_BRANCH,
    }),
    tokenReadAccess: Boolean(team?.readable && project?.readable),
    team: Object.freeze({
      readable: team?.readable === true,
      teamIdMatches: team?.teamIdMatches === true,
    }),
    project: Object.freeze({
      readable: project?.readable === true,
      projectIdMatches: project?.projectIdMatches === true,
      teamIdMatches: project?.teamIdMatches === true,
      gitRepositoryLinked: project?.gitRepositoryLinked === true,
      gitProvider: project?.gitProvider === EXPECTED_GIT_PROVIDER ? EXPECTED_GIT_PROVIDER : "other-or-none",
      repositoryMatchesExpected: project?.repositoryMatchesExpected === true,
      productionBranchIsMain: project?.productionBranchIsMain === true,
    }),
    branchTarget: Object.freeze({
      githubRepositoryMatches,
      githubRefMatches,
      eligibleByReadOnlyEvidence: branchTargetEligibleByReadOnlyEvidence,
      vercelBranchScopedMetadataObserved,
      vercelPreviewBranchScopedMetadataObserved,
      vercelBranchExistenceDirectlyVerified: false,
      verificationBasis: "protected-workflow-ref-plus-vercel-repository-linkage",
      valid: branchTargetValid,
    }),
    metadata,
    sourceConfigurationRead: false,
    supabaseAccessed: false,
    previewSourceSecretsRead: false,
    decryptedValuesRequested: false,
    environmentValuePropertiesAccessed: false,
    remoteValuesEmitted: false,
    remoteValuesPersisted: false,
  });
}

function fixtureEnvironment() {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const servicePayload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  return {
    VERCEL_PROJECT_ID: "prj_fixture",
    VERCEL_SCOPE: "team-fixture",
    VERCEL_ORG_ID: "team_fixture",
    VERCEL_TOKEN: "vercel_fixture_token",
    PREVIEW_SUPABASE_URL: "https://previewref000000001.supabase.co",
    PREVIEW_SUPABASE_ANON_KEY: "fixture-preview-anon-key",
    PREVIEW_SUPABASE_SERVICE_ROLE_KEY: `header.${servicePayload}.signature`,
    PREVIEW_PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY: Buffer.alloc(32, 0x31).toString("base64url"),
    PREVIEW_PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY: Buffer.alloc(32, 0x32).toString("base64url"),
    PREVIEW_PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY:
      publicKey.export({ type: "spki", format: "pem" }).toString(),
    PREVIEW_PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID: "novel-pl-preview-self-test",
  };
}

function metadataFixture() {
  return {
    verified: true,
    secretValuesStored: false,
    records: TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map((spec, index) => ({
      idPresent: true,
      key: spec.key,
      type: spec.type,
      targets: [PREVIEW_TARGET],
      gitBranch: TRUSTED_PREVIEW_BRANCH,
      customEnvironmentIdCount: 0,
      system: false,
      configurationLinked: false,
      edgeConfigLinked: false,
      sunsetSecretLinked: false,
      vsmValuePresent: false,
      createdByIntegration: false,
      secretValuesStored: false,
      fixtureIndex: index,
    })),
  };
}

export async function runSelfTest() {
  const environment = fixtureEnvironment();
  const configuration = trustedPreviewConfigurationFromEnvironment(environment);
  const auth = trustedPreviewAuth(environment);
  const events = [];
  const result = await bootstrapTrustedPreviewEnvironment({ configuration, auth }, {
    writeValue: async ({ spec, value, ...writeAuth }) => {
      events.push({ key: spec.key, type: spec.type, value, ...writeAuth });
    },
    readMetadata: async () => metadataFixture(),
    delay: async () => undefined,
  });
  assert.equal(result.mutationCount, TRUSTED_PREVIEW_ENVIRONMENT_SPEC.length);
  assert.equal(events[0].key, "PUBLIC_LOUNGE_INTERACTIONS_ENABLED");
  assert.equal(events[0].value, "0");
  assert.deepEqual(events.map((event) => event.key), TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map((spec) => spec.key));
  const sensitiveValues = SOURCE_ENV_NAMES.map((name) => environment[name]);
  assert.ok(sensitiveValues.every((value) => !JSON.stringify(result).includes(value)));
  for (const spec of TRUSTED_PREVIEW_ENVIRONMENT_SPEC) {
    const args = vercelEnvironmentAddArguments({ spec, ...auth });
    if (spec.source) assert.equal(args.includes(configuration.values[spec.key]), false);
    assert.equal(args.includes(auth.token), false);
    assert.deepEqual(args.slice(2, 7), ["env", "add", spec.key, PREVIEW_TARGET, TRUSTED_PREVIEW_BRANCH]);
    assert.ok(args.includes(spec.type === "sensitive" ? "--sensitive" : "--no-sensitive"));
    assert.equal(args.includes("--prod"), false);
  }
  const audit = await auditTrustedPreviewEnvironment({ configuration, auth }, {
    readMetadata: async () => metadataFixture(),
  });
  assert.equal(audit.mutationCount, 0);

  const duplicate = metadataFixture();
  duplicate.records.push({ ...duplicate.records[0] });
  assert.throws(
    () => verifyTrustedPreviewEnvironmentMetadata(duplicate),
    (error) => error?.code === "TRUSTED_PREVIEW_METADATA_CARDINALITY_INVALID",
  );
  const wrongBranch = metadataFixture();
  wrongBranch.records[0] = { ...wrongBranch.records[0], gitBranch: "main" };
  assert.throws(
    () => verifyTrustedPreviewEnvironmentMetadata(wrongBranch),
    (error) => error?.code === "TRUSTED_PREVIEW_METADATA_CARDINALITY_INVALID",
  );
  const wrongType = metadataFixture();
  const sensitiveIndex = TRUSTED_PREVIEW_ENVIRONMENT_SPEC.findIndex((spec) => spec.type === "sensitive");
  wrongType.records[sensitiveIndex] = { ...wrongType.records[sensitiveIndex], type: "encrypted" };
  assert.throws(
    () => verifyTrustedPreviewEnvironmentMetadata(wrongType),
    (error) => error?.code === "TRUSTED_PREVIEW_METADATA_SCOPE_OR_TYPE_INVALID",
  );
  assert.throws(
    () => trustedPreviewConfigurationFromEnvironment({
      ...environment,
      PREVIEW_PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY:
        environment.PREVIEW_PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY,
    }),
    (error) => error?.code === "TRUSTED_PREVIEW_RUNTIME_KEYS_NOT_DISTINCT",
  );
  return Object.freeze({
    status: "trusted_preview_environment_bootstrap_self_test_passed",
    target: PREVIEW_TARGET,
    gitBranch: TRUSTED_PREVIEW_BRANCH,
    environmentRecordCount: TRUSTED_PREVIEW_ENVIRONMENT_SPEC.length,
    sensitiveValuesInArguments: false,
    mutationCountDuringAudit: audit.mutationCount,
    secretValuesStored: false,
  });
}

function safeResult(result) {
  return {
    status: result.status,
    target: result.target,
    gitBranch: result.gitBranch,
    mutationCount: result.mutationCount,
    metadataVerified: result.metadataVerified ?? true,
    interactionsEnabled: result.interactionsEnabled ?? false,
    secretValuesStored: false,
  };
}

const SAFE_OPERATION_ERROR_CODES = new Set([
  "TRUSTED_PREVIEW_BOOTSTRAP_ARGUMENT_INVALID",
  "TRUSTED_PREVIEW_ENVIRONMENT_OPERATION_FAILED",
  "TRUSTED_PREVIEW_METADATA_BODY_TIMEOUT",
  "TRUSTED_PREVIEW_METADATA_CARDINALITY_INVALID",
  "TRUSTED_PREVIEW_METADATA_INVALID",
  "TRUSTED_PREVIEW_METADATA_LOOKUP_FAILED",
  "TRUSTED_PREVIEW_METADATA_SCOPE_OR_TYPE_INVALID",
  "TRUSTED_PREVIEW_METADATA_TIMEOUT",
  "TRUSTED_PREVIEW_METADATA_UNVERIFIED",
  "TRUSTED_PREVIEW_SUPABASE_URL_INVALID",
  "TRUSTED_PREVIEW_SUPABASE_ANON_KEY_INVALID",
  "TRUSTED_PREVIEW_SUPABASE_SERVICE_ROLE_KEY_INVALID",
  "TRUSTED_PREVIEW_SUPABASE_CREDENTIAL_ROLES_COLLIDE",
  "TRUSTED_PREVIEW_IDEMPOTENCY_KEY_INVALID",
  "TRUSTED_PREVIEW_RATE_IDENTITY_KEY_INVALID",
  "TRUSTED_PREVIEW_RUNTIME_KEYS_NOT_DISTINCT",
  "TRUSTED_PREVIEW_ATTESTATION_PUBLIC_KEY_INVALID",
  "TRUSTED_PREVIEW_ATTESTATION_PUBLIC_KEY_NOT_ED25519",
  "TRUSTED_PREVIEW_ATTESTATION_KEY_ID_INVALID",
  "TRUSTED_PREVIEW_VERCEL_PROJECT_ID_MISSING",
  "TRUSTED_PREVIEW_VERCEL_SCOPE_MISSING",
  "TRUSTED_PREVIEW_VERCEL_ORG_ID_MISSING",
  "TRUSTED_PREVIEW_VERCEL_TOKEN_MISSING",
  ...SOURCE_ENV_NAMES.map((name) => `TRUSTED_PREVIEW_SOURCE_${name}_MISSING`),
  ...TRUSTED_PREVIEW_DIAGNOSTIC_ERROR_CODES,
  ...VERCEL_SAFE_WRITE_FAILURE_CODES,
]);

function validatedSafeWriteFailureDetails(details) {
  if (!details || typeof details !== "object") return null;
  const expectedIndex = TRUSTED_PREVIEW_ENVIRONMENT_SPEC.findIndex(
    ({ key }) => key === details.variableName,
  );
  if (
    expectedIndex < 0
    || details.variableIndex !== expectedIndex + 1
    || details.variableCount !== TRUSTED_PREVIEW_ENVIRONMENT_SPEC.length
    || !VERCEL_SAFE_WRITE_FAILURE_CODES.includes(details.errorCode)
  ) return null;
  return Object.freeze({
    variableName: TRUSTED_PREVIEW_ENVIRONMENT_SPEC[expectedIndex].key,
    variableIndex: expectedIndex + 1,
    variableCount: TRUSTED_PREVIEW_ENVIRONMENT_SPEC.length,
    childStatus: safeChildStatus(details.childStatus),
    childSignal: safeChildSignal(details.childSignal),
    errorCode: details.errorCode,
  });
}

export function safeOperationFailure(error) {
  const candidateCode = String(error?.code ?? "");
  const errorCode = SAFE_OPERATION_ERROR_CODES.has(candidateCode)
    ? candidateCode
    : "TRUSTED_PREVIEW_ENVIRONMENT_OPERATION_FAILED";
  const result = {
    schemaVersion: "trusted-preview-environment-operation-failure-v1",
    status: "trusted_preview_environment_operation_failed",
    errorCode,
    secretValuesStored: false,
    rawOutputIncluded: false,
  };
  if (VERCEL_SAFE_WRITE_FAILURE_CODES.includes(errorCode)) {
    const writeFailure = validatedSafeWriteFailureDetails(error?.safeDetails);
    if (writeFailure) result.writeFailure = writeFailure;
  } else if (TRUSTED_PREVIEW_DIAGNOSTIC_ERROR_CODES.includes(errorCode)) {
    result.mode = "diagnose-only";
    result.readOnly = true;
    result.mutationCount = 0;
    result.diagnosticFailure = safeDiagnosticDetails(
      error?.safeDetails?.stage,
      error?.safeDetails?.httpStatus,
      error?.safeDetails?.retryable,
    );
  }
  return Object.freeze(result);
}

export async function main(arguments_ = process.argv.slice(2)) {
  if (arguments_.length !== 1) fail("TRUSTED_PREVIEW_BOOTSTRAP_ARGUMENT_INVALID");
  if (arguments_[0] === "--self-test") {
    const result = await runSelfTest();
    console.log(JSON.stringify(result));
    return result;
  }
  if (arguments_[0] === "--verify-only") {
    const result = await auditTrustedPreviewEnvironment({ environment: process.env });
    console.log(JSON.stringify(safeResult(result)));
    return result;
  }
  if (arguments_[0] === "--diagnose-only") {
    const result = await diagnoseTrustedPreviewEnvironment({ environment: process.env });
    console.log(JSON.stringify(result));
    if (result.status !== "complete") process.exitCode = 1;
    return result;
  }
  if (arguments_[0] !== "--required") fail("TRUSTED_PREVIEW_BOOTSTRAP_ARGUMENT_INVALID");
  const result = await bootstrapTrustedPreviewEnvironment({ environment: process.env });
  console.log(JSON.stringify(safeResult(result)));
  return result;
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify(safeOperationFailure(error)));
    process.exitCode = 1;
  });
}
