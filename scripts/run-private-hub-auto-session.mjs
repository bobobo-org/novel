import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import {
  PRIVATE_HUB_PROTOCOL,
  createPrivateHubServer,
} from "../local-ai/private-hub/server.mjs";
import {
  LearningExperienceLedger,
  stableLearningValue,
} from "../local-ai/private-hub/learning-experience-ledger.mjs";
import {
  ContinuousLearningCoordinator,
} from "../local-ai/private-hub/continuous-learning-coordinator.mjs";

const origin = "https://novel-orcin.vercel.app";
const port = 3238;
const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-private-hub-auto-"));
const hub = createPrivateHubServer({
  port,
  testMode: true,
  runtimeDir,
  pairingFile: path.join(runtimeDir, "pairing.json"),
});
const base = `http://127.0.0.1:${port}`;
const headers = (extra = {}) => ({
  Origin: origin,
  "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
  ...extra,
});
const read = async (response) => ({
  status: response.status,
  body: await response.json().catch(() => ({})),
});
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

try {
  await hub.start();
  const health = await read(await fetch(`${base}/health`, { headers: headers() }));
  assert.equal(health.status, 200);
  assert.equal(health.body.automaticSessionSupported, true);
  assert.match(health.body.hubVersion, /^1\.4\.0/u);
  assert.equal(health.body.continuousLearning.backgroundActive, true);

  const connected = await read(await fetch(`${base}/session/auto`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ intent: "closed-ai-connect" }),
  }));
  assert.equal(connected.status, 200);
  assert.equal(connected.body.automaticConnection, true);
  assert.equal(connected.body.sessionKind, "trusted_origin_auto");
  assert.equal("pairingId" in connected.body, false);
  assert.equal("code" in connected.body, false);

  const stats = await read(await fetch(`${base}/cache/stats`, {
    headers: headers({ Authorization: `Bearer ${connected.body.token}` }),
  }));
  assert.equal(stats.status, 200);
  assert.equal(stats.body.cache.encryptedAtRest, true);

  const experienceBody = {
    schemaVersion: "controlled-autonomous-practice-v1",
    projectDigest: sha256("project"),
    installationDigest: sha256("installation"),
    consentDigest: sha256("consent"),
    practiceKind: "approved-rule-sandbox-rehearsal",
    capabilityEvidenceDigest: sha256("capability"),
    approvedRuleSetDigest: sha256("rules"),
    approvedRuleCount: 4,
    selectedRuleCount: 4,
    taskCount: 5,
    treatmentRecipeCount: 15,
    completeRecipeCount: 15,
    scores: {
      control: 0,
      treatment: 92,
      capabilityDelta: 92,
      taskCoverage: 1,
      lineageCoverage: 1,
      recipeCompleteness: 1,
    },
    outcome: "practice_passed",
    recommendedNextStep: "retain_current_version",
    privacy: {
      rawPromptIncluded: false,
      rawStoryIncluded: false,
      rawOutputIncluded: false,
      rawChainOfThoughtIncluded: false,
      credentialIncluded: false,
      authorOnlyIncluded: false,
      canonicalMutationCount: 0,
      memoryMutationCount: 0,
      modelWeightMutationCount: 0,
    },
    createdAt: "2026-08-02T00:00:00.000Z",
  };
  const experience = {
    ...experienceBody,
    experienceDigest: sha256(stableLearningValue(experienceBody)),
  };
  const learningHeaders = headers({
    Authorization: `Bearer ${connected.body.token}`,
    "X-Hub-CSRF": connected.body.csrf,
    "Content-Type": "application/json",
  });
  const recorded = await read(await fetch(`${base}/learning/experiences`, {
    method: "POST",
    headers: learningHeaders,
    body: JSON.stringify(experience),
  }));
  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.durable, true);
  assert.equal(recorded.body.rawContentStored, false);
  assert.equal(recorded.body.canonicalMutationCount, 0);
  assert.equal(recorded.body.modelWeightMutationCount, 0);
  assert.equal(recorded.body.experienceDigest, experience.experienceDigest);
  assert.equal(hub.continuousLearning.stats().strategyCandidates, 1);
  assert.equal(hub.continuousLearning.stats().adoptionMode, "candidate_only");

  const deduplicated = await read(await fetch(`${base}/learning/experiences`, {
    method: "POST",
    headers: learningHeaders,
    body: JSON.stringify(experience),
  }));
  assert.equal(deduplicated.status, 200);
  assert.equal(deduplicated.body.deduplicated, true);
  assert.equal(deduplicated.body.sequence, recorded.body.sequence);

  const rawFieldRejected = await read(await fetch(`${base}/learning/experiences`, {
    method: "POST",
    headers: learningHeaders,
    body: JSON.stringify({ ...experience, rawStory: "must never be accepted" }),
  }));
  assert.equal(rawFieldRejected.status, 400);
  assert.equal(rawFieldRejected.body.errorCode, "LEARNING_EXPERIENCE_CONTRACT_INVALID");

  const reopenedLedger = new LearningExperienceLedger({
    directory: path.join(runtimeDir, "learning-experiences"),
  });
  await reopenedLedger.initialize();
  assert.equal(reopenedLedger.stats().records, 1);
  assert.equal(reopenedLedger.stats().ledgerHead, recorded.body.ledgerHead);
  const reopenedCoordinator = new ContinuousLearningCoordinator({
    experienceLedger: reopenedLedger,
    directory: path.join(runtimeDir, "continuous-learning"),
  });
  await reopenedCoordinator.initialize();
  assert.equal(reopenedCoordinator.stats().strategyCandidates, 1);
  assert.equal(reopenedCoordinator.stats().rawContentStored, false);

  const revoked = await read(await fetch(`${base}/pair/revoke`, {
    method: "POST",
    headers: headers({
      Authorization: `Bearer ${connected.body.token}`,
      "X-Hub-CSRF": connected.body.csrf,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ confirm: true }),
  }));
  assert.equal(revoked.body.state, "revoked");

  const retry = await read(await fetch(`${base}/session/auto`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ intent: "closed-ai-connect" }),
  }));
  assert.equal(retry.body.errorCode, "BRIDGE_PAIRING_REVOKED");

  const lookalike = await read(await fetch(`${base}/session/auto`, {
    method: "POST",
    headers: {
      Origin: "https://novel-orcin.vercel.app.evil.example",
      "X-Private-Hub-Protocol": PRIVATE_HUB_PROTOCOL,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ intent: "closed-ai-connect" }),
  }));
  assert.equal(lookalike.body.errorCode, "BRIDGE_ORIGIN_NOT_ALLOWED");

  process.stdout.write(`${JSON.stringify({
    suite: "private-hub-origin-auto-session",
    status: "PASS",
    passwordInputs: 0,
    pairingCodeRequests: 0,
    exactOriginEnforced: true,
    revocationEnforced: true,
    encryptedCache: true,
    autonomousLearningLedger: {
      durable: true,
      appendOnly: true,
      deduplicated: true,
      restartIntegrityVerified: true,
      rawContentStored: false,
      canonicalMutationCount: 0,
      continuousCoordinator: true,
      strategyCandidates: hub.continuousLearning.stats().strategyCandidates,
    },
  }, null, 2)}\n`);
} finally {
  await hub.stop().catch(() => undefined);
  await rm(runtimeDir, { recursive: true, force: true });
}
