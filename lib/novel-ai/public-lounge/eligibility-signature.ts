import { createHash, createPublicKey, verify } from "node:crypto";
import {
  PublicLoungeError,
  publicLoungeEligibilityBinding,
} from "./contract";
import type { PublicLoungeEligibilityReviewer } from "./service";
import type { PublicLoungeServerReviewAttestation } from "./types";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function publicLoungeServerReviewAttestationPayload(
  attestation: PublicLoungeServerReviewAttestation,
) {
  return JSON.stringify({
    schemaVersion: attestation.schemaVersion,
    issuer: attestation.issuer,
    keyId: attestation.keyId,
    nonce: attestation.nonce,
    issuedAt: attestation.issuedAt,
    expiresAt: attestation.expiresAt,
    completionFingerprint: attestation.completionFingerprint,
    publicationDigest: attestation.publicationDigest,
    qualityScore: attestation.qualityScore,
    qualityBreakdown: attestation.qualityBreakdown,
    workCompleted: attestation.workCompleted,
    fullCoverage: attestation.fullCoverage,
    backendId: attestation.backendId,
    modelId: attestation.modelId,
    modelDigest: attestation.modelDigest,
    rawContentStored: attestation.rawContentStored,
  });
}

export function createEd25519PublicLoungeEligibilityReviewer(options: {
  publicKeyPem: string;
  keyId: string;
  now?: () => string;
}): PublicLoungeEligibilityReviewer {
  const now = options.now ?? (() => new Date().toISOString());
  let publicKey: ReturnType<typeof createPublicKey> | null = null;
  try {
    publicKey = createPublicKey(options.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") publicKey = null;
  } catch {
    publicKey = null;
  }
  return {
    configured: Boolean(publicKey && options.keyId),
    async review(input) {
      if (!publicKey || !options.keyId) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED", 503, true);
      }
      const attestation = input.serverAttestation;
      const nowMs = Date.parse(now());
      if (
        attestation.keyId !== options.keyId
        || Date.parse(attestation.issuedAt) > nowMs + 5 * 60_000
        || Date.parse(attestation.expiresAt) <= nowMs
      ) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
      }
      const publication = {
        schemaVersion: "public-lounge-publication-request-v1" as const,
        title: input.title,
        authorByline: input.authorByline,
        category: input.category,
        completionStatus: "completed" as const,
        chapterCount: input.chapterCount,
        wordCount: input.wordCount,
        completedAt: input.completedAt,
        qualityScore: attestation.qualityScore,
        qualityBreakdown: attestation.qualityBreakdown,
        fullSynopsis: input.fullSynopsis,
        publicChapters: input.publicChapters,
        explicitConsent: true as const,
        authorRightsDeclaration: true as const,
        workCompleted: true as const,
      };
      const expectedPublicationDigest = sha256(publicLoungeEligibilityBinding(
        publication,
        input.completionFingerprint,
      ));
      const payload = publicLoungeServerReviewAttestationPayload(attestation);
      const signature = Buffer.from(attestation.signature, "base64url");
      if (
        attestation.publicationDigest !== expectedPublicationDigest
        || !verify(null, Buffer.from(payload, "utf8"), publicKey, signature)
      ) {
        throw new PublicLoungeError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
      }
      return {
        backendId: "private-ai-hub",
        modelId: attestation.modelId,
        modelDigest: attestation.modelDigest,
        completionFingerprint: attestation.completionFingerprint,
        qualityScore: attestation.qualityScore,
        qualityBreakdown: attestation.qualityBreakdown,
        attestationDigest: sha256(`${payload}\n${attestation.signature}`),
      };
    },
  };
}
