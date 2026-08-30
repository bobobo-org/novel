import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
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
import {
  consumeExternalRpgConsentAssertion,
  ExternalRpgConsentError,
} from "@/lib/novel-ai/providers/external/external-rpg-consent.server";
import {
  ExternalRpgRequestError,
  validateExternalRpgRequestBody,
} from "@/lib/novel-ai/providers/external/external-rpg-request.server";

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

  if (!isNovelAIExecutionMode(body.executionMode)) {
    return NextResponse.json(
      { error: "缺少有效的 AI 執行模式。", code: "INVALID_EXECUTION_MODE" },
      { status: 400, headers: SAFE_RESPONSE_HEADERS },
    );
  }
  if (!isExternalAIProviderId(body.providerId)) {
    return NextResponse.json(
      { error: "缺少有效的外接 AI 提供者。", code: "INVALID_EXTERNAL_PROVIDER" },
      { status: 400, headers: SAFE_RESPONSE_HEADERS },
    );
  }

  const hasRpgConsentFields = body.rpgConsentAssertion !== undefined
    || body.rpgProjectId !== undefined
    || body.rpgFieldManifestDigest !== undefined
    || body.rpgPublicPayload !== undefined;
  const rpgOperation = body.operation === "rpg-turn";
  if (hasRpgConsentFields && !rpgOperation) {
    return NextResponse.json(
      { error: "RPG 外送欄位缺少正確的操作類型。", code: "EXTERNAL_RPG_OPERATION_INVALID" },
      { status: 400, headers: SAFE_RESPONSE_HEADERS },
    );
  }
  let canonicalRpgPrompt: string | null = null;
  if (rpgOperation) {
    if (
      body.rpgConsentAssertion === undefined
      || typeof body.rpgProjectId !== "string"
      || typeof body.rpgFieldManifestDigest !== "string"
      || typeof body.requestId !== "string"
      || body.rpgPublicPayload === undefined
    ) {
      return NextResponse.json(
        { error: "本次 RPG 外送缺少完整的單次同意綁定。", code: "EXTERNAL_RPG_CONSENT_REQUIRED" },
        { status: 403, headers: SAFE_RESPONSE_HEADERS },
      );
    }
    try {
      const validated = validateExternalRpgRequestBody({
        body,
        acceptsEventStream: request.headers.get("accept")?.includes("text/event-stream") === true,
      });
      canonicalRpgPrompt = validated.canonicalPrompt;
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "RPG 外送資料超出公開欄位界線。",
          code: error instanceof ExternalRpgRequestError || (error && typeof error === "object" && "code" in error)
            ? String((error as { code?: unknown }).code)
            : "EXTERNAL_RPG_PUBLIC_PAYLOAD_INVALID",
        },
        { status: 400, headers: SAFE_RESPONSE_HEADERS },
      );
    }
    try {
      consumeExternalRpgConsentAssertion({
        assertion: body.rpgConsentAssertion,
        expected: {
          projectId: typeof body.rpgProjectId === "string" ? body.rpgProjectId : "",
          logicalRequestId: typeof body.requestId === "string" ? body.requestId : "",
          providerId: body.providerId,
          promptDigest: createHash("sha256").update(canonicalRpgPrompt).digest("hex"),
          fieldManifestDigest: typeof body.rpgFieldManifestDigest === "string"
            ? body.rpgFieldManifestDigest
            : "",
        },
      });
    } catch (error) {
      if (error instanceof ExternalRpgConsentError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status, headers: SAFE_RESPONSE_HEADERS },
        );
      }
      return NextResponse.json(
        { error: "本次 RPG 外送同意無法驗證。", code: "EXTERNAL_RPG_CONSENT_UNKNOWN" },
        { status: 403, headers: SAFE_RESPONSE_HEADERS },
      );
    }
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
    const generationRequest = {
      executionMode: body.executionMode,
      providerId: body.providerId,
      externalConsent: body.externalConsent === true,
      prompt: canonicalRpgPrompt ?? (typeof body.prompt === "string" ? body.prompt : ""),
      systemInstruction: rpgOperation
        ? undefined
        : typeof body.systemInstruction === "string" ? body.systemInstruction : undefined,
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
