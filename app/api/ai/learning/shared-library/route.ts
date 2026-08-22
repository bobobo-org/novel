import { NextRequest, NextResponse } from "next/server";
import {
  publishSharedLearningRules,
  querySharedLearningLibrary,
} from "@/lib/novel-ai/sovereign-learning/shared-learning-library.server";
import {
  isLearningRuleDimension,
  isLearningRuleFamily,
  type SharedLearningSourceChannel,
} from "@/lib/novel-ai/sovereign-learning/shared-learning-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_POST_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1_000;
const RATE_MAX = 20;
const rateBuckets = new Map<string, number[]>();
const SOURCE_CHANNELS = new Set<SharedLearningSourceChannel>([
  "article", "youtube", "novel_app", "popular_web", "classical_chinese", "user_supplied",
]);

function sameOrigin(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return fetchSite === "same-origin" || fetchSite === "same-site";
  try {
    const hosts = new Set([
      request.headers.get("host"),
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
      request.nextUrl.host,
    ].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase()));
    return hosts.has(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}

function identity(request: NextRequest) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "local")
    .split(",")[0].trim().slice(0, 96);
}

function takeRateLimit(request: NextRequest) {
  const now = Date.now();
  const key = identity(request);
  const active = (rateBuckets.get(key) ?? []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (active.length >= RATE_MAX) return false;
  rateBuckets.set(key, [...active, now]);
  if (rateBuckets.size > 2_000) {
    for (const [candidate, timestamps] of rateBuckets) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_WINDOW_MS)) rateBuckets.delete(candidate);
    }
  }
  return true;
}

function values(value: string | null) {
  return [...new Set((value || "").split(",").map((item) => item.trim()).filter(Boolean))];
}

export async function GET(request: NextRequest) {
  const families = values(request.nextUrl.searchParams.get("families")).filter(isLearningRuleFamily);
  const dimensions = values(request.nextUrl.searchParams.get("dimensions")).filter(isLearningRuleDimension);
  const tags = values(request.nextUrl.searchParams.get("tags"));
  const limit = Number(request.nextUrl.searchParams.get("limit") || 24);
  const snapshot = await querySharedLearningLibrary({ families, dimensions, tags, limit });
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      "X-Content-Type-Options": "nosniff",
      "X-Shared-Learning-Selection": "indexed-top-k",
    },
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ code: "SHARED_LEARNING_CROSS_ORIGIN_BLOCKED" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ code: "SHARED_LEARNING_CONTENT_TYPE_REQUIRED" }, { status: 415 });
  }
  if (!takeRateLimit(request)) {
    return NextResponse.json({ code: "SHARED_LEARNING_RATE_LIMITED" }, { status: 429 });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_POST_BYTES) {
    return NextResponse.json({ code: "SHARED_LEARNING_REQUEST_TOO_LARGE" }, { status: 413 });
  }
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_POST_BYTES) {
      return NextResponse.json({ code: "SHARED_LEARNING_REQUEST_TOO_LARGE" }, { status: 413 });
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    const sourceChannel = String(body.sourceChannel || "user_supplied") as SharedLearningSourceChannel;
    if (!SOURCE_CHANNELS.has(sourceChannel)) {
      return NextResponse.json({ code: "SHARED_LEARNING_SOURCE_CHANNEL_INVALID" }, { status: 400 });
    }
    const receipt = await publishSharedLearningRules({
      sourceDigest: String(body.sourceDigest || ""),
      sourceChannel,
      teacherVersion: String(body.teacherVersion || "closed-story-causal-teacher-v1"),
      rules: Array.isArray(body.rules) ? body.rules : [],
    });
    return NextResponse.json(receipt, {
      status: receipt.status === "no_safe_rules" ? 422 : receipt.status === "persistence_degraded" ? 503 : 200,
      headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ code: "SHARED_LEARNING_REQUEST_INVALID" }, { status: 400 });
  }
}
