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

export const PRODUCTION_XAI_KEYS = Object.freeze([
  "XAI_API_KEY",
  "XAI_MODEL_ID",
]);

export const PRODUCTION_OPTIONAL_OPENAI_KEYS = Object.freeze([
  "OPENAI_API_KEY",
]);

export const PRODUCTION_EXTERNAL_AI_KEYS = Object.freeze([
  ...PRODUCTION_XAI_KEYS,
  ...PRODUCTION_OPTIONAL_OPENAI_KEYS,
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
  const normalizeTargets = (target) => [...new Set(
    (Array.isArray(target) ? target : typeof target === "string" ? [target] : [])
      .map(String)
      .map((value) => value.trim())
      .filter(Boolean),
  )].sort();
  const records = [];
  const entries = {};
  for (const env of body.envs) {
    const key = String(env?.key || "");
    const targets = normalizeTargets(env?.target);
    if (!key || !targets.includes("production")) continue;
    const controlMarkers = Object.keys(env || {})
      .filter((field) => /(?:integration|managed|shared)/iu.test(field))
      .filter((field) => {
        const value = env[field];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
      })
      .sort();
    const recordCore = {
      id: String(env?.id || ""),
      key,
      type: String(env?.type || "unknown"),
      targets,
      updatedAt: Number.isFinite(Number(env?.updatedAt)) ? Number(env.updatedAt) : null,
      gitBranchScoped: Boolean(String(env?.gitBranch || "").trim()),
      customEnvironmentIdCount: Array.isArray(env?.customEnvironmentIds)
        ? env.customEnvironmentIds.length
        : env?.customEnvironmentIds == null
          ? 0
          : 1,
      system: Boolean(env?.system),
      configurationLinked: Boolean(String(env?.configurationId || "").trim()),
      edgeConfigLinked: Boolean(
        String(env?.edgeConfigId || "").trim()
        || String(env?.edgeConfigTokenId || "").trim()
      ),
      sunsetSecretLinked: Boolean(String(env?.sunsetSecretId || "").trim()),
      vsmValuePresent: env?.vsmValue != null,
      contentHintPresent: env?.contentHint != null,
      internalContentHintPresent: env?.internalContentHint != null,
      createdByIntegration: /integration/iu.test(String(env?.createdBy?.type || "")),
      controlMarkers,
      secretValuesStored: false,
    };
    const candidate = {
      ...recordCore,
      recordFingerprint: sha256(recordCore),
    };
    records.push(candidate);
    if (!entries[key] || (candidate.updatedAt || 0) >= (entries[key].updatedAt || 0)) {
      entries[key] = candidate;
    }
  }
  return {
    verified: true,
    readOnly: true,
    entries,
    records,
    secretValuesStored: false,
  };
}

function optionalOpenAiProductionRecords(metadata) {
  return (metadata?.records || [])
    .filter((record) => record?.key === "OPENAI_API_KEY")
    .filter((record) => record?.targets?.includes("production"));
}

function isExclusiveUnmanagedProductionRecord(record) {
  return Boolean(
    String(record?.id || "").trim()
    && ["encrypted", "sensitive"].includes(record?.type)
    && Number.isFinite(record?.updatedAt)
    && record.updatedAt > 0
    && Array.isArray(record?.targets)
    && record.targets.length === 1
    && record.targets[0] === "production"
    && record.gitBranchScoped === false
    && record.customEnvironmentIdCount === 0
    && record.system === false
    && record.configurationLinked === false
    && record.edgeConfigLinked === false
    && record.sunsetSecretLinked === false
    && record.vsmValuePresent === false
    && record.contentHintPresent === false
    && record.internalContentHintPresent === false
    && record.createdByIntegration === false
    && Array.isArray(record.controlMarkers)
    && record.controlMarkers.length === 0
    && /^[a-f0-9]{64}$/u.test(String(record.recordFingerprint || ""))
  );
}

function exactRemovableOpenAiProductionRecord(metadata) {
  const records = optionalOpenAiProductionRecords(metadata);
  return records.length === 1 && isExclusiveUnmanagedProductionRecord(records[0])
    ? records[0]
    : null;
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
  openaiConfigured = null,
  openaiVerification = null,
  openaiVerificationCode = null,
  openaiModelId = null,
  openaiState = "indeterminate",
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
    openaiConfigured,
    openaiVerification,
    openaiVerificationCode,
    openaiModelId,
    openaiState,
    failureCode,
    secretValuesStored: false,
  };
}

function classifyXaiRuntimePayload({ alias, httpStatus, payload, expectedXaiModelId }) {
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  const grokProviders = providers.filter((provider) => provider?.id === "grok");
  const openaiProviders = providers.filter((provider) => provider?.id === "openai");
  const grok = grokProviders[0];
  const openai = openaiProviders[0];
  const surfaceValid = payload?.status === "ready"
    && payload?.credentials === "server-side-only"
    && payload?.silentFallback === false
    && payload?.probePerformed === true
    && ["verified", "degraded"].includes(payload?.verification)
    && providers.length === 2
    && grokProviders.length === 1
    && openaiProviders.length === 1
    && providers.every((provider) => (
      provider?.serverSideCredentialOnly === true && provider?.dataLeavesDevice === true
    ));
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
    openaiConfigured: openai.configured === true,
    openaiVerification: String(openai.verification || ""),
    openaiVerificationCode: String(openai.verificationCode || ""),
    openaiModelId: String(openai.modelId || ""),
  };
  let state = "indeterminate";
  if (
    grok.configured === false
    && grok.verification === "not_configured"
    && grok.verificationCode === "NOT_CONFIGURED"
  ) {
    state = "credential_not_configured";
  } else if (grok.configured !== true) {
    state = "indeterminate";
  } else if (String(grok.modelId || "") !== expectedXaiModelId) {
    state = "model_invalid";
  } else if (
    grok.verification === "verified"
    && grok.verificationCode === "MODEL_ACCESS_VERIFIED"
  ) {
    state = "verified";
  } else if (
    grok.verification === "failed"
    && DEFINITE_XAI_CREDENTIAL_FAILURES.has(grok.verificationCode)
  ) {
    state = "credential_revoked";
  } else if (
    grok.verification === "failed"
    && DEFINITE_XAI_MODEL_FAILURES.has(grok.verificationCode)
  ) {
    state = "model_invalid";
  }

  let openaiState = "indeterminate";
  if (
    openai.configured === false
    && openai.verification === "not_configured"
    && openai.verificationCode === "NOT_CONFIGURED"
  ) {
    openaiState = "credential_not_configured";
  } else if (
    openai.configured === true
    && openai.verification === "verified"
    && openai.verificationCode === "MODEL_ACCESS_VERIFIED"
  ) {
    openaiState = "verified";
  } else if (
    openai.configured === true
    && openai.verification === "failed"
    && openai.verificationCode === "EXTERNAL_PROVIDER_AUTH_FAILED"
  ) {
    openaiState = "credential_revoked";
  }

  const expectedTopLevelVerification = state === "verified" && openaiState === "verified"
    ? "verified"
    : "degraded";
  if (
    state !== "indeterminate"
    && openaiState !== "indeterminate"
    && payload.verification === expectedTopLevelVerification
  ) {
    return sanitizedXaiObservation({ ...common, state, openaiState });
  }
  return sanitizedXaiObservation({
    ...common,
    state,
    openaiState,
    failureCode: state === "indeterminate"
      ? "PRODUCTION_AUDIT_XAI_RUNTIME_TRUTH_INDETERMINATE"
      : openaiState === "indeterminate"
        ? "PRODUCTION_AUDIT_OPENAI_RUNTIME_TRUTH_INDETERMINATE"
        : "PRODUCTION_AUDIT_EXTERNAL_AI_TOP_LEVEL_TRUTH_INVALID",
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
        `https://${alias}/api/ai/external/providers?probe=1&providers=openai,grok&production-env-audit=${Date.now()}`,
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
  const openaiStates = [...new Set(observations.map((observation) => observation.openaiState))];
  const hasIndeterminateObservation = observations.some((observation) => (
    observation.state === "indeterminate"
    || observation.openaiState === "indeterminate"
    || observation.failureCode
  ));
  if (hasIndeterminateObservation || states.length !== 1 || openaiStates.length !== 1) {
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
        : "PRODUCTION_AUDIT_EXTERNAL_AI_ALIAS_TRUTH_DISAGREEMENT",
      secretValuesStored: false,
    };
  }

  const state = states[0];
  const openaiState = openaiStates[0];
  const xaiRepairKeys = state === "credential_not_configured" || state === "credential_revoked"
    ? ["XAI_API_KEY"]
    : state === "model_invalid"
      ? ["XAI_MODEL_ID"]
      : [];
  const openaiRepairKeys = openaiState === "credential_revoked"
    ? ["OPENAI_API_KEY"]
    : [];
  const repairKeys = [...xaiRepairKeys, ...openaiRepairKeys];
  return {
    verified: state === "verified"
      && ["verified", "credential_not_configured"].includes(openaiState),
    indeterminate: false,
    readOnly: true,
    verificationMode: "dual-public-alias-read-only-probe",
    expectedModelId: expectedXaiModelId,
    state,
    openaiState,
    xaiRepairKeys,
    openaiRepairKeys,
    repairKeys,
    observations,
    failureCode: null,
    secretValuesStored: false,
  };
}

async function readProductionAliasIdentitySet({
  aliases,
  fetcher,
  fetchTimeoutMs,
  deadlineAt,
  phase,
}) {
  return Promise.all(aliases.map(async (alias) => {
    const response = await boundedFetch(
      fetcher,
      `https://${alias}/api/release/identity?production-env-audit=${phase}-${Date.now()}`,
      { cache: "no-store" },
      {
        timeoutMs: fetchTimeoutMs,
        deadlineAt,
        timeoutCode: "PRODUCTION_AUDIT_RELEASE_IDENTITY_TIMEOUT",
      },
    );
    const identity = await boundedOperation(() => response.json(), {
      timeoutMs: fetchTimeoutMs,
      deadlineAt,
      timeoutCode: "PRODUCTION_AUDIT_RELEASE_IDENTITY_BODY_TIMEOUT",
      onTimeout: () => response.body?.cancel().catch(() => undefined),
    }).catch(() => null);
    if (
      !response.ok
      || !/^dpl_[A-Za-z0-9]+$/u.test(String(identity?.deploymentId || ""))
      || !/^[a-f0-9]{40}$/u.test(String(identity?.appCommit || ""))
      || identity?.environment !== "production"
      || identity?.provenanceStatus !== "verified"
    ) {
      throw Object.assign(new Error("PRODUCTION_AUDIT_RELEASE_IDENTITY_INVALID"), {
        code: "PRODUCTION_AUDIT_RELEASE_IDENTITY_INVALID",
      });
    }
    return {
      alias,
      deploymentId: identity.deploymentId,
      appCommit: identity.appCommit,
      provenanceStatus: "verified",
      environment: "production",
    };
  }));
}

async function readProductionDeploymentControlPlane({
  deploymentId,
  appCommit,
  token,
  teamId,
  projectId,
  fetcher,
  fetchTimeoutMs,
  deadlineAt,
}) {
  const url = new URL(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`,
  );
  url.searchParams.set("teamId", teamId);
  const response = await boundedFetch(fetcher, url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  }, {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "PRODUCTION_AUDIT_DEPLOYMENT_CONTROL_PLANE_TIMEOUT",
  });
  const deployment = await boundedOperation(() => response.json(), {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "PRODUCTION_AUDIT_DEPLOYMENT_CONTROL_PLANE_BODY_TIMEOUT",
    onTimeout: () => response.body?.cancel().catch(() => undefined),
  }).catch(() => null);
  const observedDeploymentId = deployment?.id ?? deployment?.uid ?? null;
  const observedCommit = deployment?.meta?.githubCommitSha ?? null;
  const observedProjectId = deployment?.projectId ?? deployment?.project?.id ?? null;
  const observedTeamId = deployment?.teamId
    ?? deployment?.ownerId
    ?? deployment?.project?.accountId
    ?? null;
  const readyState = deployment?.readyState ?? deployment?.state ?? null;
  const createdAt = Number(deployment?.createdAt);
  if (
    !response.ok
    || observedDeploymentId !== deploymentId
    || observedCommit !== appCommit
    || observedProjectId !== projectId
    || observedTeamId !== teamId
    || readyState !== "READY"
    || deployment?.target !== "production"
    || !Number.isFinite(createdAt)
    || createdAt <= 0
  ) {
    throw Object.assign(new Error("PRODUCTION_AUDIT_DEPLOYMENT_CONTROL_PLANE_INVALID"), {
      code: "PRODUCTION_AUDIT_DEPLOYMENT_CONTROL_PLANE_INVALID",
    });
  }
  return {
    deploymentId,
    appCommit,
    createdAt,
    readyState: "READY",
    target: "production",
    projectIdMatches: true,
    teamIdMatches: true,
  };
}

export async function readBoundProductionExternalAiRuntimeTruth({
  aliases,
  expectedXaiModelId = "grok-4.5",
  token,
  teamId,
  projectId,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 45_000,
}) {
  const normalizedAliases = [...new Set((aliases || []).map((alias) => String(alias || "").trim()))]
    .filter(Boolean);
  if (normalizedAliases.length !== 2 || !token || !teamId || !projectId) {
    return {
      verified: false,
      indeterminate: true,
      readOnly: true,
      verificationMode: "dual-public-alias-deployment-bound-read-only-probe",
      expectedModelId: expectedXaiModelId,
      state: "indeterminate",
      openaiState: "indeterminate",
      repairKeys: [],
      observations: [],
      deploymentBound: false,
      deploymentSnapshots: [],
      earliestDeploymentCreatedAt: null,
      failureCode: "PRODUCTION_AUDIT_EXTERNAL_AI_DEPLOYMENT_BINDING_INPUT_INVALID",
      secretValuesStored: false,
    };
  }
  let runtimeTruth;
  try {
    const identityBefore = await readProductionAliasIdentitySet({
      aliases: normalizedAliases,
      fetcher,
      fetchTimeoutMs,
      deadlineAt,
      phase: "before",
    });
    runtimeTruth = await readProductionExternalAiRuntimeTruth({
      aliases: normalizedAliases,
      expectedXaiModelId,
      fetcher,
      fetchTimeoutMs,
      deadlineAt,
    });
    const identityAfter = await readProductionAliasIdentitySet({
      aliases: normalizedAliases,
      fetcher,
      fetchTimeoutMs,
      deadlineAt,
      phase: "after",
    });
    const identityBeforeDigest = sha256(identityBefore);
    const identityAfterDigest = sha256(identityAfter);
    const deploymentIds = [...new Set(identityAfter.map((entry) => entry.deploymentId))];
    const appCommits = [...new Set(identityAfter.map((entry) => entry.appCommit))];
    if (
      identityBeforeDigest !== identityAfterDigest
      || deploymentIds.length !== 1
      || appCommits.length !== 1
    ) {
      throw Object.assign(new Error("PRODUCTION_AUDIT_EXTERNAL_AI_DEPLOYMENT_IDENTITY_CHANGED"), {
        code: "PRODUCTION_AUDIT_EXTERNAL_AI_DEPLOYMENT_IDENTITY_CHANGED",
      });
    }
    const controlPlane = await readProductionDeploymentControlPlane({
      deploymentId: deploymentIds[0],
      appCommit: appCommits[0],
      token,
      teamId,
      projectId,
      fetcher,
      fetchTimeoutMs,
      deadlineAt,
    });
    const deploymentSnapshots = identityAfter.map((identity) => ({
      alias: identity.alias,
      deploymentId: identity.deploymentId,
      appCommit: identity.appCommit,
      deploymentCreatedAt: controlPlane.createdAt,
      provenanceStatus: identity.provenanceStatus,
      environment: identity.environment,
    }));
    return {
      ...runtimeTruth,
      verified: runtimeTruth.verified === true,
      indeterminate: runtimeTruth.indeterminate === true,
      verificationMode: "dual-public-alias-deployment-bound-read-only-probe",
      deploymentBound: true,
      deploymentSnapshots,
      earliestDeploymentCreatedAt: controlPlane.createdAt,
      secretValuesStored: false,
    };
  } catch (error) {
    return {
      ...(runtimeTruth || {}),
      verified: false,
      indeterminate: true,
      readOnly: true,
      verificationMode: "dual-public-alias-deployment-bound-read-only-probe",
      expectedModelId: expectedXaiModelId,
      state: "indeterminate",
      openaiState: "indeterminate",
      xaiRepairKeys: [],
      openaiRepairKeys: [],
      repairKeys: [],
      observations: runtimeTruth?.observations || [],
      deploymentBound: false,
      deploymentSnapshots: [],
      earliestDeploymentCreatedAt: null,
      failureCode: String(
        error?.code || error?.message || "PRODUCTION_AUDIT_EXTERNAL_AI_DEPLOYMENT_BINDING_FAILED",
      ),
      secretValuesStored: false,
    };
  }
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
  const productionOpenAiKey = String(production.OPENAI_API_KEY || "").trim();
  const supabaseCredentialMetadata = vercelEnvironmentMetadata?.entries?.SUPABASE_SERVICE_ROLE_KEY;
  const xaiCredentialMetadata = vercelEnvironmentMetadata?.entries?.XAI_API_KEY;
  const openaiCredentialMetadata = vercelEnvironmentMetadata?.entries?.OPENAI_API_KEY;
  const openaiModelMetadata = vercelEnvironmentMetadata?.entries?.OPENAI_MODEL_ID;
  const openaiProductionRecords = optionalOpenAiProductionRecords(vercelEnvironmentMetadata);
  const removableOpenAiRecord = exactRemovableOpenAiProductionRecord(vercelEnvironmentMetadata);
  const earliestDeploymentCreatedAt = Number(
    externalAiRuntimeTruth?.earliestDeploymentCreatedAt,
  );
  const openaiRecordPredatesDeployments = Boolean(
    removableOpenAiRecord
    && Number.isFinite(earliestDeploymentCreatedAt)
    && earliestDeploymentCreatedAt > 0
    && removableOpenAiRecord.updatedAt <= earliestDeploymentCreatedAt
  );
  const supabaseCredentialMetadataSafe = ["encrypted", "sensitive"]
    .includes(supabaseCredentialMetadata?.type);
  const driftKeys = [];

  if (
    externalAiRuntimeTruth?.openaiState
      === "credential_not_configured_pending_staged_deployment"
    && (
      Boolean(productionOpenAiKey)
      || Boolean(openaiCredentialMetadata)
      || openaiProductionRecords.length !== 0
    )
  ) {
    throw Object.assign(new Error("PRODUCTION_AUDIT_OPENAI_REMOVAL_PENDING_METADATA_PRESENT"), {
      code: "PRODUCTION_AUDIT_OPENAI_REMOVAL_PENDING_METADATA_PRESENT",
    });
  }

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
  const optionalOpenAiConfigured = Boolean(productionOpenAiKey || openaiCredentialMetadata);
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
  const xaiRepairKeys = externalAiRuntimeTruth?.xaiRepairKeys
    || (externalAiRuntimeTruth?.repairKeys || []).filter((key) => PRODUCTION_XAI_KEYS.includes(key));
  for (const key of externalAiExpected ? xaiRepairKeys : []) {
    if (!PRODUCTION_XAI_KEYS.includes(key)) {
      throw Object.assign(new Error("PRODUCTION_AUDIT_XAI_REPAIR_KEY_INVALID"), {
        code: "PRODUCTION_AUDIT_XAI_REPAIR_KEY_INVALID",
      });
    }
    driftKeys.push(key);
  }
  const openaiRepairKeys = externalAiRuntimeTruth?.openaiRepairKeys
    || (externalAiRuntimeTruth?.repairKeys || [])
      .filter((key) => PRODUCTION_OPTIONAL_OPENAI_KEYS.includes(key));
  for (const key of optionalOpenAiConfigured ? openaiRepairKeys : []) {
    if (!PRODUCTION_OPTIONAL_OPENAI_KEYS.includes(key)) {
      throw Object.assign(new Error("PRODUCTION_AUDIT_OPENAI_REPAIR_KEY_INVALID"), {
        code: "PRODUCTION_AUDIT_OPENAI_REPAIR_KEY_INVALID",
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
      ...PRODUCTION_XAI_KEYS,
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
      openai: {
        configured: optionalOpenAiConfigured,
        credentialMetadataPresent: Boolean(openaiCredentialMetadata),
        credentialType: openaiCredentialMetadata?.type || null,
        credentialTargets: [...(openaiCredentialMetadata?.targets || [])],
        modelMetadataPresent: Boolean(openaiModelMetadata),
        modelTargets: [...(openaiModelMetadata?.targets || [])],
        productionRecordCount: openaiProductionRecords.length,
        removableRecordFingerprint: removableOpenAiRecord?.recordFingerprint || null,
        removableRecordIdPresent: Boolean(removableOpenAiRecord?.id),
        removableRecordUpdatedAt: removableOpenAiRecord?.updatedAt || null,
        deploymentBound: externalAiRuntimeTruth?.deploymentBound === true,
        deploymentSnapshots: [...(externalAiRuntimeTruth?.deploymentSnapshots || [])],
        earliestDeploymentCreatedAt: Number.isFinite(earliestDeploymentCreatedAt)
          ? earliestDeploymentCreatedAt
          : null,
        recordPredatesDeployments: openaiRecordPredatesDeployments,
        runtimeState: externalAiRuntimeTruth?.openaiState || null,
        runtimeRepairKeys: [...openaiRepairKeys],
        removalAuthorized: optionalOpenAiConfigured
          && externalAiRuntimeTruth?.openaiState === "credential_revoked"
          && openaiRepairKeys.length === 1
          && openaiRepairKeys[0] === "OPENAI_API_KEY"
          && Boolean(removableOpenAiRecord?.recordFingerprint)
          && externalAiRuntimeTruth?.deploymentBound === true
          && openaiRecordPredatesDeployments,
      },
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
  const mutations = actualChangedKeys.map((key) => ({
    key,
    operation: key === "OPENAI_API_KEY"
      && before.truth?.externalAi?.openai?.removalAuthorized === true
      ? "remove"
      : "upsert",
    target: "production",
    beforeRecordFingerprint: key === "OPENAI_API_KEY"
      ? before.truth?.externalAi?.openai?.removableRecordFingerprint || null
      : null,
  }));
  const receiptCore = {
    schemaVersion: "production-environment-repair-receipt-v1",
    beforeDigest: before.truthDigest,
    afterDigest: after.truthDigest,
    changedKeys,
    changedKeysCount: changedKeys.length,
    mutationCount: actualChangedKeys.length,
    mutations,
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

function runVercel(args, {
  failureCode = "PRODUCTION_AUDIT_VERCEL_COMMAND_FAILED",
  timeoutMs = 60_000,
} = {}) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, ["exec", "vercel", ...args], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
  if (result.error || result.status !== 0) {
    throw Object.assign(new Error(failureCode), {
      code: failureCode,
    });
  }
}

export function planInvalidOptionalOpenAiProductionRemoval({
  allowedMutationKeys,
  auditedExternalAiTruth,
}) {
  if (!Array.isArray(allowedMutationKeys)) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_OPENAI_MUTATION_KEYS_MISSING"), {
      code: "PRODUCTION_REPAIR_OPENAI_MUTATION_KEYS_MISSING",
    });
  }
  const requested = [...new Set(allowedMutationKeys)];
  if (requested.some((key) => !PRODUCTION_OPTIONAL_OPENAI_KEYS.includes(key))) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_OPENAI_MUTATION_KEY_INVALID"), {
      code: "PRODUCTION_REPAIR_OPENAI_MUTATION_KEY_INVALID",
    });
  }
  if (requested.length === 0) return [];
  const openaiTruth = auditedExternalAiTruth?.openai;
  if (
    openaiTruth?.removalAuthorized !== true
    || openaiTruth?.runtimeState !== "credential_revoked"
    || openaiTruth?.credentialMetadataPresent !== true
    || !openaiTruth?.credentialTargets?.includes("production")
    || !openaiTruth?.runtimeRepairKeys?.includes("OPENAI_API_KEY")
    || openaiTruth?.productionRecordCount !== 1
    || openaiTruth?.removableRecordIdPresent !== true
    || openaiTruth?.deploymentBound !== true
    || openaiTruth?.recordPredatesDeployments !== true
    || !/^[a-f0-9]{64}$/u.test(String(openaiTruth?.removableRecordFingerprint || ""))
  ) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_OPENAI_AUDIT_AUTHORIZATION_INVALID"), {
      code: "PRODUCTION_REPAIR_OPENAI_AUDIT_AUTHORIZATION_INVALID",
    });
  }
  return requested.filter((key) => key === "OPENAI_API_KEY");
}

export async function deleteVercelProductionEnvironmentRecord({
  token,
  teamId,
  projectId,
  recordId,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  if (!token || !teamId || !projectId || !recordId) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_OPENAI_DELETE_IDENTITY_MISSING"), {
      code: "PRODUCTION_REPAIR_OPENAI_DELETE_IDENTITY_MISSING",
    });
  }
  const url = new URL(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(recordId)}`,
  );
  url.searchParams.set("teamId", teamId);
  const response = await boundedFetch(fetcher, url, {
    method: "DELETE",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  }, {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "PRODUCTION_REPAIR_OPENAI_VERCEL_DELETE_TIMEOUT",
  });
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_OPENAI_VERCEL_DELETE_FAILED"), {
      code: "PRODUCTION_REPAIR_OPENAI_VERCEL_DELETE_FAILED",
      httpStatus: response.status,
    });
  }
  return {
    deleted: true,
    httpStatus: response.status,
    target: "production",
    secretValuesStored: false,
  };
}

export async function removeInvalidOptionalOpenAiProductionEnvironment({
  allowedMutationKeys,
  auditedExternalAiTruth,
  auditDigestVerified,
  projectId,
  token,
  teamId,
  recordRemover = deleteVercelProductionEnvironmentRecord,
  metadataReader = readVercelProductionEnvironmentMetadata,
}) {
  if (auditDigestVerified !== true) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_OPENAI_AUDIT_DIGEST_UNVERIFIED"), {
      code: "PRODUCTION_REPAIR_OPENAI_AUDIT_DIGEST_UNVERIFIED",
    });
  }
  if (!projectId || !token || !teamId) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_OPENAI_VERCEL_AUTH_MISSING"), {
      code: "PRODUCTION_REPAIR_OPENAI_VERCEL_AUTH_MISSING",
    });
  }
  const plannedKeys = planInvalidOptionalOpenAiProductionRemoval({
    allowedMutationKeys,
    auditedExternalAiTruth,
  });
  const preMutationMetadata = await metadataReader({ token, teamId, projectId });
  const preMutationRecord = exactRemovableOpenAiProductionRecord(preMutationMetadata);
  if (
    !preMutationRecord
    || preMutationRecord.recordFingerprint
      !== auditedExternalAiTruth.openai.removableRecordFingerprint
  ) {
    throw Object.assign(new Error("PRODUCTION_REPAIR_OPENAI_RECORD_FINGERPRINT_CHANGED"), {
      code: "PRODUCTION_REPAIR_OPENAI_RECORD_FINGERPRINT_CHANGED",
    });
  }
  const actualChangedKeys = [];
  for (const key of plannedKeys) {
    const deletion = await recordRemover({
      token,
      teamId,
      projectId,
      recordId: preMutationRecord.id,
    });
    if (
      deletion?.deleted !== true
      || !Number.isInteger(deletion?.httpStatus)
      || deletion.httpStatus < 200
      || deletion.httpStatus >= 300
    ) {
      throw Object.assign(new Error("PRODUCTION_REPAIR_OPENAI_DELETE_NOT_ATTESTED"), {
        code: "PRODUCTION_REPAIR_OPENAI_DELETE_NOT_ATTESTED",
      });
    }
    const metadata = await metadataReader({ token, teamId, projectId });
    if (optionalOpenAiProductionRecords(metadata).length !== 0) {
      throw Object.assign(new Error("PRODUCTION_REPAIR_OPENAI_REMOVAL_NOT_OBSERVED"), {
        code: "PRODUCTION_REPAIR_OPENAI_REMOVAL_NOT_OBSERVED",
      });
    }
    actualChangedKeys.push(key);
  }
  return {
    changedKeys: actualChangedKeys,
    mutationCount: actualChangedKeys.length,
    target: "production",
    beforeRecordFingerprint: preMutationRecord.recordFingerprint,
    credentialExposed: false,
    secretValuesStored: false,
  };
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
    ], { failureCode: "PRODUCTION_AUDIT_VERCEL_PULL_FAILED" });
    const production = await readFile(productionFile, "utf8").then(parseEnvFile);
    const deadlineAt = Date.now() + 60_000;
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
        : readBoundProductionExternalAiRuntimeTruth({
          aliases: [requiredEnvironment("PRIMARY_ALIAS"), requiredEnvironment("MIRROR_ALIAS")],
          expectedXaiModelId,
          token,
          teamId,
          projectId,
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
  let xaiRepaired = false;
  let optionalOpenAiRemoved = false;
  if (auditedRepairRequired && before.driftKeys.some((key) => PRODUCTION_SUPABASE_KEYS.includes(key))) {
    const { main: repairSupabase } = await import("./bootstrap-production-supabase-env.mjs");
    const result = await repairSupabase({
      allowedMutationKeys: before.driftKeys.filter((key) => PRODUCTION_SUPABASE_KEYS.includes(key)),
    });
    actualChangedKeys.push(...result.changedKeys);
    supabaseCredentialVerificationOverride = result.supabaseCredentialVerification;
  }
  if (auditedRepairRequired && before.driftKeys.some((key) => PRODUCTION_XAI_KEYS.includes(key))) {
    if (!isXaiKey(process.env.XAI_API_KEY)) {
      throw Object.assign(new Error("PRODUCTION_REPAIR_XAI_GITHUB_SECRET_REQUIRED"), {
        code: "PRODUCTION_REPAIR_XAI_GITHUB_SECRET_REQUIRED",
      });
    }
    const { main: repairExternalAi } = await import("./bootstrap-production-external-ai-env.mjs");
    const result = await repairExternalAi({
      allowedMutationKeys: before.driftKeys.filter((key) => PRODUCTION_XAI_KEYS.includes(key)),
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
    xaiRepaired = true;
  }
  if (
    auditedRepairRequired
    && before.driftKeys.some((key) => PRODUCTION_OPTIONAL_OPENAI_KEYS.includes(key))
  ) {
    const result = await removeInvalidOptionalOpenAiProductionEnvironment({
      allowedMutationKeys: before.driftKeys
        .filter((key) => PRODUCTION_OPTIONAL_OPENAI_KEYS.includes(key)),
      auditedExternalAiTruth: before.truth.externalAi,
      auditDigestVerified: auditedBeforeDigest === before.truthDigest,
      projectId: requiredEnvironment("VERCEL_PROJECT_ID"),
      token: requiredEnvironment("VERCEL_TOKEN"),
      teamId: requiredEnvironment("VERCEL_ORG_ID"),
    });
    actualChangedKeys.push(...result.changedKeys);
    optionalOpenAiRemoved = result.changedKeys.includes("OPENAI_API_KEY");
  }
  if (xaiRepaired || optionalOpenAiRemoved) {
    const beforeExternalAiTruth = before.truth.externalAi;
    const xaiState = xaiRepaired
      ? "verified_pending_staged_deployment"
      : beforeExternalAiTruth.runtimeState;
    const openaiState = optionalOpenAiRemoved
      ? "credential_not_configured_pending_staged_deployment"
      : beforeExternalAiTruth.openai?.runtimeState;
    externalAiRuntimeTruthOverride = {
      verified: String(xaiState || "").startsWith("verified")
        && ["verified", "credential_not_configured_pending_staged_deployment"]
          .includes(openaiState),
      indeterminate: false,
      readOnly: true,
      verificationMode: "audited-repair-plus-vercel-metadata-pending-staged-deployment",
      expectedModelId: process.env.XAI_MODEL_ID || "grok-4.5",
      state: xaiState,
      openaiState,
      xaiRepairKeys: [],
      openaiRepairKeys: [],
      repairKeys: [],
      observations: [],
      deploymentBound: beforeExternalAiTruth.openai?.deploymentBound === true,
      deploymentSnapshots: [...(beforeExternalAiTruth.openai?.deploymentSnapshots || [])],
      earliestDeploymentCreatedAt:
        beforeExternalAiTruth.openai?.earliestDeploymentCreatedAt || null,
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
