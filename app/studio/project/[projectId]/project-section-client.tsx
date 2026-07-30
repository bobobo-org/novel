"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  makeRecord,
  optionalValue,
  type Achievement,
  type Chapter,
  type Character,
  type DomainRecord,
  type NovelProject,
  type ProjectBackup,
  type StoryBible,
  type TimelineEvent,
  type World,
  type WorldRule,
  type WritingTask,
} from "@/lib/novel-ai/domain";
import {
  createNovelRepository,
  type NovelRepository,
  type NovelStoreName,
} from "@/lib/novel-ai/repository";
import {
  backupDownload,
  createProjectBackup,
  markdownDownload,
  validateBackupPayload,
} from "@/lib/novel-ai/repository/backup";
import { RELEASE_MANIFEST } from "@/lib/release-manifest";
import ProjectNavigation from "./project-navigation";

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
  worlds: World[];
  rules: WorldRule[];
  timeline: TimelineEvent[];
  bibles: StoryBible[];
  tasks: WritingTask[];
  achievements: Achievement[];
  backups: ProjectBackup[];
};

const titles: Record<Section, [string, string]> = {
  characters: ["角色", "建立、編輯與管理作品人物；私人秘密只留在本機作品資料。"],
  world: ["世界設定", "管理世界背景與不可違反的正式規則。"],
  timeline: ["時間線", "建立、編輯並連結章節中的重要事件。"],
  "story-bible": ["Story Bible", "管理正式故事記憶；空白欄位不會阻礙創作。"],
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

export default function ProjectSectionClient({
  projectId,
  section,
}: {
  projectId: string;
  section: Section;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const repo = createNovelRepository();
      const [
        project,
        chapters,
        characters,
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
        worlds,
        rules: rules.sort((left, right) => left.title.localeCompare(right.title, "zh-Hant")),
        timeline: timeline.sort((left, right) =>
          (left.storyTime ?? left.createdAt).localeCompare(right.storyTime ?? right.createdAt)),
        bibles,
        tasks,
        achievements,
        backups: backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "資料載入失敗");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <main className="p2ProjectShell">
        <p role="alert">資料載入失敗：{error}</p>
        <button onClick={() => void load()}>重新載入</button>
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
    <main className="p2ProjectShell">
      <header>
        <Link href="/studio">我的作品</Link>
        <div><small>{data.project.title}</small><h1>{title}</h1></div>
        <span>本機保存</span>
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
    return <CharacterEditor projectId={project.id} characters={data.characters} onChanged={onChanged} />;
  }
  if (section === "world") {
    return (
      <WorldEditor
        projectId={project.id}
        worlds={data.worlds}
        rules={data.rules}
        onChanged={onChanged}
      />
    );
  }
  if (section === "timeline") {
    return (
      <TimelineEditor
        projectId={project.id}
        chapters={data.chapters}
        events={data.timeline}
        onChanged={onChanged}
      />
    );
  }
  if (section === "story-bible") {
    return (
      <StoryBibleEditor
        project={project}
        storyBible={data.bibles.find((item) => item.id === project.storyBibleId) ?? data.bibles[0] ?? null}
        onChanged={onChanged}
      />
    );
  }
  if (section === "tasks") {
    return <TaskEditor projectId={project.id} tasks={data.tasks} onChanged={onChanged} />;
  }
  if (section === "achievements") {
    return (
      <AchievementEditor
        projectId={project.id}
        achievements={data.achievements}
        onChanged={onChanged}
      />
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

function CharacterEditor({
  projectId,
  characters,
  onChanged,
}: {
  projectId: string;
  characters: Character[];
  onChanged: () => Promise<void>;
}) {
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
  const [voiceStyle, setVoiceStyle] = useState<"short" | "mixed" | "long">("mixed");
  const [message, setMessage] = useState("");

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
    setVoiceStyle("mixed");
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
    setVoiceStyle(item.voiceStyle?.sentenceLength ?? "mixed");
    setMessage(`正在編輯「${item.name}」。`);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setMessage("角色姓名不能留白。");
      return;
    }
    try {
      const repo = createNovelRepository();
      const existing = characters.find((item) => item.id === editingId);
      const base = existing ?? makeRecord(projectId);
      await repo.put<Character>("characters", {
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
        values: existing?.values ?? [],
        capabilities: existing?.capabilities ?? [],
        limitations: existing?.limitations ?? [],
        voiceStyle: {
          formality: voiceStyle === "long" ? 75 : voiceStyle === "short" ? 35 : 55,
          directness: voiceStyle === "short" ? 75 : 55,
          emotionalExpressiveness: existing?.voiceStyle?.emotionalExpressiveness ?? 50,
          sentenceLength: voiceStyle,
          preferredAddressTerms: existing?.voiceStyle?.preferredAddressTerms ?? [],
        },
      }, existing?.revision);
      reset();
      setMessage(existing ? "角色修改已保存。" : "角色已建立。");
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
        <Link href={closedAIHref(projectId, "character.dialogue", "根據已核准角色資料，產生一段符合角色目標與語氣的候選對話。")}>
          用閉端 AI 協助角色
        </Link>
      </div>
      <form className="p2InlineEditor" aria-labelledby="character-editor-heading" onSubmit={(event) => void save(event)}>
        <h3 id="character-editor-heading">{editingId ? "編輯角色" : "建立角色"}</h3>
        <label>角色姓名<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>別名（以頓號分隔）<input value={aliases} onChange={(event) => setAliases(event.target.value)} /></label>
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
        <label>說話節奏<select value={voiceStyle} onChange={(event) => setVoiceStyle(event.target.value as "short" | "mixed" | "long")}><option value="short">簡短直接</option><option value="mixed">自然混合</option><option value="long">完整慎重</option></select></label>
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
              <b>{item.name}</b>
              <span>{item.lifeStatus === "alive" ? "存活" : item.lifeStatus === "dead" ? "死亡" : "未知"}</span>
              <p>{item.goal.value || "尚未設定目標"}</p>
              <small>{item.locationId || "尚未設定位置"}</small>
              {item.personality.value ? <small>{item.personality.value}</small> : null}
              {item.privateSecrets?.length ? <small>含作者私人設定</small> : null}
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
      setMessage("Story Bible 已保存；空白欄位仍保持空白，不會被 AI 自動補成 Canon。");
      await onChanged();
    } catch (cause) {
      setMessage(`儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  return (
    <>
      <div className="p2SectionToolbar">
        <Link href={closedAIHref(project.id, "story.storyBibleCandidate", "根據已核准章節提出 Story Bible 更新候選；不得直接寫入 Canon。")}>
          用 Private Hub 建立 Story Bible 候選
        </Link>
      </div>
      <form className="p2InlineEditor" onSubmit={(event) => void save(event)}>
        <h3>編輯 Story Bible</h3>
        <p>每行一項。只有按下儲存才會成為正式故事設定。</p>
        <label>主題<input value={theme} onChange={(event) => setTheme(event.target.value)} /></label>
        <label>敘事風格<input value={style} onChange={(event) => setStyle(event.target.value)} /></label>
        <label>伏筆<textarea value={foreshadowing} onChange={(event) => setForeshadowing(event.target.value)} /></label>
        <label>未解線索<textarea value={unresolvedThreads} onChange={(event) => setUnresolvedThreads(event.target.value)} /></label>
        <label>禁止矛盾<textarea value={forbiddenContradictions} onChange={(event) => setForbiddenContradictions(event.target.value)} /></label>
        <label>作者偏好<textarea value={authorPreferences} onChange={(event) => setAuthorPreferences(event.target.value)} /></label>
        <button type="submit">儲存 Story Bible</button>
        {message && <p role="status">{message}</p>}
      </form>
      {storyBible ? (
        <article className="p2StoryBibleRecord" data-testid="story-bible-record" data-record-id={storyBible.id} data-revision={storyBible.revision}>
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
      const copyId = await repo.importProject(check.payload.records, "copy");
      location.assign(`/studio/project/${copyId}/write`);
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
      await createProjectBackup(repo, projectId, "safety", {
        appCommit: RELEASE_MANIFEST.appCommit,
        releaseTag: RELEASE_MANIFEST.releaseTag,
      });
      await repo.importProject(backup.snapshot as Record<string, unknown[]>, "replace", projectId);
      setMessage("還原完成，正在重新載入。");
      window.setTimeout(() => location.reload(), 300);
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
