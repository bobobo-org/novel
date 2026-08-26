import type {
  BytePlusSeedanceAdapter,
  BytePlusSeedanceJob,
  BytePlusSeedanceRatio,
  BytePlusSeedanceResolution,
} from "./byteplus-seedance-protocol";

export const VIDEO_SUBMISSION_SCHEMA_VERSION = "seedance-video-submit-v1" as const;

export type VideoRuntimeErrorCode =
  | "VIDEO_REQUEST_INVALID"
  | "VIDEO_APPROVED_DRAMA_REQUIRED"
  | "VIDEO_EXTERNAL_CONSENT_REQUIRED"
  | "VIDEO_COST_CONFIRMATION_REQUIRED"
  | "VIDEO_ADULT_NAMESPACE_UNSUPPORTED"
  | "VIDEO_PROVIDER_NOT_CONFIGURED"
  | "VIDEO_DURABLE_STORE_NOT_CONFIGURED"
  | "VIDEO_ARTIFACT_STORE_NOT_CONFIGURED"
  | "VIDEO_JOB_NOT_FOUND";

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
  resolution: BytePlusSeedanceResolution;
  ratio: BytePlusSeedanceRatio;
  externalConsent: true;
  costConfirmed: true;
  adultNamespace: "general";
};

export type PublicVideoJob = {
  jobId: string;
  projectId: string;
  status: BytePlusSeedanceJob["status"];
  model: string;
  createdAt: string;
  updatedAt: string;
};

export type DurableVideoJobStore = {
  readonly configured: true;
  // A production implementation must verify owner isolation and the persisted approved
  // Drama revision/hash before it invokes createProviderTask. Client approval fields are not proof.
  submit(
    input: ValidatedVideoSubmission,
    createProviderTask: () => ReturnType<BytePlusSeedanceAdapter["createTask"]>,
  ): Promise<PublicVideoJob>;
  poll(
    jobId: string,
    pollProviderTask: (providerTaskId: string) => ReturnType<BytePlusSeedanceAdapter["pollTask"]>,
  ): Promise<PublicVideoJob>;
};

export type VideoJobDependencies = {
  providerConfigured: boolean;
  durableStore: DurableVideoJobStore | null;
  artifactStoreConfigured: boolean;
  createAdapter: () => BytePlusSeedanceAdapter;
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
  if (!approvedDrama || approvedDrama.status !== "approved") {
    throw new VideoRuntimeError("VIDEO_APPROVED_DRAMA_REQUIRED", "必須先核准短劇改編，才能建立影片工作。", 412);
  }
  if (input.externalConsent !== true) {
    throw new VideoRuntimeError("VIDEO_EXTERNAL_CONSENT_REQUIRED", "必須明確同意資料送往 BytePlus。", 412);
  }
  if (input.costConfirmed !== true) {
    throw new VideoRuntimeError("VIDEO_COST_CONFIRMATION_REQUIRED", "必須先確認這次外部影片工作可能產生費用。", 412);
  }
  if (input.adultNamespace !== "general") {
    throw new VideoRuntimeError("VIDEO_ADULT_NAMESPACE_UNSUPPORTED", "第一階段不會把成人內容送往 Seedance。", 412);
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

function assertRuntimeDependencies(dependencies: VideoJobDependencies) {
  if (!dependencies.providerConfigured) {
    throw new VideoRuntimeError(
      "VIDEO_PROVIDER_NOT_CONFIGURED",
      "Seedance 2.5 尚未完成伺服器端設定。",
      503,
    );
  }
  if (!dependencies.durableStore?.configured) {
    throw new VideoRuntimeError(
      "VIDEO_DURABLE_STORE_NOT_CONFIGURED",
      "永久工作儲存尚未完成；為避免重複付費，這次沒有送往 BytePlus。",
      503,
    );
  }
  if (!dependencies.artifactStoreConfigured) {
    throw new VideoRuntimeError(
      "VIDEO_ARTIFACT_STORE_NOT_CONFIGURED",
      "私有影片成品驗證儲存尚未完成；這次沒有送往 BytePlus。",
      503,
    );
  }
}

export async function submitVideoGenerationJob(value: unknown, dependencies: VideoJobDependencies) {
  const input = validateVideoSubmission(value);
  assertRuntimeDependencies(dependencies);
  const adapter = dependencies.createAdapter();
  return dependencies.durableStore!.submit(input, () => adapter.createTask({
    prompt: input.mediaPrompt,
    durationSeconds: input.durationSeconds,
    resolution: input.resolution,
    ratio: input.ratio,
    generateAudio: true,
    watermark: true,
  }));
}

export async function pollVideoGenerationJob(jobIdValue: unknown, dependencies: VideoJobDependencies) {
  const jobId = requiredId(jobIdValue, "影片工作識別碼");
  assertRuntimeDependencies(dependencies);
  const adapter = dependencies.createAdapter();
  return dependencies.durableStore!.poll(jobId, (providerTaskId) => adapter.pollTask(providerTaskId));
}
