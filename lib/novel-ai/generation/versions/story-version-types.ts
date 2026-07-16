import crypto from "crypto";
import type { SQLiteProjectConnection } from "../../storage/sqlite/sqlite-connection";

export const STORY_VERSION_TRANSFORM_VERSION = "h2p5-story-version-branch-transforms-v1";
export const STORY_VERSION_MIGRATION_VERSION = "019_story_scene_version_transforms";

export type StoryVersionType =
  | "original"
  | "expanded"
  | "condensed"
  | "alternate_tone"
  | "alternate_viewpoint"
  | "alternate_pacing"
  | "outline_only"
  | "short_drama"
  | "audio_drama";

export type StoryRating = "private_adult" | "mature" | "fade_to_black" | "public_romance";
export type StoryVisibility = "private" | "project_only" | "local_library" | "export_allowed" | "public_ready" | "local_only";
export type CanonicalStatus = "draft" | "candidate" | "approved" | "archived" | "no-change";

export type StoryOutcomeSnapshot = {
  sceneOutcome: string;
  requiredEvents: string[];
  characterChanges: string[];
  relationshipChanges: string[];
  plotConsequences: string[];
  unresolvedConsequences: string[];
  canonicalFactsReferenced: string[];
  candidateFactsIntroduced: string[];
  branchId: string;
  continuityVersion: string;
  consequenceCandidateIds: string[];
  contentHash: string;
};

export type StoryRetrievalMetadata = {
  projectId: string;
  classificationPackId?: string;
  topicId?: string;
  storyEngineId?: string;
  sceneProfileId?: string;
  sceneType?: string;
  stageType?: string;
  participantIds: string[];
  relationshipIds: string[];
  branchId: string;
  versionId: string;
  versionType: StoryVersionType;
  rating: StoryRating;
  visibility: StoryVisibility;
  canonicalStatus: CanonicalStatus;
  consequenceStatus: string;
  contentHash: string;
  indexedAt?: string;
  deletedAt?: string;
};

export type StorySceneVersion = {
  projectId: string;
  sceneId: string;
  stageId?: string;
  branchId: string;
  versionId: string;
  parentVersionId?: string;
  versionType: StoryVersionType;
  rating: StoryRating;
  visibility: StoryVisibility;
  canonicalStatus: CanonicalStatus;
  contentText: string;
  summary: string;
  contentHash: string;
  outcomeSnapshot: StoryOutcomeSnapshot;
  retrievalMetadata: StoryRetrievalMetadata;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type StoryVersionCreateInput = {
  projectId: string;
  sceneId: string;
  stageId?: string;
  branchId?: string;
  parentVersionId?: string;
  versionType?: StoryVersionType;
  rating?: StoryRating;
  visibility?: StoryVisibility;
  canonicalStatus?: CanonicalStatus;
  contentText: string;
  summary?: string;
  requiredEvents?: string[];
  characterChanges?: string[];
  relationshipChanges?: string[];
  plotConsequences?: string[];
  unresolvedConsequences?: string[];
  canonicalFactsReferenced?: string[];
  candidateFactsIntroduced?: string[];
  consequenceCandidateIds?: string[];
  classificationPackId?: string;
  topicId?: string;
  storyEngineId?: string;
  sceneProfileId?: string;
  sceneType?: string;
  stageType?: string;
  participantIds?: string[];
  relationshipIds?: string[];
};

export type StoryVersionOptions = {
  connection?: SQLiteProjectConnection;
  model?: string;
  ollamaEndpoint?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type StoryTransformType =
  | "private_to_mature"
  | "private_to_fade_to_black"
  | "private_to_public_romance"
  | "short_drama"
  | "audio_drama"
  | "outline"
  | "tone_variant"
  | "viewpoint_variant"
  | "pacing_variant";

export type StoryOutcomeParityResult = {
  parityStatus: "passed" | "warning" | "failed";
  matchedOutcomes: string[];
  missingOutcomes: string[];
  changedOutcomes: string[];
  unsupportedFacts: string[];
  severity: "none" | "info" | "minor" | "major" | "blocking";
  recommendedFixes: string[];
};

export function nowIso() {
  return new Date().toISOString();
}

export function id(prefix: string) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

export function stableHash(value: unknown) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function summarizeText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 140) return compact;
  return `${compact.slice(0, 137)}...`;
}

