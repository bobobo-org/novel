"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WebLocalRuntimeClient } from "@/lib/novel-ai/web/local-runtime-client";

type Status = { api: string; database: string; model: string; analyzer: string; error: string; raw: unknown };

export default function ProfessionalClient() {
  const [status,setStatus]=useState<Status>({api:"正在檢查",database:"正在檢查",model:"正在檢查",analyzer:"正在檢查",error:"",raw:null}),
    [local,setLocal]=useState("正在檢查"),[backups,setBackups]=useState(0);
  const reload=async()=>{setStatus((value)=>({...value,api:"正在檢查",error:""}));try{const response=await fetch("/api/ai/health",{cache:"no-store"}),raw=await response.json();if(!response.ok)throw new Error(raw?.userMessage||`狀態碼 ${response.status}`);setStatus({api:"正常",database:raw.databaseStatus==="reachable"?"正常":"需要注意",model:raw.model||raw.modelId||"尚未啟動",analyzer:raw.analyzerVersion||raw.storyAnalyzerVersion||"尚未提供",error:"",raw})}catch(reason){setStatus({api:"載入失敗",database:"無法確認",model:"無法確認",analyzer:"無法確認",error:reason instanceof Error?reason.message:"未知錯誤",raw:null})}try{const token=sessionStorage.getItem("novel_local_runtime_token")||undefined,snapshot=await new WebLocalRuntimeClient({token,timeoutMs:2500}).discover();setLocal(snapshot.status==="ready"?(snapshot.ollamaStatus==="ready"?"本機 AI 已連線":"本機創作服務已連線"):snapshot.status==="auth_required"?"需要本機授權":"尚未啟動")}catch{setLocal("尚未啟動")}try{const saved=JSON.parse(localStorage.getItem("novel_p12_studio_state")||"null");setBackups(Array.isArray(saved?.backups)?saved.backups.length:0)}catch{setBackups(0)}};
  useEffect(()=>{const timer=setTimeout(()=>void reload(),0);return()=>clearTimeout(timer)},[]);
  const groups=[
    {title:"AI 與執行狀態",items:[`本機故事系統：${status.api}`,`本機 AI：${local}`,"瀏覽器 AI：建置中","外部 AI：預設未啟用","內容隱私：預設不離開裝置"]},
    {title:"故事資料",items:["前文搜尋與 AI 參考資料","Story Bible 候選與正式記憶","時間線、伏筆與人物世界資料","資料完整性檢查"]},
    {title:"版本與建議稿",items:["草稿與建議稿","正式版本與版本差異","故事分支與安全回復"]},
    {title:"資料管理",items:[`消費者備份：${backups?`${backups} 份`:'尚未建立'}`,"匯入、匯出與資料轉換","本機儲存診斷"]},
    {title:"系統檢查",items:[`後端服務：${status.api}`,`作品資料：${status.database}`,`雲端分析模型：${status.model}`,`故事分析器：${status.analyzer}`]},
  ];
  return <><section className="professionalSummary"><article><small>本機故事系統</small><b>{status.api}</b></article><article><small>本機 AI</small><b>{local}</b></article><article><small>作品資料</small><b>{status.database}</b></article><article><small>最近備份</small><b>{backups?`${backups} 份`:"尚未建立"}</b></article></section>{status.error&&<div className="backupError" role="alert">資料載入失敗：{status.error}<button onClick={()=>void reload()}>重新嘗試</button></div>}<section className="professionalGrid">{groups.map((group)=><article key={group.title}><h2>{group.title}</h2><ul>{group.items.map((item)=><li key={item}>{item}</li>)}</ul>{group.title==="資料管理"&&<Link href="/studio?screen=backup">開啟備份中心</Link>}{group.title==="故事資料"&&<a href="/legacy/novel-system.html?mode=professional">開啟完整故事資料工具</a>}{group.title==="版本與建議稿"&&<a href="/legacy/novel-system.html?mode=professional">開啟版本工具</a>}</article>)}</section><section className="professionalLegacy"><h2>Legacy 工具</h2><p>尚未產品化的 AI 書籍拆解、多章批量操作與 ChatNovel 保留在完整舊版工具中。</p><a href="/legacy/novel-system.html?mode=professional">開啟完整舊版工具</a></section><details className="professionalRaw"><summary>查看詳細技術資料</summary><pre>{status.raw?JSON.stringify(status.raw,null,2):"目前沒有相關資料。"}</pre></details></>;
}
