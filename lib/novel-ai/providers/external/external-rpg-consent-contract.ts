import {
  isExternalAIProviderId,
  type ExternalAIProviderId,
} from "./external-provider-contract";

export const EXTERNAL_RPG_CONSENT_SCHEMA_VERSION = "external-rpg-consent-v1" as const;
export const EXTERNAL_RPG_CONSENT_PURPOSE = "rpg-turn" as const;
export const EXTERNAL_RPG_CONSENT_MAX_AGE_MS = 2 * 60 * 1_000;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const OPAQUE_ID = /^[^\s]{8,240}$/u;

/**
 * A browser-originated, single-run consent assertion. This is deliberately not
 * described as an authorization token: the current public app has no verified
 * user session from which a server-authoritative grant could safely be minted.
 * It strengthens the existing same-origin explicit-consent boundary by binding
 * the exact RPG request and preventing accidental/replayed use per instance.
 */
export type ExternalRpgConsentAssertion = {
  schemaVersion: typeof EXTERNAL_RPG_CONSENT_SCHEMA_VERSION;
  purpose: typeof EXTERNAL_RPG_CONSENT_PURPOSE;
  grantId: string;
  projectId: string;
  logicalRequestId: string;
  providerId: ExternalAIProviderId;
  promptDigest: string;
  fieldManifestDigest: string;
  grantedAt: string;
  expiresAt: string;
};

export type ExternalRpgConsentBinding = Pick<
  ExternalRpgConsentAssertion,
  "projectId" | "logicalRequestId" | "providerId" | "promptDigest" | "fieldManifestDigest"
>;

export function isExternalRpgConsentBinding(value: unknown): value is ExternalRpgConsentBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.projectId === "string"
    && OPAQUE_ID.test(row.projectId)
    && typeof row.logicalRequestId === "string"
    && OPAQUE_ID.test(row.logicalRequestId)
    && isExternalAIProviderId(row.providerId)
    && typeof row.promptDigest === "string"
    && SHA256_HEX.test(row.promptDigest)
    && typeof row.fieldManifestDigest === "string"
    && SHA256_HEX.test(row.fieldManifestDigest);
}

export function isExternalRpgConsentAssertion(value: unknown): value is ExternalRpgConsentAssertion {
  if (!isExternalRpgConsentBinding(value)) return false;
  const row = value as unknown as Record<string, unknown>;
  const grantedAt = typeof row.grantedAt === "string" ? Date.parse(row.grantedAt) : Number.NaN;
  const expiresAt = typeof row.expiresAt === "string" ? Date.parse(row.expiresAt) : Number.NaN;
  return row.schemaVersion === EXTERNAL_RPG_CONSENT_SCHEMA_VERSION
    && row.purpose === EXTERNAL_RPG_CONSENT_PURPOSE
    && typeof row.grantId === "string"
    && OPAQUE_ID.test(row.grantId)
    && Number.isFinite(grantedAt)
    && Number.isFinite(expiresAt)
    && expiresAt > grantedAt
    && expiresAt - grantedAt <= EXTERNAL_RPG_CONSENT_MAX_AGE_MS;
}

export function createExternalRpgConsentAssertion(
  binding: ExternalRpgConsentBinding,
  input: { grantId?: string; now?: number } = {},
) {
  if (!isExternalRpgConsentBinding(binding)) {
    throw Object.assign(new Error("RPG external consent binding is invalid."), {
      code: "EXTERNAL_RPG_CONSENT_BINDING_INVALID",
    });
  }
  const now = input.now ?? Date.now();
  return {
    schemaVersion: EXTERNAL_RPG_CONSENT_SCHEMA_VERSION,
    purpose: EXTERNAL_RPG_CONSENT_PURPOSE,
    grantId: input.grantId ?? `external-rpg-grant:${crypto.randomUUID()}`,
    ...binding,
    grantedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + EXTERNAL_RPG_CONSENT_MAX_AGE_MS).toISOString(),
  } satisfies ExternalRpgConsentAssertion;
}
