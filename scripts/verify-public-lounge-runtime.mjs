import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
// Each attempt consumes durable anonymous read quota. Keep retries below the
// public per-minute allowance and let the surrounding deployment job retry a
// failed stage instead of turning the verifier itself into abusive traffic.
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const EXPECTED_PUBLIC_LOUNGE_SHELF_IDS = Object.freeze([
  "group-1",
  "group-2",
  "group-3",
  "group-4",
  "group-5",
  "group-6",
  "group-7",
  "group-8",
]);
const PUBLIC_ID_PATTERN = /^novel_[a-z0-9_-]{12,80}$/u;
const VERSION_ID_PATTERN = /^version_[a-z0-9_-]{12,96}$/u;
const HEALTH_KEYS = Object.freeze([
  "status",
  "connected",
  "storage",
  "bucket",
  "trustedEligibilityVerifierConnected",
  "authorDeviceEligibilityAccepted",
  "trustedAttestationProducer",
]);
const INTERACTIONS_HEALTH_READY_KEYS = Object.freeze([
  "schemaVersion",
  "status",
  "ready",
  "identity",
  "persistence",
  "migrationVersion",
  "counts",
  "capabilities",
  "blockers",
]);
const INTERACTIONS_HEALTH_FAIL_CLOSED_KEYS = Object.freeze([
  "schemaVersion",
  "status",
  "ready",
  "identity",
  "persistence",
  "counts",
  "capabilities",
  "blockers",
]);
const INTERACTIONS_CAPABILITY_KEYS = Object.freeze([
  "oneVotePerWork",
  "comments",
  "reports",
  "authorCommentDeletion",
]);
const INTERACTIONS_HEALTH_SCHEMA_VERSION = "public-lounge-interactions-health-v1";
const INTERACTIONS_MIGRATION_VERSION = "public_lounge_interactions_v1_027";
const INTERACTIONS_EXPECTED_STATES = Object.freeze(["ready", "fail-closed"]);
const LIST_KEYS = Object.freeze([
  "connected",
  "count",
  "items",
  "nextCursor",
  "totalCount",
  "shelves",
]);
const SUMMARY_KEYS = Object.freeze([
  "schemaVersion",
  "publicId",
  "title",
  "authorByline",
  "authorBylineStatus",
  "storyLibrarySchemaVersion",
  "shelfId",
  "primaryTopicId",
  "topicIds",
  "completionStatus",
  "chapterCount",
  "wordCount",
  "completedAt",
  "publishedAt",
  "versionId",
  "versionNumber",
  "versionPublishedAt",
  "quality",
  "qualityAssurance",
  "synopsisExcerpt",
  "publicChapterCount",
]);
const POST_KEYS = Object.freeze([
  "schemaVersion",
  "publicId",
  "title",
  "authorByline",
  "authorBylineStatus",
  "storyLibrarySchemaVersion",
  "shelfId",
  "primaryTopicId",
  "topicIds",
  "completionStatus",
  "chapterCount",
  "wordCount",
  "completedAt",
  "publishedAt",
  "versionId",
  "versionNumber",
  "versionPublishedAt",
  "quality",
  "qualityAssurance",
  "fullSynopsis",
  "publicChapters",
]);
const PRIVATE_TEXT_RESIDUE_RULES = Object.freeze([
  ["SYSTEM_PROMPT", /(?:system[_ -]?prompt|系統提示詞)\s*[:=：]\s*[\[{"']/iu],
  ["STORY_BIBLE", /story[_ -]?bible\s*[:=：]\s*[\[{"']/iu],
  ["MODEL_DIGEST", /(?:model[_ -]?(?:digest|fingerprint)|completion[_ -]?fingerprint)\s*[:=：]\s*[a-f0-9_-]{16,}/iu],
  ["PRIVATE_CANON", /(?:private[_ -]?canon|canon)\s*[:=：]\s*[\[{"']/iu],
]);

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isPrivatePayloadKey(value) {
  const key = normalizedKey(value);
  if (!key) return false;
  if (key.includes("prompt")) return true;
  if (key.includes("receipt") || key.includes("trace")) return true;
  if (key.includes("canon") && !key.includes("canonical")) return true;
  if (key.includes("storybible")) return true;
  if (key.includes("modeldigest") || key.includes("modelfingerprint")) return true;
  if (key.includes("completionfingerprint")) return true;
  if (key.includes("projectid") || key.includes("reviewid") || key.includes("userid")) return true;
  if (key.includes("email") || key.includes("managementtoken") || key.includes("eligibilityticket")) return true;
  if (key.includes("localpath") || key.includes("filesystempath") || key.includes("sourcerevision")) return true;
  return [
    "rawdraft",
    "hiddendraft",
    "draftbody",
    "draftcontent",
    "draftpayload",
    "drafttext",
  ].some((token) => key.includes(token));
}

function privateTextResidues(value) {
  const normalized = String(value || "")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("\\\"", "\"");
  return PRIVATE_TEXT_RESIDUE_RULES
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([label]) => label);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function normalizeInteractionsExpectedState(value = "ready") {
  const normalized = String(value || "ready").trim();
  if (!INTERACTIONS_EXPECTED_STATES.includes(normalized)) {
    throw new Error("PUBLIC_LOUNGE_INTERACTIONS_EXPECTED_STATE_INVALID");
  }
  return normalized;
}

function interactionsCapabilitiesMatch(value, expected) {
  return exactKeys(value, INTERACTIONS_CAPABILITY_KEYS)
    && INTERACTIONS_CAPABILITY_KEYS.every((key) => value[key] === expected);
}

function interactionsHealthMatchesExpectedState(value, expectedState) {
  if (expectedState === "ready") {
    return exactKeys(value, INTERACTIONS_HEALTH_READY_KEYS)
      && value.schemaVersion === INTERACTIONS_HEALTH_SCHEMA_VERSION
      && value.status === "ready"
      && value.ready === true
      && value.identity === "supabase_auth_get_user"
      && value.persistence === "postgres_rpc_live"
      && value.migrationVersion === INTERACTIONS_MIGRATION_VERSION
      && value.counts === null
      && interactionsCapabilitiesMatch(value.capabilities, true)
      && Array.isArray(value.blockers)
      && value.blockers.length === 0;
  }
  return exactKeys(value, INTERACTIONS_HEALTH_FAIL_CLOSED_KEYS)
    && value.schemaVersion === INTERACTIONS_HEALTH_SCHEMA_VERSION
    && value.status === "not_connected"
    && value.ready === false
    && value.identity === "not_connected"
    && value.persistence === "migration_prepared_not_activated"
    && value.counts === null
    && interactionsCapabilitiesMatch(value.capabilities, false)
    && Array.isArray(value.blockers)
    && value.blockers.every((blocker) => typeof blocker === "string")
    && value.blockers.includes("feature_flag_disabled");
}

function isCanonicalIsoTime(value) {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function hasPublicVersionContract(value, schemaVersion) {
  const expectedKeys = schemaVersion === "public-lounge-post-v3" ? POST_KEYS : SUMMARY_KEYS;
  return value
    && typeof value === "object"
    && exactKeys(value, expectedKeys)
    && value.schemaVersion === schemaVersion
    && PUBLIC_ID_PATTERN.test(String(value.publicId || ""))
    && VERSION_ID_PATTERN.test(String(value.versionId || ""))
    && Number.isInteger(value.versionNumber)
    && value.versionNumber >= 1
    && isCanonicalIsoTime(value.versionPublishedAt)
    && value.qualityAssurance === "private_ai_hub_verified"
    && Number.isInteger(value.quality?.totalScore)
    && value.quality.totalScore >= 80
    && value.quality?.threshold === 80
    && Array.isArray(value.quality?.breakdown)
    && value.quality.breakdown.length === 7
    && value.quality.breakdown.every((item) => exactKeys(
      item,
      ["key", "label", "weight", "score", "weightedPoints"],
    ));
}

function shelvesMatchPublicContract(value) {
  return Array.isArray(value)
    && value.length === EXPECTED_PUBLIC_LOUNGE_SHELF_IDS.length
    && value.every((shelf, index) => (
      exactKeys(shelf, ["shelfId", "name", "description", "order"])
      && shelf.shelfId === EXPECTED_PUBLIC_LOUNGE_SHELF_IDS[index]
      && shelf.order === index + 1
      && typeof shelf.name === "string"
      && shelf.name.trim().length > 0
      && typeof shelf.description === "string"
      && shelf.description.trim().length > 0
    ));
}

function privateJsonKeyPaths(value, path = "$") {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => privateJsonKeyPaths(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  const findings = [];
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (isPrivatePayloadKey(key)) findings.push(nextPath);
    findings.push(...privateJsonKeyPaths(entry, nextPath));
  }
  return findings;
}

function privateHtmlKeyPaths(html) {
  const normalized = String(html || "")
    .replaceAll("&quot;", "\"")
    .replaceAll("\\\"", "\"");
  const findings = new Set();
  for (const match of normalized.matchAll(/["']([A-Za-z_][A-Za-z0-9_.-]{0,80})["']\s*:/gu)) {
    if (isPrivatePayloadKey(match[1])) findings.add(`serialized.${match[1]}`);
  }
  for (const match of normalized.matchAll(/\bdata-([a-z][a-z0-9-]{0,80})\s*=/gu)) {
    if (isPrivatePayloadKey(match[1])) findings.add(`attribute.data-${match[1]}`);
  }
  return [...findings].sort();
}

function cacheControlIsPrivate(response) {
  const value = String(response.headers.get("cache-control") || "").toLowerCase();
  return /(?:^|,)\s*no-store\s*(?:,|$)/u.test(value)
    && !/(?:^|,)\s*public\b/u.test(value)
    && !/\bs-maxage\s*=/u.test(value)
    && !/\bstale-while-revalidate\s*=/u.test(value)
    && !/\bmax-age\s*=\s*[1-9]/u.test(value);
}

async function responseText(response, timeoutMs) {
  return Promise.race([
    response.text(),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("PUBLIC_LOUNGE_BODY_TIMEOUT")), timeoutMs);
      timer.unref?.();
    }),
  ]);
}

async function request(fetcher, url, accept, timeoutMs) {
  const response = await fetcher(url, {
    cache: "no-store",
    headers: { Accept: accept },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await responseText(response, timeoutMs);
  return { response, body };
}

function jsonBody(surface, body, findings) {
  try {
    return JSON.parse(body);
  } catch {
    findings.push({ surface, code: "INVALID_JSON" });
    return null;
  }
}

function apiChecks(surface, response, body, findings, expectedStatus = 200) {
  if (response.status !== expectedStatus) {
    findings.push({ surface, code: `HTTP_NOT_${expectedStatus}` });
  }
  if (!/^application\/json(?:;|$)/iu.test(String(response.headers.get("content-type") || ""))) {
    findings.push({ surface, code: "CONTENT_TYPE_NOT_JSON" });
  }
  if (!cacheControlIsPrivate(response)) findings.push({ surface, code: "CACHE_CONTROL_NOT_NO_STORE" });
  if (String(response.headers.get("x-content-type-options") || "").toLowerCase() !== "nosniff") {
    findings.push({ surface, code: "NOSNIFF_MISSING" });
  }
  const parsed = jsonBody(surface, body, findings);
  if (parsed) {
    for (const path of privateJsonKeyPaths(parsed)) {
      findings.push({ surface, code: "PRIVATE_PAYLOAD_KEY_EXPOSED", path });
    }
    for (const residue of privateTextResidues(body)) {
      findings.push({ surface, code: "PRIVATE_PAYLOAD_TEXT_EXPOSED", residue });
    }
  }
  return parsed;
}

function htmlChecks(surface, response, body, findings, options = {}) {
  if (response.status !== 200) findings.push({ surface, code: "HTTP_NOT_200" });
  if (!/^text\/html(?:;|$)/iu.test(String(response.headers.get("content-type") || ""))) {
    findings.push({ surface, code: "CONTENT_TYPE_NOT_HTML" });
  }
  if (options.requireNoStore && !cacheControlIsPrivate(response)) {
    findings.push({ surface, code: "CACHE_CONTROL_NOT_NO_STORE" });
  }
  if (options.marker && !body.includes(options.marker)) {
    findings.push({ surface, code: "DETAIL_MARKER_MISSING" });
  }
  for (const path of privateHtmlKeyPaths(body)) {
    findings.push({ surface, code: "PRIVATE_PAYLOAD_KEY_EXPOSED", path });
  }
  for (const residue of privateTextResidues(body)) {
    findings.push({ surface, code: "PRIVATE_PAYLOAD_TEXT_EXPOSED", residue });
  }
}

function missingApiChecks(surface, response, body, findings) {
  if (response.status !== 404) findings.push({ surface, code: "MISSING_ROUTE_NOT_404" });
  if (!/^application\/json(?:;|$)/iu.test(String(response.headers.get("content-type") || ""))) {
    findings.push({ surface, code: "CONTENT_TYPE_NOT_JSON" });
  }
  if (!cacheControlIsPrivate(response)) findings.push({ surface, code: "CACHE_CONTROL_NOT_NO_STORE" });
  if (String(response.headers.get("x-content-type-options") || "").toLowerCase() !== "nosniff") {
    findings.push({ surface, code: "NOSNIFF_MISSING" });
  }
  const parsed = jsonBody(surface, body, findings);
  if (parsed) {
    for (const path of privateJsonKeyPaths(parsed)) {
      findings.push({ surface, code: "PRIVATE_PAYLOAD_KEY_EXPOSED", path });
    }
  }
}

function clientShellHtmlChecks(surface, response, body, findings) {
  if (response.status !== 200) findings.push({ surface, code: "CLIENT_SHELL_NOT_200" });
  if (!/^text\/html(?:;|$)/iu.test(String(response.headers.get("content-type") || ""))) {
    findings.push({ surface, code: "CONTENT_TYPE_NOT_HTML" });
  }
  if (!body.includes("正在讀取正式公開版本")) {
    findings.push({ surface, code: "CLIENT_SHELL_LOADING_MARKER_MISSING" });
  }
  for (const path of privateHtmlKeyPaths(body)) {
    findings.push({ surface, code: "PRIVATE_PAYLOAD_KEY_EXPOSED", path });
  }
  for (const residue of privateTextResidues(body)) {
    findings.push({ surface, code: "PRIVATE_PAYLOAD_TEXT_EXPOSED", residue });
  }
}

async function verifyOrigin({
  origin,
  fetcher,
  fetchTimeoutMs,
  nonce,
  interactionsExpectedState,
}) {
  const findings = [];
  const healthUrl = `${origin}/api/lounge/health?runtime-gate=${nonce}`;
  const interactionsHealthUrl = `${origin}/api/lounge/interactions/health?runtime-gate=${nonce}`;
  const listUrl = `${origin}/api/lounge?completed=true&limit=1&runtime-gate=${nonce}`;
  const pageUrl = `${origin}/lounge?runtime-gate=${nonce}`;
  let healthResponse;
  let interactionsHealthResponse;
  let listResponse;
  let pageResponse;
  try {
    [healthResponse, interactionsHealthResponse, listResponse, pageResponse] = await Promise.all([
      request(fetcher, healthUrl, "application/json", fetchTimeoutMs),
      request(fetcher, interactionsHealthUrl, "application/json", fetchTimeoutMs),
      request(fetcher, listUrl, "application/json", fetchTimeoutMs),
      request(fetcher, pageUrl, "text/html", fetchTimeoutMs),
    ]);
  } catch (error) {
    findings.push({
      surface: "network",
      code: "FETCH_FAILED",
      detail: String(error?.name || error?.message || "FETCH_FAILED").slice(0, 80),
    });
    return { origin, findings, surfaces: {} };
  }

  const health = apiChecks(
    "lounge-health",
    healthResponse.response,
    healthResponse.body,
    findings,
  );
  if (
    !exactKeys(health, HEALTH_KEYS)
    ||
    health?.status !== "ready"
    || health?.connected !== true
    || health?.storage !== "supabase-private-storage"
    || health?.bucket !== "novel-public-lounge-v1"
  ) {
    findings.push({ surface: "lounge-health", code: "HEALTH_CONTRACT_INVALID" });
  }

  const interactionsHealth = apiChecks(
    "lounge-interactions-health",
    interactionsHealthResponse.response,
    interactionsHealthResponse.body,
    findings,
    interactionsExpectedState === "ready" ? 200 : 503,
  );
  if (!interactionsHealthMatchesExpectedState(interactionsHealth, interactionsExpectedState)) {
    findings.push({
      surface: "lounge-interactions-health",
      code: "INTERACTIONS_HEALTH_CONTRACT_INVALID",
    });
  }
  if (
    interactionsExpectedState === "fail-closed"
    && !interactionsHealth?.blockers?.includes?.("feature_flag_disabled")
  ) {
    findings.push({
      surface: "lounge-interactions-health",
      code: "INTERACTIONS_FAIL_CLOSED_NOT_INTENTIONAL",
    });
  }

  const list = apiChecks(
    "lounge-list",
    listResponse.response,
    listResponse.body,
    findings,
  );
  if (
    !exactKeys(list, LIST_KEYS)
    ||
    list?.connected !== true
    || !Number.isInteger(list?.count)
    || list.count < 0
    || !Number.isInteger(list?.totalCount)
    || list.totalCount < 0
    || !Array.isArray(list?.items)
    || !Array.isArray(list?.shelves)
    || !(list?.nextCursor === null || typeof list?.nextCursor === "string")
  ) {
    findings.push({ surface: "lounge-list", code: "LIST_CONTRACT_INVALID" });
  } else if (list.count !== list.items.length || list.items.length > 1) {
    findings.push({ surface: "lounge-list", code: "LIST_COUNT_INVALID" });
  }
  if (!shelvesMatchPublicContract(list?.shelves)) {
    findings.push({ surface: "lounge-list", code: "SHELVES_CONTRACT_INVALID" });
  }
  if (Array.isArray(list?.items) && list.items.some((item) => (
    !hasPublicVersionContract(item, "public-lounge-index-entry-v3")
  ))) {
    findings.push({ surface: "lounge-list", code: "LIST_ITEM_VERSION_CONTRACT_INVALID" });
  }

  htmlChecks("lounge-page", pageResponse.response, pageResponse.body, findings);
  if (!/(?:小說交誼廳|公開完本書庫)/u.test(pageResponse.body)) {
    findings.push({ surface: "lounge-page", code: "LOUNGE_MARKER_MISSING" });
  }

  const missingPublicId = "novel_runtimeabsent001";
  let missingApiSurface = null;
  let missingPageSurface = null;
  try {
    const [missingApiResponse, missingPageResponse] = await Promise.all([
      request(
        fetcher,
        `${origin}/api/lounge/${missingPublicId}?runtime-gate=${nonce}`,
        "application/json",
        fetchTimeoutMs,
      ),
      request(
        fetcher,
        `${origin}/lounge/${missingPublicId}?runtime-gate=${nonce}`,
        "text/html",
        fetchTimeoutMs,
      ),
    ]);
    missingApiChecks(
      "lounge-missing-detail-api",
      missingApiResponse.response,
      missingApiResponse.body,
      findings,
    );
    clientShellHtmlChecks(
      "lounge-missing-detail-page",
      missingPageResponse.response,
      missingPageResponse.body,
      findings,
    );
    missingApiSurface = {
      status: missingApiResponse.response.status,
      cacheControl: missingApiResponse.response.headers.get("cache-control"),
      bodyDigest: digest(missingApiResponse.body),
    };
    missingPageSurface = {
      status: missingPageResponse.response.status,
      cacheControl: missingPageResponse.response.headers.get("cache-control"),
      bodyDigest: digest(missingPageResponse.body),
    };
  } catch (error) {
    findings.push({
      surface: "lounge-missing-detail-network",
      code: "FETCH_FAILED",
      detail: String(error?.name || error?.message || "FETCH_FAILED").slice(0, 80),
    });
  }

  let detailApiSurface = null;
  let detailPageSurface = null;
  const detailCandidate = Array.isArray(list?.items)
    && hasPublicVersionContract(list.items[0], "public-lounge-index-entry-v3")
    ? list.items[0]
    : null;
  if (detailCandidate) {
    try {
      const encodedPublicId = encodeURIComponent(detailCandidate.publicId);
      const [detailResponse, detailPageResponse] = await Promise.all([
        request(
          fetcher,
          `${origin}/api/lounge/${encodedPublicId}?runtime-gate=${nonce}`,
          "application/json",
          fetchTimeoutMs,
        ),
        request(
          fetcher,
          `${origin}/lounge/${encodedPublicId}?runtime-gate=${nonce}`,
          "text/html",
          fetchTimeoutMs,
        ),
      ]);
      const detail = apiChecks(
        "lounge-detail-api",
        detailResponse.response,
        detailResponse.body,
        findings,
      );
      if (
        !exactKeys(detail, ["connected", "post"])
        || detail?.connected !== true
        || !hasPublicVersionContract(detail?.post, "public-lounge-post-v3")
        || detail.post.publicId !== detailCandidate.publicId
        || detail.post.versionId !== detailCandidate.versionId
        || detail.post.versionNumber !== detailCandidate.versionNumber
        || detail.post.versionPublishedAt !== detailCandidate.versionPublishedAt
      ) {
        findings.push({ surface: "lounge-detail-api", code: "DETAIL_VERSION_CONTRACT_INVALID" });
      }
      htmlChecks(
        "lounge-detail-page",
        detailPageResponse.response,
        detailPageResponse.body,
        findings,
        { marker: "正在讀取正式公開版本" },
      );
      detailApiSurface = {
        status: detailResponse.response.status,
        cacheControl: detailResponse.response.headers.get("cache-control"),
        bodyDigest: digest(detailResponse.body),
        publicId: detailCandidate.publicId,
        versionId: detail?.post?.versionId ?? null,
        versionNumber: Number.isInteger(detail?.post?.versionNumber) ? detail.post.versionNumber : null,
      };
      detailPageSurface = {
        status: detailPageResponse.response.status,
        cacheControl: detailPageResponse.response.headers.get("cache-control"),
        contentType: detailPageResponse.response.headers.get("content-type"),
        bodyDigest: digest(detailPageResponse.body),
        bytes: Buffer.byteLength(detailPageResponse.body),
      };
    } catch (error) {
      findings.push({
        surface: "lounge-detail-network",
        code: "FETCH_FAILED",
        detail: String(error?.name || error?.message || "FETCH_FAILED").slice(0, 80),
      });
    }
  }

  return {
    origin,
    findings,
    surfaces: {
      health: {
        status: healthResponse.response.status,
        cacheControl: healthResponse.response.headers.get("cache-control"),
        bodyDigest: digest(healthResponse.body),
        connected: health?.connected === true,
      },
      interactionsHealth: {
        status: interactionsHealthResponse.response.status,
        cacheControl: interactionsHealthResponse.response.headers.get("cache-control"),
        bodyDigest: digest(interactionsHealthResponse.body),
        expectedState: interactionsExpectedState,
      },
      list: {
        status: listResponse.response.status,
        cacheControl: listResponse.response.headers.get("cache-control"),
        bodyDigest: digest(listResponse.body),
        count: Number.isInteger(list?.count) ? list.count : null,
        totalCount: Number.isInteger(list?.totalCount) ? list.totalCount : null,
      },
      page: {
        status: pageResponse.response.status,
        contentType: pageResponse.response.headers.get("content-type"),
        bodyDigest: digest(pageResponse.body),
        bytes: Buffer.byteLength(pageResponse.body),
      },
      detailApi: detailApiSurface,
      detailPage: detailPageSurface,
      missingDetailApi: missingApiSurface,
      missingDetailPage: missingPageSurface,
    },
  };
}

function sanitizedReport({ phase, attempt, reports, interactionsExpectedState }) {
  const findings = reports.flatMap((report) => report.findings.map((finding) => ({
    origin: report.origin,
    ...finding,
  })));
  return {
    schemaVersion: "public-lounge-runtime-gate-v1",
    status: findings.length === 0 ? "PASS" : "FAIL",
    phase,
    attempt,
    interactionsExpectedState,
    checkedAt: new Date().toISOString(),
    origins: reports.map(({ origin, surfaces }) => ({ origin, surfaces })),
    findings,
    responseBodiesStored: false,
    privatePayloadStored: false,
  };
}

export async function verifyPublicLoungeRuntime({
  origins,
  phase,
  fetcher = fetch,
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  interactionsExpectedState = "ready",
}) {
  if (!Array.isArray(origins) || origins.length === 0) throw new Error("PUBLIC_LOUNGE_ORIGIN_MISSING");
  if (!phase) throw new Error("PUBLIC_LOUNGE_PHASE_MISSING");
  const normalizedInteractionsExpectedState = normalizeInteractionsExpectedState(
    interactionsExpectedState,
  );
  let lastReport = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const nonce = `${Date.now()}-${attempt}-${Math.random().toString(16).slice(2)}`;
    const reports = await Promise.all(origins.map((origin) => verifyOrigin({
      origin,
      fetcher,
      fetchTimeoutMs,
      nonce,
      interactionsExpectedState: normalizedInteractionsExpectedState,
    })));
    lastReport = sanitizedReport({
      phase,
      attempt,
      reports,
      interactionsExpectedState: normalizedInteractionsExpectedState,
    });
    if (lastReport.status === "PASS") return lastReport;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw Object.assign(new Error("PUBLIC_LOUNGE_RUNTIME_GATE_FAILED"), {
    code: "PUBLIC_LOUNGE_RUNTIME_GATE_FAILED",
    report: lastReport,
  });
}

const MOCK_PUBLIC_ID = "novel_runtimefixture01";
const MOCK_VERSION_ID = "version_runtimefixture01";
const MOCK_VERSION_PUBLISHED_AT = "2026-08-31T00:00:00.000Z";
const MOCK_QUALITY = Object.freeze({
  totalScore: 82,
  threshold: 80,
  breakdown: Object.freeze([
    ["plot_coherence", "情節與因果連貫", 20, 82, 16.4],
    ["character_arcs", "角色弧線", 15, 82, 12.3],
    ["world_canon_consistency", "世界與 Canon 一致性", 15, 82, 12.3],
    ["pacing", "節奏與篇章配置", 15, 82, 12.3],
    ["prose_dialogue", "敘事文字與對話", 15, 82, 12.3],
    ["foreshadowing_payoff", "伏筆與回收", 10, 82, 8.2],
    ["ending", "結局完成度", 10, 82, 8.2],
  ].map(([key, label, weight, score, weightedPoints]) => ({
    key,
    label,
    weight,
    score,
    weightedPoints,
  }))),
});

function mockShelves() {
  return EXPECTED_PUBLIC_LOUNGE_SHELF_IDS.map((shelfId, index) => ({
    shelfId,
    name: `書架 ${index + 1}`,
    description: `書架 ${index + 1} 的公開說明`,
    order: index + 1,
  }));
}

function mockSummary(overrides = {}) {
  return {
    schemaVersion: "public-lounge-index-entry-v3",
    publicId: MOCK_PUBLIC_ID,
    title: "雨港歸航",
    authorByline: "測試作者",
    authorBylineStatus: "self_entered_unverified",
    storyLibrarySchemaVersion: "story-library-v1",
    shelfId: "group-1",
    primaryTopicId: "topic-001",
    topicIds: ["topic-001"],
    completionStatus: "completed",
    chapterCount: 3,
    wordCount: 8_200,
    completedAt: MOCK_VERSION_PUBLISHED_AT,
    publishedAt: MOCK_VERSION_PUBLISHED_AT,
    versionId: MOCK_VERSION_ID,
    versionNumber: 1,
    versionPublishedAt: MOCK_VERSION_PUBLISHED_AT,
    quality: MOCK_QUALITY,
    qualityAssurance: "private_ai_hub_verified",
    synopsisExcerpt: "一部已完結且可公開閱讀的小說。",
    publicChapterCount: 3,
    ...overrides,
  };
}

function mockPost(overrides = {}) {
  return {
    schemaVersion: "public-lounge-post-v3",
    publicId: MOCK_PUBLIC_ID,
    title: "雨港歸航",
    authorByline: "測試作者",
    authorBylineStatus: "self_entered_unverified",
    storyLibrarySchemaVersion: "story-library-v1",
    shelfId: "group-1",
    primaryTopicId: "topic-001",
    topicIds: ["topic-001"],
    completionStatus: "completed",
    chapterCount: 3,
    wordCount: 8_200,
    completedAt: MOCK_VERSION_PUBLISHED_AT,
    publishedAt: MOCK_VERSION_PUBLISHED_AT,
    versionId: MOCK_VERSION_ID,
    versionNumber: 1,
    versionPublishedAt: MOCK_VERSION_PUBLISHED_AT,
    quality: MOCK_QUALITY,
    qualityAssurance: "private_ai_hub_verified",
    fullSynopsis: "一部已完結且可公開閱讀的小說。",
    publicChapters: [1, 2, 3].map((chapterNumber) => ({
      chapterNumber,
      title: `第${chapterNumber}章`,
      body: "正式正文".repeat(180),
      official: true,
    })),
    ...overrides,
  };
}

function mockList(overrides = {}) {
  return {
    connected: true,
    count: 1,
    totalCount: 1,
    items: [mockSummary()],
    shelves: mockShelves(),
    nextCursor: null,
    ...overrides,
  };
}

function mockReadyInteractionsHealth(overrides = {}) {
  return {
    schemaVersion: INTERACTIONS_HEALTH_SCHEMA_VERSION,
    status: "ready",
    ready: true,
    identity: "supabase_auth_get_user",
    persistence: "postgres_rpc_live",
    migrationVersion: INTERACTIONS_MIGRATION_VERSION,
    counts: null,
    capabilities: {
      oneVotePerWork: true,
      comments: true,
      reports: true,
      authorCommentDeletion: true,
    },
    blockers: [],
    ...overrides,
  };
}

function mockFailClosedInteractionsHealth(overrides = {}) {
  return {
    schemaVersion: INTERACTIONS_HEALTH_SCHEMA_VERSION,
    status: "not_connected",
    ready: false,
    identity: "not_connected",
    persistence: "migration_prepared_not_activated",
    counts: null,
    capabilities: {
      oneVotePerWork: false,
      comments: false,
      reports: false,
      authorCommentDeletion: false,
    },
    blockers: ["feature_flag_disabled", "live_rpc_status_not_verified"],
    ...overrides,
  };
}

function mockFetcher(options = {}) {
  return async (input) => {
    const url = new URL(input);
    const commonHeaders = {
      "Cache-Control": options.cacheControl ?? "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    };
    if (url.pathname === "/api/lounge/health") {
      return Response.json({
        status: "ready",
        connected: true,
        storage: "supabase-private-storage",
        bucket: "novel-public-lounge-v1",
        trustedEligibilityVerifierConnected: false,
        authorDeviceEligibilityAccepted: false,
        trustedAttestationProducer: "private-ai-hub-v5-client-probe-required",
      }, { status: options.healthStatus ?? 200, headers: commonHeaders });
    }
    if (url.pathname === "/api/lounge/interactions/health") {
      return Response.json(
        options.interactionsHealthBody ?? mockReadyInteractionsHealth(),
        {
          status: options.interactionsHealthStatus ?? 200,
          headers: {
            ...commonHeaders,
            "Cache-Control": options.interactionsHealthCacheControl
              ?? options.cacheControl
              ?? "no-store",
          },
        },
      );
    }
    if (url.pathname === "/api/lounge") {
      return Response.json(options.listBody ?? mockList(), {
        status: options.listStatus ?? 200,
        headers: commonHeaders,
      });
    }
    if (url.pathname === `/api/lounge/${MOCK_PUBLIC_ID}`) {
      return Response.json(options.detailBody ?? { connected: true, post: mockPost() }, {
        status: options.detailStatus ?? 200,
        headers: {
          ...commonHeaders,
          "Cache-Control": options.detailCacheControl ?? options.cacheControl ?? "no-store",
        },
      });
    }
    if (url.pathname === "/api/lounge/novel_runtimeabsent001") {
      return Response.json({ error: { code: "PUBLIC_LOUNGE_NOT_FOUND", retryable: false } }, {
        status: options.missingApiStatus ?? 404,
        headers: {
          ...commonHeaders,
          "Cache-Control": options.missingApiCacheControl ?? "no-store",
        },
      });
    }
    if (url.pathname === "/lounge") {
      return new Response(options.pageBody ?? "<!doctype html><title>小說交誼廳</title>", {
        status: options.pageStatus ?? 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === `/lounge/${MOCK_PUBLIC_ID}`) {
      return new Response(
        options.detailPageBody ?? "<!doctype html><title>公開作品</title><p>正在讀取正式公開版本</p>",
        {
          status: options.detailPageStatus ?? 200,
          headers: {
            "Cache-Control": options.detailPageCacheControl ?? "private, no-cache, no-store, max-age=0",
            "Content-Type": "text/html; charset=utf-8",
          },
        },
      );
    }
    if (url.pathname === "/lounge/novel_runtimeabsent001") {
      return new Response("<!doctype html><title>公開作品</title><p>正在讀取正式公開版本</p>", {
        status: options.missingPageStatus ?? 200,
        headers: {
          "Cache-Control": options.missingPageCacheControl ?? "private, no-cache, no-store, max-age=0",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    }
    return new Response("not found", { status: 404 });
  };
}

async function runSelfTest() {
  const common = {
    origins: ["https://novel.example"],
    phase: "self-test",
    attempts: 1,
    retryDelayMs: 0,
    interactionsExpectedState: "ready",
  };
  const passing = await verifyPublicLoungeRuntime({ ...common, fetcher: mockFetcher() });
  assert.equal(passing.status, "PASS");
  assert.equal(passing.responseBodiesStored, false);
  assert.equal(passing.privatePayloadStored, false);
  assert.equal(passing.origins[0]?.surfaces?.list?.count, 1);
  assert.equal(passing.origins[0]?.surfaces?.detailApi?.versionId, MOCK_VERSION_ID);
  assert.equal(passing.origins[0]?.surfaces?.detailPage?.status, 200);
  assert.equal(passing.origins[0]?.surfaces?.missingDetailApi?.status, 404);
  assert.equal(passing.origins[0]?.surfaces?.missingDetailPage?.status, 200);
  assert.equal(passing.interactionsExpectedState, "ready");
  assert.equal(passing.origins[0]?.surfaces?.interactionsHealth?.status, 200);
  assert.equal(passing.origins[0]?.surfaces?.interactionsHealth?.expectedState, "ready");
  assert.match(
    passing.origins[0]?.surfaces?.interactionsHealth?.bodyDigest ?? "",
    /^[a-f0-9]{64}$/u,
  );
  assert.equal(
    Object.hasOwn(passing.origins[0]?.surfaces?.interactionsHealth ?? {}, "body"),
    false,
  );

  const intentionallyFailClosed = await verifyPublicLoungeRuntime({
    ...common,
    interactionsExpectedState: "fail-closed",
    fetcher: mockFetcher({
      interactionsHealthStatus: 503,
      interactionsHealthBody: mockFailClosedInteractionsHealth(),
    }),
  });
  assert.equal(intentionallyFailClosed.status, "PASS");
  assert.equal(intentionallyFailClosed.interactionsExpectedState, "fail-closed");
  assert.equal(
    intentionallyFailClosed.origins[0]?.surfaces?.interactionsHealth?.status,
    503,
  );

  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      interactionsExpectedState: "fail-closed",
      fetcher: mockFetcher({
        interactionsHealthStatus: 503,
        interactionsHealthBody: mockFailClosedInteractionsHealth({
          blockers: ["live_rpc_status_not_verified"],
        }),
      }),
    }),
    (error) => error.report?.findings.some((finding) => (
      finding.surface === "lounge-interactions-health"
      && finding.code === "INTERACTIONS_FAIL_CLOSED_NOT_INTENTIONAL"
    )),
  );

  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      fetcher: mockFetcher({
        interactionsHealthBody: mockReadyInteractionsHealth({
          migrationVersion: "public_lounge_interactions_v1_999",
        }),
      }),
    }),
    (error) => error.report?.findings.some((finding) => (
      finding.surface === "lounge-interactions-health"
      && finding.code === "INTERACTIONS_HEALTH_CONTRACT_INVALID"
    )),
  );

  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      fetcher: mockFetcher({
        interactionsHealthBody: mockReadyInteractionsHealth({
          capabilities: {
            oneVotePerWork: true,
            comments: true,
            reports: true,
            authorCommentDeletion: false,
          },
        }),
      }),
    }),
    (error) => error.report?.findings.some((finding) => (
      finding.surface === "lounge-interactions-health"
      && finding.code === "INTERACTIONS_HEALTH_CONTRACT_INVALID"
    )),
  );

  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      interactionsExpectedState: "disabled",
      fetcher: mockFetcher(),
    }),
    /PUBLIC_LOUNGE_INTERACTIONS_EXPECTED_STATE_INVALID/u,
  );

  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      fetcher: mockFetcher({
        listBody: {
          ...mockList(),
          prompt: "must never leave the server",
          canon: { private: true },
          storyBible: { private: true },
          modelDigest: "a".repeat(64),
          completionFingerprint: "b".repeat(64),
          modelReceipt: { rawDraft: "must never leave the server" },
          executionTrace: ["must never leave the server"],
          projectId: "private-project-id",
          reviewId: "private-review-id",
          userEmail: "private@example.invalid",
          managementToken: "private-management-token",
          eligibilityTicket: "private-eligibility-ticket",
        },
      }),
    }),
    (error) => {
      const paths = error.report?.findings
        .filter((finding) => finding.code === "PRIVATE_PAYLOAD_KEY_EXPOSED")
        .map((finding) => finding.path) ?? [];
      return [
        "prompt",
        "canon",
        "storyBible",
        "modelDigest",
        "completionFingerprint",
        "modelReceipt",
        "rawDraft",
        "executionTrace",
        "projectId",
        "reviewId",
        "userEmail",
        "managementToken",
        "eligibilityTicket",
      ]
        .every((key) => paths.some((path) => path.endsWith(`.${key}`)));
    },
  );
  for (const shelves of [
    mockShelves().slice(0, 7),
    mockShelves().map((shelf, index) => (index === 1 ? { ...shelf, shelfId: "group-1" } : shelf)),
    mockShelves().map((shelf, index) => (index === 2 ? { ...shelf, order: 99 } : shelf)),
    mockShelves().map((shelf, index) => (index === 3 ? { ...shelf, unexpected: true } : shelf)),
  ]) {
    await assert.rejects(
      verifyPublicLoungeRuntime({
        ...common,
        fetcher: mockFetcher({ listBody: mockList({ shelves }) }),
      }),
      (error) => error.report?.findings.some((finding) => finding.code === "SHELVES_CONTRACT_INVALID"),
    );
  }
  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      fetcher: mockFetcher({
        listBody: mockList({
          items: [mockSummary({ unexpectedPublicField: "must fail exact allowlist" })],
        }),
      }),
    }),
    (error) => error.report?.findings.some((finding) => (
      finding.code === "LIST_ITEM_VERSION_CONTRACT_INVALID"
    )),
  );
  await assert.rejects(
    verifyPublicLoungeRuntime({ ...common, fetcher: mockFetcher({ cacheControl: "public, max-age=60" }) }),
    (error) => error.report?.findings.some((finding) => finding.code === "CACHE_CONTROL_NOT_NO_STORE"),
  );
  await assert.rejects(
    verifyPublicLoungeRuntime({ ...common, fetcher: mockFetcher({ pageStatus: 503 }) }),
    (error) => error.report?.findings.some((finding) => (
      finding.surface === "lounge-page" && finding.code === "HTTP_NOT_200"
    )),
  );
  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      fetcher: mockFetcher({ pageBody: '<script>self.__next={"hiddenDraft":"private"}</script>小說交誼廳' }),
    }),
    (error) => error.report?.findings.some((finding) => (
      finding.surface === "lounge-page" && finding.code === "PRIVATE_PAYLOAD_KEY_EXPOSED"
    )),
  );
  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      fetcher: mockFetcher({
        detailBody: { connected: true, post: mockPost({ schemaVersion: "public-lounge-post-v2" }) },
      }),
    }),
    (error) => error.report?.findings.some((finding) => (
      finding.surface === "lounge-detail-api" && finding.code === "DETAIL_VERSION_CONTRACT_INVALID"
    )),
  );
  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      fetcher: mockFetcher({ detailCacheControl: "public, max-age=60" }),
    }),
    (error) => error.report?.findings.some((finding) => (
      finding.surface === "lounge-detail-api" && finding.code === "CACHE_CONTROL_NOT_NO_STORE"
    )),
  );
  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      fetcher: mockFetcher({
        detailBody: {
          connected: true,
          post: mockPost({ fullSynopsis: "system prompt: { hidden rules }" }),
        },
      }),
    }),
    (error) => error.report?.findings.some((finding) => (
      finding.surface === "lounge-detail-api" && finding.code === "PRIVATE_PAYLOAD_TEXT_EXPOSED"
    )),
  );
  await assert.rejects(
    verifyPublicLoungeRuntime({
      ...common,
      fetcher: mockFetcher({
        detailPageBody: '<script>self.__next={"storyBible":"private"}</script><p>正在讀取正式公開版本</p>',
      }),
    }),
    (error) => error.report?.findings.some((finding) => (
      finding.surface === "lounge-detail-page" && finding.code === "PRIVATE_PAYLOAD_KEY_EXPOSED"
    )),
  );
  const falsePositiveControl = await verifyPublicLoungeRuntime({
    ...common,
    fetcher: mockFetcher({
      detailBody: {
        connected: true,
        post: mockPost({ fullSynopsis: "她用 Canon 相機拍攝，並討論故事的 canon 傳統。" }),
      },
      detailPageBody: "<!doctype html><p>Canon 相機與故事的 canon 傳統。</p><p>正在讀取正式公開版本</p>",
    }),
  });
  assert.equal(falsePositiveControl.status, "PASS");
  console.log("PUBLIC_LOUNGE_RUNTIME_GATE_SELF_TEST_PASS");
}

function parseOrigins() {
  const explicit = String(process.env.PUBLIC_LOUNGE_RUNTIME_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const fallbacks = explicit.length > 0
    ? explicit
    : [
        process.env.STAGED_URL,
        process.env.PRIMARY_ALIAS ? `https://${process.env.PRIMARY_ALIAS}` : "",
        process.env.MIRROR_ALIAS ? `https://${process.env.MIRROR_ALIAS}` : "",
      ].filter(Boolean);
  return [...new Set(fallbacks.map((value) => {
    const url = new URL(value);
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password) {
      throw new Error("PUBLIC_LOUNGE_ORIGIN_INVALID");
    }
    return url.origin;
  }))];
}

function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    return;
  }
  const reportPath = String(process.env.PUBLIC_LOUNGE_RUNTIME_REPORT_PATH || "").trim();
  let report = null;
  try {
    report = await verifyPublicLoungeRuntime({
      origins: parseOrigins(),
      phase: String(process.env.PUBLIC_LOUNGE_RUNTIME_PHASE || "").trim(),
      interactionsExpectedState: normalizeInteractionsExpectedState(
        process.env.PUBLIC_LOUNGE_INTERACTIONS_EXPECTED_STATE,
      ),
      fetchTimeoutMs: boundedInteger(
        "PUBLIC_LOUNGE_RUNTIME_FETCH_TIMEOUT_MS",
        DEFAULT_FETCH_TIMEOUT_MS,
        100,
        30_000,
      ),
      attempts: boundedInteger("PUBLIC_LOUNGE_RUNTIME_ATTEMPTS", DEFAULT_ATTEMPTS, 1, 20),
      retryDelayMs: boundedInteger(
        "PUBLIC_LOUNGE_RUNTIME_RETRY_DELAY_MS",
        DEFAULT_RETRY_DELAY_MS,
        0,
        5_000,
      ),
    });
  } catch (error) {
    report = error?.report ?? {
      schemaVersion: "public-lounge-runtime-gate-v1",
      status: "FAIL",
      phase: String(process.env.PUBLIC_LOUNGE_RUNTIME_PHASE || "unknown"),
      interactionsExpectedState: INTERACTIONS_EXPECTED_STATES.includes(
        String(process.env.PUBLIC_LOUNGE_INTERACTIONS_EXPECTED_STATE || "ready").trim(),
      )
        ? String(process.env.PUBLIC_LOUNGE_INTERACTIONS_EXPECTED_STATE || "ready").trim()
        : "invalid",
      checkedAt: new Date().toISOString(),
      origins: [],
      findings: [{ origin: null, surface: "gate", code: String(error?.code || error?.message || "GATE_FAILED") }],
      responseBodiesStored: false,
      privatePayloadStored: false,
    };
    if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    throw error;
  }
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "public_lounge_runtime_gate_failed",
    code: String(error?.code || error?.message || "PUBLIC_LOUNGE_RUNTIME_GATE_FAILED"),
  }));
  process.exitCode = 1;
});
