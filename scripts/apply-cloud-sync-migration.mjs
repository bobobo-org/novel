import { readFile } from "node:fs/promises";

const MIGRATION_VERSION = "cloud_sync_e2ee_025";
const args = new Set(process.argv.slice(2));
const required = args.has("--required");
const checkOnly = args.has("--check");
const envFileIndex = process.argv.indexOf("--env-file");
const envFile = envFileIndex >= 0 ? process.argv[envFileIndex + 1] : "";

function parseEnvFile(source) {
  const parsed = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function projectRefFromUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname;
    const candidate = host.split(".")[0] ?? "";
    return /^[a-z0-9]{8,32}$/u.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

const fileEnv = envFile
  ? parseEnvFile(await readFile(envFile, "utf8"))
  : {};
const env = { ...fileEnv, ...process.env };
const accessToken = env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_MANAGEMENT_TOKEN || "";
const projectRef = env.SUPABASE_PROJECT_REF
  || projectRefFromUrl(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "");
const configuration = {
  accessTokenConfigured: Boolean(accessToken),
  projectRefConfigured: Boolean(projectRef),
  migrationVersion: MIGRATION_VERSION,
};

if (checkOnly) {
  console.log(JSON.stringify({
    status: configuration.accessTokenConfigured && configuration.projectRefConfigured
      ? "migration_channel_ready"
      : "migration_channel_missing",
    ...configuration,
  }));
  process.exit(0);
}

if (!accessToken || !projectRef) {
  console.error(JSON.stringify({
    status: "migration_channel_missing",
    ...configuration,
  }));
  if (required) process.exit(2);
  process.exit(0);
}

async function query(sql) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(new Error(`SUPABASE_MIGRATION_HTTP_${response.status}`), {
        code: `SUPABASE_MIGRATION_HTTP_${response.status}`,
        status: response.status,
      });
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const sql = await readFile(new URL("../prisma/migrations/025_cloud_sync_e2ee.sql", import.meta.url), "utf8");
  await query(sql);
  const verification = await query(`
    select
      to_regclass('public.novel_cloud_snapshots') is not null as snapshots_ready,
      to_regclass('public.novel_cloud_sync_operations') is not null as operations_ready,
      to_regprocedure('public.novel_cloud_sync_push(text,text,text,bigint,text,integer,jsonb)') is not null as rpc_ready,
      exists(select 1 from public.schema_migrations where version = '${MIGRATION_VERSION}') as marker_ready;
  `);
  const row = Array.isArray(verification) ? verification[0] : verification;
  const ready = row?.snapshots_ready === true
    && row?.operations_ready === true
    && row?.rpc_ready === true
    && row?.marker_ready === true;
  if (!ready) throw Object.assign(new Error("SUPABASE_MIGRATION_VERIFICATION_FAILED"), {
    code: "SUPABASE_MIGRATION_VERIFICATION_FAILED",
  });
  console.log(JSON.stringify({
    status: "migration_applied_and_verified",
    migrationVersion: MIGRATION_VERSION,
    projectRefSuffix: projectRef.slice(-4),
  }));
} catch (error) {
  console.error(JSON.stringify({
    status: "migration_failed",
    migrationVersion: MIGRATION_VERSION,
    errorCode: String(error?.code || error?.name || "SUPABASE_MIGRATION_FAILED"),
  }));
  process.exit(1);
}
