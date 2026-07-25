import {
  buildStoryContext,
  stableId,
  type StorySource,
} from "../story-intelligence";
import {
  buildAdversarialCritique,
  buildReasoningSummary,
  calibrateConfidence,
  decomposeStoryProblem,
  evaluateOpenExpression,
  evaluateRigorousLanguage,
  formatReasoningSummary,
  generatePlotHypothesis,
  generateStoryCounterexamples,
  personaInstruction,
  rankReasonedCandidates,
  routePersona,
  validateAdultFictionContext,
} from "../persona";
import { deterministicEvaluation, mergeModelEvaluation } from "./evaluators";
import { runLayeredEvaluator } from "./layered-evaluator";
import { buildGenerationReplayManifest } from "./replay-manifest";
import { acquireGenerationSlot, assertGenerationResourceBudget } from "./resource-budget";
import {
  P22_GENERATION_LOOP_VERSION,
  type CandidateIntent,
  type ClosedGenerationProvider,
  type GenerationCandidate,
  type GenerationEvaluation,
  type GenerationLoopInput,
  type GenerationLoopResult,
} from "./types";

const INTENTS: Array<{ intent: CandidateIntent; label: string }> = [
  { intent: "steady_continuation", label: "穩健延續既有因果與人物目標" },
  { intent: "conflict_escalation", label: "提升阻力與選擇代價" },
  { intent: "unexpected_turn", label: "以既有伏筆形成合理轉折" },
];

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw Object.assign(new Error("使用者已取消生成。"), { code: "GENERATION_CANCELLED" });
}

function planFallback(input: GenerationLoopInput, intent: CandidateIntent) {
  return [
    `承接第 ${input.currentChapterId} 的最後狀態`,
    intent === "steady_continuation" ? "讓主角依既有目標採取下一個可驗證行動" : intent === "conflict_escalation" ? "提高目前衝突的代價" : "回收一項已有線索形成轉折",
    "遵守正式世界規則與角色已知資訊",
    "以新的後果或未解問題結束",
  ];
}

function parsePlan(response: unknown, fallback: string[]) {
  if (response && typeof response === "object" && Array.isArray((response as { plan?: unknown }).plan)) {
    const rows = (response as { plan: unknown[] }).plan.filter((row): row is string => typeof row === "string" && row.trim().length > 0);
    if (rows.length) return rows.slice(0, 8);
  }
  return fallback;
}

function qualityAverage(evaluation: GenerationEvaluation) {
  const scores = [
    evaluation.continuityReport.score,
    evaluation.characterReport.score,
    evaluation.plotReport.score,
    evaluation.styleReport.score,
    ...evaluation.modelScores.map((row) => row.score),
  ];
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function contextMemories(context: GenerationCandidate["retrievedMemory"]) {
  return [
    ...context.currentScene,
    ...context.recentContext,
    ...context.characterContext,
    ...context.worldContext,
    ...context.plotContext,
    ...context.foreshadowingContext,
  ];
}

export class ClosedStoryGenerationLoop {
  readonly provider: ClosedGenerationProvider;

  constructor(provider: ClosedGenerationProvider) {
    this.provider = provider;
  }

  async run(input: GenerationLoopInput): Promise<GenerationLoopResult> {
    assertGenerationResourceBudget(input, input.resourceBudget);
    const release = acquireGenerationSlot(input.projectId, input.resourceBudget);
    try {
      return await this.runInternal(input);
    } finally {
      release();
    }
  }

  private async runInternal(input: GenerationLoopInput): Promise<GenerationLoopResult> {
    const progress = (stage: Parameters<NonNullable<GenerationLoopInput["onProgress"]>>[0]["stage"], status: Parameters<NonNullable<GenerationLoopInput["onProgress"]>>[0]["status"], message: string, candidateIntent?: CandidateIntent) => {
      input.onProgress?.({ stage, status, message, candidateIntent, at: new Date().toISOString() });
    };
    assertActive(input.signal);
    progress("task_understanding", "success", "已解析作者要求與任務限制。");
    const persona = routePersona({
      requested: input.personaProfile,
      taskType: input.taskType,
      adultMode: input.adultFictionContext?.enabled,
    });
    if (persona.id === "adult_fiction" || input.adultFictionContext?.enabled) {
      const adultValidation = input.adultFictionContext
        ? validateAdultFictionContext(input.adultFictionContext)
        : { valid: false, issues: ["ADULT_CONTEXT_REQUIRED"], errorCode: "ADULT_FICTION_CONTEXT_REJECTED" };
      if (!adultValidation.valid) {
        throw Object.assign(new Error("成人小說模式需要成年確認、明確成年角色、有效同意與隔離索引。"), adultValidation);
      }
    }
    progress("problem_decomposition", "running", "正在拆解任務、限制與驗證目標。");
    const decomposition = decomposeStoryProblem({
      taskType: input.taskType,
      instruction: input.authorInstruction,
      constraints: input.constraints ?? [],
    });
    progress("problem_decomposition", "success", `已拆解 ${decomposition.subproblems.length} 個可驗證子問題。`);
    const initialRevision = await input.getCurrentSourceRevision?.();
    if (initialRevision != null && initialRevision !== input.sourceRevision) {
      throw Object.assign(new Error("來源章節已改版，請重新產生。"), { code: "GENERATION_SOURCE_REVISION_STALE" });
    }
    progress("memory_retrieval", "running", "正在選取與任務最相關的作品記憶。");
    const currentSceneMemory = input.currentText.trim()
      ? [{
          memoryId: stableId("current-scene", {
            projectId: input.projectId,
            chapterId: input.currentChapterId,
            sourceRevision: input.sourceRevision,
            text: input.currentText,
          }),
          kind: "current_scene" as const,
          text: input.currentText,
          source: {
            sourceChapterId: input.currentChapterId,
            sourceRevision: input.sourceRevision,
            evidenceExcerpt: input.currentText,
            start: 0,
            end: input.currentText.length,
          },
          metadata: {
            projectId: input.projectId,
            branchId: input.branchId,
            entityIds: [],
            canonical: true,
            visibility: "private" as const,
          },
          keywordScore: 1,
          vectorScore: 1,
          recencyScore: 1,
        }]
      : [];
    const context = buildStoryContext({
      task: input.taskType,
      authorInstruction: input.authorInstruction,
      memories: [
        ...currentSceneMemory,
        ...input.memories.filter((memory) => memory.memoryId !== currentSceneMemory[0]?.memoryId),
      ],
      constraints: input.constraints,
      styleProfile: input.styleProfile,
    });
    progress("memory_retrieval", "success", `已選取 ${context.sourceReferences.length} 筆可追溯來源。`);
    const intents = input.multiCandidate ? INTENTS : INTENTS.slice(0, 1);
    const candidates: GenerationCandidate[] = [];
    let externalRequestCount = 0;
    let selectedProvider = "unavailable";

    for (const { intent, label } of intents) {
      assertActive(input.signal);
      const started = Date.now();
      progress("hypothesis_generation", "running", "正在建立情節假設與支持來源。", intent);
      const hypothesis = generatePlotHypothesis(intent, context);
      progress("hypothesis_generation", "success", hypothesis.hypothesis, intent);
      progress("counterexample_check", "running", "正在尋找可能推翻候選的反例。", intent);
      const counterexamples = generateStoryCounterexamples(context);
      progress("counterexample_check", "success", `已建立 ${counterexamples.length} 個反例檢查。`, intent);
      const fallbackPlan = planFallback(input, intent);
      progress("planning", "running", "正在建立章節規劃。", intent);
      const planning = await this.provider.generate({
        requestId: `${input.requestId}:plan:${intent}`,
        projectId: input.projectId,
        taskType: "planning",
        instruction: [
          personaInstruction(persona),
          `方向：${label}。`,
          `作者要求：${input.authorInstruction}`,
          `情節假設：${hypothesis.hypothesis}`,
          `反例檢查：${counterexamples.join("；")}`,
        ].join("\n"),
        context,
        intent,
        signal: input.signal,
        maxOutputTokens: 700,
        structured: true,
      });
      selectedProvider = planning.provider;
      externalRequestCount += planning.externalRequest ? 1 : 0;
      if (planning.externalRequest) throw Object.assign(new Error("閉端生成偵測到外部資料傳輸。"), { code: "CLOSED_GENERATION_EXTERNAL_REQUEST_BLOCKED" });
      const plan = parsePlan(planning.structuredOutput, fallbackPlan);
      progress("planning", "success", `已建立 ${plan.length} 個規劃步驟。`, intent);
      assertActive(input.signal);

      progress("draft_generation", "running", "正在產生候選正文。", intent);
      const generated = await this.provider.generate({
        requestId: `${input.requestId}:draft:${intent}`,
        projectId: input.projectId,
        taskType: input.taskType,
        instruction: [
          "請使用繁體中文產生小說候選稿，不得輸出工程說明。",
          personaInstruction(persona),
          `候選方向：${label}`,
          `作者要求：${input.authorInstruction}`,
          `章節規劃：${plan.join("；")}`,
        ].join("\n"),
        context,
        intent,
        signal: input.signal,
        maxOutputTokens: 2200,
        structured: false,
      });
      externalRequestCount += generated.externalRequest ? 1 : 0;
      if (generated.externalRequest) throw Object.assign(new Error("閉端生成偵測到外部資料傳輸。"), { code: "CLOSED_GENERATION_EXTERNAL_REQUEST_BLOCKED" });
      let draft = generated.text.trim();
      progress("draft_generation", "success", `候選正文已完成，共 ${draft.length} 字。`, intent);
      const draftSource: StorySource = {
        sourceChapterId: input.currentChapterId,
        sourceRevision: input.sourceRevision,
        evidenceExcerpt: draft,
        start: 0,
        end: draft.length,
      };
      let evaluation = deterministicEvaluation(input, draft);
      progress("continuity_evaluation", "success", `一致性分數 ${evaluation.continuityReport.score}。`, intent);
      progress("character_evaluation", "success", `人物一致性分數 ${evaluation.characterReport.score}。`, intent);
      progress("plot_evaluation", "success", `情節連貫分數 ${evaluation.plotReport.score}。`, intent);
      progress("style_evaluation", "running", "正在進行本機模型品質評估。", intent);
      const modelEvaluation = await this.provider.generate({
        requestId: `${input.requestId}:evaluate:${intent}`,
        projectId: input.projectId,
        taskType: "evaluation",
        instruction: "請以 JSON 評估 continuity、character_consistency、plot_coherence、pacing、dialogue_quality、style_consistency、repetition、foreshadowing_use、reader_engagement。每項需有 0-100 分與繁體中文理由。",
        context,
        draft,
        intent,
        signal: input.signal,
        maxOutputTokens: 900,
        structured: true,
      });
      externalRequestCount += modelEvaluation.externalRequest ? 1 : 0;
      if (modelEvaluation.externalRequest) throw Object.assign(new Error("閉端評估偵測到外部資料傳輸。"), { code: "CLOSED_GENERATION_EXTERNAL_REQUEST_BLOCKED" });
      evaluation = mergeModelEvaluation(evaluation, modelEvaluation.structuredOutput, draftSource);
      progress("style_evaluation", "success", `文風分數 ${evaluation.styleReport.score}。`, intent);

      const revisionNotes: string[] = [];
      let revisionEvaluationTokens = { input: 0, output: 0 };
      const threshold = input.qualityThreshold ?? 70;
      progress("rigorous_language_evaluation", "running", "正在檢查繁體中文、稱謂、視角、段落與任務回答。", intent);
      let languageEvaluation = evaluateRigorousLanguage({
        text: draft,
        taskInstruction: input.authorInstruction,
        expectedViewpoint: input.expectedViewpoint,
        sources: [draftSource],
        fictionMode: true,
      });
      progress("rigorous_language_evaluation", "success", `語言嚴謹度 ${languageEvaluation.score}。`, intent);
      let openExpression = evaluateOpenExpression(draft, {
        fictional: true,
        requestedSensitiveTheme: persona.narrativeFreedom >= 80 || persona.adultFictionLevel > 0,
      });
      progress("adversarial_critique", "running", "正在進行一次對抗式自我質疑。", intent);
      let critique = buildAdversarialCritique(evaluation, languageEvaluation);
      if (openExpression.overRefusal) {
        critique = {
          ...critique,
          requiresRevision: true,
          risks: [...critique.risks, "候選因爭議或成人題材出現空泛拒絕，未真正完成創作任務。"],
        };
      }
      progress("adversarial_critique", "success", `已識別 ${critique.risks.length} 個風險。`, intent);
      const mayRevise = (input.maxCritiqueRounds ?? 1) > 0;
      if (mayRevise && (!evaluation.passed || qualityAverage(evaluation) < threshold || languageEvaluation.score < threshold || critique.requiresRevision)) {
        progress("revision", "running", "品質未達門檻，正在執行一次局部修稿。", intent);
        revisionNotes.push(...evaluation.continuityReport.issues.map((row) => row.explanation));
        revisionNotes.push(...evaluation.disagreements.map((row) => `${row.dimension} 評估有明顯分歧`));
        revisionNotes.push(...languageEvaluation.suggestedRevision);
        revisionNotes.push(...critique.risks);
        const revised = await this.provider.generate({
          requestId: `${input.requestId}:revise:${intent}`,
          projectId: input.projectId,
          taskType: "revision",
          instruction: `只修正下列問題並保留原事件意圖：${revisionNotes.join("；") || "提升因果、人物與文風一致性"}`,
          context,
          draft,
          intent,
          signal: input.signal,
          maxOutputTokens: 2200,
          structured: false,
        });
        externalRequestCount += revised.externalRequest ? 1 : 0;
        if (revised.externalRequest) throw Object.assign(new Error("閉端修稿偵測到外部資料傳輸。"), { code: "CLOSED_GENERATION_EXTERNAL_REQUEST_BLOCKED" });
        draft = revised.text.trim();
        evaluation = deterministicEvaluation(input, draft);
        const revisedSource: StorySource = {
          sourceChapterId: input.currentChapterId,
          sourceRevision: input.sourceRevision,
          evidenceExcerpt: draft,
          start: 0,
          end: draft.length,
        };
        const revisedModelEvaluation = await this.provider.generate({
          requestId: `${input.requestId}:evaluate-revised:${intent}`,
          projectId: input.projectId,
          taskType: "evaluation",
          instruction: "只評估修稿後正文。以 JSON 回傳各品質維度的 0-100 分數、理由與風險；不得改寫正文。",
          context,
          draft,
          intent,
          signal: input.signal,
          maxOutputTokens: 900,
          structured: true,
        });
        externalRequestCount += revisedModelEvaluation.externalRequest ? 1 : 0;
        if (revisedModelEvaluation.externalRequest) throw Object.assign(new Error("本機修稿評估偵測到外部資料傳輸。"), { code: "CLOSED_GENERATION_EXTERNAL_REQUEST_BLOCKED" });
        evaluation = mergeModelEvaluation(evaluation, revisedModelEvaluation.structuredOutput, revisedSource);
        languageEvaluation = evaluateRigorousLanguage({
          text: draft,
          taskInstruction: input.authorInstruction,
          expectedViewpoint: input.expectedViewpoint,
          sources: [revisedSource],
          fictionMode: true,
        });
        openExpression = evaluateOpenExpression(draft, {
          fictional: true,
          requestedSensitiveTheme: persona.narrativeFreedom >= 80 || persona.adultFictionLevel > 0,
        });
        critique = buildAdversarialCritique(evaluation, languageEvaluation);
        revisionEvaluationTokens = {
          input: revised.estimatedInputTokens + revisedModelEvaluation.estimatedInputTokens,
          output: revised.estimatedOutputTokens + revisedModelEvaluation.estimatedOutputTokens,
        };
        progress("revision", "success", "局部修稿與修稿後重新驗證完成。", intent);
      } else {
        progress("revision", "skipped", "候選已達品質門檻，不需修稿。", intent);
      }
      const currentRevision = await input.getCurrentSourceRevision?.();
      if (currentRevision != null && currentRevision !== input.sourceRevision) {
        throw Object.assign(new Error("生成期間來源章節已改版，候選已作廢。"), { code: "GENERATION_SOURCE_REVISION_STALE" });
      }
      const confidence = calibrateConfidence({
        sourceCount: context.sourceReferences.length,
        blockingIssues: evaluation.continuityReport.issues.filter((issue) => issue.severity === "blocking").length,
        majorIssues: evaluation.continuityReport.issues.filter((issue) => issue.severity === "major").length,
        evaluatorDisagreements: evaluation.disagreements.length,
        languageScore: languageEvaluation.score,
      });
      const layeredEvaluation = runLayeredEvaluator({
        evaluation,
        context,
        externalRequestCount,
        canonicalMutationCount: 0,
      });
      const status = evaluation.passed
        && qualityAverage(evaluation) >= threshold
        && languageEvaluation.score >= threshold
        && !openExpression.overRefusal
        && layeredEvaluation.disposition === "eligible_for_approval"
        ? "awaiting_approval"
        : "quality_rejected";
      progress("candidate_packaging", "running", "正在封裝候選與來源證據。", intent);
      const reasoningSummary = formatReasoningSummary(buildReasoningSummary({
        objective: decomposition.objective,
        plan,
        context,
        risks: critique.risks,
        confidence,
      }));
      const taints = contextMemories(context)
        .map((memory) => memory.metadata.taint)
        .filter((taint): taint is NonNullable<typeof taint> => Boolean(taint));
      const replayManifest = buildGenerationReplayManifest({
        taskId: input.requestId,
        storyRevision: input.storyRevision,
        provider: generated.provider,
        modelName: generated.model,
        modelDigest: generated.modelDigest,
        promptProfileVersion: input.promptProfileVersion ?? "p23-generation-prompt-v1",
        personaProfileVersion: persona.schemaVersion,
        storyBibleVersion: input.storyBibleVersion ?? P22_GENERATION_LOOP_VERSION,
        retrievalQuery: `${input.taskType}\n${input.authorInstruction}`,
        context,
        generationParameters: {
          maxOutputTokens: 2200,
          qualityThreshold: threshold,
          ...(generated.generationParameters ?? {}),
        },
        seed: input.seed,
        revisionRound: revisionNotes.length ? 1 : 0,
        candidate: draft,
      });
      candidates.push({
        schemaVersion: P22_GENERATION_LOOP_VERSION,
        candidateId: stableId("candidate", { requestId: input.requestId, intent, sourceRevision: input.sourceRevision, draft }),
        requestId: input.requestId,
        projectId: input.projectId,
        branchId: input.branchId,
        taskType: input.taskType,
        intent,
        plan,
        draft: generated.text,
        retrievedMemory: context,
        evaluation,
        layeredEvaluation,
        personaProfile: persona,
        reasoningSummary,
        languageEvaluation,
        differenceSummary: label,
        riskHints: critique.risks,
        confidence: confidence.score,
        revisionNotes,
        finalCandidate: draft,
        provider: generated.provider,
        model: generated.model,
        modelDigest: generated.modelDigest ?? null,
        latency: Date.now() - started,
        tokenEstimate: {
          input: planning.estimatedInputTokens + generated.estimatedInputTokens + modelEvaluation.estimatedInputTokens + revisionEvaluationTokens.input,
          output: planning.estimatedOutputTokens + generated.estimatedOutputTokens + modelEvaluation.estimatedOutputTokens + revisionEvaluationTokens.output,
        },
        sourceRevision: input.sourceRevision,
        storyRevision: input.storyRevision,
        status,
        canonicalMutationCount: 0,
        taintSummary: {
          labels: [...new Set(taints.flatMap((taint) => taint.taintLabels))],
          quarantinedMemoryIds: context.trustBoundary.quarantinedMemoryIds,
          privilegedUsageBlocked: true,
        },
        replayManifest,
        createdAt: new Date().toISOString(),
      });
      progress("candidate_packaging", "success", status === "awaiting_approval" ? "候選已送入作者核准層。" : "候選未達品質門檻，未送入核准層。", intent);
    }

    const rankedCandidates = rankReasonedCandidates(candidates);
    return {
      schemaVersion: P22_GENERATION_LOOP_VERSION,
      requestId: input.requestId,
      taskUnderstanding: {
        taskType: input.taskType,
        objective: input.authorInstruction,
        constraints: input.constraints ?? [],
      },
      candidates,
      rankedCandidateIds: rankedCandidates.map((candidate) => candidate.candidateId),
      recommendedCandidateId: rankedCandidates.find((candidate) => candidate.status === "awaiting_approval")?.candidateId ?? null,
      selectedProvider,
      fallbackUsed: false,
      externalRequestCount,
      canonicalMutationCount: 0,
    };
  }
}
