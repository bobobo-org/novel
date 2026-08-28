export const VIDEO_PRODUCTION_SCHEMA_VERSION = "novel-video-production-v2" as const;
export const VIDEO_PRODUCTION_HANDOFF_SCHEMA_VERSION = "novel-video-production-handoff-v2" as const;

export type VideoProviderAvailability =
  | "ready"
  | "not_configured"
  | "requires_vendor_onboarding"
  | "contract_only"
  | "disabled";

export type VideoReferenceAssetKind = "character_image" | "location_image" | "prop_image" | "reference_video" | "reference_audio";
export type VideoAspectRatio = "adaptive" | "16:9" | "9:16" | "1:1";
export type VideoResolution = "480p" | "720p" | "1080p" | "4k";
export type VideoProductionJobStatus = "draft" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";

export type VideoProviderCapabilities = {
  textToVideo: boolean;
  imageReferences: boolean;
  videoReferences: boolean;
  audioReferences: boolean;
  synchronizedAudio: boolean;
  videoExtension: boolean;
  timestampEditing: boolean;
  maxClipSeconds: number | null;
  maxImageReferences: number | null;
  maxVideoReferences: number | null;
  maxAudioReferences: number | null;
  aspectRatios: VideoAspectRatio[];
  resolutions: VideoResolution[];
};

export type VideoProviderDescriptor = {
  providerId: string;
  displayName: string;
  connectionKind: "official_api" | "self_hosted_worker" | "manual_handoff";
  availability: VideoProviderAvailability;
  executionReady: boolean;
  dataLeavesDevice: boolean;
  requiresExternalConsent: boolean;
  supportsAdultNamespace: boolean;
  capabilities: VideoProviderCapabilities;
  publicProductUrl: string | null;
  publicApiUrl: string | null;
  availabilityNote: string;
};

export type VideoReferenceAsset = {
  assetId: string;
  kind: VideoReferenceAssetKind;
  label: string;
  source: "project_canon" | "user_upload" | "generated_candidate";
  sourceRefId: string | null;
  localObjectUrl: string | null;
  rightsConfirmed: boolean;
  approvedForExternalProvider: boolean;
};

export type VideoProductionShot = {
  shotId: string;
  order: number;
  episodeId: string;
  sourceSceneId: string;
  startSeconds: number;
  durationSeconds: number;
  visualPrompt: string;
  cameraDirection: string;
  dialogueOrAudioCue: string | null;
  sourceRefIds: string[];
  characterRefIds: string[];
  worldRefIds: string[];
  referenceAssetIds: string[];
  continuityNotes: string[];
  status: "draft" | "approved";
};

export type VideoProductionPlan = {
  schemaVersion: typeof VIDEO_PRODUCTION_SCHEMA_VERSION;
  planId: string;
  projectId: string;
  projectRevision: string;
  approvedDramaId: string;
  approvedDramaRevision: number;
  title: string;
  playbackMode: "linear" | "interactive";
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  totalDurationSeconds: number;
  providerId: string | null;
  referenceAssets: VideoReferenceAsset[];
  shots: VideoProductionShot[];
  status: "draft" | "ready_for_provider";
  createdAt: string;
  updatedAt: string;
};

export type VerifiedVideoArtifact = {
  artifactId: string;
  mimeType: "video/mp4";
  byteLength: number;
  sha256: string;
  durationSeconds: number;
  storageVisibility: "private";
  validated: true;
};

export type VideoProductionJob = {
  jobId: string;
  projectId: string;
  planId: string;
  providerId: string;
  providerTaskId: string | null;
  status: VideoProductionJobStatus;
  createdAt: string;
  updatedAt: string;
  artifact: VerifiedVideoArtifact | null;
  failureCode: string | null;
};

export type VideoProductionHandoffPackage = {
  schemaVersion: typeof VIDEO_PRODUCTION_HANDOFF_SCHEMA_VERSION;
  packageKind: "production_handoff_json_not_video";
  exportedAt: string;
  generatedVideo: false;
  artifact: null;
  artifactClaim: "none";
  selectedProvider: VideoProviderDescriptor | null;
  plan: VideoProductionPlan;
  approvedDrama: unknown;
};

type ShotDraft = {
  shotId: string;
  episodeId: string;
  sourceSceneId: string;
  durationSeconds?: number;
  visualPrompt: string;
  cameraDirection?: string;
  dialogueOrAudioCue?: string | null;
  sourceRefIds?: string[];
  characterRefIds?: string[];
  worldRefIds?: string[];
  referenceAssetIds?: string[];
  continuityNotes?: string[];
};

function boundedClipDuration(value: number | undefined) {
  const duration = Number.isFinite(value) ? Math.round(Number(value)) : 8;
  return Math.min(30, Math.max(4, duration));
}

function unique(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function createVideoProductionPlan(input: {
  planId: string;
  projectId: string;
  projectRevision: string;
  approvedDramaId: string;
  approvedDramaRevision: number;
  title: string;
  playbackMode: "linear" | "interactive";
  aspectRatio?: VideoAspectRatio;
  resolution?: VideoResolution;
  providerId?: string | null;
  referenceAssets?: VideoReferenceAsset[];
  shots: ShotDraft[];
  now?: string;
}): VideoProductionPlan {
  const ids = new Set<string>();
  let cursor = 0;
  const shots = input.shots.map((shot, index): VideoProductionShot => {
    const shotId = shot.shotId.trim();
    if (!shotId || ids.has(shotId)) throw new Error("VIDEO_SHOT_ID_INVALID");
    ids.add(shotId);
    const visualPrompt = shot.visualPrompt.trim();
    if (!visualPrompt) throw new Error("VIDEO_SHOT_PROMPT_REQUIRED");
    const durationSeconds = boundedClipDuration(shot.durationSeconds);
    const result: VideoProductionShot = {
      shotId,
      order: index + 1,
      episodeId: shot.episodeId.trim(),
      sourceSceneId: shot.sourceSceneId.trim(),
      startSeconds: cursor,
      durationSeconds,
      visualPrompt,
      cameraDirection: shot.cameraDirection?.trim() || "依場景動作建立清楚景別，避免無目的運鏡。",
      dialogueOrAudioCue: shot.dialogueOrAudioCue?.trim() || null,
      sourceRefIds: unique(shot.sourceRefIds),
      characterRefIds: unique(shot.characterRefIds),
      worldRefIds: unique(shot.worldRefIds),
      referenceAssetIds: unique(shot.referenceAssetIds),
      continuityNotes: unique(shot.continuityNotes),
      status: "draft",
    };
    cursor += durationSeconds;
    return result;
  });
  if (!shots.length) throw new Error("VIDEO_SHOT_REQUIRED");
  const now = input.now ?? new Date().toISOString();
  return {
    schemaVersion: VIDEO_PRODUCTION_SCHEMA_VERSION,
    planId: input.planId.trim(),
    projectId: input.projectId.trim(),
    projectRevision: input.projectRevision.trim(),
    approvedDramaId: input.approvedDramaId.trim(),
    approvedDramaRevision: input.approvedDramaRevision,
    title: input.title.trim(),
    playbackMode: input.playbackMode,
    aspectRatio: input.aspectRatio ?? "16:9",
    resolution: input.resolution ?? "720p",
    totalDurationSeconds: cursor,
    providerId: input.providerId?.trim() || null,
    referenceAssets: (input.referenceAssets ?? []).map((asset) => ({ ...asset })),
    shots,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

export function videoProviderSubmissionGate(input: {
  provider: VideoProviderDescriptor | null;
  plan: VideoProductionPlan | null;
  approvedDrama: boolean;
  externalConsent: boolean;
  costConfirmed: boolean;
  backendReady: boolean;
  adultNamespace: "general" | "adult_verified";
}) {
  const reasons: string[] = [];
  if (!input.plan) reasons.push("VIDEO_PLAN_REQUIRED");
  if (!input.approvedDrama) reasons.push("APPROVED_DRAMA_REQUIRED");
  if (!input.provider) reasons.push("PROVIDER_REQUIRED");
  if (input.provider && (!input.provider.executionReady || input.provider.availability !== "ready")) {
    reasons.push("PROVIDER_NOT_READY");
  }
  if (!input.backendReady) reasons.push("BACKEND_NOT_READY");
  if (input.provider?.requiresExternalConsent && !input.externalConsent) reasons.push("EXTERNAL_CONSENT_REQUIRED");
  if (!input.costConfirmed) reasons.push("COST_CONFIRMATION_REQUIRED");
  if (input.adultNamespace === "adult_verified" && !input.provider?.supportsAdultNamespace) {
    reasons.push("ADULT_NAMESPACE_UNSUPPORTED");
  }
  return { allowed: reasons.length === 0, reasons } as const;
}

export function createVideoProductionHandoffPackage(input: {
  plan: VideoProductionPlan;
  selectedProvider: VideoProviderDescriptor | null;
  approvedDrama: unknown;
  now?: string;
}): VideoProductionHandoffPackage {
  return {
    schemaVersion: VIDEO_PRODUCTION_HANDOFF_SCHEMA_VERSION,
    packageKind: "production_handoff_json_not_video",
    exportedAt: input.now ?? new Date().toISOString(),
    generatedVideo: false,
    artifact: null,
    artifactClaim: "none",
    selectedProvider: input.selectedProvider ? {
      ...input.selectedProvider,
      capabilities: {
        ...input.selectedProvider.capabilities,
        aspectRatios: [...input.selectedProvider.capabilities.aspectRatios],
        resolutions: [...input.selectedProvider.capabilities.resolutions],
      },
    } : null,
    plan: input.plan,
    approvedDrama: input.approvedDrama,
  };
}
