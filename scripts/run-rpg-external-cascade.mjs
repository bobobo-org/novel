import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import { rpgLogicalTurnGenerationTaskId } from "../lib/novel-ai/conversation/rpg-logical-turn.ts";
import { getStudioClosedAgentOS } from "../lib/novel-ai/web/closed-agent-os-service.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import {
  approveRpgChatTurn,
  buildDeterministicRpgChatTurnCandidate,
  generateRpgChatTurnCandidate,
  loadRpgChatSnapshot,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import { generateRpgChatTurnCandidateWithExternalCascade } from "../lib/novel-ai/web/rpg-external-cascade.ts";
import {
  verifyExternalRpgExecutionReceipt,
  verifyExternalRpgFailureLineage,
} from "../lib/novel-ai/web/rpg-external-receipt.ts";
import {
  RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
  createRpgAdultRuntimeClosedResult,
  createRpgAdultRuntimeProductionFixture,
} from "./fixtures/rpg-adult-runtime-production-fixture.mjs";

const CLOSED_MODEL_DIGEST = "c".repeat(64);

class FixedClosedRpgBackend {
  constructor(story) {
    this.id = "local-ollama";
    this.story = story;
  }

  async snapshot() {
    return {
      id: this.id,
      label: "External cascade closed-success fixture",
      status: "ready",
      runtimeTruth: {
        installed: true,
        configured: true,
        reachable: true,
        modelAvailable: true,
        runtimeVerified: true,
        generationVerified: true,
        verificationSource: "local-bridge-generation",
        verifiedAt: "2026-08-30T00:00:00.000Z",
      },
      modelId: "external-cascade-closed-model",
      modelDigest: CLOSED_MODEL_DIGEST,
      local: true,
      dataBoundary: "device",
      maximumComplexity: "standard",
      capabilities: ["text"],
      supportedTaskTypes: "all",
      detailCode: "model_inference_verified",
    };
  }

  async execute(input) {
    return {
      backendId: this.id,
      modelId: "external-cascade-closed-model",
      modelDigest: CLOSED_MODEL_DIGEST,
      content: this.story,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 9,
      profileId: "rpg-external-cascade-closed-success-v1",
      firstTokenMs: 1,
      inputCharacters: input.request.objective.length,
      outputCharacters: this.story.length,
      generatedTokenEvents: Math.max(12, Math.ceil(this.story.length / 16)),
      omittedInputCharacters: 0,
      qualityMode: "fast",
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    };
  }
}

function closedNamespace(projectId) {
  return {
    tenantId: "local-tenant",
    userId: "local-author",
    projectId,
    storyId: projectId,
    canonId: `canon:${projectId}`,
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "unrouted:runtime-managed",
    modelDigest: "unrouted:digest-runtime-managed",
    promptProfileVersion: "rpg-external-cascade-closed-success-v1",
    storyBibleRevision: "current",
    knowledgeScopeRevision: "current",
    privacyLevel: "device_only",
  };
}

async function createExternalRpgScenario(label) {
  const repository = new MemoryNovelRepository();
  const draft = createDraft("quick");
  draft.title = `外來 AI 雨港接力 ${label}`;
  draft.genrePackId = "pack-6";
  draft.genreId = "classic-topic-009";
  draft.protagonist = optionalValue("林澄", "user_defined");
  draft.coreIdea = optionalValue("林澄必須在港口封鎖前救出證人並承擔藏身處曝光的代價。", "user_defined");
  draft.answers.playMode = optionalValue("rpg", "user_defined");
  const stageMatrix = buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: draft.genreId,
    playMode: "rpg",
  });
  draft.answers.stageFamily = optionalValue(
    serializeTopicWorldFamilyDraftSelection({
      matrix: stageMatrix,
      familyId: stageMatrix.stageFamilies[0].familyId,
    }),
    "user_defined",
  );
  const bundle = buildProjectBundle(draft);
  await repository.createProject(bundle, `create:external-rpg-cascade:${label}`);
  const chapter = await repository.put("chapters", {
    ...makeRecord(bundle.project.id),
    title: "封港前的雨聲",
    order: 1,
    content: "暴雨壓住港區鐘聲，林澄把最後一張通行證推到桌心。失蹤證人就在封鎖線另一端，守門人已經開始逐戶核對名冊。同行者伸手按住通行證，提醒他這次若暴露藏身處，往後就再沒有安全退路。",
    summary: "封港前必須救出證人。",
    status: "draft",
  });
  await repository.put("projects", { ...bundle.project, activeChapterId: chapter.id }, bundle.project.revision);
  const snapshot = await loadRpgChatSnapshot(repository, bundle.project.id);
  const choice = snapshot.baseChoices[0];
  assert.ok(choice);
  // Each generated project has its own procedural stage matrix, choice effect,
  // context revision and active-cast binding. Reusing prose from another
  // project would make this approval fixture violate the production
  // continuity/outcome gate and silently test the closed fallback instead.
  const deterministic = await buildDeterministicRpgChatTurnCandidate({ snapshot, choice });
  return { repository, snapshot, choice, deterministic };
}

const { snapshot, choice, deterministic } = await createExternalRpgScenario("cascade");

const newIntent = (providerId = "openai") => {
  const now = Date.now();
  return {
    intentId: `external-rpg-intent:${crypto.randomUUID()}`,
    providerId,
    grantedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 120_000).toISOString(),
  };
};
const resultFor = (requestId, text = deterministic.story) => ({
  requestId,
  providerId: "openai",
  modelId: "test-external-model",
  text,
  candidateOnly: true,
  dataLeavesDevice: true,
  externalRequest: true,
  serverStoredByApplication: false,
  elapsedMs: 37,
  generatedTokenEvents: 11,
  usage: { inputTokens: 321, outputTokens: 876, totalTokens: 1_197 },
});

let externalCalls = 0;
let closedCalls = 0;
const closedInvoker = async (input) => {
  closedCalls += 1;
  return buildDeterministicRpgChatTurnCandidate({ snapshot: input.snapshot, choice: input.choice });
};
const success = await generateRpgChatTurnCandidateWithExternalCascade({
  snapshot,
  choice,
  logicalTurnId: "external-rpg-logical-success",
  providerId: "openai",
  executionMode: "external-only",
  consentIntent: newIntent(),
  publicExecutionEnabled: true,
  providerConfigured: true,
  externalInvoker: async (request) => {
    externalCalls += 1;
    assert.equal(request.operation, "rpg-turn");
    assert.equal(request.systemInstruction, undefined);
    assert.ok(request.rpgPublicPayload);
    assert.equal("privateSecrets" in request.rpgPublicPayload, false);
    return resultFor(request.requestId);
  },
  closedInvoker,
});
assert.equal(externalCalls, 1);
assert.equal(closedCalls, 0, "external success must not call closed AI");
assert.equal(success.externalRequest, true);
assert.equal(success.dataLeftDevice, true);
assert.equal((await verifyExternalRpgExecutionReceipt(success)).providerId, "openai");

const failed = await generateRpgChatTurnCandidateWithExternalCascade({
  snapshot,
  choice,
  logicalTurnId: "external-rpg-logical-provider-failure",
  providerId: "openai",
  executionMode: "external-only",
  consentIntent: newIntent(),
  publicExecutionEnabled: true,
  providerConfigured: true,
  externalInvoker: async () => {
    externalCalls += 1;
    throw Object.assign(new Error("provider unavailable"), { code: "EXTERNAL_PROVIDER_UNAVAILABLE" });
  },
  closedInvoker,
});
assert.equal(failed.externalRequest, false);
assert.equal(failed.dataLeftDevice, false);
assert.equal(failed.executionReceipt.externalAttemptFailure.dispatchState, "provider-request-failed");
assert.equal(failed.executionReceipt.externalAttemptFailure.dataLeftDevice, true);
assert.equal(failed.executionReceipt.externalAttemptFailure.failureCode, "EXTERNAL_PROVIDER_UNAVAILABLE");
assert.equal((await verifyExternalRpgFailureLineage(failed)).failureCode, "EXTERNAL_PROVIDER_UNAVAILABLE");

const invalid = await generateRpgChatTurnCandidateWithExternalCascade({
  snapshot,
  choice,
  logicalTurnId: "external-rpg-logical-invalid-result",
  providerId: "openai",
  executionMode: "external-only",
  consentIntent: newIntent(),
  publicExecutionEnabled: true,
  providerConfigured: true,
  externalInvoker: async (request) => {
    externalCalls += 1;
    return resultFor(request.requestId, "空白回答");
  },
  closedInvoker,
});
assert.equal(invalid.executionReceipt.externalAttemptFailure.dispatchState, "provider-result-invalid");
assert.equal(invalid.executionReceipt.externalAttemptFailure.dataLeftDevice, true);
assert.equal((await verifyExternalRpgFailureLineage(invalid)).dispatchState, "provider-result-invalid");

const callsBeforePreflight = externalCalls;
const unavailable = await generateRpgChatTurnCandidateWithExternalCascade({
  snapshot,
  choice,
  logicalTurnId: "external-rpg-logical-preflight",
  providerId: "openai",
  executionMode: "external-only",
  consentIntent: newIntent(),
  publicExecutionEnabled: true,
  providerConfigured: false,
  externalInvoker: async () => {
    externalCalls += 1;
    throw new Error("must not run");
  },
  closedInvoker,
});
assert.equal(externalCalls, callsBeforePreflight);
assert.equal(unavailable.executionReceipt.externalAttemptFailure.dispatchState, "preflight-unavailable");
assert.equal(unavailable.executionReceipt.externalAttemptFailure.dataLeftDevice, false);
assert.equal((await verifyExternalRpgFailureLineage(unavailable)).dispatchState, "preflight-unavailable");

const callsBeforeAdult = externalCalls;
const adultFixture = createRpgAdultRuntimeProductionFixture();
let adultClosedCalls = 0;
const adultLocal = await generateRpgChatTurnCandidateWithExternalCascade({
  snapshot: adultFixture.snapshot,
  choice: adultFixture.choice,
  logicalTurnId: RPG_ADULT_RUNTIME_LOGICAL_TURN_ID,
  providerId: "openai",
  executionMode: "external-only",
  consentIntent: null,
  publicExecutionEnabled: true,
  providerConfigured: true,
  adultNarrativeRuntime: adultFixture.adultNarrativeRuntime,
  adultNarrativeRuntimeClock: () => new Date("2026-08-30T06:00:00.000Z"),
  externalInvoker: async () => {
    externalCalls += 1;
    throw new Error("adult mode must not egress");
  },
  closedInvoker: async (closedInput) => {
    adultClosedCalls += 1;
    return generateRpgChatTurnCandidate({
      ...closedInput,
      generationDeadlineMs: 100,
      coordinationDependencies: {
        probeAvailability: async () => "ready",
      },
      closedAIInvoker: async (request) =>
        createRpgAdultRuntimeClosedResult(request, adultFixture),
    });
  },
});
assert.equal(externalCalls, callsBeforeAdult);
assert.equal(adultClosedCalls, 1);
assert.equal(adultLocal.executionReceipt.externalAttemptFailure.attempted, false);
assert.equal(adultLocal.executionReceipt.externalAttemptFailure.dispatchState, "policy-blocked");
assert.equal(adultLocal.executionReceipt.externalAttemptFailure.failureCode, "EXTERNAL_RPG_ADULT_CONTENT_LOCAL_ONLY");
assert.equal(adultLocal.executionReceipt.externalAttemptFailure.dataLeftDevice, false);

const closedBeforeCancel = closedCalls;
await assert.rejects(
  generateRpgChatTurnCandidateWithExternalCascade({
    snapshot,
    choice,
    logicalTurnId: "external-rpg-logical-cancelled",
    providerId: "openai",
    executionMode: "external-only",
    consentIntent: newIntent(),
    publicExecutionEnabled: true,
    providerConfigured: true,
    externalInvoker: async () => {
      throw Object.assign(new Error("cancelled"), { code: "EXTERNAL_AI_CANCELLED" });
    },
    closedInvoker,
  }),
  (error) => error?.code === "EXTERNAL_AI_CANCELLED",
);
assert.equal(closedCalls, closedBeforeCancel, "user cancellation must never enter closed fallback");

await assert.rejects(
  generateRpgChatTurnCandidateWithExternalCascade({
    snapshot,
    choice,
    logicalTurnId: "external-rpg-logical-no-consent",
    providerId: "openai",
    executionMode: "external-only",
    consentIntent: null,
    publicExecutionEnabled: true,
    providerConfigured: true,
    externalInvoker: async () => resultFor("never"),
    closedInvoker,
  }),
  (error) => error?.code === "CONVERSATION_EXTERNAL_SINGLE_RUN_CONSENT_REQUIRED",
);

async function externalCandidateForApproval(scenario, logicalTurnId) {
  let closedAgentCandidateCalls = 0;
  const candidate = await generateRpgChatTurnCandidateWithExternalCascade({
    snapshot: scenario.snapshot,
    choice: scenario.choice,
    logicalTurnId,
    providerId: "openai",
    executionMode: "external-only",
    consentIntent: newIntent(),
    publicExecutionEnabled: true,
    providerConfigured: true,
    externalInvoker: async (request) => resultFor(request.requestId, scenario.deterministic.story),
    closedInvoker: async () => {
      closedAgentCandidateCalls += 1;
      throw new Error("external approval fixture must never generate a closed candidate");
    },
  });
  return { candidate, closedAgentCandidateCalls };
}

async function assertNoApprovalWrites(scenario, label) {
  const [candidates, acceptedChoices, turnReceipts] = await Promise.all([
    scenario.repository.list("candidates", scenario.snapshot.project.id),
    scenario.repository.listAcceptedChoices(scenario.snapshot.project.id),
    scenario.repository.list("rpgTurnReceipts", scenario.snapshot.project.id),
  ]);
  assert.equal(candidates.length, 0, `${label}: rejected candidate was persisted before verification`);
  assert.equal(acceptedChoices.length, 0, `${label}: rejected candidate reached Canon`);
  assert.equal(turnReceipts.length, 0, `${label}: rejected candidate wrote an RPG turn receipt`);
}

async function assertExternalApprovalTamperRejected(label, mutateCandidate, expectedCode) {
  const scenario = await createExternalRpgScenario(`tamper-${label}`);
  const generated = await externalCandidateForApproval(scenario, `external-rpg-approval-tamper-${label}`);
  assert.equal(generated.closedAgentCandidateCalls, 0);
  const candidate = structuredClone(generated.candidate);
  mutateCandidate(candidate);
  await assert.rejects(
    approveRpgChatTurn({
      repository: scenario.repository,
      snapshot: scenario.snapshot,
      candidate,
    }),
    (error) => (Array.isArray(expectedCode) ? expectedCode : [expectedCode]).includes(error?.code),
    `${label} tamper must fail with ${(Array.isArray(expectedCode) ? expectedCode : [expectedCode]).join(" or ")}`,
  );
  await assertNoApprovalWrites(scenario, label);
}

await assertExternalApprovalTamperRejected("receipt", (candidate) => {
  const digestTail = candidate.executionReceipt.receiptDigest.at(-1);
  candidate.executionReceipt.receiptDigest = `${candidate.executionReceipt.receiptDigest.slice(0, -1)}${digestTail === "0" ? "1" : "0"}`;
}, "EXTERNAL_RPG_RECEIPT_INVALID");
await assertExternalApprovalTamperRejected("locked-outcome", (candidate) => {
  candidate.resolution.outcome = candidate.resolution.outcome === "failure" ? "success" : "failure";
}, "EXTERNAL_RPG_RECEIPT_INVALID");
await assertExternalApprovalTamperRejected("context", (candidate) => {
  const digestTail = candidate.contextDigest.at(-1);
  candidate.contextDigest = `${candidate.contextDigest.slice(0, -1)}${digestTail === "0" ? "1" : "0"}`;
}, "EXTERNAL_RPG_RECEIPT_INVALID");

const approvalScenario = await createExternalRpgScenario("approval-success");
const generatedForApproval = await externalCandidateForApproval(
  approvalScenario,
  "external-rpg-approval-success",
);
assert.equal(generatedForApproval.closedAgentCandidateCalls, 0, "external success must not invoke closed generation");
const approvedExternal = await approveRpgChatTurn({
  repository: approvalScenario.repository,
  snapshot: approvalScenario.snapshot,
  candidate: generatedForApproval.candidate,
});
assert.equal(approvedExternal.approved.canonicalMutationCount, 1);
assert.equal(approvedExternal.approved.actualExecutor, "external:openai");
const [externalStoredCandidates, externalAcceptedChoices, externalTurnReceipts] = await Promise.all([
  approvalScenario.repository.list("candidates", approvalScenario.snapshot.project.id),
  approvalScenario.repository.listAcceptedChoices(approvalScenario.snapshot.project.id),
  approvalScenario.repository.list("rpgTurnReceipts", approvalScenario.snapshot.project.id),
]);
assert.equal(externalStoredCandidates.length, 1);
assert.equal(externalStoredCandidates[0].status, "accepted");
assert.equal(externalStoredCandidates[0].provenance.externalRequest, true);
assert.equal(externalStoredCandidates[0].provenance.dataLeftDevice, true);
assert.equal(externalAcceptedChoices.length, 1, "external approval must create exactly one accepted Canon choice");
assert.equal(externalAcceptedChoices[0].provenance.externalRequest, true);
assert.equal(externalAcceptedChoices[0].provenance.dataLeftDevice, true);
assert.equal(externalTurnReceipts.length, 1, "external approval must create exactly one RPG receipt");
await assert.rejects(
  approveRpgChatTurn({
    repository: approvalScenario.repository,
    snapshot: approvalScenario.snapshot,
    candidate: generatedForApproval.candidate,
  }),
  (error) => error?.code === "RPG_CHAT_TURN_SOURCE_STALE",
  "the same external candidate must not create a second Canon commit",
);
assert.equal((await approvalScenario.repository.listAcceptedChoices(approvalScenario.snapshot.project.id)).length, 1);

const lineageTamperScenario = await createExternalRpgScenario("failure-lineage-tamper");
const lineageTamperCandidate = await generateRpgChatTurnCandidateWithExternalCascade({
  snapshot: lineageTamperScenario.snapshot,
  choice: lineageTamperScenario.choice,
  logicalTurnId: "external-rpg-failure-lineage-tamper",
  providerId: "openai",
  executionMode: "external-only",
  consentIntent: newIntent(),
  publicExecutionEnabled: true,
  providerConfigured: true,
  externalInvoker: async () => {
    throw Object.assign(new Error("provider unavailable"), { code: "EXTERNAL_PROVIDER_UNAVAILABLE" });
  },
  closedInvoker: async (input) => buildDeterministicRpgChatTurnCandidate({
    snapshot: input.snapshot,
    choice: input.choice,
  }),
});
lineageTamperCandidate.executionReceipt.externalAttemptFailure.failureCode = "TAMPERED_FAILURE";
await assert.rejects(
  approveRpgChatTurn({
    repository: lineageTamperScenario.repository,
    snapshot: lineageTamperScenario.snapshot,
    candidate: lineageTamperCandidate,
  }),
  (error) => error?.code === "EXTERNAL_RPG_RECEIPT_INVALID",
);
await assertNoApprovalWrites(lineageTamperScenario, "failure-lineage");

const lineageApprovalScenario = await createExternalRpgScenario("failure-lineage-approval");
const closedAfterFailureLogicalTurnId = "external-rpg-failure-lineage-approval";
const closedAgentOS = getStudioClosedAgentOS();
closedAgentOS.backends = new Map([
  ["local-ollama", new FixedClosedRpgBackend(
    lineageApprovalScenario.deterministic.story.normalize("NFKC"),
  )],
]);
const closedExecution = await closedAgentOS.execute({
  taskId: await rpgLogicalTurnGenerationTaskId(closedAfterFailureLogicalTurnId, 1),
  namespace: closedNamespace(lineageApprovalScenario.snapshot.project.id),
  taskType: "chapter.continue",
  objective: "外來供應商失敗後，由閉端模型依照既定 RPG 結果續寫完整小說回合。",
  context: [],
  complexity: "standard",
  qualityMode: "fast",
  preferredBackend: "local-ollama",
  allowedToolIds: [],
  permissionScopes: [
    "story:read",
    "story-bible:read",
    "candidate:write",
    "candidate:read",
    "evaluation:write",
  ],
  sourceChapterId: lineageApprovalScenario.snapshot.chapter.id,
  sourceRevision: lineageApprovalScenario.snapshot.chapter.revision,
});
assert.equal(closedExecution.candidate.status, "awaiting-approval");
const normalizedClosedStoryDigest = [...new Uint8Array(await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode(closedExecution.candidate.content.normalize("NFKC")),
))].map((value) => value.toString(16).padStart(2, "0")).join("");
assert.equal(
  closedExecution.candidate.contentDigest,
  normalizedClosedStoryDigest,
  "closed candidate content identity must match the RPG normalized-story identity",
);
const closedModelCandidate = {
  ...lineageApprovalScenario.deterministic,
  taskId: closedExecution.candidate.taskId,
  candidateId: closedExecution.candidate.id,
  candidateDigest: closedExecution.candidate.contentDigest,
  model: closedExecution.candidate.modelId,
  modelDigest: closedExecution.candidate.modelDigest,
  actualExecutor: closedExecution.candidate.actualExecutor,
  executionReceipt: {
    ...closedExecution.candidate.executionReceipt,
    rpgContextDigest: lineageApprovalScenario.snapshot.contextDigest,
    rpgContextRevisionDigest: lineageApprovalScenario.snapshot.contextRevisionDigest,
  },
  story: closedExecution.candidate.content,
  dataLeftDevice: false,
  externalRequest: false,
};
const closedAfterExternalFailure = await generateRpgChatTurnCandidateWithExternalCascade({
  snapshot: lineageApprovalScenario.snapshot,
  choice: lineageApprovalScenario.choice,
  logicalTurnId: closedAfterFailureLogicalTurnId,
  providerId: "openai",
  executionMode: "external-only",
  consentIntent: newIntent(),
  publicExecutionEnabled: true,
  providerConfigured: true,
  externalInvoker: async () => {
    throw Object.assign(new Error("provider unavailable"), { code: "EXTERNAL_PROVIDER_UNAVAILABLE" });
  },
  closedInvoker: async () => structuredClone(closedModelCandidate),
});
const verifiedFailureLineage = await verifyExternalRpgFailureLineage(closedAfterExternalFailure);
assert.equal(verifiedFailureLineage.failureCode, "EXTERNAL_PROVIDER_UNAVAILABLE");
assert.equal(
  verifiedFailureLineage.dataLeftDevice,
  true,
  "the external provider was dispatched before the closed/local candidate succeeded",
);
assert.equal(closedAfterExternalFailure.externalRequest, false);
assert.equal(closedAfterExternalFailure.dataLeftDevice, false);
assert.equal(
  closedAfterExternalFailure.actualExecutor.startsWith("external:"),
  false,
  "the final candidate executor must remain the closed executor",
);
assert.equal(closedAfterExternalFailure.actualExecutor, "local-ollama");
const approvedClosedAfterFailure = await approveRpgChatTurn({
  repository: lineageApprovalScenario.repository,
  snapshot: lineageApprovalScenario.snapshot,
  candidate: closedAfterExternalFailure,
});
assert.equal(approvedClosedAfterFailure.approved.canonicalMutationCount, 1);
const closedAfterFailureAccepted = await lineageApprovalScenario.repository.listAcceptedChoices(
  lineageApprovalScenario.snapshot.project.id,
);
assert.equal(closedAfterFailureAccepted.length, 1);
assert.equal(closedAfterFailureAccepted[0].provenance.externalRequest, false);
assert.equal(closedAfterFailureAccepted[0].provenance.dataLeftDevice, false);

// A provider dispatch is an irreversible privacy event even when its output is
// discarded and a closed/local executor produces the final candidate. The
// final executor and aggregate egress truth are two different facts. Keep this
// focused diagnostic test source-only until the hook exposes a callable pure
// projection helper; the cascade and Canon assertions above are real runtime
// records, while these checks bind the exact production completion block.
const rpgHookSource = await readFile(new URL(
  "../app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts",
  import.meta.url,
), "utf8");
const invocationCompletionStart = rpgHookSource.indexOf("if (!invocationCompleted) {");
const invocationCompletionEnd = rpgHookSource.indexOf(
  "invocationCompleted = true;",
  invocationCompletionStart,
);
assert.ok(invocationCompletionStart >= 0 && invocationCompletionEnd > invocationCompletionStart);
const invocationCompletionBlock = rpgHookSource.slice(
  invocationCompletionStart,
  invocationCompletionEnd,
);
const privacyTruthFailures = [];
if (
  !invocationCompletionBlock.includes("externalRequest: executionTruth.externalRequest")
  || !invocationCompletionBlock.includes("dataLeftDevice: executionTruth.dataLeftDevice")
) {
  privacyTruthFailures.push({
    code: "CONVERSATION_INVOCATION_EXTERNAL_ATTEMPT_NOT_AGGREGATED",
    expected: { externalRequest: true, dataLeftDevice: true },
    finalCandidate: {
      actualExecutor: closedAfterExternalFailure.actualExecutor,
      externalRequest: closedAfterExternalFailure.externalRequest,
      dataLeftDevice: closedAfterExternalFailure.dataLeftDevice,
    },
    externalAttempt: verifiedFailureLineage,
  });
}
if (!invocationCompletionBlock.includes("externalAttempt: executionTruth.externalAttempt")) {
  privacyTruthFailures.push({
    code: "CONVERSATION_EXECUTION_RECEIPT_EGRESS_FALSE_AFTER_DISPATCH",
    expected: { externalRequest: true, dataLeftDevice: true },
    reason: "provider-request-failed after dispatch",
  });
}
const acceptedFailureProvenance = closedAfterFailureAccepted[0].provenance;
const canonicalExternalAttempt = acceptedFailureProvenance.externalAttempt;
if (!canonicalExternalAttempt || typeof canonicalExternalAttempt !== "object") {
  privacyTruthFailures.push({
    code: "CANONICAL_PROVENANCE_EXTERNAL_ATTEMPT_MISSING",
    expected: {
      providerId: verifiedFailureLineage.providerId,
      dispatchState: verifiedFailureLineage.dispatchState,
      dataLeftDevice: true,
      failureCode: verifiedFailureLineage.failureCode,
    },
    actualFinalProvenance: acceptedFailureProvenance,
  });
} else {
  assert.equal(canonicalExternalAttempt.providerId, verifiedFailureLineage.providerId);
  assert.equal(canonicalExternalAttempt.dispatchState, verifiedFailureLineage.dispatchState);
  assert.equal(canonicalExternalAttempt.dataLeftDevice, true);
  assert.equal(canonicalExternalAttempt.failureCode, verifiedFailureLineage.failureCode);
}
assert.notEqual(
  acceptedFailureProvenance.providerId,
  `external:${verifiedFailureLineage.providerId}`,
  "a failed external attempt must not relabel the final canonical executor as external",
);
assert.deepEqual(
  privacyTruthFailures,
  [],
  "dispatched external failure must remain visible without relabelling the final closed/local executor",
);

// This case intentionally runs after the valid approval paths: a story whose
// sealed digest no longer matches must be rejected before even a pending
// ChoiceCandidate is written.
await assertExternalApprovalTamperRejected("story", (candidate) => {
  candidate.story = `${candidate.story}\n\n林澄推開門，把新發現的封泥交給證人核對。`;
}, ["RPG_CHAT_RESULT_IDENTITY_MISMATCH", "RPG_NOVEL_CONTINUITY_GATE_FAILED"]);

console.log(JSON.stringify({
  status: "PASS",
  externalSuccessSkipsClosed: true,
  externalFailureStartsClosed: true,
  invalidResultLineage: "provider-result-invalid",
  unavailablePreflightDataLeftDevice: false,
  adultModeLocalOnly: true,
  cancellationDoesNotFallback: true,
  missingConsentFailsClosed: true,
  externalApprovalCanonicalCommits: externalAcceptedChoices.length,
  externalApprovalProvenance: {
    externalRequest: externalAcceptedChoices[0].provenance.externalRequest,
    dataLeftDevice: externalAcceptedChoices[0].provenance.dataLeftDevice,
  },
  externalApprovalTamperCases: ["receipt", "story", "locked-outcome", "context"],
  closedFallbackFailureLineageApproved: verifiedFailureLineage.failureCode,
  dispatchedFailureThenClosedSuccess: {
    finalExecutor: closedAfterExternalFailure.actualExecutor,
    candidateSourceExternal: closedAfterExternalFailure.externalRequest,
    externalAttemptDataLeftDevice: verifiedFailureLineage.dataLeftDevice,
    conversationInvocationAggregateEgress: true,
    canonicalFinalProvider: acceptedFailureProvenance.providerId,
    canonicalExternalAttempt,
  },
  externalCalls,
  closedCalls,
}, null, 2));
