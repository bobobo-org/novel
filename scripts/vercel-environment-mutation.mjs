import { boundedFetch } from "./bounded-fetch.mjs";

function mutationError(code, details = {}) {
  return Object.assign(new Error(code), { code, details });
}

export async function upsertSensitiveProductionEnvironment({
  token,
  teamId,
  projectId,
  key,
  value,
  fetcher = fetch,
  fetchTimeoutMs = 10_000,
  deadlineAt = Date.now() + 30_000,
}) {
  if (!token || !teamId || !projectId) {
    throw mutationError("VERCEL_SENSITIVE_ENV_AUTH_MISSING");
  }
  if (!/^[A-Z][A-Z0-9_]{1,127}$/u.test(String(key || ""))) {
    throw mutationError("VERCEL_SENSITIVE_ENV_KEY_INVALID");
  }
  if (!String(value || "")) {
    throw mutationError("VERCEL_SENSITIVE_ENV_VALUE_EMPTY");
  }
  const url = new URL(
    `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env`,
  );
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("upsert", "true");
  const response = await boundedFetch(fetcher, url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key,
      value,
      type: "sensitive",
      target: ["production"],
    }),
    cache: "no-store",
  }, {
    timeoutMs: fetchTimeoutMs,
    deadlineAt,
    timeoutCode: "VERCEL_SENSITIVE_ENV_UPSERT_TIMEOUT",
  });
  void response.body?.cancel().catch(() => undefined);
  if (!response.ok) {
    throw mutationError("VERCEL_SENSITIVE_ENV_UPSERT_FAILED", {
      key,
      httpStatus: response.status,
    });
  }
  return {
    mutationCount: 1,
    changedKeys: [key],
    key,
    type: "sensitive",
    target: "production",
    httpStatus: response.status,
    secretValuesStored: false,
  };
}
