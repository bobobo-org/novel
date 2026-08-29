import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "novel-public-lounge-v1";
const SCHEMA_VERSION = "novel-public-lounge-storage-v1";
const MIGRATION_VERSION = "public_lounge_storage_001";
const MARKER_PATH = `_system/${MIGRATION_VERSION}.json`;
const FILE_SIZE_LIMIT = 3_000_000;
const MAX_PROVISION_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2_000;
const args = new Set(process.argv.slice(2));
const required = args.has("--required");
const verifyOnly = args.has("--verify-only");
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

function errorMessage(error) {
  return String(error?.message ?? "");
}

function isNotFound(error) {
  return statusCode(error) === 404 || /not[ _-]?found/iu.test(errorMessage(error));
}

function isAlreadyExists(error) {
  return [400, 409].includes(statusCode(error))
    && /already exists|duplicate|asset exists/iu.test(errorMessage(error));
}

function isTransient(error) {
  const status = statusCode(error);
  return [408, 425, 429].includes(status)
    || status >= 500
    || /econnreset|etimedout|fetch failed|gateway timeout|temporar(?:y|ily)|timeout/iu.test(errorMessage(error));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(code) {
  console.error(JSON.stringify({
    status: "public_lounge_storage_not_ready",
    bucket: BUCKET,
    migrationVersion: MIGRATION_VERSION,
    errorCode: code,
  }));
  if (required) process.exitCode = 1;
}

const fileEnv = envFile ? parseEnvFile(await readFile(envFile, "utf8")) : {};
const env = { ...fileEnv, ...process.env };
const url = String(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/u, "");
const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "");

if (!url || !serviceRoleKey) {
  fail("PUBLIC_LOUNGE_STORAGE_CONFIGURATION_MISSING");
} else {
  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { "X-Client-Info": "novel-public-lounge-provisioner/1.0" },
    },
  });

  async function provisionAndVerify() {
    let { data: bucket, error: bucketError } = await supabase.storage.getBucket(BUCKET);
    let created = false;
    if (bucketError && isNotFound(bucketError)) {
      if (verifyOnly) {
        throw Object.assign(new Error("PUBLIC_LOUNGE_STORAGE_BUCKET_MISSING"), {
          code: "PUBLIC_LOUNGE_STORAGE_BUCKET_MISSING",
        });
      }
      const creation = await supabase.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: FILE_SIZE_LIMIT,
        allowedMimeTypes: ["application/json"],
      });
      if (creation.error && !isAlreadyExists(creation.error)) throw creation.error;
      created = !creation.error;
      ({ data: bucket, error: bucketError } = await supabase.storage.getBucket(BUCKET));
    }
    if (bucketError) throw bucketError;
    if (!bucket) throw Object.assign(new Error("PUBLIC_LOUNGE_STORAGE_BUCKET_MISSING"), {
      code: "PUBLIC_LOUNGE_STORAGE_BUCKET_MISSING",
    });

    if (!verifyOnly) {
      const update = await supabase.storage.updateBucket(BUCKET, {
        public: false,
        fileSizeLimit: FILE_SIZE_LIMIT,
        allowedMimeTypes: ["application/json"],
      });
      if (update.error) throw update.error;
      ({ data: bucket, error: bucketError } = await supabase.storage.getBucket(BUCKET));
      if (bucketError) throw bucketError;
    }
    if (!bucket || bucket.public) {
      throw Object.assign(new Error("PUBLIC_LOUNGE_STORAGE_BUCKET_NOT_PRIVATE"), {
        code: "PUBLIC_LOUNGE_STORAGE_BUCKET_NOT_PRIVATE",
      });
    }

    if (!verifyOnly) {
      const marker = {
        schemaVersion: SCHEMA_VERSION,
        migrationVersion: MIGRATION_VERSION,
        backend: "private-object-storage",
        public: false,
        allowedMimeTypes: ["application/json"],
        maxObjectBytes: FILE_SIZE_LIMIT,
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
    }

    const markerDownload = await supabase.storage
      .from(BUCKET)
      .download(
        MARKER_PATH,
        { cacheNonce: `${Date.now()}-${crypto.randomUUID()}` },
        { cache: "no-store" },
      );
    if (markerDownload.error) throw markerDownload.error;
    const marker = JSON.parse(await markerDownload.data.text());
    if (
      marker?.schemaVersion !== SCHEMA_VERSION
      || marker?.migrationVersion !== MIGRATION_VERSION
      || marker?.backend !== "private-object-storage"
      || marker?.public !== false
      || marker?.maxObjectBytes !== FILE_SIZE_LIMIT
      || JSON.stringify(marker?.allowedMimeTypes) !== JSON.stringify(["application/json"])
    ) {
      throw Object.assign(new Error("PUBLIC_LOUNGE_STORAGE_MARKER_INVALID"), {
        code: "PUBLIC_LOUNGE_STORAGE_MARKER_INVALID",
      });
    }
    const listing = await supabase.storage
      .from(BUCKET)
      .list("_system", { limit: 10, offset: 0 }, { cache: "no-store" });
    if (listing.error || !listing.data.some((item) => item.name === `${MIGRATION_VERSION}.json`)) {
      throw listing.error ?? Object.assign(new Error("PUBLIC_LOUNGE_STORAGE_MARKER_NOT_LISTED"), {
        code: "PUBLIC_LOUNGE_STORAGE_MARKER_NOT_LISTED",
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
          status: "public_lounge_storage_retry",
          bucket: BUCKET,
          attempt,
          nextAttempt: attempt + 1,
          retryDelayMs,
          errorCode: String(error?.code || `SUPABASE_STORAGE_HTTP_${statusCode(error) || 500}`),
        }));
        await delay(retryDelayMs);
      }
    }
    console.log(JSON.stringify({
      status: verifyOnly
        ? "public_lounge_storage_verified"
        : "public_lounge_storage_provisioned_and_verified",
      schemaVersion: SCHEMA_VERSION,
      migrationVersion: MIGRATION_VERSION,
      backend: "private-object-storage",
      bucket: BUCKET,
      bucketCreated: created,
      bucketPublic: false,
      allowedMimeTypes: ["application/json"],
      maxObjectBytes: FILE_SIZE_LIMIT,
    }));
  } catch (error) {
    fail(String(error?.code || `SUPABASE_STORAGE_HTTP_${statusCode(error) || 500}`));
  }
}
