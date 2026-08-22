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
import {
  generateStaticAssetManifest as generatePreviewStaticAssetManifest,
  scanStaticAssetRoot,
  validateStaticAssetManifest as validatePreviewStaticAssetManifest,
} from "./generate-rc6-4-static-asset-manifest.mjs";

export const RC6_4_PRODUCTION_STATIC_NETWORK_SCHEMA =
  "p24b-rc6.4-formal-production-static-network-manifest-v1";
export const RC6_4_PRODUCTION_STATIC_ASSET_DOMAIN =
  "p24b-rc6.4-formal-production-static-network-assets-v1";
export const RC6_4_PRODUCTION_STATIC_MANIFEST_BASENAME =
  "rc6.4-production-static-network-manifest.json";
export const RC6_4_PRODUCTION_STATIC_SIDECAR_BASENAME =
  "rc6.4-production-static-network-manifest.sha256";
export const RC6_4_PRODUCTION_ORIGIN = "https://novel-orcin.vercel.app";

const MAX_ASSET_COUNT = 25_000;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const FULL_DIGEST = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{8,96}$/u;
const SAFE_URL_PATH = /^\/(?:[A-Za-z0-9._~!$&+,;=:@%-]+\/)*[A-Za-z0-9._~!$&+,;=:@%-]+$/u;
const EXPECTED_RELEASE_IDENTITY = Object.freeze({
  releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.5",
  releaseRevision: "rc6.5",
  releaseName: "P2.4B Conversation-First Novel Project GPT RC6.5",
  consumerRelease: "p2.4b-conversation-first-studio-rc6.5",
});
const EXPECTED_RELEASE_ENVELOPE = Object.freeze({
  releaseLine: "novel-ai-p24b-conversation-first-studio-rc6",
  ...EXPECTED_RELEASE_IDENTITY,
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

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function assertExactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) reject(code);
}

function encodeUrlSegment(segment) {
  if (!segment || segment === "." || segment === ".."
    || segment !== segment.normalize("NFC")
    || /[\u0000-\u001f\u007f\\/]/u.test(segment)) {
    reject("RC6_4_PRODUCTION_STATIC_URL_PATH_INVALID");
  }
  return encodeURIComponent(segment).replace(/[!'()*]/gu, (character) => (
    `%${character.codePointAt(0).toString(16).toUpperCase()}`
  ));
}

function assertSafeUrlPath(urlPath) {
  if (typeof urlPath !== "string" || !SAFE_URL_PATH.test(urlPath) || urlPath.includes("\\")) {
    reject("RC6_4_PRODUCTION_STATIC_URL_PATH_INVALID");
  }
  const encoded = urlPath.split("/").slice(1);
  let decoded;
  try {
    decoded = encoded.map((segment) => decodeURIComponent(segment));
  } catch {
    reject("RC6_4_PRODUCTION_STATIC_URL_PATH_INVALID");
  }
  if (decoded.length === 0 || decoded.some((segment, index) => (
    encodeUrlSegment(segment) !== encoded[index]
  ))) reject("RC6_4_PRODUCTION_STATIC_URL_PATH_INVALID");
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
  for (const [key, expected] of Object.entries(EXPECTED_RELEASE_ENVELOPE)) {
    if (actual[key] !== expected) {
      reject(`RC6_4_PRODUCTION_STATIC_RELEASE_IDENTITY_MISMATCH:${key}`);
    }
  }
  for (const [key, expected] of Object.entries(releaseContract.immutableReleaseIdentity || {})) {
    if (actual[key] !== expected) {
      reject(`RC6_4_PRODUCTION_STATIC_RELEASE_CONTRACT_MISMATCH:${key}`);
    }
  }
  return { ...EXPECTED_RELEASE_IDENTITY };
}

function normalizeContext({ productCommit, deploymentId, productionOrigin, diagnosticsFlag }) {
  const context = {
    productCommit: String(productCommit || "").trim().toLowerCase(),
    deploymentId: String(deploymentId || "").trim(),
    productionOrigin: String(productionOrigin || "").trim(),
    diagnosticsFlag: String(diagnosticsFlag || "").trim(),
  };
  if (!FULL_COMMIT.test(context.productCommit)) {
    reject("RC6_4_PRODUCTION_STATIC_PRODUCT_COMMIT_INVALID");
  }
  if (!DEPLOYMENT_ID.test(context.deploymentId)) {
    reject("RC6_4_PRODUCTION_STATIC_DEPLOYMENT_ID_INVALID");
  }
  if (context.productionOrigin !== RC6_4_PRODUCTION_ORIGIN) {
    reject("RC6_4_PRODUCTION_STATIC_ORIGIN_INVALID");
  }
  if (context.diagnosticsFlag !== "0") {
    reject("RC6_4_PRODUCTION_STATIC_DIAGNOSTICS_NOT_DISABLED");
  }
  return context;
}

function assertStaticRootTopology(rootPath) {
  const root = resolve(String(rootPath || ""));
  if (basename(root) !== "static" || basename(dirname(root)) !== "output"
    || basename(dirname(dirname(root))) !== ".vercel") {
    reject("RC6_4_PRODUCTION_STATIC_ROOT_TOPOLOGY_INVALID");
  }
  return root;
}

async function assertNoReparseAncestors(targetPath, missingAllowed = false) {
  let current = resolve(targetPath);
  while (true) {
    const stats = await lstat(current).catch((error) => {
      if (missingAllowed && error?.code === "ENOENT") return null;
      reject("RC6_4_PRODUCTION_STATIC_PATH_INVALID");
    });
    if (stats?.isSymbolicLink()) reject("RC6_4_PRODUCTION_STATIC_REPARSE_POINT_REJECTED");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function outputPaths({ rootPath, manifestPath, sidecarPath }) {
  if (!isAbsolute(String(manifestPath || "")) || !isAbsolute(String(sidecarPath || ""))) {
    reject("RC6_4_PRODUCTION_STATIC_OUTPUT_PATH_INVALID");
  }
  const root = assertStaticRootTopology(rootPath);
  const manifest = resolve(manifestPath);
  const sidecar = resolve(sidecarPath);
  if (manifest === sidecar || dirname(manifest) !== dirname(sidecar)
    || basename(manifest) !== RC6_4_PRODUCTION_STATIC_MANIFEST_BASENAME
    || basename(sidecar) !== RC6_4_PRODUCTION_STATIC_SIDECAR_BASENAME) {
    reject("RC6_4_PRODUCTION_STATIC_OUTPUT_PATH_INVALID");
  }
  for (const output of [manifest, sidecar]) {
    const relation = relative(root, output);
    if (!relation.startsWith(`..${sep}`) && relation !== "..") {
      reject("RC6_4_PRODUCTION_STATIC_OUTPUT_INSIDE_ASSET_ROOT");
    }
  }
  return { root, manifest, sidecar, outputDirectory: dirname(manifest) };
}

function createManifest({ assets, totalBytes, context }) {
  const releaseIdentity = currentReleaseIdentity();
  const assetDomainBody = {
    productCommit: context.productCommit,
    deploymentId: context.deploymentId,
    productionOrigin: context.productionOrigin,
    diagnosticsFlag: context.diagnosticsFlag,
    releaseIdentity,
    assets,
  };
  const body = {
    schemaVersion: RC6_4_PRODUCTION_STATIC_NETWORK_SCHEMA,
    status: "PASS",
    assetDomain: RC6_4_PRODUCTION_STATIC_ASSET_DOMAIN,
    environment: "production",
    diagnosticsFlag: context.diagnosticsFlag,
    assetRoot: "vercel-output-static",
    productCommit: context.productCommit,
    deploymentId: context.deploymentId,
    productionOrigin: context.productionOrigin,
    releaseIdentity,
    assetCount: assets.length,
    totalBytes,
    assets,
    sanitized: true,
    localPathsIncluded: false,
    assetDomainDigest: domainDigest(RC6_4_PRODUCTION_STATIC_ASSET_DOMAIN, assetDomainBody),
  };
  return { ...body, manifestDigest: domainDigest(RC6_4_PRODUCTION_STATIC_NETWORK_SCHEMA, body) };
}

async function readBoundedRegularFile(filePath, maxBytes, code) {
  const before = await lstat(filePath).catch(() => reject(code));
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1
    || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > maxBytes) {
    reject(code);
  }
  const bytes = await readFile(filePath);
  const after = await lstat(filePath).catch(() => reject(code));
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    reject(`${code}_RACE`);
  }
  return bytes;
}

async function syncDirectory(directoryPath) {
  let handle;
  try {
    handle = await open(directoryPath, fsConstants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EISDIR", "EINVAL"].includes(error?.code)) {
      throw error;
    }
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function writeDurableNewFile(filePath, bytes) {
  const handle = await open(filePath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishManifestPairAtomically(paths, manifestBytes, sidecarBytes) {
  const container = dirname(paths.outputDirectory);
  await mkdir(container, { recursive: true });
  await assertNoReparseAncestors(container);
  const existing = await lstat(paths.outputDirectory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing) reject("RC6_4_PRODUCTION_STATIC_OUTPUT_ALREADY_EXISTS");
  const stagingDirectory = join(
    container,
    `.${basename(paths.outputDirectory)}.${process.pid}-${randomUUID()}.tmp`,
  );
  await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
  let published = false;
  try {
    await writeDurableNewFile(
      join(stagingDirectory, RC6_4_PRODUCTION_STATIC_MANIFEST_BASENAME),
      manifestBytes,
    );
    await writeDurableNewFile(
      join(stagingDirectory, RC6_4_PRODUCTION_STATIC_SIDECAR_BASENAME),
      sidecarBytes,
    );
    await syncDirectory(stagingDirectory);
    await rename(stagingDirectory, paths.outputDirectory);
    published = true;
    await syncDirectory(container);
  } finally {
    if (!published) await rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function generateProductionStaticNetworkManifest({
  rootPath,
  manifestPath,
  sidecarPath,
  productCommit,
  deploymentId,
  productionOrigin,
  diagnosticsFlag,
}) {
  const context = normalizeContext({
    productCommit, deploymentId, productionOrigin, diagnosticsFlag,
  });
  const paths = outputPaths({ rootPath, manifestPath, sidecarPath });
  const { assets, totalBytes } = await scanStaticAssetRoot(paths.root);
  const manifest = createManifest({ assets, totalBytes, context });
  const manifestBytes = canonicalJson(manifest);
  if (Buffer.byteLength(manifestBytes) > MAX_MANIFEST_BYTES) {
    reject("RC6_4_PRODUCTION_STATIC_MANIFEST_SIZE_LIMIT_EXCEEDED");
  }
  const manifestFileDigest = sha256(manifestBytes);
  const sidecarBytes = `${manifestFileDigest}  ${RC6_4_PRODUCTION_STATIC_MANIFEST_BASENAME}\n`;
  await publishManifestPairAtomically(paths, manifestBytes, sidecarBytes);
  return { manifest, manifestFileDigest };
}

function validateAssetEntries(manifest) {
  if (!Array.isArray(manifest.assets) || manifest.assets.length < 1
    || manifest.assets.length > MAX_ASSET_COUNT) {
    reject("RC6_4_PRODUCTION_STATIC_ASSET_LIST_INVALID");
  }
  let totalBytes = 0;
  let previousPath = "";
  for (const asset of manifest.assets) {
    assertExactKeys(asset, ["sha256", "sizeBytes", "urlPath"],
      "RC6_4_PRODUCTION_STATIC_ASSET_ENTRY_INVALID");
    assertSafeUrlPath(asset.urlPath);
    if (previousPath && compareUtf8(previousPath, asset.urlPath) >= 0) {
      reject("RC6_4_PRODUCTION_STATIC_ASSET_ORDER_INVALID");
    }
    previousPath = asset.urlPath;
    if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 0
      || asset.sizeBytes > MAX_FILE_BYTES || !FULL_DIGEST.test(asset.sha256)) {
      reject("RC6_4_PRODUCTION_STATIC_ASSET_ENTRY_INVALID");
    }
    totalBytes += asset.sizeBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
      reject("RC6_4_PRODUCTION_STATIC_TOTAL_BYTES_INVALID");
    }
  }
  if (manifest.assetCount !== manifest.assets.length || manifest.totalBytes !== totalBytes) {
    reject("RC6_4_PRODUCTION_STATIC_TOTALS_MISMATCH");
  }
}

function validateManifestSemantics(manifest, context) {
  assertExactKeys(manifest, [
    "schemaVersion", "status", "assetDomain", "environment", "diagnosticsFlag",
    "assetRoot", "productCommit", "deploymentId", "productionOrigin",
    "releaseIdentity", "assetCount", "totalBytes", "assets", "sanitized",
    "localPathsIncluded", "assetDomainDigest", "manifestDigest",
  ], "RC6_4_PRODUCTION_STATIC_MANIFEST_SHAPE_INVALID");
  if (manifest.schemaVersion !== RC6_4_PRODUCTION_STATIC_NETWORK_SCHEMA
    || manifest.status !== "PASS"
    || manifest.assetDomain !== RC6_4_PRODUCTION_STATIC_ASSET_DOMAIN
    || manifest.environment !== "production" || manifest.diagnosticsFlag !== "0"
    || manifest.assetRoot !== "vercel-output-static" || manifest.sanitized !== true
    || manifest.localPathsIncluded !== false) {
    reject("RC6_4_PRODUCTION_STATIC_MANIFEST_IDENTITY_INVALID");
  }
  if (manifest.productCommit !== context.productCommit
    || manifest.deploymentId !== context.deploymentId
    || manifest.productionOrigin !== context.productionOrigin
    || manifest.diagnosticsFlag !== context.diagnosticsFlag) {
    reject("RC6_4_PRODUCTION_STATIC_EXECUTION_CONTEXT_MISMATCH");
  }
  const releaseIdentity = currentReleaseIdentity();
  assertExactKeys(manifest.releaseIdentity, Object.keys(EXPECTED_RELEASE_IDENTITY),
    "RC6_4_PRODUCTION_STATIC_RELEASE_IDENTITY_MISMATCH");
  if (stableStringify(manifest.releaseIdentity) !== stableStringify(releaseIdentity)) {
    reject("RC6_4_PRODUCTION_STATIC_RELEASE_IDENTITY_MISMATCH");
  }
  validateAssetEntries(manifest);
  const expectedAssetDomainDigest = domainDigest(RC6_4_PRODUCTION_STATIC_ASSET_DOMAIN, {
    productCommit: context.productCommit,
    deploymentId: context.deploymentId,
    productionOrigin: context.productionOrigin,
    diagnosticsFlag: context.diagnosticsFlag,
    releaseIdentity,
    assets: manifest.assets,
  });
  if (manifest.assetDomainDigest !== expectedAssetDomainDigest) {
    reject("RC6_4_PRODUCTION_STATIC_ASSET_DOMAIN_DIGEST_MISMATCH");
  }
  const { manifestDigest, ...body } = manifest;
  if (manifestDigest !== domainDigest(RC6_4_PRODUCTION_STATIC_NETWORK_SCHEMA, body)) {
    reject("RC6_4_PRODUCTION_STATIC_MANIFEST_DIGEST_MISMATCH");
  }
}

export async function validateProductionStaticNetworkManifest({
  rootPath,
  manifestPath,
  sidecarPath,
  productCommit,
  deploymentId,
  productionOrigin,
  diagnosticsFlag,
}) {
  const context = normalizeContext({
    productCommit, deploymentId, productionOrigin, diagnosticsFlag,
  });
  const paths = outputPaths({ rootPath, manifestPath, sidecarPath });
  await assertNoReparseAncestors(paths.outputDirectory);
  const manifestBytes = await readBoundedRegularFile(
    paths.manifest,
    MAX_MANIFEST_BYTES,
    "RC6_4_PRODUCTION_STATIC_MANIFEST_FILE_INVALID",
  );
  const manifestText = manifestBytes.toString("utf8");
  if (!Buffer.from(manifestText, "utf8").equals(manifestBytes)
    || !manifestText.endsWith("\n") || manifestText.includes("\r")
    || (manifestBytes[0] === 0xef && manifestBytes[1] === 0xbb && manifestBytes[2] === 0xbf)) {
    reject("RC6_4_PRODUCTION_STATIC_MANIFEST_NOT_CANONICAL");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    reject("RC6_4_PRODUCTION_STATIC_MANIFEST_JSON_INVALID");
  }
  if (canonicalJson(manifest) !== manifestText) {
    reject("RC6_4_PRODUCTION_STATIC_MANIFEST_NOT_CANONICAL");
  }
  validateManifestSemantics(manifest, context);
  const sidecarBytes = await readBoundedRegularFile(
    paths.sidecar,
    256,
    "RC6_4_PRODUCTION_STATIC_SIDECAR_FILE_INVALID",
  );
  const manifestFileDigest = sha256(manifestBytes);
  if (sidecarBytes.toString("utf8")
    !== `${manifestFileDigest}  ${RC6_4_PRODUCTION_STATIC_MANIFEST_BASENAME}\n`) {
    reject("RC6_4_PRODUCTION_STATIC_SIDECAR_MISMATCH");
  }
  const actual = await scanStaticAssetRoot(paths.root);
  if (actual.totalBytes !== manifest.totalBytes
    || stableStringify(actual.assets) !== stableStringify(manifest.assets)) {
    reject("RC6_4_PRODUCTION_STATIC_FILESYSTEM_MISMATCH");
  }
  if (manifestText.includes(paths.root) || manifestText.includes("\\")) {
    reject("RC6_4_PRODUCTION_STATIC_LOCAL_PATH_LEAK");
  }
  return {
    status: "PASS",
    schemaVersion: manifest.schemaVersion,
    productCommit: manifest.productCommit,
    deploymentId: manifest.deploymentId,
    productionOrigin: manifest.productionOrigin,
    assetCount: manifest.assetCount,
    totalBytes: manifest.totalBytes,
    assetDomainDigest: manifest.assetDomainDigest,
    manifestDigest: manifest.manifestDigest,
    manifestFileDigest,
  };
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
  await mkdir(join(rootPath, "_next", "static", "chunks"), { recursive: true });
  await writeFile(join(rootPath, "index.html"), "<!doctype html>\n", "utf8");
  await writeFile(
    join(rootPath, "_next", "static", "chunks", "rc64.js"),
    "self.__RC64_PRODUCTION__=1;\n",
    "utf8",
  );
  const outputDirectory = join(fixture, "sealed-production-static-network");
  return {
    rootPath,
    manifestPath: join(outputDirectory, RC6_4_PRODUCTION_STATIC_MANIFEST_BASENAME),
    sidecarPath: join(outputDirectory, RC6_4_PRODUCTION_STATIC_SIDECAR_BASENAME),
    productCommit: "a".repeat(40),
    deploymentId: "dpl_RC64ProductionStaticFixture123",
    productionOrigin: RC6_4_PRODUCTION_ORIGIN,
    diagnosticsFlag: "0",
  };
}

async function rewritePair(options, manifest, { canonical = true } = {}) {
  const text = canonical ? canonicalJson(manifest) : `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(options.manifestPath, text, "utf8");
  await writeFile(
    options.sidecarPath,
    `${sha256(text)}  ${RC6_4_PRODUCTION_STATIC_MANIFEST_BASENAME}\n`,
    "utf8",
  );
}

export async function runProductionStaticNetworkSelfTest() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-rc64-production-static-"));
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  const resolvedSystemTemp = resolve(tmpdir());
  if (!resolvedTemporaryRoot.startsWith(`${resolvedSystemTemp}${sep}`)
    || !basename(resolvedTemporaryRoot).startsWith("novel-rc64-production-static-")) {
    reject("RC6_4_PRODUCTION_STATIC_SELF_TEST_TEMP_INVALID");
  }
  const checks = [];
  try {
    const valid = await createFixture(temporaryRoot, "valid");
    await generateProductionStaticNetworkManifest(valid);
    const validResult = await validateProductionStaticNetworkManifest(valid);
    assert.equal(validResult.status, "PASS");
    assert.deepEqual((await readdir(dirname(valid.manifestPath))).sort(), [
      RC6_4_PRODUCTION_STATIC_MANIFEST_BASENAME,
      RC6_4_PRODUCTION_STATIC_SIDECAR_BASENAME,
    ].sort());
    checks.push("valid-atomic-pair");

    await expectCode(() => generateProductionStaticNetworkManifest(valid), /OUTPUT_ALREADY_EXISTS/u);
    checks.push("no-overwrite");

    const diagnostics = await createFixture(temporaryRoot, "diagnostics-enabled");
    await expectCode(() => generateProductionStaticNetworkManifest({
      ...diagnostics, diagnosticsFlag: "1",
    }), /DIAGNOSTICS_NOT_DISABLED/u);
    checks.push("production-flag0-only");

    const wrongOrigin = await createFixture(temporaryRoot, "wrong-origin");
    await expectCode(() => generateProductionStaticNetworkManifest({
      ...wrongOrigin, productionOrigin: "https://example.invalid",
    }), /ORIGIN_INVALID/u);
    checks.push("exact-production-origin");

    const productBinding = await createFixture(temporaryRoot, "product-binding");
    await generateProductionStaticNetworkManifest(productBinding);
    await expectCode(() => validateProductionStaticNetworkManifest({
      ...productBinding, productCommit: "b".repeat(40),
    }), /EXECUTION_CONTEXT_MISMATCH/u);
    checks.push("exact-product-commit");

    const deploymentBinding = await createFixture(temporaryRoot, "deployment-binding");
    await generateProductionStaticNetworkManifest(deploymentBinding);
    await expectCode(() => validateProductionStaticNetworkManifest({
      ...deploymentBinding, deploymentId: "dpl_RC64ProductionStaticWrong999",
    }), /EXECUTION_CONTEXT_MISMATCH/u);
    checks.push("exact-deployment-id");

    const mutation = await createFixture(temporaryRoot, "asset-mutation");
    await generateProductionStaticNetworkManifest(mutation);
    await writeFile(join(mutation.rootPath, "index.html"), "<!doctype htmL>\n", "utf8");
    await expectCode(() => validateProductionStaticNetworkManifest(mutation), /FILESYSTEM_MISMATCH/u);
    checks.push("sealed-byte-mutation");

    const environment = await createFixture(temporaryRoot, "wrong-environment");
    await generateProductionStaticNetworkManifest(environment);
    const environmentManifest = JSON.parse(await readFile(environment.manifestPath, "utf8"));
    environmentManifest.environment = "preview";
    await rewritePair(environment, environmentManifest);
    await expectCode(() => validateProductionStaticNetworkManifest(environment), /MANIFEST_IDENTITY_INVALID/u);
    checks.push("environment-production-only");

    const domainDigest = await createFixture(temporaryRoot, "domain-digest");
    await generateProductionStaticNetworkManifest(domainDigest);
    const domainManifest = JSON.parse(await readFile(domainDigest.manifestPath, "utf8"));
    domainManifest.assetDomainDigest = "0".repeat(64);
    await rewritePair(domainDigest, domainManifest);
    await expectCode(() => validateProductionStaticNetworkManifest(domainDigest),
      /ASSET_DOMAIN_DIGEST_MISMATCH/u);
    checks.push("asset-domain-digest-binding");

    const releaseIdentity = await createFixture(temporaryRoot, "release-identity");
    await generateProductionStaticNetworkManifest(releaseIdentity);
    const releaseManifestMutation = JSON.parse(await readFile(releaseIdentity.manifestPath, "utf8"));
    releaseManifestMutation.releaseIdentity.releaseRevision = "rc6.3";
    await rewritePair(releaseIdentity, releaseManifestMutation);
    await expectCode(() => validateProductionStaticNetworkManifest(releaseIdentity),
      /RELEASE_IDENTITY_MISMATCH/u);
    checks.push("exact-release-identity");

    const pathCanonical = await createFixture(temporaryRoot, "path-canonical");
    await generateProductionStaticNetworkManifest(pathCanonical);
    const pathManifest = JSON.parse(await readFile(pathCanonical.manifestPath, "utf8"));
    pathManifest.assets[0].urlPath = pathManifest.assets[0].urlPath.replace("_next", "%5fnext");
    await rewritePair(pathCanonical, pathManifest);
    await expectCode(() => validateProductionStaticNetworkManifest(pathCanonical),
      /URL_PATH_INVALID/u);
    checks.push("canonical-url-path");

    const nonCanonical = await createFixture(temporaryRoot, "non-canonical");
    await generateProductionStaticNetworkManifest(nonCanonical);
    const nonCanonicalManifest = JSON.parse(await readFile(nonCanonical.manifestPath, "utf8"));
    await rewritePair(nonCanonical, nonCanonicalManifest, { canonical: false });
    await expectCode(() => validateProductionStaticNetworkManifest(nonCanonical), /NOT_CANONICAL/u);
    checks.push("canonical-json");

    const sidecar = await createFixture(temporaryRoot, "sidecar");
    await generateProductionStaticNetworkManifest(sidecar);
    await writeFile(sidecar.sidecarPath,
      `${"0".repeat(64)}  ${RC6_4_PRODUCTION_STATIC_MANIFEST_BASENAME}\n`, "utf8");
    await expectCode(() => validateProductionStaticNetworkManifest(sidecar), /SIDECAR_MISMATCH/u);
    checks.push("sidecar-binding");

    const preview = await createFixture(temporaryRoot, "preview-cross-use");
    const previewOutput = join(temporaryRoot, "preview-cross-use-output");
    const previewOptions = {
      rootPath: preview.rootPath,
      manifestPath: join(previewOutput, "rc6.4-preview-static-assets.json"),
      sidecarPath: join(previewOutput, "rc6.4-preview-static-assets.sha256"),
      productCommit: preview.productCommit,
      runId: "123456789",
      runAttempt: "1",
      diagnosticsFlag: "1",
    };
    await mkdir(previewOutput, { recursive: true });
    await generatePreviewStaticAssetManifest(previewOptions);
    const productionCrossDirectory = dirname(preview.manifestPath);
    await mkdir(productionCrossDirectory, { recursive: true });
    const previewBytes = await readFile(previewOptions.manifestPath);
    await writeFile(preview.manifestPath, previewBytes);
    await writeFile(
      preview.sidecarPath,
      `${sha256(previewBytes)}  ${RC6_4_PRODUCTION_STATIC_MANIFEST_BASENAME}\n`,
    );
    await expectCode(() => validateProductionStaticNetworkManifest(preview),
      /MANIFEST_SHAPE_INVALID|MANIFEST_IDENTITY_INVALID/u);
    checks.push("preview-rejected-by-production");

    const production = await createFixture(temporaryRoot, "production-cross-use");
    await generateProductionStaticNetworkManifest(production);
    const previewCrossOutput = join(temporaryRoot, "production-cross-use-preview-output");
    await mkdir(previewCrossOutput, { recursive: true });
    const productionBytes = await readFile(production.manifestPath);
    const productionAsPreview = {
      rootPath: production.rootPath,
      manifestPath: join(previewCrossOutput, "rc6.4-preview-static-assets.json"),
      sidecarPath: join(previewCrossOutput, "rc6.4-preview-static-assets.sha256"),
      productCommit: production.productCommit,
      runId: "123456789",
      runAttempt: "1",
      diagnosticsFlag: "1",
    };
    await writeFile(productionAsPreview.manifestPath, productionBytes);
    await writeFile(
      productionAsPreview.sidecarPath,
      `${sha256(productionBytes)}  rc6.4-preview-static-assets.json\n`,
    );
    await expectCode(() => validatePreviewStaticAssetManifest(productionAsPreview),
      /MANIFEST_KEYS_INVALID|MANIFEST_IDENTITY_INVALID/u);
    checks.push("production-rejected-by-preview");
  } finally {
    await rm(resolvedTemporaryRoot, { recursive: true, force: true });
  }
  return {
    status: "PASS",
    schemaVersion: RC6_4_PRODUCTION_STATIC_NETWORK_SCHEMA,
    assetDomain: RC6_4_PRODUCTION_STATIC_ASSET_DOMAIN,
    checks,
  };
}

function cliOptions() {
  return {
    rootPath: process.env.RC6_4_PRODUCTION_STATIC_ASSET_ROOT || ".vercel/output/static",
    manifestPath: process.env.RC6_4_PRODUCTION_STATIC_MANIFEST_PATH,
    sidecarPath: process.env.RC6_4_PRODUCTION_STATIC_SIDECAR_PATH,
    productCommit: process.env.RC6_4_PRODUCT_COMMIT ?? process.env.EXPECTED_PRODUCT_COMMIT,
    deploymentId: process.env.RC6_4_PRODUCTION_DEPLOYMENT_ID,
    productionOrigin: process.env.RC6_4_PRODUCTION_ORIGIN,
    diagnosticsFlag: process.env.NEXT_PUBLIC_RC6_4_BROWSER_PROSE_DIAGNOSTICS,
  };
}

async function runCli(mode) {
  if (mode === "self-test") return runProductionStaticNetworkSelfTest();
  if (mode === "generate") return generateProductionStaticNetworkManifest(cliOptions());
  if (mode === "validate") return validateProductionStaticNetworkManifest(cliOptions());
  reject("RC6_4_PRODUCTION_STATIC_MODE_INVALID");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runCli(process.argv[2]);
    process.stdout.write(`${JSON.stringify({
      status: result.status || "PASS",
      schemaVersion: result.schemaVersion || result.manifest?.schemaVersion,
      productCommit: result.productCommit || result.manifest?.productCommit,
      deploymentId: result.deploymentId || result.manifest?.deploymentId,
      productionOrigin: result.productionOrigin || result.manifest?.productionOrigin,
      assetCount: result.assetCount ?? result.manifest?.assetCount,
      totalBytes: result.totalBytes ?? result.manifest?.totalBytes,
      assetDomainDigest: result.assetDomainDigest || result.manifest?.assetDomainDigest,
      manifestDigest: result.manifestDigest || result.manifest?.manifestDigest,
      manifestFileDigest: result.manifestFileDigest,
      assetDomain: result.assetDomain,
      checks: result.checks,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: "REJECT",
      safeErrorCode: error?.code || "RC6_4_PRODUCTION_STATIC_MANIFEST_FAILED",
    })}\n`);
    process.exitCode = 1;
  }
}
