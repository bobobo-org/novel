import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { boundedFetch, boundedOperation } from "./bounded-fetch.mjs";

export const PRODUCTION_SUPABASE_KEYS = Object.freeze([
  "SUPABASE_PROJECT_REF",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

export const PRODUCTION_EXTERNAL_AI_KEYS = Object.freeze([
  "XAI_API_KEY",
  "XAI_MODEL_ID",
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function parseEnvFile(source) {
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

function isProjectRef(value) {
  return /^[a-z0-9]{8,32}$/u.test(String(value || ""));
}

function isServiceCredential(value) {
  const normalized = String(value || "").trim();
  if (/^sb_secret_[A-Za-z0-9._-]{16,}$/u.test(normalized)) return true;
  const parts = normalized.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role";
  } catch {
    return false;
  }
}

function serviceCredentialProjectRef(value) {
  const parts = String(value || "").trim().split(".");
  if (parts.length !== 3) return "";
  try {
    const projectRef = String(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.ref || "",
    );
    return /^[a-z0-9]{8,32}$/u.test(projectRef) ? projectRef : "";
  } catch {
    return "";
  }
}

function supabaseServiceHeaders(credential) {
  const headers = { Accept: "application/json", apikey: credential };
  if (String(credential).split(".").length === 3) {
    headers.Authorization = `Bearer ${credential}`;
  }
  return headers;
}

export async function verifySupabaseProductionCredential({
  production,
  expectedProjectRef,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  const credential = String(production?.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const embeddedProjectRef = serviceCredentialProjectRef(credential);
  const projectRefMatches = !embeddedProjectRef || embeddedProjectRef === expectedProjectRef;
  const result = {
    verified: false,
    indeterminate: false,
    readOnly: true,
    verificationMode: "direct-read-only-probe",
    projectRefMatches,
    restHttpStatus: null,
    storageHttpStatus: null,
    failureCode: null,
    secretValuesStored: false,
  };
  if (!isServiceCredential(credential)) {
    return { ...result, failureCode: "SUPABASE_SERVICE_CREDENTIAL_SHAPE_INVALID" };
  }
  if (!projectRefMatches) {
    return { ...result, failureCode: "SUPABASE_SERVICE_CREDENTIAL_PROJECT_MISMATCH" };
  }
  const origin = `https://${expectedProjectRef}.supabase.co`;
  const headers = supabaseServiceHeaders(credential);
  try {
    const restResponse = await boundedFetch(fetcher, `${origin}/rest/v1/`, {
      headers,
      cache: "no-store",
    }, {
      timeoutMs: fetchTimeoutMs,
      deadlineAt,
      timeoutCode: "SUPABASE_SERVICE_CREDENTIAL_REST_TIMEOUT",
    });
    result.restHttpStatus = restResponse.status;
    await restResponse.body?.cancel().catch(() => undefined);
    if (!restResponse.ok) {
      return { ...result, failureCode: "SUPABASE_SERVICE_CREDENTIAL_REST_REJECTED" };
    }
    const storageResponse = await boundedFetch(fetcher, `${origin}/storage/v1/bucket`, {
      headers,
      cache: "no-store",
    }, {
      timeoutMs: fetchTimeoutMs,
      deadlineAt,
      timeoutCode: "SUPABASE_SERVICE_CREDENTIAL_STORAGE_TIMEOUT",
    });
    result.storageHttpStatus = storageResponse.status;
    await storageResponse.body?.cancel().catch(() => undefined);
    if (!storageResponse.ok) {
      return { ...result, failureCode: "SUPABASE_SERVICE_CREDENTIAL_STORAGE_REJECTED" };
    }
    return { ...result, verified: true };
  } catch (error) {
    return {
      ...result,
      indeterminate: true,
      failureCode: String(error?.code || error?.message || "SUPABASE_SERVICE_CREDENTIAL_PROBE_FAILED"),
    };
  }
}

export async function readVercelProductionEnvironmentMetadata({
  token,
  teamId,
  projectId,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  const url = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env`);
  url.searchParams.set("target", "production");
  url.searchParams.set("teamId", teamId);
  const response = await boundedFetch(fetcher, url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  }, {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "PRODUCTION_AUDIT_ENV_METADATA_TIMEOUT",
  });
  const body = await boundedOperation(() => response.json(), {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "PRODUCTION_AUDIT_ENV_METADATA_BODY_TIMEOUT",
    onTimeout: () => response.body?.cancel().catch(() => undefined),
  }).catch(() => null);
  if (!response.ok || !Array.isArray(body?.envs)) {
    throw Object.assign(new Error("PRODUCTION_AUDIT_ENV_METADATA_LOOKUP_FAILED"), {
      code: "PRODUCTION_AUDIT_ENV_METADATA_LOOKUP_FAILED",
      httpStatus: response.status,
    });
  }
  const entries = {};
  for (const env of body.envs) {
    const key = String(env?.key || "");
    const targets = Array.isArray(env?.target) ? env.target.map(String) : [];
    if (!key || !targets.includes("production")) continue;
    const candidate = {
      key,
      type: String(env?.type || "unknown"),
      targets: [...new Set(targets)].sort(),
      updatedAt: Number.isFinite(Number(env?.updatedAt)) ? Number(env.updatedAt) : null,
      secretValuesStored: false,
    };
    if (!entries[key] || (candidate.updatedAt || 0) >= (entries[key].updatedAt || 0)) {
      entries[key] = candidate;
    }
  }
  return {
    verified: true,
    readOnly: true,
    entries,
    secretValuesStored: false,
  };
}

export async function readProductionCloudRuntimeTruth({
  aliases,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  try {
    const observations = await Promise.all(aliases.map(async (alias) => {
      const response = await boundedFetch(
        fetcher,
        `https://${alias}/api/persistence/sync/health?production-env-audit=${Date.now()}`,
        { cache: "no-store" },
        {
          timeoutMs: fetchTimeoutMs,
          deadlineAt,
          timeoutCode: "PRODUCTION_AUDIT_CLOUD_RUNTIME_TIMEOUT",
        },
      );
      const body = await boundedOperation(() => response.json(), {
        timeoutMs: fetchTimeoutMs,
        deadlineAt,
        timeoutCode: "PRODUCTION_AUDIT_CLOUD_RUNTIME_BODY_TIMEOUT",
        onTimeout: () => response.body?.cancel().catch(() => undefined),
      }).catch(() => null);
      return {
        alias,
        httpStatus: response.status,
        ready: response.ok
          && body?.status === "ready"
          && body?.migrationVersion === "cloud_sync_e2ee_storage_001"
          && body?.schemaVersion === "novel-cloud-sync-e2ee-v1"
          && body?.storageBackend === "private-object-storage"
          && body?.provider === "Supabase",
      };
    }));
    return {
      verified: observations.length > 0 && observations.every((entry) => entry.ready),
      indeterminate: false,
      readOnly: true,
      observations,
      secretValuesStored: false,
    };
  } catch (error) {
    return {
      verified: false,
      indeterminate: true,
      readOnly: true,
      observations: [],
      failureCode: String(error?.code || error?.message || "PRODUCTION_AUDIT_CLOUD_RUNTIME_FAILED"),
      secretValuesStored: false,
    };
  }
}

const DEFINITE_XAI_CREDENTIAL_FAILURES = new Set([
  "EXTERNAL_PROVIDER_AUTH_FAILED",
]);

const DEFINITE_XAI_MODEL_FAILURES = new Set([
  "EXTERNAL_PROVIDER_MODEL_UNAVAILABLE",
]);

function sanitizedXaiObservation({
  alias,
  httpStatus = null,
  configured = null,
  verification = null,
  verificationCode = null,
  modelId = null,
  topLevelVerification = null,
  state = "indeterminate",
  failureCode = null,
}) {
  return {
    alias,
    httpStatus,
    configured,
    verification,
    verificationCode,
    modelId,
    topLevelVerification,
    state,
    failureCode,
    secretValuesStored: false,
  };
}

function classifyXaiRuntimePayload({ alias, httpStatus, payload, expectedXaiModelId }) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  const grokProviders = providers.filter((provider) => provider?.id === "grok");
  const grok = grokProviders[0];
  const surfaceValid = payload?.status === "ready"
    && payload?.credentials === "server-side-only"
    && payload?.silentFallback === false
    && payload?.probePerformed === true
    && ["verified", "degraded"].includes(payload?.verification)
    && providers.length === 1
    && grokProviders.length === 1
    && grok?.serverSideCredentialOnly === true
    && grok?.dataLeavesDevice === true;
  if (!surfaceValid) {
    return sanitizedXaiObservation({
      alias,
      httpStatus,
      failureCode: "PRODUCTION_AUDIT_XAI_RUNTIME_SURFACE_INVALID",
    });
  }

  const common = {
    alias,
    httpStatus,
    configured: grok.configured === true,
    verification: String(grok.verification || ""),
    verificationCode: String(grok.verificationCode || ""),
    modelId: String(grok.modelId || ""),
    topLevelVerification: String(payload.verification || ""),
  };
  if (
    grok.configured === false
    && grok.verification === "not_configured"
    && grok.verificationCode === "NOT_CONFIGURED"
    && payload.verification === "degraded"
  ) {
    return sanitizedXaiObservation({ ...common, state: "credential_not_configured" });
  }
  if (grok.configured !== true) {
    return sanitizedXaiObservation({
      ...common,
      failureCode: "PRODUCTION_AUDIT_XAI_CONFIGURATION_TRUTH_INVALID",
    });
  }
  if (String(grok.modelId || "") !== expectedXaiModelId) {
    return sanitizedXaiObservation({ ...common, state: "model_invalid" });
  }
  if (
    grok.verification === "verified"
    && grok.verificationCode === "MODEL_ACCESS_VERIFIED"
    && payload.verification === "verified"
  ) {
    return sanitizedXaiObservation({ ...common, state: "verified" });
  }
  if (
    grok.verification === "failed"
    && payload.verification === "degraded"
    && DEFINITE_XAI_CREDENTIAL_FAILURES.has(grok.verificationCode)
  ) {
    return sanitizedXaiObservation({ ...common, state: "credential_revoked" });
  }
  if (
    grok.verification === "failed"
    && payload.verification === "degraded"
    && DEFINITE_XAI_MODEL_FAILURES.has(grok.verificationCode)
  ) {
    return sanitizedXaiObservation({ ...common, state: "model_invalid" });
  }
  return sanitizedXaiObservation({
    ...common,
    failureCode: "PRODUCTION_AUDIT_XAI_RUNTIME_TRUTH_INDETERMINATE",
  });
}

export function evaluateStagedExternalAiRuntimeTruth({
  payload,
  expectedXaiModelId = "grok-4.5",
  xaiExpected = true,
}) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  const openaiProviders = providers.filter((provider) => provider?.id === "openai");
  const grokProviders = providers.filter((provider) => provider?.id === "grok");
  const openai = openaiProviders[0];
  const grok = grokProviders[0];
  const commonSurfaceValid = payload?.status === "ready"
    && payload?.credentials === "server-side-only"
    && payload?.silentFallback === false
    && payload?.probePerformed === true
    && providers.length === 2
    && openaiProviders.length === 1
    && grokProviders.length === 1
    && providers.every((provider) => (
      provider?.serverSideCredentialOnly === true && provider?.dataLeavesDevice === true
    ));
  const grokVerified = grok?.configured === true
    && grok?.verification === "verified"
    && grok?.verificationCode === "MODEL_ACCESS_VERIFIED"
    && grok?.modelId === expectedXaiModelId;
  const grokNotConfigured = grok?.configured === false
    && grok?.verification === "not_configured"
    && grok?.verificationCode === "NOT_CONFIGURED";
  const openaiNotConfigured = openai?.configured === false
    && openai?.verification === "not_configured"
    && openai?.verificationCode === "NOT_CONFIGURED";
  const openaiVerified = openai?.configured === true
    && openai?.verification === "verified"
    && openai?.verificationCode === "MODEL_ACCESS_VERIFIED";
  const grokSafe = xaiExpected ? grokVerified : grokNotConfigured || grokVerified;
  const optionalProviderAbsent = openaiNotConfigured || (!xaiExpected && grokNotConfigured);
  const topLevelVerificationValid = optionalProviderAbsent
    ? payload?.verification === "degraded"
    : openaiVerified && grokVerified && payload?.verification === "verified";
  return {
    verified: Boolean(
      commonSurfaceValid
      && grokSafe
      && (openaiNotConfigured || openaiVerified)
      && topLevelVerificationValid
    ),
    xaiExpected: Boolean(xaiExpected),
    grokVerified: Boolean(grokVerified),
    grokState: grokNotConfigured
      ? "not_configured"
      : grokVerified
        ? "verified"
        : "failed",
    openaiState: openaiNotConfigured
      ? "not_configured"
      : openaiVerified
        ? "verified"
        : "failed",
    topLevelVerificationValid: Boolean(topLevelVerificationValid),
    secretValuesStored: false,
  };
}

export async function readProductionExternalAiRuntimeTruth({
  aliases,
  expectedXaiModelId = "grok-4.5",
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  const normalizedAliases = [...new Set((aliases || []).map((alias) => String(alias || "").trim()))]
    .filter(Boolean);
  if (normalizedAliases.length !== 2) {
    return {
      verified: false,
      indeterminate: true,
      readOnly: true,
      verificationMode: "dual-public-alias-read-only-probe",
      expectedModelId: expectedXaiModelId,
      state: "indeterminate",
      repairKeys: [],
      observations: [],
      failureCode: "PRODUCTION_AUDIT_XAI_DUAL_ALIAS_SET_INVALID",
      secretValuesStored: false,
    };
  }

  const observations = await Promise.all(normalizedAliases.map(async (alias) => {
    let response;
    try {
      response = await boundedFetch(
        fetcher,
        `https://${alias}/api/ai/external/providers?probe=1&providers=grok&production-env-audit=${Date.now()}`,
        { cache: "no-store" },
        {
          timeoutMs: fetchTimeoutMs,
          deadlineAt,
          timeoutCode: "PRODUCTION_AUDIT_XAI_RUNTIME_TIMEOUT",
        },
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return sanitizedXaiObservation({
          alias,
          httpStatus: response.status,
          failureCode: "PRODUCTION_AUDIT_XAI_RUNTIME_HTTP_REJECTED",
        });
      }
      const payload = await boundedOperation(() => response.json(), {
        timeoutMs: fetchTimeoutMs,
        deadlineAt,
        timeoutCode: "PRODUCTION_AUDIT_XAI_RUNTIME_BODY_TIMEOUT",
        onTimeout: () => response.body?.cancel().catch(() => undefined),
      });
      return classifyXaiRuntimePayload({
        alias,
        httpStatus: response.status,
        payload,
        expectedXaiModelId,
      });
    } catch (error) {
      return sanitizedXaiObservation({
        alias,
        httpStatus: Number.isInteger(response?.status) ? response.status : null,
        failureCode: String(error?.code || error?.message || "PRODUCTION_AUDIT_XAI_RUNTIME_FAILED"),
      });
    }
  }));

  const states = [...new Set(observations.map((observation) => observation.state))];
  const hasIndeterminateObservation = observations.some((observation) => (
    observation.state === "indeterminate" || observation.failureCode
  ));
  if (hasIndeterminateObservation || states.length !== 1) {
    return {
      verified: false,
      indeterminate: true,
      readOnly: true,
      verificationMode: "dual-public-alias-read-only-probe",
      expectedModelId: expectedXaiModelId,
      state: "indeterminate",
      repairKeys: [],
      observations,
      failureCode: hasIndeterminateObservation
        ? "PRODUCTION_AUDIT_XAI_RUNTIME_TRUTH_UNAVAILABLE"
        : "PRODUCTION_AUDIT_XAI_ALIAS_TRUTH_DISAGREEMENT",
      secretValuesStored: false,
    };
  }

  const state = states[0];
  const repairKeys = state === "credential_not_configured" || state === "credential_revoked"
    ? ["XAI_API_KEY"]
    : state === "model_invalid"
      ? ["XAI_MODEL_ID"]
      : [];
  return {
    verified: state === "verified",
    indeterminate: false,
    readOnly: true,
    verificationMode: "dual-public-alias-read-only-probe",
    expectedModelId: expectedXaiModelId,
    state,
    repairKeys,
    observations,
    failureCode: null,
    secretValuesStored: false,
  };
}

function isXaiKey(value) {
  const normalized = String(value || "").trim();
  return normalized.length >= 20 && !/\s/u.test(normalized);
}

export function auditProductionEnvironment({
  production = {},
  expectedProjectRef,
  expectedXaiModelId = "grok-4.5",
  githubXaiApiKey = "",
  projectIdentity,
  supabaseCredentialVerification,
  vercelEnvironmentMetadata,
  externalAiRuntimeTruth,
}) {
  assert.ok(isProjectRef(expectedProjectRef), "PRODUCTION_AUDIT_PROJECT_REF_INVALID");
  const expectedSupabaseUrl = `https://${expectedProjectRef}.supabase.co`;
  const githubKey = String(githubXaiApiKey || "").trim();
  const productionXaiKey = String(production.XAI_API_KEY || "").trim();
  const productionXaiModel = String(production.XAI_MODEL_ID || "").trim();
  const supabaseCredentialMetadata = vercelEnvironmentMetadata?.entries?.SUPABASE_SERVICE_ROLE_KEY;
  const xaiCredentialMetadata = vercelEnvironmentMetadata?.entries?.XAI_API_KEY;
  const supabaseCredentialMetadataSafe = ["encrypted", "sensitive"]
    .includes(supabaseCredentialMetadata?.type);
  const driftKeys = [];

  if (supabaseCredentialVerification?.indeterminate === true) {
    throw Object.assign(new Error("PRODUCTION_AUDIT_SUPABASE_TRUTH_UNAVAILABLE"), {
      code: "PRODUCTION_AUDIT_SUPABASE_TRUTH_UNAVAILABLE",
    });
  }
  if (
    externalAiRuntimeTruth?.indeterminate === true
    || (
      externalAiRuntimeTruth
      && externalAiRuntimeTruth.verified !== true
      && !Array.isArray(externalAiRuntimeTruth.repairKeys)
    )
  ) {
    throw Object.assign(new Error("PRODUCTION_AUDIT_XAI_TRUTH_UNAVAILABLE"), {
      code: "PRODUCTION_AUDIT_XAI_TRUTH_UNAVAILABLE",
      failureCode: externalAiRuntimeTruth?.failureCode || null,
    });
  }
  if (
    externalAiRuntimeTruth
    && externalAiRuntimeTruth.expectedModelId !== expectedXaiModelId
  ) {
    throw Object.assign(new Error("PRODUCTION_AUDIT_XAI_EXPECTED_MODEL_MISMATCH"), {
      code: "PRODUCTION_AUDIT_XAI_EXPECTED_MODEL_MISMATCH",
    });
  }

  if (production.SUPABASE_PROJECT_REF !== expectedProjectRef) {
    driftKeys.push("SUPABASE_PROJECT_REF");
  }
  if (production.NEXT_PUBLIC_SUPABASE_URL !== expectedSupabaseUrl) {
    driftKeys.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (
    (!isServiceCredential(production.SUPABASE_SERVICE_ROLE_KEY)
      && !supabaseCredentialMetadataSafe)
    || supabaseCredentialVerification?.verified !== true
    || supabaseCredentialVerification?.projectRefMatches !== true
    || !supabaseCredentialMetadataSafe
  ) {
    driftKeys.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  const externalAiExpected = Boolean(githubKey || productionXaiKey || xaiCredentialMetadata);
  if (
    githubKey
    && productionXaiKey !== githubKey
    && xaiCredentialMetadata?.type !== "sensitive"
  ) {
    driftKeys.push("XAI_API_KEY");
  }
  if (externalAiExpected && productionXaiModel !== expectedXaiModelId) {
    driftKeys.push("XAI_MODEL_ID");
  }
  if (!githubKey && productionXaiKey && !isXaiKey(productionXaiKey)) {
    driftKeys.push("XAI_API_KEY");
  }
  if (
    externalAiExpected
    && externalAiRuntimeTruth
    && !productionXaiKey
    && !xaiCredentialMetadata
  ) {
    driftKeys.push("XAI_API_KEY");
  }
  for (const key of externalAiExpected ? externalAiRuntimeTruth?.repairKeys || [] : []) {
    if (!PRODUCTION_EXTERNAL_AI_KEYS.includes(key)) {
      throw Object.assign(new Error("PRODUCTION_AUDIT_XAI_REPAIR_KEY_INVALID"), {
        code: "PRODUCTION_AUDIT_XAI_REPAIR_KEY_INVALID",
      });
    }
    driftKeys.push(key);
  }

  const uniqueDriftKeys = [...new Set(driftKeys)].sort();
  const truth = {
    projectIdentity: {
      verified: projectIdentity?.verified === true,
      projectIdMatches: projectIdentity?.projectIdMatches === true,
      teamIdMatches: projectIdentity?.teamIdMatches === true,
    },
    requiredVariables: Object.fromEntries([
      ...PRODUCTION_SUPABASE_KEYS,
      ...PRODUCTION_EXTERNAL_AI_KEYS,
    ].map((key) => [
      key,
      Boolean(String(production[key] || "").trim())
        || Boolean(vercelEnvironmentMetadata?.entries?.[key]),
    ])),
    supabase: {
      projectRefMatches: production.SUPABASE_PROJECT_REF === expectedProjectRef,
      urlMatches: production.NEXT_PUBLIC_SUPABASE_URL === expectedSupabaseUrl,
      serviceCredentialPresent: isServiceCredential(production.SUPABASE_SERVICE_ROLE_KEY),
      serviceCredentialMetadataPresent: Boolean(supabaseCredentialMetadata),
      serviceCredentialType: supabaseCredentialMetadata?.type || null,
      serviceCredentialVerified: supabaseCredentialVerification?.verified === true,
      serviceCredentialProjectMatches: supabaseCredentialVerification?.projectRefMatches === true,
      serviceCredentialVerificationReadOnly: supabaseCredentialVerification?.readOnly === true,
      serviceCredentialRestHttpStatus: Number.isInteger(supabaseCredentialVerification?.restHttpStatus)
        ? supabaseCredentialVerification.restHttpStatus
        : null,
      serviceCredentialStorageHttpStatus: Number.isInteger(supabaseCredentialVerification?.storageHttpStatus)
        ? supabaseCredentialVerification.storageHttpStatus
        : null,
      serviceCredentialFailureCode: supabaseCredentialVerification?.failureCode || null,
      serviceCredentialVerificationMode: supabaseCredentialVerification?.verificationMode || null,
    },
    externalAi: {
      configured: isXaiKey(productionXaiKey) || Boolean(xaiCredentialMetadata),
      credentialMetadataPresent: Boolean(xaiCredentialMetadata),
      credentialType: xaiCredentialMetadata?.type || null,
      expected: externalAiExpected,
      githubCredentialMatches: githubKey
        ? (xaiCredentialMetadata?.type === "sensitive" ? null : productionXaiKey === githubKey)
        : null,
      modelMatches: externalAiExpected
        ? productionXaiModel === expectedXaiModelId
        : productionXaiModel === "" || productionXaiModel === expectedXaiModelId,
      runtimeVerified: externalAiRuntimeTruth?.verified === true,
      runtimeIndeterminate: externalAiRuntimeTruth?.indeterminate === true,
      runtimeReadOnly: externalAiRuntimeTruth?.readOnly === true,
      runtimeVerificationMode: externalAiRuntimeTruth?.verificationMode || null,
      runtimeState: externalAiRuntimeTruth?.state || null,
      runtimeFailureCode: externalAiRuntimeTruth?.failureCode || null,
      runtimeRepairKeys: [...(externalAiRuntimeTruth?.repairKeys || [])],
      runtimeObservations: [...(externalAiRuntimeTruth?.observations || [])],
    },
    driftKeys: uniqueDriftKeys,
  };
  if (!truth.projectIdentity.verified) {
    throw Object.assign(new Error("PRODUCTION_AUDIT_PROJECT_IDENTITY_INVALID"), {
      code: "PRODUCTION_AUDIT_PROJECT_IDENTITY_INVALID",
    });
  }
  return {
    schemaVersion: "production-environment-audit-v1",
    status: uniqueDriftKeys.length === 0 ? "ready" : "repair_required",
    readOnly: true,
    mutationCount: 0,
    repairRequired: uniqueDriftKeys.length > 0,
    driftKeys: uniqueDriftKeys,
    truth,
    truthDigest: sha256(truth),
    secretValuesStored: false,
  };
}

export function createEnvironmentRepairReceipt({ before, after, actualChangedKeys }) {
  if (!before || !after) throw new Error("PRODUCTION_REPAIR_AUDIT_MISSING");
  if (!Array.isArray(actualChangedKeys)) {
    throw new Error("PRODUCTION_REPAIR_ACTUAL_MUTATIONS_MISSING");
  }
  if (after.repairRequired) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_INCOMPLETE"), {
      code: "PRODUCTION_REPAIR_INCOMPLETE",
      remainingKeys: after.driftKeys,
    });
  }
  const unexpectedMutationKeys = actualChangedKeys.filter((key) => !before.driftKeys.includes(key));
  if (unexpectedMutationKeys.length > 0) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_UNAUDITED_MUTATION"), {
      code: "PRODUCTION_REPAIR_UNAUDITED_MUTATION",
      unexpectedMutationKeys,
    });
  }
  const changedKeys = [...new Set(actualChangedKeys)].sort();
  const receiptCore = {
    schemaVersion: "production-environment-repair-receipt-v1",
    beforeDigest: before.truthDigest,
    afterDigest: after.truthDigest,
    changedKeys,
    changedKeysCount: changedKeys.length,
    mutationCount: actualChangedKeys.length,
    secretValuesStored: false,
  };
  return {
    ...receiptCore,
    environmentRepairReceipt: sha256(receiptCore),
  };
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`MISSING_ENVIRONMENT:${name}`);
  return value;
}

function runVercel(args) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, ["exec", "vercel", ...args], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    throw Object.assign(new Error("PRODUCTION_AUDIT_VERCEL_PULL_FAILED"), {
      code: "PRODUCTION_AUDIT_VERCEL_PULL_FAILED",
    });
  }
}

export async function readVercelProjectIdentity({
  token,
  teamId,
  projectId,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`);
  url.searchParams.set("teamId", teamId);
  const response = await boundedFetch(fetcher, url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  }, {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "PRODUCTION_AUDIT_PROJECT_LOOKUP_TIMEOUT",
  });
  const project = await boundedOperation(() => response.json(), {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "PRODUCTION_AUDIT_PROJECT_BODY_TIMEOUT",
    onTimeout: () => response.body?.cancel().catch(() => undefined),
  }).catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error("PRODUCTION_AUDIT_PROJECT_LOOKUP_FAILED"), {
      code: "PRODUCTION_AUDIT_PROJECT_LOOKUP_FAILED",
      httpStatus: response.status,
    });
  }
  const observedProjectId = project?.id ?? null;
  const observedTeamId = project?.accountId ?? project?.teamId ?? null;
  return {
    verified: observedProjectId === projectId && observedTeamId === teamId,
    projectIdMatches: observedProjectId === projectId,
    teamIdMatches: observedTeamId === teamId,
  };
}

async function performAudit({
  supabaseCredentialVerificationOverride,
  externalAiRuntimeTruthOverride,
} = {}) {
  const projectId = requiredEnvironment("VERCEL_PROJECT_ID");
  const teamId = requiredEnvironment("VERCEL_ORG_ID");
  const scope = requiredEnvironment("VERCEL_SCOPE");
  const token = requiredEnvironment("VERCEL_TOKEN");
  const expectedProjectRef = requiredEnvironment("SUPABASE_PROJECT_REF_FALLBACK");
  const directory = await mkdtemp(`${tmpdir()}/novel-production-env-audit-`);
  const productionFile = resolve(directory, ".env.production");
  try {
    runVercel([
      "env", "pull", productionFile,
      "--environment", "production",
      "--project", projectId,
      "--scope", scope,
      "--token", token,
      "--yes",
    ]);
    const production = await readFile(productionFile, "utf8").then(parseEnvFile);
    const deadlineAt = Date.now() + 30_000;
    const expectedXaiModelId = process.env.XAI_MODEL_ID || "grok-4.5";
    const [
      projectIdentity,
      vercelEnvironmentMetadata,
      productionCloudRuntimeTruth,
      externalAiRuntimeTruth,
    ] = await Promise.all([
      readVercelProjectIdentity({ token, teamId, projectId }),
      readVercelProductionEnvironmentMetadata({ token, teamId, projectId, deadlineAt }),
      readProductionCloudRuntimeTruth({
        aliases: [requiredEnvironment("PRIMARY_ALIAS"), requiredEnvironment("MIRROR_ALIAS")],
        deadlineAt,
      }),
      externalAiRuntimeTruthOverride
        ? Promise.resolve(externalAiRuntimeTruthOverride)
        : readProductionExternalAiRuntimeTruth({
          aliases: [requiredEnvironment("PRIMARY_ALIAS"), requiredEnvironment("MIRROR_ALIAS")],
          expectedXaiModelId,
          deadlineAt,
        }),
    ]);
    const serviceCredentialMetadata = vercelEnvironmentMetadata.entries.SUPABASE_SERVICE_ROLE_KEY;
    let supabaseCredentialVerification = supabaseCredentialVerificationOverride;
    if (!supabaseCredentialVerification && isServiceCredential(production.SUPABASE_SERVICE_ROLE_KEY) && serviceCredentialMetadata?.type !== "sensitive") {
      supabaseCredentialVerification = await verifySupabaseProductionCredential({
        production,
        expectedProjectRef,
        deadlineAt,
      });
    } else if (!supabaseCredentialVerification) {
      const nonSecretIdentityMatches = production.SUPABASE_PROJECT_REF === expectedProjectRef
        && production.NEXT_PUBLIC_SUPABASE_URL === `https://${expectedProjectRef}.supabase.co`;
      supabaseCredentialVerification = {
        verified: Boolean(serviceCredentialMetadata) && productionCloudRuntimeTruth.verified,
        indeterminate: productionCloudRuntimeTruth.indeterminate,
        readOnly: true,
        verificationMode: "vercel-metadata-plus-current-runtime",
        projectRefMatches: nonSecretIdentityMatches,
        restHttpStatus: null,
        storageHttpStatus: null,
        failureCode: productionCloudRuntimeTruth.failureCode || (
          productionCloudRuntimeTruth.verified ? null : "PRODUCTION_CLOUD_RUNTIME_NOT_READY"
        ),
        secretValuesStored: false,
      };
    }
    return auditProductionEnvironment({
      production,
      expectedProjectRef,
      expectedXaiModelId,
      githubXaiApiKey: process.env.XAI_API_KEY || "",
      projectIdentity,
      supabaseCredentialVerification,
      vercelEnvironmentMetadata,
      externalAiRuntimeTruth,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function appendOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
    "utf8",
  );
}

async function writeJsonIfRequested(environmentName, value) {
  const target = process.env[environmentName];
  if (!target) return;
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runAuditCli() {
  const audit = await performAudit();
  appendOutputs({
    repair_required: String(audit.repairRequired),
    mutation_count: "0",
    before_digest: audit.truthDigest,
  });
  await writeJsonIfRequested("PRODUCTION_ENV_AUDIT_PATH", audit);
  console.log(JSON.stringify(audit));
}

async function runRepairCli() {
  const before = await performAudit();
  if (!["true", "false"].includes(process.env.AUDIT_REPAIR_REQUIRED || "")) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_AUDIT_DECISION_MISSING"), {
      code: "PRODUCTION_REPAIR_AUDIT_DECISION_MISSING",
    });
  }
  const auditedRepairRequired = process.env.AUDIT_REPAIR_REQUIRED === "true";
  const auditedBeforeDigest = String(process.env.AUDIT_BEFORE_DIGEST || "");
  if (!/^[a-f0-9]{64}$/u.test(auditedBeforeDigest)) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_AUDIT_DIGEST_MISSING"), {
      code: "PRODUCTION_REPAIR_AUDIT_DIGEST_MISSING",
    });
  }
  if (auditedBeforeDigest !== before.truthDigest) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_AUDIT_DIGEST_CHANGED"), {
      code: "PRODUCTION_REPAIR_AUDIT_DIGEST_CHANGED",
    });
  }
  if (auditedRepairRequired !== before.repairRequired) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_AUDIT_DECISION_CHANGED"), {
      code: "PRODUCTION_REPAIR_AUDIT_DECISION_CHANGED",
    });
  }
  const actualChangedKeys = [];
  let supabaseCredentialVerificationOverride;
  let externalAiRuntimeTruthOverride;
  if (auditedRepairRequired && before.driftKeys.some((key) => PRODUCTION_SUPABASE_KEYS.includes(key))) {
    const { main: repairSupabase } = await import("./bootstrap-production-supabase-env.mjs");
    const result = await repairSupabase({
      allowedMutationKeys: before.driftKeys.filter((key) => PRODUCTION_SUPABASE_KEYS.includes(key)),
    });
    actualChangedKeys.push(...result.changedKeys);
    supabaseCredentialVerificationOverride = result.supabaseCredentialVerification;
  }
  if (auditedRepairRequired && before.driftKeys.some((key) => PRODUCTION_EXTERNAL_AI_KEYS.includes(key))) {
    if (!isXaiKey(process.env.XAI_API_KEY)) {
      throw Object.assign(new Error("PRODUCTION_REPAIR_XAI_GITHUB_SECRET_REQUIRED"), {
        code: "PRODUCTION_REPAIR_XAI_GITHUB_SECRET_REQUIRED",
      });
    }
    const { main: repairExternalAi } = await import("./bootstrap-production-external-ai-env.mjs");
    const result = await repairExternalAi({
      allowedMutationKeys: before.driftKeys.filter((key) => PRODUCTION_EXTERNAL_AI_KEYS.includes(key)),
    });
    actualChangedKeys.push(...result.changedKeys);
    if (
      result.credentialVerification?.verified !== true
      || result.credentialVerification?.modelId !== (process.env.XAI_MODEL_ID || "grok-4.5")
      || result.credentialVerification?.credentialSource !== "github_secret"
    ) {
      throw Object.assign(new Error("PRODUCTION_REPAIR_XAI_DIRECT_VERIFICATION_MISSING"), {
        code: "PRODUCTION_REPAIR_XAI_DIRECT_VERIFICATION_MISSING",
      });
    }
    externalAiRuntimeTruthOverride = {
      verified: true,
      indeterminate: false,
      readOnly: true,
      verificationMode: "github-secret-direct-read-only-probe-after-repair",
      expectedModelId: result.credentialVerification.modelId,
      state: "verified_pending_staged_deployment",
      repairKeys: [],
      observations: [],
      failureCode: null,
      pendingStagedDeploymentVerification: true,
      secretValuesStored: false,
    };
  }
  const after = auditedRepairRequired
    ? await performAudit({
      supabaseCredentialVerificationOverride,
      externalAiRuntimeTruthOverride,
    })
    : before;
  const receipt = createEnvironmentRepairReceipt({ before, after, actualChangedKeys });
  appendOutputs({
    mutation_count: String(receipt.mutationCount),
    before_digest: receipt.beforeDigest,
    after_digest: receipt.afterDigest,
  });
  await writeJsonIfRequested("PRODUCTION_ENV_REPAIR_RECEIPT_PATH", receipt);
  console.log(JSON.stringify(receipt));
}

async function main() {
  const mode = process.argv[2] || "audit";
  if (mode === "audit") return runAuditCli();
  if (mode === "repair") return runRepairCli();
  throw new Error(`UNKNOWN_PRODUCTION_ENV_GOVERNANCE_MODE:${mode}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "production_environment_governance_failed",
      errorCode: String(error?.code || error?.message || "PRODUCTION_ENVIRONMENT_GOVERNANCE_FAILED"),
      httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
      secretValuesStored: false,
    }));
    process.exitCode = 1;
  });
}
