"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { STORY_LIBRARY, listStoryTopics, resolveStoryTopic } from "@/lib/novel-data/story-library";
import { buildProjectBundle, buildSeedCandidate, createDraft } from "@/lib/novel-ai/domain/creation";
import { optionalValue, type ProjectCreationDraft } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import { migrateLegacyStudioProjects, mirrorProjectToLegacyStudio } from "@/lib/novel-ai/repository/migration/legacy-studio-migration";

const DRAFT_KEY = "novel_p2_creation_draft";
const questions = [
  { key: "story", title: "想寫什麼樣的故事？", choices: ["一段改變命運的冒險", "一場人物關係的考驗", "一個逐步揭開的謎團"] },
  { key: "goal", title: "主角最想得到什麼？", choices: ["守住所愛的人與生活", "證明自己的選擇是對的", "找回失去的真相或身分"] },
  { key: "obstacle", title: "主要阻力是什麼？", choices: ["強大的對手與制度", "主角自己的恐懼與缺點", "時間、資源與信任逐漸耗盡"] },
  { key: "worldRule", title: "世界最特殊的規則是什麼？", choices: ["每次獲得力量都必須付出代價", "真相只能由行動證明", "看似平凡的秩序隱藏另一套規則"] },
  { key: "opening", title: "第一章從哪裡開始？", choices: ["主角收到一個無法忽視的消息", "日常秩序突然被打破", "主角必須立刻做出一次選擇"] },
] as const;

function safeLoadDraft() {
  if (typeof localStorage === "undefined") return createDraft();
  try { const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); return parsed?.schemaVersion ? parsed as ProjectCreationDraft : createDraft(); } catch { return createDraft(); }
}

export default function CreateProjectClient() {
  const [draft, setDraft] = useState<ProjectCreationDraft>(() => createDraft()), [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState(""), [createdId, setCreatedId] = useState<string | null>(null), requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    const repository = createNovelRepository();
    void migrateLegacyStudioProjects(repository);
    const restoreTimer = window.setTimeout(() => {
      setDraft(safeLoadDraft());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); }, [draft, ready]);
  const topics = useMemo(() => listStoryTopics({ packId: draft.genrePackId || undefined, limit: 40 }), [draft.genrePackId]);
  const topic = resolveStoryTopic(draft.genreId);
  const modeSteps = draft.mode === "guided" ? 5 : draft.mode === "blank" ? 1 : 3;
  const set = (partial: Partial<ProjectCreationDraft>) => setDraft((value) => ({ ...value, ...partial, updatedAt: new Date().toISOString() }));
  const setAnswer = (key: string, value: string | null, status: "user_defined" | "deferred" = "user_defined") => set({ answers: { ...draft.answers, [key]: optionalValue(value, status) } });
  const chooseMode = (mode: ProjectCreationDraft["mode"]) => { const next = createDraft(mode); next.title = draft.title; setDraft(next); requestId.current = crypto.randomUUID(); };
  const seed = draft.seedCandidate ?? buildSeedCandidate(draft);
  async function finish() {
    if (saving) return; setSaving(true); setMessage("正在建立作品與安全備份……");
    try {
      const repository = createNovelRepository(), withSeed = { ...draft, seedCandidate: seed }, bundle = buildProjectBundle(withSeed);
      await repository.createProject(bundle, requestId.current);
      mirrorProjectToLegacyStudio(bundle);
      localStorage.setItem("novel_p2_active_project_id", bundle.project.id); localStorage.removeItem(DRAFT_KEY); setCreatedId(bundle.project.id); setMessage("作品已完整建立，初始設定與備份均已保存。");
    } catch (error) { setMessage(`建立失敗：${error instanceof Error ? error.message : "請稍後再試"}。既有作品沒有被修改。`); } finally { setSaving(false); }
  }
  if (!ready) return <main className="p2CreateShell"><p>正在讀取你的創作資料……</p></main>;
  if (createdId) return <main className="p2CreateShell"><section className="p2CreateSuccess"><span>建立完成</span><h1>{draft.title.trim() || "未命名作品"}</h1><p>{message}</p><div><Link className="primaryAction" href={`/studio/project/${createdId}/write`}>開始寫作</Link><Link className="secondaryAction" href="/studio">回到創作中心</Link></div></section></main>;
  return <main className="p2CreateShell">
    <header><Link href="/studio">← 返回創作中心</Link><div><span>建立新作品</span><h1>從一個想法開始</h1><p>設定都可以稍後補充；空白不是錯誤。</p></div><small>資料先保存在這個瀏覽器</small></header>
    <nav className="p2ModeTabs" aria-label="建立方式">
      <button className={draft.mode === "quick" ? "active" : ""} onClick={() => chooseMode("quick")}><b>快速建立</b><span>提供少量資料，先看故事雛形</span></button>
      <button className={draft.mode === "guided" ? "active" : ""} onClick={() => chooseMode("guided")}><b>引導建立</b><span>用五個問題慢慢整理想法</span></button>
      <button className={draft.mode === "blank" ? "active" : ""} onClick={() => chooseMode("blank")}><b>空白建立</b><span>只要名稱就能開始寫</span></button>
    </nav>
    <div className="p2CreateLayout"><section className="p2CreatePanel">
      <div className="p2StepBar" aria-label={`第 ${draft.step} 步，共 ${modeSteps} 步`}>{Array.from({ length: modeSteps }, (_, i) => <i key={i} className={i < draft.step ? "done" : ""} />)}</div>
      {draft.mode === "blank" ? <Blank draft={draft} set={set} /> : draft.mode === "guided" ? <Guided draft={draft} setAnswer={setAnswer} /> : <Quick draft={draft} set={set} topics={topics} />}
      <footer><button disabled={draft.step <= 1} onClick={() => set({ step: Math.max(1, draft.step - 1) })}>上一步</button>{draft.step < modeSteps ? <button className="gold" onClick={() => set({ step: Math.min(modeSteps, draft.step + 1), seedCandidate: draft.step + 1 === modeSteps ? buildSeedCandidate(draft) : draft.seedCandidate })}>繼續</button> : <button className="gold" disabled={saving} onClick={finish}>{saving ? "建立中……" : "建立作品"}</button>}</footer>{message && <p className="p2CreateMessage" role="status">{message}</p>}
    </section><aside className="p2SeedPreview"><span>故事雛形</span><h2>{draft.title.trim() || "未命名作品"}</h2><dl><div><dt>題材</dt><dd>{topic?.name || "尚未設定"}</dd></div><div><dt>核心想法</dt><dd>{draft.coreIdea.value || "稍後補充"}</dd></div><div><dt>主角</dt><dd>{seed.protagonist.value || "稍後補充"}</dd></div><div><dt>主要阻力</dt><dd>{seed.conflict.value || "稍後補充"}</dd></div><div><dt>第一章起點</dt><dd>{seed.opening.value || "稍後補充"}</dd></div></dl><p>只有你主動填寫或接受的內容會成為正式設定。</p></aside></div>
  </main>;
}

function Blank({ draft, set }: { draft: ProjectCreationDraft; set: (p: Partial<ProjectCreationDraft>) => void }) { return <div className="p2CreateFields"><h2>先替作品取個名字</h2><label>作品名稱（可留白）<input value={draft.title} placeholder="未命名作品" onChange={(e) => set({ title: e.target.value })} /></label><p>建立後可以直接進入寫作，人物、世界與大綱都能邊寫邊補。</p></div>; }
function Quick({ draft, set, topics }: { draft: ProjectCreationDraft; set: (p: Partial<ProjectCreationDraft>) => void; topics: ReturnType<typeof listStoryTopics> }) {
  if (draft.step === 1) return <div className="p2CreateFields"><h2>選擇故事方向</h2><label>分類包（選填）<select value={draft.genrePackId || ""} onChange={(e) => set({ genrePackId: e.target.value || null, genreId: null })}><option value="">暫時略過</option>{STORY_LIBRARY.packs.filter((x) => x.enabled).map((x) => <option key={x.packId} value={x.packId}>{x.name}</option>)}</select></label><div className="p2TopicGrid">{topics.slice(0, 18).map((item) => <button key={item.topicId} className={draft.genreId === item.topicId ? "active" : ""} onClick={() => set({ genreId: item.topicId })}><b>{item.name}</b><span>{item.description}</span></button>)}</div></div>;
  if (draft.step === 2) return <div className="p2CreateFields"><h2>放入你的核心想法</h2><label>作品名稱（選填）<input value={draft.title} onChange={(e) => set({ title: e.target.value })} /></label><label>核心想法（選填）<textarea value={draft.coreIdea.value || ""} onChange={(e) => set({ coreIdea: optionalValue(e.target.value || null, e.target.value ? "user_defined" : "deferred") })} /></label><label>主角（選填）<input value={draft.protagonist.value || ""} onChange={(e) => set({ protagonist: optionalValue(e.target.value || null, e.target.value ? "user_defined" : "deferred") })} /></label></div>;
  return <SeedEditor draft={draft} set={set} />;
}
function Guided({ draft, setAnswer }: { draft: ProjectCreationDraft; setAnswer: (key: string, value: string | null, status?: "user_defined" | "deferred") => void }) { const q = questions[Math.min(questions.length - 1, draft.step - 1)], selected = draft.answers[q.key]?.value; return <div className="p2CreateFields"><span>第 {draft.step} 題／共 5 題</span><h2>{q.title}</h2><div className="p2GuidedChoices">{q.choices.map((choice, index) => <button key={choice} className={selected === choice ? "active" : ""} onClick={() => setAnswer(q.key, choice)}><b>{String.fromCharCode(65 + index)}</b>{choice}</button>)}</div><label>自己輸入（選填）<input value={selected && !q.choices.some((choice) => choice === selected) ? selected : ""} onChange={(e) => setAnswer(q.key, e.target.value || null, e.target.value ? "user_defined" : "deferred")} /></label><button onClick={() => setAnswer(q.key, null, "deferred")}>暫時跳過</button></div>; }
function SeedEditor({ draft, set }: { draft: ProjectCreationDraft; set: (p: Partial<ProjectCreationDraft>) => void }) { const seed = draft.seedCandidate ?? buildSeedCandidate(draft); return <div className="p2CreateFields"><h2>確認故事雛形</h2><label>暫定書名<input value={draft.title} placeholder="未命名作品" onChange={(e) => set({ title: e.target.value, seedCandidate: { ...seed, titleCandidates: [e.target.value || "未命名作品"] } })} /></label><label>一句話故事<textarea value={seed.logline.value || ""} onChange={(e) => set({ seedCandidate: { ...seed, logline: optionalValue(e.target.value || null, e.target.value ? "user_defined" : "deferred") } })} /></label><p>你可以保持任何欄位空白，建立作品後再補。</p></div>; }
