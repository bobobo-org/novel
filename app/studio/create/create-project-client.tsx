"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  STORY_LIBRARY,
  listStoryTopics,
  resolveStoryTopic,
} from "@/lib/novel-data/story-library";
import {
  buildProjectBundle,
  buildSeedCandidate,
  createDraft,
} from "@/lib/novel-ai/domain/creation";
import {
  selectedStoryPlayMode,
  STORY_PLAY_MODE_LABELS,
  type StoryPlayModeId,
} from "@/lib/novel-ai/domain/play-mode";
import {
  makeRecord,
  optionalValue,
  type Chapter,
  type NovelProject,
  type ProjectCreationDraft,
  type ProjectSeed,
  type ReaderState,
  type StoryState,
} from "@/lib/novel-ai/domain";
import {
  createNovelRepository,
  persistenceFailureOrNull,
  type PersistenceFailure,
} from "@/lib/novel-ai/repository";
import { createProjectBackup } from "@/lib/novel-ai/repository/backup";
import { mirrorProjectToLegacyStudio } from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import PersistenceRecoveryNotice from "../persistence-recovery-notice";

const DRAFT_KEY = "novel_p2_creation_draft";

function draftStorageKey(cloneFrom: string | null) {
  return `${DRAFT_KEY}:${cloneFrom ? `clone:${cloneFrom}` : "new"}`;
}

const questions = [
  {
    key: "story",
    title: "這是一個關於什麼的故事？",
    choices: ["一段改變命運的冒險", "一場人物關係的考驗", "一個逐步揭開的謎團"],
  },
  {
    key: "protagonist",
    title: "故事跟著誰前進？",
    choices: ["林知微｜冷靜但害怕再次失去", "沈星河｜勇敢但容易獨自承擔", "江離｜敏銳但不輕易相信別人"],
  },
  {
    key: "conflict",
    title: "主角想完成什麼，又被什麼阻擋？",
    choices: ["守住所愛的人，卻被強大制度逼迫讓步", "找回失去的真相，但每次追查都要付出代價", "證明自己的選擇，卻必須先克服內心恐懼"],
  },
  {
    key: "worldRule",
    title: "故事舞台最重要的規則是什麼？",
    choices: ["每次獲得力量都必須付出代價", "真相只能由行動證明", "平凡秩序下藏著另一套會回應選擇的規則"],
  },
  {
    key: "opening",
    title: "開場從哪個具體事件開始？",
    choices: ["主角收到一個無法忽視的消息", "熟悉的日常秩序突然被打破", "主角必須立刻做出一次會留下後果的選擇"],
  },
] as const;

const proceduralNames = [
  "林知微", "沈星河", "江離", "蘇晚晴", "顧明川", "葉清和", "陸沉舟", "程予安",
  "夏青禾", "周既白", "聞人月", "段雲歸", "艾琳・沃克", "諾亞・陳", "米拉・宋", "里昂・顧",
];
const proceduralGoals = [
  "找回被奪走的選擇權", "守住一個即將消失的家", "查清一段被集體遺忘的真相",
  "在期限前救回重要的人", "阻止熟悉的世界被另一套規則取代", "證明一場被判定失敗的選擇仍有意義",
];
const proceduralWorlds = [
  "一座會記錄每次承諾的山城", "一個以記憶交換資源的群島", "一座白天正常、夜裡重排街道的都市",
  "靈脈與商路同時衰竭的修行邊城", "由五個互不信任勢力共同維持的空中聚落", "每逢月蝕便會顯露過去分支的古國",
];
const proceduralRules = [
  "任何力量都會留下可追查的代價", "人物只能依自己實際接觸過的情報行動",
  "已發生的事件不能無故重置", "每次改變關係都會同時改變資源與風險",
  "秘密越接近真相，保護它的人就越必須作出選擇", "世界會記住承諾，但不保證用原意實現",
];
const proceduralOpenings = [
  "主角在最熟悉的地方，看見一件只有失蹤者才知道的物品。",
  "一封寫著明日日期的信，要求主角在今晚背叛最信任的人。",
  "原本例行的交易突然中止，而所有人都假裝從未見過主角。",
  "主角醒來後發現自己的名字仍在，卻被另一個人合法使用。",
  "一場不該失敗的儀式成功了，代價卻落在完全無關的人身上。",
  "城門關閉前最後一位旅人，帶來了主角已親手銷毀的證據。",
];

type CandidatePayload = {
  logline?: string;
  protagonist?: string;
  goal?: string;
  weakness?: string;
  world?: string;
  worldRule?: string;
  conflict?: string;
  opposition?: string;
  opening?: string;
  style?: string;
  directions?: string[];
};

function safeLoadDraft(storageKey: string, cloneFrom: string | null) {
  if (typeof localStorage === "undefined") return createDraft();
  const keys = [storageKey];
  for (const key of keys) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null") as ProjectCreationDraft | null;
      if (!parsed?.schemaVersion) continue;
      const parsedCloneFrom = parsed.answers.cloneFrom?.value ?? null;
      if (cloneFrom ? parsedCloneFrom === cloneFrom : !parsedCloneFrom) return parsed;
    } catch {
      // A damaged draft must not block creation or leak into a cloned project.
    }
  }
  return createDraft();
}

function randomIndex(length: number) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % length;
}

function pick<T>(items: readonly T[]) {
  return items[randomIndex(items.length)];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalSuggestion(value: string | null, accepted = false) {
  const next = optionalValue(value, value ? (accepted ? "ai_accepted" : "ai_suggested") : "deferred");
  return value ? { ...next, source: "ai_candidate" as const } : next;
}

function seedFromPayload(draft: ProjectCreationDraft, payload: CandidatePayload, accepted = false) {
  const current = draft.seedCandidate ?? buildSeedCandidate(draft);
  const value = (candidate: unknown, fallback: string | null) => text(candidate) || fallback;
  return {
    ...current,
    logline: optionalSuggestion(value(payload.logline, current.logline.value), accepted),
    protagonist: optionalSuggestion(value(payload.protagonist, current.protagonist.value), accepted),
    goal: optionalSuggestion(value(payload.goal, current.goal.value), accepted),
    weakness: optionalSuggestion(value(payload.weakness, current.weakness.value), accepted),
    world: optionalSuggestion(value(payload.world, current.world.value), accepted),
    worldRule: optionalSuggestion(value(payload.worldRule, current.worldRule.value), accepted),
    conflict: optionalSuggestion(value(payload.conflict, current.conflict.value), accepted),
    opposition: optionalSuggestion(value(payload.opposition, current.opposition.value), accepted),
    opening: optionalSuggestion(value(payload.opening, current.opening.value), accepted),
    directions: Array.isArray(payload.directions)
      ? payload.directions.map(text).filter(Boolean).slice(0, 3)
      : current.directions,
  } satisfies ProjectSeed;
}

function playModeOf(draft: ProjectCreationDraft) {
  const mode = selectedStoryPlayMode(draft.answers);
  // "interactive" is retained only for older saved projects. New projects
  // use it as a parent choice and must select one concrete three-choice mode.
  return mode === "interactive" ? null : mode;
}

type StoryLanguage = "zh-TW" | "zh-CN" | "en";

const STORY_LANGUAGE_LABELS: Record<StoryLanguage, string> = {
  "zh-TW": "繁體中文",
  "zh-CN": "简体中文",
  en: "English",
};

function storyLanguageOf(draft: ProjectCreationDraft): StoryLanguage {
  const language = draft.answers.language?.value;
  return language === "zh-CN" || language === "en" ? language : "zh-TW";
}

function foundationMissing(draft: ProjectCreationDraft, seed: ProjectSeed) {
  const missing: string[] = [];
  const mode = playModeOf(draft);
  if (!draft.title.trim()) missing.push("作品名稱");
  if (!mode) missing.push("創作／遊玩方式");
  if (mode) {
    if (!draft.genreId && !draft.coreIdea.value?.trim() && !seed.logline.value?.trim()) missing.push("故事方向");
    if (!seed.protagonist.value?.trim()) missing.push("主要人物");
    if (!seed.world.value?.trim() && !seed.worldRule.value?.trim()) missing.push("故事舞台或世界規則");
    if (!seed.conflict.value?.trim() && !seed.goal.value?.trim()) missing.push("目標或衝突");
    if (!seed.opening.value?.trim()) missing.push("開場事件");
  }
  return missing;
}

const GUIDED_ANSWER_KEYS = ["story", "protagonist", "conflict", "worldRule", "opening"] as const;

function guidedAnswersComplete(draft: ProjectCreationDraft) {
  return GUIDED_ANSWER_KEYS.every((key) => Boolean(draft.answers[key]?.value?.trim()));
}

function guidedSeedFromDraft(draft: ProjectCreationDraft): ProjectSeed {
  const base = buildSeedCandidate(draft);
  const story = draft.answers.story?.value?.trim() || "一段由選擇推動的故事";
  const rawProtagonist = draft.answers.protagonist?.value?.trim() || "主角";
  const [protagonistName, ...protagonistTraits] = rawProtagonist.split("｜").map((item) => item.trim()).filter(Boolean);
  const protagonist = protagonistName || rawProtagonist;
  const weakness = protagonistTraits.join("｜") || null;
  const conflict = draft.answers.conflict?.value?.trim() || "必須面對一個會留下代價的阻力";
  const worldRule = draft.answers.worldRule?.value?.trim() || "每個選擇都會留下後果";
  const opening = draft.answers.opening?.value?.trim() || "一件打破日常秩序的事件發生";
  return {
    ...base,
    titleCandidates: [draft.title.trim()],
    logline: optionalValue(`${protagonist}將走進${story}，並在「${worldRule}」的世界中面對${conflict}。`, "user_defined"),
    protagonist: optionalValue(protagonist, "user_defined"),
    goal: optionalValue(conflict, "user_defined"),
    weakness: optionalValue(weakness, weakness ? "user_defined" : "deferred"),
    world: optionalValue(`一個遵循「${worldRule}」的故事世界`, "user_defined"),
    worldRule: optionalValue(worldRule, "user_defined"),
    conflict: optionalValue(conflict, "user_defined"),
    opposition: optionalValue(conflict, "user_defined"),
    opening: optionalValue(opening, "user_defined"),
    directions: [],
  };
}

function proceduralPayload(draft: ProjectCreationDraft): CandidatePayload {
  const hero = draft.protagonist.value?.trim() || draft.answers.protagonist?.value?.trim() || pick(proceduralNames);
  const goal = pick(proceduralGoals);
  const world = pick(proceduralWorlds);
  const worldRule = pick(proceduralRules);
  const opening = pick(proceduralOpenings);
  const topic = resolveStoryTopic(draft.genreId)?.name || "原創幻想";
  const mode = playModeOf(draft) ?? "general";
  return {
    protagonist: hero,
    goal,
    weakness: pick(["害怕再次失去重要的人", "過度相信自己可以獨自承擔", "面對親密關係時容易退縮", "習慣把真相看得比人更重要"]),
    world,
    worldRule,
    conflict: `${hero}若追查「${goal}」，就會失去眼前的安全；若退縮，危機會先傷害身邊的人。`,
    opposition: pick(["相信犧牲少數才能維持秩序的執行者", "掌握舊規則並拒絕交出權力的聯盟", "與主角追求同一目標、卻採取相反方法的人"]),
    opening,
    logline: `${hero}在${world}裡，因${opening.replace(/[。！]$/u, "")}而被迫追查${goal}，並面對「${worldRule}」的代價。`,
    style: `${topic}；場景先於說明，人物以行動表達情緒，每次選擇都留下後果。`,
    directions: mode === "general"
      ? ["人物關係先行", "謎團逐層揭露", "以具體代價推進章節"]
      : ["穩健承擔代價", "交換資源取得情報", "高風險打破既有規則"],
  };
}

async function clonedDraft(sourceProjectId: string) {
  const repository = createNovelRepository();
  const source = await repository.get<NovelProject>("projects", sourceProjectId);
  if (!source) throw new Error("找不到要複製的原作品。原作品沒有被修改。");
  const seeds = await repository.list<ProjectSeed>("projectSeeds", sourceProjectId);
  const sourceSeed = [...seeds].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const storyStates = await repository.list<StoryState>("storyStates", sourceProjectId);
  const sourceStoryState = storyStates.find((item) => item.id === source.storyStateId) ?? storyStates[0] ?? null;
  const storedLanguage = sourceStoryState?.worldFlags["story.language"];
  const sourceLanguage: StoryLanguage = storedLanguage === "zh-CN" || storedLanguage === "en" ? storedLanguage : "zh-TW";
  const next = createDraft("quick");
  next.title = source.title;
  next.genrePackId = source.genrePackId;
  next.genreId = source.genreId;
  next.subgenreId = source.subgenreId;
  next.coreIdea = optionalValue(source.coreIdea.value, source.coreIdea.value ? "user_defined" : "deferred");
  next.protagonist = optionalValue(sourceSeed?.protagonist.value ?? null, sourceSeed?.protagonist.value ? "user_defined" : "deferred");
  next.style = optionalValue(source.narrativeStyle.value, source.narrativeStyle.value ? "user_defined" : "deferred");
  next.answers = {
    cloneFrom: optionalValue(sourceProjectId, "user_defined"),
    story: optionalValue(sourceSeed?.logline.value ?? source.coreIdea.value, sourceSeed?.logline.value || source.coreIdea.value ? "user_defined" : "deferred"),
    protagonist: optionalValue(sourceSeed?.protagonist.value ?? null, sourceSeed?.protagonist.value ? "user_defined" : "deferred"),
    goal: optionalValue(sourceSeed?.goal.value ?? null, sourceSeed?.goal.value ? "user_defined" : "deferred"),
    conflict: optionalValue(sourceSeed?.conflict.value ?? null, sourceSeed?.conflict.value ? "user_defined" : "deferred"),
    worldRule: optionalValue(sourceSeed?.worldRule.value ?? sourceSeed?.world.value ?? null, sourceSeed?.worldRule.value || sourceSeed?.world.value ? "user_defined" : "deferred"),
    opening: optionalValue(sourceSeed?.opening.value ?? null, sourceSeed?.opening.value ? "user_defined" : "deferred"),
    playMode: optionalValue<string>(),
    language: optionalValue(sourceLanguage, "user_defined"),
  };
  next.seedCandidate = sourceSeed ? seedFromPayload(next, {
    logline: sourceSeed.logline.value ?? undefined,
    protagonist: sourceSeed.protagonist.value ?? undefined,
    goal: sourceSeed.goal.value ?? undefined,
    weakness: sourceSeed.weakness.value ?? undefined,
    world: sourceSeed.world.value ?? undefined,
    worldRule: sourceSeed.worldRule.value ?? undefined,
    conflict: sourceSeed.conflict.value ?? undefined,
    opposition: sourceSeed.opposition.value ?? undefined,
    opening: sourceSeed.opening.value ?? undefined,
    directions: sourceSeed.directions,
  }, true) : null;
  return next;
}

export default function CreateProjectClient({ cloneFrom = null }: { cloneFrom?: string | null }) {
  const [draft, setDraft] = useState<ProjectCreationDraft>(() => createDraft());
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [titleError, setTitleError] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdMode, setCreatedMode] = useState<StoryPlayModeId>("general");
  const [persistenceIssue, setPersistenceIssue] = useState<PersistenceFailure | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const titleInputRef = useRef<HTMLInputElement>(null);
  const storageKey = draftStorageKey(cloneFrom);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const restored = safeLoadDraft(storageKey, cloneFrom);
        const next = cloneFrom && restored.answers.cloneFrom?.value !== cloneFrom
          ? await clonedDraft(cloneFrom)
          : restored;
        if (!active) return;
        setDraft(next);
        if (cloneFrom) setMessage("已複製原作品名稱與起始種子。請選擇新的玩法；原作品與既有章節不會被修改。");
      } catch (error) {
        if (!active) return;
        setDraft(createDraft());
        const nextFailure = persistenceFailureOrNull(error);
        setPersistenceIssue(nextFailure);
        setMessage(nextFailure
          ? "無法安全讀取原作品；系統沒有改用暫存資料，也不會把它當成全新作品繼續建立。"
          : error instanceof Error ? error.message : "無法讀取原作品；已改為建立全新作品。");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [cloneFrom, storageKey]);

  useEffect(() => {
    if (ready) localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, ready, storageKey]);

  const storedPlayMode = selectedStoryPlayMode(draft.answers);
  const currentPlayMode = playModeOf(draft);
  const playStructure = draft.answers.playStructure?.value === "general"
    || draft.answers.playStructure?.value === "choice"
    ? draft.answers.playStructure.value
    : storedPlayMode === "general"
      ? "general"
      : storedPlayMode
        ? "choice"
        : null;
  const topics = useMemo(
    () => listStoryTopics({ packId: draft.genrePackId || undefined, playModeId: currentPlayMode || undefined, limit: 80 }),
    [currentPlayMode, draft.genrePackId],
  );
  const topic = resolveStoryTopic(draft.genreId);
  const modeSteps = draft.mode === "guided" ? 5 : draft.mode === "blank" ? 2 : 3;
  const seed = draft.seedCandidate ?? buildSeedCandidate(draft);
  const missing = foundationMissing(draft, seed);

  const set = (partial: Partial<ProjectCreationDraft>) => setDraft((value) => ({
    ...value,
    ...partial,
    updatedAt: new Date().toISOString(),
  }));
  const setAnswer = (
    key: string,
    value: string | null,
    status: "user_defined" | "deferred" = "user_defined",
  ) => {
    setDraft((current) => {
      const next: ProjectCreationDraft = {
        ...current,
        answers: { ...current.answers, [key]: optionalValue(value, status) },
        seedCandidate: key === "playMode" ? current.seedCandidate : null,
        updatedAt: new Date().toISOString(),
      };
      if (next.mode !== "guided" || !guidedAnswersComplete(next)) return next;
      const guidedSeed = guidedSeedFromDraft(next);
      return {
        ...next,
        coreIdea: optionalValue(guidedSeed.logline.value, "user_defined"),
        protagonist: optionalValue(guidedSeed.protagonist.value, "user_defined"),
        seedCandidate: guidedSeed,
      };
    });
    if (draft.mode === "guided" && key === GUIDED_ANSWER_KEYS.at(-1) && value?.trim()) {
      setMessage("五題已整理成可修改的完整故事起點；不需安裝或檢查 AI 就能建立作品。");
    }
  };

  const requireTitle = (action: string) => {
    if (draft.title.trim()) {
      setTitleError("");
      return true;
    }
    setTitleError(`請先輸入作品名稱，再${action}。`);
    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return false;
  };

  const chooseBuildMode = (mode: ProjectCreationDraft["mode"]) => {
    if (!requireTitle("選擇建立方式")) return;
    set({ mode, step: 1 });
  };

  const choosePlayMode = (mode: StoryPlayModeId) => {
    if (!requireTitle("選擇創作方式")) return;
    setAnswer("playMode", mode);
    setMessage(`已選擇「${STORY_PLAY_MODE_LABELS[mode]}」。作品建立後這個玩法會鎖定；若要比較其他玩法，請複製為新作品。`);
  };

  const choosePlayStructure = (structure: "general" | "choice") => {
    if (!requireTitle("選擇寫作方式")) return;
    setDraft((current) => {
      const existing = selectedStoryPlayMode(current.answers);
      const keepThreeChoiceMode = existing === "rpg" || existing === "romance" || existing === "management";
      return {
        ...current,
        answers: {
          ...current.answers,
          playStructure: optionalValue(structure, "user_defined"),
          playMode: optionalValue(
            structure === "general" ? "general" : keepThreeChoiceMode ? existing : null,
            structure === "general" || keepThreeChoiceMode ? "user_defined" : "deferred",
          ),
        },
        seedCandidate: null,
        updatedAt: new Date().toISOString(),
      };
    });
    setMessage(structure === "general"
      ? "已選擇一般章節寫作。建立後仍可使用改寫、校訂、角色與世界工具。"
      : "已選擇三選一互動。請再選 RPG 養成、戀愛養成或經營模擬。");
  };

  const advance = () => {
    if (!requireTitle("進入下一步")) return;
    if (!currentPlayMode) {
      setMessage("請先選擇這部作品要使用的一種創作／遊玩方式。");
      return;
    }

    if (draft.mode === "guided") {
      const question = questions[Math.min(questions.length - 1, draft.step - 1)];
      if (!draft.answers[question.key]?.value?.trim()) {
        setMessage(`請先回答第 ${draft.step} 題「${question.title}」，再繼續下一題。`);
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(".p2GuidedChoices")?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }
    }

    if (draft.mode === "blank" && draft.step === 1 && !draft.genreId) {
      setMessage("請先從完整故事庫選擇一個題材方向，再進入故事起點編輯。");
      return;
    }

    set({
      step: Math.min(modeSteps, draft.step + 1),
    });
    setMessage(draft.step + 1 === modeSteps
      ? "已到最後一步。確認右側預覽後即可建立作品；若仍缺資料，按下建立會直接告訴你缺少哪一項。"
      : `第 ${draft.step} 步已保存，現在進入第 ${draft.step + 1} 步。`);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".p2CreatePanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  function applyProcedural() {
    if (!requireTitle("建立故事雛形")) return;
    if (!currentPlayMode) {
      setMessage(playStructure === "choice"
        ? "請先選擇 RPG 養成、戀愛養成或經營模擬。"
        : "請先選擇一般章節寫作或三選一互動。");
      return;
    }
    const payload = proceduralPayload(draft);
    const suggested = seedFromPayload(draft, payload, true);
    set({
      coreIdea: optionalValue(payload.logline ?? null, "user_defined"),
      protagonist: optionalValue(payload.protagonist ?? null, "user_defined"),
      style: optionalValue(payload.style ?? null, "user_defined"),
      answers: {
        ...draft.answers,
        story: optionalValue(payload.logline ?? null, "user_defined"),
        protagonist: optionalValue(payload.protagonist ?? null, "user_defined"),
        goal: optionalValue(payload.goal ?? null, "user_defined"),
        conflict: optionalValue(payload.conflict ?? null, "user_defined"),
        worldRule: optionalValue(payload.worldRule ?? payload.world ?? null, "user_defined"),
        opening: optionalValue(payload.opening ?? null, "user_defined"),
      },
      seedCandidate: suggested,
    });
    setMessage("已由裝置亂數產生一套可修改雛形（非 AI、非固定三個名字）。你可以直接修改；建立後再到唯一故事工作台交給自動協調器深化。");
  }

  function abandonCreation() {
    if (!window.confirm("放棄這次建立草稿？已建立的正式作品不會被刪除。")) return;
    localStorage.removeItem(storageKey);
    if (!cloneFrom) localStorage.removeItem(DRAFT_KEY);
    window.location.assign("/");
  }

  async function finish() {
    if (!requireTitle("建立作品")) return;
    if (missing.length) {
      setMessage(`還不能開始：請先完成 ${missing.join("、")}。互動與遊戲作品不會在空白設定上產生 A／B／C。`);
      return;
    }
    if (saving || !currentPlayMode) return;
    setSaving(true);
    setPersistenceIssue(null);
    setMessage("正在建立獨立作品、第一章與可還原備份……");
    try {
      const repository = createNovelRepository();
      const withSeed = { ...draft, seedCandidate: seed };
      const bundle = buildProjectBundle(withSeed);
      await repository.createProject(bundle, requestId.current);
      const chapter = await repository.put<Chapter>("chapters", {
        ...makeRecord(bundle.project.id, "user"),
        title: "第一章",
        order: 1,
        content: "",
        summary: seed.opening.value,
        status: "draft",
      });
      const project = await repository.put<NovelProject>("projects", {
        ...bundle.project,
        activeChapterId: chapter.id,
      }, bundle.project.revision);
      const reader = await repository.get<ReaderState>("readerStates", bundle.readerState.id);
      if (reader) {
        bundle.readerState = await repository.put<ReaderState>("readerStates", {
          ...reader,
          chapterId: chapter.id,
        }, reader.revision);
      }
      bundle.project = project;
      await createProjectBackup(repository, project.id, "full");
      mirrorProjectToLegacyStudio(bundle);
      localStorage.setItem("novel_p2_active_project_id", project.id);
      localStorage.removeItem(storageKey);
      if (!cloneFrom) localStorage.removeItem(DRAFT_KEY);
      setCreatedMode(currentPlayMode);
      setCreatedId(project.id);
      setMessage(`作品已建立並鎖定為「${STORY_PLAY_MODE_LABELS[currentPlayMode]}」。起始種子、第一章與完整備份均已保存。`);
    } catch (error) {
      const nextFailure = persistenceFailureOrNull(error);
      setPersistenceIssue(nextFailure);
      setMessage(nextFailure
        ? "建立失敗：本機作品庫已安全停止。既有作品沒有被覆寫，也沒有改用 memory 替代庫。"
        : `建立失敗：${error instanceof Error ? error.message : "請稍後再試"}。既有作品沒有被修改。`);
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <main className="p2CreateShell"><p>正在讀取你的創作資料……</p></main>;

  if (persistenceIssue && cloneFrom) {
    return (
      <main
        className="p2CreateShell"
        data-persistence-backend="indexeddb"
        data-persistence-degraded="true"
        data-memory-fallback="false"
      >
        <PersistenceRecoveryNotice
          failure={persistenceIssue}
          onRetry={() => window.location.reload()}
        />
      </main>
    );
  }

  if (createdId) {
    const primaryHref = `/studio/project/${encodeURIComponent(createdId)}/chat${createdMode === "general" ? "" : "?mode=play"}`;
    return (
      <main
        className="p2CreateShell"
        data-testid="create-indexeddb-runtime"
        data-persistence-backend="indexeddb"
        data-persistence-degraded="false"
        data-memory-fallback="false"
      >
        <section className="p2CreateSuccess">
          <span>建立完成</span>
          <h1>{draft.title.trim()}</h1>
          <strong>{STORY_PLAY_MODE_LABELS[createdMode]} · 已鎖定</strong>
          <p>{message}</p>
          <div>
            <Link className="primaryAction" href={primaryHref}>
              {createdMode === "general" ? "進入故事工作台" : "在故事工作台開始遊玩"}
            </Link>
            <Link className="secondaryAction" href={`/studio/project/${createdId}/write`}>章節正式稿校訂（專業工具）</Link>
            <Link className="secondaryAction" href={`/professional?intent=library&projectId=${encodeURIComponent(createdId)}`}>作品資料管理（專業工具）</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="p2CreateShell" data-testid="canonical-create-flow">
      <header>
        <div className="p2CreateExitActions">
          <Link href="/">儲存草稿並回首頁</Link>
          <button type="button" className="dangerAction" onClick={abandonCreation}>放棄此次建立</button>
        </div>
        <div>
          <span>{cloneFrom ? "複製為新玩法" : "建立新作品"}</span>
          <h1>先命名、選玩法，再建立故事起點</h1>
          <p>設定完成前不會出現 A／B／C，也不會讓其他功能磚打斷這個流程。</p>
        </div>
        <small>建立後玩法鎖定；換玩法請複製新作品</small>
      </header>

      <section className="p2TitleGate" data-valid={Boolean(draft.title.trim())}>
        <label htmlFor="p2-project-title">
          <span>作品名稱 <strong>必填</strong></span>
          <input
            ref={titleInputRef}
            id="p2-project-title"
            data-testid="p2-project-title"
            value={draft.title}
            aria-invalid={Boolean(titleError)}
            onChange={(event) => {
              set({ title: event.target.value });
              if (event.target.value.trim()) setTitleError("");
            }}
            placeholder="例如：星河盡頭的歸途"
            autoComplete="off"
          />
        </label>
        <p>名稱會綁定這部作品的章節、玩法、角色、世界設定、StoryState 與備份。</p>
        {titleError ? <div className="p2TitleError" role="alert">{titleError}</div> : null}
      </section>

      <section className="p2LanguageGate" aria-labelledby="p2-story-language-title" data-testid="p2-story-language">
        <div>
          <span>作品語言</span>
          <h2 id="p2-story-language-title">正文與 AI 候選使用哪一種語言？</h2>
          <p>選定後，故事種子、正文、選項與回合續寫都必須使用同一種語言。</p>
        </div>
        <div className="p2LanguageChoices">
          {(Object.keys(STORY_LANGUAGE_LABELS) as StoryLanguage[]).map((language) => (
            <button
              key={language}
              type="button"
              className={storyLanguageOf(draft) === language ? "active" : ""}
              aria-pressed={storyLanguageOf(draft) === language}
              onClick={() => setAnswer("language", language)}
            >
              <b>{STORY_LANGUAGE_LABELS[language]}</b>
              <span>{language}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="p2PlayModeGate" aria-labelledby="p2-play-mode-title">
        <div>
          <span>第 1 個決定</span>
          <h2 id="p2-play-mode-title">先選擇寫作方式</h2>
          <p>一般小說使用章節續寫；三選一作品會在下一步再選玩法，而且每個回合都由三條路線推進。</p>
        </div>
        <div className="p2PlayModeGrid" data-level="structure">
          <button type="button" disabled={!draft.title.trim()} className={playStructure === "general" ? "active" : ""} aria-pressed={playStructure === "general"} data-testid="create-play-mode-general" data-play-structure="general" onClick={() => choosePlayStructure("general")}>
            <b>一般章節寫作</b>
            <span>自由續寫、改寫、章節校訂與閱讀，不強制回合選項。</span>
          </button>
          <button type="button" disabled={!draft.title.trim()} className={playStructure === "choice" ? "active" : ""} aria-pressed={playStructure === "choice"} data-testid="create-play-structure-choice" onClick={() => choosePlayStructure("choice")}>
            <b>三選一互動</b>
            <span>每回合自動提供三條真正不同的路線；只將選中的結果寫入正文。</span>
          </button>
        </div>
      </section>

      {playStructure === "choice" ? (
        <section className="p2PlayModeGate p2PlaySubtypeGate" aria-labelledby="p2-play-subtype-title" data-testid="create-three-choice-subtypes">
          <div>
            <span>第 2 個決定</span>
            <h2 id="p2-play-subtype-title">選擇三選一玩法</h2>
            <p>三種玩法都採 A／B／C 回合；差別只在要追蹤的成長、關係與資源。</p>
          </div>
          <div className="p2PlayModeGrid" data-level="subtype">
            {(["rpg", "romance", "management"] as StoryPlayModeId[]).map((mode) => (
              <button key={mode} type="button" disabled={!draft.title.trim()} className={currentPlayMode === mode ? "active" : ""} aria-pressed={currentPlayMode === mode} data-testid={`create-play-mode-${mode}`} onClick={() => choosePlayMode(mode)}>
                <b>{STORY_PLAY_MODE_LABELS[mode]}</b>
                <span>{mode === "rpg" ? "能力、任務、裝備、貨幣與故事回合" : mode === "romance" ? "關係、信任、事件與人物成長" : "資金、人力、品質、聲望與風險"}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <nav className="p2ModeTabs" aria-label="建立方式">
        <button disabled={!draft.title.trim()} className={draft.mode === "quick" ? "active" : ""} onClick={() => chooseBuildMode("quick")}><b>快速開始</b><span>少量設定，立即看可修改雛形</span></button>
        <button disabled={!draft.title.trim()} className={draft.mode === "guided" ? "active" : ""} onClick={() => chooseBuildMode("guided")}><b>引導建立</b><span>用五個問題整理人物與第一幕</span></button>
        <button disabled={!draft.title.trim()} className={draft.mode === "blank" ? "active" : ""} onClick={() => chooseBuildMode("blank")}><b>完整故事庫</b><span>從完整題材庫挑選，再確認故事種子</span></button>
      </nav>

      <div className="p2CreateLayout">
        <section className="p2CreatePanel">
          <div className="p2StepBar" aria-label={`第 ${draft.step} 步，共 ${modeSteps} 步`}>
            {Array.from({ length: modeSteps }, (_, index) => <i key={index} className={index < draft.step ? "done" : ""} />)}
          </div>

          {draft.mode === "blank"
            ? <Library draft={draft} set={set} topics={topics} />
            : draft.mode === "guided"
              ? <Guided draft={draft} setAnswer={setAnswer} />
              : <Quick draft={draft} set={set} topics={topics} />}

          <section className="p2CreationAssistant" aria-label="創作帶領精靈">
            <div>
              <span>創作帶領精靈</span>
              <h3>五題完成即可建立，不必先選 AI</h3>
              <p>建立頁只整理故事起點；建立完成後，續寫、改寫與 RPG 都在唯一故事工作台交給閉端 AI 自動協調器。</p>
            </div>
            <div className="p2CreationAssistantActions">
              <button type="button" onClick={applyProcedural}>立即產生裝置亂數雛形 <small>非 AI</small></button>
            </div>
          </section>

          {missing.length ? <div className="p2FoundationWarning" role="status"><b>開始前還缺：</b>{missing.join("、")}<span>補齊前不會產生第一回合 A／B／C。</span></div> : <div className="p2FoundationReady"><b>故事起點已完整</b><span>建立作品後才會依選定玩法開啟正文或第一回合。</span></div>}

          <footer>
            <button disabled={draft.step <= 1} onClick={() => set({ step: Math.max(1, draft.step - 1) })}>上一步</button>
            {draft.step < modeSteps
              ? <button className="gold" onClick={advance}>繼續</button>
              : <button className="gold" disabled={saving} onClick={() => void finish()}>{saving ? "建立中……" : `建立「${currentPlayMode ? STORY_PLAY_MODE_LABELS[currentPlayMode] : "尚未選玩法"}」作品`}</button>}
          </footer>
          {message ? <p className="p2CreateMessage" role="status" aria-live="polite">{message}</p> : null}
          {persistenceIssue ? (
            <PersistenceRecoveryNotice
              failure={persistenceIssue}
              onRetry={() => window.location.reload()}
            />
          ) : null}
        </section>

        <aside className="p2SeedPreview">
          <span>正式建立前預覽</span>
          <h2>{draft.title.trim() || "請先輸入作品名稱"}</h2>
          <strong>{currentPlayMode ? STORY_PLAY_MODE_LABELS[currentPlayMode] : "尚未選擇玩法"}</strong>
          <dl>
            <div><dt>題材</dt><dd>{topic?.name || "尚未設定"}</dd></div>
            <div><dt>核心想法</dt><dd>{seed.logline.value || draft.coreIdea.value || "稍後補充"}</dd></div>
            <div><dt>主角</dt><dd>{seed.protagonist.value || "稍後補充"}</dd></div>
            <div><dt>故事舞台</dt><dd>{seed.world.value || seed.worldRule.value || "稍後補充"}</dd></div>
            <div><dt>主要阻力</dt><dd>{seed.conflict.value || "稍後補充"}</dd></div>
            <div><dt>第一章起點</dt><dd>{seed.opening.value || "稍後補充"}</dd></div>
          </dl>
          <p>只有你填寫或點選裝置亂數產生的內容會進入新作品。建立後，所有 AI 續寫、改寫與 RPG 都在故事工作台由自動協調器處理。</p>
        </aside>
      </div>
    </main>
  );
}

function Quick({ draft, set, topics }: {
  draft: ProjectCreationDraft;
  set: (partial: Partial<ProjectCreationDraft>) => void;
  topics: ReturnType<typeof listStoryTopics>;
}) {
  if (draft.step === 1) {
    return (
      <div className="p2CreateFields">
        <h2>選擇故事方向</h2>
        <label>分類包（選填）
          <select value={draft.genrePackId || ""} onChange={(event) => set({ genrePackId: event.target.value || null, genreId: null, seedCandidate: null })}>
            <option value="">查看全部</option>
            {STORY_LIBRARY.packs.filter((item) => item.enabled).map((item) => <option key={item.packId} value={item.packId}>{item.name}</option>)}
          </select>
        </label>
        <div className="p2TopicGrid">
          {topics.slice(0, 18).map((item) => <button type="button" key={item.topicId} className={draft.genreId === item.topicId ? "active" : ""} onClick={() => set({ genreId: item.topicId, seedCandidate: null })}><b>{item.name}</b><span>{item.description}</span></button>)}
        </div>
      </div>
    );
  }
  if (draft.step === 2) {
    return (
      <div className="p2CreateFields">
        <h2>放入人物與故事核心</h2>
        <label>核心想法<textarea value={draft.coreIdea.value || ""} onChange={(event) => set({ coreIdea: optionalValue(event.target.value || null, event.target.value ? "user_defined" : "deferred"), seedCandidate: null })} /></label>
        <label>主角姓名<input value={draft.protagonist.value || ""} onChange={(event) => set({ protagonist: optionalValue(event.target.value || null, event.target.value ? "user_defined" : "deferred"), seedCandidate: null })} /></label>
        <label>故事舞台／世界規則<textarea value={draft.answers.worldRule?.value || ""} onChange={(event) => set({ answers: { ...draft.answers, worldRule: optionalValue(event.target.value || null, event.target.value ? "user_defined" : "deferred") }, seedCandidate: null })} /></label>
        <label>目標或衝突<textarea value={draft.answers.conflict?.value || ""} onChange={(event) => set({ answers: { ...draft.answers, conflict: optionalValue(event.target.value || null, event.target.value ? "user_defined" : "deferred") }, seedCandidate: null })} /></label>
        <label>開場事件<textarea value={draft.answers.opening?.value || ""} onChange={(event) => set({ answers: { ...draft.answers, opening: optionalValue(event.target.value || null, event.target.value ? "user_defined" : "deferred") }, seedCandidate: null })} /></label>
      </div>
    );
  }
  return <SeedEditor draft={draft} set={set} />;
}

function Guided({ draft, setAnswer }: {
  draft: ProjectCreationDraft;
  setAnswer: (key: string, value: string | null, status?: "user_defined" | "deferred") => void;
}) {
  const question = questions[Math.min(questions.length - 1, draft.step - 1)];
  const selected = draft.answers[question.key]?.value;
  return (
    <div className="p2CreateFields">
      <span>第 {draft.step} 題／共 5 題</span>
      <h2>{question.title}</h2>
      <div className="p2GuidedChoices">
        {question.choices.map((choice, index) => <button type="button" key={choice} className={selected === choice ? "active" : ""} onClick={() => setAnswer(question.key, choice)}><b>{String.fromCharCode(65 + index)}</b>{choice}</button>)}
      </div>
      <label>自己輸入<input value={selected && !question.choices.some((choice) => choice === selected) ? selected : ""} onChange={(event) => setAnswer(question.key, event.target.value || null, event.target.value ? "user_defined" : "deferred")} /></label>
      <button type="button" onClick={() => setAnswer(question.key, null, "deferred")}>清除此題</button>
    </div>
  );
}

function Library({ draft, set, topics }: {
  draft: ProjectCreationDraft;
  set: (partial: Partial<ProjectCreationDraft>) => void;
  topics: ReturnType<typeof listStoryTopics>;
}) {
  if (draft.step === 1) {
    return (
      <div className="p2CreateFields">
        <h2>完整故事庫</h2>
        <p>這裡是題材與規則索引，不是下載小說全文。選擇後只會帶入創作方向。</p>
        <div className="p2TopicGrid p2TopicGridLarge">
          {topics.map((item) => <button type="button" key={item.topicId} className={draft.genreId === item.topicId ? "active" : ""} onClick={() => set({ genrePackId: item.packId, genreId: item.topicId, seedCandidate: null })}><b>{item.name}</b><span>{item.description}</span></button>)}
        </div>
      </div>
    );
  }
  return <SeedEditor draft={draft} set={set} />;
}

function SeedEditor({ draft, set }: {
  draft: ProjectCreationDraft;
  set: (partial: Partial<ProjectCreationDraft>) => void;
}) {
  const seed = draft.seedCandidate ?? buildSeedCandidate(draft);
  const update = (key: keyof Pick<ProjectSeed, "logline" | "protagonist" | "goal" | "world" | "worldRule" | "conflict" | "opening">, value: string) => set({
    seedCandidate: {
      ...seed,
      [key]: optionalValue(value || null, value ? "user_defined" : "deferred"),
    },
  });
  return (
    <div className="p2CreateFields p2SeedEditor">
      <h2>確認《{draft.title.trim()}》的故事起點</h2>
      <label>一句話故事<textarea value={seed.logline.value || ""} onChange={(event) => update("logline", event.target.value)} /></label>
      <div className="p2SeedEditorGrid">
        <label>主角<input value={seed.protagonist.value || ""} onChange={(event) => update("protagonist", event.target.value)} /></label>
        <label>主角目標<input value={seed.goal.value || ""} onChange={(event) => update("goal", event.target.value)} /></label>
        <label>故事舞台<textarea value={seed.world.value || ""} onChange={(event) => update("world", event.target.value)} /></label>
        <label>世界規則<textarea value={seed.worldRule.value || ""} onChange={(event) => update("worldRule", event.target.value)} /></label>
        <label>主要衝突<textarea value={seed.conflict.value || ""} onChange={(event) => update("conflict", event.target.value)} /></label>
        <label>開場事件<textarea value={seed.opening.value || ""} onChange={(event) => update("opening", event.target.value)} /></label>
      </div>
    </div>
  );
}
