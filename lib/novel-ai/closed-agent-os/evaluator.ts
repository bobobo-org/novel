import { sha256Hex, stableStringify } from "../closed-ai-cache";
import {
  containsConvertibleSimplifiedChinese,
  containsProtectedProperNounDrift,
} from "../language/traditional-chinese";
import { evaluateObjectiveAcceptance } from "./acceptance";
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
  const protectedSource = [
    input.request.objective,
    ...input.request.context.map((item) => item.text),
  ].join("\n");
  if (containsConvertibleSimplifiedChinese(content, protectedSource)) {
    blockingCodes.push("CANDIDATE_SIMPLIFIED_CHINESE_REMAINS");
  }
  if (containsProtectedProperNounDrift(content, protectedSource)) {
    blockingCodes.push("CANDIDATE_PROPER_NOUN_DRIFT");
  }
  if (!input.execution.candidateOnly) blockingCodes.push("CANDIDATE_ONLY_CONTRACT_MISSING");
  if (
    input.execution.backendId !== "private-ai-hub"
    && (input.execution.externalRequest || input.execution.dataLeftDevice)
  ) {
    blockingCodes.push("CANDIDATE_DEVICE_BOUNDARY_VIOLATION");
  }
  if (
    /風險/u.test(input.request.objective)
    && !/(?:風險|代價|失敗條件|可能後果)/u.test(content)
  ) {
    warningCodes.push("OBJECTIVE_RISK_DIMENSION_MISSING");
  }
  const objectiveAcceptance = evaluateObjectiveAcceptance({
    objective: input.request.objective,
    content,
  });
  for (const code of objectiveAcceptance.warningCodes) {
    if (!warningCodes.includes(code)) warningCodes.push(code);
  }
  if (input.request.taskType === "story.storyBibleCandidate") {
    for (const heading of [
      "已核准事實",
      "待確認",
      "矛盾",
      "角色",
      "世界規則",
      "時間線",
      "伏筆",
      "禁改項",
    ]) {
      if (!content.includes(heading)) {
        warningCodes.push(`STORY_BIBLE_SECTION_MISSING:${heading}`);
      }
    }
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
    objectiveAcceptance: {
      contract: objectiveAcceptance.contract,
      detectedItemCount: objectiveAcceptance.detectedItemCount,
      missingDimensions: objectiveAcceptance.missingDimensions,
      dimensionCoverage: objectiveAcceptance.dimensionCoverage,
    },
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
