import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createSupabasePublicLoungeStorageGateway } from "../storage/supabase/public-lounge-storage-gateway";
import { PublicLoungeService, type PublicLoungeTokenCodec } from "./service";
import type { PublicLoungeStorageGateway } from "./storage";
import {
  createEd25519PublicLoungeEligibilityReviewerV5,
  resolvePublicLoungeAttestationEnvironment,
} from "./eligibility-signature";
import { PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION } from "./types";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function idempotencyEncryptionKey() {
  const encoded = process.env.PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/u.test(encoded)) {
    throw Object.assign(new Error("PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_NOT_CONFIGURED"), {
      code: "PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_NOT_CONFIGURED",
      status: 503,
    });
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32) throw new Error("PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY_INVALID");
  return key;
}

const tokenCodec: PublicLoungeTokenCodec = {
  issue() {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: sha256(token) };
  },
  matches(token, expectedHash) {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token) || !/^[a-f0-9]{64}$/u.test(expectedHash)) return false;
    const actual = Buffer.from(sha256(token), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  },
  seal(token, context) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", idempotencyEncryptionKey(), iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString("base64url"))
      .join(".");
  },
  unseal(sealedToken, context) {
    try {
      const parts = sealedToken.split(".");
      if (parts.length !== 3) return null;
      const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64url"));
      if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) return null;
      const decipher = createDecipheriv("aes-256-gcm", idempotencyEncryptionKey(), iv);
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  },
};

let service: PublicLoungeService | null = null;

function storageGateway(): PublicLoungeStorageGateway {
  try {
    return createSupabasePublicLoungeStorageGateway();
  } catch {
    const unavailable = async (): Promise<never> => {
      throw Object.assign(new Error("SUPABASE_STORAGE_NOT_CONFIGURED"), {
        code: "SUPABASE_STORAGE_NOT_CONFIGURED",
        status: 503,
      });
    };
    return {
      bucketStatus: unavailable,
      controlPlaneStatus: unavailable,
      attestationNonceLedgerStatus: unavailable,
      consumeAttestationNonceV5: unavailable,
      readJson: unavailable,
      writeJson: unavailable,
      deleteJson: unavailable,
      listCatalogCandidates: unavailable,
      upsertCatalogAnchor: unavailable,
      deactivateCatalogAnchor: unavailable,
      reserveRate: unavailable,
    };
  }
}

export function getPublicLoungeServerService() {
  if (!service) {
    // A healthy storage bucket is not enough to make publish safely resumable.
    // Fail the whole capability closed when the server-only recovery key is
    // absent instead of advertising a ready endpoint that loses credentials.
    idempotencyEncryptionKey();
    service = new PublicLoungeService({
      gateway: storageGateway(),
      tokenCodec,
      createPublicId: () => `novel_${randomBytes(18).toString("base64url").toLowerCase()}`,
      now: () => new Date().toISOString(),
      digest: sha256,
      eligibilityReviewer: createEd25519PublicLoungeEligibilityReviewerV5({
        publicKeyPem: process.env.PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY?.trim() ?? "",
        keyId: process.env.PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID?.trim() ?? "",
        // A Vercel Production deployment cannot silently adopt a Preview
        // trust root (or vice versa). A mismatch leaves the reviewer
        // unconfigured and the eligibility path fail closed.
        environment: resolvePublicLoungeAttestationEnvironment(
          process.env.PUBLIC_LOUNGE_ATTESTATION_ENVIRONMENT,
          process.env.VERCEL_ENV,
        ),
        audience: process.env.PUBLIC_LOUNGE_ATTESTATION_AUDIENCE?.trim() ?? "",
        producerVersion: process.env.PUBLIC_LOUNGE_ATTESTATION_PRODUCER_VERSION?.trim() ?? "",
        rubricVersion: PUBLIC_LOUNGE_QUALITY_RUBRIC_VERSION,
      }),
    });
  }
  return service;
}
