import {
  STORY_MEDIA_EXTENSION_SCHEMA_VERSION,
  STORY_MEDIA_TASKS,
  StoryMediaExtensionError,
  type StoryMediaCandidatePackage,
  type StoryMediaProviderCapability,
  type StoryMediaSourceRef,
  type StoryMediaTargetFamily,
  type StoryMediaTask,
} from "./types";

const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function validateStoryMediaSourceRefs(sourceRefs: StoryMediaSourceRef[]) {
  if (!sourceRefs.length) {
    throw new StoryMediaExtensionError("MEDIA_SOURCE_REQUIRED", "At least one source reference is required.");
  }
  for (const source of sourceRefs) {
    if (!hasText(source.sourceId)) {
      throw new StoryMediaExtensionError("MEDIA_SOURCE_REQUIRED", "Every source reference requires a source id.");
    }
    if (!hasText(source.revision)) {
      throw new StoryMediaExtensionError("MEDIA_SOURCE_REVISION_REQUIRED", `Source ${source.sourceId} requires a revision.`);
    }
  }
  return sourceRefs;
}

export function resolveStoryMediaProvider(input: {
  task: StoryMediaTask;
  adultNamespace: "general" | "adult_verified";
  allowExternal: boolean;
  externalConsent: boolean;
  providers: StoryMediaProviderCapability[];
}) {
  const rejectedProviders: Array<{ providerId: string; reason: string }> = [];
  for (const provider of input.providers) {
    if (!provider.tasks.includes(input.task)) {
      rejectedProviders.push({ providerId: provider.providerId, reason: "capability_missing" });
      continue;
    }
    if (provider.runtimeStatus !== "ready") {
      rejectedProviders.push({ providerId: provider.providerId, reason: `runtime_${provider.runtimeStatus}` });
      continue;
    }
    if (!provider.localOnly && !input.allowExternal) {
      rejectedProviders.push({ providerId: provider.providerId, reason: "external_provider_disabled" });
      continue;
    }
    if (provider.requiresExternalConsent && !input.externalConsent) {
      rejectedProviders.push({ providerId: provider.providerId, reason: "external_consent_missing" });
      continue;
    }
    if (input.adultNamespace === "adult_verified" && !provider.supportsAdultNamespace) {
      rejectedProviders.push({ providerId: provider.providerId, reason: "adult_namespace_unsupported" });
      continue;
    }
    return { selectedProvider: provider, rejectedProviders };
  }

  throw new StoryMediaExtensionError(
    input.providers.some((provider) => provider.tasks.includes(input.task))
      ? "MEDIA_PROVIDER_NOT_CONNECTED"
      : "MEDIA_CAPABILITY_INSUFFICIENT",
    "No authorized media provider can perform this task.",
  );
}

export function createStoryMediaCandidatePackage(input: {
  packageId: string;
  requestId: string;
  projectId: string;
  projectRevision: string;
  task: StoryMediaTask;
  targetFamily?: StoryMediaTargetFamily;
  provider?: StoryMediaProviderCapability | null;
  sourceRefs: StoryMediaSourceRef[];
  characterContinuityRefs?: string[];
  worldContinuityRefs?: string[];
  storyboard?: StoryMediaCandidatePackage["storyboard"];
  mediaPrompt?: string | null;
  adultNamespace?: "general" | "adult_verified";
  externalConsent?: boolean;
  now?: string;
}): StoryMediaCandidatePackage {
  if (!STORY_MEDIA_TASKS.includes(input.task)) {
    throw new StoryMediaExtensionError("MEDIA_SCHEMA_UNSUPPORTED", "Unsupported media task.");
  }
  validateStoryMediaSourceRefs(input.sourceRefs);

  const provider = input.provider ?? null;
  const externalConsent = input.externalConsent ?? false;
  if (provider?.requiresExternalConsent && !externalConsent) {
    throw new StoryMediaExtensionError("MEDIA_EXTERNAL_CONSENT_REQUIRED", "External media execution requires explicit consent.");
  }

  const adultNamespace = input.adultNamespace ?? "general";
  if (adultNamespace === "adult_verified" && provider && !provider.supportsAdultNamespace) {
    throw new StoryMediaExtensionError("MEDIA_ADULT_NAMESPACE_UNSUPPORTED", "The selected provider does not support the verified adult namespace.");
  }

  return {
    schemaVersion: STORY_MEDIA_EXTENSION_SCHEMA_VERSION,
    packageId: input.packageId,
    requestId: input.requestId,
    projectId: input.projectId,
    projectRevision: input.projectRevision,
    task: input.task,
    targetFamily: provider?.targetFamily ?? input.targetFamily ?? "user_authorized_media_provider",
    providerId: provider?.providerId ?? null,
    modelId: provider?.modelId ?? null,
    runtimeStatus: provider?.runtimeStatus ?? "contract_only",
    sourceRefs: input.sourceRefs.map((source) => ({ ...source })),
    characterContinuityRefs: [...(input.characterContinuityRefs ?? [])],
    worldContinuityRefs: [...(input.worldContinuityRefs ?? [])],
    storyboard: (input.storyboard ?? []).map((shot) => ({
      ...shot,
      sourceRefIds: [...shot.sourceRefIds],
      continuityNotes: [...shot.continuityNotes],
      directorPackage: shot.directorPackage
        ? {
            ...shot.directorPackage,
            assetLocks: [...shot.directorPackage.assetLocks],
            spatialBlocking: [...shot.directorPackage.spatialBlocking],
            performanceDirection: [...shot.directorPackage.performanceDirection],
            shotGrammar: { ...shot.directorPackage.shotGrammar },
            stateHandoff: { ...shot.directorPackage.stateHandoff },
            audioPlan: { ...shot.directorPackage.audioPlan },
            negativeConstraints: [...shot.directorPackage.negativeConstraints],
            qualityChecks: [...shot.directorPackage.qualityChecks],
          }
        : undefined,
    })),
    mediaPrompt: input.mediaPrompt ?? null,
    adultNamespace,
    dataLeavesDevice: provider ? !provider.localOnly : false,
    externalConsent,
    candidateStatus: "awaiting_approval",
    canonicalWriteAllowed: false,
    createdAt: input.now ?? new Date().toISOString(),
  };
}
