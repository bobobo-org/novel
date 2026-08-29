import assert from "node:assert/strict";
import {
  PUBLIC_LOUNGE_MAX_REQUEST_BYTES,
  PublicLoungeError,
} from "../lib/novel-ai/public-lounge/contract.ts";
import {
  createPublicLoungeHttpHandlers,
  PublicLoungeRateLimiter,
} from "../lib/novel-ai/public-lounge/http.ts";

const ORIGIN = "https://novel.example";
const PUBLIC_ID = "novel_abcdefghijklmnop";
const TOKEN = "A".repeat(43);

function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.origin !== undefined) headers.set("Origin", options.origin);
  if (options.sameOriginFetch) headers.set("Sec-Fetch-Site", "same-origin");
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.json);
  }
  return new Request(`${ORIGIN}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });
}

function fakePost() {
  return {
    publicId: PUBLIC_ID,
    title: "霧港歸航",
    authorByline: "林舟",
    authorBylineStatus: "self_entered_unverified",
    category: "奇幻",
    completionStatus: "completed",
    chapterCount: 12,
    wordCount: 86_420,
    completedAt: "2026-08-28T08:30:00.000Z",
    publishedAt: "2026-08-29T03:00:00.000Z",
    quality: { totalScore: 86, threshold: 80, breakdown: [] },
    fullSynopsis: "全書大綱",
    publicChapters: [],
  };
}

function fakeService(overrides = {}) {
  const calls = [];
  return {
    calls,
    health: async () => ({
      connected: true,
      storage: "supabase-private-storage",
      bucket: "novel-public-lounge-v1",
      trustedEligibilityVerifierConnected: true,
      trustedAttestationProducer: "not-available-in-this-release",
    }),
    list: async (query) => {
      calls.push(["list", query]);
      return {
        items: [fakePost()],
        nextCursor: "next-page",
        totalCount: 250,
        categories: ["奇幻", "推理"],
      };
    },
    get: async (publicId) => {
      calls.push(["get", publicId]);
      return fakePost();
    },
    publish: async (input) => {
      calls.push(["publish", input]);
      return { post: fakePost(), managementToken: TOKEN };
    },
    issueEligibility: async (input) => {
      calls.push(["issueEligibility", input]);
      return { eligibilityTicket: TOKEN };
    },
    overwrite: async (publicId, token, input) => {
      calls.push(["overwrite", publicId, token, input]);
      return fakePost();
    },
    retract: async (publicId, token) => {
      calls.push(["retract", publicId, token]);
    },
    ...overrides,
  };
}

const service = fakeService();
const handlers = createPublicLoungeHttpHandlers(
  () => service,
  new PublicLoungeRateLimiter({ mutationLimit: 20 }),
);

{
  const response = await handlers.health(request("/api/lounge/health"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ready",
    connected: true,
    storage: "supabase-private-storage",
    bucket: "novel-public-lounge-v1",
    trustedEligibilityVerifierConnected: true,
    trustedAttestationProducer: "not-available-in-this-release",
  });
}

{
  const response = await handlers.list(request("/api/lounge?q=霧&category=奇幻&cursor=opaque&limit=24"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cache-control").includes("s-maxage"), false);
  const body = await response.json();
  assert.equal(body.connected, true);
  assert.equal(body.count, 1);
  assert.equal(body.totalCount, 250);
  assert.equal(body.nextCursor, "next-page");
  assert.deepEqual(body.categories, ["奇幻", "推理"]);
  assert.deepEqual(service.calls.at(-1), ["list", {
    search: "霧",
    category: "奇幻",
    completedOnly: true,
    cursor: "opaque",
    limit: 24,
  }]);
}

{
  const before = service.calls.length;
  const response = await handlers.list(request("/api/lounge?limit=24x"));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_CURSOR_INVALID");
  assert.equal(service.calls.length, before);
}

{
  const response = await handlers.eligibility(request("/api/lounge/eligibility", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    json: { signedAttestation: true },
  }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).proof.eligibilityTicket, TOKEN);
  assert.deepEqual(service.calls.at(-1), ["issueEligibility", { signedAttestation: true }]);
}

{
  const response = await handlers.get(request(`/api/lounge/${PUBLIC_ID}`), PUBLIC_ID);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cache-control").includes("stale-while-revalidate"), false);
  assert.equal((await response.json()).post.publicId, PUBLIC_ID);
}

for (const origin of [undefined, "https://attacker.example"]) {
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin,
    json: { visible: true },
  }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_ORIGIN_INVALID");
}

{
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    headers: { "Sec-Fetch-Site": "same-site" },
    json: { visible: true },
  }));
  assert.equal(response.status, 403);
}

{
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    json: { visible: true },
  }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.managementToken, TOKEN);
  assert.deepEqual(service.calls.at(-1), ["publish", { visible: true }]);
}

{
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { "Content-Type": "text/plain" },
    body: "{}",
  }));
  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_PAYLOAD_INVALID");
}

{
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(PUBLIC_LOUNGE_MAX_REQUEST_BYTES + 1),
    },
    body: "{}",
  }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_PAYLOAD_TOO_LARGE");
}

{
  const oversized = `{"text":"${"漢".repeat(Math.ceil(PUBLIC_LOUNGE_MAX_REQUEST_BYTES / 3) + 10)}"}`;
  const response = await handlers.publish(request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { "Content-Type": "application/json" },
    body: oversized,
  }));
  assert.equal(response.status, 413);
}

{
  const response = await handlers.overwrite(request(`/api/lounge/${PUBLIC_ID}`, {
    method: "PUT",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { Authorization: `Bearer ${TOKEN}` },
    json: { title: "修訂" },
  }), PUBLIC_ID);
  assert.equal(response.status, 200);
  assert.deepEqual(service.calls.at(-1), ["overwrite", PUBLIC_ID, TOKEN, { title: "修訂" }]);
}

{
  const response = await handlers.retract(request(`/api/lounge/${PUBLIC_ID}`, {
    method: "DELETE",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { Authorization: `Bearer ${TOKEN}` },
  }), PUBLIC_ID);
  assert.equal(response.status, 204);
  assert.deepEqual(service.calls.at(-1), ["retract", PUBLIC_ID, TOKEN]);
}

{
  const strictLimiter = new PublicLoungeRateLimiter({ mutationLimit: 1, windowMs: 60_000 });
  const limitedHandlers = createPublicLoungeHttpHandlers(() => fakeService(), strictLimiter);
  const publishRequest = () => request("/api/lounge", {
    method: "POST",
    origin: ORIGIN,
    sameOriginFetch: true,
    headers: { "x-forwarded-for": "203.0.113.10" },
    json: { visible: true },
  });
  assert.equal((await limitedHandlers.publish(publishRequest())).status, 201);
  const limited = await limitedHandlers.publish(publishRequest());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
}

{
  const failing = fakeService({
    list: async () => {
      throw new Error("secret Supabase backend detail");
    },
  });
  const response = await createPublicLoungeHttpHandlers(() => failing).list(request("/api/lounge"));
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.match(text, /PUBLIC_LOUNGE_NOT_CONNECTED/u);
  assert.equal(text.includes("secret Supabase"), false);
}

{
  const disconnected = fakeService({
    list: async () => {
      throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_CONNECTED", 503, true);
    },
  });
  const response = await createPublicLoungeHttpHandlers(() => disconnected).list(request("/api/lounge"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_NOT_CONNECTED");
}

console.log("PUBLIC_LOUNGE_API_TESTS_PASS");
