import type {
  AcceptedChoice,
  Achievement,
  Chapter,
  Character,
  DomainRecord,
  LoreEntry,
  NovelProject,
  ProjectSeed,
  StoryBible,
  StoryBranch,
  StoryState,
  TimelineEvent,
  World,
  WorldRule,
  WritingTask,
} from "../domain";
import type { ClosedAIContextItem } from "../closed-agent-os";
import { sha256Hex, stableStringify } from "../closed-ai-cache";
import type { NovelRepository, NovelStoreName } from "../repository/contracts";

export const PROJECT_CONTEXT_COMPOSER_SCHEMA_VERSION =
  "project-context-composer-v1" as const;

export type ProjectContextAudience = "actor" | "evaluator" | "author";

export type ProjectContextComposerInput = {
  repository: NovelRepository;
  taskType: string;
  projectId: string;
  storyId?: string;
  canonId?: string;
  branchId?: string;
  characterId?: string;
  revision?: string | number;
  privacyLevel: ClosedAIContextItem["privacyLevel"];
  tokenBudget?: number;
  audience?: ProjectContextAudience;
  activePreferenceProfile?: string | null;
  approvedLearningRules?: Array<{
    id: string;
    rule: string;
    revision: string | number;
  }>;
  supplementalContext?: ClosedAIContextItem[];
  semanticQuery?: string;
  semanticRanker?: ProjectContextSemanticRanker;
};

export type ProjectContextSemanticRanker = (input: {
  query: string;
  items: Array<{ id: string; text: string; priority: number }>;
}) => Promise<{
  scores: Array<{ id: string; score: number }>;
  modelId: string;
  modelDigest: string;
  cacheHit: boolean;
  dataLeftDevice: false;
}>;

export type ProjectContextSourceSummary = {
  schemaVersion: typeof PROJECT_CONTEXT_COMPOSER_SCHEMA_VERSION;
  repository: NovelRepository["kind"];
  counts: Record<string, number>;
  includedSources: string[];
  withheldAuthorOnly: number;
  estimatedTokens: number;
  tokenBudget: number;
  truncated: boolean;
  ranking: {
    mode: "priority" | "semantic";
    modelId: string | null;
    modelDigest: string | null;
    cacheHit: boolean | null;
    dataLeftDevice: false;
    fallbackReason: string | null;
  };
};

export type ProjectContextComposition = {
  context: ClosedAIContextItem[];
  contextDigest: string;
  contextSourceSummary: ProjectContextSourceSummary;
};

type PrioritizedContext = {
  priority: number;
  semanticScore?: number;
  item: ClosedAIContextItem;
};

function present(value: unknown): unknown {
  if (
    value
    && typeof value === "object"
    && "status" in value
    && "value" in value
  ) {
    return (value as { value?: unknown }).value ?? null;
  }
  return value;
}

function cleanRecord(
  record: DomainRecord,
  fields: string[],
): Record<string, unknown> {
  const source = record as unknown as Record<string, unknown>;
  return Object.fromEntries(
    fields
      .map((field) => [field, present(source[field])] as const)
      .filter(([, value]) =>
        value !== null
        && value !== undefined
        && value !== ""
        && (!Array.isArray(value) || value.length > 0)),
  );
}

function ordered<T extends DomainRecord>(records: T[]) {
  return [...records].sort((left, right) => {
    const orderLeft = Number((left as unknown as { order?: number }).order ?? 0);
    const orderRight = Number((right as unknown as { order?: number }).order ?? 0);
    return orderLeft - orderRight
      || left.updatedAt.localeCompare(right.updatedAt)
      || left.id.localeCompare(right.id);
  });
}

function addContext(
  target: PrioritizedContext[],
  input: {
    id: string;
    kind: ClosedAIContextItem["kind"];
    source: string;
    value: unknown;
    priority: number;
    privacyLevel: ClosedAIContextItem["privacyLevel"];
    visibility?: ClosedAIContextItem["visibility"];
    learningFacet?: ClosedAIContextItem["learningFacet"];
  },
) {
  const text = `[${input.source}]\n${stableStringify(input.value)}`;
  target.push({
    priority: input.priority,
    item: {
      id: input.id,
      kind: input.kind,
      learningFacet: input.learningFacet,
      text,
      visibility: input.visibility ?? "both",
      privacyLevel: input.privacyLevel,
      approved: true,
    },
  });
}

async function safeList<T extends DomainRecord>(
  repository: NovelRepository,
  store: NovelStoreName,
  projectId: string,
): Promise<T[]> {
  try {
    return await repository.list<T>(store, projectId);
  } catch {
    return [];
  }
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 2));
}

function applyBudget(
  entries: PrioritizedContext[],
  tokenBudget: number,
) {
  const effectivePriority = (entry: PrioritizedContext) => {
    if (entry.priority >= 90) {
      return entry.priority * 100 + (entry.semanticScore ?? 0);
    }
    return entry.priority + (entry.semanticScore ?? 0) * 12;
  };
  const sorted = [...entries].sort((left, right) =>
    effectivePriority(right) - effectivePriority(left)
    || right.priority - left.priority
    || left.item.id.localeCompare(right.item.id));
  const selected: ClosedAIContextItem[] = [];
  let remainingCharacters = Math.max(512, tokenBudget * 2);
  let truncated = false;
  for (const entry of sorted) {
    if (remainingCharacters <= 0) {
      truncated = true;
      continue;
    }
    if (entry.item.text.length <= remainingCharacters) {
      selected.push(entry.item);
      remainingCharacters -= entry.item.text.length;
      continue;
    }
    if (remainingCharacters >= 256) {
      selected.push({
        ...entry.item,
        text: `${entry.item.text.slice(0, remainingCharacters - 32)}\n[CONTEXT_TRUNCATED]`,
      });
    }
    remainingCharacters = 0;
    truncated = true;
  }
  return {
    context: selected,
    truncated,
    estimatedTokens: selected.reduce(
      (total, item) => total + estimateTokens(item.text),
      0,
    ),
  };
}

export async function composeProjectContext(
  input: ProjectContextComposerInput,
): Promise<ProjectContextComposition> {
  const tokenBudget = Math.max(512, Math.min(input.tokenBudget ?? 8_192, 65_536));
  const audience = input.audience ?? "actor";
  const [
    project,
    seeds,
    chapters,
    characters,
    storyBibles,
    worlds,
    worldRules,
    lore,
    timeline,
    storyStates,
    acceptedChoices,
    branches,
    tasks,
    achievements,
    characterProfiles,
    characterStates,
    characterKnowledge,
    characterBeliefs,
    characterMemories,
    characterRelationships,
    relationshipEvents,
    privateArcs,
  ] = await Promise.all([
    input.repository.get<NovelProject>("projects", input.projectId),
    safeList<ProjectSeed>(input.repository, "projectSeeds", input.projectId),
    safeList<Chapter>(input.repository, "chapters", input.projectId),
    safeList<Character>(input.repository, "characters", input.projectId),
    safeList<StoryBible>(input.repository, "storyBibles", input.projectId),
    safeList<World>(input.repository, "worlds", input.projectId),
    safeList<WorldRule>(input.repository, "worldRules", input.projectId),
    safeList<LoreEntry>(input.repository, "lore", input.projectId),
    safeList<TimelineEvent>(input.repository, "timeline", input.projectId),
    safeList<StoryState>(input.repository, "storyStates", input.projectId),
    safeList<AcceptedChoice>(input.repository, "acceptedChoices", input.projectId),
    safeList<StoryBranch>(input.repository, "storyBranches", input.projectId),
    safeList<WritingTask>(input.repository, "tasks", input.projectId),
    safeList<Achievement>(input.repository, "achievements", input.projectId),
    safeList<DomainRecord>(input.repository, "characterAgentProfiles", input.projectId),
    safeList<DomainRecord>(input.repository, "characterAgentStates", input.projectId),
    safeList<DomainRecord>(input.repository, "characterKnowledge", input.projectId),
    safeList<DomainRecord>(input.repository, "characterBeliefs", input.projectId),
    safeList<DomainRecord>(input.repository, "characterMemories", input.projectId),
    safeList<DomainRecord>(input.repository, "characterRelationships", input.projectId),
    safeList<DomainRecord>(
      input.repository,
      "characterRelationshipEvents",
      input.projectId,
    ),
    safeList<DomainRecord>(input.repository, "characterPrivateArcs", input.projectId),
  ]);
  if (!project) {
    throw Object.assign(new Error("The project does not exist in local canonical storage."), {
      code: "PROJECT_CONTEXT_PROJECT_NOT_FOUND",
      projectId: input.projectId,
    });
  }

  const entries: PrioritizedContext[] = [];
  const privacyLevel = input.privacyLevel;
  const storyBible = storyBibles.find((item) => item.id === project.storyBibleId)
    ?? ordered(storyBibles).at(-1)
    ?? null;
  const storyState = storyStates.find((item) => item.id === project.storyStateId)
    ?? ordered(storyStates).at(-1)
    ?? null;
  const activeChapter = chapters.find((item) => item.id === project.activeChapterId)
    ?? ordered(chapters).at(-1)
    ?? null;
  const activeBranch = branches.find((item) => item.branchId === input.branchId)
    ?? branches.find((item) => item.status === "active")
    ?? null;
  const selectedCharacters = input.characterId
    ? characters.filter((item) => item.id === input.characterId)
    : characters;

  addContext(entries, {
    id: `project:${project.id}`,
    kind: "canon",
    source: "PROJECT_METADATA",
    value: {
      taskType: input.taskType,
      storyId: input.storyId ?? input.projectId,
      canonId: input.canonId ?? `canon:${input.projectId}`,
      branchId: activeBranch?.branchId ?? input.branchId ?? "main",
      requestedRevision: input.revision ?? "current",
      project: cleanRecord(project, [
        "title",
        "creationMode",
        "genrePackId",
        "genreId",
        "subgenreId",
        "coreIdea",
        "narrativeStyle",
        "adultMode",
        "revision",
      ]),
    },
    priority: 100,
    privacyLevel,
  });

  const seed = ordered(seeds).at(-1);
  if (seed) {
    addContext(entries, {
      id: `seed:${seed.id}`,
      kind: "canon",
      source: "PROJECT_SEED",
      value: cleanRecord(seed, [
        "titleCandidates",
        "logline",
        "protagonist",
        "goal",
        "weakness",
        "world",
        "worldRule",
        "conflict",
        "opposition",
        "opening",
        "directions",
        "revision",
      ]),
      priority: 94,
      privacyLevel,
    });
  }
  if (storyBible) {
    addContext(entries, {
      id: `story-bible:${storyBible.id}`,
      kind: "story-bible",
      source: "APPROVED_STORY_BIBLE",
      value: cleanRecord(storyBible, [
        "theme",
        "style",
        "protagonistIds",
        "characterIds",
        "relationshipIds",
        "worldId",
        "worldRuleIds",
        "loreIds",
        "timelineEventIds",
        "foreshadowing",
        "unresolvedThreads",
        "forbiddenContradictions",
        "authorPreferences",
        "revision",
      ]),
      priority: 98,
      privacyLevel,
      learningFacet: "story-bible",
    });
  }
  if (activeChapter) {
    addContext(entries, {
      id: `chapter-active:${activeChapter.id}`,
      kind: "canon",
      source: "ACTIVE_CHAPTER",
      value: cleanRecord(activeChapter, [
        "title",
        "order",
        "content",
        "summary",
        "status",
        "revision",
      ]),
      priority: 97,
      privacyLevel,
    });
  }
  const recentChapters = ordered(chapters)
    .filter((item) => item.id !== activeChapter?.id)
    .slice(-3);
  if (recentChapters.length) {
    addContext(entries, {
      id: `chapters:recent:${input.projectId}`,
      kind: "canon",
      source: "RECENT_CHAPTERS",
      value: recentChapters.map((item) => cleanRecord(item, [
        "id",
        "title",
        "order",
        "content",
        "summary",
        "revision",
      ])),
      priority: 88,
      privacyLevel,
    });
  }
  if (selectedCharacters.length) {
    addContext(entries, {
      id: `characters:${input.characterId ?? "all"}`,
      kind: "canon",
      source: "CHARACTERS",
      value: ordered(selectedCharacters).map((item) => cleanRecord(item, [
        "id",
        "name",
        "aliases",
        "identity",
        "personality",
        "goal",
        "lifeStatus",
        "locationId",
        "age",
        "ageVerified",
        "fears",
        "factionIds",
        "values",
        "capabilities",
        "limitations",
        "voiceStyle",
        "revision",
      ])),
      priority: 92,
      privacyLevel,
      learningFacet: "character-knowledge",
    });
  }
  const authorSecrets = selectedCharacters.flatMap((character) =>
    (character.privateSecrets ?? []).map((secret) => ({
      characterId: character.id,
      secret,
    })));
  if (audience === "author" && authorSecrets.length) {
    addContext(entries, {
      id: `author-only:character-secrets:${input.characterId ?? "all"}`,
      kind: "author-note",
      source: "AUTHOR_ONLY_CHARACTER_SECRETS",
      value: authorSecrets,
      priority: 96,
      privacyLevel,
      visibility: "author-only",
    });
  }
  if (worlds.length) {
    addContext(entries, {
      id: `world:${worlds[0].id}`,
      kind: "canon",
      source: "WORLD",
      value: ordered(worlds).map((item) =>
        cleanRecord(item, ["id", "name", "era", "summary", "revision"])),
      priority: 86,
      privacyLevel,
    });
  }
  if (worldRules.length) {
    addContext(entries, {
      id: `world-rules:${input.projectId}`,
      kind: "story-bible",
      source: "WORLD_RULES",
      value: ordered(worldRules).map((item) =>
        cleanRecord(item, ["id", "title", "description", "immutable", "revision"])),
      priority: 91,
      privacyLevel,
    });
  }
  if (lore.length) {
    addContext(entries, {
      id: `lore:${input.projectId}`,
      kind: "story-bible",
      source: "LORE",
      value: ordered(lore).map((item) =>
        cleanRecord(item, ["id", "kind", "title", "content", "revision"])),
      priority: 80,
      privacyLevel,
    });
  }
  if (timeline.length) {
    addContext(entries, {
      id: `timeline:${input.projectId}`,
      kind: "canon",
      source: "TIMELINE",
      value: ordered(timeline).map((item) =>
        cleanRecord(item, [
          "id",
          "chapterId",
          "storyTime",
          "title",
          "summary",
          "revision",
        ])),
      priority: 84,
      privacyLevel,
    });
  }
  if (storyState) {
    addContext(entries, {
      id: `story-state:${storyState.id}`,
      kind: "canon",
      source: "RPG_STORY_STATE",
      value: cleanRecord(storyState, [
        "protagonistStats",
        "resources",
        "money",
        "inventory",
        "relationships",
        "reputation",
        "factionStanding",
        "worldFlags",
        "questStates",
        "achievementStates",
        "timeState",
        "locationState",
        "riskState",
        "revision",
      ]),
      priority: 93,
      privacyLevel,
    });
  }
  if (acceptedChoices.length) {
    addContext(entries, {
      id: `accepted-choices:${input.projectId}`,
      kind: "canon",
      source: "ACCEPTED_CHOICES",
      value: ordered(acceptedChoices).slice(-12).map((item) =>
        cleanRecord(item, [
          "acceptedChoiceId",
          "chapterId",
          "branchId",
          "choiceKey",
          "choiceLabel",
          "acceptedText",
          "appliedEffect",
          "resultingRevision",
          "acceptedAt",
        ])),
      priority: 89,
      privacyLevel,
    });
  }
  if (activeBranch) {
    addContext(entries, {
      id: `branch:${activeBranch.id}`,
      kind: "canon",
      source: "ACTIVE_BRANCH",
      value: cleanRecord(activeBranch, [
        "branchId",
        "parentBranchId",
        "chapterId",
        "status",
        "name",
        "headRevision",
        "revision",
      ]),
      priority: 90,
      privacyLevel,
    });
  }
  if (tasks.length || achievements.length) {
    addContext(entries, {
      id: `progress:${input.projectId}`,
      kind: "memory",
      source: "TASKS_AND_ACHIEVEMENTS",
      value: {
        tasks: ordered(tasks).map((item) =>
          cleanRecord(item, ["title", "kind", "status", "progress", "target"])),
        achievements: ordered(achievements).map((item) =>
          cleanRecord(item, ["title", "progress", "target", "unlockedAt"])),
      },
      priority: 65,
      privacyLevel,
    });
  }

  const approvedKnowledge = characterKnowledge.filter((record) => {
    const value = record as unknown as {
      status?: string;
      scope?: string;
      authorizedCharacterIds?: string[];
    };
    if (value.status && value.status !== "CURRENT") return false;
    if (value.scope === "AUTHOR_ONLY") return audience === "author";
    if (
      input.characterId
      && value.authorizedCharacterIds?.length
      && !value.authorizedCharacterIds.includes(input.characterId)
    ) {
      return false;
    }
    return true;
  });
  if (approvedKnowledge.length) {
    addContext(entries, {
      id: `character-knowledge:${input.characterId ?? "shared"}`,
      kind: "memory",
      source: "APPROVED_CHARACTER_KNOWLEDGE",
      value: ordered(approvedKnowledge).map((item) => cleanRecord(item, [
        "knowledgeId",
        "subjectEntityIds",
        "claim",
        "canonicalTruthStatus",
        "scope",
        "authorizedCharacterIds",
        "confidence",
        "acquiredAt",
        "usableAfterTimelinePosition",
        "revision",
      ])),
      priority: 87,
      privacyLevel,
      visibility: audience === "author" ? "author-only" : "actor",
      learningFacet: "character-knowledge",
    });
  }
  const selectedAgentRecords = [
    ...characterProfiles,
    ...characterStates.filter((record) =>
      !input.characterId
      || (record as unknown as { characterId?: string }).characterId ===
        input.characterId),
    ...characterBeliefs.filter((record) =>
      !input.characterId
      || (record as unknown as { characterId?: string }).characterId ===
        input.characterId),
    ...characterMemories.filter((record) => {
      const memory = record as unknown as {
        characterId?: string;
        approvalStatus?: string;
        visibility?: string;
      };
      return (!input.characterId || memory.characterId === input.characterId)
        && memory.approvalStatus === "APPROVED"
        && (memory.visibility !== "AUTHOR_ONLY" || audience === "author");
    }),
  ];
  if (selectedAgentRecords.length) {
    addContext(entries, {
      id: `character-agent:${input.characterId ?? "shared"}`,
      kind: "memory",
      source: "CHARACTER_AGENT_APPROVED_STATE",
      value: ordered(selectedAgentRecords).map((item) => cleanRecord(item, [
        "characterId",
        "name",
        "identity",
        "personalityTraits",
        "values",
        "goals",
        "fears",
        "motives",
        "capabilities",
        "limitations",
        "voiceProfile",
        "timelinePosition",
        "locationId",
        "lifeStatus",
        "physicalCondition",
        "emotionalState",
        "activeGoals",
        "commitments",
        "currentConflicts",
        "proposition",
        "beliefStrength",
        "beliefStatus",
        "summary",
        "perspective",
        "truthStatus",
        "revision",
      ])),
      priority: 82,
      privacyLevel,
      learningFacet: "character-knowledge",
    });
  }
  const approvedRelationshipEvents = relationshipEvents.filter((record) =>
    (record as unknown as { status?: string }).status === "APPROVED");
  if (characterRelationships.length || approvedRelationshipEvents.length) {
    addContext(entries, {
      id: `character-relationships:${input.projectId}`,
      kind: "memory",
      source: "APPROVED_CHARACTER_RELATIONSHIPS",
      value: {
        edges: ordered(characterRelationships).map((item) => cleanRecord(item, [
          "relationshipId",
          "fromCharacterId",
          "toCharacterId",
          "relationshipTypes",
          "publicStatus",
          "knownByCharacterIds",
          "trust",
          "affection",
          "fear",
          "resentment",
          "loyalty",
          "conflict",
          "powerBalance",
          "revision",
        ])),
        events: ordered(approvedRelationshipEvents).slice(-16).map((item) =>
          cleanRecord(item, [
            "eventId",
            "relationshipId",
            "timelinePosition",
            "eventType",
            "delta",
            "cause",
            "status",
            "revision",
          ])),
      },
      priority: 83,
      privacyLevel,
      learningFacet: "relationship-event",
    });
  }
  if (audience === "author" && privateArcs.length) {
    addContext(entries, {
      id: `author-only:private-arcs:${input.characterId ?? "all"}`,
      kind: "author-note",
      source: "AUTHOR_ONLY_PRIVATE_ARCS",
      value: ordered(privateArcs).map((item) => cleanRecord(item, [
        "characterId",
        "title",
        "privateGoal",
        "hiddenMotivation",
        "secret",
        "plan",
        "milestones",
        "risk",
        "status",
        "revision",
      ])),
      priority: 95,
      privacyLevel,
      visibility: "author-only",
    });
  }
  if (input.activePreferenceProfile) {
    addContext(entries, {
      id: `preference-profile:${input.projectId}`,
      kind: "memory",
      source: "ACTIVE_PREFERENCE_PROFILE",
      value: { profileId: input.activePreferenceProfile },
      priority: 70,
      privacyLevel,
    });
  }
  if (input.approvedLearningRules?.length) {
    addContext(entries, {
      id: `approved-learning:${input.projectId}`,
      kind: "memory",
      source: "APPROVED_L0_L1_LEARNING_RULES",
      value: input.approvedLearningRules,
      priority: 72,
      privacyLevel,
    });
  }
  for (const item of input.supplementalContext ?? []) {
    if (!item.approved) continue;
    if (item.visibility === "author-only" && audience !== "author") continue;
    entries.push({ priority: 99, item: structuredClone(item) });
  }

  let ranking: ProjectContextSourceSummary["ranking"] = {
    mode: "priority",
    modelId: null,
    modelDigest: null,
    cacheHit: null,
    dataLeftDevice: false,
    fallbackReason: input.semanticRanker ? "semantic_ranker_not_run" : "semantic_model_not_configured",
  };
  const semanticQuery = input.semanticQuery?.trim();
  if (input.semanticRanker && semanticQuery && entries.length) {
    try {
      const result = await input.semanticRanker({
        query: semanticQuery,
        items: entries.map((entry) => ({
          id: entry.item.id,
          text: entry.item.text,
          priority: entry.priority,
        })),
      });
      const scores = new Map(result.scores.map((score) => [score.id, score.score]));
      for (const entry of entries) {
        const score = scores.get(entry.item.id);
        if (typeof score === "number" && Number.isFinite(score)) {
          entry.semanticScore = Math.max(-1, Math.min(1, score));
        }
      }
      ranking = {
        mode: "semantic",
        modelId: result.modelId,
        modelDigest: result.modelDigest,
        cacheHit: result.cacheHit,
        dataLeftDevice: result.dataLeftDevice,
        fallbackReason: null,
      };
    } catch (error) {
      ranking = {
        ...ranking,
        fallbackReason: typeof error === "object" && error && "code" in error
          ? String((error as { code?: unknown }).code ?? "semantic_ranker_failed")
          : "semantic_ranker_failed",
      };
    }
  } else if (input.semanticRanker && !semanticQuery) {
    ranking.fallbackReason = "semantic_query_empty";
  }

  const budgeted = applyBudget(entries, tokenBudget);
  const counts: Record<string, number> = {
    project: 1,
    seeds: seeds.length,
    chapters: chapters.length,
    characters: characters.length,
    storyBibles: storyBibles.length,
    worlds: worlds.length,
    worldRules: worldRules.length,
    lore: lore.length,
    timeline: timeline.length,
    storyStates: storyStates.length,
    acceptedChoices: acceptedChoices.length,
    branches: branches.length,
    tasks: tasks.length,
    achievements: achievements.length,
    characterAgentProfiles: characterProfiles.length,
    characterAgentStates: characterStates.length,
    characterKnowledge: approvedKnowledge.length,
    characterBeliefs: characterBeliefs.length,
    characterMemories: characterMemories.length,
    characterRelationships: characterRelationships.length,
    characterRelationshipEvents: approvedRelationshipEvents.length,
    privateArcs: audience === "author" ? privateArcs.length : 0,
  };
  const contextSourceSummary: ProjectContextSourceSummary = {
    schemaVersion: PROJECT_CONTEXT_COMPOSER_SCHEMA_VERSION,
    repository: input.repository.kind,
    counts,
    includedSources: budgeted.context.map((item) =>
      item.text.match(/^\[([^\]]+)\]/)?.[1] ?? item.kind),
    withheldAuthorOnly: audience === "author"
      ? 0
      : authorSecrets.length
        + privateArcs.length
        + characterKnowledge.filter((record) =>
          (record as unknown as { scope?: string }).scope === "AUTHOR_ONLY").length,
    estimatedTokens: budgeted.estimatedTokens,
    tokenBudget,
    truncated: budgeted.truncated,
    ranking,
  };
  const contextDigest = await sha256Hex(stableStringify({
    schemaVersion: PROJECT_CONTEXT_COMPOSER_SCHEMA_VERSION,
    taskType: input.taskType,
    projectId: input.projectId,
    storyId: input.storyId ?? input.projectId,
    canonId: input.canonId ?? `canon:${input.projectId}`,
    branchId: activeBranch?.branchId ?? input.branchId ?? "main",
    characterId: input.characterId ?? "shared",
    revision: input.revision ?? "current",
    privacyLevel,
    context: budgeted.context,
  }));
  return {
    context: budgeted.context,
    contextDigest,
    contextSourceSummary,
  };
}
