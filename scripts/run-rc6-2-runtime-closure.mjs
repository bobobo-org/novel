import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import manifest from "../release-manifest.json" with { type: "json" };
import contract from "../release-metadata-contract.json" with { type: "json" };
import provenance from "../generated/release-provenance.json" with { type: "json" };
import {
  verifyAnnotatedRemoteTag,
  verifyFetchedAnnotatedTag,
  verifyImmutableReleasePolicy,
  verifyImmutableReleaseControlPlane,
  verifyImmutableRemoteRelease,
  verifyRemoteImmutableReleaseTag,
} from "./verify-immutable-release-tag.mjs";
import {
  collectCredentialValues,
  scanCredentialBytes,
  scanSealedProductionArtifact,
} from "./scan-sealed-production-artifact.mjs";
import {
  assertExpectedLastKnownGoodIdentity,
  createLastKnownGoodProductionIdentity,
  createReadOnlyRollbackSelectionProof,
  discoverLatestLastKnownGoodArtifact,
  downloadLastKnownGoodArtifact,
  selectVerifiedRollbackTarget,
  validateLastKnownGoodProductionIdentity,
  validateReadOnlyRollbackSelectionProof,
} from "./production-last-known-good.mjs";
import { validateDeploymentTemporalProvenance } from "./verify-deployment-temporal-provenance.mjs";
import {
  RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT,
  verifyProductionRecoveryControl,
} from "./verify-production-recovery-control.mjs";
import { runtimeTemporalProvenance } from "../lib/novel-ai/runtime-truth/release-identity.ts";

const CURRENT_COMMIT = "e84972aaec80885f9e2ab58e56252fb7b93522ea";
const RECOVERY_PRODUCT_COMMIT = "29fc6e742672bb07187765d34ea818afdadf56ae";
const RECOVERY_CONTROL_COMMIT = "c".repeat(40);
const PRIOR_DEPLOYMENT = "dpl_EHemQJyNZtn1NS69tnxQ24dKBRN3";
const EXACT_RELEASE = {
  releaseLine: "novel-ai-p24b-conversation-first-studio-rc6",
  releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.2",
  releaseRevision: "rc6.2",
  releaseName: "P2.4B Conversation-First Novel Project GPT RC6.2",
  consumerRelease: "p2.4b-conversation-first-studio-rc6.2",
  architectureStage: "P2.4B RC",
};

const recoveryControlChangedPaths = [
  ".github/workflows/deploy.yml",
  "scripts/verify-production-recovery-control.mjs",
];
const recoveryControlProof = verifyProductionRecoveryControl({
  productCommit: RECOVERY_PRODUCT_COMMIT,
  controlCommit: RECOVERY_CONTROL_COMMIT,
  checkoutCommit: RECOVERY_CONTROL_COMMIT,
  workflowSha: RECOVERY_CONTROL_COMMIT,
  eventName: "workflow_dispatch",
  eventRef: "refs/heads/main",
  operation: "deploy-immutable-product-recovery",
  repository: "bobobo-org/novel",
  workflowRef: "bobobo-org/novel/.github/workflows/deploy.yml@refs/heads/main",
  runId: "457",
  runAttempt: "2",
  execFileSyncImplementation: (_command, args) => {
    if (args[0] === "rev-parse") return `${RECOVERY_CONTROL_COMMIT}\n`;
    if (args[0] === "rev-list" && args.at(-1) === RECOVERY_CONTROL_COMMIT) {
      return `${RECOVERY_CONTROL_COMMIT} ${RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT}\n`;
    }
    if (args[0] === "rev-list" && args.at(-1) === RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT) {
      return `${RC6_2_RECOVERY_PREVIOUS_CONTROL_COMMIT} ${RECOVERY_PRODUCT_COMMIT}\n`;
    }
    if (args[0] === "merge-base") return "";
    if (args[0] === "diff") {
      return `${recoveryControlChangedPaths.map((path) => `M\t${path}`).join("\n")}\n`;
    }
    throw new Error("UNEXPECTED_RECOVERY_CONTROL_GIT_COMMAND");
  },
});

const [legacyHealthSource, adminStorageDiagnosticsSource] = await Promise.all([
  readFile(new URL("../app/api/ai/health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/storage/diagnostics/route.ts", import.meta.url), "utf8"),
]);
for (const source of [legacyHealthSource, adminStorageDiagnosticsSource]) {
  assert.doesNotMatch(source, /lastL0BFullTestAt:\s*(?:RELEASE_META\.buildTimestamp|BUILD_TIMESTAMP)/u);
  assert.doesNotMatch(source, /sqliteLast(?:Backup|Restore)At:\s*(?:RELEASE_META\.buildTimestamp|BUILD_TIMESTAMP)/u);
  assert.match(source, /lastL0BFullTestAt:\s*null/u);
  assert.match(source, /sqliteLastBackupAt:\s*null/u);
  assert.match(source, /sqliteLastRestoreAt:\s*null/u);
  assert.match(source, /sqliteBackupRestoreEvidenceStatus:\s*"not_bound_to_current_build"/u);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableProofValue(value) {
  if (Array.isArray(value)) return value.map(stableProofValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableProofValue(value[key])]),
    );
  }
  return value;
}

function selectionProofDigest(value) {
  return sha256(JSON.stringify(stableProofValue(value)));
}

function writeTarString(buffer, offset, length, value) {
  buffer.write(String(value), offset, Math.min(length, Buffer.byteLength(String(value))), "utf8");
}

function createTar(entries) {
  const chunks = [];
  for (const [name, value] of entries) {
    const content = Buffer.from(value);
    const header = Buffer.alloc(512);
    writeTarString(header, 0, 100, name);
    writeTarString(header, 100, 8, "0000644\0");
    writeTarString(header, 108, 8, "0000000\0");
    writeTarString(header, 116, 8, "0000000\0");
    writeTarString(header, 124, 12, `${content.length.toString(8).padStart(11, "0")}\0`);
    writeTarString(header, 136, 12, "00000000000\0");
    header.fill(0x20, 148, 156);
    header[156] = 48;
    writeTarString(header, 257, 6, "ustar\0");
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
    writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    chunks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

function createStoredZip(name, content) {
  const filename = Buffer.from(name);
  const data = Buffer.from(content);
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  filename.copy(local, 30);
  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  filename.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, central, eocd]);
}

assert.deepEqual(Object.fromEntries(Object.keys(EXACT_RELEASE).map((key) => [key, manifest[key]])), EXACT_RELEASE);
assert.deepEqual(contract.immutableReleaseIdentity, EXACT_RELEASE);
assert.equal("buildTime" in manifest, false);
// Auditable source: task attachment CreationTimeUtc 2026-08-09T22:48:18Z.
assert.equal(manifest.releaseEpoch, "2026-08-09T22:48:18.000Z");
assert.equal(manifest.legacyTagTruth, "RC6_LEGACY_TAG_WAS_MISSING");
assert.equal(provenance.schemaVersion, "p24b-rc6.2-build-provenance-v1");
assert.equal("buildStartedAt" in provenance, false);
assert.equal("buildCompletedAt" in provenance, false);
assert.equal("deployedAt" in provenance, false);

const policy = verifyImmutableReleasePolicy({
  productCommit: CURRENT_COMMIT,
  checkoutCommit: CURRENT_COMMIT,
});
assert.equal(policy.releaseTag, EXACT_RELEASE.releaseTag);
assert.throws(() => verifyImmutableReleasePolicy({
  productCommit: CURRENT_COMMIT,
  checkoutCommit: "f".repeat(40),
}), /RELEASE_PRODUCT_COMMIT_CHECKOUT_MISMATCH/u);
const remote = `${"a".repeat(40)}\trefs/tags/${EXACT_RELEASE.releaseTag}\n${CURRENT_COMMIT}\trefs/tags/${EXACT_RELEASE.releaseTag}^{}`;
assert.equal(verifyAnnotatedRemoteTag({
  releaseTag: EXACT_RELEASE.releaseTag,
  productCommit: CURRENT_COMMIT,
  lsRemoteOutput: remote,
}).peeledCommit, CURRENT_COMMIT);
assert.throws(() => verifyAnnotatedRemoteTag({
  releaseTag: EXACT_RELEASE.releaseTag,
  productCommit: CURRENT_COMMIT,
  lsRemoteOutput: `${CURRENT_COMMIT}\trefs/tags/${EXACT_RELEASE.releaseTag}`,
}), /REMOTE_RELEASE_TAG_NOT_ANNOTATED/u);
assert.throws(() => verifyAnnotatedRemoteTag({
  releaseTag: EXACT_RELEASE.releaseTag,
  productCommit: CURRENT_COMMIT,
  lsRemoteOutput: `${"a".repeat(40)}\trefs/tags/${EXACT_RELEASE.releaseTag}\n${"b".repeat(40)}\trefs/tags/${EXACT_RELEASE.releaseTag}^{}`,
}), /REMOTE_RELEASE_TAG_COMMIT_MISMATCH/u);
const tagObjectId = "a".repeat(40);
const tagMessage = [
  EXACT_RELEASE.releaseName,
  `Product commit: ${CURRENT_COMMIT}`,
  `Release revision: ${EXACT_RELEASE.releaseRevision}`,
  `Architecture stage: ${EXACT_RELEASE.architectureStage}`,
].join("\n");
const rawTagObject = [
  `object ${CURRENT_COMMIT}`,
  "type commit",
  `tag ${EXACT_RELEASE.releaseTag}`,
  "tagger RC6.2 Test <rc6.2@example.invalid> 1786291200 +0000",
  "",
  tagMessage,
].join("\n");
assert.equal(verifyFetchedAnnotatedTag({
  tagObject: tagObjectId,
  peeledCommit: CURRENT_COMMIT,
  fetchedTagObject: tagObjectId,
  fetchedPeeledCommit: CURRENT_COMMIT,
  objectType: "tag",
  rawTagObject,
  releaseName: EXACT_RELEASE.releaseName,
  productCommit: CURRENT_COMMIT,
  releaseRevision: EXACT_RELEASE.releaseRevision,
  architectureStage: EXACT_RELEASE.architectureStage,
}).messageFieldsVerified, true);
assert.throws(() => verifyFetchedAnnotatedTag({
  tagObject: tagObjectId,
  peeledCommit: CURRENT_COMMIT,
  fetchedTagObject: tagObjectId,
  fetchedPeeledCommit: CURRENT_COMMIT,
  objectType: "tag",
  rawTagObject: rawTagObject.replace(EXACT_RELEASE.architectureStage, ""),
  releaseName: EXACT_RELEASE.releaseName,
  productCommit: CURRENT_COMMIT,
  releaseRevision: EXACT_RELEASE.releaseRevision,
  architectureStage: EXACT_RELEASE.architectureStage,
}), /REMOTE_RELEASE_TAG_MESSAGE_FIELD_MISSING:architectureStage/u);
const remoteGitCalls = [];
const remoteGit = (args) => {
  remoteGitCalls.push(args);
  if (args[0] === "ls-remote") return `${tagObjectId}\trefs/tags/${EXACT_RELEASE.releaseTag}\n${CURRENT_COMMIT}\trefs/tags/${EXACT_RELEASE.releaseTag}^{}`;
  if (args[0] === "fetch" || args[0] === "update-ref") return "";
  if (args[0] === "rev-parse" && args[1].endsWith("^{}")) return CURRENT_COMMIT;
  if (args[0] === "rev-parse") return tagObjectId;
  if (args[0] === "cat-file" && args[1] === "-t") return "tag";
  if (args[0] === "cat-file" && args[1] === "-p") return rawTagObject;
  throw new Error(`UNEXPECTED_GIT_CALL:${args.join(" ")}`);
};
const fetchedRemote = verifyRemoteImmutableReleaseTag({
  releaseTag: EXACT_RELEASE.releaseTag,
  productCommit: CURRENT_COMMIT,
  releaseName: EXACT_RELEASE.releaseName,
  releaseRevision: EXACT_RELEASE.releaseRevision,
  architectureStage: EXACT_RELEASE.architectureStage,
  git: remoteGit,
});
assert.equal(fetchedRemote.remoteFetchVerified, true);
assert.equal(fetchedRemote.remoteStable, true);
assert.equal(fetchedRemote.messageFieldsVerified, true);
assert.equal(remoteGitCalls.filter(([command]) => command === "ls-remote").length, 2);
assert.equal(remoteGitCalls.filter(([command]) => command === "fetch").length, 1);
assert.equal(remoteGitCalls.filter(([command]) => command === "update-ref").length, 1);
const immutableReleaseSettings = { enabled: true, enforced_by_owner: false };
const immutableRelease = {
  id: 6202,
  immutable: true,
  draft: false,
  tag_name: EXACT_RELEASE.releaseTag,
  name: EXACT_RELEASE.releaseName,
  body: [
    EXACT_RELEASE.releaseName,
    `Product commit: ${CURRENT_COMMIT}`,
    `Release revision: ${EXACT_RELEASE.releaseRevision}`,
    `Architecture stage: ${EXACT_RELEASE.architectureStage}`,
  ].join("\n"),
  published_at: "2026-08-09T23:00:00.000Z",
};
const immutableReleaseFetcher = ({
  settings = immutableReleaseSettings,
  release = immutableRelease,
} = {}) => async (url) => ({
  ok: true,
  status: 200,
  json: async () => url.endsWith("/immutable-releases") ? settings : release,
});
const protection = await verifyImmutableReleaseControlPlane({
  repository: "bobobo-org/novel",
  releaseTag: EXACT_RELEASE.releaseTag,
  releaseName: EXACT_RELEASE.releaseName,
  productCommit: CURRENT_COMMIT,
  releaseRevision: EXACT_RELEASE.releaseRevision,
  architectureStage: EXACT_RELEASE.architectureStage,
  token: "unit-test-token-never-logged",
  requireRepositorySetting: true,
  fetcher: immutableReleaseFetcher(),
});
assert.equal(protection.repositoryImmutableReleasesSettingVerified, true);
assert.equal(protection.repositoryImmutableReleasesEnabled, true);
assert.equal(protection.immutableReleaseVerified, true);
assert.equal(protection.immutableReleaseId, 6202);
assert.match(protection.immutableReleaseDigest, /^[0-9a-f]{64}$/u);
await assert.rejects(() => verifyImmutableReleaseControlPlane({
  repository: "bobobo-org/novel",
  releaseTag: EXACT_RELEASE.releaseTag,
  releaseName: EXACT_RELEASE.releaseName,
  productCommit: CURRENT_COMMIT,
  releaseRevision: EXACT_RELEASE.releaseRevision,
  architectureStage: EXACT_RELEASE.architectureStage,
  token: "unit-test-token-never-logged",
  requireRepositorySetting: true,
  fetcher: immutableReleaseFetcher({
    settings: { enabled: false, enforced_by_owner: false },
  }),
}), /REMOTE_IMMUTABLE_RELEASES_NOT_ENABLED/u);
const workflowControlPlaneRequests = [];
const workflowProtection = await verifyImmutableReleaseControlPlane({
  repository: "bobobo-org/novel",
  releaseTag: EXACT_RELEASE.releaseTag,
  releaseName: EXACT_RELEASE.releaseName,
  productCommit: CURRENT_COMMIT,
  releaseRevision: EXACT_RELEASE.releaseRevision,
  architectureStage: EXACT_RELEASE.architectureStage,
  token: "workflow-token-with-contents-read-only",
  fetcher: async (url) => {
    workflowControlPlaneRequests.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => immutableRelease,
    };
  },
});
assert.equal(workflowProtection.repositoryImmutableReleasesSettingVerified, false);
assert.equal(workflowProtection.repositoryImmutableReleasesEnabled, null);
assert.equal(workflowProtection.immutableReleaseVerified, true);
assert.deepEqual(workflowControlPlaneRequests, [
  `https://api.github.com/repos/bobobo-org/novel/releases/tags/${encodeURIComponent(EXACT_RELEASE.releaseTag)}`,
]);
const remoteVerificationOrder = [];
const orderedRemoteVerification = await verifyImmutableRemoteRelease({
  controlPlaneOptions: {},
  remoteTagOptions: {},
  controlPlaneVerifier: async () => {
    remoteVerificationOrder.push("immutable-release-control-plane");
    return workflowProtection;
  },
  remoteTagVerifier: () => {
    remoteVerificationOrder.push("annotated-tag-after-lock");
    return fetchedRemote;
  },
});
assert.deepEqual(remoteVerificationOrder, [
  "immutable-release-control-plane",
  "annotated-tag-after-lock",
]);
assert.equal(orderedRemoteVerification.protection.immutableReleaseVerified, true);
assert.equal(orderedRemoteVerification.remote.remoteStable, true);
let tagVerifierCalledAfterRejectedControlPlane = false;
await assert.rejects(() => verifyImmutableRemoteRelease({
  controlPlaneOptions: {},
  remoteTagOptions: {},
  controlPlaneVerifier: async () => {
    throw new Error("REMOTE_RELEASE_NOT_IMMUTABLE");
  },
  remoteTagVerifier: () => {
    tagVerifierCalledAfterRejectedControlPlane = true;
    return fetchedRemote;
  },
}), /REMOTE_RELEASE_NOT_IMMUTABLE/u);
assert.equal(tagVerifierCalledAfterRejectedControlPlane, false);
await assert.rejects(() => verifyImmutableReleaseControlPlane({
  repository: "bobobo-org/novel",
  releaseTag: EXACT_RELEASE.releaseTag,
  releaseName: EXACT_RELEASE.releaseName,
  productCommit: CURRENT_COMMIT,
  releaseRevision: EXACT_RELEASE.releaseRevision,
  architectureStage: EXACT_RELEASE.architectureStage,
  token: "unit-test-token-never-logged",
  fetcher: immutableReleaseFetcher({
    release: { ...immutableRelease, immutable: false },
  }),
}), /REMOTE_RELEASE_NOT_IMMUTABLE/u);
await assert.rejects(() => verifyImmutableReleaseControlPlane({
  repository: "bobobo-org/novel",
  releaseTag: EXACT_RELEASE.releaseTag,
  releaseName: EXACT_RELEASE.releaseName,
  productCommit: CURRENT_COMMIT,
  releaseRevision: EXACT_RELEASE.releaseRevision,
  architectureStage: EXACT_RELEASE.architectureStage,
  token: "unit-test-token-never-logged",
  now: Date.parse("2026-08-10T01:00:00.000Z"),
  fetcher: immutableReleaseFetcher({
    release: { ...immutableRelease, published_at: "2026-08-10T01:01:01.000Z" },
  }),
}), /REMOTE_RELEASE_NOT_IMMUTABLE/u);

const temporalEnv = {
  NODE_ENV: "production",
  NOVEL_BUILD_STARTED_AT: "2026-08-09T22:50:00.000Z",
  NOVEL_BUILD_COMPLETED_AT: "2026-08-09T22:55:00.000Z",
  NOVEL_DEPLOYED_AT: "2026-08-09T22:56:00.000Z",
};
assert.equal(runtimeTemporalProvenance(temporalEnv).status, "verified");
assert.equal(runtimeTemporalProvenance({
  ...temporalEnv,
  NOVEL_BUILD_COMPLETED_AT: "2026-08-09T22:49:00.000Z",
}).status, "unavailable");
const runtimeIdentity = {
  ...EXACT_RELEASE,
  appCommit: CURRENT_COMMIT,
  releaseProductCommit: CURRENT_COMMIT,
  deploymentId: "dpl_temporalProof123",
  provenanceStatus: "verified",
  temporalProvenanceStatus: "verified",
  environment: "production",
  buildStartedAt: temporalEnv.NOVEL_BUILD_STARTED_AT,
  buildCompletedAt: temporalEnv.NOVEL_BUILD_COMPLETED_AT,
  deployedAt: temporalEnv.NOVEL_DEPLOYED_AT,
};
const temporalInput = {
  deployment: {
    id: runtimeIdentity.deploymentId,
    meta: {
      githubCommitSha: CURRENT_COMMIT,
      novelControlCommit: RECOVERY_CONTROL_COMMIT,
    },
    projectId: "prj_test",
    teamId: "team_test",
    readyState: "READY",
    target: "production",
    createdAt: Date.parse("2026-08-09T22:56:05.000Z"),
  },
  runtimeIdentity,
  expectedDeploymentId: runtimeIdentity.deploymentId,
  expectedCommit: CURRENT_COMMIT,
  expectedControlCommit: RECOVERY_CONTROL_COMMIT,
  expectedProjectId: "prj_test",
  expectedTeamId: "team_test",
  productCommitTime: "2026-08-09T22:49:00.000Z",
  buildStartedAt: temporalEnv.NOVEL_BUILD_STARTED_AT,
  buildCompletedAt: temporalEnv.NOVEL_BUILD_COMPLETED_AT,
  deployedAt: temporalEnv.NOVEL_DEPLOYED_AT,
  now: new Date("2026-08-09T22:57:00.000Z"),
};
assert.equal(validateDeploymentTemporalProvenance(temporalInput).runtimeBound, true);
assert.throws(() => validateDeploymentTemporalProvenance({
  ...temporalInput,
  productCommitTime: "2026-08-09T22:51:00.000Z",
}), /DEPLOYMENT_TEMPORAL_ORDER_INVALID/u);
assert.throws(() => validateDeploymentTemporalProvenance({
  ...temporalInput,
  now: new Date("2026-08-09T22:00:00.000Z"),
}), /DEPLOYMENT_TEMPORAL_FUTURE_TIMESTAMP/u);

const privateToken = `sk-${"A9".repeat(18)}`;
const serviceRoleJwt = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"role":"service_role","exp":9999999999}').toString("base64url")}.${"Z9".repeat(18)}`;
const publicAnonJwt = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"role":"anon","exp":9999999999}').toString("base64url")}.${"Y8".repeat(18)}`;
const contextualHighEntropy = "Ab3dE5fG7hJ9kLmN2pQrS4tUvW6xYz8A0bCdEfGhIjKlMnOp";
const configuredOnlySecret = "configured-value-with-words-2026-private";
const material = collectCredentialValues({
  env: {
    PRIVATE_API_KEY: privateToken,
    INTERNAL_AUTH_CREDENTIAL: configuredOnlySecret,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicAnonJwt,
  },
});
const sensitiveBytes = Buffer.from(`Authorization: Bearer ${privateToken}\nCookie: session=${"Q7".repeat(20)}\n${serviceRoleJwt}\ntoken="${contextualHighEntropy}"\n${configuredOnlySecret}`);
const credentialFindings = scanCredentialBytes(sensitiveBytes, { ...material, sourcePath: "fixture.bin" });
assert.ok(credentialFindings.some(({ kind }) => kind === "authorization-bearer"));
assert.ok(credentialFindings.some(({ kind }) => kind === "cookie-secret"));
assert.ok(credentialFindings.some(({ kind }) => kind === "service-role-jwt"));
assert.ok(credentialFindings.some(({ kind }) => kind === "contextual-high-entropy-credential"));
assert.ok(credentialFindings.some(({ kind, credentialNameFingerprint }) => (
  kind === "configured-credential"
  && credentialNameFingerprint === sha256("INTERNAL_AUTH_CREDENTIAL").slice(0, 16)
)));
assert.ok(credentialFindings.every((finding) => !("credentialName" in finding)));
assert.doesNotMatch(JSON.stringify(credentialFindings), new RegExp(privateToken, "u"));
assert.doesNotMatch(JSON.stringify(credentialFindings), new RegExp(configuredOnlySecret, "u"));
assert.equal(scanCredentialBytes(Buffer.from(`Bearer ${publicAnonJwt}`), {
  ...material,
  sourcePath: "public-client.js",
}).length, 0);
const unsafePublicNameMaterial = collectCredentialValues({
  env: {
    NEXT_PUBLIC_OPENAI_API_KEY: privateToken,
    NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: serviceRoleJwt,
  },
});
const unsafePublicFindings = scanCredentialBytes(Buffer.from(`${privateToken}\n${serviceRoleJwt}`), {
  ...unsafePublicNameMaterial,
  sourcePath: "public/client.js",
});
assert.ok(unsafePublicFindings.some(({ kind }) => kind === "openai-key"));
assert.ok(unsafePublicFindings.some(({ kind }) => kind === "service-role-jwt"));
const databaseUrl = "postgresql://novel_user:db-password-2026@db.internal:5432/novel";
const shortDatabasePassword = "p4ss";
const unicodeDatabasePassword = "密碼-甲乙-2026";
const databaseMaterial = collectCredentialValues({
  env: {
    DATABASE_URL: databaseUrl,
    DB_PASSWORD: shortDatabasePassword,
    ANALYTICS_PASSWORD: unicodeDatabasePassword,
  },
});
assert.equal(databaseMaterial.credentialValues.length, 3);
const databaseFindings = scanCredentialBytes(
  Buffer.from(`${databaseUrl}\n${shortDatabasePassword}\n${unicodeDatabasePassword}`, "utf8"),
  { ...databaseMaterial, sourcePath: "server/database-config.js" },
);
assert.ok(databaseFindings.some(({ kind, credentialNameFingerprint }) => (
  kind === "configured-credential"
  && credentialNameFingerprint === sha256("DATABASE_URL").slice(0, 16)
)));
assert.ok(databaseFindings.some(({ kind, credentialNameFingerprint }) => (
  kind === "configured-credential"
  && credentialNameFingerprint === sha256("DB_PASSWORD").slice(0, 16)
)));
assert.ok(databaseFindings.some(({ kind, credentialNameFingerprint }) => (
  kind === "configured-credential"
  && credentialNameFingerprint === sha256("ANALYTICS_PASSWORD").slice(0, 16)
)));
assert.equal(JSON.stringify(databaseFindings).includes(databaseUrl), false);
assert.equal(JSON.stringify(databaseFindings).includes(shortDatabasePassword), false);
assert.equal(JSON.stringify(databaseFindings).includes(unicodeDatabasePassword), false);
const credentialNameSecret = `sk-${"N7".repeat(18)}`;
const maliciousCredentialName = `PASSWORD_${credentialNameSecret}`;
const maliciousNameMaterial = collectCredentialValues({
  env: { [maliciousCredentialName]: configuredOnlySecret },
});
const maliciousNameFindings = scanCredentialBytes(Buffer.from(configuredOnlySecret), {
  ...maliciousNameMaterial,
  sourcePath: "server/name-redaction.js",
});
assert.ok(maliciousNameFindings.some(({ kind, credentialNameFingerprint }) => (
  kind === "configured-credential"
  && credentialNameFingerprint === sha256(maliciousCredentialName).slice(0, 16)
)));
assert.equal(JSON.stringify(maliciousNameFindings).includes(credentialNameSecret), false);
assert.equal(JSON.stringify(maliciousNameFindings).includes(maliciousCredentialName), false);
assert.ok(maliciousNameFindings.every((finding) => !("credentialName" in finding)));

const temporary = await mkdtemp(join(tmpdir(), "rc6-2-runtime-closure-"));
try {
  const cleanFile = join(temporary, "clean.txt");
  const archivePath = join(temporary, "production-prebuilt.tgz");
  const preReceiptPath = join(temporary, "pre.json");
  await writeFile(cleanFile, "sealed clean bytes");
  const archive = createTar([[".vercel/output/clean.txt", "sealed clean bytes"]]);
  await writeFile(archivePath, archive);
  const preReceipt = await scanSealedProductionArtifact({
    roots: [cleanFile],
    archivePath,
    env: {},
    scannedAt: "2026-08-09T22:06:00.000Z",
  });
  assert.equal(preReceipt.status, "PASS");
  assert.equal(preReceipt.archiveSha256, sha256(archive));
  assert.equal(preReceipt.clientCredentialHits, 0);
  assert.equal(preReceipt.sourceMapCredentialHits, 0);
  assert.equal(preReceipt.workerCredentialHits, 0);
  await writeFile(preReceiptPath, JSON.stringify(preReceipt));
  const postReceipt = await scanSealedProductionArtifact({
    archivePath,
    env: {},
    expectedArchiveDigest: preReceipt.archiveSha256,
    priorReceipt: await readFile(preReceiptPath, "utf8"),
  });
  assert.equal(postReceipt.status, "PASS");
  const leakedArchivePath = join(temporary, "leaked.tgz");
  await writeFile(leakedArchivePath, createTar([
    [".next/static/chunks/client.js.map", privateToken],
    ["public/generated/manual-learning-worker.js", configuredOnlySecret],
  ]));
  const leakedReceipt = await scanSealedProductionArtifact({
    archivePath: leakedArchivePath,
    env: { PRIVATE_API_KEY: privateToken, INTERNAL_AUTH_CREDENTIAL: configuredOnlySecret },
  });
  assert.equal(leakedReceipt.status, "FAIL");
  assert.ok(leakedReceipt.clientCredentialHits > 0);
  assert.ok(leakedReceipt.sourceMapCredentialHits > 0);
  assert.ok(leakedReceipt.workerCredentialHits > 0);
  assert.equal(JSON.stringify(leakedReceipt).includes(privateToken), false);
  assert.ok(leakedReceipt.findings.every(({ sourcePath, sourceFingerprint }) => (
    /^(?:archive-header|archive-content|filesystem):[0-9a-f]{16}$/u.test(sourcePath)
    && /^[0-9a-f]{16}$/u.test(sourceFingerprint)
  )));
  const credentialPathArchive = join(temporary, "credential-path.tgz");
  const credentialEntryName = `.next/static/chunks/${privateToken}.js`;
  await writeFile(credentialPathArchive, createTar([[credentialEntryName, "clean content"]]));
  const credentialPathReceipt = await scanSealedProductionArtifact({
    archivePath: credentialPathArchive,
    env: { PRIVATE_API_KEY: privateToken },
  });
  assert.equal(credentialPathReceipt.status, "FAIL");
  assert.ok(credentialPathReceipt.clientCredentialHits > 0);
  assert.equal(JSON.stringify(credentialPathReceipt).includes(privateToken), false);
  assert.equal(JSON.stringify(credentialPathReceipt).includes(credentialEntryName), false);

  const lkg = createLastKnownGoodProductionIdentity({
    primaryDeploymentId: PRIOR_DEPLOYMENT,
    mirrorDeploymentId: PRIOR_DEPLOYMENT,
    appCommit: CURRENT_COMMIT,
    releaseTag: "novel-ai-p24b-conversation-first-studio-rc6",
    releaseRevision: "rc6.1",
    verifiedAt: "2026-08-09T20:00:00.000Z",
  });
  assert.equal(assertExpectedLastKnownGoodIdentity(lkg, {
    appCommit: CURRENT_COMMIT,
    primaryDeploymentId: PRIOR_DEPLOYMENT,
    mirrorDeploymentId: PRIOR_DEPLOYMENT,
    releaseTag: "novel-ai-p24b-conversation-first-studio-rc6",
    releaseRevision: "rc6.1",
  }).appCommit, CURRENT_COMMIT);
  const newerLkg = createLastKnownGoodProductionIdentity({
    primaryDeploymentId: "dpl_newerRc62Production123",
    mirrorDeploymentId: "dpl_newerRc62Production123",
    appCommit: RECOVERY_PRODUCT_COMMIT,
    releaseTag: EXACT_RELEASE.releaseTag,
    releaseRevision: EXACT_RELEASE.releaseRevision,
    verifiedAt: "2026-08-09T23:30:00.000Z",
    recoveryControlProof,
  });
  assert.equal(assertExpectedLastKnownGoodIdentity(newerLkg, {
    appCommit: "",
    primaryDeploymentId: "",
    mirrorDeploymentId: "",
    releaseTag: "",
    releaseRevision: "",
  }).releaseTag, EXACT_RELEASE.releaseTag);
  const zip = createStoredZip("last-known-good-production.json", JSON.stringify(lkg));
  const artifact = {
    artifactId: 123,
    artifactName: `production-last-known-good-${CURRENT_COMMIT}`,
    artifactDigest: `sha256:${sha256(zip)}`,
    runId: 456,
    headSha: CURRENT_COMMIT,
    productCommit: CURRENT_COMMIT,
    controlCommit: CURRENT_COMMIT,
    workflowEvent: "push",
    workflowBranch: "main",
    runAttempt: 1,
    workflowPath: ".github/workflows/deploy.yml",
    createdAt: "2026-08-09T20:01:00.000Z",
  };
  const downloaded = await downloadLastKnownGoodArtifact({
    repository: "bobobo-org/novel",
    token: "test-token-not-logged",
    artifact,
    fetcher: async () => ({
      ok: true,
      arrayBuffer: async () => zip,
      body: null,
    }),
  });
  assert.equal(downloaded.identity.appCommit, CURRENT_COMMIT);
  assert.equal(downloaded.proof.archiveSha256, sha256(zip));
  assert.equal(downloaded.proof.readOnlyDiscovery, true);
  assert.equal(downloaded.proof.artifactControlPlaneVerified, true);
  assert.equal(downloaded.proof.workflowRunControlPlaneVerified, true);
  const controlledZip = createStoredZip("last-known-good-production.json", JSON.stringify(newerLkg));
  const controlledDownloaded = await downloadLastKnownGoodArtifact({
    repository: "bobobo-org/novel",
    token: "test-token-not-logged",
    artifact: {
      artifactId: 124,
      artifactName: `production-last-known-good-control-${RECOVERY_CONTROL_COMMIT}-product-${newerLkg.appCommit}`,
      artifactDigest: `sha256:${sha256(controlledZip)}`,
      runId: 457,
      headSha: RECOVERY_CONTROL_COMMIT,
      productCommit: newerLkg.appCommit,
      controlCommit: RECOVERY_CONTROL_COMMIT,
      workflowEvent: "workflow_dispatch",
      workflowBranch: "main",
      runAttempt: 2,
      workflowPath: ".github/workflows/deploy.yml",
      createdAt: "2026-08-12T16:01:00.000Z",
    },
    fetcher: async () => ({
      ok: true,
      arrayBuffer: async () => controlledZip,
      body: null,
    }),
  });
  assert.equal(controlledDownloaded.proof.schemaVersion, "github-actions-lkg-artifact-proof-v2");
  assert.equal(controlledDownloaded.proof.publicationMode, "immutable-product-control");
  assert.equal(controlledDownloaded.proof.productCommit, newerLkg.appCommit);
  assert.equal(controlledDownloaded.proof.controlCommit, RECOVERY_CONTROL_COMMIT);
  assert.equal(controlledDownloaded.proof.recoveryControlProofDigest, recoveryControlProof.proofDigest);
  const controlledWithoutRecoveryProof = createLastKnownGoodProductionIdentity({
    primaryDeploymentId: "dpl_newerRc62Production123",
    mirrorDeploymentId: "dpl_newerRc62Production123",
    appCommit: RECOVERY_PRODUCT_COMMIT,
    releaseTag: EXACT_RELEASE.releaseTag,
    releaseRevision: EXACT_RELEASE.releaseRevision,
    verifiedAt: "2026-08-09T23:30:00.000Z",
  });
  assert.throws(() => validateLastKnownGoodProductionIdentity({
    ...controlledWithoutRecoveryProof,
    schemaVersion: "last-known-good-production-identity-v2",
  }), /LAST_KNOWN_GOOD_DIGEST_INVALID/u);
  const controlledWithoutProofZip = createStoredZip(
    "last-known-good-production.json",
    JSON.stringify(controlledWithoutRecoveryProof),
  );
  await assert.rejects(() => downloadLastKnownGoodArtifact({
    repository: "bobobo-org/novel",
    token: "test-token-not-logged",
    artifact: {
      artifactId: 125,
      artifactName: `production-last-known-good-control-${RECOVERY_CONTROL_COMMIT}-product-${RECOVERY_PRODUCT_COMMIT}`,
      artifactDigest: `sha256:${sha256(controlledWithoutProofZip)}`,
      runId: 457,
      headSha: RECOVERY_CONTROL_COMMIT,
      productCommit: RECOVERY_PRODUCT_COMMIT,
      controlCommit: RECOVERY_CONTROL_COMMIT,
      workflowEvent: "workflow_dispatch",
      workflowBranch: "main",
      runAttempt: 2,
      workflowPath: ".github/workflows/deploy.yml",
      createdAt: "2026-08-12T16:01:00.000Z",
    },
    fetcher: async () => ({
      ok: true,
      arrayBuffer: async () => controlledWithoutProofZip,
      body: null,
    }),
  }), /LAST_KNOWN_GOOD_ARTIFACT_IDENTITY_MISMATCH/u);
  await assert.rejects(() => downloadLastKnownGoodArtifact({
    repository: "bobobo-org/novel",
    token: "test-token-not-logged",
    artifact: {
      ...controlledDownloaded.proof,
      artifactId: 124,
      artifactDigest: `sha256:${sha256(controlledZip)}`,
      productCommit: RECOVERY_CONTROL_COMMIT,
    },
    fetcher: async () => ({ ok: true, arrayBuffer: async () => controlledZip, body: null }),
  }), /LAST_KNOWN_GOOD_ARTIFACT_IDENTITY_MISMATCH/u);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const discovered = await discoverLatestLastKnownGoodArtifact({
  repository: "bobobo-org/novel",
  token: "test-token-not-logged",
  fetcher: async (url) => {
    if (String(url).includes("/actions/artifacts")) return {
      ok: true,
      json: async () => ({
        total_count: 1,
        artifacts: [{
          id: 123,
          name: `production-last-known-good-${CURRENT_COMMIT}`,
          digest: `sha256:${"a".repeat(64)}`,
          expired: false,
          created_at: "2026-08-09T20:01:00.000Z",
          workflow_run: { id: 456, head_branch: "main", head_sha: CURRENT_COMMIT },
        }],
      }),
      body: null,
    };
    return {
      ok: true,
      json: async () => ({
        conclusion: "success",
        event: "push",
        head_branch: "main",
        head_sha: CURRENT_COMMIT,
        run_attempt: 1,
        path: ".github/workflows/deploy.yml",
      }),
      body: null,
    };
  },
});
assert.equal(discovered.artifactDigest, `sha256:${"a".repeat(64)}`);
assert.equal(discovered.workflowPath, ".github/workflows/deploy.yml");
assert.equal(discovered.productCommit, CURRENT_COMMIT);
assert.equal(discovered.controlCommit, CURRENT_COMMIT);
assert.equal(discovered.workflowEvent, "push");
assert.equal(discovered.runAttempt, 1);

const recoveryProductCommit = RECOVERY_PRODUCT_COMMIT;
const controlledArtifactName = `production-last-known-good-control-${RECOVERY_CONTROL_COMMIT}-product-${recoveryProductCommit}`;
const controlledDiscoveryFetcher = (event = "workflow_dispatch") => async (url) => {
  if (String(url).includes("/actions/artifacts")) return {
    ok: true,
    json: async () => ({
      total_count: 1,
      artifacts: [{
        id: 124,
        name: controlledArtifactName,
        digest: `sha256:${"b".repeat(64)}`,
        expired: false,
        created_at: "2026-08-12T16:01:00.000Z",
        workflow_run: {
          id: 457,
          head_branch: "main",
          head_sha: RECOVERY_CONTROL_COMMIT,
        },
      }],
    }),
    body: null,
  };
  return {
    ok: true,
    json: async () => ({
      conclusion: "success",
      event,
      head_branch: "main",
      head_sha: RECOVERY_CONTROL_COMMIT,
      run_attempt: 2,
      path: ".github/workflows/deploy.yml",
    }),
    body: null,
  };
};
const controlledDiscovered = await discoverLatestLastKnownGoodArtifact({
  repository: "bobobo-org/novel",
  token: "test-token-not-logged",
  fetcher: controlledDiscoveryFetcher(),
});
assert.equal(controlledDiscovered.artifactName, controlledArtifactName);
assert.equal(controlledDiscovered.productCommit, recoveryProductCommit);
assert.equal(controlledDiscovered.controlCommit, RECOVERY_CONTROL_COMMIT);
assert.equal(controlledDiscovered.workflowEvent, "workflow_dispatch");
assert.equal(controlledDiscovered.workflowBranch, "main");
assert.equal(controlledDiscovered.runAttempt, 2);
assert.equal(await discoverLatestLastKnownGoodArtifact({
  repository: "bobobo-org/novel",
  token: "test-token-not-logged",
  fetcher: controlledDiscoveryFetcher("push"),
}), null);

await assert.rejects(() => selectVerifiedRollbackTarget({
  current: null,
  lastKnownGood: {
    primaryDeploymentId: PRIOR_DEPLOYMENT,
    mirrorDeploymentId: PRIOR_DEPLOYMENT,
    appCommit: CURRENT_COMMIT,
  },
  emergency: {
    primaryDeploymentId: "dpl_emergency123",
    mirrorDeploymentId: "dpl_emergency123",
    appCommit: "f".repeat(40),
  },
  token: "test",
  teamId: "team",
  projectId: "project",
  failClosedSources: ["last-known-good"],
  fetcher: async () => ({ ok: false, json: async () => ({}), body: null }),
}), (error) => error?.code === "REQUIRED_ROLLBACK_TARGET_VERIFICATION_FAILED");

const rawVercelTeamId = "team_sensitive_audit_scope";
const rawVercelProjectId = "prj_sensitive_audit_scope";
const rawVercelToken = "vercel_token_must_never_enter_proof";
const lkgArtifactProofDigest = "d".repeat(64);
const auditProvenance = {
  mode: "same-sha",
  productCommit: CURRENT_COMMIT,
  controlCommit: CURRENT_COMMIT,
  controlProofDigest: "",
  repository: "bobobo-org/novel",
  eventName: "workflow_dispatch",
  eventRef: "refs/heads/main",
  eventCommit: CURRENT_COMMIT,
  workflow: "Vercel Deploy",
  workflowRef: "bobobo-org/novel/.github/workflows/deploy.yml@refs/heads/main",
  workflowSha: CURRENT_COMMIT,
  runId: "31337634767",
  runAttempt: "2",
};
const auditSelectionProof = createReadOnlyRollbackSelectionProof({
  selectedAt: "2026-08-12T12:34:56.000Z",
  source: "last-known-good",
  primaryDeploymentId: PRIOR_DEPLOYMENT,
  primaryAppCommit: CURRENT_COMMIT,
  mirrorDeploymentId: PRIOR_DEPLOYMENT,
  mirrorAppCommit: CURRENT_COMMIT,
  lastKnownGoodAvailable: true,
  lastKnownGoodArtifactProofDigest: lkgArtifactProofDigest,
  teamId: rawVercelTeamId,
  projectId: rawVercelProjectId,
  auditProvenance,
  requireAuditProvenance: true,
});
assert.deepEqual(Object.keys(auditSelectionProof), [
  "schemaVersion",
  "status",
  "selectedAt",
  "source",
  "primaryDeploymentId",
  "primaryAppCommit",
  "mirrorDeploymentId",
  "mirrorAppCommit",
  "lastKnownGoodAvailable",
  "lastKnownGoodArtifactProofDigest",
  "lastKnownGoodControlPlaneVerified",
  "readOnlySelection",
  "vercelTeamIdSha256",
  "vercelProjectIdSha256",
  "auditProvenance",
  "proofDigest",
]);
assert.deepEqual(Object.keys(auditSelectionProof.auditProvenance), [
  "mode",
  "productCommit",
  "controlCommit",
  "controlProofDigest",
  "repository",
  "eventName",
  "eventRef",
  "eventCommit",
  "workflow",
  "workflowRef",
  "workflowSha",
  "runId",
  "runAttempt",
]);
assert.equal(auditSelectionProof.schemaVersion, "p24b-rc6.2-readonly-rollback-selection-proof-v3");
assert.equal(auditSelectionProof.vercelTeamIdSha256, sha256(rawVercelTeamId));
assert.equal(auditSelectionProof.vercelProjectIdSha256, sha256(rawVercelProjectId));
const serializedAuditSelectionProof = JSON.stringify(auditSelectionProof);
for (const rawSecret of [rawVercelTeamId, rawVercelProjectId, rawVercelToken]) {
  assert.equal(serializedAuditSelectionProof.includes(rawSecret), false);
}
const { proofDigest: auditProofDigest, ...auditProofCore } = auditSelectionProof;
assert.equal(auditProofDigest, selectionProofDigest(auditProofCore));
assert.deepEqual(
  validateReadOnlyRollbackSelectionProof(auditSelectionProof, {
    requireAuditProvenance: true,
    expectedTeamId: rawVercelTeamId,
    expectedProjectId: rawVercelProjectId,
  }),
  auditSelectionProof,
);

const withExactDigest = (proof) => {
  const core = { ...proof };
  delete core.proofDigest;
  return { ...core, proofDigest: selectionProofDigest(core) };
};
assert.throws(
  () => validateReadOnlyRollbackSelectionProof({ ...auditSelectionProof, rawTeamId: rawVercelTeamId }),
  (error) => error?.code === "READ_ONLY_SELECTION_PROOF_SHAPE_INVALID",
);
assert.throws(
  () => validateReadOnlyRollbackSelectionProof({
    ...auditSelectionProof,
    vercelProjectIdSha256: "e".repeat(64),
  }),
  (error) => error?.code === "READ_ONLY_SELECTION_PROOF_DIGEST_INVALID",
);
assert.throws(
  () => validateReadOnlyRollbackSelectionProof({
    ...auditSelectionProof,
    auditProvenance: {
      ...auditSelectionProof.auditProvenance,
      runId: "31337634768",
    },
  }),
  (error) => error?.code === "READ_ONLY_SELECTION_PROOF_DIGEST_INVALID",
);
assert.throws(
  () => validateReadOnlyRollbackSelectionProof(withExactDigest({
    ...auditSelectionProof,
    vercelTeamIdSha256: "e".repeat(64),
  }), {
    expectedTeamId: rawVercelTeamId,
    expectedProjectId: rawVercelProjectId,
  }),
  (error) => error?.code === "READ_ONLY_SELECTION_PROOF_OWNERSHIP_MISMATCH",
);
const reboundProductCommit = "f".repeat(40);
assert.throws(
  () => validateReadOnlyRollbackSelectionProof(withExactDigest({
    ...auditSelectionProof,
    auditProvenance: {
      ...auditSelectionProof.auditProvenance,
      productCommit: reboundProductCommit,
    },
  }), { requireAuditProvenance: true }),
  (error) => error?.code === "READ_ONLY_SELECTION_AUDIT_PROVENANCE_INVALID",
);
const controlledAuditProof = createReadOnlyRollbackSelectionProof({
  selectedAt: "2026-08-12T12:34:57.000Z",
  source: "last-known-good",
  primaryDeploymentId: PRIOR_DEPLOYMENT,
  primaryAppCommit: CURRENT_COMMIT,
  mirrorDeploymentId: PRIOR_DEPLOYMENT,
  mirrorAppCommit: CURRENT_COMMIT,
  lastKnownGoodAvailable: true,
  lastKnownGoodArtifactProofDigest: lkgArtifactProofDigest,
  teamId: rawVercelTeamId,
  projectId: rawVercelProjectId,
  auditProvenance: {
    ...auditProvenance,
    mode: "immutable-product-control",
    productCommit: recoveryProductCommit,
    controlCommit: RECOVERY_CONTROL_COMMIT,
    controlProofDigest: "e".repeat(64),
    eventCommit: RECOVERY_CONTROL_COMMIT,
    workflowSha: RECOVERY_CONTROL_COMMIT,
  },
  requireAuditProvenance: true,
});
assert.equal(controlledAuditProof.auditProvenance.productCommit, recoveryProductCommit);
assert.equal(controlledAuditProof.auditProvenance.controlCommit, RECOVERY_CONTROL_COMMIT);
assert.throws(() => validateReadOnlyRollbackSelectionProof(withExactDigest({
  ...controlledAuditProof,
  auditProvenance: {
    ...controlledAuditProof.auditProvenance,
    workflowSha: recoveryProductCommit,
  },
}), { requireAuditProvenance: true }), /READ_ONLY_SELECTION_AUDIT_PROVENANCE_INVALID/u);
assert.throws(
  () => validateReadOnlyRollbackSelectionProof(withExactDigest({
    ...auditSelectionProof,
    auditProvenance: {
      ...auditSelectionProof.auditProvenance,
      rawProjectId: rawVercelProjectId,
    },
  })),
  (error) => error?.code === "READ_ONLY_SELECTION_AUDIT_PROVENANCE_SHAPE_INVALID",
);

const productionCutoverSelectionProof = createReadOnlyRollbackSelectionProof({
  selectedAt: "2026-08-12T12:35:56.000Z",
  source: "current-transaction-capture",
  primaryDeploymentId: "dpl_currentProduction123",
  primaryAppCommit: CURRENT_COMMIT,
  mirrorDeploymentId: "dpl_currentProduction123",
  mirrorAppCommit: CURRENT_COMMIT,
  lastKnownGoodAvailable: true,
  lastKnownGoodArtifactProofDigest: lkgArtifactProofDigest,
  teamId: rawVercelTeamId,
  projectId: rawVercelProjectId,
});
assert.equal(productionCutoverSelectionProof.auditProvenance, null);
assert.deepEqual(
  validateReadOnlyRollbackSelectionProof(productionCutoverSelectionProof),
  productionCutoverSelectionProof,
);
assert.throws(
  () => validateReadOnlyRollbackSelectionProof(productionCutoverSelectionProof, {
    requireAuditProvenance: true,
  }),
  (error) => error?.code === "READ_ONLY_SELECTION_AUDIT_PROVENANCE_REQUIRED",
);

const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
const jobs = [...workflow.matchAll(/^  ([a-z][a-z0-9_]+):\r?$/gmu)].map((match) => ({ name: match[1], index: match.index }));
const job = (name) => {
  const current = jobs.find((entry) => entry.name === name);
  const next = jobs.find((entry) => entry.index > current.index);
  return workflow.slice(current.index, next?.index ?? workflow.length);
};
const workflowStep = (jobSource, name) => {
  const marker = `      - name: ${name}`;
  const start = jobSource.indexOf(marker);
  assert.ok(start >= 0, `workflow step missing: ${name}`);
  const next = jobSource.indexOf("\n      - name:", start + marker.length);
  return jobSource.slice(start, next < 0 ? jobSource.length : next);
};
assert.match(workflow, /permissions:\s*[\s\S]*attestations:\s*read/u);
assert.deepEqual(
  ["validate", "audit_last_known_good", "production_env_audit", "production_env_repair", "production_build", "post_build_secret_scan", "staged_deploy", "runtime_gates", "alias_cutover"]
    .map((name) => jobs.find((entry) => entry.name === name).index)
    .slice().sort((a, b) => a - b),
  ["validate", "audit_last_known_good", "production_env_audit", "production_env_repair", "production_build", "post_build_secret_scan", "staged_deploy", "runtime_gates", "alias_cutover"]
    .map((name) => jobs.find((entry) => entry.name === name).index),
);
assert.match(job("validate"), /verify-immutable-release-tag\.mjs policy/u);
for (const gate of [
  "test:ai:closed-ai-runtime-rc6-2",
  "test:ai:rc6.2:persistence-contract",
  "test:ai:rc6.2:persistence-browser",
]) assert.match(job("validate"), new RegExp(`pnpm ${gate.replaceAll(".", "\\.")}`, "u"));
const rc62HardeningStep = job("validate")
  .split("- name: Run RC6.2 post-release hardening and runtime closure gates")[1]
  .split("- name: Verify secrets, Companion ZIP, and evidence schemas")[0];
assert.match(rc62HardeningStep, /RC6_2_START_SERVER:\s*'1'/u);
assert.match(rc62HardeningStep, /RC6_2_BASE_URL:\s*http:\/\/127\.0\.0\.1:3136/u);
assert.match(rc62HardeningStep, /pnpm test:ci:production-main-head-cas/u);
assert.match(rc62HardeningStep, /pnpm test:ai:rc6\.2:persistence-browser/u);
assert.match(job("validate"), /deploy-immutable-product-recovery[\s\S]*verify-immutable-release-tag\.mjs remote/u);
assert.match(job("validate"), /run-production-main-head-cas-tests\.mjs[\s\S]*Install locked recovery-control test dependencies[\s\S]*run-rc6-1-deployment-governance\.mjs all[\s\S]*node --import \.\/scripts\/register-rc6-test-loader\.mjs scripts\/run-rc6-2-runtime-closure\.mjs[\s\S]*Checkout exact Product commit/u);
assert.match(job("validate"), /Verify final remote RC6\.2 annotated tag is immutable[\s\S]*GITHUB_TOKEN:\s*\$\{\{ github\.token \}\}/u);
assert.equal(
  (workflow.match(/IMMUTABLE_RELEASE_REQUIRE_REPOSITORY_SETTING:\s*'true'/gu) || []).length,
  0,
);
assert.equal(
  (workflow.match(/IMMUTABLE_RELEASE_REQUIRE_REPOSITORY_SETTING:\s*'false'/gu) || []).length,
  4,
);
assert.equal((workflow.match(/verify-github-release-attestation\.mjs/gu) || []).length, 7);
assert.match(job("preview"), /EXPECTED_RELEASE_TAG:\s*novel-ai-p24b-conversation-first-studio-rc6\.2/u);
assert.match(job("preview"), /\$release_tag" == "\$EXPECTED_RELEASE_TAG"/u);
assert.doesNotMatch(job("preview"), /\$release_tag" == "novel-ai-p24b-conversation-first-studio-rc6"/u);
assert.match(job("production_build"), /vercel build --prod[\s\S]*production-prebuilt\.tgz[\s\S]*scan-sealed-production-artifact\.mjs[\s\S]*Upload sealed prebuilt Production artifact/u);
assert.match(job("post_build_secret_scan"), /needs:\s*production_build[\s\S]*download-artifact[\s\S]*--expected-digest[\s\S]*--prior-receipt/u);
assert.match(job("staged_deploy"), /needs:\s*\[production_build, post_build_secret_scan\]/u);
for (const output of ["build_started_at", "build_completed_at", "archive_sha256", "post_build_scan_receipt_digest"]) {
  assert.match(job("staged_deploy"), new RegExp(`^      ${output}: \\$\\{\\{ needs\\.`, "mu"));
}
assert.match(job("staged_deploy"), /--env "NOVEL_BUILD_STARTED_AT=[\s\S]*--env "NOVEL_BUILD_COMPLETED_AT=[\s\S]*--env "NOVEL_DEPLOYED_AT=/u);
assert.match(job("staged_deploy"), /--meta "githubCommitSha=\$PRODUCT_COMMIT"[\s\S]*--meta "novelControlCommit=\$CONTROL_COMMIT"/u);
assert.match(job("staged_deploy"), /Checkout trusted Production control commit for staged-deploy CAS[\s\S]*path:\s*\.release-control[\s\S]*EXPECTED_MAIN_HEAD_COMMIT:\s*\$\{\{ github\.sha \}\}[\s\S]*node \.release-control\/scripts\/verify-production-main-head-cas\.mjs[\s\S]*vercel deploy --prebuilt --prod --skip-domain/u);
assert.match(job("runtime_gates"), /api\.vercel\.com\/v13\/deployments|verify-deployment-temporal-provenance\.mjs/u);
assert.match(job("runtime_gates"), /release_product_commit[\s\S]*EXPECTED_CONTROL_COMMIT:\s*\$\{\{ github\.sha \}\}/u);
assert.match(job("runtime_gates"), /Checkout trusted Production control commit for runtime proof[\s\S]*Checkout immutable Product commit for runtime timestamp proof[\s\S]*path:\s*\.release-product[\s\S]*git -C \.release-product show -s --format=%cI/u);
assert.match(job("runtime_gates"), /^      temporal_proof_digest:\s*\$\{\{ steps\.temporal\.outputs\.proof_digest \}\}/mu);
assert.match(job("alias_cutover"), /production-last-known-good\.mjs discover[\s\S]*production-last-known-good\.mjs download[\s\S]*DISABLE_CURRENT_CAPTURE:\s*'true'[\s\S]*production-last-known-good\.mjs select/u);
assert.match(job("alias_cutover"), /Reproduce and bind recovery control proof for Last Known Good publication[\s\S]*verify-production-recovery-control\.mjs[\s\S]*needs\.validate\.outputs\.recovery_control_proof_digest[\s\S]*RECOVERY_CONTROL_PROOF_PATH:[^\r\n]*recovery-control-proof-for-lkg\.json[\s\S]*production-last-known-good\.mjs write/u);
assert.match(workflow, /- audit-last-known-good/u);
assert.match(workflow, /- audit-rc6-2-last-known-good/u);
assert.match(workflow, /- deploy-immutable-product-recovery/u);
assert.match(workflow, /preview_ref:[\s\S]*deploy-preview or audit-last-known-good/u);
const readOnlyLkgAudit = job("audit_last_known_good");
assert.match(readOnlyLkgAudit, /needs:\s*validate[\s\S]*always\(\)[\s\S]*deploy-immutable-product-recovery[\s\S]*audit-last-known-good[\s\S]*audit-rc6-2-last-known-good/u);
assert.match(readOnlyLkgAudit, /AUDIT_COMMIT:\s*\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.operation == 'audit-last-known-good' && inputs\.preview_ref \|\| github\.sha \}\}/u);
assert.match(readOnlyLkgAudit, /Require the explicit audit commit to equal this trusted workflow head[\s\S]*EXPECTED_EVENT_COMMIT:\s*\$\{\{ github\.sha \}\}[\s\S]*\[\[ "\$AUDIT_COMMIT" == "\$EXPECTED_EVENT_COMMIT" \]\][\s\S]*Checkout exact read-only audit commit/u);
assert.match(readOnlyLkgAudit, /Checkout exact read-only audit commit[\s\S]*ref:\s*\$\{\{ github\.sha \}\}/u);
assert.match(readOnlyLkgAudit, /\[\[ "\$AUDIT_COMMIT" =~ \^\[a-f0-9\]\{40\}\$ \]\]/u);
const readOnlyLkgAuditJobEnv = readOnlyLkgAudit.split("    steps:")[0];
assert.doesNotMatch(readOnlyLkgAuditJobEnv, /secrets\.(?:VERCEL_TOKEN|VERCEL_ORG_ID|VERCEL_PROJECT_ID)/u);
const readOnlyLkgSelectionStep = readOnlyLkgAudit.split("- name: Prove prior Last Known Good control-plane selection without mutation")[1]
  .split("- name:")[0];
assert.match(readOnlyLkgSelectionStep, /REQUIRE_AUDIT_SELECTION_PROVENANCE:\s*'true'/u);
assert.match(readOnlyLkgSelectionStep, /AUDIT_PRODUCT_COMMIT:[^\r\n]*deploy-immutable-product-recovery[^\r\n]*env\.PRODUCT_COMMIT[^\r\n]*env\.AUDIT_COMMIT/u);
assert.match(readOnlyLkgSelectionStep, /AUDIT_CONTROL_PROOF_DIGEST:[^\r\n]*needs\.validate\.outputs\.recovery_control_proof_digest/u);
for (const secret of ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]) {
  assert.match(readOnlyLkgSelectionStep, new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`, "u"));
}
assert.match(readOnlyLkgAudit, /production-last-known-good\.mjs discover[\s\S]*production-last-known-good\.mjs download[\s\S]*DISABLE_CURRENT_CAPTURE:\s*'true'[\s\S]*production-last-known-good\.mjs select/u);
assert.match(readOnlyLkgAudit, /steps\.lkg_selection\.outputs\.source \}\}" = last-known-good/u);
assert.match(readOnlyLkgAudit, /production-lkg-readonly-audit-/u);
for (const [name, value] of [
  ["EXPECTED_LKG_APP_COMMIT", "e84972aaec80885f9e2ab58e56252fb7b93522ea"],
  ["EXPECTED_LKG_PRIMARY_DEPLOYMENT_ID", "dpl_EHemQJyNZtn1NS69tnxQ24dKBRN3"],
  ["EXPECTED_LKG_MIRROR_DEPLOYMENT_ID", "dpl_EHemQJyNZtn1NS69tnxQ24dKBRN3"],
  ["EXPECTED_LKG_RELEASE_TAG", "novel-ai-p24b-conversation-first-studio-rc6"],
  ["EXPECTED_LKG_RELEASE_REVISION", "rc6.1"],
]) assert.match(workflow, new RegExp(`^  ${name}: ${value}$`, "mu"));
assert.doesNotMatch(readOnlyLkgAudit, /production-last-known-good\.mjs\s+(?:write|restore)|vercel-dual-alias-cutover\.mjs|\balias\s+(?:set|remove|restore|cutover)\b|\b(?:POST|PUT|PATCH|DELETE)\b/iu);
assert.match(job("production_env_audit"), /needs:\s*\[validate, audit_last_known_good\]/u);
assert.match(workflow, /vercel-lkg-audit-[\s\S]*audit-rc6-2-last-known-good/u);
assert.match(job("alias_cutover"), /Recheck immutable GitHub Release immediately before alias cutover[\s\S]*verify-immutable-release-tag\.mjs remote[\s\S]*verify-github-release-attestation\.mjs[\s\S]*Cut over both aliases/u);
assert.match(job("alias_cutover"), /Final immutable GitHub Release recheck after public cutover[\s\S]*id:\s*immutable_tag_final[\s\S]*continue-on-error:\s*true/u);
assert.match(job("alias_cutover"), /Compensating rollback after immutable Release recheck failure[\s\S]*steps\.immutable_tag_final\.outcome != 'success'[\s\S]*vercel-dual-alias-cutover\.mjs restore/u);
assert.match(job("production_env_repair"), /Install Production repair tooling[\s\S]*Refuse stale Product commit immediately before Production environment mutation[\s\S]*needs\.production_env_audit\.outputs\.repair_required == 'true'[\s\S]*EXPECTED_MAIN_HEAD_COMMIT:\s*\$\{\{ github\.sha \}\}[\s\S]*verify-production-main-head-cas\.mjs[\s\S]*Repair Production environment only when audit found drift[\s\S]*PRODUCTION_MAIN_HEAD_CAS_REQUIRED:\s*'true'[\s\S]*EXPECTED_MAIN_HEAD_COMMIT:\s*\$\{\{ github\.sha \}\}/u);
const aliasCutover = job("alias_cutover");
assert.match(aliasCutover, /Set up Node\.js[\s\S]*Refuse stale main control commit before preparing alias cutover[\s\S]*EXPECTED_MAIN_HEAD_COMMIT:[\s\S]*verify-production-main-head-cas\.mjs[\s\S]*Re-verify immutable annotated RC6\.2 tag/u);
assert.match(aliasCutover, /Recheck immutable GitHub Release immediately before alias cutover[\s\S]*Recheck main head immediately before alias cutover[\s\S]*verify-production-main-head-cas\.mjs[\s\S]*Cut over both aliases/u);
assert.match(aliasCutover, /Final immutable GitHub Release recheck after public cutover[\s\S]*Final main-head CAS after public cutover[\s\S]*id:\s*main_head_final[\s\S]*continue-on-error:\s*true/u);
assert.match(aliasCutover, /Compensating rollback after final main-head CAS failure[\s\S]*steps\.main_head_final\.outcome != 'success'[\s\S]*vercel-dual-alias-cutover\.mjs restore/u);
const finalizationContract = [
  ["Upload post-cutover verification evidence", "post_cutover_evidence", ["cutover"]],
  ["Write Last Known Good only after public verification passes", "last_known_good_write", [
    "cutover", "public_gate", "immutable_tag_final", "main_head_final", "post_cutover_evidence",
  ]],
  ["Publish dynamic Last Known Good identity", "last_known_good_publish", [
    "cutover", "public_gate", "immutable_tag_final", "main_head_final", "post_cutover_evidence",
    "last_known_good_write",
  ]],
  ["Create sanitized post-Production new-LUNA control-plane evidence", "new_luna_create", [
    "cutover", "public_gate", "immutable_tag_final", "main_head_final", "post_cutover_evidence",
    "last_known_good_write", "last_known_good_publish",
  ]],
  ["Publish sanitized post-Production new-LUNA control-plane evidence", "new_luna_publish", [
    "cutover", "public_gate", "immutable_tag_final", "main_head_final", "post_cutover_evidence",
    "last_known_good_write", "last_known_good_publish", "new_luna_create",
  ]],
  ["Recheck main head after LKG and LUNA evidence publication", "main_head_completion", [
    "cutover", "public_gate", "immutable_tag_final", "main_head_final",
  ]],
];
for (const [name, id, requiredSuccesses] of finalizationContract) {
  const block = workflowStep(aliasCutover, name);
  assert.match(block, new RegExp(`^        id: ${id}$`, "mu"));
  assert.match(block, /^        continue-on-error: true$/mu);
  assert.match(block, /always\(\)/u);
  assert.deepEqual(
    [...block.matchAll(/steps\.([a-z][a-z0-9_]*)\.outcome == 'success'/gu)]
      .map((match) => match[1]),
    requiredSuccesses,
  );
}
assert.match(
  workflowStep(aliasCutover, "Upload post-cutover verification evidence"),
  /if-no-files-found:\s*error/u,
);
assert.match(job("alias_cutover"), /Fail after immutable Release compensating rollback[\s\S]*steps\.immutable_tag_final\.outcome != 'success'/u);
assert.match(aliasCutover, /Fail after main-head CAS compensating rollback[\s\S]*steps\.main_head_final\.outcome != 'success'/u);
assert.match(aliasCutover, /Publish sanitized post-Production new-LUNA control-plane evidence[\s\S]*Recheck main head after LKG and LUNA evidence publication[\s\S]*id:\s*main_head_completion[\s\S]*continue-on-error:\s*true/u);
const failureOutcomeIds = finalizationContract.map(([, id]) => id);
for (const failureStepName of [
  "Compensating rollback after post-cutover finalization failure",
  "Fail after post-cutover finalization reconciliation",
]) {
  const block = workflowStep(aliasCutover, failureStepName);
  assert.match(block, /always\(\)/u);
  assert.deepEqual(
    [...block.matchAll(/steps\.([a-z][a-z0-9_]*)\.outcome != 'success'/gu)]
      .map((match) => match[1]),
    failureOutcomeIds,
  );
}
assert.match(
  workflowStep(aliasCutover, "Compensating rollback after post-cutover finalization failure"),
  /vercel-dual-alias-cutover\.mjs restore/u,
);
assert.match(
  workflowStep(aliasCutover, "Fail after post-cutover finalization reconciliation"),
  /exit 1/u,
);
const restoreDownloadStep = job("restore_known_stable").split("- name: Download latest Last Known Good identity")[1]
  .split("- name: Prove latest Last Known Good selection independently")[0];
for (const expectedVariable of [
  "EXPECTED_LKG_APP_COMMIT",
  "EXPECTED_LKG_PRIMARY_DEPLOYMENT_ID",
  "EXPECTED_LKG_MIRROR_DEPLOYMENT_ID",
  "EXPECTED_LKG_RELEASE_TAG",
  "EXPECTED_LKG_RELEASE_REVISION",
]) assert.match(restoreDownloadStep, new RegExp(`${expectedVariable}: ''`, "u"));
assert.match(job("restore_known_stable"), /Require the latest successful Last Known Good artifact/u);
assert.match(job("restore_known_stable"), /Enforce exact restore control checkout[\s\S]*GITHUB_WORKFLOW_SHA[\s\S]*Restore and verify both production aliases[\s\S]*EXPECTED_MAIN_HEAD_COMMIT:\s*\$\{\{ github\.sha \}\}[\s\S]*verify-production-main-head-cas\.mjs[\s\S]*vercel-dual-alias-cutover\.mjs restore/u);
const lkgDownloadStep = job("alias_cutover").split("- name: Download latest Last Known Good identity")[1]
  .split("- name: Prove exact RC6.1 Last Known Good selection")[0];
assert.doesNotMatch(lkgDownloadStep, /continue-on-error:\s*true/u);
assert.match(job("alias_cutover"), /production-new-luna-control-plane-evidence-/u);
for (const evidenceField of [
  "priorLastKnownGoodArtifactProofDigest",
  "priorLastKnownGoodArtifactId",
  "priorLastKnownGoodRunId",
  "priorLastKnownGoodHeadSha",
  "priorLastKnownGoodProductCommit",
  "priorLastKnownGoodControlCommit",
  "immutableReleaseTagProofDigest",
  "githubReleaseAttestationProofDigest",
  "recoveryControlProofDigest",
  "releaseProductCommit",
  "controlCommit",
  "priorLastKnownGoodSelectionProofDigest",
  "publicPostCutoverReceiptDigest",
  "pending_external_real_browser_gate",
  "not_yet_produced",
]) assert.match(job("alias_cutover"), new RegExp(evidenceField, "u"));

const recoveryComplete = job("recovery_complete");
assert.match(recoveryComplete, /always\(\)[^\r\n]*deploy-immutable-product-recovery/u);
for (const requiredJob of [
  "validate",
  "audit_last_known_good",
  "production_env_audit",
  "production_env_repair",
  "production_build",
  "post_build_secret_scan",
  "staged_deploy",
  "runtime_gates",
  "alias_cutover",
]) assert.match(recoveryComplete, new RegExp(`^      - ${requiredJob}$`, "mu"));
assert.match(recoveryComplete, /\[\[ "\$PRODUCT_COMMIT" == "\$RECOVERY_PRODUCT_COMMIT" \]\]/u);
assert.match(recoveryComplete, /\[\[ "\$CONTROL_COMMIT" == "\$GITHUB_SHA" \]\]/u);

console.log(JSON.stringify({
  schemaVersion: "p24b-rc6.2-runtime-closure-test-v1",
  status: "PASS",
  exactRelease: EXACT_RELEASE,
  immutableAnnotatedTagGate: true,
  immutableGithubReleaseControlPlaneGate: true,
  dynamicTemporalProvenance: true,
  sealedArtifactSecretScanStages: 2,
  lastKnownGoodReadOnlyArtifactProof: true,
  dualShaLastKnownGoodArtifactProof: true,
  lastKnownGoodFailClosed: true,
  newLunaPostProductionEvidence: "sanitized-control-plane-artifact-awaiting-real-browser-gate",
}, null, 2));
