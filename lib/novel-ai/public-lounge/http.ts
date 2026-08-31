import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import {
  PUBLIC_LOUNGE_MAX_REQUEST_BYTES,
  PublicLoungeError,
} from "./contract";
import { PublicLoungeInteractionError } from "./interactions";
import type { PublicLoungeOwnerLifecycleGateway } from "./interactions.server";
import type { PublicLoungePost, PublicLoungeServiceApi } from "./types";

const SAFE_NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

type RateLimitKind = "read" | "mutation";
type RateLimitEntry = { count: number; resetAt: number };

/**
 * Best-effort per-process burst shedding only. It is not a distributed quota.
 * Every route additionally reserves an atomic durable object-storage slot
 * inside PublicLoungeService. This map only sheds same-process bursts.
 */
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

export function createPublicLoungeTrustedIpIdentity(options: {
  secret: string;
  headerName?: "x-vercel-forwarded-for";
}) {
  const encoded = options.secret.trim();
  if (!/^[A-Za-z0-9_-]{43}$/u.test(encoded)) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_CONNECTED", 503, true);
  }
  const secret = Buffer.from(encoded, "base64url");
  if (secret.length !== 32 || secret.toString("base64url") !== encoded) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_CONNECTED", 503, true);
  }
  const headerName = options.headerName ?? "x-vercel-forwarded-for";
  return (request: Request) => {
    const raw = request.headers.get(headerName)?.split(",")[0]?.trim() ?? "";
    if (!raw || isIP(raw) === 0) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_CONNECTED", 503, true);
    }
    // UA and language are intentionally excluded: changing either must not
    // mint a fresh quota.  The server-only HMAC also keeps raw IPs out of DB.
    return createHmac("sha256", secret)
      .update(`public-lounge-rate-v1\0${raw.toLowerCase()}`, "utf8")
      .digest("hex");
  };
}

function requestClientId(request: Request) {
  return createPublicLoungeTrustedIpIdentity({
    secret: process.env.PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY?.trim() ?? "",
  })(request);
}

export function assertPublicLoungeSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== expected || (fetchSite && fetchSite !== "same-origin")) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_ORIGIN_INVALID", 403);
  }
}

export async function readPublicLoungeBoundedJson(request: Request) {
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
  const raw = request.headers.get("x-public-lounge-management-token")?.trim() ?? "";
  const match = /^([A-Za-z0-9_-]{43})$/u.exec(raw);
  if (!match) throw new PublicLoungeError("PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED", 401);
  return match[1];
}

export function publicLoungeErrorResponse(error: unknown) {
  const safeError = error instanceof PublicLoungeError || error instanceof PublicLoungeInteractionError
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

function publishIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(value)) {
    throw new PublicLoungeError("PUBLIC_LOUNGE_IDEMPOTENCY_KEY_REQUIRED", 400);
  }
  return value;
}

export function createPublicLoungeHttpHandlers(
  serviceProvider: () => PublicLoungeServiceApi,
  limiter = new PublicLoungeRateLimiter(),
  identifyRequest: (request: Request) => string = requestClientId,
  ownerGatewayProvider?: () => PublicLoungeOwnerLifecycleGateway,
) {
  const reserve = (request: Request, kind: RateLimitKind) => (
    limiter.reserve(identifyRequest(request), kind)
  );
  const ownerGateway = () => {
    if (!ownerGatewayProvider) {
      throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_CONNECTED", 503, true);
    }
    return ownerGatewayProvider();
  };

  return {
    async health(request: Request) {
      try {
        reserve(request, "read");
        const service = serviceProvider();
        await service.reserveRequest(identifyRequest(request), "read");
        return publicJson({ status: "ready", ...await service.health() });
      } catch (error) {
        return publicLoungeErrorResponse(error);
      }
    },

    async list(request: Request) {
      try {
        reserve(request, "read");
        const service = serviceProvider();
        await service.reserveRequest(identifyRequest(request), "read");
        const url = new URL(request.url);
        const rawLimit = url.searchParams.get("limit");
        if (rawLimit !== null && !/^[1-9]\d*$/u.test(rawLimit)) {
          throw new PublicLoungeError("PUBLIC_LOUNGE_CURSOR_INVALID", 400);
        }
        const page = await service.list({
          search: url.searchParams.get("q") ?? undefined,
          shelfId: url.searchParams.get("shelf") ?? undefined,
          completedOnly: url.searchParams.get("completed") !== "false",
          cursor: url.searchParams.get("cursor") ?? undefined,
          limit: rawLimit === null ? undefined : Number(rawLimit),
        });
        return publicJson({ connected: true, count: page.items.length, ...page });
      } catch (error) {
        return publicLoungeErrorResponse(error);
      }
    },

    async get(request: Request, publicId: string) {
      try {
        reserve(request, "read");
        const service = serviceProvider();
        await service.reserveRequest(identifyRequest(request), "read");
        return publicJson({ connected: true, post: await service.get(publicId) });
      } catch (error) {
        return publicLoungeErrorResponse(error);
      }
    },

    async publish(request: Request) {
      try {
        assertPublicLoungeSameOrigin(request);
        reserve(request, "mutation");
        const owner = ownerGateway();
        const actor = await owner.authenticate(request);
        const service = serviceProvider();
        await service.reserveRequest(identifyRequest(request), "publish");
        const result = await service.publish(
          await readPublicLoungeBoundedJson(request),
          publishIdempotencyKey(request),
          actor.id,
          (post) => owner.bind(actor.id, post),
        );
        return privateJson(result, 201);
      } catch (error) {
        return publicLoungeErrorResponse(error);
      }
    },

    async eligibility(request: Request) {
      try {
        assertPublicLoungeSameOrigin(request);
        reserve(request, "mutation");
        const owner = ownerGateway();
        const actor = await owner.authenticate(request);
        const service = serviceProvider();
        await service.reserveRequest(identifyRequest(request), "eligibility");
        const proof = await service.issueEligibility(
          await readPublicLoungeBoundedJson(request),
          actor.id,
        );
        return privateJson({ proof }, 201);
      } catch (error) {
        return publicLoungeErrorResponse(error);
      }
    },

    async overwrite(request: Request, publicId: string) {
      try {
        assertPublicLoungeSameOrigin(request);
        reserve(request, "mutation");
        const owner = ownerGateway();
        const actor = await owner.authenticate(request);
        const service = serviceProvider();
        await service.reserveRequest(identifyRequest(request), "management");
        const token = managementToken(request);
        const previous = await service.get(publicId);
        await owner.assertOwner(actor.id, publicId);
        const post = await service.overwrite(
          publicId,
          token,
          await readPublicLoungeBoundedJson(request),
          actor.id,
        );
        try {
          await owner.sync(actor.id, previous.versionId, post);
        } catch (syncError) {
          try {
            await owner.deactivate(actor.id, publicId, previous.versionId, previous.versionNumber);
          } catch {
            // Authoritative Storage version checks on every interaction keep
            // this failed synchronization from becoming publicly usable.
          }
          throw syncError;
        }
        return privateJson({ post });
      } catch (error) {
        return publicLoungeErrorResponse(error);
      }
    },

    async retract(request: Request, publicId: string) {
      try {
        assertPublicLoungeSameOrigin(request);
        reserve(request, "mutation");
        const owner = ownerGateway();
        const actor = await owner.authenticate(request);
        const service = serviceProvider();
        await service.reserveRequest(identifyRequest(request), "management");
        const token = managementToken(request);
        let previous: PublicLoungePost | null = null;
        try {
          previous = await service.get(publicId);
          await owner.assertOwner(actor.id, publicId);
        } catch (error) {
          if (!(error instanceof PublicLoungeError && error.code === "PUBLIC_LOUNGE_NOT_FOUND")) {
            throw error;
          }
        }
        await service.retract(publicId, token);
        await owner.deactivate(
          actor.id,
          publicId,
          previous?.versionId ?? null,
          previous?.versionNumber ?? null,
        );
        return new Response(null, { status: 204, headers: SAFE_NO_STORE_HEADERS });
      } catch (error) {
        return publicLoungeErrorResponse(error);
      }
    },
  };
}
