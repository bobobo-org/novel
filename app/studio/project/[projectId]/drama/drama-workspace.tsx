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
import { createStoryMediaCandidatePackage } from "@/lib/novel-ai/media-extension";
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

type DramaPlaybackMode = "linear" | "interactive";

type VideoRuntimeHealth = {
  configured: boolean;
  model: string;
  credentialConfigured: boolean;
  jobStoreConfigured: boolean;
  artifactStoreConfigured: boolean;
};

type VideoRuntimeState = {
  loading: boolean;
  health: VideoRuntimeHealth | null;
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
  const [playbackMode, setPlaybackMode] = useState<DramaPlaybackMode>("linear");
  const [candidatePlaybackMode, setCandidatePlaybackMode] = useState<DramaPlaybackMode | null>(null);
  const [candidate, setCandidate] = useState<DramaProjectionPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("選擇目標長度後，建立一份不會直接改動原作的短劇候選。");
  const [videoRuntime, setVideoRuntime] = useState<VideoRuntimeState>({ loading: true, health: null });
  const [externalVideoConsent, setExternalVideoConsent] = useState(false);
  const [videoCostConfirmed, setVideoCostConfirmed] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);

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

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/media/video/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as Partial<VideoRuntimeHealth>;
        if (!response.ok
          || typeof payload.configured !== "boolean"
          || typeof payload.model !== "string"
          || typeof payload.credentialConfigured !== "boolean"
          || typeof payload.jobStoreConfigured !== "boolean"
          || typeof payload.artifactStoreConfigured !== "boolean") {
          throw new Error("VIDEO_HEALTH_INVALID");
        }
        setVideoRuntime({
          loading: false,
          health: {
            configured: payload.configured,
            model: payload.model,
            credentialConfigured: payload.credentialConfigured,
            jobStoreConfigured: payload.jobStoreConfigured,
            artifactStoreConfigured: payload.artifactStoreConfigured,
          },
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setVideoRuntime({ loading: false, health: null });
        setMessage(error instanceof Error && error.message === "VIDEO_HEALTH_INVALID"
          ? "影片服務狀態無法驗證；本次不會送出外部工作。"
          : "無法讀取影片服務狀態；本次不會送出外部工作。");
      });
    return () => controller.abort();
  }, []);

  async function generate() {
    if (!data || busy) return;
    setBusy(true);
    setMessage("正在讀取章節、角色、世界規則與未解線索……");
    try {
      const service = new DramaOsService(repositoryRef.current!);
      const promptHash = await sha256(`${data.project.id}:${data.project.revision}:${format}:${playbackMode}:drama-os-v1`);
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
      setExternalVideoConsent(false);
      setVideoCostConfirmed(false);
      setCandidate(result);
      setCandidatePlaybackMode(playbackMode);
      setMessage(playbackMode === "interactive"
        ? "互動短劇候選已完成；ABC 只會在集尾作為觀眾分支。正式版本尚未變更。"
        : "線性短劇候選已完成；播放時不會出現 ABC。正式版本尚未變更。");
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

  async function submitVideoGeneration() {
    if (!candidate || !data || candidate.project.status !== "approved") {
      setMessage("請先核准短劇改編，再準備 Seedance 2.5 工作。");
      return;
    }
    if (!videoRuntime.health?.configured) {
      setMessage("Seedance 2.5 尚未完成永久工作儲存與伺服器端設定；本次沒有送出工作。");
      return;
    }
    if (!externalVideoConsent || !videoCostConfirmed) {
      setMessage("請先確認資料會離開本機，以及外部供應商可能收費。");
      return;
    }
    if (data.project.adultMode) {
      setMessage("第一階段不會把成人內容送往 Seedance 2.5。");
      return;
    }
    const firstScene = candidate.scenes[0];
    if (!firstScene) {
      setMessage("核准改編沒有可供影片化的場景。");
      return;
    }
    setVideoBusy(true);
    try {
      const response = await fetch("/api/media/video/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "seedance-video-submit-v1",
          idempotencyKey: `seedance:${candidate.project.dramaProjectId}:${candidate.project.revision}:first-shot`,
          projectId: data.project.id,
          approvedDrama: {
            dramaProjectId: candidate.project.dramaProjectId,
            storyId: candidate.project.storyId,
            revision: candidate.project.revision,
            status: candidate.project.status,
            sourceStoryRevision: candidate.project.sourceStoryRevision,
            sourceStoryBibleVersion: candidate.project.sourceStoryBibleVersion,
            projectionOutputHash: candidate.project.projectionTrace.outputHash,
          },
          mediaPrompt: [
            `把「${data.project.title}」的核准改編製作成一段 8 秒測試鏡頭。`,
            firstScene.visualAction,
            ...firstScene.continuityConstraints.map((constraint) => constraint.description),
          ].join("\n"),
          durationSeconds: 8,
          resolution: "720p",
          ratio: "16:9",
          adultNamespace: "general",
          externalConsent: true,
          costConfirmed: true,
        }),
      });
      const payload = await response.json().catch(() => null) as null | {
        jobId?: string;
        status?: string;
        code?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload?.message || "影片工作沒有建立；沒有產生 MP4。");
      }
      setMessage(payload?.jobId
        ? `Seedance 工作 ${payload.jobId} 已建立（${payload.status ?? "queued"}）；完成前不會顯示 MP4。`
        : "影片工作已建立；完成與成品驗證前不會顯示 MP4。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "影片工作沒有建立；沒有產生 MP4。");
    } finally {
      setVideoBusy(false);
    }
  }

  function downloadVideoProductionPackage() {
    if (!candidate || !data || candidate.project.status !== "approved") {
      setMessage("請先核准短劇改編，再建立外接影片製作包。");
      return;
    }
    const mode = candidatePlaybackMode ?? "linear";
    const mediaCandidate = createStoryMediaCandidatePackage({
      packageId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      projectId: data.project.id,
      projectRevision: String(data.project.revision),
      task: "scene_to_video_prompt",
      sourceRefs: data.chapters.map((chapter) => ({
        sourceType: "chapter" as const,
        sourceId: chapter.id,
        revision: String(chapter.revision),
        evidenceExcerpt: null,
      })),
      characterContinuityRefs: data.characters.map((character) => character.id),
      worldContinuityRefs: data.worldRules.map((rule) => rule.id),
      storyboard: candidate.scenes.map((scene) => ({
        shotId: scene.sceneId,
        sourceRefIds: [...new Set(scene.sourceReferences.map((reference) => reference.chapterId))],
        visualIntent: scene.visualAction,
        continuityNotes: scene.continuityConstraints.map((constraint) => constraint.description),
      })),
      mediaPrompt: `把「${data.project.title}」製作成${mode === "interactive" ? "互動分支" : "線性"}${FORMAT_LABELS[candidate.project.formatProfile]}；維持角色外觀、服裝、場景、時間線與鏡位連續性。`,
      adultNamespace: data.project.adultMode ? "adult_verified" : "general",
      externalConsent: false,
    });
    const handoff = {
      schemaVersion: "novel-video-production-handoff-v1",
      exportedAt: new Date().toISOString(),
      playbackMode: mode,
      providerExecution: "not_connected",
      installedAdapters: ["byteplus-las-seedance-2.5-server-contract"],
      suggestedProviderFamilies: ["Seedance", "Runway", "Sora", "Veo"],
      generatedVideo: false,
      artifactMimeType: null,
      mediaCandidate,
      approvedDrama: {
        project: candidate.project,
        episodes: candidate.episodes,
        scenes: candidate.scenes,
        beats: candidate.beats,
        branches: mode === "interactive" ? candidate.branchCandidates : [],
      },
    };
    const blob = new Blob([`${JSON.stringify(handoff, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeTitle = data.project.title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").slice(0, 60) || "novel";
    anchor.href = href;
    anchor.download = `${safeTitle}-video-production-handoff.json`;
    anchor.click();
    URL.revokeObjectURL(href);
    setMessage("JSON 交接資料已下載；這不是影片，也沒有產生或下載 MP4。");
  }

  const evaluation = candidate?.evaluations[0];
  const profile = useMemo(() => getDramaFormatProfile(format), [format]);
  const candidateProfile = useMemo(
    () => candidate ? getDramaFormatProfile(candidate.project.formatProfile) : null,
    [candidate],
  );
  const videoRuntimeReady = videoRuntime.health?.configured === true;
  const videoCanSubmit = videoRuntimeReady
    && candidate?.project.status === "approved"
    && !data?.project.adultMode
    && externalVideoConsent
    && videoCostConfirmed
    && !videoBusy;

  if (!data) return <main className="p2ProjectShell"><p role="status">{message}</p></main>;
  return (
    <main className="p2ProjectShell">
      <header><Link href={`/professional?intent=library&projectId=${encodeURIComponent(projectId)}`}>← 作品管理中心</Link><div><small>{data.project.title}</small><h1>小說轉短劇</h1></div><span>原作與改編分開保存</span></header>
      <ProjectNavigation projectId={projectId} active="drama" />
      <section className={`${styles.root} dramaWorkspace`}>
        <header>
          <div><span>DRAMA OS</span><h2>把正式章節整理成可核准的短劇分鏡</h2><p>系統會讀取章節、角色、世界規則與時間線。建立候選不會直接改動小說正史。</p></div>
          <label>目標長度<select value={format} onChange={(event) => setFormat(event.target.value as DramaFormatProfileId)}>{listDramaFormatProfiles().map((item) => <option key={item.id} value={item.id}>{FORMAT_LABELS[item.id]}</option>)}</select></label>
          <button className="gold" disabled={busy || data.chapters.length === 0} onClick={() => void generate()}>{busy ? "正在規劃……" : candidate ? "重新生成" : "建立改編候選"}</button>
          <Link href={`/studio/project/${encodeURIComponent(projectId)}/closed-ai?task=drama.episodePlan&objective=${encodeURIComponent(`把目前作品強化為${FORMAT_LABELS[format]}，檢查開場 Hook、衝突、轉折、角色動機、連續性與代價。`)}`}>
            用閉端 AI 強化改編
          </Link>
        </header>
        <section className="dramaModePicker" aria-label="短劇播放方式">
          <div><small>播放方式</small><strong>先決定觀眾會不會在播放途中選路線</strong></div>
          <button type="button" className={playbackMode === "linear" ? "active" : ""} aria-pressed={playbackMode === "linear"} disabled={busy} onClick={() => setPlaybackMode("linear")}>
            <b>一般線性短劇</b><span>作者在製作前定稿；觀眾從頭看到尾，不顯示 ABC。</span>
          </button>
          <button type="button" className={playbackMode === "interactive" ? "active" : ""} aria-pressed={playbackMode === "interactive"} disabled={busy} onClick={() => setPlaybackMode("interactive")}>
            <b>互動短劇</b><span>ABC 只出現在集尾；觀眾選擇後播放對應下一段。</span>
          </button>
        </section>
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
              <article><small>播放型態</small><strong>{candidatePlaybackMode === "interactive" ? "互動" : "線性"}</strong><span>{candidatePlaybackMode === "interactive" ? "集尾才顯示 ABC" : "成片不顯示選項"}</span></article>
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
            {candidatePlaybackMode === "interactive"
              ? <section className="dramaBranches"><h2>集尾互動選項</h2><p>這不是邊選邊拍；製作時先生成各分支片段，播放時觀眾在集尾選 ABC，再銜接對應下一段。</p><div>{candidate.branchCandidates[0]?.choices.map((choice) => <article key={choice.key}><b>{choice.key}</b><h3>{choice.label}</h3><p>{choice.action}</p><small>{choice.consequence}</small></article>)}</div></section>
              : <section className="dramaLinearNotice"><h2>一般短劇不顯示 ABC</h2><p>目前集數與場景就是固定播放路線。若要比較不同走向，請在製作前重新生成候選，不會讓觀眾在成片中途作答。</p></section>}
            {evaluation?.issues.length ? <section className="dramaRisks"><h2>風險提示</h2><ul>{evaluation.issues.map((issue, index) => <li key={`${issue.code}:${index}`}>{issue.message}</li>)}</ul></section> : null}
            <footer className="dramaActions">
              <button className="gold" disabled={busy || candidate.project.status === "approved" || Boolean(evaluation?.blockingIssueCount)} onClick={() => void approve()}>{candidate.project.status === "approved" ? "已核准改編" : "接受並建立改編版本"}</button>
              <button disabled={busy} onClick={() => void generate()}>再產生一份</button>
              <button disabled={busy} onClick={() => {
                setExternalVideoConsent(false);
                setVideoCostConfirmed(false);
                setCandidate(null);
                setCandidatePlaybackMode(null);
                setMessage("已放棄畫面上的候選；正式作品沒有變更。");
              }}>放棄</button>
            </footer>
            <details className="dramaTechnical"><summary>查看技術資訊</summary><dl><div><dt>執行方式</dt><dd>本機規則式戲劇規劃</dd></div><div><dt>正式小說寫入</dt><dd>{candidate.canonicalMutation}</dd></div><div><dt>來源版本</dt><dd>{candidate.project.sourceStoryRevision}</dd></div><div><dt>目標秒數</dt><dd>{candidateProfile?.targetDurationSeconds}</dd></div><div><dt>Hook 時限</dt><dd>{candidateProfile?.openingHookDeadlineSeconds}</dd></div><div><dt>衝突間隔</dt><dd>{candidateProfile?.conflictIntervalSeconds}</dd></div><div><dt>轉折間隔</dt><dd>{candidateProfile?.reversalIntervalSeconds}</dd></div><div><dt>最低 Payoff</dt><dd>{candidateProfile?.minimumPayoffCount}</dd></div><div><dt>搜尋前文紀錄</dt><dd>{candidate.project.projectionTrace.retrievalTraceId}</dd></div><div><dt>內容指紋</dt><dd>{candidate.project.projectionTrace.outputHash}</dd></div></dl></details>
          </>
        )}
        <section id="video-production" className="dramaVideoPipeline">
          <div>
            <small>BYTEPLUS LAS · VIDEO RUNTIME STATUS</small>
            <h2>{videoRuntime.loading
              ? "正在確認 Seedance 2.5 連接狀態"
              : videoRuntimeReady
                ? "Seedance 2.5 已具備安全送件條件"
                : "Seedance 2.5 已安裝，但尚未可送件"}</h2>
            <p>模型：{videoRuntime.health?.model ?? "dreamina-seedance-2-5-260628"}。API 金鑰只由伺服器讀取；瀏覽器只會收到是否完成各項設定的布林值，不會收到密鑰。</p>
          </div>
          <ol>
            <li>伺服器憑證：{videoRuntime.health?.credentialConfigured ? "已設定" : "未設定或不在允許清單"}；永久工作儲存：{videoRuntime.health?.jobStoreConfigured ? "已設定" : "尚未設定"}；私有成品驗證儲存：{videoRuntime.health?.artifactStoreConfigured ? "已設定" : "尚未設定"}。</li>
            <li>第一階段每次只準備 8 秒、720p、16:9 的核准場景測試鏡頭，不代表完整短劇。</li>
            <li>必須先核准改編、同意資料離開本機並確認外部費用；完成後仍要通過 MP4 驗證才能稱為影片成品。</li>
          </ol>
          <div className="dramaVideoConsents">
            <label><input type="checkbox" checked={externalVideoConsent} disabled={videoBusy || candidate?.project.status !== "approved"} onChange={(event) => setExternalVideoConsent(event.target.checked)} />我同意核准場景、連續性要求與提示詞會送往 BytePlus，資料將離開本機。</label>
            <label><input type="checkbox" checked={videoCostConfirmed} disabled={videoBusy || candidate?.project.status !== "approved"} onChange={(event) => setVideoCostConfirmed(event.target.checked)} />我知道 Seedance 工作可能依 BytePlus 當時費率收費，並確認要建立這次 8 秒測試工作。</label>
          </div>
          <button type="button" disabled={!videoCanSubmit} onClick={() => void submitVideoGeneration()}>{videoBusy ? "正在建立工作……" : "送出 Seedance 2.5 測試工作"}</button>
          <button type="button" disabled={busy || candidate?.project.status !== "approved"} onClick={downloadVideoProductionPackage}>下載 JSON 交接資料（非影片）</button>
          <small>{candidate?.project.status !== "approved"
            ? "先建立並核准短劇候選，才可下載非影片的交接資料或準備外部工作。"
            : data.project.adultMode
              ? "第一階段不會把成人內容送往 Seedance；仍可下載不會執行的 JSON 交接資料。"
              : videoRuntimeReady
                ? "完成兩項確認後才可送件；按一下只會建立一個可追蹤工作，不會立即宣稱已有 MP4。"
                : "目前仍可下載 JSON；影片按鈕會保持停用，也不會呼叫付費供應商。"}</small>
        </section>
      </section>
    </main>
  );
}
