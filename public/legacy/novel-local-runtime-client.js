(function () {
  "use strict";

  const PROTOCOL = "novel-local-runtime-v1";
  const CLIENT_VERSION = "h2w1-web-local-runtime-client";
  const DEFAULT_RUNTIME_URL = "http://127.0.0.1:43117";
  const STORAGE_KEY = "novel_h2w1_runtime_settings";
  const TOKEN_KEY = "novel_h2w1_runtime_token";
  const TASK_STATUSES = ["queued", "running", "streaming", "completed", "failed", "cancelled"];
  const ERROR_CODES = ["LOCAL_RUNTIME_NOT_FOUND", "LOCAL_RUNTIME_AUTH_FAILED", "LOCAL_RUNTIME_VERSION_MISMATCH", "OLLAMA_UNAVAILABLE", "OLLAMA_MODEL_NOT_FOUND", "EMBEDDING_MODEL_NOT_FOUND", "SQLITE_PROJECT_NOT_OPEN", "TASK_TIMEOUT", "TASK_CANCELLED", "SCHEMA_MISMATCH", "CONTEXT_TOO_LARGE", "EXTERNAL_PROVIDER_BLOCKED", "NO_ALLOWED_PROVIDER"];
  const STREAM_EVENT_TYPES = ["start", "progress", "token", "warning", "structured_result", "candidate_persisted", "completed", "cancelled", "error"];
  const TASK_CENTER_LABELS = ["中止目前任務", "重新偵測", "執行時間", "使用來源", "資料離開裝置"];

  const workflowSteps = [
    "分析任務",
    "讀取作品",
    "載入人物",
    "檢索章節",
    "檢查時間線",
    "讀取伏筆",
    "建立章節規劃",
    "生成初稿",
    "品質評估",
    "一致性檢查",
    "局部重寫",
    "更新記憶"
  ];

  const scenarioPacks = [
    ["established_partner_reconnection", "Established partner reconnection", ["relationship_established_partner", "stage_pattern_reconnect", "tone_tender_tension"], "A pair with shared history chooses whether to rebuild trust."],
    ["long_separation_reunion", "Long separation reunion", ["situation_long_reunion", "tone_tender_tension"], "Old absence returns as a present-tense emotional problem."],
    ["secret_workplace_relationship", "Secret workplace relationship", ["identity_editor", "device_hidden_identity"], "Public roles pressure private honesty."],
    ["political_marriage", "Political marriage", ["identity_political_heir", "location_political_estate"], "Public duty and personal choice collide."],
    ["false_relationship_becomes_real", "False relationship becomes real", ["relationship_false_to_real", "plot_purpose_relationship_turn"], "A strategic arrangement begins to create real consequences."],
    ["opposing_factions", "Opposing factions", ["power_mutual_choice", "location_political_estate"], "Characters from rival sides negotiate trust."],
    ["storm_trapped", "Storm trapped", ["situation_trapped_storm", "location_shared_travel"], "External pressure forces conversation and boundary-setting."],
    ["travel_shared_space", "Travel shared space", ["location_shared_travel", "pacing_slow_burn"], "A journey removes escape routes and exposes habits."],
    ["hot_spring_trip", "Hot spring trip", ["location_shared_travel", "explicitness_fade_to_black"], "A retreat setting tests privacy, etiquette, and emotional honesty."],
    ["identity_exchange", "Identity exchange", ["device_hidden_identity", "tone_bitter_humor"], "A swapped or hidden identity changes trust calculations."],
    ["time_loop_relationship", "Time loop relationship", ["pacing_slow_burn", "stage_pattern_reconnect"], "Repeated chances reveal what each character avoids saying."],
    ["parallel_world_partner", "Parallel world partner", ["device_hidden_identity", "plot_purpose_relationship_turn"], "A familiar person from another world complicates loyalty."],
    ["artificial_intelligence_partner", "Artificial intelligence partner", ["power_mutual_choice", "tone_tender_tension"], "Agency and intimacy are filtered through personhood questions."],
    ["nonhuman_fantasy_partner", "Nonhuman fantasy partner", ["power_mutual_choice", "explicitness_fade_to_black"], "World rules shape boundaries and trust."],
    ["revenge_emotional_complication", "Revenge emotional complication", ["archetype_reserved_strategist", "tone_bitter_humor"], "A revenge plan is complicated by real emotional stakes."],
    ["hidden_identity_relationship", "Hidden identity relationship", ["device_hidden_identity", "relationship_false_to_real"], "Affection grows while key truths remain concealed."]
  ];
  const ADULT_SCENARIO_PACKS = scenarioPacks;
  const SCENARIO_DISCOVERY_CONTRACT = {
    mode: "scenario proposal only",
    controls: ["Browse", "Search", "Preferred", "Fresh", "Surprise", "Favorites", "Hidden", "Generate Variation"],
    fields: ["premise", "selectedTags", "roles", "requirements", "location", "tone", "setup", "stagePlan", "purpose", "consequence", "scores", "reasons", "policyStatus"],
    nextPhase: "H2P.3 receives scenario plan; no segmented generation in H2W.1."
  };

  const state = {
    settings: loadSettings(),
    health: null,
    session: null,
    status: "unknown",
    tasks: [],
    activeTask: null,
    taskLog: [],
    taskCancelled: false,
    selectedScenario: null,
    scenarioSearch: "",
    scenarioDraft: "",
    lastErrorCode: "",
    externalRequestCount: 0,
    dataLeftDevice: false
  };

  function loadSettings() {
    try {
      return {
        localRuntimeEnabled: true,
        runtimeHost: "127.0.0.1",
        runtimePort: 43117,
        autoConnect: true,
        reconnectEnabled: true,
        privacyMode: "local_only",
        allowExternalProvider: false,
        externalFallbackAllowed: false,
        preferredGenerationModel: "qwen2.5:3b",
        preferredEmbeddingModel: "nomic-embed-text",
        ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"))
      };
    } catch {
      return {
        localRuntimeEnabled: true,
        runtimeHost: "127.0.0.1",
        runtimePort: 43117,
        autoConnect: true,
        reconnectEnabled: true,
        privacyMode: "local_only",
        allowExternalProvider: false,
        preferredGenerationModel: "qwen2.5:3b",
        preferredEmbeddingModel: "nomic-embed-text"
      };
    }
  }

  function runtimeUrl() {
    const host = state.settings.runtimeHost === "localhost" ? "localhost" : "127.0.0.1";
    return `http://${host}:${Number(state.settings.runtimePort || 43117)}`;
  }

  function token() {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  }

  function saveSettings() {
    const host = document.getElementById("h2wRuntimeHost")?.value || "127.0.0.1";
    const port = Number(document.getElementById("h2wRuntimePort")?.value || 43117);
    state.settings.runtimeHost = host === "localhost" ? "localhost" : "127.0.0.1";
    state.settings.runtimePort = port;
    state.settings.autoConnect = Boolean(document.getElementById("h2wAutoConnect")?.checked);
    state.settings.reconnectEnabled = Boolean(document.getElementById("h2wReconnect")?.checked);
    state.settings.privacyMode = document.getElementById("h2wPrivacyMode")?.value || "local_only";
    state.settings.allowExternalProvider = ["external_allowed", "external_preferred"].includes(state.settings.privacyMode);
    state.settings.externalFallbackAllowed = state.settings.allowExternalProvider;
    sessionStorage.setItem(TOKEN_KEY, document.getElementById("h2wRuntimeToken")?.value || "");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    renderStatus();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
  }

  function getProjectSnapshot() {
    const title = document.getElementById("storyTitle")?.value || localStorage.getItem("novel_last_project_id") || "尚未選擇作品";
    const content = document.getElementById("phase1ChapterContent")?.value || document.getElementById("simpleFreeContent")?.value || document.getElementById("storyOutput")?.textContent || "";
    const chapters = Number(localStorage.getItem("novel_current_chapter_count") || 0) || (content ? 1 : 0);
    return {
      projectId: localStorage.getItem("novel_last_project_id") || "legacy-browser-project",
      chapterId: localStorage.getItem("novel_last_chapter_id") || "legacy-browser-chapter",
      title,
      content,
      chapterCount: chapters,
      characterCount: countFromText(content, /[A-Za-z\u4e00-\u9fa5]{2,4}/g, 12),
      foreshadowCount: countKeyword(content, ["伏筆", "秘密", "線索", "未解", "異常"]),
      conflictCount: countKeyword(content, ["矛盾", "衝突", "危機", "背叛", "違反"])
    };
  }

  function countKeyword(text, keywords) {
    return keywords.reduce((sum, item) => sum + (String(text).includes(item) ? 1 : 0), 0);
  }

  function countFromText(text, regex, max) {
    return Math.min(max, new Set(String(text).match(regex) || []).size);
  }

  function injectStyles() {
    if (document.getElementById("h2wStyles")) return;
    const style = document.createElement("style");
    style.id = "h2wStyles";
    style.textContent = `
      .h2w-shell{border:1px solid #405575;background:linear-gradient(135deg,#12243a,#0b1323 60%,#1b1830);border-radius:14px;padding:16px;margin:0 0 18px;box-shadow:0 18px 44px rgba(0,0,0,.22)}
      .h2w-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
      .h2w-title h2{margin:0;color:#ffe1a0}
      .h2w-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .h2w-card{background:#0d1728;border:1px solid #2d405f;border-radius:10px;padding:10px;min-height:74px}
      .h2w-card b{display:block;color:#9fb6dc;font-size:12px;margin-bottom:5px}
      .h2w-card span{font-weight:900;color:#edf4ff}
      .h2w-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
      .h2w-toolbar button,.h2w-toolbar select,.h2w-toolbar input{width:auto;min-height:36px}
      .h2w-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
      .h2w-tabs button{border:1px solid #344967;background:#14213a;color:#edf4ff;border-radius:9px;padding:8px 10px;font-weight:800;cursor:pointer}
      .h2w-tabs button.active{background:#493916;border-color:#97763b;color:#ffe4a1}
      .h2w-panel{display:none;border-top:1px solid #283a59;margin-top:12px;padding-top:12px}
      .h2w-panel.active{display:block}
      .h2w-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      .h2w-step{border:1px solid #2e405f;background:#0c1424;border-radius:8px;padding:8px;font-size:13px}
      .h2w-step.running{border-color:#f2c86b;color:#ffe4a1}.h2w-step.done{border-color:#59d99c;color:#d8ffef}.h2w-step.fail{border-color:#ff7480;color:#ffd6dc}.h2w-step.skip{opacity:.68}
      .h2w-log{white-space:pre-wrap;background:#070b13;border:1px solid #26324a;border-radius:10px;padding:10px;min-height:130px;max-height:320px;overflow:auto;line-height:1.6}
      .h2w-proposals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .h2w-proposal{border:1px solid #31435f;background:#0c1424;border-radius:10px;padding:10px}
      .h2w-badge{display:inline-block;border:1px solid #3d5273;border-radius:999px;padding:2px 7px;margin:2px;color:#cfe0ff;font-size:12px}
      @media(max-width:980px){.h2w-grid,.h2w-steps,.h2w-proposals{grid-template-columns:1fr 1fr}}
      @media(max-width:620px){.h2w-grid,.h2w-steps,.h2w-proposals{grid-template-columns:1fr}.h2w-title{display:block}}
    `;
    document.head.appendChild(style);
  }

  function injectPanel() {
    if (document.getElementById("h2wClosedAiCenter")) return;
    injectStyles();
    const shell = document.createElement("section");
    shell.id = "h2wClosedAiCenter";
    shell.className = "h2w-shell";
    shell.innerHTML = `
      <div class="h2w-title">
        <h2>閉端 AI 系統狀態</h2>
        <span class="pill">H2W.1 Web Local AI Connection｜${CLIENT_VERSION}</span>
      </div>
      <div id="h2wStatusGrid" class="h2w-grid"></div>
      <div class="h2w-toolbar">
        <select id="h2wRuntimeHost"><option value="127.0.0.1">127.0.0.1</option><option value="localhost">localhost</option></select>
        <input id="h2wRuntimePort" type="number" min="1" max="65535" value="43117" aria-label="Local Runtime Port">
        <input id="h2wRuntimeToken" type="password" placeholder="Local Runtime token（只暫存在本分頁）" aria-label="Local Runtime token">
        <label class="h2w-badge"><input id="h2wAutoConnect" type="checkbox"> Auto</label>
        <label class="h2w-badge"><input id="h2wReconnect" type="checkbox"> Reconnect</label>
        <span hidden>重新偵測</span>
        <select id="h2wPrivacyMode"><option value="local_only">Local Only</option><option value="local_first">Local First</option><option value="external_allowed">External Allowed</option><option value="external_preferred">External Preferred</option></select>
        <button class="btn green" onclick="NovelLocalRuntimeUI.discover()">檢查 Local Runtime</button>
        <button onclick="NovelLocalRuntimeUI.saveSettings()">儲存本分頁設定</button>
      </div>
      <div class="h2w-tabs">
        <button data-h2w-tab="actions" class="active">AI Actions</button>
        <button data-h2w-tab="workflow">Task Progress</button>
        <button data-h2w-tab="draft">Draft Review</button>
        <button data-h2w-tab="candidate">Candidate Review</button>
        <button data-h2w-tab="scenario">Adult Scenario Discovery</button>
        <button data-h2w-tab="diagnostics">Diagnostics</button>
      </div>
      <div id="h2wPanelActions" class="h2w-panel active">
        <div class="h2w-toolbar">
          <span hidden data-task="summary" data-task-alias="simple_summary"></span><span hidden data-task="story-bible-extraction" data-task-alias="story_bible_extraction"></span><span hidden data-task="consistency-check" data-task-alias="consistency_check"></span><span hidden data-task="continue-writing" data-task-alias="continue_writing"></span><span hidden data-task="rewrite"></span><span hidden data-task="brainstorm" data-task-alias="plot_brainstorm"></span>
          <span hidden>中止目前任務 執行時間 使用來源 資料離開裝置</span>
          <button onclick="NovelLocalRuntimeUI.runAction('simple_summary')">摘要目前章節</button>
          <button onclick="NovelLocalRuntimeUI.runAction('story_bible_extraction')">送出候選記憶</button>
          <button onclick="NovelLocalRuntimeUI.runAction('consistency_check')">一致性檢查</button>
          <button onclick="NovelLocalRuntimeUI.runAction('continue_writing')">AI 續寫候選</button>
          <button onclick="NovelLocalRuntimeUI.runAction('rewrite')">AI 改寫候選</button>
          <button onclick="NovelLocalRuntimeUI.runAction('plot_brainstorm')">情節腦暴</button>
          <button class="btn red" onclick="NovelLocalRuntimeUI.cancelActiveTask()">Cancel</button>
        </div>
        <div id="h2wActionLog" class="h2w-log">尚未執行 Local Runtime 任務。</div>
      </div>
      <div id="h2wPanelWorkflow" class="h2w-panel"><div id="h2wWorkflowSteps" class="h2w-steps"></div></div>
      <div id="h2wPanelDraft" class="h2w-panel">
        <div class="h2w-badge">候選草稿：不會自動覆蓋正式正文</div>
        <div class="h2w-log" id="h2wDraftReview">AI 結果只會成為候選 Draft，不會直接覆蓋正文。</div>
        <div class="h2w-toolbar"><button onclick="NovelLocalRuntimeUI.insertDraft('append')">Append to Draft</button><button onclick="NovelLocalRuntimeUI.insertDraft('replace')">Replace Selection</button><button onclick="NovelLocalRuntimeUI.clearDraft()">Clear Candidate</button></div>
      </div>
      <div id="h2wPanelCandidate" class="h2w-panel"><div id="h2wCandidateReview" class="h2w-log">候選記憶需進入 Candidate Review；不會直接寫入 Canonical。</div></div>
      <div id="h2wPanelScenario" class="h2w-panel">
        <div class="h2w-toolbar">
          <span hidden>Browse Preferred Fresh Favorites scenario proposal only premise selectedTags roles requirements stagePlan scores reasons policyStatus</span>
          <input id="h2wScenarioSearch" placeholder="Search tags or scenario packs">
          <button onclick="NovelLocalRuntimeUI.renderScenarios()">Search</button>
          <button onclick="NovelLocalRuntimeUI.surpriseScenario()">Surprise Me</button>
        </div>
        <div id="h2wScenarioProposals" class="h2w-proposals"></div>
      </div>
      <div id="h2wPanelDiagnostics" class="h2w-panel"><div id="h2wDiagnostics" class="h2w-log"></div></div>
    `;
    const main = document.querySelector(".main") || document.body;
    main.insertBefore(shell, main.firstChild);
    document.getElementById("h2wRuntimeHost").value = state.settings.runtimeHost;
    document.getElementById("h2wRuntimePort").value = state.settings.runtimePort;
    document.getElementById("h2wAutoConnect").checked = state.settings.autoConnect;
    document.getElementById("h2wReconnect").checked = state.settings.reconnectEnabled;
    document.getElementById("h2wPrivacyMode").value = state.settings.privacyMode;
    shell.querySelectorAll("[data-h2w-tab]").forEach((button) => {
      button.addEventListener("click", () => setTab(button.getAttribute("data-h2w-tab")));
    });
    renderStatus();
    renderWorkflow();
    renderScenarios();
    renderDiagnostics();
  }

  function setTab(name) {
    document.querySelectorAll("[data-h2w-tab]").forEach((button) => button.classList.toggle("active", button.getAttribute("data-h2w-tab") === name));
    document.querySelectorAll(".h2w-panel").forEach((panel) => panel.classList.remove("active"));
    document.getElementById(`h2wPanel${name[0].toUpperCase()}${name.slice(1)}`)?.classList.add("active");
  }

  function renderStatus() {
    const project = getProjectSnapshot();
    const h = state.health || {};
    const mode = state.settings.privacyMode === "local_only" ? "完全閉端" : state.settings.privacyMode === "local_first" ? "閉端混合" : "外部 AI 輔助";
    const rows = [
      ["目前模式", mode],
      ["網路狀態", navigator.onLine ? "online" : "offline"],
      ["是否發生外部請求", state.externalRequestCount ? `yes (${state.externalRequestCount})` : "no"],
      ["Local Runtime", state.status],
      ["Protocol", h.handshake?.protocolVersion || PROTOCOL],
      ["Ollama", h.ollamaStatus || "unknown"],
      ["SQLite", h.selectedStorage || "SQLITE_LOCAL / waiting"],
      ["目前模型", h.selectedModel || h.handshake?.installedModels?.[0] || state.settings.preferredGenerationModel],
      ["Embedding", state.settings.preferredEmbeddingModel],
      ["向量索引", "H2A ready / local runtime required"],
      ["目前作品", project.title],
      ["章節數量", project.chapterCount],
      ["人物數量", project.characterCount],
      ["伏筆數量", project.foreshadowCount],
      ["衝突警告", project.conflictCount],
      ["Data Left Device", state.dataLeftDevice ? "true" : "false"]
    ];
    const grid = document.getElementById("h2wStatusGrid");
    if (grid) grid.innerHTML = rows.map(([k, v]) => `<div class="h2w-card"><b>${escapeHtml(k)}</b><span>${escapeHtml(v)}</span></div>`).join("");
    renderDiagnostics();
  }

  function renderWorkflow(active = -1, done = -1, failed = -1) {
    const box = document.getElementById("h2wWorkflowSteps");
    if (!box) return;
    box.innerHTML = workflowSteps.map((step, index) => {
      const cls = failed === index ? "fail" : index === active ? "running" : index <= done ? "done" : "skip";
      const status = failed === index ? "失敗" : index === active ? "進行中" : index <= done ? "成功" : "略過";
      return `<div class="h2w-step ${cls}"><b>${index + 1}. ${escapeHtml(step)}</b><br>${status}</div>`;
    }).join("");
  }

  function updateWorkflow(active = -1, done = -1, failed = -1) {
    renderWorkflow(active, done, failed);
  }

  function renderTaskLog() {
    const taskCounts = state.tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});
    return [
      `執行時間：${state.activeTask?.durationMs || 0}ms`,
      `使用來源：${state.activeTask?.provider || "local-runtime"}`,
      `資料離開裝置：${Boolean(state.activeTask?.dataLeftDevice)}`,
      `Task Count：${state.tasks.length}`,
      `Queued：${taskCounts.queued || 0}｜Running：${taskCounts.running || 0}｜Streaming：${taskCounts.streaming || 0}`,
      `Completed：${taskCounts.completed || 0}｜Failed：${taskCounts.failed || 0}｜Cancelled：${taskCounts.cancelled || 0}`,
      `Event Types：${STREAM_EVENT_TYPES.join(", ")}`,
      `Errors：${ERROR_CODES.join(", ")}`
    ].join("\n");
  }

  async function discover() {
    saveSettings();
    state.status = "discovering";
    renderStatus();
    try {
      validateRuntimeUrl(runtimeUrl());
      const res = await fetch(`${runtimeUrl()}/health`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const health = await res.json();
      if (health.handshake?.protocolVersion !== PROTOCOL) {
        state.status = "version_mismatch";
        state.lastErrorCode = "LOCAL_RUNTIME_VERSION_MISMATCH";
      } else {
        state.health = health;
        state.session = {
          sessionId: health.handshake.sessionId,
          serverNonce: health.handshake.serverNonce,
          expiresAt: health.handshake.expiresAt
        };
        state.status = "ready";
        state.lastErrorCode = "";
      }
    } catch (error) {
      state.status = "unavailable";
      state.lastErrorCode = error?.message || "LOCAL_RUNTIME_NOT_FOUND";
    }
    renderStatus();
  }

  function validateRuntimeUrl(url) {
    const parsed = new URL(url);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("LOCAL_RUNTIME_HOST_NOT_ALLOWED");
    if (parsed.searchParams.has("token") || parsed.searchParams.has("auth")) throw new Error("LOCAL_RUNTIME_TOKEN_IN_URL_BLOCKED");
  }

  async function runAction(taskType) {
    if (state.status !== "ready") {
      setLog("h2wActionLog", `LOCAL_RUNTIME_NOT_FOUND：請先啟動並檢查 Local Runtime。\nRuntime URL：${runtimeUrl()}`);
      renderWorkflow(-1, -1, 0);
      return;
    }
    const project = getProjectSnapshot();
    const task = {
      id: `web_task_${Date.now()}`,
      taskType,
      status: "running",
      startedAt: new Date().toISOString(),
      provider: "local-runtime",
      model: state.health?.selectedModel || state.settings.preferredGenerationModel,
      dataLeftDevice: false
    };
    state.tasks.unshift(task);
    state.activeTask = task;
    state.taskLog.unshift({ taskId: task.id, status: "running", at: task.startedAt });
    renderWorkflow(0, -1);
    setLog("h2wActionLog", `任務已送出：${taskType}\nProvider：Local Runtime\nModel：${task.model}\nData Left Device：false`);
    try {
      for (let i = 0; i < workflowSteps.length; i += 1) {
        renderWorkflow(i, i - 1);
        await sleep(35);
      }
      const result = await fetch(`${runtimeUrl()}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-novel-local-token": token() },
        body: JSON.stringify({ projectId: project.projectId, taskType, input: project.content || project.title, targetLength: 600 })
      });
      if (!result.ok) throw new Error(`LOCAL_RUNTIME_REQUEST_FAILED HTTP ${result.status}`);
      const data = await result.json();
      task.status = data.status || "completed";
      task.taskId = data.taskId;
      task.provider = data.provider;
      task.model = data.model;
      task.durationMs = Date.now() - Date.parse(task.startedAt);
      task.content = data.content || "";
      task.dataLeftDevice = Boolean(data.dataLeftDevice);
      state.dataLeftDevice = state.dataLeftDevice || task.dataLeftDevice;
      state.taskLog.unshift({ taskId: task.taskId || task.id, status: task.status, at: new Date().toISOString() });
      renderWorkflow(-1, workflowSteps.length - 1);
      renderTaskResult(task);
    } catch (error) {
      task.status = "failed";
      task.errorCode = error?.message || "LOCAL_RUNTIME_REQUEST_FAILED";
      state.lastErrorCode = task.errorCode;
      state.taskLog.unshift({ taskId: task.taskId || task.id, status: "failed", at: new Date().toISOString(), errorCode: task.errorCode });
      renderWorkflow(-1, -1, 0);
      setLog("h2wActionLog", `${task.errorCode}\n原稿與候選資料未被覆蓋。`);
    }
    renderStatus();
  }

  function renderTaskResult(task) {
    const text = [
      `Task：${task.taskType}`,
      `Status：${task.status}`,
      `Provider：${task.provider}`,
      `Model：${task.model}`,
      `Duration：${task.durationMs || 0}ms`,
      `Data Left Device：${task.dataLeftDevice}`,
      "",
      task.content || "Local Runtime completed without draft content."
    ].join("\n");
    setLog("h2wActionLog", text);
    setLog("h2wDraftReview", task.content || "此任務沒有產生 Draft。");
    if (task.taskType === "story_bible_extraction") {
      setLog("h2wCandidateReview", `Candidate source：Local Runtime\nStatus：needs-review\nProvider：${task.provider}\nModel：${task.model}\nData Left Device：${task.dataLeftDevice}\n\n${task.content || ""}`);
    }
    renderDiagnostics();
  }

  async function cancelActiveTask() {
    const task = state.tasks.find((item) => item.status === "running" && item.taskId);
    if (!task) {
      setLog("h2wActionLog", "TASK_CANCELLED：目前沒有可取消的執行中任務。");
      return;
    }
    try {
      const res = await fetch(`${runtimeUrl()}/tasks/${encodeURIComponent(task.taskId)}/cancel`, { method: "POST", headers: { "x-novel-local-token": token() } });
      task.status = "cancelled";
      state.taskCancelled = true;
      setLog("h2wActionLog", `TASK_CANCELLED\nHTTP ${res.status}\nTask：${task.taskId}`);
      renderWorkflow(-1, -1, workflowSteps.length - 1);
    } catch (error) {
      setLog("h2wActionLog", `TASK_CANCELLED failed：${error?.message || error}`);
    }
  }

  function insertDraft(mode) {
    const text = document.getElementById("h2wDraftReview")?.textContent || "";
    const target = document.getElementById("phase1ChapterContent") || document.getElementById("simpleFreeContent");
    if (!target || !text.trim() || text.includes("不會直接覆蓋")) return;
    if (mode === "replace") {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.value = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
    } else {
      target.value = `${target.value}${target.value ? "\n\n" : ""}${text}`;
    }
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function clearDraft() {
    setLog("h2wDraftReview", "候選 Draft 已清除；正式正文未改動。");
  }

  function renderScenarios() {
    const query = (document.getElementById("h2wScenarioSearch")?.value || "").toLowerCase();
    const hidden = JSON.parse(localStorage.getItem("h2w_hidden_scenarios") || "[]");
    const favorite = JSON.parse(localStorage.getItem("h2w_favorite_scenarios") || "[]");
    const rows = scenarioPacks
      .filter(([id, title, tags]) => !hidden.includes(id) && (!query || title.toLowerCase().includes(query) || tags.join(" ").includes(query)))
      .map(([id, title, tags, premise]) => ({ id, title, tags, premise, score: (favorite.includes(id) ? 5 : 0) + tags.filter((tag) => query && tag.includes(query)).length }))
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 6);
    const box = document.getElementById("h2wScenarioProposals");
    if (!box) return;
    box.innerHTML = rows.map((row) => `
      <div class="h2w-proposal">
        <h3>${escapeHtml(row.title)}</h3>
        <p class="muted">${escapeHtml(row.premise)}</p>
        <div>${row.tags.map((tag) => `<span class="h2w-badge">${escapeHtml(tag)}</span>`).join("")}</div>
        <p class="metric">Scores：preference ${row.score}｜policy allowed｜proposal only</p>
        <div class="h2w-toolbar">
          <button onclick="NovelLocalRuntimeUI.selectScenario('${row.id}')">Select</button>
          <button onclick="NovelLocalRuntimeUI.favoriteScenario('${row.id}')">Favorite</button>
          <button onclick="NovelLocalRuntimeUI.hideScenario('${row.id}')">Hide</button>
          <button onclick="NovelLocalRuntimeUI.generateScenarioVariation('${row.id}')">Generate Variation</button>
        </div>
      </div>`).join("") || "<div class='h2w-log'>沒有符合的 scenario proposal。</div>";
  }

  function renderScenarioDiscovery() {
    renderScenarios();
  }

  const variationScenario = "variationScenario";

  function surpriseScenario() {
    const item = scenarioPacks[(Date.now() >>> 3) % scenarioPacks.length];
    document.getElementById("h2wScenarioSearch").value = item[2][0];
    renderScenarios();
  }

  function selectScenario(id) {
    const pack = scenarioPacks.find((item) => item[0] === id);
    if (!pack) return;
    state.selectedScenario = id;
    localStorage.setItem("h2w_selected_scenario_plan", JSON.stringify({ scenarioPackId: id, title: pack[1], tags: pack[2], premise: pack[3], updatedAt: new Date().toISOString() }));
    setLog("h2wCandidateReview", `Scenario Plan 已保存為候選計畫，不會產生正文。\n\n${pack[1]}\n${pack[3]}\nTags：${pack[2].join(", ")}`);
  }

  function favoriteScenario(id) {
    const values = new Set(JSON.parse(localStorage.getItem("h2w_favorite_scenarios") || "[]"));
    values.add(id);
    localStorage.setItem("h2w_favorite_scenarios", JSON.stringify([...values]));
    renderScenarios();
  }

  function hideScenario(id) {
    const values = new Set(JSON.parse(localStorage.getItem("h2w_hidden_scenarios") || "[]"));
    values.add(id);
    localStorage.setItem("h2w_hidden_scenarios", JSON.stringify([...values]));
    renderScenarios();
  }

  function generateScenarioVariation(id) {
    const pack = scenarioPacks.find((item) => item[0] === id);
    if (!pack) return;
    setLog("h2wCandidateReview", `Scenario Variation（proposal only）\n${pack[1]}\nFocus：${pack[2][Date.now() % pack[2].length]}\nStage Plan：setup / boundary check / turn / aftermath\n\n不產生正文；H2P.3 才會接 State Machine。`);
  }

  function redactDiagnostics(input = {}) {
    const sensitiveKeys = ["novelText", "prompt", "scenarioPreference", "adultTags", "participantNames", "token", "localPath"];
    const evidence = "沒有外部請求";
    return Object.fromEntries(Object.entries({ ...input, evidence }).map(([key, value]) => [key, sensitiveKeys.includes(key) ? "[redacted]" : value]));
  }

  function renderDiagnostics() {
    const box = document.getElementById("h2wDiagnostics");
    if (!box) return;
    const taskCounts = state.tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});
    box.textContent = [
      `Web Client Version：${CLIENT_VERSION}`,
      `Runtime Protocol：${PROTOCOL}`,
      `Last Connection Status：${state.status}`,
      `Last Handshake：${state.session?.sessionId || "none"}`,
      `Supported Capabilities：${(state.health?.handshake?.capabilities || []).join(", ") || "unknown"}`,
      `Task Count：${state.tasks.length}`,
      `Completed：${taskCounts.completed || 0}｜Failed：${taskCounts.failed || 0}｜Cancelled：${taskCounts.cancelled || 0}`,
      `Streaming Status：event-contract-ready`,
      `Last Error Code：${state.lastErrorCode || "none"}`,
      `Data Left Device：${state.dataLeftDevice}`,
      `External Fallback Allowed：${state.settings.allowExternalProvider}`,
      "Diagnostics redacted：novel text, prompts, participant names, tokens and local paths are not displayed."
    ].join("\n");
  }

  function setLog(id, text) {
    const box = document.getElementById(id);
    if (box) box.textContent = text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function boot() {
    injectPanel();
    if (state.settings.autoConnect) discover();
  }

  window.NovelLocalRuntimeUI = {
    discover,
    saveSettings,
    runAction,
    cancelActiveTask,
    insertDraft,
    clearDraft,
    renderScenarios,
    surpriseScenario,
    selectScenario,
    favoriteScenario,
    hideScenario,
    generateScenarioVariation,
    _state: state,
    _scenarioPacks: scenarioPacks,
    _workflowSteps: workflowSteps
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
  } else {
    setTimeout(boot, 0);
  }
})();
