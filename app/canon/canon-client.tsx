"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHARACTER_PORTRAIT_THEME_OPTIONS,
  characterPortraitBaseIdentity,
  filterCharacterPortraitPickerCatalog,
} from "@/lib/novel-ai/character-portraits/catalog";
import { suggestedCatalogCharacterPortrait } from "@/lib/novel-ai/character-portraits/assignment";
import type { Character, CharacterPortrait, CharacterPortraitAsset, NovelProject } from "@/lib/novel-ai/domain";
import {
  characterMasteryProfileAt,
  type CharacterMasteryProfile,
} from "@/lib/novel-ai/game/character-mastery-library";
import {
  GLOBAL_WORLD_CLASSIFICATIONS,
  type GlobalIndexedWorld,
  type GlobalIndexedWorldSummary,
} from "@/lib/novel-ai/game/global-world-index";
import { PROCEDURAL_TREASURE_KIND_DEFINITIONS, type ProceduralTreasureKind } from "@/lib/novel-ai/game/procedural-treasure-classification";
import { createProceduralTreasureLibrary, type ProceduralTreasureRecord } from "@/lib/novel-ai/game/procedural-treasure-library";
import { proceduralTreasureVisualCssVariables } from "@/lib/novel-ai/game/procedural-treasure-visual";
import {
  copyGlobalCanonToProject,
  copyGlobalStoryBibleToProject,
  createGlobalCharacterFromCatalog,
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
  createGlobalCatalogCharacterAbilityProfile,
  createGlobalPersonalHeroAbilityProfile,
  DEFAULT_GLOBAL_PERSONAL_HERO_ABILITIES,
  GLOBAL_CHARACTER_CATALOG_CAPACITY,
  GLOBAL_CHARACTER_CATALOG_PAGE_SIZE,
  GLOBAL_CHARACTER_ABILITY_KEYS,
  GLOBAL_CHARACTER_ABILITY_LABELS,
  GLOBAL_PERSONAL_HERO_ABILITY_MAX,
  GLOBAL_PERSONAL_HERO_ABILITY_MIN,
  globalCharacterAbilitySummary,
  globalCatalogCharacterAbilitySummary,
  globalCatalogCharacterId,
  globalCatalogCharacterNumber,
  importProjectCanonToGlobal,
  type GlobalCanonEraContext,
  type GlobalCanonRecord,
  type GlobalCanonStoreName,
  type GlobalCharacter,
  type GlobalCharacterAbilityKey,
  type GlobalCharacterRelationship,
  type GlobalMemory,
  type GlobalMemoryKind,
  type GlobalStoryBible,
  type GlobalTimelineTemplate,
  type GlobalWorld,
  type GlobalWorldRule,
} from "@/lib/novel-ai/global-canon";
import {
  attachGlobalWorldRule,
  formatGlobalWorldCatalogNumber,
  globalWorldRulesFor,
  nextCustomGlobalWorldNumber,
} from "@/lib/novel-ai/global-canon/world-rule-workspace";
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
  type SocialMatrixCharacter,
} from "@/lib/novel-ai/social-matrix";
import PortraitCrop from "./portrait-crop";
import styles from "./canon.module.css";

type CanonTab = "characters" | "relationships" | "organizations" | "treasures" | "worlds" | "memories" | "storyBible" | "timeline";
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

type HeroAbilityDraft = Record<GlobalCharacterAbilityKey, string>;

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
  eraContext: GlobalCanonEraContext | "";
  eraLabel: string;
  summary: string;
  crossEraBridge: string;
  foundingRuleTitle: string;
  foundingRuleDescription: string;
  foundingRuleImmutable: boolean;
};

type RuleDraft = {
  globalWorldId: string;
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
const TREASURE_CATALOG_PAGE_SIZE = 24;

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

function personalHeroAbilityDraft(
  stats: Record<GlobalCharacterAbilityKey, number> = DEFAULT_GLOBAL_PERSONAL_HERO_ABILITIES,
): HeroAbilityDraft {
  return Object.fromEntries(
    GLOBAL_CHARACTER_ABILITY_KEYS.map((key) => [key, String(stats[key])]),
  ) as HeroAbilityDraft;
}

function systemCatalogCharacterAbilityStats(character: GlobalCharacter) {
  if (character.abilityProfile?.source === "system_catalog") return character.abilityProfile.stats;
  const parsed = Object.fromEntries(GLOBAL_CHARACTER_ABILITY_KEYS.map((key) => {
    const label = GLOBAL_CHARACTER_ABILITY_LABELS[key];
    const match = character.capabilities
      .map((capability) => capability.match(new RegExp(`^${label}\\s+(-?\\d+(?:\\.\\d+)?)\\/100$`, "u")))
      .find(Boolean);
    return [key, match ? Number(match[1]) : 0];
  })) as Record<GlobalCharacterAbilityKey, number>;
  return parsed;
}

function editableCharacterAbilityStats(character: GlobalCharacter) {
  if (character.provenance.origin === "system_catalog") return systemCatalogCharacterAbilityStats(character);
  return character.abilityProfile?.stats ?? DEFAULT_GLOBAL_PERSONAL_HERO_ABILITIES;
}

const EMPTY_RELATIONSHIP: RelationshipDraft = {
  fromId: "",
  toId: "",
  kind: "盟友",
  summary: "",
  trust: "",
};

const EMPTY_WORLD: WorldDraft = {
  name: "",
  classificationId: "",
  classificationLabel: "",
  eraContext: "",
  eraLabel: "",
  summary: "",
  crossEraBridge: "",
  foundingRuleTitle: "",
  foundingRuleDescription: "",
  foundingRuleImmutable: true,
};

const EMPTY_RULE: RuleDraft = { globalWorldId: "", title: "", description: "", immutable: true, eraContexts: "" };
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
const EMPTY_CHARACTER_MASTERIES: Partial<Record<number, CharacterMasteryProfile>> = {};

const ERA_OPTIONS: Array<{ value: GlobalCanonEraContext; label: string }> = [
  { value: "modern", label: "現代" },
  { value: "historical", label: "歷史／古代" },
  { value: "cultivation", label: "修仙／架空修行" },
  { value: "future", label: "未來" },
  { value: "cross-era", label: "跨時代（必須寫橋接規則）" },
  { value: "other", label: "其他架空世界" },
];

const TAB_LABELS: Array<{ id: CanonTab; label: string; short: string }> = [
  { id: "characters", label: "十萬人物與總庫", short: "人物" },
  { id: "relationships", label: "關係網", short: "關係" },
  { id: "organizations", label: "組織與祖譜", short: "組織" },
  { id: "treasures", label: "寶物圖鑑", short: "寶物" },
  { id: "worlds", label: "十萬世界與世界規則", short: "世界" },
  { id: "memories", label: "記憶與資料", short: "記憶" },
  { id: "storyBible", label: "Story Bible 防矛盾總綱", short: "總綱" },
  { id: "timeline", label: "事件時間線與模板", short: "時間線" },
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

function catalogCharacterPortraitForWorld(
  world: GlobalIndexedWorld,
  character: SocialMatrixCharacter,
  matrix: DeterministicSocialMatrix,
): CharacterPortraitAsset {
  // Organization and genealogy views enrich a member's role/name for that
  // surface. Always derive the portrait from the canonical population record
  // so the same person keeps the same face in every view.
  const canonicalCharacter = matrix.getCharacter(character.populationIndex);
  const signal = [
    world.classification.name,
    world.eraLabel,
    world.primaryTopic.topicName,
    world.logline,
    canonicalCharacter.name,
    canonicalCharacter.pronouns,
    canonicalCharacter.age,
    canonicalCharacter.lifeStage,
    canonicalCharacter.identity,
    canonicalCharacter.institutionRole,
    canonicalCharacter.familyRole,
    canonicalCharacter.storyAffinity,
    ...canonicalCharacter.personality.traits,
    ...canonicalCharacter.abilities.specialties,
  ].filter(Boolean).join("｜");
  return suggestedCatalogCharacterPortrait({
    stableId: `${world.id}:${canonicalCharacter.characterId}`,
    signal,
    diversityOrdinal: canonicalCharacter.populationIndex,
    diversityScope: world.id,
  });
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

function indexedWorldRuleTitle(description: string, index: number) {
  const leadingClause = description.split(/[：。]/u)[0]?.trim();
  return leadingClause || `世界法則 ${index + 1}`;
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
  const [expandedEditors, setExpandedEditors] = useState({
    character: true,
    world: true,
    memory: true,
  });

  const [characterDraft, setCharacterDraft] = useState<CharacterDraft>(EMPTY_CHARACTER);
  const [heroAbilityDraft, setHeroAbilityDraft] = useState<HeroAbilityDraft>(() => personalHeroAbilityDraft());
  const [editingCharacter, setEditingCharacter] = useState<GlobalCharacter | null>(null);
  const [portrait, setPortrait] = useState<CharacterPortraitAsset | CharacterPortrait | null>(null);
  const [portraitQuery, setPortraitQuery] = useState("");
  const [portraitTheme, setPortraitTheme] = useState("all");
  const [portraitPage, setPortraitPage] = useState(0);
  const [characterCatalogPageIndex, setCharacterCatalogPageIndex] = useState(0);
  const [characterCatalogQuery, setCharacterCatalogQuery] = useState("");
  const [characterCatalogOrdinal, setCharacterCatalogOrdinal] = useState("1");
  const [focusedCharacterIndex, setFocusedCharacterIndex] = useState<number | null>(null);
  const [characterFocusRequest, setCharacterFocusRequest] = useState(0);
  const [characterMasteryBatch, setCharacterMasteryBatch] = useState<{
    key: string;
    profiles: Partial<Record<number, CharacterMasteryProfile>>;
  }>({ key: "", profiles: {} });

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
  const [selectedOrganizationMember, setSelectedOrganizationMember] = useState<StoryOrganizationMember | null>(null);
  const organizationMemberTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [organizationMemberPageIndex, setOrganizationMemberPageIndex] = useState(0);
  const [familyGeneration, setFamilyGeneration] = useState(0);
  const [familyBranch, setFamilyBranch] = useState<1 | 2 | 3 | null>(null);
  const [familyPageIndex, setFamilyPageIndex] = useState(0);
  const [treasurePageIndex, setTreasurePageIndex] = useState(0);
  const [treasureKind, setTreasureKind] = useState<"all" | ProceduralTreasureKind>("all");
  const [treasureQuery, setTreasureQuery] = useState("");

  const filteredPortraits = useMemo(
    () => filterCharacterPortraitPickerCatalog({ themeId: portraitTheme, query: portraitQuery }),
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

  const characterCatalogPageCount = Math.ceil(
    organizationCatalog.matrix.populationSize / GLOBAL_CHARACTER_CATALOG_PAGE_SIZE,
  );
  const safeCharacterCatalogPage = Math.min(characterCatalogPageIndex, characterCatalogPageCount - 1);
  const characterCatalogPage = useMemo(() => organizationCatalog.matrix.listCharacters({
    cursor: `characters:${safeCharacterCatalogPage * GLOBAL_CHARACTER_CATALOG_PAGE_SIZE}`,
    limit: GLOBAL_CHARACTER_CATALOG_PAGE_SIZE,
  }), [organizationCatalog.matrix, safeCharacterCatalogPage]);
  const catalogCharacterRows = useMemo(() => characterCatalogPage.items.map((character) => ({
    character,
    portrait: catalogCharacterPortraitForWorld(indexedWorld, character, organizationCatalog.matrix),
  })), [characterCatalogPage.items, indexedWorld, organizationCatalog.matrix]);
  const characterMasteryBatchKey = `${indexedWorld.id}:${safeCharacterCatalogPage}`;
  const catalogCharacterMasteries = characterMasteryBatch.key === characterMasteryBatchKey
    ? characterMasteryBatch.profiles
    : EMPTY_CHARACTER_MASTERIES;
  const characterMasteryLoadedCount = Object.keys(catalogCharacterMasteries).length;

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let cursor = 0;
    const items = characterCatalogPage.items;

    const calculateNextPair = () => {
      if (cancelled) return;
      const profiles: Record<number, CharacterMasteryProfile> = {};
      const stop = Math.min(items.length, cursor + 2);
      while (cursor < stop) {
        const character = items[cursor];
        profiles[character.populationIndex] = characterMasteryProfileAt({
          storySeed: organizationCatalog.matrix.seed,
          populationIndex: character.populationIndex,
          context: organizationCatalog.context,
          socialMatrix: organizationCatalog.matrix,
        });
        cursor += 1;
      }
      if (cancelled) return;
      setCharacterMasteryBatch((current) => ({
        key: characterMasteryBatchKey,
        profiles: current.key === characterMasteryBatchKey
          ? { ...current.profiles, ...profiles }
          : profiles,
      }));
      if (cursor < items.length) frame = window.requestAnimationFrame(calculateNextPair);
    };

    frame = window.requestAnimationFrame(calculateNextPair);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [characterCatalogPage.items, characterMasteryBatchKey, organizationCatalog.context, organizationCatalog.matrix]);

  useEffect(() => {
    if (focusedCharacterIndex === null) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-character-index="${focusedCharacterIndex}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [characterFocusRequest, focusedCharacterIndex, indexedWorld.id, safeCharacterCatalogPage]);

  const visibleCatalogCharacterRows = useMemo(() => {
    const query = characterCatalogQuery.normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
    if (!query) return catalogCharacterRows;
    return catalogCharacterRows.filter(({ character }) => {
      const mastery = catalogCharacterMasteries[character.populationIndex];
      return [
      globalCatalogCharacterNumber(character.populationIndex),
      character.name,
      character.identity,
      character.institutionRole,
      character.familyRole,
      character.location,
      character.goal,
      character.storyAffinity,
      ...character.personality.traits,
      ...character.abilities.specialties,
      mastery?.storyEraLabel ?? "",
      ...(mastery?.assignments ?? []).flatMap((assignment) => [
        assignment.relationLabel,
        assignment.catalogLabel,
        assignment.name,
      ]),
      ].join("｜").normalize("NFKC").toLocaleLowerCase("zh-TW").includes(query);
    });
  }, [catalogCharacterMasteries, catalogCharacterRows, characterCatalogQuery]);

  const filteredOrganizations = useMemo(() => {
    const query = organizationQuery.normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
    if (!query) return organizationCatalog.directory;
    return organizationCatalog.directory.filter((organization) => [
      organization.name,
      organization.kindLabel,
      organization.sizeLabel,
      organization.territory,
      organization.doctrine,
      organization.specializationLabel,
      ...organization.relationships.flatMap((relationship) => [relationship.kindLabel, relationship.publicStance]),
    ].join("｜").normalize("NFKC").toLocaleLowerCase("zh-TW").includes(query));
  }, [organizationCatalog.directory, organizationQuery]);

  const selectedOrganization = filteredOrganizations.find(
    (organization) => organization.organizationId === selectedOrganizationId,
  ) ?? filteredOrganizations[0] ?? organizationCatalog.directory[0] ?? null;
  const organizationById = useMemo(() => new Map(
    organizationCatalog.directory.map((organization) => [organization.organizationId, organization]),
  ), [organizationCatalog.directory]);

  const organizationMembers = useMemo(() => selectedOrganization
    ? organizationMemberPage({
      matrix: organizationCatalog.matrix,
      organization: selectedOrganization,
      page: organizationMemberPageIndex,
      pageSize: 12,
    })
    : null, [organizationCatalog.matrix, organizationMemberPageIndex, selectedOrganization]);

  const selectedOrganizationMemberPortrait = useMemo(() => selectedOrganizationMember
    ? catalogCharacterPortraitForWorld(indexedWorld, selectedOrganizationMember, organizationCatalog.matrix)
    : null, [indexedWorld, organizationCatalog.matrix, selectedOrganizationMember]);
  const selectedOrganizationMemberMastery = useMemo(() => selectedOrganizationMember
    ? characterMasteryProfileAt({
      storySeed: organizationCatalog.matrix.seed,
      populationIndex: selectedOrganizationMember.populationIndex,
      context: organizationCatalog.context,
      socialMatrix: organizationCatalog.matrix,
    })
    : null, [organizationCatalog.context, organizationCatalog.matrix, selectedOrganizationMember]);

  useEffect(() => {
    if (!selectedOrganizationMember) return;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleDialogKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedOrganizationMember(null);
        window.requestAnimationFrame(() => organizationMemberTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>('[data-testid="global-organization-member-detail"]');
      const focusable = dialog
        ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
          .filter((element) => element.getClientRects().length > 0)
        : [];
      if (!dialog || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeyboard);
    return () => {
      window.removeEventListener("keydown", handleDialogKeyboard);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [selectedOrganizationMember]);

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
    () => treasureKind === "all"
      ? treasureCatalog.page(treasurePageIndex, TREASURE_CATALOG_PAGE_SIZE)
      : treasureCatalog.pageByKind(treasureKind, treasurePageIndex, TREASURE_CATALOG_PAGE_SIZE),
    [treasureCatalog, treasureKind, treasurePageIndex],
  );
  const visibleTreasures = useMemo(() => {
    const query = treasureQuery.normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
    return treasurePage.items.filter((treasure) => {
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
  }, [treasurePage.items, treasureQuery]);
  const treasurePageResultStart = treasurePageIndex * TREASURE_CATALOG_PAGE_SIZE + 1;
  const treasurePageResultEnd = Math.min(
    treasurePage.totalItems,
    treasurePageResultStart + treasurePage.items.length - 1,
  );
  const treasureKindLabel = treasureKind === "all"
    ? ""
    : PROCEDURAL_TREASURE_KIND_DEFINITIONS.find((definition) => definition.id === treasureKind)?.label ?? treasureKind;
  const treasureFirstGlobalNumber = (treasurePage.items[0]?.ordinal ?? 0) + 1;
  const treasureLastGlobalNumber = (treasurePage.items.at(-1)?.ordinal ?? 0) + 1;
  const treasurePageRangeLabel = treasureKind === "all"
    ? `${treasurePageResultStart.toLocaleString("zh-TW")}–${treasurePageResultEnd.toLocaleString("zh-TW")} / ${treasurePage.totalItems.toLocaleString("zh-TW")}`
    : `${treasureKindLabel}第 ${treasurePageResultStart.toLocaleString("zh-TW")}–${treasurePageResultEnd.toLocaleString("zh-TW")} 件 / ${treasurePage.totalItems.toLocaleString("zh-TW")} · 原始編號 #${String(treasureFirstGlobalNumber).padStart(6, "0")}–#${String(treasureLastGlobalNumber).padStart(6, "0")}`;

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
    if (record.recordType === "world" && globalWorldRulesFor(library.rules, record.id).length > 0) {
      setMessageKind("error");
      setMessage("這個世界仍有已歸檔的世界規則；請先刪除相關規則，避免留下孤立規則。");
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

  function openOrganizationMemberDetail(member: StoryOrganizationMember, trigger: HTMLButtonElement) {
    organizationMemberTriggerRef.current = trigger;
    setSelectedOrganizationMember(member);
  }

  function closeOrganizationMemberDetail() {
    setSelectedOrganizationMember(null);
    window.requestAnimationFrame(() => organizationMemberTriggerRef.current?.focus());
  }

  async function saveCharacter(event: FormEvent) {
    event.preventDefault();
    if (!characterDraft.name.trim()) {
      setMessageKind("error");
      setMessage("人物姓名不能留白。");
      return;
    }
    await perform(async () => {
      const abilityProfile = editingCharacter?.provenance.origin === "system_catalog"
        ? editingCharacter.abilityProfile ?? createGlobalCatalogCharacterAbilityProfile(systemCatalogCharacterAbilityStats(editingCharacter))
        : createGlobalPersonalHeroAbilityProfile(Object.fromEntries(
            GLOBAL_CHARACTER_ABILITY_KEYS.map((key) => [key, heroAbilityDraft[key].trim() ? Number(heroAbilityDraft[key]) : Number.NaN]),
          ) as Record<GlobalCharacterAbilityKey, number>);
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
        abilityProfile,
        portrait: approvedPortrait(portrait),
      }, editingCharacter ? {} : {
        provenance: {
          origin: "author",
          sourceLabel: "個人英雄（手動建立）",
          rightsBasis: "作者手動建立的原創個人英雄",
        },
      });
      const record = keepRecordBase(created, editingCharacter);
      await globalRepository.put("characters", record, editingCharacter?.revision ?? 0);
      setCharacterDraft(EMPTY_CHARACTER);
      setHeroAbilityDraft(personalHeroAbilityDraft());
      setEditingCharacter(null);
      setPortrait(null);
    }, editingCharacter ? "人物資料已更新；作品中的既有快照不會被暗中改寫。" : "個人英雄已加入跨作品總庫；能力可高於系統候選，但尚未複製到作品或自動上場。");
  }

  async function saveCatalogCharacter(
    character: SocialMatrixCharacter,
    portrait: CharacterPortraitAsset,
    mastery: CharacterMasteryProfile,
  ) {
    const created = createGlobalCharacterFromCatalog({
      character,
      portrait: approvedPortrait(portrait)!,
      world: indexedWorld,
      mastery,
    });
    await perform(async () => {
      await globalRepository.put("characters", created, 0);
    }, `${globalCatalogCharacterNumber(character.populationIndex)}「${character.name}」已保存為可編輯的全域正式人物；尚未複製到作品，也沒有自動上場。`);
  }

  function editCharacter(character: GlobalCharacter) {
    setExpandedEditors((current) => ({ ...current, character: true }));
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
    setHeroAbilityDraft(personalHeroAbilityDraft(
      editableCharacterAbilityStats(character),
    ));
    setPortrait(character.portrait);
    window.requestAnimationFrame(() => {
      document.getElementById("global-character-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
      const worldRecord = keepRecordBase(created, current);
      const ruleWrites = indexedWorld.blueprint.canonRules.map((description, index) => {
        const id = `global-indexed-world-rule:${indexedWorld.id}:${index + 1}`;
        const currentRule = library.rules.find((rule) => rule.id === id) ?? null;
        const createdRule = attachGlobalWorldRule(createGlobalWorldRule({
          title: indexedWorldRuleTitle(description, index),
          description,
          immutable: true,
          eraContexts: [worldRecord.eraContext],
          appliesToGlobalWorldIds: currentRule?.appliesToGlobalWorldIds ?? [],
        }, {
          id,
          provenance: {
            origin: "system_catalog",
            sourceLabel: `${indexedWorld.displayId}世界規則`,
            sourceId: indexedWorld.id,
          },
        }), worldRecord);
        return {
          store: "rules" as const,
          record: keepRecordBase(createdRule, currentRule),
          expectedRevision: currentRule?.revision ?? 0,
        };
      });
      await globalRepository.putBatch([
        { store: "worlds", record: worldRecord, expectedRevision: current?.revision ?? 0 },
        ...ruleWrites,
      ]);
      setRuleDraft((draft) => ({ ...draft, globalWorldId: worldRecord.id }));
    }, current
      ? `${indexedWorld.displayId}的世界、小說類型、時空背景與規則快照已一起更新。`
      : `${indexedWorld.displayId}的世界與規則已一起保存；不會自動加入任何作品。`);
  }

  async function saveWorld(event: FormEvent) {
    event.preventDefault();
    const selectedEra = worldDraft.eraContext;
    if (!worldDraft.name.trim()) {
      setMessageKind("error");
      setMessage("世界名稱不能留白。");
      return;
    }
    if (!worldDraft.classificationId || !worldDraft.classificationLabel.trim()) {
      setMessageKind("error");
      setMessage("建立世界前，必須先選擇小說類型／世界分類。");
      return;
    }
    if (!selectedEra || !worldDraft.eraLabel.trim()) {
      setMessageKind("error");
      setMessage("建立世界前，必須先選擇時代並寫明時空背景。");
      return;
    }
    if (!editingWorld && (!worldDraft.foundingRuleTitle.trim() || !worldDraft.foundingRuleDescription.trim())) {
      setMessageKind("error");
      setMessage("建立新世界時，第一條世界規則的名稱與內容都必填；規則會和新世界一起保存。");
      return;
    }
    const assignedWorldNumber = editingWorld
      ? editingWorld.catalogWorldNumber
      : nextCustomGlobalWorldNumber(library.worlds);
    await perform(async () => {
      const created = createGlobalWorld({
        name: worldDraft.name,
        classificationId: worldDraft.classificationId,
        classificationLabel: worldDraft.classificationLabel,
        eraContext: selectedEra,
        eraLabel: worldDraft.eraLabel,
        summary: worldDraft.summary,
        crossEraBridge: worldDraft.crossEraBridge,
        catalogWorldNumber: assignedWorldNumber,
        primaryTopicId: editingWorld?.primaryTopicId ?? null,
        compatibleTopicIds: editingWorld?.compatibleTopicIds ?? [],
      });
      const worldRecord = keepRecordBase(created, editingWorld);
      if (editingWorld) {
        await globalRepository.put("worlds", worldRecord, editingWorld.revision);
      } else {
        const foundingRule = attachGlobalWorldRule(createGlobalWorldRule({
          title: worldDraft.foundingRuleTitle,
          description: worldDraft.foundingRuleDescription,
          immutable: worldDraft.foundingRuleImmutable,
          eraContexts: [selectedEra],
        }), worldRecord);
        await globalRepository.putBatch([
          { store: "worlds", record: worldRecord, expectedRevision: 0 },
          { store: "rules", record: foundingRule, expectedRevision: 0 },
        ]);
        setRuleDraft((draft) => ({ ...draft, globalWorldId: worldRecord.id }));
      }
      setWorldDraft(EMPTY_WORLD);
      setEditingWorld(null);
    }, editingWorld
      ? "世界資料已更新；所屬規則與既有作品快照都維持原版本。"
      : `第${String(assignedWorldNumber).padStart(6, "0")}世界與第一條規則已一起加入全域總庫。`);
  }

  function editWorld(record: GlobalWorld) {
    setExpandedEditors((current) => ({ ...current, world: true }));
    setEditingWorld(record);
    setWorldDraft({
      name: record.name,
      classificationId: record.classificationId,
      classificationLabel: record.classificationLabel,
      eraContext: record.eraContext,
      eraLabel: record.eraLabel,
      summary: record.summary,
      crossEraBridge: record.crossEraBridge ?? "",
      foundingRuleTitle: "",
      foundingRuleDescription: "",
      foundingRuleImmutable: true,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveOrganizationCandidate(organization: StoryOrganizationDirectoryEntry) {
    const created = createGlobalOrganizationMemory({
      organization,
      organizationDirectory: organizationCatalog.directory,
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
    const targetWorld = library.worlds.find((world) => world.id === ruleDraft.globalWorldId) ?? null;
    if (!targetWorld) {
      setMessageKind("error");
      setMessage("世界規則不能單獨保存；請先保存或建立世界，再選擇這條規則所屬的世界。");
      return;
    }
    await perform(async () => {
      const created = attachGlobalWorldRule(createGlobalWorldRule({
        title: ruleDraft.title,
        description: ruleDraft.description,
        immutable: ruleDraft.immutable,
        eraContexts: splitList(ruleDraft.eraContexts) as GlobalCanonEraContext[],
        appliesToGlobalWorldIds: editingRule?.appliesToGlobalWorldIds ?? [],
      }), targetWorld);
      await globalRepository.put("rules", keepRecordBase(created, editingRule), editingRule?.revision ?? 0);
      setRuleDraft({ ...EMPTY_RULE, globalWorldId: targetWorld.id });
      setEditingRule(null);
    }, editingRule ? `「${targetWorld.name}」的世界規則已更新。` : `世界規則已歸檔到「${targetWorld.name}」。`);
  }

  function editRule(record: GlobalWorldRule) {
    setTab("worlds");
    setEditingRule(record);
    setRuleDraft({
      globalWorldId: record.appliesToGlobalWorldIds.find((id) => library.worlds.some((world) => world.id === id)) ?? "",
      title: record.title,
      description: record.description,
      immutable: record.immutable,
      eraContexts: record.eraContexts.join("、"),
    });
    window.requestAnimationFrame(() => {
      document.getElementById("global-world-rule-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
    setExpandedEditors((current) => ({ ...current, memory: true }));
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
        <Link prefetch={false} href="/" aria-label="回系統首頁">← 系統首頁</Link>
        <div><small>GLOBAL CANON LIBRARY · CROSS-PROJECT</small><h1>角色、世界與記憶總編輯</h1></div>
        <Link prefetch={false} href="/professional?intent=library" aria-label="前往作品管理中心">作品管理中心</Link>
      </header>

      <section className={styles.hero}>
        <div>
          <span>跨作品正式資料源</span>
          <h2>先在這裡建立世界，再讓故事選擇誰上場</h2>
          <p>人物能力、關係、世界規則、記憶與時間線都在全域總庫修改。複製到作品時只建立一份可選候選快照；故事工作台不能在暗中改值。</p>
        </div>
        <dl>
          <div><dt>人物索引</dt><dd>100,000</dd></div>
          <div><dt>正式人物</dt><dd>{library.characters.length}</dd></div>
          <div><dt>世界索引</dt><dd>100,000</dd></div>
          <div><dt>Story Bible</dt><dd>{library.storyBibles.length}</dd></div>
        </dl>
      </section>

      <section className={styles.copyBar} aria-label="複製候選快照到作品">
        <div><b>目標作品</b><span>只有按下資料卡的「複製候選」才會寫入；不自動上場。</span></div>
        <select data-testid="global-canon-target-project" value={targetProjectId} onChange={(event) => setTargetProjectId(event.target.value)} disabled={busy}>
          <option value="">尚未選擇作品</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
        {selectedProject ? <Link prefetch={false} href={`/studio/project/${encodeURIComponent(selectedProject.id)}/characters`}>到作品內唯讀選擇</Link> : <Link prefetch={false} href="/studio/create">建立作品</Link>}
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
          <section className={styles.libraryPanel} data-testid="global-character-index">
            <header>
              <div><small>100,000 ORIGINAL CHARACTERS · LAZY INDEX</small><h2>{indexedWorld.displayId}的十萬人物候選</h2></div>
              <span>完整 1–100,000 · 每次只計算 {GLOBAL_CHARACTER_CATALOG_PAGE_SIZE} 人</span>
            </header>
            <p className={styles.catalogNote}>這是原本的完整十萬人物引擎，不是組織名冊的子集；候選能力固定使用 0–100，已保存與未保存人物都會留在索引中，卡片只改變狀態，不會被隱藏。人物都符合目前世界的時代、制度與題材；只有你按下保存，才會成為可修改的全域正式人物。</p>
            <div className={styles.characterCatalogToolbar}>
              <form onSubmit={(event) => {
                event.preventDefault();
                const value = Number.parseInt(characterCatalogOrdinal, 10);
                const ordinal = Math.max(1, Math.min(GLOBAL_CHARACTER_CATALOG_CAPACITY, Number.isFinite(value) ? value : 1));
                setCharacterCatalogOrdinal(String(ordinal));
                setCharacterCatalogQuery("");
                setFocusedCharacterIndex(ordinal - 1);
                setCharacterFocusRequest((request) => request + 1);
                setCharacterCatalogPageIndex(Math.floor((ordinal - 1) / GLOBAL_CHARACTER_CATALOG_PAGE_SIZE));
              }}>
                <label>直接前往人物編號<input name="characterOrdinal" type="number" min="1" max={GLOBAL_CHARACTER_CATALOG_CAPACITY} value={characterCatalogOrdinal} onChange={(event) => setCharacterCatalogOrdinal(event.target.value)} /></label>
                <button type="submit">前往</button>
              </form>
              <label>篩選本批人物<input type="search" value={characterCatalogQuery} onChange={(event) => setCharacterCatalogQuery(event.target.value)} placeholder="姓名、職位、家族、地點、專長" /></label>
              <p>{indexedWorld.eraLabel} · {indexedWorld.classification.name}<br />{focusedCharacterIndex === null ? "切換「十萬世界」後，人物的職位、組織、能力與人像會隨世界種子固定重建。" : `已精確定位${globalCatalogCharacterNumber(focusedCharacterIndex)}；人物卡已標示並移入視野。`}</p>
            </div>
            <div className={styles.cardGrid} data-testid="global-character-candidate-grid" aria-busy={characterMasteryLoadedCount < characterCatalogPage.items.length}>
              {visibleCatalogCharacterRows.map(({ character, portrait }) => {
                const saved = library.characters.find((item) => item.id === globalCatalogCharacterId(indexedWorld.id, character.populationIndex)) ?? null;
                const mastery = catalogCharacterMasteries[character.populationIndex];
                const focused = focusedCharacterIndex === character.populationIndex;
                return (
                  <article className={styles.recordCard} key={character.characterId} data-testid="global-character-candidate" data-character-index={character.populationIndex} data-focused={focused} data-saved={Boolean(saved)} data-mastery-status={mastery ? "ready" : "loading"}>
                    <div className={styles.characterHeading}>
                      <PortraitCrop portrait={portrait} className={styles.cardPortrait} decorative />
                      <div><small className={styles.revision}>{globalCatalogCharacterNumber(character.populationIndex)}</small><h3>{character.name}</h3><p>{character.identity} · {character.age} 歲</p></div>
                    </div>
                    <p>{character.personality.traits.join("、")}；{character.personality.publicFace}</p>
                    <dl>
                      <div><dt>位置</dt><dd>{character.location}</dd></div>
                      <div><dt>家族</dt><dd>{character.familyRole}</dd></div>
                      <div><dt>組織</dt><dd>{character.institutionRole}</dd></div>
                      <div><dt>目標</dt><dd>{character.goal}</dd></div>
                      <div><dt>強項</dt><dd>{globalCatalogCharacterAbilitySummary(character)} · {character.abilities.powerTier}</dd></div>
                      <div><dt>專長</dt><dd>{character.abilities.specialties.join("、")}</dd></div>
                      <div><dt>時代能力</dt><dd>{mastery ? <>{mastery.storyEraLabel}{mastery.primaryElement ? ` · ${mastery.assignments[0]?.catalogLabel ?? "五行功法"}` : ""}</> : <span className={styles.masteryLoading}>首屏後分批建立中……</span>}</dd></div>
                      <div><dt>修習／持有</dt><dd>{mastery ? mastery.assignments.map((assignment) => `${assignment.relationLabel}${assignment.name}（熟練 ${assignment.proficiency}）`).join("；") : "尚未載入；不阻塞其他人物卡顯示。"}</dd></div>
                    </dl>
                    <footer>
                      {saved
                        ? <button type="button" onClick={() => editCharacter(saved)}>編輯已保存人物</button>
                        : <button className={styles.primary} type="button" disabled={busy || !mastery} onClick={() => mastery && void saveCatalogCharacter(character, portrait, mastery)}>{mastery ? "保存為正式人物" : "能力載入中……"}</button>}
                    </footer>
                  </article>
                );
              })}
              {!visibleCatalogCharacterRows.length ? <p className={styles.empty}>本批沒有符合篩選字詞的人物；請清除篩選或切換上一批／下一批。</p> : null}
            </div>
            <div className={styles.pager}>
              <button type="button" disabled={safeCharacterCatalogPage === 0} onClick={() => {
                const page = Math.max(0, safeCharacterCatalogPage - 1);
                setCharacterCatalogPageIndex(page);
                setCharacterCatalogOrdinal(String(page * GLOBAL_CHARACTER_CATALOG_PAGE_SIZE + 1));
                setFocusedCharacterIndex(null);
              }}>上一批人物</button>
              <span>{safeCharacterCatalogPage * GLOBAL_CHARACTER_CATALOG_PAGE_SIZE + 1}–{Math.min(GLOBAL_CHARACTER_CATALOG_CAPACITY, safeCharacterCatalogPage * GLOBAL_CHARACTER_CATALOG_PAGE_SIZE + characterCatalogPage.items.length)} / {GLOBAL_CHARACTER_CATALOG_CAPACITY.toLocaleString("zh-TW")}（第 {safeCharacterCatalogPage + 1} / {characterCatalogPageCount} 批）</span>
              <button type="button" disabled={safeCharacterCatalogPage + 1 >= characterCatalogPageCount} onClick={() => {
                const page = Math.min(characterCatalogPageCount - 1, safeCharacterCatalogPage + 1);
                setCharacterCatalogPageIndex(page);
                setCharacterCatalogOrdinal(String(page * GLOBAL_CHARACTER_CATALOG_PAGE_SIZE + 1));
                setFocusedCharacterIndex(null);
              }}>下一批人物</button>
            </div>
          </section>

          <form id="global-character-editor" className={styles.editor} data-collapsed={!expandedEditors.character} onSubmit={(event) => void saveCharacter(event)}>
            <header>
              <div><small>PERSONAL HERO · CHARACTER MASTER</small><h2>{editingCharacter ? `編輯 ${editingCharacter.name}` : "建立個人英雄（全域人物）"}</h2></div>
              <div className={styles.editorHeaderActions}>
                <span>{editingCharacter?.provenance.origin === "system_catalog" ? "系統候選快照 · 0–100" : `個人英雄能力 · 0–${GLOBAL_PERSONAL_HERO_ABILITY_MAX}`}</span>
                <button
                  className={styles.editorToggle}
                  type="button"
                  aria-expanded={expandedEditors.character}
                  aria-controls="global-character-editor-body"
                  data-testid="global-character-editor-toggle"
                  onClick={() => setExpandedEditors((current) => ({ ...current, character: !current.character }))}
                >
                  {expandedEditors.character ? "收合人物編輯器" : "展開人物編輯器"}
                </button>
              </div>
            </header>
            <div id="global-character-editor-body" className={styles.editorBody} hidden={!expandedEditors.character}>
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

            <fieldset className={styles.heroAbilityEditor} data-testid="global-personal-hero-abilities">
              <legend>{editingCharacter?.provenance.origin === "system_catalog" ? "系統候選原始能力快照" : "個人英雄能力值"}</legend>
              <p>{editingCharacter?.provenance.origin === "system_catalog"
                ? "這份已保存人物保留程序候選的 0–100 原始數值與來源；編輯文字資料不會回寫或改動十萬人物候選。若要創造更強角色，請另外建立個人英雄。"
                : `每項能力可填 ${GLOBAL_PERSONAL_HERO_ABILITY_MIN}–${GLOBAL_PERSONAL_HERO_ABILITY_MAX} 的整數，沒有共享點數預算；101–${GLOBAL_PERSONAL_HERO_ABILITY_MAX} 明確高於系統候選的 0–100 上限。`}</p>
              <div>
                {GLOBAL_CHARACTER_ABILITY_KEYS.map((key) => (
                  <label key={key}>{GLOBAL_CHARACTER_ABILITY_LABELS[key]}
                    <input
                      aria-label={`個人英雄${GLOBAL_CHARACTER_ABILITY_LABELS[key]}`}
                      type="number"
                      required
                      step="1"
                      min={GLOBAL_PERSONAL_HERO_ABILITY_MIN}
                      max={editingCharacter?.provenance.origin === "system_catalog" ? 100 : GLOBAL_PERSONAL_HERO_ABILITY_MAX}
                      disabled={editingCharacter?.provenance.origin === "system_catalog"}
                      value={heroAbilityDraft[key]}
                      onChange={(event) => setHeroAbilityDraft((current) => ({ ...current, [key]: event.target.value }))}
                    />
                  </label>
                ))}
              </div>
            </fieldset>

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
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={portrait?.id === item.id}
                      data-portrait-base={characterPortraitBaseIdentity(item)}
                      data-portrait-id={item.id}
                      onClick={() => setPortrait(item)}
                      title={item.visualDescription}
                    >
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
                <button className={styles.primary} disabled={busy} type="submit">{editingCharacter ? "保存人物修改" : "建立個人英雄並加入總庫"}</button>
                {editingCharacter ? <button type="button" onClick={() => { setEditingCharacter(null); setCharacterDraft(EMPTY_CHARACTER); setHeroAbilityDraft(personalHeroAbilityDraft()); setPortrait(null); }}>取消編輯</button> : null}
              </div>
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
                  <dl><div><dt>來源</dt><dd>{character.abilityProfile?.label ?? character.provenance.sourceLabel}</dd></div>{character.abilityProfile ? <div><dt>數值</dt><dd>{globalCharacterAbilitySummary(character.abilityProfile)}</dd></div> : null}<div><dt>目標</dt><dd>{character.goal || "待設定"}</dd></div><div><dt>能力</dt><dd>{character.capabilities.join("、") || "待設定"}</dd></div><div><dt>限制</dt><dd>{character.limitations.join("、") || "待設定"}</dd></div></dl>
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
              <div><small>30 ORGANIZATIONS · RELATION NETWORK · LAZY 10K ROSTER</small><h2>家族祖譜、宗門與企業階層</h2></div>
              <span>{indexedWorld.displayId} · {organizationCatalog.setting.eraLabel} · 30 個組織</span>
            </header>
            <div className={styles.catalogToolbar}>
              <label>搜尋組織、類型或據點<input type="search" value={organizationQuery} onChange={(event) => { setOrganizationQuery(event.target.value); setOrganizationMemberPageIndex(0); setFamilyPageIndex(0); }} placeholder="例：家族、宗門、企業、丹堂" /></label>
              <p>每個世界固定產生 30 個符合時代與背景的組織；每組織依規模容納 1–10,000 人。名冊、祖譜、職位及組織恩怨按需重現，不會一次塞入萬筆資料。</p>
            </div>
            <div className={styles.organizationBrowser}>
              <nav className={styles.organizationList} aria-label="世界組織清單">
                {filteredOrganizations.map((organization) => (
                  <button
                    type="button"
                    key={organization.organizationId}
                    data-testid="global-organization-option"
                    data-organization-archetype={organization.archetype}
                    aria-current={selectedOrganization?.organizationId === organization.organizationId ? "true" : undefined}
                    onClick={() => {
                      setSelectedOrganizationId(organization.organizationId);
                      setOrganizationMemberPageIndex(0);
                      setFamilyGeneration(0);
                      setFamilyBranch(null);
                      setFamilyPageIndex(0);
                    }}
                  >
                    <span>{organization.kindLabel} · {organization.eraLabel} · {organization.specializationLabel}</span>
                    <b>{organization.name}</b>
                    <small>在籍 {organization.currentMemberCount.toLocaleString("zh-TW")}／上限 {organization.memberCapacity.toLocaleString("zh-TW")}</small>
                  </button>
                ))}
                {filteredOrganizations.length === 0 ? <p className={styles.empty}>這個世界的 30 個組織中沒有符合條件的項目。</p> : null}
              </nav>

              {selectedOrganization ? (
                <article className={styles.organizationDetail} data-testid="global-organization-detail">
                  <header>
                    <div><span>{selectedOrganization.kindLabel} · {selectedOrganization.sizeLabel}組織</span><h3>{selectedOrganization.name}</h3></div>
                    <strong>{selectedOrganization.currentMemberCount.toLocaleString("zh-TW")}<small>人在籍／上限 {selectedOrganization.memberCapacity.toLocaleString("zh-TW")}</small></strong>
                  </header>
                  <dl className={styles.organizationFacts}>
                    <div><dt>據點</dt><dd>{selectedOrganization.territory}</dd></div>
                    <div><dt>專業定位</dt><dd>{selectedOrganization.specializationLabel}</dd></div>
                    <div><dt>內部準則</dt><dd>{selectedOrganization.doctrine}</dd></div>
                    <div><dt>公開目標</dt><dd>{selectedOrganization.publicGoal}</dd></div>
                    <div><dt>內部矛盾</dt><dd>{selectedOrganization.hiddenConflict}</dd></div>
                    <div><dt>組織關係</dt><dd>{selectedOrganization.relationships.length} 條固定恩怨與合作線</dd></div>
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

                  <section className={styles.organizationRelations} data-testid="global-organization-relationships">
                    <div><small>ORGANIZATION RELATION NETWORK</small><h4>盟約、宿敵、依附與歷史恩怨</h4></div>
                    <p>公開立場與幕後動機分開保存；故事可以讓人物私交和組織命令互相衝突。</p>
                    <div className={styles.organizationRelationGrid}>
                      {selectedOrganization.relationships.map((relationship) => {
                        const counterpartId = relationship.sourceOrganizationId === selectedOrganization.organizationId
                          ? relationship.targetOrganizationId
                          : relationship.sourceOrganizationId;
                        const counterpart = organizationById.get(counterpartId);
                        const source = organizationById.get(relationship.sourceOrganizationId);
                        const target = organizationById.get(relationship.targetOrganizationId);
                        const selectedIsSource = relationship.sourceOrganizationId === selectedOrganization.organizationId;
                        const relationshipPath = relationship.directed
                          ? `${source?.name ?? "未登錄組織"} → ${target?.name ?? "未登錄組織"}`
                          : `${source?.name ?? selectedOrganization.name} ↔ ${target?.name ?? counterpart?.name ?? "未登錄組織"}`;
                        const selectedPerspective = relationship.directed
                          ? selectedIsSource ? "本組織是作用發起方" : "本組織是作用承受方"
                          : "本組織是雙向關係的一方";
                        return (
                          <article key={relationship.relationshipId}>
                            <header><span>{relationship.kindLabel}</span><b>{relationshipPath}</b></header>
                            <dl>
                              <div><dt>本方角色</dt><dd>{selectedPerspective}；對方為 {counterpart?.name ?? "未登錄組織"}</dd></div>
                              <div><dt>起因</dt><dd>{relationship.cause}</dd></div>
                              <div><dt>歷史</dt><dd>{relationship.history}</dd></div>
                              <div><dt>現況</dt><dd>{relationship.currentStatus}</dd></div>
                              <div><dt>公開立場</dt><dd>{relationship.publicStance}</dd></div>
                              <div><dt>幕後動機</dt><dd>{relationship.secretMotive}</dd></div>
                              <div><dt>張力</dt><dd>強度 {relationship.intensity}/100 · 信任 {relationship.trust}/100 · {relationship.publiclyKnown ? "公開關係" : "未公開關係"}</dd></div>
                            </dl>
                          </article>
                        );
                      })}
                    </div>
                  </section>

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
                          return <GenealogyMemberCard key={position.personId} member={member} portrait={catalogCharacterPortraitForWorld(indexedWorld, member, organizationCatalog.matrix)} position={position} resolveName={(offset) => organizationMemberAtOffset({ matrix: organizationCatalog.matrix, organization: selectedOrganization, memberOffset: offset }).name} onOpen={openOrganizationMemberDetail} />;
                        })}
                        {familyGenealogy.positions.length === 0 ? <p className={styles.empty}>此世代與房系沒有在籍人物。</p> : null}
                      </div>
                      <div className={styles.pager}><button type="button" disabled={familyPageIndex === 0} onClick={() => setFamilyPageIndex(Math.max(0, familyPageIndex - 1))}>上一頁祖譜</button><span>第 {familyPageIndex + 1} / {Math.max(1, familyGenealogy.totalPages)} 頁 · 共 {familyGenealogy.total.toLocaleString("zh-TW")} 人</span><button type="button" disabled={familyPageIndex + 1 >= familyGenealogy.totalPages} onClick={() => setFamilyPageIndex(Math.min(Math.max(0, familyGenealogy.totalPages - 1), familyPageIndex + 1))}>下一頁祖譜</button></div>
                    </section>
                  ) : (
                    <section className={styles.rosterPanel} data-testid="global-organization-roster" data-materialization="lazy-paged">
                      <header><div><small>MEMBER ROSTER</small><h4>人物名冊與正式職位</h4></div><span>峰堂／部門、位階與派系均可查</span></header>
                      <div className={styles.rosterGrid}>{organizationMembers?.items.map((member) => <OrganizationMemberCard key={member.characterId} member={member} portrait={catalogCharacterPortraitForWorld(indexedWorld, member, organizationCatalog.matrix)} onOpen={openOrganizationMemberDetail} />)}</div>
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
              <form onSubmit={(event) => { event.preventDefault(); const value = Number.parseInt(String(new FormData(event.currentTarget).get("ordinal") || "1"), 10); const ordinal = Math.max(1, Math.min(100_000, Number.isFinite(value) ? value : 1)); setTreasureKind("all"); setTreasureQuery(""); setTreasurePageIndex(Math.floor((ordinal - 1) / TREASURE_CATALOG_PAGE_SIZE)); }}><label>直接前往寶物編號<input key={`${treasureKind}:${treasurePageIndex}`} name="ordinal" type="number" min="1" max="100000" defaultValue={treasureKind === "all" ? treasurePageIndex * TREASURE_CATALOG_PAGE_SIZE + 1 : treasureFirstGlobalNumber} /></label><button type="submit">前往</button></form>
              <label>類型<select value={treasureKind} onChange={(event) => { setTreasureKind(event.target.value as "all" | ProceduralTreasureKind); setTreasurePageIndex(0); }}><option value="all">全部類型</option>{PROCEDURAL_TREASURE_KIND_DEFINITIONS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select></label>
              <label>搜尋本頁<input type="search" value={treasureQuery} onChange={(event) => setTreasureQuery(event.target.value)} placeholder="名稱、類型、時代、持有人或組織" /></label>
            </div>
            <p className={styles.catalogNote}>涵蓋武器、法寶、符籙、丹藥、藥草、陣法、護具、材料、功法與特殊機緣；已保存與未保存寶物都會完整顯示，保存只改變卡片狀態、不會把物件藏起來。圖案、時代、能力、持有人及所屬組織都會固定重現。</p>
            <div className={styles.treasureGrid} data-testid="global-treasure-grid">
              {visibleTreasures.map((treasure) => {
                const saved = library.memories.find((memory) => memory.id === `global-treasure:${treasure.id}`) ?? null;
                return (
                  <article className={styles.treasureCard} key={treasure.id} data-kind={treasure.kind} data-era={treasure.era.sourceEra} data-saved={Boolean(saved)} style={proceduralTreasureVisualCssVariables(treasure.visual) as CSSProperties}>
                    <div className={styles.treasureHeading}>
                      <div className={styles.treasureImageFrame}>
                        <Image src={treasure.visual.baseAsset} alt={treasure.visual.alt} width={180} height={180} />
                        <span>{treasure.visual.elementLabel}屬性</span>
                      </div>
                      <div><small>#{String(treasure.ordinal + 1).padStart(6, "0")} · {treasure.era.sourceEraLabel} · {saved ? "已保存" : "未保存"}</small><h3>{treasure.name}</h3><p>{treasure.kindLabel}／{treasure.subtype} · {treasure.rarityLabel}</p></div>
                    </div>
                    <dl><div><dt>持有人</dt><dd>{treasure.holder.characterName}</dd></div><div><dt>持有組織</dt><dd>{treasure.holder.factionName} · {treasure.holder.factionKind}</dd></div><div><dt>能力</dt><dd>{treasure.abilities[0].name}：{treasure.abilities[0].effect}</dd></div><div><dt>代價</dt><dd>{treasure.cost}</dd></div></dl>
                    <div className={styles.catalogActions}><button className={styles.primary} type="button" disabled={busy} onClick={() => void saveTreasureCandidate(treasure)}>{saved ? "更新全域寶物快照" : "保存到全域寶物總庫"}</button><button type="button" disabled={!saved} onClick={() => saved && editSavedCatalogMemory(saved)}>編輯已保存資料</button><button type="button" disabled={!saved || busy} onClick={() => saved && void copyRecord(saved)}>複製候選到作品</button></div>
                  </article>
                );
              })}
              {visibleTreasures.length === 0 ? <p className={styles.empty}>這一頁沒有符合關鍵字的寶物。可換頁或清除搜尋。</p> : null}
            </div>
            <div className={styles.pager}><button type="button" disabled={!treasurePage.hasPreviousPage} onClick={() => setTreasurePageIndex(Math.max(0, treasurePageIndex - 1))}>上一頁寶物</button><span>{treasurePageRangeLabel}{treasureQuery.trim() ? ` · 本頁搜尋顯示 ${visibleTreasures.length} 件` : ""}</span><button type="button" disabled={!treasurePage.hasNextPage} onClick={() => setTreasurePageIndex(treasurePageIndex + 1)}>下一頁寶物</button></div>
          </section>
        </section>
      ) : null}

      {loaded && tab === "worlds" ? (
        <section className={styles.workspace} data-testid="global-canon-worlds">
          <section className={styles.worldExplorer}>
            <header><div><small>100,000 STABLE WORLDS · RULES INCLUDED</small><h2>十萬世界與世界規則</h2><p>每個舊世界都固定帶著小說類型、時空背景與世界規則；保存時會一起歸檔，不再拆成兩個工作區。</p></div><strong>{indexedWorld.displayId}</strong></header>
            <form className={styles.worldJump} onSubmit={(event) => { event.preventDefault(); navigateWorld(Number.parseInt(String(new FormData(event.currentTarget).get("world") || "1"), 10)); }}>
              <label>世界編號<input key={indexedWorld.ordinal} name="world" type="number" min="1" max="100000" defaultValue={indexedWorld.ordinal} /></label><button type="submit">前往世界</button>
            </form>
            <article className={styles.worldDetail}>
              <div><span>{indexedWorld.classification.name}</span><span>{indexedWorld.eraLabel}</span><span>{indexedWorld.primaryTopic.topicName}</span></div>
              <h3>{indexedWorld.title}</h3><p>{indexedWorld.logline}</p>
              <dl><div><dt>小說類型／世界分類（已選定）</dt><dd>{indexedWorld.primaryTopic.topicName}／{indexedWorld.classification.name}</dd></div><div><dt>時空背景（已選定）</dt><dd>{indexedWorld.eraLabel} · {indexedWorld.blueprint.period}</dd></div><div><dt>科技</dt><dd>{indexedWorld.blueprint.technology}</dd></div><div><dt>超常規則</dt><dd>{indexedWorld.blueprint.magic}</dd></div><div><dt>制度</dt><dd>{indexedWorld.blueprint.institutions.join("、")}</dd></div></dl>
              <p><strong>此世界的固定規則</strong></p>
              <ul>{indexedWorld.blueprint.canonRules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
              <details><summary>查看時空把關與 {indexedWorld.compatibleTopicCount} 類相容題材</summary><p>{indexedWorld.guard.statement}</p><p>題材預覽：{indexedWorld.compatibleTopicPreview.map((topic) => topic.topicName).join("、")}</p></details>
              <button className={styles.primary} type="button" onClick={() => void saveIndexedWorld()} disabled={busy}>{library.worlds.some((item) => item.catalogWorldNumber === indexedWorld.ordinal) ? "更新世界、背景與規則" : "保存世界、背景與規則到總庫"}</button>
            </article>
            <div className={styles.worldTiles}>{indexedWorldPage.items.map((world) => <button type="button" key={world.id} aria-current={world.ordinal === indexedWorld.ordinal ? "true" : undefined} onClick={() => navigateWorld(world.ordinal)}><b>{world.displayId}</b><span>{world.classification.name} · {world.eraLabel}</span><small>{world.primaryTopic.topicName}</small></button>)}</div>
            <div className={styles.pager}><button type="button" disabled={!indexedWorldPage.hasPreviousPage} onClick={() => navigateWorld(Math.max(1, indexedWorldPage.offset - 11))}>上一頁世界</button><span>{indexedWorldPage.offset + 1}–{indexedWorldPage.offset + indexedWorldPage.items.length} / {indexedWorldPage.totalItems.toLocaleString("zh-TW")}</span><button type="button" disabled={!indexedWorldPage.hasNextPage} onClick={() => navigateWorld(indexedWorldPage.offset + 13)}>下一頁世界</button></div>
          </section>

          <form id="global-world-editor" className={styles.editor} data-collapsed={!expandedEditors.world} onSubmit={(event) => void saveWorld(event)}>
            <header>
              <div><small>CUSTOM WORLD + FOUNDING RULE</small><h2>{editingWorld ? `編輯 ${editingWorld.name}` : `建立第${String(nextCustomGlobalWorldNumber(library.worlds)).padStart(6, "0")}世界與規則`}</h2></div>
              <div className={styles.editorHeaderActions}>
                <span>小說類型與時空背景必須先選好</span>
                <button
                  className={styles.editorToggle}
                  type="button"
                  aria-expanded={expandedEditors.world}
                  aria-controls="global-world-editor-body"
                  data-testid="global-world-editor-toggle"
                  onClick={() => setExpandedEditors((current) => ({ ...current, world: !current.world }))}
                >
                  {expandedEditors.world ? "收合世界編輯器" : "展開世界編輯器"}
                </button>
              </div>
            </header>
            <div id="global-world-editor-body" className={styles.editorBody} hidden={!expandedEditors.world}>
              <div className={styles.formGrid}>
                <label>世界名稱<input required value={worldDraft.name} onChange={(event) => setWorldDraft({ ...worldDraft, name: event.target.value })} /></label>
                <label>小說類型／世界分類<select required value={worldDraft.classificationId} onChange={(event) => { const classification = GLOBAL_WORLD_CLASSIFICATIONS.find((item) => item.id === event.target.value); setWorldDraft({ ...worldDraft, classificationId: classification?.id ?? "", classificationLabel: classification?.name ?? "" }); }}><option value="">請先選擇小說類型</option>{worldDraft.classificationId && !GLOBAL_WORLD_CLASSIFICATIONS.some((item) => item.id === worldDraft.classificationId) ? <option value={worldDraft.classificationId}>{worldDraft.classificationLabel}（舊資料）</option> : null}{GLOBAL_WORLD_CLASSIFICATIONS.map((classification) => <option key={classification.id} value={classification.id}>{classification.name}</option>)}</select></label>
                <label>時代<select required value={worldDraft.eraContext} onChange={(event) => { const eraContext = event.target.value as GlobalCanonEraContext | ""; const eraLabel = ERA_OPTIONS.find((option) => option.value === eraContext)?.label ?? ""; setWorldDraft({ ...worldDraft, eraContext, eraLabel: worldDraft.eraLabel || eraLabel }); }}><option value="">請先選擇時代</option>{ERA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label>時空背景<input required value={worldDraft.eraLabel} onChange={(event) => setWorldDraft({ ...worldDraft, eraLabel: event.target.value })} placeholder="例：2026 年臺北、架空王朝曆 18 年" /></label>
                <label className={styles.wide}>世界摘要<textarea required value={worldDraft.summary} onChange={(event) => setWorldDraft({ ...worldDraft, summary: event.target.value })} /></label>
                {worldDraft.eraContext === "cross-era" ? <label className={styles.wide}>跨時代 Canon 橋接規則<textarea required value={worldDraft.crossEraBridge} onChange={(event) => setWorldDraft({ ...worldDraft, crossEraBridge: event.target.value })} placeholder="例：只有通過天文台的單向時門，且每次只能攜帶一件當代物品。" /></label> : null}
                {!editingWorld ? <><label>第一條世界規則<input required value={worldDraft.foundingRuleTitle} onChange={(event) => setWorldDraft({ ...worldDraft, foundingRuleTitle: event.target.value })} placeholder="例：證物必須有可查來源" /></label><label className={styles.check}><input type="checkbox" checked={worldDraft.foundingRuleImmutable} onChange={(event) => setWorldDraft({ ...worldDraft, foundingRuleImmutable: event.target.checked })} />不可被故事自動改寫</label><label className={styles.wide}>第一條規則內容<textarea required value={worldDraft.foundingRuleDescription} onChange={(event) => setWorldDraft({ ...worldDraft, foundingRuleDescription: event.target.value })} /></label></> : null}
              </div>
              <div className={styles.formActions}><button className={styles.primary} disabled={busy} type="submit">{editingWorld ? "保存世界修改" : `建立第${String(nextCustomGlobalWorldNumber(library.worlds)).padStart(6, "0")}世界與規則`}</button>{editingWorld ? <button type="button" onClick={() => { setEditingWorld(null); setWorldDraft(EMPTY_WORLD); }}>取消編輯</button> : null}</div>
            </div>
          </form>

          <section className={styles.libraryPanel}>
            <header><div><small>SAVED WORLDS</small><h2>已保存的全域世界</h2></div><span>{library.worlds.length} 個</span></header>
            <PagedRecords items={library.worlds} emptyText="從十萬世界索引保存固定世界，或建立第 100001 起的自訂世界與規則。" renderItem={(world) => {
              const ruleCount = globalWorldRulesFor(library.rules, world.id).length;
              return <article className={styles.recordCard} key={world.id}><Revision value={world.revision} /><h3>{world.name}</h3><p>{formatGlobalWorldCatalogNumber(world)} · {world.classificationLabel} · {world.eraLabel}</p><p>{ruleCount} 條已歸檔世界規則</p><p className={styles.clamp}>{world.summary}</p>{world.crossEraBridge ? <p className={styles.bridge}>跨時代橋：{world.crossEraBridge}</p> : null}<footer><button type="button" onClick={() => editWorld(world)}>編輯</button><button type="button" onClick={() => void copyRecord(world)} disabled={busy}>複製候選</button><button className={styles.danger} type="button" onClick={() => void removeRecord(world)} disabled={busy}>刪除</button></footer></article>;
            }} />
          </section>

          <form id="global-world-rule-editor" data-testid="global-world-rule-editor" className={styles.editor} onSubmit={(event) => void saveRule(event)}><header><div><small>WORLD RULES · FILED BY WORLD</small><h2>{editingRule ? "編輯世界規則" : "替已保存世界新增規則"}</h2></div><span>新規則不能脫離世界單獨存在</span></header><div className={styles.formGrid}><label>所屬世界<select required value={ruleDraft.globalWorldId} onChange={(event) => setRuleDraft({ ...ruleDraft, globalWorldId: event.target.value })}><option value="">請先選擇已保存世界</option>{library.worlds.map((world) => <option key={world.id} value={world.id}>{formatGlobalWorldCatalogNumber(world)} · {world.name}</option>)}</select></label><label>規則名稱<input required value={ruleDraft.title} onChange={(event) => setRuleDraft({ ...ruleDraft, title: event.target.value })} /></label><label>額外適用時代代碼<input value={ruleDraft.eraContexts} onChange={(event) => setRuleDraft({ ...ruleDraft, eraContexts: event.target.value })} placeholder="可留白；會自動加入所屬世界時代" /></label><label className={styles.wide}>規則內容<textarea required value={ruleDraft.description} onChange={(event) => setRuleDraft({ ...ruleDraft, description: event.target.value })} /></label><label className={styles.check}><input type="checkbox" checked={ruleDraft.immutable} onChange={(event) => setRuleDraft({ ...ruleDraft, immutable: event.target.checked })} />不可被故事自動改寫</label></div>{library.worlds.length === 0 ? <p className={styles.editorNote}>請先保存十萬世界，或在上方建立第 100001 起的自訂世界；規則必須綁定一個已保存世界。</p> : null}<div className={styles.formActions}><button className={styles.primary} disabled={busy || library.worlds.length === 0} type="submit">{editingRule ? "保存並維持世界關聯" : "加入所屬世界"}</button>{editingRule ? <button type="button" onClick={() => { setEditingRule(null); setRuleDraft(EMPTY_RULE); }}>取消編輯</button> : null}</div></form>
          <div data-testid="global-world-rule-library">
            <RecordLibrary title="全域世界規則（依世界歸檔）" items={library.rules} renderItem={(rule) => {
              const linkedWorldNames = rule.appliesToGlobalWorldIds.map((worldId) => library.worlds.find((world) => world.id === worldId)?.name).filter((name): name is string => Boolean(name));
              return <article className={styles.recordCard} key={rule.id}><Revision value={rule.revision} /><h3>{rule.title}</h3><p>{rule.description}</p><p>所屬世界：{linkedWorldNames.join("、") || "舊資料尚未綁定；編輯後即可歸檔"}</p><p>{rule.immutable ? "固定規則" : "可由作者修訂"} · {rule.eraContexts.join("、") || "時代隨所屬世界"}</p><footer><button type="button" onClick={() => editRule(rule)}>編輯／綁定世界</button><button type="button" onClick={() => void copyRecord(rule)} disabled={busy}>複製候選</button><button className={styles.danger} type="button" onClick={() => void removeRecord(rule)} disabled={busy}>刪除</button></footer></article>;
            }} />
          </div>
        </section>
      ) : null}

      {loaded && tab === "memories" ? (
        <section className={styles.workspace} data-testid="global-canon-memories">
          <form id="global-memory-editor" className={styles.editor} data-collapsed={!expandedEditors.memory} onSubmit={(event) => void saveMemory(event)}>
            <header>
              <div><small>MEMORY & LORE</small><h2>{editingMemory ? "編輯記憶資料" : "建立記憶資料"}</h2></div>
              <div className={styles.editorHeaderActions}>
                <span>地點、組織、物件與祕密</span>
                <button
                  className={styles.editorToggle}
                  type="button"
                  aria-expanded={expandedEditors.memory}
                  aria-controls="global-memory-editor-body"
                  data-testid="global-memory-editor-toggle"
                  onClick={() => setExpandedEditors((current) => ({ ...current, memory: !current.memory }))}
                >
                  {expandedEditors.memory ? "收合記憶編輯器" : "展開記憶編輯器"}
                </button>
              </div>
            </header>
            <div id="global-memory-editor-body" className={styles.editorBody} hidden={!expandedEditors.memory}>
              <div className={styles.formGrid}>
                <label>資料類型<select value={memoryDraft.kind} onChange={(event) => setMemoryDraft({ ...memoryDraft, kind: event.target.value as GlobalMemoryKind })}><option value="location">地點</option><option value="faction">家族／宗門／企業</option><option value="item">武器／寶物／丹藥／藥草</option><option value="secret">祕密</option><option value="custom">其他</option></select></label>
                <label>適用時代代碼<input value={memoryDraft.eraContexts} onChange={(event) => setMemoryDraft({ ...memoryDraft, eraContexts: event.target.value })} placeholder="modern、historical、cultivation" /></label>
                <label className={styles.wide}>名稱<input required value={memoryDraft.title} onChange={(event) => setMemoryDraft({ ...memoryDraft, title: event.target.value })} /></label>
                <label className={styles.wide}>完整資料<textarea required value={memoryDraft.content} onChange={(event) => setMemoryDraft({ ...memoryDraft, content: event.target.value })} /></label>
              </div>
              <div className={styles.formActions}><button className={styles.primary} disabled={busy} type="submit">{editingMemory ? "保存記憶" : "加入記憶總庫"}</button>{editingMemory ? <button type="button" onClick={() => { setEditingMemory(null); setMemoryDraft(EMPTY_MEMORY); }}>取消編輯</button> : null}</div>
            </div>
          </form>
          <RecordLibrary title="全域記憶與資料" items={library.memories} renderItem={(memory) => <article className={styles.recordCard} key={memory.id}><Revision value={memory.revision} /><h3>{memory.title}</h3><p>{memory.kind} · {memory.eraContexts.join("、") || "不限時代"}</p><p>{memory.content}</p><footer><button type="button" onClick={() => editMemory(memory)}>編輯</button><button type="button" onClick={() => void copyRecord(memory)} disabled={busy}>複製候選</button><button className={styles.danger} type="button" onClick={() => void removeRecord(memory)} disabled={busy}>刪除</button></footer></article>} />
        </section>
      ) : null}

      {loaded && tab === "storyBible" ? (
        <section className={styles.workspace} data-testid="global-canon-story-bibles">
          <form className={styles.editor} onSubmit={(event) => void saveStoryBible(event)}>
            <header><div><small>NON-CONTRADICTION MASTER PLAN</small><h2>{editingStoryBible ? `編輯防矛盾總綱：${editingStoryBible.title}` : "建立 Story Bible 防矛盾總綱"}</h2></div><span>主題、角色弧線、世界核心、伏筆與矛盾禁區</span></header>
            <p className={styles.purposeNote} data-testid="story-bible-purpose">
              <span><b>用途：</b>把主題、角色弧線、世界核心、伏筆、禁止矛盾與未解／已解線索整理成後續寫作的一致性總綱。</span>
              <span><b>影響：</b>複製到作品並明確選用後，可供作者與 AI 檢查後續候選是否前後一致；不會自動改寫章節、人物或世界資料。</span>
            </p>
            <div className={styles.formGrid}>
              <label className={styles.wide}>總綱名稱<input required value={storyBibleDraft.title} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, title: event.target.value })} placeholder="例：第一卷防矛盾總綱" /></label>
              <label>核心主題／角色弧線<input value={storyBibleDraft.theme} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, theme: event.target.value })} placeholder="例：權力必須付出代價；主角由逃避走向承擔" /></label>
              <label>敘事風格<input value={storyBibleDraft.style} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, style: event.target.value })} placeholder="例：近距離第三人稱、對白推進" /></label>
              <label className={styles.wide}>伏筆（頓號或換行分隔）<textarea value={storyBibleDraft.foreshadowing} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, foreshadowing: event.target.value })} placeholder="例：斷劍每逢月蝕發熱；城門守衛記得錯誤的王年" /></label>
              <label>未解線索<textarea value={storyBibleDraft.unresolvedThreads} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, unresolvedThreads: event.target.value })} placeholder="例：誰偷走王印？主角的夢為何會預知未來？" /></label>
              <label>已解線索<textarea value={storyBibleDraft.resolvedThreads} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, resolvedThreads: event.target.value })} placeholder="例：第三章證實王印由內庫官調包" /></label>
              <label className={styles.wide}>禁止矛盾<textarea value={storyBibleDraft.forbiddenContradictions} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, forbiddenContradictions: event.target.value })} placeholder="例：已死亡人物不得無橋接復活；主角第二章後不得無故知道密訊" /></label>
              <label className={styles.wide}>世界核心／作者偏好<textarea value={storyBibleDraft.authorPreferences} onChange={(event) => setStoryBibleDraft({ ...storyBibleDraft, authorPreferences: event.target.value })} placeholder="例：世界核心是記憶可交易但不可複製；場景必須有行動與後果" /></label>
            </div>
            {editingStoryBible ? <p className={styles.editorNote}>從作品匯入的角色、關係、世界與規則連結會原樣保留；這裡修改的是 Story Bible 本身，不會寫回來源作品。</p> : null}
            <div className={styles.formActions}><button className={styles.primary} disabled={busy} type="submit">{editingStoryBible ? "保存 Story Bible" : "加入 Story Bible 總庫"}</button>{editingStoryBible ? <button type="button" onClick={() => { setEditingStoryBible(null); setStoryBibleDraft(EMPTY_STORY_BIBLE); }}>取消編輯</button> : null}</div>
          </form>
          <RecordLibrary title="全域 Story Bible 防矛盾總綱" items={library.storyBibles} renderItem={(storyBible) => <article className={styles.recordCard} key={storyBible.id}><Revision value={storyBible.revision} /><h3>{storyBible.title}</h3><p>{storyBible.theme || "核心主題／角色弧線待設定"}</p><p>{storyBible.style || "敘事風格待設定"}</p><dl><div><dt>人物</dt><dd>{storyBible.globalCharacterIds.length}</dd></div><div><dt>世界核心</dt><dd>{storyBible.globalWorldId ? "已連結" : "未連結"}</dd></div><div><dt>規則</dt><dd>{storyBible.globalWorldRuleIds.length}</dd></div><div><dt>伏筆</dt><dd>{storyBible.foreshadowing.length}</dd></div><div><dt>未解</dt><dd>{storyBible.unresolvedThreads.length}</dd></div><div><dt>時間線</dt><dd>{storyBible.globalTimelineTemplateIds.length}</dd></div></dl><footer><button type="button" onClick={() => editStoryBible(storyBible)}>編輯</button><button type="button" onClick={() => void copyStoryBible(storyBible)} disabled={busy}>整套複製為作品候選</button><button className={styles.danger} type="button" onClick={() => void removeStoryBible(storyBible)} disabled={busy}>刪除</button></footer></article>} />
        </section>
      ) : null}

      {loaded && tab === "timeline" ? (
        <section className={styles.workspace} data-testid="global-canon-timeline">
          <form className={styles.editor} onSubmit={(event) => void saveTimeline(event)}>
            <header><div><small>EVENT CHRONOLOGY TEMPLATE</small><h2>{editingTimeline ? "編輯事件時間線模板" : "建立事件時間線模板"}</h2></div><span>年代、順序、人物位置、因果與章節落點</span></header>
            <p className={styles.purposeNote} data-testid="timeline-template-purpose">
              <span><b>用途：</b>記錄事件的發生年代、先後順序、當時人物位置、前因後果與建議放入的章節。</span>
              <span><b>影響：</b>複製到作品後，只作為安排章節與檢查時序的候選參考；不會自動插入、移動或改寫任何正文。</span>
            </p>
            <div className={styles.formGrid}>
              <label>事件名稱<input required value={timelineDraft.title} onChange={(event) => setTimelineDraft({ ...timelineDraft, title: event.target.value })} placeholder="例：北城門失火" /></label>
              <label>年代／先後順序<input value={timelineDraft.storyTime} onChange={(event) => setTimelineDraft({ ...timelineDraft, storyTime: event.target.value })} placeholder="例：王朝曆 18 年冬；祭典失火後第三日" /></label>
              <label>時代<select value={timelineDraft.eraContext} onChange={(event) => setTimelineDraft({ ...timelineDraft, eraContext: event.target.value as GlobalCanonEraContext })}>{ERA_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
              <label>人物位置／章節落點<input value={timelineDraft.placementHint} onChange={(event) => setTimelineDraft({ ...timelineDraft, placementHint: event.target.value })} placeholder="例：林昭在北城門；第一幕第 3 章開頭" /></label>
              <label className={styles.wide}>事件內容／因果<textarea required value={timelineDraft.summary} onChange={(event) => setTimelineDraft({ ...timelineDraft, summary: event.target.value })} placeholder="例：前因是粮倉帳簿遭竊改；失火後守衛封閉城門，促使主角改走地道。" /></label>
            </div>
            <div className={styles.formActions}><button className={styles.primary} disabled={busy} type="submit">{editingTimeline ? "保存事件時間線" : "加入事件時間線總庫"}</button>{editingTimeline ? <button type="button" onClick={() => { setEditingTimeline(null); setTimelineDraft(EMPTY_TIMELINE); }}>取消編輯</button> : null}</div>
          </form>
          <RecordLibrary title="全域事件時間線模板" items={library.timelineTemplates} renderItem={(timeline) => <article className={styles.recordCard} key={timeline.id}><Revision value={timeline.revision} /><h3>{timeline.title}</h3><p>{timeline.storyTime || "年代／先後順序待定"} · {timeline.eraContext}</p><p>{timeline.summary}</p>{timeline.placementHint ? <p>人物位置／章節落點：{timeline.placementHint}</p> : null}<footer><button type="button" onClick={() => editTimeline(timeline)}>編輯</button><button type="button" onClick={() => void copyRecord(timeline)} disabled={busy}>複製候選</button><button className={styles.danger} type="button" onClick={() => void removeRecord(timeline)} disabled={busy}>刪除</button></footer></article>} />
        </section>
      ) : null}

      {selectedOrganizationMember && selectedOrganizationMemberPortrait && selectedOrganizationMemberMastery ? (
        <OrganizationMemberDetail
          member={selectedOrganizationMember}
          portrait={selectedOrganizationMemberPortrait}
          mastery={selectedOrganizationMemberMastery}
          resolveCharacterName={(characterId) => organizationCatalog.matrix.getCharacterById(characterId)?.name ?? "未登錄人物"}
          onClose={closeOrganizationMemberDetail}
        />
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

type OrganizationMemberOpenHandler = (member: StoryOrganizationMember, trigger: HTMLButtonElement) => void;

function OrganizationMemberButton({
  member,
  portrait,
  view,
  onOpen,
}: {
  member: StoryOrganizationMember;
  portrait: CharacterPortraitAsset;
  view: "roster" | "genealogy";
  onOpen: OrganizationMemberOpenHandler;
}) {
  return (
    <button
      type="button"
      className={styles.memberCardButton}
      data-testid="global-organization-member-card"
      data-member-view={view}
      data-character-id={member.characterId}
      data-member-name={member.name}
      data-member-rank={member.organizationRank}
      data-member-unit={member.organizationUnit}
      data-member-faction={member.organizationFaction}
      aria-label={`查看人物：${member.name}，${member.organizationRank}，${member.organizationUnit}`}
      onClick={(event) => onOpen(member, event.currentTarget)}
    >
      <PortraitCrop portrait={portrait} className={styles.memberCardPortrait} decorative />
      <span className={styles.memberCardIdentity}>
        <small>{member.organizationFaction}</small>
        <strong>{member.name}</strong>
        <span>{member.organizationRank}</span>
      </span>
      <span className={styles.memberCardOpen} aria-hidden="true">查看 ›</span>
    </button>
  );
}

function OrganizationMemberCard({
  member,
  portrait,
  onOpen,
}: {
  member: StoryOrganizationMember;
  portrait: CharacterPortraitAsset;
  onOpen: OrganizationMemberOpenHandler;
}) {
  return (
    <article className={styles.memberCard} data-character-id={member.characterId}>
      <OrganizationMemberButton member={member} portrait={portrait} view="roster" onOpen={onOpen} />
      <dl><div><dt>峰堂／部門</dt><dd>{member.organizationUnit}</dd></div><div><dt>位置</dt><dd>{member.location}</dd></div></dl>
    </article>
  );
}

function GenealogyMemberCard({
  member,
  portrait,
  position,
  resolveName,
  onOpen,
}: {
  member: StoryOrganizationMember;
  portrait: CharacterPortraitAsset;
  position: FamilyGenealogyPosition;
  resolveName: (offset: number) => string;
  onOpen: OrganizationMemberOpenHandler;
}) {
  return (
    <article className={styles.genealogyCard} data-lineage-role={position.lineageRole}>
      <OrganizationMemberButton member={member} portrait={portrait} view="genealogy" onOpen={onOpen} />
      <p>{position.generationLabel} · {position.branchLabel} · {position.lineageRole === "bloodline" ? "血親" : "配偶"}</p>
      <dl>
        <div><dt>父母</dt><dd>{position.parentMemberOffsets.length ? position.parentMemberOffsets.map(resolveName).join("、") : "始祖／外姓入譜"}</dd></div>
        <div><dt>配偶</dt><dd>{position.spouseMemberOffset === null ? "尚未入譜" : resolveName(position.spouseMemberOffset)}</dd></div>
        <div><dt>手足</dt><dd>{position.siblingMemberOffsets.length ? position.siblingMemberOffsets.map(resolveName).join("、") : "無同譜手足"}</dd></div>
        <div><dt>子女</dt><dd>{position.childMemberOffsets.length ? `${position.childMemberOffsets.length} 人：${position.childMemberOffsets.map(resolveName).join("、")}` : "尚無入譜子女"}</dd></div>
      </dl>
    </article>
  );
}

function OrganizationMemberDetail({
  member,
  portrait,
  mastery,
  resolveCharacterName,
  onClose,
}: {
  member: StoryOrganizationMember;
  portrait: CharacterPortraitAsset;
  mastery: CharacterMasteryProfile;
  resolveCharacterName: (characterId: string) => string;
  onClose: () => void;
}) {
  const headingId = `organization-member-detail-${member.populationIndex}`;
  const abilities = [
    ["修行", member.abilities.cultivation],
    ["武力", member.abilities.martial],
    ["謀略", member.abilities.strategy],
    ["洞察", member.abilities.perception],
    ["醫藥", member.abilities.medicine],
    ["技藝", member.abilities.crafting],
    ["領導", member.abilities.leadership],
    ["影響力", member.abilities.influence],
  ] as const;

  return (
    <div className={styles.memberDialogBackdrop}>
      <section
        className={styles.memberDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="global-organization-member-detail"
        data-character-id={member.characterId}
      >
        <header className={styles.memberDialogHeader}>
          <PortraitCrop portrait={portrait} className={styles.memberDialogPortrait} />
          <div>
            <small>第 {String(member.populationIndex + 1).padStart(6, "0")} 人物 · {mastery.storyEraLabel}</small>
            <h2 id={headingId}>{member.name}</h2>
            <p>{member.identity} · {member.age} 歲</p>
          </div>
          <button type="button" autoFocus aria-label="關閉人物詳情" onClick={onClose}>×</button>
        </header>

        <div className={styles.memberDialogBody}>
          <section className={styles.memberDetailPanel}>
            <h3>組織身分與行動核心</h3>
            <dl>
              <div><dt>職位</dt><dd>{member.organizationRank}</dd></div>
              <div><dt>峰堂／部門</dt><dd>{member.organizationUnit}</dd></div>
              <div><dt>派系</dt><dd>{member.organizationFaction}</dd></div>
              <div><dt>所在地</dt><dd>{member.location}</dd></div>
              <div><dt>家族位置</dt><dd>{member.familyRole}</dd></div>
              <div><dt>人物目標</dt><dd>{member.goal}</dd></div>
              <div><dt>私密線索</dt><dd>{member.secret}</dd></div>
            </dl>
          </section>

          <section className={styles.memberDetailPanel}>
            <h3>個性與能力</h3>
            <p>{member.personality.traits.join("、")}；{member.personality.publicFace}</p>
            <p><strong>內在需求：</strong>{member.personality.privateNeed}</p>
            <div className={styles.memberAbilityGrid}>{abilities.map(([label, value]) => <span key={label}><b>{label}</b>{value}</span>)}</div>
            <p><strong>能力層級：</strong>{member.abilities.powerTier}　<strong>專長：</strong>{member.abilities.specialties.join("、")}</p>
          </section>

          <section className={styles.memberDetailPanel}>
            <h3>功法、戰技與持有物</h3>
            <ul className={styles.memberDetailList}>
              {mastery.assignments.map((assignment) => (
                <li key={assignment.referenceId}>
                  <b>{assignment.relationLabel}{assignment.name}</b>
                  <span>{assignment.catalogLabel} · 熟練 {assignment.proficiency} · 加乘 ×{assignment.effectiveMultiplier.toFixed(2)}</span>
                  <small>限制：{assignment.limitation}；代價：{assignment.cost}</small>
                </li>
              ))}
              <li><b>持有 {mastery.heldTreasure.name}</b><span>固定人物資產，不會因開啟視窗而改值</span></li>
            </ul>
          </section>

          <section className={styles.memberDetailPanel}>
            <h3>關係與人物持有物</h3>
            <ul className={styles.memberDetailList}>
              {member.relationships.slice(0, 6).map((relationship) => (
                <li key={relationship.relationshipId}>
                  <b>{resolveCharacterName(relationship.targetCharacterId)} · {relationship.kind}</b>
                  <span>信任 {relationship.trust} · 張力 {relationship.tension} · 義務 {relationship.obligation}</span>
                  <small>{relationship.historyHook}</small>
                </li>
              ))}
              {member.relationships.length === 0 ? <li><span>尚無已建立的人物關係。</span></li> : null}
              {member.possessions.slice(0, 4).map((possession) => (
                <li key={possession.possessionId}><b>{possession.ownership}：{possession.name}</b><span>{possession.kind} · {possession.rarity}</span><small>{possession.function}；限制：{possession.limitation}</small></li>
              ))}
            </ul>
          </section>
        </div>

        <footer className={styles.memberDialogActions}>
          <button type="button" className={styles.primary} onClick={onClose}>返回人物列表</button>
        </footer>
      </section>
    </div>
  );
}
