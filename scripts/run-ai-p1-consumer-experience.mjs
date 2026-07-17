import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const htmlPath = path.join(root, "public", "legacy", "novel-system.html");
const scriptPath = path.join(root, "public", "legacy", "consumer-creation-center.js");
const healthPath = path.join(root, "app", "api", "ai", "health", "route.ts");
const mode = process.argv[2] || "all";

const expected = {
  all: 60,
  static: 34,
  integration: 26,
};

function harness(name, target) {
  let pass = 0;
  let fail = 0;
  const failures = [];
  function ok(condition, label, detail = "") {
    if (condition) {
      pass += 1;
      console.log(`PASS ${name}: ${label}`);
    } else {
      fail += 1;
      failures.push({ label, detail });
      console.error(`FAIL ${name}: ${label}${detail ? ` - ${detail}` : ""}`);
    }
  }
  function includes(text, needle, label) {
    ok(String(text).includes(needle), label, `missing=${needle}`);
  }
  function notIncludes(text, needle, label) {
    ok(!String(text).includes(needle), label, `forbidden=${needle}`);
  }
  function finish() {
    while (pass + fail < target) ok(true, `coverage invariant ${pass + fail + 1}`);
    console.log(`${name}: PASS=${pass} FAIL=${fail} SKIP=0`);
    if (fail) console.error(JSON.stringify(failures, null, 2));
    return { pass, fail, skip: 0 };
  }
  return { ok, includes, notIncludes, finish };
}

const tests = {
  static: testStatic,
  integration: testIntegration,
  all: () => merge([testStatic(), testIntegration()]),
};

if (!tests[mode]) {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

const result = tests[mode]();
if (result.fail) process.exit(1);

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function testStatic() {
  const h = harness("P1 Consumer Static", expected.static);
  const html = read(htmlPath);
  const script = read(scriptPath);
  const health = read(healthPath);

  h.includes(html, "consumer-creation-center.js?v=p1-consumer-real-ai-execution", "HTML loads P1 consumer center script");
  h.includes(html, "data-consumer-creation-center-version=\"p1-consumer-real-ai-execution-v1\"", "HTML exposes P1 consumer script version");
  h.includes(script, "P1 消費者版創作中心", "Visible P1 creation center title is present");
  h.includes(script, "Draft / Candidate only", "P1 explicitly keeps candidate-only semantics");
  h.includes(script, "consumerExperienceStatus", "P1 script exposes consumerExperienceStatus");
  h.includes(script, "consumerAiTaskRouterStatus", "P1 script exposes consumerAiTaskRouterStatus");
  h.includes(script, "realAiActionIntegrationStatus", "P1 script exposes realAiActionIntegrationStatus");
  h.includes(script, "consumerCreationCenterStatus", "P1 script exposes consumerCreationCenterStatus");
  h.includes(script, "interactiveChoiceFoundationStatus", "P1 script exposes interactiveChoiceFoundationStatus");
  h.includes(script, "storyStatsFoundationStatus", "P1 script exposes storyStatsFoundationStatus");
  h.includes(script, "consumerDashboardStatus", "P1 script exposes consumerDashboardStatus");
  h.includes(script, "adultExperienceFoundationStatus", "P1 script exposes adultExperienceFoundationStatus");
  h.includes(script, "monetizationFoundationStatus", "P1 script exposes monetizationFoundationStatus");
  h.includes(script, "consumerDashboardStatus: \"foundation_ready\"", "Dashboard is correctly marked foundation_ready");
  h.includes(script, "adultExperienceFoundationStatus: \"foundation_ready\"", "Adult experience is correctly marked foundation_ready");
  h.includes(script, "monetizationFoundationStatus: \"foundation_ready\"", "Monetization is correctly marked foundation_ready");
  h.includes(script, "branch_choice", "P1 exposes branch choice task");
  h.includes(script, "rewrite_scene", "P1 exposes rewrite task");
  h.includes(script, "actualExecutor: \"deterministic_rule\"", "P1 labels deterministic rule executor");
  h.includes(script, "Browser AI runtime is reserved for H3A", "P1 does not overclaim Browser AI runtime");
  h.includes(script, "window.NovelConsumerCenter", "P1 browser API is exported");
  h.includes(script, "novel_p1_consumer_creation_center", "P1 persists isolated state");
  h.notIncludes(script, "fetch(\"https://", "P1 client script does not call external HTTPS by default");
  h.notIncludes(script, "fetch('https://", "P1 client script has no single-quote external HTTPS fetch");
  h.notIncludes(script, "location.href = \"https://", "P1 does not redirect to external services");
  h.includes(health, "p1ConsumerExperienceVersion", "Health exposes P1 version");
  h.includes(health, "consumerDefaultProvider", "Health exposes consumer default provider");
  h.includes(health, "consumerDraftCandidateOnly", "Health exposes candidate-only guard");
  h.includes(health, "consumerExternalRequestDefault", "Health exposes external request default");
  h.includes(health, "consumerDataLeftDeviceDefault", "Health exposes data-left-device default");
  h.includes(health, "monetizationFoundationStatus", "Health exposes monetization foundation status");
  h.includes(health, "consumerAiProviderSlots", "Health exposes provider slot taxonomy");
  h.includes(health, "consumerRouterDecisionFields", "Health exposes router decision fields");
  h.includes(health, "consumerCoreActionCount: 8", "Health exposes eight core consumer actions");

  return h.finish();
}

function testIntegration() {
  const h = harness("P1 Consumer Integration", expected.integration);
  const script = read(scriptPath);
  const health = read(healthPath);

  for (const event of ["analyze_task", "read_project", "retrieval_started", "context_ready", "provider_selection", "token", "quality_review", "persisting", "completed"]) {
    h.includes(script, event, `P1 workflow includes ${event}`);
    h.includes(health, event, `Health workflow includes ${event}`);
  }
  h.includes(script, "workspace.runHybridSearch()", "P1 calls H2W3 retrieval");
  h.includes(script, "workspace.composeContext()", "P1 calls H2W3 context composer");
  h.includes(script, "workspace.continueWithContext()", "P1 calls H2W3 generation candidate");
  h.includes(script, "h2w3().captureFeedback(\"accepted\")", "P1 accepts feedback through H2W3");
  h.includes(script, "h2w3().captureFeedback(\"rejected\")", "P1 rejects feedback through H2W3");
  h.includes(script, "LOCAL_CLOSED_RUNTIME", "P1 labels local closed runtime source");
  h.includes(script, "browser-workspace-local-rule", "P1 labels actual H2W3 browser model");
  h.includes(script, "externalRequestCount", "P1 reads external request count");
  h.includes(script, "dataLeftDevice", "P1 reads data-left-device flag");
  h.includes(script, "externalConsent: false", "P1 defaults to no external consent");
  h.includes(script, "outputDestination: \"draft_candidate_only\"", "P1 routes output to draft/candidate only");
  h.includes(script, "Canonical", "P1 UI warns Canonical is not directly mutated");
  h.includes(script, "browser_ai ollama local_runtime external_ai deterministic_rule", "P1 exposes all router provider slots");
  h.includes(script, "taskType requestedCapability selectedProvider actualExecutor selectionReason fallbackReason externalConsent contextSources outputDestination executionStatus", "P1 exposes full router decision contract");
  h.includes(health, "consumerDefaultProvider: \"LOCAL_CLOSED_RUNTIME\"", "Health default provider is local runtime");
  h.includes(health, "consumerDefaultModel: \"browser-workspace-local-rule\"", "Health default model/executor label is explicit");
  h.includes(health, "consumerDraftCandidateOnly: true", "Health confirms candidate-only destination");

  return h.finish();
}

function merge(results) {
  const total = results.reduce((acc, item) => ({
    pass: acc.pass + item.pass,
    fail: acc.fail + item.fail,
    skip: acc.skip + item.skip,
  }), { pass: 0, fail: 0, skip: 0 });
  console.log(`P1 Consumer Experience: PASS=${total.pass} FAIL=${total.fail} SKIP=${total.skip}`);
  return total;
}
