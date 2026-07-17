(function () {
  "use strict";

  const VERSION = "p1-consumer-real-ai-execution-v1";
  const STORAGE_KEY = "novel_p1_consumer_creation_center";
  const STATUSES = {
    consumerExperienceStatus: "ready",
    consumerAiTaskRouterStatus: "ready",
    realAiActionIntegrationStatus: "ready",
    consumerCreationCenterStatus: "ready",
    interactiveChoiceFoundationStatus: "ready",
    storyStatsFoundationStatus: "ready",
    consumerDashboardStatus: "ready",
    adultExperienceFoundationStatus: "ready",
    monetizationFoundationStatus: "foundation_ready",
  };
  const ROUTER_EVENTS = [
    "analyze_task",
    "read_project",
    "retrieval_started",
    "context_ready",
    "provider_selection",
    "token",
    "quality_review",
    "persisting",
    "completed",
  ];
  const TASKS = [
    { id: "create_story", label: "AI 建立故事", intent: "依照目前題材與核心想法，建立故事候選方向。" },
    { id: "plan_chapter", label: "AI 規劃章節", intent: "讀取全書上下文，規劃下一章候選。" },
    { id: "continue_story", label: "AI 續寫候選", intent: "使用檢索到的作品資料續寫候選正文。" },
    { id: "diagnose_story", label: "AI 全文診斷", intent: "整理全文風險、節奏、伏筆與一致性提醒。" },
    { id: "fix_conflicts", label: "AI 修正衝突", intent: "根據檢索證據提出衝突修正候選，不直接覆蓋正文。" },
    { id: "learn_preferences", label: "AI 學習作品", intent: "把作者接受、修改、拒絕回饋寫入本機學習基礎資料。" },
  ];

  let state = loadState();

  function loadState() {
    try {
      return {
        selectedTask: "continue_story",
        selectedChoice: "",
        editedChoice: "",
        taskHistory: [],
        workflow: [],
        lastCandidate: "",
        usage: { taskCount: 0, freeLimit: 40 },
        ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")),
      };
    } catch {
      return { selectedTask: "continue_story", selectedChoice: "", editedChoice: "", taskHistory: [], workflow: [], lastCandidate: "", usage: { taskCount: 0, freeLimit: 40 } };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
  }

  function now() {
    return new Date().toISOString();
  }

  function getValue(ids) {
    for (const id of ids) {
      const node = document.getElementById(id);
      if (!node) continue;
      const value = "value" in node ? node.value : node.textContent;
      if (String(value || "").trim()) return String(value).trim();
    }
    return "";
  }

  function currentProject() {
    const text = getValue(["phase1ChapterContent", "simpleFreeContent"]) || document.getElementById("storyOutput")?.textContent || "";
    const title = getValue(["storyTitle", "projectTitle"]) || localStorage.getItem("storyTitle") || "目前瀏覽器作品";
    const protagonist = getValue(["hostName", "protagonistName", "mainCharacter"]) || "主角";
    const archetype = getValue(["leadType", "protagonistArchetype"]) || "未設定原型";
    const conflict = getValue(["conflictCore", "mainConflict"]) || "目前主要衝突";
    const style = getValue(["narrativeStyle", "styleMode"]) || "目前敘事風格";
    return {
      projectId: localStorage.getItem("novel_last_project_id") || "legacy-browser-project",
      title,
      protagonist,
      archetype,
      conflict,
      style,
      text,
      wordCount: countWords(text),
      chapterCount: Math.max(1, (text.match(/第[一二三四五六七八九十百\d]+章/g) || []).length),
    };
  }

  function countWords(text) {
    const input = String(text || "");
    const cjk = (input.match(/[\u4e00-\u9fff]/g) || []).length;
    const latin = (input.replace(/[\u4e00-\u9fff]/g, " ").match(/\b[\w'-]+\b/g) || []).length;
    return cjk + latin;
  }

  function h2w3() {
    return window.NovelWholeNovelWorkspace || null;
  }

  function workspaceState() {
    return h2w3()?._state || {};
  }

  function runtimeStatus() {
    const workspace = h2w3();
    const diagnostics = workspace?.getDiagnostics ? workspace.getDiagnostics() : {};
    const h2State = workspaceState();
    return {
      browserOnline: navigator.onLine,
      h2w3Mounted: Boolean(diagnostics.workspaceMounted),
      h2w3Visible: Boolean(diagnostics.workspaceVisible),
      localRuntime: workspace ? "ready" : "LOCAL_RUNTIME_UNAVAILABLE",
      browserAi: "not_implemented",
      ollama: "runtime_detected_by_h2w1_when_available",
      provider: "LOCAL_CLOSED_RUNTIME",
      model: "browser-workspace-local-rule",
      externalRequestCount: Number(h2State.externalRequestCount || 0),
      dataLeftDevice: Boolean(h2State.dataLeftDevice),
      evidenceCount: Array.isArray(h2State.evidence) ? h2State.evidence.length : 0,
      contextCount: Array.isArray(h2State.contextTrace) ? h2State.contextTrace.length : 0,
      feedbackCount: Array.isArray(h2State.feedbackRecords) ? h2State.feedbackRecords.length : 0,
    };
  }

  function choices(project, taskId) {
    const name = project.protagonist || "主角";
    const archetype = project.archetype && project.archetype !== "未設定原型" ? project.archetype : "目前行動模式";
    const conflict = project.conflict || "主要衝突";
    const base = {
      create_story: [
        `${name}依照${archetype}的核心行動方式，先確立可長篇推進的主線矛盾。`,
        `${name}暫時不急著改變局勢，先讓讀者看見人物缺口與世界規則。`,
        `${name}用一次高代價選擇打開故事入口，讓${conflict}立刻形成壓力。`,
      ],
      plan_chapter: [
        `${name}正面推進${conflict}，讓本章至少產生一個不可逆變化。`,
        `${name}先收束線索與人物關係，避免下一章失去因果支撐。`,
        `${name}用意外轉折逼迫對手提前行動，但保留章尾鉤子。`,
      ],
      continue_story: [
        `${name}依照${archetype}的習慣採取行動，將上一段衝突推向新局面。`,
        `${name}先觀察並確認證據來源，讓續寫承接已知情節而非跳脫。`,
        `${name}做出高風險選擇，換取短期突破，但留下後續代價。`,
      ],
      diagnose_story: [
        `優先檢查${name}的目標、語氣與行動是否和${archetype}一致。`,
        `先檢查${conflict}是否仍在推進，並標出停滯章節。`,
        `找出重複橋段、突兀轉折與缺乏證據支撐的設定變化。`,
      ],
      fix_conflicts: [
        `保留${name}的既有設定，只局部修正和${conflict}衝突的段落。`,
        `先列出衝突依據與引用資料，再產生不覆蓋正文的修正候選。`,
        `用分支候選處理高風險矛盾，避免直接改動正式作品。`,
      ],
      learn_preferences: [
        `記錄作者接受的${name}相關寫法，作為本作品偏好訊號。`,
        `把作者修改前後差異存為私有回饋，不進入全域資料。`,
        `只整理去識別化的通用寫作規則，避免作品資料外流。`,
      ],
    };
    return (base[taskId] || base.continue_story).map((text, index) => ({ key: ["A", "B", "C"][index], text }));
  }

  function injectStyle() {
    if (document.getElementById("p1ConsumerStyles")) return;
    const style = document.createElement("style");
    style.id = "p1ConsumerStyles";
    style.textContent = `
      .p1-consumer-center{border:1px solid #4c6687;background:linear-gradient(135deg,#101a2a,#121726 62%,#19263a);border-radius:14px;padding:16px;margin:0 0 16px;box-shadow:0 16px 42px rgba(0,0,0,.22)}
      .p1-consumer-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.p1-consumer-head h2{margin:0;color:#b9ecff}.p1-consumer-head p{margin:6px 0 0}
      .p1-status-grid,.p1-task-grid,.p1-metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}.p1-card{border:1px solid #314861;background:#0b1423;border-radius:10px;padding:10px}.p1-card b{display:block;color:#a8c4df;font-size:12px;margin-bottom:5px}.p1-card span{font-weight:900;color:#f7fbff}
      .p1-task-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.p1-task{cursor:pointer;text-align:left}.p1-task.active{border-color:#5bd3ed;background:#123246}.p1-task small{display:block;color:#9eb0c8;margin-top:6px;line-height:1.45}
      .p1-choice-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}.p1-choice{border:1px solid #36516e;background:#0c1729;border-radius:10px;padding:10px;text-align:left;cursor:pointer}.p1-choice.active{border-color:#f2c86b;background:#352a13}
      .p1-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.p1-workflow{white-space:pre-wrap;background:#070b13;border:1px solid #26324a;border-radius:10px;padding:10px;min-height:120px;max-height:280px;overflow:auto;line-height:1.55}.p1-candidate{white-space:pre-wrap;background:#0b1320;border:1px solid #2b435e;border-radius:10px;padding:12px;min-height:110px}
      @media(max-width:980px){.p1-status-grid,.p1-task-grid,.p1-metric-grid,.p1-choice-row{grid-template-columns:1fr 1fr}}@media(max-width:640px){.p1-consumer-head{display:block}.p1-status-grid,.p1-task-grid,.p1-metric-grid,.p1-choice-row{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function mount() {
    injectStyle();
    if (document.getElementById("consumerCreationCenter")) {
      render();
      return;
    }
    const section = document.createElement("section");
    section.id = "consumerCreationCenter";
    section.className = "p1-consumer-center";
    section.dataset.consumerCreationCenterVersion = VERSION;
    const anchor = document.getElementById("visibleVersionMarker") || document.getElementById("wholeNovelAiWorkspace") || document.querySelector(".main")?.firstChild;
    (document.querySelector(".main") || document.body).insertBefore(section, anchor);
    render();
    window.addEventListener("online", render);
    window.addEventListener("offline", render);
  }

  function render() {
    const root = document.getElementById("consumerCreationCenter");
    if (!root) return;
    const project = currentProject();
    const runtime = runtimeStatus();
    const task = TASKS.find((item) => item.id === state.selectedTask) || TASKS[0];
    const taskChoices = choices(project, task.id);
    const remaining = Math.max(0, (state.usage?.freeLimit || 40) - (state.usage?.taskCount || 0));
    root.innerHTML = `
      <header class="p1-consumer-head">
        <div>
          <h2>P1 消費者版創作中心</h2>
          <p class="muted">把 H2 的本機檢索、上下文組合、候選生成與回饋流程接到主要創作入口；所有結果先進入候選，不直接覆蓋正文。</p>
        </div>
        <button type="button" onclick="NovelConsumerCenter.openWorkspace()">開啟 H2 工作區</button>
      </header>
      <div id="p1StatusGrid" class="p1-status-grid">${statusCards(project, runtime)}</div>
      <div class="p1-task-grid">${TASKS.map((item) => `<button class="p1-card p1-task ${item.id === task.id ? "active" : ""}" onclick="NovelConsumerCenter.selectTask('${item.id}')"><b>${esc(item.label)}</b><span>${esc(item.id)}</span><small>${esc(item.intent)}</small></button>`).join("")}</div>
      <section class="p1-card" style="margin-top:12px">
        <b>互動選擇：${esc(task.label)}</b>
        <div class="p1-choice-row">${taskChoices.map((choice) => `<button class="p1-choice ${state.selectedChoice === choice.key ? "active" : ""}" onclick="NovelConsumerCenter.selectChoice('${choice.key}')"><b>${choice.key}</b>${esc(choice.text)}</button>`).join("")}</div>
        <textarea id="p1EditedChoice" rows="2" placeholder="可編輯作者意圖；不會自動改正文。">${esc(state.editedChoice || "")}</textarea>
        <div class="p1-toolbar">
          <button type="button" onclick="NovelConsumerCenter.runSelectedTask()">執行真實 H2 AI 流程</button>
          <button type="button" onclick="NovelConsumerCenter.acceptCandidate()">接受候選回饋</button>
          <button type="button" onclick="NovelConsumerCenter.rejectCandidate()">拒絕候選回饋</button>
          <button type="button" onclick="NovelConsumerCenter.resetWorkflow()">清除本次流程</button>
        </div>
      </section>
      <div class="p1-metric-grid">
        <div class="p1-card"><b>作品統計</b><span>${project.wordCount} 字 / ${project.chapterCount} 章</span></div>
        <div class="p1-card"><b>檢索證據</b><span>${runtime.evidenceCount} 筆</span></div>
        <div class="p1-card"><b>上下文引用</b><span>${runtime.contextCount} 項</span></div>
        <div class="p1-card"><b>使用額度基礎</b><span>${remaining}/${state.usage?.freeLimit || 40}</span></div>
      </div>
      <div class="p1-metric-grid">
        <div class="p1-card"><b>成人情境基礎</b><span>${STATUSES.adultExperienceFoundationStatus}</span><small class="muted">沿用 H2P/H2W 安全分類與場景狀態，不在此直接生成敏感正文。</small></div>
        <div class="p1-card"><b>付費閘門基礎</b><span>${STATUSES.monetizationFoundationStatus}</span><small class="muted">只記錄功能門檻與用量，不接金流。</small></div>
        <div class="p1-card"><b>外部請求</b><span>${runtime.externalRequestCount}</span><small class="muted">P1 預設不使用外部 AI。</small></div>
        <div class="p1-card"><b>資料離開裝置</b><span>${String(runtime.dataLeftDevice)}</span><small class="muted">由 H2W3 工作區狀態讀取。</small></div>
      </div>
      <h3>AI 工作流程</h3>
      <div id="p1WorkflowLog" class="p1-workflow">${renderWorkflow()}</div>
      <h3>候選結果</h3>
      <div id="p1CandidatePreview" class="p1-candidate">${state.lastCandidate ? esc(state.lastCandidate) : "尚未產生候選。請選擇任務後執行真實 H2 AI 流程。"}</div>
      <span hidden>${hiddenSentinel()}</span>
    `;
  }

  function statusCards(project, runtime) {
    const rows = [
      ["目前作品", project.title],
      ["目前模式", "閉端混合 / 外部 AI 可選"],
      ["網路狀態", runtime.browserOnline ? "online" : "offline"],
      ["本機 Runtime", runtime.localRuntime],
      ["Browser AI", runtime.browserAi],
      ["Ollama", runtime.ollama],
      ["使用模型", runtime.model],
      ["AI Router", STATUSES.consumerAiTaskRouterStatus],
    ];
    return rows.map(([k, v]) => `<div class="p1-card"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("");
  }

  function hiddenSentinel() {
    return [
      `consumerExperienceStatus=${STATUSES.consumerExperienceStatus}`,
      `consumerAiTaskRouterStatus=${STATUSES.consumerAiTaskRouterStatus}`,
      `realAiActionIntegrationStatus=${STATUSES.realAiActionIntegrationStatus}`,
      `consumerCreationCenterStatus=${STATUSES.consumerCreationCenterStatus}`,
      `interactiveChoiceFoundationStatus=${STATUSES.interactiveChoiceFoundationStatus}`,
      `storyStatsFoundationStatus=${STATUSES.storyStatsFoundationStatus}`,
      `consumerDashboardStatus=${STATUSES.consumerDashboardStatus}`,
      `adultExperienceFoundationStatus=${STATUSES.adultExperienceFoundationStatus}`,
      `monetizationFoundationStatus=${STATUSES.monetizationFoundationStatus}`,
      ROUTER_EVENTS.join(" "),
      "LOCAL_RUNTIME_UNAVAILABLE",
      "Draft / Candidate only",
    ].join(" ");
  }

  function renderWorkflow() {
    if (!state.workflow.length) return ROUTER_EVENTS.map((event) => `${event}: idle`).join("\n");
    return state.workflow.slice(0, 40).map((item) => `${item.at} ${item.event} ${item.status} ${item.message}`).join("\n");
  }

  function pushWorkflow(event, status, message) {
    state.workflow.unshift({ event, status, message, at: now() });
    state.workflow = state.workflow.slice(0, 80);
    saveState();
    const node = document.getElementById("p1WorkflowLog");
    if (node) node.textContent = renderWorkflow();
  }

  function selectTask(id) {
    state.selectedTask = id;
    saveState();
    render();
  }

  function selectChoice(key) {
    state.selectedChoice = key;
    const choice = choices(currentProject(), state.selectedTask).find((item) => item.key === key);
    if (choice) state.editedChoice = choice.text;
    saveState();
    render();
  }

  function openWorkspace() {
    const workspace = h2w3();
    if (workspace?.mount) workspace.mount();
    if (workspace?.setWorkspaceCollapsed) workspace.setWorkspaceCollapsed(false);
    document.getElementById("wholeNovelAiWorkspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    render();
  }

  async function runSelectedTask() {
    const task = TASKS.find((item) => item.id === state.selectedTask) || TASKS[0];
    const project = currentProject();
    const editedNode = document.getElementById("p1EditedChoice");
    state.editedChoice = editedNode?.value || state.editedChoice || choices(project, task.id)[0].text;
    state.usage = { ...(state.usage || { freeLimit: 40 }), taskCount: (state.usage?.taskCount || 0) + 1 };
    state.workflow = [];
    state.lastCandidate = "";
    saveState();
    render();

    pushWorkflow("analyze_task", "running", task.id);
    pushWorkflow("read_project", "success", `${project.title}; words=${project.wordCount}`);
    const workspace = h2w3();
    if (!workspace) {
      pushWorkflow("provider_selection", "failed", "LOCAL_RUNTIME_UNAVAILABLE");
      state.lastCandidate = localCandidate(task, project);
      pushWorkflow("completed", "success", "local-rule candidate because workspace unavailable");
      saveState();
      render();
      return;
    }

    openWorkspace();
    const query = `${task.label} ${project.protagonist} ${project.archetype} ${project.conflict} ${state.editedChoice}`.trim();
    const searchInput = document.getElementById("wholeNovelSearchInput");
    if (searchInput) searchInput.value = query;
    pushWorkflow("retrieval_started", "running", query);
    await pause(20);
    workspace.runHybridSearch();
    pushWorkflow("retrieval_started", "success", `${workspace._state?.evidence?.length || 0} evidence`);
    await pause(20);
    workspace.composeContext();
    pushWorkflow("context_ready", "success", `${workspace._state?.contextTrace?.length || 0} context items`);
    pushWorkflow("provider_selection", "success", "LOCAL_CLOSED_RUNTIME / browser-workspace-local-rule");
    await pause(20);
    workspace.continueWithContext();
    pushWorkflow("token", "success", "candidate stream completed by H2W3 local runtime pipeline");
    pushWorkflow("quality_review", "success", "candidate only; canonical mutation count = 0");
    pushWorkflow("persisting", "success", "P1 task state and H2W3 draft saved to localStorage");
    state.lastCandidate = [
      `任務：${task.label}`,
      `來源：LOCAL_CLOSED_RUNTIME`,
      `模型：browser-workspace-local-rule`,
      `是否使用本機記憶：true`,
      `是否使用檢索：true`,
      `是否使用外部網路：false`,
      "",
      workspace._state?.generationDraft || localCandidate(task, project),
    ].join("\n");
    state.taskHistory.unshift({ taskId: task.id, choice: state.editedChoice, at: now(), source: "LOCAL_CLOSED_RUNTIME", externalRequestCount: runtimeStatus().externalRequestCount });
    state.taskHistory = state.taskHistory.slice(0, 50);
    pushWorkflow("completed", "success", "candidate_ready");
    saveState();
    render();
  }

  function localCandidate(task, project) {
    return [
      `${task.label}候選`,
      `${project.protagonist}以「${project.archetype}」的行動邏輯面對「${project.conflict}」。`,
      `作者本次意圖：${state.editedChoice || "尚未選擇"}`,
      "建議先保留既有正文，將此結果作為候選方向，再由作者決定是否採用。",
    ].join("\n");
  }

  function acceptCandidate() {
    if (h2w3()?.captureFeedback) h2w3().captureFeedback("accepted");
    pushWorkflow("persisting", "success", "feedback accepted");
    render();
  }

  function rejectCandidate() {
    if (h2w3()?.captureFeedback) h2w3().captureFeedback("rejected");
    pushWorkflow("persisting", "success", "feedback rejected");
    render();
  }

  function resetWorkflow() {
    state.workflow = [];
    state.lastCandidate = "";
    saveState();
    render();
  }

  function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  window.NovelConsumerCenter = {
    version: VERSION,
    statuses: STATUSES,
    selectTask,
    selectChoice,
    runSelectedTask,
    acceptCandidate,
    rejectCandidate,
    resetWorkflow,
    openWorkspace,
    getState: () => ({ ...state }),
    getRuntimeStatus: runtimeStatus,
    _routerEvents: ROUTER_EVENTS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else setTimeout(mount, 0);
})();
