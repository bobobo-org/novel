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
    releaseProductCommit: RELEASE_PROVENANCE.releaseProductCommit,
    releaseBaseCommit: RELEASE_PROVENANCE.releaseBaseCommit,
    releaseLine: RELEASE_PROVENANCE.releaseLine,
    releaseTag: RELEASE_PROVENANCE.releaseTag,
    releaseRevision: RELEASE_PROVENANCE.releaseRevision,
    releaseBuild: RELEASE_PROVENANCE.releaseBuild,
    releaseName: RELEASE_PROVENANCE.releaseName,
    consumerRelease: RELEASE_PROVENANCE.consumerRelease,
    architectureStage: RELEASE_PROVENANCE.architectureStage,
    gitCommitSignature: RELEASE_PROVENANCE.gitCommitSignature,
    releaseEpoch: RELEASE_PROVENANCE.releaseEpoch,
    provenanceGeneratedAt: RELEASE_PROVENANCE.provenanceGeneratedAt,
    source: RELEASE_PROVENANCE.source,
  };
}

function isoTimestamp(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function runtimeTemporalProvenance(env: NodeJS.ProcessEnv = process.env) {
  const releaseEpoch = isoTimestamp(RELEASE_MANIFEST.releaseEpoch);
  const buildStartedAt = isoTimestamp(env.NOVEL_BUILD_STARTED_AT);
  const buildCompletedAt = isoTimestamp(env.NOVEL_BUILD_COMPLETED_AT);
  // deployedAt is an explicit workflow-sealed value. Vercel does not document a
  // system-created-at environment variable, so no implicit fallback is accepted.
  const deployedAt = isoTimestamp(env.NOVEL_DEPLOYED_AT);
  const environment = env.VERCEL_ENV || env.NODE_ENV || "local";
  const production = environment === "production";
  const ordered = Boolean(
    releaseEpoch
    && buildStartedAt
    && buildCompletedAt
    && Date.parse(releaseEpoch) <= Date.parse(buildStartedAt)
    && Date.parse(buildStartedAt) <= Date.parse(buildCompletedAt)
    && (!production || (deployedAt && Date.parse(buildCompletedAt) <= Date.parse(deployedAt))),
  );
  const status = production ? (ordered ? "verified" : "unavailable") : "not_required";
  return {
    releaseEpoch,
    buildStartedAt,
    buildCompletedAt,
    deployedAt,
    status,
    source: ordered ? "workflow-sealed" : "unavailable",
  } as const;
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
  const temporal = runtimeTemporalProvenance();
  const production = (process.env.VERCEL_ENV || process.env.NODE_ENV) === "production";
  const provenanceStatus = releaseProvenanceStatus() === "verified"
    && (!production || temporal.status === "verified")
    ? "verified"
    : "unavailable";
  const provenanceVerified = provenanceStatus === "verified";
  return {
    appCommit: provenanceVerified
      ? RELEASE_MANIFEST.appCommit
      : "provenance-unavailable",
    releaseProductCommit: provenanceVerified
      ? RELEASE_MANIFEST.releaseProductCommit
      : "provenance-unavailable",
    releaseBaseCommit: RELEASE_MANIFEST.releaseBaseCommit,
    deploymentId: runtimeDeploymentId(),
    releaseLine: RELEASE_MANIFEST.releaseLine,
    releaseTag: RELEASE_MANIFEST.releaseTag,
    releaseRevision: RELEASE_MANIFEST.releaseRevision,
    releaseBuild: provenanceVerified
      ? RELEASE_MANIFEST.releaseBuild
      : "provenance-unavailable",
    assetManifestDigest: provenanceVerified
      ? RELEASE_MANIFEST.commitProvenanceHash
      : null,
    releaseName: RELEASE_MANIFEST.releaseName,
    consumerRelease: RELEASE_MANIFEST.consumerRelease,
    architectureStage: RELEASE_MANIFEST.architectureStage,
    gitCommitSignature: RELEASE_MANIFEST.gitCommitSignature,
    deploymentProvenance: provenanceStatus,
    buildProvenanceStatus: provenanceStatus,
    // Build-sealed provenance is verified above, but no independent attestation
    // over the deployed artifact bytes is currently produced.
    artifactAttestationStatus: "not_produced",
    artifactAttestationDigest: null,
    releaseEpoch: temporal.releaseEpoch,
    buildStartedAt: temporal.buildStartedAt,
    buildCompletedAt: temporal.buildCompletedAt,
    deployedAt: temporal.deployedAt,
    temporalProvenanceStatus: temporal.status,
    temporalProvenanceSource: temporal.source,
    buildTime: temporal.buildCompletedAt,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "local",
    provenanceStatus,
    provenanceSource: RELEASE_MANIFEST.commitProvenanceSource,
  };
}
