(function () {
  "use strict";

  const App = {
    mode: "離線規則續寫",
    saving: false,
    generating: false,
    lastSavedAt: "",
    autosaveTimer: null,
    localModelStatus: "本機模型未連線",
    originals: {}
  };

  function qs(id) {
    return document.getElementById(id);
  }

  function textTime(date = new Date()) {
    return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  }

  function setMessage(message, type = "info") {
    const out = qs("integrityOutput") || qs("batchLabOutput") || qs("miniAiOutput");
    if (out) out.textContent = message;
    updateStatusBar(type === "error" ? message : "");
  }

  function totalWords(story) {
    return (Array.isArray(story) ? story : []).reduce((sum, chapter) => sum + NovelDB.words(chapter), 0);
  }

  function latestChapterTitle(story) {
    const latest = Array.isArray(story) ? story[story.length - 1] : "";
    const match = String(latest || "").match(/^#\s*(.+)$/m);
    return match ? match[1].trim() : (latest ? `第${story.length}章` : "尚無章節");
  }

  function ensureStatusBar() {
    if (qs("offlineStatusBar")) return;
    const bar = document.createElement("div");
    bar.id = "offlineStatusBar";
    bar.className = "offline-status-bar";
    bar.innerHTML = [
      '<span id="netStatus">檢查網路中</span>',
      '<span id="modeStatus">離線規則續寫</span>',
      '<span id="modelStatus">本機模型未連線</span>',
      '<span id="saveStatus">尚未自動儲存</span>',
      '<span id="errorStatus" class="warn">準備中</span>'
    ].join("");
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function updateStatusBar(errorText = "") {
    ensureStatusBar();
    const online = navigator.onLine;
    qs("netStatus").textContent = online ? "在線" : "離線";
    qs("netStatus").className = online ? "ok" : "bad";
    qs("modeStatus").textContent = App.mode;
    qs("modelStatus").textContent = App.localModelStatus;
    qs("modelStatus").className = App.localModelStatus.includes("已連線") ? "ok" : "warn";
    qs("saveStatus").textContent = App.lastSavedAt ? `已自動儲存 ${App.lastSavedAt}` : "尚未自動儲存";
    qs("saveStatus").className = App.saving ? "warn" : "ok";
    qs("errorStatus").textContent = errorText || "狀態正常";
    qs("errorStatus").className = errorText ? "bad" : "ok";
    updateCloudButtons();
  }

  function updateCloudButtons() {
    const cloudLabels = ["雲端", "OpenAI", "外部AI", "送到外部AI"];
    document.querySelectorAll("button").forEach((button) => {
      const text = button.textContent || "";
      const needsCloud = cloudLabels.some((label) => text.includes(label));
      if (!needsCloud) return;
      if (!navigator.onLine) {
        button.disabled = true;
        button.title = "需要網路";
        button.classList.add("status-disabled");
      } else {
        button.disabled = false;
        button.title = "";
        button.classList.remove("status-disabled");
      }
    });
  }

  function ensureContinuePanel() {
    if (qs("continuePanel")) return;
    const target = qs("view-creation");
    if (!target) return;
    const panel = document.createElement("section");
    panel.id = "continuePanel";
    panel.className = "continue-panel";
    panel.innerHTML = `
      <h2>繼續上次小說</h2>
      <div id="continueContent" class="muted">正在讀取作品...</div>
    `;
    target.insertBefore(panel, target.firstChild.nextSibling);
  }

  async function renderContinuePanel() {
    ensureContinuePanel();
    const box = qs("continueContent");
    if (!box) return;
    const project = await NovelDB.latestProject();
    if (!project) {
      box.innerHTML = "尚未建立作品。";
      return;
    }
    const latestTitle = latestChapterTitle(project.state?.story || []);
    box.innerHTML = `
      <div class="continue-grid">
        <div class="continue-stat"><b>作品名稱</b>${project.title}</div>
        <div class="continue-stat"><b>最近編輯</b>${new Date(project.updatedAt).toLocaleString()}</div>
        <div class="continue-stat"><b>目前章數</b>${project.currentChapter || 0}</div>
        <div class="continue-stat"><b>總字數</b>${project.totalWords || 0}</div>
        <div class="continue-stat"><b>最新章節</b>${latestTitle}</div>
      </div>
      <div class="bar">
        <button class="btn green" onclick="NovelApp.continueLastProject()">繼續寫作</button>
        <button onclick="NovelApp.readFullText()">閱讀全文</button>
        <button onclick="NovelApp.showVersions()">版本紀錄</button>
      </div>
    `;
  }

  function ensureHomeEntrances() {
    const panel = qs("quickStartPanel");
    if (!panel || qs("mainEntryBar")) return;
    const entry = document.createElement("div");
    entry.id = "mainEntryBar";
    entry.className = "bar";
    entry.innerHTML = `
      <button class="btn green" onclick="NovelApp.startNewNovel()">開始新小說</button>
      <button class="btn gold" onclick="NovelApp.continueLastProject()">繼續上次小說</button>
      <button onclick="showView('export')">我的作品</button>
      <button onclick="importJSONPrompt()">匯入備份</button>
      <button onclick="NovelApp.toggleAdvancedTools()">進階工具</button>
    `;
    panel.appendChild(entry);
  }

  function ensureEditor() {
    if (qs("chapterEditor")) return;
    const storyOut = qs("storyOutput");
    if (!storyOut) return;
    const editor = document.createElement("textarea");
    editor.id = "chapterEditor";
    editor.className = "chapter-editor hidden";
    editor.placeholder = "可在這裡編輯全文或目前章節，系統會自動存檔。";
    storyOut.insertAdjacentElement("afterend", editor);
    editor.addEventListener("input", () => {
      const text = editor.value;
      state.story = text ? text.split(/\n\n={10,}\n\n/g) : [];
      state.chapter = state.story.length;
      scheduleAutosave("edit");
    });
  }

  function refreshEditor() {
    ensureEditor();
    const editor = qs("chapterEditor");
    if (!editor) return;
    editor.value = (state.story || []).join("\n\n" + "=".repeat(48) + "\n\n");
  }

  function scheduleAutosave(reason = "input") {
    clearTimeout(App.autosaveTimer);
    App.autosaveTimer = setTimeout(() => autosave(reason), 1000);
  }

  async function autosave(reason = "auto") {
    if (App.saving) return;
    App.saving = true;
    updateStatusBar();
    try {
      if (typeof collectState === "function") collectState();
      await NovelDB.saveState(state, reason);
      localStorage.setItem("novel_last_project_id", state.projectId || "");
      App.lastSavedAt = textTime();
      if (reason === "manual" || reason === "new-chapter" || reason === "batch") {
        await NovelDB.createVersion(state.projectId, reason === "manual" ? "手動存檔" : "章節更新", state, { reason });
      }
    } catch (error) {
      updateStatusBar(`自動存檔失敗：${error.message || error}`);
      throw error;
    } finally {
      App.saving = false;
      updateStatusBar();
      renderContinuePanel();
    }
  }

  async function offlineContinue() {
    if (App.generating) return;
    App.generating = true;
    App.mode = "離線規則續寫";
    updateStatusBar("正在生成離線章節...");
    const buttons = lockGeneratingButtons(true);
    try {
      if (!Array.isArray(state.story) || !state.story.length) {
        if (typeof createStory === "function") createStory();
      }
      const chapter = OfflineNovelEngine.generateNextChapter(state);
      state.story.push(chapter.content);
      state.chapter = state.story.length;
      state.memory = Array.isArray(state.memory) ? state.memory : [];
      state.memory.push(`第${chapter.chapterNumber}章：${chapter.title}（離線規則續寫）`);
      if (typeof saveNovel === "function") saveNovel();
      if (typeof renderAll === "function") renderAll();
      refreshEditor();
      await autosave("new-chapter");
      setMessage(`已產生離線規則續寫：${chapter.title}\n\n${chapter.content}`);
      if (typeof showView === "function") showView("interactive");
    } catch (error) {
      setMessage(`生成失敗：${error.message || error}\n原本章節已保留，沒有清空。`, "error");
    } finally {
      App.generating = false;
      lockGeneratingButtons(false, buttons);
      updateStatusBar();
    }
  }

  function buildAiPrompt() {
    const latest = (state.story || []).slice(-1)[0] || "";
    return `請根據以下作品資料，完整續寫下一章，輸出可直接閱讀的繁體中文小說章節，不要只給提示詞。\n\n作品：${state.title}\n題材：${state.genre || state.themeMode}\n主角：${state.protagonist || state.heroType}\n世界觀：${state.worldCore}\n能力：${state.powerCore}\n主線衝突：${state.conflictCore}\n反派：${state.villainCore}\n風格：${state.styleMode}\n故事種子：${state.seed}\n上一章：\n${latest}\n\n下一章必須包含本章標題、本章目標、主要衝突、人物行動、情勢逆轉、章尾鉤子，並寫成 800～1500 字草稿。`;
  }

  async function aiContinue() {
    if (App.generating) return;
    App.generating = true;
    App.mode = "AI完整續寫";
    const buttons = lockGeneratingButtons(true);
    try {
      const config = NovelAIService.getConfig();
      if (config.provider === "offline") {
        throw new Error("若要完全離線，請使用「離線規則續寫」。");
      }
      const text = await NovelAIService.generate(buildAiPrompt());
      if (!text.trim()) throw new Error("AI 沒有回傳章節內容。");
      state.story = Array.isArray(state.story) ? state.story : [];
      state.story.push(text.trim());
      state.chapter = state.story.length;
      state.memory = Array.isArray(state.memory) ? state.memory : [];
      state.memory.push(`第${state.chapter}章：AI完整續寫`);
      if (typeof saveNovel === "function") saveNovel();
      if (typeof renderAll === "function") renderAll();
      refreshEditor();
      await autosave("new-chapter");
      setMessage(`AI 完整續寫完成。\n\n${text}`);
    } catch (error) {
      setMessage(`AI完整續寫失敗：${error.message || error}`, "error");
    } finally {
      App.generating = false;
      lockGeneratingButtons(false, buttons);
      updateStatusBar();
    }
  }

  function lockGeneratingButtons(locked, existing = []) {
    const buttons = existing.length ? existing : [...document.querySelectorAll("button")].filter((button) => /續寫|生成|建立|批量|套用/.test(button.textContent || ""));
    buttons.forEach((button) => {
      button.disabled = locked;
      button.classList.toggle("status-disabled", locked);
      if (locked) button.dataset.originalText = button.textContent;
      if (locked) button.textContent = "正在生成...";
      else if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    });
    return buttons;
  }

  function ensureContinueButtons() {
    if (qs("offlineContinueBtn")) return;
    const creationBar = qs("view-creation")?.querySelector(".workPanel .bar") || qs("view-creation")?.querySelector(".bar");
    if (creationBar) {
      creationBar.insertAdjacentHTML("beforeend", `
        <button id="offlineContinueBtn" class="btn green" onclick="NovelApp.offlineContinue()">離線規則續寫</button>
        <button id="aiContinueBtn" class="btn gold" onclick="NovelApp.aiContinue()">AI完整續寫</button>
      `);
    }
    const interactive = qs("view-interactive")?.querySelector(".bar");
    if (interactive) {
      interactive.insertAdjacentHTML("beforeend", `
        <button class="btn green" onclick="NovelApp.offlineContinue()">離線規則續寫下一章</button>
        <button class="btn gold" onclick="NovelApp.aiContinue()">AI完整續寫下一章</button>
      `);
    }
  }

  async function continueLastProject() {
    const project = await NovelDB.latestProject();
    if (!project) {
      alert("尚未建立作品。");
      return;
    }
    const loaded = await NovelDB.loadProject(project.id);
    if (!loaded) {
      alert("作品讀取失敗。");
      return;
    }
    state = { ...state, ...loaded };
    if (typeof applyStateToForm === "function") applyStateToForm();
    if (typeof renderAll === "function") renderAll();
    refreshEditor();
    if (typeof showView === "function") showView("creation");
  }

  function readFullText() {
    if (typeof renderAll === "function") renderAll();
    const storyOut = qs("storyOutput");
    if (storyOut) storyOut.classList.remove("hidden");
    refreshEditor();
    qs("chapterEditor")?.classList.remove("hidden");
    if (typeof showView === "function") showView("creation");
  }

  async function showVersions() {
    if (!state.projectId) await autosave("version-view");
    const versions = (await NovelDB.getByIndex("versions", "projectId", state.projectId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const out = qs("integrityOutput") || qs("miniAiOutput");
    if (typeof showView === "function") showView("export");
    const box = out || qs("projectSlotList");
    if (!box) return;
    if (!versions.length) {
      box.textContent = "目前尚無版本紀錄。";
      return;
    }
    box.innerHTML = versions.map((version, index) => `
      <div class="version-item">
        <b>${version.label}</b>
        <p class="muted">${new Date(version.createdAt).toLocaleString()}｜${version.summary}</p>
        <div class="bar">
          <button onclick="NovelApp.previewVersion(${index})">預覽</button>
          <button class="btn green" onclick="NovelApp.restoreVersion(${index})">還原</button>
          <button class="btn red" onclick="NovelApp.deleteVersion('${version.id}')">刪除</button>
        </div>
      </div>
    `).join("");
    App.versionCache = versions;
  }

  function previewVersion(index) {
    const version = App.versionCache?.[index];
    if (!version) return;
    setMessage(`【版本預覽】\n${version.summary}\n\n${(version.chapters || []).join("\n\n" + "=".repeat(32) + "\n\n")}`);
  }

  async function restoreVersion(index) {
    const version = App.versionCache?.[index];
    if (!version) return;
    if (!confirm("確定還原這個版本？目前內容會先建立快照。")) return;
    await NovelDB.createVersion(state.projectId, "還原前快照", state, { reason: "before-restore" });
    state = { ...defaultState(), ...(version.state || {}) };
    if (typeof applyStateToForm === "function") applyStateToForm();
    if (typeof saveNovel === "function") saveNovel();
    if (typeof renderAll === "function") renderAll();
    await autosave("restore");
    alert("已還原版本。");
  }

  async function deleteVersion(id) {
    if (!confirm("確定刪除這個版本紀錄？")) return;
    await NovelDB.delete("versions", id);
    await showVersions();
  }

  async function startNewNovel() {
    if (state?.story?.length) await autosave("switch-before-new");
    if (typeof resetStory === "function" && confirm("開始新小說前會保留舊作品存檔。確定開始？")) {
      state = defaultState();
      if (typeof applyStateToForm === "function") applyStateToForm();
      if (typeof renderAll === "function") renderAll();
      if (typeof showView === "function") showView("creation");
    }
  }

  function toggleAdvancedTools() {
    document.body.classList.toggle("show-advanced-tools");
    alert("進階工具仍保留在左側選單；主要創作入口已放在首頁上方。");
  }

  function sanitizeExport(pack) {
    const clone = JSON.parse(JSON.stringify(pack || {}));
    const secretKeys = /token|api.?key|authorization|password|secret/i;
    function walk(obj) {
      if (!obj || typeof obj !== "object") return;
      Object.keys(obj).forEach((key) => {
        if (secretKeys.test(key)) delete obj[key];
        else walk(obj[key]);
      });
    }
    walk(clone);
    return clone;
  }

  async function exportFullJson() {
    if (!state.projectId) await autosave("export");
    const project = await NovelDB.get("projects", state.projectId);
    const chapters = await NovelDB.getByIndex("chapters", "projectId", state.projectId);
    const characters = await NovelDB.getByIndex("characters", "projectId", state.projectId);
    const worldSettings = await NovelDB.getByIndex("worldSettings", "projectId", state.projectId);
    const versions = await NovelDB.getByIndex("versions", "projectId", state.projectId);
    const payload = sanitizeExport({
      version: "offline-novel-system-v6",
      exportedAt: new Date().toISOString(),
      project,
      chapters,
      characters,
      worldSettings,
      versions,
      progress: { currentChapter: state.chapter, totalWords: totalWords(state.story) }
    });
    downloadBlob((state.title || "novel") + "_full_backup.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    setMessage("已匯出完整 JSON 備份，已排除 API Key、Token、Authorization 與密碼。");
  }

  async function importFullJson() {
    const raw = prompt("貼上完整 JSON 備份內容：");
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const project = data.project || data.state || {};
      const importedState = project.state || data.state || {};
      const nextProject = await NovelDB.put("projects", {
        ...project,
        id: project.id || NovelDB.safeId("project"),
        state: importedState,
        updatedAt: new Date().toISOString()
      });
      for (const chapter of data.chapters || []) await NovelDB.put("chapters", { ...chapter, projectId: nextProject.id });
      for (const character of data.characters || []) await NovelDB.put("characters", { ...character, projectId: nextProject.id });
      for (const world of data.worldSettings || []) await NovelDB.put("worldSettings", { ...world, projectId: nextProject.id });
      for (const version of data.versions || []) await NovelDB.put("versions", { ...version, id: NovelDB.safeId("version"), projectId: nextProject.id });
      state = { ...defaultState(), ...importedState, projectId: nextProject.id };
      if (typeof applyStateToForm === "function") applyStateToForm();
      if (typeof saveNovel === "function") saveNovel();
      if (typeof renderAll === "function") renderAll();
      await autosave("import");
      alert("JSON 匯入完成。");
    } catch (error) {
      setMessage(`JSON 格式錯誤或匯入失敗：${error.message || error}`, "error");
    }
  }

  function patchExistingFunctions() {
    App.originals.saveNovel = window.saveNovel;
    window.saveNovel = function patchedSaveNovel() {
      if (App.originals.saveNovel) App.originals.saveNovel();
      scheduleAutosave("legacy-save");
    };

    App.originals.manualSaveNovel = window.manualSaveNovel;
    window.manualSaveNovel = async function patchedManualSaveNovel() {
      if (typeof collectState === "function") collectState();
      if (App.originals.manualSaveNovel) App.originals.manualSaveNovel();
      await autosave("manual");
      setMessage(`已手動存檔：${state.title || "未命名小說"}｜${App.lastSavedAt}`);
    };

    App.originals.exportJSON = window.exportJSON;
    window.exportJSON = exportFullJson;
    window.importJSONPrompt = importFullJson;

    App.originals.createStory = window.createStory;
    window.createStory = function patchedCreateStory() {
      if (App.generating) return;
      if (App.originals.createStory) App.originals.createStory();
      refreshEditor();
      renderContinuePanel();
      scheduleAutosave("new-chapter");
    };

    App.originals.nextChapter = window.nextChapter;
    window.nextChapter = function patchedNextChapter(route) {
      if (App.generating) return;
      if (App.originals.nextChapter) App.originals.nextChapter(route || "A：主動追查");
      refreshEditor();
      renderContinuePanel();
      scheduleAutosave("new-chapter");
    };

    window.saveAiSettings = function patchedSaveAiSettings() {
      const cfg = {
        provider: qs("aiProvider")?.value || "chat",
        endpoint: qs("aiEndpoint")?.value || "",
        model: qs("aiModel")?.value || ""
      };
      localStorage.setItem("novel_external_ai_cfg", JSON.stringify(cfg));
      NovelAIService.saveSessionToken();
      alert("AI 連線設定已儲存；金鑰只暫存在本次瀏覽器工作階段。");
    };

    window.loadAiSettings = function patchedLoadAiSettings() {
      const raw = localStorage.getItem("novel_external_ai_cfg");
      if (!raw) return;
      try {
        const c = JSON.parse(raw);
        if (qs("aiProvider")) qs("aiProvider").value = c.provider || "chat";
        if (qs("aiEndpoint")) qs("aiEndpoint").value = c.endpoint || "";
        if (qs("aiModel")) qs("aiModel").value = c.model || "";
        if (qs("aiToken")) qs("aiToken").value = "";
        if (c.token) {
          localStorage.setItem("novel_external_ai_cfg", JSON.stringify({
            provider: c.provider || "chat",
            endpoint: c.endpoint || "",
            model: c.model || ""
          }));
        }
      } catch (error) {
        console.warn(error);
      }
    };

    window.askExternalAI = async function patchedAskExternalAI() {
      const out = qs("aiOutput");
      try {
        App.mode = "AI完整續寫";
        if (out) out.textContent = "AI完整續寫中...";
        await aiContinue();
        if (out) out.textContent = "AI完整續寫完成，內容已加入章節並保存。";
      } catch (error) {
        if (out) out.textContent = `連線失敗：${error.message || error}`;
      }
    };
  }

  function bindInputs() {
    document.addEventListener("input", (event) => {
      const target = event.target;
      if (!target || !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target.id === "aiToken") return;
      scheduleAutosave("input");
    });
    window.addEventListener("beforeunload", () => {
      try {
        if (typeof collectState === "function") collectState();
        localStorage.setItem("novel_platform_state", JSON.stringify(state));
      } catch (error) {
        console.warn(error);
      }
    });
    window.addEventListener("online", () => updateStatusBar());
    window.addEventListener("offline", () => updateStatusBar("目前離線，雲端 AI 已停用。"));
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      updateStatusBar("此瀏覽器不支援 Service Worker，離線重新開啟能力有限。");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
      if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    } catch (error) {
      updateStatusBar(`Service Worker 註冊失敗：${error.message || error}`);
    }
  }

  async function refreshModelStatus() {
    try {
      App.localModelStatus = await NovelAIService.checkLocalModel();
    } catch (error) {
      App.localModelStatus = "本機模型未連線";
    }
    updateStatusBar();
  }

  function addWarnings() {
    const exportView = qs("view-export");
    if (exportView && !qs("storageWarning")) {
      const warning = document.createElement("div");
      warning.id = "storageWarning";
      warning.className = "warning-box";
      warning.textContent = "作品主要儲存在目前瀏覽器。若清除網站資料、使用無痕模式、更換瀏覽器或更換裝置，作品可能消失，請定期下載JSON備份。";
      exportView.insertBefore(warning, exportView.children[1] || null);
    }
    const aiToken = qs("aiToken");
    if (aiToken && !qs("clearAiTokenBtn")) {
      aiToken.insertAdjacentHTML("afterend", '<div class="bar"><button id="clearAiTokenBtn" class="btn red" onclick="alert(NovelAIService.clearToken())">清除金鑰</button><span class="muted">金鑰預設只保存於本次瀏覽器工作階段，不會匯出到 JSON。</span></div>');
    }
  }

  function renameLabels() {
    document.querySelectorAll("button,[data-view]").forEach((el) => {
      if (el.textContent.trim() === "小型閉端AI") el.textContent = "離線創作助理／本機AI";
      if (el.textContent.trim() === "雲端借閱書庫") el.textContent = "故事靈感書庫";
    });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (node.nodeValue.includes("全部離線生成")) {
        node.nodeValue = node.nodeValue.replaceAll(
          "全部離線生成",
          "故事規劃、作品管理與規則式續寫可離線使用；完整AI生成可使用雲端AI或本機模型。"
        );
      }
    });
  }

  async function init() {
    ensureStatusBar();
    renameLabels();
    patchExistingFunctions();
    if (typeof window.loadAiSettings === "function") window.loadAiSettings();
    ensureContinuePanel();
    ensureHomeEntrances();
    ensureContinueButtons();
    ensureEditor();
    addWarnings();
    bindInputs();
    await registerServiceWorker();
    await NovelDB.openDb();
    if (typeof state !== "undefined" && (state?.story?.length || state?.title)) await autosave("startup");
    await renderContinuePanel();
    refreshEditor();
    refreshModelStatus();
    setInterval(refreshModelStatus, 15000);
    updateStatusBar();
  }

  window.NovelApp = {
    offlineContinue,
    aiContinue,
    continueLastProject,
    readFullText,
    showVersions,
    previewVersion,
    restoreVersion,
    deleteVersion,
    startNewNovel,
    toggleAdvancedTools,
    exportFullJson,
    importFullJson,
    autosave,
    renderContinuePanel
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
