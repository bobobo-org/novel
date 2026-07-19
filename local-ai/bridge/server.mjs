import http from "node:http";
import os from "node:os";
import { rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  BRIDGE_PROTOCOL, BRIDGE_VERSION, DEFAULT_LIMITS, BridgeError, PairingStore, RateLimiter, RequestLedger, WorkLimiter,
  assertOrigin, assertProtocol, buildOriginAllowlist, modelProfileFromTag, normalizeOllamaEndpoint, sanitizeLog, validateHostHeader, validateLoopbackHost,
} from "./bridge-core.mjs";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0" };
const characterExtractionFormat = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "facts"],
  properties: {
    schemaVersion: { type: "string", const: "local-quality-guard-v1" },
    facts: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["entityId", "field", "value", "factType", "evidenceSpans", "sourceChapterIds", "confidence", "validatorStatus", "modelId", "requestId", "schemaVersion"], properties: {
      entityId: { type: "string" }, field: { type: "string" }, value: { type: ["string", "number", "boolean", "null"] }, factType: { type: "string", enum: ["explicit", "inferred", "unknown", "conflicted"] },
      evidenceSpans: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["sourceChapterId", "start", "end", "text"], properties: { sourceChapterId: { type: "string" }, start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 1 }, text: { type: "string" } } } },
      sourceChapterIds: { type: "array", maxItems: 5, items: { type: "string" } }, confidence: { type: "number", minimum: 0, maximum: 1 }, validatorStatus: { type: "string", enum: ["pending", "valid", "invalid", "conflict"] }, modelId: { type: "string" }, requestId: { type: "string" }, schemaVersion: { type: "string", const: "local-quality-guard-v1" },
    } } },
  },
};

function sendJson(response, status, body, origin) {
  response.writeHead(status, { ...jsonHeaders, ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}) });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "Content-Type must be application/json.", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new BridgeError("LOCAL_REQUEST_TOO_LARGE", "Request body exceeds the local bridge limit.", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw new BridgeError("OLLAMA_REQUEST_REJECTED", "Request body is not valid JSON.", 400); }
}

function bearer(request) {
  const value = String(request.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function ollamaFetch(endpoint, path, init = {}, timeoutMs = 5_000, controller) {
  const localController = controller || new AbortController();
  const timer = setTimeout(() => localController.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(`${endpoint}${path}`, { ...init, redirect: "error", signal: localController.signal, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const missing = response.status === 404 || /not found/i.test(text);
      throw new BridgeError(missing ? "OLLAMA_MODEL_NOT_FOUND" : response.status >= 500 ? "OLLAMA_MODEL_LOAD_FAILED" : "OLLAMA_REQUEST_REJECTED", `Ollama HTTP ${response.status}.`, missing ? 404 : 502, response.status >= 500);
    }
    return response;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    if (localController.signal.aborted) throw new BridgeError(localController.signal.reason === "cancelled" ? "OLLAMA_CANCELLED" : "OLLAMA_TIMEOUT", "Ollama request was cancelled or timed out.", 408, true);
    throw new BridgeError("OLLAMA_UNREACHABLE", "Ollama is not reachable on local loopback.", 503, true);
  } finally { clearTimeout(timer); }
}

export function createBridgeServer(options = {}) {
  const host = validateLoopbackHost(options.host || process.env.BRIDGE_HOST || "127.0.0.1");
  const port = Number(options.port || process.env.BRIDGE_PORT || 3217);
  const ollamaEndpoint = normalizeOllamaEndpoint(options.ollamaEndpoint || process.env.OLLAMA_ENDPOINT || "http://127.0.0.1:11434");
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const allowlist = buildOriginAllowlist(options.extraOrigins ?? process.env.BRIDGE_ALLOWED_ORIGINS ?? "");
  const envPairingTtlMs = Number(process.env.BRIDGE_PAIRING_TTL_MS || 0);
  const envSessionTtlMs = Number(process.env.BRIDGE_SESSION_TTL_MS || 0);
  const pairingOptions = options.pairingOptions || {
    ...(Number.isFinite(envPairingTtlMs) && envPairingTtlMs > 0 ? { pairingTtlMs: envPairingTtlMs } : {}),
    ...(Number.isFinite(envSessionTtlMs) && envSessionTtlMs > 0 ? { sessionTtlMs: envSessionTtlMs } : {}),
  };
  const pairing = new PairingStore(pairingOptions);
  const rate = new RateLimiter(limits.rateLimitPerMinute);
  const ledger = new RequestLedger();
  const work = new WorkLimiter(limits);
  const active = new Map();
  const logs = [];
  const testMode = options.testMode ?? process.env.BRIDGE_TEST_MODE === "1";
  const pairingFile = options.pairingFile ?? process.env.BRIDGE_PAIRING_FILE ?? "";

  async function publishPairingCode(pending, origin) {
    if (!pairingFile) {
      if (!testMode) process.stderr.write(`Local Bridge pairing code: ${pending.code}\n`);
      return;
    }
    await writeFile(pairingFile, JSON.stringify({ pairingId: pending.pairingId, code: pending.code, expiresAt: pending.expiresAt, origin, instanceId: pairing.instanceId }), { mode: 0o600 });
  }
  async function clearPairingCode() { if (pairingFile) await rm(pairingFile, { force: true }).catch(() => undefined); }

  const log = (record) => {
    const sanitized = sanitizeLog(record);
    logs.push(sanitized);
    if (logs.length > 200) logs.shift();
    if (!testMode) process.stdout.write(`${JSON.stringify(sanitized)}\n`);
  };

  async function probeOllama() {
    try {
      const [versionResponse, tagsResponse] = await Promise.all([ollamaFetch(ollamaEndpoint, "/api/version", { method: "GET" }, 2_000), ollamaFetch(ollamaEndpoint, "/api/tags", { method: "GET" }, 2_000)]);
      const version = await versionResponse.json();
      const tags = await tagsResponse.json();
      const models = Array.isArray(tags.models) ? tags.models.map(modelProfileFromTag) : [];
      return { reachable: true, version: version.version ?? null, models };
    } catch (error) { return { reachable: false, version: null, models: [], errorCode: error.code || "OLLAMA_UNREACHABLE" }; }
  }

  function authenticate(request, origin, requireCsrf = request.method !== "GET") {
    return pairing.authorize(origin, bearer(request), request.headers["x-bridge-csrf"], { requireCsrf });
  }

  const server = http.createServer(async (request, response) => {
    let origin;
    try {
      validateHostHeader(request.headers.host, port);
      origin = assertOrigin(request.headers.origin, allowlist);
      rate.take(origin);
      if (request.method === "OPTIONS") {
        const requestedHeaders = String(request.headers["access-control-request-headers"] || "").toLowerCase();
        const requestedMethod = String(request.headers["access-control-request-method"] || "GET").toUpperCase();
        if (!requestedHeaders.includes("x-bridge-protocol") || (requestedMethod === "POST" && !requestedHeaders.includes("content-type"))) throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "Preflight does not request required bridge headers.", 403);
        const privateNetworkRequested = String(request.headers["access-control-request-private-network"] || "").toLowerCase() === "true";
        response.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin, Access-Control-Request-Private-Network",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Bridge-Protocol,X-Bridge-CSRF,Idempotency-Key",
          ...(privateNetworkRequested ? { "Access-Control-Allow-Private-Network": "true" } : {}),
          "Access-Control-Max-Age": "300",
        });
        response.end(); return;
      }
      assertProtocol(request.headers["x-bridge-protocol"]);
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.searchParams.has("token") || url.searchParams.has("authorization")) throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "Credentials are not accepted in URLs.", 400);

      if (request.method === "GET" && url.pathname === "/health") {
        const ollama = await probeOllama();
        const state = pairing.state();
        return sendJson(response, 200, { bridgeProcessAlive: true, bridgeVersion: BRIDGE_VERSION, protocolVersion: BRIDGE_PROTOCOL, instanceId: pairing.instanceId, providerKind: "local_ollama", operatingSystem: `${os.platform()} ${os.release()}`, supportedOperations: ["health", "pairing", "models", "generate", "stream", "cancel"], streamingSupport: true, cancellationSupport: true, maximumRequestSize: limits.maxPromptBytes, configuredOrigins: [...allowlist], securityMode: "loopback-paired", bindAddress: host, pairingState: state, ollamaReachable: ollama.reachable, ollamaVersion: ollama.version, modelAvailable: ollama.models.some((item) => item.capabilities.textGeneration.value), runtimeReady: state === "paired" && ollama.reachable && ollama.models.some((item) => item.capabilities.textGeneration.value), limits }, origin);
      }

      if (request.method === "POST" && url.pathname === "/pair/request") {
        await readJson(request, 1_024);
        const pending = pairing.request(origin);
        await publishPairingCode(pending, origin);
        return sendJson(response, 201, { pairingId: pending.pairingId, expiresAt: pending.expiresAt, state: pending.state, instanceId: pairing.instanceId, protocolVersion: BRIDGE_PROTOCOL, ...(testMode ? { testCode: pending.code } : {}) }, origin);
      }

      if (request.method === "POST" && url.pathname === "/pair/confirm") {
        const body = await readJson(request, 2_048);
        const session = pairing.confirm(String(body.pairingId || ""), String(body.code || ""), origin);
        await clearPairingCode();
        return sendJson(response, 200, session, origin);
      }

      if (request.method === "POST" && url.pathname === "/pair/revoke") {
        const body = await readJson(request, 1_024);
        if (body.confirm !== true) throw new BridgeError("OLLAMA_REQUEST_REJECTED", "Revocation confirmation is required.", 400);
        return sendJson(response, 200, pairing.revoke(origin, bearer(request), request.headers["x-bridge-csrf"]), origin);
      }

      if (request.method === "GET" && url.pathname === "/models") {
        authenticate(request, origin, false);
        const result = await probeOllama();
        if (!result.reachable) throw new BridgeError(result.errorCode || "OLLAMA_UNREACHABLE", "Ollama model discovery failed.", 503, true);
        return sendJson(response, 200, { providerKind: "local_ollama", models: result.models }, origin);
      }

      if (request.method === "GET" && url.pathname.startsWith("/models/")) {
        authenticate(request, origin, false);
        const modelId = decodeURIComponent(url.pathname.slice(8));
        if (!modelId || modelId.length > 200 || /[\\/?#\0]/.test(modelId)) throw new BridgeError("OLLAMA_MODEL_NOT_FOUND", "Model ID is invalid.", 404);
        const tagsResponse = await ollamaFetch(ollamaEndpoint, "/api/tags", { method: "GET" });
        const tags = await tagsResponse.json();
        const tag = (tags.models || []).find((item) => (item.model || item.name) === modelId);
        if (!tag) throw new BridgeError("OLLAMA_MODEL_NOT_FOUND", "Model is not installed.", 404);
        const showResponse = await ollamaFetch(ollamaEndpoint, "/api/show", { method: "POST", body: JSON.stringify({ model: modelId, verbose: false }) }, 10_000);
        const show = await showResponse.json();
        return sendJson(response, 200, { ...modelProfileFromTag(tag), inspection: { capabilities: show.capabilities ?? null, source: show.capabilities ? "reported" : "unknown" } }, origin);
      }

      if (request.method === "POST" && url.pathname === "/cancel") {
        authenticate(request, origin);
        const body = await readJson(request, 2_048);
        const controller = active.get(String(body.requestId || ""));
        if (!controller) throw new BridgeError("OLLAMA_CANCELLED", "Request is not active.", 404);
        controller.abort("cancelled");
        return sendJson(response, 202, { requestId: body.requestId, state: "cancelled" }, origin);
      }

      if (request.method === "POST" && url.pathname === "/generate") {
        authenticate(request, origin);
        const body = await readJson(request, limits.maxPromptBytes + 8_192);
        const requestId = String(body.requestId || request.headers["idempotency-key"] || "");
        const modelId = String(body.model || "");
        const prompt = Array.isArray(body.messages) ? body.messages.map((item) => `${item.role}: ${item.content}`).join("\n") : String(body.prompt || "");
        if (!requestId || !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) throw new BridgeError("OLLAMA_REQUEST_REJECTED", "A structured request ID is required.", 400);
        if (Buffer.byteLength(prompt, "utf8") > limits.maxPromptBytes) throw new BridgeError("LOCAL_REQUEST_TOO_LARGE", "Prompt exceeds the local bridge limit.", 413);
        if (!modelId || modelId.length > 200 || /[\\/?#\0]/.test(modelId)) throw new BridgeError("OLLAMA_MODEL_NOT_FOUND", "Model ID is invalid.", 404);
        const maxTokens = Math.min(Number(body.options?.num_predict || limits.maxOutputTokens), limits.maxOutputTokens);
        const timeoutMs = Math.min(Math.max(Number(body.timeoutMs || 60_000), 100), limits.maxTimeoutMs);
        ledger.begin(requestId, JSON.stringify({ origin, modelId, promptHash: Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prompt))).toString("hex"), taskType: body.taskType || "unknown" }));
        const release = await work.acquire();
        const controller = new AbortController();
        const totalTimer = setTimeout(() => controller.abort("timeout"), timeoutMs);
        active.set(requestId, controller);
        const startedAt = performance.now();
        let status = "failed";
        try {
          const tagsResponse = await ollamaFetch(ollamaEndpoint, "/api/tags", { method: "GET" }, 5_000);
          const tags = await tagsResponse.json();
          if (!(tags.models || []).some((item) => (item.model || item.name) === modelId)) throw new BridgeError("OLLAMA_MODEL_NOT_FOUND", "Model is not installed.", 404);
          const format = body.taskType === "character.extract" ? characterExtractionFormat : undefined;
          const upstream = await ollamaFetch(ollamaEndpoint, "/api/generate", { method: "POST", body: JSON.stringify({ model: modelId, prompt, system: body.systemInstruction || undefined, stream: true, format, options: { ...(body.options || {}), num_predict: maxTokens } }) }, timeoutMs, controller);
          response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin, Vary: "Origin", "X-Content-Type-Options": "nosniff" });
          response.write(`${JSON.stringify({ type: "started", requestId, modelId })}\n`);
          const reader = upstream.body?.getReader();
          if (!reader) throw new BridgeError("OLLAMA_INVALID_RESPONSE", "Ollama response has no stream.", 502);
          const decoder = new TextDecoder();
          let buffer = "", tokenCount = 0, metadata = {};
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n"); buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.trim()) continue;
              let item; try { item = JSON.parse(line); } catch { throw new BridgeError("OLLAMA_INVALID_RESPONSE", "Ollama returned invalid stream JSON.", 502); }
              if (item.response) { tokenCount += 1; response.write(`${JSON.stringify({ type: "token", text: item.response })}\n`); }
              if (item.done) metadata = { totalDuration: item.total_duration ?? null, loadDuration: item.load_duration ?? null, promptEvalCount: item.prompt_eval_count ?? null, evalCount: item.eval_count ?? null };
            }
          }
          response.write(`${JSON.stringify({ type: "metadata", tokenEvents: tokenCount, ...metadata })}\n`);
          response.write(`${JSON.stringify({ type: "completed", requestId })}\n`);
          response.end(); status = "completed";
        } catch (error) {
          const effective = controller.signal.aborted ? new BridgeError(controller.signal.reason === "cancelled" ? "OLLAMA_CANCELLED" : "OLLAMA_TIMEOUT", controller.signal.reason === "cancelled" ? "Ollama generation was cancelled." : "Ollama generation timed out.", 408, true) : error;
          status = effective.code === "OLLAMA_CANCELLED" ? "cancelled" : "failed";
          if (!response.headersSent) sendJson(response, effective.status || 500, { errorCode: effective.code || "OLLAMA_INVALID_RESPONSE", message: effective.message, retryable: Boolean(effective.retryable), requestId }, origin);
          else { response.write(`${JSON.stringify({ type: status, errorCode: effective.code || "OLLAMA_STREAM_INTERRUPTED", message: effective.message })}\n`); response.end(); }
        } finally {
          clearTimeout(totalTimer); active.delete(requestId); release(); ledger.finish(requestId, status);
          log({ requestId, taskType: body.taskType, modelId, elapsedMs: Math.round(performance.now() - startedAt), status, errorCode: status === "completed" ? null : status === "cancelled" ? "OLLAMA_CANCELLED" : "OLLAMA_STREAM_INTERRUPTED" });
        }
        return;
      }

      throw new BridgeError("OLLAMA_REQUEST_REJECTED", "Route not found.", 404);
    } catch (error) {
      const bridgeError = error instanceof BridgeError ? error : new BridgeError("OLLAMA_INVALID_RESPONSE", "Local bridge request failed.", 500);
      if (!response.headersSent) sendJson(response, bridgeError.status, { errorCode: bridgeError.code, message: bridgeError.message, retryable: bridgeError.retryable, details: bridgeError.details }, origin);
      else response.end();
    }
  });

  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
  return { server, config: { host, port, ollamaEndpoint, limits, allowlist: [...allowlist], instanceId: pairing.instanceId }, pairing, logs, active, async start() { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolve(); }); }); return this; }, async stop() { for (const controller of active.values()) controller.abort("cancelled"); await clearPairingCode(); server.closeIdleConnections?.(); await new Promise((resolve) => server.close(resolve)); server.closeAllConnections?.(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bridge = createBridgeServer();
  bridge.start().then(() => process.stdout.write(`${JSON.stringify({ event: "bridge_started", protocol: BRIDGE_PROTOCOL, host: bridge.config.host, port: bridge.config.port, instanceId: bridge.config.instanceId })}\n`)).catch((error) => { process.stderr.write(`${error.code || "BRIDGE_START_FAILED"}: ${error.message}\n`); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => bridge.stop().finally(() => process.exit(0)));
}
