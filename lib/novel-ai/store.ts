import crypto from "crypto";
import { PROMPT_VERSION, STORY_ANALYZER_SYSTEM_PROMPT } from "./prompts";
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

export function recordAiRun(input: Omit<AiRunRecord, "id" | "createdAt" | "promptVersion">): AiRunRecord {
  const row: AiRunRecord = {
    id: id("airun"),
    promptVersion: PROMPT_VERSION,
    createdAt: new Date().toISOString(),
    ...input,
  };
  store().aiRuns.unshift(row);
  return row;
}

export function recordFeedback(input: FeedbackInput): { feedback: AiFeedbackRecord; trainingExample?: TrainingExampleRecord } {
  const aiRun = store().aiRuns.find((x) => x.id === input.aiRunId);
  if (!aiRun) throw new Error("找不到對應的 AI 執行紀錄，無法保存回饋。");
  if (store().feedback.some((x) => x.aiRunId === input.aiRunId)) {
    throw new Error("同一個 AI 結果已提交正式回饋。若要變更，請使用修改回饋。");
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

  let trainingExample: TrainingExampleRecord | undefined;
  if (input.decision === "accepted" || input.decision === "edited") {
    trainingExample = {
      id: id("train"),
      projectId: aiRun.projectId,
      sourceFeedbackId: feedback.id,
      taskType: aiRun.taskType,
      promptVersion: aiRun.promptVersion,
      systemPrompt: STORY_ANALYZER_SYSTEM_PROMPT,
      userInput: aiRun.inputContext,
      idealOutput: input.decision === "edited" ? input.editedOutput : aiRun.modelOutput,
      qualityStatus: "pending",
      createdAt: now,
    };
    store().trainingExamples.unshift(trainingExample);
  }

  return { feedback, trainingExample };
}

export function patchFeedback(feedbackId: string, patch: FeedbackPatchInput) {
  const feedback = store().feedback.find((x) => x.id === feedbackId);
  if (!feedback) throw new Error("找不到要修改的回饋。");
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
  if (!example.userInput || !example.idealOutput) issues.push("缺少輸入或輸出");
  if (hasSensitiveText(example.userInput) || hasSensitiveText(example.idealOutput)) issues.push("疑似包含敏感資訊");
  const output = example.idealOutput as { options?: Array<{ label?: string; action?: string; characterFitScore?: number; plotProgressScore?: number; noveltyScore?: number }> };
  if (output?.options) {
    const labels = output.options.map((x) => x.label).join("");
    if (!labels.includes("A") || !labels.includes("B") || !labels.includes("C")) issues.push("ABC選項不完整");
    const actions = output.options.map((x) => (x.action || "").trim());
    if (new Set(actions).size !== actions.length) issues.push("ABC選項疑似重複");
    for (const option of output.options) {
      for (const key of ["characterFitScore", "plotProgressScore", "noveltyScore"] as const) {
        const score = option[key];
        if (typeof score !== "number" || score < 1 || score > 10) issues.push("分數不在1至10");
      }
    }
  }
  if (store().trainingExamples.some((x) => x.id !== example.id && JSON.stringify(x.userInput) === JSON.stringify(example.userInput) && JSON.stringify(x.idealOutput) === JSON.stringify(example.idealOutput))) {
    issues.push("與既有案例完全重複");
  }
  return [...new Set(issues)];
}

export function reviewTrainingExample(exampleId: string, input: TrainingReviewInput) {
  const example = store().trainingExamples.find((x) => x.id === exampleId);
  if (!example) throw new Error("找不到訓練案例。");
  if (input.editedIdealOutput !== undefined) example.idealOutput = input.editedIdealOutput;
  const issues = input.qualityStatus === "approved" ? qualityIssues(example) : [];
  example.qualityStatus = issues.length ? "needs_revision" : input.qualityStatus;
  example.reviewerNote = issues.length ? issues.join("；") : input.reviewerNote;
  example.reviewedAt = new Date().toISOString();
  return { example, issues };
}

export function trainingStats() {
  const examples = store().trainingExamples;
  const feedback = store().feedback;
  return {
    database: process.env.DATABASE_URL ? "DATABASE_URL configured; runtime store active" : "memory",
    pending: examples.filter((x) => x.qualityStatus === "pending").length,
    approved: examples.filter((x) => x.qualityStatus === "approved").length,
    needsRevision: examples.filter((x) => x.qualityStatus === "needs_revision").length,
    rejected: examples.filter((x) => x.qualityStatus === "rejected").length,
    acceptedFeedback: feedback.filter((x) => x.decision === "accepted").length,
    editedFeedback: feedback.filter((x) => x.decision === "edited").length,
    rejectedFeedback: feedback.filter((x) => x.decision === "rejected").length,
    totalFeedback: feedback.length,
    promptVersions: [...new Set(examples.map((x) => x.promptVersion))],
    trainingExamples: {
      pending: examples.filter((x) => x.qualityStatus === "pending").length,
      approved: examples.filter((x) => x.qualityStatus === "approved").length,
      rejected: examples.filter((x) => x.qualityStatus === "rejected").length,
      needs_revision: examples.filter((x) => x.qualityStatus === "needs_revision").length,
      total: examples.length,
    },
    feedback: {
      accepted: feedback.filter((x) => x.decision === "accepted").length,
      edited: feedback.filter((x) => x.decision === "edited").length,
      rejected: feedback.filter((x) => x.decision === "rejected").length,
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
          sourceFeedbackId: x.sourceFeedbackId,
        },
      }),
    )
    .join("\n");
}
