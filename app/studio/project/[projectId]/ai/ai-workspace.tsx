"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Character,
  Chapter,
  NovelProject,
  StoryBible,
  StoryBranch,
  StoryState,
  TimelineEvent,
  WorldRule,
} from "@/lib/novel-ai/domain";
import type {
  ClosedAIBackendId,
  ClosedAIProgressEvent,
  ClosedAIQualityMode,
  ClosedAgentExecutionResult,
} from "@/lib/novel-ai/closed-agent-os";
import type { GenerationTaskType } from "@/lib/novel-ai/generation-loop";
import type { PersonaProfileId } from "@/lib/novel-ai/persona";
import { createNovelRepository, type NovelRepository } from "@/lib/novel-ai/repository";
import { mirrorChapterToLegacyStudio } from "@/lib/novel-ai/repository/migration/legacy-studio-migration";
import {
  buildApprovedLearningContext,
  createSovereignLearningRepository,
  evaluateLearningOriginality,
  recordSovereignLearningFeedback,
} from "@/lib/novel-ai/sovereign-learning";
import {
  approveStudioClosedAgentCandidate,
  executeStudioClosedAgent,
  rejectStudioClosedAgentCandidate,
  type StudioClosedAgentContext,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import type { PlatformTaskType } from "@/lib/novel-ai/router/platform-types";
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

type CandidateView = {
  result: ClosedAgentExecutionResult;
  intent: string;
  sourceChapterId: string;
  sourceRevision: number;
  learningRuleIds: string[];
};

const taskOptions: Array<[GenerationTaskType, string, PlatformTaskType]> = [
  ["continue_writing", "續寫目前章節", "chapter.continue"],
  ["rewrite", "改寫目前章節", "chapter.rewrite"],
  ["dialogue_generation", "生成角色對話", "character.dialogue"],
  ["scene_expansion", "擴寫場景", "chapter.expand"],
  ["outline_generation", "規劃章節大綱", "chapter.outline"],
];

const personaOptions: Array<[PersonaProfileId, string]> = [
  ["fiction_writer", "小說作者"],
  ["rigorous_advisor", "嚴謹顧問"],
  ["open_discussion", "開放討論"],
  ["adversarial_critic", "反方批評"],
  ["deep_reasoning", "深度推理"],
  ["adult_fiction", "成人虛構"],
];

const candidateIntents = [
  ["穩健延續", "優先承接上一段行動與已核准設定。"],
  ["衝突升級", "增加具體阻礙與代價，但不得改寫 Canon。"],
  ["意外轉折", "提出可解釋的新轉折，避免無來源新增重大事實。"],
] as const;

function taskPlatformType(task: GenerationTaskType) {
  return taskOptions.find(([value]) => value === task)?.[2] ?? "chapter.continue";
}

function errorMessage(cause: unknown) {
  const code = String((cause as { code?: string })?.code || "");
  if (
    code === "CLOSED_AI_SELECTED_BACKEND_NOT_READY"
    || code === "CLOSED_AI_REQUIRED_BACKEND_NOT_READY"
    || code === "NO_PROVIDER_AVAILABLE"
    || code === "PROVIDER_RUNTIME_NOT_CONNECTED"
  ) {
    return "本機 AI 尚未就緒；請先到閉端 AI 中心啟動、配對並實測模型。";
  }
  if (code === "CLOSED_AGENT_TASK_CANCELLED" || code === "OLLAMA_CANCELLED") {
    return "工作已取消；未修改 Memory 或 Canon。";
  }
  if (code === "CLOSED_AGENT_EVALUATION_BLOCKED") {
    return "候選未通過 Closed Agent OS 評估，已安全停止。";
  }
  return cause instanceof Error ? cause.message : "閉端 AI 工作失敗，請重試。";
}

function buildContext(data: WorkspaceData, learnedInstructions: string[]): StudioClosedAgentContext[] {
  const context: StudioClosedAgentContext[] = [
    {
      id: `chapter:${data.chapter.id}`,
      kind: "canon",
      text: `目前章節「${data.chapter.title}」：\n${data.chapter.content}`,
      visibility: "both",
    },
  ];
  for (const chapter of data.chapters.filter((item) => item.id !== data.chapter.id && item.content.trim()).slice(-6)) {
    context.push({
      id: `chapter:${chapter.id}`,
      kind: "retrieval",
      text: `前文章節「${chapter.title}」：\n${chapter.content}`,
      visibility: "both",
    });
  }
  for (const character of data.characters) {
    context.push({
      id: `character:${character.id}`,
      kind: "story-bible",
      learningFacet: "character-knowledge",
      text: [
        `角色：${character.name}`,
        character.identity.value ? `身分：${character.identity.value}` : "",
        character.personality.value ? `性格：${character.personality.value}` : "",
        character.goal.value ? `目標：${character.goal.value}` : "",
        character.portrait?.visualDescription ? `核准外觀：${character.portrait.visualDescription}` : "",
        character.portrait?.traits.length ? `外觀特徵：${character.portrait.traits.join("、")}` : "",
        character.rpgProfile ? `RPG 初始能力：${Object.entries(character.rpgProfile.stats).map(([key, value]) => `${key}=${value}`).join("、")}` : "",
        character.dynamicsProfile ? `核准角色動態：${character.dynamicsProfile.archetypeLabel}／${character.dynamicsProfile.socialRole}；特質 ${character.dynamicsProfile.personalityTraits.join("、")}；互動需求 ${character.dynamicsProfile.relationshipNeeds.join("、")}` : "",
        `狀態：${character.lifeStatus}`,
      ].filter(Boolean).join("；"),
      visibility: "both",
    });
  }
  if (data.worldRules.length) {
    context.push({
      id: `world-rules:${data.project.id}`,
      kind: "story-bible",
      text: data.worldRules.map((item) => `${item.title}：${item.description}`).join("\n"),
      visibility: "both",
    });
  }
  if (data.timeline.length) {
    context.push({
      id: `timeline:${data.project.id}`,
      kind: "story-bible",
      text: data.timeline.map((item) => `${item.storyTime ?? "未定時間"}｜${item.title}：${item.summary}`).join("\n"),
      visibility: "both",
    });
  }
  context.push({
    id: `story-bible:${data.storyBible.id}`,
    kind: "story-bible",
    learningFacet: "story-bible",
    text: [
      data.storyBible.theme.value ? `主題：${data.storyBible.theme.value}` : "",
      data.storyBible.style.value ? `風格：${data.storyBible.style.value}` : "",
      data.storyBible.foreshadowing.length ? `伏筆：${data.storyBible.foreshadowing.join("；")}` : "",
      data.storyBible.unresolvedThreads.length ? `未解線索：${data.storyBible.unresolvedThreads.join("；")}` : "",
      data.storyBible.forbiddenContradictions.length ? `禁止矛盾：${data.storyBible.forbiddenContradictions.join("；")}` : "",
    ].filter(Boolean).join("\n") || "Story Bible 尚未補充細節。",
    visibility: "both",
  });
  context.push({
    id: `story-state:${data.storyState.id}`,
    kind: "canon",
    learningFacet: "story-bible",
    text: [
      "正式 StoryState（只有核准交易可改動）：",
      `角色數值：${Object.entries(data.storyState.protagonistStats).map(([key, value]) => `${key}=${value}`).join("、") || "尚未建立"}`,
      `資源：${Object.entries(data.storyState.resources).filter(([, value]) => Number.isFinite(value) && value !== 0).map(([key, value]) => `${key}=${value}`).join("、") || "尚未建立"}`,
      `方向關係：${Object.entries(data.storyState.relationships).map(([key, value]) => `${key}=${value}`).join("、") || "尚未建立"}`,
      `世界旗標：${Object.entries(data.storyState.worldFlags).map(([key, value]) => `${key}=${String(value)}`).join("；") || "尚未建立"}`,
      `位置／時間：${data.storyState.locationState ?? "未知"}／${data.storyState.timeState ?? "未知"}`,
    ].join("\n"),
    visibility: "both",
  });
  if (learnedInstructions.length) {
    context.push({
      id: `approved-learning:${data.project.id}`,
      kind: "memory",
      text: `已核准的 L0／L1 創作規則：\n${learnedInstructions.join("\n")}`,
      visibility: "both",
    });
  }
  return context;
}

export default function AiWorkspace({ projectId }: { projectId: string }) {
  const repositoryRef = useRef<NovelRepository | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const learningRepository = useMemo(() => createSovereignLearningRepository(), []);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [status, setStatus] = useState("正在載入作品與 Closed Agent OS。");
  const [taskType, setTaskType] = useState<GenerationTaskType>("continue_writing");
  const [persona, setPersona] = useState<PersonaProfileId>("fiction_writer");
  const [backend, setBackend] = useState<Extract<ClosedAIBackendId, "local-ollama" | "private-ai-hub">>("local-ollama");
  const [qualityMode, setQualityMode] = useState<ClosedAIQualityMode>("balanced");
  const [instruction, setInstruction] = useState("承接目前場景，讓人物以行動面對新的選擇與代價。");
  const [progress, setProgress] = useState<ClosedAIProgressEvent[]>([]);
  const [candidates, setCandidates] = useState<CandidateView[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const repository = repositoryRef.current ?? createNovelRepository();
    repositoryRef.current = repository;
    const project = await repository.get<NovelProject>("projects", projectId);
    if (!project) throw new Error("找不到作品。");
    const chapters = (await repository.list<Chapter>("chapters", projectId)).sort((left, right) => left.order - right.order);
    const chapter = chapters.find((item) => item.id === project.activeChapterId) ?? chapters[0];
    const [characters, worldRules, timeline, storyBibles, storyStates, branches] = await Promise.all([
      repository.list<Character>("characters", projectId),
      repository.list<WorldRule>("worldRules", projectId),
      repository.list<TimelineEvent>("timeline", projectId),
      repository.list<StoryBible>("storyBibles", projectId),
      repository.list<StoryState>("storyStates", projectId),
      repository.listStoryBranches(projectId),
    ]);
    const storyBible = storyBibles.find((item) => item.id === project.storyBibleId) ?? storyBibles[0];
    if (!chapter || !storyBible || !storyStates[0]) {
      throw new Error("作品缺少章節、Story Bible 或故事狀態；請先重新建立作品資料。");
    }
    setData({
      project,
      chapter,
      chapters,
      characters,
      worldRules,
      timeline,
      storyBible,
      storyState: storyStates[0],
      branches,
    });
    setStatus("作品資料與核准邊界已載入。");
  }, [projectId]);

  useEffect(() => {
    void load().catch((cause) => setStatus(errorMessage(cause)));
  }, [load]);

  async function generate() {
    if (!data || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress([]);
    setCandidates([]);
    setStatus("Closed Agent OS 正在建立三份彼此不同、但共享相同 Canon 的候選。");
    try {
      const learned = await buildApprovedLearningContext({
        repository: learningRepository,
        projectId,
        taskType,
        maximumRules: 8,
      });
      const activeBranch = data.branches.find((item) => item.status === "active");
      const platformTask = taskPlatformType(taskType);
      const personaLabel = personaOptions.find(([value]) => value === persona)?.[1] ?? persona;
      const context = buildContext(data, learned.instructions);
      const results: CandidateView[] = [];
      for (const [intent, intentInstruction] of candidateIntents) {
        if (controller.signal.aborted) break;
        const result = await executeStudioClosedAgent({
          projectId,
          taskType: platformTask,
          objective: [
            `回應方式：${personaLabel}`,
            `作者要求：${instruction.trim() || "依已核准資料建立候選"}`,
            `候選方向：${intent}。${intentInstruction}`,
            "輸出繁體中文小說內容，不得輸出工程說明；這只是候選，不得自行修改 Memory 或 Canon。",
          ].join("\n"),
          context,
          preferredBackend: backend,
          qualityMode,
          branchId: activeBranch?.branchId ?? "root",
          storyBibleRevision: data.storyBible.revision,
          knowledgeScopeRevision: Math.max(
            data.project.revision,
            data.chapter.revision,
            ...data.characters.map((item) => item.revision),
            ...data.worldRules.map((item) => item.revision),
            ...data.timeline.map((item) => item.revision),
          ),
          promptProfileVersion: `studio-ai:${persona}:v4`,
          signal: controller.signal,
          onProgress: (event) => setProgress((items) => [
            ...items,
            { ...event, label: `${intent}｜${event.label}` },
          ].slice(-18)),
        });
        const originality = await evaluateLearningOriginality({
          repository: learningRepository,
          projectId,
          output: result.candidate.content,
        });
        if (!originality.passed) {
          await rejectStudioClosedAgentCandidate(result.candidate.id);
          continue;
        }
        results.push({
          result,
          intent,
          sourceChapterId: data.chapter.id,
          sourceRevision: data.chapter.revision,
          learningRuleIds: learned.selectedRuleIds,
        });
      }
      setCandidates(results);
      setStatus(
        results.length
          ? `已建立 ${results.length} 份 Closed Agent OS 候選；Canon 寫入仍為 0，請逐份審核。`
          : "候選未通過安全、原創性或品質評估；Canon 沒有變更。",
      );
    } catch (cause) {
      setStatus(errorMessage(cause));
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  async function approve(view: CandidateView, applyToChapter: boolean) {
    if (!data || running) return;
    setRunning(true);
    try {
      const canonicalCommit = applyToChapter
        ? async ({ candidate }: { candidate: ClosedAgentExecutionResult["candidate"] }) => {
          const repository = repositoryRef.current!;
          const current = await repository.get<Chapter>("chapters", view.sourceChapterId);
          if (!current || current.revision !== view.sourceRevision) {
            throw Object.assign(new Error("章節已在候選產生後修改；請重新產生候選。"), {
              code: "GENERATION_SOURCE_REVISION_STALE",
            });
          }
          const platformTask = view.result.task.taskType;
          const nextContent = platformTask === "chapter.rewrite"
            ? candidate.content.trim()
            : `${current.content.trim()}${current.content.trim() ? "\n\n" : ""}${candidate.content.trim()}`;
          const saved = await repository.put<Chapter>("chapters", {
            ...current,
            content: nextContent,
          }, current.revision);
          mirrorChapterToLegacyStudio(projectId, saved.title, saved.content);
          return {
            commitId: `chapter:${saved.id}:revision:${saved.revision}`,
            storyBibleRevision: String(data.storyBible.revision),
          };
        }
        : undefined;
      const approved = await approveStudioClosedAgentCandidate({
        candidateId: view.result.candidate.id,
        canonicalCommit,
      });
      await recordSovereignLearningFeedback(learningRepository, {
        projectId,
        decision: "accepted",
        taskType,
        ruleIds: view.learningRuleIds,
        output: view.result.candidate.content,
        reasonTags: applyToChapter ? ["USER_APPROVED", "CANONICAL_ACCEPTED"] : ["USER_APPROVED", "MEMORY_ACCEPTED"],
        provider: view.result.candidate.backendId,
        model: view.result.candidate.modelId,
      }).catch(() => null);
      setCandidates((items) => items.map((item) => item.result.candidate.id === view.result.candidate.id
        ? { ...item, result: { ...item.result, candidate: approved.candidate } }
        : item));
      setStatus(
        applyToChapter
          ? "候選已由你核准並套用目前章節；核准、Canon commit 與雜湊證據已記錄。"
          : "候選已由你核准到 Memory；正文與 Canon 沒有變更。",
      );
      if (applyToChapter) await load();
    } catch (cause) {
      setStatus(errorMessage(cause));
    } finally {
      setRunning(false);
    }
  }

  async function reject(view: CandidateView) {
    if (running) return;
    setRunning(true);
    try {
      const candidate = await rejectStudioClosedAgentCandidate(view.result.candidate.id);
      await recordSovereignLearningFeedback(learningRepository, {
        projectId,
        decision: "rejected",
        taskType,
        ruleIds: view.learningRuleIds,
        output: view.result.candidate.content,
        reasonTags: ["USER_REJECTED"],
        provider: view.result.candidate.backendId,
        model: view.result.candidate.modelId,
      }).catch(() => null);
      setCandidates((items) => items.map((item) => item.result.candidate.id === candidate.id
        ? { ...item, result: { ...item.result, candidate } }
        : item));
      setStatus("候選已拒絕；只留下可控學習的負面標籤，不會寫入 Memory 或 Canon。");
    } catch (cause) {
      setStatus(errorMessage(cause));
    } finally {
      setRunning(false);
    }
  }

  if (!data) return <main className="p2ProjectShell"><p>{status}</p></main>;

  return (
    <main className="p2ProjectShell">
      <header>
        <Link href={`/professional?intent=library&projectId=${encodeURIComponent(projectId)}`}>作品管理中心</Link>
        <div><small>{data.project.title}</small><h1>閉端 AI 創作</h1></div>
        <span>{status}</span>
      </header>
      <ProjectNavigation projectId={projectId} active="ai" />
      <section className="p23AiWorkspace">
        <div className="p23AiControls">
          <label>這次要做什麼
            <select value={taskType} onChange={(event) => setTaskType(event.target.value as GenerationTaskType)}>
              {taskOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>回應方式
            <select value={persona} onChange={(event) => setPersona(event.target.value as PersonaProfileId)}>
              {personaOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>閉端執行者
            <select value={backend} onChange={(event) => setBackend(event.target.value as typeof backend)}>
              <option value="local-ollama">個人本機 Ollama</option>
              <option value="private-ai-hub">私有 AI Hub</option>
            </select>
          </label>
          <label>候選品質
            <select
              value={qualityMode}
              onChange={(event) => setQualityMode(event.target.value as ClosedAIQualityMode)}
            >
              <option value="fast">快速 · 每份 1 次推理</option>
              <option value="balanced">平衡 · 每份草稿＋修訂</option>
              <option value="deep">深度 · 每份草稿＋反方檢查＋修訂</option>
            </select>
          </label>
          <label>作者要求
            <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} />
          </label>
          <div className="p23AiActions">
            <button disabled={running || !instruction.trim()} onClick={() => void generate()}>
              {running ? "Closed Agent OS 執行中…" : "產生三份候選"}
            </button>
            {running ? <button className="secondary" onClick={() => abortRef.current?.abort()}>取消</button> : null}
          </div>
          <p>只使用已配對的閉端執行者。未配對時會明確失敗，不會改用外部 AI。</p>
          <Link href={`/studio/project/${projectId}/closed-ai`}>啟動／配對／實測閉端 AI</Link>
          <span> · </span>
          <Link href={`/studio/project/${projectId}/learning`}>規則學習與訓練資料</Link>
        </div>

        <div className="p23AiMain">
          <section className="p23AiProgress" aria-live="polite">
            <h2>Closed Agent OS 進度</h2>
            {progress.length ? (
              <ol>{progress.map((event, index) => (
                <li key={`${event.occurredAt}-${index}`} data-status={event.phase === "failed" ? "failed" : "success"}>
                  <strong>{event.percent}%</strong><span>{event.label}</span>
                </li>
              ))}</ol>
            ) : <p>候選會依序完成路由、計畫、檢索、模型生成、評估與人工核准 Gate。</p>}
          </section>

          <section className="p23CandidateList">
            {candidates.map((view) => {
              const candidate = view.result.candidate;
              return (
                <article key={candidate.id}>
                  <header>
                    <div><small>{view.intent} · {candidate.backendId}</small><h2>{candidate.status === "awaiting-approval" ? "等待你的核准" : candidate.status}</h2></div>
                    <span>{Math.round(candidate.evaluation.score * 100)} 分</span>
                  </header>
                  <p className="p23CandidateText">{candidate.content}</p>
                  <div className="p23CandidateMeta">
                    <section><h3>代理計畫</h3><ul>{view.result.plan.steps.map((step) => <li key={step.index}>{step.role}：{step.objective}</li>)}</ul></section>
                    <section><h3>安全評估</h3><p>{candidate.evaluation.passed ? "通過候選評估" : "未通過"}</p></section>
                    <section><h3>可控學習</h3><p>採用 {view.learningRuleIds.length} 條已核准規則；不使用未核准草稿。</p></section>
                    <section><h3>證據</h3><p>{candidate.generationTelemetry?.qualityPasses ?? 1} 次真實推理 · 內容雜湊：{candidate.contentDigest.slice(0, 16)}…</p></section>
                  </div>
                  <div className="p23AiActions">
                    {candidate.status === "awaiting-approval" ? <>
                      {view.result.task.taskType !== "chapter.outline" ? <button disabled={running} onClick={() => void approve(view, true)}>核准並套用章節</button> : null}
                      <button className="secondary" disabled={running} onClick={() => void approve(view, false)}>只核准到記憶</button>
                      <button className="secondary" disabled={running} onClick={() => void reject(view)}>拒絕</button>
                    </> : null}
                    <button className="secondary" onClick={() => void navigator.clipboard.writeText(candidate.content)}>複製候選</button>
                  </div>
                  <details>
                    <summary>模型與資料邊界</summary>
                    <p>
                      實際執行器：{candidate.actualExecutor}；
                      模型：{candidate.modelId}；
                      模型雜湊：{candidate.modelDigest}；
                      脈絡雜湊：{candidate.contextDigest ?? "舊候選未記錄"}；
                      資料離開裝置：{candidate.dataLeftDevice ? "是" : "否"}；
                      外部請求：{candidate.externalRequest ? "是" : "否"}；
                      靜默切換：{view.result.route.fallbackAttempted ? "有" : "無"}；
                      Canon 寫入：{candidate.canonicalMutationCount}
                    </p>
                  </details>
                </article>
              );
            })}
          </section>
        </div>
      </section>
    </main>
  );
}
