import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import vm from "node:vm";

const evidenceDir = new URL("../artifacts/closed-ai-phase1-1r3/", import.meta.url);
const boundarySource = await readFile(new URL("../public/legacy/legacy-security-boundary.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../public/legacy/novel-system.html", import.meta.url), "utf8");
const legacyRuntimeSource = await readFile(new URL("../public/legacy/novel-local-runtime-client.js", import.meta.url), "utf8");

class FakeStorage {
  #entries = new Map();
  get length() { return this.#entries.size; }
  key(index) { return [...this.#entries.keys()][index] ?? null; }
  getItem(key) { return this.#entries.has(String(key)) ? this.#entries.get(String(key)) : null; }
  setItem(key, value) { this.#entries.set(String(key), String(value)); }
  removeItem(key) { this.#entries.delete(String(key)); }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.disabled = false;
    this.hidden = false;
    this.value = "sensitive";
    this.textContent = "";
    this.title = "";
    this.dataset = {};
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
}

function createHarness(search = "?screen=home") {
  class HarnessStorage extends FakeStorage {}
  const localStorage = new HarnessStorage();
  const sessionStorage = new HarnessStorage();
  const networkCalls = [];
  const elementIds = [
    "aiOutput", "miniAiOutput", "phase1LocalGenerationStatus", "aiProvider", "aiEndpoint",
    "aiModel", "aiToken", "miniAiMode", "miniAiEndpoint", "miniAiModel", "phase1OllamaEndpoint",
    "phase1OllamaModel", "phase1CenterOllamaEndpoint", "phase1CenterOllamaModel",
    "phase1TrainingEndpoint", "wholeNovelWorkspaceDiagnostics", "h2w3ArchitectureAlignment",
  ];
  const elements = new Map(elementIds.map((id) => [id, new FakeElement(id)]));
  const blockedButtons = ["askExternalAI()", "detectOllamaModels()", "centerStartGeneration()"].map((handler) => {
    const button = new FakeElement();
    button.attributes.set("onclick", handler);
    return button;
  });
  const document = {
    documentElement: {},
    getElementById: (id) => elements.get(id) || null,
    querySelectorAll: (selector) => selector === "button[onclick]" ? blockedButtons : [],
  };
  const location = {
    href: `https://preview-r3.example/legacy/novel-system.html${search}`,
    origin: "https://preview-r3.example",
    search,
  };
  const window = {
    localStorage,
    sessionStorage,
    location,
    fetch: async (input, init) => {
      networkCalls.push({ input: String(input), method: init?.method || "GET" });
      return { ok: true, status: 200 };
    },
    addEventListener() {},
    Phase1Novel: {
      detectOllamaModels: async () => "old-ollama",
      testOllamaModel: async () => "old-test",
      generateGuidedChapterWithOllama: async () => "old-generate",
      abortGuidedGeneration() {},
      regenerateGuidedScene: async () => "old-regenerate",
      runGuidedLoopAcceptance: async () => "old-acceptance",
      generateAiCandidate: async () => "old-candidate",
      aiContinue: async () => "old-continue",
      refreshNetworkStatus: async () => "old-status",
    },
    LocalTrainingService: { startTraining: async () => "old-training" },
  };
  Object.defineProperty(window, "askExternalAI", {
    configurable: false,
    enumerable: true,
    writable: true,
    value: async () => "old-external-ai",
  });
  const context = vm.createContext({
    window,
    document,
    location,
    Storage: HarnessStorage,
    URL,
    URLSearchParams,
    MutationObserver: class { observe() {} },
    console,
    Date,
    Promise,
    Object,
    Error,
  });
  return { context, window, localStorage, sessionStorage, networkCalls, elements, blockedButtons };
}

const results = [];
async function test(id, title, fn) {
  const started = performance.now();
  try {
    await fn();
    results.push({ id, title, status: "PASS", elapsedMs: Math.round(performance.now() - started) });
  } catch (error) {
    results.push({ id, title, status: "FAIL", elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) });
  }
}

async function expectDisabled(promiseFactory) {
  await assert.rejects(promiseFactory, (error) => error?.code === "LEGACY_PROVIDER_PATH_DISABLED");
}

const harness = createHarness();
for (const key of ["novel_external_ai_cfg", "novel_admin_token", "novel_session_ai_token", "novel_local_training_endpoint", "phase1-local-ai-endpoint"]) {
  harness.localStorage.setItem(key, `secret-${key}`);
}
harness.sessionStorage.setItem("novel_admin_token", "session-secret");
vm.runInContext(boundarySource, harness.context, { filename: "legacy-security-boundary.js" });

await test("LEGACY_SCRIPT_LAST", "安全邊界是 Legacy 最後載入的外部腳本", async () => {
  const scripts = [...htmlSource.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/g)].map((match) => match[1]);
  assert.match(scripts.at(-1) || "", /legacy-security-boundary\.js/);
  assert.match(await readFile(new URL("../public/legacy/novel-system.js", import.meta.url), "utf8"), /LegacySecurityBoundary\?\.closedOnly/);
});
await test("LEGACY_KEYS_REMOVED", "既有敏感 localStorage 與 sessionStorage key 已刪除", async () => {
  for (const key of ["novel_external_ai_cfg", "novel_admin_token", "novel_session_ai_token", "novel_local_training_endpoint", "phase1-local-ai-endpoint"]) assert.equal(harness.localStorage.getItem(key), null);
  assert.equal(harness.sessionStorage.getItem("novel_admin_token"), null);
});
await test("LEGACY_KEYS_REINJECTION", "localStorage 注入不能恢復敏感設定", async () => {
  harness.localStorage.setItem("novel_external_ai_cfg", JSON.stringify({ endpoint: "https://evil.example", apiKey: "secret" }));
  harness.localStorage.setItem("phase1-local-ai-endpoint", "http://127.0.0.1:11434");
  assert.equal(harness.localStorage.getItem("novel_external_ai_cfg"), null);
  assert.equal(harness.localStorage.getItem("phase1-local-ai-endpoint"), null);
});
await test("LEGACY_MIGRATION_SANITIZED", "遷移紀錄不保存敏感值", async () => {
  const record = harness.localStorage.getItem("legacy_security_migration_v1") || "";
  assert.ok(record.includes("sanitized"));
  assert.equal(record.includes("secret-"), false);
  assert.equal(record.includes("11434"), false);
});
await test("LEGACY_DIRECT_OLLAMA", "直接 Ollama 11434 被阻擋", () => expectDisabled(() => harness.window.fetch("http://127.0.0.1:11434/api/chat", { method: "POST" })));
await test("LEGACY_DIRECT_LMSTUDIO", "直接 LM Studio 1234 被阻擋", () => expectDisabled(() => harness.window.fetch("http://localhost:1234/v1/chat/completions", { method: "POST" })));
await test("LEGACY_DIRECT_BRIDGE", "Legacy 直接 Local Bridge 3217 被阻擋", () => expectDisabled(() => harness.window.fetch("http://127.0.0.1:3217/v1/generate", { method: "POST" })));
await test("LEGACY_ARBITRARY_ENDPOINT", "任意跨來源 endpoint 被阻擋", () => expectDisabled(() => harness.window.fetch("https://api.example/v1/chat", { method: "POST" })));
await test("LEGACY_EXTERNAL_API", "Gemini/OpenAI 等外部 API 被阻擋", async () => {
  await expectDisabled(() => harness.window.fetch("https://generativelanguage.googleapis.com/v1/models", { method: "POST" }));
  await expectDisabled(() => harness.window.fetch("https://api.openai.com/v1/chat/completions", { method: "POST" }));
});
await test("LEGACY_SAME_ORIGIN_AI", "同來源舊 AI mutation endpoint 被阻擋", () => expectDisabled(() => harness.window.fetch("/api/ai/analyze", { method: "POST" })));
await test("LEGACY_FORMAL_STORY_BIBLE_API", "Legacy 不能直接呼叫正式 Story Bible mutation", async () => {
  await expectDisabled(() => harness.window.fetch("/api/story-bible/candidates/candidate-1/approve", { method: "POST" }));
  await expectDisabled(() => harness.window.fetch("/api/story-bible/candidates/candidate-1/reject", { method: "POST" }));
});
await test("LEGACY_STATIC_ALLOWED", "同來源靜態 GET 保持可用", async () => {
  const response = await harness.window.fetch("/legacy/novel-system.js");
  assert.equal(response.ok, true);
  assert.equal(harness.networkCalls.length, 1);
});
await test("LEGACY_SERVICE_FROZEN", "NovelAIService console 直呼與覆寫皆被阻擋", async () => {
  await expectDisabled(() => harness.window.NovelAIService.generate({}));
  await expectDisabled(() => harness.window.NovelAIService.listLocalModels());
  const descriptor = Object.getOwnPropertyDescriptor(harness.window, "NovelAIService");
  const protectedService = harness.window.NovelAIService;
  harness.window.NovelAIService = {};
  assert.equal(harness.window.NovelAIService, protectedService);
  assert.equal(typeof descriptor?.set, "function");
  assert.equal(descriptor?.configurable, false);
  assert.equal(Object.isFrozen(harness.window.NovelAIService), true);
});
await test("LEGACY_FUNCTION_BYPASS", "舊全域函式與 console 直呼被阻擋", async () => {
  for (const name of ["askExternalAI", "miniAiAskLocal", "detectOllamaModels", "centerStartGeneration"]) {
    await expectDisabled(() => harness.window[name]());
    const descriptor = Object.getOwnPropertyDescriptor(harness.window, name);
    const protectedFunction = harness.window[name];
    Reflect.set(harness.window, name, () => "bypass");
    assert.equal(harness.window[name], protectedFunction);
    assert.equal(typeof descriptor?.set === "function" || descriptor?.writable === false, true);
    assert.equal(descriptor?.configurable, false);
  }
});
await test("LEGACY_PHASE1_OBJECT_BYPASS", "Phase1Novel 物件方法不能由 console 繞過", async () => {
  for (const name of ["detectOllamaModels", "testOllamaModel", "generateGuidedChapterWithOllama", "generateAiCandidate", "aiContinue"]) {
    await expectDisabled(() => harness.window.Phase1Novel[name]());
    const descriptor = Object.getOwnPropertyDescriptor(harness.window.Phase1Novel, name);
    const protectedFunction = harness.window.Phase1Novel[name];
    harness.window.Phase1Novel[name] = () => "bypass";
    assert.equal(harness.window.Phase1Novel[name], protectedFunction);
    assert.equal(typeof descriptor?.set, "function");
    assert.equal(descriptor?.configurable, false);
  }
});
await test("LEGACY_TRAINING_BYPASS", "Legacy 訓練服務不能由 UI 或 console 直呼", async () => {
  await expectDisabled(() => harness.window.LocalTrainingService.startTraining({}));
  await expectDisabled(() => harness.window.LocalTrainingService.health());
  assert.equal(Object.isFrozen(harness.window.LocalTrainingService), true);
});
await test("LEGACY_UI_DISABLED", "舊 provider controls 與按鈕不可用", async () => {
  for (const id of ["aiEndpoint", "aiToken", "miniAiEndpoint", "phase1OllamaEndpoint", "phase1TrainingEndpoint"]) {
    assert.equal(harness.elements.get(id)?.disabled, true);
    assert.equal(harness.elements.get(id)?.value, "");
  }
  assert.equal(harness.blockedButtons.every((button) => button.disabled), true);
});
await test("LEGACY_QUERY_BYPASS", "一般 query/bookmark 不能重新啟用 diagnostics 或 provider", async () => {
  assert.equal(harness.elements.get("wholeNovelWorkspaceDiagnostics")?.hidden, true);
  assert.equal(harness.window.LegacySecurityBoundary.closedOnly, true);
  assert.equal(harness.window.LegacySecurityBoundary.directProviders, "blocked");
});
await test("LEGACY_NO_EXTERNAL_TRAFFIC", "所有被拒絕路徑沒有抵達底層 fetch", async () => {
  assert.deepEqual(harness.networkCalls, [{ input: "/legacy/novel-system.js", method: "GET" }]);
});

const diagnosticsHarness = createHarness("?diagnostics=true&provider=ollama&endpoint=http://127.0.0.1:11434");
vm.runInContext(boundarySource, diagnosticsHarness.context, { filename: "legacy-security-boundary.js" });
await test("LEGACY_DIAGNOSTICS_SCOPE", "diagnostics query 只顯示診斷，不解除網路邊界", async () => {
  assert.equal(diagnosticsHarness.elements.get("wholeNovelWorkspaceDiagnostics")?.hidden, false);
  await expectDisabled(() => diagnosticsHarness.window.fetch("http://127.0.0.1:11434/api/tags"));
});

const failed = results.filter((result) => result.status !== "PASS");
const storageAudit = {
  generatedAt: new Date().toISOString(),
  scope: "isolated-runtime-execution",
  keys: [
    { key: "novel_external_ai_cfg", status: harness.localStorage.getItem("novel_external_ai_cfg") === null ? "NOT_PRESENT" : "VERIFIED" },
    { key: "novel_admin_token", status: harness.localStorage.getItem("novel_admin_token") === null ? "NOT_PRESENT" : "VERIFIED" },
    { key: "novel_session_ai_token", status: harness.localStorage.getItem("novel_session_ai_token") === null ? "NOT_PRESENT" : "VERIFIED" },
    { key: "novel_local_training_endpoint", status: harness.localStorage.getItem("novel_local_training_endpoint") === null ? "NOT_PRESENT" : "VERIFIED" },
    { key: "phase1-local-ai-*", status: harness.localStorage.getItem("phase1-local-ai-endpoint") === null ? "NOT_PRESENT" : "VERIFIED" },
  ],
  inaccessibleEvidence: [],
};

await mkdir(evidenceDir, { recursive: true });
await writeFile(new URL("legacy-closed-only-tests.json", evidenceDir), `${JSON.stringify({ generatedAt: new Date().toISOString(), pass: results.length - failed.length, fail: failed.length, results }, null, 2)}\n`);
await writeFile(new URL("legacy-credential-migration.json", evidenceDir), `${JSON.stringify(storageAudit, null, 2)}\n`);
await writeFile(new URL("legacy-data-isolation-tests.json", evidenceDir), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  status: failed.length ? "FAIL" : "PASS",
  checks: [
    { id: "formal-api-mutations-blocked", status: results.find((result) => result.id === "LEGACY_FORMAL_STORY_BIBLE_API")?.status || "FAIL" },
    { id: "studio-indexeddb-not-opened-by-legacy-runtime", status: legacyRuntimeSource.includes("novel-intelligence-platform") ? "FAIL" : "PASS" },
    { id: "studio-repository-not-imported-by-legacy-runtime", status: legacyRuntimeSource.includes("createNovelRepository") ? "FAIL" : "PASS" },
    { id: "legacy-local-storage-is-not-studio-canonical", status: htmlSource.includes("novel_platform_state") && !htmlSource.includes("novel-intelligence-platform") ? "PASS" : "FAIL" },
    { id: "accepted-choice-direct-write-absent", status: /acceptedChoices\s*[:=]/.test(legacyRuntimeSource) ? "FAIL" : "PASS" },
    { id: "story-branch-direct-write-absent", status: /storyBranches\s*[:=]/.test(legacyRuntimeSource) ? "FAIL" : "PASS" },
  ],
}, null, 2)}\n`);
await writeFile(new URL("legacy-feature-classification.json", evidenceDir), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  classifications: [
    { feature: "離線小說編輯與舊作品讀取", classification: "safe_legacy_tool", formalStudioWrite: false },
    { feature: "TXT/舊 JSON 匯出", classification: "safe_legacy_tool", formalStudioWrite: false },
    { feature: "舊作品匯入", classification: "migration_only", requirement: "schema migration, validation, user review, revision check" },
    { feature: "複製提示詞與開啟外部網站", classification: "manual_external_handoff", automaticRequest: false },
    { feature: "OpenAI-compatible/Gemini 外部連線", classification: "blocked", reason: "Legacy cannot bypass Router privacy policy" },
    { feature: "Ollama 11434 直連", classification: "blocked", replacement: "Studio -> Local Bridge -> Ollama" },
    { feature: "LM Studio 1234 直連", classification: "blocked", replacement: "No approved adapter" },
    { feature: "任意 endpoint", classification: "blocked", replacement: "No approved adapter" },
    { feature: "Legacy 本機訓練服務", classification: "deprecated", runtimeStatus: "not_implemented" },
    { feature: "Legacy Story Bible 正式寫入", classification: "blocked", replacement: "Studio validated candidate approval" },
    { feature: "Whole Novel diagnostics", classification: "admin_only", defaultVisible: false },
    { feature: "Legacy localStorage 正式資料", classification: "migration_only", sourceOfTruth: false },
  ],
}, null, 2)}\n`);

console.log(JSON.stringify({ pass: results.length - failed.length, fail: failed.length, evidence: "artifacts/closed-ai-phase1-1r3" }, null, 2));
if (failed.length) process.exitCode = 1;
