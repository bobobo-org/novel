import type {
  PublicLoungePost,
  PublicLoungePostSummary,
  PublicLoungeQualityDimensionKey,
} from "./types";
import {
  PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION,
  PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION,
} from "./types";

export const PUBLIC_LOUNGE_STORAGE_PREFIX = "public-lounge-v1";
export const PUBLIC_LOUNGE_STORAGE_BUCKET = "novel-public-lounge-v1";
export const PUBLIC_LOUNGE_STORAGE_SCHEMA_VERSION = "novel-public-lounge-storage-v1";
export const PUBLIC_LOUNGE_STORAGE_MIGRATION_VERSION = "public_lounge_storage_001";
export const PUBLIC_LOUNGE_STORAGE_MARKER_PATH = `_system/${PUBLIC_LOUNGE_STORAGE_MIGRATION_VERSION}.json`;

export type PublicLoungeStorageObject = { name: string };

export interface PublicLoungeStorageGateway {
  bucketStatus(): Promise<{ exists: boolean; public: boolean; provisioned: boolean }>;
  readJson<T>(path: string): Promise<T | null>;
  writeJson(path: string, value: unknown, options: { upsert: boolean }): Promise<"stored" | "exists">;
  deleteJson(paths: string[]): Promise<void>;
  list(prefix: string, options: { limit: number; offset: number }): Promise<PublicLoungeStorageObject[]>;
}

export type StoredPublicLoungePost = {
  schemaVersion: typeof PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION;
  state: "active";
  publicPost: PublicLoungePost;
  managementTokenHash: string;
  updatedAt: string;
};

export type StoredPublicLoungeTombstone = {
  schemaVersion: typeof PUBLIC_LOUNGE_STORED_POST_SCHEMA_VERSION;
  state: "retracted";
  publicId: string;
  managementTokenHash: string;
  updatedAt: string;
};

export type StoredPublicLoungeIndexEntry = PublicLoungePostSummary;

export type StoredPublicLoungeEligibility = {
  schemaVersion: typeof PUBLIC_LOUNGE_STORED_ELIGIBILITY_SCHEMA_VERSION;
  state: "issued";
  ticketHash: string;
  completionFingerprint: string;
  publicationDigest: string;
  backendId: "private-ai-hub";
  modelId: string;
  modelDigest: string;
  qualityScore: number;
  qualityBreakdown: Record<PublicLoungeQualityDimensionKey, number>;
  issuedAt: string;
  expiresAt: string;
};

export function publicLoungePostPath(publicId: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/posts/${publicId}.json`;
}

export function publicLoungeIndexPath(publicId: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/index/${publicId}.json`;
}

export function publicLoungeIndexPrefix() {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/index`;
}

export function publicLoungeEligibilityPath(ticketHash: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/eligibility/issued/${ticketHash}.json`;
}

export function publicLoungeEligibilityConsumedPath(ticketHash: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/eligibility/consumed/${ticketHash}.json`;
}

export function publicLoungeEligibilityAttestationPath(attestationDigest: string) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/eligibility/attestations/${attestationDigest}.json`;
}

export function publicLoungeEligibilityRatePath(clientKey: string, minuteBucket: number) {
  return `${PUBLIC_LOUNGE_STORAGE_PREFIX}/eligibility/rate/${clientKey}-${minuteBucket}.json`;
}
