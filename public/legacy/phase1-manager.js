(function () {
  "use strict";

  const UI = {
    projectId: "",
    volumeId: "",
    chapterId: "",
    autosaveTimer: null,
    positionTimer: null,
    saving: false,
    pendingDraft: null,
    lastRestore: null,
    lastSaveAt: "",
    projects: [],
    volumes: [],
    chapters: []
  };

  const $ = (id) => document.getElementById(id);
  const textTime = () => new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
  const clamp = (num, min, max) => Math.max(min, Math.min(max, Number(num) || 0));
  const pct = (value, target) => target ? `${Math.min(100, Math.round((value / target) * 100))}%` : "尚未設定";
  const fmt = (num) => `${Number(num || 0).toLocaleString("zh-TW")}字`;
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const stageLabels = { opening: "開篇", development: "發展期", midpoint: "中段轉折", climax: "高潮", ending: "結局", unset: "尚未設定" };
  const chapterStatusLabels = { not_started: "尚未開始", draft: "草稿中", revision: "待修訂", done: "已完成", published: "已發布" };

  function normalizeProject(project = {}) {
    return {
      ...project,
      targetWords: project.targetWords ?? null,
      expectedChapters: project.expectedChapters ?? null,
      storyStage: project.storyStage || "development"
    };
  }

  function normalizeChapter(chapter = {}) {
    const content = chapter.content || "";
    const wordCount = chapter.wordCount ?? NovelDB.words(content);
    return {
      ...chapter,
      wordCount,
      chapterTargetWords: Number(chapter.chapterTargetWords || 3000),
      status: chapter.status || (wordCount ? "draft" : "not_started"),
      goal: chapter.goal || "",
      lastCursorPosition: Number.isFinite(Number(chapter.lastCursorPosition)) ? Number(chapter.lastCursorPosition) : content.length,
      lastScrollPosition: Number(chapter.lastScrollPosition || 0),
      lastSavedAt: chapter.lastSavedAt || chapter.updatedAt || ""
    };
  }

  function sortedChapters(chapters = []) {
    return [...chapters].sort((a, b) => (a.order || a.chapterNumber || 0) - (b.order || b.chapterNumber || 0));
  }

  function currentEditorPosition() {
    const content = $("phase1ChapterContent");
    if (!content) return { cursor: 0, scroll: 0 };
    return {
      cursor: clamp(content.selectionStart ?? content.value.length, 0, content.value.length),
      scroll: Math.max(0, Number(content.scrollTop || 0))
    };
  }

  async function getLastOpen() {
    const saved = await NovelDB.getSetting("last-open");
    return {
      lastProjectId: saved?.lastProjectId || localStorage.getItem("novel_last_project_id") || "",
      lastVolumeId: saved?.lastVolumeId || localStorage.getItem("novel_last_volume_id") || "",
      lastChapterId: saved?.lastChapterId || localStorage.getItem("novel_last_chapter_id") || "",
      lastCursorPosition: saved?.lastCursorPosition,
      lastScrollPosition: saved?.lastScrollPosition,
      lastOpenedAt: saved?.lastOpenedAt || ""
    };
  }

  async function saveLastOpen(extra = {}) {
    if (!UI.projectId) return;
    const position = currentEditorPosition();
    const value = {
      lastProjectId: UI.projectId,
      lastVolumeId: UI.volumeId || "",
      lastChapterId: UI.chapterId || "",
      lastCursorPosition: extra.lastCursorPosition ?? position.cursor,
      lastScrollPosition: extra.lastScrollPosition ?? position.scroll,
      lastOpenedAt: extra.lastOpenedAt || new Date().toISOString()
    };
    localStorage.setItem("novel_last_project_id", value.lastProjectId);
    localStorage.setItem("novel_last_volume_id", value.lastVolumeId);
    localStorage.setItem("novel_last_chapter_id", value.lastChapterId);
    await NovelDB.saveSetting("last-open", value);
  }

  function chooseResumeChapter(project, bundle, lastOpen) {
    const chapters = sortedChapters(bundle?.chapters || []).map(normalizeChapter);
    if (!chapters.length) return null;
    const last = lastOpen?.lastProjectId === project.id ? chapters.find((chapter) => chapter.id === lastOpen.lastChapterId) : null;
    return last || chapters.find((chapter) => chapter.id === project.currentChapterId) || chapters.at(-1);
  }

  function findPreviousChapter(chapterId) {
    const chapters = sortedChapters(UI.chapters);
    const index = chapters.findIndex((chapter) => chapter.id === chapterId);
    return index > 0 ? normalizeChapter(chapters[index - 1]) : null;
  }

  function shortText(text, limit = 160) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return value ? value.slice(0, limit) : "尚無";
  }

  async function recordWritingDelta(oldWords, newWords) {
    const delta = Number(newWords || 0) - Number(oldWords || 0);
    if (!delta) return;
    const key = `writing-progress-${todayKey()}`;
    const row = (await NovelDB.getSetting(key)) || { date: todayKey(), addedWords: 0, netWords: 0 };
    row.addedWords = Number(row.addedWords || 0) + Math.max(delta, 0);
    row.netWords = Number(row.netWords || 0) + delta;
    row.updatedAt = new Date().toISOString();
    await NovelDB.saveSetting(key, row);
  }

  async function readWritingWindow(days = 7) {
    const rows = [];
    for (let index = days - 1; index >= 0; index -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - index);
      const key = date.toISOString().slice(0, 10);
      rows.push((await NovelDB.getSetting(`writing-progress-${key}`)) || { date: key, addedWords: 0, netWords: 0 });
    }
    return rows;
  }

  async function findRecentProject() {
    const projects = (await NovelDB.getAll("projects")).map(normalizeProject);
    if (!projects.length) return null;
    const timeValue = (project, index) => {
      const value = project.updatedAt || project.lastSavedAt || project.state?.lastSavedAt || project.createdAt || "";
      const time = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(time) ? time : index;
    };
    return projects
      .map((project, index) => ({ project, score: timeValue(project, index), index }))
      .sort((a, b) => (b.score - a.score) || (b.index - a.index))[0].project;
  }

  function getLegacyState() {
    try {
      if (typeof state !== "undefined") return state;
    } catch (error) {
      return null;
    }
    return null;
  }

  function setLegacyState(next) {
    try {
      if (typeof state !== "undefined") {
        state = { ...defaultState(), ...next };
        if (typeof applyStateToForm === "function") applyStateToForm();
        if (typeof renderAll === "function") renderAll();
      }
    } catch (error) {
      console.warn("[phase1] legacy state sync failed", error);
    }
  }

  function updateSaveStatus(status, detail = "") {
    const box = $("phase1SaveStatus");
    if (box) box.textContent = `${status}${detail ? "｜" + detail : ""}`;
    const top = $("saveStatus");
    if (top) top.textContent = status.includes("失敗") ? status : `${status} ${textTime()}`;
  }

  function notify(message, type = "info") {
    const box = $("phase1SaveStatus") || $("phase1MigrationStatus");
    if (box) box.textContent = message;
    if (type === "error") console.error(message);
  }

  function confirmSafe(message) {
    try {
      return window.confirm(message);
    } catch (error) {
      notify(`需要確認：${message}`, "error");
      return false;
    }
  }

  function hideSection(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("hidden");
    el.style.display = "none";
  }

  function showSection(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("hidden");
    el.style.display = "";
  }

  async function syncLegacyFromProject(projectId, chapterId = "") {
    const project = await NovelDB.loadProject(projectId);
    if (!project) return;
    const bundle = await NovelDB.listProjectBundle(projectId);
    const currentChapter = bundle.chapters.find((chapter) => chapter.id === chapterId) || bundle.chapters.at(-1);
    setLegacyState({
      ...project,
      title: project.title,
      genre: project.genre,
      styleMode: project.style || project.styleMode || "",
      coreIdea: project.synopsis || project.coreIdea || "",
      story: bundle.chapters.map((chapter) => chapter.content),
      currentChapterId: currentChapter?.id || "",
      currentVolumeId: currentChapter?.volumeId || project.currentVolumeId || ""
    });
  }

  function ensureShell() {
    if ($("phase1Panel")) return;
    const creation = $("view-creation");
    if (!creation) return;

    const panel = document.createElement("section");
    panel.id = "phase1Panel";
    panel.className = "phase1-panel";
    panel.innerHTML = `
      <div class="phase1-home-card" id="phase1ContinueCard"></div>
      <div class="phase1-entry-grid" aria-label="首頁主要入口">
        <button class="phase1-entry-card phase1-entry-primary" onclick="Phase1Novel.openLatestForWriting()">
          <b>繼續上次創作</b><span>直接回到最近作品的最新章節</span>
        </button>
        <button class="phase1-entry-card" onclick="Phase1Novel.showNewWork()">
          <b>建立新作品</b><span>打開分類包、故事種子與第一章工具</span>
        </button>
        <button class="phase1-entry-card" onclick="Phase1Novel.showMyWorks()">
          <b>我的作品</b><span>查看、切換與管理已存作品</span>
        </button>
        <button class="phase1-entry-card" onclick="Phase1Novel.showInspiration()">
          <b>靈感探索</b><span>分類書庫、熱門搜尋、角色與文風</span>
        </button>
        <button class="phase1-entry-card" onclick="Phase1Novel.toggleAdvanced()">
          <b>進階工具</b><span>顯示原有進階功能與工具頁</span>
        </button>
      </div>
      <div class="phase1-warning">作品主要儲存在目前瀏覽器。若清除網站資料、使用無痕模式、更換瀏覽器或更換裝置，作品可能消失，請定期下載JSON備份。</div>
      <div id="phase1MyWorks" class="phase1-card hidden"></div>
      <textarea id="phase1ImportJson" class="hidden" placeholder="貼上 JSON 備份後按「匯入備份」。"></textarea>
      <div class="phase1-toolbar hidden" id="phase1UtilityTools">
        <button onclick="Phase1Novel.importBackup()">匯入備份</button>
        <button onclick="Phase1Novel.runMigration(true)">遷移舊資料</button>
      </div>
      <div class="phase1-grid hidden" id="phase1Manager">
        <div class="phase1-card">
          <h3>作品 / 分卷 / 章節</h3>
          <label>新作品名稱 / 編輯作品名稱</label>
          <input id="phase1ProjectTitleInput" placeholder="輸入作品名稱">
          <label>作品簡介</label>
          <textarea id="phase1ProjectSynopsisInput" placeholder="輸入作品簡介，可留空"></textarea>
          <label>作品</label>
          <select id="phase1ProjectSelect" onchange="Phase1Novel.selectProject(this.value)"></select>
          <div class="bar">
            <button onclick="Phase1Novel.editProject()">編輯作品</button>
            <button class="btn red" onclick="Phase1Novel.deleteProject()">刪除作品</button>
          </div>
          <label>分卷</label>
          <input id="phase1VolumeTitleInput" placeholder="新增或編輯分卷名稱">
          <input id="phase1VolumeDescInput" placeholder="分卷簡介，可留空">
          <select id="phase1VolumeSelect" onchange="Phase1Novel.selectVolume(this.value)"></select>
          <div class="bar">
            <button onclick="Phase1Novel.createVolume()">新增分卷</button>
            <button onclick="Phase1Novel.editVolume()">編輯分卷</button>
            <button class="btn red" onclick="Phase1Novel.deleteVolume()">刪除分卷</button>
          </div>
          <label>章節</label>
          <input id="phase1NewChapterTitleInput" placeholder="新增或編輯章節標題">
          <select id="phase1ChapterSelect" onchange="Phase1Novel.selectChapter(this.value)"></select>
          <div class="bar">
            <button onclick="Phase1Novel.createChapter()">新增章節</button>
            <button onclick="Phase1Novel.editChapterMeta()">編輯章名</button>
            <button onclick="Phase1Novel.moveChapter(-1)">上移</button>
            <button onclick="Phase1Novel.moveChapter(1)">下移</button>
            <button class="btn red" onclick="Phase1Novel.deleteChapter()">刪除章節</button>
          </div>
          <div id="phase1MigrationStatus" class="notice"></div>
        </div>
        <div class="phase1-card phase1-editor-card">
          <h3>章節正文</h3>
          <input id="phase1ChapterTitle" placeholder="章節標題" oninput="Phase1Novel.scheduleSave()">
          <textarea id="phase1ChapterContent" placeholder="在這裡寫正文，輸入後 1 秒自動存檔。" oninput="Phase1Novel.scheduleSave()" onkeyup="Phase1Novel.capturePosition()" onclick="Phase1Novel.capturePosition()" onscroll="Phase1Novel.capturePosition()"></textarea>
          <div class="bar">
            <button class="btn green" onclick="Phase1Novel.saveCurrentChapter('manual')">儲存目前作品</button>
            <button onclick="Phase1Novel.showVersions()">版本列表</button>
            <button onclick="Phase1Novel.exportCurrentProject()">匯出作品JSON</button>
          </div>
          <div id="phase1SaveStatus" class="notice">尚未儲存</div>
        </div>
        <div class="phase1-card phase1-progress-card" id="phase1ProgressPanel"></div>
      </div>
      <div class="phase1-grid hidden" id="phase1AssistTools">
        <div class="phase1-card">
          <h3>離線故事續寫</h3>
          <label>本章目標</label>
          <input id="phase1NextGoal" placeholder="例如：逼出反派下一步、回收上一章伏筆">
          <label>尚未處理衝突</label>
          <input id="phase1Conflict" placeholder="例如：主角身分快被識破">
          <div class="bar">
            <button class="btn green" onclick="Phase1Novel.previewOfflineContinue()">離線故事續寫（先預覽）</button>
            <button onclick="Phase1Novel.regenerateOffline()">重新產生</button>
            <button onclick="Phase1Novel.applyOfflineDraft()">套用到新章節</button>
            <button onclick="Phase1Novel.discardOfflineDraft()">放棄</button>
          </div>
          <div id="phase1DraftPreview" class="out">尚未產生續寫預覽。</div>
        </div>
        <div class="phase1-card">
          <h3>AI續寫</h3>
          <p class="muted">雲端AI需要網路；Ollama / LM Studio 可使用本機模型。失敗時不會覆蓋原文，也不會建立空白章節。</p>
          <div id="phase1AiStatus" class="notice">尚未設定</div>
          <div class="bar">
            <button id="phase1CloudAiButton" class="btn gold" onclick="Phase1Novel.aiContinue()">AI續寫（新章預覽）</button>
            <button onclick="NovelAIService.clearToken();Phase1Novel.refreshNetworkStatus()">清除金鑰</button>
          </div>
        </div>
      </div>
      <div id="phase1VersionPanel" class="phase1-card hidden"></div>
    `;
    creation.insertBefore(panel, creation.children[1] || null);
    organizeCreationView();
  }

  function organizeCreationView() {
    const creation = $("view-creation");
    if (!creation) return;
    const oldContinue = $("continuePanel");
    if (oldContinue) oldContinue.classList.add("hidden");
    const heading = creation.querySelector("h2");
    if (heading) heading.textContent = "小說創作首頁";
    const legacySplit = creation.querySelector(":scope > .split");
    if (legacySplit && !$("phase1NewWorkArea")) {
      const intro = document.createElement("div");
      intro.id = "phase1NewWorkIntro";
      intro.className = "phase1-card hidden";
      intro.innerHTML = "<h2>建立新作品</h2><p class=\"muted\">此區用於建立新的小說，不會修改既有作品。</p>";
      legacySplit.id = "phase1NewWorkArea";
      legacySplit.classList.add("hidden", "phase1-new-work-area");
      legacySplit.style.display = "none";
      legacySplit.parentNode.insertBefore(intro, legacySplit);
    }
    hideSection("phase1Manager");
    hideSection("phase1AssistTools");
    hideSection("phase1NewWorkIntro");
    hideSection("phase1NewWorkArea");
    hideSection("phase1MyWorks");
    hideSection("phase1UtilityTools");
  }

  function simplifyNavigation() {
    document.body.classList.add("phase1-home-ia");
    document.querySelectorAll(".nav .navTitle").forEach((title) => {
      title.classList.add("phase1-sidebar-heading");
      title.setAttribute("aria-hidden", "true");
    });
    document.querySelectorAll(".nav button[data-view]").forEach((button) => {
      button.classList.remove("phase1-advanced-nav");
    });
    const creationButton = document.querySelector('.nav button[data-view="creation"]');
    if (creationButton) {
      creationButton.textContent = "繼續上次創作";
      creationButton.onclick = (event) => {
        event.preventDefault();
        openLatestForWriting();
      };
      if (!$("phase1NewWorkNavButton")) {
        const newWorkButton = document.createElement("button");
        newWorkButton.id = "phase1NewWorkNavButton";
        newWorkButton.type = "button";
        newWorkButton.textContent = "建立新作品";
        newWorkButton.onclick = (event) => {
          event.preventDefault();
          showNewWork();
        };
        creationButton.insertAdjacentElement("afterend", newWorkButton);
      }
    }
    const exportButton = document.querySelector('.nav button[data-view="export"]');
    if (exportButton) exportButton.textContent = "我的作品";
  }

  function bindPhase1NavigationGuard() {
    if (document.body.dataset.phase1NavGuard === "1") return;
    document.body.dataset.phase1NavGuard = "1";
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const label = button.textContent.trim();
      const isPrimaryNav = button.closest(".nav") || button.closest(".bottomNav") || button.id === "phase1NewWorkNavButton";
      if (!isPrimaryNav) return;
      if (label === "繼續上次創作") {
        event.preventDefault();
        event.stopImmediatePropagation();
        openLatestForWriting();
      }
      if (label === "建立新作品") {
        event.preventDefault();
        event.stopImmediatePropagation();
        showNewWork();
      }
    }, true);
  }

  function toggleAdvanced() {
    document.body.classList.toggle("phase1-show-advanced");
    if (document.body.classList.contains("phase1-show-advanced")) showSection("phase1UtilityTools");
    else hideSection("phase1UtilityTools");
  }

  async function loadLists() {
    const lastOpen = await getLastOpen();
    UI.projects = (await NovelDB.getAll("projects")).map(normalizeProject).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    if (!UI.projectId) UI.projectId = lastOpen.lastProjectId || UI.projects[0]?.id || "";
    if (UI.projectId) {
      UI.volumes = (await NovelDB.getByIndex("volumes", "projectId", UI.projectId)).sort((a, b) => a.order - b.order);
      if (!UI.volumes.length) UI.volumes = [await NovelDB.defaultVolume(UI.projectId)];
      if (!UI.volumeId || !UI.volumes.some((volume) => volume.id === UI.volumeId)) {
        const savedVolume = lastOpen.lastProjectId === UI.projectId ? UI.volumes.find((volume) => volume.id === lastOpen.lastVolumeId) : null;
        UI.volumeId = savedVolume?.id || UI.volumes[0]?.id || "";
      }
      UI.chapters = sortedChapters(await NovelDB.getByIndex("chapters", "projectId", UI.projectId)).map(normalizeChapter);
      if (UI.volumeId) {
        const inVolume = UI.chapters.filter((chapter) => chapter.volumeId === UI.volumeId);
        if (!UI.chapterId || !inVolume.some((chapter) => chapter.id === UI.chapterId)) {
          const resume = lastOpen.lastProjectId === UI.projectId ? inVolume.find((chapter) => chapter.id === lastOpen.lastChapterId) : null;
          UI.chapterId = resume?.id || inVolume[0]?.id || UI.chapters[0]?.id || "";
        }
      }
    } else {
      UI.volumes = [];
      UI.chapters = [];
      UI.volumeId = "";
      UI.chapterId = "";
    }
  }

  function renderSelects() {
    const projectSelect = $("phase1ProjectSelect");
    const volumeSelect = $("phase1VolumeSelect");
    const chapterSelect = $("phase1ChapterSelect");
    if (!projectSelect || !volumeSelect || !chapterSelect) return;
    projectSelect.innerHTML = UI.projects.map((project) => `<option value="${project.id}">${esc(project.title)}｜${project.currentChapter || 0}章</option>`).join("") || "<option value=''>尚未建立作品</option>";
    projectSelect.value = UI.projectId;
    volumeSelect.innerHTML = UI.volumes.map((volume) => `<option value="${volume.id}">${esc(volume.title)}</option>`).join("") || "<option value=''>尚無分卷</option>";
    volumeSelect.value = UI.volumeId;
    const chapters = UI.chapters.filter((chapter) => !UI.volumeId || chapter.volumeId === UI.volumeId);
    chapterSelect.innerHTML = chapters.map((chapter) => `<option value="${chapter.id}">${chapter.order}. ${esc(chapter.title)}</option>`).join("") || "<option value=''>尚無章節</option>";
    chapterSelect.value = UI.chapterId;
    const selectedProject = UI.projects.find((project) => project.id === UI.projectId);
    const selectedVolume = UI.volumes.find((volume) => volume.id === UI.volumeId);
    const selectedChapter = UI.chapters.find((chapter) => chapter.id === UI.chapterId);
    if ($("phase1ProjectTitleInput")) $("phase1ProjectTitleInput").value = selectedProject?.title || "";
    if ($("phase1ProjectSynopsisInput")) $("phase1ProjectSynopsisInput").value = selectedProject?.synopsis || "";
    if ($("phase1VolumeTitleInput")) $("phase1VolumeTitleInput").value = selectedVolume?.title || "";
    if ($("phase1VolumeDescInput")) $("phase1VolumeDescInput").value = selectedVolume?.description || "";
    if ($("phase1NewChapterTitleInput")) $("phase1NewChapterTitleInput").value = selectedChapter?.title || "";
  }

  async function renderContinueCard() {
    const box = $("phase1ContinueCard");
    if (!box) return;
    try {
      const rawProject = await findRecentProject();
      if (!rawProject) {
        box.innerHTML = `
          <div class="phase1-continue-layout">
            <div>
              <h2>繼續上次創作</h2>
              <p class="muted">尚未建立作品。</p>
              <button class="btn green" onclick="Phase1Novel.showNewWork()">建立第一部小說</button>
            </div>
          </div>`;
        return;
      }
      const project = normalizeProject(rawProject);
      const bundle = await NovelDB.listProjectBundle(project.id);
      if (!bundle) throw new Error("作品資料讀取失敗。");
      const lastOpen = await getLastOpen();
      const chapters = sortedChapters(bundle.chapters).map(normalizeChapter);
      const latest = chooseResumeChapter(project, bundle, lastOpen);
      const recentEditedAt = project.updatedAt || project.lastSavedAt || project.state?.lastSavedAt || project.createdAt || "";
      const latestSavedAt = latest?.lastSavedAt || project.lastSavedAt || project.state?.lastSavedAt || project.updatedAt || "";
      box.innerHTML = `
        <div class="phase1-continue-layout">
          <div class="phase1-continue-main">
            <p class="phase1-eyebrow">最近作品</p>
            <h2>繼續上次創作</h2>
            <h3>${esc(project.title || "未命名小說")}</h3>
            <div class="continue-grid">
              <div class="continue-stat"><b>最近作品名稱</b>${esc(project.title || "未命名小說")}</div>
              <div class="continue-stat"><b>最近編輯時間</b>${recentEditedAt ? new Date(recentEditedAt).toLocaleString("zh-TW") : "未知"}</div>
              <div class="continue-stat"><b>目前章節名稱</b>${esc(latest?.title || "尚未建立章節")}</div>
              <div class="continue-stat"><b>目前章數</b>${chapters.length || project.currentChapter || 0}</div>
              <div class="continue-stat"><b>總字數</b>${fmt(project.totalWords || 0)}</div>
              <div class="continue-stat"><b>最後存檔時間</b>${latestSavedAt ? new Date(latestSavedAt).toLocaleString("zh-TW") : "尚未儲存"}</div>
            </div>
            <div class="bar">
              <button class="btn green" onclick="Phase1Novel.openLatestForWriting()">繼續寫作</button>
              <button onclick="Phase1Novel.readProject('${project.id}')">閱讀作品</button>
              <button onclick="Phase1Novel.focusManager('${project.id}')">作品管理</button>
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      console.warn("[phase1] recent project read failed", error);
      box.innerHTML = `<h2>繼續上次創作</h2><div class="warning-box">無法讀取最近作品，但原有作品資料不會被刪除。請前往作品存檔槽重新載入。</div>`;
    }
  }

  async function renderProgressPanel() {
    const panel = $("phase1ProgressPanel");
    if (!panel) return;
    const project = normalizeProject(UI.projects.find((item) => item.id === UI.projectId));
    const chapter = normalizeChapter(UI.chapters.find((item) => item.id === UI.chapterId));
    if (!project?.id || !chapter?.id) {
      panel.innerHTML = `<h3>寫作進度</h3><p class="muted">尚未選擇作品或章節。</p>`;
      return;
    }
    const previous = findPreviousChapter(chapter.id);
    const targetWords = Number(project.targetWords || 0);
    const chapterTarget = Number(chapter.chapterTargetWords || 3000);
    const weekly = await readWritingWindow(7);
    const today = weekly.at(-1) || { addedWords: 0, netWords: 0 };
    const weekAdded = weekly.reduce((sum, row) => sum + Number(row.addedWords || 0), 0);
    const weekNet = weekly.reduce((sum, row) => sum + Number(row.netWords || 0), 0);
    const bookPercent = targetWords ? Math.min(100, Math.round(((project.totalWords || 0) / targetWords) * 100)) : 0;
    const chapterPercent = chapterTarget ? Math.min(100, Math.round(((chapter.wordCount || 0) / chapterTarget) * 100)) : 0;
    panel.innerHTML = `
      <h3>寫作進度</h3>
      <div class="phase1-progress-meta">
        <label>全書目標字數</label>
        <input id="phase1TargetWords" type="number" min="0" placeholder="尚未設定" value="${targetWords || ""}">
        <label>預計總章數</label>
        <input id="phase1ExpectedChapters" type="number" min="0" placeholder="可留空" value="${project.expectedChapters || ""}">
        <label>目前故事階段</label>
        <select id="phase1StoryStage">
          ${Object.entries(stageLabels).map(([value, label]) => `<option value="${value}" ${value === project.storyStage ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <label>本章目標字數</label>
        <input id="phase1ChapterTargetWords" type="number" min="500" value="${chapterTarget}">
        <label>章節狀態</label>
        <select id="phase1ChapterStatus">
          ${Object.entries(chapterStatusLabels).map(([value, label]) => `<option value="${value}" ${value === chapter.status ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <label>本章目標</label>
        <textarea id="phase1ChapterGoal" placeholder="例如：讓主角做出選擇，推進反派壓迫。">${esc(chapter.goal || "")}</textarea>
        <button onclick="Phase1Novel.saveProgressSettings()">儲存進度設定</button>
      </div>
      <div class="phase1-progress-block">
        <b>全書完成度</b>
        <span>${fmt(project.totalWords || 0)} / ${targetWords ? fmt(targetWords) : "尚未設定全書字數目標"}</span>
        <div class="phase1-progress-meter"><i style="width:${bookPercent}%"></i></div>
        <small>${targetWords ? `${bookPercent}%` : "可在上方設定全書字數目標"}｜已完成 ${UI.chapters.length} 章${project.expectedChapters ? ` / 預計 ${project.expectedChapters} 章` : ""}</small>
      </div>
      <div class="phase1-progress-block">
        <b>章節完成度</b>
        <span>${fmt(chapter.wordCount || 0)} / ${fmt(chapterTarget)}</span>
        <div class="phase1-progress-meter"><i style="width:${chapterPercent}%"></i></div>
        <small>${chapterPercent}%｜${chapterStatusLabels[chapter.status] || "草稿中"}</small>
      </div>
      <div class="continue-grid phase1-progress-stats">
        <div class="continue-stat"><b>今日新增</b>${fmt(today.addedWords)}</div>
        <div class="continue-stat"><b>今日淨增加</b>${fmt(today.netWords)}</div>
        <div class="continue-stat"><b>本週新增</b>${fmt(weekAdded)}</div>
        <div class="continue-stat"><b>本週淨增加</b>${fmt(weekNet)}</div>
      </div>
      <div class="phase1-context-box">
        <b>上一章摘要</b>
        <p>${esc(previous?.summary || shortText(previous?.content) || "沒有上一章")}</p>
        <b>本章未完成狀態</b>
        <p>${chapter.status === "done" || chapter.status === "published" ? "此章已標記完成。" : `尚未完成，距離本章目標約 ${fmt(Math.max(0, chapterTarget - (chapter.wordCount || 0)))}`}</p>
        <b>最後存檔時間</b>
        <p>${chapter.lastSavedAt ? new Date(chapter.lastSavedAt).toLocaleString("zh-TW") : "尚未儲存"}</p>
      </div>
    `;
  }

  async function renderEditor() {
    const title = $("phase1ChapterTitle");
    const content = $("phase1ChapterContent");
    if (!title || !content) return;
    const chapter = normalizeChapter(UI.chapters.find((item) => item.id === UI.chapterId));
    title.value = chapter?.title || "";
    content.value = chapter?.content || "";
    if (chapter?.id && UI.lastRestore?.chapterId === chapter.id) {
      const cursor = clamp(UI.lastRestore.cursor ?? chapter.lastCursorPosition, 0, content.value.length);
      const scroll = Math.max(0, Number((UI.lastRestore.scroll ?? chapter.lastScrollPosition) || 0));
      requestAnimationFrame(() => {
        content.focus();
        content.setSelectionRange(cursor, cursor);
        content.scrollTop = scroll;
      });
      UI.lastRestore = null;
    }
    updateSaveStatus(chapter ? "已載入" : "尚未選擇章節", chapter ? `最後更新 ${new Date(chapter.updatedAt).toLocaleTimeString("zh-TW")}` : "");
    await renderProgressPanel();
    if (UI.projectId) await syncLegacyFromProject(UI.projectId, UI.chapterId);
  }

  async function refresh() {
    ensureShell();
    await loadLists();
    renderSelects();
    await renderContinueCard();
    await renderEditor();
    refreshNetworkStatus();
    const migration = $("phase1MigrationStatus");
    if (migration && window.NovelMigration) migration.textContent = await NovelMigration.migrationStatus();
  }

  async function createProject() {
    const title = $("phase1ProjectTitleInput")?.value.trim() || "未命名長篇小說";
    const synopsis = $("phase1ProjectSynopsisInput")?.value.trim() || "";
    const project = await NovelDB.put("projects", {
      id: NovelDB.safeId("project"),
      title,
      synopsis: synopsis || "",
      genre: $("genre")?.value || "",
      style: $("styleMode")?.value || "",
      status: "writing",
      totalWords: 0,
      targetWords: null,
      expectedChapters: null,
      storyStage: "development",
      currentVolumeId: "",
      currentChapterId: "",
      createdAt: NovelDB.now(),
      updatedAt: NovelDB.now(),
      state: {}
    });
    const volume = await NovelDB.defaultVolume(project.id);
    await NovelDB.put("projects", { ...project, currentVolumeId: volume.id, updatedAt: NovelDB.now() });
    UI.projectId = project.id;
    UI.volumeId = volume.id;
    UI.chapterId = "";
    UI.chapters = [];
    await createChapter("第一章", "");
    await saveLastOpen({ lastCursorPosition: 0, lastScrollPosition: 0 });
    await refresh();
  }

  async function editProject() {
    const project = UI.projects.find((item) => item.id === UI.projectId);
    if (!project) return notify("請先選擇作品。", "error");
    const title = $("phase1ProjectTitleInput")?.value.trim() || project.title;
    const synopsis = $("phase1ProjectSynopsisInput")?.value.trim() || project.synopsis || "";
    await NovelDB.put("projects", { ...project, title, synopsis: synopsis || "", updatedAt: NovelDB.now() });
    await refresh();
  }

  async function deleteProject() {
    const project = UI.projects.find((item) => item.id === UI.projectId);
    if (!project) return;
    if (!confirmSafe(`確定刪除作品「${project.title}」？此動作會刪除分卷、章節與版本。`)) return;
    if (!confirmSafe("再次確認：刪除後只能靠 JSON 備份恢復。確定刪除？")) return;
    await NovelDB.deleteProject(project.id);
    UI.projectId = "";
    UI.volumeId = "";
    UI.chapterId = "";
    await refresh();
  }

  async function selectProject(id) {
    await saveCurrentChapter("switch-project", false);
    UI.projectId = id;
    UI.volumeId = "";
    UI.chapterId = "";
    localStorage.setItem("novel_last_project_id", id);
    await saveLastOpen();
    await refresh();
    if (typeof showView === "function") showView("creation");
  }

  async function openLatestForWriting() {
    const rawProject = await findRecentProject();
    if (!rawProject) return showNewWork();
    const project = normalizeProject(rawProject);
    UI.projectId = project.id;
    const bundle = await NovelDB.listProjectBundle(project.id);
    const lastOpen = await getLastOpen();
    const latest = chooseResumeChapter(project, bundle, lastOpen);
    UI.volumeId = latest?.volumeId || project.currentVolumeId || "";
    UI.chapterId = latest?.id || project.currentChapterId || "";
    UI.lastRestore = latest ? {
      chapterId: latest.id,
      cursor: lastOpen.lastProjectId === project.id && lastOpen.lastChapterId === latest.id ? lastOpen.lastCursorPosition : latest.lastCursorPosition,
      scroll: lastOpen.lastProjectId === project.id && lastOpen.lastChapterId === latest.id ? lastOpen.lastScrollPosition : latest.lastScrollPosition
    } : null;
    await saveLastOpen({ lastCursorPosition: UI.lastRestore?.cursor || 0, lastScrollPosition: UI.lastRestore?.scroll || 0 });
    await refresh();
    showSection("phase1Manager");
    showSection("phase1AssistTools");
    hideSection("phase1NewWorkArea");
    hideSection("phase1NewWorkIntro");
    hideSection("phase1MyWorks");
    if (!latest) {
      notify("此作品尚未建立章節，請先建立第一章。");
      $("phase1NewChapterTitleInput")?.focus();
    }
  }

  async function createVolume() {
    if (!UI.projectId) return notify("請先建立作品。", "error");
    const title = $("phase1VolumeTitleInput")?.value.trim() || `第${UI.volumes.length + 1}卷`;
    const description = $("phase1VolumeDescInput")?.value.trim() || "";
    const volume = await NovelDB.put("volumes", {
      id: NovelDB.safeId("volume"),
      projectId: UI.projectId,
      title,
      description: description || "",
      order: UI.volumes.length + 1,
      createdAt: NovelDB.now(),
      updatedAt: NovelDB.now()
    });
    UI.volumeId = volume.id;
    await refresh();
  }

  async function editVolume() {
    const volume = UI.volumes.find((item) => item.id === UI.volumeId);
    if (!volume) return;
    const title = $("phase1VolumeTitleInput")?.value.trim() || volume.title;
    const description = $("phase1VolumeDescInput")?.value.trim() || volume.description || "";
    await NovelDB.put("volumes", { ...volume, title, description: description || "", updatedAt: NovelDB.now() });
    await refresh();
  }

  async function deleteVolume() {
    const volume = UI.volumes.find((item) => item.id === UI.volumeId);
    if (!volume) return;
    const chapters = UI.chapters.filter((chapter) => chapter.volumeId === volume.id);
    if (chapters.length) return notify("此分卷仍有章節。請先移動或刪除章節。", "error");
    if (!confirmSafe(`確定刪除分卷「${volume.title}」？`)) return;
    await NovelDB.delete("volumes", volume.id);
    UI.volumeId = "";
    await refresh();
  }

  async function selectVolume(id) {
    await saveCurrentChapter("switch-volume", false);
    UI.volumeId = id;
    UI.chapterId = "";
    await saveLastOpen();
    await refresh();
  }

  async function createChapter(defaultTitle = "", defaultContent = "") {
    if (!UI.projectId) return notify("請先建立作品。", "error");
    if (!UI.volumeId) UI.volumeId = (await NovelDB.defaultVolume(UI.projectId)).id;
    const requestedTitle = defaultTitle || $("phase1NewChapterTitleInput")?.value.trim() || "";
    if (UI.chapterId) await saveCurrentChapter("before-create-chapter", false);
    const projectChapters = await NovelDB.getByIndex("chapters", "projectId", UI.projectId);
    const order = projectChapters.reduce((max, chapter) => Math.max(max, chapter.order || chapter.chapterNumber || 0), 0) + 1;
    const title = requestedTitle || `第${order}章`;
    const chapter = await NovelDB.put("chapters", {
      id: NovelDB.safeId("chapter"),
      projectId: UI.projectId,
      volumeId: UI.volumeId,
      title,
      content: defaultContent || `# ${title}\n\n`,
      summary: "",
      hook: "",
      wordCount: NovelDB.words(defaultContent || ""),
      chapterTargetWords: 3000,
      status: defaultContent ? "draft" : "not_started",
      goal: "",
      lastCursorPosition: NovelDB.words(defaultContent || "") ? (defaultContent || "").length : 0,
      lastScrollPosition: 0,
      lastSavedAt: NovelDB.now(),
      order,
      chapterNumber: order,
      createdAt: NovelDB.now(),
      updatedAt: NovelDB.now(),
      version: 1
    });
    UI.chapterId = chapter.id;
    await updateProjectTotals(UI.projectId);
    await saveLastOpen({ lastCursorPosition: chapter.lastCursorPosition, lastScrollPosition: 0 });
    await refresh();
    return chapter;
  }

  async function selectChapter(id) {
    await saveCurrentChapter("switch-chapter", false);
    UI.chapterId = id;
    localStorage.setItem("novel_last_chapter_id", id);
    const chapter = UI.chapters.find((item) => item.id === id);
    UI.volumeId = chapter?.volumeId || UI.volumeId;
    UI.lastRestore = chapter ? { chapterId: id, cursor: chapter.lastCursorPosition, scroll: chapter.lastScrollPosition } : null;
    await saveLastOpen({ lastCursorPosition: UI.lastRestore?.cursor || 0, lastScrollPosition: UI.lastRestore?.scroll || 0 });
    await refresh();
  }

  async function editChapterMeta() {
    const chapter = UI.chapters.find((item) => item.id === UI.chapterId);
    if (!chapter) return;
    const title = $("phase1NewChapterTitleInput")?.value.trim() || $("phase1ChapterTitle")?.value.trim() || chapter.title;
    await NovelDB.put("chapters", { ...chapter, title, updatedAt: NovelDB.now() });
    await updateProjectTotals(UI.projectId);
    await refresh();
  }

  async function deleteChapter() {
    const chapter = UI.chapters.find((item) => item.id === UI.chapterId);
    if (!chapter) return;
    if (!confirmSafe(`確定刪除章節「${chapter.title}」？`)) return;
    if (!confirmSafe("再次確認：此章節刪除後只能靠版本或備份恢復。")) return;
    await NovelDB.delete("chapters", chapter.id);
    UI.chapterId = "";
    await normalizeChapterOrders(UI.projectId);
    await updateProjectTotals(UI.projectId);
    await refresh();
  }

  async function moveChapter(direction) {
    const list = [...UI.chapters].sort((a, b) => a.order - b.order);
    const index = list.findIndex((chapter) => chapter.id === UI.chapterId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    await NovelDB.put("chapters", { ...a, order: b.order, chapterNumber: b.order, updatedAt: NovelDB.now() });
    await NovelDB.put("chapters", { ...b, order: a.order, chapterNumber: a.order, updatedAt: NovelDB.now() });
    await refresh();
  }

  async function normalizeChapterOrders(projectId) {
    const chapters = (await NovelDB.getByIndex("chapters", "projectId", projectId)).sort((a, b) => (a.order || 0) - (b.order || 0));
    for (let i = 0; i < chapters.length; i += 1) {
      await NovelDB.put("chapters", { ...chapters[i], order: i + 1, chapterNumber: i + 1 });
    }
  }

  async function updateProjectTotals(projectId) {
    const project = normalizeProject(await NovelDB.get("projects", projectId));
    if (!project.id) return;
    const chapters = sortedChapters(await NovelDB.getByIndex("chapters", "projectId", projectId)).map(normalizeChapter);
    const current = chapters.find((chapter) => chapter.id === UI.chapterId) || chapters.at(-1);
    const story = chapters.map((chapter) => chapter.content);
    await NovelDB.put("projects", {
      ...project,
      totalWords: chapters.reduce((sum, chapter) => sum + (chapter.wordCount || NovelDB.words(chapter.content)), 0),
      currentChapter: chapters.length,
      currentVolumeId: current?.volumeId || project.currentVolumeId || "",
      currentChapterId: current?.id || "",
      updatedAt: NovelDB.now(),
      state: NovelDB.sanitizeState({ ...(project.state || {}), projectId, title: project.title, story, currentVolumeId: current?.volumeId || "", currentChapterId: current?.id || "" })
    });
  }

  async function capturePosition() {
    if (!UI.chapterId) return;
    const position = currentEditorPosition();
    localStorage.setItem("novel_last_project_id", UI.projectId || "");
    localStorage.setItem("novel_last_volume_id", UI.volumeId || "");
    localStorage.setItem("novel_last_chapter_id", UI.chapterId || "");
    clearTimeout(UI.positionTimer);
    UI.positionTimer = setTimeout(() => {
      saveLastOpen({ lastCursorPosition: position.cursor, lastScrollPosition: position.scroll }).catch((error) => console.warn("[phase1] position save failed", error));
    }, 350);
  }

  function scheduleSave() {
    clearTimeout(UI.autosaveTimer);
    updateSaveStatus("尚未儲存");
    UI.autosaveTimer = setTimeout(() => saveCurrentChapter("auto"), 1000);
  }

  async function saveCurrentChapter(reason = "auto", makeVersion = reason === "manual") {
    const titleInput = $("phase1ChapterTitle");
    const contentInput = $("phase1ChapterContent");
    if (!UI.chapterId || !titleInput || !contentInput || UI.saving) return;
    UI.saving = true;
    try {
      updateSaveStatus("儲存中");
      const old = normalizeChapter(await NovelDB.get("chapters", UI.chapterId));
      if (!old.id) return;
      if (makeVersion) {
        const loaded = await NovelDB.loadProject(UI.projectId);
        await NovelDB.createVersion(UI.projectId, reason === "manual" ? "手動儲存前快照" : "AI改寫前快照", loaded, { reason });
      }
      const content = contentInput.value;
      const wordCount = NovelDB.words(content);
      const position = currentEditorPosition();
      const now = NovelDB.now();
      await recordWritingDelta(old.wordCount || 0, wordCount);
      await NovelDB.put("chapters", {
        ...old,
        title: titleInput.value.trim() || old.title,
        content,
        summary: content.replace(/\s+/g, " ").slice(0, 180),
        hook: content.slice(-180),
        wordCount,
        chapterTargetWords: Number($("phase1ChapterTargetWords")?.value || old.chapterTargetWords || 3000),
        status: $("phase1ChapterStatus")?.value || old.status || (wordCount ? "draft" : "not_started"),
        goal: $("phase1ChapterGoal")?.value.trim() || old.goal || "",
        lastCursorPosition: position.cursor,
        lastScrollPosition: position.scroll,
        lastSavedAt: now,
        updatedAt: now,
        version: (old.version || 0) + 1
      });
      await updateProjectTotals(UI.projectId);
      await saveLastOpen({ lastCursorPosition: position.cursor, lastScrollPosition: position.scroll, lastOpenedAt: now });
      await syncLegacyFromProject(UI.projectId, UI.chapterId);
      UI.lastSaveAt = now;
      updateSaveStatus("已儲存", textTime());
    } catch (error) {
      updateSaveStatus("儲存失敗", `${error.message || String(error)}。原文已保留，請按「儲存目前作品」重試。`);
    } finally {
      UI.saving = false;
      await loadLists();
      renderSelects();
      await renderContinueCard();
      await renderProgressPanel();
    }
  }

  async function saveProgressSettings() {
    if (!UI.projectId || !UI.chapterId) return notify("請先選擇作品與章節。", "error");
    const targetWords = Number($("phase1TargetWords")?.value || 0) || null;
    const expectedChapters = Number($("phase1ExpectedChapters")?.value || 0) || null;
    const storyStage = $("phase1StoryStage")?.value || "development";
    const chapterTargetWords = Number($("phase1ChapterTargetWords")?.value || 3000);
    const chapterStatus = $("phase1ChapterStatus")?.value || "draft";
    const chapterGoal = $("phase1ChapterGoal")?.value.trim() || "";
    await saveCurrentChapter("progress-settings", false);
    const project = normalizeProject(await NovelDB.get("projects", UI.projectId));
    const chapter = normalizeChapter(await NovelDB.get("chapters", UI.chapterId));
    await NovelDB.put("projects", {
      ...project,
      targetWords,
      expectedChapters,
      storyStage,
      updatedAt: NovelDB.now()
    });
    await NovelDB.put("chapters", {
      ...chapter,
      chapterTargetWords,
      status: chapterStatus,
      goal: chapterGoal,
      updatedAt: NovelDB.now()
    });
    await updateProjectTotals(UI.projectId);
    updateSaveStatus("已儲存", textTime());
    await refresh();
  }

  async function readPreviousChapter(projectId = UI.projectId) {
    await focusManager(projectId);
    const current = UI.chapters.find((chapter) => chapter.id === UI.chapterId);
    const previous = current ? findPreviousChapter(current.id) : sortedChapters(UI.chapters).at(-1);
    if (!previous) return notify("此作品沒有可閱讀的上一章。");
    const panel = $("phase1VersionPanel");
    if (!panel) return;
    panel.classList.remove("hidden");
    panel.innerHTML = `
      <h3>閱讀上一章｜${esc(previous.title)}</h3>
      <div class="out">${esc(previous.content || "此章尚無正文。")}</div>
      <div class="bar"><button onclick="document.getElementById('phase1VersionPanel').classList.add('hidden')">關閉</button></div>
    `;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function focusProjectSettings(projectId = UI.projectId) {
    await focusManager(projectId);
    $("phase1ProjectTitleInput")?.focus();
    notify("已打開作品設定。分類包只會在「建立新作品」使用，不會改動既有作品。");
  }

  function buildOfflineState() {
    const project = UI.projects.find((item) => item.id === UI.projectId) || {};
    const chapters = UI.chapters.sort((a, b) => (a.order || 0) - (b.order || 0));
    const goal = $("phase1NextGoal")?.value || "延續上一章未完成的壓力";
    const conflict = $("phase1Conflict")?.value || "尚未處理衝突持續擴大";
    return {
      title: project.title || "未命名小說",
      genre: project.genre || "",
      styleMode: project.style || "",
      coreIdea: project.synopsis || "",
      seed: project.synopsis || "",
      conflictCore: conflict,
      story: chapters.map((chapter) => chapter.content),
      nextGoal: goal
    };
  }

  function normalizeOfflineDraft(draft) {
    if (!draft?.content) return draft;
    if (NovelDB.words(draft.content) <= 1000) return draft;
    const lines = draft.content.split("\n");
    const title = lines[0] || `# ${draft.title}`;
    const meta = lines.slice(1, 12).join("\n");
    const body = lines.slice(12).join("\n").replace(/\s+/g, " ").slice(0, 850);
    const hook = draft.hook || "更大的危機已經逼近，主角必須在下一章做出選擇。";
    return {
      ...draft,
      content: `${title}\n${meta}\n\n${body}\n\n【章尾鉤子】\n${hook}`.trim()
    };
  }

  async function previewOfflineContinue() {
    if (!UI.projectId) return notify("請先建立或選擇作品。", "error");
    await saveCurrentChapter("before-offline-preview", false);
    const draft = normalizeOfflineDraft(OfflineNovelEngine.generateNextChapter(buildOfflineState()));
    UI.pendingDraft = draft;
    $("phase1DraftPreview").textContent = `【續寫預覽】\n${draft.content}`;
  }

  async function regenerateOffline() {
    await previewOfflineContinue();
  }

  async function applyOfflineDraft() {
    if (!UI.pendingDraft) return notify("尚未產生續寫預覽。", "error");
    const chapter = await createChapter(UI.pendingDraft.title, UI.pendingDraft.content);
    if (chapter) {
      await NovelDB.createVersion(UI.projectId, "離線續寫套用", await NovelDB.loadProject(UI.projectId), { reason: "offline-continue" });
      UI.pendingDraft = null;
      $("phase1DraftPreview").textContent = "已套用到新章節。";
      await refresh();
    }
  }

  function discardOfflineDraft() {
    UI.pendingDraft = null;
    const box = $("phase1DraftPreview");
    if (box) box.textContent = "已放棄本次續寫預覽。";
  }

  async function aiContinue() {
    if (!UI.projectId) return notify("請先選擇作品。", "error");
    const button = $("phase1CloudAiButton");
    if (button) button.disabled = true;
    const status = $("phase1AiStatus");
    try {
      if (status) status.textContent = "生成中";
      await saveCurrentChapter("before-ai", true);
      const cfg = NovelAIService.getConfig();
      if ((cfg.provider === "chat" || cfg.provider === "cloud" || cfg.provider === "openai") && !navigator.onLine) {
        throw new Error("需要網路：雲端AI在離線狀態不可使用。");
      }
      const prompt = `請根據以下作品資料續寫下一章，產生可編輯正文，不要只給大綱。\n\n作品：${buildOfflineState().title}\n簡介：${buildOfflineState().coreIdea}\n上一章：${UI.chapters.at(-1)?.content || ""}`;
      const result = await NovelAIService.generate(prompt);
      UI.pendingDraft = {
        title: `AI續寫 ${new Date().toLocaleTimeString("zh-TW")}`,
        content: result,
        summary: result.slice(0, 160),
        hook: result.slice(-160)
      };
      $("phase1DraftPreview").textContent = `【AI續寫預覽】\n${result}`;
      if (status) status.textContent = "已生成預覽，尚未套用。";
    } catch (error) {
      if (status) status.textContent = `生成失敗：${error.message || error}`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function refreshNetworkStatus() {
    const button = $("phase1CloudAiButton");
    const status = $("phase1AiStatus");
    const cfg = window.NovelAIService?.getConfig ? NovelAIService.getConfig() : { provider: "chat" };
    const cloud = cfg.provider === "chat" || cfg.provider === "cloud" || cfg.provider === "openai";
    if (button && cloud && !navigator.onLine) {
      button.disabled = true;
      button.title = "需要網路";
    } else if (button) {
      button.disabled = false;
      button.title = "";
    }
    if (status) {
      if (cloud && !navigator.onLine) status.textContent = "需要網路";
      else if (cfg.provider === "ollama" || cfg.provider === "lmstudio") status.textContent = "本機模型狀態請先確認是否已啟動";
      else status.textContent = cfg.model ? "已設定" : "尚未設定";
    }
  }

  async function showVersions() {
    if (!UI.projectId) return;
    const versions = (await NovelDB.getByIndex("versions", "projectId", UI.projectId)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const box = $("phase1VersionPanel");
    box.classList.remove("hidden");
    box.innerHTML = `<h3>版本列表</h3>${versions.length ? versions.map((version, index) => `
      <div class="version-item">
        <b>${esc(version.label)}</b>
        <p class="muted">${new Date(version.createdAt).toLocaleString()}｜${esc(version.summary || "")}</p>
        <div class="bar">
          <button onclick="Phase1Novel.previewVersion('${version.id}')">預覽</button>
          <button class="btn green" onclick="Phase1Novel.restoreVersion('${version.id}')">還原</button>
          <button class="btn red" onclick="Phase1Novel.deleteVersion('${version.id}')">刪除</button>
        </div>
      </div>`).join("") : "<p class='muted'>尚無版本。</p>"}`;
  }

  async function previewVersion(id) {
    const version = await NovelDB.get("versions", id);
    if (!version) return;
    $("phase1VersionPanel").innerHTML += `<div class="out">${esc((version.chapters || []).join("\n\n" + "=".repeat(24) + "\n\n")).replace(/\n/g, "<br>")}</div>`;
  }

  async function restoreVersion(id) {
    const version = await NovelDB.get("versions", id);
    if (!version || !confirmSafe("確定還原此版本？目前內容會先建立還原前快照。")) return;
    const loaded = await NovelDB.loadProject(UI.projectId);
    await NovelDB.createVersion(UI.projectId, "還原前快照", loaded, { reason: "before-restore" });
    const stateToRestore = { ...(version.state || {}), story: version.chapters || version.state?.story || [] };
    await NovelDB.saveState(stateToRestore, "restore");
    await refresh();
  }

  async function deleteVersion(id) {
    if (!confirmSafe("確定刪除此版本紀錄？")) return;
    await NovelDB.delete("versions", id);
    await showVersions();
  }

  async function exportCurrentProject() {
    if (!UI.projectId) return notify("請先選擇作品。", "error");
    await NovelBackup.exportProject(UI.projectId);
  }

  async function importBackup() {
    try {
      const importBox = $("phase1ImportJson");
      if (importBox && importBox.classList.contains("hidden")) {
        importBox.classList.remove("hidden");
        importBox.focus();
        notify("請把 JSON 備份貼到新出現的文字框，再按一次「匯入備份」。");
        return;
      }
      const raw = importBox?.value.trim();
      if (!raw) return notify("請先貼上 JSON 備份內容。", "error");
      const preview = NovelBackup.previewText(JSON.parse(raw));
      if (!confirmSafe(`${preview}\n\n是否建立匯入副本？`)) return;
      const result = await NovelBackup.importBackup(raw, true);
      if (result) {
        notify(`匯入完成：${result.importedProjects} 部作品、${result.importedChapters} 個章節。`);
        if (importBox) {
          importBox.value = "";
          importBox.classList.add("hidden");
        }
        UI.projectId = result.firstProjectId || UI.projectId;
        await refresh();
      }
    } catch (error) {
      notify(`匯入失敗：${error.message || error}`, "error");
    }
  }

  async function readProject(projectId) {
    const bundle = await NovelDB.listProjectBundle(projectId);
    if (!bundle) return;
    const out = $("storyOutput");
    if (out) {
      out.classList.remove("hidden");
      out.textContent = bundle.chapters.map((chapter) => chapter.content).join("\n\n" + "=".repeat(48) + "\n\n");
      if (typeof showView === "function") showView("creation");
    }
  }

  function showNewWork() {
    if (typeof showView === "function") showView("creation");
    showSection("phase1NewWorkIntro");
    showSection("phase1NewWorkArea");
    hideSection("phase1Manager");
    hideSection("phase1AssistTools");
    hideSection("phase1MyWorks");
    $("phase1NewWorkIntro")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function showMyWorks() {
    if (typeof showView === "function") showView("creation");
    await loadLists();
    const box = $("phase1MyWorks");
    if (!box) return;
    showSection("phase1MyWorks");
    hideSection("phase1Manager");
    hideSection("phase1AssistTools");
    hideSection("phase1NewWorkArea");
    hideSection("phase1NewWorkIntro");
    box.innerHTML = `
      <h2>我的作品</h2>
      ${UI.projects.length ? UI.projects.map((project) => `
        <div class="phase1-work-row">
          <div class="phase1-mini-cover">${esc(String(project.title || "書").slice(0, 2))}</div>
          <div>
            <b>${esc(project.title || "未命名小說")}</b>
            <p class="muted">${new Date(project.updatedAt || project.createdAt || Date.now()).toLocaleString()}｜${project.currentChapter || 0}章｜${project.totalWords || 0}字</p>
          </div>
          <div class="bar">
            <button class="btn green" onclick="Phase1Novel.focusManager('${project.id}')">繼續寫作</button>
            <button onclick="Phase1Novel.readProject('${project.id}')">閱讀</button>
            <button onclick="Phase1Novel.focusManager('${project.id}')">管理</button>
          </div>
        </div>`).join("") : "<p class='muted'>尚未建立作品。</p><button class='btn green' onclick='Phase1Novel.showNewWork()'>建立第一部小說</button>"}
    `;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showInspiration() {
    document.body.classList.add("phase1-show-advanced");
    if (typeof showView === "function") showView("home");
  }

  async function focusManager(projectId = "") {
    if (projectId) await selectProject(projectId);
    if (typeof showView === "function") showView("creation");
    showSection("phase1Manager");
    showSection("phase1AssistTools");
    hideSection("phase1NewWorkArea");
    hideSection("phase1NewWorkIntro");
    hideSection("phase1MyWorks");
    $("phase1Manager")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function runMigration(force = false, silent = false) {
    if (!window.NovelMigration) return;
    const result = await NovelMigration.migrateOldLocalStorage(force);
    if (!silent) notify(result.message);
    await refresh();
  }

  function patchLegacyExportImport() {
    window.exportJSON = async function phase1ExportJson() {
      await NovelBackup.exportAll();
    };
    window.importJSONPrompt = importBackup;
  }

  async function init() {
    ensureShell();
    simplifyNavigation();
    bindPhase1NavigationGuard();
    patchLegacyExportImport();
    window.addEventListener("online", refreshNetworkStatus);
    window.addEventListener("offline", refreshNetworkStatus);
    window.addEventListener("beforeunload", () => {
      const title = $("phase1ChapterTitle");
      const content = $("phase1ChapterContent");
      if (UI.chapterId && title && content) {
        const position = currentEditorPosition();
        localStorage.setItem("novel_phase1_unload_backup", JSON.stringify({ chapterId: UI.chapterId, title: title.value, content: content.value, cursor: position.cursor, scroll: position.scroll, savedAt: new Date().toISOString() }));
        localStorage.setItem("novel_last_project_id", UI.projectId || "");
        localStorage.setItem("novel_last_volume_id", UI.volumeId || "");
        localStorage.setItem("novel_last_chapter_id", UI.chapterId || "");
      }
    });
    await NovelDB.openDb();
    await runMigration(false, true);
    await refresh();
  }

  window.Phase1Novel = {
    refresh,
    openLatestForWriting,
    showNewWork,
    showMyWorks,
    showInspiration,
    createProject,
    editProject,
    deleteProject,
    selectProject,
    createVolume,
    editVolume,
    deleteVolume,
    selectVolume,
    createChapter,
    selectChapter,
    editChapterMeta,
    deleteChapter,
    moveChapter,
    scheduleSave,
    capturePosition,
    saveCurrentChapter,
    saveProgressSettings,
    previewOfflineContinue,
    regenerateOffline,
    applyOfflineDraft,
    discardOfflineDraft,
    aiContinue,
    refreshNetworkStatus,
    showVersions,
    previewVersion,
    restoreVersion,
    deleteVersion,
    exportCurrentProject,
    importBackup,
    readProject,
    readPreviousChapter,
    focusManager,
    focusProjectSettings,
    toggleAdvanced,
    runMigration
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
