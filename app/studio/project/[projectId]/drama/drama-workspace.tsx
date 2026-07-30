"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Character, Chapter, NovelProject, StoryBible, TimelineEvent, WorldRule } from "@/lib/novel-ai/domain";
import {
  DramaOsService,
  getDramaFormatProfile,
  listDramaFormatProfiles,
  sha256,
  type DramaFormatProfileId,
  type DramaProjectionPackage,
} from "@/lib/novel-ai/drama-os";
import { createNovelRepository, type NovelRepository } from "@/lib/novel-ai/repository";
import ProjectNavigation from "../project-navigation";
import styles from "./drama.module.css";

type WorkspaceData = {
  project: NovelProject;
  chapters: Chapter[];
  characters: Character[];
  worldRules: WorldRule[];
  timeline: TimelineEvent[];
  storyBible: StoryBible;
};

const FORMAT_LABELS: Record<DramaFormatProfileId, string> = {
  DRAMA_60_SECONDS: "60 秒強節奏短劇",
  DRAMA_90_SECONDS: "90 秒完整微弧線",
  DRAMA_3_MINUTES: "3 分鐘單集",
  DRAMA_10_MINUTES: "10 分鐘多場景",
  DRAMA_30_MINUTES: "30 分鐘章回劇",
  DRAMA_90_TO_120_MINUTES: "90–120 分鐘長篇改編",
};

function plainError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code.includes("STALE")) return "作品內容已更新，請重新建立改編候選。";
  if (code === "DRAMA_APPROVAL_BLOCKED") return "這份候選仍有重大一致性問題，修正後才能核准。";
  if (code === "DRAMA_ADULT_CONSENT_REQUIRED") return "成人作品需要確認所有相關角色皆為成年人。";
  return error instanceof Error ? error.message : "短劇規劃沒有成功，原作品沒有被修改。";
}

export default function DramaWorkspace({ projectId }: { projectId: string }) {
  const repositoryRef = useRef<NovelRepository | null>(null);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [format, setFormat] = useState<DramaFormatProfileId>("DRAMA_3_MINUTES");
  const [candidate, setCandidate] = useState<DramaProjectionPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("選擇目標長度後，建立一份不會直接改動原作的短劇候選。");

  const load = useCallback(async () => {
    const repository = repositoryRef.current ?? createNovelRepository();
    repositoryRef.current = repository;
    const [project, chapters, characters, worldRules, timeline, storyBibles, dramaProjects] = await Promise.all([
      repository.get<NovelProject>("projects", projectId),
      repository.list<Chapter>("chapters", projectId),
      repository.list<Character>("characters", projectId),
      repository.list<WorldRule>("worldRules", projectId),
      repository.list<TimelineEvent>("timeline", projectId),
      repository.list<StoryBible>("storyBibles", projectId),
      repository.list("dramaProjects", projectId),
    ]);
    if (!project || !storyBibles[0]) throw new Error("找不到這本作品的正式資料。");
    setData({ project, chapters: chapters.sort((a, b) => a.order - b.order), characters, worldRules, timeline, storyBible: storyBibles[0] });
    if (dramaProjects.length) setMessage(`已保存 ${dramaProjects.length} 份改編紀錄，可建立新的候選。`);
  }, [projectId]);

  useEffect(() => {
    void load().catch((error) => setMessage(plainError(error)));
  }, [load]);

  async function generate() {
    if (!data || busy) return;
    setBusy(true);
    setMessage("正在讀取章節、角色、世界規則與未解線索……");
    try {
      const service = new DramaOsService(repositoryRef.current!);
      const promptHash = await sha256(`${data.project.id}:${data.project.revision}:${format}:drama-os-v1`);
      const result = await service.project({
        requestId: crypto.randomUUID(),
        storyId: data.project.id,
        storyTitle: data.project.title,
        sourceRevision: data.project.revision,
        currentStoryRevision: data.project.revision,
        storyBibleVersion: data.storyBible.revision,
        currentStoryBibleVersion: data.storyBible.revision,
        formatProfile: format,
        chapters: data.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, content: chapter.content, revision: chapter.revision })),
        characters: data.characters.map((character) => ({
          id: character.id,
          name: character.name,
          aliases: character.aliases,
          goal: character.goal.value,
          lifeStatus: character.lifeStatus,
          locationId: character.locationId,
        })),
        worldRules: data.worldRules,
        timeline: data.timeline,
        storyBible: {
          foreshadowing: data.storyBible.foreshadowing,
          unresolvedThreads: data.storyBible.unresolvedThreads,
          forbiddenContradictions: data.storyBible.forbiddenContradictions,
        },
        sourceChunkIds: data.chapters.map((chapter) => `chapter:${chapter.id}:full`),
        retrievalTraceId: `studio:${data.project.id}:drama`,
        contextCompositionId: `context:${data.storyBible.id}:${data.storyBible.revision}`,
        providerRunId: `deterministic:${crypto.randomUUID()}`,
        providerId: "deterministic-local",
        promptHash,
        adultMode: data.project.adultMode,
        adultConsent: data.project.adultMode,
        allCharactersConfirmedAdult: !data.project.adultMode,
        resourceBudget: { maxSourceChars: 500_000, maxEpisodes: 12, maxScenes: 72, timeoutMs: 30_000 },
      });
      setCandidate(result);
      setMessage("短劇候選已完成。正式小說與正式改編版本都尚未變更。");
    } catch (error) {
      setMessage(plainError(error));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!candidate || busy) return;
    setBusy(true);
    try {
      const service = new DramaOsService(repositoryRef.current!);
      const payloadFingerprint = await service.fingerprint(candidate.project.dramaProjectId);
      const result = await service.approve({
        projectId,
        dramaProjectId: candidate.project.dramaProjectId,
        idempotencyKey: `drama-approval:${candidate.project.dramaProjectId}`,
        expectedDramaProjectRevision: candidate.project.revision,
        expectedSourceStoryRevision: candidate.project.sourceStoryRevision,
        expectedStoryBibleVersion: candidate.project.sourceStoryBibleVersion,
        approvedBy: "studio-user",
        payloadFingerprint,
      });
      setCandidate({ ...candidate, project: result.project, canonLinks: [result.canonLink] });
      setMessage(result.replayed ? "這份改編已核准，沒有重複建立版本。" : "已建立正式改編版本；小說原文沒有被修改。");
    } catch (error) {
      setMessage(plainError(error));
    } finally {
      setBusy(false);
    }
  }

  const evaluation = candidate?.evaluations[0];
  const profile = useMemo(() => getDramaFormatProfile(format), [format]);
  const candidateProfile = useMemo(
    () => candidate ? getDramaFormatProfile(candidate.project.formatProfile) : null,
    [candidate],
  );

  if (!data) return <main className="p2ProjectShell"><p role="status">{message}</p></main>;
  return (
    <main className="p2ProjectShell">
      <header><Link href="/studio">← 我的作品</Link><div><small>{data.project.title}</small><h1>小說轉短劇</h1></div><span>原作與改編分開保存</span></header>
      <ProjectNavigation projectId={projectId} active="drama" />
      <section className={`${styles.root} dramaWorkspace`}>
        <header>
          <div><span>DRAMA OS</span><h2>把正式章節整理成可核准的戲劇候選</h2><p>系統會讀取章節、角色、世界規則與時間線。建立候選不會直接改動小說正史。</p></div>
          <label>目標長度<select value={format} onChange={(event) => setFormat(event.target.value as DramaFormatProfileId)}>{listDramaFormatProfiles().map((item) => <option key={item.id} value={item.id}>{FORMAT_LABELS[item.id]}</option>)}</select></label>
          <button className="gold" disabled={busy || data.chapters.length === 0} onClick={() => void generate()}>{busy ? "正在規劃……" : candidate ? "重新生成" : "建立改編候選"}</button>
          <Link href={`/studio/project/${encodeURIComponent(projectId)}/closed-ai?task=drama.episodePlan&objective=${encodeURIComponent(`把目前作品強化為${FORMAT_LABELS[format]}，檢查開場 Hook、衝突、轉折、角色動機、連續性與代價。`)}`}>
            用閉端 AI 強化改編
          </Link>
        </header>
        <p className="dramaStatus" role="status">{message}</p>
        {!candidate ? <div className="p2DataEmpty"><p>{data.chapters.length ? `將使用 ${data.chapters.length} 章正式內容，預計每集約 ${profile.targetDurationSeconds} 秒。` : "目前沒有可用章節，請先寫一段故事。"}</p></div> : (
          <>
            <section
              className="dramaSummary"
              data-testid="drama-candidate"
              data-candidate-id={candidate.project.dramaProjectId}
              data-provider-run-id={candidate.project.projectionTrace.providerRunId}
              data-output-hash={candidate.project.projectionTrace.outputHash}
              data-created-at={candidate.project.createdAt}
              data-format-profile={candidate.project.formatProfile}
              data-target-duration={candidateProfile?.targetDurationSeconds}
              data-scene-count={candidate.scenes.length}
              data-beat-count={candidate.beats.length}
              data-hook-deadline={candidateProfile?.openingHookDeadlineSeconds}
              data-conflict-interval={candidateProfile?.conflictIntervalSeconds}
              data-reversal-interval={candidateProfile?.reversalIntervalSeconds}
              data-minimum-payoff-count={candidateProfile?.minimumPayoffCount}
              data-cliffhanger-type={candidate.episodes[0]?.cliffhanger.type}
            >
              <article><small>來源章節</small><strong>{candidate.project.projectionTrace.sourceChapterIds.length}</strong><span>版本 {candidate.project.sourceStoryRevision}</span></article>
              <article><small>單集規劃</small><strong>{candidate.episodes.length}</strong><span>{FORMAT_LABELS[candidate.project.formatProfile]}</span></article>
              <article><small>候選場景</small><strong>{candidate.scenes.length}</strong><span>{candidate.beats.length} 個戲劇節拍</span></article>
              <article><small>一致性風險</small><strong>{evaluation?.blockingIssueCount ?? 0}</strong><span>{evaluation?.status === "blocked" ? "需先修正" : "可進一步檢查"}</span></article>
            </section>
            <section className="dramaEpisodes">
              {candidate.episodes.map((episode) => (
                <article key={episode.episodeId}>
                  <header><div><small>第 {episode.episodeNumber} 集</small><h3>{episode.episodeGoal}</h3></div><span>{episode.estimatedDurationSeconds} 秒</span></header>
                  <dl>
                    <div><dt>主要衝突</dt><dd>{episode.majorConflict}</dd></div>
                    <div><dt>開場 Hook</dt><dd>{episode.openingHook.text}</dd></div>
                    <div><dt>轉折</dt><dd>{episode.turningPoint}</dd></div>
                    <div><dt>結尾懸念</dt><dd>{episode.cliffhanger.text}</dd></div>
                  </dl>
                  <div className="dramaEmotion" aria-label={`第 ${episode.episodeNumber} 集情緒曲線`}>{episode.emotionCurve.map((point) => <i key={point.causeBeatId} style={{ height: `${Math.max(12, point.intensity)}%` }} title={`${point.emotion} ${point.intensity}`} />)}</div>
                </article>
              ))}
            </section>
            <section className="dramaBranches"><h2>互動選項</h2><div>{candidate.branchCandidates[0]?.choices.map((choice) => <article key={choice.key}><b>{choice.key}</b><h3>{choice.label}</h3><p>{choice.action}</p><small>{choice.consequence}</small></article>)}</div></section>
            {evaluation?.issues.length ? <section className="dramaRisks"><h2>風險提示</h2><ul>{evaluation.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}</li>)}</ul></section> : null}
            <footer className="dramaActions">
              <button className="gold" disabled={busy || candidate.project.status === "approved" || Boolean(evaluation?.blockingIssueCount)} onClick={() => void approve()}>{candidate.project.status === "approved" ? "已核准改編" : "接受並建立改編版本"}</button>
              <button disabled={busy} onClick={() => void generate()}>再產生一份</button>
              <button disabled={busy} onClick={() => { setCandidate(null); setMessage("已放棄畫面上的候選；正式作品沒有變更。"); }}>放棄</button>
            </footer>
            <details className="dramaTechnical"><summary>查看技術資訊</summary><dl><div><dt>執行方式</dt><dd>本機規則式戲劇規劃</dd></div><div><dt>正式小說寫入</dt><dd>{candidate.canonicalMutation}</dd></div><div><dt>來源版本</dt><dd>{candidate.project.sourceStoryRevision}</dd></div><div><dt>目標秒數</dt><dd>{candidateProfile?.targetDurationSeconds}</dd></div><div><dt>Hook 時限</dt><dd>{candidateProfile?.openingHookDeadlineSeconds}</dd></div><div><dt>衝突間隔</dt><dd>{candidateProfile?.conflictIntervalSeconds}</dd></div><div><dt>轉折間隔</dt><dd>{candidateProfile?.reversalIntervalSeconds}</dd></div><div><dt>最低 Payoff</dt><dd>{candidateProfile?.minimumPayoffCount}</dd></div><div><dt>搜尋前文紀錄</dt><dd>{candidate.project.projectionTrace.retrievalTraceId}</dd></div><div><dt>內容指紋</dt><dd>{candidate.project.projectionTrace.outputHash}</dd></div></dl></details>
          </>
        )}
      </section>
    </main>
  );
}
