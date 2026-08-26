import type {
  NovelProject,
  StoryBible,
  World,
  WorldRule,
} from "./index";

export type StoryStartedCanonMutation =
  | "create-world"
  | "update-world"
  | "approve-world"
  | "approve-social-character";

export function assertStoryStartedCanonMutationAllowed(input: {
  storyStarted: boolean;
  mutation: StoryStartedCanonMutation;
  existingRecord?: boolean;
  existingWorldEra?: string | null;
  requestedWorldEra?: string | null;
}) {
  if (!input.storyStarted) return;
  if (input.mutation === "update-world" && input.existingRecord) {
    const existingEra = input.existingWorldEra?.trim() ?? "";
    const requestedEra = input.requestedWorldEra?.trim() ?? "";
    if (existingEra === requestedEra) return;
    throw new Error("STORY_STARTED_WORLD_ERA_LOCKED");
  }
  if (input.mutation === "approve-social-character") {
    throw new Error("STORY_STARTED_SOCIAL_CHARACTER_APPROVAL_LOCKED");
  }
  throw new Error("STORY_STARTED_NEW_WORLD_LOCKED");
}

const EXPLICIT_CROSS_ERA_CANON = /(?:穿越(?:時空|時代|古今|異世)?|跨(?:越)?時代|時間旅行|時空(?:穿梭|裂縫|轉移|跳躍)|古今交錯|time[\s-]*travel|cross[\s-]*era)/iu;
const NEGATED_CROSS_ERA_CANON = /(?:(?:禁止|不得|不可|不允許|不會|沒有|不存在|拒絕|排除|不要).{0,12}(?:穿越|跨(?:越)?時代|時間旅行|時空(?:穿梭|裂縫|轉移|跳躍))|(?:穿越|跨(?:越)?時代|時間旅行).{0,8}(?:被禁止|不存在|不允許))/iu;

function containsExplicitCrossEraCanon(values: readonly (string | null | undefined)[]) {
  return values.some((value) => {
    const signal = value?.trim() ?? "";
    return EXPLICIT_CROSS_ERA_CANON.test(signal) && !NEGATED_CROSS_ERA_CANON.test(signal);
  });
}

export type CrossEraCanonAuthorization = {
  authorized: boolean;
  sources: Array<"project" | "story-bible" | "world-rule" | "baseline-world">;
};

export function explicitCrossEraCanonAuthorization(input: {
  project: NovelProject;
  storyBible: StoryBible | null | undefined;
  worldRules: readonly WorldRule[];
  baselineWorld: World | null | undefined;
}): CrossEraCanonAuthorization {
  const sources: CrossEraCanonAuthorization["sources"] = [];
  if (containsExplicitCrossEraCanon([
    input.project.title,
    input.project.genrePackId,
    input.project.genreId,
    input.project.subgenreId,
    input.project.coreIdea.value,
    input.project.narrativeStyle.value,
  ])) {
    sources.push("project");
  }
  if (input.storyBible && containsExplicitCrossEraCanon([
    input.storyBible.theme.value,
    input.storyBible.style.value,
    ...input.storyBible.foreshadowing,
    ...input.storyBible.unresolvedThreads,
    ...(input.storyBible.resolvedThreads ?? []),
    ...input.storyBible.authorPreferences,
  ])) {
    sources.push("story-bible");
  }
  const formalRuleIds = new Set(input.storyBible?.worldRuleIds ?? []);
  const formalRules = formalRuleIds.size
    ? input.worldRules.filter((rule) => formalRuleIds.has(rule.id))
    : input.worldRules;
  if (formalRules.some((rule) => containsExplicitCrossEraCanon([rule.title, rule.description]))) {
    sources.push("world-rule");
  }
  if (
    input.baselineWorld
    && input.storyBible?.worldId === input.baselineWorld.id
    && containsExplicitCrossEraCanon([
      input.baselineWorld.name.value,
      input.baselineWorld.era.value,
      input.baselineWorld.summary.value,
    ])
  ) {
    sources.push("baseline-world");
  }
  return { authorized: sources.length > 0, sources };
}
