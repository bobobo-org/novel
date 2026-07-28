import { sha256Hex, stableStringify } from "../closed-ai-cache";
import type {
  ClosedAgentEvaluation,
  ClosedAgentTaskRequest,
  ClosedBackendExecutionResult,
} from "./types";

const CREDENTIAL = /\b(?:vcp|sbp|sk|gh[pousr])_[A-Za-z0-9_-]{20,}\b/u;
const RAW_REASONING = /\b(?:chain[- ]of[- ]thought|hidden reasoning)\b/iu;

export async function evaluateClosedAgentCandidate(input: {
  request: ClosedAgentTaskRequest;
  execution: ClosedBackendExecutionResult;
}): Promise<ClosedAgentEvaluation> {
  const blockingCodes: string[] = [];
  const warningCodes: string[] = [];
  const content = input.execution.content.trim();
  if (!content) blockingCodes.push("CANDIDATE_EMPTY");
  if (CREDENTIAL.test(content)) blockingCodes.push("CANDIDATE_CREDENTIAL_LEAK");
  if (RAW_REASONING.test(content)) blockingCodes.push("CANDIDATE_RAW_REASONING_LEAK");
  if (!input.execution.candidateOnly) blockingCodes.push("CANDIDATE_ONLY_CONTRACT_MISSING");
  if (
    input.execution.backendId !== "private-ai-hub"
    && (input.execution.externalRequest || input.execution.dataLeftDevice)
  ) {
    blockingCodes.push("CANDIDATE_DEVICE_BOUNDARY_VIOLATION");
  }
  if (content.length < 24) warningCodes.push("CANDIDATE_VERY_SHORT");
  const approvedEvaluatorContext = input.request.context
    .filter((item) =>
      item.approved
      && (item.visibility === "evaluator" || item.visibility === "both"))
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      digestSource: item.text,
    }));
  const evaluatorInputDigest = await sha256Hex(stableStringify({
    taskType: input.request.taskType,
    objective: input.request.objective,
    candidateDigest: await sha256Hex(content),
    approvedEvaluatorContext,
  }));
  const score = Math.max(
    0,
    Math.min(1, 0.92 - blockingCodes.length * 0.5 - warningCodes.length * 0.05),
  );
  return {
    passed: blockingCodes.length === 0,
    score,
    blockingCodes,
    warningCodes,
    evaluatorInputDigest,
    rawChainOfThoughtStored: false,
  };
}
