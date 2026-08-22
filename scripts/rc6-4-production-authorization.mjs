import { createHash } from "node:crypto";

export const RC6_4_PRODUCTION_AUTHORIZATION_SCHEMA =
  "p24b-rc6.5-production-authorization-v1";
export const RC6_4_NORMAL_PRODUCTION_AUTHORIZATION = "github-actions-main-sha";
export const RC6_4_RECOVERY_PRODUCTION_AUTHORIZATION = "immutable-product-recovery-control";

const SHA256 = /^[a-f0-9]{64}$/u;
const AUTHORIZATION_KEYS = Object.freeze([
  "schemaVersion",
  "mode",
  "productionAuthorizationProofDigest",
  "productionAuthorityProofDigest",
  "recoveryControl",
  "proofDigest",
]);
const RECOVERY_CONTROL_KEYS = Object.freeze(["proofDigest"]);

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function requireDigest(value, code) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
}

export function createRc64ProductionAuthorization({
  recovery = false,
  productionAuthorityProofDigest,
  recoveryControlProofDigest = null,
}) {
  const authorityDigest = requireDigest(
    productionAuthorityProofDigest,
    "RC6_5_PRODUCTION_AUTHORITY_PROOF_DIGEST_INVALID",
  );
  const normalizedRecoveryDigest = recoveryControlProofDigest == null
    || String(recoveryControlProofDigest).trim() === ""
    ? null
    : requireDigest(
        recoveryControlProofDigest,
        "RC6_4_RECOVERY_CONTROL_PROOF_DIGEST_INVALID",
      );
  if (recovery !== true && recovery !== false) {
    fail("RC6_4_PRODUCTION_AUTHORIZATION_MODE_INVALID");
  }
  if (recovery && !normalizedRecoveryDigest) {
    fail("RC6_4_RECOVERY_CONTROL_PROOF_DIGEST_REQUIRED");
  }
  if (!recovery && normalizedRecoveryDigest !== null) {
    fail("RC6_4_NORMAL_RELEASE_RECOVERY_CONTROL_FORBIDDEN");
  }
  const core = {
    schemaVersion: RC6_4_PRODUCTION_AUTHORIZATION_SCHEMA,
    mode: recovery
      ? RC6_4_RECOVERY_PRODUCTION_AUTHORIZATION
      : RC6_4_NORMAL_PRODUCTION_AUTHORIZATION,
    productionAuthorizationProofDigest: recovery
      ? normalizedRecoveryDigest
      : authorityDigest,
    productionAuthorityProofDigest: authorityDigest,
    recoveryControl: recovery
      ? { proofDigest: normalizedRecoveryDigest }
      : null,
  };
  return { ...core, proofDigest: digest(core) };
}

export function validateRc64ProductionAuthorization(value) {
  if (!exactKeys(value, AUTHORIZATION_KEYS)) {
    fail("RC6_4_PRODUCTION_AUTHORIZATION_SHAPE_INVALID");
  }
  const recovery = value.mode === RC6_4_RECOVERY_PRODUCTION_AUTHORIZATION;
  if (!recovery && value.mode !== RC6_4_NORMAL_PRODUCTION_AUTHORIZATION) {
    fail("RC6_4_PRODUCTION_AUTHORIZATION_MODE_INVALID");
  }
  if (value.recoveryControl !== null
    && !exactKeys(value.recoveryControl, RECOVERY_CONTROL_KEYS)) {
    fail("RC6_4_RECOVERY_CONTROL_SHAPE_INVALID");
  }
  const normalized = createRc64ProductionAuthorization({
    recovery,
    productionAuthorityProofDigest: value.productionAuthorityProofDigest,
    recoveryControlProofDigest: value.recoveryControl?.proofDigest ?? null,
  });
  if (value.productionAuthorizationProofDigest
      !== normalized.productionAuthorizationProofDigest
    || value.proofDigest !== normalized.proofDigest) {
    fail("RC6_4_PRODUCTION_AUTHORIZATION_DIGEST_MISMATCH");
  }
  return normalized;
}
