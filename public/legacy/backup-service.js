(function () {
  "use strict";

  const BACKUP_VERSION = "phase1-longform-backup-v1";

  function sanitize(value) {
    const copy = JSON.parse(JSON.stringify(value || null));
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

  function download(name, text, type = "application/json;charset=utf-8") {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportAll() {
    const [projects, volumes, chapters, versions, settings] = await Promise.all([
      NovelDB.getAll("projects"),
      NovelDB.getAll("volumes"),
      NovelDB.getAll("chapters"),
      NovelDB.getAll("versions"),
      NovelDB.getAll("settings")
    ]);
    const payload = sanitize({
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      projects,
      volumes,
      chapters,
      versions,
      settings: settings.filter((row) => !/token|key|authorization|password|secret/i.test(row.id || ""))
    });
    download(`novel_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
    return payload;
  }

  async function exportProject(projectId) {
    const bundle = await NovelDB.listProjectBundle(projectId);
    if (!bundle) throw new Error("找不到要匯出的作品。");
    const payload = sanitize({
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      projects: [bundle.project],
      volumes: bundle.volumes,
      chapters: bundle.chapters,
      versions: bundle.versions,
      settings: []
    });
    download(`${bundle.project.title || "novel"}_backup.json`, JSON.stringify(payload, null, 2));
    return payload;
  }

  function validateBackup(data) {
    if (!data || typeof data !== "object") throw new Error("JSON 格式不正確。");
    if (!Array.isArray(data.projects) && !data.project && !data.state) {
      throw new Error("這不是可匯入的小說備份，缺少 projects/project/state。");
    }
    return true;
  }

  function normalizeBackup(data, duplicate = true) {
    validateBackup(data);
    if (data.state || data.project) {
      const state = data.state || data.project?.state || data.project || {};
      const projectId = duplicate ? NovelDB.safeId("project") : (state.projectId || data.project?.id || NovelDB.safeId("project"));
      const story = Array.isArray(state.story) ? state.story : [];
      const volumeId = NovelDB.safeId("volume");
      return {
        projects: [{
          id: projectId,
          title: state.title || "匯入作品",
          synopsis: state.coreIdea || state.seed || "",
          genre: state.genre || state.themeMode || "",
          style: state.styleMode || "",
          status: state.status || "writing",
          totalWords: story.reduce((sum, chapter) => sum + NovelDB.words(chapter), 0),
          currentVolumeId: volumeId,
          currentChapterId: "",
          currentChapter: story.length,
          createdAt: state.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          state: { ...state, projectId, currentVolumeId: volumeId }
        }],
        volumes: [{ id: volumeId, projectId, title: "第一卷", description: "由舊備份匯入", order: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
        chapters: story.map((content, index) => ({
          id: `${projectId}-chapter-${index + 1}`,
          projectId,
          volumeId,
          title: (String(content).match(/^#\s*(.+)$/m) || [null, `第${index + 1}章`])[1],
          content,
          summary: String(content).replace(/\s+/g, " ").slice(0, 180),
          hook: String(content).slice(-180),
          wordCount: NovelDB.words(content),
          order: index + 1,
          chapterNumber: index + 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })),
        versions: []
      };
    }

    const idMap = new Map();
    const projects = (data.projects || []).map((project) => {
      const nextId = duplicate ? NovelDB.safeId("project") : project.id;
      idMap.set(project.id, nextId);
      return sanitize({ ...project, id: nextId, title: duplicate ? `${project.title || "匯入作品"}（匯入副本）` : project.title, updatedAt: new Date().toISOString() });
    });
    const volumeMap = new Map();
    const volumes = (data.volumes || []).map((volume) => {
      const nextId = duplicate ? NovelDB.safeId("volume") : volume.id;
      volumeMap.set(volume.id, nextId);
      return sanitize({ ...volume, id: nextId, projectId: idMap.get(volume.projectId) || volume.projectId, updatedAt: new Date().toISOString() });
    });
    const chapters = (data.chapters || []).map((chapter) => sanitize({
      ...chapter,
      id: duplicate ? NovelDB.safeId("chapter") : chapter.id,
      projectId: idMap.get(chapter.projectId) || chapter.projectId,
      volumeId: volumeMap.get(chapter.volumeId) || chapter.volumeId,
      updatedAt: new Date().toISOString()
    }));
    const versions = (data.versions || []).map((version) => sanitize({
      ...version,
      id: NovelDB.safeId("version"),
      projectId: idMap.get(version.projectId) || version.projectId,
      createdAt: version.createdAt || new Date().toISOString()
    }));
    return { projects, volumes, chapters, versions };
  }

  function previewText(data) {
    validateBackup(data);
    const projects = data.projects || (data.state || data.project ? [data.project || data.state] : []);
    const chapterCount = Array.isArray(data.chapters) ? data.chapters.length : (data.state?.story || data.project?.state?.story || []).length;
    return `匯入預覽：${projects.length} 部作品、${data.volumes?.length || 0} 個分卷、${chapterCount} 個章節、${data.versions?.length || 0} 筆版本。`;
  }

  async function importBackup(raw, duplicate = true) {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    const normalized = normalizeBackup(data, duplicate);
    for (const project of normalized.projects) await NovelDB.put("projects", project);
    for (const volume of normalized.volumes || []) await NovelDB.put("volumes", volume);
    for (const chapter of normalized.chapters || []) await NovelDB.put("chapters", chapter);
    for (const version of normalized.versions || []) await NovelDB.put("versions", version);
    const first = normalized.projects[0];
    if (first) {
      localStorage.setItem("novel_last_project_id", first.id);
      await NovelDB.saveSetting("last-open", { lastProjectId: first.id, updatedAt: new Date().toISOString() });
    }
    return { importedProjects: normalized.projects.length, importedChapters: normalized.chapters.length, firstProjectId: first?.id || "" };
  }

  async function promptImport() {
    const raw = prompt("貼上 JSON 備份內容。系統會先驗證格式，預設建立副本，不覆蓋原作品：");
    if (!raw) return null;
    const data = JSON.parse(raw);
    const preview = previewText(data);
    if (!confirm(`${preview}\n\n是否建立匯入副本？`)) return null;
    return importBackup(data, true);
  }

  window.NovelBackup = {
    BACKUP_VERSION,
    sanitize,
    exportAll,
    exportProject,
    validateBackup,
    previewText,
    importBackup,
    promptImport
  };
})();
