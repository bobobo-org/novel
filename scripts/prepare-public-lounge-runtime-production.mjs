import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  enforceProductionMainHeadCasBeforeMutation,
  readVercelProductionEnvironmentMetadata,
} from "./production-environment-governance.mjs";

export const PUBLIC_LOUNGE_RUNTIME_PREPARATION_RECEIPT_SCHEMA =
  "public-lounge-runtime-production-preparation-v1";
export const PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS = Object.freeze([
  "PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY",
  "PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY",
]);
export const PUBLIC_LOUNGE_INTERACTIONS_ENABLED_KEY = "PUBLIC_LOUNGE_INTERACTIONS_ENABLED";

const FULL_COMMIT = /^[a-f0-9]{40}$/u;
const CANONICAL_32_BYTE_BASE64URL = /^[A-Za-z0-9_-]{43}$/u;

function preparationError(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

function ensure(condition, code, details = {}) {
  if (!condition) throw preparationError(code, details);
}

function safeErrorCode(error) {
  const candidate = String(error?.code || error?.message || "");
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(candidate)
    ? candidate
    : "PUBLIC_LOUNGE_RUNTIME_PREPARATION_FAILED";
}

export function isCanonicalRuntimeSecret(value) {
  const encoded = String(value || "").trim();
  if (!CANONICAL_32_BYTE_BASE64URL.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === encoded;
}

function recordsForKey(metadata, key) {
  return Array.isArray(metadata?.records)
    ? metadata.records.filter((record) => record?.key === key)
    : [];
}

function assertUnmanagedProductionRecord(record, key, { sensitiveRequired }) {
  ensure(Array.isArray(record?.targets)
    && record.targets.length === 1
    && record.targets[0] === "production",
  "PUBLIC_LOUNGE_RUNTIME_SECRET_SCOPE_INVALID", { key });
  ensure(!record.gitBranchScoped && Number(record.customEnvironmentIdCount || 0) === 0,
    "PUBLIC_LOUNGE_RUNTIME_SECRET_SCOPE_INVALID", { key });
  ensure(!record.system
    && !record.configurationLinked
    && !record.edgeConfigLinked
    && !record.sunsetSecretLinked
    && !record.vsmValuePresent
    && !record.createdByIntegration
    && (!Array.isArray(record.controlMarkers) || record.controlMarkers.length === 0),
  "PUBLIC_LOUNGE_RUNTIME_SECRET_MANAGED_RECORD_INVALID", { key });
  if (sensitiveRequired) {
    ensure(record.type === "sensitive", "PUBLIC_LOUNGE_RUNTIME_SECRET_NOT_SENSITIVE", { key });
  }
}

export function validateRuntimeSecretMetadata(metadata, { sensitiveRequired = true } = {}) {
  ensure(metadata?.verified === true
    && metadata?.readOnly === true
    && Array.isArray(metadata?.records)
    && metadata?.secretValuesStored === false,
  "PUBLIC_LOUNGE_RUNTIME_SECRET_METADATA_UNVERIFIED");
  const status = {};
  for (const key of PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS) {
    const records = recordsForKey(metadata, key);
    ensure(records.length <= 1, "PUBLIC_LOUNGE_RUNTIME_SECRET_RECORD_AMBIGUOUS", { key });
    if (records.length === 0) {
      ensure(!sensitiveRequired, "PUBLIC_LOUNGE_RUNTIME_SECRET_METADATA_MISSING", { key });
      status[key] = "missing";
      continue;
    }
    assertUnmanagedProductionRecord(records[0], key, { sensitiveRequired });
    status[key] = sensitiveRequired ? "sensitive_verified" : "eligible_for_sensitive_sync";
  }
  return status;
}

function parseEnvFile(source) {
  const values = {};
  for (const rawLine of String(source || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function runVercel(args, { input, failureCode }) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, ["exec", "vercel", ...args], {
    encoding: "utf8",
    env: process.env,
    input,
    maxBuffer: 4 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw preparationError(failureCode);
}

export async function readVercelProductionEnvironment({ projectId, scope, token }) {
  const directory = await mkdtemp(resolve(tmpdir(), "novel-lounge-runtime-preparation-"));
  const path = resolve(directory, ".env.production");
  try {
    runVercel([
      "env", "pull", path,
      "--environment", "production",
      "--project", projectId,
      "--scope", scope,
      "--token", token,
      "--yes",
    ], { failureCode: "PUBLIC_LOUNGE_RUNTIME_VERCEL_ENV_READ_FAILED" });
    return parseEnvFile(await readFile(path, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function syncSensitiveProductionEnvironment({ projectId, scope, token, key, value }) {
  ensure(PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS.includes(key),
    "PUBLIC_LOUNGE_RUNTIME_SECRET_KEY_INVALID", { key });
  ensure(isCanonicalRuntimeSecret(value),
    "PUBLIC_LOUNGE_RUNTIME_SECRET_VALUE_INVALID", { key });
  runVercel([
    "env", "add", key, "production",
    "--project", projectId,
    "--scope", scope,
    "--token", token,
    "--force",
    "--sensitive",
    "--yes",
  ], {
    input: `${value}\n`,
    failureCode: "PUBLIC_LOUNGE_RUNTIME_SECRET_SYNC_FAILED",
  });
}

export async function disablePublicLoungeInteractions({ projectId, scope, token }) {
  runVercel([
    "env", "add", PUBLIC_LOUNGE_INTERACTIONS_ENABLED_KEY, "production",
    "--project", projectId,
    "--scope", scope,
    "--token", token,
    "--force",
    "--no-sensitive",
    "--yes",
  ], {
    input: "0\n",
    failureCode: "PUBLIC_LOUNGE_INTERACTIONS_FAIL_CLOSED_WRITE_FAILED",
  });
}

function validateOptions(options) {
  for (const [name, value] of Object.entries({
    VERCEL_ORG_ID: options.vercelOrgId,
    VERCEL_PROJECT_ID: options.vercelProjectId,
    VERCEL_SCOPE: options.vercelScope,
    VERCEL_TOKEN: options.vercelToken,
  })) {
    ensure(String(value || "").trim().length >= 3, `${name}_MISSING`);
  }
  ensure(FULL_COMMIT.test(String(options.expectedCommit || "")),
    "PUBLIC_LOUNGE_RUNTIME_EXPECTED_COMMIT_INVALID");
  ensure(String(options.receiptPath || "").trim().length > 0,
    "PUBLIC_LOUNGE_RUNTIME_PREPARATION_RECEIPT_PATH_REQUIRED");
  const runtimeSecrets = {};
  for (const key of PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS) {
    const value = String(options.runtimeSecrets?.[key] || "").trim();
    ensure(isCanonicalRuntimeSecret(value), "PUBLIC_LOUNGE_RUNTIME_SECRET_VALUE_INVALID", { key });
    runtimeSecrets[key] = value;
  }
  ensure(runtimeSecrets[PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS[0]]
    !== runtimeSecrets[PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS[1]],
  "PUBLIC_LOUNGE_RUNTIME_SECRETS_NOT_DISTINCT");
  return runtimeSecrets;
}

async function readVerifiedMetadata(deps, options, { sensitiveRequired }) {
  const metadata = await deps.readProductionEnvironmentMetadata({
    token: options.vercelToken,
    teamId: options.vercelOrgId,
    projectId: options.vercelProjectId,
  });
  const status = validateRuntimeSecretMetadata(metadata, { sensitiveRequired });
  return { metadata, status };
}

async function waitForVerifiedSensitiveMetadata(deps, options) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await readVerifiedMetadata(deps, options, { sensitiveRequired: true });
    } catch (error) {
      lastError = error;
      if (attempt < 6) await deps.delay(1_000);
    }
  }
  throw lastError || preparationError("PUBLIC_LOUNGE_RUNTIME_SECRET_METADATA_UNVERIFIED");
}

async function writeSanitizedReceipt(path, receipt, sensitiveValues) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  for (const sensitiveValue of sensitiveValues) {
    ensure(!serialized.includes(sensitiveValue), "PUBLIC_LOUNGE_RUNTIME_RECEIPT_SECRET_LEAK");
  }
  const target = resolve(path);
  const temporary = `${target}.tmp-${process.pid}`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    await chmod(target, 0o600).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return receipt;
}

export async function preparePublicLoungeRuntimeProduction(options, dependencies = {}) {
  const deps = {
    mutationGuard: enforceProductionMainHeadCasBeforeMutation,
    readProductionEnvironmentMetadata: readVercelProductionEnvironmentMetadata,
    readProductionEnvironment: readVercelProductionEnvironment,
    syncSensitiveProductionEnvironment,
    disablePublicLoungeInteractions,
    writeReceipt: writeSanitizedReceipt,
    delay: (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
    now: () => new Date().toISOString(),
    ...dependencies,
  };
  const runtimeSecrets = validateOptions(options);
  const secretValues = Object.values(runtimeSecrets);
  const receipt = {
    schemaVersion: PUBLIC_LOUNGE_RUNTIME_PREPARATION_RECEIPT_SCHEMA,
    status: "started",
    startedAt: deps.now(),
    completedAt: null,
    target: "production",
    expectedMainHeadCommit: options.expectedCommit,
    interactionsEnabled: false,
    failClosedVerified: false,
    runtimeSecrets: {
      source: "github_actions_secret_escrow",
      metadataVerified: false,
      status: Object.fromEntries(PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS.map((key) => [key, null])),
    },
    casCheckCount: 0,
    mutationCount: 0,
    errorCode: null,
    secretValuesStored: false,
  };
  const guardMutation = (key) => {
    deps.mutationGuard({ required: "true", expectedCommit: options.expectedCommit, key });
    receipt.casCheckCount += 1;
  };
  try {
    await readVerifiedMetadata(deps, options, { sensitiveRequired: false });

    guardMutation(PUBLIC_LOUNGE_INTERACTIONS_ENABLED_KEY);
    await deps.disablePublicLoungeInteractions({
      projectId: options.vercelProjectId,
      scope: options.vercelScope,
      token: options.vercelToken,
    });
    receipt.mutationCount += 1;

    for (const key of PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS) {
      guardMutation(key);
      await deps.syncSensitiveProductionEnvironment({
        projectId: options.vercelProjectId,
        scope: options.vercelScope,
        token: options.vercelToken,
        key,
        value: runtimeSecrets[key],
      });
      receipt.mutationCount += 1;
      receipt.runtimeSecrets.status[key] = "enforced_from_github_escrow";
    }

    await waitForVerifiedSensitiveMetadata(deps, options);
    receipt.runtimeSecrets.metadataVerified = true;
    const production = await deps.readProductionEnvironment({
      projectId: options.vercelProjectId,
      scope: options.vercelScope,
      token: options.vercelToken,
    });
    ensure(production?.[PUBLIC_LOUNGE_INTERACTIONS_ENABLED_KEY] === "0",
      "PUBLIC_LOUNGE_INTERACTIONS_FAIL_CLOSED_VERIFICATION_FAILED");
    receipt.failClosedVerified = true;
    receipt.status = "prepared_fail_closed";
    receipt.completedAt = deps.now();
    await deps.writeReceipt(options.receiptPath, receipt, secretValues);
    return receipt;
  } catch (error) {
    receipt.status = "failed";
    receipt.completedAt = deps.now();
    receipt.errorCode = safeErrorCode(error);
    await deps.writeReceipt(options.receiptPath, receipt, secretValues).catch(() => undefined);
    throw error;
  }
}

function metadataFixture(type = "sensitive") {
  return {
    verified: true,
    readOnly: true,
    secretValuesStored: false,
    entries: {},
    records: PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS.map((key, index) => ({
      id: `fixture-${index}`,
      key,
      type,
      targets: ["production"],
      gitBranchScoped: false,
      customEnvironmentIdCount: 0,
      system: false,
      configurationLinked: false,
      edgeConfigLinked: false,
      sunsetSecretLinked: false,
      vsmValuePresent: false,
      createdByIntegration: false,
      controlMarkers: [],
      secretValuesStored: false,
    })),
  };
}

export async function runSelfTest() {
  const keyA = Buffer.alloc(32, 0x11).toString("base64url");
  const keyB = Buffer.alloc(32, 0x22).toString("base64url");
  const expectedCommit = "a".repeat(40);
  const events = [];
  let writtenReceipt;
  const options = {
    vercelOrgId: "team_fixture",
    vercelProjectId: "project_fixture",
    vercelScope: "scope_fixture",
    vercelToken: "token_fixture",
    expectedCommit,
    receiptPath: resolve(tmpdir(), `public-lounge-runtime-self-test-${process.pid}.json`),
    runtimeSecrets: {
      [PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS[0]]: keyA,
      [PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS[1]]: keyB,
    },
  };
  const receipt = await preparePublicLoungeRuntimeProduction(options, {
    mutationGuard: (input) => events.push({ operation: "cas", key: input.key }),
    readProductionEnvironmentMetadata: async () => metadataFixture(),
    readProductionEnvironment: async () => ({ [PUBLIC_LOUNGE_INTERACTIONS_ENABLED_KEY]: "0" }),
    syncSensitiveProductionEnvironment: async ({ key, value }) => {
      ensure(value === options.runtimeSecrets[key], "SELF_TEST_SECRET_SYNC_MISMATCH");
      events.push({ operation: "secret_sync", key });
    },
    disablePublicLoungeInteractions: async () => events.push({ operation: "disable" }),
    writeReceipt: async (_path, value, sensitiveValues) => {
      const serialized = JSON.stringify(value);
      ensure(sensitiveValues.every((secret) => !serialized.includes(secret)),
        "SELF_TEST_RECEIPT_SECRET_LEAK");
      writtenReceipt = value;
      return value;
    },
    delay: async () => undefined,
    now: () => "2026-09-01T00:00:00.000Z",
  });
  ensure(receipt.status === "prepared_fail_closed" && writtenReceipt === receipt,
    "SELF_TEST_RECEIPT_INVALID");
  ensure(receipt.casCheckCount === 3 && receipt.mutationCount === 3,
    "SELF_TEST_MUTATION_ACCOUNTING_INVALID");
  ensure(events.map((event) => event.operation).join(",")
    === "cas,disable,cas,secret_sync,cas,secret_sync",
  "SELF_TEST_CAS_ORDER_INVALID");
  ensure(!JSON.stringify(receipt).includes(keyA) && !JSON.stringify(receipt).includes(keyB),
    "SELF_TEST_RECEIPT_SECRET_LEAK");

  let duplicateRejected = false;
  try {
    validateOptions({
      ...options,
      runtimeSecrets: Object.fromEntries(PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS.map((key) => [key, keyA])),
    });
  } catch (error) {
    duplicateRejected = error?.code === "PUBLIC_LOUNGE_RUNTIME_SECRETS_NOT_DISTINCT";
  }
  ensure(duplicateRejected, "SELF_TEST_DUPLICATE_SECRET_ACCEPTED");

  let invalidRejected = false;
  try {
    validateOptions({
      ...options,
      runtimeSecrets: { ...options.runtimeSecrets, [PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS[0]]: "short" },
    });
  } catch (error) {
    invalidRejected = error?.code === "PUBLIC_LOUNGE_RUNTIME_SECRET_VALUE_INVALID";
  }
  ensure(invalidRejected, "SELF_TEST_INVALID_SECRET_ACCEPTED");

  const unsafeMetadata = metadataFixture();
  unsafeMetadata.records[0] = { ...unsafeMetadata.records[0], gitBranchScoped: true };
  let unsafeMetadataRejected = false;
  try {
    validateRuntimeSecretMetadata(unsafeMetadata);
  } catch (error) {
    unsafeMetadataRejected = error?.code === "PUBLIC_LOUNGE_RUNTIME_SECRET_SCOPE_INVALID";
  }
  ensure(unsafeMetadataRejected, "SELF_TEST_UNSAFE_METADATA_ACCEPTED");
  return {
    status: "public_lounge_runtime_preparation_self_test_passed",
    casCheckCount: receipt.casCheckCount,
    mutationCount: receipt.mutationCount,
    failClosedVerified: receipt.failClosedVerified,
    secretValuesStored: false,
  };
}

function optionsFromEnvironment() {
  return {
    vercelOrgId: process.env.VERCEL_ORG_ID,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    vercelScope: process.env.VERCEL_SCOPE,
    vercelToken: process.env.VERCEL_TOKEN,
    expectedCommit: process.env.EXPECTED_MAIN_HEAD_COMMIT,
    receiptPath: process.env.PUBLIC_LOUNGE_RUNTIME_PREPARATION_RECEIPT_PATH,
    runtimeSecrets: Object.fromEntries(PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS.map((key) => [
      key,
      process.env[key],
    ])),
  };
}

export async function main(arguments_ = process.argv.slice(2)) {
  if (arguments_.includes("--self-test")) {
    const result = await runSelfTest();
    console.log(JSON.stringify(result));
    return result;
  }
  ensure(arguments_.includes("--required"), "PUBLIC_LOUNGE_RUNTIME_PREPARATION_REQUIRED_FLAG_MISSING");
  const receipt = await preparePublicLoungeRuntimeProduction(optionsFromEnvironment());
  console.log(JSON.stringify({
    status: receipt.status,
    target: receipt.target,
    interactionsEnabled: receipt.interactionsEnabled,
    failClosedVerified: receipt.failClosedVerified,
    runtimeSecretMetadataVerified: receipt.runtimeSecrets.metadataVerified,
    casCheckCount: receipt.casCheckCount,
    mutationCount: receipt.mutationCount,
    secretValuesStored: false,
  }));
  return receipt;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "public_lounge_runtime_preparation_failed",
      errorCode: safeErrorCode(error),
      secretValuesStored: false,
    }));
    process.exitCode = 1;
  });
}
