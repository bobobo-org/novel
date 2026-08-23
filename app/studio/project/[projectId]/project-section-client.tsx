"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClosedAIProgressEvent } from "@/lib/novel-ai/closed-agent-os";
import {
  makeRecord,
  optionalValue,
  type Achievement,
  type Chapter,
  type Character,
  type CharacterPortrait,
  type CharacterRpgArchetype,
  type CharacterRpgStatKey,
  type DomainRecord,
  type LoreEntry,
  type NovelProject,
  type ProjectBackup,
  type StoryBible,
  type TimelineEvent,
  type World,
  type WorldRule,
  type WritingTask,
} from "@/lib/novel-ai/domain";
import type { SocialWorldApprovalJournal } from "@/lib/novel-ai/social-world-approval";
import {
  createNovelRepository,
  persistenceFailureOrNull,
  type NovelRepository,
  type NovelStoreName,
  type PersistenceFailure,
} from "@/lib/novel-ai/repository";
import {
  backupDownload,
  createProjectBackup,
  markdownDownload,
  restoreProjectBackup,
  validateBackupPayload,
} from "@/lib/novel-ai/repository/backup";
import {
  CHARACTER_PORTRAIT_CATALOG,
  CHARACTER_PORTRAIT_THEME_OPTIONS,
  filterCharacterPortraitCatalog,
} from "@/lib/novel-ai/character-portraits/catalog";
import { prepareCharacterPortraitUpload } from "@/lib/novel-ai/character-portraits/upload";
import {
  CHARACTER_RPG_ARCHETYPES,
  CHARACTER_RPG_POINT_BUDGET,
  CHARACTER_RPG_STAT_LABELS,
  characterRpgPointTotal,
  characterRpgStatsForArchetype,
  createCharacterRpgProfile,
  suggestCharacterRpgArchetype,
} from "@/lib/novel-ai/game/character-rpg-profile";
import { RELEASE_MANIFEST } from "@/lib/release-manifest";
import {
  executeStudioClosedAgent,
  getStudioClosedAgentOS,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import CharacterPortraitImage from "./character-portrait";
import ProjectNavigation from "./project-navigation";
import { ProjectContextSummary, ProjectContextTabs } from "./project-context-tabs";
import SocialWorldLibrary from "./social-world-library";
import PersistenceRecoveryNotice from "../../persistence-recovery-notice";

type Section =
  | "characters"
  | "world"
  | "timeline"
  | "story-bible"
  | "tasks"
  | "achievements"
  | "backups";

type Data = {
  project: NovelProject | null;
  chapters: Chapter[];
  characters: Character[];
  lore: LoreEntry[];
  approvalJournals: SocialWorldApprovalJournal[];
  worlds: World[];
  rules: WorldRule[];
  timeline: TimelineEvent[];
  bibles: StoryBible[];
  tasks: WritingTask[];
  achievements: Achievement[];
  backups: ProjectBackup[];
};

const titles: Record<Section, [string, string]> = {
  characters: ["人物與世界", "在角色資料、角色視角 AI 與世界設定之間切換。"],
  world: ["人物與世界", "在角色資料、角色視角 AI 與世界設定之間切換。"],
  timeline: ["故事脈絡", "用時間線與故事記憶兩個視角整理同一部作品。"],
  "story-bible": ["故事脈絡", "用時間線與故事記憶兩個視角整理同一部作品。"],
  tasks: ["任務", "建立與追蹤作品的創作目標。"],
  achievements: ["成就", "管理創作里程碑與解鎖進度。"],
  backups: ["備份與還原", "建立、下載、匯入、還原與刪除作品備份。"],
};

const TASK_KIND_LABELS: Array<[WritingTask["kind"], string]> = [
  ["main", "主線"],
  ["side", "支線"],
  ["character", "角色"],
  ["world", "世界"],
  ["writing", "寫作"],
  ["exploration", "探索"],
  ["relationship", "人物關係"],
];

function lines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function listText(value: string[] | undefined) {
  return (value ?? []).join("\n");
}

function closedAIHref(projectId: string, task: string, objective: string) {
  const query = new URLSearchParams({ task, objective, source: "project-data" });
  return `/studio/project/${encodeURIComponent(projectId)}/closed-ai?${query.toString()}`;
}

function storyBibleChatHref(projectId: string) {
  const query = new URLSearchParams({
    prompt: "請讀取這部作品目前的 Story Bible，協助我檢查人物、世界、時間線、伏筆與禁止矛盾；先說明證據，不要直接修改 Canon。",
  });
  return `/studio/project/${encodeURIComponent(projectId)}/chat?${query.toString()}`;
}

async function updateStoryBibleReferences(
  repository: NovelRepository,
  projectId: string,
  update: (storyBible: StoryBible) => StoryBible,
) {
  for (const storyBible of await repository.list<StoryBible>("storyBibles", projectId)) {
    const next = update(storyBible);
    if (JSON.stringify(next) !== JSON.stringify(storyBible)) {
      await repository.put<StoryBible>("storyBibles", next, storyBible.revision);
    }
  }
}

function withoutId(values: string[], id: string) {
  return values.filter((value) => value !== id);
}

type CharacterAIDraft = {
  name: string;
  aliases: string[];
  identity: string;
  goal: string;
  lifeStatus: Character["lifeStatus"];
  location: string;
  age: number | null;
  personality: string;
  fears: string[];
  privateSecrets: string[];
  factions: string[];
  values: string[];
  capabilities: string[];
  limitations: string[];
  voiceStyle: "short" | "mixed" | "long";
  isProtagonist: boolean;
  rpgArchetype: CharacterRpgArchetype;
  rpgStats: Record<CharacterRpgStatKey, number>;
};

type CharacterAICandidate = {
  candidateId: string | null;
  modelId: string;
  actualExecutor: string;
  contextSourceSummary: string | null;
  source: "closed-ai" | "local-rules-fallback";
  fallbackReason: string | null;
  applied: boolean;
  draft: CharacterAIDraft;
};

type CharacterAIFormSnapshot = {
  name: string;
  aliases: string;
  identity: string;
  goal: string;
  lifeStatus: Character["lifeStatus"];
  location: string;
  age: string;
  ageVerified: boolean;
  personality: string;
  fear: string;
  secret: string;
  faction: string;
  values: string;
  capabilities: string;
  limitations: string;
  voiceStyle: "short" | "mixed" | "long";
  isProtagonist: boolean;
  rpgArchetype: CharacterRpgArchetype;
  rpgStats: Record<CharacterRpgStatKey, number>;
};

const CHARACTER_AI_STAT_KEYS = Object.keys(
  CHARACTER_RPG_STAT_LABELS,
) as CharacterRpgStatKey[];

function characterAIText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function characterAIList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(characterAIText).filter(Boolean).slice(0, 8);
  }
  return characterAIText(value).split(/[、,，\n]/u).map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

function normalizeAICharacterStats(
  raw: unknown,
  archetype: CharacterRpgArchetype,
) {
  const fallback = characterRpgStatsForArchetype(
    archetype === "custom" ? "balanced" : archetype,
  );
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const aliases: Record<CharacterRpgStatKey, string[]> = {
    "rpg.physique": ["rpg.physique", "physique", "體能"],
    "rpg.technique": ["rpg.technique", "technique", "技巧"],
    "rpg.intellect": ["rpg.intellect", "intellect", "智慧"],
    "rpg.charisma": ["rpg.charisma", "charisma", "魅力"],
    "rpg.will": ["rpg.will", "will", "意志"],
    "rpg.creativity": ["rpg.creativity", "creativity", "創造"],
  };
  let supplied = false;
  const stats = Object.fromEntries(CHARACTER_AI_STAT_KEYS.map((key) => {
    const value = aliases[key].map((alias) => record[alias]).find((item) => Number.isFinite(Number(item)));
    if (value !== undefined) supplied = true;
    const resolved = value === undefined ? fallback[key] : Number(value);
    return [key, Math.max(20, Math.min(80, Math.round(resolved)))];
  })) as Record<CharacterRpgStatKey, number>;
  if (!supplied) return fallback;
  let delta = CHARACTER_RPG_POINT_BUDGET - characterRpgPointTotal(stats);
  let cursor = 0;
  while (delta !== 0 && cursor < 2_000) {
    const key = CHARACTER_AI_STAT_KEYS[cursor % CHARACTER_AI_STAT_KEYS.length];
    if (delta > 0 && stats[key] < 80) {
      stats[key] += 1;
      delta -= 1;
    } else if (delta < 0 && stats[key] > 20) {
      stats[key] -= 1;
      delta += 1;
    }
    cursor += 1;
  }
  return stats;
}

function parseCharacterAIDraft(content: string, currentName: string): CharacterAIDraft {
  const json = content.match(/\{[\s\S]*\}/u)?.[0];
  if (!json) throw new Error("模型沒有回傳可辨識的角色 JSON，正式資料未變更。請再試一次。");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("模型回傳的角色資料格式不完整，正式資料未變更。請再試一次。");
  }
  const archetypeValue = characterAIText(parsed.rpgArchetype);
  const validArchetypes = new Set(CHARACTER_RPG_ARCHETYPES.map((item) => item.id));
  const inferredArchetype = suggestCharacterRpgArchetype([
    characterAIText(parsed.identity),
    ...characterAIList(parsed.capabilities),
    ...characterAIList(parsed.values),
  ]);
  const rpgArchetype = validArchetypes.has(archetypeValue as CharacterRpgArchetype)
    ? archetypeValue as CharacterRpgArchetype
    : inferredArchetype;
  const lifeStatusValue = characterAIText(parsed.lifeStatus);
  const voiceStyleValue = characterAIText(parsed.voiceStyle);
  const ageValue = Number(parsed.age);
  return {
    name: characterAIText(parsed.name) || currentName.trim() || "未命名角色",
    aliases: characterAIList(parsed.aliases),
    identity: characterAIText(parsed.identity),
    goal: characterAIText(parsed.goal),
    lifeStatus: ["alive", "dead", "unknown"].includes(lifeStatusValue)
      ? lifeStatusValue as Character["lifeStatus"]
      : "alive",
    location: characterAIText(parsed.location),
    age: Number.isFinite(ageValue) && ageValue >= 0 && ageValue <= 300
      ? Math.round(ageValue)
      : null,
    personality: characterAIText(parsed.personality),
    fears: characterAIList(parsed.fears),
    privateSecrets: characterAIList(parsed.privateSecrets),
    factions: characterAIList(parsed.factions),
    values: characterAIList(parsed.values),
    capabilities: characterAIList(parsed.capabilities),
    limitations: characterAIList(parsed.limitations),
    voiceStyle: ["short", "mixed", "long"].includes(voiceStyleValue)
      ? voiceStyleValue as "short" | "mixed" | "long"
      : "mixed",
    isProtagonist: parsed.isProtagonist === true,
    rpgArchetype,
    rpgStats: normalizeAICharacterStats(parsed.rpgStats, rpgArchetype),
  };
}

function characterAIFailureCode(cause: unknown) {
  const code = (cause as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,100}$/u.test(code)) return code;
  if (cause instanceof Error && /\bOLLAMA_TIMEOUT\b/u.test(cause.message)) return "OLLAMA_TIMEOUT";
  return cause instanceof Error && /timeout|逾時|超時/iu.test(cause.message)
    ? "MODEL_TIMEOUT"
    : "MODEL_OUTPUT_UNAVAILABLE";
}

function characterAIRuleFallback(
  snapshot: CharacterAIFormSnapshot,
  projectId: string,
  variant: number,
): CharacterAIDraft {
  const textSeed = [
    projectId,
    snapshot.name,
    snapshot.identity,
    snapshot.goal,
    snapshot.faction,
    String(variant),
  ].join("|");
  let seed = 2_166_136_261;
  for (const character of textSeed) {
    seed ^= character.codePointAt(0) ?? 0;
    seed = Math.imul(seed, 16_777_619) >>> 0;
  }
  const choose = <T,>(values: readonly T[], offset: number) =>
    values[((seed + Math.imul(offset + 1, 2_654_435_761)) >>> 0) % values.length]!;
  const name = snapshot.name.trim() || `${choose(["沈", "蘇", "顧", "楚", "葉", "洛", "林", "謝"], 0)}${choose(["星河", "清弦", "照雪", "景行", "雲岫", "知微", "長寧", "若衡"], 1)}`;
  const faction = characterAIList(snapshot.faction);
  const identity = snapshot.identity.trim() || choose([
    "負責追查異常事件的外門執事",
    "背負家族舊約的流浪術士",
    "熟悉藥理與情報交換的行商",
    "被迫捲入權力角力的年輕護衛",
    "守護禁地線索的低調門人",
    "能辨識謊言代價的地方記錄官",
  ] as const, 2);
  const personality = snapshot.personality.trim() || choose([
    "冷靜審慎，遇到弱者時會打破自己的規矩",
    "言語直接但重視承諾，習慣先觀察再出手",
    "表面隨和，實際會把每筆人情與風險記在心裡",
    "好勝而不莽撞，願意承擔自己決策造成的代價",
    "戒心很強，只有在證據充分時才交付信任",
  ] as const, 3);
  const capabilities = characterAIList(snapshot.capabilities);
  const values = characterAIList(snapshot.values);
  const limitations = characterAIList(snapshot.limitations);
  const rpgArchetype = snapshot.rpgArchetype === "custom"
    ? suggestCharacterRpgArchetype([identity, personality, ...capabilities, ...values])
    : snapshot.rpgArchetype;
  return {
    name,
    aliases: characterAIList(snapshot.aliases),
    identity,
    goal: snapshot.goal.trim() || choose([
      "查清眼前危機的真正受益者，同時保住最重要的盟友。",
      "在不犧牲無辜者的前提下，取得足以改變自身命運的資格。",
      "找回失落的證據，證明家族舊案另有主謀。",
      "建立一個不再依賴強者施捨的安全立足點。",
      "阻止秘密交易完成，並查出內應隱藏的身分。",
    ] as const, 4),
    lifeStatus: snapshot.lifeStatus,
    location: snapshot.location.trim() || choose(["城郊驛站", "宗門外院", "邊境市集", "廢棄藥圃", "家族舊宅"], 5),
    age: snapshot.age.trim() && Number.isFinite(Number(snapshot.age))
      ? Math.max(0, Math.min(300, Math.round(Number(snapshot.age))))
      : null,
    personality,
    fears: characterAIList(snapshot.fear).length
      ? characterAIList(snapshot.fear)
      : [choose(["重演一次未能救人的失敗", "信任被當成弱點利用", "身分暴露後連累同行者", "在關鍵時刻失去判斷力"], 6)],
    privateSecrets: characterAIList(snapshot.secret),
    factions: faction.length ? faction : [choose(["青霄外院", "聽雨商會", "無名藥堂", "北境巡盟", "自由行旅"], 7)],
    values: values.length ? values : ["守信", choose(["自由", "家族", "公義", "求真", "互助"], 8)],
    capabilities: capabilities.length
      ? capabilities
      : [choose(["劍術", "醫術", "追蹤", "談判", "陣法", "情報分析"], 9), choose(["危機判斷", "細節觀察", "資源調度", "靈息感知"], 10)],
    limitations: limitations.length
      ? limitations
      : [choose(["舊傷在長時間戰鬥後復發", "無法對受信任者說出完整謊言", "每次動用秘術都會留下可追蹤痕跡", "對家族相關威脅容易失去冷靜"], 11)],
    voiceStyle: snapshot.voiceStyle,
    isProtagonist: snapshot.isProtagonist,
    rpgArchetype,
    rpgStats: snapshot.rpgArchetype === "custom"
      ? normalizeAICharacterStats(snapshot.rpgStats, rpgArchetype)
      : characterRpgStatsForArchetype(rpgArchetype),
  };
}

export default function ProjectSectionClient({
  projectId,
  section,
}: {
  projectId: string;
  section: Section;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [failure, setFailure] = useState<PersistenceFailure | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);

  async function load() {
    setRetrying(true);
    try {
      const repo = createNovelRepository();
      const [
        project,
        chapters,
        characters,
        lore,
        approvalJournals,
        worlds,
        rules,
        timeline,
        bibles,
        tasks,
        achievements,
        backups,
      ] = await Promise.all([
        repo.get<NovelProject>("projects", projectId),
        repo.list<Chapter>("chapters", projectId),
        repo.list<Character>("characters", projectId),
        repo.list<LoreEntry>("lore", projectId),
        repo.list<SocialWorldApprovalJournal>("operationJournal", projectId),
        repo.list<World>("worlds", projectId),
        repo.list<WorldRule>("worldRules", projectId),
        repo.list<TimelineEvent>("timeline", projectId),
        repo.list<StoryBible>("storyBibles", projectId),
        repo.list<WritingTask>("tasks", projectId),
        repo.list<Achievement>("achievements", projectId),
        repo.list<ProjectBackup>("backups", projectId),
      ]);
      setData({
        project,
        chapters: chapters.sort((left, right) => left.order - right.order),
        characters: characters.sort((left, right) => left.name.localeCompare(right.name, "zh-Hant")),
        lore,
        approvalJournals: approvalJournals.filter(
          (journal) => journal.operationType === "social-world-approval-v1",
        ),
        worlds,
        rules: rules.sort((left, right) => left.title.localeCompare(right.title, "zh-Hant")),
        timeline: timeline.sort((left, right) =>
          (left.storyTime ?? left.createdAt).localeCompare(right.storyTime ?? right.createdAt)),
        bibles,
        tasks,
        achievements,
        backups: backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      });
      setFailure(null);
      setError("");
    } catch (cause) {
      const nextFailure = persistenceFailureOrNull(cause);
      setFailure(nextFailure);
      setError(nextFailure ? "" : cause instanceof Error ? cause.message : "資料載入失敗");
    } finally {
      setRetrying(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failure) {
    return (
      <main
        className="p2ProjectShell"
        data-persistence-backend="indexeddb"
        data-persistence-degraded="true"
        data-memory-fallback="false"
      >
        <PersistenceRecoveryNotice failure={failure} retrying={retrying} onRetry={load} />
      </main>
    );
  }
  if (error) {
    return (
      <main className="p2ProjectShell">
        <p role="alert">資料載入失敗：{error}</p>
        <button type="button" disabled={retrying} onClick={() => void load()}>重新載入</button>
      </main>
    );
  }
  if (!data) return <main className="p2ProjectShell"><p>正在載入作品資料…</p></main>;
  if (!data.project) {
    return (
      <main className="p2ProjectShell">
        <h1>找不到作品</h1>
        <Link href="/studio/create">建立新作品</Link>
      </main>
    );
  }

  const [title, description] = titles[section];
  return (
    <main
      className="p2ProjectShell"
      data-testid="project-indexeddb-runtime"
      data-persistence-backend="indexeddb"
      data-persistence-degraded="false"
      data-memory-fallback="false"
    >
      <header>
        <Link href={`/professional?intent=library&projectId=${encodeURIComponent(projectId)}`}>作品管理中心</Link>
        <div><small>{data.project.title}</small><h1>{title}</h1></div>
        <span data-testid="indexeddb-ready">IndexedDB 本機保存正常</span>
      </header>
      <ProjectNavigation projectId={projectId} active={section} />
      <section className="p2ProjectSection">
        <header><h2>{title}</h2><p>{description}</p></header>
        <SectionBody section={section} data={data} onChanged={load} />
      </section>
    </main>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="p2DataEmpty">
      <p>{children}</p>
      <span>可以現在建立，也可以稍後再補充。</span>
    </div>
  );
}

function SectionBody({
  section,
  data,
  onChanged,
}: {
  section: Section;
  data: Data;
  onChanged: () => Promise<void>;
}) {
  const project = data.project!;
  if (section === "characters") {
    return (
      <>
        <ProjectContextTabs projectId={project.id} context="people-world" active="characters" />
        <SocialWorldLibrary
          key="social-world-library-characters"
          project={project}
          approvedCharacters={data.characters}
          approvedLore={data.lore}
          approvalJournals={data.approvalJournals}
          storyBibles={data.bibles}
          approvedWorlds={data.worlds}
          onChanged={onChanged}
        />
        <CharacterEditor projectId={project.id} characters={data.characters} storyBibles={data.bibles} onChanged={onChanged} />
      </>
    );
  }
  if (section === "world") {
    return (
      <>
        <ProjectContextTabs projectId={project.id} context="people-world" active="world" />
        <SocialWorldLibrary
          key="social-world-library-worlds"
          project={project}
          approvedCharacters={data.characters}
          approvedLore={data.lore}
          approvalJournals={data.approvalJournals}
          storyBibles={data.bibles}
          approvedWorlds={data.worlds}
          initialView="worlds"
          onChanged={onChanged}
        />
        <WorldEditor
          projectId={project.id}
          worlds={data.worlds}
          rules={data.rules}
          onChanged={onChanged}
        />
      </>
    );
  }
  if (section === "timeline") {
    return <StoryContextWorkspace activeView="timeline" data={data} onChanged={onChanged} />;
  }
  if (section === "story-bible") {
    return <StoryContextWorkspace activeView="story-bible" data={data} onChanged={onChanged} />;
  }
  if (section === "tasks") {
    return (
      <>
        <ProjectContextTabs projectId={project.id} context="progress" active="tasks" />
        <TaskEditor projectId={project.id} tasks={data.tasks} onChanged={onChanged} />
      </>
    );
  }
  if (section === "achievements") {
    return (
      <>
        <ProjectContextTabs projectId={project.id} context="progress" active="achievements" />
        <AchievementEditor
          projectId={project.id}
          achievements={data.achievements}
          onChanged={onChanged}
        />
      </>
    );
  }
  return (
    <BackupCenter
      projectId={project.id}
      title={project.title}
      backups={data.backups}
      onChanged={onChanged}
    />
  );
}

function StoryContextWorkspace({
  activeView,
  data,
  onChanged,
}: {
  activeView: "timeline" | "story-bible";
  data: Data;
  onChanged: () => Promise<void>;
}) {
  const project = data.project!;
  const storyBible = data.bibles.find((item) => item.id === project.storyBibleId) ?? data.bibles[0] ?? null;
  const linkedChapterCount = new Set(
    data.timeline.map((event) => event.chapterId).filter((chapterId): chapterId is string => Boolean(chapterId)),
  ).size;
  const memoryItemCount = storyBible
    ? storyBible.foreshadowing.length
      + storyBible.unresolvedThreads.length
      + storyBible.forbiddenContradictions.length
      + storyBible.authorPreferences.length
    : 0;

  return (
    <div data-testid="story-context-workspace" data-active-view={activeView}>
      <ProjectContextTabs projectId={project.id} context="story" active={activeView} />
      <ProjectContextSummary
        items={[
          {
            label: "時間線事件",
            value: data.timeline.length,
            detail: linkedChapterCount ? `已連結 ${linkedChapterCount} 個章節` : "尚未連結章節",
          },
          {
            label: "正式故事記憶",
            value: storyBible ? `版本 ${storyBible.revision}` : "尚未建立",
            detail: `${memoryItemCount} 項伏筆、線索與規則`,
          },
          {
            label: "待收束線索",
            value: storyBible?.unresolvedThreads.length ?? 0,
            detail: `${storyBible?.foreshadowing.length ?? 0} 項伏筆正在追蹤`,
          },
        ]}
        notice="AI 檢查與整理只會建立候選；只有你按下儲存或完成核准，才會更新正式 Canon。本區不會冒充已完成未經核准的時間線與故事記憶自動雙寫。"
      />
      {activeView === "timeline" ? (
        <TimelineEditor
          projectId={project.id}
          chapters={data.chapters}
          events={data.timeline}
          onChanged={onChanged}
        />
      ) : (
        <StoryBibleEditor
          key={`${project.id}:${storyBible?.id ?? project.storyBibleId}`}
          project={project}
          storyBible={storyBible}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function CharacterEditor({
  projectId,
  characters,
  storyBibles,
  onChanged,
}: {
  projectId: string;
  characters: Character[];
  storyBibles: StoryBible[];
  onChanged: () => Promise<void>;
}) {
  const closedAgentOS = useMemo(() => getStudioClosedAgentOS(), []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [identity, setIdentity] = useState("");
  const [goal, setGoal] = useState("");
  const [lifeStatus, setLifeStatus] = useState<Character["lifeStatus"]>("alive");
  const [location, setLocation] = useState("");
  const [age, setAge] = useState("");
  const [ageVerified, setAgeVerified] = useState(false);
  const [personality, setPersonality] = useState("");
  const [fear, setFear] = useState("");
  const [secret, setSecret] = useState("");
  const [faction, setFaction] = useState("");
  const [values, setValues] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [limitations, setLimitations] = useState("");
  const [voiceStyle, setVoiceStyle] = useState<"short" | "mixed" | "long">("mixed");
  const [portrait, setPortrait] = useState<CharacterPortrait | null>(null);
  const [portraitDescription, setPortraitDescription] = useState("");
  const [portraitTraits, setPortraitTraits] = useState("");
  const [portraitQuery, setPortraitQuery] = useState("");
  const [portraitTheme, setPortraitTheme] = useState("all");
  const [portraitPage, setPortraitPage] = useState(0);
  const [portraitBusy, setPortraitBusy] = useState(false);
  const [rpgArchetype, setRpgArchetype] = useState<CharacterRpgArchetype>("balanced");
  const [rpgStats, setRpgStats] = useState(() => characterRpgStatsForArchetype("balanced"));
  const [isProtagonist, setIsProtagonist] = useState(false);
  const [message, setMessage] = useState("");
  const [characterAIBusy, setCharacterAIBusy] = useState(false);
  const [characterAIProgress, setCharacterAIProgress] = useState<ClosedAIProgressEvent | null>(null);
  const [characterAICandidate, setCharacterAICandidate] = useState<CharacterAICandidate | null>(null);
  const characterAIControllerRef = useRef<AbortController | null>(null);
  const characterAIFormBeforeRef = useRef<CharacterAIFormSnapshot | null>(null);
  const characterAIRuleVariantRef = useRef(0);
  const characterFormRef = useRef<HTMLFormElement | null>(null);
  const portraitPageSize = 12;
  const filteredPortraits = useMemo(
    () => filterCharacterPortraitCatalog({ query: portraitQuery, themeId: portraitTheme }),
    [portraitQuery, portraitTheme],
  );
  const portraitPageCount = Math.max(1, Math.ceil(filteredPortraits.length / portraitPageSize));
  const safePortraitPage = Math.min(portraitPage, portraitPageCount - 1);
  const visiblePortraits = filteredPortraits.slice(
    safePortraitPage * portraitPageSize,
    safePortraitPage * portraitPageSize + portraitPageSize,
  );
  const rpgPointTotal = characterRpgPointTotal(rpgStats);

  useEffect(() => () => characterAIControllerRef.current?.abort("CHARACTER_EDITOR_UNMOUNTED"), []);

  function currentCharacterAIForm(): CharacterAIFormSnapshot {
    return {
      name,
      aliases,
      identity,
      goal,
      lifeStatus,
      location,
      age,
      ageVerified,
      personality,
      fear,
      secret,
      faction,
      values,
      capabilities,
      limitations,
      voiceStyle,
      isProtagonist,
      rpgArchetype,
      rpgStats: { ...rpgStats },
    };
  }

  function applyCharacterAIForm(values: CharacterAIFormSnapshot) {
    setName(values.name);
    setAliases(values.aliases);
    setIdentity(values.identity);
    setGoal(values.goal);
    setLifeStatus(values.lifeStatus);
    setLocation(values.location);
    setAge(values.age);
    setAgeVerified(values.ageVerified);
    setPersonality(values.personality);
    setFear(values.fear);
    setSecret(values.secret);
    setFaction(values.faction);
    setValues(values.values);
    setCapabilities(values.capabilities);
    setLimitations(values.limitations);
    setVoiceStyle(values.voiceStyle);
    setIsProtagonist(values.isProtagonist);
    setRpgArchetype(values.rpgArchetype);
    setRpgStats({ ...values.rpgStats });
  }

  function characterAIDraftAsForm(draft: CharacterAIDraft): CharacterAIFormSnapshot {
    return {
      name: draft.name,
      aliases: draft.aliases.join("、"),
      identity: draft.identity,
      goal: draft.goal,
      lifeStatus: draft.lifeStatus,
      location: draft.location,
      age: draft.age == null ? "" : String(draft.age),
      ageVerified: false,
      personality: draft.personality,
      fear: draft.fears.join("、"),
      secret: draft.privateSecrets.join("、"),
      faction: draft.factions.join("、"),
      values: draft.values.join("、"),
      capabilities: draft.capabilities.join("、"),
      limitations: draft.limitations.join("、"),
      voiceStyle: draft.voiceStyle,
      isProtagonist: draft.isProtagonist,
      rpgArchetype: draft.rpgArchetype,
      rpgStats: { ...draft.rpgStats },
    };
  }

  async function discardCharacterAICandidate(announce = true) {
    const candidate = characterAICandidate;
    if (!candidate || characterAIBusy) return;
    setCharacterAIBusy(true);
    try {
      if (candidate.candidateId) {
        await closedAgentOS.rejectCandidate(candidate.candidateId);
      }
      if (characterAIFormBeforeRef.current) {
        applyCharacterAIForm(characterAIFormBeforeRef.current);
      }
      characterAIFormBeforeRef.current = null;
      setCharacterAICandidate(null);
      setCharacterAIProgress(null);
      if (announce) setMessage("AI 角色候選已放棄；角色表單與正式資料沒有變更。");
    } catch (cause) {
      setMessage(`放棄 AI 候選失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setCharacterAIBusy(false);
    }
  }

  async function generateCharacterAICandidate() {
    if (characterAIBusy) return;
    setCharacterAIBusy(true);
    setCharacterAIProgress(null);
    setMessage("閉端 AI 正在讀取作品、人物與世界設定，建立角色與 RPG 能力候選…");
    const controller = new AbortController();
    characterAIControllerRef.current = controller;
    let generatedCandidateId: string | null = null;
    const originalForm = characterAIFormBeforeRef.current ?? currentCharacterAIForm();
    try {
      if (!characterAIFormBeforeRef.current) {
        characterAIFormBeforeRef.current = originalForm;
      }
      if (characterAICandidate) {
        if (characterAICandidate.candidateId) {
          await closedAgentOS.rejectCandidate(characterAICandidate.candidateId);
        }
        if (characterAICandidate.applied) {
          applyCharacterAIForm(originalForm);
        }
        setCharacterAICandidate(null);
      }
      const currentFields = {
        name: originalForm.name.trim(),
        aliases: characterAIList(originalForm.aliases),
        identity: originalForm.identity.trim(),
        goal: originalForm.goal.trim(),
        location: originalForm.location.trim(),
        age: originalForm.age.trim() || null,
        personality: originalForm.personality.trim(),
        fears: characterAIList(originalForm.fear),
        privateSecrets: characterAIList(originalForm.secret),
        factions: characterAIList(originalForm.faction),
        values: characterAIList(originalForm.values),
        capabilities: characterAIList(originalForm.capabilities),
        limitations: characterAIList(originalForm.limitations),
        isProtagonist: originalForm.isProtagonist,
      };
      const result = await executeStudioClosedAgent({
        taskId: `character-form:${crypto.randomUUID()}`,
        projectId,
        taskType: "character.create",
        characterId: editingId ?? undefined,
        objective: [
          "依目前作品已核准的章節、Story Bible、世界與角色關係，建立一份可直接填入角色表單的角色候選。",
          `目前表單（已填內容優先保留並深化）：${JSON.stringify(currentFields)}`,
          "只輸出一個 JSON 物件，不要 Markdown、說明或前後綴。",
          "必要欄位：name、aliases、identity、goal、lifeStatus、location、age、personality、fears、privateSecrets、factions、values、capabilities、limitations、voiceStyle、isProtagonist、rpgArchetype、rpgStats。",
          "陣列欄位請輸出 JSON 字串陣列；lifeStatus 只能是 alive/dead/unknown；voiceStyle 只能是 short/mixed/long；rpgArchetype 只能是 balanced/vanguard/strategist/diplomat/mystic/creator/custom。",
          "rpgStats 必須含 physique、technique、intellect、charisma、will、creativity 六個整數，每項 20–80、總和 300；能力與弱點必須符合角色背景，不能只填平均值充數。",
          "不要引用其他角色的 AUTHOR_ONLY 秘密，也不要把候選直接寫入正式資料。",
        ].join("\n"),
        storyBibleRevision: "current",
        knowledgeScopeRevision: "current",
        contextTokenBudget: 3_584,
        qualityMode: "balanced",
        browserComputePolicy: "browser-first",
        allowPreAuthorizedClosedEscalation: false,
        generationOptions: {
          maxTokens: 900,
          temperature: 0.72,
          topP: 0.9,
          repetitionPenalty: 1.12,
        },
        signal: controller.signal,
        onProgress: (event) => {
          setCharacterAIProgress(event);
          setMessage(event.label);
        },
      });
      generatedCandidateId = result.candidate.id;
      const draft = parseCharacterAIDraft(result.candidate.content, originalForm.name);
      setCharacterAICandidate({
        candidateId: result.candidate.id,
        modelId: result.candidate.modelId,
        actualExecutor: result.candidate.actualExecutor,
        contextSourceSummary: result.candidate.contextSourceSummary ?? null,
        source: "closed-ai",
        fallbackReason: null,
        applied: false,
        draft,
      });
      setCharacterAIProgress({
        taskId: result.task.id,
        phase: "awaiting-approval",
        label: "角色候選已完成，請核准建立、套用修改或拒絕",
        percent: 100,
        occurredAt: new Date().toISOString(),
        backendId: result.candidate.backendId,
        generatedCharacters: result.candidate.content.length,
      });
      setMessage("候選已完成且尚未改動表單。可直接核准建立角色，或先套用到表單自行修改。");
    } catch (cause) {
      if (generatedCandidateId) {
        await closedAgentOS.rejectCandidate(generatedCandidateId).catch(() => undefined);
      }
      applyCharacterAIForm(originalForm);
      if (controller.signal.aborted) {
        characterAIFormBeforeRef.current = null;
        setCharacterAICandidate(null);
        setCharacterAIProgress({
          taskId: `character-form-cancelled:${crypto.randomUUID()}`,
          phase: "cancelled",
          label: "角色 AI 已停止；表單與正式資料未變更",
          percent: 100,
          occurredAt: new Date().toISOString(),
        });
        setMessage("已停止角色 AI；你可以保留目前表單，或重新開始。");
      } else {
        const failureCode = characterAIFailureCode(cause);
        characterAIRuleVariantRef.current += 1;
        const draft = characterAIRuleFallback(
          originalForm,
          projectId,
          characterAIRuleVariantRef.current,
        );
        setCharacterAICandidate({
          candidateId: null,
          modelId: "本機規則故事後備（非模型輸出）",
          actualExecutor: "local-rules-fallback",
          contextSourceSummary: "只使用目前表單與作品識別建立可修改候選",
          source: "local-rules-fallback",
          fallbackReason: failureCode,
          applied: false,
          draft,
        });
        setCharacterAIProgress({
          taskId: `character-form-fallback:${crypto.randomUUID()}`,
          phase: "awaiting-approval",
          label: `閉端 AI 未完成（${failureCode}）；已立即建立可用的本機規則候選`,
          percent: 100,
          occurredAt: new Date().toISOString(),
          generatedCharacters: JSON.stringify(draft).length,
        });
        setMessage("模型沒有完成，但流程沒有卡住：可直接核准本機規則候選、套用後修改，或重試閉端 AI。");
      }
    } finally {
      if (characterAIControllerRef.current === controller) characterAIControllerRef.current = null;
      setCharacterAIBusy(false);
    }
  }

  function applyCharacterAICandidate() {
    const candidate = characterAICandidate;
    if (!candidate || characterAIBusy) return;
    applyCharacterAIForm(characterAIDraftAsForm(candidate.draft));
    setCharacterAICandidate({ ...candidate, applied: true });
    setCharacterAIProgress({
      taskId: `character-form-applied:${candidate.candidateId ?? crypto.randomUUID()}`,
      phase: "awaiting-approval",
      label: "候選已套用到表單；修改後按建立角色完成正式核准",
      percent: 100,
      occurredAt: new Date().toISOString(),
    });
    setMessage("候選已套用到表單；你仍可修改，按建立角色／儲存修改後才會寫入正式資料。");
  }

  function approveAndSaveCharacterAICandidate() {
    const candidate = characterAICandidate;
    if (!candidate || characterAIBusy) return;
    applyCharacterAIForm(characterAIDraftAsForm(candidate.draft));
    setCharacterAICandidate({ ...candidate, applied: true });
    setCharacterAIProgress({
      taskId: `character-form-approval:${candidate.candidateId ?? crypto.randomUUID()}`,
      phase: "awaiting-approval",
      label: editingId ? "正在核准候選並儲存角色修改" : "正在核准候選並建立角色",
      percent: 100,
      occurredAt: new Date().toISOString(),
    });
    setMessage("正在完成核准與正式角色寫入…");
    window.setTimeout(() => characterFormRef.current?.requestSubmit(), 0);
  }

  function reset() {
    setEditingId(null);
    setName("");
    setAliases("");
    setIdentity("");
    setGoal("");
    setLifeStatus("alive");
    setLocation("");
    setAge("");
    setAgeVerified(false);
    setPersonality("");
    setFear("");
    setSecret("");
    setFaction("");
    setValues("");
    setCapabilities("");
    setLimitations("");
    setVoiceStyle("mixed");
    setPortrait(null);
    setPortraitDescription("");
    setPortraitTraits("");
    setPortraitQuery("");
    setPortraitTheme("all");
    setPortraitPage(0);
    setRpgArchetype("balanced");
    setRpgStats(characterRpgStatsForArchetype("balanced"));
    setIsProtagonist(false);
    characterAIFormBeforeRef.current = null;
    setCharacterAICandidate(null);
    setCharacterAIProgress(null);
  }

  function edit(item: Character) {
    setEditingId(item.id);
    setName(item.name);
    setAliases(item.aliases.join("、"));
    setIdentity(item.identity.value ?? "");
    setGoal(item.goal.value ?? "");
    setLifeStatus(item.lifeStatus);
    setLocation(item.locationId ?? "");
    setAge(item.age === null || item.age === undefined ? "" : String(item.age));
    setAgeVerified(Boolean(item.ageVerified));
    setPersonality(item.personality.value ?? "");
    setFear((item.fears ?? []).join("、"));
    setSecret((item.privateSecrets ?? []).join("、"));
    setFaction((item.factionIds ?? []).join("、"));
    setValues((item.values ?? []).join("、"));
    setCapabilities((item.capabilities ?? []).join("、"));
    setLimitations((item.limitations ?? []).join("、"));
    setVoiceStyle(item.voiceStyle?.sentenceLength ?? "mixed");
    setPortrait(item.portrait ?? null);
    setPortraitDescription(item.portrait?.visualDescription ?? "");
    setPortraitTraits((item.portrait?.traits ?? []).join("、"));
    setRpgArchetype(item.rpgProfile?.archetype ?? "balanced");
    setRpgStats(item.rpgProfile?.stats ?? characterRpgStatsForArchetype("balanced"));
    setIsProtagonist(storyBibles.some((storyBible) => storyBible.protagonistIds.includes(item.id)));
    setMessage(`正在編輯「${item.name}」。`);
  }

  function selectCatalogPortrait(asset: (typeof CHARACTER_PORTRAIT_CATALOG)[number]) {
    setPortrait({
      ...asset,
      approvedAt: new Date().toISOString(),
      approvedBy: "user",
      dataLeftDevice: false,
    });
    setPortraitDescription(asset.visualDescription);
    setPortraitTraits(asset.traits.join("、"));
    setMessage(`已選擇「${asset.role}」；儲存角色後才會正式綁定。`);
  }

  function createCharacterDraftFromPortrait() {
    if (!portrait) {
      setMessage("請先選擇一位 AI 人像或上傳人物照片。" );
      return;
    }
    setName((current) => current.trim() || `未命名${portrait.role}`);
    setIdentity((current) => current.trim() || portrait.role);
    setPersonality((current) => current.trim() || portrait.traits.find((item) => ![portrait.themeLabel, portrait.role, "成人角色", "半身肖像"].includes(item)) || "性格待補");
    setGoal((current) => current.trim() || `在${portrait.themeLabel}故事中完成自己的核心使命。`);
    const suggestedArchetype = suggestCharacterRpgArchetype([
      portrait.themeLabel,
      portrait.role,
      ...portrait.traits,
    ]);
    setRpgArchetype(suggestedArchetype);
    setRpgStats(characterRpgStatsForArchetype(suggestedArchetype));
    setMessage("角色草稿已帶入；請自由修改姓名、背景、能力與目標，再按儲存。" );
  }

  async function uploadPortrait(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setPortraitBusy(true);
    try {
      const asset = await prepareCharacterPortraitUpload({
        file,
        visualDescription: portraitDescription,
        traits: portraitTraits.split(/[、,\n]/u),
      });
      setPortrait({
        ...asset,
        approvedAt: new Date().toISOString(),
        approvedBy: "user",
        dataLeftDevice: false,
      });
      setPortraitDescription(asset.visualDescription);
      setPortraitTraits(asset.traits.join("、"));
      setMessage("人物照片已在瀏覽器內裁切與壓縮；儲存角色後才會正式綁定。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "人物照片處理失敗。" );
    } finally {
      setPortraitBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setMessage("角色姓名不能留白。");
      return;
    }
    try {
      if (characterAICandidate) {
        if (!characterAICandidate.applied) {
          setMessage("請先按「核准並建立角色／儲存修改」或「套用後自行修改」；也可以拒絕這份候選。");
          return;
        }
        if (characterAICandidate.candidateId) {
          await closedAgentOS.approveCandidate({
            candidateId: characterAICandidate.candidateId,
            approvedBy: "local-author",
            humanApproved: true,
          });
        }
        setCharacterAICandidate(null);
        characterAIFormBeforeRef.current = null;
      }
      const repo = createNovelRepository();
      const existing = characters.find((item) => item.id === editingId);
      const base = existing ?? makeRecord(projectId);
      const rpgProfile = createCharacterRpgProfile({
        archetype: rpgArchetype,
        stats: rpgStats,
      });
      const savedCharacter = await repo.put<Character>("characters", {
        ...base,
        name: name.trim(),
        aliases: aliases.split(/[、,\n]/).map((item) => item.trim()).filter(Boolean),
        identity: optionalValue(identity.trim() || null, identity.trim() ? "user_defined" : "unset"),
        personality: optionalValue(personality.trim() || null, personality.trim() ? "user_defined" : "unset"),
        goal: optionalValue(goal.trim() || null, goal.trim() ? "user_defined" : "unset"),
        lifeStatus,
        locationId: location.trim() || null,
        age: age.trim() ? Number(age) : null,
        ageVerified: Boolean(age.trim() && ageVerified),
        fears: fear.split(/[、,\n]/).map((item) => item.trim()).filter(Boolean),
        privateSecrets: secret.split(/[、,\n]/).map((item) => item.trim()).filter(Boolean),
        factionIds: faction.split(/[、,\n]/).map((item) => item.trim()).filter(Boolean),
        values: values.split(/[、,\n]/u).map((item) => item.trim()).filter(Boolean),
        capabilities: capabilities.split(/[、,\n]/u).map((item) => item.trim()).filter(Boolean),
        limitations: limitations.split(/[、,\n]/u).map((item) => item.trim()).filter(Boolean),
        portrait: portrait ? {
          ...portrait,
          visualDescription: portraitDescription.trim() || portrait.visualDescription,
          traits: portraitTraits.split(/[、,\n]/u).map((item) => item.trim()).filter(Boolean),
          approvedAt: portrait.approvedAt || new Date().toISOString(),
          approvedBy: "user",
          dataLeftDevice: false,
        } : null,
        rpgProfile,
        voiceStyle: {
          formality: voiceStyle === "long" ? 75 : voiceStyle === "short" ? 35 : 55,
          directness: voiceStyle === "short" ? 75 : 55,
          emotionalExpressiveness: existing?.voiceStyle?.emotionalExpressiveness ?? 50,
          sentenceLength: voiceStyle,
          preferredAddressTerms: existing?.voiceStyle?.preferredAddressTerms ?? [],
        },
      }, existing?.revision);
      await updateStoryBibleReferences(repo, projectId, (storyBible) => ({
        ...storyBible,
        characterIds: storyBible.characterIds.includes(savedCharacter.id)
          ? storyBible.characterIds
          : [...storyBible.characterIds, savedCharacter.id],
        protagonistIds: isProtagonist
          ? [savedCharacter.id, ...storyBible.protagonistIds.filter((id) => id !== savedCharacter.id)]
          : storyBible.protagonistIds.filter((id) => id !== savedCharacter.id),
      }));
      reset();
      setCharacterAIProgress(null);
      setMessage(existing ? "角色修改已核准並保存。" : "角色已核准並建立。");
      await onChanged();
    } catch (cause) {
      setMessage(`儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  async function remove(item: Character) {
    if (!confirm(`確定刪除角色「${item.name}」嗎？這不會刪除已寫入的正文。`)) return;
    try {
      const repository = createNovelRepository();
      const legacyRelationships = await repository.list<DomainRecord & {
        fromCharacterId?: string;
        toCharacterId?: string;
      }>("relationships", projectId);
      const agentRelationships = await repository.list<DomainRecord & {
        relationshipId?: string;
        fromCharacterId?: string;
        toCharacterId?: string;
      }>("characterRelationships", projectId);
      const relatedRelationships = [...legacyRelationships, ...agentRelationships].filter(
        (relationship) =>
          relationship.fromCharacterId === item.id
          || relationship.toCharacterId === item.id,
      );
      const removedRelationshipIds = new Set(
        relatedRelationships.flatMap((relationship) => [
          relationship.id,
          "relationshipId" in relationship
            && typeof relationship.relationshipId === "string"
            ? relationship.relationshipId
            : relationship.id,
        ]),
      );
      const relationshipEvents = await repository.list<DomainRecord & {
        relationshipId?: string;
      }>("characterRelationshipEvents", projectId);

      for (const event of relationshipEvents) {
        if (event.relationshipId && removedRelationshipIds.has(event.relationshipId)) {
          await repository.remove("characterRelationshipEvents", event.id);
        }
      }
      for (const relationship of legacyRelationships) {
        if (removedRelationshipIds.has(relationship.id)) {
          await repository.remove("relationships", relationship.id);
        }
      }
      for (const relationship of agentRelationships) {
        if (
          removedRelationshipIds.has(relationship.id)
          || (relationship.relationshipId
            && removedRelationshipIds.has(relationship.relationshipId))
        ) {
          await repository.remove("characterRelationships", relationship.id);
        }
      }

      const characterAgentStores = [
        "characterAgentProfiles",
        "characterAgentStates",
        "characterKnowledge",
        "characterBeliefs",
        "characterMemories",
        "characterPrivateArcs",
        "characterSimulations",
        "characterSimulationTurns",
        "characterAgentEvaluations",
        "characterProposals",
      ] satisfies NovelStoreName[];
      for (const store of characterAgentStores) {
        const records = await repository.list<DomainRecord & {
          characterId?: string;
          participantCharacterIds?: string[];
        }>(store, projectId);
        for (const record of records) {
          if (
            record.characterId === item.id
            || record.participantCharacterIds?.includes(item.id)
          ) {
            await repository.remove(store, record.id);
          }
        }
      }

      await updateStoryBibleReferences(repository, projectId, (storyBible) => ({
        ...storyBible,
        protagonistIds: withoutId(storyBible.protagonistIds, item.id),
        characterIds: withoutId(storyBible.characterIds, item.id),
        relationshipIds: storyBible.relationshipIds.filter(
          (relationshipId) => !removedRelationshipIds.has(relationshipId),
        ),
      }));
      await repository.remove("characters", item.id);
      if (editingId === item.id) reset();
      setMessage("角色與其可變代理資料已刪除；正式證據鏈仍保留。");
      await onChanged();
    } catch (cause) {
      setMessage(`刪除失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  return (
    <>
      <div className="p2SectionToolbar">
        <button type="button" disabled={characterAIBusy} onClick={() => void generateCharacterAICandidate()}>
          {characterAIBusy ? "閉端 AI 正在設定角色…" : "用閉端 AI 協助角色與能力值"}
        </button>
        {characterAIBusy ? <button type="button" onClick={() => characterAIControllerRef.current?.abort("USER_CANCELLED")}>停止</button> : null}
      </div>
      {characterAIProgress ? <div className="characterAIAssistProgress" role="status" aria-live="polite">
        <span>{characterAIProgress.label}</span>
        <strong>{characterAIProgress.percent}%{characterAIProgress.generatedCharacters != null ? ` · ${characterAIProgress.generatedCharacters} 字` : ""}</strong>
        <progress max={100} value={characterAIProgress.percent} />
      </div> : null}
      {(characterAIProgress || characterAICandidate) && message ? <p className="characterAIAssistNotice" role="status">{message}</p> : null}
      {characterAICandidate ? <section
        className="characterAIAssistCandidate"
        data-testid="character-ai-form-candidate"
        data-source={characterAICandidate.source}
        data-applied={characterAICandidate.applied}
      >
        <header>
          <div>
            <small>{characterAICandidate.source === "closed-ai"
              ? "真實閉端 AI 候選 · 尚未改動表單"
              : "本機規則後備候選 · 非模型輸出 · 流程可繼續"}</small>
            <h3>{characterAICandidate.draft.name}</h3>
          </div>
          <span>{characterAICandidate.modelId}</span>
        </header>
        <div className="characterAIAssistSummary">
          <p><b>身分</b>{characterAICandidate.draft.identity || "待補"}</p>
          <p><b>目標</b>{characterAICandidate.draft.goal || "待補"}</p>
          <p><b>性格</b>{characterAICandidate.draft.personality || "待補"}</p>
          <p><b>能力</b>{characterAICandidate.draft.capabilities.join("、") || "待補"}</p>
          <p><b>限制</b>{characterAICandidate.draft.limitations.join("、") || "待補"}</p>
          <p><b>RPG</b>{CHARACTER_RPG_ARCHETYPES.find((item) => item.id === characterAICandidate.draft.rpgArchetype)?.label ?? "自訂"} · {characterRpgPointTotal(characterAICandidate.draft.rpgStats)} / {CHARACTER_RPG_POINT_BUDGET} 點</p>
        </div>
        <div className="characterAIAssistStats">
          {CHARACTER_AI_STAT_KEYS.map((key) => <span key={key}><small>{CHARACTER_RPG_STAT_LABELS[key]}</small><b>{characterAICandidate.draft.rpgStats[key]}</b></span>)}
        </div>
        <footer>
          <button type="button" disabled={characterAIBusy} onClick={approveAndSaveCharacterAICandidate}>
            {editingId ? "核准並儲存角色修改" : "核准並建立角色"}
          </button>
          <button type="button" disabled={characterAIBusy} onClick={applyCharacterAICandidate}>
            {characterAICandidate.applied ? "重新套用候選到表單" : "套用後自行修改"}
          </button>
          <button type="button" disabled={characterAIBusy} onClick={() => void generateCharacterAICandidate()}>
            {characterAICandidate.source === "closed-ai" ? "換一個角色版本" : "重試閉端 AI"}
          </button>
          <button type="button" className="danger" disabled={characterAIBusy} onClick={() => void discardCharacterAICandidate()}>拒絕候選</button>
        </footer>
        <details>
          <summary>執行證明</summary>
          <p>實際執行器：{characterAICandidate.actualExecutor}</p>
          <p>作品脈絡：{characterAICandidate.contextSourceSummary ?? "已讀取正式作品資料"}</p>
          {characterAICandidate.fallbackReason ? <p>回退原因：{characterAICandidate.fallbackReason}。沒有冒充模型已完成，也沒有外送資料。</p> : null}
          <p>「核准並建立角色」會立即寫入正式角色；「套用後自行修改」只填入表單，仍需再按儲存。</p>
        </details>
      </section> : null}
      <form ref={characterFormRef} className="p2InlineEditor" aria-labelledby="character-editor-heading" onSubmit={(event) => void save(event)}>
        <h3 id="character-editor-heading">{editingId ? "編輯角色" : "建立角色"}</h3>
        <label>角色姓名<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>別名（以頓號分隔）<input value={aliases} onChange={(event) => setAliases(event.target.value)} /></label>
        <label className="p2Checkbox"><input type="checkbox" checked={isProtagonist} onChange={(event) => setIsProtagonist(event.target.checked)} />設為作品主角與 RPG 玩家角色</label>
        <label>身分<input value={identity} onChange={(event) => setIdentity(event.target.value)} /></label>
        <label>角色目標<input value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
        <label>生存狀態<select value={lifeStatus} onChange={(event) => setLifeStatus(event.target.value as Character["lifeStatus"])}><option value="alive">存活</option><option value="dead">死亡</option><option value="unknown">未知</option></select></label>
        <label>所在位置或現況<input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
        <label>年齡（可留白）<input type="number" min="0" max="300" value={age} onChange={(event) => setAge(event.target.value)} /></label>
        <label className="p2Checkbox"><input type="checkbox" checked={ageVerified} onChange={(event) => setAgeVerified(event.target.checked)} />作者已確認角色年齡</label>
        <label>角色性格<input value={personality} onChange={(event) => setPersonality(event.target.value)} /></label>
        <label>恐懼（以頓號分隔）<input value={fear} onChange={(event) => setFear(event.target.value)} /></label>
        <label>私人秘密（以頓號分隔）<input value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
        <label>所屬勢力（以頓號分隔）<input value={faction} onChange={(event) => setFaction(event.target.value)} /></label>
        <label>核心價值（以頓號分隔）<input value={values} onChange={(event) => setValues(event.target.value)} placeholder="例：守信、自由、家族" /></label>
        <label>能力（以頓號分隔）<input value={capabilities} onChange={(event) => setCapabilities(event.target.value)} placeholder="例：劍術、談判、醫術" /></label>
        <label>限制與弱點（以頓號分隔）<input value={limitations} onChange={(event) => setLimitations(event.target.value)} placeholder="例：怕水、不能說謊、舊傷" /></label>
        <label>說話節奏<select value={voiceStyle} onChange={(event) => setVoiceStyle(event.target.value as "short" | "mixed" | "long")}><option value="short">簡短直接</option><option value="mixed">自然混合</option><option value="long">完整慎重</option></select></label>
        <fieldset className="characterRpgSetup p2WideField">
          <legend>RPG 初始能力</legend>
          <label>能力原型<select value={rpgArchetype} onChange={(event) => {
            const next = event.target.value as CharacterRpgArchetype;
            setRpgArchetype(next);
            setRpgStats((current) => characterRpgStatsForArchetype(next, current));
          }}>{CHARACTER_RPG_ARCHETYPES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <p>{CHARACTER_RPG_ARCHETYPES.find((option) => option.id === rpgArchetype)?.description}</p>
          <div className="characterRpgStatGrid">
            {(Object.entries(CHARACTER_RPG_STAT_LABELS) as Array<[CharacterRpgStatKey, string]>).map(([key, label]) => <label key={key}>{label}<input type="number" min="20" max="80" step="1" value={rpgStats[key]} onChange={(event) => {
              setRpgArchetype("custom");
              setRpgStats((current) => ({ ...current, [key]: Number(event.target.value) }));
            }} /></label>)}
          </div>
          <strong className="characterRpgBudget" data-valid={rpgPointTotal === CHARACTER_RPG_POINT_BUDGET}>已分配 {rpgPointTotal} / {CHARACTER_RPG_POINT_BUDGET} 點</strong>
          <small>每項 20–80，總和必須正好 300。RPG 啟用時會以這組核准數值建立主角能力，之後的升級仍走正式公式。</small>
        </fieldset>
        <fieldset className="characterPortraitStudio p2WideField">
          <legend>角色相片與 AI 人像</legend>
          <div className="characterPortraitSelection">
            <div className="characterPortraitPreview" data-empty={!portrait}>
              {portrait
                ? <CharacterPortraitImage portrait={portrait} />
                : <span aria-hidden="true">{name.trim().slice(0, 1) || "角"}</span>}
            </div>
            <div>
              <b>{portrait ? portrait.role : "尚未選擇人物相片"}</b>
              <p>{portrait ? portrait.visualDescription : "可從 100 位 ChatGPT 生成人像中選擇，或上傳自己的參考照片。"}</p>
              <small>只有核准的外觀描述與特徵標籤會提供給角色 AI；圖片位元不會寫入 AI 提示。</small>
            </div>
          </div>
          <div className="characterPortraitFields">
            <label>外觀特徵描述<textarea value={portraitDescription} onChange={(event) => setPortraitDescription(event.target.value)} placeholder="例：神情冷靜、黑色長髮、深色戰袍、左眉有淡疤" /></label>
            <label>特徵標籤（以頓號分隔）<input value={portraitTraits} onChange={(event) => setPortraitTraits(event.target.value)} placeholder="例：冷峻、劍修、黑衣、成年角色" /></label>
          </div>
          <div className="characterPortraitActions">
            <label className="characterPortraitUpload">
              {portraitBusy ? "正在處理照片…" : "上傳人物照片"}
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={portraitBusy} onChange={(event) => void uploadPortrait(event)} />
            </label>
            <button type="button" className="secondary" onClick={() => {
              setPortraitQuery(portraitTraits.trim() || portraitDescription.trim());
              setPortraitTheme("all");
              setPortraitPage(0);
            }}>依特徵尋找候選</button>
            <button type="button" className="secondary" disabled={!portrait} onClick={createCharacterDraftFromPortrait}>用此人像自創角色草稿</button>
            {portrait ? <button type="button" className="danger" onClick={() => {
              setPortrait(null);
              setMessage("人物相片已從待儲存角色設定中移除。");
            }}>移除人物相片</button> : null}
          </div>
          <details className="characterPortraitCatalog">
            <summary>開啟 100 位 ChatGPT 人像庫</summary>
            <div className="characterPortraitFilters">
              <label>搜尋特徵<input type="search" value={portraitQuery} onChange={(event) => { setPortraitQuery(event.target.value); setPortraitPage(0); }} placeholder="題材、身分或氣質" /></label>
              <label>題材<select value={portraitTheme} onChange={(event) => { setPortraitTheme(event.target.value); setPortraitPage(0); }}><option value="all">全部題材（100）</option>{CHARACTER_PORTRAIT_THEME_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            </div>
            <p className="characterPortraitCount">找到 {filteredPortraits.length} 位；第 {safePortraitPage + 1} / {portraitPageCount} 頁</p>
            {visiblePortraits.length ? (
              <div className="characterPortraitGrid" data-testid="character-portrait-catalog">
                {visiblePortraits.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className={portrait?.id === candidate.id ? "selected" : ""}
                    aria-pressed={portrait?.id === candidate.id}
                    onClick={() => selectCatalogPortrait(candidate)}
                  >
                    <CharacterPortraitImage portrait={candidate} />
                    <b>{candidate.role}</b>
                    <small>{candidate.themeLabel} · {candidate.traits[2]}</small>
                  </button>
                ))}
              </div>
            ) : <p>沒有符合全部特徵的候選，請減少搜尋條件。</p>}
            <div className="characterPortraitPagination">
              <button type="button" disabled={safePortraitPage <= 0} onClick={() => setPortraitPage((current) => Math.max(0, current - 1))}>上一頁</button>
              <button type="button" disabled={safePortraitPage >= portraitPageCount - 1} onClick={() => setPortraitPage((current) => Math.min(portraitPageCount - 1, current + 1))}>下一頁</button>
            </div>
          </details>
        </fieldset>
        <div className="p2EditorActions">
          <button type="submit">{editingId ? "儲存修改" : "建立角色"}</button>
          {editingId ? <button type="button" className="secondary" onClick={reset}>取消編輯</button> : null}
        </div>
        {message && <p role="status">{message}</p>}
      </form>
      {characters.length ? (
        <div className="p2DataGrid" data-testid="character-records">
          {characters.map((item) => (
            <article key={item.id} data-record-id={item.id} data-revision={item.revision}>
              {item.portrait ? <CharacterPortraitImage portrait={item.portrait} className="characterRecordPortrait" /> : null}
              <b>{item.name}</b>
              <span>{item.lifeStatus === "alive" ? "存活" : item.lifeStatus === "dead" ? "死亡" : "未知"}</span>
              <p>{item.goal.value || "尚未設定目標"}</p>
              <small>{item.locationId || "尚未設定位置"}</small>
              {item.personality.value ? <small>{item.personality.value}</small> : null}
              {item.privateSecrets?.length ? <small>含作者私人設定</small> : null}
              {item.rpgProfile ? <small>RPG：{CHARACTER_RPG_ARCHETYPES.find((option) => option.id === item.rpgProfile?.archetype)?.label ?? "自訂配點"} · {characterRpgPointTotal(item.rpgProfile.stats)} 點</small> : null}
              <div className="p2RecordActions">
                <button type="button" onClick={() => edit(item)}>編輯</button>
                <button type="button" className="danger" onClick={() => void remove(item)}>刪除</button>
              </div>
            </article>
          ))}
        </div>
      ) : <Empty>目前還沒有角色資料。</Empty>}
    </>
  );
}

function WorldEditor({
  projectId,
  worlds,
  rules,
  onChanged,
}: {
  projectId: string;
  worlds: World[];
  rules: WorldRule[];
  onChanged: () => Promise<void>;
}) {
  const [worldEditingId, setWorldEditingId] = useState<string | null>(null);
  const [worldName, setWorldName] = useState("");
  const [worldEra, setWorldEra] = useState("");
  const [worldSummary, setWorldSummary] = useState("");
  const [ruleEditingId, setRuleEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [immutable, setImmutable] = useState(true);
  const [message, setMessage] = useState("");

  function editWorld(item: World) {
    setWorldEditingId(item.id);
    setWorldName(item.name.value ?? "");
    setWorldEra(item.era.value ?? "");
    setWorldSummary(item.summary.value ?? "");
  }

  function resetWorld() {
    setWorldEditingId(null);
    setWorldName("");
    setWorldEra("");
    setWorldSummary("");
  }

  async function saveWorld(event: React.FormEvent) {
    event.preventDefault();
    if (!worldName.trim()) {
      setMessage("世界名稱不能留白。");
      return;
    }
    try {
      const repo = createNovelRepository();
      const existing = worlds.find((item) => item.id === worldEditingId);
      await repo.put<World>("worlds", {
        ...(existing ?? makeRecord(projectId)),
        name: optionalValue(worldName.trim(), "user_defined"),
        era: optionalValue(worldEra.trim() || null, worldEra.trim() ? "user_defined" : "unset"),
        summary: optionalValue(worldSummary.trim() || null, worldSummary.trim() ? "user_defined" : "unset"),
      }, existing?.revision);
      resetWorld();
      setMessage(existing ? "世界設定已更新。" : "世界已建立。");
      await onChanged();
    } catch (cause) {
      setMessage(`世界設定儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  async function removeWorld(item: World) {
    if (!confirm(`確定刪除世界「${item.name.value || "未命名世界"}」嗎？世界規則不會一併刪除。`)) return;
    try {
      const repository = createNovelRepository();
      await updateStoryBibleReferences(repository, projectId, (storyBible) => ({
        ...storyBible,
        worldId: storyBible.worldId === item.id ? null : storyBible.worldId,
      }));
      await repository.remove("worlds", item.id);
      if (worldEditingId === item.id) resetWorld();
      setMessage("世界已刪除，Story Bible 的世界引用已同步清除。");
      await onChanged();
    } catch (cause) {
      setMessage(`刪除世界失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  function editRule(item: WorldRule) {
    setRuleEditingId(item.id);
    setTitle(item.title);
    setDescription(item.description);
    setImmutable(item.immutable);
  }

  function resetRule() {
    setRuleEditingId(null);
    setTitle("");
    setDescription("");
    setImmutable(true);
  }

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) {
      setMessage("請填寫規則名稱與內容。");
      return;
    }
    try {
      const repo = createNovelRepository();
      const existing = rules.find((item) => item.id === ruleEditingId);
      await repo.put<WorldRule>("worldRules", {
        ...(existing ?? makeRecord(projectId)),
        title: title.trim(),
        description: description.trim(),
        immutable,
      }, existing?.revision);
      resetRule();
      setMessage(existing ? "世界規則已更新。" : "世界規則已建立。");
      await onChanged();
    } catch (cause) {
      setMessage(`世界規則儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  async function removeRule(item: WorldRule) {
    if (!confirm(`確定刪除規則「${item.title}」嗎？`)) return;
    try {
      const repository = createNovelRepository();
      await updateStoryBibleReferences(repository, projectId, (storyBible) => ({
        ...storyBible,
        worldRuleIds: withoutId(storyBible.worldRuleIds, item.id),
      }));
      await repository.remove("worldRules", item.id);
      if (ruleEditingId === item.id) resetRule();
      setMessage("世界規則已刪除，Story Bible 引用已同步清除。");
      await onChanged();
    } catch (cause) {
      setMessage(`刪除規則失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  return (
    <>
      <div className="p2SectionToolbar">
        <Link href={closedAIHref(projectId, "world.ruleCandidate", "根據已核准的作品資料，提出世界規則候選；不要直接修改正式設定。")}>
          用閉端 AI 檢查世界規則
        </Link>
      </div>
      <form className="p2InlineEditor" onSubmit={(event) => void saveWorld(event)}>
        <h3>{worldEditingId ? "編輯世界" : "建立世界"}</h3>
        <label>世界名稱<input required value={worldName} onChange={(event) => setWorldName(event.target.value)} /></label>
        <label>時代／時期<input value={worldEra} onChange={(event) => setWorldEra(event.target.value)} /></label>
        <label className="p2WideField">世界摘要<textarea value={worldSummary} onChange={(event) => setWorldSummary(event.target.value)} /></label>
        <div className="p2EditorActions">
          <button type="submit">{worldEditingId ? "儲存世界修改" : "建立世界"}</button>
          {worldEditingId ? <button type="button" className="secondary" onClick={resetWorld}>取消編輯</button> : null}
        </div>
      </form>
      {worlds.length ? (
        <div className="p2DataGrid">
          {worlds.map((item) => (
            <article key={item.id}>
              <b>{item.name.value || "未命名世界"}</b>
              <small>{item.era.value || "未設定時代"}</small>
              <p>{item.summary.value || "尚未建立世界說明"}</p>
              <div className="p2RecordActions">
                <button type="button" onClick={() => editWorld(item)}>編輯</button>
                <button type="button" className="danger" onClick={() => void removeWorld(item)}>刪除</button>
              </div>
            </article>
          ))}
        </div>
      ) : <Empty>目前還沒有世界資料。</Empty>}

      <form className="p2InlineEditor" onSubmit={(event) => void saveRule(event)}>
        <h3>{ruleEditingId ? "編輯世界規則" : "建立世界規則"}</h3>
        <label>規則名稱<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>規則內容<textarea required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="p2Checkbox"><input type="checkbox" checked={immutable} onChange={(event) => setImmutable(event.target.checked)} />不可違反的正式規則</label>
        <div className="p2EditorActions">
          <button type="submit">{ruleEditingId ? "儲存規則修改" : "建立世界規則"}</button>
          {ruleEditingId ? <button type="button" className="secondary" onClick={resetRule}>取消編輯</button> : null}
        </div>
        {message && <p role="status">{message}</p>}
      </form>
      {rules.length ? (
        <div className="p2DataList" data-testid="world-rule-records">
          {rules.map((item) => (
            <article key={item.id} data-record-id={item.id} data-revision={item.revision}>
              <b>{item.title}</b><p>{item.description}</p><small>{item.immutable ? "不可違反" : "可調整"}</small>
              <div className="p2RecordActions">
                <button type="button" onClick={() => editRule(item)}>編輯</button>
                <button type="button" className="danger" onClick={() => void removeRule(item)}>刪除</button>
              </div>
            </article>
          ))}
        </div>
      ) : <Empty>目前尚未建立世界規則。</Empty>}
    </>
  );
}

function TimelineEditor({
  projectId,
  chapters,
  events,
  onChanged,
}: {
  projectId: string;
  chapters: Chapter[];
  events: TimelineEvent[];
  onChanged: () => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [storyTime, setStoryTime] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [message, setMessage] = useState("");

  function reset() {
    setEditingId(null);
    setTitle("");
    setSummary("");
    setStoryTime("");
    setChapterId("");
  }

  function edit(item: TimelineEvent) {
    setEditingId(item.id);
    setTitle(item.title);
    setSummary(item.summary);
    setStoryTime(item.storyTime ?? "");
    setChapterId(item.chapterId ?? "");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !summary.trim()) {
      setMessage("事件名稱與摘要不能留白。");
      return;
    }
    try {
      const repo = createNovelRepository();
      const existing = events.find((item) => item.id === editingId);
      await repo.put<TimelineEvent>("timeline", {
        ...(existing ?? makeRecord(projectId)),
        title: title.trim(),
        summary: summary.trim(),
        storyTime: storyTime.trim() || null,
        chapterId: chapterId || null,
      }, existing?.revision);
      reset();
      setMessage(existing ? "時間線事件已更新。" : "時間線事件已建立。");
      await onChanged();
    } catch (cause) {
      setMessage(`儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  async function remove(item: TimelineEvent) {
    if (!confirm(`確定刪除事件「${item.title}」嗎？`)) return;
    try {
      const repository = createNovelRepository();
      await updateStoryBibleReferences(repository, projectId, (storyBible) => ({
        ...storyBible,
        timelineEventIds: withoutId(storyBible.timelineEventIds, item.id),
      }));
      await repository.remove("timeline", item.id);
      if (editingId === item.id) reset();
      setMessage("時間線事件已刪除，Story Bible 引用已同步清除。");
      await onChanged();
    } catch (cause) {
      setMessage(`刪除事件失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  return (
    <>
      <div className="p2SectionToolbar">
        <Link href={closedAIHref(projectId, "story.timelineCheck", "檢查已核准章節與時間線是否矛盾，列出候選修正，不要直接改寫。")}>
          用閉端 AI 檢查時間線
        </Link>
      </div>
      <form className="p2InlineEditor" onSubmit={(event) => void save(event)}>
        <h3>{editingId ? "編輯事件" : "建立事件"}</h3>
        <label>事件名稱<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>故事時間<input value={storyTime} onChange={(event) => setStoryTime(event.target.value)} placeholder="例如：第三天清晨" /></label>
        <label>連結章節<select value={chapterId} onChange={(event) => setChapterId(event.target.value)}><option value="">不連結章節</option>{chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.order}. {chapter.title}</option>)}</select></label>
        <label className="p2WideField">事件摘要<textarea required value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <div className="p2EditorActions">
          <button type="submit">{editingId ? "儲存事件修改" : "建立事件"}</button>
          {editingId ? <button type="button" className="secondary" onClick={reset}>取消編輯</button> : null}
        </div>
        {message && <p role="status">{message}</p>}
      </form>
      {events.length ? (
        <div className="p2DataList">
          {events.map((item) => (
            <article key={item.id}>
              <time>{item.storyTime || "未設定時間"}</time>
              <div><b>{item.title}</b><p>{item.summary}</p></div>
              <small>{chapters.find((chapter) => chapter.id === item.chapterId)?.title ?? "未連結章節"}</small>
              <div className="p2RecordActions">
                <button type="button" onClick={() => edit(item)}>編輯</button>
                <button type="button" className="danger" onClick={() => void remove(item)}>刪除</button>
              </div>
            </article>
          ))}
        </div>
      ) : <Empty>目前還沒有時間線事件。</Empty>}
    </>
  );
}

function StoryBibleEditor({
  project,
  storyBible,
  onChanged,
}: {
  project: NovelProject;
  storyBible: StoryBible | null;
  onChanged: () => Promise<void>;
}) {
  const [theme, setTheme] = useState(storyBible?.theme.value ?? "");
  const [style, setStyle] = useState(storyBible?.style.value ?? "");
  const [foreshadowing, setForeshadowing] = useState(listText(storyBible?.foreshadowing));
  const [unresolvedThreads, setUnresolvedThreads] = useState(listText(storyBible?.unresolvedThreads));
  const [forbiddenContradictions, setForbiddenContradictions] = useState(
    listText(storyBible?.forbiddenContradictions),
  );
  const [authorPreferences, setAuthorPreferences] = useState(
    listText(storyBible?.authorPreferences),
  );
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<PersistenceFailure | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    try {
      const repo = createNovelRepository();
      const base: StoryBible = storyBible ?? {
        ...makeRecord(project.id),
        id: project.storyBibleId,
        theme: optionalValue<string>(),
        style: optionalValue<string>(),
        protagonistIds: [],
        characterIds: [],
        relationshipIds: [],
        worldId: null,
        worldRuleIds: [],
        loreIds: [],
        timelineEventIds: [],
        foreshadowing: [],
        unresolvedThreads: [],
        forbiddenContradictions: [],
        authorPreferences: [],
        interactionDeltaIds: [],
      };
      await repo.put<StoryBible>("storyBibles", {
        ...base,
        theme: optionalValue(theme.trim() || null, theme.trim() ? "user_defined" : "unset"),
        style: optionalValue(style.trim() || null, style.trim() ? "user_defined" : "unset"),
        foreshadowing: lines(foreshadowing),
        unresolvedThreads: lines(unresolvedThreads),
        forbiddenContradictions: lines(forbiddenContradictions),
        authorPreferences: lines(authorPreferences),
      }, storyBible?.revision);
      setFailure(null);
      setMessage("Story Bible 已保存；空白欄位仍保持空白，不會被 AI 自動補成 Canon。");
      await onChanged();
    } catch (cause) {
      const nextFailure = persistenceFailureOrNull(cause);
      setFailure(nextFailure);
      setMessage(nextFailure
        ? "Story Bible 未保存；本機作品庫已安全停止，既有 Canon 沒有被替換。"
        : `儲存失敗：${cause instanceof Error ? cause.message : "請重新讀取後再試"}`);
    }
  }

  return (
    <>
      <div className="p2SectionToolbar">
        <Link
          data-testid="story-bible-conversation-link"
          data-project-id={project.id}
          href={storyBibleChatHref(project.id)}
        >
          在專案對話中讀取 Story Bible
        </Link>
        <Link href={closedAIHref(project.id, "story.storyBibleCandidate", "根據已核准章節提出 Story Bible 更新候選；不得直接寫入 Canon。")}>
          交給自動協調器建立 Story Bible 候選
        </Link>
      </div>
      <form
        className="p2InlineEditor"
        data-testid="story-bible-editor"
        data-project-id={project.id}
        onSubmit={(event) => void save(event)}
      >
        <h3>編輯 Story Bible</h3>
        <p>每行一項。只有按下儲存才會成為正式故事設定。</p>
        <label>主題<input data-testid="story-bible-theme" value={theme} onChange={(event) => setTheme(event.target.value)} /></label>
        <label>敘事風格<input data-testid="story-bible-style" value={style} onChange={(event) => setStyle(event.target.value)} /></label>
        <label>伏筆<textarea data-testid="story-bible-foreshadowing" value={foreshadowing} onChange={(event) => setForeshadowing(event.target.value)} /></label>
        <label>未解線索<textarea data-testid="story-bible-unresolved" value={unresolvedThreads} onChange={(event) => setUnresolvedThreads(event.target.value)} /></label>
        <label>禁止矛盾<textarea data-testid="story-bible-contradictions" value={forbiddenContradictions} onChange={(event) => setForbiddenContradictions(event.target.value)} /></label>
        <label>作者偏好<textarea data-testid="story-bible-preferences" value={authorPreferences} onChange={(event) => setAuthorPreferences(event.target.value)} /></label>
        <button data-testid="story-bible-save" type="submit">儲存 Story Bible</button>
        {message && <p role="status">{message}</p>}
      </form>
      {failure ? <PersistenceRecoveryNotice failure={failure} onRetry={async () => {
        setFailure(null);
        await onChanged();
      }} /> : null}
      {storyBible ? (
        <article className="p2StoryBibleRecord" data-testid="story-bible-record" data-project-id={project.id} data-record-id={storyBible.id} data-revision={storyBible.revision}>
          <h3>目前正式版本</h3>
          <p>主題：{storyBible.theme.value || "未設定"}／風格：{storyBible.style.value || "未設定"}</p>
          <section><h4>伏筆</h4>{storyBible.foreshadowing.length ? <ul>{storyBible.foreshadowing.map((item) => <li key={item}>{item}</li>)}</ul> : <p>尚未設定</p>}</section>
          <section><h4>未解線索</h4>{storyBible.unresolvedThreads.length ? <ul>{storyBible.unresolvedThreads.map((item) => <li key={item}>{item}</li>)}</ul> : <p>尚未設定</p>}</section>
          <section><h4>禁止矛盾</h4>{storyBible.forbiddenContradictions.length ? <ul>{storyBible.forbiddenContradictions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>尚未設定</p>}</section>
          <small>版本 {storyBible.revision}</small>
        </article>
      ) : <Empty>儲存一次即可建立這本作品的 Story Bible。</Empty>}
    </>
  );
}

function TaskEditor({
  projectId,
  tasks,
  onChanged,
}: {
  projectId: string;
  tasks: WritingTask[];
  onChanged: () => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<WritingTask["kind"]>("writing");
  const [status, setStatus] = useState<WritingTask["status"]>("not_started");
  const [progress, setProgress] = useState("0");
  const [target, setTarget] = useState("1");
  const [message, setMessage] = useState("");

  function reset() {
    setEditingId(null);
    setTitle("");
    setKind("writing");
    setStatus("not_started");
    setProgress("0");
    setTarget("1");
  }

  function edit(item: WritingTask) {
    setEditingId(item.id);
    setTitle(item.title);
    setKind(item.kind);
    setStatus(item.status);
    setProgress(String(item.progress));
    setTarget(String(item.target));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const nextTarget = Math.max(1, Number(target) || 1);
    const nextProgress = Math.min(nextTarget, Math.max(0, Number(progress) || 0));
    if (!title.trim()) {
      setMessage("任務名稱不能留白。");
      return;
    }
    const repo = createNovelRepository();
    const existing = tasks.find((item) => item.id === editingId);
    await repo.put<WritingTask>("tasks", {
      ...(existing ?? makeRecord(projectId)),
      title: title.trim(),
      kind,
      status: nextProgress >= nextTarget ? "completed" : status,
      progress: nextProgress,
      target: nextTarget,
    }, existing?.revision);
    reset();
    setMessage(existing ? "任務已更新。" : "任務已建立。");
    await onChanged();
  }

  async function remove(item: WritingTask) {
    if (!confirm(`確定刪除任務「${item.title}」嗎？`)) return;
    await createNovelRepository().remove("tasks", item.id);
    if (editingId === item.id) reset();
    setMessage("任務已刪除。");
    await onChanged();
  }

  return (
    <>
      <form className="p2InlineEditor" onSubmit={(event) => void save(event)}>
        <h3>{editingId ? "編輯任務" : "建立任務"}</h3>
        <label>任務名稱<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>類型<select value={kind} onChange={(event) => setKind(event.target.value as WritingTask["kind"])}>{TASK_KIND_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>狀態<select value={status} onChange={(event) => setStatus(event.target.value as WritingTask["status"])}><option value="not_started">未開始</option><option value="active">進行中</option><option value="paused">暫停</option><option value="completed">已完成</option></select></label>
        <label>進度<input type="number" min="0" value={progress} onChange={(event) => setProgress(event.target.value)} /></label>
        <label>目標<input type="number" min="1" value={target} onChange={(event) => setTarget(event.target.value)} /></label>
        <div className="p2EditorActions">
          <button type="submit">{editingId ? "儲存任務修改" : "建立任務"}</button>
          {editingId ? <button type="button" className="secondary" onClick={reset}>取消編輯</button> : null}
        </div>
        {message && <p role="status">{message}</p>}
      </form>
      {tasks.length ? (
        <div className="p2DataList">
          {tasks.map((item) => (
            <article key={item.id}>
              <b>{item.title}</b>
              <div><progress max={item.target} value={item.progress} /><p>{item.progress} / {item.target}</p></div>
              <small>{item.status === "completed" ? "已完成" : item.status === "active" ? "進行中" : item.status === "paused" ? "暫停" : "未開始"}</small>
              <div className="p2RecordActions">
                <button type="button" onClick={() => edit(item)}>編輯</button>
                <button type="button" className="danger" onClick={() => void remove(item)}>刪除</button>
              </div>
            </article>
          ))}
        </div>
      ) : <Empty>目前沒有任務。</Empty>}
    </>
  );
}

function AchievementEditor({
  projectId,
  achievements,
  onChanged,
}: {
  projectId: string;
  achievements: Achievement[];
  onChanged: () => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState("0");
  const [target, setTarget] = useState("1");
  const [message, setMessage] = useState("");

  function reset() {
    setEditingId(null);
    setTitle("");
    setProgress("0");
    setTarget("1");
  }

  function edit(item: Achievement) {
    setEditingId(item.id);
    setTitle(item.title);
    setProgress(String(item.progress));
    setTarget(String(item.target));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setMessage("成就名稱不能留白。");
      return;
    }
    const nextTarget = Math.max(1, Number(target) || 1);
    const nextProgress = Math.min(nextTarget, Math.max(0, Number(progress) || 0));
    const repo = createNovelRepository();
    const existing = achievements.find((item) => item.id === editingId);
    await repo.put<Achievement>("achievements", {
      ...(existing ?? makeRecord(projectId)),
      title: title.trim(),
      progress: nextProgress,
      target: nextTarget,
      unlockedAt: nextProgress >= nextTarget
        ? existing?.unlockedAt ?? new Date().toISOString()
        : null,
    }, existing?.revision);
    reset();
    setMessage(existing ? "成就已更新。" : "成就已建立。");
    await onChanged();
  }

  async function remove(item: Achievement) {
    if (!confirm(`確定刪除成就「${item.title}」嗎？`)) return;
    await createNovelRepository().remove("achievements", item.id);
    if (editingId === item.id) reset();
    setMessage("成就已刪除。");
    await onChanged();
  }

  return (
    <>
      <form className="p2InlineEditor" onSubmit={(event) => void save(event)}>
        <h3>{editingId ? "編輯成就" : "建立成就"}</h3>
        <label>成就名稱<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>進度<input type="number" min="0" value={progress} onChange={(event) => setProgress(event.target.value)} /></label>
        <label>目標<input type="number" min="1" value={target} onChange={(event) => setTarget(event.target.value)} /></label>
        <div className="p2EditorActions">
          <button type="submit">{editingId ? "儲存成就修改" : "建立成就"}</button>
          {editingId ? <button type="button" className="secondary" onClick={reset}>取消編輯</button> : null}
        </div>
        {message && <p role="status">{message}</p>}
      </form>
      {achievements.length ? (
        <div className="p2DataGrid">
          {achievements.map((item) => (
            <article key={item.id}>
              <b>{item.title}</b>
              <progress max={item.target} value={item.progress} />
              <p>{item.progress} / {item.target}</p>
              <small>{item.unlockedAt ? `已解鎖 ${new Date(item.unlockedAt).toLocaleString("zh-TW")}` : "尚未解鎖"}</small>
              <div className="p2RecordActions">
                <button type="button" onClick={() => edit(item)}>編輯</button>
                <button type="button" className="danger" onClick={() => void remove(item)}>刪除</button>
              </div>
            </article>
          ))}
        </div>
      ) : <Empty>目前還沒有成就。</Empty>}
    </>
  );
}

function BackupCenter({
  projectId,
  title,
  backups,
  onChanged,
}: {
  projectId: string;
  title: string;
  backups: ProjectBackup[];
  onChanged: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(kind: ProjectBackup["kind"], shouldDownload = false) {
    if (busy) return;
    setBusy(true);
    setMessage("正在整理作品、閱讀進度與故事設定…");
    try {
      const repo = createNovelRepository();
      const { backup, payload } = await createProjectBackup(repo, projectId, kind, {
        appCommit: RELEASE_MANIFEST.appCommit,
        releaseTag: RELEASE_MANIFEST.releaseTag,
      });
      if (shouldDownload) backupDownload(payload, title);
      setMessage(`備份完成，大小約 ${Math.max(1, Math.round(backup.byteSize / 1024))} KB。`);
      await onChanged();
    } catch (cause) {
      setMessage(`備份失敗：${cause instanceof Error ? cause.message : "原有資料仍保持不變"}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    if (busy) return;
    setBusy(true);
    setMessage("正在驗證備份檔…");
    try {
      const check = await validateBackupPayload(JSON.parse(await file.text()));
      if (!check.valid) {
        setMessage(`匯入失敗：${check.reason}`);
        return;
      }
      const repo = createNovelRepository();
      await createProjectBackup(repo, projectId, "safety", {
        appCommit: RELEASE_MANIFEST.appCommit,
        releaseTag: RELEASE_MANIFEST.releaseTag,
      });
      const copyId = await restoreProjectBackup(repo, check.payload, "copy");
      location.assign(`/studio/project/${copyId}/chat`);
    } catch (cause) {
      setMessage(`匯入失敗：${cause instanceof Error ? cause.message : "原有資料仍保持不變"}`);
    } finally {
      setBusy(false);
    }
  }

  async function restore(backup: ProjectBackup) {
    if (!backup.manifest) {
      setMessage("這是舊格式快照，請先建立新的完整備份後再還原。");
      return;
    }
    if (busy || !confirm("系統會先建立目前狀態的安全備份，再還原。要繼續嗎？")) return;
    setBusy(true);
    try {
      const repo = createNovelRepository();
      const check = await validateBackupPayload({
        manifest: backup.manifest,
        records: backup.snapshot,
        sovereignLearning: backup.sovereignLearningSnapshot,
      });
      if (!check.valid || check.payload.manifest.projectId !== projectId) {
        throw new Error(check.valid ? "BACKUP_PROJECT_SCOPE_MISMATCH" : check.reason);
      }
      await createProjectBackup(repo, projectId, "safety", {
        appCommit: RELEASE_MANIFEST.appCommit,
        releaseTag: RELEASE_MANIFEST.releaseTag,
      });
      await restoreProjectBackup(repo, check.payload, "replace", projectId);
      setMessage("還原完成，正在重新載入。");
      window.setTimeout(() => location.assign(`/studio/project/${projectId}/chat`), 300);
    } catch (cause) {
      setMessage(`還原失敗：${cause instanceof Error ? cause.message : "已保留還原前安全備份"}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(backup: ProjectBackup) {
    if (busy || !confirm("確定刪除這份備份嗎？下載到電腦的檔案不受影響。")) return;
    setBusy(true);
    try {
      await createNovelRepository().remove("backups", backup.id);
      setMessage("備份已從這個瀏覽器刪除。");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function exportMarkdown() {
    try {
      markdownDownload(await createNovelRepository().exportProject(projectId), title);
      setMessage("已下載 Markdown 正文。");
    } catch (cause) {
      setMessage(`正文匯出失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  return (
    <section className="p2BackupCenter">
      <header><h2>作品備份</h2><p>作品主要保存在這個瀏覽器中，建議定期下載完整備份。</p></header>
      <div className="p2BackupActions">
        <button disabled={busy} onClick={() => void create("quick", true)}>立即備份並下載</button>
        <button disabled={busy} onClick={() => void create("full", true)}>完整備份並下載</button>
        <button disabled={busy} onClick={() => void exportMarkdown()}>匯出 Markdown 正文</button>
        <label className="buttonLike">匯入作品備份<input type="file" hidden accept="application/json,.json,.novel-backup.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} /></label>
      </div>
      {message && <p role="status">{message}</p>}
      <div className="p2DataList">
        {backups.length ? backups.map((backup) => (
          <article key={backup.id}>
            <b>{backup.kind === "full" ? "完整備份" : backup.kind === "safety" ? "還原前安全備份" : backup.kind === "initial" ? "建立作品時的備份" : "快速備份"}</b>
            <time>{new Date(backup.createdAt).toLocaleString("zh-TW")}</time>
            <p>{Math.max(1, Math.round(backup.byteSize / 1024))} KB</p>
            <div className="p2RecordActions">
              <button disabled={busy || !backup.manifest} onClick={() => backup.manifest && backupDownload({ manifest: backup.manifest, records: backup.snapshot as Record<string, unknown[]> }, title)}>下載</button>
              <button disabled={busy || !backup.manifest} onClick={() => void restore(backup)}>還原</button>
              <button className="danger" disabled={busy} onClick={() => void remove(backup)}>刪除</button>
            </div>
          </article>
        )) : <Empty>這本作品目前還沒有備份。</Empty>}
      </div>
    </section>
  );
}
