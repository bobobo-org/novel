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
  const sourceText = sources.map((source) => `章節 ${source.chapterId}:\n${source.text}`).join("\n\n");
  const base = `只輸出 JSON。schemaVersion 必須是 ${LOCAL_QUALITY_SCHEMA_VERSION}。每個 explicit 事實必須引用原文中完全相同的 evidenceSpans；不知道就輸出 unknown 與 null。\n\n${sourceText}`;
  if (strategy === "evidence_only_extraction") return `${base}\n\n第二次修復：只抽取有逐字證據的明確事實。沒有精確引文的欄位不要輸出。`;
  if (strategy === "constrained_field_by_field_extraction") return `${base}\n\n第三次修復：逐欄檢查，只允許 age、location、identity、lifeStatus；每筆先找到原文位置，再輸出事實。`;
  return `${base}\n\n抽取角色的明確事實，格式為 {"schemaVersion":"${LOCAL_QUALITY_SCHEMA_VERSION}","facts":[]}.`;
}

export async function runLocalExtractionWithRetry(input: LocalExtractionRuntimeInput): Promise<LocalExtractionRuntimeResult> {
  if (!input.logicalRequestId || !input.modelId || !input.sourceRevision || input.sources.length === 0) {
    throw runtimeError(SYSTEM_VALIDATION_FAILURE, "Local extraction input is incomplete.");
  }
  const sourceText = input.sources.map((source) => `${source.chapterId}\u0000${source.text}`).join("\u0001");
  const fingerprint = buildExtractionFingerprint({ sourceRevision: input.sourceRevision, taskType: input.taskType, modelId: input.modelId, schemaVersion: LOCAL_QUALITY_SCHEMA_VERSION, sourceText });
  const startedAt = Date.now();
  const attempts: LocalExtractionAttempt[] = [];
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
      try {
        const raw = await input.executeAttempt({
          attempt: strategy.attempt,
          attemptId,
          strategy: strategy.strategy,
          prompt: `${promptForStrategy(strategy.strategy, input.sources)}\n\n每筆 fact 必須且只能包含 entityId、field、value、factType、evidenceSpans、sourceChapterIds、confidence、validatorStatus、modelId、requestId、schemaVersion。evidenceSpans 必須含 sourceChapterId、start、end、text。modelId 固定為 ${JSON.stringify(input.modelId)}，requestId 固定為 ${JSON.stringify(attemptId)}，validatorStatus 使用 pending。`,
          systemInstruction: "Return strict JSON only. Do not invent facts or quotations.",
          modelId: input.modelId,
          signal: chainAbort.signal,
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
        attempts.push({ attempt: strategy.attempt, attemptId, strategy: strategy.strategy, elapsedMs: Date.now() - attemptStartedAt, status: "rejected", errorCode: code || MODEL_QUALITY_INSUFFICIENT, schemaValid: false });
      }
    }
    throw runtimeError(LOCAL_EXTRACTION_RETRY_EXHAUSTED, "All three local extraction strategies were rejected.", { attempts, fingerprint });
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", relayAbort);
  }
}
