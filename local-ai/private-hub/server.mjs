import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  BridgeError,
  PairingStore,
  RateLimiter,
  RequestLedger,
  WorkLimiter,
  assertOrigin,
  buildOriginAllowlist,
  modelProfileFromTag,
  normalizeOllamaEndpoint,
  validateHostHeader,
  validateLoopbackHost,
} from "../bridge/bridge-core.mjs";
import {
  preferenceModelGuidance,
  trainOfflinePreferenceModel,
  verifyOfflinePreferenceModel,
} from "./preference-model.mjs";
import {
  assertRuntimeCacheNamespace,
} from "../cache/cache-contract.mjs";
import {
  EncryptedPrivateHubCacheStore,
} from "../cache/encrypted-cache-store.mjs";

export const PRIVATE_HUB_PROTOCOL = "novel-private-hub/v1";
export const PRIVATE_HUB_VERSION = "1.0.0-live-model";
const DEFAULT_PORT = 3227;
const DEFAULT_LIMITS = Object.freeze({
  maxPromptBytes: 262_144,
  maxOutputTokens: 4_096,
  maxConcurrent: 2,
  maxQueue: 4,
  maxTimeoutMs: 240_000,
  rateLimitPerMinute: 30,
  maxTrainingBytes: 1_572_864,
});
const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sendJson(response, status, body, origin) {
  response.writeHead(status, {
    ...jsonHeaders,
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "Content-Type must be application/json.", 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new BridgeError("LOCAL_REQUEST_TOO_LARGE", "Request body exceeds the private hub limit.", 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new BridgeError("OLLAMA_REQUEST_REJECTED", "Request body is not valid JSON.", 400);
  }
}

function bearer(request) {
  const value = String(request.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function cacheRequestError(error) {
  if (error instanceof BridgeError) return error;
  const code = String(error?.code || "CLOSED_AI_CACHE_REQUEST_INVALID");
  const clientError = code === "CLOSED_AI_NAMESPACE_INVALID"
    || code === "CLOSED_AI_CACHE_INVALIDATION_NOT_TARGETED"
    || code === "CLOSED_AI_CACHE_LAYER_INVALID";
  return new BridgeError(
    code,
    error instanceof Error ? error.message : "Closed AI cache request failed.",
    clientError ? 400 : 500,
    false,
  );
}

function assertProtocol(value) {
  if (value !== PRIVATE_HUB_PROTOCOL) {
    throw new BridgeError(
      "BRIDGE_PROTOCOL_INCOMPATIBLE",
      `Expected ${PRIVATE_HUB_PROTOCOL}.`,
      409,
    );
  }
}

function validModelId(modelId) {
  if (!modelId || modelId.length > 200 || /[\\/?#\0]/.test(modelId)) {
    throw new BridgeError("OLLAMA_MODEL_NOT_FOUND", "Model ID is invalid.", 404);
  }
  return modelId;
}

function validProjectId(projectId) {
  const value = String(projectId || "").trim();
  if (!value || value.length > 200 || /[\0]/.test(value)) {
    throw new BridgeError("OLLAMA_REQUEST_REJECTED", "Project ID is invalid.", 400);
  }
  return value;
}

async function ollamaFetch(endpoint, route, init = {}, timeoutMs = 5_000, controller) {
  const localController = controller || new AbortController();
  const timer = setTimeout(() => localController.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(`${endpoint}${route}`, {
      ...init,
      redirect: "error",
      signal: localController.signal,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const missing = response.status === 404 || /not found/i.test(text);
      throw new BridgeError(
        missing
          ? "OLLAMA_MODEL_NOT_FOUND"
          : response.status >= 500
            ? "OLLAMA_MODEL_LOAD_FAILED"
            : "OLLAMA_REQUEST_REJECTED",
        `Ollama HTTP ${response.status}.`,
        missing ? 404 : 502,
        response.status >= 500,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    if (localController.signal.aborted) {
      throw new BridgeError(
        localController.signal.reason === "cancelled" ? "OLLAMA_CANCELLED" : "OLLAMA_TIMEOUT",
        "Private Hub model request was cancelled or timed out.",
        408,
        true,
      );
    }
    throw new BridgeError(
      "OLLAMA_UNREACHABLE",
      "Private Hub cannot reach its loopback model runtime.",
      503,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

function safeTrainingModel(artifact, active) {
  return {
    schemaVersion: artifact.schemaVersion,
    modelId: artifact.modelId,
    modelType: artifact.modelType,
    projectId: artifact.projectId,
    baseModelId: artifact.baseModelId,
    datasetVersion: artifact.datasetVersion,
    datasetDigest: artifact.datasetDigest,
    trainingMethod: artifact.trainingMethod,
    featureNames: artifact.featureNames,
    weights: artifact.weights,
    bias: artifact.bias,
    hyperparameters: artifact.hyperparameters,
    metrics: artifact.metrics,
    privacy: artifact.privacy,
    createdAt: artifact.createdAt,
    status: active ? "active" : artifact.status,
    artifactDigest: artifact.artifactDigest,
    verified: verifyOfflinePreferenceModel(artifact),
  };
}

export function createPrivateHubServer(options = {}) {
  const host = validateLoopbackHost(options.host || process.env.PRIVATE_HUB_HOST || "127.0.0.1");
  const port = Number(options.port || process.env.PRIVATE_HUB_PORT || DEFAULT_PORT);
  const ollamaEndpoint = normalizeOllamaEndpoint(
    options.ollamaEndpoint || process.env.OLLAMA_ENDPOINT || "http://127.0.0.1:11434",
  );
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const allowlist = buildOriginAllowlist(
    options.extraOrigins ?? process.env.PRIVATE_HUB_ALLOWED_ORIGINS ?? "",
  );
  const pairing = new PairingStore(options.pairingOptions);
  const rate = new RateLimiter(limits.rateLimitPerMinute);
  const ledger = new RequestLedger();
  const work = new WorkLimiter(limits);
  const active = new Map();
  const testMode = options.testMode ?? process.env.PRIVATE_HUB_TEST_MODE === "1";
  const runtimeDir = options.runtimeDir
    || process.env.NOVEL_PRIVATE_HUB_RUNTIME_DIR
    || path.join(process.env.LOCALAPPDATA || os.homedir(), "NovelPrivateHub");
  const pairingFile = options.pairingFile
    ?? process.env.PRIVATE_HUB_PAIRING_FILE
    ?? path.join(runtimeDir, "pairing.json");
  const accessLogPath = options.accessLogPath
    ?? process.env.PRIVATE_HUB_ACCESS_LOG
    ?? path.join(runtimeDir, "access.jsonl");
  const modelRoot = path.join(runtimeDir, "preference-models");
  const cache = options.cacheStore ?? new EncryptedPrivateHubCacheStore({
    directory: options.cacheDirectory
      || process.env.NOVEL_PRIVATE_HUB_CACHE_DIR
      || path.join(runtimeDir, "cache", "entries"),
    keyPath: options.cacheKeyPath
      || process.env.NOVEL_PRIVATE_HUB_CACHE_KEY_FILE
      || path.join(runtimeDir, "cache", "cache.key"),
  });
  const logs = [];
  const accessLogs = [];

  async function ensureRuntime() {
    await mkdir(modelRoot, { recursive: true });
    await cache.initialize();
  }

  async function publishPairingCode(pending, origin) {
    await ensureRuntime();
    await writeFile(
      pairingFile,
      JSON.stringify({
        pairingId: pending.pairingId,
        code: pending.code,
        expiresAt: pending.expiresAt,
        origin,
        instanceId: pairing.instanceId,
      }),
      { mode: 0o600 },
    );
  }

  async function clearPairingCode() {
    await rm(pairingFile, { force: true }).catch(() => undefined);
  }

  function projectDirectory(projectId) {
    return path.join(modelRoot, sha256(projectId));
  }

  function modelPath(projectId, modelId) {
    return path.join(projectDirectory(projectId), `${sha256(modelId)}.json`);
  }

  async function readTrainingModel(projectId, modelId) {
    try {
      const artifact = JSON.parse(await readFile(modelPath(projectId, modelId), "utf8"));
      if (!verifyOfflinePreferenceModel(artifact)) {
        throw new BridgeError(
          "LOCAL_SECURITY_POLICY_VIOLATION",
          "Stored preference model failed digest verification.",
          409,
        );
      }
      if (artifact.projectId !== projectId || artifact.modelId !== modelId) {
        throw new BridgeError(
          "LOCAL_REQUEST_IDENTITY_MISMATCH",
          "Preference model identity does not match its storage scope.",
          409,
        );
      }
      return artifact;
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      throw new BridgeError("OLLAMA_MODEL_NOT_FOUND", "Preference model was not found.", 404);
    }
  }

  async function activeTrainingRecord(projectId) {
    try {
      const record = JSON.parse(
        await readFile(path.join(projectDirectory(projectId), "active.json"), "utf8"),
      );
      if (!record?.modelId || !record?.artifactDigest) return null;
      const artifact = await readTrainingModel(projectId, record.modelId);
      if (artifact.artifactDigest !== record.artifactDigest) {
        throw new BridgeError(
          "LOCAL_SECURITY_POLICY_VIOLATION",
          "Active preference model pointer failed digest verification.",
          409,
        );
      }
      return { record, artifact };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error instanceof BridgeError) throw error;
      return null;
    }
  }

  async function listTrainingModels(projectId) {
    const directory = projectDirectory(projectId);
    const activeRecord = await activeTrainingRecord(projectId);
    const names = await readdir(directory).catch(() => []);
    const models = [];
    for (const name of names.filter((value) => value.endsWith(".json") && value !== "active.json")) {
      try {
        const artifact = JSON.parse(await readFile(path.join(directory, name), "utf8"));
        if (verifyOfflinePreferenceModel(artifact) && artifact.projectId === projectId) {
          models.push(safeTrainingModel(
            artifact,
            activeRecord?.artifact.modelId === artifact.modelId,
          ));
        }
      } catch {
        // Invalid artifacts are omitted instead of being loaded.
      }
    }
    return models.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  function log(record) {
    const sanitized = {
      requestId: record.requestId ?? null,
      taskType: record.taskType ?? null,
      provider: "private-ai-hub",
      modelId: record.modelId ?? null,
      adapterId: record.adapterId ?? null,
      elapsedMs: record.elapsedMs ?? null,
      status: record.status,
      errorCode: record.errorCode ?? null,
    };
    logs.push(sanitized);
    if (logs.length > 200) logs.shift();
    if (!testMode) process.stdout.write(`${JSON.stringify(sanitized)}\n`);
  }

  async function probeOllama() {
    try {
      const [versionResponse, tagsResponse] = await Promise.all([
        ollamaFetch(ollamaEndpoint, "/api/version", { method: "GET" }, 2_000),
        ollamaFetch(ollamaEndpoint, "/api/tags", { method: "GET" }, 2_000),
      ]);
      const version = await versionResponse.json();
      const tags = await tagsResponse.json();
      return {
        reachable: true,
        version: version.version ?? null,
        models: Array.isArray(tags.models) ? tags.models.map(modelProfileFromTag) : [],
      };
    } catch (error) {
      return {
        reachable: false,
        version: null,
        models: [],
        errorCode: error.code || "OLLAMA_UNREACHABLE",
      };
    }
  }

  function authenticate(request, origin, requireCsrf = request.method !== "GET") {
    return pairing.authorize(origin, bearer(request), request.headers["x-hub-csrf"], {
      requireCsrf,
    });
  }

  const server = http.createServer(async (request, response) => {
    let origin;
    let requestErrorCode = null;
    const accessRecord = {
      timestamp: new Date().toISOString(),
      method: request.method || null,
      path: String(request.url || "/").split("?", 1)[0],
      host: String(request.headers.host || ""),
      origin: String(request.headers.origin || ""),
      remoteLoopback: ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        String(request.socket.remoteAddress || ""),
      ),
    };
    response.once("finish", () => {
      const row = {
        ...accessRecord,
        status: response.statusCode,
        errorCode: requestErrorCode,
      };
      accessLogs.push(row);
      if (accessLogs.length > 500) accessLogs.shift();
      if (accessLogPath) {
        void appendFile(accessLogPath, `${JSON.stringify(row)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        }).catch(() => undefined);
      }
    });
    try {
      validateHostHeader(request.headers.host, port);
      origin = assertOrigin(request.headers.origin, allowlist);
      if (request.method === "OPTIONS") {
        const requestedHeaders = String(
          request.headers["access-control-request-headers"] || "",
        ).toLowerCase();
        const requestedMethod = String(
          request.headers["access-control-request-method"] || "GET",
        ).toUpperCase();
        if (
          !requestedHeaders.includes("x-private-hub-protocol")
          || (requestedMethod === "POST" && !requestedHeaders.includes("content-type"))
        ) {
          throw new BridgeError(
            "CORS_PREFLIGHT_REJECTED",
            "Preflight does not request required private hub headers.",
            403,
          );
        }
        const privateNetworkRequested = String(
          request.headers["access-control-request-private-network"] || "",
        ).toLowerCase() === "true";
        response.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin, Access-Control-Request-Private-Network",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Private-Hub-Protocol,X-Hub-CSRF,Idempotency-Key",
          ...(privateNetworkRequested ? { "Access-Control-Allow-Private-Network": "true" } : {}),
          "Access-Control-Max-Age": "300",
        });
        response.end();
        return;
      }
      rate.take(origin);
      assertProtocol(request.headers["x-private-hub-protocol"]);
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.searchParams.has("token") || url.searchParams.has("authorization")) {
        throw new BridgeError(
          "LOCAL_SECURITY_POLICY_VIOLATION",
          "Credentials are not accepted in URLs.",
          400,
        );
      }

      if (request.method === "GET" && url.pathname === "/health") {
        const ollama = await probeOllama();
        const state = pairing.state();
        const modelAvailable = ollama.models.some(
          (item) => item.capabilities.textGeneration.value,
        );
        return sendJson(response, 200, {
          hubProcessAlive: true,
          hubVersion: PRIVATE_HUB_VERSION,
          protocolVersion: PRIVATE_HUB_PROTOCOL,
          instanceId: pairing.instanceId,
          providerKind: "private_ai_hub",
          deploymentKind: "self_hosted_loopback_private_node",
          operatingSystem: `${os.platform()} ${os.release()}`,
          supportedOperations: [
            "health",
            "pairing",
            "models",
            "model-verify",
            "jobs",
            "stream",
            "cancel",
            "offline-preference-training",
            "adapter-activation",
            "rollback",
            "cache-stats",
            "targeted-cache-invalidation",
          ],
          streamingSupport: true,
          cancellationSupport: true,
          trainingSupport: "offline_preference_adapter",
          loraTrainingSupport: "hardware_gate_required",
          maximumRequestSize: limits.maxPromptBytes,
          configuredOrigins: [...allowlist],
          securityMode: "loopback-private-node-paired",
          bindAddress: host,
          pairingState: state,
          modelRuntimeReachable: ollama.reachable,
          modelRuntimeVersion: ollama.version,
          modelAvailable,
          runtimeReady: state === "paired" && ollama.reachable && modelAvailable,
          externalRequest: false,
          dataLeftDevice: false,
          cache: await cache.stats(),
          limits,
        }, origin);
      }

      if (request.method === "POST" && url.pathname === "/pair/request") {
        await readJson(request, 1_024);
        const pending = pairing.request(origin);
        await publishPairingCode(pending, origin);
        return sendJson(response, 201, {
          pairingId: pending.pairingId,
          expiresAt: pending.expiresAt,
          state: pending.state,
          instanceId: pairing.instanceId,
          protocolVersion: PRIVATE_HUB_PROTOCOL,
          ...(testMode ? { testCode: pending.code } : {}),
        }, origin);
      }

      if (request.method === "POST" && url.pathname === "/pair/confirm") {
        const body = await readJson(request, 2_048);
        const session = pairing.confirm(
          String(body.pairingId || ""),
          String(body.code || ""),
          origin,
        );
        await clearPairingCode();
        return sendJson(response, 200, session, origin);
      }

      if (request.method === "POST" && url.pathname === "/pair/revoke") {
        const body = await readJson(request, 1_024);
        if (body.confirm !== true) {
          throw new BridgeError(
            "OLLAMA_REQUEST_REJECTED",
            "Revocation confirmation is required.",
            400,
          );
        }
        return sendJson(
          response,
          200,
          pairing.revoke(origin, bearer(request), request.headers["x-hub-csrf"]),
          origin,
        );
      }

      if (request.method === "GET" && url.pathname === "/cache/stats") {
        authenticate(request, origin, false);
        return sendJson(response, 200, { cache: await cache.stats() }, origin);
      }

      if (request.method === "POST" && url.pathname === "/cache/invalidate") {
        authenticate(request, origin);
        const body = await readJson(request, 16_384);
        let invalidatedEntries;
        try {
          invalidatedEntries = await cache.invalidate(body);
        } catch (error) {
          throw cacheRequestError(error);
        }
        return sendJson(response, 200, {
          status: "completed",
          targeted: true,
          invalidatedEntries,
          canonicalMutationCount: 0,
        }, origin);
      }

      if (request.method === "GET" && url.pathname === "/models") {
        authenticate(request, origin, false);
        const result = await probeOllama();
        if (!result.reachable) {
          throw new BridgeError(
            result.errorCode || "OLLAMA_UNREACHABLE",
            "Private Hub model discovery failed.",
            503,
            true,
          );
        }
        return sendJson(response, 200, {
          providerKind: "private_ai_hub",
          models: result.models,
        }, origin);
      }

      if (request.method === "POST" && url.pathname === "/model/verify") {
        authenticate(request, origin);
        const body = await readJson(request, 2_048);
        const modelId = validModelId(String(body.model || ""));
        const tagsResponse = await ollamaFetch(
          ollamaEndpoint,
          "/api/tags",
          { method: "GET" },
          5_000,
        );
        const tags = await tagsResponse.json();
        const tag = (tags.models || []).find(
          (item) => (item.model || item.name) === modelId,
        );
        if (!tag) throw new BridgeError("OLLAMA_MODEL_NOT_FOUND", "Model is not installed.", 404);
        const profile = modelProfileFromTag(tag);
        if (profile.capabilities.textGeneration.value !== true) {
          throw new BridgeError(
            "OLLAMA_REQUEST_REJECTED",
            "Selected model cannot generate text.",
            400,
          );
        }
        const startedAt = performance.now();
        const verifyResponse = await ollamaFetch(ollamaEndpoint, "/api/generate", {
          method: "POST",
          body: JSON.stringify({
            model: modelId,
            prompt: "這是私有 AI Hub 模型啟動驗證。請只回覆四個字：中樞就緒",
            system: "You are a private runtime health verifier. Follow the fixed instruction only.",
            stream: false,
            keep_alive: "10m",
            options: { temperature: 0, seed: 11, num_predict: 16 },
          }),
        }, 45_000);
        const verifyBody = await verifyResponse.json().catch(() => null);
        const output = String(verifyBody?.response || "").trim();
        if (!output) {
          throw new BridgeError(
            "LOCAL_MODEL_INFERENCE_NOT_VERIFIED",
            "Private Hub model returned no verification output.",
            502,
            true,
          );
        }
        return sendJson(response, 200, {
          proofVersion: "private-hub-model-inference-proof-v1",
          state: "inference_verified",
          providerKind: "private_ai_hub",
          deploymentKind: "self_hosted_loopback_private_node",
          instanceId: pairing.instanceId,
          modelId,
          modelDigest: profile.modelDigest,
          verifiedAt: new Date().toISOString(),
          latencyMs: Math.round(performance.now() - startedAt),
          outputDigest: sha256(output),
          outputBytes: Buffer.byteLength(output, "utf8"),
          evalCount: Number(verifyBody?.eval_count) || null,
          externalRequest: false,
          dataLeftDevice: false,
        }, origin);
      }

      if (request.method === "POST" && url.pathname === "/training/train") {
        authenticate(request, origin);
        const body = await readJson(request, limits.maxTrainingBytes);
        if (body.confirmOfflineTraining !== true) {
          throw new BridgeError(
            "LOCAL_SECURITY_POLICY_VIOLATION",
            "Explicit offline training confirmation is required.",
            403,
          );
        }
        const projectId = validProjectId(body.projectId);
        const startedAt = performance.now();
        const artifact = trainOfflinePreferenceModel({
          projectId,
          baseModelId: String(body.baseModelId || "runtime-selected"),
          datasetVersion: String(body.datasetVersion || "local-approved-v1"),
          samples: body.samples,
          epochs: body.hyperparameters?.epochs,
          learningRate: body.hyperparameters?.learningRate,
          l2: body.hyperparameters?.l2,
        });
        const directory = projectDirectory(projectId);
        await mkdir(directory, { recursive: true });
        await writeFile(
          modelPath(projectId, artifact.modelId),
          JSON.stringify(artifact, null, 2),
          { encoding: "utf8", mode: 0o600 },
        );
        log({
          requestId: `training:${artifact.artifactDigest.slice(0, 16)}`,
          taskType: "offline.preference.train",
          modelId: artifact.baseModelId,
          adapterId: artifact.modelId,
          elapsedMs: Math.round(performance.now() - startedAt),
          status: "completed",
        });
        return sendJson(response, 201, {
          ...safeTrainingModel(artifact, false),
          trainingCompleted: true,
          activationRequired: true,
          elapsedMs: Math.round(performance.now() - startedAt),
        }, origin);
      }

      if (request.method === "POST" && url.pathname === "/training/list") {
        authenticate(request, origin);
        const body = await readJson(request, 2_048);
        const projectId = validProjectId(body.projectId);
        return sendJson(response, 200, {
          projectId,
          models: await listTrainingModels(projectId),
        }, origin);
      }

      if (request.method === "POST" && url.pathname === "/training/verify") {
        authenticate(request, origin);
        const body = await readJson(request, 2_048);
        const projectId = validProjectId(body.projectId);
        const modelId = String(body.modelId || "");
        const artifact = await readTrainingModel(projectId, modelId);
        const activeRecord = await activeTrainingRecord(projectId);
        return sendJson(response, 200, {
          ...safeTrainingModel(artifact, activeRecord?.artifact.modelId === modelId),
          verificationState: "artifact_verified",
        }, origin);
      }

      if (request.method === "POST" && url.pathname === "/training/activate") {
        authenticate(request, origin);
        const body = await readJson(request, 2_048);
        if (body.confirmActivation !== true) {
          throw new BridgeError(
            "LOCAL_SECURITY_POLICY_VIOLATION",
            "Explicit adapter activation confirmation is required.",
            403,
          );
        }
        const projectId = validProjectId(body.projectId);
        const modelId = String(body.modelId || "");
        const artifact = await readTrainingModel(projectId, modelId);
        const previous = await activeTrainingRecord(projectId);
        const record = {
          schemaVersion: "novel-offline-preference-activation-v1",
          projectId,
          modelId,
          artifactDigest: artifact.artifactDigest,
          previousModelId: previous?.artifact.modelId ?? null,
          activatedAt: new Date().toISOString(),
          rollbackAvailable: Boolean(previous?.artifact.modelId),
          humanApproved: true,
        };
        await writeFile(
          path.join(projectDirectory(projectId), "active.json"),
          JSON.stringify(record, null, 2),
          { encoding: "utf8", mode: 0o600 },
        );
        let invalidatedEntries = 0;
        let cacheInvalidationStatus = "completed";
        try {
          invalidatedEntries = await cache.invalidate({ projectId });
        } catch {
          cacheInvalidationStatus = "model_digest_namespace_protected";
        }
        return sendJson(response, 200, {
          ...record,
          state: "active",
          invalidatedEntries,
          cacheInvalidationStatus,
          externalRequest: false,
          dataLeftDevice: false,
        }, origin);
      }

      if (request.method === "POST" && url.pathname === "/training/rollback") {
        authenticate(request, origin);
        const body = await readJson(request, 2_048);
        if (body.confirmRollback !== true) {
          throw new BridgeError(
            "LOCAL_SECURITY_POLICY_VIOLATION",
            "Explicit rollback confirmation is required.",
            403,
          );
        }
        const projectId = validProjectId(body.projectId);
        const current = await activeTrainingRecord(projectId);
        if (!current?.record.previousModelId) {
          throw new BridgeError(
            "OLLAMA_MODEL_NOT_FOUND",
            "No previous preference model is available for rollback.",
            404,
          );
        }
        const previous = await readTrainingModel(projectId, current.record.previousModelId);
        const record = {
          schemaVersion: "novel-offline-preference-activation-v1",
          projectId,
          modelId: previous.modelId,
          artifactDigest: previous.artifactDigest,
          previousModelId: current.artifact.modelId,
          activatedAt: new Date().toISOString(),
          rollbackAvailable: true,
          humanApproved: true,
          rollbackFrom: current.artifact.modelId,
        };
        await writeFile(
          path.join(projectDirectory(projectId), "active.json"),
          JSON.stringify(record, null, 2),
          { encoding: "utf8", mode: 0o600 },
        );
        let invalidatedEntries = 0;
        let cacheInvalidationStatus = "completed";
        try {
          invalidatedEntries = await cache.invalidate({ projectId });
        } catch {
          cacheInvalidationStatus = "model_digest_namespace_protected";
        }
        return sendJson(response, 200, {
          ...record,
          state: "rolled_back",
          invalidatedEntries,
          cacheInvalidationStatus,
        }, origin);
      }

      if (request.method === "POST" && url.pathname === "/cancel") {
        authenticate(request, origin);
        const body = await readJson(request, 2_048);
        const controller = active.get(String(body.requestId || ""));
        if (!controller) {
          throw new BridgeError("OLLAMA_CANCELLED", "Private Hub job is not active.", 404);
        }
        controller.abort("cancelled");
        return sendJson(response, 202, {
          requestId: body.requestId,
          state: "cancelled",
        }, origin);
      }

      if (request.method === "POST" && url.pathname === "/generate") {
        authenticate(request, origin);
        const body = await readJson(request, limits.maxPromptBytes + 16_384);
        const requestId = String(body.requestId || request.headers["idempotency-key"] || "");
        const projectId = validProjectId(body.projectId);
        const modelId = validModelId(String(body.model || ""));
        const prompt = Array.isArray(body.messages)
          ? body.messages.map((item) => `${item.role}: ${item.content}`).join("\n")
          : String(body.prompt || "");
        if (!requestId || !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
          throw new BridgeError(
            "OLLAMA_REQUEST_REJECTED",
            "A structured request ID is required.",
            400,
          );
        }
        if (Buffer.byteLength(prompt, "utf8") > limits.maxPromptBytes) {
          throw new BridgeError(
            "LOCAL_REQUEST_TOO_LARGE",
            "Prompt exceeds the private hub limit.",
            413,
          );
        }
        const maxTokens = Math.min(
          Number(body.options?.num_predict || limits.maxOutputTokens),
          limits.maxOutputTokens,
        );
        const timeoutMs = Math.min(
          Math.max(Number(body.timeoutMs || 180_000), 100),
          limits.maxTimeoutMs,
        );
        let cacheNamespace = null;
        try {
          cacheNamespace = body.cacheNamespace
            ? assertRuntimeCacheNamespace(body.cacheNamespace)
            : null;
        } catch (error) {
          throw cacheRequestError(error);
        }
        if (
          cacheNamespace
          && (
            cacheNamespace.projectId !== projectId
            || cacheNamespace.modelId !== modelId
          )
        ) {
          throw new BridgeError(
            "LOCAL_REQUEST_IDENTITY_MISMATCH",
            "Private Hub cache namespace does not match the request identity.",
            409,
          );
        }
        if (cacheNamespace?.privacyLevel === "device_only") {
          throw new BridgeError(
            "LOCAL_SECURITY_POLICY_VIOLATION",
            "Device-only cache scope cannot be sent to Private Hub.",
            403,
          );
        }
        const generationCacheInput = {
          prompt,
          systemInstruction: String(body.systemInstruction || ""),
          taskType: String(body.taskType || "unknown"),
          modelId,
          options: body.options || {},
          maxTokens,
        };
        const tagsResponse = await ollamaFetch(
          ollamaEndpoint,
          "/api/tags",
          { method: "GET" },
          5_000,
        );
        const tags = await tagsResponse.json();
        const selectedModel = (tags.models || []).find(
          (item) => (item.model || item.name) === modelId,
        );
        if (!selectedModel) {
          throw new BridgeError("OLLAMA_MODEL_NOT_FOUND", "Model is not installed.", 404);
        }
        const activeRecord = await activeTrainingRecord(projectId);
        const activeAdapter = activeRecord
          ? preferenceModelGuidance(activeRecord.artifact)
          : null;
        const activeModelDigest = sha256([
          selectedModel.digest || "unknown-model-digest",
          activeAdapter?.adapterDigest || "no-active-adapter",
        ].join("|"));
        if (
          cacheNamespace
          && cacheNamespace.modelDigest !== activeModelDigest
        ) {
          throw new BridgeError(
            "LOCAL_REQUEST_IDENTITY_MISMATCH",
            "Private Hub cache namespace model digest is not the active model identity.",
            409,
          );
        }
        const cached = cacheNamespace
          ? await cache.get("exact", cacheNamespace, generationCacheInput)
          : { hit: false, entry: null };
        if (cached.hit && cached.entry?.value?.content) {
          const cachedValue = cached.entry.value;
          response.writeHead(200, {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": origin,
            Vary: "Origin",
            "X-Content-Type-Options": "nosniff",
          });
          response.write(`${JSON.stringify({
            type: "started",
            requestId,
            modelId,
            adapterId: cachedValue.adapterId ?? null,
            adapterDigest: cachedValue.adapterDigest ?? null,
            cacheHit: true,
          })}\n`);
          response.write(`${JSON.stringify({
            type: "token",
            text: cachedValue.content,
            cacheHit: true,
          })}\n`);
          response.write(`${JSON.stringify({
            type: "metadata",
            ...(cachedValue.metadata || {}),
            cacheHit: true,
          })}\n`);
          response.write(`${JSON.stringify({
            type: "completed",
            requestId,
            cacheHit: true,
          })}\n`);
          response.end();
          log({
            requestId,
            taskType: body.taskType,
            modelId,
            adapterId: cachedValue.adapterId ?? null,
            elapsedMs: 0,
            status: "completed",
            cacheHit: true,
            errorCode: null,
          });
          return;
        }
        ledger.begin(requestId, JSON.stringify({
          origin,
          projectId,
          modelId,
          promptHash: sha256(prompt),
          taskType: body.taskType || "unknown",
        }));
        const release = await work.acquire();
        const controller = new AbortController();
        const totalTimer = setTimeout(() => controller.abort("timeout"), timeoutMs);
        active.set(requestId, controller);
        const startedAt = performance.now();
        let status = "failed";
        try {
          const systemInstruction = [
            String(body.systemInstruction || "Write in Traditional Chinese."),
            "This is a self-hosted private AI node. Return candidate content only.",
            activeAdapter?.text || "",
          ].filter(Boolean).join("\n\n");
          const upstream = await ollamaFetch(ollamaEndpoint, "/api/generate", {
            method: "POST",
            body: JSON.stringify({
              model: modelId,
              prompt,
              system: systemInstruction,
              stream: true,
              keep_alive: "10m",
              options: { ...(body.options || {}), num_predict: maxTokens },
            }),
          }, timeoutMs, controller);
          response.writeHead(200, {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": origin,
            Vary: "Origin",
            "X-Content-Type-Options": "nosniff",
          });
          response.write(`${JSON.stringify({
            type: "started",
            requestId,
            modelId,
            adapterId: activeAdapter?.adapterId ?? null,
            adapterDigest: activeAdapter?.adapterDigest ?? null,
          })}\n`);
          const reader = upstream.body?.getReader();
          if (!reader) {
            throw new BridgeError(
              "OLLAMA_INVALID_RESPONSE",
              "Private Hub model response has no stream.",
              502,
            );
          }
          const decoder = new TextDecoder();
          let buffer = "";
          let tokenCount = 0;
          let metadata = {};
          let generatedContent = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.trim()) continue;
              let item;
              try {
                item = JSON.parse(line);
              } catch {
                throw new BridgeError(
                  "OLLAMA_INVALID_RESPONSE",
                  "Private Hub model returned invalid stream JSON.",
                  502,
                );
              }
              if (item.response) {
                tokenCount += 1;
                generatedContent += item.response;
                response.write(`${JSON.stringify({ type: "token", text: item.response })}\n`);
              }
              if (item.done) {
                metadata = {
                  totalDuration: item.total_duration ?? null,
                  loadDuration: item.load_duration ?? null,
                  promptEvalCount: item.prompt_eval_count ?? null,
                  evalCount: item.eval_count ?? null,
                };
              }
            }
          }
          if (cacheNamespace && generatedContent) {
            await cache.put({
              layer: "exact",
              namespace: cacheNamespace,
              input: generationCacheInput,
              value: {
                content: generatedContent,
                modelId,
                adapterId: activeAdapter?.adapterId ?? null,
                adapterDigest: activeAdapter?.adapterDigest ?? null,
                metadata,
              },
              tags: ["generation", `task:${body.taskType || "unknown"}`],
            });
            await cache.put({
              layer: "model-session",
              namespace: cacheNamespace,
              input: {
                storyId: cacheNamespace.storyId,
                branchId: cacheNamespace.branchId,
                modelId,
              },
              value: {
                runtime: "private-ollama",
                modelId,
                adapterId: activeAdapter?.adapterId ?? null,
                keepAlive: "10m",
                stateKind: "encrypted_runtime_handle_metadata_only",
              },
              ttlMs: 10 * 60_000,
              tags: ["gpu-session", "model-session"],
            });
          }
          response.write(`${JSON.stringify({
            type: "metadata",
            tokenEvents: tokenCount,
            adapterId: activeAdapter?.adapterId ?? null,
            adapterDigest: activeAdapter?.adapterDigest ?? null,
            ...metadata,
          })}\n`);
          response.write(`${JSON.stringify({ type: "completed", requestId })}\n`);
          response.end();
          status = "completed";
        } catch (error) {
          const effective = controller.signal.aborted
            ? new BridgeError(
              controller.signal.reason === "cancelled" ? "OLLAMA_CANCELLED" : "OLLAMA_TIMEOUT",
              controller.signal.reason === "cancelled"
                ? "Private Hub generation was cancelled."
                : "Private Hub generation timed out.",
              408,
              true,
            )
            : error;
          status = effective.code === "OLLAMA_CANCELLED" ? "cancelled" : "failed";
          if (!response.headersSent) {
            sendJson(response, effective.status || 500, {
              errorCode: effective.code || "OLLAMA_INVALID_RESPONSE",
              message: effective.message,
              retryable: Boolean(effective.retryable),
              requestId,
            }, origin);
          } else {
            response.write(`${JSON.stringify({
              type: status,
              errorCode: effective.code || "OLLAMA_STREAM_INTERRUPTED",
              message: effective.message,
            })}\n`);
            response.end();
          }
        } finally {
          clearTimeout(totalTimer);
          active.delete(requestId);
          release();
          ledger.finish(requestId, status);
          log({
            requestId,
            taskType: body.taskType,
            modelId,
            adapterId: activeAdapter?.adapterId ?? null,
            elapsedMs: Math.round(performance.now() - startedAt),
            status,
            errorCode: status === "completed"
              ? null
              : status === "cancelled"
                ? "OLLAMA_CANCELLED"
                : "OLLAMA_STREAM_INTERRUPTED",
          });
        }
        return;
      }

      throw new BridgeError("OLLAMA_REQUEST_REJECTED", "Route not found.", 404);
    } catch (error) {
      const hubError = error instanceof BridgeError
        ? error
        : new BridgeError(
          "OLLAMA_INVALID_RESPONSE",
          "Private Hub request failed.",
          500,
        );
      requestErrorCode = hubError.code;
      if (!response.headersSent) {
        sendJson(response, hubError.status, {
          errorCode: hubError.code,
          message: hubError.message,
          retryable: hubError.retryable,
          details: hubError.details,
        }, origin);
      } else {
        response.end();
      }
    }
  });

  server.on("clientError", (_error, socket) =>
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));

  return {
    server,
    config: {
      host,
      port,
      ollamaEndpoint,
      limits,
      allowlist: [...allowlist],
      instanceId: pairing.instanceId,
      runtimeDir,
    },
    pairing,
    cache,
    logs,
    accessLogs,
    active,
    async start() {
      await ensureRuntime();
      if (accessLogPath) await writeFile(accessLogPath, "", { mode: 0o600 });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return this;
    },
    async stop() {
      for (const controller of active.values()) controller.abort("cancelled");
      await clearPairingCode();
      server.closeIdleConnections?.();
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hub = createPrivateHubServer();
  hub.start()
    .then(() => process.stdout.write(`${JSON.stringify({
      event: "private_hub_started",
      protocol: PRIVATE_HUB_PROTOCOL,
      host: hub.config.host,
      port: hub.config.port,
      instanceId: hub.config.instanceId,
    })}\n`))
    .catch((error) => {
      process.stderr.write(`${error.code || "PRIVATE_HUB_START_FAILED"}: ${error.message}\n`);
      process.exitCode = 1;
    });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => hub.stop().finally(() => process.exit(0)));
  }
}
