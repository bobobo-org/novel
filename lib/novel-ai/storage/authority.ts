import type { StoryBibleProjectPolicy } from "./types";

export const LOCAL_CANONICAL = "LOCAL_CANONICAL" as const;
export const EXTERNAL_ADVISORY = "EXTERNAL_ADVISORY" as const;
export const CLOUD_OPTIONAL = "CLOUD_OPTIONAL" as const;
export const NO_SILENT_REMOTE_WRITE = "NO_SILENT_REMOTE_WRITE" as const;
export const NO_SILENT_REMOTE_FALLBACK = "NO_SILENT_REMOTE_FALLBACK" as const;

export function defaultProjectStoragePolicy(overrides: Partial<StoryBibleProjectPolicy> = {}): StoryBibleProjectPolicy {
  const { canonicalAuthority: _ignoredAuthority, ...safeOverrides } = overrides;
  return {
    primaryStorage: "SUPABASE_CLOUD",
    canonicalAuthority: "local",
    cloudSyncEnabled: false,
    cloudBackupEnabled: false,
    externalImportEnabled: false,
    fullOfflineRequired: false,
    encryptionRequired: false,
    storageSchemaVersion: "story-bible-storage-l0a",
    lastMigrationAt: null,
    lastVerifiedAt: new Date().toISOString(),
    ...safeOverrides,
  };
}

export function assertLocalAuthority(policy: StoryBibleProjectPolicy) {
  if (policy.canonicalAuthority !== "local") {
    throw Object.assign(new Error("Canonical authority must remain local."), {
      name: "LOCAL_AUTHORITY_VIOLATION",
      code: "LOCAL_AUTHORITY_VIOLATION",
    });
  }
}

export function assertCloudOptional(policy: StoryBibleProjectPolicy) {
  if (policy.fullOfflineRequired && policy.cloudSyncEnabled) {
    throw Object.assign(new Error("Full offline projects cannot require cloud sync."), {
      name: "CLOUD_REQUIRED_VIOLATION",
      code: "CLOUD_REQUIRED_VIOLATION",
    });
  }
}

export function assertNoRequiredExternalDependency(policy: StoryBibleProjectPolicy) {
  assertLocalAuthority(policy);
  assertCloudOptional(policy);
  if (policy.externalImportEnabled && policy.canonicalAuthority !== "local") {
    throw Object.assign(new Error("External imports may only create candidates, never canonical facts."), {
      name: "EXTERNAL_DIRECT_CANONICAL_WRITE_BLOCKED",
      code: "EXTERNAL_DIRECT_CANONICAL_WRITE_BLOCKED",
    });
  }
}

export function assertExternalCanonicalWriteBlocked(sourceProviderType: string, target: "candidate" | "canonical") {
  if (sourceProviderType !== "manual" && target === "canonical") {
    throw Object.assign(new Error("External providers can only write advisory candidates."), {
      name: "EXTERNAL_DIRECT_CANONICAL_WRITE_BLOCKED",
      code: "EXTERNAL_DIRECT_CANONICAL_WRITE_BLOCKED",
    });
  }
}
