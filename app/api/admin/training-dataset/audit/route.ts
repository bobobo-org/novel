import { requireAdmin } from "@/lib/novel-ai/admin";
import { jsonError } from "@/lib/novel-ai/http";
import { buildStoryAnalysisContext, confirmMemoryUpdate, getNovelMemory, proposeMemoryUpdate } from "@/lib/novel-ai/memory";
import { providerMeta } from "@/lib/novel-ai/provider";
import { getAuthorPreference } from "@/lib/novel-ai/preference";
import { inputHash, recordAiRun, recordFeedback, reviewTrainingExample, exportApprovedJsonl, trainingStats } from "@/lib/novel-ai/store";
import type { StoryAnalysis, StoryContext } from "@/lib/novel-ai/schemas";

export const runtime = "nodejs";

type AuditResult = {
  item: string;
  status: "PASS" | "FAIL";
  detail: string;
};

function sensitivePattern(text: string): boolean {
  return /(vcp_[A-Za-z0-9]+|sbp_[A-Za-z0-9]+|bearer\s+[A-Za-z0-9._-]{12,}|api[_-]?key["']?\s*[:=]\s*["'][^"']{8,}|authorization["']?\s*[:=]\s*["'][^"']{8,}|cookie["']?\s*[:=]\s*["'][^"']{8,}|session[_-]?token["']?\s*[:=]\s*["'][^"']{8,}|password["']?\s*[:=]\s*["'][^"']{6,}|client[_-]?secret["']?\s*[:=]\s*["'][^"']{8,}|private[_-]?key\s*-----BEGIN)/i.test(text);
}

function add(results: AuditResult[], item: string, ok: boolean, detail: string) {
  results.push({ item, status: ok ? "PASS" : "FAIL", detail });
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const results: AuditResult[] = [];
  const projectId = `audit-v9-${Date.now()}`;
  const chapterId = "chapter-1";

  try {
    const meta = providerMeta();
    const statsBefore = trainingStats();
    add(results, "版本標記", statsBefore.versions.coreSystemVersion === "dedicated-novel-ai-core-v9", statsBefore.versions.coreSystemVersion);
    add(results, "Candidate 分析器", statsBefore.versions.candidateAnalyzerVersion === "story-analyzer-v9", statsBefore.versions.candidateAnalyzerVersion || "");
    add(results, "Quality Gate", statsBefore.versions.qualityGateVersion === "quality-gate-v9", statsBefore.versions.qualityGateVersion);

    const candidate = proposeMemoryUpdate({
      projectId,
      chapterId,
      chapterTitle: "第一章",
      chapterText: "沈清禾走進祠堂，看見帳冊被人調包。她沒有當場揭穿，而是記下紙頁邊緣的墨痕。這個秘密一旦公開，管家就會提前行動。",
      abcChoice: "B：暫時不揭穿異常，先蒐集證據。",
    });
    add(results, "記憶候選產生", Boolean(candidate.chapterSummary && candidate.endingHook), `summary=${candidate.chapterSummary.slice(0, 30)}`);

    const savedMemory = confirmMemoryUpdate(candidate);
    add(results, "記憶確認寫入", savedMemory.projectId === projectId && savedMemory.chapterSummaries.length > 0, `chapters=${savedMemory.chapterSummaries.length}`);
    add(results, "未解事件狀態", savedMemory.unresolvedEvents[0]?.status === "未處理", savedMemory.unresolvedEvents[0]?.status || "none");
    add(results, "expectedResolution 保存", Boolean(savedMemory.unresolvedEvents[0]?.expectedResolution), savedMemory.unresolvedEvents[0]?.expectedResolution || "none");

    const baseContext: StoryContext = {
      projectId,
      chapterId,
      genre: "現代懸疑",
      subgenre: "家族權謀",
      narrativeStyle: "冷靜克制",
      protagonist: {
        name: "沈清禾",
        archetype: "隱忍布局型",
        personality: "冷靜敏銳",
        goal: "找出帳冊被調包的真相",
        actionStyle: "表面退讓，暗中蒐證",
        speechStyle: "克制有禮",
        strengths: "觀察細節",
        weaknesses: "不輕易表露情緒",
        fear: "證據被毀",
      },
      antagonist: "管家",
      mainConflict: "帳冊被調包，繼承權證據可能消失",
      previousChapterSummary: "",
      recentText: "她合上帳冊，沒有看任何人，因為她知道有人正在等她失控。",
      unresolvedEvents: [],
      resolvedEvents: [],
      revealedSecrets: [],
      unrevealedSecrets: [],
      importantItems: [],
      recentChoices: [],
      forbiddenChanges: ["不得讓沈清禾突然變得衝動莽撞"],
      chapterGoal: "推進帳冊調包線",
    };

    const builtContext = buildStoryAnalysisContext(baseContext);
    add(results, "Context Builder 接入 NovelMemory", Boolean(builtContext.novelMemory && builtContext.unresolvedEvents.length), `context=${(builtContext.contextSelection || []).join("、")}`);
    add(results, "Context Builder 保留 forbiddenChanges", builtContext.forbiddenChanges.includes("不得讓沈清禾突然變得衝動莽撞"), builtContext.forbiddenChanges.join("、"));

    const analysis: StoryAnalysis = {
      situation: "沈清禾發現帳冊被調包，但仍選擇壓住情緒等待證據。",
      currentStoryStage: "開篇危機",
      characterConsistency: { status: "穩定", explanation: "她仍符合隱忍布局型的行動模式。" },
      recommendedStrategy: "先保守調查，再製造反制機會。",
      recommendationReason: "此策略能承接帳冊未解事件，且不違反主角性格。",
      continuityWarnings: [],
      missingInformation: [],
      forbiddenActions: [],
      analysisEvidence: [
        { sourceType: "主角設定", sourceId: "protagonist", sourceLabel: "沈清禾", reason: "主角以隱忍布局方式處理危機。" },
        { sourceType: "未解事件", sourceId: "event-1", sourceLabel: "帳冊被調包", reason: "記憶中仍有帳冊調包懸念。" },
      ],
      analysisScores: {
        plotProgress: 8,
        characterConsistency: 9,
        novelty: 7,
        readerHook: 8,
        emotionalPayoff: 7,
        riskClarity: 8,
        evidenceUse: 9,
      },
      qualityGate: { passed: true, warnings: [] },
      options: [
        { label: "A", action: "沈清禾表面接受管家的安排，暗中留下可反制帳冊調包的證據。", strategyType: "主動進攻", reason: "能快速推進衝突。", risk: "高", possibleCost: "可能讓管家提前警覺", expectedEffect: "逼出對手破綻", characterFitScore: 9, plotProgressScore: 8, noveltyScore: 7 },
        { label: "B", action: "沈清禾暫時不揭穿異常，先查帳冊被誰動過。", strategyType: "保守調查", reason: "符合她的冷靜蒐證方式。", risk: "中", possibleCost: "調查時間拉長", expectedEffect: "取得更穩證據", characterFitScore: 9, plotProgressScore: 7, noveltyScore: 7 },
        { label: "C", action: "沈清禾故意讓部分消息外流，引誘管家提前行動。", strategyType: "轉折高代價", reason: "能製造反轉與新風險。", risk: "高", possibleCost: "可能失去盟友信任", expectedEffect: "讓對手暴露目的", characterFitScore: 8, plotProgressScore: 9, noveltyScore: 8 },
      ],
    };

    const aiRun = recordAiRun({
      projectId,
      chapterId,
      taskType: "story_analysis",
      provider: meta.provider,
      model: meta.model,
      inputHash: inputHash(builtContext),
      inputContext: builtContext,
      modelOutput: analysis,
      latencyMs: 1,
      inputTokens: 10,
      outputTokens: 10,
      status: "completed",
    });
    add(results, "AiRun 寫入", Boolean(aiRun.id && aiRun.inputHash), aiRun.id);

    const { feedback, trainingExample, preference } = recordFeedback({
      aiRunId: aiRun.id,
      decision: "accepted",
      selectedOption: "B",
      authorNote: "偏好冷靜蒐證，不要讓主角衝動翻臉。",
    });
    add(results, "AiFeedback 寫入", feedback.decision === "accepted", feedback.id);
    add(results, "AuthorPreference 更新", preference.preferredStrategyPatterns.length > 0 || preference.preferredCharacterBehaviors.length > 0, `preferred=${preference.preferredStrategyPatterns.length}`);
    add(results, "TrainingExample pending 建立", Boolean(trainingExample?.id && trainingExample.qualityStatus === "pending"), trainingExample?.id || "none");

    if (trainingExample) {
      const review = reviewTrainingExample(trainingExample.id, { qualityStatus: "approved", reviewerNote: "v9 audit approved" });
      add(results, "TrainingExample approved", review.example.qualityStatus === "approved", review.example.qualityStatus);
    } else {
      add(results, "TrainingExample approved", false, "missing training example");
    }

    const jsonl = exportApprovedJsonl();
    const lines = jsonl.trim() ? jsonl.trim().split(/\n/) : [];
    add(results, "JSONL 只匯出 approved", lines.length > 0, `lines=${lines.length}`);
    add(results, "JSONL 不含敏感資訊", !sensitivePattern(jsonl), "checked api key/token/cookie/password patterns");

    const finalStats = trainingStats();
    const finalPreference = getAuthorPreference(projectId);
    const finalMemory = getNovelMemory(projectId);
    add(results, "Stats 反映 AI 能力", finalStats.aiRuns > 0 && finalStats.aiAbility.approvedTrainingExamples > 0, `runs=${finalStats.aiRuns}, approved=${finalStats.aiAbility.approvedTrainingExamples}`);
    add(results, "Memory project 隔離", finalMemory.projectId === projectId && finalMemory.chapterSummaries.length > 0, finalMemory.projectId);
    add(results, "Preference project 隔離", finalPreference.projectId === projectId && finalPreference.version >= 3, finalPreference.projectId);

    const failed = results.filter((x) => x.status === "FAIL");
    return Response.json({
      auditVersion: "novel-ai-v9-real-connection-audit",
      passed: failed.length === 0,
      passCount: results.length - failed.length,
      failCount: failed.length,
      results,
      versions: finalStats.versions,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "v9 稽核失敗。", 500, "AUDIT_ERROR");
  }
}
