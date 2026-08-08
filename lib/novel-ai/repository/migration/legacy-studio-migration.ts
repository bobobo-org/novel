import { optionalValue } from "../../domain/index";
import type { NovelRepository } from "../contracts/index";
import type {
  Chapter,
  NovelProject,
  ProjectBundle,
} from "../../domain/index";
import { ensureStudioCanonicalProject } from "../studio-canonical";
import { resolveStoryPlayMode } from "../../domain/play-mode";

const LEGACY_KEYS = ["novel_p12_studio_state", "novel_p11r2_studio_state", "novel_p11_consumer_state"];

export const EXPLICIT_LEGACY_STUDIO_KEYS = [
  "novel_p11r2_studio_state",
  "novel_p11_consumer_state",
] as const;

type LegacyMigrationOptions = {
  sourceKeys?: readonly string[];
  overwriteExisting?: boolean;
};

type LegacyMigrationJournal = {
  sourceFingerprint?: string;
};

function fingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${value.length}`;
}

export function previewLegacyStudioProjects(
  sourceKeys: readonly string[] = EXPLICIT_LEGACY_STUDIO_KEYS,
) {
  if (typeof localStorage === "undefined") {
    return {
      found: false,
      pending: false,
      projectCount: 0,
      titles: [] as string[],
      sourceKeys: [] as string[],
      sourceFingerprint: null as string | null,
    };
  }
  const rows: Array<{ key: string; raw: string }> = [];
  const titles: string[] = [];
  const projectIds = new Set<string>();
  for (const key of sourceKeys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const projects = Array.isArray(parsed?.projects) ? parsed.projects : [];
      if (!projects.length) continue;
      rows.push({ key, raw });
      for (const project of projects) {
        const id = String(project?.id || `${key}:${titles.length}`);
        if (projectIds.has(id)) continue;
        projectIds.add(id);
        titles.push(String(project?.title || "未命名作品").slice(0, 120));
      }
    } catch {
      // Invalid legacy bytes remain untouched and are reported by the explicit
      // import operation instead of being rewritten during discovery.
    }
  }
  const sourceFingerprint = rows.length
    ? fingerprint(rows.map((row) => `${row.key}:${row.raw}`).join("\n"))
    : null;
  let journal: LegacyMigrationJournal = {};
  try {
    journal = JSON.parse(
      localStorage.getItem("novel_p2_legacy_migration_journal") || "{}",
    ) as LegacyMigrationJournal;
  } catch {}
  return {
    found: rows.length > 0,
    pending: Boolean(
      rows.length
      && sourceFingerprint
      && journal.sourceFingerprint !== sourceFingerprint
    ),
    projectCount: projectIds.size,
    titles,
    sourceKeys: rows.map((row) => row.key),
    sourceFingerprint,
  };
}

export async function migrateLegacyStudioProjects(
  repository: NovelRepository,
  options: LegacyMigrationOptions = {},
) {
  if (typeof localStorage === "undefined") {
    return {
      status: "not_applicable",
      migrated: 0,
      errors: [] as string[],
    };
  }
  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};
  const text = (...values: unknown[]) => {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
      const nested = asRecord(value).value;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
    return null;
  };
  const rawText = (...values: unknown[]) => {
    for (const value of values) {
      if (typeof value === "string") return value;
      const nested = asRecord(value).value;
      if (typeof nested === "string") return nested;
    }
    return null;
  };
  let migrated = 0;
  let skippedExisting = 0;
  const errors: string[] = [];
  const seenProjectIds = new Set<string>();
  const sourceKeys = options.sourceKeys ?? LEGACY_KEYS;
  const overwriteExisting = options.overwriteExisting ?? true;
  const preview = previewLegacyStudioProjects(sourceKeys);
  for (const key of sourceKeys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const projects = Array.isArray(parsed?.projects) ? parsed.projects : [];
      for (const legacy of projects) {
        const row = asRecord(legacy);
        const projectId = String(row.id || crypto.randomUUID());
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) {
          errors.push(`${key}:${projectId}: invalid project id`);
          continue;
        }
        if (seenProjectIds.has(projectId)) continue;
        seenProjectIds.add(projectId);
        const optionalFields = asRecord(row.optionalFields);
        const stats = asRecord(row.stats);
        const existingProject = await repository.get<NovelProject>(
          "projects",
          projectId,
        );
        if (existingProject && !overwriteExisting) {
          skippedExisting += 1;
          continue;
        }
        let snapshot = await ensureStudioCanonicalProject(repository, {
          id: projectId,
          title: text(row.title) || "未命名作品",
          chapterTitle: text(row.chapterTitle) || "第一章",
          draft: text(row.draft, row.text) || "",
          packId: text(row.packId),
          topicId: text(row.topicId),
          subCategory: text(row.subCategory),
          coreIdea: text(row.coreIdea, row.synopsis),
          protagonist: text(optionalFields.protagonist, row.protagonist),
          goal: text(optionalFields.goal, row.goal),
          world: text(optionalFields.world, row.world, row.location),
          worldRule: text(optionalFields.worldRule, row.worldRule),
          conflict: text(optionalFields.conflict, row.conflict, row.crisis),
          style: text(optionalFields.style, row.style),
          enabledStats: Array.isArray(row.enabledStats)
            ? row.enabledStats.map(String)
            : Object.keys(stats),
        });
        const legacyUpdatedAt = Date.parse(text(row.updatedAt) ?? "");
        const canonicalUpdatedAt = Math.max(
          Date.parse(existingProject?.updatedAt ?? ""),
          Date.parse(snapshot.chapter.updatedAt),
        );
        if (
          existingProject
          && Number.isFinite(legacyUpdatedAt)
          && (
            !Number.isFinite(canonicalUpdatedAt)
            || legacyUpdatedAt > canonicalUpdatedAt
          )
        ) {
          const coreIdea = text(row.coreIdea, row.synopsis);
          const narrativeStyle = text(optionalFields.style, row.style);
          const nextProject: NovelProject = {
            ...snapshot.project,
            title: text(row.title) || snapshot.project.title,
            genrePackId: text(row.packId) ?? snapshot.project.genrePackId,
            genreId: text(row.topicId) ?? snapshot.project.genreId,
            subgenreId:
              text(row.subCategory) ?? snapshot.project.subgenreId,
            coreIdea: coreIdea
              && coreIdea !== snapshot.project.coreIdea.value
              ? optionalValue(coreIdea, "user_defined")
              : snapshot.project.coreIdea,
            narrativeStyle: narrativeStyle
              && narrativeStyle !== snapshot.project.narrativeStyle.value
              ? optionalValue(narrativeStyle, "user_defined")
              : snapshot.project.narrativeStyle,
            adultMode: snapshot.project.adultMode
              || row.adult === true
              || row.adultMode === true,
          };
          if (
            JSON.stringify({
              title: nextProject.title,
              genrePackId: nextProject.genrePackId,
              genreId: nextProject.genreId,
              subgenreId: nextProject.subgenreId,
              coreIdea: nextProject.coreIdea,
              narrativeStyle: nextProject.narrativeStyle,
              adultMode: nextProject.adultMode,
            }) !== JSON.stringify({
              title: snapshot.project.title,
              genrePackId: snapshot.project.genrePackId,
              genreId: snapshot.project.genreId,
              subgenreId: snapshot.project.subgenreId,
              coreIdea: snapshot.project.coreIdea,
              narrativeStyle: snapshot.project.narrativeStyle,
              adultMode: snapshot.project.adultMode,
            })
          ) {
            snapshot = {
              ...snapshot,
              project: await repository.put(
                "projects",
                nextProject,
                snapshot.project.revision,
              ),
            };
          }
          const nextChapter: Chapter = {
            ...snapshot.chapter,
            title: text(row.chapterTitle) || snapshot.chapter.title,
            content:
              rawText(row.draft, row.text) ?? snapshot.chapter.content,
          };
          if (
            nextChapter.title !== snapshot.chapter.title
            || nextChapter.content !== snapshot.chapter.content
          ) {
            snapshot = {
              ...snapshot,
              chapter: await repository.put(
                "chapters",
                nextChapter,
                snapshot.chapter.revision,
              ),
            };
          }
        }
        if (
          (row.adult === true || row.adultMode === true)
          && !snapshot.project.adultMode
        ) {
          await repository.put(
            "projects",
            { ...snapshot.project, adultMode: true },
            snapshot.project.revision,
          );
        }
        migrated += 1;
      }
    } catch (error) {
      errors.push(
        `${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  localStorage.setItem(
    "novel_p2_legacy_migration_journal",
    JSON.stringify({
      at: new Date().toISOString(),
      migrated,
      skippedExisting,
      errors,
      sourceKeysRetained: true,
      sourceFingerprint: preview.sourceFingerprint,
    }),
  );
  return {
    status: errors.length ? "partial" : "completed",
    migrated,
    skippedExisting,
    errors,
    sourceKeysRetained: true,
    sourceFingerprint: preview.sourceFingerprint,
  };
}

export function mirrorProjectToLegacyStudio(bundle: ProjectBundle) {
  if (typeof localStorage === "undefined") return;
  const key = "novel_p12_studio_state";
  try {
    const current = JSON.parse(localStorage.getItem(key) || "null") || {};
    const projects = Array.isArray(current.projects) ? current.projects.filter((item: { id?: string }) => item.id !== bundle.project.id) : [];
    projects.unshift({ id: bundle.project.id, title: bundle.project.title, consumerGroupId: null, packId: bundle.project.genrePackId, topicId: bundle.project.genreId, topicName: null, subCategory: bundle.project.subgenreId, coreIdea: bundle.project.coreIdea, selectedPlayModeId: resolveStoryPlayMode(bundle.storyState), enabledStats: [], adultMode: false, optionalFields: { protagonist: bundle.seed.protagonist, identity: optionalValue<string>(null,"deferred"), archetype: optionalValue<string>(null,"deferred"), goal: bundle.seed.goal, weakness: bundle.seed.weakness, world: bundle.seed.world, worldRule: bundle.seed.worldRule, factions: optionalValue<string>(null,"deferred"), conflict: bundle.seed.conflict, villain: bundle.seed.opposition, style: bundle.project.narrativeStyle, storySeed: bundle.seed.logline, outline: optionalValue<string>(null,"deferred") }, storyLibrarySchemaVersion: "story-library-v1", chapterTitle: "第一章", draft: "", updatedAt: bundle.project.updatedAt, versions: [] });
    localStorage.setItem(key, JSON.stringify({ ...current, schemaVersion: Math.max(4, Number(current.schemaVersion)||0), activeProjectId: bundle.project.id, projects }));
  } catch { /* IndexedDB remains authoritative if compatibility mirroring fails. */ }
}

export function mirrorChapterToLegacyStudio(projectId: string, title: string, content: string) {
  if (typeof localStorage === "undefined") return;
  const key = "novel_p12_studio_state";
  try { const current = JSON.parse(localStorage.getItem(key) || "null"); if (!Array.isArray(current?.projects)) return; current.projects = current.projects.map((item: { id: string }) => item.id === projectId ? { ...item, chapterTitle: title, draft: content, updatedAt: new Date().toISOString() } : item); localStorage.setItem(key, JSON.stringify(current)); } catch { /* Preserve authoritative IndexedDB write. */ }
}
