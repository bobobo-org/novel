import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..", "..");
const outputDir = path.join(root, "artifacts", "pr23-r22-luna-unblock");
const launcherPath = path.join(root, "local-ai", "bridge", "launcher.mjs");
const runId = `edge-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const profileDir = path.join(os.tmpdir(), `novel-pr23-r22-${runId}`);
const startedAt = new Date().toISOString();

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : fallback;
}

const previewUrl = option(
  "--preview-url",
  "https://novel-15gi72tr4-lqtechs-projects.vercel.app",
).replace(/\/+$/u, "");
const expectedDeploymentId = option(
  "--expected-deployment-id",
  "dpl_5G2ggFhtgvLJxB8Q29X94RMoXFxY",
);
const expectedMergeRef = option(
  "--expected-merge-ref",
  "169328016111d69e0adab784d817a5653113a852",
);
const preflightOnly = process.argv.includes("--preflight-only");
const leaveBridgeRunning = process.argv.includes("--leave-bridge-running");

assert.match(previewUrl, /^https:\/\/novel-[a-z0-9-]+\.vercel\.app$/u);
assert.match(expectedDeploymentId, /^dpl_[A-Za-z0-9]+$/u);
assert.match(expectedMergeRef, /^[a-f0-9]{40}$/u);

const PHASES = new Set([
  "BOOT",
  "PERMISSION_CHECK",
  "PRE_PAIRING",
  "PAIR_REQUEST",
  "PAIR_CONFIRM",
  "MODEL_VERIFY",
  "RELOAD_RECOVERY",
  "PROJECT_CREATE",
  "CONTEXT_LOAD",
  "CHAPTER_CONTINUE",
  "CANDIDATE_DISCARD",
  "CHAPTER_CONTINUE_APPROVAL",
  "CHAPTER_REWRITE",
  "ABC_CHOICES",
  "FULL_WORKSPACE",
  "BACKUP",
  "RESTORE",
  "CLEANUP",
]);
const CANON_STORES = [
  "projects",
  "chapters",
  "characters",
  "relationships",
  "worlds",
  "worldRules",
  "lore",
  "timeline",
  "storyStates",
  "acceptedChoices",
  "storyBranches",
  "storyBibles",
  "storyBibleDeltas",
  "approvalTransactions",
  "idempotencyRecords",
];
const RAW_FILES = {
  console: "console-raw.ndjson",
  pageerror: "page-errors-raw.ndjson",
  requestfailed: "network-failures-raw.ndjson",
  httperror: "http-errors-raw.ndjson",
  weberror: "page-errors-raw.ndjson",
};
const STORY_FIXTURES = [
  "PR23 R2.2 Edge Audit",
  "林澈",
  "在封閉車站找回失蹤名單",
  "舊月臺",
  "謹慎、重承諾",
  "午夜封站規則",
  "午夜前任何人不得離開舊車站。",
  "第一章：末班車",
  "末班車停下時，林澈在空月臺拾起一張寫著自己名字的舊票。",
  "依目前已核准內容續寫一個短場景，保留人物目標、世界規則與可驗證後果。",
];
const SECRET_PATTERNS = [
  /\bvcp_[A-Za-z0-9]{20,}\b/giu,
  /\bsbp_[A-Za-z0-9]{20,}\b/giu,
  /\bgh[opsu]_[A-Za-z0-9]{20,}\b/giu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/giu,
  /\bsk-[A-Za-z0-9_-]{20,}\b/giu,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/giu,
  /\b(?:token|csrf|cookie|authorization)\s*[:=]\s*[^\s,;"']+/giu,
  /\b\d{6}\b/gu,
];

mkdirSync(outputDir, { recursive: true });
for (const file of new Set(Object.values(RAW_FILES))) {
  writeFileSync(path.join(outputDir, file), "", "utf8");
}

const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, stable(value[key])]),
      )
      : value;
const digest = (value) =>
  crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(stable(value)))
    .digest("hex");
const writeJson = (name, value) =>
  writeFileSync(
    path.join(outputDir, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
const writeText = (name, value) =>
  writeFileSync(
    path.join(outputDir, name),
    `${String(value).replace(/\r\n?/gu, "\n").replace(/\n*$/u, "")}\n`,
    "utf8",
  );

function redactText(input) {
  let value = String(input ?? "");
  for (const fixture of STORY_FIXTURES) {
    value = value.split(fixture).join(`[STORY_TEXT:${digest(fixture).slice(0, 12)}]`);
  }
  for (const pattern of SECRET_PATTERNS) {
    value = value.replace(pattern, "[REDACTED_SECRET]");
  }
  value = value
    .replace(/[A-Z]:\\(?:Users|dev)\\[^\s)>\]}'"]+/giu, "[REDACTED_LOCAL_PATH]")
    .replace(/file:\/\/\/[^\s)>\]}'"]+/giu, "file:///[REDACTED_LOCAL_PATH]")
    .slice(0, 4_000);
  return value;
}

function redactUrl(input) {
  if (!input) return null;
  try {
    const url = new URL(String(input));
    const keys = [...new Set([...url.searchParams.keys()])].sort();
    url.search = keys.length ? `keys=${keys.join(",")}` : "";
    url.hash = "";
    return redactText(url.toString());
  } catch {
    return redactText(input);
  }
}

function redactedArguments(message) {
  try {
    return message.args().map((argument, index) => ({
      index,
      type: argument.toString().replace(/^JSHandle@/u, ""),
      value: "[REDACTED_ARGUMENT_VALUE]",
    }));
  } catch {
    return [];
  }
}

let phase = "BOOT";
let pairingState = "not_started";
let runtimeReady = false;
let taskIdHash = null;
let candidateIdHash = null;
let sequence = 0;
const rawRecords = [];
const duplicateIndex = new Map();
const loopbackResponses = [];
const externalAiRequests = [];
const externalAiCounts = {
  gemini: 0,
  openai: 0,
  anthropic: 0,
  grok: 0,
  other: 0,
};

function setPhase(next) {
  assert.ok(PHASES.has(next), `UNKNOWN_AUDIT_PHASE:${next}`);
  phase = next;
  process.stdout.write(`${JSON.stringify({
    status: "PROGRESS",
    phase,
    at: new Date().toISOString(),
  })}\n`);
}

function appendRaw(kind, input = {}) {
  sequence += 1;
  const timestamp = new Date().toISOString();
  const elapsedMs = Date.now() - Date.parse(startedAt);
  const duplicateKey = digest({
    kind,
    phase,
    level: input.level ?? null,
    message: redactText(input.message ?? ""),
    source: redactUrl(input.sourceUrl ?? input.requestUrl ?? ""),
    status: input.httpStatus ?? null,
  });
  const duplicateOf = duplicateIndex.get(duplicateKey) ?? null;
  const recordId = `r22-${String(sequence).padStart(5, "0")}-${duplicateKey.slice(0, 12)}`;
  if (!duplicateOf) duplicateIndex.set(duplicateKey, recordId);
  const record = {
    recordId,
    sequence,
    timestamp,
    elapsedMs,
    phase,
    kind,
    level: input.level ?? null,
    message: redactText(input.message ?? ""),
    argumentsRedacted: input.argumentsRedacted ?? [],
    sourceUrlRedacted: redactUrl(input.sourceUrl),
    lineNumber: Number.isFinite(input.lineNumber) ? input.lineNumber : null,
    columnNumber: Number.isFinite(input.columnNumber) ? input.columnNumber : null,
    stackRedacted: input.stack ? redactText(input.stack) : null,
    requestUrlRedacted: redactUrl(input.requestUrl),
    httpStatus: Number.isFinite(input.httpStatus) ? input.httpStatus : null,
    resourceType: input.resourceType ?? null,
    requestMethod: input.requestMethod ?? null,
    failureTextRedacted: input.failureText
      ? redactText(input.failureText)
      : null,
    isDuplicate: Boolean(duplicateOf),
    duplicateOf,
    runtimeReadyAtRecord: runtimeReady,
    pairingStateAtRecord: pairingState,
    taskIdHash,
    candidateIdHash,
  };
  rawRecords.push(record);
  appendFileSync(
    path.join(outputDir, RAW_FILES[kind]),
    `${JSON.stringify(record)}\n`,
    "utf8",
  );
  return record;
}

function classify(record) {
  const text = [
    record.message,
    record.failureTextRedacted,
    record.sourceUrlRedacted,
    record.requestUrlRedacted,
  ].filter(Boolean).join(" ");
  const loopback = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):3217\//iu.test(text);
  const persistenceProbe = /\/api\/persistence\/health/iu.test(text);
  const cancelled = /(?:cancelled|canceled|ERR_ABORTED|NS_BINDING_ABORTED)/iu.test(text);
  const security = /(?:content security policy|\bCSP\b|mixed content|cross-origin|CORS|unsafe-eval|certificate)/iu.test(text);
  const hydration = /(?:hydration|react.*uncaught|unhandled promise|indexeddb.*(?:error|exception)|canon.*(?:error|failed)|backup.*(?:error|failed)|restore.*(?:error|failed))/iu.test(text);
  const browserNoise = /(?:favicon\.ico|DevTools failed to load source map|ResizeObserver loop limit exceeded|Autofocus processing was blocked)/iu.test(text);
  const prePairPhase = [
    "PERMISSION_CHECK",
    "PRE_PAIRING",
    "PAIR_REQUEST",
  ].includes(record.phase);

  if (
    loopback
    && prePairPhase
    && (
      [401, 403].includes(record.httpStatus)
      || /\b(?:401|403)\b/u.test(text)
    )
  ) {
    return {
      classification: "EXPECTED_PRE_PAIRING_PROBE",
      blocking: false,
      reason: "The exact loopback Bridge origin was probed before pairing completed.",
      expectedByContract: true,
      contractReference: "novel-local-bridge/v1 pre-pairing authentication gate",
      userVisibleImpact: false,
      retryable: true,
      resolvedDuringFlow: pairingState === "paired",
    };
  }
  if (
    loopback
    && prePairPhase
    && ["requestfailed", "console"].includes(record.kind)
    && /(?:ERR_FAILED|Failed to fetch|NetworkError|local network access|private network access)/iu.test(text)
  ) {
    return {
      classification: "EXPECTED_PERMISSION_PROBE",
      blocking: false,
      reason: "The first exact-loopback request occurred while native Local Network Access permission was unresolved.",
      expectedByContract: true,
      contractReference: "Microsoft Edge Local Network Access first-use permission probe",
      userVisibleImpact: false,
      retryable: true,
      resolvedDuringFlow: runtimeReady,
    };
  }
  if (
    record.phase === "RELOAD_RECOVERY"
    && loopback
    && (
      [401, 403].includes(record.httpStatus)
      || /\b(?:401|403)\b/u.test(text)
    )
  ) {
    return {
      classification: "EXPECTED_SESSION_RECOVERY_PROBE",
      blocking: false,
      reason: "Reload recovery revalidated the tab-only Bridge session before readiness returned.",
      expectedByContract: true,
      contractReference: "tab-only pairing reload recovery contract",
      userVisibleImpact: false,
      retryable: true,
      resolvedDuringFlow: runtimeReady,
    };
  }
  if (
    persistenceProbe
    && [
      "CONTEXT_LOAD",
      "CHAPTER_CONTINUE",
      "CANDIDATE_DISCARD",
      "CHAPTER_CONTINUE_APPROVAL",
      "CHAPTER_REWRITE",
      "ABC_CHOICES",
      "FULL_WORKSPACE",
      "BACKUP",
      "RESTORE",
      "RELOAD_RECOVERY",
    ].includes(record.phase)
    && record.kind === "requestfailed"
  ) {
    return {
      classification: "EXPECTED_CLOUD_DEGRADED_PROBE",
      blocking: false,
      reason: "The audit deliberately aborted cloud persistence health to prove local canonical operation in CLOUD_DEGRADED mode.",
      expectedByContract: true,
      contractReference: "PR23 local canonical flow with cloud persistence unavailable",
      userVisibleImpact: false,
      retryable: true,
      resolvedDuringFlow: true,
    };
  }
  if (
    cancelled
    && ["CANDIDATE_DISCARD", "CLEANUP"].includes(record.phase)
  ) {
    return {
      classification: "EXPECTED_CANCELLED_REQUEST",
      blocking: false,
      reason: "The request was cancelled by an explicit discard or cleanup transition.",
      expectedByContract: true,
      contractReference: "candidate discard and audit cleanup cancellation contract",
      userVisibleImpact: false,
      retryable: true,
      resolvedDuringFlow: true,
    };
  }
  if (security) {
    return {
      classification: "SECURITY_ERROR",
      blocking: true,
      reason: "Browser security enforcement reported an unapproved CORS/CSP/mixed-content class failure.",
      expectedByContract: false,
      contractReference: null,
      userVisibleImpact: true,
      retryable: false,
      resolvedDuringFlow: false,
    };
  }
  if (record.kind === "pageerror" || record.kind === "weberror" || hydration) {
    return {
      classification: "PRODUCT_ERROR",
      blocking: true,
      reason: "An uncaught page/runtime or canonical product error was observed.",
      expectedByContract: false,
      contractReference: null,
      userVisibleImpact: true,
      retryable: false,
      resolvedDuringFlow: false,
    };
  }
  if (browserNoise) {
    return {
      classification: "BROWSER_NOISE",
      blocking: false,
      reason: "Known browser diagnostic with no product impact.",
      expectedByContract: false,
      contractReference: null,
      userVisibleImpact: false,
      retryable: false,
      resolvedDuringFlow: true,
    };
  }
  if (record.kind === "httperror" && Number(record.httpStatus) >= 400) {
    return {
      classification: "PRODUCT_ERROR",
      blocking: true,
      reason: `Unexpected HTTP ${record.httpStatus} response during the product flow.`,
      expectedByContract: false,
      contractReference: null,
      userVisibleImpact: true,
      retryable: Number(record.httpStatus) >= 500,
      resolvedDuringFlow: false,
    };
  }
  if (
    record.kind === "console"
    && ["error", "assert"].includes(String(record.level))
  ) {
    if (browserNoise) {
      return {
        classification: "BROWSER_NOISE",
        blocking: false,
        reason: "Known browser-level diagnostic with no application state or user-visible impact.",
        expectedByContract: false,
        contractReference: null,
        userVisibleImpact: false,
        retryable: false,
        resolvedDuringFlow: true,
      };
    }
    return {
      classification: "PRODUCT_ERROR",
      blocking: true,
      reason: "Console error was not justified by a bounded expected probe contract.",
      expectedByContract: false,
      contractReference: null,
      userVisibleImpact: true,
      retryable: false,
      resolvedDuringFlow: false,
    };
  }
  if (
    record.kind === "console"
    && ["warning", "warn"].includes(String(record.level))
  ) {
    return {
      classification: "PRODUCT_WARNING",
      blocking: false,
      reason: "Non-fatal product warning; retained for review.",
      expectedByContract: false,
      contractReference: null,
      userVisibleImpact: false,
      retryable: false,
      resolvedDuringFlow: true,
    };
  }
  return {
    classification: "UNCLASSIFIED",
    blocking: true,
    reason: "No phase-bound contract or validated browser-noise rule explains this record.",
    expectedByContract: false,
    contractReference: null,
    userVisibleImpact: null,
    retryable: null,
    resolvedDuringFlow: false,
  };
}

function sealConsoleEvidence(
  previousCount = 22,
  {
    actualRunCompleted = true,
    evidenceStatus = actualRunCompleted ? "SEALED" : "NOT_EXECUTED",
  } = {},
) {
  const classified = rawRecords.map((record) => ({
    recordId: record.recordId,
    ...classify(record),
  }));
  const counts = Object.fromEntries(
    [
      "EXPECTED_PERMISSION_PROBE",
      "EXPECTED_PRE_PAIRING_PROBE",
      "EXPECTED_SESSION_RECOVERY_PROBE",
      "EXPECTED_CANCELLED_REQUEST",
      "EXPECTED_CLOUD_DEGRADED_PROBE",
      "BROWSER_NOISE",
      "PRODUCT_WARNING",
      "PRODUCT_ERROR",
      "SECURITY_ERROR",
      "UNCLASSIFIED",
    ].map((name) => [
      name,
      classified.filter((row) => row.classification === name).length,
    ]),
  );
  const observedGateCount = rawRecords.filter((record) =>
    record.kind === "console"
    && ["error", "assert"].includes(String(record.level))).length;
  const currentGateCount = actualRunCompleted ? observedGateCount : null;
  const blockingCount = classified.filter((row) => row.blocking).length;
  const summary = {
    schemaVersion: "pr23-r2-2-console-summary-v1",
    generatedAt: new Date().toISOString(),
    status: evidenceStatus,
    actualEdgeRunCompleted: actualRunCompleted,
    previousGateCount: previousCount,
    currentGateCount,
    countDifference: actualRunCompleted
      ? currentGateCount - previousCount
      : null,
    countDifferenceReason: actualRunCompleted
      ? "fresh_authoritative_rerun"
      : "edge_environment_blocked_before_fresh_authoritative_rerun",
    rawRecordCount: rawRecords.length,
    classifiedRecordCount: classified.length,
    blockingCount,
    counts,
    productErrorCount: counts.PRODUCT_ERROR,
    securityErrorCount: counts.SECURITY_ERROR,
    unclassifiedCount: counts.UNCLASSIFIED,
    pass:
      actualRunCompleted
      &&
      counts.PRODUCT_ERROR === 0
      && counts.SECURITY_ERROR === 0
      && counts.UNCLASSIFIED === 0,
  };
  writeJson("console-classification.json", {
    schemaVersion: "pr23-r2-2-console-classification-v1",
    generatedAt: new Date().toISOString(),
    entries: classified,
    summary,
  });
  writeJson("console-summary.json", summary);
  writeText("console-summary.md", `# PR23 R2.2 Console evidence

- Previous count-only gate: ${previousCount}
- Current fresh Edge console error count: ${currentGateCount ?? "NOT EXECUTED"}
- Total structured raw records: ${rawRecords.length}
- Blocking records: ${blockingCount}
- PRODUCT_ERROR: ${counts.PRODUCT_ERROR}
- SECURITY_ERROR: ${counts.SECURITY_ERROR}
- UNCLASSIFIED: ${counts.UNCLASSIFIED}
- Count difference reason: ${summary.countDifferenceReason}
- Result: ${summary.pass ? "PASS" : evidenceStatus}
`);
  return { classified, summary };
}

function recordsFor(snapshot, stores = CANON_STORES) {
  return Object.fromEntries(
    stores.map((store) => [
      store,
      [...(snapshot[store] ?? [])].sort((left, right) =>
        String(left.id).localeCompare(String(right.id))),
    ]),
  );
}

function canonHash(snapshot) {
  return digest(recordsFor(snapshot));
}

function candidateEvidence(candidate) {
  if (!candidate) return null;
  return {
    candidateIdDigest: candidate.candidateIdDigest,
    taskIdDigest: candidate.taskIdDigest,
    taskType: candidate.taskType,
    status: candidate.status,
    backendId: candidate.backendId,
    actualExecutor: candidate.actualExecutor,
    modelId: candidate.modelId,
    modelDigest: candidate.modelDigest,
    contextDigest: candidate.contextDigest,
    contextSourceSummaryDigest: candidate.contextSourceSummary
      ? digest(candidate.contextSourceSummary)
      : null,
    contentDigest: candidate.contentDigest,
    generatedTokenEvents: candidate.generatedTokenEvents,
    outputCharacters: candidate.outputCharacters,
    canonicalMutationCount: candidate.canonicalMutationCount,
    dataLeftDevice: candidate.dataLeftDevice,
    externalRequest: candidate.externalRequest,
    proofState: candidate.proofState,
    abcEvidence: candidate.abcEvidence ?? null,
    createdAt: candidate.createdAt,
  };
}

function findEdge() {
  const candidates = [
    path.join(
      process.env["PROGRAMFILES(X86)"] ?? "",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
    path.join(
      process.env.PROGRAMFILES ?? "",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
    path.join(
      process.env.LOCALAPPDATA ?? "",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe",
    ),
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    const error = new Error("MICROSOFT_EDGE_EXECUTABLE_NOT_FOUND");
    error.code = "EDGE_ENVIRONMENT_BLOCKED";
    throw error;
  }
  return path.resolve(executablePath);
}

async function edgeVersion(executablePath) {
  const escaped = executablePath.replace(/'/gu, "''");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`,
    ],
    {
      cwd: root,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  const version = stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+\.\d+$/u);
  return version;
}

async function runLauncher(args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [launcherPath, ...args],
      {
        cwd: root,
        env: process.env,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const result = JSON.parse(stdout);
    if (!result.ok && !allowFailure) {
      const error = new Error(result.errorCode ?? "LOCAL_BRIDGE_LAUNCHER_FAILED");
      error.details = {
        errorCode: result.errorCode ?? null,
        messageDigest: result.message ? digest(result.message) : null,
      };
      throw error;
    }
    return result;
  } catch (error) {
    if (allowFailure) {
      return {
        ok: false,
        errorCode: error?.code ?? "LOCAL_BRIDGE_LAUNCHER_FAILED",
        messageDigest: digest(String(error?.message ?? error)),
      };
    }
    throw error;
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return {
    status: response.status,
    headers: Object.fromEntries(
      [...response.headers.entries()].map(([name, value]) => [
        name.toLowerCase(),
        name.toLowerCase() === "set-cookie" ? "[REDACTED_SECRET]" : redactText(value),
      ]),
    ),
    body,
    bodyDigest: digest(text),
  };
}

async function localRuntimePreflight() {
  const [status, ollamaVersion, ollamaTags] = await Promise.all([
    runLauncher(["status"], { allowFailure: true }),
    fetchJson("http://127.0.0.1:11434/api/version").catch((error) => ({
      status: null,
      errorCode: error?.cause?.code ?? error?.code ?? "OLLAMA_UNREACHABLE",
    })),
    fetchJson("http://127.0.0.1:11434/api/tags").catch((error) => ({
      status: null,
      errorCode: error?.cause?.code ?? error?.code ?? "OLLAMA_UNREACHABLE",
    })),
  ]);
  return {
    launcher: {
      ok: Boolean(status.ok),
      status: status.status ?? null,
      bridgeAlive: Boolean(status.bridge?.alive),
      pairingState: status.bridge?.pairingState ?? null,
      configuredOriginCount: status.process?.configuredOrigins?.length ?? 0,
    },
    ollama: {
      reachable: ollamaVersion.status === 200 && ollamaTags.status === 200,
      version: ollamaVersion.body?.version ?? null,
      models: Array.isArray(ollamaTags.body?.models)
        ? ollamaTags.body.models
          .map((row) => row.model ?? row.name)
          .filter(Boolean)
        : [],
    },
  };
}

async function openDatabase(page, name) {
  return page.evaluate(async (databaseName) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = [...database.objectStoreNames];
    database.close();
    return stores;
  }, name);
}

async function novelSnapshot(page, projectId) {
  return page.evaluate(async ({ targetProjectId, storeNames }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const snapshot = {};
    for (const storeName of storeNames) {
      if (!database.objectStoreNames.contains(storeName)) {
        snapshot[storeName] = [];
        continue;
      }
      snapshot[storeName] = await new Promise((resolve, reject) => {
        const objectStore = database
          .transaction(storeName, "readonly")
          .objectStore(storeName);
        const request = objectStore.indexNames.contains("projectId")
          ? objectStore.index("projectId").getAll(targetProjectId)
          : objectStore.getAll();
        request.onsuccess = () => resolve(
          request.result.filter((row) =>
            !row?.projectId || row.projectId === targetProjectId),
        );
        request.onerror = () => reject(request.error);
      });
    }
    database.close();
    return snapshot;
  }, { targetProjectId: projectId, storeNames: CANON_STORES });
}

function activeChapter(snapshot, projectId) {
  const project = snapshot.projects.find((row) => row.id === projectId);
  const chapter = snapshot.chapters.find(
    (row) => row.id === project?.activeChapterId,
  ) ?? snapshot.chapters[0];
  assert.ok(project, "CANON_PROJECT_MISSING");
  assert.ok(chapter, "CANON_CHAPTER_MISSING");
  return {
    idDigest: digest(chapter.id),
    revision: chapter.revision,
    contentDigest: digest(chapter.content),
    contentCharacters: String(chapter.content ?? "").replace(/\s/gu, "").length,
  };
}

async function latestAgentCandidate(page, projectId) {
  return page.evaluate(async (targetProjectId) => {
    const sha256 = async (value) => {
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(String(value ?? "")),
      );
      return [...new Uint8Array(bytes)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    };
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-closed-agent-state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise((resolve, reject) => {
      const store = database
        .transaction("records", "readonly")
        .objectStore("records");
      const request = store.indexNames.contains("projectId")
        ? store.index("projectId").getAll(targetProjectId)
        : store.getAll();
      request.onsuccess = () => resolve(
        request.result.filter((row) => row.projectId === targetProjectId),
      );
      request.onerror = () => reject(request.error);
    });
    database.close();
    const candidates = records
      .filter((row) => row.kind === "candidate")
      .sort((left, right) =>
        String(right.createdAt).localeCompare(String(left.createdAt)));
    const candidate = candidates[0];
    if (!candidate) return null;
    const task = records.find(
      (row) => row.kind === "task" && row.id === candidate.taskId,
    );
    let abcEvidence = null;
    if (task?.taskType === "chapter.abcChoices") {
      const choices = ["A", "B", "C"].map((label) => {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        const match = String(candidate.content ?? "").match(
          new RegExp(
            `(?:^|\\n)\\s*${escaped}\\s*[.．、:：)）-]\\s*(.+)`,
            "u",
          ),
        );
        return {
          label,
          text: match?.[1]?.trim() ?? "",
        };
      });
      abcEvidence = {
        labels: choices.map((row) => row.label),
        choiceCount: choices.filter((row) => row.text).length,
        allNonEmpty: choices.every((row) => row.text.length > 0),
        choiceDigests: await Promise.all(
          choices.map((row) => sha256(row.text)),
        ),
        materiallyDistinct:
          new Set(choices.map((row) => row.text.trim().toLowerCase())).size
          === 3,
      };
    }
    return {
      candidateIdDigest: await sha256(candidate.id),
      taskIdDigest: await sha256(candidate.taskId),
      taskType: task?.taskType ?? null,
      status: candidate.status,
      backendId: candidate.backendId,
      actualExecutor: candidate.actualExecutor,
      modelId: candidate.modelId,
      modelDigest: candidate.modelDigest,
      contextDigest: candidate.contextDigest,
      contextSourceSummary: candidate.contextSourceSummary,
      contentDigest: candidate.contentDigest,
      generatedTokenEvents:
        candidate.generationTelemetry?.generatedTokenEvents
        ?? candidate.executionReceipt?.generatedTokenEvents
        ?? 0,
      outputCharacters:
        candidate.generationTelemetry?.outputCharacters
        ?? candidate.executionReceipt?.outputCharacters
        ?? 0,
      canonicalMutationCount: candidate.canonicalMutationCount,
      dataLeftDevice: candidate.dataLeftDevice,
      externalRequest: candidate.externalRequest,
      proofState: candidate.executionReceipt?.proofState ?? null,
      abcEvidence,
      createdAt: candidate.createdAt,
    };
  }, projectId);
}

function assertRealLocalCandidate(candidate, taskType) {
  assert.ok(candidate, `CANDIDATE_MISSING:${taskType}`);
  assert.equal(candidate.taskType, taskType);
  assert.equal(candidate.backendId, "local-ollama");
  assert.equal(candidate.actualExecutor, "local-ollama");
  assert.equal(candidate.modelId, "qwen2.5:3b");
  assert.match(candidate.modelDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.match(candidate.contextDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.match(candidate.contentDigest ?? "", /^[a-f0-9]{64}$/u);
  assert.ok(candidate.generatedTokenEvents > 0);
  assert.ok(candidate.outputCharacters > 0);
  assert.equal(candidate.canonicalMutationCount, 0);
  assert.equal(candidate.dataLeftDevice, false);
  assert.equal(candidate.externalRequest, false);
  assert.equal(candidate.proofState, "verified");
  assert.ok(candidate.contextSourceSummary);
}

function attachRawEvidence(context, page) {
  page.on("console", (message) => {
    const location = message.location();
    appendRaw("console", {
      level: message.type(),
      message: message.text(),
      argumentsRedacted: redactedArguments(message),
      sourceUrl: location.url,
      lineNumber: location.lineNumber,
      columnNumber: location.columnNumber,
    });
  });
  page.on("pageerror", (error) => {
    appendRaw("pageerror", {
      level: "error",
      message: error.name,
      stack: error.stack ?? error.message,
    });
  });
  page.on("requestfailed", (request) => {
    appendRaw("requestfailed", {
      level: "error",
      message: "Request failed",
      requestUrl: request.url(),
      requestMethod: request.method(),
      resourceType: request.resourceType(),
      failureText: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("request", (request) => {
    let host = "";
    try {
      host = new URL(request.url()).hostname.toLowerCase();
    } catch {
      return;
    }
    let provider = null;
    if (/(?:generativelanguage|gemini)/iu.test(host)) provider = "gemini";
    else if (/(?:^|\.)openai\.com$/iu.test(host)) provider = "openai";
    else if (/(?:^|\.)anthropic\.com$/iu.test(host)) provider = "anthropic";
    else if (/(?:^|\.)x\.ai$/iu.test(host) || /grok/iu.test(host)) {
      provider = "grok";
    }
    else if (
      /(?:cohere|mistral|huggingface|replicate|together|perplexity|deepseek)/iu
        .test(host)
    ) {
      provider = "other";
    }
    if (provider) {
      externalAiCounts[provider] += 1;
      externalAiRequests.push({
        provider,
        hostDigest: digest(host),
        method: request.method(),
      });
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    let host = "";
    let pathname = "";
    try {
      const parsed = new URL(response.url());
      host = parsed.hostname.toLowerCase();
      pathname = parsed.pathname;
    } catch {
      host = "";
    }
    if (["127.0.0.1", "localhost", "::1"].includes(host)) {
      loopbackResponses.push({
        method: request.method(),
        path: pathname,
        status: response.status(),
      });
    }
    if (response.status() >= 400) {
      appendRaw("httperror", {
        level: "error",
        message: `HTTP ${response.status()}`,
        requestUrl: response.url(),
        httpStatus: response.status(),
        requestMethod: request.method(),
        resourceType: request.resourceType(),
      });
    }
  });
  if (typeof context.on === "function") {
    context.on("weberror", (webError) => {
      appendRaw("weberror", {
        level: "error",
        message: webError.error()?.name ?? "WebError",
        stack: webError.error()?.stack ?? webError.error()?.message,
        sourceUrl: webError.page()?.url(),
      });
    });
  }
}

async function inspectLocalPermission(page) {
  return page.evaluate(async () => {
    const result = {
      apiAvailable: Boolean(navigator.permissions?.query),
      permissionName: "local-network-access",
      state: "unsupported",
      browserDecisionRequired: true,
    };
    try {
      const status = await navigator.permissions.query({
        name: "local-network-access",
      });
      result.state = status.state;
    } catch (error) {
      result.state = "not_queryable";
      result.errorName = error instanceof Error ? error.name : "unknown";
    }
    return result;
  });
}

async function pairLocalBridge(page) {
  setPhase("PERMISSION_CHECK");
  await page.goto(`${previewUrl}/settings/local-ai`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByTestId("local-ai-setup").waitFor({
    state: "visible",
    timeout: 60_000,
  });
  const permissionBefore = await inspectLocalPermission(page);
  setPhase("PRE_PAIRING");
  const statusBefore = await page
    .getByTestId("local-ai-runtime-state")
    .getAttribute("data-ready");
  assert.notEqual(statusBefore, "true", "FRESH_PROFILE_UNEXPECTEDLY_PAIRED");

  setPhase("PAIR_REQUEST");
  pairingState = "requested";
  await page.getByTestId("local-ai-start-pairing").click();
  const pairingInput = page.getByTestId("local-ai-pairing-code");
  try {
    await pairingInput.waitFor({
      state: "visible",
      timeout: 90_000,
    });
  } catch (error) {
    const permissionAfterTimeout = await inspectLocalPermission(page);
    const blocked = new Error(
      "EDGE_NATIVE_LOCAL_NETWORK_PERMISSION_NOT_CONFIRMED",
      { cause: error },
    );
    blocked.code = "EDGE_ENVIRONMENT_BLOCKED";
    blocked.permission = {
      before: permissionBefore,
      after: permissionAfterTimeout,
      injectionUsed: false,
      browserPolicyModified: false,
    };
    throw blocked;
  }
  const pairing = await runLauncher(["pair"]);
  let pairingCode = String(pairing.code ?? "");
  assert.match(pairingCode, /^\d{6}$/u);
  setPhase("PAIR_CONFIRM");
  await pairingInput.fill(pairingCode);
  pairingCode = "";
  pairing.code = undefined;
  await page.getByTestId("local-ai-confirm-pairing").click();
  await page.getByTestId("local-ai-model-proof").waitFor({
    state: "visible",
    timeout: 300_000,
  });
  setPhase("MODEL_VERIFY");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="local-ai-runtime-state"]')
        ?.getAttribute("data-ready") === "true",
    undefined,
    { timeout: 120_000 },
  );
  pairingState = "paired";
  runtimeReady = true;
  const proof = await page.getByTestId("local-ai-model-proof").evaluate((node) =>
    Object.fromEntries(
      [...node.querySelectorAll("div")].map((row) => [
        row.querySelector("dt")?.textContent?.trim() ?? "",
        row.querySelector("dd")?.textContent?.trim() ?? "",
      ]),
    ));
  assert.equal(proof["狀態"], "inference_verified");
  assert.equal(proof["模型"], "qwen2.5:3b");
  assert.match(proof["模型雜湊"] ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(proof["資料離開裝置"], "否");
  const health = await page.evaluate(async () => {
    const response = await fetch("http://127.0.0.1:3217/health", {
      headers: { "X-Bridge-Protocol": "novel-local-bridge/v1" },
      cache: "no-store",
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  });
  assert.equal(health.status, 200);
  assert.match(health.body.instanceId ?? "", /^[a-f0-9-]{36}$/u);
  const permissionAfter = await inspectLocalPermission(page);
  return {
    permission: {
      before: permissionBefore,
      after: permissionAfter,
      decisionMethod: "real_microsoft_edge_native_permission",
      permissionInjectionUsed: false,
      browserPolicyModified: false,
    },
    bridge: {
      instanceIdDigest: digest(health.body.instanceId),
      protocolVersion: health.body.protocolVersion,
      pairingSecretPersisted: false,
      modelId: proof["模型"],
      modelDigest: proof["模型雜湊"],
      proofState: proof["狀態"],
      outputDigest: proof["輸出證明"],
      dataLeftDevice: false,
    },
  };
}

async function createPublicProject(page) {
  setPhase("PROJECT_CREATE");
  const rootResponse = await page.goto(`${previewUrl}/`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  assert.equal(rootResponse?.status(), 200);
  assert.match(page.url(), /\/legacy\/novel-system\.html\?screen=home$/u);
  await page.goto(`${previewUrl}/studio/create`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByTestId("studio-create-blank").click();
  await page.getByTestId("studio-project-title").fill(STORY_FIXTURES[0]);
  await page.getByTestId("studio-create-submit").click();
  const success = page.locator(".p2CreateSuccess");
  await success.waitFor({ state: "visible", timeout: 60_000 });
  const writingHref = await success
    .getByRole("link", { name: "開始寫作", exact: true })
    .getAttribute("href");
  const projectId = writingHref?.match(/\/studio\/project\/([^/]+)\/write/u)?.[1];
  assert.match(projectId ?? "", /^[A-Za-z0-9_-]{1,128}$/u);
  return projectId;
}

async function seedCanonicalContext(page, projectId) {
  setPhase("CONTEXT_LOAD");
  await page.goto(`${previewUrl}/studio/project/${projectId}/characters`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("角色姓名").fill(STORY_FIXTURES[1]);
  await page.getByLabel("角色目標").fill(STORY_FIXTURES[2]);
  await page.getByLabel("所在位置或現況").fill(STORY_FIXTURES[3]);
  await page.getByLabel("年齡（可留白）").fill("28");
  await page.getByLabel("作者已確認角色年齡").check();
  await page.getByLabel("角色性格").fill(STORY_FIXTURES[4]);
  await page.getByRole("button", { name: "建立角色", exact: true }).click();
  await page.getByText("角色已建立。", { exact: true }).waitFor();

  await page.goto(`${previewUrl}/studio/project/${projectId}/world`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("規則名稱").fill(STORY_FIXTURES[5]);
  await page.getByLabel("規則內容").fill(STORY_FIXTURES[6]);
  await page.getByLabel("不可違反的正式規則").check();
  await page.getByRole("button", {
    name: "建立世界規則",
    exact: true,
  }).click();
  await page.getByText("世界規則已建立。", { exact: true }).waitFor();

  await page.goto(`${previewUrl}/studio/project/${projectId}/write`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "專注寫作" }).waitFor();
  await page.getByLabel("章節標題").fill(STORY_FIXTURES[7]);
  await page.getByLabel("正文").fill(STORY_FIXTURES[8]);
  await page.getByRole("button", { name: "儲存目前內容" }).click();
  await page.getByText(/^已儲存 /u).waitFor({ timeout: 60_000 });
  const snapshot = await novelSnapshot(page, projectId);
  const chapter = activeChapter(snapshot, projectId);
  assert.ok(chapter.contentCharacters > 0);
  return { initialCanonHash: canonHash(snapshot), chapter };
}

async function waitForQuickCandidate(page) {
  await page.locator(".studioCandidate").waitFor({
    state: "visible",
    timeout: 300_000,
  });
  const details = page.locator(".studioCandidate details").last();
  if (!(await details.getAttribute("open"))) {
    await details.locator("summary").click();
  }
}

async function runQuickTask(page, projectId, buttonName, taskType) {
  await page.getByRole("button", { name: new RegExp(buttonName, "u") }).click();
  await waitForQuickCandidate(page);
  const candidate = await latestAgentCandidate(page, projectId);
  assertRealLocalCandidate(candidate, taskType);
  taskIdHash = candidate.taskIdDigest;
  candidateIdHash = candidate.candidateIdDigest;
  assert.ok(Number(
    await page
      .getByTestId("studio-candidate-generated-token-events")
      .textContent(),
  ) > 0);
  assert.equal(
    (await page
      .getByTestId("studio-candidate-data-left-device")
      .textContent())?.trim(),
    "否",
  );
  assert.notEqual(
    (await page
      .getByTestId("studio-candidate-context-source-summary")
      .textContent())?.trim(),
    "missing",
  );
  return candidate;
}

async function quickAssistantGate(page, projectId) {
  await page.route("**/api/persistence/health**", (route) =>
    route.abort("failed"));
  setPhase("CONTEXT_LOAD");
  await page.goto(
    `${previewUrl}/studio/quick-assistant?screen=write&projectId=${encodeURIComponent(projectId)}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.getByTestId("studio-writing").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await page.locator(
    '.studioShell[data-canonical-hydration-succeeded="true"][data-local-canonical-writable="true"]',
  ).waitFor({ state: "visible", timeout: 90_000 });
  await page.getByText("模式：CLOUD_DEGRADED", { exact: false }).waitFor({
    timeout: 60_000,
  });

  setPhase("CHAPTER_CONTINUE");
  const beforeDiscard = await novelSnapshot(page, projectId);
  const beforeDiscardHash = canonHash(beforeDiscard);
  const discarded = await runQuickTask(
    page,
    projectId,
    "續寫下一段",
    "chapter.continue",
  );
  assert.equal(canonHash(await novelSnapshot(page, projectId)), beforeDiscardHash);
  setPhase("CANDIDATE_DISCARD");
  await page.getByRole("button", { name: "放棄不採用", exact: true }).click();
  await page.locator(".studioCandidate").waitFor({ state: "hidden" });
  const afterDiscardHash = canonHash(await novelSnapshot(page, projectId));
  assert.equal(afterDiscardHash, beforeDiscardHash);

  setPhase("CHAPTER_CONTINUE");
  const approvedContinue = await runQuickTask(
    page,
    projectId,
    "續寫下一段",
    "chapter.continue",
  );
  const diffView = page.getByTestId("studio-candidate-diff");
  if (!(await diffView.getAttribute("open"))) {
    await diffView.locator("summary").click();
  }
  assert.match(
    (await page.getByTestId("studio-candidate-diff-summary").textContent()) ?? "",
    /原文 \d+ 字.*候選內容 \d+ 字/u,
  );
  const beforeApproval = await novelSnapshot(page, projectId);
  const beforeApprovalHash = canonHash(beforeApproval);
  const beforeChapter = activeChapter(beforeApproval, projectId);
  setPhase("CHAPTER_CONTINUE_APPROVAL");
  await page.getByRole("button", {
    name: "採用並寫入作品",
    exact: true,
  }).click();
  await page.locator(".studioCandidate").waitFor({
    state: "hidden",
    timeout: 90_000,
  });
  const afterApproval = await novelSnapshot(page, projectId);
  const afterApprovalHash = canonHash(afterApproval);
  const afterChapter = activeChapter(afterApproval, projectId);
  assert.equal(afterChapter.revision, beforeChapter.revision + 1);
  assert.notEqual(afterApprovalHash, beforeApprovalHash);

  setPhase("RELOAD_RECOVERY");
  runtimeReady = false;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("studio-writing").waitFor({ state: "visible" });
  await page.locator(
    '.studioShell[data-canonical-hydration-succeeded="true"][data-local-canonical-writable="true"]',
  ).waitFor({ state: "visible", timeout: 90_000 });
  runtimeReady = true;
  const reloaded = await novelSnapshot(page, projectId);
  const reloadHash = canonHash(reloaded);
  assert.equal(reloadHash, afterApprovalHash);
  assert.equal(
    activeChapter(reloaded, projectId).contentDigest,
    afterChapter.contentDigest,
  );

  setPhase("CHAPTER_REWRITE");
  const rewrite = await runQuickTask(
    page,
    projectId,
    "改寫目前內容",
    "chapter.rewrite",
  );
  const beforeRewriteApproval = await novelSnapshot(page, projectId);
  const beforeRewriteChapter = activeChapter(beforeRewriteApproval, projectId);
  await page.getByRole("button", {
    name: "採用並寫入作品",
    exact: true,
  }).click();
  await page.locator(".studioCandidate").waitFor({
    state: "hidden",
    timeout: 90_000,
  });
  const afterRewriteApproval = await novelSnapshot(page, projectId);
  const afterRewriteChapter = activeChapter(afterRewriteApproval, projectId);
  assert.equal(
    afterRewriteChapter.revision,
    beforeRewriteChapter.revision + 1,
  );

  setPhase("ABC_CHOICES");
  const abcChoices = await runQuickTask(
    page,
    projectId,
    "產生三個選擇",
    "chapter.abcChoices",
  );
  assert.equal(abcChoices.abcEvidence?.choiceCount, 3);
  assert.equal(abcChoices.abcEvidence?.allNonEmpty, true);
  assert.equal(abcChoices.abcEvidence?.materiallyDistinct, true);
  await page.getByRole("button", { name: "放棄不採用", exact: true }).click();
  await page.locator(".studioCandidate").waitFor({ state: "hidden" });
  return {
    cloudMode: "CLOUD_DEGRADED",
    discard: {
      candidate: candidateEvidence(discarded),
      preCanonHash: beforeDiscardHash,
      postCanonHash: afterDiscardHash,
      unchanged: true,
    },
    approval: {
      candidate: candidateEvidence(approvedContinue),
      preCanonHash: beforeApprovalHash,
      postCanonHash: afterApprovalHash,
      revisionBefore: beforeChapter.revision,
      revisionAfter: afterChapter.revision,
    },
    reload: {
      expectedCanonHash: afterApprovalHash,
      actualCanonHash: reloadHash,
      contentDigest: afterChapter.contentDigest,
      persistent: true,
    },
    rewrite: {
      candidate: candidateEvidence(rewrite),
      revisionBefore: beforeRewriteChapter.revision,
      revisionAfter: afterRewriteChapter.revision,
    },
    abcChoices: {
      candidate: candidateEvidence(abcChoices),
      realLocalModel: true,
    },
  };
}

async function fullWorkspaceGate(page, projectId) {
  setPhase("FULL_WORKSPACE");
  await page.goto(`${previewUrl}/studio/project/${projectId}/closed-ai`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId("closed-ai-workspace").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="closed-ai-execution-readiness"]')
        ?.getAttribute("data-ready") === "true",
    undefined,
    { timeout: 90_000 },
  );
  await page.getByTestId("closed-ai-task-type").selectOption("chapter.continue");
  await page.getByTestId("closed-ai-backend").selectOption("local-ollama");
  await page.getByTestId("closed-ai-quality").selectOption("fast");
  await page.getByTestId("closed-ai-objective").fill(STORY_FIXTURES[9]);
  await page.getByTestId("closed-ai-run").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="closed-ai-candidate"]')
        ?.getAttribute("data-empty") === "false",
    undefined,
    { timeout: 300_000 },
  );
  const details = page.getByTestId("closed-ai-candidate").locator("details");
  if (!(await details.getAttribute("open"))) {
    await details.locator("summary").click();
  }
  assert.equal(
    (await page.getByTestId("closed-ai-actual-executor").textContent())?.trim(),
    "local-ollama",
  );
  assert.ok(Number(
    await page
      .getByTestId("closed-ai-generated-token-events")
      .textContent(),
  ) > 0);
  const candidate = await latestAgentCandidate(page, projectId);
  assertRealLocalCandidate(candidate, "chapter.continue");
  const before = await novelSnapshot(page, projectId);
  const beforeHash = canonHash(before);
  const beforeChapter = activeChapter(before, projectId);
  await page.getByRole("button", {
    name: "採用全文並寫入作品",
    exact: true,
  }).click();
  await page.getByTestId("closed-ai-candidate-status").filter({
    hasText: "已核准並套用",
  }).waitFor({ timeout: 90_000 });
  const after = await novelSnapshot(page, projectId);
  const afterHash = canonHash(after);
  const afterChapter = activeChapter(after, projectId);
  assert.equal(afterChapter.revision, beforeChapter.revision + 1);
  assert.notEqual(afterHash, beforeHash);
  setPhase("RELOAD_RECOVERY");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("closed-ai-workspace").waitFor({
    state: "visible",
    timeout: 90_000,
  });
  const reloadHash = canonHash(await novelSnapshot(page, projectId));
  assert.equal(reloadHash, afterHash);
  return {
    candidate: candidateEvidence(candidate),
    preCanonHash: beforeHash,
    postCanonHash: afterHash,
    reloadHash,
    revisionBefore: beforeChapter.revision,
    revisionAfter: afterChapter.revision,
    reloadPersistent: true,
  };
}

async function backupRestoreGate(page, projectId) {
  const before = await novelSnapshot(page, projectId);
  const semanticHashBeforeBackup = canonHash(before);
  setPhase("BACKUP");
  await page.goto(`${previewUrl}/studio/project/${projectId}/backups`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", {
    name: "存檔與備份",
    exact: true,
  }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", {
    name: "建立完整備份",
    exact: true,
  }).click();
  const download = await downloadPromise;
  await page.getByText(/備份建立/u).waitFor({ timeout: 60_000 });
  assert.ok(await download.suggestedFilename());
  const fullBackupArticle = page
    .getByText("建立完整備份", { exact: true })
    .locator("..");
  setPhase("RESTORE");
  page.once("dialog", (dialog) => void dialog.accept());
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
    fullBackupArticle
      .getByRole("button", { name: "還原", exact: true })
      .click(),
  ]);
  await page.getByRole("heading", {
    name: "存檔與備份",
    exact: true,
  }).waitFor();
  const restored = await novelSnapshot(page, projectId);
  const semanticHashAfterRestore = canonHash(restored);
  assert.equal(semanticHashAfterRestore, semanticHashBeforeBackup);
  return {
    semanticHashBeforeBackup,
    semanticHashAfterRestore,
    semanticHashMatch: true,
    productOwnedReload: true,
    downloaded: true,
  };
}

function writeFlowEvidence({
  browser,
  localPreflight,
  pairing,
  publicCreation,
  quickAssistant,
  fullWorkspace,
  backupRestore,
  storage,
  consoleEvidence,
  releaseIdentity,
  status,
  failure = null,
}) {
  const candidateEvidenceRows = [
    quickAssistant?.discard?.candidate,
    quickAssistant?.approval?.candidate,
    quickAssistant?.rewrite?.candidate,
    quickAssistant?.abcChoices?.candidate,
    fullWorkspace?.candidate,
  ].filter(Boolean);
  const generatePostSuccess = loopbackResponses.filter((row) =>
    row.method === "POST"
    && row.path === "/generate"
    && row.status >= 200
    && row.status < 300).length;
  const notRun = (name) => ({
    schemaVersion: `pr23-r2-2-${name}-v1`,
    status: "NOT_RUN",
    reason: failure?.code ?? failure?.message ?? "FLOW_NOT_COMPLETED",
  });
  writeJson("edge-profile.json", browser ?? notRun("edge-profile"));
  writeJson(
    "local-network-permission.json",
    pairing?.permission ?? notRun("local-network-permission"),
  );
  writeJson("local-bridge-runtime.json", pairing?.bridge
    ? {
      schemaVersion: "pr23-r2-2-local-bridge-runtime-v1",
      status: "PASS",
      ...pairing.bridge,
      preflight: localPreflight?.launcher ?? null,
    }
    : notRun("local-bridge-runtime"));
  writeJson("local-ollama-execution.json", pairing?.bridge
    ? {
      schemaVersion: "pr23-r2-2-local-ollama-execution-v1",
      status: "PASS",
      modelId: pairing.bridge.modelId,
      modelDigest: pairing.bridge.modelDigest,
      proofState: pairing.bridge.proofState,
      runtime: localPreflight?.ollama ?? null,
    }
    : notRun("local-ollama-execution"));
  writeJson("actual-executor.json", quickAssistant
    ? {
      schemaVersion: "pr23-r2-2-actual-executor-v1",
      status: "PASS",
      expected: "local-ollama",
      observed: [
        quickAssistant.approval.candidate.actualExecutor,
        quickAssistant.rewrite.candidate.actualExecutor,
        quickAssistant.abcChoices.candidate.actualExecutor,
        fullWorkspace?.candidate?.actualExecutor,
      ].filter(Boolean),
    }
    : notRun("actual-executor"));
  writeJson("canon-discard.json", quickAssistant?.discard
    ? {
      schemaVersion: "pr23-r2-2-canon-discard-v1",
      status: "PASS",
      ...quickAssistant.discard,
    }
    : notRun("canon-discard"));
  writeJson("canon-approval.json", quickAssistant?.approval
    ? {
      schemaVersion: "pr23-r2-2-canon-approval-v1",
      status: "PASS",
      ...quickAssistant.approval,
    }
    : notRun("canon-approval"));
  writeJson("reload-persistence.json", quickAssistant?.reload
    ? {
      schemaVersion: "pr23-r2-2-reload-persistence-v1",
      status: "PASS",
      ...quickAssistant.reload,
    }
    : notRun("reload-persistence"));
  writeJson("abc-choices.json", quickAssistant?.abcChoices
    ? {
      schemaVersion: "pr23-r2-2-abc-choices-v1",
      status: "PASS",
      ...quickAssistant.abcChoices,
    }
    : notRun("abc-choices"));
  writeJson("full-workspace.json", fullWorkspace
    ? {
      schemaVersion: "pr23-r2-2-full-workspace-v1",
      status: "PASS",
      ...fullWorkspace,
    }
    : notRun("full-workspace"));
  writeJson("backup-restore.json", backupRestore
    ? {
      schemaVersion: "pr23-r2-2-backup-restore-v1",
      status: "PASS",
      ...backupRestore,
    }
    : notRun("backup-restore"));
  writeJson("remote-preview-gate-v3.json", {
    schemaVersion: "pr23-r2-2-remote-preview-gate-v3",
    status,
    previousEvidenceVersion: "pr23-r2-1-remote-preview-gate-v2",
    previousConsoleEvidenceStatus: "count_only_raw_records_missing",
    previousConsoleErrorCount: 22,
    previousEvidenceSupersededForConsoleClassification: true,
    preview: {
      url: previewUrl,
      expectedDeploymentId,
      expectedMergeRef,
      releaseIdentity: releaseIdentity ?? null,
    },
    browser: browser ?? null,
    publicCreation: publicCreation ?? null,
    quickAssistant: quickAssistant ?? null,
    fullWorkspace: fullWorkspace ?? null,
    backupRestore: backupRestore ?? null,
    storage: storage ?? null,
    rawEvidence: consoleEvidence?.summary ?? null,
    requiredRuntimeMetrics: {
      actualExecutor:
        candidateEvidenceRows.length > 0
        && candidateEvidenceRows.every(
          (row) => row.actualExecutor === "local-ollama",
        )
          ? "local-ollama"
          : null,
      modelId:
        candidateEvidenceRows.length > 0
        && candidateEvidenceRows.every((row) => row.modelId === "qwen2.5:3b")
          ? "qwen2.5:3b"
          : null,
      proofState:
        candidateEvidenceRows.length > 0
        && candidateEvidenceRows.every((row) => row.proofState === "verified")
          ? "inference_verified"
          : null,
      generatedTokenEvents: candidateEvidenceRows.reduce(
        (sum, row) => sum + Number(row.generatedTokenEvents ?? 0),
        0,
      ),
      generatePostSuccess,
      browserFailureCount: consoleEvidence?.summary?.blockingCount ?? null,
      externalRequest: candidateEvidenceRows.some(
        (row) => row.externalRequest === true,
      ),
      dataLeftDevice: candidateEvidenceRows.some(
        (row) => row.dataLeftDevice === true,
      ),
      silentExternalFallback: externalAiRequests.length > 0,
      canonicalMutationBeforeApproval: candidateEvidenceRows.reduce(
        (sum, row) => sum + Number(row.canonicalMutationCount ?? 0),
        0,
      ),
      duplicateApproval: storage?.duplicateApproval ?? null,
      staleRevisionAccepted: storage?.staleRevisionAccepted ?? null,
      browserPackagedTaskProseGeneration: candidateEvidenceRows.filter(
        (row) => row.actualExecutor === "browser-ai",
      ).length,
      geminiRequestCount: externalAiCounts.gemini,
      otherExternalAiRequestCount:
        externalAiCounts.openai
        + externalAiCounts.anthropic
        + externalAiCounts.grok
        + externalAiCounts.other,
    },
    externalAiRequestCount: externalAiRequests.length,
    externalAiRequestCounts: externalAiCounts,
    loopbackResponseCount: loopbackResponses.length,
    failure: failure
      ? {
        code: failure.code ?? failure.name ?? "AUDIT_FAILED",
        messageDigest: digest(String(failure.message ?? failure)),
      }
      : null,
    completedAt: new Date().toISOString(),
  });
}

let context;
let originAdded = false;
let bridgeStartedByAudit = false;
let browserEvidence = null;
let localPreflight = null;
let pairing = null;
let releaseIdentity = null;
let publicCreation = null;
let quickAssistant = null;
let fullWorkspace = null;
let backupRestore = null;
let storage = null;
let runStatus = "FAIL";
let runFailure = null;
let installedEdgePath = null;
let installedEdgeVersion = null;

try {
  installedEdgePath = findEdge();
  installedEdgeVersion = await edgeVersion(installedEdgePath);
  writeJson("edge-executable.json", {
    schemaVersion: "pr23-r2-2-edge-executable-v1",
    status: "PASS",
    product: "Microsoft Edge",
    executablePath: installedEdgePath,
    version: installedEdgeVersion,
    exactExecutableVerified: true,
  });
  localPreflight = await localRuntimePreflight();
  if (preflightOnly) {
    writeJson("edge-run-metadata.json", {
      schemaVersion: "pr23-r2-2-edge-run-metadata-v1",
      status: "PREFLIGHT_PASS",
      runId,
      startedAt,
      actualEdgeRunExecuted: false,
      executablePath: installedEdgePath,
      version: installedEdgeVersion,
      localRuntime: localPreflight,
    });
    const emptyConsoleEvidence = sealConsoleEvidence(22, {
      actualRunCompleted: false,
      evidenceStatus: "PREFLIGHT_ONLY",
    });
    writeFlowEvidence({
      browser: {
        schemaVersion: "pr23-r2-2-edge-profile-v1",
        status: "NOT_RUN",
        reason: "PREFLIGHT_ONLY",
      },
      localPreflight,
      pairing: null,
      publicCreation: null,
      quickAssistant: null,
      fullWorkspace: null,
      backupRestore: null,
      storage: null,
      consoleEvidence: emptyConsoleEvidence,
      releaseIdentity: null,
      status: "PREFLIGHT_PASS",
    });
    process.stdout.write(`${JSON.stringify({
      status: "PREFLIGHT_PASS",
      executablePath: installedEdgePath,
      version: installedEdgeVersion,
      outputDir,
    })}\n`);
  } else {
    const identityResult = await fetchJson(
      `${previewUrl}/api/release/identity?gate=${Date.now()}`,
    );
    assert.equal(identityResult.status, 200);
    releaseIdentity = identityResult.body;
    assert.equal(releaseIdentity.appCommit, expectedMergeRef);
    assert.equal(releaseIdentity.deploymentId, expectedDeploymentId);
    assert.equal(releaseIdentity.environment, "preview");
    assert.equal(releaseIdentity.provenanceStatus, "verified");

    const origin = new URL(previewUrl).origin;
    const originRegistry = await runLauncher(["origin", "list"]);
    const enrolled = (originRegistry.enrolledOrigins ?? [])
      .some((row) => row.origin === origin);
    if (!enrolled) {
      const added = await runLauncher([
        "origin",
        "add",
        origin,
        "--confirm",
        origin,
      ]);
      assert.equal(added.origin, origin);
      originAdded = true;
    }
    const bridgeStatusBefore = await runLauncher(
      ["status"],
      { allowFailure: true },
    );
    if (!bridgeStatusBefore.bridge?.alive) {
      const started = await runLauncher(["start", "--origin", origin]);
      assert.ok(["started", "already_running"].includes(started.status));
      bridgeStartedByAudit = started.status === "started";
    }

    if (existsSync(profileDir)) {
      const error = new Error(`EDGE_PROFILE_NOT_FRESH:${profileDir}`);
      error.code = "EDGE_ENVIRONMENT_BLOCKED";
      throw error;
    }
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: installedEdgePath,
      headless: false,
      chromiumSandbox: true,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
      ],
      ignoreDefaultArgs: [
        "--disable-popup-blocking",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--unsafely-disable-devtools-self-xss-warnings",
      ],
      viewport: { width: 1440, height: 900 },
      locale: "zh-TW",
      acceptDownloads: true,
    });
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(60_000);
    attachRawEvidence(context, page);
    const userAgent = await page.evaluate(() => navigator.userAgent);
    assert.match(userAgent, /Edg\//u);
    browserEvidence = {
      schemaVersion: "pr23-r2-2-edge-profile-v1",
      status: "PASS",
      product: "Microsoft Edge",
      version: installedEdgeVersion,
      userAgentDigest: digest(userAgent),
      executablePath: installedEdgePath,
      realInstalledBrowser: true,
      freshIsolatedProfile: true,
      sandboxEnabled: true,
      extensionsDisabled: true,
      syncDisabled: true,
      localNetworkPermissionBypassUsed: false,
      localNetworkPermissionInjectionUsed: false,
      browserPolicyModified: false,
    };

    pairing = await pairLocalBridge(page);
    const projectId = await createPublicProject(page);
    const seeded = await seedCanonicalContext(page, projectId);
    publicCreation = {
      projectIdDigest: digest(projectId),
      publicRootVisited: true,
      characterCreated: true,
      worldRuleCreated: true,
      firstPassageSaved: true,
      initialCanonHash: seeded.initialCanonHash,
      initialChapterRevision: seeded.chapter.revision,
    };
    quickAssistant = await quickAssistantGate(page, projectId);
    fullWorkspace = await fullWorkspaceGate(page, projectId);
    backupRestore = await backupRestoreGate(page, projectId);
    const finalSnapshot = await novelSnapshot(page, projectId);
    const approvalCandidateIds = finalSnapshot.approvalTransactions
      .map((row) => row.candidateId)
      .filter(Boolean);
    const approvalKeys = finalSnapshot.approvalTransactions
      .map((row) => row.idempotencyKey)
      .filter(Boolean);
    const duplicateApproval =
      approvalCandidateIds.length - new Set(approvalCandidateIds).size
      + approvalKeys.length - new Set(approvalKeys).size;
    const staleRevisionAccepted = finalSnapshot.approvalTransactions.filter(
      (row) =>
        Number(row.expectedRevision) !== Number(row.baseRevision),
    ).length;
    assert.equal(duplicateApproval, 0);
    assert.equal(staleRevisionAccepted, 0);
    storage = {
      canonicalDatabaseStores: await openDatabase(
        page,
        "novel-intelligence-platform",
      ),
      closedAgentDatabaseStores: await openDatabase(
        page,
        "novel-closed-agent-state",
      ),
      finalCanonHash: canonHash(finalSnapshot),
      approvalTransactionCount:
        finalSnapshot.approvalTransactions.length,
      idempotencyRecordCount: finalSnapshot.idempotencyRecords.length,
      duplicateApproval,
      staleRevisionAccepted,
    };
    assert.equal(externalAiRequests.length, 0);
    assert.ok(loopbackResponses.some(
      (row) => row.path === "/health" && row.status === 200,
    ));
    assert.ok(loopbackResponses.some(
      (row) => row.path === "/generate" && row.status === 200,
    ));
    assert.ok(loopbackResponses.some(
      (row) =>
        row.method === "POST"
        && row.path === "/generate"
        && row.status >= 200
        && row.status < 300,
    ));
    runStatus = "FLOW_COMPLETE_PENDING_CLEANUP";
  }
} catch (error) {
  runFailure = error;
  runStatus = error?.code === "EDGE_ENVIRONMENT_BLOCKED"
    ? "EDGE_ENVIRONMENT_BLOCKED"
    : "FAIL";
} finally {
  setPhase("CLEANUP");
  if (context) {
    await context.close().catch((error) => {
      if (!runFailure) {
        runFailure = error;
        runStatus = "FAIL";
      }
    });
  }
  if (!leaveBridgeRunning && bridgeStartedByAudit) {
    await runLauncher(["stop"], { allowFailure: true });
  }
  if (originAdded) {
    const origin = new URL(previewUrl).origin;
    await runLauncher(
      ["origin", "revoke", origin, "--confirm", origin],
      { allowFailure: true },
    );
  }
  if (!preflightOnly) {
    const actualFlowCompleted =
      runStatus === "FLOW_COMPLETE_PENDING_CLEANUP"
      && !runFailure;
    const consoleEvidence = sealConsoleEvidence(22, {
      actualRunCompleted: actualFlowCompleted,
      evidenceStatus: actualFlowCompleted ? "SEALED" : runStatus,
    });
    if (actualFlowCompleted) {
      if (
        consoleEvidence.summary.productErrorCount === 0
        && consoleEvidence.summary.securityErrorCount === 0
        && consoleEvidence.summary.unclassifiedCount === 0
      ) {
        runStatus = "PASS";
      } else {
        runStatus = "FAIL";
        runFailure = new Error("BLOCKING_BROWSER_RECORDS_OBSERVED");
      }
    }
    writeFlowEvidence({
      browser: browserEvidence,
      localPreflight,
      pairing,
      publicCreation,
      quickAssistant,
      fullWorkspace,
      backupRestore,
      storage,
      consoleEvidence,
      releaseIdentity,
      status: runStatus,
      failure: runFailure,
    });
    writeJson("edge-run-metadata.json", {
      schemaVersion: "pr23-r2-2-edge-run-metadata-v1",
      status: runStatus,
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      actualEdgeRunExecuted: Boolean(context),
      actualEdgeFlowCompleted: runStatus === "PASS",
      userVisible: Boolean(context),
      executablePath: installedEdgePath,
      version: installedEdgeVersion,
      profilePathDigest: existsSync(profileDir) ? digest(profileDir) : null,
      auditProfilePreserved: existsSync(profileDir),
      rawRecordCount: rawRecords.length,
      failureCode: runFailure
        ? runFailure.code ?? runFailure.name ?? "AUDIT_FAILED"
        : null,
      failureMessageDigest: runFailure
        ? digest(String(runFailure.message ?? runFailure))
        : null,
      permissionEvidence: runFailure?.permission ?? null,
    });
    const message = {
      status: runStatus,
      errorCode: runFailure
        ? runFailure.code ?? runFailure.name ?? "AUDIT_FAILED"
        : null,
      outputDir,
      rawRecordCount: rawRecords.length,
    };
    if (runStatus === "PASS") {
      process.stdout.write(`${JSON.stringify(message)}\n`);
    } else {
      process.stderr.write(`${JSON.stringify(message)}\n`);
      process.exitCode = runStatus === "EDGE_ENVIRONMENT_BLOCKED" ? 2 : 1;
    }
  }
}
