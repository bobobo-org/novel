import type { PlatformAIResult, PlatformTaskType } from "../../router/platform-types";
import {
  BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
  BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY,
  BROWSER_PROSE_CANDIDATE_V2_SAFE_METRIC_SCHEMA,
  BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION,
  assertBrowserProseCandidateV2CompositionMetric,
  assertBrowserProseCandidateV2SafeMetric,
  browserProseCandidateV2Sha256,
  type BrowserProseCandidateV2CompositionMetric,
  type BrowserProseCandidateV2ExecutionMode,
  type BrowserProseCandidateV2Identity,
  type BrowserProseCandidateV2Partition,
  type BrowserProseCandidateV2SafeMetric,
  type BrowserProseCandidateV2SegmentId,
  type BrowserProseCandidateV2SegmentRequest,
} from "./browser-prose-candidate-v2";

export const BROWSER_PROSE_CANDIDATE_V2_CALL_RECEIPT_SCHEMA =
  "browser-prose-candidate-v2-segment-call-receipt-v1" as const;
export const BROWSER_PROSE_CANDIDATE_V2_ATTESTATION_SCHEMA =
  "browser-prose-candidate-v2-three-contributor-attestation-v1" as const;
export const BROWSER_PROSE_CANDIDATE_V2_RUNTIME_RECEIPT_SCHEMA =
  "browser-prose-candidate-v2-runtime-receipt-v1" as const;
export const BROWSER_PROSE_CANDIDATE_V2_QUALIFICATION_OBSERVATION_SCHEMA =
  "browser-prose-candidate-v2-qualification-observation-v1" as const;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SEGMENT_ORDER = ["action", "reaction", "consequence"] as const;
const STAGE_ORDER = [
  "segment-action",
  "segment-reaction",
  "segment-consequence",
] as const;

type BrowserProseCandidateV2QualityPhase = "draft" | "critic" | "revision";

export type BrowserProseCandidateV2SegmentCallReceipt = {
  schemaVersion: typeof BROWSER_PROSE_CANDIDATE_V2_CALL_RECEIPT_SCHEMA;
  candidateIdentity: BrowserProseCandidateV2Identity;
  outerRequestId: string;
  invocationRequestId: string;
  invocationRequestDigest: string;
  outerTaskType: PlatformTaskType;
  outerQualityPhase: BrowserProseCandidateV2QualityPhase;
  segmentId: BrowserProseCandidateV2SegmentId;
  contributorStage: (typeof STAGE_ORDER)[number];
  contributorIndex: 0 | 1 | 2;
  ordinal: 1 | 2 | 3;
  contextDigest: string;
  systemInstructionDigest: string;
  promptDigest: string;
  callOptionsDigest: string;
  responseDigest: string;
  responseCharacters: number;
  finishReason: "stop";
  completionTokens: number;
  providerId: "browser-ai";
  actualExecutor: "webllm-worker";
  candidateOnly: true;
  externalRequest: false;
  dataLeftDevice: false;
  omittedInputCharacters: 0;
  engineReused: boolean;
  retryAttempt: 0;
  monolithicGenerationAttempted: false;
  repairAttempted: false;
  extensionAttempted: false;
  recoveryAttempted: false;
  executionSource: "browser-webllm-runtime" | "test-double";
  callReceiptDigest: string;
};

export type BrowserProseCandidateV2ThreeContributorAttestation = {
  schemaVersion: typeof BROWSER_PROSE_CANDIDATE_V2_ATTESTATION_SCHEMA;
  acceptedDisposition: "three-segment-composition";
  candidateIdentity: BrowserProseCandidateV2Identity;
  outerRequestId: string;
  outerTaskType: PlatformTaskType;
  outerQualityPhase: BrowserProseCandidateV2QualityPhase;
  contextDigest: string;
  selectedPrefixDigest: string;
  compositionInputDigest: string;
  expectedContributorCount: 3;
  contributors: [
    BrowserProseCandidateV2AttestationContributor,
    BrowserProseCandidateV2AttestationContributor,
    BrowserProseCandidateV2AttestationContributor,
  ];
  actualExecutor: "browser-ai";
  underlyingExecutor: "webllm-worker";
  externalRequest: false;
  dataLeftDevice: false;
  canonicalMutationCount: 0;
  rawPromptStored: false;
  rawOutputStored: false;
  attestationDigest: string;
};

export type BrowserProseCandidateV2AttestationContributor = {
  segmentId: BrowserProseCandidateV2SegmentId;
  contributorStage: (typeof STAGE_ORDER)[number];
  contributorIndex: 0 | 1 | 2;
  ordinal: 1 | 2 | 3;
  invocationRequestId: string;
  invocationRequestDigest: string;
  contextDigest: string;
  systemInstructionDigest: string;
  promptDigest: string;
  callOptionsDigest: string;
  responseDigest: string;
  callReceiptDigest: string;
  finishReason: "stop";
  actualExecutor: "webllm-worker";
};

export type BrowserProseCandidateV2RuntimeReceipt = {
  schemaVersion: typeof BROWSER_PROSE_CANDIDATE_V2_RUNTIME_RECEIPT_SCHEMA;
  candidateIdentity: BrowserProseCandidateV2Identity;
  outerRequestId: string;
  outerTaskType: PlatformTaskType;
  outerQualityPhase: BrowserProseCandidateV2QualityPhase;
  contextDigest: string;
  fixtureId: string;
  partition: BrowserProseCandidateV2Partition;
  executionMode: BrowserProseCandidateV2ExecutionMode;
  actualExecutor: "browser-ai";
  underlyingExecutor: "webllm-worker";
  candidateOnly: true;
  externalRequest: false;
  dataLeftDevice: false;
  canonicalMutationCount: 0;
  modelResponseBudget: 3;
  modelResponseCount: 3;
  modelRetryBudget: 0;
  modelRetryCount: 0;
  monolithicGenerationAttempted: false;
  repairAttempted: false;
  extensionAttempted: false;
  recoveryAttempted: false;
  rawSegmentOutputStored: false;
  segmentCalls: [
    BrowserProseCandidateV2SegmentCallReceipt,
    BrowserProseCandidateV2SegmentCallReceipt,
    BrowserProseCandidateV2SegmentCallReceipt,
  ];
  compositionMetric: BrowserProseCandidateV2CompositionMetric;
  finalAttestation: BrowserProseCandidateV2ThreeContributorAttestation;
  syntheticObservedReceipt: boolean;
  productionPassClaimed: false;
  runtimeReceiptDigest: string;
};

export type BrowserProseCandidateV2QualificationObservation = {
  schemaVersion: typeof BROWSER_PROSE_CANDIDATE_V2_QUALIFICATION_OBSERVATION_SCHEMA;
  runtimeReceiptDigest: string;
  profileDisposed: true;
  edgeResidueCount: 0;
  workerResidueCount: 0;
  externalNetworkRequestCount: 0;
  dataEgressEventCount: 0;
  networkObservationComplete: true;
  canonicalMutationCount: 0;
  formalApprovalMutationCount: 0;
  rawOutputStored: false;
  rawPromptStored: false;
  rawStoryBibleStored: false;
  rawChapterStored: false;
  chainOfThoughtStored: false;
  cancelledSegment: BrowserProseCandidateV2SegmentId | null;
  cancelledPartialPersisted: false;
  retryReusedCancelledOutput: false;
  syntheticObservedReceipt: boolean;
  productionPassClaimed: boolean;
};

function receiptError(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(",")}}`;
}

function exactCandidateIdentity(identity: BrowserProseCandidateV2Identity): boolean {
  return stableJson(identity) === stableJson(BROWSER_PROSE_CANDIDATE_V2_IDENTITY);
}

function withoutDigest<T extends Record<string, unknown>>(value: T, key: keyof T) {
  const body = { ...value };
  delete body[key];
  return body;
}

export async function createBrowserProseCandidateV2SegmentCallReceipt(input: {
  outerRequestId: string;
  outerTaskType: PlatformTaskType;
  outerQualityPhase: BrowserProseCandidateV2QualityPhase;
  invocationRequestId: string;
  contributorIndex: 0 | 1 | 2;
  contextDigest: string;
  segment: BrowserProseCandidateV2SegmentRequest;
  systemInstruction: string;
  result: PlatformAIResult;
  executionSource: "browser-webllm-runtime" | "test-double";
}): Promise<BrowserProseCandidateV2SegmentCallReceipt> {
  const expectedSegment = SEGMENT_ORDER[input.contributorIndex];
  if (
    input.segment.segmentId !== expectedSegment
    || input.segment.ordinal !== input.contributorIndex + 1
    || input.segment.candidateIdentityDigest
      !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest
    || input.segment.maxOutputTokens
      !== BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.segmentPlan[
        input.contributorIndex
      ].maxOutputTokens
    || input.segment.requestFullProse !== false
    || input.segment.temperature !== 0
    || input.segment.topP !== 1
    || !input.outerRequestId
    || !input.invocationRequestId
  ) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_CALL_SEGMENT_BINDING_INVALID");
  }
  if (
    input.result.providerId !== "browser-ai"
    || input.result.modelId !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId
    || input.result.modelDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest
    || input.result.executor !== "webllm-worker"
    || input.result.candidateOnly !== true
    || input.result.externalRequest !== false
    || input.result.dataLeavesDevice !== false
    || input.result.generationFinishReason !== "stop"
    || !Number.isSafeInteger(input.result.completionTokens)
    || (input.result.completionTokens ?? -1) < 0
    || input.result.omittedInputCharacters !== 0
    || !input.result.performancePolicy
  ) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_CALL_RESULT_INVALID");
  }
  if (!SHA256_HEX.test(input.contextDigest)) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_CALL_CONTEXT_DIGEST_INVALID");
  }
  const invocationRequestDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-invocation-v1\n${stableJson({
      outerRequestId: input.outerRequestId,
      invocationRequestId: input.invocationRequestId,
      outerTaskType: input.outerTaskType,
      outerQualityPhase: input.outerQualityPhase,
      segmentId: input.segment.segmentId,
      contributorIndex: input.contributorIndex,
      candidateIdentityDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest,
    })}`,
  );
  const promptDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-segment-prompt-v1\n${input.segment.prompt}`,
  );
  const systemInstructionDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-system-instruction-v1\n${input.systemInstruction}`,
  );
  const callOptionsDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-call-options-v1\n${stableJson({
      requested: {
        maxOutputTokens: input.segment.maxOutputTokens,
        temperature: input.segment.temperature,
        topP: input.segment.topP,
        retryBudget: 0,
        requestFullProse: input.segment.requestFullProse,
      },
      actual: input.result.performancePolicy,
    })}`,
  );
  const responseDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-segment-response-v1\n${input.result.content}`,
  );
  const body = {
    schemaVersion: BROWSER_PROSE_CANDIDATE_V2_CALL_RECEIPT_SCHEMA,
    candidateIdentity: BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
    outerRequestId: input.outerRequestId,
    invocationRequestId: input.invocationRequestId,
    invocationRequestDigest,
    outerTaskType: input.outerTaskType,
    outerQualityPhase: input.outerQualityPhase,
    segmentId: input.segment.segmentId,
    contributorStage: STAGE_ORDER[input.contributorIndex],
    contributorIndex: input.contributorIndex,
    ordinal: input.segment.ordinal,
    contextDigest: input.contextDigest,
    systemInstructionDigest,
    promptDigest,
    callOptionsDigest,
    responseDigest,
    responseCharacters: input.result.content.length,
    finishReason: "stop" as const,
    completionTokens: input.result.completionTokens!,
    providerId: "browser-ai" as const,
    actualExecutor: "webllm-worker" as const,
    candidateOnly: true as const,
    externalRequest: false as const,
    dataLeftDevice: false as const,
    omittedInputCharacters: 0 as const,
    engineReused: input.result.engineReused === true,
    retryAttempt: 0 as const,
    monolithicGenerationAttempted: false as const,
    repairAttempted: false as const,
    extensionAttempted: false as const,
    recoveryAttempted: false as const,
    executionSource: input.executionSource,
  };
  return {
    ...body,
    callReceiptDigest: await browserProseCandidateV2Sha256(
      `browser-prose-candidate-v2-call-receipt-v1\n${stableJson(body)}`,
    ),
  };
}

export async function assertBrowserProseCandidateV2SegmentCallReceipt(
  receipt: BrowserProseCandidateV2SegmentCallReceipt,
): Promise<void> {
  const index = receipt.contributorIndex;
  if (
    receipt.schemaVersion !== BROWSER_PROSE_CANDIDATE_V2_CALL_RECEIPT_SCHEMA
    || !exactCandidateIdentity(receipt.candidateIdentity)
    || SEGMENT_ORDER[index] !== receipt.segmentId
    || STAGE_ORDER[index] !== receipt.contributorStage
    || receipt.ordinal !== index + 1
    || !receipt.outerRequestId
    || !receipt.invocationRequestId
    || !SHA256_HEX.test(receipt.invocationRequestDigest)
    || !SHA256_HEX.test(receipt.contextDigest)
    || !SHA256_HEX.test(receipt.systemInstructionDigest)
    || !SHA256_HEX.test(receipt.promptDigest)
    || !SHA256_HEX.test(receipt.callOptionsDigest)
    || !SHA256_HEX.test(receipt.responseDigest)
    || !Number.isSafeInteger(receipt.responseCharacters)
    || receipt.responseCharacters < 1
    || receipt.finishReason !== "stop"
    || receipt.providerId !== "browser-ai"
    || receipt.actualExecutor !== "webllm-worker"
    || receipt.candidateOnly !== true
    || receipt.externalRequest !== false
    || receipt.dataLeftDevice !== false
    || receipt.omittedInputCharacters !== 0
    || receipt.retryAttempt !== 0
    || receipt.monolithicGenerationAttempted !== false
    || receipt.repairAttempted !== false
    || receipt.extensionAttempted !== false
    || receipt.recoveryAttempted !== false
    || !["browser-webllm-runtime", "test-double"].includes(receipt.executionSource)
    || typeof receipt.engineReused !== "boolean"
    || !Number.isSafeInteger(receipt.completionTokens)
    || receipt.completionTokens < 0
  ) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_CALL_RECEIPT_REJECTED");
  }
  const expectedSystemInstructionDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-system-instruction-v1\n${BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION}`,
  );
  if (receipt.systemInstructionDigest !== expectedSystemInstructionDigest) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_SYSTEM_INSTRUCTION_DIGEST_MISMATCH");
  }
  const expectedInvocationDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-invocation-v1\n${stableJson({
      outerRequestId: receipt.outerRequestId,
      invocationRequestId: receipt.invocationRequestId,
      outerTaskType: receipt.outerTaskType,
      outerQualityPhase: receipt.outerQualityPhase,
      segmentId: receipt.segmentId,
      contributorIndex: receipt.contributorIndex,
      candidateIdentityDigest: receipt.candidateIdentity.candidateIdentityDigest,
    })}`,
  );
  if (receipt.invocationRequestDigest !== expectedInvocationDigest) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_INVOCATION_DIGEST_MISMATCH");
  }
  const body = withoutDigest(
    receipt as unknown as Record<string, unknown>,
    "callReceiptDigest",
  );
  const expected = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-call-receipt-v1\n${stableJson(body)}`,
  );
  if (receipt.callReceiptDigest !== expected) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_CALL_RECEIPT_DIGEST_MISMATCH");
  }
}

export async function createBrowserProseCandidateV2ThreeContributorAttestation(input: {
  segmentCalls: BrowserProseCandidateV2RuntimeReceipt["segmentCalls"];
  compositionMetric: BrowserProseCandidateV2CompositionMetric;
}): Promise<BrowserProseCandidateV2ThreeContributorAttestation> {
  assertBrowserProseCandidateV2CompositionMetric(input.compositionMetric);
  for (const receipt of input.segmentCalls) {
    await assertBrowserProseCandidateV2SegmentCallReceipt(receipt);
  }
  const [first] = input.segmentCalls;
  if (input.segmentCalls.some((receipt, index) => (
    receipt.outerRequestId !== first.outerRequestId
    || receipt.outerTaskType !== first.outerTaskType
    || receipt.outerQualityPhase !== first.outerQualityPhase
    || receipt.contextDigest !== first.contextDigest
    || receipt.contributorIndex !== index
  ))) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_ATTESTATION_BOUNDARY_MISMATCH");
  }
  if (new Set(input.segmentCalls.map((receipt) => receipt.invocationRequestId)).size !== 3) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_ATTESTATION_INVOCATION_REUSED");
  }
  const contributors = input.segmentCalls.map((receipt) => ({
    segmentId: receipt.segmentId,
    contributorStage: receipt.contributorStage,
    contributorIndex: receipt.contributorIndex,
    ordinal: receipt.ordinal,
    invocationRequestId: receipt.invocationRequestId,
    invocationRequestDigest: receipt.invocationRequestDigest,
    contextDigest: receipt.contextDigest,
    systemInstructionDigest: receipt.systemInstructionDigest,
    promptDigest: receipt.promptDigest,
    callOptionsDigest: receipt.callOptionsDigest,
    responseDigest: receipt.responseDigest,
    callReceiptDigest: receipt.callReceiptDigest,
    finishReason: receipt.finishReason,
    actualExecutor: receipt.actualExecutor,
  })) as BrowserProseCandidateV2ThreeContributorAttestation["contributors"];
  const compositionInputDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-composition-input-v1\n${stableJson({
      candidateIdentityDigest: BROWSER_PROSE_CANDIDATE_V2_IDENTITY.candidateIdentityDigest,
      orderedResponseDigests: input.segmentCalls.map((receipt) => receipt.responseDigest),
    })}`,
  );
  const body = {
    schemaVersion: BROWSER_PROSE_CANDIDATE_V2_ATTESTATION_SCHEMA,
    acceptedDisposition: "three-segment-composition" as const,
    candidateIdentity: BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
    outerRequestId: first.outerRequestId,
    outerTaskType: first.outerTaskType,
    outerQualityPhase: first.outerQualityPhase,
    contextDigest: first.contextDigest,
    selectedPrefixDigest: input.compositionMetric.selectedPrefixDigest,
    compositionInputDigest,
    expectedContributorCount: 3 as const,
    contributors,
    actualExecutor: "browser-ai" as const,
    underlyingExecutor: "webllm-worker" as const,
    externalRequest: false as const,
    dataLeftDevice: false as const,
    canonicalMutationCount: 0 as const,
    rawPromptStored: false as const,
    rawOutputStored: false as const,
  };
  return {
    ...body,
    attestationDigest: await browserProseCandidateV2Sha256(
      `browser-prose-candidate-v2-attestation-v1\n${stableJson(body)}`,
    ),
  };
}

export async function assertBrowserProseCandidateV2ThreeContributorAttestation(
  attestation: BrowserProseCandidateV2ThreeContributorAttestation,
): Promise<void> {
  if (
    attestation.schemaVersion !== BROWSER_PROSE_CANDIDATE_V2_ATTESTATION_SCHEMA
    || attestation.acceptedDisposition !== "three-segment-composition"
    || !exactCandidateIdentity(attestation.candidateIdentity)
    || attestation.expectedContributorCount !== 3
    || attestation.contributors.length !== 3
    || !SHA256_HEX.test(attestation.contextDigest)
    || !SHA256_HEX.test(attestation.selectedPrefixDigest)
    || !SHA256_HEX.test(attestation.compositionInputDigest)
    || attestation.actualExecutor !== "browser-ai"
    || attestation.underlyingExecutor !== "webllm-worker"
    || attestation.externalRequest !== false
    || attestation.dataLeftDevice !== false
    || attestation.canonicalMutationCount !== 0
    || attestation.rawPromptStored !== false
    || attestation.rawOutputStored !== false
    || attestation.contributors.some((contributor, index) => (
      contributor.segmentId !== SEGMENT_ORDER[index]
      || contributor.contributorStage !== STAGE_ORDER[index]
      || contributor.contributorIndex !== index
      || contributor.ordinal !== index + 1
      || contributor.contextDigest !== attestation.contextDigest
      || !SHA256_HEX.test(contributor.systemInstructionDigest)
      || contributor.finishReason !== "stop"
      || contributor.actualExecutor !== "webllm-worker"
    ))
    || new Set(attestation.contributors.map((row) => row.invocationRequestId)).size !== 3
    || new Set(attestation.contributors.map((row) => row.systemInstructionDigest)).size !== 1
  ) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_ATTESTATION_REJECTED");
  }
  const expectedCompositionInputDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-composition-input-v1\n${stableJson({
      candidateIdentityDigest: attestation.candidateIdentity.candidateIdentityDigest,
      orderedResponseDigests: attestation.contributors.map((row) => row.responseDigest),
    })}`,
  );
  if (attestation.compositionInputDigest !== expectedCompositionInputDigest) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_COMPOSITION_INPUT_DIGEST_MISMATCH");
  }
  const body = withoutDigest(
    attestation as unknown as Record<string, unknown>,
    "attestationDigest",
  );
  const expected = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-attestation-v1\n${stableJson(body)}`,
  );
  if (attestation.attestationDigest !== expected) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_ATTESTATION_DIGEST_MISMATCH");
  }
}

export async function createBrowserProseCandidateV2RuntimeReceipt(input: {
  segmentCalls: BrowserProseCandidateV2RuntimeReceipt["segmentCalls"];
  compositionMetric: BrowserProseCandidateV2CompositionMetric;
  finalAttestation: BrowserProseCandidateV2ThreeContributorAttestation;
}): Promise<BrowserProseCandidateV2RuntimeReceipt> {
  await assertBrowserProseCandidateV2ThreeContributorAttestation(input.finalAttestation);
  assertBrowserProseCandidateV2CompositionMetric(input.compositionMetric);
  const [first] = input.segmentCalls;
  const syntheticObservedReceipt = input.segmentCalls.some(
    (receipt) => receipt.executionSource === "test-double",
  );
  const body = {
    schemaVersion: BROWSER_PROSE_CANDIDATE_V2_RUNTIME_RECEIPT_SCHEMA,
    candidateIdentity: BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
    outerRequestId: first.outerRequestId,
    outerTaskType: first.outerTaskType,
    outerQualityPhase: first.outerQualityPhase,
    contextDigest: first.contextDigest,
    fixtureId: input.compositionMetric.fixtureId,
    partition: input.compositionMetric.partition,
    executionMode: input.compositionMetric.executionMode,
    actualExecutor: "browser-ai" as const,
    underlyingExecutor: "webllm-worker" as const,
    candidateOnly: true as const,
    externalRequest: false as const,
    dataLeftDevice: false as const,
    canonicalMutationCount: 0 as const,
    modelResponseBudget: 3 as const,
    modelResponseCount: 3 as const,
    modelRetryBudget: 0 as const,
    modelRetryCount: 0 as const,
    monolithicGenerationAttempted: false as const,
    repairAttempted: false as const,
    extensionAttempted: false as const,
    recoveryAttempted: false as const,
    rawSegmentOutputStored: false as const,
    segmentCalls: input.segmentCalls,
    compositionMetric: input.compositionMetric,
    finalAttestation: input.finalAttestation,
    syntheticObservedReceipt,
    productionPassClaimed: false as const,
  };
  return {
    ...body,
    runtimeReceiptDigest: await browserProseCandidateV2Sha256(
      `browser-prose-candidate-v2-runtime-receipt-v1\n${stableJson(body)}`,
    ),
  };
}

export async function assertBrowserProseCandidateV2RuntimeReceipt(
  receipt: BrowserProseCandidateV2RuntimeReceipt,
): Promise<void> {
  if (
    receipt.schemaVersion !== BROWSER_PROSE_CANDIDATE_V2_RUNTIME_RECEIPT_SCHEMA
    || !exactCandidateIdentity(receipt.candidateIdentity)
    || receipt.actualExecutor !== "browser-ai"
    || receipt.underlyingExecutor !== "webllm-worker"
    || receipt.candidateOnly !== true
    || receipt.externalRequest !== false
    || receipt.dataLeftDevice !== false
    || receipt.canonicalMutationCount !== 0
    || receipt.modelResponseBudget !== 3
    || receipt.modelResponseCount !== 3
    || receipt.modelRetryBudget !== 0
    || receipt.modelRetryCount !== 0
    || receipt.monolithicGenerationAttempted !== false
    || receipt.repairAttempted !== false
    || receipt.extensionAttempted !== false
    || receipt.recoveryAttempted !== false
    || receipt.rawSegmentOutputStored !== false
    || receipt.segmentCalls.length !== 3
    || receipt.productionPassClaimed !== false
    || receipt.syntheticObservedReceipt !== receipt.segmentCalls.some(
      (row) => row.executionSource === "test-double",
    )
  ) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_RUNTIME_RECEIPT_REJECTED");
  }
  for (const call of receipt.segmentCalls) {
    await assertBrowserProseCandidateV2SegmentCallReceipt(call);
  }
  await assertBrowserProseCandidateV2ThreeContributorAttestation(receipt.finalAttestation);
  assertBrowserProseCandidateV2CompositionMetric(receipt.compositionMetric);
  const contributorMismatch = receipt.segmentCalls.some((call, index) => {
    const contributor = receipt.finalAttestation.contributors[index];
    return !contributor || stableJson(contributor) !== stableJson({
      segmentId: call.segmentId,
      contributorStage: call.contributorStage,
      contributorIndex: call.contributorIndex,
      ordinal: call.ordinal,
      invocationRequestId: call.invocationRequestId,
      invocationRequestDigest: call.invocationRequestDigest,
      contextDigest: call.contextDigest,
      systemInstructionDigest: call.systemInstructionDigest,
      promptDigest: call.promptDigest,
      callOptionsDigest: call.callOptionsDigest,
      responseDigest: call.responseDigest,
      callReceiptDigest: call.callReceiptDigest,
      finishReason: call.finishReason,
      actualExecutor: call.actualExecutor,
    });
  });
  if (
    contributorMismatch
    || receipt.segmentCalls.some((call) => call.outerRequestId !== receipt.outerRequestId)
    || receipt.segmentCalls.some((call) => call.outerTaskType !== receipt.outerTaskType)
    || receipt.segmentCalls.some((call) => call.outerQualityPhase !== receipt.outerQualityPhase)
    || receipt.segmentCalls.some((call) => call.contextDigest !== receipt.contextDigest)
    || receipt.finalAttestation.outerRequestId !== receipt.outerRequestId
    || receipt.finalAttestation.contextDigest !== receipt.contextDigest
    || receipt.finalAttestation.selectedPrefixDigest
      !== receipt.compositionMetric.selectedPrefixDigest
    || receipt.fixtureId !== receipt.compositionMetric.fixtureId
    || receipt.partition !== receipt.compositionMetric.partition
    || receipt.executionMode !== receipt.compositionMetric.executionMode
  ) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_RUNTIME_RECEIPT_BOUNDARY_MISMATCH");
  }
  const body = withoutDigest(
    receipt as unknown as Record<string, unknown>,
    "runtimeReceiptDigest",
  );
  const expected = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-runtime-receipt-v1\n${stableJson(body)}`,
  );
  if (receipt.runtimeReceiptDigest !== expected) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_RUNTIME_RECEIPT_DIGEST_MISMATCH");
  }
}

export async function finalizeBrowserProseCandidateV2SafeMetric(input: {
  runtimeReceipt: BrowserProseCandidateV2RuntimeReceipt;
  observation: BrowserProseCandidateV2QualificationObservation;
}): Promise<BrowserProseCandidateV2SafeMetric> {
  await assertBrowserProseCandidateV2RuntimeReceipt(input.runtimeReceipt);
  const observation = input.observation;
  if (
    observation.schemaVersion !== BROWSER_PROSE_CANDIDATE_V2_QUALIFICATION_OBSERVATION_SCHEMA
    || observation.runtimeReceiptDigest !== input.runtimeReceipt.runtimeReceiptDigest
    || observation.profileDisposed !== true
    || observation.edgeResidueCount !== 0
    || observation.workerResidueCount !== 0
    || observation.externalNetworkRequestCount !== 0
    || observation.dataEgressEventCount !== 0
    || observation.networkObservationComplete !== true
    || observation.canonicalMutationCount !== 0
    || observation.formalApprovalMutationCount !== 0
    || observation.rawOutputStored !== false
    || observation.rawPromptStored !== false
    || observation.rawStoryBibleStored !== false
    || observation.rawChapterStored !== false
    || observation.chainOfThoughtStored !== false
    || observation.cancelledPartialPersisted !== false
    || observation.retryReusedCancelledOutput !== false
    || observation.syntheticObservedReceipt !== input.runtimeReceipt.syntheticObservedReceipt
    || observation.productionPassClaimed === observation.syntheticObservedReceipt
    || (input.runtimeReceipt.executionMode === "cancel-retry")
      !== (observation.cancelledSegment !== null)
  ) {
    receiptError("BROWSER_PROSE_CANDIDATE_V2_QUALIFICATION_OBSERVATION_REJECTED");
  }
  const metric: BrowserProseCandidateV2SafeMetric = {
    ...input.runtimeReceipt.compositionMetric,
    schemaVersion: BROWSER_PROSE_CANDIDATE_V2_SAFE_METRIC_SCHEMA,
    runtimeReceiptDigest: input.runtimeReceipt.runtimeReceiptDigest,
    finalAttestationDigest: input.runtimeReceipt.finalAttestation.attestationDigest,
    actualExecutor: input.runtimeReceipt.actualExecutor,
    underlyingExecutor: input.runtimeReceipt.underlyingExecutor,
    candidateOnly: input.runtimeReceipt.candidateOnly,
    externalRequest: input.runtimeReceipt.externalRequest,
    dataLeftDevice: input.runtimeReceipt.dataLeftDevice,
    externalNetworkRequestCount: observation.externalNetworkRequestCount,
    dataEgressEventCount: observation.dataEgressEventCount,
    networkObservationComplete: observation.networkObservationComplete,
    canonicalMutationCount: observation.canonicalMutationCount,
    formalApprovalMutationCount: observation.formalApprovalMutationCount,
    profileDisposed: observation.profileDisposed,
    edgeResidueCount: observation.edgeResidueCount,
    workerResidueCount: observation.workerResidueCount,
    rawOutputStored: observation.rawOutputStored,
    rawPromptStored: observation.rawPromptStored,
    rawStoryBibleStored: observation.rawStoryBibleStored,
    rawChapterStored: observation.rawChapterStored,
    chainOfThoughtStored: observation.chainOfThoughtStored,
    cancelledSegment: observation.cancelledSegment,
    cancelledPartialPersisted: observation.cancelledPartialPersisted,
    retryReusedCancelledOutput: observation.retryReusedCancelledOutput,
    syntheticObservedReceipt: observation.syntheticObservedReceipt,
    productionPassClaimed: observation.productionPassClaimed,
  };
  assertBrowserProseCandidateV2SafeMetric(metric, {
    allowSyntheticObservedReceipt: observation.syntheticObservedReceipt,
  });
  return metric;
}
