"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  makeRecord,
  optionalValue,
  type Achievement,
  type Character,
  type NovelProject,
  type ProjectBackup,
  type StoryBible,
  type TimelineEvent,
  type World,
  type WorldRule,
  type WritingTask,
} from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import { backupDownload, createProjectBackup, markdownDownload, validateBackupPayload } from "@/lib/novel-ai/repository/backup";
import { RELEASE_MANIFEST } from "@/lib/release-manifest";
import ProjectNavigation from "./project-navigation";

type Section = "characters" | "world" | "timeline" | "story-bible" | "tasks" | "achievements" | "backups";
type Data = {
  project: NovelProject | null;
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
  characters: ["角色", "查看作品中的人物與目前狀態。"],
  world: ["世界設定", "保存故事背景、規則與重要地點。"],
  timeline: ["時間線", "整理故事中已發生的重要事件。"],
  "story-bible": ["故事設定", "作品記憶會在作者確認後逐步更新。"],
  tasks: ["任務", "追蹤目前正在推進的創作目標。"],
  achievements: ["成就", "記錄完成的重要創作里程碑。"],
  backups: ["備份與還原", "建立、下載、匯入與還原這本作品。"],
};

export default function ProjectSectionClient({ projectId, section }: { projectId: string; section: Section }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const repo = createNovelRepository();
      setData({
        project: await repo.get("projects", projectId),
        characters: await repo.list("characters", projectId),
        worlds: await repo.list("worlds", projectId),
        rules: await repo.list("worldRules", projectId),
        timeline: await repo.list("timeline", projectId),
        bibles: await repo.list("storyBibles", projectId),
        tasks: await repo.list("tasks", projectId),
        achievements: await repo.list("achievements", projectId),
        backups: await repo.list("backups", projectId),
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
    return <main className="p2ProjectShell"><p>資料載入失敗，請重新嘗試。</p><button onClick={() => void load()}>重新載入</button></main>;
  }
  if (!data) return <main className="p2ProjectShell"><p>正在載入作品資料…</p></main>;

  const [title, desc] = titles[section];
  return (
    <main className="p2ProjectShell">
      <header>
        <Link href="/studio">我的作品</Link>
        <div><small>{data.project?.title || "未命名作品"}</small><h1>{title}</h1></div>
        <span>本機保存</span>
      </header>
      <ProjectNavigation projectId={projectId} active={section} />
      <section className="p2ProjectSection">
        <header><h2>{title}</h2><p>{desc}</p></header>
        <SectionBody section={section} data={data} onChanged={load} />
      </section>
    </main>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p2DataEmpty"><p>{children}</p><span>你可以稍後再補充，這不會阻礙作品繼續創作。</span></div>;
}

function SectionBody({ section, data, onChanged }: { section: Section; data: Data; onChanged: () => Promise<void> }) {
  if (section === "characters") return <CharacterEditor projectId={data.project?.id || ""} characters={data.characters} onChanged={onChanged} />;
  if (section === "world") return <WorldRuleEditor projectId={data.project?.id || ""} worlds={data.worlds} rules={data.rules} onChanged={onChanged} />;
  if (section === "story-bible") return <StoryBibleEditor storyBible={data.bibles[0] || null} onChanged={onChanged} />;
  if (section === "timeline") return data.timeline.length ? <div className="p2DataList">{data.timeline.map((item) => <article key={item.id}><time>{item.storyTime || "未設定時間"}</time><b>{item.title}</b><p>{item.summary}</p></article>)}</div> : <Empty>目前還沒有時間線事件。</Empty>;
  if (section === "tasks") return data.tasks.length ? <div className="p2DataList">{data.tasks.map((item) => <article key={item.id}><b>{item.title}</b><p>{item.progress} / {item.target}，{item.status === "completed" ? "已完成" : "進行中"}</p></article>)}</div> : <Empty>目前沒有任務。</Empty>;
  if (section === "achievements") return data.achievements.length ? <div className="p2DataGrid">{data.achievements.map((item) => <article key={item.id}><b>{item.title}</b><p>{item.progress} / {item.target}</p></article>)}</div> : <Empty>完成創作後，成就會出現在這裡。</Empty>;
  return <BackupCenter projectId={data.project?.id || ""} title={data.project?.title || "作品"} backups={data.backups} onChanged={onChanged} />;
}

function CharacterEditor({ projectId, characters, onChanged }: { projectId: string; characters: Character[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
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

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !goal.trim() || !location.trim()) {
      setMessage("請填寫姓名、目標及所在位置或現況。");
      return;
    }
    const repo = createNovelRepository();
    const record: Character = {
      ...makeRecord(projectId),
      name: name.trim(),
      aliases: [],
      identity: optionalValue<string>(null, "deferred"),
      personality: optionalValue(personality.trim(), "user_defined"),
      goal: optionalValue(goal.trim(), "user_defined"),
      lifeStatus,
      locationId: location.trim(),
      age: age.trim() ? Number(age) : null,
      ageVerified: Boolean(age.trim() && ageVerified),
      fears: fear.trim() ? [fear.trim()] : [],
      privateSecrets: secret.trim() ? [secret.trim()] : [],
      factionIds: faction.trim() ? [faction.trim()] : [],
      values: [],
      capabilities: [],
      limitations: [],
      voiceStyle: {
        formality: voiceStyle === "long" ? 75 : voiceStyle === "short" ? 35 : 55,
        directness: voiceStyle === "short" ? 75 : 55,
        emotionalExpressiveness: 50,
        sentenceLength: voiceStyle,
        preferredAddressTerms: [],
      },
    };
    await repo.put("characters", record);
    setName("");
    setGoal("");
    setLocation("");
    setAge("");
    setAgeVerified(false);
    setPersonality("");
    setFear("");
    setSecret("");
    setFaction("");
    setVoiceStyle("mixed");
    setMessage("角色已保存。");
    await onChanged();
  }

  return (
    <>
      <form className="p2InlineEditor" aria-labelledby="character-editor-heading" onSubmit={(event) => void save(event)}>
        <h3 id="character-editor-heading">建立角色</h3>
        <label>角色姓名<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>角色目標<input value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
        <label>生存狀態<select value={lifeStatus} onChange={(event) => setLifeStatus(event.target.value as Character["lifeStatus"])}><option value="alive">存活</option><option value="dead">死亡</option><option value="unknown">未知</option></select></label>
        <label>所在位置或現況<input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
        <label>年齡（可留白）<input type="number" min="0" max="300" value={age} onChange={(event) => setAge(event.target.value)} /></label>
        <label className="p2Checkbox"><input type="checkbox" checked={ageVerified} onChange={(event) => setAgeVerified(event.target.checked)} />作者已確認角色年齡</label>
        <label>角色性格<input value={personality} onChange={(event) => setPersonality(event.target.value)} placeholder="例如：謹慎、重視承諾" /></label>
        <label>角色恐懼<input value={fear} onChange={(event) => setFear(event.target.value)} placeholder="例如：害怕失去同伴" /></label>
        <label>角色秘密<input value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="只供角色私人設定，不會自動寫入正文" /></label>
        <label>所屬勢力<input value={faction} onChange={(event) => setFaction(event.target.value)} placeholder="可留白" /></label>
        <label>說話節奏<select value={voiceStyle} onChange={(event) => setVoiceStyle(event.target.value as "short" | "mixed" | "long")}><option value="short">簡短直接</option><option value="mixed">自然混合</option><option value="long">完整慎重</option></select></label>
        <button type="submit">儲存角色</button>
        {message && <p role="status">{message}</p>}
      </form>
      {characters.length ? (
        <div className="p2DataGrid" data-testid="character-records">
          {characters.map((item) => <article key={item.id} data-record-id={item.id} data-revision={item.revision}><b>{item.name}</b><span>{item.lifeStatus}</span><p>{item.goal.value || "尚未設定目標"}</p><small>{item.locationId || "尚未設定位置"}</small>{item.personality.value ? <small>{item.personality.value}</small> : null}{item.privateSecrets?.length ? <small>已保存私人設定</small> : null}</article>)}
        </div>
      ) : <Empty>目前還沒有角色資料。</Empty>}
    </>
  );
}

function WorldRuleEditor({ projectId, worlds, rules, onChanged }: { projectId: string; worlds: World[]; rules: WorldRule[]; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [immutable, setImmutable] = useState(true);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) {
      setMessage("請填寫規則名稱與內容。");
      return;
    }
    const repo = createNovelRepository();
    await repo.put<WorldRule>("worldRules", {
      ...makeRecord(projectId),
      title: title.trim(),
      description: description.trim(),
      immutable,
    });
    setTitle("");
    setDescription("");
    setMessage("世界規則已保存。");
    await onChanged();
  }

  return (
    <>
      <form className="p2InlineEditor" aria-labelledby="world-rule-editor-heading" onSubmit={(event) => void save(event)}>
        <h3 id="world-rule-editor-heading">建立世界規則</h3>
        <label>規則名稱<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>規則內容<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="p2Checkbox"><input type="checkbox" checked={immutable} onChange={(event) => setImmutable(event.target.checked)} />不可違反的正式規則</label>
        <button type="submit">儲存世界規則</button>
        {message && <p role="status">{message}</p>}
      </form>
      {worlds.length ? <div className="p2DataGrid">{worlds.map((item) => <article key={item.id}><b>{item.name.value || "未命名世界"}</b><p>{item.summary.value || "尚未建立世界說明"}</p></article>)}</div> : null}
      {rules.length ? (
        <div className="p2DataList" data-testid="world-rule-records">
          {rules.map((item) => <article key={item.id} data-record-id={item.id} data-revision={item.revision}><b>{item.title}</b><p>{item.description}</p><small>{item.immutable ? "不可違反" : "可調整"}</small></article>)}
        </div>
      ) : <Empty>目前尚未建立世界規則。現實題材也可以保持空白。</Empty>}
    </>
  );
}

function lines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function StoryBibleEditor({ storyBible, onChanged }: { storyBible: StoryBible | null; onChanged: () => Promise<void> }) {
  const [foreshadowing, setForeshadowing] = useState("");
  const [unresolvedThreads, setUnresolvedThreads] = useState("");
  const [forbiddenContradictions, setForbiddenContradictions] = useState("");
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!storyBible) {
      setMessage("找不到作品故事設定。");
      return;
    }
    if (!lines(foreshadowing).length || !lines(unresolvedThreads).length || !lines(forbiddenContradictions).length) {
      setMessage("伏筆、未解線索與禁止矛盾都至少需要一項。");
      return;
    }
    const repo = createNovelRepository();
    await repo.put<StoryBible>("storyBibles", {
      ...storyBible,
      foreshadowing: lines(foreshadowing),
      unresolvedThreads: lines(unresolvedThreads),
      forbiddenContradictions: lines(forbiddenContradictions),
    }, storyBible.revision);
    setMessage("Story Bible 已保存。");
    await onChanged();
  }

  return (
    <>
      <form className="p2InlineEditor" aria-labelledby="story-bible-editor-heading" onSubmit={(event) => void save(event)}>
        <h3 id="story-bible-editor-heading">更新 Story Bible</h3>
        <p>每行一項；儲存後會成為正式故事設定。</p>
        <label>伏筆<textarea value={foreshadowing} onChange={(event) => setForeshadowing(event.target.value)} /></label>
        <label>未解線索<textarea value={unresolvedThreads} onChange={(event) => setUnresolvedThreads(event.target.value)} /></label>
        <label>禁止矛盾<textarea value={forbiddenContradictions} onChange={(event) => setForbiddenContradictions(event.target.value)} /></label>
        <button type="submit">儲存 Story Bible</button>
        {message && <p role="status">{message}</p>}
      </form>
      {storyBible ? (
        <article className="p2StoryBibleRecord" data-testid="story-bible-record" data-record-id={storyBible.id} data-revision={storyBible.revision}>
          <h3>作品 Story Bible</h3>
          <section><h4>伏筆</h4><ul>{storyBible.foreshadowing.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section><h4>未解線索</h4><ul>{storyBible.unresolvedThreads.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section><h4>禁止矛盾</h4><ul>{storyBible.forbiddenContradictions.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <small>版本 {storyBible.revision}</small>
        </article>
      ) : <Empty>目前還沒有已確認的故事設定。</Empty>}
    </>
  );
}

function BackupCenter({ projectId, title, backups, onChanged }: { projectId: string; title: string; backups: ProjectBackup[]; onChanged: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(kind: ProjectBackup["kind"], shouldDownload = false) {
    if (busy) return;
    setBusy(true);
    setMessage("正在整理作品、閱讀進度與故事設定…");
    try {
      const repo = createNovelRepository();
      const { backup, payload } = await createProjectBackup(repo, projectId, kind, { appCommit: RELEASE_MANIFEST.appCommit, releaseTag: RELEASE_MANIFEST.releaseTag });
      if (shouldDownload) backupDownload(payload, title);
      setMessage(`備份完成，大小約 ${Math.max(1, Math.round(backup.byteSize / 1024))} KB。`);
      await onChanged();
    } catch {
      setMessage("備份失敗，原有作品資料仍然安全。");
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
      await createProjectBackup(repo, projectId, "safety", { appCommit: RELEASE_MANIFEST.appCommit, releaseTag: RELEASE_MANIFEST.releaseTag });
      const copyId = await repo.importProject(check.payload.records, "copy");
      setMessage("已匯入為新作品，原作品沒有被修改。");
      location.assign(`/studio/project/${copyId}/write`);
    } catch {
      setMessage("匯入失敗，原有作品資料仍然安全。");
    } finally {
      setBusy(false);
    }
  }

  async function restore(backup: ProjectBackup) {
    if (!backup.manifest) {
      setMessage("這是舊版建立時的快照，無法直接還原。請先建立一份新的完整備份。");
      return;
    }
    if (busy || !confirm("會先建立目前作品的安全備份，再還原這份備份。要繼續嗎？")) return;
    setBusy(true);
    try {
      const repo = createNovelRepository();
      await createProjectBackup(repo, projectId, "safety", { appCommit: RELEASE_MANIFEST.appCommit, releaseTag: RELEASE_MANIFEST.releaseTag });
      await repo.importProject(backup.snapshot as Record<string, unknown[]>, "replace", projectId);
      setMessage("已完成還原，正在重新載入作品。");
      setTimeout(() => location.reload(), 300);
    } catch {
      setMessage("還原失敗，已保留還原前的安全備份。");
    } finally {
      setBusy(false);
    }
  }

  async function exportMarkdown() {
    try {
      const repo = createNovelRepository();
      markdownDownload(await repo.exportProject(projectId), title);
      setMessage("已下載可閱讀的 Markdown 正文。");
    } catch {
      setMessage("正文匯出失敗，原有作品資料仍然安全。");
    }
  }

  return (
    <section className="p2BackupCenter">
      <header><h2>作品備份</h2><p>作品目前主要保存在這個瀏覽器中。建議定期下載一份完整備份。</p></header>
      <div className="p2BackupActions">
        <button disabled={busy} onClick={() => void create("quick", true)}>立即備份並下載</button>
        <button disabled={busy} onClick={() => void create("full", true)}>完整備份並下載</button>
        <button disabled={busy} onClick={() => void exportMarkdown()}>匯出 Markdown 正文</button>
        <label className="buttonLike">匯入作品備份<input type="file" hidden accept="application/json,.json,.novel-backup.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></label>
      </div>
      {message && <p role="status">{message}</p>}
      <div className="p2DataList">
        {backups.length ? backups.map((backup) => (
          <article key={backup.id}>
            <b>{backup.kind === "full" ? "完整備份" : backup.kind === "safety" ? "還原前安全備份" : backup.kind === "initial" ? "建立作品時的備份" : "快速備份"}</b>
            <time>{new Date(backup.createdAt).toLocaleString("zh-TW")}</time>
            <p>{Math.max(1, Math.round(backup.byteSize / 1024))} KB</p>
            <div>
              <button disabled={busy || !backup.manifest} onClick={() => backup.manifest && backupDownload({ manifest: backup.manifest, records: backup.snapshot as Record<string, unknown[]> }, title)}>下載</button>
              <button disabled={busy || !backup.manifest} onClick={() => void restore(backup)}>還原</button>
            </div>
          </article>
        )) : <Empty>這本作品目前還沒有備份。建立第一份備份，可以避免瀏覽器資料遺失。</Empty>}
      </div>
    </section>
  );
}
