import type {
  Character,
  CharacterRelationship,
  DomainRecord,
  LoreEntry,
  NovelProject,
  StoryBible,
  TimelineEvent,
  World,
  WorldRule,
} from "../domain";
import { characterEraContext, worldEraContext } from "../character-portraits/assignment";
import type { NovelRepository } from "../repository";
import {
  createGlobalCharacter,
  createGlobalMemory,
  createGlobalRelationship,
  createGlobalStoryBible,
  createGlobalTimelineTemplate,
  createGlobalWorld,
  createGlobalWorldRule,
} from "./factories";
import type { GlobalCanonRepository, GlobalCanonRepositoryWrite } from "./repository";
import {
  type GlobalCanonProjectImportRef,
  type GlobalCanonRecordByStore,
  type GlobalCanonStoredRecord,
  type GlobalCanonStoreName,
  type GlobalCanonEraContext,
  type ProjectCanonSourceStore,
} from "./types";

export type PreparedProjectCanonImportRecord = {
  [K in GlobalCanonStoreName]: {
    globalStore: K;
    sourceStore: ProjectCanonSourceStore;
    sourceRecordId: string;
    record: GlobalCanonRecordByStore[K];
  }
}[GlobalCanonStoreName];

export type ProjectCanonImportEntry = {
  sourceStore: ProjectCanonSourceStore;
  sourceRecordId: string;
  globalStore: GlobalCanonStoreName;
  globalRecordId: string;
  action: "created" | "updated" | "skipped";
  globalRevision: number;
};

export type ProjectCanonImportReceipt = {
  schemaVersion: "global-canon-project-import-receipt-v1";
  projectId: string;
  projectTitle: string;
  importedAt: string;
  entries: ProjectCanonImportEntry[];
  counts: {
    created: number;
    updated: number;
    skipped: number;
    total: number;
  };
  /** Project Canon is only read; no source record is updated or replaced. */
  projectMutated: false;
  /** Imported records become library candidates, never current story state. */
  autoStaged: false;
};

type SourceAwareWorld = World & Partial<{
  globalClassificationId: string;
  globalClassificationLabel: string;
  eraContext: GlobalCanonEraContext;
  crossEraBridge: string | null;
}>;

type SourceAwareRule = WorldRule & Partial<{ eraContexts: GlobalCanonEraContext[] }>;
type SourceAwareLore = LoreEntry & Partial<{ eraContexts: GlobalCanonEraContext[] }>;
type SourceAwareTimeline = TimelineEvent & Partial<{
  eraContext: GlobalCanonEraContext;
  placementHint: string | null;
}>;

const VALID_ERA_CONTEXTS = new Set<GlobalCanonEraContext>([
  "modern",
  "historical",
  "cultivation",
  "future",
  "cross-era",
  "other",
]);

function live<T extends DomainRecord>(records: T[]) {
  return records.filter((record) => !record.deletedAt);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableFingerprint(value: unknown) {
  const serialized = JSON.stringify(stableValue(value));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}:${serialized.length}`;
}

export function projectCanonGlobalId(
  projectId: string,
  sourceStore: ProjectCanonSourceStore,
  sourceRecordId: string,
) {
  return `project-import:${encodeURIComponent(projectId)}:${sourceStore}:${encodeURIComponent(sourceRecordId)}`;
}

function sourceEra(value: unknown, fallback: GlobalCanonEraContext): GlobalCanonEraContext {
  return typeof value === "string" && VALID_ERA_CONTEXTS.has(value as GlobalCanonEraContext)
    ? value as GlobalCanonEraContext
    : fallback;
}

function eraList(value: unknown, fallback: GlobalCanonEraContext) {
  if (!Array.isArray(value)) return [fallback];
  const eras = value.filter(
    (entry): entry is GlobalCanonEraContext => typeof entry === "string"
      && VALID_ERA_CONTEXTS.has(entry as GlobalCanonEraContext),
  );
  return eras.length ? [...new Set(eras)] : [fallback];
}

function importRef(input: {
  project: NovelProject;
  sourceStore: ProjectCanonSourceStore;
  source: DomainRecord;
  importedAt: string;
}): GlobalCanonProjectImportRef {
  return {
    schemaVersion: "global-canon-project-import-ref-v1",
    projectId: input.project.id,
    projectTitle: input.project.title,
    sourceStore: input.sourceStore,
    sourceRecordId: input.source.id,
    sourceRevision: input.source.revision,
    sourceUpdatedAt: input.source.updatedAt,
    sourceFingerprint: stableFingerprint(input.source),
    importedAt: input.importedAt,
    autoStaged: false,
  };
}

function migrationMeta(
  project: NovelProject,
  sourceStore: ProjectCanonSourceStore,
  source: DomainRecord,
) {
  return {
    id: projectCanonGlobalId(project.id, sourceStore, source.id),
    provenance: {
      origin: "migration" as const,
      sourceLabel: `作品「${project.title}」Canon 明確匯入`,
      sourceId: `${project.id}:${sourceStore}:${source.id}`,
      sourceUrl: null,
      rightsBasis: "作者既有作品正式設定的本機明確匯入",
    },
  };
}

function withImportRef<T extends GlobalCanonStoredRecord>(
  record: T,
  ref: GlobalCanonProjectImportRef,
): T {
  return { ...record, projectImportRef: ref };
}

function fallbackEra(worlds: readonly SourceAwareWorld[]) {
  return worlds[0] ? worldEraContext(worlds[0]) : "other";
}

function prepareCharacter(
  project: NovelProject,
  source: Character,
  importedAt: string,
): PreparedProjectCanonImportRecord {
  const ref = importRef({ project, sourceStore: "characters", source, importedAt });
  const inferredEra = characterEraContext(source) ?? "other";
  const record = withImportRef(createGlobalCharacter({
    name: source.name,
    aliases: [...source.aliases],
    identity: source.identity.value,
    personality: source.personality.value,
    goal: source.goal.value,
    lifeStatus: source.lifeStatus,
    eraContext: sourceEra(source.eraContext, inferredEra),
    age: source.age ?? null,
    fears: [...(source.fears ?? [])],
    privateSecrets: [...(source.privateSecrets ?? [])],
    factionIds: [...(source.factionIds ?? [])],
    values: [...(source.values ?? [])],
    capabilities: [...(source.capabilities ?? [])],
    limitations: [...(source.limitations ?? [])],
    portrait: source.portrait ? cloneValue(source.portrait) : null,
  }, migrationMeta(project, "characters", source)), ref);
  return {
    globalStore: "characters",
    sourceStore: "characters",
    sourceRecordId: source.id,
    record,
  };
}

function prepareRelationship(
  project: NovelProject,
  source: CharacterRelationship,
  importedAt: string,
): PreparedProjectCanonImportRecord {
  const ref = importRef({ project, sourceStore: "relationships", source, importedAt });
  const record = withImportRef(createGlobalRelationship({
    fromGlobalCharacterId: projectCanonGlobalId(project.id, "characters", source.fromCharacterId),
    toGlobalCharacterId: projectCanonGlobalId(project.id, "characters", source.toCharacterId),
    kind: source.kind,
    summary: source.summary,
    trust: source.trust,
  }, migrationMeta(project, "relationships", source)), ref);
  return {
    globalStore: "relationships",
    sourceStore: "relationships",
    sourceRecordId: source.id,
    record,
  };
}

function prepareWorld(
  project: NovelProject,
  source: SourceAwareWorld,
  importedAt: string,
): PreparedProjectCanonImportRecord {
  const ref = importRef({ project, sourceStore: "worlds", source, importedAt });
  const eraContext = worldEraContext(source);
  const summary = source.summary.value?.trim() || "";
  const crossEraBridge = eraContext === "cross-era"
    ? source.crossEraBridge?.trim() || summary || source.era.value?.trim() || source.name.value?.trim() || "來源作品已核准跨時代前提"
    : source.crossEraBridge?.trim() || null;
  const record = withImportRef(createGlobalWorld({
    name: source.name.value?.trim() || "未命名世界",
    classificationId: source.globalClassificationId?.trim() || `project:${project.genrePackId || "unclassified"}`,
    classificationLabel: source.globalClassificationLabel?.trim() || project.genrePackId || "來源作品世界",
    eraContext,
    eraLabel: source.era.value?.trim() || eraContext,
    summary,
    crossEraBridge,
    primaryTopicId: project.genreId,
    compatibleTopicIds: project.genreId ? [project.genreId] : [],
  }, migrationMeta(project, "worlds", source)), ref);
  return {
    globalStore: "worlds",
    sourceStore: "worlds",
    sourceRecordId: source.id,
    record,
  };
}

function prepareRule(
  project: NovelProject,
  source: SourceAwareRule,
  importedAt: string,
  projectEra: GlobalCanonEraContext,
  worldIds: string[],
): PreparedProjectCanonImportRecord {
  const ref = importRef({ project, sourceStore: "worldRules", source, importedAt });
  const record = withImportRef(createGlobalWorldRule({
    title: source.title,
    description: source.description,
    immutable: source.immutable,
    eraContexts: eraList(source.eraContexts, projectEra),
    appliesToGlobalWorldIds: worldIds,
  }, migrationMeta(project, "worldRules", source)), ref);
  return {
    globalStore: "rules",
    sourceStore: "worldRules",
    sourceRecordId: source.id,
    record,
  };
}

function prepareLore(
  project: NovelProject,
  source: SourceAwareLore,
  importedAt: string,
  projectEra: GlobalCanonEraContext,
  worldIds: string[],
): PreparedProjectCanonImportRecord {
  const ref = importRef({ project, sourceStore: "lore", source, importedAt });
  const record = withImportRef(createGlobalMemory({
    kind: source.kind,
    title: source.title,
    content: source.content,
    eraContexts: eraList(source.eraContexts, projectEra),
    appliesToGlobalWorldIds: worldIds,
  }, migrationMeta(project, "lore", source)), ref);
  return {
    globalStore: "memories",
    sourceStore: "lore",
    sourceRecordId: source.id,
    record,
  };
}

function prepareTimeline(
  project: NovelProject,
  source: SourceAwareTimeline,
  importedAt: string,
  projectEra: GlobalCanonEraContext,
): PreparedProjectCanonImportRecord {
  const ref = importRef({ project, sourceStore: "timeline", source, importedAt });
  const record = withImportRef(createGlobalTimelineTemplate({
    title: source.title,
    summary: source.summary,
    storyTime: source.storyTime,
    eraContext: sourceEra(source.eraContext, projectEra),
    placementHint: source.placementHint ?? (source.chapterId ? `來源章節 ${source.chapterId}` : null),
  }, migrationMeta(project, "timeline", source)), ref);
  return {
    globalStore: "timelineTemplates",
    sourceStore: "timeline",
    sourceRecordId: source.id,
    record,
  };
}

function prepareStoryBible(
  project: NovelProject,
  source: StoryBible,
  importedAt: string,
): PreparedProjectCanonImportRecord {
  const ref = importRef({ project, sourceStore: "storyBibles", source, importedAt });
  const record = withImportRef(createGlobalStoryBible({
    title: `${project.title}・Story Bible`,
    theme: source.theme.value,
    style: source.style.value,
    protagonistGlobalCharacterIds: source.protagonistIds.map((id) => projectCanonGlobalId(project.id, "characters", id)),
    globalCharacterIds: source.characterIds.map((id) => projectCanonGlobalId(project.id, "characters", id)),
    globalRelationshipIds: source.relationshipIds.map((id) => projectCanonGlobalId(project.id, "relationships", id)),
    globalWorldId: source.worldId ? projectCanonGlobalId(project.id, "worlds", source.worldId) : null,
    globalWorldRuleIds: source.worldRuleIds.map((id) => projectCanonGlobalId(project.id, "worldRules", id)),
    globalMemoryIds: source.loreIds.map((id) => projectCanonGlobalId(project.id, "lore", id)),
    globalTimelineTemplateIds: source.timelineEventIds.map((id) => projectCanonGlobalId(project.id, "timeline", id)),
    foreshadowing: [...source.foreshadowing],
    unresolvedThreads: [...source.unresolvedThreads],
    resolvedThreads: [...(source.resolvedThreads ?? [])],
    forbiddenContradictions: [...source.forbiddenContradictions],
    authorPreferences: [...source.authorPreferences],
  }, migrationMeta(project, "storyBibles", source)), ref);
  return {
    globalStore: "storyBibles",
    sourceStore: "storyBibles",
    sourceRecordId: source.id,
    record,
  };
}

/**
 * Read-only preparation step for the global editor.  No repository is
 * mutated until the caller explicitly invokes importProjectCanonToGlobal.
 */
export async function prepareProjectCanonImport(input: {
  projectRepository: NovelRepository;
  projectId: string;
  importedAt?: string;
}): Promise<PreparedProjectCanonImportRecord[]> {
  const project = await input.projectRepository.get<NovelProject>("projects", input.projectId);
  if (!project || project.deletedAt) throw new Error("GLOBAL_CANON_IMPORT_PROJECT_NOT_FOUND");
  const importedAt = input.importedAt ?? new Date().toISOString();
  const [characters, relationships, worlds, worldRules, lore, storyBibles, timeline] = await Promise.all([
    input.projectRepository.list<Character>("characters", project.id),
    input.projectRepository.list<CharacterRelationship>("relationships", project.id),
    input.projectRepository.list<SourceAwareWorld>("worlds", project.id),
    input.projectRepository.list<SourceAwareRule>("worldRules", project.id),
    input.projectRepository.list<SourceAwareLore>("lore", project.id),
    input.projectRepository.list<StoryBible>("storyBibles", project.id),
    input.projectRepository.list<SourceAwareTimeline>("timeline", project.id),
  ]);
  const liveWorlds = live(worlds);
  const projectEra = fallbackEra(liveWorlds);
  const globalWorldIds = liveWorlds.map((world) => projectCanonGlobalId(project.id, "worlds", world.id));
  return [
    ...live(characters).map((record) => prepareCharacter(project, record, importedAt)),
    ...live(relationships).map((record) => prepareRelationship(project, record, importedAt)),
    ...liveWorlds.map((record) => prepareWorld(project, record, importedAt)),
    ...live(worldRules).map((record) => prepareRule(project, record, importedAt, projectEra, globalWorldIds)),
    ...live(lore).map((record) => prepareLore(project, record, importedAt, projectEra, globalWorldIds)),
    ...live(storyBibles).map((record) => prepareStoryBible(project, record, importedAt)),
    ...live(timeline).map((record) => prepareTimeline(project, record, importedAt, projectEra)),
  ];
}

function sameImportSource(
  current: GlobalCanonStoredRecord,
  next: GlobalCanonStoredRecord,
) {
  const left = current.projectImportRef;
  const right = next.projectImportRef;
  return Boolean(
    left
    && right
    && left.projectId === right.projectId
    && left.sourceStore === right.sourceStore
    && left.sourceRecordId === right.sourceRecordId,
  );
}

function preflightPrepared<K extends GlobalCanonStoreName>(input: {
  globalStore: K;
  record: GlobalCanonRecordByStore[K];
  current: GlobalCanonRecordByStore[K] | null;
}): {
  action: "created" | "updated" | "skipped";
  record: GlobalCanonRecordByStore[K];
  write: GlobalCanonRepositoryWrite | null;
} {
  const current = input.current;
  if (current && !sameImportSource(current, input.record)) {
    throw new Error(`GLOBAL_CANON_IMPORT_ID_CONFLICT:${input.globalStore}:${input.record.id}`);
  }
  if (
    current?.projectImportRef
    && input.record.projectImportRef
    && current.projectImportRef.sourceFingerprint === input.record.projectImportRef.sourceFingerprint
    && current.projectImportRef.sourceRevision === input.record.projectImportRef?.sourceRevision
  ) {
    return { action: "skipped" as const, record: current, write: null };
  }
  if (
    current?.projectImportRef
    && input.record.projectImportRef
    && current.projectImportRef.sourceRevision > input.record.projectImportRef.sourceRevision
  ) {
    return { action: "skipped" as const, record: current, write: null };
  }
  const next = current
    ? { ...input.record, createdAt: current.createdAt, revision: current.revision }
    : input.record;
  return {
    action: current ? "updated" as const : "created" as const,
    record: next,
    write: {
      store: input.globalStore,
      record: next,
      expectedRevision: current?.revision ?? 0,
    } as GlobalCanonRepositoryWrite,
  };
}

async function currentPreparedRecord(
  repository: GlobalCanonRepository,
  prepared: PreparedProjectCanonImportRecord,
): Promise<GlobalCanonStoredRecord | null> {
  switch (prepared.globalStore) {
    case "characters": return repository.get("characters", prepared.record.id);
    case "relationships": return repository.get("relationships", prepared.record.id);
    case "worlds": return repository.get("worlds", prepared.record.id);
    case "rules": return repository.get("rules", prepared.record.id);
    case "memories": return repository.get("memories", prepared.record.id);
    case "storyBibles": return repository.get("storyBibles", prepared.record.id);
    case "timelineTemplates": return repository.get("timelineTemplates", prepared.record.id);
  }
}

function preflightPreparedRecord(
  prepared: PreparedProjectCanonImportRecord,
  current: GlobalCanonStoredRecord | null,
): {
  action: "created" | "updated" | "skipped";
  record: GlobalCanonStoredRecord;
  write: GlobalCanonRepositoryWrite | null;
} {
  switch (prepared.globalStore) {
    case "characters": return preflightPrepared({ globalStore: "characters", record: prepared.record, current: current as GlobalCanonRecordByStore["characters"] | null });
    case "relationships": return preflightPrepared({ globalStore: "relationships", record: prepared.record, current: current as GlobalCanonRecordByStore["relationships"] | null });
    case "worlds": return preflightPrepared({ globalStore: "worlds", record: prepared.record, current: current as GlobalCanonRecordByStore["worlds"] | null });
    case "rules": return preflightPrepared({ globalStore: "rules", record: prepared.record, current: current as GlobalCanonRecordByStore["rules"] | null });
    case "memories": return preflightPrepared({ globalStore: "memories", record: prepared.record, current: current as GlobalCanonRecordByStore["memories"] | null });
    case "storyBibles": return preflightPrepared({ globalStore: "storyBibles", record: prepared.record, current: current as GlobalCanonRecordByStore["storyBibles"] | null });
    case "timelineTemplates": return preflightPrepared({ globalStore: "timelineTemplates", record: prepared.record, current: current as GlobalCanonRecordByStore["timelineTemplates"] | null });
  }
}

/**
 * Explicitly copies all formal project Canon into the independent global
 * library.  This service performs no write through projectRepository and does
 * not touch StoryState, so imported people/worlds never enter a story by
 * themselves.
 */
export async function importProjectCanonToGlobal(input: {
  projectRepository: NovelRepository;
  globalRepository: GlobalCanonRepository;
  projectId: string;
  importedAt?: string;
}): Promise<ProjectCanonImportReceipt> {
  const project = await input.projectRepository.get<NovelProject>("projects", input.projectId);
  if (!project || project.deletedAt) throw new Error("GLOBAL_CANON_IMPORT_PROJECT_NOT_FOUND");
  const importedAt = input.importedAt ?? new Date().toISOString();
  const prepared = await prepareProjectCanonImport({
    projectRepository: input.projectRepository,
    projectId: project.id,
    importedAt,
  });
  const targetKeys = new Set<string>();
  for (const item of prepared) {
    const target = `${item.globalStore}:${item.record.id}`;
    if (targetKeys.has(target)) throw new Error(`GLOBAL_CANON_IMPORT_DUPLICATE_TARGET:${target}`);
    targetKeys.add(target);
  }
  // Read and validate the complete batch before issuing any write. The
  // repository then rechecks revisions and commits all writes atomically.
  const currents = await Promise.all(prepared.map((item) => (
    currentPreparedRecord(input.globalRepository, item)
  )));
  const plans = prepared.map((item, index) => preflightPreparedRecord(item, currents[index]));
  const saved = await input.globalRepository.putBatch(
    plans.flatMap((plan) => plan.write ? [plan.write] : []),
  );
  let savedIndex = 0;
  const entries = prepared.map((item, index): ProjectCanonImportEntry => {
    const plan = plans[index];
    const persisted = plan.write ? saved[savedIndex++] : plan.record;
    return {
      sourceStore: item.sourceStore,
      sourceRecordId: item.sourceRecordId,
      globalStore: item.globalStore,
      globalRecordId: persisted.id,
      action: plan.action,
      globalRevision: persisted.revision,
    };
  });
  return {
    schemaVersion: "global-canon-project-import-receipt-v1",
    projectId: project.id,
    projectTitle: project.title,
    importedAt,
    entries,
    counts: {
      created: entries.filter((entry) => entry.action === "created").length,
      updated: entries.filter((entry) => entry.action === "updated").length,
      skipped: entries.filter((entry) => entry.action === "skipped").length,
      total: entries.length,
    },
    projectMutated: false,
    autoStaged: false,
  };
}
