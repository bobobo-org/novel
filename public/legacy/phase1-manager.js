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
    aiCandidate: null,
    guidedRound: null,
    guidedSelection: "",
    guidedCurrentStep: 1,
    guidedRounds: {},
    guidedSelections: {},
    guidedCustomInputs: {},
    guidedOptionHistory: [],
    guidedChapterPlan: "",
    guidedUpdatedAt: "",
    sectionCurrentIndex: 0,
    sectionWriting: null,
    sectionCandidate: "",
    combinedChapterPreview: "",
    storyStateCandidates: [],
    chapterClosingSummary: null,
    writingMode: "free",
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

  const writingModeDescriptions = {
    free: "自由寫作：由你直接撰寫正文，系統只負責保存與基本輔助。",
    guided: "離線引導式寫作：根據目前作品與上一輪選擇，提供具體行動與後果；不需連接AI。",
    ai: "AI協作寫作：使用雲端AI或本機模型產生候選正文與修改建議。"
  };

  async function loadWritingMode() {
    const fallback = localStorage.getItem("novel_writing_mode") || "free";
    if (!UI.projectId) {
      UI.writingMode = ["free", "guided", "ai"].includes(fallback) ? fallback : "free";
      return;
    }
    const saved = await NovelDB.getSetting(`writing-mode-${UI.projectId}`);
    const mode = saved?.writingMode || fallback;
    UI.writingMode = ["free", "guided", "ai"].includes(mode) ? mode : "free";
  }

  async function saveWritingMode() {
    localStorage.setItem("novel_writing_mode", UI.writingMode);
    if (UI.projectId) {
      await NovelDB.saveSetting(`writing-mode-${UI.projectId}`, {
        writingMode: UI.writingMode,
        updatedAt: NovelDB.now()
      });
    }
  }

  function getModeContext() {
    const legacy = getLegacyState() || {};
    const project = normalizeProject(UI.projects.find((item) => item.id === UI.projectId));
    const chapter = normalizeChapter(UI.chapters.find((item) => item.id === UI.chapterId));
    const previous = UI.chapterId ? findPreviousChapter(UI.chapterId) : null;
    const memory = getStoryMemory();
    const memoryStory = memory.storyState || {};
    const tail = String(chapter.content || "").slice(-1000);
    return {
      project,
      chapter,
      previous,
      title: project.title || legacy.title || "未命名作品",
      genre: project.genre || legacy.themeMode || legacy.genre || "未分類題材",
      subTheme: legacy.subTheme || "未指定細分類",
      engine: legacy.storyEngine || "通用故事引擎",
      protagonist: legacy.protagonist || legacy.hostName || legacy.heroType || "主角",
      heroType: legacy.heroType || "主角",
      opponent: legacy.villainCore || legacy.conflictCore || "對手",
      ally: legacy.hostName && legacy.hostName !== legacy.protagonist ? legacy.hostName : "盟友",
      worldCore: legacy.worldCore || project.genre || "目前世界",
      powerCore: legacy.powerCore || "主角的核心能力",
      conflict: $("phase1Conflict")?.value.trim() || chapter.goal || project.synopsis || legacy.coreIdea || "目前衝突尚未明朗",
      style: legacy.styleMode || project.style || "穩定敘事",
      coreIdea: legacy.coreIdea || project.synopsis || "本章需要繼續推進主線",
      lastText: tail || String(previous?.content || "").slice(-800) || "目前正文尚少，請從本章目標開始推進。",
      previousSummary: previous?.summary || shortText(previous?.content, 220) || "沒有上一章摘要",
      currentPlan: chapter.goal || "",
      storyMemory: memory,
      stateReference: nextChapterReference(memory),
      previousResult: memoryStory.chapterResult || "",
      nextHook: memoryStory.nextHook || ""
    };
  }

  const guidedSteps = [
    { key: "purpose", title: "第1輪：本章功能", question: "這一章最主要要推進什麼？" },
    { key: "strategy", title: "第2輪：主角策略", question: "主角準備如何處理眼前問題？" },
    { key: "cost", title: "第3輪：阻礙與代價", question: "這次行動應付出什麼代價？" },
    { key: "result", title: "第4輪：結果方向", question: "本章結束時，主角得到什麼結果？" },
    { key: "hook", title: "第5輪：章尾鉤子", question: "下一章最值得期待的懸念是什麼？" }
  ];

  const guidedSynonyms = {
    expose: ["公開", "揭開", "交出", "拋出"],
    investigate: ["暗查", "比對", "追蹤", "試探"],
    twist: ["放出假線索", "借第三方出手", "反向佈局", "故意示弱"],
    cost: ["身分破綻", "關係裂痕", "能力反噬", "對手警覺"],
    hook: ["新人物出現", "證據被調包", "身分即將曝光", "盟友背叛", "反派提前行動", "能力產生異常", "收到不可能存在的訊息"]
  };

  const sectionBlueprints = [
    { sectionId: "opening", sectionType: "opening", title: "開場與場景建立", goal: "用具體場景把讀者帶回本章局面，交代時間、地點與壓力來源。" },
    { sectionId: "status", sectionType: "character_state", title: "主角目前狀態", goal: "呈現主角的身體、情緒、資源與當下顧慮。" },
    { sectionId: "incident", sectionType: "conflict_arrival", title: "事件或衝突出現", goal: "讓事件真正發生，逼主角無法只停留在思考。" },
    { sectionId: "reaction", sectionType: "first_reaction", title: "人物第一反應", goal: "寫出主角、對手或盟友對事件的第一個可見反應。" },
    { sectionId: "escalation", sectionType: "conflict_escalation", title: "衝突升高", goal: "提高壓力，讓主角付出的代價或暴露的風險變明顯。" },
    { sectionId: "midpoint", sectionType: "midpoint_turn", title: "中段轉折", goal: "加入資訊反轉、關係變化或策略失效，讓本章不平鋪直敘。" },
    { sectionId: "choice", sectionType: "choice_cost", title: "主角選擇與代價", goal: "讓主角做出明確選擇，並承受相應代價。" },
    { sectionId: "ending", sectionType: "result_hook", title: "結果與章尾鉤子", goal: "收束本章直接結果，留下下一章最想看的懸念。" }
  ];

  function guidedKey() {
    return `guided-writing-${UI.projectId || "no-project"}-${UI.chapterId || "no-chapter"}`;
  }

  function sectionWritingKey() {
    return `section-writing-${UI.projectId || "no-project"}-${UI.chapterId || "no-chapter"}`;
  }

  function chapterClosingKey(projectId = UI.projectId, chapterId = UI.chapterId) {
    return `chapter-closing-summary-${projectId || "no-project"}-${chapterId || "no-chapter"}`;
  }

  function chapterClosingNextKey(projectId = UI.projectId) {
    return `chapter-closing-next-reference-${projectId || "no-project"}`;
  }

  function guidedStep() {
    return guidedSteps[clamp(UI.guidedCurrentStep, 1, guidedSteps.length) - 1] || guidedSteps[0];
  }

  function pickDynamic(items, seedText = "") {
    const seed = String(seedText || "").split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0) + Date.now();
    return items[Math.abs(seed) % items.length];
  }

  function deDuplicateOption(text) {
    const recent = UI.guidedOptionHistory || [];
    if (!recent.includes(text)) return text;
    return `${text}，但這次改由${pickDynamic(["盟友", "旁觀者", "對手", "主角自己"], text)}先做出反應。`;
  }

  function estimateCustomOutcome(text) {
    const value = String(text || "").trim();
    if (!value || value.length < 8) {
      return {
        risk: "中",
        progress: "中",
        cost: "自訂行動較短，後果需由作者自行決定。",
        impact: "建議補上具體人物、行動與目標。",
        pace: "可調整"
      };
    }
    const highRisk = /公開|攤牌|決鬥|揭穿|犧牲|背叛|暴露|殺|逃/.test(value);
    const lowRisk = /觀察|等待|暗中|調查|確認|試探/.test(value);
    return {
      risk: highRisk ? "高" : lowRisk ? "低至中" : "中",
      progress: highRisk ? "快" : lowRisk ? "中" : "中",
      cost: highRisk ? "可能引發身分或秘密風險。" : lowRisk ? "可能拖慢主線但保留安全空間。" : "後果需由作者自行決定。",
      impact: value.includes("盟友") || value.includes("朋友") ? "可能影響人物信任。" : value.includes("對手") || value.includes("反派") ? "可能讓對手提前警覺。" : "可能影響需由作者自行判斷。",
      pace: highRisk ? "高張力快節奏" : "穩定推進"
    };
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
        <div class="phase1-card phase1-mode-card" id="phase1WritingModeCard">
          <div class="phase1-mode-head">
            <div>
              <h3>作品寫作模式</h3>
              <p id="phase1ModeDescription" class="muted">自由寫作：由你直接撰寫正文，系統只負責保存與基本輔助。</p>
            </div>
            <div class="phase1-mode-tabs" role="tablist" aria-label="寫作模式">
              <button id="phase1ModeFree" onclick="Phase1Novel.setWritingMode('free')">自由寫作</button>
              <button id="phase1ModeGuided" onclick="Phase1Novel.setWritingMode('guided')">離線引導式寫作</button>
              <button id="phase1ModeAi" onclick="Phase1Novel.setWritingMode('ai')">AI協作寫作</button>
            </div>
          </div>
          <div id="phase1FreeModePanel" class="phase1-mode-panel">
            <div class="phase1-mode-summary">
              <span>目前字數：<b id="phase1FreeWordCount">0字</b></span>
              <span>自動存檔：<b id="phase1FreeSaveStatus">尚未儲存</b></span>
            </div>
            <div class="bar">
              <button class="btn green" onclick="Phase1Novel.saveCurrentChapter('manual')">儲存目前內容</button>
              <button onclick="Phase1Novel.completeCurrentChapter()">完成章節</button>
              <button onclick="Phase1Novel.markEditorAsCurrentSection()">標記為目前段落內容</button>
              <button class="btn gold" onclick="Phase1Novel.setWritingMode('guided')">我卡住了</button>
            </div>
          </div>
          <div id="phase1GuidedModePanel" class="phase1-mode-panel hidden">
            <div class="phase1-guided-progress">
              <b id="phase1GuidedStepLabel">第1輪 / 共5輪</b>
              <span id="phase1GuidedSavedAt">尚未儲存引導進度</span>
            </div>
            <div id="phase1GuidedQuestion" class="notice">按「重新產生選項」開始本輪引導。</div>
            <div id="phase1GuidedOptions" class="phase1-guided-options"></div>
            <label>D 自訂行動</label>
            <textarea id="phase1GuidedCustom" placeholder="例如：讓主角先保護盟友，再用假情報引出真正的對手。"></textarea>
            <div class="bar">
              <button id="phase1GuidedCustomButton" onclick="Phase1Novel.chooseGuidedOption('D')">使用 D 自訂行動</button>
            </div>
            <div id="phase1GuidedOutcome" class="out phase1-small-out">尚未選擇行動。</div>
            <div class="bar">
              <button class="btn green" onclick="Phase1Novel.confirmGuidedChoice()">確認選擇</button>
              <button onclick="Phase1Novel.regenerateGuidedOptions()">重新產生選項</button>
              <button onclick="Phase1Novel.guidedBack()">返回上一輪</button>
              <button onclick="Phase1Novel.clearGuidedStep()">清除本輪</button>
              <button onclick="Phase1Novel.restartGuidedFlow()">重新開始引導</button>
              <button onclick="Phase1Novel.setWritingMode('free')">返回自由寫作</button>
            </div>
            <div class="phase1-guided-plan-box">
              <label>本章續寫設定摘要／本章規劃</label>
              <textarea id="phase1GuidedPlan" placeholder="完成五輪後會組合成本章規劃，也可以手動編輯。"></textarea>
              <label>作者補充</label>
              <textarea id="phase1GuidedAuthorNote" placeholder="可補充這章一定要保留的情緒、台詞、伏筆或禁忌。"></textarea>
              <div class="bar">
                <button onclick="Phase1Novel.editGuidedPlan()">編輯本章規劃</button>
                <button class="btn gold" onclick="Phase1Novel.saveGuidedPlan()">儲存本章規劃</button>
                <button class="btn green" onclick="Phase1Novel.generateGuidedChapterWithOllama()">儲存並生成本章</button>
                <button onclick="Phase1Novel.copyGuidedPlan()">複製規劃</button>
                <button class="btn green" onclick="Phase1Novel.applyGuidedPlan()">套用到自由寫作提示區</button>
                <button class="btn green" onclick="Phase1Novel.startSectionWriting()">開始逐段寫作</button>
                <button onclick="Phase1Novel.restartGuidedFlow()">重新引導</button>
              </div>
              <div class="phase1-card" style="margin-top:12px">
                <h3>本地 AI 引導式寫作</h3>
                <p class="muted">第一階段支援 Ollama 本機模型。小說內容只送到 localhost，不會送到雲端。</p>
                <div class="phase1-mode-summary">
                  <span>網際網路：<b id="phase1LocalInternetStatus">偵測中</b></span>
                  <span>Ollama：<b id="phase1OllamaStatus">尚未偵測</b></span>
                  <span>正文生成：<b id="phase1LocalGenerationStatus">尚未開始</b></span>
                </div>
                <label>Ollama 端點</label>
                <input id="phase1OllamaEndpoint" value="http://localhost:11434" placeholder="http://localhost:11434">
                <label>本地模型</label>
                <select id="phase1OllamaModel"></select>
                <label>目標字數</label>
                <input id="phase1LocalTargetWords" type="number" min="800" max="6000" value="1800">
                <div class="bar">
                  <button onclick="Phase1Novel.detectOllamaModels()">重新偵測模型</button>
                  <button onclick="Phase1Novel.testOllamaModel()">測試模型</button>
                  <button class="btn red" onclick="Phase1Novel.abortGuidedGeneration()">中止生成</button>
                </div>
                <div id="phase1GuidedGenerationPreview" class="out">完成五輪後，可按「儲存並生成本章」產生完整正文候選。</div>
                <div class="bar">
                  <button class="btn green" onclick="Phase1Novel.acceptGuidedGeneratedChapter('append')">接受並加入目前章節</button>
                  <button onclick="Phase1Novel.acceptGuidedGeneratedChapter('new')">接受並建立新章節</button>
                  <button onclick="Phase1Novel.discardGuidedGeneratedChapter()">放棄候選正文</button>
                </div>
              </div>
            </div>
            <div id="phase1SectionWriter" class="phase1-section-writer hidden">
              <div class="phase1-section-head">
                <div>
                  <h3>逐段正文寫作</h3>
                  <p id="phase1SectionProgress" class="muted">尚未開始。</p>
                </div>
                <div class="bar">
                  <button onclick="Phase1Novel.startSectionWriting()">重新載入段落流程</button>
                  <button class="btn gold" onclick="Phase1Novel.combineChapterSections()">組合本章正文</button>
                </div>
              </div>
              <div id="phase1SectionList" class="phase1-section-list"></div>
              <div class="phase1-section-current">
                <div class="phase1-guided-progress">
                  <b id="phase1SectionTitle">目前段落</b>
                  <span id="phase1SectionStatus">未開始</span>
                </div>
                <div class="phase1-section-meta">
                  <div><b>段落目的</b><p id="phase1SectionGoal">尚未選擇段落。</p></div>
                  <div><b>上一段摘要</b><p id="phase1SectionPrevSummary">無</p></div>
                  <div><b>下一段預告</b><p id="phase1SectionNextHint">無</p></div>
                </div>
                <div class="phase1-mode-tabs phase1-section-methods">
                  <button id="phase1SectionMethodManual" onclick="Phase1Novel.setSectionMethod('manual')">自己寫</button>
                  <button id="phase1SectionMethodOptions" onclick="Phase1Novel.setSectionMethod('options')">A／B／C／D引導</button>
                  <button id="phase1SectionMethodOffline" onclick="Phase1Novel.setSectionMethod('offline')">離線短草稿</button>
                  <button id="phase1SectionMethodAi" onclick="Phase1Novel.setSectionMethod('ai')">AI候選稿</button>
                </div>
                <div id="phase1SectionManualPanel" class="phase1-section-panel">
                  <label>本段內容</label>
                  <textarea id="phase1SectionContent" placeholder="在這裡撰寫本段正文。"></textarea>
                  <div class="bar">
                    <button class="btn green" onclick="Phase1Novel.saveCurrentSection()">儲存本段</button>
                    <button onclick="Phase1Novel.markCurrentSectionComplete()">標記完成</button>
                    <button onclick="Phase1Novel.markCurrentSectionNeedsRevision()">標記待修訂</button>
                    <button onclick="Phase1Novel.restoreSectionPrevious()">恢復上一版本</button>
                    <button onclick="Phase1Novel.prevSection()">返回上一段</button>
                    <button onclick="Phase1Novel.nextSection()">進入下一段</button>
                  </div>
                </div>
                <div id="phase1SectionOptionsPanel" class="phase1-section-panel hidden">
                  <div id="phase1SectionOptions" class="phase1-guided-options"></div>
                  <label>D 自訂寫法</label>
                  <textarea id="phase1SectionCustom" placeholder="例如：這段改成主角先沉默觀察，再用一句話逼對手露出破綻。"></textarea>
                  <div class="bar">
                    <button onclick="Phase1Novel.chooseSectionOption('D')">使用 D 自訂寫法</button>
                    <button class="btn green" onclick="Phase1Novel.confirmSectionOption()">確認選擇</button>
                    <button onclick="Phase1Novel.regenerateSectionOptions()">重新產生本段選項</button>
                  </div>
                  <div id="phase1SectionOptionOutcome" class="out phase1-small-out">尚未選擇本段寫法。</div>
                </div>
                <div id="phase1SectionOfflinePanel" class="phase1-section-panel hidden">
                  <div class="bar">
                    <button class="btn gold" onclick="Phase1Novel.generateOfflineSectionDraft()">產生離線短草稿</button>
                    <button onclick="Phase1Novel.generateOfflineSectionDraft(true)">重新產生</button>
                    <button class="btn green" onclick="Phase1Novel.applySectionCandidate('insert')">插入本段</button>
                    <button onclick="Phase1Novel.applySectionCandidate('append')">追加到本段</button>
                    <button onclick="Phase1Novel.editSectionCandidate()">自己修改</button>
                    <button class="btn red" onclick="Phase1Novel.discardSectionCandidate()">放棄</button>
                  </div>
                  <div id="phase1SectionCandidate" class="out phase1-small-out">尚未產生候選稿。</div>
                </div>
                <div id="phase1SectionAiPanel" class="phase1-section-panel hidden">
                  <div id="phase1SectionAiStatus" class="notice">AI候選稿只會套用到目前段落。</div>
                  <label>本段AI要求</label>
                  <textarea id="phase1SectionAiRequest" placeholder="例如：這段要更緊張，但不要新增陌生人物。"></textarea>
                  <div class="bar">
                    <button id="phase1SectionAiButton" class="btn gold" onclick="Phase1Novel.generateAiSectionCandidate()">產生本段AI候選稿</button>
                    <button class="btn green" onclick="Phase1Novel.applySectionCandidate('insert')">插入本段</button>
                    <button onclick="Phase1Novel.applySectionCandidate('append')">追加到本段</button>
                    <button class="btn red" onclick="Phase1Novel.discardSectionCandidate()">放棄</button>
                  </div>
                  <div id="phase1SectionAiCandidate" class="out phase1-small-out">尚未產生本段AI候選稿。</div>
                </div>
                <div id="phase1SectionCombinePanel" class="phase1-guided-plan-box hidden">
                  <label>本章組合預覽</label>
                  <textarea id="phase1CombinedChapterPreview" placeholder="八段完成後可在這裡預覽完整章節。"></textarea>
                  <div class="bar">
                    <button class="btn green" onclick="Phase1Novel.applyCombinedChapter()">套用為本章正文</button>
                    <button class="btn gold" onclick="Phase1Novel.prepareStoryStateCandidates()">整理本章故事狀態</button>
                    <button onclick="Phase1Novel.copyCombinedChapter()">複製全文</button>
                    <button onclick="Phase1Novel.saveCombinedAsVersion()">儲存為候選版本</button>
                    <button onclick="Phase1Novel.hideCombinedPreview()">回到分段修改</button>
                    <button class="btn red" onclick="Phase1Novel.discardCombinedChapter()">放棄組合</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div id="phase1AiModePanel" class="phase1-mode-panel hidden">
            <div id="phase1AiModeStatus" class="notice">尚未讀取 AI 設定。</div>
            <label>續寫要求</label>
            <textarea id="phase1AiModeRequest" placeholder="例如：延續上一段，讓主角先試探對手，不要直接揭露底牌。"></textarea>
            <div class="bar">
              <button id="phase1AiModeGenerateButton" class="btn gold" onclick="Phase1Novel.generateAiCandidate()">產生候選正文</button>
              <button onclick="Phase1Novel.openAiSettings()">查看原有AI設定</button>
              <button onclick="Phase1Novel.setWritingMode('guided')">返回引導式寫作</button>
            </div>
            <div id="phase1AiCandidatePreview" class="out phase1-small-out">尚未產生候選正文。</div>
            <div class="bar">
              <button class="btn green" onclick="Phase1Novel.applyAiCandidate('append')">插入正文結尾</button>
              <button onclick="Phase1Novel.applyAiCandidate('newChapter')">建立新章節</button>
              <button onclick="Phase1Novel.applyAiCandidate('replaceSelection')">取代選取段落</button>
              <button class="btn red" onclick="Phase1Novel.discardAiCandidate()">放棄結果</button>
            </div>
          </div>
        </div>
        <div class="phase1-card" id="phase1StoryStatePanel">
          <h3>故事狀態記憶</h3>
          <p class="muted">每部作品獨立保存。候選變化必須由作者接受後才會寫入，不會改動正文。</p>
          <div id="phase1NextChapterReference" class="notice">下一章寫作參考：尚未建立故事狀態。</div>
          <div class="grid2">
            <div>
              <h3>當前故事</h3>
              <div id="phase1StoryCurrent" class="out phase1-small-out"></div>
            </div>
            <div>
              <h3>防錯警告</h3>
              <div id="phase1StoryWarnings" class="out phase1-small-out"></div>
            </div>
          </div>
          <div class="grid2">
            <div>
              <h3>角色狀態</h3>
              <div id="phase1CharactersState" class="out phase1-small-out"></div>
              <div class="bar"><button onclick="Phase1Novel.addStoryStateItem('character')">新增角色狀態</button></div>
            </div>
            <div>
              <h3>未解事件</h3>
              <div id="phase1EventsState" class="out phase1-small-out"></div>
              <div class="bar"><button onclick="Phase1Novel.addStoryStateItem('event')">新增未解事件</button></div>
            </div>
          </div>
          <div class="grid2">
            <div>
              <h3>秘密</h3>
              <div id="phase1SecretsState" class="out phase1-small-out"></div>
              <div class="bar"><button onclick="Phase1Novel.addStoryStateItem('secret')">新增秘密</button></div>
            </div>
            <div>
              <h3>道具</h3>
              <div id="phase1ItemsState" class="out phase1-small-out"></div>
              <div class="bar"><button onclick="Phase1Novel.addStoryStateItem('item')">新增道具</button></div>
            </div>
          </div>
          <div class="bar">
            <button class="btn gold" onclick="Phase1Novel.prepareStoryStateCandidates()">整理本章故事狀態</button>
            <button class="btn green" onclick="Phase1Novel.acceptAllStoryStateCandidates()">全部接受</button>
            <button onclick="Phase1Novel.ignoreAllStoryStateCandidates()">全部忽略</button>
            <button class="btn green" onclick="Phase1Novel.saveAcceptedStoryStateCandidates()">儲存確認結果</button>
          </div>
          <div id="phase1StoryStateCandidates" class="out phase1-small-out">尚未產生狀態更新候選。</div>
        </div>
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

  function buildGuidedRound() {
    const ctx = getModeContext();
    const step = guidedStep();
    const previous = Object.values(UI.guidedSelections || {}).map((item) => item?.text).filter(Boolean).join("；");
    const action = {
      expose: pickDynamic(guidedSynonyms.expose, ctx.title + previous),
      investigate: pickDynamic(guidedSynonyms.investigate, ctx.conflict + previous),
      twist: pickDynamic(guidedSynonyms.twist, ctx.lastText + previous),
      cost: pickDynamic(guidedSynonyms.cost, ctx.powerCore + previous),
      hook: pickDynamic(guidedSynonyms.hook, ctx.title + ctx.lastText + previous)
    };
    const templates = {
      purpose: {
        A: {
          trait: "積極推進主要衝突",
          text: `${ctx.protagonist}在${ctx.worldCore}中${action.expose}關鍵線索，直接把「${shortText(ctx.conflict, 42)}」推到檯面上。`,
          risk: "高",
          progress: "快",
          cost: "可能提前暴露底牌或身分破綻。",
          impact: `${ctx.opponent}會被迫提前回應。`,
          pace: "開場即升溫"
        },
        B: {
          trait: "深化人物關係",
          text: `${ctx.protagonist}先找${ctx.ally}確認上一章留下的異常，讓兩人的信任或裂痕變成推進本章的核心。`,
          risk: "中",
          progress: "中",
          cost: "主線推進較慢，但人物情緒會更扎實。",
          impact: `${ctx.ally}對主角的態度會產生變化。`,
          pace: "情緒鋪墊"
        },
        C: {
          trait: "揭露秘密或世界資訊",
          text: `${ctx.protagonist}從最後一段正文的線索中發現${ctx.worldCore}的隱藏規則，讓${ctx.powerCore}出現新的限制。`,
          risk: "中高",
          progress: "中",
          cost: "世界資訊增加後，需要補上明確代價避免突兀。",
          impact: "讀者會更理解世界，但也會期待下一步驗證。",
          pace: "資訊揭露"
        }
      },
      strategy: {
        A: {
          trait: "主動進攻",
          text: `${ctx.protagonist}當眾${action.expose}一個刻意留下破綻的證據，引誘${ctx.opponent}主動辯解。`,
          risk: "高",
          progress: "快",
          cost: "若對手識破，主角會被反咬一口。",
          impact: "主線衝突會立刻升級。",
          pace: "強爽點"
        },
        B: {
          trait: "保守調查",
          text: `${ctx.protagonist}先${action.investigate}證據來源，並把真正底牌藏在${ctx.ally}不知道的位置。`,
          risk: "低至中",
          progress: "中",
          cost: "本章需要用細節維持張力。",
          impact: "主角會顯得更謹慎，對手暫時不易察覺。",
          pace: "懸疑推進"
        },
        C: {
          trait: "借力或意外轉折",
          text: `${ctx.protagonist}${action.twist}，讓原本旁觀的人物被迫介入，但代價是${ctx.ally}可能誤會主角。`,
          risk: "中高",
          progress: "中",
          cost: "可能失去盟友信任。",
          impact: "人物關係會被迫改變。",
          pace: "轉折節奏"
        }
      },
      cost: {
        A: {
          trait: "身分或秘密風險",
          text: `${ctx.protagonist}為了推進行動，不得不使用只有自己才知道的資訊，讓${ctx.opponent}開始懷疑主角的真實身分。`,
          risk: "高",
          progress: "快",
          cost: "身分或秘密接近曝光。",
          impact: "之後章節需要處理補救或反偵查。",
          pace: "壓迫感上升"
        },
        B: {
          trait: "人際關係損失",
          text: `${ctx.protagonist}選擇暫時隱瞞${ctx.ally}，換取行動空間，但讓兩人的信任開始出現裂縫。`,
          risk: "中",
          progress: "中",
          cost: "盟友信任下降。",
          impact: "情感線或合作線會留下後續修復需求。",
          pace: "情感代價"
        },
        C: {
          trait: "反派警覺或能力代價",
          text: `${ctx.protagonist}啟動${ctx.powerCore}處理危機，卻讓${ctx.opponent}察覺異常，能力本身也留下反噬。`,
          risk: "高",
          progress: "快",
          cost: `${action.cost}變成下一章必須處理的負擔。`,
          impact: "反派會提前行動，主角也不能無代價使用能力。",
          pace: "高代價推進"
        }
      },
      result: {
        A: {
          trait: "表面成功但留下隱患",
          text: `${ctx.protagonist}成功讓${ctx.opponent}退讓一步，但最後發現證據中有一處被刻意改動。`,
          risk: "中",
          progress: "快",
          cost: "勝利不完整，隱患會滾到下一章。",
          impact: "讀者會得到爽點，也會期待真相。",
          pace: "勝中藏危"
        },
        B: {
          trait: "暫時失敗但得到情報",
          text: `${ctx.protagonist}行動受阻，卻從對手反應中抓到真正關鍵的人名或地點。`,
          risk: "低至中",
          progress: "中",
          cost: "主角表面吃虧，需要下一章翻回來。",
          impact: "主線資訊增加，情緒壓抑感上升。",
          pace: "蓄力反擊"
        },
        C: {
          trait: "取得勝利但付出重大代價",
          text: `${ctx.protagonist}成功扳回局面，但必須犧牲一段關係、資源或安全身分作交換。`,
          risk: "高",
          progress: "快",
          cost: "勝利會留下明顯傷口。",
          impact: "人物弧線會更立體，也更容易導入下一章危機。",
          pace: "高情緒爆點"
        }
      },
      hook: {
        A: {
          trait: "新懸念出現",
          text: `章尾讓${action.hook}，而且這件事只和${ctx.protagonist}上一章的選擇有關。`,
          risk: "中",
          progress: "快",
          cost: "下一章必須處理新線索，不能只放著不管。",
          impact: "讀者會期待下一章解釋。",
          pace: "強鉤子"
        },
        B: {
          trait: "證據或情報反轉",
          text: `${ctx.protagonist}以為掌握關鍵證據，章尾卻發現證據被調包，真正版本落到${ctx.opponent}手上。`,
          risk: "高",
          progress: "中",
          cost: "主角暫時失去主動權。",
          impact: "反派壓迫感會提升。",
          pace: "懸疑反轉"
        },
        C: {
          trait: "人物關係鉤子",
          text: `${ctx.ally}在章尾做出一個不符合過去立場的選擇，讓${ctx.protagonist}第一次懷疑盟友是否可信。`,
          risk: "中高",
          progress: "中",
          cost: "信任線會進入不穩定狀態。",
          impact: "下一章可走情感衝突或背叛調查。",
          pace: "關係拉扯"
        }
      }
    };
    const options = templates[step.key] || templates.purpose;
    Object.keys(options).forEach((key) => {
      options[key] = {
        label: key,
        ...options[key],
        text: deDuplicateOption(options[key].text)
      };
    });
    return {
      step: UI.guidedCurrentStep,
      key: step.key,
      title: step.title,
      question: step.question,
      context: ctx,
      options
    };
  }

  function renderGuidedRound() {
    const stepKey = guidedStep().key;
    const round = (UI.guidedRound?.key === stepKey ? UI.guidedRound : null) || UI.guidedRounds?.[stepKey] || buildGuidedRound();
    UI.guidedRound = round;
    UI.guidedRounds[stepKey] = round;
    if (!UI.guidedSelection) UI.guidedSelection = UI.guidedSelections?.[round.key]?.label || "";
    const question = $("phase1GuidedQuestion");
    const options = $("phase1GuidedOptions");
    const stepLabel = $("phase1GuidedStepLabel");
    const savedAt = $("phase1GuidedSavedAt");
    if (stepLabel) stepLabel.textContent = `${round.title}｜第${round.step}輪 / 共5輪`;
    if (savedAt) savedAt.textContent = UI.guidedUpdatedAt ? `已儲存 ${new Date(UI.guidedUpdatedAt).toLocaleTimeString("zh-TW")}` : "尚未儲存引導進度";
    if (question) question.textContent = round.question;
    const custom = $("phase1GuidedCustom");
    if (custom) custom.value = UI.guidedCustomInputs?.[round.key] || "";
    const plan = $("phase1GuidedPlan");
    if (plan && document.activeElement !== plan) plan.value = UI.guidedChapterPlan || buildGuidedChapterPlan();
    const note = $("phase1GuidedAuthorNote");
    if (note && document.activeElement !== note) note.value = UI.guidedCustomInputs?.authorNote || "";
    if (options) {
      options.innerHTML = ["A", "B", "C"].map((key) => {
        const option = round.options[key];
        const active = UI.guidedSelection === key ? " active" : "";
        return `
          <button class="phase1-guided-choice${active}" onclick="Phase1Novel.chooseGuidedOption('${key}')">
            <b>${option.label}｜${option.trait}</b>
            <span>${esc(option.text)}</span>
            <small>風險：${option.risk}｜主線推進：${option.progress}｜可能代價：${esc(option.cost)}｜影響：${esc(option.impact)}｜節奏：${esc(option.pace)}</small>
          </button>`;
      }).join("");
    }
    const customButton = $("phase1GuidedCustomButton");
    if (customButton) customButton.classList.toggle("active", UI.guidedSelection === "D");
    renderGuidedOutcome();
  }

  function guidedOptionFromSelection(selection) {
    if (selection === "D") {
      const custom = $("phase1GuidedCustom")?.value.trim() || "使用者自訂行動";
      const outcome = estimateCustomOutcome(custom);
      return {
        label: "D",
        trait: "自訂行動",
        text: custom,
        risk: outcome.risk,
        progress: outcome.progress,
        cost: outcome.cost,
        impact: outcome.impact,
        pace: outcome.pace
      };
    }
    return UI.guidedRound?.options?.[selection] || null;
  }

  function renderGuidedOutcome() {
    const box = $("phase1GuidedOutcome");
    if (!box) return;
    const option = guidedOptionFromSelection(UI.guidedSelection);
    if (!option) {
      box.textContent = "尚未選擇行動。";
      return;
    }
    box.textContent = [
      `【已選擇】${option.label}｜${option.trait}`,
      option.text,
      "",
      `風險：${option.risk}`,
      `主線推進：${option.progress}`,
      `可能代價：${option.cost}`,
      `可能影響：${option.impact}`,
      `適合節奏：${option.pace}`
    ].join("\n");
  }

  async function loadGuidedState() {
    UI.guidedCurrentStep = 1;
    UI.guidedRounds = {};
    UI.guidedSelections = {};
    UI.guidedCustomInputs = {};
    UI.guidedOptionHistory = [];
    UI.guidedChapterPlan = "";
    UI.guidedUpdatedAt = "";
    UI.guidedRound = null;
    UI.guidedSelection = "";
    if (!UI.projectId) return;
    const saved = await NovelDB.getSetting(guidedKey());
    if (!saved) return;
    UI.guidedCurrentStep = clamp(saved.guidedCurrentStep || 1, 1, guidedSteps.length);
    UI.guidedRounds = saved.guidedRounds || {};
    UI.guidedSelections = saved.guidedSelections || {};
    UI.guidedCustomInputs = saved.guidedCustomInputs || {};
    UI.guidedOptionHistory = Array.isArray(saved.guidedOptionHistory) ? saved.guidedOptionHistory.slice(-10) : [];
    UI.guidedChapterPlan = saved.guidedChapterPlan || "";
    UI.guidedUpdatedAt = saved.guidedUpdatedAt || "";
    UI.guidedSelection = UI.guidedSelections[guidedStep().key]?.label || "";
  }

  async function saveGuidedState() {
    if (!UI.projectId) return;
    UI.guidedUpdatedAt = NovelDB.now();
    UI.guidedCustomInputs.authorNote = $("phase1GuidedAuthorNote")?.value.trim() || UI.guidedCustomInputs.authorNote || "";
    await NovelDB.saveSetting(guidedKey(), {
      guidedCurrentStep: UI.guidedCurrentStep,
      guidedRounds: UI.guidedRounds || {},
      guidedSelections: UI.guidedSelections || {},
      guidedCustomInputs: UI.guidedCustomInputs || {},
      guidedOptionHistory: (UI.guidedOptionHistory || []).slice(-10),
      guidedChapterPlan: UI.guidedChapterPlan || $("phase1GuidedPlan")?.value || "",
      guidedUpdatedAt: UI.guidedUpdatedAt
    });
  }

  function buildGuidedChapterPlan() {
    const ctx = getModeContext();
    const selected = (key) => UI.guidedSelections?.[key];
    const purpose = selected("purpose");
    const strategy = selected("strategy");
    const cost = selected("cost");
    const result = selected("result");
    const hook = selected("hook");
    const plan = [
      "【本章規劃】",
      `作品：${ctx.title}`,
      `題材：${ctx.genre} / ${ctx.subTheme}`,
      `故事引擎：${ctx.engine}`,
      "",
      `本章目的：${purpose?.text || "尚未完成第1輪：本章功能。"}`,
      `主角策略：${strategy?.text || "尚未完成第2輪：主角策略。"}`,
      `主要阻礙：${ctx.conflict}`,
      `行動代價：${cost?.text || "尚未完成第3輪：阻礙與代價。"}`,
      `中段轉折：${strategy?.impact || cost?.impact || "等待引導完成後補充。"}`,
      `本章結果：${result?.text || "尚未完成第4輪：結果方向。"}`,
      `章尾鉤子：${hook?.text || "尚未完成第5輪：章尾鉤子。"}`,
      "",
      "作者補充：",
      $("phase1GuidedAuthorNote")?.value || ""
    ];
    return plan.join("\n");
  }

  function refreshGuidedPlanBox() {
    const plan = $("phase1GuidedPlan");
    if (!plan) return;
    UI.guidedChapterPlan = UI.guidedChapterPlan || buildGuidedChapterPlan();
    if (document.activeElement !== plan) plan.value = UI.guidedChapterPlan;
  }

  function makeDefaultSection(blueprint, index) {
    const now = NovelDB.now();
    return {
      sectionId: blueprint.sectionId,
      sectionType: blueprint.sectionType,
      title: blueprint.title,
      goal: blueprint.goal,
      selectedMethod: "manual",
      selectedOption: "",
      customInstruction: "",
      draftContent: "",
      finalContent: "",
      previousFinalContent: "",
      summary: "",
      status: index === 0 ? "planning" : "not_started",
      createdAt: now,
      updatedAt: now
    };
  }

  function normalizeSectionWriting(saved = {}) {
    const existing = Array.isArray(saved.sections) ? saved.sections : [];
    const sections = sectionBlueprints.map((blueprint, index) => {
      const found = existing.find((item) => item.sectionId === blueprint.sectionId) || {};
      return {
        ...makeDefaultSection(blueprint, index),
        ...found,
        title: blueprint.title,
        goal: found.goal || blueprint.goal,
        sectionType: blueprint.sectionType
      };
    });
    return {
      version: "section-v1",
      currentIndex: clamp(saved.currentIndex ?? UI.sectionCurrentIndex ?? 0, 0, sections.length - 1),
      sections,
      combinedPreview: saved.combinedPreview || "",
      updatedAt: saved.updatedAt || ""
    };
  }

  async function loadSectionWritingState() {
    UI.sectionCandidate = "";
    UI.combinedChapterPreview = "";
    if (!UI.projectId) {
      UI.sectionWriting = normalizeSectionWriting();
      return;
    }
    const saved = await NovelDB.getSetting(sectionWritingKey());
    UI.sectionWriting = normalizeSectionWriting(saved || {});
    UI.sectionCurrentIndex = UI.sectionWriting.currentIndex || 0;
    UI.combinedChapterPreview = UI.sectionWriting.combinedPreview || "";
  }

  async function saveSectionWritingState() {
    if (!UI.projectId || !UI.sectionWriting) return;
    UI.sectionWriting.currentIndex = clamp(UI.sectionCurrentIndex || 0, 0, sectionBlueprints.length - 1);
    UI.sectionWriting.combinedPreview = UI.combinedChapterPreview || $("phase1CombinedChapterPreview")?.value || "";
    UI.sectionWriting.updatedAt = NovelDB.now();
    await NovelDB.saveSetting(sectionWritingKey(), UI.sectionWriting);
  }

  function currentSection() {
    if (!UI.sectionWriting) UI.sectionWriting = normalizeSectionWriting();
    return UI.sectionWriting.sections[clamp(UI.sectionCurrentIndex || 0, 0, UI.sectionWriting.sections.length - 1)];
  }

  function sectionStatusLabel(status) {
    return {
      not_started: "未完成",
      planning: "規劃中",
      drafting: "草稿中",
      completed: "已完成",
      needs_revision: "待修訂"
    }[status] || "未完成";
  }

  function summarizeSection(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return "上一段尚未完成。";
    const sentences = value.split(/[。！？!?]/).map((item) => item.trim()).filter(Boolean).slice(-3);
    return sentences.length ? `${sentences.join("。")}。` : value.slice(0, 120);
  }

  function previousSectionSummary(index = UI.sectionCurrentIndex) {
    if (!UI.sectionWriting || index <= 0) return "這是本章第一段。";
    const previous = UI.sectionWriting.sections[index - 1];
    return previous.summary || summarizeSection(previous.finalContent || previous.draftContent);
  }

  function nextSectionHint(index = UI.sectionCurrentIndex) {
    if (!UI.sectionWriting || index >= UI.sectionWriting.sections.length - 1) return "下一步可以組合本章正文。";
    const next = UI.sectionWriting.sections[index + 1];
    return `${next.title}：${next.goal}`;
  }

  async function startSectionWriting() {
    if (!UI.projectId || !UI.chapterId) return notify("請先選擇作品與章節。", "error");
    UI.guidedChapterPlan = $("phase1GuidedPlan")?.value.trim() || UI.guidedChapterPlan || buildGuidedChapterPlan();
    await saveGuidedState();
    await loadSectionWritingState();
    showSection("phase1SectionWriter");
    renderSectionWriting();
    $("phase1SectionWriter")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderSectionWriting() {
    const writer = $("phase1SectionWriter");
    if (!writer || !UI.sectionWriting) return;
    showSection("phase1SectionWriter");
    const sections = UI.sectionWriting.sections;
    const section = currentSection();
    const completed = sections.filter((item) => item.status === "completed").length;
    const progress = $("phase1SectionProgress");
    if (progress) progress.textContent = `已完成${completed}／${sections.length}段｜目前第${(UI.sectionCurrentIndex || 0) + 1}段`;
    const list = $("phase1SectionList");
    if (list) {
      list.innerHTML = sections.map((item, index) => `
        <button class="${index === UI.sectionCurrentIndex ? "active" : ""}" onclick="Phase1Novel.selectSection(${index})">
          <b>${index + 1}. ${esc(item.title)}</b>
          <span>${sectionStatusLabel(item.status)}</span>
        </button>`).join("");
    }
    const title = $("phase1SectionTitle");
    if (title) title.textContent = `第${(UI.sectionCurrentIndex || 0) + 1}段｜${section.title}`;
    const status = $("phase1SectionStatus");
    if (status) status.textContent = `${sectionStatusLabel(section.status)}｜${section.updatedAt ? new Date(section.updatedAt).toLocaleTimeString("zh-TW") : "尚未儲存"}`;
    const goal = $("phase1SectionGoal");
    if (goal) goal.textContent = section.goal;
    const prev = $("phase1SectionPrevSummary");
    if (prev) prev.textContent = previousSectionSummary();
    const next = $("phase1SectionNextHint");
    if (next) next.textContent = nextSectionHint();
    const content = $("phase1SectionContent");
    if (content && document.activeElement !== content) content.value = section.finalContent || section.draftContent || "";
    const custom = $("phase1SectionCustom");
    if (custom && document.activeElement !== custom) custom.value = section.customInstruction || "";
    renderSectionMethods();
    renderSectionOptions();
    renderSectionAiStatus();
  }

  function renderSectionMethods() {
    const section = currentSection();
    const method = section.selectedMethod || "manual";
    ["Manual", "Options", "Offline", "Ai"].forEach((name) => {
      const key = name === "Manual" ? "manual" : name === "Options" ? "options" : name === "Offline" ? "offline" : "ai";
      const button = $(`phase1SectionMethod${name}`);
      if (button) button.classList.toggle("active", method === key);
      const panel = $(`phase1Section${name}Panel`);
      if (panel) panel.classList.toggle("hidden", method !== key);
    });
  }

  function buildSectionOptions(section = currentSection()) {
    const ctx = getModeContext();
    const previous = previousSectionSummary();
    const plan = UI.guidedChapterPlan || buildGuidedChapterPlan();
    const base = `${section.title}${section.goal}${previous}${plan}`;
    const action = {
      push: pickDynamic(["當場逼問", "直接指出破綻", "主動交出線索", "先聲奪人"], base),
      cautious: pickDynamic(["先壓下情緒", "暗中確認細節", "暫時不揭穿", "觀察對手反應"], base),
      twist: pickDynamic(["盟友突然改口", "證據出現矛盾", "對手提前佈局", "能力產生異常"], base)
    };
    const sectionSpecific = {
      opening: [
        `${ctx.protagonist}一進入${ctx.worldCore}的核心場景，就感覺到${ctx.opponent}留下的壓迫感。`,
        `${ctx.protagonist}先觀察場景裡不合理的細節，讓讀者慢慢回到本章氣氛。`,
        `開場直接讓${action.twist}，把平靜場景轉成危機。`
      ],
      status: [
        `${ctx.protagonist}主動檢查自己的資源與${ctx.powerCore}，準備把局面往前推。`,
        `${ctx.protagonist}先承認自己狀態不穩，選擇保留底牌。`,
        `${ctx.protagonist}發現身體或心理狀態出現異常，迫使策略改變。`
      ],
      incident: [
        `${ctx.opponent}當眾指出關鍵破綻，迫使${ctx.protagonist}立即回應。`,
        `${ctx.protagonist}先察覺證據被動過，選擇暫時不揭穿。`,
        `原本支持${ctx.protagonist}的${ctx.ally}突然承認線索由自己提供。`
      ],
      reaction: [
        `${ctx.protagonist}立刻用一句話反壓回去，讓場面安靜下來。`,
        `${ctx.protagonist}先觀察眾人眼神，判斷誰正在說謊。`,
        `${ctx.ally}的反應比${ctx.opponent}更激烈，讓局勢偏離預期。`
      ],
      escalation: [
        `${ctx.protagonist}${action.push}，把${ctx.opponent}逼到必須亮出下一張牌。`,
        `${ctx.protagonist}${action.cautious}，但壓力仍因旁人追問而升高。`,
        `${action.twist}讓衝突從言語變成不可退讓的選擇。`
      ],
      midpoint: [
        `${ctx.protagonist}突然看穿真正問題不在證據，而在${ctx.opponent}刻意引導的方向。`,
        `${ctx.protagonist}暫時放棄反擊，改追查誰最早知道這件事。`,
        `${ctx.ally}拿出一個反常證據，讓主角原本的判斷被推翻。`
      ],
      choice: [
        `${ctx.protagonist}選擇公開一部分真相，換取主線快速推進。`,
        `${ctx.protagonist}選擇保護${ctx.ally}，暫時吞下被誤解的代價。`,
        `${ctx.protagonist}用${ctx.powerCore}解決眼前困境，但留下反噬或身分風險。`
      ],
      ending: [
        `${ctx.protagonist}表面穩住局面，卻在章尾收到一個不可能存在的訊息。`,
        `${ctx.protagonist}只得到半個答案，真正證據落到${ctx.opponent}手中。`,
        `${ctx.ally}在章尾做出不符合立場的選擇，讓下一章充滿懸念。`
      ]
    }[section.sectionId] || [];
    return {
      A: {
        label: "A",
        trait: "積極推進",
        text: sectionSpecific[0] || `${ctx.protagonist}主動推進本段目標，讓衝突更快浮上檯面。`,
        risk: "高",
        progress: "快",
        cost: "容易暴露底牌或讓對手警覺。",
        impact: "主線速度提升，張力明顯增加。",
        pace: "快節奏"
      },
      B: {
        label: "B",
        trait: "謹慎處理",
        text: sectionSpecific[1] || `${ctx.protagonist}先保留判斷，從上一段留下的細節中尋找更穩的切入點。`,
        risk: "低至中",
        progress: "中",
        cost: "需要靠細節維持讀者期待。",
        impact: "角色會更穩，但爽點延後。",
        pace: "穩定鋪陳"
      },
      C: {
        label: "C",
        trait: "轉折或高代價",
        text: sectionSpecific[2] || `${action.twist}，讓本段從預期路線轉向更高代價的局面。`,
        risk: "中高",
        progress: "中",
        cost: "可能造成關係變化或後續矛盾。",
        impact: "段落記憶點更強，後段需要承接。",
        pace: "轉折節奏"
      }
    };
  }

  function renderSectionOptions() {
    const box = $("phase1SectionOptions");
    if (!box || !UI.sectionWriting) return;
    const section = currentSection();
    const options = buildSectionOptions(section);
    box.innerHTML = ["A", "B", "C"].map((key) => {
      const option = options[key];
      const active = section.selectedOption === key ? " active" : "";
      return `
        <button class="phase1-guided-choice${active}" onclick="Phase1Novel.chooseSectionOption('${key}')">
          <b>${option.label}｜${option.trait}</b>
          <span>${esc(option.text)}</span>
          <small>風險：${option.risk}｜推進：${option.progress}｜代價：${esc(option.cost)}</small>
        </button>`;
    }).join("");
    const outcome = $("phase1SectionOptionOutcome");
    if (outcome) {
      const selected = section.selectedOption === "D" ? buildSectionCustomOption() : options[section.selectedOption];
      outcome.textContent = selected ? formatSectionOption(selected) : "尚未選擇本段寫法。";
    }
  }

  function buildSectionCustomOption() {
    const text = $("phase1SectionCustom")?.value.trim() || currentSection().customInstruction || "作者自訂本段寫法";
    const outcome = estimateCustomOutcome(text);
    return { label: "D", trait: "自訂寫法", text, ...outcome };
  }

  function formatSectionOption(option) {
    return [
      `【本段選擇】${option.label}｜${option.trait}`,
      option.text,
      "",
      `風險：${option.risk}`,
      `主線推進：${option.progress}`,
      `可能代價：${option.cost}`,
      `可能影響：${option.impact}`,
      `適合節奏：${option.pace}`
    ].join("\n");
  }

  async function setSectionMethod(method) {
    if (!UI.sectionWriting) await startSectionWriting();
    const section = currentSection();
    section.selectedMethod = method;
    section.status = section.status === "not_started" ? "planning" : section.status;
    section.updatedAt = NovelDB.now();
    await saveSectionWritingState();
    renderSectionWriting();
  }

  function chooseSectionOption(option) {
    const section = currentSection();
    section.selectedMethod = "options";
    section.selectedOption = option;
    if (option === "D") section.customInstruction = $("phase1SectionCustom")?.value.trim() || section.customInstruction || "";
    const selected = option === "D" ? buildSectionCustomOption() : buildSectionOptions(section)[option];
    const outcome = $("phase1SectionOptionOutcome");
    if (outcome) outcome.textContent = selected ? formatSectionOption(selected) : "尚未選擇本段寫法。";
    renderSectionOptions();
  }

  async function confirmSectionOption() {
    const section = currentSection();
    if (!section.selectedOption) return notify("請先選擇本段 A／B／C，或輸入 D 自訂寫法。", "error");
    const selected = section.selectedOption === "D" ? buildSectionCustomOption() : buildSectionOptions(section)[section.selectedOption];
    section.customInstruction = section.selectedOption === "D" ? selected.text : section.customInstruction || "";
    section.draftContent = section.draftContent || `【本段規劃】\n${formatSectionOption(selected)}`;
    section.status = "planning";
    section.updatedAt = NovelDB.now();
    await saveSectionWritingState();
    renderSectionWriting();
    notify("已保存本段寫法，尚未覆蓋其他段落。");
  }

  async function regenerateSectionOptions() {
    const section = currentSection();
    section.selectedOption = "";
    section.customInstruction = "";
    section.updatedAt = NovelDB.now();
    await saveSectionWritingState();
    renderSectionWriting();
  }

  function activeSectionChoiceText(section = currentSection()) {
    if (section.selectedOption === "D") return section.customInstruction || $("phase1SectionCustom")?.value.trim() || "";
    if (!section.selectedOption) return "";
    return buildSectionOptions(section)[section.selectedOption]?.text || "";
  }

  function buildOfflineSectionDraft() {
    const ctx = getModeContext();
    const section = currentSection();
    const previous = previousSectionSummary();
    const choice = activeSectionChoiceText(section);
    const plan = UI.guidedChapterPlan || $("phase1GuidedPlan")?.value.trim() || buildGuidedChapterPlan();
    const tone = ctx.style.includes("爽") ? "節奏要快，句子要有壓迫感" : ctx.style.includes("甜") ? "情緒要細，互動要清楚" : "節奏穩定，細節清楚";
    const opener = {
      opening: `${ctx.protagonist}重新站在${ctx.worldCore}的壓力中心，四周的聲音像被壓低了一層。`,
      status: `上一段的餘波還沒有散去，${ctx.protagonist}先確認自己的狀態與手中能用的資源。`,
      incident: `就在局面似乎可以暫時穩住時，真正的衝突忽然出現。`,
      reaction: `${ctx.protagonist}沒有立刻說話，而是先看向最可能出手的人。`,
      escalation: `事情沒有照原本的方向停下，反而因為一句話被推得更高。`,
      midpoint: `直到這一刻，${ctx.protagonist}才意識到自己前面的判斷少了一塊。`,
      choice: `${ctx.protagonist}知道再拖下去只會失去主動權，所以必須做出選擇。`,
      ending: `本章的結果看似落定，但真正的懸念才剛被推到眼前。`
    }[section.sectionId] || `${ctx.protagonist}順著上一段的壓力繼續往前走。`;
    const action = choice || section.goal;
    const draft = [
      opener,
      `上一段留下的重點是：${previous}`,
      `${action} 這個決定讓${ctx.opponent}的反應變得更難預測，也讓${ctx.ally}不得不重新判斷主角的立場。`,
      `${tone}。因此本段不急著寫完整一章，只把焦點放在「${section.title}」：${section.goal}`,
      `到段落結尾時，${ctx.protagonist}至少要得到一個新的判斷，或付出一個小代價，讓下一段能自然接上。`
    ].join("\n\n");
    return draft.slice(0, 720);
  }

  async function generateOfflineSectionDraft(regenerate = false) {
    if (!UI.sectionWriting) await startSectionWriting();
    const section = currentSection();
    section.selectedMethod = "offline";
    UI.sectionCandidate = buildOfflineSectionDraft();
    section.status = "drafting";
    section.updatedAt = NovelDB.now();
    await saveSectionWritingState();
    const box = $("phase1SectionCandidate");
    if (box) box.textContent = `【離線短草稿】\n${UI.sectionCandidate}`;
    renderSectionWriting();
    notify(regenerate ? "已重新產生本段離線短草稿。" : "已產生本段離線短草稿。");
  }

  function editSectionCandidate() {
    const box = $("phase1SectionCandidate");
    const sectionContent = $("phase1SectionContent");
    if (box && sectionContent) {
      sectionContent.value = UI.sectionCandidate || box.textContent.replace(/^【.*?】\s*/, "");
      setSectionMethod("manual");
    }
  }

  async function applySectionCandidate(mode) {
    const candidate = UI.sectionCandidate || $("phase1SectionCandidate")?.textContent.replace(/^【.*?】\s*/, "").trim() || $("phase1SectionAiCandidate")?.textContent.replace(/^【.*?】\s*/, "").trim();
    if (!candidate) return notify("尚未產生本段候選稿。", "error");
    const section = currentSection();
    const current = $("phase1SectionContent")?.value || section.finalContent || section.draftContent || "";
    section.previousFinalContent = section.finalContent || section.previousFinalContent || "";
    if (mode === "append" && current.trim()) section.finalContent = `${current.trimEnd()}\n\n${candidate}`;
    else section.finalContent = candidate;
    section.draftContent = section.finalContent;
    section.status = "drafting";
    section.updatedAt = NovelDB.now();
    await saveSectionWritingState();
    renderSectionWriting();
    notify("候選稿已套用到目前段落，未覆蓋其他段落。");
  }

  function discardSectionCandidate() {
    UI.sectionCandidate = "";
    const box = $("phase1SectionCandidate");
    if (box) box.textContent = "已放棄本段候選稿。";
    const aiBox = $("phase1SectionAiCandidate");
    if (aiBox) aiBox.textContent = "已放棄本段AI候選稿。";
  }

  function renderSectionAiStatus() {
    const status = $("phase1SectionAiStatus");
    const button = $("phase1SectionAiButton");
    if (!status) return;
    const cfg = window.NovelAIService?.getConfig ? NovelAIService.getConfig() : { provider: "chat", model: "" };
    const cloud = cfg.provider === "gemini" || cfg.provider === "chat" || cfg.provider === "cloud" || cfg.provider === "openai";
    if (cloud && !navigator.onLine) {
      status.textContent = "雲端AI需要網路；離線短草稿與A/B/C/D仍可使用。";
      if (button) button.disabled = true;
      return;
    }
    if (button) button.disabled = false;
    status.textContent = `目前模式：${cfg.provider || "未設定"}｜模型：${cfg.model || "尚未設定"}｜只產生目前段落候選稿`;
  }

  async function generateAiSectionCandidate() {
    if (!UI.sectionWriting) await startSectionWriting();
    const cfg = NovelAIService.getConfig();
    const cloud = cfg.provider === "gemini" || cfg.provider === "chat" || cfg.provider === "cloud" || cfg.provider === "openai";
    if (cloud && !navigator.onLine) return notify("雲端AI需要網路；請改用離線短草稿。", "error");
    const section = currentSection();
    const ctx = getModeContext();
    const request = $("phase1SectionAiRequest")?.value.trim() || "請生成本段候選正文。";
    const prompt = [
      "請只產生目前段落的小說候選正文，150至400字，不要寫完整一章，不要覆蓋其他段落。",
      `作品核心：${ctx.title}｜${ctx.genre}｜${ctx.coreIdea}`,
      `本章規劃：${UI.guidedChapterPlan || buildGuidedChapterPlan()}`,
      `上一段摘要：${previousSectionSummary()}`,
      `本段：${section.title}`,
      `本段目的：${section.goal}`,
      `本段選擇：${activeSectionChoiceText(section) || "尚未指定"}`,
      `下一段方向：${nextSectionHint()}`,
      `文風：${ctx.style}`,
      "禁止修改事項：不要更改主角姓名，不要新增大量陌生人物，不要重寫整章。",
      `作者要求：${request}`
    ].join("\n\n");
    const button = $("phase1SectionAiButton");
    if (button) button.disabled = true;
    try {
      const result = await NovelAIService.generate(`${prompt}\n\n下一章寫作參考：\n${stateReference}`);
      UI.sectionCandidate = result;
      section.selectedMethod = "ai";
      section.status = "drafting";
      section.updatedAt = NovelDB.now();
      await saveSectionWritingState();
      const box = $("phase1SectionCandidate");
      if (box) box.textContent = `【AI本段候選稿】\n${result}`;
      const aiBox = $("phase1SectionAiCandidate");
      if (aiBox) aiBox.textContent = `【AI本段候選稿】\n${result}`;
      notify("已產生本段AI候選稿，尚未套用。");
    } catch (error) {
      notify(`AI候選稿產生失敗：${error.message || error}。原段落內容已保留。`, "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function saveCurrentSection() {
    if (!UI.sectionWriting) await startSectionWriting();
    const section = currentSection();
    const text = $("phase1SectionContent")?.value || "";
    section.previousFinalContent = section.finalContent && section.finalContent !== text ? section.finalContent : section.previousFinalContent || "";
    section.finalContent = text;
    section.draftContent = text;
    section.summary = summarizeSection(text);
    section.status = text.trim() ? "drafting" : "planning";
    section.updatedAt = NovelDB.now();
    await saveSectionWritingState();
    renderSectionWriting();
    if (UI.sectionCurrentIndex < UI.sectionWriting.sections.length - 1 && text.trim()) {
      notify("本段已儲存。若你修改了前段，請確認後續段落是否仍然連貫。");
    } else {
      notify("本段已儲存。");
    }
  }

  async function markCurrentSectionComplete() {
    await saveCurrentSection();
    const section = currentSection();
    section.status = "completed";
    section.summary = summarizeSection(section.finalContent || section.draftContent);
    section.updatedAt = NovelDB.now();
    await saveSectionWritingState();
    renderSectionWriting();
    notify("本段已標記完成。");
  }

  async function markCurrentSectionNeedsRevision() {
    const section = currentSection();
    section.status = "needs_revision";
    section.updatedAt = NovelDB.now();
    await saveSectionWritingState();
    renderSectionWriting();
    notify("本段已標記待修訂。");
  }

  async function restoreSectionPrevious() {
    const section = currentSection();
    if (!section.previousFinalContent) return notify("此段沒有可恢復的上一版本。", "error");
    section.finalContent = section.previousFinalContent;
    section.draftContent = section.previousFinalContent;
    section.summary = summarizeSection(section.finalContent);
    section.updatedAt = NovelDB.now();
    await saveSectionWritingState();
    renderSectionWriting();
    notify("已恢復本段上一版本，其他段落未變更。");
  }

  async function selectSection(index) {
    if (!UI.sectionWriting) await startSectionWriting();
    await saveCurrentSection();
    UI.sectionCurrentIndex = clamp(index, 0, UI.sectionWriting.sections.length - 1);
    UI.sectionWriting.currentIndex = UI.sectionCurrentIndex;
    UI.sectionCandidate = "";
    await saveSectionWritingState();
    renderSectionWriting();
  }

  async function prevSection() {
    if (!UI.sectionWriting || UI.sectionCurrentIndex <= 0) return notify("已經是第一段。");
    await selectSection(UI.sectionCurrentIndex - 1);
  }

  async function nextSection() {
    if (!UI.sectionWriting) await startSectionWriting();
    const section = currentSection();
    await saveCurrentSection();
    if (section.status !== "completed") notify("上一段尚未完成，後續內容可能不連貫。");
    if (UI.sectionCurrentIndex >= UI.sectionWriting.sections.length - 1) return combineChapterSections();
    await selectSection(UI.sectionCurrentIndex + 1);
  }

  async function markEditorAsCurrentSection() {
    if (!UI.sectionWriting) await startSectionWriting();
    const editor = $("phase1ChapterContent");
    const text = editor?.value || "";
    if (!text.trim()) return notify("自由寫作正文目前是空的，無法標記為本段內容。", "error");
    const section = currentSection();
    section.previousFinalContent = section.finalContent || "";
    section.finalContent = text.slice(-1200);
    section.draftContent = section.finalContent;
    section.summary = summarizeSection(section.finalContent);
    section.status = "drafting";
    section.updatedAt = NovelDB.now();
    await saveSectionWritingState();
    renderSectionWriting();
    notify("已將自由寫作正文末段標記為目前段落內容。");
  }

  function buildCombinedChapterText() {
    if (!UI.sectionWriting) return "";
    return UI.sectionWriting.sections
      .map((section) => String(section.finalContent || section.draftContent || "").trim())
      .filter(Boolean)
      .join("\n\n");
  }

  async function combineChapterSections() {
    if (!UI.sectionWriting) await startSectionWriting();
    await saveCurrentSection();
    UI.combinedChapterPreview = buildCombinedChapterText();
    const panel = $("phase1SectionCombinePanel");
    const preview = $("phase1CombinedChapterPreview");
    if (panel) showSection("phase1SectionCombinePanel");
    if (preview) preview.value = UI.combinedChapterPreview;
    await saveSectionWritingState();
    notify("已組合本章正文預覽，尚未套用到章節正文。");
  }

  async function applyCombinedChapter() {
    if (!UI.chapterId) return notify("請先選擇章節。", "error");
    const text = $("phase1CombinedChapterPreview")?.value.trim() || UI.combinedChapterPreview || buildCombinedChapterText();
    if (!text) return notify("沒有可套用的本章正文。", "error");
    const loaded = await NovelDB.loadProject(UI.projectId);
    await NovelDB.createVersion(UI.projectId, "套用分段正文前快照", loaded, { reason: "apply-section-combined" });
    const editor = $("phase1ChapterContent");
    if (editor) editor.value = text;
    await saveCurrentChapter("apply-section-combined", true);
    notify("已套用為本章正文，並建立版本快照。");
  }

  async function copyCombinedChapter() {
    const text = $("phase1CombinedChapterPreview")?.value.trim() || UI.combinedChapterPreview || buildCombinedChapterText();
    if (!text) return notify("沒有可複製的本章正文。", "error");
    try {
      await navigator.clipboard.writeText(text);
      notify("本章全文已複製。");
    } catch (error) {
      notify("無法直接複製，請手動選取全文。", "error");
    }
  }

  async function saveCombinedAsVersion() {
    if (!UI.projectId) return notify("請先選擇作品。", "error");
    UI.combinedChapterPreview = $("phase1CombinedChapterPreview")?.value.trim() || UI.combinedChapterPreview || buildCombinedChapterText();
    await saveSectionWritingState();
    const loaded = await NovelDB.loadProject(UI.projectId);
    await NovelDB.createVersion(UI.projectId, "分段正文候選版本", loaded, { reason: "section-combined-candidate", combinedPreview: UI.combinedChapterPreview });
    notify("已儲存為候選版本，未覆蓋正文。");
  }

  function hideCombinedPreview() {
    hideSection("phase1SectionCombinePanel");
  }

  function discardCombinedChapter() {
    UI.combinedChapterPreview = "";
    const preview = $("phase1CombinedChapterPreview");
    if (preview) preview.value = "";
    hideCombinedPreview();
    notify("已放棄本次組合預覽，段落內容仍保留。");
  }

  function emptyChapterClosingSummary() {
    return {
      chapterResult: "",
      protagonistState: "",
      currentLocation: "",
      unresolvedEvent: "",
      nextChapterHook: "",
      updatedAt: ""
    };
  }

  function ensureChapterClosingPanel() {
    if ($("phase1ChapterClosingPanel")) return;
    const host = $("phase1SectionCombinePanel");
    if (!host) return;
    const panel = document.createElement("div");
    panel.id = "phase1ChapterClosingPanel";
    panel.className = "phase1-guided-plan-box";
    panel.innerHTML = `
      <h3>本章結束整理</h3>
      <p class="muted">只保存本章銜接資訊，不會改動正文、八段內容或作品設定。</p>
      <div class="grid2">
        <label>本章結果<textarea id="phase1ClosingResult" placeholder="例如：主角暫時解決眼前危機，但反派已經察覺。"></textarea></label>
        <label>主角目前狀態<textarea id="phase1ClosingProtagonistState" placeholder="例如：受傷、警覺、掌握新線索、情緒動搖。"></textarea></label>
        <label>目前地點<textarea id="phase1ClosingLocation" placeholder="例如：仙門後山、公司會議室、皇城暗牢。"></textarea></label>
        <label>尚未解決的事件<textarea id="phase1ClosingUnresolved" placeholder="例如：帳冊來源未明、盟友是否背叛仍未確認。"></textarea></label>
        <label>下一章懸念<textarea id="phase1ClosingHook" placeholder="例如：一封不該存在的信出現在主角房中。"></textarea></label>
      </div>
      <div class="bar">
        <button class="btn green" onclick="Phase1Novel.saveChapterClosingSummary()">儲存本章整理</button>
        <button class="btn gold" onclick="Phase1Novel.applyChapterClosingToNextReference()">套用到下一章參考</button>
        <button class="btn red" onclick="Phase1Novel.clearChapterClosingSummary()">清除本章整理</button>
      </div>
      <div id="phase1ChapterClosingStatus" class="notice">本章整理尚未儲存。</div>
      <div id="phase1ChapterBridgeReference" class="out phase1-small-out">上一章銜接資料：尚未套用。</div>
    `;
    host.appendChild(panel);
  }

  async function readChapterClosingSummary() {
    if (!UI.projectId || !UI.chapterId) return emptyChapterClosingSummary();
    return { ...emptyChapterClosingSummary(), ...((await NovelDB.getSetting(chapterClosingKey())) || {}) };
  }

  function collectChapterClosingSummary() {
    return {
      chapterResult: $("phase1ClosingResult")?.value || "",
      protagonistState: $("phase1ClosingProtagonistState")?.value || "",
      currentLocation: $("phase1ClosingLocation")?.value || "",
      unresolvedEvent: $("phase1ClosingUnresolved")?.value || "",
      nextChapterHook: $("phase1ClosingHook")?.value || "",
      updatedAt: NovelDB.now()
    };
  }

  async function renderChapterClosingSummaryPanel() {
    ensureChapterClosingPanel();
    const panel = $("phase1ChapterClosingPanel");
    if (!panel) return;
    const active = document.activeElement;
    const editing = active && panel.contains(active);
    const summary = await readChapterClosingSummary();
    UI.chapterClosingSummary = summary;
    if (!editing) {
      if ($("phase1ClosingResult")) $("phase1ClosingResult").value = summary.chapterResult || "";
      if ($("phase1ClosingProtagonistState")) $("phase1ClosingProtagonistState").value = summary.protagonistState || "";
      if ($("phase1ClosingLocation")) $("phase1ClosingLocation").value = summary.currentLocation || "";
      if ($("phase1ClosingUnresolved")) $("phase1ClosingUnresolved").value = summary.unresolvedEvent || "";
      if ($("phase1ClosingHook")) $("phase1ClosingHook").value = summary.nextChapterHook || "";
    }
    const status = $("phase1ChapterClosingStatus");
    if (status) status.textContent = summary.updatedAt ? `本章整理已儲存：${new Date(summary.updatedAt).toLocaleString("zh-TW")}` : "本章整理尚未儲存。";
    await renderChapterClosingReference();
  }

  async function renderChapterClosingReference() {
    const box = $("phase1ChapterBridgeReference");
    if (!box || !UI.projectId) return;
    const ref = (await NovelDB.getSetting(chapterClosingNextKey())) || null;
    if (!ref) {
      box.textContent = "上一章銜接資料：尚未套用。";
      return;
    }
    box.textContent = [
      "上一章銜接資料",
      `上一章結果：${ref.chapterResult || "未填寫"}`,
      `主角狀態：${ref.protagonistState || "未填寫"}`,
      `起始地點：${ref.currentLocation || "未填寫"}`,
      `未解事件：${ref.unresolvedEvent || "未填寫"}`,
      `下一章懸念：${ref.nextChapterHook || "未填寫"}`
    ].join("\n");
  }

  async function saveChapterClosingSummary() {
    if (!UI.projectId || !UI.chapterId) return notify("請先選擇作品與章節。", "error");
    try {
      const summary = collectChapterClosingSummary();
      await NovelDB.saveSetting(chapterClosingKey(), summary);
      UI.chapterClosingSummary = summary;
      await renderChapterClosingSummaryPanel();
      notify("本章整理已儲存。");
    } catch (error) {
      notify("本章整理儲存失敗，但正文與原有作品資料仍然安全。", "error");
    }
  }

  async function applyChapterClosingToNextReference() {
    if (!UI.projectId || !UI.chapterId) return notify("請先選擇作品與章節。", "error");
    try {
      const summary = collectChapterClosingSummary();
      await NovelDB.saveSetting(chapterClosingKey(), summary);
      await NovelDB.saveSetting(chapterClosingNextKey(), { ...summary, sourceChapterId: UI.chapterId });
      UI.chapterClosingSummary = summary;
      await renderChapterClosingSummaryPanel();
      notify("已套用到下一章參考，不會覆蓋正文。");
    } catch (error) {
      notify("本章整理儲存失敗，但正文與原有作品資料仍然安全。", "error");
    }
  }

  async function clearChapterClosingSummary() {
    if (!UI.projectId || !UI.chapterId) return notify("請先選擇作品與章節。", "error");
    if (!confirmSafe("確定清除此章的本章結束整理？正文、規劃、八段內容與作品設定都不會被刪除。")) return;
    try {
      await NovelDB.saveSetting(chapterClosingKey(), emptyChapterClosingSummary());
      UI.chapterClosingSummary = emptyChapterClosingSummary();
      await renderChapterClosingSummaryPanel();
      notify("已清除此章整理，正文未被修改。");
    } catch (error) {
      notify("本章整理儲存失敗，但正文與原有作品資料仍然安全。", "error");
    }
  }

  function emptyStoryMemory() {
    return {
      storyState: { currentChapter: 0, currentTime: "", currentLocation: "", mainConflict: "", chapterResult: "", nextHook: "" },
      characterStates: [],
      unresolvedEvents: [],
      secrets: [],
      storyItems: [],
      stateUpdatedAt: ""
    };
  }

  function normalizeStoryMemory(raw = {}) {
    const base = emptyStoryMemory();
    return {
      storyState: { ...base.storyState, ...(raw.storyState || {}) },
      characterStates: Array.isArray(raw.characterStates) ? raw.characterStates : [],
      unresolvedEvents: Array.isArray(raw.unresolvedEvents) ? raw.unresolvedEvents : [],
      secrets: Array.isArray(raw.secrets) ? raw.secrets : [],
      storyItems: Array.isArray(raw.storyItems) ? raw.storyItems : [],
      stateUpdatedAt: raw.stateUpdatedAt || ""
    };
  }

  function currentProject() {
    return UI.projects.find((item) => item.id === UI.projectId) || {};
  }

  function getStoryMemory() {
    return normalizeStoryMemory(currentProject().state || {});
  }

  async function saveStoryMemory(memory) {
    if (!UI.projectId) return notify("請先選擇作品。", "error");
    const project = await NovelDB.get("projects", UI.projectId);
    if (!project) return notify("找不到目前作品。", "error");
    const nextMemory = normalizeStoryMemory({ ...memory, stateUpdatedAt: NovelDB.now() });
    await NovelDB.put("projects", {
      ...project,
      state: NovelDB.sanitizeState({ ...(project.state || {}), ...nextMemory }),
      updatedAt: NovelDB.now()
    });
    await loadLists();
    renderStoryStatePanel();
  }

  function latestChapterText() {
    return $("phase1CombinedChapterPreview")?.value.trim()
      || UI.combinedChapterPreview
      || buildCombinedChapterText()
      || $("phase1ChapterContent")?.value
      || UI.chapters.find((item) => item.id === UI.chapterId)?.content
      || "";
  }

  function sectionTextBundle() {
    return (UI.sectionWriting?.sections || [])
      .map((section) => section.finalContent || section.draftContent || "")
      .filter(Boolean)
      .join("\n\n");
  }

  function pickLocation(text) {
    const match = String(text || "").match(/(?:來到|抵達|留在|站在|回到|進入|轉入|場景轉入|位於|在)([^，。；\n]{2,16})(?:中|裡|內|前|上|旁|。|，|；|\n)/);
    return match ? match[1].trim() : "";
  }

  function inferImportance(text) {
    return /死亡|背叛|真相|黑幕|身份|身分|核心|最終|重大|代價/.test(text) ? "高" : (/疑點|證據|調查|衝突/.test(text) ? "中" : "低");
  }

  function buildStoryStateCandidates() {
    const ctx = getModeContext();
    const chapter = normalizeChapter(UI.chapters.find((item) => item.id === UI.chapterId));
    const chapterNumber = chapter.order || chapter.chapterNumber || UI.chapters.length || 1;
    const plan = UI.guidedChapterPlan || $("phase1GuidedPlan")?.value || "";
    const text = [plan, sectionTextBundle(), latestChapterText()].join("\n\n").trim();
    const tail = shortText(text.slice(-600), 260);
    const location = pickLocation(text) || getStoryMemory().storyState.currentLocation || ctx.worldCore || "";
    const hook = (/章尾|懸念|鉤子|下一章|下回/.test(text) ? tail : shortText(chapter.hook || text.slice(-180), 180));
    const result = shortText(text.slice(-360), 180);
    const protagonist = ctx.protagonist || "主角";
    const opponent = ctx.opponent || "對手";
    const candidates = [];
    const add = (type, label, data) => candidates.push({ id: NovelDB.safeId("state_candidate"), type, label, data, decision: "pending" });

    add("story", `更新當前故事：地點「${location || "未標明"}」，本章結果「${result}」，下一步懸念「${hook}」。`, {
      currentChapter: chapterNumber,
      currentTime: "本章結束後",
      currentLocation: location,
      mainConflict: ctx.conflict || "",
      chapterResult: result,
      nextHook: hook
    });
    add("character", `更新角色狀態：${protagonist} 目標轉為「處理${ctx.conflict || "目前衝突"}」，位置在「${location || "未標明"}」。`, {
      name: protagonist,
      currentGoal: `處理${ctx.conflict || "目前衝突"}`,
      emotion: /失敗|代價|受傷|背叛/.test(text) ? "緊繃" : "警覺",
      location,
      condition: /受傷|流血|昏迷|重傷/.test(text) ? "受傷或狀態不穩" : "可行動",
      alive: !/死亡|身亡|死去/.test(text),
      knownInfo: shortText(plan || ctx.conflict, 120),
      lastSeenChapter: chapterNumber
    });
    if (opponent && opponent !== protagonist) {
      add("character", `更新角色狀態：${opponent} 已對主角造成壓力或開始警覺。`, {
        name: opponent,
        currentGoal: "壓制主角或維持優勢",
        emotion: /被揭穿|失敗/.test(text) ? "不安" : "警覺",
        location: location || "未知",
        condition: "可行動",
        alive: true,
        knownInfo: "已注意到主角的行動",
        lastSeenChapter: chapterNumber
      });
    }
    if (/失蹤|調包|黑幕|背叛|謎|疑點|倒數|追殺|威脅|未解|陷阱/.test(text)) {
      add("event", `新增未解事件：${ctx.conflict || "本章留下的衝突"}。`, {
        eventName: ctx.conflict || "本章留下的衝突",
        description: tail,
        createdChapter: chapterNumber,
        importance: inferImportance(text),
        status: "未處理"
      });
    }
    if (/解決|揭穿|平息|破局|找到答案|真相大白/.test(text)) {
      add("resolvedEvent", `標記可能已解決事件：${ctx.conflict || "上一章衝突"}。`, {
        eventName: ctx.conflict || "上一章衝突",
        status: "已解決"
      });
    }
    if (/秘密|真相|身份|身分|血脈|內鬼|證據|不能說|隱瞞/.test(text)) {
      const secretText = shortText(text.match(/(?:秘密|真相|身份|身分|血脈|內鬼|證據)[^。；\n]{0,100}/)?.[0] || "本章出現新的秘密或關鍵資訊", 120);
      add("secret", `新增秘密：${secretText}。`, {
        content: secretText,
        knownBy: [protagonist],
        isPublic: /公開|曝光|揭露|眾人知道/.test(text),
        publicChapter: /公開|曝光|揭露|眾人知道/.test(text) ? chapterNumber : null
      });
    }
    if (/公開|曝光|揭露|眾人知道/.test(text)) {
      add("publicSecret", "標記可能已公開秘密：本章有秘密被公開或曝光。", {
        content: "本章有秘密被公開或曝光",
        publicChapter: chapterNumber
      });
    }
    const itemMatch = text.match(/(證據|帳冊|鑰匙|信件|玉佩|令牌|手機|卷軸|道具|武器|戒指)[^。；\n]{0,40}/);
    if (itemMatch) {
      add("item", `更新道具：${itemMatch[0]} 目前由 ${protagonist} 或相關角色掌握。`, {
        itemName: itemMatch[0],
        holder: protagonist,
        location,
        status: "出現或轉移",
        lastSeenChapter: chapterNumber
      });
    }
    return candidates;
  }

  async function prepareStoryStateCandidates() {
    if (!UI.projectId) return notify("請先選擇或建立作品，再整理故事狀態。", "error");
    UI.storyStateCandidates = buildStoryStateCandidates();
    await NovelDB.saveSetting(`story-state-candidates-${UI.projectId}`, UI.storyStateCandidates);
    renderStoryStatePanel();
    $("phase1StoryStatePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    notify("已產生故事狀態更新候選，請逐項接受、修改或忽略。");
  }

  function mergeByName(rows, next, nameKey) {
    const copy = [...rows];
    const index = copy.findIndex((row) => String(row[nameKey] || "").trim() === String(next[nameKey] || "").trim());
    if (index >= 0) copy[index] = { ...copy[index], ...next };
    else copy.push({ id: NovelDB.safeId(nameKey), ...next });
    return copy;
  }

  function applyStoryCandidate(memory, candidate) {
    const data = candidate.data || {};
    if (candidate.type === "story") memory.storyState = { ...memory.storyState, ...data };
    if (candidate.type === "character") memory.characterStates = mergeByName(memory.characterStates, data, "name");
    if (candidate.type === "event") memory.unresolvedEvents = mergeByName(memory.unresolvedEvents, data, "eventName");
    if (candidate.type === "resolvedEvent") memory.unresolvedEvents = memory.unresolvedEvents.map((event) => event.eventName === data.eventName ? { ...event, status: "已解決" } : event);
    if (candidate.type === "secret") memory.secrets = mergeByName(memory.secrets, data, "content");
    if (candidate.type === "publicSecret") memory.secrets = memory.secrets.map((secret) => String(secret.content || "").includes(String(data.content || "").slice(0, 8)) ? { ...secret, isPublic: true, publicChapter: data.publicChapter } : secret);
    if (candidate.type === "item") memory.storyItems = mergeByName(memory.storyItems, data, "itemName");
    return memory;
  }

  async function decideStoryStateCandidate(index, decision) {
    if (!UI.projectId) return notify("請先選擇作品。", "error");
    const candidate = UI.storyStateCandidates[index];
    if (!candidate) return;
    candidate.decision = decision;
    await NovelDB.saveSetting(`story-state-candidates-${UI.projectId}`, UI.storyStateCandidates);
    renderStoryStatePanel();
  }

  async function editStoryStateCandidate(index) {
    const candidate = UI.storyStateCandidates[index];
    if (!candidate) return;
    const next = prompt("修改候選文字：", candidate.label || "");
    if (next === null) return;
    candidate.label = next.trim() || candidate.label;
    candidate.decision = "accepted";
    await NovelDB.saveSetting(`story-state-candidates-${UI.projectId}`, UI.storyStateCandidates);
    renderStoryStatePanel();
  }

  async function acceptAllStoryStateCandidates() {
    if (!UI.projectId) return notify("請先選擇作品。", "error");
    UI.storyStateCandidates = UI.storyStateCandidates.map((candidate) => ({ ...candidate, decision: "accepted" }));
    await NovelDB.saveSetting(`story-state-candidates-${UI.projectId}`, UI.storyStateCandidates);
    renderStoryStatePanel();
  }

  async function ignoreAllStoryStateCandidates() {
    if (!UI.projectId) return notify("請先選擇作品。", "error");
    UI.storyStateCandidates = UI.storyStateCandidates.map((candidate) => ({ ...candidate, decision: "ignored" }));
    await NovelDB.saveSetting(`story-state-candidates-${UI.projectId}`, UI.storyStateCandidates);
    renderStoryStatePanel();
  }

  async function saveAcceptedStoryStateCandidates() {
    if (!UI.projectId) return notify("請先選擇作品。", "error");
    let memory = getStoryMemory();
    UI.storyStateCandidates.filter((candidate) => candidate.decision === "accepted").forEach((candidate) => {
      memory = applyStoryCandidate(memory, candidate);
    });
    await saveStoryMemory(memory);
    UI.storyStateCandidates = UI.storyStateCandidates.filter((candidate) => candidate.decision === "pending");
    await NovelDB.saveSetting(`story-state-candidates-${UI.projectId}`, UI.storyStateCandidates);
    renderStoryStatePanel();
    notify("故事狀態已儲存，正文未被修改。");
  }

  function itemSummary(type, row) {
    if (type === "character") return `${row.name || "未命名"}｜目標：${row.currentGoal || "未設定"}｜情緒：${row.emotion || "未設定"}｜位置：${row.location || "未知"}｜狀況：${row.condition || "未設定"}｜${row.alive === false ? "死亡" : "存活"}｜已知：${row.knownInfo || "無"}｜最後出場：${row.lastSeenChapter || "-"}`;
    if (type === "event") return `${row.eventName || "未命名事件"}｜${row.status || "未處理"}｜重要度：${row.importance || "中"}｜建立章節：${row.createdChapter || "-"}｜${row.description || ""}`;
    if (type === "secret") return `${row.content || "未命名秘密"}｜知情：${Array.isArray(row.knownBy) ? row.knownBy.join("、") : (row.knownBy || "未設定")}｜${row.isPublic ? `已公開 第${row.publicChapter || "-"}章` : "未公開"}`;
    return `${row.itemName || "未命名道具"}｜持有人：${row.holder || "未知"}｜位置：${row.location || "未知"}｜狀態：${row.status || "未設定"}｜最後出現：${row.lastSeenChapter || "-"}`;
  }

  function renderStateList(boxId, rows, type) {
    const box = $(boxId);
    if (!box) return;
    box.innerHTML = rows.length ? rows.map((row, index) => `
      <div class="phase1-state-row">
        <p>${esc(itemSummary(type, row))}</p>
        <button onclick="Phase1Novel.editStoryStateItem('${type}', ${index})">編輯</button>
        <button class="btn red" onclick="Phase1Novel.deleteStoryStateItem('${type}', ${index})">刪除</button>
      </div>
    `).join("") : "尚未建立資料。";
  }

  function storyWarnings(memory) {
    const warnings = [];
    const latest = latestChapterText();
    memory.characterStates.forEach((character) => {
      if (character.alive === false && character.name && latest.includes(character.name)) warnings.push(`已死亡角色「${character.name}」仍出現在最新章節，請確認是否為回憶、誤植或復活設定。`);
      if (character.previousLocation && character.location && character.previousLocation !== character.location && !/移動|前往|抵達|離開|返回|來到|進入/.test(latest)) warnings.push(`角色「${character.name}」位置由「${character.previousLocation}」變成「${character.location}」，但章節中缺少移動說明。`);
    });
    const holders = {};
    memory.storyItems.forEach((item) => {
      if (!item.itemName) return;
      holders[item.itemName] = holders[item.itemName] || new Set();
      if (item.holder) holders[item.itemName].add(item.holder);
    });
    Object.entries(holders).forEach(([name, set]) => {
      if (set.size > 1) warnings.push(`道具「${name}」同時有多個持有人：${[...set].join("、")}。`);
    });
    memory.secrets.forEach((secret) => {
      if (secret.isPublic && !secret.publicChapter) warnings.push(`秘密「${secret.content}」標示已公開，但沒有公開章節。`);
      if (!secret.isPublic && secret.publicChapter) warnings.push(`秘密「${secret.content}」已有公開章節，卻仍標示未公開。`);
    });
    const eventMap = {};
    memory.unresolvedEvents.forEach((event) => {
      const key = event.eventName || "";
      eventMap[key] = eventMap[key] || new Set();
      eventMap[key].add(event.status || "未處理");
    });
    Object.entries(eventMap).forEach(([name, set]) => {
      if (set.has("已解決") && (set.has("未處理") || set.has("進行中"))) warnings.push(`事件「${name}」同時出現已解決與未處理/進行中狀態。`);
    });
    return warnings;
  }

  function nextChapterReference(memory) {
    const protagonist = memory.characterStates[0] || {};
    const openEvents = memory.unresolvedEvents.filter((event) => event.status !== "已解決" && event.status !== "已放棄").slice(0, 3);
    const hiddenSecrets = memory.secrets.filter((secret) => !secret.isPublic).slice(0, 3);
    const items = memory.storyItems.slice(0, 3);
    return [
      `主角目前目標：${protagonist.currentGoal || "尚未設定"}`,
      `主角所在位置：${protagonist.location || memory.storyState.currentLocation || "未知"}`,
      `主要衝突：${memory.storyState.mainConflict || "尚未設定"}`,
      `尚未解決事件：${openEvents.map((event) => event.eventName).join("、") || "無"}`,
      `尚未公開秘密：${hiddenSecrets.map((secret) => secret.content).join("、") || "無"}`,
      `重要道具持有人：${items.map((item) => `${item.itemName}-${item.holder || "未知"}`).join("、") || "無"}`,
      `上一章結果：${memory.storyState.chapterResult || "尚未整理"}`,
      `上一章鉤子：${memory.storyState.nextHook || "尚未整理"}`
    ].join("\n");
  }

  function renderStoryStateCandidates() {
    const box = $("phase1StoryStateCandidates");
    if (!box) return;
    box.innerHTML = UI.storyStateCandidates.length ? UI.storyStateCandidates.map((candidate, index) => `
      <div class="phase1-state-row">
        <p><b>${esc(candidate.decision === "accepted" ? "已接受" : candidate.decision === "ignored" ? "已忽略" : "待確認")}</b>｜${esc(candidate.label)}</p>
        <button onclick="Phase1Novel.decideStoryStateCandidate(${index}, 'accepted')">接受</button>
        <button onclick="Phase1Novel.editStoryStateCandidate(${index})">修改</button>
        <button onclick="Phase1Novel.decideStoryStateCandidate(${index}, 'ignored')">忽略</button>
      </div>
    `).join("") : "尚未產生狀態更新候選。";
  }

  function renderStoryStatePanel() {
    const panel = $("phase1StoryStatePanel");
    if (!panel) return;
    const memory = getStoryMemory();
    const current = $("phase1StoryCurrent");
    if (current) {
      current.textContent = [
        `目前章節：第 ${memory.storyState.currentChapter || (UI.chapters.length || 0)} 章`,
        `目前時間：${memory.storyState.currentTime || "未設定"}`,
        `目前地點：${memory.storyState.currentLocation || "未設定"}`,
        `主要衝突：${memory.storyState.mainConflict || "未設定"}`,
        `本章結果：${memory.storyState.chapterResult || "未整理"}`,
        `下一步懸念：${memory.storyState.nextHook || "未整理"}`,
        `最後更新：${memory.stateUpdatedAt ? new Date(memory.stateUpdatedAt).toLocaleString("zh-TW") : "尚未更新"}`
      ].join("\n");
    }
    const reference = $("phase1NextChapterReference");
    if (reference) reference.textContent = `下一章寫作參考：\n${nextChapterReference(memory)}`;
    renderStateList("phase1CharactersState", memory.characterStates, "character");
    renderStateList("phase1EventsState", memory.unresolvedEvents, "event");
    renderStateList("phase1SecretsState", memory.secrets, "secret");
    renderStateList("phase1ItemsState", memory.storyItems, "item");
    const warnings = $("phase1StoryWarnings");
    if (warnings) warnings.textContent = storyWarnings(memory).join("\n") || "目前沒有明顯衝突。";
    renderStoryStateCandidates();
  }

  async function addStoryStateItem(type) {
    const memory = getStoryMemory();
    const chapter = normalizeChapter(UI.chapters.find((item) => item.id === UI.chapterId));
    const chapterNumber = chapter.order || chapter.chapterNumber || UI.chapters.length || 1;
    if (type === "character") {
      const name = prompt("角色姓名：");
      if (!name) return;
      memory.characterStates.push({ id: NovelDB.safeId("character_state"), name, currentGoal: prompt("目前目標：") || "", emotion: prompt("情緒：") || "", location: prompt("所在位置：") || "", condition: prompt("傷勢或身體狀況：") || "", alive: confirm("角色是否存活？按確定=存活，取消=死亡"), knownInfo: prompt("已知資訊：") || "", lastSeenChapter: chapterNumber });
    }
    if (type === "event") {
      const eventName = prompt("事件名稱：");
      if (!eventName) return;
      memory.unresolvedEvents.push({ id: NovelDB.safeId("event_state"), eventName, description: prompt("描述：") || "", createdChapter: chapterNumber, importance: prompt("重要度（高/中/低）：") || "中", status: prompt("狀態（未處理/進行中/已解決/已放棄）：") || "未處理" });
    }
    if (type === "secret") {
      const content = prompt("秘密內容：");
      if (!content) return;
      memory.secrets.push({ id: NovelDB.safeId("secret_state"), content, knownBy: (prompt("知情角色，用逗號分隔：") || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean), isPublic: false, publicChapter: null });
    }
    if (type === "item") {
      const itemName = prompt("道具名稱：");
      if (!itemName) return;
      memory.storyItems.push({ id: NovelDB.safeId("item_state"), itemName, holder: prompt("持有人：") || "", location: prompt("所在位置：") || "", status: prompt("目前狀態：") || "", lastSeenChapter: chapterNumber });
    }
    await saveStoryMemory(memory);
  }

  async function editStoryStateItem(type, index) {
    const memory = getStoryMemory();
    const map = { character: "characterStates", event: "unresolvedEvents", secret: "secrets", item: "storyItems" };
    const list = memory[map[type]];
    const row = list?.[index];
    if (!row) return;
    if (type === "character") {
      const oldLocation = row.location || "";
      row.name = prompt("角色姓名：", row.name || "") || row.name;
      row.currentGoal = prompt("目前目標：", row.currentGoal || "") || row.currentGoal;
      row.emotion = prompt("情緒：", row.emotion || "") || row.emotion;
      row.previousLocation = oldLocation;
      row.location = prompt("所在位置：", row.location || "") || row.location;
      row.condition = prompt("傷勢或身體狀況：", row.condition || "") || row.condition;
      row.alive = confirm("角色是否存活？按確定=存活，取消=死亡");
      row.knownInfo = prompt("已知資訊：", row.knownInfo || "") || row.knownInfo;
    }
    if (type === "event") {
      row.eventName = prompt("事件名稱：", row.eventName || "") || row.eventName;
      row.description = prompt("描述：", row.description || "") || row.description;
      row.importance = prompt("重要度（高/中/低）：", row.importance || "中") || row.importance;
      row.status = prompt("狀態（未處理/進行中/已解決/已放棄）：", row.status || "未處理") || row.status;
    }
    if (type === "secret") {
      row.content = prompt("秘密內容：", row.content || "") || row.content;
      row.knownBy = (prompt("知情角色，用逗號分隔：", Array.isArray(row.knownBy) ? row.knownBy.join("、") : row.knownBy || "") || "").split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
      row.isPublic = confirm("是否已公開？按確定=已公開，取消=未公開");
      row.publicChapter = row.isPublic ? (Number(prompt("公開章節：", row.publicChapter || "")) || row.publicChapter || null) : null;
    }
    if (type === "item") {
      row.itemName = prompt("道具名稱：", row.itemName || "") || row.itemName;
      row.holder = prompt("持有人：", row.holder || "") || row.holder;
      row.location = prompt("所在位置：", row.location || "") || row.location;
      row.status = prompt("目前狀態：", row.status || "") || row.status;
    }
    await saveStoryMemory(memory);
  }

  async function deleteStoryStateItem(type, index) {
    if (!confirmSafe("確定刪除此故事狀態項目？正文不會被修改。")) return;
    const memory = getStoryMemory();
    const map = { character: "characterStates", event: "unresolvedEvents", secret: "secrets", item: "storyItems" };
    memory[map[type]].splice(index, 1);
    await saveStoryMemory(memory);
  }

  function renderAiModeStatus() {
    const status = $("phase1AiModeStatus");
    const button = $("phase1AiModeGenerateButton");
    if (!status) return;
    const cfg = window.NovelAIService?.getConfig ? NovelAIService.getConfig() : { provider: "chat", model: "" };
    const cloud = cfg.provider === "gemini" || cfg.provider === "chat" || cfg.provider === "cloud" || cfg.provider === "openai";
    const providerLabel = { gemini: "Gemini", chat: "OpenAI-compatible", cloud: "雲端AI", openai: "OpenAI-compatible", ollama: "Ollama", lmstudio: "LM Studio" }[cfg.provider] || cfg.provider || "尚未設定";
    if (cloud && !navigator.onLine) {
      status.textContent = `目前連線模式：${providerLabel}｜模型：${cfg.model || "尚未設定"}｜離線｜雲端AI需要網路`;
      if (button) button.disabled = true;
      return;
    }
    if (button) button.disabled = false;
    const localHint = cfg.provider === "ollama" || cfg.provider === "lmstudio" ? "本機模型需確認已啟動" : "雲端AI需保持在線";
    status.textContent = `目前連線模式：${providerLabel}｜模型：${cfg.model || "尚未設定"}｜${navigator.onLine ? "在線" : "離線"}｜${localHint}`;
  }

  function renderWritingModePanel() {
    const card = $("phase1WritingModeCard");
    if (!card) return;
    const mode = UI.writingMode || "free";
    ["free", "guided", "ai"].forEach((key) => {
      const btn = $(`phase1Mode${key === "free" ? "Free" : key === "guided" ? "Guided" : "Ai"}`);
      if (btn) btn.classList.toggle("active", mode === key);
    });
    const desc = $("phase1ModeDescription");
    if (desc) desc.textContent = writingModeDescriptions[mode] || writingModeDescriptions.free;
    ["Free", "Guided", "Ai"].forEach((name) => {
      const panel = $(`phase1${name}ModePanel`);
      if (panel) panel.classList.toggle("hidden", name.toLowerCase() !== (mode === "ai" ? "ai" : mode));
    });
    const chapter = normalizeChapter(UI.chapters.find((item) => item.id === UI.chapterId));
    const words = $("phase1FreeWordCount");
    if (words) words.textContent = fmt($("phase1ChapterContent")?.value ? NovelDB.words($("phase1ChapterContent").value) : chapter.wordCount || 0);
    const save = $("phase1FreeSaveStatus");
    if (save) save.textContent = UI.lastSaveAt ? `已儲存 ${new Date(UI.lastSaveAt).toLocaleTimeString("zh-TW")}` : (chapter.lastSavedAt ? `已儲存 ${new Date(chapter.lastSavedAt).toLocaleTimeString("zh-TW")}` : "尚未儲存");
    if (mode === "guided") {
      renderGuidedRound();
      renderLocalAiStatus();
    }
    if (mode === "ai") renderAiModeStatus();
  }

  async function setWritingMode(mode) {
    if (!["free", "guided", "ai"].includes(mode)) return;
    if (UI.chapterId) await saveCurrentChapter("switch-writing-mode", false);
    UI.writingMode = mode;
    if (mode === "guided") {
      await loadGuidedState();
      if (!UI.guidedRound) UI.guidedRound = buildGuidedRound();
    }
    await saveWritingMode();
    renderWritingModePanel();
    $("phase1WritingModeCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function completeCurrentChapter() {
    if (!UI.chapterId) return notify("請先選擇章節。", "error");
    const selector = $("phase1ChapterStatus");
    if (selector) selector.value = "done";
    await saveCurrentChapter("complete-chapter", true);
    notify("章節已標記完成並儲存。");
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
    renderWritingModePanel();
    await renderChapterClosingSummaryPanel();
    renderStoryStatePanel();
    if (UI.projectId) await syncLegacyFromProject(UI.projectId, UI.chapterId);
  }

  async function refresh() {
    ensureShell();
    await loadLists();
    await loadWritingMode();
    await loadGuidedState();
    UI.storyStateCandidates = UI.projectId ? ((await NovelDB.getSetting(`story-state-candidates-${UI.projectId}`)) || []) : [];
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
    renderWritingModePanel();
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
      renderWritingModePanel();
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

  function chooseGuidedOption(option) {
    UI.guidedSelection = option;
    const round = UI.guidedRound || buildGuidedRound();
    if (option === "D") {
      UI.guidedCustomInputs[round.key] = $("phase1GuidedCustom")?.value.trim() || "";
    }
    renderGuidedRound();
  }

  async function regenerateGuidedOptions() {
    const currentTexts = Object.values(UI.guidedRound?.options || {}).map((item) => item.text);
    UI.guidedOptionHistory = [...(UI.guidedOptionHistory || []), ...currentTexts].slice(-10);
    UI.guidedRound = buildGuidedRound();
    UI.guidedRounds[guidedStep().key] = UI.guidedRound;
    UI.guidedSelection = "";
    await saveGuidedState();
    renderGuidedRound();
  }

  async function guidedBack() {
    if (UI.guidedCurrentStep <= 1) return notify("已經是第一輪，沒有上一輪可以返回。");
    UI.guidedCurrentStep -= 1;
    UI.guidedRound = UI.guidedRounds[guidedStep().key] || buildGuidedRound();
    UI.guidedRounds[guidedStep().key] = UI.guidedRound;
    UI.guidedSelection = UI.guidedSelections[guidedStep().key]?.label || "";
    await saveGuidedState();
    renderGuidedRound();
  }

  async function confirmGuidedChoice() {
    const round = UI.guidedRound || buildGuidedRound();
    const custom = $("phase1GuidedCustom")?.value.trim();
    if (!UI.guidedSelection && custom) UI.guidedSelection = "D";
    if (!UI.guidedSelection) return notify("請先選擇 A／B／C，或輸入 D 自訂行動。", "error");
    if (UI.guidedSelection === "D" && custom) UI.guidedCustomInputs[round.key] = custom;
    const option = guidedOptionFromSelection(UI.guidedSelection);
    UI.guidedRounds[round.key] = round;
    UI.guidedSelections[round.key] = { ...option, question: round.question, step: round.step, key: round.key };
    UI.guidedOptionHistory = [...(UI.guidedOptionHistory || []), option.text].slice(-10);
    if (UI.guidedCurrentStep < guidedSteps.length) {
      UI.guidedCurrentStep += 1;
      UI.guidedSelection = UI.guidedSelections[guidedStep().key]?.label || "";
      UI.guidedRound = UI.guidedRounds[guidedStep().key] || buildGuidedRound();
      UI.guidedRounds[guidedStep().key] = UI.guidedRound;
      UI.guidedChapterPlan = buildGuidedChapterPlan();
      await saveGuidedState();
      renderGuidedRound();
      notify(`已儲存第${round.step}輪選擇，進入第${UI.guidedCurrentStep}輪。`);
      return;
    }
    UI.guidedChapterPlan = buildGuidedChapterPlan();
    await saveGuidedState();
    renderGuidedOutcome();
    refreshGuidedPlanBox();
    notify("五輪引導已完成，已產生本章規劃，正文未被覆蓋。");
  }

  async function applyGuidedPlan() {
    if (!UI.chapterId) return notify("請先選擇章節。", "error");
    UI.guidedChapterPlan = $("phase1GuidedPlan")?.value.trim() || buildGuidedChapterPlan();
    const nextGoal = $("phase1NextGoal");
    if (nextGoal) nextGoal.value = UI.guidedChapterPlan;
    const goal = $("phase1ChapterGoal");
    if (goal) goal.value = UI.guidedChapterPlan;
    await saveGuidedPlan();
    notify("已套用到自由寫作提示區與本章目標，正文未被覆蓋。");
  }

  async function saveGuidedPlan() {
    if (!UI.chapterId) return notify("請先選擇章節。", "error");
    UI.guidedCustomInputs.authorNote = $("phase1GuidedAuthorNote")?.value.trim() || UI.guidedCustomInputs.authorNote || "";
    UI.guidedChapterPlan = $("phase1GuidedPlan")?.value.trim() || buildGuidedChapterPlan();
    const chapter = normalizeChapter(await NovelDB.get("chapters", UI.chapterId));
    const goal = $("phase1ChapterGoal");
    if (goal) goal.value = UI.guidedChapterPlan;
    await NovelDB.put("chapters", { ...chapter, goal: UI.guidedChapterPlan, updatedAt: NovelDB.now() });
    await saveGuidedState();
    await loadLists();
    await renderProgressPanel();
    notify("本章規則已儲存，尚未生成正文。");
  }

  function editGuidedPlan() {
    const plan = $("phase1GuidedPlan");
    if (plan) {
      plan.focus();
      plan.setSelectionRange(plan.value.length, plan.value.length);
    }
  }

  async function copyGuidedPlan() {
    UI.guidedChapterPlan = $("phase1GuidedPlan")?.value.trim() || buildGuidedChapterPlan();
    try {
      await navigator.clipboard.writeText(UI.guidedChapterPlan);
      notify("本章規劃已複製。");
    } catch (error) {
      notify("無法直接複製，請手動選取本章規劃文字。", "error");
    }
  }

  function localAiSettingKey() {
    return `phase1-local-ai-${UI.projectId || "global"}`;
  }

  function readLocalAiSettings() {
    try {
      return JSON.parse(localStorage.getItem(localAiSettingKey()) || localStorage.getItem("phase1-local-ai-global") || "{}");
    } catch (error) {
      return {};
    }
  }

  function saveLocalAiSettings(next = {}) {
    const current = readLocalAiSettings();
    const settings = { ...current, ...next, updatedAt: NovelDB.now() };
    localStorage.setItem(localAiSettingKey(), JSON.stringify(settings));
    if (!UI.projectId) localStorage.setItem("phase1-local-ai-global", JSON.stringify(settings));
    return settings;
  }

  function renderLocalAiStatus(message = "") {
    const internet = $("phase1LocalInternetStatus");
    if (internet) internet.textContent = navigator.onLine ? "在線" : "離線";
    const status = $("phase1LocalGenerationStatus");
    if (status && message) status.textContent = message;
    const saved = readLocalAiSettings();
    const endpoint = $("phase1OllamaEndpoint");
    if (endpoint && !endpoint.value) endpoint.value = saved.endpoint || "http://localhost:11434";
    const target = $("phase1LocalTargetWords");
    if (target && saved.targetWords && !target.value) target.value = saved.targetWords;
  }

  function selectedOllamaConfig() {
    const endpoint = ($("phase1OllamaEndpoint")?.value || "http://localhost:11434").replace(/\/+$/, "");
    const model = $("phase1OllamaModel")?.value || readLocalAiSettings().model || "";
    const targetWords = Number($("phase1LocalTargetWords")?.value || 1800) || 1800;
    saveLocalAiSettings({ endpoint, model, targetWords });
    return { provider: "ollama", endpoint, model, targetWords };
  }

  async function detectOllamaModels() {
    const status = $("phase1OllamaStatus");
    const modelSelect = $("phase1OllamaModel");
    const cfg = selectedOllamaConfig();
    if (status) status.textContent = "偵測中...";
    try {
      const models = await NovelAIService.listLocalModels({ endpoint: cfg.endpoint, provider: "ollama" });
      if (!models.length) {
        if (status) status.textContent = "已連線，但尚未安裝模型";
        if (modelSelect) modelSelect.innerHTML = "";
        return [];
      }
      const saved = cfg.model || readLocalAiSettings().model || models[0].id;
      if (modelSelect) {
        modelSelect.innerHTML = models.map((model) => `<option value="${esc(model.id)}">${esc(model.name || model.id)}</option>`).join("");
        modelSelect.value = models.some((model) => model.id === saved) ? saved : models[0].id;
      }
      saveLocalAiSettings({ endpoint: cfg.endpoint, model: modelSelect?.value || models[0].id });
      if (status) status.textContent = `已連線｜${models.length} 個模型`;
      renderLocalAiStatus("模型可用，尚未生成");
      return models;
    } catch (error) {
      if (status) status.textContent = "Ollama 未啟動或無法連線";
      renderLocalAiStatus("本地模型未連線");
      notify(error.message || "Ollama 偵測失敗。", "error");
      return [];
    }
  }

  async function testOllamaModel() {
    const status = $("phase1OllamaStatus");
    const cfg = selectedOllamaConfig();
    try {
      const result = await NovelAIService.testLocalModel({ endpoint: cfg.endpoint, model: cfg.model, provider: "ollama" });
      if (status) status.textContent = `已連線｜目前模型：${result.selectedModel}`;
      notify(`Ollama 可用：${result.selectedModel}`);
    } catch (error) {
      if (status) status.textContent = "測試失敗";
      notify(error.message || "Ollama 測試失敗。", "error");
    }
  }

  function buildChapterContext() {
    const project = normalizeProject(UI.projects.find((item) => item.id === UI.projectId));
    const chapter = normalizeChapter(UI.chapters.find((item) => item.id === UI.chapterId));
    const previous = findPreviousChapter(UI.chapterId) || {};
    const stateMemory = getStoryMemory();
    const protagonist = readProtagonistLink();
    const guidedPlan = $("phase1GuidedPlan")?.value.trim() || UI.guidedChapterPlan || buildGuidedChapterPlan();
    const authorNote = $("phase1GuidedAuthorNote")?.value.trim() || UI.guidedCustomInputs?.authorNote || "";
    const currentContent = $("phase1ChapterContent")?.value || chapter.content || "";
    const selections = {};
    guidedSteps.forEach((step) => {
      const item = UI.guidedSelections?.[step.key];
      selections[step.key] = item ? {
        question: item.question,
        label: item.label,
        text: item.text,
        risk: item.risk,
        progress: item.progress,
        cost: item.cost,
        impact: item.impact
      } : null;
    });
    return {
      project: {
        id: project.id,
        title: project.title || "未命名小說",
        genre: project.genre || "",
        subTheme: project.state?.subTheme || "",
        engine: project.state?.storyEngine || "",
        style: project.style || project.state?.styleMode || "",
        synopsis: project.synopsis || project.state?.seed || ""
      },
      chapter: {
        id: chapter.id,
        title: chapter.title || "",
        targetWords: Number($("phase1LocalTargetWords")?.value || chapter.chapterTargetWords || 1800) || 1800,
        existingContentTail: shortText(currentContent.slice(-1600), 1600),
        goal: chapter.goal || guidedPlan
      },
      previousChapter: {
        title: previous.title || "",
        summary: previous.summary || shortText(previous.content || "", 500),
        ending: shortText((previous.content || "").slice(-1600), 1600)
      },
      world: {
        worldCore: project.state?.worldCore || "",
        powerCore: project.state?.powerCore || "",
        conflictCore: project.state?.conflictCore || "",
        villainCore: project.state?.villainCore || "",
        currentLocation: stateMemory?.storyState?.currentLocation || "",
        timeline: stateMemory?.storyState?.currentTime || ""
      },
      protagonist: {
        name: protagonist.name || project.state?.protagonist || "主角",
        archetype: protagonist.archetype || project.state?.heroType || "尚未設定",
        personality: protagonist.personality || "",
        goal: protagonist.goal || "",
        actionStyle: protagonist.actionStyle || "",
        speechStyle: protagonist.speechStyle || "",
        strengths: protagonist.strengths || "",
        weaknesses: protagonist.weaknesses || "",
        characterArc: protagonist.characterArc || ""
      },
      storyMemory: {
        nextChapterReference: nextChapterReference(stateMemory),
        unresolvedEvents: (stateMemory?.unresolvedEvents || []).filter((item) => item.status !== "已解決").slice(0, 8),
        secrets: (stateMemory?.secrets || []).filter((item) => !item.revealed).slice(0, 8),
        items: (stateMemory?.storyItems || []).slice(0, 8),
        characters: (stateMemory?.characterStates || []).slice(0, 10)
      },
      guided: {
        chapterPlan: guidedPlan,
        authorNote,
        selections
      },
      constraints: [
        "只輸出小說正文，不要輸出摘要、大綱、分析或建議。",
        "延續上一章結尾與目前章節既有內容，不可重複貼上前文。",
        "主角原型只能影響主角的行動方式、語氣與判斷邏輯，不可變成另一個角色。",
        "不可讓人物知道尚未揭露的資訊。",
        "不可無故新增重要人物或改寫世界規則。",
        "必須落實五輪引導選擇與本章規劃。",
        "章末需要留下推進或懸念。"
      ]
    };
  }

  function buildLocalChapterPrompt(context) {
    return [
      "你是長篇小說正文生成引擎。",
      "請依照下方本章寫作包生成完整、可直接閱讀並收錄進作品的小說正文。",
      "不可只輸出摘要、大綱、分析或創作建議；不可在正文前後加入解釋。",
      "",
      "【本章寫作包】",
      JSON.stringify(context, null, 2),
      "",
      "【輸出要求】",
      `目標字數：約 ${context.chapter.targetWords} 字。`,
      "請只輸出小說正文。"
    ].join("\n");
  }

  async function generateGuidedChapterWithOllama() {
    if (!UI.projectId || !UI.chapterId) return notify("請先建立或開啟作品與章節。", "error");
    const preview = $("phase1GuidedGenerationPreview");
    const buttonStatus = $("phase1LocalGenerationStatus");
    try {
      await saveCurrentChapter("before-local-guided-generation", true);
      await saveGuidedPlan();
      const cfg = selectedOllamaConfig();
      if (!cfg.model) {
        const models = await detectOllamaModels();
        if (!models.length) throw new Error("尚未選擇可用的 Ollama 模型。");
        cfg.model = $("phase1OllamaModel")?.value || models[0].id;
      }
      saveLocalAiSettings(cfg);
      const context = buildChapterContext();
      const prompt = buildLocalChapterPrompt(context);
      UI.guidedGeneratedChapter = "";
      UI.guidedGenerationContext = context;
      if (preview) preview.textContent = "【本地 AI 生成中】\n";
      if (buttonStatus) buttonStatus.textContent = "生成中";
      for await (const token of NovelAIService.generateStream({
        provider: "ollama",
        model: cfg.model,
        prompt,
        system: "你是長篇小說正文生成引擎。只輸出小說正文，不要輸出分析或摘要。",
        temperature: 0.78,
        numCtx: 8192
      }, { config: { provider: "ollama", endpoint: cfg.endpoint, model: cfg.model } })) {
        UI.guidedGeneratedChapter += token;
        if (preview) preview.textContent = `【本地 AI 候選正文｜尚未套用】\n${UI.guidedGeneratedChapter}`;
      }
      const runs = (await NovelDB.getSetting(`generation-runs-${UI.projectId}`)) || [];
      runs.unshift({
        id: NovelDB.safeId("run"),
        projectId: UI.projectId,
        chapterId: UI.chapterId,
        provider: "ollama",
        model: cfg.model,
        promptContext: context,
        generatedText: UI.guidedGeneratedChapter,
        action: "pending",
        approvedForTraining: false,
        createdAt: NovelDB.now()
      });
      await NovelDB.saveSetting(`generation-runs-${UI.projectId}`, runs.slice(0, 30));
      if (buttonStatus) buttonStatus.textContent = "已生成候選正文，尚未加入作品";
      notify("本地 AI 已生成候選正文，請預覽後再接受。");
    } catch (error) {
      if (buttonStatus) buttonStatus.textContent = "生成失敗";
      if (preview) preview.textContent = `生成失敗：${error.message || error}\n\n正文與原有作品資料仍然安全。`;
      notify(error.message || "本地 AI 生成失敗。", "error");
    }
  }

  function abortGuidedGeneration() {
    NovelAIService.abortOllama();
    renderLocalAiStatus("已要求中止生成");
  }

  async function acceptGuidedGeneratedChapter(mode = "append") {
    const text = (UI.guidedGeneratedChapter || "").trim();
    if (!text) return notify("尚未有可接受的本地 AI 候選正文。", "error");
    await NovelDB.createVersion(UI.projectId, "接受本地AI正文前快照", await NovelDB.loadProject(UI.projectId), { reason: "before-accept-local-ai" });
    if (mode === "new") {
      await createChapter(`本地AI生成章節 ${new Date().toLocaleTimeString("zh-TW")}`, text);
    } else {
      const content = $("phase1ChapterContent");
      if (!content) return notify("找不到正文編輯區。", "error");
      content.value = `${content.value.trimEnd()}\n\n${text}`.trim();
      content.setSelectionRange(content.value.length, content.value.length);
      await saveCurrentChapter("accept-local-ai-guided", true);
    }
    const runs = (await NovelDB.getSetting(`generation-runs-${UI.projectId}`)) || [];
    if (runs[0]) {
      runs[0].action = "accepted";
      runs[0].acceptedAt = NovelDB.now();
      await NovelDB.saveSetting(`generation-runs-${UI.projectId}`, runs);
    }
    notify(mode === "new" ? "已接受候選正文並建立新章節。" : "已接受候選正文並加入目前章節。");
    UI.guidedGeneratedChapter = "";
    const status = $("phase1LocalGenerationStatus");
    if (status) status.textContent = "已接受並存檔";
  }

  function discardGuidedGeneratedChapter() {
    UI.guidedGeneratedChapter = "";
    const preview = $("phase1GuidedGenerationPreview");
    if (preview) preview.textContent = "已放棄本地 AI 候選正文，正式作品未被修改。";
    renderLocalAiStatus("已放棄候選正文");
  }

  async function clearGuidedStep() {
    const step = guidedStep();
    delete UI.guidedSelections[step.key];
    delete UI.guidedCustomInputs[step.key];
    UI.guidedSelection = "";
    UI.guidedRound = buildGuidedRound();
    UI.guidedRounds[step.key] = UI.guidedRound;
    UI.guidedChapterPlan = buildGuidedChapterPlan();
    await saveGuidedState();
    renderGuidedRound();
    notify("已清除本輪選擇，正文未被清除。");
  }

  async function restartGuidedFlow() {
    if (!confirmSafe("確定重新開始引導？這只會清除本章引導選擇與規劃，不會清除正文。")) return;
    if (!confirmSafe("再次確認：重新引導後，本章規劃會重新建立。確定？")) return;
    UI.guidedCurrentStep = 1;
    UI.guidedRounds = {};
    UI.guidedSelections = {};
    UI.guidedCustomInputs = {};
    UI.guidedOptionHistory = [];
    UI.guidedChapterPlan = "";
    UI.guidedSelection = "";
    UI.guidedRound = buildGuidedRound();
    await saveGuidedState();
    renderGuidedRound();
    notify("已重新開始引導，正文保持不變。");
  }

  function openAiSettings() {
    if (typeof showView === "function") showView("chatnovel");
    $("view-chatnovel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function generateAiCandidate() {
    if (!UI.projectId) return notify("請先選擇作品。", "error");
    const button = $("phase1AiModeGenerateButton");
    const preview = $("phase1AiCandidatePreview");
    const status = $("phase1AiModeStatus");
    const cfg = NovelAIService.getConfig();
    const cloud = cfg.provider === "gemini" || cfg.provider === "chat" || cfg.provider === "cloud" || cfg.provider === "openai";
    if (cloud && !navigator.onLine) {
      if (status) status.textContent = "雲端AI需要網路。你可以返回引導式寫作，或改用 Ollama / LM Studio。";
      return;
    }
    if (button) button.disabled = true;
    try {
      await saveCurrentChapter("before-ai-candidate", true);
      if (status) status.textContent = "生成中";
      const request = $("phase1AiModeRequest")?.value.trim() || "延續目前章節，保持人物與前文一致，產生下一段可編輯正文。";
      const chapter = normalizeChapter(UI.chapters.find((item) => item.id === UI.chapterId));
      const previous = findPreviousChapter(UI.chapterId);
      const stateReference = nextChapterReference(getStoryMemory());
      const prompt = [
        "請產生小說候選正文。只輸出可放入正文的內容，不要覆蓋原文，不要只給大綱。",
        `作品：${UI.projects.find((item) => item.id === UI.projectId)?.title || ""}`,
        `目前章節：${chapter.title || ""}`,
        `上一章摘要：${shortText(previous?.summary || previous?.content, 300)}`,
        `目前正文末段：${shortText(chapter.content?.slice(-600), 600)}`,
        `使用者要求：${request}`
      ].join("\n\n");
      const result = await NovelAIService.generate(prompt);
      UI.aiCandidate = result;
      if (preview) preview.textContent = `【AI候選正文】\n${result}`;
      if (status) status.textContent = "已生成候選正文，尚未套用。";
    } catch (error) {
      UI.aiCandidate = null;
      if (preview) preview.textContent = "生成失敗，原文已保留。";
      if (status) status.textContent = `生成失敗：${error.message || error}`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function applyAiCandidate(mode) {
    const candidate = UI.aiCandidate;
    if (!candidate) return notify("尚未產生 AI 候選正文。", "error");
    const content = $("phase1ChapterContent");
    if (mode === "newChapter") {
      await createChapter(`AI候選章節 ${new Date().toLocaleTimeString("zh-TW")}`, candidate);
      notify("已用 AI 候選正文建立新章節。");
      return;
    }
    if (!content || !UI.chapterId) return notify("請先開啟章節。", "error");
    if (mode === "replaceSelection") {
      const start = content.selectionStart;
      const end = content.selectionEnd;
      if (start === end) return notify("請先選取要取代的段落。", "error");
      content.value = `${content.value.slice(0, start)}${candidate}${content.value.slice(end)}`;
      content.setSelectionRange(start + candidate.length, start + candidate.length);
    } else {
      content.value = `${content.value.trimEnd()}\n\n${candidate}`.trim();
      content.setSelectionRange(content.value.length, content.value.length);
    }
    await saveCurrentChapter("apply-ai-candidate", true);
    notify("已套用 AI 候選正文。");
  }

  function discardAiCandidate() {
    UI.aiCandidate = null;
    const preview = $("phase1AiCandidatePreview");
    if (preview) preview.textContent = "已放棄 AI 候選正文。";
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
      storyMemory: getStoryMemory(),
      nextChapterReference: nextChapterReference(getStoryMemory()),
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
    renderAiModeStatus();
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

  function patchModeEntrances() {
    const interactive = $("view-interactive");
    if (interactive && !$("phase1EnterGuidedFromInteractive")) {
      const bar = interactive.querySelector(".bar") || interactive.querySelector(".card");
      if (bar) {
        const button = document.createElement("button");
        button.id = "phase1EnterGuidedFromInteractive";
        button.className = "btn gold";
        button.textContent = "進入引導式寫作";
        button.onclick = async () => {
          await focusManager(UI.projectId || "");
          await setWritingMode("guided");
        };
        bar.prepend(button);
      }
    }
    const chatnovel = $("view-chatnovel");
    if (chatnovel && !$("phase1EnterAiFromChatnovel")) {
      const bar = chatnovel.querySelector(".bar") || chatnovel.querySelector(".card");
      if (bar) {
        const button = document.createElement("button");
        button.id = "phase1EnterAiFromChatnovel";
        button.className = "btn gold";
        button.textContent = "進入AI協作寫作";
        button.onclick = async () => {
          await focusManager(UI.projectId || "");
          await setWritingMode("ai");
        };
        bar.prepend(button);
      }
    }
  }

  async function init() {
    ensureShell();
    simplifyNavigation();
    bindPhase1NavigationGuard();
    patchLegacyExportImport();
    patchModeEntrances();
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
    setWritingMode,
    completeCurrentChapter,
    regenerateGuidedOptions,
    chooseGuidedOption,
    guidedBack,
    confirmGuidedChoice,
    applyGuidedPlan,
    clearGuidedStep,
    restartGuidedFlow,
    saveGuidedPlan,
    editGuidedPlan,
    copyGuidedPlan,
    detectOllamaModels,
    testOllamaModel,
    generateGuidedChapterWithOllama,
    abortGuidedGeneration,
    acceptGuidedGeneratedChapter,
    discardGuidedGeneratedChapter,
    startSectionWriting,
    setSectionMethod,
    selectSection,
    chooseSectionOption,
    confirmSectionOption,
    regenerateSectionOptions,
    generateOfflineSectionDraft,
    generateAiSectionCandidate,
    applySectionCandidate,
    discardSectionCandidate,
    editSectionCandidate,
    saveCurrentSection,
    markCurrentSectionComplete,
    markCurrentSectionNeedsRevision,
    restoreSectionPrevious,
    prevSection,
    nextSection,
    markEditorAsCurrentSection,
    combineChapterSections,
    applyCombinedChapter,
    copyCombinedChapter,
    saveCombinedAsVersion,
    hideCombinedPreview,
    discardCombinedChapter,
    saveChapterClosingSummary,
    applyChapterClosingToNextReference,
    clearChapterClosingSummary,
    prepareStoryStateCandidates,
    decideStoryStateCandidate,
    editStoryStateCandidate,
    acceptAllStoryStateCandidates,
    ignoreAllStoryStateCandidates,
    saveAcceptedStoryStateCandidates,
    addStoryStateItem,
    editStoryStateItem,
    deleteStoryStateItem,
    renderStoryStatePanel,
    openAiSettings,
    generateAiCandidate,
    applyAiCandidate,
    discardAiCandidate,
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

  const protagonistLinkKey = "novel_protagonist_link_v1";

  function readProtagonistLink() {
    try {
      const saved = JSON.parse(localStorage.getItem(protagonistLinkKey) || "{}");
      const legacy = JSON.parse(localStorage.getItem("novel_platform_state") || "{}");
      return {
        name: saved.name || legacy.protagonistName || legacy.protagonist || "",
        archetype: saved.archetype || legacy.protagonistArchetype || legacy.heroType || "",
        personality: saved.personality || "",
        goal: saved.goal || "",
        actionStyle: saved.actionStyle || "",
        strengths: saved.strengths || "",
        weaknesses: saved.weaknesses || "",
        fear: saved.fear || "",
        speechStyle: saved.speechStyle || "",
        conflictHabit: saved.conflictHabit || "",
        characterArc: saved.characterArc || ""
      };
    } catch (error) {
      return {};
    }
  }

  function archetypeSuggestion(archetype = "") {
    const value = String(archetype || "主角").trim();
    const base = {
      personality: "冷靜、敏銳，能在壓力下保持判斷",
      goal: "在主線危機中掌握主動權",
      actionStyle: "先觀察局勢，再選擇最有效的反擊方式",
      strengths: "洞察力、適應力、承受壓力",
      weaknesses: "不容易信任他人，容易把情緒藏起來",
      fear: "失去重要關係或再次被命運推著走",
      speechStyle: "語氣克制，關鍵時刻直接切中問題",
      conflictHabit: "先判斷對方弱點，再決定正面反擊或暗中布局",
      characterArc: "從被局勢牽動，成長為能主動選擇道路的人"
    };
    if (/重生|主母|謀士|庶女|冷宮|權謀/.test(value)) return { ...base, personality: "隱忍、清醒、擅長布局", actionStyle: "表面退讓，暗中蒐集證據並借力反擊", speechStyle: "溫和有禮，但話中常留後手", strengths: "長期規劃、情緒控制、讀懂人心", weaknesses: "容易過度防備，不願示弱", characterArc: "從只求自保，成長為能保護身邊人的掌局者" };
    if (/黑化|反派|復仇/.test(value)) return { ...base, personality: "強烈、偏執、對背叛極度敏感", actionStyle: "用高壓手段逼迫局勢表態", speechStyle: "短句、冷感、帶威脅意味", strengths: "決斷力、壓迫感、敢付代價", weaknesses: "容易孤立自己，難以接受善意", characterArc: "從只想摧毀，轉向理解自己真正想守住什麼" };
    if (/社恐|天才|AI|研究|醫師/.test(value)) return { ...base, personality: "理性、專注，不擅長處理情緒場面", actionStyle: "先分析規則與資料，再做精準行動", speechStyle: "精準、簡短，偶爾過度理性", strengths: "專業、推理、學習速度快", weaknesses: "人際反應慢，容易忽略他人感受", characterArc: "從只相信邏輯，成長為能理解人心與選擇" };
    if (/幽默|旁白|荒誕/.test(value)) return { ...base, personality: "冷靜、敏銳、擅長看穿荒謬", actionStyle: "先觀察，再以出其不意的方式反擊", speechStyle: "表面平靜，內心帶諷刺", strengths: "洞察人性、化解壓力、反諷視角", weaknesses: "容易用嘲諷掩飾真實情感", characterArc: "從旁觀嘲諷，成長為願意真正投入與承擔" };
    return base;
  }

  function writeProtagonistLink(next) {
    const current = readProtagonistLink();
    const merged = { ...current, ...next, updatedAt: new Date().toISOString() };
    localStorage.setItem(protagonistLinkKey, JSON.stringify(merged));
    try {
      const legacy = JSON.parse(localStorage.getItem("novel_platform_state") || "{}");
      legacy.protagonistName = merged.name || legacy.protagonist || "";
      legacy.protagonist = legacy.protagonistName;
      legacy.protagonistArchetype = merged.archetype || legacy.heroType || "";
      legacy.protagonistProfile = { ...merged };
      localStorage.setItem("novel_platform_state", JSON.stringify(legacy));
    } catch (error) {}
    return merged;
  }

  function renderProtagonistLinkPreview() {
    const nameInput = document.getElementById("protagonist");
    const heroSelect = document.getElementById("heroType");
    const host = document.getElementById("hostName");
    if (!nameInput || !heroSelect || !host) return;
    const saved = readProtagonistLink();
    const profile = writeProtagonistLink({
      name: nameInput.value.trim() || saved.name || "",
      archetype: heroSelect.value || saved.archetype || ""
    });
    let box = document.getElementById("protagonistLinkPreview");
    if (!box) {
      box = document.createElement("div");
      box.id = "protagonistLinkPreview";
      box.className = "notice";
      host.parentNode.insertBefore(box, host);
    }
    const mismatch = /衝動|直接|莽撞/.test(profile.personality || "") && /謀士|布局|隱忍|主母/.test(profile.archetype || "");
    box.innerHTML = `<b>主角設定預覽</b><br>${esc(profile.name || "尚未設定")}｜${esc(profile.archetype || "尚未設定")}<br>核心性格：${esc(profile.personality || "尚未設定")}<br>行動方式：${esc(profile.actionStyle || "尚未設定")}<br>說話方式：${esc(profile.speechStyle || "尚未設定")}<br>主要目標：${esc(profile.goal || "尚未設定")}<br>優勢：${esc(profile.strengths || "尚未設定")}<br>缺點：${esc(profile.weaknesses || "尚未設定")}<br>成長方向：${esc(profile.characterArc || "尚未設定")}${mismatch ? '<br><br>目前主角性格與所選原型存在差異。你可以保留這種反差，也可以同步調整人物設定。 <button onclick="Phase1Novel.applyProtagonistArchetypeSuggestion()">套用原型建議</button>' : ""}`;
  }

  function applyProtagonistArchetypeSuggestion() {
    const heroSelect = document.getElementById("heroType");
    const nameInput = document.getElementById("protagonist");
    const archetype = heroSelect?.value || readProtagonistLink().archetype || "";
    writeProtagonistLink({ name: nameInput?.value.trim() || "", archetype, ...archetypeSuggestion(archetype) });
    renderProtagonistLinkPreview();
  }

  function setupProtagonistLinking() {
    const nameInput = document.getElementById("protagonist");
    const heroSelect = document.getElementById("heroType");
    if (!nameInput || !heroSelect || nameInput.dataset.protagonistLinked) return;
    nameInput.dataset.protagonistLinked = "1";
    heroSelect.dataset.protagonistLinked = "1";
    const saved = readProtagonistLink();
    if (saved.name && !nameInput.value.trim()) nameInput.value = saved.name;
    if (saved.archetype && [...heroSelect.options].some((option) => option.value === saved.archetype)) heroSelect.value = saved.archetype;
    nameInput.addEventListener("input", () => {
      writeProtagonistLink({ name: nameInput.value.trim() });
      renderProtagonistLinkPreview();
    });
    heroSelect.addEventListener("change", () => {
      const existing = readProtagonistLink();
      const choice = existing.personality ? prompt("是否根據新的主角原型更新人物設定？\n1：更新人物設定\n2：只更換原型名稱\n3：取消", "1") : "1";
      if (choice === "3" || choice === null) {
        if (existing.archetype) heroSelect.value = existing.archetype;
        return;
      }
      const next = { name: nameInput.value.trim(), archetype: heroSelect.value };
      writeProtagonistLink(choice === "1" ? { ...next, ...archetypeSuggestion(heroSelect.value) } : next);
      renderProtagonistLinkPreview();
    });
    renderProtagonistLinkPreview();
    const originalContext = window.simpleGuideContext;
    window.simpleGuideContext = function () {
      const profile = readProtagonistLink();
      const base = typeof originalContext === "function" ? originalContext() : {};
      return { ...base, protagonist: profile.name || base.protagonist || "主角", archetype: profile.archetype || "尚未設定原型", actionStyle: profile.actionStyle || "自己的行動模式", speechStyle: profile.speechStyle || "自然直接", goal: profile.goal || "推進目前目標" };
    };
    window.simpleGuideOptionText = function (step, key) {
      const c = window.simpleGuideContext();
      const map = {
        purpose: { A: `${c.protagonist}依照「${c.archetype}」的敘事功能，直接推進「${c.conflict}」。`, B: `${c.protagonist}用「${c.speechStyle}」的方式與${c.ally || "盟友"}互動，讓人物關係推動本章。`, C: `${c.protagonist}發現與${c.opponent || "對手"}有關的重要秘密或資訊。`, D: "作者自訂" },
        strategy: { A: `${c.protagonist}用「${c.actionStyle}」向${c.opponent || "對手"}攤牌，逼迫對方回應。`, B: `${c.protagonist}保持外在克制，先蒐集「${c.conflict}」的線索。`, C: `${c.protagonist}借第三方或高風險手段改變局勢。`, D: "作者自訂" },
        cost: { A: `${c.protagonist}的身分或秘密可能曝光。`, B: `${c.protagonist}的重要關係開始失去信任。`, C: `${c.opponent || "對手"}提前警覺，或主角能力付出代價。`, D: "作者自訂" },
        result: { A: `${c.protagonist}朝「${c.goal}」前進一步，表面成功但留下隱患。`, B: `${c.protagonist}暫時失敗，但取得重要情報。`, C: `${c.protagonist}取得勝利，但付出重大代價。`, D: "作者自訂" },
        hook: { A: `新人物或新勢力突然出現，改變${c.protagonist}的處境。`, B: `證據、道具或情報異常，讓「${c.conflict}」更複雜。`, C: `${c.protagonist}的身分、秘密或背叛即將曝光。`, D: "作者自訂" }
      };
      return map[step?.key]?.[key] || `${key}：作者自訂`;
    };
  }

  const originalApplyThemeLinkSetup = window.applyTheme;
  if (typeof originalApplyThemeLinkSetup === "function") {
    window.applyTheme = function (...args) {
      const result = originalApplyThemeLinkSetup.apply(this, args);
      setTimeout(setupProtagonistLinking, 0);
      return result;
    };
  }

  window.Phase1Novel.applyProtagonistArchetypeSuggestion = applyProtagonistArchetypeSuggestion;
  setTimeout(setupProtagonistLinking, 0);
  document.addEventListener("DOMContentLoaded", setupProtagonistLinking);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
