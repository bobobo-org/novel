(function () {
  "use strict";

  const DB_NAME = "ZhutianNovelOfflineDB";
  const DB_VERSION = 2;
  const FALLBACK_PREFIX = "novel_idb_fallback_";
  const stores = ["projects", "volumes", "chapters", "versions", "settings", "characters", "worldSettings", "appSettings"];
  let dbPromise = null;

  const now = () => new Date().toISOString();
  const safeId = (prefix = "id") => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const words = (text) => String(text || "").replace(/\s+/g, "").length;

  function deepCopy(value) {
    return JSON.parse(JSON.stringify(value || null));
  }

  function sanitizeState(value) {
    const copy = deepCopy(value) || {};
    const secretKeys = /token|api.?key|authorization|password|secret/i;
    function walk(target) {
      if (!target || typeof target !== "object") return;
      Object.keys(target).forEach((key) => {
        if (secretKeys.test(key)) delete target[key];
        else walk(target[key]);
      });
    }
    walk(copy);
    return copy;
  }

  function fallbackRows(store) {
    try {
      return JSON.parse(localStorage.getItem(FALLBACK_PREFIX + store) || "[]");
    } catch (error) {
      return [];
    }
  }

  function saveFallbackRows(store, rows) {
    localStorage.setItem(FALLBACK_PREFIX + store, JSON.stringify(rows));
  }

  const fallback = {
    async put(store, value) {
      const rows = fallbackRows(store);
      const next = { ...value, id: value.id || safeId(store) };
      const index = rows.findIndex((row) => row.id === next.id);
      if (index >= 0) rows[index] = next;
      else rows.push(next);
      saveFallbackRows(store, rows);
      return next;
    },
    async get(store, id) {
      return fallbackRows(store).find((row) => row.id === id) || null;
    },
    async getAll(store) {
      return fallbackRows(store);
    },
    async delete(store, id) {
      saveFallbackRows(store, fallbackRows(store).filter((row) => row.id !== id));
    },
    async getByIndex(store, indexName, query) {
      return fallbackRows(store).filter((row) => {
        if (indexName === "projectId") return row.projectId === query;
        if (indexName === "volumeId") return row.volumeId === query;
        return row[indexName] === query;
      });
    }
  };

  function ensureIndex(store, name, keyPath, options) {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
  }

  function openDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        if (!db.objectStoreNames.contains("projects")) {
          const store = db.createObjectStore("projects", { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
          store.createIndex("status", "status");
        }
        if (!db.objectStoreNames.contains("volumes")) {
          const store = db.createObjectStore("volumes", { keyPath: "id" });
          store.createIndex("projectId", "projectId");
          store.createIndex("projectOrder", ["projectId", "order"]);
        }
        if (!db.objectStoreNames.contains("chapters")) {
          const store = db.createObjectStore("chapters", { keyPath: "id" });
          store.createIndex("projectId", "projectId");
          store.createIndex("volumeId", "volumeId");
          store.createIndex("projectChapter", ["projectId", "order"]);
        } else {
          const store = event.target.transaction.objectStore("chapters");
          ensureIndex(store, "projectId", "projectId");
          ensureIndex(store, "volumeId", "volumeId");
        }
        if (!db.objectStoreNames.contains("versions")) {
          const store = db.createObjectStore("versions", { keyPath: "id" });
          store.createIndex("projectId", "projectId");
          store.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
        if (!db.objectStoreNames.contains("characters")) {
          const store = db.createObjectStore("characters", { keyPath: "id" });
          store.createIndex("projectId", "projectId");
        }
        if (!db.objectStoreNames.contains("worldSettings")) {
          const store = db.createObjectStore("worldSettings", { keyPath: "id" });
          store.createIndex("projectId", "projectId", { unique: true });
        }
        if (!db.objectStoreNames.contains("appSettings")) db.createObjectStore("appSettings", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn("[NovelDB] IndexedDB unavailable; using localStorage fallback.", req.error);
        resolve(null);
      };
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  function requestToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB 操作失敗"));
    });
  }

  async function put(store, value) {
    const db = await openDb();
    if (!db) return fallback.put(store, value);
    const next = { ...value, id: value.id || safeId(store) };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(next);
      tx.oncomplete = () => resolve(next);
      tx.onerror = () => reject(tx.error || new Error("資料儲存失敗"));
      tx.onabort = () => reject(tx.error || new Error("資料儲存中止"));
    });
  }

  async function get(store, id) {
    const db = await openDb();
    if (!db) return fallback.get(store, id);
    return requestToPromise(db.transaction(store, "readonly").objectStore(store).get(id)).then((value) => value || null);
  }

  async function getAll(store) {
    const db = await openDb();
    if (!db) return fallback.getAll(store);
    return requestToPromise(db.transaction(store, "readonly").objectStore(store).getAll()).then((rows) => rows || []);
  }

  async function deleteRow(store, id) {
    const db = await openDb();
    if (!db) return fallback.delete(store, id);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("資料刪除失敗"));
    });
  }

  async function getByIndex(store, indexName, query) {
    const db = await openDb();
    if (!db) return fallback.getByIndex(store, indexName, query);
    const objectStore = db.transaction(store, "readonly").objectStore(store);
    if (!objectStore.indexNames.contains(indexName)) return [];
    return requestToPromise(objectStore.index(indexName).getAll(query)).then((rows) => rows || []);
  }

  async function saveSetting(id, value) {
    return put("settings", { id, value: sanitizeState(value), updatedAt: now() });
  }

  async function getSetting(id) {
    const row = await get("settings", id);
    return row?.value ?? null;
  }

  function chapterTitle(content, index) {
    const match = String(content || "").match(/^#\s*(.+)$/m);
    return match ? match[1].trim() : `第${index + 1}章`;
  }

  function chapterSummary(content) {
    return String(content || "").replace(/\s+/g, " ").slice(0, 180);
  }

  function chapterHook(content) {
    const text = String(content || "");
    const match = text.match(/【章尾鉤子】\s*([\s\S]*?)(?:\n\n|$)/);
    return match ? match[1].trim().slice(0, 240) : text.slice(-180);
  }

  async function defaultVolume(projectId) {
    const existing = (await getByIndex("volumes", "projectId", projectId)).sort((a, b) => a.order - b.order);
    if (existing[0]) return existing[0];
    return put("volumes", {
      id: safeId("volume"),
      projectId,
      title: "第一卷",
      description: "自動建立的預設分卷",
      order: 1,
      createdAt: now(),
      updatedAt: now()
    });
  }

  function projectFromState(state, projectId) {
    const clean = sanitizeState(state);
    const story = Array.isArray(clean.story) ? clean.story : [];
    return {
      id: projectId || clean.projectId || safeId("project"),
      title: clean.title || "未命名小說",
      synopsis: clean.coreIdea || clean.seed || clean.premise || "",
      genre: clean.genre || clean.themeMode || "",
      style: clean.styleMode || "",
      status: clean.status || "writing",
      totalWords: story.reduce((sum, chapter) => sum + words(chapter), 0),
      currentVolumeId: clean.currentVolumeId || "",
      currentChapterId: clean.currentChapterId || "",
      currentChapter: story.length,
      premise: clean.seed || clean.coreIdea || "",
      createdAt: clean.createdAt || now(),
      updatedAt: now(),
      state: clean
    };
  }

  async function saveState(state, reason = "auto") {
    const project = await put("projects", projectFromState(state, state.projectId || localStorage.getItem("novel_last_project_id")));
    const volume = await defaultVolume(project.id);
    localStorage.setItem("novel_last_project_id", project.id);
    localStorage.setItem("novel_last_chapter_id", project.currentChapterId || "");
    state.projectId = project.id;
    state.currentVolumeId = state.currentVolumeId || volume.id;

    const existing = await getByIndex("chapters", "projectId", project.id);
    const byOrder = new Map(existing.map((chapter) => [chapter.order || chapter.chapterNumber, chapter]));
    const story = Array.isArray(state.story) ? state.story : [];
    let currentChapterId = "";
    for (let i = 0; i < story.length; i += 1) {
      const prev = byOrder.get(i + 1);
      const chapter = await put("chapters", {
        id: prev?.id || `${project.id}-chapter-${i + 1}`,
        projectId: project.id,
        volumeId: prev?.volumeId || volume.id,
        title: chapterTitle(story[i], i),
        content: story[i],
        summary: chapterSummary(story[i]),
        hook: chapterHook(story[i]),
        wordCount: words(story[i]),
        order: i + 1,
        chapterNumber: i + 1,
        createdAt: prev?.createdAt || now(),
        updatedAt: now(),
        version: (prev?.version || 0) + 1
      });
      currentChapterId = chapter.id;
    }

    const updatedProject = await put("projects", {
      ...project,
      currentVolumeId: volume.id,
      currentChapterId,
      currentChapter: story.length,
      totalWords: story.reduce((sum, chapter) => sum + words(chapter), 0),
      updatedAt: now(),
      state: sanitizeState({ ...state, currentVolumeId: volume.id, currentChapterId })
    });
    await put("settings", { id: "last-open", lastProjectId: project.id, lastChapterId: currentChapterId, mode: "offline-rule", updatedAt: now() });
    await put("appSettings", { id: "last-open", lastProjectId: project.id, lastChapterId: currentChapterId, mode: "offline-rule", updatedAt: now() });
    return { project: updatedProject, projectId: project.id, volumeId: volume.id, chapterId: currentChapterId, chapters: story.length, reason };
  }

  async function loadProject(projectId) {
    const project = await get("projects", projectId);
    if (!project) return null;
    const chapters = (await getByIndex("chapters", "projectId", projectId)).sort((a, b) => (a.order || a.chapterNumber || 0) - (b.order || b.chapterNumber || 0));
    return {
      ...(project.state || {}),
      ...project,
      projectId,
      story: chapters.map((chapter) => chapter.content),
      chapter: chapters.length,
      currentChapter: chapters.length,
      currentChapterId: project.currentChapterId || chapters.at(-1)?.id || "",
      currentVolumeId: project.currentVolumeId || chapters.at(-1)?.volumeId || ""
    };
  }

  async function latestProject() {
    const projects = await getAll("projects");
    return projects.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
  }

  async function createVersion(projectId, label, state, meta = {}) {
    const clean = sanitizeState(state);
    const chapters = Array.isArray(clean.story) ? clean.story : [];
    return put("versions", {
      id: safeId("version"),
      projectId,
      label,
      reason: meta.reason || label,
      state: clean,
      chapters,
      createdAt: now(),
      summary: `${clean.title || "未命名小說"}｜${chapters.length}章｜${label}`
    });
  }

  async function listProjectBundle(projectId) {
    const project = await get("projects", projectId);
    if (!project) return null;
    const [volumes, chapters, versions] = await Promise.all([
      getByIndex("volumes", "projectId", projectId),
      getByIndex("chapters", "projectId", projectId),
      getByIndex("versions", "projectId", projectId)
    ]);
    return {
      project,
      volumes: volumes.sort((a, b) => a.order - b.order),
      chapters: chapters.sort((a, b) => (a.order || 0) - (b.order || 0)),
      versions: versions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    };
  }

  async function deleteProject(projectId) {
    const [volumes, chapters, versions] = await Promise.all([
      getByIndex("volumes", "projectId", projectId),
      getByIndex("chapters", "projectId", projectId),
      getByIndex("versions", "projectId", projectId)
    ]);
    await Promise.all([
      ...volumes.map((row) => deleteRow("volumes", row.id)),
      ...chapters.map((row) => deleteRow("chapters", row.id)),
      ...versions.map((row) => deleteRow("versions", row.id)),
      deleteRow("projects", projectId)
    ]);
  }

  window.NovelDB = {
    DB_NAME,
    DB_VERSION,
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
    saveSetting,
    getSetting,
    sanitizeState,
    saveState,
    loadProject,
    latestProject,
    createVersion,
    defaultVolume,
    listProjectBundle,
    deleteProject,
    isIndexedDbAvailable: async () => Boolean(await openDb())
  };
})();
