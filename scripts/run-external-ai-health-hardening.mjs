import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [providersRoute, cloudHealth, aggregateHealth, environmentExample, governance, studio, settings, learning, learningRoute, ...legacyRoutes] =
  await Promise.all([
    readFile(new URL("../app/api/ai/external/providers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/cloud/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("./production-environment-governance.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/settings/ai/settings-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/learning/learning-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/learning/web-distill/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/analyze/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/chapter-plan/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/continuity-review/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/story-bible/extract/route.ts", import.meta.url), "utf8"),
  ]);

assert.match(providersRoute, /if \(probe\) \{[\s\S]*?assertExternalAIRequestOrigin\(request\)/u);
assert.match(providersRoute, /reserveExternalAIRequest\(externalAIClientIdentifier\(request\), 64\)/u);
assert.match(providersRoute, /probeLease\?\.release\(\)/u);
assert.match(providersRoute, /probePerformed:\s*false/u);
assert.match(providersRoute, /routeReady:\s*true/u);
assert.match(providersRoute, /executionEnabled,\s*\n\s*operational:\s*executionEnabled && probe && verification === "verified"/u);
assert.match(
  providersRoute,
  /:\s*listExternalAIProviderStatus\(\)\.filter/u,
  "ordinary read-only provider status must remain available without a live probe",
);

for (const [name, source] of [
  ["cloud health", cloudHealth],
  ["aggregate health", aggregateHealth],
]) {
  assert.doesNotMatch(source, /pingModel/u, `${name} must not perform paid generation as health`);
  assert.match(source, /configured_unverified/u);
  assert.match(source, /liveProbePerformed:\s*false/u);
  assert.match(source, /modelPingMs:\s*null|pingLatencyMs:\s*null/u);
}

assert.match(environmentExample, /^AI_PROVIDER=openai-compatible$/mu);
assert.match(environmentExample, /^AI_MODEL=gpt-4o-mini$/mu);
assert.match(environmentExample, /^EXTERNAL_AI_PUBLIC_EXECUTION_ENABLED=0$/mu);
assert.doesNotMatch(
  environmentExample,
  /^AI_PROVIDER=google\r?\nAI_MODEL=gpt-4o-mini$/mu,
  "example provider and model family must agree",
);

assert.match(governance, /Origin:\s*`https:\/\/\$\{alias\}`/u);
assert.match(governance, /"Sec-Fetch-Site":\s*"same-origin"/u);

assert.match(studio, /useState<NovelAIExecutionMode>\("closed-only"\)/u);
assert.match(studio, /isNovelAIExecutionMode\(saved\?\.executionMode\)/u);
assert.match(studio, /isExternalAIProviderId\(saved\?\.externalProviderId\)/u);
assert.match(studio, /fetch\("\/api\/ai\/external\/providers"/u);
assert.match(studio, /provider \? provider\.configured \? "伺服器已設定" : "尚未設定"/u);
assert.match(studio, /setExternalRunConsent\(false\)/u);
assert.match(studio, /我同意只在下一次 AI 工作中/u);
assert.match(studio, /外接 AI 不會在閉端失敗時偷偷接手/u);
assert.match(studio, /candidateKind:\s*"external-ai"/u);

assert.match(settings, /data-execution-enabled=\{externalExecutionEnabled\}/u);
assert.match(settings, /disabled=\{!externalExecutionEnabled/u);
assert.match(settings, /金鑰設定不等於允許匿名訪客消耗額度/u);

assert.match(learning, /externalAnalysisEnabled && externalResearchConsent/u);
assert.match(learning, /const providerIds = externalConsent \? publicResearchCoordination\.externalProviderIds : \[\]/u);
assert.match(learning, /setExternalResearchConsent\(false\);/u);
assert.match(learning, /未勾選時只用閉端教師/u);
assert.match(learningRoute, /isExternalAIPublicExecutionEnabled\(\)/u);
assert.match(learningRoute, /WEB_DISTILLATION_EXTERNAL_EXECUTION_DISABLED/u);

for (const source of legacyRoutes) {
  assert.match(source, /LEGACY_EXTERNAL_AI_ROUTE_DISABLED|legacyExternalAIRouteDisabled/u);
  assert.doesNotMatch(source, /createNovelProvider|analyzeStoryWithFallback|extractStoryBibleCandidates|generateText/u);
}

console.log(JSON.stringify({
  status: "PASS",
  publicHealthPaidGeneration: false,
  ordinaryProviderSnapshotPublic: true,
  liveProviderProbeSameOriginOnly: true,
  liveProviderProbeRateLimited: true,
  legacyEnvironmentProviderModelConsistent: true,
  studioExternalAIExplicitOptIn: true,
  externalCandidateRequiresApproval: true,
  publicResearchConsentSingleUse: true,
  publicResearchExternalExecutionFailClosed: true,
  unguardedLegacyExternalRoutesDisabled: legacyRoutes.length,
}, null, 2));
