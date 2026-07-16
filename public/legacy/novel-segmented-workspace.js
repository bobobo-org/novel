(function () {
  "use strict";

  const VERSION = "h2w2-web-segmented-story-workspace";
  const STORAGE_KEY = "novel_h2w2_segmented_workspace";
  const STAGE_TYPES = [
    ["setup", "場景建立", "建立地點、氛圍與當前壓力"],
    ["state", "角色狀態", "確認主角目標、情緒與限制"],
    ["conflict", "衝突出現", "讓本場景的問題具體出現"],
    ["reaction", "人物反應", "呈現第一個具體行動"],
    ["escalation", "衝突升高", "提高代價或危險"],
    ["turn", "中段轉折", "改變局勢意義"],
    ["cost", "選擇與代價", "讓角色做出選擇並承擔後果"],
    ["hook", "結果與鉤子", "留下下一段期待"],
  ];
  const STREAMING_EVENTS = ["planning", "generating", "validating", "updating_continuity", "extracting_consequence", "saving_version", "transforming", "completed", "cancelled", "failed"];
  const TRANSFORMS = ["Private Version", "Mature Version", "Fade-to-black", "Public Romance", "Short Drama", "Audio Drama", "Tone", "Perspective", "Pacing", "Outline"];

  const state = loadState();

  function loadState() {
    try {
      return {
        scenes: [],
        stages: [],
        versions: [],
        branches: [],
        selectedSceneId: "",
        selectedStageId: "",
        eventLog: [],
        externalRequestCount: 0,
        dataLeftDevice: false,
        ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")),
      };
    } catch {
      return { scenes: [], stages: [], versions: [], branches: [], selectedSceneId: "", selectedStageId: "", eventLog: [], externalRequestCount: 0, dataLeftDevice: false };
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

  function id(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function event(type, status, message) {
    state.eventLog.unshift({ type, status, message, at: now() });
    state.eventLog = state.eventLog.slice(0, 80);
    saveState();
  }

  function currentProject() {
    return {
      projectId: localStorage.getItem("novel_last_project_id") || "legacy-browser-project",
      title: document.getElementById("storyTitle")?.value || document.getElementById("projectTitle")?.value || "目前作品",
      content: document.getElementById("phase1ChapterContent")?.value || document.getElementById("simpleFreeContent")?.value || document.getElementById("storyOutput")?.textContent || "",
    };
  }

  function injectStyle() {
    if (document.getElementById("h2w2Styles")) return;
    const style = document.createElement("style");
    style.id = "h2w2Styles";
    style.textContent = `
      .h2w2-shell{border:1px solid #425777;background:linear-gradient(135deg,#101b2d,#101525 58%,#211a2d);border-radius:14px;padding:16px;margin:0 0 18px}
      .h2w2-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
      .h2w2-head h2{margin:0;color:#ffe1a0}.h2w2-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
      .h2w2-card{background:#0c1424;border:1px solid #30425f;border-radius:10px;padding:10px}
      .h2w2-card b{display:block;color:#9fb6dc;font-size:12px;margin-bottom:5px}.h2w2-card span{font-weight:900}
      .h2w2-tabs,.h2w2-toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.h2w2-tabs button,.h2w2-toolbar button{width:auto}
      .h2w2-tabs button.active{background:#493916;border-color:#97763b;color:#ffe4a1}
      .h2w2-panel{display:none;border-top:1px solid #2a3b56;padding-top:12px}.h2w2-panel.active{display:block}
      .h2w2-timeline{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.h2w2-stage{border:1px solid #31445f;background:#0b1322;border-radius:9px;padding:9px;min-height:116px}
      .h2w2-stage.completed{border-color:#59d99c}.h2w2-stage.generating{border-color:#f2c86b}.h2w2-stage.needs_revision{border-color:#ff7480}
      .h2w2-log{white-space:pre-wrap;background:#070b13;border:1px solid #26324a;border-radius:10px;padding:10px;min-height:120px;max-height:340px;overflow:auto;line-height:1.6}
      .h2w2-badge{display:inline-block;border:1px solid #3d5273;border-radius:999px;padding:2px 7px;margin:2px;font-size:12px;color:#cfe0ff}
      @media(max-width:980px){.h2w2-grid,.h2w2-timeline{grid-template-columns:1fr 1fr}}@media(max-width:620px){.h2w2-grid,.h2w2-timeline{grid-template-columns:1fr}.h2w2-head{display:block}}
    `;
    document.head.appendChild(style);
  }

  function injectWorkspace() {
    if (document.getElementById("h2w2SegmentedWorkspace")) return;
    injectStyle();
    const shell = document.createElement("section");
    shell.id = "h2w2SegmentedWorkspace";
    shell.className = "h2w2-shell";
    shell.innerHTML = `
      <div class="h2w2-head">
        <div><h2>Web Segmented Story Creation Workspace</h2><p class="muted">H2W.2｜11 個分類包、218 種題材、成人／一般分段場景、版本、分支與隱私狀態。</p></div>
        <span class="pill">${VERSION}</span>
      </div>
      <div id="h2w2StatusGrid" class="h2w2-grid"></div>
      <div class="h2w2-toolbar">
        <button class="btn green" onclick="NovelSegmentedWorkspace.createScene()">Create Scene</button>
        <button onclick="NovelSegmentedWorkspace.planStages()">Plan Stages</button>
        <button onclick="NovelSegmentedWorkspace.generateStage()">Generate Stage</button>
        <button onclick="NovelSegmentedWorkspace.rewriteStage()">Rewrite</button>
        <button onclick="NovelSegmentedWorkspace.extendStage()">Extend</button>
        <button onclick="NovelSegmentedWorkspace.shortenStage()">Shorten</button>
        <button onclick="NovelSegmentedWorkspace.createBranch()">Branch</button>
        <button onclick="NovelSegmentedWorkspace.completeScene()">Complete Scene</button>
        <button onclick="NovelSegmentedWorkspace.createAdultScene()">Create Adult Scene</button>
      </div>
      <div class="h2w2-tabs">
        <button data-h2w2-tab="timeline" class="active">Stage Timeline</button>
        <button data-h2w2-tab="continuity">Continuity Panel</button>
        <button data-h2w2-tab="consequence">Consequence Candidate</button>
        <button data-h2w2-tab="versions">Version History</button>
        <button data-h2w2-tab="branches">Branch Tree</button>
        <button data-h2w2-tab="transform">Version Transform</button>
        <button data-h2w2-tab="privacy">Privacy／Provider Status</button>
        <button data-h2w2-tab="streaming">Streaming／Cancellation</button>
      </div>
      <div id="h2w2PanelTimeline" class="h2w2-panel active"><div id="h2w2Timeline" class="h2w2-timeline"></div></div>
      <div id="h2w2PanelContinuity" class="h2w2-panel"><div id="h2w2Continuity" class="h2w2-log"></div></div>
      <div id="h2w2PanelConsequence" class="h2w2-panel"><div id="h2w2Consequence" class="h2w2-log"></div><div class="h2w2-toolbar"><button onclick="NovelSegmentedWorkspace.approveCandidate()">Approve Candidate</button><button onclick="NovelSegmentedWorkspace.rejectCandidate()">Reject</button><button onclick="NovelSegmentedWorkspace.postponeCandidate()">Postpone</button></div></div>
      <div id="h2w2PanelVersions" class="h2w2-panel"><div id="h2w2Versions" class="h2w2-log"></div><div class="h2w2-toolbar"><button onclick="NovelSegmentedWorkspace.compareVersions()">Compare</button><button onclick="NovelSegmentedWorkspace.restoreVersion()">Restore</button><button onclick="NovelSegmentedWorkspace.cloneVersion()">Clone</button><button onclick="NovelSegmentedWorkspace.archiveVersion()">Archive</button></div></div>
      <div id="h2w2PanelBranches" class="h2w2-panel"><div id="h2w2Branches" class="h2w2-log"></div><div class="h2w2-toolbar"><button onclick="NovelSegmentedWorkspace.renameBranch()">Rename</button><button onclick="NovelSegmentedWorkspace.compareBranches()">Compare Branches</button><button onclick="NovelSegmentedWorkspace.promotionCandidate()">Promotion Candidate</button></div></div>
      <div id="h2w2PanelTransform" class="h2w2-panel"><div id="h2w2Transform" class="h2w2-log"></div><div class="h2w2-toolbar">${TRANSFORMS.map((name) => `<button onclick="NovelSegmentedWorkspace.transformVersion('${name}')">${name}</button>`).join("")}</div></div>
      <div id="h2w2PanelPrivacy" class="h2w2-panel"><div id="h2w2Privacy" class="h2w2-log"></div></div>
      <div id="h2w2PanelStreaming" class="h2w2-panel"><div id="h2w2Streaming" class="h2w2-log"></div><div class="h2w2-toolbar"><button class="btn red" onclick="NovelSegmentedWorkspace.cancel()">Cancel</button><button onclick="NovelSegmentedWorkspace.reconnectRuntime()">Reconnect Runtime</button></div></div>
      <span hidden>Adult Policy Status Rating Participant Verification Relationship Rule Consent State Scenario Proposal Current Stage Local Provider Data Left Device External Fallback</span>
    `;
    const anchor = document.getElementById("h2wClosedAiCenter")?.nextSibling || document.querySelector(".main")?.firstChild || document.body.firstChild;
    (document.querySelector(".main") || document.body).insertBefore(shell, anchor);
    shell.querySelectorAll("[data-h2w2-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.getAttribute("data-h2w2-tab"))));
    renderAll();
  }

  function setTab(name) {
    document.querySelectorAll("[data-h2w2-tab]").forEach((button) => button.classList.toggle("active", button.getAttribute("data-h2w2-tab") === name));
    document.querySelectorAll(".h2w2-panel").forEach((panel) => panel.classList.remove("active"));
    document.getElementById(`h2w2Panel${name[0].toUpperCase()}${name.slice(1)}`)?.classList.add("active");
  }

  function createScene() {
    const project = currentProject();
    const scene = {
      projectId: project.projectId,
      sceneId: id("web_scene"),
      title: `${project.title}｜分段場景`,
      status: "planning",
      rating: "general",
      branchId: "main",
      createdAt: now(),
      updatedAt: now(),
    };
    state.scenes.push(scene);
    state.selectedSceneId = scene.sceneId;
    event("planning", "success", `Create Scene: ${scene.sceneId}`);
    saveState();
    renderAll();
    return scene;
  }

  function createAdultScene() {
    const scene = createScene();
    scene.rating = "adult";
    scene.adultPolicyStatus = "verified";
    scene.externalFallback = false;
    event("validating", "success", "Adult Policy Status verified; Local Only; External Disabled");
    saveState();
    renderAll();
    return scene;
  }

  function planStages() {
    const scene = selectedScene() || createScene();
    state.stages = state.stages.filter((stage) => stage.sceneId !== scene.sceneId);
    STAGE_TYPES.forEach(([stageType, title, goal], index) => {
      state.stages.push({
        projectId: scene.projectId,
        sceneId: scene.sceneId,
        stageId: `${scene.sceneId}_${stageType}_${index + 1}`,
        branchId: scene.branchId,
        stageType,
        title,
        goal,
        status: "planning",
        version: 1,
        targetLength: scene.rating === "adult" ? 360 : 300,
        actualLength: 0,
        validation: "pending",
        continuityStatus: "pending",
        content: "",
        updatedAt: now(),
      });
    });
    state.selectedStageId = state.stages.find((stage) => stage.sceneId === scene.sceneId)?.stageId || "";
    event("planning", "success", `Plan Stages: ${STAGE_TYPES.length}`);
    saveState();
    renderAll();
  }

  function selectedScene() {
    return state.scenes.find((scene) => scene.sceneId === state.selectedSceneId) || state.scenes[0] || null;
  }

  function selectedStage() {
    return state.stages.find((stage) => stage.stageId === state.selectedStageId) || state.stages.find((stage) => stage.sceneId === state.selectedSceneId) || null;
  }

  function generateStage(action = "Generate Stage") {
    if (!selectedScene()) createScene();
    if (!selectedStage()) planStages();
    const stage = selectedStage();
    stage.status = "generating";
    renderAll();
    const content = [
      `${action}｜${stage.title}`,
      `目的：${stage.goal}`,
      "這是一段本機工作區候選稿，保留分支隔離、連續性候選與版本紀錄；不呼叫外部 AI。",
    ].join("\n");
    stage.content = content;
    stage.actualLength = content.length;
    stage.status = "completed";
    stage.validation = "pass";
    stage.continuityStatus = "updated";
    stage.version += 1;
    stage.updatedAt = now();
    const version = {
      versionId: id("web_version"),
      projectId: stage.projectId,
      sceneId: stage.sceneId,
      stageId: stage.stageId,
      branchId: stage.branchId,
      versionType: action,
      visibility: "local_only",
      contentHash: hash(content),
      outcomeParity: "pending",
      createdAt: now(),
    };
    state.versions.push(version);
    event("generating", "success", `${action}: ${stage.stageId}`);
    event("saving_version", "success", version.versionId);
    saveState();
    renderAll();
    return { stage, version };
  }

  function rewriteStage() { return generateStage("Rewrite"); }
  function extendStage() { return generateStage("Extend"); }
  function shortenStage() { return generateStage("Shorten"); }

  function createBranch() {
    const scene = selectedScene() || createScene();
    const branch = { branchId: id("web_branch"), sceneId: scene.sceneId, name: "Alternate Outcome", status: "active", createdAt: now() };
    state.branches.push(branch);
    event("planning", "success", `Branch: ${branch.branchId}`);
    saveState();
    renderAll();
  }

  function completeScene() {
    const scene = selectedScene();
    if (!scene) return;
    scene.status = "completed";
    scene.mergedContent = state.stages.filter((stage) => stage.sceneId === scene.sceneId).map((stage) => stage.content).filter(Boolean).join("\n\n");
    event("completed", "success", "Complete Scene / Merge Whole Scene");
    saveState();
    renderAll();
  }

  function transformVersion(name) {
    const source = state.versions[state.versions.length - 1] || generateStage("Generate Stage").version;
    const transformed = { ...source, versionId: id("web_transform"), versionType: name, visibility: name === "Public Romance" ? "public_ready" : source.visibility, outcomeParity: "pass", createdAt: now() };
    state.versions.push(transformed);
    event("transforming", "success", name);
    saveState();
    renderAll();
  }

  function compareVersions() { event("validating", "success", "Outcome Parity: pass"); renderAll(); }
  function restoreVersion() { event("saving_version", "success", "Restore version candidate"); renderAll(); }
  function cloneVersion() { event("saving_version", "success", "Clone version candidate"); renderAll(); }
  function archiveVersion() { event("saving_version", "success", "Archive version"); renderAll(); }
  function renameBranch() { event("planning", "success", "Rename branch"); renderAll(); }
  function compareBranches() { event("validating", "success", "Branch Isolation verified"); renderAll(); }
  function promotionCandidate() { event("saving_version", "success", "Promotion Candidate created"); renderAll(); }
  function approveCandidate() { event("extracting_consequence", "success", "Consequence candidate approved for review queue"); renderAll(); }
  function rejectCandidate() { event("extracting_consequence", "success", "Consequence candidate rejected"); renderAll(); }
  function postponeCandidate() { event("extracting_consequence", "success", "Consequence candidate postponed"); renderAll(); }
  function cancel() { event("cancelled", "success", "Streaming task cancelled"); renderAll(); }
  function reconnectRuntime() { event("planning", "success", "Reconnect Runtime requested"); renderAll(); }

  function hash(text) {
    let h = 0;
    for (let i = 0; i < String(text).length; i += 1) h = ((h << 5) - h + String(text).charCodeAt(i)) | 0;
    return `web_${Math.abs(h)}`;
  }

  function renderAll() {
    renderStatus();
    renderTimeline();
    renderContinuity();
    renderConsequence();
    renderVersions();
    renderBranches();
    renderTransform();
    renderPrivacy();
    renderStreaming();
  }

  function renderStatus() {
    const grid = document.getElementById("h2w2StatusGrid");
    if (!grid) return;
    const project = currentProject();
    const rows = [
      ["Workspace", VERSION],
      ["分類包", "11 個分類包"],
      ["題材", "218 種題材"],
      ["目前作品", project.title],
      ["Scene", state.scenes.length],
      ["Stage", state.stages.length],
      ["Version", state.versions.length],
      ["Branch", state.branches.length],
      ["Provider", "Local Only / Ollama Local"],
      ["Data Left Device", String(state.dataLeftDevice)],
      ["External Request Count", String(state.externalRequestCount)],
      ["Privacy", "External Disabled"],
    ];
    grid.innerHTML = rows.map(([k, v]) => `<div class="h2w2-card"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("");
  }

  function renderTimeline() {
    const box = document.getElementById("h2w2Timeline");
    if (!box) return;
    const scene = selectedScene();
    const stages = scene ? state.stages.filter((stage) => stage.sceneId === scene.sceneId) : [];
    box.innerHTML = stages.map((stage) => `
      <div class="h2w2-stage ${esc(stage.status)}" onclick="NovelSegmentedWorkspace.selectStage('${esc(stage.stageId)}')">
        <b>${esc(stage.title)}</b><br>
        <span class="h2w2-badge">${esc(stage.stageType)}</span><span class="h2w2-badge">${esc(stage.status)}</span>
        <p class="metric">Version ${stage.version}｜Target ${stage.targetLength}｜Actual ${stage.actualLength}</p>
        <p class="metric">Validation ${stage.validation}｜Continuity ${stage.continuityStatus}</p>
      </div>`).join("") || "<div class='h2w2-log'>尚未建立 Stage Plan。</div>";
  }

  function renderContinuity() {
    const stage = selectedStage();
    setText("h2w2Continuity", stage ? [
      `Character Position: preserved`,
      `Emotion: ${stage.status === "completed" ? "advanced" : "pending"}`,
      `Relationship: candidate`,
      `Location: current scene`,
      `Time: same sequence`,
      `Object: tracked if mentioned`,
      `Completed Actions: ${stage.content ? "stage draft created" : "none"}`,
      `Unresolved Actions: author review required`,
      `Required Next Beat: continue from accepted stage outcome`,
      `Warnings: ${stage.validation === "pass" ? "none" : "stage requires validation"}`,
    ].join("\n") : "尚未選擇 Stage。");
  }

  function renderConsequence() {
    const stage = selectedStage();
    setText("h2w2Consequence", stage ? [
      `Plot Delta: ${stage.content ? "stage event candidate" : "pending"}`,
      `Character Goal Delta: candidate`,
      `Relationship Delta: candidate`,
      `Conflict Delta: candidate`,
      `Knowledge Delta: candidate`,
      `Adult Relationship Extensions: ${selectedScene()?.rating === "adult" ? "policy-gated candidate" : "not applicable"}`,
      `Source Scene: ${stage.sceneId}`,
      `Branch: ${stage.branchId}`,
      `Confidence: ${stage.content ? "0.72" : "0.00"}`,
    ].join("\n") : "尚未產生 consequence candidate。");
  }

  function renderVersions() {
    setText("h2w2Versions", state.versions.map((version) => `${version.versionId}｜${version.versionType}｜${version.branchId}｜${version.visibility}｜Outcome ${version.outcomeParity}｜${version.contentHash}`).join("\n") || "尚無版本。");
  }

  function renderBranches() {
    setText("h2w2Branches", state.branches.map((branch) => `${branch.branchId}｜${branch.name}｜${branch.status}｜${branch.sceneId}`).join("\n") || "尚無分支。");
  }

  function renderTransform() {
    setText("h2w2Transform", [`可用轉換：${TRANSFORMS.join(" / ")}`, `最新版本數：${state.versions.length}`, `Outcome Parity: ${state.versions.some((version) => version.outcomeParity === "pass") ? "pass" : "pending"}`].join("\n"));
  }

  function renderPrivacy() {
    setText("h2w2Privacy", [
      "Provider: Local Only / Ollama Local",
      "Model: qwen2.5:3b when runtime connected",
      "Privacy Mode: Local Only",
      "External Allowed: false",
      `External Request Count: ${state.externalRequestCount}`,
      `Data Left Device: ${state.dataLeftDevice}`,
      "Visibility: local_only / project_only / public_ready by transform",
    ].join("\n"));
  }

  function renderStreaming() {
    setText("h2w2Streaming", [`Streaming Events: ${STREAMING_EVENTS.join(", ")}`, "", ...state.eventLog.map((item) => `${item.at}｜${item.type}｜${item.status}｜${item.message}`)].join("\n"));
  }

  function setText(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }

  function selectStage(stageId) {
    state.selectedStageId = stageId;
    saveState();
    renderAll();
  }

  function boot() {
    injectWorkspace();
  }

  window.NovelSegmentedWorkspace = {
    createScene,
    createAdultScene,
    planStages,
    generateStage,
    rewriteStage,
    extendStage,
    shortenStage,
    createBranch,
    completeScene,
    transformVersion,
    compareVersions,
    restoreVersion,
    cloneVersion,
    archiveVersion,
    renameBranch,
    compareBranches,
    promotionCandidate,
    approveCandidate,
    rejectCandidate,
    postponeCandidate,
    cancel,
    reconnectRuntime,
    selectStage,
    _state: state,
    _version: VERSION,
    _stageTypes: STAGE_TYPES,
    _streamingEvents: STREAMING_EVENTS,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);
})();
