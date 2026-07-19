import { createDraft, buildProjectBundle } from "../../domain/creation";
import { optionalValue } from "../../domain/index";
import type { NovelRepository } from "../contracts/index";
import type { ProjectBundle } from "../../domain/index";

const LEGACY_KEYS = ["novel_p12_studio_state", "novel_p11r2_studio_state", "novel_p11_consumer_state"];

export async function migrateLegacyStudioProjects(repository: NovelRepository) {
  if (typeof localStorage === "undefined") return { status: "not_applicable", migrated: 0, errors: [] as string[] };
  let migrated = 0; const errors: string[] = [];
  for (const key of LEGACY_KEYS) {
    const raw = localStorage.getItem(key); if (!raw) continue;
    try {
      const parsed = JSON.parse(raw), projects = Array.isArray(parsed?.projects) ? parsed.projects : [];
      for (const legacy of projects) {
        const draft = createDraft("legacy"); draft.projectId = String(legacy.id || crypto.randomUUID()); draft.id = `migration-${draft.projectId}`; draft.title = String(legacy.title || "未命名作品"); draft.genrePackId = legacy.packId || null; draft.genreId = legacy.topicId || null; draft.subgenreId = legacy.subCategory || null;
        draft.coreIdea = optionalValue(legacy.coreIdea?.value ?? null, legacy.coreIdea?.status ?? "deferred"); draft.protagonist = optionalValue(legacy.optionalFields?.protagonist?.value ?? null, legacy.optionalFields?.protagonist?.status ?? "deferred"); draft.style = optionalValue(legacy.optionalFields?.style?.value ?? null, legacy.optionalFields?.style?.status ?? "deferred");
        const bundle = buildProjectBundle(draft); await repository.createProject(bundle, `legacy:${key}:${draft.projectId}`); migrated += 1;
      }
    } catch (error) { errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  localStorage.setItem("novel_p2_legacy_migration_journal", JSON.stringify({ at: new Date().toISOString(), migrated, errors, sourceKeysRetained: true }));
  return { status: errors.length ? "partial" : "completed", migrated, errors };
}

export function mirrorProjectToLegacyStudio(bundle: ProjectBundle) {
  if (typeof localStorage === "undefined") return;
  const key = "novel_p12_studio_state";
  try {
    const current = JSON.parse(localStorage.getItem(key) || "null") || {};
    const projects = Array.isArray(current.projects) ? current.projects.filter((item: { id?: string }) => item.id !== bundle.project.id) : [];
    projects.unshift({ id: bundle.project.id, title: bundle.project.title, consumerGroupId: null, packId: bundle.project.genrePackId, topicId: bundle.project.genreId, topicName: null, subCategory: bundle.project.subgenreId, coreIdea: bundle.project.coreIdea, selectedPlayModeId: null, enabledStats: [], adultMode: false, optionalFields: { protagonist: bundle.seed.protagonist, identity: optionalValue<string>(null,"deferred"), archetype: optionalValue<string>(null,"deferred"), goal: bundle.seed.goal, weakness: bundle.seed.weakness, world: bundle.seed.world, worldRule: bundle.seed.worldRule, factions: optionalValue<string>(null,"deferred"), conflict: bundle.seed.conflict, villain: bundle.seed.opposition, style: bundle.project.narrativeStyle, storySeed: bundle.seed.logline, outline: optionalValue<string>(null,"deferred") }, storyLibrarySchemaVersion: "story-library-v1", chapterTitle: "第一章", draft: "", updatedAt: bundle.project.updatedAt, versions: [] });
    localStorage.setItem(key, JSON.stringify({ ...current, schemaVersion: Math.max(4, Number(current.schemaVersion)||0), activeProjectId: bundle.project.id, projects }));
  } catch { /* IndexedDB remains authoritative if compatibility mirroring fails. */ }
}

export function mirrorChapterToLegacyStudio(projectId: string, title: string, content: string) {
  if (typeof localStorage === "undefined") return;
  const key = "novel_p12_studio_state";
  try { const current = JSON.parse(localStorage.getItem(key) || "null"); if (!Array.isArray(current?.projects)) return; current.projects = current.projects.map((item: { id: string }) => item.id === projectId ? { ...item, chapterTitle: title, draft: content, updatedAt: new Date().toISOString() } : item); localStorage.setItem(key, JSON.stringify(current)); } catch { /* Preserve authoritative IndexedDB write. */ }
}
