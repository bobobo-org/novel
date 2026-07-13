import { z } from "zod";

export const StoryItemSchema = z.object({
  name: z.string().max(120),
  owner: z.string().max(120).optional(),
  location: z.string().max(120).optional(),
  status: z.string().max(200).optional(),
});

export const ProtagonistSchema = z.object({
  name: z.string().max(80).default("主角"),
  archetype: z.string().max(120).default(""),
  personality: z.string().max(500).default(""),
  goal: z.string().max(500).default(""),
  actionStyle: z.string().max(500).default(""),
  speechStyle: z.string().max(500).default(""),
  strengths: z.string().max(500).default(""),
  weaknesses: z.string().max(500).default(""),
  fear: z.string().max(500).default(""),
});

export const StoryContextSchema = z.object({
  projectId: z.string().min(1).max(120),
  chapterId: z.string().max(120).optional(),
  genre: z.string().max(120).default(""),
  subgenre: z.string().max(120).default(""),
  narrativeStyle: z.string().max(120).default(""),
  protagonist: ProtagonistSchema,
  antagonist: z.string().max(160).optional(),
  mainConflict: z.string().max(800).default(""),
  previousChapterSummary: z.string().max(2000).default(""),
  recentText: z.string().max(5000).default(""),
  unresolvedEvents: z.array(z.string().max(300)).max(30).default([]),
  resolvedEvents: z.array(z.string().max(300)).max(30).default([]),
  revealedSecrets: z.array(z.string().max(300)).max(30).default([]),
  unrevealedSecrets: z.array(z.string().max(300)).max(30).default([]),
  importantItems: z.array(StoryItemSchema).max(30).default([]),
  recentChoices: z.array(z.string().max(300)).max(20).default([]),
  forbiddenChanges: z.array(z.string().max(300)).max(30).default([]),
  chapterGoal: z.string().max(800).optional(),
  authorInstruction: z.string().max(1200).optional(),
});

export const StoryOptionSchema = z.object({
  label: z.enum(["A", "B", "C"]),
  action: z.string().min(8).max(700),
  strategyType: z.enum(["積極推進", "謹慎調查", "轉折高代價"]),
  reason: z.string().min(4).max(700),
  risk: z.enum(["低", "中", "高"]),
  possibleCost: z.string().min(2).max(500),
  expectedEffect: z.string().min(2).max(500),
  characterFitScore: z.number().int().min(1).max(10),
  plotProgressScore: z.number().int().min(1).max(10),
  noveltyScore: z.number().int().min(1).max(10),
});

export const StoryAnalysisSchema = z.object({
  situation: z.string().min(4).max(1200),
  currentStoryStage: z.string().min(2).max(160),
  characterConsistency: z.object({
    status: z.enum(["一致", "可能偏離", "明顯矛盾"]),
    explanation: z.string().min(4).max(800),
  }),
  recommendedStrategy: z.string().min(2).max(600),
  recommendationReason: z.string().min(4).max(800),
  continuityWarnings: z.array(z.string().max(400)).max(12),
  missingInformation: z.array(z.string().max(400)).max(12),
  forbiddenActions: z.array(z.string().max(400)).max(12),
  options: z.tuple([StoryOptionSchema, StoryOptionSchema, StoryOptionSchema]),
});

export const ChapterPlanSchema = z.object({
  chapterPurpose: z.string().min(2).max(800),
  openingSituation: z.string().min(2).max(800),
  protagonistStrategy: z.string().min(2).max(800),
  mainObstacle: z.string().min(2).max(800),
  turningPoint: z.string().min(2).max(800),
  cost: z.string().min(2).max(800),
  chapterResult: z.string().min(2).max(800),
  endingHook: z.string().min(2).max(800),
});

export const ContinuityReviewSchema = z.object({
  passed: z.boolean(),
  characterIssues: z.array(z.string().max(500)).max(20),
  timelineIssues: z.array(z.string().max(500)).max(20),
  secretIssues: z.array(z.string().max(500)).max(20),
  itemIssues: z.array(z.string().max(500)).max(20),
  repetitionIssues: z.array(z.string().max(500)).max(20),
  suggestedFixes: z.array(z.string().max(500)).max(20),
});

export const AiTaskTypeSchema = z.enum(["story_analysis", "story_options", "chapter_plan", "continuity_review"]);

const FeedbackBaseSchema = z.object({
  aiRunId: z.string().min(1).max(120),
  decision: z.enum(["accepted", "edited", "rejected"]),
  selectedOption: z.enum(["A", "B", "C"]).optional(),
  editedOutput: z.unknown().optional(),
  rejectionReasons: z.array(z.string().max(200)).max(20).optional(),
  authorNote: z.string().max(1000).optional(),
});

export const FeedbackSchema = FeedbackBaseSchema.superRefine((value, ctx) => {
  if (value.decision === "edited" && value.editedOutput == null) {
    ctx.addIssue({ code: "custom", path: ["editedOutput"], message: "修改後接受必須包含 editedOutput。" });
  }
  if (value.decision === "rejected" && (!value.rejectionReasons || value.rejectionReasons.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["rejectionReasons"], message: "拒絕必須至少選擇一個原因。" });
  }
});

export const FeedbackPatchSchema = FeedbackBaseSchema.partial().extend({
  reviewerNote: z.string().max(1000).optional(),
});

export const TrainingReviewSchema = z.object({
  qualityStatus: z.enum(["approved", "rejected", "needs_revision"]),
  reviewerNote: z.string().max(1000).optional(),
  editedIdealOutput: z.unknown().optional(),
});

export type StoryContext = z.infer<typeof StoryContextSchema>;
export type StoryOption = z.infer<typeof StoryOptionSchema>;
export type StoryAnalysis = z.infer<typeof StoryAnalysisSchema>;
export type ChapterPlan = z.infer<typeof ChapterPlanSchema>;
export type ContinuityReview = z.infer<typeof ContinuityReviewSchema>;
export type FeedbackInput = z.infer<typeof FeedbackSchema>;
export type FeedbackPatchInput = z.infer<typeof FeedbackPatchSchema>;
export type TrainingReviewInput = z.infer<typeof TrainingReviewSchema>;

export function enforceOptionLabels(analysis: StoryAnalysis): StoryAnalysis {
  return {
    ...analysis,
    options: analysis.options.map((option, index) => ({
      ...option,
      label: ["A", "B", "C"][index] as "A" | "B" | "C",
    })) as StoryAnalysis["options"],
  };
}
