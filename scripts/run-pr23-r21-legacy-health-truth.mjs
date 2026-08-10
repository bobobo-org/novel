import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [legacyHealth, cloudHealth, persistenceHealth, closedContract, professional] =
  await Promise.all([
    readFile(new URL("../app/api/ai/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/cloud/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/persistence/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/closed/contract/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/professional/professional-client.tsx", import.meta.url), "utf8"),
  ]);

assert.match(legacyHealth, /surfaceType:\s*"legacy_aggregate"/u);
assert.match(legacyHealth, /deprecatedForClosedAIRuntime:\s*true/u);
assert.match(
  legacyHealth,
  /release:\s*"\/api\/release\/identity"/u,
);
assert.match(
  legacyHealth,
  /cloudAI:\s*"\/api\/ai\/cloud\/health"/u,
);
assert.match(
  legacyHealth,
  /persistence:\s*"\/api\/persistence\/health"/u,
);
assert.match(
  legacyHealth,
  /closedAIContract:\s*"\/api\/ai\/closed\/contract"/u,
);
assert.match(
  legacyHealth,
  /const CLOSED_AI_SERVER_RUNTIME_TRUTH = \{[\s\S]*?status:\s*"client_probe_required"[\s\S]*?generationVerifiedBackends:\s*0[\s\S]*?activeBackend:\s*null[\s\S]*?externalFallback:\s*false[\s\S]*?silentExternalFallback:\s*false/u,
);
assert.match(
  legacyHealth,
  /closedAiRuntimeStatus:\s*CLOSED_AI_SERVER_RUNTIME_TRUTH\.status/u,
);
assert.match(
  legacyHealth,
  /closedAiActualExecutor:\s*"client_execution_receipt_required"/u,
);
assert.match(
  legacyHealth,
  /closedAiSilentExternalFallback:\s*CLOSED_AI_SERVER_RUNTIME_TRUTH\.silentExternalFallback/u,
);
assert.match(legacyHealth, /legacyCloudAnalysis:\s*\{/u);
assert.match(
  legacyHealth,
  /fallback:\s*\{\s*enabled:\s*true,\s*model:\s*"local-rule"/u,
);

for (const forbidden of [
  "modelStatus",
  "provider",
  "model",
  "fallbackEnabled",
  "fallbackModel",
]) {
  assert.doesNotMatch(
    legacyHealth,
    new RegExp(`^    ${forbidden}:`, "mu"),
    `${forbidden} must not be a top-level legacy health field`,
  );
  assert.match(
    legacyHealth,
    new RegExp(`^      ${forbidden}:`, "mu"),
    `${forbidden} must remain isolated under legacyCloudAnalysis`,
  );
}

assert.match(cloudHealth, /dataLeavesDevice:\s*true/u);
assert.match(cloudHealth, /closedModeEligible:\s*false/u);
assert.match(persistenceHealth, /runtimeStatus:\s*"client_probe_required"/u);
assert.match(closedContract, /noSilentExternalFallback:\s*true/u);
assert.match(
  professional,
  /const controller = new AbortController\(\)/u,
);
assert.match(
  professional,
  /const snapshot = await discoverStudioClosedAI\(controller\.signal\)/u,
);
assert.match(
  professional,
  /controller\.abort\("PROFESSIONAL_AI_DISCOVERY_TIMEOUT"\)/u,
);
assert.match(professional, /snapshot\.status === "ollama_ready"/u);
assert.match(professional, /void fetch\("\/api\/ai\/health"/u);
assert.doesNotMatch(professional, /legacyCloudAnalysis/u);
assert.doesNotMatch(professional, /raw\.model\|\|raw\.modelId/u);

console.log(JSON.stringify({
  schemaVersion: "pr23-r2-1-legacy-health-truth-v1",
  status: "PASS",
  surfaceType: "legacy_aggregate",
  deprecatedForClosedAIRuntime: true,
  authoritativeSurfaceCount: 4,
  forbiddenTopLevelFieldCount: 0,
  closedAiRuntimeStatus: "client_probe_required",
  closedAiActualExecutor: "client_execution_receipt_required",
  closedAiSilentExternalFallback: false,
}, null, 2));
