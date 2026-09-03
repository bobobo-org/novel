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
  constructor(code) {
    super(code);
    this.name = "TrustedPreviewEnvironmentError";
    this.code = code;
  }
}

function fail(code) {
  throw new TrustedPreviewEnvironmentError(code);
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
  url.searchParams.set("teamId", teamId);
  const response = await boundedFetch(fetcher, url, {
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
  if (result.error || result.status !== 0) fail("TRUSTED_PREVIEW_ENVIRONMENT_WRITE_FAILED");
}

function trustedPreviewAuth(environment = process.env) {
  return Object.freeze({
    projectId: requiredString(environment.VERCEL_PROJECT_ID, "TRUSTED_PREVIEW_VERCEL_PROJECT_ID_MISSING"),
    scope: requiredString(environment.VERCEL_SCOPE, "TRUSTED_PREVIEW_VERCEL_SCOPE_MISSING"),
    teamId: requiredString(environment.VERCEL_ORG_ID, "TRUSTED_PREVIEW_VERCEL_ORG_ID_MISSING"),
    token: requiredString(environment.VERCEL_TOKEN, "TRUSTED_PREVIEW_VERCEL_TOKEN_MISSING"),
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
  if (arguments_[0] !== "--required") fail("TRUSTED_PREVIEW_BOOTSTRAP_ARGUMENT_INVALID");
  const result = await bootstrapTrustedPreviewEnvironment({ environment: process.env });
  console.log(JSON.stringify(safeResult(result)));
  return result;
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "trusted_preview_environment_operation_failed",
      errorCode: String(error?.code || "TRUSTED_PREVIEW_ENVIRONMENT_OPERATION_FAILED"),
      secretValuesStored: false,
    }));
    process.exitCode = 1;
  });
}
