import type { NovelProject, StoryState } from "../domain";
import type { NovelRepository } from "../repository";
import { createProjectBackup } from "../repository/backup";
import {
  MINGTAN_PRESET_ID,
  RPG_RESOURCE_CATALOG_V3,
  XIANXIA_RULESET_ID,
  buildMingtanPresetState,
  readRpgStateV3,
} from "../game/progression/xianxia-ruleset-v3";
import { initialRpgStats } from "../game/progression/rpg-progression";

export const MINGTAN_PRESET_PREVIEW = {
  presetId: MINGTAN_PRESET_ID,
  rulesetId: XIANXIA_RULESET_ID,
  difficulty: "extreme" as const,
  resources: [
    { resourceId: "currency.spiritStone", amount: 10_000 },
    { resourceId: "item.feminization-charm-pill", amount: 10 },
  ],
  customActionEnabled: false,
  safetyBackupRequired: true,
  chapterContentWillBeOverwritten: false,
} as const;

export function describeMingtanPresetPreview() {
  const nameById = new Map(RPG_RESOURCE_CATALOG_V3.map((resource) => [resource.id, resource.localizedName]));
  return {
    ...MINGTAN_PRESET_PREVIEW,
    resources: MINGTAN_PRESET_PREVIEW.resources.map((resource) => ({
      ...resource,
      localizedName: nameById.get(resource.resourceId) ?? resource.resourceId,
    })),
  };
}

export async function initializeMingtanPreset(
  repository: NovelRepository,
  projectId: string,
  options: {
    now?: string;
    initialRealmLevel?: number;
    initialStats?: Record<string, number>;
  } = {},
) {
  const project = await repository.get<NovelProject>("projects", projectId);
  if (!project || project.deletedAt) {
    throw Object.assign(new Error("找不到要初始化的作品。"), {
      code: "MINGTAN_PRESET_PROJECT_NOT_FOUND",
    });
  }
  const states = await repository.list<StoryState>("storyStates", projectId);
  const current = states.find((state) => state.id === project.storyStateId) ?? states[0] ?? null;
  if (!current) {
    throw Object.assign(new Error("作品缺少 StoryState。"), {
      code: "MINGTAN_PRESET_STORY_STATE_MISSING",
    });
  }
  const existing = readRpgStateV3(current);
  const alreadyApplied = (
    existing.presetId === MINGTAN_PRESET_ID
    && existing.presetInitialization?.presetId === MINGTAN_PRESET_ID
  );
  const initialStats = options.initialStats
    ?? initialRpgStats(`${project.title}|${projectId}`);
  const initialized = buildMingtanPresetState(current, {
    ...options,
    initialStats,
  });
  if (initialized.replayed) {
    return { replayed: true as const, storyState: current, backup: null };
  }

  const backup = alreadyApplied
    ? null
    : await createProjectBackup(repository, projectId, "safety");
  const now = options.now ?? new Date().toISOString();
  const next: StoryState = {
    ...initialized.storyState,
    revision: current.revision + 1,
    parentRevision: current.revision,
    updatedAt: now,
  };
  try {
    const saved = await repository.put<StoryState>("storyStates", next, current.revision);
    return { replayed: alreadyApplied, storyState: saved, backup };
  } catch (error) {
    const latest = await repository.get<StoryState>("storyStates", current.id);
    const latestRpgState = latest ? readRpgStateV3(latest) : null;
    if (
      latest
      && latestRpgState?.presetId === MINGTAN_PRESET_ID
      && latestRpgState.presetInitialization?.presetId === MINGTAN_PRESET_ID
    ) {
      return { replayed: true as const, storyState: latest, backup };
    }
    throw error;
  }
}
