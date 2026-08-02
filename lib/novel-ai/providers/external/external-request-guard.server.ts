import { createHash } from "node:crypto";

const WINDOW_MS = 10 * 60 * 1_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_RESERVED_OUTPUT_TOKENS_PER_WINDOW = 32_768;
const MAX_ACTIVE_PER_CLIENT = 2;
const MAX_ACTIVE_PER_INSTANCE = 12;
const MAX_BODY_BYTES = 640 * 1_024;

type ClientWindow = {
  windowStartedAt: number;
  requests: number;
  reservedOutputTokens: number;
  active: number;
};

type GuardState = {
  clients: Map<string, ClientWindow>;
  active: number;
  lastPrunedAt: number;
};

type GuardGlobal = typeof globalThis & {
  __novelExternalAIRequestGuard?: GuardState;
};

export const EXTERNAL_AI_REQUEST_POLICY = Object.freeze({
  windowMs: WINDOW_MS,
  maxRequestsPerWindow: MAX_REQUESTS_PER_WINDOW,
  maxReservedOutputTokensPerWindow: MAX_RESERVED_OUTPUT_TOKENS_PER_WINDOW,
  maxActivePerClient: MAX_ACTIVE_PER_CLIENT,
  maxActivePerInstance: MAX_ACTIVE_PER_INSTANCE,
  maxBodyBytes: MAX_BODY_BYTES,
});

export class ExternalAIRequestGuardError extends Error {
  readonly code: string;
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(code: string, message: string, status: number, headers: Record<string, string> = {}) {
    super(message);
    this.name = "ExternalAIRequestGuardError";
    this.code = code;
    this.status = status;
    this.headers = headers;
  }
}

function state(): GuardState {
  const target = globalThis as GuardGlobal;
  target.__novelExternalAIRequestGuard ??= {
    clients: new Map(),
    active: 0,
    lastPrunedAt: 0,
  };
  return target.__novelExternalAIRequestGuard;
}

function canonicalOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function assertExternalAIRequestOrigin(request: Request) {
  const expectedOrigin = new URL(request.url).origin;
  const suppliedOrigin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  const observedOrigin = suppliedOrigin
    ? canonicalOrigin(suppliedOrigin)
    : referer
      ? canonicalOrigin(referer)
      : "";

  if (!observedOrigin || observedOrigin !== expectedOrigin || (fetchSite && fetchSite !== "same-origin")) {
    throw new ExternalAIRequestGuardError(
      "EXTERNAL_AI_CROSS_ORIGIN_BLOCKED",
      "基於外接 AI 費用與資料安全，本端點只接受目前網站發出的同源要求。",
      403,
    );
  }
}

export async function readExternalAIJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/json")) {
    throw new ExternalAIRequestGuardError(
      "EXTERNAL_AI_JSON_REQUIRED",
      "外接 AI 要求必須使用 application/json。",
      415,
    );
  }
  const announcedLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(announcedLength) && announcedLength > MAX_BODY_BYTES) {
    throw new ExternalAIRequestGuardError(
      "EXTERNAL_AI_REQUEST_TOO_LARGE",
      "外接 AI 要求內容過大，請縮小章節或檢索範圍。",
      413,
    );
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new ExternalAIRequestGuardError(
      "EXTERNAL_AI_REQUEST_TOO_LARGE",
      "外接 AI 要求內容過大，請縮小章節或檢索範圍。",
      413,
    );
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON_OBJECT_REQUIRED");
    return parsed as Record<string, unknown>;
  } catch {
    throw new ExternalAIRequestGuardError("INVALID_JSON", "要求不是有效的 JSON 物件。", 400);
  }
}

export function externalAIClientIdentifier(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const network = forwarded || request.headers.get("x-real-ip")?.trim() || "local";
  const browser = request.headers.get("user-agent")?.slice(0, 256) || "unknown";
  const language = request.headers.get("accept-language")?.slice(0, 64) || "unknown";
  return `novel_${createHash("sha256").update(`${network}\n${browser}\n${language}`).digest("hex").slice(0, 32)}`;
}

function pruneGuardState(current: GuardState, now: number) {
  if (now - current.lastPrunedAt < 60_000) return;
  current.lastPrunedAt = now;
  for (const [key, value] of current.clients) {
    if (value.active === 0 && now - value.windowStartedAt >= WINDOW_MS * 2) current.clients.delete(key);
  }
}

function rateHeaders(window: ClientWindow) {
  return {
    "X-RateLimit-Limit": String(MAX_REQUESTS_PER_WINDOW),
    "X-RateLimit-Remaining": String(Math.max(0, MAX_REQUESTS_PER_WINDOW - window.requests)),
    "X-RateLimit-Reset": String(Math.ceil((window.windowStartedAt + WINDOW_MS) / 1_000)),
  };
}

export type ExternalAIRequestLease = {
  headers: Record<string, string>;
  release: () => void;
};

export function reserveExternalAIRequest(
  clientId: string,
  requestedOutputTokens: number | undefined,
  now = Date.now(),
): ExternalAIRequestLease {
  const current = state();
  pruneGuardState(current, now);
  const reservedTokens = Math.max(64, Math.min(8_192, Math.round(requestedOutputTokens || 2_048)));
  const window = current.clients.get(clientId) ?? {
    windowStartedAt: now,
    requests: 0,
    reservedOutputTokens: 0,
    active: 0,
  };
  if (now - window.windowStartedAt >= WINDOW_MS) {
    window.windowStartedAt = now;
    window.requests = 0;
    window.reservedOutputTokens = 0;
  }
  current.clients.set(clientId, window);

  const retryAfter = Math.max(1, Math.ceil((window.windowStartedAt + WINDOW_MS - now) / 1_000));
  const headers = rateHeaders(window);
  if (window.active >= MAX_ACTIVE_PER_CLIENT || current.active >= MAX_ACTIVE_PER_INSTANCE) {
    throw new ExternalAIRequestGuardError(
      "EXTERNAL_AI_CONCURRENCY_LIMIT",
      "已有外接 AI 工作正在執行，請等目前工作完成後再試。",
      429,
      { ...headers, "Retry-After": "2" },
    );
  }
  if (window.requests >= MAX_REQUESTS_PER_WINDOW) {
    throw new ExternalAIRequestGuardError(
      "EXTERNAL_AI_RATE_LIMITED",
      "外接 AI 要求過於頻繁，請稍後再試。",
      429,
      { ...headers, "Retry-After": String(retryAfter) },
    );
  }
  if (window.reservedOutputTokens + reservedTokens > MAX_RESERVED_OUTPUT_TOKENS_PER_WINDOW) {
    throw new ExternalAIRequestGuardError(
      "EXTERNAL_AI_TOKEN_BUDGET_EXCEEDED",
      "本時段的外接 AI 生成額度已達安全上限，請稍後再試。",
      429,
      { ...headers, "Retry-After": String(retryAfter) },
    );
  }

  window.requests += 1;
  window.reservedOutputTokens += reservedTokens;
  window.active += 1;
  current.active += 1;
  let released = false;
  return {
    headers: rateHeaders(window),
    release() {
      if (released) return;
      released = true;
      window.active = Math.max(0, window.active - 1);
      current.active = Math.max(0, current.active - 1);
    },
  };
}

export function resetExternalAIRequestGuardForTests() {
  const target = globalThis as GuardGlobal;
  delete target.__novelExternalAIRequestGuard;
}
