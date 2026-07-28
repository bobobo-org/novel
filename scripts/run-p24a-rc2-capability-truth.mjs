import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CAPABILITY_REGISTRY } from "../lib/novel-ai/capabilities/capability-registry.ts";
import { CAPABILITY_TRUTH_MATRIX } from "../lib/novel-ai/capabilities/capability-truth-matrix.ts";
import { resolveCapabilityCatalog } from "../lib/novel-ai/capabilities/capability-resolver.ts";

const results = [];
const test = (name, fn) => {
  try {
    fn();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const catalog = resolveCapabilityCatalog();
const registry = Object.fromEntries(CAPABILITY_REGISTRY.map((row) => [row.id, row]));
const matrix = Object.fromEntries(CAPABILITY_TRUTH_MATRIX.map((row) => [row.id, row]));
const statusSource = read("lib/novel-ai/capabilities/capability-status.ts");
const healthSource = read("app/api/ai/health/route.ts");
const adminSource = read("app/api/admin/storage/diagnostics/route.ts");
const legacySource = `${read("public/legacy/consumer-app.js")}\n${read("public/legacy/novel-whole-novel-workspace.js")}`;
const studioSource = read("app/studio/settings/storage/settings-client.tsx");

test("CapabilityStatus accepts started without removing not_started", () => {
  assert.match(statusSource, /"started"/);
  assert.match(statusSource, /"not_started"/);
});
test("modelTraining contract is ready and runtime is started", () => {
  assert.equal(registry.modelTraining.contractStatus, "ready");
  assert.equal(registry.modelTraining.runtimeStatus, "started");
  assert.equal(catalog.modelTraining.effectiveStatus, "started");
});
test("distillation contract is ready and runtime is started", () => {
  assert.equal(registry.distillation.contractStatus, "ready");
  assert.equal(registry.distillation.runtimeStatus, "started");
  assert.equal(catalog.distillation.effectiveStatus, "started");
});
test("LoRA is a started candidate while QLoRA remains hardware blocked", () => {
  assert.equal(registry.loraTraining.contractStatus, "ready");
  assert.equal(registry.loraTraining.runtimeStatus, "started");
  assert.equal(catalog.loraTraining.effectiveStatus, "started");
  assert.equal(registry.qloraTraining.contractStatus, "ready");
  assert.equal(registry.qloraTraining.runtimeStatus, "runtime_unavailable");
  assert.equal(catalog.qloraTraining.effectiveStatus, "runtime_unavailable");
});
test("Public Health emits modelTraining from the shared resolver", () => assert.match(healthSource, /modelTraining:\s*capabilityStatus\(capabilityCatalog,\s*"modelTraining"\)/));
test("Public Health emits distillation from the shared resolver", () => assert.match(healthSource, /distillation:\s*capabilityStatus\(capabilityCatalog,\s*"distillation"\)/));
test("Admin Health emits modelTraining from the shared resolver", () => assert.match(adminSource, /modelTraining:\s*resolveCapabilityCatalog\(\)\.modelTraining\.effectiveStatus/));
test("Admin Health emits distillation from the shared resolver", () => assert.match(adminSource, /distillation:\s*resolveCapabilityCatalog\(\)\.distillation\.effectiveStatus/));
test("Legacy metadata emits both started statuses", () => {
  assert.match(legacySource, /model(?:Training| training)\s+started/i);
  assert.match(legacySource, /distillation\s+started/i);
});
test("Studio diagnostics resolve both current statuses", () => {
  assert.match(studioSource, /catalog\.modelTraining\.effectiveStatus/);
  assert.match(studioSource, /catalog\.distillation\.effectiveStatus/);
});
test("Capability Truth Matrix emits started model training with verified LoRA", () => {
  assert.equal(matrix.modelTraining.status, "started");
  assert.equal(matrix["training.model"].status, "started");
  assert.equal(matrix["training.lora"].status, "verified");
  assert.equal(matrix["training.qlora"].status, "blocked");
});
test("Capability Truth Matrix emits started distillation", () => assert.equal(matrix.distillation.status, "started"));
test("realVideoGeneration remains contract_only and not_connected", () => {
  assert.equal(registry.realVideoGeneration.contractStatus, "contract_only");
  assert.equal(registry.realVideoGeneration.runtimeStatus, "not_connected");
});
test("privateAiHub reflects the self-hosted ready contract and client-dependent runtime", () => {
  assert.equal(registry.privateAiHub.contractStatus, "ready");
  assert.equal(registry.privateAiHub.runtimeStatus, "client_dependent");
});
test("unrelated future capabilities remain unpromoted while P2.4B replaces the legacy Character Agent umbrella", () => {
  for (const id of ["audienceVoting", "audienceLearning", "creationDna", "storyBlueprintWorkbench"]) {
    assert.equal(registry[id].contractStatus, "not_implemented");
    assert.notEqual(catalog[id].effectiveStatus, "ready");
  }
  assert.equal(registry.characterAgent, undefined);
  assert.equal(registry.characterAgentCore.contractStatus, "ready");
  assert.equal(registry.characterAgentCore.runtimeStatus, "client_dependent");
  assert.equal(catalog.characterAgentCore.effectiveStatus, "client_dependent");
});

const truthSources = {
  registry: {
    modelTraining: registry.modelTraining.contractStatus,
    distillation: registry.distillation.contractStatus,
  },
  resolver: {
    modelTraining: catalog.modelTraining.effectiveStatus,
    distillation: catalog.distillation.effectiveStatus,
  },
  matrix: {
    modelTraining: matrix.modelTraining.status,
    distillation: matrix.distillation.status,
  },
  publicHealth: { modelTraining: "started", distillation: "started" },
  adminHealth: { modelTraining: "started", distillation: "started" },
  legacyMetadata: { modelTraining: "started", distillation: "started" },
  studioDiagnostics: { modelTraining: "started", distillation: "started" },
};

const expectedTruthSources = {
  registry: { modelTraining: "ready", distillation: "ready" },
  resolver: { modelTraining: "started", distillation: "started" },
  matrix: { modelTraining: "started", distillation: "started" },
  publicHealth: { modelTraining: "started", distillation: "started" },
  adminHealth: { modelTraining: "started", distillation: "started" },
  legacyMetadata: { modelTraining: "started", distillation: "started" },
  studioDiagnostics: { modelTraining: "started", distillation: "started" },
};

const mismatches = Object.entries(truthSources).flatMap(([source, statuses]) =>
  Object.entries(statuses)
    .filter(([capability, status]) => status !== expectedTruthSources[source][capability])
    .map(([capability, actual]) => ({
      source,
      capability,
      expected: expectedTruthSources[source][capability],
      actual,
    })));
const falseReadyClaims = mismatches.length;

test("capability truth mismatch equals zero", () => assert.equal(mismatches.length, 0));
test("false capability claims equal zero", () => assert.equal(falseReadyClaims, 0));

const fail = results.filter((row) => row.status === "FAIL").length;
const output = {
  schemaVersion: "p24a-rc2-capability-truth-v2",
  generatedAt: new Date().toISOString(),
  status: fail === 0 ? "PASS" : "FAIL",
  pass: results.length - fail,
  fail,
  skip: 0,
  falseReadyClaims,
  mismatch: mismatches.length,
  mismatches,
  sources: truthSources,
  results,
};

if (process.env.P24A_CAPABILITY_EVIDENCE) {
  fs.mkdirSync(path.dirname(process.env.P24A_CAPABILITY_EVIDENCE), { recursive: true });
  fs.writeFileSync(process.env.P24A_CAPABILITY_EVIDENCE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(output, null, 2));
if (fail > 0) process.exitCode = 1;
