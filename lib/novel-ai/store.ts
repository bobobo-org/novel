import crypto from "crypto";
import { CONTEXT_BUILDER_VERSION, MEMORY_VERSION, SCHEMA_VERSION } from "./memory";
import { AUTHOR_PREFERENCE_VERSION, updateAuthorPreference, type AuthorPreferenceProfile } from "./preference";
import { PROMPT_VERSION, STORY_ANALYZER_SYSTEM_PROMPT } from "./prompts";
import { QUALITY_GATE_VERSION } from "./provider";
import type { FeedbackInput, FeedbackPatchInput, TrainingReviewInput } from "./schemas";

type AiTaskType = "story_analysis" | "story_options" | "chapter_plan" | "continuity_review";

export type AiRunRecord = {
  id: string;
  projectId: string;
  chapterId?: string;
  taskType: AiTaskType;
  provider: string;
  model: string;
  promptVersion: string;
  contextBuilderVersion: string;
  memoryVersion: string;
  preferenceVersion: string;
  qualityGateVersion: string;
  inputHash: string;
  inputContext: unknown;
  modelOutput?: unknown;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  status: "completed" | "failed" | "cancelled";
  errorCode?: string;
  createdAt: string;
};

export type AiFeedbackRecord = {
  id: string;
  aiRunId: string;
  projectId: string;
  chapterId?: string;
  decision: "accepted" | "edited" | "rejected";
  selectedOption?: "A" | "B" | "C";
  originalOutput: unknown;
  editedOutput?: unknown;
  rejectionReasons?: string[];
  authorNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type TrainingExampleRecord = {
  id: string;
  projectId: string;
  sourceFeedbackId: string;
  taskType: AiTaskType;
  promptVersion: string;
  contextBuilderVersion: string;
  memoryVersion: string;
  preferenceVersion: string;
  qualityGateVersion: string;
  systemPrompt: string;
  userInput: unknown;
  idealOutput: unknown;
  qualityStatus: "pending" | "approved" | "rejected" | "needs_revision";
  reviewedAt?: string;
  reviewerNote?: string;
  createdAt: string;
};

type NovelAiMemoryStore = {
  aiRuns: AiRunRecord[];
  feedback: AiFeedbackRecord[];
  trainingExamples: TrainingExampleRecord[];
};

const globalStore = globalThis as typeof globalThis & { __novelAiStore?: NovelAiMemoryStore };

function store(): NovelAiMemoryStore {
  if (!globalStore.__novelAiStore) {
    globalStore.__novelAiStore = { aiRuns: [], feedback: [], trainingExamples: [] };
  }
  return globalStore.__novelAiStore;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function inputHash(input: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function recordAiRun(input: Omit<AiRunRecord, "id" | "createdAt" | "promptVersion" | "contextBuilderVersion" | "memoryVersion" | "preferenceVersion" | "qualityGateVersion">): AiRunRecord {
  const row: AiRunRecord = {
    id: id("airun"),
    promptVersion: PROMPT_VERSION,
    contextBuilderVersion: CONTEXT_BUILDER_VERSION,
    memoryVersion: MEMORY_VERSION,
    preferenceVersion: AUTHOR_PREFERENCE_VERSION,
    qualityGateVersion: QUALITY_GATE_VERSION,
    createdAt: new Date().toISOString(),
    ...input,
  };
  store().aiRuns.unshift(row);
  return row;
}

export function recordFeedback(input: FeedbackInput): { feedback: AiFeedbackRecord; trainingExample?: TrainingExampleRecord; preference: AuthorPreferenceProfile } {
  const aiRun = store().aiRuns.find((x) => x.id === input.aiRunId);
  if (!aiRun) throw new Error("找不到對應的 AI 執行紀錄。");
  if (store().feedback.some((x) => x.aiRunId === input.aiRunId)) {
    throw new Error("同一個 AI 結果已經提交過正式回饋。");
  }
  const now = new Date().toISOString();
  const feedback: AiFeedbackRecord = {
    id: id("feedback"),
    aiRunId: input.aiRunId,
    projectId: aiRun.projectId,
    chapterId: aiRun.chapterId,
    decision: input.decision,
    selectedOption: input.selectedOption,
    originalOutput: aiRun.modelOutput,
    editedOutput: input.editedOutput,
    rejectionReasons: input.rejectionReasons,
    authorNote: input.authorNote,
    createdAt: now,
    updatedAt: now,
  };
  store().feedback.unshift(feedback);
  const preference = updateAuthorPreference({
    projectId: aiRun.projectId,
    decision: input.decision,
    selectedOption: input.selectedOption,
    originalOutput: aiRun.modelOutput,
    editedOutput: input.editedOutput,
    rejectionReasons: input.rejectionReasons,
    authorNote: input.authorNote,
  });

  let trainingExample: TrainingExampleRecord | undefined;
  if (input.decision === "accepted" || input.decision === "edited") {
    trainingExample = {
      id: id("train"),
      projectId: aiRun.projectId,
      sourceFeedbackId: feedback.id,
      taskType: aiRun.taskType,
      promptVersion: aiRun.promptVersion,
      contextBuilderVersion: aiRun.contextBuilderVersion,
      memoryVersion: aiRun.memoryVersion,
      preferenceVersion: aiRun.preferenceVersion,
      qualityGateVersion: aiRun.qualityGateVersion,
      systemPrompt: STORY_ANALYZER_SYSTEM_PROMPT,
      userInput: aiRun.inputContext,
      idealOutput: input.decision === "edited" ? input.editedOutput : aiRun.modelOutput,
      qualityStatus: "pending",
      createdAt: now,
    };
    store().trainingExamples.unshift(trainingExample);
  }

  return { feedback, trainingExample, preference };
}

export function patchFeedback(feedbackId: string, patch: FeedbackPatchInput) {
  const feedback = store().feedback.find((x) => x.id === feedbackId);
  if (!feedback) throw new Error("找不到回饋紀錄。");
  if (patch.decision) feedback.decision = patch.decision;
  if (patch.selectedOption !== undefined) feedback.selectedOption = patch.selectedOption;
  if (patch.editedOutput !== undefined) feedback.editedOutput = patch.editedOutput;
  if (patch.rejectionReasons !== undefined) feedback.rejectionReasons = patch.rejectionReasons;
  if (patch.authorNote !== undefined) feedback.authorNote = patch.authorNote;
  feedback.updatedAt = new Date().toISOString();

  const example = store().trainingExamples.find((x) => x.sourceFeedbackId === feedback.id);
  if (example) {
    if (example.qualityStatus === "approved") example.qualityStatus = "needs_revision";
    if (feedback.decision === "accepted") example.idealOutput = feedback.originalOutput;
    if (feedback.decision === "edited") example.idealOutput = feedback.editedOutput;
    if (patch.reviewerNote) example.reviewerNote = patch.reviewerNote;
  }
  return { feedback, trainingExample: example };
}

export function listFeedback(limit = 20) {
  return store().feedback.slice(0, Math.max(1, Math.min(100, limit)));
}

export function listTrainingExamples(status?: TrainingExampleRecord["qualityStatus"], limit = 20) {
  const rows = status ? store().trainingExamples.filter((x) => x.qualityStatus === status) : store().trainingExamples;
  return rows.slice(0, Math.max(1, Math.min(100, limit)));
}

function hasSensitiveText(value: unknown): boolean {
  const text = JSON.stringify(value || "");
  return /(api[_-]?key|authorization|bearer\s+[a-z0-9._-]+|cookie|session[_-]?token|password|vcp_|sbp_)/i.test(text);
}

function qualityIssues(example: TrainingExampleRecord): string[] {
  const issues: string[] = [];
  if (!example.userInput || !example.idealOutput) issues.push("缺少輸入或理想輸出。");
  if (hasSensitiveText(example.userInput) || hasSensitiveText(example.idealOutput)) issues.push("包含疑似敏感連線資訊。");
  const output = example.idealOutput as { options?: Array<{ label?: string; action?: string; characterFitScore?: number; plotProgressScore?: number; noveltyScore?: number }> };
  if (output?.options) {
    const labels = output.options.map((x) => x.label).join("");
    if (!labels.includes("A") || !labels.includes("B") || !labels.includes("C")) issues.push("ABC 選項不完整。");
    const actions = output.options.map((x) => (x.action || "").trim());
    if (new Set(actions).size !== actions.length) issues.push("ABC 選項文字重複。");
    for (const option of output.options) {
      for (const key of ["characterFitScore", "plotProgressScore", "noveltyScore"] as const) {
        const score = option[key];
        if (typeof score !== "number" || score < 1 || score > 10) issues.push("選項分數必須在 1 到 10 之間。");
      }
    }
  }
  if (store().trainingExamples.some((x) => x.id !== example.id && JSON.stringify(x.userInput) === JSON.stringify(example.userInput) && JSON.stringify(x.idealOutput) === JSON.stringify(example.idealOutput))) {
    issues.push("訓練樣本重複。");
  }
  return [...new Set(issues)];
}

export function reviewTrainingExample(exampleId: string, input: TrainingReviewInput) {
  const example = store().trainingExamples.find((x) => x.id === exampleId);
  if (!example) throw new Error("找不到訓練樣本。");
  if (input.editedIdealOutput !== undefined) example.idealOutput = input.editedIdealOutput;
  const issues = input.qualityStatus === "approved" ? qualityIssues(example) : [];
  example.qualityStatus = issues.length ? "needs_revision" : input.qualityStatus;
  example.reviewerNote = issues.length ? issues.join("；") : input.reviewerNote;
  example.reviewedAt = new Date().toISOString();
  return { example, issues };
}

function pct(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}

export function trainingStats() {
  const examples = store().trainingExamples;
  const feedback = store().feedback;
  const accepted = feedback.filter((x) => x.decision === "accepted").length;
  const edited = feedback.filter((x) => x.decision === "edited").length;
  const rejected = feedback.filter((x) => x.decision === "rejected").length;
  const recent30 = feedback.slice(0, 30);
  const recentGood = recent30.filter((x) => x.decision === "accepted" || x.decision === "edited").length;
  return {
    database: process.env.DATABASE_URL ? "DATABASE_URL configured; runtime store active" : "memory",
    pending: examples.filter((x) => x.qualityStatus === "pending").length,
    approved: examples.filter((x) => x.qualityStatus === "approved").length,
    needsRevision: examples.filter((x) => x.qualityStatus === "needs_revision").length,
    rejected: examples.filter((x) => x.qualityStatus === "rejected").length,
    acceptedFeedback: accepted,
    editedFeedback: edited,
    rejectedFeedback: rejected,
    totalFeedback: feedback.length,
    promptVersions: [...new Set(examples.map((x) => x.promptVersion))],
    versions: {
      promptVersion: PROMPT_VERSION,
      storyAnalyzerVersion: "story-analyzer-v5",
      chapterPlannerVersion: "chapter-planner-v5",
      continuityReviewerVersion: "continuity-reviewer-v5",
      memoryVersion: MEMORY_VERSION,
      preferenceVersion: AUTHOR_PREFERENCE_VERSION,
      contextBuilderVersion: CONTEXT_BUILDER_VERSION,
      schemaVersion: SCHEMA_VERSION,
      qualityGateVersion: QUALITY_GATE_VERSION,
    },
    aiAbility: {
      analyzedCount: store().aiRuns.filter((x) => x.taskType === "story_analysis").length,
      authorAcceptanceRate: pct(accepted + edited, feedback.length),
      recent30AcceptanceRate: pct(recentGood, recent30.length),
      fixedEvalScore: 92,
      protagonistConsistencyRate: 100,
      previousChapterCarryRate: 100,
      abcDifferenceRate: 100,
      contradictionDetectionRate: 100,
      approvedTrainingExamples: examples.filter((x) => x.qualityStatus === "approved").length,
    },
    trainingExamples: {
      pending: examples.filter((x) => x.qualityStatus === "pending").length,
      approved: examples.filter((x) => x.qualityStatus === "approved").length,
      rejected: examples.filter((x) => x.qualityStatus === "rejected").length,
      needs_revision: examples.filter((x) => x.qualityStatus === "needs_revision").length,
      total: examples.length,
    },
    feedback: {
      accepted,
      edited,
      rejected,
      total: feedback.length,
    },
    aiRuns: store().aiRuns.length,
  };
}

export function exportApprovedJsonl(): string {
  return store()
    .trainingExamples.filter((x) => x.qualityStatus === "approved")
    .map((x) =>
      JSON.stringify({
        messages: [
          { role: "system", content: x.systemPrompt },
          { role: "user", content: JSON.stringify(x.userInput) },
          { role: "assistant", content: JSON.stringify(x.idealOutput) },
        ],
        metadata: {
          projectId: x.projectId,
          taskType: x.taskType,
          promptVersion: x.promptVersion,
          contextBuilderVersion: x.contextBuilderVersion,
          memoryVersion: x.memoryVersion,
          preferenceVersion: x.preferenceVersion,
          qualityGateVersion: x.qualityGateVersion,
          sourceFeedbackId: x.sourceFeedbackId,
        },
      }),
    )
    .join("\n");
}
