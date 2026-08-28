"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  CHARACTER_PORTRAIT_THEME_OPTIONS,
  filterCharacterPortraitCatalog,
} from "@/lib/novel-ai/character-portraits/catalog";
import type { Character, CharacterPortrait, CharacterPortraitAsset, NovelProject } from "@/lib/novel-ai/domain";
import type { GlobalIndexedWorld, GlobalIndexedWorldSummary } from "@/lib/novel-ai/game/global-world-index";
import { PROCEDURAL_TREASURE_KIND_DEFINITIONS, type ProceduralTreasureKind } from "@/lib/novel-ai/game/procedural-treasure-classification";
import { createProceduralTreasureLibrary, type ProceduralTreasureRecord } from "@/lib/novel-ai/game/procedural-treasure-library";
import { proceduralTreasureVisualCssVariables } from "@/lib/novel-ai/game/procedural-treasure-visual";
import {
  copyGlobalCanonToProject,
  copyGlobalStoryBibleToProject,
  createGlobalCanonRepository,
  createGlobalCharacter,
  createGlobalMemory,
  createGlobalOrganizationMemory,
  createGlobalRelationship,
  createGlobalStoryBible,
  createGlobalTreasureMemory,
  createGlobalTimelineTemplate,
  createGlobalWorld,
  createGlobalWorldRule,
  importProjectCanonToGlobal,
  type GlobalCanonEraContext,
  type GlobalCanonRecord,
  type GlobalCanonStoreName,
  type GlobalCharacter,
  type GlobalCharacterRelationship,
  type GlobalMemory,
  type GlobalMemoryKind,
  type GlobalStoryBible,
  type GlobalTimelineTemplate,
  type GlobalWorld,
  type GlobalWorldRule,
} from "@/lib/novel-ai/global-canon";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  buildStoryOrganizationBlueprints,
  buildStoryOrganizationDirectory,
  DeterministicSocialMatrix,
  familyGenealogyBranches,
  familyGenealogyGenerationPage,
  familyGenealogyPositionAt,
  organizationMatrixContext,
  organizationMemberAtOffset,
  organizationMemberPage,
  resolveStoryOrganizationSetting,
  type FamilyGenealogyPosition,
  type StoryOrganizationDirectoryEntry,
  type StoryOrganizationHierarchyNode,
  type StoryOrganizationMember,
} from "@/lib/novel-ai/social-matrix";
import PortraitCrop from "./portrait-crop";
import styles from "./canon.module.css";

type CanonTab = "characters" | "relationships" | "organizations" | "treasures" | "worlds" | "rules" | "memories" | "storyBible" | "timeline";
type MessageKind = "info" | "success" | "error";

type IndexedWorldPage = {
  offset: number;
  totalItems: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  items: readonly GlobalIndexedWorldSummary[];
};

type CanonLibrary = {
  characters: GlobalCharacter[];
  relationships: GlobalCharacterRelationship[];
  worlds: GlobalWorld[];
  rules: GlobalWorldRule[];
  memories: GlobalMemory[];
  storyBibles: GlobalStoryBible[];
  timelineTemplates: GlobalTimelineTemplate[];
};

type CharacterDraft = {
  name: string;
  identity: string;
  eraContext: GlobalCanonEraContext;
  age: string;
  personality: string;
  goal: string;
  capabilities: string;
  limitations: string;
  aliases: string;
};

type RelationshipDraft = {
  fromId: string;
  toId: string;
  kind: string;
  summary: string;
  trust: string;
};

type WorldDraft = {
  name: string;
  classificationId: string;
  classificationLabel: string;
  eraContext: GlobalCanonEraContext;
  eraLabel: string;
  summary: string;
  crossEraBridge: string;
};

type RuleDraft = {
  title: string;
  description: string;
  immutable: boolean;
  eraContexts: string;
};

type MemoryDraft = {
  kind: GlobalMemoryKind;
  title: string;
  content: string;
  eraContexts: string;
};

type TimelineDraft = {
  title: string;
  storyTime: string;
  summary: string;
  eraContext: GlobalCanonEraContext;
  placementHint: string;
};

type StoryBibleDraft = {
  title: string;
  theme: string;
  style: string;
  foreshadowing: string;
  unresolvedThreads: string;
  resolvedThreads: string;
  forbiddenContradictions: string;
  authorPreferences: string;
};

const EMPTY_LIBRARY: CanonLibrary = {
  characters: [],
  relationships: [],
  worlds: [],
  rules: [],
  memories: [],
  storyBibles: [],
  timelineTemplates: [],
};

const SAVED_RECORD_PAGE_SIZE = 24;

const EMPTY_CHARACTER: CharacterDraft = {
  name: "",
  identity: "",
  eraContext: "modern",
  age: "",
  personality: "",
  goal: "",
  capabilities: "",
  limitations: "",
  aliases: "",
};

const EMPTY_RELATIONSHIP: RelationshipDraft = {
  fromId: "",
  toId: "",
  kind: "盟友",
  summary: "",
  trust: "",
};

const EMPTY_WORLD: WorldDraft = {
  name: "",
  classificationId: "custom-world",
  classificationLabel: "自訂世界",
  eraContext: "modern",
  eraLabel: "現代",
  summary: "",
  crossEraBridge: "",
};

const EMPTY_RULE: RuleDraft = { title: "", description: "", immutable: true, eraContexts: "" };
const EMPTY_MEMORY: MemoryDraft = { kind: "custom", title: "", content: "", eraContexts: "" };
const EMPTY_STORY_BIBLE: StoryBibleDraft = {
  title: "",
  theme: "",
  style: "",
  foreshadowing: "",
  unresolvedThreads: "",
  resolvedThreads: "",
  forbiddenContradictions: "",
  authorPreferences: "",
};
const EMPTY_TIMELINE: TimelineDraft = { title: "", storyTime: "", summary: "", eraContext: "modern", placementHint: "" };

const ERA_OPTIONS: Array<{ value: GlobalCanonEraContext; label: string }> = [
  { value: "modern", label: "現代" },
  { value: "historical", label: "歷史／古代" },
  { value: "cultivation", label: "修仙／架空修行" },
  { value: "future", label: "未來" },
  { value: "cross-era", label: "跨時代（必須寫橋接規則）" },
  { value: "other", label: "其他架空世界" },
];

const TAB_LABELS: Array<{ id: CanonTab; label: string; short: string }> = [
  { id: "characters", label: "人物總庫", short: "人物" },
  { id: "relationships", label: "關係網", short: "關係" },
  { id: "organizations", label: "組織與祖譜", short: "組織" },
  { id: "treasures", label: "寶物圖鑑", short: "寶物" },
  { id: "worlds", label: "十萬世界", short: "世界" },
  { id: "rules", label: "世界規則", short: "規則" },
  { id: "memories", label: "記憶與資料", short: "記憶" },
  { id: "storyBible", label: "Story Bible", short: "Bible" },
  { id: "timeline", label: "時間線模板", short: "時間線" },
];

function splitList(value: string) {
  return value.split(/[、,，\n]/u).map((item) => item.trim()).filter(Boolean);
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "操作失敗，沒有修改資料。";
}

function keepRecordBase<T extends GlobalCanonRecord | GlobalStoryBible>(draft: T, current: T | null): T {
  if (!current) return draft;
  return {
    ...draft,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
    revision: current.revision,
    provenance: current.provenance,
    projectImportRef: current.projectImportRef,
  } as T;
}

function approvedPortrait(asset: CharacterPortraitAsset | CharacterPortrait | null): CharacterPortrait | null {
  if (!asset) return null;
  return {
    ...asset,
    approvedAt: "approvedAt" in asset ? asset.approvedAt : new Date().toISOString(),
    approvedBy: "user",
    dataLeftDevice: false,
  };
}

function eraForIndexedWorld(world: GlobalIndexedWorld): GlobalCanonEraContext {
  if (world.era === "contemporary") return "modern";
  if (world.era === "historical") return "historical";
  if (world.era === "future") return "future";
  return world.classification.id === "cultivation-sects" ? "cultivation" : "other";
}

function storeFor(record: GlobalCanonRecord): GlobalCanonStoreName {
  switch (record.recordType) {
    case "character": return "characters";
    case "relationship": return "relationships";
    case "world": return "worlds";
    case "rule": return "rules";
    case "memory": return "memories";
    case "timeline_template": return "timelineTemplates";
  }
}

function recordTitle(record: GlobalCanonRecord) {
  if (record.recordType === "character" || record.recordType === "world") return record.name;
  if (record.recordType === "relationship") return record.kind;
  return record.title;
}

function Revision({ value }: { value: number }) {
  return <small className={styles.revision}>全域版本 {value}</small>;
}

export default function CanonClient({
  initialTargetProjectId,
  indexedWorld,
  indexedWorldPage,
}: {
  initialTargetProjectId: string;
  indexedWorld: GlobalIndexedWorld;
  indexedWorldPage: IndexedWorldPage;
}) {
  const router = useRouter();
  const globalRepository = useMemo(() => createGlobalCanonRepository(), []);
  const projectRepository = useMemo(() => createNovelRepository(), []);
  const [library, setLibrary] = useState<CanonLibrary>(EMPTY_LIBRARY);
  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [targetProjectId, setTargetProjectId] = useState(initialTargetProjectId);
  const [tab, setTab] = useState<CanonTab>("characters");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("全域資料只保存在這個瀏覽器；尚未複製到任何作品，也不會自動上場。");
  const [messageKind, setMessageKind] = useState<MessageKind>("info");

  const [characterDraft, setCharacterDraft] = useState<CharacterDraft>(EMPTY_CHARACTER);
  const [editingCharacter, setEditingCharacter] = useState<GlobalCharacter | null>(null);
  const [portrait, setPortrait] = useState<CharacterPortraitAsset | CharacterPortrait | null>(null);
  const [portraitQuery, setPortraitQuery] = useState("");
  const [portraitTheme, setPortraitTheme] = useState("all");
  const [portraitPage, setPortraitPage] = useState(0);

  const [relationshipDraft, setRelationshipDraft] = useState<RelationshipDraft>(EMPTY_RELATIONSHIP);
  const [editingRelationship, setEditingRelationship] = useState<GlobalCharacterRelationship | null>(null);
  const [worldDraft, setWorldDraft] = useState<WorldDraft>(EMPTY_WORLD);
  const [editingWorld, setEditingWorld] = useState<GlobalWorld | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(EMPTY_RULE);
  const [editingRule, setEditingRule] = useState<GlobalWorldRule | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft>(EMPTY_MEMORY);
  const [editingMemory, setEditingMemory] = useState<GlobalMemory | null>(null);
  const [storyBibleDraft, setStoryBibleDraft] = useState<StoryBibleDraft>(EMPTY_STORY_BIBLE);
  const [editingStoryBible, setEditingStoryBible] = useState<GlobalStoryBible | null>(null);
  const [timelineDraft, setTimelineDraft] = useState<TimelineDraft>(EMPTY_TIMELINE);
  const [editingTimeline, setEditingTimeline] = useState<GlobalTimelineTemplate | null>(null);
  const [organizationQuery, setOrganizationQuery] = useState("");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [organizationMemberPageIndex, setOrganizationMemberPageIndex] = useState(0);
  const [familyGeneration, setFamilyGeneration] = useState(0);
  const [familyBranch, setFamilyBranch] = useState<1 | 2 | 3 | null>(null);
  const [familyPageIndex, setFamilyPageIndex] = useState(0);
  const [treasurePageIndex, setTreasurePageIndex] = useState(0);
  const [treasureKind, setTreasureKind] = useState<"all" | ProceduralTreasureKind>("all");
  const [treasureQuery, setTreasureQuery] = useState("");

  const filteredPortraits = useMemo(
    () => filterCharacterPortraitCatalog({ themeId: portraitTheme, query: portraitQuery }),
    [portraitQuery, portraitTheme],
  );
  const portraitPageCount = Math.max(1, Math.ceil(filteredPortraits.length / 12));
  const safePortraitPage = Math.min(portraitPage, portraitPageCount - 1);
  const visiblePortraits = filteredPortraits.slice(safePortraitPage * 12, safePortraitPage * 12 + 12);

  const organizationCatalog = useMemo(() => {
    const setting = resolveStoryOrganizationSetting({
      genre: indexedWorld.classification.name,
      coreIdea: indexedWorld.logline,
      worldEras: [indexedWorld.eraLabel, indexedWorld.blueprint.period],
      worldSummaries: [indexedWorld.logline, ...indexedWorld.blueprint.canonRules],
      sourceWorldId: indexedWorld.id,
    });
    const context = organizationMatrixContext({
      setting,
      base: {
        genre: indexedWorld.classification.name,
        playMode: "全域設定總編輯",
        storyTags: [indexedWorld.eraLabel, indexedWorld.primaryTopic.topicName],
      },
    });
    const seed = `global-canon:${indexedWorld.id}`;
    const blueprints = buildStoryOrganizationBlueprints({ seed, setting });
    const matrix = new DeterministicSocialMatrix({
      seed,
      context,
      institutionCount: blueprints.length,
      institutionProfiles: blueprints,
      cacheLimit: 96,
    });
    return {
      setting,
      context,
      matrix,
      directory: buildStoryOrganizationDirectory({
        seed,
        setting,
        blueprints,
        institutions: blueprints.map((_, index) => matrix.getInstitution(index)),
      }),
    };
  }, [indexedWorld]);

  const filteredOrganizations = useMemo(() => {
    const query = organizationQuery.normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
    if (!query) return organizationCatalog.directory;
    return organizationCatalog.directory.filter((organization) => [
      organization.name,
      organization.kindLabel,
      organization.sizeLabel,
      organization.territory,
      organization.doctrine,
    ].join("｜").normalize("NFKC").toLocaleLowerCase("zh-TW").includes(query));
  }, [organizationCatalog.directory, organizationQuery]);

  const selectedOrganization = filteredOrganizations.find(
    (organization) => organization.organizationId === selectedOrganizationId,
  ) ?? filteredOrganizations[0] ?? organizationCatalog.directory[0] ?? null;

  const organizationMembers = useMemo(() => selectedOrganization
    ? organizationMemberPage({
      matrix: organizationCatalog.matrix,
      organization: selectedOrganization,
      page: organizationMemberPageIndex,
      pageSize: 12,
    })
    : null, [organizationCatalog.matrix, organizationMemberPageIndex, selectedOrganization]);

  const familyMaximumGeneration = selectedOrganization?.archetype === "family"
    ? familyGenealogyPositionAt({
      organizationId: selectedOrganization.organizationId,
      memberCount: selectedOrganization.currentMemberCount,
      memberOffset: selectedOrganization.currentMemberCount - 1,
    }).generation
    : 0;
  const safeFamilyGeneration = Math.min(familyGeneration, familyMaximumGeneration);
  const familyBranches = selectedOrganization?.archetype === "family"
    ? familyGenealogyBranches({
      organizationId: selectedOrganization.organizationId,
      memberCount: selectedOrganization.currentMemberCount,
    })
    : [];
  const familyGenealogy = useMemo(() => selectedOrganization?.archetype === "family"
    ? familyGenealogyGenerationPage({
      organizationId: selectedOrganization.organizationId,
      memberCount: selectedOrganization.currentMemberCount,
      generation: safeFamilyGeneration,
      branchCoupleIndex: safeFamilyGeneration === 0 ? null : familyBranch,
      page: familyPageIndex,
      pageSize: 12,
    })
    : null, [familyBranch, familyPageIndex, safeFamilyGeneration, selectedOrganization]);

  const treasureCatalog = useMemo(() => createProceduralTreasureLibrary({
    storySeed: `global-canon:${indexedWorld.id}`,
    context: organizationCatalog.context,
    maxCacheEntries: 96,
  }), [indexedWorld.id, organizationCatalog.context]);
  const treasurePage = useMemo(
    () => treasureCatalog.page(treasurePageIndex, 24),
    [treasureCatalog, treasurePageIndex],
  );
  const visibleTreasures = useMemo(() => {
    const query = treasureQuery.normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
    return treasurePage.items.filter((treasure) => {
      if (treasureKind !== "all" && treasure.kind !== treasureKind) return false;
      if (!query) return true;
      return [
        treasure.name,
        treasure.kindLabel,
        treasure.subtype,
        treasure.era.sourceEraLabel,
        treasure.holder.characterName,
        treasure.holder.factionName,
      ].join("｜").normalize("NFKC").toLocaleLowerCase("zh-TW").includes(query);
    });
  }, [treasureKind, treasurePage.items, treasureQuery]);

  const refresh = useCallback(async () => {
    const [characters, relationships, worlds, rules, memories, storyBibles, timelineTemplates, nextProjects] = await Promise.all([
      globalRepository.list("characters"),
      globalRepository.list("relationships"),
      globalRepository.list("worlds"),
      globalRepository.list("rules"),
      globalRepository.list("memories"),
      globalRepository.list("storyBibles"),
      globalRepository.list("timelineTemplates"),
      projectRepository.list<NovelProject>("projects"),
    ]);
    setLibrary({ characters, relationships, worlds, rules, memories, storyBibles, timelineTemplates });
    setProjects(nextProjects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    setLoaded(true);
  }, [globalRepository, projectRepository]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void refresh().catch((cause) => {
        if (!active) return;
        setLoaded(true);
        setMessageKind("error");
        setMessage(`無法讀取全域資料庫：${errorMessage(cause)}`);
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);

  async function perform(task: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await task();
      await refresh();
      setMessageKind("success");
      setMessage(success);
    } catch (cause) {
      setMessageKind("error");
      setMessage(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function importSelectedProjectCanon() {
    const project = projects.find((item) => item.id === targetProjectId);
    if (!project) {
      setMessageKind("error");
      setMessage("請先選擇要匯入的既有作品。系統不會自行猜測來源。");
      return;
    }
    if (!window.confirm(`把作品「${project.title}」目前的正式人物、關係、世界、規則、記憶、Story Bible 與時間線匯入全域總庫？\n\n這只會建立可編輯的全域副本，不會修改作品，也不會讓任何內容自動上場。`)) return;
    setBusy(true);
    try {
      const receipt = await importProjectCanonToGlobal({
        projectRepository,
        globalRepository,
        projectId: project.id,
      });
      await refresh();
      setMessageKind("success");
      setMessage(
        `已匯入「${receipt.projectTitle}」：新增 ${receipt.counts.created}、更新 ${receipt.counts.updated}、未變更 ${receipt.counts.skipped}，共 ${receipt.counts.total} 筆。來源作品沒有被修改，也沒有自動上場。`,
      );
    } catch (cause) {
      setMessageKind("error");
      setMessage(`作品 Canon 匯入失敗：${errorMessage(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeRecord(record: GlobalCanonRecord) {
    if (record.recordType === "character" && library.relationships.some((item) => (
      item.fromGlobalCharacterId === record.id || item.toGlobalCharacterId === record.id
    ))) {
      setMessageKind("error");
      setMessage("這名人物仍在關係網中；請先刪除相關關係，避免留下斷裂資料。");
      return;
    }
    if (!window.confirm(`確定刪除全域資料「${recordTitle(record)}」？已複製到作品的舊快照不會被刪除。`)) return;
    await perform(
      () => globalRepository.remove(storeFor(record), record.id),
      `已刪除「${recordTitle(record)}」；既有作品快照維持不變。`,
    );
  }

  async function copyRecord(record: GlobalCanonRecord) {
    if (!targetProjectId) {
      setMessageKind("error");
      setMessage("請先選擇目標作品。系統不會自行猜測要複製到哪一本書。");
      return;
    }
    await perform(async () => {
      let options: Parameters<typeof copyGlobalCanonToProject>[0]["options"];
      if (record.recordType === "relationship") {
        type SourceAwareCharacter = Character & { globalCanonSourceRef?: { globalRecordId?: string } };
        const projectCharacters = await projectRepository.list<SourceAwareCharacter>("characters", targetProjectId);
        const from = projectCharacters.find((item) => item.globalCanonSourceRef?.globalRecordId === record.fromGlobalCharacterId);
        const to = projectCharacters.find((item) => item.globalCanonSourceRef?.globalRecordId === record.toGlobalCharacterId);
        if (!from || !to) throw new Error("請先把關係兩端的人物複製到目標作品，再複製這條關係。");
        options = { relationshipCharacterIds: { fromCharacterId: from.id, toCharacterId: to.id } };
      }
      await copyGlobalCanonToProject({
        repository: projectRepository,
        projectId: targetProjectId,
        source: record,
        options,
      });
    }, `已把「${recordTitle(record)}」複製成作品候選快照；沒有自動上場，也沒有修改故事中的數值。`);
  }

  async function copyStoryBible(record: GlobalStoryBible) {
    if (!targetProjectId) {
      setMessageKind("error");
      setMessage("請先選擇目標作品。系統不會自行猜測要複製到哪一本書。");
      return;
    }
    await perform(async () => {
      await copyGlobalStoryBibleToProject({
        projectRepository,
        globalRepository,
        projectId: targetProjectId,
        source: record,
      });
    }, `已把「${record.title}」及其人物、關係、世界、規則、記憶與時間線複製成作品候選；尚未成為目前 Story Bible，請到故事工作臺明確選用。`);
  }

  function navigateWorld(next: number) {
    const bounded = Math.max(1, Math.min(100_000, Math.trunc(next || 1)));
    const query = new URLSearchParams({ world: String(bounded) });
    if (targetProjectId) query.set("targetProjectId", targetProjectId);
    router.push(`/canon?${query.toString()}`);
  }

  async function saveCharacter(event: FormEvent) {
    event.preventDefault();
    if (!characterDraft.name.trim()) {
      setMessageKind("error");
      setMessage("人物姓名不能留白。");
      return;
    }
    await perform(async () => {
      const created = createGlobalCharacter({
        name: characterDraft.name,
        identity: characterDraft.identity,
        eraContext: characterDraft.eraContext,
        age: characterDraft.age ? Math.max(0, Number.parseInt(characterDraft.age, 10)) : null,
        personality: characterDraft.personality,
        goal: characterDraft.goal,
        aliases: splitList(characterDraft.aliases),
        capabilities: splitList(characterDraft.capabilities),
        limitations: splitList(characterDraft.limitations),
        portrait: approvedPortrait(portrait),
      });
      const record = keepRecordBase(created, editingCharacter);
      await globalRepository.put("characters", record, editingCharacter?.revision ?? 0);
      setCharacterDraft(EMPTY_CHARACTER);
      setEditingCharacter(null);
      setPortrait(null);
    }, editingCharacter ? "人物資料已更新；作品中的既有快照不會被暗中改寫。" : "人物已加入跨作品總庫，可再明確複製到作品候選庫。");
  }

  function editCharacter(character: GlobalCharacter) {
    setEditingCharacter(character);
    setCharacterDraft({
      name: character.name,
      identity: character.identity ?? "",
      eraContext: character.eraContext,
      age: character.age === null ? "" : String(character.age),
      personality: character.personality ?? "",
      goal: character.goal ?? "",
      capabilities: character.capabilities.join("、"),
      limitations: character.limitations.join("、"),
      aliases: character.aliases.join("、"),
    });
    setPortrait(character.portrait);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveRelationship(event: FormEvent) {
    event.preventDefault();
    if (!relationshipDraft.fromId || !relationshipDraft.toId || relationshipDraft.fromId === relationshipDraft.toId) {
      setMessageKind("error");
      setMessage("關係必須選擇兩名不同人物。");
      return;
    }
    await perform(async () => {
      const trust = relationshipDraft.trust.trim() ? Number.parseInt(relationshipDraft.trust, 10) : null;
      const created = createGlobalRelationship({
        fromGlobalCharacterId: relationshipDraft.fromId,
        toGlobalCharacterId: relationshipDraft.toId,
        kind: relationshipDraft.kind || "關係未命名",
        summary: relationshipDraft.summary,
        trust: trust === null ? null : Math.max(-100, Math.min(100, trust)),
      });
      await globalRepository.put("relationships", keepRecordBase(created, editingRelationship), editingRelationship?.revision ?? 0);
      setRelationshipDraft(EMPTY_RELATIONSHIP);
      setEditingRelationship(null);
    }, editingRelationship ? "關係已更新。" : "關係已加入跨作品關係網。");
  }

  function editRelationship(record: GlobalCharacterRelationship) {
    setEditingRelationship(record);
    setRelationshipDraft({
      fromId: record.fromGlobalCharacterId,
      toId: record.toGlobalCharacterId,
      kind: record.kind,
      summary: record.summary,
      trust: record.trust === null ? "" : String(record.trust),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveIndexedWorld() {
    const current = library.worlds.find((item) => item.catalogWorldNumber === indexedWorld.ordinal) ?? null;
    await perform(async () => {
      const created = createGlobalWorld({
        name: indexedWorld.title,
        classificationId: indexedWorld.classification.id,
        classificationLabel: indexedWorld.classification.name,
        eraContext: eraForIndexedWorld(indexedWorld),
        eraLabel: indexedWorld.eraLabel,
        summary: [
          indexedWorld.logline,
          `年代：${indexedWorld.blueprint.period}`,
          `科技：${indexedWorld.blueprint.technology}`,
          `超常規則：${indexedWorld.blueprint.magic}`,
          `核心制度：${indexedWorld.blueprint.institutions.join("、")}`,
          ...indexedWorld.blueprint.canonRules,
        ].join("\n"),
        catalogWorldNumber: indexedWorld.ordinal,
        primaryTopicId: indexedWorld.primaryTopic.topicId,
        compatibleTopicIds: indexedWorld.compatibleTopicIds,
      }, { provenance: { origin: "system_catalog", sourceLabel: indexedWorld.displayId, sourceId: indexedWorld.id } });
      await globalRepository.put("worlds", keepRecordBase(created, current), current?.revision ?? 0);
    }, current ? `${indexedWorld.displayId}的全域快照已更新。` : `${indexedWorld.displayId}已保存到世界總庫；不會自動加入任何作品。`);
  }

  async function saveWorld(event: FormEvent) {
    event.preventDefault();
    if (!worldDraft.name.trim()) {
      setMessageKind("error");
      setMessage("世界名稱不能留白。");
      return;
    }
    await perform(async () => {
      const created = createGlobalWorld({
        name: worldDraft.name,
        classificationId: worldDraft.classificationId,
        classificationLabel: worldDraft.classificationLabel,
        eraContext: worldDraft.eraContext,
        eraLabel: worldDraft.eraLabel,
        summary: worldDraft.summary,
        crossEraBridge: worldDraft.crossEraBridge,
        catalogWorldNumber: editingWorld?.catalogWorldNumber ?? null,
        primaryTopicId: editingWorld?.primaryTopicId ?? null,
        compatibleTopicIds: editingWorld?.compatibleTopicIds ?? [],
      });
      await globalRepository.put("worlds", keepRecordBase(created, editingWorld), editingWorld?.revision ?? 0);
      setWorldDraft(EMPTY_WORLD);
      setEditingWorld(null);
    }, editingWorld ? "世界資料已更新；既有作品快照維持原版本。" : "自訂世界已加入全域總庫。");
  }

  function editWorld(record: GlobalWorld) {
    setEditingWorld(record);
    setWorldDraft({
      name: record.name,
      classificationId: record.classificationId,
      classificationLabel: record.classificationLabel,
      eraContext: record.eraContext,
      eraLabel: record.eraLabel,
      summary: record.summary,
      crossEraBridge: record.crossEraBridge ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveOrganizationCandidate(organization: StoryOrganizationDirectoryEntry) {
    const created = createGlobalOrganizationMemory({
      organization,
      catalogWorldId: indexedWorld.id,
      catalogWorldLabel: `${indexedWorld.displayId}・${indexedWorld.title}`,
    });
    const current = library.memories.find((memory) => memory.id === created.id) ?? null;
    await perform(async () => {
      await globalRepository.put(
        "memories",
        keepRecordBase(created, current),
        current?.revision ?? 0,
      );
    }, current
      ? `${organization.name}的組織快照已按固定目錄更新；可到記憶頁繼續編輯。`
      : `${organization.name}已保存為可編輯、可複製的全域組織候選。`);
  }

  async function saveTreasureCandidate(treasure: ProceduralTreasureRecord) {
    const created = createGlobalTreasureMemory({
      treasure,
      catalogWorldId: indexedWorld.id,
      catalogWorldLabel: `${indexedWorld.displayId}・${indexedWorld.title}`,
    });
    const current = library.memories.find((memory) => memory.id === created.id) ?? null;
    await perform(async () => {
      await globalRepository.put(
        "memories",
        keepRecordBase(created, current),
        current?.revision ?? 0,
      );
    }, current
      ? `${treasure.name}的圖鑑快照已更新；可到記憶頁繼續編輯。`
      : `${treasure.name}已保存為可編輯、可複製的全域寶物候選。`);
  }

  function editSavedCatalogMemory(record: GlobalMemory) {
    setTab("memories");
    editMemory(record);
  }

  async function saveRule(event: FormEvent) {
    event.preventDefault();
    if (!ruleDraft.title.trim() || !ruleDraft.description.trim()) {
      setMessageKind("error");
      setMessage("規則標題與內容都不能留白。");
      return;
    }
    await perform(async () => {
      const created = createGlobalWorldRule({
        title: ruleDraft.title,
        description: ruleDraft.description,
        immutable: ruleDraft.immutable,
        eraContexts: splitList(ruleDraft.eraContexts) as GlobalCanonEraContext[],
      });
      await globalRepository.put("rules", keepRecordBase(created, editingRule), editingRule?.revision ?? 0);
      setRuleDraft(EMPTY_RULE);
      setEditingRule(null);
    }, editingRule ? "世界規則已更新。" : "世界規則已加入全域總庫。");
  }

  function editRule(record: GlobalWorldRule) {
    setEditingRule(record);
    setRuleDraft({ title: record.title, description: record.description, immutable: record.immutable, eraContexts: record.eraContexts.join("、") });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveMemory(event: FormEvent) {
    event.preventDefault();
    if (!memoryDraft.title.trim() || !memoryDraft.content.trim()) {
      setMessageKind("error");
      setMessage("記憶標題與內容都不能留白。");
      return;
    }
    await perform(async () => {
      const created = createGlobalMemory({
        kind: memoryDraft.kind,
        title: memoryDraft.title,
        content: memoryDraft.content,
        eraContexts: splitList(memoryDraft.eraContexts) as GlobalCanonEraContext[],
      });
      await globalRepository.put("memories", keepRecordBase(created, editingMemory), editingMemory?.revision ?? 0);
      setMemoryDraft(EMPTY_MEMORY);
      setEditingMemory(null);
    }, editingMemory ? "記憶資料已更新。" : "記憶資料已加入全域總庫。");
  }

  function editMemory(record: GlobalMemory) {
    setEditingMemory(record);
    setMemoryDraft({ kind: record.kind, title: record.title, content: record.content, eraContexts: record.eraContexts.join("、") });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveStoryBible(event: FormEvent) {
    event.preventDefault();
    if (!storyBibleDraft.title.trim()) {
      setMessageKind("error");
      setMessage("Story Bible 名稱不能留白。");
      return;
    }
    await perform(async () => {
      const current = editingStoryBible;
      const created = createGlobalStoryBible({
        title: storyBibleDraft.title,
        theme: storyBibleDraft.theme,
        style: storyBibleDraft.style,
        protagonistGlobalCharacterIds: current?.protagonistGlobalCharacterIds ?? [],
        globalCharacterIds: current?.globalCharacterIds ?? [],
        globalRelationshipIds: current?.globalRelationshipIds ?? [],
        globalWorldId: current?.globalWorldId ?? null,
        globalWorldRuleIds: current?.globalWorldRuleIds ?? [],
        globalMemoryIds: current?.globalMemoryIds ?? [],
        globalTimelineTemplateIds: current?.globalTimelineTemplateIds ?? [],
        foreshadowing: splitList(storyBibleDraft.foreshadowing),
        unresolvedThreads: splitList(storyBibleDraft.unresolvedThreads),
        resolvedThreads: splitList(storyBibleDraft.resolvedThreads),
        forbiddenContradictions: splitList(storyBibleDraft.forbiddenContradictions),
        authorPreferences: splitList(storyBibleDraft.authorPreferences),
      });
      await globalRepository.put("storyBibles", keepRecordBase(created, current), current?.revision ?? 0);
      setStoryBibleDraft(EMPTY_STORY_BIBLE);
      setEditingStoryBible(null);
    }, editingStoryBible ? "Story Bible 已更新；既有作品仍維持自己的快照。" : "Story Bible 已加入全域總庫；尚未套用到任何作品。");
  }

  function editStoryBible(record: GlobalStoryBible) {
    setEditingStoryBible(record);
    setStoryBibleDraft({
      title: record.title,
      theme: record.theme ?? "",
      style: record.style ?? "",
      foreshadowing: record.foreshadowing.join("、"),
      unresolvedThreads: record.unresolvedThreads.join("、"),
      resolvedThreads: record.resolvedThreads.join("、"),
      forbiddenContradictions: record.forbiddenContradictions.join("、"),
      authorPreferences: record.authorPreferences.join("、"),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeStoryBible(record: GlobalStoryBible) {
    if (!window.confirm(`確定刪除全域 Story Bible「${record.title}」？來源作品與既有作品快照不會被刪除。`)) return;
    await perform(
      () => globalRepository.remove("storyBibles", record.id),
      `已刪除全域 Story Bible「${record.title}」；來源作品沒有被修改。`,
    );
  }

  async function saveTimeline(event: FormEvent) {
    event.preventDefault();
    if (!timelineDraft.title.trim() || !timelineDraft.summary.trim()) {
      setMessageKind("error");
      setMessage("時間線名稱與事件內容都不能留白。");
      return;
    }
    await perform(async () => {
      const created = createGlobalTimelineTemplate({
        title: timelineDraft.title,
        storyTime: timelineDraft.storyTime,
        summary: timelineDraft.summary,
        eraContext: timelineDraft.eraContext,
        placementHint: timelineDraft.placementHint,
      });
      await globalRepository.put("timelineTemplates", keepRecordBase(created, editingTimeline), editingTimeline?.revision ?? 0);
      setTimelineDraft(EMPTY_TIMELINE);
      setEditingTimeline(null);
    }, editingTimeline ? "時間線模板已更新。" : "時間線模板已加入全域總庫。");
  }

  function editTimeline(record: GlobalTimelineTemplate) {
    setEditingTimeline(record);
    setTimelineDraft({ title: record.title, storyTime: record.storyTime ?? "", summary: record.summary, eraContext: record.eraContext, placementHint: record.placementHint ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const characterName = useCallback((id: string) => library.characters.find((item) => item.id === id)?.name ?? "人物已刪除", [library.characters]);
  const selectedProject = projects.find((project) => project.id === targetProjectId) ?? null;

  return (
    <main className={styles.shell} data-testid="global-canon-editor">
      <header className={styles.topbar}>
        <Link href="/" aria-label="回系統首頁">← 系統首頁</Link>
        <div><small>GLOBAL CANON LIBRARY · CROSS-PROJECT</small><h1>角色、世界與記憶總編輯</h1></div>
        <Link href="/professional?intent=library" aria-label="前往作品管理中心">作品管理中心</Link>
      </header>

      <section className={styles.hero}>
        <div>
          <span>跨作品正式資料源</span>
          <h2>先在這裡建立世界，再讓故事選擇誰上場</h2>
          <p>人物能力、關係、世界規則、記憶與時間線都在全域總庫修改。複製到作品時只建立一份可選候選快照；故事工作台不能在暗中改值。</p>
        </div>
        <dl>
          <div><dt>人物</dt><dd>{library.characters.length}</dd></div>
          <div><dt>世界</dt><dd>{library.worlds.length}</dd></div>
          <div><dt>Story Bible</dt><dd>{library.storyBibles.length}</dd></div>
          <div><dt>世界索引</dt><dd>100,000</dd></div>
        </dl>
      </section>

      <section className={styles.copyBar} aria-label="複製候選快照到作品">
        <div><b>目標作品</b><span>只有按下資料卡的「複製候選」才會寫入；不自動上場。</span></div>
        <select data-testid="global-canon-target-project" value={targetProjectId} onChange={(event) => setTargetProjectId(event.target.value)} disabled={busy}>
          <option value="">尚未選擇作品</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
        {selectedProject ? <Link href={`/studio/project/${encodeURIComponent(selectedProject.id)}/characters`}>到作品內唯讀選擇</Link> : <Link href="/studio/create">建立作品</Link>}
      </section>

      <section className={styles.importBar} aria-label="把既有作品正式設定匯入全域總庫">
        <div>
          <b>既有作品 → 全域總編輯</b>
          <span>明確匯入人物、關係、世界、規則、記憶、Story Bible 與時間線；重複匯入只更新來源有變化的資料。</span>
          <small>來源作品只讀，不會改數值、不會自動上場，也不會覆寫另一筆全域資料。</small>
        </div>
        <button className={styles.primary} type="button" disabled={busy || !selectedProject} onClick={() => void importSelectedProjectCanon()}>
          {busy ? "處理中……" : selectedProject ? `匯入《${selectedProject.title}》正式設定` : "請先選擇作品"}
        </button>
      </section>

      <p className={styles.status} data-kind={messageKind} role={messageKind === "error" ? "alert" : "status"}>{message}</p>

      <nav className={styles.tabs} aria-label="全域資料分類" role="tablist">
        {TAB_LABELS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-label={item.label} aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
            <span>{item.label}</span><small>{item.short}</small>
          </button>
        ))}
      </nav>

      {!loaded ? <section className={styles.loading}><h2>正在開啟本機全域總庫</h2><p>不會把資料送出這台裝置。</p></section> : null}

      {loaded && tab === "characters" ? (
        <section className={styles.workspace} data-testid="global-canon-characters">
          <form className={styles.editor} onSubmit={(event) => void saveCharacter(event)}>
            <header><div><small>CHARACTER MASTER</small><h2>{editingCharacter ? `編輯 ${editingCharacter.name}` : "建立全域人物"}</h2></div><span>能力只在總庫修改</span></header>
            <div className={styles.formGrid}>
              <label>姓名<input required value={characterDraft.name} onChange={(event) => setCharacterDraft({ ...characterDraft, name: event.target.value })} /></label>
              <label>身分／職位<input value={characterDraft.identity} onChange={(event) => setCharacterDraft({ ...characterDraft, identity: event.target.value })} placeholder="例：雲海峰內門弟子、企業法務部長" /></label>
              <label>時代<select value={characterDraft.eraContext} onChange={(event) => setCharacterDraft({ ...characterDraft, eraContext: event.target.value as GlobalCanonEraContext })}>{ERA_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
              <label>年齡<input type="number" min="0" max="9999" value={characterDraft.age} onChange={(event) => setCharacterDraft({ ...characterDraft, age: event.target.value })} /></label>
              <label className={styles.wide}>別名（頓號分隔）<input value={characterDraft.aliases} onChange={(event) => setCharacterDraft({ ...characterDraft, aliases: event.target.value })} /></label>
              <label className={styles.wide}>個性<textarea value={characterDraft.personality} onChange={(event) => setCharacterDraft({ ...characterDraft, personality: event.target.value })} /></label>
              <label className={styles.wide}>個人目標<textarea value={characterDraft.goal} onChange={(event) => setCharacterDraft({ ...characterDraft, goal: event.target.value })} /></label>
              <label className={styles.wide}>能力／專長（頓號分隔）<textarea value={characterDraft.capabilities} onChange={(event) => setCharacterDraft({ ...characterDraft, capabilities: event.target.value })} /></label>
              <label className={styles.wide}>限制／弱點（頓號分隔）<textarea value={characterDraft.limitations} onChange={(event) => setCharacterDraft({ ...characterDraft, limitations: event.target.value })} /></label>
            </div>

            <fieldset className={styles.portraitStudio}>
              <legend>從 10,000 種可重現人像中選擇</legend>
              <div className={styles.portraitToolbar}>
                <label>風格<select value={portraitTheme} onChange={(event) => { setPortraitTheme(event.target.value); setPortraitPage(0); }}><option value="all">全部風格</option>{CHARACTER_PORTRAIT_THEME_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
                <label>搜尋<input type="search" value={portraitQuery} onChange={(event) => { setPortraitQuery(event.target.value); setPortraitPage(0); }} placeholder="角色、氣質、配色" /></label>
                <span>{filteredPortraits.length.toLocaleString("zh-TW")} 張</span>
              </div>
              <div className={styles.portraitSelection}>
                <div className={styles.selectedPortrait} data-empty={!portrait}>
                  {portrait ? <PortraitCrop portrait={portrait} className={styles.portraitLarge} /> : <span aria-hidden="true">人</span>}
                  <div><b>{portrait?.role ?? "尚未選擇人像"}</b><p>{portrait?.visualDescription ?? "每張都使用圖集的實際人物裁切，不再顯示空白色塊。"}</p></div>
                </div>
                <div className={styles.portraitGrid}>
                  {visiblePortraits.map((item) => (
                    <button type="button" key={item.id} aria-pressed={portrait?.id === item.id} onClick={() => setPortrait(item)} title={item.visualDescription}>
                      <PortraitCrop portrait={item} className={styles.portraitThumb} decorative />
                      <span>{item.role}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.pager}>
                <button type="button" disabled={safePortraitPage === 0} onClick={() => setPortraitPage(Math.max(0, safePortraitPage - 1))}>上一批</button>
                <span>第 {safePortraitPage + 1} / {portraitPageCount} 批</span>
                <button type="button" disabled={safePortraitPage + 1 >= portraitPageCount} onClick={() => setPortraitPage(Math.min(portraitPageCount - 1, safePortraitPage + 1))}>下一批</button>
              </div>
            </fieldset>

            <div className={styles.formActions}>
              <button className={styles.primary} disabled={busy} type="submit">{editingCharacter ? "保存人物修改" : "加入人物總庫"}</button>
              {editingCharacter ? <button type="button" onClick={() => { setEditingCharacter(null); setCharacterDraft(EMPTY_CHARACTER); setPortrait(null); }}>取消編輯</button> : null}
            </div>
          </form>

          <section className={styles.libraryPanel}>
            <header><div><small>SAVED CHARACTERS</small><h2>跨作品人物名單</h2></div><span>{library.characters.length} 人</span></header>
            <PagedRecords
              items={library.characters}
              emptyText="尚未建立人物。先選一張人像，再填寫人物的目標、能力與限制。"
              renderItem={(character) => (
                <article className={styles.recordCard} key={character.id}>
                  <div className={styles.characterHeading}>
                    {character.portrait ? <PortraitCrop portrait={character.portrait} className={styles.cardPortrait} decorative /> : <span className={styles.noPortrait}>人</span>}
                    <div><Revision value={character.revision} /><h3>{character.name}</h3><p>{character.identity || "身分待設定"} · {ERA_OPTIONS.find((item) => item.value === character.eraContext)?.label}</p></div>
                  </div>
                  <p>{character.personality || "個性待設定"}</p>
                  <dl><div><dt>目標</dt><dd>{character.goal || "待設定"}</dd></div><div><dt>能力</dt><dd>{character.capabilities.join("、") || "待設定"}</dd></div><div><dt>限制</dt><dd>{character.limitations.join("、") || "待設定"}</dd></div></dl>
                  <footer><button type="button" onClick={() => editCharacter(character)}>編輯</button><button type="button" onClick={() => void copyRecord(character)} disabled={busy}>複製候選</button><button className={styles.danger} type="button" onClick={() => void removeRecord(character)} disabled={busy}>刪除</button></footer>
                </article>
              )}
            />
          </section>
        </section>
      ) : null}

      {loaded && tab === "relationships" ? (
        <section className={styles.workspace} data-testid="global-canon-relationships">
          <form className={styles.editor} onSubmit={(event) => void saveRelationship(event)}>
            <header><div><small>RELATIONSHIP NETWORK</small><h2>{editingRelationship ? "編輯人物關係" : "建立人物關係"}</h2></div><span>兩端人物都來自總庫</span></header>
            <div className={styles.formGrid}>
              <label>人物 A<select required value={relationshipDraft.fromId} onChange={(event) => setRelationshipDraft({ ...relationshipDraft, fromId: event.target.value })}><option value="">請選擇</option>{library.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
              <label>人物 B<select required value={relationshipDraft.toId} onChange={(event) => setRelationshipDraft({ ...relationshipDraft, toId: event.target.value })}><option value="">請選擇</option>{library.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
              <label>關係類型<input required value={relationshipDraft.kind} onChange={(event) => setRelationshipDraft({ ...relationshipDraft, kind: event.target.value })} placeholder="家人、師徒、盟友、宿敵、同事" /></label>
              <label>信任（-100～100）<input type="number" min="-100" max="100" value={relationshipDraft.trust} onChange={(event) => setRelationshipDraft({ ...relationshipDraft, trust: event.target.value })} /></label>
              <label className={styles.wide}>關係摘要<textarea value={relationshipDraft.summary} onChange={(event) => setRelationshipDraft({ ...relationshipDraft, summary: event.target.value })} /></label>
            </div>
            <div className={styles.formActions}><button className={styles.primary} disabled={busy || library.characters.length < 2} type="submit">{editingRelationship ? "保存關係" : "加入關係網"}</button>{editingRelationship ? <button type="button" onClick={() => { setEditingRelationship(null); setRelationshipDraft(EMPTY_RELATIONSHIP); }}>取消編輯</button> : null}</div>
          </form>
          <section className={styles.libraryPanel}>
            <header><div><small>SAVED RELATIONSHIPS</small><h2>跨作品關係網</h2></div><span>{library.relationships.length} 條</span></header>
            <PagedRecords
              items={library.relationships}
              listClassName={styles.relationList}
              emptyText="建立兩名人物後，就能在這裡整理家族、師徒、企業職務、盟友與敵對關係。"
              renderItem={(record) => (
                <article key={record.id}>
                  <div><b>{characterName(record.fromGlobalCharacterId)}</b><span>⇄</span><b>{characterName(record.toGlobalCharacterId)}</b></div>
                  <h3>{record.kind}{record.trust === null ? "" : ` · 信任 ${record.trust}`}</h3><p>{record.summary || "尚未補充關係經歷。"}</p>
                  <footer><Revision value={record.revision} /><button type="button" onClick={() => editRelationship(record)}>編輯</button><button type="button" onClick={() => void copyRecord(record)} disabled={busy}>複製候選</button><button className={styles.danger} type="button" onClick={() => void removeRecord(record)} disabled={busy}>刪除</button></footer>
                </article>
              )}
            />
          </section>
        </section>
      ) : null}

      {loaded && tab === "organizations" ? (
        <section className={styles.workspace} data-testid="global-canon-organizations">
          <section className={styles.libraryPanel}>
            <header>
              <div><small>ORGANIZATION DIRECTORY · LAZY 10K ROSTER</small><h2>家族祖譜、宗門與企業階層</h2></div>
              <span>{indexedWorld.displayId} · {organizationCatalog.setting.eraLabel}</span>
            </header>
            <div className={styles.catalogToolbar}>
              <label>搜尋組織、類型或據點<input type="search" value={organizationQuery} onChange={(event) => { setOrganizationQuery(event.target.value); setOrganizationMemberPageIndex(0); setFamilyPageIndex(0); }} placeholder="例：家族、宗門、企業、丹堂" /></label>
              <p>每個組織依規模容納 1–10,000 人；名冊、祖譜與職位按頁重現，不會一次塞入萬筆資料。</p>
            </div>
            <div className={styles.organizationBrowser}>
              <nav className={styles.organizationList} aria-label="世界組織清單">
                {filteredOrganizations.map((organization) => (
                  <button
                    type="button"
                    key={organization.organizationId}
                    aria-current={selectedOrganization?.organizationId === organization.organizationId ? "true" : undefined}
                    onClick={() => {
                      setSelectedOrganizationId(organization.organizationId);
                      setOrganizationMemberPageIndex(0);
                      setFamilyGeneration(0);
                      setFamilyBranch(null);
                      setFamilyPageIndex(0);
                    }}
                  >
                    <span>{organization.kindLabel} · {organization.eraLabel}</span>
                    <b>{organization.name}</b>
                    <small>在籍 {organization.currentMemberCount.toLocaleString("zh-TW")}／上限 {organization.memberCapacity.toLocaleString("zh-TW")}</small>
                  </button>
                ))}
                {filteredOrganizations.length === 0 ? <p className={styles.empty}>這個世界的十個組織中沒有符合條件的項目。</p> : null}
              </nav>

              {selectedOrganization ? (
                <article className={styles.organizationDetail} data-testid="global-organization-detail">
                  <header>
                    <div><span>{selectedOrganization.kindLabel} · {selectedOrganization.sizeLabel}組織</span><h3>{selectedOrganization.name}</h3></div>
                    <strong>{selectedOrganization.currentMemberCount.toLocaleString("zh-TW")}<small>人在籍／上限 {selectedOrganization.memberCapacity.toLocaleString("zh-TW")}</small></strong>
                  </header>
                  <dl className={styles.organizationFacts}>
                    <div><dt>據點</dt><dd>{selectedOrganization.territory}</dd></div>
                    <div><dt>內部準則</dt><dd>{selectedOrganization.doctrine}</dd></div>
                    <div><dt>公開目標</dt><dd>{selectedOrganization.publicGoal}</dd></div>
                    <div><dt>內部矛盾</dt><dd>{selectedOrganization.hiddenConflict}</dd></div>
                  </dl>
                  <div className={styles.catalogActions}>
                    {(() => {
                      const saved = library.memories.find((memory) => memory.id === `global-organization:${selectedOrganization.organizationId}`) ?? null;
                      return <>
                        <button className={styles.primary} type="button" disabled={busy} onClick={() => void saveOrganizationCandidate(selectedOrganization)}>{saved ? "更新全域組織快照" : "保存到全域組織總庫"}</button>
                        <button type="button" disabled={!saved} onClick={() => saved && editSavedCatalogMemory(saved)}>編輯已保存資料</button>
                        <button type="button" disabled={!saved || busy} onClick={() => saved && void copyRecord(saved)}>複製候選到作品</button>
                      </>;
                    })()}
                  </div>

                  <section className={styles.hierarchyPanel}>
                    <div><small>ORGANIZATION TREE</small><h4>{selectedOrganization.archetype === "family" ? "房系、家業與家族職位" : selectedOrganization.archetype === "sect" ? "峰、殿、堂、派系與內外門" : "董事會、事業群、部門與職位"}</h4></div>
                    <ul className={styles.hierarchyTree}><OrganizationHierarchyBranch branch={selectedOrganization.hierarchy} /></ul>
                  </section>

                  {selectedOrganization.archetype === "family" && familyGenealogy ? (
                    <section className={styles.genealogyPanel} data-testid="global-family-genealogy" data-materialization="lazy-paged">
                      <header><div><small>FAMILY GENEALOGY</small><h4>祖譜：依世代與房系列出家族名單</h4></div><span>{selectedOrganization.currentMemberCount.toLocaleString("zh-TW")} 人皆有固定譜位</span></header>
                      <div className={styles.genealogyControls}>
                        <label>世代<select value={safeFamilyGeneration} onChange={(event) => { setFamilyGeneration(Number.parseInt(event.target.value, 10)); setFamilyPageIndex(0); }}>{Array.from({ length: familyMaximumGeneration + 1 }, (_, generation) => <option key={generation} value={generation}>{generation === 0 ? "始祖" : `第 ${generation + 1} 代`}</option>)}</select></label>
                        <div aria-label="祖譜房系"><button type="button" aria-pressed={familyBranch === null} onClick={() => { setFamilyBranch(null); setFamilyPageIndex(0); }}>全部房系</button>{familyBranches.map((branch) => <button key={branch.branchId} type="button" disabled={safeFamilyGeneration === 0} aria-pressed={familyBranch === branch.branchCoupleIndex} onClick={() => { setFamilyBranch(branch.branchCoupleIndex); setFamilyPageIndex(0); }}>{branch.label}</button>)}</div>
                      </div>
                      <div className={styles.genealogyGrid}>
                        {familyGenealogy.positions.map((position) => {
                          const member = organizationMemberAtOffset({ matrix: organizationCatalog.matrix, organization: selectedOrganization, memberOffset: position.memberOffset });
                          return <GenealogyMemberCard key={position.personId} member={member} position={position} resolveName={(offset) => organizationMemberAtOffset({ matrix: organizationCatalog.matrix, organization: selectedOrganization, memberOffset: offset }).name} />;
                        })}
                        {familyGenealogy.positions.length === 0 ? <p className={styles.empty}>此世代與房系沒有在籍人物。</p> : null}
                      </div>
                      <div className={styles.pager}><button type="button" disabled={familyPageIndex === 0} onClick={() => setFamilyPageIndex(Math.max(0, familyPageIndex - 1))}>上一頁祖譜</button><span>第 {familyPageIndex + 1} / {Math.max(1, familyGenealogy.totalPages)} 頁 · 共 {familyGenealogy.total.toLocaleString("zh-TW")} 人</span><button type="button" disabled={familyPageIndex + 1 >= familyGenealogy.totalPages} onClick={() => setFamilyPageIndex(Math.min(Math.max(0, familyGenealogy.totalPages - 1), familyPageIndex + 1))}>下一頁祖譜</button></div>
                    </section>
                  ) : (
                    <section className={styles.rosterPanel} data-testid="global-organization-roster" data-materialization="lazy-paged">
                      <header><div><small>MEMBER ROSTER</small><h4>人物名冊與正式職位</h4></div><span>峰堂／部門、位階與派系均可查</span></header>
                      <div className={styles.rosterGrid}>{organizationMembers?.items.map((member) => <OrganizationMemberCard key={member.characterId} member={member} />)}</div>
                      <div className={styles.pager}><button type="button" disabled={organizationMemberPageIndex === 0} onClick={() => setOrganizationMemberPageIndex(Math.max(0, organizationMemberPageIndex - 1))}>上一頁名冊</button><span>第 {organizationMemberPageIndex + 1} 頁 · 共 {(organizationMembers?.total ?? 0).toLocaleString("zh-TW")} 人</span><button type="button" disabled={!organizationMembers?.nextCursor} onClick={() => setOrganizationMemberPageIndex(organizationMemberPageIndex + 1)}>下一頁名冊</button></div>
                    </section>
                  )}
                </article>
              ) : null}
            </div>
          </section>
        </section>
      ) : null}

      {loaded && tab === "treasures" ? (
        <section className={styles.workspace} data-testid="global-canon-treasures">
          <section className={styles.libraryPanel}>
            <header><div><small>100,000 ERA-GUARDED TREASURES</small><h2>古代與現代寶物圖鑑</h2></div><span>{indexedWorld.displayId} · 不跨時代亂入</span></header>
            <div className={styles.treasureToolbar}>
              <form onSubmit={(event) => { event.preventDefault(); const value = Number.parseInt(String(new FormData(event.currentTarget).get("ordinal") || "1"), 10); const ordinal = Math.max(1, Math.min(100_000, Number.isFinite(value) ? value : 1)); setTreasurePageIndex(Math.floor((ordinal - 1) / 24)); }}><label>直接前往寶物編號<input name="ordinal" type="number" min="1" max="100000" defaultValue={treasurePageIndex * 24 + 1} /></label><button type="submit">前往</button></form>
              <label>類型<select value={treasureKind} onChange={(event) => setTreasureKind(event.target.value as "all" | ProceduralTreasureKind)}><option value="all">全部類型</option>{PROCEDURAL_TREASURE_KIND_DEFINITIONS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select></label>
              <label>搜尋本頁<input type="search" value={treasureQuery} onChange={(event) => setTreasureQuery(event.target.value)} placeholder="名稱、類型、時代、持有人或組織" /></label>
            </div>
            <p className={styles.catalogNote}>涵蓋武器、法寶、符籙、丹藥、藥草、陣法、護具、材料、功法與特殊機緣；圖案、時代、能力、持有人及所屬組織都會固定重現。</p>
            <div className={styles.treasureGrid} data-testid="global-treasure-grid">
              {visibleTreasures.map((treasure) => {
                const saved = library.memories.find((memory) => memory.id === `global-treasure:${treasure.id}`) ?? null;
                return (
                  <article className={styles.treasureCard} key={treasure.id} data-kind={treasure.kind} data-era={treasure.era.sourceEra} style={proceduralTreasureVisualCssVariables(treasure.visual) as CSSProperties}>
                    <div className={styles.treasureHeading}>
                      <div className={styles.treasureImageFrame}>
                        <Image src={treasure.visual.baseAsset} alt={treasure.visual.alt} width={180} height={180} />
                        <span>{treasure.visual.elementLabel}屬性</span>
                      </div>
                      <div><small>#{String(treasure.ordinal + 1).padStart(6, "0")} · {treasure.era.sourceEraLabel}</small><h3>{treasure.name}</h3><p>{treasure.kindLabel}／{treasure.subtype} · {treasure.rarityLabel}</p></div>
                    </div>
                    <dl><div><dt>持有人</dt><dd>{treasure.holder.characterName}</dd></div><div><dt>持有組織</dt><dd>{treasure.holder.factionName} · {treasure.holder.factionKind}</dd></div><div><dt>能力</dt><dd>{treasure.abilities[0].name}：{treasure.abilities[0].effect}</dd></div><div><dt>代價</dt><dd>{treasure.cost}</dd></div></dl>
                    <div className={styles.catalogActions}><button className={styles.primary} type="button" disabled={busy} onClick={() => void saveTreasureCandidate(treasure)}>{saved ? "更新全域寶物快照" : "保存到全域寶物總庫"}</button><button type="button" disabled={!saved} onClick={() => saved && editSavedCatalogMemory(saved)}>編輯已保存資料</button><button type="button" disabled={!saved || busy} onClick={() => saved && void copyRecord(saved)}>複製候選到作品</button></div>
                  </article>
                );
              })}
              {visibleTreasures.length === 0 ? <p className={styles.empty}>本頁沒有符合這個類型或關鍵字的寶物。可換頁或清除篩選。</p> : null}
            </div>
            <div className={styles.pager}><button type="button" disabled={!treasurePage.hasPreviousPage} onClick={() => setTreasurePageIndex(Math.max(0, treasurePageIndex - 1))}>上一頁寶物</button><span>{treasurePageIndex * 24 + 1}–{Math.min(100_000, treasurePageIndex * 24 + 24)} / 100,000</span><button type="button" disabled={!treasurePage.hasNextPage} onClick={() => setTreasurePageIndex(treasurePageIndex + 1)}>下一頁寶物</button></div>
          </section>
        </section>
      ) : null}

      {loaded && tab === "worlds" ? (
        <section className={styles.workspace} data-testid="global-canon-worlds">
          <section className={styles.worldExplorer}>
            <header><div><small>100,000 STABLE WORLDS</small><h2>十萬世界索引</h2><p>固定編號、固定內容；只顯示與該時代、制度、科技和魔法規則相容的題材。</p></div><strong>{indexedWorld.displayId}</strong></header>
            <form className={styles.worldJump} onSubmit={(event) => { event.preventDefault(); navigateWorld(Number.parseInt(String(new FormData(event.currentTarget).get("world") || "1"), 10)); }}>
              <label>世界編號<input key={indexedWorld.ordinal} name="world" type="number" min="1" max="100000" defaultValue={indexedWorld.ordinal} /></label><button type="submit">前往世界</button>
            </form>
            <article className={styles.worldDetail}>
              <div><span>{indexedWorld.classification.name}</span><span>{indexedWorld.eraLabel}</span><span>{indexedWorld.primaryTopic.topicName}</span></div>
              <h3>{indexedWorld.title}</h3><p>{indexedWorld.logline}</p>
              <dl><div><dt>時代</dt><dd>{indexedWorld.blueprint.period}</dd></div><div><dt>科技</dt><dd>{indexedWorld.blueprint.technology}</dd></div><div><dt>超常規則</dt><dd>{indexedWorld.blueprint.magic}</dd></div><div><dt>制度</dt><dd>{indexedWorld.blueprint.institutions.join("、")}</dd></div></dl>
              <details><summary>查看時空把關與 {indexedWorld.compatibleTopicCount} 類相容題材</summary><p>{indexedWorld.guard.statement}</p><ul>{indexedWorld.blueprint.canonRules.map((rule) => <li key={rule}>{rule}</li>)}</ul><p>題材預覽：{indexedWorld.compatibleTopicPreview.map((topic) => topic.topicName).join("、")}</p></details>
              <button className={styles.primary} type="button" onClick={() => void saveIndexedWorld()} disabled={busy}>{library.worlds.some((item) => item.catalogWorldNumber === indexedWorld.ordinal) ? "更新已保存世界" : "保存到全域世界總庫"}</button>
            </article>
            <div className={styles.worldTiles}>{indexedWorldPage.items.map((world) => <button type="button" key={world.id} aria-current={world.ordinal === indexedWorld.ordinal ? "true" : undefined} onClick={() => navigateWorld(world.ordinal)}><b>{world.displayId}</b><span>{world.classification.name} · {world.eraLabel}</span><small>{world.primaryTopic.topicName}</small></button>)}</div>
            <div className={styles.pager}><button type="button" disabled={!indexedWorldPage.hasPreviousPage} onClick={() => navigateWorld(Math.max(1, indexedWorldPage.offset - 11))}>上一頁世界</button><span>{indexedWorldPage.offset + 1}–{indexedWorldPage.offset + indexedWorldPage.items.length} / {indexedWorldPage.totalItems.toLocaleString("zh-TW")}</span><button type="button" disabled={!indexedWorldPage.hasNextPage} onClick={() => navigateWorld(indexedWorldPage.offset + 13)}>下一頁世界</button></div>
          </section>

          <form className={styles.editor} onSubmit={(event) => void saveWorld(event)}>
            <header><div><small>CUSTOM WORLD</small><h2>{editingWorld ? `編輯 ${editingWorld.name}` : "建立自訂世界"}</h2></div><span>跨時代必須寫明橋接機制</span></header>
            <div className={styles.formGrid}>
              <label>世界名稱<input required value={worldDraft.name} onChange={(event) => setWorldDraft({ ...worldDraft, name: event.target.value })} /></label>
              <label>世界分類<input required value={worldDraft.classificationLabel} onChange={(event) => setWorldDraft({ ...worldDraft, classificationLabel: event.target.value, classificationId: event.target.value.trim() || "custom-world" })} /></label>
              <label>時代<select value={worldDraft.eraContext} onChange={(event) => setWorldDraft({ ...worldDraft, eraContext: event.target.value as GlobalCanonEraContext })}>{ERA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label>時代名稱<input required value={worldDraft.eraLabel} onChange={(event) => setWorldDraft({ ...worldDraft, eraLabel: event.target.value })} /></label>
              <label className={styles.wide}>世界摘要<textarea required value={worldDraft.summary} onChange={(event) => setWorldDraft({ ...worldDraft, summary: event.target.value })} /></label>
              {worldDraft.eraContext === "cross-era" ? <label className={styles.wide}>跨時代 Canon 橋接規則<textarea required value={worldDraft.crossEraBridge} onChange={(event) => setWorldDraft({ ...worldDraft, crossEraBridge: event.target.value })} placeholder="例：只有通過天文台的單向時門，且每次只能攜帶一件當代物品。" /></label> : null}
            </div>
            <div className={styles.formActions}><button className={styles.primary} disabled={busy} type="submit">{editingWorld ? "保存世界修改" : "加入自訂世界"}</button>{editingWorld ? <button type="button" onClick={() => { setEditingWorld(null); setWorldDraft(EMPTY_WORLD); }}>取消編輯</button> : null}</div>
          </form>

          <section className={styles.libraryPanel}>
            <header><div><small>SAVED WORLDS</small><h2>已保存的全域世界</h2></div><span>{library.worlds.length} 個</span></header>
            <PagedRecords items={library.worlds} emptyText="從十萬世界索引保存固定世界，或建立自己的世界規則。" renderItem={(world) => <article className={styles.recordCard} key={world.id}><Revision value={world.revision} /><h3>{world.name}</h3><p>{world.classificationLabel} · {world.eraLabel}{world.catalogWorldNumber ? ` · 第${String(world.catalogWorldNumber).padStart(6, "0")}世界` : ""}</p><p className={styles.clamp}>{world.summary}</p>{world.crossEraBridge ? <p className={styles.bridge}>跨時代橋：{world.crossEraBridge}</p> : null}<footer><button type="button" onClick={() => editWorld(world)}>編輯</button><button type="button" onClick={() => void copyRecord(world)} disabled={busy}>複製候選</button><button className={styles.danger} type="button" onClick={() => void removeRecord(world)} disabled={busy}>刪除</button></footer></article>} />
          </section>
        </section>
      ) : null}

      {loaded && tab === "rules" ? (
        <section className={styles.workspace} data-testid="global-canon-rules">
          <form className={styles.editor} onSubmit={(event) => void saveRule(event)}><header><div><small>WORLD RULES</small><h2>{editingRule ? "編輯世界規則" : "建立世界規則"}</h2></div><span>規則不因故事方便而失效</span></header><div className={styles.formGrid}><label>規則名稱<input required value={ruleDraft.title} onChange={(event) => setRuleDraft({ ...ruleDraft, title: event.target.value })} /></label><label>適用時代代碼<input value={ruleDraft.eraContexts} onChange={(event) => setRuleDraft({ ...ruleDraft, eraContexts: event.target.value })} placeholder="modern、historical、future" /></label><label className={styles.wide}>規則內容<textarea required value={ruleDraft.description} onChange={(event) => setRuleDraft({ ...ruleDraft, description: event.target.value })} /></label><label className={styles.check}><input type="checkbox" checked={ruleDraft.immutable} onChange={(event) => setRuleDraft({ ...ruleDraft, immutable: event.target.checked })} />不可被故事自動改寫</label></div><div className={styles.formActions}><button className={styles.primary} disabled={busy} type="submit">{editingRule ? "保存規則" : "加入規則總庫"}</button>{editingRule ? <button type="button" onClick={() => { setEditingRule(null); setRuleDraft(EMPTY_RULE); }}>取消編輯</button> : null}</div></form>
          <RecordLibrary title="全域世界規則" items={library.rules} renderItem={(rule) => <article className={styles.recordCard} key={rule.id}><Revision value={rule.revision} /><h3>{rule.title}</h3><p>{rule.description}</p><p>{rule.immutable ? "固定規則" : "可由作者修訂"} · {rule.eraContexts.join("、") || "適用所有時代"}</p><footer><button type="button" onClick={() => editRule(rule)}>編輯</button><button type="button" onClick={() => void copyRecord(rule)} disabled={busy}>複製候選</button><button className={styles.danger} type="button" onClick={() => void removeRecord(rule)} disabled={busy}>刪除</button></footer></article>} />
        </section>
      ) : null}

      {loaded && tab === "memories" ? (
        <section className={styles.workspace} data-testid="global-canon-memories">
          <form className={styles.editor} onSubmit={(event) => void saveMemory(event)}><header><div><small>MEMORY & LORE</small><h2>{editingMemory ? "編輯記憶資料" : "建立記憶資料"}</h2></div><span>地點、組織、物件與祕密</span></header><div className={styles.formGrid}><label>資料類型<select value={memoryDraft.kind} onChange={(event) => setMemoryDraft({ ...memoryDraft, kind: event.target.value as GlobalMemoryKind })}><option value="location">地點</option><option value="faction">家族／宗門／企業</option><option value="item">武器／寶物／丹藥／藥草</option><option value="secret">祕密</option><option value="custom">其他</option></select></label><label>適用時代代碼<input value={memoryDraft.eraContexts} onChange={(event) => setMemoryDraft({ ...memoryDraft, eraContexts: event.target.value })} placeholder="modern、historical、cultivation" /></label><label className={styles.wide}>名稱<input required value={memoryDraft.title} onChange={(event) => setMemoryDraft({ ...memoryDraft, title: event.target.value })} /></label><label className={styles.wide}>完整資料<textarea required value={memoryDraft.content} onChange={(event) => setMemoryDraft({ ...memoryDraft, content: event.target.value })} /></label></div><div className={styles.formActions}><button className={styles.primary} disabled={busy} type="submit">{editingMemory ? "保存記憶" : "加入記憶總庫"}</button>{editingMemory ? <button type="button" onClick={() => { setEditingMemory(null); setMemoryDraft(EMPTY_MEMORY); }}>取消編輯</button> : null}</div></form>
          <RecordLibrary title="全域記憶與資料" items={library.memories} renderItem={(memory) => <article className={styles.recordCard} key={memory.id}><Revision value={memory.revision} /><h3>{memory.title}</h3><p>{memory.kind} · {memory.eraContexts.join("、") || "不限時代"}</p><p>{memory.content}</p><footer><button type="button" onClick={() => editMemory(memory)}>編輯</button><button type="button" onClick={() => void copyRecord(memory)} disabled={busy}>複製候選</button><button className={styles.danger} type="button" onClick={() => void removeRecord(memory)} disabled={busy}>刪除</button></footer></article>} />
        </section>
      ) : null}

      {loaded && tab === "storyBible" ? (
        <section className={styles.workspace} data-testid="global-canon-story-bibles">
          <form className={styles.editor} onSubmit={(event) => void saveStoryBible(event)}>
            <header><div><small>FORMAL STORY BIBLE</small><h2>{editingStoryBible ? `編輯 ${editingStoryBible.title}` : "建立全域 Story Bible"}</h2></div><span>故事法則、伏筆與作者偏好總表</span></header>
            <div className={styles.formGrid}>
              <label className={styles.wide}>名稱<input required value={storyBibleDraft.title} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, title: event.target.value })} /></label>
              <label>核心主題<input value={storyBibleDraft.theme} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, theme: event.target.value })} placeholder="例：權力必須付出可見代價" /></label>
              <label>敘事風格<input value={storyBibleDraft.style} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, style: event.target.value })} placeholder="例：近距離第三人稱、對白推進" /></label>
              <label className={styles.wide}>伏筆（頓號或換行分隔）<textarea value={storyBibleDraft.foreshadowing} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, foreshadowing: event.target.value })} /></label>
              <label>未解線索<textarea value={storyBibleDraft.unresolvedThreads} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, unresolvedThreads: event.target.value })} /></label>
              <label>已解線索<textarea value={storyBibleDraft.resolvedThreads} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, resolvedThreads: event.target.value })} /></label>
              <label className={styles.wide}>禁止矛盾<textarea value={storyBibleDraft.forbiddenContradictions} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, forbiddenContradictions: event.target.value })} placeholder="例：已死亡人物不得無橋接復活" /></label>
              <label className={styles.wide}>作者偏好<textarea value={storyBibleDraft.authorPreferences} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, authorPreferences: event.target.value })} placeholder="例：場景必須有具體行動與後果；避免系統摘要語氣" /></label>
            </div>
            {editingStoryBible ? <p className={styles.editorNote}>從作品匯入的角色、關係、世界與規則連結會原樣保留；這裡修改的是 Story Bible 本身，不會寫回來源作品。</p> : null}
            <div className={styles.formActions}><button className={styles.primary} disabled={busy} type="submit">{editingStoryBible ? "保存 Story Bible" : "加入 Story Bible 總庫"}</button>{editingStoryBible ? <button type="button" onClick={() => { setEditingStoryBible(null); setStoryBibleDraft(EMPTY_STORY_BIBLE); }}>取消編輯</button> : null}</div>
          </form>
          <RecordLibrary title="全域 Story Bible" items={library.storyBibles} renderItem={(storyBible) => <article className={styles.recordCard} key={storyBible.id}><Revision value={storyBible.revision} /><h3>{storyBible.title}</h3><p>{storyBible.theme || "核心主題待設定"}</p><p>{storyBible.style || "敘事風格待設定"}</p><dl><div><dt>人物</dt><dd>{storyBible.globalCharacterIds.length}</dd></div><div><dt>規則</dt><dd>{storyBible.globalWorldRuleIds.length}</dd></div><div><dt>伏筆</dt><dd>{storyBible.foreshadowing.length}</dd></div><div><dt>未解</dt><dd>{storyBible.unresolvedThreads.length}</dd></div></dl><footer><button type="button" onClick={() => editStoryBible(storyBible)}>編輯</button><button type="button" onClick={() => void copyStoryBible(storyBible)} disabled={busy}>整套複製為作品候選</button><button className={styles.danger} type="button" onClick={() => void removeStoryBible(storyBible)} disabled={busy}>刪除</button></footer></article>} />
        </section>
      ) : null}

      {loaded && tab === "timeline" ? (
        <section className={styles.workspace} data-testid="global-canon-timeline">
          <form className={styles.editor} onSubmit={(event) => void saveTimeline(event)}><header><div><small>TIMELINE TEMPLATES</small><h2>{editingTimeline ? "編輯時間線模板" : "建立時間線模板"}</h2></div><span>複製後仍由作品決定是否上場</span></header><div className={styles.formGrid}><label>事件名稱<input required value={timelineDraft.title} onChange={(event) => setTimelineDraft({ ...timelineDraft, title: event.target.value })} /></label><label>故事時間<input value={timelineDraft.storyTime} onChange={(event) => setTimelineDraft({ ...timelineDraft, storyTime: event.target.value })} placeholder="王朝曆 18 年冬、2038-05-07" /></label><label>時代<select value={timelineDraft.eraContext} onChange={(event) => setTimelineDraft({ ...timelineDraft, eraContext: event.target.value as GlobalCanonEraContext })}>{ERA_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>放置提示<input value={timelineDraft.placementHint} onChange={(event) => setTimelineDraft({ ...timelineDraft, placementHint: event.target.value })} placeholder="第一幕之前、主角成年後" /></label><label className={styles.wide}>事件內容<textarea required value={timelineDraft.summary} onChange={(event) => setTimelineDraft({ ...timelineDraft, summary: event.target.value })} /></label></div><div className={styles.formActions}><button className={styles.primary} disabled={busy} type="submit">{editingTimeline ? "保存時間線" : "加入時間線總庫"}</button>{editingTimeline ? <button type="button" onClick={() => { setEditingTimeline(null); setTimelineDraft(EMPTY_TIMELINE); }}>取消編輯</button> : null}</div></form>
          <RecordLibrary title="全域時間線模板" items={library.timelineTemplates} renderItem={(timeline) => <article className={styles.recordCard} key={timeline.id}><Revision value={timeline.revision} /><h3>{timeline.title}</h3><p>{timeline.storyTime || "故事時間待定"} · {timeline.eraContext}</p><p>{timeline.summary}</p>{timeline.placementHint ? <p>放置提示：{timeline.placementHint}</p> : null}<footer><button type="button" onClick={() => editTimeline(timeline)}>編輯</button><button type="button" onClick={() => void copyRecord(timeline)} disabled={busy}>複製候選</button><button className={styles.danger} type="button" onClick={() => void removeRecord(timeline)} disabled={busy}>刪除</button></footer></article>} />
        </section>
      ) : null}

      <footer className={styles.boundary}>
        <b>資料邊界</b><span>全域總庫 → 明確複製候選快照 → 作品內唯讀選擇上場。沒有任何一步會自動覆寫正在進行的故事。</span>
      </footer>
    </main>
  );
}

function RecordLibrary<T extends { id: string }>({ title, items, renderItem }: { title: string; items: readonly T[]; renderItem: (item: T) => ReactNode }) {
  return (
    <section className={styles.libraryPanel}>
      <header><div><small>SAVED GLOBAL RECORDS</small><h2>{title}</h2></div><span>{items.length} 筆</span></header>
      <PagedRecords items={items} renderItem={renderItem} emptyText="目前沒有資料。左側編輯器保存後會出現在這裡。" />
    </section>
  );
}

function PagedRecords<T extends { id: string }>({
  items,
  renderItem,
  emptyText,
  listClassName = styles.cardGrid,
}: {
  items: readonly T[];
  renderItem: (item: T) => ReactNode;
  emptyText: string;
  listClassName?: string;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / SAVED_RECORD_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * SAVED_RECORD_PAGE_SIZE;
  const visibleItems = items.slice(start, start + SAVED_RECORD_PAGE_SIZE);

  return (
    <>
      <div className={listClassName} data-page-size={SAVED_RECORD_PAGE_SIZE}>
        {visibleItems.map(renderItem)}
        {items.length === 0 ? <p className={styles.empty}>{emptyText}</p> : null}
      </div>
      {items.length > SAVED_RECORD_PAGE_SIZE ? (
        <nav className={styles.savedPager} aria-label="已保存資料分頁">
          <button type="button" disabled={safePage === 0} onClick={() => setPage(Math.max(0, safePage - 1))}>上一頁</button>
          <span>第 {safePage + 1} / {pageCount} 頁 · {start + 1}–{Math.min(start + SAVED_RECORD_PAGE_SIZE, items.length)} / {items.length}</span>
          <button type="button" disabled={safePage + 1 >= pageCount} onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}>下一頁</button>
        </nav>
      ) : null}
    </>
  );
}

function OrganizationHierarchyBranch({ branch }: { branch: StoryOrganizationHierarchyNode }) {
  return (
    <li className={styles.hierarchyBranch} data-node-kind={branch.kind}>
      <div><span>{branch.kind}</span><b>{branch.label}</b><small>在籍 {branch.currentMemberCount.toLocaleString("zh-TW")}／編制 {branch.memberCapacity.toLocaleString("zh-TW")}</small></div>
      {branch.roles.length ? <p><strong>職位</strong><span>{branch.roles.join("、")}</span></p> : null}
      {branch.assets.length ? <p><strong>資產</strong><span>{branch.assets.join("、")}</span></p> : null}
      {branch.children.length ? <ul>{branch.children.map((child) => <OrganizationHierarchyBranch key={child.nodeId} branch={child} />)}</ul> : null}
    </li>
  );
}

function OrganizationMemberCard({ member }: { member: StoryOrganizationMember }) {
  return (
    <article className={styles.memberCard}>
      <small>{member.organizationFaction}</small>
      <h5>{member.name}</h5>
      <p>{member.organizationRank}</p>
      <dl><div><dt>峰堂／部門</dt><dd>{member.organizationUnit}</dd></div><div><dt>位置</dt><dd>{member.location}</dd></div></dl>
    </article>
  );
}

function GenealogyMemberCard({
  member,
  position,
  resolveName,
}: {
  member: StoryOrganizationMember;
  position: FamilyGenealogyPosition;
  resolveName: (offset: number) => string;
}) {
  return (
    <article className={styles.genealogyCard} data-lineage-role={position.lineageRole}>
      <small>{position.generationLabel} · {position.branchLabel} · {position.lineageRole === "bloodline" ? "血親" : "配偶"}</small>
      <h5>{member.name}</h5>
      <p>{member.organizationRank} · {member.organizationUnit}</p>
      <dl>
        <div><dt>父母</dt><dd>{position.parentMemberOffsets.length ? position.parentMemberOffsets.map(resolveName).join("、") : "始祖／外姓入譜"}</dd></div>
        <div><dt>配偶</dt><dd>{position.spouseMemberOffset === null ? "尚未入譜" : resolveName(position.spouseMemberOffset)}</dd></div>
        <div><dt>手足</dt><dd>{position.siblingMemberOffsets.length ? position.siblingMemberOffsets.map(resolveName).join("、") : "無同譜手足"}</dd></div>
        <div><dt>子女</dt><dd>{position.childMemberOffsets.length ? `${position.childMemberOffsets.length} 人：${position.childMemberOffsets.map(resolveName).join("、")}` : "尚無入譜子女"}</dd></div>
      </dl>
    </article>
  );
}
