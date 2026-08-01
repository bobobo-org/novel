import { NextResponse } from "next/server";
import {
  isExternalAIProviderId,
  isNovelAIExecutionMode,
} from "@/lib/novel-ai/providers/external/external-provider-contract";
import {
  ExternalAIProviderError,
  generateExternalAICandidate,
  streamExternalAICandidate,
} from "@/lib/novel-ai/providers/external/external-provider-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "無效的 JSON。", code: "INVALID_JSON" }, { status: 400 });
  }

  if (!isNovelAIExecutionMode(body.executionMode)) {
    return NextResponse.json({ error: "缺少有效的 AI 執行模式。", code: "INVALID_EXECUTION_MODE" }, { status: 400 });
  }
  if (!isExternalAIProviderId(body.providerId)) {
    return NextResponse.json({ error: "缺少有效的外接 AI 提供者。", code: "INVALID_EXTERNAL_PROVIDER" }, { status: 400 });
  }

  try {
    const generationRequest = {
      executionMode: body.executionMode,
      providerId: body.providerId,
      externalConsent: body.externalConsent === true,
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      systemInstruction: typeof body.systemInstruction === "string" ? body.systemInstruction : undefined,
      requestId: typeof body.requestId === "string" ? body.requestId : undefined,
      maxOutputTokens: typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      signal: request.signal,
    };
    const wantsStream = body.stream === true || request.headers.get("accept")?.includes("text/event-stream");
    if (wantsStream) {
      const encoder = new TextEncoder();
      const providerAbort = new AbortController();
      const abortProvider = () => providerAbort.abort(request.signal.reason || "CLIENT_DISCONNECTED");
      if (request.signal.aborted) abortProvider();
      else request.signal.addEventListener("abort", abortProvider, { once: true });
      const streamingRequest = { ...generationRequest, signal: providerAbort.signal };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: string, payload: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
          };
          void streamExternalAICandidate(streamingRequest, (event) => {
            send(event.type, event.type === "complete" ? event.result : event);
          }).catch((error) => {
            const known = error instanceof ExternalAIProviderError;
            try {
              send("error", {
                error: known ? error.message : "外接 AI 發生未分類錯誤。",
                code: known ? error.code : "EXTERNAL_AI_UNKNOWN",
              });
            } catch {
              // The browser can cancel while the provider is still unwinding.
            }
          }).finally(() => {
            request.signal.removeEventListener("abort", abortProvider);
            try { controller.close(); } catch { /* already cancelled */ }
          });
        },
        cancel(reason) {
          providerAbort.abort(reason || "CLIENT_STREAM_CANCELLED");
          request.signal.removeEventListener("abort", abortProvider);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    const result = await generateExternalAICandidate(generationRequest);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    if (error instanceof ExternalAIProviderError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    return NextResponse.json({ error: "外接 AI 發生未分類錯誤。", code: "EXTERNAL_AI_UNKNOWN" }, { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
