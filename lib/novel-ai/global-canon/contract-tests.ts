import {
  optionalValue,
  type Character,
  type CharacterRelationship,
  type DomainRecord,
  type LoreEntry,
  type NovelProject,
  type StoryBible,
  type TimelineEvent,
  type World,
  type WorldRule,
} from "../domain";
import { MemoryNovelRepository, type NovelRepository } from "../repository";
import { worldEraContext } from "../character-portraits/assignment";
import { copyGlobalCanonToProject, prepareGlobalCanonCopy } from "./copy-to-project";
import { copyGlobalStoryBibleToProject } from "./copy-story-bible-to-project";
import {
  createGlobalCharacter,
  createGlobalMemory,
  createGlobalRelationship,
  createGlobalStoryBible,
  createGlobalTimelineTemplate,
  createGlobalWorld,
  createGlobalWorldRule,
} from "./factories";
import type { GlobalCanonSourceRef } from "./types";
import {
  importProjectCanonToGlobal,
  projectCanonGlobalId,
} from "./import-from-project";
import {
  GlobalCanonRevisionConflictError,
  IndexedDbGlobalCanonRepository,
  MemoryGlobalCanonRepository,
  type GlobalCanonRepository,
} from "./repository";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`GLOBAL_CANON_CONTRACT_FAILED: ${message}`);
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function exerciseCrud(repository: GlobalCanonRepository) {
  const id = `contract-character-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await repository.remove("characters", id);
  const source = createGlobalCharacter({ name: "測試角色", eraContext: "historical" }, { id });
  const created = await repository.put("characters", source, 0);
  assert(created.revision === 1, "new records start at revision 1");
  const reloaded = await repository.get("characters", id);
  assert(reloaded?.name === "測試角色", "saved record can be reloaded");
  const updated = await repository.put(
    "characters",
    { ...created, name: "測試角色二版" },
    created.revision,
  );
  assert(updated.revision === 2, "updates increment revision");
  let conflict = false;
  try {
    await repository.put("characters", created, created.revision);
  } catch (error) {
    conflict = error instanceof GlobalCanonRevisionConflictError;
  }
  assert(conflict, "stale updates are rejected");
  await repository.remove("characters", id);
  assert(await repository.get("characters", id) === null, "remove deletes only the requested record");
}

async function exerciseAtomicBatch(repository: GlobalCanonRepository) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const characterId = `atomic-character-${suffix}`;
  const worldId = `atomic-world-${suffix}`;
  const character = createGlobalCharacter({ name: "批次原始人物", eraContext: "modern" }, { id: characterId });
  const world = createGlobalWorld({
    name: "批次原始世界",
    classificationId: "atomic-contract",
    classificationLabel: "原子契約",
    eraContext: "modern",
    eraLabel: "現代",
  }, { id: worldId });
  await repository.remove("characters", characterId);
  await repository.remove("worlds", worldId);
  const created = await repository.putBatch([
    { store: "characters", record: character, expectedRevision: 0 },
    { store: "worlds", record: world, expectedRevision: 0 },
  ]);
  assert(created.length === 2, "a valid cross-store batch commits every record");

  let conflict = false;
  try {
    await repository.putBatch([
      { store: "characters", record: { ...character, name: "不應部分保存" }, expectedRevision: 1 },
      { store: "worlds", record: { ...world, name: "版本衝突" }, expectedRevision: 0 },
    ]);
  } catch (error) {
    conflict = error instanceof GlobalCanonRevisionConflictError;
  }
  assert(conflict, "a stale record rejects the complete batch");
  assert(
    (await repository.get("characters", characterId))?.name === "批次原始人物",
    "a later batch conflict leaves an earlier record unchanged",
  );
  assert(
    (await repository.get("worlds", worldId))?.name === "批次原始世界",
    "a rejected batch leaves the conflicting record unchanged",
  );
  await repository.remove("characters", characterId);
  await repository.remove("worlds", worldId);
}

export async function runMemoryGlobalCanonContract() {
  const repository = new MemoryGlobalCanonRepository();
  await exerciseCrud(repository);
  await exerciseAtomicBatch(repository);
}

export async function runIndexedDbBlockedLateSuccessContract() {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  let closeCount = 0;
  const database = {
    objectStoreNames: { contains: () => true },
    close: () => { closeCount += 1; },
  } as unknown as IDBDatabase;
  const pending = {
    result: database,
    error: null,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
  } as unknown as IDBOpenDBRequest;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: { open: () => pending },
  });
  try {
    const repository = new IndexedDbGlobalCanonRepository();
    const outcome = repository.list("characters").then(
      () => "resolved",
      (error) => error instanceof Error ? error.message : String(error),
    );
    await Promise.resolve();
    assert(typeof pending.onblocked === "function", "IndexedDB open installs a blocked handler");
    pending.onblocked!.call(pending, {} as IDBVersionChangeEvent);
    assert((await outcome).includes("請關閉其他舊版本頁籤"), "blocked open fails with an actionable error");
    assert(typeof pending.onsuccess === "function", "IndexedDB open installs a success handler");
    pending.onsuccess!.call(pending, {} as Event);
    assert(closeCount === 1, "a late success after blocked closes the orphan database connection");
  } finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
}

export async function runIndexedDbGlobalCanonReloadContract() {
  if (typeof indexedDB === "undefined") throw new Error("INDEXEDDB_TEST_RUNTIME_REQUIRED");
  const firstPageLoad = new IndexedDbGlobalCanonRepository();
  const id = `reload-world-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const world = createGlobalWorld({
    name: "重載世界",
    classificationId: "historical-court",
    classificationLabel: "歷史宮廷",
    eraContext: "historical",
    eraLabel: "架空古代",
  }, { id });
  await firstPageLoad.put("worlds", world, 0);
  const simulatedReload = new IndexedDbGlobalCanonRepository();
  const restored = await simulatedReload.get("worlds", id);
  assert(restored?.name === world.name, "a new repository instance sees IndexedDB data from the prior page load");
  const storyBibleId = `${id}:story-bible`;
  const storyBible = createGlobalStoryBible({ title: "重載 Story Bible" }, { id: storyBibleId });
  await firstPageLoad.put("storyBibles", storyBible, 0);
  const restoredStoryBible = await simulatedReload.get("storyBibles", storyBibleId);
  assert(restoredStoryBible?.title === storyBible.title, "schema v2 persists imported Story Bible snapshots");
  await exerciseAtomicBatch(firstPageLoad);
  await simulatedReload.remove("worlds", id);
  await simulatedReload.remove("storyBibles", storyBibleId);
}

export async function runGlobalCanonCopyBoundaryContract() {
  const projectId = "contract-project";
  const world = createGlobalWorld({
    name: "白塔城",
    classificationId: "third-age-city",
    classificationLabel: "第三紀元城邦",
    eraContext: "future",
    eraLabel: "第三紀元",
    summary: "七座城市依照白塔公約交換通行權。",
  });
  const prepared = prepareGlobalCanonCopy(world, projectId, {
    targetId: "contract-project-world",
    copiedAt: "2026-01-01T00:00:00.000Z",
  });
  assert(prepared.receipt.autoStaged === false, "copy receipts explicitly prohibit automatic staging");
  assert(prepared.record.projectId === projectId, "copy belongs to the selected project only");
  assert(prepared.receipt.sourceRef.globalRevision === world.revision, "copy records source revision provenance");
  const copiedWorld = prepared.record as World & { eraContext?: string };
  assert(
    prepared.targetStore === "worlds"
      && copiedWorld.eraContext === "future"
      && worldEraContext(copiedWorld) === "future",
    "an explicit global world era survives copying and overrides keyword inference",
  );

  const writes: string[] = [];
  const repository = {
    get: async (store: string) => store === "projects" ? ({ id: projectId } as DomainRecord) : null,
    put: async (store: string, record: DomainRecord) => {
      writes.push(store);
      return record;
    },
  } as unknown as NovelRepository;
  await copyGlobalCanonToProject({ repository, projectId, source: world });
  assert(writes.join(",") === "worlds", "copy writes only the target Canon store and never StoryState or StoryBible");
}

export async function runGlobalStoryBibleCopyContract() {
  const projectId = "contract-story-bible-copy";
  const projectRepository = new MemoryNovelRepository();
  const globalRepository = new MemoryGlobalCanonRepository();
  const originalBibleId = "project-bible-original";
  const project: NovelProject = {
    ...projectRecord(projectId, projectId),
    title: "Story Bible 候選契約",
    creationMode: "blank",
    genrePackId: null,
    genreId: null,
    subgenreId: null,
    coreIdea: optionalValue("候選不得自動上場", "user_defined"),
    narrativeStyle: optionalValue("繁體中文小說", "user_defined"),
    adultMode: false,
    activeChapterId: null,
    storyBibleId: originalBibleId,
    storyStateId: "state-original",
  };
  const originalBible: StoryBible = {
    ...projectRecord(projectId, originalBibleId),
    theme: optionalValue("原本主題", "user_defined"),
    style: optionalValue("原本風格", "user_defined"),
    protagonistIds: [], characterIds: [], relationshipIds: [], worldId: null,
    worldRuleIds: [], loreIds: [], timelineEventIds: [], foreshadowing: [],
    unresolvedThreads: [], resolvedThreads: [], forbiddenContradictions: [], authorPreferences: [],
  };
  await projectRepository.put("projects", project, 0);
  await projectRepository.put("storyBibles", originalBible, 0);

  const lead = createGlobalCharacter({ name: "白霽", eraContext: "historical" }, { id: "global-lead" });
  const ally = createGlobalCharacter({ name: "沈遙", eraContext: "historical" }, { id: "global-ally" });
  const relationship = createGlobalRelationship({
    fromGlobalCharacterId: lead.id,
    toGlobalCharacterId: ally.id,
    kind: "盟友",
  }, { id: "global-relationship" });
  const world = createGlobalWorld({
    name: "河洛古城", classificationId: "historical", classificationLabel: "古代權謀",
    eraContext: "historical", eraLabel: "架空古代",
  }, { id: "global-world" });
  const rule = createGlobalWorldRule({ title: "證物可追溯", description: "物證必須有來源。" }, { id: "global-rule" });
  const memory = createGlobalMemory({ kind: "secret", title: "失竊名冊", content: "名冊缺少末頁。" }, { id: "global-memory" });
  const timeline = createGlobalTimelineTemplate({ title: "失竊之夜", summary: "名冊在封庫後失竊。", eraContext: "historical" }, { id: "global-timeline" });
  await globalRepository.putBatch([
    { store: "characters", record: lead }, { store: "characters", record: ally },
    { store: "relationships", record: relationship }, { store: "worlds", record: world },
    { store: "rules", record: rule }, { store: "memories", record: memory },
    { store: "timelineTemplates", record: timeline },
  ]);
  const source = createGlobalStoryBible({
    title: "河洛卷宗", theme: "真相與代價", style: "場景與對白推進",
    protagonistGlobalCharacterIds: [lead.id], globalCharacterIds: [lead.id, ally.id],
    globalRelationshipIds: [relationship.id], globalWorldId: world.id,
    globalWorldRuleIds: [rule.id], globalMemoryIds: [memory.id],
    globalTimelineTemplateIds: [timeline.id], forbiddenContradictions: ["證物不可憑空出現"],
  }, { id: "global-story-bible" });
  const sourceV1 = await globalRepository.put("storyBibles", source, 0);

  const receipt = await copyGlobalStoryBibleToProject({
    projectRepository,
    globalRepository,
    projectId,
    source: sourceV1,
    copiedAt: "2026-01-02T00:00:00.000Z",
  });
  assert(receipt.autoStaged === false, "a global Story Bible bundle is copied only as a candidate");
  assert((await projectRepository.get<NovelProject>("projects", projectId))?.storyBibleId === originalBibleId, "copying a candidate does not change the active Story Bible");
  type SnapshotBible = StoryBible & { globalCanonSourceRef: GlobalCanonSourceRef };
  type SnapshotCharacter = Character & { globalCanonSourceRef: GlobalCanonSourceRef };
  type SnapshotRelationship = CharacterRelationship & { globalCanonSourceRef: GlobalCanonSourceRef };
  const candidates = await projectRepository.list<SnapshotBible>("storyBibles", projectId);
  const copied = candidates.find((candidate) => candidate.id === receipt.storyBibleId) ?? null;
  assert(copied?.protagonistIds.length === 1 && copied.characterIds.length === 2, "the candidate maps all referenced people");
  assert(copied?.relationshipIds.length === 1 && Boolean(copied.worldId) && copied.worldRuleIds.length === 1, "the candidate maps relationships, world and rules");
  assert(copied?.loreIds.length === 1 && copied.timelineEventIds.length === 1, "the candidate maps memory and timeline references");

  // Copying a later global revision must create an immutable second project
  // snapshot. Selecting X before that copy must neither overwrite X nor move
  // the active pointer to Y.
  const selectedProject = await projectRepository.get<NovelProject>("projects", projectId);
  assert(Boolean(selectedProject), "the target project remains available before selecting the copied candidate");
  await projectRepository.put(
    "projects",
    { ...selectedProject!, storyBibleId: receipt.storyBibleId },
    selectedProject!.revision,
  );
  const copiedV1 = structuredClone(copied!);
  const leadSnapshotV1Id = copiedV1.protagonistIds[0]!;
  const allySnapshotV1Id = copiedV1.characterIds.find((id) => id !== leadSnapshotV1Id)!;
  const relationshipSnapshotV1Id = copiedV1.relationshipIds[0]!;
  const leadSnapshotV1 = await projectRepository.get<SnapshotCharacter>("characters", leadSnapshotV1Id);
  assert(leadSnapshotV1?.globalCanonSourceRef.globalRevision === 1, "X points to the revision-one character snapshot");

  const storedLeadV1 = await globalRepository.get("characters", lead.id);
  assert(Boolean(storedLeadV1), "the revision-one global lead exists");
  const leadV2 = await globalRepository.put(
    "characters",
    { ...storedLeadV1!, name: "白霽二版" },
    storedLeadV1!.revision,
  );
  const sourceV2 = await globalRepository.put(
    "storyBibles",
    { ...sourceV1, theme: "真相、代價與改版快照" },
    sourceV1.revision,
  );
  const receiptV2 = await copyGlobalStoryBibleToProject({
    projectRepository,
    globalRepository,
    projectId,
    source: sourceV2,
    copiedAt: "2026-01-03T00:00:00.000Z",
  });
  assert(receiptV2.autoStaged === false, "a revised global bundle remains a non-staged candidate");
  assert(receiptV2.storyBibleId !== receipt.storyBibleId, "a revised global Story Bible creates a new project snapshot Y");

  const copiedV1AfterV2 = await projectRepository.get<SnapshotBible>("storyBibles", receipt.storyBibleId);
  assert(
    JSON.stringify(copiedV1AfterV2) === JSON.stringify(copiedV1),
    "copying revision two leaves X content and source provenance byte-for-byte unchanged",
  );
  assert(
    copiedV1AfterV2?.globalCanonSourceRef.globalRevision === sourceV1.revision,
    "X retains the revision-one global Story Bible source reference",
  );
  assert(
    (await projectRepository.get<NovelProject>("projects", projectId))?.storyBibleId === receipt.storyBibleId,
    "copying Y does not move the active project pointer away from selected X",
  );

  const copiedV2 = await projectRepository.get<SnapshotBible>("storyBibles", receiptV2.storyBibleId);
  assert(copiedV2?.globalCanonSourceRef.globalRevision === sourceV2.revision, "Y records the revision-two global Story Bible source");
  assert(copiedV2?.theme.value === sourceV2.theme, "Y contains the revision-two Story Bible content");
  const leadSnapshotV2Id = copiedV2?.protagonistIds[0] ?? "";
  const leadSnapshotV2 = await projectRepository.get<SnapshotCharacter>("characters", leadSnapshotV2Id);
  assert(leadSnapshotV2Id !== leadSnapshotV1Id, "a revised character dependency receives a new project snapshot ID");
  assert(
    leadSnapshotV2?.name === leadV2.name
      && leadSnapshotV2.globalCanonSourceRef.globalRevision === leadV2.revision,
    "Y points to the revision-two character dependency",
  );
  assert(
    copiedV2?.characterIds.includes(allySnapshotV1Id)
      && copiedV2.worldId === copiedV1.worldId
      && sameStringArray(copiedV2.worldRuleIds, copiedV1.worldRuleIds)
      && sameStringArray(copiedV2.loreIds, copiedV1.loreIds)
      && sameStringArray(copiedV2.timelineEventIds, copiedV1.timelineEventIds),
    "dependencies whose global revision did not change reuse their existing project snapshots",
  );
  const relationshipSnapshotV2Id = copiedV2?.relationshipIds[0] ?? "";
  const relationshipSnapshotV2 = await projectRepository.get<SnapshotRelationship>("relationships", relationshipSnapshotV2Id);
  assert(
    relationshipSnapshotV2Id !== relationshipSnapshotV1Id
      && relationshipSnapshotV2?.fromCharacterId === leadSnapshotV2Id
      && relationshipSnapshotV2.toCharacterId === allySnapshotV1Id,
    "an unchanged global relationship is re-snapshotted when either mapped endpoint changes",
  );

  const countsBeforeIdempotentCopy = {
    storyBibles: (await projectRepository.list<DomainRecord>("storyBibles", projectId)).length,
    characters: (await projectRepository.list<DomainRecord>("characters", projectId)).length,
    relationships: (await projectRepository.list<DomainRecord>("relationships", projectId)).length,
  };
  const copiedV2BeforeRepeat = structuredClone(copiedV2!);
  const repeatedV2 = await copyGlobalStoryBibleToProject({
    projectRepository,
    globalRepository,
    projectId,
    source: sourceV2,
    copiedAt: "2026-01-04T00:00:00.000Z",
  });
  assert(repeatedV2.storyBibleId === receiptV2.storyBibleId, "re-copying the same global revision idempotently returns Y");
  assert(
    JSON.stringify(await projectRepository.get<SnapshotBible>("storyBibles", receiptV2.storyBibleId))
      === JSON.stringify(copiedV2BeforeRepeat),
    "an idempotent repeat does not rewrite or revise Y",
  );
  assert(
    (await projectRepository.list<DomainRecord>("storyBibles", projectId)).length === countsBeforeIdempotentCopy.storyBibles
      && (await projectRepository.list<DomainRecord>("characters", projectId)).length === countsBeforeIdempotentCopy.characters
      && (await projectRepository.list<DomainRecord>("relationships", projectId)).length === countsBeforeIdempotentCopy.relationships,
    "an idempotent repeat creates no duplicate Bible, character, or relationship snapshots",
  );

  const beforeBrokenCopy = (await projectRepository.list<DomainRecord>("worlds", projectId)).length;
  const broken = createGlobalStoryBible({
    title: "斷裂候選",
    globalCharacterIds: [lead.id],
    globalWorldId: "missing-global-world",
  });
  let rejected = false;
  try {
    await copyGlobalStoryBibleToProject({ projectRepository, globalRepository, projectId, source: broken });
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("GLOBAL_STORY_BIBLE_REFERENCE_MISSING");
  }
  assert(rejected, "a bundle with a missing reference is rejected during preflight");
  assert((await projectRepository.list<DomainRecord>("worlds", projectId)).length === beforeBrokenCopy, "missing-reference rejection leaves no partial dependency copy");
}

function projectRecord(projectId: string, id: string, revision = 1): DomainRecord {
  const timestamp = `2026-01-0${Math.min(revision, 9)}T00:00:00.000Z`;
  return {
    schemaVersion: "novel-domain-v1",
    id,
    projectId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: timestamp,
    revision,
    source: "user",
    provenance: { source: "user", actor: "author", createdAt: timestamp },
    deletedAt: null,
    parentRevision: null,
    migrationVersion: null,
  };
}

export async function runProjectCanonImportContract() {
  const projectId = "project:import-contract";
  const characterId = "character:historical-scholar";
  const relationshipId = "relationship:lead-scholar";
  const worldId = "world:modern";
  const ruleId = "rule:evidence";
  const loreId = "lore:archive";
  const bibleId = "story-bible:formal";
  const eventId = "timeline:first-proof";
  const project: NovelProject = {
    ...projectRecord(projectId, projectId),
    title: "匯入契約作品",
    creationMode: "blank",
    genrePackId: "懸疑司法",
    genreId: "mystery-evidence",
    subgenreId: null,
    coreIdea: optionalValue("現代證物案", "user_defined"),
    narrativeStyle: optionalValue("繁體中文小說", "user_defined"),
    adultMode: false,
    activeChapterId: null,
    storyBibleId: bibleId,
    storyStateId: "story-state:must-not-change",
  };
  const character: Character = {
    ...projectRecord(projectId, characterId),
    name: "謝知微",
    aliases: ["謝先生"],
    identity: optionalValue("古代史官", "user_defined"),
    personality: optionalValue("審慎", "user_defined"),
    goal: optionalValue("保住原始卷宗", "user_defined"),
    lifeStatus: "alive",
    locationId: null,
    age: 34,
    eraContext: "historical",
    capabilities: ["校勘"],
    portrait: null,
  };
  const relationship: CharacterRelationship = {
    ...projectRecord(projectId, relationshipId),
    fromCharacterId: characterId,
    toCharacterId: characterId,
    kind: "自我誓約",
    summary: "不竄改史料",
    trust: 100,
  };
  const world: World = {
    ...projectRecord(projectId, worldId),
    name: optionalValue("現代山城", "user_defined"),
    era: optionalValue("現代", "user_defined"),
    summary: optionalValue("證據與司法程序仍有效。", "user_defined"),
  };
  const rule: WorldRule = {
    ...projectRecord(projectId, ruleId),
    title: "證據須可追溯",
    description: "任何結論都必須保留來源。",
    immutable: true,
  };
  const lore: LoreEntry = {
    ...projectRecord(projectId, loreId),
    kind: "location",
    title: "舊檔案館",
    content: "只接受雙人覆核後的調閱。",
  };
  const timeline: TimelineEvent = {
    ...projectRecord(projectId, eventId),
    chapterId: null,
    storyTime: "第一日夜晚",
    title: "發現第一份證物",
    summary: "主角確認卷宗遭到替換。",
  };
  const storyBible: StoryBible = {
    ...projectRecord(projectId, bibleId),
    theme: optionalValue("真相與代價", "user_defined"),
    style: optionalValue("懸疑", "user_defined"),
    protagonistIds: [characterId],
    characterIds: [characterId],
    relationshipIds: [relationshipId],
    worldId,
    worldRuleIds: [ruleId],
    loreIds: [loreId],
    timelineEventIds: [eventId],
    foreshadowing: ["缺頁上的水痕"],
    unresolvedThreads: ["誰換走卷宗"],
    resolvedThreads: [],
    forbiddenContradictions: ["證物不可憑空出現"],
    authorPreferences: ["用場景呈現推理"],
  };
  const rows: Record<string, DomainRecord[]> = {
    projects: [project],
    characters: [character],
    relationships: [relationship],
    worlds: [world],
    worldRules: [rule],
    lore: [lore],
    storyBibles: [storyBible],
    timeline: [timeline],
  };
  let sourceWrites = 0;
  const sourceRepository = {
    kind: "memory",
    isAvailable: () => true,
    async get(store: string, id: string) {
      return rows[store]?.find((record) => record.id === id) ?? null;
    },
    async list(store: string, requestedProjectId?: string) {
      return (rows[store] ?? []).filter((record) => !requestedProjectId || record.projectId === requestedProjectId);
    },
    async put() {
      sourceWrites += 1;
      throw new Error("PROJECT_CANON_MUST_REMAIN_READ_ONLY");
    },
  } as unknown as NovelRepository;
  const globalRepository = new MemoryGlobalCanonRepository();
  const before = JSON.stringify(rows);
  const first = await importProjectCanonToGlobal({
    projectRepository: sourceRepository,
    globalRepository,
    projectId,
    importedAt: "2026-02-01T00:00:00.000Z",
  });
  assert(first.counts.created === 7, "the six requested Canon groups plus relationships are imported");
  assert(first.counts.updated === 0 && first.counts.skipped === 0, "first import creates every global snapshot");
  const importedSourceStores = new Set(first.entries.map((entry) => entry.sourceStore));
  for (const required of ["characters", "worlds", "worldRules", "lore", "storyBibles", "timeline"] as const) {
    assert(importedSourceStores.has(required), `${required} is included in the explicit project import`);
  }
  assert(first.projectMutated === false && first.autoStaged === false, "receipt forbids source mutation and automatic staging");
  assert(sourceWrites === 0 && JSON.stringify(rows) === before, "the source project is never written or overwritten");
  assert(!first.entries.some((entry) => (entry.globalStore as string) === "storyStates"), "StoryState is never an import target");

  const importedCharacter = await globalRepository.get(
    "characters",
    projectCanonGlobalId(projectId, "characters", characterId),
  );
  assert(importedCharacter?.eraContext === "historical", "explicit project character era survives global import");
  assert(importedCharacter?.projectImportRef?.sourceRecordId === characterId, "source coordinates are retained");
  assert(importedCharacter?.projectImportRef?.autoStaged === false, "each imported record is a non-staged library candidate");
  const importedBible = await globalRepository.get(
    "storyBibles",
    projectCanonGlobalId(projectId, "storyBibles", bibleId),
  );
  assert(
    importedBible?.globalCharacterIds[0] === projectCanonGlobalId(projectId, "characters", characterId),
    "Story Bible links point at deterministic global snapshots",
  );

  const second = await importProjectCanonToGlobal({
    projectRepository: sourceRepository,
    globalRepository,
    projectId,
    importedAt: "2026-02-02T00:00:00.000Z",
  });
  assert(second.counts.skipped === 7 && second.counts.created === 0 && second.counts.updated === 0, "repeat import is idempotent");
  assert((await globalRepository.get("characters", importedCharacter!.id))?.revision === 1, "idempotent re-import does not bump revision");

  rows.characters = [{
    ...character,
    revision: 2,
    updatedAt: "2026-02-03T00:00:00.000Z",
    goal: optionalValue("找回遭竄改的正史", "user_defined"),
  } as Character];
  const third = await importProjectCanonToGlobal({
    projectRepository: sourceRepository,
    globalRepository,
    projectId,
    importedAt: "2026-02-03T00:00:00.000Z",
  });
  assert(third.counts.updated === 1 && third.counts.skipped === 6, "only a changed source row updates");
  const refreshed = await globalRepository.get("characters", importedCharacter!.id);
  assert(refreshed?.revision === 2 && refreshed.goal === "找回遭竄改的正史", "changed source updates the same tracked global record");

  const conflictRepository = new MemoryGlobalCanonRepository();
  const conflictingBibleId = projectCanonGlobalId(projectId, "storyBibles", bibleId);
  await conflictRepository.put(
    "storyBibles",
    createGlobalStoryBible({ title: "作者既有的同 ID 設定" }, { id: conflictingBibleId }),
    0,
  );
  let preflightConflict = false;
  try {
    await importProjectCanonToGlobal({
      projectRepository: sourceRepository,
      globalRepository: conflictRepository,
      projectId,
      importedAt: "2026-02-04T00:00:00.000Z",
    });
  } catch (error) {
    preflightConflict = error instanceof Error && error.message.includes("GLOBAL_CANON_IMPORT_ID_CONFLICT");
  }
  assert(preflightConflict, "an unrelated record using an import ID is rejected during preflight");
  assert(
    await conflictRepository.get("characters", projectCanonGlobalId(projectId, "characters", characterId)) === null,
    "a conflict near the end of an import leaves no earlier partial records",
  );
}
