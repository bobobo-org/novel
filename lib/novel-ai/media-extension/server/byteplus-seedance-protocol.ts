import "server-only";

export const BYTEPLUS_LAS_SEEDANCE_ENDPOINT =
  "https://operator.las.ap-southeast-1.bytepluses.com" as const;
export const BYTEPLUS_SEEDANCE_MODEL = "dreamina-seedance-2-5-260628" as const;
export const BYTEPLUS_SEEDANCE_TASK_PATH = "/api/v1/contents/generations/tasks" as const;

export const BYTEPLUS_SEEDANCE_RESOLUTIONS = ["480p", "720p"] as const;
export const BYTEPLUS_SEEDANCE_RATIOS = ["adaptive", "16:9", "9:16", "1:1"] as const;
export const BYTEPLUS_SEEDANCE_STATUSES = [
  "queued",
  "running",
  "cancelled",
  "succeeded",
  "failed",
  "expired",
] as const;

export type BytePlusSeedanceResolution = typeof BYTEPLUS_SEEDANCE_RESOLUTIONS[number];
export type BytePlusSeedanceRatio = typeof BYTEPLUS_SEEDANCE_RATIOS[number];
export type BytePlusSeedanceStatus = typeof BYTEPLUS_SEEDANCE_STATUSES[number];

export type BytePlusSeedanceCreateInput = {
  prompt: string;
  durationSeconds: number;
  resolution: BytePlusSeedanceResolution;
  ratio: BytePlusSeedanceRatio;
  generateAudio?: boolean;
  watermark?: boolean;
  signal?: AbortSignal;
};

export type BytePlusSeedanceJob = {
  providerTaskId: string;
  status: BytePlusSeedanceStatus;
  videoUrl: string | null;
  failureCode: "PROVIDER_TASK_FAILED" | "PROVIDER_TASK_CANCELLED" | "PROVIDER_TASK_EXPIRED" | null;
};

export type BytePlusSeedanceErrorCode =
  | "BYTEPLUS_CONFIGURATION_INVALID"
  | "BYTEPLUS_REQUEST_INVALID"
  | "BYTEPLUS_AUTH_REJECTED"
  | "BYTEPLUS_RATE_LIMITED"
  | "BYTEPLUS_UNAVAILABLE"
  | "BYTEPLUS_TIMEOUT"
  | "BYTEPLUS_RESPONSE_INVALID";

export class BytePlusSeedanceError extends Error {
  readonly code: BytePlusSeedanceErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;

  constructor(input: {
    code: BytePlusSeedanceErrorCode;
    message: string;
    status: number;
    retryable?: boolean;
    retryAfterSeconds?: number | null;
  }) {
    super(input.message);
    this.name = "BytePlusSeedanceError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}

export type BytePlusSeedanceAdapter = {
  readonly providerId: "byteplus-las";
  readonly model: typeof BYTEPLUS_SEEDANCE_MODEL;
  status(): {
    configured: true;
    providerId: "byteplus-las";
    model: typeof BYTEPLUS_SEEDANCE_MODEL;
    endpoint: typeof BYTEPLUS_LAS_SEEDANCE_ENDPOINT;
  };
  createTask(input: BytePlusSeedanceCreateInput): Promise<{
    providerTaskId: string;
    status: "queued";
  }>;
  pollTask(providerTaskId: string, signal?: AbortSignal): Promise<BytePlusSeedanceJob>;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1_000));
}

function safeHttpError(response: Response): BytePlusSeedanceError {
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  if (response.status === 401 || response.status === 403) {
    return new BytePlusSeedanceError({
      code: "BYTEPLUS_AUTH_REJECTED",
      message: "BytePlus 伺服器端憑證未通過驗證。",
      status: 503,
    });
  }
  if (response.status === 429) {
    return new BytePlusSeedanceError({
      code: "BYTEPLUS_RATE_LIMITED",
      message: "BytePlus 目前要求降低送件頻率。",
      status: 429,
      retryable: true,
      retryAfterSeconds,
    });
  }
  return new BytePlusSeedanceError({
    code: "BYTEPLUS_UNAVAILABLE",
    message: "BytePlus 影片服務目前沒有完成要求。",
    status: response.status >= 500 ? 503 : 502,
    retryable: response.status >= 500,
    retryAfterSeconds,
  });
}

function assertCreateInput(input: BytePlusSeedanceCreateInput) {
  const prompt = input.prompt.trim();
  if (!prompt || new TextEncoder().encode(prompt).byteLength > 20_000) {
    throw new BytePlusSeedanceError({
      code: "BYTEPLUS_REQUEST_INVALID",
      message: "影片提示詞必須存在，且不能超過 20 KB。",
      status: 400,
    });
  }
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 4 || input.durationSeconds > 30) {
    throw new BytePlusSeedanceError({
      code: "BYTEPLUS_REQUEST_INVALID",
      message: "舊版 BytePlus 試驗契約的單次影片長度必須是 4 至 30 秒的整數。",
      status: 400,
    });
  }
  if (!BYTEPLUS_SEEDANCE_RESOLUTIONS.includes(input.resolution)) {
    throw new BytePlusSeedanceError({
      code: "BYTEPLUS_REQUEST_INVALID",
      message: "舊版 BytePlus 試驗契約的解析度只允許 480p 或 720p。",
      status: 400,
    });
  }
  if (!BYTEPLUS_SEEDANCE_RATIOS.includes(input.ratio)) {
    throw new BytePlusSeedanceError({
      code: "BYTEPLUS_REQUEST_INVALID",
      message: "影片比例不在目前允許清單中。",
      status: 400,
    });
  }
  return prompt;
}

function assertProviderTaskId(value: string) {
  if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(value)) {
    throw new BytePlusSeedanceError({
      code: "BYTEPLUS_REQUEST_INVALID",
      message: "影片工作識別碼無效。",
      status: 400,
    });
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isObject(parsed)) throw new Error("OBJECT_REQUIRED");
    return parsed;
  } catch {
    throw new BytePlusSeedanceError({
      code: "BYTEPLUS_RESPONSE_INVALID",
      message: "BytePlus 回傳了無法驗證的資料。",
      status: 502,
      retryable: true,
    });
  }
}

function normalizedStatus(value: unknown): BytePlusSeedanceStatus {
  if (typeof value === "string" && BYTEPLUS_SEEDANCE_STATUSES.includes(value as BytePlusSeedanceStatus)) {
    return value as BytePlusSeedanceStatus;
  }
  throw new BytePlusSeedanceError({
    code: "BYTEPLUS_RESPONSE_INVALID",
    message: "BytePlus 工作狀態無法辨識。",
    status: 502,
    retryable: true,
  });
}

export function createBytePlusSeedanceAdapter(input: {
  apiKey: string;
  endpoint?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): BytePlusSeedanceAdapter {
  const apiKey = input.apiKey.trim();
  const endpoint = (input.endpoint ?? BYTEPLUS_LAS_SEEDANCE_ENDPOINT).replace(/\/$/u, "");
  const model = input.model ?? BYTEPLUS_SEEDANCE_MODEL;
  if (!apiKey || endpoint !== BYTEPLUS_LAS_SEEDANCE_ENDPOINT || model !== BYTEPLUS_SEEDANCE_MODEL) {
    throw new BytePlusSeedanceError({
      code: "BYTEPLUS_CONFIGURATION_INVALID",
      message: "BytePlus 伺服器端設定不完整或不在允許清單中。",
      status: 503,
    });
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = Math.min(60_000, Math.max(1_000, input.timeoutMs ?? 20_000));

  async function request(path: string, init: RequestInit, callerSignal?: AbortSignal) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort("BYTEPLUS_TIMEOUT");
    }, timeoutMs);
    const abort = () => controller.abort(callerSignal?.reason ?? "CALLER_ABORTED");
    if (callerSignal?.aborted) abort();
    else callerSignal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetchImpl(`${endpoint}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });
      if (!response.ok) throw safeHttpError(response);
      return await readJson(response);
    } catch (error) {
      if (error instanceof BytePlusSeedanceError) throw error;
      throw new BytePlusSeedanceError({
        code: timedOut ? "BYTEPLUS_TIMEOUT" : "BYTEPLUS_UNAVAILABLE",
        message: timedOut ? "BytePlus 影片服務回應逾時。" : "無法連線至 BytePlus 影片服務。",
        status: timedOut ? 504 : 503,
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abort);
    }
  }

  return {
    providerId: "byteplus-las",
    model: BYTEPLUS_SEEDANCE_MODEL,
    status() {
      return {
        configured: true,
        providerId: "byteplus-las",
        model: BYTEPLUS_SEEDANCE_MODEL,
        endpoint: BYTEPLUS_LAS_SEEDANCE_ENDPOINT,
      };
    },
    async createTask(createInput) {
      const prompt = assertCreateInput(createInput);
      const payload = await request(BYTEPLUS_SEEDANCE_TASK_PATH, {
        method: "POST",
        body: JSON.stringify({
          model: BYTEPLUS_SEEDANCE_MODEL,
          content: [{ type: "text", text: prompt }],
          duration: createInput.durationSeconds,
          resolution: createInput.resolution,
          ratio: createInput.ratio,
          generate_audio: createInput.generateAudio ?? true,
          watermark: createInput.watermark ?? true,
          execution_expires_after: 3_600,
        }),
      }, createInput.signal);
      if (!hasText(payload.id)) {
        throw new BytePlusSeedanceError({
          code: "BYTEPLUS_RESPONSE_INVALID",
          message: "BytePlus 沒有回傳可追蹤的工作識別碼。",
          status: 502,
          retryable: true,
        });
      }
      return { providerTaskId: payload.id, status: "queued" };
    },
    async pollTask(providerTaskId, signal) {
      assertProviderTaskId(providerTaskId);
      const payload = await request(`${BYTEPLUS_SEEDANCE_TASK_PATH}/${encodeURIComponent(providerTaskId)}`, {
        method: "GET",
      }, signal);
      const id = hasText(payload.id) ? payload.id : providerTaskId;
      assertProviderTaskId(id);
      const status = normalizedStatus(payload.status);
      const content = isObject(payload.content) ? payload.content : null;
      const videoUrl = content && hasText(content.video_url) && /^https:\/\//u.test(content.video_url)
        ? content.video_url
        : null;
      if (status === "succeeded" && !videoUrl) {
        throw new BytePlusSeedanceError({
          code: "BYTEPLUS_RESPONSE_INVALID",
          message: "BytePlus 已標示成功，但沒有可驗證的 HTTPS 影片位置。",
          status: 502,
          retryable: true,
        });
      }
      return {
        providerTaskId: id,
        status,
        videoUrl,
        failureCode: status === "failed"
          ? "PROVIDER_TASK_FAILED"
          : status === "cancelled"
            ? "PROVIDER_TASK_CANCELLED"
            : status === "expired"
              ? "PROVIDER_TASK_EXPIRED"
              : null,
      };
    },
  };
}
