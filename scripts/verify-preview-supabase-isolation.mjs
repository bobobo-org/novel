import assert from "node:assert/strict";
import crypto from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION } from "../local-ai/private-hub/public-lounge-attestation-producer.mjs";
import { trustedPreviewConfigurationFromEnvironment } from "./bootstrap-trusted-preview-env.mjs";

const PRODUCTION_ENV_FILE = resolve(".vercel/.env.production.local");
const PREVIEW_ENV_FILE = resolve(".vercel/.env.preview.local");
const PREVIEW_AUDIENCE = "novel-public-lounge:preview";
const SUPABASE_PROJECT_HOST = /^([a-z0-9]{8,32})\.supabase\.co$/u;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const KEY_ID = /^[A-Za-z0-9._-]{1,120}$/u;
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/u;
const fakeSupabaseSecretKey = (label) => ["sb", "secret", label, "fixture_only_0123456789"].join("_");
const VERCEL_SENSITIVE_PLACEHOLDER = "[SENSITIVE]";

class PreviewIsolationError extends Error {
  constructor(code) {
    super(code);
    this.name = "PreviewIsolationError";
    this.code = code;
  }
}

function fail(code) {
  throw new PreviewIsolationError(code);
}

export function parsePreviewIsolationEnvFile(source, label = "ENV") {
  const parsed = {};
  for (const rawLine of String(source).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const separator = withoutExport.indexOf("=");
    if (separator < 1) fail(`${label}_ENV_LINE_INVALID`);
    const key = withoutExport.slice(0, separator).trim();
    if (!ENV_KEY.test(key)) fail(`${label}_ENV_KEY_INVALID`);
    if (Object.hasOwn(parsed, key)) fail(`${label}_ENV_KEY_DUPLICATED`);
    let value = withoutExport.slice(separator + 1).trim();
    if (value.startsWith('"')) {
      if (!value.endsWith('"')) fail(`${label}_ENV_VALUE_INVALID`);
      try {
        value = JSON.parse(value);
      } catch {
        fail(`${label}_ENV_VALUE_INVALID`);
      }
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'")) fail(`${label}_ENV_VALUE_INVALID`);
      value = value.slice(1, -1);
    }
    parsed[key] = String(value);
  }
  return parsed;
}

function requiredValue(environment, key, label) {
  const value = String(environment[key] ?? "").trim();
  if (!value) fail(`${label}_${key}_MISSING`);
  return value;
}

function supabaseIdentity(rawUrl, label) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`${label}_SUPABASE_URL_INVALID`);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) fail(`${label}_SUPABASE_URL_INVALID`);
  const match = SUPABASE_PROJECT_HOST.exec(url.hostname);
  if (!match) fail(`${label}_SUPABASE_PROJECT_REF_UNAVAILABLE`);
  return Object.freeze({ origin: url.origin, host: url.hostname, projectRef: match[1] });
}

function environmentSupabaseIdentity(environment, label) {
  const publicUrl = requiredValue(environment, "NEXT_PUBLIC_SUPABASE_URL", label);
  const identity = supabaseIdentity(publicUrl, label);
  const serverUrl = String(environment.SUPABASE_URL ?? "").trim();
  if (serverUrl) {
    const serverIdentity = supabaseIdentity(serverUrl, label);
    if (serverIdentity.origin !== identity.origin || serverIdentity.projectRef !== identity.projectRef) {
      fail(`${label}_SUPABASE_URLS_MISMATCH`);
    }
  }
  return identity;
}

function ed25519PublicKeyFingerprint(pem, label) {
  if (/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/u.test(pem)) {
    fail(`${label}_ATTESTATION_PUBLIC_KEY_INVALID`);
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(pem);
  } catch {
    fail(`${label}_ATTESTATION_PUBLIC_KEY_INVALID`);
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    fail(`${label}_ATTESTATION_PUBLIC_KEY_NOT_ED25519`);
  }
  return crypto.createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
}

function assertBase64Url32ByteSecret(environment, key, label = "PREVIEW") {
  const encoded = requiredValue(environment, key, label);
  if (!BASE64URL_32_BYTES.test(encoded)) fail(`${label}_${key}_INVALID`);
  let decoded;
  try {
    decoded = Buffer.from(encoded, "base64url");
  } catch {
    fail(`${label}_${key}_INVALID`);
  }
  if (decoded.length !== 32 || decoded.toString("base64url") !== encoded) {
    fail(`${label}_${key}_INVALID`);
  }
}

function productionAttestationTrust(production, previewFingerprint, previewKeyId) {
  const productionPem = String(production.PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY ?? "").trim();
  const productionKeyId = String(production.PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID ?? "").trim();
  if (!productionPem && !productionKeyId) {
    // The current Production release may intentionally have no v5 trust root.
    // That state cannot verify any v5 attestation, so it remains fail-closed;
    // it must not be reported as proof that the two trust roots are separated.
    return "not_configured_fail_closed";
  }
  if (!productionPem || !productionKeyId) fail("PRODUCTION_ATTESTATION_TRUST_PARTIAL");
  if (!KEY_ID.test(productionKeyId)) fail("PRODUCTION_ATTESTATION_KEY_ID_INVALID");
  const productionFingerprint = ed25519PublicKeyFingerprint(productionPem, "PRODUCTION");
  if (productionFingerprint === previewFingerprint) {
    fail("PREVIEW_ATTESTATION_PUBLIC_KEY_NOT_ISOLATED");
  }
  if (productionKeyId === previewKeyId) fail("PREVIEW_ATTESTATION_KEY_ID_NOT_ISOLATED");
  return "configured_and_separated";
}

export function verifyPreviewSupabaseIsolation({ production, preview }) {
  const productionIdentity = environmentSupabaseIdentity(production, "PRODUCTION");
  const previewIdentity = environmentSupabaseIdentity(preview, "PREVIEW");
  if (
    previewIdentity.host === productionIdentity.host
    || previewIdentity.projectRef === productionIdentity.projectRef
  ) fail("PREVIEW_SUPABASE_PROJECT_NOT_ISOLATED");

  const productionAnonKey = requiredValue(production, "NEXT_PUBLIC_SUPABASE_ANON_KEY", "PRODUCTION");
  const productionServiceRole = requiredValue(production, "SUPABASE_SERVICE_ROLE_KEY", "PRODUCTION");
  const previewAnonKey = requiredValue(preview, "NEXT_PUBLIC_SUPABASE_ANON_KEY", "PREVIEW");
  const previewServiceRole = requiredValue(preview, "SUPABASE_SERVICE_ROLE_KEY", "PREVIEW");
  if (previewAnonKey === productionAnonKey) fail("PREVIEW_SUPABASE_ANON_KEY_NOT_ISOLATED");
  if (previewServiceRole === productionServiceRole) fail("PREVIEW_SUPABASE_SERVICE_ROLE_NOT_ISOLATED");
  if (previewServiceRole === previewAnonKey) fail("PREVIEW_SUPABASE_CREDENTIAL_ROLES_COLLIDE");

  const publicKeyPem = requiredValue(
    preview,
    "PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY",
    "PREVIEW",
  );
  const previewFingerprint = ed25519PublicKeyFingerprint(publicKeyPem, "PREVIEW");
  const keyId = requiredValue(preview, "PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID", "PREVIEW");
  if (!KEY_ID.test(keyId)) fail("PREVIEW_ATTESTATION_KEY_ID_INVALID");
  const productionAttestationTrustState = productionAttestationTrust(
    production,
    previewFingerprint,
    keyId,
  );
  if (requiredValue(preview, "PUBLIC_LOUNGE_ATTESTATION_ENVIRONMENT", "PREVIEW") !== "preview") {
    fail("PREVIEW_ATTESTATION_ENVIRONMENT_INVALID");
  }
  if (requiredValue(preview, "PUBLIC_LOUNGE_ATTESTATION_AUDIENCE", "PREVIEW") !== PREVIEW_AUDIENCE) {
    fail("PREVIEW_ATTESTATION_AUDIENCE_INVALID");
  }
  if (
    requiredValue(preview, "PUBLIC_LOUNGE_ATTESTATION_PRODUCER_VERSION", "PREVIEW")
    !== PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION
  ) fail("PREVIEW_ATTESTATION_PRODUCER_VERSION_INVALID");

  assertBase64Url32ByteSecret(preview, "PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY");
  assertBase64Url32ByteSecret(preview, "PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY");

  const interactionsEnabled = String(preview.PUBLIC_LOUNGE_INTERACTIONS_ENABLED ?? "").trim().toLowerCase();
  if (interactionsEnabled && interactionsEnabled !== "0" && interactionsEnabled !== "false") {
    fail("PREVIEW_INTERACTIONS_ACTIVATION_FORBIDDEN");
  }
  if (String(preview.PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION ?? "").trim()) {
    fail("PREVIEW_INTERACTIONS_ACTIVATION_FORBIDDEN");
  }

  return Object.freeze({
    previewProjectRef: previewIdentity.projectRef,
    previewSupabaseIsolated: true,
    previewAttestationVerifierReady: true,
    productionAttestationTrustState,
    attestationTrustRootsSeparated: productionAttestationTrustState === "configured_and_separated",
    interactionsActivationEnabled: false,
  });
}

async function readEnvironmentPair(productionFile, previewFile) {
  let productionSource;
  let previewSource;
  try {
    [productionSource, previewSource] = await Promise.all([
      readFile(productionFile, "utf8"),
      readFile(previewFile, "utf8"),
    ]);
  } catch {
    fail("PREVIEW_ISOLATION_ENV_FILES_MISSING");
  }
  return {
    production: parsePreviewIsolationEnvFile(productionSource, "PRODUCTION"),
    preview: parsePreviewIsolationEnvFile(previewSource, "PREVIEW"),
  };
}

function sameEd25519PublicKey(left, right) {
  return ed25519PublicKeyFingerprint(left, "PREVIEW_VERCEL")
    === ed25519PublicKeyFingerprint(right, "PREVIEW_GITHUB");
}

function sensitiveValueAvailable(value) {
  const normalized = String(value ?? "").trim();
  return Boolean(normalized && normalized !== VERCEL_SENSITIVE_PLACEHOLDER);
}

export function overlayGithubPreviewConfiguration(pair, environment = process.env) {
  const configuration = trustedPreviewConfigurationFromEnvironment(environment);
  const pulled = pair.preview;
  const expected = configuration.values;
  const exactPublicKeys = [
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID",
    "PUBLIC_LOUNGE_ATTESTATION_ENVIRONMENT",
    "PUBLIC_LOUNGE_ATTESTATION_AUDIENCE",
    "PUBLIC_LOUNGE_ATTESTATION_PRODUCER_VERSION",
    "PUBLIC_LOUNGE_INTERACTIONS_ENABLED",
  ];
  for (const key of exactPublicKeys) {
    if (String(pulled[key] ?? "").trim() !== expected[key]) {
      fail(`PREVIEW_VERCEL_${key}_DRIFT`);
    }
  }
  if (
    supabaseIdentity(requiredValue(pulled, "NEXT_PUBLIC_SUPABASE_URL", "PREVIEW_VERCEL"), "PREVIEW_VERCEL").origin
    !== supabaseIdentity(expected.NEXT_PUBLIC_SUPABASE_URL, "PREVIEW_GITHUB").origin
  ) fail("PREVIEW_VERCEL_NEXT_PUBLIC_SUPABASE_URL_DRIFT");
  if (!sameEd25519PublicKey(
    requiredValue(pulled, "PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY", "PREVIEW_VERCEL"),
    expected.PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY,
  )) fail("PREVIEW_VERCEL_ATTESTATION_PUBLIC_KEY_DRIFT");
  for (const key of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY",
    "PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY",
  ]) {
    if (sensitiveValueAvailable(pulled[key]) && String(pulled[key]).trim() !== expected[key]) {
      fail(`PREVIEW_VERCEL_${key}_DRIFT`);
    }
  }
  return {
    production: pair.production,
    preview: { ...pulled, ...expected },
  };
}

function serializeEnvironment(environment) {
  return `${Object.entries(environment).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`;
}

function fakeEnvironmentPair(publicKeyPem, productionPublicKeyPem) {
  return {
    production: {
      NEXT_PUBLIC_SUPABASE_URL: "https://productionref000001.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-production-anon-key-with-isolated-material",
      SUPABASE_SERVICE_ROLE_KEY: "test-production-service-role-with-isolated-material",
      PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY: productionPublicKeyPem,
      PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID: "novel-pl-production-self-test",
    },
    preview: {
      NEXT_PUBLIC_SUPABASE_URL: "https://previewref000000001.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-preview-anon-key-with-isolated-material",
      SUPABASE_SERVICE_ROLE_KEY: "test-preview-service-role-with-isolated-material",
      PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY: publicKeyPem,
      PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID: "novel-pl-preview-self-test",
      PUBLIC_LOUNGE_ATTESTATION_ENVIRONMENT: "preview",
      PUBLIC_LOUNGE_ATTESTATION_AUDIENCE: PREVIEW_AUDIENCE,
      PUBLIC_LOUNGE_ATTESTATION_PRODUCER_VERSION: PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION,
      PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64url"),
      PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY: Buffer.alloc(32, 12).toString("base64url"),
      PUBLIC_LOUNGE_INTERACTIONS_ENABLED: "0",
    },
  };
}

async function runSelfTest() {
  const directory = await mkdtemp(join(tmpdir(), "novel-preview-isolation-"));
  const productionFile = join(directory, ".env.production.local");
  const previewFile = join(directory, ".env.preview.local");
  const ed25519 = crypto.generateKeyPairSync("ed25519").publicKey
    .export({ type: "spki", format: "pem" }).toString();
  const productionEd25519 = crypto.generateKeyPairSync("ed25519").publicKey
    .export({ type: "spki", format: "pem" }).toString();
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey
    .export({ type: "spki", format: "pem" }).toString();
  let passed = 0;
  const cases = 23;
  const expectFailure = async (pair, code) => {
    await writeFile(productionFile, serializeEnvironment(pair.production), "utf8");
    await writeFile(previewFile, serializeEnvironment(pair.preview), "utf8");
    const environments = await readEnvironmentPair(productionFile, previewFile);
    assert.throws(
      () => verifyPreviewSupabaseIsolation(environments),
      (error) => error?.code === code,
    );
    passed += 1;
  };
  try {
    const valid = fakeEnvironmentPair(ed25519, productionEd25519);
    await writeFile(productionFile, serializeEnvironment(valid.production), "utf8");
    await writeFile(previewFile, serializeEnvironment(valid.preview), "utf8");
    const verified = verifyPreviewSupabaseIsolation(await readEnvironmentPair(productionFile, previewFile));
    assert.equal(verified.previewSupabaseIsolated, true);
    assert.equal(verified.previewAttestationVerifierReady, true);
    assert.equal(verified.productionAttestationTrustState, "configured_and_separated");
    assert.equal(verified.attestationTrustRootsSeparated, true);
    passed += 1;

    const productionUnconfigured = {
      ...valid.production,
      PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY: "",
      PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID: "",
    };
    const legacyVerified = verifyPreviewSupabaseIsolation({
      production: productionUnconfigured,
      preview: valid.preview,
    });
    assert.equal(legacyVerified.productionAttestationTrustState, "not_configured_fail_closed");
    assert.equal(legacyVerified.attestationTrustRootsSeparated, false);
    passed += 1;

    const githubPreviewEnvironment = {
      PREVIEW_SUPABASE_URL: valid.preview.NEXT_PUBLIC_SUPABASE_URL,
      PREVIEW_SUPABASE_ANON_KEY: valid.preview.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      PREVIEW_SUPABASE_SERVICE_ROLE_KEY: fakeSupabaseSecretKey("preview"),
      PREVIEW_PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY:
        valid.preview.PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY,
      PREVIEW_PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY:
        valid.preview.PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY,
      PREVIEW_PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY:
        valid.preview.PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY,
      PREVIEW_PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID:
        valid.preview.PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID,
    };
    const pulledWithSensitivePlaceholders = {
      production: valid.production,
      preview: {
        ...valid.preview,
        SUPABASE_SERVICE_ROLE_KEY: VERCEL_SENSITIVE_PLACEHOLDER,
        PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY: VERCEL_SENSITIVE_PLACEHOLDER,
        PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY: VERCEL_SENSITIVE_PLACEHOLDER,
      },
    };
    const overlaid = overlayGithubPreviewConfiguration(
      pulledWithSensitivePlaceholders,
      githubPreviewEnvironment,
    );
    assert.equal(
      overlaid.preview.SUPABASE_SERVICE_ROLE_KEY,
      githubPreviewEnvironment.PREVIEW_SUPABASE_SERVICE_ROLE_KEY,
    );
    assert.equal(verifyPreviewSupabaseIsolation(overlaid).previewSupabaseIsolated, true);
    passed += 1;
    assert.throws(
      () => overlayGithubPreviewConfiguration({
        ...pulledWithSensitivePlaceholders,
        preview: {
          ...pulledWithSensitivePlaceholders.preview,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "drifted-preview-anon-key",
        },
      }, githubPreviewEnvironment),
      (error) => error?.code === "PREVIEW_VERCEL_NEXT_PUBLIC_SUPABASE_ANON_KEY_DRIFT",
    );
    passed += 1;
    assert.throws(
      () => overlayGithubPreviewConfiguration({
        ...pulledWithSensitivePlaceholders,
        preview: {
          ...pulledWithSensitivePlaceholders.preview,
          SUPABASE_SERVICE_ROLE_KEY: fakeSupabaseSecretKey("drifted"),
        },
      }, githubPreviewEnvironment),
      (error) => error?.code === "PREVIEW_VERCEL_SUPABASE_SERVICE_ROLE_KEY_DRIFT",
    );
    passed += 1;
    const missingGithubSecret = { ...githubPreviewEnvironment };
    delete missingGithubSecret.PREVIEW_SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(
      () => overlayGithubPreviewConfiguration(pulledWithSensitivePlaceholders, missingGithubSecret),
      (error) => error?.code
        === "TRUSTED_PREVIEW_SOURCE_PREVIEW_SUPABASE_SERVICE_ROLE_KEY_MISSING",
    );
    passed += 1;

    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, NEXT_PUBLIC_SUPABASE_URL: valid.production.NEXT_PUBLIC_SUPABASE_URL },
    }, "PREVIEW_SUPABASE_PROJECT_NOT_ISOLATED");
    const missing = { ...valid.preview };
    delete missing.SUPABASE_SERVICE_ROLE_KEY;
    await expectFailure({ production: valid.production, preview: missing }, "PREVIEW_SUPABASE_SERVICE_ROLE_KEY_MISSING");
    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY: rsa },
    }, "PREVIEW_ATTESTATION_PUBLIC_KEY_NOT_ED25519");
    await expectFailure({
      production: {
        ...valid.production,
        // The same key with different PEM line endings must still collide by
        // SPKI fingerprint rather than evade the gate as a different string.
        PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY:
          valid.preview.PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY.replaceAll("\n", "\r\n"),
      },
      preview: valid.preview,
    }, "PREVIEW_ATTESTATION_PUBLIC_KEY_NOT_ISOLATED");
    await expectFailure({
      production: {
        ...valid.production,
        PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID: valid.preview.PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID,
      },
      preview: valid.preview,
    }, "PREVIEW_ATTESTATION_KEY_ID_NOT_ISOLATED");
    await expectFailure({
      production: {
        ...valid.production,
        PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID: "",
      },
      preview: valid.preview,
    }, "PRODUCTION_ATTESTATION_TRUST_PARTIAL");
    await expectFailure({
      production: {
        ...valid.production,
        PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY: rsa,
      },
      preview: valid.preview,
    }, "PRODUCTION_ATTESTATION_PUBLIC_KEY_NOT_ED25519");
    await expectFailure({
      production: {
        ...valid.production,
        PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID: "invalid key id",
      },
      preview: valid.preview,
    }, "PRODUCTION_ATTESTATION_KEY_ID_INVALID");
    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, NEXT_PUBLIC_SUPABASE_ANON_KEY: valid.production.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    }, "PREVIEW_SUPABASE_ANON_KEY_NOT_ISOLATED");
    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, SUPABASE_SERVICE_ROLE_KEY: valid.production.SUPABASE_SERVICE_ROLE_KEY },
    }, "PREVIEW_SUPABASE_SERVICE_ROLE_NOT_ISOLATED");
    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID: "invalid key id" },
    }, "PREVIEW_ATTESTATION_KEY_ID_INVALID");
    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, PUBLIC_LOUNGE_ATTESTATION_ENVIRONMENT: "production" },
    }, "PREVIEW_ATTESTATION_ENVIRONMENT_INVALID");
    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, PUBLIC_LOUNGE_ATTESTATION_AUDIENCE: "novel-public-lounge:production" },
    }, "PREVIEW_ATTESTATION_AUDIENCE_INVALID");
    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, PUBLIC_LOUNGE_ATTESTATION_PRODUCER_VERSION: "retired-producer" },
    }, "PREVIEW_ATTESTATION_PRODUCER_VERSION_INVALID");
    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY: "" },
    }, "PREVIEW_PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY_MISSING");
    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY: "not-a-32-byte-key" },
    }, "PREVIEW_PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY_INVALID");
    await expectFailure({
      production: valid.production,
      preview: { ...valid.preview, PUBLIC_LOUNGE_INTERACTIONS_ENABLED: "1" },
    }, "PREVIEW_INTERACTIONS_ACTIVATION_FORBIDDEN");
    assert.equal(passed, cases);
    console.log(`PREVIEW_SUPABASE_ISOLATION_SELF_TEST_PASS ${passed}/${cases}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") {
    await runSelfTest();
    return;
  }
  const githubPreviewSecretsRequired = args.length === 1
    && args[0] === "--github-preview-secrets-required";
  if (args.length > 0 && !githubPreviewSecretsRequired) fail("PREVIEW_ISOLATION_ARGUMENT_INVALID");
  const pair = await readEnvironmentPair(PRODUCTION_ENV_FILE, PREVIEW_ENV_FILE);
  const verified = verifyPreviewSupabaseIsolation(
    githubPreviewSecretsRequired ? overlayGithubPreviewConfiguration(pair) : pair,
  );
  let githubOutputWritten = false;
  const githubOutput = String(process.env.GITHUB_OUTPUT ?? "").trim();
  if (githubOutput) {
    console.log(`::add-mask::${verified.previewProjectRef}`);
    await appendFile(githubOutput, `preview_project_ref=${verified.previewProjectRef}\n`, "utf8");
    githubOutputWritten = true;
  }
  console.log(JSON.stringify({
    status: "preview_supabase_isolation_verified",
    previewSupabaseIsolated: true,
    storageBoundary: "separate_supabase_project",
    previewAttestationVerifierReady: true,
    publicKeyAlgorithm: "Ed25519",
    productionAttestationTrustState: verified.productionAttestationTrustState,
    attestationTrustRootsSeparated: verified.attestationTrustRootsSeparated,
    runtimeSecretsValidated: true,
    interactionsActivationEnabled: false,
    githubOutputWritten,
  }));
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "preview_supabase_isolation_failed",
      errorCode: String(error?.code || "PREVIEW_SUPABASE_ISOLATION_FAILED"),
    }));
    process.exitCode = 1;
  });
}
