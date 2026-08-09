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
  .replace(/(<meta name="novel-static-release-revision" content=")[^"]*(">)/, '$1__NOVEL_STATIC_RELEASE_REVISION__$2')
  .replace(/(<meta name="novel-static-release-build" content=")[^"]*(">)/, '$1__NOVEL_STATIC_RELEASE_BUILD__$2')
  .replace(/(<meta name="novel-static-release-product-commit" content=")[^"]*(">)/, '$1__NOVEL_STATIC_RELEASE_PRODUCT_COMMIT__$2')
  .replace(/(<meta name="novel-static-release-base-commit" content=")[^"]*(">)/, '$1__NOVEL_STATIC_RELEASE_BASE_COMMIT__$2')
  .replace(/(<meta name="novel-static-release-name" content=")[^"]*(">)/, '$1__NOVEL_STATIC_RELEASE_NAME__$2')
  .replace(/(<meta name="novel-static-consumer-release" content=")[^"]*(">)/, '$1__NOVEL_STATIC_CONSUMER_RELEASE__$2')
  .replace(/(<meta name="novel-static-architecture-stage" content=")[^"]*(">)/, '$1__NOVEL_STATIC_ARCHITECTURE_STAGE__$2')
  .replace(/(<meta name="novel-static-git-commit-signature" content=")[^"]*(">)/, '$1__NOVEL_STATIC_GIT_COMMIT_SIGNATURE__$2')
  .replace(/(<meta name="novel-static-deployment-provenance" content=")[^"]*(">)/, '$1__NOVEL_STATIC_DEPLOYMENT_PROVENANCE__$2')
  .replace(/data-app-commit="[^"]*"/, 'data-app-commit="__NOVEL_STATIC_APP_COMMIT__"')
  .replace(/data-release-tag="[^"]*"/, 'data-release-tag="__NOVEL_STATIC_RELEASE_TAG__"')
  .replace(/data-release-revision="[^"]*"/, 'data-release-revision="__NOVEL_STATIC_RELEASE_REVISION__"')
  .replace(/data-release-build="[^"]*"/, 'data-release-build="__NOVEL_STATIC_RELEASE_BUILD__"')
  .replace(/data-release-product-commit="[^"]*"/, 'data-release-product-commit="__NOVEL_STATIC_RELEASE_PRODUCT_COMMIT__"')
  .replace(/data-release-base-commit="[^"]*"/, 'data-release-base-commit="__NOVEL_STATIC_RELEASE_BASE_COMMIT__"')
  .replace(/data-release-name="[^"]*"/, 'data-release-name="__NOVEL_STATIC_RELEASE_NAME__"')
  .replace(/data-consumer-release="[^"]*"/, 'data-consumer-release="__NOVEL_STATIC_CONSUMER_RELEASE__"')
  .replace(/data-architecture-stage="[^"]*"/, 'data-architecture-stage="__NOVEL_STATIC_ARCHITECTURE_STAGE__"')
  .replace(/data-git-commit-signature="[^"]*"/, 'data-git-commit-signature="__NOVEL_STATIC_GIT_COMMIT_SIGNATURE__"')
  .replace(/data-deployment-provenance="[^"]*"/, 'data-deployment-provenance="__NOVEL_STATIC_DEPLOYMENT_PROVENANCE__"')
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
  "三路閉端 AI 已完全可用",
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
  if (provenance?.releaseProductCommit !== provenance?.appCommit) failures.push("releaseProductCommit mismatch");
  if (provenance?.releaseBaseCommit !== manifest.releaseBaseCommit) failures.push("releaseBaseCommit mismatch");
  if (provenance?.releaseTag !== manifest.releaseTag) failures.push("releaseTag mismatch");
  if (provenance?.releaseRevision !== manifest.releaseRevision) failures.push("releaseRevision mismatch");
  if (provenance?.releaseBuild !== `${manifest.releaseRevision}+${provenance?.appCommit}`) failures.push("releaseBuild mismatch");
  if (provenance?.architectureStage !== manifest.architectureStage) failures.push("architectureStage mismatch");
  if (provenance?.gitCommitSignature !== manifest.gitCommitSignature) failures.push("gitCommitSignature mismatch");
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
  const htmlRevision = matchValue(html, /<meta name="novel-static-release-revision" content="([^"]*)">/, "HTML releaseRevision");
  const htmlBuild = matchValue(html, /<meta name="novel-static-release-build" content="([^"]*)">/, "HTML releaseBuild");
  const htmlProductCommit = matchValue(html, /<meta name="novel-static-release-product-commit" content="([^"]*)">/, "HTML releaseProductCommit");
  const htmlBaseCommit = matchValue(html, /<meta name="novel-static-release-base-commit" content="([^"]*)">/, "HTML releaseBaseCommit");
  const htmlName = matchValue(html, /<meta name="novel-static-release-name" content="([^"]*)">/, "HTML releaseName");
  const htmlConsumer = matchValue(html, /<meta name="novel-static-consumer-release" content="([^"]*)">/, "HTML consumerRelease");
  const htmlStage = matchValue(html, /<meta name="novel-static-architecture-stage" content="([^"]*)">/, "HTML architectureStage");
  const htmlSignature = matchValue(html, /<meta name="novel-static-git-commit-signature" content="([^"]*)">/, "HTML gitCommitSignature");
  const htmlDeploymentProvenance = matchValue(html, /<meta name="novel-static-deployment-provenance" content="([^"]*)">/, "HTML deploymentProvenance");
  const jsCommit = matchValue(workspace, /appCommit:\s*"([^"]*)"/, "JavaScript commit");
  const jsTag = matchValue(workspace, /releaseTag:\s*"([^"]*)"/, "JavaScript releaseTag");
  const jsExpectedTag = matchValue(workspace, /expectedReleaseTag:\s*"([^"]*)"/, "JavaScript expectedReleaseTag");
  const jsRevision = matchValue(workspace, /releaseRevision:\s*"([^"]*)"/, "JavaScript releaseRevision");
  const jsBuild = matchValue(workspace, /releaseBuild:\s*"([^"]*)"/, "JavaScript releaseBuild");
  const jsProductCommit = matchValue(workspace, /releaseProductCommit:\s*"([^"]*)"/, "JavaScript releaseProductCommit");
  const jsBaseCommit = matchValue(workspace, /releaseBaseCommit:\s*"([^"]*)"/, "JavaScript releaseBaseCommit");
  const jsName = matchValue(workspace, /releaseName:\s*"([^"]*)"/, "JavaScript releaseName");
  const jsConsumer = matchValue(workspace, /consumerRelease:\s*"([^"]*)"/, "JavaScript consumerRelease");
  const jsStage = matchValue(workspace, /architectureStage:\s*"([^"]*)"/, "JavaScript architectureStage");
  const jsSignature = matchValue(workspace, /gitCommitSignature:\s*"([^"]*)"/, "JavaScript gitCommitSignature");
  const jsDeploymentProvenance = matchValue(workspace, /deploymentProvenance:\s*"([^"]*)"/, "JavaScript deploymentProvenance");
  const expectedCommit = provenance.appCommit;
  const expectedProductCommit = provenance.releaseProductCommit;
  const expectedBaseCommit = provenance.releaseBaseCommit;
  const expectedTag = provenance.releaseTag;
  const expectedRevision = provenance.releaseRevision;
  const expectedBuild = provenance.releaseBuild;
  const expectedName = manifest.releaseName;
  const expectedConsumer = manifest.consumerRelease;
  const expectedStage = provenance.architectureStage;
  const expectedSignature = provenance.gitCommitSignature;
  const expectedDeploymentProvenance = "verified";
  const templateAllowed = allowTemplatePlaceholders
    && htmlCommit === TEMPLATE_COMMIT
    && htmlTag === TEMPLATE_TAG
    && htmlRevision === "__NOVEL_STATIC_RELEASE_REVISION__"
    && htmlBuild === "__NOVEL_STATIC_RELEASE_BUILD__"
    && htmlProductCommit === "__NOVEL_STATIC_RELEASE_PRODUCT_COMMIT__"
    && htmlBaseCommit === "__NOVEL_STATIC_RELEASE_BASE_COMMIT__"
    && htmlName === "__NOVEL_STATIC_RELEASE_NAME__"
    && htmlConsumer === "__NOVEL_STATIC_CONSUMER_RELEASE__"
    && htmlStage === "__NOVEL_STATIC_ARCHITECTURE_STAGE__"
    && htmlSignature === "__NOVEL_STATIC_GIT_COMMIT_SIGNATURE__"
    && htmlDeploymentProvenance === "__NOVEL_STATIC_DEPLOYMENT_PROVENANCE__"
    && jsCommit === TEMPLATE_COMMIT
    && jsTag === TEMPLATE_TAG
    && jsExpectedTag === TEMPLATE_TAG
    && jsRevision === "__NOVEL_STATIC_RELEASE_REVISION__"
    && jsBuild === "__NOVEL_STATIC_RELEASE_BUILD__"
    && jsProductCommit === "__NOVEL_STATIC_RELEASE_PRODUCT_COMMIT__"
    && jsBaseCommit === "__NOVEL_STATIC_RELEASE_BASE_COMMIT__"
    && jsName === "__NOVEL_STATIC_RELEASE_NAME__"
    && jsConsumer === "__NOVEL_STATIC_CONSUMER_RELEASE__"
    && jsStage === "__NOVEL_STATIC_ARCHITECTURE_STAGE__"
    && jsSignature === "__NOVEL_STATIC_GIT_COMMIT_SIGNATURE__"
    && jsDeploymentProvenance === "__NOVEL_STATIC_DEPLOYMENT_PROVENANCE__";
  const metadataMatches = templateAllowed || (
    htmlCommit === expectedCommit
    && jsCommit === expectedCommit
    && htmlTag === expectedTag
    && jsTag === expectedTag
    && jsExpectedTag === expectedTag
    && htmlRevision === expectedRevision
    && jsRevision === expectedRevision
    && htmlBuild === expectedBuild
    && jsBuild === expectedBuild
    && htmlProductCommit === expectedProductCommit
    && jsProductCommit === expectedProductCommit
    && htmlBaseCommit === expectedBaseCommit
    && jsBaseCommit === expectedBaseCommit
    && htmlName === expectedName
    && jsName === expectedName
    && htmlConsumer === expectedConsumer
    && jsConsumer === expectedConsumer
    && htmlStage === expectedStage
    && jsStage === expectedStage
    && htmlSignature === expectedSignature
    && jsSignature === expectedSignature
    && htmlDeploymentProvenance === expectedDeploymentProvenance
    && jsDeploymentProvenance === expectedDeploymentProvenance
  );
  if (!metadataMatches) {
    fail("LEGACY_BUILD_RELEASE_METADATA_MISMATCH", [
      `HTML commit: ${htmlCommit}`,
      `HTML releaseTag: ${htmlTag}`,
      `HTML releaseRevision: ${htmlRevision}`,
      `HTML releaseBuild: ${htmlBuild}`,
      `HTML releaseProductCommit: ${htmlProductCommit}`,
      `HTML releaseBaseCommit: ${htmlBaseCommit}`,
      `HTML releaseName: ${htmlName}`,
      `HTML consumerRelease: ${htmlConsumer}`,
      `HTML architectureStage: ${htmlStage}`,
      `HTML gitCommitSignature: ${htmlSignature}`,
      `HTML deploymentProvenance: ${htmlDeploymentProvenance}`,
      `JavaScript commit: ${jsCommit}`,
      `JavaScript releaseTag: ${jsTag}`,
      `JavaScript expectedReleaseTag: ${jsExpectedTag}`,
      `JavaScript releaseRevision: ${jsRevision}`,
      `JavaScript releaseBuild: ${jsBuild}`,
      `JavaScript releaseProductCommit: ${jsProductCommit}`,
      `JavaScript releaseBaseCommit: ${jsBaseCommit}`,
      `JavaScript releaseName: ${jsName}`,
      `JavaScript consumerRelease: ${jsConsumer}`,
      `JavaScript architectureStage: ${jsStage}`,
      `JavaScript gitCommitSignature: ${jsSignature}`,
      `JavaScript deploymentProvenance: ${jsDeploymentProvenance}`,
    ]);
  }

  return {
    schemaVersion: "legacy-build-truth-v3",
    sourcePath: "public/legacy/novel-system.html",
    deployedRoute: "/legacy/novel-system.html",
    hashMode: "sha256-normalized-release-fields-v1",
    commit: expectedCommit,
    releaseProductCommit: expectedProductCommit,
    releaseBaseCommit: expectedBaseCommit,
    releaseTag: expectedTag,
    releaseRevision: expectedRevision,
    releaseBuild: expectedBuild,
    releaseName: expectedName,
    consumerRelease: expectedConsumer,
    architectureStage: expectedStage,
    gitCommitSignature: expectedSignature,
    deploymentProvenance: expectedDeploymentProvenance,
    artifactAttestationStatus: "not_produced",
    artifactAttestationDigest: null,
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
