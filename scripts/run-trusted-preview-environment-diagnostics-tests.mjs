import assert from "node:assert/strict";
import {
  TRUSTED_PREVIEW_BRANCH,
  TRUSTED_PREVIEW_ENVIRONMENT_SPEC,
  VERCEL_SAFE_WRITE_FAILURE_CODES,
  analyzeTrustedPreviewEnvironmentMetadata,
  classifyVercelWriteFailure,
  diagnoseTrustedPreviewEnvironment,
  readTrustedPreviewEnvironmentDiagnosticMetadata,
  readTrustedPreviewProjectMetadata,
  readTrustedPreviewTeamMetadata,
  safeOperationFailure,
  safeVercelWriteFailureDetails,
} from "./bootstrap-trusted-preview-env.mjs";

const PREVIEW_TARGET = "preview";

function safeMetadataRecord(spec, overrides = {}) {
  const type = overrides.type ?? spec.type;
  const visibility = overrides.visibility
    ?? (spec.type === "sensitive" ? "secret" : "config");
  const effectiveProtection = overrides.effectiveProtection
    ?? (visibility === "secret" ? "secret" : visibility === "config" ? "config" : "unknown");
  return {
    key: spec.key,
    keySafe: true,
    type,
    visibility,
    effectiveProtection,
    targets: [PREVIEW_TARGET],
    customEnvironmentTargetCount: 0,
    branchScope: "expected",
    ...overrides,
  };
}

function safeMetadata(records = TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map(safeMetadataRecord)) {
  return {
    records,
    decryptedValuesRequested: false,
    environmentValuePropertiesAccessed: false,
    environmentValuesEmitted: false,
    environmentValuesPersisted: false,
  };
}

let opaqueValuePropertyAccessCount = 0;

function apiRecord(spec, overrides = {}, poison = "") {
  const record = {
    id: "env_fixture",
    key: spec.key,
    type: spec.type,
    visibility: spec.type === "sensitive" ? "secret" : "config",
    target: [PREVIEW_TARGET],
    gitBranch: TRUSTED_PREVIEW_BRANCH,
    ...overrides,
  };
  for (const property of ["value", "legacyValue", "vsmValue", "internalContentHint"]) {
    Object.defineProperty(record, property, {
      configurable: true,
      enumerable: true,
      get() {
        opaqueValuePropertyAccessCount += 1;
        throw new Error(`OPAQUE_VALUE_PROPERTY_ACCESSED:${poison}`);
      },
    });
  }
  return record;
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: { cancel: async () => undefined },
    json: async () => body,
  };
}

let passed = 0;
async function test(name, operation) {
  await operation();
  passed += 1;
  return name;
}

const fakeToken = ["vercel", "fixture", "token", "never", "emit"].join("_");
const fakePrivateKey = [
  "-----BEGIN ",
  ["PRIVATE", "KEY"].join(" "),
  "-----fixture-never-emit-----END ",
  ["PRIVATE", "KEY"].join(" "),
  "-----",
].join("");
const fakeSupabaseKey = ["sb", "secret", "fixture", "never", "emit"].join("_");
const fakeServerMessage = ["raw", "server", "message", "never", "emit"].join("_");
const poisons = [fakeToken, fakePrivateKey, fakeSupabaseKey, fakeServerMessage];

await test("complete metadata", async () => {
  const result = analyzeTrustedPreviewEnvironmentMetadata(safeMetadata());
  assert.equal(result.state, "complete");
  assert.equal(result.presentExpectedKeyCount, 11);
  assert.equal(result.matchingRecordCount, 11);
  assert.equal(result.partialWriteDetected, false);
  assert.equal(result.vercelBranchScopedMetadataObserved, true);
  assert.equal(result.vercelPreviewBranchScopedMetadataObserved, true);
});

await test("empty metadata", async () => {
  const result = analyzeTrustedPreviewEnvironmentMetadata(safeMetadata([]));
  assert.equal(result.state, "empty");
  assert.equal(result.presentExpectedKeyCount, 0);
  assert.equal(result.partialWriteDetected, false);
  assert.equal(result.vercelBranchScopedMetadataObserved, false);
  assert.equal(result.vercelPreviewBranchScopedMetadataObserved, false);
});

await test("partial metadata", async () => {
  const result = analyzeTrustedPreviewEnvironmentMetadata(safeMetadata([
    safeMetadataRecord(TRUSTED_PREVIEW_ENVIRONMENT_SPEC[0]),
  ]));
  assert.equal(result.state, "partial");
  assert.equal(result.presentExpectedKeyCount, 1);
  assert.equal(result.partialWriteDetected, true);
  assert.equal(result.missingExpectedKeys.length, 10);
});

await test("duplicate metadata", async () => {
  const records = TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map(safeMetadataRecord);
  records.push({ ...records[0] });
  const result = analyzeTrustedPreviewEnvironmentMetadata(safeMetadata(records));
  assert.equal(result.state, "drift");
  assert.deepEqual(result.duplicateExpectedKeys, [TRUSTED_PREVIEW_ENVIRONMENT_SPEC[0].key]);
  assert.equal(result.duplicateRecordsDetected, true);
});

await test("type and target drift", async () => {
  const records = TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map(safeMetadataRecord);
  records[0] = {
    ...records[0],
    type: "unknown",
    visibility: "secret",
    effectiveProtection: "secret",
    targets: ["production"],
  };
  const result = analyzeTrustedPreviewEnvironmentMetadata(safeMetadata(records));
  assert.equal(result.state, "drift");
  assert.deepEqual(result.typeDriftExpectedKeys, [TRUSTED_PREVIEW_ENVIRONMENT_SPEC[0].key]);
  assert.deepEqual(result.targetDriftExpectedKeys, [TRUSTED_PREVIEW_ENVIRONMENT_SPEC[0].key]);
});

await test("custom environment scope is counted and rejected as target drift", async () => {
  const records = TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map(safeMetadataRecord);
  records[0] = { ...records[0], customEnvironmentTargetCount: 1 };
  const result = analyzeTrustedPreviewEnvironmentMetadata(safeMetadata(records));
  assert.equal(result.state, "drift");
  assert.equal(result.matchingRecordCount, 10);
  assert.deepEqual(result.targetDriftExpectedKeys, [TRUSTED_PREVIEW_ENVIRONMENT_SPEC[0].key]);
  assert.equal(
    result.branchScopedEnvironmentVariables.find(
      ({ name }) => name === TRUSTED_PREVIEW_ENVIRONMENT_SPEC[0].key,
    )?.customEnvironmentTargetCount,
    1,
  );
});

await test("visibility is authoritative for sensitive metadata", async () => {
  const records = TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map(safeMetadataRecord);
  const sensitiveIndex = TRUSTED_PREVIEW_ENVIRONMENT_SPEC.findIndex((spec) => spec.type === "sensitive");
  records[sensitiveIndex] = {
    ...records[sensitiveIndex],
    type: "encrypted",
    visibility: "secret",
    effectiveProtection: "secret",
  };
  const result = analyzeTrustedPreviewEnvironmentMetadata(safeMetadata(records));
  assert.equal(result.state, "complete");
  assert.deepEqual(result.typeDriftExpectedKeys, []);
});

await test("wrong and unscoped branch drift", async () => {
  const records = TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map(safeMetadataRecord);
  records[0] = { ...records[0], branchScope: "other" };
  records[1] = { ...records[1], branchScope: "unscoped" };
  const result = analyzeTrustedPreviewEnvironmentMetadata(safeMetadata(records));
  assert.equal(result.state, "drift");
  assert.equal(result.branchDriftDetected, true);
  assert.deepEqual(result.wrongBranchExpectedKeys, [TRUSTED_PREVIEW_ENVIRONMENT_SPEC[0].key]);
  assert.deepEqual(result.unscopedExpectedKeys, [TRUSTED_PREVIEW_ENVIRONMENT_SPEC[1].key]);
});

await test("GET-only diagnosis and poison stripping", async () => {
  opaqueValuePropertyAccessCount = 0;
  const requests = [];
  const guardedEnvironment = new Proxy({
    VERCEL_PROJECT_ID: "prj_fixture",
    VERCEL_ORG_ID: "team_fixture",
    VERCEL_TOKEN: fakeToken,
    GITHUB_REPOSITORY: "bobobo-org/novel",
    GITHUB_REF: `refs/heads/${TRUSTED_PREVIEW_BRANCH}`,
  }, {
    get(target, property) {
      const name = String(property);
      if (name.startsWith("PREVIEW_") || name.startsWith("SUPABASE_")) {
        throw new Error("SOURCE_SECRET_READ_FORBIDDEN");
      }
      return Reflect.get(target, property);
    },
  });
  let mutationCount = 0;
  const fetcher = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method, body: init.body });
    const pathname = new URL(url).pathname;
    if (pathname.startsWith("/v2/teams/")) return response({ id: "team_fixture" });
    if (pathname === "/v9/projects/prj_fixture") {
      const project = {
        id: "prj_fixture",
        name: "novel",
        accountId: "team_fixture",
        link: {
          type: "github",
          org: "bobobo-org",
          repo: "novel",
          productionBranch: "main",
        },
      };
      Object.defineProperty(project, "env", {
        enumerable: true,
        get() {
          opaqueValuePropertyAccessCount += 1;
          throw new Error(`PROJECT_ENV_PROPERTY_ACCESSED:${fakePrivateKey}`);
        },
      });
      return response(project);
    }
    if (pathname === "/v10/projects/prj_fixture/env") {
      return response({
        envs: TRUSTED_PREVIEW_ENVIRONMENT_SPEC.map((spec, index) => (
          apiRecord(spec, {}, poisons[index % poisons.length])
        )),
      });
    }
    throw new Error("UNEXPECTED_REQUEST");
  };
  const diagnosis = await diagnoseTrustedPreviewEnvironment({ environment: guardedEnvironment }, {
    fetcher,
    writeValue: () => { mutationCount += 1; },
    supabaseWrite: () => { mutationCount += 1; },
  });
  assert.equal(diagnosis.status, "complete");
  assert.equal(diagnosis.readOnly, true);
  assert.equal(diagnosis.mutationCount, 0);
  assert.equal(mutationCount, 0);
  assert.equal(diagnosis.requestCount, 3);
  assert.deepEqual(diagnosis.requestMethods, ["GET"]);
  assert.equal(diagnosis.sourceConfigurationRead, false);
  assert.equal(diagnosis.supabaseAccessed, false);
  assert.equal(diagnosis.environmentValuePropertiesAccessed, false);
  assert.equal(diagnosis.branchTarget.eligibleByReadOnlyEvidence, true);
  assert.equal(diagnosis.branchTarget.vercelBranchScopedMetadataObserved, true);
  assert.equal(diagnosis.branchTarget.vercelPreviewBranchScopedMetadataObserved, true);
  assert.equal(diagnosis.branchTarget.vercelBranchExistenceDirectlyVerified, false);
  assert.equal(diagnosis.branchTarget.valid, true);
  assert.ok(requests.every(({ method, body }) => method === "GET" && body == null));
  assert.ok(requests.every(({ url }) => new URL(url).origin === "https://api.vercel.com"));
  const environmentRequest = requests.find(({ url }) => new URL(url).pathname.endsWith("/env"));
  assert.equal(new URL(environmentRequest.url).searchParams.get("decrypt"), "false");
  assert.equal(new URL(environmentRequest.url).searchParams.has("target"), false);
  assert.equal(new URL(environmentRequest.url).searchParams.has("gitBranch"), false);
  assert.equal(opaqueValuePropertyAccessCount, 0);
  const serialized = JSON.stringify(diagnosis);
  for (const poison of poisons) assert.equal(serialized.includes(poison), false);
  assert.equal(/authorization/iu.test(serialized), false);
});

await test("unobserved Vercel branch is not reported as directly valid", async () => {
  const result = await diagnoseTrustedPreviewEnvironment({
    environment: {
      VERCEL_PROJECT_ID: "prj_fixture",
      VERCEL_ORG_ID: "team_fixture",
      VERCEL_TOKEN: fakeToken,
      GITHUB_REPOSITORY: "bobobo-org/novel",
      GITHUB_REF: `refs/heads/${TRUSTED_PREVIEW_BRANCH}`,
    },
  }, {
    readTeam: async () => ({ readable: true, teamIdMatches: true }),
    readProject: async () => ({
      readable: true,
      projectIdMatches: true,
      teamIdMatches: true,
      gitRepositoryLinked: true,
      gitProvider: "github",
      repositoryMatchesExpected: true,
      productionBranchIsMain: true,
    }),
    readMetadata: async () => safeMetadata([]),
  });
  assert.equal(result.status, "empty");
  assert.equal(result.branchTarget.eligibleByReadOnlyEvidence, true);
  assert.equal(result.branchTarget.vercelBranchScopedMetadataObserved, false);
  assert.equal(result.branchTarget.vercelPreviewBranchScopedMetadataObserved, false);
  assert.equal(result.branchTarget.valid, false);
});

await test("project name identifiers and default main branch are normalized safely", async () => {
  const project = await readTrustedPreviewProjectMetadata({
    token: fakeToken,
    teamId: "team_fixture",
    projectId: "novel-preview",
    fetcher: async () => response({
      id: "prj_fixture",
      name: "novel-preview",
      accountId: "team_fixture",
      link: {
        type: "github",
        org: "bobobo-org",
        repo: "novel",
        productionBranch: "",
      },
    }),
  });
  assert.equal(project.projectIdMatches, true);
  assert.equal(project.productionBranchIsMain, true);
  assert.equal(project.repositoryMatchesExpected, true);
});

await test("project linkage drift is boolean-only", async () => {
  const result = await diagnoseTrustedPreviewEnvironment({
    environment: {
      VERCEL_PROJECT_ID: "prj_fixture",
      VERCEL_ORG_ID: "team_fixture",
      VERCEL_TOKEN: fakeToken,
      GITHUB_REPOSITORY: "bobobo-org/novel",
      GITHUB_REF: `refs/heads/${TRUSTED_PREVIEW_BRANCH}`,
    },
  }, {
    readTeam: async () => ({ readable: true, teamIdMatches: true }),
    readProject: async () => ({
      readable: true,
      projectIdMatches: true,
      teamIdMatches: true,
      gitRepositoryLinked: false,
      gitProvider: "none",
      repositoryMatchesExpected: false,
      productionBranchIsMain: false,
    }),
    readMetadata: async () => safeMetadata(),
  });
  assert.equal(result.status, "linkage-drift");
  assert.equal(result.branchTarget.valid, false);
  for (const poison of poisons) assert.equal(JSON.stringify(result).includes(poison), false);
});

await test("unsafe remote environment names are redacted", async () => {
  const metadata = await readTrustedPreviewEnvironmentDiagnosticMetadata({
    token: fakeToken,
    teamId: "team_fixture",
    projectId: "prj_fixture",
    fetcher: async () => response({
      envs: [apiRecord(
        TRUSTED_PREVIEW_ENVIRONMENT_SPEC[0],
        { key: `unsafe-${fakeSupabaseKey}`, type: `type-${fakeServerMessage}` },
        fakePrivateKey,
      )],
    }),
  });
  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes(fakeSupabaseKey), false);
  assert.equal(serialized.includes(fakeServerMessage), false);
  assert.equal(serialized.includes(fakePrivateKey), false);
  assert.equal(metadata.records[0].key, "UNSAFE_NAME_REDACTED");
  assert.equal(metadata.records[0].type, "unknown");
});

await test("HTTP failure does not parse or relay error body", async () => {
  let parsed = false;
  await assert.rejects(
    readTrustedPreviewTeamMetadata({
      token: fakeToken,
      teamId: "team_fixture",
      fetcher: async () => ({
        ...response(null, 403),
        json: async () => {
          parsed = true;
          return { error: { message: fakeServerMessage, token: fakeToken } };
        },
      }),
    }),
    (error) => {
      const safe = JSON.stringify(safeOperationFailure(error));
      assert.equal(error?.code, "TRUSTED_PREVIEW_DIAG_ACCESS_FORBIDDEN");
      assert.equal(parsed, false);
      for (const poison of poisons) assert.equal(safe.includes(poison), false);
      return true;
    },
  );
});

const writerClassifications = [
  ["VERCEL_AUTH_FORBIDDEN", "403 forbidden"],
  ["VERCEL_PROJECT_NOT_LINKED", "Project is not linked"],
  ["VERCEL_BRANCH_NOT_FOUND", "Git branch was not found"],
  ["VERCEL_POLICY_REQUIRES_SENSITIVE", "Policy requires this variable to be sensitive"],
  ["VERCEL_ENV_TYPE_REJECTED", "Invalid environment variable type"],
  ["VERCEL_INVALID_ARGUMENT", "Unknown option was provided"],
  ["VERCEL_API_ERROR", "Vercel API error 500"],
  ["VERCEL_UNKNOWN_SAFE_FAILURE", fakeServerMessage],
];

await test("safe writer classifications", async () => {
  assert.deepEqual(writerClassifications.map(([expected, stderr]) => [
    expected,
    classifyVercelWriteFailure({ status: 1, stderr }),
  ]), writerClassifications.map(([expected]) => [expected, expected]));
  assert.deepEqual(VERCEL_SAFE_WRITE_FAILURE_CODES, writerClassifications.map(([expected]) => expected));
});

await test("writer failure details cannot leak child output", async () => {
  const details = safeVercelWriteFailureDetails({
    spec: TRUSTED_PREVIEW_ENVIRONMENT_SPEC[3],
    result: {
      status: 1,
      signal: fakeToken,
      stdout: `${fakeToken}${fakePrivateKey}`,
      stderr: `${fakeSupabaseKey}${fakeServerMessage}`,
      error: { message: fakePrivateKey, code: fakeSupabaseKey },
    },
  });
  assert.equal(details.variableName, TRUSTED_PREVIEW_ENVIRONMENT_SPEC[3].key);
  assert.equal(details.variableIndex, 4);
  assert.equal(details.variableCount, 11);
  assert.equal(details.childStatus, 1);
  assert.equal(details.childSignal, null);
  assert.equal(details.errorCode, "VERCEL_UNKNOWN_SAFE_FAILURE");
  const safe = safeOperationFailure({ code: details.errorCode, safeDetails: details });
  for (const poison of poisons) assert.equal(JSON.stringify(safe).includes(poison), false);
});

await test("unknown top-level error is not relayed", async () => {
  const safe = safeOperationFailure({
    code: `UNKNOWN_${fakeToken}`,
    message: `${fakePrivateKey}${fakeSupabaseKey}${fakeServerMessage}`,
    stack: poisons.join("\n"),
  });
  assert.equal(safe.errorCode, "TRUSTED_PREVIEW_ENVIRONMENT_OPERATION_FAILED");
  const serialized = JSON.stringify(safe);
  for (const poison of poisons) assert.equal(serialized.includes(poison), false);
});

console.log(JSON.stringify({
  status: "trusted_preview_environment_diagnostics_tests_passed",
  passed,
  total: passed,
  readOnly: true,
  mutationCount: 0,
  rawSecretsIncluded: false,
}));
