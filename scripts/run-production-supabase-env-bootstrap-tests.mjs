import assert from "node:assert/strict";
import {
  REQUIRED_SUPABASE_KEYS,
  mergeProductionWithSource,
  parseEnvFile,
  projectRefFromUrl,
  serviceRoleCredentialKind,
  validateConfigurationShape,
} from "./bootstrap-production-supabase-env.mjs";

const projectRef = "abcdefghijklmnopqrst";
const serviceRolePayload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
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
assert.equal(serviceRoleCredentialKind("sb_secret_abcdefghijklmnopqrstuvwxyz"), "secret_key");
assert.equal(serviceRoleCredentialKind("not-a-service-role"), "");

const production = { NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL };
const merged = mergeProductionWithSource(production, source);
assert.deepEqual(Object.keys(merged), [...REQUIRED_SUPABASE_KEYS]);
assert.equal(merged.NEXT_PUBLIC_SUPABASE_URL, production.NEXT_PUBLIC_SUPABASE_URL);
assert.deepEqual(validateConfigurationShape(merged), { projectRef });

const aliasOnly = mergeProductionWithSource({}, {
  SUPABASE_MANAGEMENT_TOKEN: source.SUPABASE_ACCESS_TOKEN,
  SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
});
assert.deepEqual(aliasOnly, source);
assert.deepEqual(validateConfigurationShape(aliasOnly), { projectRef });

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

console.log(JSON.stringify({
  schemaVersion: "production-supabase-env-bootstrap-tests-v1",
  status: "PASS",
  requiredKeyCount: REQUIRED_SUPABASE_KEYS.length,
  secretsPrinted: false,
}));
