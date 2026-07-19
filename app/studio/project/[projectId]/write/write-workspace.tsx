"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Chapter, NovelProject } from "@/lib/novel-ai/domain";
import { makeRecord } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import { mirrorChapterToLegacyStudio } from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import ProjectNavigation from "../project-navigation";

export default function WriteWorkspace({ projectId }: { projectId: string }) {
  const [project,setProject]=useState<NovelProject|null>(null),[chapter,setChapter]=useState<Chapter|null>(null),[title,setTitle]=useState("第一章"),[content,setContent]=useState(""),[status,setStatus]=useState("正在讀取作品……"),[loaded,setLoaded]=useState(false);
  useEffect(()=>{void(async()=>{try{const repo=createNovelRepository(),p=await repo.get<NovelProject>("projects",projectId);setProject(p);const chapters=await repo.list<Chapter>("chapters",projectId),active=chapters.find((x)=>x.id===p?.activeChapterId)||chapters.sort((a,b)=>a.order-b.order)[0]||null;setChapter(active);if(active){setTitle(active.title);setContent(active.content)}setStatus(p?"已載入":"找不到作品") }catch(e){setStatus(e instanceof Error?e.message:"讀取失敗")}finally{setLoaded(true)}})()},[projectId]);
  async function save(){try{setStatus("儲存中……");const repo=createNovelRepository(),base=chapter??{...makeRecord(projectId),title,order:1,content:"",summary:null,status:"draft" as const},next=await repo.put<Chapter>("chapters",{...base,title,content,status:"draft"},chapter?.revision);setChapter(next);if(project&&project.activeChapterId!==next.id){const updated=await repo.put<NovelProject>("projects",{...project,activeChapterId:next.id},project.revision);setProject(updated)}mirrorChapterToLegacyStudio(projectId,title,content);setStatus(`已儲存 ${new Date().toLocaleTimeString("zh-TW")}`)}catch(e){setStatus(`儲存失敗：${e instanceof Error?e.message:"請重試"}`)}}
  if(!loaded)return <main className="p2ProjectShell"><p>{status}</p></main>;
  if(!project)return <main className="p2ProjectShell"><h1>找不到作品</h1><p>{status}</p><Link href="/studio">回到創作中心</Link></main>;
  return <main className="p2ProjectShell"><header><Link href="/studio">← 我的作品</Link><div><small>{project.title}</small><h1>專注寫作</h1></div><span>{status}</span></header><ProjectNavigation projectId={projectId} active="write"/><section className="p2WritingWorkspace"><aside><h2>章節</h2><button className="active">{title}</button><p>新作品可以先自由寫作，其他設定稍後再補。</p></aside><article><input aria-label="章節標題" value={title} onChange={(e)=>setTitle(e.target.value)}/><textarea aria-label="正文" value={content} onChange={(e)=>setContent(e.target.value)} placeholder="從這裡開始寫你的故事……"/><footer><span>{content.replace(/\s/g,"").length} 字</span><button onClick={save}>儲存目前內容</button></footer></article><aside><h2>本章參考</h2><p>{project.coreIdea.value||"目前沒有固定設定。你可以自由發展故事。"}</p><details><summary>AI 使用方式</summary><p>預設只使用本機能力；外部 AI 必須由你明確啟用。</p></details></aside></section></main>;
}
