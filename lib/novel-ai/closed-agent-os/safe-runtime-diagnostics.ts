export const CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODES = Object.freeze([
  "BROWSER_AI_MANDATORY_PROMPT_CONTRACT_MISSING",
  "BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED",
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

const CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODE_SET = new Set<string>(
  CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODES,
);

export function isClosedAgentBrowserRuntimeDiagnosticCode(value: unknown): value is string {
  return typeof value === "string"
    && CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODE_SET.has(value);
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
