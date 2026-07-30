(function legacySecurityBoundary() {
  "use strict";

  const BOUNDARY_VERSION = "legacy-security-boundary-v3";
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
    "cloudNovelAiFetch",
    "cloudNovelAiHealth",
    "cloudNovelAiAnalyze",
    "cloudNovelAiPlan",
    "cloudNovelAiReview",
    "cloudNovelAiFeedback",
    "cloudNovelAiStats",
    "cloudNovelAiCases",
    "cloudNovelAiExportJsonl",
    "cloudNovelAiRunEvals",
    "cloudNovelAiAbort",
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
  const lockFailures = [];
  const boundaryState = {
    version: BOUNDARY_VERSION,
    status: "initializing",
    closedOnly: true,
    directProviders: "initializing",
    lockFailureCount: 0,
  };
  Object.defineProperty(window, "LegacySecurityBoundary", {
    configurable: false,
    writable: false,
    value: boundaryState,
  });

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

  function closedAgentTask(handler) {
    if (/train|adapter|distill/i.test(handler)) return "learning.preferenceReview";
    if (/dialog/i.test(handler)) return "character.dialogue";
    if (/timeline/i.test(handler)) return "story.timelineCheck";
    if (/world|rule/i.test(handler)) return "story.worldRuleCheck";
    if (/consisten|review|audit|analy/i.test(handler)) return "story.consistencyCheck";
    if (/rewrite|regenerate/i.test(handler)) return "chapter.rewrite";
    if (/outline|plan/i.test(handler)) return "chapter.outline";
    return "chapter.continue";
  }

  function officialClosedAIUrl(handler, label) {
    const rawProjectId = String(document.body?.dataset?.frontdoorProjectId || "");
    const projectId = /^[A-Za-z0-9_-]{1,128}$/.test(rawProjectId) ? rawProjectId : "";
    if (!projectId) return "/studio/create?from=legacy-ai&target=closed-ai";
    const query = new URLSearchParams({
      task: closedAgentTask(handler),
      objective: `從 Legacy 工具交接「${String(label || "AI 工作").slice(0, 120)}」。請依已核准作品資料建立候選，不得直接修改 Memory 或 Canon。`,
      source: "legacy-safe-handoff",
    });
    return `/studio/project/${encodeURIComponent(projectId)}/closed-ai?${query.toString()}`;
  }

  function installOfficialClosedAIReplacement(button, handler) {
    if (
      button.dataset.officialClosedAiReplacement === "installed"
      || typeof document.createElement !== "function"
      || typeof button.insertAdjacentElement !== "function"
    ) return;
    button.dataset.officialClosedAiReplacement = "installed";
    const replacement = document.createElement("button");
    replacement.type = "button";
    replacement.className = button.className || "btn";
    replacement.textContent = `在閉端 AI 中心執行：${button.textContent?.trim() || "AI 工作"}`;
    replacement.dataset.officialClosedAiHandoff = closedAgentTask(handler);
    replacement.title = "使用正式 Closed Agent OS；候選需人工核准。";
    replacement.addEventListener("click", () => {
      location.assign(officialClosedAIUrl(handler, button.textContent));
    });
    button.insertAdjacentElement("afterend", replacement);
  }

  function lockGlobal(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && descriptor.configurable === false) {
      if ("value" in descriptor && descriptor.writable) {
        Object.defineProperty(window, name, {
          configurable: false,
          enumerable: descriptor.enumerable,
          writable: false,
          value,
        });
        return true;
      }
      if ("value" in descriptor && descriptor.value === value) return true;
      lockFailures.push(`window.${name}`);
      return false;
    }
    Object.defineProperty(window, name, {
      configurable: false,
      enumerable: true,
      get: () => value,
      set: () => undefined,
    });
    return true;
  }

  function lockObjectMethod(target, name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (descriptor && descriptor.configurable === false) {
      if ("value" in descriptor && descriptor.writable) {
        Object.defineProperty(target, name, {
          configurable: false,
          enumerable: descriptor.enumerable,
          writable: false,
          value,
        });
        return true;
      }
      if ("value" in descriptor && descriptor.value === value) return true;
      lockFailures.push(`Phase1Novel.${name}`);
      return false;
    }
    Object.defineProperty(target, name, {
      configurable: false,
      enumerable: true,
      get: () => value,
      set: () => undefined,
    });
    return true;
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
      installOfficialClosedAIReplacement(button, handler);
    });
    const diagnostics = document.getElementById("wholeNovelWorkspaceDiagnostics");
    if (diagnostics && new URLSearchParams(location.search).get("diagnostics") !== "true") diagnostics.hidden = true;
    const architecture = document.getElementById("h2w3ArchitectureAlignment");
    const architectureText = [
      "閉端 AI 能力狀態",
      "Browser AI：已接入 Closed Agent OS；能否執行取決於目前裝置模型",
      "個人本機 Ollama：已接入 Local Bridge；需啟動、配對與真實模型驗證",
      "私有 AI 中樞：已接入自架 Private Hub；需啟動、配對與真實模型驗證",
      "AI Cache、Memory、Learning、Canon：分層隔離；候選不會自動成為正式事實",
      "可控學習：L0／L1 規則核准可用；L2 離線偏好模型可訓練、啟用與回滾",
      "LLM 權重工作：LoRA 候選與蒸餾流程已開始；QLoRA 仍受本機 CUDA 硬體限制",
      "Legacy 舊直連：持續停用；請使用旁邊新增的正式閉端 AI 交接按鈕",
    ].join("\n");
    if (architecture && architecture.textContent !== architectureText) architecture.textContent = architectureText;
    const cloudPanel = document.getElementById("cloudNovelAiPanel");
    if (cloudPanel) {
      cloudPanel.hidden = true;
      cloudPanel.setAttribute("aria-hidden", "true");
      cloudPanel.dataset.legacySecurityBoundary = "disabled";
    }
  }

  installStorageGuard();
  installNetworkGuard();
  installProviderGuard();
  hardenUi();
  window.addEventListener("DOMContentLoaded", hardenUi, { once: true });
  new MutationObserver(hardenUi).observe(document.documentElement, { childList: true, subtree: true });
  Object.assign(boundaryState, {
    status: lockFailures.length === 0 ? "active" : "degraded",
    directProviders: lockFailures.length === 0 ? "blocked" : "partially_blocked",
    lockFailureCount: lockFailures.length,
  });
  Object.freeze(boundaryState);
})();
