import {
  LOCAL_EVIDENCE_RESOLVER_VERSION,
  LOCAL_MODEL_OUTPUT_UNRELIABLE,
  LOCAL_QUALITY_SCHEMA_VERSION,
  LOCAL_RULE_ENGINE_VERSION,
  LOCAL_VALIDATION_VERSION,
  MODEL_QUALITY_INSUFFICIENT,
  SYSTEM_VALIDATION_FAILURE,
  buildExtractionFingerprint,
  buildRejectionAudit,
  deterministicExtract,
  parseAndValidateModelExtraction,
  retryStrategies,
  safelyRepairModelExtraction,
  type ExtractedFact,
  type SourceDocument,
} from "./local-quality-guard";

export const LOCAL_EXTRACTION_RETRY_EXHAUSTED = "LOCAL_EXTRACTION_RETRY_EXHAUSTED";
export const LOCAL_EXTRACTION_CANCELLED = "LOCAL_EXTRACTION_CANCELLED";
export const LOCAL_EXTRACTION_TOTAL_TIMEOUT = "LOCAL_EXTRACTION_TOTAL_TIMEOUT";
export const LOCAL_EXTRACTION_SOURCE_CHANGED = "LOCAL_EXTRACTION_SOURCE_CHANGED";
export const LOCAL_MODEL_INSUFFICIENT_FOR_TASK = "LOCAL_MODEL_INSUFFICIENT_FOR_TASK";
const LOCAL_EXTRACTION_ATTEMPT_TIMEOUT = "LOCAL_EXTRACTION_ATTEMPT_TIMEOUT";

export type LocalExtractionAttempt = {
  attempt: number;
  attemptId: string;
  strategy: (typeof retryStrategies)[number]["strategy"];
  elapsedMs: number;
  status: "accepted" | "rejected" | "cancelled" | "timeout" | "system_failure";
  errorCode: string | null;
  schemaValid: boolean;
};

export type LocalExtractionRuntimeInput = {
  logicalRequestId: string;
  taskType: "character.extract";
  modelId: string;
  sourceRevision: string;
  sources: SourceDocument[];
  totalTimeoutMs: number;
  signal?: AbortSignal;
  getCurrentSourceRevision: () => string | Promise<string>;
  executeAttempt: (input: {
    attempt: number;
    attemptId: string;
    strategy: (typeof retryStrategies)[number]["strategy"];
    prompt: string;
    systemInstruction: string;
    modelId: string;
    signal: AbortSignal;
    timeoutMs: number;
    maxOutputTokens: number;
  }) => Promise<string>;
};

export type LocalExtractionRuntimeResult = {
  logicalRequestId: string;
  fingerprint: string;
  modelId: string;
  sourceRevision: string;
  facts: ExtractedFact[];
  attempts: LocalExtractionAttempt[];
  versions: {
    schemaVersion: string;
    validationVersion: string;
    ruleVersion: string;
    evidenceResolverVersion: string;
  };
};

function runtimeError(code: string, message: string, details: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function promptForStrategy(strategy: LocalExtractionAttempt["strategy"], sources: SourceDocument[]) {
  const sourceText = sources.map((source) => `[${source.chapterId}] ${source.text}`).join("\n");
  const hints = deterministicExtract(sources, "deterministic-guard", "deterministic-hint").slice(0, 3).map((fact) => ({
    entityId: fact.entityId,
    field: fact.field,
    value: fact.value,
    evidenceText: fact.evidenceSpans[0]?.text || "",
  }));
  const shape = `{"schemaVersion":"${LOCAL_QUALITY_SCHEMA_VERSION}","facts":[{"entityId":"character:name","field":"age","value":28,"evidenceText":"exact source text","confidence":0.99}]}`;
  const base = `Return JSON only. Maximum 3 explicit facts. Copy evidenceText exactly from SOURCE. Do not infer missing facts. Shape: ${shape}\nSOURCE:\n${sourceText}`;
  if (strategy === "evidence_only_extraction") return `${base}\nOnly return facts with an exact quotation. Otherwise return an empty facts array.`;
  if (strategy === "constrained_field_by_field_extraction") return `${base}\nOnly inspect age, location, identity, and lifeStatus. Guard hints: ${JSON.stringify(hints)}`;
  return `${base}\nDeterministic guard hints are possible facts, not authority: ${JSON.stringify(hints)}`;
}

export function extractionAttemptBudget(totalTimeoutMs: number) {
  if (totalTimeoutMs >= 100_000) return { attemptTimeoutMs: [35_000, 25_000, 25_000] as const, validationReserveMs: 15_000 };
  const safeTotal = Math.max(1_000, totalTimeoutMs);
  const reserve = Math.min(10_000, Math.max(500, Math.floor(safeTotal / 6)));
  const available = Math.max(300, safeTotal - reserve);
  const first = Math.floor(available * 0.5);
  const second = Math.floor(available * 0.3);
  return { attemptTimeoutMs: [first, second, Math.max(100, available - first - second)] as const, validationReserveMs: reserve };
}

export async function runLocalExtractionWithRetry(input: LocalExtractionRuntimeInput): Promise<LocalExtractionRuntimeResult> {
  if (!input.logicalRequestId || !input.modelId || !input.sourceRevision || input.sources.length === 0) {
    throw runtimeError(SYSTEM_VALIDATION_FAILURE, "Local extraction input is incomplete.");
  }
  const sourceText = input.sources.map((source) => `${source.chapterId}\u0000${source.text}`).join("\u0001");
  const fingerprint = buildExtractionFingerprint({ sourceRevision: input.sourceRevision, taskType: input.taskType, modelId: input.modelId, schemaVersion: LOCAL_QUALITY_SCHEMA_VERSION, sourceText });
  const startedAt = Date.now();
  const attempts: LocalExtractionAttempt[] = [];
  const budget = extractionAttemptBudget(input.totalTimeoutMs);
  const chainAbort = new AbortController();
  const relayAbort = () => chainAbort.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", relayAbort, { once: true });
  const timer = setTimeout(() => chainAbort.abort(LOCAL_EXTRACTION_TOTAL_TIMEOUT), input.totalTimeoutMs);
  try {
    for (const strategy of retryStrategies) {
      if (chainAbort.signal.aborted) {
        const timedOut = Date.now() - startedAt >= input.totalTimeoutMs || chainAbort.signal.reason === LOCAL_EXTRACTION_TOTAL_TIMEOUT;
        throw runtimeError(timedOut ? LOCAL_EXTRACTION_TOTAL_TIMEOUT : LOCAL_EXTRACTION_CANCELLED, timedOut ? "Local extraction exceeded its total timeout." : "Local extraction was cancelled.", { attempts });
      }
      if (await input.getCurrentSourceRevision() !== input.sourceRevision) throw runtimeError(LOCAL_EXTRACTION_SOURCE_CHANGED, "The source changed during extraction.", { attempts });
      const attemptStartedAt = Date.now();
      const attemptId = `${input.logicalRequestId}:attempt-${strategy.attempt}`;
      const attemptController = new AbortController();
      const relayChainAbort = () => attemptController.abort(chainAbort.signal.reason);
      chainAbort.signal.addEventListener("abort", relayChainAbort, { once: true });
      const attemptTimeoutMs = budget.attemptTimeoutMs[strategy.attempt - 1];
      const attemptTimer = setTimeout(() => attemptController.abort(LOCAL_EXTRACTION_ATTEMPT_TIMEOUT), attemptTimeoutMs);
      try {
        const raw = await input.executeAttempt({
          attempt: strategy.attempt,
          attemptId,
          strategy: strategy.strategy,
          prompt: promptForStrategy(strategy.strategy, input.sources),
          systemInstruction: "Return strict compact JSON only. Never invent a value or quotation.",
          modelId: input.modelId,
          signal: attemptController.signal,
          timeoutMs: attemptTimeoutMs,
          maxOutputTokens: strategy.attempt === 1 ? 128 : strategy.attempt === 2 ? 96 : 64,
        });
        if (await input.getCurrentSourceRevision() !== input.sourceRevision) throw runtimeError(LOCAL_EXTRACTION_SOURCE_CHANGED, "The source changed during extraction.");
        let validation = parseAndValidateModelExtraction(raw, input.sources);
        if (validation.status === "reject") {
          const repaired = safelyRepairModelExtraction(raw, input.sources, input.modelId, attemptId);
          if (repaired) validation = parseAndValidateModelExtraction(repaired, input.sources);
        }
        if (validation.status === "accept") {
          attempts.push({ attempt: strategy.attempt, attemptId, strategy: strategy.strategy, elapsedMs: Date.now() - attemptStartedAt, status: "accepted", errorCode: null, schemaValid: validation.schemaValid });
          return { logicalRequestId: input.logicalRequestId, fingerprint, modelId: input.modelId, sourceRevision: input.sourceRevision, facts: validation.validated, attempts, versions: { schemaVersion: LOCAL_QUALITY_SCHEMA_VERSION, validationVersion: LOCAL_VALIDATION_VERSION, ruleVersion: LOCAL_RULE_ENGINE_VERSION, evidenceResolverVersion: LOCAL_EVIDENCE_RESOLVER_VERSION } };
        }
        attempts.push({ attempt: strategy.attempt, attemptId, strategy: strategy.strategy, elapsedMs: Date.now() - attemptStartedAt, status: "rejected", errorCode: LOCAL_MODEL_OUTPUT_UNRELIABLE, schemaValid: validation.schemaValid });
        buildRejectionAudit({ requestId: attemptId, modelId: input.modelId, taskType: input.taskType, rejectionReason: LOCAL_MODEL_OUTPUT_UNRELIABLE, retryAttempt: strategy.attempt });
      } catch (error) {
        const code = String((error as { code?: string })?.code || "");
        if (code === LOCAL_EXTRACTION_SOURCE_CHANGED || code === SYSTEM_VALIDATION_FAILURE) throw error;
        if ((error as { retryable?: boolean })?.retryable === false) throw error;
        if (chainAbort.signal.aborted) {
          const timedOut = Date.now() - startedAt >= input.totalTimeoutMs || chainAbort.signal.reason === LOCAL_EXTRACTION_TOTAL_TIMEOUT;
          attempts.push({ attempt: strategy.attempt, attemptId, strategy: strategy.strategy, elapsedMs: Date.now() - attemptStartedAt, status: timedOut ? "timeout" : "cancelled", errorCode: timedOut ? LOCAL_EXTRACTION_TOTAL_TIMEOUT : LOCAL_EXTRACTION_CANCELLED, schemaValid: false });
          throw runtimeError(timedOut ? LOCAL_EXTRACTION_TOTAL_TIMEOUT : LOCAL_EXTRACTION_CANCELLED, timedOut ? "Local extraction exceeded its total timeout." : "Local extraction was cancelled.", { attempts });
        }
        const attemptTimedOut = attemptController.signal.reason === LOCAL_EXTRACTION_ATTEMPT_TIMEOUT;
        attempts.push({ attempt: strategy.attempt, attemptId, strategy: strategy.strategy, elapsedMs: Date.now() - attemptStartedAt, status: attemptTimedOut ? "timeout" : "rejected", errorCode: attemptTimedOut ? LOCAL_EXTRACTION_ATTEMPT_TIMEOUT : code || MODEL_QUALITY_INSUFFICIENT, schemaValid: false });
      } finally {
        clearTimeout(attemptTimer);
        chainAbort.signal.removeEventListener("abort", relayChainAbort);
      }
    }
    throw runtimeError(LOCAL_MODEL_INSUFFICIENT_FOR_TASK, "The selected local model could not produce a validated Story Bible candidate within the bounded retry plan.", { attempts, fingerprint, suggestedAction: "Use a stronger local model or a future Private Hub runtime." });
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", relayAbort);
  }
}
