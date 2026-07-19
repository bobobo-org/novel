"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Chapter, NovelProject, ReaderBookmark, ReaderNote, ReaderState } from "@/lib/novel-ai/domain";
import { makeRecord } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";

type Theme = "light" | "night" | "eye" | "paper";
const themes: Array<[Theme, string]> = [["light", "明亮"], ["night", "夜間"], ["eye", "護眼"], ["paper", "紙本"]];

function anchorFor(text: string, index: number) { return `${index}:${text.slice(0, 80)}`; }
function stateDefaults(projectId: string): ReaderState { return { ...makeRecord(projectId), chapterId: null, positionType: "ratio", positionValue: 0, contentAnchor: null, scrollTop: 0, percentage: 0, theme: "night", fontFamily: "system-ui", fontSize: 20, lineHeight: 1.9, contentWidth: 760, paragraphSpacing: 18, lastReadAt: null }; }

export default function ReaderClient({ projectId }: { projectId: string }) {
  const repo = useMemo(() => createNovelRepository(), []);
  const [project, setProject] = useState<NovelProject | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [state, setState] = useState<ReaderState | null>(null);
  const [notes, setNotes] = useState<ReaderNote[]>([]);
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [notice, setNotice] = useState("正在開啟閱讀器…");
  const [noteText, setNoteText] = useState("");
  const articleRef = useRef<HTMLElement>(null);
  const stateRef = useRef<ReaderState | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const activeChapter = chapters.find((item) => item.id === state?.chapterId) ?? chapters[0] ?? null;
  const paragraphs = useMemo(() => (activeChapter?.content || "").split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean), [activeChapter]);

  async function load() {
    try {
      const [nextProject, nextChapters, existingState, nextNotes, nextBookmarks] = await Promise.all([
        repo.get<NovelProject>("projects", projectId), repo.list<Chapter>("chapters", projectId), repo.list<ReaderState>("readerStates", projectId), repo.list<ReaderNote>("readerNotes", projectId), repo.list<ReaderBookmark>("readerBookmarks", projectId),
      ]);
      const ordered = nextChapters.sort((a, b) => a.order - b.order);
      const current = { ...stateDefaults(projectId), ...(existingState[0] ?? {}) } as ReaderState;
      if (!current.chapterId && ordered[0]) current.chapterId = ordered[0].id;
      if (!existingState[0] || Object.keys(existingState[0]).length < Object.keys(current).length) await repo.put("readerStates", current, existingState[0]?.revision);
      stateRef.current = current; setProject(nextProject); setChapters(ordered); setState(current); setNotes(nextNotes); setBookmarks(nextBookmarks); setNotice("");
    } catch { setNotice("閱讀資料載入失敗，請重新嘗試。"); }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveState(patch: Partial<ReaderState>) {
    if (!state) return;
    try {
      saveQueue.current = saveQueue.current.then(async () => {
        const current = stateRef.current;
        if (!current) return;
        const next = await repo.put("readerStates", { ...current, ...patch, lastReadAt: new Date().toISOString() }, current.revision);
        stateRef.current = next; setState(next);
      });
      await saveQueue.current;
    }
    catch { setNotice("閱讀位置儲存失敗，原有內容仍然安全。"); }
  }
  useEffect(() => {
    if (!state || !activeChapter) return;
    const restore = () => {
      const anchor = state.contentAnchor && document.querySelector(`[data-reader-anchor="${CSS.escape(state.contentAnchor)}"]`);
      if (anchor) anchor.scrollIntoView(); else if (typeof state.positionValue === "number") window.scrollTo({ top: Math.round((document.documentElement.scrollHeight - window.innerHeight) * state.positionValue) });
    };
    requestAnimationFrame(restore);
  }, [activeChapter?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!state || !activeChapter) return;
    let timer = 0;
    const onScroll = () => { window.clearTimeout(timer); timer = window.setTimeout(() => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight); const ratio = Math.min(1, Math.max(0, window.scrollY / max));
      const index = Math.min(paragraphs.length - 1, Math.max(0, Math.floor(ratio * Math.max(1, paragraphs.length))));
      void saveState({ positionType: "anchor", positionValue: ratio, contentAnchor: paragraphs[index] ? anchorFor(paragraphs[index], index) : null, scrollTop: window.scrollY, percentage: Math.round(ratio * 100) });
    }, 250); };
    window.addEventListener("scroll", onScroll, { passive: true }); return () => { window.removeEventListener("scroll", onScroll); window.clearTimeout(timer); };
  }, [state?.id, state?.revision, activeChapter?.id, paragraphs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addNote() {
    if (!state || !activeChapter || !noteText.trim()) return;
    const note: ReaderNote = { ...makeRecord(projectId), chapterId: activeChapter.id, anchor: state.contentAnchor || anchorFor(paragraphs[0] || "", 0), excerpt: paragraphs[0]?.slice(0, 180) || "", content: noteText.trim(), needsRelocation: false };
    const saved = await repo.put("readerNotes", note); setNotes((items) => [...items, saved]); setNoteText(""); setNotice("筆記已儲存。");
  }
  async function toggleBookmark() {
    if (!state || !activeChapter) return;
    const anchor = state.contentAnchor || anchorFor(paragraphs[0] || "", 0); const existing = bookmarks.find((item) => item.chapterId === activeChapter.id && item.anchor === anchor);
    if (existing) { await repo.remove("readerBookmarks", existing.id); setBookmarks((items) => items.filter((item) => item.id !== existing.id)); setNotice("已移除書籤。"); return; }
    const bookmark: ReaderBookmark = { ...makeRecord(projectId), chapterId: activeChapter.id, anchor, excerpt: paragraphs[0]?.slice(0, 180) || "", label: activeChapter.title, needsRelocation: false };
    const saved = await repo.put("readerBookmarks", bookmark); setBookmarks((items) => [...items, saved]); setNotice("已加入書籤。");
  }
  if (!project || !state) return <main className="readerEmpty"><p>{notice || "正在載入…"}</p><button onClick={() => void load()}>重新載入</button></main>;
  const bookmarked = bookmarks.some((item) => item.chapterId === activeChapter?.id && item.anchor === state.contentAnchor);
  return <main className={`readerShell reader-${state.theme}`} style={{ "--reader-size": `${state.fontSize}px`, "--reader-line": state.lineHeight, "--reader-width": `${state.contentWidth}px`, "--reader-space": `${state.paragraphSpacing}px`, fontFamily: state.fontFamily } as React.CSSProperties}>
    <header className="readerTop"><Link href={`/studio/project/${projectId}/write`}>返回寫作</Link><span>{state.percentage}%</span><div><button onClick={() => window.scrollTo({ top: state.scrollTop })}>回到上次位置</button><button onClick={() => void toggleBookmark()}>{bookmarked ? "移除書籤" : "加入書籤"}</button></div></header>
    <section className="readerControls" aria-label="閱讀設定"><label>主題<select value={state.theme} onChange={(event) => void saveState({ theme: event.target.value as Theme })}>{themes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>字級<input type="range" min="16" max="30" value={state.fontSize} onChange={(event) => void saveState({ fontSize: Number(event.target.value) })}/></label><label>行距<input type="range" min="1.4" max="2.5" step=".1" value={state.lineHeight} onChange={(event) => void saveState({ lineHeight: Number(event.target.value) })}/></label><label>內文寬度<input type="range" min="320" max="920" step="20" value={state.contentWidth} onChange={(event) => void saveState({ contentWidth: Number(event.target.value) })}/></label></section>
    {chapters.length > 1 && <nav className="readerDirectory" aria-label="章節目錄">{chapters.map((chapter) => <button key={chapter.id} className={chapter.id === activeChapter?.id ? "active" : ""} onClick={() => void saveState({ chapterId: chapter.id, positionType: "ratio", positionValue: 0, contentAnchor: null, scrollTop: 0, percentage: 0 })}>{chapter.title}</button>)}</nav>}
    <article ref={articleRef} className="readerArticle"><header><small>{project.genreId || "小說"}</small><h1>{project.title}</h1><h2>{activeChapter?.title || "尚未建立章節"}</h2></header>{paragraphs.length ? paragraphs.map((paragraph, index) => <p key={index} data-reader-anchor={anchorFor(paragraph, index)}>{paragraph}</p>) : <p className="readerNoContent">這一章尚未有正文。回到寫作區開始創作。</p>}<section className="readerNote"><label>新增筆記<textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="記下這段文字帶給你的想法"/></label><button onClick={() => void addNote()} disabled={!noteText.trim()}>儲存筆記</button></section><section className="readerNotes"><h2>本書筆記與書籤</h2>{notes.map((note) => <article key={note.id}><b>{note.needsRelocation ? "需要重新定位的筆記" : "筆記"}</b><p>{note.content}</p><button onClick={() => void repo.remove("readerNotes", note.id).then(() => setNotes((items) => items.filter((item) => item.id !== note.id)))}>刪除</button></article>)}{bookmarks.map((bookmark) => <article key={bookmark.id}><b>書籤</b><p>{bookmark.label || "未命名位置"}</p></article>)}</section></article>
    {notice && <p className="readerNotice" role="status">{notice}</p>}
  </main>;
}
