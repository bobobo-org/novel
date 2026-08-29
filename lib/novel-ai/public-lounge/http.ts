import {
  PUBLIC_LOUNGE_MAX_REQUEST_BYTES,
  PublicLoungeError,
} from "./contract";
import type { PublicLoungeServiceApi } from "./types";

const SAFE_NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

type RateLimitKind = "read" | "mutation";
type RateLimitEntry = { count: number; resetAt: number };

export class PublicLoungeRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly readLimit: number;
  private readonly mutationLimit: number;
  private readonly now: () => number;

  constructor(options: {
    windowMs?: number;
    readLimit?: number;
    mutationLimit?: number;
    now?: () => number;
  } = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.readLimit = options.readLimit ?? 120;
    this.mutationLimit = options.mutationLimit ?? 6;
    this.now = options.now ?? Date.now;
  }

  reserve(clientId: string, kind: RateLimitKind) {
    const now = this.now();
    const key = `${kind}:${clientId}`;
    const limit = kind === "read" ? this.readLimit : this.mutationLimit;
    const current = this.entries.get(key);
    const entry = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + this.windowMs }
      : current;
    if (entry.count >= limit) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_RATE_LIMITED", 429, true);
    }
    entry.count += 1;
    this.entries.set(key, entry);
    if (this.entries.size > 10_000) {
      for (const [entryKey, value] of this.entries) {
        if (value.resetAt <= now) this.entries.delete(entryKey);
      }
    }
    return {
      limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
    };
  }
}

function lightweightFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function requestClientId(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = request.headers.get("user-agent")?.slice(0, 180) ?? "unknown";
  const language = request.headers.get("accept-language")?.slice(0, 80) ?? "unknown";
  return lightweightFingerprint(`${forwarded}\n${userAgent}\n${language}`);
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== expected || (fetchSite && fetchSite !== "same-origin")) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_ORIGIN_INVALID", 403);
  }
}

async function readBoundedJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
  }
  if (declaredLength > PUBLIC_LOUNGE_MAX_REQUEST_BYTES) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_PAYLOAD_TOO_LARGE", 413);
  }
  if (!request.body) throw new PublicLoungeError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PUBLIC_LOUNGE_MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new PublicLoungeError("PUBLIC_LOUNGE_PAYLOAD_TOO_LARGE", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new PublicLoungeError("PUBLIC_LOUNGE_PAYLOAD_INVALID", 400);
  }
}

function managementToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization);
  if (!match) throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED", 401);
  return match[1];
}

function errorResponse(error: unknown) {
  const safeError = error instanceof PublicLoungeError
    ? error
    : new PublicLoungeError("PUBLIC_LOUNGE_NOT_CONNECTED", 503, true);
  const headers: Record<string, string> = { ...SAFE_NO_STORE_HEADERS };
  if (safeError.status === 429) headers["Retry-After"] = "60";
  return Response.json({
    error: {
      code: safeError.code,
      retryable: safeError.retryable,
    },
  }, { status: safeError.status, headers });
}

function publicJson(value: unknown, status = 200) {
  // Until a verifiable CDN purge is part of retract/overwrite, shared caching can
  // continue serving withdrawn chapter text. Keep every lounge read uncached.
  return Response.json(value, { status, headers: SAFE_NO_STORE_HEADERS });
}

function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: SAFE_NO_STORE_HEADERS });
}

export function createPublicLoungeHttpHandlers(
  serviceProvider: () => PublicLoungeServiceApi,
  limiter = new PublicLoungeRateLimiter(),
) {
  const reserve = (request: Request, kind: RateLimitKind) => (
    limiter.reserve(requestClientId(request), kind)
  );

  return {
    async health(request: Request) {
      try {
        reserve(request, "read");
        return publicJson({ status: "ready", ...await serviceProvider().health() });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async list(request: Request) {
      try {
        reserve(request, "read");
        const url = new URL(request.url);
        const rawLimit = url.searchParams.get("limit");
        if (rawLimit !== null && !/^[1-9]\d*$/u.test(rawLimit)) {
          throw new PublicLoungeError("PUBLIC_LOUNGE_CURSOR_INVALID", 400);
        }
        const page = await serviceProvider().list({
          search: url.searchParams.get("q") ?? undefined,
          category: url.searchParams.get("category") ?? undefined,
          completedOnly: url.searchParams.get("completed") !== "false",
          cursor: url.searchParams.get("cursor") ?? undefined,
          limit: rawLimit === null ? undefined : Number(rawLimit),
        });
        return publicJson({ connected: true, count: page.items.length, ...page });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async get(request: Request, publicId: string) {
      try {
        reserve(request, "read");
        return publicJson({ connected: true, post: await serviceProvider().get(publicId) });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async publish(request: Request) {
      try {
        assertSameOrigin(request);
        reserve(request, "mutation");
        const result = await serviceProvider().publish(await readBoundedJson(request));
        return privateJson(result, 201);
      } catch (error) {
        return errorResponse(error);
      }
    },

    async eligibility(request: Request) {
      try {
        assertSameOrigin(request);
        reserve(request, "mutation");
        const proof = await serviceProvider().issueEligibility(await readBoundedJson(request));
        return privateJson({ proof }, 201);
      } catch (error) {
        return errorResponse(error);
      }
    },

    async overwrite(request: Request, publicId: string) {
      try {
        assertSameOrigin(request);
        reserve(request, "mutation");
        const token = managementToken(request);
        const post = await serviceProvider().overwrite(publicId, token, await readBoundedJson(request));
        return privateJson({ post });
      } catch (error) {
        return errorResponse(error);
      }
    },

    async retract(request: Request, publicId: string) {
      try {
        assertSameOrigin(request);
        reserve(request, "mutation");
        await serviceProvider().retract(publicId, managementToken(request));
        return new Response(null, { status: 204, headers: SAFE_NO_STORE_HEADERS });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
