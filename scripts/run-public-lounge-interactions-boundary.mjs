import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION,
  PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION,
  publicLoungeInteractionsAvailability,
} from "../lib/novel-ai/public-lounge/interactions-availability.ts";
import {
  decodePublicLoungeCommentCursor,
  encodePublicLoungeCommentCursor,
  parsePublicLoungeVoteInput,
} from "../lib/novel-ai/public-lounge/interactions.ts";

const empty = publicLoungeInteractionsAvailability({});
assert.equal(empty.ready, false);
assert.equal(empty.counts, null);
assert.equal(empty.capabilities.oneVotePerWork, false);
assert(empty.blockers.includes("feature_flag_disabled"));
assert(empty.blockers.includes("supabase_anon_key_missing"));

const configuredButUnverified = publicLoungeInteractionsAvailability({
  PUBLIC_LOUNGE_INTERACTIONS_ENABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-key",
  PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION,
});
assert.equal(configuredButUnverified.ready, false);
assert.equal(configuredButUnverified.counts, null);
assert.deepEqual(configuredButUnverified.capabilities, {
  oneVotePerWork: false,
  comments: false,
  reports: false,
  authorCommentDeletion: false,
});
assert(configuredButUnverified.blockers.includes("activation_verification_not_declared"));
assert(configuredButUnverified.blockers.includes("production_owner_lifecycle_not_verified"));

const disabledWithBaseSupabase = publicLoungeInteractionsAvailability({
  PUBLIC_LOUNGE_INTERACTIONS_ENABLED: "0",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-key",
  PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION,
  PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION,
});
assert.equal(disabledWithBaseSupabase.ready, false);
assert.equal(disabledWithBaseSupabase.status, "not_connected");
assert.deepEqual(disabledWithBaseSupabase.blockers, [
  "feature_flag_disabled",
  "live_rpc_status_not_verified",
]);

const activatedButNotLive = publicLoungeInteractionsAvailability({
  PUBLIC_LOUNGE_INTERACTIONS_ENABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-key",
  PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION,
  PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION,
});
assert.deepEqual(activatedButNotLive.blockers, ["live_rpc_status_not_verified"]);
assert.equal(activatedButNotLive.ready, false);

const cursor = encodePublicLoungeCommentCursor({
  createdAt: "2026-08-31T02:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
});
assert.deepEqual(decodePublicLoungeCommentCursor(cursor), {
  createdAt: "2026-08-31T02:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
});
assert.throws(() => parsePublicLoungeVoteInput({ selected: true, userId: "attacker" }));

const migration = await readFile(
  new URL("../prisma/migrations/027_public_lounge_interactions_v1.sql", import.meta.url),
  "utf8",
);
for (const required of [
  "primary key (public_id, voter_id)",
  "actor uuid := auth.uid()",
  "pg_advisory_xact_lock",
  "public_lounge_comment_audit",
  "public_lounge_reports",
  "novel_public_lounge_bind_owner",
  "novel_public_lounge_assert_owner",
  "novel_public_lounge_sync_owner",
  "novel_public_lounge_deactivate_owner",
  "current_version_number",
  "current_version_id = p_version_id",
  "(c.created_at, c.id) < (p_before, p_before_id)",
  "c.version_id = owner.current_version_id",
  "limit 256",
  "to authenticated",
  "to service_role",
]) {
  assert(migration.includes(required), `migration missing ${required}`);
}
for (const serviceOnly of [
  "bind_owner",
  "assert_owner",
  "sync_owner",
  "deactivate_owner",
  "interactions_status",
]) {
  assert(!new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.novel_public_lounge_${serviceOnly}[^;]+to\\s+(?:anon|authenticated)`,
    "iu",
  ).test(migration));
}

const [authSource, serverSource, httpSource, clientSource, healthSource, eligibilityRouteSource] = await Promise.all([
  readFile(new URL("../lib/novel-ai/public-lounge/auth-browser.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/public-lounge/interactions.server.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/public-lounge/interactions-http.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/public-lounge/interactions-client.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/lounge/interactions/health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/lounge/eligibility/route.ts", import.meta.url), "utf8"),
]);
assert(authSource.includes('flowType: "pkce"'));
assert(authSource.includes("signInWithOtp"));
assert(authSource.includes("exchangeCodeForSession"));
assert.equal(authSource.includes("SERVICE_ROLE"), false);
assert(serverSource.includes("auth.getUser(token)"));
assert(serverSource.includes("PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION"));
const baseConfigurationSource = serverSource.slice(
  serverSource.indexOf("function supabaseConfiguration()"),
  serverSource.indexOf("function assertInteractionsActivated()"),
);
const interactionActivationSource = serverSource.slice(
  serverSource.indexOf("function assertInteractionsActivated()"),
  serverSource.indexOf("function client("),
);
const interactionGatewaySource = serverSource.slice(
  serverSource.indexOf("export class SupabasePublicLoungeInteractionGateway"),
  serverSource.indexOf("export type PublicLoungeOwnerLifecycleGateway"),
);
const ownerGatewaySource = serverSource.slice(
  serverSource.indexOf("export class SupabasePublicLoungeOwnerLifecycleGateway"),
  serverSource.indexOf("let interactionGateway"),
);
assert(baseConfigurationSource.includes("NEXT_PUBLIC_SUPABASE_URL"));
assert.equal(baseConfigurationSource.includes("PUBLIC_LOUNGE_INTERACTIONS_ENABLED"), false);
assert(interactionActivationSource.includes("PUBLIC_LOUNGE_INTERACTIONS_ENABLED"));
assert(interactionActivationSource.includes("PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION"));
assert(interactionActivationSource.includes("PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION"));
assert.match(interactionGatewaySource, /async health\(\) \{\s+assertInteractionsActivated\(\);/u);
assert.equal(ownerGatewaySource.includes("assertInteractionsActivated"), false);
assert(httpSource.includes("assertAuthoritativePost"));
assert(httpSource.includes("service.reserveRequest(identifyRequest(request), \"read\")"));
assert(clientSource.includes("headers.Authorization = `Bearer ${token}`"));
assert.equal(clientSource.includes("userId"), false);
assert(healthSource.includes("getPublicLoungeInteractionGateway().health()"));
assert(healthSource.includes("reserveRequest(identity, \"read\")"));
assert(eligibilityRouteSource.includes("getPublicLoungeOwnerLifecycleGateway"));
assert.match(
  eligibilityRouteSource,
  /createPublicLoungeHttpHandlers\([\s\S]*getPublicLoungeOwnerLifecycleGateway,[\s\S]*\);/u,
);

console.log(JSON.stringify({
  status: "passed",
  assertions: 61,
  boundary: "base_supabase_owner_auth_decoupled_while_interactions_remain_fail_closed",
}));
