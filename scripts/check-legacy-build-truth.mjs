import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import releaseProvenance from "../generated/release-provenance.json" with { type: "json" };
import releaseManifest from "../release-manifest.json" with { type: "json" };
import releaseContract from "../release-metadata-contract.json" with { type: "json" };
import { verifyReleaseProvenance } from "./generate-release-provenance.mjs";

const FULL_COMMIT = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const TEMPLATE_COMMIT = "__NOVEL_STATIC_APP_COMMIT__";
const TEMPLATE_TAG = "__NOVEL_STATIC_RELEASE_TAG__";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalizeReleaseFields = (value) => value
  .replace(/\r\n/g, "\n")
  .replace(/(<meta name="novel-static-release" content=")[^"]*(">)/, '$1__NOVEL_STATIC_APP_COMMIT__$2')
  .replace(/(<meta name="novel-static-release-tag" content=")[^"]*(">)/, '$1__NOVEL_STATIC_RELEASE_TAG__$2')
  .replace(/data-app-commit="[^"]*"/, 'data-app-commit="__NOVEL_STATIC_APP_COMMIT__"')
  .replace(/data-release-tag="[^"]*"/, 'data-release-tag="__NOVEL_STATIC_RELEASE_TAG__"')
  .replace(/data-visible-ui-semantic-version="[^"]*"/, 'data-visible-ui-semantic-version="__NOVEL_VISIBLE_UI_SEMANTIC_VERSION__"')
  .replace(/data-visible-ui-body-hash="[^"]*"/, 'data-visible-ui-body-hash="__NOVEL_VISIBLE_UI_BODY_HASH__"');

const prohibitedText = [
  "OpenAI-compatible Chat Completions",
  "Ollama Generate",
  "LM Studio Chat Completions",
  "workspaceScriptLoaded",
  "workspaceInitialized",
  "workspaceMounted",
  "workspaceVisible",
  "三路閉端 AI 架構",
];
const prohibitedScripts = [
  "./ai-service.js",
  "./phase1-manager.js",
  "./novel-local-runtime-client.js",
  "./novel-segmented-workspace.js",
  "./novel-whole-novel-workspace.js",
  "./local-training-service.js",
];

function fail(errorCode, failures) {
  const error = new Error(errorCode);
  error.code = errorCode;
  error.failures = failures;
  throw error;
}

function matchValue(source, pattern, field) {
  const value = source.match(pattern)?.[1];
  if (!value) fail("LEGACY_BUILD_RELEASE_METADATA_MISMATCH", [`missing ${field}`]);
  return value;
}

function validateSealedProvenance(provenance, manifest, contract) {
  const failures = [];
  const allowedSchemas = contract.allowedProvenanceSchemaVersions
    ?? [contract.provenanceSchemaVersion];
  if (!verifyReleaseProvenance(provenance)) failures.push("sealed provenance verification failed");
  if (!FULL_COMMIT.test(provenance?.appCommit ?? "")) failures.push("invalid sealed commit");
  if (!SHA256.test(provenance?.integrity?.payloadHash ?? "")) failures.push("invalid provenance hash");
  if (!allowedSchemas.includes(provenance?.schemaVersion)) failures.push("unsupported provenance schema");
  if (provenance?.releaseTag !== manifest.releaseTag) failures.push("releaseTag mismatch");
  if (provenance?.architectureStage !== manifest.architectureStage) failures.push("architectureStage mismatch");
  if (failures.length) fail("LEGACY_BUILD_PROVENANCE_INVALID", failures);
}

function validateSecurity({ html, serviceWorker, boundary }) {
  const failures = [];
  const assert = (condition, message) => { if (!condition) failures.push(message); };

  for (const marker of prohibitedText) assert(!html.includes(marker), `public HTML contains prohibited marker: ${marker}`);
  for (const src of prohibitedScripts) assert(!html.includes(`src=\"${src}`), `public HTML loads unsafe legacy runtime: ${src}`);
  assert(!/fetch\s*\(\s*(?:endpoint|ep)\b/.test(html), "public HTML contains arbitrary endpoint fetch");
  assert(!/localStorage\.setItem\(\s*['\"]novel_external_ai_cfg/.test(html), "public HTML persists legacy provider settings");
  assert(/function askExternalAI\(\)\{throw Object\.assign\(new Error/.test(html), "askExternalAI is not a hard rejection");
  assert(/function miniAiAskLocal\(\)\{throw Object\.assign\(new Error/.test(html), "miniAiAskLocal is not a hard rejection");
  assert(!prohibitedScripts.some((src) => serviceWorker.includes(`\"${src}\"`)), "service worker precaches an unsafe legacy runtime");
  assert(boundary.includes("LEGACY_PROVIDER_PATH_DISABLED"), "legacy security boundary error code missing");
  assert(boundary.includes("Object.defineProperty(window, \"fetch\""), "legacy fetch guard missing");
  assert(boundary.includes("configurable: false"), "legacy guards are not locked");
  for (const handler of ["cloudNovelAiFetch", "cloudNovelAiHealth", "cloudNovelAiAnalyze", "cloudNovelAiPlan", "cloudNovelAiReview"]) {
    assert(boundary.includes(`\"${handler}\"`), `legacy cloud handler is not locked: ${handler}`);
  }
  assert(boundary.includes("cloudPanel.hidden = true"), "legacy cloud panel is not hidden");
  const scriptSources = [...html.matchAll(/<script[^>]+src=[\"']([^\"']+)[\"'][^>]*>/g)].map((match) => match[1]);
  assert(scriptSources.at(-1)?.startsWith("./legacy-security-boundary.js"), "legacy security boundary must be the final external script");
  if (failures.length) fail("BUILD_FAIL_LEGACY_UNSAFE", failures);
}

export function createLegacyBuildTruth({
  html,
  workspace,
  serviceWorker,
  boundary,
  provenance = releaseProvenance,
  manifest = releaseManifest,
  contract = releaseContract,
  allowTemplatePlaceholders = false,
}) {
  validateSealedProvenance(provenance, manifest, contract);
  validateSecurity({ html, serviceWorker, boundary });

  const htmlCommit = matchValue(html, /<meta name="novel-static-release" content="([^"]*)">/, "HTML commit");
  const htmlTag = matchValue(html, /<meta name="novel-static-release-tag" content="([^"]*)">/, "HTML releaseTag");
  const jsCommit = matchValue(workspace, /appCommit:\s*"([^"]*)"/, "JavaScript commit");
  const jsTag = matchValue(workspace, /releaseTag:\s*"([^"]*)"/, "JavaScript releaseTag");
  const expectedCommit = provenance.appCommit;
  const expectedTag = provenance.releaseTag;
  const templateAllowed = allowTemplatePlaceholders
    && htmlCommit === TEMPLATE_COMMIT
    && htmlTag === TEMPLATE_TAG
    && jsCommit === TEMPLATE_COMMIT
    && jsTag === TEMPLATE_TAG;
  const metadataMatches = templateAllowed || (
    htmlCommit === expectedCommit
    && jsCommit === expectedCommit
    && htmlTag === expectedTag
    && jsTag === expectedTag
  );
  if (!metadataMatches) {
    fail("LEGACY_BUILD_RELEASE_METADATA_MISMATCH", [
      `HTML commit: ${htmlCommit}`,
      `HTML releaseTag: ${htmlTag}`,
      `JavaScript commit: ${jsCommit}`,
      `JavaScript releaseTag: ${jsTag}`,
    ]);
  }

  return {
    schemaVersion: "legacy-build-truth-v2",
    sourcePath: "public/legacy/novel-system.html",
    deployedRoute: "/legacy/novel-system.html",
    hashMode: "sha256-normalized-release-fields-v1",
    commit: expectedCommit,
    releaseTag: expectedTag,
    architectureStage: provenance.architectureStage,
    commitProvenanceSource: "build_sealed",
    commitProvenanceStatus: "verified",
    commitProvenanceSchemaVersion: provenance.schemaVersion,
    commitProvenanceHash: provenance.integrity.payloadHash,
    sourceSha256: sha256(normalizeReleaseFields(html)),
    buildArtifactSha256: sha256(normalizeReleaseFields(html)),
    buildArtifactRawSha256: sha256(html),
    assertions: {
      prohibitedStringsAbsent: true,
      unsafeScriptsNotLoaded: true,
      directProviderHandlersRejected: true,
      unsafeServiceWorkerCacheEntriesAbsent: true,
      boundaryLoadedLast: true,
      releaseProvenanceVerified: true,
      releaseMetadataMatched: true,
    },
  };
}

export function runLegacyBuildTruth({
  root = process.cwd(),
  writeManifest = process.argv.includes("--write-manifest"),
  allowTemplatePlaceholders = process.env.VERCEL !== "1"
    && process.env.NOVEL_STATIC_STAMP !== "1",
} = {}) {
  const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
  const result = createLegacyBuildTruth({
    html: read("public", "legacy", "novel-system.html"),
    workspace: read("public", "legacy", "novel-whole-novel-workspace.js"),
    serviceWorker: read("public", "legacy", "service-worker.js"),
    boundary: read("public", "legacy", "legacy-security-boundary.js"),
    allowTemplatePlaceholders,
  });
  if (writeManifest) {
    fs.writeFileSync(
      path.join(root, "public", "legacy", "novel-system.build.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(runLegacyBuildTruth(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      errorCode: error?.code ?? "LEGACY_BUILD_PROVENANCE_INVALID",
      failures: error?.failures ?? [error instanceof Error ? error.message : String(error)],
    }, null, 2));
    process.exitCode = 1;
  }
}
