export const LEARNING_EVENT_SCHEMA_VERSION = "p23-learning-event-v1" as const;

export type SovereignLearningEvent = {
  schemaVersion: typeof LEARNING_EVENT_SCHEMA_VERSION;
  eventId: string;
  taskId: string;
  storyId: string;
  storyRevision: number;
  candidateId: string;
  provider: string;
  model: string;
  promptProfile: string;
  retrievedKnowledge: string[];
  generatedPlan: string[];
  candidateText: string | null;
  evaluation: Record<string, number | string | boolean | null>;
  accepted: boolean;
  rejected: boolean;
  userEdit: string | null;
  editDiff: string | null;
  userRating: number | null;
  rejectionReason: string | null;
  adultMode: boolean;
  consent: "private_inference_only" | "personal_learning" | "shared_training_opt_in";
  trainingEligible: boolean;
  excludedFromTraining: boolean;
  createdAt: string;
};
