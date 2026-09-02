import type {
  AcceptedChoice,
  Achievement,
  Chapter,
  Character,
  CharacterRelationship,
  ConversationAttachment,
  ConversationArtifact,
  ConversationMessage,
  ConversationSummary,
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
import { NOVEL_DOMAIN_VERSION } from "../domain";
import { resolveProjectStoryBible } from "../domain/story-bible-selection";
import {
  activeStoryCast,
  activeStoryLore,
  activeStoryRelationships,
  activeStoryTimeline,
  activeStoryWorldRules,
} from "../domain/active-story-context";
import type { ClosedAIContextItem } from "../closed-agent-os";
import { sha256Hex, stableStringify } from "../closed-ai-cache";
import type { NovelRepository, NovelStoreName } from "../repository/contracts";
import { sanitizeRetrievedKnowledge } from "../security/retrieval-content-sanitizer";

export const PROJECT_CONTEXT_COMPOSER_SCHEMA_VERSION =
  "project-context-composer-v2" as const;

export const PROJECT_CONTEXT_SEMANTIC_RANKING_DEADLINE_MS = 3_000;

const PROJECT_CONVERSATION_SUMMARY_LIMIT = 4;
const CONVERSATION_SUMMARY_CHARACTER_LIMIT = 6_000;
const CONVERSATION_SUMMARY_SOURCE_ID_LIMIT = 64;
const SELECTED_ATTACHMENT_SUMMARY_CHARACTER_LIMIT = 24_000;
const SELECTED_ATTACHMENT_LIMIT = 12;
const SHA256_DIGEST = /^[a-f0-9]{64}$/u;
const SELECTED_ATTACHMENT_RIGHTS_BASES = new Set([
  "user_supplied_local_analysis",
  "owned_by_user",
  "public_domain",
  "licensed_for_analysis",
  "lawful_private_reference",
  "ai_output_authorized",
]);
const STORY_BIBLE_CONTEXT_FIELDS = [
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
];

type ModelContextSource = NonNullable<ClosedAIContextItem["modelContextSource"]>;

export type RepositoryVerifiedSelectedAttachmentSummary = {
  attachmentId: string;
  recordRevision: number;
  summary: string;
  contentDigest: string;
  modelContextSource: ModelContextSource & {
    authority: "user-selected-sanitized-untrusted-reference";
  };
};

export async function conversationCanonRevisionDigest(input: {
  project: Pick<NovelProject, "id" | "revision">;
  activeChapter: Pick<Chapter, "id" | "revision"> | null;
  storyBible: Pick<StoryBible, "id" | "revision"> | null;
  storyState: Pick<StoryState, "id" | "revision"> | null;
}) {
  return sha256Hex(stableStringify({
    project: { id: input.project.id, revision: input.project.revision },
    chapter: input.activeChapter
      ? { id: input.activeChapter.id, revision: input.activeChapter.revision }
      : null,
    storyBible: input.storyBible
      ? { id: input.storyBible.id, revision: input.storyBible.revision }
      : null,
    storyState: input.storyState
      ? { id: input.storyState.id, revision: input.storyState.revision }
      : null,
  }));
}

export type ProjectContextAudience = "actor" | "evaluator" | "author";

export type ProjectContextComposerInput = {
  repository: NovelRepository;
  taskType: string;
  projectId: string;
  storyId?: string;
  canonId?: string;
  branchId?: string;
  characterId?: string;
  characterIds?: string[];
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
  conversationSessionId?: string;
  conversationRecentMessageLimit?: number;
  selectedAttachmentSummaries?: RepositoryVerifiedSelectedAttachmentSummary[];
  supplementalContext?: ClosedAIContextItem[];
  semanticQuery?: string;
  semanticRanker?: ProjectContextSemanticRanker;
  semanticRankingDisabledReason?: string;
  semanticRankingDeadlineMs?: number;
  signal?: AbortSignal;
};

export type ProjectContextSemanticRanker = (input: {
  query: string;
  items: Array<{ id: string; text: string; priority: number }>;
  signal?: AbortSignal;
}) => Promise<{
  scores: Array<{ id: string; score: number }>;
  modelId: string;
  modelDigest: string;
  cacheHit: boolean;
  dataLeftDevice: false;
}>;

function semanticRankingWithinDeadline<T>(input: {
  deadlineMs: number;
  signal?: AbortSignal;
  execute: (signal: AbortSignal) => Promise<T>;
}) {
  if (input.signal?.aborted) {
    return Promise.reject(
      input.signal.reason ?? new DOMException("操作已取消。", "AbortError"),
    );
  }
  const controller = new AbortController();
  const deadlineError = Object.assign(
    new Error("Project context semantic ranking exceeded its optional deadline."),
    { code: "PROJECT_CONTEXT_SEMANTIC_RANKING_TIMEOUT" },
  );
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abortFromCaller = () => abort(
      input.signal?.reason ?? new DOMException("操作已取消。", "AbortError"),
    );
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      input.signal?.removeEventListener("abort", abortFromCaller);
      callback();
    };
    const abort = (reason: unknown) => {
      if (!controller.signal.aborted) controller.abort(reason);
      finish(() => reject(reason));
    };
    const timeoutId = globalThis.setTimeout(
      () => abort(deadlineError),
      Math.max(1, input.deadlineMs),
    );
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    Promise.resolve()
      .then(() => input.execute(controller.signal))
      .then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
  });
}

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

function latestByStableKey<T extends DomainRecord>(
  records: T[],
  keyFor: (record: T) => string,
) {
  const latest = new Map<string, T>();
  for (const record of ordered(records)) latest.set(keyFor(record), record);
  return ordered([...latest.values()]);
}

function relationshipPairKey(fromCharacterId: string, toCharacterId: string) {
  return [fromCharacterId, toCharacterId].sort().join("::");
}

function contextSourceError(code: string) {
  return Object.assign(new Error("Required model context source could not be verified."), {
    code,
  });
}

export async function selectedAttachmentModelContextSource(
  attachment: Pick<
    ConversationAttachment,
    | "schemaVersion"
    | "conversationSchemaVersion"
    | "id"
    | "projectId"
    | "sessionId"
    | "revision"
    | "contentHash"
    | "rightsBasis"
    | "rightsEvidenceHash"
    | "userConfirmedRights"
    | "rightsConfirmationSchemaVersion"
    | "parsingStatus"
    | "localAnalysisOnly"
    | "rawContentRetained"
  >,
): Promise<RepositoryVerifiedSelectedAttachmentSummary["modelContextSource"]> {
  return {
    authority: "user-selected-sanitized-untrusted-reference",
    sourceArtifactDigest: attachment.contentHash,
    sourceRevisionDigest: await sha256Hex(stableStringify({
      domain: "selected-local-attachment-source-revision-v1",
      store: "conversationAttachments",
      schemaVersion: attachment.schemaVersion,
      conversationSchemaVersion: attachment.conversationSchemaVersion,
      id: attachment.id,
      projectId: attachment.projectId,
      sessionId: attachment.sessionId,
      revision: attachment.revision,
      contentHash: attachment.contentHash,
      rightsBasis: attachment.rightsBasis,
      rightsEvidenceHash: attachment.rightsEvidenceHash,
      userConfirmedRights: attachment.userConfirmedRights,
      rightsConfirmationSchemaVersion:
        attachment.rightsConfirmationSchemaVersion,
      parsingStatus: attachment.parsingStatus,
      localAnalysisOnly: attachment.localAnalysisOnly,
      rawContentRetained: attachment.rawContentRetained,
    })),
    receiptRequired: true,
  };
}

function validSelectedAttachmentRecord(
  attachment: ConversationAttachment | null,
  selected: RepositoryVerifiedSelectedAttachmentSummary,
  projectId: string,
  sessionId: string,
): attachment is ConversationAttachment {
  return Boolean(
    attachment
    && attachment.schemaVersion === NOVEL_DOMAIN_VERSION
    && attachment.conversationSchemaVersion === "conversation-attachment-v1"
    && attachment.id === selected.attachmentId
    && attachment.projectId === projectId
    && attachment.sessionId === sessionId
    && (attachment.deletedAt === null || attachment.deletedAt === undefined)
    && Number.isSafeInteger(attachment.revision)
    && attachment.revision >= 1
    && attachment.revision === selected.recordRevision
    && attachment.parsingStatus === "completed"
    && attachment.contentHash === selected.contentDigest
    && SHA256_DIGEST.test(attachment.contentHash)
    && SELECTED_ATTACHMENT_RIGHTS_BASES.has(attachment.rightsBasis)
    && SHA256_DIGEST.test(attachment.rightsEvidenceHash)
    && attachment.userConfirmedRights === true
    && attachment.rightsConfirmationSchemaVersion
      === "conversation-attachment-rights-confirmation-v1"
    && attachment.localAnalysisOnly === true
    && attachment.rawContentRetained === false
  );
}

async function reverifySelectedAttachmentSummaries(
  input: ProjectContextComposerInput,
) {
  const selected = input.selectedAttachmentSummaries ?? [];
  if (!selected.length) return selected;
  if (
    !input.conversationSessionId?.trim()
    || selected.length > SELECTED_ATTACHMENT_LIMIT
    || new Set(selected.map((item) => item.attachmentId)).size !== selected.length
  ) throw contextSourceError("CLOSED_AI_ATTACHMENT_SOURCE_INVALID");
  await Promise.all(selected.map(async (item) => {
    if (
      !item.attachmentId.trim()
      || !Number.isSafeInteger(item.recordRevision)
      || item.recordRevision < 1
      || typeof item.summary !== "string"
      || !item.summary.trim()
      || item.summary.length > SELECTED_ATTACHMENT_SUMMARY_CHARACTER_LIMIT
      || !SHA256_DIGEST.test(item.contentDigest)
    ) throw contextSourceError("CLOSED_AI_ATTACHMENT_SOURCE_INVALID");
    let attachment: ConversationAttachment | null;
    try {
      attachment = await input.repository.get<ConversationAttachment>(
        "conversationAttachments",
        item.attachmentId,
      );
    } catch {
      throw contextSourceError("CLOSED_AI_ATTACHMENT_SOURCE_INVALID");
    }
    if (!validSelectedAttachmentRecord(
      attachment,
      item,
      input.projectId,
      input.conversationSessionId!,
    )) throw contextSourceError("CLOSED_AI_ATTACHMENT_SOURCE_INVALID");
    const expectedSource = await selectedAttachmentModelContextSource(attachment);
    if (stableStringify(item.modelContextSource) !== stableStringify(expectedSource)) {
      throw contextSourceError("CLOSED_AI_ATTACHMENT_SOURCE_INVALID");
    }
  }));
  return selected;
}

function canonicalCharacterIdentities(records: Character[]) {
  const output = new Map<Character, { name?: string; aliases?: string[] }>();
  const seen = new Set<string>();
  let termCount = 0;
  let termCharacters = 0;
  const take = (value: unknown) => {
    if (
      typeof value !== "string"
      || !/^[\p{Script=Han}·]{2,12}$/u.test(value)
      || seen.has(value)
      || termCount >= 64
      || termCharacters + value.length > 512
    ) return null;
    seen.add(value);
    termCount += 1;
    termCharacters += value.length;
    return value;
  };
  const canonicalRecords = ordered(records);
  for (const record of canonicalRecords) {
    if (termCount >= 64 || termCharacters >= 512) break;
    const identity = cleanRecord(record, ["name", "aliases"]);
    const name = take(identity.name);
    if (name) output.set(record, { name });
  }
  for (const record of canonicalRecords) {
    if (termCount >= 64 || termCharacters >= 512) break;
    const identity = cleanRecord(record, ["name", "aliases"]);
    const aliases = (Array.isArray(identity.aliases) ? identity.aliases : [])
      .map(take)
      .filter((alias): alias is string => Boolean(alias));
    if (aliases.length) {
      output.set(record, { ...output.get(record), aliases });
    }
  }
  const bounded = canonicalRecords.flatMap((record) => {
    const identity = output.get(record);
    return identity ? [identity] : [];
  });
  const serializedLength = () => (
    `[CANONICAL_CHARACTER_IDENTITIES]\n${stableStringify(bounded)}`.length
  );
  while (bounded.length && serializedLength() > 896) {
    const lastWithAliases = bounded.findLast((identity) => identity.aliases?.length);
    if (lastWithAliases?.aliases?.length) {
      lastWithAliases.aliases.pop();
      if (!lastWithAliases.aliases.length) delete lastWithAliases.aliases;
      continue;
    }
    bounded.pop();
  }
  return bounded;
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
    modelContextSource?: ModelContextSource;
  },
) {
  const text = `[${input.source}]\n${stableStringify(input.value)}`;
  const canonicalIdentitySource = {
    CANONICAL_CHARACTER_IDENTITIES: "characters",
    CHARACTERS: "characters",
    PROJECT_SEED: "project-seed",
    ACTIVE_CHAPTER: "active-chapter",
  }[input.source] as ClosedAIContextItem["canonicalIdentitySource"];
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
      composerAuthority: "project-context-composer-v1",
      ...(input.modelContextSource
        ? { modelContextSource: structuredClone(input.modelContextSource) }
        : {}),
      ...(canonicalIdentitySource ? { canonicalIdentitySource } : {}),
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
  const required = entries.filter((entry) => (
    entry.item.modelContextSource?.receiptRequired === true
  ));
  const ordinary = entries.filter((entry) => (
    entry.item.modelContextSource?.receiptRequired !== true
  ));
  if (
    new Set(required.map((entry) => entry.item.id)).size !== required.length
  ) {
    throw Object.assign(new Error("BROWSER_FINAL_CONTEXT_BINDING_MISMATCH"), {
      code: "BROWSER_FINAL_CONTEXT_BINDING_MISMATCH",
    });
  }
  const sorted = ordinary.sort((left, right) =>
    effectivePriority(right) - effectivePriority(left)
    || right.priority - left.priority
    || left.item.id.localeCompare(right.item.id));
  const selected: ClosedAIContextItem[] = [];
  let remainingCharacters = Math.max(512, tokenBudget * 2);
  let truncated = false;
  for (const [index, entry] of required.entries()) {
    const sourcesLeft = required.length - index;
    if (remainingCharacters < sourcesLeft) {
      throw Object.assign(new Error("BROWSER_FINAL_CONTEXT_SOURCE_OMITTED"), {
        code: "BROWSER_FINAL_CONTEXT_SOURCE_OMITTED",
      });
    }
    const allocation = Math.max(
      1,
      Math.floor(remainingCharacters / Math.max(sourcesLeft, 1)),
    );
    const included = Math.min(entry.item.text.length, allocation);
    if (included < 1) {
      throw Object.assign(new Error("BROWSER_FINAL_CONTEXT_SOURCE_OMITTED"), {
        code: "BROWSER_FINAL_CONTEXT_SOURCE_OMITTED",
      });
    }
    const text = included === entry.item.text.length
      ? entry.item.text
      : included > 32
        ? `${entry.item.text.slice(0, included - 32)}\n[CONTEXT_TRUNCATED]`
        : entry.item.text.slice(0, included);
    selected.push({ ...entry.item, text });
    remainingCharacters -= text.length;
    truncated = truncated || text.length !== entry.item.text.length;
  }
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
  const selectedRequired = selected.filter((item) => (
    item.modelContextSource?.receiptRequired === true
  ));
  if (
    selectedRequired.length !== required.length
    || selectedRequired.some((item, index) => (
      item.id !== required[index].item.id
      || stableStringify(item.modelContextSource)
        !== stableStringify(required[index].item.modelContextSource)
    ))
  ) {
    throw Object.assign(new Error("BROWSER_FINAL_CONTEXT_SOURCE_OMITTED"), {
      code: "BROWSER_FINAL_CONTEXT_SOURCE_OMITTED",
    });
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
    formalRelationships,
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
    conversationMessages,
    conversationArtifacts,
    conversationSummaries,
  ] = await Promise.all([
    input.repository.get<NovelProject>("projects", input.projectId),
    safeList<ProjectSeed>(input.repository, "projectSeeds", input.projectId),
    safeList<Chapter>(input.repository, "chapters", input.projectId),
    safeList<Character>(input.repository, "characters", input.projectId),
    safeList<CharacterRelationship>(input.repository, "relationships", input.projectId),
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
    safeList<ConversationMessage>(input.repository, "conversationMessages", input.projectId),
    safeList<ConversationArtifact>(input.repository, "conversationArtifacts", input.projectId),
    safeList<ConversationSummary>(input.repository, "conversationSummaries", input.projectId),
  ]);
  if (!project) {
    throw Object.assign(new Error("The project does not exist in local canonical storage."), {
      code: "PROJECT_CONTEXT_PROJECT_NOT_FOUND",
      projectId: input.projectId,
    });
  }
  const selectedAttachmentSummaries = await reverifySelectedAttachmentSummaries(input);

  const entries: PrioritizedContext[] = [];
  const privacyLevel = input.privacyLevel;
  const selectedStoryBible = resolveProjectStoryBible(project, storyBibles);
  const storyBible = selectedStoryBible
    && selectedStoryBible.schemaVersion === NOVEL_DOMAIN_VERSION
    && selectedStoryBible.projectId === input.projectId
    && (selectedStoryBible.deletedAt === null || selectedStoryBible.deletedAt === undefined)
    && Number.isSafeInteger(selectedStoryBible.revision)
    && selectedStoryBible.revision >= 1
    ? selectedStoryBible
    : null;
  if (project.storyBibleId && !storyBible) {
    throw contextSourceError("PROJECT_CONTEXT_STORY_BIBLE_SOURCE_INVALID");
  }
  const storyState = storyStates.find((item) => item.id === project.storyStateId)
    ?? ordered(storyStates).at(-1)
    ?? null;
  const activeChapter = chapters.find((item) => item.id === project.activeChapterId)
    ?? ordered(chapters).at(-1)
    ?? null;
  const activeBranch = branches.find((item) => item.branchId === input.branchId)
    ?? branches.find((item) => item.status === "active")
    ?? null;
  const { worlds: stagedWorlds, characters: stagedCharacters } = activeStoryCast({
    project,
    storyBible,
    storyState,
    worldRules,
    worlds,
    characters,
  });
  const stagedWorldRules = activeStoryWorldRules(worldRules, storyState, storyBible);
  const stagedLore = activeStoryLore(lore, storyState, storyBible);
  const stagedTimeline = activeStoryTimeline(timeline, storyState, storyBible);
  const requestedCharacterIds = new Set([
    ...(input.characterIds ?? []),
    ...(input.characterId ? [input.characterId] : []),
  ].filter(Boolean));
  const selectedCharacters = requestedCharacterIds.size
    ? stagedCharacters.filter((item) => requestedCharacterIds.has(item.id))
    : stagedCharacters;
  const selectedCharacterIds = new Set(selectedCharacters.map((character) => character.id));
  const stagedFormalRelationships = activeStoryRelationships(
    formalRelationships.filter((relationship) => (
      relationship.schemaVersion === NOVEL_DOMAIN_VERSION
      && relationship.projectId === input.projectId
      && !relationship.deletedAt
      && Number.isSafeInteger(relationship.revision)
      && relationship.revision >= 1
    )),
    selectedCharacters,
  );
  const stagedFormalRelationshipValue = {
    source: "STAGED_CANONICAL_RELATIONSHIPS",
    relationshipLayer: "formal-canon",
    stagingRule: "both-endpoints-selected",
    edges: ordered(stagedFormalRelationships).map((item) => ({
      relationshipLayer: "formal-canon",
      ...cleanRecord(item, [
        "id",
        "fromCharacterId",
        "toCharacterId",
        "kind",
        "summary",
        "trust",
        "revision",
      ]),
    })),
  };
  const allCharacterIds = new Set(characters.map((character) => character.id));
  const recordBelongsToSelectedCharacter = (record: unknown) => {
    const value = record as {
      characterId?: string;
      subjectEntityIds?: string[];
      authorizedCharacterIds?: string[];
      relatedCharacterIds?: string[];
    };
    if (value.characterId) return selectedCharacterIds.has(value.characterId);
    const referencedCharacterIds = [
      ...(value.subjectEntityIds ?? []),
      ...(value.authorizedCharacterIds ?? []),
      ...(value.relatedCharacterIds ?? []),
    ].filter((id) => allCharacterIds.has(id));
    return referencedCharacterIds.length === 0
      || referencedCharacterIds.some((id) => selectedCharacterIds.has(id));
  };

  if (selectedCharacters.length) {
    addContext(entries, {
      id: `canonical-character-identities:${input.characterId ?? "all"}`,
      kind: "canon",
      source: "CANONICAL_CHARACTER_IDENTITIES",
      value: canonicalCharacterIdentities(selectedCharacters),
      priority: 101,
      privacyLevel,
    });
  }

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
    const storyBibleValue = {
      ...cleanRecord(storyBible, STORY_BIBLE_CONTEXT_FIELDS),
      relationshipIds: stagedFormalRelationships.map((relationship) => relationship.id),
      currentStage: {
        characterIds: stagedCharacters.map((character) => character.id),
        worldIds: stagedWorlds.map((world) => world.id),
        worldRuleIds: stagedWorldRules.map((rule) => rule.id),
        loreIds: stagedLore.map((entry) => entry.id),
        timelineEventIds: stagedTimeline.map((event) => event.id),
        formalRelationships: stagedFormalRelationshipValue,
      },
    };
    const sourceArtifactDigest = await sha256Hex(stableStringify({
      domain: "approved-story-bible-source-artifact-v1",
      value: storyBibleValue,
    }));
    addContext(entries, {
      id: `story-bible:${storyBible.id}`,
      kind: "story-bible",
      source: "APPROVED_STORY_BIBLE",
      value: storyBibleValue,
      priority: 98,
      privacyLevel,
      learningFacet: "story-bible",
      modelContextSource: {
        authority: "composer-repository-verified",
        sourceArtifactDigest,
        sourceRevisionDigest: await sha256Hex(stableStringify({
          domain: "approved-story-bible-source-revision-v1",
          store: "storyBibles",
          schemaVersion: storyBible.schemaVersion,
          id: storyBible.id,
          projectId: storyBible.projectId,
          revision: storyBible.revision,
          formalRelationshipRevisions: ordered(stagedFormalRelationships).map((relationship) => ({
            id: relationship.id,
            revision: relationship.revision,
          })),
          sourceArtifactDigest,
        })),
        receiptRequired: true,
      },
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
      value: ordered(selectedCharacters).map((item) => ({
        ...cleanRecord(item, [
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
          "rpgProfile",
          "dynamicsProfile",
          "revision",
        ]),
        ...(item.portrait ? {
          approvedPortrait: {
            theme: item.portrait.themeLabel,
            role: item.portrait.role,
            visualDescription: item.portrait.visualDescription,
            traits: item.portrait.traits,
            approvedAt: item.portrait.approvedAt,
          },
        } : {}),
      })),
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
  if (stagedWorlds.length) {
    addContext(entries, {
      id: `world:${stagedWorlds[0].id}`,
      kind: "canon",
      source: "WORLD",
      value: ordered(stagedWorlds).map((item) =>
        cleanRecord(item, ["id", "name", "era", "summary", "revision"])),
      priority: 86,
      privacyLevel,
    });
  }
  if (stagedWorldRules.length) {
    addContext(entries, {
      id: `world-rules:${input.projectId}`,
      kind: "story-bible",
      source: "WORLD_RULES",
      value: ordered(stagedWorldRules).map((item) =>
        cleanRecord(item, ["id", "title", "description", "immutable", "revision"])),
      priority: 91,
      privacyLevel,
    });
  }
  if (stagedLore.length) {
    addContext(entries, {
      id: `lore:${input.projectId}`,
      kind: "story-bible",
      source: "LORE",
      value: ordered(stagedLore).map((item) =>
        cleanRecord(item, ["id", "kind", "title", "content", "revision"])),
      priority: 80,
      privacyLevel,
    });
  }
  if (stagedTimeline.length) {
    addContext(entries, {
      id: `timeline:${input.projectId}`,
      kind: "canon",
      source: "TIMELINE",
      value: ordered(stagedTimeline).map((item) =>
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
        "activeCharacterIds",
        "activeWorldId",
        "activeWorldRuleIds",
        "activeLoreIds",
        "activeTimelineEventIds",
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
    if (!recordBelongsToSelectedCharacter(record)) return false;
    if (value.scope === "AUTHOR_ONLY") return audience === "author";
    if (
      requestedCharacterIds.size
      && value.authorizedCharacterIds?.length
      && !value.authorizedCharacterIds.some((id) => selectedCharacterIds.has(id))
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
    ...characterProfiles.filter(recordBelongsToSelectedCharacter),
    ...characterStates.filter((record) =>
      recordBelongsToSelectedCharacter(record)),
    ...characterBeliefs.filter((record) =>
      recordBelongsToSelectedCharacter(record)),
    ...characterMemories.filter((record) => {
      const memory = record as unknown as {
        characterId?: string;
        approvalStatus?: string;
        visibility?: string;
      };
      return recordBelongsToSelectedCharacter(record)
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
  const selectedCharacterRelationships = latestByStableKey(characterRelationships.filter((record) => {
    const relationship = record as unknown as {
      relationshipId?: string;
      fromCharacterId?: string;
      toCharacterId?: string;
    };
    return Boolean(
      relationship.fromCharacterId
      && relationship.toCharacterId
      && selectedCharacterIds.has(relationship.fromCharacterId)
      && selectedCharacterIds.has(relationship.toCharacterId),
    );
  }), (record) => (
    (record as unknown as { relationshipId?: string }).relationshipId ?? record.id
  ));
  const formalRelationshipByPair = new Map(stagedFormalRelationships.map((relationship) => [
    relationshipPairKey(relationship.fromCharacterId, relationship.toCharacterId),
    relationship,
  ]));
  const selectedRelationshipIds = new Set(selectedCharacterRelationships.map((record) => (
    (record as unknown as { relationshipId?: string }).relationshipId
  )).filter((id): id is string => Boolean(id)));
  const approvedRelationshipEvents = relationshipEvents.filter((record) => {
    const event = record as unknown as { status?: string; relationshipId?: string };
    return event.status === "APPROVED"
      && Boolean(event.relationshipId && selectedRelationshipIds.has(event.relationshipId));
  });
  if (selectedCharacterRelationships.length || approvedRelationshipEvents.length) {
    addContext(entries, {
      id: `character-relationships:${input.projectId}`,
      kind: "memory",
      source: "CHARACTER_AGENT_PRIVATE_RELATIONSHIP_PROJECTIONS",
      value: {
        relationshipLayer: "private-character-ai-projection",
        canonicalOverlapPolicy: "overlay-only-no-canon-redefinition",
        edges: ordered(selectedCharacterRelationships).map((item) => {
          const relationship = item as unknown as {
            fromCharacterId: string;
            toCharacterId: string;
          };
          const formal = formalRelationshipByPair.get(relationshipPairKey(
            relationship.fromCharacterId,
            relationship.toCharacterId,
          ));
          return {
            relationshipLayer: "private-character-ai-projection",
            projectionOfFormalRelationshipId: formal?.id ?? null,
            ...cleanRecord(item, [
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
            ]),
          };
        }),
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
  const selectedPrivateArcs = privateArcs.filter(recordBelongsToSelectedCharacter);
  if (audience === "author" && selectedPrivateArcs.length) {
    addContext(entries, {
      id: `author-only:private-arcs:${input.characterId ?? "all"}`,
      kind: "author-note",
      source: "AUTHOR_ONLY_PRIVATE_ARCS",
      value: ordered(selectedPrivateArcs).map((item) => cleanRecord(item, [
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
  let includedConversationSummaryCount = 0;
  if (input.conversationSessionId) {
    const canonRevisionDigest = await conversationCanonRevisionDigest({
      project,
      activeChapter,
      storyBible,
      storyState,
    });
    const scopedConversationMessages = new Map(
      conversationMessages
        .filter((message) => message.projectId === input.projectId && !message.deletedAt)
        .map((message) => [message.id, message] as const),
    );
    const eligibleSummaries = conversationSummaries
      .filter((summary) =>
        summary.projectId === input.projectId
        && !summary.deletedAt
        && !summary.invalidatedAt
        && summary.canonRevisionDigest === canonRevisionDigest
        && summary.sourceMessageIds.length > 0
        && summary.sourceMessageIds.every((messageId) =>
          scopedConversationMessages.get(messageId)?.sessionId === summary.sessionId))
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
        || right.revision - left.revision
        || left.id.localeCompare(right.id))
      .filter((summary, index, summaries) =>
        summaries.findIndex((candidate) => candidate.sessionId === summary.sessionId) === index);
    const currentSummary = eligibleSummaries.find((summary) =>
      summary.sessionId === input.conversationSessionId) ?? null;
    const recentProjectSummaries = eligibleSummaries
      .filter((summary) => summary.sessionId !== input.conversationSessionId)
      .slice(0, PROJECT_CONVERSATION_SUMMARY_LIMIT - (currentSummary ? 1 : 0));
    includedConversationSummaryCount = recentProjectSummaries.length
      + (currentSummary ? 1 : 0);
    if (currentSummary) {
      addContext(entries, {
        id: `conversation-summary:${currentSummary.id}`,
        kind: "memory",
        source: "CURRENT_PROJECT_CONVERSATION_SUMMARY_NON_CANONICAL",
        value: {
          authority: "conversation_memory_only",
          canonAligned: true,
          content: currentSummary.content.slice(0, CONVERSATION_SUMMARY_CHARACTER_LIMIT),
          sourceMessageIds: currentSummary.sourceMessageIds.slice(
            -CONVERSATION_SUMMARY_SOURCE_ID_LIMIT,
          ),
          contentDigest: currentSummary.contentDigest,
          revision: currentSummary.revision,
        },
        priority: 83,
        privacyLevel,
      });
    }
    if (recentProjectSummaries.length) {
      addContext(entries, {
        id: `conversation-project-summaries:${input.projectId}`,
        kind: "memory",
        source: "SAME_PROJECT_RECENT_CONVERSATION_SUMMARIES_NON_CANONICAL",
        value: recentProjectSummaries.map((summary) => ({
          sessionId: summary.sessionId,
          authority: "conversation_memory_only",
          canonAligned: true,
          content: summary.content.slice(0, CONVERSATION_SUMMARY_CHARACTER_LIMIT),
          sourceMessageIds: summary.sourceMessageIds.slice(
            -CONVERSATION_SUMMARY_SOURCE_ID_LIMIT,
          ),
          contentDigest: summary.contentDigest,
          revision: summary.revision,
        })),
        priority: 78,
        privacyLevel,
      });
    }
    const approvedArtifactMessages = new Set(
      conversationArtifacts
        .filter((artifact) =>
          artifact.projectId === input.projectId
          && artifact.sessionId === input.conversationSessionId
          && artifact.status === "approved"
          && !artifact.deletedAt)
        .map((artifact) => artifact.sourceMessageId),
    );
    const recentLimit = Math.max(
      2,
      Math.min(input.conversationRecentMessageLimit ?? 12, 24),
    );
    const recentMessages = conversationMessages
      .filter((message) =>
        message.projectId === input.projectId
        && message.sessionId === input.conversationSessionId
        && !message.deletedAt
        && message.status === "completed"
        && (message.role === "user" || message.role === "assistant"))
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id))
      .slice(-recentLimit);
    if (recentMessages.length) {
      addContext(entries, {
        id: `conversation-recent:${input.conversationSessionId}`,
        kind: "memory",
        source: "CURRENT_SESSION_RECENT_MESSAGES_NON_CANONICAL",
        value: recentMessages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content.slice(0, 4_000),
          contentDigest: message.contentDigest,
          authority: message.role === "assistant"
            ? approvedArtifactMessages.has(message.id)
              ? "approved_artifact_reference"
              : "assistant_candidate_only"
            : "current_author_request",
        })),
        priority: 81,
        privacyLevel,
      });
    }
  }
  for (const attachment of selectedAttachmentSummaries) {
    const boundary = sanitizeRetrievedKnowledge(attachment.summary, {
      sourceId: attachment.attachmentId,
      sourceRevision: attachment.contentDigest,
      sourceType: "user_document",
      storyId: input.projectId,
      storyRevision: String(input.revision ?? "current"),
    });
    addContext(entries, {
      id: `conversation-attachment-summary:${attachment.attachmentId}`,
      kind: "retrieval",
      source: "EXPLICITLY_SELECTED_LOCAL_ATTACHMENT_SUMMARY_UNTRUSTED",
      value: {
        authority: "untrusted_reference_data_only",
        contentDigest: attachment.contentDigest,
        sanitizationStatus: boundary.sanitizationStatus,
        detectedInjectionSignals: boundary.detectedInjectionSignals,
        summary: boundary.sanitizationStatus === "quarantined"
          ? "[ATTACHMENT_SUMMARY_QUARANTINED]"
          : boundary.sanitizedText,
        mayInvokeTools: false,
        mayMutateCanonical: false,
        mayAuthorizeExternalTransfer: false,
      },
      priority: 79,
      privacyLevel,
      modelContextSource: attachment.modelContextSource,
    });
  }
  for (const item of input.supplementalContext ?? []) {
    if (!item.approved) continue;
    if (item.visibility === "author-only" && audience !== "author") continue;
    const supplemental = structuredClone(item);
    delete supplemental.composerAuthority;
    delete supplemental.modelContextSource;
    delete supplemental.canonicalIdentitySource;
    entries.push({ priority: 99, item: supplemental });
  }

  let ranking: ProjectContextSourceSummary["ranking"] = {
    mode: "priority",
    modelId: null,
    modelDigest: null,
    cacheHit: null,
    dataLeftDevice: false,
    fallbackReason: input.semanticRanker
      ? "semantic_ranker_not_run"
      : input.semanticRankingDisabledReason ?? "semantic_model_not_configured",
  };
  const semanticQuery = input.semanticQuery?.trim();
  if (input.semanticRanker && semanticQuery && entries.length) {
    try {
      const result = await semanticRankingWithinDeadline({
        deadlineMs: input.semanticRankingDeadlineMs
          ?? PROJECT_CONTEXT_SEMANTIC_RANKING_DEADLINE_MS,
        signal: input.signal,
        execute: (signal) => input.semanticRanker!({
          query: semanticQuery,
          items: entries.map((entry) => ({
            id: entry.item.id,
            text: entry.item.text,
            priority: entry.priority,
          })),
          signal,
        }),
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
      if (input.signal?.aborted) {
        throw input.signal.reason ?? error;
      }
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
    characters: selectedCharacters.length,
    formalRelationships: stagedFormalRelationships.length,
    storyBibles: storyBibles.length,
    worlds: stagedWorlds.length,
    worldRules: stagedWorldRules.length,
    lore: stagedLore.length,
    timeline: stagedTimeline.length,
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
    characterRelationships: selectedCharacterRelationships.length,
    characterRelationshipEvents: approvedRelationshipEvents.length,
    privateArcs: audience === "author" ? privateArcs.length : 0,
    conversationMessages: input.conversationSessionId
      ? conversationMessages.filter((message) =>
        message.projectId === input.projectId
        && message.sessionId === input.conversationSessionId
        && !message.deletedAt).length
      : 0,
    conversationSummaries: includedConversationSummaryCount,
    selectedAttachmentSummaries: selectedAttachmentSummaries.length,
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
    conversationSessionId: input.conversationSessionId ?? null,
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
