import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const mode = process.argv[2] ?? "generation";
if (!new Set(["setup", "generation", "all"]).has(mode)) {
  throw new Error(`RC6_2_CLOSED_AI_UNKNOWN_MODE:${mode}`);
}

const configuredOrigin = process.env.RC6_2_CLOSED_AI_BASE_URL?.trim();
if (!configuredOrigin) {
  throw new Error("RC6_2_CLOSED_AI_BASE_URL_REQUIRED");
}
const expectedOrigin = new URL(configuredOrigin).origin;
if (
  new URL(expectedOrigin).protocol !== "https:"
  && process.env.RC6_2_CLOSED_AI_ALLOW_HTTP_LOCAL !== "1"
) {
  throw new Error("RC6_2_CLOSED_AI_EXACT_HTTPS_ORIGIN_REQUIRED");
}

const setupTimeoutMs = Number(process.env.RC6_2_CLOSED_AI_SETUP_TIMEOUT_MS ?? 1_800_000);
const generationTimeoutMs = Number(process.env.RC6_2_CLOSED_AI_GENERATION_TIMEOUT_MS ?? 1_200_000);
const headless = process.env.RC6_2_CLOSED_AI_HEADLESS !== "0";
const modelRequests = [];
const prohibitedExternalAiRequests = [];
let browser;
let context;
let page;

const SAFE_DIAGNOSTIC_CODES = Object.freeze([
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
const SAFE_FAILURE_CODES = new Set([
  "RC6_2_CLOSED_AI_GATE_FAILED",
  "RC6_2_CLOSED_AI_SETUP_FAILED",
  "RC6_2_CLOSED_AI_SETUP_TIMEOUT",
  "RC6_2_CLOSED_AI_UI_BUSY_TIMEOUT",
  "RC6_2_CLOSED_AI_GENERATION_FAILED",
  "RC6_2_CLOSED_AI_GENERATION_TIMEOUT",
  "BROWSER_AI_QUALITY_INSUFFICIENT",
  "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
  "BROWSER_AI_MANDATORY_PROMPT_CONTRACT_MISSING",
  "BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED",
  "CLOSED_AGENT_EVALUATION_BLOCKED",
  "CLOSED_AI_REQUIRED_BACKEND_NOT_READY",
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
  if (!Array.isArray(values)) return [];
  const stages = new Set();
  return values.flatMap((value) => {
    if (
      !value
      || typeof value !== "object"
      || !SAFE_RUNTIME_STAGE_SET.has(value.stage)
      || !SAFE_RUNTIME_FINISH_REASON_SET.has(value.finishReason)
      || stages.has(value.stage)
    ) return [];
    stages.add(value.stage);
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
    ) return [];
    return [{
      stage: value.stage,
      finishReason: value.finishReason,
      completionTokens,
      rawOutputCharacters,
      normalizedOutputCharacters,
      observedHanCharacters,
    }];
  }).slice(0, 3).sort(
    (left, right) => SAFE_RUNTIME_STAGES.indexOf(left.stage)
      - SAFE_RUNTIME_STAGES.indexOf(right.stage),
  );
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
  return url.hostname === "huggingface.co"
    || (
      url.hostname === "raw.githubusercontent.com"
      && url.pathname.includes("binary-mlc-llm-libs")
    );
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

async function launch() {
  const launchOptions = {
    headless,
    args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"],
  };
  const channel = process.env.RC6_2_CLOSED_AI_BROWSER_CHANNEL?.trim();
  if (channel) return chromium.launch({ ...launchOptions, channel });
  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    try {
      return await chromium.launch({ ...launchOptions, channel: "msedge" });
    } catch {
      throw error;
    }
  }
}

async function assertExactOrigin() {
  assert.equal(new URL(page.url()).origin, expectedOrigin, "browser was redirected away from the exact gate origin");
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

async function waitUntilNotBusy(locator, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.getAttribute("aria-busy") === "false") return;
    await page.waitForTimeout(250);
  }
  throw gateError("RC6_2_CLOSED_AI_UI_BUSY_TIMEOUT");
}

async function installSanitizedQualityObserver() {
  await page.evaluate(({ allowedCodes, allowedStages, allowedFinishReasons }) => {
    const allowed = new Set(allowedCodes);
    const stages = new Set(allowedStages);
    const finishReasons = new Set(allowedFinishReasons);
    const codes = new Set();
    const evidence = new Map();
    const runtimeEvidencePattern = /BROWSER_RUNTIME_EVIDENCE:(initial|repair|extension|recovery):(stop|length|tool_calls|abort|unavailable):(u|\d{1,4}):(u|\d{1,5}):(u|\d{1,5}):(u|\d{1,5})/gu;
    const parseRuntimeInteger = (value, maximum) => {
      if (value === "u") return null;
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= maximum
        ? parsed
        : undefined;
    };
    const collect = () => {
      for (const node of document.querySelectorAll('[role="status"]')) {
        const text = node.textContent ?? "";
        for (const code of allowed) {
          if (text.includes(code) && codes.size < 12) codes.add(code);
        }
        for (const match of text.matchAll(runtimeEvidencePattern)) {
          const [, stage, finishReason, completion, raw, normalized, han] = match;
          if (!stages.has(stage) || !finishReasons.has(finishReason)) continue;
          const value = {
            stage,
            finishReason,
            completionTokens: parseRuntimeInteger(completion, 4_096),
            rawOutputCharacters: parseRuntimeInteger(raw, 20_000),
            normalizedOutputCharacters: parseRuntimeInteger(normalized, 20_000),
            observedHanCharacters: parseRuntimeInteger(han, 10_000),
          };
          if (Object.values(value).some((item) => item === undefined)) continue;
          if (!evidence.has(stage) && evidence.size < 3) evidence.set(stage, value);
        }
      }
    };
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    Object.defineProperty(window, "__rc62SanitizedQualityObserver", {
      configurable: true,
      value: { codes, evidence, observer },
    });
  }, {
    allowedCodes: SAFE_DIAGNOSTIC_CODES,
    allowedStages: SAFE_RUNTIME_STAGES,
    allowedFinishReasons: SAFE_RUNTIME_FINISH_REASONS,
  });
}

async function readSanitizedQualityCodes() {
  const values = await page.evaluate(() => {
    const state = window.__rc62SanitizedQualityObserver;
    return state?.codes ? [...state.codes].sort() : [];
  });
  return sanitizeDiagnosticCodes(values);
}

async function readSanitizedBrowserRuntimeEvidence() {
  const values = await page.evaluate(() => {
    const state = window.__rc62SanitizedQualityObserver;
    return state?.evidence ? [...state.evidence.values()] : [];
  });
  return sanitizeBrowserRuntimeEvidence(values);
}

async function assertMaliciousDomDiagnosticsAreRejected() {
  await page.evaluate(async () => {
    const node = document.createElement("div");
    node.hidden = true;
    node.setAttribute("role", "status");
    node.textContent = "private prompt and output QUALITY_ATTACKER_FAKE QUALITY_OUTPUT_ATTACKER_FAKE CANDIDATE_ATTACKER_FAKE BROWSER_WEBLLM_ATTACKER_FAKE QUALITY_EMPTY_CANDIDATE BROWSER_RUNTIME_EVIDENCE:initial:attacker:12:30:30:20 BROWSER_RUNTIME_EVIDENCE:repair:stop:9999:99999:99999:99999";
    document.body.append(node);
    await new Promise((resolve) => setTimeout(resolve, 0));
    node.remove();
  });
  assert.deepEqual(await readSanitizedQualityCodes(), ["QUALITY_EMPTY_CANDIDATE"]);
  assert.deepEqual(await readSanitizedBrowserRuntimeEvidence(), []);
  await page.evaluate(() => {
    window.__rc62SanitizedQualityObserver?.codes?.clear();
    window.__rc62SanitizedQualityObserver?.evidence?.clear();
  });
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

async function readPublicHealthTruth() {
  const truth = await page.evaluate(async (origin) => {
    const response = await fetch(`${origin}/api/ai/health?rc6_2=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json();
    return {
      httpStatus: response.status,
      cacheControl: response.headers.get("cache-control"),
      appCommit: body.appCommit,
      deploymentId: body.deploymentId,
      releaseTag: body.releaseTag,
      closedAiRuntimeStatus: body.closedAiRuntimeStatus,
      closedAiGenerationVerifiedBackends: body.closedAiGenerationVerifiedBackends,
      closedAiActiveBackend: body.closedAiActiveBackend,
      closedAiExternalFallback: body.closedAiExternalFallback,
      browserAiStatus: body.browserAiStatus,
      browserClosedAiStatus: body.browserClosedAiStatus,
      threeClosedAISharedSystemStatus: body.threeClosedAISharedSystemStatus,
      threeClosedAiArchitectureStatus: body.threeClosedAiArchitectureStatus,
      serverRuntimeTruth: body.closedAiServerRuntimeTruth,
    };
  }, expectedOrigin);
  assert.equal(truth.httpStatus, 200);
  assert.match(truth.cacheControl ?? "", /no-store/u);
  assert.match(truth.appCommit ?? "", /^[a-f0-9]{40}$/u);
  assert.ok(String(truth.deploymentId ?? "").trim());
  assert.ok(String(truth.releaseTag ?? "").trim());
  assert.equal(truth.closedAiRuntimeStatus, "client_probe_required");
  assert.equal(truth.closedAiGenerationVerifiedBackends, 0);
  assert.equal(truth.closedAiActiveBackend, null);
  assert.equal(truth.closedAiExternalFallback, false);
  assert.equal(truth.browserAiStatus, "client_probe_required");
  assert.equal(truth.browserClosedAiStatus, "setup_required");
  assert.equal(truth.threeClosedAISharedSystemStatus, "not_verified");
  assert.equal(truth.threeClosedAiArchitectureStatus, "not_verified");
  assert.equal(truth.serverRuntimeTruth?.generationVerifiedBackends, 0);
  assert.equal(truth.serverRuntimeTruth?.activeBackend, null);
  assert.equal(truth.serverRuntimeTruth?.externalFallback, false);
  assert.ok(truth.serverRuntimeTruth?.backends?.every(
    (backend) => backend.generationVerified === false,
  ));
  return truth;
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

async function readCandidateEvidence(projectId, candidateId = null) {
  return page.evaluate(async ({ id, candidateId: exactCandidateId }) => {
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
      const artifact = artifacts.find((record) => record.sourceMessageId === invocation?.messageId)
        ?? artifacts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
        ?? null;
      const computeReceipts = await requestResult(
        offloadDatabase.transaction("execution-receipts", "readonly")
          .objectStore("execution-receipts").getAll(),
      );
      const computeReceipt = computeReceipts.find(
        (record) => record.receiptId === candidate.generationTelemetry?.browserComputeReceiptId,
      ) ?? null;
      return {
        candidate: {
          id: candidate.id,
          taskId: candidate.taskId,
          backendId: candidate.backendId,
          actualExecutor: candidate.actualExecutor,
          modelId: candidate.modelId,
          modelDigest: candidate.modelDigest,
          contentDigest: candidate.contentDigest,
          normalizedContentDigest,
          status: candidate.status,
          candidateOnly: candidate.candidateOnly,
          canonicalMutationCount: candidate.canonicalMutationCount,
          externalRequest: candidate.externalRequest,
          dataLeftDevice: candidate.dataLeftDevice,
          regeneration: candidate.regeneration ?? null,
          executionReceipt: candidate.executionReceipt ? {
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
          } : null,
        },
        invocation: invocation ? {
          id: invocation.id,
          taskId: invocation.taskId,
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
          receiptId: computeReceipt.receiptId,
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
        } : null,
        candidateCount: candidates.length,
      };
    } finally {
      closedDatabase.close();
      appDatabase.close();
      offloadDatabase.close();
    }
  }, { id: projectId, candidateId });
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
  assert.equal(evidence.invocation?.actualExecutor, "browser-ai");
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
  assert.equal(evidence.browserComputeReceipt?.actualExecutor, "webllm-worker");
  assert.equal(evidence.browserComputeReceipt?.browserGenerationUsed, true);
  assert.equal(evidence.browserComputeReceipt?.externalAIUsed, false);
  assert.equal(evidence.browserComputeReceipt?.dataLeftDevice, false);
  assert.equal(evidence.browserComputeReceipt?.candidateOnly, true);
  assert.equal(evidence.browserComputeReceipt?.canonicalMutationCount, 0);
  assert.equal(evidence.browserComputeReceipt?.rawPromptStored, false);
  assert.equal(evidence.browserComputeReceipt?.rawOutputStored, false);
  assert.equal(evidence.artifact?.candidateDigest, evidence.candidate.normalizedContentDigest);
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
    const failedInvocation = await page.evaluate(async (id) => {
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
          .filter((record) => record.projectId === id && record.status === "failed")
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        return failed ? { taskId: failed.taskId, safeErrorCode: failed.safeErrorCode } : null;
      } finally {
        database.close();
      }
    }, projectId);
    if (failedInvocation && failedInvocation.taskId !== previousTaskId) {
      throw gateError(
        SAFE_FAILURE_CODES.has(failedInvocation.safeErrorCode)
          ? failedInvocation.safeErrorCode
          : "RC6_2_CLOSED_AI_GENERATION_FAILED",
      );
    }
    if (Date.now() >= nextHeartbeat) {
      process.stderr.write(`[RC6.2 Closed AI] candidate generation in progress (${Math.round((Date.now() - startedAt) / 1_000)}s)\n`);
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

async function runGenerationLifecycle(projectId, setupEvidence) {
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

  const canonBefore = await readChapterTruth(projectId);
  await installSanitizedQualityObserver();
  await assertMaliciousDomDiagnosticsAreRejected();
  const composer = page.locator('textarea[aria-label="小說專案訊息"]');
  await composer.fill("幫我開始第一章");
  await page.getByRole("button", { name: "送出", exact: true }).click();
  const first = await waitForCandidate(projectId);
  assertCandidateTruth(first);
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
  assert.notEqual(second.candidate.id, first.candidate.id);
  assert.notEqual(second.candidate.taskId, first.candidate.taskId);
  assert.notEqual(second.candidate.contentDigest, first.candidate.contentDigest);
  const firstAfterDirectRegeneration = await readCandidateEvidence(
    projectId,
    first.candidate.id,
  );
  assert.equal(firstAfterDirectRegeneration.candidate.status, "awaiting-approval");
  assert.equal(firstAfterDirectRegeneration.artifact.status, "candidate");
  assert.deepEqual(
    await readChapterTruth(projectId),
    canonBefore,
    "direct regeneration mutated Canon or closed its awaiting sibling",
  );

  const secondCard = page.locator(`[data-artifact-id="${second.artifact.id}"]`).first();
  await secondCard.getByRole("button", { name: "放棄", exact: true }).click();
  await waitForArtifactStatus(second.artifact.id, "rejected");
  const rejectedSecond = await readCandidateEvidence(projectId, second.candidate.id);
  assert.equal(rejectedSecond.candidate.status, "rejected");
  assert.equal(rejectedSecond.candidate.canonicalMutationCount, 0);
  assert.deepEqual(await readChapterTruth(projectId), canonBefore, "reject mutated Canon");

  const secondArticle = secondCard.locator("xpath=ancestor::article");
  const chainedRegenerate = secondArticle.getByRole("button", {
    name: "重新產生",
    exact: true,
  }).last();
  await chainedRegenerate.click();
  const third = await waitForCandidate(projectId, second.candidate.taskId);
  assertCandidateTruth(third, { previous: second, regenerationAttempt: 2 });
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

  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 90_000 });
  await assertExactOrigin();
  const canonAfterReload = await readChapterTruth(projectId);
  assert.deepEqual(canonAfterReload, canonAfterApproval);
  const persisted = await readCandidateEvidence(projectId);
  assert.equal(persisted.candidate.id, third.candidate.id);
  assert.equal(persisted.candidate.status, "committed");
  assert.equal(persisted.candidate.canonicalMutationCount, 1);

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
    approval: {
      artifactId: third.artifact.id,
      status: "approved",
      canonRevisionBefore: canonBefore.revision,
      canonRevisionAfter: canonAfterApproval.revision,
      persistedAfterReload: true,
    },
  };
}

try {
  browser = await launch();
  context = await browser.newContext({
    locale: "zh-TW",
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  });
  page = await context.newPage();
  page.on("request", (request) => {
    const url = request.url();
    if (isModelPayload(url)) {
      const parsed = new URL(url);
      modelRequests.push({ host: parsed.host, path: parsed.pathname });
    }
    if (isProhibitedExternalAi(url)) {
      prohibitedExternalAiRequests.push(new URL(url).host);
    }
  });
  const projectId = await createProject();
  const publicHealth = await readPublicHealthTruth();
  const setup = await inspectFreshSetup();
  const lifecycle = mode === "setup"
    ? { setup }
    : await runGenerationLifecycle(projectId, setup);
  assert.deepEqual(prohibitedExternalAiRequests, []);
  console.log(JSON.stringify({
    schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v1",
    status: "PASS",
    mode,
    exactOrigin: expectedOrigin,
    freshBrowserContext: true,
    mocksInstalled: false,
    prohibitedExternalAiRequestCount: 0,
    projectId,
    publicHealth,
    ...lifecycle,
    completedAt: new Date().toISOString(),
  }, null, 2));
} catch (error) {
  const diagnosticCodes = await readSanitizedQualityCodes().catch(() => []);
  const browserRuntimeEvidence = await readSanitizedBrowserRuntimeEvidence().catch(() => []);
  console.error(JSON.stringify({
    schemaVersion: "p24b-rc6-2-closed-ai-browser-evidence-v1",
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
  }, null, 2));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}
