import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_RECEIPT_SCHEMA,
  PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION,
  PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION,
  PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS,
  activatePublicLoungeInteractionsProduction,
  authAdminHeaders,
  planPublicLoungeRuntimeSecrets,
  planSupabaseAuthConfig,
  runIsolatedTwoUserRpcContract,
  selectSupabaseActivationKeys,
} from "./activate-public-lounge-interactions-production.mjs";

const mode = process.argv[2] || "all";
assert.ok(["all", "self-test", "workflow"].includes(mode), "ACTIVATION_CONTRACT_MODE_INVALID");

const PROJECT_REF = "abcdefghijklmno12345";
const ACCESS_TOKEN = `sbp_${"m".repeat(40)}`;
const PUBLIC_KEY = `sb_publishable_${"p".repeat(40)}`;
const VERCEL_TOKEN = `vercel_${"v".repeat(40)}`;
const EXPECTED_COMMIT = "a".repeat(40);
const IDEMPOTENCY_SECRET = Buffer.alloc(32, 17).toString("base64url");
const RATE_IDENTITY_SECRET = Buffer.alloc(32, 29).toString("base64url");

function jwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role, ref: PROJECT_REF })).toString("base64url");
  return `${header}.${payload}.${"s".repeat(43)}`;
}

const SERVICE_ROLE_KEY = jwt("service_role");
const LEGACY_ANON_KEY = jwt("anon");

function response(value, status = 200) {
  return new Response(value === undefined ? "" : JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestBody(options) {
  return options?.body ? JSON.parse(options.body) : {};
}

function bearer(options) {
  const authorization = new Headers(options?.headers || {}).get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function fakeSupabase({ failRpcName = "", failTokenAt = 0 } = {}) {
  const state = {
    events: [],
    secretValues: [ACCESS_TOKEN, PUBLIC_KEY, SERVICE_ROLE_KEY, VERCEL_TOKEN],
    authConfig: {
      site_url: "https://old.example",
      uri_allow_list: "https://kept.example/auth/callback",
      external_email_enabled: false,
      disable_signup: true,
    },
    authConfigPatches: [],
    usersById: new Map(),
    usersByEmail: new Map(),
    usersByToken: new Map(),
    usersCreated: 0,
    usersDeleted: 0,
    databaseCleaned: false,
    owner: null,
    votes: new Set(),
    comments: [],
    reports: new Set(),
    commentCounter: 0,
    reportCounter: 0,
  };

  function actor(options) {
    return state.usersByToken.get(bearer(options))?.id || null;
  }
  function notFound() {
    return response({ message: "PUBLIC_LOUNGE_NOT_FOUND" }, 404);
  }
  function makeUuid(prefix, counter) {
    return `${prefix}0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  }
  function visibleComments(parameters, actorId) {
    if (!state.owner?.active) return null;
    let rows = state.comments
      .filter((item) => !item.deleted && item.version_id === state.owner.versionId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    if (parameters.p_before != null) {
      rows = rows.filter((item) => item.created_at < parameters.p_before
        || (item.created_at === parameters.p_before && item.id < parameters.p_before_id));
    }
    return rows.slice(0, parameters.p_limit).map((item) => ({
      id: item.id,
      version_id: item.version_id,
      chapter_number: item.chapter_number,
      display_name: item.display_name,
      body: item.body,
      created_at: item.created_at,
      can_delete: actorId === item.commenterId || actorId === state.owner.ownerId,
    }));
  }

  const fetcher = async (rawUrl, options = {}) => {
    const url = new URL(String(rawUrl));
    const method = String(options.method || "GET").toUpperCase();
    if (url.hostname === "api.supabase.com") {
      if (url.pathname.endsWith("/api-keys") && method === "GET") {
        state.events.push("api_keys_get");
        return response([
          { type: "publishable", name: "default", api_key: PUBLIC_KEY },
          { type: "legacy", name: "anon", api_key: LEGACY_ANON_KEY },
          { type: "legacy", name: "service_role", api_key: SERVICE_ROLE_KEY },
        ]);
      }
      if (url.pathname.endsWith("/config/auth") && method === "GET") {
        state.events.push("auth_get");
        return response({ ...state.authConfig });
      }
      if (url.pathname.endsWith("/config/auth") && method === "PATCH") {
        const patch = requestBody(options);
        state.events.push("auth_patch");
        state.authConfigPatches.push(patch);
        state.authConfig = { ...state.authConfig, ...patch };
        return response({ ...state.authConfig });
      }
      if (url.pathname.endsWith("/database/query") && method === "POST") {
        state.events.push("database_cleanup");
        const query = String(requestBody(options).query || "");
        assert.match(query, /delete from public\.public_lounge_comment_audit/u);
        assert.match(query, /delete from public\.public_lounge_publication_owners/u);
        state.databaseCleaned = true;
        state.owner = null;
        state.votes.clear();
        state.comments = [];
        state.reports.clear();
        return response([]);
      }
      return response({ message: "management route missing" }, 404);
    }

    if (url.pathname === "/auth/v1/admin/users" && method === "POST") {
      const body = requestBody(options);
      state.usersCreated += 1;
      const id = makeUuid("0", state.usersCreated);
      const accessToken = `user_access_${state.usersCreated}_${"t".repeat(40)}`;
      const user = { id, email: body.email, password: body.password, accessToken };
      state.secretValues.push(body.email, body.password, accessToken);
      state.usersById.set(id, user);
      state.usersByEmail.set(body.email, user);
      state.usersByToken.set(accessToken, user);
      state.events.push("auth_user_create");
      return response({ id }, 201);
    }
    if (url.pathname === "/auth/v1/token" && method === "POST") {
      const body = requestBody(options);
      const user = state.usersByEmail.get(body.email);
      if (!user || user.password !== body.password) return response({ message: "invalid" }, 400);
      if (failTokenAt === state.usersCreated) {
        return response({ message: "INJECTED_TOKEN_FAILURE" }, 500);
      }
      state.events.push("auth_token");
      return response({ access_token: user.accessToken });
    }
    if (url.pathname === "/auth/v1/user" && method === "GET") {
      const user = state.usersByToken.get(bearer(options));
      return user ? response({ id: user.id }) : response({ message: "invalid" }, 401);
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/") && method === "DELETE") {
      const id = decodeURIComponent(url.pathname.split("/").at(-1));
      const user = state.usersById.get(id);
      if (!user) return response({ message: "missing" }, 404);
      state.usersById.delete(id);
      state.usersByEmail.delete(user.email);
      state.usersByToken.delete(user.accessToken);
      state.usersDeleted += 1;
      state.events.push("auth_user_delete");
      return response({}, 200);
    }

    if (url.pathname.startsWith("/rest/v1/rpc/") && method === "POST") {
      const name = url.pathname.split("/").at(-1);
      const parameters = requestBody(options);
      if (name === failRpcName) return response({ message: "INJECTED_RPC_FAILURE" }, 500);
      const actorId = actor(options);
      state.events.push(`rpc:${name}`);
      if (name === "novel_public_lounge_interactions_status") {
        return response([{ migration_version: PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION, ready: true }]);
      }
      if (name === "novel_public_lounge_bind_owner") {
        state.owner = { publicId: parameters.p_public_id, ownerId: parameters.p_owner_id,
          versionId: parameters.p_version_id, versionNumber: parameters.p_version_number,
          chapterCount: parameters.p_chapter_count, active: true };
        return response(null);
      }
      if (name === "novel_public_lounge_set_vote") {
        if (!state.owner?.active || parameters.p_version_id !== state.owner.versionId) return notFound();
        if (parameters.p_selected) state.votes.add(actorId); else state.votes.delete(actorId);
        return response([{ selected: state.votes.has(actorId), vote_count: state.votes.size }]);
      }
      if (name === "novel_public_lounge_add_comment") {
        if (!state.owner?.active || parameters.p_version_id !== state.owner.versionId) return notFound();
        state.commentCounter += 1;
        const id = makeUuid("1", state.commentCounter);
        state.comments.push({ id, version_id: state.owner.versionId,
          chapter_number: parameters.p_chapter_number, display_name: parameters.p_display_name,
          body: parameters.p_body, commenterId: actorId, deleted: false,
          created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, state.commentCounter)).toISOString() });
        return response(id);
      }
      if (name === "novel_public_lounge_delete_comment") {
        if (!state.owner?.active || parameters.p_version_id !== state.owner.versionId) return notFound();
        const item = state.comments.find((entry) => entry.id === parameters.p_comment_id && !entry.deleted);
        if (!item) return response({ message: "PUBLIC_LOUNGE_COMMENT_NOT_FOUND" }, 404);
        if (actorId !== item.commenterId && actorId !== state.owner.ownerId) {
          return response({ message: "PUBLIC_LOUNGE_COMMENT_DELETE_FORBIDDEN" }, 403);
        }
        item.deleted = true;
        return response(null);
      }
      if (name === "novel_public_lounge_report") {
        if (!state.owner?.active || parameters.p_version_id !== state.owner.versionId) return notFound();
        const key = `${actorId}:${parameters.p_target_comment_id}:${parameters.p_reason_code}`;
        if (state.reports.has(key)) {
          return response({ message: "PUBLIC_LOUNGE_REPORT_ALREADY_SUBMITTED" }, 409);
        }
        state.reports.add(key);
        state.reportCounter += 1;
        return response(makeUuid("2", state.reportCounter));
      }
      if (name === "novel_public_lounge_list_comments") {
        const rows = visibleComments(parameters, actorId);
        return rows == null ? notFound() : response(rows);
      }
      if (name === "novel_public_lounge_interaction_summary") {
        if (!state.owner?.active) return notFound();
        return response([{ vote_count: state.votes.size,
          comment_count: state.comments.filter((item) => !item.deleted
            && item.version_id === state.owner.versionId).length,
          selected: state.votes.has(actorId), current_version_id: state.owner.versionId,
          chapter_count: state.owner.chapterCount }]);
      }
      if (name === "novel_public_lounge_sync_owner") {
        state.owner.versionId = parameters.p_version_id;
        state.owner.versionNumber = parameters.p_version_number;
        state.owner.chapterCount = parameters.p_chapter_count;
        state.owner.active = true;
        return response(null);
      }
      if (name === "novel_public_lounge_deactivate_owner") {
        state.owner.active = false;
        return response(null);
      }
      return response({ message: "rpc missing" }, 404);
    }
    return response({ message: "route missing" }, 404);
  };
  return { state, fetcher };
}

function activationOptions(receiptPath) {
  return {
    accessToken: ACCESS_TOKEN,
    projectRef: PROJECT_REF,
    primaryAlias: "primary.example",
    mirrorAlias: "mirror.example",
    expectedCommit: EXPECTED_COMMIT,
    vercelOrgId: "team_test",
    vercelProjectId: "project_test",
    vercelScope: "scope_test",
    vercelToken: VERCEL_TOKEN,
    receiptPath,
  };
}

function runtimeSecretMetadata(keys = []) {
  const records = keys.map((key, index) => ({
    id: `env_${index + 1}`,
    key,
    type: "sensitive",
    targets: ["production"],
    updatedAt: 1,
    gitBranchScoped: false,
    customEnvironmentIdCount: 0,
    system: false,
    configurationLinked: false,
    edgeConfigLinked: false,
    sunsetSecretLinked: false,
    vsmValuePresent: false,
    createdByIntegration: false,
    controlMarkers: [],
  }));
  return {
    verified: true,
    readOnly: true,
    records,
    entries: Object.fromEntries(records.map((record) => [record.key, record])),
  };
}

async function runSelfTest() {
  const selected = selectSupabaseActivationKeys([
    { type: "legacy", name: "anon", api_key: LEGACY_ANON_KEY },
    { type: "secret", name: "default", api_key: `sb_secret_${"z".repeat(32)}`,
      secret_jwt_template: { role: "service_role" } },
  ]);
  assert.equal(selected.publicKeyKind, "legacy_anon");
  assert.equal(selected.serviceRoleKeyKind, "secret_service_role");
  assert.equal(new Headers(authAdminHeaders(selected.serviceRoleKey)).has("authorization"), false,
    "Supabase sb_secret_ keys must not be sent as bearer tokens");
  assert.equal(new Headers(authAdminHeaders(SERVICE_ROLE_KEY)).get("authorization"),
    `Bearer ${SERVICE_ROLE_KEY}`,
    "legacy service_role JWT must retain the bearer authorization header");

  const planned = planSupabaseAuthConfig({
    site_url: "https://old.example",
    uri_allow_list: "https://kept.example/auth/callback",
    external_email_enabled: false,
    disable_signup: true,
  }, { primaryOrigin: "https://primary.example", mirrorOrigin: "https://mirror.example" });
  assert.equal(planned.patch.site_url, "https://primary.example");
  assert.equal(planned.patch.uri_allow_list,
    "https://kept.example/auth/callback,https://primary.example/auth/callback,https://mirror.example/auth/callback");
  assert.equal(planned.patch.external_email_enabled, true);
  assert.equal(planned.patch.disable_signup, false);
  assert.throws(() => planSupabaseAuthConfig({
    site_url: "https://old.example",
    uri_allow_list: "https://*.example/**",
    external_email_enabled: true,
    disable_signup: false,
  }, { primaryOrigin: "https://primary.example", mirrorOrigin: "https://mirror.example" }),
  /SUPABASE_AUTH_REDIRECT_NOT_EXACT/u);

  const missingSecretPlan = planPublicLoungeRuntimeSecrets(runtimeSecretMetadata(), (key) => (
    key === "PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY"
      ? IDEMPOTENCY_SECRET
      : RATE_IDENTITY_SECRET
  ));
  assert.deepEqual(missingSecretPlan.actions.map(({ key }) => key), PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS);
  assert.notEqual(missingSecretPlan.actions[0].value, missingSecretPlan.actions[1].value);
  const preservedSecretPlan = planPublicLoungeRuntimeSecrets(
    runtimeSecretMetadata(PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS),
  );
  assert.deepEqual(preservedSecretPlan.actions, []);
  assert.deepEqual(Object.values(preservedSecretPlan.status), [
    "preserved_sensitive", "preserved_sensitive",
  ]);
  const readableRecord = runtimeSecretMetadata([PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS[0]]);
  readableRecord.records[0].type = "encrypted";
  readableRecord.entries[PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS[0]].type = "encrypted";
  assert.throws(() => planPublicLoungeRuntimeSecrets(readableRecord),
    /PUBLIC_LOUNGE_RUNTIME_SECRET_NOT_SENSITIVE/u);
  const ambiguousMetadata = runtimeSecretMetadata([PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS[0]]);
  ambiguousMetadata.records.push({ ...ambiguousMetadata.records[0], id: "env_duplicate" });
  assert.throws(() => planPublicLoungeRuntimeSecrets(ambiguousMetadata),
    /PUBLIC_LOUNGE_RUNTIME_SECRET_RECORD_AMBIGUOUS/u);

  const directory = await mkdtemp(resolve(tmpdir(), "novel-lounge-activation-contract-"));
  try {
    const receiptPath = resolve(directory, "success.json");
    const fake = fakeSupabase();
    const vercelEnvironment = {};
    const sensitiveKeys = new Set();
    const orchestrationEvents = [];
    const receipt = await activatePublicLoungeInteractionsProduction(
      activationOptions(receiptPath),
      {
        fetcher: fake.fetcher,
        mutationGuard: ({ key }) => {
          orchestrationEvents.push(`cas:${key}`);
          fake.state.events.push(`cas:${key}`);
        },
        applyMigration: () => {
          orchestrationEvents.push("migration_apply_check");
          fake.state.events.push("migration_apply_check");
        },
        writeProductionEnvironment: ({ key, value }) => {
          orchestrationEvents.push(`env:${key}=${value}`);
          fake.state.events.push(`env:${key}`);
          vercelEnvironment[key] = value;
        },
        createSensitiveProductionEnvironment: ({ key, value }) => {
          orchestrationEvents.push(`secret:${key}`);
          fake.state.events.push(`secret:${key}`);
          fake.state.secretValues.push(value);
          sensitiveKeys.add(key);
        },
        generateRuntimeSecret: (key) => (
          key === "PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY"
            ? IDEMPOTENCY_SECRET
            : RATE_IDENTITY_SECRET
        ),
        readProductionEnvironment: () => ({ ...vercelEnvironment }),
        readProductionEnvironmentMetadata: () => runtimeSecretMetadata([...sensitiveKeys]),
      },
    );
    assert.equal(receipt.status, "activated");
    assert.equal(receipt.schemaVersion, PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_RECEIPT_SCHEMA);
    assert.equal(receipt.rpcContract.distinctAuthenticatedUsers, 2);
    assert.equal(receipt.rpcContract.oneVotePerUser, true);
    assert.equal(receipt.rpcContract.authorDelete, true);
    assert.equal(receipt.rpcContract.commenterDelete, true);
    assert.equal(receipt.rpcContract.duplicateReportRejected, true);
    assert.equal(receipt.rpcContract.createdAtIdCursor, true);
    assert.equal(receipt.rpcContract.oldVersionHiddenAfterSync, true);
    assert.equal(receipt.rpcContract.retractedReadRejected, true);
    assert.equal(receipt.rpcContract.retractedWriteRejected, true);
    assert.equal(receipt.rpcContract.cleanup.completed, true);
    assert.equal(fake.state.databaseCleaned, true);
    assert.equal(fake.state.usersCreated, 2);
    assert.equal(fake.state.usersDeleted, 2);
    assert.equal(fake.state.usersById.size, 0);
    assert.ok(fake.state.events.indexOf("migration_apply_check")
      < fake.state.events.indexOf("api_keys_get"), "migration must precede key discovery");
    const envEvents = orchestrationEvents.filter((entry) => entry.startsWith("env:"));
    assert.deepEqual(envEvents.map((entry) => entry.replace(/^env:/u, "")), [
      "PUBLIC_LOUNGE_INTERACTIONS_ENABLED=0",
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${PUBLIC_KEY}`,
      `PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION=${PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION}`,
      `PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION=${PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION}`,
      "PUBLIC_LOUNGE_INTERACTIONS_ENABLED=1",
    ]);
    for (const envEvent of envEvents) {
      const index = orchestrationEvents.indexOf(envEvent);
      const key = envEvent.slice(4).split("=")[0];
      assert.equal(orchestrationEvents[index - 1], `cas:${key}`);
    }
    assert.equal(vercelEnvironment.PUBLIC_LOUNGE_INTERACTIONS_ENABLED, "1");
    assert.deepEqual(
      orchestrationEvents.filter((entry) => entry.startsWith("secret:")),
      PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS.map((key) => `secret:${key}`),
    );
    assert.deepEqual(Object.values(receipt.runtimeSecrets.status), [
      "created_sensitive", "created_sensitive",
    ]);
    assert.equal(receipt.runtimeSecrets.metadataVerified, true);
    const receiptText = await readFile(receiptPath, "utf8");
    const receiptJson = JSON.parse(receiptText);
    assert.match(receiptJson.receiptDigest, /^[a-f0-9]{64}$/u);
    assert.equal(receiptJson.secretValuesStored, false);
    for (const secret of fake.state.secretValues) {
      assert.equal(receiptText.includes(secret), false, "sanitized receipt leaked a credential or probe identity");
    }

    const failureFake = fakeSupabase({ failRpcName: "novel_public_lounge_sync_owner" });
    await assert.rejects(() => runIsolatedTwoUserRpcContract({
      accessToken: ACCESS_TOKEN,
      projectRef: PROJECT_REF,
      publicKey: PUBLIC_KEY,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetcher: failureFake.fetcher,
    }), /SUPABASE_ACTIVATION_RPC_FAILED/u);
    assert.equal(failureFake.state.databaseCleaned, true);
    assert.equal(failureFake.state.usersCreated, 2);
    assert.equal(failureFake.state.usersDeleted, 2);
    assert.equal(failureFake.state.usersById.size, 0);

    const partialAuthFailure = fakeSupabase({ failTokenAt: 1 });
    await assert.rejects(() => runIsolatedTwoUserRpcContract({
      accessToken: ACCESS_TOKEN,
      projectRef: PROJECT_REF,
      publicKey: PUBLIC_KEY,
      serviceRoleKey: SERVICE_ROLE_KEY,
      fetcher: partialAuthFailure.fetcher,
    }), /SUPABASE_ACTIVATION_AUTH_TOKEN_FAILED/u);
    assert.equal(partialAuthFailure.state.databaseCleaned, true);
    assert.equal(partialAuthFailure.state.usersCreated, 1);
    assert.equal(partialAuthFailure.state.usersDeleted, 1);
    assert.equal(partialAuthFailure.state.usersById.size, 0);

    const rollbackPath = resolve(directory, "failure.json");
    const rollbackFake = fakeSupabase();
    const rollbackWrites = [];
    await assert.rejects(() => activatePublicLoungeInteractionsProduction(
      activationOptions(rollbackPath),
      {
        fetcher: rollbackFake.fetcher,
        mutationGuard: () => undefined,
        applyMigration: () => undefined,
        runRpcContract: async () => {
          const error = new Error("INJECTED_RPC_CONTRACT_FAILURE");
          error.code = "INJECTED_RPC_CONTRACT_FAILURE";
          error.cleanup = { attempted: true, completed: true, databaseRowsRemoved: true,
            authUsersCreated: 2, authUsersDeleted: 2 };
          throw error;
        },
        writeProductionEnvironment: (entry) => rollbackWrites.push(entry),
        readProductionEnvironment: () => ({}),
      },
    ), /INJECTED_RPC_CONTRACT_FAILURE/u);
    assert.equal(rollbackWrites.length, 0);
    assert.deepEqual(rollbackFake.state.authConfig, {
      site_url: "https://old.example",
      uri_allow_list: "https://kept.example/auth/callback",
      external_email_enabled: false,
      disable_signup: true,
    });
    const failedReceipt = JSON.parse(await readFile(rollbackPath, "utf8"));
    assert.equal(failedReceipt.status, "failed");
    assert.equal(failedReceipt.auth.restoredAfterFailure, true);
    assert.equal(failedReceipt.vercel.finalEnableAcknowledged, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({
    status: "public_lounge_interactions_activation_self_test_passed",
    realRpcContractSimulated: true,
    twoAuthenticatedUsers: true,
    failureCleanup: true,
    authRollback: true,
    finalEnableLast: true,
    secretValuesStored: false,
  }));
}

async function runWorkflowContract() {
  const [workflow, packageJson, activationSource, preparationSource] = await Promise.all([
    readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("./activate-public-lounge-interactions-production.mjs", import.meta.url), "utf8"),
    readFile(new URL("./prepare-public-lounge-runtime-production.mjs", import.meta.url), "utf8"),
  ]);
  const repairStart = workflow.indexOf("  production_env_repair:");
  const repairEnd = workflow.indexOf("\n  restore_known_stable:", repairStart);
  assert.ok(repairStart >= 0 && repairEnd > repairStart, "production_env_repair job missing");
  const repairJob = workflow.slice(repairStart, repairEnd);
  const migration027 = repairJob.indexOf("apply-public-lounge-interactions-migration.mjs --required");
  const migration027Check = repairJob.indexOf("apply-public-lounge-interactions-migration.mjs --check --required");
  const migration028 = repairJob.indexOf("apply-public-lounge-control-plane-migration.mjs --required");
  const preparation = repairJob.indexOf("prepare-public-lounge-runtime-production.mjs --required");
  assert.ok(preparation >= 0 && preparation < migration027,
    "fail-closed runtime preparation must precede both Public Lounge migrations");
  assert.ok(migration027 >= 0 && migration027Check > migration027,
    "migration 027 apply/check workflow hook missing");
  assert.ok(migration028 > migration027Check, "migration 028 must follow interaction migration 027");
  assert.doesNotMatch(repairJob, /activate-public-lounge-interactions-production\.mjs --required/u);
  assert.match(repairJob, /timeout-minutes: 20/u);
  assert.match(repairJob, /PUBLIC_LOUNGE_RUNTIME_PREPARATION_RECEIPT_PATH:/u);
  assert.match(repairJob, /PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY: \$\{\{ secrets\.PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY \}\}/u);
  assert.match(repairJob, /PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY: \$\{\{ secrets\.PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY \}\}/u);
  assert.match(repairJob, /PRODUCTION_MAIN_HEAD_CAS_REQUIRED: 'true'/u);
  assert.match(repairJob, /EXPECTED_MAIN_HEAD_COMMIT: \$\{\{ github\.sha \}\}/u);
  assert.match(repairJob, /public-lounge-runtime-preparation-\$\{\{ github\.sha \}\}/u);
  assert.match(repairJob, /always\(\).*github\.event_name == 'push'/u);
  const migration028Step = repairJob.slice(repairJob.lastIndexOf("- name:", migration028), migration028);
  assert.match(migration028Step, /verify-production-main-head-cas\.mjs/u,
    "migration 028 must have a fresh main-head CAS immediately before mutation");
  assert.doesNotMatch(repairJob, /vercel\s+alias\s+(?:set|rm)/u);
  assert.match(workflow, /production_build:[\s\S]*needs: \[validate, production_env_repair\]/u);
  assert.match(workflow, /PUBLIC_LOUNGE_INTERACTIONS_EXPECTED_STATE: fail-closed/u);
  assert.match(activationSource, /PUBLIC_LOUNGE_MAGIC_LINK_PKCE_BROWSER_E2E_REQUIRED/u);
  assert.match(preparationSource, /PUBLIC_LOUNGE_INTERACTIONS_ENABLED/u);
  assert.match(preparationSource, /"--sensitive"/u);
  assert.match(preparationSource, /readVercelProductionEnvironmentMetadata/u);
  assert.doesNotMatch(preparationSource, /PUBLIC_LOUNGE_INTERACTIONS_ENABLED[^\n]*"1"/u);
  assert.equal(packageJson.scripts["activate:public-lounge-interactions"], undefined);
  assert.equal(packageJson.scripts["prepare:public-lounge-runtime"],
    "node scripts/prepare-public-lounge-runtime-production.mjs --required");
  assert.equal(packageJson.scripts["test:public-lounge:activation"],
    "node scripts/run-public-lounge-interactions-activation-contract.mjs self-test");
  assert.equal(packageJson.scripts["test:public-lounge:activation-workflow"],
    "node scripts/run-public-lounge-interactions-activation-contract.mjs workflow");
  assert.equal(packageJson.scripts["test:public-lounge:runtime-preparation"],
    "node scripts/prepare-public-lounge-runtime-production.mjs --self-test");
  assert.match(packageJson.scripts["test:public-lounge"],
    /test:public-lounge:activation-workflow/u);
  console.log(JSON.stringify({
    status: "public_lounge_interactions_fail_closed_workflow_contract_passed",
    migration027ApplyCheck: true,
    runtimePreparedFailClosedBeforeBuild: true,
    receiptUpload: true,
    aliasMutationAbsent: true,
  }));
}

if (mode === "all" || mode === "self-test") await runSelfTest();
if (mode === "all" || mode === "workflow") await runWorkflowContract();
