import type {
  PlatformAIRequest,
  PlatformRouterDecision,
} from "../../router/platform-types";
import {
  BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY,
  BROWSER_PROSE_CANDIDATE_V2_IDENTITY,
  assertBrowserProseCandidateV2Identity,
  browserProseCandidateV2Sha256,
  buildBrowserProseCandidateV2SegmentRequests,
  composeBrowserProseCandidateV2,
  type BrowserProseCandidateV2ComposeResult,
  type BrowserProseCandidateV2ExecutionMode,
  type BrowserProseCandidateV2Partition,
  type BrowserProseCandidateV2SegmentId,
} from "./browser-prose-candidate-v2";
import {
  assertBrowserProseCandidateV2ParsedContext,
  type BrowserProseCandidateV2ParsedContext,
} from "./browser-prose-candidate-v2-context";
import {
  runBrowserAICandidateV2Segment,
  type BrowserAICandidateV2SegmentExecution,
  type BrowserAIStreamProgress,
} from "./browser-ai-provider";
import {
  assertBrowserProseCandidateV2RuntimeReceipt,
  assertBrowserProseCandidateV2SegmentCallReceipt,
  createBrowserProseCandidateV2RuntimeReceipt,
  createBrowserProseCandidateV2ThreeContributorAttestation,
  type BrowserProseCandidateV2RuntimeReceipt,
  type BrowserProseCandidateV2ThreeContributorAttestation,
} from "./browser-prose-candidate-v2-receipt";

export type BrowserProseCandidateV2SegmentExecutor =
  typeof runBrowserAICandidateV2Segment;

export type BrowserProseCandidateV2RuntimeResult = {
  content: string;
  candidateIdentity: typeof BROWSER_PROSE_CANDIDATE_V2_IDENTITY;
  compositionMetric: BrowserProseCandidateV2ComposeResult["compositionMetric"];
  runtimeReceipt: BrowserProseCandidateV2RuntimeReceipt;
  finalAttestation: BrowserProseCandidateV2ThreeContributorAttestation;
};

function runtimeBoundaryError(code: string): never {
  throw Object.assign(new Error(code), {
    code,
    fallbackAttempted: false,
    retryAttempted: false,
  });
}

function assertRuntimeBoundary(
  request: PlatformAIRequest,
  decision: PlatformRouterDecision,
): void {
  if (
    request.privacyMode !== "strict-local"
    || !["chapter.continue", "chapter.expand"].includes(request.taskType)
    || request.externalConsent !== false
    || request.closedOnly !== true
    || request.offlineRequired !== true
    || request.fallbackPolicy !== "none"
    || decision.providerId !== "browser-ai"
    || decision.privacyMode !== "strict-local"
    || decision.modelId !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelId
    || decision.modelDigest !== BROWSER_PROSE_CANDIDATE_V2_IDENTITY.modelDigest
    || decision.externalRequest !== false
    || decision.dataLeavesDevice !== false
    || decision.fallbackChain.length !== 0
  ) {
    runtimeBoundaryError("BROWSER_PROSE_CANDIDATE_V2_RUNTIME_BOUNDARY_INVALID");
  }
}

export async function executeBrowserProseCandidateV2Runtime(input: {
  outerRequest: PlatformAIRequest;
  decision: PlatformRouterDecision;
  parsedContext: BrowserProseCandidateV2ParsedContext;
  fixtureId: string;
  partition: BrowserProseCandidateV2Partition;
  executionMode: BrowserProseCandidateV2ExecutionMode;
  onProgress?: (progress: BrowserAIStreamProgress & {
    segmentId: BrowserProseCandidateV2SegmentId;
    ordinal: 1 | 2 | 3;
  }) => void;
  /** Focused contract seam only. Production callers omit this dependency. */
  executeSegment?: BrowserProseCandidateV2SegmentExecutor;
}): Promise<BrowserProseCandidateV2RuntimeResult> {
  await assertBrowserProseCandidateV2Identity();
  await assertBrowserProseCandidateV2ParsedContext(input.parsedContext);
  assertRuntimeBoundary(input.outerRequest, input.decision);
  if (!input.fixtureId.trim()) {
    runtimeBoundaryError("BROWSER_PROSE_CANDIDATE_V2_FIXTURE_ID_MISSING");
  }
  const segments = buildBrowserProseCandidateV2SegmentRequests(
    input.parsedContext.context,
  );
  if (segments.length !== BROWSER_PROSE_CANDIDATE_V2_GENERATION_POLICY.modelResponseBudget) {
    runtimeBoundaryError("BROWSER_PROSE_CANDIDATE_V2_SEGMENT_BUDGET_INVALID");
  }

  const executeSegment = input.executeSegment ?? runBrowserAICandidateV2Segment;
  const executions: BrowserAICandidateV2SegmentExecution[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const contributorIndex = index as 0 | 1 | 2;
    const invocationRequestId = [
      input.outerRequest.requestId,
      "browser-prose-candidate-v2",
      segment.ordinal,
      segment.segmentId,
    ].join(":");
    const execution = await executeSegment({
      request: input.outerRequest,
      decision: input.decision,
      segment,
      contributorIndex,
      invocationRequestId,
      contextDigest: input.parsedContext.contextDigest,
      onProgress: input.onProgress
        ? (progress) => input.onProgress?.({
          ...progress,
          segmentId: segment.segmentId,
          ordinal: segment.ordinal,
        })
        : undefined,
    });
    await assertBrowserProseCandidateV2SegmentCallReceipt(execution.callReceipt);
    const responseDigest = await browserProseCandidateV2Sha256(
      `browser-prose-candidate-v2-segment-response-v1\n${execution.response.content}`,
    );
    if (
      execution.response.segmentId !== segment.segmentId
      || execution.response.finishReason !== "stop"
      || execution.callReceipt.responseDigest !== responseDigest
      || execution.callReceipt.invocationRequestId !== invocationRequestId
      || execution.callReceipt.contextDigest !== input.parsedContext.contextDigest
      || execution.callReceipt.contributorIndex !== contributorIndex
    ) {
      runtimeBoundaryError("BROWSER_PROSE_CANDIDATE_V2_SEGMENT_EXECUTION_MISMATCH");
    }
    executions.push(execution);
  }
  if (executions.length !== 3) {
    runtimeBoundaryError("BROWSER_PROSE_CANDIDATE_V2_RESPONSE_COUNT_INVALID");
  }

  const composed = await composeBrowserProseCandidateV2({
    fixtureId: input.fixtureId,
    partition: input.partition,
    executionMode: input.executionMode,
    context: input.parsedContext.context,
    responses: executions.map((execution) => execution.response),
  });
  const segmentCalls = executions.map((execution) => execution.callReceipt) as
    BrowserProseCandidateV2RuntimeReceipt["segmentCalls"];
  const finalAttestation = await createBrowserProseCandidateV2ThreeContributorAttestation({
    segmentCalls,
    compositionMetric: composed.compositionMetric,
  });
  const runtimeReceipt = await createBrowserProseCandidateV2RuntimeReceipt({
    segmentCalls,
    compositionMetric: composed.compositionMetric,
    finalAttestation,
  });
  await assertBrowserProseCandidateV2RuntimeReceipt(runtimeReceipt);
  return {
    content: composed.content,
    candidateIdentity: composed.candidateIdentity,
    compositionMetric: composed.compositionMetric,
    runtimeReceipt,
    finalAttestation,
  };
}
