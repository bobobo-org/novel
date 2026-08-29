import type { NovelToVideoDirectorPackage } from "./director-doctrine";

export const STORY_MEDIA_EXTENSION_SCHEMA_VERSION = "story-media-extension-v1" as const;
export const STORY_MEDIA_EXTENSION_EVOLUTION = {
  current: STORY_MEDIA_EXTENSION_SCHEMA_VERSION,
  accepts: [STORY_MEDIA_EXTENSION_SCHEMA_VERSION],
  migrationPolicy: "additive_fields_only",
} as const;

export const STORY_MEDIA_TASKS = [
  "story_to_storyboard",
  "scene_to_video_prompt",
  "character_visual_bible",
  "shot_continuity_check",
  "video_generation",
] as const;

export type StoryMediaTask = typeof STORY_MEDIA_TASKS[number];
export type StoryMediaRuntimeStatus = "contract_only" | "not_connected" | "partial" | "ready";
export type StoryMediaTargetFamily = "local_media_runtime" | "private_media_hub" | "user_authorized_media_provider";

export type StoryMediaSourceRef = {
  sourceType: "chapter" | "character" | "world_rule" | "timeline" | "story_bible" | "accepted_choice" | "story_branch";
  sourceId: string;
  revision: string;
  evidenceExcerpt: string | null;
};

export type StoryMediaProviderCapability = {
  providerId: string;
  targetFamily: StoryMediaTargetFamily;
  tasks: StoryMediaTask[];
  runtimeStatus: StoryMediaRuntimeStatus;
  localOnly: boolean;
  requiresExternalConsent: boolean;
  supportsAdultNamespace: boolean;
  modelId: string | null;
};

export type StoryMediaCandidatePackage = {
  schemaVersion: typeof STORY_MEDIA_EXTENSION_SCHEMA_VERSION;
  packageId: string;
  requestId: string;
  projectId: string;
  projectRevision: string;
  task: StoryMediaTask;
  targetFamily: StoryMediaTargetFamily;
  providerId: string | null;
  modelId: string | null;
  runtimeStatus: StoryMediaRuntimeStatus;
  sourceRefs: StoryMediaSourceRef[];
  characterContinuityRefs: string[];
  worldContinuityRefs: string[];
  storyboard: Array<{
    shotId: string;
    sourceRefIds: string[];
    visualIntent: string;
    continuityNotes: string[];
    directorPackage?: NovelToVideoDirectorPackage;
  }>;
  mediaPrompt: string | null;
  adultNamespace: "general" | "adult_verified";
  dataLeavesDevice: boolean;
  externalConsent: boolean;
  candidateStatus: "awaiting_approval";
  canonicalWriteAllowed: false;
  createdAt: string;
};

export type StoryMediaExtensionErrorCode =
  | "MEDIA_SCHEMA_UNSUPPORTED"
  | "MEDIA_SOURCE_REQUIRED"
  | "MEDIA_SOURCE_REVISION_REQUIRED"
  | "MEDIA_PROVIDER_NOT_CONNECTED"
  | "MEDIA_CAPABILITY_INSUFFICIENT"
  | "MEDIA_EXTERNAL_CONSENT_REQUIRED"
  | "MEDIA_ADULT_NAMESPACE_UNSUPPORTED";

export class StoryMediaExtensionError extends Error {
  readonly code: StoryMediaExtensionErrorCode;

  constructor(
    code: StoryMediaExtensionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StoryMediaExtensionError";
    this.code = code;
  }
}
