import { NextRequest, NextResponse } from "next/server";
import { fetchControlledWebResearch } from "@/lib/novel-ai/sovereign-learning/safe-web-research.server";
import { distillControlledWebKnowledge } from "@/lib/novel-ai/sovereign-learning/web-knowledge-distillation.server";
import {
  normalizeControlledWebSourceProfile,
  type ControlledTeacherProvider,
} from "@/lib/novel-ai/sovereign-learning/web-knowledge-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WINDOW_MS = 10 * 60 * 1_000;
const MAX_REQUESTS_PER_WINDOW = 4;
const requestWindows = new Map<string, number[]>();

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function requestIdentity(request: NextRequest) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "local")
    .split(",")[0]
    .trim()
    .slice(0, 96);
}

function enforceSameOrigin(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const allowedHosts = new Set([
      request.headers.get("host"),
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
      request.nextUrl.host,
    ].filter((host): host is string => Boolean(host)).map((host) => host.toLowerCase()));
    return allowedHosts.has(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}

function enforceRateLimit(identity: string) {
  const current = Date.now();
  const active = (requestWindows.get(identity) ?? []).filter((timestamp) => current - timestamp < WINDOW_MS);
  if (active.length >= MAX_REQUESTS_PER_WINDOW) return false;
  requestWindows.set(identity, [...active, current]);
  if (requestWindows.size > 2_000) {
    for (const [key, values] of requestWindows) {
      if (!values.some((timestamp) => current - timestamp < WINDOW_MS)) requestWindows.delete(key);
    }
  }
  return true;
}

export async function POST(request: NextRequest) {
  if (!enforceSameOrigin(request)) {
    return json({ code: "WEB_DISTILLATION_CROSS_ORIGIN_BLOCKED", error: "跨站研究要求已被阻止。" }, 403);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) {
    return json({ code: "WEB_DISTILLATION_REQUEST_TOO_LARGE", error: "研究要求過大。" }, 413);
  }
  if (!enforceRateLimit(requestIdentity(request))) {
    return json({ code: "WEB_DISTILLATION_RATE_LIMITED", error: "受控研究啟動過於頻繁，請稍後再試。" }, 429);
  }
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
      return json({ code: "WEB_DISTILLATION_REQUEST_TOO_LARGE", error: "研究要求過大。" }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return json({ code: "WEB_DISTILLATION_REQUEST_INVALID", error: "研究要求不是有效 JSON。" }, 400);
    }
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const rightsBasis = typeof body.rightsBasis === "string" ? body.rightsBasis : "";
    const rightsEvidence = typeof body.rightsEvidence === "string" ? body.rightsEvidence.trim() : "";
    const allowedRights = new Set([
      "owned_by_user",
      "public_domain",
      "licensed_for_analysis",
      "lawful_private_reference",
    ]);
    if (!projectId || projectId.length > 180) {
      return json({ code: "WEB_DISTILLATION_PROJECT_REQUIRED", error: "缺少有效作品識別資料。" }, 400);
    }
    if (!allowedRights.has(rightsBasis) || rightsEvidence.length < 4 || body.userConfirmedRights !== true) {
      return json({
        code: "WEB_DISTILLATION_RIGHTS_CONFIRMATION_REQUIRED",
        error: "必須填寫來源權利依據並明確確認有權進行私人分析。",
      }, 403);
    }
    if (body.externalConsent !== true) {
      return json({
        code: "WEB_DISTILLATION_EXTERNAL_CONSENT_REQUIRED",
        error: "必須明確同意把清理後的來源送給所選教師 AI。",
      }, 403);
    }
    const providers = Array.isArray(body.providerIds)
      ? [...new Set(body.providerIds)].filter((value): value is ControlledTeacherProvider => value === "openai" || value === "grok")
      : [];
    if (!providers.length || providers.length > 2) {
      return json({ code: "WEB_DISTILLATION_TEACHER_REQUIRED", error: "請選擇 OpenAI、Grok 或兩者。" }, 400);
    }
    let sourceProfile;
    try {
      sourceProfile = normalizeControlledWebSourceProfile({
        sourceChannel: body.sourceChannel,
        engagementMetric: body.engagementMetric,
        engagementCount: body.engagementCount,
        engagementEvidence: body.engagementEvidence,
        observedAt: new Date().toISOString(),
      });
    } catch (error) {
      const row = error as { code?: string; message?: string };
      return json({ code: row.code || "POPULAR_SOURCE_PROFILE_INVALID", error: row.message || "熱門來源證據無效。" }, 400);
    }
    if (sourceProfile.channel === "youtube") {
      try {
        const hostname = new URL(url).hostname.toLowerCase();
        if (hostname !== "youtu.be" && hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) {
          return json({ code: "YOUTUBE_SOURCE_URL_REQUIRED", error: "YouTube 來源類型必須使用官方 youtube.com 或 youtu.be 網址。" }, 400);
        }
      } catch {
        return json({ code: "WEB_RESEARCH_URL_INVALID", error: "來源網址格式無效。" }, 400);
      }
    }
    const research = await fetchControlledWebResearch(url, { sourceProfile });
    const bundle = await distillControlledWebKnowledge({ research, providers });
    return json(bundle);
  } catch (error) {
    const row = error as { code?: string; status?: number; message?: string; detailCodes?: string[] };
    return json({
      code: row.code || "WEB_DISTILLATION_FAILED",
      error: row.message || "受控網路蒸餾失敗，沒有建立候選。",
      detailCodes: row.detailCodes ?? [],
      canonicalMutationCount: 0,
    }, Math.max(400, Math.min(599, Number(row.status) || 500)));
  }
}
