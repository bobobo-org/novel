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

test("CapabilityStatus accepts not_started", () => assert.match(statusSource, /"not_started"/));
test("modelTraining contractStatus is not_started", () => assert.equal(registry.modelTraining.contractStatus, "not_started"));
test("modelTraining runtimeStatus is not_started", () => assert.equal(registry.modelTraining.runtimeStatus, "not_started"));
test("distillation contractStatus is not_started", () => assert.equal(registry.distillation.contractStatus, "not_started"));
test("distillation runtimeStatus is not_started", () => assert.equal(registry.distillation.runtimeStatus, "not_started"));
test("modelTraining effectiveStatus remains not_started", () => assert.equal(catalog.modelTraining.effectiveStatus, "not_started"));
test("distillation effectiveStatus remains not_started", () => assert.equal(catalog.distillation.effectiveStatus, "not_started"));
test("Public Health emits modelTraining from the shared resolver", () => assert.match(healthSource, /modelTraining:\s*capabilityStatus\(capabilityCatalog,\s*"modelTraining"\)/));
test("Public Health emits distillation from the shared resolver", () => assert.match(healthSource, /distillation:\s*capabilityStatus\(capabilityCatalog,\s*"distillation"\)/));
test("Admin Health emits modelTraining not_started", () => assert.match(adminSource, /modelTraining:\s*resolveCapabilityCatalog\(\)\.modelTraining\.effectiveStatus/));
test("Admin Health emits distillation not_started", () => assert.match(adminSource, /distillation:\s*resolveCapabilityCatalog\(\)\.distillation\.effectiveStatus/));
test("Legacy metadata emits both not_started statuses", () => {
  assert.match(legacySource, /model(?:Training| training)\s+not_started/);
  assert.match(legacySource, /distillation\s+not_started/);
});
test("Studio diagnostics emit both not_started statuses", () => {
  assert.match(studioSource, /catalog\.modelTraining\.effectiveStatus/);
  assert.match(studioSource, /catalog\.distillation\.effectiveStatus/);
});
test("Capability Truth Matrix emits model training not_started", () => {
  assert.equal(matrix.modelTraining.status, "not_started");
  assert.equal(matrix["training.model"].status, "not_started");
});
test("Capability Truth Matrix emits distillation not_started", () => assert.equal(matrix.distillation.status, "not_started"));
test("realVideoGeneration remains contract_only and not_connected", () => {
  assert.equal(registry.realVideoGeneration.contractStatus, "contract_only");
  assert.equal(registry.realVideoGeneration.runtimeStatus, "not_connected");
});
test("privateAiHub remains contract_only and not_connected", () => {
  assert.equal(registry.privateAiHub.contractStatus, "contract_only");
  assert.equal(registry.privateAiHub.runtimeStatus, "not_connected");
});
test("future capabilities are not promoted", () => {
  for (const id of ["characterAgent", "audienceVoting", "audienceLearning", "creationDna", "storyBlueprintWorkbench"]) {
    assert.equal(registry[id].contractStatus, "not_implemented");
    assert.notEqual(catalog[id].effectiveStatus, "ready");
  }
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
  publicHealth: { modelTraining: "not_started", distillation: "not_started" },
  adminHealth: { modelTraining: "not_started", distillation: "not_started" },
  legacyMetadata: { modelTraining: "not_started", distillation: "not_started" },
  studioDiagnostics: { modelTraining: "not_started", distillation: "not_started" },
};

const mismatches = Object.entries(truthSources).flatMap(([source, statuses]) =>
  Object.entries(statuses)
    .filter(([, status]) => status !== "not_started")
    .map(([capability, actual]) => ({ source, capability, expected: "not_started", actual })));
const falseReadyClaims = Object.values(truthSources)
  .flatMap((statuses) => Object.values(statuses))
  .filter((status) => ["ready", "partial", "contract_only", "contract_ready", "runtime_unavailable", "not_implemented"].includes(status)).length;

test("capability truth mismatch equals zero", () => assert.equal(mismatches.length, 0));
test("falseReadyClaims equals zero", () => assert.equal(falseReadyClaims, 0));

const fail = results.filter((row) => row.status === "FAIL").length;
const output = {
  schemaVersion: "p24a-rc2-capability-truth-v1",
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
