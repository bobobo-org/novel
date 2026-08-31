const required = process.argv.includes("--required");
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/u, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const publicId = process.env.PUBLIC_LOUNGE_INTERACTIONS_TEST_PUBLIC_ID || "";
const versionId = process.env.PUBLIC_LOUNGE_INTERACTIONS_TEST_VERSION_ID || "";
const userAToken = process.env.PUBLIC_LOUNGE_INTERACTIONS_TEST_USER_A_ACCESS_TOKEN || "";
const userBToken = process.env.PUBLIC_LOUNGE_INTERACTIONS_TEST_USER_B_ACCESS_TOKEN || "";
const retractedPublicId = process.env.PUBLIC_LOUNGE_INTERACTIONS_TEST_RETRACTED_PUBLIC_ID || "";

function fail(status, code, exitCode = 1) {
  console.error(JSON.stringify({ status, errorCode: code }));
  process.exit(exitCode);
}

function configured() {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && parsed.pathname === "/"
      && Boolean(anonKey && serviceRoleKey && anonKey !== serviceRoleKey)
      && /^novel_[a-z0-9_-]{12,80}$/u.test(publicId)
      && /^version_[a-z0-9_-]{12,96}$/u.test(versionId)
      && userAToken.length >= 32
      && userBToken.length >= 32;
  } catch {
    return false;
  }
}

if (!configured()) {
  if (required) fail("rpc_self_test_configuration_missing", "REAL_TWO_USER_CONFIGURATION_REQUIRED", 2);
  console.log(JSON.stringify({ status: "rpc_self_test_configuration_missing" }));
  process.exit(0);
}

async function jsonRequest(path, key, token, body, expected = 200) {
  const response = await fetch(`${url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  if (response.status !== expected) {
    fail("rpc_self_test_failed", `HTTP_${response.status}_${path.split("/").at(-1)}`);
  }
  return value;
}

async function rpc(name, token, parameters = {}, key = anonKey) {
  return jsonRequest(`/rest/v1/rpc/${name}`, key, token, parameters);
}

function oneRow(value) {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object") {
    fail("rpc_self_test_failed", "RPC_ROW_SHAPE_INVALID");
  }
  return value[0];
}

const [userA, userB] = await Promise.all([
  jsonRequest("/auth/v1/user", anonKey, userAToken),
  jsonRequest("/auth/v1/user", anonKey, userBToken),
]);
if (!userA?.id || !userB?.id || userA.id === userB.id) {
  fail("rpc_self_test_failed", "TWO_DISTINCT_VERIFIED_USERS_REQUIRED");
}

const status = oneRow(await rpc(
  "novel_public_lounge_interactions_status",
  serviceRoleKey,
  {},
  serviceRoleKey,
));
if (status.migration_version !== "public_lounge_interactions_v1_027" || status.ready !== true) {
  fail("rpc_self_test_failed", "MIGRATION_STATUS_NOT_READY");
}

await rpc("novel_public_lounge_assert_owner", serviceRoleKey, {
  p_public_id: publicId,
  p_owner_id: userA.id,
}, serviceRoleKey);

const vote = (token, selected) => rpc("novel_public_lounge_set_vote", token, {
  p_public_id: publicId,
  p_version_id: versionId,
  p_selected: selected,
});
await vote(userAToken, false);
await vote(userBToken, false);
const baseline = Number(oneRow(await rpc("novel_public_lounge_interaction_summary", userAToken, {
  p_public_id: publicId,
})).vote_count);
const first = oneRow(await vote(userAToken, true));
const duplicate = oneRow(await vote(userAToken, true));
const secondUser = oneRow(await vote(userBToken, true));
if (Number(first.vote_count) !== baseline + 1
  || Number(duplicate.vote_count) !== baseline + 1
  || Number(secondUser.vote_count) !== baseline + 2) {
  fail("rpc_self_test_failed", "ONE_VOTE_PER_USER_CONTRACT_FAILED");
}

const commentId = await rpc("novel_public_lounge_add_comment", userBToken, {
  p_public_id: publicId,
  p_version_id: versionId,
  p_chapter_number: 1,
  p_display_name: "RPC 驗證讀者",
  p_body: "這是部署前的真實 RPC 自我測試留言，測試結束後由作品 owner 軟刪。",
});
if (typeof commentId !== "string") fail("rpc_self_test_failed", "COMMENT_ID_INVALID");
const comments = await rpc("novel_public_lounge_list_comments", userBToken, {
  p_public_id: publicId,
  p_chapter_number: null,
  p_limit: 1,
  p_before: null,
  p_before_id: null,
});
if (!Array.isArray(comments) || comments.length > 1 || comments[0]?.can_delete !== true) {
  fail("rpc_self_test_failed", "LIMIT_ONE_OR_CAN_DELETE_FAILED");
}
await rpc("novel_public_lounge_delete_comment", userAToken, {
  p_public_id: publicId,
  p_version_id: versionId,
  p_comment_id: commentId,
  p_reason: "部署前 RPC 自我測試清理",
});

await vote(userAToken, false);
const restored = oneRow(await vote(userBToken, false));
if (Number(restored.vote_count) !== baseline) {
  fail("rpc_self_test_failed", "VOTE_CLEANUP_FAILED");
}

if (retractedPublicId) {
  const response = await fetch(`${url}/rest/v1/rpc/novel_public_lounge_interaction_summary`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${userAToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_public_id: retractedPublicId }),
  });
  const text = await response.text();
  if (response.ok || !text.includes("PUBLIC_LOUNGE_NOT_FOUND")) {
    fail("rpc_self_test_failed", "RETRACTED_PUBLICATION_EXPOSED");
  }
}

console.log(JSON.stringify({
  status: "rpc_self_test_passed",
  migrationVersion: status.migration_version,
  verifiedDistinctUsers: 2,
  limitOneRows: comments.length,
  retractedCheck: retractedPublicId ? "passed" : "not_configured",
}));
