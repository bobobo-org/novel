import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyXaiProductionEnvironmentMutations,
  DEFAULT_XAI_MODEL_ID,
  planXaiProductionChanges,
  PRODUCTION_EXTERNAL_AI_MUTATION_KEYS,
  parseExternalAIEnv,
  resolveXaiBootstrapConfiguration,
  validateXaiBootstrapInput,
  verifyXaiCredential,
} from "./bootstrap-production-external-ai-env.mjs";
import { planInvalidOptionalOpenAiProductionRemoval } from "./production-environment-governance.mjs";

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

const auditedOptionalOpenAiTruth = {
  openai: {
    removalAuthorized: true,
    runtimeState: "credential_revoked",
    credentialMetadataPresent: true,
    credentialTargets: ["production"],
    runtimeRepairKeys: ["OPENAI_API_KEY"],
    productionRecordCount: 1,
    removableRecordIdPresent: true,
    removableRecordFingerprint: "a".repeat(64),
    deploymentBound: true,
    recordPredatesDeployments: true,
  },
};
assert.deepEqual(planInvalidOptionalOpenAiProductionRemoval({
  allowedMutationKeys: ["OPENAI_API_KEY"],
  auditedExternalAiTruth: auditedOptionalOpenAiTruth,
}), ["OPENAI_API_KEY"]);
assert.throws(
  () => planInvalidOptionalOpenAiProductionRemoval({
    allowedMutationKeys: ["OPENAI_MODEL_ID"],
    auditedExternalAiTruth: auditedOptionalOpenAiTruth,
  }),
  (error) => error.code === "PRODUCTION_REPAIR_OPENAI_MUTATION_KEY_INVALID",
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
assert.deepEqual(PRODUCTION_EXTERNAL_AI_MUTATION_KEYS, ["XAI_API_KEY", "XAI_MODEL_ID"]);
assert.deepEqual(planXaiProductionChanges({
  production: { XAI_API_KEY: testKey, XAI_MODEL_ID: "grok-old" },
  configuration: { apiKey: testKey, modelId: "grok-4.5", credentialSource: "github_secret" },
  allowedMutationKeys: ["XAI_MODEL_ID"],
}), ["XAI_MODEL_ID"]);
assert.deepEqual(planXaiProductionChanges({
  production: { XAI_API_KEY: "", XAI_MODEL_ID: "grok-old" },
  configuration: { apiKey: testKey, modelId: "grok-4.5", credentialSource: "github_secret" },
  allowedMutationKeys: ["XAI_MODEL_ID"],
  environmentMetadata: { entries: { XAI_API_KEY: { type: "sensitive" } } },
}), ["XAI_MODEL_ID"]);
assert.throws(
  () => planXaiProductionChanges({
    production: { XAI_API_KEY: "different-production-key-with-length", XAI_MODEL_ID: "grok-old" },
    configuration: { apiKey: testKey, modelId: "grok-4.5", credentialSource: "github_secret" },
    allowedMutationKeys: ["XAI_MODEL_ID"],
  }),
  (error) => error.code === "XAI_UNAUDITED_PRODUCTION_DRIFT",
);

const xaiMutationEvents = [];
assert.deepEqual(await applyXaiProductionEnvironmentMutations({
  productionChanges: [...PRODUCTION_EXTERNAL_AI_MUTATION_KEYS],
  configuration: { apiKey: testKey, modelId: "grok-4.5" },
  token: "vercel-token-not-logged",
  teamId: "team_expected",
  projectId: "prj_expected",
  scope: "team-scope",
  mutationGuard: ({ key, operation }) => {
    xaiMutationEvents.push(`cas:${key}:${operation}`);
  },
  sensitiveUpserter: async ({ key }) => {
    xaiMutationEvents.push(`post:${key}`);
    return { changedKeys: [key] };
  },
  vercelRunner: (args) => {
    xaiMutationEvents.push(`env-add:${args[2]}`);
  },
}), PRODUCTION_EXTERNAL_AI_MUTATION_KEYS);
assert.deepEqual(xaiMutationEvents, [
  "cas:XAI_API_KEY:POST",
  "post:XAI_API_KEY",
  "cas:XAI_MODEL_ID:VERCEL_ENV_ADD",
  "env-add:XAI_MODEL_ID",
]);
assert.deepEqual(await applyXaiProductionEnvironmentMutations({
  productionChanges: [],
  configuration: { apiKey: testKey, modelId: "grok-4.5" },
  mutationGuard: () => { throw new Error("NOOP_MUST_NOT_CHECK_CAS"); },
  sensitiveUpserter: () => { throw new Error("NOOP_MUST_NOT_POST"); },
  vercelRunner: () => { throw new Error("NOOP_MUST_NOT_ADD_ENV"); },
}), []);
let xaiMutationReached = false;
await assert.rejects(
  applyXaiProductionEnvironmentMutations({
    productionChanges: ["XAI_MODEL_ID"],
    configuration: { apiKey: testKey, modelId: "grok-4.5" },
    mutationGuard: () => {
      throw Object.assign(new Error("PRODUCTION_MAIN_HEAD_CAS_REMOTE_HEAD_MOVED"), {
        code: "PRODUCTION_MAIN_HEAD_CAS_REMOTE_HEAD_MOVED",
      });
    },
    vercelRunner: () => { xaiMutationReached = true; },
  }),
  (error) => error?.code === "PRODUCTION_MAIN_HEAD_CAS_REMOTE_HEAD_MOVED",
);
assert.equal(xaiMutationReached, false);
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
const governanceSource = await readFile(
  new URL("./production-environment-governance.mjs", import.meta.url),
  "utf8",
);
assert.match(source, /upsertSensitiveProductionEnvironment/u);
assert.match(
  source,
  /mutationGuard\(\{ key, operation: "POST" \}\);\s*const mutation = await sensitiveUpserter/u,
);
assert.match(
  source,
  /mutationGuard\(\{ key, operation: "VERCEL_ENV_ADD" \}\);\s*vercelRunner/u,
);
assert.doesNotMatch(source, /"--sensitive"/u);
assert.match(source, /https:\/\/api\.x\.ai\/v1\/models/u);
assert.match(source, /env", "pull"/u);
assert.match(source, /mkdtemp/u);
assert.match(source, /await rm\(directory/u);
assert.match(source, /production_xai_env_not_configured/u);
assert.match(source, /error\?\.code !== "XAI_API_KEY_NOT_CONFIGURED"/u);
assert.doesNotMatch(source, /console\.log\([^\n]*apiKey/u);
assert.match(source, /production\.XAI_API_KEY !== configuration\.apiKey/u);
assert.match(source, /mutationCount:\s*actualChangedKeys\.length/u);
assert.match(source, /credentialVerification:\s*\{/u);
assert.match(source, /credentialSource:\s*configuration\.credentialSource/u);
assert.match(source, /verificationCode:\s*"MODEL_ACCESS_VERIFIED"/u);
assert.match(source, /secretValuesStored:\s*false/u);
assert.match(governanceSource, /providers=openai,grok/u);
assert.match(governanceSource, /method:\s*"DELETE"/u);
assert.match(governanceSource, /encodeURIComponent\(recordId\)/u);
assert.doesNotMatch(governanceSource, /"env", "rm"/u);
assert.match(governanceSource, /PRODUCTION_REPAIR_OPENAI_RECORD_FINGERPRINT_CHANGED/u);
assert.match(governanceSource, /internalContentHintPresent/u);
assert.doesNotMatch(governanceSource, /console\.log\([^\n]*OPENAI_API_KEY/u);

console.log(JSON.stringify({
  status: "PASS",
  assertions: 44,
  modelId: DEFAULT_XAI_MODEL_ID,
  credentialExposed: false,
}, null, 2));
