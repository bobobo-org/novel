import { createHash } from "node:crypto";
import {
  RELEASE_MANIFEST,
  RELEASE_METADATA_CONTRACT,
  RELEASE_PROVENANCE,
} from "@/lib/release-manifest";

export const RELEASE_IDENTITY_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

function provenancePayload() {
  return {
    schemaVersion: RELEASE_PROVENANCE.schemaVersion,
    appCommit: RELEASE_PROVENANCE.appCommit,
    releaseTag: RELEASE_PROVENANCE.releaseTag,
    architectureStage: RELEASE_PROVENANCE.architectureStage,
    sealedAt: RELEASE_PROVENANCE.sealedAt,
    source: RELEASE_PROVENANCE.source,
  };
}

export function releaseProvenanceStatus() {
  const actualHash = createHash("sha256")
    .update(JSON.stringify(provenancePayload()), "utf8")
    .digest("hex");
  return actualHash === RELEASE_PROVENANCE.integrity.payloadHash
    && RELEASE_PROVENANCE.integrity.algorithm
      === RELEASE_METADATA_CONTRACT.provenanceHashAlgorithm
    ? "verified"
    : "unavailable";
}

export function runtimeDeploymentId() {
  return process.env.VERCEL_DEPLOYMENT_ID
    || process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_URL
    || process.env.NEXT_PUBLIC_VERCEL_URL
    || "local";
}

export function releaseIdentity() {
  const provenanceStatus = releaseProvenanceStatus();
  return {
    appCommit: provenanceStatus === "verified"
      ? RELEASE_MANIFEST.appCommit
      : "provenance-unavailable",
    deploymentId: runtimeDeploymentId(),
    releaseTag: RELEASE_MANIFEST.releaseTag,
    releaseName: RELEASE_MANIFEST.releaseName,
    architectureStage: RELEASE_MANIFEST.architectureStage,
    buildTime: process.env.BUILD_TIMESTAMP || RELEASE_MANIFEST.buildTime,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "local",
    provenanceStatus,
    provenanceSource: RELEASE_MANIFEST.commitProvenanceSource,
  };
}
