export function createHarness(name) {
  let pass = 0;
  let fail = 0;
  const failures = [];
  function ok(condition, label, detail = "") {
    if (condition) {
      pass += 1;
      console.log(`PASS ${name}: ${label}`);
      return;
    }
    fail += 1;
    failures.push({ label, detail });
    console.error(`FAIL ${name}: ${label}${detail ? ` - ${detail}` : ""}`);
  }
  function equal(actual, expected, label) {
    ok(Object.is(actual, expected), label, `expected=${expected} actual=${actual}`);
  }
  function includes(text, needle, label) {
    ok(String(text).includes(needle), label, `missing=${needle}`);
  }
  function notIncludes(text, needle, label) {
    ok(!String(text).includes(needle), label, `unexpected=${needle}`);
  }
  function finish() {
    console.log(`${name}: PASS=${pass} FAIL=${fail} SKIP=0`);
    if (fail > 0) {
      console.error(JSON.stringify(failures, null, 2));
      process.exit(1);
    }
  }
  return { ok, equal, includes, notIncludes, finish };
}

export function mockFetch(routes, calls = []) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const route = routes.find((entry) => String(url).endsWith(entry.path) && (!entry.method || entry.method === (options.method ?? "GET")));
    if (!route) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    if (route.delayMs) await new Promise((resolve) => setTimeout(resolve, route.delayMs));
    const body = typeof route.body === "function" ? route.body(url, options) : route.body;
    return new Response(JSON.stringify(body), { status: route.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
}

export const goodHealth = {
  localRuntimeVersion: "h2w1-test-runtime",
  ollamaStatus: "ready",
  selectedModel: "qwen2.5:3b",
  selectedStorage: "sqlite-local",
  dataLeftDevice: false,
  handshake: {
    protocolVersion: "novel-local-runtime-v1",
    runtimeVersion: "h2w1-test-runtime",
    sessionId: "session-test",
    serverNonce: "server-nonce",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    allowedOrigins: ["https://novel-orcin.vercel.app"],
    capabilities: ["generation", "embedding", "sqlite", "streaming", "cancel"],
    ollamaStatus: "ready",
    installedModels: ["qwen2.5:3b"],
    selectedStorage: "sqlite-local",
  },
};
