"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Character,
  LoreEntry,
  NovelProject,
  StoryBible,
  StoryState,
  TimelineEvent,
  World,
  WorldRule,
} from "@/lib/novel-ai/domain";
import {
  activeStoryCharacters,
  activeStoryLore,
  activeStoryTimeline,
  activeStoryWorldRules,
} from "@/lib/novel-ai/domain/active-story-context";
import { explicitCrossEraCanonAuthorization } from "@/lib/novel-ai/domain/story-started-canon-guard";
import {
  isCharacterEraCompatible,
  suggestedCharacterPortrait,
  worldEraContext,
} from "@/lib/novel-ai/character-portraits/assignment";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import CharacterPortraitImage from "./character-portrait";

export const STORY_STAGE_FIELDS = [
  "activeCharacterIds",
  "activeWorldId",
  "activeWorldRuleIds",
  "activeLoreIds",
  "activeTimelineEventIds",
] as const;

type StoryStageField = (typeof STORY_STAGE_FIELDS)[number];
type StoryStagePatch = Partial<Pick<StoryState, StoryStageField>>;
type StageFocus = "characters" | "world" | "timeline" | "story-bible" | "all";

type StageData = {
  project: NovelProject | null;
  storyBible: StoryBible | null;
  storyState: StoryState | null;
  characters: Character[];
  worlds: World[];
  worldRules: WorldRule[];
  lore: LoreEntry[];
  timeline: TimelineEvent[];
};

const EMPTY_DATA: StageData = {
  project: null,
  storyBible: null,
  storyState: null,
  characters: [],
  worlds: [],
  worldRules: [],
  lore: [],
  timeline: [],
};

const STORY_STAGE_FIELD_SET = new Set<string>(STORY_STAGE_FIELDS);
const CROSS_ERA_SOURCE_LABELS = {
  project: "專案設定",
  "story-bible": "Story Bible",
  "world-rule": "世界規則",
  "baseline-world": "Story Bible 正式世界",
} as const;

function assertStoryStagePatch(patch: StoryStagePatch) {
  const unexpected = Object.keys(patch).find((key) => !STORY_STAGE_FIELD_SET.has(key));
  if (unexpected) throw new Error(`STORY_STAGE_FIELD_NOT_ALLOWED:${unexpected}`);
}

function characterReadOnlyFacts(character: Character) {
  const stats = Object.entries(character.rpgProfile?.stats ?? {})
    .map(([key, value]) => `${key} ${value}`)
    .join("、");
  return [
    character.age === null || character.age === undefined ? null : `${character.age} 歲`,
    character.personality.value,
    character.goal.value ? `目標：${character.goal.value}` : null,
    stats ? `能力：${stats}` : null,
  ].filter(Boolean).join(" · ");
}

export default function StoryStageSelector({
  projectId,
  compact = false,
  focus = "all",
  onChanged,
}: {
  projectId: string;
  compact?: boolean;
  focus?: StageFocus;
  onChanged?: (storyState: StoryState) => void | Promise<void>;
}) {
  const repository = useMemo(() => createNovelRepository(), []);
  const [data, setData] = useState<StageData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("只會更新目前故事的上場名單，不會修改正式人物、能力值、世界規則或記憶內容。");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const project = await repository.get<NovelProject>("projects", projectId);
      if (!project || project.deletedAt) {
        setData(EMPTY_DATA);
        setMessage("找不到這部作品；沒有寫入任何資料。");
        return;
      }
      const [storyBibles, storyStates, characters, worlds, worldRules, lore, timeline] = await Promise.all([
        repository.list<StoryBible>("storyBibles", projectId),
        repository.list<StoryState>("storyStates", projectId),
        repository.list<Character>("characters", projectId),
        repository.list<World>("worlds", projectId),
        repository.list<WorldRule>("worldRules", projectId),
        repository.list<LoreEntry>("lore", projectId),
        repository.list<TimelineEvent>("timeline", projectId),
      ]);
      setData({
        project,
        storyBible: storyBibles.find((item) => item.id === project.storyBibleId) ?? storyBibles[0] ?? null,
        storyState: storyStates.find((item) => item.id === project.storyStateId) ?? storyStates[0] ?? null,
        characters: characters.sort((left, right) => left.name.localeCompare(right.name, "zh-Hant")),
        worlds,
        worldRules,
        lore,
        timeline,
      });
    } catch (cause) {
      setMessage(`上場資料讀取失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setLoading(false);
    }
  }, [projectId, repository]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectedWorldId = data.storyState?.activeWorldId
    ?? data.storyBible?.worldId
    ?? data.worlds[0]?.id
    ?? null;
  const selectedWorld = data.worlds.find((world) => world.id === selectedWorldId) ?? null;
  const activeWorlds = selectedWorld ? [selectedWorld] : [];
  const baselineWorld = data.storyBible?.worldId
    ? data.worlds.find((world) => world.id === data.storyBible?.worldId) ?? null
    : null;
  const crossEraCanon = data.project
    ? explicitCrossEraCanonAuthorization({
        project: data.project,
        storyBible: data.storyBible,
        worldRules: data.worldRules,
        baselineWorld,
      })
    : { authorized: false, sources: [] };
  const incompatibleCharacterIds = new Set(data.project
    ? data.characters
        .filter((character) => !isCharacterEraCompatible({ character, project: data.project!, worlds: activeWorlds }))
        .map((character) => character.id)
    : []);
  const activeCharacterIds = new Set(
    activeStoryCharacters(data.characters, data.storyState, data.storyBible)
      .filter((character) => !incompatibleCharacterIds.has(character.id))
      .map((character) => character.id),
  );
  const activeWorldRuleIds = new Set(
    activeStoryWorldRules(data.worldRules, data.storyState, data.storyBible).map((rule) => rule.id),
  );
  const activeLoreIds = new Set(
    activeStoryLore(data.lore, data.storyState, data.storyBible).map((entry) => entry.id),
  );
  const activeTimelineEventIds = new Set(
    activeStoryTimeline(data.timeline, data.storyState, data.storyBible).map((event) => event.id),
  );
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase("zh-Hant");
  const matchingCharacters = data.characters.filter((character) => (
    !normalizedQuery
    || [character.name, ...character.aliases, character.identity.value]
      .filter(Boolean)
      .join("｜")
      .toLocaleLowerCase("zh-Hant")
      .includes(normalizedQuery)
  ));
  const visibleCharacterLimit = compact ? 24 : 200;
  const visibleCharacters = matchingCharacters.slice(0, visibleCharacterLimit);

  async function updateStoryStage(patch: StoryStagePatch, nextMessage: string) {
    assertStoryStagePatch(patch);
    if (!data.storyState) {
      setMessage("作品缺少 StoryState；上場選擇沒有寫入，正式資料也沒有改動。");
      return;
    }
    setBusy(true);
    try {
      const latest = await repository.get<StoryState>("storyStates", data.storyState.id);
      if (!latest || latest.projectId !== projectId) throw new Error("STORY_STATE_NOT_FOUND");
      const saved = await repository.put<StoryState>("storyStates", { ...latest, ...patch }, latest.revision);
      setData((current) => ({ ...current, storyState: saved }));
      setMessage(nextMessage);
      await onChanged?.(saved);
    } catch (cause) {
      setMessage(`上場設定儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleCharacter(character: Character) {
    if (incompatibleCharacterIds.has(character.id)) {
      setMessage(`「${character.name}」與目前世界的時代不相容；請先在首頁正式設定穿越／跨時代前提。`);
      return;
    }
    const protagonist = data.storyBible?.protagonistIds.includes(character.id) ?? false;
    if (protagonist && activeCharacterIds.has(character.id)) {
      setMessage("主角必須留在上場名單；故事內只能調整其他人物的上場狀態。");
      return;
    }
    const next = new Set(activeCharacterIds);
    if (next.has(character.id)) next.delete(character.id);
    else next.add(character.id);
    for (const protagonistId of data.storyBible?.protagonistIds ?? []) {
      if (!incompatibleCharacterIds.has(protagonistId)) next.add(protagonistId);
    }
    await updateStoryStage(
      { activeCharacterIds: [...next] },
      next.has(character.id)
        ? `「${character.name}」已加入目前故事；後續續寫會讀取這名人物。`
        : `「${character.name}」已改為候場；正式人物與能力值完整保留。`,
    );
  }

  async function selectWorld(world: World) {
    const baseline = baselineWorld ?? data.worlds[0] ?? null;
    const baselineEra = baseline ? worldEraContext(baseline) : null;
    const requestedEra = worldEraContext(world);
    const requiresCrossEraCanon = requestedEra === "cross-era"
      || Boolean(baseline && baselineEra !== requestedEra);
    if (requiresCrossEraCanon && !crossEraCanon.authorized) {
      setMessage(`「${world.name.value ?? "未命名世界"}」不能直接上場：必須先在首頁的 Story Bible、世界規則或專案設定中正式建立穿越／跨時代前提。`);
      return;
    }
    const nextWorlds = [world];
    const compatibleIds = new Set(data.characters
      .filter((character) => data.project && isCharacterEraCompatible({ character, project: data.project, worlds: nextWorlds }))
      .map((character) => character.id));
    const nextCharacterIds = [...activeCharacterIds].filter((id) => compatibleIds.has(id));
    for (const protagonistId of data.storyBible?.protagonistIds ?? []) {
      if (compatibleIds.has(protagonistId)) nextCharacterIds.push(protagonistId);
    }
    await updateStoryStage({
      activeWorldId: world.id,
      activeCharacterIds: [...new Set(nextCharacterIds)],
    }, `「${world.name.value ?? "未命名世界"}」已設為目前上場世界；不相容時代的人物已留在候場。`);
  }

  async function toggleReference(
    field: "activeWorldRuleIds" | "activeLoreIds" | "activeTimelineEventIds",
    current: Set<string>,
    id: string,
    label: string,
  ) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    await updateStoryStage(
      { [field]: [...next] },
      `${label}已${next.has(id) ? "加入" : "移出"}目前故事脈絡；正式內容沒有被改寫。`,
    );
  }

  if (loading) return <section className="characterStageManager" data-testid="story-stage-selector" data-canon-edit-surface="story-selection-only" data-loading="true"><p>正在讀取上場名單……</p></section>;
  if (!data.project) return <section className="characterStageManager" data-testid="story-stage-selector" data-canon-edit-surface="story-selection-only"><p>{message}</p></section>;

  return (
    <section
      className="characterStageManager"
      data-testid="story-stage-selector"
      data-canon-edit-surface="story-selection-only"
      data-story-state-write-fields={STORY_STAGE_FIELDS.join(",")}
    >
      <header>
        <div><small>STORY STAGE · SELECTION ONLY</small><h2>選擇目前上場的人物、世界與記憶</h2></div>
        <span>{activeCharacterIds.size} 人上場</span>
      </header>
      <p>這裡只決定後續故事要讀取哪些既有正式資料；姓名、能力值、關係、世界規則、Story Bible 與時間線內容一律唯讀。</p>
      <p className="characterCanonLock" data-locked="true" role="status" data-testid="story-stage-selection-boundary">{message}</p>
      <p>
        要新增或修改正式設定，請回到{" "}
        <Link href={`/professional?intent=library&projectId=${encodeURIComponent(projectId)}#character-world-memory-editor`}>
          首頁「角色、世界與記憶」
        </Link>。
      </p>

      <section aria-labelledby={`story-stage-characters-${projectId}`}>
        <header><div><h3 id={`story-stage-characters-${projectId}`}>上場人物</h3><p>關係會依上場人物自動帶入；故事內不能修改人物數值。</p></div></header>
        <label>
          查找既有人物
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="姓名、別名或身分" />
        </label>
        <div className="characterStageGrid">
          {visibleCharacters.map((character) => {
            const active = activeCharacterIds.has(character.id);
            const incompatible = incompatibleCharacterIds.has(character.id);
            const protagonist = data.storyBible?.protagonistIds.includes(character.id) ?? false;
            const portrait = suggestedCharacterPortrait({ character, project: data.project!, worlds: activeWorlds });
            return (
              <button
                type="button"
                key={character.id}
                aria-pressed={active}
                data-testid="story-stage-character"
                data-character-id={character.id}
                data-era-compatible={!incompatible}
                disabled={busy || incompatible}
                onClick={() => void toggleCharacter(character)}
              >
                <CharacterPortraitImage portrait={portrait} decorative />
                <span>
                  <b>{character.name}</b>
                  <small>{character.identity.value || "身分未設定"}</small>
                  <small>{characterReadOnlyFacts(character) || "其他正式屬性尚未設定"}</small>
                  <em>{incompatible ? "時代不相容" : protagonist ? "主角 · 固定上場" : active ? "上場中" : "候場"}</em>
                </span>
              </button>
            );
          })}
        </div>
        {matchingCharacters.length > visibleCharacters.length ? <p>符合條件的人物有 {matchingCharacters.length.toLocaleString("zh-TW")} 位；請繼續輸入關鍵字縮小範圍。</p> : null}
        {!matchingCharacters.length ? <p>找不到符合條件的正式人物。</p> : null}
      </section>

      <details open={focus === "world" || focus === "all"}>
        <summary>目前世界（{selectedWorld?.name.value ?? "尚未選擇"}）</summary>
        <div className="characterStageWorlds" aria-label="上場世界">
          {data.worlds.map((world) => (
            <button
              type="button"
              key={world.id}
              aria-pressed={selectedWorldId === world.id}
              data-testid="story-stage-world"
              data-world-id={world.id}
              disabled={busy}
              onClick={() => void selectWorld(world)}
            >
              <b>{world.name.value || "未命名世界"}</b>
              <span>{world.era.value || "時代未設定"}</span>
              <small>{world.summary.value || "摘要未設定"}</small>
            </button>
          ))}
        </div>
        <p data-testid="story-stage-cross-era-status">
          {crossEraCanon.authorized
            ? `跨時代 Canon 已由${crossEraCanon.sources.map((source) => CROSS_ERA_SOURCE_LABELS[source]).join("、")}授權。`
            : "尚無跨時代 Canon；其他時代的人物與世界不能在故事內自行加入。"}
        </p>
      </details>

      <div className="characterStageReferences">
        <details open={focus === "world"}>
          <summary>上場世界規則（{activeWorldRuleIds.size}/{data.worldRules.length}）</summary>
          {data.worldRules.map((rule) => (
            <label key={rule.id} data-testid="story-stage-rule" data-rule-id={rule.id}>
              <input type="checkbox" checked={activeWorldRuleIds.has(rule.id)} disabled={busy || rule.immutable} onChange={() => void toggleReference("activeWorldRuleIds", activeWorldRuleIds, rule.id, `世界規則「${rule.title}」`)} />
              <span><b>{rule.title}</b>{rule.immutable ? " · 不可移除" : ""}<small>{rule.description}</small></span>
            </label>
          ))}
        </details>
        <details open={focus === "story-bible"}>
          <summary>Story Bible 與上場記憶（{activeLoreIds.size}/{data.lore.length}）</summary>
          {data.storyBible ? <article data-testid="story-stage-bible-readonly"><b>{data.storyBible.theme.value || "主題未設定"}</b><p>{data.storyBible.style.value || "風格未設定"}</p><small>未解線索：{data.storyBible.unresolvedThreads.join("、") || "無"}</small><br /><small>禁止矛盾：{data.storyBible.forbiddenContradictions.join("、") || "無"}</small></article> : <p>尚無 Story Bible。</p>}
          {data.lore.map((entry) => (
            <label key={entry.id} data-testid="story-stage-lore" data-lore-id={entry.id}>
              <input type="checkbox" checked={activeLoreIds.has(entry.id)} disabled={busy} onChange={() => void toggleReference("activeLoreIds", activeLoreIds, entry.id, `故事記憶「${entry.title}」`)} />
              <span><b>{entry.title}</b> · {entry.kind}<small>{entry.content}</small></span>
            </label>
          ))}
        </details>
        <details open={focus === "timeline"}>
          <summary>上場時間線（{activeTimelineEventIds.size}/{data.timeline.length}）</summary>
          {data.timeline.map((event) => (
            <label key={event.id} data-testid="story-stage-timeline" data-timeline-id={event.id}>
              <input type="checkbox" checked={activeTimelineEventIds.has(event.id)} disabled={busy} onChange={() => void toggleReference("activeTimelineEventIds", activeTimelineEventIds, event.id, `時間線「${event.title}」`)} />
              <span><b>{event.title}</b>{event.storyTime ? ` · ${event.storyTime}` : ""}<small>{event.summary}</small></span>
            </label>
          ))}
        </details>
      </div>
    </section>
  );
}
