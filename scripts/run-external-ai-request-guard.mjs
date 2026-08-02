import assert from "node:assert/strict";
import {
  assertExternalAIRequestOrigin,
  EXTERNAL_AI_REQUEST_POLICY,
  externalAIClientIdentifier,
  ExternalAIRequestGuardError,
  readExternalAIJsonBody,
  reserveExternalAIRequest,
  resetExternalAIRequestGuardForTests,
} from "../lib/novel-ai/providers/external/external-request-guard.server.ts";

const endpoint = "https://novel-orcin.vercel.app/api/ai/external/generate";

function request(body = { prompt: "測試" }, headers = {}) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://novel-orcin.vercel.app",
      Referer: "https://novel-orcin.vercel.app/studio/settings/ai",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "NovelGuardTest/1.0",
      "Accept-Language": "zh-TW",
      "X-Forwarded-For": "203.0.113.10",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function isGuardError(code) {
  return (error) => error instanceof ExternalAIRequestGuardError && error.code === code;
}

try {
  const valid = request({ prompt: "同源測試", maxOutputTokens: 512 });
  assert.doesNotThrow(() => assertExternalAIRequestOrigin(valid));
  assert.deepEqual(await readExternalAIJsonBody(valid.clone()), { prompt: "同源測試", maxOutputTokens: 512 });

  assert.throws(
    () => assertExternalAIRequestOrigin(request({}, { Origin: "https://attacker.example", Referer: "https://attacker.example/" })),
    isGuardError("EXTERNAL_AI_CROSS_ORIGIN_BLOCKED"),
  );
  assert.throws(
    () => assertExternalAIRequestOrigin(request({}, { Origin: "", Referer: "" })),
    isGuardError("EXTERNAL_AI_CROSS_ORIGIN_BLOCKED"),
  );
  assert.throws(
    () => assertExternalAIRequestOrigin(request({}, { "Sec-Fetch-Site": "same-site" })),
    isGuardError("EXTERNAL_AI_CROSS_ORIGIN_BLOCKED"),
  );
  await assert.rejects(
    readExternalAIJsonBody(request("{}", { "Content-Type": "text/plain" })),
    isGuardError("EXTERNAL_AI_JSON_REQUIRED"),
  );
  await assert.rejects(
    readExternalAIJsonBody(request("{not-json")),
    isGuardError("INVALID_JSON"),
  );
  await assert.rejects(
    readExternalAIJsonBody(request(JSON.stringify({ prompt: "字".repeat(EXTERNAL_AI_REQUEST_POLICY.maxBodyBytes) }))),
    isGuardError("EXTERNAL_AI_REQUEST_TOO_LARGE"),
  );

  const firstClient = externalAIClientIdentifier(request());
  const sameClient = externalAIClientIdentifier(request());
  const otherClient = externalAIClientIdentifier(request({}, { "X-Forwarded-For": "203.0.113.11" }));
  assert.equal(firstClient, sameClient);
  assert.notEqual(firstClient, otherClient);
  assert.equal(firstClient.includes("203.0.113.10"), false, "client identifier must not retain the raw IP address");
  assert.match(firstClient, /^novel_[a-f0-9]{32}$/u);

  resetExternalAIRequestGuardForTests();
  const concurrentOne = reserveExternalAIRequest(firstClient, 64, 1_000);
  const concurrentTwo = reserveExternalAIRequest(firstClient, 64, 1_000);
  assert.throws(
    () => reserveExternalAIRequest(firstClient, 64, 1_000),
    isGuardError("EXTERNAL_AI_CONCURRENCY_LIMIT"),
  );
  concurrentOne.release();
  concurrentOne.release();
  concurrentTwo.release();

  resetExternalAIRequestGuardForTests();
  for (let index = 0; index < EXTERNAL_AI_REQUEST_POLICY.maxRequestsPerWindow; index += 1) {
    const lease = reserveExternalAIRequest(firstClient, 64, 2_000);
    assert.ok(Number(lease.headers["X-RateLimit-Remaining"]) >= 0);
    lease.release();
  }
  assert.throws(
    () => reserveExternalAIRequest(firstClient, 64, 2_000),
    isGuardError("EXTERNAL_AI_RATE_LIMITED"),
  );

  resetExternalAIRequestGuardForTests();
  for (let index = 0; index < 4; index += 1) {
    const lease = reserveExternalAIRequest(firstClient, 8_192, 3_000);
    lease.release();
  }
  assert.throws(
    () => reserveExternalAIRequest(firstClient, 8_192, 3_000),
    isGuardError("EXTERNAL_AI_TOKEN_BUDGET_EXCEEDED"),
  );

  resetExternalAIRequestGuardForTests();
  const globalLeases = Array.from({ length: EXTERNAL_AI_REQUEST_POLICY.maxActivePerInstance }, (_, index) =>
    reserveExternalAIRequest(`client_${index}`, 64, 4_000));
  assert.throws(
    () => reserveExternalAIRequest("one_more_client", 64, 4_000),
    isGuardError("EXTERNAL_AI_CONCURRENCY_LIMIT"),
  );
  for (const lease of globalLeases) lease.release();

  console.log(JSON.stringify({
    status: "PASS",
    sameOriginOnly: true,
    rawAddressRetained: false,
    bodyByteLimit: EXTERNAL_AI_REQUEST_POLICY.maxBodyBytes,
    requestsPerWindow: EXTERNAL_AI_REQUEST_POLICY.maxRequestsPerWindow,
    reservedOutputTokensPerWindow: EXTERNAL_AI_REQUEST_POLICY.maxReservedOutputTokensPerWindow,
    perClientConcurrency: EXTERNAL_AI_REQUEST_POLICY.maxActivePerClient,
    perInstanceConcurrency: EXTERNAL_AI_REQUEST_POLICY.maxActivePerInstance,
  }, null, 2));
} finally {
  resetExternalAIRequestGuardForTests();
}
