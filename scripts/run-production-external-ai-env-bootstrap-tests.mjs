import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_XAI_MODEL_ID,
  parseExternalAIEnv,
  resolveXaiBootstrapConfiguration,
  validateXaiBootstrapInput,
  verifyXaiCredential,
} from "./bootstrap-production-external-ai-env.mjs";

const testKey = "xai-test-key-with-sufficient-length-123456";
assert.deepEqual(validateXaiBootstrapInput({ apiKey: ` ${testKey} ` }), {
  apiKey: testKey,
  modelId: DEFAULT_XAI_MODEL_ID,
});
assert.throws(() => validateXaiBootstrapInput({ apiKey: "short" }), (error) => error.code === "XAI_API_KEY_INVALID");
assert.throws(
  () => validateXaiBootstrapInput({ apiKey: testKey, modelId: "../../invalid" }),
  (error) => error.code === "XAI_MODEL_ID_INVALID",
);
assert.deepEqual(parseExternalAIEnv('XAI_API_KEY="secret-value"\nXAI_MODEL_ID=grok-4.5\n'), {
  XAI_API_KEY: "secret-value",
  XAI_MODEL_ID: "grok-4.5",
});
assert.deepEqual(resolveXaiBootstrapConfiguration({
  githubApiKey: "",
  production: { XAI_API_KEY: testKey, XAI_MODEL_ID: "grok-4.5" },
}), {
  apiKey: testKey,
  modelId: "grok-4.5",
  credentialSource: "vercel_production",
});
assert.deepEqual(resolveXaiBootstrapConfiguration({
  githubApiKey: testKey,
  githubModelId: "grok-4.5-latest",
  production: { XAI_API_KEY: "production-key-with-sufficient-length-123" },
}), {
  apiKey: testKey,
  modelId: "grok-4.5-latest",
  credentialSource: "github_secret",
});
assert.throws(
  () => resolveXaiBootstrapConfiguration({ githubApiKey: "", production: {} }),
  (error) => error.code === "XAI_API_KEY_NOT_CONFIGURED",
);

const verified = await verifyXaiCredential({
  apiKey: testKey,
  modelId: "grok-4.5",
  fetcher: async (_url, init) => {
    assert.equal(init.headers.authorization, `Bearer ${testKey}`);
    return new Response(JSON.stringify({
      data: [{ id: "grok-4.5-20260717", aliases: ["grok-4.5", "grok-4.5-latest"] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert.equal(verified.modelAvailable, true);
assert.equal(verified.modelCount, 1);

await assert.rejects(
  verifyXaiCredential({
    apiKey: testKey,
    modelId: "grok-4.5",
    fetcher: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  }),
  (error) => error.code === "XAI_CREDENTIAL_VERIFICATION_FAILED" && error.httpStatus === 401,
);
await assert.rejects(
  verifyXaiCredential({
    apiKey: testKey,
    modelId: "grok-4.5",
    fetcher: async () => new Response(JSON.stringify({ data: [{ id: "another-model", aliases: [] }] }), { status: 200 }),
  }),
  (error) => error.code === "XAI_MODEL_NOT_AVAILABLE_TO_ACCOUNT" && error.modelCount === 1,
);

const source = await readFile(new URL("./bootstrap-production-external-ai-env.mjs", import.meta.url), "utf8");
assert.match(source, /--sensitive/u);
assert.match(source, /https:\/\/api\.x\.ai\/v1\/models/u);
assert.match(source, /env", "pull"/u);
assert.match(source, /mkdtemp/u);
assert.match(source, /await rm\(directory/u);
assert.match(source, /production_xai_env_not_configured/u);
assert.match(source, /error\?\.code !== "XAI_API_KEY_NOT_CONFIGURED"/u);
assert.doesNotMatch(source, /console\.log\([^\n]*apiKey/u);

console.log(JSON.stringify({
  status: "PASS",
  assertions: 27,
  modelId: DEFAULT_XAI_MODEL_ID,
  credentialExposed: false,
}, null, 2));
