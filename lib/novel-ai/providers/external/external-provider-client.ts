"use client";

import type {
  ExternalAIGenerationRequest,
  ExternalAIGenerationResult,
} from "./external-provider-contract";

type ClientRequest = Omit<ExternalAIGenerationRequest, "signal">;
type StreamOptions = {
  signal?: AbortSignal;
  onStart?: (input: { requestId: string; providerId: string; modelId: string }) => void;
  onDelta?: (delta: string, generatedTokenEvents: number) => void;
};

export class ExternalAIClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExternalAIClientError";
    this.code = code;
  }
}

export async function generateExternalAIStream(
  request: ClientRequest,
  options: StreamOptions = {},
): Promise<ExternalAIGenerationResult> {
  let response: Response;
  try {
    response = await fetch("/api/ai/external/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ ...request, stream: true }),
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new ExternalAIClientError("EXTERNAL_AI_CANCELLED", "外接 AI 已由使用者取消，沒有建立候選。");
    }
    throw error;
  }
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
    throw new ExternalAIClientError(payload.code || "EXTERNAL_AI_FAILED", payload.error || "外接 AI 沒有完成這次工作。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ExternalAIGenerationResult | null = null;
  const processFrame = (frame: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    const data = dataLines.join("\n").trim();
    if (!data) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      throw new ExternalAIClientError("EXTERNAL_AI_STREAM_INVALID", "外接 AI 串流內容無法解析。");
    }
    if (eventName === "start") {
      options.onStart?.({
        requestId: String(payload.requestId || ""),
        providerId: String(payload.providerId || ""),
        modelId: String(payload.modelId || ""),
      });
    } else if (eventName === "delta") {
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      if (delta) options.onDelta?.(delta, Number(payload.generatedTokenEvents || 0));
    } else if (eventName === "complete") {
      result = payload as unknown as ExternalAIGenerationResult;
    } else if (eventName === "error") {
      throw new ExternalAIClientError(String(payload.code || "EXTERNAL_AI_FAILED"), String(payload.error || "外接 AI 沒有完成這次工作。"));
    }
  };
  try {
    while (true) {
      if (options.signal?.aborted) throw new ExternalAIClientError("EXTERNAL_AI_CANCELLED", "外接 AI 已由使用者取消，沒有建立候選。");
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || "";
      for (const frame of frames) processFrame(frame);
      if (done) break;
    }
    if (buffer.trim()) processFrame(buffer);
  } catch (error) {
    if (options.signal?.aborted) {
      throw new ExternalAIClientError("EXTERNAL_AI_CANCELLED", "外接 AI 已由使用者取消，沒有建立候選。");
    }
    throw error;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (!result) throw new ExternalAIClientError("EXTERNAL_AI_STREAM_INCOMPLETE", "外接 AI 串流未完成，沒有建立候選。");
  return result;
}
