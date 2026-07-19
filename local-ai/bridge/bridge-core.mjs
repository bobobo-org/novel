import crypto from "node:crypto";

export const BRIDGE_PROTOCOL = "novel-local-bridge/v1";
export const BRIDGE_VERSION = "1.0.0-phase1";
export const DEFAULT_LIMITS = Object.freeze({ maxPromptBytes: 65_536, maxOutputTokens: 2_048, maxConcurrent: 1, maxQueue: 2, maxTimeoutMs: 120_000, rateLimitPerMinute: 30 });
export const ERROR_CODES = Object.freeze([
  "BRIDGE_NOT_RUNNING", "BRIDGE_NOT_PAIRED", "BRIDGE_PAIRING_EXPIRED", "BRIDGE_PAIRING_REVOKED", "BRIDGE_ORIGIN_NOT_ALLOWED", "BRIDGE_PROTOCOL_INCOMPATIBLE",
  "OLLAMA_NOT_RUNNING", "OLLAMA_UNREACHABLE", "OLLAMA_MODEL_NOT_FOUND", "OLLAMA_MODEL_LOAD_FAILED", "OLLAMA_REQUEST_REJECTED", "OLLAMA_TIMEOUT", "OLLAMA_STREAM_INTERRUPTED", "OLLAMA_CANCELLED", "OLLAMA_INVALID_RESPONSE", "OLLAMA_CONTEXT_LIMIT_EXCEEDED",
  "LOCAL_REQUEST_TOO_LARGE", "LOCAL_PROVIDER_NOT_READY", "LOCAL_SECURITY_POLICY_VIOLATION", "LOCAL_RATE_LIMITED", "LOCAL_CONCURRENCY_LIMIT", "LOCAL_DUPLICATE_REQUEST", "LOCAL_REQUEST_IDENTITY_MISMATCH",
]);

export class BridgeError extends Error {
  constructor(code, message, status = 400, retryable = false, details = undefined) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function validateLoopbackHost(host) {
  const normalized = String(host || "").toLowerCase();
  if (!["127.0.0.1", "::1"].includes(normalized)) throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "Bridge must bind to a loopback address.", 500);
  return normalized;
}

export function validateHostHeader(hostHeader, port) {
  const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!allowed.has(String(hostHeader || "").toLowerCase())) throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "Host header is not a loopback bridge address.", 403);
}

export function normalizeOllamaEndpoint(value = "http://127.0.0.1:11434") {
  let url;
  try { url = new URL(value); } catch { throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "Invalid Ollama endpoint.", 500); }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "11434" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "Ollama endpoint must be exactly http://127.0.0.1:11434.", 500);
  }
  return url.origin;
}

export function buildOriginAllowlist(extra = "") {
  const defaults = ["https://novel-orcin.vercel.app", "http://localhost:3000", "http://127.0.0.1:3000"];
  const additions = String(extra).split(",").map((item) => item.trim()).filter(Boolean);
  for (const value of additions) {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    if ((!local && url.protocol !== "https:") || (local && !["http:", "https:"].includes(url.protocol)) || url.pathname !== "/" || url.search || url.hash) {
      throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", `Unsafe configured origin: ${value}`, 500);
    }
  }
  return new Set([...defaults, ...additions]);
}

export function assertOrigin(origin, allowlist) {
  if (!origin || !allowlist.has(origin)) throw new BridgeError("BRIDGE_ORIGIN_NOT_ALLOWED", "Origin is not allowed to use this bridge.", 403);
  return origin;
}

export function assertProtocol(value) {
  if (value !== BRIDGE_PROTOCOL) throw new BridgeError("BRIDGE_PROTOCOL_INCOMPATIBLE", `Expected ${BRIDGE_PROTOCOL}.`, 409);
}

const digest = (value) => crypto.createHash("sha256").update(value).digest();
const equalDigest = (left, right) => left.length === right.length && crypto.timingSafeEqual(left, right);

export class PairingStore {
  constructor({ pairingTtlMs = 120_000, sessionTtlMs = 30 * 60_000 } = {}) {
    this.instanceId = crypto.randomUUID();
    this.pairingTtlMs = pairingTtlMs;
    this.sessionTtlMs = sessionTtlMs;
    this.pending = new Map();
    this.sessions = new Map();
    this.revoked = new Set();
  }

  request(origin) {
    const pairingId = crypto.randomUUID();
    const code = crypto.randomInt(100_000, 1_000_000).toString();
    const expiresAt = Date.now() + this.pairingTtlMs;
    this.pending.set(pairingId, { codeHash: digest(`${this.instanceId}:${code}`), origin, expiresAt, used: false });
    return { pairingId, code, expiresAt: new Date(expiresAt).toISOString(), state: "pairing_requested" };
  }

  confirm(pairingId, code, origin) {
    const pending = this.pending.get(pairingId);
    if (!pending) throw new BridgeError("BRIDGE_NOT_PAIRED", "Pairing request was not found.", 401);
    if (pending.used) throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "Pairing code was already used.", 401);
    if (Date.now() > pending.expiresAt) { this.pending.delete(pairingId); throw new BridgeError("BRIDGE_PAIRING_EXPIRED", "Pairing request expired.", 401); }
    if (pending.origin !== origin || !equalDigest(pending.codeHash, digest(`${this.instanceId}:${code}`))) throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "Pairing confirmation is invalid.", 401);
    pending.used = true;
    const token = crypto.randomBytes(32).toString("base64url");
    const csrf = crypto.randomBytes(24).toString("base64url");
    const tokenHash = digest(`${this.instanceId}:${token}`).toString("hex");
    const expiresAt = Date.now() + this.sessionTtlMs;
    this.sessions.set(tokenHash, { origin, csrfHash: digest(`${this.instanceId}:${csrf}`), expiresAt, state: "paired" });
    this.pending.delete(pairingId);
    return { token, csrf, instanceId: this.instanceId, expiresAt: new Date(expiresAt).toISOString(), state: "paired" };
  }

  authorize(origin, token, csrf, { requireCsrf = true } = {}) {
    if (!token) throw new BridgeError("BRIDGE_NOT_PAIRED", "Pairing token is required.", 401);
    const tokenHash = digest(`${this.instanceId}:${token}`).toString("hex");
    if (this.revoked.has(tokenHash)) throw new BridgeError("BRIDGE_PAIRING_REVOKED", "Pairing was revoked.", 401);
    const session = this.sessions.get(tokenHash);
    if (!session) throw new BridgeError("BRIDGE_NOT_PAIRED", "Pairing is not valid for this bridge instance.", 401);
    if (Date.now() > session.expiresAt) { this.sessions.delete(tokenHash); throw new BridgeError("BRIDGE_PAIRING_EXPIRED", "Pairing session expired.", 401); }
    if (session.origin !== origin) throw new BridgeError("BRIDGE_ORIGIN_NOT_ALLOWED", "Pairing belongs to another origin.", 403);
    if (requireCsrf && (!csrf || !equalDigest(session.csrfHash, digest(`${this.instanceId}:${csrf}`)))) throw new BridgeError("LOCAL_SECURITY_POLICY_VIOLATION", "CSRF nonce is invalid.", 403);
    return { tokenHash, session };
  }

  revoke(origin, token, csrf) {
    const { tokenHash } = this.authorize(origin, token, csrf);
    this.sessions.delete(tokenHash);
    this.revoked.add(tokenHash);
    return { state: "revoked" };
  }

  state() {
    const now = Date.now();
    for (const [key, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(key);
    return this.sessions.size ? "paired" : this.pending.size ? "pairing_requested" : this.revoked.size ? "revoked" : "unpaired";
  }
}

export class RateLimiter {
  constructor(limit = DEFAULT_LIMITS.rateLimitPerMinute) { this.limit = limit; this.events = new Map(); }
  take(origin) {
    const cutoff = Date.now() - 60_000;
    const recent = (this.events.get(origin) || []).filter((time) => time > cutoff);
    if (recent.length >= this.limit) throw new BridgeError("LOCAL_RATE_LIMITED", "Origin request rate limit exceeded.", 429, true);
    recent.push(Date.now()); this.events.set(origin, recent);
  }
}

export class RequestLedger {
  constructor(ttlMs = 10 * 60_000) { this.ttlMs = ttlMs; this.records = new Map(); }
  begin(requestId, identity) {
    const now = Date.now();
    for (const [key, value] of this.records) if (now - value.updatedAt > this.ttlMs) this.records.delete(key);
    const identityHash = digest(identity).toString("hex");
    const existing = this.records.get(requestId);
    if (existing) {
      if (existing.identityHash !== identityHash) throw new BridgeError("LOCAL_REQUEST_IDENTITY_MISMATCH", "Request ID was reused with different input.", 409);
      throw new BridgeError("LOCAL_DUPLICATE_REQUEST", `Request already ${existing.status}.`, 409, false, { requestStatus: existing.status });
    }
    this.records.set(requestId, { identityHash, status: "running", updatedAt: now });
  }
  finish(requestId, status) { const record = this.records.get(requestId); if (record) this.records.set(requestId, { ...record, status, updatedAt: Date.now() }); }
}

export class WorkLimiter {
  constructor({ maxConcurrent = 1, maxQueue = 2 } = {}) { this.maxConcurrent = maxConcurrent; this.maxQueue = maxQueue; this.active = 0; this.queue = []; }
  async acquire() {
    if (this.active < this.maxConcurrent) { this.active += 1; return () => this.release(); }
    if (this.queue.length >= this.maxQueue) throw new BridgeError("LOCAL_CONCURRENCY_LIMIT", "Local generation queue is full.", 429, true);
    await new Promise((resolve) => this.queue.push(resolve));
    this.active += 1;
    return () => this.release();
  }
  release() { this.active = Math.max(0, this.active - 1); this.queue.shift()?.(); }
}

export function sanitizeLog(input) {
  return { requestId: input.requestId ?? null, taskType: input.taskType ?? null, provider: "local-ollama", modelId: input.modelId ?? null, elapsedMs: input.elapsedMs ?? null, status: input.status, errorCode: input.errorCode ?? null };
}

export function modelProfileFromTag(tag) {
  const details = tag.details || {};
  const family = String(details.family || "unknown");
  const isEmbedding = family.includes("bert") || String(tag.name || "").includes("embed");
  return {
    modelId: tag.model || tag.name,
    family: { value: family, source: details.family ? "reported" : "unknown" },
    parameterSize: { value: details.parameter_size || null, source: details.parameter_size ? "reported" : "unknown" },
    quantization: { value: details.quantization_level || null, source: details.quantization_level ? "reported" : "unknown" },
    contextLength: { value: Number(details.context_length) || null, source: details.context_length ? "reported" : "unknown" },
    diskSize: tag.size ?? null,
    modifiedAt: tag.modified_at ?? null,
    capabilities: {
      textGeneration: { value: !isEmbedding, source: "inferred" }, chat: { value: null, source: "unknown" }, embeddings: { value: isEmbedding, source: "inferred" },
      toolUse: { value: null, source: "unknown" }, structuredOutput: { value: null, source: "unknown" }, vision: { value: null, source: "unknown" }, streaming: { value: !isEmbedding, source: "configured" },
    },
  };
}
