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

const EXPLICIT_CROSS_ERA_CANON_SOURCE = String.raw`(?:穿越(?:時空|時代|古今|異世|者|題材|故事|古代|現代|现代|未來|未来|過去|过去|異世界|异世界)|穿越(?:到|至|回|前往).{0,8}(?:古代|未來|未来|過去|过去|另一個時代|另一个时代|異世界|异世界)|跨(?:越)?時代|時間旅行|时间旅行|時空(?:穿梭|裂縫|裂缝|轉移|转移|跳躍|跳跃)|古今(?:穿越|交錯|交错)|異世界往返|异世界往返|time[\s-]*travel|cross[\s-]*era)`;
const EXPLICIT_CROSS_ERA_CANON = new RegExp(EXPLICIT_CROSS_ERA_CANON_SOURCE, "iu");
const NEGATED_CROSS_ERA_CANON = new RegExp(
  String.raw`(?:(?:不是|並非|并非|禁止|不得|不可|不允許|不允许|不會|不会|沒有|没有|不存在|拒絕|拒绝|排除|不要).{0,12}${EXPLICIT_CROSS_ERA_CANON_SOURCE}|(?:^|[，、；;\s])非.{0,4}${EXPLICIT_CROSS_ERA_CANON_SOURCE}|${EXPLICIT_CROSS_ERA_CANON_SOURCE}.{0,8}(?:被禁止|不存在|不允許|不允许|不是|並非|并非))`,
  "iu",
);

/**
 * Requires an explicit time/era-travel meaning.  A bare verb such as
 * 「穿越森林」and a negated phrase such as「不是穿越故事」are not Canon
 * authorization to mix otherwise incompatible eras.
 */
export function hasExplicitCrossEraSemanticSignal(value: string | null | undefined) {
  return (value?.trim() ?? "")
    .split(/[。！？!?\n]/u)
    .some((sentence) => (
      EXPLICIT_CROSS_ERA_CANON.test(sentence)
      && !NEGATED_CROSS_ERA_CANON.test(sentence)
    ));
}

function containsExplicitCrossEraCanon(values: readonly (string | null | undefined)[]) {
  return values.some(hasExplicitCrossEraSemanticSignal);
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
    ...(input.storyBible.foreshadowing ?? []),
    ...(input.storyBible.unresolvedThreads ?? []),
    ...(input.storyBible.resolvedThreads ?? []),
    ...(input.storyBible.authorPreferences ?? []),
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
