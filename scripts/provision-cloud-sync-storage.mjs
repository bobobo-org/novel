import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "novel-cloud-sync-e2ee";
const SCHEMA_VERSION = "novel-cloud-sync-e2ee-v1";
const MIGRATION_VERSION = "cloud_sync_e2ee_storage_001";
const MARKER_PATH = `_system/${MIGRATION_VERSION}.json`;
const MAX_PROVISION_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2_000;
const args = new Set(process.argv.slice(2));
const required = args.has("--required");
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

function statusCode(error) {
  return Number(error?.statusCode ?? error?.status ?? 0);
}

function message(error) {
  return String(error?.message ?? "");
}

function isNotFound(error) {
  return statusCode(error) === 404 || /not[ _-]?found/iu.test(message(error));
}

function isAlreadyExists(error) {
  return [400, 409].includes(statusCode(error))
    && /already exists|duplicate|asset exists/iu.test(message(error));
}

function isTransient(error) {
  const status = statusCode(error);
  return [408, 425, 429].includes(status)
    || status >= 500
    || /econnreset|etimedout|fetch failed|gateway timeout|temporar(?:y|ily)|timeout/iu.test(message(error));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(code, detail = {}) {
  console.error(JSON.stringify({
    status: "storage_provision_failed",
    migrationVersion: MIGRATION_VERSION,
    errorCode: code,
    ...detail,
  }));
  if (required) process.exit(1);
}

const fileEnv = envFile ? parseEnvFile(await readFile(envFile, "utf8")) : {};
const env = { ...fileEnv, ...process.env };
const url = String(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/u, "");
const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "");

if (!url || !serviceRoleKey) {
  fail("SUPABASE_STORAGE_CONFIGURATION_MISSING");
} else {
  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { "X-Client-Info": "novel-cloud-sync-provisioner/1.0" },
    },
  });

  async function provisionAndVerify() {
    let { data: bucket, error: bucketError } = await supabase.storage.getBucket(BUCKET);
    let created = false;
    if (bucketError && isNotFound(bucketError)) {
      const creation = await supabase.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: 4_500_000,
        allowedMimeTypes: ["application/json"],
      });
      if (creation.error && !isAlreadyExists(creation.error)) throw creation.error;
      created = !creation.error;
      ({ data: bucket, error: bucketError } = await supabase.storage.getBucket(BUCKET));
    }
    if (bucketError) throw bucketError;
    if (!bucket || bucket.public) {
      throw Object.assign(new Error("SUPABASE_STORAGE_BUCKET_NOT_PRIVATE"), {
        code: "SUPABASE_STORAGE_BUCKET_NOT_PRIVATE",
      });
    }

    const marker = {
      schemaVersion: SCHEMA_VERSION,
      migrationVersion: MIGRATION_VERSION,
      backend: "private-object-storage",
      public: false,
      provisionedAt: new Date().toISOString(),
    };
    const markerUpload = await supabase.storage
      .from(BUCKET)
      .upload(
        MARKER_PATH,
        new Blob([JSON.stringify(marker)], { type: "application/json" }),
        {
          cacheControl: "0",
          contentType: "application/json",
          upsert: true,
        },
      );
    if (markerUpload.error) throw markerUpload.error;
    const markerDownload = await supabase.storage
      .from(BUCKET)
      .download(
        MARKER_PATH,
        { cacheNonce: `${Date.now()}-${crypto.randomUUID()}` },
        { cache: "no-store" },
      );
    if (markerDownload.error) throw markerDownload.error;
    const verified = JSON.parse(await markerDownload.data.text());
    if (
      verified?.schemaVersion !== SCHEMA_VERSION
      || verified?.migrationVersion !== MIGRATION_VERSION
      || verified?.backend !== "private-object-storage"
      || verified?.public !== false
    ) {
      throw Object.assign(new Error("SUPABASE_STORAGE_MARKER_INVALID"), {
        code: "SUPABASE_STORAGE_MARKER_INVALID",
      });
    }
    const listing = await supabase.storage
      .from(BUCKET)
      .list("_system", { limit: 10, offset: 0 }, { cache: "no-store" });
    if (listing.error || !listing.data.some((item) => item.name === `${MIGRATION_VERSION}.json`)) {
      throw listing.error ?? Object.assign(new Error("SUPABASE_STORAGE_MARKER_NOT_LISTED"), {
        code: "SUPABASE_STORAGE_MARKER_NOT_LISTED",
      });
    }
    return created;
  }

  try {
    let created = false;
    for (let attempt = 1; attempt <= MAX_PROVISION_ATTEMPTS; attempt += 1) {
      try {
        created = await provisionAndVerify();
        break;
      } catch (error) {
        if (!isTransient(error) || attempt === MAX_PROVISION_ATTEMPTS) throw error;
        const retryDelayMs = RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
        console.warn(JSON.stringify({
          status: "storage_provision_retry",
          migrationVersion: MIGRATION_VERSION,
          attempt,
          nextAttempt: attempt + 1,
          retryDelayMs,
          errorCode: String(error?.code || `SUPABASE_STORAGE_HTTP_${statusCode(error) || 500}`),
        }));
        await delay(retryDelayMs);
      }
    }
    console.log(JSON.stringify({
      status: "storage_provisioned_and_verified",
      schemaVersion: SCHEMA_VERSION,
      migrationVersion: MIGRATION_VERSION,
      backend: "private-object-storage",
      bucketCreated: created,
      bucketPublic: false,
    }));
  } catch (error) {
    fail(String(error?.code || `SUPABASE_STORAGE_HTTP_${statusCode(error) || 500}`));
  }
}
