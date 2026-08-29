import "server-only";
import type { VideoProductionJobStatus } from "../video-production";

export type VideoProviderResolution = "480p" | "720p" | "1080p" | "4k";
export type VideoProviderRatio = "adaptive" | "16:9" | "9:16" | "1:1";

export type VideoProviderCreateInput<
  Resolution extends string = VideoProviderResolution,
  Ratio extends string = VideoProviderRatio,
> = {
  idempotencyKey?: string;
  prompt: string;
  durationSeconds: number;
  resolution: Resolution;
  ratio: Ratio;
  generateAudio?: boolean;
  watermark?: boolean;
  signal?: AbortSignal;
};

export type NormalizedVideoProviderJob = {
  providerTaskId: string;
  status: Exclude<VideoProductionJobStatus, "draft">;
  progressPercent: number | null;
  videoUrl: string | null;
  failureCode: string | null;
  retryable: boolean;
};

export type VideoProviderCancelReceipt = {
  providerTaskId: string;
  status: "cancelled" | "cancel_requested";
  remoteConfirmed: boolean;
};

export type VideoProviderAdapter<
  Resolution extends string = VideoProviderResolution,
  Ratio extends string = VideoProviderRatio,
> = {
  readonly providerId: string;
  readonly model: string;
  status(): {
    configured: true;
    providerId: string;
    model: string;
  };
  createTask(input: VideoProviderCreateInput<Resolution, Ratio>): Promise<{
    providerTaskId: string;
    status: "queued";
  }>;
  pollTask(providerTaskId: string, signal?: AbortSignal): Promise<NormalizedVideoProviderJob>;
  cancelTask?: (providerTaskId: string, signal?: AbortSignal) => Promise<VideoProviderCancelReceipt>;
};

const ALLOWED_TRANSITIONS: Record<Exclude<VideoProductionJobStatus, "draft">, readonly Exclude<VideoProductionJobStatus, "draft">[]> = {
  queued: ["queued", "running", "succeeded", "failed", "cancelled", "expired"],
  running: ["running", "succeeded", "failed", "cancelled", "expired"],
  succeeded: ["succeeded"],
  failed: ["failed"],
  cancelled: ["cancelled"],
  expired: ["expired"],
};

export function isValidVideoProviderTransition(
  from: Exclude<VideoProductionJobStatus, "draft">,
  to: Exclude<VideoProductionJobStatus, "draft">,
) {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function boundedVideoProgress(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}
