import crypto from "crypto";
import { PROMPT_VERSION, STORY_ANALYZER_SYSTEM_PROMPT } from "./prompts";
import type { FeedbackInput } from "./schemas";

export type AiRunRecord = {
  id: string;
  projectId: string;
  chapterId?: string;
  taskType: "story_analysis" | "chapter_plan" | "continuity_review";
  provider: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  status: "success" | "error";
  errorCode?: string;
  createdAt: string;
};

export type AiFeedbackRecord = {
  id: string;
  aiRunId?: string;
  projectId: string;
  chapterId?: string;
  decision: "accepted" | "edited" | "rejected";
  selectedOption?: "A" | "B" | "C";
  originalOutput: unknown;
  editedOutput?: unknown;
  rejectionReasons?: string[];
  authorNote?: string;
  createdAt: string;
};

export type TrainingExampleRecord = {
  id: string;
  projectId: string;
  sourceFeedbackId: string;
  taskType: "story_analysis" | "chapter_plan" | "continuity_review";
  systemPrompt: string;
  userInput: unknown;
  idealOutput: unknown;
  qualityStatus: "pending" | "approved" | "rejected" | "needs_revision";
  reviewedAt?: string;
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
  const feedback: AiFeedbackRecord = {
    id: id("feedback"),
    aiRunId: input.aiRunId,
    projectId: input.projectId,
    chapterId: input.chapterId,
    decision: input.decision,
    selectedOption: input.selectedOption,
    originalOutput: input.modelOutput,
    editedOutput: input.editedOutput,
    rejectionReasons: input.rejectionReasons,
    authorNote: input.authorNote,
    createdAt: new Date().toISOString(),
  };
  store().feedback.unshift(feedback);

  let trainingExample: TrainingExampleRecord | undefined;
  if (input.decision === "accepted" || input.decision === "edited") {
    trainingExample = {
      id: id("train"),
      projectId: input.projectId,
      sourceFeedbackId: feedback.id,
      taskType: input.taskType,
      systemPrompt: STORY_ANALYZER_SYSTEM_PROMPT,
      userInput: input.inputContext,
      idealOutput: input.decision === "edited" ? input.editedOutput : input.modelOutput,
      qualityStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    store().trainingExamples.unshift(trainingExample);
  }

  return { feedback, trainingExample };
}

export function trainingStats() {
  const examples = store().trainingExamples;
  const feedback = store().feedback;
  return {
    database: process.env.DATABASE_URL ? "DATABASE_URL configured; runtime store active" : "memory",
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
          sourceFeedbackId: x.sourceFeedbackId,
        },
      }),
    )
    .join("\n");
}
