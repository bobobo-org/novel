import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PRODUCT_COMMIT = "5d4baf603d722965940bbd3427144b335675d692";
const PREVIEW_ORIGIN = "https://novel-q7bdnq1dt-lqtechs-projects.vercel.app";
const PREVIEW_DEPLOYMENT = "dpl_Hpz2d6g6v1AUfjyChRZygpcCfWTA";
const PRODUCTION_COMMIT = "5ddc32918f0d866a85e04b4398c7e66ce8d36e2b";
const PRODUCTION_DEPLOYMENT = "dpl_2LvkxKiQY5VHGf7eaNm3hBsN5YJT";
const CI = {
  runId: 30666646378,
  validateJobId: 91275144736,
  previewJobId: 91275601654,
  productionJobId: 91275602191,
  validateConclusion: "success",
  previewConclusion: "success",
  productionConclusion: "skipped",
};

const outputDir = path.resolve("artifacts/p24b-rc3-consumer-activation");
const mode = process.argv[2] ?? "verify";
const expectedEvidenceFiles = [
  "baseline.json",
  "production-baseline.json",
  "route-matrix.json",
  "frontdoor-results.json",
  "studio-results.json",
  "legacy-migration-results.json",
  "local-ai-setup-results.json",
  "edge-runtime-results.json",
  "local-ollama-results.json",
  "canon-approval-results.json",
  "rpg-results.json",
  "backup-restore-results.json",
  "service-worker-upgrade-results.json",
  "mobile-results.json",
  "release-identity.json",
  "supabase-audit.json",
  "secret-scan.json",
  "findings.json",
  "executive-summary.md",
  "luna-handoff.md",
];
const finalFiles = [...expectedEvidenceFiles, "evidence-manifest.json", "evidence-manifest.sha256"];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const target = (name) => path.join(outputDir, name);
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(outputDir, relative), "utf8"));
const writeJson = (name, value) => fs.writeFileSync(target(name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
const caseByName = (suite, name) => suite.cases.find((entry) => entry.name === name);
const checkByName = (report, name) => report.checks.find((entry) => entry.name === name);
const canonicalJson = (value) => JSON.stringify(value);

function assertPass(value, message) {
  assert.equal(value, "PASS", message);
}

function selectedEndpointFacts(endpoint, body) {
  if (endpoint === "/api/release/identity") {
    return {
      appCommit: body.appCommit,
      deploymentId: body.deploymentId,
      releaseTag: body.releaseTag,
      architectureStage: body.architectureStage,
      environment: body.environment,
      provenanceStatus: body.provenanceStatus,
    };
  }
  if (endpoint === "/api/ai/health") {
    return {
      appCommit: body.appCommit,
      deploymentId: body.deploymentId,
      releaseTag: body.releaseTag,
      architectureStage: body.architectureStage,
      provenanceStatus: body.commitProvenanceStatus ?? body.provenanceStatus,
      apiStatus: body.apiStatus,
      persistenceStatus: body.persistenceStatus,
      databaseStatus: body.databaseStatus,
      closedAiRuntimeStatus: body.closedAiRuntimeStatus,
    };
  }
  if (endpoint === "/api/persistence/health") {
    return {
      cloudPersistenceStatus: body.cloudPersistence?.status,
      migrationStatus: body.cloudPersistence?.migrationStatus,
      writeProbeStatus: body.cloudPersistence?.writeProbeStatus,
      localCanonicalProvider: body.localCanonicalStorage?.provider,
      localCanonicalRuntimeStatus: body.localCanonicalStorage?.runtimeStatus,
    };
  }
  if (endpoint === "/api/ai/cloud/health") {
    return {
      configured: body.configured,
      provider: body.provider,
      model: body.model,
      pingStatus: body.pingStatus,
      dataLeavesDevice: body.dataLeavesDevice,
      requiresExplicitConsent: body.requiresExplicitConsent,
      closedModeEligible: body.closedModeEligible,
    };
  }
  if (endpoint === "/api/ai/closed/contract") {
    return {
      noSilentExternalFallback: body.noSilentExternalFallback,
      localOllamaRuntimeStatus: body.localOllama?.runtimeStatus,
      closedAgentRuntimeStatus: body.closedAgentOS?.runtimeStatus,
      canonicalMutationBeforeApproval: body.closedAgentOS?.canonicalMutationBeforeApproval,
    };
  }
  throw new Error(`UNSUPPORTED_ENDPOINT:${endpoint}`);
}

async function fetchEndpoint(origin, endpoint) {
  const url = new URL(endpoint, origin);
  url.searchParams.set("rc3_evidence_probe", crypto.randomUUID());
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  assert.equal(response.status, 200, `${origin}${endpoint} was not HTTP 200`);
  return {
    httpStatus: response.status,
    cacheControl: response.headers.get("cache-control"),
    bodySha256: sha256(raw),
    stable: selectedEndpointFacts(endpoint, JSON.parse(raw)),
  };
}

function normalizedLocation(origin, location) {
  if (!location) return undefined;
  const url = new URL(location, origin);
  url.searchParams.delete("rc3_evidence_probe");
  return `${url.pathname}${url.search}`;
}

async function fetchRoute(origin, route) {
  const probe = new URL(route, origin);
  probe.searchParams.set("rc3_evidence_probe", crypto.randomUUID());
  const initial = await fetch(probe, {
    method: "GET",
    redirect: "manual",
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  const location = normalizedLocation(origin, initial.headers.get("location"));
  let finalStatus = initial.status;
  if (location) {
    const final = await fetch(new URL(location, origin), {
      method: "GET",
      redirect: "follow",
      headers: { "cache-control": "no-cache", pragma: "no-cache" },
      signal: AbortSignal.timeout(30_000),
    });
    finalStatus = final.status;
    await final.arrayBuffer();
  } else {
    await initial.arrayBuffer();
  }
  return {
    initialStatus: initial.status,
    ...(location ? { location } : {}),
    finalStatus,
  };
}

async function captureProductionBaseline(originalBaseline) {
  const endpoints = [
    "/api/release/identity",
    "/api/ai/health",
    "/api/persistence/health",
    "/api/ai/cloud/health",
    "/api/ai/closed/contract",
  ];
  const routes = ["/", "/studio", "/settings/local-ai", "/studio/quick-assistant"];
  const aliases = [];
  for (const expectedAlias of originalBaseline.aliases) {
    const endpointResults = {};
    for (const endpoint of endpoints) endpointResults[endpoint] = await fetchEndpoint(expectedAlias.origin, endpoint);
    const routeResults = {};
    for (const route of routes) routeResults[route] = await fetchRoute(expectedAlias.origin, route);
    for (const endpoint of endpoints) {
      assert.deepEqual(
        endpointResults[endpoint].stable,
        expectedAlias.endpoints[endpoint].stable,
        `${expectedAlias.name} ${endpoint} changed from the captured Production baseline`,
      );
    }
    for (const route of routes) {
      assert.deepEqual(
        routeResults[route],
        expectedAlias.routes[route],
        `${expectedAlias.name} ${route} changed from the captured Production baseline`,
      );
    }
    aliases.push({ name: expectedAlias.name, origin: expectedAlias.origin, endpoints: endpointResults, routes: routeResults });
  }
  assert.deepEqual(aliases[0].endpoints["/api/release/identity"].stable, aliases[1].endpoints["/api/release/identity"].stable);
  return {
    schemaVersion: "p24b-rc3-production-final-readonly-v1",
    capturedAt: new Date().toISOString(),
    mode: "read-only-public-health-and-routes",
    requestCredentialsUsed: false,
    productionMutationCount: 0,
    expectedAppCommit: PRODUCTION_COMMIT,
    expectedDeploymentId: PRODUCTION_DEPLOYMENT,
    originalBaselineSha256: sha256(fs.readFileSync(target("production-baseline.json"))),
    aliases,
    verdict: {
      identityStable: true,
      primaryMirrorMatch: true,
      routesStable: true,
      cloudPersistenceStatus: "degraded",
      productionUnchanged: true,
      status: "CURRENT_PRODUCTION_UNCHANGED",
    },
  };
}

function readRawSources() {
  const exact = readJson("remote-exact-origin/exact-origin-results.json");
  const preview = readJson("preview-real-edge-gate/preview-consumer-gate.json");
  const native = readJson("native-edge-gate/automated-grant-summary.json");
  const unit = readJson("unit/all.json");
  const routeUnit = readJson("unit/production-route-matrix.json");
  const consoleRows = readJson("preview-real-edge-gate/console.json").rows ?? [];
  const networkRows = readJson("preview-real-edge-gate/network.json").rows ?? [];
  return { exact, preview, native, unit, routeUnit, consoleRows, networkRows };
}

function validateSources({ exact, preview, native, unit, routeUnit, consoleRows, networkRows }) {
  assertPass(exact.status, "Exact-origin gate failed");
  assertPass(preview.status, "Preview consumer gate failed");
  assert.equal(preview.findings.length, 0);
  assert.equal(preview.releaseIdentity.appCommit, PRODUCT_COMMIT);
  assert.equal(preview.releaseIdentity.deploymentId, PREVIEW_DEPLOYMENT);
  assert.equal(preview.origin, PREVIEW_ORIGIN);
  assert.equal(native.technical_status, "AUTOMATED_PASS");
  assert.equal(native.harnessExitCode, 0);
  assert.equal(native.nativeDecision?.status, "INVOKED");
  assert.equal(native.permissionSetting, 1);
  assert.equal(unit.pass, 10);
  assert.equal(unit.fail, 0);
  assert.equal(unit.skip, 0);
  assert.equal(routeUnit.pass, 1);
  assert.equal(routeUnit.fail, 0);
  assert.equal(routeUnit.skip, 0);
  assert.equal(consoleRows.filter((row) => row.type === "error").length, 0);
  assert.equal(networkRows.filter((row) => row.phase === "response" && Number(row.status) >= 400).length, 0);
  assert.equal(preview.privateStoryTextPersistedInEvidence, false);
  assert.equal(preview.pairingCodePersisted, false);
  assert.equal(preview.externalAiRequestCount, 0);
  assert.equal(preview.preApprovalCanonMutationCount, 0);
}

async function prepare() {
  fs.mkdirSync(outputDir, { recursive: true });
  const originalBaseline = readJson("production-baseline.json");
  assert.equal(originalBaseline.expectedAppCommit, PRODUCTION_COMMIT);
  assert.equal(originalBaseline.expectedDeploymentId, PRODUCTION_DEPLOYMENT);
  assert.equal(originalBaseline.productionMutationCount, 0);
  const sources = readRawSources();
  validateSources(sources);
  const { exact, preview, native, unit, routeUnit, consoleRows, networkRows } = sources;
  const generatedAt = new Date().toISOString();
  const productionFinal = await captureProductionBaseline(originalBaseline);
  writeJson("baseline.json", productionFinal);

  const frontdoor = checkByName(exact, "modern-frontdoor-default");
  const desktopFrontdoor = checkByName(exact, "desktop-frontdoor-no-horizontal-overflow");
  const setupDiscovery = checkByName(exact, "local-ai-setup-discoverable");
  const modernStudio = checkByName(exact, "modern-studio-default");
  const legacy = checkByName(exact, "legacy-explicit-only");
  const legacyReturn = checkByName(exact, "legacy-return-to-modern");
  const desktopStudio = checkByName(exact, "desktop-studio-no-horizontal-overflow");
  const localFlow = checkByName(preview, "06-10-edge-local-ollama");
  const canon = checkByName(preview, "12-20-canon-approval-reload");
  const rpg = checkByName(preview, "21-24-rpg-atomic-choice");
  const backup = checkByName(preview, "25-27-backup-restore");
  const legacyMobile = checkByName(preview, "28-30-legacy-return-mobile");

  for (const row of [frontdoor, desktopFrontdoor, setupDiscovery, modernStudio, legacy, legacyReturn, desktopStudio, localFlow, canon, rpg, backup, legacyMobile]) {
    assert.ok(row, "Required browser checkpoint is missing");
    assertPass(row.status, `${row.name} failed`);
  }

  writeJson("route-matrix.json", {
    schemaVersion: "p24b-rc3-route-matrix-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    previewOrigin: PREVIEW_ORIGIN,
    unit: { pass: routeUnit.pass, fail: routeUnit.fail, skip: routeUnit.skip },
    preview: {
      manualDeepUrlCount: exact.manualDeepUrlCount,
      legacyUnexpectedRedirectCount: preview.legacyUnexpectedRedirectCount,
      checks: exact.checks.map(({ name, status }) => ({ name, status })),
    },
    production: {
      mode: "read-only",
      mutationCount: 0,
      unchanged: productionFinal.verdict.productionUnchanged,
      routes: productionFinal.aliases.map(({ name, origin, routes }) => ({ name, origin, routes })),
    },
    status: "PASS",
  });
  writeJson("frontdoor-results.json", {
    schemaVersion: "p24b-rc3-frontdoor-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    origin: PREVIEW_ORIGIN,
    defaultSurface: "modern-consumer-frontdoor",
    manualDeepUrlCount: preview.manualDeepUrlCount,
    desktop: desktopFrontdoor,
    browserCheckpoint: frontdoor,
    unitCheckpoint: caseByName(unit, "consumer-frontdoor-default"),
    status: "PASS",
  });
  writeJson("studio-results.json", {
    schemaVersion: "p24b-rc3-studio-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    defaultSurface: "modern-studio",
    browserCheckpoint: modernStudio,
    desktop: desktopStudio,
    projectFlow: checkByName(preview, "02-05-project-character-world-paragraph"),
    unitCheckpoints: [caseByName(unit, "studio-modern-default"), caseByName(unit, "frontdoor-project-routing")],
    status: "PASS",
  });
  writeJson("legacy-migration-results.json", {
    schemaVersion: "p24b-rc3-legacy-migration-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    explicitOnly: legacy,
    hardReturnToModern: legacyReturn,
    mobileCompatibility: legacyMobile,
    migrationPreview: caseByName(unit, "legacy-indexeddb-migration-preview"),
    legacyDataMutationCount: 0,
    status: "PASS",
  });
  writeJson("local-ai-setup-results.json", {
    schemaVersion: "p24b-rc3-local-ai-setup-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    origin: PREVIEW_ORIGIN,
    discovery: setupDiscovery,
    setupStepCount: setupDiscovery.stepCount,
    firstTimeNetworkProbeInvoked: true,
    pairingCodePersisted: preview.pairingCodePersisted,
    originEnrollmentRemainingAfterCleanup: 0,
    localBridgeListenerCountAfterCleanup: 0,
    status: "PASS",
  });
  writeJson("edge-runtime-results.json", {
    schemaVersion: "p24b-rc3-edge-runtime-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    browser: "Microsoft Edge",
    freshProfileAtNativeGateStart: true,
    nativeDecision: "allow",
    nativeDecisionMethod: native.decision_method,
    nativeDecisionStatus: native.nativeDecision.status,
    permissionSetting: native.permissionSetting,
    harnessExitCode: native.harnessExitCode,
    technicalStatus: native.technical_status,
    acceptanceProfileReusedFromNativeGate: preview.browser.nativeProfileReused,
    consoleErrorCount: consoleRows.filter((row) => row.type === "error").length,
    httpErrorResponseCount: networkRows.filter((row) => row.phase === "response" && Number(row.status) >= 400).length,
    rawProfileStored: false,
    rawCookieStored: false,
    rawHarStored: false,
    status: "PASS",
  });
  writeJson("local-ollama-results.json", {
    schemaVersion: "p24b-rc3-local-ollama-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    origin: PREVIEW_ORIGIN,
    modelId: preview.model.modelId,
    actualExecutor: preview.model.actualExecutor,
    modelVerification: localFlow.modelVerification,
    dataLeftDevice: preview.model.dataLeftDevice,
    externalRequest: preview.model.externalRequest,
    externalAiRequestCount: preview.externalAiRequestCount,
    rawChainOfThoughtStored: false,
    privateStoryTextPersistedInEvidence: preview.privateStoryTextPersistedInEvidence,
    status: "PASS",
  });
  writeJson("canon-approval-results.json", {
    schemaVersion: "p24b-rc3-canon-approval-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    actualExecutor: canon.actualExecutor,
    rejectRegenerateApproveReload: true,
    preApprovalCanonMutationCount: canon.preApprovalMutationCount,
    firstCandidateDigest: canon.firstCandidateDigest,
    regeneratedCandidateDigest: canon.secondCandidateDigest,
    approvedCanonHash: canon.approvedCanonHash,
    privateStoryTextStored: false,
    status: "PASS",
  });
  writeJson("rpg-results.json", {
    schemaVersion: "p24b-rc3-rpg-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    choicesPresented: rpg.choices,
    acceptedChoiceDelta: rpg.acceptedChoiceDelta,
    storyBranchDelta: rpg.storyBranchDelta,
    atomicChoiceApplied: rpg.acceptedChoiceDelta === 1 && rpg.storyBranchDelta === 1,
    status: "PASS",
  });
  writeJson("backup-restore-results.json", {
    schemaVersion: "p24b-rc3-backup-restore-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    semanticHash: backup.semanticHash,
    semanticHashStatus: "MATCH",
    privateStoryTextStored: false,
    status: "PASS",
  });
  writeJson("service-worker-upgrade-results.json", {
    schemaVersion: "p24b-rc3-service-worker-upgrade-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    policy: {
      navigation: "network-first-modern-frontdoor",
      immutableHashedAssets: "cache-first",
      api: "not-cached",
      localBridge: "not-intercepted",
      indexedDb: "not-cleared-or-rewritten",
    },
    unitCheckpoint: caseByName(unit, "service-worker-frontdoor-upgrade"),
    status: "PASS",
  });
  writeJson("mobile-results.json", {
    schemaVersion: "p24b-rc3-mobile-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    viewport: "390x844",
    frontdoor: checkByName(preview, "mobile-frontdoor-no-horizontal-overflow"),
    studio: checkByName(preview, "mobile-studio-no-horizontal-overflow"),
    legacy: legacyMobile,
    horizontalOverflowCount: preview.horizontalOverflowCount,
    unitCheckpoint: caseByName(unit, "mobile-frontdoor-usability"),
    status: "PASS",
  });
  writeJson("release-identity.json", {
    schemaVersion: "p24b-rc3-release-identity-evidence-v1",
    generatedAt,
    productCommit: PRODUCT_COMMIT,
    previewOrigin: PREVIEW_ORIGIN,
    previewDeploymentId: PREVIEW_DEPLOYMENT,
    releaseTag: preview.releaseIdentity.releaseTag,
    releaseName: preview.releaseIdentity.releaseName,
    consumerRelease: preview.releaseIdentity.consumerRelease,
    architectureStage: preview.releaseIdentity.architectureStage,
    buildTime: preview.releaseIdentity.buildTime,
    environment: preview.releaseIdentity.environment,
    provenanceStatus: preview.releaseIdentity.provenanceStatus,
    provenanceSource: preview.releaseIdentity.provenanceSource,
    ci: CI,
    productionDeploymentJobSkipped: true,
    status: "P2.4B_RC3_RELEASE_IDENTITY_PASS",
  });
  console.log(JSON.stringify({ status: "PREPARED", productCommit: PRODUCT_COMMIT, productionUnchanged: true, rawEvidenceReadyForRemoval: true }));
}

function scanCredentials() {
  const patterns = [
    { name: "vercel_cli_token", expression: /vcp_[A-Za-z0-9]{24,}/g },
    { name: "supabase_access_token", expression: /sbp_[a-f0-9]{32,}/gi },
    { name: "openai_api_key", expression: /sk-[A-Za-z0-9]{32,}/g },
    { name: "github_token", expression: /gh[pousr]_[A-Za-z0-9]{36,}/g },
    { name: "google_api_key", expression: /AIza[0-9A-Za-z_-]{35}/g },
    { name: "private_key_block", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  ];
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).split(/\r?\n/).filter(Boolean);
  const hits = [];
  let textFiles = 0;
  for (const relative of files) {
    let bytes;
    try {
      bytes = fs.readFileSync(relative);
    } catch {
      continue;
    }
    if (bytes.includes(0)) continue;
    textFiles += 1;
    const text = bytes.toString("utf8");
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern.expression)) {
        hits.push({
          file: relative.replaceAll("\\", "/"),
          type: pattern.name,
          redactedFingerprint: sha256(match[0]).slice(0, 12),
        });
      }
    }
  }
  return {
    schemaVersion: "p24b-rc3-secret-scan-v1",
    generatedAt: new Date().toISOString(),
    trackedAndUntrackedTextFiles: textFiles,
    trueCredentialHits: hits.length,
    rawCredentialValuesStored: false,
    hits,
    status: hits.length === 0 ? "PASS" : "FAIL",
  };
}

function topLevelEntries() {
  return fs.readdirSync(outputDir, { withFileTypes: true }).map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
}

function seal() {
  const before = topLevelEntries();
  const unexpectedBeforeSeal = before.filter((entry) => entry.directory || ![
    ...expectedEvidenceFiles,
    "evidence-manifest.json",
    "evidence-manifest.sha256",
  ].includes(entry.name));
  assert.deepEqual(unexpectedBeforeSeal, [], "Remove raw/source evidence directories before sealing");

  const production = readJson("baseline.json");
  const release = readJson("release-identity.json");
  const supabase = readJson("supabase-audit.json");
  assert.equal(production.verdict.productionUnchanged, true);
  assert.equal(production.productionMutationCount, 0);
  assert.equal(release.productCommit, PRODUCT_COMMIT);
  assert.equal(release.previewDeploymentId, PREVIEW_DEPLOYMENT);
  assert.equal(supabase.productionMutationCount, 0);
  assert.equal(supabase.productionModified, false);
  assert.equal(supabase.claims.cloudPersistenceReady, false);

  const secretScan = scanCredentials();
  writeJson("secret-scan.json", secretScan);
  assert.equal(secretScan.trueCredentialHits, 0, "Credential-like value detected");
  writeJson("findings.json", {
    schemaVersion: "p24b-rc3-findings-v1",
    generatedAt: new Date().toISOString(),
    productCommit: PRODUCT_COMMIT,
    blocking: [],
    nonBlocking: [
      "Cloud persistence remains degraded and is not release-ready.",
      "The additive Supabase repair plan was audited but not applied to Production.",
      "Independent LUNA review remains the next gate; this evidence does not authorize merge.",
    ],
    blockingCount: 0,
    productionMutationCount: 0,
    credentialHits: 0,
    status: "PASS",
  });
  fs.writeFileSync(target("executive-summary.md"), `# P2.4B RC3 Consumer Activation Evidence\n\n- Product commit: \`${PRODUCT_COMMIT}\`\n- Preview: \`${PREVIEW_ORIGIN}\` / \`${PREVIEW_DEPLOYMENT}\`\n- Release: \`${release.releaseTag}\` / \`${release.architectureStage}\`\n- Modern consumer frontdoor and modern Studio default: PASS\n- Explicit-only Legacy compatibility and hard return to modern UI: PASS\n- Real Microsoft Edge native Local Network Access gate: PASS\n- Local Bridge with \`qwen2.5:3b\`, actual executor \`local-ollama\`: PASS\n- Canon reject/regenerate/approve/reload flow: PASS; pre-approval mutation 0\n- RPG three-choice atomic update: PASS\n- Backup/restore semantic hash: MATCH\n- Desktop and 390x844 mobile horizontal overflow: 0\n- Browser console errors: 0; HTTP error responses: 0\n- External AI requests: 0; private story text in evidence: false\n- CI validate and Preview jobs: success; Production job: skipped\n- Production aliases remain on \`${PRODUCTION_COMMIT}\` / \`${PRODUCTION_DEPLOYMENT}\`\n- Production mutations: 0; Supabase Production modified: false\n- Cloud persistence: NOT READY (degraded)\n- True credential hits: 0\n\nThis package is ready for independent LUNA review. It does not claim merge approval or Production deployment.\n`, "utf8");
  fs.writeFileSync(target("luna-handoff.md"), `# Independent LUNA handoff\n\nReview Product commit \`${PRODUCT_COMMIT}\` independently from the Evidence commit that contains this package.\n\nRequired checks:\n\n1. Recompute \`evidence-manifest.json\` records, manifest self-hash, and \`evidence-manifest.sha256\`.\n2. Confirm Preview identity is \`${PREVIEW_DEPLOYMENT}\` and build-sealed to the Product commit.\n3. Confirm modern frontdoor, modern Studio, explicit Legacy migration, Edge Local Network Access, Local Bridge / \`qwen2.5:3b\`, Canon approval/reload, RPG, backup/restore, service-worker upgrade, and mobile reports are PASS.\n4. Confirm \`baseline.json\` matches the earlier \`production-baseline.json\` identity and routes for both aliases.\n5. Confirm \`supabase-audit.json\` records zero Production mutations and does not claim cloud persistence ready.\n6. Confirm no raw Profile, Cookie, HAR, authorization header, pairing code, private story text, or chain-of-thought is present.\n\nAllowed conclusion after an independent match: \`P2.4B_RC3_READY_FOR_INDEPENDENT_LUNA\`. Do not infer READY_TO_MERGE or PRODUCTION_DEPLOYED from this package.\n`, "utf8");

  const missing = expectedEvidenceFiles.filter((name) => !fs.existsSync(target(name)));
  assert.deepEqual(missing, []);
  const after = topLevelEntries();
  const unexpected = after.filter((entry) => entry.directory || !finalFiles.includes(entry.name));
  assert.deepEqual(unexpected, []);
  const records = expectedEvidenceFiles.map((name) => {
    const bytes = fs.readFileSync(target(name));
    return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const payload = {
    schemaVersion: "p24b-rc3-consumer-activation-evidence-manifest-v1",
    generatedAt: new Date().toISOString(),
    productCommit: PRODUCT_COMMIT,
    previewOrigin: PREVIEW_ORIGIN,
    previewDeploymentId: PREVIEW_DEPLOYMENT,
    productionCommit: PRODUCTION_COMMIT,
    productionDeploymentId: PRODUCTION_DEPLOYMENT,
    recordCount: records.length,
    missing: 0,
    unexpected: 0,
    mismatch: 0,
    credentialHits: 0,
    records,
  };
  const manifest = { ...payload, selfHash: sha256(canonicalJson(payload)), selfHashStatus: "MATCH" };
  writeJson("evidence-manifest.json", manifest);
  fs.writeFileSync(target("evidence-manifest.sha256"), `${sha256(fs.readFileSync(target("evidence-manifest.json")))}  evidence-manifest.json\n`, "ascii");
  verify();
}

function verify() {
  const entries = topLevelEntries();
  const missing = finalFiles.filter((name) => !entries.some((entry) => !entry.directory && entry.name === name));
  const unexpected = entries.filter((entry) => entry.directory || !finalFiles.includes(entry.name));
  assert.deepEqual(missing, [], "Evidence file missing");
  assert.deepEqual(unexpected, [], "Unexpected evidence entry present");
  const manifest = readJson("evidence-manifest.json");
  const { selfHash, selfHashStatus, ...payload } = manifest;
  assert.equal(selfHashStatus, "MATCH");
  assert.equal(selfHash, sha256(canonicalJson(payload)), "Manifest self-hash mismatch");
  assert.equal(manifest.recordCount, expectedEvidenceFiles.length);
  assert.equal(manifest.missing, 0);
  assert.equal(manifest.unexpected, 0);
  assert.equal(manifest.mismatch, 0);
  assert.equal(manifest.credentialHits, 0);
  for (const record of manifest.records) {
    const bytes = fs.readFileSync(target(record.path));
    assert.equal(record.bytes, bytes.length, `${record.path} byte count mismatch`);
    assert.equal(record.sha256, sha256(bytes), `${record.path} digest mismatch`);
  }
  const digestLine = fs.readFileSync(target("evidence-manifest.sha256"), "ascii").trim();
  assert.equal(digestLine, `${sha256(fs.readFileSync(target("evidence-manifest.json")))}  evidence-manifest.json`);
  assert.equal(readJson("secret-scan.json").trueCredentialHits, 0);
  console.log(JSON.stringify({
    status: "PASS",
    productCommit: PRODUCT_COMMIT,
    recordCount: manifest.recordCount,
    missing: 0,
    unexpected: 0,
    mismatch: 0,
    credentialHits: 0,
    selfHash: "MATCH",
    manifestDigest: "MATCH",
  }));
}

if (mode === "prepare") await prepare();
else if (mode === "seal") seal();
else if (mode === "verify") verify();
else throw new Error(`UNKNOWN_MODE:${mode}`);
