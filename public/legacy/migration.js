(function () {
  "use strict";

  const MIGRATION_KEY = "novel_phase1_migration_v1";
  const OLD_STATE_KEY = "novel_platform_state";
  const OLD_SLOTS_KEY = "novel_project_slots_v1";
  const OLD_BOOKSHELF_KEY = "novel_bookshelf";

  function backupKey(key) {
    return `${key}_backup_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch (error) {
      return fallback;
    }
  }

  function hasStoryLikeState(value) {
    return value && typeof value === "object" && (value.title || value.seed || value.coreIdea || Array.isArray(value.story));
  }

  async function migrateState(snapshot, sourceLabel, index = 0) {
    if (!hasStoryLikeState(snapshot)) return null;
    const state = {
      ...snapshot,
      projectId: snapshot.projectId || NovelDB.safeId("project"),
      title: snapshot.title || snapshot.storyTitle || `舊作品 ${index + 1}`,
      story: Array.isArray(snapshot.story) ? snapshot.story : []
    };
    await NovelDB.saveState(state, `migrate-${sourceLabel}`);
    await NovelDB.createVersion(state.projectId, `舊資料遷移：${sourceLabel}`, state, { reason: "migration" });
    return state.projectId;
  }

  async function migrateOldLocalStorage(force = false) {
    if (!force && localStorage.getItem(MIGRATION_KEY)) {
      return { skipped: true, message: "舊資料先前已完成遷移。", migrated: 0, errors: [] };
    }

    const errors = [];
    let migrated = 0;

    try {
      const rawState = localStorage.getItem(OLD_STATE_KEY);
      if (rawState) {
        localStorage.setItem(backupKey(OLD_STATE_KEY), rawState);
        const id = await migrateState(JSON.parse(rawState), "目前作品", 0);
        if (id) migrated += 1;
      }
    } catch (error) {
      errors.push(`目前作品遷移失敗：${error.message || error}`);
    }

    try {
      const rawSlots = localStorage.getItem(OLD_SLOTS_KEY);
      const slots = readJson(OLD_SLOTS_KEY, []);
      if (rawSlots) localStorage.setItem(backupKey(OLD_SLOTS_KEY), rawSlots);
      for (let i = 0; i < slots.length; i += 1) {
        try {
          const id = await migrateState(slots[i].state || slots[i].snapshot || slots[i], "作品槽", i);
          if (id) migrated += 1;
        } catch (error) {
          errors.push(`作品槽 ${i + 1} 遷移失敗：${error.message || error}`);
        }
      }
    } catch (error) {
      errors.push(`作品槽讀取失敗：${error.message || error}`);
    }

    try {
      const rawBookshelf = localStorage.getItem(OLD_BOOKSHELF_KEY);
      const shelf = readJson(OLD_BOOKSHELF_KEY, []);
      if (rawBookshelf) localStorage.setItem(backupKey(OLD_BOOKSHELF_KEY), rawBookshelf);
      for (let i = 0; i < shelf.length; i += 1) {
        try {
          const id = await migrateState(shelf[i].snapshot || shelf[i].state, "書架", i);
          if (id) migrated += 1;
        } catch (error) {
          errors.push(`書架作品 ${i + 1} 遷移失敗：${error.message || error}`);
        }
      }
    } catch (error) {
      errors.push(`書架讀取失敗：${error.message || error}`);
    }

    const result = {
      skipped: false,
      migrated,
      errors,
      message: errors.length
        ? `已遷移 ${migrated} 筆舊作品，但有 ${errors.length} 個錯誤。舊 localStorage 已保留備份。`
        : `已完成舊資料遷移，共 ${migrated} 筆。舊 localStorage 已保留備份。`
    };
    localStorage.setItem(MIGRATION_KEY, JSON.stringify({ ...result, migratedAt: new Date().toISOString() }));
    await NovelDB.saveSetting("migration-result", result);
    return result;
  }

  async function migrationStatus() {
    const stored = localStorage.getItem(MIGRATION_KEY);
    if (!stored) return "尚未執行舊資料遷移。";
    try {
      const data = JSON.parse(stored);
      return data.message || "舊資料遷移狀態已記錄。";
    } catch (error) {
      return "舊資料遷移狀態格式異常。";
    }
  }

  window.NovelMigration = {
    migrateOldLocalStorage,
    migrationStatus
  };
})();
