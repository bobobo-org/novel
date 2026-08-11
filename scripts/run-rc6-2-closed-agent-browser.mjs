import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

Error.stackTraceLimit = 0;

const mode = process.argv[2] ?? "generation";
if (!new Set(["setup", "generation", "all"]).has(mode)) {
  throw new Error("RC6_2_CLOSED_AI_UNKNOWN_MODE");
}

const configuredOrigin = process.env.RC6_2_CLOSED_AI_BASE_URL?.trim();
if (!configuredOrigin) {
  throw new Error("RC6_2_CLOSED_AI_BASE_URL_REQUIRED");
}
let parsedOrigin;
try {
  parsedOrigin = new URL(configuredOrigin);
} catch {
  throw new Error("RC6_2_CLOSED_AI_BASE_URL_INVALID");
}
const expectedOrigin = parsedOrigin.origin;
if (
  parsedOrigin.protocol !== "https:"
  && process.env.RC6_2_CLOSED_AI_ALLOW_HTTP_LOCAL !== "1"
) {
  throw new Error("RC6_2_CLOSED_AI_EXACT_HTTPS_ORIGIN_REQUIRED");
}

const expectedCommit = process.env.EXPECTED_COMMIT?.trim();
if (!expectedCommit || !/^[a-f0-9]{40}$/u.test(expectedCommit)) {
  throw new Error("EXPECTED_COMMIT_REQUIRED");
}
const expectedDeploymentId = process.env.EXPECTED_DEPLOYMENT_ID?.trim();
if (!expectedDeploymentId) {
  throw new Error("EXPECTED_DEPLOYMENT_ID_REQUIRED");
}
const configuredEdgeExecutable = process.env.RC6_2_CLOSED_AI_EDGE_EXECUTABLE?.trim();
if (!configuredEdgeExecutable) {
  throw new Error("RC6_2_CLOSED_AI_EDGE_EXECUTABLE_REQUIRED");
}

const setupTimeoutMs = Number(process.env.RC6_2_CLOSED_AI_SETUP_TIMEOUT_MS ?? 1_800_000);
const generationTimeoutMs = Number(process.env.RC6_2_CLOSED_AI_GENERATION_TIMEOUT_MS ?? 1_200_000);
const headless = process.env.RC6_2_CLOSED_AI_HEADLESS !== "0";
const modelRequests = [];
const prohibitedExternalAiRequests = [];
const disallowedCrossOriginRequests = [];
const sensitiveEvidenceSentinels = new Set();
const finalContextFragmentVariants = new Map();
let requestPhase = "bootstrap";
let browser;
let context;
let page;
let profilePath;
let edgeExecutablePath;
let edgeCdpSession;
let authoritativeFailureEvidence = null;
let finalOutput = null;

const FAILURE_EVIDENCE_SCHEMA_VERSION = "closed-agent-failure-evidence-v1";

const SAFE_DIAGNOSTIC_CODES = Object.freeze([
  "CLOSED_AGENT_TRADITIONAL_CHINESE_POLICY_INVALID",
  "CLOSED_AGENT_TRADITIONAL_CHINESE_INTEGRITY_INVALID",
  "CLOSED_AGENT_PROVIDER_NORMALIZATION_NOT_DEFERRED",
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
  "CANDIDATE_TRADITIONAL_CHINESE_INTEGRITY_INVALID",
  "CANDIDATE_SIMPLIFIED_CHINESE_REMAINS",
  "CANDIDATE_PROPER_NOUN_DRIFT",
  "CANDIDATE_ONLY_CONTRACT_MISSING",
  "CANDIDATE_DEVICE_BOUNDARY_VIOLATION",
  "ABC_CHOICES_INVALID_STRUCTURE",
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
]);
const SAFE_DIAGNOSTIC_CODE_SET = new Set(SAFE_DIAGNOSTIC_CODES);
const SAFE_RUNTIME_STAGES = Object.freeze(["initial", "repair", "extension", "recovery"]);
const SAFE_RUNTIME_FINISH_REASONS = Object.freeze([
  "stop",
  "length",
  "tool_calls",
  "abort",
  "unavailable",
]);
const SAFE_RUNTIME_STAGE_SET = new Set(SAFE_RUNTIME_STAGES);
const SAFE_RUNTIME_FINISH_REASON_SET = new Set(SAFE_RUNTIME_FINISH_REASONS);
const PERSISTED_FAILURE_SAFE_CODES = Object.freeze([
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
]);
const PERSISTED_FAILURE_SAFE_CODE_SET = new Set(PERSISTED_FAILURE_SAFE_CODES);
const SAFE_FAILURE_CODES = new Set([
  "RC6_2_CLOSED_AI_GATE_FAILED",
  "RC6_2_CLOSED_AI_SETUP_FAILED",
  "RC6_2_CLOSED_AI_SETUP_TIMEOUT",
  "RC6_2_CLOSED_AI_UI_BUSY_TIMEOUT",
  "RC6_2_CLOSED_AI_GENERATION_FAILED",
  "RC6_2_CLOSED_AI_GENERATION_TIMEOUT",
  ...PERSISTED_FAILURE_SAFE_CODES,
]);

function sanitizeDiagnosticCodes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(
    (value) => typeof value === "string" && SAFE_DIAGNOSTIC_CODE_SET.has(value),
  ))].sort().slice(0, 12);
}

function sanitizeRuntimeInteger(value, maximum) {
  return value === null
    || (
      typeof value === "number"
      && Number.isInteger(value)
      && value >= 0
      && value <= maximum
    )
    ? value
    : null;
}

function sanitizeBrowserRuntimeEvidence(values) {
  if (!Array.isArray(values) || values.length > 3) return [];
  const sanitized = values.flatMap((value) => {
    if (
      !value
      || typeof value !== "object"
      || !SAFE_RUNTIME_STAGE_SET.has(value.stage)
      || !SAFE_RUNTIME_FINISH_REASON_SET.has(value.finishReason)
      || Object.keys(value).length !== 6
    ) return [];
    const completionTokens = sanitizeRuntimeInteger(value.completionTokens, 4_096);
    const rawOutputCharacters = sanitizeRuntimeInteger(value.rawOutputCharacters, 20_000);
    const normalizedOutputCharacters = sanitizeRuntimeInteger(
      value.normalizedOutputCharacters,
      20_000,
    );
    const observedHanCharacters = sanitizeRuntimeInteger(
      value.observedHanCharacters,
      10_000,
    );
    if (
      value.completionTokens !== completionTokens
      || value.rawOutputCharacters !== rawOutputCharacters
      || value.normalizedOutputCharacters !== normalizedOutputCharacters
      || value.observedHanCharacters !== observedHanCharacters
      || (
        value.finishReason === "unavailable"
        && [
          completionTokens,
          rawOutputCharacters,
          normalizedOutputCharacters,
          observedHanCharacters,
        ].some((metric) => metric !== null)
      )
    ) return [];
    return [{
      stage: value.stage,
      finishReason: value.finishReason,
      completionTokens,
      rawOutputCharacters,
      normalizedOutputCharacters,
      observedHanCharacters,
    }];
  });
  if (sanitized.length !== values.length) return [];
  const stages = sanitized.map((value) => value.stage);
  if (
    (stages.length > 0 && stages[0] !== "initial")
    || (stages[1] !== undefined && stages[1] !== "repair")
    || (stages[2] !== undefined && !["extension", "recovery"].includes(stages[2]))
  ) return [];
  return sanitized;
}

function parsePersistedFailureEvidence(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) return null;
  try {
    const parsed = JSON.parse(value);
    if (
      !parsed
      || typeof parsed !== "object"
      || Object.keys(parsed).length !== 4
      || parsed.schemaVersion !== FAILURE_EVIDENCE_SCHEMA_VERSION
      || !PERSISTED_FAILURE_SAFE_CODE_SET.has(parsed.safeCode)
      || !Array.isArray(parsed.diagnosticCodes)
      || parsed.diagnosticCodes.length > 12
      || parsed.diagnosticCodes.some((code) => (
        typeof code !== "string" || !SAFE_DIAGNOSTIC_CODE_SET.has(code)
      ))
      || new Set(parsed.diagnosticCodes).size !== parsed.diagnosticCodes.length
      || [...parsed.diagnosticCodes].sort().some((code, index) => (
        code !== parsed.diagnosticCodes[index]
      ))
      || !Array.isArray(parsed.browserRuntimeEvidence)
    ) return null;
    const browserRuntimeEvidence = sanitizeBrowserRuntimeEvidence(
      parsed.browserRuntimeEvidence,
    );
    if (browserRuntimeEvidence.length !== parsed.browserRuntimeEvidence.length) return null;
    const normalized = {
      schemaVersion: FAILURE_EVIDENCE_SCHEMA_VERSION,
      safeCode: parsed.safeCode,
      diagnosticCodes: [...parsed.diagnosticCodes],
      browserRuntimeEvidence,
    };
    return JSON.stringify(normalized) === value ? normalized : null;
  } catch {
    return null;
  }
}

function gateError(code) {
  const safeCode = SAFE_FAILURE_CODES.has(code)
    ? code
    : "RC6_2_CLOSED_AI_GATE_FAILED";
  return Object.assign(new Error(safeCode), { code: safeCode });
}

function safeFailureCode(error) {
  if (error && typeof error === "object") {
    const code = error.code;
    if (code === "ERR_ASSERTION") return "RC6_2_CLOSED_AI_GATE_FAILED";
    if (typeof code === "string" && SAFE_FAILURE_CODES.has(code)) return code;
  }
  return "RC6_2_CLOSED_AI_GATE_FAILED";
}

function isModelPayload(urlValue) {
  const url = new URL(urlValue);
  return isApprovedImmutableModelSource(url)
    || isApprovedModelCdn(url);
}

function isApprovedImmutableModelSource(url) {
  if (url.protocol !== "https:") return false;
  if (url.hostname === "huggingface.co") {
    return url.pathname.startsWith(
      "/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad/",
    );
  }
  return url.hostname === "raw.githubusercontent.com"
    && url.pathname === [
      "/mlc-ai/binary-mlc-llm-libs",
      "025bcaf3780fa8254f5e5efd3bfea0a5397248f4",
      "web-llm-models/v0_2_84/base",
      "Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
    ].join("/");
}

function isApprovedModelCdn(url) {
  return url.protocol === "https:"
    && (
      /^cdn-lfs(?:-[a-z0-9]+)*\.(?:hf|huggingface)\.co$/u.test(url.hostname)
      || /^(?:cas-bridge|transfer)\.xethub\.hf\.co$/u.test(url.hostname)
    );
}

function rootRedirectRequest(request) {
  let current = request;
  while (current.redirectedFrom()) current = current.redirectedFrom();
  return current;
}

function isAllowedCrossOriginRequest(request) {
  const url = new URL(request.url());
  if (url.origin === expectedOrigin) return true;
  if (requestPhase !== "model-install") return false;
  if (isApprovedImmutableModelSource(url)) return true;
  return isApprovedModelCdn(url)
    && isApprovedImmutableModelSource(new URL(rootRedirectRequest(request).url()));
}

function safeCrossOriginProjection(urlValue) {
  const url = new URL(urlValue);
  return {
    phase: requestPhase,
    host: url.host,
    pathDigest: sha256Value(url.pathname),
  };
}

function isProhibitedExternalAi(urlValue) {
  const hostname = new URL(urlValue).hostname.toLowerCase();
  return [
    "api.openai.com",
    "api.x.ai",
    "api.groq.com",
    "generativelanguage.googleapis.com",
    "api.anthropic.com",
  ].some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
}

function sha256Value(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

const BROWSER_EXECUTION_RECEIPT_KEYS = Object.freeze([
  "actualExecutor",
  "browserGenerationUsed",
  "browserPrecomputeUsed",
  "candidateOnly",
  "canonicalMutationCount",
  "completedAt",
  "contextAttestation",
  "contextTokensAfter",
  "contextTokensBefore",
  "dataLeftDevice",
  "elapsedMs",
  "externalAIUsed",
  "finalModelContextAttestation",
  "localOllamaCallsAvoided",
  "localOllamaUsed",
  "modelDigest",
  "modelId",
  "outerRequestIdDigest",
  "plannedPipeline",
  "privateHubJobsAvoided",
  "privateHubUsed",
  "rawChainOfThoughtStored",
  "rawOutputStored",
  "rawPromptStored",
  "receiptId",
  "remoteModelCallsAvoided",
  "remoteModelInputTokensSaved",
  "remoteModelOutputRepairAvoided",
  "schemaVersion",
  "taskDigest",
  "taskType",
  "tokensSaved",
]);

const CLOSED_EXECUTION_RECEIPT_KEYS = Object.freeze([
  "actualExecutor",
  "backendId",
  "browserComputeReceiptId",
  "browserFabricPlannedGraph",
  "browserFabricReceiptId",
  "completedAt",
  "contentDigest",
  "contextAttestation",
  "contextDigest",
  "contextTokensAfter",
  "contextTokensBefore",
  "dataLeftDevice",
  "externalRequest",
  "finalModelContextAttestation",
  "generatedTokenEvents",
  "modelDigest",
  "modelId",
  "outputCharacters",
  "proofState",
  "startedAt",
  "taskId",
  "tokensSaved",
  "traditionalChineseNormalization",
]);

const FORBIDDEN_EVIDENCE_VALUE_KEYS = new Set([
  "content",
  "direction",
  "input",
  "messages",
  "objective",
  "output",
  "prompt",
  "serializedSource",
  "summary",
  "text",
]);

function assertSafeEvidenceProjection(value, path = "evidence") {
  if (typeof value === "string") {
    for (const sentinel of sensitiveEvidenceSentinels) {
      assert.equal(
        value.includes(sentinel),
        false,
        `${path} exposed a raw Preview-prose sentinel`,
      );
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeEvidenceProjection(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert.equal(
      FORBIDDEN_EVIDENCE_VALUE_KEYS.has(key),
      false,
      `${path}.${key} is a raw-value evidence field`,
    );
    assertSafeEvidenceProjection(child, `${path}.${key}`);
  }
}

function registerSensitiveEvidenceSentinel(value) {
  const normalized = String(value ?? "").replace(/\r\n?/gu, "\n").trim();
  if (Array.from(normalized).length >= 8) sensitiveEvidenceSentinels.add(normalized);
}

function escapeFinalContextFragment(value) {
  return value
    .replace(/\r\n?/gu, "\n")
    .trim()
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function estimateBrowserTokensForEvidence(text) {
  const normalized = text.trim();
  if (!normalized) return 0;
  const cjk = (normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/gu) ?? []).length;
  const other = Math.max(0, normalized.length - cjk);
  return Math.max(1, Math.ceil(cjk * 1.08 + other / 3.6));
}

function fitBrowserSourceForEvidence(text, maxTokens) {
  const normalizedBudget = Math.max(0, Math.floor(maxTokens));
  if (estimateBrowserTokensForEvidence(text) <= normalizedBudget) return text;
  const units = Array.from(text);
  const marker = "\n[…已壓縮…]\n";
  let low = 0;
  let high = units.length;
  let best = "";
  while (low <= high) {
    const sourceUnits = Math.floor((low + high) / 2);
    const headUnits = Math.floor(sourceUnits * 0.36);
    const tailUnits = sourceUnits - headUnits;
    const candidate = sourceUnits === 0
      ? ""
      : `${units.slice(0, headUnits).join("")}${marker}${units.slice(-tailUnits).join("")}`;
    if (estimateBrowserTokensForEvidence(candidate) <= normalizedBudget) {
      best = candidate;
      low = sourceUnits + 1;
    } else {
      high = sourceUnits - 1;
    }
  }
  if (!best && normalizedBudget > 0) {
    const prefix = [];
    for (const unit of units) {
      const candidate = `${prefix.join("")}${unit}`;
      if (estimateBrowserTokensForEvidence(candidate) > normalizedBudget) break;
      prefix.push(unit);
    }
    best = prefix.join("");
  }
  return best;
}

function possibleFinalContextFragments(source) {
  const cached = finalContextFragmentVariants.get(source.originalDigest);
  if (cached) return cached;
  const fittedSources = new Set([source.serializedSource]);
  for (let budget = 1; budget <= 4_096; budget += 1) {
    const fitted = fitBrowserSourceForEvidence(source.serializedSource, budget);
    if (fitted) fittedSources.add(fitted);
  }
  const fragments = [...fittedSources].map((serializedSource) => escapeFinalContextFragment(
    `[${source.outerKind}]\n${serializedSource}`,
  ));
  finalContextFragmentVariants.set(source.originalDigest, fragments);
  return fragments;
}

function assertSubstantiveSurvivingPrefix(binding, source) {
  assert.equal(binding.originalDigest, source.originalDigest);
  assert.equal(source.originalDigest, sha256Value(
    source.serializedSource.replace(/\r\n?/gu, "\n").trim(),
  ));
  const substantivePrefix = escapeFinalContextFragment(source.substantivePrefix);
  assert.ok(
    binding.survivingFragmentCharacters >= Array.from(substantivePrefix).length,
    `${source.sourceKind} did not retain its substantive serialized prefix`,
  );
  const matches = possibleFinalContextFragments(source).filter((fragment) => {
    const characters = Array.from(fragment);
    if (binding.survivingFragmentCharacters > characters.length) return false;
    const surviving = characters.slice(0, binding.survivingFragmentCharacters).join("");
    return surviving.startsWith(substantivePrefix)
      && sha256Value(surviving) === binding.survivingFragmentDigest
      && Buffer.byteLength(surviving, "utf8") === binding.survivingFragmentUtf8Bytes;
  });
  assert.ok(matches.length >= 1, `${source.sourceKind} surviving prefix digest was not reproducible`);
}

function finalContextSourceMetadataDigest(input) {
  return sha256Value(stableStringify({
    domain: "browser-final-context-source-metadata-v3",
    sourceKind: input.sourceKind,
    authority: input.authority,
    sourceArtifactDigest: input.sourceArtifactDigest,
    sourceRevisionDigest: input.sourceRevisionDigest,
  }));
}

function finalContextSourceIdDigest(sourceId, sourceKind) {
  return sha256Value(stableStringify({
    domain: "browser-final-context-source-id-v3",
    sourceId,
    sourceKind,
  }));
}

const FINAL_CONTEXT_DIGEST = /^[a-f0-9]{64}$/u;
const FINAL_CONTEXT_STAGES = new Set(["initial", "repair", "extension", "recovery"]);
const FINAL_CONTEXT_QUALITY_PHASES = new Set(["draft", "critic", "revision"]);
const FINAL_CONTEXT_QUALITY_MODES = new Set(["fast", "balanced", "deep"]);

function finalContextInnerIndex(stage) {
  return stage === "initial" ? 0 : stage === "repair" ? 1 : 2;
}

function expectedClosedQualityPassIdentity(evidence, qualityPhase) {
  const qualityMode = evidence.candidate.qualityMode;
  const qualityPasses = evidence.candidate.qualityPasses;
  assert.equal(FINAL_CONTEXT_QUALITY_MODES.has(qualityMode), true);
  assert.equal(FINAL_CONTEXT_QUALITY_PHASES.has(qualityPhase), true);
  assert.equal(qualityPhase, qualityMode === "fast" ? "draft" : "revision");
  assert.equal(
    qualityPasses,
    qualityMode === "fast" ? 1 : qualityMode === "balanced" ? 2 : 3,
  );
  const passIndex = qualityPhase === "draft"
    ? 0
    : qualityPhase === "critic"
      ? 1
      : qualityMode === "deep"
        ? 2
        : 1;
  if (qualityPhase === "critic") assert.equal(qualityMode, "deep");
  if (qualityPhase === "revision") assert.notEqual(qualityMode, "fast");
  assert.ok(passIndex < qualityPasses);
  const passDigest = sha256Value(
    `${evidence.candidate.taskId}|${qualityPhase}|${passIndex}`,
  );
  const outerRequestId =
    `${evidence.candidate.taskId}:quality:${qualityPhase}:${passDigest.slice(0, 32)}`;
  return {
    outerRequestId,
    outerRequestIdDigest: sha256Value(outerRequestId),
    taskDigest: sha256Value(`${evidence.projectId}:${outerRequestId}`),
  };
}

function expectedInnerRequestIdDigest(passIdentity, innerStage) {
  const suffix = {
    initial: "",
    repair: ":bounded-same-model-repair",
    extension: ":bounded-prose-extension",
    recovery: ":bounded-fresh-recovery",
  }[innerStage];
  assert.notEqual(suffix, undefined);
  return sha256Value(`${passIdentity.outerRequestId}${suffix}`);
}

function hasExactKeys(value, keys) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(","),
  );
}

function safeInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function sanitizeFinalContextInvocationProof(value) {
  const proofKeys = [
    "bindingDigest",
    "callOptionsDigest",
    "contextBindings",
    "digestSuite",
    "innerIndex",
    "innerStage",
    "invocationRequestIdDigest",
    "messageDescriptors",
    "modelDigest",
    "modelId",
    "omittedCharacters",
    "outerQualityPhase",
    "outerRequestIdDigest",
    "outerTaskType",
    "rawTextStored",
    "requiredManifestDigest",
    "schemaVersion",
  ];
  if (
    !hasExactKeys(value, proofKeys)
    || value.schemaVersion !== "browser-final-model-context-proof-v3"
    || value.digestSuite !== "sha256-utf8-exact-v1"
    || value.rawTextStored !== false
    || !FINAL_CONTEXT_STAGES.has(value.innerStage)
    || !FINAL_CONTEXT_QUALITY_PHASES.has(value.outerQualityPhase)
    || !safeInteger(value.innerIndex, 0, 2)
    || value.innerIndex !== finalContextInnerIndex(value.innerStage)
    || !safeInteger(value.omittedCharacters, 0, 10_000_000)
    || !/^[A-Za-z][A-Za-z0-9.-]{1,80}$/u.test(value.outerTaskType ?? "")
    || typeof value.modelId !== "string"
    || !value.modelId.trim()
    || value.modelId.length > 192
    || !Array.isArray(value.messageDescriptors)
    || value.messageDescriptors.length !== 2
    || !Array.isArray(value.contextBindings)
    || value.contextBindings.length > 13
  ) return null;
  for (const digest of [
    value.outerRequestIdDigest,
    value.invocationRequestIdDigest,
    value.modelDigest,
    value.callOptionsDigest,
    value.requiredManifestDigest,
    value.bindingDigest,
  ]) if (!FINAL_CONTEXT_DIGEST.test(digest ?? "")) return null;

  const messageDescriptors = [];
  for (const [index, descriptor] of value.messageDescriptors.entries()) {
    if (
      !hasExactKeys(descriptor, ["characters", "digest", "index", "role", "utf8Bytes"])
      || descriptor.index !== index
      || descriptor.role !== (index === 0 ? "system" : "user")
      || !FINAL_CONTEXT_DIGEST.test(descriptor.digest ?? "")
      || !safeInteger(descriptor.utf8Bytes, 0, 100_000_000)
      || !safeInteger(descriptor.characters, 0, 100_000_000)
    ) return null;
    messageDescriptors.push({
      index: descriptor.index,
      role: descriptor.role,
      digest: descriptor.digest,
      utf8Bytes: descriptor.utf8Bytes,
      characters: descriptor.characters,
    });
  }

  const bindingKeys = [
    "authority",
    "coverage",
    "endUtf8Byte",
    "messageIndex",
    "ordinal",
    "originalDigest",
    "segmentIndex",
    "sourceArtifactDigest",
    "sourceIdDigest",
    "sourceKind",
    "sourceMetadataDigest",
    "sourceRevisionDigest",
    "startUtf8Byte",
    "survivingFragmentCharacters",
    "survivingFragmentDigest",
    "survivingFragmentUtf8Bytes",
  ];
  const contextBindings = [];
  const sourceIds = new Set();
  let previousEnd = 0;
  for (const [index, binding] of value.contextBindings.entries()) {
    const storyBible = binding?.sourceKind === "approved-story-bible"
      && binding.authority === "composer-repository-verified";
    const attachment = binding?.sourceKind === "selected-local-attachment-summary"
      && binding.authority === "user-selected-sanitized-untrusted-reference";
    if (
      !hasExactKeys(binding, bindingKeys)
      || (!storyBible && !attachment)
      || binding.ordinal !== index + 1
      || binding.messageIndex !== 1
      || binding.segmentIndex !== index
      || binding.coverage !== "fragment"
      || !safeInteger(binding.startUtf8Byte, 0, 100_000_000)
      || !safeInteger(binding.endUtf8Byte, 1, 100_000_000)
      || binding.endUtf8Byte <= binding.startUtf8Byte
      || binding.startUtf8Byte < previousEnd
      || binding.endUtf8Byte > messageDescriptors[1].utf8Bytes
      || !safeInteger(binding.survivingFragmentUtf8Bytes, 1, 100_000_000)
      || !safeInteger(binding.survivingFragmentCharacters, 1, 100_000_000)
      || binding.endUtf8Byte - binding.startUtf8Byte !== binding.survivingFragmentUtf8Bytes
      || binding.survivingFragmentCharacters > messageDescriptors[1].characters
      || binding.survivingFragmentUtf8Bytes < binding.survivingFragmentCharacters
      || binding.survivingFragmentUtf8Bytes > binding.survivingFragmentCharacters * 4
    ) return null;
    for (const digest of [
      binding.sourceIdDigest,
      binding.originalDigest,
      binding.sourceArtifactDigest,
      binding.sourceRevisionDigest,
      binding.sourceMetadataDigest,
      binding.survivingFragmentDigest,
    ]) if (!FINAL_CONTEXT_DIGEST.test(digest ?? "")) return null;
    if (sourceIds.has(binding.sourceIdDigest)) return null;
    sourceIds.add(binding.sourceIdDigest);
    const expectedMetadataDigest = finalContextSourceMetadataDigest(binding);
    if (binding.sourceMetadataDigest !== expectedMetadataDigest) return null;
    contextBindings.push(Object.fromEntries(bindingKeys.map((key) => [key, binding[key]])));
    previousEnd = binding.endUtf8Byte;
  }

  const expectations = contextBindings.map((binding) => ({
    ordinal: binding.ordinal,
    sourceIdDigest: binding.sourceIdDigest,
    sourceKind: binding.sourceKind,
    authority: binding.authority,
    originalDigest: binding.originalDigest,
    sourceArtifactDigest: binding.sourceArtifactDigest,
    sourceRevisionDigest: binding.sourceRevisionDigest,
    sourceMetadataDigest: binding.sourceMetadataDigest,
  }));
  const expectedManifestDigest = sha256Value(stableStringify({
    domain: "browser-final-context-required-manifest-v3",
    outerRequestIdDigest: value.outerRequestIdDigest,
    outerTaskType: value.outerTaskType,
    outerQualityPhase: value.outerQualityPhase,
    expectations,
  }));
  if (value.requiredManifestDigest !== expectedManifestDigest) return null;
  const body = {
    schemaVersion: value.schemaVersion,
    digestSuite: value.digestSuite,
    outerRequestIdDigest: value.outerRequestIdDigest,
    invocationRequestIdDigest: value.invocationRequestIdDigest,
    outerTaskType: value.outerTaskType,
    outerQualityPhase: value.outerQualityPhase,
    innerStage: value.innerStage,
    innerIndex: value.innerIndex,
    modelId: value.modelId,
    modelDigest: value.modelDigest,
    callOptionsDigest: value.callOptionsDigest,
    requiredManifestDigest: value.requiredManifestDigest,
    messageDescriptors,
    contextBindings,
    omittedCharacters: value.omittedCharacters,
    rawTextStored: false,
  };
  if (value.bindingDigest !== sha256Value(stableStringify({
    domain: "browser-final-model-context-invocation-proof-v3",
    body,
  }))) return null;
  return { ...body, bindingDigest: value.bindingDigest };
}

function sanitizeFinalModelContextAttestation(value) {
  const attestationKeys = [
    "acceptedDisposition",
    "acceptedStage",
    "bindingDigest",
    "contributingCalls",
    "executedStages",
    "extensionBaseStage",
    "outerQualityPhase",
    "outerRequestIdDigest",
    "outerTaskType",
    "rawTextStored",
    "requiredManifestDigest",
    "schemaVersion",
  ];
  if (
    !hasExactKeys(value, attestationKeys)
    || value.schemaVersion !== "browser-final-model-context-attestation-v3"
    || value.rawTextStored !== false
    || !FINAL_CONTEXT_DIGEST.test(value.bindingDigest ?? "")
    || !FINAL_CONTEXT_DIGEST.test(value.outerRequestIdDigest ?? "")
    || !FINAL_CONTEXT_DIGEST.test(value.requiredManifestDigest ?? "")
    || !FINAL_CONTEXT_QUALITY_PHASES.has(value.outerQualityPhase)
    || !/^[A-Za-z][A-Za-z0-9.-]{1,80}$/u.test(value.outerTaskType ?? "")
    || !Array.isArray(value.executedStages)
    || !Array.isArray(value.contributingCalls)
    || value.contributingCalls.length < 1
    || value.contributingCalls.length > 2
  ) return null;
  const executedStages = [...value.executedStages];
  if (
    executedStages.length < 1
    || executedStages.length > 3
    || executedStages[0] !== "initial"
    || (executedStages[1] !== undefined && executedStages[1] !== "repair")
    || (executedStages[2] !== undefined
      && executedStages[2] !== "extension"
      && executedStages[2] !== "recovery")
    || new Set(executedStages).size !== executedStages.length
  ) return null;
  const contributingCalls = value.contributingCalls.map(sanitizeFinalContextInvocationProof);
  if (contributingCalls.some((call) => !call)) return null;
  const [first] = contributingCalls;
  if (!contributingCalls.every((call) => (
    call.outerQualityPhase === first.outerQualityPhase
    && call.outerRequestIdDigest === first.outerRequestIdDigest
    && call.outerTaskType === first.outerTaskType
    && call.modelId === first.modelId
    && call.modelDigest === first.modelDigest
    && call.requiredManifestDigest === first.requiredManifestDigest
  ))) return null;
  if (new Set(contributingCalls.map((call) => call.invocationRequestIdDigest)).size
    !== contributingCalls.length) return null;
  if (!contributingCalls.every((call) => (
    call.innerIndex === finalContextInnerIndex(call.innerStage)
    && executedStages[call.innerIndex] === call.innerStage
  ))) return null;
  const standalone = value.acceptedDisposition === "standalone"
    && contributingCalls.length === 1
    && contributingCalls[0].innerStage === value.acceptedStage
    && value.acceptedStage !== "extension"
    && value.extensionBaseStage === null;
  const composedExtension = value.acceptedDisposition === "composed-extension"
    && value.acceptedStage === "extension"
    && new Set(["initial", "repair"]).has(value.extensionBaseStage)
    && contributingCalls.length === 2
    && contributingCalls[0].innerStage === value.extensionBaseStage
    && contributingCalls[1].innerStage === "extension";
  if (!standalone && !composedExtension) return null;
  if (
    value.outerQualityPhase !== first.outerQualityPhase
    || value.outerRequestIdDigest !== first.outerRequestIdDigest
    || value.outerTaskType !== first.outerTaskType
    || value.requiredManifestDigest !== first.requiredManifestDigest
  ) return null;
  const body = {
    schemaVersion: value.schemaVersion,
    acceptedDisposition: value.acceptedDisposition,
    acceptedStage: value.acceptedStage,
    extensionBaseStage: value.extensionBaseStage,
    executedStages,
    outerQualityPhase: value.outerQualityPhase,
    outerRequestIdDigest: value.outerRequestIdDigest,
    outerTaskType: value.outerTaskType,
    requiredManifestDigest: value.requiredManifestDigest,
    contributingCalls,
    rawTextStored: false,
  };
  if (value.bindingDigest !== sha256Value(stableStringify({
    domain: "browser-final-model-context-attestation-v3",
    body,
  }))) return null;
  return { ...body, bindingDigest: value.bindingDigest };
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

async function preparePersistentEdgeProfile() {
  const temporaryRoot = resolve(tmpdir());
  const created = await mkdtemp(join(temporaryRoot, "novel-rc6-2-edge-"));
  assert.equal(
    resolve(dirname(created)).toLocaleLowerCase("en-US"),
    temporaryRoot.toLocaleLowerCase("en-US"),
    "fresh Edge profile escaped the operating-system temporary directory",
  );
  assert.deepEqual(await readdir(created), [], "fresh Edge profile was not empty before launch");
  return created;
}

async function launch() {
  edgeExecutablePath = await realpath(configuredEdgeExecutable);
  const executableStat = await stat(edgeExecutablePath);
  assert.equal(executableStat.isFile(), true, "configured Edge executable is not a file");
  assert.equal(
    basename(edgeExecutablePath).toLocaleLowerCase("en-US"),
    "msedge.exe",
    "configured browser is not Microsoft Edge",
  );
  profilePath = await preparePersistentEdgeProfile();
  const launchOptions = {
    executablePath: edgeExecutablePath,
    headless,
    args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"],
    locale: "zh-TW",
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  };
  const persistentContext = await chromium.launchPersistentContext(profilePath, launchOptions);
  return {
    context: persistentContext,
    browser: persistentContext.browser(),
    evidence: {
      executableName: "msedge.exe",
      executableDigest: await sha256File(edgeExecutablePath),
      persistentContext: true,
      disposableProfile: true,
      profileEntryCountBeforeLaunch: 0,
      profilePathDigest: sha256Value(resolve(profilePath)),
    },
  };
}

async function assertExactOrigin() {
  assert.equal(new URL(page.url()).origin, expectedOrigin, "browser was redirected away from the exact gate origin");
}

function assertReleaseIdentityTruth(truth) {
  assert.equal(truth.httpStatus, 200);
  assert.match(truth.cacheControl ?? "", /no-store/u);
  assert.equal(truth.body.appCommit, expectedCommit);
  assert.equal(truth.body.releaseProductCommit, expectedCommit);
  assert.equal(truth.body.deploymentId, expectedDeploymentId);
  assert.equal(truth.body.provenanceStatus, "verified");
  assert.equal(truth.body.deploymentProvenance, "verified");
  assert.equal(truth.body.buildProvenanceStatus, "verified");
  for (const field of [
    "releaseTag",
    "releaseRevision",
    "releaseBuild",
    "environment",
    "provenanceSource",
  ]) {
    assert.ok(String(truth.body[field] ?? "").trim(), `release identity ${field} was empty`);
  }
  assert.notEqual(truth.body.releaseBuild, "provenance-unavailable");
  assert.equal(truth.headers.appCommit, truth.body.appCommit);
  assert.equal(truth.headers.releaseProductCommit, truth.body.releaseProductCommit);
  assert.equal(truth.headers.deploymentId, truth.body.deploymentId);
  assert.equal(truth.headers.releaseRevision, truth.body.releaseRevision);
  assert.equal(truth.headers.releaseBuild, truth.body.releaseBuild);
  assert.equal(truth.headers.deploymentProvenance, truth.body.deploymentProvenance);
}

function safeReleaseIdentity(truth) {
  return {
    appCommit: truth.body.appCommit,
    releaseProductCommit: truth.body.releaseProductCommit,
    deploymentId: truth.body.deploymentId,
    releaseTag: truth.body.releaseTag,
    releaseRevision: truth.body.releaseRevision,
    releaseBuild: truth.body.releaseBuild,
    environment: truth.body.environment,
    provenanceStatus: truth.body.provenanceStatus,
    deploymentProvenance: truth.body.deploymentProvenance,
    buildProvenanceStatus: truth.body.buildProvenanceStatus,
    provenanceSource: truth.body.provenanceSource,
    cacheControl: truth.cacheControl,
  };
}

async function readReleaseIdentityTruth({ navigate = false } = {}) {
  const nonce = crypto.randomUUID();
  let truth;
  if (navigate) {
    const response = await page.goto(
      `${expectedOrigin}/api/release/identity?rc6_2=${encodeURIComponent(nonce)}`,
      { waitUntil: "domcontentloaded", timeout: 90_000 },
    );
    assert.ok(response, "release identity navigation did not return a response");
    truth = {
      httpStatus: response.status(),
      cacheControl: response.headers()["cache-control"] ?? null,
      headers: {
        appCommit: response.headers()["x-novel-app-commit"] ?? null,
        releaseProductCommit: response.headers()["x-novel-release-product-commit"] ?? null,
        releaseRevision: response.headers()["x-novel-release-revision"] ?? null,
        releaseBuild: response.headers()["x-novel-release-build"] ?? null,
        deploymentId: response.headers()["x-novel-deployment-id"] ?? null,
        deploymentProvenance: response.headers()["x-novel-deployment-provenance"] ?? null,
      },
      body: await response.json(),
    };
  } else {
    truth = await page.evaluate(async ({ origin, requestNonce }) => {
      const response = await fetch(
        `${origin}/api/release/identity?rc6_2=${encodeURIComponent(requestNonce)}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      return {
        httpStatus: response.status,
        cacheControl: response.headers.get("cache-control"),
        headers: {
          appCommit: response.headers.get("x-novel-app-commit"),
          releaseProductCommit: response.headers.get("x-novel-release-product-commit"),
          releaseRevision: response.headers.get("x-novel-release-revision"),
          releaseBuild: response.headers.get("x-novel-release-build"),
          deploymentId: response.headers.get("x-novel-deployment-id"),
          deploymentProvenance: response.headers.get("x-novel-deployment-provenance"),
        },
        body: await response.json(),
      };
    }, { origin: expectedOrigin, requestNonce: nonce });
  }
  assertReleaseIdentityTruth(truth);
  return safeReleaseIdentity(truth);
}

async function readFreshStorageTruth() {
  await assertExactOrigin();
  const cookies = await context.cookies();
  const storage = await page.evaluate(async () => ({
    localStorageCount: window.localStorage.length,
    sessionStorageCount: window.sessionStorage.length,
    indexedDatabaseCount: (await indexedDB.databases()).length,
    cacheStorageCount: (await caches.keys()).length,
    serviceWorkerRegistrationCount: "serviceWorker" in navigator
      ? (await navigator.serviceWorker.getRegistrations()).length
      : 0,
  }));
  const evidence = {
    cookieCount: cookies.length,
    ...storage,
    emptyBeforeAppNavigation: true,
  };
  for (const [key, value] of Object.entries(evidence)) {
    if (key === "emptyBeforeAppNavigation") continue;
    assert.equal(value, 0, `${key} was not empty before app navigation`);
  }
  return evidence;
}

async function readEdgeIdentity(launchEvidence) {
  edgeCdpSession = await context.newCDPSession(page);
  const version = await edgeCdpSession.send("Browser.getVersion");
  assert.match(version.product ?? "", /^Edg\/[0-9.]+$/u);
  assert.match(version.protocolVersion ?? "", /^[0-9]+\.[0-9]+$/u);
  assert.ok(version.revision?.trim(), "Edge CDP revision was empty");
  assert.match(version.userAgent ?? "", /\bEdg\/[0-9.]+/u);
  return {
    ...launchEvidence,
    product: version.product,
    protocolVersion: version.protocolVersion,
    browserRevisionDigest: sha256Value(version.revision ?? ""),
    userAgentProductVerified: true,
  };
}

async function createProject() {
  await page.goto(`${expectedOrigin}/studio/create`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await assertExactOrigin();
  await page.getByTestId("canonical-create-flow").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await page.getByTestId("p2-project-title").fill(
    `RC6.2 Browser AI Production Gate ${crypto.randomUUID().slice(0, 8)}`,
  );
  await page.getByTestId("create-play-mode-general").click();
  await page.locator(".p2CreationAssistantActions button").first().click();
  await page.locator(".p2FoundationReady").waitFor({ state: "visible", timeout: 90_000 });
  const stepBar = page.locator(".p2StepBar");
  const next = page.locator(".p2CreatePanel > footer button.gold");
  for (let expectedStep = 2; expectedStep <= 3; expectedStep += 1) {
    const previous = await stepBar.getAttribute("aria-label");
    await next.click();
    await page.waitForFunction(
      ({ selector, previousLabel }) => (
        document.querySelector(selector)?.getAttribute("aria-label") !== previousLabel
      ),
      { selector: ".p2StepBar", previousLabel: previous },
    );
    assert.match(await stepBar.getAttribute("aria-label") ?? "", new RegExp(String(expectedStep), "u"));
  }
  await next.click();
  const primary = page.locator(".p2CreateSuccess a.primaryAction");
  await primary.waitFor({ state: "visible", timeout: 90_000 });
  const href = await primary.getAttribute("href");
  assert.match(href ?? "", /^\/studio\/project\/[^/]+\/chat$/u);
  const projectId = href.split("/")[3];
  await primary.click();
  await page.getByTestId("conversation-first-workspace").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await assertExactOrigin();
  return projectId;
}

async function readStoryBibleEvidence(projectId) {
  return page.evaluate(async (id) => {
    const stableStringify = (value) => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
      const entries = Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
    };
    const sha256 = async (value) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("RC6_2_STORY_BIBLE_DATABASE_SCHEMA_MISSING"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await requestResult(
        database.transaction("storyBibles", "readonly")
          .objectStore("storyBibles").index("projectId").getAll(id),
      );
      if (records.length !== 1) return null;
      const record = records[0];
      if (
        record.schemaVersion !== "novel-domain-v1"
        || record.projectId !== id
        || !Number.isSafeInteger(record.revision)
        || record.revision < 1
        || (record.deletedAt !== null && record.deletedAt !== undefined)
      ) return null;
      const project = await requestResult(
        database.transaction("projects", "readonly").objectStore("projects").get(id),
      );
      if (!project || project.storyBibleId !== record.id) return null;
      const fields = [
        "theme",
        "style",
        "protagonistIds",
        "characterIds",
        "relationshipIds",
        "worldId",
        "worldRuleIds",
        "loreIds",
        "timelineEventIds",
        "foreshadowing",
        "unresolvedThreads",
        "forbiddenContradictions",
        "authorPreferences",
        "revision",
      ];
      const value = Object.fromEntries(fields
        .map((field) => {
          const fieldValue = record[field];
          const presented = fieldValue
            && typeof fieldValue === "object"
            && "status" in fieldValue
            && "value" in fieldValue
            ? fieldValue.value ?? null
            : fieldValue;
          return [field, presented];
        })
        .filter(([, fieldValue]) => (
          fieldValue !== null
          && fieldValue !== undefined
          && fieldValue !== ""
          && (!Array.isArray(fieldValue) || fieldValue.length > 0)
        )));
      const sourceArtifactDigest = await sha256(stableStringify({
        domain: "approved-story-bible-source-artifact-v1",
        value,
      }));
      const sourceRevisionDigest = await sha256(stableStringify({
        domain: "approved-story-bible-source-revision-v1",
        store: "storyBibles",
        schemaVersion: record.schemaVersion,
        id: record.id,
        projectId: record.projectId,
        revision: record.revision,
        sourceArtifactDigest,
      }));
      const serializedSource = [
        "[story-bible]",
        "[APPROVED_STORY_BIBLE]",
        stableStringify(value),
      ].join("\n");
      return {
        recordId: record.id,
        revision: record.revision,
        originalDigest: await sha256(serializedSource),
        sourceArtifactDigest,
        sourceRevisionDigest,
        serializedSource,
      };
    } finally {
      database.close();
    }
  }, projectId);
}

async function createApprovedStoryBible(projectId) {
  const marker = crypto.randomUUID().slice(0, 8);
  const values = {
    theme: `雨夜追索與承諾 ${marker}`,
    style: "第三人稱限知、繁體中文、具體場景敘事",
    foreshadowing: "舊懷錶停在午夜十二點",
    unresolved: "主角尚未知道匿名信的寄件者",
    contradictions: "主角不得無故知道未曾目擊的事件",
    preferences: "以可見行動推進，不以摘要取代場景",
  };
  Object.values(values).forEach(registerSensitiveEvidenceSentinel);
  await page.goto(`${expectedOrigin}/studio/project/${encodeURIComponent(projectId)}/story-bible`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await assertExactOrigin();
  await page.getByTestId("story-bible-editor").waitFor({ state: "visible", timeout: 90_000 });
  const record = page.getByTestId("story-bible-record");
  const previousRevision = await record.count()
    ? Number(await record.getAttribute("data-revision"))
    : -1;
  await page.getByTestId("story-bible-theme").fill(values.theme);
  await page.getByTestId("story-bible-style").fill(values.style);
  await page.getByTestId("story-bible-foreshadowing").fill(values.foreshadowing);
  await page.getByTestId("story-bible-unresolved").fill(values.unresolved);
  await page.getByTestId("story-bible-contradictions").fill(values.contradictions);
  await page.getByTestId("story-bible-preferences").fill(values.preferences);
  await page.getByTestId("story-bible-save").click();
  await page.waitForFunction((prior) => {
    const saved = document.querySelector('[data-testid="story-bible-record"]');
    return saved && Number(saved.getAttribute("data-revision")) > prior;
  }, previousRevision, { timeout: 90_000 });
  const savedRevision = Number(await record.getAttribute("data-revision"));
  const recordId = await record.getAttribute("data-record-id");
  assert.ok(recordId);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("story-bible-editor").waitFor({ state: "visible", timeout: 90_000 });
  await page.waitForFunction((expected) => (
    document.querySelector('[data-testid="story-bible-theme"]')?.value === expected.theme
    && document.querySelector('[data-testid="story-bible-style"]')?.value === expected.style
    && document.querySelector('[data-testid="story-bible-foreshadowing"]')?.value === expected.foreshadowing
    && document.querySelector('[data-testid="story-bible-unresolved"]')?.value === expected.unresolved
    && document.querySelector('[data-testid="story-bible-contradictions"]')?.value === expected.contradictions
    && document.querySelector('[data-testid="story-bible-preferences"]')?.value === expected.preferences
  ), values, { timeout: 90_000 });
  assert.equal(Number(await page.getByTestId("story-bible-record").getAttribute("data-revision")), savedRevision);
  assert.equal(await page.getByTestId("story-bible-record").getAttribute("data-record-id"), recordId);
  const persisted = await readStoryBibleEvidence(projectId);
  assert.ok(persisted);
  assert.equal(persisted.recordId, recordId);
  assert.equal(persisted.revision, savedRevision);
  const serializedSource = persisted.serializedSource;
  assert.equal(persisted.originalDigest, sha256Value(serializedSource));
  assert.equal(
    serializedSource.startsWith("[story-bible]\n[APPROVED_STORY_BIBLE]\n{"),
    true,
  );
  for (const value of Object.values(values)) assert.equal(serializedSource.includes(value), true);
  assert.match(persisted.sourceArtifactDigest, /^[a-f0-9]{64}$/u);
  assert.match(persisted.sourceRevisionDigest, /^[a-f0-9]{64}$/u);
  await page.goto(`${expectedOrigin}/studio/project/${encodeURIComponent(projectId)}/chat`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 90_000 });
  await assertExactOrigin();
  const { serializedSource: _serializedSource, ...persistedEvidence } = persisted;
  void _serializedSource;
  const evidence = {
    ...persistedEvidence,
    sourceMetadataDigest: finalContextSourceMetadataDigest({
      sourceKind: "approved-story-bible",
      authority: "composer-repository-verified",
      sourceArtifactDigest: persisted.sourceArtifactDigest,
      sourceRevisionDigest: persisted.sourceRevisionDigest,
    }),
    sourceIdDigest: finalContextSourceIdDigest(
      `story-bible:${persisted.recordId}`,
      "approved-story-bible",
    ),
    persistedAfterReload: true,
    uiInputDigest: sha256Value(JSON.stringify(values)),
  };
  Object.defineProperty(evidence, "runnerFinalContext", {
    enumerable: false,
    value: {
      outerKind: "story-bible",
      serializedSource,
      substantivePrefix:
        "[story-bible]\n[story-bible]\n[APPROVED_STORY_BIBLE]\n{",
    },
  });
  return evidence;
}

async function waitUntilNotBusy(locator, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.getAttribute("aria-busy") === "false") return;
    await page.waitForTimeout(250);
  }
  throw gateError("RC6_2_CLOSED_AI_UI_BUSY_TIMEOUT");
}

async function readSanitizedQualityCodes() {
  return sanitizeDiagnosticCodes(authoritativeFailureEvidence?.diagnosticCodes ?? []);
}

async function readSanitizedBrowserRuntimeEvidence() {
  return sanitizeBrowserRuntimeEvidence(
    authoritativeFailureEvidence?.browserRuntimeEvidence ?? [],
  );
}

async function assertProductFailureEvidenceDom(invocation, serialized) {
  const expected = {
    invocationId: invocation.id,
    taskId: invocation.taskId,
    schemaVersion: FAILURE_EVIDENCE_SCHEMA_VERSION,
    serialized,
  };
  await page.waitForFunction((value) => {
    const timeline = document.querySelector('[data-testid="conversation-message-timeline"]');
    const composer = document.querySelector('[data-testid="conversation-message-composer"]');
    if (!timeline || composer?.getAttribute("aria-busy") !== "false") return false;
    const matches = [...timeline.querySelectorAll(
      '[data-testid="conversation-closed-agent-failure-evidence"]',
    )].filter((node) => (
      node.getAttribute("data-invocation-id") === value.invocationId
      && node.getAttribute("data-task-id") === value.taskId
      && node.getAttribute("data-failure-evidence-schema") === value.schemaVersion
      && node.getAttribute("data-failure-evidence") === value.serialized
    ));
    return matches.length === 1
      && matches[0].getAttribute("role") === "alert"
      && !matches[0].hidden;
  }, expected, { timeout: 30_000 });
  const values = await page.evaluate((value) => {
    const timeline = document.querySelector('[data-testid="conversation-message-timeline"]');
    return [...(timeline?.querySelectorAll(
      '[data-testid="conversation-closed-agent-failure-evidence"]',
    ) ?? [])].filter((node) => (
      node.getAttribute("data-invocation-id") === value.invocationId
      && node.getAttribute("data-task-id") === value.taskId
    )).map((node) => node.getAttribute("data-failure-evidence"));
  }, expected);
  assert.deepEqual(values, [serialized]);
  assert.deepEqual(parsePersistedFailureEvidence(values[0]), invocation.failureEvidence);
}

async function assertMaliciousDomDiagnosticsAreRejected() {
  await page.evaluate(async (schemaVersion) => {
    const arbitraryStatus = document.createElement("div");
    arbitraryStatus.hidden = true;
    arbitraryStatus.setAttribute("role", "status");
    arbitraryStatus.textContent = "private prompt and output QUALITY_EMPTY_CANDIDATE BROWSER_RUNTIME_EVIDENCE:initial:stop:12:30:30:20";
    const nearMatch = document.createElement("div");
    nearMatch.hidden = true;
    nearMatch.setAttribute("role", "alert");
    nearMatch.setAttribute("data-testid", "conversation-closed-agent-failure-evidence");
    nearMatch.setAttribute("data-failure-evidence-schema", `${schemaVersion}-attacker`);
    nearMatch.setAttribute("data-failure-evidence", JSON.stringify({
      schemaVersion,
      safeCode: "BROWSER_AI_QUALITY_INSUFFICIENT",
      diagnosticCodes: ["QUALITY_EMPTY_CANDIDATE"],
      browserRuntimeEvidence: [{
        stage: "initial",
        finishReason: "stop",
        completionTokens: 12,
        rawOutputCharacters: 30,
        normalizedOutputCharacters: 30,
        observedHanCharacters: 20,
      }],
    }));
    nearMatch.setAttribute("data-invocation-id", "attacker-invocation");
    nearMatch.setAttribute("data-task-id", "attacker-task");
    document.body.append(arbitraryStatus, nearMatch);
    await new Promise((resolve) => setTimeout(resolve, 0));
    arbitraryStatus.remove();
    nearMatch.remove();
  }, FAILURE_EVIDENCE_SCHEMA_VERSION);
  assert.equal(authoritativeFailureEvidence, null);
  assert.deepEqual(await readSanitizedQualityCodes(), []);
  assert.deepEqual(await readSanitizedBrowserRuntimeEvidence(), []);
}

async function inspectFreshSetup() {
  const card = page.getByTestId("closed-ai-setup-card");
  await card.waitFor({ state: "visible", timeout: 90_000 });
  await waitUntilNotBusy(card);
  assert.equal(await card.getAttribute("data-status"), "setup_required");
  const text = await card.textContent() ?? "";
  assert.match(text, /Qwen2\.5 0\.5B/u);
  assert.match(text, /約 294\.5 MB 本機儲存（十進位 MB）/u);
  assert.equal(await card.getAttribute("data-estimated-download-bytes"), "294543984");
  assert.match(text, /此瀏覽器／此裝置/u);
  assert.match(text, /作品資料不離開裝置/u);
  assert.match(text, /改用 Local Ollama/u);
  assert.match(text, /連接 Private AI Hub/u);
  assert.equal(modelRequests.length, 0, "fresh inspection triggered an automatic model download");
  return {
    status: "setup_required",
    model: "Qwen2.5 0.5B",
    estimatedDownloadBytes: 294_543_984,
    estimatedDownloadMB: 294.5,
    automaticModelRequests: 0,
    explicitAction: "closed-ai-prepare-browser",
  };
}

async function waitForBrowserAiReady(card) {
  const startedAt = Date.now();
  let nextHeartbeat = startedAt + 30_000;
  while (Date.now() - startedAt < setupTimeoutMs) {
    if (await card.count() === 0 || !(await card.isVisible().catch(() => false))) return;
    const busy = await card.getAttribute("aria-busy");
    const retry = await card.getByTestId("closed-ai-prepare-browser").textContent().catch(() => "");
    if (busy === "false" && /重試/u.test(retry ?? "")) {
      throw gateError("RC6_2_CLOSED_AI_SETUP_FAILED");
    }
    if (Date.now() >= nextHeartbeat) {
      process.stderr.write(`[RC6.2 Closed AI] setup in progress (${Math.round((Date.now() - startedAt) / 1_000)}s)\n`);
      nextHeartbeat += 30_000;
    }
    await page.waitForTimeout(1_000);
  }
  throw gateError("RC6_2_CLOSED_AI_SETUP_TIMEOUT");
}

async function readModelMetadata() {
  return page.evaluate(async () => {
    const databaseNames = (await indexedDB.databases()).map((database) => database.name);
    if (!databaseNames.includes("novel-browser-webllm-v1")) return null;
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-browser-webllm-v1");
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("RC6_2_BROWSER_MODEL_DATABASE_SCHEMA_MISSING"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await new Promise((resolve, reject) => {
        const request = database.transaction("runtime-records", "readonly")
          .objectStore("runtime-records").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const selected = records.find((record) => record.kind === "setting" && record.key === "selected-model");
      const model = records.find((record) => record.kind === "model" && record.modelId === selected?.modelId);
      return model ? {
        modelId: model.modelId,
        modelDigest: model.modelDigest,
        installStatus: model.installStatus,
        cacheVerified: model.cacheVerified,
        shardIntegrityVerified: model.shardIntegrityVerified,
        shardManifestDigest: model.shardManifestDigest,
        verifiedShardCount: model.verifiedShardCount,
        shardVerifiedAt: model.shardVerifiedAt,
        generationCount: model.generationCount,
      } : null;
    } finally {
      database.close();
    }
  });
}

async function readChapterTruth(projectId) {
  return page.evaluate(async (id) => {
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const project = await requestResult(
        database.transaction("projects", "readonly").objectStore("projects").get(id),
      );
      const chapter = await requestResult(
        database.transaction("chapters", "readonly").objectStore("chapters").get(project.activeChapterId),
      );
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(chapter.content ?? ""),
      );
      return {
        chapterId: chapter.id,
        revision: chapter.revision,
        contentDigest: [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
      };
    } finally {
      database.close();
    }
  }, projectId);
}

async function readRightsGateExecutionCounts(projectId) {
  const persistentCounts = await page.evaluate(async (id) => {
    const names = new Set((await indexedDB.databases()).map((database) => database.name));
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const openExisting = (name) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error(`RC6_2_REQUIRED_DATABASE_MISSING:${name}`));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const counts = {
      attachmentRecords: 0,
      conversationMessages: 0,
      toolInvocations: 0,
      artifacts: 0,
      closedCandidates: 0,
      browserExecutionReceipts: 0,
    };
    if (names.has("novel-intelligence-platform")) {
      const database = await openExisting("novel-intelligence-platform");
      try {
        for (const [store, key] of [
          ["conversationAttachments", "attachmentRecords"],
          ["conversationMessages", "conversationMessages"],
          ["conversationToolInvocations", "toolInvocations"],
          ["conversationArtifacts", "artifacts"],
        ]) {
          const records = await requestResult(
            database.transaction(store, "readonly").objectStore(store).getAll(),
          );
          counts[key] = records.filter((record) => record.projectId === id).length;
        }
      } finally {
        database.close();
      }
    }
    if (names.has("novel-closed-agent-state")) {
      const database = await openExisting("novel-closed-agent-state");
      try {
        const records = await requestResult(
          database.transaction("records", "readonly").objectStore("records").getAll(),
        );
        counts.closedCandidates = records.filter((record) => (
          record.kind === "candidate" && record.projectId === id
        )).length;
      } finally {
        database.close();
      }
    }
    if (names.has("novel-browser-offload-metrics-v1")) {
      const database = await openExisting("novel-browser-offload-metrics-v1");
      try {
        counts.browserExecutionReceipts = await requestResult(
          database.transaction("execution-receipts", "readonly")
            .objectStore("execution-receipts").count(),
        );
      } finally {
        database.close();
      }
    }
    return counts;
  }, projectId);
  const modelMetadata = await readModelMetadata();
  return {
    ...persistentCounts,
    modelGenerationCount: modelMetadata?.generationCount ?? 0,
    modelPayloadRequestCount: modelRequests.length,
  };
}

async function readCandidateEvidence(projectId, candidateId = null) {
  const evidence = await page.evaluate(async ({ id, candidateId: exactCandidateId }) => {
    const stableStringify = (value) => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
      const entries = Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
    };
    const sha256 = async (value) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const databaseNames = (await indexedDB.databases()).map((database) => database.name);
    if (
      !databaseNames.includes("novel-closed-agent-state")
      || !databaseNames.includes("novel-intelligence-platform")
      || !databaseNames.includes("novel-browser-offload-metrics-v1")
    ) return null;
    const open = (name) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error(`RC6_2_REQUIRED_DATABASE_MISSING:${name}`));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const closedDatabase = await open("novel-closed-agent-state");
    const appDatabase = await open("novel-intelligence-platform");
    const offloadDatabase = await open("novel-browser-offload-metrics-v1");
    try {
      const records = await requestResult(
        closedDatabase.transaction("records", "readonly")
          .objectStore("records").index("projectId").getAll(id),
      );
      const candidates = records
        .filter((record) => record.kind === "candidate")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const candidate = exactCandidateId
        ? candidates.find((record) => record.id === exactCandidateId) ?? null
        : candidates[0] ?? null;
      if (!candidate) return null;
      const contentDigestVerified = candidate.contentDigest === await sha256(candidate.content);
      const normalizedContentDigest = [...new Uint8Array(await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(candidate.content.normalize("NFKC")),
      ))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const invocations = (await requestResult(
        appDatabase.transaction("conversationToolInvocations", "readonly")
          .objectStore("conversationToolInvocations").getAll(),
      )).filter((record) => record.projectId === id);
      const invocation = invocations.find((record) => record.taskId === candidate.taskId) ?? null;
      const artifacts = (await requestResult(
        appDatabase.transaction("conversationArtifacts", "readonly")
          .objectStore("conversationArtifacts").getAll(),
      )).filter((record) => record.projectId === id);
       const artifact = artifacts.find(
         (record) => record.sourceMessageId === invocation?.messageId,
       ) ?? null;
      const computeReceipts = await requestResult(
        offloadDatabase.transaction("execution-receipts", "readonly")
          .objectStore("execution-receipts").getAll(),
      );
      const computeReceipt = computeReceipts.find(
        (record) => record.receiptId === candidate.generationTelemetry?.browserComputeReceiptId,
      ) ?? null;
      let computeReceiptIntegrityVerified = false;
      if (computeReceipt?.schemaVersion === "browser-execution-receipt-v3") {
        const { receiptId, ...body } = computeReceipt;
        computeReceiptIntegrityVerified = receiptId === await sha256(stableStringify({
          domain: "browser-execution-receipt-v3",
          body,
        }));
      }
      return {
        projectId: id,
        candidate: {
          id: candidate.id,
          taskId: candidate.taskId,
          backendId: candidate.backendId,
          actualExecutor: candidate.actualExecutor,
          modelId: candidate.modelId,
          modelDigest: candidate.modelDigest,
          contentDigest: candidate.contentDigest,
          contentDigestVerified,
          normalizedContentDigest,
          status: candidate.status,
          candidateOnly: candidate.candidateOnly,
          canonicalMutationCount: candidate.canonicalMutationCount,
          externalRequest: candidate.externalRequest,
          dataLeftDevice: candidate.dataLeftDevice,
          qualityMode: candidate.generationTelemetry?.qualityMode ?? null,
          qualityPasses: candidate.generationTelemetry?.qualityPasses ?? null,
          regeneration: candidate.regeneration ?? null,
          executionReceipt: candidate.executionReceipt ? {
            receiptKeys: Object.keys(candidate.executionReceipt).sort(),
            taskId: candidate.executionReceipt.taskId,
            backendId: candidate.executionReceipt.backendId,
            actualExecutor: candidate.executionReceipt.actualExecutor,
            modelId: candidate.executionReceipt.modelId,
            modelDigest: candidate.executionReceipt.modelDigest,
            proofState: candidate.executionReceipt.proofState,
            contentDigest: candidate.executionReceipt.contentDigest,
            contextDigest: candidate.executionReceipt.contextDigest,
            externalRequest: candidate.executionReceipt.externalRequest,
            dataLeftDevice: candidate.executionReceipt.dataLeftDevice,
            browserComputeReceiptId: candidate.executionReceipt.browserComputeReceiptId,
            browserFabricReceiptId: candidate.executionReceipt.browserFabricReceiptId,
            contextAttestation: candidate.executionReceipt.contextAttestation ?? null,
            finalModelContextAttestationState:
              candidate.executionReceipt.finalModelContextAttestation === undefined
                ? "absent"
                : candidate.executionReceipt.finalModelContextAttestation === null
                  ? "null"
                  : "present",
            finalModelContextAttestation:
              candidate.executionReceipt.finalModelContextAttestation ?? null,
          } : null,
        },
        invocation: invocation ? {
          id: invocation.id,
          taskId: invocation.taskId,
          taskType: invocation.taskType,
          status: invocation.status,
          actualExecutor: invocation.actualExecutor,
          modelId: invocation.modelId,
          modelDigest: invocation.modelDigest,
          contextDigest: invocation.contextDigest,
          externalRequest: invocation.externalRequest,
          dataLeftDevice: invocation.dataLeftDevice,
          canonicalMutationCount: invocation.canonicalMutationCount,
          executionReceipt: invocation.executionReceipt ? {
            providerRunId: invocation.executionReceipt.providerRunId,
            outputDigest: invocation.executionReceipt.outputDigest,
            modelId: invocation.executionReceipt.modelId,
            modelDigest: invocation.executionReceipt.modelDigest,
            externalRequest: invocation.executionReceipt.externalRequest,
            dataLeftDevice: invocation.executionReceipt.dataLeftDevice,
          } : null,
        } : null,
        artifact: artifact ? {
          id: artifact.id,
          sourceMessageId: artifact.sourceMessageId,
          status: artifact.status,
          candidateDigest: artifact.candidateDigest,
          targetStore: artifact.targetStore,
          targetRecordId: artifact.targetRecordId,
          sourceRevision: artifact.sourceRevision,
        } : null,
        browserComputeReceipt: computeReceipt ? {
          receiptKeys: Object.keys(computeReceipt).sort(),
          schemaVersion: computeReceipt.schemaVersion,
          receiptId: computeReceipt.receiptId,
          taskDigest: computeReceipt.taskDigest,
          taskType: computeReceipt.taskType,
          actualExecutor: computeReceipt.actualExecutor,
          modelId: computeReceipt.modelId,
          modelDigest: computeReceipt.modelDigest,
          browserGenerationUsed: computeReceipt.browserGenerationUsed,
          externalAIUsed: computeReceipt.externalAIUsed,
          dataLeftDevice: computeReceipt.dataLeftDevice,
          candidateOnly: computeReceipt.candidateOnly,
          canonicalMutationCount: computeReceipt.canonicalMutationCount,
          rawPromptStored: computeReceipt.rawPromptStored,
          rawOutputStored: computeReceipt.rawOutputStored,
          rawChainOfThoughtStored: computeReceipt.rawChainOfThoughtStored,
          contextAttestation: computeReceipt.contextAttestation ?? null,
          finalModelContextAttestationState:
            computeReceipt.finalModelContextAttestation === undefined
              ? "absent"
              : computeReceipt.finalModelContextAttestation === null
                ? "null"
                : "present",
          outerRequestIdDigest: computeReceipt.outerRequestIdDigest ?? null,
          finalModelContextAttestation:
            computeReceipt.finalModelContextAttestation ?? null,
          receiptIntegrityVerified: computeReceiptIntegrityVerified,
        } : null,
        candidateCount: candidates.length,
      };
    } finally {
      closedDatabase.close();
      appDatabase.close();
      offloadDatabase.close();
    }
  }, { id: projectId, candidateId });
  if (!evidence) return null;
  if (evidence.candidate.executionReceipt) {
    evidence.candidate.executionReceipt.finalModelContextAttestation =
      sanitizeFinalModelContextAttestation(
        evidence.candidate.executionReceipt.finalModelContextAttestation,
      );
  }
  if (evidence.browserComputeReceipt) {
    evidence.browserComputeReceipt.finalModelContextAttestation =
      sanitizeFinalModelContextAttestation(
        evidence.browserComputeReceipt.finalModelContextAttestation,
      );
  }
  return evidence;
}

function assertCandidateTruth(evidence, expected = {}) {
  assert.ok(evidence?.candidate);
  assert.equal(evidence.candidate.backendId, "browser-ai");
  assert.equal(evidence.candidate.actualExecutor, "browser-ai");
  assert.match(evidence.candidate.modelId, /^Qwen2\.5-0\.5B-/u);
  assert.match(evidence.candidate.modelDigest, /^[a-f0-9]{64}$/u);
  assert.equal(evidence.candidate.status, expected.status ?? "awaiting-approval");
  assert.equal(evidence.candidate.candidateOnly, true);
  assert.equal(evidence.candidate.canonicalMutationCount, expected.canonicalMutationCount ?? 0);
  assert.equal(evidence.candidate.externalRequest, false);
  assert.equal(evidence.candidate.dataLeftDevice, false);
  assert.equal(evidence.candidate.contentDigestVerified, true);
  assert.deepEqual(
    evidence.candidate.executionReceipt?.receiptKeys,
    [...CLOSED_EXECUTION_RECEIPT_KEYS].sort(),
  );
  assert.equal(evidence.candidate.executionReceipt?.taskId, evidence.candidate.taskId);
  assert.equal(evidence.candidate.executionReceipt?.backendId, "browser-ai");
  assert.equal(evidence.candidate.executionReceipt?.actualExecutor, "browser-ai");
  assert.equal(evidence.candidate.executionReceipt?.modelId, evidence.candidate.modelId);
  assert.equal(evidence.candidate.executionReceipt?.modelDigest, evidence.candidate.modelDigest);
  assert.equal(evidence.candidate.executionReceipt?.contentDigest, evidence.candidate.contentDigest);
  assert.match(evidence.candidate.executionReceipt?.contextDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(evidence.candidate.executionReceipt?.proofState, "verified");
  assert.equal(evidence.candidate.executionReceipt?.externalRequest, false);
  assert.equal(evidence.candidate.executionReceipt?.dataLeftDevice, false);
  assert.equal(evidence.candidate.executionReceipt?.contextAttestation, "required");
  assert.equal(
    evidence.candidate.executionReceipt?.finalModelContextAttestationState,
    "present",
  );
  assert.equal(
    evidence.candidate.executionReceipt?.browserComputeReceiptId,
    evidence.browserComputeReceipt?.receiptId,
  );
  assert.equal(evidence.invocation?.status, "completed");
  assert.equal(evidence.invocation?.actualExecutor, "browser-ai");
  assert.equal(evidence.invocation?.taskType, "chapter.continue");
  assert.equal(evidence.invocation?.modelId, evidence.candidate.modelId);
  assert.equal(evidence.invocation?.modelDigest, evidence.candidate.modelDigest);
  assert.equal(evidence.invocation?.contextDigest, evidence.candidate.executionReceipt?.contextDigest);
  assert.equal(evidence.invocation?.executionReceipt?.providerRunId, evidence.candidate.taskId);
  assert.equal(evidence.invocation?.executionReceipt?.outputDigest, evidence.candidate.contentDigest);
  assert.equal(evidence.invocation?.executionReceipt?.modelId, evidence.candidate.modelId);
  assert.equal(evidence.invocation?.executionReceipt?.modelDigest, evidence.candidate.modelDigest);
  assert.equal(evidence.invocation?.executionReceipt?.externalRequest, false);
  assert.equal(evidence.invocation?.executionReceipt?.dataLeftDevice, false);
  assert.equal(evidence.invocation?.canonicalMutationCount, 0);
  assert.deepEqual(
    evidence.browserComputeReceipt?.receiptKeys,
    [...BROWSER_EXECUTION_RECEIPT_KEYS].sort(),
  );
  assert.equal(evidence.browserComputeReceipt?.schemaVersion, "browser-execution-receipt-v3");
  assert.equal(evidence.browserComputeReceipt?.actualExecutor, "webllm-worker");
  assert.equal(evidence.browserComputeReceipt?.taskType, evidence.invocation?.taskType);
  assert.equal(evidence.browserComputeReceipt?.modelId, evidence.candidate.modelId);
  assert.equal(evidence.browserComputeReceipt?.modelDigest, evidence.candidate.modelDigest);
  assert.equal(evidence.browserComputeReceipt?.browserGenerationUsed, true);
  assert.equal(evidence.browserComputeReceipt?.externalAIUsed, false);
  assert.equal(evidence.browserComputeReceipt?.dataLeftDevice, false);
  assert.equal(evidence.browserComputeReceipt?.candidateOnly, true);
  assert.equal(evidence.browserComputeReceipt?.canonicalMutationCount, 0);
  assert.equal(evidence.browserComputeReceipt?.rawPromptStored, false);
  assert.equal(evidence.browserComputeReceipt?.rawOutputStored, false);
  assert.equal(evidence.browserComputeReceipt?.rawChainOfThoughtStored, false);
  assert.equal(evidence.browserComputeReceipt?.contextAttestation, "required");
  assert.equal(evidence.browserComputeReceipt?.finalModelContextAttestationState, "present");
  assert.ok(evidence.browserComputeReceipt?.finalModelContextAttestation);
  const expectedPassIdentity = expectedClosedQualityPassIdentity(
    evidence,
    evidence.browserComputeReceipt.finalModelContextAttestation.outerQualityPhase,
  );
  assert.equal(
    evidence.browserComputeReceipt?.outerRequestIdDigest,
    expectedPassIdentity.outerRequestIdDigest,
  );
  assert.equal(evidence.browserComputeReceipt?.taskDigest, expectedPassIdentity.taskDigest);
  for (const call of evidence.browserComputeReceipt.finalModelContextAttestation.contributingCalls) {
    assert.equal(
      call.invocationRequestIdDigest,
      expectedInnerRequestIdDigest(expectedPassIdentity, call.innerStage),
    );
  }
  assert.equal(evidence.browserComputeReceipt?.receiptIntegrityVerified, true);
  assert.equal(evidence.artifact?.candidateDigest, evidence.candidate.normalizedContentDigest);
  assert.equal(
    evidence.artifact?.status,
    expected.artifactStatus
      ?? (expected.status === "rejected"
        ? "rejected"
        : expected.status === "committed"
          ? "approved"
          : "candidate"),
  );
  if (expected.previous) {
    assert.equal(
      evidence.candidate.regeneration?.previousCandidateId,
      expected.previous.candidate.id,
    );
    assert.equal(
      evidence.candidate.regeneration?.previousTaskId,
      expected.previous.candidate.taskId,
    );
    assert.equal(
      evidence.candidate.regeneration?.previousCandidateDigest,
      expected.previous.candidate.contentDigest,
    );
    assert.equal(
      evidence.candidate.regeneration?.regenerationAttempt,
      expected.regenerationAttempt,
    );
    assert.equal(evidence.candidate.regeneration?.cacheBypassReason, "explicit_regeneration");
    assert.equal(evidence.candidate.regeneration?.cacheBypassed, true);
    assert.equal(evidence.candidate.regeneration?.previousContentReused, false);
    assert.equal(evidence.candidate.regeneration?.newCandidate, true);
    assert.equal(evidence.candidate.regeneration?.nonceStored, false);
  }
}

function assertT1CandidateTruth(evidence) {
  const taskModel = {
    modelId: "novel-browser-task-runtime-v3",
    modelDigest: "5ea2191560d86727a4d897f1b552a5f624b74dfb8ef0c57683b02d52d6db4b4f",
  };
  assert.ok(evidence?.candidate);
  assert.equal(evidence.candidate.backendId, "browser-ai");
  assert.equal(evidence.candidate.actualExecutor, "browser-ai");
  assert.equal(evidence.candidate.modelId, taskModel.modelId);
  assert.equal(evidence.candidate.modelDigest, taskModel.modelDigest);
  assert.equal(evidence.candidate.status, "awaiting-approval");
  assert.equal(evidence.candidate.candidateOnly, true);
  assert.equal(evidence.candidate.canonicalMutationCount, 0);
  assert.equal(evidence.candidate.externalRequest, false);
  assert.equal(evidence.candidate.dataLeftDevice, false);
  assert.equal(evidence.candidate.contentDigestVerified, true);
  assert.deepEqual(
    evidence.candidate.executionReceipt?.receiptKeys,
    [...CLOSED_EXECUTION_RECEIPT_KEYS].sort(),
  );
  assert.equal(evidence.candidate.executionReceipt?.taskId, evidence.candidate.taskId);
  assert.equal(evidence.candidate.executionReceipt?.backendId, "browser-ai");
  assert.equal(evidence.candidate.executionReceipt?.actualExecutor, "browser-ai");
  assert.equal(evidence.candidate.executionReceipt?.modelId, taskModel.modelId);
  assert.equal(evidence.candidate.executionReceipt?.modelDigest, taskModel.modelDigest);
  assert.equal(evidence.candidate.executionReceipt?.contentDigest, evidence.candidate.contentDigest);
  assert.match(evidence.candidate.executionReceipt?.contextDigest ?? "", FINAL_CONTEXT_DIGEST);
  assert.equal(evidence.candidate.executionReceipt?.proofState, "verified");
  assert.equal(evidence.candidate.executionReceipt?.externalRequest, false);
  assert.equal(evidence.candidate.executionReceipt?.dataLeftDevice, false);
  assert.equal(evidence.candidate.executionReceipt?.contextAttestation, "not_required");
  assert.equal(
    evidence.candidate.executionReceipt?.finalModelContextAttestationState,
    "absent",
  );
  assert.equal(evidence.candidate.executionReceipt?.finalModelContextAttestation, null);
  assert.equal(
    evidence.candidate.executionReceipt?.browserComputeReceiptId,
    evidence.browserComputeReceipt?.receiptId,
  );
  assert.equal(evidence.invocation?.status, "completed");
  assert.equal(evidence.invocation?.actualExecutor, "browser-ai");
  assert.equal(evidence.invocation?.taskType, "story.consistencyCheck");
  assert.equal(evidence.invocation?.modelId, taskModel.modelId);
  assert.equal(evidence.invocation?.modelDigest, taskModel.modelDigest);
  assert.equal(evidence.invocation?.contextDigest, evidence.candidate.executionReceipt?.contextDigest);
  assert.equal(evidence.invocation?.executionReceipt?.providerRunId, evidence.candidate.taskId);
  assert.equal(evidence.invocation?.executionReceipt?.outputDigest, evidence.candidate.contentDigest);
  assert.equal(evidence.invocation?.executionReceipt?.modelId, taskModel.modelId);
  assert.equal(evidence.invocation?.executionReceipt?.modelDigest, taskModel.modelDigest);
  assert.equal(evidence.invocation?.executionReceipt?.externalRequest, false);
  assert.equal(evidence.invocation?.executionReceipt?.dataLeftDevice, false);
  assert.equal(evidence.invocation?.canonicalMutationCount, 0);
  assert.equal(evidence.artifact, null);
  assert.deepEqual(
    evidence.browserComputeReceipt?.receiptKeys,
    [...BROWSER_EXECUTION_RECEIPT_KEYS].sort(),
  );
  assert.equal(evidence.browserComputeReceipt?.schemaVersion, "browser-execution-receipt-v3");
  assert.equal(evidence.browserComputeReceipt?.actualExecutor, "browser-task-model");
  assert.equal(evidence.browserComputeReceipt?.taskType, "story.consistencyCheck");
  assert.equal(evidence.browserComputeReceipt?.modelId, taskModel.modelId);
  assert.equal(evidence.browserComputeReceipt?.modelDigest, taskModel.modelDigest);
  assert.equal(evidence.browserComputeReceipt?.browserGenerationUsed, false);
  assert.equal(evidence.browserComputeReceipt?.externalAIUsed, false);
  assert.equal(evidence.browserComputeReceipt?.dataLeftDevice, false);
  assert.equal(evidence.browserComputeReceipt?.candidateOnly, true);
  assert.equal(evidence.browserComputeReceipt?.canonicalMutationCount, 0);
  assert.equal(evidence.browserComputeReceipt?.rawPromptStored, false);
  assert.equal(evidence.browserComputeReceipt?.rawOutputStored, false);
  assert.equal(evidence.browserComputeReceipt?.rawChainOfThoughtStored, false);
  assert.equal(evidence.browserComputeReceipt?.contextAttestation, "not_required");
  assert.equal(evidence.browserComputeReceipt?.finalModelContextAttestationState, "null");
  assert.equal(evidence.browserComputeReceipt?.finalModelContextAttestation, null);
  const qualityPhase = evidence.candidate.qualityMode === "fast" ? "draft" : "revision";
  const passIdentity = expectedClosedQualityPassIdentity(evidence, qualityPhase);
  assert.equal(evidence.browserComputeReceipt?.outerRequestIdDigest, passIdentity.outerRequestIdDigest);
  assert.equal(evidence.browserComputeReceipt?.taskDigest, passIdentity.taskDigest);
  assert.equal(evidence.browserComputeReceipt?.receiptIntegrityVerified, true);
}

function assertFinalContextBindings(evidence, requiredSources) {
  const candidateAttestation =
    evidence.candidate.executionReceipt?.finalModelContextAttestation;
  const browserAttestation =
    evidence.browserComputeReceipt?.finalModelContextAttestation;
  assert.ok(candidateAttestation, "candidate receipt omitted final model context attestation");
  assert.ok(browserAttestation, "Browser receipt omitted final model context attestation");
  assert.equal(evidence.candidate.executionReceipt?.contextAttestation, "required");
  assert.equal(evidence.browserComputeReceipt?.contextAttestation, "required");
  assert.deepEqual(candidateAttestation, browserAttestation);
  const expectedPassIdentity = expectedClosedQualityPassIdentity(
    evidence,
    browserAttestation.outerQualityPhase,
  );
  assert.equal(
    browserAttestation.outerRequestIdDigest,
    expectedPassIdentity.outerRequestIdDigest,
  );
  assert.equal(
    evidence.browserComputeReceipt.outerRequestIdDigest,
    browserAttestation.outerRequestIdDigest,
  );
  assert.equal(browserAttestation.outerTaskType, evidence.invocation.taskType);
  assert.ok(browserAttestation.contributingCalls.length >= 1);
  assert.ok(browserAttestation.contributingCalls.length <= 2);
  for (const call of browserAttestation.contributingCalls) {
    assert.equal(
      call.invocationRequestIdDigest,
      expectedInnerRequestIdDigest(expectedPassIdentity, call.innerStage),
    );
    assert.equal(call.modelId, evidence.candidate.modelId);
    assert.equal(call.modelDigest, evidence.candidate.modelDigest);
    assert.equal(call.outerTaskType, evidence.invocation.taskType);
    assert.equal(call.contextBindings.length, requiredSources.length);
    assert.equal(call.messageDescriptors.length, 2);
    assert.equal(call.messageDescriptors[0].role, "system");
    assert.equal(call.messageDescriptors[1].role, "user");
    for (const [sourceIndex, source] of requiredSources.entries()) {
      const matches = call.contextBindings.filter((binding) => (
        binding.sourceKind === source.sourceKind
      ));
      assert.equal(matches.length, 1);
      const [binding] = matches;
      assert.equal(binding.ordinal, sourceIndex + 1);
      assert.equal(binding.segmentIndex, sourceIndex);
      assert.equal(binding.authority, source.authority);
      assert.equal(binding.sourceIdDigest, source.sourceIdDigest);
      assert.equal(binding.originalDigest, source.originalDigest);
      assert.equal(binding.sourceArtifactDigest, source.sourceArtifactDigest);
      assert.equal(binding.sourceRevisionDigest, source.sourceRevisionDigest);
      assert.equal(binding.sourceMetadataDigest, source.sourceMetadataDigest);
      assert.equal(binding.messageIndex, 1);
      assert.equal(binding.coverage, "fragment");
      assert.ok(binding.survivingFragmentUtf8Bytes > 0);
      assert.ok(binding.survivingFragmentCharacters > 0);
      assert.match(binding.survivingFragmentDigest, FINAL_CONTEXT_DIGEST);
      assertSubstantiveSurvivingPrefix(binding, source);
    }
  }
  return {
    schemaVersion: browserAttestation.schemaVersion,
    bindingDigest: browserAttestation.bindingDigest,
    requiredManifestDigest: browserAttestation.requiredManifestDigest,
    acceptedDisposition: browserAttestation.acceptedDisposition,
    acceptedStage: browserAttestation.acceptedStage,
    executedStages: browserAttestation.executedStages,
    contributingCallCount: browserAttestation.contributingCalls.length,
    sourceBindingCount: requiredSources.length,
    originalDigests: requiredSources.map((source) => source.originalDigest),
    substantivePrefixBound: true,
    rawTextStored: false,
  };
}

function storyBibleFinalContextSource(storyBible) {
  return {
    sourceKind: "approved-story-bible",
    authority: "composer-repository-verified",
    sourceIdDigest: storyBible.sourceIdDigest,
    originalDigest: storyBible.originalDigest,
    sourceArtifactDigest: storyBible.sourceArtifactDigest,
    sourceRevisionDigest: storyBible.sourceRevisionDigest,
    sourceMetadataDigest: storyBible.sourceMetadataDigest,
    ...storyBible.runnerFinalContext,
  };
}

function attachmentFinalContextSource(attachment) {
  return {
    sourceKind: "selected-local-attachment-summary",
    authority: "user-selected-sanitized-untrusted-reference",
    sourceIdDigest: attachment.sourceIdDigest,
    originalDigest: attachment.originalDigest,
    sourceArtifactDigest: attachment.sourceArtifactDigest,
    sourceRevisionDigest: attachment.sourceRevisionDigest,
    sourceMetadataDigest: attachment.sourceMetadataDigest,
    ...attachment.runnerFinalContext,
  };
}

async function readFailedClosedAgentInvocation(projectId, exact = {}) {
  return page.evaluate(async ({ id, invocationId, taskId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await new Promise((resolve, reject) => {
        const request = database.transaction("conversationToolInvocations", "readonly")
          .objectStore("conversationToolInvocations").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const failed = records
        .filter((record) => (
          record.projectId === id
          && record.status === "failed"
          && record.toolId === "closed-agent-os:conversation-plan"
          && (!invocationId || record.id === invocationId)
          && (!taskId || record.taskId === taskId)
        ))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      return failed ? {
        id: failed.id,
        taskId: failed.taskId,
        toolId: failed.toolId,
        status: failed.status,
        safeErrorCode: failed.safeErrorCode,
        safeProgress: failed.safeProgress,
      } : null;
    } finally {
      database.close();
    }
  }, {
    id: projectId,
    invocationId: exact.invocationId ?? null,
    taskId: exact.taskId ?? null,
  });
}

async function attestPersistedFailureEvidence(projectId, invocation) {
  assert.equal(invocation.toolId, "closed-agent-os:conversation-plan");
  assert.equal(invocation.status, "failed");
  assert.equal(invocation.safeProgress?.stage, "closed-agent-failure-evidence");
  assert.equal(invocation.safeProgress?.percent, 100);
  const serialized = invocation.safeProgress?.message;
  const failureEvidence = parsePersistedFailureEvidence(serialized);
  assert.ok(failureEvidence, "failed invocation did not contain canonical finite evidence");
  assert.equal(failureEvidence.safeCode, invocation.safeErrorCode);
  await assertProductFailureEvidenceDom(
    { ...invocation, failureEvidence },
    serialized,
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("conversation-first-workspace").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await assertExactOrigin();
  const reloaded = await readFailedClosedAgentInvocation(projectId, {
    invocationId: invocation.id,
    taskId: invocation.taskId,
  });
  assert.ok(reloaded, "exact failed invocation disappeared after reload");
  assert.equal(reloaded.safeErrorCode, invocation.safeErrorCode);
  assert.deepEqual(reloaded.safeProgress, invocation.safeProgress);
  await assertProductFailureEvidenceDom(
    { ...reloaded, failureEvidence },
    serialized,
  );
  authoritativeFailureEvidence = failureEvidence;
  return failureEvidence.safeCode;
}

async function waitForCandidate(projectId, previousTaskId = null) {
  const startedAt = Date.now();
  let nextHeartbeat = startedAt + 30_000;
  while (Date.now() - startedAt < generationTimeoutMs) {
    const evidence = await readCandidateEvidence(projectId).catch(() => null);
    if (
      evidence?.candidate.status === "awaiting-approval"
      && evidence.candidate.taskId !== previousTaskId
      && evidence.invocation?.status === "completed"
      && evidence.artifact?.status === "candidate"
    ) return evidence;
    const failedInvocation = await readFailedClosedAgentInvocation(projectId);
    if (failedInvocation && failedInvocation.taskId !== previousTaskId) {
      const safeCode = await attestPersistedFailureEvidence(projectId, failedInvocation);
      throw gateError(safeCode);
    }
    if (Date.now() >= nextHeartbeat) {
      process.stderr.write(`[RC6.2 Closed AI] candidate generation in progress (${Math.round((Date.now() - startedAt) / 1_000)}s)\n`);
      nextHeartbeat += 30_000;
    }
    await page.waitForTimeout(1_000);
  }
  throw gateError("RC6_2_CLOSED_AI_GENERATION_TIMEOUT");
}

async function waitForAnalyticalCandidate(projectId, previousTaskId = null) {
  const startedAt = Date.now();
  let nextHeartbeat = startedAt + 30_000;
  while (Date.now() - startedAt < generationTimeoutMs) {
    const evidence = await readCandidateEvidence(projectId).catch(() => null);
    if (
      evidence?.candidate.status === "awaiting-approval"
      && evidence.candidate.taskId !== previousTaskId
      && evidence.invocation?.status === "completed"
      && evidence.artifact === null
    ) return evidence;
    const failedInvocation = await readFailedClosedAgentInvocation(projectId);
    if (failedInvocation && failedInvocation.taskId !== previousTaskId) {
      const safeCode = await attestPersistedFailureEvidence(projectId, failedInvocation);
      throw gateError(safeCode);
    }
    if (Date.now() >= nextHeartbeat) {
      process.stderr.write(`[RC6.2 Closed AI] T1 analysis in progress (${Math.round((Date.now() - startedAt) / 1_000)}s)\n`);
      nextHeartbeat += 30_000;
    }
    await page.waitForTimeout(1_000);
  }
  throw gateError("RC6_2_CLOSED_AI_GENERATION_TIMEOUT");
}

async function waitForArtifactStatus(artifactId, status, timeoutMs = 90_000) {
  await page.waitForFunction(
    ({ id, expected }) => document.querySelector(`[data-artifact-id="${CSS.escape(id)}"]`)?.getAttribute("data-status") === expected,
    { id: artifactId, expected: status },
    { timeout: timeoutMs },
  );
}

async function readAttachmentEvidence(projectId, taskId) {
  return page.evaluate(async ({ id, exactTaskId }) => {
    const stableStringify = (value) => {
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
      const entries = Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
    };
    const sha256 = async (value) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        reject(new Error("RC6_2_ATTACHMENT_DATABASE_SCHEMA_MISSING"));
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const getRecord = (storeName, key, indexName = null) => {
        const store = database.transaction(storeName, "readonly").objectStore(storeName);
        return requestResult(indexName ? store.index(indexName).get(key) : store.get(key));
      };
       const invocation = await getRecord("conversationToolInvocations", exactTaskId, "taskId");
       if (!invocation || invocation.projectId !== id) return null;
       const assistantMessage = await getRecord("conversationMessages", invocation.messageId);
      if (
        !assistantMessage?.parentMessageId
        || assistantMessage.projectId !== id
        || assistantMessage.sessionId !== invocation.sessionId
        || assistantMessage.role !== "assistant"
      ) return null;
      const sourceMessage = await getRecord("conversationMessages", assistantMessage.parentMessageId);
      if (
        !sourceMessage
        || sourceMessage.projectId !== id
        || sourceMessage.sessionId !== invocation.sessionId
        || sourceMessage.role !== "user"
      ) return null;
      const attachments = [];
      for (const attachmentId of sourceMessage.attachmentIds ?? []) {
        const record = await getRecord("conversationAttachments", attachmentId);
        if (
          !record
          || record.projectId !== id
          || record.sessionId !== sourceMessage.sessionId
        ) return null;
        const sourceRevisionDigest = await sha256(stableStringify({
          domain: "selected-local-attachment-source-revision-v1",
          store: "conversationAttachments",
          schemaVersion: record.schemaVersion,
          conversationSchemaVersion: record.conversationSchemaVersion,
          id: record.id,
          projectId: record.projectId,
          sessionId: record.sessionId,
          revision: record.revision,
          contentHash: record.contentHash,
          rightsBasis: record.rightsBasis,
          rightsEvidenceHash: record.rightsEvidenceHash,
          userConfirmedRights: record.userConfirmedRights,
          rightsConfirmationSchemaVersion: record.rightsConfirmationSchemaVersion,
          parsingStatus: record.parsingStatus,
          localAnalysisOnly: record.localAnalysisOnly,
          rawContentRetained: record.rawContentRetained,
        }));
        attachments.push({
          schemaVersion: record.schemaVersion,
          conversationSchemaVersion: record.conversationSchemaVersion,
          id: record.id,
          revision: record.revision,
          format: record.format,
          byteLength: record.byteLength,
          contentHash: record.contentHash,
          sourceArtifactDigest: record.contentHash,
          sourceRevisionDigest,
          rightsBasis: ["user_supplied_local_analysis", "owned_by_user"]
            .includes(record.rightsBasis)
            ? record.rightsBasis
            : null,
          rightsEvidenceHash: record.rightsEvidenceHash,
          userConfirmedRights: record.userConfirmedRights ?? null,
          rightsConfirmationSchemaVersion:
            typeof record.rightsConfirmationSchemaVersion === "string"
            && /^[a-z0-9-]{1,80}$/u.test(record.rightsConfirmationSchemaVersion)
              ? record.rightsConfirmationSchemaVersion
              : null,
          parsingStatus: record.parsingStatus,
          localAnalysisOnly: record.localAnalysisOnly,
          rawContentRetained: record.rawContentRetained,
        });
      }
      return {
        sourceMessageId: sourceMessage.id,
        assistantMessageId: assistantMessage.id,
        attachmentCount: attachments.length,
        attachments,
      };
    } finally {
      database.close();
    }
  }, { id: projectId, exactTaskId: taskId });
}

async function runAttachmentProbe(projectId, storyBible) {
  const canonBefore = await readChapterTruth(projectId);
  const attachmentBytes = Buffer.from([
    "rights-confirmed-local-source-v1",
    `source-marker:${crypto.randomUUID()}`,
    "source-fact:an-old-watch-stopped-at-midnight",
  ].join("\n"), "utf8");
  const attachmentSummary = attachmentBytes.toString("utf8").trim();
  registerSensitiveEvidenceSentinel(attachmentSummary);
  attachmentSummary.split("\n").forEach(registerSensitiveEvidenceSentinel);
  const expectedContentHash = sha256Value(attachmentBytes);
  const expectedRightsEvidenceHash = sha256Value("composer-local-analysis-only");
  const generationPrompt = "請根據核准 Story Bible 與附件開始第一章";
  registerSensitiveEvidenceSentinel(generationPrompt);
  const composer = page.getByTestId("conversation-message-composer");
  await composer.locator('input[type="file"]').setInputFiles({
    name: "rights-confirmed-source.txt",
    mimeType: "text/plain",
    buffer: attachmentBytes,
  });
  const tray = page.getByTestId("conversation-attachment-tray");
  await tray.waitFor({ state: "visible", timeout: 90_000 });
  const rightsCheckbox = tray.getByRole("checkbox");
  assert.equal(await rightsCheckbox.isChecked(), false);
  const beforeUncheckedSubmit = await readRightsGateExecutionCounts(projectId);
  await composer.locator("textarea").fill(generationPrompt);
  await composer.getByRole("button", { name: "送出", exact: true }).click();
  await waitUntilNotBusy(composer);
  await page.locator('[role="alert"] strong').filter({
    hasText: /^CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED$/u,
  }).waitFor({ state: "visible", timeout: 30_000 });
  const afterUncheckedSubmit = await readRightsGateExecutionCounts(projectId);
  assert.deepEqual(
    afterUncheckedSubmit,
    beforeUncheckedSubmit,
    "unchecked attachment rights created persistent or model-execution evidence",
  );
  assert.deepEqual(await readChapterTruth(projectId), canonBefore);
  await rightsCheckbox.check();
  assert.equal(await rightsCheckbox.isChecked(), true);
  await composer.locator("textarea").fill(generationPrompt);
  await composer.getByRole("button", { name: "送出", exact: true }).click();
  const generated = await waitForCandidate(projectId);
  assertCandidateTruth(generated);
  assert.deepEqual(
    await readChapterTruth(projectId),
    canonBefore,
    "attachment candidate mutated Canon before rejection",
  );
  const attachmentEvidence = await readAttachmentEvidence(projectId, generated.candidate.taskId);
  assert.ok(attachmentEvidence);
  assert.equal(attachmentEvidence.attachmentCount, 1);
  const [attachment] = attachmentEvidence.attachments;
  assert.equal(attachment.schemaVersion, "novel-domain-v1");
  assert.equal(attachment.conversationSchemaVersion, "conversation-attachment-v1");
  assert.equal(attachment.format, "txt");
  assert.equal(attachment.byteLength, attachmentBytes.byteLength);
  assert.equal(attachment.contentHash, expectedContentHash);
  assert.equal(attachment.sourceArtifactDigest, expectedContentHash);
  assert.match(attachment.sourceRevisionDigest, /^[a-f0-9]{64}$/u);
  attachment.sourceMetadataDigest = finalContextSourceMetadataDigest({
    sourceKind: "selected-local-attachment-summary",
    authority: "user-selected-sanitized-untrusted-reference",
    sourceArtifactDigest: attachment.sourceArtifactDigest,
    sourceRevisionDigest: attachment.sourceRevisionDigest,
  });
  attachment.sourceIdDigest = finalContextSourceIdDigest(
    `conversation-attachment-summary:${attachment.id}`,
    "selected-local-attachment-summary",
  );
  assert.match(attachment.sourceMetadataDigest, /^[a-f0-9]{64}$/u);
  assert.match(attachment.sourceIdDigest, /^[a-f0-9]{64}$/u);
  assert.equal(attachment.rightsBasis, "user_supplied_local_analysis");
  assert.equal(attachment.rightsEvidenceHash, expectedRightsEvidenceHash);
  assert.equal(attachment.userConfirmedRights, true);
  assert.equal(
    attachment.rightsConfirmationSchemaVersion,
    "conversation-attachment-rights-confirmation-v1",
  );
  assert.equal(attachment.parsingStatus, "completed");
  assert.equal(attachment.localAnalysisOnly, true);
  assert.equal(attachment.rawContentRetained, false);
  const attachmentValue = {
    authority: "untrusted_reference_data_only",
    contentDigest: expectedContentHash,
    sanitizationStatus: "unchanged",
    detectedInjectionSignals: [],
    summary: attachmentSummary,
    mayInvokeTools: false,
    mayMutateCanonical: false,
    mayAuthorizeExternalTransfer: false,
  };
  const serializedSource = [
    "[retrieval]",
    "[EXPLICITLY_SELECTED_LOCAL_ATTACHMENT_SUMMARY_UNTRUSTED]",
    stableStringify(attachmentValue),
  ].join("\n");
  attachment.originalDigest = sha256Value(serializedSource);
  Object.defineProperty(attachment, "runnerFinalContext", {
    enumerable: false,
    value: {
      outerKind: "untrusted-reference",
      serializedSource,
      substantivePrefix: [
        "[untrusted-reference]",
        "[retrieval]",
        "[EXPLICITLY_SELECTED_LOCAL_ATTACHMENT_SUMMARY_UNTRUSTED]",
        "{",
      ].join("\n"),
    },
  });
  const finalContextProof = assertFinalContextBindings(generated, [
    storyBibleFinalContextSource(storyBible),
    attachmentFinalContextSource(attachment),
  ]);
  const approvalActions = page.locator(
    `[data-testid="conversation-approval-actions"][data-artifact-id="${generated.artifact.id}"]`,
  );
  await approvalActions.getByRole("button", { name: "放棄", exact: true }).click();
  await waitForArtifactStatus(generated.artifact.id, "rejected");
  const rejected = await readCandidateEvidence(projectId, generated.candidate.id);
  assertCandidateTruth(rejected, { status: "rejected" });
  assert.deepEqual(
    assertFinalContextBindings(rejected, [
      storyBibleFinalContextSource(storyBible),
      attachmentFinalContextSource(attachment),
    ]),
    finalContextProof,
  );
  assert.deepEqual(await readChapterTruth(projectId), canonBefore, "attachment reject mutated Canon");
  return {
    rightsUncheckedGate: {
      safeCode: "CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED",
      noAttachmentRecord: true,
      noMessage: true,
      noInvocation: true,
      noCandidate: true,
      noBrowserReceipt: true,
      noModelCall: true,
    },
    rightsCheckboxCheckedBeforeSubmit: true,
    sourceMessageId: attachmentEvidence.sourceMessageId,
    assistantMessageId: attachmentEvidence.assistantMessageId,
    attachment,
    candidate: rejected.candidate,
    browserRuntimeReceipt: rejected.browserComputeReceipt,
    finalContextProof,
    artifactId: rejected.artifact.id,
    rejected: true,
    fullReceiptRevalidatedAfterReject: true,
  };
}

async function startNewConversationSession() {
  const sidebar = page.getByTestId("conversation-session-sidebar");
  const active = sidebar.locator('[data-session-id][data-active="true"]');
  await active.waitFor({ state: "attached", timeout: 90_000 });
  const previousSessionId = await active.getAttribute("data-session-id");
  assert.ok(previousSessionId);
  await sidebar.getByRole("button", { name: "＋ 新對話", exact: true }).click();
  await page.waitForFunction((previous) => {
    const current = document.querySelector(
      '[data-testid="conversation-session-sidebar"] [data-session-id][data-active="true"]',
    )?.getAttribute("data-session-id");
    return Boolean(current && current !== previous);
  }, previousSessionId, { timeout: 90_000 });
  const newSessionId = await sidebar
    .locator('[data-session-id][data-active="true"]')
    .getAttribute("data-session-id");
  assert.ok(newSessionId);
  assert.notEqual(newSessionId, previousSessionId);
  assert.equal(await page.getByTestId("conversation-attachment-tray").count(), 0);
  await waitUntilNotBusy(page.getByTestId("conversation-message-composer"));
  return { previousSessionId, newSessionId };
}

async function runT1ContextAttestationProbe(projectId, storyBible, previousTaskId) {
  const canonBefore = await readChapterTruth(projectId);
  const modelMetadataBefore = await readModelMetadata();
  const modelAssetRequestsBefore = modelRequests.length;
  const prompt = "檢查目前章節與 Story Bible 的一致性，只回報分析，不修改 Canon";
  registerSensitiveEvidenceSentinel(prompt);
  const composer = page.getByTestId("conversation-message-composer");
  await composer.locator("textarea").fill(prompt);
  await composer.getByRole("button", { name: "送出", exact: true }).click();
  const evidence = await waitForAnalyticalCandidate(projectId, previousTaskId);
  assertT1CandidateTruth(evidence);
  assert.equal(evidence.candidate.executionReceipt.finalModelContextAttestation, null);
  assert.equal(evidence.browserComputeReceipt.finalModelContextAttestation, null);
  assert.deepEqual(await readChapterTruth(projectId), canonBefore);
  assert.equal(modelRequests.length, modelAssetRequestsBefore);
  const modelMetadataAfter = await readModelMetadata();
  assert.equal(
    modelMetadataAfter?.generationCount,
    modelMetadataBefore?.generationCount,
    "packaged T1 task invoked the WebLLM model",
  );
  assert.match(storyBible.originalDigest, FINAL_CONTEXT_DIGEST);
  return {
    taskType: "story.consistencyCheck",
    contextAttestation: "not_required",
    packagedTaskModelPinned: true,
    storyBibleSidecarStrippedBeforeT1: true,
    finalModelContextAttestation: null,
    modelAssetRequestDelta: 0,
    webLlmGenerationDelta: 0,
    candidate: evidence.candidate,
    browserRuntimeReceipt: evidence.browserComputeReceipt,
    canonMutationCount: 0,
  };
}

async function prepareBrowserAi(setupEvidence) {
  requestPhase = "model-install";
  const card = page.getByTestId("closed-ai-setup-card");
  const beforeClickRequests = modelRequests.length;
  await card.getByTestId("closed-ai-prepare-browser").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="closed-ai-setup-card"]')?.getAttribute("aria-busy") === "true",
  );
  assert.equal(await card.getAttribute("data-setup-lifecycle"), "preparing");
  const earlyRequestDeadline = Date.now() + 15_000;
  while (
    modelRequests.length === beforeClickRequests
    && Date.now() < earlyRequestDeadline
  ) {
    await page.waitForTimeout(100);
  }
  assert.ok(
    modelRequests.length > beforeClickRequests,
    "explicit setup did not start a real model request before cancellation",
  );
  await card.getByRole("button", { name: "取消準備", exact: true }).click();
  await waitUntilNotBusy(card);
  assert.equal(await card.getAttribute("data-setup-lifecycle"), "cancelled");
  assert.match(await card.textContent() ?? "", /已取消準備/u);
  assert.equal(
    await card.getByTestId("closed-ai-prepare-browser").textContent(),
    "重試 Browser AI",
  );
  const metadataAfterCancel = await readModelMetadata().catch(() => null);
  assert.notEqual(
    metadataAfterCancel?.cacheVerified,
    true,
    "cancelled setup was incorrectly promoted to a verified model",
  );
  const requestsAtCancel = modelRequests.length;
  await card.getByTestId("closed-ai-prepare-browser").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="closed-ai-setup-card"]')?.getAttribute("data-setup-lifecycle") === "preparing",
  );
  await waitForBrowserAiReady(card);
  assert.ok(
    modelRequests.length > requestsAtCancel,
    "retry did not resume a real model payload request after cancellation",
  );
  const composerTruth = page.getByTestId("conversation-message-composer");
  const consumerReadiness = {
    generationVerifiedBackends: Number(
      await composerTruth.getAttribute("data-closed-ai-generation-verified-backends"),
    ),
    activeBackend: await composerTruth.getAttribute("data-closed-ai-active-backend"),
    externalFallback: await composerTruth.getAttribute("data-closed-ai-external-fallback") === "true",
    silentExternalFallback: await composerTruth.getAttribute("data-closed-ai-silent-external-fallback") === "true",
  };
  assert.ok(consumerReadiness.generationVerifiedBackends >= 1);
  assert.equal(consumerReadiness.activeBackend, "browser-ai");
  assert.equal(consumerReadiness.externalFallback, false);
  assert.equal(consumerReadiness.silentExternalFallback, false);
  const modelMetadata = await readModelMetadata();
  assert.ok(modelMetadata);
  assert.equal(modelMetadata.installStatus, "ready");
  assert.equal(modelMetadata.cacheVerified, true);
  assert.equal(modelMetadata.shardIntegrityVerified, true);
  assert.ok(modelMetadata.verifiedShardCount > 0);
  assert.match(modelMetadata.shardManifestDigest, /^[a-f0-9]{64}$/u);
  requestPhase = "inference";

  return {
    setup: {
      ...setupEvidence,
      explicitInstallClicked: true,
      cancellation: {
        lifecycle: "cancelled",
        cancelledBeforeVerification: true,
        modelPayloadRequestCountAtCancel: requestsAtCancel,
        incompleteModelPromoted: false,
      },
      retryAfterCancel: true,
      modelPayloadRequestCount: modelRequests.length,
      modelPayloadHosts: [...new Set(modelRequests.map((item) => item.host))].sort(),
      metadata: modelMetadata,
    },
    consumerReadiness,
  };
}

async function runGenerationLifecycle(projectId, storyBible) {
  const canonBefore = await readChapterTruth(projectId);
  await assertMaliciousDomDiagnosticsAreRejected();
  const requiredSources = [storyBibleFinalContextSource(storyBible)];
  const generationPrompt = "幫我開始第一章";
  registerSensitiveEvidenceSentinel(generationPrompt);
  const composer = page.locator('textarea[aria-label="小說專案訊息"]');
  await composer.fill("幫我開始第一章");
  await page.getByRole("button", { name: "送出", exact: true }).click();
  const first = await waitForCandidate(projectId);
  assertCandidateTruth(first);
  const firstContextProof = assertFinalContextBindings(first, requiredSources);
  assert.deepEqual(await readChapterTruth(projectId), canonBefore, "first candidate mutated Canon before approval");

  const firstCard = page.locator(`[data-artifact-id="${first.artifact.id}"]`).first();
  const firstArticle = firstCard.locator("xpath=ancestor::article");
  const directRegenerate = firstArticle.getByRole("button", {
    name: "重新產生",
    exact: true,
  }).last();
  await directRegenerate.click();
  await page.waitForFunction(() => (
    [...document.querySelectorAll("button")].some((button) => (
      button.textContent?.trim() === "產生中…"
      && button.getAttribute("aria-busy") === "true"
      && button.disabled
    ))
  ));
  const second = await waitForCandidate(projectId, first.candidate.taskId);
  assertCandidateTruth(second, { previous: first, regenerationAttempt: 1 });
  const secondContextProof = assertFinalContextBindings(second, requiredSources);
  assert.notEqual(second.candidate.id, first.candidate.id);
  assert.notEqual(second.candidate.taskId, first.candidate.taskId);
  assert.notEqual(second.candidate.contentDigest, first.candidate.contentDigest);
  const firstAfterDirectRegeneration = await readCandidateEvidence(
    projectId,
    first.candidate.id,
  );
  assert.equal(firstAfterDirectRegeneration.candidate.status, "awaiting-approval");
  assert.equal(firstAfterDirectRegeneration.artifact.status, "candidate");
  assertCandidateTruth(firstAfterDirectRegeneration);
  assert.deepEqual(
    assertFinalContextBindings(firstAfterDirectRegeneration, requiredSources),
    firstContextProof,
  );
  assert.deepEqual(
    await readChapterTruth(projectId),
    canonBefore,
    "direct regeneration mutated Canon or closed its awaiting sibling",
  );

  const secondCard = page.locator(`[data-artifact-id="${second.artifact.id}"]`).first();
  await secondCard.getByRole("button", { name: "放棄", exact: true }).click();
  await waitForArtifactStatus(second.artifact.id, "rejected");
  const rejectedSecond = await readCandidateEvidence(projectId, second.candidate.id);
  assertCandidateTruth(rejectedSecond, {
    status: "rejected",
    previous: first,
    regenerationAttempt: 1,
  });
  assert.deepEqual(
    assertFinalContextBindings(rejectedSecond, requiredSources),
    secondContextProof,
  );
  assert.deepEqual(await readChapterTruth(projectId), canonBefore, "reject mutated Canon");

  const modelAssetRequestsBeforeReload = modelRequests.length;
  const modelMetadataBeforeReload = await readModelMetadata();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("conversation-first-workspace").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await assertExactOrigin();
  assert.equal(
    modelRequests.length,
    modelAssetRequestsBeforeReload,
    "reload fetched model assets despite the verified local cache",
  );
  const modelMetadataAfterReload = await readModelMetadata();
  assert.equal(modelMetadataAfterReload?.installStatus, "ready");
  assert.equal(modelMetadataAfterReload?.cacheVerified, true);
  assert.equal(modelMetadataAfterReload?.shardIntegrityVerified, true);
  assert.equal(
    modelMetadataAfterReload?.generationCount,
    modelMetadataBeforeReload?.generationCount,
  );
  const rejectedAfterReload = await readCandidateEvidence(projectId, second.candidate.id);
  assertCandidateTruth(rejectedAfterReload, {
    status: "rejected",
    previous: first,
    regenerationAttempt: 1,
  });
  assert.deepEqual(
    assertFinalContextBindings(rejectedAfterReload, requiredSources),
    secondContextProof,
  );

  const secondArticle = secondCard.locator("xpath=ancestor::article");
  const chainedRegenerate = secondArticle.getByRole("button", {
    name: "重新產生",
    exact: true,
  }).last();
  await chainedRegenerate.click();
  const third = await waitForCandidate(projectId, second.candidate.taskId);
  assert.equal(
    modelRequests.length,
    modelAssetRequestsBeforeReload,
    "chained T2 inference fetched model assets instead of reusing the verified cache",
  );
  const modelMetadataAfterChainedInference = await readModelMetadata();
  assert.ok(
    modelMetadataAfterChainedInference.generationCount
      > modelMetadataAfterReload.generationCount,
    "chained T2 evidence did not record a WebLLM generation",
  );
  assertCandidateTruth(third, { previous: second, regenerationAttempt: 2 });
  const finalContextProof = assertFinalContextBindings(third, requiredSources);
  assert.notEqual(third.candidate.id, second.candidate.id);
  assert.notEqual(third.candidate.taskId, second.candidate.taskId);
  assert.notEqual(third.candidate.contentDigest, second.candidate.contentDigest);
  assert.deepEqual(await readChapterTruth(projectId), canonBefore, "chained regeneration mutated Canon before approval");

  const thirdCard = page.locator(`[data-artifact-id="${third.artifact.id}"]`).first();
  await thirdCard.getByRole("button", { name: "採用", exact: true }).click();
  await waitForArtifactStatus(third.artifact.id, "approved");
  const canonAfterApproval = await readChapterTruth(projectId);
  assert.equal(canonAfterApproval.chapterId, canonBefore.chapterId);
  assert.equal(canonAfterApproval.revision, canonBefore.revision + 1);
  assert.notEqual(canonAfterApproval.contentDigest, canonBefore.contentDigest);
  const approvedBeforeReload = await readCandidateEvidence(projectId, third.candidate.id);
  assertCandidateTruth(approvedBeforeReload, {
    status: "committed",
    canonicalMutationCount: 1,
    previous: second,
    regenerationAttempt: 2,
  });
  assert.deepEqual(
    assertFinalContextBindings(approvedBeforeReload, requiredSources),
    finalContextProof,
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 90_000 });
  await assertExactOrigin();
  const canonAfterReload = await readChapterTruth(projectId);
  assert.deepEqual(canonAfterReload, canonAfterApproval);
  const persisted = await readCandidateEvidence(projectId, third.candidate.id);
  assert.equal(persisted.candidate.id, third.candidate.id);
  assertCandidateTruth(persisted, {
    status: "committed",
    canonicalMutationCount: 1,
    previous: second,
    regenerationAttempt: 2,
  });
  assert.deepEqual(
    assertFinalContextBindings(persisted, requiredSources),
    finalContextProof,
  );

  return {
    firstCandidateBeforeApproval: first.candidate,
    directRegenerationCandidate: second.candidate,
    directRegenerationSourceAfterward: {
      id: firstAfterDirectRegeneration.candidate.id,
      taskId: firstAfterDirectRegeneration.candidate.taskId,
      status: firstAfterDirectRegeneration.candidate.status,
      canonicalMutationCount: firstAfterDirectRegeneration.candidate.canonicalMutationCount,
    },
    rejectedCandidate: {
      id: rejectedSecond.candidate.id,
      taskId: rejectedSecond.candidate.taskId,
      status: rejectedSecond.candidate.status,
      canonicalMutationCount: rejectedSecond.candidate.canonicalMutationCount,
    },
    regeneratedCandidateBeforeApproval: third.candidate,
    browserRuntimeReceipt: third.browserComputeReceipt,
    finalContextProof,
    modelCacheReuse: {
      reloadBeforeChainedT2: true,
      modelAssetRequestDeltaAcrossReloadAndInference: 0,
      webLlmGenerationObservedAfterReload: true,
      cacheVerifiedAfterReload: true,
    },
    approval: {
      artifactId: third.artifact.id,
      status: "approved",
      canonRevisionBefore: canonBefore.revision,
      canonRevisionAfter: canonAfterApproval.revision,
      persistedAfterReload: true,
      fullReceiptRevalidatedBeforeAndAfterReload: true,
    },
  };
}

try {
  const launched = await launch();
  browser = launched.browser;
  context = launched.context;
  assert.equal(context.pages().length, 1, "fresh Edge profile opened an unexpected startup page");
  page = context.pages()[0] ?? await context.newPage();
  assert.equal(page.url(), "about:blank");
  context.on("request", (request) => {
    const url = request.url();
    if (!isAllowedCrossOriginRequest(request)) {
      disallowedCrossOriginRequests.push(safeCrossOriginProjection(url));
    }
    if (isModelPayload(url)) {
      const parsed = new URL(url);
      modelRequests.push({ host: parsed.host, path: parsed.pathname });
    }
    if (isProhibitedExternalAi(url)) {
      prohibitedExternalAiRequests.push(new URL(url).host);
    }
  });
  requestPhase = "release-identity";
  const edgeIdentity = await readEdgeIdentity(launched.evidence);
  const releaseIdentityBeforeApp = await readReleaseIdentityTruth({ navigate: true });
  const freshStorage = await readFreshStorageTruth();
  requestPhase = "project-setup";
  const projectId = await createProject();
  const storyBible = mode === "setup" ? null : await createApprovedStoryBible(projectId);
  const setup = await inspectFreshSetup();
  let lifecycle;
  if (mode === "setup") {
    lifecycle = { setup };
  } else {
    const prepared = await prepareBrowserAi(setup);
    const attachmentProbe = await runAttachmentProbe(projectId, storyBible);
    const attachmentToT1 = await startNewConversationSession();
    const t1ContextAttestationProbe = await runT1ContextAttestationProbe(
      projectId,
      storyBible,
      attachmentProbe.candidate.taskId,
    );
    const t1ToLifecycle = await startNewConversationSession();
    assert.equal(t1ToLifecycle.previousSessionId, attachmentToT1.newSessionId);
    const conversationIsolation = {
      attachmentSessionId: attachmentToT1.previousSessionId,
      t1SessionId: attachmentToT1.newSessionId,
      lifecycleSessionId: t1ToLifecycle.newSessionId,
      allDistinct: new Set([
        attachmentToT1.previousSessionId,
        attachmentToT1.newSessionId,
        t1ToLifecycle.newSessionId,
      ]).size === 3,
    };
    assert.equal(conversationIsolation.allDistinct, true);
    const ordinaryLifecycle = await runGenerationLifecycle(projectId, storyBible);
    lifecycle = {
      ...prepared,
      storyBible,
      attachmentProbe,
      t1ContextAttestationProbe,
      conversationIsolation,
      ...ordinaryLifecycle,
    };
  }
  const releaseIdentityAfterReload = await readReleaseIdentityTruth();
  assert.deepEqual(releaseIdentityAfterReload, releaseIdentityBeforeApp);
  const edgeVersionAfterReload = await edgeCdpSession.send("Browser.getVersion");
  assert.equal(edgeVersionAfterReload.product, edgeIdentity.product);
  assert.equal(edgeVersionAfterReload.protocolVersion, edgeIdentity.protocolVersion);
  assert.equal(context.pages().length, 1, "gate opened an unexpected second Edge page");
  assert.equal(context.pages()[0], page, "gate changed the authoritative Edge page");
  assert.equal(browser?.contexts().length, 1, "gate opened an unexpected Edge context");
  assert.equal(browser?.contexts()[0], context, "gate changed the persistent Edge context");
  edgeIdentity.sameBrowserAfterReload = true;
  edgeIdentity.browserContextCount = 1;
  edgeIdentity.pageCount = 1;
  assert.deepEqual(prohibitedExternalAiRequests, []);
  assert.deepEqual(disallowedCrossOriginRequests, []);
  finalOutput = {
    schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v3",
    status: "PASS",
    mode,
    exactOrigin: expectedOrigin,
    freshBrowserContext: true,
    releaseIdentity: releaseIdentityAfterReload,
    edgeIdentity,
    freshStorage,
    mocksInstalled: false,
    prohibitedExternalAiRequestCount: 0,
    crossOriginPolicy: {
      policy: "phase-aware-default-deny-v1",
      immutableModelAssetsAllowedOnlyDuringExplicitInstall: true,
      disallowedRequestCount: 0,
    },
    projectId,
    ...lifecycle,
    completedAt: new Date().toISOString(),
  };
  assertSafeEvidenceProjection(finalOutput);
} catch (error) {
  const diagnosticCodes = await readSanitizedQualityCodes().catch(() => []);
  const browserRuntimeEvidence = await readSanitizedBrowserRuntimeEvidence().catch(() => []);
  finalOutput = {
    schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v3",
    status: "FAIL",
    mode,
    exactOrigin: expectedOrigin,
    freshBrowserContext: true,
    modelPayloadRequestCount: modelRequests.length,
    prohibitedExternalAiRequestCount: prohibitedExternalAiRequests.length,
    error: {
      code: safeFailureCode(error),
      diagnosticCodes: sanitizeDiagnosticCodes(diagnosticCodes),
      browserRuntimeEvidence: sanitizeBrowserRuntimeEvidence(browserRuntimeEvidence),
    },
    completedAt: new Date().toISOString(),
  };
  process.exitCode = 1;
} finally {
  await edgeCdpSession?.detach().catch(() => undefined);
  let cleanupFailed = false;
  await context?.close().catch(() => { cleanupFailed = true; });
  await browser?.close().catch(() => undefined);
  let profileDisposed = false;
  if (profilePath) {
    const temporaryRoot = resolve(tmpdir());
    const resolvedProfile = resolve(profilePath);
    const withinTemporaryRoot = resolvedProfile.toLocaleLowerCase("en-US").startsWith(
      `${temporaryRoot.toLocaleLowerCase("en-US")}${sep}`,
    );
    if (!withinTemporaryRoot || !basename(resolvedProfile).startsWith("novel-rc6-2-edge-")) {
      cleanupFailed = true;
    } else {
      await rm(resolvedProfile, { recursive: true, force: true })
        .then(async () => {
          profileDisposed = await stat(resolvedProfile)
            .then(() => false)
            .catch((error) => error?.code === "ENOENT");
          if (!profileDisposed) cleanupFailed = true;
        })
        .catch(() => { cleanupFailed = true; });
    }
  }
  if (!finalOutput) {
    finalOutput = {
      schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v3",
      status: "FAIL",
      mode,
      exactOrigin: expectedOrigin,
      error: {
        code: "RC6_2_CLOSED_AI_GATE_FAILED",
        diagnosticCodes: [],
        browserRuntimeEvidence: [],
      },
    };
    process.exitCode = 1;
  }
  if (cleanupFailed) {
    finalOutput.status = "FAIL";
    finalOutput.error = {
      code: "RC6_2_CLOSED_AI_GATE_FAILED",
      diagnosticCodes: [],
      browserRuntimeEvidence: [],
    };
    process.exitCode = 1;
  }
  finalOutput.profileDisposed = profileDisposed;
  finalOutput.completedAt = new Date().toISOString();
  try {
    assertSafeEvidenceProjection(finalOutput);
  } catch {
    finalOutput = {
      schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v3",
      status: "FAIL",
      mode,
      exactOrigin: expectedOrigin,
      freshBrowserContext: true,
      profileDisposed,
      error: {
        code: "RC6_2_CLOSED_AI_GATE_FAILED",
        diagnosticCodes: [],
        browserRuntimeEvidence: [],
      },
      completedAt: new Date().toISOString(),
    };
    process.exitCode = 1;
  }
  const serialized = JSON.stringify(finalOutput, null, 2);
  if (finalOutput.status === "PASS") console.log(serialized);
  else console.error(serialized);
}
