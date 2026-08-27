"use client";

import { useEffect, useMemo, useState } from "react";
import {
  makeRecord,
  optionalValue,
  type Character,
  type CharacterRelationship,
  type CharacterRpgArchetype,
  type CharacterRpgStatKey,
  type DomainRecord,
  type LoreEntry,
  type NovelProject,
  type StoryBible,
  type StoryState,
  type TimelineEvent,
  type World,
  type WorldRule,
} from "@/lib/novel-ai/domain";
import { explicitCrossEraCanonAuthorization } from "@/lib/novel-ai/domain/story-started-canon-guard";
import {
  CHARACTER_PORTRAIT_CAPACITY,
} from "@/lib/novel-ai/character-portraits/catalog";
import {
  isCharacterEraCompatible,
  suggestedCharacterPortrait,
  worldEraContext,
} from "@/lib/novel-ai/character-portraits/assignment";
import {
  CULTIVATION_PROFESSIONS,
  FUTURE_ORGANIZATION_CATALOG,
  HISTORICAL_ORGANIZATION_CATALOG,
  professionContinuityError,
  professionSuggestions,
  professionWorldContext,
  MODERN_ORGANIZATION_CATALOG,
} from "@/lib/novel-ai/game/character-profession";
import { managementInvestmentCatalog, resolveManagementEra } from "@/lib/novel-ai/game/management-investments";
import { CULTIVATION_OPPORTUNITIES } from "@/lib/novel-ai/game/cultivation-opportunities";
import {
  CHARACTER_RPG_ARCHETYPES,
  CHARACTER_RPG_POINT_BUDGET,
  CHARACTER_RPG_STAT_LABELS,
  CHARACTER_RPG_STAT_MAX,
  CHARACTER_RPG_STAT_MIN,
  characterRpgPointTotal,
  characterRpgStatsForArchetype,
  createCharacterRpgProfile,
} from "@/lib/novel-ai/game/character-rpg-profile";
import {
  CULTIVATION_REALMS,
  SECT_RANK_CATALOG,
  SPIRIT_ROOT_CATALOG,
  sectBranchCatalog,
  sectTechniqueCatalog,
} from "@/lib/novel-ai/game/cultivation-canon";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import CharacterPortraitImage from "./character-portrait";

const RELATIONSHIP_KINDS = [
  "兄弟", "姊妹", "兄妹／姊弟", "夫妻", "戀人", "前任", "父子", "父女", "母子", "母女",
  "祖孫", "師徒", "同門", "盟友", "敵人", "宿敵", "競爭者", "主僕", "同事", "上下屬",
  "恩人", "仇人", "債務", "交易夥伴",
] as const;

const CROSS_ERA_SOURCE_LABELS = {
  project: "專案設定",
  "story-bible": "Story Bible",
  "world-rule": "世界規則",
  "baseline-world": "Story Bible 正式世界",
} as const;

type WorkbenchData = {
  characters: Character[];
  relationships: CharacterRelationship[];
  storyBibles: StoryBible[];
  storyStates: StoryState[];
  worlds: World[];
  worldRules: WorldRule[];
  lore: LoreEntry[];
  timeline: TimelineEvent[];
};

export default function CharacterRelationshipWorkbench({
  project,
  compact = false,
  onChanged,
}: {
  project: NovelProject;
  compact?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const repository = useMemo(() => createNovelRepository(), []);
  const [data, setData] = useState<WorkbenchData>({
    characters: [], relationships: [], storyBibles: [], storyStates: [], worlds: [], worldRules: [], lore: [], timeline: [],
  });
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [name, setName] = useState("");
  const [profession, setProfession] = useState("");
  const [rpgArchetype, setRpgArchetype] = useState<CharacterRpgArchetype>("balanced");
  const [rpgStats, setRpgStats] = useState<Record<CharacterRpgStatKey, number>>(
    () => characterRpgStatsForArchetype("balanced"),
  );
  const [spiritRootId, setSpiritRootId] = useState("root.mixed");
  const [realmId, setRealmId] = useState("realm.qi-refining");
  const [realmStage, setRealmStage] = useState<"初期" | "中期" | "後期" | "圓滿">("初期");
  const [sectBranchId, setSectBranchId] = useState("");
  const [sectRankId, setSectRankId] = useState("sect.outer-disciple");
  const [techniqueId, setTechniqueId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [kind, setKind] = useState("兄弟");
  const [summary, setSummary] = useState("");
  const [trust, setTrust] = useState("50");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [characterEditorsOpen, setCharacterEditorsOpen] = useState(!compact);
  const [canonEditorsOpen, setCanonEditorsOpen] = useState(!compact);
  const [selectedWorldId, setSelectedWorldId] = useState("");
  const [worldName, setWorldName] = useState("");
  const [worldEra, setWorldEra] = useState("");
  const [worldSummary, setWorldSummary] = useState("");
  const [bibleTheme, setBibleTheme] = useState("");
  const [bibleStyle, setBibleStyle] = useState("");
  const [bibleForeshadowing, setBibleForeshadowing] = useState("");
  const [bibleThreads, setBibleThreads] = useState("");
  const [bibleContradictions, setBibleContradictions] = useState("");
  const [biblePreferences, setBiblePreferences] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState("__new__");
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleDescription, setRuleDescription] = useState("");
  const [ruleImmutable, setRuleImmutable] = useState(true);
  const [selectedLoreId, setSelectedLoreId] = useState("__new__");
  const [loreKind, setLoreKind] = useState<LoreEntry["kind"]>("custom");
  const [loreTitle, setLoreTitle] = useState("");
  const [loreContent, setLoreContent] = useState("");
  const [selectedTimelineId, setSelectedTimelineId] = useState("__new__");
  const [timelineTitle, setTimelineTitle] = useState("");
  const [timelineStoryTime, setTimelineStoryTime] = useState("");
  const [timelineSummary, setTimelineSummary] = useState("");

  function applyWorldForm(world: World | null) {
    setWorldName(world?.name.value ?? "");
    setWorldEra(world?.era.value ?? "");
    setWorldSummary(world?.summary.value ?? "");
  }

  function applyBibleForm(storyBible: StoryBible | null) {
    setBibleTheme(storyBible?.theme.value ?? "");
    setBibleStyle(storyBible?.style.value ?? "");
    setBibleForeshadowing((storyBible?.foreshadowing ?? []).join("\n"));
    setBibleThreads((storyBible?.unresolvedThreads ?? []).join("\n"));
    setBibleContradictions((storyBible?.forbiddenContradictions ?? []).join("\n"));
    setBiblePreferences((storyBible?.authorPreferences ?? []).join("\n"));
  }

  function applyRuleForm(rule: WorldRule | null) {
    setRuleTitle(rule?.title ?? "");
    setRuleDescription(rule?.description ?? "");
    setRuleImmutable(rule?.immutable ?? true);
  }

  function applyLoreForm(entry: LoreEntry | null) {
    setLoreKind(entry?.kind ?? "custom");
    setLoreTitle(entry?.title ?? "");
    setLoreContent(entry?.content ?? "");
  }

  function applyTimelineForm(event: TimelineEvent | null) {
    setTimelineTitle(event?.title ?? "");
    setTimelineStoryTime(event?.storyTime ?? "");
    setTimelineSummary(event?.summary ?? "");
  }

  function textLines(value: string) {
    return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  }

  function applyCharacterForm(character: Character | null) {
    setName(character?.name ?? "");
    setProfession(character?.identity.value ?? "");
    const nextArchetype = character?.rpgProfile?.archetype ?? "balanced";
    setRpgArchetype(nextArchetype);
    setRpgStats(character?.rpgProfile?.stats ?? characterRpgStatsForArchetype(nextArchetype));
    setSpiritRootId(character?.cultivationProfile?.spiritRootId ?? "root.mixed");
    setRealmId(character?.cultivationProfile?.realmId ?? "realm.qi-refining");
    setRealmStage(character?.cultivationProfile?.realmStage ?? "初期");
    setSectBranchId(character?.cultivationProfile?.sectBranchId ?? "");
    setSectRankId(character?.cultivationProfile?.sectRankId ?? "sect.outer-disciple");
    setTechniqueId(character?.cultivationProfile?.techniqueIds[0] ?? "");
  }

  function selectCharacter(characterId: string) {
    setSelectedCharacterId(characterId);
    applyCharacterForm(data.characters.find((character) => character.id === characterId) ?? null);
  }

  async function load() {
    const [characters, relationships, storyBibles, storyStates, worlds, worldRules, lore, timeline] = await Promise.all([
      repository.list<Character>("characters", project.id),
      repository.list<CharacterRelationship>("relationships", project.id),
      repository.list<StoryBible>("storyBibles", project.id),
      repository.list<StoryState>("storyStates", project.id),
      repository.list<World>("worlds", project.id),
      repository.list<WorldRule>("worldRules", project.id),
      repository.list<LoreEntry>("lore", project.id),
      repository.list<TimelineEvent>("timeline", project.id),
    ]);
    const ordered = characters.sort((left, right) => left.name.localeCompare(right.name, "zh-Hant"));
    const nextSelectedId = selectedCharacterId && (selectedCharacterId === "__new__" || ordered.some((character) => character.id === selectedCharacterId))
      ? selectedCharacterId
      : ordered[0]?.id ?? "__new__";
    setData({ characters: ordered, relationships, storyBibles, storyStates, worlds, worldRules, lore, timeline });
    setSelectedCharacterId(nextSelectedId);
    applyCharacterForm(ordered.find((character) => character.id === nextSelectedId) ?? null);
    setFromId((current) => current || ordered[0]?.id || "");
    setToId((current) => current || ordered.find((character) => character.id !== (ordered[0]?.id || ""))?.id || "");
    const storyBible = storyBibles.find((item) => item.id === project.storyBibleId) ?? storyBibles[0] ?? null;
    const storyState = storyStates.find((item) => item.id === project.storyStateId) ?? storyStates[0] ?? null;
    const nextWorldId = storyState?.activeWorldId ?? storyBible?.worldId ?? worlds[0]?.id ?? "";
    setSelectedWorldId(nextWorldId);
    applyWorldForm(worlds.find((world) => world.id === nextWorldId) ?? worlds[0] ?? null);
    applyBibleForm(storyBible);
    const nextRuleId = selectedRuleId !== "__new__" && worldRules.some((rule) => rule.id === selectedRuleId)
      ? selectedRuleId
      : worldRules[0]?.id ?? "__new__";
    setSelectedRuleId(nextRuleId);
    applyRuleForm(worldRules.find((rule) => rule.id === nextRuleId) ?? null);
    const nextLoreId = selectedLoreId !== "__new__" && lore.some((entry) => entry.id === selectedLoreId)
      ? selectedLoreId
      : lore[0]?.id ?? "__new__";
    setSelectedLoreId(nextLoreId);
    applyLoreForm(lore.find((entry) => entry.id === nextLoreId) ?? null);
    const nextTimelineId = selectedTimelineId !== "__new__" && timeline.some((event) => event.id === selectedTimelineId)
      ? selectedTimelineId
      : timeline[0]?.id ?? "__new__";
    setSelectedTimelineId(nextTimelineId);
    applyTimelineForm(timeline.find((event) => event.id === nextTimelineId) ?? null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCharacter = data.characters.find((character) => character.id === selectedCharacterId) ?? null;
  const storyBible = data.storyBibles.find((item) => item.id === project.storyBibleId) ?? data.storyBibles[0] ?? null;
  const storyState = data.storyStates.find((item) => item.id === project.storyStateId) ?? data.storyStates[0] ?? null;
  const baselineWorld = storyBible?.worldId
    ? data.worlds.find((world) => world.id === storyBible.worldId) ?? null
    : null;
  const crossEraCanon = explicitCrossEraCanonAuthorization({
    project,
    storyBible,
    worldRules: data.worldRules,
    baselineWorld,
  });

  const selectedWorld = selectedWorldId === "__new__"
    ? null
    : data.worlds.find((world) => world.id === selectedWorldId)
      ?? data.worlds.find((world) => world.id === storyState?.activeWorldId)
      ?? data.worlds.find((world) => world.id === storyBible?.worldId)
      ?? data.worlds[0]
      ?? null;
  const activeWorlds = selectedWorld ? [selectedWorld] : [];
  const suggestions = professionSuggestions(project, activeWorlds);
  const worldContext = selectedWorld
    ? worldEraContext(selectedWorld)
    : professionWorldContext(project, []);
  const worldSignal = [selectedWorld?.name.value, selectedWorld?.era.value, selectedWorld?.summary.value].filter(Boolean).join(" ");
  const managementEra = resolveManagementEra(worldSignal);
  const investmentCatalog = managementInvestmentCatalog(worldSignal);
  const techniques = useMemo(
    () => sectTechniqueCatalog(project.proceduralRootSeed ?? project.id),
    [project.id, project.proceduralRootSeed],
  );
  const sectBranches = useMemo(
    () => sectBranchCatalog(project.proceduralRootSeed ?? project.id),
    [project.id, project.proceduralRootSeed],
  );
  const selectedTechniqueId = techniqueId || techniques[0]?.id || "";
  const selectedSectBranchId = sectBranchId || sectBranches[0]?.id || "";
  const names = new Map(data.characters.map((character) => [character.id, character.name]));
  const charactersById = new Map(data.characters.map((character) => [character.id, character]));
  const compatibleCharacters = data.characters.filter((character) => isCharacterEraCompatible({ character, project, worlds: activeWorlds }));
  const incompatibleCharacterIds = new Set(data.characters.filter((character) => !compatibleCharacters.includes(character)).map((character) => character.id));
  const defaultActiveCharacterIds = storyBible?.characterIds.length
    ? storyBible.characterIds.filter((id) => !incompatibleCharacterIds.has(id))
    : compatibleCharacters.map((character) => character.id);
  const activeCharacterIds = new Set(
    (storyState?.activeCharacterIds ?? defaultActiveCharacterIds)
      .filter((id) => !incompatibleCharacterIds.has(id)),
  );
  for (const protagonistId of storyBible?.protagonistIds ?? []) {
    if (!incompatibleCharacterIds.has(protagonistId)) activeCharacterIds.add(protagonistId);
  }
  const activeWorldRuleIds = new Set(storyState?.activeWorldRuleIds ?? storyBible?.worldRuleIds ?? data.worldRules.map((rule) => rule.id));
  const activeLoreIds = new Set(storyState?.activeLoreIds ?? storyBible?.loreIds ?? data.lore.map((entry) => entry.id));
  const activeTimelineEventIds = new Set(storyState?.activeTimelineEventIds ?? storyBible?.timelineEventIds ?? data.timeline.map((event) => event.id));
  const usesCultivationCanon = worldContext === "cultivation"
    || (worldContext === "cross-era" && (
      Boolean(selectedCharacter?.cultivationProfile)
      || CULTIVATION_PROFESSIONS.some((item) => profession.includes(item))
    ));
  const organizationCatalog = worldContext === "historical"
    ? HISTORICAL_ORGANIZATION_CATALOG
    : worldContext === "future"
      ? FUTURE_ORGANIZATION_CATALOG
      : worldContext === "cross-era"
        ? [...MODERN_ORGANIZATION_CATALOG, ...HISTORICAL_ORGANIZATION_CATALOG, ...FUTURE_ORGANIZATION_CATALOG]
        : MODERN_ORGANIZATION_CATALOG;
  const worldContextLabel = worldContext === "cultivation"
    ? "修仙職業庫"
    : worldContext === "historical"
      ? "古代／歷史職業庫"
      : worldContext === "future"
        ? "未來職業庫"
        : worldContext === "modern"
          ? "現代職業庫"
          : "跨時代職業庫";
  const organizationContextLabel = worldContext === "historical"
    ? "古代宗族、朝廷、商會與書院"
    : worldContext === "future"
      ? "未來企業、星際政體與自治群落"
      : worldContext === "cross-era"
        ? "各時代公司、宗族、勢力與國家"
      : "現代公司、家族企業、勢力與國家";

  async function updateStoryStage(
    patch: Partial<Pick<StoryState,
      "activeCharacterIds" | "activeWorldId" | "activeWorldRuleIds" | "activeLoreIds" | "activeTimelineEventIds">>,
    nextMessage: string,
  ) {
    if (!storyState) {
      setMessage("作品缺少 StoryState；上場選擇沒有寫入，也沒有改動正式資料。");
      return;
    }
    setBusy(true);
    try {
      const latest = await repository.get<StoryState>("storyStates", storyState.id);
      if (!latest) throw new Error("STORY_STATE_NOT_FOUND");
      await repository.put<StoryState>("storyStates", { ...latest, ...patch }, latest.revision);
      await finish(nextMessage);
    } catch (cause) {
      setMessage(`上場設定儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActiveCharacter(character: Character) {
    if (incompatibleCharacterIds.has(character.id)) {
      setMessage(`「${character.name}」的時代屬性與目前故事不相容；請先在世界前提明確設定穿越或跨時代。`);
      return;
    }
    if (storyBible?.protagonistIds.includes(character.id) && activeCharacterIds.has(character.id)) {
      setMessage("主角必須留在上場名單；可調整其他配角。 ");
      return;
    }
    const next = new Set(activeCharacterIds);
    if (next.has(character.id)) next.delete(character.id);
    else next.add(character.id);
    for (const protagonistId of storyBible?.protagonistIds ?? []) next.add(protagonistId);
    await updateStoryStage(
      { activeCharacterIds: [...next] },
      next.has(character.id)
        ? `「${character.name}」已加入上場名單；後續續寫與 RPG 會讀取這名人物。`
        : `「${character.name}」已改為候場；正式人物資料仍完整保留。`,
    );
  }

  async function toggleActiveReference(
    field: "activeWorldRuleIds" | "activeLoreIds" | "activeTimelineEventIds",
    current: Set<string>,
    id: string,
    label: string,
  ) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    await updateStoryStage({ [field]: [...next] }, `${label}已${next.has(id) ? "加入" : "移出"}目前故事的上場脈絡。`);
  }

  async function selectActiveWorld(world: World) {
    const baseline = baselineWorld ?? data.worlds[0] ?? null;
    const baselineEra = baseline ? worldEraContext(baseline) : null;
    const requestedEra = worldEraContext(world);
    const requiresCrossEraCanon = requestedEra === "cross-era"
      || Boolean(baseline && baselineEra !== requestedEra);
    if (requiresCrossEraCanon && !crossEraCanon.authorized) {
      setMessage(`「${world.name.value ?? "未命名世界"}」不能直接加入：候選世界自稱跨時代不算授權，必須先在既有 Story Bible、世界規則或專案設定中有明確的穿越／跨時代 Canon。`);
      return;
    }
    setSelectedWorldId(world.id);
    applyWorldForm(world);
    await updateStoryStage({ activeWorldId: world.id }, `已把「${world.name.value ?? "未命名世界"}」設為目前上場世界。`);
  }

  async function saveWorld(event: React.FormEvent) {
    event.preventDefault();
    const creating = selectedWorldId === "__new__";
    if (!selectedWorld && !creating) return;
    if (!worldName.trim()) {
      setMessage("世界名稱不能留白。");
      return;
    }
    setBusy(true);
    try {
      const saved = await repository.put<World>("worlds", {
        ...(selectedWorld ?? makeRecord(project.id, "user")),
        name: optionalValue(worldName.trim() || null, worldName.trim() ? "user_defined" : "unset"),
        era: optionalValue(worldEra.trim() || null, worldEra.trim() ? "user_defined" : "unset"),
        summary: optionalValue(worldSummary.trim() || null, worldSummary.trim() ? "user_defined" : "unset"),
      }, selectedWorld?.revision);
      if (creating) {
        for (const bible of data.storyBibles) {
          if (bible.worldId) continue;
          await repository.put<StoryBible>("storyBibles", { ...bible, worldId: saved.id }, bible.revision);
        }
        if (storyState && !storyState.activeWorldId) {
          await repository.put<StoryState>("storyStates", { ...storyState, activeWorldId: saved.id }, storyState.revision);
        }
        setSelectedWorldId(saved.id);
      }
      await finish(creating
        ? "新世界已在首頁建立；請確認是否設為目前上場世界。"
        : "世界名稱、時代與背景已在首頁更新。故事內只會讀取這份正式設定。 ");
      if (creating) setSelectedWorldId(saved.id);
    } catch (cause) {
      setMessage(`世界儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeSelectedWorld() {
    if (!selectedWorld) return;
    if (!confirm(`確定刪除世界「${selectedWorld.name.value ?? "未命名世界"}」嗎？`)) return;
    setBusy(true);
    try {
      for (const bible of data.storyBibles) {
        if (bible.worldId !== selectedWorld.id) continue;
        await repository.put<StoryBible>("storyBibles", { ...bible, worldId: null }, bible.revision);
      }
      if (storyState?.activeWorldId === selectedWorld.id) {
        await repository.put<StoryState>("storyStates", { ...storyState, activeWorldId: undefined }, storyState.revision);
      }
      await repository.remove("worlds", selectedWorld.id);
      setSelectedWorldId("__new__");
      applyWorldForm(null);
      await finish("世界已從正式資料移除。 ");
      setSelectedWorldId("__new__");
      applyWorldForm(null);
    } catch (cause) {
      setMessage(`世界刪除失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveStoryBible(event: React.FormEvent) {
    event.preventDefault();
    if (!storyBible) return;
    setBusy(true);
    try {
      await repository.put<StoryBible>("storyBibles", {
        ...storyBible,
        theme: optionalValue(bibleTheme.trim() || null, bibleTheme.trim() ? "user_defined" : "unset"),
        style: optionalValue(bibleStyle.trim() || null, bibleStyle.trim() ? "user_defined" : "unset"),
        foreshadowing: textLines(bibleForeshadowing),
        unresolvedThreads: textLines(bibleThreads),
        forbiddenContradictions: textLines(bibleContradictions),
        authorPreferences: textLines(biblePreferences),
      }, storyBible.revision);
      await finish("Story Bible 已保存；主題、文風、伏筆、未解線索、禁止矛盾與作者偏好已在首頁更新。 ");
    } catch (cause) {
      setMessage(`故事記憶儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    if (!ruleTitle.trim() || !ruleDescription.trim()) {
      setMessage("世界規則需要名稱與內容。");
      return;
    }
    setBusy(true);
    try {
      const existing = data.worldRules.find((rule) => rule.id === selectedRuleId) ?? null;
      const saved = await repository.put<WorldRule>("worldRules", {
        ...(existing ?? makeRecord(project.id, "user")),
        title: ruleTitle.trim(),
        description: ruleDescription.trim(),
        immutable: ruleImmutable,
      }, existing?.revision);
      if (!existing) {
        for (const bible of data.storyBibles) {
          await repository.put<StoryBible>("storyBibles", {
            ...bible,
            worldRuleIds: [...new Set([...bible.worldRuleIds, saved.id])],
          }, bible.revision);
        }
        setSelectedRuleId(saved.id);
      }
      await finish(existing ? "世界規則已在首頁更新。" : "世界規則已在首頁建立並接入 Story Bible。");
      if (!existing) setSelectedRuleId(saved.id);
    } catch (cause) {
      setMessage(`世界規則儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveLore(event: React.FormEvent) {
    event.preventDefault();
    if (!loreTitle.trim() || !loreContent.trim()) {
      setMessage("故事記憶需要名稱與內容。");
      return;
    }
    setBusy(true);
    try {
      const existing = data.lore.find((entry) => entry.id === selectedLoreId) ?? null;
      const saved = await repository.put<LoreEntry>("lore", {
        ...(existing ?? makeRecord(project.id, "user")),
        kind: loreKind,
        title: loreTitle.trim(),
        content: loreContent.trim(),
      }, existing?.revision);
      if (!existing) {
        for (const bible of data.storyBibles) {
          await repository.put<StoryBible>("storyBibles", {
            ...bible,
            loreIds: [...new Set([...bible.loreIds, saved.id])],
          }, bible.revision);
        }
        setSelectedLoreId(saved.id);
      }
      await finish(existing ? "故事記憶已在首頁更新。" : "故事記憶已在首頁建立並接入 Story Bible。");
      if (!existing) setSelectedLoreId(saved.id);
    } catch (cause) {
      setMessage(`故事記憶儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveTimeline(event: React.FormEvent) {
    event.preventDefault();
    if (!timelineTitle.trim() || !timelineSummary.trim()) {
      setMessage("時間線事件需要名稱與摘要。");
      return;
    }
    setBusy(true);
    try {
      const existing = data.timeline.find((item) => item.id === selectedTimelineId) ?? null;
      const saved = await repository.put<TimelineEvent>("timeline", {
        ...(existing ?? makeRecord(project.id, "user")),
        chapterId: existing?.chapterId ?? null,
        storyTime: timelineStoryTime.trim() || null,
        title: timelineTitle.trim(),
        summary: timelineSummary.trim(),
      }, existing?.revision);
      if (!existing) {
        for (const bible of data.storyBibles) {
          await repository.put<StoryBible>("storyBibles", {
            ...bible,
            timelineEventIds: [...new Set([...bible.timelineEventIds, saved.id])],
          }, bible.revision);
        }
        setSelectedTimelineId(saved.id);
      }
      await finish(existing ? "時間線事件已在首頁更新。" : "時間線事件已在首頁建立並接入 Story Bible。");
      if (!existing) setSelectedTimelineId(saved.id);
    } catch (cause) {
      setMessage(`時間線儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeSelectedRule() {
    const rule = data.worldRules.find((item) => item.id === selectedRuleId) ?? null;
    if (!rule) return;
    if (!confirm(`確定刪除世界規則「${rule.title}」嗎？`)) return;
    setBusy(true);
    try {
      for (const bible of data.storyBibles) {
        await repository.put<StoryBible>("storyBibles", {
          ...bible,
          worldRuleIds: bible.worldRuleIds.filter((id) => id !== rule.id),
        }, bible.revision);
      }
      if (storyState) {
        await repository.put<StoryState>("storyStates", {
          ...storyState,
          activeWorldRuleIds: storyState.activeWorldRuleIds?.filter((id) => id !== rule.id),
        }, storyState.revision);
      }
      await repository.remove("worldRules", rule.id);
      setSelectedRuleId("__new__");
      applyRuleForm(null);
      await finish("世界規則已移除。 ");
      setSelectedRuleId("__new__");
      applyRuleForm(null);
    } catch (cause) {
      setMessage(`世界規則刪除失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeSelectedLore() {
    const entry = data.lore.find((item) => item.id === selectedLoreId) ?? null;
    if (!entry || !confirm(`確定刪除故事記憶「${entry.title}」嗎？`)) return;
    setBusy(true);
    try {
      for (const bible of data.storyBibles) {
        await repository.put<StoryBible>("storyBibles", {
          ...bible,
          loreIds: bible.loreIds.filter((id) => id !== entry.id),
        }, bible.revision);
      }
      if (storyState) {
        await repository.put<StoryState>("storyStates", {
          ...storyState,
          activeLoreIds: storyState.activeLoreIds?.filter((id) => id !== entry.id),
        }, storyState.revision);
      }
      await repository.remove("lore", entry.id);
      setSelectedLoreId("__new__");
      applyLoreForm(null);
      await finish("故事記憶已移除。 ");
      setSelectedLoreId("__new__");
      applyLoreForm(null);
    } catch (cause) {
      setMessage(`故事記憶刪除失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeSelectedTimeline() {
    const event = data.timeline.find((item) => item.id === selectedTimelineId) ?? null;
    if (!event || !confirm(`確定刪除時間線事件「${event.title}」嗎？`)) return;
    setBusy(true);
    try {
      for (const bible of data.storyBibles) {
        await repository.put<StoryBible>("storyBibles", {
          ...bible,
          timelineEventIds: bible.timelineEventIds.filter((id) => id !== event.id),
        }, bible.revision);
      }
      if (storyState) {
        await repository.put<StoryState>("storyStates", {
          ...storyState,
          activeTimelineEventIds: storyState.activeTimelineEventIds?.filter((id) => id !== event.id),
        }, storyState.revision);
      }
      await repository.remove("timeline", event.id);
      setSelectedTimelineId("__new__");
      applyTimelineForm(null);
      await finish("時間線事件已移除。 ");
      setSelectedTimelineId("__new__");
      applyTimelineForm(null);
    } catch (cause) {
      setMessage(`時間線刪除失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function finish(nextMessage: string) {
    await load();
    await onChanged?.();
    setMessage(nextMessage);
  }

  async function saveCharacter(event: React.FormEvent) {
    event.preventDefault();
    const creating = selectedCharacterId === "__new__";
    if (!selectedCharacter && !creating) return;
    if (!name.trim()) {
      setMessage("人物姓名不能留白。");
      return;
    }
    const continuityError = professionContinuityError(profession, project, activeWorlds);
    if (continuityError) {
      setMessage(continuityError);
      return;
    }
    const normalizedProfession = profession.trim();
    const duplicateProfession = normalizedProfession
      ? data.characters.find((character) => character.id !== selectedCharacter?.id
        && character.identity.value?.trim() === normalizedProfession)
      : null;
    if (duplicateProfession) {
      setMessage(`「${normalizedProfession}」已由${duplicateProfession.name}擔任；請替每位人物安排不同職業或專長。`);
      return;
    }
    if (usesCultivationCanon) {
      const rank = SECT_RANK_CATALOG.find((item) => item.id === sectRankId);
      const realmIndex = CULTIVATION_REALMS.findIndex((item) => item.id === realmId);
      const minimumIndex = CULTIVATION_REALMS.findIndex((item) => item.id === rank?.minimumRealmId);
      if (rank && realmIndex >= 0 && minimumIndex > realmIndex) {
        setMessage(`${rank.name}至少需要達到${CULTIVATION_REALMS[minimumIndex]?.name}；請調整境界或宗門位階。`);
        return;
      }
      const technique = techniques.find((item) => item.id === selectedTechniqueId);
      if (technique && !["root.dual", "root.mixed", technique.compatibleSpiritRootId].includes(spiritRootId)) {
        const requiredRoot = SPIRIT_ROOT_CATALOG.find((item) => item.id === technique.compatibleSpiritRootId)?.name;
        setMessage(`${technique.name}主要相容${requiredRoot}；目前靈根不符。可改選功法，或使用雙靈根／雜靈根並在故事中承擔修煉代價。`);
        return;
      }
    }
    setBusy(true);
    try {
      const baseCharacter: Character = selectedCharacter ?? {
        ...makeRecord(project.id, "user"),
        name: name.trim(),
        aliases: [],
        identity: optionalValue<string>(null, "unset"),
        personality: optionalValue<string>(null, "unset"),
        goal: optionalValue<string>(null, "unset"),
        lifeStatus: "alive",
        locationId: null,
        age: null,
        ageVerified: false,
        fears: [],
        privateSecrets: [],
        factionIds: [],
        values: [],
        capabilities: [],
        limitations: [],
        portrait: null,
        rpgProfile: null,
        dynamicsProfile: null,
        socialMatrixProfile: null,
        cultivationProfile: null,
      };
      const portrait = suggestedCharacterPortrait({ character: baseCharacter, project, worlds: activeWorlds });
      const saved = await repository.put<Character>("characters", {
        ...baseCharacter,
        name: name.trim() || baseCharacter.name,
        identity: optionalValue(profession.trim() || null, profession.trim() ? "user_defined" : "unset"),
        rpgProfile: createCharacterRpgProfile({
          archetype: rpgArchetype,
          stats: rpgStats,
        }),
        portrait: baseCharacter.portrait?.source === "upload" || baseCharacter.portrait?.source === "catalog"
          ? baseCharacter.portrait
          : {
              ...portrait,
              approvedAt: new Date().toISOString(),
              approvedBy: "user",
              dataLeftDevice: false,
            },
        cultivationProfile: usesCultivationCanon ? {
          schemaVersion: "character-cultivation-profile-v1",
          spiritRootId,
          realmId,
          realmStage,
          sectBranchId: selectedSectBranchId,
          sectRankId,
          techniqueIds: selectedTechniqueId ? [selectedTechniqueId] : [],
          approvedAt: new Date().toISOString(),
          } : null,
      }, selectedCharacter?.revision);
      if (creating) {
        for (const bible of data.storyBibles) {
          if (bible.characterIds.includes(saved.id)) continue;
          await repository.put<StoryBible>("storyBibles", {
            ...bible,
            characterIds: [...bible.characterIds, saved.id],
          }, bible.revision);
        }
        setSelectedCharacterId(saved.id);
      }
      await finish(creating
        ? "新人物已在首頁建立並加入正式人物庫；請決定是否讓他上場。"
        : "人物、能力值、境界與屬性配對人像已在首頁更新；故事內只會讀取並選擇這筆正式資料。");
      if (creating) setSelectedCharacterId(saved.id);
    } catch (cause) {
      setMessage(`人物儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeSelectedCharacter() {
    if (!selectedCharacter) return;
    if (storyBible?.protagonistIds.includes(selectedCharacter.id)) {
      setMessage("主角不能直接刪除；請先在完整人物設定中更換主角。");
      return;
    }
    if (!confirm(`確定刪除人物「${selectedCharacter.name}」及其尚未進入正文的正式關係嗎？`)) return;
    setBusy(true);
    try {
      const related = data.relationships.filter((relationship) => (
        relationship.fromCharacterId === selectedCharacter.id
        || relationship.toCharacterId === selectedCharacter.id
      ));
      for (const relationship of related) await repository.remove("relationships", relationship.id);
      for (const bible of data.storyBibles) {
        await repository.put<StoryBible>("storyBibles", {
          ...bible,
          characterIds: bible.characterIds.filter((id) => id !== selectedCharacter.id),
          protagonistIds: bible.protagonistIds.filter((id) => id !== selectedCharacter.id),
          relationshipIds: bible.relationshipIds.filter((id) => !related.some((relationship) => relationship.id === id)),
        }, bible.revision);
      }
      if (storyState) {
        await repository.put<StoryState>("storyStates", {
          ...storyState,
          activeCharacterIds: storyState.activeCharacterIds?.filter((id) => id !== selectedCharacter.id),
        }, storyState.revision);
      }
      await repository.remove("characters", selectedCharacter.id);
      setSelectedCharacterId("__new__");
      applyCharacterForm(null);
      await finish("人物與尚未進入正文的關係已移除。 ");
      setSelectedCharacterId("__new__");
      applyCharacterForm(null);
    } catch (cause) {
      setMessage(`人物刪除失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveRelationship(event: React.FormEvent) {
    event.preventDefault();
    if (!fromId || !toId || fromId === toId) {
      setMessage("關係必須連接兩個不同人物。");
      return;
    }
    setBusy(true);
    try {
      const existing = data.relationships.find((relationship) =>
        (relationship.fromCharacterId === fromId && relationship.toCharacterId === toId)
        || (relationship.fromCharacterId === toId && relationship.toCharacterId === fromId));
      const base = existing ?? makeRecord(project.id, "user");
      const saved = await repository.put<CharacterRelationship>("relationships", {
        ...base,
        fromCharacterId: fromId,
        toCharacterId: toId,
        kind,
        summary: summary.trim() || `${names.get(fromId)}與${names.get(toId)}的${kind}關係。`,
        trust: Math.max(-100, Math.min(100, Number(trust) || 0)),
      }, existing?.revision);
      for (const bible of data.storyBibles) {
        if (bible.relationshipIds.includes(saved.id)) continue;
        await repository.put<StoryBible>("storyBibles", {
          ...bible,
          relationshipIds: [...bible.relationshipIds, saved.id],
        }, bible.revision);
      }
      setSummary("");
      await finish(existing ? "人物關係已更新，故事記憶仍指向同一條關係。" : "人物關係已建立並接入故事記憶，後續敘事會使用這條關係。");
    } catch (cause) {
      setMessage(`關係儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeRelationship(relationship: CharacterRelationship) {
    if (!confirm(`確定刪除「${names.get(relationship.fromCharacterId)}－${relationship.kind}－${names.get(relationship.toCharacterId)}」嗎？`)) return;
    setBusy(true);
    try {
      const agentRelationships = await repository.list<DomainRecord & {
        relationshipId?: string;
        sourceReferences?: Array<{ entityId?: string; entityType?: string }>;
      }>("characterRelationships", project.id);
      const derivedEdges = agentRelationships.filter((edge) => edge.sourceReferences?.some((reference) => (
        reference.entityType === "relationship" && reference.entityId === relationship.id
      )));
      const derivedRelationshipIds = new Set(derivedEdges.flatMap((edge) => [edge.id, edge.relationshipId].filter((id): id is string => Boolean(id))));
      if (derivedRelationshipIds.size) {
        const relationshipEvents = await repository.list<DomainRecord & { relationshipId?: string }>("characterRelationshipEvents", project.id);
        for (const event of relationshipEvents) {
          if (event.relationshipId && derivedRelationshipIds.has(event.relationshipId)) {
            await repository.remove("characterRelationshipEvents", event.id);
          }
        }
        for (const edge of derivedEdges) {
          await repository.remove("characterRelationships", edge.id);
        }
      }
      for (const bible of data.storyBibles) {
        if (!bible.relationshipIds.includes(relationship.id)) continue;
        await repository.put<StoryBible>("storyBibles", {
          ...bible,
          relationshipIds: bible.relationshipIds.filter((id) => id !== relationship.id),
        }, bible.revision);
      }
      await repository.remove("relationships", relationship.id);
      await finish("正式關係及其角色視角投影已移除；人物本身與既有正文沒有被刪除。");
    } catch (cause) {
      setMessage(`關係刪除失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  const selectedPortrait = selectedCharacter
    ? suggestedCharacterPortrait({ character: selectedCharacter, project, worlds: activeWorlds })
    : null;

  return (
    <section id="character-world-memory-home" className="characterRelationWorkbench" data-compact={compact} data-canon-edit-surface="home" data-testid="character-relationship-workbench">
      <header>
        <div><small>CHARACTERS · WORLD · MEMORY · SAME CANON</small><h2>首頁正式設定與上場管理</h2></div>
        <span>{worldContextLabel} · {data.characters.length} 人 · {data.relationships.length} 條關係 · {CHARACTER_PORTRAIT_CAPACITY.toLocaleString("zh-TW")} 種衍生造型</span>
      </header>
      <p>首頁管理正式人物、世界與 Story Bible；故事中的工作台只選擇誰、哪個世界與哪些記憶要在目前情節上場。人物人像會依時代、身分、年齡、個性與能力從 100 張基礎人像的 100 組可重現造型中配對，不會讓不同人物共用同一張空白卡。</p>
      <p className="characterCanonLock" data-locked="false" role="status">
        首頁是正式設定的唯一編修區：無論故事是否已開始，都可修改人物、能力值、世界、Story Bible、規則、記憶與時間線；故事內只能選擇上場內容，不能改寫這些正式數值。
      </p>

      <section className="characterStageManager" aria-labelledby="character-stage-title">
        <header><div><small>ON-STAGE SELECTION</small><h3 id="character-stage-title">目前故事的上場人物、世界與記憶</h3></div><span>{activeCharacterIds.size} 人上場</span></header>
        <p>正式人物不會因候場而刪除。未設定穿越／跨時代時，其他時代的人物與世界不能加入目前故事。</p>
        <p className="characterCanonLock" data-locked={!crossEraCanon.authorized} data-testid="cross-era-canon-authorization">
          {crossEraCanon.authorized
            ? `跨時代 Canon 已授權（${crossEraCanon.sources.map((source) => CROSS_ERA_SOURCE_LABELS[source]).join("、")}）；可選擇不同時代的既有正式世界。`
            : "尚無跨時代 Canon：候選世界即使標示 cross-era／跨時代也不能自行授權，必須由既有 Story Bible、世界規則或專案設定明確建立。"}
        </p>
        <div className="characterStageGrid">
          {data.characters.map((character) => {
            const portrait = suggestedCharacterPortrait({ character, project, worlds: activeWorlds });
            const active = activeCharacterIds.has(character.id);
            const incompatible = incompatibleCharacterIds.has(character.id);
            const protagonist = storyBible?.protagonistIds.includes(character.id) ?? false;
            return <button
              type="button"
              key={character.id}
              aria-pressed={active}
              data-era-compatible={!incompatible}
              disabled={busy || incompatible}
              onClick={() => void toggleActiveCharacter(character)}
              title={incompatible ? "時代不相容；需先設定穿越或跨時代" : undefined}
            >
              <CharacterPortraitImage portrait={portrait} decorative />
              <span><b>{character.name}</b><small>{character.identity.value || "尚未設定身分"}</small><em>{incompatible ? "時代不相容" : protagonist ? "主角 · 固定上場" : active ? "上場中" : "候場"}</em></span>
            </button>;
          })}
        </div>
        {data.worlds.length ? <div className="characterStageWorlds" aria-label="上場世界">
          <strong>目前世界</strong>
          {data.worlds.map((world) => <button type="button" key={world.id} aria-pressed={storyState?.activeWorldId === world.id || (!storyState?.activeWorldId && storyBible?.worldId === world.id)} disabled={busy} onClick={() => void selectActiveWorld(world)}>
            <b>{world.name.value || "未命名世界"}</b><span>{world.era.value || "時代未設定"}</span>
          </button>)}
        </div> : null}
        <div className="characterStageReferences">
          <details><summary>上場世界規則（{activeWorldRuleIds.size}/{data.worldRules.length}）</summary>{data.worldRules.map((rule) => <label key={rule.id}><input type="checkbox" checked={activeWorldRuleIds.has(rule.id)} disabled={busy || rule.immutable} onChange={() => void toggleActiveReference("activeWorldRuleIds", activeWorldRuleIds, rule.id, `世界規則「${rule.title}」`)} /><span><b>{rule.title}</b>{rule.immutable ? " · 不可移除" : ""}</span></label>)}</details>
          <details><summary>上場故事記憶（{activeLoreIds.size}/{data.lore.length}）</summary>{data.lore.map((entry) => <label key={entry.id}><input type="checkbox" checked={activeLoreIds.has(entry.id)} disabled={busy} onChange={() => void toggleActiveReference("activeLoreIds", activeLoreIds, entry.id, `故事記憶「${entry.title}」`)} /><span><b>{entry.title}</b> · {entry.kind}</span></label>)}</details>
          <details><summary>上場時間線（{activeTimelineEventIds.size}/{data.timeline.length}）</summary>{data.timeline.map((event) => <label key={event.id}><input type="checkbox" checked={activeTimelineEventIds.has(event.id)} disabled={busy} onChange={() => void toggleActiveReference("activeTimelineEventIds", activeTimelineEventIds, event.id, `時間線「${event.title}」`)} /><span><b>{event.title}</b>{event.storyTime ? ` · ${event.storyTime}` : ""}</span></label>)}</details>
        </div>
      </section>

      <details
        className="characterHomeCharacterEditors"
        open={characterEditorsOpen}
        onToggle={(event) => setCharacterEditorsOpen(event.currentTarget.open)}
      >
        <summary>在首頁編修正式人物與人物關係</summary>
        {characterEditorsOpen ? <div className="characterRelationForms">
          <form onSubmit={saveCharacter}>
          <h3>{selectedCharacterId === "__new__" ? "在首頁建立人物" : "快速編修人物"}</h3>
          {selectedPortrait ? <div className="characterSelectedPortrait wide"><CharacterPortraitImage portrait={selectedPortrait} /><p><b>{selectedPortrait.role}</b><span>{selectedPortrait.themeLabel} · 依目前人物屬性自動配對</span><small>{selectedPortrait.visualDescription}</small></p></div> : null}
          <label>人物<select value={selectedCharacterId || "__new__"} onChange={(event) => selectCharacter(event.target.value)}><option value="__new__">＋ 建立新人物</option>{data.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
          <label>姓名<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>職業／身分<input list={`profession-${project.id}`} value={profession} onChange={(event) => setProfession(event.target.value)} placeholder={suggestions.slice(0, 4).join("、")} /></label>
          <datalist id={`profession-${project.id}`}>{suggestions.map((item) => <option key={item} value={item} />)}</datalist>
          <label className="wide">能力配置<select value={rpgArchetype} onChange={(event) => {
            const next = event.target.value as CharacterRpgArchetype;
            setRpgArchetype(next);
            setRpgStats((current) => characterRpgStatsForArchetype(next, current));
          }}>{CHARACTER_RPG_ARCHETYPES.map((item) => <option key={item.id} value={item.id}>{item.label}｜{item.description}</option>)}</select></label>
          <div className="characterHomeStats wide" aria-label="首頁正式能力值編修">
            {(Object.entries(CHARACTER_RPG_STAT_LABELS) as Array<[CharacterRpgStatKey, string]>).map(([key, label]) => <label key={key}>{label}<input type="number" min={CHARACTER_RPG_STAT_MIN} max={CHARACTER_RPG_STAT_MAX} step="1" value={rpgStats[key]} onChange={(event) => {
              const value = Number(event.target.value);
              setRpgArchetype("custom");
              setRpgStats((current) => ({ ...current, [key]: value }));
            }} /></label>)}
            <p data-valid={characterRpgPointTotal(rpgStats) === CHARACTER_RPG_POINT_BUDGET}>合計 {characterRpgPointTotal(rpgStats)} / {CHARACTER_RPG_POINT_BUDGET} 點</p>
          </div>
          {usesCultivationCanon ? <>
            <label>靈根<select value={spiritRootId} onChange={(event) => setSpiritRootId(event.target.value)}>{SPIRIT_ROOT_CATALOG.map((item) => <option key={item.id} value={item.id}>{item.name}｜{item.strength}</option>)}</select></label>
            <label>修仙境界<select value={realmId} onChange={(event) => setRealmId(event.target.value)}>{CULTIVATION_REALMS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>境界階段<select value={realmStage} onChange={(event) => setRealmStage(event.target.value as typeof realmStage)}>{["初期", "中期", "後期", "圓滿"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>所屬峰／堂／院／谷<select value={selectedSectBranchId} onChange={(event) => setSectBranchId(event.target.value)}>{sectBranches.map((item) => <option key={item.id} value={item.id}>{item.name}｜{item.discipline}</option>)}</select></label>
            <label>宗門位階<select value={sectRankId} onChange={(event) => setSectRankId(event.target.value)}>{SECT_RANK_CATALOG.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="wide">主修功法<select value={selectedTechniqueId} onChange={(event) => setTechniqueId(event.target.value)}>{techniques.map((item) => <option key={item.id} value={item.id}>{item.name}｜{item.profession}</option>)}</select></label>
          </> : null}
          <div className="wide"><button disabled={busy} type="submit">{selectedCharacterId === "__new__" ? "建立人物" : "儲存人物"}</button>{selectedCharacter ? <button disabled={busy} type="button" onClick={() => void removeSelectedCharacter()}>刪除人物</button> : null}</div>
        </form>
          {data.characters.length >= 2 ? <form onSubmit={saveRelationship}>
          <h3>建立或更新關係</h3>
          <label>人物甲<select value={fromId} onChange={(event) => setFromId(event.target.value)}>{data.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
          <label>關係<select value={kind} onChange={(event) => setKind(event.target.value)}>{RELATIONSHIP_KINDS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>人物乙<select value={toId} onChange={(event) => setToId(event.target.value)}>{data.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
          <label>信任值（-100～100）<input type="number" min="-100" max="100" value={trust} onChange={(event) => setTrust(event.target.value)} /></label>
          <label className="wide">關係歷史／目前矛盾<input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="例：同門多年，因掌門繼承問題成為競爭者" /></label>
          <button disabled={busy || data.characters.length < 2} type="submit">儲存關係</button>
          </form> : <article className="characterRelationEmpty"><h3>人物關係</h3><p>建立至少兩位人物後，即可在首頁連接正式關係。</p></article>}
        </div> : null}
      </details>

      <details
        className="characterHomeCanonEditors"
        open={canonEditorsOpen}
        onToggle={(event) => setCanonEditorsOpen(event.currentTarget.open)}
      >
        <summary>在首頁編修正式世界與 Story Bible</summary>
        {canonEditorsOpen ? <>
        <div>
          <form onSubmit={saveWorld}>
            <h3>正式世界</h3>
            <label>世界<select value={selectedWorldId || "__new__"} onChange={(event) => { const id = event.target.value; setSelectedWorldId(id); applyWorldForm(data.worlds.find((world) => world.id === id) ?? null); }}><option value="__new__">＋ 建立新世界</option>{data.worlds.map((world) => <option key={world.id} value={world.id}>{world.name.value || "未命名世界"}</option>)}</select></label>
            <label>名稱<input value={worldName} onChange={(event) => setWorldName(event.target.value)} /></label>
            <label>時代<input value={worldEra} onChange={(event) => setWorldEra(event.target.value)} /></label>
            <label className="wide">背景摘要<textarea rows={4} value={worldSummary} onChange={(event) => setWorldSummary(event.target.value)} /></label>
            <div><button type="submit" disabled={busy}>{selectedWorldId === "__new__" ? "建立世界" : "儲存世界"}</button>{selectedWorld ? <button type="button" disabled={busy} onClick={() => void removeSelectedWorld()}>刪除世界</button> : null}</div>
          </form>
          <form
            data-testid="story-bible-editor"
            data-project-id={project.id}
            onSubmit={saveStoryBible}
          >
            <h3>Story Bible</h3>
            <p className="wide">每行一項。只有在首頁按下儲存，才會更新正式 Story Bible。</p>
            <label>主題<input data-testid="story-bible-theme" value={bibleTheme} onChange={(event) => setBibleTheme(event.target.value)} /></label>
            <label>敘事風格<input data-testid="story-bible-style" value={bibleStyle} onChange={(event) => setBibleStyle(event.target.value)} /></label>
            <label className="wide">伏筆（每行一項）<textarea data-testid="story-bible-foreshadowing" rows={4} value={bibleForeshadowing} onChange={(event) => setBibleForeshadowing(event.target.value)} /></label>
            <label className="wide">未解線索（每行一項）<textarea data-testid="story-bible-unresolved" rows={4} value={bibleThreads} onChange={(event) => setBibleThreads(event.target.value)} /></label>
            <label className="wide">禁止矛盾（每行一項）<textarea data-testid="story-bible-contradictions" rows={4} value={bibleContradictions} onChange={(event) => setBibleContradictions(event.target.value)} /></label>
            <label className="wide">作者偏好（每行一項）<textarea data-testid="story-bible-preferences" rows={4} value={biblePreferences} onChange={(event) => setBiblePreferences(event.target.value)} /></label>
            <button data-testid="story-bible-save" type="submit" disabled={busy || !storyBible}>儲存 Story Bible</button>
          </form>
          {storyBible ? <article
            className="characterRelationEmpty"
            data-testid="story-bible-record"
            data-project-id={project.id}
            data-record-id={storyBible.id}
            data-revision={storyBible.revision}
          >
            <h3>目前正式 Story Bible</h3>
            <p>主題：{storyBible.theme.value || "未設定"}／風格：{storyBible.style.value || "未設定"}</p>
            <small>版本 {storyBible.revision}</small>
          </article> : null}
        </div>
        <div>
          <form onSubmit={saveRule}>
            <h3>世界規則</h3>
            <label>規則<select value={selectedRuleId} onChange={(event) => { const id = event.target.value; setSelectedRuleId(id); applyRuleForm(data.worldRules.find((rule) => rule.id === id) ?? null); }}><option value="__new__">＋ 建立新規則</option>{data.worldRules.map((rule) => <option key={rule.id} value={rule.id}>{rule.title}</option>)}</select></label>
            <label>名稱<input value={ruleTitle} onChange={(event) => setRuleTitle(event.target.value)} /></label>
            <label className="wide">內容<textarea rows={4} value={ruleDescription} onChange={(event) => setRuleDescription(event.target.value)} /></label>
            <label><input type="checkbox" checked={ruleImmutable} onChange={(event) => setRuleImmutable(event.target.checked)} /> 不可違反</label>
            <div><button type="submit" disabled={busy}>儲存規則</button>{selectedRuleId !== "__new__" ? <button type="button" disabled={busy} onClick={() => void removeSelectedRule()}>刪除規則</button> : null}</div>
          </form>
          <form onSubmit={saveLore}>
            <h3>故事記憶／Lore</h3>
            <label>記憶<select value={selectedLoreId} onChange={(event) => { const id = event.target.value; setSelectedLoreId(id); applyLoreForm(data.lore.find((entry) => entry.id === id) ?? null); }}><option value="__new__">＋ 建立新記憶</option>{data.lore.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
            <label>類型<select value={loreKind} onChange={(event) => setLoreKind(event.target.value as LoreEntry["kind"])}><option value="location">地點</option><option value="faction">勢力</option><option value="item">物品</option><option value="secret">秘密</option><option value="custom">自訂</option></select></label>
            <label>名稱<input value={loreTitle} onChange={(event) => setLoreTitle(event.target.value)} /></label>
            <label className="wide">內容<textarea rows={4} value={loreContent} onChange={(event) => setLoreContent(event.target.value)} /></label>
            <div><button type="submit" disabled={busy}>儲存記憶</button>{selectedLoreId !== "__new__" ? <button type="button" disabled={busy} onClick={() => void removeSelectedLore()}>刪除記憶</button> : null}</div>
          </form>
          <form onSubmit={saveTimeline}>
            <h3>時間線事件</h3>
            <label>事件<select value={selectedTimelineId} onChange={(event) => { const id = event.target.value; setSelectedTimelineId(id); applyTimelineForm(data.timeline.find((item) => item.id === id) ?? null); }}><option value="__new__">＋ 建立新事件</option>{data.timeline.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <label>名稱<input value={timelineTitle} onChange={(event) => setTimelineTitle(event.target.value)} /></label>
            <label>故事時間<input value={timelineStoryTime} onChange={(event) => setTimelineStoryTime(event.target.value)} /></label>
            <label className="wide">摘要<textarea rows={4} value={timelineSummary} onChange={(event) => setTimelineSummary(event.target.value)} /></label>
            <div><button type="submit" disabled={busy}>儲存事件</button>{selectedTimelineId !== "__new__" ? <button type="button" disabled={busy} onClick={() => void removeSelectedTimeline()}>刪除事件</button> : null}</div>
          </form>
        </div>
        </> : null}
      </details>
      {message ? <p className="characterRelationMessage" role="status">{message}</p> : null}
      {usesCultivationCanon ? <details className="cultivationCanonPanel" open={!compact}>
        <summary>查看宗門功法、靈根、境界與位階規則</summary>
        <div>
          <section><h3>宗門峰／堂／院／谷</h3>{sectBranches.map((item) => <p key={item.id}><b>{item.name}</b><span>{item.duty}</span></p>)}</section>
          <section><h3>宗門功法</h3>{techniques.map((item) => <p key={item.id}><b>{item.name}</b><span>{item.profession} · {SPIRIT_ROOT_CATALOG.find((root) => root.id === item.compatibleSpiritRootId)?.name} · {CULTIVATION_REALMS.find((realm) => realm.id === item.entryRealmId)?.name}可入門</span></p>)}</section>
          <section><h3>靈根</h3>{SPIRIT_ROOT_CATALOG.map((item) => <p key={item.id}><b>{item.name}</b><span>{item.strength}；限制：{item.limitation}</span></p>)}</section>
          <section><h3>境界</h3>{CULTIVATION_REALMS.map((item) => <p key={item.id}><b>{item.name}</b><span>突破：{item.requirements.join("、")}；風險：{item.risks.join("、")}</span></p>)}</section>
          <section><h3>宗門位階</h3>{SECT_RANK_CATALOG.map((item) => <p key={item.id}><b>{item.name}</b><span>{item.authority}</span></p>)}</section>
        </div>
      </details> : null}
      {!usesCultivationCanon || worldContext === "cross-era" ? <details className="cultivationCanonPanel" open={!compact}>
        <summary>查看{organizationContextLabel}規則</summary>
        <div>
          {organizationCatalog.map((item) => <section key={item.id}><h3>{item.name}</h3><p><b>職位</b><span>{item.roles.join("、")}</span></p><p><b>戰略資產</b><span>{item.strategicAssets}</span></p></section>)}
        </div>
      </details> : null}
      {usesCultivationCanon ? <details className="cultivationCanonPanel">
        <summary>查看宗門機緣、大比、洞府與秘境事件</summary>
        <div>{CULTIVATION_OPPORTUNITIES.map((item) => <section key={item.id}><h3>{item.name}</h3><p><b>准入</b><span>{item.eligibleRanks.join("、")} · 最低 {CULTIVATION_REALMS.find((realm) => realm.id === item.minimumRealmId)?.name}</span></p><p><b>收益</b><span>{item.rewards.join("、")}</span></p><p><b>風險</b><span>{item.risks.join("、")}</span></p><p><b>勢力後果</b><span>{item.factionEffects.join("、")}</span></p></section>)}</div>
      </details> : null}
      <details className="cultivationCanonPanel">
        <summary>查看{managementEra === "cultivation" ? "修仙" : managementEra === "ancient" ? "古代" : "現代"}經營投資規則</summary>
        <div>{investmentCatalog.map((item) => <section key={item.id}><h3>{item.name}</h3><p><b>{item.category}</b><span>投入：{item.capital}</span></p><p><b>週期／流動性</b><span>{item.returnCycle}／{item.liquidity}</span></p><p><b>風險</b><span>{item.principalRisk}</span></p><p><b>關係人</b><span>{item.stakeholders}</span></p></section>)}</div>
      </details>
      <div className="characterRelationNetwork" aria-label="目前人物關係">
        {data.relationships.map((relationship) => {
          const fromCharacter = charactersById.get(relationship.fromCharacterId);
          const toCharacter = charactersById.get(relationship.toCharacterId);
          return <article key={relationship.id}>
          <div className="characterRelationPerson">{fromCharacter ? <CharacterPortraitImage portrait={suggestedCharacterPortrait({ character: fromCharacter, project, worlds: activeWorlds })} decorative /> : null}<b>{names.get(relationship.fromCharacterId) ?? "未命名人物"}</b></div><span>{relationship.kind}</span><div className="characterRelationPerson" data-align="right">{toCharacter ? <CharacterPortraitImage portrait={suggestedCharacterPortrait({ character: toCharacter, project, worlds: activeWorlds })} decorative /> : null}<b>{names.get(relationship.toCharacterId) ?? "未命名人物"}</b></div>
          <p>{relationship.summary}</p><small>信任 {relationship.trust ?? "未設定"}</small>
          <button type="button" disabled={busy} onClick={() => void removeRelationship(relationship)}>移除</button>
        </article>;})}
      </div>
    </section>
  );
}
