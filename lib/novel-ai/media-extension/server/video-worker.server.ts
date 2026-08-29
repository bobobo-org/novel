import "server-only";
import {
  VIDEO_WORKER_PROVIDER_ID,
  VideoWorkerError,
  createVideoWorkerAdapter,
  validateVideoWorkerConnection,
} from "./video-worker-protocol";
import type { VideoWorkerAdapter, VideoWorkerCapabilities } from "./video-worker-protocol";

type ServerEnvironment = Record<string, string | undefined>;

export type VideoWorkerConfigurationBlockedReason =
  | "VIDEO_WORKER_BASE_URL_MISSING"
  | "VIDEO_WORKER_TOKEN_MISSING"
  | "VIDEO_WORKER_MODEL_MISSING"
  | "VIDEO_WORKER_CONFIGURATION_INVALID";

export type VideoWorkerServerConfiguration = {
  configured: boolean;
  baseUrl: string;
  token: string;
  model: string;
  production: boolean;
  allowInsecureLocal: boolean;
  blockedReason: VideoWorkerConfigurationBlockedReason | null;
};

export function readVideoWorkerServerConfiguration(
  environment: ServerEnvironment = process.env,
): VideoWorkerServerConfiguration {
  const baseUrl = environment.NOVEL_VIDEO_WORKER_BASE_URL?.trim() ?? "";
  const token = environment.NOVEL_VIDEO_WORKER_TOKEN?.trim() ?? "";
  const model = environment.NOVEL_VIDEO_WORKER_MODEL?.trim() ?? "";
  const production = environment.NODE_ENV === "production";
  const allowInsecureLocal = environment.NOVEL_VIDEO_WORKER_ALLOW_INSECURE_LOCAL === "1";
  const missingReason = !baseUrl
    ? "VIDEO_WORKER_BASE_URL_MISSING"
    : !token
      ? "VIDEO_WORKER_TOKEN_MISSING"
      : !model
        ? "VIDEO_WORKER_MODEL_MISSING"
        : null;
  if (missingReason) {
    return {
      configured: false,
      baseUrl,
      token,
      model,
      production,
      allowInsecureLocal,
      blockedReason: missingReason,
    };
  }
  try {
    const validated = validateVideoWorkerConnection({
      baseUrl,
      token,
      model,
      production,
      allowInsecureLocal,
    });
    return {
      configured: true,
      ...validated,
      blockedReason: null,
    };
  } catch {
    return {
      configured: false,
      baseUrl,
      token,
      model,
      production,
      allowInsecureLocal,
      blockedReason: "VIDEO_WORKER_CONFIGURATION_INVALID",
    };
  }
}
export function publicVideoWorkerServerStatus(environment: ServerEnvironment = process.env) {
  const configuration = readVideoWorkerServerConfiguration(environment);
  return {
    schemaVersion: "novel-video-worker-runtime-health-v1",
    configured: configuration.configured,
    providerId: VIDEO_WORKER_PROVIDER_ID,
    executionProviderId: configuration.configured ? VIDEO_WORKER_PROVIDER_ID : null,
    model: configuration.model || "no-self-hosted-video-model-connected",
    endpointConfigured: Boolean(configuration.baseUrl),
    credentialConfigured: Boolean(configuration.token),
    modelConfigured: Boolean(configuration.model),
    executionBlockedReason: configuration.blockedReason,
  } as const;
}

export function createVideoWorkerServerAdapter(
  environment: ServerEnvironment = process.env,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): VideoWorkerAdapter {
  const configuration = readVideoWorkerServerConfiguration(environment);
  if (!configuration.configured) {
    throw new VideoWorkerError({
      code: "VIDEO_WORKER_CONFIGURATION_INVALID",
      message: "自架影片工作站的伺服器端設定不完整或不安全。",
      status: 503,
    });
  }
  return createVideoWorkerAdapter({
    baseUrl: configuration.baseUrl,
    token: configuration.token,
    model: configuration.model,
    production: configuration.production,
    allowInsecureLocal: configuration.allowInsecureLocal,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
}

export type PublicVideoWorkerProbe = ReturnType<typeof publicVideoWorkerServerStatus> & {
  runtimeReady: boolean;
  workerStatus: "ready" | "degraded" | "unreachable" | "not_configured";
  workerId: string | null;
  capabilities: VideoWorkerCapabilities | null;
  probeErrorCode: string | null;
};

export async function probeVideoWorkerServer(
  environment: ServerEnvironment = process.env,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<PublicVideoWorkerProbe> {
  const publicStatus = publicVideoWorkerServerStatus(environment);
  if (!publicStatus.configured) {
    return {
      ...publicStatus,
      runtimeReady: false,
      workerStatus: "not_configured",
      workerId: null,
      capabilities: null,
      probeErrorCode: publicStatus.executionBlockedReason,
    };
  }
  try {
    const health = await createVideoWorkerServerAdapter(environment, options).health(options.signal);
    return {
      ...publicStatus,
      runtimeReady: health.status === "ready",
      workerStatus: health.status,
      workerId: health.workerId,
      capabilities: health.capabilities,
      probeErrorCode: null,
    };
  } catch (error) {
    return {
      ...publicStatus,
      runtimeReady: false,
      workerStatus: "unreachable",
      workerId: null,
      capabilities: null,
      probeErrorCode: error instanceof VideoWorkerError ? error.code : "VIDEO_WORKER_UNAVAILABLE",
    };
  }
}
