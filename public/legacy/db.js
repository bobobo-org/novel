(function () {
  "use strict";

  const DB_NAME = "ZhutianNovelOfflineDB";
  const DB_VERSION = 1;
  const FALLBACK_PREFIX = "novel_idb_fallback_";
  const stores = ["projects", "chapters", "characters", "worldSettings", "versions", "appSettings"];

  function now() {
    return new Date().toISOString();
  }

  function safeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function words(text) {
    return String(text || "").replace(/\s+/g, "").length;
  }

  function getFallbackStore(name) {
    try {
      return JSON.parse(localStorage.getItem(FALLBACK_PREFIX + name) || "[]");
    } catch (error) {
      return [];
    }
  }

  function setFallbackStore(name, rows) {
    localStorage.setItem(FALLBACK_PREFIX + name, JSON.stringify(rows));
  }

  const fallback = {
    available: false,
    async put(store, value) {
      const rows = getFallbackStore(store);
      const id = value.id || safeId(store);
      const next = { ...value, id };
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows[index] = next;
      else rows.push(next);
      setFallbackStore(store, rows);
      return next;
    },
    async get(store, id) {
      return getFallbackStore(store).find((row) => row.id === id) || null;
    },
    async getAll(store) {
      return getFallbackStore(store);
    },
    async delete(store, id) {
      setFallbackStore(store, getFallbackStore(store).filter((row) => row.id !== id));
    },
    async clear(store) {
      setFallbackStore(store, []);
    }
  };

  let dbPromise;

  function openDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("projects")) {
          const store = db.createObjectStore("projects", { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
          store.createIndex("status", "status");
        }
        if (!db.objectStoreNames.contains("chapters")) {
          const store = db.createObjectStore("chapters", { keyPath: "id" });
          store.createIndex("projectId", "projectId");
          store.createIndex("projectChapter", ["projectId", "chapterNumber"], { unique: true });
        }
        if (!db.objectStoreNames.contains("characters")) {
          const store = db.createObjectStore("characters", { keyPath: "id" });
          store.createIndex("projectId", "projectId");
        }
        if (!db.objectStoreNames.contains("worldSettings")) {
          const store = db.createObjectStore("worldSettings", { keyPath: "id" });
          store.createIndex("projectId", "projectId", { unique: true });
        }
        if (!db.objectStoreNames.contains("versions")) {
          const store = db.createObjectStore("versions", { keyPath: "id" });
          store.createIndex("projectId", "projectId");
          store.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("appSettings")) {
          db.createObjectStore("appSettings", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn("[NovelDB] IndexedDB unavailable, fallback to localStorage", req.error);
        resolve(null);
      };
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  async function tx(store, mode, action) {
    const db = await openDb();
    if (!db) return action(fallback, store);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const objectStore = transaction.objectStore(store);
      const result = action(objectStore, store);
      transaction.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : result);
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 交易失敗"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 交易中止"));
    });
  }

  function requestToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(store, value) {
    const db = await openDb();
    if (!db) return fallback.put(store, value);
    const next = { ...value, id: value.id || safeId(store) };
    await tx(store, "readwrite", (objectStore) => objectStore.put(next));
    return next;
  }

  async function get(store, id) {
    const db = await openDb();
    if (!db) return fallback.get(store, id);
    return tx(store, "readonly", (objectStore) => {
      const holder = { __value: null };
      requestToPromise(objectStore.get(id)).then((value) => { holder.__value = value || null; });
      return holder;
    });
  }

  async function getAll(store) {
    const db = await openDb();
    if (!db) return fallback.getAll(store);
    return tx(store, "readonly", (objectStore) => {
      const holder = { __value: [] };
      requestToPromise(objectStore.getAll()).then((value) => { holder.__value = value || []; });
      return holder;
    });
  }

  async function deleteRow(store, id) {
    const db = await openDb();
    if (!db) return fallback.delete(store, id);
    await tx(store, "readwrite", (objectStore) => objectStore.delete(id));
  }

  async function getByIndex(store, indexName, query) {
    const db = await openDb();
    if (!db) {
      const rows = await fallback.getAll(store);
      if (indexName === "projectId") return rows.filter((row) => row.projectId === query);
      return rows;
    }
    return tx(store, "readonly", (objectStore) => {
      const holder = { __value: [] };
      requestToPromise(objectStore.index(indexName).getAll(query)).then((value) => { holder.__value = value || []; });
      return holder;
    });
  }

  function sanitizeState(state) {
    const copy = JSON.parse(JSON.stringify(state || {}));
    delete copy.aiToken;
    delete copy.token;
    delete copy.authorization;
    delete copy.Authorization;
    return copy;
  }

  function projectFromState(state, projectId) {
    const clean = sanitizeState(state);
    const chapters = Array.isArray(clean.story) ? clean.story : [];
    const totalWords = chapters.reduce((sum, chapter) => sum + words(chapter), 0);
    const title = clean.title || "未命名小說";
    return {
      id: projectId || clean.projectId || safeId("project"),
      title,
      genre: clean.genre || clean.themeMode || "",
      style: clean.styleMode || "",
      premise: clean.seed || clean.coreIdea || "",
      currentChapter: chapters.length,
      totalWords,
      createdAt: clean.createdAt || now(),
      updatedAt: now(),
      status: clean.status || "writing",
      state: clean
    };
  }

  function chapterTitle(content, index) {
    const match = String(content || "").match(/^#\s*(.+)$/m);
    return match ? match[1].trim() : `第${index + 1}章`;
  }

  function chapterSummary(content) {
    return String(content || "").replace(/\s+/g, " ").slice(0, 160);
  }

  function chapterHook(content) {
    const text = String(content || "");
    const match = text.match(/【章尾鉤子】\s*([\s\S]*?)(?:\n\n|$)/);
    return match ? match[1].trim().slice(0, 240) : text.slice(-180);
  }

  async function saveState(state, reason = "auto") {
    const project = await put("projects", projectFromState(state, state.projectId || localStorage.getItem("novel_last_project_id")));
    localStorage.setItem("novel_last_project_id", project.id);
    state.projectId = project.id;
    await put("appSettings", {
      id: "last-open",
      lastProjectId: project.id,
      mode: "offline-rule",
      updatedAt: now()
    });

    const existing = await getByIndex("chapters", "projectId", project.id);
    const byNumber = new Map(existing.map((chapter) => [chapter.chapterNumber, chapter]));
    const story = Array.isArray(state.story) ? state.story : [];
    for (let i = 0; i < story.length; i += 1) {
      const prev = byNumber.get(i + 1);
      await put("chapters", {
        id: prev?.id || `${project.id}-chapter-${i + 1}`,
        projectId: project.id,
        chapterNumber: i + 1,
        title: chapterTitle(story[i], i),
        content: story[i],
        summary: chapterSummary(story[i]),
        hook: chapterHook(story[i]),
        createdAt: prev?.createdAt || now(),
        updatedAt: now(),
        version: (prev?.version || 0) + 1
      });
    }

    await put("worldSettings", {
      id: `${project.id}-world`,
      projectId: project.id,
      themeMode: state.themeMode || "",
      subTheme: state.subTheme || "",
      worldCore: state.worldCore || "",
      powerCore: state.powerCore || "",
      conflictCore: state.conflictCore || "",
      villainCore: state.villainCore || "",
      updatedAt: now()
    });

    const protagonistName = state.protagonist || state.heroType || "主角";
    const villainName = state.villainCore || "對立面";
    await put("characters", {
      id: `${project.id}-character-protagonist`,
      projectId: project.id,
      name: protagonistName,
      role: "主角",
      arc: state.conflictCore || "",
      updatedAt: now()
    });
    await put("characters", {
      id: `${project.id}-character-villain`,
      projectId: project.id,
      name: villainName,
      role: "反派／對立面",
      arc: state.villainCore || "",
      updatedAt: now()
    });

    return { project, chapters: story.length, reason };
  }

  async function createVersion(projectId, label, state, meta = {}) {
    const clean = sanitizeState(state);
    return put("versions", {
      id: safeId("version"),
      projectId,
      label,
      reason: meta.reason || label,
      state: clean,
      chapters: Array.isArray(clean.story) ? clean.story : [],
      createdAt: now(),
      summary: `${clean.title || "未命名小說"}｜${(clean.story || []).length}章｜${label}`
    });
  }

  async function loadProject(projectId) {
    const project = await get("projects", projectId);
    if (!project) return null;
    const chapters = (await getByIndex("chapters", "projectId", projectId))
      .sort((a, b) => a.chapterNumber - b.chapterNumber);
    return {
      ...project.state,
      ...project,
      projectId,
      story: chapters.map((chapter) => chapter.content),
      chapter: chapters.length
    };
  }

  async function latestProject() {
    const projects = await getAll("projects");
    return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
  }

  window.NovelDB = {
    DB_NAME,
    stores,
    now,
    words,
    safeId,
    openDb,
    put,
    get,
    getAll,
    delete: deleteRow,
    getByIndex,
    sanitizeState,
    saveState,
    createVersion,
    loadProject,
    latestProject,
    isIndexedDbAvailable: async () => Boolean(await openDb())
  };
})();
