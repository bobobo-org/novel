import type {
  NormalizedVideoProviderJob,
  VideoProviderAdapter,
  VideoProviderCancelReceipt,
  VideoProviderRatio,
  VideoProviderResolution,
} from "./video-provider-adapter";

export const VIDEO_SUBMISSION_SCHEMA_VERSION = "video-production-submit-v2" as const;
export const VIDEO_RETRY_SCHEMA_VERSION = "video-production-retry-v1" as const;

// v2 intentionally limits the public submission envelope to the resolutions that
// every currently implemented adapter contract can validate. A later schema may
// widen this without coupling the orchestration layer to any named provider.
export type VideoSubmissionResolution = Extract<VideoProviderResolution, "480p" | "720p">;
export type VideoSubmissionRatio = VideoProviderRatio;

export type VideoRuntimeErrorCode =
  | "VIDEO_REQUEST_INVALID"
  | "VIDEO_APPROVED_DRAMA_REQUIRED"
  | "VIDEO_EXTERNAL_CONSENT_REQUIRED"
  | "VIDEO_COST_CONFIRMATION_REQUIRED"
  | "VIDEO_ADULT_NAMESPACE_UNSUPPORTED"
  | "VIDEO_PROVIDER_NOT_CONFIGURED"
  | "VIDEO_DURABLE_STORE_NOT_CONFIGURED"
  | "VIDEO_ARTIFACT_STORE_NOT_CONFIGURED"
  | "VIDEO_JOB_NOT_FOUND"
  | "VIDEO_JOB_CANCEL_NOT_SUPPORTED"
  | "VIDEO_JOB_RETRY_NOT_SUPPORTED"
  | "VIDEO_JOB_ARTIFACT_NOT_VERIFIED"
  | "VIDEO_JOB_RESPONSE_UNSAFE";

export class VideoRuntimeError extends Error {
  readonly code: VideoRuntimeErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: VideoRuntimeErrorCode, message: string, status: number, retryable = false) {
    super(message);
    this.name = "VideoRuntimeError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export type ValidatedVideoSubmission = {
  schemaVersion: typeof VIDEO_SUBMISSION_SCHEMA_VERSION;
  idempotencyKey: string;
  projectId: string;
  providerId: string;
  plan: {
    schemaVersion: "novel-video-production-v2";
    planId: string;
    totalShots: number;
    shot: {
      shotId: string;
      order: number;
    };
  };
  approvedDrama: {
    dramaProjectId: string;
    storyId: string;
    revision: number;
    status: "approved";
    sourceStoryRevision: number;
    sourceStoryBibleVersion: number;
    projectionOutputHash: string;
  };
  mediaPrompt: string;
  durationSeconds: number;
  resolution: VideoSubmissionResolution;
  ratio: VideoSubmissionRatio;
  externalConsent: true;
  costConfirmed: true;
  adultNamespace: "general";
};

export type PublicVideoJob = {
  jobId: string;
  projectId: string;
  providerId: string;
  status: NormalizedVideoProviderJob["status"];
  model: string;
  progressPercent: number | null;
  failureCode: string | null;
  retryable: boolean;
  artifactReady: boolean;
  attempt: number;
  createdAt: string;
  updatedAt: string;
};

export type ValidatedVideoRetryRequest = {
  schemaVersion: typeof VIDEO_RETRY_SCHEMA_VERSION;
  idempotencyKey: string;
  externalConsent: true;
  costConfirmed: true;
};

export type DurableVideoJobStore = {
  readonly configured: true;
  // A production implementation must verify owner isolation and the persisted approved
  // Drama revision/hash before it invokes createProviderTask. Client approval fields are not proof.
  submit(
    input: ValidatedVideoSubmission,
    createProviderTask: () => ReturnType<VideoProviderAdapter<VideoSubmissionResolution, VideoSubmissionRatio>["createTask"]>,
  ): Promise<PublicVideoJob>;
  poll(
    jobId: string,
    pollProviderTask: (providerTaskId: string) => ReturnType<VideoProviderAdapter["pollTask"]>,
  ): Promise<PublicVideoJob>;
  // Implementations must resolve the authenticated owner and persisted provider task ID.
  // The route parameter alone must never authorize cancellation.
  cancel?: (
    jobId: string,
    cancelProviderTask: (providerTaskId: string) => Promise<VideoProviderCancelReceipt>,
  ) => Promise<PublicVideoJob>;
  // A retry is a new billable provider task. Implementations must load the original,
  // owner-scoped, approved submission and atomically bind the new idempotency key.
  retry?: (
    jobId: string,
    request: ValidatedVideoRetryRequest,
    createProviderTask: (persistedInput: ValidatedVideoSubmission) => ReturnType<VideoProviderAdapter<VideoSubmissionResolution, VideoSubmissionRatio>["createTask"]>,
  ) => Promise<PublicVideoJob>;
};

export type VideoJobDependencies = {
  providerConfigured: boolean;
  executionProviderId: string | null;
  durableStore: DurableVideoJobStore | null;
  artifactStoreConfigured: boolean;
  createAdapter: () => VideoProviderAdapter<VideoSubmissionResolution, VideoSubmissionRatio>;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredId(value: unknown, field: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 180 || !/^[\p{L}\p{N}._:-]+$/u.test(text)) {
    throw new VideoRuntimeError("VIDEO_REQUEST_INVALID", `${field} 無效。`, 400);
  }
  return text;
}

function positiveRevision(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new VideoRuntimeError("VIDEO_REQUEST_INVALID", `${field} 必須是有效版本。`, 400);
  }
  return Number(value);
}

export function validateVideoSubmission(value: unknown): ValidatedVideoSubmission {
  const input = object(value);
  if (!input || input.schemaVersion !== VIDEO_SUBMISSION_SCHEMA_VERSION) {
    throw new VideoRuntimeError("VIDEO_REQUEST_INVALID", "影片要求版本無效。", 400);
  }
  const approvedDrama = object(input.approvedDrama);
  const plan = object(input.plan);
  const shot = object(plan?.shot);
  if (!plan || plan.schemaVersion !== "novel-video-production-v2" || !shot) {
    throw new VideoRuntimeError("VIDEO_REQUEST_INVALID", "影片製作計畫版本無效。", 400);
  }
  if (!approvedDrama || approvedDrama.status !== "approved") {
    throw new VideoRuntimeError("VIDEO_APPROVED_DRAMA_REQUIRED", "必須先核准短劇改編，才能建立影片工作。", 412);
  }
  if (input.externalConsent !== true) {
    throw new VideoRuntimeError("VIDEO_EXTERNAL_CONSENT_REQUIRED", "必須明確同意資料送往所選的外部影片供應商。", 412);
  }
  if (input.costConfirmed !== true) {
    throw new VideoRuntimeError("VIDEO_COST_CONFIRMATION_REQUIRED", "必須先確認這次外部影片工作可能產生費用。", 412);
  }
  if (input.adultNamespace !== "general") {
    throw new VideoRuntimeError("VIDEO_ADULT_NAMESPACE_UNSUPPORTED", "目前不會把成人內容送往外部影片供應商。", 412);
  }
  const mediaPrompt = typeof input.mediaPrompt === "string" ? input.mediaPrompt.trim() : "";
  if (!mediaPrompt || new TextEncoder().encode(mediaPrompt).byteLength > 20_000) {
    throw new VideoRuntimeError("VIDEO_REQUEST_INVALID", "影片提示詞必須存在，且不能超過 20 KB。", 400);
  }
  const durationSeconds = Number(input.durationSeconds);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 4 || durationSeconds > 30) {
    throw new VideoRuntimeError("VIDEO_REQUEST_INVALID", "影片長度必須是 4 至 30 秒。", 400);
  }
  if (input.resolution !== "480p" && input.resolution !== "720p") {
    throw new VideoRuntimeError("VIDEO_REQUEST_INVALID", "影片解析度只允許 480p 或 720p。", 400);
  }
  if (input.ratio !== "adaptive" && input.ratio !== "16:9" && input.ratio !== "9:16" && input.ratio !== "1:1") {
    throw new VideoRuntimeError("VIDEO_REQUEST_INVALID", "影片比例不在允許清單中。", 400);
  }
  const projectionOutputHash = typeof approvedDrama.projectionOutputHash === "string"
    ? approvedDrama.projectionOutputHash.trim()
    : "";
  if (!projectionOutputHash || projectionOutputHash.length > 256) {
    throw new VideoRuntimeError("VIDEO_APPROVED_DRAMA_REQUIRED", "核准改編缺少可核對的輸出指紋。", 412);
  }
  const projectId = requiredId(input.projectId, "作品識別碼");
  const approvedStoryId = requiredId(approvedDrama.storyId, "改編作品識別碼");
  if (approvedStoryId !== projectId) {
    throw new VideoRuntimeError("VIDEO_APPROVED_DRAMA_REQUIRED", "核准改編不屬於目前作品。", 412);
  }
  return {
    schemaVersion: VIDEO_SUBMISSION_SCHEMA_VERSION,
    idempotencyKey: requiredId(input.idempotencyKey, "重送識別碼"),
    projectId,
    providerId: requiredId(input.providerId, "影片供應商識別碼"),
    plan: {
      schemaVersion: "novel-video-production-v2",
      planId: requiredId(plan.planId, "影片製作計畫識別碼"),
      totalShots: positiveRevision(plan.totalShots, "逐鏡總數"),
      shot: {
        shotId: requiredId(shot.shotId, "鏡頭識別碼"),
        order: positiveRevision(shot.order, "鏡頭順序"),
      },
    },
    approvedDrama: {
      dramaProjectId: requiredId(approvedDrama.dramaProjectId, "改編識別碼"),
      storyId: approvedStoryId,
      revision: positiveRevision(approvedDrama.revision, "改編版本"),
      status: "approved",
      sourceStoryRevision: positiveRevision(approvedDrama.sourceStoryRevision, "原作版本"),
      sourceStoryBibleVersion: positiveRevision(approvedDrama.sourceStoryBibleVersion, "Story Bible 版本"),
      projectionOutputHash,
    },
    mediaPrompt,
    durationSeconds,
    resolution: input.resolution,
    ratio: input.ratio,
    externalConsent: true,
    costConfirmed: true,
    adultNamespace: "general",
  };
}

export function validateVideoRetryRequest(value: unknown): ValidatedVideoRetryRequest {
  const input = object(value);
  if (!input || input.schemaVersion !== VIDEO_RETRY_SCHEMA_VERSION) {
    throw new VideoRuntimeError("VIDEO_REQUEST_INVALID", "影片重送要求版本無效。", 400);
  }
  if (input.externalConsent !== true) {
    throw new VideoRuntimeError("VIDEO_EXTERNAL_CONSENT_REQUIRED", "重送前必須再次同意資料送往外部影片供應商。", 412);
  }
  if (input.costConfirmed !== true) {
    throw new VideoRuntimeError("VIDEO_COST_CONFIRMATION_REQUIRED", "重送可能再次產生費用，必須重新確認。", 412);
  }
  return {
    schemaVersion: VIDEO_RETRY_SCHEMA_VERSION,
    idempotencyKey: requiredId(input.idempotencyKey, "重送識別碼"),
    externalConsent: true,
    costConfirmed: true,
  };
}

function assertRuntimeDependencies(
  dependencies: VideoJobDependencies,
  providerId?: string,
  options: { requireArtifactStore?: boolean } = {},
) {
  if (!dependencies.providerConfigured) {
    throw new VideoRuntimeError(
      "VIDEO_PROVIDER_NOT_CONFIGURED",
      "尚未連接可驗證的官方影片供應商 API。",
      503,
    );
  }
  if (!dependencies.executionProviderId || (providerId && dependencies.executionProviderId !== providerId)) {
    throw new VideoRuntimeError(
      "VIDEO_PROVIDER_NOT_CONFIGURED",
      "所選供應商沒有對應的官方影片轉接器。",
      503,
    );
  }
  if (!dependencies.durableStore?.configured) {
    throw new VideoRuntimeError(
      "VIDEO_DURABLE_STORE_NOT_CONFIGURED",
      "永久工作儲存尚未完成；為避免重複付費，這次沒有送往外部供應商。",
      503,
    );
  }
  if ((options.requireArtifactStore ?? true) && !dependencies.artifactStoreConfigured) {
    throw new VideoRuntimeError(
      "VIDEO_ARTIFACT_STORE_NOT_CONFIGURED",
      "私有影片成品驗證儲存尚未完成；這次沒有送往外部供應商。",
      503,
    );
  }
}

const FORBIDDEN_PUBLIC_JOB_KEYS = new Set([
  "videoUrl",
  "outputUrl",
  "downloadUrl",
  "artifactUrl",
  "providerTaskId",
]);

function containsForbiddenPublicJobData(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenPublicJobData);
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => (
    FORBIDDEN_PUBLIC_JOB_KEYS.has(key) || containsForbiddenPublicJobData(nested)
  ));
}

function safePublicJob(job: PublicVideoJob) {
  if (containsForbiddenPublicJobData(job)) {
    throw new VideoRuntimeError(
      "VIDEO_JOB_RESPONSE_UNSAFE",
      "影片工作回應含有不可公開的供應商位置或內部識別碼。",
      502,
    );
  }
  if (job.status === "succeeded" && job.artifactReady !== true) {
    throw new VideoRuntimeError(
      "VIDEO_JOB_ARTIFACT_NOT_VERIFIED",
      "供應商已完成，但成品尚未匯入私有儲存並通過 MP4 驗證。",
      503,
      true,
    );
  }
  return job;
}

export async function submitVideoGenerationJob(value: unknown, dependencies: VideoJobDependencies) {
  const input = validateVideoSubmission(value);
  assertRuntimeDependencies(dependencies, input.providerId);
  const adapter = dependencies.createAdapter();
  const job = await dependencies.durableStore!.submit(input, () => adapter.createTask({
    idempotencyKey: input.idempotencyKey,
    prompt: input.mediaPrompt,
    durationSeconds: input.durationSeconds,
    resolution: input.resolution,
    ratio: input.ratio,
    generateAudio: true,
    watermark: true,
  }));
  return safePublicJob(job);
}

export async function pollVideoGenerationJob(jobIdValue: unknown, dependencies: VideoJobDependencies) {
  const jobId = requiredId(jobIdValue, "影片工作識別碼");
  assertRuntimeDependencies(dependencies);
  const adapter = dependencies.createAdapter();
  const job = await dependencies.durableStore!.poll(jobId, (providerTaskId) => adapter.pollTask(providerTaskId));
  return safePublicJob(job);
}

export async function cancelVideoGenerationJob(jobIdValue: unknown, dependencies: VideoJobDependencies) {
  const jobId = requiredId(jobIdValue, "影片工作識別碼");
  assertRuntimeDependencies(dependencies, undefined, { requireArtifactStore: false });
  if (!dependencies.durableStore?.cancel) {
    throw new VideoRuntimeError(
      "VIDEO_JOB_CANCEL_NOT_SUPPORTED",
      "持久化影片工作層尚未實作安全取消。",
      503,
    );
  }
  const adapter = dependencies.createAdapter();
  if (!adapter.cancelTask) {
    throw new VideoRuntimeError(
      "VIDEO_JOB_CANCEL_NOT_SUPPORTED",
      "目前影片供應商轉接器不支援取消工作。",
      409,
    );
  }
  const job = await dependencies.durableStore.cancel(
    jobId,
    (providerTaskId) => adapter.cancelTask!(providerTaskId),
  );
  return safePublicJob(job);
}

export async function retryVideoGenerationJob(
  jobIdValue: unknown,
  value: unknown,
  dependencies: VideoJobDependencies,
) {
  const jobId = requiredId(jobIdValue, "影片工作識別碼");
  const request = validateVideoRetryRequest(value);
  assertRuntimeDependencies(dependencies);
  if (!dependencies.durableStore?.retry) {
    throw new VideoRuntimeError(
      "VIDEO_JOB_RETRY_NOT_SUPPORTED",
      "持久化影片工作層尚未實作可防止重複扣款的安全重送。",
      503,
    );
  }
  const adapter = dependencies.createAdapter();
  const job = await dependencies.durableStore.retry(jobId, request, (persistedInput) => adapter.createTask({
    idempotencyKey: request.idempotencyKey,
    prompt: persistedInput.mediaPrompt,
    durationSeconds: persistedInput.durationSeconds,
    resolution: persistedInput.resolution,
    ratio: persistedInput.ratio,
    generateAudio: true,
    watermark: true,
  }));
  return safePublicJob(job);
}
