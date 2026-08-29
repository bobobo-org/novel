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
import {
  assertExternalAIRequestOrigin,
  externalAIClientIdentifier,
  ExternalAIRequestGuardError,
  readExternalAIJsonBody,
  reserveExternalAIRequest,
} from "@/lib/novel-ai/providers/external/external-request-guard.server";
import { evaluateExternalAIPublicExecution } from "@/lib/novel-ai/providers/external/external-execution-policy.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SAFE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    assertExternalAIRequestOrigin(request);
    body = await readExternalAIJsonBody(request);
  } catch (error) {
    if (error instanceof ExternalAIRequestGuardError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { ...SAFE_RESPONSE_HEADERS, ...error.headers } },
      );
    }
    return NextResponse.json(
      { error: "無法讀取外接 AI 要求。", code: "EXTERNAL_AI_REQUEST_INVALID" },
      { status: 400, headers: SAFE_RESPONSE_HEADERS },
    );
  }

  // Consent is checked before the operator gate. Credentials are configuration,
  // not permission for anonymous visitors to spend the operator's balance.
  const executionPolicy = evaluateExternalAIPublicExecution(body.externalConsent);
  if (!executionPolicy.allowed) {
    return NextResponse.json(
      { error: executionPolicy.error, code: executionPolicy.code },
      { status: executionPolicy.status, headers: SAFE_RESPONSE_HEADERS },
    );
  }

  const clientId = externalAIClientIdentifier(request);
  let lease: ReturnType<typeof reserveExternalAIRequest>;
  try {
    lease = reserveExternalAIRequest(
      clientId,
      typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : undefined,
    );
  } catch (error) {
    if (error instanceof ExternalAIRequestGuardError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { ...SAFE_RESPONSE_HEADERS, ...error.headers } },
      );
    }
    return NextResponse.json(
      { error: "外接 AI 安全額度目前不可用。", code: "EXTERNAL_AI_GUARD_UNAVAILABLE" },
      { status: 503, headers: SAFE_RESPONSE_HEADERS },
    );
  }

  let streamOwnsLease = false;
  try {
    if (!isNovelAIExecutionMode(body.executionMode)) {
      return NextResponse.json(
        { error: "缺少有效的 AI 執行模式。", code: "INVALID_EXECUTION_MODE" },
        { status: 400, headers: { ...SAFE_RESPONSE_HEADERS, ...lease.headers } },
      );
    }
    if (!isExternalAIProviderId(body.providerId)) {
      return NextResponse.json(
        { error: "缺少有效的外接 AI 提供者。", code: "INVALID_EXTERNAL_PROVIDER" },
        { status: 400, headers: { ...SAFE_RESPONSE_HEADERS, ...lease.headers } },
      );
    }

    const generationRequest = {
      executionMode: body.executionMode,
      providerId: body.providerId,
      externalConsent: body.externalConsent === true,
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      systemInstruction: typeof body.systemInstruction === "string" ? body.systemInstruction : undefined,
      requestId: typeof body.requestId === "string" ? body.requestId : undefined,
      maxOutputTokens: typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      safetyIdentifier: clientId,
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
                error: known ? error.message : "外接 AI 沒有完成這次工作。",
                code: known ? error.code : "EXTERNAL_AI_UNKNOWN",
              });
            } catch {
              // The browser can cancel while the provider is still unwinding.
            }
          }).finally(() => {
            request.signal.removeEventListener("abort", abortProvider);
            lease.release();
            try { controller.close(); } catch { /* already cancelled */ }
          });
        },
        cancel(reason) {
          providerAbort.abort(reason || "CLIENT_STREAM_CANCELLED");
          request.signal.removeEventListener("abort", abortProvider);
        },
      });
      streamOwnsLease = true;
      return new Response(stream, {
        headers: {
          ...lease.headers,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Content-Type-Options": "nosniff",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    const result = await generateExternalAICandidate(generationRequest);
    return NextResponse.json(result, { headers: { ...SAFE_RESPONSE_HEADERS, ...lease.headers } });
  } catch (error) {
    if (error instanceof ExternalAIProviderError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { ...SAFE_RESPONSE_HEADERS, ...lease.headers } },
      );
    }
    return NextResponse.json(
      { error: "外接 AI 沒有完成這次工作。", code: "EXTERNAL_AI_UNKNOWN" },
      { status: 500, headers: { ...SAFE_RESPONSE_HEADERS, ...lease.headers } },
    );
  } finally {
    if (!streamOwnsLease) lease.release();
  }
}
