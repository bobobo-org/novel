import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import releaseManifest from "../release-manifest.json" with { type: "json" };
import releaseContract from "../release-metadata-contract.json" with { type: "json" };

const SCHEMA_VERSION = "p24b-rc6.4-exact-preview-static-assets-v1";
const ASSET_DOMAIN = "p24b-rc6.4-exact-preview-static-assets";
const RELEASE_IDENTITY_DOMAIN = "p24b-rc6.4-release-identity-v1";
const MANIFEST_BASENAME = "rc6.4-preview-static-assets.json";
const SIDECAR_BASENAME = "rc6.4-preview-static-assets.sha256";
const MAX_ASSET_COUNT = 25_000;
const MAX_DIRECTORY_COUNT = 10_000;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const HASH_BUFFER_BYTES = 128 * 1024;
const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const FULL_DIGEST = /^[0-9a-f]{64}$/u;
const POSITIVE_RUN_ID = /^[1-9][0-9]{0,19}$/u;
const POSITIVE_RUN_ATTEMPT = /^[1-9][0-9]{0,9}$/u;
const SAFE_URL_PATH = /^\/(?:[A-Za-z0-9._~!$&+,;=:@%-]+\/)*[A-Za-z0-9._~!$&+,;=:@%-]+$/u;

const EXPECTED_ACTIVE_IDENTITY = Object.freeze({
  releaseLine: "novel-ai-p24b-conversation-first-studio-rc6",
  releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.5",
  releaseRevision: "rc6.5",
  releaseName: "P2.4B Conversation-First Novel Project GPT RC6.5",
  consumerRelease: "p2.4b-conversation-first-studio-rc6.5",
  architectureStage: "P2.4B RC",
  releaseBaseCommit: "e9b1091916b53c34ed9676dc4d418baaf696786e",
  releaseEpoch: "2026-08-22T01:06:18.000Z",
  provenanceSchemaVersion: "p24b-rc6.5-build-provenance-v1",
});

function reject(code) {
  throw Object.assign(new Error(code), { code });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(",")}}`;
}

function canonicalJson(value) {
  return `${stableStringify(value)}\n`;
}

function domainDigest(domain, body) {
  return sha256(stableStringify({ domain, body }));
}

function assertExactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    reject(code);
  }
}

function currentReleaseIdentity() {
  const actual = {
    releaseLine: releaseManifest.releaseLine,
    releaseTag: releaseManifest.releaseTag,
    releaseRevision: releaseManifest.releaseRevision,
    releaseName: releaseManifest.releaseName,
    consumerRelease: releaseManifest.consumerRelease,
    architectureStage: releaseManifest.architectureStage,
    releaseBaseCommit: releaseManifest.releaseBaseCommit,
    releaseEpoch: new Date(releaseManifest.releaseEpoch).toISOString(),
    provenanceSchemaVersion: releaseContract.provenanceSchemaVersion,
  };
  for (const [field, expected] of Object.entries(EXPECTED_ACTIVE_IDENTITY)) {
    if (actual[field] !== expected) reject(`RC6_4_STATIC_ASSET_RELEASE_IDENTITY_MISMATCH:${field}`);
  }
  for (const [field, expected] of Object.entries(releaseContract.immutableReleaseIdentity || {})) {
    if (actual[field] !== expected) reject(`RC6_4_STATIC_ASSET_CONTRACT_IDENTITY_MISMATCH:${field}`);
  }
  if (!(releaseContract.allowedProvenanceSchemaVersions || []).includes(actual.provenanceSchemaVersion)) {
    reject("RC6_4_STATIC_ASSET_PROVENANCE_SCHEMA_NOT_ALLOWED");
  }
  return actual;
}

function encodeUrlSegment(segment) {
  if (!segment || segment === "." || segment === "..") reject("RC6_4_STATIC_ASSET_PATH_SEGMENT_INVALID");
  if (segment !== segment.normalize("NFC") || /[\u0000-\u001f\u007f\\/]/u.test(segment)) {
    reject("RC6_4_STATIC_ASSET_PATH_SEGMENT_INVALID");
  }
  return encodeURIComponent(segment).replace(/[!'()*]/gu, (character) => (
    `%${character.codePointAt(0).toString(16).toUpperCase()}`
  ));
}

function urlPathFromSegments(segments) {
  const urlPath = `/${segments.map(encodeUrlSegment).join("/")}`;
  assertSafeUrlPath(urlPath);
  return urlPath;
}

function assertSafeUrlPath(urlPath) {
  if (typeof urlPath !== "string" || !SAFE_URL_PATH.test(urlPath) || urlPath.includes("\\")) {
    reject("RC6_4_STATIC_ASSET_URL_PATH_INVALID");
  }
  let decoded;
  try {
    decoded = urlPath.split("/").slice(1).map((segment) => decodeURIComponent(segment));
  } catch {
    reject("RC6_4_STATIC_ASSET_URL_PATH_INVALID");
  }
  const encoded = urlPath.split("/").slice(1);
  if (decoded.length === 0 || decoded.some((segment, index) => (
    !segment || segment === "." || segment === ".." || segment !== segment.normalize("NFC")
    || /[\u0000-\u001f\u007f\\/]/u.test(segment)
    || encodeUrlSegment(segment) !== encoded[index]
  ))) reject("RC6_4_STATIC_ASSET_URL_PATH_INVALID");
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function hashRegularFile(filePath, initialStats) {
  if (!initialStats.isFile() || initialStats.nlink !== 1) {
    reject("RC6_4_STATIC_ASSET_NOT_SINGLE_LINK_REGULAR_FILE");
  }
  if (!Number.isSafeInteger(initialStats.size) || initialStats.size < 0 || initialStats.size > MAX_FILE_BYTES) {
    reject("RC6_4_STATIC_ASSET_FILE_SIZE_LIMIT_EXCEEDED");
  }
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
  } catch {
    reject("RC6_4_STATIC_ASSET_FILE_OPEN_REJECTED");
  }
  try {
    const openedStats = await handle.stat();
    if (!openedStats.isFile() || openedStats.nlink !== 1 || !sameFileIdentity(initialStats, openedStats)) {
      reject("RC6_4_STATIC_ASSET_FILE_RACE_DETECTED");
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let position = 0;
    while (position < openedStats.size) {
      const length = Math.min(buffer.length, openedStats.size - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead <= 0) reject("RC6_4_STATIC_ASSET_UNEXPECTED_EOF");
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const endRead = await handle.read(buffer, 0, 1, position);
    if (endRead.bytesRead !== 0) reject("RC6_4_STATIC_ASSET_FILE_GREW_DURING_HASH");
    const finalHandleStats = await handle.stat();
    if (!sameFileIdentity(openedStats, finalHandleStats)) {
      reject("RC6_4_STATIC_ASSET_FILE_RACE_DETECTED");
    }
    return digest.digest("hex");
  } finally {
    await handle.close().catch(() => {});
  }
}

async function assertNoReparseAncestors(path) {
  let current = resolve(path);
  while (true) {
    const stats = await lstat(current).catch(() => reject("RC6_4_STATIC_ASSET_ROOT_MISSING"));
    if (stats.isSymbolicLink()) reject("RC6_4_STATIC_ASSET_REPARSE_POINT_REJECTED");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export async function scanStaticAssetRoot(rootPath) {
  const root = resolve(String(rootPath || ""));
  await assertNoReparseAncestors(root);
  const rootStats = await lstat(root).catch(() => reject("RC6_4_STATIC_ASSET_ROOT_MISSING"));
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    reject("RC6_4_STATIC_ASSET_ROOT_NOT_PLAIN_DIRECTORY");
  }
  const directoryIdentities = [{ path: root, stats: rootStats }];
  const assets = [];
  let totalBytes = 0;

  async function walk(directoryPath, segments) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => compareUtf8(left.name, right.name));
    for (const entry of entries) {
      encodeUrlSegment(entry.name);
      const entryPath = join(directoryPath, entry.name);
      const stats = await lstat(entryPath);
      if (stats.isSymbolicLink()) reject("RC6_4_STATIC_ASSET_REPARSE_POINT_REJECTED");
      if (stats.isDirectory()) {
        directoryIdentities.push({ path: entryPath, stats });
        if (directoryIdentities.length > MAX_DIRECTORY_COUNT) {
          reject("RC6_4_STATIC_ASSET_DIRECTORY_COUNT_LIMIT_EXCEEDED");
        }
        await walk(entryPath, [...segments, entry.name]);
        continue;
      }
      if (!stats.isFile()) reject("RC6_4_STATIC_ASSET_NON_REGULAR_ENTRY_REJECTED");
      if (assets.length >= MAX_ASSET_COUNT) reject("RC6_4_STATIC_ASSET_COUNT_LIMIT_EXCEEDED");
      totalBytes += stats.size;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
        reject("RC6_4_STATIC_ASSET_TOTAL_BYTES_LIMIT_EXCEEDED");
      }
      const sha256Digest = await hashRegularFile(entryPath, stats);
      const postHashStats = await lstat(entryPath);
      if (!sameFileIdentity(stats, postHashStats)) reject("RC6_4_STATIC_ASSET_FILE_RACE_DETECTED");
      assets.push({
        urlPath: urlPathFromSegments([...segments, entry.name]),
        sizeBytes: stats.size,
        sha256: sha256Digest,
      });
    }
  }

  await walk(root, []);
  if (assets.length === 0) reject("RC6_4_STATIC_ASSET_ROOT_EMPTY");
  assets.sort((left, right) => compareUtf8(left.urlPath, right.urlPath));
  for (let index = 1; index < assets.length; index += 1) {
    if (assets[index - 1].urlPath === assets[index].urlPath) {
      reject("RC6_4_STATIC_ASSET_URL_COLLISION");
    }
  }
  for (const directory of directoryIdentities.reverse()) {
    const current = await lstat(directory.path);
    if (current.isSymbolicLink() || !current.isDirectory() || !sameFileIdentity(directory.stats, current)) {
      reject("RC6_4_STATIC_ASSET_DIRECTORY_RACE_DETECTED");
    }
  }
  return { assets, totalBytes };
}

function normalizeContext({ productCommit, runId, runAttempt, diagnosticsFlag }) {
  const normalized = {
    productCommit: String(productCommit || "").trim().toLowerCase(),
    githubRunId: String(runId || "").trim(),
    githubRunAttempt: String(runAttempt || "").trim(),
    diagnosticsFlag: String(diagnosticsFlag || "").trim(),
  };
  if (!FULL_COMMIT.test(normalized.productCommit)) reject("RC6_4_STATIC_ASSET_PRODUCT_COMMIT_INVALID");
  if (!POSITIVE_RUN_ID.test(normalized.githubRunId)) reject("RC6_4_STATIC_ASSET_RUN_ID_INVALID");
  if (!POSITIVE_RUN_ATTEMPT.test(normalized.githubRunAttempt)) {
    reject("RC6_4_STATIC_ASSET_RUN_ATTEMPT_INVALID");
  }
  if (normalized.diagnosticsFlag !== "1") reject("RC6_4_STATIC_ASSET_PREVIEW_DIAGNOSTICS_NOT_ENABLED");
  return normalized;
}

function createManifest({ assets, totalBytes, context }) {
  const releaseIdentity = currentReleaseIdentity();
  const releaseIdentityDigest = domainDigest(RELEASE_IDENTITY_DOMAIN, releaseIdentity);
  const assetDomainBody = {
    productCommit: context.productCommit,
    diagnosticsFlag: context.diagnosticsFlag,
    releaseIdentityDigest,
    assets,
  };
  const body = {
    schemaVersion: SCHEMA_VERSION,
    status: "PASS",
    assetDomain: ASSET_DOMAIN,
    productCommit: context.productCommit,
    githubRunId: context.githubRunId,
    githubRunAttempt: context.githubRunAttempt,
    environment: "preview",
    diagnosticsFlag: context.diagnosticsFlag,
    assetRoot: "vercel-output-static",
    assetCount: assets.length,
    totalBytes,
    bounds: {
      maxAssetCount: MAX_ASSET_COUNT,
      maxDirectoryCount: MAX_DIRECTORY_COUNT,
      maxFileBytes: MAX_FILE_BYTES,
      maxTotalBytes: MAX_TOTAL_BYTES,
    },
    releaseIdentity,
    releaseIdentityDigest,
    assetDomainDigest: domainDigest(ASSET_DOMAIN, assetDomainBody),
    assets,
    sanitized: true,
    localPathsIncluded: false,
  };
  return {
    ...body,
    manifestDigest: domainDigest(SCHEMA_VERSION, body),
  };
}

function outputPaths({ manifestPath, sidecarPath, rootPath }) {
  const rawManifest = String(manifestPath || "");
  const rawSidecar = String(sidecarPath || "");
  if (!isAbsolute(rawManifest) || !isAbsolute(rawSidecar)) {
    reject("RC6_4_STATIC_ASSET_OUTPUT_PATH_INVALID");
  }
  const manifest = resolve(rawManifest);
  const sidecar = resolve(rawSidecar);
  const root = resolve(String(rootPath || ""));
  if (manifest === sidecar) {
    reject("RC6_4_STATIC_ASSET_OUTPUT_PATH_INVALID");
  }
  if (basename(manifest) !== MANIFEST_BASENAME || basename(sidecar) !== SIDECAR_BASENAME) {
    reject("RC6_4_STATIC_ASSET_OUTPUT_BASENAME_INVALID");
  }
  if (dirname(manifest) !== dirname(sidecar)) reject("RC6_4_STATIC_ASSET_OUTPUT_DIRECTORY_MISMATCH");
  const manifestRelative = relative(root, manifest);
  const sidecarRelative = relative(root, sidecar);
  if ((!manifestRelative.startsWith(`..${sep}`) && manifestRelative !== "..")
    || (!sidecarRelative.startsWith(`..${sep}`) && sidecarRelative !== "..")) {
    reject("RC6_4_STATIC_ASSET_OUTPUT_INSIDE_ASSET_ROOT");
  }
  return { manifest, sidecar };
}

async function assertPlainOutputParent(path) {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const stats = await lstat(parent);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    reject("RC6_4_STATIC_ASSET_OUTPUT_PARENT_INVALID");
  }
}

async function assertOutputAbsent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  reject("RC6_4_STATIC_ASSET_OUTPUT_ALREADY_EXISTS");
}

export async function generateStaticAssetManifest({
  rootPath,
  manifestPath,
  sidecarPath,
  productCommit,
  runId,
  runAttempt,
  diagnosticsFlag,
}) {
  const context = normalizeContext({ productCommit, runId, runAttempt, diagnosticsFlag });
  const paths = outputPaths({ manifestPath, sidecarPath, rootPath });
  await assertPlainOutputParent(paths.manifest);
  await Promise.all([assertOutputAbsent(paths.manifest), assertOutputAbsent(paths.sidecar)]);
  const { assets, totalBytes } = await scanStaticAssetRoot(rootPath);
  const manifest = createManifest({ assets, totalBytes, context });
  const manifestBytes = canonicalJson(manifest);
  if (Buffer.byteLength(manifestBytes, "utf8") > MAX_MANIFEST_BYTES) {
    reject("RC6_4_STATIC_ASSET_MANIFEST_SIZE_LIMIT_EXCEEDED");
  }
  const manifestSha256 = sha256(manifestBytes);
  const sidecarBytes = `${manifestSha256}  ${MANIFEST_BASENAME}\n`;
  const token = `${process.pid}-${randomUUID()}`;
  const temporarySidecar = join(dirname(paths.sidecar), `.${SIDECAR_BASENAME}.${token}.tmp`);
  const temporaryManifest = join(dirname(paths.manifest), `.${MANIFEST_BASENAME}.${token}.tmp`);
  try {
    await writeFile(temporarySidecar, sidecarBytes, { encoding: "utf8", flag: "wx" });
    await writeFile(temporaryManifest, manifestBytes, { encoding: "utf8", flag: "wx" });
    await rename(temporarySidecar, paths.sidecar);
    await rename(temporaryManifest, paths.manifest);
  } catch (error) {
    await Promise.all([
      unlink(temporarySidecar).catch(() => {}),
      unlink(temporaryManifest).catch(() => {}),
    ]);
    throw error;
  }
  return { manifest, manifestSha256 };
}

function validateAssetEntries(manifest) {
  if (!Array.isArray(manifest.assets) || manifest.assets.length < 1
    || manifest.assets.length > MAX_ASSET_COUNT) {
    reject("RC6_4_STATIC_ASSET_ASSET_LIST_INVALID");
  }
  let totalBytes = 0;
  let previous = "";
  for (const asset of manifest.assets) {
    assertExactKeys(asset, ["urlPath", "sizeBytes", "sha256"], "RC6_4_STATIC_ASSET_ENTRY_KEYS_INVALID");
    assertSafeUrlPath(asset.urlPath);
    if (previous && compareUtf8(previous, asset.urlPath) >= 0) {
      reject("RC6_4_STATIC_ASSET_LIST_NOT_EXACTLY_SORTED");
    }
    previous = asset.urlPath;
    if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0 || asset.sizeBytes > MAX_FILE_BYTES) {
      reject("RC6_4_STATIC_ASSET_ENTRY_SIZE_INVALID");
    }
    if (!FULL_DIGEST.test(asset.sha256)) reject("RC6_4_STATIC_ASSET_ENTRY_DIGEST_INVALID");
    totalBytes += asset.sizeBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
      reject("RC6_4_STATIC_ASSET_TOTAL_BYTES_LIMIT_EXCEEDED");
    }
  }
  if (manifest.assetCount !== manifest.assets.length || manifest.totalBytes !== totalBytes) {
    reject("RC6_4_STATIC_ASSET_TOTALS_MISMATCH");
  }
}

function validateManifestSemantics(manifest, context) {
  assertExactKeys(manifest, [
    "schemaVersion", "status", "assetDomain", "productCommit", "githubRunId",
    "githubRunAttempt", "environment", "diagnosticsFlag", "assetRoot", "assetCount",
    "totalBytes", "bounds", "releaseIdentity", "releaseIdentityDigest", "assetDomainDigest",
    "assets", "sanitized", "localPathsIncluded", "manifestDigest",
  ], "RC6_4_STATIC_ASSET_MANIFEST_KEYS_INVALID");
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.status !== "PASS"
    || manifest.assetDomain !== ASSET_DOMAIN || manifest.environment !== "preview"
    || manifest.assetRoot !== "vercel-output-static" || manifest.sanitized !== true
    || manifest.localPathsIncluded !== false) {
    reject("RC6_4_STATIC_ASSET_MANIFEST_IDENTITY_INVALID");
  }
  if (manifest.productCommit !== context.productCommit
    || manifest.githubRunId !== context.githubRunId
    || manifest.githubRunAttempt !== context.githubRunAttempt
    || manifest.diagnosticsFlag !== context.diagnosticsFlag) {
    reject("RC6_4_STATIC_ASSET_EXECUTION_CONTEXT_MISMATCH");
  }
  assertExactKeys(manifest.bounds, [
    "maxAssetCount", "maxDirectoryCount", "maxFileBytes", "maxTotalBytes",
  ], "RC6_4_STATIC_ASSET_BOUNDS_INVALID");
  if (manifest.bounds.maxAssetCount !== MAX_ASSET_COUNT
    || manifest.bounds.maxDirectoryCount !== MAX_DIRECTORY_COUNT
    || manifest.bounds.maxFileBytes !== MAX_FILE_BYTES
    || manifest.bounds.maxTotalBytes !== MAX_TOTAL_BYTES) {
    reject("RC6_4_STATIC_ASSET_BOUNDS_INVALID");
  }
  const expectedReleaseIdentity = currentReleaseIdentity();
  if (stableStringify(manifest.releaseIdentity) !== stableStringify(expectedReleaseIdentity)) {
    reject("RC6_4_STATIC_ASSET_RELEASE_IDENTITY_MISMATCH");
  }
  const expectedReleaseIdentityDigest = domainDigest(RELEASE_IDENTITY_DOMAIN, expectedReleaseIdentity);
  if (manifest.releaseIdentityDigest !== expectedReleaseIdentityDigest) {
    reject("RC6_4_STATIC_ASSET_RELEASE_IDENTITY_DIGEST_MISMATCH");
  }
  validateAssetEntries(manifest);
  const expectedAssetDomainDigest = domainDigest(ASSET_DOMAIN, {
    productCommit: context.productCommit,
    diagnosticsFlag: context.diagnosticsFlag,
    releaseIdentityDigest: expectedReleaseIdentityDigest,
    assets: manifest.assets,
  });
  if (manifest.assetDomainDigest !== expectedAssetDomainDigest) {
    reject("RC6_4_STATIC_ASSET_DOMAIN_DIGEST_MISMATCH");
  }
  const { manifestDigest, ...body } = manifest;
  if (manifestDigest !== domainDigest(SCHEMA_VERSION, body)) {
    reject("RC6_4_STATIC_ASSET_MANIFEST_DIGEST_MISMATCH");
  }
}

async function readBoundedRegularFile(path, maxBytes, code) {
  const stats = await lstat(path).catch(() => reject(code));
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1
    || !Number.isSafeInteger(stats.size) || stats.size < 1 || stats.size > maxBytes) {
    reject(code);
  }
  const bytes = await readFile(path);
  const postRead = await lstat(path);
  if (!sameFileIdentity(stats, postRead)) reject(`${code}_RACE`);
  return bytes;
}

export async function validateStaticAssetManifest({
  rootPath,
  manifestPath,
  sidecarPath,
  productCommit,
  runId,
  runAttempt,
  diagnosticsFlag,
}) {
  const context = normalizeContext({ productCommit, runId, runAttempt, diagnosticsFlag });
  const paths = outputPaths({ manifestPath, sidecarPath, rootPath });
  const manifestBuffer = await readBoundedRegularFile(
    paths.manifest,
    MAX_MANIFEST_BYTES,
    "RC6_4_STATIC_ASSET_MANIFEST_FILE_INVALID",
  );
  if (manifestBuffer[0] === 0xef && manifestBuffer[1] === 0xbb && manifestBuffer[2] === 0xbf) {
    reject("RC6_4_STATIC_ASSET_MANIFEST_NOT_CANONICAL");
  }
  const manifestText = manifestBuffer.toString("utf8");
  if (!Buffer.from(manifestText, "utf8").equals(manifestBuffer)
    || !manifestText.endsWith("\n") || manifestText.includes("\r")) {
    reject("RC6_4_STATIC_ASSET_MANIFEST_NOT_CANONICAL");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    reject("RC6_4_STATIC_ASSET_MANIFEST_JSON_INVALID");
  }
  if (canonicalJson(manifest) !== manifestText) reject("RC6_4_STATIC_ASSET_MANIFEST_NOT_CANONICAL");
  validateManifestSemantics(manifest, context);
  const sidecarBuffer = await readBoundedRegularFile(
    paths.sidecar,
    256,
    "RC6_4_STATIC_ASSET_SIDECAR_FILE_INVALID",
  );
  const expectedSidecar = `${sha256(manifestBuffer)}  ${MANIFEST_BASENAME}\n`;
  if (sidecarBuffer.toString("utf8") !== expectedSidecar) {
    reject("RC6_4_STATIC_ASSET_SIDECAR_MISMATCH");
  }
  const actual = await scanStaticAssetRoot(rootPath);
  if (actual.totalBytes !== manifest.totalBytes
    || stableStringify(actual.assets) !== stableStringify(manifest.assets)) {
    reject("RC6_4_STATIC_ASSET_FILESYSTEM_MISMATCH");
  }
  const localRoot = resolve(String(rootPath || ""));
  if (manifestText.includes(localRoot) || manifestText.includes("\\")) {
    reject("RC6_4_STATIC_ASSET_LOCAL_PATH_LEAK");
  }
  return {
    status: "PASS",
    schemaVersion: manifest.schemaVersion,
    productCommit: manifest.productCommit,
    assetCount: manifest.assetCount,
    totalBytes: manifest.totalBytes,
    assetDomainDigest: manifest.assetDomainDigest,
    manifestDigest: manifest.manifestDigest,
    manifestSha256: sha256(manifestBuffer),
  };
}

async function rewriteManifestPair(manifestPath, sidecarPath, manifest, { canonical = true } = {}) {
  const text = canonical ? canonicalJson(manifest) : `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, text, "utf8");
  await writeFile(sidecarPath, `${sha256(text)}  ${MANIFEST_BASENAME}\n`, "utf8");
}

async function expectCode(action, pattern) {
  let thrown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, `expected rejection matching ${pattern}`);
  assert.match(String(thrown.code || thrown.message), pattern);
}

async function createFixture(parent, name) {
  const fixture = join(parent, name);
  const rootPath = join(fixture, ".vercel", "output", "static");
  const evidencePath = join(fixture, "evidence");
  await mkdir(join(rootPath, "_next", "static"), { recursive: true });
  await mkdir(evidencePath, { recursive: true });
  await writeFile(join(rootPath, "index.html"), "<!doctype html>\n", "utf8");
  await writeFile(join(rootPath, "_next", "static", "chunk.js"), "self.__RC64__=1;\n", "utf8");
  return {
    rootPath,
    manifestPath: join(evidencePath, MANIFEST_BASENAME),
    sidecarPath: join(evidencePath, SIDECAR_BASENAME),
    productCommit: "a".repeat(40),
    runId: "123456789",
    runAttempt: "2",
    diagnosticsFlag: "1",
  };
}

export async function runSelfTest() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-rc64-static-assets-"));
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  const resolvedSystemTemp = resolve(tmpdir());
  if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${sep}`)
    || !basename(resolvedTemporaryRoot).startsWith("novel-rc64-static-assets-")) {
    reject("RC6_4_STATIC_ASSET_SELF_TEST_TEMP_INVALID");
  }
  const checks = [];
  try {
    const valid = await createFixture(temporaryRoot, "valid");
    await generateStaticAssetManifest(valid);
    const validResult = await validateStaticAssetManifest(valid);
    assert.equal(validResult.status, "PASS");
    const validRaw = await readFile(valid.manifestPath, "utf8");
    assert.ok(!validRaw.includes(resolve(valid.rootPath)) && !validRaw.includes("\\"));
    checks.push("valid");

    const extra = await createFixture(temporaryRoot, "extra");
    await generateStaticAssetManifest(extra);
    await writeFile(join(extra.rootPath, "extra.txt"), "extra\n", "utf8");
    await expectCode(() => validateStaticAssetManifest(extra), /FILESYSTEM_MISMATCH/u);
    checks.push("extra");

    const missing = await createFixture(temporaryRoot, "missing");
    await generateStaticAssetManifest(missing);
    await unlink(join(missing.rootPath, "index.html"));
    await expectCode(() => validateStaticAssetManifest(missing), /FILESYSTEM_MISMATCH/u);
    checks.push("missing");

    const reparse = await createFixture(temporaryRoot, "reparse");
    const outside = join(temporaryRoot, "reparse-target");
    await mkdir(outside);
    await symlink(outside, join(reparse.rootPath, "linked"), process.platform === "win32" ? "junction" : "dir");
    await expectCode(() => generateStaticAssetManifest(reparse), /REPARSE_POINT_REJECTED/u);
    checks.push("reparse");

    const traversal = await createFixture(temporaryRoot, "traversal");
    await generateStaticAssetManifest(traversal);
    const traversalManifest = JSON.parse(await readFile(traversal.manifestPath, "utf8"));
    traversalManifest.assets[0].urlPath = "/../escape.js";
    await rewriteManifestPair(traversal.manifestPath, traversal.sidecarPath, traversalManifest);
    await expectCode(() => validateStaticAssetManifest(traversal), /URL_PATH_INVALID/u);
    checks.push("path-traversal");

    const mutation = await createFixture(temporaryRoot, "hash-mutation");
    await generateStaticAssetManifest(mutation);
    await writeFile(join(mutation.rootPath, "index.html"), "<!doctype htmL>\n", "utf8");
    await expectCode(() => validateStaticAssetManifest(mutation), /FILESYSTEM_MISMATCH/u);
    checks.push("hash-mutation");

    const nonCanonical = await createFixture(temporaryRoot, "non-canonical");
    await generateStaticAssetManifest(nonCanonical);
    const nonCanonicalManifest = JSON.parse(await readFile(nonCanonical.manifestPath, "utf8"));
    await rewriteManifestPair(
      nonCanonical.manifestPath,
      nonCanonical.sidecarPath,
      nonCanonicalManifest,
      { canonical: false },
    );
    await expectCode(() => validateStaticAssetManifest(nonCanonical), /MANIFEST_NOT_CANONICAL/u);
    checks.push("canonical-negative");
  } finally {
    await rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
  return { status: "PASS", schemaVersion: SCHEMA_VERSION, checks };
}

function cliOptions() {
  return {
    rootPath: process.env.RC6_4_STATIC_ASSET_ROOT || ".vercel/output/static",
    manifestPath: process.env.RC6_4_STATIC_ASSET_MANIFEST_PATH,
    sidecarPath: process.env.RC6_4_STATIC_ASSET_SIDECAR_PATH,
    productCommit: process.env.RC6_4_PRODUCT_COMMIT ?? process.env.EXPECTED_PRODUCT_COMMIT,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    diagnosticsFlag: process.env.NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS,
  };
}

async function runCli(mode) {
  if (mode === "self-test") return runSelfTest();
  if (mode === "generate") return generateStaticAssetManifest(cliOptions());
  if (mode === "validate") return validateStaticAssetManifest(cliOptions());
  reject("RC6_4_STATIC_ASSET_MODE_INVALID");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runCli(process.argv[2]);
    process.stdout.write(`${JSON.stringify({
      status: result.status || "PASS",
      schemaVersion: result.schemaVersion || result.manifest?.schemaVersion,
      productCommit: result.productCommit || result.manifest?.productCommit,
      assetCount: result.assetCount ?? result.manifest?.assetCount,
      totalBytes: result.totalBytes ?? result.manifest?.totalBytes,
      assetDomainDigest: result.assetDomainDigest || result.manifest?.assetDomainDigest,
      manifestDigest: result.manifestDigest || result.manifest?.manifestDigest,
      manifestSha256: result.manifestSha256,
      checks: result.checks,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "REJECT",
      safeErrorCode: error?.code || "RC6_4_STATIC_ASSET_MANIFEST_FAILED",
    })}\n`);
    process.exitCode = 1;
  }
}
