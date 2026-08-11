import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const MAIN_HEAD_LINE = /^([0-9a-f]{40})\trefs\/heads\/main$/u;

export const PRODUCTION_MAIN_HEAD_CAS_TIMEOUT_MS = 15_000;
export const PRODUCTION_MAIN_HEAD_CAS_MAX_BUFFER_BYTES = 1_024;
export const PRODUCTION_MAIN_HEAD_CAS_GIT_ARGUMENTS = Object.freeze([
  "ls-remote",
  "--heads",
  "origin",
  "refs/heads/main",
]);

export const PRODUCTION_MAIN_HEAD_CAS_CODES = Object.freeze({
  pass: "PASS",
  requiredFlagInvalid: "PRODUCTION_MAIN_HEAD_CAS_REQUIRED_FLAG_INVALID",
  expectedCommitInvalid: "PRODUCTION_MAIN_HEAD_CAS_EXPECTED_COMMIT_INVALID",
  remoteHeadMissing: "PRODUCTION_MAIN_HEAD_CAS_REMOTE_HEAD_MISSING",
  remoteHeadDuplicate: "PRODUCTION_MAIN_HEAD_CAS_REMOTE_HEAD_DUPLICATE",
  remoteOutputMalformed: "PRODUCTION_MAIN_HEAD_CAS_REMOTE_OUTPUT_MALFORMED",
  remoteHeadMoved: "PRODUCTION_MAIN_HEAD_CAS_REMOTE_HEAD_MOVED",
  lookupTimeout: "PRODUCTION_MAIN_HEAD_CAS_LOOKUP_TIMEOUT",
  lookupFailed: "PRODUCTION_MAIN_HEAD_CAS_LOOKUP_FAILED",
});

const SAFE_FAILURE_CODES = new Set(
  Object.values(PRODUCTION_MAIN_HEAD_CAS_CODES).filter(
    (code) => code !== PRODUCTION_MAIN_HEAD_CAS_CODES.pass,
  ),
);

function casError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeExpectedCommit(expectedCommit) {
  const normalized = typeof expectedCommit === "string"
    ? expectedCommit.trim().toLowerCase()
    : "";
  if (!FULL_COMMIT.test(normalized)) {
    throw casError(PRODUCTION_MAIN_HEAD_CAS_CODES.expectedCommitInvalid);
  }
  return normalized;
}

/**
 * Pure verification boundary for the exact output of:
 * `git ls-remote --heads origin refs/heads/main`.
 */
export function verifyProductionMainHeadCas(lsRemoteOutput, expectedCommit) {
  const expected = normalizeExpectedCommit(expectedCommit);
  if (typeof lsRemoteOutput !== "string") {
    throw casError(PRODUCTION_MAIN_HEAD_CAS_CODES.remoteOutputMalformed);
  }
  if (lsRemoteOutput.length === 0) {
    throw casError(PRODUCTION_MAIN_HEAD_CAS_CODES.remoteHeadMissing);
  }
  if (Buffer.byteLength(lsRemoteOutput, "utf8") > PRODUCTION_MAIN_HEAD_CAS_MAX_BUFFER_BYTES) {
    throw casError(PRODUCTION_MAIN_HEAD_CAS_CODES.remoteOutputMalformed);
  }

  const body = lsRemoteOutput.endsWith("\r\n")
    ? lsRemoteOutput.slice(0, -2)
    : lsRemoteOutput.endsWith("\n")
      ? lsRemoteOutput.slice(0, -1)
      : lsRemoteOutput;
  if (body.length === 0) {
    throw casError(PRODUCTION_MAIN_HEAD_CAS_CODES.remoteHeadMissing);
  }

  const lines = body.split(/\r?\n/u);
  if (lines.length !== 1) {
    if (lines.every((line) => MAIN_HEAD_LINE.test(line))) {
      throw casError(PRODUCTION_MAIN_HEAD_CAS_CODES.remoteHeadDuplicate);
    }
    throw casError(PRODUCTION_MAIN_HEAD_CAS_CODES.remoteOutputMalformed);
  }

  const match = MAIN_HEAD_LINE.exec(lines[0]);
  if (!match) {
    throw casError(PRODUCTION_MAIN_HEAD_CAS_CODES.remoteOutputMalformed);
  }
  if (match[1] !== expected) {
    throw casError(PRODUCTION_MAIN_HEAD_CAS_CODES.remoteHeadMoved);
  }
  return PRODUCTION_MAIN_HEAD_CAS_CODES.pass;
}

function safeCliFailureCode(error) {
  if (
    error
    && typeof error === "object"
    && (error.code === "ETIMEDOUT" || error.killed === true)
  ) {
    return PRODUCTION_MAIN_HEAD_CAS_CODES.lookupTimeout;
  }
  const code = error && typeof error === "object" ? error.code : null;
  return typeof code === "string" && SAFE_FAILURE_CODES.has(code)
    ? code
    : PRODUCTION_MAIN_HEAD_CAS_CODES.lookupFailed;
}

/**
 * Read-only, bounded remote CAS boundary. The command and all resource limits
 * stay fixed; the implementation hook exists only so callers can test failure
 * behavior without changing refs or contacting a remote.
 */
export function verifyRemoteProductionMainHeadCas(
  expectedCommit,
  { execFileSyncImplementation = execFileSync } = {},
) {
  const expected = normalizeExpectedCommit(expectedCommit);
  let remoteOutput;
  try {
    remoteOutput = execFileSyncImplementation(
      "git",
      PRODUCTION_MAIN_HEAD_CAS_GIT_ARGUMENTS,
      {
        encoding: "utf8",
        timeout: PRODUCTION_MAIN_HEAD_CAS_TIMEOUT_MS,
        maxBuffer: PRODUCTION_MAIN_HEAD_CAS_MAX_BUFFER_BYTES,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );
  } catch (error) {
    throw casError(safeCliFailureCode(error));
  }
  return verifyProductionMainHeadCas(remoteOutput, expected);
}

function main() {
  let result;
  try {
    result = verifyRemoteProductionMainHeadCas(
      process.env.EXPECTED_PRODUCT_COMMIT,
    );
  } catch (error) {
    result = safeCliFailureCode(error);
    process.exitCode = 1;
  }
  process.stdout.write(`${result}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) main();
