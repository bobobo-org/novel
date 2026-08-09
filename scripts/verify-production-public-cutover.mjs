import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDeadline,
  boundedFetch,
  boundedOperation,
  delayWithinDeadline,
} from "./bounded-fetch.mjs";

function finding(alias, surface, code) {
  return { alias, surface, code };
}

async function responseJson(response, limits) {
  try {
    return await boundedOperation(() => response.json(), {
      ...limits,
      timeoutCode: "PUBLIC_GATE_RESPONSE_BODY_TIMEOUT",
      onTimeout: () => response.body?.cancel().catch(() => undefined),
    });
  } catch {
    return null;
  }
}

function extractDynamicAssets(html) {
  const assets = new Set();
  for (const match of String(html || "").matchAll(/(?:src|href)=["']([^"']+)["']/gu)) {
    const reference = match[1];
    if (/^\/_next\/static\//u.test(reference)) assets.add(reference);
  }
  return [...assets].sort();
}

function expectedMime(reference, contentType) {
  if (/\.css(?:\?|$)/u.test(reference)) return /^text\/css(?:;|$)/u.test(contentType);
  if (/\.js(?:\?|$)/u.test(reference)) return /(?:java|ecma)script/u.test(contentType);
  return true;
}

const MANUAL_LEARNING_WORKER_REFERENCE = "/generated/manual-learning-worker.js";
const MANUAL_LEARNING_WORKER_MIN_BYTES = 500_000;
const MANUAL_LEARNING_WORKER_MAX_BYTES = 3_500_000;

function workerAssetSummary(reference, response, source) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const bytes = Buffer.byteLength(source);
  return {
    reference,
    bytes,
    digest: createHash("sha256").update(source, "utf8").digest("hex"),
    contentType,
    missing: response.status !== 200,
    htmlFallback: contentType.startsWith("text/html") || /^\s*<!doctype\s+html/iu.test(source),
    mimeMismatch: !expectedMime(reference, contentType),
    sizeInvalid: bytes < MANUAL_LEARNING_WORKER_MIN_BYTES || bytes > MANUAL_LEARNING_WORKER_MAX_BYTES,
    parserMarkerMissing: !source.includes("LEARNING_FILE_MAGIC_MISMATCH"),
    semanticChunkingMarkerMissing: !source.includes("splitManualLearningDocumentSemantically"),
    lifecycleMarkerMissing: !source.includes("LEARNING_WORKER_DUPLICATE_REQUEST"),
    importPreparationMarkerMissing: !source.includes("prepare_import_file"),
    protocolMarkerMissing: !source.includes("manual-learning-worker-protocol-v2"),
  };
}

export async function verifyProductionPublicCutover({
  aliases,
  expectedCommit,
  expectedReleaseTag,
  expectedReleaseRevision,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 180_000,
}) {
  const limits = { timeoutMs: fetchTimeoutMs, deadlineAt };
  const fetchPublic = (input) => boundedFetch(fetcher, input, { cache: "no-store" }, {
    ...limits,
    timeoutCode: "PUBLIC_GATE_FETCH_TIMEOUT",
  });
  const findings = [];
  const aliasReports = [];
  for (const alias of aliases) {
    assertDeadline(deadlineAt, "POST_CUTOVER_PUBLIC_GATE_DEADLINE_EXCEEDED");
    const origin = `https://${alias}`;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const workerReference = `${MANUAL_LEARNING_WORKER_REFERENCE}?public-gate=${nonce}`;
    const [identityResponse, aiResponse, syncResponse, studioResponse, workerResponse] = await Promise.all([
      fetchPublic(`${origin}/api/release/identity?public-gate=${nonce}`),
      fetchPublic(`${origin}/api/ai/health?public-gate=${nonce}`),
      fetchPublic(`${origin}/api/persistence/sync/health?public-gate=${nonce}`),
      fetchPublic(`${origin}/studio?public-gate=${nonce}`),
      fetchPublic(`${origin}${workerReference}`),
    ]);
    for (const [surface, response] of [
      ["release-identity", identityResponse],
      ["ai-health", aiResponse],
      ["sync-health", syncResponse],
      ["studio", studioResponse],
      ["manual-learning-worker", workerResponse],
    ]) {
      if (response.status !== 200) findings.push(finding(alias, surface, "HTTP_NOT_200"));
    }
    const [identity, ai, sync, studioHtml, workerSource] = await Promise.all([
      responseJson(identityResponse, limits),
      responseJson(aiResponse, limits),
      responseJson(syncResponse, limits),
      boundedOperation(() => studioResponse.text(), {
        ...limits,
        timeoutCode: "PUBLIC_GATE_STUDIO_BODY_TIMEOUT",
        onTimeout: () => studioResponse.body?.cancel().catch(() => undefined),
      }).catch(() => ""),
      boundedOperation(() => workerResponse.text(), {
        ...limits,
        timeoutCode: "PUBLIC_GATE_WORKER_BODY_TIMEOUT",
        onTimeout: () => workerResponse.body?.cancel().catch(() => undefined),
      }).catch(() => ""),
    ]);

    if (identity?.appCommit !== expectedCommit) findings.push(finding(alias, "release-identity", "APP_COMMIT_MISMATCH"));
    if (identity?.releaseTag !== expectedReleaseTag) findings.push(finding(alias, "release-identity", "RELEASE_TAG_MISMATCH"));
    if (identity?.releaseRevision !== expectedReleaseRevision) findings.push(finding(alias, "release-identity", "RELEASE_REVISION_MISMATCH"));
    if (identity?.environment !== "production") findings.push(finding(alias, "release-identity", "ENVIRONMENT_NOT_PRODUCTION"));
    if (identity?.provenanceStatus !== "verified") findings.push(finding(alias, "release-identity", "PROVENANCE_NOT_VERIFIED"));
    if (!/^dpl_[A-Za-z0-9]+$/u.test(String(identity?.deploymentId || ""))) {
      findings.push(finding(alias, "release-identity", "DEPLOYMENT_ID_INVALID"));
    }

    if (ai?.appCommit !== expectedCommit) findings.push(finding(alias, "ai-health", "APP_COMMIT_MISMATCH"));
    if (ai?.releaseTag !== expectedReleaseTag) findings.push(finding(alias, "ai-health", "RELEASE_TAG_MISMATCH"));
    if (ai?.releaseRevision !== expectedReleaseRevision) findings.push(finding(alias, "ai-health", "RELEASE_REVISION_MISMATCH"));
    if ((ai?.provenanceStatus ?? ai?.commitProvenanceStatus) !== "verified") {
      findings.push(finding(alias, "ai-health", "PROVENANCE_NOT_VERIFIED"));
    }

    if (
      sync?.status !== "ready"
      || sync?.migrationVersion !== "cloud_sync_e2ee_storage_001"
      || sync?.schemaVersion !== "novel-cloud-sync-e2ee-v1"
      || sync?.storageBackend !== "private-object-storage"
    ) findings.push(finding(alias, "sync-health", "CLOUD_SYNC_TRUTH_INVALID"));

    const assets = extractDynamicAssets(studioHtml);
    if (assets.length === 0) findings.push(finding(alias, "studio", "DYNAMIC_ASSET_SET_EMPTY"));
    const assetResults = await Promise.all(assets.map(async (reference) => {
      const response = await fetchPublic(new URL(reference, origin));
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      const htmlFallback = contentType.startsWith("text/html");
      const mimeMatches = expectedMime(reference, contentType);
      return {
        reference,
        missing: response.status !== 200,
        htmlFallback,
        mimeMismatch: !mimeMatches,
      };
    }));
    const assetSummary = {
      count: assetResults.length,
      missing: assetResults.filter((entry) => entry.missing).length,
      htmlFallback: assetResults.filter((entry) => entry.htmlFallback).length,
      mimeMismatch: assetResults.filter((entry) => entry.mimeMismatch).length,
    };
    if (assetSummary.missing > 0) findings.push(finding(alias, "dynamic-assets", "ASSET_MISSING"));
    if (assetSummary.htmlFallback > 0) findings.push(finding(alias, "dynamic-assets", "HTML_FALLBACK"));
    if (assetSummary.mimeMismatch > 0) findings.push(finding(alias, "dynamic-assets", "MIME_MISMATCH"));
    const workerAsset = workerAssetSummary(workerReference, workerResponse, workerSource);
    if (workerAsset.missing) findings.push(finding(alias, "manual-learning-worker", "ASSET_MISSING"));
    if (workerAsset.htmlFallback) findings.push(finding(alias, "manual-learning-worker", "HTML_FALLBACK"));
    if (workerAsset.mimeMismatch) findings.push(finding(alias, "manual-learning-worker", "MIME_MISMATCH"));
    if (workerAsset.sizeInvalid) findings.push(finding(alias, "manual-learning-worker", "ASSET_SIZE_INVALID"));
    if (workerAsset.parserMarkerMissing) findings.push(finding(alias, "manual-learning-worker", "PARSER_MARKER_MISSING"));
    if (workerAsset.semanticChunkingMarkerMissing) {
      findings.push(finding(alias, "manual-learning-worker", "SEMANTIC_CHUNKING_MARKER_MISSING"));
    }
    if (workerAsset.lifecycleMarkerMissing) findings.push(finding(alias, "manual-learning-worker", "LIFECYCLE_MARKER_MISSING"));
    if (workerAsset.importPreparationMarkerMissing) {
      findings.push(finding(alias, "manual-learning-worker", "IMPORT_PREPARATION_MARKER_MISSING"));
    }
    if (workerAsset.protocolMarkerMissing) findings.push(finding(alias, "manual-learning-worker", "PROTOCOL_MARKER_MISSING"));
    aliasReports.push({ alias, identity, ai, sync, assetSummary, workerAsset });
  }

  const [primary, mirror] = aliasReports;
  const identityKeys = [
    "deploymentId",
    "appCommit",
    "releaseTag",
    "releaseRevision",
    "environment",
    "provenanceStatus",
  ];
  for (const key of identityKeys) {
    if (primary?.identity?.[key] !== mirror?.identity?.[key]) {
      findings.push(finding("primary+mirror", "release-identity", `ALIAS_${key.toUpperCase()}_MISMATCH`));
    }
  }
  for (const key of ["status", "migrationVersion", "schemaVersion", "storageBackend", "provider"]) {
    if (primary?.sync?.[key] !== mirror?.sync?.[key]) {
      findings.push(finding("primary+mirror", "sync-health", `ALIAS_${key.toUpperCase()}_MISMATCH`));
    }
  }
  if (primary?.workerAsset?.digest !== mirror?.workerAsset?.digest) {
    findings.push(finding("primary+mirror", "manual-learning-worker", "ALIAS_DIGEST_MISMATCH"));
  }
  const report = {
    schemaVersion: "production-post-cutover-public-verification-v1",
    status: findings.length === 0 ? "PASS" : "FAIL",
    expectedCommit,
    expectedReleaseTag,
    expectedReleaseRevision,
    aliases: aliasReports.map(({ alias, identity, assetSummary, workerAsset }) => ({
      alias,
      deploymentId: identity?.deploymentId || null,
      appCommit: identity?.appCommit || null,
      assetSummary,
      workerAsset: {
        reference: MANUAL_LEARNING_WORKER_REFERENCE,
        bytes: workerAsset.bytes,
        digest: workerAsset.digest,
        contentType: workerAsset.contentType,
      },
    })),
    findings,
    secretValuesStored: false,
  };
  if (findings.length > 0) {
    throw Object.assign(new Error("POST_CUTOVER_PUBLIC_VERIFICATION_FAILED"), {
      code: "POST_CUTOVER_PUBLIC_VERIFICATION_FAILED",
      report,
    });
  }
  return report;
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`MISSING_ENVIRONMENT:${name}`);
  return value;
}

function appendOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
    "utf8",
  );
}

async function main() {
  const aliases = [requiredEnvironment("PRIMARY_ALIAS"), requiredEnvironment("MIRROR_ALIAS")];
  const deadlineMs = Number(process.env.POST_CUTOVER_DEADLINE_MS || 180_000);
  const fetchTimeoutMs = Number(process.env.PUBLIC_GATE_FETCH_TIMEOUT_MS || 10_000);
  if (!Number.isFinite(deadlineMs) || deadlineMs < 30_000 || deadlineMs > 300_000) {
    throw new Error("POST_CUTOVER_DEADLINE_INVALID");
  }
  if (!Number.isFinite(fetchTimeoutMs) || fetchTimeoutMs < 100 || fetchTimeoutMs > 30_000) {
    throw new Error("PUBLIC_GATE_FETCH_TIMEOUT_INVALID");
  }
  const deadlineAt = Date.now() + deadlineMs;
  let lastError = null;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    assertDeadline(deadlineAt, "POST_CUTOVER_PUBLIC_GATE_DEADLINE_EXCEEDED");
    try {
      const report = await verifyProductionPublicCutover({
        aliases,
        expectedCommit: requiredEnvironment("EXPECTED_COMMIT"),
        expectedReleaseTag: requiredEnvironment("EXPECTED_RELEASE_TAG"),
        expectedReleaseRevision: requiredEnvironment("EXPECTED_RELEASE_REVISION"),
        fetchTimeoutMs,
        deadlineAt,
      });
      if (process.env.POST_CUTOVER_REPORT_PATH) {
        await writeFile(process.env.POST_CUTOVER_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }
      const deploymentId = report.aliases[0].deploymentId;
      appendOutputs({ deployment_id: deploymentId });
      console.log(JSON.stringify(report));
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 15) {
        try {
          await delayWithinDeadline(2_000, deadlineAt, "POST_CUTOVER_PUBLIC_GATE_DEADLINE_EXCEEDED");
        } catch (deadlineError) {
          lastError = deadlineError;
          break;
        }
      }
    }
  }
  if (process.env.POST_CUTOVER_REPORT_PATH && lastError?.report) {
    await writeFile(
      process.env.POST_CUTOVER_REPORT_PATH,
      `${JSON.stringify(lastError.report, null, 2)}\n`,
      "utf8",
    );
  }
  throw lastError;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "post_cutover_public_verification_failed",
      errorCode: String(error?.code || error?.message || "POST_CUTOVER_PUBLIC_VERIFICATION_FAILED"),
      findingCount: Array.isArray(error?.report?.findings) ? error.report.findings.length : null,
    }));
    process.exitCode = 1;
  });
}
