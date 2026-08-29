import "server-only";

export const VIDEO_WORKER_PROVIDER_ID = "local-video-worker" as const;
export const VIDEO_WORKER_HEALTH_SCHEMA_VERSION = "novel-video-worker-health-v1" as const;
export const VIDEO_WORKER_SUBMIT_SCHEMA_VERSION = "novel-video-worker-submit-v1" as const;
export const VIDEO_WORKER_JOB_SCHEMA_VERSION = "novel-video-worker-job-v1" as const;
export const VIDEO_WORKER_CANCEL_SCHEMA_VERSION = "novel-video-worker-cancel-v1" as const;

export const VIDEO_WORKER_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
] as const;
export const VIDEO_WORKER_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const VIDEO_WORKER_RATIOS = ["adaptive", "16:9", "9:16", "1:1"] as const;

export type VideoWorkerStatus = typeof VIDEO_WORKER_STATUSES[number];
export type VideoWorkerResolution = typeof VIDEO_WORKER_RESOLUTIONS[number];
export type VideoWorkerRatio = typeof VIDEO_WORKER_RATIOS[number];

export type VideoWorkerCapabilities = {
  maxDurationSeconds: number;
  resolutions: VideoWorkerResolution[];
  ratios: VideoWorkerRatio[];
  generatesAudio: boolean;
  supportsCancellation: true;
};

export type VideoWorkerHealth = {
  schemaVersion: typeof VIDEO_WORKER_HEALTH_SCHEMA_VERSION;
  status: "ready" | "degraded";
  workerId: string;
  model: string;
  capabilities: VideoWorkerCapabilities;
};

export type VideoWorkerArtifact = {
  downloadUrl: string;
  mimeType: "video/mp4";
  byteLength: number;
  sha256: string;
};

export type VideoWorkerJob = {
  schemaVersion: typeof VIDEO_WORKER_JOB_SCHEMA_VERSION;
  jobId: string;
  model: string;
  status: VideoWorkerStatus;
  progressPercent: number | null;
  artifact: VideoWorkerArtifact | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VideoWorkerCreateInput = {
  idempotencyKey: string;
  prompt: string;
  durationSeconds: number;
  resolution: VideoWorkerResolution;
  ratio: VideoWorkerRatio;
  generateAudio?: boolean;
  watermark?: boolean;
  signal?: AbortSignal;
};

export type VideoWorkerErrorCode =
  | "VIDEO_WORKER_CONFIGURATION_INVALID"
  | "VIDEO_WORKER_REQUEST_INVALID"
  | "VIDEO_WORKER_AUTH_REJECTED"
  | "VIDEO_WORKER_RATE_LIMITED"
  | "VIDEO_WORKER_JOB_NOT_FOUND"
  | "VIDEO_WORKER_UNAVAILABLE"
  | "VIDEO_WORKER_TIMEOUT"
  | "VIDEO_WORKER_ABORTED"
  | "VIDEO_WORKER_RESPONSE_INVALID";

export class VideoWorkerError extends Error {
  readonly code: VideoWorkerErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(input: {
    code: VideoWorkerErrorCode;
    message: string;
    status: number;
    retryable?: boolean;
    retryAfterSeconds?: number | null;
  }) {
    super(input.message);
    this.name = "VideoWorkerError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}
export type ValidatedVideoWorkerConnection = {
  baseUrl: string;
  token: string;
  model: string;
  production: boolean;
  allowInsecureLocal: boolean;
};

export type VideoWorkerAdapter = {
  readonly providerId: typeof VIDEO_WORKER_PROVIDER_ID;
  readonly model: string;
  status(): {
    configured: true;
    providerId: typeof VIDEO_WORKER_PROVIDER_ID;
    model: string;
  };
  health(signal?: AbortSignal): Promise<VideoWorkerHealth>;
  createTask(input: VideoWorkerCreateInput): Promise<VideoWorkerJob>;
  pollTask(jobId: string, signal?: AbortSignal): Promise<VideoWorkerJob>;
  cancelTask(jobId: string, signal?: AbortSignal): Promise<VideoWorkerJob>;
};

type JsonObject = Record<string, unknown>;

const MAX_RESPONSE_BYTES = 512 * 1_024;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const ID_PATTERN = /^[\p{L}\p{N}._:-]{1,180}$/u;
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function configurationError() {
  return new VideoWorkerError({
    code: "VIDEO_WORKER_CONFIGURATION_INVALID",
    message: "自架影片工作站的伺服器端設定不完整或不安全。",
    status: 503,
  });
}

function requestError(message: string) {
  return new VideoWorkerError({
    code: "VIDEO_WORKER_REQUEST_INVALID",
    message,
    status: 400,
  });
}

function responseError() {
  return new VideoWorkerError({
    code: "VIDEO_WORKER_RESPONSE_INVALID",
    message: "自架影片工作站回傳了無法驗證的資料。",
    status: 502,
    retryable: true,
  });
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]"
    || hostname === "::1";
}

function parseSafeUrl(value: string, policy: { production: boolean; allowInsecureLocal: boolean }) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError();
  }
  if (
    parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.protocol !== "https:"
      && !(parsed.protocol === "http:"
        && !policy.production
        && policy.allowInsecureLocal
        && isLoopbackHostname(parsed.hostname)))
  ) {
    throw configurationError();
  }
  const pathname = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.origin}${pathname}`;
}

export function validateVideoWorkerConnection(input: {
  baseUrl: string;
  token: string;
  model: string;
  production?: boolean;
  allowInsecureLocal?: boolean;
}): ValidatedVideoWorkerConnection {
  const token = input.token.trim();
  const model = input.model.trim();
  const production = input.production ?? process.env.NODE_ENV === "production";
  const allowInsecureLocal = input.allowInsecureLocal === true;
  if (
    !token
    || token.length > 4_096
    || /[\r\n]/u.test(token)
    || !MODEL_PATTERN.test(model)
  ) {
    throw configurationError();
  }
  return {
    baseUrl: parseSafeUrl(input.baseUrl.trim(), { production, allowInsecureLocal }),
    token,
    model,
    production,
    allowInsecureLocal,
  };
}

function exactKeys(value: JsonObject, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) throw responseError();
}

function requiredText(value: unknown, pattern: RegExp) {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function parseTimestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw responseError();
  }
  return value;
}

function parseEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > allowed.length) throw responseError();
  const normalized = value.filter((item): item is T => (
    typeof item === "string" && allowed.includes(item as T)
  ));
  if (normalized.length !== value.length || new Set(normalized).size !== normalized.length) {
    throw responseError();
  }
  return normalized;
}

function parseHealth(value: unknown, expectedModel: string): VideoWorkerHealth {
  if (!isObject(value)) throw responseError();
  exactKeys(value, ["schemaVersion", "status", "workerId", "model", "capabilities"]);
  if (
    value.schemaVersion !== VIDEO_WORKER_HEALTH_SCHEMA_VERSION
    || (value.status !== "ready" && value.status !== "degraded")
    || value.model !== expectedModel
  ) {
    throw responseError();
  }
  const workerId = requiredText(value.workerId, ID_PATTERN);
  const capabilities = isObject(value.capabilities) ? value.capabilities : null;
  if (!workerId || !capabilities) throw responseError();
  exactKeys(capabilities, [
    "maxDurationSeconds",
    "resolutions",
    "ratios",
    "generatesAudio",
    "supportsCancellation",
  ]);
  if (
    !Number.isInteger(capabilities.maxDurationSeconds)
    || Number(capabilities.maxDurationSeconds) < 4
    || Number(capabilities.maxDurationSeconds) > 300
    || typeof capabilities.generatesAudio !== "boolean"
    || capabilities.supportsCancellation !== true
  ) {
    throw responseError();
  }
  return {
    schemaVersion: VIDEO_WORKER_HEALTH_SCHEMA_VERSION,
    status: value.status,
    workerId,
    model: expectedModel,
    capabilities: {
      maxDurationSeconds: Number(capabilities.maxDurationSeconds),
      resolutions: parseEnumArray(capabilities.resolutions, VIDEO_WORKER_RESOLUTIONS),
      ratios: parseEnumArray(capabilities.ratios, VIDEO_WORKER_RATIOS),
      generatesAudio: capabilities.generatesAudio,
      supportsCancellation: true,
    },
  };
}

function isSafeArtifactUrl(
  value: string,
  policy: { production: boolean; allowInsecureLocal: boolean },
) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.hash) return false;
    return parsed.protocol === "https:"
      || (parsed.protocol === "http:"
        && !policy.production
        && policy.allowInsecureLocal
        && isLoopbackHostname(parsed.hostname));
  } catch {
    return false;
  }
}

function parseArtifact(
  value: unknown,
  policy: { production: boolean; allowInsecureLocal: boolean },
): VideoWorkerArtifact | null {
  if (value === null) return null;
  if (!isObject(value)) throw responseError();
  exactKeys(value, ["downloadUrl", "mimeType", "byteLength", "sha256"]);
  if (
    typeof value.downloadUrl !== "string"
    || !isSafeArtifactUrl(value.downloadUrl, policy)
    || value.mimeType !== "video/mp4"
    || !Number.isSafeInteger(value.byteLength)
    || Number(value.byteLength) < 1
    || typeof value.sha256 !== "string"
    || !SHA256_PATTERN.test(value.sha256)
  ) {
    throw responseError();
  }
  return {
    downloadUrl: value.downloadUrl,
    mimeType: "video/mp4",
    byteLength: Number(value.byteLength),
    sha256: value.sha256,
  };
}

function parseJob(
  value: unknown,
  expectedModel: string,
  policy: { production: boolean; allowInsecureLocal: boolean },
): VideoWorkerJob {
  if (!isObject(value)) throw responseError();
  exactKeys(value, [
    "schemaVersion",
    "jobId",
    "model",
    "status",
    "progressPercent",
    "artifact",
    "failureCode",
    "createdAt",
    "updatedAt",
  ]);
  const jobId = requiredText(value.jobId, ID_PATTERN);
  if (
    value.schemaVersion !== VIDEO_WORKER_JOB_SCHEMA_VERSION
    || !jobId
    || value.model !== expectedModel
    || typeof value.status !== "string"
    || !VIDEO_WORKER_STATUSES.includes(value.status as VideoWorkerStatus)
  ) {
    throw responseError();
  }
  const status = value.status as VideoWorkerStatus;
  const progressPercent = value.progressPercent === null
    ? null
    : Number.isInteger(value.progressPercent)
      && Number(value.progressPercent) >= 0
      && Number(value.progressPercent) <= 100
      ? Number(value.progressPercent)
      : null;
  if (value.progressPercent !== null && progressPercent === null) throw responseError();
  const artifact = parseArtifact(value.artifact, policy);
  const failureCode = value.failureCode === null
    ? null
    : requiredText(value.failureCode, FAILURE_CODE_PATTERN);
  if (value.failureCode !== null && !failureCode) throw responseError();
  const succeeded = status === "succeeded";
  const failed = status === "failed" || status === "cancelled" || status === "expired";
  if (
    (succeeded && (!artifact || progressPercent !== 100 || failureCode !== null))
    || (!succeeded && artifact !== null)
    || (failed && failureCode === null)
    || (!failed && !succeeded && failureCode !== null)
  ) {
    throw responseError();
  }
  return {
    schemaVersion: VIDEO_WORKER_JOB_SCHEMA_VERSION,
    jobId,
    model: expectedModel,
    status,
    progressPercent,
    artifact,
    failureCode,
    createdAt: parseTimestamp(value.createdAt),
    updatedAt: parseTimestamp(value.updatedAt),
  };
}

function requiredId(value: string, field: string) {
  const normalized = value.trim();
  if (!ID_PATTERN.test(normalized)) throw requestError(`${field} 無效。`);
  return normalized;
}

function validateCreateInput(input: VideoWorkerCreateInput) {
  const prompt = input.prompt.trim();
  if (!prompt || new TextEncoder().encode(prompt).byteLength > 20_000) {
    throw requestError("影片提示詞必須存在，且不能超過 20 KB。");
  }
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 4 || input.durationSeconds > 300) {
    throw requestError("單次影片長度必須是 4 至 300 秒的整數。");
  }
  if (!VIDEO_WORKER_RESOLUTIONS.includes(input.resolution)) {
    throw requestError("影片解析度不在工作站協定允許清單中。");
  }
  if (!VIDEO_WORKER_RATIOS.includes(input.ratio)) {
    throw requestError("影片比例不在工作站協定允許清單中。");
  }
  return {
    idempotencyKey: requiredId(input.idempotencyKey, "重送識別碼"),
    prompt,
  };
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1_000));
}

function safeHttpError(response: Response, jobOperation: boolean) {
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  if (response.status === 401 || response.status === 403) {
    return new VideoWorkerError({
      code: "VIDEO_WORKER_AUTH_REJECTED",
      message: "自架影片工作站拒絕了伺服器端憑證。",
      status: 503,
    });
  }
  if (response.status === 404 && jobOperation) {
    return new VideoWorkerError({
      code: "VIDEO_WORKER_JOB_NOT_FOUND",
      message: "找不到指定的自架影片工作。",
      status: 404,
    });
  }
  if (response.status === 429) {
    return new VideoWorkerError({
      code: "VIDEO_WORKER_RATE_LIMITED",
      message: "自架影片工作站目前要求降低送件頻率。",
      status: 429,
      retryable: true,
      retryAfterSeconds,
    });
  }
  return new VideoWorkerError({
    code: "VIDEO_WORKER_UNAVAILABLE",
    message: "自架影片工作站目前沒有完成要求。",
    status: response.status >= 500 ? 503 : 502,
    retryable: response.status >= 500,
    retryAfterSeconds,
  });
}

async function readJson(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    !contentType.includes("application/json")
    || (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES)
  ) {
    throw responseError();
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw responseError();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw responseError();
  }
}

export function createVideoWorkerAdapter(input: {
  baseUrl: string;
  token: string;
  model: string;
  production?: boolean;
  allowInsecureLocal?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): VideoWorkerAdapter {
  const configuration = validateVideoWorkerConnection(input);
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = Math.min(60_000, Math.max(25, input.timeoutMs ?? 20_000));

  async function request(
    path: string,
    init: { method: "GET" | "POST"; body?: string },
    callerSignal?: AbortSignal,
    jobOperation = false,
  ) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort("VIDEO_WORKER_TIMEOUT");
    }, timeoutMs);
    const abort = () => controller.abort(callerSignal?.reason ?? "VIDEO_WORKER_ABORTED");
    if (callerSignal?.aborted) abort();
    else callerSignal?.addEventListener("abort", abort, { once: true });
    try {
      const headers = new Headers({
        Accept: "application/json",
        Authorization: `Bearer ${configuration.token}`,
        "Cache-Control": "no-store",
      });
      if (init.body) headers.set("Content-Type", "application/json");
      const response = await fetchImpl(`${configuration.baseUrl}${path}`, {
        method: init.method,
        body: init.body,
        headers,
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw safeHttpError(response, jobOperation);
      return await readJson(response);
    } catch (error) {
      if (error instanceof VideoWorkerError) throw error;
      if (callerSignal?.aborted && !timedOut) {
        throw new VideoWorkerError({
          code: "VIDEO_WORKER_ABORTED",
          message: "自架影片工作站要求已取消。",
          status: 499,
        });
      }
      throw new VideoWorkerError({
        code: timedOut ? "VIDEO_WORKER_TIMEOUT" : "VIDEO_WORKER_UNAVAILABLE",
        message: timedOut ? "自架影片工作站回應逾時。" : "無法連線至自架影片工作站。",
        status: timedOut ? 504 : 503,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abort);
    }
  }

  const responsePolicy = {
    production: configuration.production,
    allowInsecureLocal: configuration.allowInsecureLocal,
  };

  return {
    providerId: VIDEO_WORKER_PROVIDER_ID,
    model: configuration.model,
    status() {
      return {
        configured: true,
        providerId: VIDEO_WORKER_PROVIDER_ID,
        model: configuration.model,
      };
    },
    async health(signal) {
      const payload = await request("/v1/health", { method: "GET" }, signal);
      return parseHealth(payload, configuration.model);
    },
    async createTask(createInput) {
      const normalized = validateCreateInput(createInput);
      const payload = await request("/v1/jobs", {
        method: "POST",
        body: JSON.stringify({
          schemaVersion: VIDEO_WORKER_SUBMIT_SCHEMA_VERSION,
          idempotencyKey: normalized.idempotencyKey,
          model: configuration.model,
          prompt: normalized.prompt,
          durationSeconds: createInput.durationSeconds,
          resolution: createInput.resolution,
          ratio: createInput.ratio,
          generateAudio: createInput.generateAudio ?? true,
          watermark: createInput.watermark ?? true,
        }),
      }, createInput.signal, true);
      return parseJob(payload, configuration.model, responsePolicy);
    },
    async pollTask(jobIdValue, signal) {
      const jobId = requiredId(jobIdValue, "影片工作識別碼");
      const payload = await request(`/v1/jobs/${encodeURIComponent(jobId)}`, {
        method: "GET",
      }, signal, true);
      const job = parseJob(payload, configuration.model, responsePolicy);
      if (job.jobId !== jobId) throw responseError();
      return job;
    },
    async cancelTask(jobIdValue, signal) {
      const jobId = requiredId(jobIdValue, "影片工作識別碼");
      const payload = await request(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        body: JSON.stringify({ schemaVersion: VIDEO_WORKER_CANCEL_SCHEMA_VERSION }),
      }, signal, true);
      const job = parseJob(payload, configuration.model, responsePolicy);
      if (job.jobId !== jobId) throw responseError();
      return job;
    },
  };
}
