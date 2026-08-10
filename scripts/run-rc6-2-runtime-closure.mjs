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
  discoverLatestLastKnownGoodArtifact,
  downloadLastKnownGoodArtifact,
  selectVerifiedRollbackTarget,
} from "./production-last-known-good.mjs";
import { validateDeploymentTemporalProvenance } from "./verify-deployment-temporal-provenance.mjs";
import { runtimeTemporalProvenance } from "../lib/novel-ai/runtime-truth/release-identity.ts";

const CURRENT_COMMIT = "e84972aaec80885f9e2ab58e56252fb7b93522ea";
const PRIOR_DEPLOYMENT = "dpl_EHemQJyNZtn1NS69tnxQ24dKBRN3";
const EXACT_RELEASE = {
  releaseLine: "novel-ai-p24b-conversation-first-studio-rc6",
  releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.2",
  releaseRevision: "rc6.2",
  releaseName: "P2.4B Conversation-First Novel Project GPT RC6.2",
  consumerRelease: "p2.4b-conversation-first-studio-rc6.2",
  architectureStage: "P2.4B RC",
};

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
    meta: { githubCommitSha: CURRENT_COMMIT },
    projectId: "prj_test",
    teamId: "team_test",
    readyState: "READY",
    target: "production",
    createdAt: Date.parse("2026-08-09T22:56:05.000Z"),
  },
  runtimeIdentity,
  expectedDeploymentId: runtimeIdentity.deploymentId,
  expectedCommit: CURRENT_COMMIT,
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
    appCommit: "f".repeat(40),
    releaseTag: EXACT_RELEASE.releaseTag,
    releaseRevision: EXACT_RELEASE.releaseRevision,
    verifiedAt: "2026-08-09T23:30:00.000Z",
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
        path: ".github/workflows/deploy.yml",
      }),
      body: null,
    };
  },
});
assert.equal(discovered.artifactDigest, `sha256:${"a".repeat(64)}`);
assert.equal(discovered.workflowPath, ".github/workflows/deploy.yml");

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

const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
const jobs = [...workflow.matchAll(/^  ([a-z][a-z0-9_]+):\r?$/gmu)].map((match) => ({ name: match[1], index: match.index }));
const job = (name) => {
  const current = jobs.find((entry) => entry.name === name);
  const next = jobs.find((entry) => entry.index > current.index);
  return workflow.slice(current.index, next?.index ?? workflow.length);
};
assert.deepEqual(
  ["validate", "production_env_audit", "production_env_repair", "production_build", "post_build_secret_scan", "staged_deploy", "runtime_gates", "alias_cutover"]
    .map((name) => jobs.find((entry) => entry.name === name).index)
    .slice().sort((a, b) => a - b),
  ["validate", "production_env_audit", "production_env_repair", "production_build", "post_build_secret_scan", "staged_deploy", "runtime_gates", "alias_cutover"]
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
assert.match(rc62HardeningStep, /pnpm test:ai:rc6\.2:persistence-browser/u);
assert.match(job("validate"), /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'[\s\S]*verify-immutable-release-tag\.mjs remote/u);
assert.match(job("validate"), /Verify final remote RC6\.2 annotated tag is immutable[\s\S]*GITHUB_TOKEN:\s*\$\{\{ github\.token \}\}/u);
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
assert.match(job("runtime_gates"), /api\.vercel\.com\/v13\/deployments|verify-deployment-temporal-provenance\.mjs/u);
assert.match(job("runtime_gates"), /^      temporal_proof_digest:\s*\$\{\{ steps\.temporal\.outputs\.proof_digest \}\}/mu);
assert.match(job("alias_cutover"), /production-last-known-good\.mjs discover[\s\S]*production-last-known-good\.mjs download[\s\S]*DISABLE_CURRENT_CAPTURE:\s*'true'[\s\S]*production-last-known-good\.mjs select/u);
assert.match(job("alias_cutover"), /Recheck immutable GitHub Release immediately before alias cutover[\s\S]*verify-immutable-release-tag\.mjs remote[\s\S]*Cut over both aliases/u);
assert.match(job("alias_cutover"), /Final immutable GitHub Release recheck after public cutover[\s\S]*id:\s*immutable_tag_final[\s\S]*continue-on-error:\s*true/u);
assert.match(job("alias_cutover"), /Compensating rollback after immutable Release recheck failure[\s\S]*steps\.immutable_tag_final\.outcome != 'success'[\s\S]*vercel-dual-alias-cutover\.mjs restore/u);
assert.match(job("alias_cutover"), /Write Last Known Good only after public verification passes[\s\S]*steps\.immutable_tag_final\.outcome == 'success'/u);
assert.match(job("alias_cutover"), /Fail after immutable Release compensating rollback[\s\S]*steps\.immutable_tag_final\.outcome != 'success'/u);
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
const lkgDownloadStep = job("alias_cutover").split("- name: Download latest Last Known Good identity")[1]
  .split("- name: Prove exact RC6.1 Last Known Good selection")[0];
assert.doesNotMatch(lkgDownloadStep, /continue-on-error:\s*true/u);
assert.match(job("alias_cutover"), /production-new-luna-control-plane-evidence-/u);
for (const evidenceField of [
  "priorLastKnownGoodArtifactProofDigest",
  "priorLastKnownGoodArtifactId",
  "priorLastKnownGoodRunId",
  "priorLastKnownGoodHeadSha",
  "immutableReleaseTagProofDigest",
  "priorLastKnownGoodSelectionProofDigest",
  "publicPostCutoverReceiptDigest",
  "pending_external_real_browser_gate",
]) assert.match(job("alias_cutover"), new RegExp(evidenceField, "u"));

console.log(JSON.stringify({
  schemaVersion: "p24b-rc6.2-runtime-closure-test-v1",
  status: "PASS",
  exactRelease: EXACT_RELEASE,
  immutableAnnotatedTagGate: true,
  immutableGithubReleaseControlPlaneGate: true,
  dynamicTemporalProvenance: true,
  sealedArtifactSecretScanStages: 2,
  lastKnownGoodReadOnlyArtifactProof: true,
  lastKnownGoodFailClosed: true,
  newLunaPostProductionEvidence: "sanitized-control-plane-artifact-awaiting-real-browser-gate",
}, null, 2));
