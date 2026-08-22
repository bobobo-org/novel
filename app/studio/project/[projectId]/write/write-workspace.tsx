"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClosedAgentExecutionResult } from "@/lib/novel-ai/closed-agent-os";
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
import { getStudioClosedAgentOS } from "@/lib/novel-ai/web/closed-agent-os-service";
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

type WritingAIApplyMode = "append" | "replace" | "replace-selection";
type WritingAICandidateOption = {
  label: string;
  applyMode: WritingAIApplyMode;
  selection: { start: number; end: number } | null;
  result: ClosedAgentExecutionResult;
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
  const [guideOpen, setGuideOpen] = useState(true);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [editHistory, setEditHistory] = useState<string[]>([]);
  const [aiResult, setAiResult] = useState<ClosedAgentExecutionResult | null>(null);
  const [aiCandidateText, setAiCandidateText] = useState("");
  const [aiCandidates, setAiCandidates] = useState<WritingAICandidateOption[]>([]);
  const [aiCandidateTexts, setAiCandidateTexts] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState<"approve" | "reject" | null>(null);
  const [aiMessage, setAiMessage] = useState("這裡不建立新的 AI 故事候選；若已有待核准候選，仍可在原章核准或放棄。");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const saveQueueRef = useRef<Promise<Chapter | null>>(Promise.resolve(null));
  const resumeTimerRef = useRef<number | null>(null);
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

  useEffect(() => () => {
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
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
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "讀取失敗");
    } finally {
      setLoaded(true);
    }
  }, [projectId, restoreEditorPosition]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

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
  }, [projectId, rememberEditorPosition]);

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

  async function approveInlineWritingAI() {
    if (!aiResult || aiBusy || aiResult.candidate.status !== "awaiting-approval") return;
    const candidate = aiResult.candidate;
    const selectedOption = aiCandidates.find((item) => item.result.candidate.id === candidate.id);
    const applyMode = selectedOption?.applyMode
      ?? (aiResult.task.taskType === "chapter.continue" ? "append" : "replace");
    if (!candidate.sourceChapterId || candidate.sourceRevision == null) {
      setAiMessage("候選缺少來源章節版本，沒有修改正文；請回故事工作台重新建立候選。");
      return;
    }
    const sourceSnapshot = latestRef.current.chapter;
    if (!sourceSnapshot
      || sourceSnapshot.id !== candidate.sourceChapterId
      || sourceSnapshot.revision !== candidate.sourceRevision) {
      setAiMessage("目前章節已在候選建立後變更；為避免覆蓋新內容，請放棄候選，再回故事工作台建立新候選。");
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
  const aiApplyDescription = selectedAIOption?.applyMode === "replace-selection"
    ? `核准後只替換原先反白的 ${selectedAIOption.selection ? selectedAIOption.selection.end - selectedAIOption.selection.start : 0} 字`
    : selectedAIOption?.applyMode === "replace"
      ? "核准後取代目前整章"
      : "核准後接在本章末尾";
  const guideStage = !content.trim()
    ? 0
    : dirty
      ? 1
      : chapterStatus === "completed"
        ? 3
        : 2;
  const guideSteps = [
    ["選擇章節", "從左側選擇要校訂的章節；故事續寫與 RPG 回合請回故事工作台。"],
    ["人工校訂", "直接修正標題、正文、摘要與段落，變更會鎖定目前章節。"],
    ["保存與確認", "確認全文與摘要後保存；既有待核准候選仍可逐份處理。"],
    ["完成與預覽", "標記完成後，以閱讀預覽檢查全文，再開啟下一章。"],
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
        <div><small>{project.title} · 專業工具</small><h1>章節全文校訂</h1></div>
        <span data-dirty={dirty}>{saving ? "正在自動儲存…" : dirty ? "等待自動儲存" : status}</span>
      </header>
      <ProjectNavigation
        projectId={projectId}
        active="write"
        onNavigate={(href, label) => void navigateSafely(href, label)}
      />
      <section className="p2WritingFlow" aria-label="章節校訂流程">
        <div>
          <span className="p2WritingGuideAvatar" aria-hidden="true">✦</span>
          <div><small>校訂指引</small><strong>{guideSteps[guideStage][0]}</strong></div>
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
            placeholder="在這裡人工校訂目前章節全文…"
          />
          <label className="p2ChapterSummary">
            本章摘要（可留白）
            <textarea readOnly={busy || Boolean(aiBusy) || hasPendingAICandidate} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="人工整理本章事件、人物變化與後續線索。" />
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

        <aside id="chapter-proofreading" className="p2WritingTools">
          <h2>章節全文校訂（專業工具）</h2>
          <p className="p2WritingAIStageNote">這裡只處理章節列表、人工正文與摘要校訂、保存、完成、刪除、段落整理和閱讀預覽，不再建立新的 AI 故事內容。</p>
          <Link
            href={`/studio/project/${projectId}/chat`}
            onClick={(event) => {
              event.preventDefault();
              void navigateSafely(`/studio/project/${projectId}/chat`, "故事工作台");
            }}
          >
            前往唯一故事工作台：續寫、改寫、RPG 與 A／B／C
          </Link>
          <p className="p2WritingAIStatus" role="status" aria-live="polite">{aiMessage}</p>
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
              <div><small>既有 AI 候選 · 尚未寫入正文</small><strong>{aiCandidates.find((item) => item.result.candidate.id === aiResult.candidate.id)?.label ?? "待核准候選"}</strong></div>
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
          <button type="button" onClick={() => void navigateSafely(`/studio/project/${projectId}/learning`, "學習規則中心")}>學習規則中心</button>
          <details>
            <summary>資料與核准邊界</summary>
            <p>切換功能前會先保存目前章節。本頁不建立新 AI 候選；若有既有候選，仍必須由你核准後才會寫入本章、Memory 或 Canon。</p>
          </details>
        </aside>
      </section>
    </main>
  );
}
