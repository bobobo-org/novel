import assert from "node:assert/strict";
import { PublicLoungeError } from "../lib/novel-ai/public-lounge/contract.ts";
import { createPublicLoungeInteractionHttpHandlers } from "../lib/novel-ai/public-lounge/interactions-http.ts";
import {
  PUBLIC_LOUNGE_INTERACTIONS_API_SCHEMA_VERSION,
  PublicLoungeInteractionError,
} from "../lib/novel-ai/public-lounge/interactions.ts";

const ORIGIN = "https://novel.example";
const PUBLIC_ID = "novel_abcdefghijklmnop";
const VERSION_ID = "version_abcdefghijklmnop";
const COMMENT_ID = "11111111-1111-4111-8111-111111111111";

function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.mutation) {
    headers.set("Origin", options.origin ?? ORIGIN);
    headers.set("Sec-Fetch-Site", "same-origin");
    headers.set("Content-Type", "application/json");
  }
  return new Request(`${ORIGIN}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function service(overrides = {}) {
  const calls = [];
  return {
    calls,
    reserveRequest: async (identity, scope) => {
      calls.push(["reserve", identity, scope]);
    },
    get: async (publicId) => {
      calls.push(["get", publicId]);
      return {
        publicId,
        versionId: VERSION_ID,
        chapterCount: 12,
      };
    },
    ...overrides,
  };
}

function gateway(overrides = {}) {
  const calls = [];
  return {
    calls,
    read: async (incoming, input) => {
      calls.push(["read", incoming.headers.get("authorization"), input]);
      return {
        schemaVersion: PUBLIC_LOUNGE_INTERACTIONS_API_SCHEMA_VERSION,
        authenticated: false,
        selected: false,
        voteCount: 7,
        commentCount: 1,
        comments: [],
        nextCursor: null,
      };
    },
    setVote: async (_incoming, publicId, versionId, selected) => {
      calls.push(["vote", publicId, versionId, selected]);
      return { selected, voteCount: selected ? 8 : 7 };
    },
    addComment: async (_incoming, input) => {
      calls.push(["comment", input]);
      return { commentId: COMMENT_ID };
    },
    deleteComment: async (_incoming, publicId, versionId, commentId, reason) => {
      calls.push(["delete", publicId, versionId, commentId, reason]);
    },
    report: async (_incoming, input) => {
      calls.push(["report", input]);
      return { reportId: COMMENT_ID };
    },
    ...overrides,
  };
}

{
  const fakeService = service();
  const fakeGateway = gateway();
  const handlers = createPublicLoungeInteractionHttpHandlers(
    () => fakeGateway,
    () => fakeService,
    () => "a".repeat(64),
  );
  const response = await handlers.read(
    request(`/api/lounge/interactions/${PUBLIC_ID}?limit=1`),
    PUBLIC_ID,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal((await response.json()).snapshot.voteCount, 7);
  assert.deepEqual(fakeService.calls, [
    ["reserve", "a".repeat(64), "read"],
    ["get", PUBLIC_ID],
  ]);
  assert.deepEqual(fakeGateway.calls[0][2], {
    publicId: PUBLIC_ID,
    currentVersionId: VERSION_ID,
    chapterCount: 12,
    chapterNumber: null,
    limit: 1,
    before: null,
  });
}

{
  const fakeService = service();
  const fakeGateway = gateway();
  const handlers = createPublicLoungeInteractionHttpHandlers(
    () => fakeGateway,
    () => fakeService,
    () => "a".repeat(64),
  );
  const response = await handlers.vote(request(`/api/lounge/interactions/${PUBLIC_ID}/vote`, {
    method: "PUT",
    mutation: true,
    origin: "https://attacker.example",
    body: { selected: true },
  }), PUBLIC_ID);
  assert.equal(response.status, 403);
  assert.equal(fakeService.calls.length, 0);
  assert.equal(fakeGateway.calls.length, 0);
}

{
  const fakeGateway = gateway();
  const handlers = createPublicLoungeInteractionHttpHandlers(
    () => fakeGateway,
    () => service(),
    () => "a".repeat(64),
  );
  const rejected = await handlers.vote(request(`/api/lounge/interactions/${PUBLIC_ID}/vote`, {
    method: "PUT",
    mutation: true,
    body: { selected: true, userId: "22222222-2222-4222-8222-222222222222" },
  }), PUBLIC_ID);
  assert.equal(rejected.status, 400);
  assert.equal(fakeGateway.calls.length, 0);

  const accepted = await handlers.vote(request(`/api/lounge/interactions/${PUBLIC_ID}/vote`, {
    method: "PUT",
    mutation: true,
    body: { selected: true },
  }), PUBLIC_ID);
  assert.equal(accepted.status, 200);
  assert.deepEqual(fakeGateway.calls.at(-1), ["vote", PUBLIC_ID, VERSION_ID, true]);
}

{
  const fakeGateway = gateway();
  const handlers = createPublicLoungeInteractionHttpHandlers(
    () => fakeGateway,
    () => service(),
    () => "a".repeat(64),
  );
  const response = await handlers.comment(request(`/api/lounge/interactions/${PUBLIC_ID}/comments`, {
    method: "POST",
    mutation: true,
    body: { chapterNumber: 13, displayName: "讀者", body: "這段很有張力。" },
  }), PUBLIC_ID);
  assert.equal(response.status, 400);
  assert.equal(fakeGateway.calls.length, 0);
}

{
  const fakeGateway = gateway();
  const handlers = createPublicLoungeInteractionHttpHandlers(
    () => fakeGateway,
    () => service(),
    () => "a".repeat(64),
  );
  const response = await handlers.report(request(`/api/lounge/interactions/${PUBLIC_ID}/reports`, {
    method: "POST",
    mutation: true,
    body: { targetCommentId: COMMENT_ID, reasonCode: "spam", details: "重複廣告" },
  }), PUBLIC_ID);
  assert.equal(response.status, 201);
  assert.deepEqual(fakeGateway.calls.at(-1), ["report", {
    publicId: PUBLIC_ID,
    currentVersionId: VERSION_ID,
    targetCommentId: COMMENT_ID,
    reasonCode: "spam",
    details: "重複廣告",
  }]);
}

{
  const fakeGateway = gateway();
  const retracted = service({
    get: async () => {
      throw new PublicLoungeError("PUBLIC_LOUNGE_NOT_FOUND", 404);
    },
  });
  const response = await createPublicLoungeInteractionHttpHandlers(
    () => fakeGateway,
    () => retracted,
    () => "a".repeat(64),
  ).read(request(`/api/lounge/interactions/${PUBLIC_ID}`), PUBLIC_ID);
  assert.equal(response.status, 404);
  assert.equal(fakeGateway.calls.length, 0);
}

{
  const stale = gateway({
    read: async () => {
      throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
    },
  });
  const response = await createPublicLoungeInteractionHttpHandlers(
    () => stale,
    () => service(),
    () => "a".repeat(64),
  ).read(request(`/api/lounge/interactions/${PUBLIC_ID}`), PUBLIC_ID);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED");
}

console.log(JSON.stringify({
  status: "passed",
  assertions: 21,
  scope: "in_memory_http_contract_no_production_claim",
}));
