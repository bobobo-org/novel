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
  novelMemory: z.unknown().optional(),
  contextSelection: z.array(z.string().max(300)).max(50).optional(),
});

export const AnalysisEvidenceSchema = z.object({
  sourceType: z.enum(["主角設定", "故事摘要", "上一章", "近期正文", "未解事件", "秘密", "道具", "世界狀態", "作者要求"]),
  sourceId: z.string().max(120).optional(),
  sourceLabel: z.string().max(200),
  reason: z.string().max(600),
});

export const StoryOptionSchema = z.object({
  label: z.enum(["A", "B", "C"]),
  action: z.string().min(8).max(700),
  strategyType: z.enum(["主動推進", "謹慎調查", "轉折高代價"]),
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
    status: z.enum(["穩定", "可能偏移", "明顯矛盾"]),
    explanation: z.string().min(4).max(800),
  }),
  recommendedStrategy: z.string().min(2).max(600),
  recommendationReason: z.string().min(4).max(800),
  continuityWarnings: z.array(z.string().max(400)).max(12),
  missingInformation: z.array(z.string().max(400)).max(12),
  forbiddenActions: z.array(z.string().max(400)).max(12),
  options: z.tuple([StoryOptionSchema, StoryOptionSchema, StoryOptionSchema]),
  analysisEvidence: z.array(AnalysisEvidenceSchema).max(12).default([]),
  analysisScores: z.object({
    plotProgress: z.number().int().min(1).max(10),
    characterConsistency: z.number().int().min(1).max(10),
    novelty: z.number().int().min(1).max(10),
    readerHook: z.number().int().min(1).max(10),
    emotionalPayoff: z.number().int().min(1).max(10),
    riskClarity: z.number().int().min(1).max(10),
    evidenceUse: z.number().int().min(1).max(10),
  }).default({
    plotProgress: 7,
    characterConsistency: 7,
    novelty: 7,
    readerHook: 7,
    emotionalPayoff: 7,
    riskClarity: 7,
    evidenceUse: 7,
  }),
  qualityGate: z.object({
    passed: z.boolean(),
    warnings: z.array(z.string().max(300)).max(20),
  }).default({ passed: true, warnings: [] }),
});

export const NovelMemorySchema = z.object({
  projectId: z.string().min(1).max(120),
  version: z.number().int().min(1).default(1),
  globalSummary: z.string().max(3000).default(""),
  recentChapterSummaries: z.array(z.object({
    chapterId: z.string().max(120),
    chapterTitle: z.string().max(200),
    summary: z.string().max(1200),
    chapterResult: z.string().max(800),
    endingHook: z.string().max(800),
    timelinePosition: z.string().max(200).default(""),
    createdAt: z.string(),
  })).max(20).default([]),
  chapterSummaries: z.array(z.object({
    chapterId: z.string().max(120),
    chapterTitle: z.string().max(200),
    summary: z.string().max(1200),
    chapterResult: z.string().max(800),
    endingHook: z.string().max(800),
    timelinePosition: z.string().max(200).default(""),
    createdAt: z.string(),
  })).max(200).default([]),
  characterStates: z.array(z.object({
    characterId: z.string().max(120),
    name: z.string().max(120),
    role: z.string().max(120).default(""),
    archetype: z.string().max(160).default(""),
    currentGoal: z.string().max(500).default(""),
    currentEmotion: z.string().max(300).default(""),
    currentLocation: z.string().max(300).default(""),
    physicalCondition: z.string().max(300).default(""),
    relationshipChanges: z.array(z.string().max(200)).default([]),
    relationships: z.array(z.object({
      targetCharacterId: z.string().max(120),
      relationship: z.string().max(160),
      currentStatus: z.string().max(200),
      recentChange: z.string().max(300),
    })).default([]),
    knownInformation: z.array(z.string().max(200)).default([]),
    unknownInformation: z.array(z.string().max(200)).default([]),
    alive: z.boolean().default(true),
    lastAppearedChapterId: z.string().max(120).default(""),
  })).max(80).default([]),
  unresolvedEvents: z.array(z.object({
    id: z.string().max(120),
    title: z.string().max(200),
    description: z.string().max(800),
    importance: z.enum(["低", "中", "高"]),
    introducedChapterId: z.string().max(120),
    relatedCharacters: z.array(z.string().max(120)).default([]),
    expectedResolutionChapter: z.string().max(120).optional(),
    status: z.enum(["未處理", "進行中", "已解決", "已放棄"]),
  })).max(80).default([]),
  secrets: z.array(z.object({
    id: z.string().max(120),
    content: z.string().max(800),
    knownBy: z.array(z.string().max(120)).default([]),
    revealed: z.boolean().default(false),
    revealedToReader: z.boolean().default(false),
    revealedChapterId: z.string().max(120).optional(),
  })).max(80).default([]),
  importantItems: z.array(z.object({
    id: z.string().max(120),
    name: z.string().max(120),
    owner: z.string().max(120).default(""),
    location: z.string().max(200).default(""),
    status: z.string().max(200).default(""),
    lastSeenChapterId: z.string().max(120).default(""),
  })).max(80).default([]),
  worldState: z.object({
    currentTime: z.string().max(200).default(""),
    currentLocation: z.string().max(200).default(""),
    majorEvents: z.array(z.string().max(300)).default([]),
    activeRules: z.array(z.string().max(300)).default([]),
  }).default({ currentTime: "", currentLocation: "", majorEvents: [], activeRules: [] }),
  recentChoices: z.array(z.object({
    chapterId: z.string().max(120),
    choice: z.string().max(500),
    consequence: z.string().max(500),
  })).max(30).default([]),
  forbiddenChanges: z.array(z.string().max(300)).max(50).default([]),
  updatedAt: z.string().default(""),
});

export const MemoryUpdateCandidateSchema = z.object({
  projectId: z.string().min(1).max(120),
  chapterId: z.string().max(120).optional(),
  originalCandidate: z.unknown().optional(),
  chapterSummary: z.string().max(1200),
  chapterResult: z.string().max(800),
  endingHook: z.string().max(800),
  timelinePosition: z.string().max(200).default(""),
  characterUpdates: z.array(z.object({
    characterId: z.string().max(120).optional(),
    characterName: z.string().max(120),
    changedFields: z.record(z.string(), z.unknown()),
    evidence: z.string().max(800),
    decision: z.enum(["accept", "ignore"]).optional(),
  })).default([]),
  newUnresolvedEvents: z.array(z.object({
    title: z.string().max(200),
    description: z.string().max(800),
    importance: z.enum(["低", "中", "高"]),
    relatedCharacters: z.array(z.string().max(120)).default([]),
    decision: z.enum(["accept", "ignore"]).optional(),
  })).default([]),
  updatedUnresolvedEvents: z.array(z.object({
    eventId: z.string().max(120),
    newStatus: z.enum(["未處理", "進行中", "已解決", "已放棄"]),
    evidence: z.string().max(800),
    decision: z.enum(["accept", "ignore"]).optional(),
  })).default([]),
  resolvedEventIds: z.array(z.string().max(120)).default([]),
  newSecrets: z.array(z.object({
    content: z.string().max(800),
    knownBy: z.array(z.string().max(120)).default([]),
    revealedToReader: z.boolean().default(false),
    decision: z.enum(["accept", "ignore"]).optional(),
  })).default([]),
  revealedSecretIds: z.array(z.string().max(120)).default([]),
  itemUpdates: z.array(z.object({
    itemId: z.string().max(120).optional(),
    itemName: z.string().max(120),
    owner: z.string().max(120).optional(),
    location: z.string().max(200).optional(),
    status: z.string().max(200).optional(),
    evidence: z.string().max(800).optional(),
    decision: z.enum(["accept", "ignore"]).optional(),
  })).default([]),
  worldStateUpdates: z.object({
    currentTime: z.string().max(200).optional(),
    currentLocation: z.string().max(200).optional(),
    majorEvents: z.array(z.string().max(300)).optional(),
  }).default({}),
  continuityWarnings: z.array(z.string().max(500)).default([]),
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
    ctx.addIssue({ code: "custom", path: ["editedOutput"], message: "修改後接受必須提供 editedOutput。" });
  }
  if (value.decision === "rejected" && (!value.rejectionReasons || value.rejectionReasons.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["rejectionReasons"], message: "拒絕必須至少提供一個原因。" });
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
export type NovelMemory = z.infer<typeof NovelMemorySchema>;
export type MemoryUpdateCandidate = z.infer<typeof MemoryUpdateCandidateSchema>;
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
