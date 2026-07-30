"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { makeRecord, type Chapter, type NovelProject } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import { mirrorChapterToLegacyStudio } from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import ProjectNavigation from "../project-navigation";

function closedAIHref(projectId: string, task: string, objective: string) {
  const query = new URLSearchParams({ task, objective, source: "writing" });
  return `/studio/project/${encodeURIComponent(projectId)}/closed-ai?${query.toString()}`;
}

export default function WriteWorkspace({ projectId }: { projectId: string }) {
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

  const dirty = chapter
    ? title !== chapter.title
      || content !== chapter.content
      || summary !== (chapter.summary ?? "")
      || chapterStatus !== chapter.status
    : false;

  function applyChapter(next: Chapter) {
    setChapter(next);
    setTitle(next.title);
    setContent(next.content);
    setSummary(next.summary ?? "");
    setChapterStatus(next.status);
  }

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
      setStatus("已載入");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "讀取失敗");
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

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

  const save = useCallback(async () => {
    if (!chapter || busy) return null;
    if (!title.trim()) {
      setStatus("章節標題不能留白。");
      return null;
    }
    setBusy(true);
    setStatus("儲存中…");
    try {
      const repo = createNovelRepository();
      const saved = await repo.put<Chapter>("chapters", {
        ...chapter,
        title: title.trim(),
        content,
        summary: summary.trim() || null,
        status: chapterStatus,
      }, chapter.revision);
      let nextProject = project;
      if (nextProject && nextProject.activeChapterId !== saved.id) {
        nextProject = await repo.put<NovelProject>("projects", {
          ...nextProject,
          activeChapterId: saved.id,
        }, nextProject.revision);
        setProject(nextProject);
      }
      setChapters((items) => items
        .map((item) => item.id === saved.id ? saved : item)
        .sort((left, right) => left.order - right.order));
      applyChapter(saved);
      mirrorChapterToLegacyStudio(projectId, saved.title, saved.content);
      setStatus(`已儲存 ${new Date().toLocaleTimeString("zh-TW")}`);
      return saved;
    } catch (cause) {
      setStatus(`儲存失敗：${cause instanceof Error ? cause.message : "請重新載入後再試"}`);
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, chapter, chapterStatus, content, project, projectId, summary, title]);

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

  async function selectChapter(next: Chapter) {
    if (next.id === chapter?.id || busy) return;
    if (dirty && !confirm("目前章節有尚未儲存的修改。要放棄修改並切換章節嗎？")) return;
    try {
      const repo = createNovelRepository();
      let nextProject = project;
      if (nextProject && nextProject.activeChapterId !== next.id) {
        nextProject = await repo.put<NovelProject>("projects", {
          ...nextProject,
          activeChapterId: next.id,
        }, nextProject.revision);
        setProject(nextProject);
      }
      applyChapter(next);
      mirrorChapterToLegacyStudio(projectId, next.title, next.content);
      setStatus(`已切換到 ${next.title}`);
    } catch (cause) {
      setStatus(`切換失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    }
  }

  async function createChapter() {
    if (busy) return;
    if (dirty) {
      const saved = await save();
      if (!saved) return;
    }
    setBusy(true);
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

  const wordCount = useMemo(() => content.replace(/\s/g, "").length, [content]);

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
        <Link href="/studio">我的作品</Link>
        <div><small>{project.title}</small><h1>專注寫作</h1></div>
        <span data-dirty={dirty}>{dirty ? "尚未儲存" : status}</span>
      </header>
      <ProjectNavigation projectId={projectId} active="write" />
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
            <input aria-label="章節標題" value={title} onChange={(event) => setTitle(event.target.value)} />
            <select aria-label="章節狀態" value={chapterStatus} onChange={(event) => setChapterStatus(event.target.value as Chapter["status"])}>
              <option value="draft">草稿</option>
              <option value="completed">已完成</option>
            </select>
          </div>
          <textarea
            aria-label="正文"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="從這裡開始寫你的故事…"
          />
          <label className="p2ChapterSummary">
            本章摘要（可留白）
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="供時間線與閉端 AI 檢索使用；仍由作者確認。" />
          </label>
          <footer>
            <span>{wordCount} 字 · Ctrl+S 儲存</span>
            <div>
              <button type="button" className="danger" disabled={busy || chapters.length <= 1} onClick={() => void deleteChapter()}>刪除本章</button>
              <button type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "處理中…" : "儲存目前內容"}</button>
            </div>
          </footer>
        </article>

        <aside className="p2WritingTools">
          <h2>本章工具</h2>
          <p>{project.coreIdea.value || "目前沒有固定核心想法；你可以自由發展故事。"}</p>
          <Link href={closedAIHref(projectId, "chapter.continue", `延續「${title || "目前章節"}」，產生符合已核准設定的候選正文。`)}>
            閉端 AI 續寫
          </Link>
          <Link href={closedAIHref(projectId, "chapter.rewrite", `改寫「${title || "目前章節"}」的候選版本，保留正式 Canon 與角色設定。`)}>
            閉端 AI 改寫
          </Link>
          <Link href={`/studio/project/${projectId}/ai`}>進階候選與評估</Link>
          <Link href={`/studio/project/${projectId}/learning`}>學習規則中心</Link>
          <details>
            <summary>資料與核准邊界</summary>
            <p>AI 只會建立候選。必須由你核准後，才會寫入本章、Memory 或 Canon。</p>
          </details>
        </aside>
      </section>
    </main>
  );
}
