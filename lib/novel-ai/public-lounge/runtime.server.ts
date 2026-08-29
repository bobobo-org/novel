import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createSupabasePublicLoungeStorageGateway } from "../storage/supabase/public-lounge-storage-gateway";
import { PublicLoungeService, type PublicLoungeTokenCodec } from "./service";
import type { PublicLoungeStorageGateway } from "./storage";
import { createEd25519PublicLoungeEligibilityReviewer } from "./eligibility-signature";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
      readJson: unavailable,
      writeJson: unavailable,
      deleteJson: unavailable,
      list: unavailable,
    };
  }
}

export function getPublicLoungeServerService() {
  if (!service) {
    service = new PublicLoungeService({
      gateway: storageGateway(),
      tokenCodec,
      createPublicId: () => `novel_${randomBytes(18).toString("base64url").toLowerCase()}`,
      now: () => new Date().toISOString(),
      digest: sha256,
      eligibilityReviewer: createEd25519PublicLoungeEligibilityReviewer({
        publicKeyPem: process.env.PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY?.trim() ?? "",
        keyId: process.env.PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID?.trim() ?? "",
      }),
    });
  }
  return service;
}
