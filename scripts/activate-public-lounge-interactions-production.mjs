import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  enforceProductionMainHeadCasBeforeMutation,
  readVercelProductionEnvironmentMetadata,
} from "./production-environment-governance.mjs";

export const PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION = "public_lounge_interactions_v1_027";
export const PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION = "public_lounge_interactions_runtime_v1";
export const PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_RECEIPT_SCHEMA =
  "public-lounge-interactions-production-activation-v1";
export const PUBLIC_LOUNGE_INTERACTIONS_PRODUCTION_ENV = Object.freeze({
  NEXT_PUBLIC_SUPABASE_ANON_KEY: null,
  PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY: null,
  PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY: null,
  PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION,
  PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION,
  PUBLIC_LOUNGE_INTERACTIONS_ENABLED: "1",
});
export const PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS = Object.freeze([
  "PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY",
  "PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY",
]);

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const PROJECT_REF = /^[a-z0-9]{8,32}$/u;
const FULL_COMMIT = /^[a-f0-9]{40}$/u;
const PUBLIC_ID = /^novel_[a-z0-9_-]{12,80}$/u;
const VERSION_ID = /^version_[a-z0-9_-]{12,96}$/u;
const AUTH_WILDCARD = /[*?\[\]{}\\]/u;
const MAX_HTTP_BODY_BYTES = 1024 * 1024;
const HTTP_TIMEOUT_MS = 30_000;

function activationError(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}
function ensure(condition, code, details) {
  if (!condition) throw activationError(code, details);
}
function canonicalRuntimeSecret(value) {
  const encoded = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{43}$/u.test(encoded)) return false;
  const bytes = Buffer.from(encoded, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === encoded;
}
function runtimeSecretRecords(metadata, key) {
  const records = Array.isArray(metadata?.records)
    ? metadata.records.filter((record) => record?.key === key && record?.targets?.includes("production"))
    : metadata?.entries?.[key]
      ? [metadata.entries[key]]
      : [];
  return records;
}
function assertPreservableRuntimeSecretRecord(record, key) {
  ensure(record?.type === "sensitive", "PUBLIC_LOUNGE_RUNTIME_SECRET_NOT_SENSITIVE", { key });
  ensure(Array.isArray(record.targets) && record.targets.length === 1
    && record.targets[0] === "production", "PUBLIC_LOUNGE_RUNTIME_SECRET_SCOPE_INVALID", { key });
  ensure(!record.gitBranchScoped && Number(record.customEnvironmentIdCount || 0) === 0,
    "PUBLIC_LOUNGE_RUNTIME_SECRET_SCOPE_INVALID", { key });
  ensure(!record.system && !record.configurationLinked && !record.edgeConfigLinked
    && !record.sunsetSecretLinked && !record.vsmValuePresent && !record.createdByIntegration
    && (!Array.isArray(record.controlMarkers) || record.controlMarkers.length === 0),
  "PUBLIC_LOUNGE_RUNTIME_SECRET_MANAGED_RECORD_INVALID", { key });
}
export function planPublicLoungeRuntimeSecrets(metadata, generateRuntimeSecret = () => (
  randomBytes(32).toString("base64url")
)) {
  ensure(metadata?.verified === true && metadata?.readOnly === true
    && Array.isArray(metadata?.records) && metadata?.entries
    && typeof metadata.entries === "object", "PUBLIC_LOUNGE_RUNTIME_SECRET_METADATA_UNVERIFIED");
  const actions = [];
  const status = {};
  for (const key of PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS) {
    const records = runtimeSecretRecords(metadata, key);
    ensure(records.length <= 1, "PUBLIC_LOUNGE_RUNTIME_SECRET_RECORD_AMBIGUOUS", { key });
    if (records.length === 1) {
      assertPreservableRuntimeSecretRecord(records[0], key);
      status[key] = "preserved_sensitive";
      continue;
    }
    const value = String(generateRuntimeSecret(key) || "").trim();
    ensure(canonicalRuntimeSecret(value), "PUBLIC_LOUNGE_RUNTIME_SECRET_GENERATION_INVALID", { key });
    actions.push({ key, value });
    status[key] = "created_sensitive";
  }
  if (actions.length === 2) {
    ensure(actions[0].value !== actions[1].value, "PUBLIC_LOUNGE_RUNTIME_SECRETS_NOT_DISTINCT");
  }
  return { actions, status };
}
function verifyPublicLoungeRuntimeSecretMetadata(metadata) {
  ensure(metadata?.verified === true && metadata?.readOnly === true,
    "PUBLIC_LOUNGE_RUNTIME_SECRET_METADATA_UNVERIFIED");
  for (const key of PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS) {
    const records = runtimeSecretRecords(metadata, key);
    ensure(records.length === 1, "PUBLIC_LOUNGE_RUNTIME_SECRET_METADATA_INVALID", { key });
    assertPreservableRuntimeSecretRecord(records[0], key);
  }
}
function safeErrorCode(error) {
  const candidate = String(error?.code || error?.message || "");
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(candidate)
    ? candidate
    : "PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_FAILED";
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}
function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}
function withReceiptDigest(receipt) {
  const core = { ...receipt };
  delete core.receiptDigest;
  return { ...core, receiptDigest: digest(core) };
}
async function writeSanitizedReceipt(path, receipt, sensitiveValues = []) {
  if (!path) throw activationError("PUBLIC_LOUNGE_ACTIVATION_RECEIPT_PATH_REQUIRED");
  const finalized = withReceiptDigest(receipt);
  const serialized = `${JSON.stringify(finalized, null, 2)}\n`;
  for (const value of sensitiveValues) {
    const candidate = String(value || "");
    if (candidate.length >= 8 && serialized.includes(candidate)) {
      throw activationError("PUBLIC_LOUNGE_ACTIVATION_RECEIPT_SECRET_DETECTED");
    }
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serialized, { encoding: "utf8", mode: 0o600 });
  return finalized;
}

function parseJsonBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}
async function fetchResult(fetcher, url, options = {}) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      cache: "no-store",
      signal: options.signal || AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    throw activationError("PUBLIC_LOUNGE_ACTIVATION_HTTP_REQUEST_FAILED");
  }
  let text;
  try { text = await response.text(); } catch {
    throw activationError("PUBLIC_LOUNGE_ACTIVATION_HTTP_BODY_FAILED", { httpStatus: response.status });
  }
  if (Buffer.byteLength(text, "utf8") > MAX_HTTP_BODY_BYTES) {
    throw activationError("PUBLIC_LOUNGE_ACTIVATION_HTTP_BODY_TOO_LARGE", { httpStatus: response.status });
  }
  return { response, text, body: parseJsonBody(text) };
}
async function expectJson(fetcher, url, options, failureCode) {
  const result = await fetchResult(fetcher, url, options);
  if (!result.response.ok) {
    throw activationError(failureCode, { httpStatus: result.response.status });
  }
  return result.body;
}

function decodeJwtPayload(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return null; }
}
function rowApiKey(row) { return String(row?.api_key || "").trim(); }
function publicKeyKind(row) {
  const value = rowApiKey(row);
  const type = String(row?.type || "").toLowerCase();
  const name = String(row?.name || "").toLowerCase();
  const role = String(decodeJwtPayload(value)?.role || "");
  if (type === "publishable" && /^sb_publishable_[A-Za-z0-9._-]{16,}$/u.test(value)) {
    return "publishable";
  }
  if ((type === "legacy" || name === "anon" || role === "anon") && role === "anon") {
    return "legacy_anon";
  }
  return "";
}
function serviceKeyKind(row) {
  const value = rowApiKey(row);
  const type = String(row?.type || "").toLowerCase();
  const name = String(row?.name || "").toLowerCase();
  const payload = decodeJwtPayload(value);
  if (payload?.role === "service_role" && (type === "legacy" || name === "service_role")) {
    return "legacy_service_role";
  }
  if (type === "secret" && /^sb_secret_[A-Za-z0-9._-]{16,}$/u.test(value)
    && (!row?.secret_jwt_template || row.secret_jwt_template.role === "service_role")) {
    return "secret_service_role";
  }
  return "";
}
export function selectSupabaseActivationKeys(rows) {
  ensure(Array.isArray(rows), "SUPABASE_ACTIVATION_API_KEY_RESPONSE_INVALID");
  const publicRows = rows.map((row) => ({ row, kind: publicKeyKind(row) }))
    .filter((entry) => entry.kind)
    .sort((a, b) => a.kind === "publishable" ? -1 : b.kind === "publishable" ? 1 : 0);
  const serviceRows = rows.map((row) => ({ row, kind: serviceKeyKind(row) }))
    .filter((entry) => entry.kind)
    .sort((a, b) => a.kind === "legacy_service_role" ? -1
      : b.kind === "legacy_service_role" ? 1 : 0);
  ensure(publicRows.length > 0, "SUPABASE_ACTIVATION_PUBLIC_KEY_MISSING");
  ensure(serviceRows.length > 0, "SUPABASE_ACTIVATION_SERVICE_ROLE_KEY_MISSING");
  const publicKey = rowApiKey(publicRows[0].row);
  const serviceRoleKey = rowApiKey(serviceRows[0].row);
  ensure(publicKey !== serviceRoleKey, "SUPABASE_ACTIVATION_KEY_ROLE_COLLISION");
  return {
    publicKey,
    publicKeyKind: publicRows[0].kind,
    serviceRoleKey,
    serviceRoleKeyKind: serviceRows[0].kind,
  };
}

export function normalizeProductionOrigin(value, name = "PRODUCTION_ORIGIN") {
  const raw = String(value || "").trim();
  ensure(raw && !AUTH_WILDCARD.test(raw), `${name}_INVALID`);
  let parsed;
  try { parsed = new URL(raw.includes("://") ? raw : `https://${raw}`); } catch {
    throw activationError(`${name}_INVALID`);
  }
  ensure(parsed.protocol === "https:" && parsed.pathname === "/" && !parsed.search && !parsed.hash
    && !parsed.username && !parsed.password && parsed.hostname.includes("."), `${name}_INVALID`);
  return parsed.origin;
}
function validateExactRedirect(value) {
  ensure(typeof value === "string" && value.length > 0 && value === value.trim()
    && !/\s/u.test(value) && !AUTH_WILDCARD.test(value), "SUPABASE_AUTH_REDIRECT_NOT_EXACT");
  try {
    const parsed = new URL(value);
    ensure(Boolean(parsed.protocol), "SUPABASE_AUTH_REDIRECT_NOT_EXACT");
  } catch (error) {
    if (error?.code === "SUPABASE_AUTH_REDIRECT_NOT_EXACT") throw error;
    throw activationError("SUPABASE_AUTH_REDIRECT_NOT_EXACT");
  }
  return value;
}
function authAllowListEntries(raw) {
  if (raw == null || raw === "") return [];
  ensure(typeof raw === "string", "SUPABASE_AUTH_REDIRECT_ALLOW_LIST_INVALID");
  const entries = raw.split(",");
  ensure(entries.every((entry) => entry.length > 0), "SUPABASE_AUTH_REDIRECT_ALLOW_LIST_INVALID");
  return entries.map(validateExactRedirect);
}
export function planSupabaseAuthConfig(current, { primaryOrigin, mirrorOrigin }) {
  ensure(current && typeof current === "object" && !Array.isArray(current),
    "SUPABASE_AUTH_CONFIG_RESPONSE_INVALID");
  ensure(typeof current.site_url === "string" && typeof current.external_email_enabled === "boolean"
    && typeof current.disable_signup === "boolean", "SUPABASE_AUTH_CONFIG_RESPONSE_INVALID");
  const existing = authAllowListEntries(current.uri_allow_list);
  const callbacks = [`${primaryOrigin}/auth/callback`, `${mirrorOrigin}/auth/callback`]
    .map(validateExactRedirect);
  const next = [...existing];
  for (const callback of callbacks) if (!next.includes(callback)) next.push(callback);
  return {
    callbacks,
    existingRedirectCount: existing.length,
    resultingRedirectCount: next.length,
    original: {
      site_url: current.site_url,
      uri_allow_list: current.uri_allow_list == null ? "" : current.uri_allow_list,
      external_email_enabled: current.external_email_enabled,
      disable_signup: current.disable_signup,
    },
    patch: {
      site_url: primaryOrigin,
      uri_allow_list: next.join(","),
      external_email_enabled: true,
      disable_signup: false,
    },
  };
}
export function verifySupabaseAuthConfig(actual, expected) {
  ensure(actual?.site_url === expected.site_url, "SUPABASE_AUTH_SITE_URL_VERIFICATION_FAILED");
  ensure(actual?.uri_allow_list === expected.uri_allow_list, "SUPABASE_AUTH_REDIRECT_VERIFICATION_FAILED");
  ensure(actual?.external_email_enabled === true, "SUPABASE_AUTH_EMAIL_PROVIDER_VERIFICATION_FAILED");
  ensure(actual?.disable_signup === false, "SUPABASE_AUTH_SIGNUP_VERIFICATION_FAILED");
  authAllowListEntries(actual.uri_allow_list);
  return true;
}
function verifyRestoredAuthConfig(actual, expected) {
  ensure(actual?.site_url === expected.site_url && (actual?.uri_allow_list || "") === expected.uri_allow_list
    && actual?.external_email_enabled === expected.external_email_enabled
    && actual?.disable_signup === expected.disable_signup,
  "SUPABASE_AUTH_CONFIG_ROLLBACK_VERIFICATION_FAILED");
}

function managementHeaders(accessToken) {
  return { accept: "application/json", authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
}
async function discoverActivationKeys({ accessToken, projectRef, fetcher }) {
  const rows = await expectJson(fetcher,
    `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
    { headers: managementHeaders(accessToken) }, "SUPABASE_ACTIVATION_API_KEY_DISCOVERY_FAILED");
  return selectSupabaseActivationKeys(rows);
}
async function readAuthConfig({ accessToken, projectRef, fetcher }) {
  return expectJson(fetcher, `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    { headers: managementHeaders(accessToken) }, "SUPABASE_AUTH_CONFIG_READ_FAILED");
}
async function patchAuthConfig({ accessToken, projectRef, patch, fetcher }) {
  return expectJson(fetcher, `https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
    method: "PATCH", headers: managementHeaders(accessToken), body: JSON.stringify(patch),
  }, "SUPABASE_AUTH_CONFIG_PATCH_FAILED");
}
function serviceRestHeaders(serviceRoleKey) {
  const headers = { accept: "application/json", apikey: serviceRoleKey, "content-type": "application/json" };
  if (decodeJwtPayload(serviceRoleKey)?.role === "service_role") {
    headers.authorization = `Bearer ${serviceRoleKey}`;
  }
  return headers;
}
export function authAdminHeaders(serviceRoleKey) {
  const headers = { accept: "application/json", apikey: serviceRoleKey,
    "content-type": "application/json" };
  if (decodeJwtPayload(serviceRoleKey)?.role === "service_role") {
    headers.authorization = `Bearer ${serviceRoleKey}`;
  }
  return headers;
}
function userRestHeaders(publicKey, accessToken) {
  return { accept: "application/json", apikey: publicKey,
    authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
}
async function createTemporaryUser({
  supabaseOrigin,
  serviceRoleKey,
  publicKey,
  label,
  createdUsers,
  fetcher,
}) {
  const token = randomUUID().replaceAll("-", "");
  const email = `novel-lounge-activation-${label}-${token}@example.com`;
  const password = `N!${randomBytes(32).toString("base64url")}7a`;
  const created = await expectJson(fetcher, `${supabaseOrigin}/auth/v1/admin/users`, {
    method: "POST", headers: authAdminHeaders(serviceRoleKey), body: JSON.stringify({
      email, password, email_confirm: true,
      app_metadata: { novel_public_lounge_activation_probe: true },
    }),
  }, "SUPABASE_ACTIVATION_AUTH_USER_CREATE_FAILED");
  const userId = String(created?.id || created?.user?.id || "");
  ensure(UUID.test(userId), "SUPABASE_ACTIVATION_AUTH_USER_ID_INVALID");
  const userRecord = { id: userId, accessToken: "" };
  createdUsers.push(userRecord);
  const session = await expectJson(fetcher, `${supabaseOrigin}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { accept: "application/json", apikey: publicKey,
      "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  }, "SUPABASE_ACTIVATION_AUTH_TOKEN_FAILED");
  const accessToken = String(session?.access_token || "");
  ensure(accessToken.length >= 32, "SUPABASE_ACTIVATION_AUTH_TOKEN_INVALID");
  const verified = await expectJson(fetcher, `${supabaseOrigin}/auth/v1/user`,
    { headers: userRestHeaders(publicKey, accessToken) }, "SUPABASE_ACTIVATION_AUTH_USER_VERIFY_FAILED");
  ensure(verified?.id === userId, "SUPABASE_ACTIVATION_AUTH_USER_MISMATCH");
  userRecord.accessToken = accessToken;
  return userRecord;
}
async function deleteTemporaryUser({ supabaseOrigin, serviceRoleKey, userId, fetcher }) {
  const result = await fetchResult(fetcher,
    `${supabaseOrigin}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: authAdminHeaders(serviceRoleKey) });
  ensure(result.response.ok, "SUPABASE_ACTIVATION_AUTH_USER_DELETE_FAILED", { httpStatus: result.response.status });
}
function rpcHeaders({ publicKey, serviceRoleKey, accessToken, asService }) {
  return asService ? serviceRestHeaders(serviceRoleKey) : userRestHeaders(publicKey, accessToken);
}
async function rawRpc({ supabaseOrigin, publicKey, serviceRoleKey, accessToken, name,
  parameters = {}, asService = false, fetcher }) {
  ensure(/^novel_public_lounge_[a-z_]+$/u.test(name), "SUPABASE_ACTIVATION_RPC_NAME_INVALID");
  return fetchResult(fetcher, `${supabaseOrigin}/rest/v1/rpc/${name}`, {
    method: "POST", headers: rpcHeaders({ publicKey, serviceRoleKey, accessToken, asService }),
    body: JSON.stringify(parameters),
  });
}
async function rpc(options) {
  const result = await rawRpc(options);
  if (!result.response.ok) {
    throw activationError("SUPABASE_ACTIVATION_RPC_FAILED", {
      httpStatus: result.response.status, rpcName: options.name,
    });
  }
  return result.body;
}
async function expectRpcFailure(options, marker, expectedStatus = null) {
  const result = await rawRpc(options);
  ensure(!result.response.ok && result.text.includes(marker),
    "SUPABASE_ACTIVATION_RPC_FAIL_CLOSED_ASSERTION_FAILED",
    { httpStatus: result.response.status, rpcName: options.name });
  if (expectedStatus != null) ensure(result.response.status === expectedStatus,
    "SUPABASE_ACTIVATION_RPC_ERROR_STATUS_INVALID",
    { httpStatus: result.response.status, rpcName: options.name });
}
function oneRow(value, code = "SUPABASE_ACTIVATION_RPC_ROW_INVALID") {
  ensure(Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === "object", code);
  return value[0];
}
function uuidScalar(value, code) { ensure(typeof value === "string" && UUID.test(value), code); return value; }
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
async function cleanupContractRows({ accessToken, projectRef, publicId, fetcher }) {
  ensure(PUBLIC_ID.test(publicId), "SUPABASE_ACTIVATION_CLEANUP_PUBLIC_ID_INVALID");
  const query = `begin;
delete from public.public_lounge_comment_audit where public_id = ${sqlLiteral(publicId)};
delete from public.public_lounge_publication_owners where public_id = ${sqlLiteral(publicId)};
commit;`;
  await expectJson(fetcher, `https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST", headers: managementHeaders(accessToken), body: JSON.stringify({ query }),
  }, "SUPABASE_ACTIVATION_DATABASE_CLEANUP_FAILED");
}

export async function runIsolatedTwoUserRpcContract({ accessToken, projectRef, publicKey,
  serviceRoleKey, fetcher = fetch }) {
  const supabaseOrigin = `https://${projectRef}.supabase.co`;
  const nonce = randomUUID().replaceAll("-", "");
  const publicId = `novel_activation_${nonce}`;
  const versionOne = `version_activation_${nonce}_v1`;
  const versionTwo = `version_activation_${nonce}_v2`;
  ensure(PUBLIC_ID.test(publicId) && VERSION_ID.test(versionOne) && VERSION_ID.test(versionTwo),
    "SUPABASE_ACTIVATION_TEST_ID_INVALID");
  const users = [];
  const cleanup = { attempted: false, databaseRowsRemoved: false, authUsersCreated: 0,
    authUsersDeleted: 0, completed: false };
  let contract;
  let failure;
  const baseRpc = { supabaseOrigin, publicKey, serviceRoleKey, fetcher };
  try {
    await createTemporaryUser({
      supabaseOrigin, serviceRoleKey, publicKey, label: "a", createdUsers: users, fetcher,
    });
    cleanup.authUsersCreated = users.length;
    await createTemporaryUser({
      supabaseOrigin, serviceRoleKey, publicKey, label: "b", createdUsers: users, fetcher,
    });
    cleanup.authUsersCreated = users.length;
    const [userA, userB] = users;
    ensure(userA.id !== userB.id, "SUPABASE_ACTIVATION_USERS_NOT_DISTINCT");
    const status = oneRow(await rpc({ ...baseRpc,
      name: "novel_public_lounge_interactions_status", asService: true }));
    ensure(status.migration_version === PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION
      && status.ready === true, "SUPABASE_ACTIVATION_MIGRATION_STATUS_NOT_READY");
    await rpc({ ...baseRpc, name: "novel_public_lounge_bind_owner", asService: true,
      parameters: { p_public_id: publicId, p_owner_id: userA.id, p_version_id: versionOne,
        p_version_number: 1, p_chapter_count: 3 } });
    const vote = (user, selected, versionId = versionOne) => rpc({ ...baseRpc,
      name: "novel_public_lounge_set_vote", accessToken: user.accessToken,
      parameters: { p_public_id: publicId, p_version_id: versionId, p_selected: selected } });
    const firstVote = oneRow(await vote(userA, true));
    const repeatedVote = oneRow(await vote(userA, true));
    const secondVote = oneRow(await vote(userB, true));
    ensure(Number(firstVote.vote_count) === 1 && Number(repeatedVote.vote_count) === 1
      && Number(secondVote.vote_count) === 2, "SUPABASE_ACTIVATION_ONE_VOTE_PER_USER_FAILED");
    const addComment = (user, body, versionId = versionOne) => rpc({ ...baseRpc,
      name: "novel_public_lounge_add_comment", accessToken: user.accessToken,
      parameters: { p_public_id: publicId, p_version_id: versionId, p_chapter_number: 1,
        p_display_name: "Activation probe", p_body: body } });
    const deleteComment = (user, commentId, reason, versionId = versionOne) => rpc({ ...baseRpc,
      name: "novel_public_lounge_delete_comment", accessToken: user.accessToken,
      parameters: { p_public_id: publicId, p_version_id: versionId,
        p_comment_id: commentId, p_reason: reason } });
    const authorDeleteId = uuidScalar(await addComment(userB,
      "Temporary author-delete activation probe."), "SUPABASE_ACTIVATION_COMMENT_ID_INVALID");
    await deleteComment(userA, authorDeleteId, "Author activation cleanup");
    const commenterDeleteId = uuidScalar(await addComment(userB,
      "Temporary commenter-delete activation probe."), "SUPABASE_ACTIVATION_COMMENT_ID_INVALID");
    await deleteComment(userB, commenterDeleteId, "Commenter activation cleanup");
    const reportParameters = { p_public_id: publicId, p_version_id: versionOne,
      p_target_comment_id: null, p_reason_code: "other",
      p_details: "Temporary duplicate-report activation probe." };
    uuidScalar(await rpc({ ...baseRpc, name: "novel_public_lounge_report",
      accessToken: userB.accessToken, parameters: reportParameters }),
    "SUPABASE_ACTIVATION_REPORT_ID_INVALID");
    await expectRpcFailure({ ...baseRpc, name: "novel_public_lounge_report",
      accessToken: userB.accessToken, parameters: reportParameters },
    "PUBLIC_LOUNGE_REPORT_ALREADY_SUBMITTED", 409);
    await addComment(userA, "Temporary cursor activation probe A.");
    await addComment(userB, "Temporary cursor activation probe B.");
    const firstPage = await rpc({ ...baseRpc, name: "novel_public_lounge_list_comments",
      accessToken: userA.accessToken, parameters: { p_public_id: publicId,
        p_chapter_number: null, p_limit: 1, p_before: null, p_before_id: null } });
    ensure(Array.isArray(firstPage) && firstPage.length === 1
      && UUID.test(String(firstPage[0]?.id || "")) && typeof firstPage[0]?.created_at === "string"
      && firstPage[0]?.can_delete === true, "SUPABASE_ACTIVATION_CURSOR_FIRST_PAGE_FAILED");
    const secondPage = await rpc({ ...baseRpc, name: "novel_public_lounge_list_comments",
      accessToken: userA.accessToken, parameters: { p_public_id: publicId,
        p_chapter_number: null, p_limit: 1, p_before: firstPage[0].created_at,
        p_before_id: firstPage[0].id } });
    ensure(Array.isArray(secondPage) && secondPage.length === 1
      && secondPage[0]?.id !== firstPage[0].id, "SUPABASE_ACTIVATION_CURSOR_SECOND_PAGE_FAILED");
    await rpc({ ...baseRpc, name: "novel_public_lounge_sync_owner", asService: true,
      parameters: { p_public_id: publicId, p_owner_id: userA.id,
        p_expected_version_id: versionOne, p_version_id: versionTwo,
        p_version_number: 2, p_chapter_count: 4 } });
    const afterSync = oneRow(await rpc({ ...baseRpc,
      name: "novel_public_lounge_interaction_summary", accessToken: userA.accessToken,
      parameters: { p_public_id: publicId } }));
    ensure(afterSync.current_version_id === versionTwo && Number(afterSync.comment_count) === 0,
      "SUPABASE_ACTIVATION_OLD_VERSION_SUMMARY_EXPOSED");
    const afterSyncComments = await rpc({ ...baseRpc,
      name: "novel_public_lounge_list_comments", accessToken: userA.accessToken,
      parameters: { p_public_id: publicId, p_chapter_number: null, p_limit: 10,
        p_before: null, p_before_id: null } });
    ensure(Array.isArray(afterSyncComments) && afterSyncComments.length === 0,
      "SUPABASE_ACTIVATION_OLD_VERSION_COMMENTS_EXPOSED");
    await addComment(userB, "Temporary current-version activation probe.", versionTwo);
    await rpc({ ...baseRpc, name: "novel_public_lounge_deactivate_owner", asService: true,
      parameters: { p_public_id: publicId, p_owner_id: userA.id,
        p_expected_version_id: versionTwo, p_expected_version_number: 2 } });
    await expectRpcFailure({ ...baseRpc, name: "novel_public_lounge_interaction_summary",
      accessToken: userA.accessToken, parameters: { p_public_id: publicId } },
    "PUBLIC_LOUNGE_NOT_FOUND");
    await expectRpcFailure({ ...baseRpc, name: "novel_public_lounge_list_comments",
      accessToken: userA.accessToken, parameters: { p_public_id: publicId,
        p_chapter_number: null, p_limit: 1, p_before: null, p_before_id: null } },
    "PUBLIC_LOUNGE_NOT_FOUND");
    await expectRpcFailure({ ...baseRpc, name: "novel_public_lounge_set_vote",
      accessToken: userA.accessToken, parameters: { p_public_id: publicId,
        p_version_id: versionTwo, p_selected: false } }, "PUBLIC_LOUNGE_NOT_FOUND");
    contract = { distinctAuthenticatedUsers: 2, oneVotePerUser: true, commenterDelete: true,
      authorDelete: true, duplicateReportRejected: true, createdAtIdCursor: true,
      oldVersionHiddenAfterSync: true, retractedReadRejected: true,
      retractedWriteRejected: true, assertionCount: 9 };
  } catch (error) { failure = error; }
  finally {
    cleanup.attempted = true;
    cleanup.authUsersCreated = users.length;
    const cleanupFailures = [];
    try {
      await cleanupContractRows({ accessToken, projectRef, publicId, fetcher });
      cleanup.databaseRowsRemoved = true;
    } catch { cleanupFailures.push("database"); }
    for (const user of [...users].reverse()) {
      try {
        await deleteTemporaryUser({ supabaseOrigin, serviceRoleKey, userId: user.id, fetcher });
        cleanup.authUsersDeleted += 1;
      } catch { cleanupFailures.push("auth_user"); }
    }
    cleanup.completed = cleanup.databaseRowsRemoved
      && cleanup.authUsersDeleted === cleanup.authUsersCreated;
    if (cleanupFailures.length > 0 && !failure) {
      failure = activationError("SUPABASE_ACTIVATION_CLEANUP_INCOMPLETE");
    }
  }
  if (failure) { failure.cleanup = cleanup; throw failure; }
  return { ...contract, cleanup };
}

function parseEnvFile(source) {
  const values = {};
  for (const rawLine of String(source || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}
function runVercel(args, { input, failureCode }) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, ["exec", "vercel", ...args], {
    encoding: "utf8", env: process.env, input, maxBuffer: 4 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    timeout: 60_000, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw activationError(failureCode);
}
export async function readVercelProductionEnvironment({ projectId, scope, token }) {
  const directory = await mkdtemp(resolve(tmpdir(), "novel-lounge-activation-"));
  const path = resolve(directory, ".env.production");
  try {
    runVercel(["env", "pull", path, "--environment", "production", "--project", projectId,
      "--scope", scope, "--token", token, "--yes"],
    { failureCode: "PUBLIC_LOUNGE_ACTIVATION_VERCEL_ENV_READ_FAILED" });
    return parseEnvFile(await readFile(path, "utf8"));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function writeVercelProductionEnvironment({ projectId, scope, token, key, value }) {
  ensure(Object.hasOwn(PUBLIC_LOUNGE_INTERACTIONS_PRODUCTION_ENV, key),
    "PUBLIC_LOUNGE_ACTIVATION_VERCEL_ENV_KEY_INVALID");
  ensure(!PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS.includes(key),
    "PUBLIC_LOUNGE_RUNTIME_SECRET_CREATE_ONLY_REQUIRED");
  runVercel(["env", "add", key, "production", "--project", projectId, "--scope", scope,
    "--token", token, "--force", "--no-sensitive", "--yes"], {
    input: `${value}\n`, failureCode: "PUBLIC_LOUNGE_ACTIVATION_VERCEL_ENV_WRITE_FAILED",
  });
}
export async function createVercelSensitiveProductionEnvironment({ projectId, scope, token, key, value }) {
  ensure(PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS.includes(key),
    "PUBLIC_LOUNGE_RUNTIME_SECRET_KEY_INVALID");
  ensure(canonicalRuntimeSecret(value), "PUBLIC_LOUNGE_RUNTIME_SECRET_GENERATION_INVALID", { key });
  runVercel(["env", "add", key, "production", "--project", projectId, "--scope", scope,
    "--token", token, "--sensitive", "--yes"], {
    input: `${value}\n`, failureCode: "PUBLIC_LOUNGE_RUNTIME_SECRET_CREATE_FAILED",
  });
}
function runMigrationProcess({ projectRef, accessToken }) {
  const script = fileURLToPath(new URL("./apply-public-lounge-interactions-migration.mjs", import.meta.url));
  const run = (arguments_) => {
    const result = spawnSync(process.execPath, [script, ...arguments_], {
      encoding: "utf8", env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken,
        SUPABASE_PROJECT_REF: projectRef }, maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw activationError("PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_APPLY_CHECK_FAILED");
    }
  };
  run(["--required"]);
  run(["--check", "--required"]);
}
function validateActivationOptions(options) {
  ensure(PROJECT_REF.test(options.projectRef), "SUPABASE_ACTIVATION_PROJECT_REF_INVALID");
  ensure(String(options.accessToken || "").length >= 20 && !/\s/u.test(options.accessToken),
    "SUPABASE_ACTIVATION_ACCESS_TOKEN_INVALID");
  ensure(FULL_COMMIT.test(String(options.expectedCommit || "")),
    "PUBLIC_LOUNGE_ACTIVATION_EXPECTED_COMMIT_INVALID");
  ensure(typeof options.receiptPath === "string" && options.receiptPath.trim().length > 0,
    "PUBLIC_LOUNGE_ACTIVATION_RECEIPT_PATH_REQUIRED");
  for (const [name, value] of Object.entries({ VERCEL_ORG_ID: options.vercelOrgId,
    VERCEL_PROJECT_ID: options.vercelProjectId, VERCEL_SCOPE: options.vercelScope,
    VERCEL_TOKEN: options.vercelToken })) {
    ensure(String(value || "").trim().length >= 3, `${name}_MISSING`);
  }
  const primaryOrigin = normalizeProductionOrigin(options.primaryAlias, "PRIMARY_ALIAS");
  const mirrorOrigin = normalizeProductionOrigin(options.mirrorAlias, "MIRROR_ALIAS");
  ensure(primaryOrigin !== mirrorOrigin, "PUBLIC_LOUNGE_ACTIVATION_ALIASES_NOT_DISTINCT");
  return { primaryOrigin, mirrorOrigin };
}

export async function activatePublicLoungeInteractionsProduction(options, dependencies = {}) {
  const deps = { fetcher: fetch, mutationGuard: enforceProductionMainHeadCasBeforeMutation,
    applyMigration: runMigrationProcess, runRpcContract: runIsolatedTwoUserRpcContract,
    readProductionEnvironment: readVercelProductionEnvironment,
    readProductionEnvironmentMetadata: readVercelProductionEnvironmentMetadata,
    writeProductionEnvironment: writeVercelProductionEnvironment,
    createSensitiveProductionEnvironment: createVercelSensitiveProductionEnvironment,
    generateRuntimeSecret: () => randomBytes(32).toString("base64url"), ...dependencies };
  let receipt = {
    schemaVersion: PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_RECEIPT_SCHEMA,
    status: "started", startedAt: new Date().toISOString(), completedAt: null,
    projectRefSuffix: String(options.projectRef || "").slice(-4),
    migrationVersion: PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION,
    activationVersion: PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION,
    primaryOrigin: null, mirrorOrigin: null,
    migration: { appliedAndChecked: false },
    apiKeys: { retrievedFromManagementApi: false, publicKeyKind: null, serviceRoleKeyKind: null },
    auth: { configured: false, exactCallbacks: [], existingRedirectCount: null,
      resultingRedirectCount: null, emailEnabled: false, signupEnabled: false,
      restoredAfterFailure: null },
    rpcContract: null,
    runtimeSecrets: {
      status: Object.fromEntries(PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS.map((key) => [key, null])),
      metadataVerified: false,
    },
    vercel: { target: "production", casCheckCount: 0, mutationCount: 0, mutations: [],
      preEnableValuesVerified: false, finalEnableAcknowledged: false,
      failClosedRollbackAcknowledged: null },
    errorCode: null, secretValuesStored: false,
  };
  const sensitiveValues = [options.accessToken, options.vercelToken];
  let authPlan = null;
  let authPatched = false;
  let finalEnableAcknowledged = false;
  const guardedMutation = async (metadata, operation) => {
    await deps.mutationGuard({
      ...metadata,
      required: "true",
      expectedCommit: options.expectedCommit,
    });
    receipt.vercel.casCheckCount += 1;
    return operation();
  };
  const recordVercelWrite = async (key, value, operation = "upsert") => {
    await guardedMutation({ key, operation: "VERCEL_ENV_ADD" },
      () => deps.writeProductionEnvironment({ projectId: options.vercelProjectId,
        scope: options.vercelScope, token: options.vercelToken, key, value }));
    receipt.vercel.mutations.push({ key, operation });
    receipt.vercel.mutationCount = receipt.vercel.mutations.length;
  };
  const readRuntimeSecretMetadata = () => deps.readProductionEnvironmentMetadata({
    token: options.vercelToken,
    teamId: options.vercelOrgId,
    projectId: options.vercelProjectId,
  });
  const waitForRuntimeSecretRecord = async (key) => {
    let lastError = activationError("PUBLIC_LOUNGE_RUNTIME_SECRET_METADATA_INVALID", { key });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const metadata = await readRuntimeSecretMetadata();
        ensure(metadata?.verified === true && metadata?.readOnly === true,
          "PUBLIC_LOUNGE_RUNTIME_SECRET_METADATA_UNVERIFIED");
        const records = runtimeSecretRecords(metadata, key);
        ensure(records.length === 1, "PUBLIC_LOUNGE_RUNTIME_SECRET_METADATA_INVALID", { key });
        assertPreservableRuntimeSecretRecord(records[0], key);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 5) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
      }
    }
    throw lastError;
  };
  const createRuntimeSecret = async ({ key, value }) => {
    sensitiveValues.push(value);
    try {
      await guardedMutation({ key, operation: "VERCEL_ENV_CREATE_SENSITIVE" }, () => (
        deps.createSensitiveProductionEnvironment({ projectId: options.vercelProjectId,
          scope: options.vercelScope, token: options.vercelToken, key, value })
      ));
      receipt.vercel.mutations.push({ key, operation: "create_sensitive" });
    } catch (error) {
      try {
        await waitForRuntimeSecretRecord(key);
        receipt.runtimeSecrets.status[key] = "preserved_after_create_race";
        return;
      } catch {
        throw error;
      }
    }
    receipt.vercel.mutationCount = receipt.vercel.mutations.length;
  };
  try {
    const { primaryOrigin, mirrorOrigin } = validateActivationOptions(options);
    receipt.primaryOrigin = primaryOrigin;
    receipt.mirrorOrigin = mirrorOrigin;
    await guardedMutation({ key: PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION,
      operation: "SUPABASE_MIGRATION" }, () => deps.applyMigration({
      projectRef: options.projectRef, accessToken: options.accessToken }));
    receipt.migration.appliedAndChecked = true;
    const keys = await discoverActivationKeys({ accessToken: options.accessToken,
      projectRef: options.projectRef, fetcher: deps.fetcher });
    sensitiveValues.push(keys.publicKey, keys.serviceRoleKey);
    receipt.apiKeys = { retrievedFromManagementApi: true, publicKeyKind: keys.publicKeyKind,
      serviceRoleKeyKind: keys.serviceRoleKeyKind };
    const currentAuth = await readAuthConfig({ accessToken: options.accessToken,
      projectRef: options.projectRef, fetcher: deps.fetcher });
    authPlan = planSupabaseAuthConfig(currentAuth, { primaryOrigin, mirrorOrigin });
    await guardedMutation({ key: "SUPABASE_AUTH_CONFIG", operation: "PATCH" },
      () => patchAuthConfig({ accessToken: options.accessToken, projectRef: options.projectRef,
        patch: authPlan.patch, fetcher: deps.fetcher }));
    authPatched = true;
    verifySupabaseAuthConfig(await readAuthConfig({ accessToken: options.accessToken,
      projectRef: options.projectRef, fetcher: deps.fetcher }), authPlan.patch);
    receipt.auth = { configured: true, exactCallbacks: authPlan.callbacks,
      existingRedirectCount: authPlan.existingRedirectCount,
      resultingRedirectCount: authPlan.resultingRedirectCount, emailEnabled: true,
      signupEnabled: true, restoredAfterFailure: null };
    const rpcContract = await deps.runRpcContract({ accessToken: options.accessToken,
      projectRef: options.projectRef, publicKey: keys.publicKey,
      serviceRoleKey: keys.serviceRoleKey, fetcher: deps.fetcher });
    ensure(rpcContract?.cleanup?.completed === true, "SUPABASE_ACTIVATION_CLEANUP_NOT_ATTESTED");
    receipt.rpcContract = rpcContract;
    const runtimeSecretPlan = planPublicLoungeRuntimeSecrets(
      await readRuntimeSecretMetadata(),
      deps.generateRuntimeSecret,
    );
    receipt.runtimeSecrets.status = { ...runtimeSecretPlan.status };
    const desired = { ...PUBLIC_LOUNGE_INTERACTIONS_PRODUCTION_ENV,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.publicKey };
    await recordVercelWrite("PUBLIC_LOUNGE_INTERACTIONS_ENABLED", "0", "fail_closed");
    for (const action of runtimeSecretPlan.actions) await createRuntimeSecret(action);
    for (const key of PUBLIC_LOUNGE_RUNTIME_SECRET_KEYS) await waitForRuntimeSecretRecord(key);
    verifyPublicLoungeRuntimeSecretMetadata(await readRuntimeSecretMetadata());
    receipt.runtimeSecrets.metadataVerified = true;
    for (const key of ["NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION",
      "PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION"]) {
      await recordVercelWrite(key, desired[key]);
    }
    const beforeEnable = await deps.readProductionEnvironment({ projectId: options.vercelProjectId,
      scope: options.vercelScope, token: options.vercelToken });
    ensure(beforeEnable.PUBLIC_LOUNGE_INTERACTIONS_ENABLED === "0"
      && beforeEnable.NEXT_PUBLIC_SUPABASE_ANON_KEY === keys.publicKey
      && beforeEnable.PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION
        === PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION
      && beforeEnable.PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION
        === PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION,
    "PUBLIC_LOUNGE_ACTIVATION_PRE_ENABLE_ENV_VERIFICATION_FAILED");
    receipt.vercel.preEnableValuesVerified = true;
    receipt.status = "ready_for_final_enable";
    await writeSanitizedReceipt(options.receiptPath, receipt, sensitiveValues);
    await recordVercelWrite("PUBLIC_LOUNGE_INTERACTIONS_ENABLED", "1", "final_enable");
    finalEnableAcknowledged = true;
    receipt.vercel.finalEnableAcknowledged = true;
    receipt.status = "activated";
    receipt.completedAt = new Date().toISOString();
    receipt = await writeSanitizedReceipt(options.receiptPath, receipt, sensitiveValues);
    return receipt;
  } catch (error) {
    const originalCode = safeErrorCode(error);
    if (error?.cleanup) receipt.rpcContract = { cleanup: error.cleanup };
    if (finalEnableAcknowledged) {
      try {
        await recordVercelWrite("PUBLIC_LOUNGE_INTERACTIONS_ENABLED", "0", "failure_rollback");
        receipt.vercel.failClosedRollbackAcknowledged = true;
      } catch { receipt.vercel.failClosedRollbackAcknowledged = false; }
    }
    if (authPatched && authPlan) {
      try {
        await guardedMutation({ key: "SUPABASE_AUTH_CONFIG", operation: "ROLLBACK_PATCH" },
          () => patchAuthConfig({ accessToken: options.accessToken, projectRef: options.projectRef,
            patch: authPlan.original, fetcher: deps.fetcher }));
        const restored = await readAuthConfig({ accessToken: options.accessToken,
          projectRef: options.projectRef, fetcher: deps.fetcher });
        verifyRestoredAuthConfig(restored, authPlan.original);
        receipt.auth.restoredAfterFailure = true;
      } catch { receipt.auth.restoredAfterFailure = false; }
    }
    receipt.status = "failed";
    receipt.completedAt = new Date().toISOString();
    receipt.errorCode = originalCode;
    try { await writeSanitizedReceipt(options.receiptPath, receipt, sensitiveValues); } catch { /* safe */ }
    throw activationError(originalCode, {
      httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
    });
  }
}

async function main() {
  ensure(process.argv.includes("--required"), "PUBLIC_LOUNGE_ACTIVATION_REQUIRED_FLAG_MISSING");
  throw activationError("PUBLIC_LOUNGE_MAGIC_LINK_PKCE_BROWSER_E2E_REQUIRED");
}
const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "public_lounge_interactions_activation_failed",
      errorCode: safeErrorCode(error), httpStatus: Number.isInteger(error?.httpStatus)
        ? error.httpStatus : null, secretValuesStored: false }));
    process.exitCode = 1;
  });
}
