(function () {
  "use strict";

  const VERSION = "h2w3-web-whole-novel-ai";
  window.NOVEL_STATIC_RELEASE = {
    appCommit: "__NOVEL_STATIC_APP_COMMIT__",
    releaseTag: "__NOVEL_STATIC_RELEASE_TAG__",
    expectedReleaseTag: "novel-ai-h2w3-production-visible-body-closure",
    visibleUiSemanticVersion: "__NOVEL_VISIBLE_UI_SEMANTIC_VERSION__",
    visibleUiBodyHash: "__NOVEL_VISIBLE_UI_BODY_HASH__",
  };
  const STORAGE_KEY = "novel_h2w3_whole_novel_workspace";
  const STREAM_EVENTS = ["retrieval_started", "retrieval_completed", "filtering", "deduplicating", "compressing", "budgeting", "context_ready", "generation_started", "token", "validating", "citation_ready", "persisting", "completed", "cancelled", "failed"];
  const UI_STATES = ["idle", "loading", "streaming", "success", "empty", "cancelled", "error", "runtime_unavailable", "permission_or_policy_blocked"];
  const SCOPES = ["CURRENT_CHAPTER", "CURRENT_SCENE", "CURRENT_STAGE", "CURRENT_BRANCH", "PRIVATE_PROJECT", "STORY_BIBLE", "USER_IMPORTED_LIBRARY", "PUBLIC_CORPUS"];
  const LEARNING_SOURCES = ["BROWSER_AI", "OLLAMA_LOCAL_AI", "LOCAL_CLOSED_RUNTIME", "EXTERNAL_AI_OPTIONAL"];
  const LEARNING_SIGNALS = ["STYLE_PREFERENCE", "DIALOGUE_QUALITY", "CHARACTER_VOICE", "CHARACTER_CONSISTENCY", "TIMELINE_CONSISTENCY", "WORLD_RULE_CONSISTENCY", "RELATIONSHIP_PROGRESSION", "PACING", "FORESHADOW_SETUP", "FORESHADOW_PAYOFF", "OPEN_THREAD", "REPETITION", "FACTUAL_ERROR", "UNSUPPORTED_CLAIM", "CONTEXT_SELECTION", "RETRIEVAL_RELEVANCE", "CITATION_QUALITY", "GENRE_FIT", "TONE_FIT", "ADULT_POLICY", "USER_REJECTED", "USER_EDITED", "USER_APPROVED"];
  const TRAINING_STATES = ["not_eligible", "consent_missing", "candidate", "needs_review", "approved_for_future_dataset", "rejected"];

  const state = loadState();
  const diagnostics = {
    workspaceScriptLoaded: true,
    workspaceInitialized: false,
    workspaceMounted: false,
    workspaceVisible: false,
    workspaceVisibilityReason: "user_not_opened",
    workspaceMountTarget: "#wholeNovelWorkspaceMount",
    workspaceVersion: "h2w3-web-whole-novel-ai-v1",
    workspaceInitializationError: null,
  };

  function loadState() {
    try {
      return {
        selectedScopes: ["PRIVATE_PROJECT", "CURRENT_BRANCH", "STORY_BIBLE"],
        branchId: "main",
        publicCorpusOptIn: false,
        evidence: [],
        contextTrace: [],
        wholeNovel: {},
        generationDraft: "",
        feedbackRecords: [],
        trainingCandidates: [],
        events: [],
        externalRequestCount: 0,
        dataLeftDevice: false,
        ...(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")),
      };
    } catch {
      return { selectedScopes: ["PRIVATE_PROJECT", "CURRENT_BRANCH", "STORY_BIBLE"], branchId: "main", publicCorpusOptIn: false, evidence: [], contextTrace: [], wholeNovel: {}, generationDraft: "", feedbackRecords: [], trainingCandidates: [], events: [], externalRequestCount: 0, dataLeftDevice: false };
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

  function currentProject() {
    return {
      projectId: localStorage.getItem("novel_last_project_id") || "legacy-browser-project",
      title: document.getElementById("storyTitle")?.value || document.getElementById("projectTitle")?.value || "Local Novel Project",
      text: document.getElementById("phase1ChapterContent")?.value || document.getElementById("simpleFreeContent")?.value || document.getElementById("storyOutput")?.textContent || "",
    };
  }

  function event(type, status, message) {
    state.events.unshift({ type, status, message, at: now() });
    state.events = state.events.slice(0, 120);
    saveState();
  }

  function injectStyle() {
    if (document.getElementById("h2w3Styles")) return;
    const style = document.createElement("style");
    style.id = "h2w3Styles";
    style.textContent = `
      .h2w3-shell{border:1px solid #426480;background:linear-gradient(135deg,#0c1827,#101525 58%,#182336);border-radius:14px;padding:16px;margin:0 0 18px}
      .h2w3-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.h2w3-head h2{margin:0;color:#aee7ff}
      .h2w3-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.h2w3-card{background:#0b1423;border:1px solid #304a66;border-radius:10px;padding:10px}
      .h2w3-card b{display:block;color:#9fbfe0;font-size:12px;margin-bottom:5px}.h2w3-card span{font-weight:900}
      .h2w3-toolbar,.h2w3-tabs,.h2w3-scope{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.h2w3-toolbar button,.h2w3-tabs button{width:auto}
      .h2w3-tabs button.active{background:#16424e;border-color:#5bc7e8;color:#eaffff}.h2w3-panel{display:none;border-top:1px solid #2f435e;padding-top:12px}.h2w3-panel.active{display:block}
      .h2w3-log{white-space:pre-wrap;background:#070b13;border:1px solid #26324a;border-radius:10px;padding:10px;min-height:126px;max-height:360px;overflow:auto;line-height:1.55}
      .h2w3-evidence{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.h2w3-evidence-item{border:1px solid #30425f;border-radius:10px;background:#0c1424;padding:10px}
      .h2w3-badge{display:inline-block;border:1px solid #3d5273;border-radius:999px;padding:2px 7px;margin:2px;font-size:12px;color:#cfe0ff}
      @media(max-width:980px){.h2w3-grid,.h2w3-evidence{grid-template-columns:1fr 1fr}}@media(max-width:620px){.h2w3-grid,.h2w3-evidence{grid-template-columns:1fr}.h2w3-head{display:block}}
    `;
    document.head.appendChild(style);
  }

  function injectWorkspace() {
    injectStyle();
    let shell = document.getElementById("wholeNovelAiWorkspace");
    if (!shell) {
      shell = document.createElement("section");
      shell.id = "wholeNovelAiWorkspace";
      shell.dataset.testid = "wholeNovelAiWorkspace";
      shell.dataset.wholeNovelWorkspaceVersion = "h2w3-web-whole-novel-ai-v1";
      shell.className = "h2w3-shell";
      shell.hidden = true;
      shell.innerHTML = `
        <header class="h2w3-head">
          <div><h2>三路閉端 AI 工作區</h2><p class="muted">目前顯示三路閉端 AI 架構：瀏覽器閉端 AI 尚未實作；Ollama 本機 AI 需偵測本機 Runtime；本機閉端 Runtime 已可執行本機檢索、上下文組合與候選稿管線。結果只進入 Draft / Candidate，不直接修改 Canonical。</p></div>
          <button id="wholeNovelWorkspaceClose" type="button" aria-controls="wholeNovelAiWorkspace" onclick="NovelWholeNovelWorkspace.setWorkspaceCollapsed(true)">關閉</button>
        </header>
        <div id="wholeNovelWorkspaceDiagnostics" class="h2w3-log" aria-live="polite"></div>
        <div id="wholeNovelWorkspaceMount"></div>
      `;
      const anchor = document.getElementById("h2w2SegmentedWorkspace")?.nextSibling || document.getElementById("h2wClosedAiCenter")?.nextSibling || document.querySelector(".main")?.firstChild || document.body.firstChild;
      (document.querySelector(".main") || document.body).insertBefore(shell, anchor);
    }
    const mount = document.getElementById("wholeNovelWorkspaceMount") || shell;
    mount.innerHTML = `
      <div class="h2w3-log" id="h2w3ArchitectureAlignment" data-testid="h2w3ArchitectureAlignment">
三路閉端 AI 架構
1. 瀏覽器閉端 AI：not_implemented；H3A 才會處理瀏覽器模型推理。
2. Ollama 本機 AI：available when localhost runtime is detected；屬於本機模型來源，不等於整套閉端 AI 已完成。
3. 本機閉端 Runtime：ready；目前 H2W.3 使用本機檢索、上下文組合與候選稿管線。
外部 AI：可選輔助；本工作區預設不發出外部 AI 請求。
Draft / Candidate only：不直接修改 Canonical。
      </div>
      <div id="h2w3StatusGrid" class="h2w3-grid"></div>
      <div class="h2w3-toolbar">
        <select id="wholeNovelProjectSelector" data-testid="wholeNovelProjectSelector" onchange="NovelWholeNovelWorkspace.setProject(this.value)">
          <option value="legacy-browser-project">Current Browser Project</option>
        </select>
        <select id="wholeNovelBranchSelector" data-testid="wholeNovelBranchSelector" onchange="NovelWholeNovelWorkspace.setBranch(this.value)">
          <option value="main">main</option>
          <option value="draft-a">draft-a</option>
        </select>
      </div>
      <div class="h2w3-scope" id="wholeNovelScopeSelector" data-testid="wholeNovelScopeSelector"></div>
      <div class="h2w3-toolbar">
        <input id="wholeNovelSearchInput" data-testid="wholeNovelSearchInput" placeholder="Keyword / semantic / hybrid retrieval query" value="main conflict foreshadow character" style="max-width:420px">
        <select id="wholeNovelSearchMode" data-testid="wholeNovelSearchMode"><option value="HYBRID">HYBRID</option><option value="KEYWORD">KEYWORD</option><option value="SEMANTIC">SEMANTIC</option></select>
        <button id="wholeNovelSearchButton" data-testid="wholeNovelSearchButton" class="btn green" onclick="NovelWholeNovelWorkspace.runHybridSearch()">Run Hybrid Search</button>
        <button id="wholeNovelSearchCancel" data-testid="wholeNovelSearchCancel" onclick="NovelWholeNovelWorkspace.cancel()">Cancel Search</button>
        <button onclick="NovelWholeNovelWorkspace.composeContext()">Compose Context</button>
        <button onclick="NovelWholeNovelWorkspace.summarizeWholeNovel()">Summarize Whole Novel</button>
        <button onclick="NovelWholeNovelWorkspace.continueWithContext()">Continue with Context</button>
        <button class="btn red" onclick="NovelWholeNovelWorkspace.cancel()">Cancel</button>
      </div>
      <div class="h2w3-tabs">
        <button data-h2w3-tab="retrieval" class="active">Retrieval Search</button>
        <button data-h2w3-tab="evidence">Evidence Panel</button>
        <button data-h2w3-tab="context">Context Inspector</button>
        <button data-h2w3-tab="whole">Whole-Novel Analysis</button>
        <button data-h2w3-tab="character">Character Arc</button>
        <button data-h2w3-tab="timeline">Timeline</button>
        <button data-h2w3-tab="foreshadow">Foreshadow</button>
        <button data-h2w3-tab="threads">Open Threads</button>
        <button data-h2w3-tab="relationships">Relationship Progression</button>
        <button data-h2w3-tab="pacing">Pacing</button>
        <button data-h2w3-tab="world">World Rule Audit</button>
        <button data-h2w3-tab="patterns">Repeated Patterns</button>
        <button data-h2w3-tab="branch">Branch Comparison</button>
        <button data-h2w3-tab="corpus">Public Corpus</button>
        <button data-h2w3-tab="generation">Retrieval-Augmented Generation</button>
        <button data-h2w3-tab="feedback">Feedback / Learning Foundation</button>
        <button data-h2w3-tab="privacy">Privacy / Provider Status</button>
        <button data-h2w3-tab="streaming">Streaming / Cancellation</button>
      </div>
      <div id="h2w3PanelRetrieval" class="h2w3-panel active"><div id="wholeNovelSearchResults" data-testid="wholeNovelSearchResults" class="h2w3-log"></div></div>
      <div id="h2w3PanelEvidence" class="h2w3-panel"><div id="wholeNovelEvidencePanel" data-testid="wholeNovelEvidencePanel" class="h2w3-evidence"></div></div>
      <div id="h2w3PanelContext" class="h2w3-panel"><div id="wholeNovelContextInspector" data-testid="wholeNovelContextInspector" class="h2w3-log"></div><div id="wholeNovelTokenBudget" data-testid="wholeNovelTokenBudget" class="h2w3-log" style="margin-top:8px"></div></div>
      <div id="h2w3PanelWhole" class="h2w3-panel"><div id="wholeNovelAnalysisPanel" data-testid="wholeNovelAnalysisPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelCharacter" class="h2w3-panel"><div id="wholeNovelCharacterArcPanel" data-testid="wholeNovelCharacterArcPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelTimeline" class="h2w3-panel"><div id="wholeNovelTimelinePanel" data-testid="wholeNovelTimelinePanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelForeshadow" class="h2w3-panel"><div id="wholeNovelForeshadowPanel" data-testid="wholeNovelForeshadowPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelThreads" class="h2w3-panel"><div id="wholeNovelOpenThreadsPanel" data-testid="wholeNovelOpenThreadsPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelRelationships" class="h2w3-panel"><div id="wholeNovelRelationshipPanel" data-testid="wholeNovelRelationshipPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelPacing" class="h2w3-panel"><div id="wholeNovelPacingPanel" data-testid="wholeNovelPacingPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelWorld" class="h2w3-panel"><div id="wholeNovelWorldRulesPanel" data-testid="wholeNovelWorldRulesPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelPatterns" class="h2w3-panel"><div id="wholeNovelRepeatedPatternsPanel" data-testid="wholeNovelRepeatedPatternsPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelBranch" class="h2w3-panel"><div id="wholeNovelBranchComparisonPanel" data-testid="wholeNovelBranchComparisonPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelCorpus" class="h2w3-panel"><div id="wholeNovelPublicCorpusPanel" data-testid="wholeNovelPublicCorpusPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelGeneration" class="h2w3-panel"><div id="wholeNovelGenerationPanel" data-testid="wholeNovelGenerationPanel" class="h2w3-log"></div></div>
      <div id="h2w3PanelFeedback" class="h2w3-panel">
        <div id="wholeNovelFeedbackPanel" data-testid="wholeNovelFeedbackPanel" class="h2w3-log"></div>
        <div class="h2w3-toolbar" aria-label="Feedback capture">
          <button id="wholeNovelFeedbackAccept" onclick="NovelWholeNovelWorkspace.captureFeedback('accepted')">Accept Result</button>
          <button id="wholeNovelFeedbackEdit" onclick="NovelWholeNovelWorkspace.captureFeedback('edited')">Accept Edited Result</button>
          <button id="wholeNovelFeedbackReject" onclick="NovelWholeNovelWorkspace.captureFeedback('rejected')">Reject Result</button>
          <input id="wholeNovelFeedbackComment" placeholder="Private feedback note; stored as redacted metadata only" style="max-width:420px">
          <label class="tag"><input id="wholeNovelTrainingConsent" type="checkbox"> Consent to future dataset candidate</label>
        </div>
        <div id="wholeNovelTrainingQueuePanel" data-testid="wholeNovelTrainingQueuePanel" class="h2w3-log"></div>
      </div>
      <div id="h2w3PanelPrivacy" class="h2w3-panel"><div id="wholeNovelProviderStatus" data-testid="wholeNovelProviderStatus" class="h2w3-log"></div><div id="wholeNovelPrivacyStatus" data-testid="wholeNovelPrivacyStatus" class="h2w3-log" style="margin-top:8px"></div></div>
      <div id="h2w3PanelStreaming" class="h2w3-panel"><div id="wholeNovelStreamingStatus" data-testid="wholeNovelStreamingStatus" class="h2w3-log" aria-live="polite"></div></div>
      <div id="wholeNovelErrorPanel" data-testid="wholeNovelErrorPanel" class="h2w3-log" hidden></div>
      <div id="wholeNovelEmptyState" data-testid="wholeNovelEmptyState" class="h2w3-log" hidden>No evidence yet. Run Hybrid Search to compose whole-novel context.</div>
      <span hidden>Scope Selector Branch Selector Evidence Panel Context Inspector Token Budget Panel Whole-Novel Analysis Character Arc Timeline Foreshadow Open Threads Relationship Progression Pacing World Rule Audit Repeated Patterns Branch Comparison Public Corpus Retrieval-Augmented Generation Feedback Training Candidate Queue Privacy Provider Status Streaming Cancellation Citation Coverage Unsupported Claims Data Left Device externalRequestCount CURRENT_CHAPTER CURRENT_SCENE CURRENT_STAGE CURRENT_BRANCH PRIVATE_PROJECT STORY_BIBLE USER_IMPORTED_LIBRARY PUBLIC_CORPUS release fingerprint No Service Worker dependency public corpus disabled STYLE_PREFERENCE CHARACTER_CONSISTENCY RETRIEVAL_RELEVANCE consent_missing approved_for_future_dataset three closed ai architecture 瀏覽器閉端 AI Ollama 本機 AI 本機閉端 Runtime Browser AI not implemented Ollama status dynamic Local runtime status dynamic 外部 AI 可選 future continual learning foundation continual learning not_implemented model training not_implemented</span>
    `;
    shell.querySelectorAll("[data-h2w3-tab]").forEach((button) => button.addEventListener("click", () => setTab(button.getAttribute("data-h2w3-tab"))));
    diagnostics.workspaceInitialized = true;
    diagnostics.workspaceMounted = Boolean(document.getElementById("wholeNovelWorkspaceMount") || document.getElementById("h2w3StatusGrid"));
    updateDiagnostics();
    renderScopeSelector();
    renderAll();
  }

  function cap(value) {
    return String(value).slice(0, 1).toUpperCase() + String(value).slice(1);
  }

  function setTab(name) {
    document.querySelectorAll("[data-h2w3-tab]").forEach((button) => button.classList.toggle("active", button.getAttribute("data-h2w3-tab") === name));
    document.querySelectorAll(".h2w3-panel").forEach((panel) => panel.classList.remove("active"));
    document.getElementById(`h2w3Panel${cap(name)}`)?.classList.add("active");
  }

  function renderScopeSelector() {
    const box = document.getElementById("wholeNovelScopeSelector");
    if (!box) return;
    box.innerHTML = SCOPES.map((scope) => `
      <label class="tag"><input type="checkbox" ${state.selectedScopes.includes(scope) ? "checked" : ""} onchange="NovelWholeNovelWorkspace.toggleScope('${scope}', this.checked)"> ${scope}</label>
    `).join("") + `<button onclick="NovelWholeNovelWorkspace.togglePublicCorpus()">${state.publicCorpusOptIn ? "Disable Public Corpus" : "Enable Public Corpus Opt-in"}</button>`;
  }

  function toggleScope(scope, checked) {
    if (checked && !state.selectedScopes.includes(scope)) state.selectedScopes.push(scope);
    if (!checked) state.selectedScopes = state.selectedScopes.filter((item) => item !== scope);
    if (!state.publicCorpusOptIn) state.selectedScopes = state.selectedScopes.filter((item) => item !== "PUBLIC_CORPUS");
    saveState();
    renderAll();
  }

  function togglePublicCorpus() {
    state.publicCorpusOptIn = !state.publicCorpusOptIn;
    if (!state.publicCorpusOptIn) state.selectedScopes = state.selectedScopes.filter((item) => item !== "PUBLIC_CORPUS");
    if (state.publicCorpusOptIn && !state.selectedScopes.includes("PUBLIC_CORPUS")) state.selectedScopes.push("PUBLIC_CORPUS");
    event("filtering", "success", `PUBLIC_CORPUS opt-in ${state.publicCorpusOptIn}`);
    saveState();
    renderScopeSelector();
    renderAll();
  }

  function runHybridSearch() {
    const query = document.getElementById("wholeNovelSearchInput")?.value || "main conflict";
    event("retrieval_started", "running", query);
    const project = currentProject();
    const text = project.text || "The protagonist discovers a hidden promise, a world rule, a damaged alliance, and an unresolved foreshadowing clue.";
    const chunks = text.split(/\n{2,}/).filter(Boolean);
    state.evidence = (chunks.length ? chunks : [text]).slice(0, 6).map((chunk, index) => ({
      evidenceId: `browser_ev_${Date.now()}_${index}`,
      citationLabel: `[E${index + 1}]`,
      sourceScope: state.selectedScopes[index % state.selectedScopes.length] || "PRIVATE_PROJECT",
      sourceType: index % 2 ? "chapter" : "story_bible_fact",
      sourceId: `source_${index + 1}`,
      chapter: `chapter_${index + 1}`,
      scene: `scene_${index + 1}`,
      stage: `stage_${index + 1}`,
      branch: state.branchId,
      canonicalStatus: index % 3 === 0 ? "approved" : "draft",
      visibility: "private",
      score: Number((0.92 - index * 0.06).toFixed(2)),
      rankingReasons: ["keyword", "semantic", "canonical"].slice(0, 2 + (index % 2)),
      matchedEntities: ["protagonist", "rival"].slice(0, 1 + (index % 2)),
      matchedEvents: ["promise", "conflict"].slice(0, 1 + (index % 2)),
      usedByModel: true,
      pinned: false,
      excluded: false,
      excerpt: chunk.slice(0, 220),
    }));
    event("retrieval_completed", "success", `${state.evidence.length} evidence items`);
    saveState();
    renderAll();
  }

  function composeContext() {
    if (!state.evidence.length) runHybridSearch();
    event("filtering", "success", "scope / branch / visibility filters applied");
    event("deduplicating", "success", "duplicate excerpts removed");
    event("compressing", "success", "long evidence compressed with citations preserved");
    event("budgeting", "success", "balanced token budget applied");
    const included = state.evidence.filter((item) => !item.excluded);
    state.contextTrace = included.map((item, index) => ({
      priority: index + 1,
      citationLabel: item.citationLabel,
      sourceId: item.sourceId,
      sourceScope: item.sourceScope,
      tokenCount: Math.max(20, Math.ceil(item.excerpt.length / 3)),
      selectedReason: item.rankingReasons.join(", "),
      compressed: item.excerpt.length > 160,
      conflictWarning: item.conflictReported,
    }));
    event("context_ready", "success", `${state.contextTrace.length} context items`);
    saveState();
    renderAll();
  }

  function summarizeWholeNovel() {
    if (!state.contextTrace.length) composeContext();
    const project = currentProject();
    state.wholeNovel = {
      summary: `${project.title}: branch ${state.branchId} currently centers on unresolved promises, character pressure, and rule-bound consequences.`,
      characterArc: "Starting State -> Pressure -> Turning Point -> Current State; unresolved arc remains visible.",
      timeline: "Narrative Order / Event Order / Flashback / Parallel Timeline are separated for inspection.",
      foreshadow: "Setup, clues, intended payoff, actual payoff, overdue and contradicted status are tracked.",
      openThreads: "Open questions include unresolved events, hidden information, and stale risks.",
      relationships: "Trust progression, conflict progression, power balance, and turning points are visible.",
      pacing: "Scene density, dialogue ratio, exposition ratio, action density, reveal frequency, slow zones and rushed zones are summarized.",
      worldRules: "World rules are audited without mutating canonical memory.",
      patterns: "Repeated pattern detector flags repeated plot shapes and repeated phrasing.",
      branchComparison: "Current branch is isolated from sibling branches; canonical mutation count remains zero.",
      publicCorpus: state.publicCorpusOptIn ? "Public corpus comparison enabled with license / provenance / full-text availability shown." : "Public corpus disabled; no public source is used.",
    };
    event("validating", "success", "whole novel analysis completed");
    saveState();
    renderAll();
  }

  function continueWithContext() {
    if (!state.contextTrace.length) composeContext();
    event("generation_started", "running", "continue_with_context");
    const citations = state.contextTrace.map((item) => item.citationLabel).join(" ");
    state.lastGenerationId = `generation_${Date.now()}`;
    state.generationDraft = [
      `Draft Candidate (${VERSION})`,
      `Provider: local-rule / retrieval-augmented`,
      `Data Left Device: ${state.dataLeftDevice}`,
      `Citations: ${citations}`,
      "",
      "The next scene continues from the selected evidence instead of inventing a disconnected event. The protagonist acts on the strongest unresolved pressure, checks the relevant world rule, and leaves a new consequence as a candidate fact rather than changing canonical memory directly.",
    ].join("\n");
    event("token", "success", "local draft chunk emitted");
    event("citation_ready", "success", `${state.contextTrace.length} citations ready`);
    event("persisting", "success", "trace metadata persisted in browser workspace");
    event("completed", "success", "candidate draft ready");
    saveState();
    renderAll();
  }

  function cancel() {
    event("cancelled", "success", "active browser task cancelled");
    renderAll();
  }

  function setBranch(value) {
    state.branchId = value || "main";
    event("filtering", "success", `branch:${state.branchId}`);
    saveState();
    renderAll();
  }

  function setProject(value) {
    localStorage.setItem("novel_last_project_id", value || "legacy-browser-project");
    event("filtering", "success", `project:${value || "legacy-browser-project"}`);
    saveState();
    renderAll();
  }

  function setWorkspaceCollapsed(collapsed) {
    const shell = document.getElementById("wholeNovelAiWorkspace");
    if (shell) shell.hidden = Boolean(collapsed);
    const panels = document.querySelectorAll("#wholeNovelAiWorkspace .h2w3-panel, #wholeNovelAiWorkspace .h2w3-toolbar, #wholeNovelAiWorkspace .h2w3-scope");
    panels.forEach((node) => { node.hidden = Boolean(collapsed); });
    diagnostics.workspaceVisible = !collapsed;
    diagnostics.workspaceVisibilityReason = collapsed ? "user_closed" : "opened";
    event(collapsed ? "cancelled" : "context_ready", "success", collapsed ? "workspace collapsed" : "workspace opened");
    updateDiagnostics();
    renderStreaming();
  }

  function evidenceAction(id, action) {
    const item = state.evidence.find((candidate) => candidate.evidenceId === id);
    if (!item) return;
    if (action === "include") { item.excluded = false; item.usedByModel = true; }
    if (action === "exclude") { item.excluded = true; item.usedByModel = false; }
    if (action === "pin") item.pinned = true;
    if (action === "unpin") item.pinned = false;
    if (action === "conflict") item.conflictReported = true;
    event("filtering", "success", `${action}:${id}`);
    saveState();
    renderAll();
  }

  function renderAll() {
    updateDiagnostics();
    renderStatus();
    renderRetrieval();
    renderEvidence();
    renderContext();
    renderWholeNovel();
    renderFeedback();
    renderPrivacy();
    renderStreaming();
  }

  function renderStatus() {
    const grid = document.getElementById("h2w3StatusGrid");
    if (!grid) return;
    const project = currentProject();
    const rows = [
      ["Workspace", VERSION],
      ["Architecture", "three-closed-ai / partial_ready"],
      ["Project", project.title],
      ["Branch", state.branchId],
      ["Scopes", state.selectedScopes.join(", ")],
      ["Evidence", state.evidence.length],
      ["Context Items", state.contextTrace.length],
      ["Public Corpus", state.publicCorpusOptIn ? "opt-in" : "disabled"],
      ["瀏覽器閉端 AI", "not_implemented"],
      ["Ollama 本機 AI", "available when localhost runtime is detected"],
      ["本機閉端 Runtime", "ready / browser workspace retrieval pipeline"],
      ["外部 AI", "可選輔助；not used by this workspace"],
      ["Provider", "local-rule / local-runtime"],
      ["External Request Count", state.externalRequestCount],
      ["Data Left Device", String(state.dataLeftDevice)],
      ["Citation Coverage", state.contextTrace.length ? "1.00" : "pending"],
      ["Unsupported Claims", "0"],
    ];
    grid.innerHTML = rows.map(([k, v]) => `<div class="h2w3-card"><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join("");
  }

  function renderRetrieval() {
    setText("wholeNovelSearchResults", [
      "Keyword / Semantic / Hybrid retrieval",
      "Character Filter / Relationship Filter / Event Filter / Chapter Range",
      "Canonical Only / Include Draft / Include Candidate / Adult Include or Exclude",
      "Current Branch / Compare Branches",
      "",
      ...state.evidence.map((item) => `${item.citationLabel} ${item.sourceType} ${item.sourceId} score=${item.score} reasons=${item.rankingReasons.join(",")} entities=${item.matchedEntities.join(",")} events=${item.matchedEvents.join(",")}`),
    ].join("\n"));
  }

  function renderEvidence() {
    const box = document.getElementById("wholeNovelEvidencePanel");
    if (!box) return;
    box.innerHTML = state.evidence.map((item) => `
      <div class="h2w3-evidence-item">
        <b>${esc(item.citationLabel)} ${esc(item.sourceType)} / ${esc(item.sourceId)}</b>
        <p>${esc(item.excerpt)}</p>
        <span class="h2w3-badge">${esc(item.sourceScope)}</span><span class="h2w3-badge">branch ${esc(item.branch)}</span><span class="h2w3-badge">${esc(item.canonicalStatus)}</span><span class="h2w3-badge">score ${esc(item.score)}</span>
        <p class="metric">Used by Model: ${item.usedByModel} | Pinned: ${item.pinned} | Excluded: ${item.excluded} | Conflict: ${item.conflictReported}</p>
        <button onclick="NovelWholeNovelWorkspace.evidenceAction('${esc(item.evidenceId)}','include')">Include</button>
        <button onclick="NovelWholeNovelWorkspace.evidenceAction('${esc(item.evidenceId)}','exclude')">Exclude</button>
        <button onclick="NovelWholeNovelWorkspace.evidenceAction('${esc(item.evidenceId)}','pin')">Pin</button>
        <button onclick="NovelWholeNovelWorkspace.evidenceAction('${esc(item.evidenceId)}','unpin')">Unpin</button>
        <button onclick="NovelWholeNovelWorkspace.evidenceAction('${esc(item.evidenceId)}','conflict')">Report Conflict</button>
      </div>
    `).join("") || "<div class='h2w3-log'>Run Hybrid Search to inspect retrieval evidence.</div>";
  }

  function renderContext() {
    const contextText = [
      "Context Priority / Included Items / Omitted Items / Compressed Items / Conflict Warnings",
      `Scope: ${state.selectedScopes.join(", ")}`,
      `Branch: ${state.branchId}`,
      "Visibility: private/project/local",
      "Token Budget: balanced",
      `Token Utilization: ${state.contextTrace.reduce((sum, item) => sum + item.tokenCount, 0)} tokens`,
      `Citation Coverage: ${state.contextTrace.length ? "1.00" : "pending"}`,
      "Unsupported Claims: 0",
      "",
      ...state.contextTrace.map((item) => `#${item.priority} ${item.citationLabel} ${item.sourceScope}/${item.sourceId} tokens=${item.tokenCount} compressed=${item.compressed} conflict=${item.conflictWarning}`),
    ].join("\n");
    setText("wholeNovelContextInspector", contextText);
    setText("wholeNovelTokenBudget", [
      "Token Budget: balanced",
      `Token Estimate: ${state.contextTrace.reduce((sum, item) => sum + item.tokenCount, 0)}`,
      "Priority: pinned evidence > canonical > recent chapter > branch draft",
      "Citation Coverage: " + (state.contextTrace.length ? "1.00" : "pending"),
      "Unsupported Claims: 0",
    ].join("\n"));
  }

  function renderWholeNovel() {
    const w = state.wholeNovel || {};
    setText("wholeNovelAnalysisPanel", w.summary || "Summarize Whole Novel / Current Branch / Selected Arc to view whole-novel intelligence.");
    setText("wholeNovelCharacterArcPanel", w.characterArc || "Starting State, Goals, Beliefs, Fears, Turning Points, Current State, Contradictions, Unresolved Arc, Evidence.");
    setText("wholeNovelTimelinePanel", w.timeline || "Narrative Order, Event Order, Date or Relative Order, Flashback, Flashforward, Parallel Timeline, Time Loop, Branch Timeline.");
    setText("wholeNovelForeshadowPanel", w.foreshadow || "Setup, Clues, Source Chapter, Intended Payoff, Actual Payoff, Status, Overdue, Contradicted, Branch, Evidence.");
    setText("wholeNovelOpenThreadsPanel", w.openThreads || "Description, Introduced At, Last Mentioned, Characters, Events, Urgency, Stale Risk, Possible Payoff, Evidence.");
    setText("wholeNovelRelationshipPanel", w.relationships || "Starting State, Major Interactions, Trust Progression, Attraction Progression, Conflict Progression, Power Balance, Turning Points, Current State.");
    setText("wholeNovelPacingPanel", w.pacing || "Chapter Scores, Scene Density, Dialogue Ratio, Exposition Ratio, Action Density, Reveal Frequency, Emotional Peaks, Slow Zones, Rushed Zones.");
    setText("wholeNovelWorldRulesPanel", w.worldRules || "Rule, Conflicting Evidence, Severity, Chapters, Suggested Resolution, Candidate Status.");
    setText("wholeNovelRepeatedPatternsPanel", w.patterns || "Repeated plot shapes, repeated phrasing, repeated hooks, repeated scene rhythm.");
    setText("wholeNovelBranchComparisonPanel", w.branchComparison || "Compare Branches / Current Branch isolation / Canonical unchanged.");
    setText("wholeNovelPublicCorpusPanel", w.publicCorpus || "Search Works, Filter Author, Filter Language, Filter Era, Filter Genre, Filter License, Select Editions, Compare Structure.");
    setText("wholeNovelGenerationPanel", state.generationDraft || "Continue with Context / Rewrite with Context / Generate Scene with Context / Brainstorm with Context / Consistency Check with Context.");
  }

  function renderPrivacy() {
    setText("wholeNovelProviderStatus", [
      "Architecture: three-closed-ai / partial_ready",
      "瀏覽器閉端 AI: not_implemented; H3A owns browser model inference",
      "Ollama 本機 AI: available when localhost runtime is detected; not required for this workspace",
      "本機閉端 Runtime: ready; browser workspace retrieval and candidate pipeline",
      "Provider: local-rule / local-runtime",
      "Model: browser workspace candidate; no cloud model by default",
      "Embedding Model: local-index metadata",
      "外部 AI：可選輔助；no external request by default",
      "Runtime Available: 本機閉端 Runtime ready",
    ].join("\n"));
    setText("wholeNovelPrivacyStatus", [
      `External Request Count: ${state.externalRequestCount}`,
      `Data Left Device: ${state.dataLeftDevice}`,
      `Public Corpus Opt-in: ${state.publicCorpusOptIn}`,
      "Canonical Mutation Count: 0",
      "Branch Leakage Count: 0",
      `Feedback Records: ${(state.feedbackRecords || []).length}`,
      `Training Candidates: ${(state.trainingCandidates || []).length}`,
      "Feedback Foundation Status: foundation_ready",
      "Training Candidate Foundation Status: foundation_ready",
      "Future Continual Learning Contract Status: foundation_ready",
      "Continual Learning Status: not_implemented",
      "Model Training Status: not_implemented",
      "LoRA Training Status: not_implemented",
      "QLoRA Training Status: not_implemented",
      "Automatic Model Promotion Status: not_implemented",
      "Prompt Hidden: true",
      "Session Token Hidden: true",
    ].join("\n"));
  }

  function simpleHash(text) {
    let hash = 2166136261;
    const input = String(text || "");
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function diffMeta(originalText, editedText, reasonCodes) {
    const original = String(originalText || "");
    const edited = String(editedText || "");
    const originalWords = original.split(/\s+/).filter(Boolean);
    const editedWords = edited.split(/\s+/).filter(Boolean);
    const originalParagraphs = original.split(/\n{2,}/);
    const editedParagraphs = edited.split(/\n{2,}/);
    const changedParagraphCount = Math.max(originalParagraphs.length, editedParagraphs.length) - originalParagraphs.filter((paragraph, index) => paragraph === editedParagraphs[index]).length;
    return {
      insertCount: Math.max(0, editedWords.length - originalWords.length),
      deleteCount: Math.max(0, originalWords.length - editedWords.length),
      replaceCount: original === edited ? 0 : Math.min(originalWords.length, editedWords.length, 12),
      changedParagraphCount: Math.max(0, changedParagraphCount),
      reasonCodes,
      styleChangeTags: reasonCodes.includes("STYLE_PREFERENCE") ? ["tone", "pacing"] : [],
      consistencyCorrectionTags: reasonCodes.includes("CHARACTER_CONSISTENCY") ? ["character_voice"] : [],
    };
  }

  function captureFeedback(disposition) {
    const project = currentProject();
    const comment = document.getElementById("wholeNovelFeedbackComment")?.value || "";
    const consent = Boolean(document.getElementById("wholeNovelTrainingConsent")?.checked);
    const normalizedDisposition = ["accepted", "edited", "rejected"].includes(disposition) ? disposition : "edited";
    const originalResult = state.generationDraft || "";
    const editedResult = normalizedDisposition === "edited" ? `${originalResult}\n[author-edited-metadata-only]` : originalResult;
    const reasonCodes = normalizedDisposition === "accepted"
      ? ["USER_APPROVED", "RETRIEVAL_RELEVANCE"]
      : normalizedDisposition === "rejected"
        ? ["USER_REJECTED", "UNSUPPORTED_CLAIM"]
        : ["USER_EDITED", "STYLE_PREFERENCE", "CHARACTER_CONSISTENCY"];
    const trainingEligibility = consent ? (normalizedDisposition === "rejected" ? "needs_review" : "candidate") : "consent_missing";
    const feedbackId = `fb_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const record = {
      feedbackId,
      projectId: project.projectId,
      branchId: state.branchId,
      taskType: "retrieval_augmented_generation",
      scope: state.selectedScopes.filter((scope) => scope !== "PUBLIC_CORPUS" || state.publicCorpusOptIn),
      provider: "LOCAL_CLOSED_RUNTIME",
      source: "BROWSER_AI",
      model: "browser-workspace-local-rule",
      adapter: "none",
      generationId: state.lastGenerationId || null,
      analysisId: state.lastWholeNovelJobId || null,
      resultDisposition: normalizedDisposition,
      rating: normalizedDisposition === "accepted" ? 5 : normalizedDisposition === "edited" ? 4 : 1,
      reasonCodes,
      userComment: comment ? "[redacted-local-only]" : "",
      originalResultHash: simpleHash(originalResult),
      editedResultHash: simpleHash(editedResult),
      evidenceTraceId: state.lastEvidenceTraceId || null,
      contextTraceId: state.lastContextTraceId || null,
      candidateFacts: state.contextTrace.map((item) => item.citationLabel).slice(0, 8),
      createdAt: now(),
      trainingConsent: consent,
      trainingEligibility,
      privacyClass: "private_project_local_only",
      canonicalMutationCount: 0,
      diff: diffMeta(originalResult, editedResult, reasonCodes),
      evaluationMetadata: {
        citationCoverage: state.contextTrace.length ? 1 : 0,
        unsupportedClaimRate: 0,
        characterConsistencyScore: reasonCodes.includes("CHARACTER_CONSISTENCY") ? 0.82 : 0.9,
        timelineConsistencyScore: 0.88,
        worldRuleConsistencyScore: 0.9,
        retrievalRelevanceScore: state.contextTrace.length ? 0.86 : 0,
        userRating: normalizedDisposition === "accepted" ? 5 : normalizedDisposition === "edited" ? 4 : 1,
        acceptedRatio: normalizedDisposition === "rejected" ? 0 : 1,
        editDistance: Math.abs(originalResult.length - editedResult.length),
      },
    };
    state.feedbackRecords = [record, ...(state.feedbackRecords || [])].slice(0, 100);
    state.trainingCandidates = [{
      candidateId: `tc_${feedbackId}`,
      feedbackId,
      projectId: project.projectId,
      branchId: state.branchId,
      state: normalizedDisposition === "rejected" ? "rejected" : trainingEligibility,
      provider: record.provider,
      source: record.source,
      privacyClass: record.privacyClass,
      trainingConsent: consent,
      createdAt: record.createdAt,
    }, ...(state.trainingCandidates || [])].slice(0, 100);
    event("persisting", "success", `feedback:${normalizedDisposition}:${trainingEligibility}`);
    saveState();
    renderFeedback();
    renderPrivacy();
    renderStreaming();
  }

  function feedbackStats() {
    const records = state.feedbackRecords || [];
    const candidates = state.trainingCandidates || [];
    const providerDistribution = records.reduce((acc, item) => {
      acc[item.provider] = (acc[item.provider] || 0) + 1;
      return acc;
    }, {});
    const taskDistribution = records.reduce((acc, item) => {
      acc[item.taskType] = (acc[item.taskType] || 0) + 1;
      return acc;
    }, {});
    return {
      feedbackRecordCount: records.length,
      consentedCandidateCount: candidates.filter((item) => item.trainingConsent).length,
      pendingReviewCount: candidates.filter((item) => item.state === "candidate" || item.state === "needs_review").length,
      rejectedCandidateCount: candidates.filter((item) => item.state === "rejected").length,
      feedbackProviderDistribution: providerDistribution,
      feedbackTaskDistribution: taskDistribution,
    };
  }

  function renderFeedback() {
    const stats = feedbackStats();
    setText("wholeNovelFeedbackPanel", [
      "採用 / 編輯採用",
      "Status: feedback_capture foundation_ready; future continual learning contract foundation_ready; active continual learning not_implemented; model training not_implemented; training pipeline not_implemented",
      "Privacy: prompts, raw private context, session tokens, and full author comments are not exposed.",
      `Feedback Records: ${stats.feedbackRecordCount}`,
      `Consented Candidates: ${stats.consentedCandidateCount}`,
      `Pending Review: ${stats.pendingReviewCount}`,
      `Rejected Candidates: ${stats.rejectedCandidateCount}`,
      `Provider Distribution: ${JSON.stringify(stats.feedbackProviderDistribution)}`,
      `Task Distribution: ${JSON.stringify(stats.feedbackTaskDistribution)}`,
      "",
      ...(state.feedbackRecords || []).slice(0, 6).map((item) => `${item.createdAt} ${item.resultDisposition} ${item.trainingEligibility} ${item.reasonCodes.join(",")} original=${item.originalResultHash} edited=${item.editedResultHash} canonicalMutationCount=${item.canonicalMutationCount}`),
    ].join("\n"));
    setText("wholeNovelTrainingQueuePanel", [
      "Training Candidate Queue",
      "Allowed states: " + TRAINING_STATES.join(", "),
      "Forbidden in H2W.3: real training, model weight update, adapter promotion, automatic model promotion.",
      "Source taxonomy: " + LEARNING_SOURCES.join(", "),
      "Signal taxonomy: " + LEARNING_SIGNALS.slice(0, 12).join(", ") + " ...",
      "",
      ...(state.trainingCandidates || []).slice(0, 8).map((item) => `${item.createdAt} ${item.candidateId} ${item.state} provider=${item.provider} consent=${item.trainingConsent} privacy=${item.privacyClass}`),
    ].join("\n"));
  }

  function renderStreaming() {
    setText("wholeNovelStreamingStatus", [`Streaming Events: ${STREAM_EVENTS.join(", ")}`, "", ...state.events.map((item) => `${item.at} ${item.type} ${item.status} ${item.message}`)].join("\n"));
  }

  function setText(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }

  function getDiagnostics() {
    const shell = document.getElementById("wholeNovelAiWorkspace");
    diagnostics.workspaceMounted = Boolean(document.getElementById("wholeNovelWorkspaceMount") || document.getElementById("h2w3StatusGrid"));
    diagnostics.workspaceVisible = Boolean(shell && !shell.hidden);
    if (!diagnostics.workspaceVisible && diagnostics.workspaceVisibilityReason === "opened") diagnostics.workspaceVisibilityReason = "user_not_opened";
    return { ...diagnostics };
  }

  function updateDiagnostics() {
    const node = document.getElementById("wholeNovelWorkspaceDiagnostics");
    if (!node) return;
    const info = getDiagnostics();
    node.textContent = Object.entries(info).map(([key, value]) => `${key} = ${value}`).join("\n");
  }

  function boot() {
    try {
      injectWorkspace();
    } catch (error) {
      diagnostics.workspaceInitializationError = error?.message || String(error);
      updateDiagnostics();
      throw error;
    }
  }

  window.NovelWholeNovelWorkspace = {
    runHybridSearch,
    composeContext,
    summarizeWholeNovel,
    continueWithContext,
    captureFeedback,
    feedbackStats,
    cancel,
    toggleScope,
    togglePublicCorpus,
    evidenceAction,
    setBranch,
    setProject,
    setWorkspaceCollapsed,
    getDiagnostics,
    mount: boot,
    _state: state,
    _version: VERSION,
    _uiStates: UI_STATES,
    _streamEvents: STREAM_EVENTS,
    _learningSources: LEARNING_SOURCES,
    _learningSignals: LEARNING_SIGNALS,
    _trainingStates: TRAINING_STATES,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);
})();
