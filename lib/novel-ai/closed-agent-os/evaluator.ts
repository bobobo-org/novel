import { sha256Hex, stableStringify } from "../closed-ai-cache";
import type {
  TraditionalChineseNormalizationPolicy,
} from "../language/traditional-chinese";
import { evaluateObjectiveAcceptance } from "./acceptance";
import { normalizeAbcChoicesCandidate } from "./structured-output";
import {
  closedOutputSafetyCode,
  closedOutputSafetyReasonCode,
} from "../security/closed-output-safety";
import type {
  ClosedAgentEvaluation,
  ClosedAgentTaskRequest,
  ClosedBackendExecutionResult,
} from "./types";

function candidateRubric(input: {
  content: string;
  blockingCodes: string[];
  objectiveAcceptance: ReturnType<typeof evaluateObjectiveAcceptance>;
}) {
  const paragraphs = input.content.split(/\n\s*\n/gu).filter((item) => item.trim());
  const sentences = input.content.split(/[。！？!?\n]+/gu)
    .map((item) => item.replace(/\s+/gu, "").trim())
    .filter((item) => item.length >= 8);
  const uniqueSentences = new Set(sentences);
  const repetitionRatio = sentences.length
    ? 1 - uniqueSentences.size / sentences.length
    : 0;
  const objectiveDimensions = input.objectiveAcceptance.contract.requiredDimensions.length;
  const objectiveCoverage = objectiveDimensions
    ? 1 - input.objectiveAcceptance.missingDimensions.length / objectiveDimensions
    : input.content.length >= 48
      ? 1
      : 0.5;
  const concreteSignals = (input.content.match(
    /(?:因為|因此|如果|當|代價|風險|證據|步驟|條件|結果|限制|例外|\d+)/gu,
  ) ?? []).length;
  return {
    safety: input.blockingCodes.length ? 0 : 1,
    objectiveCoverage: Math.max(0, Math.min(1, objectiveCoverage)),
    structure: Math.max(0.25, Math.min(1, (paragraphs.length + 1) / 4)),
    specificity: Math.max(0.2, Math.min(1, concreteSignals / 8)),
    repetitionPenalty: Math.max(0, Math.min(1, repetitionRatio)),
  };
}

export async function evaluateClosedAgentCandidate(input: {
  request: ClosedAgentTaskRequest;
  execution: ClosedBackendExecutionResult;
  traditionalChineseNormalizationPolicy: TraditionalChineseNormalizationPolicy;
}): Promise<ClosedAgentEvaluation> {
  const {
    containsHighConfidenceSimplifiedChinese,
    containsProtectedTermDrift,
    verifyTraditionalChineseNormalizationIntegrity,
  } = await import("../language/traditional-chinese");
  const blockingCodes: string[] = [];
  const warningCodes: string[] = [];
  const content = input.execution.content.trim();
  if (!content) blockingCodes.push("CANDIDATE_EMPTY");
  const outputSafetyCode = closedOutputSafetyCode(content);
  if (outputSafetyCode) {
    blockingCodes.push(
      outputSafetyCode === "credential"
        ? "CANDIDATE_CREDENTIAL_LEAK"
        : outputSafetyCode === "raw-reasoning"
          ? "CANDIDATE_RAW_REASONING_LEAK"
          : closedOutputSafetyReasonCode(outputSafetyCode),
    );
  }
  const normalizationVerified = await verifyTraditionalChineseNormalizationIntegrity({
    content,
    integrity: input.execution.traditionalChineseNormalization,
    policy: input.traditionalChineseNormalizationPolicy,
    providerId: input.execution.backendId,
    modelId: input.execution.modelId,
    modelDigest: input.execution.modelDigest,
  });
  if (!normalizationVerified) {
    blockingCodes.push("CANDIDATE_TRADITIONAL_CHINESE_INTEGRITY_INVALID");
  }
  if (containsHighConfidenceSimplifiedChinese(
    content,
    input.traditionalChineseNormalizationPolicy.protectedTerms,
    input.traditionalChineseNormalizationPolicy.protectedTermModes,
  )) {
    blockingCodes.push("CANDIDATE_SIMPLIFIED_CHINESE_REMAINS");
  }
  if (containsProtectedTermDrift(
    content,
    input.traditionalChineseNormalizationPolicy.protectedTerms,
    input.traditionalChineseNormalizationPolicy.protectedTermModes,
  ) || containsProtectedTermDrift(
    content,
    input.traditionalChineseNormalizationPolicy.continuityTerms,
  ) || input.execution.traditionalChineseNormalization
    .ambiguousCanonicalOccurrenceCount > 0) {
    blockingCodes.push("CANDIDATE_PROPER_NOUN_DRIFT");
  }
  if (!input.execution.candidateOnly) blockingCodes.push("CANDIDATE_ONLY_CONTRACT_MISSING");
  if (input.execution.externalRequest || input.execution.dataLeftDevice) {
    blockingCodes.push("CANDIDATE_DEVICE_BOUNDARY_VIOLATION");
  }
  if (
    input.request.taskType === "chapter.abcChoices"
    && !normalizeAbcChoicesCandidate(content).valid
  ) {
    blockingCodes.push("ABC_CHOICES_INVALID_STRUCTURE");
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
  const repeatedLines = content.split(/\n+/gu)
    .map((line) => line.replace(/\s+/gu, "").trim())
    .filter((line) => line.length >= 16);
  if (repeatedLines.length >= 4 && new Set(repeatedLines).size / repeatedLines.length < 0.65) {
    warningCodes.push("CANDIDATE_HIGH_REPETITION");
  }
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
  const rubric = candidateRubric({ content, blockingCodes, objectiveAcceptance });
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
    rubric,
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
    rubric,
    rawChainOfThoughtStored: false,
  };
}
