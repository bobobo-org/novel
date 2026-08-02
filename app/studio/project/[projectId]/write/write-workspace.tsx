"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeRecord, type Chapter, type NovelProject } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import { mirrorChapterToLegacyStudio } from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import {
  createSovereignLearningRepository,
  ingestFirstPartyProjectKnowledge,
} from "@/lib/novel-ai/sovereign-learning";
import {
  stageStudioTaskHandoff,
  studioHomeHref,
} from "@/lib/novel-ai/web/studio-task-session";
import { prewarmStudioInteractiveChoiceAI } from "@/lib/novel-ai/web/studio-closed-ai";
import { prewarmStudioProjectAIState } from "@/lib/novel-ai/web/closed-agent-os-service";
import {
  readStudioWritingResume,
  writeStudioWritingResume,
} from "@/lib/novel-ai/web/studio-writing-resume";
import ProjectNavigation from "../project-navigation";

function closedAIHref(projectId: string, task: string, objective: string) {
  const returnTo = `/studio/project/${encodeURIComponent(projectId)}/write`;
  const query = new URLSearchParams({ task, objective, source: "writing", returnTo });
  return `/studio/project/${encodeURIComponent(projectId)}/closed-ai?${query.toString()}`;
}

type EditorSnapshot = {
  chapter: Chapter | null;
  project: NovelProject | null;
  title: string;
  content: string;
  summary: string;
  chapterStatus: Chapter["status"];
};

function snapshotIsDirty(snapshot: EditorSnapshot) {
  return snapshot.chapter
    ? snapshot.title !== snapshot.chapter.title
      || snapshot.content !== snapshot.chapter.content
      || snapshot.summary !== (snapshot.chapter.summary ?? "")
      || snapshot.chapterStatus !== snapshot.chapter.status
    : false;
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
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const saveQueueRef = useRef<Promise<Chapter | null>>(Promise.resolve(null));
  const cacheWarmTimerRef = useRef<number | null>(null);
  const cacheWarmControllerRef = useRef<AbortController | null>(null);
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

  useEffect(() => () => {
    if (cacheWarmTimerRef.current !== null) window.clearTimeout(cacheWarmTimerRef.current);
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    cacheWarmControllerRef.current?.abort("WRITING_WORKSPACE_UNMOUNTED");
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
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

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

  async function navigateSafely(href: string, destination: string) {
    if (busy) return;
    setBusy(true);
    try {
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
      router.push(studioHomeHref(projectId));
    } finally {
      setBusy(false);
    }
  }

  async function selectChapter(next: Chapter) {
    if (next.id === chapter?.id || busy) return;
    setBusy(true);
    try {
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
    setBusy(true);
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
      const order = Math.max(0, ...chapters.map((item) => item.order)) + 1;
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
      setStatus("新章節已建立。");
    } catch (cause) {
      setStatus(`建立章節失敗：${cause instanceof Error ? cause.message : "請重試"}`);
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

  const wordCount = useMemo(() => content.replace(/\s/g, "").length, [content]);
  const paragraphCount = useMemo(() => content.split(/\n\s*\n/u).filter((item) => item.trim()).length, [content]);
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
    <main className="p2ProjectShell p2WritingPage">
      <header>
        <button type="button" className="p2WritingBack" disabled={busy} onClick={() => void navigateSafely("/studio", "我的作品")}>我的作品</button>
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
        <aside className="p2ChapterRail" aria-label="章節列表">
          <header><h2>章節</h2><button type="button" disabled={busy} onClick={() => void createChapter()}>新增</button></header>
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
            <input aria-label="章節標題" disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} />
            <select aria-label="章節狀態" disabled={busy} value={chapterStatus} onChange={(event) => setChapterStatus(event.target.value as Chapter["status"])}>
              <option value="draft">草稿</option>
              <option value="completed">已完成</option>
            </select>
          </div>
          <textarea
            ref={editorRef}
            aria-label="正文"
            readOnly={busy}
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
            <textarea readOnly={busy} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="供時間線與閉端 AI 檢索使用；仍由作者確認。" />
          </label>
          <footer>
            <span>{wordCount} 字 · {paragraphCount} 段 · {saving ? "自動儲存中" : "Ctrl+S 立即儲存"}</span>
            <div>
              <button type="button" className="danger" disabled={busy || chapters.length <= 1} onClick={() => void deleteChapter()}>刪除本章</button>
              <button type="button" disabled={busy || saving || !dirty} onClick={() => void save()}>{saving ? "儲存中…" : "儲存目前內容"}</button>
            </div>
          </footer>
        </article>

        <aside className="p2WritingTools">
          <h2>創作小精靈</h2>
          <p>{project.coreIdea.value || "尚未設定核心想法。小精靈建議先建立人物與世界，或直接用 AI 引導設定。"}</p>
          {guideStage === 0 ? <button type="button" onClick={() => void navigateSafely(`/studio/project/${projectId}/story-bible`, "故事設定")}>先設定故事</button> : null}
          {guideStage <= 1 ? <button type="button" onClick={() => editorRef.current?.focus()}>我自己開始寫</button> : null}
          <button type="button" onClick={() => void navigateSafely(closedAIHref(projectId, "chapter.continue", `延續「${title || "目前章節"}」，產生符合已核准設定的候選正文。`), "閉端 AI 續寫")}>閉端 AI 續寫候選</button>
          <button type="button" onClick={() => void navigateSafely(closedAIHref(projectId, "chapter.rewrite", `改寫「${title || "目前章節"}」的整章候選版本，保留正式 Canon 與角色設定。`), "閉端 AI 改寫")}>閉端 AI 整章改寫</button>
          <div className="p2ParagraphTools" aria-label="段落整理工具">
            <strong>段落整理</strong>
            <button type="button" disabled={busy} onClick={() => insertAtSelection("\n\n")}>在游標處分段</button>
            <button type="button" disabled={busy} onClick={() => insertAtSelection("\n\n＊　＊　＊\n\n")}>插入場景分隔</button>
            <button type="button" className="danger" disabled={busy || !content} onClick={deleteCurrentParagraph}>刪除選取／本段</button>
            <button type="button" disabled={busy || editHistory.length === 0} onClick={undoToolEdit}>復原工具操作</button>
          </div>
          <button type="button" onClick={() => void navigateSafely(`/studio/read/${projectId}`, "閱讀預覽")}>閱讀預覽</button>
          <button type="button" onClick={() => void navigateSafely(`/studio/project/${projectId}/ai`, "進階候選與評估")}>進階候選與評估</button>
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
