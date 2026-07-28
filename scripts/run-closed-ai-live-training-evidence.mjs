import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  BROWSER_EXTRACTIVE_MODEL,
  runPackagedBrowserExtractiveModel,
} from "../lib/novel-ai/providers/browser-ai/browser-extractive-model.ts";
import { CAPABILITY_TRUTH_MATRIX } from "../lib/novel-ai/capabilities/capability-truth-matrix.ts";

const evidencePath = "docs/evidence/closed-ai-live-training-v1.json";
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const trainingSource = fs.readFileSync("local-ai/training/live_training.py", "utf8");
const results = [];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function test(name, check) {
  try {
    check();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

test("sealed evidence digest verifies", () => {
  const { sealedEvidenceDigest, ...payload } = evidence;
  assert.match(sealedEvidenceDigest, /^[0-9a-f]{64}$/);
  assert.equal(digest(payload), sealedEvidenceDigest);
});

test("training and distillation truth are started", () => {
  assert.equal(evidence.capabilityTruth.modelTraining, "started");
  assert.equal(evidence.capabilityTruth.distillation, "started");
  assert.equal(evidence.capabilityTruth.fullWeightTraining, "verified_smoke");
});

test("full-weight optimizer step changed parameters without promotion", () => {
  const proof = evidence.fullWeightEvidence;
  assert.ok(proof.optimizerSteps >= 1);
  assert.equal(proof.weightsChanged, true);
  assert.notEqual(proof.initialWeightDigest, proof.finalWeightDigest);
  assert.equal(proof.checkpointPersisted, false);
  assert.equal(evidence.capabilityTruth.automaticActivation, false);
  assert.equal(evidence.capabilityTruth.automaticPromotion, false);
});

test("LoRA candidate changed parameters and passed inference", () => {
  const proof = evidence.loraEvidence;
  assert.ok(proof.optimizerSteps >= 1);
  assert.ok(proof.trainableParameters > 0);
  assert.equal(proof.weightsChanged, true);
  assert.notEqual(proof.initialTrainableDigest, proof.finalTrainableDigest);
  assert.match(proof.adapterDigest, /^[0-9a-f]{64}$/);
  assert.equal(proof.inferenceProof.state, "inference_verified");
  assert.equal(proof.activationRequired, true);
});

test("QLoRA remains honestly hardware blocked", () => {
  assert.equal(evidence.hardware.cudaAvailable, false);
  assert.equal(evidence.hardware.qloraEligible, false);
  assert.equal(evidence.capabilityTruth.qlora, "hardware_blocked_no_cuda");
});

test("distillation uses only sealed synthetic local demonstrations", () => {
  const proof = evidence.distillationEvidence;
  assert.equal(proof.method, "sequence_level_knowledge_distillation");
  assert.ok(proof.sampleCount > 0);
  assert.match(proof.datasetDigest, /^[0-9a-f]{64}$/);
  assert.equal(proof.syntheticDataOnly, true);
  assert.equal(proof.rawUserContentIncluded, false);
  assert.equal(proof.externalPromptRequest, false);
  assert.equal(proof.dataLeftDevice, false);
});

test("teacher and student identities are immutable", () => {
  assert.match(evidence.teacher.modelDigest, /^[0-9a-f]{64}$/);
  assert.match(evidence.teacher.licenseDigest, /^[0-9a-f]{64}$/);
  assert.equal(evidence.teacher.distillationPermitted, true);
  assert.equal(evidence.teacher.licensePolicy, "noncommercial_research_candidate_only");
  assert.equal(evidence.teacher.commercialUsePermitted, false);
  assert.equal(evidence.teacher.distributionRequiresSeparateReview, true);
  assert.match(evidence.student.modelCommit, /^[0-9a-f]{40}$/);
  assert.ok(evidence.student.parameterCount > 100_000_000);
});

test("packaged Browser AI matches its trained artifact and runs", () => {
  assert.equal(evidence.browserAI.modelId, BROWSER_EXTRACTIVE_MODEL.modelId);
  assert.equal(evidence.browserAI.modelDigest, BROWSER_EXTRACTIVE_MODEL.modelDigest);
  assert.equal(
    evidence.browserAI.trainingDatasetDigest,
    BROWSER_EXTRACTIVE_MODEL.trainingDatasetDigest,
  );
  assert.equal(BROWSER_EXTRACTIVE_MODEL.holdoutTop1Accuracy, 1);
  const result = runPackagedBrowserExtractiveModel(
    "林昭進入圖書館。她發現帳冊失蹤，並在窗邊找到濕泥腳印。守門人聲稱沒有人進出。",
  );
  assert.equal(result.content, "她發現帳冊失蹤，並在窗邊找到濕泥腳印。");
  assert.equal(result.externalRequest, false);
  assert.equal(result.dataLeftDevice, false);
});

test("Local Bridge and Private Hub contain real inference proofs", () => {
  for (const runtime of [
    evidence.localRuntimeEvidence.localBridge,
    evidence.localRuntimeEvidence.privateHub,
  ]) {
    assert.equal(runtime.pairingState, "paired");
    assert.equal(runtime.runtimeReady, true);
    assert.equal(runtime.proofState, "inference_verified");
    assert.match(runtime.modelDigest, /^[0-9a-f]{64}$/);
    assert.match(runtime.outputDigest, /^[0-9a-f]{64}$/);
    assert.ok(runtime.outputBytes > 0);
    assert.ok(runtime.evalCount > 0);
    assert.equal(runtime.externalRequest, false);
    assert.equal(runtime.dataLeftDevice, false);
  }
});

test("training loader is fail-closed and supply-chain constrained", () => {
  assert.match(trainingSource, /trust_remote_code=False/);
  assert.match(trainingSource, /use_safetensors=True/);
  assert.match(trainingSource, /HF_HUB_DISABLE_TELEMETRY/);
  assert.match(trainingSource, /DISTILLATION_TEACHER_LICENSE_UNVERIFIED/);
  assert.match(trainingSource, /adapterActivationRequiresSeparateApproval/);
  assert.doesNotMatch(trainingSource, /trust_remote_code=True/);
});

test("capability matrix preserves candidate and hardware boundaries", () => {
  const matrix = Object.fromEntries(
    CAPABILITY_TRUTH_MATRIX.map((record) => [record.id, record.status]),
  );
  assert.equal(matrix.modelTraining, "started");
  assert.equal(matrix.distillation, "started");
  assert.equal(matrix["training.lora"], "verified");
  assert.equal(matrix["training.qlora"], "blocked");
});

test("sealed evidence contains no credentials or private content", () => {
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /vcp_[A-Za-z0-9]+|sbp_[A-Za-z0-9]+/);
  assert.doesNotMatch(serialized, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
  assert.equal(evidence.privacy.rawUserContentIncluded, false);
  assert.equal(evidence.privacy.credentialsIncluded, false);
  assert.equal(evidence.privacy.rawChainOfThoughtIncluded, false);
  assert.equal(evidence.privacy.crossUserDataIncluded, false);
});

const fail = results.filter((result) => result.status === "FAIL").length;
const report = {
  suite: "Closed AI live model training and runtime evidence",
  schemaVersion: "closed-ai-live-training-evidence-gate-v1",
  pass: results.length - fail,
  fail,
  results,
};

console.log(JSON.stringify(report, null, 2));
if (fail) process.exitCode = 1;
