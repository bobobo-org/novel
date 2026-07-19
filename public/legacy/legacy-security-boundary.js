(function legacySecurityBoundary() {
  "use strict";

  const BOUNDARY_VERSION = "legacy-security-boundary-v1";
  const DISABLED_CODE = "LEGACY_PROVIDER_PATH_DISABLED";
  const blockedStorageKeys = [
    /^novel_external_ai_cfg$/,
    /^novel_admin_token$/,
    /^novel_session_ai_token$/,
    /^novel_local_training_endpoint$/,
    /^phase1-local-ai-/,
  ];
  const blockedFunctions = [
    "askExternalAI",
    "miniAiAskLocal",
    "detectOllamaModels",
    "testOllamaModel",
    "startGuidedLocalGeneration",
    "centerDetectOllama",
    "centerTestOllama",
    "centerStartGeneration",
    "runLocalAiAcceptance",
  ];
  const blockedPhase1Methods = [
    "detectOllamaModels",
    "testOllamaModel",
    "generateGuidedChapterWithOllama",
    "abortGuidedGeneration",
    "regenerateGuidedScene",
    "runGuidedLoopAcceptance",
    "generateAiCandidate",
    "aiContinue",
    "refreshNetworkStatus",
  ];
  const originalFetch = window.fetch.bind(window);
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  function isBlockedStorageKey(key) {
    return blockedStorageKeys.some((pattern) => pattern.test(String(key || "")));
  }

  function disabledError() {
    return Object.assign(new Error("此舊連線方式已停用，請前往正式創作中心的本機 AI 設定。"), { code: DISABLED_CODE });
  }

  function disabledAction() {
    const output = document.getElementById("aiOutput") || document.getElementById("miniAiOutput") || document.getElementById("phase1LocalGenerationStatus");
    if (output) output.textContent = "此舊連線方式已停用。請使用正式創作中心的本機 AI 設定。";
    return Promise.reject(disabledError());
  }

  function lockGlobal(name, value) {
    Object.defineProperty(window, name, {
      configurable: false,
      enumerable: true,
      get: () => value,
      set: () => undefined,
    });
  }

  function lockObjectMethod(target, name, value) {
    Object.defineProperty(target, name, {
      configurable: false,
      enumerable: true,
      get: () => value,
      set: () => undefined,
    });
  }

  function installStorageGuard() {
    let removed = 0;
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (isBlockedStorageKey(key)) {
          originalRemoveItem.call(storage, key);
          removed += 1;
        }
      }
    }
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: false,
      writable: false,
      value(key, value) {
        if (isBlockedStorageKey(key)) {
          originalRemoveItem.call(this, String(key));
          return undefined;
        }
        return originalSetItem.call(this, key, value);
      },
    });
    originalSetItem.call(window.localStorage, "legacy_security_migration_v1", JSON.stringify({
      version: BOUNDARY_VERSION,
      status: "sanitized",
      removedKeyCount: removed,
      migratedAt: new Date().toISOString(),
    }));
  }

  function installNetworkGuard() {
    const guardedFetch = async (input, init) => {
      const raw = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url || "");
      const url = new URL(raw, window.location.href);
      const method = String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
      const localModelPort = ["11434", "1234", "3217"].includes(url.port);
      const crossOrigin = url.origin !== window.location.origin;
      const aiMutation = method !== "GET" && /^\/(api\/|legacy\/api)/.test(url.pathname);
      if (localModelPort || crossOrigin || aiMutation) throw disabledError();
      return originalFetch(input, init);
    };
    Object.defineProperty(window, "fetch", { configurable: false, writable: false, value: guardedFetch });
  }

  function installProviderGuard() {
    const reject = async () => { throw disabledError(); };
    const rejectStream = async function* rejectLegacyStream() { throw disabledError(); };
    const service = Object.freeze({
      boundaryVersion: BOUNDARY_VERSION,
      status: "blocked",
      getConfig: () => ({ provider: "disabled", endpoint: "", model: "", token: "" }),
      validateConfig: () => { throw disabledError(); },
      generate: reject,
      generateStream: rejectStream,
      listLocalModels: reject,
      testLocalModel: reject,
      createOllamaProvider: () => Object.freeze({ isAvailable: async () => false, listModels: reject, generate: rejectStream, generateJson: reject, abort() {} }),
      abortOllama() {},
      saveSessionToken: () => { throw disabledError(); },
      clearToken: () => "舊連線憑證已清除。",
      checkLocalModel: async () => "舊本機模型直連已停用",
    });
    lockGlobal("NovelAIService", service);
    for (const name of blockedFunctions) lockGlobal(name, disabledAction);
    const trainingService = Object.freeze({
      status: "blocked",
      baseUrl: () => "",
      saveEndpoint: () => { throw disabledError(); },
      get: reject,
      post: reject,
      abort() {},
      health: reject,
      hardware: reject,
      models: reject,
      trainingStatus: reject,
      trainingLogs: reject,
      adapters: reject,
      buildDataset: reject,
      validateDataset: reject,
      startTraining: reject,
      stopTraining: reject,
      testAdapter: reject,
      activateAdapter: reject,
      deleteAdapter: reject,
    });
    lockGlobal("LocalTrainingService", trainingService);
    if (window.Phase1Novel && typeof window.Phase1Novel === "object") {
      for (const name of blockedPhase1Methods) {
        if (!(name in window.Phase1Novel)) continue;
        lockObjectMethod(window.Phase1Novel, name, disabledAction);
      }
    }
  }

  function hardenUi() {
    const directControls = [
      "aiProvider", "aiEndpoint", "aiModel", "aiToken",
      "miniAiMode", "miniAiEndpoint", "miniAiModel",
      "phase1OllamaEndpoint", "phase1OllamaModel",
      "phase1CenterOllamaEndpoint", "phase1CenterOllamaModel",
      "phase1TrainingEndpoint",
    ];
    for (const id of directControls) {
      const element = document.getElementById(id);
      if (!element) continue;
      element.disabled = true;
      element.setAttribute("aria-disabled", "true");
      element.dataset.legacySecurityBoundary = "disabled";
      if ("value" in element && /endpoint|token/i.test(id)) element.value = "";
    }
    const blockedHandlerNames = new Set(blockedFunctions.concat(blockedPhase1Methods, ["saveAiSettings", "fillAiPreset", "LocalTrainingService"]));
    document.querySelectorAll("button[onclick]").forEach((button) => {
      const handler = button.getAttribute("onclick") || "";
      if (![...blockedHandlerNames].some((name) => handler.includes(name))) return;
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      button.dataset.legacySecurityBoundary = "disabled";
      button.title = "此舊連線方式已停用，請使用正式創作中心的本機 AI 設定。";
    });
    const diagnostics = document.getElementById("wholeNovelWorkspaceDiagnostics");
    if (diagnostics && new URLSearchParams(location.search).get("diagnostics") !== "true") diagnostics.hidden = true;
    const architecture = document.getElementById("h2w3ArchitectureAlignment");
    const architectureText = [
      "閉端 AI 能力狀態",
      "Browser AI：尚未完成",
      "個人本機 Ollama：請使用正式創作中心設定；Legacy 直連已停用",
      "私有 AI 中樞：尚未完成",
      "本機檢索與候選稿：僅資料處理，不代表模型已就緒",
      "模型訓練：未實作；現有學習功能僅為偏好、記憶或資料準備",
    ].join("\n");
    if (architecture && architecture.textContent !== architectureText) architecture.textContent = architectureText;
  }

  installStorageGuard();
  installNetworkGuard();
  installProviderGuard();
  hardenUi();
  window.addEventListener("DOMContentLoaded", hardenUi, { once: true });
  new MutationObserver(hardenUi).observe(document.documentElement, { childList: true, subtree: true });
  Object.defineProperty(window, "LegacySecurityBoundary", {
    configurable: false,
    writable: false,
    value: Object.freeze({ version: BOUNDARY_VERSION, status: "active", closedOnly: true, directProviders: "blocked" }),
  });
})();
