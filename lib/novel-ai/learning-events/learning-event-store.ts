import crypto from "node:crypto";
import { LEARNING_EVENT_SCHEMA_VERSION, type SovereignLearningEvent } from "./types";

export function createLearningEvent(input: Omit<SovereignLearningEvent, "schemaVersion" | "eventId" | "trainingEligible" | "excludedFromTraining" | "createdAt"> & {
  excludeFromTraining?: boolean;
}) {
  const excludedFromTraining = input.excludeFromTraining ?? true;
  const trainingEligible = input.consent !== "private_inference_only" && !excludedFromTraining;
  return {
    schemaVersion: LEARNING_EVENT_SCHEMA_VERSION,
    eventId: `learning_event_${crypto.randomUUID()}`,
    taskId: input.taskId,
    storyId: input.storyId,
    storyRevision: input.storyRevision,
    candidateId: input.candidateId,
    provider: input.provider,
    model: input.model,
    promptProfile: input.promptProfile,
    retrievedKnowledge: input.retrievedKnowledge,
    generatedPlan: input.generatedPlan,
    candidateText: input.consent === "private_inference_only" ? null : input.candidateText,
    evaluation: input.evaluation,
    accepted: input.accepted,
    rejected: input.rejected,
    userEdit: input.consent === "private_inference_only" ? null : input.userEdit,
    editDiff: input.consent === "private_inference_only" ? null : input.editDiff,
    userRating: input.userRating,
    rejectionReason: input.rejectionReason,
    adultMode: input.adultMode,
    consent: input.consent,
    trainingEligible,
    excludedFromTraining,
    createdAt: new Date().toISOString(),
  } satisfies SovereignLearningEvent;
}

export class MemoryLearningEventStore {
  private events = new Map<string, SovereignLearningEvent>();

  put(event: SovereignLearningEvent) { this.events.set(event.eventId, structuredClone(event)); return event; }
  list(storyId?: string) { return [...this.events.values()].filter((event) => !storyId || event.storyId === storyId).map((event) => structuredClone(event)); }
  delete(eventId: string) { return this.events.delete(eventId); }
  exclude(eventId: string) {
    const event = this.events.get(eventId);
    if (!event) throw Object.assign(new Error("找不到學習事件。"), { code: "LEARNING_EVENT_NOT_FOUND" });
    const updated = { ...event, excludedFromTraining: true, trainingEligible: false };
    this.events.set(eventId, updated);
    return structuredClone(updated);
  }
  export(storyId?: string) { return { schemaVersion: LEARNING_EVENT_SCHEMA_VERSION, events: this.list(storyId) }; }
}
