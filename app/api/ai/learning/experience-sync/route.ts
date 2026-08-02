import { NextRequest, NextResponse } from "next/server";
import { AUTONOMOUS_PRACTICE_VERSION, type AutonomousPracticeExperience } from "@/lib/novel-ai/sovereign-learning/autonomous-practice";
import { sha256Hex, stableStringify } from "@/lib/novel-ai/sovereign-learning/hashing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HASH = /^[a-f0-9]{64}$/u;
const MAX_BODY_BYTES = 12_000;
const RATE_WINDOW_MS = 10 * 60 * 1_000;
const RATE_MAX_REQUESTS = 30;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const EXPERIENCE_KEYS = [
  "approvedRuleCount", "approvedRuleSetDigest", "capabilityEvidenceDigest", "completeRecipeCount",
  "consentDigest", "createdAt", "experienceDigest", "installationDigest", "outcome", "practiceKind",
  "privacy", "projectDigest", "recommendedNextStep", "schemaVersion", "scores", "selectedRuleCount",
  "taskCount", "treatmentRecipeCount",
].sort();
const SCORE_KEYS = [
  "capabilityDelta", "control", "lineageCoverage", "recipeCompleteness", "taskCoverage", "treatment",
].sort();
const PRIVACY_KEYS = [
  "authorOnlyIncluded", "canonicalMutationCount", "credentialIncluded", "memoryMutationCount",
  "modelWeightMutationCount", "rawChainOfThoughtIncluded", "rawOutputIncluded", "rawPromptIncluded",
  "rawStoryIncluded",
].sort();

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
  });
}

function sameOrigin(request: NextRequest) {
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

function validScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function exactKeys(value: unknown, expected: string[]) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value as Record<string, unknown>).sort()) === JSON.stringify(expected);
}

function rateLimitIdentity(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "local";
}

function takeRateLimit(request: NextRequest) {
  const now = Date.now();
  if (rateBuckets.size > 1_000) {
    for (const [key, value] of rateBuckets) {
      if (value.resetAt <= now) rateBuckets.delete(key);
    }
  }
  const identity = rateLimitIdentity(request);
  const bucket = rateBuckets.get(identity);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(identity, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_MAX_REQUESTS) return false;
  bucket.count += 1;
  return true;
}

async function validateExperience(value: unknown): Promise<AutonomousPracticeExperience> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AUTONOMOUS_EXPERIENCE_INVALID");
  const row = value as AutonomousPracticeExperience;
  const scores = row.scores;
  const privacy = row.privacy;
  if (
    !exactKeys(row, EXPERIENCE_KEYS)
    || row.schemaVersion !== AUTONOMOUS_PRACTICE_VERSION
    || row.practiceKind !== "approved-rule-sandbox-rehearsal"
    || !HASH.test(row.projectDigest)
    || !HASH.test(row.installationDigest)
    || !HASH.test(row.consentDigest)
    || !HASH.test(row.capabilityEvidenceDigest)
    || !HASH.test(row.approvedRuleSetDigest)
    || !HASH.test(row.experienceDigest)
    || !["practice_passed", "needs_more_coverage", "blocked"].includes(row.outcome)
    || !["retain_current_version", "collect_more_approved_rules", "human_review_required"].includes(row.recommendedNextStep)
    || typeof row.createdAt !== "string"
    || !Number.isFinite(Date.parse(row.createdAt))
    || !exactKeys(scores, SCORE_KEYS)
    || !validScore(scores.control)
    || !validScore(scores.treatment)
    || !validScore(scores.capabilityDelta)
    || ![scores.taskCoverage, scores.lineageCoverage, scores.recipeCompleteness].every((score) =>
      typeof score === "number" && score >= 0 && score <= 1)
    || !exactKeys(privacy, PRIVACY_KEYS)
    || Object.entries(privacy).some(([key, item]) => key.endsWith("Included") ? item !== false : item !== 0)
    || ![row.approvedRuleCount, row.selectedRuleCount, row.taskCount, row.treatmentRecipeCount, row.completeRecipeCount]
      .every((item) => Number.isInteger(item) && item >= 0 && item <= 10_000)
  ) {
    throw new Error("AUTONOMOUS_EXPERIENCE_CONTRACT_INVALID");
  }
  const { experienceDigest, ...body } = row;
  if (await sha256Hex(stableStringify(body)) !== experienceDigest) {
    throw new Error("AUTONOMOUS_EXPERIENCE_HASH_MISMATCH");
  }
  return row;
}

async function forwardToPrivateHub(experience: AutonomousPracticeExperience) {
  const runtimeUrl = process.env.PRIVATE_AI_HUB_RUNTIME_URL?.trim() || "";
  const token = process.env.PRIVATE_AI_HUB_TOKEN?.trim() || "";
  if (!runtimeUrl || !token) return { forwarded: false as const, reason: "PRIVATE_HUB_NOT_CONFIGURED" };
  let endpoint: URL;
  try {
    endpoint = new URL("/v1/learning/experiences", runtimeUrl);
  } catch {
    return { forwarded: false as const, reason: "PRIVATE_HUB_URL_INVALID" };
  }
  if (endpoint.protocol !== "https:") return { forwarded: false as const, reason: "PRIVATE_HUB_HTTPS_REQUIRED" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Novel-Learning-Protocol": AUTONOMOUS_PRACTICE_VERSION,
      },
      body: JSON.stringify(experience),
    });
    if (!response.ok) return { forwarded: false as const, reason: `PRIVATE_HUB_HTTP_${response.status}` };
    const receipt = await response.json().catch(() => null) as null | Record<string, unknown>;
    return receipt?.status === "durably_recorded"
      && receipt.durable === true
      && receipt.experienceDigest === experience.experienceDigest
      && typeof receipt.receiptDigest === "string"
      && HASH.test(receipt.receiptDigest)
      && receipt.rawContentStored === false
      && receipt.canonicalMutationCount === 0
      && receipt.modelWeightMutationCount === 0
      ? { forwarded: true as const, reason: "PRIVATE_HUB_DURABLE_RECEIPT_VERIFIED" }
      : { forwarded: false as const, reason: "PRIVATE_HUB_RECEIPT_INVALID" };
  } catch {
    return { forwarded: false as const, reason: "PRIVATE_HUB_UNREACHABLE" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return json({ code: "AUTONOMOUS_EXPERIENCE_CROSS_ORIGIN_BLOCKED" }, 403);
  if (!takeRateLimit(request)) return json({ code: "AUTONOMOUS_EXPERIENCE_RATE_LIMITED" }, 429);
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return json({ code: "AUTONOMOUS_EXPERIENCE_TOO_LARGE" }, 413);
  }
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ code: "AUTONOMOUS_EXPERIENCE_TOO_LARGE" }, 413);
    }
    const experience = await validateExperience(JSON.parse(rawBody));
    const forwarded = await forwardToPrivateHub(experience);
    const receivedAt = new Date().toISOString();
    const receiptDigest = await sha256Hex(`${experience.experienceDigest}|${receivedAt}|${forwarded.reason}`);
    return json({
      status: forwarded.forwarded ? "forwarded_to_private_hub" : "received_not_durable_keep_local_queue",
      forwarded: forwarded.forwarded,
      durable: forwarded.forwarded,
      reason: forwarded.reason,
      receivedAt,
      receiptDigest,
      rawContentReceived: false,
      canonicalMutationCount: 0,
      retryable: !forwarded.forwarded,
    }, forwarded.forwarded ? 200 : 202);
  } catch (error) {
    return json({
      code: error instanceof Error ? error.message : "AUTONOMOUS_EXPERIENCE_INVALID",
      canonicalMutationCount: 0,
    }, 400);
  }
}
