"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClosedAgentExecutionResult,
  ClosedAIProgressEvent,
} from "@/lib/novel-ai/closed-agent-os";
import type { PlatformTaskType } from "@/lib/novel-ai/router/platform-types";
import { makeRecord, type Chapter, type NovelProject } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import { mirrorChapterToLegacyStudio } from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import { completeStudioChapter } from "@/lib/novel-ai/repository/studio-canonical";
import {
  createSovereignLearningRepository,
  ingestFirstPartyProjectKnowledge,
} from "@/lib/novel-ai/sovereign-learning";
import {
  stageStudioTaskHandoff,
  studioHomeHref,
} from "@/lib/novel-ai/web/studio-task-session";
import {
  discoverStudioClosedAI,
  prewarmStudioInteractiveChoiceAI,
} from "@/lib/novel-ai/web/studio-closed-ai";
import {
  executeStudioClosedAgent,
  getStudioClosedAgentOS,
  prewarmStudioProjectAIState,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import { commitStudioCandidateToChapter } from "@/lib/novel-ai/web/studio-canonical-approval";
import {
  readStudioWritingResume,
  writeStudioWritingResume,
} from "@/lib/novel-ai/web/studio-writing-resume";
import ProjectNavigation from "../project-navigation";

type EditorSnapshot = {
  chapter: Chapter | null;
  project: NovelProject | null;
  title: string;
  content: string;
  summary: string;
  chapterStatus: Chapter["status"];
};

type WritingAIMode =
  | "continue"
  | "rewrite"
  | "rewrite-selection"
  | "dialogue"
  | "tension"
  | "pacing"
  | "hook";
type WritingAIRunProfile = "quick" | "compare" | "quality";
type WritingAIApplyMode = "append" | "replace" | "replace-selection";
type WritingAICandidateOption = {
  label: string;
  direction: string;
  mode: WritingAIMode;
  applyMode: WritingAIApplyMode;
  selection: { start: number; end: number } | null;
  result: ClosedAgentExecutionResult;
};

const WRITING_AI_TOOL_META: Record<WritingAIMode, {
  label: string;
  description: string;
  taskType: PlatformTaskType;
}> = {
  continue: { label: "續寫目前章節", description: "承接前後章、人物與正式設定，產生可核准的新正文。", taskType: "chapter.continue" },
  rewrite: { label: "整章改寫", description: "保留事件與因果，重寫目前整章。", taskType: "chapter.rewrite" },
  "rewrite-selection": { label: "改寫選取內容", description: "只替換你反白的文字，前後段保持原位。", taskType: "chapter.rewrite" },
  dialogue: { label: "加強人物對話", description: "補足說話目的、語氣與潛台詞。", taskType: "character.dialogue" },
  tension: { label: "增加情緒張力", description: "加強人物反應、代價與場景壓力。", taskType: "chapter.expand" },
  pacing: { label: "調整節奏", description: "整理冗句、場景轉折與資訊揭露速度。", taskType: "chapter.rewrite" },
  hook: { label: "製造章尾懸念", description: "承接本章最後事件，新增一個具體且可延續的章尾鉤子。", taskType: "chapter.continue" },
};

function snapshotIsDirty(snapshot: EditorSnapshot) {
  return snapshot.chapter
    ? snapshot.title !== snapshot.chapter.title
      || snapshot.content !== snapshot.chapter.content
      || snapshot.summary !== (snapshot.chapter.summary ?? "")
      || snapshot.chapterStatus !== snapshot.chapter.status
    : false;
}

function aiContextSummary(result: ClosedAgentExecutionResult | null) {
  const raw = result?.candidate.contextSourceSummary;
  if (!raw) return "等待建立脈絡證明";
  try {
    const parsed = JSON.parse(raw) as {
      counts?: Record<string, number>;
      includedSources?: string[];
      truncated?: boolean;
    };
    const counts = parsed.counts ?? {};
    const chapters = counts.chapters ?? 0;
    const characters = counts.characters ?? 0;
    const sources = parsed.includedSources?.length ?? 0;
    return `已讀取 ${chapters} 章、${characters} 名角色與 ${sources} 類正式資料${parsed.truncated ? "（依模型容量精準節錄）" : ""}`;
  } catch {
    return "已讀取正式作品脈絡並封存來源雜湊";
  }
}

async function syncChapterKnowledge(projectId: string, chapter: Chapter | null) {
  const sourceKey = `chapter:${chapter?.id || "missing"}`;
  await ingestFirstPartyProjectKnowledge(createSovereignLearningRepository(), {
    projectId,
    sourceKey,
    title: chapter ? `${chapter.title}／作品內創作` : "已刪除章節",
    content: chapter ? [
      `章節：${chapter.order}. ${chapter.title}`,
      `章節狀態：${chapter.status === "completed" ? "已完成" : "草稿"}`,
      chapter.summary ? `作者摘要：${chapter.summary}` : "",
      chapter.content,
    ].filter(Boolean).join("\n") : "",
  });
}

export default function WriteWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const closedAgentOS = useMemo(() => getStudioClosedAgentOS(), []);
  const [project, setProject] = useState<NovelProject | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const [chapterStatus, setChapterStatus] = useState<Chapter["status"]>("draft");
  const [status, setStatus] = useState("正在讀取作品…");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiCacheStatus, setAiCacheStatus] = useState("正在準備本作品的閉端 AI 脈絡…");
  const [guideOpen, setGuideOpen] = useState(true);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [editHistory, setEditHistory] = useState<string[]>([]);
  const [aiResult, setAiResult] = useState<ClosedAgentExecutionResult | null>(null);
  const [aiCandidateText, setAiCandidateText] = useState("");
  const [aiCandidates, setAiCandidates] = useState<WritingAICandidateOption[]>([]);
  const [aiCandidateTexts, setAiCandidateTexts] = useState<Record<string, string>>({});
  const [aiRunProfile, setAiRunProfile] = useState<WritingAIRunProfile>("quick");
  const [aiBusy, setAiBusy] = useState<WritingAIMode | "approve" | "reject" | null>(null);
  const [aiProgress, setAiProgress] = useState<ClosedAIProgressEvent | null>(null);
  const [aiMessage, setAiMessage] = useState("AI 會讀取目前章節、相鄰章節、角色、Story Bible 與 StoryState，再建立候選。");
  const [aiRuntimeStatus, setAiRuntimeStatus] = useState("正在自動偵測並預熱可用的閉端 AI……");
  const [aiDiscovering, setAiDiscovering] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const aiPanelRef = useRef<HTMLElement>(null);
  const saveQueueRef = useRef<Promise<Chapter | null>>(Promise.resolve(null));
  const cacheWarmTimerRef = useRef<number | null>(null);
  const cacheWarmControllerRef = useRef<AbortController | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const aiControllerRef = useRef<AbortController | null>(null);
  const aiDiscoveryControllerRef = useRef<AbortController | null>(null);
  const latestRef = useRef<EditorSnapshot>({
    chapter: null,
    project: null,
    title: "",
    content: "",
    summary: "",
    chapterStatus: "draft",
  });

  const currentSnapshot: EditorSnapshot = { chapter, project, title, content, summary, chapterStatus };
  const dirty = snapshotIsDirty(currentSnapshot);
  const hasPendingAICandidate = aiCandidates.some(
    (item) => item.result.candidate.status === "awaiting-approval",
  ) || aiResult?.candidate.status === "awaiting-approval";

  useEffect(() => {
    latestRef.current = { chapter, project, title, content, summary, chapterStatus };
  }, [chapter, chapterStatus, content, project, summary, title]);

  function applyChapter(next: Chapter) {
    setChapter(next);
    setTitle(next.title);
    setContent(next.content);
    setSummary(next.summary ?? "");
    setChapterStatus(next.status);
  }

  const restoreEditorPosition = useCallback((chapterId: string) => {
    const marker = readStudioWritingResume(projectId);
    if (!marker || marker.chapterId !== chapterId) return;
    window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const start = Math.min(marker.selectionStart, editor.value.length);
      const end = Math.min(Math.max(start, marker.selectionEnd), editor.value.length);
      editor.setSelectionRange(start, end);
      editor.scrollTop = marker.scrollTop;
      setSelection({ start, end });
      setStatus("已恢復上次保存的章節與編輯位置");
    }, 0);
  }, [projectId]);

  const rememberEditorPosition = useCallback((editor: HTMLTextAreaElement, chapterId = chapter?.id) => {
    if (!chapterId) return;
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    const snapshot = {
      projectId,
      chapterId,
      selectionStart: editor.selectionStart,
      selectionEnd: editor.selectionEnd,
      scrollTop: editor.scrollTop,
    };
    resumeTimerRef.current = window.setTimeout(() => {
      writeStudioWritingResume(snapshot);
      resumeTimerRef.current = null;
    }, 180);
  }, [chapter?.id, projectId]);

  const scheduleAICacheWarm = useCallback((target: Chapter, delay = 0) => {
    if (cacheWarmTimerRef.current !== null) window.clearTimeout(cacheWarmTimerRef.current);
    cacheWarmControllerRef.current?.abort("AI_CACHE_CONTEXT_REPLACED");
    const controller = new AbortController();
    cacheWarmControllerRef.current = controller;
    setAiCacheStatus("正在把目前章節與作品記憶預載到六層 AI Cache…");
    cacheWarmTimerRef.current = window.setTimeout(() => {
      cacheWarmTimerRef.current = null;
      void Promise.allSettled([
        prewarmStudioProjectAIState({
          projectId,
          taskTypes: ["chapter.continue"],
          sourceChapterId: target.id,
          sourceRevision: target.revision,
          signal: controller.signal,
        }),
        prewarmStudioInteractiveChoiceAI(controller.signal),
      ]).then(([cacheResult]) => {
        if (controller.signal.aborted) return;
        const warmed = cacheResult.status === "fulfilled" ? cacheResult.value[0] : null;
        setAiCacheStatus(warmed
          ? `六層 AI Cache 已就緒｜${target.title} r${target.revision}｜閉端 AI 可立即承接`
          : "章節已安全保存；閉端模型連線後會自動重建 AI Cache");
      });
    }, delay);
  }, [projectId]);

  const refreshAIRuntime = useCallback(async (signal?: AbortSignal) => {
    aiDiscoveryControllerRef.current?.abort("WRITING_RUNTIME_DISCOVERY_REPLACED");
    const controller = new AbortController();
    aiDiscoveryControllerRef.current = controller;
    const abortFromCaller = () => controller.abort(signal?.reason ?? "WRITING_RUNTIME_DISCOVERY_CANCELLED");
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort("WRITING_RUNTIME_DISCOVERY_TIMEOUT");
    }, 8_000);
    setAiDiscovering(true);
    setAiRuntimeStatus("正在自動偵測閉端 AI；不需要密碼、配對碼或跳轉設定頁……");
    try {
      const snapshot = await discoverStudioClosedAI(controller.signal);
      if (controller.signal.aborted) return snapshot;
      if (snapshot.status === "ollama_ready") {
        setAiRuntimeStatus(`本機 Ollama 已自動連線${snapshot.modelId ? ` · ${snapshot.modelId}` : ""}；寫作工具可直接執行。`);
      } else if (snapshot.status === "browser_ready") {
        setAiRuntimeStatus(`Browser AI 已自動就緒${snapshot.modelId ? ` · ${snapshot.modelId}` : ""}；寫作工具可直接執行。`);
      } else if (snapshot.status === "auth_required") {
        setAiRuntimeStatus("瀏覽器尚未授權本機網路；系統仍會直接嘗試已安裝的 Browser AI，不會把你送離寫作頁。");
      } else {
        setAiRuntimeStatus("目前未偵測到可執行模型。按寫作工具時會在原頁顯示真實原因，不會跳到設定或用模板冒充 AI。");
      }
      return snapshot;
    } catch (cause) {
      if (timedOut) {
        setAiRuntimeStatus("背景偵測逾時；寫作與儲存仍可使用。按 AI 工具時會直接嘗試可用執行器。");
      } else if (!controller.signal.aborted) {
        setAiRuntimeStatus(`自動偵測未完成：${cause instanceof Error ? cause.message : "請稍後重試"}。目前章節不受影響。`);
      }
      return null;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
      if (aiDiscoveryControllerRef.current === controller) {
        aiDiscoveryControllerRef.current = null;
        setAiDiscovering(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshAIRuntime();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      aiDiscoveryControllerRef.current?.abort("WRITING_RUNTIME_DISCOVERY_UNMOUNTED");
    };
  }, [projectId, refreshAIRuntime]);

  useEffect(() => () => {
    if (cacheWarmTimerRef.current !== null) window.clearTimeout(cacheWarmTimerRef.current);
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    cacheWarmControllerRef.current?.abort("WRITING_WORKSPACE_UNMOUNTED");
    aiControllerRef.current?.abort("WRITING_WORKSPACE_UNMOUNTED");
    aiDiscoveryControllerRef.current?.abort("WRITING_WORKSPACE_UNMOUNTED");
  }, []);

  const load = useCallback(async () => {
    try {
      const repo = createNovelRepository();
      const [nextProject, nextChapters] = await Promise.all([
        repo.get<NovelProject>("projects", projectId),
        repo.list<Chapter>("chapters", projectId),
      ]);
      if (!nextProject) {
        setProject(null);
        setStatus("找不到作品");
        return;
      }
      const ordered = nextChapters.sort((left, right) => left.order - right.order);
      let active = ordered.find((item) => item.id === nextProject.activeChapterId) ?? ordered[0] ?? null;
      if (!active) {
        active = await repo.put<Chapter>("chapters", {
          ...makeRecord(projectId),
          title: "第一章",
          order: 1,
          content: "",
          summary: null,
          status: "draft",
        });
        ordered.push(active);
        const updatedProject = await repo.put<NovelProject>("projects", {
          ...nextProject,
          activeChapterId: active.id,
        }, nextProject.revision);
        setProject(updatedProject);
      } else {
        setProject(nextProject);
      }
      setChapters(ordered);
      applyChapter(active);
      setStatus(`已載入上次保存的「${active.title}」`);
      restoreEditorPosition(active.id);
      scheduleAICacheWarm(active);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "讀取失敗");
    } finally {
      setLoaded(true);
    }
  }, [projectId, restoreEditorPosition, scheduleAICacheWarm]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (!loaded) return;
    const query = new URLSearchParams(window.location.search);
    if (query.get("assistant") !== "advanced" && window.location.hash !== "#writing-ai") return;
    const timer = window.setTimeout(() => {
      aiPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [loaded]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && !hasPendingAICandidate) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, hasPendingAICandidate]);

  const save = useCallback((announce = true) => {
    const operation = saveQueueRef.current
      .catch(() => null)
      .then(async () => {
        const snapshot = latestRef.current;
        if (!snapshot.chapter) return null;
        if (!snapshotIsDirty(snapshot)) {
          if (announce) setStatus("目前章節已是最新版本。");
          return snapshot.chapter;
        }
        if (!snapshot.title.trim()) {
          setStatus("章節標題不能留白，尚未離開本頁。");
          return null;
        }
        setSaving(true);
        if (announce) setStatus("正在安全儲存目前章節…");
        const repo = createNovelRepository();
        const saved = await repo.put<Chapter>("chapters", {
          ...snapshot.chapter,
          title: snapshot.title.trim(),
          content: snapshot.content,
          summary: snapshot.summary.trim() || null,
          status: snapshot.chapterStatus,
        }, snapshot.chapter.revision);
        // Saving content must never select a chapter. Chapter selection is a
        // separate operation, otherwise a slower autosave can pull the editor
        // back from chapter five to chapter one.
        const nextProject = snapshot.project;
        setChapters((items) => items
          .map((item) => item.id === saved.id ? saved : item)
          .sort((left, right) => left.order - right.order));
        setChapter((current) => current?.id === saved.id ? saved : current);
        latestRef.current = {
          ...latestRef.current,
          chapter: saved,
          project: nextProject ?? latestRef.current.project,
        };
        mirrorChapterToLegacyStudio(projectId, saved.title, saved.content);
        void syncChapterKnowledge(projectId, saved).catch(() => undefined);
        scheduleAICacheWarm(saved, 900);
        const editor = editorRef.current;
        if (editor) rememberEditorPosition(editor, saved.id);
        setStatus(`${announce ? "已儲存" : "已自動儲存"} ${new Date().toLocaleTimeString("zh-TW")}`);
        return saved;
      })
      .catch((cause) => {
        setStatus(`儲存失敗：${cause instanceof Error ? cause.message : "請重新載入後再試"}。內容仍留在本頁，尚未跳轉。`);
        return null;
      })
      .finally(() => setSaving(false));
    saveQueueRef.current = operation;
    return operation;
  }, [projectId, rememberEditorPosition, scheduleAICacheWarm]);

  useEffect(() => {
    if (!loaded || busy || saving || !dirty || !title.trim()) return;
    const timer = window.setTimeout(() => void save(false), 1_200);
    return () => window.clearTimeout(timer);
  }, [busy, chapterStatus, content, dirty, loaded, save, saving, summary, title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  async function allowTransitionAfterSave(destination: string) {
    if (!snapshotIsDirty(latestRef.current)) return true;
    const saved = await save(false);
    if (saved && !snapshotIsDirty(latestRef.current)) return true;
    const discard = window.confirm(
      `目前內容無法安全儲存，因此尚未前往「${destination}」。\n\n只有按下「確定」才會放棄本次未保存修改；按「取消」會留在原頁。`,
    );
    if (!discard) {
      setStatus("已留在目前章節；未保存內容仍在編輯器中。");
      return false;
    }
    return true;
  }

  function clearAICandidateState(message?: string) {
    setAiCandidates([]);
    setAiCandidateTexts({});
    setAiResult(null);
    setAiCandidateText("");
    setAiProgress(null);
    if (message) setAiMessage(message);
  }

  function pendingAIResults() {
    const unique = new Map<string, ClosedAgentExecutionResult>();
    for (const item of aiCandidates) unique.set(item.result.candidate.id, item.result);
    if (aiResult) unique.set(aiResult.candidate.id, aiResult);
    return [...unique.values()].filter((item) => item.candidate.status === "awaiting-approval");
  }

  async function rejectPendingAICandidates(message?: string) {
    const pending = pendingAIResults();
    await Promise.allSettled(pending.map((item) => closedAgentOS.rejectCandidate(item.candidate.id)));
    clearAICandidateState(message);
  }

  async function allowCandidateTransition(destination: string) {
    if (!hasPendingAICandidate) return true;
    const abandonCandidate = window.confirm(
      `目前有 ${Math.max(1, pendingAIResults().length)} 份尚未核准的 AI 候選，而且都綁定「${latestRef.current.title}」。\n\n按「確定」會放棄候選、保留正式正文並前往「${destination}」；按「取消」會留在本章。`,
    );
    if (!abandonCandidate) {
      setStatus("已留在目前章節；AI 候選與正式正文都沒有變更。");
      return false;
    }
    await rejectPendingAICandidates("AI 候選已放棄；正式正文沒有變更。");
    return true;
  }

  async function navigateSafely(href: string, destination: string) {
    if (busy || aiBusy) return;
    const target = new URL(href, window.location.href);
    const writingPath = `/studio/project/${encodeURIComponent(projectId)}/write`;
    if (target.pathname === writingPath && (target.searchParams.get("assistant") === "advanced" || target.hash === "#writing-ai")) {
      if (!await allowTransitionAfterSave("AI 寫作助手")) return;
      window.history.replaceState({}, "", `${target.pathname}${target.search}${target.hash}`);
      aiPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setStatus("已在同一個寫作視窗開啟 AI 助手；目前章節與候選都保持不變。");
      return;
    }
    setBusy(true);
    try {
      if (!await allowCandidateTransition(destination)) return;
      if (!await allowTransitionAfterSave(destination)) return;
      window.sessionStorage.setItem(`novel-writing-return:${projectId}`, JSON.stringify({
        chapterId: latestRef.current.chapter?.id ?? null,
        href: `/studio/project/${projectId}/write`,
        savedAt: new Date().toISOString(),
      }));
      if (href === studioHomeHref(projectId) || href === "/studio") {
        router.push(studioHomeHref(projectId));
        return;
      }
      stageStudioTaskHandoff({
        projectId,
        sourceLabel: "章節寫作",
        destinationLabel: destination,
        destinationHref: href,
        chapterId: latestRef.current.chapter?.id ?? null,
        chapterTitle: latestRef.current.title,
      });
      router.push(href);
    } finally {
      setBusy(false);
    }
  }

  async function selectChapter(next: Chapter) {
    if (next.id === chapter?.id || busy) return;
    setBusy(true);
    try {
      if (!await allowCandidateTransition(next.title)) return;
      if (!await allowTransitionAfterSave(next.title)) return;
      const repo = createNovelRepository();
      const [freshProject, freshTarget] = await Promise.all([
        repo.get<NovelProject>("projects", projectId),
        repo.get<Chapter>("chapters", next.id),
      ]);
      if (!freshProject || !freshTarget || freshTarget.projectId !== projectId) {
        throw new Error("找不到要切換的章節；目前章節保持不變。");
      }
      let nextProject = freshProject;
      if (nextProject && nextProject.activeChapterId !== next.id) {
        nextProject = await repo.put<NovelProject>("projects", {
          ...nextProject,
          activeChapterId: next.id,
        }, nextProject.revision);
        setProject(nextProject);
      }
      applyChapter(freshTarget);
      mirrorChapterToLegacyStudio(projectId, freshTarget.title, freshTarget.content);
      setStatus(`已叫出 ${freshTarget.title} 的獨立內容`);
      restoreEditorPosition(freshTarget.id);
      scheduleAICacheWarm(freshTarget);
    } catch (cause) {
      setStatus(`切換失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function createChapter() {
    if (busy) return;
    if (!project || !chapter) {
      setStatus("尚未載入目前章節，沒有建立新章。");
      return;
    }
    if (chapterStatus !== "completed") {
      setStatus("請先使用下方的「完成本章並建立下一章」；未完成的章節不會再建立空白下一章。");
      return;
    }
    const existingNext = chapters.find((item) => item.order === chapter.order + 1) ?? null;
    if (existingNext) {
      await selectChapter(existingNext);
      return;
    }
    setBusy(true);
    if (!await allowCandidateTransition("新章節")) {
      setBusy(false);
      return;
    }
    if (dirty) {
      const saved = await save(false);
      if (!saved || snapshotIsDirty(latestRef.current)) {
        setBusy(false);
        setStatus("目前章節尚未安全儲存，因此沒有建立新章；內容仍在原章。");
        return;
      }
    }
    try {
      const repo = createNovelRepository();
      const order = chapter.order + 1;
      const next = await repo.put<Chapter>("chapters", {
        ...makeRecord(projectId),
        title: `第${order}章`,
        order,
        content: "",
        summary: null,
        status: "draft",
      });
      let nextProject = project;
      if (nextProject) {
        nextProject = await repo.put<NovelProject>("projects", {
          ...nextProject,
          activeChapterId: next.id,
        }, nextProject.revision);
        setProject(nextProject);
      }
      setChapters((items) => [...items, next].sort((left, right) => left.order - right.order));
      applyChapter(next);
      setStatus(`已建立空白的「${next.title}」；上一章保持完成狀態。`);
    } catch (cause) {
      setStatus(`建立章節失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function completeChapterAndCreateNext() {
    if (!project || !chapter || busy || aiBusy) return;
    if (!title.trim()) {
      setStatus("章節標題不能留白，尚未完成本章。");
      return;
    }
    if (!content.trim()) {
      setStatus("本章尚無正文，沒有完成或建立下一章。請先寫入內容，或切回尚未完成的章節。");
      editorRef.current?.focus();
      return;
    }
    if (!await allowCandidateTransition("完成本章")) return;
    setBusy(true);
    setStatus("正在保存、完成並備份目前章節……");
    try {
      await saveQueueRef.current.catch(() => null);
      const snapshot = latestRef.current;
      if (!snapshot.project || !snapshot.chapter) throw new Error("找不到目前章節，沒有建立下一章。");
      const repo = createNovelRepository();
      const result = await completeStudioChapter(repo, {
        projectId,
        chapterId: snapshot.chapter.id,
        chapterTitle: snapshot.title,
        draft: snapshot.content,
        createFullBackup: true,
      });
      const nextChapters = [
        ...chapters.filter((item) => item.id !== result.completedChapter.id && item.id !== result.nextChapter.id),
        result.completedChapter,
        result.nextChapter,
      ].sort((left, right) => left.order - right.order);
      setChapters(nextChapters);
      setProject(result.nextProject);
      applyChapter(result.nextChapter);
      latestRef.current = {
        chapter: result.nextChapter,
        project: result.nextProject,
        title: result.nextChapter.title,
        content: result.nextChapter.content,
        summary: result.nextChapter.summary ?? "",
        chapterStatus: result.nextChapter.status,
      };
      mirrorChapterToLegacyStudio(projectId, result.completedChapter.title, result.completedChapter.content);
      void syncChapterKnowledge(projectId, result.completedChapter).catch(() => undefined);
      scheduleAICacheWarm(result.nextChapter, 300);
      setStatus(result.reusedNextChapter
        ? `「${result.completedChapter.title}」已完成並建立可還原備份；已回到既有的「${result.nextChapter.title}」，沒有重複建立空白章。`
        : `「${result.completedChapter.title}」已完成並建立可還原備份；現在是空白的「${result.nextChapter.title}」。`);
    } catch (cause) {
      setStatus(`完成章節失敗：${cause instanceof Error ? cause.message : "沒有建立下一章"}。目前內容仍留在原章。`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteChapter() {
    if (!chapter || busy) return;
    if (chapters.length <= 1) {
      setStatus("作品至少需要保留一章；可以清空正文，但不能刪除最後一章。");
      return;
    }
    if (!confirm(`確定刪除「${chapter.title}」嗎？這個操作不會刪除其他章節。`)) return;
    setBusy(true);
    try {
      if (!await allowCandidateTransition("刪除本章")) return;
      const repo = createNovelRepository();
      await repo.remove("chapters", chapter.id);
      void ingestFirstPartyProjectKnowledge(createSovereignLearningRepository(), {
        projectId,
        sourceKey: `chapter:${chapter.id}`,
        title: `${chapter.title}／已刪除章節`,
        content: "",
      }).catch(() => undefined);
      const remaining = chapters.filter((item) => item.id !== chapter.id);
      const next = remaining.find((item) => item.order > chapter.order)
        ?? remaining.at(-1)!;
      let nextProject = project;
      if (nextProject) {
        nextProject = await repo.put<NovelProject>("projects", {
          ...nextProject,
          activeChapterId: next.id,
        }, nextProject.revision);
        setProject(nextProject);
      }
      setChapters(remaining);
      applyChapter(next);
      mirrorChapterToLegacyStudio(projectId, next.title, next.content);
      setStatus("章節已刪除。");
    } catch (cause) {
      setStatus(`刪除章節失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  function applyContentTransform(nextContent: string, caret: number) {
    if (nextContent === content) return;
    setEditHistory((items) => [...items.slice(-19), content]);
    setContent(nextContent);
    setSelection({ start: caret, end: caret });
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(caret, caret);
    });
  }

  function insertAtSelection(value: string) {
    const start = Math.max(0, Math.min(content.length, selection.start));
    const end = Math.max(start, Math.min(content.length, selection.end));
    const next = `${content.slice(0, start)}${value}${content.slice(end)}`;
    applyContentTransform(next, start + value.length);
  }

  function deleteCurrentParagraph() {
    if (!content) return;
    const selectedStart = Math.max(0, Math.min(content.length, selection.start));
    const selectedEnd = Math.max(selectedStart, Math.min(content.length, selection.end));
    const startMarker = content.lastIndexOf("\n\n", Math.max(0, selectedStart - 1));
    const endMarker = content.indexOf("\n\n", selectedEnd);
    const start = selection.start !== selection.end ? selectedStart : startMarker < 0 ? 0 : startMarker + 2;
    const end = selection.start !== selection.end ? selectedEnd : endMarker < 0 ? content.length : endMarker + 2;
    const preview = content.slice(start, end).trim().slice(0, 80);
    if (!window.confirm(`確定刪除${selection.start !== selection.end ? "選取文字" : "目前段落"}${preview ? `「${preview}${content.slice(start, end).trim().length > 80 ? "…" : ""}」` : ""}？`)) return;
    applyContentTransform(`${content.slice(0, start)}${content.slice(end)}`, start);
    setStatus("已從草稿移除指定內容；自動儲存前仍可按「復原工具操作」。");
  }

  function undoToolEdit() {
    const previous = editHistory.at(-1);
    if (previous == null) return;
    setEditHistory((items) => items.slice(0, -1));
    setContent(previous);
    const caret = Math.min(previous.length, selection.start);
    setSelection({ start: caret, end: caret });
    window.requestAnimationFrame(() => editorRef.current?.setSelectionRange(caret, caret));
    setStatus("已復原上一次段落工具操作。");
  }

  async function runInlineWritingAI(mode: WritingAIMode, profile: WritingAIRunProfile = "quick") {
    if (aiBusy || busy || !chapter) return;
    if (mode === "rewrite-selection" && selection.start === selection.end) {
      setAiMessage("請先在正文反白要改寫的文字；系統只會替換該範圍，不會動到其他段落。");
      editorRef.current?.focus();
      return;
    }
    setAiRunProfile(profile);
    setAiBusy(mode);
    setAiProgress(null);
    setAiMessage(profile === "compare"
      ? "正在保存目前章節；三個方向會逐份完成、逐份顯示，不必等全部生成。"
      : "正在保存目前章節，再由 Closed Agent OS 組合前後章、角色、Story Bible 與 StoryState。");
    const controller = new AbortController();
    aiControllerRef.current = controller;
    let completed = 0;
    try {
      await rejectPendingAICandidates();
      const sourceChapter = await save(false);
      if (!sourceChapter) throw new Error("目前章節尚未安全儲存，因此沒有送出 AI 工作。");
      await refreshAIRuntime(controller.signal);
      const taskType = WRITING_AI_TOOL_META[mode].taskType;
      const qualityMode = profile === "quality" ? "balanced" : "fast";
      const selectedStart = Math.max(0, Math.min(sourceChapter.content.length, selection.start));
      const selectedEnd = Math.max(selectedStart, Math.min(sourceChapter.content.length, selection.end));
      const canUseSelection = selectedEnd > selectedStart
        && ["rewrite-selection", "dialogue", "tension", "pacing"].includes(mode);
      const targetSelection = canUseSelection
        ? { start: selectedStart, end: selectedEnd }
        : null;
      const targetText = targetSelection
        ? sourceChapter.content.slice(targetSelection.start, targetSelection.end)
        : sourceChapter.content;
      const applyMode: WritingAIApplyMode = mode === "continue" || mode === "hook"
        ? "append"
        : targetSelection
          ? "replace-selection"
          : "replace";
      const targetCharacters = profile === "quality"
        ? mode === "continue"
          ? Math.max(650, Math.min(1_000, Math.round(Math.max(sourceChapter.content.length, 650) * 0.9)))
          : mode === "hook"
            ? 260
            : Math.max(320, Math.min(1_200, targetText.replace(/\s/gu, "").length || 520))
        : mode === "continue"
          ? 420
          : mode === "hook"
            ? 180
            : Math.max(220, Math.min(700, targetText.replace(/\s/gu, "").length || 420));
      const directions = profile === "compare" && mode === "continue"
        ? [
          ["A · 穩健承接", "緊接上一個可見動作，優先延續人物目的與尚未解決的承諾。"],
          ["B · 衝突推進", "沿用同一場景與人物，讓既有阻力立刻升高並產生可見代價。"],
          ["C · 意外轉折", "使用前文已存在的人物、線索或物件形成合理轉折，不得憑空換世界。"],
        ]
        : [[profile === "quality" ? "完整品質稿" : "快速建議", "優先承接上一段行動與已核准設定，直接推進下一個有意義的事件。"]];
      const seeds = crypto.getRandomValues(new Uint32Array(directions.length));
      for (let index = 0; index < directions.length; index += 1) {
        if (controller.signal.aborted) break;
        const [label, direction] = directions[index];
        setAiMessage(`${label}：正在由真實模型建立候選${profile === "compare" ? `（${index + 1}/3）` : ""}。`);
        const objective = mode === "continue"
          ? [
            `承接「${sourceChapter.title}」最後一個可見動作、位置與情緒，續寫一個完整的新場景。`,
            `候選方向：${direction}`,
            `正文目標約 ${targetCharacters} 個繁體中文字，至少 ${Math.ceil(targetCharacters * 0.68)} 字；必須推進一個新事件、一次人物選擇與其直接後果。`,
            "不得摘要、重述前文、改名、換世界或用空泛句子湊字數；只輸出可接在本章末尾的正文。",
          ].join("\n")
          : mode === "hook"
            ? [
              `承接「${sourceChapter.title}」最後一個已發生事件，只新增一段可接在章尾的正文。`,
              `目標約 ${targetCharacters} 個繁體中文字；必須留下具體的新疑問、迫近代價或尚未完成的動作。`,
              "不得摘要全章、不得列出選項、不得憑空新增世界設定；只輸出章尾正文。",
            ].join("\n")
            : mode === "rewrite-selection"
              ? [
                `只改寫「${sourceChapter.title}」中作者反白的文字，保留前後銜接、人物、視角與既有事實。`,
                `選取內容：\n${targetText}`,
                `輸出約 ${targetCharacters} 個繁體中文字；只輸出可直接替換選取範圍的正文，不要輸出說明或整章。`,
              ].join("\n")
              : mode === "dialogue"
                ? [
                  `改寫「${sourceChapter.title}」${targetSelection ? "的選取段落" : "目前全文"}，加強人物對話。`,
                  `目標內容：\n${targetText}`,
                  "每句對話要有說話目的、角色語氣、潛台詞與可見反應；保留事件因果，只輸出替換正文。",
                ].join("\n")
                : mode === "tension"
                  ? [
                    `改寫「${sourceChapter.title}」${targetSelection ? "的選取段落" : "目前全文"}，增加情緒張力與選擇代價。`,
                    `目標內容：\n${targetText}`,
                    "以行動、感官、停頓與人物反應呈現壓力，不得空喊情緒或新增未核准 Canon；只輸出替換正文。",
                  ].join("\n")
                  : mode === "pacing"
                    ? [
                      `改寫「${sourceChapter.title}」${targetSelection ? "的選取段落" : "目前全文"}，調整敘事節奏。`,
                      `目標內容：\n${targetText}`,
                      "刪減重複資訊、保留關鍵事件，讓動作、對話與資訊揭露有清楚推進；只輸出替換正文。",
                    ].join("\n")
                    : [
            `重寫「${sourceChapter.title}」目前全文，保留既有事件、人物、視角、關係與因果。`,
            `候選方向：${direction}`,
            `正文目標約 ${targetCharacters} 個繁體中文字；加強動作、感官、對話潛台詞與節奏，不得刪掉關鍵事件或新增未核准 Canon。`,
            "只輸出可整章替換的正文，不要說明修改方法。",
          ].join("\n");
        const next = await executeStudioClosedAgent({
          taskId: `writing:${mode}:${profile}:${crypto.randomUUID()}`,
          projectId,
          taskType,
          objective,
          sourceChapterId: sourceChapter.id,
          sourceRevision: sourceChapter.revision,
          storyBibleRevision: "current",
          knowledgeScopeRevision: "current",
          contextTokenBudget: profile === "quality" ? 4_096 : 3_072,
          qualityMode,
          browserComputePolicy: "balanced",
          allowPreAuthorizedClosedEscalation: true,
          generationOptions: {
            maxTokens: profile === "quality" ? (mode === "continue" ? 1_024 : 1_280) : mode === "hook" ? 384 : 704,
            temperature: 0.78 + index * 0.04,
            topP: 0.92,
            repetitionPenalty: 1.14,
            seed: seeds[index],
          },
          signal: controller.signal,
          onProgress: (event) => {
            setAiProgress(event);
            setAiMessage(`${label}：${event.label}`);
          },
        });
        const option: WritingAICandidateOption = {
          label: profile === "compare" ? label : WRITING_AI_TOOL_META[mode].label,
          direction,
          mode,
          applyMode,
          selection: targetSelection,
          result: next,
        };
        setAiCandidates((items) => [...items, option]);
        setAiCandidateTexts((items) => ({ ...items, [next.candidate.id]: next.candidate.content }));
        if (completed === 0) {
          setAiResult(next);
          setAiCandidateText(next.candidate.content);
        }
        setAiRuntimeStatus(`本次真實執行器：${next.candidate.actualExecutor} · ${next.candidate.modelId}。下次仍會自動偵測，不必先去設定頁。`);
        completed += 1;
        setAiMessage(`${label} 已完成；可立即閱讀與核准${profile === "compare" && completed < directions.length ? "，其餘方向仍在背景依序產生" : ""}。`);
      }
      if (completed > 0) {
        setAiMessage(`${completed} 份真實模型候選已完成；已讀取前後章與正式設定。核准後只會${applyMode === "append" ? `接在「${sourceChapter.title}」末尾` : applyMode === "replace-selection" ? "替換原本反白的範圍" : `替換「${sourceChapter.title}」全文`}。`);
      }
    } catch (cause) {
      setAiMessage(controller.signal.aborted
        ? completed
          ? `已停止後續生成；保留已完成的 ${completed} 份候選，正式正文沒有變更。`
          : "已停止本次 AI 工作；正式正文沒有變更。"
        : completed
          ? `已保留完成的 ${completed} 份候選；後續候選失敗：${cause instanceof Error ? cause.message : "請重試"}`
          : `AI 候選失敗：${cause instanceof Error ? cause.message : "請稍後重試"}。你仍停在目前章節，不必跳到設定頁。`);
    } finally {
      if (aiControllerRef.current === controller) aiControllerRef.current = null;
      setAiBusy(null);
    }
  }

  async function approveInlineWritingAI() {
    if (!aiResult || aiBusy || aiResult.candidate.status !== "awaiting-approval") return;
    const candidate = aiResult.candidate;
    const selectedOption = aiCandidates.find((item) => item.result.candidate.id === candidate.id);
    const applyMode = selectedOption?.applyMode
      ?? (aiResult.task.taskType === "chapter.continue" ? "append" : "replace");
    if (!candidate.sourceChapterId || candidate.sourceRevision == null) {
      setAiMessage("候選缺少來源章節版本，沒有修改正文；請重新產生。");
      return;
    }
    const sourceSnapshot = latestRef.current.chapter;
    if (!sourceSnapshot
      || sourceSnapshot.id !== candidate.sourceChapterId
      || sourceSnapshot.revision !== candidate.sourceRevision) {
      setAiMessage("目前章節已在候選產生後變更；為避免覆蓋新內容，請放棄候選後重新產生。");
      return;
    }
    let commitContent = aiCandidateText;
    let commitMode: "append" | "replace" = applyMode === "append" ? "append" : "replace";
    let targetCaret: number | null = null;
    if (applyMode === "replace-selection") {
      const range = selectedOption?.selection;
      if (!range
        || range.start < 0
        || range.end <= range.start
        || range.end > sourceSnapshot.content.length) {
        setAiMessage("候選的選取範圍已失效；正式正文沒有變更，請重新反白後產生候選。");
        return;
      }
      commitContent = `${sourceSnapshot.content.slice(0, range.start)}${aiCandidateText}${sourceSnapshot.content.slice(range.end)}`;
      commitMode = "replace";
      targetCaret = range.start + aiCandidateText.length;
    }
    setAiBusy("approve");
    try {
      let committedChapter: Chapter | null = null;
      await closedAgentOS.approveCandidate({
        candidateId: candidate.id,
        approvedBy: "local-author",
        humanApproved: true,
        canonicalCommit: async ({ idempotencyKey }) => {
          const committed = await commitStudioCandidateToChapter({
            repository: createNovelRepository(),
            projectId,
            chapterId: candidate.sourceChapterId!,
            sourceRevision: candidate.sourceRevision!,
            taskId: candidate.taskId,
            idempotencyKey,
            content: commitContent,
            mode: commitMode,
          });
          committedChapter = committed.chapter;
          return { commitId: committed.commitId, storyBibleRevision: "current" };
        },
      });
      if (!committedChapter) throw new Error("核准交易沒有回傳章節結果。");
      const savedChapter = committedChapter as Chapter;
      const unselectedCandidates = pendingAIResults().filter(
        (item) => item.candidate.id !== candidate.id,
      );
      await Promise.allSettled(
        unselectedCandidates.map((item) => closedAgentOS.rejectCandidate(item.candidate.id)),
      );
      applyChapter(savedChapter);
      setChapters((items) => items.map((item) => item.id === savedChapter.id ? savedChapter : item));
      latestRef.current = { ...latestRef.current, chapter: savedChapter, content: savedChapter.content };
      void syncChapterKnowledge(projectId, savedChapter).catch(() => undefined);
      scheduleAICacheWarm(savedChapter, 300);
      clearAICandidateState(`AI 候選已核准並寫入「${savedChapter.title}」；其他候選已放棄，其他章節沒有變更。`);
      setStatus("AI 候選已完成核准交易並安全寫入目前章節。");
      const caret = targetCaret == null ? savedChapter.content.length : Math.min(targetCaret, savedChapter.content.length);
      setSelection({ start: caret, end: caret });
      window.requestAnimationFrame(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        editor.setSelectionRange(caret, caret);
        if (targetCaret == null) editor.scrollTop = editor.scrollHeight;
      });
    } catch (cause) {
      setAiMessage(`核准失敗：${cause instanceof Error ? cause.message : "正式正文保持不變"}`);
    } finally {
      setAiBusy(null);
    }
  }

  async function rejectInlineWritingAI() {
    if (!hasPendingAICandidate || aiBusy) return;
    setAiBusy("reject");
    try {
      await rejectPendingAICandidates("所有 AI 候選已放棄；正式正文沒有變更。");
    } catch (cause) {
      setAiMessage(`放棄候選失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setAiBusy(null);
    }
  }

  function selectAICandidate(option: WritingAICandidateOption) {
    if (aiBusy) return;
    if (aiResult) {
      setAiCandidateTexts((items) => ({
        ...items,
        [aiResult.candidate.id]: aiCandidateText,
      }));
    }
    setAiResult(option.result);
    setAiCandidateText(
      aiCandidateTexts[option.result.candidate.id] ?? option.result.candidate.content,
    );
    setAiMessage(`${option.label} 已選取；核准前不會修改「${chapter?.title ?? "目前章節"}」。`);
  }

  const wordCount = useMemo(() => content.replace(/\s/g, "").length, [content]);
  const paragraphCount = useMemo(() => content.split(/\n\s*\n/u).filter((item) => item.trim()).length, [content]);
  const selectedAIOption = aiResult
    ? aiCandidates.find((item) => item.result.candidate.id === aiResult.candidate.id) ?? null
    : null;
  const selectedCharacterCount = Math.max(0, selection.end - selection.start);
  const aiIsGenerating = Boolean(aiBusy && aiBusy !== "approve" && aiBusy !== "reject");
  const aiApplyDescription = selectedAIOption?.applyMode === "replace-selection"
    ? `核准後只替換原先反白的 ${selectedAIOption.selection ? selectedAIOption.selection.end - selectedAIOption.selection.start : 0} 字`
    : selectedAIOption?.applyMode === "replace"
      ? "核准後取代目前整章"
      : "核准後接在本章末尾";
  const guideStage = !project?.coreIdea.value?.trim()
    ? 0
    : !content.trim()
      ? 1
      : chapterStatus === "completed"
        ? 3
        : 2;
  const guideSteps = [
    ["設定作品", "先確認核心想法、人物與世界，避免 AI 無脈絡亂寫。"],
    ["開始本章", "自己寫開場，或讓閉端 AI 建立可核准候選。"],
    ["修訂與保存", "段落整理、AI 候選與自動保存都鎖定目前章節。"],
    ["完成與閱讀", "標記完成後，以閱讀模式檢查節奏再開下一章。"],
  ] as const;

  if (!loaded) return <main className="p2ProjectShell"><p>{status}</p></main>;
  if (!project) {
    return (
      <main className="p2ProjectShell">
        <h1>找不到作品</h1>
        <p>{status}</p>
        <Link href="/studio/create">建立新作品</Link>
      </main>
    );
  }

  return (
    <main className="p2ProjectShell p2WritingPage" data-testid="studio-writing">
      <header>
        <div className="p2WritingHeaderActions">
          <button type="button" className="p2WritingBack" disabled={busy} onClick={() => void navigateSafely("/studio", "首頁")}>首頁</button>
          <button type="button" className="p2WritingBack" disabled={busy} onClick={() => void navigateSafely(`/professional?intent=library&projectId=${encodeURIComponent(projectId)}`, "我的作品")}>我的作品</button>
        </div>
        <div><small>{project.title}</small><h1>專注寫作</h1></div>
        <span data-dirty={dirty}>{saving ? "正在自動儲存…" : dirty ? "等待自動儲存" : status}</span>
      </header>
      <ProjectNavigation
        projectId={projectId}
        active="write"
        onNavigate={(href, label) => void navigateSafely(href, label)}
      />
      <p className="p2WritingCacheStatus" role="status">{aiCacheStatus}</p>
      <section className="p2WritingFlow" aria-label="創作流程">
        <div>
          <span className="p2WritingGuideAvatar" aria-hidden="true">✦</span>
          <div><small>創作小精靈</small><strong>{guideSteps[guideStage][0]}</strong></div>
          <p>{guideSteps[guideStage][1]}</p>
        </div>
        <ol hidden={!guideOpen}>
          {guideSteps.map(([label], index) => <li key={label} data-current={index === guideStage} data-complete={index < guideStage}><span>{index < guideStage ? "✓" : index + 1}</span>{label}</li>)}
        </ol>
        <button type="button" onClick={() => setGuideOpen((current) => !current)}>{guideOpen ? "收合指引" : "展開指引"}</button>
      </section>
      <section className="p2WritingWorkspace">
        <aside className="p2ChapterRail" aria-label="章節列表" data-testid="studio-chapter-manager">
          <header>
            <h2>章節</h2>
            <button
              type="button"
              disabled={busy}
              title={chapterStatus === "completed" ? "開啟既有下一章，或建立唯一的新章" : "請先完成目前章節"}
              onClick={() => void createChapter()}
            >{chapterStatus === "completed" ? "開啟下一章" : "完成後開下一章"}</button>
          </header>
          <div className="p2ChapterList">
            {chapters.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === chapter?.id ? "active" : ""}
                onClick={() => void selectChapter(item)}
              >
                <span>{item.order}. {item.title}</span>
                <small>{item.status === "completed" ? "已完成" : `${item.content.replace(/\s/g, "").length} 字`}</small>
              </button>
            ))}
          </div>
        </aside>

        <article className="p2ChapterEditor">
          <div className="p2ChapterMeta">
            <input aria-label="章節標題" disabled={busy || Boolean(aiBusy) || hasPendingAICandidate} value={title} onChange={(event) => setTitle(event.target.value)} />
            <select aria-label="章節狀態" disabled={busy || Boolean(aiBusy) || hasPendingAICandidate} value={chapterStatus} onChange={(event) => setChapterStatus(event.target.value as Chapter["status"])}>
              <option value="draft">草稿</option>
              <option value="completed">已完成</option>
            </select>
          </div>
          <textarea
            ref={editorRef}
            aria-label="正文"
            readOnly={busy || Boolean(aiBusy) || hasPendingAICandidate}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onSelect={(event) => {
              setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
              rememberEditorPosition(event.currentTarget);
            }}
            onScroll={(event) => rememberEditorPosition(event.currentTarget)}
            placeholder="從這裡開始寫你的故事…"
          />
          <label className="p2ChapterSummary">
            本章摘要（可留白）
            <textarea readOnly={busy || Boolean(aiBusy) || hasPendingAICandidate} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="供時間線與閉端 AI 檢索使用；仍由作者確認。" />
          </label>
          <footer>
            <span>{wordCount} 字 · {paragraphCount} 段 · {saving ? "自動儲存中" : "Ctrl+S 立即儲存"}</span>
            <div>
              <button type="button" className="gold" disabled={busy || Boolean(aiBusy) || hasPendingAICandidate} onClick={() => void completeChapterAndCreateNext()}>完成本章並建立下一章</button>
              <button type="button" className="danger" disabled={busy || Boolean(aiBusy) || hasPendingAICandidate || chapters.length <= 1} onClick={() => void deleteChapter()}>刪除本章</button>
              <button type="button" disabled={busy || Boolean(aiBusy) || hasPendingAICandidate || saving || !dirty} onClick={() => void save()}>{saving ? "儲存中…" : "儲存目前內容"}</button>
            </div>
          </footer>
        </article>

        <aside ref={aiPanelRef} id="writing-ai" className="p2WritingTools">
          <h2>AI 寫作助手（與正文同頁）</h2>
          <p>{project.coreIdea.value || "尚未設定核心想法。小精靈建議先建立人物與世界，或直接用 AI 引導設定。"}</p>
          <section className="p2WritingAIRuntime" aria-label="閉端 AI 自動連線狀態">
            <div><strong>閉端 AI 自動連線</strong><span>{aiRuntimeStatus}</span></div>
            <button type="button" disabled={aiDiscovering || Boolean(aiBusy)} onClick={() => void refreshAIRuntime()}>{aiDiscovering ? "偵測中…" : "重新偵測"}</button>
          </section>
          <p className="p2WritingAIStageNote">題材、主角、世界、衝突、玩法、故事種子與大綱屬於「建立作品」階段；進入寫作後只顯示會作用於目前章節的工具，不會再把你送去其他頁面。</p>
          {guideStage === 0 ? <button type="button" onClick={() => void navigateSafely(`/studio/project/${projectId}/story-bible`, "故事設定")}>先設定故事</button> : null}
          {guideStage <= 1 ? <button type="button" onClick={() => editorRef.current?.focus()}>我自己開始寫</button> : null}
          <div className="p2WritingAIProfiles" aria-label="AI 寫作速度與品質">
            <button type="button" disabled={Boolean(aiBusy) || hasPendingAICandidate} onClick={() => void runInlineWritingAI("continue", "quick")}>
              <strong>{content.trim() ? "AI 承接脈絡續寫" : "建立第一章候選"}</strong><span>快速 · 先產生 1 份</span>
            </button>
            <button type="button" disabled={Boolean(aiBusy) || hasPendingAICandidate} onClick={() => void runInlineWritingAI("continue", "compare")}>
              <strong>比較 3 個故事方向</strong><span>逐份出現，不必等全部</span>
            </button>
            <button type="button" disabled={Boolean(aiBusy) || hasPendingAICandidate} onClick={() => void runInlineWritingAI("continue", "quality")}>
              <strong>完整品質續寫</strong><span>較長 · 1 份完整修訂</span>
            </button>
            <button type="button" disabled={Boolean(aiBusy) || hasPendingAICandidate} onClick={() => void runInlineWritingAI("rewrite", "quality")}>
              <strong>AI 整章改寫候選</strong><span>保留事件與人物，只改寫本章</span>
            </button>
          </div>
          <div className="p2WritingAIToolGroup" aria-label="目前章節 AI 修訂工具">
            <header><strong>目前章節修訂</strong><span>{selectedCharacterCount ? `已反白 ${selectedCharacterCount} 字` : "可先反白文字，精準修改指定範圍"}</span></header>
            {(["rewrite-selection", "dialogue", "tension", "pacing", "hook"] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                disabled={Boolean(aiBusy) || hasPendingAICandidate || (mode === "rewrite-selection" && selectedCharacterCount === 0)}
                onClick={() => void runInlineWritingAI(mode, mode === "hook" ? "quick" : "quality")}
              >
                <strong>{WRITING_AI_TOOL_META[mode].label}</strong>
                <span>{WRITING_AI_TOOL_META[mode].description}</span>
              </button>
            ))}
          </div>
          <p className="p2WritingAIStatus" role="status" aria-live="polite">{aiMessage}</p>
          {aiIsGenerating ? <section className="p2WritingAIProgress" data-testid="writing-ai-progress">
            <div>
              <strong>{aiProgress?.label ?? "Closed Agent OS 正在準備寫作脈絡"}</strong>
              <span>{aiProgress?.percent ?? 5}%{aiProgress?.generatedCharacters != null ? ` · ${aiProgress.generatedCharacters} 字` : ""}</span>
            </div>
            <progress max={100} value={aiProgress?.percent ?? 5} />
            <button type="button" onClick={() => aiControllerRef.current?.abort("USER_CANCELLED")}>停止生成</button>
          </section> : null}
          {aiCandidates.length > 1 ? <div className="p2WritingAICandidateTabs" aria-label="已完成的 AI 候選">
            {aiCandidates.map((option) => (
              <button
                type="button"
                key={option.result.candidate.id}
                data-selected={option.result.candidate.id === aiResult?.candidate.id}
                disabled={Boolean(aiBusy)}
                onClick={() => selectAICandidate(option)}
              >
                <strong>{option.label}</strong>
                <span>已完成 · {option.result.candidate.content.replace(/\s/gu, "").length} 字</span>
              </button>
            ))}
          </div> : null}
          {aiResult ? <section
            className="p2WritingAICandidate"
            data-testid="writing-ai-candidate"
            data-origin={aiResult.candidate.backendId}
          >
            <header>
              <div><small>AI 產生 · 尚未寫入正文</small><strong>{aiCandidates.find((item) => item.result.candidate.id === aiResult.candidate.id)?.label ?? "脈絡承接候選"}</strong></div>
              <span>{aiResult.candidate.modelId}</span>
            </header>
            <p className="p2WritingAITarget">目標：{chapter?.title ?? "目前章節"} · {aiApplyDescription}</p>
            <p>{aiContextSummary(aiResult)}</p>
            <textarea
              aria-label="AI 候選文字"
              value={aiCandidateText}
              disabled={Boolean(aiBusy)}
              onChange={(event) => {
                const value = event.target.value;
                setAiCandidateText(value);
                setAiCandidateTexts((items) => ({ ...items, [aiResult.candidate.id]: value }));
              }}
            />
            <footer>
              <button type="button" className="gold" disabled={Boolean(aiBusy) || !aiCandidateText.trim()} onClick={() => void approveInlineWritingAI()}>
                {aiBusy === "approve" ? "核准寫入中…" : "核准並寫入目前章節"}
              </button>
              <button type="button" disabled={Boolean(aiBusy)} onClick={() => void runInlineWritingAI(selectedAIOption?.mode ?? "continue", aiRunProfile)}>重新產生{aiRunProfile === "compare" ? "三個方向" : "不同版本"}</button>
              <button type="button" disabled={Boolean(aiBusy)} onClick={() => void rejectInlineWritingAI()}>{aiBusy === "reject" ? "放棄中…" : "放棄全部候選"}</button>
            </footer>
            <details>
              <summary>執行證明</summary>
              <p>實際執行器：{aiResult.candidate.actualExecutor}</p>
              <p>脈絡雜湊：{aiResult.candidate.contextDigest ?? "未記錄"}</p>
              <p>Canon mutation：{aiResult.candidate.canonicalMutationCount}</p>
            </details>
          </section> : null}
          <div className="p2ParagraphTools" aria-label="段落整理工具">
            <strong>段落整理</strong>
            <button type="button" disabled={busy} onClick={() => insertAtSelection("\n\n")}>在游標處分段</button>
            <button type="button" disabled={busy} onClick={() => insertAtSelection("\n\n＊　＊　＊\n\n")}>插入場景分隔</button>
            <button type="button" className="danger" disabled={busy || !content} onClick={deleteCurrentParagraph}>刪除選取／本段</button>
            <button type="button" disabled={busy || editHistory.length === 0} onClick={undoToolEdit}>復原工具操作</button>
          </div>
          <button type="button" onClick={() => void navigateSafely(`/studio/read/${projectId}`, "閱讀預覽")}>閱讀預覽</button>
          <details className="p2WritingAIDiagnostics">
            <summary>模型連線與執行真相</summary>
            <p>{aiRuntimeStatus}</p>
            <p>寫作按鈕會在本頁自動偵測 Browser AI、Local Ollama 與 Private Hub；未連線時只顯示真實錯誤，不會跳轉設定頁，也不會用模板冒充模型回答。</p>
          </details>
          <button type="button" onClick={() => void navigateSafely(`/studio/project/${projectId}/learning`, "學習規則中心")}>學習規則中心</button>
          <details>
            <summary>資料與核准邊界</summary>
            <p>切換功能前會先保存目前章節。AI 只建立候選；必須由你核准後，才會寫入本章、Memory 或 Canon。</p>
          </details>
        </aside>
      </section>
    </main>
  );
}
