export const CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODES = Object.freeze([
  "BROWSER_AI_MANDATORY_PROMPT_CONTRACT_MISSING",
  "BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED",
  "BROWSER_FINAL_CONTEXT_PROOF_REQUIRED",
  "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
  "BROWSER_FINAL_CONTEXT_ENVELOPE_INVALID",
  "BROWSER_FINAL_CONTEXT_BUDGET_EXCEEDED",
  "BROWSER_WEBLLM_EMPTY_RESPONSE",
  "BROWSER_WEBLLM_MODEL_NOT_INSTALLED",
  "BROWSER_WEBLLM_MODEL_NOT_SELECTED",
  "BROWSER_GPU_QUEUE_BACKPRESSURE",
  "BROWSER_GPU_MEMORY_BUDGET_EXCEEDED",
  "BROWSER_GPU_JOB_TIMEOUT",
  "BROWSER_GPU_RECOVERY_FAILED",
  "BROWSER_WEBLLM_GPU_DEVICE_LOST",
  "BROWSER_WEBLLM_WORKER_CRASHED",
  "BROWSER_WEBLLM_WORKER_MESSAGE_FAILED",
  "BROWSER_WEBLLM_GENERATION_FAILED",
] as const);

export const CLOSED_AGENT_FAILURE_DIAGNOSTIC_CODES = Object.freeze([
  "QUALITY_TRADITIONALCHINESE_LOW",
  "QUALITY_CANONCOMPLIANCE_LOW",
  "QUALITY_CHARACTERVOICE_LOW",
  "QUALITY_CONTINUITY_LOW",
  "QUALITY_SPECIFICITY_LOW",
  "QUALITY_REPETITION_LOW",
  "QUALITY_STRUCTUREDOUTPUT_LOW",
  "QUALITY_TASKUSEFULNESS_LOW",
  "QUALITY_LENGTHCOMPLIANCE_LOW",
  "QUALITY_EMPTY_CANDIDATE",
  "QUALITY_TASK_FORM_MISMATCH",
  "QUALITY_SCORE_BELOW_THRESHOLD",
  "QUALITY_CONTEXT_ANCHOR_MISSING",
  "QUALITY_CONTEXT_CHARACTER_MISSING",
  "QUALITY_OUTPUT_TRUNCATED",
  "QUALITY_OUTPUT_CREDENTIAL_LEAK",
  "QUALITY_OUTPUT_RAW_REASONING_LEAK",
  "QUALITY_OUTPUT_CONTROL_TOKEN",
  "QUALITY_OUTPUT_ROLE_ENVELOPE",
  "QUALITY_OUTPUT_INTERNAL_ENVELOPE",
  "QUALITY_NARRATIVE_TOO_SHORT",
  "QUALITY_CONTEXT_COPY_EXCESSIVE",
  "QUALITY_NARRATIVE_PROGRESS_MISSING",
  "QUALITY_WORLD_REGISTER_DRIFT",
  "QUALITY_CONTINUATION_CONTROL_TOKEN",
  "QUALITY_CONTINUATION_ROLE_ENVELOPE",
  "QUALITY_CONTINUATION_INTERNAL_ENVELOPE",
  "QUALITY_CONTINUATION_ANCHOR_INVALID",
  "QUALITY_CONTINUATION_ANCHOR_REPEATED",
  "QUALITY_CONTINUATION_SUFFIX_EMPTY",
  "QUALITY_CONTINUATION_BASE_REPEATED",
  "QUALITY_CONTINUATION_CONTRACT_UNSATISFIED",
  "CHARACTER_KNOWLEDGE_BOUNDARY_LEAK",
  "CANDIDATE_EMPTY",
  "CANDIDATE_CREDENTIAL_LEAK",
  "CANDIDATE_RAW_REASONING_LEAK",
  "CANDIDATE_SIMPLIFIED_CHINESE_REMAINS",
  "CANDIDATE_PROPER_NOUN_DRIFT",
  "CANDIDATE_TRADITIONAL_CHINESE_INTEGRITY_INVALID",
  "CANDIDATE_ONLY_CONTRACT_MISSING",
  "CANDIDATE_DEVICE_BOUNDARY_VIOLATION",
  "ABC_CHOICES_INVALID_STRUCTURE",
  "CLOSED_AGENT_TRADITIONAL_CHINESE_POLICY_INVALID",
  "CLOSED_AGENT_TRADITIONAL_CHINESE_INTEGRITY_INVALID",
  "CLOSED_AGENT_PROVIDER_NORMALIZATION_NOT_DEFERRED",
  ...CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODES,
] as const);

export const CLOSED_AGENT_FAILURE_EVIDENCE_SCHEMA_VERSION =
  "closed-agent-failure-evidence-v1" as const;
export const CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE =
  "closed-agent-failure-evidence" as const;

export const CLOSED_AGENT_FAILURE_SAFE_CODES = Object.freeze([
  "CLOSED_AGENT_TASK_FAILED",
  "CLOSED_AGENT_EVALUATION_BLOCKED",
  "CLOSED_AGENT_FAILURE_EVIDENCE_INVALID",
  "CLOSED_AGENT_FAILURE_EVIDENCE_PERSIST_FAILED",
  "CLOSED_AI_REQUIRED_BACKEND_NOT_READY",
  "BROWSER_AI_QUALITY_INSUFFICIENT",
  "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
  "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTOR_UNAVAILABLE",
  "BROWSER_AI_MANDATORY_PROMPT_CONTRACT_MISSING",
  "BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED",
  ...CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODES,
] as const);

const CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODE_SET = new Set<string>(
  CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODES,
);
const CLOSED_AGENT_FAILURE_DIAGNOSTIC_CODE_SET = new Set<string>(
  CLOSED_AGENT_FAILURE_DIAGNOSTIC_CODES,
);
const CLOSED_AGENT_FAILURE_SAFE_CODE_SET = new Set<string>(
  CLOSED_AGENT_FAILURE_SAFE_CODES,
);

export function isClosedAgentBrowserRuntimeDiagnosticCode(value: unknown): value is string {
  return typeof value === "string"
    && CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODE_SET.has(value);
}

export function isClosedAgentFailureDiagnosticCode(value: unknown): value is string {
  return typeof value === "string"
    && CLOSED_AGENT_FAILURE_DIAGNOSTIC_CODE_SET.has(value);
}

export function safeClosedAgentBrowserRuntimeCauseCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return isClosedAgentBrowserRuntimeDiagnosticCode(code)
    ? code
    : "BROWSER_WEBLLM_GENERATION_FAILED";
}

const CLOSED_AGENT_BROWSER_RUNTIME_STAGES = new Set([
  "initial",
  "repair",
  "extension",
  "recovery",
] as const);
const CLOSED_AGENT_BROWSER_RUNTIME_FINISH_REASONS = new Set([
  "stop",
  "length",
  "tool_calls",
  "abort",
  "unavailable",
] as const);

export type ClosedAgentBrowserRuntimeEvidence = {
  stage: "initial" | "repair" | "extension" | "recovery";
  finishReason: "stop" | "length" | "tool_calls" | "abort" | "unavailable";
  completionTokens: number | null;
  rawOutputCharacters: number | null;
  normalizedOutputCharacters: number | null;
  observedHanCharacters: number | null;
};

export type ClosedAgentFailureEvidence = {
  schemaVersion: typeof CLOSED_AGENT_FAILURE_EVIDENCE_SCHEMA_VERSION;
  safeCode: string;
  diagnosticCodes: string[];
  browserRuntimeEvidence: ClosedAgentBrowserRuntimeEvidence[];
};

function boundedRuntimeInteger(value: unknown, maximum: number) {
  if (value === null) return null;
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= maximum
    ? value
    : undefined;
}

export function closedAgentBrowserRuntimeEvidence(
  error: unknown,
): ClosedAgentBrowserRuntimeEvidence[] {
  if (!error || typeof error !== "object") return [];
  const visited = new Set<object>();
  let candidateError: object | null = error;
  let values: unknown;
  for (let depth = 0; depth < 3 && candidateError; depth += 1) {
    if (visited.has(candidateError)) break;
    visited.add(candidateError);
    try {
      const candidate = candidateError as {
        browserRuntimeEvidence?: unknown;
        cause?: unknown;
      };
      if (Array.isArray(candidate.browserRuntimeEvidence)) {
        values = candidate.browserRuntimeEvidence;
        break;
      }
      candidateError = candidate.cause && typeof candidate.cause === "object"
        ? candidate.cause
        : null;
    } catch {
      candidateError = null;
    }
  }
  if (!Array.isArray(values)) return [];
  const stages = new Set<string>();
  const evidence: ClosedAgentBrowserRuntimeEvidence[] = [];
  for (const value of values.slice(0, 3)) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Record<string, unknown>;
    if (
      !CLOSED_AGENT_BROWSER_RUNTIME_STAGES.has(
        candidate.stage as ClosedAgentBrowserRuntimeEvidence["stage"],
      )
      || !CLOSED_AGENT_BROWSER_RUNTIME_FINISH_REASONS.has(
        candidate.finishReason as ClosedAgentBrowserRuntimeEvidence["finishReason"],
      )
      || stages.has(candidate.stage as string)
    ) continue;
    const completionTokens = boundedRuntimeInteger(candidate.completionTokens, 4_096);
    const rawOutputCharacters = boundedRuntimeInteger(candidate.rawOutputCharacters, 20_000);
    const normalizedOutputCharacters = boundedRuntimeInteger(
      candidate.normalizedOutputCharacters,
      20_000,
    );
    const observedHanCharacters = boundedRuntimeInteger(
      candidate.observedHanCharacters,
      10_000,
    );
    if (
      completionTokens === undefined
      || rawOutputCharacters === undefined
      || normalizedOutputCharacters === undefined
      || observedHanCharacters === undefined
    ) continue;
    stages.add(candidate.stage as string);
    evidence.push({
      stage: candidate.stage as ClosedAgentBrowserRuntimeEvidence["stage"],
      finishReason: candidate.finishReason as ClosedAgentBrowserRuntimeEvidence["finishReason"],
      completionTokens,
      rawOutputCharacters,
      normalizedOutputCharacters,
      observedHanCharacters,
    });
  }
  return evidence;
}

function safeErrorChain(error: unknown) {
  const chain: object[] = [];
  const visited = new Set<object>();
  let candidate = error && typeof error === "object" ? error : null;
  for (let depth = 0; depth < 3 && candidate; depth += 1) {
    if (visited.has(candidate)) break;
    visited.add(candidate);
    chain.push(candidate);
    try {
      const cause = (candidate as { cause?: unknown }).cause;
      candidate = cause && typeof cause === "object" ? cause : null;
    } catch {
      candidate = null;
    }
  }
  return chain;
}

export function closedAgentFailureDiagnosticCodes(error: unknown) {
  const values: unknown[] = [];
  for (const candidate of safeErrorChain(error)) {
    try {
      const source = candidate as {
        qualityReasonCodes?: unknown;
        reasonCodes?: unknown;
        blockingCodes?: unknown;
        causeCode?: unknown;
      };
      if (Array.isArray(source.qualityReasonCodes)) values.push(...source.qualityReasonCodes);
      if (Array.isArray(source.reasonCodes)) values.push(...source.reasonCodes);
      if (Array.isArray(source.blockingCodes)) values.push(...source.blockingCodes);
      values.push(source.causeCode);
    } catch {
      // An accessor on an untrusted error object must not escape diagnostics.
    }
  }
  return [...new Set(values.filter(isClosedAgentFailureDiagnosticCode))]
    .sort()
    .slice(0, 12);
}

function safeClosedAgentFailureCode(error: unknown) {
  for (const candidate of safeErrorChain(error)) {
    try {
      const code = (candidate as { code?: unknown }).code;
      if (typeof code === "string" && CLOSED_AGENT_FAILURE_SAFE_CODE_SET.has(code)) {
        return code;
      }
    } catch {
      // Fall through to the finite generic failure code.
    }
  }
  return "CLOSED_AGENT_TASK_FAILED";
}

function runtimeEvidenceEntryIsValid(value: unknown): value is ClosedAgentBrowserRuntimeEvidence {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 6
    || !CLOSED_AGENT_BROWSER_RUNTIME_STAGES.has(
      candidate.stage as ClosedAgentBrowserRuntimeEvidence["stage"],
    )
    || !CLOSED_AGENT_BROWSER_RUNTIME_FINISH_REASONS.has(
      candidate.finishReason as ClosedAgentBrowserRuntimeEvidence["finishReason"],
    )
  ) return false;
  const metricsAreBounded = boundedRuntimeInteger(candidate.completionTokens, 4_096) !== undefined
    && boundedRuntimeInteger(candidate.rawOutputCharacters, 20_000) !== undefined
    && boundedRuntimeInteger(candidate.normalizedOutputCharacters, 20_000) !== undefined
    && boundedRuntimeInteger(candidate.observedHanCharacters, 10_000) !== undefined;
  return metricsAreBounded && (
    candidate.finishReason !== "unavailable"
    || (
      candidate.completionTokens === null
      && candidate.rawOutputCharacters === null
      && candidate.normalizedOutputCharacters === null
      && candidate.observedHanCharacters === null
    )
  );
}

export function isClosedAgentBrowserRuntimeEvidenceSequence(
  values: unknown,
): values is ClosedAgentBrowserRuntimeEvidence[] {
  if (!Array.isArray(values) || values.length > 3) return false;
  const stages = values.map((value) => (
    runtimeEvidenceEntryIsValid(value) ? value.stage : null
  ));
  if (stages.some((stage) => stage === null)) return false;
  if (stages.length === 0) return true;
  if (stages[0] !== "initial") return false;
  if (stages[1] !== undefined && stages[1] !== "repair") return false;
  return stages[2] === undefined
    || stages[2] === "extension"
    || stages[2] === "recovery";
}

function exactClosedAgentBrowserRuntimeEvidence(error: unknown): {
  valid: boolean;
  evidence: ClosedAgentBrowserRuntimeEvidence[];
} {
  if (!error || typeof error !== "object") return { valid: true, evidence: [] };
  const visited = new Set<object>();
  let candidateError: object | null = error;
  for (let depth = 0; depth < 3 && candidateError; depth += 1) {
    if (visited.has(candidateError)) break;
    visited.add(candidateError);
    try {
      const candidate = candidateError as {
        browserRuntimeEvidence?: unknown;
        cause?: unknown;
      };
      if ("browserRuntimeEvidence" in candidate) {
        const values = candidate.browserRuntimeEvidence;
        if (!isClosedAgentBrowserRuntimeEvidenceSequence(values)) {
          return { valid: false, evidence: [] };
        }
        return {
          valid: true,
          evidence: values.map((value) => ({ ...value })),
        };
      }
      candidateError = candidate.cause && typeof candidate.cause === "object"
        ? candidate.cause
        : null;
    } catch {
      return { valid: false, evidence: [] };
    }
  }
  return { valid: true, evidence: [] };
}

function normalizedFailureEvidence(value: unknown): ClosedAgentFailureEvidence | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 4
    || candidate.schemaVersion !== CLOSED_AGENT_FAILURE_EVIDENCE_SCHEMA_VERSION
    || typeof candidate.safeCode !== "string"
    || !CLOSED_AGENT_FAILURE_SAFE_CODE_SET.has(candidate.safeCode)
    || !Array.isArray(candidate.diagnosticCodes)
    || !isClosedAgentBrowserRuntimeEvidenceSequence(candidate.browserRuntimeEvidence)
  ) return null;
  const diagnosticCodes = candidate.diagnosticCodes as unknown[];
  if (
    diagnosticCodes.length > 12
    || diagnosticCodes.some((code) => !isClosedAgentFailureDiagnosticCode(code))
    || new Set(diagnosticCodes).size !== diagnosticCodes.length
    || [...diagnosticCodes].sort().some((code, index) => code !== diagnosticCodes[index])
  ) return null;
  return {
    schemaVersion: CLOSED_AGENT_FAILURE_EVIDENCE_SCHEMA_VERSION,
    safeCode: candidate.safeCode,
    diagnosticCodes: [...diagnosticCodes] as string[],
    browserRuntimeEvidence: (candidate.browserRuntimeEvidence as ClosedAgentBrowserRuntimeEvidence[])
      .map((evidence) => ({ ...evidence })),
  };
}

export function createClosedAgentFailureEvidence(error: unknown): ClosedAgentFailureEvidence {
  const runtimeEvidence = exactClosedAgentBrowserRuntimeEvidence(error);
  return {
    schemaVersion: CLOSED_AGENT_FAILURE_EVIDENCE_SCHEMA_VERSION,
    safeCode: runtimeEvidence.valid
      ? safeClosedAgentFailureCode(error)
      : "CLOSED_AGENT_FAILURE_EVIDENCE_INVALID",
    diagnosticCodes: closedAgentFailureDiagnosticCodes(error),
    browserRuntimeEvidence: runtimeEvidence.evidence,
  };
}

export function serializeClosedAgentFailureEvidence(
  evidence: ClosedAgentFailureEvidence,
) {
  const normalized = normalizedFailureEvidence(evidence);
  return normalized ? JSON.stringify(normalized) : "";
}

export function parseClosedAgentFailureEvidence(
  value: unknown,
): ClosedAgentFailureEvidence | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) return null;
  try {
    const normalized = normalizedFailureEvidence(JSON.parse(value));
    if (!normalized) return null;
    return JSON.stringify(normalized) === value ? normalized : null;
  } catch {
    return null;
  }
}

export function selectClosedAgentFailureEvidenceInvocation<T extends {
  id: string;
  messageId: string;
  taskId: string;
  toolId: string;
  status: string;
  updatedAt: string;
  revision: number;
  safeProgress: { stage: string; percent: number | null; message: string } | null;
}>(invocations: readonly T[], messageId: string): {
  invocation: T;
  evidence: ClosedAgentFailureEvidence;
} | null {
  const matches = invocations.flatMap((invocation) => {
    if (
      invocation.messageId !== messageId
      || invocation.toolId !== "closed-agent-os:conversation-plan"
      || invocation.status !== "failed"
      || invocation.safeProgress?.stage !== CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE
      || invocation.safeProgress.percent !== 100
    ) return [];
    const evidence = parseClosedAgentFailureEvidence(invocation.safeProgress.message);
    return evidence ? [{ invocation, evidence }] : [];
  });
  return matches.sort((left, right) => (
    right.invocation.updatedAt.localeCompare(left.invocation.updatedAt)
    || right.invocation.revision - left.invocation.revision
    || right.invocation.id.localeCompare(left.invocation.id)
  ))[0] ?? null;
}

function runtimeEvidenceValue(value: number | null) {
  return value === null ? "u" : String(value);
}

export function closedAgentBrowserRuntimeEvidenceProgress(error: unknown) {
  return closedAgentBrowserRuntimeEvidence(error)
    .map((value) => [
      "BROWSER_RUNTIME_EVIDENCE",
      value.stage,
      value.finishReason,
      runtimeEvidenceValue(value.completionTokens),
      runtimeEvidenceValue(value.rawOutputCharacters),
      runtimeEvidenceValue(value.normalizedOutputCharacters),
      runtimeEvidenceValue(value.observedHanCharacters),
    ].join(":"))
    .join(" ");
}
