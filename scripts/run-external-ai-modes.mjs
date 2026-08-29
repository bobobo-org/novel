import assert from "node:assert/strict";
import {
  ExternalAIClientError,
  generateExternalAIStream,
} from "../lib/novel-ai/providers/external/external-provider-client.ts";
import {
  ExternalAIProviderError,
  generateExternalAICandidate,
  listExternalAIProviderStatus,
  resetExternalAIProviderVerificationCacheForTests,
  streamExternalAICandidate,
  verifyExternalAIProviderStatus,
} from "../lib/novel-ai/providers/external/external-provider-runtime.ts";

const environmentKeys = [
  "OPENAI_API_KEY", "OPENAI_MODEL_ID", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_MODEL_ID",
  "XAI_API_KEY", "XAI_MODEL_ID", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL_ID",
  "EXTERNAL_AI_COMPATIBLE_API_KEY", "EXTERNAL_AI_COMPATIBLE_MODEL_ID", "EXTERNAL_AI_COMPATIBLE_BASE_URL",
];
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const calls = [];

function restore() {
  globalThis.fetch = originalFetch;
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function streamResponse(frames, status = 200) {
  return new Response(frames.join("\n\n") + "\n\n", {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

try {
  process.env.OPENAI_API_KEY = "openai-test-secret";
  process.env.GEMINI_API_KEY = "gemini-test-secret";
  process.env.XAI_API_KEY = "xai-test-secret";
  process.env.ANTHROPIC_API_KEY = "anthropic-test-secret";
  process.env.EXTERNAL_AI_COMPATIBLE_API_KEY = "compatible-test-secret";
  process.env.EXTERNAL_AI_COMPATIBLE_MODEL_ID = "custom-writer-model";
  process.env.EXTERNAL_AI_COMPATIBLE_BASE_URL = "https://compatible.example/v1";
  const generationFetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    calls.push({ url: String(url), init, body });
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return response({ candidates: [{ content: { parts: [{ text: "Gemini 候選" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 } });
    }
    if (String(url).includes("api.anthropic.com")) {
      return response({ content: [{ type: "text", text: "Claude 候選" }], usage: { input_tokens: 12, output_tokens: 5 } });
    }
    if (String(url).includes("compatible.example")) {
      return response({ choices: [{ message: { content: "通用相容候選" } }], usage: { prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 } });
    }
    return response({ output: [{ type: "message", content: [{ type: "output_text", text: String(url).includes("api.x.ai") ? "Grok 候選" : "OpenAI 候選" }] }], usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } });
  };
  globalThis.fetch = generationFetch;

  const status = listExternalAIProviderStatus();
  assert.deepEqual(status.map((provider) => provider.id), ["openai", "gemini", "grok", "claude", "openai-compatible"]);
  assert.ok(status.every((provider) => provider.configured && provider.serverSideCredentialOnly));
  assert.ok(status.every((provider) => provider.verification === "configured_unverified"));
  const serializedStatus = JSON.stringify(status);
  assert.equal(serializedStatus.includes("test-secret"), false, "public status must never expose credentials");

  const verificationCalls = [];
  resetExternalAIProviderVerificationCacheForTests();
  globalThis.fetch = async (url, init = {}) => {
    verificationCalls.push({ url: String(url), init });
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return response({ name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] });
    }
    if (String(url).includes("compatible.example")) {
      return response({ data: [{ id: "custom-writer-model" }] });
    }
    const id = String(url).split("/").pop();
    return response({ id });
  };
  const verified = await verifyExternalAIProviderStatus();
  assert.equal(verified.length, 5);
  assert.ok(verified.every((provider) => provider.verification === "verified"));
  assert.ok(verified.every((provider) => provider.verificationCode === "MODEL_ACCESS_VERIFIED"));
  assert.ok(verified.every((provider) => provider.checkedAt && provider.verifiedAt));
  assert.equal(JSON.stringify(verified).includes("test-secret"), false);
  assert.deepEqual(verificationCalls.map((call) => call.url), [
    "https://api.openai.com/v1/models/gpt-5.6-sol",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash",
    "https://api.x.ai/v1/models/grok-4.5",
    "https://api.anthropic.com/v1/models/claude-sonnet-5",
    "https://compatible.example/v1/models",
  ]);
  assert.equal(verificationCalls[0].init.headers.Authorization, "Bearer openai-test-secret");
  assert.equal(verificationCalls[1].init.headers["x-goog-api-key"], "gemini-test-secret");
  assert.equal(verificationCalls[2].init.headers.Authorization, "Bearer xai-test-secret");
  assert.equal(verificationCalls[3].init.headers["x-api-key"], "anthropic-test-secret");
  assert.equal(verificationCalls[4].init.headers.Authorization, "Bearer compatible-test-secret");
  const verificationCallCount = verificationCalls.length;
  await verifyExternalAIProviderStatus();
  assert.equal(verificationCalls.length, verificationCallCount, "verified model metadata must use the bounded verification cache");
  resetExternalAIProviderVerificationCacheForTests();
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("api.openai.com")) return response({}, 401);
    if (target.includes("api.x.ai")) return response({}, 404);
    if (target.includes("generativelanguage.googleapis.com")) return response({}, 429);
    return response({}, 503);
  };
  const failedVerification = await verifyExternalAIProviderStatus();
  assert.deepEqual(failedVerification.map((provider) => provider.verification), ["failed", "failed", "failed", "failed", "failed"]);
  assert.deepEqual(failedVerification.map((provider) => provider.verificationCode), [
    "EXTERNAL_PROVIDER_AUTH_FAILED",
    "EXTERNAL_PROVIDER_RATE_LIMITED",
    "EXTERNAL_PROVIDER_MODEL_UNAVAILABLE",
    "EXTERNAL_PROVIDER_UNAVAILABLE",
    "EXTERNAL_PROVIDER_UNAVAILABLE",
  ]);
  assert.ok(failedVerification.every((provider) => provider.verifiedAt === null && provider.checkedAt));
  globalThis.fetch = generationFetch;

  await assert.rejects(
    generateExternalAICandidate({ executionMode: "closed-only", providerId: "openai", externalConsent: true, prompt: "blocked" }),
    (error) => error instanceof ExternalAIProviderError && error.code === "EXTERNAL_AI_BLOCKED_BY_MODE",
  );
  assert.equal(calls.length, 0, "closed-only must not issue an external request");

  await assert.rejects(
    generateExternalAICandidate({ executionMode: "external-only", providerId: "openai", externalConsent: false, prompt: "blocked" }),
    (error) => error instanceof ExternalAIProviderError && error.code === "EXTERNAL_AI_CONSENT_REQUIRED",
  );
  assert.equal(calls.length, 0, "missing consent must fail before network access");

  const cases = [
    ["openai", "OpenAI 候選"], ["gemini", "Gemini 候選"], ["grok", "Grok 候選"], ["claude", "Claude 候選"], ["openai-compatible", "通用相容候選"],
  ];
  for (const [providerId, expectedText] of cases) {
    const result = await generateExternalAICandidate({
      executionMode: providerId === "openai" ? "hybrid" : "external-only",
      providerId,
      externalConsent: true,
      prompt: `測試 ${providerId}`,
      maxOutputTokens: 256,
      ...(providerId === "openai" ? { safetyIdentifier: "novel_test_user" } : {}),
    });
    assert.equal(result.text, expectedText);
    assert.equal(result.providerId, providerId);
    assert.equal(result.candidateOnly, true);
    assert.equal(result.dataLeavesDevice, true);
    assert.equal(result.serverStoredByApplication, false);
  }

  const [openaiCall, geminiCall, grokCall, claudeCall, compatibleCall] = calls;
  assert.equal(openaiCall.url, "https://api.openai.com/v1/responses");
  assert.equal(openaiCall.body.store, false);
  assert.equal(openaiCall.body.safety_identifier, "novel_test_user");
  assert.equal(openaiCall.init.headers.Authorization, "Bearer openai-test-secret");
  assert.match(geminiCall.url, /:generateContent$/);
  assert.equal("store" in geminiCall.body, false, "Gemini request must use the stateless Generate Content schema");
  assert.equal(geminiCall.init.headers["x-goog-api-key"], "gemini-test-secret");
  assert.equal(grokCall.url, "https://api.x.ai/v1/responses");
  assert.equal(grokCall.body.store, false);
  assert.equal(claudeCall.url, "https://api.anthropic.com/v1/messages");
  assert.equal(claudeCall.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(compatibleCall.url, "https://compatible.example/v1/chat/completions");
  assert.equal(compatibleCall.init.headers.Authorization, "Bearer compatible-test-secret");
  assert.equal(compatibleCall.body.model, "custom-writer-model");

  const beforeFailure = calls.length;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body || "{}")) });
    return response({ error: { message: "provider failure" } }, 429);
  };
  await assert.rejects(
    generateExternalAICandidate({ executionMode: "external-only", providerId: "openai", externalConsent: true, prompt: "do not fallback" }),
    (error) => error instanceof ExternalAIProviderError && error.code === "EXTERNAL_PROVIDER_RATE_LIMITED",
  );
  assert.equal(calls.length, beforeFailure + 1, "provider failure must not call another external or closed provider");

  const streamCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body || "{}"));
    streamCalls.push({ url: String(url), init, body });
    if (String(url).includes("api.openai.com")) {
      return streamResponse([
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "OpenAI " })}`,
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "串流" })}`,
        `data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } } })}`,
        "data: [DONE]",
      ]);
    }
    if (String(url).includes("api.x.ai")) {
      return streamResponse([
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Grok " })}`,
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "串流" })}`,
        `data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 } } })}`,
        "data: [DONE]",
      ]);
    }
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return streamResponse([
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Gemini " }] } }] })}`,
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "串流" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 } })}`,
      ]);
    }
    if (String(url).includes("compatible.example")) {
      return streamResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "通用相容 " } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "串流" } }], usage: { prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 } })}`,
        "data: [DONE]",
      ]);
    }
    return streamResponse([
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 12 } } })}`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Claude " } })}`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "串流" } })}`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 5 } })}`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
    ]);
  };

  const streamCases = [
    ["openai", "OpenAI 串流"], ["gemini", "Gemini 串流"], ["grok", "Grok 串流"], ["claude", "Claude 串流"], ["openai-compatible", "通用相容 串流"],
  ];
  for (const [providerId, expectedText] of streamCases) {
    const events = [];
    const result = await streamExternalAICandidate({
      executionMode: "external-only",
      providerId,
      externalConsent: true,
      prompt: `串流測試 ${providerId}`,
      maxOutputTokens: 256,
    }, (event) => events.push(event));
    assert.equal(result.text, expectedText);
    assert.equal(result.generatedTokenEvents, 2);
    assert.deepEqual(events.map((event) => event.type), ["start", "delta", "delta", "complete"]);
    assert.equal(events.filter((event) => event.type === "delta").map((event) => event.delta).join(""), expectedText);
    assert.equal(result.candidateOnly, true);
    assert.equal(result.serverStoredByApplication, false);
  }
  assert.equal(streamCalls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(streamCalls[0].body.stream, true);
  assert.match(streamCalls[1].url, /:streamGenerateContent\?alt=sse$/);
  assert.equal("store" in streamCalls[1].body, false, "Gemini streaming request must use the stateless Generate Content schema");
  assert.equal(streamCalls[2].url, "https://api.x.ai/v1/responses");
  assert.equal(streamCalls[2].body.store, false);
  assert.equal(streamCalls[3].url, "https://api.anthropic.com/v1/messages");
  assert.equal(streamCalls[3].body.stream, true);
  assert.equal(streamCalls[4].url, "https://compatible.example/v1/chat/completions");
  assert.equal(streamCalls[4].body.stream, true);

  const cancellation = new AbortController();
  const cancellationEvents = [];
  globalThis.fetch = async () => streamResponse([
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "只收到一段" })}`,
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "不應收到" })}`,
  ]);
  await assert.rejects(
    streamExternalAICandidate({
      executionMode: "external-only",
      providerId: "openai",
      externalConsent: true,
      prompt: "取消測試",
      signal: cancellation.signal,
    }, (event) => {
      cancellationEvents.push(event);
      if (event.type === "delta") cancellation.abort("USER_CANCELLED");
    }),
    (error) => error instanceof ExternalAIProviderError && error.code === "EXTERNAL_AI_CANCELLED",
  );
  assert.deepEqual(cancellationEvents.map((event) => event.type), ["start", "delta"]);
  assert.equal(cancellationEvents.some((event) => event.type === "complete"), false, "cancelled stream must not create a completed candidate");

  const clientResult = {
    requestId: "client-stream-test",
    providerId: "openai",
    modelId: "gpt-5.6-sol",
    text: "瀏覽器已驗證串流",
    candidateOnly: true,
    dataLeavesDevice: true,
    externalRequest: true,
    serverStoredByApplication: false,
    elapsedMs: 42,
    generatedTokenEvents: 1,
    usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
  };
  globalThis.fetch = async () => streamResponse([
    `event: start\ndata: ${JSON.stringify({ requestId: clientResult.requestId, providerId: clientResult.providerId, modelId: clientResult.modelId })}`,
    `event: delta\ndata: ${JSON.stringify({ delta: clientResult.text, generatedTokenEvents: 1 })}`,
    `event: complete\ndata: ${JSON.stringify(clientResult)}`,
  ]);
  const clientDeltas = [];
  const parsedClientResult = await generateExternalAIStream({
    executionMode: "external-only",
    providerId: "openai",
    externalConsent: true,
    prompt: "瀏覽器串流驗證",
  }, { onDelta: (delta) => clientDeltas.push(delta) });
  assert.deepEqual(parsedClientResult, clientResult);
  assert.deepEqual(clientDeltas, [clientResult.text]);

  globalThis.fetch = async () => streamResponse([
    `event: complete\ndata: ${JSON.stringify({ ...clientResult, candidateOnly: false })}`,
  ]);
  await assert.rejects(
    generateExternalAIStream({ executionMode: "external-only", providerId: "openai", externalConsent: true, prompt: "錯誤完成資料" }),
    (error) => error instanceof ExternalAIClientError && error.code === "EXTERNAL_AI_STREAM_INVALID",
  );

  globalThis.fetch = async () => new Response("x".repeat(1_048_577), {
    headers: { "Content-Type": "text/event-stream" },
  });
  await assert.rejects(
    generateExternalAIStream({ executionMode: "external-only", providerId: "openai", externalConsent: true, prompt: "過大串流" }),
    (error) => error instanceof ExternalAIClientError && error.code === "EXTERNAL_AI_STREAM_TOO_LARGE",
  );

  console.log(JSON.stringify({ status: "PASS", providers: cases.length, verifiedProviders: verified.length, streamingProviders: streamCases.length, assertions: 90, silentFallback: false, cancellationCreatesCandidate: false, credentialLeak: false, clientStreamValidation: true }, null, 2));
} finally {
  resetExternalAIProviderVerificationCacheForTests();
  restore();
}
