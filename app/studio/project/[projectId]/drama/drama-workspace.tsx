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
import { resolveProjectStoryBible } from "@/lib/novel-ai/domain/story-bible-selection";
import {
  createStoryMediaCandidatePackage,
  createVideoProductionHandoffPackage,
  createVideoProductionPlan,
  getVideoProvider,
  listVideoProviders,
  videoProviderSubmissionGate,
  type VideoProductionJobStatus,
  type VideoProviderDescriptor,
} from "@/lib/novel-ai/media-extension";
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
  schemaVersion?: string;
  configured: boolean;
  executionProviderId?: string | null;
  model: string;
  credentialConfigured: boolean;
  jobStoreConfigured: boolean;
  artifactStoreConfigured: boolean;
  executionBlockedReason?: string;
  providers?: VideoProviderDescriptor[];
};

type VideoRuntimeState = {
  loading: boolean;
  health: VideoRuntimeHealth | null;
};

type VideoJobState = {
  jobId: string;
  projectId: string;
  status: VideoProductionJobStatus;
  model: string;
  createdAt: string;
  updatedAt: string;
};

const VIDEO_JOB_STORAGE_PREFIX = "novel:video-production-job:v2:";
const VIDEO_PROVIDERS = listVideoProviders();

function secondsLabel(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function videoProviderAvailabilityLabel(provider: VideoProviderDescriptor) {
  if (provider.availability === "ready") return "可執行";
  if (provider.availability === "requires_vendor_onboarding") return "需申請並完成串接";
  if (provider.availability === "contract_only") return "只有契約";
  if (provider.availability === "disabled") return "停用";
  return "尚未連接";
}

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
  const [selectedVideoProviderId, setSelectedVideoProviderId] = useState("seedance-2.5-official");
  const [shotDurations, setShotDurations] = useState<Record<string, number>>({});
  const [videoJob, setVideoJob] = useState<VideoJobState | null>(null);

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
    const storyBible = resolveProjectStoryBible(project, storyBibles);
    if (!project || !storyBible) throw new Error("找不到這本作品目前採用的正式 Story Bible。");
    setData({ project, chapters: chapters.sort((a, b) => a.order - b.order), characters, worldRules, timeline, storyBible });
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
            schemaVersion: typeof payload.schemaVersion === "string" ? payload.schemaVersion : undefined,
            configured: payload.configured,
            executionProviderId: typeof payload.executionProviderId === "string" ? payload.executionProviderId : null,
            model: payload.model,
            credentialConfigured: payload.credentialConfigured,
            jobStoreConfigured: payload.jobStoreConfigured,
            artifactStoreConfigured: payload.artifactStoreConfigured,
            executionBlockedReason: typeof payload.executionBlockedReason === "string" ? payload.executionBlockedReason : undefined,
            providers: Array.isArray(payload.providers) ? payload.providers : undefined,
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

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(`${VIDEO_JOB_STORAGE_PREFIX}${projectId}`);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<VideoJobState>;
        if (typeof parsed.jobId === "string" && parsed.projectId === projectId && typeof parsed.status === "string") {
          setVideoJob(parsed as VideoJobState);
        }
      } catch {
        // A privacy mode may block session storage. Polling still works for jobs
        // created during this mounted session.
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [projectId]);

  const activeVideoJobId = videoJob?.jobId ?? null;
  const activeVideoJobStatus = videoJob?.status ?? null;
  useEffect(() => {
    if (!activeVideoJobId || !activeVideoJobStatus || !["queued", "running"].includes(activeVideoJobStatus)) return;
    const controller = new AbortController();
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/media/video/jobs/${encodeURIComponent(activeVideoJobId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as Partial<VideoJobState> & { message?: string } | null;
        if (!response.ok || !payload?.jobId || payload.projectId !== projectId || typeof payload.status !== "string") {
          throw new Error(payload?.message || "影片工作狀態無法驗證。");
        }
        if (!active) return;
        const next = payload as VideoJobState;
        setVideoJob(next);
        try {
          sessionStorage.setItem(`${VIDEO_JOB_STORAGE_PREFIX}${projectId}`, JSON.stringify(next));
        } catch {
          // See restore note above.
        }
        setMessage(next.status === "succeeded"
          ? "影片供應商已回報完成；仍須通過私有 MP4 驗證，才會顯示成品。"
          : `影片工作 ${next.jobId}：${next.status}。`);
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : "影片工作狀態無法驗證。");
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [activeVideoJobId, activeVideoJobStatus, projectId]);

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
      setShotDurations(Object.fromEntries(result.scenes.map((scene) => [scene.sceneId, 8])));
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
      setMessage("請先核准短劇改編，再準備影片工作。");
      return;
    }
    const selectedProvider = getVideoProvider(selectedVideoProviderId);
    if (!selectedProvider?.executionReady || !videoRuntime.health?.configured) {
      setMessage(selectedProvider?.availability === "requires_vendor_onboarding"
        ? "Seedance 2.5 尚未完成供應商申請、端點驗證與伺服器轉接；本次沒有送出工作。"
        : "所選影片供應商尚未完成官方轉接器、永久工作儲存與成品驗證；本次沒有送出工作。");
      return;
    }
    if (!externalVideoConsent || !videoCostConfirmed) {
      setMessage("請先確認資料會離開本機，以及外部供應商可能收費。");
      return;
    }
    if (data.project.adultMode) {
      setMessage("目前不會把成人內容送往外部影片供應商。");
      return;
    }
    const firstScene = candidate.scenes[0];
    const firstShot = videoPlan?.shots[0];
    if (!firstScene || !firstShot || !videoPlan) {
      setMessage("核准改編沒有可供影片化的場景。");
      return;
    }
    setVideoBusy(true);
    try {
      const response = await fetch("/api/media/video/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "video-production-submit-v2",
          idempotencyKey: `video:${selectedVideoProviderId}:${candidate.project.dramaProjectId}:${candidate.project.revision}:first-shot`,
          projectId: data.project.id,
          providerId: selectedVideoProviderId,
          plan: {
            schemaVersion: videoPlan.schemaVersion,
            planId: videoPlan.planId,
            totalShots: videoPlan.shots.length,
            shot: { shotId: firstShot.shotId, order: firstShot.order },
          },
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
            `把「${data.project.title}」的核准改編製作成一段 ${firstShot.durationSeconds} 秒測試鏡頭。`,
            firstShot.visualPrompt,
            firstShot.cameraDirection,
            ...firstShot.continuityNotes,
          ].join("\n"),
          durationSeconds: firstShot.durationSeconds,
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
      if (payload?.jobId) {
        const now = new Date().toISOString();
        const next: VideoJobState = {
          jobId: payload.jobId,
          projectId: data.project.id,
          status: (payload.status as VideoProductionJobStatus | undefined) ?? "queued",
          model: selectedProvider.displayName,
          createdAt: now,
          updatedAt: now,
        };
        setVideoJob(next);
        try {
          sessionStorage.setItem(`${VIDEO_JOB_STORAGE_PREFIX}${projectId}`, JSON.stringify(next));
        } catch {
          // The current page can still poll even if persistence is unavailable.
        }
      }
      setMessage(payload?.jobId
        ? `影片工作 ${payload.jobId} 已建立（${payload.status ?? "queued"}）；完成前不會顯示 MP4。`
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
    if (!videoPlan) {
      setMessage("尚未建立可交接的逐鏡時間軸。");
      return;
    }
    const handoff = {
      ...createVideoProductionHandoffPackage({
        plan: videoPlan,
        selectedProvider,
        approvedDrama: {
        project: candidate.project,
        episodes: candidate.episodes,
        scenes: candidate.scenes,
        beats: candidate.beats,
        branches: mode === "interactive" ? candidate.branchCandidates : [],
        },
      }),
      mediaCandidate,
    };
    const blob = new Blob([`${JSON.stringify(handoff, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeTitle = data.project.title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").slice(0, 60) || "novel";
    anchor.href = href;
    anchor.download = `${safeTitle}-video-production-handoff.json`;
    anchor.click();
    URL.revokeObjectURL(href);
    setMessage("製作交接包 JSON 已下載；它是逐鏡與素材規格，不是影片，也沒有產生或下載 MP4。");
  }

  const evaluation = candidate?.evaluations[0];
  const profile = useMemo(() => getDramaFormatProfile(format), [format]);
  const candidateProfile = useMemo(
    () => candidate ? getDramaFormatProfile(candidate.project.formatProfile) : null,
    [candidate],
  );
  const selectedProvider = getVideoProvider(selectedVideoProviderId);
  const videoPlan = candidate && data && candidate.project.status === "approved"
    ? createVideoProductionPlan({
      planId: `video-plan:${candidate.project.dramaProjectId}:${candidate.project.revision}`,
      projectId: data.project.id,
      projectRevision: String(data.project.revision),
      approvedDramaId: candidate.project.dramaProjectId,
      approvedDramaRevision: candidate.project.revision,
      title: `${data.project.title}｜影片製作計畫`,
      playbackMode: candidatePlaybackMode ?? "linear",
      aspectRatio: "16:9",
      resolution: "720p",
      providerId: selectedProvider?.providerId ?? null,
      shots: candidate.scenes.map((scene) => ({
        shotId: scene.sceneId,
        episodeId: scene.episodeId,
        sourceSceneId: scene.sceneId,
        durationSeconds: shotDurations[scene.sceneId] ?? 8,
        visualPrompt: scene.visualAction,
        cameraDirection: `鏡頭 ${scene.sceneNumber}：以「${scene.sceneGoal}」為畫面目的，衝突為「${scene.conflict}」。`,
        dialogueOrAudioCue: scene.dialogueBlocks.length
          ? scene.dialogueBlocks.map((block) => `${block.speakerName}：${block.line}`).join("\n")
          : null,
        sourceRefIds: scene.sourceReferences.map((reference) => reference.chapterId),
        characterRefIds: scene.participatingCharacterIds,
        worldRefIds: [scene.locationId, ...data.worldRules.map((rule) => rule.id)].filter((value): value is string => Boolean(value)),
        continuityNotes: scene.continuityConstraints.map((constraint) => constraint.description),
      })),
      now: candidate.project.createdAt,
    })
    : null;
  const videoRuntimeReady = videoRuntime.health?.configured === true
    && videoRuntime.health.executionProviderId === selectedProvider?.providerId;
  const videoSubmissionGate = videoProviderSubmissionGate({
    provider: selectedProvider,
    plan: videoPlan,
    approvedDrama: candidate?.project.status === "approved",
    externalConsent: externalVideoConsent,
    costConfirmed: videoCostConfirmed,
    backendReady: videoRuntimeReady,
    adultNamespace: data?.project.adultMode ? "adult_verified" : "general",
  });
  const videoCanSubmit = videoSubmissionGate.allowed && !videoBusy;

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
                setShotDurations({});
                setCandidate(null);
                setCandidatePlaybackMode(null);
                setMessage("已放棄畫面上的候選；正式作品沒有變更。");
              }}>放棄</button>
            </footer>
            <details className="dramaTechnical"><summary>查看技術資訊</summary><dl><div><dt>執行方式</dt><dd>本機規則式戲劇規劃</dd></div><div><dt>正式小說寫入</dt><dd>{candidate.canonicalMutation}</dd></div><div><dt>來源版本</dt><dd>{candidate.project.sourceStoryRevision}</dd></div><div><dt>目標秒數</dt><dd>{candidateProfile?.targetDurationSeconds}</dd></div><div><dt>Hook 時限</dt><dd>{candidateProfile?.openingHookDeadlineSeconds}</dd></div><div><dt>衝突間隔</dt><dd>{candidateProfile?.conflictIntervalSeconds}</dd></div><div><dt>轉折間隔</dt><dd>{candidateProfile?.reversalIntervalSeconds}</dd></div><div><dt>最低 Payoff</dt><dd>{candidateProfile?.minimumPayoffCount}</dd></div><div><dt>搜尋前文紀錄</dt><dd>{candidate.project.projectionTrace.retrievalTraceId}</dd></div><div><dt>內容指紋</dt><dd>{candidate.project.projectionTrace.outputHash}</dd></div></dl></details>
          </>
        )}
        <section id="video-production" className="dramaVideoPipeline">
          <header className="dramaVideoHeader">
            <div>
              <small>VIDEO PRODUCTION HUB · PROVIDER-NEUTRAL V2</small>
              <h2>影片製作中樞</h2>
              <p>先把核准短劇整理成可編輯逐鏡時間軸，再由真正可用的官方 API 或自架 GPU worker 執行。JSON 只是一份製作交接包，永遠不會冒充 MP4。</p>
            </div>
            <label>製作供應商
              <select value={selectedVideoProviderId} disabled={videoBusy} onChange={(event) => {
                setSelectedVideoProviderId(event.target.value);
                setExternalVideoConsent(false);
                setVideoCostConfirmed(false);
              }}>
                {VIDEO_PROVIDERS.filter((provider) => provider.availability !== "disabled").map((provider) => (
                  <option key={provider.providerId} value={provider.providerId}>{provider.displayName}｜{videoProviderAvailabilityLabel(provider)}</option>
                ))}
              </select>
            </label>
          </header>

          {selectedProvider ? <section className="dramaProviderCard" data-provider-status={selectedProvider.availability}>
            <div><small>目前狀態</small><strong>{videoProviderAvailabilityLabel(selectedProvider)}</strong></div>
            <p>{selectedProvider.availabilityNote}</p>
            <ul>
              <li>文字轉影片：{selectedProvider.capabilities.textToVideo ? "支援規格" : "不支援"}</li>
              <li>圖像參考：{selectedProvider.capabilities.imageReferences ? "支援規格" : "不支援"}</li>
              <li>影片／音訊參考：{selectedProvider.capabilities.videoReferences || selectedProvider.capabilities.audioReferences ? "支援規格" : "不支援"}</li>
              <li>同步聲音：{selectedProvider.capabilities.synchronizedAudio ? "支援規格" : "不支援"}</li>
              <li>延長／時間點編修：{selectedProvider.capabilities.videoExtension || selectedProvider.capabilities.timestampEditing ? "支援規格" : "不支援"}</li>
              <li>單段上限：{selectedProvider.capabilities.maxClipSeconds ? `${selectedProvider.capabilities.maxClipSeconds} 秒` : "由供應商決定"}</li>
            </ul>
            {selectedProvider.publicProductUrl ? <a href={selectedProvider.publicProductUrl} target="_blank" rel="noreferrer">查看供應商公開產品頁</a> : null}
          </section> : null}

          {videoPlan ? <section className="dramaShotTimeline" aria-label="影片逐鏡時間軸">
            <header><div><small>SHOT TIMELINE</small><h3>逐鏡製作時間軸</h3></div><strong>{videoPlan.shots.length} 鏡 · {secondsLabel(videoPlan.totalDurationSeconds)}</strong></header>
            <p>每一鏡保留來源場景、角色、世界規則與連續性要求。調整秒數會自動重排後續時間碼；單次供應商工作仍須遵守其片段上限。</p>
            <div>
              {videoPlan.shots.map((shot) => <article key={shot.shotId}>
                <header><b>鏡 {String(shot.order).padStart(2, "0")}</b><span>{secondsLabel(shot.startSeconds)}–{secondsLabel(shot.startSeconds + shot.durationSeconds)}</span></header>
                <h4>{shot.visualPrompt}</h4>
                <p>{shot.cameraDirection}</p>
                {shot.dialogueOrAudioCue ? <details><summary>對白／聲音提示</summary><pre>{shot.dialogueOrAudioCue}</pre></details> : null}
                <details><summary>連續性 {shot.continuityNotes.length} 項</summary>{shot.continuityNotes.length ? <ul>{shot.continuityNotes.map((note) => <li key={note}>{note}</li>)}</ul> : <p>尚無額外限制。</p>}</details>
                <label>鏡頭秒數<input type="number" min="4" max="30" value={shot.durationSeconds} disabled={videoBusy} onChange={(event) => {
                  const next = Math.min(30, Math.max(4, Number(event.target.value) || 4));
                  setShotDurations((current) => ({ ...current, [shot.shotId]: next }));
                }} /></label>
              </article>)}
            </div>
          </section> : <section className="dramaVideoEmpty"><h3>尚未建立逐鏡時間軸</h3><p>先建立短劇候選並核准；影片製作中樞才會以每個場景建立時間軸，不會只抓第一幕當成完整影片。</p></section>}

          <section className="dramaRuntimeTruth">
            <div><small>後端執行狀態</small><strong>{videoRuntime.loading ? "驗證中" : videoRuntimeReady ? "可安全送件" : "不可送件"}</strong></div>
            <ol>
              <li>官方供應商轉接器：{videoRuntime.health?.executionProviderId ? "已連接" : "尚未連接"}。</li>
              <li>永久工作儲存：{videoRuntime.health?.jobStoreConfigured ? "已設定" : "尚未設定"}；私有成品驗證儲存：{videoRuntime.health?.artifactStoreConfigured ? "已設定" : "尚未設定"}。</li>
              <li>只有工作成功、下載至私有儲存並驗證 MIME、大小、時長與雜湊後，才會標示為 MP4 成品。</li>
            </ol>
          </section>

          {videoJob ? <section className="dramaVideoJob" role="status"><small>可追蹤影片工作</small><strong>{videoJob.jobId}</strong><span>{videoJob.status} · {videoJob.model}</span></section> : null}

          <div className="dramaVideoConsents">
            <label><input type="checkbox" checked={externalVideoConsent} disabled={videoBusy || candidate?.project.status !== "approved" || !selectedProvider?.executionReady} onChange={(event) => setExternalVideoConsent(event.target.checked)} />我同意核准場景、連續性要求與所選素材會送往「{selectedProvider?.displayName ?? "外部供應商"}」，資料將離開本機。</label>
            <label><input type="checkbox" checked={videoCostConfirmed} disabled={videoBusy || candidate?.project.status !== "approved" || !selectedProvider?.executionReady} onChange={(event) => setVideoCostConfirmed(event.target.checked)} />我已查看供應商當時費率與預估工作數，確認才送出付費工作。</label>
          </div>
          <div className="dramaVideoActions">
            <button type="button" disabled={!videoCanSubmit} onClick={() => void submitVideoGeneration()}>{videoBusy ? "正在建立工作……" : "送出至已連接的影片供應商"}</button>
            <button type="button" disabled={busy || !videoPlan} onClick={downloadVideoProductionPackage}>下載製作交接包 JSON（不是影片）</button>
          </div>
          <small>{candidate?.project.status !== "approved"
            ? "先建立並核准短劇候選，才可建立逐鏡時間軸。"
            : data.project.adultMode
              ? "目前不會把成人內容送往外部影片供應商；仍可下載不會執行的製作交接包。"
              : selectedProvider?.availability === "requires_vendor_onboarding"
                ? "Seedance 2.5 可由官方 Get API 入口申請；完成端點、模型識別、憑證與條款驗證前，可以先做逐鏡與素材規劃，送件按鈕保持停用。"
                : videoRuntimeReady
                  ? "完成兩項確認後才可送件；建立工作不等於已有 MP4。"
                  : "目前仍可下載製作交接包；影片按鈕保持停用，也不會呼叫付費供應商。"}</small>
        </section>
      </section>
    </main>
  );
}
