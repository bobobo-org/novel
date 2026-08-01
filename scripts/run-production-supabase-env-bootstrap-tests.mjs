import assert from "node:assert/strict";
import {
  collectEnvironmentServiceRoleCandidates,
  discoverProjectRef,
  discoverProjectApiKeyCandidates,
  isSupabaseManagementAccessToken,
  PRODUCTION_RUNTIME_SUPABASE_KEYS,
  REQUIRED_SUPABASE_KEYS,
  SUPABASE_SERVER_CREDENTIAL_KEYS,
  mergeProductionWithSource,
  parseEnvFile,
  projectRefFromUrl,
  projectRefFromServiceRole,
  selectServiceRoleCredential,
  serviceRoleCredentialKind,
  validateBootstrapConfigurationShape,
  validateConfigurationShape,
  validateRuntimeConfigurationShape,
} from "./bootstrap-production-supabase-env.mjs";

const projectRef = "abcdefghijklmnopqrst";
const serviceRolePayload = Buffer.from(JSON.stringify({ role: "service_role", ref: projectRef })).toString("base64url");
const serviceRoleJwt = `header.${serviceRolePayload}.signature`;
const source = {
  SUPABASE_ACCESS_TOKEN: "sbp_abcdefghijklmnopqrstuvwxyz",
  SUPABASE_PROJECT_REF: projectRef,
  NEXT_PUBLIC_SUPABASE_URL: `https://${projectRef}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleJwt,
};

assert.deepEqual(parseEnvFile(`\nA="one\\ntwo"\nB='three'\n# ignored\n`), {
  A: "one\ntwo",
  B: "three",
});
assert.equal(projectRefFromUrl(source.NEXT_PUBLIC_SUPABASE_URL), projectRef);
assert.equal(projectRefFromUrl("http://abcdefghijklmnopqrst.supabase.co"), "");
assert.equal(projectRefFromUrl("https://example.com"), "");
assert.equal(serviceRoleCredentialKind(serviceRoleJwt), "service_role_jwt");
assert.equal(projectRefFromServiceRole(serviceRoleJwt), projectRef);
assert.equal(serviceRoleCredentialKind("sb_secret_abcdefghijklmnopqrstuvwxyz"), "secret_key");
assert.equal(serviceRoleCredentialKind("opaque-service-role-value"), "");
assert.equal(serviceRoleCredentialKind("short"), "");
assert.equal(isSupabaseManagementAccessToken(source.SUPABASE_ACCESS_TOKEN), true);
assert.equal(isSupabaseManagementAccessToken("sb_secret_abcdefghijklmnopqrstuvwxyz"), false);
assert.equal(isSupabaseManagementAccessToken(serviceRoleJwt), false);

assert.deepEqual(SUPABASE_SERVER_CREDENTIAL_KEYS, [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_KEY",
]);
const aliasCandidates = collectEnvironmentServiceRoleCandidates({
  production: { SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz" },
  preview: { SUPABASE_SERVICE_KEY: serviceRoleJwt },
});
assert.equal(aliasCandidates.length, 6);
assert.deepEqual(aliasCandidates.filter((candidate) => candidate.value), [
  {
    source: "production:SUPABASE_SECRET_KEY",
    value: "sb_secret_abcdefghijklmnopqrstuvwxyz",
  },
  { source: "preview:SUPABASE_SERVICE_KEY", value: serviceRoleJwt },
]);

const selectedCredential = await selectServiceRoleCredential({
  url: source.NEXT_PUBLIC_SUPABASE_URL,
  candidates: [
    { source: "production", value: "[REDACTED]" },
    { source: "preview", value: "sb_secret_abcdefghijklmnopqrstuvwxyz" },
  ],
  fetcher: async (url, options) => {
    assert.equal(options.headers.apikey, "sb_secret_abcdefghijklmnopqrstuvwxyz");
    assert.equal("authorization" in options.headers, false);
    assert.match(url, /\/(?:rest|storage)\/v1\//u);
    return new Response("[]", { status: 200 });
  },
});
assert.equal(selectedCredential.source, "preview");
assert.equal(selectedCredential.kind, "secret_key");
assert.equal(selectedCredential.restHttpStatus, 200);
assert.equal(selectedCredential.storageHttpStatus, 200);
assert.equal(selectedCredential.probes[0].kind, "invalid_shape");

const discoveredApiKeys = await discoverProjectApiKeyCandidates({
  accessToken: source.SUPABASE_ACCESS_TOKEN,
  projectRef,
  fetcher: async (url, options) => {
    assert.equal(url, `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`);
    assert.equal(options.headers.authorization, `Bearer ${source.SUPABASE_ACCESS_TOKEN}`);
    return new Response(JSON.stringify([
      { name: "anon", api_key: "sb_publishable_public-value" },
      { name: "service_role", api_key: serviceRoleJwt },
    ]), { status: 200 });
  },
});
assert.equal(discoveredApiKeys.httpStatus, 200);
assert.equal(discoveredApiKeys.candidates.length, 1);
assert.equal(discoveredApiKeys.candidates[0].value, serviceRoleJwt);
await assert.rejects(
  () => discoverProjectApiKeyCandidates({
    accessToken: source.SUPABASE_ACCESS_TOKEN,
    projectRef,
    fetcher: async () => new Response(JSON.stringify({ message: "forbidden" }), { status: 403 }),
  }),
  (error) => error?.code === "SUPABASE_BOOTSTRAP_API_KEY_DISCOVERY_FAILED"
    && error?.httpStatus === 403,
);

const production = { NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL };
const merged = mergeProductionWithSource(production, source);
assert.deepEqual(Object.keys(merged), [...REQUIRED_SUPABASE_KEYS]);
assert.equal(merged.NEXT_PUBLIC_SUPABASE_URL, production.NEXT_PUBLIC_SUPABASE_URL);
assert.deepEqual(validateConfigurationShape(merged), { projectRef });
assert.deepEqual(validateRuntimeConfigurationShape({
  SUPABASE_PROJECT_REF: projectRef,
  NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
}), { projectRef });
assert.deepEqual(validateBootstrapConfigurationShape({
  SUPABASE_PROJECT_REF: projectRef,
  NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: "[REDACTED]",
}), { projectRef });
assert.deepEqual(PRODUCTION_RUNTIME_SUPABASE_KEYS, [
  "SUPABASE_PROJECT_REF",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]);

const aliasOnly = mergeProductionWithSource({}, {
  SUPABASE_MANAGEMENT_TOKEN: source.SUPABASE_ACCESS_TOKEN,
  SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
});
assert.deepEqual(aliasOnly, source);
assert.deepEqual(validateConfigurationShape(aliasOnly), { projectRef });

const modernSecretAlias = mergeProductionWithSource({}, {
  SUPABASE_ACCESS_TOKEN: source.SUPABASE_ACCESS_TOKEN,
  SUPABASE_PROJECT_REF: projectRef,
  NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: "invalid-legacy-value",
  SUPABASE_SECRET_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
});
assert.equal(
  modernSecretAlias.SUPABASE_SERVICE_ROLE_KEY,
  "sb_secret_abcdefghijklmnopqrstuvwxyz",
);
assert.deepEqual(validateConfigurationShape(modernSecretAlias), { projectRef });

const serviceRoleRefOnly = mergeProductionWithSource({}, {
  SUPABASE_ACCESS_TOKEN: source.SUPABASE_ACCESS_TOKEN,
  NEXT_PUBLIC_SUPABASE_URL: "https://custom.example.com",
  SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
});
assert.equal(serviceRoleRefOnly.SUPABASE_PROJECT_REF, projectRef);

assert.throws(
  () => validateConfigurationShape({ ...merged, SUPABASE_PROJECT_REF: "differentprojectref" }),
  (error) => error?.code === "SUPABASE_BOOTSTRAP_IDENTITY_MISMATCH",
);
assert.throws(
  () => validateConfigurationShape({ ...merged, SUPABASE_SERVICE_ROLE_KEY: "anon" }),
  (error) => error?.code === "SUPABASE_BOOTSTRAP_SERVICE_ROLE_INVALID",
);
assert.throws(
  () => validateConfigurationShape({ ...merged, SUPABASE_ACCESS_TOKEN: "" }),
  (error) => error?.code === "SUPABASE_BOOTSTRAP_SOURCE_MISSING"
    && error.missingKeys.includes("SUPABASE_ACCESS_TOKEN"),
);

const originalFetch = globalThis.fetch;
const discoveryRef = "zyxwvutsrqponmlkjihg";
try {
  globalThis.fetch = async (url) => {
    if (url === "https://api.supabase.com/v1/projects") {
      return new Response(JSON.stringify([
        { ref: "aaaaaaaaaaaaaaaaaaaa" },
        { ref: discoveryRef },
      ]), { status: 200 });
    }
    if (url === `https://${discoveryRef}.supabase.co/rest/v1/`) {
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 401 });
  };
  assert.deepEqual(await discoverProjectRef({
    SUPABASE_ACCESS_TOKEN: source.SUPABASE_ACCESS_TOKEN,
    NEXT_PUBLIC_SUPABASE_URL: "https://custom.example.com",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abcdefghijklmnopqrstuvwxyz",
  }), {
    projectRef: discoveryRef,
    method: "service_role_probe",
  });
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({
  schemaVersion: "production-supabase-env-bootstrap-tests-v1",
  status: "PASS",
  requiredKeyCount: REQUIRED_SUPABASE_KEYS.length,
  secretsPrinted: false,
}));
