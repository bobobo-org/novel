"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  makeRecord,
  optionalValue,
  type AcceptedChoice,
  type Chapter,
  type Character,
  type NovelProject,
  type StoryBible,
  type StoryChoiceEffect,
  type StoryState,
} from "@/lib/novel-ai/domain";
import {
  RPG_CHARACTER_LIBRARY_STORAGE_KEY,
  createRpgCharacterTemplate,
  mergeCharacterLibrary,
  parseRpgCharacterLibrary,
  type RpgCharacterTemplate,
} from "@/lib/novel-ai/game/character-library";
import CharacterPortraitImage from "../character-portrait";
import { applyStoryChoiceEffect } from "@/lib/novel-ai/game/effects";
import {
  initialProceduralPillResources,
  resolveProceduralPillUse,
  type ProceduralPillItem,
} from "@/lib/novel-ai/game/procedural-pill-engine";
import {
  DEFAULT_RPG_RULE_SETTINGS,
  RPG_FREE_WORLD_ACTIVITIES,
  RPG_FORMULA_VERSION,
  RPG_MODE_DEFINITIONS,
  RPG_STAT_DEFINITIONS,
  buildCustomRpgChoice,
  buildManagementSettlementEffect,
  buildRpgChoices,
  initialRpgResources,
  initialRpgStats,
  normalizeRpgRuleSettings,
  readRpgProgression,
  resolveRpgChoice,
  rpgFormulaExplanation,
  statLabel,
  type RpgChoice,
  type RpgChoiceResolution,
  type RpgInventoryStack,
  type RpgMode,
  type RpgRuleSettings,
} from "@/lib/novel-ai/game/progression/rpg-progression";
import {
  XIANXIA_RULE_KIND_OPTIONS,
  generateXianxiaRuleCandidate,
  type XianxiaRuleCandidate,
  type XianxiaRuleKind,
} from "@/lib/novel-ai/game/xianxia-procedural-rule-packs";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  acceptStudioChoice,
  persistStudioChoiceCandidate,
  type StudioProjectSeed,
} from "@/lib/novel-ai/repository/studio-canonical";
import ProjectNavigation from "../project-navigation";
import styles from "./rpg.module.css";

type WorkspaceData = {
  project: NovelProject;
  chapter: Chapter;
  storyState: StoryState;
  storyBible: StoryBible;
  characters: Character[];
  acceptedChoices: AcceptedChoice[];
};

type DetailPanel = "inventory" | "quests" | "relationships" | "log" | "rules" | "characters";

const FORMULA = rpgFormulaExplanation();
const MODE_STORAGE_PREFIX = "novel:rpg-mode:v2:";
const RULE_STORAGE_PREFIX = "novel:rpg-rules:v2:";

const emptyEffect = (): StoryChoiceEffect => ({
  statChanges: {},
  relationshipChanges: {},
  resourceChanges: {},
  moneyChange: 0,
  worldFlags: {},
  questProgress: {},
  achievementProgress: {},
  timelineEvents: [],
});

function readCustomLibrary() {
  try {
    return parseRpgCharacterLibrary(
      typeof window.localStorage === "undefined"
        ? null
        : window.localStorage.getItem(RPG_CHARACTER_LIBRARY_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

function readStoredMode(projectId: string): RpgMode {
  try {
    const value = window.localStorage?.getItem(`${MODE_STORAGE_PREFIX}${projectId}`);
    return value === "cultivation" || value === "management" ? value : "adventure";
  } catch {
    return "adventure";
  }
}

function readStoredRules(projectId: string) {
  try {
    return normalizeRpgRuleSettings(JSON.parse(
      window.localStorage?.getItem(`${RULE_STORAGE_PREFIX}${projectId}`) ?? "{}",
    ));
  } catch {
    return DEFAULT_RPG_RULE_SETTINGS;
  }
}

function studioSeed(data: WorkspaceData): StudioProjectSeed {
  const protagonist = data.characters.find((character) =>
    data.storyBible.protagonistIds.includes(character.id)) ?? data.characters[0];
  return {
    id: data.project.id,
    title: data.project.title,
    chapterTitle: data.chapter.title,
    draft: data.chapter.content,
    packId: data.project.genrePackId,
    topicId: data.project.genreId,
    subCategory: data.project.subgenreId,
    coreIdea: data.project.coreIdea.value,
    protagonist: protagonist?.name ?? null,
    style: data.project.narrativeStyle.value,
  };
}

function errorMessage(error: unknown) {
  const code = String((error as { code?: string })?.code ?? "");
  const labels: Record<string, string> = {
    PROJECT_REVISION_CONFLICT: "作品在你選擇時已有更新，請重新整理三選一。",
    CHAPTER_REVISION_CONFLICT: "章節內容已更新，請重新整理三選一。",
    STORY_STATE_REVISION_CONFLICT: "能力值已有新變化，請重新整理。",
    CANDIDATE_STALE: "這個選項已過期，請產生新一輪選擇。",
    RPG_CHARACTER_NAME_REQUIRED: "角色姓名不能空白。",
    RPG_CUSTOM_ACTION_REQUIRED: "請先輸入你想採取的自由行動。",
  };
  return labels[code] ?? (error instanceof Error ? error.message : "操作未完成，請再試一次。");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 }).format(value);
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function sceneExcerpt(content: string) {
  const clean = content.trim();
  if (!clean) return "故事還沒有正文。先建立一段場景，再讓三選一推動它。";
  return clean.length > 1_200 ? `…${clean.slice(-1_200)}` : clean;
}

function Meter({ label, value, inverted = false }: { label: string; value: number; inverted?: boolean }) {
  const tone = inverted
    ? value >= 75 ? "danger" : value >= 50 ? "warning" : "good"
    : value <= 25 ? "danger" : value <= 55 ? "warning" : "good";
  return (
    <div className={styles.meter} data-tone={tone}>
      <div><span>{label}</span><b>{Math.round(value)}</b></div>
      <progress max={100} value={value} />
    </div>
  );
}

export default function RpgWorkspace({ projectId }: { projectId: string }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [customLibrary, setCustomLibrary] = useState<RpgCharacterTemplate[]>([]);
  const [status, setStatus] = useState("正在載入故事狀態與角色養成資料。");
  const [busy, setBusy] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<RpgChoice | null>(null);
  const [lastResolution, setLastResolution] = useState<RpgChoiceResolution | null>(null);
  const [activeMode, setActiveMode] = useState<RpgMode>("adventure");
  const [activePanel, setActivePanel] = useState<DetailPanel>("inventory");
  const [rules, setRules] = useState<RpgRuleSettings>(DEFAULT_RPG_RULE_SETTINGS);
  const [customAction, setCustomAction] = useState("");
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("");
  const [identity, setIdentity] = useState("");
  const [personality, setPersonality] = useState("");
  const [goal, setGoal] = useState("");
  const [xianxiaRuleKind, setXianxiaRuleKind] = useState<XianxiaRuleKind>("talisman");
  const [xianxiaRuleVariant, setXianxiaRuleVariant] = useState(0);

  const load = useCallback(async () => {
    const repository = createNovelRepository();
    const loadedProject = await repository.get<NovelProject>("projects", projectId);
    if (!loadedProject) throw new Error("找不到這個作品。");
    let project: NovelProject = loadedProject;
    const [chapters, states, bibles, characters, acceptedChoices] = await Promise.all([
      repository.list<Chapter>("chapters", projectId),
      repository.list<StoryState>("storyStates", projectId),
      repository.list<StoryBible>("storyBibles", projectId),
      repository.list<Character>("characters", projectId),
      repository.listAcceptedChoices(projectId),
    ]);
    let chapter = chapters.find((item) => item.id === project.activeChapterId)
      ?? [...chapters].sort((left, right) => left.order - right.order).at(-1);
    if (!chapter) {
      const chapterBase = makeRecord(projectId, "user");
      chapter = await repository.put<Chapter>("chapters", {
        ...chapterBase,
        title: "第一章",
        order: 1,
        content: "",
        summary: null,
        status: "draft",
      });
      project = await repository.put<NovelProject>("projects", {
        ...project,
        activeChapterId: chapter.id,
      }, project.revision);
    }
    const storyState = states.find((item) => item.id === project.storyStateId) ?? states[0];
    const storyBible = bibles.find((item) => item.id === project.storyBibleId) ?? bibles[0];
    if (!chapter || !storyState || !storyBible) {
      throw new Error("作品缺少章節、故事狀態或 Story Bible，無法啟動 RPG。");
    }
    setData({
      project,
      chapter,
      storyState,
      storyBible,
      characters,
      acceptedChoices: [...acceptedChoices].sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt)),
    });
    setStatus("RPG、養成、經營規則引擎與正式故事狀態已同步。");
  }, [projectId]);

  useEffect(() => {
    void Promise.resolve()
      .then(() => {
        setCustomLibrary(readCustomLibrary());
        setActiveMode(readStoredMode(projectId));
        setRules(readStoredRules(projectId));
      })
      .then(load)
      .catch((error) => setStatus(errorMessage(error)));
  }, [load, projectId]);

  const protagonist = data?.characters.find((character) =>
    data.storyBible.protagonistIds.includes(character.id)) ?? data?.characters[0] ?? null;
  const progression = useMemo(
    () => data
      ? readRpgProgression(data.storyState, `${data.project.title}|${protagonist?.name ?? ""}`, activeMode)
      : null,
    [activeMode, data, protagonist?.name],
  );
  const activated = Boolean(data?.storyState.protagonistStats["rpg.xp"] !== undefined);
  const conflict = data?.project.coreIdea.value
    ?? data?.chapter.summary
    ?? data?.chapter.content.slice(-180)
    ?? "目前局勢";
  const choices = useMemo(
    () => data && progression
      ? buildRpgChoices({
        progression,
        protagonist: protagonist?.name ?? "主角",
        chapterTitle: data.chapter.title,
        conflict,
        mode: activeMode,
        variant: progression.choiceVariant,
        seed: `${data.project.id}|${data.storyState.revision}`,
        rules,
      })
      : [],
    [activeMode, conflict, data, progression, protagonist?.name, rules],
  );
  const library = useMemo(() => mergeCharacterLibrary(customLibrary), [customLibrary]);
  const xianxiaRuleCandidate = useMemo<XianxiaRuleCandidate | null>(() => {
    if (!data || !progression) return null;
    const recent = typeof data.storyState.worldFlags["xianxia.recentRuleIds"] === "string"
      ? String(data.storyState.worldFlags["xianxia.recentRuleIds"]).split(",").filter(Boolean).slice(-8)
      : [];
    return generateXianxiaRuleCandidate({
      runSeed: progression.procedural.runSeed,
      kind: xianxiaRuleKind,
      turn: progression.turn,
      variant: xianxiaRuleVariant,
      recentRuleIds: recent,
      adultMode: data.project.adultMode,
    });
  }, [data, progression, xianxiaRuleKind, xianxiaRuleVariant]);

  function persistCustomLibrary(next: RpgCharacterTemplate[]) {
    setCustomLibrary(next);
    try {
      window.localStorage?.setItem(
        RPG_CHARACTER_LIBRARY_STORAGE_KEY,
        JSON.stringify(next.filter((template) => !template.builtin)),
      );
    } catch {
      setStatus("人物已保留在本次工作階段；瀏覽器封鎖本機儲存，重新開啟後可能不會保留。");
    }
  }

  function chooseMode(mode: RpgMode) {
    setActiveMode(mode);
    setSelectedChoice(null);
    setLastResolution(null);
    try {
      window.localStorage?.setItem(`${MODE_STORAGE_PREFIX}${projectId}`, mode);
    } catch {
      // The mode remains available for this session even if browser storage is blocked.
    }
    setStatus(`已切換至${RPG_MODE_DEFINITIONS[mode].label}；共用 Canon 與角色，不會建立另一套互不相干的遊戲。`);
  }

  function updateRules(next: RpgRuleSettings) {
    const normalized = normalizeRpgRuleSettings(next);
    setRules(normalized);
    setSelectedChoice(null);
    try {
      window.localStorage?.setItem(`${RULE_STORAGE_PREFIX}${projectId}`, JSON.stringify(normalized));
    } catch {
      // Rules still apply to this browser session.
    }
    setStatus("作者規則已套用；選項池與成長／風險計算已重新整理。");
  }

  async function initializeProgression() {
    if (!data || busy) return;
    setBusy(true);
    try {
      const defaults = protagonist?.rpgProfile?.formulaVersion === RPG_FORMULA_VERSION
        ? { ...protagonist.rpgProfile.stats }
        : initialRpgStats(`${data.project.title}|${protagonist?.name ?? ""}`);
      const existingSeed = data.storyState.worldFlags["rpg.runSeed"];
      const runSeed = typeof existingSeed === "string" && existingSeed ? existingSeed : crypto.randomUUID();
      const cycle = Math.max(1, Number(data.storyState.worldFlags["rpg.cycle"] ?? 1));
      const resources = {
        ...initialRpgResources(),
        ...initialProceduralPillResources(runSeed, cycle, 6),
      };
      await createNovelRepository().put<StoryState>("storyStates", {
        ...data.storyState,
        protagonistStats: {
          ...defaults,
          ...data.storyState.protagonistStats,
          "rpg.xp": data.storyState.protagonistStats["rpg.xp"] ?? 0,
        },
        resources: { ...resources, ...data.storyState.resources },
        money: data.storyState.money ?? 1_200,
        reputation: data.storyState.reputation ?? 20,
        locationState: data.storyState.locationState ?? "未命名邊境城",
        timeState: data.storyState.timeState ?? "第 1 日・清晨",
        riskState: data.storyState.riskState ?? "穩定",
        worldFlags: {
          "rpg.runSeed": runSeed,
          "rpg.cycle": cycle,
          "rpg.equipped.weapon": "iron-sword",
          "rpg.equipped.armor": "traveler-armor",
          "rpg.equipped.treasure": "contract-seal",
          ...(protagonist ? {
            "rpg.protagonistCharacterId": protagonist.id,
            "rpg.initialStatsSource": protagonist.rpgProfile ? "approved-character-profile" : "seeded-default",
          } : {}),
          ...data.storyState.worldFlags,
        },
      }, data.storyState.revision);
      await load();
      setStatus(`統合系統已啟用：${protagonist?.rpgProfile ? "已套用角色核准的 300 點初始能力" : "已套用公式種子能力"}；正文未被改寫。`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function applyDirectEffect(effect: StoryChoiceEffect, message: string) {
    if (!data || busy) return;
    setBusy(true);
    try {
      const next = applyStoryChoiceEffect(data.storyState, effect);
      await createNovelRepository().put<StoryState>("storyStates", next, data.storyState.revision);
      await load();
      setStatus(message);
    } catch (error) {
      setStatus(errorMessage(error));
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function acceptChoice(choice: RpgChoice) {
    if (!data || busy || !activated) return;
    setBusy(true);
    setStatus(`規則引擎正在判定：${choice.key}｜${choice.title}`);
    try {
      const resolution = resolveRpgChoice(choice, {
        seed: `${progression?.procedural.runSeed ?? data.project.id}|${data.chapter.id}|${progression?.turn ?? 0}`,
        revision: data.storyState.revision,
        recentEncounterSignatures: progression?.procedural.recentEncounterSignatures,
        turn: progression?.turn,
      });
      const repository = createNovelRepository();
      const saved = await persistStudioChoiceCandidate(
        repository,
        studioSeed(data),
        {
          optionKey: choice.key,
          text: choice.title,
          consequence: `${choice.consequence}；${resolution.outcomeLabel}；擲骰 ${resolution.roll}／${resolution.successChance}`,
          effect: resolution.effect,
          providerId: "deterministic-local",
          modelId: RPG_FORMULA_VERSION,
        },
      );
      await acceptStudioChoice(
        repository,
        saved.candidate.id,
        resolution.acceptedText,
        `${choice.key === "custom" ? "自由行動" : choice.key}｜${choice.title}｜${resolution.outcomeLabel}`,
      );
      setSelectedChoice(null);
      setCustomAction("");
      setLastResolution(resolution);
      await load();
      setStatus(`已核准：${resolution.summary}。正文、數值、任務、成就與分支已在同一筆交易更新。`);
    } catch (error) {
      setStatus(errorMessage(error));
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  function prepareCustomAction() {
    if (!data || !progression) return;
    try {
      setSelectedChoice(buildCustomRpgChoice({
        progression,
        action: customAction,
        protagonist: protagonist?.name ?? "主角",
        chapterTitle: data.chapter.title,
        conflict,
        rules,
      }));
      setStatus("自由行動已轉成可驗證候選；請檢查成功率與代價後再核准。");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function rerollChoices() {
    if (!data || !progression || busy) return;
    const rerolledAtTurn = Number(data.storyState.worldFlags["rpg.rerollTurn"] ?? -1);
    if (progression.fatePoints < 1) {
      setStatus("命運點不足，不能重新抽取選項。");
      return;
    }
    if (rerolledAtTurn === progression.turn) {
      setStatus("本回合已重新抽取過一次；完成一個選擇後才能再次重擲。");
      return;
    }
    const effect = emptyEffect();
    effect.resourceChanges = { "game.fatePoints": -1, "game.choiceVariant": 1 };
    effect.worldFlags = { "rpg.rerollTurn": progression.turn };
    effect.timelineEvents = [`第 ${progression.day} 日：消耗命運點重擲選項`];
    setSelectedChoice(null);
    await applyDirectEffect(effect, "已消耗 1 命運點，從至少 6 個合法候選中重新選出三種不同策略。");
  }

  async function consumeItem(item: RpgInventoryStack) {
    if (item.quantity < 1 || !progression) return;
    if (item.proceduralPill) {
      const useIndex = Number(data?.storyState.resources[`pill.use.${item.proceduralPill.family}`] ?? 0);
      const resolution = resolveProceduralPillUse({
        pill: item as RpgInventoryStack & ProceduralPillItem,
        runSeed: progression.procedural.runSeed,
        turn: progression.turn,
        useIndex,
        stats: progression.baseStats,
        health: progression.status.health,
        stress: progression.status.stress,
      });
      await applyDirectEffect(resolution.effect, `${resolution.summary}${resolution.sideEffectTriggered ? " 已記錄副作用，後續事件會保留此結果。" : ""}`);
      return;
    }
    if (!item.useEffect) return;
    const effect = emptyEffect();
    effect.resourceChanges = { [`item.${item.itemId}`]: -1, ...item.useEffect };
    effect.worldFlags = { "rpg.lastItemUsed": item.itemId };
    effect.timelineEvents = [`使用道具：${item.name}`];
    await applyDirectEffect(effect, `已使用「${item.name}」：${item.effectDescription}`);
  }

  async function approveXianxiaRule() {
    if (!data || !xianxiaRuleCandidate) return;
    const previous = typeof data.storyState.worldFlags["xianxia.recentRuleIds"] === "string"
      ? String(data.storyState.worldFlags["xianxia.recentRuleIds"]).split(",").filter(Boolean)
      : [];
    const recent = [...previous.filter((id) => id !== xianxiaRuleCandidate.ruleId), xianxiaRuleCandidate.ruleId].slice(-8);
    const effect = emptyEffect();
    effect.resourceChanges = { "xianxia.approvedRuleCount": 1 };
    effect.worldFlags = {
      "xianxia.lastApprovedRuleId": xianxiaRuleCandidate.ruleId,
      "xianxia.lastApprovedRuleTitle": xianxiaRuleCandidate.title,
      "xianxia.lastApprovedRule": JSON.stringify({
        kind: xianxiaRuleCandidate.kindLabel,
        rank: xianxiaRuleCandidate.rank,
        title: xianxiaRuleCandidate.title,
        preconditions: xianxiaRuleCandidate.preconditions,
        costs: xianxiaRuleCandidate.costs,
        effects: xianxiaRuleCandidate.effects,
        risks: xianxiaRuleCandidate.risks,
        counters: xianxiaRuleCandidate.counters,
        storyHook: xianxiaRuleCandidate.storyHook,
      }),
      "xianxia.recentRuleIds": recent.join(","),
    };
    effect.timelineEvents = [`核准${xianxiaRuleCandidate.kindLabel}規則：${xianxiaRuleCandidate.title}（${xianxiaRuleCandidate.rank}）`];
    await applyDirectEffect(effect, `已核准「${xianxiaRuleCandidate.title}」；前置、成本、風險與反制會成為後續閉端 AI 的世界狀態。`);
    setXianxiaRuleVariant((value) => value + 1);
  }

  async function beginNewVariationCycle() {
    if (!data || !progression) return;
    const runSeed = crypto.randomUUID();
    const cycle = progression.procedural.cycle + 1;
    const effect = emptyEffect();
    effect.resourceChanges = {
      ...initialProceduralPillResources(runSeed, cycle, 6),
      "world.instability": 1,
    };
    effect.worldFlags = {
      "rpg.runSeed": runSeed,
      "rpg.cycle": cycle,
      "rpg.recentEncounterSignatures": "",
      "xianxia.recentRuleIds": "",
      "world.currentAspect": "新周目尚未揭露",
      "world.currentLocationVariant": "重新排列中",
    };
    effect.timelineEvents = [`開啟變化周目 ${cycle}：保留角色養成，重新排列事件、丹藥與世界規則`];
    setSelectedChoice(null);
    setLastResolution(null);
    await applyDirectEffect(effect, `已開啟第 ${cycle} 周目變化：角色養成保留，敵情、事件、丹藥與規則重新排列。`);
  }

  async function equipItem(item: RpgInventoryStack) {
    if (!data || !item.slot || item.quantity < 1 || busy) return;
    setBusy(true);
    try {
      await createNovelRepository().put<StoryState>("storyStates", {
        ...data.storyState,
        worldFlags: {
          ...data.storyState.worldFlags,
          [`rpg.equipped.${item.slot}`]: item.itemId,
          "rpg.lastEquipmentChange": item.itemId,
        },
      }, data.storyState.revision);
      await load();
      setStatus(`已裝備「${item.name}」；能力與衍生戰力已立即重算。`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function exchangeSpiritStone() {
    if (!progression || progression.currencies.gold < 100) {
      setStatus("金幣不足：100 金幣可兌換 1 枚靈石。");
      return;
    }
    const effect = emptyEffect();
    effect.moneyChange = -100;
    effect.resourceChanges = { "currency.spiritStone": 1 };
    effect.timelineEvents = ["貨幣兌換：100 金幣 → 1 靈石"];
    await applyDirectEffect(effect, "兌換完成：金幣 -100，靈石 +1。");
  }

  async function settleManagementDay() {
    if (!progression || activeMode !== "management") return;
    const { expectedRevenue, expectedNetProfit } = progression.management;
    await applyDirectEffect(
      buildManagementSettlementEffect(progression),
      `第 ${progression.day} 日已結算：營收 ${formatNumber(expectedRevenue)}，淨利 ${signed(expectedNetProfit)}。`,
    );
  }

  function saveTemplate() {
    try {
      const template = createRpgCharacterTemplate({ name, archetype, identity, personality, goal });
      persistCustomLibrary([...customLibrary, template]);
      setName("");
      setArchetype("");
      setIdentity("");
      setPersonality("");
      setGoal("");
      setStatus(`「${template.name}」已加入你的本機人物庫，可放入任何作品。`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function addCharacterToProject(template: RpgCharacterTemplate) {
    if (!data || busy) return;
    setBusy(true);
    try {
      const repository = createNovelRepository();
      const base = makeRecord(projectId, "user");
      const character: Character = {
        ...base,
        name: template.name,
        aliases: [],
        identity: optionalValue(template.identity || template.archetype, "user_defined"),
        personality: optionalValue(template.personality, template.personality ? "user_defined" : "deferred"),
        goal: optionalValue(template.goal, template.goal ? "user_defined" : "deferred"),
        lifeStatus: "alive",
        locationId: null,
        fears: template.fears,
        privateSecrets: [],
        factionIds: [],
        values: template.values,
        capabilities: template.capabilities,
        limitations: template.limitations,
        voiceStyle: {
          formality: 50,
          directness: 55,
          emotionalExpressiveness: 55,
          sentenceLength: "mixed",
          preferredAddressTerms: [],
        },
      };
      await repository.put("characters", character);
      await repository.put<StoryBible>("storyBibles", {
        ...data.storyBible,
        characterIds: [...new Set([...data.storyBible.characterIds, character.id])],
      }, data.storyBible.revision);
      await load();
      setStatus(`「${template.name}」已加入目前作品；不會自動成為主角或改寫 Canon。`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function removeTemplate(template: RpgCharacterTemplate) {
    if (template.builtin) return;
    persistCustomLibrary(customLibrary.filter((item) => item.templateId !== template.templateId));
    setStatus(`「${template.name}」已從本機人物庫移除；作品內既有角色不受影響。`);
  }

  if (!data || !progression) {
    return <main className={styles.shell}><p className={styles.loading} role="status">{status}</p></main>;
  }

  const mode = RPG_MODE_DEFINITIONS[activeMode];
  const journeyActivities = RPG_FREE_WORLD_ACTIVITIES[activeMode];
  const trackedQuest = activeMode === "management" ? "management.survive90" : activeMode === "cultivation" ? "growth.main" : "rpg.mainArc";
  const trackedProgress = Number(data.storyState.questStates[trackedQuest] ?? 0);
  const rerollUsed = Number(data.storyState.worldFlags["rpg.rerollTurn"] ?? -1) === progression.turn;

  return (
    <main className={styles.shell} data-testid="rpg-workspace" data-mode={activeMode}>
      <header className={styles.header}>
        <div>
          <small>UNIFIED STORY GAME OS · {RPG_FORMULA_VERSION}</small>
          <h1>命運運算中樞</h1>
          <p>同一個角色、同一套 Canon：冒險、養成與經營共用規則引擎，但各自保留清楚的玩法與儀表板。</p>
        </div>
        <div className={styles.headerActions}>
          <Link href={`/studio/project/${projectId}/closed-ai`}>閉端 AI 任務設計</Link>
          <div className={styles.levelBadge}><span>LV.</span><strong>{progression.level}</strong><small>戰力 {progression.powerScore}</small></div>
        </div>
      </header>

      <ProjectNavigation projectId={projectId} active="rpg" />
      <p className={styles.status} role="status" aria-live="polite">{status}</p>

      <nav className={styles.modeSwitch} aria-label="遊戲模式">
        {(Object.keys(RPG_MODE_DEFINITIONS) as RpgMode[]).map((modeId) => (
          <button
            key={modeId}
            type="button"
            className={activeMode === modeId ? styles.activeMode : ""}
            onClick={() => chooseMode(modeId)}
          >
            <span>{RPG_MODE_DEFINITIONS[modeId].label}</span>
            <small>{RPG_MODE_DEFINITIONS[modeId].description}</small>
          </button>
        ))}
      </nav>

      <section className={styles.hud} aria-label="核心狀態 HUD">
        <div className={styles.identityHud}>
          <span>{mode.shortLabel}主角</span>
          <strong>{protagonist?.name ?? "尚未指定主角"}</strong>
          <small>{data.project.title} · {data.chapter.title}</small>
        </div>
        <div className={styles.hudStat}><span>生命 HP</span><strong>{progression.status.hp}</strong><progress max={100} value={progression.status.hp} /></div>
        <div className={styles.hudStat}><span>體力 SP</span><strong>{progression.status.stamina}</strong><progress max={100} value={progression.status.stamina} /></div>
        <div className={styles.hudStat}><span>行動點</span><strong>{progression.status.actionPoints}/{mode.dailyActionPoints}</strong><small>第 {progression.day} 日</small></div>
        <div className={styles.hudStat}><span>{mode.primaryCurrency}</span><strong>{activeMode === "management" ? formatNumber(progression.management.cash) : activeMode === "cultivation" ? progression.currencies.spiritStone : formatNumber(progression.currencies.gold)}</strong><small>命運點 {progression.fatePoints}</small></div>
        <div className={styles.xpHud}><div><span>EXP {formatNumber(progression.xp)}</span><b>{progression.levelProgress}%</b></div><progress max={Math.max(1, progression.nextLevelXp - progression.currentLevelXp)} value={Math.max(0, progression.xp - progression.currentLevelXp)} /><small>下一級 {formatNumber(progression.nextLevelXp)} EXP</small></div>
      </section>

      {!activated ? (
        <section className={styles.activation}>
          <div><small>目前只有故事骨架</small><h2>啟用統合 RPG／養成／經營系統</h2><p>建立能力、狀態、背包、寶物、貨幣與公司初始資料；不會改寫任何章節或 Canon。</p></div>
          <button data-testid="rpg-initialize" type="button" disabled={busy} onClick={() => void initializeProgression()}>啟用完整遊戲系統</button>
        </section>
      ) : (
        <>
        <section className={styles.worldRibbon} aria-label="本周目世界脈動">
          <div className={styles.cycleEmblem}><small>VARIATION CYCLE</small><strong>{progression.procedural.cycle}</strong><span>世界種子 {progression.procedural.runSeed.slice(0, 8)}</span></div>
          <div><small>目前世界脈動</small><h2>{progression.procedural.currentAspect ?? "事件尚未揭露"}</h2><p>{progression.procedural.currentLocationVariant ?? "你的下一個核准選擇會改變地點、勢力與事件排列。"}</p></div>
          <div className={styles.ribbonMetrics}><span><b>{data.acceptedChoices.length}</b> 已核准選擇</span><span><b>{progression.procedural.recentEncounterSignatures.length}</b> 近期變化</span><span><b>{progression.inventory.filter((item) => item.rarity === "rare" || item.rarity === "epic").length}</b> 稀有物品</span></div>
          <button type="button" disabled={busy} onClick={() => void beginNewVariationCycle()}>開啟新變化周目</button>
        </section>
        <section className={styles.dashboard}>
          <aside className={styles.leftRail}>
            <article className={styles.characterCard}>
              <div className={styles.avatar}>{protagonist?.portrait ? <CharacterPortraitImage portrait={protagonist.portrait} className={styles.avatarPortrait} decorative /> : (protagonist?.name ?? "主").slice(0, 1)}</div>
              <div><small>{activeMode === "management" ? "創業者／領導者" : activeMode === "cultivation" ? "成長中的命運者" : "流浪冒險者"}</small><h2>{protagonist?.name ?? "未命名主角"}</h2><p>{data.storyState.locationState ?? "位置尚未設定"} · {data.storyState.riskState ?? "風險未知"}</p><small>能力來源：{protagonist?.rpgProfile ? "角色核准配點" : "作品公式種子"}</small></div>
            </article>

            <div className={styles.statusGrid}>
              <Meter label="精神" value={progression.status.spirit} />
              <Meter label="健康" value={progression.status.health} />
              <Meter label="疲勞" value={progression.status.fatigue} inverted />
              <Meter label="壓力" value={progression.status.stress} inverted />
              <Meter label="心情" value={progression.status.mood} />
              <Meter label="專注" value={progression.status.focus} />
            </div>

            <section className={styles.statPanel}>
              <header><h3>核心能力</h3><small>裝備加成已計入</small></header>
              {RPG_STAT_DEFINITIONS.map((definition) => (
                <div key={definition.key} className={styles.statRow}>
                  <span>{definition.labels[activeMode]}</span>
                  <progress max={100} value={progression.stats[definition.key]} />
                  <b>{progression.stats[definition.key]}</b>
                  {progression.equipmentBonuses[definition.key] ? <em>+{progression.equipmentBonuses[definition.key]}</em> : null}
                </div>
              ))}
            </section>

            <div className={styles.derivedGrid}>
              <span>攻擊 <b>{progression.derived.attack}</b></span>
              <span>防禦 <b>{progression.derived.defense}</b></span>
              <span>速度 <b>{progression.derived.speed}</b></span>
              <span>洞察 <b>{progression.derived.insight}</b></span>
              <span>談判 <b>{progression.derived.negotiation}</b></span>
              <span>領導 <b>{progression.derived.leadership}</b></span>
            </div>
          </aside>

          <section className={styles.centerStage}>
            <article className={styles.sceneCard}>
              <header>
                <div><small>第 {progression.day} 日 · {data.storyState.timeState ?? "時間未定"}</small><h2>{data.chapter.title}</h2></div>
                <span data-risk={data.storyState.riskState ?? "穩定"}>{data.storyState.locationState ?? "未知地點"}</span>
              </header>
              <div className={styles.storyText}>{sceneExcerpt(data.chapter.content)}</div>
              <footer><span>當前目標</span><b>{conflict}</b></footer>
            </article>

            {lastResolution ? (
              <article className={styles.resolution} data-outcome={lastResolution.outcome} data-testid="rpg-resolution">
                <div><small>上一回合結果</small><h3>{lastResolution.outcomeLabel}</h3></div>
                <p>{lastResolution.summary}</p>
                <span>規則引擎擲骰 {lastResolution.roll}／成功率 {lastResolution.successChance}%</span>
              </article>
            ) : null}

            <section className={styles.choiceSection}>
              <header>
                <div><small>ROUND {progression.turn + 1} · DYNAMIC CHOICE POOL</small><h2>接下來要怎麼做？</h2></div>
                <button type="button" disabled={busy || rerollUsed || progression.fatePoints < 1} onClick={() => void rerollChoices()}>重擲選項（命運點 -1）</button>
              </header>
              <div className={styles.choiceGrid}>
                {choices.map((choice) => (
                  <button
                    key={choice.key}
                    data-testid={`rpg-choice-${choice.key}`}
                    type="button"
                    className={selectedChoice?.key === choice.key ? styles.selected : ""}
                    onClick={() => setSelectedChoice(choice)}
                    disabled={busy}
                  >
                    <div className={styles.choiceHeading}><span className={styles.choiceKey}>{choice.key}</span><div><small>{choice.strategyLabel} · {choice.encounter.worldAspect}</small><h3>{choice.title}</h3></div></div>
                    <div className={styles.encounterSignal}><span>{choice.encounter.title}</span><p>{choice.encounter.telegraph}</p></div>
                    <p>{choice.description}</p>
                    <dl><div><dt>成功率</dt><dd>{choice.successChance}%</dd></div><div><dt>EXP</dt><dd>+{choice.xpGain}</dd></div><div><dt>風險</dt><dd>{"◆".repeat(choice.risk)}{"◇".repeat(5 - choice.risk)}</dd></div></dl>
                    <div className={styles.choiceTags}>{choice.costLabels.map((label) => <span key={label} data-kind="cost">{label}</span>)}{choice.impactLabels.map((label) => <span key={label}>{label}</span>)}</div>
                    <small className={styles.consequence}>{rules.choicePreview === "full" ? choice.consequence : "部分後果保持未知；規則與資源代價不隱藏。"}</small>
                  </button>
                ))}
              </div>

              <div className={styles.freeAction}>
                <label htmlFor="rpg-free-action">自由行動</label>
                <input id="rpg-free-action" value={customAction} onChange={(event) => setCustomAction(event.target.value)} placeholder="例：先假裝撤退，再觀察守衛換班規律" />
                <button type="button" disabled={busy || !customAction.trim()} onClick={prepareCustomAction}>建立可驗證候選</button>
              </div>

              {selectedChoice ? (
                <aside className={styles.confirmChoice}>
                  <div><span>待核准分支</span><h3>{selectedChoice.key === "custom" ? "自由行動" : selectedChoice.key}｜{selectedChoice.title}</h3><p>{selectedChoice.consequence}</p><small>主能力：{statLabel(selectedChoice.primaryStat, activeMode)} · 副能力：{statLabel(selectedChoice.secondaryStat, activeMode)}</small></div>
                  <div><b>預計影響</b>{selectedChoice.costLabels.map((label) => <span key={label} data-cost="true">{label}</span>)}{selectedChoice.impactLabels.map((label) => <span key={label}>{label}</span>)}<button data-testid="rpg-accept-choice" type="button" disabled={busy} onClick={() => void acceptChoice(selectedChoice)}>確認選擇並寫入故事</button></div>
                </aside>
              ) : null}
            </section>
          </section>

          <aside className={styles.rightRail}>
            <section className={styles.questCard}>
              <header><span>{activeMode === "management" ? "階段目標" : activeMode === "cultivation" ? "成長路線" : "主線任務"}</span><b>{trackedProgress}%</b></header>
              <h3>{activeMode === "management" ? "生存 90 天" : activeMode === "cultivation" ? "形成自己的道路" : "推進當前主線"}</h3>
              <progress max={100} value={trackedProgress} />
              <p>{progression.journey.mainlineGoal}</p>
              <div className={styles.gateGrid} aria-label="主線門檻">
                {([
                  ["數值門檻", progression.journey.gates.power],
                  ["情報門檻", progression.journey.gates.information],
                  ["道具門檻", progression.journey.gates.item],
                ] as const).map(([label, gate]) => <span key={label} data-ready={gate.ready}><b>{gate.ready ? "可通過" : "未滿足"}</b>{label}<small>{gate.current}／{gate.required}</small></span>)}
              </div>
            </section>

            <section className={styles.identityPathCard} data-testid="rpg-identity-path">
              <header><small>LIFE PATH</small><span>第二層</span></header>
              <h3>{progression.journey.identityLabel}</h3>
              <p>每次核准選擇都會累積人格與行事路線；這是角色走過的人生，不是可以無痛重置的職業皮膚。</p>
              <div className={styles.pathScores}>
                <span data-leading={progression.journey.identityStrategy === "steady"}>守序 <b>{progression.journey.identityScores.steady}</b></span>
                <span data-leading={progression.journey.identityStrategy === "resource"}>結盟 <b>{progression.journey.identityScores.resource}</b></span>
                <span data-leading={progression.journey.identityStrategy === "bold"}>破界 <b>{progression.journey.identityScores.bold}</b></span>
              </div>
              <small>目前承諾強度 {progression.journey.identityCommitment}</small>
            </section>

            <section className={styles.freedomCard} data-testid="rpg-free-world">
              <header><div><small>LIVING WORLD</small><h3>今天想做什麼？</h3></div><b>{progression.journey.worldFreedom}</b></header>
              <p>不必等主線指令；先選生活目標，系統會把它轉成同一套可驗證候選。</p>
              <div className={styles.activityGrid}>
                {journeyActivities.map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    data-testid={`rpg-activity-${activity.id}`}
                    onClick={() => {
                      setCustomAction(activity.action);
                      setSelectedChoice(null);
                      setStatus(`已準備「${activity.label}」自由行動；確認文字後建立候選，尚未寫入 Canon。`);
                    }}
                  >
                    <b>{activity.label}</b>
                    <small>{activity.description}</small>
                  </button>
                ))}
              </div>
            </section>

            {activeMode === "management" ? (
              <section className={styles.managementCard}>
                <header><div><small>TODAY FORECAST</small><h3>經營預估</h3></div><span data-alert={progression.management.risk >= 60}>{progression.management.risk >= 80 ? "高風險" : progression.management.risk >= 60 ? "警戒" : "穩定"}</span></header>
                <div className={styles.metricGrid}>
                  <span>員工 <b>{progression.management.staff} 人</b></span><span>效率 <b>{progression.management.employeeEfficiency}%</b></span><span>需求 <b>{formatNumber(progression.management.expectedDemand)}</b></span><span>銷量 <b>{formatNumber(progression.management.expectedSales)}</b></span><span>營收 <b>{formatNumber(progression.management.expectedRevenue)}</b></span><span>淨利 <b data-negative={progression.management.expectedNetProfit < 0}>{signed(progression.management.expectedNetProfit)}</b></span>
                </div>
                <Meter label="士氣" value={progression.management.morale} />
                <Meter label="顧客滿意" value={progression.management.satisfaction} />
                <Meter label="營運風險" value={progression.management.risk} inverted />
                <button type="button" disabled={busy} onClick={() => void settleManagementDay()}>結算今日營運</button>
              </section>
            ) : (
              <section className={styles.worldCard}>
                <header><small>WORLD PULSE</small><h3>世界與隊伍</h3></header>
                <dl><div><dt>所在地</dt><dd>{progression.procedural.currentLocationVariant ?? data.storyState.locationState ?? "未知"}</dd></div><div><dt>世界面向</dt><dd>{progression.procedural.currentAspect ?? "尚未揭露"}</dd></div><div><dt>危險</dt><dd>{data.storyState.riskState ?? "未知"}</dd></div><div><dt>隊伍信任</dt><dd>{Math.round(data.storyState.relationships["rpg.partyTrust"] ?? 0)}</dd></div><div><dt>世界動能</dt><dd>{Math.round(data.storyState.resources["world.momentum"] ?? 0)}</dd></div><div><dt>不穩定度</dt><dd>{Math.round(data.storyState.resources["world.instability"] ?? 0)}</dd></div></dl>
              </section>
            )}

            <section className={styles.walletCard}>
              <header><small>WALLET & EXCHANGE</small><h3>貨幣與價值</h3></header>
              <div><span>金幣<small>旅店、交易、情報</small></span><b>{formatNumber(progression.currencies.gold)}</b></div>
              <div><span>靈石<small>修煉、煉製、稀有交換</small></span><b>{progression.currencies.spiritStone}</b></div>
              <div><span>公會憑證<small>特殊委託與限定物品</small></span><b>{progression.currencies.guildToken}</b></div>
              <button type="button" disabled={busy || progression.currencies.gold < 100} onClick={() => void exchangeSpiritStone()}>100 金幣兌換 1 靈石</button>
            </section>
          </aside>
        </section>
        </>
      )}

      {activated ? (
        <section className={styles.detailDock}>
          <nav aria-label="RPG 詳細功能">
            {([
              ["inventory", "背包與寶物"],
              ["quests", "任務與成就"],
              ["relationships", "關係與陣營"],
              ["log", "冒險日誌"],
              ["rules", "規則設定"],
              ["characters", "人物庫"],
            ] as Array<[DetailPanel, string]>).map(([panel, label]) => (
              <button key={panel} type="button" className={activePanel === panel ? styles.activePanel : ""} onClick={() => setActivePanel(panel)}>{label}</button>
            ))}
          </nav>

          {activePanel === "inventory" ? (
            <div className={styles.inventoryPanel}>
              <header><div><small>INVENTORY & TREASURES</small><h2>背包、裝備與寶物功用</h2></div><p>負重 {progression.carryWeight}／{progression.derived.carryCapacity} · 每件物品都標示用途、價值與真實效果。</p></header>
              <div className={styles.inventoryGrid}>
                {progression.inventory.map((item) => (
                  <article key={item.itemId} data-rarity={item.rarity}>
                    <header><span>{item.proceduralPill ? `${item.proceduralPill.grade}丹藥` : `${item.category} · ${item.rarity}`}</span><b>×{item.quantity}</b></header>
                    <h3>{item.name}{item.equipped ? <em>已裝備</em> : null}</h3>
                    <p>{item.description}</p><strong>{item.effectDescription}</strong>
                    {item.proceduralPill ? <dl className={styles.pillMetrics}><div><dt>藥力</dt><dd>{item.proceduralPill.potency}</dd></div><div><dt>穩定</dt><dd>{item.proceduralPill.stability}</dd></div><div><dt>保存</dt><dd>{item.proceduralPill.shelfLife} 日</dd></div></dl> : null}
                    <footer><span>價值 {item.value ? `${formatNumber(item.value)} 金幣` : "任務限定"} · {item.weight} kg</span><div>{item.useEffect || item.proceduralPill ? <button type="button" disabled={busy} onClick={() => void consumeItem(item)}>使用</button> : null}{item.slot ? <button type="button" disabled={busy || item.equipped} onClick={() => void equipItem(item)}>{item.equipped ? "裝備中" : "裝備"}</button> : null}</div></footer>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {activePanel === "quests" ? (
            <div className={styles.recordsPanel}>
              <section><small>QUESTS</small><h2>任務進度</h2>{Object.keys(data.storyState.questStates).length ? Object.entries(data.storyState.questStates).map(([key, value]) => <article key={key}><div><b>{key}</b><span>{value}%</span></div><progress max={100} value={Number(value) || 0} /></article>) : <p>尚無任務；核准第一個選擇後會建立主線進度。</p>}</section>
              <section><small>ACHIEVEMENTS</small><h2>成就與稱號</h2>{Object.keys(data.storyState.achievementStates).length ? Object.entries(data.storyState.achievementStates).map(([key, value]) => <article key={key}><div><b>{key}</b><span>{value}%</span></div><progress max={100} value={Number(value) || 0} /></article>) : <p>尚無成就進度。</p>}</section>
            </div>
          ) : null}

          {activePanel === "relationships" ? (
            <div className={styles.recordsPanel}>
              <section><small>RELATIONSHIPS</small><h2>人物關係</h2>{Object.keys(data.storyState.relationships).length ? Object.entries(data.storyState.relationships).map(([key, value]) => <article key={key}><div><b>{key}</b><span>{Math.round(value)}</span></div><progress max={200} value={value + 100} /></article>) : <p>尚未透過故事建立可計算的關係。</p>}</section>
              <section><small>FACTIONS</small><h2>陣營聲望</h2>{Object.keys(data.storyState.factionStanding).length ? Object.entries(data.storyState.factionStanding).map(([key, value]) => <article key={key}><div><b>{key}</b><span>{Math.round(value)}</span></div><progress max={200} value={value + 100} /></article>) : <p>目前陣營中立；後續選擇會分別累積，不會只用一個總好感。</p>}</section>
            </div>
          ) : null}

          {activePanel === "log" ? (
            <div className={styles.logPanel}>
              <header><small>ADVENTURE LOG</small><h2>真正寫入的選擇與世界變化</h2><p>這些紀錄來自核准交易，不是 AI 臨時描述，可用來防止死亡角色復活、物品回來或任務倒退。</p></header>
              {data.acceptedChoices.length ? data.acceptedChoices.slice(0, 20).map((choice) => (
                <article key={choice.id}><time>{new Date(choice.acceptedAt).toLocaleString("zh-TW")}</time><div><h3>{choice.choiceLabel ?? `${choice.choiceKey}｜故事選擇`}</h3><p>{choice.acceptedText.slice(0, 260)}{choice.acceptedText.length > 260 ? "…" : ""}</p><footer><span>StoryState {choice.storyStateRevisionBefore} → {choice.storyStateRevisionAfter}</span><span>交易 {choice.effectOperationId}</span></footer></div></article>
              )) : <p className={styles.empty}>尚未核准任何選擇。選擇 A／B／C 並確認後，完整結果會出現在這裡。</p>}
            </div>
          ) : null}

          {activePanel === "rules" ? (
            <div className={styles.rulesPanel}>
              <section><small>AUTHOR SETTINGS</small><h2>作者設定</h2><label>成長速度<select value={rules.growthPace} onChange={(event) => updateRules({ ...rules, growthPace: event.target.value as RpgRuleSettings["growthPace"] })}><option value="fast">快速</option><option value="standard">標準</option><option value="realistic">寫實</option></select></label><label>隨機程度<select value={rules.randomness} onChange={(event) => updateRules({ ...rules, randomness: event.target.value as RpgRuleSettings["randomness"] })}><option value="story">劇情型</option><option value="balanced">平衡型</option><option value="high_risk">高風險型</option></select></label><label>後果預覽<select value={rules.choicePreview} onChange={(event) => updateRules({ ...rules, choicePreview: event.target.value as RpgRuleSettings["choicePreview"] })}><option value="partial">保留未知</option><option value="full">完整顯示</option></select></label><label>事件頻率<select value={rules.eventFrequency} onChange={(event) => updateRules({ ...rules, eventFrequency: Number(event.target.value) as 3 | 4 | 5 })}><option value={3}>每 3 回合</option><option value={4}>每 4 回合</option><option value={5}>每 5 回合</option></select></label></section>
              <section><small>PLAYER CHOICE</small><h2>玩家選擇</h2><p>A／B／C 固定代表穩健、關係／資源與冒險三種策略；自由行動也要先轉成同樣可驗證的候選。</p><ul><li>重擲每回合最多一次，消耗 1 命運點。</li><li>失敗產生補救支線，不會因單次亂數直接壞結局。</li><li>只有玩家按下核准後才寫入正式正文與 Canon。</li></ul></section>
              <section><small>SYSTEM LOCK</small><h2>系統鎖定</h2><ul><li>{FORMULA.success}</li><li>{FORMULA.growth}</li><li>{FORMULA.employee}</li><li>{FORMULA.demand}</li><li>{FORMULA.governance}</li></ul><details><summary>查看等級與戰力公式</summary><p>{FORMULA.level}</p><p>{FORMULA.nextLevel}</p><p>{FORMULA.power}</p></details></section>
              <section className={styles.xianxiaForge}><small>USER-AUTHORED RULE FORGE</small><h2>仙俠規則工坊</h2><p>把你的符籙、陣法、職業、境界、契約與情緒原則轉成可驗證候選；按核准前不會修改 Canon。</p><label>規則類型<select value={xianxiaRuleKind} onChange={(event) => { setXianxiaRuleKind(event.target.value as XianxiaRuleKind); setXianxiaRuleVariant((value) => value + 1); }}>{XIANXIA_RULE_KIND_OPTIONS.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}</select></label>{xianxiaRuleCandidate ? <article><header><span>{xianxiaRuleCandidate.rank} · {xianxiaRuleCandidate.kindLabel}</span><b>Canonical mutation = {xianxiaRuleCandidate.canonicalMutation}</b></header><h3>{xianxiaRuleCandidate.title}</h3><p>{xianxiaRuleCandidate.storyHook}</p><dl><div><dt>前置</dt><dd>{xianxiaRuleCandidate.preconditions.join("、")}</dd></div><div><dt>成本</dt><dd>{xianxiaRuleCandidate.costs.join("、")}</dd></div><div><dt>效果</dt><dd>{xianxiaRuleCandidate.effects.join("、")}</dd></div><div><dt>風險</dt><dd>{xianxiaRuleCandidate.risks.join("、")}</dd></div><div><dt>反制</dt><dd>{xianxiaRuleCandidate.counters.join("、")}</dd></div></dl><footer><button type="button" disabled={busy} onClick={() => setXianxiaRuleVariant((value) => value + 1)}>換一個候選</button><button type="button" disabled={busy} onClick={() => void approveXianxiaRule()}>核准並加入世界狀態</button></footer></article> : null}</section>
            </div>
          ) : null}

          {activePanel === "characters" ? (
            <div className={styles.librarySection}>
              <header><div><small>CHARACTER VAULT</small><h2>我喜歡的人物庫</h2></div><p>內建角色可直接加入作品；自創角色保存在這台裝置，加入作品後才進入專案資料。</p></header>
              <div className={styles.libraryLayout}>
                <form onSubmit={(event) => { event.preventDefault(); saveTemplate(); }}><h3>創造自己的角色</h3><label>姓名<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>角色原型<input value={archetype} onChange={(event) => setArchetype(event.target.value)} placeholder="例：被放逐的星艦領航員" /></label><label>身分<input value={identity} onChange={(event) => setIdentity(event.target.value)} /></label><label>性格<textarea rows={3} value={personality} onChange={(event) => setPersonality(event.target.value)} /></label><label>目標<textarea rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} /></label><button type="submit">加入我的人物庫</button></form>
                <div className={styles.characterGrid}>{library.map((template) => <article key={template.templateId}><div><span>{template.builtin ? "內建" : "我的角色"}</span><h3>{template.name}</h3><small>{template.archetype}</small></div><p>{template.personality || template.identity || "等待你補上更多角色設定。"}</p><b>目標：{template.goal || "尚未設定"}</b><footer><button type="button" disabled={busy} onClick={() => void addCharacterToProject(template)}>加入目前作品</button>{!template.builtin ? <button type="button" className={styles.danger} onClick={() => removeTemplate(template)}>移除人物庫</button> : null}</footer></article>)}</div>
              </div>
              <p className={styles.projectCast}>目前作品角色：{data.characters.length ? data.characters.map((character) => character.name).join("、") : "尚未建立角色"}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
