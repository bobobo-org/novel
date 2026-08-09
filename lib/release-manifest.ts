import manifest from "@/release-manifest.json" with { type: "json" };
import contract from "@/release-metadata-contract.json" with { type: "json" };
import provenance from "@/generated/release-provenance.json" with { type: "json" };

export type ReleaseProvenance = {
  schemaVersion: string;
  appCommit: string;
  releaseProductCommit: string;
  releaseBaseCommit: string;
  releaseTag: string;
  releaseRevision: string;
  releaseBuild: string;
  architectureStage: string;
  gitCommitSignature: "unsigned" | "verified";
  sealedAt: string;
  source: string;
  integrity: {
    algorithm: string;
    payloadHash: string;
  };
};

const allowedArchitectureStages = new Set<string>(contract.allowedArchitectureStages);
if (!allowedArchitectureStages.has(manifest.architectureStage)) {
  throw new Error(`Unsupported release architecture stage: ${manifest.architectureStage}`);
}
if (!(new RegExp(contract.releaseTagPattern)).test(manifest.releaseTag)) {
  throw new Error(`Invalid release tag: ${manifest.releaseTag}`);
}
if (!(new RegExp(contract.releaseRevisionPattern)).test(manifest.releaseRevision)) {
  throw new Error(`Invalid release revision: ${manifest.releaseRevision}`);
}
if (!(new RegExp(contract.releaseBaseCommitPattern)).test(manifest.releaseBaseCommit)) {
  throw new Error(`Invalid release base commit: ${manifest.releaseBaseCommit}`);
}
if (!(new RegExp(contract.consumerReleasePattern)).test(manifest.consumerRelease)) {
  throw new Error(`Invalid consumer release: ${manifest.consumerRelease}`);
}
if (!contract.allowedGitCommitSignatures.includes(manifest.gitCommitSignature)) {
  throw new Error(`Invalid Git commit signature truth: ${manifest.gitCommitSignature}`);
}
if (Number.isNaN(Date.parse(manifest.buildTime))) {
  throw new Error(`Invalid release build time: ${manifest.buildTime}`);
}
const allowedProvenanceSchemas = new Set<string>(
  contract.allowedProvenanceSchemaVersions ?? [contract.provenanceSchemaVersion],
);
if (!allowedProvenanceSchemas.has(provenance.schemaVersion)) {
  throw new Error(`Unsupported release provenance schema: ${provenance.schemaVersion}`);
}
if (!contract.allowedProvenanceSources.includes(provenance.source)) {
  throw new Error(`Unsupported release provenance source: ${provenance.source}`);
}
if (!/^[0-9a-f]{40}$/i.test(provenance.appCommit)) {
  throw new Error("Release provenance does not contain a full Git commit.");
}
if (provenance.releaseProductCommit !== provenance.appCommit) {
  throw new Error("Release product commit is not the build-sealed commit.");
}
if (provenance.releaseBaseCommit !== manifest.releaseBaseCommit) {
  throw new Error("Release provenance does not match the RC6 base commit.");
}
if (provenance.releaseTag !== manifest.releaseTag
  || provenance.releaseRevision !== manifest.releaseRevision
  || provenance.architectureStage !== manifest.architectureStage
  || provenance.gitCommitSignature !== manifest.gitCommitSignature) {
  throw new Error("Release provenance does not match the release manifest.");
}
if (provenance.releaseBuild !== `${manifest.releaseRevision}+${provenance.appCommit}`
  || !(new RegExp(contract.releaseBuildPattern)).test(provenance.releaseBuild)) {
  throw new Error("Release build identity is not reproducible from the sealed commit.");
}
if (provenance.integrity.algorithm !== contract.provenanceHashAlgorithm || !/^[0-9a-f]{64}$/i.test(provenance.integrity.payloadHash)) {
  throw new Error("Release provenance integrity metadata is invalid.");
}

export const RELEASE_METADATA_CONTRACT = contract;
export const RELEASE_PROVENANCE = provenance as ReleaseProvenance;

export const RELEASE_MANIFEST = {
  ...manifest,
  appCommit: provenance.appCommit,
  releaseProductCommit: provenance.releaseProductCommit,
  releaseBuild: provenance.releaseBuild,
  commitProvenanceSource: "build_sealed",
  commitProvenanceStatus: "verified",
  commitProvenanceSchemaVersion: provenance.schemaVersion,
  commitProvenanceHash: provenance.integrity.payloadHash,
};
