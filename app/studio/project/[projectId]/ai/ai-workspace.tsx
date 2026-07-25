"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Character, Chapter, NovelProject, StoryBible, StoryBranch, StoryState, TimelineEvent, WorldRule } from "@/lib/novel-ai/domain";
import { ClosedStoryGenerationLoop, PlatformGenerationProviderAdapter, packageGenerationCandidateForApproval, type GenerationCandidate, type GenerationProgressEvent, type GenerationTaskType } from "@/lib/novel-ai/generation-loop";
import type { StoryIntelligenceFact, StorySource, TraceableMemory } from "@/lib/novel-ai/story-intelligence";
import { createNovelRepository, type NovelRepository } from "@/lib/novel-ai/repository";
import { acceptStudioChoice } from "@/lib/novel-ai/repository/studio-canonical";
import type { PersonaProfileId } from "@/lib/novel-ai/persona";
import ProjectNavigation from "../project-navigation";

type WorkspaceData = {
  project: NovelProject;
  chapter: Chapter;
  chapters: Chapter[];
  characters: Character[];
  worldRules: WorldRule[];
  timeline: TimelineEvent[];
  storyBible: StoryBible;
  storyState: StoryState;
  branches: StoryBranch[];
};

const taskLabels: Record<GenerationTaskType, string> = {
  continue_writing: "續寫下一段",
  rewrite: "改寫目前章節",
  dialogue_generation: "加強角色對話",
  scene_expansion: "擴寫目前場景",
  outline_generation: "規劃後續情節",
};

const personaOptions: Array<[PersonaProfileId, string]> = [
  ["fiction_writer", "小說創作"],
  ["rigorous_advisor", "嚴謹顧問"],
  ["open_discussion", "開放討論"],
  ["adversarial_critic", "對抗式批評"],
  ["deep_reasoning", "深度研究推理"],
  ["adult_fiction", "成人小說"],
];

function source(record: { id: string; revision: number }, text: string): StorySource {
  return { sourceChapterId: record.id, sourceRevision: String(record.revision), evidenceExcerpt: text, start: 0, end: text.length };
}

function memory(input: {
  id: string;
  kind: TraceableMemory["kind"];
  text: string;
  record: { id: string; revision: number };
  projectId: string;
  order?: number;
}): TraceableMemory {
  return {
    memoryId: input.id,
    kind: input.kind,
    text: input.text,
    source: source(input.record, input.text),
    metadata: { projectId: input.projectId, entityIds: [input.record.id], canonical: true, visibility: "private", chapterOrder: input.order },
  };
}

function buildContext(data: WorkspaceData) {
  const memories: TraceableMemory[] = [];
  const facts: StoryIntelligenceFact[] = [];
  for (const chapter of data.chapters.filter((item) => item.id !== data.chapter.id)) {
    if (chapter.content.trim()) memories.push(memory({ id: `chapter:${chapter.id}`, kind: "recent_chapter", text: chapter.content, record: chapter, projectId: data.project.id, order: chapter.order }));
  }
  for (const character of data.characters) {
    const text = [`人物：${character.name}`, character.identity.value ? `身分：${character.identity.value}` : "", character.personality.value ? `性格：${character.personality.value}` : "", character.goal.value ? `目標：${character.goal.value}` : "", `生存狀態：${character.lifeStatus}`].filter(Boolean).join("；");
    const factSource = source(character, text);
    memories.push(memory({ id: `character:${character.id}`, kind: "character", text, record: character, projectId: data.project.id }));
    facts.push({ factId: `character-name:${character.id}`, entityType: "character", entityId: character.id, field: "name", value: character.name, factType: "explicit", sources: [factSource], confidence: 1, createdAt: character.createdAt, updatedAt: character.updatedAt });
  }
  for (const rule of data.worldRules) {
    const text = `世界規則：${rule.title}。${rule.description}`;
    const factSource = source(rule, text);
    memories.push(memory({ id: `world-rule:${rule.id}`, kind: "world_rule", text, record: rule, projectId: data.project.id }));
    facts.push({ factId: `world-rule:${rule.id}`, entityType: "world_rule", entityId: rule.id, field: "description", value: rule.description, factType: "explicit", sources: [factSource], confidence: 1, createdAt: rule.createdAt, updatedAt: rule.updatedAt });
  }
  for (const event of data.timeline) {
    const text = `時間線：${event.storyTime ?? "時間未定"}，${event.title}。${event.summary}`;
    memories.push(memory({ id: `timeline:${event.id}`, kind: "event", text, record: event, projectId: data.project.id }));
  }
  data.storyBible.unresolvedThreads.forEach((thread, index) => memories.push(memory({ id: `thread:${index}`, kind: "plot_thread", text: thread, record: data.storyBible, projectId: data.project.id })));
  data.storyBible.foreshadowing.forEach((thread, index) => memories.push(memory({ id: `foreshadowing:${index}`, kind: "foreshadowing", text: thread, record: data.storyBible, projectId: data.project.id })));
  return { memories, facts };
}

function errorMessage(cause: unknown) {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  if (code === "CLOSED_PROVIDER_UNAVAILABLE") return "本機 AI 尚未就緒。請先到 AI 設定完成配對並選擇模型。";
  if (code === "PROVIDER_RUNTIME_NOT_CONNECTED" || code === "NO_PROVIDER_AVAILABLE" || code === "NO_CLOSED_PROVIDER_AVAILABLE") return "本機 AI 尚未就緒。請先到 AI 設定完成配對並選擇模型。系統不會改用外部 AI。";
  if (code === "ADULT_FICTION_CONTEXT_REJECTED") return "成人小說模式需要作品主動啟用，且所有相關角色年齡都有明確成人證據。";
  if (code === "GENERATION_SOURCE_REVISION_STALE") return "章節在生成期間已修改，請重新載入後再產生。";
  return cause instanceof Error ? cause.message : "這次生成沒有成功，請重新嘗試。";
}

export default function AiWorkspace({ projectId }: { projectId: string }) {
  const repositoryRef = useRef<NovelRepository | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [status, setStatus] = useState("正在讀取作品……");
  const [taskType, setTaskType] = useState<GenerationTaskType>("continue_writing");
  const [persona, setPersona] = useState<PersonaProfileId>("fiction_writer");
  const [instruction, setInstruction] = useState("延續目前衝突，讓角色的選擇帶來可追蹤的後果。");
  const [progress, setProgress] = useState<GenerationProgressEvent[]>([]);
  const [candidates, setCandidates] = useState<GenerationCandidate[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const repository = repositoryRef.current ?? createNovelRepository();
    repositoryRef.current = repository;
    const project = await repository.get<NovelProject>("projects", projectId);
    if (!project) throw new Error("找不到作品。");
    const chapters = (await repository.list<Chapter>("chapters", projectId)).sort((a, b) => a.order - b.order);
    const chapter = chapters.find((item) => item.id === project.activeChapterId) ?? chapters[0];
    const [characters, worldRules, timeline, storyBibles, storyStates, branches] = await Promise.all([
      repository.list<Character>("characters", projectId),
      repository.list<WorldRule>("worldRules", projectId),
      repository.list<TimelineEvent>("timeline", projectId),
      repository.list<StoryBible>("storyBibles", projectId),
      repository.list<StoryState>("storyStates", projectId),
      repository.listStoryBranches(projectId),
    ]);
    if (!chapter || !storyBibles[0] || !storyStates[0]) throw new Error("作品尚缺少可生成的章節或故事狀態。");
    setData({ project, chapter, chapters, characters, worldRules, timeline, storyBible: storyBibles[0], storyState: storyStates[0], branches });
    setStatus("作品資料已就緒");
  }, [projectId]);

  useEffect(() => { void load().catch((cause) => setStatus(errorMessage(cause))); }, [load]);

  async function generate() {
    if (!data || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setCandidates([]);
    setProgress([]);
    setStatus("本機 AI 正在理解任務……");
    try {
      const context = buildContext(data);
      const activeBranch = data.branches.find((branch) => branch.status === "active");
      const result = await new ClosedStoryGenerationLoop(new PlatformGenerationProviderAdapter()).run({
        requestId: `studio-ai-${crypto.randomUUID()}`,
        projectId,
        branchId: activeBranch?.branchId ?? "root",
        taskType,
        authorInstruction: instruction.trim() || taskLabels[taskType],
        currentText: data.chapter.content,
        currentChapterId: data.chapter.id,
        sourceRevision: String(data.chapter.revision),
        storyRevision: data.project.revision,
        memories: context.memories,
        canonicalFacts: context.facts,
        constraints: data.storyBible.forbiddenContradictions,
        styleProfile: [data.project.narrativeStyle.value, data.storyBible.style.value].filter((value): value is string => Boolean(value)),
        multiCandidate: true,
        qualityThreshold: 70,
        personaProfile: persona,
        maxCritiqueRounds: 1,
        signal: controller.signal,
        getCurrentSourceRevision: async () => String((await repositoryRef.current!.get<Chapter>("chapters", data.chapter.id))?.revision ?? -1),
        onProgress: (event) => setProgress((items) => {
          const index = items.findIndex((item) => item.stage === event.stage && item.candidateIntent === event.candidateIntent);
          if (index < 0) return [...items, event];
          return items.map((item, itemIndex) => itemIndex === index ? event : item);
        }),
      });
      setCandidates(result.candidates);
      setStatus(result.recommendedCandidateId ? "候選已完成，等待你決定" : "候選未通過品質門檻，沒有寫入作品");
    } catch (cause) {
      const message = errorMessage(cause);
      setStatus(message);
      setProgress((items) => items.map((item) => item.status === "running" ? { ...item, status: "failed", message } : item));
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  async function accept(candidate: GenerationCandidate) {
    if (!data || candidate.status !== "awaiting_approval") return;
    setStatus("正在以安全 transaction 採用候選……");
    try {
      const repository = repositoryRef.current!;
      const packaged = packageGenerationCandidateForApproval({ candidate, chapterId: data.chapter.id, chapterRevision: data.chapter.revision, storyStateRevision: data.storyState.revision, storyBibleRevision: data.storyBible.revision });
      await repository.put("candidates", packaged);
      const result = await acceptStudioChoice(repository, packaged.id, candidate.finalCandidate, candidate.differenceSummary);
      setStatus(result.replayed ? "這份候選先前已採用，沒有重複寫入" : "已採用並建立正式故事版本");
      setCandidates((items) => items.filter((item) => item.candidateId !== candidate.candidateId));
      await load();
    } catch (cause) {
      setStatus(errorMessage(cause));
    }
  }

  if (!data) return <main className="p2ProjectShell"><p>{status}</p></main>;
  return <main className="p2ProjectShell">
    <header><Link href="/studio">← 我的作品</Link><div><small>{data.project.title}</small><h1>閉端 AI 創作</h1></div><span>{status}</span></header>
    <ProjectNavigation projectId={projectId} active="ai" />
    <section className="p23AiWorkspace">
      <div className="p23AiControls">
        <label>這次要做什麼<select value={taskType} onChange={(event) => setTaskType(event.target.value as GenerationTaskType)}>{Object.entries(taskLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>回應方式<select value={persona} onChange={(event) => setPersona(event.target.value as PersonaProfileId)}>{personaOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>你的要求<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
        <div className="p23AiActions"><button disabled={running} onClick={() => void generate()}>{running ? "正在生成……" : "產生三份候選"}</button>{running ? <button className="secondary" onClick={() => abortRef.current?.abort()}>取消</button> : null}</div>
        <p>只使用已配對的閉端執行者。未配對時會明確失敗，不會改用外部 AI。</p><Link href="/studio/settings/ai">本機 AI 設定</Link>
      </div>
      <div className="p23AiMain">
        <section className="p23AiProgress" aria-live="polite"><h2>工作流程</h2>{progress.length === 0 ? <p>尚未開始。本機 AI 會先讀取作品，再規劃、檢查及修訂。</p> : <ol>{progress.map((event, index) => <li key={`${event.at}-${index}`} data-status={event.status}><strong>{event.status === "running" ? "進行中" : event.status === "success" ? "完成" : event.status === "skipped" ? "略過" : "失敗"}</strong><span>{event.message}</span></li>)}</ol>}</section>
        <section className="p23CandidateList">{candidates.map((candidate) => <article key={candidate.candidateId}>
          <header><div><small>{candidate.differenceSummary}</small><h2>{candidate.status === "awaiting_approval" ? "可採用候選" : "需要重新處理"}</h2></div><span>{candidate.confidence} 分</span></header>
          <p className="p23CandidateText">{candidate.finalCandidate}</p>
          <div className="p23CandidateMeta">
            <section><h3>主要規劃</h3><ul>{candidate.plan.map((item) => <li key={item}>{item}</li>)}</ul></section>
            <section><h3>為何推薦</h3><p>{candidate.reasoningSummary.recommendationReason}</p></section>
            <section><h3>關鍵風險</h3>{candidate.riskHints.length ? <ul>{candidate.riskHints.map((item) => <li key={item}>{item}</li>)}</ul> : <p>未發現明顯風險。</p>}</section>
            <section><h3>使用的作品資料</h3><p>{candidate.retrievedMemory.sourceReferences.length} 筆可追蹤來源</p></section>
          </div>
          <div className="p23AiActions"><button disabled={candidate.status !== "awaiting_approval"} onClick={() => void accept(candidate)}>採用並建立版本</button><button className="secondary" onClick={() => setCandidates((items) => items.filter((item) => item.candidateId !== candidate.candidateId))}>暫時不用</button></div>
          <details><summary>查看技術資訊</summary><p>執行來源：{candidate.provider}｜模型：{candidate.model}｜外部請求：否｜正式作品寫入：0｜來源版本：{candidate.sourceRevision}</p></details>
        </article>)}</section>
      </div>
    </section>
  </main>;
}
